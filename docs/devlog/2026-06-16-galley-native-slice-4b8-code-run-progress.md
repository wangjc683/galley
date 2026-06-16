# Galley Native Slice 4B8 Code Run Progress

**Date:** 2026-06-16  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Agent API](../agent-api.md)

## Context

Slice 4B6 made hidden native `code_run` execute approval-gated local commands
and return stdout/stderr in the final `toolResult`. Slice 4B7 fed that result
back to the model. The next question was whether users and CLI supervisors
should see command output before `tool_end`.

The important boundary: current Tauri/socket approval handlers call
`resolve_native_approval(...)` synchronously and publish the returned event list
after it completes. True live process streaming during approval execution would
require a lifecycle change: background approval execution, direct event-bus
publishing while the process runs, and duplicate-publish prevention after the
unary command returns.

## Decisions

- Slice 4B8 implements replayable progress materialization, not full live
  approval execution.
- `NativeToolStubResult` can carry non-serialized progress chunks so persisted
  `toolResult` JSON stays stable.
- Hidden native `code_run` converts captured stdout/stderr into ordered
  `tool_progress` events before `tool_end`.
- `tool_progress` gains additive optional fields:
  `stream`, `delta`, and `truncated`.
- GUI projection consumes only progress events with `delta` and displays them
  inside the existing tool card result preview while the tool is running.
- Final `tool_end` remains authoritative for persisted result content and audit.

## Rejected Alternatives

- Do true live streaming in the same slice. Rejected because it changes the
  approval-response lifecycle and event publishing ownership, which is larger
  than a narrow code-run progress slice.
- Parse stdout/stderr back out of final result text in the runtime. Rejected
  because structured executor output is available before formatting and avoids
  coupling event semantics to display text.
- Add a separate code-run output UI. Rejected because the existing tool card is
  already the user's execution trace; a second surface would split attention.

## Open Questions

- Should approval execution become background-published before Browser Control,
  or can Browser Control land first with replayable events only?
- Should `code_run` eventually stream stdout/stderr as the process writes them,
  rather than after the captured command exits?
- Should native event backlog persistence land before any long-running
  executor, so supervisors can reconnect without losing progress?

## Next

- Keep Browser Control as Slice 4C unless live approval execution becomes a
  blocker for the browser bridge.
- When live approval execution starts, preserve the 4B8 event contract:
  `tool_start`, generic `tool_progress`, output `tool_progress`, `tool_end`.
