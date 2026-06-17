# Galley Native Runtime

> Living semantic charter for `galley_native`.
>
> This document is intentionally not an implementation playbook yet. It defines
> what must be preserved from GenericAgent, what must become Galley-owned, and
> what must not be carried forward.

## Position

`galley_native` is Galley's v0.3.0 target default built-in agent runtime.

It is not a clean-room agent experiment and not a line-by-line Rust translation
of GenericAgent. The first version is a Rust semantic port of GenericAgent's
proven core, then a Galley-owned product kernel can evolve from that base.

Runtime roles:

- `galley_native`: v0.3.0 target default runtime for built-in Galley users.
- `managed_ga`: legacy Python fallback under Advanced. It keeps the current
  built-in experience available for recovery while native dogfood reaches
  release quality.
- `external_ga`: advanced compatibility runtime for users who own an existing
  GenericAgent checkout. It remains non-invasive and may expose a smaller
  feature surface than native.

V1 must be good enough to replace `managed_ga` as the default for built-in
users in v0.3.0, while keeping `managed_ga` as an Advanced fallback during the
migration window.

## Reference Source

The semantic reference is official GenericAgent at:

```text
lsdefine/GenericAgent
commit: 8e9b04e1657bd337439c9e1a0a1273b3b4d1e0ac
commit date: 2026-06-16 11:27:31 +0800
commit title: Update agent docs and task help
```

Galley's current managed baseline at the time of this planning checkpoint is:

```text
0def744157916f0c88da69f710941e4c408b3768
audit date: 2026-06-12
```

The delta from Galley's managed baseline to the official reference is one
upstream commit. It does not rewrite the core agent loop, but it does add or
change behavior that matters for native design:

- `/workspace` support and per-agent Project Mode activation.
- `@` file completion logic for project/file context ergonomics.
- `/continue` session occupancy, heartbeat locks, in-place continue, and
  copy-continue semantics.
- TUI and task-help updates that reinforce workspace and session continuity.
- Tool schema cleanup: `file_read.keyword` is removed from the public schema,
  although the implementation still has a keyword path.
- `webbrowser.open` replaces platform-specific `os.startfile` for the implicit
  Browser Control recovery page.
- `skill_search` seed is removed from the official memory payload.

Native design should use the fixed SHA above, not floating `main`.

## Core Semantics To Preserve

GenericAgent's value is not Python. Its value is a compact set of agent
semantics optimized for long-horizon local work.

`galley_native` must preserve these traits.

### Context Information Density

The runtime should maximize useful decision information per token, not merely
maximize context length. The loop should keep the active prompt small while
making deeper state discoverable through tools and memory pointers.

Required behaviors:

- Keep the core system prompt compact.
- Compress or summarize older high-volume content.
- Avoid injecting large memory bodies every turn.
- Make existence of deeper memory visible through short pointers.
- Refresh tool descriptions only when useful, rather than paying their full
  token cost every turn.

### Minimal Atomic Tools

V1 must preserve GA's 9-tool surface as the native parity set:

```text
code_run
file_read
file_patch
file_write
web_scan
web_execute_js
update_working_checkpoint
ask_user
start_long_term_update
```

The product point is not that these exact names are perfect forever. The point
is that a small orthogonal tool set lets the agent compose capabilities instead
of relying on a large brittle menu of preloaded skills.

Native may add Galley-facing metadata around tools: risk level, approval scope,
progress events, result previews, and audit fields. The model-facing capability
should stay minimal unless there is strong evidence that adding a tool reduces
real user friction.

### Autonomous Execution Loop

The loop must preserve GA's autonomous multi-turn behavior:

- A user task can run multiple model/tool turns without asking the user after
  every step.
- Each turn produces or derives a short summary.
- Tool results feed the next turn as compact context.
- The loop stops on completion, `ask_user`, explicit abort, max-turn guard, or
  a runtime error.
- Repeated failure should trigger probing, checkpointing, strategy change, or
  user escalation instead of blind retries.
- `no_tool` remains a semantic outcome: no tool call can mean final answer,
  malformed response recovery, or "large code block but no tool" intervention.

Galley may change the implementation from generator-based Python to typed Rust
events, but the visible work rhythm should stay familiar.

### Hierarchical Memory

Native memory must preserve GA's layered memory idea:

```text
L1: compact existence index and high-ROI rules
L2: verified environment facts and stable user/project facts
L3: reusable SOPs, scripts, and focused capability notes
L4: compressed historical session material for mining and recall
```

The important rule is "existence encoding": L1 tells the model what kinds of
knowledge exist and when to look deeper. L1 is not a place to store the
knowledge itself.

Native memory is Galley-owned state. It must not write into an external
GenericAgent checkout. It also must not treat transient Goal protocol fields,
temporary session ids, worker ids, process ids, or coordination logs as durable
memory.

Memory writes must follow the GA principle:

```text
No Execution, No Memory.
```

Only action-verified facts or lessons should enter durable memory.

### Verified Self-Evolution

GA's self-evolution mechanism is core: successful, verified work can crystallize
into reusable SOPs, scripts, and capability notes.

Native should keep this ability, but productize the boundary:

- Allowed by default: update Galley-owned memory, SOPs, project memory, and
  capability-pack notes when the update is based on verified work.
- Requires explicit confirmation: modifying core runtime code, model provider
  configuration, credentials, destructive OS state, release artifacts, or
  external integrations.
- Forbidden by default: writing into user-owned external GA memory, SOP, skills,
  config, temp state, or checkout code.

Self-evolution should be auditable: users should be able to inspect what changed
and why it was considered durable.

### Capability Extension

GA grows capabilities through small SOPs and scripts rather than a large
preinstalled skill framework.

Native should express this as Galley-owned capability packs. A capability pack
may contain:

- model-facing instructions or SOP text;
- optional helper scripts;
- tool schema extensions, only when a new atomic tool is truly needed;
- memory index entries;
- tests or verification prompts.

The first native runtime should port GA's capability philosophy before inventing
a plugin marketplace or broad extension API.

### Browser And System Control

Browser Control is a core completion item, not an optional advanced feature.

Native should keep the current Chromium extension / bridge direction for V1:

- `web_scan` gives tab state and simplified page content.
- `web_execute_js` gives precise browser control and can create/switch tabs
  through the extension protocol.
- Setup, readiness probes, and recovery UI remain Galley-owned.
- Native should not require users to understand GA extension paths, Python
  startup prerequisites, or `tmwd_cdp_bridge/config.js`.

Desktop/system control capabilities such as screenshots, UI automation, vision,
ADB, or OS-specific helpers can remain capability-pack material unless they are
needed for the default V1 replacement bar.

### Goal Hive

Goal Hive must stay a first-class behavior, but the implementation should stay
Galley Core-owned.

Native should preserve GA Hive's social structure:

- Master is the design office: decompose, judge, aggregate. It does not do
  production work itself.
- Workers execute concrete tasks.
- Work continues until the budget is exhausted, not until the first acceptable
  result appears.
- The system maintains a current-best accepted deliverable.
- Later rounds probe, verify, find gaps, and improve the anchor.
- The final result returns to the user's master session.

Native should not inherit GA's HTTP BBS or text-file protocol state. Galley
already has a Core-owned Goal task board, events, worker sessions, master
session delivery, and visible checkpoints. That is the product boundary to keep.

### Morphling

Morphling is a high-level capability mode: absorb or replace a target project's
capability by extracting its objective, tests, and component strategy, then
matching or exceeding it on the same exam.

Native should treat Morphling as a first-class long-horizon work pattern built
on Goal Hive, browser control, file/code tools, memory, and verification.

Morphling is not a single low-level tool. It is a structured mode with required
outputs:

- target definition;
- extracted or constructed tests;
- component decisions: call, rewrite, discard;
- implementation or integration path;
- same-test comparison;
- capability absorption notes for future reuse.

## Galley Native Interpretation

The native runtime should translate GA semantics into Galley-owned objects.

| GA semantic | Galley-native owner |
|---|---|
| agent loop | Rust native runtime engine |
| model sessions | Rust model adapters over Galley Provider/Model records |
| tool dispatch | Rust tool registry and approval policy |
| tool progress | Galley event stream and persisted tool timeline |
| memory/SOP | Galley-owned memory store and capability packs |
| Project Mode | Project workspace and project memory for native sessions |
| `/continue` | Core-owned session continuity and copy/continue policy |
| Goal Hive | Galley Core Goal task board and controller |
| Browser Control setup | Galley Core + GUI setup surface |

### Project And Workspace

Galley Project and runtime workspace are related but not identical.

Project is the user's organizing container in the GUI and CLI. In
`galley_native`, a Project may optionally bind one primary workspace path.

When present, the workspace affects native sessions only:

- native file/code tools can default to the workspace as their work root;
- native project memory can live with the Project and point to workspace facts;
- native prompts can inject a compact project-memory pointer;
- native `@` file mention and file picker affordances can index the workspace.

This binding must not affect `managed_ga` or `external_ga` sessions. Those
runtimes keep their existing boundary so Galley does not reintroduce the old
cwd/memory coupling bug.

Projects without a workspace remain valid. Galley still needs a pure grouping
mode for users who want to organize conversations without binding a filesystem
root.

## V1 Scope

V1 is not a prototype. It should be capable of becoming the default runtime for
new built-in users.

Required V1 capabilities:

- create, send, stop, restore, and watch native sessions through existing GUI
  and CLI surfaces;
- use existing Galley managed Provider/Model records for OpenAI-compatible and
  Anthropic-compatible protocols;
- stream model output and parse tool calls;
- run the 9 GA parity tools with Galley-native events, approvals, and persisted
  timelines;
- support hierarchical Galley-owned memory, working checkpoint, and verified
  long-term update flow;
- support Browser Control readiness and `web_scan` / `web_execute_js`;
- support Core-owned Goal Hive with native master/worker sessions;
- support Morphling as a documented Goal Hive mode;
- preserve session continuity semantics, including "continue original" vs
  "copy and continue" where concurrent ownership matters;
- keep `managed_ga` available as fallback while native dogfoods toward default.

Replacement quality means ordinary built-in users can move from `managed_ga` to
`galley_native` without losing the capabilities that make GA useful inside
Galley.

## Non-Goals

Do not do these in the native runtime plan:

- Do not line-by-line translate GA Python into Rust.
- Do not treat Python file layout, module names, or `mykey.py` as the native
  product model.
- Do not revive the old all-runtime Project `rootPath -> cwd` behavior.
- Do not let Project workspace binding affect `managed_ga` or `external_ga`.
- Do not start or embed GA's native HTTP BBS for Goal Hive.
- Do not write external GA state, memory, SOP, skills, config, temp files, or
  checkout code.
- Do not allow self-evolution to modify core runtime code without explicit
  confirmation and review.
- Do not expose runtime internals in first-run onboarding.
- Do not ship a broad plugin marketplace before the native capability-pack
  boundary is proven.

## Open Questions

These need dedicated follow-up design before implementation:

- Runtime boundary: how `galley_native` enters runtime identity, CLI/API
  contracts, event ownership, session routing, and migration gates. See
  [RFC 1: Runtime Boundary](./rfc-1-runtime-boundary.md).
- Model/tool loop shape: exact Rust abstraction for canonical messages,
  OpenAI-compatible and Anthropic-compatible adapters, tool calls, approval,
  retry, usage, and history. See
  [RFC 2: Model And Tool Loop](./rfc-2-model-tool-loop.md).
- Native memory: typed L1-L4 storage, evidence, diff/rollback, prompt exposure,
  resource paths, and UI inspection. See
  [RFC 3: Native Memory](./rfc-3-native-memory.md).
- Capability packs: file/storage shape, validation, activation, permissions,
  tests, upgrade behavior, and UI for inspecting self-evolved changes. See
  [RFC 4: Capability Packs](./rfc-4-capability-packs.md).
- Workspace and session continuity: where Project workspace is set, how native
  sessions inherit it, how file mentions should surface, and how occupied
  sessions continue or copy. See
  [RFC 5: Workspace And Session Continuity](./rfc-5-workspace-session-continuity.md).
- Goal Hive and Morphling: native master/worker semantics, deliverables,
  workspaces, Morphling flow, and capability absorption. See
  [RFC 6: Goal Hive And Morphling](./rfc-6-goal-hive-morphling.md).
- Parity harness: how to compare `managed_ga` and `galley_native` on the same
  tasks without treating non-deterministic model behavior as test failure. See
  [RFC 7: Parity Harness And Default Switch](./rfc-7-parity-harness-default-switch.md).
- Migration path: when built-in users default to native, how existing managed
  session metadata is migrated while Galley-owned history remains readable.
- Safety policy: which tool classes require approval in native, which can be
  scoped to project/workspace, and how YOLO interacts with self-evolution.

## Read With

- [GA baseline](./ga-baseline.md) for current GenericAgent integration audits.
- [managed GA runtime](./managed-ga-runtime.md) for the existing built-in runtime
  and managed state rules.
- [Galley Native RFC 1: Runtime Boundary](./rfc-1-runtime-boundary.md)
  for runtime identity, routing, event, API, and migration decisions.
- [Galley Native RFC 2: Model And Tool Loop](./rfc-2-model-tool-loop.md)
  for model adapters, native loop semantics, tools, approvals, memory, and
  parity testing.
- [Galley Native RFC 3: Native Memory](./rfc-3-native-memory.md)
  for Galley-owned typed memory, evidence-backed updates, resource paths,
  scopes, and migration.
- [Galley Native RFC 4: Capability Packs](./rfc-4-capability-packs.md)
  for self-evolved SOP/script packs, activation, permissions, tests, and
  rollback.
- [Galley Native RFC 5: Workspace And Session Continuity](./rfc-5-workspace-session-continuity.md)
  for native-only workspace binding, tool roots, file mentions, restore,
  occupancy, and continue/copy policy.
- [Galley Native RFC 6: Goal Hive And Morphling](./rfc-6-goal-hive-morphling.md)
  for master/worker semantics, deliverables, Goal workspaces, Morphling, and
  capability absorption.
- [Galley Native RFC 7: Parity Harness And Default Switch](./rfc-7-parity-harness-default-switch.md)
  for parity tests, dogfood gates, rollout, rollback, and managed retirement.
- [Galley Goal V1 devlog](./devlog/2026-06-04-galley-goal-v1.md) for Core-owned
  Goal/Hive decisions already made.
