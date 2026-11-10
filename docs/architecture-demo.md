# Galley 架构原则 · code-level demo

> Verification-facing document. For the readable architecture overview, start
> with [architecture](./architecture.md).

> **Purpose**: M9 T9.1 / A13 acceptance deliverable.
> **Status**: v0.2.0 shipped, 2026-05-31; invariants re-verified against the 0.3.x tree 2026-07-11; grep gates rewritten for Rule 2 as it stands and re-run 2026-11-10 (code references use file + symbol, not line numbers — lines rot).
> **Scope**: 把 v0.2 / B-phase 的 4 个架构不变量逐条 demo 到具体代码位置 + grep / 测试可验证项。
> [AGENTS.md](../AGENTS.md) 是完整项目宪法；本文件只覆盖这 4 个 verification-facing invariants。

---

## 1. Localhost only

> Galley Core 只在 AF_UNIX socket / named pipe 上接受本地控制，不开 TCP / HTTP 监听，不持有远程登录 token。
>
> 2026-10：宪法 Rule 2 改名「Core Never Listens On The Network」，本不变量不变——Core 仍不监听。
> 远程访问走 Galley 自己的远程模块（[iOS 客户端](../.scratch/ios-client/PRD.md)，[`core/src/remote/`](../core/src/remote/mod.rs)）：
> 它跑在 Core 进程里，从桌面向外连接 relay，端到端加密，只和桌面上配对过的设备说话；relay 只见密文与路由元数据，不能发命令。
> IM bot、SSH 等仍是受支持的传输，但已不是唯一的远程路径。
>
> 2026-10-20：唯一的窄例外是用户发起的 Sign in with ChatGPT——登录待完成期间，OAuth 回环回调可开一个绑定 `127.0.0.1`、
> 临时端口的一次性 HTTP 监听，只收一次 `state` 匹配的回调就关闭、会超时
> （[`core/src/chatgpt_siwc/callback.rs`](../core/src/chatgpt_siwc/callback.rs)）。下面的门禁只放行这一处监听和远程模块的向外连接。

### Code references

- **macOS / Linux**: AF_UNIX socket at `$TMPDIR/galley-$UID.sock` with hand-rolled `getuid` syscall — [`core/src/socket_listener/`](../core/src/socket_listener/mod.rs)
  ```rust
  // SAFETY: getuid is always safe — POSIX guarantees it can't fail.
  let uid = unsafe { libc_getuid() };
  ```
- **Windows**: Named pipe at `\\.\pipe\galley-$USERNAME` — same file (function-level `#[cfg(target_os = "windows")]`)
- **Socket permission 0600** — applied via `set_permissions(0o600)` on Unix; Windows named pipe auto-scopes to creator
- **Race detection**: 200ms try-connect probe + stale unlink — single-instance enforcement without locks

### Grep gates (all should return 0)

```bash
# No TCP listener outside the Sign in with ChatGPT loopback callback (Rule 2 exception)
grep -rn "TcpListener" core/src/ | grep -v "^core/src/chatgpt_siwc/callback.rs:" | grep -v "test\|//"

# ...and that one binds 127.0.0.1 only
grep -n "TcpListener::bind" core/src/chatgpt_siwc/callback.rs | grep -v "Ipv4Addr::LOCALHOST"

# TcpStream only in that callback (its accepted loopback connection) and the
# remote module's outbound WSS connection
grep -rn "TcpStream" core/src/ | grep -v "^core/src/chatgpt_siwc/callback.rs:\|^core/src/remote/" | grep -v "test\|//"

# No wildcard bind
grep -rn "0\.0\.0\.0" core/src/ | grep -v "test\|//"

# No HTTP server framework
grep -rn "http_server\|tokio::net::TcpListener\|axum\|warp\|actix" core/src/ | grep -v "test\|//"
```

The old `jwt|oauth|api_key|bearer` gate is retired: Sign in with ChatGPT and
provider API keys (`credential_store.rs`) are outbound credentials Galley
holds for the user, a product feature since 2026-10. What Rule 2 forbids is a
remote login *into* Core, and the listener gates above cover that.

### Tests demonstrating principle

- [`core/tests/socket_listener_test.rs`](../core/tests/socket_listener_test.rs) — transport tests drive the AF_UNIX/named-pipe path only; no TCP fallback exists to test
- B2 M3 sub-plan §1.3 explicitly rejects TCP variant; AGENTS.md Rule 2「Core Never Listens On The Network」codifies invariant

---

## 2. CLI surface 是公开契约面

> Galley CLI 的 JSON 输出 schema 是 Galley 对 agent 生态的公开承诺。
> schema_version 内 additive-only；breaking 强制 bump；exit code 5 类稳定；error enum stable。

### Code references

- **Schema version constant**: `SCHEMA_VERSION` in [`core/src/protocol/`](../core/src/protocol/envelope.rs) — the single home since 2026-07-11; `cli/src/common.rs` and `core/src/socket_listener/` both re-export it. `3` since 2026-10-13; `ACCEPTED_SCHEMA_VERSIONS` (`1`, `2`, `3`) are still served for unchanged commands
- **`--schema=N` global CLI flag** — clap global flag; mismatch → exit 2 with `schema_mismatch:` prefix
- **Exit code categorization** — `exit_code_for` in [`cli/src/common.rs`](../cli/src/common.rs); wire-tag → error-class mapping is `galley_error_for_tag` in [`cli/src/client.rs`](../cli/src/client.rs) (exhaustive match over the shared `ErrorTag` enum). Per [agent-api.md §1.1](./agent-api.md):
  - 0 = success
  - 1 = internal
  - 2 = invalid_args (includes schema mismatch)
  - 3 = not_found
  - 4 = db_unavailable (Galley Core not running)
  - 5 = runner_error (B4 M1 — bridge unreachable / IPC dispatch failure)
- **Error enum stable identifiers** — [`core/src/error.rs`](../core/src/error.rs) `GalleyError` 5 variants with stable snake_case tag via serde `#[serde(tag = "error", rename_all = "snake_case")]`; the full wire-tag set is `ErrorTag` in [`core/src/protocol/error_tag.rs`](../core/src/protocol/error_tag.rs)
- **Origin enum stable** — [`core/src/api/origin.rs`](../core/src/api/origin.rs) `OriginVia { Gui, Cli, Supervisor, System, Subtask }`; the SQL CHECK constraint pins the four stored values (a subtask is stored as `system`)

### Document references

- [`docs/agent-api.md`](./agent-api.md) §1 stability promise + §1.1 stable identifier sets + §1.2 schema pin pattern + §6 unified flat error envelope `{error, message}`
- [`docs/agent-api.md`](./agent-api.md) §7 Versioning: `schemaVersion: 3` current, `1` (frozen) and `2` served for unchanged commands

### Tests demonstrating principle

- [`cli/tests/cli_test.rs`](../cli/tests/cli_test.rs) schema pin tests (added M6, 2 tests)
- [`cli/tests/m1_writes.rs`](../cli/tests/m1_writes.rs) covers the M1 write commands' exit code categorization
- [`core/tests/socket_listener_test.rs`](../core/tests/socket_listener_test.rs) `schema_mismatch_returns_error` + `unknown_command_returns_error`

---

## 3. 数据不离开 Galley

> Galley 不存 Supervisor ↔ human 的对话内容。
> Supervisor 通过 CLI 发的命令、命令的 `--reason` 标注存进 Galley（per-session 行动日志），但 supervisor 跟 user 在 IM 里聊的对话不存。

### Code references — 存的（per-action origin triple）

- **`messages.created_via` / `messages.supervisor` / `messages.origin_note`** — [B2 migration 006](../core/migrations/006_messages_origin.sql)
- **`sessions.created_via` / `sessions.created_by_supervisor` / `sessions.created_origin_note`** — [B2 migration 007](../core/migrations/007_sessions_origin.sql)
- **Origin triple plumbing** — [`core/src/api/origin.rs`](../core/src/api/origin.rs) + every write trait method takes `Origin` parameter
- **GUI annotation render** — [`gui/src/components/conversation/MessageUser.tsx`](../gui/src/components/conversation/MessageUser.tsx) inline strip `@<supervisor> · <reason ≤80> · <relative time>`

### Code references — 不存的（supervisor conversation）

- **No `supervisor_chat` / `conversation_log` / `dialogue_history` table** — verify by listing the tables the migrations create:
  ```bash
  grep -rhoiE "CREATE (VIRTUAL )?TABLE (IF NOT EXISTS )?[a-z_]+" core/migrations/ | awk '{print $NF}' | sort -u
  ```
  None of them is supervisor-conversation storage.
- **No Galley → supervisor pull** — Galley CLI / socket has zero command that fetches supervisor-side state (Claude session / GA conversation history / IM messages)

### Grep gates (all should return 0)

```bash
# No supervisor chat persistence table / schema
# (-w: whole words, so GA's `trim_messages_history` in a migration comment does not match)
grep -rnw "supervisor_chat\|conversation_log\|supervisor_history\|im_messages" core/src/ core/migrations/
```

### Document references

- [`docs/agent-api.md`](./agent-api.md) §6A — Origin fields per-via semantics: only what supervisor SENDS to Galley is persisted, never what they receive externally
- [`docs/integrations/galley-supervisor-sop.md`](./integrations/galley-supervisor-sop.md) hard rules and [`galley-supervisor-reference.md`](./integrations/galley-supervisor-reference.md) Origin Fields — Supervisor guidance explicitly tells bots to pass identity + reason via CLI flags, not push conversation logs

---

## 4. 路径 B 不可逆迁移

Local-file presentation proof (2026-09-08):
[`GalleyApi::access_local_file`](../core/src/api.rs) delegates to
[`local_file::access`](../core/src/local_file.rs); the Tauri wrapper in
[`commands/system.rs`](../core/src/commands/system.rs) and socket dispatch in
[`socket_listener/mod.rs`](../core/src/socket_listener/mod.rs) share that method.
`local_file_access_uses_shared_api_and_existing_error_categories` in
[`socket_write_handlers_test.rs`](../core/tests/socket_write_handlers_test.rs)
compares direct API and wire results. Neither transport scans user directories,
persists document content, or starts a runner for this feature.

Git-review proof (2026-09-08): `GalleyApi::review_git` delegates to
[`git_review::review`](../core/src/git_review.rs). Both `commands/system.rs`
and `socket_listener/mod.rs` thin-wrap it; `git_review_uses_shared_api_and_existing_error_categories`
in `socket_write_handlers_test.rs` verifies transport parity. Module tests use
temporary repositories to cover combined staged/unstaged changes, index
preservation, unborn branches, worktrees, path literals, stale HEAD, conflicts,
submodules, untracked symlinks, size limits, and disabled external filters.

> v0.2 起，业务逻辑权威全部在 Rust 端 Galley Core：SQLite 写 / Bridge subprocess ownership / Session 生命周期 / 命令调度。
> 前端（GUI / CLI / 未来扩展）：stateless presenter，订阅 event + invoke 命令。

### Code references — Rust 持有权威

- **SQLite writes via trait** — [`core/src/api.rs`](../core/src/api.rs) `GalleyApi` trait whose methods span sessions / messages / projects / origin and the later command families
- **Trait impl** — [`core/src/db/`](../core/src/db/mod.rs) `SqliteGalley` is the only writer with `SqlitePool` connection
- **Bridge subprocess ownership** — [`core/src/runner_manager/manager.rs`](../core/src/runner_manager/manager.rs) `RunnerManager` owns `tokio::process::Child` handles; B2 prototype pattern productionized
- **Session lifecycle** — [`core/src/runner_manager/process.rs`](../core/src/runner_manager/process.rs) `RunnerProcess`: the child is spawned with `kill_on_drop(true)`, so its `Drop` SIGKILLs the child on an unwinding panic (B2 invariant I11)
- **Command dispatch** — `dispatch_line_with` in [`core/src/socket_listener/mod.rs`](../core/src/socket_listener/mod.rs) routes CLI commands to the same `GalleyApi` trait surface as Tauri commands; handlers receive dependencies via `HandlerCtx` (2026-07-11 seam, see `socket_listener/ctx.rs`)

### Code references — 前端是 presenter

- **GUI store slices** — [`gui/src/stores/`](../gui/src/stores) — ui / runtime / sessions / messages / prefs slices; **no direct SQL** writes since B3 M4 / M5
- **`useAppStore.ts` deleted entirely** — B3 M6 (2026-05-20). The TS-side authoritative state pre-B3 era no longer exists
- **bridge.ts thin shim** — [`gui/src/lib/bridge.ts`](../gui/src/lib/bridge.ts) all functions `invoke()` Tauri commands; **0 direct Python subprocess spawn**
- **CLI uses same trait** — read commands (`cli/src/session.rs`, `cli/src/project.rs`, …) open `SqliteGalley` directly; write commands route through the socket via `SocketClient` ([`cli/src/client.rs`](../cli/src/client.rs)) with typed args from `core/src/protocol/`; never opens a Python subprocess
- **Event subscription pattern** — GUI listens to Tauri `runner-event` / `user-message-persisted` / `runner-closed` events; receives state updates without managing state

### Grep gates (all should return 0)

```bash
# No GUI-side direct SQL write (lib/db.ts only wraps Core Tauri commands via
# `invoke`; the GUI holds no SQLite connection).
grep -rn "execute.*UPDATE\|execute.*INSERT\|execute.*DELETE" gui/src/stores/ gui/src/components/

# No GUI-side Python subprocess (the last filter drops ` * ` doc-comment lines)
grep -rn "Command::new.*python\|spawn.*workbench_bridge" gui/src/ | grep -v "//\|test" | grep -vE "^[^:]+:[0-9]+: *\*"

# No GUI-side authoritative state (useAppStore.ts removed)
test ! -f gui/src/stores/useAppStore.ts || echo "FAIL: useAppStore.ts still exists"
```

### Tests demonstrating principle

- **Rust workspace tests** — `cargo test --workspace` covers trait + runner_manager + socket_listener
- **GUI typecheck/lint** — `pnpm typecheck && pnpm lint` clean; React 19 strict mode enforced
- **B3 completion devlog** — [`docs/devlog/2026-05-20-b3-store-slice-complete.md`](./devlog/2026-05-20-b3-store-slice-complete.md) documents the migration: 6 slices + 1 lib/hydrate orchestrator replacing 1431-line useAppStore.ts

### Document references

- [`docs/archive/refactor/B1-rust-core.md`](./archive/refactor/B1-rust-core.md) B1 establishes Rust core skeleton
- [`docs/archive/refactor/B2-bridge-ownership.md`](./archive/refactor/B2-bridge-ownership.md) B2 moves bridge ownership to Rust
- [`docs/archive/refactor/B3-store-slice.md`](./archive/refactor/B3-store-slice.md) B3 retires TS authoritative state

---

## 5. Cross-cutting verification (one command per principle)

```bash
# Principle 1 — Localhost only (the SIWC loopback callback is the one allowed listener)
! grep -rn "TcpListener" core/src/ | grep -v "^core/src/chatgpt_siwc/callback.rs:" | grep -v "//\|test"

# Principle 2 — CLI contract surface versioned (one schema constant)
grep -qE "^pub const SCHEMA_VERSION: u32 = [0-9]+;" core/src/protocol/envelope.rs

# Principle 3 — No supervisor conversation persistence
! grep -rnw "supervisor_chat\|conversation_log" core/src/ core/migrations/

# Principle 4 — Path B (no GUI authoritative state)
! test -f gui/src/stores/useAppStore.ts
```

All four expect exit code 0.

---

## 6. Acceptance handoff

This document serves M9 T9.1 acceptance:

- **A13** (v0.2 / B-phase 架构不变量在 code review 中能逐条 demo) ✅ — 4 invariants 各自有 code refs + grep gates + tests + devlog provenance.

Future B-phase or v0.6 additions to this doc should:
1. Keep this 4-invariant structure focused; AGENTS.md may contain broader project rules that belong in separate verification docs.
2. Update code references when files move (B3 example: `desktop/src-tauri/` → `core/`)
3. Add a new invariant as §5 / §6 if this verification surface genuinely extends (rare — last addition was v0.2 vision pivot 2026-05-15)
