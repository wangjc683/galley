# Galley Native Slice 4 Completion

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Agent API](../agent-api.md),
[Slice 4C3 Browser Recovery Hints](./2026-06-17-galley-native-slice-4c3-browser-recovery-hints.md)

## Context

Slice 4 started as the native tool-control-plane slice, then expanded into the
first real executor tranche: local file tools, local command execution, Browser
Control perception/action, approval pause/resume, ask-user pause/resume, and
one-pass tool-result continuation.

After 4C3, the remaining items in the Slice 4 area are no longer missing core
executors. They are lifecycle and product polish decisions: background/live
approval execution, dedicated browser recovery UI actions, and durable
allow-policy storage.

## Completion State

Slice 4 is complete for the hidden native runtime boundary:

- GA-compatible 9-tool registry exists.
- Structured and text-fallback tool parsing exists.
- `ask_user` can pause and resume the native loop.
- Risky tools can pause for approval and resume or deny the exact suspended
  call.
- `file_read`, `file_patch`, `file_write`, and `code_run` are real native
  executors with workspace policy, preview/approval behavior, and tests.
- `code_run` can materialize bounded stdout/stderr as replayable
  `tool_progress` events.
- `web_scan` and `web_execute_js` are real native Browser Control executors
  using Galley's prepared `TMWebDriver` bridge.
- Failed browser tool results carry recovery hints for host-unavailable,
  connected-no-tabs, and not-connected states.
- Approved local/browser tool results can feed one continuation model request
  and update the same assistant turn.
- The native initial prompt now advertises the landed file/code/browser tools
  instead of the old `file_read`-only slice boundary.

## Explicitly Out Of Slice 4

- Durable native memory writes and `start_long_term_update` implementation:
  Slice 5.
- Capability pack storage / self-evolution substrate: Slice 5.
- Project workspace continuity beyond the minimal file/code cwd policy:
  Slice 6.
- Native Goal Hive master/worker orchestration: Slice 7.
- Morphling native mode: Slice 8.
- Default-switch dogfood gates and managed retirement: Slice 9.

## Accepted Follow-Ups

These are not blockers for closing Slice 4:

- background/live approval execution for long-running tools;
- first-class GUI actions for browser recovery hints;
- durable allow-policy persistence for `always_allow_project` /
  `always_allow_global`;
- provider-native tool-choice request wiring.

They improve product polish and runtime throughput, but the Slice 4 contract is
already sufficient for moving into native memory and capability-pack work.

## Verification

Most implementation verification happened in the individual Slice 4 devlogs.
The completion checkpoint verifies documentation consistency only:

- `git diff --check`

## Next

Start Slice 5: native memory and capability substrate. The first useful cut is
not broad self-evolution; it is a small, typed, reversible memory/checkpoint
store that keeps `update_working_checkpoint` session-local and routes durable
updates through a separate `start_long_term_update` pipeline.
