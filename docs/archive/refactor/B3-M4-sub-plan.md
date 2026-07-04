# B3 M4 · sessionsStore 抽离 + Rust trait method 实施 sub-plan

> 用途：B3 playbook M4 启动前的详细实施 plan，mirror [M3 sub-plan](./B3-M3-sub-plan.md) 结构。M4 是 B3 第一个 **必须动 Rust 端** 的 milestone — 18 个 session/project CRUD trait method 是 frontend 抽离的前置依赖（[playbook G5](./B3-store-slice.md#running-notes--gotchas) 警示「Rust trait method 加法独立 commit 不混 frontend」）。
>
> **状态**：drafting 2026-05-19。本 session ship M4 sub-plan + M4a Rust trait method 两个独立 commit；M4b 前端 sessionsStore 抽离推到下次 fresh session（per N5 教训：单 session 不堆 mega-commit）。
>
> **路径切分一锤定音**：M4 拆 **M4a (Rust trait + tests)** + **M4b (frontend sessionsStore 抽离)** 两个 milestone，中间 1 天 dogfood。M4a 在 Rust 内自包含可独立 ship + 不动前端 = 风险敞口约束在 Rust 编译 + cargo test 覆盖面内；M4b 才动 useAppStore 拆分。

---

## 1. Scope re-assessment vs playbook

| Playbook claim | 实际验证 |
|---|---|
| T4.2「trait 必须有 create_session / archive_session / delete_session / rename_session / update_session_pinned / 等」给出**部分**列表 | 实际全量是 **16 个** session 操作 + project 操作（playbook 写「18」是粗估，本 plan 收敛精确数）|
| 每个 action 一个 trait method | **bulk variants 不能展开成 single trait 循环调用** — Tauri IPC roundtrip cost × N 不可接受，GUI EarlierDialog/ArchivedDialog 一次批量 archive 30 session 走 30 trip 会肉眼可感卡顿。bulk method 作 first-class trait surface |
| T4.4「迁 setActiveSession / createSession / activateSession / bumpSessionAfterTurn」 | `setActiveSession` 是**纯 in-memory display state operation**（active id 不持久化、不是 source of truth、frontend 是 authoritative），**不需要 trait method**；`activateSession` 是 frontend orchestrator（spawn bridge + restoreTurns + setActiveSession），同样不需要 trait method。**M4a trait 只覆盖 DB 写路径**，display state operations 是 M4b frontend-only |
| T4.7「迁 emptyArchive」单独列出 | `emptyArchive` 当前实现是 frontend loop 调 deleteSessionPermanently — **bulk_delete_sessions** 已 cover 它，frontend orchestrator 改 `bulk_delete_sessions(ids of all archived)` |

**T4 真实 trait surface（M4a scope）**：

### Sessions (12 method)

| Trait method | Frontend caller(s) | DB 写 | 备注 |
|---|---|---|---|
| `create_session(input, origin) -> SessionBrief` | `createSession` | INSERT sessions | input 含 title / projectId / llm_index / display_name |
| `archive_session(id, origin)` | `archiveSession` | UPDATE status='archived', updated_at | |
| `unarchive_session(id, origin)` | `unarchiveSession` | UPDATE status='idle', updated_at | |
| `rename_session(id, title, origin)` | `renameSession` | UPDATE title, updated_at | server-side trim + 空 fallback `新对话` |
| `set_session_pinned(id, pinned, origin)` | `togglePinSession` | UPDATE pinned, updated_at | server-side reject if status='archived'（archived 不让 pin）|
| `delete_session(id, origin)` | `deleteSessionPermanently` | DELETE sessions (CASCADE) | FK CASCADE 清 messages + tool_events |
| `assign_session_to_project(session_id, project_id, origin)` | `assignSessionToProject` | UPDATE project_id, updated_at | project_id=null 解绑 |
| `bump_session_after_turn(id, summary, step_number)` | `bumpSessionAfterTurn` | UPDATE turn_count, summary, last_step_index?, last_activity_at, updated_at, has_unread | runner / IPC 触发；不需要 origin（系统行为）|
| `clear_session_unread(id)` | `setActiveSession` 内部 side-effect | UPDATE has_unread=0, updated_at | 不需要 origin |
| `bulk_archive_sessions(ids, origin) -> u32` | `archiveSessionsBulk` | UPDATE WHERE id IN | 返回 affected row 数 |
| `bulk_unarchive_sessions(ids, origin) -> u32` | `unarchiveSessionsBulk` | 同上 | |
| `bulk_delete_sessions(ids, origin) -> u32` | `deleteSessionsPermanentlyBulk` / `emptyArchive` | DELETE WHERE id IN | |

### Projects (4 method)

| Trait method | Frontend caller(s) | DB 写 |
|---|---|---|
| `list_projects() -> Vec<ProjectBrief>` | hydrateFromDB (loadProjects) | SELECT |
| `create_project(input, origin) -> ProjectBrief` | `createProject` | INSERT |
| `update_project(id, partial, origin) -> ProjectBrief` | `updateProject` | UPDATE |
| `delete_project(id, origin)` | `deleteProject` | DELETE (FK SET NULL on sessions.project_id) |

**总计 16 trait method**（12 session + 4 project）。这是「M4a Rust 工作量真容」。

### 不在 M4a scope（推 M4b 或 M5+）

- `setActiveSession` / `setActiveProjectFilter`：纯 frontend display state
- `activateSession`：frontend orchestrator（spawn bridge + restore turns + setActive 三件）
- `restoreSessionTurns`：read-only path，复用现有 `session_messages` trait method（B1 M3 已 ship）
- 跟 runtime 状态 mirror 相关的字段更新（pending_approval_count / error_count / current_tool / pid）：M5/M6 改 Rust event 驱动

---

## 2. Decision · 拆 M4a / M4b

按 lifecycle / risk 分组：

### M4a — Rust trait + Tauri commands + cargo tests (独立 commit · ~600-800 行 Rust)

**纳入**：

- `core/src/api.rs` 加 16 个 trait method 到 `GalleyApi`
- `core/src/api/session.rs` 加 input types: `CreateSessionInput` / `SessionPatch`
- `core/src/api/project.rs` 加 input types: `CreateProjectInput` / `ProjectPatch`
- `core/src/db.rs` 实现 16 个 method，每个 `async fn ... -> Result<...>`
- `core/src/lib.rs` 注册 16 个 `#[tauri::command]` wrapper + `invoke_handler!` 加入
- Tests：每个 method 加 in-memory SQLite test（`#[tokio::test]`，extend 现有 test module 或拆 `db_writes_tests.rs`）
- **B2-I1 wire 兼容**：所有 brief / input types `#[serde(rename_all = "camelCase")]` + `#[serde(skip_serializing_if = "Option::is_none")]` 跟前端 TS shape 对齐
- agent-api.md §5 加入 16 个 trait method 的 schema doc（B4 才 publish CLI；M4a 只钉 schema）

**留下 / 不动**：

- 前端 `useAppStore.ts` 全部 session/project actions / DB direct call — M4b 才动
- `lib/db.ts` 的 `persistSession` / `deleteSession` / `persistProject` / `deleteProject` — M4b 才退役
- IPC 协议 / runner 端 — 完全不动

**Cross-store 协调**（M4a 范围内）：无。M4a 是 Rust-only commit，frontend 不变 → 行为不变。前端 dogfood 测试只是确认「Rust 加了代码但**没接进 invoke 路径之前不影响行为**」。

### M4b — Frontend sessionsStore 抽离（独立 commit · ~700 行 frontend）

**纳入**：

- 新建 `gui/src/stores/sessions.ts`（estimated ~550 LOC per mapping § H）
- 迁字段：`sessions` / `activeSessionId` / `projects` / `activeProjectFilter`
- 迁 actions（mapping § B）— 但 DB 写路径全改 invoke Rust trait method
- 删 `useAppStore.ts` 的 session/project actions + 字段
- Swap 22 个 call site（grep 已验证）
- 删 `lib/db.ts` 的 `persistSession` / `deleteSession` / `persistProject` / `deleteProject`（per B3-I6 不留 @deprecated）
- 保留 `lib/db.ts` 的 `loadSessions` → `loadSessionsViaCore` 切换前的 B1 M3 deprecated 还在；本 commit 一并清

**关键差异 vs M3**：M3 是 frontend 拆分 + 现有 IPC 路径不变；M4b **首次把 DB 写路径从 `tauri-plugin-sql` 直 SQL 转到 GalleyApi invoke**。这是路径 B 「业务逻辑权威全部在 Rust 端」(CLAUDE.md §4) 的首次落地。

**Cross-store 协调**（M4b 范围内）：

1. **emptyArchive 改 bulk_delete_sessions 调用**：循环 deleteSessionPermanently 改单次 invoke。**注意**：现有 emptyArchive 在循环里 shutdownBridge — bulk version 需 frontend pre-loop 调 `shutdownBridge` for each before invoke
2. **bumpSessionAfterTurn 调用方**：当前 `runner-event` listener 在 turn_end 时 call frontend action → frontend persistSession。M4b 改成 frontend invoke `bump_session_after_turn` + 同步 in-memory state（**M5 后**会改成 Rust 端 IPC handler 直接 invoke trait + emit `sessions-updated` event，frontend listener 自动 update — 但 M5 才做，M4b 保 frontend orchestrator role）
3. **setActiveSession 内 clear_unread 调用**：当前内部 `persistSession(cleared)`。M4b 改 invoke `clear_session_unread(id)`
4. **TRANSITIONAL 注释**：M4b 内任何 frontend 仍持有的 DB 写**业务**逻辑（非 thin invoke）= 加 `// TRANSITIONAL (M5)` 注释。预期至多 2-3 处（bumpSessionAfterTurn synchronous mirror 主要候选）

### 序列 + dogfood gate

```
M4a ship (单 commit "Refactor: B3 M4a — extract Rust GalleyApi session/project CRUD methods")
  ↓ JC quick smoke (Rust cargo test 全过 + 起 dev mode 无 regression — 因为 M4a 不接 frontend)
M4b ship (fresh session 重开 — 单 commit "Refactor: B3 M4b — extract sessionsStore + route writes through Rust core")
  ↓ dogfood 1 天（重点：bulk archive / delete / project filter / rename / pin / unread clear / emptyArchive）
M5 starts (messagesStore)
```

**M4a 的「dogfood」颗粒度可极简**：因为 frontend 完全没改，行为应 byte-identical。`cargo test` 全过 + dev mode 起得来 = 充分。fresh session 重开 M4b 前再读这条 dogfood signal。

---

## 3. M4a 详细 sub-task

### T4a.1 · 新增 Rust input types

新建 / 扩展：

- `core/src/api/session.rs`：加 `CreateSessionInput` / `SessionPatch`（partial update 通用 patch shape）/ `BulkResult`（bulk method 返回值，含 `affected: u32`）
- `core/src/api/project.rs`：加 `CreateProjectInput` / `ProjectPatch`

types shape：

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: String,                 // frontend-assigned `s-<rand>` per current convention
    pub title: String,              // 通常 `新对话`
    pub project_id: Option<String>,
    pub selected_llm_index: Option<u32>,
    pub selected_llm_display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub id: String,                 // frontend-assigned `proj_<rand>`
    pub name: String,
    pub root_path: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub root_path: Option<Option<String>>,  // double-Option: None=不改, Some(None)=置 null, Some(Some(...))=set
    pub icon: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub pinned: Option<bool>,
}
```

**决策**：id 由 frontend 生成（保持当前 `s-<timestamp>-<rand>` / `proj_<random16>` convention，per `useAppStore.ts:1094` / `1384`）。Rust 不强制 UUID，避免 invoke 后才知道 id 的 lifetime 同步问题。

### T4a.2 · GalleyApi trait method 签名

`core/src/api.rs` extend trait（按 mapping § B order）：

```rust
// --- sessions (writes) ---
async fn create_session(&self, input: CreateSessionInput, origin: Origin) -> Result<SessionBrief>;
async fn archive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief>;
async fn unarchive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief>;
async fn rename_session(&self, id: SessionId, title: String, origin: Origin) -> Result<SessionBrief>;
async fn set_session_pinned(&self, id: SessionId, pinned: bool, origin: Origin) -> Result<SessionBrief>;
async fn delete_session(&self, id: SessionId, origin: Origin) -> Result<()>;
async fn assign_session_to_project(&self, session_id: SessionId, project_id: Option<String>, origin: Origin) -> Result<SessionBrief>;
async fn bump_session_after_turn(&self, id: SessionId, summary: Option<String>, step_number: Option<u32>) -> Result<SessionBrief>;
async fn clear_session_unread(&self, id: SessionId) -> Result<()>;
async fn bulk_archive_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;
async fn bulk_unarchive_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;
async fn bulk_delete_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;

// --- projects ---
async fn list_projects(&self) -> Result<Vec<ProjectBrief>>;
async fn create_project(&self, input: CreateProjectInput, origin: Origin) -> Result<ProjectBrief>;
async fn update_project(&self, id: ProjectId, patch: ProjectPatch, origin: Origin) -> Result<ProjectBrief>;
async fn delete_project(&self, id: ProjectId, origin: Origin) -> Result<()>;
```

**Origin policy**: 所有用户/agent 可触发的写都要 `Origin`（B2 M5 contract）。系统内部行为（bump / clear_unread）不要 — frontend 不传，CLI 也碰不到（B4 才暴露 CLI）。

**Return shape**: 单个 write 返回更新后的 `SessionBrief` / `ProjectBrief` — frontend 直接用作 in-memory state mirror 来源（不需要 client-side guess 新 `updated_at`），跟 GUI 当前 `updated: Session | null` + `persistSession(updated)` pattern semantic 一致。delete 返回 `()`。bulk 返回 affected row count（GUI 用作 toast 信号源）。

### T4a.3 · SqliteGalley 实现

在 `core/src/db.rs` 现有 `impl GalleyApi for SqliteGalley` block 内 append 16 个 method body。每个：

1. (write path) UPDATE / INSERT / DELETE SQL via sqlx
2. (read-back) `SELECT ... WHERE id = ?` 拿更新后 row → `SessionRow::into_brief()`
3. (origin) **B2 M5 决定**：session `created_via` / `created_by_supervisor` / `created_origin_note` 列在 migration 007 已有 — `create_session` 写这三列；其它 write 不动这三列（只有 origin-of-creation 持久化，不持久化每次 patch 的 origin — patch origin 是审计需要，B4 加 audit 表时再考虑）
4. (last_activity_at touch) 大部分 mutation 不触动 `last_activity_at`（archive / rename / pin / project assign 都不 bump activity，因为不是 conversation 进展）；**只 `bump_session_after_turn` 触动**
5. (transaction) `bulk_*` + `delete_session`（FK cascade 大）用 `pool.begin()` transaction 包；其它 single update OK 不用 tx

**Error handling**：

- 不存在的 id → `GalleyError::NotFound`
- `set_session_pinned` 在 archived session 上 → `GalleyError::InvalidArgs`
- empty title rename → server-side fall back `新对话`（不 reject，frontend 行为兼容）
- `create_session` id 冲突 → SQLite PRIMARY KEY constraint 报错 → 包装成 `InvalidArgs`
- `assign_session_to_project` 中 project_id 不存在 → SQLite FK 约束自动拒绝 → 包装成 `InvalidArgs`

### T4a.4 · Tauri command wrappers

`core/src/lib.rs` 加 16 个 `#[tauri::command]`，mirror `list_sessions` pattern (lib.rs:60-69)：

```rust
#[tauri::command]
async fn create_session(
    input: CreateSessionInput,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley.create_session(input, origin).await.map_err(stringify_error)
}
```

抽 `fn stringify_error(e: GalleyError) -> String` helper（pattern 跟现有 `list_sessions` 行 64/68 重复，DRY 一次），减少 16 × 2 = 32 行 boilerplate。

`invoke_handler!` macro 加入新 command name × 16。

### T4a.5 · Cargo tests

新建 `core/src/db_writes_tests.rs` (or extend `core/tests/test_galley_api.rs`)。每个 method 1-2 test：

- happy path: setup DB row → invoke method → re-read row 确认字段变化
- error path: not-found id / invalid status / archived pin reject 等

**Test infrastructure 复用**：现有 in-memory SQLite test setup（B1 M3 落的）。每个 test 起独立 in-memory pool + apply 7 个 migration。

预估测试 LOC：~30 个 #[tokio::test] × 平均 20 行 = ~600 行测试代码。

### T4a.6 · agent-api.md schema 增补

`docs/agent-api.md` §5 加 16 个 trait method schema doc。**仅 schema/契约，无 CLI subcommand exposure**（B4 才暴露 CLI surface）。**B2 增量法则**：additive only，不动既有 schema_version。

### T4a.7 · TypeScript / lint / cargo check + cargo test + dogfood-pre

- `cd core && cargo check`
- `cd core && cargo test` — 全过（76 现有 + 30 新增 ≈ 106 test）
- `cd gui && pnpm typecheck && pnpm lint`（不应受影响，frontend 不变）
- 起 dev mode + 简单流程（创建 session / archive / rename / pin / delete）—— **行为应完全不变**（因为 frontend 没接新 invoke 路径），如果发现 regression = 检查是否 accidentally 改了现有 read trait method

### T4a.8 · M4a commit

```
git commit -m "Refactor: B3 M4a — extract Rust GalleyApi session/project CRUD methods"
```

---

## 4. M4b 详细 sub-task（M4a smoke 通过后 · **fresh session 重开**）

> M4b 详细 sub-task 推到 fresh session 时写。本节只占位 + 列大纲，避免本 plan 文档过长 + 多日延后实施时 stale。

预期大纲：

- T4b.1: 新建 `gui/src/stores/sessions.ts` skeleton（fields + 16 invoke wrapper + ipc-handlers update listener 占位）
- T4b.2: 迁 createSession + activateSession（前者改 invoke，后者保 frontend orchestrator）
- T4b.3: 迁 archive/unarchive/rename/togglePin/delete singles
- T4b.4: 迁 bulk variants
- T4b.5: 迁 project CRUD
- T4b.6: 迁 setActiveSession / setActiveProjectFilter (display state)
- T4b.7: 迁 bumpSessionAfterTurn + clear_session_unread side-effects
- T4b.8: 22 call site swap (App.tsx / Sidebar.tsx / MainView.tsx / Onboarding / CreateProjectDialog / ipc-handlers.ts / bridge.ts)
- T4b.9: 删 useAppStore 已迁字段 + actions
- T4b.10: 删 lib/db.ts 中 sessions/projects 写路径 + loadSessions deprecated
- T4b.11: TS typecheck + lint + dogfood 1 天

---

## 5. Risk register

| # | 风险 | Mitigation |
|---|---|---|
| R1 | M4a 加 16 个 trait method 而无 frontend caller，看似「dead code」会让 reviewer 怀疑 | 在 trait method docstring + commit message 明示「B3 M4b will route GUI callers through these; B4 will expose via CLI subcommands」，避免「这是空函数」误读 |
| R2 | 现有 `persistSession` + `tauri-plugin-sql` 路径在 M4b 删除时如果有遗漏的 frontend caller 会导致写丢失（silent failure）| 删之前 grep `await persistSession\|await deleteSession\|await persistProject\|await deleteProject` 验证 0 命中 + typecheck 强制 |
| R3 | `bump_session_after_turn` 触发链路当前在 frontend `appendAgentTurn` → `bumpSessionAfterTurn` action → `persistSession`。改 invoke 后并发 turn 的 lastActivityAt race 处理与现状一致吗？ | sqlx serializes per pool connection；写竞争主要在 frontend orchestrator 层（GUI 1 active session 一次 1 turn 不冲突）；M4b 实施时 dogfood 多 session 并行 turn |
| R4 | `Origin` 参数在 frontend 调用每个 method 时都要传 `Origin::gui()` boilerplate 多 | 加 frontend helper `defaultGuiOrigin()` const，前端业务 action call site 不感知 origin |
| R5 | bulk method 返回 affected count 但 transaction 内 atomicity / rollback 语义不明确 | M4a 实施时显式 `tx.commit()` / `tx.rollback() on err` + test 覆盖 partial-failure scenario |
| R6 | `update_project` 用 double-Option pattern (`Option<Option<String>>`) 跟 frontend `partial` shape 对齐复杂 | 跟 frontend `partial: { name?: string; rootPath?: string \| undefined }` 不完美对齐 — frontend `undefined` 不区分「不改」vs「置 null」。**决策**：rename / icon / color 用 single Option（None=不改），rootPath 仍 double-Option（前端少数明确「清空」case）。M4a 实施时验证 frontend partial 调用方实际用法 |
| R7 | `create_session` id 冲突（罕见但 frontend 当前 `s-${Date.now().toString(36)}-${rand}` 不严格 UUID）—— Rust 收到冲突 id 时 frontend 不知道怎么处理 | Rust 端 PRIMARY KEY 违反返回 `InvalidArgs { message: "session id conflict" }`，前端 retry 重新生成 id。**Open**：M4b 实施时决定 frontend 是否退化到 Rust 端生成 id（uuidv4 dep 加进 core，撤回 `s-` convention）|
| R8 | M4a 单 commit Rust LOC 600-800 + 600 行测试 = 1200-1400 LOC，比 M3a 大 | M4a 没有 cross-store transitional pattern，pattern repetitive — review burden 不等于 LOC；典型 reviewer 在 `archive_session` 看完后 `unarchive_session` / `rename` / `set_pinned` 模式套用。**Mitigation**: commit message + diff 顺序按 trait method 分组（先 sessions singles，后 bulk，最后 projects）|

---

## 6. Open questions

| ID | Item | Decide at |
|---|---|---|
| Q1 | `bump_session_after_turn` 是否暴露给 CLI（agent 用 supervisor SOP 时可能想标记某 session 「这一轮结束」）？ | B4 时决定；M4a 不暴露 |
| Q2 | `clear_session_unread` 是否需要 Origin（理论上 CLI 可能想 mark-read）？ | 暂不需要；M4a frontend-only consumer |
| Q3 | `update_project` 的 rootPath 写 path 当前 frontend 行为是「空 trim 自动 -> undefined」。Rust 端是否复刻？ | M4a 实施时复刻（frontend 不重复 trim 后端，server-side normalize）|
| Q4 | M4a 测试拆 separate file (`core/tests/session_writes_tests.rs`) vs extend existing `core/src/db.rs::tests`？ | M4a 实施时倾向 separate file（76 现有 test 都在 `db.rs::tests`，加 30 个会让 file 超 1200 行，单 file 单职责崩塌）|

---

## 7. Verification gates

**M4a 完成判据**（all must pass）：

- [ ] `cd core && cargo check` 0 error 0 warning
- [ ] `cd core && cargo test` 全过（≥106 test 含 30 new write tests）
- [ ] `cd gui && pnpm typecheck` 0 error
- [ ] `cd gui && pnpm lint` 0 warning
- [ ] 起 `pnpm tauri dev` + 跑现有 GUI 流程（创建 / archive / rename / pin / delete session / 建 project / 改 project / 删 project）—— **行为 byte-identical**（因为 frontend 没接 Rust trait method，全部走旧的 `tauri-plugin-sql` 路径）
- [ ] grep `useAppStore.*\(create_session\|archive_session\|rename_session\|set_session_pinned\|delete_session\|create_project\|update_project\|delete_project\)` 返回 0（M4a 不允许 frontend call site sneak in）
- [ ] `core/src/api.rs` `GalleyApi` trait method 数量从 7 (B1 M3 + B2 M4) 增到 23（+16）
- [ ] `core/src/lib.rs` `tauri::generate_handler!` 注册 trait method 数从 7 增到 23

**M4b 完成判据**：

- [ ] M4a 全部 + 以下
- [ ] grep `await persistSession\|await deleteSession\|await persistProject\|await deleteProject` 在 `gui/src/` 返回 0
- [ ] `lib/db.ts` 移除 `persistSession` / `deleteSession` / `persistProject` / `deleteProject` 函数
- [ ] `useAppStore.ts` 行数 < 1700 → < 1300（净 delete ~400 行）
- [ ] 新 `gui/src/stores/sessions.ts` ≤ 600 行（B3-I5 硬上限）
- [ ] dogfood scenarios: bulk archive 5 session / bulk delete archive 全选 / project filter on/off / rename empty title fallback / pin archive reject / 多 session 并发 turn 不丢 row

---

## 8. Estimate

| Sub-phase | LOC | 时长 |
|---|---|---|
| M4a sub-plan（本文档）| ~400 markdown | 1h |
| M4a Rust types + trait signature | ~150 | 1h |
| M4a SqliteGalley impl（16 method body）| ~400 | 2-3h |
| M4a Tauri commands + handler 注册 | ~150 | 0.5h |
| M4a cargo tests | ~600 | 2-3h |
| M4a agent-api.md schema 增补 | ~150 markdown | 0.5h |
| M4a typecheck + smoke + commit | — | 0.5h |
| **总 M4a** | **~1450 LOC + 400 md** | **单 session 6-8h** |
| M4a → M4b dogfood gate | — | 半天（JC smoke + cargo test only） |
| M4b（下次 session）| ~700 frontend | 单 session 5-6h |
| M4b dogfood gate | — | 1 天 user time |
| **总 M4** | **~2150 LOC** | **2 session + 1.5 天 dogfood** |

**对比 M3 actual**：M3a 300 LOC + M3b 500 LOC = 800 LOC frontend，单 session 完成。M4 多一倍因为加了 Rust 端 + 测试覆盖。M4a 8h 单 session 是预算上限，若发现刺手处 R3 / R6 / R7 → 起 fresh session 完成。

---

## End of M4 sub-plan
