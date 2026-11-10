# Agent API — To-do Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.28–§5.34f: the `todo` family (the user's to-dos), with `todo item` (the items under a to-do) since 2026-10-29 and repeating to-dos (`todo skip`, the rule flags) since 2026-11-10. Additive inside `schemaVersion: 3` since 2026-10-17 (main chat ticket 40; items, main chat ticket 111; `item move`, main chat ticket 112; repeating, main chat ticket 154), and served under `1` and `2` too.

A **to-do** is something the user has to do: Galley's notebook, kept for the
user by the assistant (the managed runtime's main chat). It has a title,
optional notes, an optional due date, and optionally one reminder. The user
can only tick a to-do off, untick it, cancel its reminder, delete it (the
same soft delete as `cancel`, recorded as `{"via":"gui"}`), change its
title and notes (as `update --title` / `--notes` do; since main chat ticket
107), add, tick, untick, change, delete and drag into order the items
under it (as `todo item …` does; since main chat tickets 111 and 112),
skip a period of a repeating one and stop it repeating (as `todo skip` and
`update --no-repeat` do; the desktop's commands since main chat ticket
154, on the to-do panel's row menu since ticket 157), or change its due
date, its reminder and its rule (since main chat ticket 156: the
desktop's own write, which `update --due` / `--no-due`, `--remind-at` /
`--no-remind` and a rule flag mirror, except that on the desktop the
reminder moves with the due day — the same days before it, the same
local time; a repeating period's reminder Core re-armed past its due day
by the rule's offset instead (ticket 157) —, a moved reminder whose time
has passed falls back toward the new due day, the same time one day
nearer at a time down to the due day itself, and is hung at the first
still ahead (ticket 157), a reminder time still passed (or one picked
explicitly that has passed) is not hung, and a repeating period's goes
to the first reminder time still ahead among its rule's later days
instead; `update --due` here moves no reminder) on the desktop;
everything else goes through Galley, which uses these commands.

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
  items of its own — in the order they were added, unless one was moved
  since (§5.34a–§5.34e).
  Ticking the last item does not tick the to-do off, and ticking the
  to-do off or on leaves its items as they are. Every write of an item
  changes its to-do's `updatedAt`. A cancelled to-do keeps its items
  (`show` reads them) and refuses every item write as `not_found`.
- **Repeating** (added 2026-11-10, main chat ticket 154): a to-do may
  repeat. The rule is kept on its own (`repeat` on the to-do, its id
  `seriesId`), and at any time there is at most one period of it not
  settled — an ordinary to-do, with its box, items, notes, reminder and
  card as any other. Ticking that period off (`done`) or skipping it
  (`skip`) makes the next one at once, in the same write, and prints it
  as `next`: no timer, and no model call, so a computer off for days finds
  the period still there, overdue. The next period is due on the rule's
  first day after the later of today (this machine's zone) and the due
  days of the rule's periods so far: a Monday report ticked off a week
  late gets next Monday, not today; ticked off early, the Monday after its
  own. It carries the rule's title, notes and items (all unticked), its
  due time when the periods have one, and a reminder at the rule's offset
  from its due day (none when that time has already passed); it is
  recorded as made by Core, `{"via":"system","supervisor":"galley-repeat"}`
  on the to-do and on its reminder's task, in no turn (no `createdIn`).
  Rules: `daily` every N days from the day the rule counts from;
  `weekly` on a set of ISO weekdays every N weeks (the ISO weeks N apart
  from that day's); `monthly` on a set of days of the month every N months
  (a month without one of the days takes its last day, as a scheduled
  task's monthly rule does; a quarter is every 3 months); `yearly` on that
  day's month and day every N years (Feb 29 is Feb 28 in a common year).
  The day the rule counts from is the first period's due date, and the
  period's due date whenever the rule is changed. Changing a period
  (`update`) changes that period alone; `update --series` takes it into
  the rule. Deleting a period (`cancel`) ends the rule with it;
  `update --no-repeat` ends the rule and leaves the period as an ordinary
  to-do. A repeating to-do needs a due date (`repeat_needs_due:`). A
  period left unsettled is reminded again: once its reminder has gone off
  and reached Galley (or, undelivered, a system notification), Galley
  Core arms that same reminder (same `taskId`) for the first reminder time
  still ahead among the rule's days after the period's own due day. A
  period of a rule with a reminder that has none at all (made after its
  reminder time had passed) gets one the same way, its own reminder time
  first while it is still ahead. The period keeps its due date (overdue)
  and no to-do is made; a reminder removed (`--no-remind`, the desktop's
  「取消提醒」, or let go by a tick before an untick) or paused is not armed
  again, and a settled period's is let go as before.
- **Where it lives**: to-dos belong to the assistant. Every write needs the
  managed runtime with its main chat; under an attached external GA the
  writes are refused (`assistant_unavailable:`) and the reads still answer.

`list` and `show` read SQLite directly (no Galley Core needed); every other
command goes through the socket (`todo.list`, `todo.show`, `todo.add`,
`todo.update`, `todo.done`, `todo.reopen`, `todo.cancel`, `todo.skip`,
`todo.item_add`,
`todo.item_done`, `todo.item_reopen`, `todo.item_update`,
`todo.item_move`, `todo.item_remove`; the socket also serves `list` and
`show`). Every write
takes `--supervisor=<x>` / `--reason=<y>` (§6A `Origin`): `add` records
them as the to-do's `origin`, `done` as its `doneBy`, `cancel` and `skip`
as its `cancelledBy`, `item done` as the item's `doneBy`, and a reminder that
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
| `items`       | `Item[]`?    | Added 2026-10-29 (main chat ticket 111). The items under it, in their order: the order they were added, unless one was moved since (§5.34e). On `show` and every write; not on `list`. Absent when it has none |
| `itemCount`   | object?          | Added 2026-10-29. `{done, total}`: how many items are ticked, how many there are. On every shape, `list` included; absent when it has none |
| `repeat`      | `Repeat`?        | Added 2026-11-10 (main chat ticket 154). The rule this to-do is a period of, while the rule has not ended: on every period of it, done and skipped ones included. Absent on a to-do that does not repeat, and once its rule ended (`update --no-repeat`, a period deleted) |
| `seriesId`    | string?          | Added 2026-11-10 (main chat ticket 154). `series_<16-hex>`: the rule this to-do is or was a period of. It stays when the rule ends |
| `skipped`     | boolean?         | Added 2026-11-10 (main chat ticket 154). `true` on a period skipped (`todo skip`): its `status` is `cancelled`, `cancelledBy` says who skipped it. Absent otherwise |
| `createdAt`   | string (ISO8601) | |
| `updatedAt`   | string (ISO8601) | |

`reminder.state`: `scheduled` (it will go off), `paused` (its task was
disabled with `schedule disable`), `fired` (it went off).

`Repeat` (a repeating to-do's rule, since 2026-11-10, main chat ticket
154), e.g. `{"kind":"weekly","weekdays":[1],"every":2,"remind":{"daysBefore":1,"time":"20:00"}}`:

| Field       | Type      | Notes |
| ----------- | --------- | ----- |
| `kind`      | string enum | `daily` / `weekly` / `monthly` / `yearly` |
| `weekdays`  | number[]? | `weekly` only: ISO weekdays, 1 is Monday … 7 Sunday, ascending |
| `monthdays` | number[]? | `monthly` only: days of the month 1–31, ascending |
| `every`     | number?   | Every N days, weeks, months or years, 1–365. Absent when 1 |
| `remind`    | object?   | `{daysBefore, time}`: each period's reminder goes off `daysBefore` days before its due day (0 the same day) at local `time` `HH:MM`. Absent when the periods get none |

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

### 5.31 · `galley todo add "<title>" [--notes=<text>] [--due=<date|time>] [--remind-at=<time>] [--item=<text>]… [--daily | --weekly=<days> | --monthly=<days> | --yearly [--every=<n>]] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Prints `{"todo": Todo}`.

| Flag          | Notes |
| ------------- | ----- |
| `--notes`     | Free text |
| `--due`       | A local date `YYYY-MM-DD` is a day with no time. Anything `schedule create --at` takes is a day with a time: RFC 3339 with an offset (`2026-10-21T15:00:00+08:00`, `…Z`), or local `YYYY-MM-DDTHH:MM[:SS]` read in the time zone of the machine Galley runs on. A due date in the past is accepted (the user may note something already late) |
| `--remind-at` | Hang a reminder on it: a one-off at this time (`--at`'s forms) that wakes the assistant. A time already past is refused |
| `--item`      | Added 2026-10-29. An item under it (`Item.text`'s rule); repeat it for more, in order |
| `--daily` / `--weekly=<days>` / `--monthly=<days>` / `--yearly` | Added 2026-11-10 (main chat ticket 154). It repeats: one of the four (socket `repeat`, `Repeat`'s shape without `remind`). `--weekly` takes ISO weekdays (1 = Monday … 7 = Sunday), `--monthly` days of the month (1–31; a short month takes its last day), comma-separated, as `schedule create`'s do; `--yearly` repeats on the due date's month and day. Needs `--due`: this to-do is the rule's first period, due on that day whether or not the rule falls on it, and the rule counts from it. The rule carries the title, notes and items as given, the due time (a `--due` with a time makes every period due at that local time), and the reminder as days before the due day and a local time (from `--remind-at`) |
| `--every`     | Added 2026-11-10. Every N of them, 1–365 (default 1), with one of the four: `--monthly=15 --every=3` is quarterly on the 15th |

```bash
$ galley todo add "交季度报告" --due=2026-10-21T15:00 --remind-at=2026-10-21T14:00 --supervisor=galley-assistant --reason="user mentioned it"
{"todo":{"id":"todo_2b3c…","title":"交季度报告","due":{"date":"2026-10-21","hasTime":true,"at":"2026-10-21T07:00:00+00:00","time":"15:00"},"reminder":{"taskId":"sched_8c1e…","at":"2026-10-21T06:00:00+00:00","state":"scheduled"},"status":"open",…,"createdIn":{"sessionId":"s-main-…"}}}
$ galley todo add "买营养土" --supervisor=galley-assistant
{"todo":{"id":"todo_4d5e…","title":"买营养土","status":"open",…}}
$ galley todo add "交周报" --due=2026-11-16T09:00 --remind-at=2026-11-15T20:00 --weekly=1 --supervisor=galley-assistant
{"todo":{"id":"todo_3ca0…","title":"交周报","due":{"date":"2026-11-16","hasTime":true,"at":"2026-11-16T01:00:00+00:00","time":"09:00"},"reminder":{…},"status":"open",…,"repeat":{"kind":"weekly","weekdays":[1],"remind":{"daysBefore":1,"time":"20:00"}},"seriesId":"series_8d91…",…}}
```

Errors (`invalid_args`, exit `2`): an empty title; a `--due` in neither form;
a bad `--remind-at`; an `--item` with no words; two of the rule flags, or
`--every` without one (clap's); a weekday or day of the month out of range,
none given, or an `--every` outside 1–365 (nothing is written); and, with a
stable message prefix (§1.1):

- `time_in_past:` — `--remind-at` is already past. Nothing is written.
- `repeat_needs_due:` — added 2026-11-10. A rule flag without `--due`.
  Nothing is written.
- `assistant_unavailable:` — the active runtime is the external one, or the
  managed runtime has no main chat yet.

Exit codes: `0` / `2 invalid_args` / `4 db_unavailable`.

### 5.32 · `galley todo update <todo-id> [--title=<text>] [--notes=<text>] [--due=<date|time> | --no-due] [--remind-at=<time> | --no-remind] [--daily | --weekly=<days> | --monthly=<days> | --yearly [--every=<n>] | --no-repeat] [--series] [--supervisor=<x>] [--reason=<y>]`

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

Repeating to-dos (added 2026-11-10, main chat ticket 154):

- On a period of a rule, every change above is that period's alone: the
  rule, and so the periods after it, stay as they were.
- `--series` then takes the period, as this command left it, into its
  rule: its title, its items' words (the next period gets them
  unticked), its reminder's offset from its due day (no reminder clears
  the rule's), and its due time. Its notes go into the rule only when this
  same command gives `--notes` (a period's notes gather that period's
  progress), and the rule counts from its due day only when this same
  command gives `--due`. Refused on a done period (ticking it off let its
  reminder go): take the open period into the rule.
- A rule flag (`add`'s) on a to-do that does not repeat makes it the first
  period of a rule, as `add` would have (it needs a due date, `--due` in
  the same command or one it has); refused on a done one, `reopen` it
  first. On a period of a rule it changes the rule's kind, days and
  `every`, counted from this period's due date from now on; the rest of
  what the rule carries stays.
- `--no-repeat` ends the rule: this period stays as it is, an ordinary
  to-do (`seriesId` stays, `repeat` goes), and no period is made again.
  Not with a rule flag or `--series`.
- A period of a rule keeps its due date: `--no-due` on one is
  `repeat_needs_due:`, unless `--no-repeat` comes with it.

On the socket (`todo.update`), an empty `notes`, `due` or `remindAt` clears
that field, as an empty value does on `schedule.update`; the CLI sends an
empty `due` for `--no-due` and an empty `remindAt` for `--no-remind`. Since
2026-11-10 `repeat` (`Repeat`'s shape without `remind`), `noRepeat: true`
and `series: true` are the rule flags, `--no-repeat` and `--series`. An
update with nothing to change is `invalid_args`.

Exit codes: `0` / `2 invalid_args` (incl. `time_in_past:`,
`assistant_unavailable:`; since 2026-11-10 `repeat_needs_due:`, and
`not_repeating:` for `--series` or `--no-repeat` on a to-do that does not
repeat or whose rule ended) / `3 not_found` (unknown or cancelled) /
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

Repeating to-dos (added 2026-11-10, main chat ticket 154): `done` on a
period of a rule that has not ended makes the next period in the same
write, unless another period of the rule is still open, and prints it
beside the to-do: `{"todo": …, "next": …}` (`next` absent when none was
made; a to-do that does not repeat prints as before). A failure leaves
neither the tick nor the next period. Ticking off a done period makes
nothing. `reopen` opens that period alone: the next one made by its tick
stays, so two periods may be open; ticking one of them off makes nothing,
ticking off the last makes the next, after the latest due day of them.

```bash
$ galley todo done todo_3ca07a06efa7e8f8 --supervisor=galley-assistant
{"todo":{"id":"todo_3ca07a06efa7e8f8","title":"交周报",…,"status":"done",…},"next":{"id":"todo_8b927e12a3c5cc82","title":"交周报","due":{"date":"2026-11-23","hasTime":true,"at":"2026-11-23T01:00:00+00:00","time":"09:00"},"reminder":{"taskId":"sched_9b4b…","at":"2026-11-22T12:00:00+00:00","state":"scheduled"},"status":"open","origin":{"via":"system","supervisor":"galley-repeat"},…,"repeat":{"kind":"weekly","weekdays":[1],"remind":{"daysBefore":1,"time":"20:00"}},"seriesId":"series_8d913fab4d34741f",…}}
```

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` (unknown or cancelled) / `4 db_unavailable`.

### 5.34 · `galley todo cancel <todo-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Cancels the to-do (a soft delete) and its reminder as
`done` does: it leaves the default list and the desktop's lists; `show` and
`list --all` still read it, with `status` `cancelled`, `cancelledAt` and
`cancelledBy` (`--supervisor` / `--reason`; the reminder it takes along is
cancelled by Core, `{"via":"system"}` on its task). Prints `{"todo": …}`.
A cancelled to-do is `not_found` for every write, cancelling it again
included. Since 2026-11-10 (main chat ticket 154), cancelling a period of a
rule ends the rule with it, recorded with the same `--supervisor` /
`--reason`: no next period is made, and every period of it loses
`repeat`. To leave out this period alone, `skip` it (§5.34f).

The main chat reads these records: the to-dos and reminders Galley made
that the user cancelled at the desktop, or that were cancelled with
`--supervisor=galley-assistant`, within the last 90 days, are listed with
their reason at the start of each of its segments; since 2026-11-10 also
the periods Core made from a rule (`galley-repeat`), and their
reminders, but not a period skipped.

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

### 5.34e · `galley todo item move <item-id> --to=<n> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Added 2026-10-29 (main chat ticket 112). Moves the item
to place `<n>` among its to-do's items, counted from 1 once it is there:
`--to=1` puts it first, and a number past the last puts it last. The
others keep their order around it. Moving it to where it is changes
nothing (`updatedAt` included). Like every item write, a move changes the
to-do's `updatedAt`; who moved it is not recorded. Prints `{"todo": …}`:
the to-do with its `items` in their new order. Socket: `todo.item_move`
with `{"itemId", "to"}`. The user drags the items into order on the
desktop; the same write.

```bash
$ galley todo item move item_2b3c4d5e6f7a8b9c --to=1 --supervisor=galley-assistant
{"todo":{"id":"todo_5e6f7a8b9c0d1e2f","title":"去上海出差",…,"items":[{"id":"item_2b3c4d5e6f7a8b9c","text":"订机票",…},{"id":"item_1a2b3c4d5e6f7a8b","text":"订酒店",…},…],"itemCount":{"done":1,"total":3},…}}
```

Errors (`invalid_args`, exit `2`): no `--to`, or one that is not a whole
number (clap's); `--to` below 1 (Core's
`move_todo_subitem: a place counts from 1`, nothing moved);
`assistant_unavailable:`.

Exit codes: `0` / `2 invalid_args` / `3 not_found` (unknown item, or its
to-do cancelled) / `4 db_unavailable`.

### 5.34f · `galley todo skip <todo-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Added 2026-11-10 (main chat ticket 154). Skips this
period of a repeating to-do ("not this time"): it is cancelled as `cancel`
cancels one (`status` `cancelled`, `cancelledAt`, `cancelledBy` from
`--supervisor` / `--reason`, its reminder let go) and marked `skipped`,
and the next period is made in the same write, as `done` makes it — due
on the rule's first day after the later of today and this period's due
day. Prints `{"todo": …, "next": …}` (`next` absent when another period of
the rule is still open). The rule goes on; a skipped period is not one of
the follow-ups the user turned down (§5.34). Socket: `todo.skip` with
`{"todoId"}`. The desktop's 「跳过这一次」 is the same write.

```bash
$ galley todo skip todo_8b927e12a3c5cc82 --supervisor=galley-assistant
{"todo":{"id":"todo_8b927e12a3c5cc82","title":"交周报",…,"status":"cancelled",…,"cancelledBy":{"via":"supervisor","supervisor":"galley-assistant"},…,"skipped":true,…},"next":{"id":"todo_72b49a61cefc8ea6","title":"交周报","due":{"date":"2026-11-30",…},…}}
```

Errors (`invalid_args`, exit `2`): a done period (`reopen` it first);
`assistant_unavailable:`; and `not_repeating:` — the to-do does not
repeat, or its rule ended.

Exit codes: `0` / `2 invalid_args` / `3 not_found` (unknown or cancelled,
a period skipped before included) / `4 db_unavailable`.
