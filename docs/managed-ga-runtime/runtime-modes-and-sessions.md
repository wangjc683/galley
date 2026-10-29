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
  last 10 complete turns before it — a user message and every reply up to
  the next one (ticket 77: a run takes a `turn_index` per step, so a
  multi-step run's answer comes with the message that started it), read
  by the replay's own rules; never the greeting, never a message whose
  reply never came, never a wake (a subtask report, the daily review)
  whose turn ends in a silent reply (`<no-reply/>` and no answer, ticket
  79: the desktop draws nothing for it, so it takes no place either) —
  whichever segment they are in, at most 15,000
  Unicode characters together (images ride along uncounted). Over the cap, whole
  turns go, oldest first. When the latest turn alone is over it, its user
  message and its reply are each sure of half the cap and lend the other
  what they do not need: a cut reply keeps its end (the final answer), a
  cut user message its start and its end (a long one is mostly a paste
  with the request at one end), with `[… cut for length …]` where text
  went. 10 and 15,000 are constants, not prefs. The window is computed from
  the rows before the boundary and nothing else, so the replay after a
  Core restart opens the same way, and the state block, which reads it
  through the same function, says how many turns it carries and when they
  were said (last point). The first segment, every other
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
  are carried over, how many and when they were said (local time to the
  minute: the one turn's time, ticket 11; the first's and the last's when
  there are more, ticket 79) — and sends the model to the Galley CLI for
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
  The assistant decides what to say or do; `<no-reply/>` is allowed. A late
  one asks for the lateness in the reply itself, not GA's `<summary>`, which
  the main chat does not show (ticket 36's eval: the model put it there).
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
- **The morning review** (main chat ticket 73, assistant PRD ruling 10;
  `core/src/scheduler.rs`): the one task Galley makes itself, a daily
  `assistant` task (ticket 78: at a time picked once, when it is made,
  between 08:45 and 09:15 with a minute that is not a multiple of five,
  `review_time_of_day`) with `created_via = 'system'` and supervisor
  `galley-review` (no migration), made when the main chat is asked for and
  once when Core starts, on the managed runtime with a main chat only, and
  once ever: a review row in any state (enabled, paused, cancelled) means
  Galley never makes another. Coming due (a catch-up too), Core first reads
  the list the "In Hand" lines read (`assistant_todo`) and wakes it only
  for what has no alarm of its own (ticket 81, main chat PRD ruling 128,
  `review_has_something_to_look_at`): a to-do of the user's with no due
  date, or due on or before today plus `REVIEW_LOOKAHEAD_DAYS` (3) in this
  machine's zone, overdue ones and ones with a reminder included; or a
  subtask not finished. Since main chat ticket 110 (PRD ruling 155) only
  those that moved since the review before (`last_fired_at`, woken,
  skipped or run by hand; `LastReview`): one of those to-dos noted or
  changed at or after it (`todos.updated_at`, read into the list's item
  but not serialized), one of them whose due date came within the three
  days only now (after that review's local day plus three, by today's);
  a to-do due later stays out, noted or changed since or not; a subtask not
  finished with activity since (`sessions.last_activity_at`); never come
  due, as before. What did not move, an any-time or overdue one included,
  does not wake it; or (main chat ticket 95, PRD ruling 143) a memo
  noted or changed since the day the review last came due, in a turn the
  user started (`MemoReviewWindow`: from that day's local midnight, woken
  or skipped, or yesterday's when it never came due, to today's, today out;
  `memos.fresh_at` in it, the memo holding today and still there). A to-do
  due later, Galley's own one-off tasks (they go off at their time by
  themselves) and routines do not count; a failed read wakes it. With
  nothing to look at, the fire is consumed with `last_wake` NULL and no
  wake; otherwise it wakes the main chat as a reminder does, with words of
  its own (`subtask_report.rs` `review_paragraph`: read "The morning
  review" in `wake.md`, at most two subtasks, silent unless something got
  done; with new memos, a paragraph after it names each by id and text).
  The window is kept with the fire in the `assistant_review_memo_window`
  pref, so a wake written after a restart names the same ones; a run by
  hand (`schedule run`) names the memos of its own window, which is empty
  when the review already came due that day. A run by hand takes no look
  (it always wakes) but stamps `last_fired_at` like any fire, so what moved
  before it no longer wakes the next coming due (ticket 110). A review wake that cannot be
  delivered is dropped (`last_wake` NULL), never notified: its words are for
  the model. Its fires stay out of the to-do list's 已完成. The user stops
  it by asking the main chat, which pauses it (`schedule disable`). Each
  coming due, skip, hand run and dropped wake is appended to the
  `assistant_review_log` pref (at most 400 entries) for the trial snapshot.

### The User's To-Dos

Main chat ticket 39 (PRD ruling 91; `core/src/api/todo.rs`,
`core/src/db/todo.rs`, migration 050): a to-do is something the user has to
do, which Galley notes in the conversation (through the CLI `galley todo`,
ticket 40, [todo-commands](../agent-api/todo-commands.md)) —
title, notes, a due date, a reminder. The user only ticks it off, unticks it,
cancels its reminder, deletes it or changes its title and notes at the
desktop (Tauri `complete_todo`, `reopen_todo`, `cancel_todo_reminder`, since
main chat ticket 88 `cancel_todo`, Core's soft delete recorded as `gui`, and
since ticket 107 `update_todo`, the title and the notes only, as
`todo update --title` / `--notes` change them); everything else, a new time
among it, they say to Galley.
Managed runtime with a main chat only: every write is refused with
`assistant_unavailable:` otherwise.

- **Items** (main chat ticket 111, PRD ruling 157; migration 054,
  `todo_subitems`): one level under a to-do, each only its words and a box,
  in the order added, no time of its own. The user adds, ticks, unticks,
  changes and deletes them at the desktop (Tauri `add_todo_subitems`,
  `complete_todo_subitem`, `reopen_todo_subitem`, `update_todo_subitem`,
  `remove_todo_subitem`), Galley through `todo item …`. Every item write
  stamps the to-do's `updated_at` (the morning review's "moved"); ticking
  the last item does not tick the to-do off, nor does the to-do's tick
  touch them. A cancelled to-do keeps its items and refuses their writes; a
  main chat reset deletes them.

- **Due date**: a day without a time (`due_date`, `YYYY-MM-DD`, a floating
  local date) or a day with a time (`due_at`, a UTC instant); never both.
  Readers group by day in this machine's zone.
- **Reminder**: a scheduled task (one-off, `target = assistant`) linked to
  its to-do (`scheduled_tasks.todo_id`); at most one not cancelled. Setting a
  time updates that task (arming a fired one again) or makes one; removing
  it cancels the task. Ticking off or cancelling the to-do cancels a
  reminder that has not reached the assistant (not gone off, or gone off
  with its wake still pending); one that reached it stays. Unticking brings
  none back. A reminder whose to-do is no longer open never wakes the
  assistant: the scheduler cancels it instead of firing it, the restart read
  of pending wakes leaves it out, and the wake drops it when it reads its
  reports again. Its wake says which to-do, its title and notes, the items
  under it not ticked yet (ticket 111; none when there are none or all are
  ticked), when it is due, with the reminder's planned and actual times
  (`[Galley: reminder <id> for to-do <todo> came due (…)]` in replay).
- **Who cancelled** (ticket 61, PRD ruling 113, migration 051): a to-do's
  or a task's cancel records who made it and why (`cancelled_via`,
  `cancelled_by_supervisor`, `cancelled_origin_note`; wire `cancelledBy`):
  the CLI's `--supervisor` / `--reason`, `gui` for the desktop, `system`
  for Core's own (a reminder going with its to-do). Galley's to-dos and
  tasks the user cancelled at the desktop or Galley cancelled at their
  request, in the last 90 days, are the main chat's "Follow-ups the user
  turned down" in its In Hand lines
  ([prompt composition](./prompt-composition.md)); the panel does not show
  them. A main chat reset clears the records on the tasks it keeps.
- **State**: open, done (`done_at` and who ticked it: `gui` is the user,
  `supervisor` + `galley-assistant` is Galley), cancelled (`cancelled_at`, a
  soft delete: every write then answers `not_found`).
- **Where it was noted**: as for a task — the main chat and the run's
  starting turn when the CLI call comes in, the reply's `turn_index` when
  the run ends.
- **How Galley keeps them**: the [assistant manual](./galley-assistant-manual/)'s
  "To-dos and reminders" (ticket 41; since ticket 59 the parts `todos.md`,
  `todos-change.md`, `times.md` and `reminders.md`). What the user has to do is noted
  unasked, with a reminder on it when it has a date; the assistant's own
  follow-ups (a delivery to check) stay plain scheduled tasks, and so does
  a nudge the user asks for with nothing to finish (「十分钟后提醒我喝水」,
  ticket 44: ignored, it would not need to stay on the list). It ticks a
  to-do off when the user says it is done, finds one quoted from the list
  by its title, and reads `todo list` before saying what is left; the
  entry layer carries one paragraph for these, since none starts with a
  CLI write in sight.
- **Reset**: resetting the main chat deletes every to-do and the tasks that
  were their reminders; the assistant's own tasks stay.
- Every write broadcasts `todos:changed` (and `scheduled-tasks:changed` when
  a reminder moved). The remote module forwards neither.

### The User's Memos

Main chat ticket 95 (PRD rulings 140, 141, 143; `core/src/api/memo.rs`,
`core/src/db/memo.rs`, migration 053): a memo is something Galley knows
about the user (what they are called, their family, preferences, the
people and places they deal with, an interest that keeps coming up), which
it notes in the turn it learns it through the CLI `galley memo`
([memo-commands](../agent-api/memo-commands.md)). A to-do gets done; a
memo holds or stops holding. The user can only delete one at the desktop
(Tauri `delete_memo`, recorded as `gui`); the desktop reads them with
`list_memos` (each with where it was last written in the main chat) and
the cards with `list_memo_events`. Managed runtime with a main chat only:
every write is refused with `assistant_unavailable:` otherwise.

- **Limits** (Core, ruling 141): 1 to 100 characters a memo, refused
  past it; the memos that hold come to at most 2,000 characters, and a
  write past that is kept and says so (`overLimit`).
- **Last day** (`until_date`, `YYYY-MM-DD`, a floating local date, not
  before today when written): after it the memo is in no reader (the
  segment start, `memo list`, the panel, the total) and its row stays.
- **Record of writes** (`memo_events`): each add, update and delete, its
  text after it (before it, for a delete), who wrote it, and the main chat
  turn (the run's starting turn, its reply's `turn_index` when the run
  ends); a delete keeps the record.
- **Fresh** (`fresh_at`): stamped by an add or update in a main chat run
  whose opening user row is not one Galley wrote (`created_via` not
  `system`: not a review's, a reminder's or a subtask's wake). The morning
  review reads it (above); a memo written in a wake's own turn never wakes
  the next review. An update that changes nothing (the same text once
  trimmed, the same last day; ticket 98) is no write: neither `fresh_at`
  nor `updated_at` moves and no event is recorded, so writing the same
  memo again each time the user brings the thing up does not wake the
  review every day.
- **At the start of each segment**: the "Memo" lines after In Hand
  ([prompt composition](./prompt-composition.md#memo-main-chat-only)).
- **How Galley keeps them**: the [assistant manual](./galley-assistant-manual/)'s
  part `memo.md` (ticket 96): what to note unasked and what not, one thing
  a memo (update it, do not add it again; delete one out of date), written
  for the user, and where a thing goes beside the to-dos (a date with
  nothing to do then, what is of use beyond one to-do, a routine, a
  sentence of two lifetimes); what the user is goes here, how to do things
  stays in GA's memory. The entry layer carries one sentence for it, as a
  remark like 「我不吃香菜」 has no CLI write in sight; the morning review's
  question for each new memo is `wake.md`'s.
- **Reset**: resetting the main chat deletes every memo and every record of
  their writes.
- Every write broadcasts `memos:changed`. The remote module does not
  forward it.

### The Assistant's To-Do List

Main chat ticket 37, regrouped by ticket 39 (`core/src/assistant_todo.rs`):
one read of the user's to-dos and what the assistant is on. The desktop
(Tauri `list_assistant_todo`, ticket 42) keeps one copy of it for the
count on the 待办 button in every conversation's top bar (tickets 45,
46) and the to-do panel beside any conversation (ticket 46), and the
main chat's 「在办的事」
lines (ticket 36: the state block's "In Hand" subsection, written at every
main chat runner spawn, [prompt composition](./prompt-composition.md#in-hand-main-chat-only))
are written from the same read — every group but done — so both list the
same things in the same order.

- **Yours** (你的事): to-dos not done, in three parts by their due date read
  in this machine's zone — today (due today or before; overdue ones first,
  marked), later (due after today, soonest first), any time (no due date,
  in the order they were noted). `todayCount` counts today's (the
  sidebar's 「今天 N」).
- **Galley's** (Galley 在办, `assistant`): the main chat's subtasks not
  promoted, not archived and not finished — running (run gate open), asking
  (`ask_user` pending, or the latest run's last reply asks), failed, paused
  at the step limit, stopped short — newest activity first; not running and
  quiet for 7 days: dropped. Then the one-off tasks on no to-do still to go
  off (either target), soonest first, paused last.
- **Routine** (例行): the repeating tasks (either target) by next fire,
  paused last.
- **Done** (已完成): within 7 days (rolling), a to-do ticked off, a one-off
  on no to-do that fired, a routine's last fire, a finished subtask; newest
  first, at most 50 (`doneOmitted` counts the rest).

A to-do's reminder shows on its to-do, in no group of its own. Each item
carries its kind (`todo`, `task`, `subtask`), id, title or words, state,
the instant it is ordered by (UTC), who made it (the assistant, the user's
form, another agent), where it leads (the reply it was noted or set in, a
subtask's session, a scheduled run's session), and for a to-do its notes,
due date, overdue mark, reminder, who ticked it, when it was noted
(`createdAt`, ticket 43) and the items under it (`items`, ticket 111: each
its id, words and box, in the order added). Deterministic and
read-only; the desktop reads it again on the existing events
(`todos:changed`, `scheduled-tasks:changed`, `subtask-dispatched`,
`session-run-state`, session updates), at local midnight, and when a to-do
with a time falls due (overdue starts then; Core sends no event for the
clock). Core's subtask state after a restart
comes from the rows alone: a step-limit or error ending is known only while
the Core process that saw it runs, and reads as stopped short afterwards.

The to-do cards under the replies read a second, read-only list with it,
on the same events (Tauri `list_noted_todos`, ticket 43,
`assistant_todo::noted_todos`): every to-do noted in a turn of the main
chat — not done, done however long ago, cancelled — in the order noted,
each worded as above, a cancelled one with `cancelledAt` (its `state` as it
stood). A card stays under its reply where 已完成 lets a to-do go after 7
days and holds no cancelled one. Empty on the external runtime and before
there is a main chat.

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
