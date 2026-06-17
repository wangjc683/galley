# Galley Native Slice 7 Goal Hive

Date: 2026-06-17

Slice 7 opens the first hidden `galley_native` Goal Hive path. This is a
minimum Core-owned loop, not full Morphling and not a replacement for stable
managed/external Goal yet.

## Landed

- `goal_proposals` and `goals` now allow `runtime_kind = galley_native` behind
  `GALLEY_NATIVE_EXPERIMENTAL=1`.
- Native `session.goal_master_plan` persists planning context as
  `visibility = internal` and returns to the controller immediately.
- The controller materializes native worker answers into task claim/completion,
  result events, and deliverable-anchor versions.
- Native `session.goal_synthesize` runs inline through the Rust native runtime
  and writes the final answer back to the master session.
- Native worker cleanup skips Python runner shutdown.
- Goal prompts now describe native Goal as Core-owned and ban Goal protocol
  state from native memory.

## User Impact

Ordinary users still default to managed/external Goal behavior. For hidden
native dogfood, the value is state ownership: tasks, results, and deliverables
are inspectable in Galley Core even when the worker is a Rust-native session.

## Boundaries

- Native master planning V1 does not yet expose a typed model-callable Goal
  mutation tool.
- The controller seed/fallback path is intentionally conservative.
- Very fast native/mock workers can advance waves quickly under existing
  sustained-budget semantics; pacing/backoff is a later polish slice.
- Morphling remains Slice 8+.

## Verification

- Added socket tests for native Goal proposal acceptance, internal native master
  planning, and inline native final synthesis.
- Added prompt tests for native Goal memory/policy wording.
- Updated the RFC, implementation slices, agent API, and Galley Native index.
