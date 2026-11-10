# Galley Native

> **ARCHIVED 2026-11-10** — The native runtime these documents planned was
> abandoned on 2026-06-17 and never shipped on `main`. Migration
> `025_restore_managed_runtime_default.sql` (commit `81418db6`, 2026-06-17)
> calls it "the abandoned Galley Native experiment" and moves any persisted
> `galley_native` runtime back to `managed`; the compatibility note in
> [code state and patches](../../managed-ga-runtime/code-state-and-patches.md)
> says why migrations `021`–`024` stay. No rule here is current: the bundled
> managed GA runtime is Galley's engine
> ([managed GA runtime](../../managed-ga-runtime/README.md)).

Design documents for `galley_native`: GenericAgent's Rust semantic port plus
Galley's product-owned native runtime kernel.

These documents are planning artifacts. They do not imply runtime, schema, or
behavior changes until an implementation slice explicitly lands them.

## Read Order

1. [Runtime Charter](./runtime.md)
2. [RFC 1: Runtime Boundary](./rfc-1-runtime-boundary.md)
3. [RFC 2: Model And Tool Loop](./rfc-2-model-tool-loop.md)
4. [RFC 3: Native Memory](./rfc-3-native-memory.md)
5. [RFC 4: Capability Packs](./rfc-4-capability-packs.md)
6. [RFC 5: Workspace And Session Continuity](./rfc-5-workspace-session-continuity.md)
7. [RFC 6: Goal Hive And Morphling](./rfc-6-goal-hive-morphling.md)
8. [RFC 7: Parity Harness And Default Switch](./rfc-7-parity-harness-default-switch.md)
9. [Open Decisions](./open-decisions.md)
10. [Implementation Slices](./implementation-slices.md)

## Document Roles

- [Runtime Charter](./runtime.md): semantic charter for what native must
  preserve from GenericAgent and where Galley takes ownership.
- [RFC 1](./rfc-1-runtime-boundary.md): runtime identity, API/schema boundary,
  event ownership, routing, Project/workspace scope, and migration phases.
- [RFC 2](./rfc-2-model-tool-loop.md): model adapters, canonical message shape,
  the 9 GA parity tools, approvals, memory flow, Goal Hive, and Morphling.
- [RFC 3](./rfc-3-native-memory.md): typed Galley-owned memory, L1-L4 semantics,
  evidence-backed updates, resource paths, UI, and migration.
- [RFC 4](./rfc-4-capability-packs.md): productized SOP/script capability
  growth, activation, permissions, tests, self-evolved updates, and rollback.
- [RFC 5](./rfc-5-workspace-session-continuity.md): native-only workspace
  binding, tool roots, file mentions, restore, occupancy, and continue/copy.
- [RFC 6](./rfc-6-goal-hive-morphling.md): native Goal master/worker semantics,
  deliverable anchors, Goal workspaces, Morphling flow, and capability
  absorption.
- [RFC 7](./rfc-7-parity-harness-default-switch.md): managed-vs-native parity
  testing, dogfood gates, rollout phases, rollback, and managed retirement.
- [Open Decisions](./open-decisions.md): pre-freeze decisions needed before
  Slice 1 starts.
- [Implementation Slices](./implementation-slices.md): sequencing and
  acceptance gates for future implementation.

## Next After Review

After these RFCs settle, convert the accepted design into implementation slices:

1. review [Open Decisions](./open-decisions.md);
2. review [Implementation Slices](./implementation-slices.md);
3. accept or revise the slice gates, including the 4A/4B/4C tool split;
4. start with Slice 1 only: runtime router skeleton.
