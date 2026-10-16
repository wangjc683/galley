# Managed Runtime: Runtime Modes, Session History, And CLI Contract

> Part of the [managed GA runtime reference](./README.md).

## Runtime Modes

Galley has two runtime modes.

```text
managed_ga
- Default path for new users.
- Galley owns the runtime code and model configuration.
- Galley may apply minimal managed-runtime patches.
- Galley Runtime Prompt applies.
- Sessions shown in the UI are managed-runtime sessions.

external_ga
- Advanced attach path for an existing user-owned GA checkout.
- User owns code, memory, SOP, skills, model config, venv, and behavior.
- Galley does not inject Galley prompt extensions or use Galley's model config.
- Sessions shown in the UI are external-runtime sessions.
```

Mode switching lives in Settings -> Runtime. Do not show a prominent runtime
toggle in the main workspace. The main UI does not need a managed-mode badge
because managed mode is the product default. When the user is in attach mode,
the sidebar should show a small "Existing GenericAgent" badge in a suitable
place and link to Settings -> Runtime.

When modes switch, the visible session list switches with the mode. This is
intentional: it reinforces that these are different agent kernels, not one
history with a different skin.

The first time a mode switch hides the previous mode's sessions, show a small
one-time explanation:

```text
Showing sessions for Existing GenericAgent. Galley sessions are still available
when you switch back.
```

### GenericAgent's Own Scheduler (`sche_tasks`)

GenericAgent ships an in-process scheduler (`agentmain.py --reflect
reflect/scheduler.py`, polling `sche_tasks/*.json`). Galley never starts it, in
either mode, and does not plan to host it (rejected in the
[scheduled tasks PRD](../../.scratch/scheduled-tasks/PRD.md): tasks hidden in
GA state, invisible to Galley's orchestration, unavailable in attach mode, no
Galley session per run; hosting it would also start GA's hub on TCP ports).

- **Managed mode:** `sche_tasks` files never fire. The scheduler resolves
  `sche_tasks/` next to the read-only code payload, not under
  `managed-ga-state/`, so copying a folder into the state root does nothing.
  The Galley Runtime Prompt tells the agent not to create these files
  ([prompt composition](./prompt-composition.md), Scheduled Tasks) because the
  seeded `scheduled_task_sop` still describes them.
- **Migrating from external GA:** recreate each task in Galley's scheduled
  tasks (sidebar「定时」/ "Scheduled": daily, chosen weekdays, or chosen days
  of the month; each run opens a new Galley session). GA's cooldown-based
  `weekly` / `monthly`, `once`, `every_Nh`, `every_Nd` and `max_delay_hours`
  have no exact equivalent. Alternatively keep running the external GA's own
  scheduler outside Galley: its port lock (127.0.0.1:45762) only guards
  against a second copy of `scheduler.py`; Galley's scheduler does not use it.
- **Not built:** importing `sche_tasks`, a `galley schedule` CLI, and non-LLM
  script tasks are parked in the [devlog deferred list](../devlog/deferred.md).

## Session History

Store sessions in the same Galley database, tagged by runtime kind, but display
only the current mode's sessions by default.

Suggested session metadata:

```text
ga_runtime_kind: managed | external
ga_runtime_id: string
prompt_profile: string | null
```

Rules:

- Creating a session snapshots the current runtime kind.
- Restoring a session uses the runtime kind it was created with.
- Changing the default runtime only affects new sessions.
- External sessions do not silently migrate to managed runtime.
- Managed sessions do not silently migrate to external runtime.
- A future "Copy to Galley runtime" action can explicitly duplicate selected
  external history into a managed session, but v1 should not auto-convert.

### Main Chat Segments

The managed runtime's main chat (`sessions.main_chat`, migration 044) is one
thread to the user and a series of **segments** to the model (ticket 03a,
`.scratch/main-chat/issues/03-segments-and-injection.md`;
`core/src/session_runner/segment.rs`). Every other session, and attach mode,
is unaffected.

- **Rule (deterministic)**: when the main chat has been idle for more than N
  hours, the next message starts a new segment. N is the hidden Core pref
  `main_chat_segment_idle_hours` (a JSON number, fractions allowed; default 4;
  no Settings UI; read on every judgement). Idle is measured from
  `sessions.last_activity_at`, which only a turn ending or a message being
  written moves. No cut while a run is going, while an `ask_user` question
  waits for its answer (live, or the latest reply ending on one), or when
  nothing has been written since the current segment began.
- **Recorded, not derived**: Core writes each boundary once, as the
  `turn_index` its first message gets (`main_chat_segments`, migration 046).
  Replay reads it back, so the runner restored after a Core restart gets
  exactly the segment the live runner had, and tuning N never moves a past
  boundary. Deriving boundaries from message times would re-cut history on
  every change of N, and could not tell an answer to a question from a new
  message after the fact.
- **Fresh context = fresh runner**: recording a boundary retires a live
  runner (quietly, like ensure's own restart); the next ensure spawns one
  with a newly composed state block and gives it back the current segment,
  opened by the turns it carries over (next point) — nothing else from
  before the boundary. A segment with nothing to carry and no reply yet
  needs no replay.
- **The last turns carry over** (ticket 11,
  `.scratch/main-chat/issues/11-carry-last-turns-into-new-segment.md`;
  `core/src/session_runner/carry.rs`): otherwise a user who writes again
  after the gap finds the assistant has forgotten the exchange still on
  screen. The replay of a segment with a recorded boundary opens with the
  last 3 complete turns before it — a user message and its reply, read by
  the replay's own rules; never the greeting, never a message whose reply
  never came — whichever segment they are in, at most 6,000 Unicode
  characters together (images ride along uncounted). Over the cap, whole
  turns go, oldest first. When the latest turn alone is over it, its user
  message and its reply are each sure of half the cap and lend the other
  what they do not need: a cut reply keeps its end (the final answer), a
  cut user message its start and its end (a long one is mostly a paste
  with the request at one end), with `[… cut for length …]` where text
  went. 3 and 6,000 are constants, not prefs. The window is computed from
  the rows before the boundary and nothing else, so the replay after a
  Core restart opens the same way, and the state block, which reads it
  through the same function, says how many turns it carries and when the
  last was said (last point). The first segment, every other
  session, and attach mode are unchanged.
- **Where the rule runs**: in `ensure_session_runner` (the GUI opening the
  main chat, `/btw`) and in Core's send just before it persists the message.
  Opening the main chat after the gap records the boundary at the next
  message's `turn_index` before that message exists; it is the same
  boundary, since the gap only grows until the message comes. Socket
  `session send` and the queue drain dispatch to a live runner as before and
  never cut.
- **The database keeps everything**: messages are not touched, the desktop
  shows the whole thread, and there is no segment marker in the UI.
- **Earlier segments are looked up, not replayed** (ticket 03b): the main
  chat's state block says it is the main chat, gives its id and where the
  current segment begins (first `turnIndex`, local day) — and, when turns
  are carried over, how many and when the last was said (local time to
  the minute, ticket 11) — and sends the model to the Galley CLI for
  anything older — `sessions search`, then
  `session show <id> --around=<messageId>`, or a `--since` / `--until`
  window ([prompt composition](./prompt-composition.md#main-chat-main-chat-only),
  [session commands](../agent-api/session-commands.md) §5.3, §5.5).

### Main Chat Subtasks

The main chat hands long work to **subtasks** (ticket 06a,
`.scratch/main-chat/issues/06a-subtask-dispatch-and-cards.md`, PRD rulings
52, 53; `core/src/subtask.rs`). Its entry layer tells the model to end such a
reply with `<subtask>what to do</subtask>`
([prompt composition](./prompt-composition.md#main-chat-entry-layer)); nothing
about the tag reaches GA, which keeps no subtask tool and no patch for it.

- **When**: the queue drain task, on the main chat's `RunComplete` and
  before it hands the session a queued message, reads the latest visible
  assistant row. A final answer (no real tool call; a reply ending on
  `ask_user` is not one) with `<subtask>` in it and no records yet is
  claimed and dispatched in the background. Any other session's tag is
  text.
- **What**: each tag, in reply order, becomes an ordinary managed session:
  `parent_session_id` = the main chat, origin `subtask` (stored as
  `system` + supervisor `galley-subtask`, migration 048), titled by the
  instructions' first line, on the main chat's model. The instructions go
  are its first message, written with the row in one transaction; then
  its run starts as Core's send starts one (the run gate, a runner on the
  shared path, the dispatch). The tags start concurrently.
- **Records**: `subtask_dispatches` keeps one row per tag, including an
  empty one (`empty`), an unclosed one (`unclosed`) and one whose session
  could not be created or started (`start_failed` with the error; with a
  `session_id` when the row exists). Nothing is retried. Core announces
  each record as `subtask-dispatched` (desktop only) the moment it exists —
  a subtask's once its session and first message do, before its runner is
  up, and again if the runner then fails to start; the desktop reads them
  with `list_subtask_dispatches` and draws a card per record under the
  reply.
- **Text**: the turn derivation strips the tag from the persisted final
  answer and preamble, an unclosed one with everything after it; the raw
  reply keeps it. In the main chat's replayed history (the segment and the
  turns it carries over) assistant rows lose their `<subtask>` blocks, and
  the dispatching reply ends with one line per tag:
  `[subtask <id>: <title>]` or `[subtask not started: <why>]`. A warm
  runner keeps what the model wrote.
- **Promotion**: a person's message sent through Core's send (desktop or
  phone, `via: gui`) that is not the answer to a pending question promotes
  a subtask to an ordinary conversation (`promoted_at`,
  `session-updated-external` via `subtask-promoted`), a queued one included.
  Socket `session send` (CLI, supervisor) and scheduled tasks never come
  through Core's send, and a subtask's own first message has origin
  `subtask`, so none of them promotes.
- **Listings**: the Agent API lists subtasks like any session, with
  `parentSessionId` and `promoted`; the desktop sidebar leaves out the
  ones not promoted, and so does the phone — its session list and the
  events it is sent (`remote::convert::shows_on_phone`); a promotion
  reaches the phone as the session appearing.
- Attach mode has no main chat, so nothing here runs there.

### Subtask Reports

A subtask's result comes back to the main chat by itself (ticket 29,
`.scratch/main-chat/issues/29-subtask-wake-core.md`, assistant PRD rulings 2
and 8; `core/src/subtask_report.rs`): each run of a subtask that ends
**reports** to its main chat, which gets one turn (a **wake**) to check the
result, send the subtask back, answer its question, or tell the user.

- **Which runs**: the queue drain task, for every run signal and before the
  queue step, reads how the run ended. Only an unpromoted subtask of the
  current main chat reports: finished (`CURRENT_TASK_DONE` and any other
  exit, with its final answer), asking (`ask_pending`, with the question and
  candidates), at the step limit (`MAX_TURNS_EXCEEDED`, with its last
  words), failed (`DONE_WITHOUT_EXIT` with the engine's last error event, or
  `Closed` while its run was open). A stopped run (`ABORTED`) and a slash
  command (`SLASH_COMMAND_COMPLETED`) do not report. A reply whose tag
  started nothing (`empty`, `unclosed`, `start_failed`) reports once too.
- **Once, in memory**: a report is keyed by the subtask and the user message
  that started its run; a subtask's newer report replaces one still
  waiting. Nothing is persisted: a report waiting while Galley quits is lost
  (ruling 8).
- **When**: at once when the main chat is idle (run gate free, nothing
  queued, no `ask_user` of its own waiting); otherwise after its run
  completes, behind the user's queued messages. While it waits for the
  user's answer the report waits, since any message would be taken as the
  answer.
- **What**: with the run gate reserved (never the visible queue) the waiting
  reports are read again — a subtask running again, answered, promoted or
  deleted drops out — and the rest go as one message: a visible user row in
  the main chat with `created_via = 'system'`, supervisor `galley-report`,
  the subtask ids comma-separated in `origin_note`, and its replay form (one
  line per subtask) in `summary`; announced as `user-message-persisted`
  (`pending`, then `dispatched` / `persisted_only`) and dispatched after the
  shared runner path (segments and carried turns as for any message). No
  migration: the same pattern as `galley-greeting` and `galley-subtask`.
  The CLI shows the row as `via: "system"`.
- **Silent reply**: when the assistant only sent the subtask back or
  answered for the user, it ends the reply with `<no-reply/>`. The turn
  derivation strips any `no-reply` tag (self-closing, opening or closing,
  any letter case, whitespace inside the brackets); a reply left empty has
  no final answer, like one that only dispatched subtasks. The raw reply
  keeps it.
- **Replay**: the main chat's replayed history and the turns a new segment
  carries show a report as its lines,
  `[Galley: subtask <id> "<title>" finished — details: session show <id>]`
  (`is asking`, `stopped at the step limit`, `failed`, `could not be
  started`); the reply to it stays as written.
- **Not delivered**: when the runner does not start or does not take the
  message, or the main chat is waiting for its answer, Core broadcasts
  `subtask-report-undelivered` `{ mainChatId, subtaskIds }` (desktop only,
  each subtask once per report) and keeps the reports for the main chat's
  next run signal or the next report; the desktop falls back to the
  subtask's own notification.
- **Send-backs**: `SubtaskDispatch.sendBacks` (always written) counts the
  subtask's user messages from supervisor `galley-assistant` whose previous
  reply did not end on `ask_user`, from the rows. The report names the round
  (`sendBacks + 1`); from two send-backs on it tells the assistant not to
  send it back again. Core refuses no send. The record is announced again as
  `subtask-dispatched` when the assistant writes into the subtask. The
  report's `session send` commands carry `--ensure-runner`, so a send-back
  or an answer still runs when the subtask's runner is gone (evicted, or
  after a restart).
- **Search**: the desktop's search (⌘K, 查找聊天记录) leaves out report rows
  and main chat replies left empty by `<no-reply/>`; the Agent API's
  `sessions search` is unchanged.

### Scheduled Tasks Wake The Assistant

Scheduled tasks travel the same pipeline (ticket 33,
`.scratch/main-chat/issues/33-schedule-once-and-wake.md`, assistant PRD
ruling 9; `core/src/scheduler.rs`, `core/src/subtask_report.rs`, migration
049):

- **What a fire does** (`scheduled_tasks.target`): `session` starts a session
  that runs the prompt, as before; `assistant` starts no session and wakes the
  main chat with a report carrying the task's words, when it was planned for,
  when it went off and, from two minutes late on, how late (`2 days 3 hours`).
  The assistant decides what to say or do; `<no-reply/>` is allowed.
  `assistant` tasks are refused while the active runtime is not the managed
  one or it has no main chat (`invalid_args`, message prefix
  `assistant_unavailable:`), and do not fire meanwhile.
- **One-offs** (`repeat_kind = 'once'`, `fire_at` UTC): fire once, not bound
  to the local day — a computer asleep for days fires a missed one when it
  wakes. A time already past is refused (`time_in_past:`).
- **Durable**: a fire of an `assistant` task is stamped `last_wake =
  'pending'`; every scheduler tick reads the pending fires into the waiting
  reports (`restore_pending_reminders`, deduplicated per fire), so a restart
  sends what was not delivered. Several due at once go in one wake. A fire
  ends as `delivered` when the turn it woke ends, or as `notified` when it
  could not reach the assistant — the main chat waiting for the user's
  answer, its runner not starting or not taking the message, the turn ending
  on an error before a reply. Then Core broadcasts
  `scheduled-tasks:reminder-undelivered` `{ taskId, prompt, reason }` and the
  desktop shows a system notification with the prompt; it is not retried.
  The wake row is the usual `galley-report` row, the task ids in its note,
  `[Galley: reminder <id> came due (…) — details: schedule show <id>]` as its
  replay line.
- **Sessions a task started** report each run that ends like a subtask,
  while the managed runtime has a main chat and nobody wrote in the session
  from an app; they stay ordinary sessions.
- **Soft cancel**: deleting a task sets `cancelled_at`; the scheduler and the
  default lists skip it, the row stays for its card.
- **Where it was made**: a task the assistant (`--supervisor=galley-assistant`)
  makes through the CLI while a main chat run is open records the main chat
  and that run's starting turn; when the run ends Core fills its reply's
  `turn_index` (`createdIn`).

### The Assistant's To-Do List

Main chat ticket 37 (`core/src/assistant_todo.rs`): one read of what the
assistant has coming up, is working on, and finished lately. The desktop's
「待办」 (Tauri `list_assistant_todo`) shows it, and the main chat's 「在办的事」
lines (ticket 36) are written from the same read, so both list the same
things in the same order.

- **Upcoming**: scheduled tasks not cancelled that may still fire, whoever
  made them; enabled ones by next fire, paused ones last.
- **Active**: the main chat's subtasks not promoted, not archived and not
  finished — running (run gate open), asking (`ask_user` pending, or the
  latest run's last reply asks), failed, paused at the step limit, stopped
  short. Not running and quiet for 7 days: dropped.
- **Recent**: within 7 days (rolling), a one-off that fired, a repeating
  task's last fire, a finished subtask; newest first, at most 50.

Each item carries its kind, id, words or title, state, the instant it is
ordered by (UTC), who made it (the assistant, the user's form, another
agent), and where it leads (the reply a task was made in, a subtask's
session, a scheduled run's session). Deterministic and read-only; the
desktop reads it again on the existing events (`scheduled-tasks:changed`,
`subtask-dispatched`, `session-run-state`, session updates). Core's
subtask state after a restart comes from the rows alone: a step-limit or
error ending is known only while the Core process that saw it runs, and
reads as stopped short afterwards.

## CLI Runtime Contract

Galley has not shipped a stable CLI release before managed runtime, so the CLI
can adopt the clean runtime contract from the start.

Rust Core owns a persisted current runtime:

```text
prefs.active_runtime_kind = managed | external
```

GUI mode switches update this value. CLI commands read it as their default
runtime context. If it has never been set, Galley derives the initial value
once:

```text
existing ga_config.gaPath -> external
otherwise                 -> managed
```

This preserves existing attach users after upgrade while making managed runtime
the default for fresh installs.

If the current runtime is not configured, CLI writes should fail with a specific
actionable error instead of falling back to another runtime:

```text
managed_model_not_configured # managed runtime has no usable model
managed_runtime_invalid      # managed runtime code/prompt layout is incomplete
ga_path_invalid              # external runtime path is invalid
runner_error                 # generic runtime setup incomplete
```

### Defaults

Session listing defaults to the current runtime:

```bash
galley sessions list
```

This is equivalent to:

```bash
--runtime=current
```

Explicit read scopes:

```bash
--runtime=current
--runtime=managed
--runtime=external
--runtime=all
```

`sessions search` and `llm list` take the same `--runtime` flag (default
`current`). `llm list` accepts one runtime only (`all` is refused): managed
lists the Galley model store `llm set` resolves against, external lists the
GUI's attached-GA warmup cache.

`session new` also defaults to the current runtime:

```bash
galley session new "task"
```

If the GUI currently shows Existing GenericAgent, this creates an external
session. If the GUI currently shows Galley, it creates a managed session. This
prevents the worst UX failure: an agent creates a session successfully, but the
user cannot see it in the current GUI mode.

Explicit cross-runtime creation is allowed only when requested:

```bash
galley session new "task" --runtime=managed
galley session new "task" --runtime=external
```

Supervisor SOPs should say: do not pass `--runtime` unless the user explicitly
asks to use another runtime. Let CLI follow the GUI's current mode.

### Existing Sessions

Commands that target an existing session id use that session's recorded runtime,
not the current runtime:

```bash
galley session send <id> "..."
galley session stop <id>
galley session archive <id>
galley session move <id> --to=<project-id>
galley llm set <id> "<llm-name>"
```

The session id is the user's explicit target. Dispatching by the session's own
runtime avoids accidentally applying managed model config to an external
session, or external GA config to a managed session.

### Output Shape

All session-facing CLI responses must include runtime metadata:

```json
{
  "runtimeKind": "managed",
  "runtimeLabel": "Galley"
}
```

```json
{
  "runtimeKind": "external",
  "runtimeLabel": "Attached GenericAgent"
}
```

If a command explicitly creates or mutates something in a non-current runtime,
the response should include a warning:

```json
{
  "warning": {
    "id": "non_current_runtime",
    "message": "session created outside the current GUI runtime",
    "currentRuntimeKind": "external",
    "requestedRuntimeKind": "managed"
  }
}
```

If GUI receives a non-current session-created event, it should show a small
toast that tells the user where the session went and how to see it.

### Status

`sessions list` defaults to current runtime only. `status` should still avoid
hiding active work in another runtime. It can return current runtime detail plus
aggregate counts for other runtimes:

```json
{
  "activeRuntimeKind": "external",
  "current": { "running": 1, "idle": 8 },
  "otherRuntimes": [
    { "runtimeKind": "managed", "running": 1, "idle": 3 }
  ]
}
```

Supervisor agents should summarize current runtime first. If another runtime has
running work, mention it briefly and ask whether to inspect that mode.
