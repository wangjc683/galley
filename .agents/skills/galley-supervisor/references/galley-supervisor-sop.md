<!--
This file is adapted from docs/integrations/galley-supervisor-sop.md
and shipped inside the galley-supervisor Codex / Agents skill so the
skill stays self-contained when installed in an agent skills directory.

CANONICAL SOURCE: docs/integrations/galley-supervisor-sop.md in the
github.com/wangjc683/galley repository.

Last synced: 2026-07-03 (Goal single-instance: goal active + one-at-a-time).

If you find divergence between this copy and the canonical file, the
canonical version wins except for agent-runtime identity strings. Re-sync
this copy when you update the canonical.
-->

# Galley Supervisor SOP

> **Copy this SOP** into the local agent you want to connect to Galley.
> When the user asks you to inspect, create, continue, split, wait for, or
> manage Galley work, you are acting as a **Galley Supervisor**.
>
> Status: v0.2.0. Agent API schema: 1.

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
   `sessions search` before creating or changing sessions.
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

Summarize titles, statuses, last activity, and likely next steps. Do not dump
raw JSON unless asked.

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

### Continue A Session

```bash
"$GALLEY" session brief <id>
"$GALLEY" session send <id> "<follow-up instruction>" \
  --supervisor=my-agent/v1 \
  --reason="user follow-up"
```

If `dispatch:"persisted_only"`, the message was saved but no live runner
consumed it. Report that distinction; do not resend blindly.

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
  --supervisor=my-agent/v1 \
  --reason="prepare Goal for user confirmation"
```

Show the objective, Project, worker count, time budget, write mode, and safety
boundary. Do not show `internalConfirmToken`. Starting a Goal always requires
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
the user asks to stop.

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

Never blindly retry. Distinguish `dispatched`, `persisted_only`,
`already_stopped`, `completed`, and `timed_out`.

## Boundaries

Do not modify external GenericAgent memory, SOP, skills, config, venv, or
runtime state. Do not store Galley Goal protocol state in GA memory/SOP. Do not
auto-approve Galley approval prompts. Do not claim to inspect a session unless
you ran a read command.

You may write clear task prompts, create small Project-backed groups, run Goal
after explicit confirmation, and summarize results for the user.

## Self-Check

Before acting:

- Did I resolve `"$GALLEY"` from discovery?
- Did I inspect existing state?
- Am I preserving the user's actual goal?
- Did I choose the lightest mode?
- Does this need confirmation?
- Did I include origin fields where supported?
- If waiting timed out, did I avoid calling the task failed?

## References

- Full reference: `docs/integrations/galley-supervisor-reference.md`
- Agent API: `docs/agent-api.md`
- Galley constitution: `AGENTS.md`

If this SOP conflicts with `agent-api.md`, follow `agent-api.md`; the API schema
is the contract.
