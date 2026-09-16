# Agent API — Stability & Versioning

> Part of the [Galley Agent API](./README.md) contract. Stability rules, stable identifier sets, schema pinning, and versioning policy.

## 1 · Stability

The CLI output schema **and the socket wire format** are both part of
Galley's public contract — supervisor agents and Skills depend on
them. We commit to the rules in
[AGENTS.md "CLI Surface Is Public Contract"](../../AGENTS.md).

- **A schema version is additive-only.** New optional fields can
  arrive on requests and responses; existing field names and semantics
  do not change inside a major version. Current: `schemaVersion: 2`
  (since 2026-09-16; see §7 for what changed and how `1` is still
  served).
- **Breaking change requires a bump.** A new major introduces the
  breaking change; commands that did not change keep answering the old
  pin (§7), so old SOPs keep working until they touch the changed
  surface.
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
| `not_implemented`  | exit 1      | Reserved — no emitter exists today; do not expect it |
| `idle_timeout`     | exit 1      | Long-lived stream sat idle past 90s                  |

#### Status enums

| Enum                       | Values                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `SessionBrief.status`      | `idle / connecting / running / waiting_approval / error / completed / cancelled / archived` |
| `MessageBrief.role`        | `user / agent / system` (DB `tool` rows normalize to `agent`)                         |
| `HealthCheck.status`       | `ok / warn / fail / deferred_b4` (`deferred_b4` is a legacy stable value; new `deferred_<phase>` values are additive) |
| `Origin.via`               | `gui / cli / supervisor / system`                                                     |
| `GoalBrief.status`         | `active / paused / blocked / completed / budget_limited / stopped / failed` (schemaVersion 2; open = the first three) |

#### `dispatch` values (per-command)

The `dispatch` field uses different value sets per command — semantics
differ enough that a blanket `dispatch == "dispatched"` pattern would
mislead. SOPs branch per command:

| Command                          | Possible `dispatch` values                         |
| -------------------------------- | -------------------------------------------------- |
| `session send`                   | `dispatched` / `persisted_only` / `queued` (additive since v0.4.6-dev; mid-run sends hold in Core's in-memory queue — see session-commands §5.5a) |
| `session new`                    | `dispatched` (exit 5 if runner cannot start/send)  |
| `session btw`                    | `dispatched` (only — exit 5 on no bridge)          |
| `session stop`                   | `abort_sent` / `already_stopped`                   |
| `llm set`                        | `dispatched` / `persisted_only`                    |
| `goal start`                     | `dispatched` (only — failures are error envelopes; schemaVersion 2) |

#### `stream.reason` values (streaming / wait commands)

For NDJSON stream-end frames on `session watch` (§5.5b),
`session follow` (§5.5c), `session wait` (§5.5d), and
`project follow` (§5.15c):

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
| `completed`          | `session wait` found a visible agent message     |
| `timeout`            | `session wait` reached its bounded wait deadline |

### 1.2 Schema pinning

SOPs that want to defend against schema bumps pin explicitly:

- **CLI**: pass `--schema=N` on any command (global flag). `N` outside
  the binary's accepted set (`1`, `2` today) → exit 2
  (`error: "invalid_args"`) + message prefixed `schema_mismatch:`. The
  same exit + prefix when `N` is `1` and the command exists only under
  `2` (the `goal` family).
- **Socket**: include `"schemaVersion": N` in the request JSON. `N`
  outside the accepted set → the wire `schema_mismatch` discriminant
  (§2A), which the CLI maps to exit 1 (`internal`). A `1` pin on a
  v2-only command → `unknown_command`.

Omitting the pin uses the server's default, `2`. `galley version`
prints the default (`schemaVersion`); the accepted set is documented
here rather than exposed as a field.

SOPs that want forward compatibility instead can omit the pin and
rely on the additive-only promise: new fields appear, but the ones
they read keep their names + semantics inside the current major.

## 7 · Versioning

### 7.1 `schemaVersion: 2` (current, since 2026-09-16)

The bump exists for one reason: the Goal surface was replaced
(`.scratch/goal-simplify`, Goal v2). The v1 `goal propose / run / task /
event / deliverable` commands, the internal `session.goal_synthesize` /
`session.goal_master_plan` / `session.goal_solo_turn` /
`session.new_goal_worker` socket commands, and the v1 `GoalBrief` /
`GoalStatusSnapshot` shapes are **removed**. Their replacement is the
four-command family in [goal-commands.md](./goal-commands.md). Nothing
else changed; `2` carries every v1 command, field, enum value, exit code
and error discriminant unchanged, plus these additive fields:
`MessageBrief.goalId?`, and the new `GoalBrief.status` values listed in
§1.1.

**How `1` is still served.** The server accepts both `1` and `2`:

- A request pinned `1` for any command that survived unchanged is
  answered exactly as before. An old SOP that never used Goal keeps
  running without edits.
- A request pinned `1` for the new goal family (`goal.*`) gets
  `unknown_command` — the family does not exist in the `1` view. The
  CLI refuses the same combination locally (`--schema=1 goal …` → exit 2,
  `schema_mismatch:`).
- The retired v1 goal commands are `unknown_command` under every
  version. There is no `1`-view that still runs hive / solo.

This is not two contracts served side by side: no command has two
meanings. It is "removed" spelled honestly as "not found", so the
blast radius of the bump is exactly the callers that used the retired
family.

Migrating a v1 goal SOP: `goal propose` + `goal run` → `goal start
<session-id> "<objective>" [--budget-minutes=N]`; `goal status` keeps
its name but returns `{goal}` only; `goal active` lists open goals
(there can be more than one, one per session); `goal stop` is immediate
(no wrap-up). Task / event / deliverable commands have no successor —
the goal's session thread is the record.

### 7.2 `schemaVersion: 1` (frozen, served for unchanged commands)

Introduced in v0.2, unchanged through v0.3.x and v0.4.x. Additions that
landed under it: `session wait` (with `--after-turn` and the
`session_error` / `session_cancelled` statuses), `session follow`,
`project brief / show / follow`, `dispatch: "queued"` + `--jump` on
`session send`, and the CLI-attached `live` run-state field on
`sessions list` / `session brief` / `status`. The v1 `goal` surface also
landed here and is the part `2` retired.

### 7.3 Rules inside a major

Inside the current major:

- Adding a new command, flag, or output field is **non-breaking**.
- Adding a new value to a string enum (status, error, health status,
  …) is **non-breaking** — agents must handle unknown values
  gracefully (default branch).
- Adding a new error discriminant on the socket transport is
  **non-breaking**. (`not_implemented` remains reserved-but-unemitted;
  a first emitter would be such an additive change.)
- Adding the v1-additive `detail` object to error envelopes is
  **non-breaking** — parsers that read `error` + `message` keep
  working.
- Removing or renaming a command / flag / field / enum value is
  **breaking**. Don't.

At the next major (`3`):

- A breaking change can ship.
- The same policy applies: the previous pin keeps answering every
  command that did not change; commands that did are `unknown_command`
  under the old pin. No dual semantics.

`galley version` returns the schema version the CLI binary speaks by
default (`2`). The socket `version` command returns the server's
default. The accepted set is `{1, 2}` on both ends and is documented
here, not exposed as a field.
