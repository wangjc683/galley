# Agent API — Schedule Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.20–§5.27: the `schedule` family (scheduled tasks). Additive inside `schemaVersion: 3` since 2026-10-16 (main chat ticket 34), and served under `1` and `2` too.

A **scheduled task** fires at a time — once (`--at`) or on a repeating rule
(`--daily` / `--weekly` / `--monthly` with `--time`) — and does one of two
things (`target`):

- `session` (the default): starts a new ordinary session whose first message
  is the prompt, exactly like `session new` with supervisor
  `galley-scheduler`. When the managed runtime has its main chat, each run of
  that session that ends is also reported to the assistant (the main chat).
- `assistant`: starts no session. It wakes the managed runtime's main chat
  for one turn with the prompt (the words the assistant noted), when it was
  planned for, when it went off, and how late. Only while the active runtime
  is the managed one and has a main chat; an attached external GA has none.

Times: a repeating rule is local wall clock (`HH:MM` follows the user across
time zones). A one-off fires at an absolute instant. A missed repeating fire
is caught up once on the same local day and dropped after midnight; a missed
one-off fires when Galley next runs, however late. Nothing fires while Galley
is not running.

`list` and `show` read SQLite directly (no Galley Core needed); every other
command goes through the socket (`schedule.list`, `schedule.show`,
`schedule.create`, `schedule.update`, `schedule.delete`, `schedule.enable`,
`schedule.disable`, `schedule.run`; the socket also serves `list` and `show`).
Every write takes `--supervisor=<x>` / `--reason=<y>` and records them as the
task's `origin` when it creates it (§6A `Origin`). The assistant writes with
`--supervisor=galley-assistant`.

### 5.20 · `ScheduledTask`

Every command prints this shape (`list` one per line, `show` alone, writes as
`{"task": …}`). camelCase, optional fields omitted when empty.

| Field             | Type             | Notes |
| ----------------- | ---------------- | ----- |
| `id`              | string           | `sched_<16-hex>` (Core mints it) |
| `prompt`          | string           | The words for the assistant (`target` `assistant`), or the new session's first message (`session`) |
| `repeat`          | object           | `{"kind":"once"}`, `{"kind":"daily"}`, `{"kind":"weekly","weekdays":[1,5]}` (ISO, Mon=1), `{"kind":"monthly","monthdays":[1,15]}` (short months fire on their last day) |
| `timeOfDay`       | string           | `HH:MM` local. For a one-off, the local time of `fireAt` (informational) |
| `fireAt`          | string?          | A one-off's instant, UTC ISO 8601 |
| `target`          | string enum      | `session` / `assistant` |
| `projectId`       | string?          | Project of the sessions it starts (`session` only) |
| `llmName`         | string?          | Model display name for the sessions it starts (`session` only); unresolvable falls back to the default |
| `enabled`         | bool             | |
| `nextFireAt`      | string?          | Next fire, UTC ISO. Absent when disabled, cancelled, or a one-off that fired |
| `lastFiredAt`     | string?          | When it last went off, UTC ISO (a manual `run` counts) |
| `lastDueAt`       | string?          | The planned instant of that fire (`assistant` tasks); differs from `lastFiredAt` when the computer slept |
| `lastRunSessionId`| string?          | The session the last fire started (`session` tasks). Fired without one = that fire failed |
| `lastWake`        | string enum?     | An `assistant` task's last fire: `pending` (not yet delivered; survives a restart), `delivered`, `notified` (it could not reach the assistant — the main chat was waiting for an answer, its runner did not start, or the turn ended on an error — so the desktop showed a system notification with the prompt; not retried) |
| `origin`          | `Origin`         | Who made it: `{"via":"gui"}` for the desktop form, `{"via":"supervisor","supervisor":"galley-assistant",…}` for the assistant |
| `createdIn`       | object?          | `{sessionId, turnIndex?}`: the main chat run the assistant made it in. Recorded when the write carries `--supervisor=galley-assistant` while a main chat run is open; `turnIndex` (the run's reply) is filled when that run ends |
| `cancelledAt`     | string?          | Set by `delete`. A cancelled task never fires and is gone for every write |
| `todoId`          | string?          | Added 2026-10-17 (main chat ticket 39). The to-do this task is the reminder of (`todo_<16-hex>`); absent for the assistant's own tasks. Core keeps it in step with its to-do: ticking the to-do off or cancelling it cancels the task while it has not reached the assistant, and a task whose to-do is no longer open does not go off |
| `createdAt`       | string (ISO8601) | |
| `updatedAt`       | string (ISO8601) | |

### 5.21 · `galley schedule list [--all]`

**Read-only** — direct SQLite. NDJSON, enabled first, then most recently
updated. By default only the tasks that may still fire: enabled, not
cancelled, not a one-off that already fired. `--all` adds fired one-offs,
disabled and cancelled tasks.

```bash
$ galley schedule list
{"id":"sched_3f9a0c1d2e4b5a69","prompt":"提醒用户带身份证","repeat":{"kind":"once"},"timeOfDay":"20:00","fireAt":"2026-10-20T12:00:00+00:00","target":"assistant","enabled":true,"nextFireAt":"2026-10-20T12:00:00+00:00","origin":{"via":"supervisor","supervisor":"galley-assistant"},…}
```

Exit codes: `0` / `4 db_unavailable`.

### 5.22 · `galley schedule show <task-id>`

**Read-only** — direct SQLite. One `ScheduledTask`, cancelled or not.

Exit codes: `0` / `3 not_found` / `4 db_unavailable`.

### 5.23 · `galley schedule create "<prompt>" (--at=<time> | --daily | --weekly=<days> | --monthly=<days>) [--time=HH:MM] [--target=session|assistant] [--project=<id>] [--llm=<name>] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Prints `{"task": ScheduledTask}`.

| Flag          | Default   | Notes |
| ------------- | --------- | ----- |
| `--at`        | —         | A one-off. RFC 3339 with an offset (`2026-10-20T20:00:00+08:00`, `…Z`), or local `YYYY-MM-DDTHH:MM[:SS]` (a space works for the `T`), read in the time zone of the machine Galley runs on. A local time in a daylight-saving gap moves to the first minute after it. A time already past is refused |
| `--daily`     | —         | Every day at `--time` |
| `--weekly`    | —         | Comma-separated ISO weekdays, Mon=1 … Sun=7 |
| `--monthly`   | —         | Comma-separated month days 1–31 |
| `--time`      | —         | `HH:MM`, required with a repeating rule, refused with `--at` |
| `--target`    | `session` | `assistant` needs the managed runtime with its main chat |
| `--project`   | (none)    | `session` only |
| `--llm`       | (none)    | `session` only |

Exactly one of `--at`, `--daily`, `--weekly`, `--monthly`. The default target
is `session` because it works under both runtimes and is what the desktop
form makes; the assistant passes `--target=assistant` explicitly (its manual
says so). A session task made by mistake still reaches the assistant, through
the run report of the session it starts.

```bash
$ galley schedule create "提醒用户喝水" --at=2026-10-16T21:10 --target=assistant --supervisor=galley-assistant --reason="user asked"
{"task":{"id":"sched_8c1e…","prompt":"提醒用户喝水","repeat":{"kind":"once"},…,"target":"assistant","createdIn":{"sessionId":"s-main-…"}}}
$ galley schedule create "整理下载文件夹" --weekly=5 --time=17:00 --supervisor=ga-claude-1
{"task":{"id":"sched_41d0…","repeat":{"kind":"weekly","weekdays":[5]},"timeOfDay":"17:00","target":"session",…}}
```

Errors (`invalid_args`, exit `2`): neither or more than one of the timing
flags; a repeating rule without `--time`; a bad `--time`, day or `--at`; an
empty prompt; `--project` / `--llm` with `--target=assistant`; and, with a
stable message prefix (§1.1):

- `time_in_past:` — `--at` is already past.
- `assistant_unavailable:` — `--target=assistant` while the active runtime is
  the external one, or the managed runtime has no main chat yet.

Exit codes: `0` / `2 invalid_args` / `4 db_unavailable`.

### 5.24 · `galley schedule update <task-id> [--prompt=<text>] [--at=<time> | --daily | --weekly=<days> | --monthly=<days>] [--time=HH:MM] [--target=…] [--project=<id>] [--llm=<name>] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Only the fields given change; prints `{"task": …}`.

- `--at` makes the task a one-off at that time (refused when past,
  `time_in_past:`); a later time arms a one-off that already fired.
- `--daily` / `--weekly` / `--monthly` make it repeating; switching from a
  one-off needs `--time` too.
- `--project=` / `--llm=` with an empty value clear them.
- `--target=assistant` is refused as on create (`assistant_unavailable:`, or
  while the task still has a project or a model).
- `origin` is not changed: it says who made the task.

Exit codes: `0` / `2 invalid_args` / `3 not_found` (unknown or cancelled) /
`4 db_unavailable`.

### 5.25 · `galley schedule delete <task-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Cancels the task: it never fires again and leaves the
default list; `show` and `list --all` still read it, with `cancelledAt`
(the desktop shows it as cancelled). Prints `{"task": …}`. Deleting a
cancelled task is `not_found`.

Exit codes: `0` / `3 not_found` / `4 db_unavailable`.

### 5.26 · `galley schedule enable <task-id>` / `galley schedule disable <task-id>` `[--supervisor=<x>] [--reason=<y>]`

**Write commands.** Turn a task on or off; print `{"task": …}`. Re-enabling
does not move a repeating task's baseline: a period it missed today still
fires; a one-off whose time passed while it was off fires at once.

Exit codes: `0` / `3 not_found` (unknown or cancelled) / `4 db_unavailable`.

### 5.27 · `galley schedule run <task-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Fires the task once, now, through the scheduled path (the
desktop's "run now"): a `session` task starts its session (a failure to
start is recorded as a failed fire, as the scheduler records it); an
`assistant` task wakes the main chat as if it came due now. Planned fires are
not consumed: a one-off due later still fires at its time. Works on a
disabled task. Prints `{"task": …}` after the fire.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) / `3 not_found`
(unknown or cancelled) / `4 db_unavailable`.
