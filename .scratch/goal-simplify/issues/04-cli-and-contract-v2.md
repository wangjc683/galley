# 04: CLI 与契约 v2 — SCHEMA_VERSION 2、四个 goal 命令、兼容政策

Status: done
PRD: ../PRD.md（§3.6、§4.1、§6 裁决 4）
Blocked by: 01, 03

## 范围

### 版本

- `core/src/protocol/envelope.rs` `SCHEMA_VERSION = 2`；`cli/src/common.rs`
  同步（若两处各自定义，收成一处）。
- socket `socket_listener/mod.rs:561`：相等判断改为 `ACCEPTED_SCHEMAS =
  [1, 2]`。请求带 `schemaVersion: 1` 且命令属于 goal 族（新旧都算）→
  `unknown_command`；其余命令行为与 v2 相同。响应里的 `schemaVersion` 回显
  请求的值。
- CLI `main.rs:67`：`--schema=1` 对非 goal 子命令放行，对 `goal …` 报
  `schema_mismatch`（exit 1）；`--schema=2` 与省略等价；其他值
  `schema_mismatch`。

### 删除

- `cli/src/goal/` 整目录；`args.rs` 删 `GoalTaskCmd / GoalEventCmd /
  GoalDeliverableCmd / GoalWriteModeArg / GoalModeArg / GoalTaskStatusArg /
  GoalEventTypeArg`；`session.rs` 删四个 `session_*goal*_value`；
  `main.rs` / `project.rs` / `client.rs` 清理引用。
- socket：删 `session.goal_synthesize`、`session.goal_master_plan`、
  `session.goal_solo_turn`、`session.new_goal_worker` 分支及
  `session_goal_cmds.rs`、`session_new_cmds.rs` 的 worker 模板逻辑；
  `protocol/commands.rs` 对应 `socket_command!` 删除。
  `session.run_state` / `sessions.run_state` 保留。

### 新增（socket 命令 + CLI 子命令，一一对应）

| CLI | socket | args | 返回 |
|---|---|---|---|
| `goal start <session-id> "<objective>" [--budget-minutes=N \| --no-budget] [--supervisor= --reason=]` | `goal.start` | `{sessionId, objective, budgetSeconds?, supervisor?, reason?}` | `{goal, message, dispatch: "dispatched"}`（`GoalEngine::start` 的 `GoalStartResult`）；session 正在跑 → `invalid_args` |
| `goal status <goal-id>` | `goal.status` | `{goalId}` | `{goal}` |
| `goal active` | `goal.active` | `{}` | `[goal]`（active / paused / blocked） |
| `goal stop <goal-id> [--supervisor= --reason=]` | `goal.stop` | `{goalId, supervisor?, reason?}` | `{goal}` |

- 默认上限：省略 `--budget-minutes` 与 `--no-budget` 时 60 分钟；两者同给
  `invalid_args`。
- 同 session 已有 active / paused / blocked goal → `invalid_args`，消息含
  现有 goal id。
- session 不存在 / 已归档 → `not_found` / `invalid_args`（沿 `session send`
  的判定）。
- `goal.start` / `goal.stop` 各建一个 `HandlerCtx` 后调
  `crate::goal_engine::GoalEngine::{start, stop}`（Tauri 命令
  `commands/goal.rs::start_session_goal` 就是现成样板）。
- NDJSON / JSON 输出、`--supervisor` / `--reason` 走 `origin_from_args`。

## 验收

- `cargo check` / `cargo test` 全 workspace 过。新增：
  - socket：v1 请求非 goal 命令成功；v1 请求 `goal.start` 与旧名
    `session.goal_solo_turn` 都 `unknown_command`；v2 `goal.*` 四条正常；
    `goal.start` 忙时 invalid_args；同 session 二次 start invalid_args。
  - CLI：`--schema=1 sessions list` 通过、`--schema=1 goal active` 报
    schema_mismatch 且 exit 1；`--schema=3` schema_mismatch。
  - 参数纯函数：`--budget-minutes` 与 `--no-budget` 互斥。
- `galley version` 输出 `schemaVersion: 2`。
- 跑一遍 `docs/agent-api` 里所有示例命令的 dry check（06 会改文档，本票只
  保证命令存在）。

## 注意

- 错误标识集合不变（五个 CLI 可见 + 四个 wire）。
- 不搭车修 v1 其他毛刺（PRD §3.6 政策）。

## Comments

**2026-09-16 落地（分支 `goal-v2`，未提交）**

- `SCHEMA_VERSION = 2`，新增 `ACCEPTED_SCHEMA_VERSIONS = [1, 2]` 与
  `goal_family_requires_v2()`（`core/src/protocol/envelope.rs`）；socket
  `dispatch_line_with` 先查接受集（否则 `schema_mismatch`），再对 v1 请求的
  `goal.*` 返回 `unknown_command`。退役的 `session.goal_*` /
  `session.new_goal_worker` 在任何版本下都是自然的 `unknown_command`。
- 新 socket 命令 `goal.start / goal.status / goal.active / goal.stop`
  （`core/src/socket_listener/goal_cmds.rs`，arg 结构在 `protocol/commands.rs`），
  全部经 `GoalEngine`，与 Tauri 命令同源。
- CLI：`cli/src/goal.rs` 四个子命令 + 纯函数 `budget_seconds_from_flags`
  （互斥 / 0 分钟 / 默认 60）；`--schema` 处理：接受 1 或 2，`1` 配 `goal`
  子命令报 `schema_mismatch:`。
- **偏差**：CLI 端 schema 不匹配沿用既有的 exit 2 / `invalid_args`（票面写
  exit 1 是照 socket 层 wire 错误的映射写的，CLI 本地 pin 校验一直是 2，
  不改 v1 语义）。
- 删除部分 01 已做；本票只做新增。
- 测试：socket 6 条（v1 未变命令照跑、v1 goal 族与退役名 unknown_command、
  v3 schema_mismatch、start/status/active/stop 往返含 goalId 广播与二次 start
  拒绝、忙碌零副作用、not_found 两处）；CLI 4 条（version 输出 2、`--schema
  1/2` 透传、`--schema 1 goal active` 拒绝、`--schema 99` 拒绝）+ budget 纯函数
  1 条；既有 `schemaVersion == 1` 断言改 2。`cargo test --workspace` 全绿。
- 真机 smoke：`galley version` → `{"galleyVersion":"0.4.16","schemaVersion":2}`；
  `galley goal --help` 四个子命令；`galley --schema 1 goal active` exit 2 带
  `schema_mismatch:` 前缀。
- 交给 06：`docs/agent-api` 的 goal-commands / stability 两份按 PRD §3.6 与
  本票表格写；`session.checkpoint` 仍在 v1/v2 命令表里。
