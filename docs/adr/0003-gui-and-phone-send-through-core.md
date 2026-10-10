# ADR-0003 — The GUI and the phone send through Core's own send; socket `session send` stays frozen

- Status: accepted
- Date: 2026-10-10
- Area: Rust Core (`core/src/session_send.rs`, `core/src/session_title.rs`,
  `core/src/commands/send.rs`); socket transport
  (`core/src/socket_listener/session_cmds.rs`)
- Ticket: `.scratch/ios-client/issues/02-core-send-takeover.md` (02c, ruling 1)

## Context

Until 02c the GUI orchestrated a send in TypeScript: persist the row
(`persist_user_message`, no broadcast), make sure a runner is up, send
`user_message`, and write the derived session title back from the page.
A phone client cannot lean on the desktop page, and Rule 5 puts business
authority in Core, so the whole send moves into Core.

Core already had a send: socket `session send`, used by the CLI and every
Supervisor. Its behavior is part of the Agent API (`schemaVersion: 1`,
[session-commands](../agent-api/session-commands.md)): with no live runner it
persists the message and answers `dispatch: "persisted_only"` — it never
starts one. [ADR-0002](./0002-do-not-unify-session-write-handlers.md)
already ruled that the socket write handlers keep their own, contract-bound
failure behavior rather than share one `deliver_turn`.

So the question was whether the GUI and the phone should call socket
`session send` (changed to start a runner), or a new send next to it.

## Decision

**A new Core send (`session_send::send_user_message`, Tauri
`send_user_message`) serves the GUI and, through the remote module, the
phone. Socket `session send` is not changed.**

| | New send (GUI, phone) | Socket `session send` (CLI, Supervisors) |
|---|---|---|
| Cold session (no live runner) | ensures a runner, replays the history, dispatches | persists, answers `persisted_only`, starts nothing |
| Run gate | reserved before the runner is ensured; held through spawn and replay | reserved right before persist + dispatch |
| Images | yes; refused while a run is open (`images_not_queueable`), on an answer or `/btw` (`images_not_allowed`), on an attached runtime whose model reported none (`images_not_supported`) | text only |
| `/btw` | dispatched without persisting or gating (the bridge's side-question path) | `session btw` is its own command |
| `ask_user` pending | sends `ask_user_response` | sends `user_message`, past the held queue, as the answer (galley#30) |
| `user-message-persisted` | `pending` once persisted, then `dispatched` / `persisted_only`, with `clientRequestId` | once, `dispatched` / `persisted_only` |
| Failure | an error to the caller, message broadcast `persisted_only` | `persisted_only` in a success envelope |

What the two share is everything below the transport contract: the queue
and run gate (`queue_offer`), "ensure a runner"
([`session_runner`](../../core/src/session_runner/mod.rs), which Goal and
socket `session new` use too), and the first-message title
([`session_title`](../../core/src/session_title.rs)), which every path that
persists a user message now derives in Core.

Holding the gate across the ensure is what makes the new send safe on a
cold session: a CLI send arriving while Core spawns and replays sees a run
open and queues, instead of reaching the runner before its history does.

## Consequences

- The socket contract stays as it was, response bodies included: a seed
  session's title is now derived in the database on socket `session send` /
  `session new` too, but their responses still return the rows they did
  (`session new` answers the created row titled `新对话`).
- When a Supervisor needs "send to a cold session and run it", socket
  `session send` gains an optional argument (for example `ensureRunner`),
  defaulting to today's behavior. Additive only; nothing is removed or
  renamed (Rule 3).
- Two sends exist on purpose. A review that finds them "duplicated" should
  read this ADR and ADR-0002 first: their difference is the contract, not
  an accident of history.
- The Tauri commands `persist_user_message` and
  `queue_or_dispatch_user_message` are retired; `stop_session_run` replaces
  the GUI's direct `abort`, with `open_run || agent_running` as its
  condition (socket `session stop` keeps its own).
