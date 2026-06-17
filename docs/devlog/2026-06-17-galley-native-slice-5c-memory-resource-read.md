# Galley Native Slice 5C Memory Resource Read

**Date:** 2026-06-17
**Status:** Landed
**Related:** [Galley Native](../galley-native/README.md),
[Implementation Slices](../galley-native/implementation-slices.md),
[Native Memory RFC](../galley-native/rfc-3-native-memory.md),
[Slice 5B Memory Substrate](./2026-06-17-galley-native-slice-5b-memory-substrate.md)

## Context

Slice 5B created the native memory ledger, but the runtime still had no way to
read that ledger through the GA-compatible 9-tool surface. The next safe step is
read-only exposure through `file_read`, not a new `memory_read` tool and not
automatic long-term writes.

This preserves the small GA tool shape while letting the selected native model
discover compact L1 pointers and then request deeper L2/L3/L4 item bodies.

## Decisions

- `file_read` can now read pre-rendered `memory://` resources from the native
  tool execution context.
- Native runtime pre-renders global memory resources for every native session.
- Native runtime also pre-renders Project memory resources when the session is
  assigned to a Project.
- Supported resource shapes include:
  - `memory://global/l1`
  - `memory://global/l2`
  - `memory://global/l2/<item-id>`
  - `memory://project/<project-id>/l1`
  - `memory://project/<project-id>/l2`
  - `memory://project/<project-id>/l2/<item-id>`
  - The same pattern for `l3` and `l4`.
- `memory://` reads never require approval and always report
  `sideEffectsPerformed=false`.
- Missing memory resources fail with a list of available `memory://` resources
  for the current session.
- The native system prompt now tells the model that `file_read` can read
  read-only `memory://` resources when available.

## Rejected Alternatives

- Add a dedicated `memory_read` tool. Rejected because the V1 parity target is
  still the GA 9-tool surface.
- Query SQLite directly from `native_tools`. Rejected because tool executors
  should stay deterministic over a prepared execution context; runtime owns DB
  access.
- Inject full memory bodies into the model prompt. Rejected because the RFC
  favors existence encoding and on-demand reads to preserve context density.

## Still Deferred

- `start_long_term_update` runtime write path.
- Secret detection before memory writes.
- Low-risk apply + undo helpers.
- Dedicated memory read logs beyond the persisted `file_read` tool result.
- GUI memory inspector and inspect/undo surface.
- Capability-pack `capability://` resources.

## Verification

- `cargo test --manifest-path core/Cargo.toml file_read --lib`
- `cargo test --manifest-path core/Cargo.toml native_memory --test db_writes_test`
- `cargo test --manifest-path core/Cargo.toml native_memory_l1 --lib`
- `cargo test --manifest-path core/Cargo.toml native_model --lib`
- `cargo test --manifest-path core/Cargo.toml native_runtime --lib`
- `cargo test --manifest-path core/Cargo.toml --test db_test`
- `cargo check --manifest-path core/Cargo.toml`
- `cargo check --manifest-path cli/Cargo.toml`
- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`
- `git diff --check`

## Next

Wire `start_long_term_update` to produce evidence-backed memory candidates
against the Slice 5B ledger, with secret checks and undo metadata before any
automatic durable write is allowed.
