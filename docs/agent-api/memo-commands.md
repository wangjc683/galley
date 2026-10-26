# Agent API — Memo Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.35–§5.39: the `memo` family (what Galley knows about the user). Additive inside `schemaVersion: 3` since 2026-10-26 (main chat ticket 95), and served under `1` and `2` too.

A **memo** is something Galley knows about the user: what they are called,
their family, what they prefer or avoid, the people and places they deal
with, an interest that keeps coming up. A [to-do](./todo-commands.md) is
something to do and gets done; a memo does not: it holds, or stops holding,
and one that stops on a day carries that day. The assistant (the managed
runtime's main chat) notes memos in the conversation with these commands,
and the main chat reads them at the start of every segment. The user can
only delete a memo, on the desktop (recorded as `{"via":"gui"}`);
everything else goes through Galley.

- **Limits** (main chat PRD ruling 141): a memo is 1 to 100 characters once
  trimmed, counted as characters (Unicode scalar values), not bytes; past
  that a write is refused. The memos that hold come to at most 2,000
  characters at the start of a segment: a write that takes them past it is
  kept and says by how much (`overLimit`), and the segment start then
  leaves the last ones noted out, saying how many.
- **Last day** (`until`): a local date `YYYY-MM-DD`, read in the zone of the
  machine Galley runs on, not before today. After that day the memo is in
  no list, not the segment start, not the desktop's, and does not count
  toward the total; it is not deleted.
- **Where it lives**: memos belong to the assistant. Every write needs the
  managed runtime with its main chat; under an attached external GA the
  writes are refused (`assistant_unavailable:`) and `list` still answers.
- **Where it was written**: a write with `--supervisor=galley-assistant`
  while a main chat run is open records that run, as `todo add` does
  (`createdIn` on the memo for `add`). The morning review wakes for the
  memos noted or changed since the day of the review before it in runs the
  user started, and names them.

`list` reads SQLite directly (no Galley Core needed); every other command
goes through the socket (`memo.list`, `memo.add`, `memo.update`,
`memo.delete`; the socket also serves `list`). Every write takes
`--supervisor=<x>` / `--reason=<y>` (§6A `Origin`): `add` records them as
the memo's `origin`, and every write records them with the write itself
(the desktop's cards read that record). The assistant writes with
`--supervisor=galley-assistant`. There is no `show`: a memo is one
sentence, and `list` prints it whole.

### 5.35 · `Memo`

Every command prints this shape (`list` one per line, writes as
`{"memo": …}`). camelCase, optional fields omitted when empty.

| Field       | Type             | Notes |
| ----------- | ---------------- | ----- |
| `id`        | string           | `memo_<16-hex>` (Core mints it) |
| `text`      | string           | The memo, trimmed, 1 to 100 characters |
| `until`     | string?          | Its last day, a local date `YYYY-MM-DD`; absent for a memo with no end |
| `origin`    | `Origin`         | Who noted it (`update` does not change it) |
| `createdIn` | object?          | `{sessionId, turnIndex?}`: the main chat run Galley noted it in, as for a to-do (§5.28). Recorded when `add` carries `--supervisor=galley-assistant` while a main chat run is open; `turnIndex` (the run's reply) is filled when that run ends |
| `createdAt` | string (ISO8601) | |
| `updatedAt` | string (ISO8601) | When its text or its last day last changed |

`add` and `update` print `{"memo": Memo}`, with one more field when the
memos that hold now total more than 2,000 characters (the write is kept):

| Field       | Type   | Notes |
| ----------- | ------ | ----- |
| `overLimit` | object | `{chars, limit, over, message}`: the total now, `2000`, how far past it, and the same in a sentence: "Memos now total 2010 characters, 10 over the 2000 the start of each segment holds, so the last ones noted will be left out of it: merge memos or delete the ones out of date first." |

### 5.36 · `galley memo list`

**Read-only** — direct SQLite. NDJSON. The memos that hold today (none past
its last day), in the order they were noted.

```bash
$ galley memo list
{"id":"memo_5c0e2b7a91d3f468","text":"不吃香菜","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user said so"},"createdIn":{"sessionId":"s-main-…","turnIndex":40},"createdAt":"2026-10-24T12:30:02+00:00","updatedAt":"2026-10-24T12:30:02+00:00"}
{"id":"memo_8e41a9c07b2d6f13","text":"下周三起在上海出差","until":"2026-11-06","origin":{"via":"supervisor","supervisor":"galley-assistant"},…}
```

Exit codes: `0` / `4 db_unavailable`.

### 5.37 · `galley memo add "<text>" [--until=<date>] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Prints `{"memo": Memo}`, and `overLimit` past the total.

| Flag      | Notes |
| --------- | ----- |
| `--until` | Its last day, a local date `YYYY-MM-DD` read in the time zone of the machine Galley runs on; today or later |

```bash
$ galley memo add "下周三起在上海出差" --until=2026-11-06 --supervisor=galley-assistant --reason="user mentioned it"
{"memo":{"id":"memo_8e41…","text":"下周三起在上海出差","until":"2026-11-06","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdIn":{"sessionId":"s-main-…"},…}}
$ galley memo add "工作日 9 点到公司" --supervisor=galley-assistant
{"memo":{"id":"memo_2f6d…","text":"工作日 9 点到公司",…},"overLimit":{"chars":2010,"limit":2000,"over":10,"message":"Memos now total 2010 characters, …"}}
```

Errors (`invalid_args`, exit `2`): a text that is empty or longer than 100
characters once trimmed (the message says the limit and how many it has);
a `--until` that is not a date; and, with a stable message prefix (§1.1):

- `time_in_past:` — `--until` is before today. Nothing is written.
- `assistant_unavailable:` — the active runtime is the external one, or the
  managed runtime has no main chat yet.

Exit codes: `0` / `2 invalid_args` / `4 db_unavailable`.

### 5.38 · `galley memo update <memo-id> [--text=<text>] [--until=<date> | --no-until] [--supervisor=<x>] [--reason=<y>]`

**Write command.** Only what is given changes (at least one of `--text`,
`--until`, `--no-until`); prints `{"memo": …}`, and `overLimit` past the
total.

- `--text`: the new text, by `add`'s rule.
- `--until` (`add`'s form) sets the last day; `--no-until` removes it. A
  memo past its last day can be given a later one, and holds again.
- `origin` is not changed: it says who noted the memo.
- An update that changes nothing (the same text once trimmed, the same
  last day) is not a write (main chat ticket 98): it answers with the memo
  as it is, its `updatedAt` stays, it does not make the memo new for the
  morning review, and no write is recorded (no card under the reply).

On the socket (`memo.update`), an empty `until` removes the last day, as an
empty value clears a field on `todo.update`; the CLI sends one for
`--no-until`. An update with nothing to change is `invalid_args`.

Exit codes: `0` / `2 invalid_args` (incl. `time_in_past:`,
`assistant_unavailable:`) / `3 not_found` (unknown or deleted) /
`4 db_unavailable`.

### 5.39 · `galley memo delete <memo-id> [--supervisor=<x>] [--reason=<y>]`

**Write command.** Deletes the memo: it leaves every list and every write
answers `not_found` for it, deleting it again included. The record of its
writes stays (the desktop's card under the reply says it is no longer
kept). Prints `{"memo": …}`, the memo as it was.

Exit codes: `0` / `2 invalid_args` (`assistant_unavailable:`) /
`3 not_found` / `4 db_unavailable`.
