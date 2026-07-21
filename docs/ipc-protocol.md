# IPC Protocol v0.1

Galley (Galley) bridge 与 desktop 之间的通信契约。本文件是**唯一真相**——bridge 与 desktop 实现必须以本文件为准；改协议先改本文件。

## 1. Overview

- 一个 `bridge` 子进程 = 一个 GA session = 一个独立的 GA 进程
- desktop 主进程通过 stdin 向 bridge 发命令；bridge 通过 stdout 向 desktop 发事件
- 协议版本：`0.1`

## 2. Transport

**Stdin/stdout transport** (runner ↔ Galley Core, B2 M1+ Rust-owned):

- **格式**：JSON Lines（每行一个 JSON 对象，UTF-8 编码，以 `\n` 结尾）
- **stdin**：Galley Core → runner 的命令
- **stdout**：runner → Galley Core 的事件
- **stderr**：仅用于 runner 自身崩溃日志，Galley Core 不解析事件（只 rolling buffer 最后 8 行给 abnormal-exit toast）
- **字段命名**：camelCase
- **时间戳**：ISO 8601 带时区（如 `2026-05-07T13:51:00+08:00`）
- **空字符串 vs null**：缺失用 `null` 或省略字段；不要用空字符串当"无"

**Socket transport (B2 M3+)** — for CLI / external agents to reach Galley Core:

- **macOS/Linux**: Unix domain socket at `${TMPDIR:-/tmp}/galley-${UID}.sock`，permission `0600`
- **Windows**: Named pipe at `\\.\pipe\galley-${USERNAME}`，user-scoped namespace
- **Framing**：NDJSON request line → NDJSON response line（行内 JSON 对象，`\n` 终止）
- **Schema version**：客户端发 `"schemaVersion": 1`，服务端检查匹配（不匹配返回 `error: "schema_mismatch"`）
- **Idle timeout**：90 秒无 IO 服务端断开（streaming 子命令的 push 不算 idle）
- **Auth**：仅文件系统权限（per-UID socket file）。**不开 TCP, 不持 token**（AGENTS.md § Localhost Only）

### Socket request shape

```jsonc
{
  "command": "sessions.list",     // dotted name; full list in docs/agent-api.md
  "args": { /* command-specific */ },
  "schemaVersion": 1,             // optional, default = current
  "requestId": "uuid"             // optional, echoed in response for client demux
}
```

### Socket response shape (success)

```jsonc
{
  "ok": true,
  "requestId": "uuid",            // echoed if provided
  "result": { /* command-specific */ }
}
```

### Socket response shape (error)

```jsonc
{
  "ok": false,
  "requestId": "uuid",
  "error": "not_found",           // stable identifier — pattern-match this
  "message": "session 'xyz' does not exist"
}
```

The full stable discriminant table (including `runner_error` and the runner-spawn tags) lives in [agent-api/stability-and-versioning §2/§2A](./agent-api/stability-and-versioning.md) — that document is the single source; do not restate the list here. Since 2026-07-11 the code home is the `ErrorTag` enum in `core/src/protocol/error_tag.rs`, shared by Core's emitters and the CLI's exit-code mapping. Additions are allowed without bumping `schemaVersion`; renames or removals require a bump. (`not_implemented` is reserved — no emitter exists today.)

### Stream responses (B2 M4+, for `session.watch`)

```jsonc
{
  "stream": "event",
  "requestId": "uuid",
  "data": { /* event payload (mirrors stdin/stdout IPC event shape) */ }
}
```

Stream ends with `{"stream": "end", "requestId": "uuid", "reason": "<why>"}` when the server closes the subscription (session archived, SIGINT from client, etc.).

### Race detection at startup

Galley Core checks the socket path before binding:

1. Path exists + connect succeeds → another instance is running. Log + skip bind. CLI clients still see exit 4 from this instance because we never start a listener.
2. Path exists + connect fails (ECONNREFUSED) → stale socket file from a crashed previous instance. Unlink + bind fresh.
3. Path does not exist → bind fresh.

Residual race window (sub-millisecond): between try-connect and the next bind, another process could win the bind. The probability is negligible in practice — if it happens, the second-spawned process emits a "bind failed" log and CLI clients hit exit 4 transiently. Atomic SOCK_SEQPACKET semantics would close this fully; deferred until it actually causes a problem.

## 3. Lifecycle

Bridge 子进程通过 CLI 参数初始化：

| 参数 | 是否必填 | 说明 |
|---|---|---|
| `--ga-path` | 必填 | 用户本地 GenericAgent 仓库的绝对路径 |
| `--session-id` | 必填 | desktop 端分配的 session id |
| `--cwd` | 可选 | Legacy escape hatch for explicit runner cwd. Project folders are **not** passed here. Normal Galley spawns omit it so GA can keep using its own runtime/state root. |
| `--workspace-root` | 可选 | Project Workspace root. When set, bridge asks GA `frontends/workspace_cmd.py` to prepare a Workspace link, sets per-agent Project Mode attributes, and leaves process cwd unchanged. |
| `--llm-no` | 可选 | 初始 LLM 索引（默认 0） |

```
desktop                             bridge subprocess
  │                                       │
  │  spawn (--ga-path, --session-id,      │
  │         --workspace-root?, --llm-no)  │
  │ ───────────────────────────────────► │
  │                                       │ import GA, build agent
  │                                       │ register turn_end_hook
  │                                       │ install WorkbenchHandler
  │  ◄──── { kind: "ready", ... }         │
  │                                       │
  │  { kind: "load_history", ... }        │  (可选，仅恢复 session 时)
  │ ───────────────────────────────────► │
  │  ◄──── { kind: "history_loaded" }     │
  │                                       │
  │  { kind: "user_message", ... }        │
  │ ───────────────────────────────────► │
  │  ◄──── { kind: "turn_start", ... }    │
  │  ◄──── { kind: "tool_call_*", ... }   │  (若有审批，bridge 阻塞)
  │  { kind: "approval_response", ... }   │
  │ ───────────────────────────────────► │
  │  ◄──── { kind: "turn_end", ... }      │
  │  ◄──── { kind: "run_complete", ... }  │
  │                                       │
  │  { kind: "shutdown" }                 │
  │ ───────────────────────────────────► │
  │                                       │ exit(0)
```

## 4. Events (bridge → workbench)

每个事件必有 `kind` 字段。所有事件都隐含 `sessionId` 字段（由 desktop 在 spawn 时分配，bridge 启动后 echo 回来）。

### 4.1 `ready`

bridge 启动并完成 GA 初始化后**立刻**发的第一条事件。desktop 收到此事件才能开始发命令。

```json
{
  "kind": "ready",
  "sessionId": "sess_abc123",
  "protocolVersion": "0.1",
  "gaCommit": "cf6551516fcc836f21dcdad592b07c703d09e1d8",
  "gaCommitDate": "2026-05-11T20:48:23+08:00",
  "gaPath": "/Users/inkstone/Documents/GenericAgent",
  "llmName": "NativeClaudeSession/glm-5.1",
  "cwd": "/Users/inkstone/Documents/GenericAgent/temp",
  "pid": 12345,
  "availableLLMs": [
    { "index": 0, "name": "NativeClaudeSession/glm-5.1", "displayName": "NativeClaudeSession/glm-5.1", "isCurrent": true },
    { "index": 1, "name": "ClaudeSession/claude-sonnet-4-6", "displayName": "ClaudeSession/claude-sonnet-4-6", "isCurrent": false },
    { "index": 2, "name": "NativeOAISession/gpt-4o", "displayName": "NativeOAISession/gpt-4o", "isCurrent": false }
  ],
  "timestamp": "2026-05-07T13:51:00+08:00"
}
```

字段说明：
- `gaCommit`：用户本地 GA repo 的 HEAD commit hash（来自 `git rev-parse HEAD`）。`"unknown"` 表示 GA 路径不是 git 仓库（例如 zip 下载安装），desktop 应优雅退化为"无版本信息"
- `gaCommitDate`：HEAD commit 的提交时间（ISO 8601，来自 `git log -1 --format=%cI`）。同样 `"unknown"` 退化处理
- `llmName`：当前激活的 LLM raw name（GA 内部 `f"{ClassName}/{model}"` 格式）
- `availableLLMs`：所有可用 LLM 的列表。`name` 是 raw 名字。`displayName` 是 UI 标签：external GA 保留完整 raw name；managed GA 使用 Galley 模型配置里的显示名，未设置时使用原始 model id。
- session 持久化不要只存 `index`：external GA 使用 `name` 作为稳定身份；managed GA 使用 Galley `managed_models.id`，再在启动时解析到当前 index。

desktop 必须验证 `protocolVersion` 与自身一致；不一致应主动 `shutdown`。

### 4.2 `turn_start`

agent 进入一轮步骤。Bridge 会在普通 `user_message` / `ask_user_response`
被接受后主动发送 `turn_start(1)`，再开始转发 display_queue 的
`turn_progress`，避免首批 LLM token 先于步骤标记到达 GUI。后续步骤仍由
`turn_end` 预测发送 N+1，并由 GA dispatch hook 的同编号事件去重确认。

```json
{
  "kind": "turn_start",
  "sessionId": "sess_abc123",
  "turnIndex": 1,
  "timestamp": "..."
}
```

### 4.3 `tool_call_pending`

工具需要用户审批时发出，bridge 阻塞直到收到 `approval_response`。

```json
{
  "kind": "tool_call_pending",
  "sessionId": "sess_abc123",
  "approvalId": "appr_xyz789",
  "turnIndex": 1,
  "toolName": "code_run",
  "args": { "type": "python", "code": "print('hi')" },
  "argsPreview": "type=python, code=print('hi')...",
  "riskLevel": "high",
  "reason": "Code execution can modify files / network",
  "timestamp": "..."
}
```

字段说明：
- `args`：完整工具参数 JSON（用于审批 UI 完整展示）
- `argsPreview`：≤200 字符的人类可读摘要
- `riskLevel`：`"low" | "medium" | "high"`
- `reason`：为何需要审批（用于 Approval Card 提示）

### 4.4 `tool_call_start`

工具开始执行（已通过审批 / 不需审批）。

```json
{
  "kind": "tool_call_start",
  "sessionId": "sess_abc123",
  "toolCallId": "tc_001",
  "turnIndex": 1,
  "toolName": "file_read",
  "args": { "path": "agentmain.py" },
  "argsPreview": "path=agentmain.py",
  "timestamp": "..."
}
```

`toolCallId` 由 bridge 生成（uuid 短形式），用于 `tool_call_end` 关联。

### 4.5 `tool_call_end`

工具执行结束。

```json
{
  "kind": "tool_call_end",
  "sessionId": "sess_abc123",
  "toolCallId": "tc_001",
  "status": "success",
  "resultPreview": "[FILE] 268 lines | ...",
  "elapsedMs": 124,
  "timestamp": "..."
}
```

字段说明：
- `status`：`"success" | "failed" | "denied" | "cancelled"`
- `resultPreview`：≤500 字符的结果摘要
- `denied` 仅当用户在 `tool_call_pending` 后回 `decision: "deny"` 时发出

### 4.6 `tool_call_progress`（兜底）

bridge 解析 GA yield 出来的 markdown 字符串得到的非结构化进度，用于 raw view。**不**作为 desktop 渲染主链路的依据。

```json
{
  "kind": "tool_call_progress",
  "sessionId": "sess_abc123",
  "toolCallId": "tc_001",
  "text": "[Action] Running python in temp: print('hi')...",
  "timestamp": "..."
}
```

### 4.7 `turn_end`

来源：`agent._turn_end_hooks`。**这是 Tool Timeline 与 Session Row 状态展示的主数据源**。

```json
{
  "kind": "turn_end",
  "sessionId": "sess_abc123",
  "turnIndex": 1,
  "summary": "已完成文件读取，准备分析内容",
  "toolCalls": [
    { "toolName": "file_read", "args": { "path": "agentmain.py" } }
  ],
  "toolResults": [
    { "toolUseId": "...", "content": "[FILE] 268 lines..." }
  ],
  "exitReason": null,
  "responseContent": "<thinking>...</thinking><summary>已完成文件读取，准备分析内容</summary>",
  "telemetry": null,
  "timestamp": "..."
}
```

字段说明：
- `summary`：直接复用 GA 在 `turn_end_callback` 中提取的 `<summary>` 标签内容（GA 已 smart_format 截断到 100 字符）
- `toolCalls / toolResults`：当 turn 中所有工具调用与结果
- `exitReason`：当且仅当 agent_runner_loop 决定退出时非 null（结构与 GA 内部 `exit_reason` 一致：`{"result": "CURRENT_TASK_DONE" | "EXITED" | "MAX_TURNS_EXCEEDED", "data": ...}`）
- `responseContent`：完整 LLM 响应文本（含 thinking / summary 标签），用于 desktop 自行解析展示
- `telemetry`：可选。只在带 `exitReason` 的 final `turn_end` 上发送，用于最终回答 footer。字段均可缺失：`elapsedMs`、`inputTokens`、`outputTokens`、`cacheCreateTokens`、`cacheReadTokens`、`requestCount`、`contextUsedChars`、`contextLimitChars`。Managed GA 可通过 Galley-owned runtime hook 统计 token；external GA 不安装 token hook，只做 elapsed 与只读 context snapshot 的 best-effort 降级。

### 4.7a `turn_progress`

LLM 流式 partial output。Bridge 启动时设 `agent.inc_out = True`，订阅 GA 的 `display_queue`（`agentmain.put_task` 返回的 queue），每个 partial chunk 转 IPC 事件。Desktop 累积成 `inFlightContent` 实时渲染。`turn_progress.delta` 的粒度是 GA display_queue chunk，不是 token-level 合约；GUI 可以在本地做 typewriter 平滑，调用方不能用它推断 token rate。

```json
{
  "kind": "turn_progress",
  "sessionId": "sess_abc123",
  "delta": "I'll start by reading",
  "source": "workbench",
  "timestamp": "..."
}
```

字段说明：
- `delta`：本次 push 的**增量文本**（不是 full snapshot，也不保证是一枚 token），desktop 端 append 到 inFlightContent
- `source`：GA 的 source 字段（`"workbench"` / `"system"` 等）

注意：

- `delta` 是 **GA-raw**——含 `<thinking>` / `<summary>` / `<tool_use>` / `<file_content>` 等 GA 内部 tag。Desktop 在渲染时 strip（且要 robust 处理 partial 状态下的不完整 tag）
- `turn_progress` 跨多个 GA turn（一个 task 一个 LLM stream），不带 `turnIndex`——GUI 通过最近的 `turn_start` 关联当前步骤；第一步的 `turn_start(1)` 应先于普通 user task 的首个可见 `turn_progress`
- 一个 task 完成后 GA push `{'done': full_text}` 到 display_queue，bridge **不**转此为 IPC（`turn_end` 已经覆盖 finalized state，`done` 转 IPC 会产生重复信号）
- 拉队列 thread 是 daemon，每 task 一次。`shutdown_event` 触发时退出

### 4.8 `ask_user`

agent 主动调用 `ask_user` 工具时发出。bridge 此时 agent_runner_loop 已 `should_exit=True` 退出，等待 desktop 回 `ask_user_response` 后用 `user_message` 重新发起。

```json
{
  "kind": "ask_user",
  "sessionId": "sess_abc123",
  "question": "你希望删除整个目录还是仅清理 .pyc 文件？",
  "candidates": ["删除整个目录", "仅清理 .pyc"],
  "timestamp": "..."
}
```

`candidates` 可为空数组（开放式问题）。

### 4.9 `run_complete`

一次 user_message 的完整运行结束（agent_runner_loop 返回）。

```json
{
  "kind": "run_complete",
  "sessionId": "sess_abc123",
  "exitReason": { "result": "CURRENT_TASK_DONE", "data": null },
  "finalContent": "（清理后的最终回答 markdown）",
  "totalTurns": 3,
  "timestamp": "..."
}
```

`exitReason.result` 取值：
- `"CURRENT_TASK_DONE"`：正常完成
- `"EXITED"`：agent 主动 should_exit（如 ask_user）
- `"MAX_TURNS_EXCEEDED"`：达到 max_turns 上限
- `"ABORTED"`：用户主动 abort（bridge 自定义状态，非 GA 原生）

### 4.10 `error`

非致命错误（bridge 仍可继续）。

```json
{
  "kind": "error",
  "sessionId": "sess_abc123",
  "message": "Authentication failed: invalid api_key",
  "category": "runtime",
  "severity": "error",
  "retryable": true,
  "hint": "check_llm_config",
  "context": "user_message",
  "traceback": "...",
  "timestamp": "..."
}
```

字段说明：

- `message`：用户可读的错误简要（一句话，≤200 字符）
- `category`：`"bridge" | "runtime" | "business"` —— 决定 desktop 显示位置
  - `"bridge"`：bridge 自身故障（IPC 协议 mismatch、handler 崩溃）→ desktop 渲染为 toast
  - `"runtime"`：GA / LLM / tool 执行错误 → desktop 渲染为 conversation inline message bubble
  - `"business"`：Galley 业务错误（attach 路径非法、SQLite 损坏、历史恢复失败）→ desktop 渲染为 toast
- `severity`：`"error" | "warning" | "info"` —— 决定颜色与 icon（详见 DESIGN.md §6.2）
- `retryable`：是否值得让用户重试。`true` 时 desktop 显示 Retry button；点击 = 触发新的 `user_message`（参数复用上次）。**bridge 自身不主动 retry**
- `hint`：可选；bridge 端检测错误类型后给出的引导线索，desktop 用于渲染专用引导卡片：
  - `"check_llm_config"`：LLM 认证 / 配置类错误（401/403/`api_key`/`unauthorized` 关键字命中）
  - `"network"`：网络层错误（超时、DNS、connection refused）
  - `"quota_exceeded"`：API 配额耗尽（429 / quota 关键字）
  - 未命中分类时省略此字段
- `context`：错误发生时正在处理的命令名或阶段（debug 用）
- `traceback`：完整 Python traceback（power user / debug 用，desktop 默认折叠）

**为什么 bridge 给结构化字段而不是 desktop 推断**：bridge 离异常源最近，分类最准；desktop 做字符串模式匹配是反模式，新增错误类型时容易漏判。一致原则：bridge 是 truth，desktop 是 view。

**hint 的产品意义**：普通用户看到原始错误（"401 Unauthorized"）不知道下一步。bridge 把"哪里出错"翻译成"怎么解决"是 Galley 比裸跑 GA 增值的关键点。

致命错误：bridge 直接 exit，desktop 通过 stdout EOF + 进程退出码感知。

### 4.11 `history_loaded`

`load_history` 命令完成的响应。

```json
{
  "kind": "history_loaded",
  "sessionId": "sess_abc123",
  "messageCount": 12,
  "timestamp": "..."
}
```

### 4.12 `llm_changed`

`set_llm` 命令完成后发出。bridge 调用 `agent.next_llm(index)` 后立即 emit。

```json
{
  "kind": "llm_changed",
  "sessionId": "sess_abc123",
  "index": 1,
  "name": "ClaudeSession/claude-sonnet-4-6",
  "displayName": "ClaudeSession/claude-sonnet-4-6",
  "timestamp": "..."
}
```

GA 在切换时会把 `backend.history` 从旧 client 复制到新 client，**对话上下文不丢**。desktop UI 应在收到此事件后更新 LLM 选择器显示并解除 dropdown 的 disabled 状态。

### 4.13 `tools_reinjected`

`reinject_tools` 命令完成后发出。bridge 已读取 GA `assets/tool_usable_history.json` 并把其中的工具定义 blocks append 到 `backend.history`。

```json
{
  "kind": "tools_reinjected",
  "sessionId": "sess_abc123",
  "blocksAdded": 12,
  "timestamp": "..."
}
```

字段说明：
- `blocksAdded`：实际添加到 history 的 entry 数（每个 entry 对应一个工具定义 block）

失败情况走 `error` 事件（如 GA assets 路径不存在、JSON parse 失败、history 写入失败），并标 `context: "reinject_tools"`。

### 4.14 `pet_attached`

`attach_pet` 命令成功后发出。Bridge 已 spawn `<ga_path>/frontends/desktop_pet_v2.pyw` 子进程并在该 session 的 agent 上注册了 `_turn_end_hooks['galley_pet_{sessionId}']`。

```json
{
  "kind": "pet_attached",
  "sessionId": "sess_abc123",
  "port": 41983,
  "timestamp": "..."
}
```

desktop 收到后把 store 顶层 `petAttachedSessionId` 标为该 session id；TopBar `⋯` 菜单的 Desktop Pet 项变成"已附着"状态。

### 4.15 `pet_detached`

`detach_pet` 命令完成后发出，或在 bridge 收到 `shutdown` 时主动清理 pet 进程也会 emit（除非走 silent 路径）。

```json
{
  "kind": "pet_detached",
  "sessionId": "sess_abc123",
  "timestamp": "..."
}
```

bridge 已终止 pet 子进程 + 解除 `_turn_end_hooks` 中对应 entry。

### 4.16 `system_message`

非 `agent_runner_loop` 路径产生的对话消息——GA 的 slash command 处理器（当前：`/btw <question>` 走 `btw_cmd.py` monkey-patch；未来：`/session.x=v`、`/resume` 等）会直接把回复 push 到 `display_queue` 并标记 `source='system'`。bridge drain 检测到 `source='system'` 的 `done` 时翻译为本事件。

```json
{
  "kind": "system_message",
  "sessionId": "sess_abc123",
  "content": "> 🟡 /btw 当前进度如何？\n\n基于已有对话，agent 正在读取 ga.py 第二批...\n\n*(2.3s)*",
  "variant": "side_question",
  "timestamp": "..."
}
```

`content` 是 markdown source；desktop 走同一套 markdown 渲染（与 agent final answer 一致），但外层套一个 callout chrome 跟 agent turn 视觉区分。

`variant` 枚举：
- `"side_question"`：`/btw` 答案，黄色 callout（跟 AskUserBubble 同色家族）
- `"system"`（默认）：catch-all，简单 muted 行

### 4.17 `plan_update`

GA plan mode 状态快照。GA 由模型自主进入 plan mode（`plan_sop.md` →
`handler.enter_plan_mode(path)`）；Galley 不提供开启入口，只观察。bridge 在每个
turn_end 时通过 `runner/plan_watch.py` 只读探测（GA `frontends/plan_state.py`
公开 API + `working['in_plan_mode']`，均为已记录的只读耦合点），状态有变化才
emit——连续相同快照去重，退出时发一次 `active: false` 收尾事件。

```json
{
  "kind": "plan_update",
  "sessionId": "sess_abc123",
  "active": true,
  "placeholder": false,
  "done": 2,
  "total": 5,
  "complete": false,
  "step": "引入版本化快照结构",
  "pathHint": "plan_x/plan.md",
  "items": [
    { "content": "梳理现有恢复路径", "status": "done" },
    { "content": "引入版本化快照结构", "status": "open" }
  ],
  "timestamp": "..."
}
```

字段说明：

- `active`：plan mode 是否活跃。`false` 是一次性收尾信号（GA 在 checklist
  清零后自动退出），desktop 收到后移除进度条
- `placeholder`：plan mode 已进入但 plan.md 还没有可解析的 checklist（agent
  正在写计划）。此时 `total = 0`，desktop 显示 `pathHint` + "制定计划中"
- `done` / `total` / `complete`：checklist 进度（`[✓]` 数 / 总数 / 是否全完成）
- `step`：最近一次 `📌 当前步骤：…` 摘要（≤60 字符），可为空
- `pathHint`：plan 路径末两段（如 `plan_x/plan.md`），不含绝对路径
- `items`：checklist 条目，`status` 为 `"open" | "done"`，上限 100 条

外部 GA 检出版本没有 `plan_state.py` 时该事件永不发出（功能静默关闭）。

## 5. Commands (workbench → bridge)

每个命令必有 `kind` 字段。

### 5.1 `user_message`

发送用户消息，触发 agent_runner_loop。

```json
{
  "kind": "user_message",
  "text": "帮我读 agentmain.py 看下结构",
  "images": []
}
```

`images` 是本地文件绝对路径数组（V0.1 可空）。

### 5.2 `approval_response`

响应 `tool_call_pending`。

```json
{
  "kind": "approval_response",
  "approvalId": "appr_xyz789",
  "decision": "allow_once"
}
```

`decision` 取值：
- `"allow_once"`：仅本次通过
- `"deny"`：拒绝，bridge 让工具调用 short-circuit 返回 denied 状态
- `"always_allow_project"`：本次通过 + 在当前 Project（含 Unfiled）规则缓存中记录
- `"always_allow_global"`：本次通过 + 在全局规则缓存中记录

**always_allow 规则的存储**：bridge 不持久化任何规则。规则由 desktop 维护并在 `tool_call_pending` 之前通过 `set_approval_rules` 命令同步给 bridge（见 5.6）。这样 bridge 在新 session 启动时即可知道"哪些工具已经永久通过"，避免每次都先 emit pending 再问 desktop。

### 5.3 `ask_user_response`

响应 `ask_user` 事件。bridge 收到后会用此文本作为下一次 `user_message` 的内容触发新的 agent_runner_loop。

```json
{
  "kind": "ask_user_response",
  "text": "仅清理 .pyc"
}
```

### 5.4 `abort`

中止当前运行。bridge 调 `agent.abort()`，agent_runner_loop 退出，发 `run_complete` 含 `exitReason.result = "ABORTED"`。

```json
{ "kind": "abort" }
```

### 5.5 `load_history`

注入历史会话上下文。**只能在 ready 之后、第一个 user_message 之前调用**。注入到 `client.backend.history`。

```json
{
  "kind": "load_history",
  "messages": [
    {
      "role": "user",
      "content": "...",
      "toolCalls": [],
      "toolResults": []
    },
    {
      "role": "assistant",
      "content": "...",
      "toolCalls": [...],
      "toolResults": [...]
    }
  ]
}
```

`messages` 顺序与历史一致；bridge 直接构造对应的 GA history 结构注入。完成后回 `history_loaded`。

### 5.6 `set_approval_rules`

同步 desktop 维护的 always_allow 规则到 bridge。可在任意时刻调用，立即生效。

```json
{
  "kind": "set_approval_rules",
  "alwaysAllowGlobal": ["file_patch"],
  "alwaysAllowProject": ["code_run"]
}
```

bridge 在 `tool_call_pending` 之前先查这两个列表，命中则跳过审批直接放行（仍 emit `tool_call_start` / `tool_call_end`，但**不** emit `tool_call_pending`）。

注意：高敏感工具（V0.1 列表：`start_long_term_update`）不应进入 `alwaysAllowGlobal`；desktop UI 层禁用此选项，bridge 不强制校验。

### 5.7 `set_yolo_mode`

打开或关闭自动执行模式。可在任意时刻调用，立即生效。

> 命名注记：`yolo` 仅为 wire / 内部标识符（契约稳定，不随文案改）。用户侧
> 自 2026-07-20 起称「自动执行 / 逐步审批」，per-session 覆盖 + app 级默认
> （sessions 表 `approval_mode` 列；desktop 控件为 Composer LLM pill 的
> popover，无独立控件、无 TopBar 徽章）。见 devlog 2026-07-20。

```json
{
  "kind": "set_yolo_mode",
  "enabled": true
}
```

bridge 收到后更新 `SessionState.yolo_mode`。下一个 tool dispatch 时 `WorkbenchHandler.needs_approval` 第一行检查此 flag——为真则直接放行（不 emit `tool_call_pending`，仍 emit `tool_call_start` / `tool_call_end`）。

**spawn 后同步**：bridge 默认 `yolo_mode = false`（逐步审批）。desktop 在收到 `ready` 事件时解析该会话的有效审批模式（per-session 覆盖值，否则 app 级默认，`effectiveApprovalMode`），若为自动执行则立即 `set_yolo_mode { enabled: true }` 同步给 bridge。命令队列保证 spawn 后第一个 user message 之前模式已生效。失败方向安全：同步丢失时 bridge 停留在逐步审批（多弹审批，绝不少弹）。

**与 always_allow 的关系**：自动执行是上位优先级——开启时 `always_allow_global` / `always_allow_project` 列表不再起作用（也无意义，反正全跳）。bridge 在 `needs_approval` 中先检查 yolo flag，再依次检查 approval_tools / always_allow。两个 state 独立，切回逐步审批不会清空 always_allow。

### 5.8 `set_llm`

切换当前 session 使用的 LLM。bridge 调 `agent.next_llm(llmIndex)` 后立即 emit `llm_changed`。

```json
{
  "kind": "set_llm",
  "llmIndex": 2
}
```

约束：

- 只能在 agent **idle** 时切换。`running` / `waiting_approval` 状态下，desktop UI 应禁用切换器；如果 bridge 在非 idle 时收到 `set_llm`，emit `error` 不切换
- `llmIndex` 必须在 `availableLLMs` 范围内；越界则 emit `error`
- 切换会让 GA 把 `backend.history` 从旧 client 复制到新 client，对话上下文保留

### 5.9 `shutdown`

请求 bridge 优雅退出。bridge 等当前 turn 完成（如有）后 `exit(0)`。

```json
{ "kind": "shutdown" }
```

### 5.10 `reinject_tools`

重新把 GA 的工具定义注入到当前 session 的 LLM history。对应 GA 官方前端 `stapp.py` 的 "Reinject Tools" 按钮——长 session 跑久了 agent 对工具的认知漂移时使用。

```json
{ "kind": "reinject_tools" }
```

Bridge 行为：

1. 读取 `<ga_path>/assets/tool_usable_history.json`（**non-invasive 第 §"关于读取" 条款允许的 read-only 操作**，路径是 coupling point，GA baseline 升级时审计）
2. 解析为 history blocks 列表
3. 重置 `agent.llmclient.last_tools = ""`（让 GA 下次 prompt 重建工具 block）
4. `agent.llmclient.backend.history.extend(blocks)`
5. emit `tools_reinjected { blocksAdded: N }`

错误场景：assets 路径不存在 / JSON 解析失败 / history 写入失败 → 走 `error` 事件，`context: "reinject_tools"`。

### 5.11 `attach_pet`

启动 GA 的桌面宠物子进程 + 注册 turn_end hook 把进展实时推送给宠物。

```json
{
  "kind": "attach_pet",
  "port": 41983
}
```

字段说明：
- `port`：宠物子进程绑定的本地 HTTP 端口。GA 默认 41983，跟 `stapp.py` 同。**只能同时跑一个**（pet 绑定固定端口）

Bridge 行为：

1. 如已有 pet 在跑，先 silent detach
2. 在 `<ga_path>/frontends/desktop_pet_v2.pyw`（fallback `desktop_pet.pyw`）spawn 子进程
3. 注册 `agent._turn_end_hooks[f"galley_pet_{sessionId}"]`——每个 turn_end 用 `urllib.request.urlopen` POST 进展到 `http://127.0.0.1:{port}/?msg=...`
4. emit `pet_attached { port }`

Sticky-B 行为：pet 绑定到点击 attach 时的 session，之后切换 active session **不会**重新 attach。要换 session 上的 pet，必须先 detach 再在新 session 上 attach。

错误场景：pet 脚本不存在 / subprocess.Popen 失败 → emit `error`，`context: "attach_pet"`。

### 5.12 `detach_pet`

终止 pet 子进程 + 解除 turn_end hook。无论之前是否有 pet 在跑都安全调用（detach 一个不存在的 pet 是 no-op）。

```json
{ "kind": "detach_pet" }
```

Bridge 行为：
1. 从 `agent._turn_end_hooks` 删除对应 entry
2. 对 pet subprocess 调 `terminate()` + `wait(timeout=1.0)` + fallback `kill()`
3. emit `pet_detached`（除非走 silent 路径）

`shutdown` 命令路径下 bridge 自动调用 `_handle_detach_pet(silent=True)`，避免 pet 进程随 bridge 死后变 orphan。

## 6. Approval Flow（端到端示例）

agent 决定调用 `code_run`：

```
bridge:   { kind: "turn_start", turnIndex: 2 }
bridge:   { kind: "tool_call_pending", approvalId: "a1", toolName: "code_run", args: {...}, riskLevel: "high" }
          (bridge generator 阻塞)
desktop:  显示 Approval Card
user:     点击 "Allow once"
desktop:  { kind: "approval_response", approvalId: "a1", decision: "allow_once" }
bridge:   (generator 恢复，调用 super().dispatch())
bridge:   { kind: "tool_call_start", toolCallId: "tc1", toolName: "code_run", ... }
bridge:   { kind: "tool_call_progress", text: "[Action] Running python..." }
bridge:   { kind: "tool_call_end", toolCallId: "tc1", status: "success", resultPreview: "..." }
bridge:   { kind: "turn_end", turnIndex: 2, summary: "...", toolCalls: [...], toolResults: [...] }
```

如用户选 `deny`：

```
desktop:  { kind: "approval_response", approvalId: "a1", decision: "deny" }
bridge:   (generator 恢复，short-circuit；不调用真实 tool method)
bridge:   { kind: "tool_call_end", toolCallId: "tc1", status: "denied", resultPreview: "User denied this action" }
bridge:   { kind: "turn_end", ... }   (agent 收到 denied 状态，下一轮决定如何应对)
```

## 7. Session Resume Flow

```
spawn bridge with sessionId="sess_old"
bridge:   { kind: "ready", ... }
desktop:  { kind: "set_approval_rules", ... }
desktop:  { kind: "load_history", messages: [...] }
bridge:   { kind: "history_loaded", messageCount: 12 }
desktop:  { kind: "user_message", text: "继续之前的话题" }
          (agent_runner_loop 启动，client.backend.history 已含 12 条历史)
bridge:   { kind: "turn_start", ... }
          ...
```

## 8. Error Handling

| 场景 | bridge 行为 | desktop 行为 |
|---|---|---|
| 字段缺失 / 类型错误 | emit `error`，丢弃命令 | 显示错误，不重试 |
| 协议版本不匹配 | （ready 后 desktop 检查） | 立即 `shutdown` |
| GA import 失败 | emit `error` 后 exit(1) | 标记 session error |
| LLM 调用失败 | 由 GA agent 内部处理；可能 emit 多个 `error` | 透传给用户 |
| bridge 进程崩溃 | stdout EOF + exit code != 0 | 标记 session error，可选重启 |
| 用户 close session | 发 `shutdown` | 等 stdout EOF + reap |

## 9. Versioning

- 当前版本：`0.1`
- 不兼容变更必须升 minor 版本号（`0.1` → `0.2`）
- desktop 与 bridge 版本不匹配 → desktop 主动 shutdown
- 兼容性变更（仅新增可选字段）可保持版本号

## 10. Open Items（实现阶段确认）

- [x] **`load_history` messages 数据结构** — 已 e2e 验证：`NativeClaudeSession` 的 `backend.history` 是 `[{role, content: [{type:"text", text:str}, ...]}]`（Anthropic native messages 格式）。string content → native blocks 的适配自 2026-07-11 起住在 `runner/ga_session.py`（`set_history` / `message_to_content_blocks`，GA 集成缝的一部分）。**未验证**：`NativeOAISession` / `ClaudeSession` / `LLMSession` / `MixinSession` 的 history 形态可能不同，需要对应 adapter——对这些后端 `set_history` 会照写并发出响亮 warning（而非静默），见 PRD §10。当前只在 `NativeClaudeSession` 下保证恢复语义。
- [ ] `tool_call_progress` 字符串解析规则（GA 当前 yield 的 emoji 前缀格式）需在 runner 实现时记录到 `runner/handlers.py` 注释，避免 GA 升级时格式变化无人知晓 — V0.1 暂不实现 progress 事件，turn_end 已含完整 toolCalls/toolResults
- [ ] images 字段的传递路径（user_message → GA put_task）需在 bridge 验证可行 — bridge 已通过 `images=cmd.images` 透传到 `agent.put_task`，但实际多模态调用未 e2e 验证
- [x] **`abort` 路径** — GA 的 `abort()` 设 `stop_sig` 让 worker 跳出循环，但**不**触发 `turn_end_callback`。bridge 在 `dispatch_command` 收到 `AbortCommand` 时主动合成 `RunCompleteEvent` with `exitReason.result = "ABORTED"`。e2e 已验证。
- [x] **`error` 事件结构化字段** — `category` / `severity` / `retryable` / `hint` 四字段在 v0.1 落地（见 §4.10）。runner 端 LLM 调用错误的 hint 推断逻辑见 `runner/workbench_bridge.py` 的 `_classify_error`。
- [ ] **`file_patch` Approval Card diff 视图** — desktop 端用 `@pierre/diffs` 渲染。args 字典已含 `path` / `old_content` / `new_content` 三元组（GA 原生 signature），bridge 不需要额外处理；ToolCalled / tool_call_pending 事件结构无需扩展。Stage 2 desktop 实现时落地。
- [ ] **`file_write` 内容预览限制** — GA `do_file_write` 在 `dispatch` 之后才从 `response.content` 通过 `extract_robust_content` 提取实际内容；审批拦截时拿不到内容。V0.1 不做内容预览（违反 non-invasive 第 4 条）；V0.2+ 可考虑给 GA 上游提 PR 让 extract 前置。
