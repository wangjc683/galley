# Galley Native RFC 1: Runtime Boundary

> Status: draft decision document.
>
> Scope: product/runtime architecture only. This RFC does not implement
> `galley_native`, change schemas, or change existing runtime behavior.

## Decision

`galley_native` should enter Galley as a first-class runtime kind, parallel to
`managed_ga` and `external_ga`, but it should not be implemented as another
Python runner subprocess.

The Core should grow a runtime boundary that can route a session to one of two
runtime families:

- `GenericAgentRunnerRuntime`: wraps the existing Python runner path for
  managed and external GenericAgent.
- `GalleyNativeRuntime`: owns Rust-native model, tool, memory, browser, and
  Goal session workers.

This keeps the product promise clear: built-in users move toward a Galley-owned
native kernel, while external GA remains user-owned and non-invasive.

## Why This Matters For Users

The technical boundary is not an implementation preference. It decides whether
Galley can improve the built-in experience without carrying the fragility of a
bundled Python app forever.

For built-in users, native should eventually mean:

- fewer setup and runtime moving parts;
- clearer progress, approvals, memory, and recovery in the GUI;
- reliable session continuity without GA checkout state coupling;
- first-party Goal/Morphling behavior instead of delegated GA protocol files;
- model and tool behavior that Galley can test, version, and migrate.

For external GA users, the same boundary protects their checkout: Galley can
wrap it, but native-only features do not justify writing into external GA state.

## Existing Constraints

Current Galley already has several useful seams, but they are still GA-shaped.

### Runtime Identity

`RuntimeKind` currently has two values:

```text
managed
external
```

Session records and API responses already expose runtime metadata:

- `runtimeKind`
- `runtimeLabel`
- `gaRuntimeKind`
- `gaRuntimeId`
- `promptProfile`

The names are partly legacy. `runtimeKind` is already product-facing and
neutral. `gaRuntimeKind` is GA-specific but part of `schemaVersion: 1`, so it
must not be renamed or removed inside v1.

### CLI Contract

`docs/agent-api.md` freezes `schemaVersion: 1` for the `0.2.x` line. Adding a
new enum value is allowed, but renaming fields or changing semantics is not.

Current CLI runtime flags are closed around:

```text
current
managed
external
all
```

Native must enter additively.

### Runner Ownership

The current dispatch path starts and talks to a Python runner through
`RunnerManager`. That is correct for managed and external GA, but it is the
wrong abstraction for native.

Native sessions should be long-lived Rust workers owned by Galley Core. They
may spawn tools and helper processes, but the agent loop itself should not be a
Python subprocess.

### Event Shape

The current `IpcEvent` vocabulary is useful for the GUI, but native should own
normalized event names instead of copying Python IPC names:

```text
runtime_ready
turn_start
turn_progress
tool_pending
approval_pending
approval_resolved
tool_start
tool_progress
tool_end
turn_end
ask_user
run_complete
runtime_error
history_loaded
llm_changed
tools_reinjected
system_message
```

But the event type is still named and shaped around the Python bridge. Native
should preserve the user-visible rhythm without pretending that it has a GA
path, GA commit, or Python process id.

## Runtime Kind

Add a canonical product runtime kind:

```text
galley_native
```

Expected naming:

| Surface | Value |
|---|---|
| JSON/API | `galley_native` |
| Rust enum variant | `GalleyNative` |
| CLI flag | `--runtime=galley-native` |
| Internal shorthand in prose | native |

`managed` and `external` remain unchanged. Do not rename them to
`managed_ga` / `external_ga` in public v1 fields, even though those names are
clearer in planning docs.

## Runtime Labels

Product labels should separate ordinary user language from diagnostic language.

Recommended labels:

| Runtime kind | User-facing label | Diagnostic label |
|---|---|---|
| `galley_native` | `Galley` | `Galley Native` |
| `managed` | `Galley` during migration | `Managed GenericAgent` |
| `external` | `Attached GenericAgent` | `External GenericAgent` |

This avoids forcing new users to think about implementation. During migration,
Settings and diagnostics can expose the difference; the main session surface
should not make runtime internals the user's first problem.

## Core Runtime Boundary

Introduce a Core-owned runtime router before native implementation work starts.

Conceptual interface:

```text
RuntimeRouter
  start_session(session_id, runtime_kind, options)
  send_user_message(session_id, message)
  send_approval(session_id, approval)
  send_ask_user_response(session_id, response)
  set_llm(session_id, model_key)
  stop_session(session_id)
  watch_session(session_id)
  list_models(runtime_kind)
  runtime_status(session_id)
```

The router chooses an implementation by `RuntimeKind`.

### GenericAgentRunnerRuntime

This wraps today's behavior:

- prepare managed runtime context for `managed`;
- normalize external GA path for `external`;
- spawn the Python runner;
- translate Python `IpcEvent` and `IpcCommand`;
- preserve existing managed/external semantics.

No native-specific behavior should leak into this path.

### GalleyNativeRuntime

This owns:

- model adapters;
- autonomous loop workers;
- tool registry and approval policy;
- memory store access;
- workspace-aware file/code tools;
- Browser Control connection;
- Goal master/worker sessions;
- Morphling orchestration patterns.

Native emits Core-owned runtime events directly. It does not emit Python IPC.

## Event Model

Do not make native fake Python bridge metadata.

Add an internal Core event model, for example:

```text
RuntimeEvent
  RuntimeReady
  TurnStart
  TurnProgress
  ToolCallPending
  ToolCallStart
  ToolCallProgress
  ToolCallEnd
  AskUser
  TurnEnd
  RunComplete
  RuntimeError
  ModelChanged
  SystemMessage
```

The current Python `IpcEvent` should become an input adapter into this neutral
event model. GUI and CLI subscription surfaces can continue to receive the same
observable event kinds where possible.

`RuntimeReady` should be neutral:

```text
runtimeKind
runtimeLabel
runtimeVersion
modelKey?
workspacePath?
process?
reference?
```

Where:

- `process` is present for managed/external Python runners.
- `reference` can carry GA commit/path for managed/external.
- native does not invent fake GA commit/path/pid values.

If an existing public stream requires a Python-shaped `ready` frame, keep a
compatibility adapter during v1 and add optional neutral fields. Do not remove
existing fields without `schemaVersion: 2`.

## API And Schema Policy

Inside `schemaVersion: 1`, native is additive.

Allowed v1 changes:

- add `galley_native` to runtime enum value sets;
- add `--runtime=galley-native` to CLI commands;
- add optional neutral fields such as `runtimeReference` or `runtimeProcess`;
- keep returning existing `runtimeKind` and `runtimeLabel`;
- keep `gaRuntimeKind` for compatibility, but treat it as legacy projection
  debt. Implementation must choose and document the least-bad v1 projection:
  either mirror `runtimeKind` with additive `galley_native`, or add neutral
  optional fields and reserve `gaRuntimeKind` for GA runtimes only until
  `schemaVersion: 2`.

Disallowed v1 changes:

- remove `gaRuntimeKind`;
- rename `gaRuntimeKind` to `runtimeOwnership`;
- change `managed` or `external` semantics;
- change default runtime behavior before native passes replacement gates;
- change socket paths or localhost-only transport rules.

If strict clients cannot tolerate new enum values, that is a client bug under
the v1 additive contract. Galley should still document the addition clearly in
`docs/agent-api.md` when implementation begins.

## Storage Policy

Before implementation, audit the database for enum constraints and runtime
string assumptions.

Expected direction:

- session rows can store `galley_native` in the existing runtime-kind column;
- existing managed/external rows remain unchanged;
- native memory and capability state live in Galley-owned native tables or
  files, not in `managed-ga-state`;
- external GA state remains read-only except for allowed public integration
  points already documented in `AGENTS.md`.

Do not make `managed-ga-state` the migration bridge for native memory. That
would preserve the wrong ownership model.

## Project And Workspace Boundary

Project and workspace must stay distinct.

- `Project`: Galley organizing container for sessions, Goals, and memory.
- `workspace`: optional filesystem root bound to a Project for native runtime
  tools and file mentions.
- `memory`: Galley-owned durable knowledge, scoped globally, per Project, or
  per capability pack.
- `Goal`: Core-owned multi-session task board and orchestration state.
- `runtime`: the execution engine used by sessions.

Workspace binding affects `galley_native` only. It must not change cwd,
memory, or prompt behavior for `managed` or `external` sessions.

## Goal Boundary

Goal orchestration stays Core-owned.

Native Goal workers are ordinary native sessions with task-board context and
budget rules. Managed and external sessions remain possible Goal participants
during transition, but Goal state is never delegated to GA's HTTP BBS or
written into external GA temp files.

When native becomes default, Goal Hive should use native master/worker sessions
by default and keep managed/external as compatibility choices.

## Migration Phases

### Phase 0: Documentation

Lock the charter and RFCs. No code changes.

### Phase 1: Runtime Router Skeleton

Add `galley_native` as a disabled or hidden runtime kind behind a feature flag.
Introduce the neutral runtime router and event adapter while keeping
managed/external behavior byte-for-byte equivalent where practical.

### Phase 2: Native Session Skeleton

Start native sessions, stream model output, and emit neutral events. No tools or
memory yet beyond minimal diagnostics.

### Phase 3: Tool Loop Parity

Implement the 9 GA parity tools, approval routing, `ask_user`, and `no_tool`
behavior.

### Phase 4: Memory And Capability Packs

Add hierarchical memory, verified long-term updates, working checkpoints, and
capability-pack persistence.

### Phase 5: Goal Hive And Morphling

Move default Goal execution to native sessions and add Morphling as a structured
Goal mode.

### Phase 6: Default Switch

New built-in users default to native. Existing managed users keep fallback and
can migrate intentionally.

### Phase 7: Managed Retirement

Remove managed as default after native has dogfood evidence, parity coverage,
and a migration path. Keep external GA as advanced compatibility.

## Acceptance Checks Before Code

Before any runtime implementation begins, the design should answer:

- What exact runtime value appears in JSON and CLI?
- Which public fields stay GA-shaped for v1 compatibility?
- What compatibility projection is used for legacy `gaRuntimeKind` when the
  session is native?
- Which internal event model replaces Python-specific `IpcEvent` ownership?
- How does a native session start without using `RunnerManager`?
- How does `session send` route by runtime kind?
- How does `Goal` choose native workers without changing external GA state?
- Which docs must update when `galley_native` becomes an actual enum value?

## Rejected Alternatives

### Make Native Another Python Runner Mode

Rejected because it preserves the wrong failure mode. The whole point of native
is to let Galley own the agent loop, memory, tools, events, and recovery.

### Replace Managed Immediately

Rejected because managed GA is the working built-in runtime. Native must earn
default status through parity and dogfood, not by roadmap assertion.

### Hide Native Behind Managed Labels Forever

Rejected because diagnostics, migration, and Agent API callers need stable
runtime identity. The main UI can stay simple, but the runtime contract must be
honest.

### Rename Public Runtime Fields Now

Rejected because `schemaVersion: 1` is frozen. Neutral names can be added
optionally; existing names stay until a future schema bump.
