# Galley Native Slice 1 Runtime Router

**Date**: 2026-06-16
**Status**: Implemented, hidden experimental identity
**Related**: [Galley Native](../galley-native/README.md), [Slice 1 Read-Only Audit](../galley-native/slice-1-readonly-audit.md), [Agent API](../agent-api.md)

## Summary

Slice 1 adds `galley_native` as a recognized runtime identity, but does not make
it executable.

The implementation intentionally stops before native model calls, native tools,
memory, Browser Control, Goal Hive, Morphling, DB persistence for native session
rows, or any default switch.

## What Landed

- Added `RuntimeKind::GalleyNative`, serialized as `galley_native`.
- Added `core/src/runtime.rs` for:
  - `GALLEY_NATIVE_EXPERIMENTAL=1` gate parsing;
  - runtime route classification;
  - shared unavailable/error messages.
- Made Python runner paths route through `RuntimeRoute` instead of binary
  `managed ? managed : external` logic.
- Added explicit native-unavailable handling for:
  - direct `spawn_runner`;
  - socket `session.new` / `session.new_goal_worker`;
  - LLM resolution;
  - direct Core session creation;
  - Goal proposal creation.
- Added CLI `--runtime galley-native` with `galley_native` alias.
- Kept native hidden:
  - gate off: native filters/requests return `invalid_args`;
  - gate on: read filters can recognize native, but session/Goal execution
    still returns `invalid_args` because no native worker exists.
- Updated GUI runtime union types so future native values do not get mislabeled
  as external.
- Updated Agent API docs with the hidden CLI and JSON enum values.

## Deliberate Non-Changes

- No SQLite migration was added.
- Native session rows are not persisted yet.
- `active_runtime_kind` does not become native by default. If a dogfood pref is
  left as native while the env gate is off, Core falls back to the managed or
  external default.
- No visible Settings toggle was added.
- `RunnerManager` remains Python-runner-specific.
- Public IPC streams still emit the existing Python-shaped events for managed
  and external runtimes.

## Why This Shape

The user-facing risk in Slice 1 was accidental fallthrough. Before this slice,
several high-risk paths treated "not managed" as external. Adding an enum
variant without a router would have made native requests fail with unrelated
external GA path/config errors.

The new behavior is more honest: Galley can recognize native, but clearly says
that execution is not available yet.

## Verification

- `cargo check` in `core/`
- `cargo check` in `cli/`
- `cargo test` in `core/`
- `cargo test` in `cli/`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

Slice 2 can add a native worker skeleton with a mock model and no tools. It
should not start until this hidden identity behavior is reviewed.
