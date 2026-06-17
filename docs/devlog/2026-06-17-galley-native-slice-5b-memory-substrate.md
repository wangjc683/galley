# Galley Native Slice 5B Memory Substrate

**Date:** 2026-06-17
**Status:** Landed
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Native Memory RFC](../galley-native/rfc-3-native-memory.md),
[Slice 5A Working Checkpoint](./2026-06-17-galley-native-slice-5a-working-checkpoint.md)

## Context

Slice 5A made short-lived working checkpoints real without creating durable
memory. The next native memory step should still avoid letting the model write
long-term state directly. The required foundation is a typed ledger that can
represent memory items, routing index entries, evidence, and changes before
`start_long_term_update` is wired to write anything.

This keeps the user-facing risk low: no new GUI surface, no hidden automatic
memory writes, and no import from managed or external GA state.

## Decisions

- Added migration `022_native_memory_substrate.sql`.
- Added `native_memory_items` for typed L1-L4 durable memory records.
- Added `native_memory_index_entries` for compact trigger routing into memory
  items.
- Added `native_memory_evidence` for execution evidence pointers and summaries.
- Added `native_memory_changes` for create/update/supersede/delete change
  records with diff JSON, evidence ids, risk, approval state, and apply/revert
  timestamps.
- Added typed Core helper methods under `db::native_memory` for creating and
  reading memory items, evidence, index entries, and changes.
- The schema and helper reject memory changes without evidence ids.
- The schema distinguishes `global_user`, `project`, `workspace`, and
  `capability_pack` scopes through `scope_kind` / `scope_key`.

## Rejected Alternatives

- Wire `start_long_term_update` immediately. Rejected because the write policy,
  secret rejection, and undo path need a ledger before the tool can be safe.
- Store native memory as markdown files. Rejected because Galley needs identity,
  evidence, diffs, scope, and rollback, not just appendable text.
- Add a public Agent API surface now. Rejected because no user or supervisor
  workflow should depend on native memory rows until the runtime write/read
  semantics are proven.

## Still Deferred

- `start_long_term_update` runtime integration.
- Low-risk apply + undo helpers that mutate existing memory items.
- Secret detection and credential-reference redirects.
- `memory://` read-only resources through `file_read`.
- Timeline events and GUI inspect/undo surfaces.
- Capability-pack registry and `capability://` resources.

## Verification

- `cargo test --manifest-path core/Cargo.toml native_memory --test db_writes_test`
- `cargo test --manifest-path core/Cargo.toml --test db_test`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

Add the smallest read path next: expose safe `memory://` resources through
`file_read` without adding a 10th tool, then wire `start_long_term_update`
against this ledger with secret checks and undo metadata.
