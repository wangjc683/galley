# 03 瘦身：没人发的事件、Goal 遗留的命令、实验目录、演示会话清理

Status: done（2026-11-10 合入；主会话在 dev 里代验，无 JC 步骤）

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 B9、B11、C14、C15、C17（JC：「按建议推进」）。

先读 `docs/agents/dispatch.md`、`AGENTS.md`（Rule 3、Rule 5）、`docs/ipc-protocol.md`、`docs/engineering-workflow.md`。IPC 协议的规矩是**先改文档，再改代码**；Rust、TypeScript、Python 三处镜像一起改，`scripts/check-ipc-protocol-drift.mjs` 是门禁。

删任何符号之前全仓 grep（`core/ cli/ gui/ runner/ scripts/ remote-protocol/ relay/ ios/ managed-ga/ docs/ .github/`），含字符串用法（serde 名、`invoke("…")`、socket 命令名）与 `#[cfg(windows)]` 代码。说法不成立就跳过并写进回报。

## 1. 改哪些文件

- `docs/ipc-protocol.md`、`docs/agent-api/session-commands.md`（`session watch` 的示例）、`CONTEXT.md` 里相关词条
- `core/src/ipc.rs`、`core/src/protocol/`、`core/src/api.rs`、`core/src/socket_listener/`、`core/src/db/`、`core/src/commands/`、`core/Cargo.toml`、`core/Cargo.lock`、`core/experiments/`（删）、相关测试
- `gui/src/types/ipc.ts`、`gui/src/lib/db.ts`、`gui/src/lib/hydrate.ts` 及测试
- `runner/ipc.py` 及测试

## 2. 怎么改

一组一个提交。

**B9 `protocolVersion`：文档改成现状**

`docs/ipc-protocol.md` 有三处说桌面端必须校验 runner `ready` 里的 `protocolVersion`、不一致就关掉 runner。没有任何代码校验：Core 的 `PROTOCOL_VERSION` 只被它自己的测试用到，`gui/src/types/ipc.ts` 导出的常量没人导入。Core 与 runner 总是来自同一个安装包（外置模式下 runner 也是 Galley 自己带的），错位在发布版里不会发生。删掉「必须校验」的说法，写明这个字段是诊断信息；删掉 GUI 里没人导入的常量。线上字段保留。

**B11 + C14 没人发的事件与 Goal 遗留**

- `tool_call_start`、`tool_call_end`、`tool_call_progress`：三处镜像里都有定义，只有测试在构造。从协议文档、三处镜像与测试里删掉；`docs/agent-api/session-commands.md` 的 `session watch` 示例里去掉这些帧。删之前确认 GUI 的事件路由、工作台与任何 CLI 输出都不依赖它们（依赖的地方是死分支就一起删）。
- socket 命令 `session.checkpoint`、`session.shutdown_runner`、单会话的 `session.run_state`：随 Goal 加入，Goal 移除后没有调用方（CLI 用的是批量的 `sessions.run_state`，那个保留，逐个核对别删错）。删掉它们的分发、参数类型，以及只为 `session.checkpoint` 存在的 `send_system_message`。它们没进过 Agent API 文档；删后这三个名字回答 `unknown_command`，在 `docs/agent-api/` 的稳定性一章加一句记录。
- `GalleyApi::send_message_with_visibility`、`session_messages_including_internal` 与用户消息命令上的 `visibility`（写入侧，十个构造点全传 `None`；runner 侧对应的读取）：删。只测这些的测试一起删，测别的东西顺带用到它们的，改用现成的等价写法。
- **保留**：`messages.visibility` 这一列、读取侧所有 `visibility = 'visible'` 的过滤（老库里有 Goal 写下的内部消息）、`auto_title` 等处对读到的旧行的处理。

**C15 实验目录**

`core/experiments/` 下两个探索各自的 README 都说是一次性的。删掉目录、`Cargo.toml` 里的 `experiments` feature、`bridge-owner-experiment` 这个 `[[bin]]`、只被它们用到的 `anyhow`（先确认没有别的使用者）与 `default-run` 那段因此过时的注释；活文档与代码注释里指向 `core/experiments/` 的地方改掉；`scripts/check-docs-links.mjs` 如果有跳过该目录的规则，一起去掉。

**顺带的两处过时文字**（票 02、05 留下的）

- `docs/ipc-protocol.md` 讲运行错误的一节仍写着错误在对话里内联显示、`retryable` 会出重试按钮、traceback 默认折叠。票 02 已把错误卡片收成只有 toast、删掉了重试按钮（GUI 里已没有代码读 `retryable`）。把这一节改成现状；`retryable` 字段本身留在线上，不删。
- 「180 步，计划模式 100」：内置内核自 2026-10-18 的基线升级起没有计划模式的单独上限（`managed-ga/code` 里核实现在的数）。SOP 与参考文档票 05 已改；剩下的改掉：`docs/ipc-protocol.md`、`docs/design/conversation/turns.md`、`docs/ga-baseline.md` 的现行说明，以及 `runner/workbench_bridge.py`、`runner/tests/test_workbench_bridge.py`、`gui/src/lib/step-limit.ts`、`gui/src/components/conversation/StepLimitTail.tsx` 里的注释。只改说法，不改任何判断逻辑；外置 GA 的版本各不相同，别替它下断言。

**C17 v0.1 演示会话清理**

`gui/src/lib/db.ts` 里每次启动都调用一个「一次性」清理，删掉 v0.1 开发版种下的演示会话。种子数据只在 2026-05-08 到 05-11 的开发版里写过，第一个 tag 是 05-15，没有任何发布版写过这些行。删掉 GUI 的调用、对应的 Tauri 命令与数据库方法、它们的测试。

## 3. 验证

```bash
cargo check --manifest-path core/Cargo.toml --workspace --all-targets
cargo test  --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck && pnpm --dir gui lint && pnpm --dir gui test
.venv/bin/python -B -m pytest -q -p no:cacheprovider
.venv/bin/python -B -m mypy runner
.venv/bin/ruff check runner --no-cache
node scripts/check-ipc-protocol-drift.mjs
node scripts/check-docs-links.mjs
node scripts/check-managed-ga-payload.mjs
git diff --check main..HEAD
```

worktree 里没有 `.venv`，用主工作树的解释器只读地跑，当前目录是 worktree。

## 4. 别动什么

- 任何迁移文件、数据库列。
- Agent API 文档里已经记录的命令、字段、错误标识、退出码。
- `sessions.run_state`（批量）、`ping`、`app.activate`。
- GUI 侧的 runner 淘汰、`queue_take_next` 等只有测试用的队列函数（没有裁决）。
- `docs/integrations/`、两份 skill 副本、`core/src/managed_prompt.rs`。

## 5. 回报格式

按 `docs/agents/dispatch.md`。写明每个删掉的 socket 命令删前的调用方 grep 结果。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 合入后 dev 重启正常，发一条消息走完一轮；`session watch` 一轮的帧里没有被删的事件类型；socket 上三个旧命令回 `unknown_command` | 无（不应有可见变化） |

## Comments

**2026-11-10 合入与代验（主会话）**

- 删前的调用方 grep：三个 socket 命令带引号的名字在 `cli/src`、`gui/src`、`runner`、`managed-ga`、`docs`、两份 skill 副本里都没有命中。
- 代验：合入后 dev 重启正常，四个 IM 渠道与浏览器桥起来；直接连 Core 的 socket 发三个旧命令，在 schema 1、2、3 下都回 `unknown_command`，批量的 `sessions.run_state` 与 `ping` 照常；用 CLI 起一个一次性会话走完一轮带工具调用的任务，`session watch` 的帧是 `ready`、`turn_start`、`turn_progress`、`turn_end`、`run_complete`，没有被删的事件类型。测试会话已永久删除。
- `scripts/check-ipc-protocol-drift.mjs` 原来读 GUI 的版本常量，常量删掉后只比 Python 与 Rust 两侧（两侧不一致时仍会失败）。
- 主工作树里 `core/experiments/tray-mode/` 下被忽略的构建残留与 `.gitignore` 里为它留的三行，JC 说「顺手删掉」，已删。
- 没动的：手机协议的金样文件仍拿 `tool_call_start` 当示例事件（载荷不透明，不影响测试；改它要动 iOS 测试读的文件）；ADR-0002 的表里仍列着 `session.checkpoint`；`docs/devlog/deferred.md` 里「计划模式撞 100 步上限不提示」那一节因上游去掉计划模式而失效，没删。
- 删除后仍在、已不可达的：`insert_message_inner` 的 `MessageRole::System` 分支，`insert_user_message_inner` 的 `visibility` 参数（调用方全传 `Visible`）。
