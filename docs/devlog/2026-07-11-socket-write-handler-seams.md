# 2026-07-11 — Socket write handlers: injected seams (HandlerCtx / RunnerPort / Notifier)

## Outcome

Core's socket write handlers no longer reach for globals. Dependencies
arrive through `HandlerCtx` (`core/src/socket_listener/ctx.rs`):

- `DbSource` — `Global` (production: per-handler `SqliteGalley::open()`,
  byte-identical behavior incl. `db_unavailable` errors and ping/version
  surviving a broken DB) or `Pool` (tests: the same `from_pool` seam
  `db_writes_test.rs` already drives 78 tests through).
- `RunnerPort` — a 6-method `#[async_trait]` trait (`spawn`,
  `send_command`, `subscribe`, `pid`, `agent_running`, `shutdown`),
  implemented by `RunnerManager`. The trait's width IS the documented
  socket→runner coupling.
- `Notifier` (`core/src/notify.rs`) — replaces `Option<&AppHandle>` for
  GUI events; `TauriNotifier` in production, `NullNotifier` headless,
  recording fake in tests. `spawn_emit_task` now takes
  `Arc<dyn Notifier>`, so the runner-event forwarding attachment is
  itself observable in tests.
- `ctx.app: Option<&AppHandle>` remains as the one documented residual
  coupling: managed-runtime spawn preparation
  (`prepare_managed_spawn_args`) genuinely needs the Tauri app. Tests
  route around it with external runtime kind.

`dispatch_line` is now the thin production composition root; the new
`pub dispatch_line_with(ctx, line)` is the test entry, so integration
tests drive the FULL path (routing → parse → orchestration → emit) from
a real request line.

Motivating friction (2026-07-11 architecture review, candidate 2): the
injection seam existed and carried 78 tests one layer down, but the
socket layer bypassed it with 13 `SqliteGalley::open()` calls — leaving
`dispatch_session_new_inner`'s five `spawn_failed` rollback branches at
zero coverage.

## New coverage (`core/tests/socket_write_handlers_test.rs`, 10 tests)

- `session.send`: dispatched / runner-gone-tolerant (`persisted_only` +
  success envelope + emit fires either way) / unknown-session silent.
- `session.checkpoint`: system row, never dispatches.
- `session.new`: success event choreography **in order**
  (`session-created-external` → `runner-spawned-external` →
  `user-message-persisted`); spawn-failure narrates `spawn_failed` while
  rows survive the commit; subscribe-race branch; first-dispatch-failure
  branch after runner up.
- `session.archive/restore/move`: each emits its event.
- `llm.set`: `ProcessGone` → `persisted_only` + `session-updated-external`.

Combined with the same-day typed-protocol work (CLI `Transport` seam),
the CLI→Core write path now has fakes on both ends — end-to-end
regression without Tauri, socket, or on-disk DB.

## Decisions (grilling 2026-07-11, all four accepted as recommended)

1. **Ctx struct over per-param injection** — dependency bundle, not a
   behavior config object; handlers stay explicit per ADR-0002.
2. **Narrow `RunnerPort`** — only the methods the socket layer actually
   uses (a 6th, `shutdown`, surfaced during migration — the original
   grep missed a multiline call; the compiler caught it).
3. **`Notifier` covers `spawn_emit_task` too** — otherwise the one
   orchestration step whose loss is hardest to diagnose (session created,
   GUI never receives events) would stay untestable. Forwarder now
   attaches unconditionally (production had `app = Some` always; headless
   forwards to null).
4. **Public `dispatch_line_with` as the test entry** — the interface is
   the test surface: agents send a JSON line, tests send the same line.
   `socket_listener_test.rs`'s hand-rolled harness can retire when touched.

## Behavior notes

- Zero wire changes; the protocol golden tests stayed green throughout.
- One intentional micro-change: with a headless dispatch (no app), the
  runner-event forwarder task now attaches (to `NullNotifier`) instead of
  not attaching. Production is unaffected (app always present).
