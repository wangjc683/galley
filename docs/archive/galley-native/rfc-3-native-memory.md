# Galley Native RFC 3: Native Memory

> Status: draft decision document.
>
> Scope: Galley-owned native memory semantics, storage shape, prompt exposure,
> update flow, UI expectations, and safety boundaries. This RFC does not
> implement storage, schema, or runtime behavior.

## Decision

`galley_native` should preserve GenericAgent's layered memory semantics, but
not its file layout.

Native memory is Galley-owned typed state with evidence, diffs, scopes,
versions, and rollback. It may be materialized as model-readable resources, but
the source of truth is not `managed-ga-state/memory`, an external GA checkout,
or a loose hidden folder.

The core rule remains:

```text
No Execution, No Memory.
```

Only action-verified facts, reusable procedures, and hard-won lessons should
become durable memory.

## Why This Matters For Users

Good memory makes Galley feel less like a disposable chat window and more like a
local collaborator that gets better on this machine.

Bad memory makes the product worse: it repeats wrong assumptions, leaks
temporary coordination ids into future work, stores secrets, and forces users
to debug an invisible personality layer.

The native design should therefore make memory:

- useful by default;
- quiet in the main workflow;
- inspectable when users care;
- reversible when it goes wrong;
- scoped so Project knowledge does not pollute unrelated work;
- independent from external GenericAgent state.

## Reference Semantics From GA

GenericAgent's durable value is the memory discipline, not the directory names.

Semantics to preserve:

- L1 is a compact insight index and routing layer.
- L2 stores stable environment and user/project facts.
- L3 stores reusable SOPs, scripts, and task-specific capability notes.
- L4 stores historical session material for mining and recall.
- `update_working_checkpoint` is short-lived working state, not durable memory.
- `start_long_term_update` begins a deliberate distillation step after useful
  execution.
- L1 should encode existence and triggers, not detailed how-to content.
- Memory writes must be minimal, local, and based on verified work.
- Volatile protocol state must not become long-term memory.

Semantics not to inherit:

- Python `memory/` paths as the product model.
- `global_mem.txt` / `global_mem_insight.txt` as mandatory file names.
- Direct model writes into arbitrary memory files as the native source of truth.
- External GA memory writes.

## Memory Layers

Native should keep the GA layer model, expressed as typed Galley state.

| Layer | Name | Native meaning |
|---|---|---|
| L0 | Runtime rules | Core runtime policy, system constraints, memory write policy |
| L1 | Insight index | Compact trigger map that points to L2/L3/L4 resources |
| L2 | Facts | Stable verified facts about user, environment, Project, workspace |
| L3 | Procedures | SOPs, scripts, capability notes, and verified task patterns |
| L4 | Session archive | Compressed historical session summaries and evidence references |

L1 should stay small enough to inject frequently. L2/L3/L4 should be fetched
only when the task needs them.

## Scopes

Memory must be scoped before it is stored.

| Scope | Purpose | Examples |
|---|---|---|
| Global user | Stable facts/preferences for this Galley installation | user copy preference, durable local convention |
| Project | Knowledge tied to a Galley Project | repo conventions, project decisions, recurring workflows |
| Workspace | Verified filesystem facts tied to a Project workspace | build command, test command, important paths |
| Capability pack | Knowledge owned by a reusable pack | SOP, helper script, verification prompt |
| Session working | Short-lived continuity for a running task | current objective, blockers, accepted facts |
| Goal | Temporary coordination state for a Goal run | task ids, worker slots, events |

Only the first four are durable native memory. Session working state and Goal
state are runtime state, not long-term memory.

## Storage Model

Native memory should be modeled as records, not raw markdown files.

Suggested conceptual records:

```text
MemoryItem
  id
  layer
  scope
  title
  body
  triggers
  tags
  source_refs
  status
  created_at
  updated_at
  supersedes?

MemoryIndexEntry
  id
  scope
  trigger
  target_item_id
  rank
  reason

MemoryEvidence
  id
  session_id
  turn_id
  tool_call_id?
  event_id?
  content_hash
  summary

MemoryChange
  id
  target_item_id?
  kind: create | update | supersede | delete
  diff
  evidence_ids
  risk
  approval_state
  applied_at?
```

The exact database/file split can be decided during implementation. The product
requirement is that memory updates have identity, evidence, diffs, and rollback.

## Prompt Exposure

Native prompt construction should prefer existence encoding.

Default injection:

- L0 runtime memory policy;
- compact L1 index for global and active Project scopes;
- a short pointer to workspace memory when a Project workspace is bound;
- current working checkpoint;
- task-relevant memory pointers selected by lightweight retrieval.

Do not inject full L2/L3 bodies by default. The model should read deeper memory
only when the task calls for it.

This keeps context dense: the prompt tells the model what knowledge exists and
where to look, instead of paying for all of it every turn.

## Model-Readable Resources

V1 should preserve the 9-tool surface. Do not add a separate `memory_read` tool
unless parity evidence shows the model needs it.

Instead, native can expose memory and capability resources through stable
runtime resource paths that `file_read` can read:

```text
memory://global/l1
memory://global/l2/<item-id>
memory://project/<project-id>/l1
memory://project/<project-id>/l2/<item-id>
capability://<pack-id>/sops/<name>
capability://<pack-id>/scripts/<name>
```

`file_write` and `file_patch` should not directly mutate these resources in
normal operation. Durable memory changes go through `start_long_term_update`
and the native memory change pipeline.

## Read Path

Memory read policy:

1. Build active L1 from global, Project, and active capability scopes.
2. Include only triggers and pointers needed for routing.
3. Let the model request deeper content with `file_read`.
4. Log memory reads so future updates can cite what was actually consulted.
5. Summarize high-volume memory results before feeding the next turn when
   needed.

Reading memory is low-risk, but it still affects behavior. The runtime should
record which memory resources influenced a turn.

## Write Path

Durable memory writes should follow a deliberate pipeline:

```text
execution evidence
  -> memory candidate
  -> classification
  -> diff
  -> risk check
  -> apply or request approval
  -> update L1 pointers
  -> emit memory-change event
```

`start_long_term_update` starts this pipeline. It should not blindly append text
to memory.

The candidate must answer:

- What was verified?
- Which tool result proves it?
- Why will this matter later?
- Which scope owns it?
- Which layer should contain it?
- What existing item does it replace or update?
- What should appear in L1, if anything?

## Automatic Vs Reviewed Writes

Native should be useful without asking the user to approve every tiny memory
update.

Recommended V1 policy:

- Low-risk Galley-owned memory updates can apply automatically with an undoable
  change record.
- New scripts, external integrations, scheduled actions, credential-adjacent
  notes, destructive procedures, or broad behavior rules require explicit
  approval before activation.
- Anything that modifies core runtime code, provider configuration, release
  artifacts, or external GA state is outside normal memory write permission.

The default UX should be "Galley learned X" with inspect/undo, not an approval
modal after every useful task.

## What Must Not Be Stored

Native memory must reject:

- API keys, passwords, tokens, session cookies, private keys, and raw secrets;
- current timestamps as durable facts;
- process ids, worker ids, temporary session ids, Goal ids, task ids, and wave
  numbers;
- unverified model guesses;
- plans that were never executed;
- generic facts the model can easily reconstruct;
- high-volume raw logs without compression;
- user IM / supervisor conversations outside Galley;
- external GA memory/SOP/config/temp state.

Secrets belong in Galley's credential store. Memory may hold non-secret
references to configured credential records when needed.

## Working Checkpoint

`update_working_checkpoint` remains short-lived session state.

It can store:

- current objective;
- accepted facts;
- current plan;
- important blockers;
- selected SOP/capability pointer;
- next action.

It should not create durable memory by itself. At most, it can provide evidence
for a later `start_long_term_update`.

## Project And Workspace Memory

Project memory is not the same as workspace scanning.

Project memory stores durable knowledge about a user's project. Workspace tools
observe the filesystem. A workspace fact becomes memory only after it is
verified and judged useful across future sessions.

Examples that can become Project memory:

- verified test command;
- non-obvious build prerequisite;
- architecture decision confirmed in repo docs;
- recurring failure and the fix that worked.

Examples that should stay out:

- transient branch name;
- current uncommitted file list;
- one-off error logs;
- worker session ids from a Goal.

## L4 Session Archive

L4 should not be a dump of every token.

It should store compact historical material:

- user objective;
- final outcome;
- key tool evidence;
- linked memory changes;
- failure modes and recovery;
- pointers to full session records when needed.

L4 mining can later propose L1/L2/L3 updates, but those proposals still need
evidence and the same write policy.

## UI Expectations

Memory should not dominate first-run or the main chat surface.

Expected product surfaces:

- session timeline event when native memory changes;
- compact "learned" record with inspect and undo;
- Settings or Project-level memory inspector for advanced users;
- diff view for changed SOPs/scripts/facts;
- search/filter by scope, layer, trigger, capability pack, and source session;
- disabled-state explanation when memory writes are blocked by policy.

Do not make users manually manage L1/L2/L3 to get value. The system should carry
that complexity.

## Migration

Native memory should not automatically import managed GA memory on first launch.

Possible future migration action:

```text
Review managed GenericAgent memory -> propose native memory import
```

Rules:

- user chooses to import;
- import is copy-based, never a live dependency;
- external GA import is read-only and user-initiated;
- imported content becomes native memory only after classification and review;
- original managed/external state remains untouched.

## Acceptance Checks Before Code

Before implementing native memory, the design should answer:

- What storage owns `MemoryItem`, `MemoryIndexEntry`, `MemoryEvidence`, and
  `MemoryChange`?
- How does `file_read` access memory resources without adding a 10th tool?
- Which writes apply automatically and which require approval?
- How does undo work for a bad memory update?
- How does native prevent secrets from entering memory?
- How are Project memory and workspace facts kept distinct?
- How does L1 stay compact over time?
- How does L4 archive material avoid becoming noisy raw logs?

## Rejected Alternatives

### Reuse `managed-ga-state/memory`

Rejected because it preserves the GA file layout as the product boundary. Native
memory must be Galley-owned state with typed diffs, evidence, and rollback.

### Add A Large Memory Tool Surface

Rejected for V1 because GA parity depends on a small atomic tool set. Memory can
be exposed through resource paths and the existing `file_read` semantics.

### Ask Before Every Memory Write

Rejected because it would make self-evolution feel like paperwork. Low-risk
Galley-owned updates should be reversible and inspectable; high-risk changes
still need explicit approval.

### Store Goal Protocol State As Memory

Rejected because Goal ids, worker ids, task ids, and coordination logs are
runtime protocol state. Storing them as durable memory would poison future work.
