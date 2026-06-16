# Galley Native Slice 4A2A Interaction State

## Date / Status / Related

- Date: 2026-06-16
- Status: implemented as hidden native follow-up / ask-user state
- Related:
  - [Slice 4A Tool Control Plane](./2026-06-16-galley-native-slice-4a-tool-control-plane.md)
  - [Galley Native Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)

## Context

Slice 4A made native tool intent observable, but it still treated `ask_user` as
a stub result and native `session.send` as a persisted-only write. That meant a
native session could ask for human input in the event stream but had no native
path for the user's next message to continue the loop.

Before real file/code/browser executors, the runtime needs basic interaction
state: a native session must be able to accept a follow-up user message, and an
`ask_user` turn must clearly enter a waiting state that the next user message
resumes.

## Decisions

- Hidden native `session.send` now runs a Rust-native follow-up turn and returns
  `dispatch: "completed_native"` with `session` and `assistantMessage`.
- Managed/external `session.send` remains fire-and-forget and still returns
  `dispatched` or `persisted_only`.
- `ask_user` no longer emits approval events. It emits a dedicated
  `ask_user` event because the user is answering a question, not approving a
  machine action.
- A native ask-user turn now ends with `run_complete.exitReason.result =
  "ASK_USER"` and native stream close reason `native_waiting_user`.
- While waiting, the session row is marked `status = waiting_approval` with
  `pending_approval_count = 0`. This reuses the existing status surface without
  inventing a new schema state.
- The next hidden native `session.send` runs another native turn and returns
  the session to `idle` if that turn does not ask the user again.

## Rejected Alternatives

- Jump directly to Slice 4B local executors: rejected because approval and
  user-interaction state must be reliable before file/process side effects.
- Implement true approval allow/deny/resume in the same patch: rejected because
  real approval must preserve a suspended tool call and resume or deny that
  exact call. Without real executors, that would be mostly fake state.
- Add a new persisted status such as `waiting_user`: rejected for now. It would
  require schema and UI/API changes; the existing `waiting_approval` bucket
  already means "the system is waiting for the human".
- Add GUI projection immediately: rejected for scope. The socket/native event
  contract should stabilize first; GUI can project it next.

## Open Questions

- Should native get a distinct public `waiting_user` status before beta, or is
  `waiting_approval` acceptable as the broader "human input required" bucket?
- Should native model turns start using prior visible history before the first
  real executor, or wait until workspace/session continuity slices?
- What should a native approval resume command look like for CLI/Supervisor:
  reuse `approval_response` semantics or add socket-level native approval
  commands?

## Next

1. Add true native approval allow/deny/resume for pending tool calls.
2. Add GUI projection for native tool and ask-user events.
3. Start Slice 4B local file/code executors only after approval resume is
   reliable.

## Verification

- `rustfmt --edition 2021 core/src/native_tools.rs core/src/native_runtime.rs core/src/db/session.rs core/src/socket_listener/session_cmds.rs core/src/socket_listener/mod.rs`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_send_native_runs_follow_up_turn --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_send_native_resumes_after_ask_user --lib`
