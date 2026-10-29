# Agent API — To-do Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.28–§5.34d: the `todo` family (the user's to-dos), with `todo item` (the items under a to-do) since 2026-10-29. Additive inside `schemaVersion: 3` since 2026-10-17 (main chat ticket 40; items, main chat ticket 111), and served under `1` and `2` too.

A **to-do** is something the user has to do: Galley's notebook, kept for the
user by the assistant (the managed runtime's main chat). It has a title,
optional notes, an optional due date, and optionally one reminder. The user
can only tick a to-do off, untick it, cancel its reminder, delete it (the
same soft delete as `cancel`, recorded as `{"via":"gui"}`), change its
title and notes (as `update --title` / `--notes` do; since main chat ticket
107), or add, tick, untick, change and delete the items under it (as
`todo item …` does; since main chat ticket 111) on the desktop; everything
else goes through Galley, which uses these commands.

- **Due date**: either a day with no time ("by Friday", stored as that local
  calendar day: it stays Friday wherever the computer goes) or a day with a
  time ("Wednesday 3 pm", stored as an instant). Readers group by day in the
  zone of the machine Galley runs on.
- **Reminder**: a [scheduled task](./schedule-commands.md) — a one-off that
  wakes the assistant — linked to the to-do (its `todoId`). Ticking the
  to-do off or cancelling it cancels a reminder that has not reminded the
  user yet; unticking does not bring it back. A reminder whose to-do is no
  longer open does not go off.
- **Items** (since 2026-10-29): a to-do may have items under it, one
  level, each only its words and a box — no due date, no reminder, no
  items of its own — in the order they were added (§5.34a–§5.34d).
  Ticking the last item does not tick the to-do off, and ticking the
  to-do off or on leaves its items as they are. Every write of an item
  changes its to-do's `updatedAt`. A cancelled to-do keeps its items
  (`show` reads them) and refuses every item write as `not_found`.
- **Where it lives**: to-dos belong to the assistant. Every write needs the
  managed runtime with its main chat; under an attached external GA the
  writes are refused (`assistant_unavailable:`) and the reads still answer.

`list` and `show` read SQLite directly (no Galley Core needed); every other
command goes through the socket (`todo.list`, `todo.show`, `todo.add`,
`todo.update`, `todo.done`, `todo.reopen`, `todo.cancel`, `todo.item_add`,
`todo.item_done`, `todo.item_reopen`, `todo.item_update`,
`todo.item_remove`; the socket also serves `list` and `show`). Every write
takes `--supervisor=<x>` / `--reason=<y>` (§6A `Origin`): `add` records
them as the to-do's `origin`, `done` as its `doneBy`, `cancel` as its
`cancelledBy`, `item done` as the item's `doneBy`, and a reminder that
`add` or `update` makes carries them as its task's `origin` (and `update
--no-remind` as its task's `cancelledBy`); the other item writes record
neither (who added an item is not kept). The assistant writes with
`--supervisor=galley-assistant`. There is no "run now" for a to-do.

### 5.28 · `Todo`

Every command prints this shape (`list` one per line, `show` alone, writes as
`{"todo": …}`; `list` leaves out `items` and keeps `itemCount`). camelCase,
optional fields omitted when empty.

| Field         | Type             | Notes |
| ------------- | ---------------- | ----- |
| `id`          | string           | `todo_<16-hex>` (Core mints it) |
| `title`       | string           | What the user has to do |
| `notes`       | string?          | |
| `due`         | object?          | `{date, hasTime, at?, time?}`. `date` is the local day `YYYY-MM-DD` (for a due time, the day it falls on in this machine's zone); `hasTime` says whether there is a time of day; then `at` is the instant (UTC ISO 8601) and `time` its local `HH:MM` |
| `reminder`    | object?          | `{taskId, at, state}`: the scheduled task (`sched_<16-hex>`, readable with `schedule show`), when it goes off (UTC ISO; the planned time once it went off), and `state` |
| `status`      | string enum      | `open` / `done` / `cancelled` |
| `doneAt`      | string?          | When it was ticked off, UTC ISO (a `done` to-do) |
| `doneBy`      | `Origin`?        | Who ticked it off: `{"via":"gui"}` is the user at the desktop, `{"via":"supervisor","supervisor":"galley-assistant",…}` is Galley |
| `origin`      | `Origin`         | Who noted it |
| `createdIn`   | object?          | `{sessionId, turnIndex?}`: the main chat run Galley noted it in, as for a scheduled task (§5.20). Recorded when `add` carries `--supervisor=galley-assistant` while a main chat run is open; `turnIndex` (the run's reply, where the desktop hangs its card) is filled when that run ends |
| `cancelledAt` | string?          | Set by `cancel`. A cancelled to-do is gone for every write |
| `cancelledBy` | `Origin`?        | Added 2026-10-19 (main chat ticket 61). Who cancelled it and why, as `doneBy` says who ticked it off: `cancel`'s `--supervisor` / `--reason` (`{"via":"supervisor","supervisor":"galley-assistant","reason":"…"}` is Galley at the user's request; `{"via":"cli"}` when no label was given). Absent while it is not cancelled, and on a to-do cancelled before 2026-10-19 (not known, not guessed) |
| `items`       | `Item[]`?    | Added 2026-10-29 (main chat ticket 111). The items under it, in the order they were added. On `show` and every write; not on `list`. Absent when it has none |
| `itemCount`   | object?          | Added 2026-10-29. `{done, total}`: how many items are ticked, how many there are. On every shape, `list` included; absent when it has none |
| `createdAt`   | string (ISO8601) | |
| `updatedAt`   | string (ISO8601) | |

`reminder.state`: `scheduled` (it will go off), `paused` (its task was
disabled with `schedule disable`), `fired` (it went off).

`Item` (one item under a to-do, since 2026-10-29):

| Field       | Type             | Notes |
| ----------- | ---------------- | ----- |
| `id`        | string           | `item_<16-hex>` (Core mints it): what `todo item done / reopen / update / remove` take |
| `text`      | string           | One line: Core trims it and makes each run of white space, a line break among them, one space |
| `done`      | boolean          | Ticked |
| `doneAt`    | string?          | When it was ticked, UTC ISO |
| `doneBy`    | `Origin`?        | Who ticked it, as `Todo.doneBy`: `{"via":"gui"}` is the user at the desktop |
| `createdAt` | string (ISO8601) | When it was added |

### 5.29 · `galley todo list [--all]`

**Read-only** — direct SQLite. NDJSON. By default the to-dos not done, in
the order the desktop's 「你的事」 lists them: due today or overdue (overdue
first, then by when they are due), then due later (soonest first), then the
ones with no due date (in the order they were noted). A day with no time is
due by its end. `--all` adds the done ones (most recently ticked off first)
and the cancelled ones (most recently cancelled first), after the open ones.
Each line carries a to-do's `itemCount`, not its `items`: `show` reads
them.

```bash
$ galley todo list
{"id":"todo_30f7e0c11b3607bd","title":"回房东电话","due":{"date":"2026-10-18","hasTime":true,"at":"2026-10-18T07:00:00+00:00","time":"15:00"},"status":"open","origin":{"via":"supervisor","supervisor":"galley-assistant"},"createdIn":{"sessionId":"s-main-…","turnIndex":12},"createdAt":"2026-10-17T00:41:27+00:00","updatedAt":"2026-10-17T00:41:27+00:00"}
{"id":"todo_79ce81a15a975727","title":"交季度报告","notes":"带合同","due":{"date":"2026-10-20","hasTime":false},"reminder":{"taskId":"sched_6aba6fababddd64e","at":"2026-10-19T01:00:00+00:00","state":"scheduled"},"status":"open","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},…}
{"id":"todo_8d045f1ba416457a","title":"买营养土","status":"open",…}
```

Exit codes: `0` / `4 db_unavailable`.

### 5.30 · `galley todo show <todo-id>`

**Read-only** — direct SQLite. One `Todo`, done or cancelled or not, with
its `items`.

```bash
$ galley todo show todo_5e6f7a8b9c0d1e2f
{"id":"todo_5e6f7a8b9c0d1e2f","title":"去上海出差","due":{"date":"2026-11-04","hasTime":false},"status":"open",…,"items":[{"id":"item_1a2b3c4d5e6f7a8b","text":"订酒店","done":true,"doneAt":"2026-10-29T08:12:40+00:00","doneBy":{"via":"gui"},"createdAt":"2026-10-29T07:30:02+00:00"},{"id":"item_2b3c4d5e6f7a8b9c","text":"订机票","done":false,"createdAt":"2026-10-29T07:30:02+00:00"},{"id":"item_3c4d5e6f7a8b9c0d","text":"换港币","done":false,"createdAt":"2026-10-29T07:30:02+00:00"}],"itemCount":{"done":1,"total":3},…}
```

Exit codes: `0` / `3 not_found` / `4 db_unavailable`.

### 5.31 · `galley todo add "<title>" [--notes=<text>] [--due=<date|time>] [--remind-at=<time>] [--item=<text>]… [--supervisor=<x>] [--reason=<y>]`

**Write command.** Prints `{"todo": Todo}`.

| Flag          | Notes |
| ------------- | ----- |
| `--notes`     | Free text |
| `--due`       | A local date `YYYY-MM-DD` is a day with no time. Anything `schedule create --at` takes is a day with a time: RFC 3339 with an offset (`2026-10-21T15:00:00+08:00`, `…Z`), or local `YYYY-MM-DDTHH:MM[:SS]` read in the time zone of the machine Galley runs on. A due date in the past is accepted (the user may note something already late) |
| `--remind-at` | Hang a reminder on it: a one-off at this time (`--at`'s forms) that wakes the assistant. A time already past is refused |
| `--item`      | Added 2026-10-29. An item under it (`Item.text`'s rule); repeat it for more, in order |

```bash
$ galley todo add "交季度报告" --due=2026-10-21T15:00 --remind-at=2026-10-21T14:00 --supervisor=galley-assistant --reason="user mentioned it"
{"todo":{"id":"todo_2b3c…","title":"交季度报告","due":{"date":"2026-10-21","hasTime":true,"at":"2026-10-21T07:00:00+00:00","time":"15:00"},"reminder":{"taskId":"sched_8c1e…","at":"2026-10-21T06:00:00+00:00","state":"scheduled"},"status":"open",…,"createdIn":{"sessionId":"s-main-…"}}}
$ galley todo add "买营养土" --supervisor=galley-assistant
{"todo":{"id":"todo_4d5e…","title":"买营养土","status":"open",…}}
```

Errors (`invalid_args`, exit `2`): an empty title; a `--due` in neither form;
a bad `--remind-at`; an `--item` with no words (nothing is written); and,
with a stable message prefix (§1.1):

- `time_in_past:` — `--remind-at` is already past. Nothing is written.
- `assistant_unavailable:` — the active runtime is the external one, or the
  managed runtime has no main chat yet.

Exit codes: `0` / `2 invalid_args` / `4 db_unavailable`.

### 5.32 · `galley todo update <todo-id> [--title=<text>] [--notes=<text>] [--due=<date|time> | --no-due] [--remind-at=<time> | --no-remind] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Only what is given changes (at least one of the change
flags); prints `{"todo": …}`.

- `--title`: a new title; the reminder's task takes it too.
- `--notes=` with an empty value clears the notes.
- `--due` (`add`'s forms) sets the due date; `--no-due` removes it.
- `--remind-at` sets the reminder, or moves it (the same task; one that went
  off is armed again); `time_in_past:` when past. Refused on a done to-do:
  `reopen` it first. `--no-remind` removes the reminder (its task is
  cancelled).
- `origin` is not changed: it says who noted the to-do.

On the socket (`todo.update`), an empty `notes`, `due` or `remindAt` clears
that field, as an empty value does on `schedule.update`; the CLI sends an
empty `due` for `--no-due` and an empty `remindAt` for `--no-remind`. An
update with nothing to change is `invalid_args`.

Exit codes: `0` / `2 invalid_args` (incl. `time_in_past:`,
`assistant_unavailable:`) / `3 not_found` (unknown or cancelled) /
`4 db_unavailable`.

### 5.33 · `galley todo done <todo-id>` / `galley todo reopen <todo-id>` `[--supervisor=<x>] [--reason=<y>]`

**Write commands.** Print `{"todo": …}`.

- `done` ticks the to-do off: `status` `done`, `doneAt`, and `doneBy` from
  `--supervisor` / `--reason`. Its reminder is cancelled while it has not
  reminded the user (not gone off yet, or gone off but not yet delivered to
  the assistant); one that already reached the assistant stays as it is.
  Ticking off a done to-do changes nothing (`doneBy` keeps the first tick).
- `reopen` unticks it: `status` `open`, `doneAt` and `doneBy` cleared. A
  reminder cancelled by `done` stays cancelled; `update --remind-at` sets a
  new one. Unticking an open to-do changes nothing.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` (unknown or cancelled) / `4 db_unavailable`.

### 5.34 · `galley todo cancel <todo-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Cancels the to-do (a soft delete) and its reminder as
`done` does: it leaves the default list and the desktop's lists; `show` and
`list --all` still read it, with `status` `cancelled`, `cancelledAt` and
`cancelledBy` (`--supervisor` / `--reason`; the reminder it takes along is
cancelled by Core, `{"via":"system"}` on its task). Prints `{"todo": …}`.
A cancelled to-do is `not_found` for every write, cancelling it again
included.

The main chat reads these records: the to-dos and reminders Galley made
that the user cancelled at the desktop, or that were cancelled with
`--supervisor=galley-assistant`, within the last 90 days, are listed with
their reason at the start of each of its segments.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` / `4 db_unavailable`.

### 5.34a · `galley todo item add <todo-id> "<text>"… [--supervisor=<x>] [--reason=<y>]`

**Write command.** Added 2026-10-29 (main chat ticket 111). Adds one item
per `<text>` under the to-do, after the ones there, in the order given (at
least one). Prints `{"todo": …}`: the to-do with its `items`, the new ones
with their ids.

```bash
$ galley todo item add todo_5e6f7a8b9c0d1e2f "订酒店" "订机票" "换港币" --supervisor=galley-assistant
{"todo":{"id":"todo_5e6f7a8b9c0d1e2f","title":"去上海出差",…,"items":[{"id":"item_1a2b3c4d5e6f7a8b","text":"订酒店","done":false,…},…],"itemCount":{"done":0,"total":3},…}}
```

Exit codes: `0` / `2 invalid_args` (no text, a text with no words,
`assistant_unavailable:`) / `3 not_found` (unknown or cancelled to-do) /
`4 db_unavailable`.

### 5.34b · `galley todo item done <item-id>` / `galley todo item reopen <item-id>` `[--supervisor=<x>] [--reason=<y>]`

**Write commands.** Added 2026-10-29. Print `{"todo": …}`.

- `item done` ticks the item: `done`, `doneAt`, and `doneBy` from
  `--supervisor` / `--reason`. Ticking a ticked item changes nothing
  (`doneBy` keeps the first tick). The to-do itself is not ticked off,
  the last item ticked or not: that is `todo done`.
- `item reopen` unticks it: `done` false, `doneAt` and `doneBy` cleared.
  Unticking an item not ticked changes nothing.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` (unknown item, or its to-do cancelled) / `4 db_unavailable`.

### 5.34c · `galley todo item update <item-id> --text=<text> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Added 2026-10-29. The item's new words; ticked or not,
it stays so. The same words (once trimmed) change nothing. Prints
`{"todo": …}`.

Exit codes: `0` / `2 invalid_args` (no `--text`, words that are only
white space, `assistant_unavailable:`) / `3 not_found` / `4 db_unavailable`.

### 5.34d · `galley todo item remove <item-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Added 2026-10-29. Deletes the item for good: no record
of it stays, and no list reads it again. Prints `{"todo": …}`.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` / `4 db_unavailable`.
