# Galley Native Slice 5A Working Checkpoint

**Date:** 2026-06-17  
**Status:** Landed  
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Native Memory RFC](../galley-native/rfc-3-native-memory.md),
[Slice 4 Completion](./2026-06-17-galley-native-slice-4-completion.md)

## Context

Slice 4 closed the native file/code/browser tool boundary. The next memory
slice should not jump directly to durable self-evolution. The safer first cut is
`update_working_checkpoint`: short-lived session state that helps the selected
native model remember what it was doing across turns without creating long-term
memory or capability-pack changes.

This matches the native memory RFC boundary: working checkpoints are runtime
state, not durable L1-L4 memory.

## Decisions

- `update_working_checkpoint` is no longer a Slice 4A stub.
- The tool accepts a non-empty `content` argument, with `checkpoint` and
  `summary` as aliases.
- Optional `status` / `state` is normalized to a lowercase status string and
  defaults to `active`.
- Checkpoint content is capped at 16 KiB before it can become a tool result.
- Successful results are persisted in the assistant turn's `tool_results` as
  session-local working state and do not set `sideEffectsPerformed`.
- Successful checkpoint results trigger one continuation model request so the
  user gets a normal assistant answer after the model records state.
- Future native model turns read the latest successful checkpoint from prior
  assistant `tool_results` and inject it as compact context in the model input.
- The model input checkpoint copy is capped at 8 KiB.

## Rejected Alternatives

- Add a new database table immediately. Rejected for this first cut because the
  assistant `tool_results` audit stream already provides session-local
  persistence and rollback-by-history without committing to a durable memory
  schema.
- Treat working checkpoints as durable memory. Rejected because durable memory
  requires evidence, diffs, review/undo, and secret handling.
- Skip continuation after checkpoint. Rejected because users should not be left
  looking at a tool-only turn when the model records working state.

## Still Deferred

- `start_long_term_update` durable memory/capability pipeline.
- Native memory item/change tables.
- Memory resource reads through `memory://`.
- Capability-pack registry and `capability://` resources.
- Secret detection and memory undo.

## Verification

- `cargo test --manifest-path core/Cargo.toml update_working_checkpoint --lib`
- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

Start the durable memory substrate with the smallest reversible shape: memory
change records with evidence pointers, status, and undo metadata, before adding
automatic long-term updates.
