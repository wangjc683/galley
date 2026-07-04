# Agent API — Exit Codes, Output & Errors

> Part of the [Galley Agent API](./README.md) contract. Exit codes, output discipline, error envelopes, and shared types.

## 3 · Exit codes

| Code | Category          | When                                                        |
| ---- | ----------------- | ----------------------------------------------------------- |
| `0`  | success           | command completed; output (if any) is on stdout             |
| `1`  | `internal`        | unexpected failure (sqlx bug, FS race, etc.)                |
| `2`  | `invalid_args`    | argument validation failed (unknown `--status` value, …)    |
| `3`  | `not_found`       | requested resource missing (`session brief <id>` no row)    |
| `4`  | `db_unavailable`  | DB file missing / unopenable / corrupted; Galley Core not reachable on socket |
| `5`  | `runner_error`    | runner subprocess unreachable / IPC dispatch failed after persist (`session btw` no live bridge, `llm set` runner write fail) |

Exit codes are reserved categories — they do not get reassigned. A new
error class would take the next free code (`6`, `7`, …) without
disturbing `1–5`.

## 4 · Output discipline

- **Success → JSON on stdout.** List-returning commands emit **NDJSON**
  (one object per line) so streaming parsers like `jq -c` work without
  buffering.
- **Errors → JSON on stdout.** Same stream as success, with the
  envelope in §6. Exit code carries the category for SOPs that don't
  want to parse JSON.
- **stderr is reserved.** Only Rust runtime panics / backtraces show up
  there. Safe to pipe `2>/dev/null` when you only care about the
  protocol output.
- **No colour codes / TTY frills.** Output is byte-identical whether
  attached to a TTY or piped.

## 6 · Error envelope

### CLI error envelope

Every CLI error — read or write — uses the same shape on stdout:

```json
{
  "error":  "not_found" | "invalid_args" | "db_unavailable" | "runner_error" | "internal",
  "message": "<human-readable explanation>"
}
```

- `error` is a stable discriminant (matches the `GalleyError` enum
  variants in [`core/src/error.rs`](../../core/src/error.rs)).
- `message` is the human-readable explanation. Top-level so SOPs can
  read one shape across both transports (B4 M6 freeze).
- A future v1-additive `detail` object can carry structured context
  (`sessionId`, `path`, `expected`, …) without breaking parsers that
  already pattern-match on `error` + `message`.

Example:

```bash
$ galley session brief sess_missing ; echo "exit: $?"
{"error":"not_found","message":"session sess_missing not found"}
exit: 3
```

### Socket error envelope

Write commands invoke the local socket transport. The socket envelope
wraps the same `error` / `message` fields with `ok: false` + the
caller's `requestId` so a single connection can multiplex many
in-flight requests:

```bash
$ galley session send sess_missing "hi" ; echo "exit: $?"
{"ok":false,"requestId":null,"error":"not_found","message":"session 'sess_missing' does not exist"}
exit: 3
```

The CLI maps each `error` discriminant onto an exit code via the §3
table. Future error classes get their own discriminant; v1 won't
rename existing ones.

## 6A · Shared types

### `Origin`

Records the source of ordinary human/Supervisor writes. Goal task/event writes
are the current protocol exception: they use `ownerSessionId` /
`authorSessionId` because the actor is a child session on a Goal board, not a
human-facing command origin. Older rows from before migration 006 may also omit
Origin on read responses.

| Field         | Type            | Notes                                                                  |
| ------------- | --------------- | ---------------------------------------------------------------------- |
| `via`         | string enum     | `gui` / `cli` / `supervisor` / `system`. Matches the SQL CHECK constraint on `messages.created_via` and `sessions.created_via` |
| `supervisor`  | string?         | Supervisor label / agent identity (e.g. `"ga-claude-1"`). Required when `via=supervisor`; absent for `via=gui` / `via=system`; optional for `via=cli` (presence with `via=cli` would indicate a manual terminal user impersonating a supervisor — Galley doesn't reject it but supervisors should prefer `via=supervisor` to claim identity) |
| `reason`      | string?         | Free-text rationale. Shows up in audit / activity-log views. Recommended on destructive operations + autonomous (non-user-relayed) judgments |

The CLI auto-elevates `via` based on `--supervisor`: pass `--supervisor=<id>`
on any write command → stored `via = supervisor`; omit it → `via = cli`.
The GUI always writes `via = gui`. `via = system` is reserved for
internal Galley triggers (auto-clear-unread, lifecycle events, etc.).

Wire example:

```json
{"via": "supervisor", "supervisor": "ga-claude-1", "reason": "user said tldr"}
```
