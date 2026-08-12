# Agent API — Stability & Versioning

> Part of the [Galley Agent API](./README.md) contract. Stability rules, stable identifier sets, schema pinning, and versioning policy.

## 1 · Stability

The CLI output schema **and the socket wire format** are both part of
Galley's public contract — supervisor agents and Skills depend on
them. We commit to the rules in
[AGENTS.md "CLI Surface Is Public Contract"](../../AGENTS.md).

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
| `not_implemented`  | exit 1      | Reserved — no emitter exists today; do not expect it |
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
| `session send`                   | `dispatched` / `persisted_only` / `queued` (additive since v0.4.6-dev; mid-run sends hold in Core's in-memory queue — see session-commands §5.5a) |
| `session new`                    | `dispatched` (exit 5 if runner cannot start/send)  |
| `session btw`                    | `dispatched` (only — exit 5 on no bridge)          |
| `session stop`                   | `abort_sent` / `already_stopped`                   |
| `llm set`                        | `dispatched` / `persisted_only`                    |

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

## 7 · Versioning

`schemaVersion: 1` is **frozen** — introduced in v0.2, unchanged
through every release since (v0.3.x included). The rules in §1 apply.

Inside `schemaVersion: 1`:

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

Inside a future `schemaVersion: 2`:

- A breaking change can ship.
- Both the CLI (`--schema=1`) and the socket (`schemaVersion` in the
  request) will support opting back into the v1 view; old SOPs keep
  working until they choose to migrate.

`galley version` returns the schema version the CLI binary is willing
to speak. The socket `version` command returns the server's accepted
schema version. Future binaries that speak multiple versions will
expose this as an array.
