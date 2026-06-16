# Galley Native Slice 2 Native Worker Skeleton

**Date**: 2026-06-16
**Status**: Implemented, hidden experimental session path + native watch bus
**Related**: [Galley Native](../galley-native/README.md), [Implementation Slices](../galley-native/implementation-slices.md), [Slice 1 Runtime Router](./2026-06-16-galley-native-slice-1-runtime-router.md)

## Summary

Slice 2 opens the first real `galley_native` execution path, but only for an
explicit hidden session start behind `GALLEY_NATIVE_EXPERIMENTAL=1`.

The worker is deterministic and intentionally honest: it writes a visible
`Galley Native mock response` and says real model adapters, tools, memory,
Browser Control, Goal Hive, and Morphling are not active in this slice.

Slice 2B also gives that hidden path a Core-owned native event bus. This is not
GUI product exposure yet; it only lets `session.watch` subscribe to or replay
the deterministic native mock trace for the same Core process.

## What Landed

- Added `core::native_runtime` with a mock native worker.
- Added internal `NativeMessage`, `NativeContentBlock`, and
  `NativeRuntimeEvent` shapes for the native side.
- Added deterministic mock event trace generation in GA-shaped order:
  `runtime_ready`, `turn_start`, `turn_progress`, `turn_end`, `run_complete`.
- Added `NativeRuntimeEventBus` with same-process backlog replay and explicit
  stream close reasons.
- Allowed explicit `galley_native` session creation when the experimental gate
  is enabled.
- Added migration `021_native_session_runtime.sql` so `sessions.ga_runtime_kind`
  can store `galley_native`.
- Kept `managed` and `external` `session.new` on the existing Python
  `RunnerManager` path.
- Branched socket `session.new` so `galley_native` does not request Python spawn
  args and cannot fall through to external GA config errors.
- Persisted the native first turn through existing Galley session/message rows:
  user message, visible assistant message, session `turn_count`, and summary.
- Returned `assistantMessage` and `dispatch: "completed_native"` in the socket
  response for the native path.
- Allowed `session.watch` to fall back to the native event bus for hidden
  `galley_native` sessions and end with `native_run_complete`.
- Kept managed/external `session.watch` on the existing `RunnerManager`
  broadcast path.
- Kept `--llm` rejected for native mock sessions; there is no real model adapter
  yet.
- Kept native Goal rejected through a separate Goal runtime guard.

## Deliberate Non-Changes

- No Settings toggle, GUI picker, or default runtime switch.
- No real model adapter.
- No native tool registry or tool execution.
- No native memory, self-evolution, Browser Control, Goal Hive, or Morphling.
- No native `session.send`, `/btw`, stop, resume, or long-running autonomous
  loop.
- No GUI live projection yet. The native bus is hidden, same-process, and not a
  persisted event log across Core restart.
- No changes to `goal_proposals` / `goals` runtime CHECK constraints.

## Why This Shape

The point of this slice is to prove the product-safe runtime corridor:
`galley_native` can create a Galley-owned session and leave a visible transcript
without touching the Python GenericAgent runner or user-owned external GA state.

This keeps user risk low because ordinary users still see managed/external
runtimes only. Dogfooders get a narrow, inspectable path that proves DB schema,
socket routing, and turn persistence before the expensive model/tool/event work
starts.

## Verification

- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml dispatch_session_new_native_mock_persists_visible_turn --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml --test db_writes_test native`
- `cargo test --manifest-path cli/Cargo.toml --test m1_writes native_runtime`
- `cargo test --manifest-path cli/Cargo.toml --test m1_writes session_new_accepts_native_runtime_when_gate_enabled_and_reaches_socket`

`cargo fmt --check` currently reports pre-existing formatting diffs outside this
slice; it was not applied globally to avoid unrelated churn.

## Next

The next implementation should add the first real model adapter, still before
tools. GUI projection can then subscribe to the same native event shape once
model streaming has real content to show.
