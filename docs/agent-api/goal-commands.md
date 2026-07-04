# Agent API — Goal Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.19: the `galley goal` surface (Goal V1).

### 5.19 · `galley goal ...`

**Goal V1** is Galley's headless autonomous Hive surface. Galley Core owns the
Goal state, Project binding, task board, and event stream. Managed and external
GenericAgent runtimes participate only as ordinary Galley child sessions; this
surface does **not** call GA native `/hive`, start GA BBS, or write external GA
`memory/`, SOP, config, or `temp/goal_state.json`.

Goal commands are additive inside `schemaVersion: 1`. V1 intentionally has no
full task-board UI; the CLI and the TopBar Goal indicator are the control
surface.

#### `galley goal propose "<objective>" [--project=<id>] [--budget-minutes=30] [--workers=3] [--runtime=current|managed|external] [--write-mode=autonomous|read-only] [--expires-minutes=10] [--supervisor=<x>] [--reason=<y>]`

Creates a pending conversational-confirmation proposal. It does **not** start
work.

```bash
$ galley goal propose "review and fix flaky release checks" \
  --supervisor=ga-wechat-bot \
  --reason="user asked to start a Goal"
{"id":"gprop_...","objective":"review and fix flaky release checks",
 "budgetSeconds":1800,"workerLimit":3,"runtimeKind":"managed",
 "writeMode":"autonomous","status":"awaiting_confirmation",
 "internalConfirmToken":"gtok_...","confirmationPhrase":"确认启动 Goal",
 "expiresAt":"2026-06-04T12:34:56Z",...}
```

The `internalConfirmToken` is for the trusted local Supervisor only. Do not show
it to the user. `confirmationPhrase` is a ready-made reply the Supervisor may
offer the user; behaviorally, any unambiguous affirmative user reply that
refers to this proposal counts as confirmation (see the Supervisor SOP).

`--workers` defaults to `3`. Desktop presents `2`, `3`, `4`, and `5` to match
the official GA Hive guidance that ordinary Hive work usually fits in `2-4`
workers and should not exceed `5`. Core keeps the lower-level CLI/API value
within `1-5` so supervisors can still request a single-agent Goal when needed
without allowing oversized hives.

#### `galley goal run --proposal <proposal-id> --confirm-token <internal-token>` / `galley goal run <goal-id> --resume`

Starts or resumes the blocking Goal controller. Starting from a proposal
validates the proposal status, internal token, and expiry. If the proposal did
not specify a Project, Core creates one and binds the Goal to it.

**Single active Goal.** Galley runs at most one Goal (status `running` or
`wrapping`) at a time. Starting a second one fails with exit `2`
(`invalid_args`) and a message naming the active Goal; the constraint is
enforced in Core (a DB unique index), independent of any client check. Use
`galley goal active` to check before proposing. A `--resume` of an
already-running Goal is idempotent: the controller takes a per-goal file lock,
so a duplicate resume exits without double-dispatching. Goals left active after
a Core restart are auto-resumed on the next launch.

For desktop Goals with a master session, the controller first dispatches an
internal Goal Master planning turn to that master session. The Master acts as a
scheduler/editor, not a production worker: it must read
`galley goal status <goalId>`, then write executable work only through
`galley goal task ...` and `galley goal event ...`. It must not call GA native
`/hive`, start GA BBS, write external GA state, or write the Goal state outside
Galley Core. Managed GA may use its normal memory/SOP self-evolution mechanism
for durable, reusable learnings, but Goal protocol state must not become
memory/SOP: Goal ids, task ids, worker session ids, rounds/waves, temporary
coordination logs, and transient task-board state stay in Galley Core. Master
planning user/assistant/tool turns are persisted as `visibility: "internal"` for
audit and context, but ordinary session reads, GUI rendering, and search exclude
them by default.

`workerLimit` is a maximum concurrency limit, not "start this many sessions
immediately." Worker sessions are created lazily only when the Core task board
contains an open task assigned to that slot, with a scope such as
`goal-worker-2:master-round-1:fact-check`. The Master may create fewer tasks
than `workerLimit` when the work does not need full parallelism, but it must not
create more executable worker-slot tasks than the configured limit. If Master
planning fails, times out, or repeatedly creates no executable task, the
controller falls back to a conservative deterministic task round so the Goal does
not empty-spin.

The controller then wakes only the worker sessions that have concrete assigned
tasks, injects the Goal worker protocol, follows the Project with
`project follow --until-idle --final-show`, then evaluates the task board,
events, and worker output. Goal run time is a sustained work budget: while the
deadline has not passed, Galley asks the Master to create concrete follow-up
tasks when prior results reveal something to verify, refine, structure, or
challenge. Worker identity is Galley-bound: Core mints the child session id
before the first worker prompt is persisted and injects that exact id into the
prompt. Workers must use that id for `ownerSessionId` / `authorSessionId`; they
must not infer their identity from Project session titles, `goal status`, or
another worker's events.

Worker wake is task-board driven, not a generic continuation prompt. A worker
slot must complete/block/cancel an owned task or post a result event before the
controller can assign that same slot another concrete task. The slot must also
be idle; terminal task/result signals from a still-live worker are not enough to
wake it again. Other unfinished slots do not block a slot that already produced
its terminal signal. Claimed/running tasks, worker progress events, and worker
output count as in-progress material, so the controller keeps waiting inside
that slot instead of failing before the deadline. If a worker becomes idle
without any progress signal, the controller waits through a grace window, sends
one protocol reminder for that slot, then continues waiting without stacking
more prompts.

Once the deadline is reached, the controller stops creating new tasks and stops
waking workers. If the current worker wave is still live, the controller waits
for it to finish naturally up to a bounded drain window. Before master synthesis
starts, Galley shuts down worker runners so queued work cannot keep running
after the result is delivered. Worker sessions remain in the Project as audit
history. The Goal then enters `wrapping`, runs master synthesis when a desktop
master session exists, waits for a non-empty master `finalAnswer`, and only then
ends as `completed`, `stopped`, or `failed`. `latestSummary` is derived from that
final answer rather than the master's intermediate step summaries.

For desktop Goals, the master session is the user-visible control and delivery
location. The controller may persist short Galley-owned checkpoints there
(`agents started`, `initial progress`, `run time reached`) through an internal
socket write path that does not dispatch those checkpoint messages to the
master runner. Worker prompts, Goal ids, task ids, and protocol logs remain in
worker sessions and the Goal audit stream.

`goal run` emits NDJSON frames:

```json
{"schemaVersion":1,"stream":"goal","phase":"started","goal":{...}}
{"schemaVersion":1,"stream":"goal","phase":"worker_started","sessionId":"sess_...","goal":{...}}
{"schemaVersion":1,"stream":"goal","phase":"waiting","goal":{...}}
{"schemaVersion":1,"stream":"goal","phase":"continuing","goal":{...}}
{"schemaVersion":1,"stream":"goal","phase":"wrapping","goal":{...}}
{"schemaVersion":1,"stream":"goal","phase":"finished","goal":{...}}
```

Known `phase` values: `started`, `worker_started`, `waiting`, `continuing`,
`wrapping`, `failed`, `stopped`, `finished`.

#### `galley goal status <goal-id>`

Returns a snapshot containing the Goal, its Project if still present, current
task board, recent events, and non-archived Project sessions:

```json
{"goal":{...},"project":{...},"tasks":[...],"events":[...],"sessions":[...]}
```

#### `galley goal active`

Lists active (`running` / `wrapping`) goals as NDJSON — empty output when none.
Read-only. Since Galley runs at most one Goal at a time, a Supervisor uses this
to check before proposing a new one.

#### `galley goal stop <goal-id> [--supervisor=<x>] [--reason=<y>]`

Requests a graceful stop. Core sets `stopRequested=true` and moves a running
Goal into `wrapping`; the controller observes that flag after the current
Project wave and finalizes as `stopped`.

#### `galley goal task create|claim|update|complete ...`

Task-board commands are the worker coordination primitive. `claim` is atomic in
Core: it succeeds only when the task is still `open` and has no owner.

```bash
galley goal task create <goal-id> "Audit release docs" \
  --description="Check update-channel docs" \
  --owner-session=sess_a \
  --scope="docs/"

galley goal task claim <task-id> \
  --owner-session=sess_b \
  --scope="cli/tests/"

galley goal task update <task-id> --status=running
galley goal task complete <task-id> --result-summary="No blocker found."
```

Task statuses: `open`, `claimed`, `running`, `completed`, `blocked`,
`cancelled`.

#### `galley goal event post <goal-id> --event-type=<type> "<body>" [--task=<task-id>] [--author-session=<session-id>]`

Appends to the Goal audit stream. Event types: `plan`, `claim`, `progress`,
`result`, `conflict`, `synthesis`, `system`.

Goal task/event/deliverable commands use `ownerSessionId` /
`authorSessionId` as their worker authorship. They do not write the ordinary
`Origin` record used by human/Supervisor session and project commands.

#### `galley goal deliverable get <goal-id>` / `galley goal deliverable set <goal-id> "<content>" [--note=<text>] [--author-session=<session-id>]`

Goal deliverables are the append-only "current best result" anchor for a Goal.
The controller and Master use this anchor so a long Goal does not rely on
scrollback archaeology to find the latest synthesized result.

`get` prints the highest-version `GoalDeliverable` as JSON. If no anchor exists
yet, stdout is empty and the command exits 0.

`set` appends a new version and returns it:

```json
{"id":"gdel_...","goalId":"goal_...","version":3,
 "content":"...","note":"folded reviewer fixes",
 "authorSessionId":"sess_master","createdAt":"2026-06-16T...Z"}
```

Fields: `id`, `goalId`, `version`, `content`, `note?`,
`authorSessionId?`, `createdAt`. Core caps stored `content` at 256 KiB and
adds a truncation marker to `note` if the cap is hit.

Exit codes: `0` success / `2 invalid_args` (empty objective/title/body, token
mismatch, expired proposal, unclaimable task) / `3 not_found` / `4
db_unavailable` / `5 runner_error` (controller child-session dispatch failed).
