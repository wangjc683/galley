# Galley Native Slice 4B7 Approved Tool Continuation

## Date / Status / Related

- Date: 2026-06-16
- Status: Landed
- Related:
  - [Galley Native Runtime](../galley-native/runtime.md)
  - [Implementation Slices](../galley-native/implementation-slices.md)
  - [Agent API](../agent-api.md)
  - Slice 4B6: [Code Run](./2026-06-16-galley-native-slice-4b6-code-run.md)

## Context

After `file_patch`, `file_write`, and `code_run` became real approved executors,
the hidden native experience still had a sharp edge: after approval, Galley
returned a raw tool result and stopped. That is acceptable for an audit log, but
it is not how a useful autonomous agent should feel. The agent should read the
tool result and continue with a human-facing answer.

`file_read` already had one non-streaming continuation path. This slice reuses
that shape for approved local write/process tools instead of inventing a new
event contract.

## Decisions

- Approved `file_patch`, `file_write`, and `code_run` now make one non-stream
  continuation model request after execution.
- The original approval response still returns the raw `toolResult`.
- The assistant row keeps the raw `tool_results` audit payload.
- The same assistant row's `finalAnswer` is updated with the continuation
  answer.
- `assistantMessage` is returned in `session.approval_response`.
- `session.watch` replays `turn_progress(source=model_continuation)`,
  `turn_end`, and `run_complete(mode=approval_response_continuation)`.
- `deny` decisions record a denied result and do not continue.
- If no usable model is available or continuation fails, the tool result is not
  lost; Core emits `runtime_error` and completes with the tool-result content.
- Browser Control, memory, Goal Hive, and Morphling behavior is unchanged.

## Rejected Alternatives

- **Wait until the full autonomous loop.** That would leave approved writes and
  commands feeling unfinished for too long. One continuation is narrow and
  already matches the `file_read` path.
- **Create a new assistant message after the tool.** Rejected for now. Updating
  the same assistant turn preserves the existing native turn shape and keeps the
  audit payload attached to the action that produced it.
- **Continue after denied tools.** The operator explicitly rejected execution;
  recording the denied result is enough.
- **Add multi-step autonomous loops here.** Deferred. This slice only gives
  approved local tools one follow-up pass.

## Open Questions

- Should the next slice add streaming stdout/stderr progress for long
  `code_run` commands before `tool_end`?
- Should successful local tool continuations be allowed to request another tool
  in the same user turn, or should that wait for the full loop slice?
- Should continuation policies eventually be configurable per tool/risk class?

## Next

- Decide whether to add streaming progress for `code_run`.
- Keep Browser Control as Slice 4C.
- Keep memory, Goal Hive, and Morphling in later slices.

## Verification

- `cargo test --manifest-path core/Cargo.toml approval_response_native --lib`
- `cargo test --manifest-path core/Cargo.toml native_ --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`
