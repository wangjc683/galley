# 2026-07-11 — Typed socket protocol module + CLI SocketClient

## Outcome

The CLI↔Core socket protocol (Agent API, schemaVersion 1) now has a single
typed home: `core/src/protocol/` (envelope + 17 per-command args structs +
`SocketCommand` name-binding trait + `ErrorTag`), consumed by both Core's
`socket_listener` handlers and a new CLI `SocketClient`
(`cli/src/client.rs`) over a string-line `Transport` seam
(`cli/src/transport.rs` is now JSON-blind). Wire shapes are unchanged;
response bytes are pinned by golden tests recorded against the
pre-migration code.

Motivating friction (2026-07-11 architecture review, candidate 1): the
command surface was hand-restated in three places (clap args, CLI `json!`
literals, Core serde structs) with silent drift — `#[serde(default)]`
turns a misnamed field into a dropped argument, not an error — and the
response envelope was hand-parsed in four spots that had already diverged
(`session_watch` swallowed malformed frames; `read_watch_frame` errored).

## Decisions (grilling 2026-07-11)

1. **Protocol lives as a module in the core crate**, not a separate
   `galley-protocol` crate. The CLI already depends on `galley-core`; a
   crate adds ceremony with no isolation gain. Revisit only when a third
   consumer appears.
2. **Full command surface** — every dispatch arm's args type comes from
   `protocol/` (or shared `crate::api` types: `sessions.list` parses
   `SessionFilter`). Partial coverage would recreate "two places to look".
   `session.restore` / `session.shutdown_runner` got their own structs
   (same shape as archive/stop) because `SocketCommand::NAME` binds
   name↔type 1-to-1.
3. **Envelopes are protocol types too** (`SocketRequest`, `SocketResponse`,
   `StreamEnvelope`, `WatchFrame`). `StreamEnvelope` stays Serialize-only;
   the consumer side is `WatchFrame::parse`, kept `Value`-based so unknown
   future frame kinds pass through as events (frozen lenient behavior).
4. **Type-level name binding**: `call<C: SocketCommand>(args: C)` — a call
   site cannot pair a command name with the wrong args. **Results stay
   `Value`**: the CLI prints `result` verbatim; a typed-result round-trip
   would silently drop additively-added server fields, violating the
   schemaVersion 1 evolution rule.
5. **Transport seam at the string-line level** (`round_trip(String) →
   String`, `open_stream(String) → WatchLines`). Fakes replay canned
   lines, including malformed ones — which is exactly what a Value-level
   seam could not simulate.
6. **Bad-frame policy stays per-caller** (ADR-0002 spirit): one parser
   (`WatchFrame::parse`) with an explicit `Unparseable(raw)` variant;
   `session watch` passes raw lines through and continues (frozen agent
   contract), programmatic consumers (`session follow`, project follow)
   treat it as an internal error via `next_watch_frame_strict`.
7. **`ErrorTag` enum shared by both ends**, `Other(String)` for runtime
   forward compat. The CLI's `galley_error_for_tag` match is exhaustive
   with no `_` arm — a new Core tag now fails CLI compilation until
   mapped, instead of silently landing in the exit-1 bucket. Exit-code
   collapse for transport tags (schema_mismatch / unknown_command /
   app_unavailable / idle_timeout → exit 1) is unchanged and remains
   documented in stability-and-versioning.md §2A.

## Wire-compatibility notes

- **Response/stream bytes: identical.** Pinned by `protocol/envelope.rs`
  golden tests, recorded against the pre-migration `wire.rs` and kept
  green through the migration.
- **Request bytes: semantically identical, not byte-identical.** The old
  `json!`-built requests serialized `Value` maps (alphabetical key
  order); structs serialize in declaration order. JSON object key order
  is not part of any contract and Core parses both identically. Field
  *names* are pinned by `Value`-level legacy-equivalence tests in
  `protocol/commands.rs` (one per command). Option fields still serialize
  as explicit `null` (no `skip_serializing_if`), matching legacy shape.
- One degenerate-input behavior improved: a response missing `ok` used to
  surface as `Internal` with an empty message; it now surfaces as
  `Internal` with the error-envelope default tag path (`#[serde(default)]
  ok: bool`) — same exit class, clearer message.

## Verification

- Golden snapshots recorded and green BEFORE migration, green after.
- 17 legacy-equivalence tests (args struct ⇔ old `json!` literal).
- 5 CLI fake-transport tests (success passthrough incl. unknown server
  fields, tag→exit-class mapping incl. `Other`, malformed response,
  missing-`ok`, strict/lenient frame policies).
- `cargo fmt` + `cargo check` + `cargo test` in both crates: core
  187 lib + 118 integration, cli 95 — all green. `git diff --check`
  clean. No GUI surface touched.

## Follow-ups

- `cli/tests/m1_writes.rs` still only covers the "core not running" exit-4
  path end-to-end; with the `Transport` seam, happy-path coverage per
  command is now cheap to add if wanted.
- The 2026-07-11 review's candidate 2 (inject DB/notifier seams into
  Core's socket write handlers) composes with this: together they make the
  CLI→Core write path testable end-to-end without a live Tauri app.
