# 01 Core + CLI + remote-protocol + iOS：删 Goal 引擎与全部表面，契约升 schemaVersion 3

Status: done（2026-10-13，执行记录见 Comments）
Blocked by: 无

先读 [PRD](../PRD.md) 的「契约」一节（写死，本票必须照做）。本票只碰 `core/`、`cli/`、`remote-protocol/`、`ios/`。

## 工作位置（硬约束）

- **只在 worktree 里工作**：`/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/ab7a31ac-a0f8-4206-b6ee-0c4affeea868/scratchpad/wt-remove-goal`（下称 `$WT`）。
  所有命令都在 `$WT` 下跑，路径都用 `$WT/...`。
- **绝不碰主工作树** `/Users/inkstone/Documents/genericagent-webui`：JC 的 `pnpm tauri dev` 常驻在那里，改它会触发重编、杀掉在跑的会话。
- **不跑 `tauri dev`**，不 commit，不 push，不改别的票的域（`gui/`、`runner/`、`managed-ga/`、`docs/`、`README*`、
  `AGENTS.md`、`.claude/`、`.agents/`、`scripts/`、`.scratch/` 除本票 Comments）。
- 另外三张票（GUI、runner、文档）与你同时在 `$WT` 里改各自目录。它们的文件出现瞬态改动是正常的，别去碰。
- `$WT/core/target` 已从主树 APFS 克隆（含 `tauri-sidecars`、`python-bundle`、`gen`），增量编译即可。

## 改什么

### 删除的文件

- `core/src/goal_engine.rs`、`core/src/goal_prompts.rs`、`core/src/db/goal.rs`、`core/src/api/goal.rs`、
  `core/src/commands/goal.rs`、`core/src/socket_listener/goal_cmds.rs`
- `cli/src/goal.rs`

### Core（grep `-i goal` 起点，2026-10-13 计数）

`api.rs`（37）、`db/api_impl.rs`（29）、`db/session.rs`（30）、`db/helpers.rs`（26）、`db/rows.rs`（11）、`db/mod.rs`（4）、
`protocol/commands.rs`（26）、`protocol/envelope.rs`（10）、`protocol/mod.rs`（2）、`runner_manager/manager.rs`（24）、
`runner_manager/queue.rs`（13）、`runner_manager/process.rs`（1）、`runner_manager/mod.rs`、`socket_listener/mod.rs`（18）、
`socket_listener/ctx.rs`（6）、`socket_listener/session_cmds.rs`（7）、`socket_listener/common.rs`（2）、
`socket_listener/llm_cmds.rs`（2）、`lib.rs`（11）、`app_setup.rs`（9）、`ipc.rs`（9）、`remote/events.rs`（8）、
`remote/convert.rs`（5）、`message_queue.rs`（6）、`session_runner/{mod,segment,replay}.rs`、`subtask.rs`（5）、
`api/message.rs`（5）、`api/origin.rs`（1）、`managed_prompt.rs`（4）、`scheduler.rs`（3，注释）、`notify.rs`（1）、
`auto_title.rs`（2）、`session_title.rs`（2）、`session_send.rs`（2）、`turn_persistence/derive.rs`（2）、`commands/mod.rs`（3）。
测试：`core/tests/` 下 `db_writes_test.rs`（115）、`socket_write_handlers_test.rs`（67）、`message_turn_page_test.rs`（23）、
`session_runner_test.rs`（19）、`runner_manager_test.rs`（16）、`scheduler_fire_test.rs`（9）、`db_test.rs`（9）、
`client_column_test.rs`（8）、`session_send_test.rs`（5）、`remote_module_test.rs`、`remote_e2e_test.rs`，
以及 `core/tests/fixtures/{turn-persistence-cases,turn-persistence-rows,history-replay-cases}.json`。

### CLI

`cli/src/args.rs`、`cli/src/main.rs`、`cli/src/session.rs`（注释 + 测试里 `MessageBrief` 的 `goal_id`）、
`cli/src/project.rs` / `cli/src/client.rs`（注释）、`cli/Cargo.toml`（第 43 行起「per-goal controller lock」那个依赖：
查它是否还有别的使用方，没有就删依赖并更新 `core/Cargo.lock`，有就只改注释）、`cli/tests/cli_test.rs`、`cli/tests/m1_writes.rs`。

### remote-protocol 与 iOS（都未发版，直接删）

`remote-protocol/src/push.rs`（`kind::GOAL` 及测试里拿它当样例的地方——换成现有的别的 kind）、
`remote-protocol/src/app/events.rs`（`GoalUpdatedEvent`、`goal.updated`）、`remote-protocol/src/app/types.rs`
（消息的 `goal_id`）、`remote-protocol/tests/golden.rs`、`remote-protocol/tests/golden/app-messages.json`；
`ios/GalleyRemote/Sources/GalleyRemote/App/Events.swift`、`App/Types.swift`、`Push.swift`、`App/JSONValue.swift`（注释）、
`ios/GalleyRemote/Tests/GalleyRemoteTests/{PushTests,AppTests}.swift`。

## 怎么改

1. **schema**：`protocol/envelope.rs` 里 `SCHEMA_VERSION = 3`，`ACCEPTED_SCHEMA_VERSIONS: [u32; 3] = [1, 2, 3]`，删
   `goal_family_requires_v2` 及其调用；doc 注释改写为：`3` 起于 Goal 移除（`.scratch/remove-goal`），goal 族删除；
   `1` / `2` 仍回答每条没变的命令；删掉的命令在每个版本下都是 unknown。`protocol/mod.rs:23`、`envelope.rs:177`
   一类「Breaking requires schemaVersion: 2」的注释改成「requires the next schemaVersion」。
2. **socket**：`goal.*` 五条命令的分派臂、参数类型（`GoalStartArgs` 等）、`goal_cmds.rs` 全删，落到默认的
   `unknown_command` 分支。`session.checkpoint` 保留，删 `SessionCheckpointArgs.goal_id` 与
   `send_system_message_for_goal` 路径（改走普通系统消息写入）。
3. **CLI**：删 `GoalCmd`、`Command::Goal`、`mod goal`、`main.rs` 里 `pinned < SCHEMA_VERSION && Command::Goal` 那个
   mismatch 分支；保留「不在接受集 → `schema_mismatch:`」。注释里「goal family is v2-only」之类全改掉。
4. **引擎**：删 `GoalEngine` 及其在 drain task / `message_queue.rs` / `app_setup.rs`（启动 `pause_open_goals`、引擎
   spawn）/ `lib.rs`（模块声明、8 个 Tauri 命令注册：`list_active_goals`、`list_visible_goals`、
   `list_goals_for_session`、`goal_status`、`mark_goal_result_seen`、`request_goal_stop`、`start_session_goal`、
   `extend_goal`）/ `socket_listener/ctx.rs` 里的挂载点；删 `goal-updated` 事件（`GOAL_UPDATED_EVENT`）的发送与
   remote 转发、Core 侧 goal 终态通知与推送。
5. **只为 Goal 存在的机制一起删，通用的留下**。判断标准：删掉 Goal 后还有没有别的调用方 / 消费方。
   - **必须保留（已核实有别的调用方）**：`EnsureOptions.holds_run_gate`（主对话子任务 `subtask.rs:557`、
     `session_send.rs:301`、socket send `socket_listener/mod.rs:148` 都在用）、队列 drain、`ask_user` 挂起、
     `live` 运行态里的 `lastExit` / `askPending`、发送前回放历史、runner `Closed` 信号对闸门的处理、
     消息的通用 `internal` 可见性过滤。
   - **大概率只服务 Goal，核实后删**：`RunSignal::UserRunStarted`（消费方在 `message_queue.rs:210` 调
     `engine.on_user_run_started`）、`RunOutcome` / `RunOutcomeDraft` / `last_outcome` 里 goal 专属的部分
     （`<goal-status>`、续跑标记；`RunKind` 的「续跑轮」）、`send_message_for_goal` /
     `send_system_message_for_goal`、`goal_commission_before`（分页回溯到委派行）、`api.rs` 里 goals (v2) 那组
     trait 方法、`DEFAULT_GOAL_BUDGET_SECONDS`。每删一个在回报里写一行「谁原来用它」。
6. **消息行**：`api/message.rs` 删 `MessageBrief.goal_id`；`db/rows.rs`、`db/session.rs` 的 SELECT / INSERT 列表去掉
   `goal_id`（**列留在库里**，不加迁移；先核实 `messages.goal_id` 可空、无默认值问题）；`remote/convert.rs` 同步。
7. **IPC**：`ipc.rs` 的 `TurnEnd.goal_status` 与相关测试删掉（runner / GUI 两边由别的票删，三边要一致）。
8. **提示词**：`managed_prompt.rs:62`（输入框说明里的「Goal, which …」）与 `:417`（命令列表里的 `goal`）删掉，
   让句子仍然通顺；`:300`「write everything it needs: the goal, …」是子任务简报里的普通英文词，**不动**。若有
   提示词字节预算 / 原文断言测试，按新文本更新。
9. **`subtask.rs`**：`:100` 剥 `<goal-status>` 的正则删掉；`:143`、`:685` 的「## Goal」是子任务标题解析的普通用法，**不动**。
10. **注释**：`scheduler.rs`、`notify.rs`、`session_send.rs`、`auto_title.rs` 等处把 Goal 当参照物的注释改写成不提 Goal。
11. **测试**：
    - 纯 Goal 测试删掉。
    - **测试同时钉住通用不变量时，改成走非 Goal 路径钉同一个不变量，别直接删**（例：`a_goal_survives_the_quiet_restart_of_its_runner`
      钉的是「旧 runner 的 `Closed` 不能放掉新运行的闸门」，`session_runner_test.rs` / `session_send_test.rs` 里
      Goal 派发顺序测试钉的是「先回放再派发」）。回报里逐条列「旧名 → 新名，钉的不变量」。
    - 新增契约回归：socket `goal.start` 在 `schemaVersion` 1 / 2 / 3 下都回 `unknown_command`；CLI `galley goal start x y`
      输出 `invalid_args` 信封、exit 2；`--schema=3` 接受、`--schema=4` 拒绝（`schema_mismatch:`）；`galley version`
      报 `schemaVersion: 3`。已有这类测试就改，不重复造。
    - 发 `"schemaVersion": 2` 的非 Goal 测试保持原样（2 仍被接受）。
12. **iOS / remote-protocol**：删 `GoalUpdatedEvent`、`goalUpdated` case、`"goal.updated"` 字符串、`goalId` 字段、
    `Push.goal`；golden JSON 删对应条目；两边测试同步。

## 别动什么

- `core/migrations/*`、`core/src/db_migrations.rs` 的迁移条目、`core/src/migration_backup.rs` 的预检逻辑（它按 SQL
  数 `goals` 表行数，表还在，照常工作）、六处手写迁移列表、`core/experiments/*`。**不新增迁移**。
- `core/src/sop_install.rs` / `im_supervisor` 里 `include_str!` 的 SOP 文档由文档票改，你不改 docs。
- 不对整个 crate 跑 `cargo fmt --all`（`core/` 不是 rustfmt-clean，会重排无关文件）；只对你动过的文件
  `rustfmt --edition 2021 --check <file>`，必要时只格式化你自己的文件。

## 验证命令（都在 `$WT` 下）

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test  --manifest-path core/Cargo.toml --workspace          # 必须 --workspace，cli crate 也要跑
(cd ios/GalleyRemote && swift test)
node scripts/check-ipc-protocol-drift.mjs                          # runner / GUI 票没落地前可能因它们而红，回报里说明
git diff --check -- core cli remote-protocol ios
grep -rn -i "goal" core/src cli/src remote-protocol ios --include='*.rs' --include='*.swift' --include='*.json'
```

最后一条的剩余命中逐条说明理由（允许：历史迁移相关、`managed_prompt.rs:300` 与 `subtask.rs` 的普通英文用法、
envelope 注释里一句话的退役说明）。

## 回报格式

1. 删除的文件列表；
2. 每个改动文件一行摘要；
3. 第 5 条里删掉的机制，每个一行「谁原来用它」；保留的、你本以为该删的，写为什么留；
4. 测试：改写的（旧名 → 新名，钉的不变量）、删掉的（名字，为什么）、新增的；
5. grep 剩余命中与理由；
6. 每条验证命令的结尾输出（通过 / 失败的测试数）；
7. 域外看到的问题（只报不改）。

## Comments

### 2026-10-13 执行记录（票 01 代理）

结论：Goal 引擎与全部表面已删（删 7 个文件、改 70 个）；契约升 `schemaVersion: 3`，`goal.*` 在 1 / 2 / 3 下都答 `unknown_command`，`galley goal …` 一行 `invalid_args`、exit 2；`goals` 表与 `messages.goal_id` 留库不读写，未加迁移。唯一的 goal 痕迹是 `core/src/turn_persistence/derive.rs` 里 `GA_TAG_PATTERNS` 端口那一条，与票 02 第 10 条一致。

验证：`cargo test --workspace` 915 passed / 0 failed；`ios/GalleyRemote/swift-test.sh` 73 passed（本机只有 Command Line Tools，裸 `swift test` 找不到 `Testing` 模块）；`check-ipc-protocol-drift` 通过；`git diff --check` 无输出；GUI `turn-persistence.golden.test.ts` 33 passed。
