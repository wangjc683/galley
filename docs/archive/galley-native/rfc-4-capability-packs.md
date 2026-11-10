# Galley Native RFC 4: Capability Packs

> Status: draft decision document.
>
> Scope: native capability-pack semantics, packaging, activation, self-evolved
> updates, permissions, tests, and migration boundaries. This RFC does not
> implement a plugin system or marketplace.

## Decision

`galley_native` should express GenericAgent's L3 SOP/script self-evolution as
Galley-owned capability packs.

A capability pack is a small, inspectable bundle of reusable agent behavior:

- trigger/index entries;
- SOP or instruction material;
- optional helper scripts;
- optional tool extensions;
- verification prompts or tests;
- permissions and activation policy;
- evidence-backed changelog.

V1 should use capability packs to productize GA's capability growth. It should
not become a broad plugin marketplace yet.

## Why This Matters For Users

The value of GA is not that it ships thousands of commands. The value is that it
can solve a hard task once, crystallize the reusable parts, and become faster
next time.

Native capability packs should make that self-evolution safer and more visible:

- users do not need to understand `memory/` files;
- reusable skills can be inspected, disabled, and rolled back;
- scripts have permissions and evidence;
- Project-specific know-how stays scoped;
- future imports do not mutate external GA checkouts.

## What A Pack Is

A capability pack is not necessarily a new model-facing tool.

Most packs should only add:

- L1 trigger entries;
- SOP text;
- small helper scripts callable by `code_run`;
- example prompts or verification tasks;
- memory references.

Only rarely should a pack add a new atomic tool schema. The 9 GA parity tools
remain the default model-facing surface.

## Pack Types

| Type | Owner | Examples |
|---|---|---|
| Built-in | Galley release | Browser Control SOP, Goal Hive, Morphling |
| User-evolved | Local Galley user state | personal workflow, local repo helper |
| Project | Project-scoped local state | repo-specific release checklist |
| Imported | User-approved copy from another source | managed GA memory import, future pack file |
| Experimental | Hidden/dogfood scope | native runtime development aids |

Built-in packs ship with Galley code. User-evolved and Project packs live in
Galley-owned user data.

## Conceptual Layout

The exact storage format can be database-backed, file-backed, or hybrid. The
conceptual package should contain:

```text
CapabilityPack
  manifest
  instructions
  sops
  scripts
  tests
  memory_index
  permissions
  changelog
```

Suggested manifest fields:

```text
schemaVersion
id
displayName
description
version
origin: builtin | user_evolved | project | imported | experimental
scope: global | project | workspace
activation
triggers
permissions
tools?
scripts
tests
memoryItems
createdAt
updatedAt
```

Do not require users to see this structure in normal workflows.

## Activation

Activation controls when a pack enters the native prompt/tool environment.

Activation modes:

- always available built-in;
- Project-scoped;
- workspace-scoped;
- session-requested;
- Goal-mode;
- Morphling-mode;
- disabled.

Prompt exposure should still use existence encoding. Activating a pack does not
mean injecting every SOP and script into the prompt. It means making the pack's
triggers and resource pointers visible.

## Resource Paths

Packs can expose model-readable resources through the same resource scheme used
by native memory:

```text
capability://browser-control/sops/setup
capability://morphling/sops/main
capability://project-release/scripts/release_check.py
capability://code-review/tests/basic_review
```

The model can read these with `file_read`. Scripts can be executed through
`code_run` only when permissions allow.

## Permission Model

Every pack should declare what it may do.

Permission classes:

- read workspace files;
- write workspace files;
- execute local commands;
- use network;
- use browser;
- access configured credential references;
- create scheduled/long-running tasks;
- write native memory;
- add model-facing tool schemas.

Permissions are policy inputs, not user-facing clutter. The UI should show them
when a pack is installed, updated, or blocked.

## Scripts

Scripts are reusable helpers, not trusted core runtime code.

Rules:

- scripts run through `code_run` or a dedicated tool executor;
- scripts inherit workspace and approval policy;
- scripts may not embed secrets;
- scripts should be small and testable;
- generated scripts need evidence and a changelog entry;
- deleting or replacing a script should be reversible.

If a script becomes important enough to deserve core-runtime status, that is a
separate implementation decision, not automatic self-evolution.

## Tool Extensions

V1 should avoid new atomic tools unless there is strong evidence that a pack
cannot work through the 9-tool surface.

If a pack proposes a new tool schema, it must include:

- purpose and model-facing description;
- input schema;
- executor owner;
- permission policy;
- approval behavior;
- tests;
- fallback path using existing tools;
- explicit user or maintainer approval.

Tool extension is a high-risk capability-pack operation because it changes what
the model can ask the runtime to do.

## Self-Evolution Flow

Capability-pack updates should be a specialized output of native memory
distillation.

```text
verified task
  -> reusable pattern detected
  -> candidate pack update
  -> script/SOP/test proposal
  -> permission and risk review
  -> apply as new version
  -> update L1 triggers
  -> emit pack-change event
```

The candidate must include:

- evidence from successful tool execution;
- why the ability will recur;
- what changed;
- how to test it;
- what permissions it needs;
- rollback plan.

This keeps self-evolution from becoming invisible prompt drift.

## Tests And Verification

Every non-trivial pack should carry tests or verification prompts.

Test levels:

- static validation: manifest, paths, permissions;
- script smoke: helper script runs in a temp workspace;
- SOP prompt test: mock model can discover and follow the resource;
- integration scenario: native loop solves a representative task;
- regression scenario: known failure stays fixed.

Morphling-produced packs should include same-test comparison evidence whenever
the absorbed target has runnable tests.

## Built-In Seed Packs

Native V1 should likely start with a small set:

- Browser Control;
- Goal Hive;
- Morphling;
- memory management;
- project/workspace workflow;
- code review;
- autonomous operation.

These are not all new tools. Most are SOP/resource packs that guide the 9-tool
loop.

## Project Packs

Project packs are capability packs scoped to one Galley Project.

They can contain:

- repo-specific SOPs;
- local scripts;
- verified build/test/release commands;
- Project-specific checklist prompts;
- migration or deployment notes.

They should not leak into global memory unless a separate long-term update
classifies the lesson as generally reusable.

## Morphling Output

Morphling should often produce or update a capability pack.

Expected output:

- target capability definition;
- tests or benchmark tasks;
- component strategy: call, rewrite, discard;
- helper scripts or integration notes;
- SOP for future use;
- same-test comparison;
- activation triggers;
- permission declaration.

This gives Morphling a durable product shape: not just "we solved that repo",
but "Galley can now do that kind of work again."

## UI Expectations

Capability packs should be mostly invisible until they matter.

Expected surfaces:

- compact pack list in Settings or a future Memory/Capabilities view;
- Project-level pack list for Project packs;
- install/update/disable/rollback controls;
- permissions and evidence display for risky packs;
- timeline event when a task creates or updates a pack;
- disabled-state explanation when a pack cannot run.

Do not put a pack marketplace or large capability browser in V1 onboarding.

## Migration And Import

Native should not mutate GA memory, skills, or SOP directories.

Possible future imports:

- managed GA memory/SOP copied into native candidate packs;
- external GA memory copied only by explicit user action;
- local folder import;
- signed Galley pack file.

Import rules:

- copy, never link;
- classify before activation;
- show permissions;
- require approval for scripts or tool extensions;
- leave the source unchanged.

## Versioning And Rollback

Every pack update should create a versioned change record.

Rollback should restore:

- manifest;
- SOP/instruction text;
- scripts;
- tests;
- memory index entries;
- activation state where feasible.

If rollback cannot fully undo external effects created by a script, the UI and
approval copy must say so before the script runs.

## Security Boundaries

Capability packs must not:

- store raw secrets;
- silently broaden permissions;
- modify core runtime code;
- write external GA state;
- bypass approval policy;
- open remote transports for Galley Core;
- install scheduled tasks without explicit approval;
- turn temporary Goal protocol state into reusable memory.

Credentials should be referenced through Galley's credential store, not written
into pack files.

## Implementation Order

1. Define pack manifest and validation rules.
2. Add built-in pack registry for native-only resources.
3. Expose pack resources through `file_read`.
4. Connect pack triggers to L1 native memory.
5. Add script execution through existing `code_run` policy.
6. Add pack change records and rollback.
7. Add self-evolved SOP/script proposals.
8. Add Project packs.
9. Add import path only after native memory is stable.
10. Consider tool-schema extensions last.

## Acceptance Checks Before Code

Before implementing capability packs, the design should answer:

- What pack metadata is required for activation?
- Where do built-in packs live versus user-evolved packs?
- How does a model discover a pack without prompt flooding?
- How are scripts executed and approved?
- Which pack updates can apply automatically?
- How does rollback work?
- How does Morphling produce a durable pack?
- How does native avoid turning this into an unbounded plugin marketplace?

## Rejected Alternatives

### Build A Marketplace First

Rejected because Galley Native first needs a safe local capability substrate.
Discovery and distribution can come later.

### Treat Every Pack As A Tool

Rejected because the GA design works by composing a small atomic tool set with
SOPs and scripts. Making every capability a tool would bloat the prompt and
approval surface.

### Let Packs Patch Core Runtime Code

Rejected because self-evolution must not silently change Galley's trusted core.
Core runtime changes require normal implementation and review.

### Install Into External GA Memory

Rejected because external GA is user-owned. Native can import by copy with user
approval, but it must not write external memory/SOP/skills.
