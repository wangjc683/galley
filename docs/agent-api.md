# Galley Agent API

The contract between **Galley** and any agent that drives it via the
`galley` CLI binary or the Unix-socket / named-pipe local transport.

> **Status: `schemaVersion: 1` is frozen for the `v0.2.x` line.**
> The commands documented in §5 are wired, tested, and locked. Inside
> `schemaVersion: 1` the rules in §1 hold: additive commands, flags,
> and optional fields are non-breaking; renames / removals require a
> `schemaVersion: 2` bump.

## 1 · Stability

The CLI output schema **and the socket wire format** are both part of
Galley's public contract — supervisor agents and Skills depend on
them. We commit to the rules in
[AGENTS.md "CLI Surface Is Public Contract"](../AGENTS.md).

- **`schemaVersion: 1` is additive-only.** New optional fields can
  arrive on requests and responses; existing field names and semantics
  do not change inside this major version.
- **Breaking change requires a bump.** A `schemaVersion: 2` introduces
  the breaking change, and old SOPs can opt into the v1 view via
  `--schema=1` on the CLI (or the request's `schemaVersion` field over
  the socket).
- **Exit-code categories are stable.** The six exit codes in §3 do not
  get reassigned across `schemaVersion` bumps — agents can branch on
  them confidently without parsing JSON.
- **The socket path is stable.** Per-user Unix socket / named pipe
  paths in §2A don't change across `schemaVersion: 1` patch releases.
- **camelCase everywhere.** Every JSON field on the wire is camelCase
  (`projectId`, `lastActivityAt`, `schemaVersion`, …). No snake_case
  outliers. Pre-freeze adjustment under M6 — see §5.1.

If a future change feels load-bearing enough to risk these promises, it
gets a `schemaVersion` bump.

### 1.1 Stable identifier sets

The following enum / discriminant strings are **stable identifiers** —
agents pattern-match on them, additions are non-breaking, renames /
removals require a `schemaVersion: 2` bump.

#### Error discriminants — CLI-visible (5)

These are what the `error` field on the CLI error envelope (§6) can
hold. Each maps 1-1 to an exit code (§3):

| `error`            | Exit code | When                                                              |
| ------------------ | --------- | ----------------------------------------------------------------- |
| `internal`         | 1         | Unexpected server failure                                         |
| `invalid_args`     | 2         | Argument validation failed                                        |
| `not_found`        | 3         | Resource missing                                                  |
| `db_unavailable`   | 4         | DB unopenable / Galley Core not running                           |
| `runner_error`     | 5         | Runner subprocess unreachable / IPC dispatch failed after persist |

#### Error discriminants — socket-wire only (4)

These appear on the socket transport envelope (§2A) for transport-level
failures. They surface to the CLI as exit code 1 (`internal`) so SOPs
get a clean error path; the JSON envelope carries the original tag.

| `error`            | Surfaces as | When                                                 |
| ------------------ | ----------- | ---------------------------------------------------- |
| `unknown_command`  | exit 1      | Server doesn't know that command name (version skew) |
| `schema_mismatch`  | exit 1      | Client's `schemaVersion` != server's accepted set    |
| `not_implemented`  | exit 1      | Command name reserved but no handler wired           |
| `idle_timeout`     | exit 1      | Long-lived stream sat idle past 90s                  |

#### Status enums

| Enum                       | Values                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `SessionBrief.status`      | `idle / connecting / running / waiting_approval / error / completed / cancelled / archived` |
| `MessageBrief.role`        | `user / agent / system` (DB `tool` rows normalize to `agent`)                         |
| `HealthCheck.status`       | `ok / warn / fail / deferred_b4` (`deferred_b4` is a legacy stable value; new `deferred_<phase>` values are additive) |
| `Origin.via`               | `gui / cli / supervisor / system`                                                     |

#### `dispatch` values (per-command)

The `dispatch` field uses different value sets per command — semantics
differ enough that a blanket `dispatch == "dispatched"` pattern would
mislead. SOPs branch per command:

| Command                          | Possible `dispatch` values                         |
| -------------------------------- | -------------------------------------------------- |
| `session send`                   | `dispatched` / `persisted_only`                    |
| `session approval-response`      | hidden native `completed_native_approval`          |
| `session new`                    | `dispatched` / hidden native `completed_native` (managed/external exit 5 if runner cannot start/send) |
| `session btw`                    | `dispatched` (only — exit 5 on no bridge)          |
| `session stop`                   | `abort_sent` / `already_stopped`                   |
| `llm set`                        | `dispatched` / `persisted_only`                    |

#### `stream.reason` values (subscription commands)

For NDJSON stream-end frames on `session watch` (§5.5b),
`session follow` (§5.5c), and `project follow` (§5.15c):

| `reason`             | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `subprocess_exited`  | Runner subprocess exited cleanly                 |
| `subprocess_error`   | Runner subprocess died unexpectedly              |
| `cancelled`          | Client disconnected (SIGINT / closed socket)     |
| `core_unavailable`   | Snapshot read worked, but no Galley Core socket was reachable |
| `not_live`           | Session exists but no live runner is subscribed  |
| `socket_closed`      | Watch socket closed without a stream-end frame   |
| `no_live_sessions`   | Project follow found no live stream output       |
| `all_live_sessions_ended` | Project follow consumed all live subscriptions |
| `native_run_complete` | Hidden native turn or approval response completed |
| `native_waiting_user` | Hidden native `ask_user` is waiting for user input |
| `native_waiting_approval` | Hidden native risky tool call is waiting for approval |
| `native_runtime_error` | Hidden native model/runtime failed before completion |

### 1.2 Schema pinning

SOPs that want to defend against future schema bumps can pin to
`schemaVersion: 1` explicitly:

- **CLI**: pass `--schema=1` on any command (global flag). Mismatch
  with the binary's accepted set → exit 2 (`error: "invalid_args"`) +
  message prefixed `schema_mismatch:`. v0.2 beta binaries only know `1`;
  future binaries that speak multiple versions will accept any in
  their supported set.
- **Socket**: include `"schemaVersion": 1` in the request JSON.
  Mismatch surfaces as the wire `schema_mismatch` discriminant (§2A);
  CLI maps that to exit 1 (`internal`) since it's a server-side
  negotiation failure rather than client input.

Omitting the pin uses the server's default. Today that's `1`; a future
multi-schema binary will document its default + the supported set on
`galley version`.

SOPs that want forward compatibility instead can omit the pin and
rely on the additive-only promise: new fields appear, but the ones
they read keep their names + semantics inside `schemaVersion: 1`.

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
  [desktop runtime](./desktop-runtime.md#tauri-identifier)).

## 2A · Transports

Galley CLI commands reach Galley Core through one of two transports
depending on whether the command is read-only or writes state.

### Read-only commands → direct SQLite

`sessions list / search`, `session brief / show`, `project list`,
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
runner is available.

- **macOS / Linux**: Unix domain socket at `$TMPDIR/galley-$UID.sock`
  (typically `/tmp/galley-501.sock`). Permission `0600` — only the
  owning OS user can connect.
- **Windows**: Named pipe at `\\.\pipe\galley-$USERNAME`, scoped to
  the calling user's namespace.

**No TCP, no token, no TLS.** Auth = filesystem permission (Unix) /
user-scoped namespace (Windows). Cross-machine access goes through
GA's IM frontends + Galley CLI on the host machine, not directly to
this socket. See [AGENTS.md "Localhost Only"](../AGENTS.md).

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
| `not_implemented`  | Command name reserved but no handler wired (transitional state)     |
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

## 5 · Commands

### 5.1 · `galley version`

Returns the CLI version + the schema version of its output protocol.

```bash
$ galley version
{"galleyVersion":"0.2.0","schemaVersion":1}
```

Response fields:

| Field            | Type   | Notes                                              |
| ---------------- | ------ | -------------------------------------------------- |
| `galleyVersion`  | string | semver of the `galley` binary itself               |
| `schemaVersion`  | int    | this document's stability key (`1` for v0.2.x) |

### 5.2 · `galley sessions list [--runtime=current|managed|external|galley-native|all] [--project=X] [--status=Y] [--archived | --all]`

Lists sessions in `pinned DESC, last_activity_at DESC` order. NDJSON,
one `SessionBrief` per line.

| Flag         | Type   | Default      | Notes                                                                                             |
| ------------ | ------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `--runtime`  | enum   | `current`    | `current` follows the GUI's active runtime; `all` is explicit cross-runtime listing; `galley-native` is hidden and requires `GALLEY_NATIVE_EXPERIMENTAL=1` |
| `--project`  | string | (unset)      | restrict to one project id                                                                        |
| `--status`   | string | (unset)      | one of `idle / connecting / running / waiting_approval / error / completed / cancelled / archived` |
| `--archived` | bool   | false        | return only archived sessions                                                                     |
| `--all`      | bool   | false        | include archived alongside active (overrides `--archived`)                                        |

Default behaviour: current runtime only, archived excluded (matches GUI
sidebar default).

Example:

```bash
$ galley sessions list --project=proj_demo
{"id":"s-abc","title":"first chat","status":"idle","turnCount":3,"lastActivityAt":"…","createdAt":"…","updatedAt":"…","pinned":false,"hasUnread":false}
{"id":"s-def","title":"second chat","status":"completed","turnCount":12,"lastActivityAt":"…","createdAt":"…","updatedAt":"…","pinned":false,"hasUnread":false}
```

`SessionBrief` fields:

| Field             | Type            | Notes                                                                              |
| ----------------- | --------------- | ---------------------------------------------------------------------------------- |
| `id`              | string          | session identifier (treat as opaque)                                               |
| `projectId`       | string?         | project membership (absent when ungrouped)                                         |
| `title`           | string          | derived from the first user message                                                |
| `status`          | string enum     | one of the values listed under `--status` above                                    |
| `summary`         | string?         | one-line agent-supplied digest of the last turn                                    |
| `turnCount`       | int?            | number of user-message turns so far                                                |
| `lastActivityAt`  | string (ISO8601)| max(timestamps across messages + lifecycle events)                                 |
| `createdAt`       | string (ISO8601)| session creation                                                                   |
| `updatedAt`       | string (ISO8601)| last metadata write                                                                |
| `pinned`          | bool?           | sidebar pin. `null` = column never set (treat as `false`); `true` / `false` = explicit |
| `hasUnread`       | bool?           | new content arrived while session was not the active one (GUI signal; B2+ writes). `null` = never set (treat as `false`) |
| `origin`          | `Origin`?       | source of the session creation (B2+ sessions origin columns). Additive optional field; omitted for default GUI-created rows, older rows, or runtimes that do not project creation origin |
| `selectedLlmIndex` | int?           | legacy per-session LLM index, when set; retained for bridge compatibility          |
| `selectedLlmKey`  | string?         | stable per-session LLM identity: managed model id or external GA raw LLM name      |
| `selectedLlmDisplayName` | string?   | cached display name for the persisted LLM selection                                |
| `runtimeKind`     | string enum     | `managed` / `external` / hidden `galley_native`; product-facing alias for CLI callers |
| `runtimeLabel`    | string          | `Galley` / `Attached GenericAgent`                                                 |
| `gaRuntimeKind`   | string enum     | `managed` / `external` / hidden `galley_native`; legacy runtime ownership projection captured at session creation |
| `gaRuntimeId`     | string?         | stable runtime id for future multi-runtime support                                 |
| `promptProfile`   | string?         | managed prompt profile id, when applied                                            |

### 5.3 · `galley sessions search <query> [--runtime current|managed|external|galley-native|all] [--all]`

FTS5 trigram search over message bodies. Two-character queries fall
back to LIKE substring search. Queries shorter than two characters
return empty. By default, search follows the GUI's current runtime context, so
managed and external GA histories stay separate unless the caller explicitly
asks for all runtimes.

| Flag        | Default   | Notes                                                         |
| ----------- | --------- | ------------------------------------------------------------- |
| `--runtime` | `current` | runtime scope: current GUI context, managed, external, hidden `galley-native`, or all |
| `--all`     | false     | include archived sessions in the scan; does not change runtime scope |

Example:

```bash
$ galley sessions search "ndjson"
{"sessionId":"s-abc","messageId":"m1","snippet":"… emit <mark>ndjson</mark> on stdout …","rank":-1.234}
```

`SearchHit` fields:

| Field        | Type   | Notes                                                                          |
| ------------ | ------ | ------------------------------------------------------------------------------ |
| `sessionId`  | string | the session containing the hit                                                 |
| `messageId`  | string | the matching message id                                                        |
| `snippet`    | string | excerpt with matches wrapped in `<mark>…</mark>`; HTML-safe                    |
| `rank`       | float  | FTS5 BM25 score (lower = better). `0.0` when the LIKE fallback returned the hit |

### 5.4 · `galley session brief <id>`

One `SessionBrief` for the given id, or exit `3 not_found`.

```bash
$ galley session brief s-abc
{"id":"s-abc","title":"…","status":"idle", …}

$ galley session brief sess_missing ; echo "exit: $?"
{"error":"not_found","detail":{"message":"session sess_missing not found"}}
exit: 3
```

### 5.5 · `galley session show <id> [--tail=N]`

Conversation messages for a session, oldest first. NDJSON, one
`MessageBrief` per line.

| Flag     | Default          | Notes                                              |
| -------- | ---------------- | -------------------------------------------------- |
| `--tail` | (full transcript)| return only the last `N` messages (still ordered)  |

`MessageBrief` fields:

| Field         | Type            | Notes                                                                 |
| ------------- | --------------- | --------------------------------------------------------------------- |
| `id`          | string          | message identifier                                                    |
| `sessionId`   | string          | parent session id                                                     |
| `role`        | string enum     | `user / agent / system`. `tool` rows surface as `agent`               |
| `content`     | string          | raw markdown body                                                     |
| `finalAnswer` | string?         | final assistant answer when the runner has produced one; omitted for intermediate steps and user rows |
| `createdAt`   | string (ISO8601)|                                                                       |
| `summary`     | string?         | agent-supplied one-line digest of this turn (assistant rows only)     |
| `turnIndex`   | int?            | which user-message-turn this message belongs to                       |
| `origin`      | `Origin`?       | source of this message (B2+; omitted on rows from before migration 006) |
| `visibility`  | `visible/internal`? | additive field for internal controller/audit turns; ordinary session reads and GUI rendering return `visible` rows only |
| `attachments` | `MessageAttachment[]`? | optional additive read metadata for Galley-owned message attachments; V1 supports image attachments created by the GUI only |

`MessageAttachment` fields:

| Field       | Type            | Notes                                                                       |
| ----------- | --------------- | --------------------------------------------------------------------------- |
| `id`        | string          | attachment identifier                                                       |
| `messageId` | string          | parent message id                                                           |
| `sessionId` | string          | parent session id                                                           |
| `kind`      | string enum     | currently `image`                                                           |
| `path`      | string          | absolute local path under Galley's app data directory                       |
| `mimeType`  | string          | `image/png`, `image/jpeg`, or `image/webp`                                  |
| `byteSize`  | int             | original pasted byte count                                                  |
| `width`     | int?            | image width when provided by the GUI                                        |
| `height`    | int?            | image height when provided by the GUI                                       |
| `createdAt` | string (ISO8601)|                                                                             |

### 5.5a · `galley session send <id> "<content>" [--supervisor=<x>] [--reason=<y>]`

**Write command** — persists a user message into a session and dispatches
it to the live runner subprocess. Requires Galley Core to be running
(exit `4 db_unavailable` if the socket isn't reachable).

V1 is text-only for CLI writes. Image attachments may appear in read
metadata when created from the GUI, but `galley session send` does not
accept or dispatch images inside `schemaVersion: 1`.

| Flag           | Default                                  | Notes                                                                |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `--supervisor` | (none → `origin.via = cli`)              | Supervisor label. When set, `origin.via` upgrades to `supervisor`.   |
| `--reason`     | (none)                                   | Free-text rationale. Stored on `messages.origin_note`; appears in audit views. |

```bash
$ galley session send sess_abc "summarize the last turn" \
    --supervisor=ga-claude-1 --reason="user said tldr"
{"message":{"id":"msg_…","sessionId":"sess_abc","role":"user","content":"summarize the last turn", \
"createdAt":"2026-05-19T…","turnIndex":3,"origin":{"via":"supervisor","supervisor":"ga-claude-1","reason":"user said tldr"}}, \
"dispatch":"dispatched"}
```

Response shape:

| Field      | Type          | Notes                                                                             |
| ---------- | ------------- | --------------------------------------------------------------------------------- |
| `message`  | `MessageBrief`| The persisted row, including server-assigned `id` + `createdAt`                   |
| `session`  | `SessionBrief`? | Present for hidden native sessions after the native turn completes, waits for user input, or waits for approval. |
| `assistantMessage` | `MessageBrief`? | Present for hidden native sessions after the native assistant message is persisted. |
| `dispatch` | string enum   | `"dispatched"` if the managed/external runner received the command on stdin; `"persisted_only"` if no runner is alive (LRU-evicted / crashed / never spawned); hidden native returns `"completed_native"`. |

**Semantics**: managed/external is fire-and-forget. The CLI returns as soon as
the message is persisted; it does **not** wait for the runner to complete the
agent turn. Hidden native currently runs the Rust-native turn inline and returns
after that native turn completes, enters `ask_user` waiting state, or pauses on
a risky tool approval. Since Slice 4B2, a hidden native non-stream turn that
auto-executes `file_read` can make one continuation model request and persist
that continuation as `assistantMessage.finalAnswer`. Pair with
`galley session watch <id>` if you need to see the resulting events. See [B2
playbook running note N34] for the managed/external rationale.

**Origin handling**: if you pass `--supervisor`, the stored
`origin.via` is `supervisor`. Without it, it's `cli`. Use
`--supervisor` for SOP-driven invocations so audit logs can filter by
agent identity.

Exit codes: `0` success / `3 not_found` (session missing) /
`2 invalid_args` (session archived, malformed args) /
`4 db_unavailable` (Galley Core not running).

### 5.5a · `galley session approval-response <id> <approval_id> <decision> [--supervisor=<x>] [--reason=<y>]`

**Write command** — responds to a pending hidden native tool approval. This is
currently scoped to `galley_native` sessions. Managed/external GA approvals keep
using the existing GUI / runner IPC path.

| Argument / Flag  | Notes                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `id`             | Session id. The session must be a hidden native session.              |
| `approval_id`    | Pending approval id from the native `approval_pending` event / tool event row. |
| `decision`       | `allow_once`, `deny`, `always_allow_project`, or `always_allow_global`. |
| `--supervisor`   | Optional supervisor label for audit origin.                           |
| `--reason`       | Optional free-text rationale.                                         |

```bash
$ galley session approval-response sess_abc native_sess_abc_0_native_tool_1_code_run allow_once \
    --supervisor=ga-claude-1 --reason="operator approved stubbed native call"
{"session":{...},"approvalId":"native_sess_abc_0_native_tool_1_code_run", \
"decision":"allow_once","toolResult":{"status":"stubbed_no_side_effects",...}, \
"dispatch":"completed_native_approval"}
```

Socket command:

```json
{
  "command": "session.approval_response",
  "args": {
    "sessionId": "sess_abc",
    "approvalId": "native_sess_abc_0_native_tool_1_code_run",
    "decision": "allow_once",
    "supervisor": "ga-claude-1",
    "reason": "operator approved stubbed native call"
  },
  "schemaVersion": 1
}
```

Response shape:

| Field        | Type           | Notes                                                    |
| ------------ | -------------- | -------------------------------------------------------- |
| `session`    | `SessionBrief` | Updated session, normally back to `idle`.                |
| `approvalId` | string         | The resolved approval id.                                |
| `decision`   | string         | The accepted decision value.                             |
| `toolResult` | object         | Native tool result payload written onto the assistant turn. |
| `assistantMessage` | `MessageBrief`? | Present when hidden native continues after an approved tool and updates the assistant turn. |
| `dispatch`   | string enum    | `"completed_native_approval"`.                           |

Semantics:

- `deny` records a denied result and performs no side effect.
- Allow decisions currently unblock this one suspended call only; durable
  project/global allow-policy storage is not implemented yet.
- Since Slice 4B1, approved hidden-native `file_read` may perform a real
  read-only file read. `sideEffectsPerformed` remains `false` because no file,
  process, browser, memory, or Goal state is modified. Other native executors
  remain deterministic stubs until their own slices land.
- Since Slice 4B3, a successful approved hidden-native `file_read` can make one
  non-stream continuation model request in the same response. The tool result
  stays on the assistant turn for audit, and the returned `assistantMessage`
  carries the updated `finalAnswer`. If the continuation model is unavailable
  or fails, Galley records the approved `toolResult`, emits a `runtime_error`
  event, and completes with the tool-result content instead of losing the read.
- A successful response publishes native events ending in
  `native_run_complete`; `session watch` can replay those same-process events.

Exit codes: `0` success / `2 invalid_args` (bad decision, non-native session,
approval not waiting) / `3 not_found` (session or approval missing) /
`4 db_unavailable` (Galley Core not running).

### 5.5b · `galley session watch <id>`

**Subscription command** — streams runtime events on stdout (one event per
line, NDJSON). Managed/external sessions stream live IPC events from the Python
runner subprocess. Hidden `galley-native` sessions stream native
`NativeRuntimeEvent` frames from the Core-owned native event bus.

The connection stays open until either:

- the subprocess exits (server sends `{"stream":"end","reason":"subprocess_exited"}` then closes), or
- the hidden native stream closes (native sessions send `{"stream":"end","reason":"native_run_complete"}`), or
- the hidden native stream waits for human input after `ask_user` (native sends `{"stream":"end","reason":"native_waiting_user"}`), or
- the hidden native stream waits for a tool approval (native sends `{"stream":"end","reason":"native_waiting_approval"}`), or
- the client sends SIGINT (Ctrl-C) / the process exits

Requires Galley Core to be running. Managed/external sessions require a live
runner for the target session. Hidden native sessions require a same-process
native event stream for the target session; the Slice 2 bus is not persisted
across Core restart.

```bash
$ galley session watch sess_abc
{"stream":"event","requestId":null,"data":{"kind":"turn_start","sessionId":"sess_abc",…}}
{"stream":"event","requestId":null,"data":{"kind":"tool_pending",…}}
{"stream":"event","requestId":null,"data":{"kind":"tool_start",…}}
{"stream":"event","requestId":null,"data":{"kind":"tool_end",…}}
{"stream":"event","requestId":null,"data":{"kind":"turn_end",…}}
{"stream":"end","requestId":null,"reason":"native_run_complete"}
$ # exit 0
```

For managed/external sessions, the `data` payload mirrors the runner ↔ Galley
Core IPC event shape defined in [`docs/ipc-protocol.md`](./ipc-protocol.md)
§4 — same `kind` discriminator and per-event field set.

For hidden native sessions, the `data` payload is the internal native event
shape and currently emits: `runtime_ready`, `turn_start`, `turn_progress`,
optional Slice 4A tool-control-plane events (`tool_pending`,
`approval_pending`, `approval_resolved`, `tool_start`, `tool_progress`,
`tool_end`), optional `ask_user`, `turn_end`, and `run_complete`;
model/selection failures emit `runtime_error` and close with
`native_runtime_error`.

Slice 4A / 4A2B native tool events are deterministic stubs: they expose parsed
tool intent, approval shape, approval-response flow, and result payloads, but do
not execute file, process, browser, memory, or Goal side effects.

When the selected hidden native OpenAI-compatible or Anthropic-compatible
managed model has `"stream": true` in advanced options, `turn_progress` can
appear as multiple delta events with `source: "model_stream"`. Non-stream
native model turns still emit one final `turn_progress` with `source: "model"`.

**No durable backlog support yet.** Managed/external subscribers see events
from subscribe-time forward only. Hidden native subscribers can replay the
same-process native event trace, but this is not a persisted event log and does
not survive Core restart. Catching up on recent transcript history still
requires `galley session show <id> --tail=N` first. A `--from=<event-index>`
flag is planned (see [B2 playbook running note N35]).

Exit codes: `0` clean stream end / `3 not_found` (no live runner or native
event stream for that session id) / `4 db_unavailable` (Galley Core not
running).

### 5.5c · `galley session follow <id> [--tail=N]`

**Hybrid subscription command** — emits a persisted snapshot first,
then follows live runner events if a runner exists, then emits a final
snapshot when the live stream ends.

This is the supervisor-friendly wrapper around `session show` +
`session watch`. Unlike `session watch`, no live runner is not an
error: the command returns the snapshot and ends cleanly.

```bash
$ galley session follow sess_abc --tail=20
{"schemaVersion":1,"stream":"snapshot","phase":"initial","session":{…},"messages":[…]}
{"schemaVersion":1,"stream":"event","sessionId":"sess_abc","data":{"kind":"turn_start",…}}
{"schemaVersion":1,"stream":"snapshot","phase":"final","session":{…},"messages":[…]}
{"schemaVersion":1,"stream":"end","reason":"subprocess_exited"}
```

If Galley Core is not reachable after the initial snapshot:

```json
{"schemaVersion":1,"stream":"end","reason":"core_unavailable"}
```

If the session exists but has no live runner:

```json
{"schemaVersion":1,"stream":"end","reason":"not_live"}
```

Exit codes: `0` when the session exists and the snapshot can be read /
`3 not_found` (session missing) / `4 db_unavailable` (DB missing or
unopenable). Live-runner absence is reported in the end frame, not as
exit 3.

### 5.6 · `galley status`

Aggregate counts.

```bash
$ galley status
{"total":7,"running":0,"waitingInput":0,"errored":0}
```

`StatusSummary` fields:

| Field           | Type | Notes                                                                                              |
| --------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `total`         | int  | non-archived sessions                                                                              |
| `running`       | int  | persisted sessions in `running` status. `galley status` is a direct SQLite rollup, not a live RunnerManager dashboard; GUI transient statuses usually persist as `idle`, so this often reads as 0. Use `session follow/watch`, `project follow`, or the GUI for live work. |
| `waitingInput`  | int  | persisted sessions with `waiting_approval` status (same persistence caveat)                        |
| `errored`       | int  | persisted sessions in `error` status (same persistence caveat)                                     |

### 5.7 · `galley health`

Health probe. The CLI reports SQLite/config checks directly. The historical
Python-dependent ids (`agentmain_import`, `llm_session_init`) remain in the
response for stable parser shape, but currently report `deferred_b4`; treat
that as "not checked by this command", not as a live B4 milestone promise.

```bash
$ galley health
{"checks":[
  {"id":"db_readable","status":"ok","detail":"/Users/.../workbench.db"},
  {"id":"ga_path","status":"ok","detail":"/Users/.../GenericAgent"},
  {"id":"mykey_py","status":"ok","detail":"/Users/.../mykey.py"},
  {"id":"agentmain_import","status":"deferred_b4","detail":"not currently probed by galley health"},
  {"id":"llm_session_init","status":"deferred_b4","detail":"not currently probed by galley health"}
]}
```

`HealthReport` fields:

| Field    | Type                 | Notes                                  |
| -------- | -------------------- | -------------------------------------- |
| `checks` | `HealthCheck[]`      | one entry per probe                    |

`HealthCheck` fields:

| Field    | Type        | Notes                                                                                                    |
| -------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `id`     | string      | stable identifier (pattern-match on this, not the `detail` text)                                         |
| `status` | string enum | `ok / warn / fail / deferred_b4`                                                                         |
| `detail` | string?     | human-readable explanation (paths, error messages, deferral reasoning)                                   |

Probe id catalogue (will grow):

| `id`                | Cover                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `db_readable`       | `SELECT 1` against the resolved DB path                                                              |
| `ga_path`           | `prefs.ga_config.gaPath` is set + the path resolves to a directory                                   |
| `mykey_py`          | gated on `ga_path`; checks `<ga_path>/mykey.py` is a file                                            |
| `agentmain_import`  | currently deferred; import validation happens when a runner starts or a deeper runtime check is added |
| `llm_session_init`  | currently deferred; model connection validation belongs to Models setup / live runner startup         |

Pattern: agents should branch on the `status` value (`ok` / `warn` /
`fail` actionable; `deferred_b4` indicates "this command does not currently
check that dependency — use setup screens, model probes, or live runner
startup as the stronger signal").

### 5.8 · `galley session new "<task>" [--runtime=current|managed|external|galley-native] [--project=<id>] [--llm=<name>] [--supervisor=<x>] [--reason=<y>]`

**Write command** — creates a session and persists the first user message in
**one SQLite transaction**. Managed/external runtimes then start a Python runner
and dispatch the first task; runner spawn/dispatch failures surface as
`runner_error` (exit 5) so agents know the delegated task did not actually
start. Hidden `galley-native` runs a Rust-native no-tool turn instead of
Python: it uses the first usable OpenAI-compatible API-key managed model, or an
explicit native `--llm` selection, and falls back to the Slice 2 mock worker
when no supported model is configured.

| Flag           | Default                              | Notes                                                                                          |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--project`    | (none → ungrouped)                   | Project id. Invalid id → `invalid_args`.                                                       |
| `--llm`        | (none → runtime default)             | LLM display name (case-insensitive). Resolved against the runtime's model source. Hidden native resolves managed model display names, model names, or ids; Slice 3 supports OpenAI-compatible and Anthropic-compatible API-key models. |
| `--runtime`    | `current`                            | Follows GUI active runtime by default. `managed` / `external` are explicit cross-runtime writes. Hidden `galley-native` requires `GALLEY_NATIVE_EXPERIMENTAL=1` and currently runs a no-tool native model/mock turn. |
| `--supervisor` | (none → `origin.via = cli`)          | Supervisor label. Sets `origin.via = supervisor` on the session row + the first message.       |
| `--reason`     | (none)                               | Free-text rationale on `origin.reason`.                                                        |

```bash
$ galley session new "summarize AGENTS.md" --project=proj_demo --llm=glm-4.5-x \
    --supervisor=ga-claude-1 --reason="weekly review"
{"session":{"id":"s-mvr2-3a7q","title":"新对话","status":"idle",…},
 "message":{"id":"msg_…","sessionId":"s-mvr2-3a7q","role":"user","content":"summarize AGENTS.md", …},
 "dispatch":"dispatched"}
```

Response:

| Field      | Type           | Notes                                                                                                  |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `session`  | `SessionBrief` | Newly-created row. `title` is the seed `新对话`; the bridge derives a better one after the first turn. |
| `message`  | `MessageBrief` | The persisted first user message.                                                                      |
| `assistantMessage` | `MessageBrief`? | Present for hidden native sessions after the native turn completes. Since Slice 4B2, auto-executed `file_read` can produce a continuation final answer here. |
| `dispatch` | string enum    | `"dispatched"` for managed/external runner success; hidden native returns `"completed_native"`. Runner/model start/send failure returns exit 5 instead of a success envelope. |
| `warning`  | object?        | Present when the caller explicitly writes to a non-current runtime.                                  |

Exit codes: `0` success / `2 invalid_args` (empty `task`, unknown
`--llm`, unsupported native model, unknown project, empty `llm_list` cache) / `3 not_found` /
`4 db_unavailable` / `5 runner_error` (session/message may be saved,
but the task did not start) / `1 internal` (commit failure — both rows
roll back).

### 5.9 · `galley session btw <id> "<question>" [--supervisor=<x>] [--reason=<y>]`

**Write command (transient)** — sends a "by the way" side question to a
running session's agent. The runner detects the `/btw` prefix and
bypasses its task queue, so the main turn keeps running and the answer
lands inline. **Not persisted to the messages table** — re-opening the
session loses the side-question thread (v0.1 transient policy, sub-plan
§1.5).

Requires an alive bridge (`exit 5` otherwise).

```bash
$ galley session btw sess_abc "what's the wall-clock time so far?"
{"dispatch":"dispatched"}
```

| Flag           | Default | Notes                                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `--supervisor` | (none)  | Accepted for surface symmetry; M1 doesn't act on it. Wired into the M7 supervisor action log.          |
| `--reason`     | (none)  | Same — passes through socket envelope but doesn't reach SQLite.                                        |

Exit codes: `0` success / `2 invalid_args` (empty question) /
`3 not_found` (session id) / `4 db_unavailable` /
`5 runner_error` (no live bridge for that session — `/btw` needs one).

### 5.10 · `galley session stop <id> [--reason=<y>] [--supervisor=<x>]`

**Write command** — signals the runner to abort the current turn. Maps
to `IpcCommand::Abort` (**not** `Shutdown`): the agent's loop exits and
emits `run_complete` with the `ABORTED` marker, but the bridge process
stays alive so a subsequent `session send` resumes without the 5-10s
respawn cost. Idempotent — stopping a session whose agent is already
idle returns `{dispatch: "already_stopped"}` and exit 0.

Sub-plan §1.4 explains the Abort vs Shutdown trade-off. A future
`session kill` (§8) would surface the Shutdown path.

```bash
$ galley session stop sess_abc --reason="changed my mind"
{"dispatch":"abort_sent"}

$ galley session stop sess_idle
{"dispatch":"already_stopped"}
```

| Response field | Value                                          | Meaning                                                                            |
| -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `dispatch`     | `"abort_sent"` / `"already_stopped"`           | `abort_sent` = runner was mid-turn and received Abort; `already_stopped` = no-op.  |

Exit codes: `0` (both branches) / `3 not_found` (session id) /
`4 db_unavailable` / `5 runner_error` (rare: runner died mid-dispatch
in a way we can't recover from idempotently).

### 5.11 · `galley session archive <id> [--supervisor=<x>] [--reason=<y>]`

**Write command** — flips a session's status to `archived`. The session
disappears from the GUI sidebar's active list; reversible via
`session restore`. Thin wrapper over the `archive_session` trait method.

```bash
$ galley session archive sess_abc --supervisor=ga-claude-1 --reason="auto-cleanup"
{"session":{"id":"sess_abc","status":"archived",…}}
```

Exit codes: `0` success / `3 not_found` / `4 db_unavailable`.

### 5.12 · `galley session restore <id> [--supervisor=<x>] [--reason=<y>]`

**Write command** — inverse of `session archive`. Flips status from
`archived` back to `idle`; no-op if the session wasn't archived (returns
the brief unchanged, exit 0). Thin wrapper over the `unarchive_session`
trait method.

```bash
$ galley session restore sess_abc
{"session":{"id":"sess_abc","status":"idle",…}}
```

Exit codes: `0` success / `3 not_found` / `4 db_unavailable`.

### 5.13 · `galley session move <id> [--to=<project-id>] [--supervisor=<x>] [--reason=<y>]`

**Write command** — moves a session into a project or detaches it from
its current one. Naming follows the PRD §11.2 grammar rule "noun =
verb's subject": **session is the subject of the move**, projects don't
shuffle (sub-plan O3).

| Flag    | Default                    | Notes                                                            |
| ------- | -------------------------- | ---------------------------------------------------------------- |
| `--to`  | (omit → detach)            | Target project id. Omit to move the session to ungrouped.        |

```bash
$ galley session move sess_abc --to=proj_demo
{"session":{"id":"sess_abc","projectId":"proj_demo",…}}

$ galley session move sess_abc        # no --to → detach
{"session":{"id":"sess_abc",…}}       # projectId now absent
```

Exit codes: `0` success / `2 invalid_args` (project id doesn't exist —
FK violation) / `3 not_found` (session id) / `4 db_unavailable`.

### 5.14 · `galley project create "<name>" [--root-path=…] [--icon=…] [--color=…] [--supervisor=<x>] [--reason=<y>]`

**Write command** — creates a project. Id is server-side minted
(`proj_<16-hex>`) so SOPs don't have to invent ids. `name` is trimmed
server-side; empty after trim → `invalid_args`.

| Flag           | Default        | Notes                                                                                                     |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `--root-path`  | (none)         | Filesystem root. Stored for forward compatibility — runner spawn no longer injects this (see 2026-05-14). |
| `--icon`       | (none)         | Legacy icon metadata. Current GUI renders the standard Phosphor folder icon.                             |
| `--color`      | (none)         | Hex accent color (e.g. `#7c84ff`).                                                                       |

```bash
$ galley project create "MyApp refactor" --root-path=/Users/me/src/myapp
{"project":{"id":"proj_a1b2c3d4e5f60718","name":"MyApp refactor","rootPath":"/Users/me/src/myapp",…}}
```

Exit codes: `0` success / `2 invalid_args` (empty name) /
`4 db_unavailable`.

### 5.15 · `galley project list`

**Read-only** — direct SQLite, no socket needed. NDJSON, one
`ProjectBrief` per line, ordered `pinned DESC`, then effective project
content activity descending (matches the GUI sidebar).

```bash
$ galley project list
{"id":"proj_demo","name":"MyApp refactor","pinned":true,"lastActivityAt":"…",…}
{"id":"proj_xyz","name":"Side project","pinned":false,"lastActivityAt":"…",…}
```

`ProjectBrief` fields:

| Field            | Type             | Notes                                                                |
| ---------------- | ---------------- | -------------------------------------------------------------------- |
| `id`             | string           | `proj_<16-hex>`                                                      |
| `name`           | string           |                                                                      |
| `rootPath`       | string?          |                                                                      |
| `icon`           | string?          | Emoji                                                                |
| `color`          | string?          | Hex                                                                  |
| `pinned`         | bool             |                                                                      |
| `lastActivityAt` | string (ISO8601) | `max(non-archived sessions.lastActivityAt WHERE projectId = this.id)` or `createdAt` fallback |
| `createdAt`      | string (ISO8601) |                                                                      |
| `updatedAt`      | string (ISO8601) |                                                                      |

Exit codes: `0` success / `4 db_unavailable`.

### 5.15a · `galley project brief <project-id> [--all]`

**Read-only** — direct SQLite, no socket. Returns one JSON object that
rolls up a project for supervisor batch orchestration.

By default archived sessions are excluded. Pass `--all` to include
archived sessions in `sessionCount` and `statusCounts`.

```bash
$ galley project brief proj_demo
{"schemaVersion":1,"project":{…},"sessionCount":4,
 "statusCounts":{"running":2,"completed":2},
 "runningSessions":[{…},{…}],"lastActivityAt":"…"}
```

| Field             | Type              | Notes                                      |
| ----------------- | ----------------- | ------------------------------------------ |
| `schemaVersion`   | int               | Current CLI schema version.                |
| `project`         | `ProjectBrief`    | Project row.                               |
| `sessionCount`    | int               | Sessions in the project after filters.     |
| `statusCounts`    | object            | Keys are `SessionBrief.status` values.     |
| `runningSessions` | `SessionBrief[]`  | Sessions whose persisted status is `running`. |
| `lastActivityAt`  | string (ISO8601)  | Echo of `project.lastActivityAt`.          |

Exit codes: `0` success / `3 not_found` / `4 db_unavailable`.

### 5.15b · `galley project show <project-id> [--tail=N] [--all]`

**Read-only** — direct SQLite, no socket. Returns the same project
rollup plus each session's recent transcript tail. Default
`--tail=20`.

```bash
$ galley project show proj_demo --tail=10
{"schemaVersion":1,"project":{…},"sessionCount":2,
 "statusCounts":{"completed":1,"running":1},
 "sessions":[{"session":{…},"messages":[…]},{"session":{…},"messages":[…]}]}
```

Use this before final synthesis: it gives the supervisor one stable
payload to summarize instead of a hand-written loop over `session
show`.

Exit codes: `0` success / `3 not_found` / `4 db_unavailable`.

### 5.15c · `galley project follow <project-id> [--tail=N] [--all] [--until-idle] [--final-show]`

**Hybrid subscription command** — emits a project snapshot, attempts to
follow sessions inside the project, and optionally exits when the
project becomes idle. Default `--tail=10`.

The command attempts subscription for project sessions because runner
liveness lives in Galley Core, not only in the persisted SQLite status.
For sessions persisted as `connecting`, `running`, or `waiting_approval`,
an initial `not_live` / `core_unavailable` is reported as a
`sessionEnd` frame. For ordinary idle/completed sessions, that quiet
not-live result is suppressed so large Projects do not spam the stream.

Initial and final snapshot frames include an additive `followState`
object:

| Field                  | Type   | Notes |
| ---------------------- | ------ | ----- |
| `mode`                 | string | `live` or `until_idle`. |
| `state`                | string | `empty_project`, `checking_live_events`, or `active_status_sessions`. |
| `watchedSessions`      | int    | Sessions the command attempted to follow. |
| `activeStatusSessions` | int    | Sessions persisted as `connecting` / `running` / `waiting_approval`. |
| `idleStatusSessions`   | int    | Sessions persisted as `idle`. |
| `note`                 | string | Human-readable hint. In particular, `checking_live_events` means the DB snapshot may still look idle while newly dispatched runners are starting. |

`--until-idle` is for Supervisor batch jobs. It keeps following live
events, but also polls the Project after a short quiet window. Once no
session in the Project is persisted as `connecting`, `running`, or
`waiting_approval`, the command exits with
`{"stream":"end","reason":"project_idle"}`. This handles runner
processes that stay alive after a turn emits `run_complete`.

`--final-show` emits a final Project snapshot before the end frame even
when no live stream naturally ended. Supervisors should usually combine
it with `--until-idle` so they can synthesize directly from the final
payload:

```bash
$ galley project follow proj_demo --tail=80 --until-idle --final-show
```

```bash
$ galley project follow proj_demo --tail=10
{"schemaVersion":1,"stream":"snapshot","phase":"initial","project":{…},"sessions":[…],"followState":{…}}
{"schemaVersion":1,"stream":"event","sessionId":"s-a","data":{"kind":"turn_start",…}}
{"schemaVersion":1,"stream":"sessionEnd","sessionId":"s-a","reason":"subprocess_exited"}
{"schemaVersion":1,"stream":"snapshot","phase":"final","project":{…},"sessions":[…],"followState":{…}}
{"schemaVersion":1,"stream":"end","reason":"all_live_sessions_ended"}
```

If no live sessions produce stream output, the command emits the initial
snapshot and:

```json
{"schemaVersion":1,"stream":"end","reason":"no_live_sessions"}
```

If a live-status session has no live runner or Galley Core is not
reachable, that session gets a `sessionEnd` frame with
`reason: "not_live"` or `reason: "core_unavailable"`; the command still
emits a final snapshot and exits 0.

Exit codes: `0` when the project snapshot can be read / `3 not_found`
/ `4 db_unavailable`. Per-session live-runner absence is represented
as stream frames, not process failure.

### 5.16 · `galley project delete <project-id> [--supervisor=<x>] [--reason=<y>]`

**Destructive write command** — removes the project row. FK SET NULL
auto-detaches child sessions to ungrouped; the session rows themselves
survive. Response carries `detachedSessions` count + ids so SOPs can
surface the side effect.

Per sub-plan O2, this command is honestly named `delete` because the
operation is destructive. A future release may ship a separate
reversible `project archive` alongside (§8); schemaVersion 1 doesn't
support reversible archive.

```bash
$ galley project delete proj_demo --supervisor=ga-claude-1 --reason="merged into MyApp"
{"deleted":true,"projectId":"proj_demo","detachedSessions":3,
 "detachedSessionIds":["sess_a","sess_b","sess_c"]}
```

| Response field         | Type     | Notes                                                          |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `deleted`              | bool     | Always `true` on success.                                      |
| `projectId`            | string   | Echo of the deleted id.                                        |
| `detachedSessions`     | int      | Number of sessions whose `projectId` flipped to NULL.          |
| `detachedSessionIds`   | string[] | Ids of those sessions. Empty array if no sessions were attached. |

Exit codes: `0` success / `3 not_found` / `4 db_unavailable`.

### 5.17 · `galley llm list`

**Read-only** — direct SQLite, no socket. Reads the cached `llm_list`
pref that the GUI seeds after a bridge warmup. NDJSON, one entry per
line.

```bash
$ galley llm list
{"index":0,"name":"glm-5.1","key":"NativeClaudeSession/glm-5.1","displayName":"NativeClaudeSession/glm-5.1"}
{"index":1,"name":"claude-opus-4-7","key":"NativeClaudeSession/claude-opus-4-7","displayName":"NativeClaudeSession/claude-opus-4-7"}
```

**Cache-miss is success**: an empty `llm_list` pref returns empty
stdout, exit 0 — the cache fills the first time the GUI (or a future
`llm warmup` command, §8) starts a bridge. If you suspect a stale
cache, open the GUI once to re-warm.

Exit codes: `0` success (incl. empty cache) / `2 invalid_args` (the
stored value isn't a JSON array — would indicate a future-GUI schema
drift the CLI hasn't learned about) / `4 db_unavailable`.

### 5.18 · `galley llm set <session-id> <llm-name>`

**Write command** — persists a session's per-bridge LLM choice + best-
effort tells any live runner the new pick. Two-step semantics mirror
`session send`: DB row is source of truth; runner dispatch is
opportunistic.

`<llm-name>` is matched case-insensitively against the session runtime's
model list — managed sessions resolve Galley model records; external GA
sessions resolve `galley llm list` entries. The persisted row keeps
`selectedLlmKey` so reordering models does not silently point the
session at a different model.

```bash
$ galley llm set sess_abc glm-4.5-x
{"session":{"id":"sess_abc","selectedLlmIndex":0,"selectedLlmKey":"NativeClaudeSession/glm-4.5-x","selectedLlmDisplayName":"glm-4.5-x",…},
 "dispatch":"dispatched"}

$ galley llm set sess_other glm-4.5-x   # no live bridge
{"session":{…},"dispatch":"persisted_only"}
```

| Response field | Type           | Notes                                                                                                  |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `session`      | `SessionBrief` | Updated row (carries `selectedLlmKey` plus legacy index/display companions).                            |
| `dispatch`     | string enum    | `"dispatched"` = live runner received `SetLlm`; `"persisted_only"` = no live runner (DB has the choice). |

**No Origin** flags — mirrors the trait signature: `set_session_llm`
doesn't take origin (LLM picks happen on every bridge `ready` event,
not just user actions, so an audit trail wouldn't be meaningful).

Exit codes: `0` success / `2 invalid_args` (unknown LLM name; empty
cache) / `3 not_found` (session id) / `4 db_unavailable` /
`5 runner_error` (live bridge present but stdin write failed).

### 5.19 · `galley goal ...`

**Goal V1** is Galley's headless autonomous Hive surface. Galley Core owns the
Goal state, Project binding, task board, and event stream. Managed and external
GenericAgent runtimes participate only as ordinary Galley child sessions; this
surface does **not** call GA native `/hive`, start GA BBS, or write external GA
`memory/`, SOP, config, or `temp/goal_state.json`.

Goal commands are additive inside `schemaVersion: 1`. V1 intentionally has no
full task-board UI; the CLI and the TopBar Goal indicator are the control
surface.

#### `galley goal propose "<objective>" [--project=<id>] [--budget-minutes=30] [--workers=3] [--runtime=current|managed|external|galley-native] [--write-mode=autonomous|read-only] [--expires-minutes=10] [--supervisor=<x>] [--reason=<y>]`

Creates a pending conversational-confirmation proposal. It does **not** start
work.

Hidden `galley-native` is rejected with `invalid_args` in Slice 2. Native Goal
Hive semantics land in a later Galley Native slice.

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
it to the user. The user-facing confirmation phrase is always
`确认启动 Goal`.

`--workers` defaults to `3`. Desktop presents `2`, `3`, `4`, and `5` to match
the official GA Hive guidance that ordinary Hive work usually fits in `2-4`
workers and should not exceed `5`. Core keeps the lower-level CLI/API value
within `1-5` so supervisors can still request a single-agent Goal when needed
without allowing oversized hives.

#### `galley goal run --proposal <proposal-id> --confirm-token <internal-token>` / `galley goal run <goal-id> --resume`

Starts or resumes the blocking Goal controller. Starting from a proposal
validates the proposal status, internal token, and expiry. If the proposal did
not specify a Project, Core creates one and binds the Goal to it.

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
  variants in [`core/src/error.rs`](../core/src/error.rs)).
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

## 7 · Versioning

`schemaVersion: 1` is **frozen for the v0.2.x line**. The rules in §1
apply.

Inside `schemaVersion: 1`:

- Adding a new command, flag, or output field is **non-breaking**.
- Adding a new value to a string enum (status, error, health status,
  …) is **non-breaking** — agents must handle unknown values
  gracefully (default branch).
- Adding a new error discriminant on the socket transport (e.g. a new
  not-yet-known cause for `not_implemented`) is **non-breaking**.
- Adding the v1-additive `detail` object to error envelopes is
  **non-breaking** — parsers that read `error` + `message` keep
  working.
- Removing or renaming a command / flag / field / enum value is
  **breaking**. Don't.

Inside a future `schemaVersion: 2`:

- A breaking change can ship.
- Both the CLI (`--schema=1`) and the socket (`schemaVersion` in the
  request) will support opting back into the v1 view; old SOPs keep
  working until they choose to migrate.

`galley version` returns the schema version the CLI binary is willing
to speak. The socket `version` command returns the server's accepted
schema version. Future binaries that speak multiple versions will
expose this as an array.

## 8 · Deferred v1 Additions

The following are intentionally **not in the current CLI surface yet** —
mentioned here so SOPs can plan their integration shape. Additions will be
non-breaking inside `schemaVersion: 1` per §7.

- `galley session kill <id>` — runner Shutdown (vs `session stop` which
  Aborts the turn but keeps the bridge alive). Deferred to a future release,
  pending dogfood evidence that bridge-wedge cases are common enough
  to warrant a destructive surface ([B4 M1 sub-plan O6](./refactor/B4-M1-sub-plan.md)).
- `galley project archive <id>` — true reversible archive (current
  `project delete` is destructive; a future schema can add an
  `archived_at` column and ship this as a separate command without
  changing the existing `delete` semantics — sub-plan O2).
- `galley session watch <id> --from=<event-index>` — backlog/resume
  support for supervisors reconnecting after a network blip (B2 N35).
- `galley llm warmup <id>` — explicit "spawn a bridge so `llm list`
  cache fills" command, for SOPs that don't want to rely on the GUI
  having been opened.

Future human/Supervisor-facing session and project write commands should accept
`--supervisor=<x>` / `--reason=<y>` flags following the same Origin convention
`session send` uses today (§5.5a). Goal-internal task/event/deliverable writes
remain authored by `ownerSessionId` / `authorSessionId` instead. Read commands
stay flag-light.

### 8A · `GalleyApi` trait surface (B3 M4a)

The full session/project CRUD trait landed in B3 M4a as the
authoritative write path. **B4 M1 minted CLI subcommands for the
supervisor-facing subset** (`session new / archive / restore / move`,
`project create / list / delete`, `llm set` — see §5.8-§5.18). The
methods below remain trait-only because the GUI invokes them through
direct interactions (rename via text input, pinned via right-click,
bulk via multi-select) and there's no SOP-driven scenario that needs
them outside the GUI. If a v0.6+ supervisor workflow demands them,
they get minted as new CLI subcommands additively.

Trait signatures (Rust types):

| Method | Args | Returns |
|---|---|---|
| `create_session` | `CreateSessionInput`, `Origin` | `SessionBrief` |
| `archive_session` | `SessionId`, `Origin` | `SessionBrief` |
| `unarchive_session` | `SessionId`, `Origin` | `SessionBrief` |
| `rename_session` | `SessionId`, `title: String`, `Origin` | `SessionBrief` |
| `set_session_pinned` | `SessionId`, `pinned: bool`, `Origin` | `SessionBrief` |
| `delete_session` | `SessionId`, `Origin` | `()` |
| `assign_session_to_project` | `SessionId`, `Option<String>`, `Origin` | `SessionBrief` |
| `set_session_llm` | `SessionId`, `index: Option<u32>`, `key: Option<String>`, `display_name: Option<String>` | `SessionBrief` |
| `bump_session_after_turn` | `SessionId`, `Option<String>`, `Option<u32>`, `mark_unread: bool` | `SessionBrief` |
| `clear_session_unread` | `SessionId` | `()` |
| `bulk_archive_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `bulk_unarchive_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `bulk_delete_sessions` | `Vec<SessionId>`, `Origin` | `u32` |
| `list_projects` | — | `Vec<ProjectBrief>` |
| `create_project` | `CreateProjectInput`, `Origin` | `ProjectBrief` |
| `update_project` | `ProjectId`, `ProjectPatch`, `Origin` | `ProjectBrief` |
| `delete_project` | `ProjectId`, `Origin` | `()` |
| `create_goal_proposal` | `CreateGoalProposalInput`, `Origin` | `GoalProposalBrief` |
| `start_goal_from_proposal` | `GoalProposalId`, `internalConfirmToken`, `Origin` | `GoalBrief` |
| `goal_status` | `GoalId` | `GoalStatusSnapshot` |
| `list_active_goals` | — | `Vec<GoalBrief>` |
| `request_goal_stop` | `GoalId`, `Origin` | `GoalBrief` |
| `update_goal_state` | `GoalId`, `GoalStatus`, `latestSummary?` | `GoalBrief` |
| `create_goal_task` | `CreateGoalTaskInput` | `GoalTaskBrief` |
| `claim_goal_task` | `ClaimGoalTaskInput` | `GoalTaskBrief` |
| `update_goal_task` | `UpdateGoalTaskInput` | `GoalTaskBrief` |
| `create_goal_event` | `CreateGoalEventInput` | `GoalEventBrief` |

Input types (camelCase on the JSON wire):

- `CreateSessionInput { id, title, projectId?, selectedLlmIndex?, selectedLlmKey?, selectedLlmDisplayName?, gaRuntimeKind?, gaRuntimeId?, promptProfile? }`
  — `id` is caller-assigned (`s-<base36>-<rand>` convention; conflicts
  surface as `invalid_args`).
- `CreateProjectInput { id, name, rootPath?, icon?, color? }` —
  same id-assigned-by-caller convention (`proj_<random16>`).
- `ProjectPatch { name?, rootPath??, icon??, color??, pinned? }` —
  the `?` (Option) means "leave the column alone"; the `??`
  (double-Option) on `rootPath` / `icon` / `color` means
  `Some(None)` clears the column to SQL NULL while `Some(Some(v))`
  writes `v`.

Error categories (all map to the §3 exit codes):

- `not_found` — session or project id doesn't exist.
- `invalid_args` — empty title / name after trim, id conflict, archived
  session pin attempt, FK violation (project_id pointing at nothing).
- `db_unavailable` — DB pool can't open.

### Transport notes

For the **transport**: the read commands' direct-SQLite path is a B1
convenience kept for "Galley Core not running" scenarios (snapshot
inspection, CI). The write commands' socket path is the eventual
canonical path for everything; B4 may consolidate read commands onto
it too once daemon mode is the dogfood baseline.

## 9 · See also

- [PRD §11 Agent / CLI surface](./PRD.md) — design rationale.
- [IPC protocol](./ipc-protocol.md) — wire format for the runner ↔
  Galley Core stdin/stdout channel + the socket transport this
  document layers on top.
- [B1 playbook](./refactor/B1-rust-core.md) — read-command rollout.
- [B2 playbook](./refactor/B2-bridge-ownership.md) — socket + first
  write commands (`session send / watch`) rollout, complete.
- [B4 playbook](./refactor/B4-cli-bg-artifact.md) — remaining write
  commands (M1), supervisor surface (M3 / M4 / M5), schema freeze
  (M6).
- [Refactor invariants](./refactor/invariants.md) — including §I5
  (API surface single source of truth) which makes this CLI's output
  the same source as the Tauri-invoke output the GUI sees, and §I3
  (migration numbering).
- Source for the trait + Origin type:
  [`core/src/api.rs`](../core/src/api.rs) /
  [`core/src/api/origin.rs`](../core/src/api/origin.rs).
