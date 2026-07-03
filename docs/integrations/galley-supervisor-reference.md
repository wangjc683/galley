# Galley Supervisor Reference

This is the detailed reference for people maintaining or auditing the
[Galley Supervisor SOP](./galley-supervisor-sop.md). The SOP is the copy-first
document shown in Settings and should stay short. This reference can be longer.

Status: v0.2.0. Agent API schema: 1.

## Operating Model

Galley is a local agent-session orchestrator. Supervisor agents should operate
through the Galley CLI and let Rust Galley Core remain authoritative for
session lifecycle, command dispatch, SQLite writes, Projects, Goals, and runner
ownership.

The Supervisor's job is to select the lightest orchestration mode that preserves
the user's intent:

| Goal shape | Mode |
|---|---|
| Inspect current state, find a session, show progress | Direct read commands |
| Add one requirement to one known thread | Existing-session follow-up |
| One bounded task with one obvious owner | Single new session |
| Independent angles, evidence gathering, review, or synthesis | Project-backed session group |
| Sustained autonomous objective | Galley Goal |
| Implementation or fixes with multiple concerns | Single writer plus read-only reviewers |
| Destructive, external, credential, payment, or ambiguous work | Ask or narrow first |

Do not expose "Project batch" as a user-facing product term. Say "I will split
this into a few Galley sessions under one Project."

Do not launch GenericAgent native `/hive`, GA BBS, `agent_bbs.py`, or another
runtime's workflow engine from this SOP. Galley Core is the orchestration layer.

## CLI Discovery

Always resolve the CLI from the discovery file before command execution.

macOS / Linux:

```bash
DISCOVERY="${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path"
if [ ! -f "$DISCOVERY" ]; then
  echo "I cannot find Galley's discovery file. Please open Galley once so it can write the CLI path, then ask me again."
  exit 4
fi
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
  Write-Error "I cannot find Galley's discovery file. Please open Galley once so it can write the CLI path, then ask me again."
  exit 4
}
$GALLEY = Get-Content $Discovery | Select-Object -First 1
if (-not (Test-Path $GALLEY)) {
  Write-Error "Galley CLI path does not exist: $GALLEY"
  exit 4
}
```

Use `"$GALLEY"` on macOS / Linux and `& $GALLEY` in PowerShell.

When strict forward compatibility matters, pin schema v1:

```bash
"$GALLEY" --schema=1 status
```

If the pin returns `schema_mismatch`, stop and tell the user the SOP/API pair
needs an update before continuing.

## Command Cheatsheet

Full schema: [agent-api](../agent-api.md). Commands support `--help`.

Read commands:

| Command | Use |
|---|---|
| `"$GALLEY" status` | Global counts and health summary |
| `"$GALLEY" sessions list` | Recent active sessions in the current runtime |
| `"$GALLEY" sessions list --all` | Include archived sessions in the current runtime |
| `"$GALLEY" sessions list --runtime all` | Cross-runtime listing when explicitly needed |
| `"$GALLEY" sessions list --status=running` | Active agent work |
| `"$GALLEY" sessions search "<kw>"` | Find related conversations in the current runtime |
| `"$GALLEY" sessions search "<kw>" --runtime all` | Cross-runtime search when explicitly needed |
| `"$GALLEY" session brief <id>` | One-session summary |
| `"$GALLEY" session show <id> --tail=20` | Recent visible messages |
| `"$GALLEY" session wait <id> --timeout=300 --poll=5 --tail=20 --final-show` | Bounded result retrieval |
| `"$GALLEY" session follow <id> --tail=20` | Snapshot, live events if available, final snapshot |
| `"$GALLEY" session watch <id>` | Raw live runner events; no backlog |
| `"$GALLEY" project list` | Available Projects |
| `"$GALLEY" project brief <id>` | Project status counts and running sessions |
| `"$GALLEY" project show <id> --tail=20` | Project sessions plus transcript tails |
| `"$GALLEY" project follow <id> --tail=10 --until-idle --final-show` | Follow Project group until child sessions are idle |
| `"$GALLEY" goal status <id>` | Goal task board, events, Project sessions |
| `"$GALLEY" goal deliverable get <id>` | Current-best Goal deliverable anchor |
| `"$GALLEY" llm list` | Available LLM display names |
| `"$GALLEY" health` | Troubleshooting |

Write commands:

| Command | Use |
|---|---|
| `"$GALLEY" session new "<task>" --supervisor=<id> --reason=<why>` | Create a session and send the first task |
| `"$GALLEY" session send <id> "<text>" --supervisor=<id> --reason=<why>` | Send follow-up to a session |
| `"$GALLEY" session btw <id> "<question>" --supervisor=<id> --reason=<why>` | Ask a temporary side question; not persisted |
| `"$GALLEY" session stop <id> --supervisor=<id> --reason=<why>` | Interrupt current turn |
| `"$GALLEY" session archive <id> --supervisor=<id> --reason=<why>` | Hide a session; reversible |
| `"$GALLEY" session restore <id> --supervisor=<id> --reason=<why>` | Restore archived session |
| `"$GALLEY" session move <id> --to=<project-id> --supervisor=<id> --reason=<why>` | Move session to Project; omit `--to` to unassign |
| `"$GALLEY" project create "<name>" --supervisor=<id> --reason=<why>` | Create a Project |
| `"$GALLEY" project delete <id> --supervisor=<id> --reason=<why>` | Delete Project; sessions survive but become unassigned |
| `"$GALLEY" goal propose "<objective>" --supervisor=<id> --reason=<why>` | Prepare pending Goal; does not start work |
| `"$GALLEY" goal run --proposal=<id> --confirm-token=<token> --supervisor=<id> --reason=<why>` | Start blocking Goal controller after exact user confirmation |
| `"$GALLEY" goal stop <id> --supervisor=<id> --reason=<why>` | Request graceful Goal stop |
| `"$GALLEY" goal deliverable set <id> "<content>" --note="<summary>" --author-session=<session-id>` | Append current-best Goal deliverable |
| `"$GALLEY" llm set <session-id> "<llm-name>"` | Switch a session's LLM |

## Result Retrieval

Use `session wait` for Supervisor/IM result retrieval:

```bash
"$GALLEY" session wait <id> --timeout=300 --poll=5 --tail=20 --final-show
```

Output is NDJSON:

```json
{"schemaVersion":1,"stream":"wait","phase":"initial","session":{},"messages":[]}
{"schemaVersion":1,"stream":"wait","phase":"final","status":"completed","session":{},"messages":[]}
{"schemaVersion":1,"stream":"end","reason":"completed"}
```

or:

```json
{"schemaVersion":1,"stream":"wait","phase":"final","status":"timed_out","session":{},"messages":[]}
{"schemaVersion":1,"stream":"end","reason":"timeout"}
```

`timed_out` is the waiter's deadline, not task failure. If the tail contains
only the user's message, tell the user the session started but no agent result
has been retrieved yet. Include the session id so they can ask again.

Use `session follow` and `project follow` for live observation. They may run
longer than the calling tool's timeout and should not be the final verdict for
long IM tasks.

## Project-Backed Session Groups

A Project-backed group is a workflow pattern: create or reuse one Galley
Project, create 2-4 child sessions inside it, follow until idle, then synthesize
the results.

Recommended loop:

1. Search for related sessions/Projects.
2. Create or reuse one Project.
3. Create 2-4 independent child sessions.
4. Follow with `project follow --until-idle --final-show`.
5. Synthesize evidence, conflicts, gaps, and next actions.
6. If necessary, create at most 1-2 follow-up sessions in the same Project.

Example:

```bash
"$GALLEY" project create "Release readiness review" \
  --supervisor=my-agent/v1 \
  --reason="create Project container for release readiness review"

"$GALLEY" session new "User goal: assess release upgrade readiness. This child session checks app identity, data directory, SQLite migrations, and backup behavior. Do not change files. Output: concise risk list with evidence." \
  --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="split release readiness review into data compatibility work"

"$GALLEY" session new "User goal: assess release upgrade readiness. This child session checks packaging, release workflow, bundled resources, and version bump requirements. Do not change files. Output: release blocker checklist." \
  --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="split release readiness review into packaging work"

"$GALLEY" project follow <project-id> --tail=80 --until-idle --final-show
```

If the user explicitly wants the Project bound to a folder:

```bash
"$GALLEY" project create "<short user-goal name>" \
  --root-path="<absolute repo root>" \
  --enable-workspace \
  --supervisor=my-agent/v1 \
  --reason="create Project workspace for user task"
```

Child prompts should still include absolute repo roots and important absolute
file paths. Existing runners do not hot-swap Workspace, and external GA may
skip Workspace if safe state-root support is unavailable.

Do not delete the Project after finishing. Users can inspect group history in
Galley. Archiving sessions or deleting Projects requires confirmation.

## Implementation Splits

For implementation or fix requests, prefer single writer, multiple reviewers:

```bash
"$GALLEY" project create "<short user-goal name>" \
  --supervisor=my-agent/v1 \
  --reason="create project for implementation plus review"

"$GALLEY" session new "User goal: <goal>. This is the only writer session in this Project. Implement the requested change. Own only these files/modules: <ownership>. Output: files changed, tests run, residual risk." \
  --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="delegate implementation as the single writer"

"$GALLEY" session new "User goal: <goal>. This is a read-only review session in the same Project. Do not change files. Review the implementation area for risks, missing tests, and user-facing regressions. Output: findings with evidence." \
  --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="delegate read-only verification"
```

Create multiple writer sessions only when ownership is non-overlapping and
explicit in every child prompt.

## Goal V1

Galley Goal is for longer autonomous runs. Do not use Goal just because a task
has two obvious subtasks.

Proposal:

```bash
"$GALLEY" goal propose "<objective>" \
  --supervisor=my-agent/v1 \
  --reason="prepare Goal for user confirmation"
```

Show the user a short confirmation summary: objective, Project, runtime,
workers, time budget, write mode, and safety boundary. Do not show
`internalConfirmToken`.

Run only after the user's explicit confirmation of this proposal — an
unambiguous affirmative reply, in their own language, that refers to this
Goal (offer `confirmationPhrase` as a ready-made reply):

```bash
"$GALLEY" goal run --proposal=<proposal-id> \
  --confirm-token=<internalConfirmToken> \
  --supervisor=my-agent/v1 \
  --reason="user explicitly confirmed this Goal proposal"
```

During a Goal:

```bash
"$GALLEY" goal status <goal-id>
"$GALLEY" goal stop <goal-id> --supervisor=<id> --reason=<why>
"$GALLEY" goal deliverable get <goal-id>
```

Goal worker protocol is Core-owned. Do not store Goal ids, task ids, worker
session ids, rounds, waves, or transient coordination logs in GA memory/SOP.

Attach/external GA safety is strict: external GA only participates through
ordinary Galley child-session prompts and the Galley Goal CLI protocol. Managed
GA may keep durable reusable learnings through normal managed memory/SOP
self-evolution, but not transient Goal protocol state.

## User-Facing Copy

When the user is new to Galley or arrives through IM, explain briefly:

```text
你可以把我当成 Galley 的调度员。你告诉我要查、继续、开新任务、拆任务或盯进度，我会通过你本机的 Galley 去操作。停止、归档、删除、批量改文件这类高风险动作，我会先说明影响再等你确认。
```

English:

```text
You can treat me as your Galley dispatcher. Tell me what to inspect, continue, start, split, or monitor, and I will use Galley on your machine to manage the local Agent sessions. I will ask before risky actions such as stopping, archiving, deleting, or broad file changes.
```

Good prompts users can say:

```text
帮我看看 Galley 现在跑着什么。
继续最近那个发布检查 session，补充要求：重点看 updater。
开一个 Galley session，检查这个 repo 的测试失败原因。先不要改文件，只给结论。
把这个复杂任务拆成 3 个 Galley session 并行跑，分别检查数据、打包、UI，最后统一汇总。
```

Do not present "Galley mode" as a real system mode or computer takeover. It is
user-friendly language for this Supervisor workflow.

## Origin Fields

Use a stable supervisor id:

- Generic agent: `my-agent/v1`
- IM bot: `ga-wechat-bot` / `ga-feishu-bot`
- Claude Skill: `claude-skill-galley-supervisor/v1`

Use a short reason in the user's words or an honest paraphrase:

```bash
--supervisor=my-agent/v1 \
--reason="user asked me to compare upgrade risks"
```

Reasons matter because Galley surfaces supervisor-origin actions in GUI/audit
views.

## Error Recovery

CLI errors are JSON on stdout:

```json
{"error":"<code>","message":"<human readable>"}
```

| Exit | Meaning | Response |
|---|---|---|
| `2 invalid_args` | Bad arguments | Fix arguments; retry once |
| `3 not_found` | Wrong id, or no live runner for raw `session watch` | Run list/search again; for watch, fall back to `session show` |
| `4 db_unavailable` | Galley app/DB unavailable | Ask user to open Galley |
| `5 runner_error` | Runner could not start or receive command | Inspect the session, explain the task did not start, and ask before retrying |
| `1 internal` | Galley internal error | Report to user; do not loop |

Never blindly retry.

`session send` and `llm set` can return `dispatch:"persisted_only"`: the DB
write succeeded but no live runner consumed the command.

`session stop` can return `dispatch:"already_stopped"`: this is success.

`session wait` can return `status:"timed_out"`: the waiter timed out; the task
may still finish later.

## Boundaries

Do not:

- modify external GA memory, SOP, skills, config, venv, or runtime state
- store Goal protocol state in memory/SOP
- auto-approve Galley approval prompts
- pretend to inspect a session without a read command
- create many sessions without a clear split
- create multiple writer sessions for the same files
- launch GA native Goal/Hive/BBS or another runtime workflow engine
- expand the user's request beyond what they asked
- manage another machine's Galley

You may:

- write clear task prompts for Galley sessions
- split work into parallel sessions
- create small Project-backed groups and synthesize their results
- create and run Galley Goal after exact confirmation
- ask clarifying questions when the split is uncertain
- summarize and merge results for the user

## Maintenance Notes

Keep [galley-supervisor-sop.md](./galley-supervisor-sop.md) short enough to copy
into an IM/GA/Claude-style agent without drowning the live turn in reference
material. Put long command examples and rationale here.

If this reference or SOP conflicts with [agent-api](../agent-api.md), follow
`agent-api.md`; the API schema is the contract.
