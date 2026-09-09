# Agent API — Locations & Transports

> Part of the [Galley Agent API](./README.md) contract. Database locations, the direct-SQLite vs local-socket transports, and the NDJSON wire format.

## 2 · Where to find things

- **Database location.** The CLI reads the same SQLite file the Galley
  GUI writes to. Default paths:
  - macOS: `~/Library/Application Support/app.galley/workbench.db`
  - Linux: `$XDG_CONFIG_HOME/app.galley/workbench.db` or
    `~/.config/app.galley/workbench.db`
  - Windows: `%APPDATA%/app.galley/workbench.db`
- **Override.** Set `GALLEY_DB_PATH=<absolute-path>` to point at a
  specific file (snapshots, isolated test fixtures, etc.).
- **Identifier.** `app.galley` is the Tauri bundle identifier — do not
  change without a coordinated migration (see
  [desktop runtime](../desktop-runtime.md#tauri-identifier)).

## 2A · Transports

Galley CLI commands reach Galley Core through one of two transports
depending on whether the command is read-only or writes state.

### Read-only commands → direct SQLite

`sessions list / search`, `session brief / show / wait`, `project list`,
`project brief`, `project show`, `status`, `health`, `version` open
the SQLite file directly via `GALLEY_DB_PATH` (or the platform default
path in §2). **No daemon required.** Useful when:

- Galley GUI isn't running but the agent wants to inspect history
- A CI / cron job wants to scrape session state from a snapshot DB

These commands return the same persisted JSON whether or not Galley Core
is running. Since 2026-09-09 three of them (`sessions list`,
`session brief`, `status`) additionally make one best-effort socket call
(`sessions.run_state`, bounded to 3s) and attach the answer as the
additive `live` field; when Core is unreachable the field is simply
omitted and the command still succeeds from SQLite alone. This is the
one place a read command touches the socket — it never fails because of
it.

### Write commands → local socket

`session send`, `session watch`, and write commands connect to a
per-user local socket served by a running Galley Core process.
`session follow` and `project follow` are hybrid commands: they read
SQLite snapshots first, then attempt live socket subscriptions when a
runner is available. `session wait` remains direct-SQLite only; it
polls persisted messages rather than subscribing to live events.

- **macOS / Linux**: Unix domain socket at `$TMPDIR/galley-$UID.sock`
  (typically `/tmp/galley-501.sock`). Permission `0600` — only the
  owning OS user can connect.
- **Windows**: Named pipe at `\\.\pipe\galley-$USERNAME`, scoped to
  the calling user's namespace.

**No TCP, no token, no TLS.** Auth = filesystem permission (Unix) /
user-scoped namespace (Windows). Cross-machine access goes through
GA's IM frontends + Galley CLI on the host machine, not directly to
this socket. See [AGENTS.md "Localhost Only"](../../AGENTS.md).

#### Wire format (NDJSON)

Every request is a single JSON object on one line; the server replies
with one JSON line for unary commands, or a stream of NDJSON lines for
subscription commands like `session watch`.

Request:

```json
{
  "command": "session.send",
  "args": { /* command-specific */ },
  "schemaVersion": 1,
  "requestId": "any-client-string-for-demux"
}
```

Unary response (success):

```json
{
  "ok": true,
  "requestId": "...",
  "result": { /* command-specific */ }
}
```

Unary response (error):

```json
{
  "ok": false,
  "requestId": "...",
  "error": "not_found",
  "message": "human-readable explanation"
}
```

Stream response (for subscription commands):

```json
{"stream": "event", "requestId": "...", "data": { /* event payload */ }}
{"stream": "event", "requestId": "...", "data": { /* ... */ }}
{"stream": "end",   "requestId": "...", "reason": "subprocess_exited"}
```

#### Wire-level error discriminants

These are stable identifiers — agents pattern-match on them:

| `error`            | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `invalid_args`     | Argument validation failed (missing field, bad JSON)                 |
| `not_found`        | Target resource missing (no session with that id, etc.)              |
| `db_unavailable`   | DB file missing / unopenable / Galley Core not running               |
| `unknown_command`  | Server doesn't know that command name                                |
| `schema_mismatch`  | Client's `schemaVersion` != server's accepted version                |
| `not_implemented`  | Reserved — currently NO emitter on either end; do not expect it      |
| `idle_timeout`     | Connection sat idle past 90s — server politely closed                |
| `internal`         | Unexpected server failure                                            |

The CLI maps each tag onto the §3 exit code table when surfacing the
error.

#### Race detection at startup

If a second Galley Core process tries to start while another is
already bound to the same socket path, it logs a diagnostic and
returns without binding (so the first instance keeps owning the
socket). Stale sockets from crashed previous processes get unlinked
and rebound automatically.

A sub-millisecond race window exists between try-connect and rebind;
in practice it's never been hit. If it does happen, the second
instance exits its socket setup and CLI clients see `exit 4` until
the user restarts.

## Local file presentation (v1 additive)

`local_file.access` takes `{path: string, action: "inspect" | "read" |
"reveal" | "open" | "read_image"}`. Tauri `access_local_file` wraps the same
`GalleyApi::access_local_file` method. No session or database state changes.
There is no dedicated CLI subcommand in this increment.

Paths must be native absolute paths or `~/…`; URL decoding belongs to the
presenter. Relative paths are rejected. Result: `{path, kind, content}`,
where `kind` is `directory`, `markdown`, `text`, `image`, or `file`
(`text` and `image` are additive since 2026-09-09; older callers that only
branch on `markdown` keep working), and `content` is null except for
`read` / `read_image`.

`kind` classification for regular files: `.md` / `.markdown` → `markdown`;
PNG / JPEG / GIF / WebP → `image`; an extension allow-list of code and data
files (`txt log csv tsv json jsonl yaml yml toml ini xml html css js ts py rs
go java …`), conventional extension-less names (`Makefile`, `Dockerfile`,
`LICENSE`, `README`, …), dotfiles (`.gitignore`, `.env`, …), and any other
extension-less regular file whose first 8 KiB is NUL-free UTF-8 → `text`;
everything else → `file`. Files with an unknown extension are never sniffed.

`read` accepts `markdown` and `text` kinds up to 2 MiB of UTF-8 (optional
BOM). `read_image` accepts `image` kinds up to 10 MiB and returns a data URL
in `content`; this permits images outside the WebView asset scope without
widening global filesystem permissions. `reveal` opens directories or
selects files in the system file manager. `open` hands the file to the
default application only for documents — `markdown`, `image`, and a data
subset of `text` (`txt log csv tsv json jsonl ndjson yaml yml toml xml ini cfg
conf rst tex srt vtt`) — never for scripts, since the default application
for `.sh` / `.bat` / `.py` on some desktops executes them; the symlink's
canonical target is validated by the same rule. No shell command supplied
by the caller is executed.

Existing error categories remain unchanged: missing paths are `not_found`,
invalid paths/types/encoding/size are `invalid_args`, and I/O or OS opener
failures are `internal`. Message reason prefixes are `local_file_missing`,
`local_file_absolute_required`, `local_file_unsupported`, `local_file_too_large`,
`local_file_encoding`, `local_file_permission`, and `local_file_io`.

## Git review (v1 additive)

`git.review` and Tauri `review_git` share `GalleyApi::review_git`. Requests:

- `{action: "list", path, base?}` discovers the enclosing worktree from an
  absolute directory/file path and lists net changes relative to its current
  HEAD — or, with `base` (additive since 2026-09-09), relative to that
  commit: everything changed in the worktree since it, committed or not.
- `{action: "diff", path, filePath, head, base?}` reads one
  repository-relative file. `head` is the full commit ID returned by list, or
  null for an unborn branch. If HEAD changed since listing, refresh is
  required instead of mixing bases. Pass the same `base` as the list.
- `{action: "log", path}` (additive since 2026-09-09) returns the 30 most
  recent commits on the current branch, newest first, as `commits:
  [{id, subject, author, authoredAt}]` — the choices for `base`.

`base` must be a 7–40 character hex commit id (resolved with `rev-parse
--verify`); refspecs and revision expressions are rejected with
`git_review_invalid_base`.

Result: `{root, head, files, patch, content, notice, base?, commits?}`.
`base` echoes the resolved full id of an explicit baseline and is absent
when the comparison used HEAD; `commits` is present for `log` only. `files` contains
`{path, status}` entries (`added`, `modified`, `deleted`, `type_changed`,
`conflicted`, `untracked`). Renames appear as deletion/addition in this first
increment. `patch` contains a unified Git patch for a tracked file; `content`
contains bounded UTF-8 text for an untracked file. The other payload is null.
`notice` explains non-text/unsupported/oversized content, a conflict, submodule,
or a now-unchanged file. Untracked files remain distinct from tracked additions.
Unborn repositories list tracked files as additions and have no commit baseline.

This is a read-only view of the whole worktree, not attribution to a session.
No Git init, stage, commit, checkout, network, or database writes. Git runs
without shell interpolation, optional locks, external diff, textconv, or configured
clean/process filter helpers.
Paths use literal pathspecs; reads and command output are bounded (2 MiB), with
10-second command timeouts. Lists are capped at 5000 files and rendered patches
at 5000 lines. Git-ignored files, hidden directories, and OS data directories
are pruned from the untracked traversal; tracked changes remain visible.
No dedicated CLI subcommand is added in this increment.

Existing error categories are retained. Reason prefixes: `git_review_invalid_path`,
`git_review_not_repository`, `git_review_unavailable`, `git_review_failed`,
`git_review_timeout`, `git_review_too_large`, `git_review_encoding`,
`git_review_changed` (refresh required), and `git_review_invalid_base`.
Missing Git is not an empty change list.
