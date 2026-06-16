# Galley Native Runtime Checkpoint

**Date**: 2026-06-16
**Status**: Decided, documentation checkpoint
**Related**: [Galley Native](../galley-native/README.md), [managed GA runtime](../managed-ga-runtime.md), [GA baseline](../ga-baseline.md), [Galley Goal V1](./2026-06-04-galley-goal-v1.md)

## Context

JC asked whether further productizing Galley around built-in GA users should
eventually mean rewriting the bundled GenericAgent runtime in Rust. The first
framing was "make built-in GA fully Rust," but the discussion clarified the
actual product direction:

```text
managed_ga today -> galley_native as future default -> external_ga as advanced compatibility
```

The important correction was that `galley_native` V1 should not be a clean-room
agent experiment. GenericAgent already works well inside Galley and has mature
behavior around memory, tools, browser control, autonomous execution, Goal Hive,
and Morphling. The native runtime should therefore start as a Rust semantic port
of GA's core, then deepen into a Galley-owned product kernel.

The official GenericAgent source was checked in read-only mode before writing
the checkpoint:

```text
official latest audited: 8e9b04e1657bd337439c9e1a0a1273b3b4d1e0ac
commit date: 2026-06-16 11:27:31 +0800
commit title: Update agent docs and task help

Galley managed baseline: 0def744157916f0c88da69f710941e4c408b3768
baseline audit date: 2026-06-12
```

The delta from Galley's current managed baseline to official latest is one
commit, touching 32 files. It does not change the core agent loop shape, but it
does add relevant product semantics: `/workspace`, `@` file completion, in-place
and copy-continue session handling, Project Mode activation refinements, and TUI
task-help updates.

## Decisions

- Add `docs/galley-native/runtime.md` as the focused living semantic charter.
  It defines what `galley_native` must preserve from GA, what Galley owns, and
  what should not be carried forward.
- `galley_native` V1 is a GA Rust semantic port, not a clean-room agent and not
  a line-by-line Python translation.
- V1 success standard is replacement quality: it should be capable of becoming
  the default built-in runtime for new users, while `managed_ga` remains as a
  fallback during migration.
- The official GA semantic reference is locked to
  `8e9b04e1657bd337439c9e1a0a1273b3b4d1e0ac`, not floating `main`.
- The core GA traits to preserve are:
  - context information density;
  - 9 atomic tools;
  - hierarchical L1-L4 memory;
  - verified self-evolution;
  - autonomous / reflect loops;
  - browser and system control;
  - Goal Hive social structure;
  - Morphling as long-horizon capability absorption.
- Native maps GA behavior into Galley-owned objects: Rust runtime engine, model
  adapters, tool registry, memory store, capability packs, Project workspace,
  Core-owned Goal task board, and event streams.
- Project and workspace are reconnected only for `galley_native`: a Project may
  optionally bind one primary workspace path. This affects native sessions only.
  `managed_ga` and `external_ga` keep the current boundary.
- Projects without a workspace remain valid. Galley still supports pure
  grouping for conversations.
- Goal Hive stays Core-owned. Native should preserve GA's master/worker social
  discipline and sustained budget semantics, but should not inherit GA's HTTP
  BBS or text-file protocol state.
- Morphling is treated as a first-class advanced mode built on Goal Hive,
  browser control, file/code tools, memory, and verification. It is not a
  single low-level tool.
- Self-evolution is allowed for Galley-owned memory/SOP/capability material
  when grounded in verified work. It does not imply automatic edits to runtime
  core code, credentials, provider config, or external GA state.
- Do not update `AGENTS.md` for this yet. The current result is planning
  documentation, not a global rule every coding agent must read on startup.
- A read-only Slice 1 audit was added after the RFC set. It confirms that the
  first implementation slice should be runtime identity plus router boundary,
  not the first native model/tool slice. It also records the current coupling
  across Rust API types, SQLite CHECK constraints, socket commands, CLI args,
  LLM resolution, Python runner ownership, GUI runtime unions, and public API
  docs.

## Rejected

- **Continue with `managed_ga` as the long-term core**: it works now, but it
  leaves built-in users dependent on Python packaging, upstream drift, patch
  stack rebases, and translated events. Good transition path, weak final kernel.
- **Clean-room native agent**: architecturally tempting, but too likely to lose
  the real behaviors that make GA useful. It would produce a tidy engine before
  proving it can do long-horizon local work as well as GA.
- **Line-by-line Rust translation of GA**: preserves too much accidental Python
  shape, including file layout and implementation shortcuts. The target is
  semantic parity, not source parity.
- **Revive Project `rootPath -> cwd` for all runtimes**: this already caused a
  silent GA memory failure and was rolled back. Native can have Project
  workspace semantics because native owns memory and tools; managed/external GA
  must not inherit that behavior.
- **Use GA native HTTP BBS for Goal Hive**: the social model is valuable, but
  Galley already has a better product boundary through Core-owned Goal state,
  task board, events, and master-session delivery.
- **Treat Morphling as a small tool**: it is a long-horizon work protocol that
  coordinates tests, component strategy, implementation, comparison, and memory
  absorption.
- **Turn this checkpoint into an implementation task list**: premature. The
  first artifact needed is a semantic charter and decision snapshot.

## Open Questions

- Exact Rust model-adapter shape for OpenAI-compatible, Anthropic-compatible,
  Responses-style tool calls, usage accounting, retry, and history. Seeded by
  [RFC 2: Model And Tool Loop](../galley-native/rfc-2-model-tool-loop.md), but
  not yet implementation-ready.
- Runtime boundary details for `galley_native` entry, event ownership, API
  compatibility, and migration gates. Seeded by
  [RFC 1: Runtime Boundary](../galley-native/rfc-1-runtime-boundary.md), but
  still needs implementation design before code.
- Capability-pack file format, validation, upgrade behavior, and user-facing
  inspection/approval flow. Seeded by
  [RFC 4: Capability Packs](../galley-native/rfc-4-capability-packs.md), but
  still needs implementation design before code.
- Native memory UI: how to inspect, edit, diff, approve, and delete L1-L4
  material without making memory noisy. Seeded by
  [RFC 3: Native Memory](../galley-native/rfc-3-native-memory.md), but still
  needs product/UI design before code.
- Project workspace UX: where users bind a workspace, how native sessions
  inherit it, and how GUI file mentions should work. Seeded by
  [RFC 5: Workspace And Session Continuity](../galley-native/rfc-5-workspace-session-continuity.md),
  but still needs implementation design before code.
- Session continuity policy: in-place continue, copy continue, occupied native
  sessions, and Supervisor-driven follow-ups. Seeded by
  [RFC 5: Workspace And Session Continuity](../galley-native/rfc-5-workspace-session-continuity.md),
  but still needs implementation design before code.
- Parity harness: how to compare `managed_ga` and `galley_native` on the same
  tasks while accounting for model non-determinism. Seeded by
  [RFC 7: Parity Harness And Default Switch](../galley-native/rfc-7-parity-harness-default-switch.md).
- Migration path: when new users default to native, what happens to existing
  managed sessions, and whether "copy to native" is a first-party action.
- Safety policy for native tool scopes, YOLO, workspace-bound approvals, and
  self-evolution.

## Next

1. Review `docs/galley-native/runtime.md`,
   `docs/galley-native/rfc-1-runtime-boundary.md`,
   `docs/galley-native/rfc-2-model-tool-loop.md`,
   `docs/galley-native/rfc-3-native-memory.md`,
   `docs/galley-native/rfc-4-capability-packs.md`,
   `docs/galley-native/rfc-5-workspace-session-continuity.md`,
   `docs/galley-native/rfc-6-goal-hive-morphling.md`, and
   `docs/galley-native/rfc-7-parity-harness-default-switch.md` for product and
   semantic accuracy.
2. After these settle, convert the accepted RFCs into implementation slices:
   runtime router skeleton, native loop skeleton, tool control plane, local
   file/code tools, Browser Control tools, memory/capability substrate,
   workspace/continuity, Goal/Morphling, and parity gates.
   Seeded by [Implementation Slices](../galley-native/implementation-slices.md).
3. Settle the pre-freeze decisions in
   [Open Decisions](../galley-native/open-decisions.md) before Slice 1 code.
4. Review the Slice 1 pre-implementation audit:
   [Slice 1 Read-Only Audit](../galley-native/slice-1-readonly-audit.md).
5. Keep `managed_ga` stable while designing native; no code, schema, or runtime
   behavior changes are implied by this checkpoint.
6. If implementation starts later, begin with a native runtime skeleton behind
   an experimental flag and keep `managed_ga` as the fallback until native meets
   replacement quality.
