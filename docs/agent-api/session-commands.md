# Agent API — Session Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.1–§5.13: `version`, `status`, `health`, and all `sessions` / `session` commands.

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

### 5.2 · `galley sessions list [--runtime=current|managed|external|all] [--project=X] [--status=Y] [--archived | --all]`

Lists sessions in `pinned DESC, last_activity_at DESC` order. NDJSON,
one `SessionBrief` per line.

| Flag         | Type   | Default      | Notes                                                                                             |
| ------------ | ------ | ------------ | ------------------------------------------------------------------------------------------------- |
| `--runtime`  | enum   | `current`    | `current` follows the GUI's active runtime; `all` is explicit cross-runtime listing                |
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
| `runtimeKind`     | string enum     | `managed` / `external`; product-facing alias for CLI callers                       |
| `runtimeLabel`    | string          | `Galley` / `Attached GenericAgent`                                                 |
| `gaRuntimeKind`   | string enum     | `managed` / `external`; runtime ownership captured at session creation             |
| `gaRuntimeId`     | string?         | stable runtime id for future multi-runtime support                                 |
| `promptProfile`   | string?         | managed prompt profile id, when applied                                            |

### 5.3 · `galley sessions search <query> [--runtime current|managed|external|all] [--all]`

FTS5 trigram search over message bodies. Two-character queries fall
back to LIKE substring search. Queries shorter than two characters
return empty. By default, search follows the GUI's current runtime context, so
managed and external GA histories stay separate unless the caller explicitly
asks for all runtimes.

| Flag        | Default   | Notes                                                         |
| ----------- | --------- | ------------------------------------------------------------- |
| `--runtime` | `current` | runtime scope: current GUI context, managed, external, or all |
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
| `dispatch` | string enum   | `"dispatched"` if the runner received the command on stdin; `"persisted_only"` if no runner is alive (LRU-evicted / crashed / never spawned) — the row is in SQLite either way |

**Semantics**: fire-and-forget. The CLI returns as soon as the message
is persisted; it does **not** wait for the runner to complete the
agent turn. Pair with `galley session watch <id>` if you need to see
the resulting events. See [B2 playbook running note N34] for the
rationale.

**Origin handling**: if you pass `--supervisor`, the stored
`origin.via` is `supervisor`. Without it, it's `cli`. Use
`--supervisor` for SOP-driven invocations so audit logs can filter by
agent identity.

Exit codes: `0` success / `3 not_found` (session missing) /
`2 invalid_args` (session archived, malformed args) /
`4 db_unavailable` (Galley Core not running).

### 5.5b · `galley session watch <id>`

**Subscription command** — streams live IPC events from a session's
runner subprocess on stdout (one event per line, NDJSON). The
connection stays open until either:

- the subprocess exits (server sends `{"stream":"end","reason":"subprocess_exited"}` then closes), or
- the client sends SIGINT (Ctrl-C) / the process exits

Requires Galley Core to be running and a live runner for the target
session.

```bash
$ galley session watch sess_abc
{"stream":"event","requestId":null,"data":{"kind":"turn_start","sessionId":"sess_abc",…}}
{"stream":"event","requestId":null,"data":{"kind":"tool_call_start",…}}
{"stream":"event","requestId":null,"data":{"kind":"tool_call_end",…}}
{"stream":"event","requestId":null,"data":{"kind":"turn_end",…}}
{"stream":"end","requestId":null,"reason":"subprocess_exited"}
$ # exit 0
```

The `data` payload mirrors the runner ↔ Galley Core IPC event shape
defined in [`docs/ipc-protocol.md`](../ipc-protocol.md) §4 — same
`kind` discriminator and per-event field set.

**No backlog support yet.** Subscribers see events from subscribe-time
forward only. Catching up on the recent history requires
`galley session show <id> --tail=N` first. A `--from=<event-index>`
flag is planned (see [B2 playbook running note N35]).

Exit codes: `0` clean stream end / `3 not_found` (no live runner for
that session id) / `4 db_unavailable` (Galley Core not running).

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

### 5.5d · `galley session wait <id> [--timeout=N] [--poll=N] [--tail=N] [--final-show[=true|false]]`

**Bounded result retrieval command** — additive in schema v1. Polls the
Galley DB for a visible agent message, then emits a final payload and
exits. This command is intended for Supervisor / IM integrations where
a local tool timeout must not be interpreted as child task failure.

Defaults: `--timeout=300`, `--poll=5`, `--tail=20`,
`--final-show=true`. `--poll` values below 1 second are clamped to 1.

```bash
$ galley session wait sess_abc --timeout=300 --poll=5 --tail=20 --final-show
{"schemaVersion":1,"stream":"wait","phase":"initial","session":{…},"messages":[…]}
{"schemaVersion":1,"stream":"wait","phase":"final","status":"completed","session":{…},"messages":[…]}
{"schemaVersion":1,"stream":"end","reason":"completed"}
```

If the deadline passes before a visible agent message exists:

```json
{"schemaVersion":1,"stream":"wait","phase":"final","status":"timed_out","session":{…},"messages":[…]}
{"schemaVersion":1,"stream":"end","reason":"timeout"}
```

`status:"timed_out"` means the waiter stopped waiting; it does not mean
the Galley session failed or produced no later result. Supervisors
should report the session id and invite a later follow-up instead of
saying the delegated task failed.

Completion is detected from the returned visible message tail: any
`role:"agent"` row with non-empty `content` or `finalAnswer` counts as
retrievable output. **On multi-turn sessions this means a bare
send→wait pair returns immediately on the PREVIOUS turn's answer** —
pass `--after-turn=N` (additive) to only count agent messages with
`turnIndex >= N`. Read the session's `turnCount` before sending to pick
`N`. `--final-show=false` omits `messages` from the final payload while
keeping the initial snapshot.

Dead sessions end the wait early (additive): a session persisted in
`error` or `cancelled` status can no longer produce the awaited output,
so the waiter emits `status:"session_error"` / `status:"session_cancelled"`
(same value as the `end` frame's `reason`) instead of burning the full
deadline. Like `timed_out`, these describe the wait, not the delegated
task's business outcome.

Exit codes: `0` for `completed`, `timed_out`, `session_error`, and
`session_cancelled` / `3 not_found` (session missing) /
`4 db_unavailable` (DB missing or unopenable).

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

### 5.8 · `galley session new "<task>" [--runtime=current|managed|external] [--project=<id>] [--llm=<name>] [--supervisor=<x>] [--reason=<y>]`

**Write command** — creates a session, persists the first user message
in **one SQLite transaction**, starts a runner, and dispatches the first
task. Either both DB rows commit or neither does; once the rows commit,
runner spawn/dispatch failures surface as `runner_error` (exit 5) so
agents know the delegated task did not actually start.

If `--project` points at a Project with `workspaceEnabled=true` and a
`rootPath`, the next runner spawn passes that folder as GA Project Workspace.
It is never passed as process `cwd`; GA memory/SOP lookup continues to use the
runtime's own state root.

| Flag           | Default                              | Notes                                                                                          |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `--project`    | (none → ungrouped)                   | Project id. Invalid id → `invalid_args`.                                                       |
| `--llm`        | (none → bridge default at spawn)     | LLM display name (case-insensitive). Resolved against the cached `llm_list` pref.              |
| `--runtime`    | `current`                            | Follows GUI active runtime by default. `managed` / `external` are explicit cross-runtime writes. |
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
| `dispatch` | string enum    | `"dispatched"` on success. Runner start/send failure returns exit 5 instead of a success envelope.     |
| `warning`  | object?        | Present when the caller explicitly writes to a non-current runtime.                                  |

Exit codes: `0` success / `2 invalid_args` (empty `task`, unknown
`--llm`, unknown project, empty `llm_list` cache) / `3 not_found` /
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
