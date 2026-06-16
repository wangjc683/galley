# Galley Native Slice 4B2 Tool Result Continuation

## Date / Status / Related

- Date: 2026-06-16
- Status: landed in working tree
- Related:
  - [Galley Native implementation slices](../galley-native/implementation-slices.md)
  - [Slice 4B1 File Read](./2026-06-16-galley-native-slice-4b1-file-read.md)
  - [RFC 2: Model And Tool Loop](../galley-native/rfc-2-model-tool-loop.md)

## Context

Slice 4B1 made `file_read` real, but the native model loop still persisted the
model's first tool-call-shaped answer as the assistant final answer. That proved
the executor path, not the user-facing agent behavior. The next product
boundary is: if native reads a file, the user should receive an answer based on
that file, not raw JSON.

## Decisions

- Implement one continuation pass after `file_read` results.
- The continuation pass is non-streaming in this slice.
- The first model answer may request `file_read` through the existing
  text/JSON tool-call parser.
- Core executes eligible `file_read` calls through the Slice 4B1 executor.
- If the turn has at least one `file_read` tool result, and is not waiting for
  approval or `ask_user`, Core sends a second model request containing:
  - the original user task;
  - the assistant's first tool-call-shaped answer;
  - serialized Galley Core tool results.
- The persisted assistant `final_answer` becomes the continuation answer.
- `tool_calls` and `tool_results` remain persisted on the assistant row for
  audit and GUI projection.
- `run_complete.usage` wraps both model calls when both providers report usage:
  `initial` and `continuation`.
- The continuation prompt is capped at 64 KiB of serialized tool results to
  avoid accidental giant prompts.
- Managed GA and external GA behavior is unchanged.

## Rejected Alternatives

- Persist the raw tool-call JSON as the user-facing final answer.
  - Rejected because it proves internals but does not satisfy the user's task.
- Implement a full multi-step autonomous loop now.
  - Rejected because repeated tool-choice, loop limits, scratchpad policy,
    failure recovery, and provider-native tool-call shapes need their own gate.
- Stream the first model call while also hiding raw tool-call JSON.
  - Rejected for this slice because once raw streaming deltas are emitted, the
    GUI cannot cleanly retract them. Streaming-aware tool loops should buffer
    or use provider-native tool calls in a later slice.
- Add `file_patch` before continuation.
  - Rejected because write tools without a final answer loop create visible
    action logs, not a useful native agent experience.

## Open Questions

- Should streaming native model turns buffer the first response until Core knows
  whether it is a tool call?
- Should approval-resolved `file_read` also trigger a model continuation in the
  same `session.approval_response` path?
- Should the continuation prompt use provider-native tool result roles once the
  model adapters support them?
- How many loop iterations should V1 allow before asking the user or stopping?

## Next

- Decide whether Slice 4B3 should be approval-response continuation for
  approved `file_read`, or preview-first `file_patch`.
- Keep `file_write`, `code_run`, and Browser Control out of this slice.
