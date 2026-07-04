# Agent API — Project & LLM Commands

> Part of the [Galley Agent API](./README.md) contract. Command reference §5.14–§5.18: `project` commands and `llm list` / `llm set`.

### 5.14 · `galley project create "<name>" [--root-path=…] [--enable-workspace] [--icon=…] [--color=…] [--supervisor=<x>] [--reason=<y>]`

**Write command** — creates a project. Id is server-side minted
(`proj_<16-hex>`) so SOPs don't have to invent ids. `name` is trimmed
server-side; empty after trim → `invalid_args`.

| Flag           | Default        | Notes                                                                                                     |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `--root-path`  | (none)         | Optional Project folder. Metadata only unless paired with `--enable-workspace`.                           |
| `--enable-workspace` | `false`  | Opts this Project into GA Project Workspace for future runner spawns. Requires a non-empty `--root-path`. |
| `--icon`       | (none)         | Legacy icon metadata. Current GUI renders the standard Phosphor folder icon.                             |
| `--color`      | (none)         | Hex accent color (e.g. `#7c84ff`).                                                                       |

```bash
$ galley project create "MyApp refactor" --root-path=/Users/me/src/myapp --enable-workspace
{"project":{"id":"proj_a1b2c3d4e5f60718","name":"MyApp refactor","rootPath":"/Users/me/src/myapp","workspaceEnabled":true,…}}
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
| `rootPath`       | string?          | Optional Project Workspace root. Never used as process cwd.          |
| `workspaceEnabled` | bool           | True when `rootPath` activates GA Project Workspace on future runner spawn. Legacy rows default false. |
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
