# Galley Native RFC 2: Model And Tool Loop

> Status: draft decision document.
>
> Scope: native agent loop, model adapters, tool execution, approval, and turn
> semantics. This RFC does not implement the runtime.

## Decision

`galley_native` V1 should be a Rust semantic port of GenericAgent's model/tool
loop, not a new experimental agent loop.

The loop should preserve GA's strongest behavior:

- compact context with high information density;
- autonomous multi-turn execution;
- the 9 atomic tools;
- `no_tool` as a meaningful outcome;
- per-turn summaries;
- approval-aware tool execution;
- hierarchical memory and verified long-term updates;
- browser control as a first-class tool pair.

The implementation can be fully Rust-native. The behavior should feel like the
GA experience that already works inside Galley, with Galley-owned events,
storage, and UX.

## Why This Matters For Users

Users do not care whether the loop is Python or Rust. They care whether the
agent can keep working, recover from uncertainty, use tools safely, remember
verified lessons, and explain what it is doing.

If native changes the loop too early, Galley risks losing the exact thing that
made GA worth productizing. If native ports the semantics first, Galley can
then improve reliability, UX, and memory without guessing at a new agent design.

## Loop Shape

The native loop should be explicit and testable.

```text
1. Load session state and runtime policy.
2. Build compact prompt from core instructions, model policy, memory pointers,
   workspace facts, and current task context.
3. Append the user's message or follow-up turn input.
4. Call the selected model through a normalized adapter.
5. Stream assistant content and thought/tool-call deltas as runtime events.
6. Parse tool calls from structured model output or fallback text format.
7. If no tool call appears, run the `no_tool` decision path.
8. For each approved tool call, emit pending/start/progress/end events.
9. Feed compact tool results into the next model turn.
10. Summarize the turn and update working checkpoint when needed.
11. Continue until completion, `ask_user`, abort, max-turn guard, or error.
```

The loop should not depend on GUI state. GUI and CLI are presenters over the
same Core-owned runtime events.

## Canonical Message Model

Native needs one internal message representation that model adapters and tools
can share.

Suggested shape:

```text
NativeMessage
  role: system | user | assistant | tool
  blocks: Vec<ContentBlock>
  metadata: MessageMetadata

ContentBlock
  Text
  Thinking
  ToolUse
  ToolResult
  Image
  FilePointer
  WorkspacePointer
```

Why this matters:

- OpenAI-compatible, Anthropic-compatible, and future Responses-style providers
  can normalize into one history shape.
- Tool results can be summarized or expanded by policy.
- Images and file references can be represented without special-casing every
  provider in the loop.
- Turn summaries and memory extraction can inspect structured content instead
  of scraping raw text.

## Model Adapters

V1 adapters should cover:

- OpenAI-compatible chat/tool-call APIs;
- Anthropic-compatible messages/tool-use APIs.

Adapters own provider-specific details:

- request format;
- streaming deltas;
- tool-call encoding;
- stop reasons;
- token usage;
- retryable errors;
- model-specific warnings;
- max-token and incomplete-response handling.

The runtime owns semantics:

- whether to continue;
- how to treat `no_tool`;
- whether a tool needs approval;
- how to summarize;
- when to update memory.

This separation matters because model providers will change faster than
Galley's agent semantics.

## Tool Calls

Prefer structured tool calls where the provider supports them. Keep a fallback
parser for text-encoded tool calls because local/proxy providers may lag behind
first-party APIs.

Native should parse into:

```text
ToolCall
  id
  name
  arguments_json
  raw_arguments_text
  source: structured | text_fallback
  risk_hint?
```

Parsing failure is not automatically a fatal runtime error. It can become a
model-facing correction turn if the response is otherwise recoverable.

## The 9 Parity Tools

V1 native must preserve the GA parity set.

| Tool | Purpose | Native owner | Default approval |
|---|---|---|---|
| `code_run` | Execute shell/Python/Node or other local commands | Core tool runner | Risk-based |
| `file_read` | Read files or ranges from workspace/system paths | Core file tool | Usually none for allowed paths |
| `file_patch` | Apply targeted edits | Core file tool | Risk-based |
| `file_write` | Create or overwrite files | Core file tool | Risk-based |
| `web_scan` | Inspect browser tabs and simplified page state | Browser bridge | Usually none after setup |
| `web_execute_js` | Control pages/tabs through JS | Browser bridge | Risk-based |
| `update_working_checkpoint` | Update current task state | Native session state | None |
| `ask_user` | Suspend for human input | Core ask-user event | Always visible |
| `start_long_term_update` | Launch verified memory/capability update | Native memory worker | Approval for durable writes |

The names can remain GA-compatible in V1. Later product-facing names can be
introduced only if they reduce user confusion without breaking model parity.

## Tool Registry

Each tool should be registered with:

```text
ToolSpec
  model_name
  model_description
  input_schema
  executor
  risk_policy
  workspace_policy
  progress_policy
  result_policy
  availability_policy
```

The model sees a compact tool description. The runtime keeps richer metadata
for approvals, audit, progress, and UI.

Tool availability can depend on:

- active workspace;
- Browser Control readiness;
- platform;
- YOLO/approval mode;
- Project policy;
- capability pack activation.

## `code_run`

`code_run` is a tool, not the runtime.

Native can execute Python, Node, shell commands, or other interpreters as tool
subprocesses. That does not make the agent loop Python-owned.

Required behavior:

- stream stdout/stderr progress when useful;
- enforce cwd/workspace policy;
- preserve timeout and cancellation;
- capture exit status;
- avoid hiding destructive commands behind generic success text;
- support small helper scripts created by capability packs.

Risk policy should look at command intent, affected paths, network use,
credential exposure, deletion, installation, commit/push, and external sends.

## File Tools

File tools should be workspace-aware but not workspace-only.

Default behavior:

- prefer Project workspace when present;
- allow explicit absolute paths when policy allows;
- preserve clear errors for missing paths and permission boundaries;
- show previews/diffs for risky writes;
- avoid all-runtime cwd coupling.

`file_patch` should be the preferred edit tool for modifications. `file_write`
should exist for creation and deliberate replacement, not casual patching.

## Browser Tools

Browser ability is V1 parity, not a later plugin.

Native should reuse the current Browser Control direction:

- readiness probes are Galley-owned;
- `web_scan` returns compact tab/page state;
- `web_execute_js` performs precise browser actions;
- recovery flows belong in Galley UI/diagnostics;
- the model should not need GA extension paths or Python bridge details.

Browser failures should become actionable runtime events, not raw extension
stack traces.

## `ask_user`

`ask_user` suspends the loop and makes the next action clear.

It is not a normal final answer. It should:

- emit a visible ask-user event;
- store the pending question in session state;
- let GUI/CLI/Supervisor answer through the same runtime router;
- resume the same native loop after the response;
- preserve the turn summary and checkpoint context.

## `no_tool`

`no_tool` is a semantic path, not simply "the model forgot a tool."

Native should classify no-tool turns:

| Case | Runtime response |
|---|---|
| Clear final answer | finish the turn |
| The model says it needs action but calls no tool | correction turn |
| Large code block intended as file edit | intervention asking for tool use |
| Incomplete/max-token response | continue or repair turn |
| Repeated no-tool dead end | summarize, checkpoint, and ask or fail clearly |

This preserves GA's practical resilience: the loop can recover from provider
quirks without making every malformed response a user-visible crash.

## Turn Summaries

Every completed or interrupted turn should have compact summary material.

The summary is used for:

- session restore;
- long-running autonomous loops;
- Goal worker status;
- memory update candidates;
- UI timelines;
- Supervisor follow-up context.

Native should prefer model-produced summaries when reliable, then fall back to a
runtime-generated compact summary from structured events.

Do not store raw high-volume tool output as the only durable context.

## Memory And Long-Term Update

The loop should call memory through explicit policies.

Read path:

- inject compact L1 pointers by default;
- fetch deeper memory only when the task indicates it;
- include Project memory only when the session is Project-scoped;
- avoid flooding every turn with full memory bodies.

Write path:

- `start_long_term_update` starts a separate verified update flow;
- memory writes require evidence from executed work;
- self-evolved SOPs/scripts/capability notes are Galley-owned artifacts;
- durable writes are inspectable and reversible;
- external GA memory is never written by native.

Core rule:

```text
No Execution, No Memory.
```

## Working Checkpoint

`update_working_checkpoint` should update short-lived session state, not durable
memory.

It captures:

- current objective;
- accepted facts;
- attempted approaches;
- blockers;
- next action;
- verification status.

This gives long tasks continuity without polluting long-term memory.

## Approval Model

Approvals should be runtime-native but compatible with existing GUI/CLI events.

Approval inputs:

- tool name;
- arguments;
- affected paths/domains;
- risk policy result;
- current YOLO mode;
- Project/workspace scope;
- whether the action writes durable memory or external state.

Approval outputs:

- allow once;
- deny once;
- allow scoped class;
- require user clarification.

Self-evolution and external effects should stay stricter than ordinary reads
and local deterministic commands.

## Autonomous Loop Guards

Native needs explicit guards:

- max model/tool turns per user task;
- max wall-clock budget;
- repeated-error detector;
- repeated-no-tool detector;
- runaway output detector;
- browser/tool unavailable detector;
- user abort.

On guard trip, the runtime should summarize what happened and provide the next
action. A silent stop is a product failure.

## Goal Hive Integration

Goal Hive should use the same loop, not a second agent framework.

Native master and worker sessions differ by prompt and task-board context:

- master decomposes, judges, aggregates, and assigns;
- workers execute concrete tasks;
- controller tracks budget, current-best deliverable, and verification status;
- final answer returns to the user's master session.

Goal state stays in Galley Core. The model sees compact task-board context
through prompt and tools, not direct database ownership.

## Morphling Integration

Morphling should be a structured Goal mode over the same loop.

Required Morphling artifacts:

- target capability definition;
- extracted or constructed tests;
- component strategy: call, rewrite, discard;
- implementation path;
- same-test comparison;
- capability absorption note.

Do not implement Morphling as one giant low-level tool. It is an orchestration
pattern over native sessions, tools, memory, and verification.

## Parity Test Harness

Native needs a harness before default switch.

Test types:

- deterministic mock-model loop tests;
- structured tool-call parser tests;
- text fallback parser tests;
- approval policy tests;
- file patch/write safety tests;
- Browser Control mocked bridge tests;
- memory write policy tests;
- Goal controller integration tests;
- parity scenarios run against managed GA and native.

Parity tests should compare outcomes and event semantics, not exact token text.
LLMs are nondeterministic; the harness should measure whether native can solve
the same class of work with the same safety boundaries.

## Implementation Order

1. Define canonical message/content-block types.
2. Implement model adapter traits and mock-model fixtures.
3. Implement streaming text and final answer path.
4. Add structured tool-call parsing.
5. Add the 9-tool registry with stub executors.
6. Wire approval events and decisions.
7. Implement file/code tools.
8. Implement Browser Control tools.
9. Implement `no_tool`, summary, and checkpoint behavior.
10. Add memory read/write policy and `start_long_term_update`.
11. Connect Goal Hive workers and Morphling mode.
12. Build managed-vs-native parity scenarios.

## Open Questions

- Should native support provider-native reasoning/thinking blocks in the stored
  message model, or collapse them into metadata?
- Which model adapters are required before dogfood: OpenAI-compatible plus
  Anthropic-compatible, or one adapter first with a mock provider?
- Should text fallback tool calls be enabled for all providers or only for
  providers marked as weak structured-tool callers?
- What exact approval classes should be shared with managed GA during
  migration?
- Where should capability-pack helper scripts live on disk?
- How much of native memory editing belongs in V1 UI versus diagnostics? Track
  the storage and event side in [RFC 3: Native Memory](./rfc-3-native-memory.md)
  before turning this into UI implementation.

## Rejected Alternatives

### Hand-Roll A New Loop First

Rejected because GA's loop is already proven in Galley. Native's first job is
to carry that value into a Core-owned implementation.

### Port Provider-Specific History Directly

Rejected because it would make every tool, memory, and summary feature depend
on provider quirks. Native needs one canonical message model.

### Make Browser A Later Capability Pack

Rejected because browser work is central to GA parity and product usefulness.
Leaving it out would make native feel like a regression for built-in users.

### Treat Memory Writes As Normal Tool Writes

Rejected because durable self-evolution changes future behavior. It needs a
stronger evidence and approval policy than ordinary scratch-file updates.
