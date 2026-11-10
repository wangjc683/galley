# 03 瘦身：没人发的事件、Goal 遗留的命令、实验目录、演示会话清理

Status: ready-for-agent（第二波：等票 01、02 合入后再派，三张票改同一批 Core 文件）

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
