# Goal 重做为 Codex 形态：单线程持久目标，退役 hive / solo 双引擎

日期：2026-09-16
关联：[PRD 与八张票](../../.scratch/goal-simplify/PRD.md)、
[agent-api §5.19](../agent-api/goal-commands.md)、
[stability §7](../agent-api/stability-and-versioning.md)、
[PRD §6.4](../PRD.md)、[RFC-6（已被取代）](../galley-native/rfc-6-goal-hive-morphling.md)、
前史：[goal v1](./2026-06-04-galley-goal-v1.md)、
[solo 打磨轮二](./2026-07-09-goal-solo-dogfood-round-two.md)、
[派发装门](./2026-08-23-goal-dispatch-gate-and-run-state.md)

## 起因

live 窗口票收尾时下一步本是「Goal run 进面板」。JC 先叫停：现在的 goal
模式过于复杂、效果一般，考虑去掉或换成更经典的形态，点名 Codex `/goal`。

两组事实把讨论压成了结论：

- **使用量为零。** 本机 workbench.db 自 5 月 15 日起 107 个 session、345 条
  用户消息，goals 表 0 行，三份备份同为 0；12 条 goal_proposals 全在 6 月
  5–10 日 dogfood 期间。作者自己三个月没用过一次。
- **体量约占仓库 8%**：`cli/src/goal/` 5039 行、core 含 goal 文件 1351 行、
  gui goal 文件 2664 行、9 个迁移、101 个提及文档、9 组 agent-api 子命令。

效果一般的机制根源：solo 把**时间预算当目标**——nudge 原文「你不能宣告完成，
持续提高质量直到预算用完」——没事可做时被迫找事做；hive 在此之上再叠
master / worker、任务板、waves、收尾汇总，08-23 修的三个缺陷都是这套复杂度
自己长出来的。

## Codex `/goal` 对照（读的是源码，不是博客）

`codex-rs/ext/goal/`：一张表 `thread_goals`（thread 主键、objective、status、
可选 token 预算、用量计数）；thread 空闲时 `continue_if_idle` 起新一轮，输入
是渲染后的 `continuation.md`；完成由模型调 `update_goal`（`complete /
blocked / paused` 三值，`paused` 只能应用户要求）；预算是上限，超限注入
`budget_limit.md` 并转 `budget_limited`；轮出错、连续空响应、执行不可用由系统
转 `blocked`。三份模板里真正值钱的三段：目标是数据不是指令、不许把成功缩成
更小的子集、完成前逐条证据审计；blocked 要同一阻塞连续三轮。

与我们的差别只有一条，也正是效果差异的根：**预算当目标 vs 预算当上限。**

## 定案

JC 裁决五条：换（不是纯删）；完成判定归模型、预算改上限；循环放 Core；契约
升 `schemaVersion: 2`；「Goal run 进面板」暂停。第二轮按源码补四点：加
`blocked`、轮出错即停、三段提示词照抄、上限后一轮收尾。六条剩余裁决点全按
推荐：暂停态要；上限默认 60 分钟、预设 30/60/120/无上限、删自定义；并发改每
session 一个、取消全局锁；v2 接受 v1 请求、goal 族在 v1 下 `unknown_command`；
`blocked` 发消息即恢复；启动叙述行删。

已否：全删（把诉求推给 Supervisor 自写循环）；保留 hive 只砍 solo（hive
是复杂度主体）；保留「预算即目标」只换壳；v2 硬拒绝 v1（老 SOP 连
`sessions list` 都跑不了，代价落在没用过 Goal 的人身上）。

## 落地形态

- **数据**：迁移 039 删 `goal_proposals / goal_tasks / goal_events /
  goal_deliverables`，重建 `goals` 为 `session_id` 挂靠、七态、可空上限、
  续跑计数；旧行按 master session 搬入，中途被升级打断的置 `stopped` 且标
  已读，无 master 的丢弃。`messages.goal_id` 无外键、子表先删，039 走普通
  迁移事务，preflight 边界不动。
- **引擎**：`core/src/goal_engine.rs` 挂在队列 drain task 后面，
  `RunComplete` 弹不出排队消息才轮到 goal；forwarder 在事件流上顺手记
  `RunOutcome`（最终 turn 的 `<goal-status>` 标签与 summary、非 business 的
  error、bridge 合成的 `ABORTED`）；判定顺序 abort → paused、error →
  blocked、标签、上限收尾 → `budget_limited`、否则续跑。恢复不需要落点：
  run 记「用户轮 / 续跑轮」，paused / blocked 在一次用户轮结算时回 active。
  停止 = 状态先写 stopped 再 abort；Core 重启与 bridge 死亡都置 paused。
- **提示词**：`core/src/goal_prompts.rs` 三份英文模板（model-facing 且
  internal，模型按目标语言作答），四段必保原样在。
- **标签**：runner 照 `<next-suggestion>` 的路径提取 `goalStatus`、剥离
  展示；managed 补丁 `0022` 在 chatapp_common 与 fsapp 剥；GUI 流式清洗四处
  同加；`im_reporter` 同剥。
- **契约**：`SCHEMA_VERSION = 2`、接受集 `{1, 2}`；`goal.start / status /
  active / stop` 四命令；CLI `--schema=1 goal …` 本地拒绝。CLI 不匹配沿用
  exit 2，不改 v1 语义。
- **GUI**：删 task board、worker context bar、hive 开关、项目承载、工作区
  按钮；确认框只剩目标 + 上限；委派 / 收口标记改 v2 文案；新 `GoalPausedTail`
  承担 paused / blocked；goal-thread 收口规则改「到下一个委派或 endedAt 之后
  的用户 turn 之前」（修掉 v1 把收口标记插到工作之前的 bug）；事件驱动
  `goal-updated`，5 秒轮询降为兜底。

三处实施时改判：session 正在跑时 `goal start` 返回 `invalid_args` 而非排队
（目标行要此刻可见落库、派发文本又不同，塞不进队列的单文本形状，且 GUI 本就
禁用入口）；模板只英文一份，`GoalLocale` 删除；目标轮与可见目标行共用一个
turn index，不另落 internal 行，步号紧接。上游 seed
`goal_hive_master_duty.md` 不删（随 GA baseline 变动，Rule 1）。

## 体量

39 个文件 +773 / −9163（01 数据层与退役）之后再 +约 1.8k（引擎、契约、
GUI）；全 workspace `cargo test`、`pytest / mypy / ruff`、
`pnpm typecheck / lint / test` 全绿。

## 后记：live 窗口接入 Goal run（同日）

JC 真机跑过 goal 后指出 goal 线程仍是全平铺。四条裁决全按推荐：翻转 08-06
「Goal run 不折」（括号是过程摘要的外框，不是替代）；paused / blocked 折叠
而非平铺（尾标已留疤）；中途引导消息切组保留但也走 goal 规则（与 rail
分段一致）；续跑的进展说明降为叙述体。落地在 `gui/src/lib/goal-run-groups.ts`：
在 `buildRunGroups` 的形状分组之上盖一层——goal `active` 且是最后一组即
live（不看 `agentRunning`，续跑边界不拆窗口），其余 goal 组一律折，只有
`completed / budget_limited` 的最后一组保留 deliverable，步号按组内位置连续，
折叠头不显示用时。`run-groups.ts` 的形状判定不动。MainView 的 in-flight rail
从「步号 > 1」改为问 plan「窗口里已有落定步」，因为 GA 的 turn 号每个续跑轮
回到 1。

## 后记二：时间预算「太死」（同日）

JC 提议给上限加更多档甚至 iPhone 闹钟式 5 分钟滚轮。agent 的判断：v2 的
预算是上限不是目标，5 分钟粒度是假精度；「死」的实感来自两端缺档（没有
15 分钟试跑、没有 4 小时挂机）和到点没出口（`budget_limited` 是终态，想再
来 30 分钟只能重起 goal）。JC 认可三条：档位改对数六档 15 / 30 / 60 / 120 /
240 / 无上限；到点可延长（`goal extend` / `extend_goal`：`budget_limited`
重开为 active、清 ended_at 与收尾标记、Core 当场派下一轮续跑；active 只加
上限；无上限或其他状态拒绝）；自定义分钟框加回。滚轮否。

## 后记三：暂停后恢复的时机（同日）

JC 真机：按停止再发「继续」，goal 线程只见折叠头。根因是引擎在用户轮
**结算**时才把 paused 拨回 active，整轮期间 GUI 按「非 live 一律折」处理。
改为 forwarder 在用户轮第一个 `TurnStart` 发 `RunSignal::UserRunStarted`、
引擎当场置 active（结算恢复留作兜底），续跑轮的标记改到 send 之前；GUI 把
「open goal + agentRunning」也视为 live。顺带修掉委派标记下折叠头没接上的
bug（commission item 原来不带 turn，`headerFor` 查不到）。

## 后记四：「最多」还是「至少」（同日收尾）

JC 第三次真机：10 分钟上限的「了解三星折叠屏」2 分半、10 步后模型自判完成，
一次续跑没发。系统按设计工作，但暴露了预期落差：JC 描述的主场景是「离开桌面扔
长任务」和「quota 快重置把余量用掉」，即**想把时间用满**——正是早上被去掉的
语义。agent 承认早上把 v1「效果一般」全归因于「预算当目标」只对了一半，提出
同一引擎加 `use_budget` 模式（续跑提示换成审计式改进协议、完成收紧为连续两轮
无改进）。JC 重新考虑后**裁决先按 Codex「干完为止」用法**，`use_budget` 进
[deferred](./deferred.md)。顺带明确了 Goal 与普通 session 的真实差别：只在任务
跨多轮时存在（模型习惯性收口、ask_user、GA 每 put_task 180 步上限），一轮能
做完的问题用 Goal 是多余的；入口引导应说清「跨多轮、有可验证终态」。

## 待办

- 07 真机 dogfood 八条路径（自行完成、到上限、停止、中止后恢复、受阻、
  attach、Core 重启、两 session 各一 goal），视觉裁决点见 05 票 Comments
  （Composer 已有 goal 时入口是否保留为灰态、多 goal pill 计数、completed 的
  summary 只在 popover）。
- 08「live 窗口接入 Goal run」已做（见后记），待真机看完成瞬间的 sweep 与
  暂停时的收合。
- 发版是 minor 不是 patch；release notes 要写 schemaVersion 2 与 v1 goal
  命令退役。
