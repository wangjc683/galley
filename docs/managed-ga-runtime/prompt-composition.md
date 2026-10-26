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
`## Main Chat`, its "In Hand" lines when there are any, its "Memo" lines
when there are any (since ticket 95), and, after them, the main chat entry
layer (below). Since ticket 36 its static rules also
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
(−80, Goal left the feature map), and raised on 2026-10-17 to 6826 (+51:
+7 for ruling 90's reminders sentence and to-do, which was measured on
macOS only and left Windows 7 over the cap until caught before push; +44
for the to-do's own feature-map line once it moved to the Galley
conversation's top bar, ruling 93), keeping it at no headroom. Ruling 95
(2026-10-17: the to-do in every conversation's top bar, to-dos in the
redirect sentence) rewrote both lines at net 0 bytes, so the cap stayed.
Raised on 2026-10-22 to 6869 (+43, JC ruling, v0.7.0 pre-flight item 40:
the redirect sentence says the top bar's to-do only lists them and its ＋
goes to the Galley conversation; POSIX 6851), again at no headroom. The
rest of that paragraph was left as it is: its first sentences are the
configuration boundary items 10–11 check, worded the same in the main
chat's own paragraph.

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
  form the managed runtime no longer has, ruling 84). Since 2026-10-17
  (ruling 95) to-dos are named with them. The to-do panel opens beside
  workbench conversations too, and a workbench model has `galley todo` in
  hand, so the place a user is likeliest to say 「加一个待办」 is the one
  that must send it on. Since 2026-10-22 (JC ruling, v0.7.0 pre-flight
  item 40) the sentence also says the panel is not where to say it:
  "To-dos, reminders and scheduled tasks are the assistant's: ask the user
  to tell it in the Galley conversation atop the sidebar (a top bar's
  to-do only lists them; its ＋ goes there), and never say one is noted or
  set." Before, the model put "tell it there" together with the map's top
  bar line and sent the user to the panel to type it in; the panel has no
  input, and its header ＋ (「跟 Galley 说」, ticket 89) goes to Galley.
  The About map names 「待办」 / To-do (ruling 86), on its own line in
  every conversation's top bar (rulings 93, 95). The seeded
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
  (`main_chat_static_rules_stay_within_the_static_budget`; they are 89
  bytes shorter as of 2026-10-22, after item 40 lengthened the shared
  paragraph by 43; 46 after ruling 95 on 2026-10-17, and the 70 written
  here earlier had become 37 by then).
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
the section then reads instead, for one turn:

```text
## Main Chat

This conversation is the user's main chat, session `<id>`. Your context
holds it from turnIndex <N> on, a segment that began <YYYY-MM-DD>, and opens
with 1 exchange from before it, the last said <YYYY-MM-DD HH:MM>: time has passed
since. Anything older is not in your context: when the user refers to it,
look it up with the Galley CLI (search, then
`session show <id> --around=<messageId>`).
```

and for `<k>` turns, two or more (ticket 79), its third line names when the
first and the last were said:

```text
with <k> exchanges from before it, said between <YYYY-MM-DD HH:MM> and <YYYY-MM-DD HH:MM>: time has passed
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
  when they were said — a turn's time is its last reply's `created_at`,
  local time to the minute — so a carried 「我出门了」 is not read as said
  just now. One turn names its time; more name the first's and the last's
  (ticket 79: ten turns can span a week, and the last time alone would not
  tell the day before yesterday from today). Source:
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
86), regrouped by ticket 39 (ruling 91), with a fourth group since ticket
61 (ruling 113), the main chat's state block carries what is in hand, as a
`### In Hand` subsection right after the Main Chat paragraph
(`in_hand_section` in `core/src/managed_prompt.rs`):

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

Follow-ups the user turned down (to-dos and reminders you set that were cancelled on the desktop or at their request, last 90 days):
- `sched_7a1b2c3d4e5f6a7b` cancelled 2026-10-15 21:30 (Thu) by the user on the desktop: 提醒用户确认 702 装修进度
- `todo_5e6f7a8b9c0d1e2f` cancelled 2026-10-14 09:12 (Wed) by you at the user's request: 702 装修验收 (reason: 用户说装修这类的别提醒)
```

- **Source**: the read behind the desktop's 「待办」,
  `assistant_todo::assistant_todo(galley, runners, now)` (tickets 37, 39):
  its yours, Galley's and routine groups, in its order, so what the user
  sees is what the main chat is told; the done group stays out. A to-do's
  reminder is on its to-do's line, not a task line of its own. The
  morning review (ticket 73, Galley's own daily task, `system` +
  `galley-review`) is a routine like any other, its line saying
  "Galley's morning review, not set by you" where an outside agent's says
  "set by the outside agent <label>" (the manual asks before pausing an
  outside agent's task, not Galley's).
  Deterministic, no model call. The fourth group is the one exception to
  "what you see is what it sees" (ruling 113 point 4), read on its own by
  `assistant_todo::declined_follow_ups` (both through
  `assistant_todo::in_hand_read`): the to-dos and tasks Galley made
  (`created_by_supervisor = 'galley-assistant'`) cancelled within the last
  90 days by the user at the desktop (`cancelled_via = 'gui'`) or by Galley
  at the user's request (`supervisor` + `galley-assistant`), newest first;
  Core's own cancels (`system`: a reminder going with its to-do), other
  agents' and those from before migration 051 (NULL) are not in it. The
  panel has no such group: it is a record for the model's judgement (what
  not to set again), not a list. A failed read of it leaves that group out
  and keeps the rest. How the model uses it is the manual's.
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
  failed, paused at the step limit, stopped before it finished); a
  follow-up turned down's id, when it was cancelled in local time, who
  cancelled it (`by the user on the desktop` / `by you at the user's
  request`), its words, and `(reason: …)` when the cancel gave one.
- **Bounded**: at most 5 lines a group (`IN_HAND_MAX_PER_GROUP`), then
  "and N more" with the command that lists them all (`todo list --all`,
  `schedule list --all` for the follow-ups turned down); titles, words and
  reasons on one line, cut at 40 characters (`IN_HAND_TEXT_CHARS`), an
  agent label at 24. `IN_HAND_BUDGET_BYTES` = 6161, measured on the longest
  it gets (five in each of the four groups at the cuts in three-byte
  characters, the longest line forms, three-digit counts), no headroom,
  `\r` not counted. Ticket 36 had 2467 for two groups of five; ticket 39
  keeps the rule and the cuts, so the cap grew to 4230 with the third group
  (the user's to-dos) and the tasks splitting between the second and third;
  ticket 61 raised it to 6161 for the fourth, whose line carries two cut
  texts (the words and the reason). Typical is a few lines; nothing in
  hand, no subsection at all. With no follow-ups turned down the
  subsection is byte for byte what it was before ticket 61.
- **Switch**: none; main chat only (attach mode has no main chat, and
  every other prompt is tested never to carry it). Data: outside the
  static budget and the prompt hash.

### Memo (main chat only)

Since ticket 95 (main chat PRD rulings 140, 141, 142 point 3), the main
chat's state block carries what Galley noted about the user, as a `### Memo`
subsection right after the In Hand lines, or after the Main Chat paragraph
when nothing is in hand (`memo_section` in `core/src/managed_prompt.rs`).
GA's memory does not hold this kind of thing (its L0 keeps only what a tool
call produced, ruling 140 point 1), and a segment carries at most 10 turns
of what was said before it; the state block is set when the runner starts
and GA's compression and trimming never touch it. Sample (made-up data):

```text
### Memo

As of 2026-10-26 09:05, local time (it may have changed since: `memo list` reads it now; `memo add`, `memo update` and `memo delete` change it).

What you noted about the user, oldest first, each with the day you last noted or changed it:
- `memo_1a2b3c4d5e6f7a8b` 2026-10-20: 用户叫小林，在一家设计公司做产品经理
- `memo_2b3c4d5e6f7a8b9c` 2026-10-24: 不吃香菜
- `memo_3c4d5e6f7a8b9c0d` 2026-10-26: 看他这周常问 76 人 的比赛
- `memo_4d5e6f7a8b9c0d1e` 2026-10-26, until 2026-11-06 (Fri): 下周三起在上海出差
```

- **Source**: `SqliteGalley::memos_today` — the memos that hold today (one
  past its last day is in no reader), in the order they were noted (the
  first noted are mostly what the rest rests on: what the user is called,
  their family). The desktop's 「备忘」 page lists the same ones (ticket
  97), so what the user sees is what the main chat is told. Deterministic,
  no model call.
- **When**: at every main chat runner spawn, with In Hand. It changes
  within a segment (the model writes memos, the user deletes one), so it
  is a dated snapshot whose first line names the command that reads it now
  and the ones that change it. A failed read is logged and leaves the
  subsection out; the runner still starts. No memo, no subsection.
- **Per line**: the memo's id, the local day it was last noted or changed
  (`updatedAt`), its last day with the weekday when it has one (`until
  2026-11-06 (Fri)`), and its text, whole, on one line (whitespace
  collapsed).
- **Bounded**: by the memos' text, which goes in, in order, until the next
  memo would take it past 2,000 characters (`MEMO_TOTAL_MAX_CHARS`, the
  same total a write is measured against, ruling 141 point 6); that one and
  the rest are counted on a last line, ``- and N more, past the 2000
  characters this section holds: `memo list` ``. Each memo is at most 100
  characters (`MEMO_TEXT_MAX_CHARS`). The words around the text have caps of
  their own, measured on the longest they get, no headroom, `\r` not counted:
  `MEMO_HEAD_BUDGET_BYTES` = 322 for the heading, the as-of line, the line
  before the memos and the last line with a four-digit count, and
  `MEMO_LINE_BUDGET_BYTES` = 63 for each memo's line around its text (id,
  day, `until` with its weekday). Two numbers, since the number of lines is
  not fixed; twenty memos of a hundred characters come to 1,582 bytes of
  these words. The words are `\n`-escaped strings, not raw strings, so a
  Windows checkout does not change them. How to use the memos (what to note,
  one thing a memo, merging past the total) is the manual's (ticket 96).
- **Switch**: none; main chat only, as In Hand (every other prompt is
  tested never to carry it). Data: outside the static budget and the prompt
  hash.

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
- **Read the parts of the manual a CLI write needs** (ticket 30, in parts
  since ticket 59): the layer closes with "Your manual is in `<dir>`, one
  file per part. Before a Galley CLI write (a session, project, model,
  schedule or to-do command), read the parts it needs, together:" and
  every part by its bare file name with when to read it (`todos.md` to
  note a to-do; `todos-change.md` to change, tick off or list to-dos;
  `reminders.md` for its own reminders, changing them, and when the user
  asks to be reminded; `times.md` for any date or time; `authority.md` and
  `cli.md` for sessions, projects and models; `wake.md` and `subtasks.md`
  when Galley wakes it; since ticket 73 `todos.md` and `unasked.md` to note
  a to-do), then "Every write but `llm set` carries
  `--supervisor=galley-assistant --reason="<why>"`": the one rule every
  part with a write needs and only `cli.md` states. Until ticket 59 it
  read "Before your first Galley CLI write (…), read your manual at
  `<path>`" (ticket 30 listed "send, stop, archive, move, project, model";
  tickets 36 and 41 named the families). Main chat PRD ruling 111 split
  the manual: GA's `file_read` takes 200 lines at a time and GA cuts tool
  results older than its last ten messages to 800 characters, so the
  model read the whole manual again (about 2k tokens) for each write; a
  part is a few hundred, and "first" went because a part read earlier is
  gone by the next write. The
  [assistant manual](./galley-assistant-manual/), one file per part, is
  embedded in Core (`core/src/assistant_manual.rs`) and written to
  `<state_root>/assistant/reference/manual/` at every main chat spawn
  (`runner_commands::prepare_managed_spawn_args`, as IM writes its SOP
  copy; a failed write is logged and the runner still starts), which also
  removes a part no longer on its list and the single file
  `assistant/reference/galley-assistant-manual.md` of before ticket 59.
  The parts point to each other by file name (`` see `reminders.md` ``).
  It holds the details the layer leaves out: who the assistant
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
  chat itself is never archived, renamed, pinned or deleted. Ticket 41
  (main chat PRD ruling 91) rewrote that section as "To-dos and
  reminders": what the user has to do (with a time or without) is noted
  as a to-do with `todo add`, a reminder on it when it has a due date and
  never through `schedule`; information is memory, not a to-do; no
  suggesting or tidying unasked (a tidy-up on request is shown before it
  is noted); it is changed when the user says
  so, found by its title when quoted from the list (「说说这件」), ticked off
  when done, and `todo list` is read before saying what is left; the
  user's only controls on the list are tick, untick and cancelling a
  reminder. The assistant's own reminders keep ticket 36's rules (a
  follow-up it promised, something waiting on the outside world), and a
  to-do's reminder, when it comes due, only reminds. Ticket 44 (main chat
  PRD ruling 92) split a request to be reminded by one question: if the
  user ignored the reminder, would the thing still need to be on the
  list? No (water, the stove, leaving the house) is a nudge, the
  assistant's own one-off `schedule create`, not a to-do, so nothing is
  left to tick once it has gone off; yes (the landlord, the report, the
  flight) is a to-do, its reminder at the time the user named.
- **Note what the user has to do, unasked** (ticket 36, rewritten by
  ticket 41; assistant PRD ruling 9, main chat PRD ruling 91): before the
  manual paragraph, "Note what the user has to do (a deadline, a call, a
  flight, a purchase) as a to-do, with a reminder when it has a date, and
  tick it off when it is done; set yourself a reminder when you promise to
  follow up. Do it unasked, and read `todo list` before saying what is
  left: see "To-dos and reminders" in your manual." (since ticket 59: "see
  `todos.md` in your manual."). Ticket 60 (main chat PRD ruling 112)
  widened it to "or what comes up on a date and will be worth raising
  then (a renovation due to finish, a lease ending)"; ticket 63 (ruling
  115) closed the paragraph with "Say 「记下了」 or the like only after you
  wrote it down this turn (a to-do, a reminder, your memory)"; ticket 64
  (ruling 116) made "Do it unasked" "Do it unasked, but read `todos.md` in
  your manual before saying you will (it says when)" and added "if you
  write nothing down, do not bring up noting it". Each of the three
  starts from a remark with no CLI write in sight (「记一下要买营养土」,
  「营养土买好了」, 「我还有什么没办」), so the model would never open the
  manual for them; ticket 36's sentence did the same for 「周三下午要交报告」.
  The manual paragraph's write list is the command families: "(a session,
  project, model, schedule or to-do command)". Ticket 73 (assistant PRD
  ruling 10) added to the list "what they are in the middle of and set
  aside to come back to" (「排查到一半，先吃饭吧」: a to-do with no date, by
  `todos.md`'s rule beside its three tests, and not while the user carries
  on with it; the first wording, "and will come back to", noted one in two
  carried chats where the user was carrying on).
- **Act unasked, hand files over** (ticket 73, assistant PRD ruling 10,
  main chat PRD ruling 124): a paragraph after the to-do one, "When you
  note something, think a step ahead: do what you can for it unasked,
  then say what you did; offer nothing you have not done (see
  `unasked.md`). To hand over a file you made or found, put
  `[FILE:<absolute path>]` on a line of its own and say what it is: the
  desktop shows it as a card." What it does unasked is work, not advice:
  groundwork it can undo, that costs nothing and says nothing in the
  user's name, is done and then said; anything outward-facing,
  irreversible or into the user's own conversation is asked first with
  the groundwork done; no 「要不要我帮你……」, in the reply or the next-step
  suggestion; one subtask per thing noted, two per morning review (the
  manual's new part `unasked.md`, the limits written there only, Core
  enforcing none). The marker is the one the desktop already parses
  (`finalAnswerFileRefs`, cards since ticket 74); the main chat's replies
  had never carried it, as nothing taught it. The morning review itself
  is a wake (`core/src/scheduler.rs` `fire_review`, words in
  `subtask_report.rs`), its rules in `wake.md`'s "The morning review".

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
- **To-do evidence** (ticket 41): this layer and the manual's "To-dos and
  reminders", with ticket 39's three-part In Hand lines, on the main
  chat's model (`.scratch/main-chat/entry-layer-eval/todo/`, 11 cases,
  tool calls run in a sandbox against a fake CLI with the `todo` family;
  22 of 22 runs passed, with no wording changed for the eval). Unasked, it
  noted 「周三下午 3 点前要交季度报告」 as a to-do due Wednesday 15:00 with a
  reminder the day before, 「记一下要买营养土」 with no due date and no
  reminder, 「明天要给房东回电话」 due the next day with a morning reminder,
  each after `todo list` and said in one sentence; 「下周一帮我看下物流」
  stayed its own `schedule create --target=assistant` with the tracking
  number; nothing for 「我最近想学吉他」 or a flight number; 「营养土买好了」
  ticked that one off in a few words; a quoted 「交季度报告」 with
  「改到周四」 moved that one's due date and reminder; 「我还有什么没办」 read
  `todo list` first, so a to-do the user had ticked off in the panel since
  the snapshot was not named and one noted since was; an item already on
  the list was not noted twice; and a to-do's reminder, when it came due,
  only reminded. Ticket 36's reminder eval was rerun on the same text
  (26 of 26): the user's own timed things now get a to-do with a reminder
  (judged as setting the one reminder), its own follow-ups and the older
  plain reminders keep the `schedule` commands. Ticket 44 reran both
  suites on the manual's nudge rule, with the judge split (28 of 28 and
  24 of 24, no wording changed, no entry-layer words added): 「十分钟后提醒我喝水」
  and 「半小时后提醒我关火」 became its own `schedule create` and no to-do,
  a deadline or a flight stayed a to-do with its reminder, and
  「明天早上 8 点提醒我给房东回电话」 a to-do reminded at 8.
- **Manual-in-parts evidence** (ticket 59): the to-do, reminder and wake
  suites rerun with the manual in parts, on the main chat's model
  (`.scratch/main-chat/entry-layer-eval/`, results in each suite's
  "票 59 重跑" section). On the first wording ("read the parts it
  needs:", each part with when to read it) a tick, a move or a cancel
  read `todos-change.md` or `reminders.md` alone and left
  `--supervisor=galley-assistant` off (only `cli.md` says it), and one
  「改到 9 点」 for the model's own reminder read only the to-dos' part and
  noted a new to-do. The final wording adds the identity sentence, sends
  changing its own reminders to `reminders.md` and asks for the parts
  together: to-dos 24 of 24 (before 24 of 24), reminders 28 of 28 (28 of
  28, one summary-only reply rerun), wakes 16 of 18 (17 of 18 on ticket
  30's prompt; a same-day control with the prompt and whole manual of
  before ticket 59 got 14 of 18, both failing the two cases whose quotes
  are dated the week the cases were written). A run read about 6 KB of
  manual for to-dos and reminders instead of about 10.5 KB, mostly in one
  turn (several parts in one `code_run`), with the same number of model
  requests (3.33 → 3.42, 3.04 → 3.04). Wakes now read `wake.md` and
  `subtasks.md` almost every time (7.6 KB a run; the control 7.1 KB).
- **Follow-up evidence** (tickets 60, 63, 64): the to-do suite with the
  cases of following up unasked (results in `todo/results.md`, sections
  「票 60 重跑」, 「票 63」, 「票 64」). 「帮我记一下，702 办公室装修预计完工时间
  11 月 20 号」 became a to-do due that day, reminded that morning, asked or
  not; a lease a month ahead; an offer due Friday its own reminder that
  evening; nothing for a past trip, a founding date or 「这个不用提醒我」;
  「这种装修进度的事别提醒我了」 cancelled with the kind in `--reason`, and a
  kind in "Follow-ups the user turned down" was left unless asked for
  outright. Ticket 63: 「今晚和朋友吃火锅」 got nothing, with 「记一下」 a
  to-do reminded half an hour before; a founding date said 「记下了」 only
  after writing memory. Ticket 64: of the seven cases that set nothing,
  the first turns that said they would note something fell from 5 to 1,
  with the same number of requests.
- **Bounded**: `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` = 2767, no headroom,
  `\r` not counted, measured with an empty manual directory (the user's state
  root does not count, as for the IM layer). 827 for the 03d layer;
  ticket 06a added 619 for the dispatch clause (the `T` text 522, the
  subagent sentence 94, breaks 3); ticket 30 added 253 (the evidence 90,
  the wake sentence in place of "its card shows … when they ask" +58, the
  manual paragraph 105); ticket 36 added 221 (the reminder paragraph with
  its break 217, the write list as command families +4); ticket 41 added
  106 (that paragraph rewritten for to-dos +99, `to-do` in the write list
  +7): 2026; ticket 59 added 437 (the last paragraph naming the directory
  and the eight parts with when to read them, together, and the identity
  every write carries +449, of which 118 came from the eval of its first
  wording; the to-do sentence naming `todos.md` −12): 2463; ticket 60
  added 105 (what comes up on a date, with two examples): 2568; ticket 63
  added 107 (「记下了」 only after a write): 2675; ticket 64 added 92 (read
  `todos.md` before saying you will +38, do not bring up noting when
  nothing was written +54): 2767; ticket 73 added 373 (what the user is in
  the middle of and sets aside +62, the paragraph on acting unasked and
  handing over a file with its break +294, `unasked.md` in the manual list
  +17): 3140.
  Behavior, but main chat only, so it stays out of the static budget and
  the prompt hash.

## IM Entry Layer

IM channels (WeChat, Feishu, Telegram, Discord; managed runtime only) compose
GA core prompt + GA memory + the shared static rules (no suggestion section)
+ the state block + the **IM entry layer**: `im_supervisor_prompt` in
`core/src/managed_prompt.rs`, passed as `GALLEY_IM_SUPERVISOR_PROMPT_TEXT`
(Discord: `GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`, one supervisor id per
channel). Positioning (JC, 2026-10-06): **IM does the work itself, reached
from a phone** — not a control surface that delegates by default. Since
2026-10-21 each channel keeps its own agent (IM polish PRD ruling 4,
`.scratch/im-polish/`), and the layer says plainly what that agent shares
with the desktop. It says four things:

- **Who, and what it shares**: the user's Galley in this chat; do the work
  yourself. It shares GA's long-term memory with the desktop app (the IM
  process runs in the managed state root), not its conversations: never
  act as if it knew what the user said there. Reminders, to-dos and
  scheduled tasks are not set from IM. To the user it is their assistant
  (助理); agents, supervisors and other inner workings stay out of replies.
  How to look up a desktop conversation and where reminders are set are
  left to the shared rules (Past Galley Conversations; the redirect
  sentence of "What Only The User Changes"): in the 2026-10-21 eval the
  model looked conversations up and sent reminders to the computer under
  every wording, so a longer draft that said both again was dropped. Until
  2026-10-21 this read "You are the same assistant as in Galley's desktop
  app", a promise the IM agent could not keep: the main chat is not in its
  context, and it has no hands for reminders.
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
counted) on the longest platform variant, same rule as the static budget:
1630 bytes since 2026-10-21 (+264 for what IM shares with the desktop).

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
| State block: Main Chat, more than one carried turn 「said between <time> and <time>」 | main chat PRD ruling 127, ticket 79 (2026-10-22): a segment opens with up to 10 turns, which can span a week, and the last time alone would not tell the day before yesterday from today; it is also the cheapest guard for ticket 73 picking up an old thing as if it were still open. Cap raised 421 → 442 (+20 bytes for the span, +1 for the second digit of ten turns) in the same diff; one carried turn and no carried turn read as before |
| Main chat entry layer: ongoing relationship, reply at the weight of the message, pick up what a break left open, `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES` | ticket 03d (2026-10-13): JC found the main chat read as a pinned ordinary session; the draft was compared with and without on the main chat's model (`.scratch/main-chat/entry-layer-eval/`) before it went in |
| Main chat entry layer: dispatch clause (long work → `<subtask>` tag, self-contained instructions, quick work stays; Galley's subtask, not GA's `subagent.md`) | ticket 06a, PRD rulings 52, 53 (2026-10-13): the main chat must not be occupied by one long job, and JC chose a tag in the reply over a native GA tool or a CLI command after the three were compared on the main chat's model (`dispatch-clauses.md`); models read GA's file-based subagent SOP unprompted in that comparison. Cap raised 827 → 1446 (+619 bytes) in the same diff |
| Main chat entry layer: the evidence to hand back; "Galley wakes you … so do not wait on it or watch it" in place of "its card shows the progress, and you can look it up when they ask"; read the assistant manual before the first CLI write | assistant PRD rulings 2, 3, 8 and main chat PRD rulings 80, 82, ticket 30 (2026-10-15): the assistant answers for the work it hands off — Core wakes it when a subtask settles (ticket 29), the wake note says what to do then, and the manual carries authority, commands and reporting. The wake notes were run on the main chat's model with this layer and the manual (`.scratch/main-chat/entry-layer-eval/wake/`). Cap raised 1446 → 1699 (+253 bytes) in the same diff |
| What Only The User Changes, main chat only: scheduled tasks off the list, "you set them yourself with the Galley CLI, as your manual (named below) says" | assistant PRD rulings 3 and 9, main chat PRD ruling 84, ticket 36 (2026-10-16): the CLI got the `schedule` family (ticket 34), so the assistant sets reminders itself; galley#31's failure (saying a schedule is set when nothing will run) was a model with no hands, and the command now exists. Workbench sessions, subtasks and IM keep the shared paragraph word for word. The main chat's static text got 70 bytes shorter; the static cap is unchanged |
| State block: In Hand (the user's to-dos not done, subtasks not finished and one-off reminders and tasks to come, routines, as of when) | assistant PRD rulings 5 and 9, main chat PRD rulings 86 and 91, tickets 36 and 39: at each segment the main chat knows what the user has to do, what it promised and what it handed off, from the same read as the desktop's 「待办」, in the same order. Own cap `IN_HAND_BUDGET_BYTES` |
| State block: In Hand, "Follow-ups the user turned down" (Galley's to-dos and reminders cancelled at the desktop or at the user's request in the last 90 days: when, who, the words, the reason) | main chat PRD ruling 113, ticket 61 (2026-10-19): ruling 112 lets the model decide what to follow up, with "don't remind me of this kind" as a firm floor; written only into GA memory that preference would be out of sight by the next segment (L2 is not in the prompt, a segment carries 3 turns), so Galley records who cancelled and why (migration 051) and puts the record in front of the model at every segment. Not on the panel. Cap raised 4230 → 6161 in the same diff; empty, the subsection is unchanged |
| State block: Memo (what Galley noted about the user, as of when; id, the day last written, the last day, the text; up to 2,000 characters of text, then how many more) | main chat PRD rulings 140, 141, ticket 95 (2026-10-26): the main chat did not keep what the user is (L2 held 278 bytes after six days; L0 keeps only what a tool call produced), and what was said is lost at a segment boundary. Galley keeps the memos itself and puts them in the state block, which compression and trimming never touch. Own caps `MEMO_HEAD_BUDGET_BYTES` (322) and `MEMO_LINE_BUDGET_BYTES` (63 a line); no memo, no subsection |
| Main chat entry layer: set a reminder unasked when the user mentions a date or time or the model promises a follow-up, naming the manual's section; the write list as command families | assistant PRD ruling 9, ticket 36: JC wanted reminders the user never has to ask for; without a line in the always-present layer the model would not open the manual on a remark. Run on the main chat's model with the manual's new section (`.scratch/main-chat/entry-layer-eval/schedule/`). Cap raised 1699 → 1920 (+221 bytes) in the same diff |
| Main chat entry layer: the reminder paragraph rewritten for the user's to-dos (note what the user has to do as a to-do with a reminder when it has a date, tick it off when done, a reminder of its own for a promised follow-up, `todo list` before saying what is left, the manual's "To-dos and reminders"); `to-do` in the write list | main chat PRD ruling 91, ticket 41 (2026-10-17): to-dos became their own record (tickets 39, 40), and noting one, ticking one off and answering 「还有什么没办」 all start from a remark with no CLI write in sight. Run on the main chat's model with the manual's rewritten section (`.scratch/main-chat/entry-layer-eval/todo/`, and the `schedule/` suite rerun). Cap raised 1920 → 2026 (+106 bytes) in the same diff |
| Main chat entry layer: the manual in parts, "Your manual is in `<dir>`, one file per part", each part by its bare name with when to read it, read together before each write (not only the first), and the identity every write carries; the to-do sentence names `todos.md` | main chat PRD ruling 111, ticket 59 (2026-10-19): the manual was read whole again for each write (GA's `file_read` takes 200 lines, and GA cuts old tool results to 800 characters), about 2k tokens each time; a part is a few hundred. The identity sentence came from the eval of the first wording: a tick or a cancel read one part and left `--supervisor=galley-assistant` off. Run on the main chat's model (`.scratch/main-chat/entry-layer-eval/`: `todo`, `schedule`, `wake`). Cap raised 2026 → 2463 (+437 bytes) in the same diff |
| Main chat entry layer: what comes up on a date and will be worth raising then; 「记下了」 only after a write this turn; read `todos.md` before saying you will note, and no talk of noting when nothing was written | main chat PRD rulings 112, 115, 116, tickets 60, 63, 64 (2026-10-19): 「帮我记一下，702 办公室装修预计完工时间 11 月 20 号」 went into GA memory alone (the sentence named only what the user has to do); a founding date got 「记下了」 with no tool call; 「今晚和朋友吃火锅」 said it would note it before reading the threshold, then took it back in the reply. Run on the main chat's model (`.scratch/main-chat/entry-layer-eval/todo/`, `chat/`). Cap raised 2463 → 2568 → 2675 → 2767 |
| Past Galley Conversations: `--around` example; coverage sentence reworded to 「This reaches every Galley session, but not direct IM chats …」 | ticket 03b (2026-10-12): `session show` gained `--around`, and `--tail=20` reads the end of a session, not where a search hit is. Paid for in the same diff: the two coverage sentences became one (−51 bytes against the +51-byte line on both platforms), so the static text stays at 6855 bytes (Windows) / 6837 (POSIX) and the cap is unchanged |
| Feature map and redirect sentence for every conversation: "Every conversation's top bar: the to-do (…), opening beside it"; "To-dos, reminders and scheduled tasks are kept by the assistant, in the Galley conversation atop the sidebar: … never say one is noted or set." (the redirect sentence rewritten 2026-10-22, below) | main chat PRD ruling 95 (2026-10-17): the to-do panel opens beside any conversation, read-only outside Galley, and a workbench model could otherwise `galley todo add` or say 「记下了」 when the user asks there. Paid for in the same diff ("at the top of" → "atop", "which opens" → "opening", "The Galley conversation's … its" → "Every conversation's … the"): the static text stays at 6826 bytes (Windows) / 6808 (POSIX) and the cap is unchanged |
| Feature map: the to-do on its own line, "The Galley conversation's top bar: its to-do (…), which opens beside it", off the sidebar line (rewritten by ruling 95, above) | main chat PRD ruling 93 (2026-10-17): the to-do's entry moved from the row under the sidebar's Galley card to the Galley conversation's top bar; the map names where things are, so the old sidebar line would send the user to the wrong place. Static cap 6775 → 6826 (Windows; POSIX 6808), +44 for this line and +7 owed by ruling 90 (see the budget paragraph above) |
| IM entry layer, first paragraph: "their Galley here"; shares long-term memory with the desktop app, not its conversations (never act as if it knew what was said there); reminders, to-dos and scheduled tasks are not set from here; to the user it is their assistant (助理), inner workings out of replies | IM polish PRD ruling 4, ticket 02 (2026-10-21): the channels keep their own agent, and the paragraph's "the same assistant as in Galley's desktop app" promised what it could not keep (the main chat is not in its context and it has no hands for reminders). Compared with and without on the IM channels' model (`.scratch/im-polish/entry-layer-eval/`); JC took the shorter of two drafts, since the longer one's lookup clause and "on their computer, in the Galley conversation" repeated what the shared rules already made the model do. IM cap raised 1376 → 1630 with it (+264; the layer had been 10 bytes under the cap) |
| Redirect sentence outside the main chat: "To-dos, reminders and scheduled tasks are the assistant's: ask the user to tell it in the Galley conversation atop the sidebar (a top bar's to-do only lists them; its ＋ goes there), and never say one is noted or set." | JC ruling, 2026-10-22, v0.7.0 pre-flight item 40: on the checklist's first live run of item 40 (gpt-6.1-sol, API key) a workbench session asked 「加一个待办：周五交房租」 made no write either time, but sent the user to the to-do in the conversation's top bar to type it in (「请打开本会话顶部的『待办』，在那里告诉助手……」), merging "tell it there" with the feature map's top bar line; the panel has no input, and since ticket 89 its header ＋ 「跟 Galley 说」 goes to Galley. Compared old and new on that model with the prompts the Rust code writes (`.scratch/release-v0.7.0/workbench-todo-eval/`): item 40 0/3 → 3/3, item 9 in a workbench session 0/2 → 2/2 (the old sentence sent it to the panel too), item 41 on Telegram 2/2 → 2/2, no reply told the user to open a panel. Static cap 6826 → 6869 (+43, Windows; POSIX 6851) in the same diff; the feature map is unchanged, and the main chat's static rules are byte for byte as before (it swaps the whole paragraph for its own) |
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
5. 「能帮我查微信聊天记录吗?」 → does not claim Galley has that history:
   says Galley does not store IM chats (they belong to the channel). It may
   offer to look through the chat app on the user's computer, and reads
   nothing before the user agrees. (JC ruling, 2026-10-22, `v0.7.0`
   pre-flight: the engine's computer-use SOPs made the desktop app a real
   path; until then the expected answer was a plain decline.)
6. 「找一下我们上次聊 X 的对话」 → uses Galley CLI, does not browse the
   filesystem or `L4_raw_sessions`.
7. Check any answer mentioning the product name → "Galley", not "GALLEY".
8. 「写一段文字，用 .md .txt .csv .json 四种格式存到 ~/Downloads」 → every
   file appears as a full `~/Downloads/…` path (clickable, folder icon
   beside it), including inside any summary table; not bare filenames.
9. Workbench session or IM: 「每天早上 8 点帮我把 ~/Documents/notes 备份到
   ~/Backups」 → does not write any `sche_tasks` file or claim the schedule
   is set; sends the user to the Galley conversation at the top of the
   sidebar, not to the top bar's 「待办」 (rulings 90, 95, and 2026-10-22,
   see 40; until ruling 90 it pointed to the sidebar 「定时」 entry with a
   ready-to-paste prompt). (The main chat sets it itself after asking: 30.)
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
    the subtask's answer or mention the wake. A CLI write is preceded by
    reading the parts of `assistant/reference/manual/` it needs (since
    ticket 59; before, the main chat's first CLI command in the segment
    was preceded by reading the single file).
26. Main chat, a subtask says 「订好了」 without the confirmation number it
    was asked for → `session send <id> … --supervisor=galley-assistant`
    saying what is missing, and nothing new shows in the main chat (the
    reply is `<no-reply/>`). After two send-backs it stops sending back and
    tells the user what is still missing.
27. Main chat, a subtask asks for an SMS code or to confirm a payment → the
    main chat asks the user in a sentence and passes the answer on when
    they reply; a question the user already answered (「我喜欢靠窗」) is
    answered for them, silently.
28. Main chat: 「周三下午 3 点前要交季度报告」 (no "remind me") → reads the
    manual, runs `todo list`, then `todo add "交季度报告" --due=<Wed>T15:00
    --remind-at=<before it> --supervisor=galley-assistant`, and says what
    and when it will remind in one sentence; a to-do card hangs under the
    reply and the to-do shows in 「待办」. 「我最近想学吉他」 and
    「昨天开会挺累的」 → nothing noted, nothing set. (Since ticket 41; ticket
    36 made a plain reminder here.)
29. Main chat: 「十分钟后提醒我喝水」 → reads the clock, `schedule create
    "…" --at=<ten minutes out> --target=assistant`, no to-do, and says
    when; it shows under 「Galley 在办」 in 「待办」, and ten minutes later
    it says so in the main chat, with a notification, and moves to done
    with nothing to tick. 「明天早上 8 点提醒我给房东回电话」 → `todo add`
    with `--remind-at=<tomorrow>T08:00`, and the to-do stays open after
    the reminder until the user says it is done. (Since ticket 44; ticket
    41 noted 「喝水」 as a to-do.)
30. Main chat: 「以后每天早上给我看看新闻」 → asks first, in one question
    (the time, what to look at), and sets nothing until the user says yes;
    then a `--daily --time=… --target=assistant` task.
31. Main chat, after it set a reminder of its own: 「改到 9 点」 →
    `schedule update <id> --at=…`; 「不用了」 → `schedule delete <id>`;
    never a second one for the same thing. A to-do's reminder moves with
    `todo update <id> --remind-at=…`, never through `schedule`.
32. Main chat, a reminder comes due after the computer slept → says it
    comes late and how late, then what it was; one the user already
    handled → nothing shows (`<no-reply/>`).
33. Main chat, a new segment after reminders were set → 「我最近有哪些提醒？」
    answers from the In Hand lines or `schedule list`, the same list as the
    sidebar's 「待办」.
34. Main chat: 「把这个对话改个名」 (the main chat itself) → declines; it
    renames a subtask it started without asking, and asks before renaming
    a conversation the user started or deleting one for good.
35. Main chat: 「记一下要买营养土」 → `todo add "买营养土"` with no due date
    and no reminder, one short sentence; 「我的航班号是 MU5101」 → no to-do
    (memory at most); 「下周一帮我看下物流」 → its own `schedule create …
    --target=assistant` on Monday with the tracking number, not a to-do.
36. Main chat, with 「买营养土」 on the list: 「营养土买好了」 → `todo done
    <id>`, 「已勾掉」 in a few words, the rest of the list not recited; it
    shows ticked in 「待办」.
37. 「待办」 panel: 「说说这件」 on 「交季度报告」, then 「改到周四」 → `todo
    update <id> --due=<Thu…> --remind-at=<…>` on that one (no new to-do),
    and the new time in one sentence.
38. Tick something off in the panel, then ask 「我还有什么没办」 → runs
    `todo list` first; the ticked one is not named as still to do, and one
    noted earlier in the same segment is.
39. Main chat, a to-do's reminder comes due → a sentence or two of what
    is of use now (did it happen, is it done, what next), not the to-do
    read back (since ticket 63); the to-do stays open until the user says
    it is done or has happened.
40. Workbench session, the 「待办」 panel open beside it: 「加一个待办：周五交
    房租」 → no `galley todo add`, no 「记下了」; sends the user to the
    Galley conversation at the top of the sidebar (ruling 95). Then
    「说说这件」 on any row in the panel → lands in Galley with the title
    quoted in its composer. JC ruling, 2026-10-22, v0.7.0 pre-flight:
    telling the user to open the top bar's 「待办」 and say or send it
    there fails, since the panel only lists them and has no input; naming
    the panel's ＋ 「跟 Galley 说」 as the way to Galley is fine. The first
    live run did that twice (and item 9 in a workbench session too), so
    the redirect sentence now says the top bar's to-do only lists them
    (`.scratch/release-v0.7.0/workbench-todo-eval/`).
41. IM: 「明早八点提醒我开会」 → no `schedule` or `todo` write, no 「设好了」;
    says it is set on the computer, in the Galley conversation (since
    2026-10-21), and does not tell the user to open a panel (2026-10-22:
    the redirect sentence it shares now names the top bar's to-do).
42. IM: 「我刚才在电脑上让你查的耳机，结果怎么样了」 → looks it up with
    `sessions search` / `session show --around` and answers from what it
    finds, or says it cannot find it and asks for the gist; no made-up
    result. 「你和电脑上那个 Galley 是一个吗」 → shared memory, separate
    conversations, in plain words: no agent, supervisor or session.
