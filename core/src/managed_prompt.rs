//! Galley-owned managed GenericAgent prompt profile.
//!
//! This is product runtime behavior for Galley's bundled GA. It is embedded in
//! Core so it is versioned with the app, not treated as user-editable roleplay
//! content in the managed runtime resource directory.

use crate::api::schedule::{ScheduleTarget, ScheduledTaskRepeat};
use crate::api::{MemoBrief, TodoReminderState, MEMO_TOTAL_MAX_CHARS};
use crate::assistant_todo::{
    AssistantTodo, DeclinedBy, DeclinedFollowUp, TodoCreator, TodoItem, TodoKind, TodoState,
    DECLINED_WINDOW_DAYS,
};
use crate::session_runner::segment::MainChatPromptState;
use ring::digest::{Context, SHA256};
use std::fmt::Write;

pub const PROMPT_PROFILE_ID: &str = "galley-runtime-v1";

/// History-lookup commands for the platform this Core is built for: only one
/// block reaches the prompt (2026-10-06 budget pass). macOS and Linux share
/// the POSIX discovery path.
#[cfg(windows)]
macro_rules! history_cli_commands {
    () => {
        r#"In PowerShell:

  $GALLEY = Get-Content "$env:APPDATA\galley\cli-path" | Select-Object -First 1
  & $GALLEY sessions search "<keywords>" --runtime all --all
  & $GALLEY session show <id> --around=<messageId>
  & $GALLEY sessions list --runtime all --all
  & $GALLEY session show <id> --tail=20"#
    };
}
#[cfg(not(windows))]
macro_rules! history_cli_commands {
    () => {
        r#"  GALLEY="$(sed -n '1p' "${XDG_CONFIG_HOME:-$HOME/.config}/galley/cli-path")"
  "$GALLEY" sessions search "<keywords>" --runtime all --all
  "$GALLEY" session show <id> --around=<messageId>
  "$GALLEY" sessions list --runtime all --all
  "$GALLEY" session show <id> --tail=20"#
    };
}

/// The configuration boundary of "What Only The User Changes In Galley",
/// as every session but the main chat reads it: workbench sessions,
/// subtasks and IM. Its last sentence sends to-dos, reminders and
/// scheduled tasks to the Galley conversation (main chat PRD rulings 90
/// and 95: a workbench model has the CLI, and the to-do panel opens
/// beside its conversation too). The main chat reads
/// [`MAIN_CHAT_USER_ONLY_CONFIGURATION`] in its place (ticket 36): its
/// assistant sets reminders and scheduled tasks itself. A macro so the
/// paragraph is written once and still sits inside
/// [`RUNTIME_PROMPT_STATIC`]'s `concat!`.
///
/// The parenthesis keeps the top bar's to-do out of the answer (v0.7.0
/// pre-flight, checklist item 40): asked 「加一个待办」 in a workbench
/// session, the model merged this sentence with the feature map's top bar
/// line and told the user to open the to-do and send it there, but the
/// panel only lists them; its ＋ (「跟 Galley 说」, ticket 89) goes to the
/// Galley conversation.
macro_rules! user_only_configuration {
    () => {
        r#"Galley's configuration belongs to the user and changes only in Galley's
interface: model providers and API keys, Channels, Browser Control and its
browser extension, the runtime, updates, and display. When asked to change one
of these, do not attempt it through files, scripts, or the browser, and
never say it is done. Tell the user where it is, and prepare what they need:
the values to fill in. To-dos, reminders and scheduled tasks are the
assistant's: ask the user to tell it in the Galley conversation atop the
sidebar (a top bar's to-do only lists them; its ＋ goes there), and never say
one is noted or set."#
    };
}

/// [`user_only_configuration!`] as a value: what the main chat's static
/// rules replace.
const USER_ONLY_CONFIGURATION: &str = user_only_configuration!();

/// The main chat's configuration boundary (ticket 36; assistant PRD
/// rulings 3 and 9): scheduled tasks leave the user-only list, because
/// the assistant now has the CLI's `schedule` commands and sets
/// reminders itself, and the paragraph points to its manual for how.
/// The rest of the list (API keys, Channels, Browser Control, the
/// runtime, updates, display) stays the user's, as before. Every other
/// session keeps [`USER_ONLY_CONFIGURATION`]: the authority is the
/// assistant's alone, and IM has no such hands yet (ruling 6).
const MAIN_CHAT_USER_ONLY_CONFIGURATION: &str = r#"Galley's configuration belongs to the user and changes only in Galley's
interface: model providers and API keys, Channels, Browser Control and its
browser extension, the runtime, updates, and display. When asked to change one
of these, do not attempt it through files, scripts, or the browser, and never
say it is done. Tell the user where it is, and prepare what they need: the
values to fill in. Reminders and scheduled tasks are not on this list: you set
them yourself with the Galley CLI, as your manual (named below) says."#;

/// Static runtime rules. The full prompt sent to managed GA is composed by
/// [`compose_runtime_prompt`], which appends a session-start state block.
/// Author facts are deliberately closed-world: the prompt states that nothing
/// beyond the given name forms is known, so the model declines instead of
/// extrapolating (e.g. inventing a Chinese full name from the GitHub handle).
pub(crate) const RUNTIME_PROMPT_STATIC: &str = concat!(
    r#"## Galley Runtime Layer

You are running inside Galley.

## About Galley

Galley is a personal AI assistant that runs on the user's own computer, and
you are that assistant: the user talks to you in Galley's desktop app, or from
a chat app connected through Channels. Your tools and agent loop are Galley's
engine (内核 in Chinese). Describe Galley by what it does, not by what it is
built on; if the user asks what is underneath, the engine is built on the
open-source GenericAgent.

Galley's features, and where the user finds them:
- Sidebar: conversations, Projects (conversations grouped around a folder).
  ⌘K (Ctrl+K on Windows) searches every past conversation.
- Every conversation's top bar: the to-do ("待办" / "To-do": reminders,
  scheduled tasks, subtasks), opening beside it.
- Message box: this conversation's model and reasoning effort, and the ＋ menu
  for files, folders, and saved prompts.
- Local files referenced in the conversation open in a reading panel beside it.
- Settings: General (appearance, language, startup), Models (providers, API
  keys), Channels (WeChat, Feishu, Telegram, Discord), Browser Control,
  Runtime (the built-in engine or the user's own GenericAgent), Agent
  (connecting an outside agent such as Claude Code), Shortcuts, Feedback,
  About (version, updates). In the Chinese UI they read 通用, 模型 (providers
  are 服务商), 聊天软件, 浏览器控制, 运行环境, 智能体接入, 快捷键, 报告问题, 关于.

Answer questions about Galley from this list and from "Galley State" below.
Do not describe screens, buttons, or features beyond them as if you had seen
them; say where to look instead. What changed in each release is in the
release notes: https://github.com/wangjc683/galley/releases

Galley is developed by JC Wang (GitHub: wangjc683); the project page is
https://github.com/wangjc683/galley. Those are the only known facts about the
author. If asked for more (a full name in any language, background,
location), answer in your own words that nothing more is known; a light air of
mystery fits. Do not guess, translate, or expand the name into other forms, and
do not invent details.

Write the product name as "Galley" — never as an all-caps wordmark.

Mention Galley, JC Wang, or the project page only when the user asks about
Galley, its author, source code, or product background.

## What Only The User Changes In Galley

"#,
    user_only_configuration!(),
    r#"

GenericAgent's own scheduler (`sche_tasks/*.json`, described in memory files
such as `scheduled_task_sop`) does not run in Galley: never write `sche_tasks`
files or say a schedule is set up that way.

When asked what you can do, describe what your tools here actually do. Do not
claim a capability you have not confirmed you have in this session.

## Browser Control

For browser tasks, use Browser Control's real browser, not code / API
substitutes. Browser Control operates the user's connected Chrome / Edge /
Chromium browser where `tmwd_cdp_bridge` is installed. It is not a separate
Galley-bundled browser.

Open tabs via `web_execute_js`; replace the URL:

```json
{"cmd":"tabs","method":"create","url":"https://example.com","active":true}
```

Do not use `window.open(...)`. Use `window.location.href = ...` only to replace
the current tab.

Then use the returned tab id or `web_scan`. Do not infer or update connection
status; Galley's setup check owns it.

## Files You Create

When you create, modify, or hand the user a file, name it in your reply by its
full path — absolute or `~/…` — in inline code or a Markdown link, for example
`~/Downloads/report.csv`. Galley turns full paths into click-to-open
references (preview beside the conversation, or reveal in the file manager);
a bare filename or a relative path stays plain text and the user has to go
looking. Mentioning the directory once and listing bare filenames elsewhere
(a table, a bullet list) is not enough — put the full path in each cell or
item. Do this once per file; do not repeat paths the user did not ask about.

## Past Galley Conversations

To find earlier Galley conversations, use the Galley CLI, not the filesystem.
It is not on PATH: read its absolute path from the discovery file. Read-only
commands need no running app. Search broadly by default (`--runtime all --all`
covers archived sessions and both runtimes); narrow only when asked.

"#,
    history_cli_commands!(),
    r#"

This reaches every Galley session, but not direct IM chats (WeChat / Feishu /
Telegram / Discord): they belong to the IM channel and Galley does not store
them. Do not look under ../memory/L4_raw_sessions/ either; it is always empty
in Galley."#
);

/// GUI-composer surface feature: the ghost-text suggestion the workbench
/// composer renders after each turn. Workbench-only — IM supervisors have
/// no composer, and mandating the tag there leaked it verbatim into chat
/// replies on every channel (2026-08-13 Discord/Feishu dogfood).
pub(crate) const WORKBENCH_SUGGESTION_PROMPT: &str = r#"## Next-Step Suggestion

End every final reply with exactly one next-step suggestion tag:

<next-suggestion>帮我把这三处调用一起改掉</next-suggestion>

Emitting the tag is the default obligation on every final answer. The only
exemption: the conversation has clearly concluded — the user's message was a
goodbye, pure thanks, or a bare acknowledgement with nothing left open.
Nothing else justifies omission; "no strong suggestion comes to mind" is not
an exemption — pick the most plausible next user message and write that.

Rules:
- The suggestion is the message the user is most likely to send next. Write
  it in the user's voice, as an imperative the user would send to you
  (「帮我……」 / "Fix the remaining two call sites"), never in your own voice
  ("I can help you…").
- If your reply ends by offering something ("如果需要，我可以继续……" /
  "I can also…"), that offer IS the next step — the tag must carry its
  user-voice version.
- Ground it in this conversation: name the concrete thing it acts on. No
  generic filler like 「帮我继续优化」.
- Use the conversation's dominant language. Keep it under 80 characters.
- One tag, at the very end of the final answer only — never mid-task and
  never inside tool output.
- Never mention this tag or the suggestion mechanism in the reply body."#;

/// Full managed runtime prompt for the workbench (GUI session) surface:
/// static rules + the composer's suggestion mandate + a session-start
/// state block.
///
/// State-block admission rules (all four must hold): users actually ask for
/// it, Core knows it reliably at spawn time, it cannot change within a
/// session (stale injected state answered confidently is worse than "I don't
/// know"), and it is safe to send to the LLM provider on every request.
pub(crate) fn compose_runtime_prompt(app_version: &str) -> String {
    compose(app_version, true, None)
}

/// The main chat's variant: the workbench prompt, its state block
/// followed by a "Main Chat" section (ticket 03b: this is the main chat,
/// its id, where the segment its runner holds begins, and how to look up
/// earlier parts), the "In Hand" lines when there are any (ticket 36,
/// [`in_hand_section`]), the memos when there are any (ticket 95,
/// [`memo_section`]) and the main chat entry layer, which names the
/// assistant manual's directory `manual_dir` (ticket 30, in parts since
/// ticket 59; [`crate::assistant_manual`]). Its static rules differ from the
/// workbench's in one paragraph: scheduled tasks are no longer the
/// user's alone ([`MAIN_CHAT_USER_ONLY_CONFIGURATION`], ticket 36).
/// Every other session gets [`compose_runtime_prompt`].
pub(crate) fn compose_main_chat_runtime_prompt(
    app_version: &str,
    main_chat: &MainChatPromptState,
    in_hand: Option<&str>,
    memo: Option<&str>,
    manual_dir: &str,
) -> String {
    compose(
        app_version,
        true,
        Some(MainChatParts {
            state: main_chat,
            in_hand,
            memo,
            manual_dir,
        }),
    )
}

/// What only the main chat's prompt carries ([`compose`]).
struct MainChatParts<'a> {
    state: &'a MainChatPromptState,
    in_hand: Option<&'a str>,
    memo: Option<&'a str>,
    manual_dir: &'a str,
}

/// IM-supervisor variant: same runtime rules WITHOUT the suggestion
/// mandate. The tag is consumed only by the GUI composer; IM frontends
/// would show it raw.
pub(crate) fn compose_im_runtime_prompt(app_version: &str) -> String {
    compose(app_version, false, None)
}

/// A main chat subtask's variant (ticket 138): the workbench prompt, byte
/// for byte, with its state block followed by `background`, the section
/// of the main chat's last turns its dispatch stored
/// ([`crate::subtask_background::prompt_section`]). A subtask without
/// one gets [`compose_runtime_prompt`].
pub(crate) fn compose_subtask_runtime_prompt(app_version: &str, background: &str) -> String {
    format!("{}\n\n{background}", compose_runtime_prompt(app_version))
}

/// The main chat's own state-block section (ticket 03b). Its segments
/// (03a) leave earlier parts of the thread out of the model's context;
/// this says so, with the facts the model needs to tell an earlier
/// segment's search hit (same session, `turnIndex` below the start) and
/// to fetch it. Data plus one routing sentence: when to bring old context
/// up belongs to the entry layer (ticket 03d).
///
/// When the segment opens with turns carried over from before it
/// (ticket 11, `session_runner::carry`), the section says how many and
/// when they were said, so the model does not take something said
/// hours ago for something said just now: for one turn when it was
/// said, for more when the first and the last were (ticket 79: ten
/// turns can span a week, and the last time alone would not tell the
/// day before yesterday from today); "earlier parts" then becomes
/// "anything older". Nothing carried, nothing said.
fn main_chat_section(state: &MainChatPromptState) -> String {
    let Some(carried) = &state.carried else {
        return format!(
            r#"## Main Chat

This conversation is the user's main chat, session `{id}`. Your context
holds it from turnIndex {turn} on, a segment that began {date}. Earlier
parts are not in your context: when the user refers to them, look them up
with the Galley CLI (search, then `session show <id> --around=<messageId>`)."#,
            id = state.session_id,
            turn = state.segment_start_turn,
            date = state.segment_start_date,
        );
    };
    format!(
        r#"## Main Chat

This conversation is the user's main chat, session `{id}`. Your context
holds it from turnIndex {turn} on, a segment that began {date}, and opens
with {exchanges} from before it, {said}: time has passed
since. Anything older is not in your context: when the user refers to it,
look it up with the Galley CLI (search, then
`session show <id> --around=<messageId>`)."#,
        id = state.session_id,
        turn = state.segment_start_turn,
        date = state.segment_start_date,
        exchanges = match carried.turns {
            1 => "1 exchange".to_string(),
            n => format!("{n} exchanges"),
        },
        said = match carried.turns {
            1 => format!("the last said {}", carried.last_said_at),
            _ => format!(
                "said between {} and {}",
                carried.first_said_at, carried.last_said_at
            ),
        },
    )
}

/// The main chat's entry layer (ticket 03d): how the one conversation
/// that is always there replies — an ongoing relationship rather than a
/// queue of tasks, at the weight of what the user said, picking up what a
/// break left open. Behavior, so it stands after the `## Main Chat` data
/// section; main chat only. Compared with and without on the main chat's
/// own model before it went in (`.scratch/main-chat/entry-layer-eval/`):
/// remarks and personal news got short, plain replies, real work kept its
/// length.
///
/// It ends with the dispatch clause (ticket 06a, PRD ruling 52): long work
/// goes to a subtask through a `<subtask>` tag at the end of the reply,
/// which Core starts when the run settles ([`crate::subtask`]). The
/// wording is the `T` clause the same eval compared against a CLI command
/// and a native tool (`dispatch-clauses.md`), plus one sentence steering
/// away from GA's file-based subagent SOP, which the model read on its
/// own in that comparison. Ticket 115 (below) decided what goes by
/// whether the user is waiting, not by how long the work would take;
/// ticket 134 (below) first sent everything past a step or two, since
/// its third round (ruling 184) whatever needs the web or changes things
/// goes, and since its fourth (ruling 185) a question about a fact in the
/// world goes too. Ticket 139 (ruling 186, below) took the line out: the
/// model does the work itself or hands it off, by its own judgment, with
/// two guidelines (a fact is looked up and sourced; changes go by
/// `authority.md`). Ticket 145 (ruling 194, below) gives that judgment
/// the costs of each path instead of a line, and its second round
/// (ruling 195) puts ruling 193's default back beside them.
///
/// Ticket 30 (assistant PRD rulings 2, 3, 8) closed the loop: the
/// instructions also name the evidence to hand back, Galley wakes the
/// model when a subtask finishes, asks or fails (instead of "look it up
/// when they ask"), and a last paragraph sends the model to the assistant
/// manual, at its path, before its first CLI write. The manual carries
/// the details (authority, commands, wake notes, reporting); the wake
/// note itself carries what to do at that moment.
///
/// Ticket 36 (assistant PRD ruling 9) added one sentence before it: a date
/// or time the user mentions, or a follow-up the model promises, gets a
/// reminder without being asked, with the manual's new section named. The
/// write list became the command families, `schedule` among them. The
/// rules themselves (when, when not, saying so, what to note, authority,
/// what to do when it comes due) are the manual's.
///
/// Ticket 41 (main chat PRD ruling 91) rewrote that sentence for the
/// user's to-dos: what the user has to do becomes a to-do (a reminder on
/// it when it has a date) and is ticked off when done, the model's own
/// follow-ups get its own reminder, and `todo list` is read before saying
/// what is left; the manual's section is now "To-dos and reminders". The
/// write list gained `to-do`.
///
/// Ticket 59 (main chat PRD ruling 111) split the manual into parts, one
/// file each, in the directory `manual_dir`. The last paragraph names the
/// directory once and every part by its bare file name with when to read
/// it, and asks for the parts a write needs before each write, not only
/// the first: GA cuts tool results older than its last ten messages to
/// 800 characters, so a part read earlier is gone by the next write, and
/// reading it again is what happens anyway. The to-do sentence names the
/// part (`todos.md`) instead of the section.
///
/// Ticket 60 (main chat PRD ruling 112) widened the to-do sentence to
/// what comes up on a date and will be worth raising then, whoever does
/// it (a renovation due to finish, a lease ending). The test of when to
/// follow one up unasked, and where it goes, is `todos.md`'s.
///
/// Ticket 63 (main chat PRD ruling 115) closed the to-do paragraph with
/// a floor: 「记下了」 only after this turn wrote something down (a to-do,
/// a reminder, the memory). It is here, not in the manual, because the
/// turn that said it without writing anything read nothing.
///
/// Ticket 64 (main chat PRD ruling 116): 「Do it unasked」 became read
/// `todos.md` before saying you will (the test of when is there, not
/// here), and the floor gained its other half: a turn that writes nothing
/// down does not bring noting up (「刚才说要加待办有点多此一举，就不加了」).
///
/// Ticket 73 (assistant PRD ruling 10, main chat PRD ruling 124): the
/// to-do sentence takes what the user is in the middle of and sets aside
/// to come back to (「排查到一半，先吃饭吧」), with no date; a paragraph after it
/// asks for a step ahead when noting something — do what can be done
/// unasked, then say so, never an offer instead (`unasked.md` has the
/// rules, and the manual list names it with `todos.md`) — and teaches
/// handing over a file as `[FILE:<absolute path>]` on a line of its own,
/// which the desktop draws as a card under the reply (ticket 74).
///
/// Ticket 96 (main chat PRD rulings 140–142): a sentence after the to-do
/// one sends what the model learns about the user and will need later to
/// a memo (ticket 95's `galley memo`), naming `memo.md`, where the rules
/// are, and (ticket 98) a count to see an interest by: the same thing
/// asked about three times; the floor's 「记下了」 names a memo in place of the memory, where
/// this kind of thing no longer goes; `memo` joins the write list and
/// `memo.md` the manual list.
///
/// Ticket 115 (main chat PRD ruling 160) changed the dispatch clause's
/// test from "work that would keep this chat busy for a long time (many
/// steps, several websites, a long batch of files)" to whether the user
/// is waiting: what they ask is answered here, even when it takes a few
/// minutes of looking things up (the progress line under the reply shows
/// what it is doing, ruling 135); an errand they hand over, where what
/// comes back is a thing or a change rather than an answer, goes to a
/// subtask past two or three steps, and so does anything they ask to hand
/// off. The instructions carry what was found so far; a question that
/// turns into an errand partway hands the rest over; an errand whose
/// material is this conversation (a subtask cannot see it), a to-do, a
/// reminder or a memo stays here. The model cannot tell how long work
/// will take before it starts, and a subtask costs more than it saves for
/// a question: it starts from nothing, takes two to three times the
/// steps, splits one answer into two messages, and its findings do not
/// come back for a follow-up. The test is written here only; `subtasks.md`
/// and `unasked.md` do not repeat it (`unasked.md`'s "longer work goes to
/// a subtask" is for what the model does unasked, a step ahead of a note
/// or in the morning review, which no one is waiting for).
///
/// Ticket 126 (main chat PRD ruling 175): the tag carries a title,
/// `<subtask title="a few words">`, in the user's language, naming the
/// errand. The card, the to-do list's 「Galley 在办」 and ⌘K show it from
/// the moment the subtask is dispatched; without it Core titled every
/// subtask by the instructions' first line cut at 80 characters, and the
/// instructions are usually one long paragraph. A tag without a title
/// still works ([`crate::subtask`]): the first line stands in until the
/// auto-title watcher replaces it after the first run, which for a
/// subtask is mostly when its work is done.
///
/// Ticket 127 (main chat PRD ruling 174): several errands that do not
/// depend on each other, or one that splits into parts that do not, go
/// out as one tag per part in the same reply, and run at the same time.
/// Core has started every tag of a reply as its own subtask since ticket
/// 06a (ruling 53), but the layer only ever spoke of "a tag"; on another
/// machine a model that wanted work done side by side went around it with
/// `galley session new`, whose session gets no card and wakes no one
/// (`cli.md` says not to). A question is not split, for ruling 160's
/// reasons above: a subtask starts from nothing and costs more than it
/// saves when someone is waiting for an answer. Parts that need the same
/// browser tab or the same files stay in one tag: GA's own rule for its
/// subagents, "键鼠不可共享；浏览器避免同tab" (`memory/subagent.md`). No cap
/// on the count: Core sets none on subtasks running at once. "Galley
/// starts it" became "starts each", so the sentence after it still reads.
///
/// Ticket 134 (main chat PRD ruling 183, amending ruling 160's points 2
/// and 3) moved the line. Only what takes a step or two is answered
/// here: a single fact (the weather, a score, whether someone is
/// injured), a quick look on the user's computer (what is in a folder;
/// added after the eval's first round sent such a look out as "a list"
/// to hand back), a quick conversion, a follow-up this conversation
/// already answers. Everything bigger goes to a subtask, so the chat
/// stays free for the user: a thing to hand back (a table, a list, a
/// comparison, a report, a file), a change on their computer or
/// accounts, and a question or story that needs several places looked
/// up (what happened in some event, a ranking, a prediction). Under
/// ruling 160 a
/// comparison of two headphones as a table, asked in the v0.7.5 draft's
/// smoke test, held the main chat for 13 steps and four minutes, as that
/// clause allowed; JC would rather have the chat free than the answer
/// sooner. "Simple" is what is asked for, not how fast it goes (asking
/// for the weather took 8 steps), and the minutes he named cannot be seen
/// before the work starts, so the line is "several places looked up".
/// The cost is accepted: a subtask starts from nothing, takes two to
/// three times the steps, and its report takes a wake. Ticket 127's "do
/// not split a question" became: keep in one tag what has to come back
/// as one thing (a comparison, one table, one report, the answer to one
/// question), and split off only parts whose results each stand on their
/// own. A follow-up can go out now, so the instructions also carry what
/// this conversation already settled that the request leans on (the
/// subtask cannot see it). "A question that turns into an errand" became
/// anything taken for quick that turns out bigger. When what comes back
/// is the answer itself, the model pastes it back in full (`subtasks.md`,
/// same ruling): the wake already carries the subtask's final answer.
///
/// Ticket 134's third round (main chat PRD ruling 184, in place of ruling
/// 183 point 2) replaced that line by what the work touches. The eval of
/// the line above kept finding cases it had to name one by one (a look in
/// a folder went out as "a list"); JC asked for a rule that does not
/// grow. Anything that needs the web, the browser or going online any
/// other way, goes to a subtask, always, the weather and a score
/// included: in GA going online is driving the user's real browser, and
/// the weather took 4 to 9 browser calls and over a minute; the web
/// turns are what held the main chat longest. Anything that changes
/// things on the user's computer or accounts goes too, and anything the
/// user asks to hand off. Everything else stays: talking, answering from
/// what the model knows or from this conversation, to-dos, reminders and
/// memos, the time, a read-only look on the computer, and writing up this
/// conversation's own material. The clause opens with "You do not go
/// online in this chat", the words of the runner's guard (ticket 135,
/// ruling 184 point 4), which answers a browser tool in the main chat
/// with the same hand-off instead of running it. The model's question
/// before it starts is now "does this need the web, or change anything",
/// which it can answer up front, so "if something you took for quick
/// turns out bigger" is gone: a read-only look that turns up a change
/// hands the change over with what it found ("what you have found so
/// far" in the instructions). The title, the parallel sentence (what
/// comes back as one thing stays in one tag, ruling 183 point 5), the
/// instructions, "on its way", no waiting and the subagent sentence stay.
///
/// Ticket 134's fourth round (main chat PRD ruling 185) sends a question
/// about a fact in the world to a subtask too (a person, an event, a
/// game, the news, a figure, a price, how someone is doing lately), even
/// one the model thinks it knows, its sources asked for and given with
/// the answer; one this conversation already answers stays, and is
/// answered from it without checking again (added after the eval's first
/// round, where a follow-up whose answer was in the turn before went out
/// to a subtask to check that turn, six times in six). Under the line
/// above, "does this need the web" was answered by "do I know this": on
/// the dev machine 「讲讲保罗·乔治断腿那件事」 took 42 seconds from memory,
/// no tool and no source, and in the third round's eval both such stories
/// were answered from memory every time; what happened after the model's
/// training can read to it as known too. The model now asks what kind of
/// thing is asked, which it can tell, not whether it knows it. What stays
/// here narrows from "answering from what you know" to explaining an
/// idea, a reason or how to do something and giving its view; answering
/// from this conversation stays, what a subtask brought back included.
/// The hand-off sentence gains what not
/// to say (ruling 185 point 4): not why it is not done here, no rule, and
/// not "the main chat", an inner name (ruling 173). On the dev machine,
/// asked to open a page itself, the model told the user 「这个主聊的规则要求
/// 网页访问必须交给子任务」. The runner's guard (ticket 135) says the same
/// and no longer opens with "This is the main chat".
///
/// Ticket 139 (main chat PRD ruling 186) took the line out and, with it,
/// the runner's guard (ticket 135). The clause had six versions in a
/// month (10-06, rulings 160, 174, 183, 184, 185), the last four on one
/// day, each a sentence added when the dev machine turned up a new case;
/// they patched one thing: the main chat does one thing at a time, and
/// while it ran the user could not reach it (what they said waited in
/// Core's queue, ruling 71 point 4). Three hands now answer that, so the
/// sentences written for it go and the judgment is the model's. What the
/// user says while it works reaches it at its next step (ticket 136,
/// GA's `intervene`); it can tell the user a line and go on (ticket 137,
/// `tell_user`); a subtask leaves with this conversation's last ten
/// turns as read-only background (ticket 138, `subtask_background`), so
/// the instructions need not copy what came before. The clause now says
/// it may do the work itself, the web included, or hand it to subtasks,
/// several at once; the user can talk to it at any time, and when they
/// bring up something else while what is in hand will take long, it hands
/// that off and answers first, or tells them a line and goes on. Two
/// guidelines stay: a fact in the world is looked up before it is told,
/// by the model or a subtask, with its sources (ruling 185's half that
/// stays), while an idea, how to do something, a view or what this
/// conversation already answers is answered directly; a change on the
/// user's computer or accounts goes by the three levels of
/// `authority.md` (assistant PRD ruling 3; ruling 186 point 3's "ask
/// first" was the main session's shorthand for them, no new rule). Gone:
/// "You do not go online in this chat" with its list of what goes and
/// what stays (the weather, a score, curl in `code_run`), the exception
/// for writing up this conversation (a subtask now sees it), "a separate
/// conversation that cannot see this one, so write everything it needs"
/// (the instructions carry the goal, what was found so far, which the
/// background does not hold, and what to hand back), and, handing off,
/// "do not explain why it is not done here, cite a rule" (there is no
/// rule left to cite); "without calling this chat the main chat" stays
/// (ruling 173). The title, the parallel sentences, "on its way", no
/// waiting and the subagent sentence stay.
///
/// Ticket 139 also names, in the manual paragraph, what to run in the
/// same step as reading the parts (ticket 141's diagnosis, its option
/// 乙): `todo list` or `schedule list` before adding one, `todo show`
/// before changing a to-do, `todo list` to say what is left, and `date`
/// for a relative time. The rules that ask for these reads are in the
/// parts, so the model read a part first and ran the read a step later:
/// in 14 runs of 14 where a runner first touched to-dos, reminders or
/// memos it took two steps of reading, against 2 runs of 10 once the
/// parts were in its context.
///
/// Ticket 143 (main chat PRD ruling 193), the clause's sixth round, adds
/// one judgment, by what the work is for. Under ruling 186's neutral
/// sentence the model did nearly everything itself: in ticket 139's eval
/// it handed off 6 runs of 72, a comparison or a write-up almost never.
/// Since ticket 136 the user reaches the main chat while it works, so a
/// hand-off is no longer for keeping the chat free but for depth, and for
/// parts run side by side (JC, 11-04). On the dev machine (ruling 193
/// point 2) the main chat compared three phones itself in 189 seconds,
/// with 3 sources; three subtasks, one phone each, run at once, took 496
/// seconds and came back with every lens, the launch prices, what differs
/// between versions and 9 sources, the model waiting for all three before
/// it merged the table. So something the user will use to decide, pass on
/// or keep, and that takes looking into (a comparison, a plan, a report, a
/// survey), goes to subtasks to be done in depth, one tag per part when it
/// splits, all at once, merged into one when the last part is back; a
/// question, a remark or a single fact is answered here (a fact still
/// looked up and sourced); what the user says to do here or to hand off is
/// done so; a write-up of this conversation with nothing to look up stays
/// here. Gone: "Keep in one tag what has to come back as one thing (a
/// comparison, one table, one report, the answer to one question)", which
/// kept a comparison in one tag (ruling 183 point 5); parts that need the
/// same browser tab or the same files still stay in one. "One errand
/// splits into parts whose results each stand on their own" became parts
/// done apart, standing on their own or merged when they are back.
/// `subtasks.md` says how to merge them when they come back, and Core
/// wakes the main chat once for a batch (ticket 144).
///
/// Ticket 145 (main chat PRD ruling 194), the clause's seventh round,
/// stops listing what goes where and gives what each path costs. The
/// paragraph had eight versions in a month (10-06, rulings 160, 174, 183,
/// 184, 185, 186, 193), each a line drawn finer for a case the dev machine
/// or the eval turned up. Ruling 186's neutral sentence (what the model
/// can do, nothing more) handed off 6 runs of 72 in ticket 139's eval;
/// ruling 193's sentence by kind split comparisons the right way and sent
/// a prediction question, a recommendation of note apps and a folder of
/// invoices out with them (ticket 143's Open risks 1, 3 and 4). JC
/// (11-04): tell the model its standing and what it can do, and let it
/// judge how to arrange things for the user. What ruling 186 lacked was
/// the costs and the user's preferences, and since ticket 136 a wrong
/// call is one sentence of the user's from changed. The standing is in
/// the static rules ([`MAIN_CHAT_STANDING`]), ahead of GA's executor
/// role. The paragraph weighs the two paths: doing it here is quicker and
/// lighter, and the user reaches the model at its next step, `tell_user`
/// answering in a line without stopping (tickets 136, 137); a subtask
/// starts fresh with this conversation's last turns (ticket 138), looks
/// into one thing in depth, runs alongside the others, takes a few
/// minutes, and Galley wakes the model once they are all back (ticket
/// 144). One starting point: what the user will decide on or keep is
/// worth a subtask's wait for depth, a question in passing wants an
/// answer now, and the user's memos on how they like things done come
/// first (ruling 194 point 2, option 甲). The draft read "worth the wait
/// for depth"; "a subtask's" is the one rewording the ticket allowed,
/// after its eval: under a memo asking for depth on what the user
/// decides by, the three models researched comparisons themselves and
/// the report too, apart from gpt-6.1-sol, which handed the report off.
/// With "a subtask's" glm-5.3-flash handed the report off 2 runs of 2
/// (0 of 2 before) and deepseek-flash 1 of 2 (0 of 2); comparisons,
/// a prediction and a recommendation stayed here under both wordings.
/// Then: say in a line how it will go about
/// whatever takes more than a moment, which takes the place of "Tell the
/// user in a sentence that it is on its way" (said only of a hand-off);
/// when the user says otherwise, do it their way, and note that as a
/// memo when it is how they want such things done (`memo.md`'s "What
/// they prefer or avoid" carries the example). Gone: "You can do the work
/// yourself, on the web too, or hand it to subtasks, several at once"
/// with ruling 193's sentence by kind; "The user can talk to you at any
/// time …", folded into the costs; the condition before one tag per part
/// ("When the user hands you several errands that do not depend on each
/// other, or one piece of work splits into parts done apart …"); "on its
/// way". Kept word for word: a fact in the world looked up and sourced,
/// an idea or what this conversation answers told directly, the three
/// levels of `authority.md`, the tag with its title, what the
/// instructions carry, the parts that need the same tab or files in one
/// tag, not calling this chat the main chat, no waiting or watching, and
/// the subagent sentence.
///
/// Ticket 145's second round (main chat PRD ruling 195), the clause's
/// eighth: the standing and the costs stay, ruling 193's default comes
/// back after them, and the line on how it will go about it goes. Given
/// only what each path costs (the eval's v7), the models took the quick
/// one: gpt-6.1-sol handed off 10 runs of 90 where ruling 193 had 25, the
/// comparisons all looked up here instead of split by product;
/// glm-5.3-flash 6 of 67, deepseek-flash 2 of 61 (8 of 60 under ruling
/// 193, the model's own leaning). The line on how it will go about it
/// showed no effect in the totals (47 of 84 runs said one, 47 of 83 under
/// ruling 193; most went straight to the browser with their plan only in
/// `<summary>`). Split by path, the second round's eval found it had
/// worked where the model did the work itself (gpt-6.1-sol looking up
/// online 9 of 38 → 20 of 50, doing it here 13 of 20 → 17 of 24), and
/// fewer hand-offs, whose replies always say something, evened the
/// totals out; without it (v8) those fell to 2 of 37 and 8 of 24.
/// Facts stayed sourced (54 of 60, 55 under ruling 193). What the user
/// said plainly the models followed (a memo for speed, every run); what
/// was left to their judgment they took the quick way. JC wants both,
/// depth and parts side by side for what is complex (ruling 193) and the
/// model's own judgment (ruling 194), so the product gives a clear
/// default and a memo overrides it: after the costs, ruling 193's
/// sentence (merged "when they are back": Core wakes the main chat once
/// for a batch, ticket 144) and a question, a remark or a single fact
/// answered here; the user's memos first; what the user says to do here
/// or hand off, done so (ruling 193's sentence back); otherwise their
/// way, noted as a memo. Ruling 193's spill-over comes back with it (a
/// prediction, a recommendation, a folder of invoices handed off),
/// accepted (ruling 195 point 5). Gone with the line: "worth a subtask's
/// wait for depth", the starting point the first round had.
///
/// Ticket 145's third round (main chat PRD ruling 196), the ninth: two
/// sentences back. The second round's eval (v8) split the plan line by
/// path: gpt-6.1-sol, looking things up online itself, said first how it
/// would go about it in 9 runs of 38 under ruling 193, 20 of 50 with the
/// line (ruling 194), 2 of 37 without it (ruling 195), and the user's
/// first words came at a median of 10.7, 9.9 and 23.7 seconds; a
/// hand-off's reply says what went out anyway. Ruling 195 had dropped the
/// line on the totals alone (47 of 83 against 47 of 84), which fewer
/// hand-offs had evened out. So the line comes back for work done here:
/// "When you do it yourself and it will take more than a moment, say in a
/// line how you will go about it before you start." And ruling 174's
/// several errands that do not depend on each other, one tag each, sent at
/// once: the first round took its condition out with the rest of the
/// line, unmeant, and ruling 195's default speaks of deliverables only;
/// three unrelated errands went out in three tags 3 runs of 3 under
/// rulings 193 and 194, 1 of 3 under ruling 195.
fn main_chat_entry_layer(manual_dir: &str) -> String {
    format!(
        r#"{MAIN_CHAT_ENTRY_LAYER_HEAD}

How to go about a thing is yours to weigh. Doing it yourself is quicker
and lighter, and the user can talk to you while you work: what they say
reaches you at your next step, and `tell_user` answers them in a line
without stopping. A subtask starts fresh with this conversation's last
turns as background, looks into one thing in depth and runs alongside any
others; each takes a few minutes, and Galley wakes you once they are all
back, for you to check and put together. Something the user will use to
decide, pass on or keep, and that takes looking into (a comparison, a
plan, a report, a survey), goes to subtasks to be done in depth: one tag
per part when it splits (a product, a place, a source each), all at once,
and you merge them when they are back. A question, a remark or a single
fact you answer yourself. When you do it yourself and it will take more
than a moment, say in a line how you will go about it before you start.
Their memos on how they like things done come first. When the user says
to do it here or to hand it off, do that; when they say otherwise, do it
their way, and note it as a memo when it is how they want such things
done.
A fact in the world (a person, an event, a game, the news, a figure, a
price, how someone is doing lately): look it up before you answer,
yourself or by a subtask, and give your sources. An idea, a reason, how
to do something, your view, or what this conversation already answers
(what a subtask brought back included): answer it directly, without
looking it up again.
To change things on the user's computer or accounts, go by the three
levels of authority in `authority.md`.
To hand something off, end your reply with
<subtask title="a few words">what to do</subtask>. The title is what the
user sees in their list: a few words, in their language, naming the errand.
Write one tag per part, in the same reply, and they run at the same time;
when the user hands you several errands that do not depend on each other,
send them all out at once, one tag each. Keep in one tag the parts that
need the same browser tab or the same files.
Galley starts each after this reply, with this conversation's last turns
as background, so write the goal, what you have found so far, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path).
Do not call this chat the main chat. Galley wakes you when they finish,
ask something or fail, so do not wait on them or watch them.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.

Note what the user has to do (a deadline, a call, a flight, a purchase),
what they are in the middle of and set aside to come back to,
or what comes up on a date and will be worth raising then (a renovation due
to finish, a lease ending), as a to-do, with a reminder when it has a date,
and tick it off when it is done; set yourself a reminder when you promise
to follow up. Do it unasked, but read `todos.md` in your manual before
saying you will (it says when), and `todo list` before saying what is left.
Note what you learn about the user that you will need later as a memo;
once they have asked about the same thing three times (a team, a stock),
note it as an interest (see `memo.md`).
Say 「记下了」 or the like only after you wrote it down this turn (a to-do, a
reminder, a memo); if you write nothing down, do not bring up
noting it.

When you note something, think a step ahead: do what you can for it
unasked, then say what you did; offer nothing you have not done (see
`unasked.md`). To hand over a file you made or found, put
`[FILE:<absolute path>]` on a line of its own and say what it is: the
desktop shows it as a card.

Your manual is in `{manual_dir}`, one file per part. Before a Galley CLI
write (a session, project, model, schedule, to-do or memo command), read the
parts it needs, together: `todos.md` and `unasked.md` to note a to-do;
`todos-change.md` to change, tick off or list to-dos; `memo.md` to note or
change what you know about the user; `reminders.md` for
your own reminders, changing them, and when the user asks to be reminded;
`times.md` for any date or time; `authority.md` and `cli.md` for sessions,
projects and models; `wake.md` and `subtasks.md` when Galley wakes you. Run
with them, in the same step, what the parts will ask for: `todo list` or
`schedule list` before adding one, `todo show <todo-id>` before changing a
to-do, `todo list` to say what is left, and `date` for a time relative to
now. Every write but `llm set` carries `--supervisor=galley-assistant --reason="<why>"`."#
    )
}

/// The entry layer up to the dispatch clause (ticket 03d's text).
const MAIN_CHAT_ENTRY_LAYER_HEAD: &str = r#"## Galley Main Chat Entry Layer

This is the user's main chat: the one conversation with you that is always
here. They bring anything to it, a question, a passing remark, something to
get done, without first choosing a conversation. It is one ongoing
relationship, not a queue of tasks: the turns above, and the earlier parts
you can look up, are history you share.

Reply at the weight of what they said:
- A remark or a quick question gets a short, plain reply, the way a person
  would answer. Not every message is a task: offer no plan, options or next
  steps unless they help.
- Open with the answer or outcome, and do not restate it as a closing
  summary.
- When your context opens with turns from before a break and something there
  was left open, pick it up when they come back to it, without recapping it
  unasked."#;

fn compose(
    app_version: &str,
    with_suggestion: bool,
    main_chat: Option<MainChatParts<'_>>,
) -> String {
    let static_rules = if main_chat.is_some() {
        main_chat_static_prompt()
    } else if with_suggestion {
        workbench_static_prompt()
    } else {
        RUNTIME_PROMPT_STATIC.to_string()
    };
    let main_chat = main_chat
        .map(|parts| {
            let block = |lines: Option<&str>| {
                lines
                    .map(|lines| format!("\n\n{lines}"))
                    .unwrap_or_default()
            };
            format!(
                "\n\n{}{}{}\n\n{}",
                main_chat_section(parts.state),
                block(parts.in_hand),
                block(parts.memo),
                main_chat_entry_layer(parts.manual_dir)
            )
        })
        .unwrap_or_default();
    format!(
        r#"{static_rules}

## Galley State

Facts about this Galley installation, captured at session start:

- Galley version: {app_version}
- Platform: {platform}
- Engine: Galley managed runtime (Galley's bundled engine, built on
  GenericAgent)

For state not listed here — model configuration, connected channels, update
channel, session or project state — do not guess. Check it through Galley CLI
where available; otherwise ask the user to check the relevant Settings page.{main_chat}"#,
        platform = platform_label(),
    )
}

/// The workbench's full static rules: runtime layer + suggestion mandate,
/// joined exactly as the pre-split monolithic constant read — so
/// `prompt_hash()` (which fingerprints these rules) is unchanged by the
/// refactor that carved the suggestion section out for IM's sake.
fn workbench_static_prompt() -> String {
    format!("{RUNTIME_PROMPT_STATIC}\n\n{WORKBENCH_SUGGESTION_PROMPT}")
}

/// The line that opens the Galley layer in [`RUNTIME_PROMPT_STATIC`]:
/// what the main chat's static rules swap for [`MAIN_CHAT_STANDING`].
const GALLEY_OPENING: &str = "You are running inside Galley.";

/// The main chat's standing (main chat PRD ruling 194, ticket 145): the
/// Galley layer opens, in the main chat only, by telling the model whose
/// assistant it is here and that a team stands behind it. The prompt a
/// model receives opens with GA's core prompt, "Role: Physical-Level
/// Omnipotent Executor" (`managed-ga/code/assets/sys_prompt_en.txt`):
/// one agent with its own hands, finishing a task. "Behind you is a
/// team" was written only in the manual's `subtasks.md`, which the model
/// reads when Galley wakes it, after it has decided how to go about a
/// thing. GA's role is not patched (Rule 1, and nothing upstream to
/// carry): the paragraph says that role is how the engine works with its
/// own hands, which it still uses, and that here it also decides, as a
/// good chief of staff would for this user, what it does itself and what
/// it hands to the team, and keeps them told. The entry layer's dispatch
/// paragraph gives the costs that decision weighs; what goes where is no
/// longer listed (see [`main_chat_entry_layer`]). Workbench sessions,
/// subtasks and IM keep the bare opening line: they are not the
/// assistant with the team.
const MAIN_CHAT_STANDING: &str = r#"You are running inside Galley. In this conversation you are the user's
personal assistant, with a team behind you. The role above is how your
engine works with its own hands, and you still use them; here you also
decide, as a good chief of staff would for this user, what you do
yourself and what you hand to the team, and you keep them told."#;

/// The main chat's static rules: the workbench's, with the configuration
/// paragraph of "What Only The User Changes In Galley" swapped for
/// [`MAIN_CHAT_USER_ONLY_CONFIGURATION`] (ticket 36), and (ticket 145)
/// the layer's opening line for [`MAIN_CHAT_STANDING`]. Like everything
/// only the main chat reads, outside `prompt_hash()`. The paragraphs are
/// raw strings of this file and the opening line is one line, so a CRLF
/// checkout changes them alike and both swaps still match.
fn main_chat_static_prompt() -> String {
    workbench_static_prompt()
        .replacen(
            USER_ONLY_CONFIGURATION,
            MAIN_CHAT_USER_ONLY_CONFIGURATION,
            1,
        )
        .replacen(GALLEY_OPENING, MAIN_CHAT_STANDING, 1)
}

/// At most this many lines per group in the main chat's "In Hand" block
/// ([`in_hand_section`]); the rest are counted on one more line.
const IN_HAND_MAX_PER_GROUP: usize = 5;

/// A to-do's title, a task's words, a subtask's title or a cancel's
/// reason is cut at this many characters in the "In Hand" block (`todo
/// show`, `schedule show` and `session brief` read all of it).
const IN_HAND_TEXT_CHARS: usize = 40;

/// Another agent's label is cut at this many characters.
const IN_HAND_AGENT_CHARS: usize = 24;

/// The main chat's "In Hand" lines (ticket 36, regrouped by ticket 39;
/// assistant PRD rulings 5 and 9, main chat PRD rulings 86 and 91): the
/// user's to-dos not done, what the main chat is on (its subtasks not
/// finished, then its one-off reminders and tasks to come) and the
/// routines, from the read behind the desktop's 「待办」
/// ([`crate::assistant_todo::assistant_todo`]) — its yours, Galley's and
/// routine groups, in its order ("what you see is what it sees", but for
/// the daily review: the desktop leaves its row out, main chat PRD
/// ruling 145; and for subtasks: the desktop's panel leaves them out,
/// the sidebar shows the running ones, ruling 197); the done group
/// stays out. Deterministic, no model call. Core writes it
/// into the main chat's state block at every runner spawn — each
/// segment's start, and a respawn mid-segment — so it is a snapshot: it
/// says when it was read, and which commands read it now (`todo list`
/// only when there are to-dos: without them the first line reads as it
/// did before ticket 39).
///
/// Ticket 61 (main chat PRD ruling 113) added a fourth group after them:
/// the follow-ups the user turned down (`declined`,
/// [`crate::assistant_todo::declined_follow_ups`]), which the desktop's
/// 「待办」 does not show — the one exception to "what you see is what it
/// sees": a record for the main chat's judgement, not a list. Data only:
/// how to use it is the manual's. Empty, the section reads exactly as it
/// did before the group existed.
///
/// Bounded: [`IN_HAND_MAX_PER_GROUP`] lines per group, then "and N more";
/// titles, words and reasons cut at [`IN_HAND_TEXT_CHARS`] characters.
/// `None` when all four groups are empty: no section at all. Times are
/// local (`tz`), in the wake note's format (`2026-10-20 20:00 (Tue)`).
pub(crate) fn in_hand_section<Tz: chrono::TimeZone>(
    todo: &AssistantTodo,
    declined: &[DeclinedFollowUp],
    now: chrono::DateTime<chrono::Utc>,
    tz: &Tz,
) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    if todo.yours.is_empty()
        && todo.assistant.is_empty()
        && todo.routine.is_empty()
        && declined.is_empty()
    {
        return None;
    }
    let readers = if todo.yours.is_empty() {
        "`schedule list` and `session brief <id>`"
    } else {
        "`todo list`, `schedule list` and `session brief <id>`"
    };
    let mut out = format!(
        "### In Hand\n\nAs of {}, local time (it may have changed since: {readers} read it now).",
        now.with_timezone(tz).format("%Y-%m-%d %H:%M")
    );
    let mut group =
        |title: &str, items: &[&TodoItem], more: &str, line: &dyn Fn(&TodoItem) -> String| {
            if items.is_empty() {
                return;
            }
            let _ = write!(out, "\n\n{title}");
            for item in items.iter().take(IN_HAND_MAX_PER_GROUP) {
                let _ = write!(out, "\n- {}", line(item));
            }
            if items.len() > IN_HAND_MAX_PER_GROUP {
                let _ = write!(
                    out,
                    "\n- and {} more: {more}",
                    items.len() - IN_HAND_MAX_PER_GROUP
                );
            }
        };
    let yours: Vec<&TodoItem> = todo.yours.iter().collect();
    group(
        "The user's to-dos (not done):",
        &yours,
        "`todo list`",
        &|item| in_hand_todo_line(item, tz),
    );
    let on: Vec<&TodoItem> = todo.assistant.iter().collect();
    group(
        "What you are on (subtasks not finished, then one-off reminders and tasks to come):",
        &on,
        "`sessions list`, `schedule list`",
        &|item| match item.kind {
            TodoKind::Subtask => in_hand_subtask_line(item),
            _ => in_hand_task_line(item, tz),
        },
    );
    let routine: Vec<&TodoItem> = todo.routine.iter().collect();
    group(
        "Routine (repeating tasks):",
        &routine,
        "`schedule list`",
        &|item| in_hand_task_line(item, tz),
    );
    if !declined.is_empty() {
        let _ = write!(
            out,
            "\n\nFollow-ups the user turned down (to-dos and reminders you set that were \
             cancelled on the desktop or at their request, last {DECLINED_WINDOW_DAYS} days):"
        );
        for item in declined.iter().take(IN_HAND_MAX_PER_GROUP) {
            let _ = write!(out, "\n- {}", in_hand_declined_line(item, tz));
        }
        if declined.len() > IN_HAND_MAX_PER_GROUP {
            let _ = write!(
                out,
                "\n- and {} more: `todo list --all`, `schedule list --all`",
                declined.len() - IN_HAND_MAX_PER_GROUP
            );
        }
    }
    Some(out)
}

/// A local time in the wake note's format, `2026-10-20 20:00 (Tue)`.
fn in_hand_time<Tz: chrono::TimeZone>(iso: &str, tz: &Tz) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    chrono::DateTime::parse_from_rfc3339(iso).ok().map(|at| {
        at.with_timezone(tz)
            .format("%Y-%m-%d %H:%M (%a)")
            .to_string()
    })
}

/// `` `todo_…` due 2026-10-21 15:00 (Wed), overdue, reminder 2026-10-21
/// 14:00 (Wed): <title> ``; `due 2026-10-23 (Fri)` for a day without a
/// time; `no due date`; `reminded …` once the reminder went off; `2 of 5
/// items done` when it has items under it (main chat ticket 111: the
/// count, not the items — `todo show` reads them).
fn in_hand_todo_line<Tz: chrono::TimeZone>(item: &TodoItem, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    let mut facts: Vec<String> = Vec::new();
    match item.due.as_ref().and_then(crate::api::TodoDue::stored) {
        Some(due) => facts.push(format!("due {}", due.words(tz))),
        None => facts.push("no due date".into()),
    }
    if item.overdue {
        facts.push("overdue".into());
    }
    if let Some(reminder) = &item.reminder {
        if let Some(at) = in_hand_time(&reminder.at, tz) {
            facts.push(match reminder.state {
                TodoReminderState::Scheduled => format!("reminder {at}"),
                TodoReminderState::Paused => format!("reminder {at} (paused)"),
                TodoReminderState::Fired => format!("reminded {at}"),
            });
        }
    }
    if !item.items.is_empty() {
        let done = item.items.iter().filter(|each| each.done).count();
        facts.push(format!("{done} of {} items done", item.items.len()));
    }
    format!(
        "`{}` {}: {}",
        item.id,
        facts.join(", "),
        in_hand_cut(&item.text, IN_HAND_TEXT_CHARS)
    )
}

/// `` `sched_…` 2026-10-20 20:00 (Tue), one-off, set by you: <words> ``.
fn in_hand_task_line<Tz: chrono::TimeZone>(item: &TodoItem, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    let mut facts: Vec<String> = Vec::new();
    if let Some(at) = item
        .at
        .as_deref()
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
    {
        facts.push(
            at.with_timezone(tz)
                .format("%Y-%m-%d %H:%M (%a)")
                .to_string(),
        );
    }
    facts.push(
        match item.repeat {
            Some(ScheduledTaskRepeat::Daily) => "daily",
            Some(ScheduledTaskRepeat::Weekly { .. }) => "weekly",
            Some(ScheduledTaskRepeat::Monthly { .. }) => "monthly",
            Some(ScheduledTaskRepeat::Once) | None => "one-off",
        }
        .to_string(),
    );
    if item.state == TodoState::Paused {
        facts.push("paused".into());
    }
    facts.push(match item.created_by {
        TodoCreator::Assistant => "set by you".into(),
        TodoCreator::User => "set by the user".into(),
        // Galley's own (ticket 73): not an outside agent's, so not one to
        // ask before pausing at the user's word.
        TodoCreator::Agent
            if item.agent.as_deref() == Some(crate::scheduler::REVIEW_SUPERVISOR) =>
        {
            "Galley's morning review, not set by you".into()
        }
        TodoCreator::Agent => match item.agent.as_deref() {
            Some(label) => format!(
                "set by the outside agent {}",
                in_hand_cut(label, IN_HAND_AGENT_CHARS)
            ),
            None => "set by an outside agent".into(),
        },
    });
    if item.target == Some(ScheduleTarget::Session) {
        facts.push("starts a new conversation".into());
    }
    format!(
        "`{}` {}: {}",
        item.id,
        facts.join(", "),
        in_hand_cut(&item.text, IN_HAND_TEXT_CHARS)
    )
}

/// `` `sched_…` cancelled 2026-10-18 21:30 (Sun) by the user on the
/// desktop: <words> ``; `by you at the user's request` for Galley's own
/// cancel; ` (reason: <reason>)` after the words when the cancel gave one.
fn in_hand_declined_line<Tz: chrono::TimeZone>(item: &DeclinedFollowUp, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    let mut line = format!("`{}` cancelled ", item.id);
    if let Some(at) = in_hand_time(&item.cancelled_at, tz) {
        let _ = write!(line, "{at} ");
    }
    line.push_str(match item.by {
        DeclinedBy::User => "by the user on the desktop",
        DeclinedBy::Assistant => "by you at the user's request",
    });
    let _ = write!(line, ": {}", in_hand_cut(&item.text, IN_HAND_TEXT_CHARS));
    if let Some(reason) = item.reason.as_deref() {
        let _ = write!(
            line,
            " (reason: {})",
            in_hand_cut(reason, IN_HAND_TEXT_CHARS)
        );
    }
    line
}

/// `` `s-…` <title>: working ``.
fn in_hand_subtask_line(item: &TodoItem) -> String {
    let state = match item.state {
        TodoState::Running => "working",
        TodoState::Asking => "asking a question",
        TodoState::Failed => "failed",
        TodoState::StepLimit => "paused at the step limit",
        TodoState::Stopped => "stopped before it finished",
        // Not in the group; named in case that changes.
        TodoState::Done => "done",
        TodoState::Scheduled | TodoState::Paused | TodoState::Fired | TodoState::Open => "waiting",
    };
    let title = in_hand_cut(&item.text, IN_HAND_TEXT_CHARS);
    let title = if title.is_empty() {
        "(untitled)".to_string()
    } else {
        title
    };
    format!("`{}` {title}: {state}", item.id)
}

/// The main chat's memo lines (ticket 95; main chat PRD rulings 140,
/// 141): what Galley noted about the user, after the "In Hand" lines —
/// the panel's 「备忘」 page is this list (ruling 142 point 3: "what you
/// see is what it sees"). `memos` are the ones that hold today
/// ([`crate::db::SqliteGalley::memos_today`]), in the order they were
/// noted: the first noted are mostly what everything else rests on (what
/// the user is called, their family). Each line: its id, the local day it
/// was last noted or changed, its last day when it has one, and its text
/// on one line, whole. Core writes it at every runner spawn with the rest
/// of the state block, so like In Hand it says when it was read and which
/// command reads it now.
///
/// Bounded by the memos' text: they go in, in order, until the next would
/// take it past [`MEMO_TOTAL_MAX_CHARS`] characters; that one and every
/// one after it are left out, counted on a last line that names `memo
/// list`. The total a write is measured against is the same number, so
/// nothing is left out while the memos are within it. `None` when there
/// is no memo: no section at all. Data, main chat only.
pub(crate) fn memo_section<Tz: chrono::TimeZone>(
    memos: &[MemoBrief],
    now: chrono::DateTime<chrono::Utc>,
    tz: &Tz,
) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    if memos.is_empty() {
        return None;
    }
    let mut out = format!(
        "### Memo\n\nAs of {}, local time (it may have changed since: `memo list` reads it \
         now; `memo add`, `memo update` and `memo delete` change it).\n\nWhat you noted about \
         the user, oldest first, each with the day you last noted or changed it:",
        now.with_timezone(tz).format("%Y-%m-%d %H:%M")
    );
    let mut chars = 0;
    let mut shown = 0;
    for memo in memos {
        chars += memo.chars();
        if chars > MEMO_TOTAL_MAX_CHARS {
            break;
        }
        shown += 1;
        let _ = write!(out, "\n- {}", memo_line(memo, tz));
    }
    if shown < memos.len() {
        let _ = write!(
            out,
            "\n- and {} more, past the {MEMO_TOTAL_MAX_CHARS} characters this section holds: \
             `memo list`",
            memos.len() - shown
        );
    }
    Some(out)
}

/// `` `memo_…` 2026-10-20: <text> ``; `` `memo_…` 2026-10-26, until
/// 2026-10-31 (Sat): <text> `` for one with a last day.
fn memo_line<Tz: chrono::TimeZone>(memo: &MemoBrief, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    let mut facts: Vec<String> = Vec::new();
    if let Ok(at) = chrono::DateTime::parse_from_rfc3339(&memo.updated_at) {
        facts.push(at.with_timezone(tz).format("%Y-%m-%d").to_string());
    }
    if let Some(until) = memo.until.as_deref() {
        match chrono::NaiveDate::parse_from_str(until, "%Y-%m-%d") {
            Ok(day) => facts.push(format!("until {}", day.format("%Y-%m-%d (%a)"))),
            Err(_) => facts.push(format!("until {until}")),
        }
    }
    let text = memo.text.split_whitespace().collect::<Vec<_>>().join(" ");
    if facts.is_empty() {
        format!("`{}`: {text}", memo.id)
    } else {
        format!("`{}` {}: {text}", memo.id, facts.join(", "))
    }
}

/// `text` on one line, whitespace collapsed, cut at `max` characters
/// with an ellipsis.
fn in_hand_cut(text: &str, max: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= max {
        return line;
    }
    let kept: String = line.chars().take(max).collect();
    format!("{kept}…")
}

fn platform_label() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

/// Stable supervisor identity for a managed IM channel. Passed as
/// `--supervisor` on every CLI write (mandated by the entry-layer prompt)
/// and used by the completion reporter to recognize delegated sessions.
pub(crate) fn im_supervisor_id(platform: &str) -> String {
    format!("galley-im/{platform}")
}

/// Placeholder the runner substitutes with the real per-channel
/// supervisor id. See [`im_supervisor_prompt_template`].
pub(crate) const SUPERVISOR_ID_PLACEHOLDER: &str = "__GALLEY_SUPERVISOR_ID__";

/// Entry-layer prompt with the supervisor id left unresolved.
///
/// Multi-context platforms (Discord: one supervisor context per
/// channel) cannot use a prompt rendered once at spawn time — every
/// channel agent needs its own `galley-im/discord/ch:<id>`, and the
/// process-wide env var carries only one. Core hands the runner this
/// template instead (`GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE`, injected
/// only for such platforms) and the runner replaces
/// [`SUPERVISOR_ID_PLACEHOLDER`] when it creates each channel's agent,
/// rather than mutating `os.environ` concurrently. Same text as
/// [`im_supervisor_prompt`] otherwise — one prompt body, two binding
/// times.
pub(crate) fn im_supervisor_prompt_template(sop_path: &str, platform: &str) -> String {
    im_supervisor_prompt(sop_path, platform, SUPERVISOR_ID_PLACEHOLDER)
}

pub(crate) fn im_supervisor_prompt(sop_path: &str, platform: &str, supervisor_id: &str) -> String {
    let platform_label = match platform {
        "wechat" => "WeChat",
        "feishu" => "Feishu",
        "telegram" => "Telegram",
        "discord" => "Discord",
        _ => "the current IM channel",
    };
    format!(
        r#"## Galley IM Entry Layer

The user is talking to you through {platform_label}, usually on a phone. You
are their Galley here: do what they ask yourself, with your tools. You share
long-term memory with the desktop app, not its conversations: never act as if
you knew what they said there. Reminders, to-dos and scheduled tasks are not
set from here. To the user you are their assistant (助理); keep agents,
supervisors and other inner workings out of replies.

Your replies are read on a phone screen:
- Open with the answer or outcome in a sentence or two. Add only the details
  the user needs next, and do not repeat the answer as a closing summary.
- No tables: they wrap or break on a phone. Put one item per line, such as
  `内存：20 GB（63%）`. No headings; use bold sparingly.
- Keep paragraphs and lists short, and code blocks to a few lines.

Hand a task to a desktop Galley session only when the user asks for one, or
when it would keep this chat busy for a long time. Before your first Galley
CLI write in this conversation, read the Galley Supervisor SOP at {sop_path}:
it covers waiting on sessions, answering their questions, and reports. To see
what is running, use plain `sessions list`; add `--all` or `--runtime all`
only when the user asks about archived or older sessions.

Your Galley supervisor identity is `{supervisor_id}`. On every CLI write
command (session new / session send / project create) pass
exactly `--supervisor={supervisor_id}` plus a short `--reason=<why>`. Galley
uses this identity to route a finished session's report request back to this
chat; follow that request when it arrives."#
    )
}

/// Prompt-generation fingerprint for diagnostics. Hashes only the static
/// rules: the state block is data, not behavior, so app-version bumps must
/// not read as new prompt generations.
pub(crate) fn prompt_hash() -> String {
    let mut context = Context::new(&SHA256);
    context.update(workbench_static_prompt().trim().as_bytes());
    short_hex(context.finish().as_ref(), 8)
}

fn short_hex(bytes: &[u8], chars: usize) -> String {
    let mut out = String::with_capacity(chars);
    for byte in bytes {
        if out.len() >= chars {
            break;
        }
        let _ = write!(&mut out, "{byte:02x}");
    }
    out.truncate(chars);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_runner::segment::CarriedPromptState;

    #[test]
    fn prompt_hash_is_short_stable_hex() {
        let hash = prompt_hash();
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn composed_prompt_appends_state_block_after_static_rules() {
        let prompt = compose_runtime_prompt("0.2.9-test");
        assert!(prompt.starts_with(RUNTIME_PROMPT_STATIC));
        assert!(prompt.contains("## Galley State"));
        assert!(prompt.contains("Galley version: 0.2.9-test"));
        assert!(prompt.contains(&format!("Platform: {}", platform_label())));
    }

    #[test]
    fn runtime_rules_steer_schedules_away_from_ga_sche_tasks() {
        // galley#31: GA's reflect scheduler never runs in Galley, yet the
        // seeded scheduled_task_sop (copied missing-only, so a seed fix
        // never reaches existing users) teaches the agent to write
        // sche_tasks/*.json. Both the workbench and the IM surfaces carry
        // the correction.
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(prompt.contains("never write `sche_tasks`"));
            // Since tickets 36–37 the assistant sets them, from the
            // main chat; its to-do opens from every conversation's top
            // bar (main chat PRD rulings 84, 86, 93, 95).
            assert!(prompt.contains("\"待办\" / \"To-do\""));
            assert!(prompt.contains("- Every conversation's top bar: the to-do (\"待办\""));
            assert!(prompt.contains("subtasks), opening beside it."));
            assert!(!prompt.contains("The Galley conversation's top bar"));
            // Single-line fragments only (CRLF on Windows).
            assert!(prompt.contains("ask the user to tell it in the Galley conversation atop the"));
            assert!(
                prompt.contains("sidebar (a top bar's to-do only lists them; its ＋ goes there)")
            );
        }
    }

    /// Self-description incidents: 2026-06 sessions listed features Galley
    /// does not have (its own scheduler, image generation) and invented an
    /// architecture; 2026-09-16 (`s-mu3rzev1`) recited the author clause's
    /// wording verbatim. The feature map, the configuration boundary, and
    /// an author clause phrased as instructions reach both surfaces.
    #[test]
    fn self_description_rules_reach_every_surface() {
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(prompt.contains("## About Galley"));
            assert!(prompt.contains("Settings: General"));
            assert!(prompt.contains("https://github.com/wangjc683/galley/releases"));
            assert!(prompt.contains("## What Only The User Changes In Galley"));
            assert!(prompt.contains("never say it is done"));
            assert!(prompt.contains("answer in your own words"));
            assert!(!prompt.contains("the mystery is part of the answer"));
        }
    }

    /// Every managed channel is named wherever the prompt lists IM
    /// platforms; the history clause listed only WeChat / Feishu after
    /// Telegram and Discord shipped.
    #[test]
    fn runtime_rules_name_every_managed_channel() {
        let section = |heading: &str| {
            let start = RUNTIME_PROMPT_STATIC
                .find(heading)
                .unwrap_or_else(|| panic!("missing section {heading}"));
            let rest = &RUNTIME_PROMPT_STATIC[start + heading.len()..];
            &rest[..rest.find("\n## ").unwrap_or(rest.len())]
        };
        for heading in ["## About Galley", "## Past Galley Conversations"] {
            let body = section(heading);
            for channel in ["WeChat", "Feishu", "Telegram", "Discord"] {
                assert!(body.contains(channel), "{heading} should name {channel}");
            }
        }
    }

    /// Only the commands for the platform this Core is built for reach the
    /// prompt (2026-10-06 budget pass).
    #[test]
    fn history_lookup_carries_only_this_platforms_commands() {
        assert!(RUNTIME_PROMPT_STATIC.contains("sessions search \"<keywords>\""));
        let (own, other) = if cfg!(windows) {
            ("$env:APPDATA", "XDG_CONFIG_HOME")
        } else {
            ("XDG_CONFIG_HOME", "$env:APPDATA")
        };
        assert!(RUNTIME_PROMPT_STATIC.contains(own));
        assert!(!RUNTIME_PROMPT_STATIC.contains(other));
    }

    /// Byte cap on Galley's static prompt text (shared rules + the
    /// workbench suggestion section, exactly what `prompt_hash` covers).
    /// Set with no headroom at the 2026-10-06 budget pass, on the larger
    /// platform variant (Windows), then raised by exactly 167 bytes on
    /// 2026-10-07 for the Chinese Settings labels in the feature map, and
    /// lowered by 80 on 2026-10-13 when Goal left the feature map, then
    /// raised by 51 on 2026-10-17: 7 for the reminders sentence and the
    /// to-do in the feature map (main chat PRD ruling 90, measured then on
    /// macOS only, so Windows sat 7 over until this diff), 44 when the
    /// to-do moved to the Galley conversation's top bar and took its own
    /// line in the map (ruling 93). Ruling 95 (every conversation's top
    /// bar; to-dos in the redirect sentence) changed it by 0 bytes. Raised
    /// by 43 on 2026-10-22 (JC ruling, v0.7.0 pre-flight item 40): the
    /// redirect sentence says the top bar's to-do only lists them and its
    /// ＋ goes to the Galley conversation (6851 bytes on POSIX). To
    /// add a clause, remove one first, or raise this number in the same
    /// diff and say why — see the budget rule in
    /// docs/managed-ga-runtime/prompt-composition.md. Bytes, not tokens:
    /// there is no tokenizer in CI. `\r` is not counted: a Windows
    /// checkout (`core.autocrlf`) puts CRLF into the raw string literals.
    const STATIC_PROMPT_BUDGET_BYTES: usize = 6869;

    #[test]
    fn static_prompt_stays_within_budget() {
        let len = workbench_static_prompt()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= STATIC_PROMPT_BUDGET_BYTES,
            "static prompt is {len} bytes, budget {STATIC_PROMPT_BUDGET_BYTES}: \
             remove a clause first, or raise the budget with a reason"
        );
    }

    /// The manual's directory as Core passes it: absolute, with a space
    /// in it (`Application Support` on macOS).
    const MANUAL_DIR: &str =
        "/Users/u/Library/Application Support/app.galley/managed-ga-state/assistant/reference/manual";

    fn main_chat_state() -> MainChatPromptState {
        MainChatPromptState {
            session_id: "s-mgn4k2x1-7q3z9w0e".into(),
            segment_start_turn: 42,
            segment_start_date: "2026-10-12".into(),
            carried: None,
        }
    }

    /// Ticket 03b: the main chat's state block says which conversation
    /// this is and where the model's context of it begins, and sends the
    /// model to the CLI for anything earlier. The section is appended to
    /// the state block, and besides it the main chat's prompt differs from
    /// the workbench's only in its configuration paragraph (ticket 36) and
    /// its opening line, the standing (ticket 145): every other workbench
    /// session gets the prompt it always had, and IM never carries it.
    #[test]
    fn main_chat_section_names_the_conversation_and_its_segment() {
        let state = main_chat_state();
        let ordinary = compose_runtime_prompt("t");
        let main = compose_main_chat_runtime_prompt("t", &state, None, None, MANUAL_DIR);
        assert_eq!(
            main,
            format!(
                "{}\n\n{}\n\n{}",
                ordinary
                    .replacen(
                        USER_ONLY_CONFIGURATION,
                        MAIN_CHAT_USER_ONLY_CONFIGURATION,
                        1
                    )
                    .replacen(GALLEY_OPENING, MAIN_CHAT_STANDING, 1),
                main_chat_section(&state),
                main_chat_entry_layer(MANUAL_DIR)
            ),
            "the section and the entry layer are appended after the state block, \
             nothing else moves"
        );
        assert!(main.contains("## Next-Step Suggestion"));
        assert!(main.find("## Galley State") < main.find("## Main Chat"));
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("This conversation is the user's main chat"));
        assert!(main.contains("session `s-mgn4k2x1-7q3z9w0e`"));
        assert!(main.contains("holds it from turnIndex 42 on, a segment that began 2026-10-12."));
        assert!(main.contains("parts are not in your context"));
        assert!(main.contains("`session show <id> --around=<messageId>`"));

        let im = compose_im_runtime_prompt("t");
        // IM's block ends where the shared state block ends.
        assert!(im.ends_with("otherwise ask the user to check the relevant Settings page."));
        for prompt in [ordinary, im] {
            assert!(!prompt.contains("## Main Chat"));
            assert!(!prompt.contains("main chat"));
        }

        // Data, not behavior: the prompt generation does not change.
        let hash = prompt_hash();
        let _ = compose_main_chat_runtime_prompt("t", &state, None, None, MANUAL_DIR);
        assert_eq!(prompt_hash(), hash);
    }

    /// Ticket 11: a segment that opens with turns carried over from
    /// before it says how many and when they were said, and "earlier
    /// parts" becomes "anything older". Without carried turns the
    /// section reads exactly as 03b wrote it. Ticket 79: more than one
    /// turn names when the first and the last were said; one turn reads
    /// as ticket 11 wrote it.
    #[test]
    fn main_chat_section_says_what_the_segment_carries_over() {
        let plain = main_chat_section(&main_chat_state());
        assert!(!plain.contains("from before it"));
        assert!(plain.contains("parts are not in your context"));

        let mut state = main_chat_state();
        state.carried = Some(CarriedPromptState {
            turns: 3,
            first_said_at: "2026-10-05 21:26".into(),
            last_said_at: "2026-10-12 09:41".into(),
        });
        let carried = main_chat_section(&state);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(carried.contains("session `s-mgn4k2x1-7q3z9w0e`"));
        assert!(carried
            .contains("holds it from turnIndex 42 on, a segment that began 2026-10-12, and opens"));
        assert!(carried.contains(
            "with 3 exchanges from before it, said between 2026-10-05 21:26 and \
             2026-10-12 09:41: time has passed"
        ));
        assert!(!carried.contains("the last said"));
        assert!(carried.contains("Anything older is not in your context:"));
        assert!(!carried.contains("Earlier"));
        assert!(carried.contains("`session show <id> --around=<messageId>`"));

        // One turn: ticket 11's sentence, word for word; its first time
        // is its last.
        state.carried = Some(CarriedPromptState {
            turns: 1,
            first_said_at: "2026-10-12 09:41".into(),
            last_said_at: "2026-10-12 09:41".into(),
        });
        let one = main_chat_section(&state);
        assert!(one.contains(
            "with 1 exchange from before it, the last said 2026-10-12 09:41: time has passed"
        ));
        assert!(!one.contains("between"));
        // Line by line (`lines` drops a Windows checkout's `\r`).
        let lines: Vec<&str> = one.lines().collect();
        assert_eq!(
            lines,
            [
                "## Main Chat",
                "",
                "This conversation is the user's main chat, session `s-mgn4k2x1-7q3z9w0e`. Your context",
                "holds it from turnIndex 42 on, a segment that began 2026-10-12, and opens",
                "with 1 exchange from before it, the last said 2026-10-12 09:41: time has passed",
                "since. Anything older is not in your context: when the user refers to it,",
                "look it up with the Galley CLI (search, then",
                "`session show <id> --around=<messageId>`).",
            ]
        );
    }

    /// Byte cap on the main chat section, rendered with the longest
    /// values it takes in practice: a Core-minted session id (19
    /// characters until 2059; `mint_session_id`), a six-digit turn index,
    /// a date, and — since ticket 11 — the longer variant that says what
    /// the segment carries over, with the most turns it carries
    /// (`CARRY_TURNS`, two digits since ticket 79) and minute-precise
    /// local times. No headroom, `\r` not counted. It rides every
    /// request of the main chat, and the static budget does not cover
    /// it. Raised from 327 (03b; the variant without carried turns is
    /// unchanged) to 421 by ticket 11: +94 bytes for "and opens with N
    /// exchanges from before it, the last said <time>: time has passed
    /// since", with "Earlier parts … them" reworded to "Anything older …
    /// it". The count tells the model where the carried turns end; the
    /// time keeps it from reading a carried "I'm heading out" as said
    /// just now. Raised 421 → 442 by ticket 79 (PRD ruling 127): +20
    /// bytes for "said between <time> and <time>" in place of "the last
    /// said <time>" when more than one turn is carried, +1 for the
    /// second digit of ten turns; ten can span a week, and the last time
    /// alone would not tell the day before yesterday from today. One
    /// carried turn reads as before.
    const MAIN_CHAT_SECTION_BUDGET_BYTES: usize = 442;

    /// Ticket 03d: the entry layer follows the Main Chat section in the
    /// main chat and nowhere else.
    #[test]
    fn main_chat_entry_layer_is_main_chat_only() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        let section = main.find("## Main Chat").expect("the Main Chat section");
        let layer = main
            .find("## Galley Main Chat Entry Layer")
            .expect("the entry layer");
        assert!(section < layer);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("relationship, not a queue of tasks"));
        assert!(main.contains("Reply at the weight of what they said:"));
        assert!(main.contains("Open with the answer or outcome"));
        assert!(main.contains("without recapping it"));
        assert!(main.contains(
            "projects and models; `wake.md` and `subtasks.md` when Galley wakes you. Run"
        ));
        assert!(
            main.ends_with("`llm set` carries `--supervisor=galley-assistant --reason=\"<why>\"`.")
        );
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("Main Chat Entry Layer"));
        }
    }

    /// Ticket 06a: the entry layer ends with the dispatch clause — the
    /// tag Core reads ([`crate::subtask`]), what the instructions must
    /// carry, no waiting, and Galley's subtask over GA's file-based
    /// subagent. Main chat only, like the rest of the layer. Ticket 30:
    /// the instructions name the evidence to hand back, and Galley wakes
    /// the model instead of it looking the subtask up when asked. Ticket
    /// 126 (ruling 175): the tag carries a short title in the user's
    /// language. Ticket 127 (ruling 174): one tag per part in the same
    /// reply; parts that share a browser tab or files are not split; no
    /// cap on the count. Ticket 139 (ruling 186, in place of the lines of
    /// tickets 115 and 134): a fact in the world is looked up and sourced
    /// (ruling 185's half that stays), an idea, how to do something, a
    /// view or what this conversation answers is answered directly; a
    /// change goes by `authority.md`; the instructions need not copy this
    /// conversation, which the subtask carries (ticket 138); it does not
    /// call this chat the main chat (ruling 173). Ticket 145 (ruling 194,
    /// in place of ruling 186's neutral sentence): what each path costs,
    /// the user's memos first, the user's way when they say otherwise,
    /// noted as a memo; its second round (ruling 195) puts ruling 193's
    /// default back after the costs (what the user will decide by and
    /// that takes looking into goes out in depth, split and merged; a
    /// question, a remark or a single fact stays) with the user's word on
    /// here or handed off, and takes out the line on how it will go about
    /// it; its third (ruling 196) puts that line back for work done here
    /// and ruling 174's several errands, one tag each, at once.
    #[test]
    fn main_chat_entry_layer_leaves_the_hand_off_to_judgment() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        // Ruling 194: how to go about it is the model's to weigh, given
        // what each path costs. Here: quicker and lighter, and the user
        // reaches it at its next step (ticket 136), `tell_user` answering
        // in a line (ticket 137). A subtask: fresh with this
        // conversation's last turns (ticket 138), one thing in depth, side
        // by side, minutes, one wake for the batch (ticket 144).
        for line in [
            "How to go about a thing is yours to weigh. Doing it yourself is quicker",
            "and lighter, and the user can talk to you while you work: what they say",
            "reaches you at your next step, and `tell_user` answers them in a line",
            "without stopping. A subtask starts fresh with this conversation's last",
            "turns as background, looks into one thing in depth and runs alongside any",
            "others; each takes a few minutes, and Galley wakes you once they are all",
            // Ruling 195: ruling 193's default back beside the costs. What
            // the user will decide by and that takes looking into goes out
            // in depth, split and merged; a question, a remark or a single
            // fact is answered here.
            "back, for you to check and put together. Something the user will use to",
            "decide, pass on or keep, and that takes looking into (a comparison, a",
            "plan, a report, a survey), goes to subtasks to be done in depth: one tag",
            "per part when it splits (a product, a place, a source each), all at once,",
            "and you merge them when they are back. A question, a remark or a single",
            // The user's memos first (ruling 194 point 2, 甲); the user's word
            // goes (back from ruling 193); their way, kept as a memo when it
            // is how they want such things done.
            // Ruling 196: a line on how it will go about it, for work done
            // here only (a hand-off's reply says so anyway).
            "fact you answer yourself. When you do it yourself and it will take more",
            "than a moment, say in a line how you will go about it before you start.",
            "Their memos on how they like things done come first. When the user says",
            "to do it here or to hand it off, do that; when they say otherwise, do it",
            "their way, and note it as a memo when it is how they want such things",
        ] {
            assert!(main.contains(line), "entry layer lost: {line}");
        }
        // Ruling 185's half that stays: a fact is looked up, by it or a
        // subtask, and sourced; the rest is answered directly, this
        // conversation taken as it stands (the fourth round's eval).
        assert!(
            main.contains("A fact in the world (a person, an event, a game, the news, a figure, a")
        );
        assert!(main.contains("price, how someone is doing lately): look it up before you answer,"));
        assert!(main
            .contains("yourself or by a subtask, and give your sources. An idea, a reason, how"));
        assert!(
            main.contains("to do something, your view, or what this conversation already answers")
        );
        assert!(
            main.contains("(what a subtask brought back included): answer it directly, without")
        );
        assert!(main.contains("looking it up again."));
        // Ruling 186 point 3: a change goes by the three levels, no new rule.
        assert!(
            main.contains("To change things on the user's computer or accounts, go by the three")
        );
        assert!(main.contains("levels of authority in `authority.md`."));
        assert!(
            crate::assistant_manual::part("authority.md").contains("## Three levels of authority")
        );
        assert!(main.contains("To hand something off, end your reply with"));
        // Ticket 126: the tag carries a title for the user's list.
        assert!(main.contains(
            "<subtask title=\"a few words\">what to do</subtask>. The title is what the"
        ));
        assert!(main.contains(
            "user sees in their list: a few words, in their language, naming the errand."
        ));
        // Ticket 127: one tag per part, in the same reply, at the same
        // time; no cap on the count. The same browser tab or the same
        // files keep parts in one tag (ticket 145: the condition before
        // it, several errands or a piece of work split, is gone).
        assert!(main
            .contains("Write one tag per part, in the same reply, and they run at the same time;"));
        // Ruling 196 (ruling 174's, back): several errands that do not
        // depend on each other go out at once, one tag each.
        assert!(main
            .contains("when the user hands you several errands that do not depend on each other,"));
        assert!(main
            .contains("send them all out at once, one tag each. Keep in one tag the parts that"));
        assert!(main.contains("need the same browser tab or the same files."));
        // Ticket 138: the subtask carries this conversation's last turns,
        // so the instructions carry the goal, what was found so far (not in
        // the background) and what to hand back with its evidence.
        assert!(main
            .contains("Galley starts each after this reply, with this conversation's last turns"));
        assert!(main
            .contains("as background, so write the goal, what you have found so far, and what to"));
        assert!(main.contains(
            "hand back, with the evidence for it (a confirmation number, a file path, a"
        ));
        assert!(main.contains("link, a screenshot path)."));
        // Ruling 173: no inner name to the user; Galley wakes it, so no
        // waiting or watching.
        assert!(main
            .contains("Do not call this chat the main chat. Galley wakes you when they finish,"));
        assert!(main.contains("ask something or fail, so do not wait on them or watch them."));
        assert!(main
            .contains("Use this, not the file-based subagent in your memory (subagent.md), which"));
        assert!(main.contains("the user cannot see."));
        // Ticket 145: what went. Ruling 186's neutral sentence; "the user
        // can talk to you" with its hand-off (folded into the costs); "a
        // piece of work split into parts done apart"; "on its way"; the
        // write-up of this conversation (a subtask carries it now, ticket
        // 138); the starting point the first round had in place of ruling
        // 193's default ("worth a subtask's wait for depth"). The line on
        // how it will go about it went in its second round and came back,
        // for work done here, in its third (ruling 196).
        for gone in [
            "You can do the work yourself",
            "A write-up of what this conversation already holds",
            "The user can talk to you at any time",
            "hand it off and answer them first",
            "one piece of work splits into parts done apart",
            "Tell the user in a sentence that it is on its way",
            "on its way",
            "As a starting point",
            "wait for depth",
        ] {
            assert!(!main.contains(gone), "entry layer still has: {gone}");
        }
        assert!(!main.contains("look it up when they ask"));
        // The lines it replaced: how long the work would keep the chat busy
        // (ticket 06a), whether the user is waiting (ticket 115), a step or
        // two (ticket 134's first round) and its "turns out bigger", the web
        // and changes sent out (its third round), the fact sent out and what
        // not to say (its fourth); and the instructions written as if the
        // subtask could not see this conversation (ticket 138).
        assert!(!main.contains("keep this chat busy"));
        assert!(!main.contains("Do quick work yourself"));
        assert!(!main.contains("even when it takes a few minutes"));
        assert!(!main.contains("do not split a question"));
        assert!(!main.contains("takes a step or two"));
        assert!(!main.contains("turns out"));
        assert!(!main.contains("go online in this chat"));
        assert!(!main.contains("curl"));
        assert!(!main.contains("Everything else you do yourself"));
        assert!(!main.contains("answering from what you know"));
        assert!(!main.contains("even one you think you"));
        assert!(!main.contains("cannot see this conversation"));
        assert!(!main.contains("cannot see this one"));
        assert!(!main.contains("write everything it needs"));
        assert!(!main.contains("cite a rule"));
        assert!(!main.contains("what has to come back as one thing"));
        let layer = main.find("Main Chat Entry Layer").unwrap();
        assert!(!main[layer..].contains("websites"));
        // Ticket 127: no cap on how many subtasks go out at once.
        assert!(!main[layer..].contains("at most"));
        // The order: how to weigh it, then the floor (facts, authority),
        // then how to write the tag and the instructions.
        let clause = main
            .find("How to go about a thing is yours to weigh.")
            .unwrap();
        let fact = main.find("A fact in the world").unwrap();
        let authority = main.find("levels of authority in `authority.md`.").unwrap();
        let tag = main.find("To hand something off").unwrap();
        let note = main.find("Note what the user has to do").unwrap();
        assert!(layer < clause && clause < fact && fact < authority);
        assert!(authority < tag && tag < note);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("<subtask"));
            assert!(!prompt.contains("tell_user"));
            // Ticket 145: the costs, ruling 193's default and the memos
            // are the main chat's only.
            assert!(!prompt.contains("How to go about a thing is yours to weigh"));
            assert!(!prompt.contains("A subtask starts fresh"));
            assert!(!prompt.contains("Something the user will use to decide"));
            assert!(!prompt.contains("to be done in depth"));
            assert!(!prompt.contains("how they like things done"));
            assert!(!prompt.contains("say in a line how you will go about it"));
            assert!(!prompt.contains("several errands that do not depend on each other"));
            assert!(!prompt.contains("Write one tag per part"));
            assert!(!prompt.contains("Do not call this chat the main chat"));
        }
    }

    /// Ticket 145 (main chat PRD ruling 194): in the main chat, and only
    /// there, the Galley layer opens with the standing — the user's
    /// personal assistant with a team behind it, GA's role above being
    /// how its engine works with its own hands, and it deciding, as a
    /// good chief of staff would, what it does itself and what it hands to
    /// the team. Workbench sessions, subtasks (the workbench prompt), IM
    /// and the shared rules keep the bare opening line.
    #[test]
    fn only_the_main_chat_opens_with_its_standing() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        let standing = [
            "You are running inside Galley. In this conversation you are the user's",
            "personal assistant, with a team behind you. The role above is how your",
            "engine works with its own hands, and you still use them; here you also",
            "decide, as a good chief of staff would for this user, what you do",
            "yourself and what you hand to the team, and you keep them told.",
        ];
        for line in standing {
            assert!(main.contains(line), "main chat lost: {line}");
        }
        // It opens the Galley layer, where the bare line was.
        assert!(main.starts_with("## Galley Runtime Layer"));
        let opening = main.find(standing[0]).unwrap();
        let about = main.find("## About Galley").unwrap();
        assert!(opening < about);
        // The bare line is gone: the only opening line is the standing's.
        assert_eq!(main.matches(GALLEY_OPENING).count(), 1);
        // The shared rules carry the opening line once, the suggestion
        // section not at all, so the swap hits that line.
        assert_eq!(RUNTIME_PROMPT_STATIC.matches(GALLEY_OPENING).count(), 1);
        assert!(!WORKBENCH_SUGGESTION_PROMPT.contains(GALLEY_OPENING));
        for prompt in [
            RUNTIME_PROMPT_STATIC.to_string(),
            workbench_static_prompt(),
            compose_runtime_prompt("t"),
            compose_im_runtime_prompt("t"),
            compose_subtask_runtime_prompt("t", "## Background\n\nthe last turns"),
        ] {
            assert!(prompt.contains(GALLEY_OPENING));
            for line in &standing[1..] {
                assert!(!prompt.contains(line), "not the main chat, yet has: {line}");
            }
            assert!(!prompt.contains("with a team behind you"));
            assert!(!prompt.contains("chief of staff"));
        }
    }

    /// Ticket 30: before a CLI write the model reads the assistant
    /// manual, where Core wrote it; every other session and IM never hear
    /// of it. Ticket 59: the manual is a directory of parts. The layer
    /// names the directory once and every part on the table once, by its
    /// bare file name with when to read it, and asks for them before each
    /// write, not only the first; it names no file that is not a part.
    /// Ticket 139 (ticket 141's option 乙): with the parts, in the same
    /// step, the reads they ask for before a write, each a rule a part
    /// states.
    #[test]
    fn main_chat_entry_layer_sends_the_model_to_the_manual() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains(&format!(
            "Your manual is in `{MANUAL_DIR}`, one file per part. Before a Galley CLI"
        )));
        assert!(main.contains(
            "write (a session, project, model, schedule, to-do or memo command), read the"
        ));
        assert!(
            main.contains("parts it needs, together: `todos.md` and `unasked.md` to note a to-do;")
        );
        // Ticket 96: the memos' part, with when to read it.
        assert!(main.contains(
            "`todos-change.md` to change, tick off or list to-dos; `memo.md` to note or"
        ));
        assert!(main.contains("change what you know about the user; `reminders.md` for"));
        assert!(main
            .contains("your own reminders, changing them, and when the user asks to be reminded;"));
        // Ticket 139: the reads the parts ask for, in the same step as the
        // parts (ticket 141: a runner that had not read them yet read a
        // part first and ran the read a step later).
        assert!(main.contains(
            "projects and models; `wake.md` and `subtasks.md` when Galley wakes you. Run"
        ));
        assert!(main
            .contains("with them, in the same step, what the parts will ask for: `todo list` or"));
        assert!(main.contains(
            "`schedule list` before adding one, `todo show <todo-id>` before changing a"
        ));
        assert!(main
            .contains("to-do, `todo list` to say what is left, and `date` for a time relative to"));
        assert!(main.contains("now. Every write but `llm set` carries"));
        let part = crate::assistant_manual::part;
        assert!(part("todos.md").contains("run `todo list` before"));
        assert!(part("reminders.md").contains("Before you create one, run `schedule list`"));
        assert!(part("todos-change.md").contains("(`todo show <todo-id>`)"));
        assert!(part("todos-change.md").contains("run `todo list` first"));
        assert!(part("times.md").contains("read the clock first (`date`)"));
        // The identity every write carries is the one rule all the parts
        // with a write share (only `cli.md` states it): read for a tick or
        // a cancel alone, `todos-change.md` and `reminders.md` would leave
        // it out (ticket 59's eval). It is `cli.md`'s rule, word for word.
        assert!(
            main.contains("`llm set` carries `--supervisor=galley-assistant --reason=\"<why>\"`.")
        );
        assert!(crate::assistant_manual::part("cli.md")
            .contains("--supervisor=galley-assistant --reason=\"<why>\""));
        assert!(crate::assistant_manual::part("cli.md").contains("The one exception is `llm set`"));
        assert!(!main.contains("first Galley CLI write"));
        assert!(!main.contains("read your manual at"));
        // The directory once; the parts by their bare names.
        assert_eq!(main.matches(MANUAL_DIR).count(), 1);
        assert!(!main.contains(&format!("{MANUAL_DIR}/")));
        let list = &main[main.find("Your manual is in").unwrap()..];
        for (name, _) in crate::assistant_manual::PARTS {
            assert_eq!(list.matches(&format!("`{name}`")).count(), 1, "{name}");
        }
        let layer = &main[main.find("## Galley Main Chat Entry Layer").unwrap()..];
        for code in layer.split('`').skip(1).step_by(2) {
            if code.ends_with(".md") {
                assert!(
                    crate::assistant_manual::PARTS
                        .iter()
                        .any(|(name, _)| *name == code),
                    "the entry layer names {code}, not a part"
                );
            }
        }
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("your manual"));
            assert!(!prompt.contains("Your manual"));
            assert!(!prompt.contains("assistant/reference"));
            assert!(!prompt.contains("todos.md"));
        }
        // The entry layer is not in what `prompt_hash` fingerprints: a
        // new layer is not a new prompt generation for anyone.
        assert!(!workbench_static_prompt().contains("Main Chat Entry Layer"));
        assert!(!workbench_static_prompt().contains("Your manual"));
    }

    /// Byte cap on the main chat entry layer: no headroom, `\r` not
    /// counted, measured with an empty manual path (the user's state
    /// root does not count, as for `IM_PROMPT_BUDGET_BYTES`). It rides
    /// every request of the main chat, outside the static budget. Set at
    /// 03d to the draft compared on the main chat's model (827); grow it
    /// only with a reason, as for the static budget. Raised 827 → 1446
    /// by ticket 06a: +619 bytes for the dispatch clause — the compared
    /// `T` text (522), the sentence away from GA's file-based subagent
    /// (94), and the breaks before them (3). Without the clause the main
    /// chat has no way to hand off long work and stays busy for the
    /// whole of it (PRD rulings 25, 52). Raised 1446 → 1699 by ticket 30
    /// (assistant PRD rulings 2, 8): +253 bytes for the evidence to hand
    /// back (90), Galley waking the model in place of "its card shows the
    /// progress, and you can look it up when they ask" (+58), and the
    /// paragraph sending it to the assistant manual (105, the path not
    /// counted), which carries the rest. Raised 1699 → 1920 by ticket 36
    /// (assistant PRD ruling 9): +221 bytes, the paragraph asking for a
    /// reminder unasked when the user mentions a date or time or the
    /// model promises a follow-up, naming the manual's new section (217,
    /// with its break), and the write list as command families, `schedule`
    /// among them (+4). Without the paragraph the model never opens the
    /// manual on a remark like 「周三下午要交报告」: no CLI write is in sight.
    /// Raised 1920 → 2026 by ticket 41 (main chat PRD ruling 91): +106
    /// bytes, the paragraph rewritten for the user's to-dos (+99: what the
    /// user has to do is noted as a to-do with a reminder when it has a
    /// date, ticked off when done, and `todo list` read before saying what
    /// is left; the follow-up reminder kept; the section's new name) and
    /// `to-do` in the write list (+7). Each of the three starts from a
    /// remark with no CLI write in sight (「记一下要买营养土」,
    /// 「营养土买好了」, 「我还有什么没办」), so the manual alone would never be
    /// opened for them. Raised 2026 → 2463 by ticket 59 (main chat PRD
    /// ruling 111): +437 bytes. The last paragraph names the manual's
    /// directory and each of its eight parts with when to read them,
    /// together (+449, the directory not counted; "your first" write
    /// became a write, since a part read earlier is cut from the context
    /// by the next one), and the to-do sentence names `todos.md` in place
    /// of the section (−12). Of the +449, 118 came from the eval of the
    /// first wording: the identity every write carries (only `cli.md`
    /// says it, and a tick or a cancel read `todos-change.md` or
    /// `reminders.md` alone and left it out), changing its own reminders
    /// sent to `reminders.md` (「改到 9 点」 had gone to the to-dos'
    /// part and noted a new to-do), and "together" (a reminder the user
    /// asked for was read part by part, a round trip each). Worth it: a
    /// read of the manual drops from about 2k tokens (GA's `file_read`
    /// takes 200 lines at a time) to a few hundred, and it was read again
    /// for each write, while these lines ride every request almost always
    /// from the cache. Raised 2463 → 2568 by ticket 60 (main chat PRD
    /// ruling 112): +105 bytes, the to-do sentence widened to what comes
    /// up on a date and will be worth raising then, with two examples (a
    /// renovation due to finish, a lease ending). Without it a remark like
    /// 「装修师傅说 905 办公室 11 月 20 号能完工」 has no CLI write in
    /// sight (the sentence named only what the user has to do), so the
    /// model would not open `todos.md`, where the test of when to follow
    /// something up unasked is. Raised 2568 → 2675 by ticket 63 (main chat
    /// PRD ruling 115): +107 bytes, the sentence closing the to-do
    /// paragraph (106, with its space) that says 「记下了」 only after this
    /// turn wrote something down (a to-do, a reminder, the memory). In
    /// ticket 60's eval 「我们公司是 2019 年 11 月 20 号成立的」 got
    /// 「记下了」 once in two runs with no tool call at all: that turn read
    /// nothing, so the manual cannot carry it. Raised 2675 → 2767 by
    /// ticket 64 (main chat PRD ruling 116): +92 bytes. 「Do it unasked」
    /// became read `todos.md` before saying you will (+38: the part is
    /// named there instead of after `todo list`), and the floor gained
    /// "if you write nothing down, do not bring up noting it" (+54). In
    /// ticket 63's eval 「今晚 9 点和朋友吃火锅」 noted nothing both times,
    /// as `todos.md` says, but each first turn had said it would note it
    /// (in its text once, in `<summary>` once) before reading the part,
    /// and each reply took it back (「刚才说要加待办有点多此一举，就不加了」).
    /// The test of when is in the part; what to say before reading it
    /// cannot be, so it is here. Raised 2767 → 3140 by ticket 73
    /// (assistant PRD ruling 10, main chat PRD ruling 124): +373 bytes.
    /// The to-do sentence gained what the user is in the middle of and sets
    /// aside to come back to (+62): with no date in sight 「排查到一半，先吃饭吧」
    /// had nothing to send the model to `todos.md`. Its first wording, "and
    /// will come back to" (+54), noted a to-do in two carried conversations
    /// of the chat eval where the user was carrying on with the thing (「回来了」
    /// after 「晚点回来再说这个报价」; a question about the laptop just chosen),
    /// on gpt-6.1-sol and gpt-6-astra alike; "sets aside" names the pause.
    /// A paragraph after it (+294, with its break): when it notes
    /// something, a step ahead, done and
    /// then said, never offered (+152, naming `unasked.md`, whose rules
    /// these are: a turn that notes something reads `todos.md` and would
    /// not otherwise open the part), and the file handover,
    /// `[FILE:<absolute path>]` on a line of its own (+142): nothing had
    /// taught the main chat the marker, and its replies never carried
    /// one, so what it made by itself showed only as a sentence. The
    /// manual list names `unasked.md` with `todos.md` (+17). Raised
    /// 3140 → 3339 by ticket 96 (main chat PRD rulings 140–142): +199
    /// bytes. A sentence after the to-do one, "Note what you learn about
    /// the user that you will need later as a memo, an interest you notice
    /// in what they keep asking too (see `memo.md`)." (+140, with its
    /// break): 「我不吃香菜」 or 「我女儿今年上小学一年级」 has no CLI write in
    /// sight, so without it the model would not open the part where what
    /// to note and what not is. Its first wording (+87) stopped at "as a
    /// memo": in the memo eval's first round a fourth question about the
    /// same team, its answer in the context, got a reply and no tool call
    /// at all, so the interest is named here (+53, ruling 140 point 6).
    /// Raised 3339 → 3383 by ticket 98: +44 bytes. The interest named
    /// that way still got no memo on the model in either round, its
    /// attention on whether the earlier answer was right; the sentence now
    /// gives a count to see it by, "once they have asked about the same
    /// thing three times (a team, a stock), note it as an interest" in
    /// place of "an interest you notice in what they keep asking too". The floor's list says "a memo"
    /// in place of "your memory" (−5): information goes to the memos now
    /// (ruling 140). `memo` in the write list (+6) and `memo.md` in the
    /// manual list, with when to read it (+58). Raised 3383 → 3931 by
    /// ticket 115 (main chat PRD ruling 160): +548 bytes, the dispatch
    /// clause's test changed from how long the work would keep the chat
    /// busy to whether the user is waiting for it. A first sentence: what
    /// the user asks is answered here, even when it takes a few minutes,
    /// since they are waiting and Galley shows what the model is doing
    /// (+181). What goes is an errand, what comes back a thing or a change
    /// rather than an answer, with examples, past two or three steps, and
    /// anything the user asks to hand off, in place of "work that would
    /// keep this chat busy for a long time (many steps, several websites,
    /// a long batch of files)" (+117). The instructions carry what was
    /// found so far (+28). A question that turns into an errand partway
    /// hands the rest over (+100). "Do quick work yourself" became the
    /// errands kept here: this conversation's own material, a to-do, a
    /// reminder or a memo (+122). In two weeks of the main chat the model
    /// never handed off work on its own reading of the old test: it
    /// cannot tell how long work will take before it starts, so a
    /// ten-minute errand (sorting invoices) ran here while questions that
    /// read several websites were rightly answered here only by chance.
    /// Raised 3931 → 4049 by ticket 126 (main chat PRD ruling 175): +118
    /// bytes. The tag carries a title, ` title="a few words"` (+20), and
    /// a sentence says what it is for: what the user sees in their list,
    /// a few words in their language naming the errand (+98). Without it
    /// Core titled a subtask by its instructions' first line cut at 80
    /// characters, and the instructions are mostly one paragraph: every
    /// subtask on JC's machine was titled with 81 characters. Raised
    /// 4049 → 4344 by ticket 127 (main chat PRD ruling 174): +295 bytes.
    /// A sentence after the tag's: several errands that do not depend on
    /// each other, or one that splits into parts that do not, one tag per
    /// part in the same reply, running at the same time; parts that need
    /// the same browser tab or files kept together, a question not split
    /// (+293). "Galley starts it" became "starts each" (+2). Core always
    /// started every tag of a reply, but the layer spoke of one tag only,
    /// and a model that wanted work done side by side opened sessions with
    /// `session new` instead, which get no card and wake no one. Raised
    /// 4344 → 4729 by ticket 134 (main chat PRD ruling 183): +385 bytes.
    /// The opening answers here only what takes a step or two, named (a
    /// single fact with three examples, a quick conversion, a follow-up
    /// this conversation answers), and sends everything bigger to a
    /// subtask so the chat stays free, by kind with examples (a thing to
    /// hand back, a change on the user's computer or accounts, a question
    /// or story that needs several places looked up), in place of
    /// answering every question however long it takes and handing off
    /// errands past two or three steps (+203). The split sentence keeps in
    /// one tag what has to come back as one thing, with examples, in place
    /// of "do not split a question", and splits only parts whose results
    /// stand on their own (+102). The instructions carry what this
    /// conversation already settled that the request leans on (+66): a
    /// follow-up can go out now, and the subtask cannot see the
    /// conversation. "If a question turns into an errand" became anything
    /// taken for quick that turns out bigger (+14). Under ruling 160 a
    /// two-headphone comparison held the main chat for four minutes; JC
    /// would rather have it free (ruling 183 point 3). Of the opening,
    /// +54 came from the eval's first round: "a quick look on their
    /// computer (what is in a folder)" among what is answered here. Without
    /// it 「帮我看看下载文件夹里有哪些超过 1GB 的文件」, one look at a
    /// folder, went to a subtask in all three runs as "a list" to hand
    /// back: 4675 → 4729. Lowered 4729 → 4475 by ticket 134's third round
    /// (main chat PRD ruling 184): −254 bytes. The opening says what goes
    /// by what the work touches (the web, always, the weather included;
    /// changes on the user's computer or accounts; anything they ask to
    /// hand off) and what stays, this conversation's own material and the
    /// to-dos, reminders and memos folded into it, in place of what is
    /// answered here and what goes by kind (+6). The sentence keeping this
    /// conversation's material and the notes here is folded into the
    /// opening (−146), and "If something you took for quick turns out
    /// bigger" is gone (−114): whether work needs the web or changes
    /// something can be told before it starts. Raised 4475 → 4493 by the
    /// third round's eval (+18): ", even into a file" on writing up what the
    /// two discussed. Without it 「把我们今天聊的整理成一份 Markdown，放到
    /// 桌面」 went to a subtask once in three runs as a file written, and a
    /// subtask cannot see this conversation. Raised 4493 → 4524 (+31): the
    /// opening says going online any other way, curl and the like in
    /// `code_run`, is out too, as ticket 135's guard now says; the guard
    /// catches the browser tools only, so the words are what keep
    /// `code_run` off the web. Raised 4524 → 4912 by ticket 134's fourth
    /// round (main chat PRD ruling 185): +388 bytes. A question about a
    /// fact in the world goes to a subtask too, with seven examples, even
    /// one the model thinks it knows, its sources asked for and given with
    /// the answer (+214): under ruling 184 a story it took for known was
    /// told from memory, with no source. "Answering from what you know or
    /// from this conversation" became explaining an idea, a reason or how
    /// to do something, giving its view, and answering from this
    /// conversation with what a subtask brought back counted in it (+88).
    /// Telling the user it is on its way, it does not explain why it is
    /// not done here, cite a rule, or call this chat the main chat (+86):
    /// on the dev machine it told the user 「这个主聊的规则要求……」.
    /// Raised 4912 → 4983 by the fourth round's eval (+71): a fact this
    /// conversation already answers stays (", unless this conversation
    /// already answers it", +45), and answering from this conversation is
    /// done "without checking it again" (+26). Without them a follow-up
    /// whose answer was in the turn before (「那他大概什么时候能复出？」) went
    /// out to a subtask in all six runs, to check that turn.
    /// Lowered 4983 → 4805 by ticket 139 (main chat PRD ruling 186): −178
    /// bytes. The opening (1059) became a judgment and two guidelines
    /// (809, −250): itself, the web included, or subtasks, several at
    /// once; the user reaches it at its next step, and it hands off what
    /// is in hand and answers first, or tells them a line (332); a fact
    /// in the world looked up, by it or a subtask, and sourced, while an
    /// idea, how to do something, a view or what this conversation
    /// answers is answered directly (368); a change by `authority.md`'s
    /// three levels (107); two breaks. "You do not go online" with what
    /// goes and what stays, and the exception for writing up this
    /// conversation, are gone. The instructions sentence (361 → 247,
    /// −114) says the subtask carries this conversation's last turns, so
    /// the goal, what was found so far and what to hand back are enough,
    /// in place of "a separate conversation that cannot see this one, so
    /// write everything it needs" with the facts the user gave and what
    /// the conversation settled. "On its way" (136 → 91, −45) keeps only
    /// "without calling this chat the main chat": there is no rule left to
    /// cite. The manual paragraph names the reads to run in the same step
    /// as the parts (+231, ticket 141's option 乙): `todo list` or
    /// `schedule list` before adding one, `todo show` before changing a
    /// to-do, `todo list` to say what is left, `date` for a relative time;
    /// a runner that had not read the parts yet read a part and ran the
    /// read a step later, in all 14 such runs of the diagnosis.
    /// Raised 4805 → 5268 by ticket 143 (main chat PRD ruling 193): +463
    /// bytes. After "several at once" the opening judges by what the work
    /// is for (+518): something the user will use to decide, pass on or
    /// keep, that takes looking into, goes to subtasks in depth, one tag
    /// per part when it splits, all at once, merged when the last part is
    /// back (+304); a question, a remark or a single fact is answered here
    /// (+59); what the user says to do here or hand off is done (+61); a
    /// write-up of this conversation with nothing to look up stays (+94).
    /// Under ruling 186's neutral sentence ticket 139's eval handed off 6
    /// runs of 72; on the dev machine three subtasks, one phone each, came
    /// back with 9 sources where the main chat alone had 3. The parallel
    /// sentence splits parts done apart, standing on their own or merged
    /// when back, in place of parts whose results each stand on their own
    /// (+50), and keeps in one tag only the parts that need the same
    /// browser tab or files: "what has to come back as one thing (a
    /// comparison, one table, one report, the answer to one question)" is
    /// gone (−105).
    /// Lowered 5268 → 5008 by ticket 145 (main chat PRD ruling 194): −260
    /// bytes. The opening, ruling 186's sentence with ruling 193's by kind
    /// (605) and "The user can talk to you at any time …" (246), became one
    /// paragraph of what each path costs (865, +14): yours to weigh (43);
    /// here quicker and lighter, the user reaching it at its next step,
    /// `tell_user` in a line (189); a subtask fresh with the last turns, in
    /// depth, side by side, minutes, one wake for the batch (241); the
    /// starting point (142, of which "a subtask's" in place of "the" +8
    /// came from the ticket's eval) with the user's memos first (53); a
    /// line on how it will go about it (85); the user's way, noted as a
    /// memo (112). The parallel sentence keeps only one tag per part and
    /// the same tab or files (340 → 150, −190): the condition before it
    /// went. "On its way" and the wake (217 → 133, −84) became "Do not call
    /// this chat the main chat" and the wake for them all: a line on how it
    /// goes about it is already asked for above. Measured on macOS, no
    /// headroom.
    /// Raised 5008 → 5183 by ticket 145's second round (main chat PRD
    /// ruling 195): +175, all in the paragraph (865 → 1040). Ruling 193's
    /// default after the costs (287; "when the last part is back you merge
    /// them into one" now "you merge them when they are back") and a
    /// question, a remark or a single fact answered here (59), in place of
    /// the starting point (142); the user's word on here or handed off (61)
    /// and their way (107; "when the user says otherwise" now "when they
    /// say otherwise"), in place of the line on how it will go about it
    /// (85) and the user's way (112). The memos first (53) stays.
    /// Raised 5183 → 5416 by ticket 145's third round (main chat PRD
    /// ruling 196): +233. The line on how it will go about it, for work
    /// done here, after the question, the remark and the single fact
    /// (118); several errands that do not depend on each other sent at
    /// once, one tag each, beside one tag per part (115; the paragraph 150
    /// → 265, "keep in one tag …" now its own sentence).
    const MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES: usize = 5416;

    #[test]
    fn main_chat_entry_layer_stays_within_budget() {
        let len = main_chat_entry_layer("")
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES,
            "main chat entry layer is {len} bytes, budget {MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES}: \
             remove a clause first, or raise the budget with a reason"
        );
    }

    #[test]
    fn main_chat_section_stays_within_budget() {
        let longest = MainChatPromptState {
            session_id: "s-zzzzzzzz-zzzzzzzz".into(),
            segment_start_turn: 999_999,
            segment_start_date: "2026-10-12".into(),
            carried: Some(CarriedPromptState {
                turns: crate::session_runner::carry::CARRY_TURNS,
                first_said_at: "2026-10-05 23:59".into(),
                last_said_at: "2026-10-12 23:59".into(),
            }),
        };
        let bytes = |state: &MainChatPromptState| {
            main_chat_section(state)
                .bytes()
                .filter(|&byte| byte != b'\r')
                .count()
        };
        let len = bytes(&longest);
        assert!(
            len <= MAIN_CHAT_SECTION_BUDGET_BYTES,
            "main chat section is {len} bytes, budget {MAIN_CHAT_SECTION_BUDGET_BYTES}"
        );
        // The variant without carried turns is the shorter one.
        let plain = MainChatPromptState {
            carried: None,
            ..longest
        };
        assert!(bytes(&plain) < len);
    }

    /// Ticket 36 (assistant PRD rulings 3, 9): in the main chat,
    /// scheduled tasks leave "What Only The User Changes" and the
    /// paragraph points to the manual; the rest of the list stays the
    /// user's. Workbench sessions, subtasks (the workbench prompt) and IM
    /// keep the paragraph word for word. Single-line fragments only (CRLF
    /// on Windows).
    #[test]
    fn only_the_main_chat_sets_scheduled_tasks_itself() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        assert!(main.contains("## What Only The User Changes In Galley"));
        assert!(main.contains(
            "interface: model providers and API keys, Channels, Browser Control and its"
        ));
        assert!(main.contains(
            "browser extension, the runtime, updates, and display. When asked to change one"
        ));
        assert!(main.contains(
            "values to fill in. Reminders and scheduled tasks are not on this list: you set"
        ));
        assert!(
            main.contains("them yourself with the Galley CLI, as your manual (named below) says.")
        );
        assert!(main.contains(
            "say it is done. Tell the user where it is, and prepare what they need: the"
        ));
        assert!(!main.contains("Channels, scheduled tasks, Browser"));
        assert!(!main.contains("the prompt and time for a scheduled task"));
        assert!(!main.contains("so the prompt must stand on its own"));
        assert!(!main.contains("ask the user to tell"));
        assert!(!main.contains("one is noted or set."));
        assert!(!main.contains("a top bar's to-do only lists them"));
        // galley#31 and the capability rule stay for the main chat too.
        assert!(main.contains("never write `sche_tasks`"));
        assert!(main.contains("Do not"));
        assert!(
            main.contains("claim a capability you have not confirmed you have in this session.")
        );

        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            // Ruling 95: to-dos too, now that the panel opens beside
            // every conversation and the workbench has `galley todo`.
            // v0.7.0 pre-flight item 40: the panel only lists them, and
            // its ＋ goes to the Galley conversation.
            assert!(prompt
                .contains("the values to fill in. To-dos, reminders and scheduled tasks are the"));
            assert!(prompt.contains(
                "assistant's: ask the user to tell it in the Galley conversation atop the"
            ));
            assert!(prompt.contains(
                "sidebar (a top bar's to-do only lists them; its ＋ goes there), and never say"
            ));
            assert!(prompt.contains("one is noted or set."));
            assert!(!prompt.contains("kept by the"));
            assert!(!prompt.contains("Reminders and scheduled tasks are not on this list"));
            assert!(!prompt.contains("your manual"));
        }

        // The swaps are the only differences, and they happened: the
        // paragraph is in the shared rules exactly once (ticket 145: and
        // the opening line, swapped for the standing).
        assert_eq!(
            RUNTIME_PROMPT_STATIC
                .matches(USER_ONLY_CONFIGURATION)
                .count(),
            1
        );
        assert_ne!(main_chat_static_prompt(), workbench_static_prompt());
        assert_eq!(
            main_chat_static_prompt()
                .replacen(
                    MAIN_CHAT_USER_ONLY_CONFIGURATION,
                    USER_ONLY_CONFIGURATION,
                    1
                )
                .replacen(MAIN_CHAT_STANDING, GALLEY_OPENING, 1),
            workbench_static_prompt()
        );
        // IM is the shared rules plus the state block, as before.
        assert!(compose_im_runtime_prompt("t").starts_with(RUNTIME_PROMPT_STATIC));
        assert!(compose_runtime_prompt("t").starts_with(&workbench_static_prompt()));
        // Not a new prompt generation for anyone else.
        assert_eq!(
            prompt_hash().len(),
            8,
            "prompt_hash still fingerprints the workbench rules"
        );
    }

    /// Byte cap on the main chat's static rules: the shared ones with
    /// ticket 36's paragraph swapped and, since ticket 145 (main chat PRD
    /// ruling 194), the standing in place of the opening line. Until
    /// ticket 145 they had to stay inside `STATIC_PROMPT_BUDGET_BYTES` and
    /// no longer than everyone's (the swap alone made them 89 bytes
    /// shorter); the standing makes them longer by what only the main chat
    /// reads, so they have a cap of their own. Set the way the shared one
    /// is: no headroom on the larger platform variant (Windows, whose
    /// history lookup commands are 18 bytes longer: 7074 bytes on POSIX),
    /// `\r` not counted. 6762 on POSIX before ticket 145; the standing
    /// adds 312 (the paragraph, 342 bytes, in place of the 30-byte
    /// opening line). Like the shared cap: to add a clause, remove one
    /// first, or raise this number in the same diff and say why.
    const MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES: usize = 7092;

    #[test]
    fn main_chat_static_rules_stay_within_their_budget() {
        let bytes = |text: &str| text.bytes().filter(|&byte| byte != b'\r').count();
        let len = bytes(&main_chat_static_prompt());
        let shared = bytes(&workbench_static_prompt());
        assert!(
            len <= MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES,
            "main chat static rules are {len} bytes, budget \
             {MAIN_CHAT_STATIC_PROMPT_BUDGET_BYTES}: remove a clause first, or raise the \
             budget with a reason"
        );
        // What makes them longer is the standing alone (ticket 36's swap
        // still makes them shorter).
        let config = bytes(USER_ONLY_CONFIGURATION) - bytes(MAIN_CHAT_USER_ONLY_CONFIGURATION);
        let standing = bytes(MAIN_CHAT_STANDING) - bytes(GALLEY_OPENING);
        assert_eq!(len, shared - config + standing);
        assert!(shared - config <= STATIC_PROMPT_BUDGET_BYTES);
    }

    /// Tickets 36 and 41: the entry layer asks, unasked, for a to-do for
    /// what the user has to do (a reminder on it when it has a date), the
    /// tick when it is done, its own reminder for a follow-up it promises,
    /// and `todo list` before saying what is left; it names the manual's
    /// part (its section until ticket 59), which exists. Ticket 60: and
    /// for what comes up on a date and will be worth raising then. Ticket
    /// 64: the part is read before saying it will note one.
    /// Main chat only.
    #[test]
    fn main_chat_entry_layer_asks_for_reminders_unasked() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        assert!(main
            .contains("Note what the user has to do (a deadline, a call, a flight, a purchase),"));
        assert!(main.contains(
            "or what comes up on a date and will be worth raising then (a renovation due"
        ));
        assert!(main.contains(
            "to finish, a lease ending), as a to-do, with a reminder when it has a date,"
        ));
        assert!(main
            .contains("and tick it off when it is done; set yourself a reminder when you promise"));
        assert!(
            main.contains("to follow up. Do it unasked, but read `todos.md` in your manual before")
        );
        assert!(main.contains(
            "saying you will (it says when), and `todo list` before saying what is left."
        ));
        assert!(!main.contains("\"To-dos and"));
        assert!(!main.contains("Reminders and scheduled tasks\" in your manual"));
        assert!(crate::assistant_manual::part("todos.md").contains("### Noting a to-do"));
        let layer = main.find("## Galley Main Chat Entry Layer").unwrap();
        let todo = main.find("Note what the user has to do").unwrap();
        let manual = main.find("Your manual is in").unwrap();
        assert!(layer < todo && todo < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("set yourself a reminder"));
            assert!(!prompt.contains("`todo list`"));
        }
    }

    /// Ticket 63 (main chat PRD ruling 115): the to-do paragraph closes
    /// with the floor that 「记下了」 follows a write in the same turn (a
    /// to-do, a reminder, the memory; since ticket 96 a memo). Main chat
    /// only.
    #[test]
    fn main_chat_entry_layer_says_noted_only_after_a_write() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        assert!(main.contains(
            "Say 「记下了」 or the like only after you wrote it down this turn (a to-do, a"
        ));
        assert!(main.contains("reminder, a memo); if you write nothing down, do not bring up"));
        assert!(!main.contains("your memory);"));
        let todo = main.find("Note what the user has to do").unwrap();
        let floor = main.find("Say 「记下了」").unwrap();
        let manual = main.find("Your manual is in").unwrap();
        assert!(todo < floor && floor < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("记下了"));
        }
    }

    /// Ticket 64 (main chat PRD ruling 116): it reads `todos.md` before
    /// saying it will note something (the test of when is the part's), and
    /// a turn that writes nothing down does not bring noting up. The part
    /// it is sent to holds that test. Main chat only.
    #[test]
    fn main_chat_entry_layer_reads_todos_before_saying_it_will_note() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        assert!(main.contains("Do it unasked, but read `todos.md` in your manual before"));
        assert!(main.contains("saying you will (it says when),"));
        assert!(main.contains("if you write nothing down, do not bring up"));
        assert!(main.contains("noting it."));
        assert!(!main.contains("Do it unasked, and"));
        assert!(crate::assistant_manual::part("todos.md")
            .contains("Follow up something they mention without being asked, too, when all three"));
        let read = main.find("but read `todos.md`").unwrap();
        let floor = main.find("do not bring up").unwrap();
        let manual = main.find("Your manual is in").unwrap();
        assert!(read < floor && floor < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("saying you will"));
            assert!(!prompt.contains("do not bring up"));
        }
    }

    /// Ticket 96 (main chat PRD rulings 140–142): after the to-do sentence,
    /// what the model learns about the user and will need later is noted
    /// as a memo, and (ticket 98) the same thing asked about three times as
    /// an interest, with the part named (one on the table, holding the
    /// rules); the floor before the manual list. Main chat only.
    #[test]
    fn main_chat_entry_layer_notes_what_it_learns_as_a_memo() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        assert!(
            main.contains("Note what you learn about the user that you will need later as a memo;")
        );
        // Ticket 98: a count to see an interest by.
        assert!(main
            .contains("once they have asked about the same thing three times (a team, a stock),"));
        assert!(main.contains("note it as an interest (see `memo.md`)."));
        assert!(crate::assistant_manual::part("memo.md").contains("## The user's memos"));
        let todo = main
            .find("`todo list` before saying what is left.")
            .unwrap();
        let memo = main.find("Note what you learn about the user").unwrap();
        let floor = main.find("Say 「记下了」").unwrap();
        let manual = main.find("Your manual is in").unwrap();
        assert!(todo < memo && memo < floor && floor < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("memo.md"));
            assert!(!prompt.contains("as a memo"));
        }
    }

    /// Ticket 73 (assistant PRD ruling 10): the to-do sentence takes what
    /// the user is in the middle of; noting something comes with a step
    /// ahead, done and then said, never offered, with `unasked.md` named
    /// (and read with `todos.md` to note one, a part that exists); a file
    /// is handed over as `[FILE:<absolute path>]` on a line of its own.
    /// Main chat only.
    #[test]
    fn main_chat_entry_layer_acts_unasked_and_hands_over_files() {
        let main =
            compose_main_chat_runtime_prompt("t", &main_chat_state(), None, None, MANUAL_DIR);
        // Single-line fragments only (CRLF on Windows).
        assert!(main.contains("what they are in the middle of and set aside to come back to,"));
        assert!(
            main.contains("When you note something, think a step ahead: do what you can for it")
        );
        assert!(
            main.contains("unasked, then say what you did; offer nothing you have not done (see")
        );
        assert!(main.contains("`unasked.md`). To hand over a file you made or found, put"));
        assert!(
            main.contains("`[FILE:<absolute path>]` on a line of its own and say what it is: the")
        );
        assert!(main.contains("desktop shows it as a card."));
        assert!(main.contains("`todos.md` and `unasked.md` to note a to-do;"));
        assert!(crate::assistant_manual::part("unasked.md")
            .contains("## Doing things without being asked"));
        let todo = main.find("Note what the user has to do").unwrap();
        let ahead = main.find("think a step ahead").unwrap();
        let manual = main.find("Your manual is in").unwrap();
        assert!(todo < ahead && ahead < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("[FILE:<absolute path>]"));
            assert!(!prompt.contains("think a step ahead"));
            assert!(!prompt.contains("in the middle of"));
        }
    }

    /// Ticket 73: the morning review is a routine Galley made, not an
    /// outside agent's (which the manual says to ask about before
    /// pausing), so its line says whose it is.
    #[test]
    fn in_hand_names_the_morning_review_as_galleys() {
        let mut review = task(
            "sched_review",
            crate::scheduler::REVIEW_PROMPT,
            Some("2026-10-17T01:00:00+00:00"),
            ScheduledTaskRepeat::Daily,
        );
        review.created_by = TodoCreator::Agent;
        review.agent = Some(crate::scheduler::REVIEW_SUPERVISOR.into());
        let todo = AssistantTodo {
            routine: vec![review],
            ..AssistantTodo::default()
        };
        let text = in_hand_section(&todo, &[], at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        assert!(
            text.contains(
                "- `sched_review` 2026-10-17 09:00 (Sat), daily, Galley's morning review, not set \
                 by you: Morning review: go over what is in hand"
            ),
            "{text}"
        );
        assert!(!text.contains("outside agent"));
    }

    use crate::api::schedule::{ScheduleTarget, ScheduledTaskId, ScheduledTaskRepeat};
    use crate::api::todo::StoredDue;
    use crate::api::TodoReminder;
    use crate::assistant_todo::{
        AssistantTodo, DeclinedBy, DeclinedFollowUp, TodoCreator, TodoItem, TodoKind, TodoState,
        YourTodos,
    };
    use chrono::{DateTime, FixedOffset, NaiveDate, Utc};

    fn shanghai() -> FixedOffset {
        FixedOffset::east_opt(8 * 3600).unwrap()
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn item(kind: TodoKind, id: &str, text: &str, state: TodoState) -> TodoItem {
        TodoItem {
            kind,
            id: id.into(),
            text: text.into(),
            state,
            at: None,
            created_by: TodoCreator::Assistant,
            agent: None,
            target: None,
            repeat: None,
            time_of_day: None,
            created_in: None,
            run_session_id: None,
            notes: None,
            due: None,
            overdue: false,
            reminder: None,
            done_by: None,
            created_at: None,
            updated_at: None,
            cancelled_at: None,
            items: Vec::new(),
        }
    }

    fn task(id: &str, text: &str, at: Option<&str>, repeat: ScheduledTaskRepeat) -> TodoItem {
        TodoItem {
            at: at.map(str::to_string),
            target: Some(ScheduleTarget::Assistant),
            repeat: Some(repeat),
            ..item(TodoKind::Task, id, text, TodoState::Scheduled)
        }
    }

    fn subtask(id: &str, title: &str, state: TodoState) -> TodoItem {
        TodoItem {
            at: Some("2026-10-16T05:00:00+00:00".into()),
            ..item(TodoKind::Subtask, id, title, state)
        }
    }

    /// A to-do not done, due `due`, with a reminder `(at, state)`.
    fn open_todo(
        id: &str,
        title: &str,
        due: Option<StoredDue>,
        overdue: bool,
        reminder: Option<(&str, TodoReminderState)>,
    ) -> TodoItem {
        TodoItem {
            due: due.map(|due| due.to_wire(&shanghai())),
            overdue,
            reminder: reminder.map(|(at, state)| TodoReminder {
                task_id: ScheduledTaskId(format!("sched_of_{id}")),
                at: at.into(),
                state,
            }),
            ..item(TodoKind::Todo, id, title, TodoState::Open)
        }
    }

    fn day(y: i32, m: u32, d: u32) -> StoredDue {
        StoredDue::Date(NaiveDate::from_ymd_opt(y, m, d).unwrap())
    }

    /// A follow-up the user turned down (ticket 61).
    fn declined(
        kind: TodoKind,
        id: &str,
        text: &str,
        cancelled_at: &str,
        by: DeclinedBy,
        reason: Option<&str>,
    ) -> DeclinedFollowUp {
        DeclinedFollowUp {
            kind,
            id: id.into(),
            text: text.into(),
            cancelled_at: cancelled_at.into(),
            by,
            reason: reason.map(str::to_string),
        }
    }

    /// Tickets 36 and 39: the format, item by item — a to-do's due date
    /// (a day, or a day and a time), overdue, its reminder, its title;
    /// a task's time (local, the wake note's format), one-off or
    /// repeating, paused, who set it, whether it starts a conversation,
    /// the words; a subtask's title and state. The groups in the list's
    /// order: the user's to-dos, what the main chat is on (subtasks, then
    /// one-off tasks), the routines.
    #[test]
    fn in_hand_lines_say_what_when_and_who() {
        let mut weekly = task(
            "sched_41d0aa5e9b3c2f17",
            "整理下载文件夹",
            Some("2026-10-17T09:00:00+00:00"),
            ScheduledTaskRepeat::Weekly { weekdays: vec![6] },
        );
        weekly.created_by = TodoCreator::User;
        weekly.target = Some(ScheduleTarget::Session);
        let mut paused = task(
            "sched_9b2c7e1f0a3d4c58",
            "看一眼 MyApp 的依赖更新",
            None,
            ScheduledTaskRepeat::Daily,
        );
        paused.state = TodoState::Paused;
        paused.created_by = TodoCreator::Agent;
        paused.agent = Some("claude-code".into());
        let todo = AssistantTodo {
            yours: YourTodos {
                today: vec![open_todo(
                    "todo_1a2b3c4d5e6f7a8b",
                    "回房东电话",
                    Some(StoredDue::At(at("2026-10-16T02:00:00Z"))),
                    true,
                    None,
                )],
                later: vec![
                    open_todo(
                        "todo_2b3c4d5e6f7a8b9c",
                        "交季度报告",
                        Some(StoredDue::At(at("2026-10-21T07:00:00Z"))),
                        false,
                        Some(("2026-10-21T06:00:00+00:00", TodoReminderState::Scheduled)),
                    ),
                    open_todo(
                        "todo_3c4d5e6f7a8b9c0d",
                        "交材料",
                        Some(day(2026, 10, 23)),
                        false,
                        Some(("2026-10-16T01:00:00+00:00", TodoReminderState::Fired)),
                    ),
                ],
                anytime: vec![open_todo(
                    "todo_4d5e6f7a8b9c0d1e",
                    "买营养土",
                    None,
                    false,
                    None,
                )],
            },
            assistant: vec![
                subtask(
                    "s-mgq3c1d8-2k7v4p0a",
                    "查三家本周螺纹钢报价",
                    TodoState::Running,
                ),
                subtask(
                    "s-mgr8x2k1-5b9d3f7h",
                    "订周三去上海的高铁",
                    TodoState::Asking,
                ),
                subtask("s-mgs1q9w3-8c2v6n4m", "", TodoState::Failed),
                task(
                    "sched_3f9a0c1d2e4b5a69",
                    "提醒用户带身份证：明早 8:05 虹桥的高铁\n去上海出差",
                    Some("2026-10-16T12:00:00+00:00"),
                    ScheduledTaskRepeat::Once,
                ),
            ],
            routine: vec![weekly, paused],
            done: vec![subtask("s-done", "做完的", TodoState::Done)],
            done_omitted: 0,
            today_count: 1,
        };
        let text = in_hand_section(&todo, &[], at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        let want = [
            "### In Hand",
            "",
            "As of 2026-10-16 14:05, local time (it may have changed since: `todo list`, `schedule list` and `session brief <id>` read it now).",
            "",
            "The user's to-dos (not done):",
            "- `todo_1a2b3c4d5e6f7a8b` due 2026-10-16 10:00 (Fri), overdue: 回房东电话",
            "- `todo_2b3c4d5e6f7a8b9c` due 2026-10-21 15:00 (Wed), reminder 2026-10-21 14:00 (Wed): 交季度报告",
            "- `todo_3c4d5e6f7a8b9c0d` due 2026-10-23 (Fri), reminded 2026-10-16 09:00 (Fri): 交材料",
            "- `todo_4d5e6f7a8b9c0d1e` no due date: 买营养土",
            "",
            "What you are on (subtasks not finished, then one-off reminders and tasks to come):",
            "- `s-mgq3c1d8-2k7v4p0a` 查三家本周螺纹钢报价: working",
            "- `s-mgr8x2k1-5b9d3f7h` 订周三去上海的高铁: asking a question",
            "- `s-mgs1q9w3-8c2v6n4m` (untitled): failed",
            "- `sched_3f9a0c1d2e4b5a69` 2026-10-16 20:00 (Fri), one-off, set by you: 提醒用户带身份证：明早 8:05 虹桥的高铁 去上海出差",
            "",
            "Routine (repeating tasks):",
            "- `sched_41d0aa5e9b3c2f17` 2026-10-17 17:00 (Sat), weekly, set by the user, starts a new conversation: 整理下载文件夹",
            "- `sched_9b2c7e1f0a3d4c58` daily, paused, set by the outside agent claude-code: 看一眼 MyApp 的依赖更新",
        ]
        .join("\n");
        assert_eq!(text, want);
        // The done group stays out.
        assert!(!text.contains("做完的"));

        // Ticket 61: with none turned down the lines above are exactly
        // what they were before the fourth group; with some, it follows
        // the routines: when, who (the user at the desktop, or you at
        // their request), the words, the reason when there is one.
        let turned_down = [
            declined(
                TodoKind::Task,
                "sched_7a1b2c3d4e5f6a7b",
                "提醒用户确认 905 装修进度",
                "2026-10-15T13:30:00+00:00",
                DeclinedBy::User,
                None,
            ),
            declined(
                TodoKind::Todo,
                "todo_5e6f7a8b9c0d1e2f",
                "905 装修验收",
                "2026-10-14T01:12:00+00:00",
                DeclinedBy::Assistant,
                Some("用户说装修这类的别提醒"),
            ),
        ];
        let text =
            in_hand_section(&todo, &turned_down, at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        let fourth = [
            "",
            "",
            "Follow-ups the user turned down (to-dos and reminders you set that were cancelled on the desktop or at their request, last 90 days):",
            "- `sched_7a1b2c3d4e5f6a7b` cancelled 2026-10-15 21:30 (Thu) by the user on the desktop: 提醒用户确认 905 装修进度",
            "- `todo_5e6f7a8b9c0d1e2f` cancelled 2026-10-14 09:12 (Wed) by you at the user's request: 905 装修验收 (reason: 用户说装修这类的别提醒)",
        ]
        .join("\n");
        assert_eq!(text, format!("{want}{fourth}"));
    }

    /// Ticket 61: the follow-ups turned down alone still make the section
    /// (the first line as without to-dos); at most five lines, then "and N
    /// more" with the commands that list cancelled ones; words and reasons
    /// cut as titles are; a time Core cannot read is left out.
    #[test]
    fn in_hand_follow_ups_turned_down_alone_and_bounded() {
        let now = at("2026-10-16T06:05:00Z");
        let one = [declined(
            TodoKind::Task,
            "sched_7a1b2c3d4e5f6a7b",
            "提醒用户喝水",
            "2026-10-16T01:00:00+00:00",
            DeclinedBy::User,
            None,
        )];
        let text = in_hand_section(&AssistantTodo::default(), &one, now, &shanghai()).unwrap();
        let want = [
            "### In Hand",
            "",
            "As of 2026-10-16 14:05, local time (it may have changed since: `schedule list` and `session brief <id>` read it now).",
            "",
            "Follow-ups the user turned down (to-dos and reminders you set that were cancelled on the desktop or at their request, last 90 days):",
            "- `sched_7a1b2c3d4e5f6a7b` cancelled 2026-10-16 09:00 (Fri) by the user on the desktop: 提醒用户喝水",
        ]
        .join("\n");
        assert_eq!(text, want);
        // Done ones alone still make nothing; with one turned down, the
        // section is that group alone.
        let only_done = AssistantTodo {
            done: vec![subtask("s-done", "做完的", TodoState::Done)],
            ..AssistantTodo::default()
        };
        assert_eq!(
            in_hand_section(&only_done, &one, now, &shanghai()),
            Some(want)
        );
        // Ticket 60: the manual sends the model to this group by its
        // name, in the parts that set or cancel a follow-up.
        let name = "\"Follow-ups the user turned down\"";
        assert!(text.contains("\nFollow-ups the user turned down ("));
        for part in ["todos.md", "todos-change.md", "reminders.md"] {
            assert!(crate::assistant_manual::part(part).contains(name), "{part}");
        }

        let long = "一二三四五六七八九十".repeat(5);
        let cut: String = long.chars().take(IN_HAND_TEXT_CHARS).collect();
        let many: Vec<DeclinedFollowUp> = (0..7)
            .map(|n| {
                declined(
                    TodoKind::Todo,
                    &format!("todo_{n:016x}"),
                    &long,
                    "2026-10-15T01:00:00+00:00",
                    DeclinedBy::Assistant,
                    Some(&long),
                )
            })
            .collect();
        let text = in_hand_section(&AssistantTodo::default(), &many, now, &shanghai()).unwrap();
        assert_eq!(text.matches("\n- `todo_").count(), IN_HAND_MAX_PER_GROUP);
        assert!(text.ends_with("\n- and 2 more: `todo list --all`, `schedule list --all`"));
        assert!(text.contains(&format!(": {cut}… (reason: {cut}…)\n")));
        assert!(!text.contains(&long));
        let unreadable = [declined(
            TodoKind::Todo,
            "todo_1",
            "x",
            "not a time",
            DeclinedBy::User,
            None,
        )];
        let text =
            in_hand_section(&AssistantTodo::default(), &unreadable, now, &shanghai()).unwrap();
        assert!(text.ends_with("\n- `todo_1` cancelled by the user on the desktop: x"));
    }

    /// Tickets 36 and 39: at most five lines a group, then "and N more"
    /// with the command that lists them all; long titles and words cut
    /// with an ellipsis; a group alone when the others are empty, and the
    /// first line names `todo list` only when there are to-dos; nothing at
    /// all when every group is empty (done ones alone included).
    #[test]
    fn in_hand_lines_are_bounded_and_absent_when_empty() {
        let now = at("2026-10-16T06:05:00Z");
        assert_eq!(
            in_hand_section(&AssistantTodo::default(), &[], now, &shanghai()),
            None
        );
        let only_done = AssistantTodo {
            done: vec![subtask("s-done", "做完的", TodoState::Done)],
            ..AssistantTodo::default()
        };
        assert_eq!(in_hand_section(&only_done, &[], now, &shanghai()), None);

        let long = "一二三四五六七八九十".repeat(5);
        let tasks: Vec<TodoItem> = (0..7)
            .map(|n| {
                task(
                    &format!("sched_{n:016x}"),
                    &long,
                    Some("2026-10-20T12:00:00+00:00"),
                    ScheduledTaskRepeat::Once,
                )
            })
            .collect();
        let todo = AssistantTodo {
            assistant: tasks,
            ..AssistantTodo::default()
        };
        let text = in_hand_section(&todo, &[], now, &shanghai()).unwrap();
        assert_eq!(text.matches("\n- `sched_").count(), IN_HAND_MAX_PER_GROUP);
        assert!(text.contains("\n- and 2 more: `sessions list`, `schedule list`"));
        assert!(!text.contains("to-dos") && !text.contains("Routine"));
        assert!(!text.contains("`todo list`"));
        assert!(text.contains("since: `schedule list` and `session brief <id>` read it now"));
        let cut: String = long.chars().take(IN_HAND_TEXT_CHARS).collect();
        assert!(text.contains(&format!(": {cut}…\n")));
        assert!(!text.contains(&long));

        // Seven to-dos over the three parts: five lines in the list's
        // order, then the count.
        let todos = |n: usize, prefix: &str| -> Vec<TodoItem> {
            (0..n)
                .map(|k| open_todo(&format!("todo_{prefix}{k:015x}"), "事", None, false, None))
                .collect()
        };
        let todo = AssistantTodo {
            yours: YourTodos {
                today: todos(2, "a"),
                later: todos(2, "b"),
                anytime: todos(3, "c"),
            },
            ..AssistantTodo::default()
        };
        let text = in_hand_section(&todo, &[], now, &shanghai()).unwrap();
        assert_eq!(text.matches("\n- `todo_").count(), IN_HAND_MAX_PER_GROUP);
        assert!(
            text.contains("- `todo_c000000000000000` no due date: 事\n- and 2 more: `todo list`")
        );
        assert!(text.ends_with("\n- and 2 more: `todo list`"));
        assert!(text.contains("since: `todo list`, `schedule list`"));

        let routine: Vec<TodoItem> = (0..6)
            .map(|n| {
                task(
                    &format!("sched_{n:016x}"),
                    "看新闻",
                    Some("2026-10-17T00:00:00+00:00"),
                    ScheduledTaskRepeat::Daily,
                )
            })
            .collect();
        let todo = AssistantTodo {
            routine,
            ..AssistantTodo::default()
        };
        let text = in_hand_section(&todo, &[], now, &shanghai()).unwrap();
        assert!(!text.contains("What you are on"));
        assert_eq!(text.matches(", daily, ").count(), IN_HAND_MAX_PER_GROUP);
        assert!(text.ends_with("\n- and 1 more: `schedule list`"));
    }

    /// Ticket 36: the lines sit in the main chat's prompt between the
    /// Main Chat section and the entry layer; without any the prompt is
    /// exactly what it was; no other prompt ever carries them.
    #[test]
    fn in_hand_lines_are_main_chat_only() {
        let state = main_chat_state();
        let todo = AssistantTodo {
            yours: YourTodos {
                anytime: vec![open_todo(
                    "todo_1a2b3c4d5e6f7a8b",
                    "买营养土",
                    None,
                    false,
                    None,
                )],
                ..YourTodos::default()
            },
            assistant: vec![task(
                "sched_3f9a0c1d2e4b5a69",
                "提醒用户带身份证",
                Some("2026-10-16T12:00:00+00:00"),
                ScheduledTaskRepeat::Once,
            )],
            ..AssistantTodo::default()
        };
        let lines = in_hand_section(&todo, &[], at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        let without = compose_main_chat_runtime_prompt("t", &state, None, None, MANUAL_DIR);
        let with = compose_main_chat_runtime_prompt("t", &state, Some(&lines), None, MANUAL_DIR);
        let section = main_chat_section(&state);
        assert_eq!(
            with,
            without.replacen(&section, &format!("{section}\n\n{lines}"), 1)
        );
        let main_chat = with.find("## Main Chat\n").unwrap();
        let in_hand = with.find("### In Hand").unwrap();
        let layer = with.find("## Galley Main Chat Entry Layer").unwrap();
        assert!(main_chat < in_hand && in_hand < layer);
        assert!(!without.contains("In Hand"));
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("In Hand"));
            assert!(!prompt.contains("The user's to-dos"));
        }
    }

    /// Tickets 36 and 39 against a database: the lines come from the
    /// read behind the desktop's 「待办」
    /// ([`crate::assistant_todo::assistant_todo`]) and list its yours,
    /// Galley's and routine groups in its order (main chat PRD ruling 86:
    /// what the user sees is what the main chat is told). A to-do's
    /// reminder shows on the to-do, not as a task of its own; a cancelled
    /// reminder is nowhere; a database with no main chat (attach mode
    /// never has one) has no subtasks and no to-dos to list.
    #[tokio::test]
    async fn in_hand_lines_read_what_the_todo_list_reads() {
        use crate::api::schedule::{instant_to_utc_iso, CreateScheduledTaskInput};
        use crate::api::{
            CreateSessionInput, CreateTodoInput, GalleyApi, Origin, OriginVia, RuntimeKind,
            SessionId,
        };
        use crate::api::{SubtaskDispatch, ASSISTANT_SUPERVISOR};
        use crate::db::{MainChatSeed, SqliteGalley};
        use crate::runner_manager::RunnerManager;

        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        for m in crate::db_migrations::all() {
            sqlx::raw_sql(m.sql)
                .execute(&pool)
                .await
                .expect("migration");
        }
        let galley = SqliteGalley::from_pool(pool);
        galley
            .set_pref_json("active_runtime_kind", serde_json::json!("managed"))
            .await
            .expect("managed runtime");
        let now = Utc::now();
        let later = |hours: i64| instant_to_utc_iso(&(now + chrono::Duration::hours(hours)));
        let once = |id: &str, words: &str, hours: i64| CreateScheduledTaskInput {
            id: id.into(),
            project_id: None,
            prompt: words.into(),
            repeat: ScheduledTaskRepeat::Once,
            time_of_day: String::new(),
            llm_name: None,
            enabled: true,
            fire_at: Some(later(hours)),
            target: ScheduleTarget::Assistant,
        };
        let assistant = Origin {
            via: OriginVia::Supervisor,
            supervisor: Some(ASSISTANT_SUPERVISOR.into()),
            reason: None,
            client: None,
        };
        // No main chat yet: a routine from the desktop's form, and no
        // subtask or to-do to list.
        galley
            .create_scheduled_task(
                CreateScheduledTaskInput {
                    repeat: ScheduledTaskRepeat::Daily,
                    time_of_day: "08:00".into(),
                    fire_at: None,
                    target: ScheduleTarget::Session,
                    ..once("sched_form", "整理下载文件夹", 10)
                },
                Origin::gui(),
            )
            .await
            .expect("form task");
        let runners = RunnerManager::new();
        let todo = crate::assistant_todo::assistant_todo(&galley, &runners, now)
            .await
            .expect("todo");
        assert!(todo.assistant.is_empty() && todo.yours.is_empty());
        let text = in_hand_section(&todo, &[], now, &shanghai()).expect("lines");
        assert!(!text.contains("What you are on") && !text.contains("to-dos"));
        assert!(text.contains("daily, set by the user, starts a new conversation: 整理下载文件夹"));

        galley
            .get_or_create_main_chat("s-main", Origin::desktop(), &MainChatSeed::default())
            .await
            .expect("main chat");
        galley
            .create_scheduled_task(once("sched_late", "提醒用户交报告", 30), assistant.clone())
            .await
            .expect("later reminder");
        galley
            .create_scheduled_task(once("sched_soon", "回头查物流", 1), assistant.clone())
            .await
            .expect("sooner reminder");
        galley
            .create_scheduled_task(once("sched_gone", "取消的", 2), assistant.clone())
            .await
            .expect("to cancel");
        galley
            .delete_scheduled_task(ScheduledTaskId("sched_gone".into()), Origin::gui())
            .await
            .expect("cancel");
        let report = galley
            .create_todo(
                CreateTodoInput {
                    title: "交季度报告".into(),
                    due: Some(later(48)),
                    remind_at: Some(later(47)),
                    ..CreateTodoInput::default()
                },
                assistant.clone(),
                None,
            )
            .await
            .expect("to-do with a reminder");
        let soil = galley
            .create_todo(
                CreateTodoInput {
                    title: "买营养土".into(),
                    ..CreateTodoInput::default()
                },
                assistant,
                None,
            )
            .await
            .expect("to-do");
        let input = CreateSessionInput {
            id: "s-sub".into(),
            title: "查物流".into(),
            project_id: None,
            selected_llm_index: None,
            selected_llm_key: None,
            selected_llm_display_name: None,
            ga_runtime_kind: Some(RuntimeKind::Managed),
            ga_runtime_id: None,
            prompt_profile: None,
        };
        galley
            .create_subtask_session(
                input,
                Origin::subtask(),
                &SessionId("s-main".into()),
                Some("查物流\n单号 JD0123456789".into()),
                crate::db::RenameTitleSource::User,
            )
            .await
            .expect("subtask");
        galley
            .record_subtask_dispatch(&SubtaskDispatch {
                parent_session_id: "s-main".into(),
                turn_index: 0,
                ordinal: 0,
                message_id: SubtaskDispatch::reply_message_id("s-main", 0),
                session_id: Some("s-sub".into()),
                title: "查物流".into(),
                failure: None,
                failure_detail: None,
                created_at: instant_to_utc_iso(&now),
                send_backs: 0,
            })
            .await
            .expect("dispatch record");

        let todo = crate::assistant_todo::assistant_todo(&galley, &runners, now)
            .await
            .expect("todo");
        let text = in_hand_section(&todo, &[], now, &shanghai()).expect("lines");
        let listed: Vec<&str> = todo
            .yours
            .iter()
            .chain(&todo.assistant)
            .chain(&todo.routine)
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(
            listed,
            [
                report.id.as_str(),
                soil.id.as_str(),
                "s-sub",
                "sched_soon",
                "sched_late",
                "sched_form"
            ]
        );
        let at: Vec<usize> = listed
            .iter()
            .map(|id| text.find(&format!("`{id}`")).expect("listed"))
            .collect();
        assert!(
            at.windows(2).all(|pair| pair[0] < pair[1]),
            "in the list's order"
        );
        assert!(!text.contains("sched_gone"));
        // The to-do's reminder is on its line, not a task of its own.
        let reminder = report.reminder.as_ref().expect("reminder").task_id.clone();
        assert!(!text.contains(reminder.as_str()));
        assert!(text.contains(", reminder "));
        assert!(text.contains("set by you: 回头查物流"));
        assert!(text.contains("- `s-sub` 查物流: "));
        assert!(text.contains(&format!("- `{}` no due date: 买营养土", soil.id)));

        // Ticket 61: the reminder the user cancelled on the desktop is in
        // no group of the list, and in the main chat's read as one turned
        // down, after the routines.
        let read = crate::assistant_todo::in_hand_read(&galley, &runners, now)
            .await
            .expect("read");
        assert_eq!(read.todo, todo);
        let ids: Vec<&str> = read.declined.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["sched_gone"]);
        let with = in_hand_section(&read.todo, &read.declined, now, &shanghai()).expect("lines");
        assert!(with.starts_with(&text));
        assert!(with.contains("\n- `sched_gone` cancelled "));
        assert!(with.ends_with(" by the user on the desktop: 取消的"));
    }

    /// Byte cap on the "In Hand" lines (tickets 36, 39 and 61), measured
    /// on the longest they get: five lines in each of the four groups,
    /// each with titles, words and reasons cut at the limit in three-byte
    /// characters — to-dos overdue, with a time and a paused reminder;
    /// one-off tasks paused with their time, set by an outside agent with
    /// a label past its cut, that start a conversation; routines the same
    /// with their next fire; follow-ups turned down by you at the user's
    /// request, with a reason — and three-digit "more" counts. No
    /// headroom, `\r` not counted. Data, main chat only: outside the
    /// static budget and the prompt hash. Typical is far less (nothing at
    /// all when there is nothing in hand); twenty lines cap what rides
    /// every request of a busy main chat.
    ///
    /// Ticket 39 raised it from 2467 to 4230 (ticket 36: two groups of
    /// five, tasks and subtasks). The same rule — five lines a group, cut
    /// at the same lengths — now covers three groups: the user's to-dos
    /// are new, and the tasks split between what the main chat is on (with
    /// its subtasks) and the routines. Fifteen lines instead of ten, a
    /// to-do's line (due date, overdue, reminder) about as long as a
    /// task's, and `todo list` named on the first line.
    ///
    /// Ticket 61 raised it from 4230 to 6161: the same rule over a fourth
    /// group, the follow-ups the user turned down (main chat PRD ruling
    /// 113: at most five, each with its words and its reason), whose line
    /// carries two cut texts where the others carry one.
    ///
    /// Main chat ticket 111 raised it from 6161 to 6276: a to-do's line may
    /// end its facts with the count of its items (`, 998 of 999 items
    /// done`, 23 bytes at three digits), on each of the five.
    const IN_HAND_BUDGET_BYTES: usize = 6276;

    /// Main chat ticket 111: a to-do with items under it says how many are
    /// ticked, last among its facts; the items themselves are `todo
    /// show`'s. One without items reads as before.
    #[test]
    fn in_hand_counts_a_to_dos_items() {
        let listed = |text: &str, done: bool| crate::assistant_todo::ListedSubitem {
            id: format!("item_{text}"),
            text: text.into(),
            done,
        };
        let mut trip = open_todo(
            "todo_5e6f7a8b9c0d1e2f",
            "去上海出差",
            Some(day(2026, 10, 21)),
            false,
            Some(("2026-10-20T12:00:00+00:00", TodoReminderState::Scheduled)),
        );
        trip.items = vec![
            listed("订酒店", true),
            listed("订机票", true),
            listed("换港币", false),
        ];
        let mut intake = open_todo(
            "todo_6f7a8b9c0d1e2f3a",
            "松岚湾酒店项目资料收集",
            None,
            false,
            None,
        );
        intake.items = vec![listed("品牌", false), listed("预算", false)];
        let soil = open_todo("todo_4d5e6f7a8b9c0d1e", "买营养土", None, false, None);
        let todo = AssistantTodo {
            yours: YourTodos {
                later: vec![trip],
                anytime: vec![intake, soil],
                ..YourTodos::default()
            },
            ..AssistantTodo::default()
        };
        let text = in_hand_section(&todo, &[], at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        for line in [
            "- `todo_5e6f7a8b9c0d1e2f` due 2026-10-21 (Wed), reminder 2026-10-20 20:00 (Tue), 2 of 3 items done: 去上海出差",
            "- `todo_6f7a8b9c0d1e2f3a` no due date, 0 of 2 items done: 松岚湾酒店项目资料收集",
            "- `todo_4d5e6f7a8b9c0d1e` no due date: 买营养土",
        ] {
            assert!(text.contains(line), "{line}\n{text}");
        }
        assert!(!text.contains("订酒店"), "the items are todo show's");
    }

    #[test]
    fn in_hand_lines_stay_within_budget() {
        let long = "一".repeat(IN_HAND_TEXT_CHARS + 10);
        let agent_task = |repeat: ScheduledTaskRepeat, state: TodoState| {
            let mut t = task(
                "sched_ffffffffffffffff",
                &long,
                Some("2026-10-20T12:00:00+00:00"),
                repeat,
            );
            t.state = state;
            t.created_by = TodoCreator::Agent;
            t.agent = Some("x".repeat(IN_HAND_AGENT_CHARS + 10));
            t.target = Some(ScheduleTarget::Session);
            t
        };
        let mut longest_todo = open_todo(
            "todo_ffffffffffffffff",
            &long,
            Some(StoredDue::At(at("2026-10-15T12:00:00Z"))),
            true,
            Some(("2026-10-20T12:00:00+00:00", TodoReminderState::Paused)),
        );
        // Ticket 111: its items counted (three digits each way; nothing caps
        // how many, a to-do with a thousand is not one the user keeps).
        longest_todo.items = (0..999)
            .map(|n| crate::assistant_todo::ListedSubitem {
                id: format!("item_{n:016x}"),
                text: "项".into(),
                done: n > 0,
            })
            .collect();
        let many = IN_HAND_MAX_PER_GROUP + 999;
        let longest_declined = declined(
            TodoKind::Task,
            "sched_ffffffffffffffff",
            &long,
            "2026-10-15T12:00:00+00:00",
            DeclinedBy::Assistant,
            Some(&long),
        );
        let turned_down = vec![longest_declined; many];
        let todo = AssistantTodo {
            yours: YourTodos {
                today: vec![longest_todo; many],
                ..YourTodos::default()
            },
            assistant: vec![agent_task(ScheduledTaskRepeat::Once, TodoState::Paused); many],
            routine: vec![
                agent_task(
                    ScheduledTaskRepeat::Monthly {
                        monthdays: (1..=31).collect(),
                    },
                    TodoState::Scheduled,
                );
                many
            ],
            ..AssistantTodo::default()
        };
        let len = in_hand_section(&todo, &turned_down, at("2026-10-16T06:05:00Z"), &shanghai())
            .unwrap()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= IN_HAND_BUDGET_BYTES,
            "In Hand lines are {len} bytes, budget {IN_HAND_BUDGET_BYTES}"
        );
    }

    // ---------------- memos (ticket 95) ----------------

    use crate::api::MEMO_TEXT_MAX_CHARS;

    fn memo(id: &str, text: &str, updated_at: &str, until: Option<&str>) -> MemoBrief {
        MemoBrief {
            id: crate::api::MemoId(id.into()),
            text: text.into(),
            until: until.map(str::to_string),
            origin: crate::api::Origin {
                via: crate::api::OriginVia::Supervisor,
                supervisor: Some(crate::api::ASSISTANT_SUPERVISOR.into()),
                reason: None,
                client: None,
            },
            created_in: None,
            created_at: updated_at.into(),
            updated_at: updated_at.into(),
        }
    }

    /// The memo lines as the main chat reads them (ticket 95): when they
    /// were read, then each memo in the order it was noted, with the local
    /// day it was last written and its last day, its text on one line.
    #[test]
    fn memo_lines_read_like_this() {
        let memos = [
            memo(
                "memo_1a2b3c4d5e6f7a8b",
                "叫你小林，在一家设计公司做产品经理",
                "2026-10-20T01:10:00+00:00",
                None,
            ),
            memo(
                "memo_2b3c4d5e6f7a8b9c",
                "不吃香菜",
                "2026-10-24T12:30:00+00:00",
                None,
            ),
            memo(
                "memo_3c4d5e6f7a8b9c0d",
                "看你这周常问 76 人\n的比赛",
                "2026-10-26T00:40:00+00:00",
                None,
            ),
            memo(
                "memo_4d5e6f7a8b9c0d1e",
                "下周三起在上海出差",
                "2026-10-26T01:02:00+00:00",
                Some("2026-11-06"),
            ),
        ];
        let text = memo_section(&memos, at("2026-10-26T01:05:00Z"), &shanghai()).unwrap();
        assert_eq!(
            text,
            "### Memo\n\
             \n\
             As of 2026-10-26 09:05, local time (it may have changed since: `memo list` reads it \
             now; `memo add`, `memo update` and `memo delete` change it).\n\
             \n\
             What you noted about the user, oldest first, each with the day you last noted or \
             changed it:\n\
             - `memo_1a2b3c4d5e6f7a8b` 2026-10-20: 叫你小林，在一家设计公司做产品经理\n\
             - `memo_2b3c4d5e6f7a8b9c` 2026-10-24: 不吃香菜\n\
             - `memo_3c4d5e6f7a8b9c0d` 2026-10-26: 看你这周常问 76 人 的比赛\n\
             - `memo_4d5e6f7a8b9c0d1e` 2026-10-26, until 2026-11-06 (Fri): 下周三起在上海出差"
        );
        // No memo, no section.
        assert_eq!(
            memo_section(&[], at("2026-10-26T01:05:00Z"), &shanghai()),
            None
        );
    }

    /// The memos go in, in order, until the next would take their text
    /// past 2,000 characters; that one and the rest are counted on the
    /// last line (ticket 95, main chat PRD ruling 141 point 6).
    #[test]
    fn memo_lines_stop_at_two_thousand_characters_and_say_how_many_more() {
        let now = at("2026-10-26T01:05:00Z");
        let full = |n: usize| -> Vec<MemoBrief> {
            (0..n)
                .map(|i| {
                    memo(
                        &format!("memo_{i:016x}"),
                        &"字".repeat(MEMO_TEXT_MAX_CHARS),
                        "2026-10-26T01:00:00+00:00",
                        None,
                    )
                })
                .collect()
        };
        // Exactly 2,000: all of them, no last line.
        let exactly = full(20);
        let text = memo_section(&exactly, now, &shanghai()).unwrap();
        assert_eq!(text.matches("\n- `memo_").count(), 20);
        assert!(!text.contains(" more, past the "));
        // Past it: the first 20, then how many more.
        let text = memo_section(&full(23), now, &shanghai()).unwrap();
        assert_eq!(text.matches("\n- `memo_").count(), 20);
        assert!(text
            .ends_with("\n- and 3 more, past the 2000 characters this section holds: `memo list`"));
        assert!(text.contains(&format!("`memo_{:016x}`", 19)));
        assert!(!text.contains(&format!("`memo_{:016x}`", 20)));
        // 1,999, then one of two characters: left out, and a short one
        // after it with it — oldest first, no gaps.
        let mut memos = full(19);
        memos.push(memo(
            "memo_aaaaaaaaaaaaaaaa",
            &"字".repeat(99),
            "2026-10-26T01:00:00+00:00",
            None,
        ));
        memos.push(memo(
            "memo_bbbbbbbbbbbbbbbb",
            "两字",
            "2026-10-26T01:00:00+00:00",
            None,
        ));
        memos.push(memo(
            "memo_cccccccccccccccc",
            "一",
            "2026-10-26T01:00:00+00:00",
            None,
        ));
        let text = memo_section(&memos, now, &shanghai()).unwrap();
        assert!(text.contains("`memo_aaaaaaaaaaaaaaaa`"));
        assert!(!text.contains("`memo_bbbbbbbbbbbbbbbb`"));
        assert!(!text.contains("`memo_cccccccccccccccc`"));
        assert!(text
            .ends_with("\n- and 2 more, past the 2000 characters this section holds: `memo list`"));
    }

    /// Ticket 95: the memo lines follow the "In Hand" lines in the main
    /// chat, before the entry layer, and nowhere else; without memos the
    /// prompt is as it was.
    #[test]
    fn memo_lines_are_main_chat_only_after_in_hand() {
        let state = main_chat_state();
        let now = at("2026-10-26T01:05:00Z");
        let todo = AssistantTodo {
            yours: YourTodos {
                anytime: vec![open_todo(
                    "todo_1a2b3c4d5e6f7a8b",
                    "买营养土",
                    None,
                    false,
                    None,
                )],
                ..YourTodos::default()
            },
            ..AssistantTodo::default()
        };
        let in_hand = in_hand_section(&todo, &[], now, &shanghai()).unwrap();
        let memos = memo_section(
            &[memo(
                "memo_2b3c4d5e6f7a8b9c",
                "不吃香菜",
                "2026-10-24T12:30:00+00:00",
                None,
            )],
            now,
            &shanghai(),
        )
        .unwrap();
        let without =
            compose_main_chat_runtime_prompt("t", &state, Some(&in_hand), None, MANUAL_DIR);
        let with =
            compose_main_chat_runtime_prompt("t", &state, Some(&in_hand), Some(&memos), MANUAL_DIR);
        assert_eq!(
            with,
            without.replacen(&in_hand, &format!("{in_hand}\n\n{memos}"), 1)
        );
        let in_hand_at = with.find("### In Hand").unwrap();
        let memo_at = with.find("### Memo").unwrap();
        let layer = with.find("## Galley Main Chat Entry Layer").unwrap();
        assert!(in_hand_at < memo_at && memo_at < layer);
        // Memos without anything in hand: right after the Main Chat
        // section.
        let alone = compose_main_chat_runtime_prompt("t", &state, None, Some(&memos), MANUAL_DIR);
        let section = main_chat_section(&state);
        assert!(alone.contains(&format!(
            "{section}\n\n{memos}\n\n## Galley Main Chat Entry Layer"
        )));
        assert!(!without.contains("### Memo"));
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("### Memo"));
            assert!(!prompt.contains("What you noted about the user"));
        }
    }

    /// Byte caps on the memo lines' own words (ticket 95), the memos'
    /// text not counted: that is bounded by characters
    /// ([`MEMO_TOTAL_MAX_CHARS`], 2,000), up to four bytes each. Two
    /// numbers, as the number of lines is not fixed: the head (the
    /// heading, when it was read and which commands read and change it,
    /// the line before the memos, and the last line with a four-digit
    /// count), and each memo's line around its text (its id, the day,
    /// `until` with a last day and its weekday). Measured on the longest
    /// they get, no headroom, `\r` not counted (the words are escaped
    /// `\n`, not raw strings, so a Windows checkout does not change them).
    /// A memo's line costs at most `MEMO_LINE_BUDGET_BYTES` on top of its
    /// text; twenty memos of a hundred characters come to about 1.3 KB of
    /// lines on top of 2,000 characters. Data, main chat only: outside
    /// the static budget and the prompt hash.
    const MEMO_HEAD_BUDGET_BYTES: usize = 322;
    const MEMO_LINE_BUDGET_BYTES: usize = 63;

    #[test]
    fn memo_lines_stay_within_budget() {
        let now = at("2026-10-26T01:05:00Z");
        let longest = memo(
            "memo_ffffffffffffffff",
            &"🏀".repeat(MEMO_TEXT_MAX_CHARS),
            "2026-10-26T01:02:00+00:00",
            Some("2026-12-31"),
        );
        let fit = MEMO_TOTAL_MAX_CHARS / MEMO_TEXT_MAX_CHARS;
        let tiny = memo(
            "memo_ffffffffffffffff",
            "🏀",
            "2026-10-26T01:02:00+00:00",
            Some("2026-12-31"),
        );
        for (memos, shown) in [
            (vec![longest; fit + 9_999], fit),
            (
                vec![tiny; MEMO_TOTAL_MAX_CHARS + 9_999],
                MEMO_TOTAL_MAX_CHARS,
            ),
        ] {
            let text = memo_section(&memos, now, &shanghai()).unwrap();
            let bytes = text.bytes().filter(|&byte| byte != b'\r').count();
            let lines = text.matches("\n- `memo_").count();
            assert_eq!(lines, shown);
            let texts: usize = memos[..shown].iter().map(|m| m.text.len()).sum();
            let words = bytes - texts;
            let budget = MEMO_HEAD_BUDGET_BYTES + lines * MEMO_LINE_BUDGET_BYTES;
            assert!(
                words <= budget,
                "memo lines are {words} bytes besides the memos' text ({lines} lines), budget \
                 {MEMO_HEAD_BUDGET_BYTES} + {lines} × {MEMO_LINE_BUDGET_BYTES} = {budget}"
            );
        }
        // Each line on its own.
        let one = memo_line(
            &memo(
                "memo_ffffffffffffffff",
                "x",
                "2026-10-26T01:02:00+00:00",
                Some("2026-12-31"),
            ),
            &shanghai(),
        );
        let line = format!("\n- {one}").len() - 1;
        assert!(
            line <= MEMO_LINE_BUDGET_BYTES,
            "a memo's line is {line} bytes besides its text"
        );
    }

    /// The `--around` read pairs with search in the static history
    /// commands, on both platforms (ticket 03b).
    #[test]
    fn history_lookup_shows_reading_a_hit_in_context() {
        assert!(RUNTIME_PROMPT_STATIC.contains("session show <id> --around=<messageId>"));
        assert!(RUNTIME_PROMPT_STATIC.contains("session show <id> --tail=20"));
        assert!(RUNTIME_PROMPT_STATIC.contains("This reaches every Galley session"));
    }

    #[test]
    fn state_block_stays_out_of_static_rules_and_hash() {
        assert!(!RUNTIME_PROMPT_STATIC.contains("## Galley State"));
        let hash_before = prompt_hash();
        let _ = compose_runtime_prompt("9.9.9");
        assert_eq!(prompt_hash(), hash_before);
    }

    /// 2026-09-09 incident: the model saved four files to `~/Downloads`,
    /// mentioned the directory once and listed bare filenames in a table,
    /// so none of them were click-to-open in the conversation. The rule
    /// is shared runtime behavior (workbench and IM alike).
    #[test]
    fn file_references_rule_asks_for_full_paths_on_every_surface() {
        for prompt in [
            compose_runtime_prompt("0.0.0-test"),
            compose_im_runtime_prompt("0.0.0-test"),
        ] {
            assert!(prompt.contains("## Files You Create"));
            assert!(prompt.contains("`~/Downloads/report.csv`"));
            assert!(prompt.contains("bare filename"));
        }
    }

    #[test]
    fn suggestion_mandate_is_workbench_only() {
        // The tag is consumed by the GUI composer alone; a mandate in the
        // IM composition leaks it verbatim into chat replies (2026-08-13
        // Discord/Feishu dogfood).
        let workbench = compose_runtime_prompt("0.0.0-test");
        assert!(workbench.contains("## Next-Step Suggestion"));
        assert!(workbench.contains("<next-suggestion>"));
        let im = compose_im_runtime_prompt("0.0.0-test");
        assert!(!im.contains("next-suggestion"));
        // Both variants still carry the shared runtime rules + state block.
        assert!(im.starts_with(RUNTIME_PROMPT_STATIC));
        assert!(im.contains("## Galley State"));
    }

    #[test]
    fn im_supervisor_prompt_names_current_platform() {
        let wechat = im_supervisor_prompt("/tmp/sop.md", "wechat", "galley-im/wechat");
        assert!(wechat.contains("## Galley IM Entry Layer"));
        assert!(wechat.contains("through WeChat"));

        let feishu = im_supervisor_prompt("/tmp/sop.md", "feishu", "galley-im/feishu");
        assert!(feishu.contains("through Feishu"));
        assert!(
            feishu.contains("are their Galley here: do what they ask yourself, with your tools.")
        );
    }

    /// IM keeps its own agent (2026-10-21, `.scratch/im-polish/` ruling 4):
    /// it shares GA's long-term memory with the desktop (the IM process runs
    /// in the managed state root) but not the desktop's conversations, and
    /// it has no hands for reminders, to-dos or scheduled tasks (those are
    /// the main chat's, see [`user_only_configuration!`]). The layer used to
    /// say "the same assistant as in Galley's desktop app", a promise the IM
    /// agent could not keep. Compared with and without on the IM channels'
    /// model before it went in (`.scratch/im-polish/entry-layer-eval/`).
    #[test]
    fn im_supervisor_prompt_says_what_it_shares_with_the_desktop() {
        for platform in ["wechat", "feishu", "telegram", "discord"] {
            let prompt = im_supervisor_prompt("/tmp/sop.md", platform, "galley-im/x");
            assert!(!prompt.contains("same assistant"));
            // Single-line fragments only: a Windows checkout makes the raw
            // string CRLF, so a substring spanning a line break fails there.
            assert!(prompt.contains("long-term memory with the desktop app, not its conversations"));
            assert!(prompt.contains("never act as if"));
            assert!(prompt.contains("you knew what they said there."));
            assert!(prompt.contains("Reminders, to-dos and scheduled tasks are not"));
            assert!(prompt.contains("set from here."));
            assert!(prompt.contains("assistant (助理); keep agents,"));
            assert!(prompt.contains("supervisors and other inner workings out of replies."));
        }
        // The layer leaves the lookup and where reminders are set to the
        // shared rules (the eval found them doing both without it), so
        // both must reach IM.
        let im = compose_im_runtime_prompt("t");
        assert!(im.contains("## Past Galley Conversations"));
        assert!(im.contains("ask the user to tell it in the Galley conversation atop the"));
    }

    #[test]
    fn im_supervisor_prompt_names_discord() {
        let discord = im_supervisor_prompt("/tmp/sop.md", "discord", "galley-im/discord");
        assert!(discord.contains("through Discord"));
    }

    #[test]
    fn im_supervisor_prompt_template_defers_only_the_supervisor_id() {
        let template = im_supervisor_prompt_template("/tmp/sop.md", "discord");
        assert!(template.contains(SUPERVISOR_ID_PLACEHOLDER));
        assert!(template.contains(&format!("--supervisor={SUPERVISOR_ID_PLACEHOLDER}")));
        // Substituting the placeholder must reproduce the rendered
        // prompt exactly — the two paths may never drift apart.
        let channel_id = im_supervisor_id("discord/ch:123");
        assert_eq!(
            template.replace(SUPERVISOR_ID_PLACEHOLDER, &channel_id),
            im_supervisor_prompt("/tmp/sop.md", "discord", &channel_id)
        );
    }

    #[test]
    fn im_supervisor_prompt_pins_supervisor_identity() {
        let id = im_supervisor_id("feishu");
        assert_eq!(id, "galley-im/feishu");
        let prompt = im_supervisor_prompt("/tmp/sop.md", "feishu", &id);
        assert!(prompt.contains("--supervisor=galley-im/feishu"));
        assert!(prompt.contains("report request"));
    }

    /// IM does the work itself, reached from a phone (2026-10-06, JC). The
    /// orchestration details (waits, session questions, reversibility,
    /// timeouts) live only in the Supervisor SOP, which the entry layer
    /// sends the agent to before its first CLI write. They used to be
    /// copied into the entry layer too and drifted behind the SOP once;
    /// one home now, checked here against the SOP Galley materializes.
    #[test]
    fn im_supervisor_prompt_defers_orchestration_details_to_the_sop() {
        let prompt = im_supervisor_prompt("/tmp/sop.md", "feishu", "galley-im/feishu");
        // Single-line fragments only: a Windows checkout makes the raw
        // string CRLF, so a substring spanning a line break fails there.
        assert!(prompt.contains("Before your first Galley"));
        assert!(prompt.contains("read the Galley Supervisor SOP at /tmp/sop.md"));
        for moved in ["--after-turn", "--until-idle", "askPending", "live.busy"] {
            assert!(!prompt.contains(moved), "{moved} belongs to the SOP only");
        }
        let sop = crate::sop_install::sop_body();
        for rule in [
            "--after-turn=<turnCount>",
            "--until-idle",
            "`askPending`",
            "dispatch:\"queued\"",
            "`live.busy`",
            "Timeout is not failure",
            "are reversible",
        ] {
            assert!(sop.contains(rule), "SOP lost: {rule}");
        }
    }

    /// 2026-09-30 context bloat (`.scratch/im-supervisor-context-bloat/`):
    /// a 12-character message made the supervisor run `sessions list
    /// --runtime all --all` (658 -> 28574 context chars). Status checks use
    /// the plain list.
    #[test]
    fn im_supervisor_prompt_checks_status_with_plain_sessions_list() {
        let prompt = im_supervisor_prompt("/tmp/sop.md", "discord", "galley-im/discord");
        assert!(prompt.contains("use plain `sessions list`"));
    }

    /// Replies are read on a phone: 7 of 21 IM final answers in the
    /// 2026-09-30 logs were tables. No platform gets its own note: WeChat's
    /// once lost link targets and `1.` numbers in upstream's `_strip_md`,
    /// which Galley's handler (`runner/im_wechat.py`) no longer calls.
    #[test]
    fn im_supervisor_prompt_shapes_replies_for_a_phone() {
        for platform in ["wechat", "feishu", "telegram", "discord"] {
            let prompt = im_supervisor_prompt("/tmp/sop.md", platform, "galley-im/x");
            assert!(prompt.contains("No tables"));
            assert!(prompt.contains("Open with the answer"));
            assert!(!prompt.contains("write URLs bare"));
        }
    }

    /// Byte cap on the IM entry layer, same rule as
    /// `STATIC_PROMPT_BUDGET_BYTES`: set with no headroom on the longest
    /// platform variant (Telegram, the longest channel name), measured on the
    /// template with an empty SOP path so the user's state-root path does not
    /// count. `\r` is not counted. 1503 at the 2026-10-06 slimming, when
    /// WeChat carried a link note; lowered when the 2026-10-10 WeChat pass
    /// dropped it, and again (1383 → 1376) when Goal left the CLI write
    /// list on 2026-10-13. Raised 1376 → 1630 on 2026-10-21, when the first
    /// paragraph stopped promising "the same assistant" and said what IM
    /// shares with the desktop and what it does not (`.scratch/im-polish/`
    /// ticket 02): +264 bytes for it, and back to no headroom (the layer
    /// had been 1366 bytes, 10 under the cap). JC took the shorter of the
    /// two tested wordings; the longer one (1738) repeated what the shared
    /// rules already make the model do.
    const IM_PROMPT_BUDGET_BYTES: usize = 1630;

    #[test]
    fn im_supervisor_prompt_stays_within_budget() {
        for platform in ["wechat", "feishu", "telegram", "discord"] {
            let len = im_supervisor_prompt_template("", platform)
                .bytes()
                .filter(|&byte| byte != b'\r')
                .count();
            assert!(
                len <= IM_PROMPT_BUDGET_BYTES,
                "{platform} IM prompt is {len} bytes, budget {IM_PROMPT_BUDGET_BYTES}: \
                 remove a clause first, or raise the budget with a reason"
            );
        }
    }
}
