# 01 CLI 契约：项目空闲判断、watch 首帧超时、回显 schema 版本

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 A2、A3、B10（JC：「按建议推进」）。

先读 `docs/agents/dispatch.md`（执行代理的常驻约束）、`AGENTS.md` Rule 3、`docs/agent-api/README.md`。CLI JSON 是公开契约：**先改文档，再改代码**。行号是 `79403d1e` 时的，以符号名为准。

## 背景

三处都是「文档承诺了，代码没做到」，而且都落在 Supervisor 每天用的命令上。

- **A2**：`cli/src/project.rs` 的 `project_has_active_sessions` 用库里的 `sessions.status` 判断有没有会话在跑（`is_live_candidate`：Connecting / Running / WaitingApproval）。Core 只往这一列写 `idle` 或 `archived`，所以它恒为假：`project follow --until-idle` 在任意 1.5 秒无事件后就以 `project_idle` 退出，哪怕子会话还在跑。Supervisor SOP 推荐的正是这条命令。同一根因让 `project brief` 的 `runningSessions` 恒为空、`followState.activeStatusSessions` 恒为 0。
- **A3**：`cli/src/transport.rs` 的 `FIRST_RESPONSE_TIMEOUT`（120 秒）对 watch 流的第一帧也生效。Core 接受订阅时不写任何帧，只在 runner 有事件时才写。runner 活着但安静 120 秒，`session watch`、`session follow`、`project follow` 就以退出码 4 报「Galley Core is not responding」。
- **B10**：`core/src/protocol/envelope.rs` 的应答永远写 `SCHEMA_VERSION`（3），不管请求 pin 的是 1、2 还是 3。`docs/agent-api/` 的稳定性一章说 pin 旧版本的请求「answered exactly as before」。

## 1. 改哪些文件

- `docs/agent-api/` 下相关各篇（项目命令、会话命令、传输、稳定性与版本）
- `cli/src/project.rs`、`cli/src/transport.rs`、`cli/src/session.rs`、`cli/src/common.rs`，以及它们的测试
- `core/src/protocol/envelope.rs`、`core/src/socket_listener/` 里构造应答的地方，以及它们的测试
- `docs/integrations/`、`.claude/`、`.agents/` 不动（票 05 管）

## 2. 怎么改

一组一个提交。

**A2**
- 空闲判断改读 Core 的实时运行状态，用 `session wait --until-idle` 已经在用的那个探测（批量的 `sessions.run_state`，CLI 里找 `probe_live_states` 或同义函数）：项目里每个会话的 `live.openRun` 与 `live.agentRunning` 都为假才算空闲。Core 连不上时退回现在按库里状态判断的行为。
- `project brief` 的 `runningSessions`、`followState` 的 `activeStatusSessions` / `idleStatusSessions` 同样改读实时状态；字段名与类型不变。
- 文档：项目命令一篇写清空闲的新定义与退回规则；稳定性一章的行为修复记录里加一条（参考 `galley llm list --runtime` 那条的写法）。
- 测试：一个会话在跑、库里状态是 `idle` 时，`--until-idle` 不退出；跑完后退出。

**A3**
- 只改 CLI，线上协议不变：订阅前先做一次 `ping` 往返（受现有的 120 秒一元超时约束），证明 Core 活着；之后 watch 流的第一帧不再有超时。
- 更新 `transport.rs` 里说明这两个超时的注释，以及传输一篇里对应的句子。
- 测试：订阅后 Core 长时间不发帧，CLI 不报超时（用可注入的短超时或假时钟，不要真等 120 秒）；Core 不在时仍然很快失败。

**B10**
- 应答里的 `schemaVersion` 回显请求 pin 的版本；没有 pin 时是当前版本。socket 调用方（请求里的 `schemaVersion`）与 CLI（`--schema=N`）走同一条规则。流的每一帧也一样。
- 动手前通读稳定性一章，确认「回显」与它对三个版本的描述一致。`galley version` 报告的是这个二进制支持的当前版本，是能力报告：它在 pin 下该输出什么，按文档现有的说法定；文档没说清就**不要猜**，保持现状并写进回报。
- 测试：三种 pin 各一条，断言应答里的版本号。

## 3. 验证

```bash
cargo check --manifest-path core/Cargo.toml --workspace --all-targets
cargo test  --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
node scripts/check-supervisor-sop-drift.mjs
git diff --check main..HEAD
```

改过的 Rust 文件逐个 `rustfmt --check`，只修自己的 hunk。

## 4. 别动什么

- 任何命令名、flag、JSON 字段名、错误标识、退出码类别。只允许字段的值从恒定变成真实。
- `core/src/socket_listener/` 里与应答版本无关的部分（票 03 会删其中三个命令）。
- Supervisor SOP、参考文档、两份 skill 副本、`core/src/managed_prompt.rs`。
- `gui/`、`runner/`。

## 5. 回报格式

按 `docs/agents/dispatch.md`。另外写明：B10 在 `galley version` 上最后怎么处理的、依据文档的哪一句。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| dev 里用 CLI 起一个会跑两三分钟的项目子会话，`project follow --until-idle` 应等到它跑完；库里核对退出时刻晚于最后一步 | 无 |
| 对一个安静的会话 `session watch` 超过 120 秒，不应报超时 | |
| `--schema=1 status` 的应答里是 1 | |

## Comments
