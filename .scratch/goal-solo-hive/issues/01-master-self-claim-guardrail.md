# 01 — Bug: master 用 --owner-session 自领 task,导致编排降级 + banner 错乱

Status: ready-for-agent
Created: 2026-07-08
Parent: ../PRD.md

## 现象(Dev 实测)

一次 Goal("勒布朗下赛季去哪队",managed / autonomous / worker_limit=2 /
budget 5m)运行后:

- **Master session 冒出一个 Goal Worker banner**(不该有)。
- 两个 Worker session,**一个有 banner、一个没有**。

## 根因(已核实,证据链闭合)

Banner 是否显示,完全由"该 session 有没有在 `goal_tasks.owner_session_id` 里被
记为某个 task 的 owner"反查决定(`core/src/db/goal.rs:451 goal_worker_context`),
而不是由真实角色(master / worker)决定。

这次运行里 master **自己 own 了两个 task**:

1. master 规划 prompt 建议的 `galley goal task create ...` 示例**不带** owner
   参数(应产出 open 无主 task)。
2. master 第一次 create 报错(其过程摘要:"Task creation failed due CLI flag
   mismatch")——`task create` 只认 `--description / --scope / --owner-session`,
   **没有 `--author-session`**(那是 event / deliverable 才有的署名 flag),master
   很可能误用了 `--author-session`。
3. master 重试时**改用 `--owner-session <自己的 session id>`**(摘要原文:
   "retrying with --owner-session")。`create` 带 owner → task 一出生就
   `claimed`、owner=master(`core/src/db/goal.rs:627-631`)。

### 连锁破坏(比 banner 严重)

master 那两个 round-1 task(scope `goal-worker-1/2:master-round-1:...`)born
`claimed` → 板上**零个 open 无主 task** → 控制器触发兜底
(`ensure_goal_fallback_followup_tasks`)生成两个通用中文 task
(scope `...master-fallback-round-2...`) → worker 对着**降级的兜底任务**跑,
master 精心拆的 "Produce first evidence / Independent verification" **一个都没被
执行**,永远 claimed 挂着。一个兜底 task 被 worker 完成,另一个 worker 没 claim
到任何 task(5min 预算太紧),于是无 banner。

即:**一个 flag 误用把整轮拆解丢弃、编排降级,UI 上完全看不出。**

## 设计意图(契约与 SOP 均已明确)

master 是 scheduler/editor,**不是 production worker**:

- `docs/agent-api/goal-commands.md:60-63`:"The Master acts as a scheduler/editor,
  not a production worker."
- `cli/src/goal/prompts.rs`(master planning / duty)+ `managed-ga/state-seed/
  memory/goal_hive_master_duty.md`:"never produce deliverable content yourself"
  / "绝不自己下场生产产物"。

所以 master own task 是**违反设计意图**的越界,不是有意行为。但代码层**没有任何
护栏**:`create` / `claim` / `update` 对 master/worker 一视同仁。

## 修复(三层)

### 层 1 — 硬护栏(核心,必须做)

Core 层拒绝把 task owner 设成该 goal 的 `master_session_id`,覆盖三条写路径:

- `create_goal_task_db`(`core/src/db/goal.rs:615`)
- `claim_goal_task_db`(`:665`)
- `update_goal_task_db`(`:700`,`--owner-session` 经 update)

共享一个 `ensure_task_owner_not_master(goal_id, owner)` helper:owner==master 时
返回 `GalleyError::InvalidArgs`(exit 2),报错文案要**引导**:"master 不持有
task,请 create 成 open(不带 --owner-session)让 worker 认领"。

**契约安全性**:`--owner-session` 是 schemaVersion 1 冻结契约
(`goal-commands.md:186-189`),**不删 flag**。只收紧一个"文档本就禁止"的用法,
复用现有 exit 2 `invalid_args` 类,不引入新错误标识——additive-safe。

### 层 2 — 概念修正(prompt 措辞)

master 职责措辞从"never produce deliverable content yourself"改成更精确的
**"不承接单点 task,但负责聚合式收口(synthesis)"**。现措辞把"下场做 task"和
"synthesis 生产 deliverable"混为一谈——master 明明要 `deliverable set`,这个含糊
可能加剧 LLM 角色困惑、诱发越界。落点:`cli/src/goal/prompts.rs` +
`managed-ga/state-seed/memory/goal_hive_master_duty.md`。

### 层 3 — banner 兜底(UI 鲁棒性)

UI 按真实角色判定,数据脏也不把 master 显示成 worker:
`GoalWorkerContextBar` 在目标 session 是某 goal 的 master 时**不渲染 worker
banner**(master 走它自己的 task board / synthesis 面板)。落点:
`gui/src/components/conversation/GoalWorkerContextBar.tsx` 或其数据源
`goal_worker_context`(反查时排除 master)。

## 验证

- `cargo test --workspace`(含新增护栏单测:owner==master 时 create/claim/update
  均报 InvalidArgs)。
- 回归:worker 正常 claim 自己的 task 不受影响;控制器 owner=None 的 create 不受
  影响。
- `pnpm --dir gui typecheck` / `lint`(banner 改动)。

## Comments
