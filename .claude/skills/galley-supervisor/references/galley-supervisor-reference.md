<!--
This file is a verbatim copy of docs/integrations/galley-supervisor-reference.md
shipped inside the galley-supervisor Claude Skill for advanced command and
workflow details.

CANONICAL SOURCE: docs/integrations/galley-supervisor-reference.md in the
github.com/wangjc683/galley repository.

Last synced: 2026-09-16 (Goal v2: `goal start / status / active / stop / extend`, schemaVersion 2, `--schema=2` guard, open / terminal goal statuses).

If you find divergence between this copy and the canonical file, the
canonical version wins.
-->

# Galley Supervisor Reference

This is the detailed reference for people maintaining or auditing the
[Galley Supervisor SOP](./galley-supervisor-sop.md). The SOP is the copy-first
document shown in Settings and should stay short. This reference can be longer.

Target: Agent API `schemaVersion: 1` (frozen since `v0.2`, additive-only; this text
reflects the CLI surface on `main` as of the review date). Last reviewed:
2026-09-09.

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
| One objective the agent should keep pushing on its own until done | Galley Goal (one session, auto-continues) |
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

Full schema: [agent-api](../agent-api/README.md). Commands support `--help`.

Read commands:

| Command | Use |
|---|---|
| `"$GALLEY" status` | Persisted counts plus `live.busy` / `live.queued` totals when Core is reachable |
| `"$GALLEY" sessions list` | Recent active sessions in the current runtime; each row carries `live` when Core is reachable |
| `"$GALLEY" sessions list --all` | Include archived sessions in the current runtime |
| `"$GALLEY" sessions list --runtime all` | Cross-runtime listing when explicitly needed |
| `"$GALLEY" sessions search "<kw>"` | Find related conversations in the current runtime |
| `"$GALLEY" sessions search "<kw>" --runtime all` | Cross-runtime search when explicitly needed |
| `"$GALLEY" session brief <id>` | One-session summary with `turnCount` and `live` |
| `"$GALLEY" session show <id> --tail=20` | Recent visible messages |
| `"$GALLEY" session wait <id> --after-turn=<N> --timeout=600 --poll=5 --tail=20 --final-show` | Bounded result retrieval; `N` = the turn you just sent |
| `"$GALLEY" session follow <id> --tail=20` | Snapshot, live events if available, final snapshot |
| `"$GALLEY" session watch <id>` | Raw live runner events; no backlog |
| `"$GALLEY" project list` | Available Projects |
| `"$GALLEY" project brief <id>` | Project status counts and running sessions |
| `"$GALLEY" project show <id> --tail=20` | Project sessions plus transcript tails |
| `"$GALLEY" project follow <id> --tail=10 --until-idle --final-show` | Follow Project group until child sessions are idle |
| `"$GALLEY" goal status <id>` | One Goal: status, ceiling, elapsed, latest summary |
| `"$GALLEY" goal active` | Open Goals (active / paused / blocked); `[]` = none |
| `"$GALLEY" llm list` | Available LLM display names |
| `"$GALLEY" health` | Troubleshooting |

Write commands:

| Command | Use |
|---|---|
| `"$GALLEY" session new "<task>" --supervisor=<id> --reason=<why>` | Create a session and send the first task |
| `"$GALLEY" session send <id> "<text>" --supervisor=<id> --reason=<why>` | Send follow-up to a session; mid-run sends return `dispatch:"queued"` and run next |
| `"$GALLEY" session send <id> "<text>" --jump --supervisor=<id> --reason=<why>` | Interrupt the current task and run this message first; only on explicit user intent |
| `"$GALLEY" session btw <id> "<question>" --supervisor=<id> --reason=<why>` | Ask a temporary side question; not persisted |
| `"$GALLEY" session stop <id> --supervisor=<id> --reason=<why>` | Interrupt current turn |
| `"$GALLEY" session archive <id> --supervisor=<id> --reason=<why>` | Hide a session; reversible |
| `"$GALLEY" session restore <id> --supervisor=<id> --reason=<why>` | Restore archived session |
| `"$GALLEY" session move <id> --to=<project-id> --supervisor=<id> --reason=<why>` | Move session to Project; omit `--to` to unassign |
| `"$GALLEY" project create "<name>" --supervisor=<id> --reason=<why>` | Create a Project |
| `"$GALLEY" project delete <id> --supervisor=<id> --reason=<why>` | Delete Project; sessions survive but become unassigned |
| `"$GALLEY" goal start <session-id> "<objective>" --budget-minutes=60 --supervisor=<id> --reason=<why>` | Set a Goal on a session and dispatch its opening turn; `--no-budget` removes the ceiling |
| `"$GALLEY" goal stop <id> --supervisor=<id> --reason=<why>` | Stop a Goal now (aborts the current turn; no wrap-up) |
| `"$GALLEY" goal extend <id> --minutes=30 --supervisor=<id> --reason=<why>` | Give a Goal more time; reopens a `budget_limited` Goal and continues it |
| `"$GALLEY" llm set <session-id> "<llm-name>"` | Switch a session's LLM |

## Live State

Persisted `status` never reads `running`: Galley Core keeps transient run
state in memory, so SQLite only ever shows `idle`, `archived`, `error`, and
the like. The read commands therefore attach a `live` object whenever Galley
Core is reachable:

```json
{"id":"s-abc","status":"idle","turnCount":4,…,"live":{"runnerAlive":true,"agentRunning":true,"openRun":true,"queuedCount":0,"busy":true}}
```

- `busy` — `openRun || agentRunning || queuedCount > 0`; the one field to
  read for "is this session still working".
- `openRun` — a dispatched run has not completed yet (survives the gaps
  between multi-step turns; `agentRunning` flickers there).
- `queuedCount` — messages Galley is holding for this session.
- Absent `live` — Core unreachable (app closed, or the probe timed out); say
  so rather than guessing. An explicit idle `live` (all false / 0) is a real
  answer.

`status` carries `live.busy` (sessions currently busy) and `live.queued`
(messages waiting) totals under the same rule.

## Result Retrieval

Use `session wait` for Supervisor/IM result retrieval:

```bash
"$GALLEY" session brief <id>                       # read turnCount
"$GALLEY" session send <id> "<follow-up>" --supervisor=<id> --reason=<why>
"$GALLEY" session wait <id> --after-turn=<turnCount+1> --timeout=600 --poll=5 --tail=20 --final-show
```

`--after-turn=N` only counts agent messages with `turnIndex >= N`. On a
session that already has turns, a bare `send` → `wait` returns immediately
with the **previous** turn's answer, which is the single most common
Supervisor mistake. A freshly created session (`session new`) has no prior
answer, so `--after-turn` is optional there.

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

Two more terminal statuses end the wait early: `session_error` and
`session_cancelled` (the `end` frame's `reason` carries the same value). The
session itself entered `error` / `cancelled` and cannot produce the awaited
answer. Report that plainly, read `session show --tail=20` for the cause,
and ask before re-dispatching.

Keep `--timeout` at or below ~600 seconds. Longer blocking waits deafen an
IM Supervisor to new messages; past that window rely on the host's completion
reports (managed IM channels) or invite the user to ask again.

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
Galley. Deleting a Project requires confirmation; archiving child sessions is
reversible and may proceed when it clearly serves the request (report the
undo path).

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

## Goal

A Galley Goal is one persistent objective on one session (schemaVersion 2).
Once set, Galley Core re-prompts that session to keep working whenever it
goes idle, until the model declares the objective complete or blocked, the
time ceiling is reached, or the user stops it. There are no workers,
proposals, confirm tokens, task boards or deliverable anchors; the session's
thread is the record and the completing run's final answer is the result.

Do not use Goal just because a task has two obvious subtasks. Use it when
the user explicitly wants sustained autonomous work toward a verifiable end
state.

```bash
"$GALLEY" goal start <session-id> "<objective>" \
  --budget-minutes=60 \
  --supervisor=my-agent/v1 \
  --reason="user asked Galley to keep working on this until done"
```

- The session must be idle and carry no open Goal; otherwise
  `invalid_args` (wait with `session wait` / stop the open Goal). Sessions
  may each run their own Goal.
- `--budget-minutes` is a ceiling (default 60); `--no-budget` removes it.
  When it is reached the model gets one wrap-up turn and the Goal ends as
  `budget_limited` — distinct from failure.
- Summarize for the user: objective, session, ceiling, and that any message
  they send to the session steers the Goal.

During a Goal:

```bash
"$GALLEY" goal status <goal-id>
"$GALLEY" goal active
"$GALLEY" goal stop <goal-id> --supervisor=<id> --reason=<why>
"$GALLEY" goal extend <goal-id> --minutes=30 --supervisor=<id> --reason=<why>
```

Statuses: `active` / `paused` / `blocked` are open; `completed` /
`budget_limited` / `stopped` / `failed` are terminal (`budget_limited` can
be reopened with `goal extend` when the user wants more). `paused` follows a
stopped turn or a Galley restart; `blocked` follows a repeated blocker the
model reported (or a runtime error) — read `latestSummary`, get what it
needs from the user, and send that to the session: the next user-initiated
run resumes the Goal. `goal stop` is immediate.

Attach/external GA safety is unchanged: external GA only participates
through ordinary Galley session prompts. Goal state lives in Galley Core;
nothing about it is written to GA memory/SOP.

## User-Facing Copy

When the user is new to Galley or arrives through IM, explain briefly:

```text
你可以把我当成 Galley 的调度员。你告诉我要查、继续、开新任务、拆任务或盯进度，我会通过你本机的 Galley 去操作。停止、归档这类可撤销的操作我会直接执行并告诉你怎么撤销；删除、外发、批量改文件这类不可逆动作，我会先说明影响再等你确认。
```

English:

```text
You can treat me as your Galley dispatcher. Tell me what to inspect, continue, start, split, or monitor, and I will use Galley on your machine to manage the local Agent sessions. Reversible actions such as stopping or archiving a session I will do and tell you how to undo; before irreversible ones — deleting, publishing, broad file changes — I will explain the impact and wait for your go-ahead.
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
- Galley's managed IM channels: `galley-im/<platform>` (`galley-im/feishu`,
  `galley-im/discord/ch:<channel-id>`, …) — injected by Galley; the
  completion reporter filters on it, so never improvise a different one
- Claude Skill: `claude-skill-galley-supervisor/v1`; Codex Skill:
  `codex-skill-galley-supervisor/v1`

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

`session send` can return `dispatch:"queued"` with `message: null` and a
`queue` object: the session was mid-run, Galley holds the message in memory
and runs it in order once the current task completes. This is success — do
not resend. The queue does not survive a Galley restart; if the app was
restarted before the message ran, the user must re-issue it.

`session send` and `llm set` can return `dispatch:"persisted_only"`: the DB
write succeeded but no live runner consumed the command.

`session stop` can return `dispatch:"already_stopped"`: this is success.

`session wait` can return `status:"timed_out"`: the waiter timed out; the task
may still finish later. `status:"session_error"` / `"session_cancelled"`
mean the session died or was cancelled; see Result Retrieval.

`goal start` rejects a session that is mid-run or already has an open Goal
with `invalid_args` (the message names the open Goal); check `goal active`
or `session brief` first.

## Boundaries

Do not:

- modify external GA memory, SOP, skills, config, venv, or runtime state
- store Goal state in GA memory/SOP (Galley Core owns it)
- auto-approve Galley approval prompts
- pretend to inspect a session without a read command
- create many sessions without a clear split
- create multiple writer sessions for the same files
- launch GA native Goal/Hive/BBS or another runtime workflow engine
- ask a child session to notify the user itself (IM, email, push): sessions
  do the work; reporting belongs to the Supervisor and to Galley
- expand the user's request beyond what they asked
- manage another machine's Galley

You may:

- write clear task prompts for Galley sessions
- split work into parallel sessions
- create small Project-backed groups and synthesize their results
- start a Galley Goal after the user explicitly asks for autonomous work
- ask clarifying questions when the split is uncertain
- summarize and merge results for the user

## Maintenance Notes

Keep [galley-supervisor-sop.md](./galley-supervisor-sop.md) short enough to copy
into an IM/GA/Claude-style agent without drowning the live turn in reference
material. Put long command examples and rationale here.

The SOP text lives in five places that must agree: this repo's canonical
file, the Galley binary (embedded at build time for Settings → Agent "Copy
SOP" and the managed IM reference copy), and the two skill directories'
`references/` copies. `scripts/check-supervisor-sop-drift.mjs` fails CI when
a `references/` copy or the two `SKILL.md` variants drift; the binary embed
cannot drift. The managed IM entry-layer prompt
(`core/src/managed_prompt.rs`) restates the hard rules in its own words and
is guarded by unit tests for the rules that drifted once (reversibility
split, `--after-turn`, `queued`).

If this reference or SOP conflicts with [agent-api](../agent-api/README.md),
follow the Agent API; the schema is the contract.
