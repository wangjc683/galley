# B3 Rust emit event catalogue

> **状态**：M1 deliverable（2026-05-19）· B3 ship 后归档
>
> **用途**：B3 期间 Rust 端 (`core/src/runner_commands.rs` + 后续新增 emit 点) 需要 emit 给 GUI 的高层 domain events 的契约。M3-M6 实施时每个 slice 的 listener 严格按本文档实现，slice 不读 / 不解释 raw `runner-event`（保留作 forensics）。
>
> **设计原则（cross-cutting）**：
>
> - **Delta only**（[G4](./B3-store-slice.md#running-notes--gotchas)）—— `kind: "patched"` 携带 `fields: Partial<T>` 而非整个对象；arrays / nested 走专门 event。
> - **Domain events，不是 raw events** —— Rust 端 `spawn_emit_task` 解释 IpcEvent → 高层 domain event；GUI 只订阅 domain。
> - **Per-event 单一 slice subscriber** —— 每个 event 只一个 slice listen，避免跨 slice race。
> - **Batching 严格限定 streaming** —— 只 `messages-appended {kind: "inFlightDelta"}` 走 [16ms batch (AD-10/T1.6)](./b3-slice-adr.md#ad-10--已-resolved-字段回顾-t15-t17)；其它 event 不 batch（保证语义清晰）。
> - **Initial state 走 invoke**，不走 emit —— 每个 slice init 时 `invoke(query_command)` 拿 snapshot + 起 `listen(event)`。Rust 不 emit "initialized" 事件。
> - **Tauri emit channel 不保证顺序**（[G10](./B3-store-slice.md#running-notes--gotchas)）—— 同 channel 内顺序保证；跨 channel 容忍 reorder。同步关键状态在 Rust 端 atomic 完成后再 emit。

---

## 事件清单（5 新 + 3 沿用）

| Event name | Status | Subscriber slice | Batched? |
|---|---|---|---|
| `runner-event` | B2 沿用 | （forensics only，B3 后 GUI 不订阅） | No |
| `runner-malformed` | B2 沿用 | 同上 | No |
| `runner-closed` | B2 沿用 | runtimeStore（用于 onClose toast）| No |
| **`sessions-updated`** | B3 新 | sessionsStore | No |
| **`messages-appended`** | B3 新 | messagesStore | streaming delta only |
| **`projects-updated`** | B3 新 | sessionsStore | No |
| **`prefs-updated`** | B3 新 | prefsStore | No |
| **`runtime-updated`** | B3 新 | runtimeStore | No |

---

## 1 · `sessions-updated`

**Subscriber**: sessionsStore (M4 T4.3)

**Payload shape** (`core/src/ipc.rs` 镜像 `gui/src/types/ipc.ts`):

```ts
type SessionsUpdated =
  | { kind: "added"; session: SessionBrief }
  | { kind: "removed"; id: string }
  | { kind: "patched"; id: string; fields: Partial<SessionBriefMut> }
  | { kind: "bulk_patched"; ids: string[]; fields: Partial<SessionBriefMut> }

// SessionBriefMut: 可被 patch 的字段子集（id / created_at 不可变）
type SessionBriefMut = {
  title: string
  status: SessionStatus  // "idle" | "running" | "archived" | ...
  pinned: boolean
  has_unread: boolean
  last_activity_at: number   // unix ms
  turn_count: number
  summary: string | null
  project_id: string | null
  has_pending_ask_user: boolean   // 跨 slice mirror (来自 messagesStore 写入)
}
```

**Trigger 触发条件**：

| Rust 触发点 | 发什么 |
|---|---|
| `GalleyApi::create_session` 成功 | `{kind: "added", session}` |
| `GalleyApi::archive_session` / `rename_session` / `toggle_pin_session` / `update_session_last_activity` 成功 | `{kind: "patched", id, fields}` |
| `GalleyApi::delete_session_permanently` 成功 | `{kind: "removed", id}` |
| `GalleyApi::archive_sessions_bulk` / `unarchive_sessions_bulk` / `delete_sessions_permanently_bulk` 成功 | `{kind: "bulk_patched", ids, fields}` (single emit，避免 N 次刷屏) |
| RunnerManager 收到 `IpcEvent::TurnEnd` 持久化后 | `{kind: "patched", id, fields: {turn_count, last_activity_at, summary, status: "idle"}}` |
| RunnerManager 收到 `IpcEvent::AskUser` 后 | `{kind: "patched", id, fields: {has_pending_ask_user: true}}` |
| messagesStore 写入清除 askUser（user reply 发回）后 | `{kind: "patched", id, fields: {has_pending_ask_user: false}}` |

**Trait method 新增** (M4 T4.2 / G5)：

```rust
// core/src/api.rs
trait GalleyApi {
    // B2 已有: list_sessions / list_messages / send_message / ...
    async fn create_session(&self, args: CreateSessionArgs) -> Result<SessionBrief>;
    async fn archive_session(&self, id: &str) -> Result<()>;
    async fn unarchive_session(&self, id: &str) -> Result<()>;
    async fn rename_session(&self, id: &str, title: &str) -> Result<()>;
    async fn toggle_pin_session(&self, id: &str) -> Result<bool>;  // returns new pinned state
    async fn delete_session_permanently(&self, id: &str) -> Result<()>;
    async fn archive_sessions_bulk(&self, ids: &[String]) -> Result<()>;
    async fn unarchive_sessions_bulk(&self, ids: &[String]) -> Result<()>;
    async fn delete_sessions_permanently_bulk(&self, ids: &[String]) -> Result<()>;
    async fn empty_archive(&self) -> Result<u32>;  // returns count
    async fn assign_session_to_project(&self, sid: &str, pid: Option<&str>) -> Result<()>;
}
```

**[B3-I4 警示](./B3-store-slice.md#phase-invariants--b3-特有的硬规则)**: 这一批 trait method 是 B3 必加但**不算 B3 主路径**。如果 M4 启动时 trait 缺它们，**B3 退回 plan**：独立 commit 加 trait + impl + test，commit message 标 "Refactor: B3 prereq — sessions trait write methods"，然后续 B3。

**Sample payload**:
```json
{
  "kind": "patched",
  "id": "sess_abc123",
  "fields": {
    "title": "Debug fence filter",
    "turn_count": 3,
    "last_activity_at": 1716100000000,
    "summary": "第 3 步 · 修复 _FenceFilter 状态机的 chunk leak",
    "status": "idle"
  }
}
```

---

## 2 · `messages-appended`

**Subscriber**: messagesStore (M5 T5.2)

**Payload shape**:

```ts
type MessagesAppended = { sessionId: string } & (
  | { kind: "turn"; turn: AgentTurn | UserTurn | SystemTurn }
  | { kind: "approval"; approval: PendingApproval }
  | { kind: "approval_removed"; approvalId: string }
  | { kind: "approval_decision"; approvalId: string; decision: ApprovalDecision }
  | { kind: "ask_user"; askUser: PendingAskUser | null }
  | { kind: "in_flight_delta"; delta: string }  // [16ms batched]
  | { kind: "in_flight_clear" }
  | { kind: "agent_running"; value: boolean }
  | { kind: "current_turn_index"; index: number | null }
  | { kind: "user_submit_tick" }
  | { kind: "conversation_cleared" }
  | { kind: "restored"; turns: Turn[] }  // restoreSessionTurns 完成
)
```

**Trigger 触发条件**：

| Rust 触发点 | 发什么 |
|---|---|
| `GalleyApi::send_message` 持久化 user message 后 | `{kind: "turn", turn: <UserTurn>}` + `{kind: "user_submit_tick"}` + `{kind: "agent_running", value: true}` |
| `GalleyApi::send_side_question_message`（B3 加） | `{kind: "turn", turn: <UserTurn transient>}` + `{kind: "user_submit_tick"}`（不 set agent_running） |
| IpcEvent::TurnStart | `{kind: "current_turn_index", index}` |
| IpcEvent::Progress | `{kind: "in_flight_delta", delta}` (16ms batched) |
| IpcEvent::TurnEnd 持久化 assistant row 后 | `{kind: "turn", turn: <AgentTurn>}` + `{kind: "in_flight_clear"}` + `{kind: "current_turn_index", index: null}` |
| IpcEvent::RunComplete | `{kind: "agent_running", value: false}` |
| IpcEvent::ApprovalRequest | `{kind: "approval", approval}` |
| RunnerManager dispatch approval（GUI/CLI invoke approve/reject）| `{kind: "approval_removed", approvalId}` + `{kind: "approval_decision", approvalId, decision}` |
| IpcEvent::AskUser | `{kind: "ask_user", askUser}` |
| GUI/CLI 写 askUser reply | `{kind: "ask_user", askUser: null}` |
| IpcEvent::SystemMessage（/btw response） | `{kind: "turn", turn: <SystemTurn>}` |
| `GalleyApi::restore_session_turns` 完成 | `{kind: "restored", turns}` |
| `clear_conversation` 命令 | `{kind: "conversation_cleared"}` |

**Batching for `in_flight_delta`**：

Rust 端在 `spawn_emit_task` 内为每 session 维护 16ms accumulator：

```rust
struct DeltaAccumulator {
    buf: String,
    deadline: Option<Instant>,
}

// 收到 IpcEvent::Progress { delta }:
//   1. accumulator.buf.push_str(&delta)
//   2. accumulator.deadline.get_or_insert_with(|| Instant::now() + Duration::from_millis(16))
//   3. spawn 一个 timer task (或 tokio::select! with Sleep)，到 deadline 时 emit 整个 buf + reset
```

实测 fallback（per [AD-10 T1.6 caveat](./b3-slice-adr.md#t16--event-batch-window--16ms-单帧)）：若 dogfood 实测 batch 收益 < 5%，把 16ms 拉到 32ms 或干脆 unbatched，**改值不改 schema**。

**Sample payload**:
```json
{
  "sessionId": "sess_abc123",
  "kind": "in_flight_delta",
  "delta": "我会用 itertools.accumulate 实现..."
}
```

---

## 3 · `projects-updated`

**Subscriber**: sessionsStore (M4 T4.6)

**Payload shape**:

```ts
type ProjectsUpdated =
  | { kind: "added"; project: ProjectBrief }
  | { kind: "removed"; id: string }
  | { kind: "patched"; id: string; fields: Partial<ProjectBriefMut> }

type ProjectBriefMut = {
  name: string
  root_path: string | null     // 字段保留但 not wired to bridge cwd (devlog 2026-05-14)
  pinned: boolean
}
```

**Trigger**：`GalleyApi::create_project` / `update_project` / `delete_project` 各对应 add / patched / removed。

**Trait method 新增** (M4 T4.6 / G5)：

```rust
trait GalleyApi {
    // ...
    async fn create_project(&self, input: CreateProjectInput) -> Result<ProjectBrief>;
    async fn update_project(&self, id: &str, partial: UpdateProjectInput) -> Result<()>;
    async fn delete_project(&self, id: &str) -> Result<()>;
}
```

**Sample payload**:
```json
{
  "kind": "added",
  "project": { "id": "proj_xyz", "name": "Galley", "root_path": null, "pinned": false }
}
```

---

## 4 · `prefs-updated`

**Subscriber**: prefsStore (M6 T6.3) · 触发频率极低（用户调 Settings 才动）

**Payload shape**:

```ts
type PrefsUpdated = {
  key: string         // "ga_config" | "approval_config" | "yolo_mode" | "yolo_intro_seen" | "conversation_width" | ...
  value: unknown      // JSON 值，对应 key 的 schema
}
```

**Trigger**：每次 `GalleyApi::set_pref(key, value)` 成功后 emit。

**特殊副作用 (AD-08)**：当 `key == "ga_config"` 且 `python` / `gaPath` / `useExternalPython` 任一变了时，runtimeStore 的 listener 检测后 reset 私有 `_warmupComplete: false` 并触发新的 warmup —— 这是 prefs → runtime 唯一 cross-slice listener（[AD-09 DAG](./b3-slice-adr.md#ad-09--slice-dependency-dagt18) hot edge）。

**Trait method 新增** (M6 T6.2)：

```rust
trait GalleyApi {
    // ...
    async fn set_pref(&self, key: &str, value: serde_json::Value) -> Result<()>;
    async fn get_pref(&self, key: &str) -> Result<Option<serde_json::Value>>;
    async fn get_all_prefs(&self) -> Result<HashMap<String, serde_json::Value>>;
}
```

**Sample payload**:
```json
{ "key": "yolo_mode", "value": false }
```

---

## 5 · `runtime-updated`

**Subscriber**: runtimeStore (M3 T3.3-T3.4)

**Payload shape**:

```ts
type RuntimeUpdated = {
  sessionId: string
  fields: Partial<{
    bridgeStatus: BridgeStatus
    bridgeError: string | null
    bridgePid: number | null
    llms: LLMOption[]              // 整体 replace（list 不 patch，长度 1-10 不算大）
    llmDisplayName: string
  }>
}
```

**Trigger 触发条件**：

| Rust 触发点 | emit fields |
|---|---|
| RunnerManager.spawn → 进程起来 | `{bridgeStatus: "connecting", bridgePid}` |
| IpcEvent::Ready | `{bridgeStatus: "ready", llms: ev.availableLLMs, llmDisplayName: ev.currentLLM}` |
| IpcEvent::LLMChanged | `{llmDisplayName, llms}`（list refresh 顺手刷） |
| Spawn 失败 (RunnerSpawnError) | `{bridgeStatus: "error", bridgeError}` |
| `runner-closed` 同步 emit | `{bridgeStatus: "closed", bridgePid: null}` |
| LRU eviction 触发 | `{bridgeStatus: "sleeping"}`（M3 T3.5 复核：要不要单独 status 还是 closed？） |

**关键设计**：`runtime-updated` 是 `runner-event` 的**派生**而非平行。Rust spawn_emit_task 内：
1. 收到原始 `IpcEvent` → 内部分发：
   - emit `runner-event`（forensics，B3 后 GUI 可能不订阅）
   - emit `runtime-updated`（runtimeStore 用）
   - emit `messages-appended`（messagesStore 用）
   - emit `sessions-updated`（lastActivity 等会触发）

2. 三个 emit 是**串行**完成（同 sync 帧内），保证 runtimeStore 看到 bridgeStatus=ready 跟 messagesStore 看到 in_flight_clear 不会矛盾。

**Sample payload**:
```json
{
  "sessionId": "sess_abc123",
  "fields": {
    "bridgeStatus": "ready",
    "bridgePid": 12345,
    "llms": [{"index": 0, "name": "claude-opus-4-7", "isCurrent": true}],
    "llmDisplayName": "claude-opus-4-7"
  }
}
```

---

## Emit ordering 保证

跨 channel 不保证 reorder（G10），但**同 IpcEvent 触发的多 emit 是串行 sync 完成**，所以：

- 同 channel（同一 event name）内顺序保证：例如 messages-appended 的多个 kind 严格按 emit 顺序到达
- 跨 channel 容忍 reorder：runtime-updated `{bridgeStatus: "ready"}` 跟 messages-appended `{kind: "agent_running", value: false}` 可能 reorder 到达 GUI

**Mitigation pattern**：
- slice 内 listener 是 idempotent reducer（按 event 顺序 reconcile，不依赖跨 slice 同步）
- 跨 slice 关联状态用 store-side enrichment 物化（如 sessions.has_pending_ask_user 是 messages 状态的 mirror，通过 sessions-updated emit 同步而非 sessions 跨订阅 messages）

---

## Initial state contract

每个 slice init 时**不靠 emit 拿初始状态**。pattern：

```ts
// pseudo-code
async function initSessionsStore() {
  const sessions = await invoke("list_sessions")     // 现有 B1 read method
  const projects = await invoke("list_projects")     // M4 新加 trait method
  set({ sessions, projects, hydrated: true })
  await listen<SessionsUpdated>("sessions-updated", handleSessionsUpdated)
  await listen<ProjectsUpdated>("projects-updated", handleProjectsUpdated)
}
```

**约束**：
- `invoke + listen` 之间有微小竞态窗口（< 50ms），可能漏 update。**容忍**：B3 不引入复杂的 "subscribe before query" 协议；M2-M6 dogfood 不发现实际问题就保持简单。如发现 race，加 `subscribe + replay since invoke timestamp` 复杂度（Rust 端 emit broadcast 改 ring buffer），但**不建议** —— 单 user 场景下窗口太短

---

## Migration sequence（M3 → M6 期间 Rust 端 emit task 增量）

| Milestone | spawn_emit_task 内增量 emit |
|---|---|
| M3 (runtime) | 加 `runtime-updated` emit（IpcEvent::Ready / LLMChanged / spawn-error） |
| M4 (sessions + projects) | 加 `sessions-updated` emit（CRUD + IpcEvent::TurnEnd lastActivity / has_pending_ask_user mirror）+ `projects-updated` |
| M5 (messages) | 加 `messages-appended` emit（IpcEvent::Progress + TurnEnd + Approval + AskUser + SystemMessage）+ 16ms batch 实施 |
| M6 (prefs) | 加 `prefs-updated` emit（set_pref command 内） |

**每 milestone Rust 端独立 commit**：emit 增量是「Rust 端纯加 emit，不动 slice logic」，应该是单测可断言的 ([B3-I4](./B3-store-slice.md#phase-invariants--b3-特有的硬规则) 警示) —— 若需要改 Rust 端 trait / IpcEvent 解释逻辑，停下来独立 commit 不混进 B3 slice commit。

---

## Test 落地建议

每个新 event 在 Rust 端 emit 路径加 unit test：

```rust
#[tokio::test]
async fn turn_end_emits_sessions_updated_with_last_activity() {
    let (api, _harness) = setup_in_memory_galley().await;
    let mut events = subscribe::<SessionsUpdated>("sessions-updated");
    let sid = api.create_session(...).await.unwrap();
    emit_turn_end(&api, &sid, ...).await;
    let ev = events.recv().await.unwrap();
    assert!(matches!(ev, SessionsUpdated::Patched { fields, .. } if fields.last_activity_at.is_some()));
}
```

测试不要做端到端 GUI 验证（B3 GUI 部分单独跑 dogfood scenarios）；Rust 端只验证 **emit 触发条件 + payload shape**。

---

## End of emit catalogue
