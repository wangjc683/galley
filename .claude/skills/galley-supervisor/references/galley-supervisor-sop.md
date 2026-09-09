<!--
This file is a verbatim copy of docs/integrations/galley-supervisor-sop.md
shipped inside the galley-supervisor Claude Skill so the skill stays
self-contained when installed at ~/.claude/skills/.

CANONICAL SOURCE: docs/integrations/galley-supervisor-sop.md in the
github.com/wangjc683/galley repository.

Last synced: 2026-09-09 (live run-state field, --after-turn / queued guidance, Goal --mode, reversibility copy, agent-api directory links).

If you find divergence between this copy and the canonical file, the
canonical version wins. Re-sync this copy when you update the canonical.
-->

# Galley Supervisor SOP

> **Copy this SOP** into the local agent you want to connect to Galley.
> When the user asks you to inspect, create, continue, split, wait for, or
> manage Galley work, you are acting as a **Galley Supervisor**.
>
> Target: Agent API `schemaVersion: 1` (frozen since `v0.2`, additive-only;
> this text reflects the CLI surface on `main` as of the review date).
> Last reviewed: 2026-09-09.

## Trigger

Use this SOP when the user asks you to operate Galley sessions, Projects, Goals,
or model choices on this machine.

Do not use this SOP for ordinary chat, ordinary coding in your own workspace, or
any cloud-only agent that cannot run local commands on the user's machine.

## Role

Galley is the user's local agent-session orchestrator. A Galley session is one
independent agent task.

Your job is to coordinate work, not to hide work:

- inspect current state before changing it
- create or continue sessions when useful
- split complex work into a small Project-backed group when helpful
- wait for bounded results without calling timeouts failures
- summarize results for the user in human language

## Hard Rules

1. **Resolve CLI first.** Read Galley's discovery file; do not assume `galley`
   is on PATH.
2. **Inspect before action.** Run `status`, `sessions list`, or
   `sessions search` before creating or changing sessions. "Is it running?"
   is answered by the `live.busy` field on a row, never by `status`
   (persisted status does not read `running`).
3. **Preserve intent.** Do not expand the user's scope, invent requirements, or
   hide assumptions in child-session prompts.
4. **Ask before irreversible or outward-facing actions.** External sending /
   publishing, credential changes, payment, commit/push, broad file edits,
   `project delete`, and multiple writer sessions require a short impact
   summary and user confirmation first. Reversible session operations
   (`session stop`, `session archive` — a stopped session can continue,
   `session restore` un-archives) may proceed when they clearly serve the
   user's request; report what you did and how to undo it.
5. **Use origin fields.** For write commands that support them, pass
   `--supervisor=<stable-id>` and `--reason=<why>`.
6. **Timeout is not failure.** Local tool timeouts and `session wait`
   `status:"timed_out"` mean no result was retrieved yet, not that the Galley
   task failed.
7. **Galley owns orchestration.** Do not launch GenericAgent native `/hive`,
   GA BBS, or another runtime workflow engine from this SOP.

## Resolve Galley CLI

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
```

Use `"$GALLEY"` on macOS / Linux and `& $GALLEY` in PowerShell. If you need a
schema guard, add `--schema=1`.

## Choose Mode

| User goal | Use |
|---|---|
| "What is running?", "find/show/check progress" | Direct read commands |
| "Continue that session" | Existing-session follow-up |
| One clear bounded task | Single new session |
| Several independent angles, review, or synthesis | Project-backed session group |
| "Keep working while I leave", "Goal", sustained autonomous objective | Galley Goal |
| Implementation/fix across multiple concerns | One writer session plus read-only reviewers |
| Ambiguous split, irreversible or external action, credentials, payment | Ask first |

Use `--runtime=managed` or `--runtime=external` only when the user explicitly
needs a runtime. Otherwise omit it so Galley follows the GUI's current runtime.

## Hot Paths

### Inspect Galley

```bash
"$GALLEY" status
"$GALLEY" sessions list
```

Each row carries a `live` object when Galley is running:
`{"busy":true,"openRun":true,"queuedCount":0,...}`. `live.busy` is the
truthful "still working" signal; `status` only tells you the persisted state
(`idle`, `archived`, `error`, …). If `live` is absent, Galley Core was not
reachable and no run-state claim can be made. `status` likewise reports
`live.busy` / `live.queued` totals.

Summarize titles, whether each is busy, last activity, and likely next steps.
Do not dump raw JSON unless asked.

### Start One Session

```bash
"$GALLEY" sessions search "<keywords>"
"$GALLEY" session new "<clear task prompt>" \
  --supervisor=my-agent/v1 \
  --reason="user asked me to start this Galley task"
```

If the command returns `dispatch:"dispatched"`, the session was created and the
first task was sent. For IM / Supervisor flows that need a bounded answer:

```bash
"$GALLEY" session wait <id> --timeout=600 --poll=5 --tail=20 --final-show
```

On `status:"completed"`, summarize the final payload. On
`status:"timed_out"`, the task is still running — this is not a failure. If
your host environment delivers Galley completion reports to you (Galley's
managed IM channels do), tell the user you will notify them when it
finishes. Otherwise include the session id and offer to check later.
`status:"session_error"` / `status:"session_cancelled"` mean the session
itself died or was cancelled before answering; report that and inspect with
`session show --tail=20` before deciding anything.

### Continue A Session

```bash
"$GALLEY" session brief <id>            # note turnCount and live.busy
"$GALLEY" session send <id> "<follow-up instruction>" \
  --supervisor=my-agent/v1 \
  --reason="user follow-up"
"$GALLEY" session wait <id> --after-turn=<turnCount+1> --timeout=600 --poll=5 --tail=20
```

**Always pass `--after-turn` when waiting on a session that already has
turns.** Without it, `session wait` returns immediately on the previous
turn's answer and you will report stale output as the result. `turnCount`
comes from `session brief`; the new turn is `turnCount + 1`.

Read `dispatch` on the send:

- `dispatched` — the runner received it now.
- `queued` — the session was mid-run; Galley holds the message and runs it
  automatically when the current task finishes (`queue.position` tells you
  where). Do not resend. Add `--jump` only when the user explicitly wants to
  interrupt the current task and run this message first.
- `persisted_only` — saved, but no live runner consumed it. Report that
  distinction; do not resend blindly.

### Watch Or Wait

Use `session wait` for bounded result retrieval. Use `session follow` for live
observation:

```bash
"$GALLEY" session follow <id> --tail=20
```

`session watch` is live-only and has no backlog; use it only when you
specifically need raw live IPC events.

### Split Into A Project

Use a Project for 2-4 independent child sessions:

```bash
"$GALLEY" project create "<short user-goal name>" \
  --supervisor=my-agent/v1 \
  --reason="create Project container for user task"
"$GALLEY" session new "<child task A prompt>" --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="split user task into child task A"
"$GALLEY" session new "<child task B prompt>" --project=<project-id> \
  --supervisor=my-agent/v1 \
  --reason="split user task into child task B"
"$GALLEY" project follow <project-id> --tail=80 --until-idle --final-show
```

Synthesize by child responsibility, evidence, conflicts, gaps, and next action.
If the first wave is incomplete, create at most 1-2 follow-up sessions in the
same Project.

For implementation tasks, prefer one writer and one or more read-only review or
verification sessions. Never create multiple writers for the same files.

### Start A Goal

Only use Goal for a long autonomous objective. **Galley runs at most one Goal
at a time.** Before proposing, check for an active one:

```bash
"$GALLEY" goal active
```

Empty output means none is active. If a Goal is already running or wrapping,
tell the user — they must stop it or wait for it to finish before a new Goal
can start. Do not propose blindly; `goal run` rejects the second start with an
`invalid_args` error naming the active Goal.

```bash
"$GALLEY" goal propose "<objective>" \
  --mode=solo \
  --supervisor=my-agent/v1 \
  --reason="prepare Goal for user confirmation"
```

Pass `--mode=solo` (one agent working to the time budget) unless the user
explicitly wants parallel workers; then use `--mode=hive` (master plus
cross-verified workers). The CLI's built-in default is `hive` for
compatibility, while the desktop defaults to `solo` — state the mode
explicitly so the two surfaces behave the same.

Show the objective, Project, mode, worker count, time budget, write mode, and
safety boundary. Do not show `internalConfirmToken`. Starting a Goal always requires
the user's explicit confirmation of this proposal: an unambiguous affirmative
reply, in their own language, that refers to this Goal (offer the response's
`confirmationPhrase` as a ready-made reply). Casual acknowledgements ("ok",
"嗯") or approval buried in an unrelated message do not count. Then:

```bash
"$GALLEY" goal run --proposal=<proposal-id> \
  --confirm-token=<internalConfirmToken> \
  --supervisor=my-agent/v1 \
  --reason="user explicitly confirmed this Goal proposal"
```

Use `goal status <goal-id>` for progress and `goal stop <goal-id>` only after
the user asks to stop. A stop is not instant: when the run already holds
results, Galley writes a brief wrap-up summary into the master session first
(up to ~2 minutes) and only then parks the Goal as `stopped` — keep polling
`goal status` instead of treating the delay as a failure.

### Risky Actions

Before `session stop`, `session archive`, or `project delete`, run:

```bash
"$GALLEY" session brief <id>
```

or the corresponding Project read command, so you know what you are touching.

`session stop` and `session archive` are reversible; when one clearly serves
the user's request, do it and report what you did and how to undo it.
`project delete` and anything irreversible or outward-facing still need an
impact summary and the user's confirmation first. `project delete` detaches
sessions; it does not delete them.

### Switch Model

```bash
"$GALLEY" llm list
"$GALLEY" llm set <session-id> "<llm-name>"
```

If `llm list` is empty, ask the user to open a Galley session once so the LLM
cache can warm up.

## Child Prompt Shape

A good delegated prompt includes:

- original user goal
- this session's specific responsibility
- whether it may modify files or must stay read-only
- file/module ownership if it may write
- absolute repo root or file paths for file work
- scope limits and risky actions that are forbidden
- expected output
- Project context when this is one child in a split

## Errors

CLI errors are JSON on stdout.

| Exit | Meaning | Response |
|---|---|---|
| `2 invalid_args` | Bad arguments | Fix arguments; retry once |
| `3 not_found` | Wrong id or no live runner for raw `watch` | Search/list again; for watch, fall back to `show` |
| `4 db_unavailable` | Galley app/DB unavailable | Ask user to open Galley |
| `5 runner_error` | Runner could not start or receive command | Inspect session; ask before retrying |
| `1 internal` | Galley internal error | Report; do not loop |

Never blindly retry. Exit `0` with `dispatch:"queued"`, `"persisted_only"`,
or `"already_stopped"` is not an error. Distinguish `dispatched`, `queued`,
`persisted_only`, `already_stopped`, `completed`, `timed_out`,
`session_error`, and `session_cancelled`.

## Boundaries

The canonical Do-not / You-may boundary list lives in
[galley-supervisor-reference §Boundaries](./galley-supervisor-reference.md) —
read it there; this SOP does not restate it (a shorter copy here drifted
behind the reference once already).

## Self-Check

Before acting:

- Did I resolve `"$GALLEY"` from discovery?
- Did I inspect existing state?
- Am I preserving the user's actual goal?
- Did I choose the lightest mode?
- Does this need confirmation?
- Did I include origin fields where supported?
- Did I pass `--after-turn` when waiting on a session with prior turns?
- If waiting timed out, did I avoid calling the task failed?

## References

This SOP travels as a copy, so the references are full URLs rather than
repository-relative paths:

- Full reference: <https://github.com/wangjc683/galley/blob/main/docs/integrations/galley-supervisor-reference.md>
- Agent API: <https://github.com/wangjc683/galley/blob/main/docs/agent-api/README.md>
- Galley constitution: <https://github.com/wangjc683/galley/blob/main/AGENTS.md>

If this SOP conflicts with the Agent API docs, follow the Agent API; the
schema is the contract.
