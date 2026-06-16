# Galley Native Slice 4A2B Approval State

## Date / Status / Related

- Date: 2026-06-16
- Status: implemented as hidden native approval allow/deny state
- Related:
  - [Slice 4A Tool Control Plane](./2026-06-16-galley-native-slice-4a-tool-control-plane.md)
  - [Slice 4A2A Interaction State](./2026-06-16-galley-native-slice-4a2a-interaction-state.md)
  - [Galley Native Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)

## Context

Slice 4A made native tool calls observable, and Slice 4A2A made native
follow-up / `ask_user` state possible. The remaining interaction risk before
real local executors was approval resume: a risky tool call must be suspended,
approved or denied by the operator, and resolved back into the exact assistant
turn without accidentally executing a different call.

This slice keeps executors as stubs. The goal is state integrity, not file or
process capability.

## Decisions

- Risky native tool calls now stop at `approval_pending`, persist a pending
  `tool_events` row, set the session to `waiting_approval`, and close the native
  stream with `native_waiting_approval`.
- Hidden native `session.approval_response` and CLI
  `galley session approval-response` now accept `allow_once`, `deny`,
  `always_allow_project`, and `always_allow_global`.
- `deny` records a denied tool result, emits `approval_resolved`, `tool_end`,
  and `run_complete`, and performs no side effect.
- Allow decisions emit `approval_resolved`, `tool_start`, `tool_progress`,
  `tool_end`, and `run_complete`, update the assistant message's
  `tool_results`, complete the pending tool event, and return the session to
  `idle`.
- `always_allow_project` and `always_allow_global` are accepted as decision
  values but do not create durable allow policies yet.
- Native tool call ids are now scoped by session and turn, so approval ids do
  not collide across sessions that produce the same parsed tool call.

## Rejected Alternatives

- Implement real `code_run` / file side effects in the same slice: rejected
  because approval state must be proven before any local side effect exists.
- Treat approval ids as parser-local values such as `native_tool_1_code_run`:
  rejected after testing showed cross-session collisions. Approval ids must be
  unique enough to identify the suspended call.
- Persist project/global allow policies immediately: rejected for scope. The
  policy surface needs UI, audit, and revocation semantics before it should
  change future tool behavior.
- Route managed/external approvals through this command: rejected. Their
  approval path still belongs to the live Python runner / GUI IPC integration.

## Open Questions

- Should hidden native expose pending approval rows through a read-only CLI
  helper, or is `session watch` plus `session show` enough for the experimental
  phase?
- Should GUI projection land before Slice 4B executors, or should the first
  local executors remain CLI-only behind the experiment gate?
- What exact policy object should represent durable project/global allow rules?

## Next

1. Add GUI projection for native tool pending / approval / ask-user / result
   events.
2. Start Slice 4B local file/code executors using the landed approval state.
3. Keep Browser Control as Slice 4C, separate from file/code executors.

## Verification

- `rustfmt --edition 2021 core/src/native_runtime.rs core/src/native_tools.rs core/src/db/session.rs core/src/db/tool_event.rs core/src/socket_listener/session_cmds.rs core/src/socket_listener/mod.rs cli/src/args.rs cli/src/main.rs cli/src/session.rs`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_approval_response_native_allows_and_denies_pending_tool --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_waits_for_approval_on_risky_tool --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_send_native_resumes_after_ask_user --lib`
