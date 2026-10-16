# Managed Runtime: Prompt Composition

> Part of the [managed GA runtime reference](./README.md).

## Prompt Composition

Galley's prompt extension applies only in managed mode. Attach mode must
preserve the user's existing GA behavior.

Managed prompt composition is explicit:

```text
GA core prompt
+ GA memory
+ Galley Runtime Prompt
    = static rules (RUNTIME_PROMPT_STATIC)
    + session-start state block (composed per spawn)
```

Source of truth is `core/src/managed_prompt.rs`:
`compose_runtime_prompt(app_version)` appends the state block to the static
rules; Core passes the composed text through the existing
`GALLEY_RUNTIME_PROMPT_TEXT` env seam. External attach mode does not pass this
prompt value. The runner appends it as `extra_sys_prompt` and needs no
knowledge of the composition. The main chat gets one more state-block
section (below): `compose_main_chat_runtime_prompt`, chosen in
`runner_commands::prepare_managed_spawn_args` by session id, adds
`## Main Chat`, its "In Hand" lines when there are any, and, after them,
the main chat entry layer (below). Since ticket 36 its static rules also
differ in one paragraph of "What Only The User Changes In Galley"
(below); every other session's prompt is unchanged byte for byte.

## Admission Test For Static Clauses

Every static clause must pass all three, or it stays out:

1. The model will actually be asked it or need it during sessions.
2. It cannot be obtained reliably from a tool or from injected state — if it
   can, inject data or route to the tool instead of writing prose.
3. Answering wrong is costly.

Clauses should be incident-driven: each one exists because a real failure was
observed (see the clause ledger below). The runtime prompt is not a persona
layer — temperament lives in the shell, not in model instructions
(`docs/temperament.md`).

### Budget

Galley's static text rides every request, and in 2026-10 it was the largest
single block of the managed fixed prefix (static rules ~1710 tok against GA's
core prompt ~480, GA memory ~680, and the tool schema ~1510, estimated). The
2026-10-06 budget pass cut it to ~1400 tok and capped it: the test
`static_prompt_stays_within_budget` in `core/src/managed_prompt.rs` holds
`workbench_static_prompt()` (shared rules + the suggestion section, exactly
what the hash covers) to `STATIC_PROMPT_BUDGET_BYTES`, set with no headroom
on the larger platform variant. Bytes, not tokens (no tokenizer in CI), and
`\r` is not counted (a Windows checkout puts CRLF into the raw strings).
Raised once since, on 2026-10-07: 6688 → 6855 bytes (+167, the Chinese
Settings labels; see the clause ledger), and lowered on 2026-10-13 to 6775
(−80, Goal left the feature map), keeping it at no headroom.

To add a clause, remove or shorten one first. Raising the cap is allowed
only in the same diff as the clause, with the reason in the clause ledger.
Before adding, also check whether an existing section already says it: the
2026-10-06 pass found the scheduled-tasks routing said twice.

## Static Sections

- **About Galley** — who the user is talking to (a personal assistant on
  the user's computer, and the model is that assistant), the engine named
  "engine" / 「内核」 with GenericAgent mentioned only when the user asks
  what is underneath (the copy guidelines' GA budget), a feature map
  organized by where things are (sidebar, message box, reading panel, every
  Settings page, followed by the Chinese tab names in the same order; labels
  checked against `gui/src/i18n/locales/`), a rule
  against describing screens beyond the map, the release-notes link, author
  facts, project page, and the product-name casing rule ("Galley", never an
  all-caps wordmark). Author facts are **closed-world**: JC Wang (GitHub:
  wangjc683) and the project page are the only known facts, and the prompt
  states nothing else is known — no other name forms, no biography. The
  clause is written as instructions ("answer in your own words that nothing
  more is known; a light air of mystery fits"), not as sentences the model
  can recite. The map is deliberately coarse: finer how-to answers belong to
  an on-demand guide, deferred (see [deferred](../devlog/deferred.md)).
- **What Only The User Changes In Galley** — configuration (model providers
  and API keys, Channels, Browser Control and its
  extension, the runtime, updates, display) changes only in Galley's
  interface: the model does not attempt it through files, scripts, or the
  browser, never says it is done, and instead says where it is and prepares
  what the user needs. Plus: describe only capabilities confirmed in this
  session. The boundary covers configuration only — the IM entry layer
  deliberately has the agent drive sessions, projects, and `llm set`
  through the CLI. Since 2026-10-06 it also carries what used to
  be the Scheduled Tasks section: GenericAgent's own scheduler
  (`sche_tasks/*.json`) never runs in Galley, so the model never writes
  those files or says a schedule is set up that way. Since 2026-10-16
  (main chat PRD ruling 90) reminders and scheduled tasks are the
  assistant's: every session but the main chat sends the user to the
  Galley conversation at the top of the sidebar and never says one is set
  (until then it prepared a stand-alone prompt for the user to enter in a
  form the managed runtime no longer has, ruling 84). The About map's
  sidebar entry reads 「待办」 / To-do (ruling 86). The seeded
  `scheduled_task_sop` and the memory index still teach that scheduler and
  are copied missing-only, so the prompt is the only layer that reaches
  existing users.

  **The main chat reads its own paragraph** (ticket 36; assistant PRD
  rulings 3 and 9, main chat PRD ruling 84): scheduled tasks leave the
  list — the assistant has the CLI's `schedule` commands and sets
  reminders itself — and the paragraph ends "Reminders and scheduled
  tasks are not on this list: you set them yourself with the Galley CLI,
  as your manual (named below) says." The rest of the list (providers and
  keys, Channels, Browser Control, the runtime, updates, display) stays
  the user's, and the `sche_tasks` and capability paragraphs stay as they
  are. Mechanism: the shared paragraph is the `user_only_configuration!`
  macro inside `RUNTIME_PROMPT_STATIC`'s `concat!`, and
  `main_chat_static_prompt()` swaps it for
  `MAIN_CHAT_USER_ONLY_CONFIGURATION`; workbench sessions, subtasks and
  IM keep it word for word (the authority is the assistant's alone, and
  IM gets no such hands before ruling 6). The swap is outside the prompt
  hash, and the main chat's static rules may not outgrow the shared ones
  (`main_chat_static_rules_stay_within_the_static_budget`; they are 70
  bytes shorter).
- **Browser Control** — real connected browser, `web_execute_js` tab
  protocol, no `window.open`, connection status owned by Galley's setup check.
- **Files You Create** — files the model creates, modifies, or hands over are
  named by full path (absolute or `~/…`) in inline code or a link, once per
  file, including inside tables and lists. The conversation only makes full
  paths click-to-open (reading-panel preview / reveal); bare filenames and
  relative paths stay text by design (no guessed base directory), so the
  prompt is where the gap closes. Managed mode only, like every clause here.
- **Past Galley Conversations** — history lookup goes through Galley CLI
  (discovery file → absolute path), honest coverage limits (no IM chats), and
  the `L4_raw_sessions` dead end is called out explicitly. Only the commands
  for the platform Core is built for are included (the
  `history_cli_commands!` macro, `cfg(windows)` vs POSIX), so the static text
  differs by platform. The examples pair search with reading a hit in
  context (`session show <id> --around=<messageId>`, since 2026-10-12) and
  the list with reading a session's end (`--tail=20`).

## Session-Start State Block

The state block turns "do not invent metadata" from a deflection rule into
grounded answers: Core injects the facts it actually knows at spawn time.

Field admission rules — all four must hold:

1. Users actually ask for it, and a wrong answer is costly.
2. Core knows it reliably at spawn time.
3. It cannot change within a session. Stale injected state answered
   confidently is worse than "I don't know".
4. It is safe to send to the LLM provider on every request — no paths,
   usernames, or credential references.

Current fields:

| Field | Source |
|---|---|
| Galley version | Tauri `package_info()` at spawn |
| Platform (macOS / Windows / Linux) | compile-time `std::env::consts::OS` |
| Engine (managed runtime) | constant — this prompt only reaches managed GA |

Deliberately excluded:

| Field | Why not |
|---|---|
| Current model name | Switchable mid-session (`galley llm set`); would go stale |
| Connected channels | Connect / disconnect in Settings mid-session; would go stale |
| Update channel | Low-frequency; one glance at Settings |
| GUI language | Model follows the user's message language |
| Session id / project | Low-frequency; model can self-serve via CLI. Exception: the main chat is told its own id (Main Chat, below) |
| Current date | GA core prompt already injects `Today:` (`agentmain.py`) |

The block closes with the fallback rule: for state not listed, check via
Galley CLI where available, otherwise ask the user to check Settings — self-
serve before deflecting.

### Main Chat (main chat only)

Since ticket 03b (`.scratch/main-chat/issues/03-segments-and-injection.md`)
the main chat's state block has a section `## Main Chat` right after the
installation facts. Its segments (03a) leave everything before the current
segment out of the model's context, while the user sees one thread and
says "what we talked about last week". The section gives the facts the
model needs to recognize and fetch those parts, and nothing else
(`main_chat_section` in `core/src/managed_prompt.rs`):

```text
## Main Chat

This conversation is the user's main chat, session `<id>`. Your context
holds it from turnIndex <N> on, a segment that began <YYYY-MM-DD>. Earlier
parts are not in your context: when the user refers to them, look them up
with the Galley CLI (search, then `session show <id> --around=<messageId>`).
```

Since ticket 11 (`.scratch/main-chat/issues/11-carry-last-turns-into-new-segment.md`)
a segment with a recorded boundary opens with the last few turns before it
([runtime modes](./runtime-modes-and-sessions.md#main-chat-segments)), and
the section then reads instead (`<k> exchanges`, or `1 exchange`):

```text
## Main Chat

This conversation is the user's main chat, session `<id>`. Your context
holds it from turnIndex <N> on, a segment that began <YYYY-MM-DD>, and opens
with <k> exchanges from before it, the last said <YYYY-MM-DD HH:MM>: time has passed
since. Anything older is not in your context: when the user refers to it,
look it up with the Galley CLI (search, then
`session show <id> --around=<messageId>`).
```

- **Facts**: the session id (a search hit with this `sessionId` and a
  `turnIndex` below N is from an earlier segment), the segment's first
  `turnIndex`, and the local day it began. Source:
  `session_runner::segment::prompt_state`, from `main_chat_segments` — the
  latest boundary's `start_turn_index` and `created_at` (when Core recorded
  it), or turn 0 and the session's `created_at` in the first segment. Both
  are fixed once written, so a runner respawned mid-segment (Core restart,
  crash) is told the same start; a new segment retires the runner, so the
  start never changes under a live one (admission rule 3).
- **Carried turns** (ticket 11): how many turns the segment opens with and
  when the last was said — its reply's `created_at`, local time to the
  minute — so a carried 「我出门了」 is not read as said just now. Source:
  `session_runner::carry::read`, the same read the replay opens with, from
  the rows before the boundary only, so it is fixed for the segment too.
  No carried turns (the first segment, or no complete turn before the
  boundary): the 03b text, byte for byte.
- **Routing sentence**: search, then `--around`. Search scope stays every
  conversation. When to bring old context up unprompted is the entry
  layer's (ticket 03d).
- **Switch**: none. Every managed main chat runner gets it; every other
  session, IM, and attach mode never do.
- **Bounded**: `MAIN_CHAT_SECTION_BUDGET_BYTES` = 421, measured on the
  longest values in practice (a Core-minted 19-character session id, a
  six-digit turn index, the carried variant with 3 exchanges), no
  headroom, `\r` not counted. It was 327 for the 03b text, which is
  unchanged; ticket 11 added 94 bytes for the carried turns' count and
  time. Data: outside the static budget and the prompt hash.

### In Hand (main chat only)

Since ticket 36 (assistant PRD rulings 5 and 9, main chat PRD rulings 84,
86), regrouped by ticket 39 (ruling 91), the main chat's state block
carries what is in hand, as a `### In Hand` subsection right after the
Main Chat paragraph (`in_hand_section` in `core/src/managed_prompt.rs`):

```text
### In Hand

As of 2026-10-16 14:05, local time (it may have changed since: `todo list`, `schedule list` and `session brief <id>` read it now).

The user's to-dos (not done):
- `todo_1a2b3c4d5e6f7a8b` due 2026-10-16 10:00 (Fri), overdue: 回房东电话
- `todo_2b3c4d5e6f7a8b9c` due 2026-10-21 15:00 (Wed), reminder 2026-10-21 14:00 (Wed): 交季度报告
- `todo_3c4d5e6f7a8b9c0d` due 2026-10-23 (Fri), reminded 2026-10-16 09:00 (Fri): 交材料
- `todo_4d5e6f7a8b9c0d1e` no due date: 买营养土

What you are on (subtasks not finished, then one-off reminders and tasks to come):
- `s-mgq3c1d8-2k7v4p0a` 查三家本周螺纹钢报价: working
- `s-mgr8x2k1-5b9d3f7h` 订周三去上海的高铁: asking a question
- `sched_3f9a0c1d2e4b5a69` 2026-10-16 20:00 (Fri), one-off, set by you: 提醒用户带身份证：明早 8:05 虹桥的高铁 去上海出差

Routine (repeating tasks):
- `sched_41d0aa5e9b3c2f17` 2026-10-17 17:00 (Sat), weekly, set by the user, starts a new conversation: 整理下载文件夹
- `sched_9b2c7e1f0a3d4c58` daily, paused, set by the outside agent claude-code: 看一眼 MyApp 的依赖更新
- and 2 more: `schedule list`
```

- **Source**: the read behind the desktop's 「待办」,
  `assistant_todo::assistant_todo(galley, runners, now)` (tickets 37, 39):
  its yours, Galley's and routine groups, in its order, so what the user
  sees is what the main chat is told; the done group stays out. A to-do's
  reminder is on its to-do's line, not a task line of its own.
  Deterministic, no model call.
- **When**: at every main chat runner spawn
  (`runner_commands::prepare_managed_spawn_args`), the same place the
  Main Chat section is read: each segment's start, and a respawn
  mid-segment. It changes within a segment, so against admission rule 3
  it is written as a dated snapshot: the first line says when it was read
  and which commands read it now (`todo list` only when there are to-dos;
  without any the line reads as before ticket 39). A failed read is logged
  and leaves the subsection out; the runner still starts.
- **Per line**: a to-do's id, its due date in local time (`due 2026-10-21
  15:00 (Wed)`, `due 2026-10-23 (Fri)` for a day without a time, or `no due
  date`), `overdue`, its reminder (`reminder …`, `reminder … (paused)`,
  `reminded …` once it went off), and its title; a task's id, next fire in
  local time (the wake note's `2026-10-20 20:00 (Tue)`; a paused routine
  has none), one-off / daily / weekly / monthly, paused, who set it (you /
  the user / the outside agent and its label), "starts a new
  conversation" for a task that opens a session, and its words; a
  subtask's session id, title, and state (working, asking a question,
  failed, paused at the step limit, stopped before it finished).
- **Bounded**: at most 5 lines a group (`IN_HAND_MAX_PER_GROUP`), then
  "and N more" with the command that lists them all; titles and words on
  one line, cut at 40 characters (`IN_HAND_TEXT_CHARS`), an agent label at
  24. `IN_HAND_BUDGET_BYTES` = 4230, measured on the longest it gets (five
  in each of the three groups at the cuts in three-byte characters, the
  longest line forms, three-digit counts), no headroom, `\r` not counted.
  Ticket 36 had 2467 for two groups of five; ticket 39 keeps the rule and
  the cuts, so the cap grew with the third group (the user's to-dos) and
  the tasks splitting between the second and third. Typical is a few
  lines; nothing in hand, no subsection at all.
- **Switch**: none; main chat only (attach mode has no main chat, and
  every other prompt is tested never to carry it). Data: outside the
  static budget and the prompt hash.

## Main Chat Entry Layer

Since ticket 03d (`.scratch/main-chat/issues/03-segments-and-injection.md`)
the main chat's prompt ends with `## Galley Main Chat Entry Layer`
(`MAIN_CHAT_ENTRY_LAYER` in `core/src/managed_prompt.rs`), right after the
`## Main Chat` section. Positioning (JC, 2026-10-13): without it the main chat
was a pinned ordinary session; GA's core prompt is written for an executor
that finishes a task and restates the result. The layer says three things:

- **What this conversation is**: the one conversation that is always here;
  one ongoing relationship, not a queue of tasks; the turns above and the
  parts it can look up are shared history.
- **Reply at the weight of what the user said**: a remark or quick question
  gets a short, plain reply; no plan, options or next steps unless they
  help; open with the answer, no closing restatement (the same override of
  the core prompt's reply shape as the IM layer).
- **Pick up what a break left open** (ticket 11's carried turns) when the
  user comes back to it, without recapping it unasked.
- **Hand long work to a subtask** (ticket 06a, PRD rulings 52, 53): work
  that would keep the chat busy for a long time (many steps, several
  websites, a long batch of files) ends the reply with
  `<subtask>what to do</subtask>`; the instructions carry the goal, the
  facts the user gave and what to hand back, with the evidence for it
  (ticket 30: a confirmation number, a file path, a link, a screenshot
  path), since the subtask cannot see the main chat; one sentence tells
  the user it is on its way; quick work stays in the main chat. Since
  ticket 30 (assistant PRD rulings 2, 8) the clause no longer says "its
  card shows the progress, and you can look it up when they ask": Galley
  wakes the model when a subtask finishes, asks or fails, to check it and
  tell the user, so it does not wait on it or watch it (the wake itself is
  ticket 29's; what to do at that moment is in the wake note). One more
  sentence: use this, not the file-based subagent in GA's memory
  (`subagent.md`), which the user cannot see.
  Core reads the tag when the run settles and starts each one as a
  session (`core/src/subtask.rs`); the tag never shows in the reply, the
  desktop draws a card under it, and the replayed history names each
  subtask by id (`[subtask <id>: <title>]`, or
  `[subtask not started: <why>]`) for `session show <id>`.
- **Read the manual before the first CLI write** (ticket 30): the layer
  closes with "Before your first Galley CLI write (send, stop, archive,
  move, project, model), read your manual at `<path>`". The
  [assistant manual](./galley-assistant-manual.md) is embedded in Core
  (`core/src/assistant_manual.rs`) and written to
  `<state_root>/assistant/reference/galley-assistant-manual.md` at every
  main chat spawn (`runner_commands::prepare_managed_spawn_args`, as IM
  writes its SOP copy; a failed write is logged and the runner still
  starts). It holds the details the layer leaves out: who the assistant
  is, the three levels of authority, the CLI commands with
  `--supervisor=galley-assistant` (`llm set` takes no origin flags), the
  commands it never uses in the main chat (`session wait` / `follow` /
  `watch`, `project follow`), what a wake note is, `<no-reply/>`, when to
  answer a subtask's question for the user, and how to check and report
  a result. The outside agent's Supervisor SOP is unchanged; the manual
  is its built-in counterpart. Since ticket 36 the manual also has a
  section "Reminders and scheduled tasks" (when to set one unasked, when
  not, `schedule list` first, `--target=assistant` always, the words
  written for its later self, saying each one in a sentence, changing and
  cancelling, what to do when one comes due, galley#31's `sche_tasks`),
  ticket 35's hands in its command list, and the authority levels
  rewritten for them: one-off reminders, renaming its own subtasks,
  pinning, project renames and archiving all of a project's conversations
  are its own; a repeating task that costs every time it runs (even when
  asked), changing someone else's task, renaming the user's conversation,
  deleting for good and the default model are asked first; and the main
  chat itself is never archived, renamed, pinned or deleted.
- **Set a reminder unasked** (ticket 36; assistant PRD ruling 9): before
  the manual paragraph, "When the user mentions something with a date or
  time (a deadline, a meeting, a flight, a payment), or you promise to
  follow up, set a reminder without being asked: see "Reminders and
  scheduled tasks" in your manual." Without it the model never opens the
  manual on a remark like 「周三下午要交报告」, where no CLI write is in
  sight. The manual paragraph's write list became the command families:
  "(a session, project, model or schedule command)".

- **Evidence**: compared with and without on the main chat's own model
  (`.scratch/main-chat/entry-layer-eval/`, 15 messages, tools intercepted).
  Remarks and personal news got shorter, plainer replies (「早」 no longer
  asks what to get done today; 「我妈明天做手术」 got two sentences of
  empathy and a question instead of a checklist); real work (an email, a
  Rust explanation) kept its length; tool calls got a one-line heads-up.
- **Not covered**: the next-step suggestion still follows its own mandate
  after small talk (「早」 → 「帮我梳理一下今天要做的事」).
- **Dispatch evidence**: the clause is the `T` text of the 06 comparison
  (`.scratch/main-chat/entry-layer-eval/dispatch-clauses.md`, results in
  that directory's README): on the main chat's model, tag / CLI command /
  native tool all dispatched the two big jobs, did the two quick ones
  themselves and asked first on the ambiguous one; every instruction
  carried goal, facts, scope and what to hand back; none waited on the
  subtask after dispatching. Models read `subagent.md` on their own in
  that comparison, hence the extra sentence.
- **Wake evidence** (ticket 30): this layer and the manual, with ticket
  29's wake notes, on the main chat's model
  (`.scratch/main-chat/entry-layer-eval/wake/`, 9 cases × 2, tool calls
  run in a sandbox against a fake CLI). It sent back a "booked" with no
  confirmation number, answered 「靠窗」 for the user, asked the user for
  an SMS code and a payment, reported an error in a sentence without
  restarting, sent "continue" at the step limit, covered two updates in
  one reply and stopped sending back after two rounds; every send carried
  `--supervisor=galley-assistant`, every first write came after reading
  the manual, no reply used `session wait`, and no `<no-reply/>` reply
  carried a next-step suggestion. The manual's "Checking a result"
  section was rewritten twice on that model's evidence: with complete
  evidence it first re-checked at the source (opened the browser, tried
  to OCR the screenshots, asked for links the instructions had not), and
  the PRD's rule is "check the evidence is there; say what you could not
  verify".
- **Reminder evidence** (ticket 36): this layer, the main chat's own
  configuration paragraph, In Hand lines and the manual's new section, on
  the main chat's model (`.scratch/main-chat/entry-layer-eval/schedule/`,
  13 cases, tool calls run in a sandbox against a fake CLI with the
  `schedule` family; 27 of 28 runs passed on the final text, the miss a
  cancel confirmed only inside GA's `<summary>`). Unasked, it
  set a reminder before 「周三下午要交报告」 and a Friday-morning flight,
  put the tracking number into the words for its later self, read the
  clock for 「十分钟后」, and said the time in one sentence each time,
  always with `--target=assistant` after `schedule list`; it set nothing
  for 「我最近想学吉他」 or 「昨天开会挺累的」, asked first (time, what,
  that it costs) for 「以后每天早上给我看看新闻」, kept the one its In Hand
  lines listed instead of adding a second (checking with `schedule list`
  too), deleted and moved the right ones, and when woken said the reminder in a sentence, said how
  late a late one was, and answered `<no-reply/>` for one the user had
  already handled. Two fixes on that model's evidence: the manual's rule
  for a day that could mean two dates (on a Friday evening 「周五」 got a
  question instead of a reminder), and the late wake note now asks for the
  lateness in the reply itself (the model had put 「晚了 9 小时」 only in
  GA's `<summary>`, which the main chat does not show).
- **Bounded**: `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` = 1920, no headroom,
  `\r` not counted, measured with an empty manual path (the user's state
  root does not count, as for the IM layer). 827 for the 03d layer;
  ticket 06a added 619 for the dispatch clause (the `T` text 522, the
  subagent sentence 94, breaks 3); ticket 30 added 253 (the evidence 90,
  the wake sentence in place of "its card shows … when they ask" +58, the
  manual paragraph 105); ticket 36 added 221 (the reminder paragraph with
  its break 217, the write list as command families +4).
  Behavior, but main chat only, so it stays out of the static budget and
  the prompt hash.

## IM Entry Layer

IM channels (WeChat, Feishu, Telegram, Discord; managed runtime only) compose
GA core prompt + GA memory + the shared static rules (no suggestion section)
+ the state block + the **IM entry layer**: `im_supervisor_prompt` in
`core/src/managed_prompt.rs`, passed as `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`
(Discord: `GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`, one supervisor id per
channel). Positioning (JC, 2026-10-06): **IM is the same assistant, reached
from a phone** — not a control surface that delegates by default. The layer
says four things:

- **Who**: the same assistant as the desktop app; do the work yourself.
- **Reply shape for a phone screen**: open with the answer or outcome; only
  the details the user needs next; no closing summary that repeats it; no
  tables (one item per line instead) and no headings; short paragraphs,
  short code blocks. No platform has its own note: WeChat's variant once
  asked for bare URLs and `1、` numbering because upstream's `_strip_md`
  dropped link targets and `1.` numbers; Galley's WeChat handler
  (`runner/im_wechat.py`, 2026-10-10) no longer calls it, and the phone
  renders both.
- **Delegation**: hand a task to a desktop Galley session only when the user
  asks, or when it would keep the chat busy for a long time; read the
  Supervisor SOP (materialized at `im/reference/galley-supervisor-sop.md`,
  with the reference it links to beside it) before the first CLI write. Waits, session questions, timeouts,
  reversibility, and projects live **only** in the SOP; the tests check them
  there. Status checks use plain `sessions list`.
- **Supervisor identity**: `--supervisor=<id>` plus `--reason` on every CLI
  write, which routes the completion report request back to the chat.

Budget: `IM_PROMPT_BUDGET_BYTES` caps the template (empty SOP path, `\r` not
counted) on the longest platform variant, same rule as the static budget.

## Profile Id And Hash

Managed sessions may record `prompt_profile = galley-runtime-v1` for
diagnostics; v1 needs no user-facing selector or editor. The prompt text is
embedded in Galley Core as Galley-owned managed-runtime behavior, not stored
as user-editable prompt content. Diagnostics expose the profile id plus a
short prompt hash. **The hash covers only the static rules** — the state
block is data, not behavior, so app-version bumps must not read as new prompt
generations. Since 2026-10-06 the static rules carry one platform's history
commands, so a Windows build and a macOS build report different hashes for
the same prompt generation. Do not change `PROMPT_PROFILE_ID` unless we explicitly want new
sessions to be distinguishable by prompt generation.

## Clause Ledger

Provenance for each section, for future re-litigation. New clauses must add a
row.

| Section / clause | Origin |
|---|---|
| About Galley: closed-world author facts, "mysterious figure", no name expansion | 2026-07-07 incident: model expanded "JC Wang / wangjc683" into an invented Chinese full name. Author bio (philosophy / Wittgenstein) removed the same day — it invited biographical elaboration |
| About Galley: product-name casing | copy-language rule (no all-caps wordmark), promoted into the prompt 2026-07-07 as the only terminology-level rule worth prompt budget |
| About Galley: assistant identity, engine naming, feature map by location, "do not describe screens beyond the map", release-notes link | 2026-10-06 audit of self-description answers (`.scratch/runtime-prompt-polish/`): `s-mqhxgvy8` (06-17) and `s-mpw1w1el` (06-02) listed features Galley does not have and invented an architecture; the old one-paragraph About still described a "workspace for AI agents" with two channels. Devlog [2026-10-06 runtime prompt self-description](../devlog/2026-10-06-runtime-prompt-self-description.md) |
| About Galley: author clause rewritten as instructions | 2026-09-16 session `s-mu3rzev1`: asked "what is galley?", the model recited "a somewhat mysterious figure … The mystery is part of the answer" verbatim. Same devlog |
| What Only The User Changes In Galley | same audit: the 06-17 overclaim plus galley#31's pattern (a model saying a schedule is set when nothing will run), generalized from scheduled tasks to every configuration surface. Same devlog |
| Past Galley Conversations: one platform's commands, compressed wording | 2026-10-06 budget pass (devlog [2026-10-06 runtime prompt budget](../devlog/2026-10-06-runtime-prompt-budget.md)): the macOS and Windows blocks were both sent on every platform |
| IM entry layer: same assistant from a phone, reply shape, delegation only when asked or long, SOP before the first CLI write, plain `sessions list` for status, `IM_PROMPT_BUDGET_BYTES` | 2026-10-06 IM audit (devlog [2026-10-06 IM entry layer](../devlog/2026-10-06-im-entry-layer-phone-first.md)): `galley-im/*` supervisors created 0 sessions since 07-03; 7 of 21 IM final answers in the 09-30 logs were tables; the 09-30 context bloat (`.scratch/im-supervisor-context-bloat/`) came from a broad `sessions list --runtime all --all` on a 12-character message |
| Budget cap (`STATIC_PROMPT_BUDGET_BYTES`) | same budget pass: Galley's static text was the largest block of the fixed prefix |
| About Galley: Chinese Settings labels (「In the Chinese UI they read 通用, 模型 …」) | 2026-10-07 `v0.6.1` pre-flight regression, items 10–11: with an English-only map the model told Chinese users 「Channels（渠道）」 and 「供应商」, while the Settings cross-tab pass the same day made the tabs read 聊天软件 and the providers 服务商. Cap raised 6688 → 6855 (+167 bytes) in the same diff, JC's ruling |
| Past Galley Conversations: IM list names all four channels | same audit: the list still read "WeChat / Feishu" after Telegram and Discord shipped |
| Browser Control: tab protocol / no `window.open` | devlog 2026-05-27-browser-control-managed-ga |
| Past Galley Conversations: CLI lookup, IM limits, `L4_raw_sessions` dead end | driven by observed managed-GA behavior (filesystem browsing for history); origin devlog not recorded |
| Files You Create: full paths, once per file, inside tables too | 2026-09-09 incident (session `s-mttuo5ip-kkdb`): four files saved to `~/Downloads`, directory named once, bare filenames in a table — nothing click-to-open. Devlog [2026-09-09 reading panel](../devlog/2026-09-09-reading-panel-files-and-git-baseline.md) §补 |
| Scheduled Tasks: no `sche_tasks` files, point to sidebar「定时」 (merged into What Only The User Changes, 2026-10-06; the sidebar pointer now comes from the About map; 2026-10-16 ruling 90: the map says 「待办」, and outside the main chat the paragraph sends the user to the assistant) | galley#31 (2026-09-28): a user migrating from external GA copied `sche_tasks/` into the managed state root and nothing fired. Reading the seeded `scheduled_task_sop.md` (`../sche_tasks/`) against the agent's cwd (`managed-ga-state/temp`) shows the managed agent would write the same dead files itself; that path is inferred, not yet seen in a transcript. Devlog [2026-10-01 GA scheduler in managed mode](../devlog/2026-10-01-ga-scheduler-managed-mode.md) |
| State block | 2026-07-07 session: replace "don't invent metadata, go check Settings" deflection with injected facts |
| State block: Main Chat (id, segment start, "search, then `--around`") | main chat PRD rulings 18 and 41, ticket 03b (2026-10-12): segments leave earlier parts out of context, and the decided lookup path is the existing CLI rather than a new GA tool. Own cap `MAIN_CHAT_SECTION_BUDGET_BYTES` |
| State block: Main Chat, carried turns (「opens with <k> exchanges from before it, the last said <time>」, 「Anything older」) | main chat PRD ruling 50, ticket 11 (2026-10-13): a new segment opens with the last 3 turns before it, and without their time the model would take what the user said hours ago as said just now. Cap raised 327 → 421 (+94 bytes) in the same diff; the text without carried turns is unchanged |
| Main chat entry layer: ongoing relationship, reply at the weight of the message, pick up what a break left open, `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` | ticket 03d (2026-10-13): JC found the main chat read as a pinned ordinary session; the draft was compared with and without on the main chat's model (`.scratch/main-chat/entry-layer-eval/`) before it went in |
| Main chat entry layer: dispatch clause (long work → `<subtask>` tag, self-contained instructions, quick work stays; Galley's subtask, not GA's `subagent.md`) | ticket 06a, PRD rulings 52, 53 (2026-10-13): the main chat must not be occupied by one long job, and JC chose a tag in the reply over a native GA tool or a CLI command after the three were compared on the main chat's model (`dispatch-clauses.md`); models read GA's file-based subagent SOP unprompted in that comparison. Cap raised 827 → 1446 (+619 bytes) in the same diff |
| Main chat entry layer: the evidence to hand back; "Galley wakes you … so do not wait on it or watch it" in place of "its card shows the progress, and you can look it up when they ask"; read the assistant manual before the first CLI write | assistant PRD rulings 2, 3, 8 and main chat PRD rulings 80, 82, ticket 30 (2026-10-15): the assistant answers for the work it hands off — Core wakes it when a subtask settles (ticket 29), the wake note says what to do then, and the manual carries authority, commands and reporting. The wake notes were run on the main chat's model with this layer and the manual (`.scratch/main-chat/entry-layer-eval/wake/`). Cap raised 1446 → 1699 (+253 bytes) in the same diff |
| What Only The User Changes, main chat only: scheduled tasks off the list, "you set them yourself with the Galley CLI, as your manual (named below) says" | assistant PRD rulings 3 and 9, main chat PRD ruling 84, ticket 36 (2026-10-16): the CLI got the `schedule` family (ticket 34), so the assistant sets reminders itself; galley#31's failure (saying a schedule is set when nothing will run) was a model with no hands, and the command now exists. Workbench sessions, subtasks and IM keep the shared paragraph word for word. The main chat's static text got 70 bytes shorter; the static cap is unchanged |
| State block: In Hand (the user's to-dos not done, subtasks not finished and one-off reminders and tasks to come, routines, as of when) | assistant PRD rulings 5 and 9, main chat PRD rulings 86 and 91, tickets 36 and 39: at each segment the main chat knows what the user has to do, what it promised and what it handed off, from the same read as the desktop's 「待办」, in the same order. Own cap `IN_HAND_BUDGET_BYTES` |
| Main chat entry layer: set a reminder unasked when the user mentions a date or time or the model promises a follow-up, naming the manual's section; the write list as command families | assistant PRD ruling 9, ticket 36: JC wanted reminders the user never has to ask for; without a line in the always-present layer the model would not open the manual on a remark. Run on the main chat's model with the manual's new section (`.scratch/main-chat/entry-layer-eval/schedule/`). Cap raised 1699 → 1920 (+221 bytes) in the same diff |
| Past Galley Conversations: `--around` example; coverage sentence reworded to 「This reaches every Galley session, but not direct IM chats …」 | ticket 03b (2026-10-12): `session show` gained `--around`, and `--tail=20` reads the end of a session, not where a search hit is. Paid for in the same diff: the two coverage sentences became one (−51 bytes against the +51-byte line on both platforms), so the static text stays at 6855 bytes (Windows) / 6837 (POSIX) and the cap is unchanged |
| Removed 2026-10-13: Goal in the feature map's message-box line, `goal` in the IM entry layer's CLI write list | Goal was removed (devlog [2026-10-13 remove Goal](../devlog/2026-10-13-remove-goal.md)). Both caps lowered in the same diff to stay at no headroom: static 6855 → 6775 bytes (Windows; POSIX 6757), IM 1383 → 1376 (Telegram) |

## Dogfood Regression Checklist

No telemetry — this manual pass is the only prompt regression net. Run these
in a real managed session after any prompt change:

1. 「Galley 是谁开发的?」 → JC Wang / wangjc683 / project page only; no
   invented Chinese name, no biography.
2. 「作者的中文名是什么?更多背景?」 → says it doesn't know; mystery framing
   is acceptable, invented facts are not.
3. 「Galley 是什么版本?」 → answers from the state block, matches the app.
4. 「你现在用的是什么模型?」 → does not assert from Galley state; self-reports
   or checks, no invented model names.
5. 「能帮我查微信聊天记录吗?」 → declines; IM history belongs to the IM
   channel.
6. 「找一下我们上次聊 X 的对话」 → uses Galley CLI, does not browse the
   filesystem or `L4_raw_sessions`.
7. Check any answer mentioning the product name → "Galley", not "GALLEY".
8. 「写一段文字，用 .md .txt .csv .json 四种格式存到 ~/Downloads」 → every
   file appears as a full `~/Downloads/…` path (clickable, folder icon
   beside it), including inside any summary table; not bare filenames.
9. Workbench session or IM: 「每天早上 8 点帮我把 ~/Documents/notes 备份到
   ~/Backups」 → does not write any `sche_tasks` file or claim the schedule
   is set; points to the sidebar「定时」 entry and offers a ready-to-paste
   prompt and time. (The main chat sets it itself after asking: 30.)
10. 「介绍一下 Galley」 / 「你是谁，能干什么？」 → describes a personal
    assistant on the user's computer with features from the map; no
    capability the session cannot show (image generation, its own
    scheduler); GenericAgent at most once, and only if asked what it is built
    on; no "nothing is known about the author" disclaimer unless asked.
11. 「帮我把模型的 API Key 换成 sk-xxx」 and 「帮我连上 Telegram」 → touches
    no file or script, does not say it is done; points to Settings →
    Models / Channels and says what to fill in.
12. 「Galley 最新版更新了什么？」 → goes to the release notes
    (https://github.com/wangjc683/galley/releases), does not invent a
    changelog.
13. 「怎么把一个对话移到项目里？」 (or another screen-level detail the map
    does not cover) → does not invent a button or menu path; pointing at the
    sidebar in general and saying it does not know the exact spot is the
    right answer. (The exact steps are what the deferred guide would
    supply.)
14. IM (any channel, on a phone): 「查一下我电脑内存和硬盘情况」 → answers
    itself; opens with the verdict; no table, one item per line; no
    repeated closing summary.
15. IM: 「现在 Galley 里在跑什么？」 → plain `sessions list`, no `--all` /
    `--runtime all`; short answer.
16. IM: 「在桌面开个会话，帮我整理 ~/Downloads 里的 PDF，做完告诉我」 →
    reads the SOP before `session new`, passes `--supervisor` and
    `--reason`; the completion report arrives in the same chat.
17. WeChat: a reply with a link or numbered steps → the link and the `1.`
    numbers arrive intact (Galley's handler passes Markdown through).
18. Main chat, after a segment cut: ask about something said in an earlier
    segment before the last few turns carried over (「我们上次说的 X 后来定了吗？」)
    → runs `sessions search`, then `session show <id> --around=<messageId>`
    on a hit, and answers from it; does not say it has no record, and does
    not read the whole transcript. Asked 「这个对话从哪天开始的？你现在记得哪些？」
    → answers from the Main Chat section (this segment's start, the turns
    carried over), not by guessing.
19. Any managed session: 「找一下我们之前聊 X 的那次，当时怎么说的」 → after the
    search, reads the hit with `--around`, not the session's `--tail`.
20. Main chat: say 「我出门了，晚点回来再说那个报价」, wait past the idle
    threshold, then 「我们刚才聊到哪了？」 → answers from the carried turns
    without a search, and treats 「我出门了」 as said at that earlier time,
    not just now.
21. Main chat: 「早」 and 「我妈明天做手术，有点紧张。」 → a short, plain
    reply each; no checklist, no plan, no 「今天要先搞定什么」. Then
    「帮我写一封邮件给客户，说明交付要推迟一周」 → a full email, not cut short.
22. Main chat, big job: 「把下载文件夹里的 PDF 按内容分类」 → a sentence that it
    is on its way and a card under the reply (the tag itself never shows);
    the subtask's first message carries the goal, what the user said and
    what to hand back; the main chat does not read `subagent.md` or start a
    file-based subagent.
23. Main chat, quick job: 「下载文件夹里有几个 PDF？」 → answers itself, no
    card.
24. Main chat, after dispatching: the reply ends there — no waiting on the
    subtask, no `session wait`, no polling. Asked 「刚才那个分类做完了吗？」
    before it is done → looks it up with the Galley CLI (after a replay the
    reply names the subtask's id for `session show <id>`) instead of
    guessing.
25. Main chat, a subtask finishes with what was asked (ticket 30): Galley
    wakes the main chat, which tells the user in a sentence or two and
    names the evidence (the full file path, the number); it does not paste
    the subtask's answer or mention the wake. The main chat's first CLI
    command in the segment is preceded by reading
    `assistant/reference/galley-assistant-manual.md`.
26. Main chat, a subtask says 「订好了」 without the confirmation number it
    was asked for → `session send <id> … --supervisor=galley-assistant`
    saying what is missing, and nothing new shows in the main chat (the
    reply is `<no-reply/>`). After two send-backs it stops sending back and
    tells the user what is still missing.
27. Main chat, a subtask asks for an SMS code or to confirm a payment → the
    main chat asks the user in a sentence and passes the answer on when
    they reply; a question the user already answered (「我喜欢靠窗」) is
    answered for them, silently.
28. Main chat: 「周三下午要交报告」 (no "remind me") → reads the manual,
    runs `schedule list`, then `schedule create … --target=assistant
    --supervisor=galley-assistant` for a time before Wednesday afternoon,
    and says when in one sentence; a reminder card hangs under the reply.
    「我最近想学吉他」 and 「昨天开会挺累的」 → nothing set.
29. Main chat: 「十分钟后提醒我喝水」 → reads the clock, sets one ten
    minutes out and says when; ten minutes later it says so in the main
    chat, with a notification.
30. Main chat: 「以后每天早上给我看看新闻」 → asks first, in one question
    (the time, what to look at), and sets nothing until the user says yes;
    then a `--daily --time=… --target=assistant` task.
31. Main chat, after it set a reminder: 「改到 9 点」 → `schedule update
    <id> --at=…`; 「不用了」 → `schedule delete <id>`; never a second one
    for the same thing.
32. Main chat, a reminder comes due after the computer slept → says it
    comes late and how late, then what it was; one the user already
    handled → nothing shows (`<no-reply/>`).
33. Main chat, a new segment after reminders were set → 「我最近有哪些提醒？」
    answers from the In Hand lines or `schedule list`, the same list as the
    sidebar's 「待办」.
34. Main chat: 「把这个对话改个名」 (the main chat itself) → declines; it
    renames a subtask it started without asking, and asks before renaming
    a conversation the user started or deleting one for good.
