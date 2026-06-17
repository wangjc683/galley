# Galley Native

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
9. [Parity Scenario Manifest](./parity-scenario-manifest.md)
10. [Parity Comparator Report](./parity-comparator-report.md)
11. [Open Decisions](./open-decisions.md)
12. [Implementation Slices](./implementation-slices.md)
13. [Slice 1 Read-Only Audit](./slice-1-readonly-audit.md)

## Implementation Status

- Slice 1 landed the hidden runtime identity/router gate on 2026-06-16:
  [devlog](../devlog/2026-06-16-galley-native-slice-1-runtime-router.md).
- Slice 2 landed the hidden native mock worker/session path, internal native
  message/event contract, and same-process native `session.watch` bus on
  2026-06-16:
  [devlog](../devlog/2026-06-16-galley-native-slice-2-native-worker-skeleton.md).
- Slice 3A landed the first hidden native model adapter on 2026-06-16:
  OpenAI-compatible API-key managed model records can complete a no-tool native
  turn, while unsupported/no-model setups keep the mock fallback.
  [devlog](../devlog/2026-06-16-galley-native-slice-3a-model-adapter.md).
- Slice 3B landed OpenAI-compatible streaming on 2026-06-16: native no-tool
  turns can emit multiple `turn_progress` deltas through the native event bus
  when the selected managed model enables `"stream": true`.
  [devlog](../devlog/2026-06-16-galley-native-slice-3b-streaming.md).
- Slice 3C landed Anthropic-compatible API-key adapter parity on 2026-06-16:
  native no-tool turns can use Anthropic `/messages` responses and streaming
  events through the same native event bus.
  [devlog](../devlog/2026-06-16-galley-native-slice-3c-anthropic-adapter.md).
- Slice 4A landed the hidden native tool-control-plane skeleton on
  2026-06-16: native can parse GA parity tool intent, emit tool/approval
  events, persist `tool_calls` / `tool_results`, and route all 9 tools to
  deterministic no-side-effect stubs.
  [devlog](../devlog/2026-06-16-galley-native-slice-4a-tool-control-plane.md).
- Slice 4A2A landed hidden native interaction state on 2026-06-16:
  `session.send` can run follow-up native turns, and `ask_user` can enter a
  persisted waiting state that the next `session.send` resumes.
  [devlog](../devlog/2026-06-16-galley-native-slice-4a2a-interaction-state.md).
- Slice 4A2B landed hidden native approval state on 2026-06-16: risky native
  tool calls now pause as pending approvals, and
  `session approval-response` can allow or deny the suspended call while all
  executors still return no-side-effect stubs.
  [devlog](../devlog/2026-06-16-galley-native-slice-4a2b-approval-state.md).
- Slice 4A2C landed GUI projection for hidden native on 2026-06-16: Core emits
  native runtime events to the desktop, the GUI maps them into the existing
  conversation / approval / ask-user surfaces, and native sessions no longer
  try to spawn a Python bridge.
  [devlog](../devlog/2026-06-16-galley-native-slice-4a2c-gui-projection.md).
- Slice 4B1 landed the first real local executor on 2026-06-16: hidden native
  `file_read` can read workspace-relative files when a Project `root_path` is
  present, and absolute paths outside that workspace pause for approval before
  reading. Write/process/browser/memory/Goal/Morphling executors remain
  disabled or stubbed.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b1-file-read.md).
- Slice 4B2 landed one-pass tool-result continuation on 2026-06-16: when a
  hidden native non-stream model turn produces `file_read` results without
  pending approval or `ask_user`, Core sends those results back to the model and
  persists the continuation answer as the assistant final answer.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b2-tool-result-continuation.md).
- Slice 4B3 landed approved `file_read` continuation on 2026-06-16: when a
  hidden native `file_read` pauses for approval and is allowed, Core performs the
  read-only executor, records the tool result, runs one continuation model
  request, updates the same assistant turn, and emits a final `turn_end`.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b3-approved-file-read-continuation.md).
- Slice 4B4 landed preview-first `file_patch` on 2026-06-16: hidden native
  accepts GA-style `path` / `old_content` / `new_content`, shows that diff in
  the existing approval card, and only writes after approval when `old_content`
  still matches exactly once.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b4-file-patch-preview.md).
- Slice 4B5 landed preview-first `file_write` on 2026-06-16: hidden native can
  create or explicitly overwrite files only after Core adds `existing_content`
  to the approval args and the GUI shows the full replacement preview; stale or
  opaque writes fail without side effects.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b5-file-write-preview.md).
- Slice 4B6 landed approval-gated `code_run` on 2026-06-16: hidden native
  resolves cwd, timeout, and command before approval; allow runs a shell command
  with stdin closed, stdout/stderr captured, exit status recorded, and timeout
  kill support.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b6-code-run.md).
- Slice 4B7 landed approved local-tool continuation on 2026-06-16: approved
  `file_patch`, `file_write`, and `code_run` results are fed back to the selected
  native model once, updating the same assistant turn while keeping tool results
  for audit.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b7-approved-tool-continuation.md).
- Slice 4B8 landed materialized `code_run` output progress on 2026-06-16:
  hidden native command stdout/stderr now appear as `tool_progress` events
  before `tool_end` and project into the existing GUI tool card preview. These
  events are replayable in the current trace; true live approval execution is
  still a later lifecycle slice.
  [devlog](../devlog/2026-06-16-galley-native-slice-4b8-code-run-progress.md).
- Slice 4C1 landed the first native Browser Control executor on 2026-06-17:
  hidden native `web_scan` now uses Galley's prepared `TMWebDriver` bridge to
  read tab metadata and simplified page content, and successful scans feed one
  continuation request back to the selected native model. Richer browser
  recovery remains deferred.
  [devlog](../devlog/2026-06-17-galley-native-slice-4c1-web-scan.md).
- Slice 4C2 landed approval-gated `web_execute_js` on 2026-06-17: hidden native
  executes JavaScript through the same `TMWebDriver` / `simphtml` Browser
  Control bridge, supports GA-compatible script/tab/no-monitor arguments, and
  feeds approved results into one continuation request. `save_to_file` is
  explicitly deferred so browser tools cannot bypass file-write previews.
  [devlog](../devlog/2026-06-17-galley-native-slice-4c2-web-execute-js.md).
- The native initial system prompt was aligned after 4C2 so the selected model
  sees the landed file/code/browser tool surface instead of the old
  `file_read`-only slice boundary.
  [devlog](../devlog/2026-06-17-galley-native-tool-prompt-alignment.md).
- Slice 4C3 added Browser Control recovery hints on 2026-06-17: failed native
  browser tool results can now distinguish missing desktop browser context,
  connected-with-no-tabs, and extension-not-connected states through a
  `recovery` JSON object.
  [devlog](../devlog/2026-06-17-galley-native-slice-4c3-browser-recovery-hints.md).
- Slice 4 is closed as of 2026-06-17: hidden native now has the tool control
  plane, approval/ask-user pauses, local file/code executors, Browser Control
  executors, and one-pass tool-result continuation needed before starting
  native memory work.
  [devlog](../devlog/2026-06-17-galley-native-slice-4-completion.md).
- Slice 5A landed the working checkpoint on 2026-06-17:
  `update_working_checkpoint` now records short-lived session-local state,
  triggers a continuation answer, and is injected into later native model turns
  without becoming durable memory.
  [devlog](../devlog/2026-06-17-galley-native-slice-5a-working-checkpoint.md).
- Slice 5B landed the native memory substrate on 2026-06-17:
  Core now owns typed memory item, index, evidence, and change tables plus
  internal DB helpers. The runtime still does not automatically write durable
  memory.
  [devlog](../devlog/2026-06-17-galley-native-slice-5b-memory-substrate.md).
- Slice 5C landed memory resource reads on 2026-06-17:
  hidden native `file_read` can now read pre-rendered `memory://` global and
  Project memory resources without adding a 10th tool or enabling durable
  memory writes.
  [devlog](../devlog/2026-06-17-galley-native-slice-5c-memory-resource-read.md).
- Slice 5D completed the first memory/capability substrate on 2026-06-17:
  low-risk `start_long_term_update` can write evidence-backed native memory, and
  hidden native can read built-in `capability://` resources.
  [devlog](../devlog/2026-06-17-galley-native-slice-5d-memory-capability.md).
- Slice 6 landed the first workspace/session-continuity loop on 2026-06-17:
  native turns use Project workspace or scratch policy, expose
  `workspace://snapshot` and `workspace://index`, reject occupied native sends
  before writing, and support copy-to-native from existing sessions.
  [devlog](../devlog/2026-06-17-galley-native-slice-6-workspace-continuity.md).
- Slice 7 landed the first native Goal Hive loop on 2026-06-17:
  hidden native Goal proposals are accepted behind the experimental gate,
  native master planning stays internal, native worker answers are materialized
  into Core task/result/deliverable state, and final synthesis returns through
  the master session.
  [devlog](../devlog/2026-06-17-galley-native-slice-7-goal-hive.md).
- Slice 8 landed the first Morphling native Goal mode on 2026-06-17:
  `galley goal morphling <target>` creates a hidden native Goal proposal with
  same-test evidence, component strategy, safety, and disabled
  capability-pack-candidate requirements baked into the objective template.
  [devlog](../devlog/2026-06-17-galley-native-slice-8-morphling-mode.md).
- Slice 9A landed the parity contract checkpoint on 2026-06-17:
  the parity scenario manifest defines scenario IDs, harness layers,
  beta/default/support gates, pass signals, and accepted variance before
  native is exposed as opt-in beta.
  [devlog](../devlog/2026-06-17-galley-native-slice-9a-parity-contract.md).
- Slice 9B landed the first native deterministic parity anchors on 2026-06-17:
  native runtime tests now expose P01, P03, P04, P05, P06, P07, P09, P11, P12,
  and P18 as `pXX_...` test names and keep those anchors tied to the parity
  scenario manifest.
  [devlog](../devlog/2026-06-17-galley-native-slice-9b-native-harness.md).
- Slice 9C landed CLI/Supervisor compatibility coverage on 2026-06-17:
  schema v1 callers can receive `runtimeKind = galley_native`, older callers
  still have `gaRuntimeKind`, and native watch events are additive for
  Supervisor parsers that only read `stream`, `kind`, `sessionId`, and
  end-frame `reason`.
  [devlog](../devlog/2026-06-17-galley-native-slice-9c-cli-supervisor-compat.md).
- Slice 9D-A landed the managed-vs-native comparator report contract on
  2026-06-17: first-batch comparison scenarios, verdicts, dimensions, JSON
  report shape, safety rules, and first runner boundary are now defined before
  runner implementation starts.
  [devlog](../devlog/2026-06-17-galley-native-slice-9d-comparator-contract.md).
- Slice 9D-B landed the first hidden fixture comparator on 2026-06-17:
  `galley native-parity report` can emit the managed-vs-native report contract
  for P01, P03, P04, P08, P14, P18, and P19 without starting GA, native
  sessions, Browser Control, schema changes, or UI exposure.
  [devlog](../devlog/2026-06-17-galley-native-slice-9d-fixture-comparator.md).
- Slice 9D-C landed explicit command mode for the hidden comparator on
  2026-06-17: `galley native-parity report --mode command` can run
  operator-supplied managed/native commands for P01, P03, P04, P14, and P18,
  then persist exit code, timeout, output preview, duration, and workspace
  evidence in the same report shape.
  [devlog](../devlog/2026-06-17-galley-native-slice-9d-command-mode.md).
- Slice 9D-D extended command evidence to Browser/fallback scenarios on
  2026-06-17: P08 and P19 can now be captured through the same hidden command
  mode, with P08 treated as Browser readiness `accepted_gap` evidence rather
  than automatic Browser Control parity.
  [devlog](../devlog/2026-06-17-galley-native-slice-9d-browser-fallback-command-evidence.md).
- Slice 9E-A landed the local dogfood evidence and troubleshooting format on
  2026-06-17: P08, P10, P13, P16, P17, P18, and P19 now have a maintainer
  checklist, local record template, verdict rules, and troubleshooting matrix
  before Settings opt-in work starts.
  [devlog](../devlog/2026-06-17-galley-native-slice-9e-dogfood-evidence-format.md).
- Slice 9E-B prep landed the support-readiness dogfood kit on 2026-06-17:
  P08/P18/P19 now have a concrete runbook, local artifact paths, command
  evidence examples, and a focused record template for JC's first real native
  dogfood pass.
  [devlog](../devlog/2026-06-17-galley-native-slice-9e-support-readiness-kit.md).

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
- [Parity Scenario Manifest](./parity-scenario-manifest.md): stable Slice 9A
  scenario IDs, comparison rules, harness layers, gates, pass signals, and
  evidence record shape.
- [Parity Comparator Report](./parity-comparator-report.md): Slice 9D
  managed-vs-native report contract, verdicts, dimensions, first scenario batch,
  and safety rules.
- [Dogfood Evidence](./dogfood-evidence.md): Slice 9E local evidence template,
  scenario checklists, verdict rules, and troubleshooting matrix.
- [Dogfood Kit](./dogfood/README.md): first support-readiness runbook and
  local record template for P08/P18/P19 dogfood.
- [Open Decisions](./open-decisions.md): pre-freeze decisions needed before
  Slice 1 starts.
- [Implementation Slices](./implementation-slices.md): sequencing and
  acceptance gates for future implementation.
- [Slice 1 Read-Only Audit](./slice-1-readonly-audit.md): current codebase
  coupling map and Goal-mode boundary for the runtime router skeleton.

## Next

After Slice 9B's first anchor batch, native can read files, answer from tool
results, apply targeted patches, perform preview-first create/overwrite writes,
run approval-gated local commands with bounded output, project command
stdout/stderr as ordered tool-progress events, read browser tabs/pages through
`web_scan`, execute
approval-gated browser JavaScript through `web_execute_js`, surface browser
recovery hints, keep a short-lived working checkpoint across turns, and persist
typed native memory ledger rows. It can read memory rows as `memory://`
resources, apply low-risk text memory through `start_long_term_update`, undo
create changes through Core helpers, and read built-in Goal Hive / Morphling /
Browser Control capability resources through `capability://`. Native sessions
also have explicit workspace/scratch context, read-only `workspace://`
resources, deterministic occupied-session refusal, and copy-to-native migration
for existing visible conversation context. Native Goal Hive has a hidden minimum
loop: Core-owned task board, internal master planning context, controller-owned
worker result materialization, deliverable anchor history, and native final
synthesis in the master session. Morphling can now be launched as a hidden
native Goal proposal template that enforces target locking, same-test evidence,
component strategy, safety boundaries, and disabled capability-pack candidate
output. The parity scenario manifest now defines what evidence is required
before native can become opt-in beta or the new-user default. The first native
deterministic parity anchors are executable with `cargo test` filters, and
Slice 9C locks the schema v1 CLI/Supervisor compatibility path for hidden native
runtime values and watch events. Slice 9D-B adds a hidden local fixture
comparator that emits the managed-vs-native report contract for the first
scenario batch before live runtime runner variance is introduced. Slice 9D-C
adds explicit command mode so operator-supplied managed/native runs can feed
real process evidence into that same report shape. Slice 9D-D extends that
path to Browser and fallback scenarios without auto-launching a browser or
rerouting work between runtimes. Slice 9E-A defines the local dogfood evidence
format and troubleshooting matrix for the evidence-heavy scenarios before
Settings opt-in. Slice 9E-B prep makes P08/P18/P19 dogfood executable with a
support-readiness runbook and local record template.

The next implementation phase should stay conservative:

1. broaden Slice 9B native integration coverage beyond the current runtime
   anchors where it materially increases confidence;
2. add automatic managed/native and Browser/fallback presets only after the
   explicit command mode has been used locally without muddying external GA
   state;
3. run the Slice 9E-B support-readiness dogfood pass for P08/P18/P19, then
   summarize sanitized verdicts/gaps/blockers;
4. expose Slice 9F Settings opt-in only after beta-blocker scenarios pass or
   have explicit accepted gaps;
5. keep dynamic capability-pack updates and default switching in later slices.
