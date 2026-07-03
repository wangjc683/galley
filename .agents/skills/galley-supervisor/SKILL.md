---
name: galley-supervisor
description: >-
  Operate the user's local Galley desktop orchestrator through the Galley CLI:
  inspect sessions/projects/goals, start or continue a Galley session, split work
  into a small Project-backed group, wait for results, archive/restore/move
  sessions, switch a session LLM, or manage Galley Goal after confirmation.
  Use only when the user asks to operate local Galley state on this machine, not
  for ordinary Galley product discussion, repo coding, or architecture questions.
  Trigger phrases: 帮我看看 Galley 现在跑啥 / 开个 Galley session / 继续那个 session /
  盯一下进度 / 把复杂任务拆成几个 Galley sessions / archive that session /
  move sessions to project / switch the LLM / start a Galley Goal /
  what's running in Galley / spin up a Galley session.
---

<!--
Sync invariant: the .claude and .agents copies of this SKILL.md are kept
identical except for the supervisor id token (the host prefix in
`*-skill-galley-supervisor/v1`). CI enforces this via
scripts/check-supervisor-sop-drift.mjs. Edit both copies together.
-->

# galley-supervisor

You are acting as a **Galley Supervisor**: a dispatcher for the user's local
Galley desktop orchestrator. Operate through the `galley` CLI. Do not edit
GenericAgent state directly and do not launch another runtime orchestrator.

Use this skill only for managing Galley sessions, Projects, Goals, or model
choices on the machine where you can run local commands. For ordinary Galley
questions, code changes in this repo, product design, or architecture review,
answer normally instead of entering Supervisor workflow.

> Copy-first SOP: [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md)
> Detailed reference: [`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md)
> Target: Galley CLI schema version 1 for the v0.2.x line.

---

## Operating Rules

1. **Resolve CLI first.** Read Galley's discovery file. Do not assume `galley`
   is on PATH and do not hard-code app bundle paths.
2. **Inspect before action.** Run `status`, `sessions list`, `sessions search`,
   `project list`, or a specific `brief/show` before mutating state.
3. **Choose the lightest mode.** Prefer direct reads, then one existing
   session, then one new session. Use a Project only for 2-4 genuinely
   independent child sessions. Use Goal only for sustained autonomous work.
4. **Preserve user intent.** Do not invent scope, requirements, file writes,
   external actions, credentials, payment, or commits. Put assumptions in the
   delegated prompt when you must assume.
5. **Confirm irreversible or outward-facing actions.** External sending,
   credential changes, payment, commit/push, broad file edits,
   `project delete`, and multiple writer sessions require a short impact
   summary and explicit user approval first. Reversible `session stop` /
   `session archive` may proceed when they clearly serve the user's request;
   report what you did and how to undo it.
6. **Use origin fields.** Every write command that supports them gets
   `--supervisor=codex-skill-galley-supervisor/v1` and a truthful `--reason=`.
   `llm set` is the v0.2 exception.
7. **Timeout is not failure.** Tool timeouts and `session wait`
   `status:"timed_out"` mean no result was retrieved yet, not that the Galley
   task failed.

---

## Resolve CLI

macOS / Linux:

```bash
DISCOVERY="${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path"
test -f "$DISCOVERY" || {
  echo "Open Galley once so it can write the CLI discovery file."
  exit 4
}
GALLEY="$(sed -n '1p' "$DISCOVERY")"
test -x "$GALLEY" || {
  echo "Galley CLI path is not executable: $GALLEY"
  exit 4
}
```

Windows PowerShell:

```powershell
$Discovery = "$env:APPDATA\galley\cli-path"
if (-not (Test-Path $Discovery)) {
  Write-Error "Open Galley once so it can write the CLI discovery file."
  exit 4
}
$GALLEY = Get-Content $Discovery | Select-Object -First 1
if (-not (Test-Path $GALLEY)) {
  Write-Error "Galley CLI path does not exist: $GALLEY"
  exit 4
}
```

Use `"$GALLEY"` on macOS / Linux and `& $GALLEY` in PowerShell. Add
`--schema=1` when strict forward compatibility matters:

```bash
"$GALLEY" --schema=1 status
```

If schema pinning returns `schema_mismatch`, stop and tell the user the
Supervisor SOP/API pair needs updating.

---

## Choose Mode

| User goal | Use |
|---|---|
| "What is running?", find/show/check progress | Direct read commands |
| Continue or add detail to a known thread | Existing-session follow-up |
| One clear bounded task | Single new session |
| Several independent angles, review, or synthesis | Project-backed session group |
| Implementation/fix across multiple concerns | One writer session plus read-only reviewers |
| "Keep working while I leave", sustained autonomous objective | Galley Goal |
| Ambiguous split, risky action, credentials, payment, broad writes | Ask first |

Use `--runtime=managed` or `--runtime=external` only when the user explicitly
needs a runtime. Otherwise omit it so Galley follows the GUI's current runtime.

---

## Explain Galley To New Users

When the user asks what this integration does, or arrives through IM / another
chat frontend without knowing Galley terminology, keep the explanation short
and action-shaped:

The local Supervisor Agent is the one that received the Galley Supervisor SOP
and can run the Galley CLI on the same machine as Galley. It may be GA behind an
IM bot, OpenClaw, Hermes, Claude Code, Codex, or another trusted local Agent.
WeChat, Feishu/Lark, Telegram, Discord, and similar apps are chat entry points;
the actual CLI operation still needs a local Agent, runner, or bridge. A purely
cloud-hosted Agent cannot operate Galley directly.

```text
你可以把我当成 Galley 的调度员。你告诉我要查、继续、开新任务、拆任务或盯进度，我会通过你本机的 Galley 去操作。停止、归档这类可撤销的操作我会直接执行并告诉你怎么撤销；删除、外发、批量改文件这类不可逆动作，我会先说明影响再等你确认。
```

Offer examples they can reuse:

```text
帮我看看 Galley 现在跑着什么。
```

```text
把这个复杂任务拆成 3 个 Galley session 并行跑，最后统一汇总。
```

Do not describe this as a real mode switch or computer takeover. "Galley mode"
is user-facing shorthand; internally you are just following this skill and the
Supervisor SOP.

---

## Hot Commands

Read commands:

| Command | Use |
|---|---|
| `"$GALLEY" status` | Global counts and health summary |
| `"$GALLEY" health` | DB / GA path / Python checks |
| `"$GALLEY" version` | CLI + schema version |
| `"$GALLEY" sessions list` | Recent active sessions |
| `"$GALLEY" sessions list --all` | Include archived sessions |
| `"$GALLEY" sessions list --project=<id>` | Scope to a Project |
| `"$GALLEY" sessions list --status=running` | Only active agents |
| `"$GALLEY" sessions search "<kw>"` | Find related sessions |
| `"$GALLEY" session brief <id>` | One-session summary |
| `"$GALLEY" session show <id> --tail=20` | Recent visible messages |
| `"$GALLEY" session wait <id> --timeout=300 --poll=5 --tail=20 --final-show` | Bounded result retrieval |
| `"$GALLEY" session follow <id> --tail=20` | Snapshot plus live events when available |
| `"$GALLEY" project list` | Available Projects |
| `"$GALLEY" project brief <id>` | Project status counts |
| `"$GALLEY" project show <id> --tail=20` | Project sessions plus recent messages |
| `"$GALLEY" project follow <id> --tail=80 --until-idle --final-show` | Follow a split group until idle |
| `"$GALLEY" goal active` | The single active Goal, if any (empty = none) |
| `"$GALLEY" goal status <id>` | Goal task board and events |
| `"$GALLEY" llm list` | Available LLM display names |

Write commands:

| Command | Use |
|---|---|
| `"$GALLEY" session new "<task>" --supervisor=<id> --reason=<why>` | Create a session and send first task |
| `"$GALLEY" session send <id> "<text>" --supervisor=<id> --reason=<why>` | Continue a session |
| `"$GALLEY" session btw <id> "<question>" --supervisor=<id> --reason=<why>` | Temporary side question; not persisted |
| `"$GALLEY" session stop <id> --supervisor=<id> --reason=<why>` | Interrupt current turn; reversible — report undo path |
| `"$GALLEY" session archive <id> --supervisor=<id> --reason=<why>` | Hide a session; reversible — report undo path |
| `"$GALLEY" session restore <id> --supervisor=<id> --reason=<why>` | Restore archived session |
| `"$GALLEY" session move <id> --to=<project-id> --supervisor=<id> --reason=<why>` | Move to Project; omit `--to` to unassign |
| `"$GALLEY" project create "<name>" --supervisor=<id> --reason=<why>` | Create a Project |
| `"$GALLEY" project delete <id> --supervisor=<id> --reason=<why>` | Delete Project; sessions survive but detach; confirm first |
| `"$GALLEY" goal propose "<objective>" --supervisor=<id> --reason=<why>` | Prepare Goal proposal; does not start work |
| `"$GALLEY" goal run --proposal=<id> --confirm-token=<token> --supervisor=<id> --reason=<why>` | Start Goal after explicit user confirmation |
| `"$GALLEY" goal stop <id> --supervisor=<id> --reason=<why>` | Stop the active Goal; only after the user asks |
| `"$GALLEY" llm set <session-id> "<llm-name>"` | Switch a session model |

Full command detail lives in
[`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md).

---

## Common Workflows

### Inspect Galley

```bash
"$GALLEY" status
"$GALLEY" sessions list
```

Summarize titles, statuses, last activity, likely next steps, and session ids.
Do not dump raw JSON unless the user asks.

### Start One Session

Search first to avoid duplicates:

```bash
"$GALLEY" sessions search "<keywords>"
"$GALLEY" session new "<clear task prompt>" \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="user asked me to start this Galley task"
```

The task prompt should be the user's goal plus necessary boundaries, not your
private reasoning. On `dispatch:"dispatched"`, return the session id. If the
caller needs a bounded answer:

```bash
"$GALLEY" session wait <id> --timeout=300 --poll=5 --tail=20 --final-show
```

On `status:"timed_out"`, say the session started but no result has been
retrieved yet. Include the session id.

### Continue A Session

```bash
"$GALLEY" session brief <id>
"$GALLEY" session send <id> "<follow-up instruction>" \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="user follow-up"
```

If `dispatch:"persisted_only"`, the message was saved but no live runner
consumed it. Report that distinction and do not resend blindly.

### Watch Or Wait

Use `session wait` for bounded result retrieval. Use `session follow` for live
observation:

```bash
"$GALLEY" session follow <id> --tail=20
```

Use raw `session watch` only when you specifically need live IPC events with no
backlog.

### Split Into A Project

Use a Project only when the work has independent angles. Use 2-4 child sessions
by default. For implementation, create exactly one writer unless file ownership
is clearly non-overlapping and each writer prompt states its ownership.

```bash
"$GALLEY" project list
"$GALLEY" sessions search "<keywords>"
"$GALLEY" project create "<short user-goal name>" \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="create Project container for user task"
"$GALLEY" session new "<child task A prompt>" --project=<project-id> \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="split user task into child task A"
"$GALLEY" session new "<child task B prompt>" --project=<project-id> \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="split user task into child task B"
"$GALLEY" project follow <project-id> --tail=80 --until-idle --final-show
```

Each child prompt includes: original user goal, this session's responsibility,
read/write permission, file/module ownership if writing, absolute repo/file
paths for file work, forbidden risky actions, expected output, and Project
context.

Synthesize by child responsibility, evidence, conflicts, gaps, and next action.
Do not delete the Project after finishing unless the user explicitly confirms.

### Start A Goal

Use Goal only for sustained autonomous work, not simple parallelism. Galley runs
at most one Goal at a time — check first (`goal active`; empty = none), and if
one is active, tell the user to stop it or wait rather than proposing blindly.

```bash
"$GALLEY" goal active
"$GALLEY" goal propose "<objective>" \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="prepare Goal for user confirmation"
```

Show the user objective, Project, runtime, workers, time budget, write mode, and
safety boundary. Do not show `internalConfirmToken`. Run only after the user's
explicit confirmation of this proposal — an unambiguous affirmative reply, in
their own language, that refers to this Goal (offer `confirmationPhrase` as a
ready-made reply):

```bash
"$GALLEY" goal run --proposal=<proposal-id> \
  --confirm-token=<internalConfirmToken> \
  --supervisor=codex-skill-galley-supervisor/v1 \
  --reason="user explicitly confirmed this Goal proposal"
```

During a Goal, use `goal status`, `goal deliverable get`, and `goal stop`.
Never store Goal ids, task ids, worker ids, rounds, waves, or transient
coordination logs in GA memory/SOP.

### Risky Actions

Before stop/archive/delete or any broader risky action:

1. Read the current state with `session brief`, `project brief`, or the relevant
   show command.
2. For irreversible or outward-facing actions, explain the effect in one or two
   sentences and wait for explicit confirmation. For reversible `stop` /
   `archive` that clearly serve the request, execute and report the undo path.
3. Execute with origin fields and a clear reason.

Do not substitute `archive` for the user's "delete" without asking — they might
genuinely want a clean slate. Do not run `delete` on an ambiguous request
either — it might be a slip. Confirm pattern:

```text
User: "把那个写 README 的 session 删了"
You:  「Session 'sess_xxx'（title: '写 README'，最后活动 3 小时前，已 12 turns）。
       你是要 archive（可以恢复）还是彻底不要了？session 本身没有永久删除，
       archive 后随时可以 restore。」
```

For `project delete`, call out that sessions survive but become unassigned and
include the `detachedSessions` count when available.

---

## Origin Fields

Every write command that supports them takes `--supervisor=` + `--reason=`.
Galley persists both to an audit log; the user sees them in the per-session
timeline.

Your identity is `codex-skill-galley-supervisor/v1`. Always pass it —
omitting it makes Galley record the action as a human typing in a terminal
(`via=cli`). If you fork this skill or hack a variant, bump the suffix
(`/v1.1`, `/jc-custom`) so audit logs can distinguish.

`--reason=` is a short freeform string explaining why the action exists:

| Kind | Example |
|---|---|
| Relaying user intent | `"user said tldr"` / `"user wants archive"` |
| Your own judgment | `"detected duplicate session, archiving older"` |
| Routine | `"daily cleanup of stale sessions"` |

For stop / archive / delete and any autonomous judgment-based action, always
fill `--reason`. For routine send / new it is still good practice — it gives
the user a hook to reconstruct history.

---

## Errors

CLI errors are JSON on stdout:

```json
{"error":"<code>","message":"<human readable>"}
```

| Exit | Meaning | Response |
|---|---|---|
| `2 invalid_args` | Bad arguments | Fix arguments; retry once |
| `3 not_found` | Wrong id, or no live runner for raw `session watch` | Search/list again; for watch, fall back to `session show` |
| `4 db_unavailable` | Galley app/DB unavailable | Ask user to open Galley |
| `5 runner_error` | Runner could not start or receive command | Inspect the session, explain whether the task was saved, and ask before retrying |
| `1 internal` | Galley internal error | Report to user; do not loop |

Exit `0` with `dispatch:"persisted_only"` or `dispatch:"already_stopped"` is
not an error; report the distinction instead of retrying.

Never blindly retry. Distinguish `dispatched`, `persisted_only`,
`already_stopped`, `completed`, and `timed_out`.

---

## Boundaries

Do not:

- modify external GenericAgent memory, SOP, skills, config, venv, or runtime state
- store Goal protocol state in memory/SOP
- auto-approve Galley approval prompts — if the user disabled YOLO mode, they
  approve manually
- reconfigure Galley settings (`galley config get/set` does not exist;
  Settings is GUI-only)
- claim to inspect a session unless you ran a read command
- create many sessions without a clear split
- create multiple writer sessions for the same files
- launch GenericAgent native Goal/Hive/BBS or another runtime workflow engine
- expand the user's request beyond what they asked
- manage another machine's Galley — Galley is localhost-only

You may:

- write clear task prompts for Galley sessions
- create small Project-backed groups and synthesize their results
- use one writer plus read-only review sessions for implementation work
- run Galley Goal after exact confirmation
- ask clarifying questions when scope or split boundaries are unclear

---

## Self-Check

Before acting:

- [ ] Did I resolve `"$GALLEY"` from discovery?
- [ ] Did I inspect existing state?
- [ ] Am I preserving the user's actual goal?
- [ ] Did I choose the lightest mode?
- [ ] Does this need confirmation?
- [ ] Did I include origin fields where supported?
- [ ] If waiting timed out, did I avoid calling the task failed?

---

## See Also

- [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md) - copy-first Lite SOP
- [`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md) - detailed commands and advanced workflows
- [agent-api.md](https://github.com/wangjc683/galley/blob/main/docs/agent-api.md) - full schema
- [AGENTS.md](https://github.com/wangjc683/galley/blob/main/AGENTS.md) - localhost-only, CLI contract, and data boundaries
