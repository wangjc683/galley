# Galley Native Slice 5D Memory Apply And Capability Resources

**Date:** 2026-06-17
**Status:** Landed
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Native Memory RFC](../galley-native/rfc-3-native-memory.md),
[Capability Packs RFC](../galley-native/rfc-4-capability-packs.md),
[Slice 5B Memory Substrate](./2026-06-17-galley-native-slice-5b-memory-substrate.md),
[Slice 5C Memory Resource Read](./2026-06-17-galley-native-slice-5c-memory-resource-read.md)

## Context

Slice 5B created the native memory ledger and Slice 5C made memory readable
through `file_read`. The next useful user-facing step was to let native learn a
small, low-risk fact without forcing the human through an approval modal, while
still preventing capability/script self-modification from becoming implicit
runtime power.

## Decisions

- `start_long_term_update` now auto-applies low-risk text memory updates.
- Each applied update creates evidence, a memory item, L1 index entries, and an
  auto-applied `native_memory_changes` create record.
- Core can revert create changes: the item is marked `deleted`, related index
  entries are removed, and the change is marked `reverted`.
- Candidate memory text is rejected when it appears to contain a raw secret.
- High-risk memory, capability, pack, script, tool, browser, and Morphling-style
  updates still stop at approval or return an explicit unsupported result.
- Tool timelines use existing `tool_progress` and `tool_end` events to show
  memory writes and side effects; no new event kind was added.
- Built-in read-only capability packs now exist for Goal Hive, Morphling, and
  Browser Control.
- `file_read` can read `capability://index`, pack manifests, and pack SOP/test
  resources without adding a new tool.
- Active memory L1 resources include capability trigger pointers.
- `code_run` refuses `capability://` script execution until a
  materialize-by-hash approval path exists.

## Rejected Alternatives

- Auto-apply capability pack or script updates. Rejected because those alter
  future runtime behavior and need approval, evidence, tests, and rollback.
- Execute pack scripts directly from `capability://`. Rejected because V1 lacks
  a safe materialization path, hash verification, and rollback semantics.
- Add a new `capability_read` or `memory_read` tool. Rejected because the GA
  parity surface should stay at nine tools and route read-only resources through
  `file_read`.
- Add GUI inspect/undo now. Rejected for this slice because the Core ledger and
  runtime semantics needed to land first.

## Still Deferred

- GUI/CLI inspect and undo flows for native memory changes.
- Pack change records and rollback.
- Self-evolved SOP/script proposals.
- Project and workspace capability packs.
- Executable capability scripts through a materialize-by-hash approval path.
- Full Goal Hive and full Morphling behavior.

## Verification

- `cargo check --manifest-path core/Cargo.toml`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml native_tools --lib`
- `cargo test --manifest-path core/Cargo.toml native_memory --test db_writes_test`

## Next

Add inspect/undo surfaces and a parity harness that exercises `memory://`,
`capability://`, and low-risk `start_long_term_update` before considering
dynamic pack updates or script execution.
