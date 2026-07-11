# ADR-0002 — Do not unify the socket session write-path handlers into one `deliver_turn`

- Status: accepted
- Date: 2026-07-07
- Area: Rust Core socket transport (`core/src/socket_listener/session_cmds.rs`, `llm_cmds.rs`)

## Context

An architecture review (2026-07-07) flagged the socket write-path handlers —
`session.send`, `session.goal_synthesize`, `session.goal_master_plan`,
`session.new` (+ goal worker), `session.checkpoint`, and `llm.set` — as
near-duplicated: each opens the DB, persists a user-message row, best-effort
dispatches an `IpcCommand::UserMessage` to the runner, emits
`user-message-persisted` to the GUI, and shapes a response. The proposed
deepening ("R1") was to collapse persist → dispatch → emit into one
`deliver_turn` returning a neutral `TurnOutcome`, on the premise that the five
handlers are "the same algorithm with three knobs" and ~1500 lines would
collapse.

## Decision

**Do not build the unified `deliver_turn`.** Close reading of the handlers
showed the premise is false: they share a rough skeleton but their
failure-time behavior is *contract-bound and mutually contradictory*.

| Handler | dispatch failure → | fatal? | emit? |
|---|---|---|---|
| `session.send` | `persisted_only` + **success** envelope | no (tolerant) | emit |
| `session.checkpoint` | never dispatches; always `persisted_only` success | — | emit |
| `session.goal_synthesize` | **error** envelope (exit 5) | yes | emit `persisted_only` |
| `session.goal_master_plan` | error envelope | yes | **no emit** (message is `visibility: internal`) |
| `session.new` / goal worker | error envelope | yes | emit `spawn_failed` |
| `llm.set` | `ProcessGone` → `persisted_only` success; else error | mixed | — |

The `dispatch` values (`dispatched` / `persisted_only` / `spawn_failed`), the
response envelope shapes, and the `user-message-persisted` emit are a
**documented public contract** (Agent API `schemaVersion: 1`; see
[stability-and-versioning](../agent-api/stability-and-versioning.md) and
[session-commands](../agent-api/session-commands.md), Rule 3 in `AGENTS.md`).
`session.send` treats a dispatch failure as tolerable (success envelope);
`goal.synthesize` treats the identical failure as fatal (exit 5). A single
`deliver_turn` that owned persist + dispatch + emit would need ~4–5 policy
parameters (fatal?, emit tag, emit-or-not, envelope shaper) to preserve each
contract — a configuration-object anti-pattern that fails the deletion test:
the complexity does not vanish, it reappears as per-call policy args, and the
result is harder to read than the explicit inline handlers.

## Consequences

- The socket write-path handlers stay as explicit per-command functions. Their
  apparent duplication is the cost of keeping distinct, frozen contracts
  legible.
- Future architecture reviews should not re-propose a unifying `deliver_turn`;
  this ADR is the answer. The genuinely shared boilerplate (`SqliteGalley::open`
  + arg-parse) is trivial and not worth a seam.
- The only real sub-invariant the review named — "emit `user-message-persisted`
  whenever the row was persisted, regardless of dispatch outcome" — is already
  upheld per handler, and `goal.master_plan`'s non-emit is intentional (its
  message is `visibility: internal`, so it is not mirrored to the conversation).
- Method: this reversed a top review recommendation after reading the actual
  code. The Explore-agent review over-stated uniformity here (as it did for the
  "12+ sites" P2 claim and the "byte-identical" P3 claim). Treat such reviews as
  leads to verify, not conclusions.

## Addendum (2026-07-11)

The side-remark above that `SqliteGalley::open` boilerplate is "not worth a
seam" has been superseded in one narrow sense: the same day's candidate-2
refactor introduced `DbSource` (`core/src/socket_listener/ctx.rs`), a seam over
db-open — but for **test injection** (in-memory pool vs global on-disk DB), a
motivation this ADR never weighed. The core decision is untouched: handlers
remain explicit per-command functions with their own contract-bound failure
behavior; `HandlerCtx` changes where dependencies come from, not what handlers
do.
