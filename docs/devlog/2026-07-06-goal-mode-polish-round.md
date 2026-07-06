# 2026-07-06 — Goal 模式打磨轮：定位入档、Stop 收尾、进度与结果呈现

一次以「Goal 的产品呈现补欠账」为主题的打磨轮。起点是 JC 列的三个问题
（用户不清楚什么场景用 Goal、进行中缺时间/预算反馈、Master/Worker
session 点进去看不懂），代码审计后归结为两个根因：

1. **后端信息模型丰富但呈现层全部丢弃**——`goal_status` 返回的
   tasks / events / deliverable / latestSummary 在 GUI 里一个都没渲染；
2. **产品定位从未正式回答**——PRD 里没有 Goal 定义，「何时用」的答案
   只写给了 Supervisor agent（SOP），从没写给人。

## 定位决策（本轮的裁决依据）

**Goal 第一受众是 Supervisor agent；桌面人类用户是第二受众，水位 =
「基础体验到位」。** 已入档 PRD §6.4。该定位裁掉了本轮曾讨论的重方案：
不做专门 Goal 屏幕、不做 deliverable GUI 面板、不做事件推送（5s 轮询
保留）、不做 worker 会话的侧栏隐藏。

**Goal ↔ Project**：审计确认「自建项目」本来就只是无上下文启动的
fallback（GUI 一直传 `activeSession?.projectId ?? activeProjectFilter`，
后端带 project 即复用）；真正缺的是可发现性 → 确认框加了一行运行位置
说明。「worker 锚定从 project 迁到 goal、project 变可选」记为未来方向，
本轮不做（架构级改动，超出水位）。

## 落地内容

- **W1 goalId 地基**（migration 031）：`messages.goal_id` 列 + 部分索引。
  objective turn / launch ack（`send_message_for_goal` /
  `send_system_message_for_goal` 新 trait 方法）与 master checkpoint
  （`session.checkpoint` 加 additive `goalId` arg）写入时打标；
  `goal-thread.ts` 改两阶段匹配——goalId 精确优先，无 goalId 的旧行回退
  「文本相等 + 最近时间戳」启发式，且打过标的 turn 不会被别的 goal 借走。
  不回填旧数据。
- **W2 Stop 简短收尾**：`GoalFinishMode { Normal, StopWrapUp }`。stop 不再
  「跳过汇总、已跑工作全丢」——有材料（任务/结果信号）时 master 做一次
  简短收尾（专用短 prompt、synthesis 超时 min 120s、超时直接终态化为
  Stopped 而非留 Wrapping），无材料保持历史的即时停止。终态恒为
  `stopped`，NDJSON phase 零新增（复用 wrapping→finished）。
  **配套修复**：`list_visible_goals` 此前根本不含 stopped——GUI 轮询只会
  看到「Goal 消失」，stopped toast 永远不触发；现在 stopped-unseen 与
  completed/failed 同待遇（可见直到查看）。
- **W3 结果卡**：GoalTerminalMarker 加来路行「完成 N/T 个任务 · 用时 X
  分钟 (· 改进 M 版)」。数据来自 GoalBrief 新增的三个 additive 可选计数
  （taskCount / completedTaskCount / deliverableVersion，SQL 标量子查询，
  GoalRow 用 `#[sqlx(default)]` 让不需要计数的查询自动 None）。
  「改进 M 版」阈值 deliverableVersion ≥ 2（版本 1 是「写了一次」，
  谈不上改进）。
- **W4 Pill 进度填充 + Popover 增强**（pill 填充是 JC 提出的方案）：
  TopBar Goal pill 背景随时间预算消耗从左到右填充——恰好与早前
  「pill 撤掉倒计时数字」的决策互补：安静地补回进度感而不重新引入
  焦虑的跳动数字。deadline 冻结所以纯本地时钟（20s 粗粒度 tick），
  不依赖轮询；wrapping = 满条 + 呼吸动画（满条要读作「正在收尾」而非
  「卡死在 100%」）。Popover 加 latestSummary 常驻行（后端早就有、
  GUI 从没显示的最高信号量字段）、任务 N/T、已耗时/预算。
- **W5 Master 内任务板 + Worker 上下文条**（JC 二轮讨论把 worker 呈现
  升级为「任务板进 master」）：每个 Goal episode 一块任务板——运行中由
  MainView 钉在线程尾部自轮询（5s），终态由 annotateGoalThread 冻结在
  结果卡上方（failed 的「遗产展示」即冻结任务板，完成任务保留
  resultSummary）。**形态上明确拒绝逐条追加式任务卡**：对话流追加式 vs
  任务状态可变，逐条卡片必然过期 + 淹没线程（与当年拒绝 checkpoint 走
  assistant role 同理）。任务行点击下钻 worker session。worker session
  顶部保留精简上下文条（「Goal 的 Worker · 任务 · 状态」，整条可点回
  master）兜底侧栏直达路径——数据来自新增的 `goal_context_for_session`
  反查（`goal_tasks.owner_session_id`，吃 `goal_tasks_by_owner` 索引；
  sessions 表无 worker 标记，这是唯一链路）。
- **W6 运行位置可见化**：GoalConfirmDialog 增加「在项目〈X〉中运行 /
  将创建一个新项目」一行。

## 契约影响（schemaVersion 1，全部 additive）

- `GoalBrief` + 三个可选计数字段（`skip_serializing_if` + `serde(default)`）。
- `session.checkpoint` socket args + 可选 `goalId`。
- stop 行为语义变化（收尾期最多 ~2 分钟才落 stopped）——非 schema 变更，
  已在 goal-commands.md 与 supervisor SOP 补述；exit codes / phase 值 /
  响应形状不变。

## 被拒/未做

- deliverable anchor 的 GUI 面板：桌面上只呈现一个权威结果（master
  最终回答），anchor 留给 Supervisor via CLI——两个「结果」并存会让
  用户困惑哪个算数。
- 事件推送替代轮询、专门 Goal 屏幕、隐藏侧栏 worker、goal extend：
  定位水位之外。
- 「M 轮改进」的精确轮次计数：checkpoint 按 kind 去重、wave 数不可从
  events 干净推导，用 deliverable 版本号作为诚实的近似。

## 验证

`cargo check/test --workspace`（10 个 suite 全绿，含新增 core db 测试：
goal_id 写读回、worker 反查命中/未命中、visible list 含 stopped-unseen；
cli 测试：stop 超时 cap、材料 gate）；`pnpm --dir gui typecheck / lint /
test`（97 tests，含新增 goal-thread 两阶段匹配与 episode 括号测试）。
桌面视觉验收（pill 填充、任务板、stop 收尾全流程）留待 JC dogfood。
