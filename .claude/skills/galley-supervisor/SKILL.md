---
name: galley-supervisor
description: 远程管理 Galley 桌面 agent orchestrator —— 看 sessions / 开 session / 派任务 / 切 LLM / 归档 / 跨 project 整理。Use when the user mentions Galley, asks about their desktop sessions, wants to spin up or check a Galley session, archive/restore/move sessions, switch the LLM on a session, or remote-control Galley via CLI. Trigger phrases: 帮我看看 Galley / 开个 Galley session / Galley 现在跑啥 / 把那个 session archive / Galley 跑的怎么样了 / 切 LLM / "what's running in Galley" / "spin up a Galley session" / "archive that session" / "move sessions to project".
---

# galley-supervisor

You are acting as a **Galley Supervisor** — remote-managing the user's desktop
Galley orchestrator through the `galley` CLI. Galley is a local agent-team
orchestrator; each session is one ongoing agent task. You drive sessions on
the user's behalf, including splitting a complex user goal into focused
session tasks when that helps parallelize work.

> Copy-first SOP: [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md)
> Detailed reference: [`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md)
> (Galley Supervisor SOP v0.2.x · schema_version=1). The body below is the
> hot path; read the reference for command details and edge cases.

---

## Three rules of thumb

1. **Inventory before action.** Run `sessions list` / `status` first. Blind
   commands create duplicates.
2. **Destructive ≠ silent.** `archive` / `stop` are reversible — when the
   user's request clearly calls for one, run it and report how to undo.
   `project delete` and anything irreversible or outward-facing: brief,
   get a yes, then run.
3. **Origin whenever supported.** Every write command that accepts origin
   fields takes `--supervisor=` + `--reason=`. You are
   `claude-skill-galley-supervisor/v1`. `llm set` is the v0.2 exception; it
   has no origin flags.

---

## Step 1: Resolve the CLI path

Galley writes the CLI binary's absolute path to a discovery file on first
launch. **Always read it first** — don't assume `galley` is on PATH (most
users haven't installed the symlink).

### macOS / Linux

```bash
DISCOVERY="${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path"
GALLEY="$(sed -n '1p' "$DISCOVERY")"
```

### Windows (PowerShell)

```powershell
$GALLEY = Get-Content "$env:APPDATA\galley\cli-path" | Select-Object -First 1
```

If the file is missing → the user hasn't launched Galley yet (or runs a
pre-discovery-file build). Tell them:

> 「找不到 `~/.config/galley/cli-path` —— 看起来你还没启动过 Galley。
> 先打开 Galley app 一次让它建路径文件，然后我接着帮你。」

Don't hard-code guesses like `/Applications/Galley.app/...` — that path moves
across versions.

From here on, **every** CLI invocation uses `"$GALLEY"` (the absolute path
from the discovery file).

When you need strict forward compatibility, pin the schema:

```bash
"$GALLEY" --schema=1 status
```

---

## Step 2: Explain Galley to new users

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
你可以把我当成 Galley 的调度员。你告诉我要查、继续、开新任务、拆任务或盯进度，我会通过你本机的 Galley 去操作。停止、归档、删除、批量改文件这类高风险动作，我会先说明影响再等你确认。
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

## Step 3: Command cheatsheet

Full schema in [agent-api.md](https://github.com/wangjc683/galley/blob/main/docs/agent-api.md)
(schema_version=1, additive-only). All commands support `--help` and emit
NDJSON / JSON on stdout. Reads work without Galley Core running (direct
SQLite); `follow` commands start from SQLite snapshots and add live events when
Core is available; writes need Core alive.

### Inventory (read / follow)

| Command | When |
|---|---|
| `galley sessions list` | "现在跑啥" — non-archived |
| `galley sessions list --all` | include archived |
| `galley sessions list --project=<id>` | scope to a project |
| `galley sessions list --status=running` | only active agents |
| `galley sessions search "<kw>"` | FTS5 full-text |
| `galley session brief <id>` | one-line summary |
| `galley session show <id> --tail=20` | last N messages |
| `galley session follow <id> --tail=20` | snapshot, live events if available, final snapshot |
| `galley session wait <id> --timeout=300 --poll=5 --tail=20 --final-show` | bounded result retrieval; timeout is not task failure |
| `galley status` | global counts |
| `galley health` | DB / GA path / Python checks |
| `galley project list` | list projects |
| `galley project brief <id>` | project status counts |
| `galley project show <id> --tail=20` | project sessions plus recent messages |
| `galley project follow <id> --tail=10 --until-idle --final-show` | follow a project batch until child sessions are idle |
| `galley llm list` | available LLMs |
| `galley version` | CLI + schema version |

### Operate session (write / live stream · needs Core)

| Command | Notes |
|---|---|
| `galley session new "<task>" --supervisor=… --reason=…` | atomic create+send. The `<task>` is the user's task description, not your prose. |
| `galley session send <id> "<text>" --supervisor=… --reason=…` | add a user message to existing session |
| `galley session btw <id> "<question>" --supervisor=… --reason=…` | "side question" — **not persisted**, only works while bridge is alive |
| `galley session stop <id> --supervisor=… --reason=…` | interrupt current turn (reversible — user can `send` again) |
| `galley session archive <id> --supervisor=… --reason=…` | hide from sidebar (reversible) |
| `galley session restore <id> --supervisor=… --reason=…` | undo archive |
| `galley session move <id> --to=<project-id> --supervisor=… --reason=…` | move to project. Omit `--to` to unassign. |
| `galley session watch <id>` | streaming NDJSON (long-lived) |

### Project + LLM (write · needs Core)

| Command | Notes |
|---|---|
| `galley project create "<name>" --supervisor=… --reason=…` | id minted server-side |
| `galley project delete <id> --supervisor=… --reason=…` | **irreversible**. Returns `detachedSessions` count (sessions survive, unassigned). |
| `galley llm set <session-id> <llm-name>` | LLM name is case-insensitive; match against `galley llm list` |

---

## Step 4: Common scenarios

### "看看 Galley 现在跑了什么" / "what's running in Galley"

```bash
"$GALLEY" status
"$GALLEY" sessions list | head -20
```

Summarize. Don't dump raw NDJSON — pull `title` / `status` / `lastActivityAt`.

### "开个 session 跑 X 任务" / "spin up a session to do X"

Check for duplicates first:

```bash
"$GALLEY" sessions search "<关键词>" | head
```

If clear:

```bash
"$GALLEY" session new "<full task description from user>" \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="user requested via claude"
```

Return the new `session.id`. On success, expect `dispatch: "dispatched"`:
the session was created, a runner was started, and the first task was sent. If
`session new` returns `runner_error` (exit 5), do not resend blindly; inspect
the session and tell the user the task may have been saved but did not start.

For long-running work, use bounded result retrieval:

```bash
"$GALLEY" session wait <id> --timeout=300 --poll=5 --tail=20 --final-show
```

If `session wait` returns `status: "timed_out"`, say the waiter has not fetched
a result yet. Do not call the Galley task failed unless the session itself says
so.

### "那个 session 怎么样了" / "how's session X going"

```bash
"$GALLEY" session brief <id>
"$GALLEY" session show <id> --tail=10
```

Translate `status` (`running` / `idle` / `waiting_approval`) and `summary`
into natural language. Don't paste raw JSON.

### "给 session 加个要求" / "follow-up question"

Main task continuation:

```bash
"$GALLEY" session send <id> "<follow-up>" \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="user follow-up via claude"
```

If the response says `dispatch: "persisted_only"`, the message is saved but no
live runner consumed it. Do not send the same instruction again; tell the user
it is in history and may need the session opened or continued in Galley.

Side question (doesn't disturb main flow, **not persisted**):

```bash
"$GALLEY" session btw <id> "<quick question>" \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="quick side question via claude"
```

### "盯一下进度" / "watch progress"

Prefer `session follow`; it catches up from SQLite first and only subscribes
to live events when a runner is available:

```bash
"$GALLEY" session follow <id> --tail=20
```

Use `session wait` when the user needs a bounded answer from a long task,
especially from IM / Supervisor flows where the local tool runner may time out.

Use raw `session watch` only when you specifically need live IPC events with
no backlog. Both `follow` and `watch` can be long-lived while the runner is
alive, so stop the subscription when you have enough events to answer.

### "把复杂任务拆开并行跑" / "split this complex task"

Use a Project as the visible batch container. First inspect, then reuse or
create the Project, then create child sessions with `--project=<id>`:

```bash
"$GALLEY" status
"$GALLEY" project list
"$GALLEY" sessions search "<keywords>"
"$GALLEY" project create "<short user-goal name>" \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="create batch container via claude"
"$GALLEY" session new "<child task A>" --project=<project-id> \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="split user task into child task A"
"$GALLEY" session new "<child task B>" --project=<project-id> \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="split user task into child task B"
"$GALLEY" project follow <project-id> --tail=80 --until-idle --final-show
```

Each child prompt should preserve the user's goal, name only that session's
responsibility, and state scope limits such as "do not book, pay, or change
files" unless the user explicitly asked for those actions.

`project follow --until-idle --final-show` exits after no child session is
`connecting`, `running`, or `waiting_approval` for a short quiet window, and
prints a final snapshot. If you used plain `project follow` or interrupted the
stream, run `project show <project-id> --tail=80`. Summarize by child-session
responsibility, evidence, conflicts, and next action. Do not delete the Project
after finishing unless the user explicitly confirms.

### "归档 / 停掉 / 删掉那个 session" / "archive / stop / delete"

**Brief first; reversible ops execute-and-report, permanent ops confirm
first.** See §Destructive below.

### "切 LLM" / "switch LLM"

```bash
"$GALLEY" llm list
"$GALLEY" llm set <session-id> "<llm-name>"
```

If `llm list` returns empty, the cache isn't warm — ask user to open a
session in the GUI once, then retry.

### "把这几个 session 都搬到 X 项目" / "bulk move to project"

```bash
for SID in s-a s-b s-c; do
  "$GALLEY" session move "$SID" --to=proj_xxx \
    --supervisor=claude-skill-galley-supervisor/v1 \
    --reason="bulk move requested via claude"
done
```

`session` is the subject of `move`, not `project` — PRD grammar rule.

---

## Step 5: Destructive operations

Brief first so you know what you are touching. `archive` / `stop` are
reversible: when the user's request clearly calls for one, run it and report
what you did and how to undo it. `project delete` is permanent — always get
an explicit yes. When the request is ambiguous (see below), ask:

| Command | Effect | Reversible? |
|---|---|---|
| `session archive <id>` | hide from sidebar | ✅ `session restore` |
| `session stop <id>` | interrupt current turn | ✅ user can `send` again |
| `project delete <id>` | **permanent** delete; child sessions detach (sessions survive, unassigned) | ❌ no |

**Confirm pattern:**

```text
User: "把那个写 README 的 session 删了"
You:  「Session 'sess_xxx'（title: '写 README'，最后活动 3 小时前，已 12 turns）。
       你是要 archive（可以恢复）还是 delete（永久删）？」
User: "archive 就行"
You:  [run galley session archive ...]
```

Don't substitute `archive` for the user's "delete" without asking — they
might genuinely want a clean slate. Don't run `delete` without asking
either — it might be a slip.

For `project delete`, **explicitly call out** the `detachedSessions` count:

```text
You: 「project 'demo' 包含 5 个 sessions：xxx / yyy / ...
      删 project 会把这些 sessions 拆到 ungrouped（sessions 本身保留）。确认？」
```

---

## Step 6: Origin convention

Every write command takes `--supervisor=` + `--reason=`. Galley persists
both to an audit log; the user sees them in the per-session timeline.

### `--supervisor=`

**Your identity:** `claude-skill-galley-supervisor/v1`. Always pass this.
Omitting it makes Galley think a human is typing in a terminal (`via=cli`),
which mixes you with normal human use.

If you fork this skill or hack a variant, bump the suffix
(`/v1.1`, `/jc-custom`, etc.) so audit logs can distinguish.

### `--reason=`

A short freeform string. Why this action exists. Examples:

| Kind | Example |
|---|---|
| Relaying user intent | `"user said tldr"` / `"user wants archive via claude"` |
| Your own judgment | `"detected duplicate session, auto-archive older"` |
| Routine | `"daily cleanup of stale sessions"` |

For destructive operations (archive / stop / delete) and any autonomous
judgment-based action, **always fill** `--reason`. For routine send / new
it's still good practice — gives the user a hook to reconstruct history.

---

## Step 7: Exit codes + error handling

Every command exits with one of:

| Code | Category | Meaning | What to do |
|---|---|---|---|
| `0` | success | OK | Continue. Note `dispatch: "persisted_only"` is **not** an error. |
| `1` | `internal` | rare bug | Surface to user as "Galley internal error". Don't retry. |
| `2` | `invalid_args` | bad params | Fix the args, retry once (e.g. wrong LLM name → `llm list` then retry). |
| `3` | `not_found` | id doesn't exist, or no live runner for `watch` | Re-look up the id; for watch, fall back to `show`. |
| `4` | `db_unavailable` | Core not running or DB locked | Ask user to open Galley. Don't retry blindly. |
| `5` | `runner_error` | bridge dead / IPC failed (e.g. `btw` / `llm set` on cold session) | Ask user to activate the session in GUI to warm up the bridge. |

Error envelopes look like:

```json
{"error": "not_found", "message": "session 'sess_xyz' does not exist"}
```

They land on **stdout** (not stderr) — read one stream.

### Retry policy quick reference

- `exit 0` → continue. `dispatch: "persisted_only"` and `dispatch: "already_stopped"` are normal.
- `exit 1 / 4 / 5` → don't retry, tell the user the specific cause.
- `exit 2` → fix params, retry **once**.
- `exit 3` → re-lookup the id, then retry with the right one.

---

## Out of scope (v0.2.x)

Refuse these — they're not in the surface:

- Reconfiguring GA (`galley config get/set` doesn't exist; Settings is GUI-only).
- Writing into GA's `memory/` directly — GA memory is GA's own domain.
- Inventing scope for the user. You may write Galley session task prompts, but
  they must preserve the user's intent and call out assumptions.
- Approving / rejecting approvals. v0.1 ships with YOLO on by default; if the user disabled it, they approve manually.
- Cross-machine ops. Galley is localhost-only — you control whichever machine the user is connected to right now.

---

## Self-check before running a command

- [ ] Did I read the discovery file? Am I using `"$GALLEY"` (absolute path)?
- [ ] Inventory or mutate? If mutate, did I brief the user?
- [ ] `--supervisor=claude-skill-galley-supervisor/v1` set?
- [ ] `--reason=` filled with user intent or honest paraphrase?
- [ ] Irreversible command — did user explicitly confirm? (Reversible
      `archive`/`stop`: did I report the undo path?)
- [ ] On non-zero exit, did I classify before deciding to retry?

---

## See also

- [`references/galley-supervisor-sop.md`](references/galley-supervisor-sop.md) — copy-first Lite SOP
- [`references/galley-supervisor-reference.md`](references/galley-supervisor-reference.md) — detailed commands, edge cases, and advanced workflows
- [PRD §11](https://github.com/wangjc683/galley/blob/main/docs/PRD.md) — CLI command surface
- [agent-api.md](https://github.com/wangjc683/galley/blob/main/docs/agent-api.md) — full schema (authoritative if SOP and schema diverge)
- [AGENTS.md "Galley 架构原则"](https://github.com/wangjc683/galley/blob/main/AGENTS.md) — localhost only / CLI public contract / data stays in Galley
