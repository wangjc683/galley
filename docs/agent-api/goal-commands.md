# Agent API — Goal Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.19: the `galley goal` surface (Goal v2, **schemaVersion 2 only**).

### 5.19 · `galley goal ...`

A **Goal** is one persistent objective on one session. Once set, Galley
Core re-prompts that session to keep working every time it goes idle,
until the model declares the objective complete (or blocked), the time
ceiling is reached, or the operator stops it. There are no workers, no
Project binding, no task board, no proposal / confirm-token handshake and
no synthesis turn: the goal's session is the whole engine, and the final
answer of the completing run is the deliverable.

This replaced the v1 hive / solo surface on 2026-09-16
(`.scratch/goal-simplify`, devlog entry pending). Everything below exists
only under `schemaVersion: 2`; a v1 caller sees the family as
`unknown_command` (see [stability §7](./stability-and-versioning.md)).
The v1 commands (`goal propose / run / task / event / deliverable`, the
internal `session.goal_*` and `session.new_goal_worker`) are gone under
every version.

#### How a goal runs

1. `goal start` persists the goal (`active`), writes the objective as an
   ordinary **visible user row** on the session (stamped with the goal
   id, so the GUI brackets the episode by exact id), and dispatches the
   opening turn — the objective wrapped in Galley's goal rules.
2. Every time the session's run settles with nothing else claiming the
   idle slot (no queued user message, no pending `ask_user`), Core judges
   the settled run in this order and acts:
   - the run was aborted (operator pressed stop on the session, or
     `session stop`) → `paused`;
   - the run ended in a fatal bridge / runtime error → `blocked`
     (`latestSummary` carries the error);
   - the final answer ended with `<goal-status>complete</goal-status>` →
     `completed`; with `<goal-status>blocked</goal-status>` → `blocked`;
   - the time ceiling is reached → one wrap-up continuation, then
     `budget_limited` when that settles;
   - otherwise → the next continuation (an `internal` user row, invisible
     in the thread, plus the visible agent turns it produces).
3. A **user message on the session** always wins over a continuation and
   is the way to steer a running goal. On a `paused` or `blocked` goal it
   is also the resume: the goal is `active` again from that run's first
   turn, and once the run settles the loop continues (a completion tag in
   that same run counts too).
4. `goal stop` is terminal `stopped` and aborts the session's in-flight
   run. No wrap-up.
   `goal extend` gives a goal more time: a `budget_limited` goal reopens
   as `active` and Core dispatches its next continuation immediately; an
   `active` goal just gets a higher ceiling.
5. A Core restart parks every `active` goal as `paused` — nothing is
   driving it any more; the operator's next message resumes it. A bridge
   process dying mid-goal does the same.

Status machine:

```
active ──(model tags complete)────────▶ completed
active ──(model tags blocked / run errors)─▶ blocked
active ──(ceiling reached, wrap-up settled)─▶ budget_limited
budget_limited ──(goal extend)─────────▶ active
active ──(goal stop)──────────────────▶ stopped
active ──(run aborted / Core restart)──▶ paused
paused / blocked ──(user-initiated run starts)───▶ active
paused / blocked ──(goal stop)──────────▶ stopped
any ──(dispatch failed)───────────────▶ failed
```

`active` / `paused` / `blocked` are **open** (a session holds at most one
open goal); `completed` / `budget_limited` / `stopped` / `failed` are
terminal. `blocked` is recoverable and deliberately not terminal: the model
is told to use it only after the same blocking condition has recurred for
three consecutive goal turns, and to say what it needs.

#### `galley goal start <session-id> "<objective>" [--budget-minutes=N | --no-budget] [--supervisor=<x>] [--reason=<y>]`

Sets the goal and dispatches the opening turn.

- `--budget-minutes=N` sets the time ceiling (any whole number of
  minutes ≥ 1; the desktop offers 15 / 30 / 60 / 120 / 240 / no ceiling
  plus a custom value); `--no-budget` removes it; neither →
  **60 minutes**. Both together → exit `2` (`invalid_args`).
  The ceiling is an upper bound, not a target: a goal that finishes early
  ends early. When it is reached the model gets one wrap-up turn and the
  goal lands in `budget_limited` (a distinct terminal status, not a
  failure) — from which `goal extend` can reopen it.
- The session must be idle. A session that is mid-run → exit `2`
  (`invalid_args`) with no side effects — wait with
  `galley session wait <id>` and start again. (The desktop Composer
  disables the Goal entry while a run is open, so only CLI callers see
  this.)
- The session must have no open goal. A second `goal start` on a session
  with an `active` / `paused` / `blocked` goal → exit `2` naming the open
  goal's id. Different sessions may each carry their own goal; there is
  no global single-goal lock any more.
- Session missing → `3` (`not_found`); archived → `2`.
- If the opening turn cannot reach a runner (spawn or dispatch failure)
  the command exits `5` (`runner_error`) and the goal row is recorded
  `failed` with the reason in `latestSummary` — never a half-started goal.

```bash
$ galley goal start s-k7x2-9f "Rename the three markdown titles under docs/ to sentence case and verify each" \
  --budget-minutes=30 --supervisor=ga-wechat-bot --reason="user asked for a goal"
{"goal":{"id":"goal_5c1e…","sessionId":"s-k7x2-9f","objective":"Rename the three …",
 "status":"active","budgetSeconds":1800,"startedAt":"2026-09-16T08:00:00+00:00",
 "continuationCount":0,"wrapUpDispatched":false,"elapsedSeconds":0,
 "createdAt":"…","updatedAt":"…","origin":{"via":"supervisor","supervisor":"ga-wechat-bot","reason":"user asked for a goal"}},
 "message":{"id":"msg_…","sessionId":"s-k7x2-9f","role":"user","content":"Rename the three …",
 "turnIndex":4,"visibility":"visible","goalId":"goal_5c1e…",…},
 "dispatch":"dispatched"}
```

`dispatch` is always `dispatched` on the success envelope; failures are
error envelopes.

#### `galley goal status <goal-id>`

```json
{"goal":{...}}
```

`3` (`not_found`) for an unknown id. See `GoalBrief` below.

#### `galley goal active`

Lists **open** goals (`active` / `paused` / `blocked`) as a JSON array,
oldest first — `[]` when none. Read-only. Terminal goals are not listed;
use `goal status` for those.

#### `galley goal stop <goal-id> [--supervisor=<x>] [--reason=<y>]`

Terminal `stopped`, then `Abort` to the session's in-flight run (best
effort — a dead runner means nothing is running anyway). Idempotent on an
already-terminal goal (returns it unchanged). There is no wrap-up turn:
the thread keeps whatever the last settled run produced.

```json
{"goal":{...,"status":"stopped","endedAt":"…"}}
```

#### `galley goal extend <goal-id> [--minutes=30] [--supervisor=<x>] [--reason=<y>]`

Gives the goal `--minutes` (default 30) more. On a `budget_limited` goal
this reopens it — status back to `active`, `endedAt` / `resultSeenAt`
cleared, the wrap-up flag reset so the new ceiling gets its own wrap-up —
and Core dispatches the next continuation right away (the session is
idle after the wrap-up). The extra counts **from now** once the old
ceiling has passed (new ceiling = elapsed + extra), so a goal that sat
budget-limited for an hour really gets 30 more minutes of work. On an
`active` goal below its ceiling it simply adds to the ceiling.
Refused with `2` (`invalid_args`) for a goal with no ceiling, for any
other status, and when the session meanwhile got a newer open goal.

```json
{"goal":{...,"status":"active","budgetSeconds":5400,"wrapUpDispatched":false}}
```

#### Waiting for a goal

There is no `goal wait`. `galley session wait <session-id>` and
`galley session follow <session-id>` observe the goal's session like any
other; poll `goal status` for the status transition. Between
continuations the session is idle for well under a second, so a
`session wait` that returns `completed` is usually one continuation
boundary, not the goal's end — check `goal.status` before concluding.

#### `GoalBrief` (schemaVersion 2)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `goal_<hex>` |
| `sessionId` | string | The session the goal drives |
| `objective` | string | Trimmed operator text |
| `status` | enum | `active` / `paused` / `blocked` / `completed` / `budget_limited` / `stopped` / `failed` |
| `budgetSeconds?` | u32 | Time ceiling; absent = no ceiling |
| `startedAt` | ISO 8601 | |
| `endedAt?` | ISO 8601 | Stamped once on the first terminal transition |
| `pausedAt?` | ISO 8601 | Set while `paused` / `blocked`; cleared on resume |
| `latestSummary?` | string | Final-turn summary on `completed` / `blocked` / `budget_limited`; the error on a run-error `blocked`; the dispatch reason on `failed` |
| `resultSeenAt?` | ISO 8601 | Set by the GUI when the operator viewed a terminal result |
| `continuationCount` | u32 | Continuations dispatched so far (wrap-up included) |
| `wrapUpDispatched` | bool | The ceiling wrap-up turn went out; the next settle lands `budget_limited` |
| `elapsedSeconds` | u64 | `startedAt` → `endedAt` (terminal) or → now (open). Computed on read; paused time is not subtracted |
| `createdAt` / `updatedAt` | ISO 8601 | |
| `origin?` | `Origin` | Who set the goal ([§6A](./errors-and-exit-codes.md)); absent for GUI-set goals, like `SessionBrief.origin` |

`MessageBrief` gained the additive field `goalId?` at the same time: the
objective row (and the `user-message-persisted` GUI event that announces
it) carries the goal it opened.

#### The completion tag

The goal rules Core dispatches ask the model to end its final answer with
exactly one of `<goal-status>complete</goal-status>` /
`<goal-status>blocked</goal-status>` once its completion audit (or blocked
audit) passes, and with no tag otherwise. The runner extracts the tag into
the `turn_end` event and strips it from display, so it is never visible
in a thread or an IM reply. Core, not the model, owns every other
transition (`paused`, `stopped`, `budget_limited`, `failed`).

#### Socket commands

| Command | Args | Result |
|---|---|---|
| `goal.start` | `{sessionId, objective, budgetSeconds?, supervisor?, reason?}` — `budgetSeconds` absent = no ceiling (the CLI resolves its 60-minute default before sending) | `{goal, message, dispatch}` |
| `goal.status` | `{goalId}` | `{goal}` |
| `goal.active` | `{}` | `[goal, …]` |
| `goal.stop` | `{goalId, supervisor?, reason?}` | `{goal}` |
| `goal.extend` | `{goalId, extraSeconds, supervisor?, reason?}` | `{goal}` |

All five require `"schemaVersion": 2` on the request. The GUI additionally
receives a `goal-updated` Tauri event (`{goal}`) on every transition; the
socket has no goal event stream — poll `goal.status`.

Exit codes: `0` success / `2 invalid_args` (blank objective, session busy
or archived, open goal already on the session, contradictory budget
flags, extending a goal with no ceiling or in a status other than
`active` / `budget_limited`) / `3 not_found` / `4 db_unavailable` / `5 runner_error` (opening
turn could not be dispatched; goal recorded `failed`).
