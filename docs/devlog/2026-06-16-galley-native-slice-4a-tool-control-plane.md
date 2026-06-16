# Galley Native Slice 4A Tool Control Plane

## Date / Status / Related

- Date: 2026-06-16
- Status: implemented as hidden skeleton
- Related:
  - [Galley Native Implementation Slices](../galley-native/implementation-slices.md)
  - [RFC 2: Model And Tool Loop](../galley-native/rfc-2-model-tool-loop.md)
  - [RFC 7: Parity Harness And Default Switch](../galley-native/rfc-7-parity-harness-default-switch.md)

## Context

Slice 3C proved that hidden `galley_native` can use configured OpenAI-compatible
and Anthropic-compatible managed model records for no-tool turns. The next
dependency is not real file/code/browser execution yet. The safer step is the
tool control plane: parse tool intent, register the GA parity tool set, emit
stable runtime events, and prove that tool calls can be observed without any
machine side effects.

This is user-risk-limited because the path remains hidden behind
`GALLEY_NATIVE_EXPERIMENTAL=1`; ordinary users still use managed GA or external
GA.

## Decisions

- Add `core::native_tools` as the native tool metadata and parsing boundary.
- Register the 9 GA parity tools: `code_run`, `file_read`, `file_patch`,
  `file_write`, `web_scan`, `web_execute_js`, `update_working_checkpoint`,
  `ask_user`, and `start_long_term_update`.
- Support structured JSON parsing and text fallback parsing for common
  `tool_calls`, `tool_call`, `tool` / `name`, and OpenAI-style
  `function.arguments` shapes.
- Preserve the no-tool path exactly: native no-tool traces still emit
  `runtime_ready`, `turn_start`, `turn_progress`, `turn_end`, `run_complete`.
- Emit deterministic tool events only when tool intent is parsed:
  `tool_pending`, optional `approval_pending` / `approval_resolved`,
  `tool_start`, `tool_progress`, `tool_end`.
- Resolve approval as `allowed_for_stub_only` in this slice. That exposes the
  future approval shape but does not grant real execution.
- Persist parsed `tool_calls` and stubbed `tool_results` into the existing
  assistant message payload columns.
- Keep every executor as a deterministic stub with
  `sideEffectsPerformed: false`.

## Rejected Alternatives

- Do real file/code execution in 4A: rejected because local side effects need
  workspace policy, approval resume, timeout/cancel, and diff/preview rules.
- Bundle Browser Control into 4A: rejected after review because the CDP/browser
  readiness bridge is the heaviest failure surface and belongs in Slice 4C.
- Claim `ask_user` is complete: rejected. The slice recognizes `ask_user` and
  emits a visible stub result, but true loop suspension/resume requires native
  session interaction state.
- Add tool payloads to public `MessageBrief`: rejected. The experiment can
  persist internal tool payloads without expanding the user-facing brief API.

## Open Questions

- Should true approval/ask-user state be a named Slice 4A2 before 4B, or folded
  into the start of Slice 4B?
- What GUI projection should native tool events use before real executors
  exist: hidden dev-only stream, lightweight transcript callout, or full
  managed-GA parity UI?
- Should provider-native tool-choice request wiring happen before or after the
  first real local executor?
- How strict should text fallback parsing be once models can receive official
  tool schemas?

## Next

Follow-up note: `ask_user` wait/resume landed later the same day in
[Slice 4A2A Interaction State](./2026-06-16-galley-native-slice-4a2a-interaction-state.md).

1. Add native interaction state for human-driven approval allow/deny/resume.
2. Project native tool events into GUI/CLI in a way that stays clearly
   experimental.
3. Start Slice 4B local file/code executors only after approval and resume
   semantics are reliable.

## Verification

- `rustfmt --edition 2021 core/src/native_tools.rs core/src/native_runtime.rs core/src/socket_listener/mod.rs`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_reports_stubbed_tool_events --lib`
