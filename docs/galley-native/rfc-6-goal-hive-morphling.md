# Galley Native RFC 6: Goal Hive And Morphling

> Status: accepted; Slice 7 minimal Goal Hive loop implemented on 2026-06-17.
>
> Scope: native Goal Hive semantics, master/worker behavior, Core task-board
> ownership, deliverables, workspaces, Morphling mode, and memory/capability
> absorption. Slice 7 implements the first native Goal Hive runtime bridge;
> Morphling remains a later slice.

## Decision

`galley_native` should preserve GenericAgent's Goal Hive and Morphling
semantics as native long-horizon modes over Galley Core.

Goal Hive remains Core-owned:

- Goal proposals, task board, events, deliverables, workspaces, and visible
  checkpoints live in Galley Core.
- Native master and workers are normal native sessions with specialized prompts
  and task-board context.
- Galley does not start GA's HTTP BBS, call GA native `/hive`, or write
  external GA state.

Morphling is a structured Goal mode, not a tool. It uses Goal Hive, file/code
tools, browser control, memory, capability packs, and verification to absorb or
replace a target capability.

## Why This Matters For Users

Some tasks cannot be solved well by a single linear chat loop. Users need
Galley to keep working, compare alternatives, verify, and improve until the
budget is spent.

The user-facing promise is:

```text
Give Galley a goal -> it organizes agents -> it keeps improving -> it returns
the best verified result to the conversation where the goal started.
```

The implementation must hide the coordination machinery without weakening it.

## Goal Hive Semantics To Preserve

Native Goal Hive should preserve these GA traits:

- Master is the design office, not a production worker.
- Workers execute concrete tasks.
- Worker count is concurrency budget, not "spawn exactly N immediately."
- Work continues until the time/budget horizon, not until the first usable
  result appears.
- The system maintains a current-best accepted deliverable.
- Later rounds probe gaps, verify assumptions, and improve the anchor.
- Final result returns to the user's master session.

This is the value. GA's HTTP BBS and text-file protocol are not the value.

## Core-Owned Objects

Native Goal should stand on existing Galley-owned concepts:

```text
Goal
GoalTask
GoalEvent
GoalDeliverable
GoalWorkspace
MasterSession
WorkerSession
VisibleCheckpoint
```

The model can read compact task-board context and post updates through Core
commands/tools. It should not own the database directly.

For V1, prefer existing Core/CLI Goal commands and native controller adapters
over adding a large Goal-specific model tool surface. If a future native Goal
tool is needed, it should be justified as part of the tool-extension policy in
[RFC 4: Capability Packs](./rfc-4-capability-packs.md).

## Master Behavior

Native master responsibilities:

- clarify the objective and value function;
- decompose work into independent tasks;
- assign worker tasks through the task board;
- judge worker output;
- maintain the deliverable anchor;
- request checks from independent workers;
- decide what improves the current-best result;
- synthesize final delivery.

The master should not do production work when workers can do it. It can write
planning/checking messages, but those are internal by default.

## Worker Behavior

Workers are generic task takers.

Each worker receives:

- Goal objective;
- concrete task id and title;
- scope and expected output;
- workspace/deliverable context;
- completion protocol;
- relevant memory/capability pointers.

Workers should not infer their identity from titles or Project state. Core owns
worker identity and task assignment.

## Sustained Budget

The selected run time is a work horizon.

Native should:

- keep dispatching useful work while budget remains;
- avoid stacking prompts into a live worker;
- drain active workers briefly after the deadline;
- stop creating new work after the deadline;
- synthesize honestly from current material;
- record gaps if work remains incomplete.

"Finished early" should mean "the remaining budget was spent checking and
improving", not "the first acceptable output stopped the run."

## Deliverable Anchor

Every Goal should maintain a current-best deliverable when the output type
allows it.

Rules:

- anchor improves monotonically by accepted changes;
- rejected changes do not overwrite the anchor;
- history is retained for rollback/audit;
- checks compare against the current anchor;
- final delivery prefers the anchor over a one-shot synthesis.

For file-heavy Goals, the anchor can be a workspace artifact plus a summary.

## Goal Workspace

Goal workspace is a Galley-owned scratch/work area for the Goal.

It is not the same as the Project workspace:

- Project workspace is the user's repo/root.
- Goal workspace is a per-Goal area for intermediate artifacts and generated
  deliverables.

Native workers may use both when policy allows. The Goal workspace is safer as
the default write target for generated artifacts. Writes into the user's
Project workspace should follow normal file approval policy.

## Memory Boundary

Goal protocol state must not become memory.

Do not store:

- Goal ids;
- task ids;
- worker session ids;
- worker indexes;
- wave numbers;
- temporary coordination logs;
- transient task-board state.

Reusable lessons from a Goal can become native memory or capability-pack
updates only through the normal evidence-backed pipeline after execution.

## Events And User Visibility

User-visible Goal flow should remain honest:

- user's objective is a user turn;
- Galley launch/checkpoint narration is system role;
- worker internals stay in worker sessions and Goal audit stream;
- final synthesis returns to the master session;
- completed/failed/stopped markers remain visible in the conversation.

The UI should show progress and result access without exposing task-board
protocol unless the user asks for details.

## Slice 7 Implementation Checkpoint

Slice 7 lands the smallest native Goal Hive loop that is useful without
pretending to be full Morphling:

- native Goal proposals and Goal rows are accepted only when the hidden
  `GALLEY_NATIVE_EXPERIMENTAL=1` gate is enabled;
- Core still owns Goal, GoalTask, GoalEvent, GoalDeliverable, workspace, master
  session, and worker session identity;
- native master planning context is persisted as `visibility = internal` and
  does not enter ordinary session rendering/search;
- the controller seeds/fallbacks task-board work for native V1 instead of
  requiring the model to mutate Goal state through ad hoc text protocol;
- each completed native worker answer is materialized by the controller into a
  task completion, result event, and deliverable-anchor version;
- final synthesis runs through the native runtime and returns to the master
  session as a visible answer.

This is intentionally a controller adapter, not a large new Goal tool surface.
That keeps the first user-facing risk low: managed/external Goal behavior is
unchanged, native remains hidden, and Core can inspect every task/result/write.

Known limits after Slice 7:

- native master planning does not yet have a typed model-callable Goal tool;
- very fast native/mock workers can consume waves quickly until existing wave
  caps or the deadline logic wrap the run;
- Morphling is still only a documented Goal mode;
- native Goal internals still need better GUI inspection before default
  rollout.

## Morphling Definition

Morphling is project-level capability absorption or replacement.

Given a target project/product/library/skill, Morphling should extract:

- what it solves;
- who it serves;
- what tests prove it works;
- which components are essential;
- which parts should be called, rewritten, or discarded;
- how Galley can match or exceed the target on the same exam.

Morphling output can be:

- a capability pack;
- a wrapper/integration;
- a rewritten repo/tool/product;
- a report explaining why not to absorb it.

## Morphling Flow

Native Morphling should run as a Goal mode:

1. Lock target source and scope.
2. Extract target objective and claims.
3. Find official tests, CI, benchmarks, demos, examples, or issue repros.
4. Construct minimal objective tests when none exist.
5. Decompose components.
6. Decide per component: call, rewrite, discard.
7. Implement the chosen path.
8. Run same-test comparison.
9. Record tradeoffs, gaps, and improvements.
10. Produce deliverable and/or capability pack.
11. Propose memory/capability absorption only with evidence.

The same-test comparison is the discipline that keeps Morphling from becoming
subjective imitation.

## Component Strategy

Morphling should avoid "copy the target" as a default.

Decision rules:

- Call mature non-differentiating dependencies when they are stable and lawful
  to use.
- Rewrite small, coupled, outdated, or UX-critical components when a cleaner
  implementation is better.
- Discard surface area that does not serve the user's objective.
- Narrow giant ecosystems to a concrete sub-capability.
- Do not reproduce proprietary code or protected assets as the strategy.

The output should solve the capability problem, not clone for its own sake.

## Capability Absorption

Calling-type Morphling often ends as a capability pack.

The pack should include:

- trigger/index entry;
- SOP;
- helper scripts or wrapper commands;
- permissions;
- tests;
- same-test comparison evidence;
- limitations and rollback notes.

Rewriting-type Morphling may produce a repo or user-facing artifact, with an
optional pack that teaches Galley how to maintain or reuse it.

## Approval And Safety

Goal Hive and Morphling do not bypass normal safety.

Still require explicit approval for:

- destructive filesystem changes;
- external sends;
- credential use beyond configured references;
- scheduled/background tasks;
- installing packages or services with lasting effects;
- writing into a user's Project workspace when risky;
- modifying core runtime code;
- activating new high-risk capability packs.

YOLO can reduce ordinary local approvals, but it should not silently approve
self-evolution into risky persistent capability.

## Acceptance Checks Before Code

Before implementation, the design should answer:

- How does native master write tasks and deliverables through Core?
- How are worker identities bound?
- How does the controller avoid prompt stacking?
- How does the deliverable anchor version and rollback?
- How do Goal workspace and Project workspace interact?
- Which Goal events become visible system messages?
- How does Morphling produce same-test evidence?
- How does Morphling output become a capability pack?

## Rejected Alternatives

### Use GA Native Hive Internals

Rejected because Galley already owns Goal state and must not start GA HTTP BBS
or write external GA protocol files.

### Make Morphling A Single Tool

Rejected because Morphling is a long-horizon protocol involving tests,
component strategy, implementation, comparison, and absorption.

### Let Master Do All Work

Rejected because official Hive's quality comes from master/worker separation
and independent checking, not from one bigger prompt.

### Stop At First Acceptable Result

Rejected because sustained budget and improvement rounds are central to the
Goal promise.
