# Galley Native Implementation Slices

> Status: planning checkpoint.
>
> Scope: sequencing and acceptance gates for future `galley_native`
> implementation. This document does not implement code, schema, or runtime
> behavior.

## Direction

Do not start by replacing `managed_ga`.

Start by adding a hidden native runtime path that can prove one capability slice
at a time while `managed_ga` remains the default built-in runtime and
`external_ga` remains non-invasive.

The implementation shape should follow this dependency chain:

```text
runtime boundary
  -> native loop skeleton
  -> event/router compatibility
  -> tool control plane
  -> local file/code tools
  -> Browser Control tools
  -> memory and capability substrate
  -> workspace and continuity
  -> Goal Hive and Morphling
  -> parity harness
  -> opt-in beta
  -> new-user default switch
```

## Non-Negotiable Gates

Every slice must preserve:

- no behavior change for `managed` and `external` unless explicitly scoped;
- no writes to external GA state;
- no default switch before parity gates;
- no schemaVersion 1 removals or renames;
- no first-run runtime complexity for ordinary users;
- no hidden self-evolution into core runtime code.

If a slice cannot satisfy these, it is not ready to implement.

## Slice 0: RFC Freeze And Review

Goal: turn the RFC set into an accepted implementation baseline.

Inputs:

- [Runtime Charter](./runtime.md)
- [Open Decisions](./open-decisions.md)
- [RFC 1](./rfc-1-runtime-boundary.md)
- [RFC 2](./rfc-2-model-tool-loop.md)
- [RFC 3](./rfc-3-native-memory.md)
- [RFC 4](./rfc-4-capability-packs.md)
- [RFC 5](./rfc-5-workspace-session-continuity.md)
- [RFC 6](./rfc-6-goal-hive-morphling.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- resolve or revise [Open Decisions](./open-decisions.md);
- mark RFCs accepted or revise them before code.

Exit gate:

- JC accepts the direction;
- D1-D6 in [Open Decisions](./open-decisions.md) are accepted or explicitly
  revised;
- implementation slices below are still coherent after review;
- no code has started from an unsettled RFC.

## Slice 1: Runtime Router Skeleton

Goal: add `galley_native` as a hidden runtime identity without changing default
behavior.

Primary RFCs:

- [RFC 1](./rfc-1-runtime-boundary.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Likely code areas:

- `core/src/api/session.rs`
- `core/src/runner_commands.rs`
- `core/src/socket_listener/session_cmds.rs`
- `cli/src/args.rs`
- `cli/src/common.rs`
- `docs/agent-api.md`

Tasks:

- add native runtime identity behind an experimental gate;
- introduce a Core-owned runtime router abstraction;
- adapt existing managed/external Python runner through the router;
- keep `RunnerManager` as the Python-runtime implementation detail instead of
  rewriting it during this slice;
- keep managed/external behavior equivalent;
- define neutral internal `RuntimeEvent`;
- map existing Python `IpcEvent` into neutral events;
- document v1 public field behavior.

Exit gate:

- managed/external tests pass;
- CLI/session listing still returns current data;
- native cannot become default accidentally;
- no GUI user sees native unless the experiment is enabled.

Rollback:

- disable the native gate;
- router still routes managed/external through existing path.

## Slice 2: Native Loop Skeleton

Goal: start a native session that can stream a final answer with a mock model
and no tools.

Primary RFC:

- [RFC 2](./rfc-2-model-tool-loop.md)

Tasks:

- define canonical `NativeMessage` and `ContentBlock`;
- add mock-model adapter;
- add minimal native worker lifecycle;
- emit `runtime_ready`, `turn_start`, `turn_progress`, `turn_end`,
  `run_complete`, and `runtime_error`;
- persist visible assistant messages through existing session paths;
- add mock-model loop tests.

Exit gate:

- native hidden session can answer a trivial prompt;
- managed/external behavior unchanged;
- event order is deterministic under mock model;
- no native memory/tool claims yet.

Rollback:

- disable native session start while keeping router skeleton.

## Slice 3: Model Adapter V1

Goal: use configured Galley model records from native without introducing new
first-run setup.

Primary RFC:

- [RFC 2](./rfc-2-model-tool-loop.md)

Tasks:

- implement OpenAI-compatible adapter first or decide Anthropic first during
  Slice 0;
- normalize streaming deltas into native content blocks;
- capture usage and stop reasons;
- handle blank/incomplete/max-token responses;
- keep provider-specific details out of loop semantics;
- add adapter tests with fixture responses.

Exit gate:

- one real provider can complete a no-tool native turn;
- errors become actionable runtime events;
- model configuration still uses existing Galley Provider/Model records.

Rollback:

- fall back to mock-model dogfood only.

## Slice 4A: Tool Control Plane

Goal: let native understand, route, and report tool use without real file,
process, browser, or memory side effects.

Primary RFCs:

- [RFC 2](./rfc-2-model-tool-loop.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- parse structured tool calls;
- add text fallback parser;
- implement `no_tool` classification;
- create native tool registry metadata;
- wire approval pending/allow/deny events;
- implement `ask_user`;
- implement `update_working_checkpoint`;
- register the 9 GA parity tool schemas;
- route most tool executors to deterministic stubs;
- keep `start_long_term_update` as a stub until Slice 5.

Exit gate:

- mock-model tests cover tool-call routing for each 9-tool schema;
- tool pending/start/progress/end events are ordered and persisted as expected;
- approval events match GUI/CLI expectations;
- `ask_user` can suspend and resume the loop;
- `no_tool` recovery cases have deterministic tests;
- no real file/code/browser side effects occur in this slice.

Rollback:

- disable native tool dispatch while keeping native no-tool chat available.

## Slice 4B: Local File And Code Executors

Goal: implement local file and process tools in safe native workspaces.

Primary RFCs:

- [RFC 2](./rfc-2-model-tool-loop.md)
- [RFC 5](./rfc-5-workspace-session-continuity.md)

Tasks:

- implement `file_read`;
- implement `file_patch`;
- implement `file_write`;
- implement `code_run` with explicit cwd policy;
- add timeout, cancellation, stdout/stderr, and exit-status capture;
- add first-pass risk policy for local destructive or credential-adjacent
  actions;
- keep Project workspace integration minimal until Slice 6.

Exit gate:

- temp workspace file read/write/patch tests pass;
- patch/write show diff or preview material before risky writes;
- risky local action can enter approval flow and resume after allow/deny;
- `code_run` handles timeout, cancellation, exit status, stdout, and stderr;
- managed/external file/code behavior is unchanged;
- Browser Control is not part of this gate.

Rollback:

- disable local native executors and fall back to stubs.

## Slice 4C: Browser Control Executors

Goal: implement `web_scan` and `web_execute_js` with native Browser Control
readiness and recovery.

Primary RFCs:

- [RFC 2](./rfc-2-model-tool-loop.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- implement Browser Control readiness probe;
- connect native runtime to the existing browser bridge direction;
- implement `web_scan`;
- implement `web_execute_js`;
- surface missing extension, sleeping service worker, reconnect, and no-tab
  states as actionable runtime events;
- add deterministic safe JS scenario, such as reading `document.title`;
- keep managed Browser Control behavior unchanged.

Exit gate:

- no-extension state gives a clear next action;
- ready extension can discover tabs;
- safe JS execution succeeds in a controlled page;
- `web_scan` and `web_execute_js` events flow through the same runtime event
  stream as local tools;
- managed Browser Control still passes its existing checks.

Rollback:

- mark native browser tools unavailable while leaving local native tools
  enabled.

## Slice 5: Native Memory And Capability Substrate

Goal: make native memory and capability packs real, typed, reversible, and
resource-readable.

Primary RFCs:

- [RFC 3](./rfc-3-native-memory.md)
- [RFC 4](./rfc-4-capability-packs.md)

Tasks:

- implement storage for memory items, evidence, index entries, and changes;
- expose `memory://` resources through `file_read`;
- implement low-risk memory change apply + undo;
- implement `start_long_term_update`;
- add built-in pack registry;
- expose `capability://` resources through `file_read`;
- add pack manifest validation;
- connect pack triggers to L1;
- add script execution policy through `code_run`;
- add timeline events for memory/pack updates.

Exit gate:

- memory updates cite execution evidence;
- bad memory update can be undone;
- secrets are rejected or redirected to credential references;
- pack resource reads work without adding a 10th tool;
- no import from managed/external happens automatically.

Rollback:

- disable memory writes while keeping read-only built-in resources available.

## Slice 6: Workspace And Session Continuity

Goal: make native sessions ergonomic for Project work and recoverable across
process restarts.

Primary RFC:

- [RFC 5](./rfc-5-workspace-session-continuity.md)

Tasks:

- store optional Project primary workspace;
- add native session scratch paths and retention policy;
- implement file mention indexing for native Project workspace;
- route file/code tools through explicit workspace policy;
- add native session snapshot/restore;
- track runtime occupancy and heartbeat;
- implement continue original vs copy-and-continue policy;
- add copy-to-native path for managed sessions.

Exit gate:

- app restart can restore and continue a native session;
- occupied session behavior is deterministic;
- missing workspace gives actionable recovery;
- managed/external sessions are unaffected by Project workspace binding.

Rollback:

- disable workspace binding for native while keeping scratch-only sessions.

## Slice 7: Goal Hive Native

Goal: run Goal Hive with native master/worker sessions on Core-owned task board
state.

Primary RFC:

- [RFC 6](./rfc-6-goal-hive-morphling.md)

Tasks:

- make native master planning use Core task board;
- bind worker identity through Core;
- avoid prompt stacking into live workers;
- support deliverable anchor reads/writes;
- use Goal workspace for generated artifacts;
- return final synthesis to master session;
- prevent Goal protocol state from entering native memory.

Exit gate:

- small mock-model Goal reaches final synthesis;
- sustained-budget semantics are preserved;
- deliverable anchor history is inspectable;
- worker internal messages remain out of normal user search/render paths unless
  already designed otherwise.

Rollback:

- keep managed/external Goal path as fallback; disable native Goal workers.

## Slice 8: Morphling Native Mode

Goal: implement Morphling as a structured Goal mode that produces evidence and
optionally capability packs.

Primary RFCs:

- [RFC 6](./rfc-6-goal-hive-morphling.md)
- [RFC 4](./rfc-4-capability-packs.md)

Tasks:

- define Morphling Goal template;
- capture target/objective/tests/component strategy;
- run same-test comparison on a toy target;
- produce a report or capability-pack candidate;
- require evidence for absorption;
- block proprietary-code reproduction as a strategy.

Exit gate:

- toy CLI/library Morphling scenario passes same-test comparison;
- output can become a disabled capability-pack candidate;
- no single low-level `morphling` tool is introduced.

Rollback:

- hide Morphling mode while keeping Goal Hive native available.

## Slice 9: Parity Harness And Opt-In Beta

Goal: prove native can replace managed for selected users before becoming the
new default.

Primary RFC:

- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- implement native unit/mock/integration harness;
- implement managed-vs-native scenario comparison;
- add local dogfood metrics or devlog checklist;
- expose native as experimental opt-in;
- add managed fallback routing;
- write troubleshooting docs for native errors.

Exit gate:

- required scenario set passes or has accepted gaps;
- Browser, memory, Goal, workspace, and continuation all have dogfood evidence;
- fallback to managed is tested;
- CLI/Supervisor callers tolerate native runtime values.

Rollback:

- remove opt-in from UI and keep native hidden.

## Slice 10: New-User Default Switch

Goal: make native the default built-in runtime for new users.

Primary RFC:

- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- change default built-in runtime to native for new installs only;
- keep existing managed users on managed unless they switch;
- provide copy-to-native affordance;
- keep managed fallback visible enough for recovery;
- update docs/release notes;
- dogfood release candidate.

Exit gate:

- parity gates pass;
- first-run setup stays model-only;
- managed fallback works;
- no native-only state prevents reading old managed sessions;
- rollback procedure is documented and tested.

Rollback:

- set new-user default back to managed;
- keep native sessions readable;
- leave native memory/capability data intact but inactive if needed.

## First Code Slice Recommendation

When implementation starts, begin with Slice 1 only.

Do not combine it with native model adapters, tools, memory, or UI default
switching. The first code question is simply:

```text
Can Galley route sessions by a third runtime kind without changing managed or
external behavior?
```

If that answer is not proven, every later slice sits on unstable ground.
