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

These commands return the same JSON whether or not Galley Core is
running — they don't talk to it.

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
