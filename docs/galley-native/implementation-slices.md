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
- [Slice 1 Read-Only Audit](./slice-1-readonly-audit.md)

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

Status: implemented as hidden identity/router gate on 2026-06-16. See
[Slice 1 Runtime Router](../devlog/2026-06-16-galley-native-slice-1-runtime-router.md).

Goal: add `galley_native` as a hidden runtime identity without changing default
behavior.

Primary RFCs:

- [RFC 1](./rfc-1-runtime-boundary.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Likely code areas:

- `core/src/api/session.rs`
- `core/src/db/helpers.rs`
- `core/src/db/rows.rs`
- `core/migrations/008_runtime_identity.sql` and a future migration if native
  rows are persisted
- `core/migrations/015_goal_v1.sql` and Goal runtime follow-up constraints
- `core/src/runner_commands.rs`
- `core/src/runner_manager/*`
- `core/src/ipc.rs`
- `core/src/socket_listener/session_cmds.rs`
- `core/src/socket_listener/llm_cmds.rs`
- `cli/src/args.rs`
- `cli/src/common.rs`
- `gui/src/types/session.ts`
- `gui/src/types/db.ts`
- `gui/src/stores/prefs.ts`
- `gui/src/stores/sessions.ts`
- `gui/src/lib/bridge.ts`
- `docs/agent-api.md`

Tasks:

- add native runtime identity behind an experimental gate;
- introduce a Core-owned runtime router abstraction;
- adapt existing managed/external Python runner through the router;
- keep `RunnerManager` as the Python-runtime implementation detail instead of
  rewriting it during this slice;
- prevent native requests from falling through to external GA path/config
  errors;
- keep managed/external behavior equivalent;
- define neutral internal `RuntimeEvent`;
- map existing Python `IpcEvent` into neutral events;
- document v1 public field behavior.

Exit gate:

- managed/external tests pass;
- CLI/session listing still returns current data;
- native cannot become default accidentally;
- native unavailable errors are explicit when the gate is off or no native
  worker exists;
- no GUI user sees native unless the experiment is enabled.

Rollback:

- disable the native gate;
- router still routes managed/external through existing path.

## Slice 2: Native Loop Skeleton

Status: implemented as narrowed Slice 2A/2B steps on 2026-06-16. See
[Slice 2 Native Worker Skeleton](../devlog/2026-06-16-galley-native-slice-2-native-worker-skeleton.md).

Goal: start a native session that can stream a final answer with a mock model
and no tools.

Implementation note: the landed version proves the native session worker path,
DB transcript persistence, and internal `NativeMessage` / `NativeRuntimeEvent`
contract. Slice 2B adds a Core-owned native event bus so hidden native
`session.watch` can replay the deterministic mock trace and close with
`native_run_complete`. GUI projection and follow-up commands such as
`session.send` remain deferred.

Primary RFC:

- [RFC 2](./rfc-2-model-tool-loop.md)

Tasks:

- allow explicit hidden `runtimeKind: "galley_native"` session creation behind
  `GALLEY_NATIVE_EXPERIMENTAL=1`;
- add `core::native_runtime` with a deterministic mock worker and no tools;
- persist the first user message and visible mock assistant message;
- bump the session turn count and summary after the native mock turn;
- keep managed/external `session.new` on the existing Python runner path;
- keep native Goal unavailable even when the native session gate is enabled;
- define canonical `NativeMessage`, `NativeContentBlock`, and internal
  `NativeRuntimeEvent` shapes;
- generate a deterministic mock event trace in GA-shaped order:
  `runtime_ready`, `turn_start`, `turn_progress`, `turn_end`, `run_complete`;
- add a Core-owned `NativeRuntimeEventBus` with same-process backlog replay for
  hidden native sessions;
- let `session.watch` fall back to the native bus for `galley_native` sessions
  without changing managed/external RunnerManager watch behavior.

Exit gate:

- native hidden session can answer a trivial prompt;
- managed/external behavior unchanged;
- persisted transcript contains the visible mock assistant final answer;
- internal mock event order is deterministic and no-tool;
- hidden native `session.watch` can replay the mock event trace and end with
  `native_run_complete`;
- native session rows are allowed by SQLite, but Goal rows are still
  managed/external-only;
- no native memory/tool claims yet.

Rollback:

- disable native session start while keeping router skeleton.

## Slice 3: Model Adapter V1

Status: implemented as Slice 3A/3B/3C on 2026-06-16. See
[Slice 3A Model Adapter](../devlog/2026-06-16-galley-native-slice-3a-model-adapter.md)
and [Slice 3B Streaming](../devlog/2026-06-16-galley-native-slice-3b-streaming.md)
and [Slice 3C Anthropic Adapter](../devlog/2026-06-16-galley-native-slice-3c-anthropic-adapter.md).

Goal: use configured Galley model records from native without introducing new
first-run setup.

Primary RFC:

- [RFC 2](./rfc-2-model-tool-loop.md)

Tasks:

- implement OpenAI-compatible adapter first or decide Anthropic first during
  Slice 0;
- reuse existing Galley Provider/Model records and encrypted credentials;
- allow native `--llm` to resolve managed model display names, model names, and
  ids;
- preserve mock fallback when no supported model is configured;
- capture usage and stop reasons;
- handle blank/incomplete/max-token responses;
- keep provider-specific details out of loop semantics;
- add adapter tests with fixture responses.

Exit gate:

- one real provider can complete a no-tool native turn;
- errors become actionable runtime events;
- model configuration still uses existing Galley Provider/Model records.

Landed in Slice 3A:

- OpenAI-compatible API-key chat completions with `stream: false`;
- same native transcript persistence and event-bus replay as Slice 2;
- `run_complete.stopReason` and `run_complete.usage`;
- local fake OpenAI socket test for config -> credential -> HTTP -> transcript
  -> event path.

Landed in Slice 3B:

- OpenAI-compatible SSE parsing for `data:` frames and `[DONE]`;
- `"stream": true` advanced option produces multiple live
  `turn_progress` events with `source: "model_stream"`;
- streamed deltas are accumulated into the final visible assistant transcript;
- optional streaming usage and finish reason flow into `run_complete`;
- non-stream model behavior and mock fallback remain available.

Landed in Slice 3C:

- Anthropic-compatible API-key `/messages` adapter;
- Anthropic non-stream content-block response parsing;
- Anthropic SSE parsing for `message_start`, `content_block_delta`,
  `message_delta`, and `message_stop`;
- `sk-ant-*` credentials use `x-api-key`, matching managed model probes;
- Anthropic streaming deltas use the same `source: "model_stream"` native event
  path as OpenAI-compatible streaming;
- usage from Anthropic start/delta events is merged into `run_complete.usage`.

Deferred to Slice 3C+:

- ChatGPT Codex OAuth native adapter;
- Responses API native adapter;
- richer incomplete/max-token recovery policy beyond explicit stop reason and
  empty-response errors.

Rollback:

- fall back to mock-model dogfood only.

## Slice 4A: Tool Control Plane

Status: implemented as a hidden control-plane skeleton on 2026-06-16. See
[Slice 4A Tool Control Plane](../devlog/2026-06-16-galley-native-slice-4a-tool-control-plane.md).
The landed slice proves parsing, registry metadata, event ordering, and
no-side-effect stubs. Human-driven approval decisions remain deferred before
real executors are enabled.

Follow-up 4A2A landed on 2026-06-16. See
[Slice 4A2A Native Interaction State](../devlog/2026-06-16-galley-native-slice-4a2a-interaction-state.md).
It lets hidden native `session.send` run a follow-up native turn and makes
`ask_user` enter a persisted waiting state that the next `session.send` can
resume.

Follow-up 4A2B landed on 2026-06-16. See
[Slice 4A2B Native Approval State](../devlog/2026-06-16-galley-native-slice-4a2b-approval-state.md).
It lets risky native tool calls pause as pending approvals, and lets hidden
native `session.approval_response` / CLI `session approval-response` allow or
deny the suspended call. Executors still return deterministic no-side-effect
stubs.

Follow-up 4A2C landed on 2026-06-16. See
[Slice 4A2C GUI Projection](../devlog/2026-06-16-galley-native-slice-4a2c-gui-projection.md).
It projects native runtime events into the existing GUI conversation,
approval, ask-user, and ToolCallout surfaces. GUI native sends and approvals
route to Rust Core instead of the Python bridge, but executors remain
deterministic no-side-effect stubs.

Follow-up 4B1 landed on 2026-06-16. See
[Slice 4B1 File Read Executor](../devlog/2026-06-16-galley-native-slice-4b1-file-read.md).
It switches only `file_read` from stub to a read-only native executor.
Workspace-relative reads are allowed when the hidden native session has a
Project `root_path`; existing absolute paths outside that workspace pause for
approval before reading. All write, process, browser, memory, Goal Hive, and
Morphling executors remain disabled or stubbed.

Follow-up 4B2 landed on 2026-06-16. See
[Slice 4B2 Tool Result Continuation](../devlog/2026-06-16-galley-native-slice-4b2-tool-result-continuation.md).
It adds one non-stream continuation pass after `file_read`: when Core has a
`file_read` result and no pending approval/user-input wait, it sends the tool
result back to the model and persists the continuation answer as the
assistant-facing final answer.

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

Landed in Slice 4A skeleton:

- `core::native_tools` with the 9 GA parity tool schemas and default approval
  metadata;
- structured JSON and text-fallback parsers for common `tool_calls`,
  `tool_call`, `tool` / `name`, and OpenAI-style `function.arguments` shapes;
- recoverable `no_tool` and malformed-tool classifications;
- hidden native runtime events in deterministic order:
  `tool_pending`, optional `approval_pending`, `tool_start`, `tool_progress`,
  `tool_end`;
- assistant `turn_end.toolCalls` / `turn_end.toolResults` and persisted
  `messages.tool_calls` / `messages.tool_results` payloads;
- no-op deterministic results for all 9 parity tools with
  `sideEffectsPerformed: false`;
- socket-level coverage for `session.new` + `session.watch` replaying native
  tool stub events.

Landed in Slice 4A2A follow-up:

- hidden native `session.send` runs a new Rust-native turn instead of becoming
  `persisted_only`;
- native event bus replay is refreshed for the latest native turn;
- `ask_user` emits a dedicated `ask_user` event instead of approval events;
- `run_complete.exitReason.result = "ASK_USER"` and stream close reason
  `native_waiting_user` mark user-input wait state;
- native sessions persist `status = waiting_approval` while waiting and return
  to `idle` after the next native `session.send` completes;
- socket tests cover follow-up turns and ask-user wait/resume.

Landed in Slice 4A2B follow-up:

- risky native tools persist a pending `tool_events` row and end the stream with
  `native_waiting_approval` before any tool result is produced;
- `session.approval_response` accepts `allow_once`, `deny`,
  `always_allow_project`, and `always_allow_global` decisions for hidden native
  sessions;
- allow decisions emit `approval_resolved`, `tool_start`, `tool_progress`,
  `tool_end`, and `run_complete`, update the assistant message's
  `tool_results`, complete the pending tool event, and return the session to
  `idle`;
- deny decisions emit `approval_resolved`, a denied `tool_end`, and
  `run_complete`, record `status: "denied"`, and perform no side effect;
- native tool call ids are scoped by session and turn so approval ids cannot
  collide across sessions.

Landed in Slice 4A2C follow-up:

- Rust Core emits `native-runtime-event` Tauri events for hidden native turns
  and approval resolutions;
- GUI maps native `tool_pending` / `approval_pending` / `ask_user` /
  `tool_end` / `turn_end` / `run_complete` into the existing conversation
  store instead of creating a parallel native UI;
- GUI native session sends call `native_session_run_turn` after the existing
  user-message persistence path, skipping Python bridge spawn and history
  replay;
- GUI native approvals call `native_approval_response`, letting Rust Core own
  tool-event persistence and approval resolution;
- restored native assistant rows can read native-shaped `tool_calls` /
  `tool_results` payloads.

Deferred from the full 4A gate:

- provider-native tool-choice request wiring;
- durable allow-policy persistence for `always_allow_project` /
  `always_allow_global`;
- real file, process, browser, memory, Goal Hive, or Morphling side effects.

Exit gate for the skeleton:

- mock-model tests cover tool-call routing for each 9-tool schema;
- tool pending/start/progress/end events are ordered and persisted as expected;
- approval events expose the future GUI/CLI shape without executing side
  effects;
- approval allow/deny can resume or deny the exact suspended native tool call;
- `ask_user` is recognized and can enter a waiting state that the next native
  `session.send` resumes;
- GUI projection can display native pending approvals, ask-user prompts, and
  settled stub tool results without spawning a Python bridge;
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

- implement `file_read`; landed in Slice 4B1 with read-only execution,
  workspace-relative resolution, and approval-gated absolute paths outside the
  workspace;
- feed `file_read` results back to the model once; landed in Slice 4B2 for
  non-stream turns without pending approval or `ask_user`;
- continue after approved `file_read`; landed in Slice 4B3 for approval-gated
  read-only paths, updating the same assistant turn and event stream;
- continue after approved local write/process tools; landed in Slice 4B7 for
  `file_patch`, `file_write`, and `code_run`;
- implement `file_patch`; landed in Slice 4B4 with GA-style
  `old_content` / `new_content` preview and approval-gated unique replacement;
- implement `file_write`; landed in Slice 4B5 with preview-first create and
  explicit overwrite execution;
- implement `code_run`; landed in Slice 4B6 with explicit cwd policy, timeout
  kill, stdout/stderr capture, and exit-status reporting;
- add timeout, cancellation, stdout/stderr, and exit-status capture; landed in
  Slice 4B6 for non-streaming `tool_end` results;
- project `code_run` stdout/stderr as ordered `tool_progress` events; landed in
  Slice 4B8 as replayable event materialization before true live approval
  execution;
- add first-pass risk policy for local destructive or credential-adjacent
  actions;
- keep Project workspace integration minimal until Slice 6.

Exit gate:

- temp workspace file read/write/patch tests pass;
- patch/write show diff or preview material before risky writes;
- risky local action reuses the landed approval flow and resumes after
  allow/deny;
- `code_run` handles timeout, cancellation, exit status, stdout, and stderr;
- `code_run` output can appear before `tool_end` through additive
  `tool_progress.stream` / `delta` / `truncated` fields;
- managed/external file/code behavior is unchanged;
- Browser Control is not part of this gate.

Landed in Slice 4B3 follow-up:

- hidden native `session.approval_response` now runs one continuation model
  request after an approved successful `file_read`;
- the approved read stays read-only and records `sideEffectsPerformed: false`;
- the same assistant message row is updated with the continuation answer while
  retaining `tool_results` for audit;
- `session.watch` can replay approval resolution, tool execution,
  `turn_progress(source=model_continuation)`, final `turn_end`, and
  `run_complete(mode=approval_response_continuation)`;
- failed or unavailable continuation models do not drop the approved tool
  result; Core emits `runtime_error` and completes with the tool-result content;
- write/process/browser/memory/Goal/Morphling executors remain disabled or
  stubbed.

Landed in Slice 4B4 follow-up:

- hidden native `file_patch` now accepts the GA-compatible targeted replacement
  contract: `path`, `old_content`, and `new_content`;
- Core normalizes `oldContent` / `newContent` aliases into snake_case before
  events and persistence, so the existing GUI `PatchView` can render a diff in
  the approval card;
- missing or opaque `patch`-only calls fail without approval, avoiding black-box
  write prompts;
- approved `file_patch` rereads the file at execution time and writes only when
  `old_content` matches exactly once;
- successful patch results set `sideEffectsPerformed: true` and are recorded in
  the assistant turn's `tool_results`;
- `file_write`, `code_run`, Browser Control, memory, Goal Hive, and Morphling
  remain disabled or stubbed.

Landed in Slice 4B5 follow-up:

- hidden native `file_write` now supports only `mode: "create"` and
  `mode: "overwrite"`;
- omitted `mode` defaults to create, while `overwrite: true` normalizes to
  explicit overwrite;
- Core enriches valid pending approval args with `existing_content`, allowing
  the GUI approval card to reuse `PatchView` for full-file replacement preview;
- model-supplied preview fields are ignored and replaced with Core-generated
  values;
- missing-preview, stale-preview, `append`, `prepend`, and otherwise opaque
  writes fail without side effects;
- approved create writes only when the target still does not exist;
- approved overwrite rereads the file and writes only when current content still
  matches the preview;
- successful writes set `sideEffectsPerformed: true` and are recorded in the
  assistant turn's `tool_results`;
- at the 4B5 checkpoint, `code_run`, Browser Control, memory, Goal Hive, and
  Morphling remained disabled or stubbed.

Landed in Slice 4B6 follow-up:

- hidden native `code_run` now supports approval-gated shell command execution;
- Core normalizes `cmd` / `code` into `command`, `timeout_seconds` into
  `timeoutSeconds`, and defaults timeout to 30 seconds with a 120 second cap;
- omitted `cwd` resolves to the Project workspace; relative `cwd` must resolve
  inside that workspace; explicit absolute `cwd` is allowed only through the
  normal approval path;
- Core enriches valid pending approval args with `resolved_cwd`, allowing the
  GUI approval card to show the actual execution directory;
- missing command, invalid timeout, missing workspace, or unresolvable cwd fail
  without approval and without spawning a process;
- approved execution closes stdin, captures stdout/stderr with caps, reports
  exit code, timeout state, and duration, and kills timed-out commands;
- once a process is spawned, `sideEffectsPerformed` is `true` even if the command
  exits non-zero or times out;
- Browser Control, memory, Goal Hive, and Morphling remain disabled or stubbed.

Landed in Slice 4B7 follow-up:

- hidden native `session.approval_response` now runs one continuation model
  request after approved `file_patch`, `file_write`, and `code_run` results;
- the approved tool result remains in the response `toolResult` and assistant
  `tool_results` audit payload;
- the same assistant message row is updated with the continuation answer, and
  `assistantMessage` is returned in the approval response;
- `session.watch` can replay approval resolution, tool execution,
  `turn_progress(source=model_continuation)`, final `turn_end`, and
  `run_complete(mode=approval_response_continuation)` for local write/process
  tools;
- `deny` decisions still record a denied result and do not continue;
- Browser Control, memory, Goal Hive, and Morphling remain disabled or stubbed.

Landed in Slice 4B8 follow-up:

- `NativeToolStubResult` can carry non-serialized progress chunks for executor
  output without changing persisted `toolResult` JSON;
- hidden native `code_run` splits captured stdout/stderr into ordered
  `tool_progress` events before `tool_end`, with additive `stream`, `delta`, and
  `truncated` fields;
- GUI native projection consumes only progress events that carry `delta`, keeps
  them inside the existing tool card result preview while running, and lets the
  final `tool_end` result remain authoritative;
- `session.watch` replay now includes the materialized output events for
  approved `code_run`;
- this is not yet true live process streaming during
  `session.approval_response`; making approval execution background-published is
  a later lifecycle slice.

Rollback:

- disable local native executors and fall back to stubs.

## Slice 4C: Browser Control Executors

Goal: implement `web_scan` and `web_execute_js` with native Browser Control
readiness and recovery.

Primary RFCs:

- [RFC 2](./rfc-2-model-tool-loop.md)
- [RFC 7](./rfc-7-parity-harness-default-switch.md)

Tasks:

- implement Browser Control readiness probe; landed partly in Slice 4C1 by
  reusing Galley's existing `TMWebDriver` layout/context for native tools;
- connect native runtime to the existing browser bridge direction; landed in
  Slice 4C1 through an injectable native browser execution context;
- implement `web_scan`; landed in Slice 4C1 for tab metadata and simplified
  page content, including one continuation model request after successful
  scans;
- implement `web_execute_js`; landed in Slice 4C2 as an approval-gated browser
  action executor through the existing `TMWebDriver` / `simphtml` bridge;
- surface missing extension, sleeping service worker, reconnect, and no-tab
  states as actionable recovery; landed partly in Slice 4C3 as failed tool
  result recovery hints, with first-class runtime events still deferred;
- add deterministic safe JS scenario, such as reading `document.title`; landed
  in Slice 4C2 at the native tool unit-test level;
- keep managed Browser Control behavior unchanged.

Exit gate:

- no-extension state gives a clear next action;
- ready extension can discover tabs;
- safe JS execution succeeds in a controlled page;
- `web_scan` and `web_execute_js` events flow through the same runtime event
  stream as local tools;
- managed Browser Control still passes its existing checks.

State after Slice 4C1:

- GUI and socket hidden native runs now pass a native host context into the
  runtime; when Tauri `AppHandle` is available, that context points at the same
  prepared `TMWebDriver` extension bridge used by managed GA Browser Control;
- `web_scan` no longer routes to the Slice 4A stub. Without a browser context it
  fails explicitly with a Browser Control unavailable result; with a browser
  context it invokes bundled `TMWebDriver.py` and returns GA-shaped tab metadata
  and optional simplified page content;
- `web_scan` accepts GA-compatible `tabs_only`, `switch_tab_id`, and
  `text_only`, while retaining `tabId` as an alias;
- successful `web_scan` results join `file_read` in the one-pass read-only
  continuation path, so the selected native model can answer from page content;
- `web_execute_js`, granular browser approvals, live browser-action progress,
  and richer service-worker recovery are still deferred.

Landed in Slice 4C2 follow-up:

- `web_execute_js` no longer routes to the Slice 4A stub when Browser Control is
  available. It normalizes GA-compatible `script`, `switch_tab_id`, and
  `no_monitor` arguments, with `code`, `tabId`, `tab_id`, `switchTabId`, and
  `noMonitor` aliases retained for model drift and existing Galley prompts;
- executable `web_execute_js` calls are `risk_based` and pause for approval
  before JavaScript is sent to the browser;
- missing Browser Control, missing script, and unsupported `save_to_file`
  requests fail without approval and without side effects;
- approved `web_execute_js` results enter the same one-pass continuation path as
  approved file/code executors, so the selected native model can interpret the
  browser result in the same assistant turn;
- GUI approval projection now shows the JavaScript body directly;
- granular read-only-vs-action browser approval, dedicated disconnected /
  service-worker recovery events, and live browser-action progress remain
  deferred.

Landed in Slice 4C3 follow-up:

- failed native browser tool results can include a `recovery` JSON object;
- `host_unavailable` covers no Tauri host / missing browser bridge context;
- `connected_no_tabs` covers an extension connection with no operable page and
  points the operator to open a normal page or the Browser Control test page;
- `not_connected` covers the extension not connecting to `TMWebDriver` and
  points the operator to open the configured Chrome / Edge browser or test the
  Browser Control connection;
- `web_execute_js` keeps `sideEffectsPerformed=false` when JavaScript was never
  delivered because the browser bridge had no connected tab/session;
- dedicated runtime recovery events and GUI action buttons remain deferred until
  the UI model is clearer.

Slice 4 completion state:

- hidden native has the GA-compatible 9-tool control plane, structured/text
  fallback parsing, no-tool recovery, approval pause/resume, ask-user
  pause/resume, GUI projection, CLI/watch replay, local file/code executors,
  Browser Control executors, browser recovery hints, and one-pass
  tool-result continuation;
- `update_working_checkpoint` and `start_long_term_update` remain recognized
  but intentionally non-durable until Slice 5;
- durable allow-policy persistence, provider-native tool-choice request wiring,
  background/live approval execution, and first-class browser recovery buttons
  are accepted follow-ups, not blockers for moving to Slice 5;
- memory, capability packs, Goal Hive, Morphling, and default switching are
  explicitly Slice 5+ work.

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

- implement `update_working_checkpoint` as short-lived session-local state;
  landed in Slice 5A through assistant `tool_results` persistence and compact
  prompt injection on later native turns;
- implement storage for memory items, evidence, index entries, and changes;
  landed in Slice 5B as Core-owned tables and typed DB helpers, without runtime
  memory writes yet;
- expose `memory://` resources through `file_read`; landed in Slice 5C for
  global and active Project L1/L2/L3/L4 read-only resources;
- implement low-risk memory change apply + undo; landed in Slice 5D for
  create changes;
- implement `start_long_term_update`; landed in Slice 5D for low-risk text
  memory, while high-risk/capability/script/tool/browser updates still require
  approval or remain unsupported;
- add built-in pack registry; landed in Slice 5D as read-only built-in packs;
- expose `capability://` resources through `file_read`; landed in Slice 5D;
- add pack manifest validation; landed in Slice 5D for built-in pack manifests;
- connect pack triggers to L1; landed in Slice 5D by appending capability
  pointers to active memory L1 resources;
- add script execution policy through `code_run`; landed in Slice 5D by
  refusing `capability://` script execution until a materialize-by-hash approval
  path exists;
- add timeline events for memory/pack updates; landed in Slice 5D for memory
  writes through existing `tool_progress` / `tool_end` events. Pack updates are
  still deferred because V1 packs are read-only built-ins.

Exit gate:

- memory updates cite execution evidence;
- bad memory update can be undone;
- secrets are rejected or redirected to credential references;
- pack resource reads work without adding a 10th tool;
- no import from managed/external happens automatically.

Landed in Slice 5A follow-up:

- `update_working_checkpoint` no longer routes to the deterministic stub;
- successful checkpoints persist as assistant `tool_results`, trigger one
  continuation model request, and remain `sideEffectsPerformed=false`;
- future native model turns read the latest successful checkpoint from prior
  assistant `tool_results` and inject it as compact session-local context;
- checkpoint content is capped before storage and before prompt injection;
- durable memory/capability writes remain deferred to `start_long_term_update`
  and later Slice 5 work.

Landed in Slice 5B follow-up:

- migration 022 adds `native_memory_items`, `native_memory_index_entries`,
  `native_memory_evidence`, and `native_memory_changes`;
- Rust Core exposes typed internal helpers for memory item, index, evidence,
  and change creation/readback;
- memory changes require at least one evidence id before they can be recorded;
- scope is explicit as `global_user`, `project`, `workspace`, or
  `capability_pack`;
- no public Agent API, GUI surface, `memory://` resource, or
  `start_long_term_update` runtime write path is enabled yet.

Landed in Slice 5C follow-up:

- native runtime pre-renders global and active Project memory resources into the
  tool execution context;
- `file_read` can read `memory://...` resources without approval and without
  side effects;
- `memory://.../l1` renders compact index entries and points to deeper item
  resources;
- `memory://.../l2`, `l3`, and `l4` render layer item lists;
- `memory://.../l2/<item-id>` and equivalent L3/L4 item paths render item
  bodies with triggers, tags, source refs, and scope metadata;
- missing memory resources return an actionable list of available memory paths;
- durable memory writes, inspect/undo UI, and capability resources remain
  deferred.

Landed in Slice 5D follow-up:

- low-risk `start_long_term_update` calls create native evidence, memory item,
  L1 index entries, and an auto-applied create change;
- high-risk memory, capability, script, tool, browser, and pack updates still
  stop at approval or return an explicit unsupported policy result;
- create changes can be reverted by Core: the item becomes `deleted`, its index
  entries are removed, and the change moves to `reverted`;
- candidate text is rejected when it appears to contain a raw secret;
- memory write results update assistant `tool_results`, `tool_progress`, and
  `tool_end` so GUI/CLI timelines see the side effect;
- built-in read-only packs exist for Goal Hive, Morphling, and Browser Control;
- `capability://index`, `capability://<pack>/manifest`, and pack resource paths
  are exposed through `file_read`;
- capability pack manifests are validated at runtime context construction;
- active memory L1 resources include capability trigger pointers;
- `code_run` refuses `capability://` script execution until pack scripts have a
  materialize-by-hash approval and rollback path.

Rollback:

- disable memory writes while keeping read-only built-in resources available.

## Slice 6: Workspace And Session Continuity

Status: implemented as the first minimal continuity slice on 2026-06-17. See
[Slice 6 Workspace And Continuity](../devlog/2026-06-17-galley-native-slice-6-workspace-continuity.md).

Goal: make native sessions ergonomic for Project work and recoverable across
process restarts.

Primary RFC:

- [RFC 5](./rfc-5-workspace-session-continuity.md)

Tasks:

- store optional Project primary workspace; landed by treating the existing
  Project `root_path` as the native-only primary workspace, with no managed or
  external runtime behavior change;
- add native session scratch paths and retention policy; landed with
  Galley-owned `native-session-scratch/<session_id>` paths and conservative
  no-auto-cleanup retention for Slice 6;
- implement file mention indexing for native Project workspace; landed as
  runtime-provided read-only `workspace://index` resource with capped recursive
  path indexing for native model/tool context. GUI autocomplete remains later UI
  work;
- route file/code tools through explicit workspace policy; landed by passing
  workspace kind/status, scratch root, and effective root into native tool
  execution context and exposing `workspace://` resources through `file_read`;
- add native session snapshot/restore; landed as DB-backed idle-session
  restore: later native turns rebuild context from persisted transcript,
  working checkpoint, memory/capability resources, and workspace resources
  after app/Core restart. Persisted event-bus replay and mid-approval restore
  remain deferred;
- track runtime occupancy and heartbeat; landed as persisted native
  `running`/waiting/`idle` status transitions. Dedicated heartbeat rows remain
  deferred until background native workers exist;
- implement continue original vs copy-and-continue policy; landed by refusing
  `session.send` / GUI native run on `galley_native` sessions already marked
  `running`, with a deterministic `session_occupied` error that points callers
  to copy-and-continue;
- add copy-to-native path for managed sessions; landed as
  `session.copy_to_native` / `galley session copy-to-native <id>`, copying
  visible transcript, Project association, summary/turn count, and compatible
  model selection into a new native session without mutating the source.

Exit gate:

- app restart can restore and continue an idle native session from Galley DB
  state and runtime resources;
- occupied native session behavior is deterministic and write-safe;
- missing workspace produces actionable `workspace://snapshot` /
  `workspace://index` recovery text instead of silent scratch fallback;
- managed/external sessions are unaffected by Project workspace binding;
- copy-to-native preserves useful visible context without copying volatile
  runtime state.

Deferred:

- GUI Project settings for native workspace binding beyond existing
  `root_path`;
- native file mention autocomplete UI;
- explicit heartbeat/lease table for background native workers;
- restoring mid-approval / mid-ask-user state after app restart;
- scratch retention cleanup policy implementation and UI;
- managed-memory import candidates during copy-to-native.

Rollback:

- disable workspace binding for native while keeping scratch-only sessions.

## Slice 7: Goal Hive Native

Status: implemented on 2026-06-17.

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

Landed:

- `goal_proposals` / `goals` now allow hidden `runtime_kind = galley_native`
  behind `GALLEY_NATIVE_EXPERIMENTAL=1`;
- native `session.goal_master_plan` persists the master planning prompt as
  internal-only session context, then returns immediately to the Core
  controller fallback/seed planner;
- native `session.new_goal_worker` and `session.send` worker replies are
  materialized by the controller into task claim/completion, result event, and a
  new deliverable-anchor version;
- native `session.goal_synthesize` runs inline through the Rust native runtime
  and returns the final answer to the master session;
- native worker cleanup skips Python runner shutdown because no Python runner is
  owned for native sessions;
- native Goal prompts now allow evidence-backed native memory while explicitly
  banning Goal protocol state from memory.

Exit gate:

- small mock-model Goal reaches final synthesis;
- sustained-budget semantics are preserved;
- deliverable anchor history is inspectable;
- worker internal messages remain out of normal user search/render paths unless
  already designed otherwise.

Rollback:

- keep managed/external Goal path as fallback; disable native Goal workers.

Deferred:

- richer native master planning that writes task-board changes directly through
  a typed native Goal tool surface;
- pacing/backoff for very fast mock/native workers under sustained-budget
  semantics;
- GUI task-board inspection for native Goal internals;
- Morphling mode and capability-pack absorption.

## Slice 8: Morphling Native Mode

Status: implemented as the first template/proposal mode on 2026-06-17.

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

Landed:

- `galley goal morphling <target>` creates a hidden `galley_native` Goal
  proposal with a structured Morphling objective template;
- Morphling proposals still require the normal Goal confirmation/run path and
  native experimental gate;
- the template captures target, objective, same-test evidence, component
  strategy bias, requested output shape, safety rules, and final deliverable
  requirements;
- built-in `capability://morphling` resources now describe Morphling as a Goal
  mode with same-test comparison discipline and disabled capability-pack
  promotion gates;
- no new `morphling` model-facing tool, schema field, or capability-script
  execution path was introduced.

Exit gate:

- toy CLI/library Morphling proposal carries same-test comparison criteria;
- output can become a disabled capability-pack candidate;
- no single low-level `morphling` tool is introduced.

Rollback:

- hide Morphling mode while keeping Goal Hive native available.

Deferred:

- GUI Morphling launcher;
- typed native Goal tool surface for model-authored task/deliverable writes;
- actual same-test execution harness and managed-vs-native comparison;
- capability-pack candidate persistence/inspection/activation workflow.

## Slice 9: Parity Harness And Opt-In Beta

Goal: prove native can replace managed for selected users before becoming the
new default.

Primary docs:

- [RFC 7](./rfc-7-parity-harness-default-switch.md)
- [Parity Scenario Manifest](./parity-scenario-manifest.md)

Slice 9 is intentionally split. It is too large to ship as one implementation
slice because it combines test infrastructure, managed-vs-native comparison,
dogfood evidence, Settings exposure, fallback routing, and support docs.

### Slice 9A: Parity Contract And Scenario Manifest

Status: documentation checkpoint landed on 2026-06-17.

Goal: freeze what "native parity" means before writing the harness.

Tasks:

- define comparison rules;
- define harness layers;
- define beta/default/support gate classes;
- define scenario IDs and pass signals;
- update RFC 7 and docs index.

Exit gate:

- scenario manifest can answer what must pass before opt-in beta;
- manifest distinguishes automated tests from dogfood evidence;
- manifest explains accepted variance and non-acceptable regressions;
- no runtime, schema, or UI behavior changes.

Rollback:

- revert the manifest and keep the previous RFC 7 scenario list.

### Slice 9B: Native Harness Coverage

Status: first deterministic parity-anchor batch landed on 2026-06-17.

Goal: make native's own behavior testable before comparing it to managed.

Tasks:

- add mock-model loop tests for P01, P03-P07, P09, P11, P12, P18;
- add native integration tests for safe file/code/workspace/resource paths;
- add event-order assertions for native tool/approval/ask-user/continuation;
- keep real model and managed comparison out of this slice.

Landed:

- added a Slice 9B anchor ledger in native runtime tests;
- anchored P01, P03, P04, P05, P06, P07, P09, P11, P12, and P18 with
  `pXX_...` test names;
- P09 now directly proves `memory://` reads go through `file_read` without a
  bespoke memory tool;
- P11 now directly proves `capability://` resources are read-only file
  resources and `code_run` refuses capability script URI execution;
- P05 now proves large code answers without tool calls stay no-tool answers;
- anchor tests read the parity scenario manifest so Pxx IDs cannot silently
  drift away from the docs.

Exit gate:

- native mock/integration scenarios have deterministic pass/fail signals;
- failures produce actionable assertion messages;
- harness does not require a real LLM or a real external GA checkout.

Rollback:

- remove the new harness tests without changing runtime behavior.

Deferred:

- broaden native integration coverage beyond the existing socket/file/code
  tests;
- convert more historical slice tests into Pxx-named anchors where useful;
- P15 CLI/Supervisor event compatibility remains Slice 9C;
- managed-vs-native comparison remains Slice 9D.

### Slice 9C: CLI And Supervisor Event Compatibility

Status: implemented for P15 schema/event compatibility on 2026-06-17.

Goal: prove public schema v1 consumers tolerate native runtime values and event
streams.

Tasks:

- test `runtimeKind = galley_native` through CLI JSON and socket/watch output;
- assert optional native event fields remain additive;
- verify older schema v1 callers can ignore native-specific fields;
- document any accepted event variance.

Landed:

- CLI test `p15_cli_schema_v1_lists_native_runtime_with_legacy_projection`
  proves `--schema=1` callers can receive `runtimeKind = galley_native` while
  older callers can still read `gaRuntimeKind`;
- socket test `p15_socket_schema_v1_native_watch_events_are_additive` proves a
  schema v1 `session.new` / `session.watch` native stream can be parsed by a
  legacy view that only reads `stream`, `requestId`, `data.kind`,
  `data.sessionId`, and end-frame `reason`;
- Agent API docs now state native watch frames are additive and unknown native
  fields should be ignored by Supervisor callers.

Exit gate:

- P15 passes in CLI/socket tests;
- no breaking schema v1 change is introduced;
- Supervisor-facing troubleshooting copy names native-specific unavailable
  states.

Rollback:

- keep native hidden and revert only compatibility tests/docs if they are wrong.

Deferred:

- live CLI dogfood with a real supervisor process;
- `session follow` parity-specific tests;
- managed-vs-native semantic comparison remains Slice 9D.

### Slice 9D: Managed-Vs-Native Scenario Comparator

Status: report-contract checkpoint landed on 2026-06-17; runner not yet
implemented.

Goal: compare managed and native semantically without pretending LLM wording is
deterministic.

Primary doc:

- [Parity Comparator Report](./parity-comparator-report.md)

Tasks:

- build a scenario runner that records managed and native evidence;
- compare outcome class, tool/action class, approval path, event rhythm, and
  persisted state;
- start with P01, P03, P04, P08, P14, P18, P19;
- produce human-reviewable diffs for model-dependent output.

Sub-slices:

- 9D-A: define report contract, verdicts, comparison dimensions, first scenario
  batch, and safety rules;
- 9D-B: implement first local report writer for fixture scenarios;
- 9D-C: run managed/native command comparison for P01, P03, P04, P14, and P18;
- 9D-D: add Browser and fallback scenarios P08 and P19.

Landed:

- 9D-A report contract defines verdicts `pass`, `fail`, `accepted_gap`,
  `blocked`, and `not_run`;
- first scenario batch is P01, P03, P04, P08, P14, P18, and P19;
- report dimensions are outcome, tool/action, event rhythm, approval,
  side effects, memory policy, workspace policy, recovery, and persisted state;
- report JSON shape keeps both managed and native runtime objects present even
  when one side is blocked;
- safety rules forbid external GA state writes and require temporary
  workspaces/test pages for side-effect scenarios.

Exit gate:

- comparator can mark pass/fail/accepted-gap per scenario;
- at least one managed and native run can be compared without mutating external
  GA state;
- accepted gaps are explicit and linked to follow-up slices.

Rollback:

- disable comparator reports while keeping native harness coverage.

Deferred:

- runner implementation;
- report file location/naming convention;
- real managed GA execution;
- browser/fallback comparison;
- Settings or GUI report surfacing.

### Slice 9E: Dogfood Evidence And Troubleshooting

Goal: collect real-use evidence and make native failures recoverable.

Tasks:

- create local dogfood checklist/report format;
- record Browser, memory, Goal Hive, Morphling, continuation, and fallback
  evidence;
- write troubleshooting docs for model, browser, workspace, approval, memory,
  and fallback errors;
- keep metrics local/devlog-based unless a separate privacy decision adds
  telemetry.

Exit gate:

- P08, P10, P13, P16, P17, P18, and P19 have dogfood evidence or accepted gaps;
- troubleshooting tells the user what to do next;
- no remote telemetry is added.

Rollback:

- remove dogfood docs/reporting without changing runtime behavior.

### Slice 9F: Opt-In Beta And Managed Fallback

Goal: expose native to selected built-in users only after evidence exists.

Tasks:

- add visible experimental native opt-in in Settings;
- keep managed as the default built-in runtime;
- test copy-to-native and fallback-to-managed flows;
- ensure native sessions remain readable if the opt-in is disabled;
- update release/support docs.

Exit gate:

- required beta-blocker scenarios pass or have accepted gaps;
- fallback to managed is tested;
- Settings copy is clear that native is experimental;
- ordinary users who do nothing remain on managed.

Rollback:

- remove opt-in from Settings and keep native hidden;
- keep native sessions readable;
- keep managed and external GA behavior unchanged.

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
