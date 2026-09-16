# 06: 文档、SOP、skill 副本、devlog

Status: done
PRD: ../PRD.md（§4.4）
Blocked by: 04（契约定稿后写文档）；05 的 UI 文案定稿后再改 design 文档

## 范围

### Agent API

- `docs/agent-api/goal-commands.md` 重写为 v2：四个命令、参数、返回、
  `dispatch` 值、错误路径、状态机图（复制 PRD §3.2）、`GoalBrief` v2 字段
  表、「v1 goal 命令已移除」一节。
- `stability-and-versioning.md`：状态行改 v2；新增「schemaVersion 2 政策」
  节（升版原因、接受集 {1, 2}、goal 族在 v1 下 `unknown_command`、CLI
  `--schema=1` 行为、release notes 提示）；状态枚举表加 `GoalBrief.status`
  七值；`dispatch` 表加 `goal start`。
- `README.md` 状态引言改 v2；路由表 goal 行改「goal start / status / active /
  stop（v2）」。`roadmap-and-references.md` 的 `GalleyApi` trait 面同步。
- `session-commands.md` 若提到 goal worker / master 的地方清理。

### Supervisor SOP 与 skill

- `docs/integrations/galley-supervisor-sop.md`：「Choose Mode」表 Goal 行
  改为「让 agent 在一个 session 里自己干到干完 / 到上限」；「Start A Goal」
  节重写：`goal start <session-id> "<objective>" --budget-minutes=60`、
  不再有 propose / confirm token、用 `session wait` / `goal status` 跟进、
  `goal stop`、paused / blocked 时「发一条消息即恢复」；schema 守卫例子改
  `--schema=2`。
- `galley-supervisor-reference.md` 同步。
- `.claude/skills/galley-supervisor/` 与 `.agents/skills/galley-supervisor/`：
  SKILL.md 触发语与 Goal 说明改写，`references/` 两份副本重新同步（保留
  头部 provenance 注释、更新 Last synced）；`node scripts/check-supervisor-sop-drift.mjs`
  过。
- `core/src/managed_prompt.rs` 第 248 / 266 行的 supervisor 提示里 goal
  用法改写（若 03 / 04 未顺手改）。

### 产品与设计文档

- `docs/PRD.md` §6.4 重写：Goal = 挂在 session 上的持久目标；受众不分先后
  （CLI 与 GUI 同一条命令路径）；何时用（需要多轮自主推进、有可验证终态的
  目标）；与 Project 无关系；非目标：多 agent 交叉验证（走 Project + 多
  session 由 Supervisor 编排）。
- `docs/galley-native/rfc-6-goal-hive-morphling.md` 顶部加「Superseded
  2026-09-16 by goal v2（见 devlog）」框。
- `docs/design/conversation.md`：「Goal run = 线程内插曲」节按新委派 /
  收口 / 暂停尾标改写；删 task board 与叙述 callout 段（叙述行已删）；
  live 窗口段落里「Goal run 留第二步」保留。`layout-and-chrome.md` pill 段
  同步。
- `docs/devlog/deferred.md`：删「Goal 停止立即 abort 当前轮」；「LiveDots
  站点」条目去掉 GoalRunMarkers；架构审查候选 5 删除、候选 6 改写或删除。
- `docs/project-status.md`：Unreleased 段加本批；grep `goal`、`solo`、
  `hive`、`--mode` 全文清理。
- `docs/README.md` 索引若指向 rfc-6 加 superseded 备注。

### devlog

新建 `docs/devlog/2026-09-16-goal-v2-codex-shape.md`：起因（JC 实感 + 0
使用数据）、机制根源（预算即目标）、Codex 对照（源码路径、三份模板、
状态集）、定案五条 + 裁决六条、已否方案、契约 v2 政策与为何不硬拒绝、
退役体量。`docs/devlog/README.md` 登记。

## 验收

- `node scripts/check-supervisor-sop-drift.mjs` 过。
- `grep -rn "propose\|confirm-token\|--mode=solo\|hive" docs/agent-api docs/integrations .claude/skills .agents/skills` 无残留（历史 devlog 除外）。
- 中英两种语言的 Goal 提法各 grep 一遍。

## Comments

**2026-09-16 — Agent API 部分先落（其余等 05 定稿）**

- `docs/agent-api/goal-commands.md` 全文重写为 v2：运行方式、状态机、四个
  命令、`GoalBrief` v2 字段表、完成标签、socket 表、exit codes、等待方式
  （无 `goal wait`，用 `session wait` / `session follow` + `goal status`）。
- `stability-and-versioning.md`：§1 规则改为「一个 major 内 additive」、
  §1.1 加 `GoalBrief.status` 枚举与 `goal start` dispatch 行、§1.2 pin 规则
  改 v2、§7 拆成 7.1 v2 政策（升版原因、v1 接受集、goal 族 unknown_command、
  从 v1 goal SOP 迁移要点）/ 7.2 v1 冻结说明 / 7.3 major 内规则。
- `README.md` 状态引言与路由表行；`roadmap-and-references.md` 的 trait 表
  换成 v2 九个方法；`errors-and-exit-codes.md` §6A 的 Origin 例外说明改写；
  `transports.md` 示例 `schemaVersion: 2`、`schema_mismatch` 语义改「接受集之外」。
- 残留 grep（propose / confirm-token / --mode= / hive / GoalStatusSnapshot）
  只剩 7.1 与 goal-commands 顶部的退役说明，属有意保留。
- 未动：SOP / reference / skill 副本、PRD §6.4、rfc-6 标注、design 文档、
  deferred、project-status、devlog——等 05 的 UI 文案定稿一起做。

**2026-09-16 — 其余部分落地**

- SOP「Choose Mode」行与「Start A Goal」节重写（`goal start` / 状态语义 /
  steer 与恢复 / stop 即时），schema 守卫改 `--schema=2`；reference 的读写
  命令表、「Goal」节、错误说明、边界列表同步；两份 skill 副本按 provenance
  头重新同步（Last synced 2026-09-16），SKILL.md / README 去掉「Goal V1」；
  `check-supervisor-sop-drift.mjs` 过。
- PRD §6.4 重写；rfc-6 顶部加 superseded 框；`conversation.md` Goal 章节框
  与叙述 callout（标 legacy）改写，`layout-and-chrome.md` 侧栏 goal 态行改写；
  deferred 删「Goal 停止立即 abort」、LiveDots 条目去掉 goal 尾标、架构审查
  候选 5 标随退役消失；project-status 的 Current Target schema 行与
  Unreleased 段加 Goal v2 批次；devlog 新条目 + README 时间线登记。
- 未动（有意）：`polish-checklist.md` 里 GoalTaskBoard / Goal pill 的历史
  打磨记录，是当时批次的账。
