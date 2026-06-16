# Galley Native Slice 1 Read-Only Audit

> Status: implementation-prep audit.
>
> Date: 2026-06-16.
>
> Scope: read-only audit for Slice 1, Runtime Router Skeleton. This document
> does not implement code, schema, or runtime behavior.

## Conclusion

Slice 1 should be treated as a runtime identity and routing slice, not as the
first native agent slice.

The practical user-facing goal is simple: Galley must be able to carry a third
runtime kind without confusing managed or external users. If native is requested
while unavailable, the product should say that native is experimental or not
implemented yet. It must not fall through into external GA setup, Python bridge
spawn, or misleading `ga_config` errors.

## Current Coupling Map

Today the runtime kind is not isolated in one place. It is a cross-cutting
contract across Rust API types, SQLite constraints, socket commands, CLI args,
LLM resolution, Python runner ownership, GUI TypeScript unions, and public
Agent API docs.

The audited surfaces are:

- `core/src/api/session.rs`: `RuntimeKind` has only `Managed` and `External`.
  `SessionBrief` exposes both `runtimeKind` and legacy `gaRuntimeKind`.
- `core/migrations/008_runtime_identity.sql`: `sessions.ga_runtime_kind` has a
  CHECK constraint limited to `managed` and `external`.
- `core/migrations/015_goal_v1.sql`: Goal runtime fields are also CHECK-limited
  to `managed` and `external`.
- `core/src/db/helpers.rs`: runtime parsing, SQL serialization, active-runtime
  preference parsing, prompt-profile defaults, and session insert logic all
  assume only two runtime kinds.
- `core/src/db/rows.rs`: persisted `ga_runtime_kind` is parsed into one
  `RuntimeKind`, then projected into both `runtimeKind` and `gaRuntimeKind`.
- `core/src/socket_listener/session_cmds.rs`: `session.new` resolves the target
  runtime, model, spawn args, DB row, runner spawn, event subscription, and
  first message dispatch in one path.
- `core/src/socket_listener/llm_cmds.rs`: LLM lookup is split only into managed
  model records and external cached GA model names.
- `core/src/runner_commands.rs`: `spawn_runner` defaults omitted runtime to
  external, then chooses managed if `RuntimeKind::Managed`; every other value
  would otherwise behave like external.
- `core/src/runner_manager/*`: `RunnerManager` is a Python subprocess manager.
  It is authoritative and shared, but it is not a neutral runtime manager yet.
- `core/src/ipc.rs`: `IpcEvent` mirrors the Python bridge protocol and includes
  GA/Python-specific ready fields such as GA path, GA commit, and process pid.
- `cli/src/args.rs` and `cli/src/common.rs`: `--runtime` accepts only
  `current`, `managed`, `external`, and `all`; conversion helpers are exhaustive
  over two concrete runtime kinds.
- `gui/src/types/session.ts`, `gui/src/types/db.ts`, `gui/src/stores/prefs.ts`,
  `gui/src/stores/sessions.ts`, and `gui/src/lib/bridge.ts`: GUI runtime types,
  prefs, session creation, bridge spawn, model seeding, and labels assume
  managed/external.
- `docs/agent-api.md`: public CLI/API documentation lists only managed and
  external runtime values.

## Primary Findings

### F1: Adding an enum variant is necessary but unsafe by itself

Rust exhaustive matches will help reveal work, but several paths use binary
logic such as `if runtime_kind == RuntimeKind::Managed { ... } else { ... }`.
Without a router boundary, `GalleyNative` would accidentally take the external
GA path in some of the highest-risk code.

User impact: the first native dogfood could fail with external-GA setup errors,
which makes the product feel broken instead of intentionally experimental.

### F2: The database needs an explicit migration before native sessions exist

`sessions.ga_runtime_kind` and Goal runtime tables are currently CHECK-limited
to `managed` and `external`. A future Slice 1 implementation that persists
native sessions needs a migration after version 20 to allow `galley_native`.

User impact: this must be handled as a normal app-data migration, not a
developer-only manual DB edit.

### F3: `gaRuntimeKind` should mirror native in schema v1

The current row mapper stores one value and projects it into both
`runtimeKind` and `gaRuntimeKind`. This supports the D1 recommendation in
[Open Decisions](./open-decisions.md): for schema v1, native should appear as
`runtimeKind = "galley_native"` and `gaRuntimeKind = "galley_native"`, with
`gaRuntimeKind` documented as a legacy compatibility projection.

User impact: agents keep receiving a required field, while new integrations can
prefer the product-facing `runtimeKind`.

### F4: `session.new` is too large to be the first native execution point

`session.new` currently combines model lookup, session creation, first message
persistence, Python runner spawn, event subscription, and first dispatch. Native
does not yet have a worker in Slice 1, so the safest behavior is explicit
unavailability behind the native gate until Slice 2.

User impact: native hidden routes can be tested without creating half-started
sessions or ambiguous persisted state.

### F5: Native should reuse managed model records, but through a native resolver

The first native model adapter is planned to use Galley-owned Provider/Model
records. It should not call the external GA `llm_list` cache, and it should not
pretend to be managed Python. Slice 1 can name the dependency, but Slice 3 owns
real provider execution.

User impact: built-in users keep the same "configure model, then use Galley"
mental model when native eventually replaces managed GA.

### F6: `RunnerManager` should remain Python-specific in Slice 1

`RunnerManager` already owns Python bridge subprocess lifecycle correctly. The
native path should not rewrite it. Instead, Slice 1 should introduce a runtime
router abstraction that delegates managed/external to the existing Python runner
adapter and reserves a separate native adapter path.

User impact: managed and external sessions stay stable while native grows.

### F7: Native should not fake Python `IpcEvent::Ready`

The current IPC protocol is intentionally a mirror of `runner/ipc.py`. Native
should not invent GA commit/path/pid metadata just to fit that shape. Slice 1
should introduce a Core-owned internal `RuntimeEvent` and map Python `IpcEvent`
into it. Public GUI/CLI projections can stay compatible.

User impact: native runtime diagnostics stay truthful instead of carrying
placeholder GA metadata.

### F8: CLI and GUI type gates should fail closed

The CLI and GUI currently have narrow runtime unions. That is useful: when the
native value is introduced, type errors should point to every place where the
user might see, select, filter, label, or persist runtime identity.

User impact: native remains hidden until the product is ready to expose it.

### F9: Goal runtime needs a separate decision inside Slice 1

Goal state has its own runtime fields and DB constraints. The first Slice 1
implementation can either keep Goal native-disabled or migrate Goal runtime
values alongside sessions. It should not silently allow Goal workers to request
native before Slice 8/9 semantics exist.

User impact: Goal/Hive users do not accidentally enter a partially implemented
native runtime.

## Recommended Slice 1 Shape

Slice 1 should land in three layers.

1. Runtime identity:
   - add `RuntimeKind::GalleyNative`;
   - add parser/serializer support for `galley_native`;
   - update DB constraints through a normal migration if native rows are
     persisted;
   - update public docs for the additive enum value;
   - keep native hidden behind `GALLEY_NATIVE_EXPERIMENTAL=1`.

2. Router boundary:
   - introduce a Core-owned runtime router or runtime service boundary;
   - wrap existing managed/external Python behavior as the Python runtime
     adapter;
   - keep `RunnerManager` as the Python adapter's process owner;
   - add explicit native-unavailable errors while no native worker exists.

3. Event ownership:
   - add an internal neutral `RuntimeEvent`;
   - map Python `IpcEvent` into `RuntimeEvent`;
   - keep existing public event streams compatible;
   - reserve native `RuntimeReady` for Slice 2.

Slice 1 should not implement model calls, native tools, memory, capability
packs, browser control, Goal Hive, Morphling, or default switching.

## Native Gate Behavior

When `GALLEY_NATIVE_EXPERIMENTAL` is not enabled:

- CLI parsing should either hide or reject `galley-native` / `galley_native`
  consistently;
- socket JSON requesting `runtimeKind: "galley_native"` should return an
  explicit experimental-unavailable error;
- active runtime preference should not hydrate to native;
- managed and external remain unchanged.

When the gate is enabled:

- runtime parsing can accept native;
- list/search filters can recognize native if persisted native rows exist;
- `session.new` may still return a clear not-implemented/native-unavailable
  error until Slice 2 provides a native worker;
- no GUI Settings toggle is required.

## Tests To Require For Slice 1

- Runtime parser and serializer cover `managed`, `external`, and
  `galley_native`.
- Migration tests or DB integration tests prove native runtime values no longer
  violate CHECK constraints where Slice 1 chooses to persist them.
- `managed` and `external` session creation, activation, and runner spawn tests
  remain equivalent.
- Gate-off tests prove native requests cannot become default and cannot fall
  through to external GA.
- CLI tests cover runtime argument behavior, including `all` remaining valid
  only for list/search-style commands.
- Agent API docs are updated with the additive enum and legacy
  `gaRuntimeKind` note.
- GUI typecheck passes with any hidden native type additions.
- `git diff --check` passes.

## Goal Mode Execution Boundary

Codex Goal mode is appropriate for this rewrite if each Goal is narrow and has
a hard exit gate.

Use this pattern:

- Read-only audit Goal: inspect code and docs, write findings, no behavior
  changes. This document is that artifact.
- Implementation Goal per slice: implement exactly one accepted slice, run its
  tests, and stop.
- Review Goal: code-review the slice against docs and regression gates before
  starting the next slice.

Do not run one large Goal named "rewrite GA in Rust". That would optimize for
completion theater rather than user-safe replacement quality.

## Slice 1 Implementation Prompt Draft

When implementation starts, use a prompt with these boundaries:

```text
Implement only Galley Native Slice 1: Runtime Router Skeleton.

Do:
- add hidden galley_native runtime identity behind GALLEY_NATIVE_EXPERIMENTAL=1;
- keep managed/external behavior unchanged;
- add a runtime router boundary and keep RunnerManager Python-specific;
- add internal RuntimeEvent plumbing only as needed for router shape;
- update docs/tests for additive runtime identity.

Do not:
- implement native model calls;
- implement native tools, memory, browser, Goal Hive, or Morphling;
- expose native in visible Settings;
- switch defaults;
- write external GA state;
- rewrite RunnerManager.
```

## Next Decision Before Code

Before Slice 1 code starts, explicitly accept or revise D1-D6 in
[Open Decisions](./open-decisions.md). The main judgment call is whether Slice
1 persists native session rows immediately, or only adds the type/router and
returns native-unavailable until Slice 2. The safer default is:

- add the enum and router boundary now;
- add the DB migration only when tests need native rows or Slice 2 starts;
- return explicit native-unavailable for actual session execution in Slice 1.
