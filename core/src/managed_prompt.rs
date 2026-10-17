//! Galley-owned managed GenericAgent prompt profile.
//!
//! This is product runtime behavior for Galley's bundled GA. It is embedded in
//! Core so it is versioned with the app, not treated as user-editable roleplay
//! content in the managed runtime resource directory.

use crate::api::schedule::{ScheduleTarget, ScheduledTaskRepeat};
use crate::api::TodoReminderState;
use crate::assistant_todo::{AssistantTodo, TodoCreator, TodoItem, TodoKind, TodoState};
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
macro_rules! user_only_configuration {
    () => {
        r#"Galley's configuration belongs to the user and changes only in Galley's
interface: model providers and API keys, Channels, Browser Control and its
browser extension, the runtime, updates, and display. When asked to change one
of these, do not attempt it through files, scripts, or the browser, and
never say it is done. Tell the user where it is, and prepare what they need:
the values to fill in. To-dos, reminders and scheduled tasks are kept by the
assistant, in the Galley conversation atop the sidebar: ask the user to tell
it there, and never say one is noted or set."#
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
/// [`in_hand_section`]) and the main chat entry layer, which names the
/// assistant manual at `manual_path` (ticket 30,
/// [`crate::assistant_manual`]). Its static rules differ from the
/// workbench's in one paragraph: scheduled tasks are no longer the
/// user's alone ([`MAIN_CHAT_USER_ONLY_CONFIGURATION`], ticket 36).
/// Every other session gets [`compose_runtime_prompt`].
pub(crate) fn compose_main_chat_runtime_prompt(
    app_version: &str,
    main_chat: &MainChatPromptState,
    in_hand: Option<&str>,
    manual_path: &str,
) -> String {
    compose(app_version, true, Some((main_chat, in_hand, manual_path)))
}

/// IM-supervisor variant: same runtime rules WITHOUT the suggestion
/// mandate. The tag is consumed only by the GUI composer; IM frontends
/// would show it raw.
pub(crate) fn compose_im_runtime_prompt(app_version: &str) -> String {
    compose(app_version, false, None)
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
/// when the last was said, so the model does not take something said
/// hours ago for something said just now; "earlier parts" then becomes
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
with {exchanges} from before it, the last said {at}: time has passed
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
        at = carried.last_said_at,
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
/// own in that comparison.
///
/// Ticket 30 (assistant PRD rulings 2, 3, 8) closed the loop: the
/// instructions also name the evidence to hand back, Galley wakes the
/// model when a subtask finishes, asks or fails (instead of "look it up
/// when they ask"), and a last paragraph sends the model to the assistant
/// manual at `manual_path` before its first CLI write. The manual carries
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
fn main_chat_entry_layer(manual_path: &str) -> String {
    format!(
        r#"{MAIN_CHAT_ENTRY_LAYER_HEAD}

Work that would keep this chat busy for a long time (many steps, several
websites, a long batch of files) goes to a subtask, so the main chat stays
free: end your reply with <subtask>what to do</subtask>. Galley starts it
after this reply, as a separate conversation that cannot see this one, so
write everything it needs: the goal, the facts the user gave, and what to
hand back, with the evidence for it (a confirmation number, a file path, a
link, a screenshot path). Tell the user in a sentence that it is on its way.
When it finishes, asks something or fails, Galley wakes you to check it and
tell the user, so do not wait on it or watch it. Do quick work yourself.
Use this, not the file-based subagent in your memory (subagent.md), which
the user cannot see.

Note what the user has to do (a deadline, a call, a flight, a purchase) as
a to-do, with a reminder when it has a date, and tick it off when it is
done; set yourself a reminder when you promise to follow up. Do it unasked,
and read `todo list` before saying what is left: see "To-dos and
reminders" in your manual.

Before your first Galley CLI write (a session, project, model, schedule or
to-do command), read your manual at `{manual_path}`."#
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
    main_chat: Option<(&MainChatPromptState, Option<&str>, &str)>,
) -> String {
    let static_rules = if main_chat.is_some() {
        main_chat_static_prompt()
    } else if with_suggestion {
        workbench_static_prompt()
    } else {
        RUNTIME_PROMPT_STATIC.to_string()
    };
    let main_chat = main_chat
        .map(|(state, in_hand, manual_path)| {
            let in_hand = in_hand
                .map(|lines| format!("\n\n{lines}"))
                .unwrap_or_default();
            format!(
                "\n\n{}{in_hand}\n\n{}",
                main_chat_section(state),
                main_chat_entry_layer(manual_path)
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

/// The main chat's static rules: the workbench's, with the configuration
/// paragraph of "What Only The User Changes In Galley" swapped for
/// [`MAIN_CHAT_USER_ONLY_CONFIGURATION`] (ticket 36). Like everything
/// only the main chat reads, outside `prompt_hash()`. Both paragraphs are
/// raw strings of this file, so a CRLF checkout changes them alike and
/// the swap still matches.
fn main_chat_static_prompt() -> String {
    workbench_static_prompt().replacen(
        USER_ONLY_CONFIGURATION,
        MAIN_CHAT_USER_ONLY_CONFIGURATION,
        1,
    )
}

/// At most this many lines per group in the main chat's "In Hand" block
/// ([`in_hand_section`]); the rest are counted on one more line.
const IN_HAND_MAX_PER_GROUP: usize = 5;

/// A to-do's title, a task's words or a subtask's title is cut at this
/// many characters in the "In Hand" block (`todo show`, `schedule show`
/// and `session brief` read all of it).
const IN_HAND_TEXT_CHARS: usize = 40;

/// Another agent's label is cut at this many characters.
const IN_HAND_AGENT_CHARS: usize = 24;

/// The main chat's "In Hand" lines (ticket 36, regrouped by ticket 39;
/// assistant PRD rulings 5 and 9, main chat PRD rulings 86 and 91): the
/// user's to-dos not done, what the main chat is on (its subtasks not
/// finished, then its one-off reminders and tasks to come) and the
/// routines, from the read behind the desktop's 「待办」
/// ([`crate::assistant_todo::assistant_todo`]) — its yours, Galley's and
/// routine groups, in its order ("what you see is what it sees"); the
/// done group stays out. Deterministic, no model call. Core writes it
/// into the main chat's state block at every runner spawn — each
/// segment's start, and a respawn mid-segment — so it is a snapshot: it
/// says when it was read, and which commands read it now (`todo list`
/// only when there are to-dos: without them the first line reads as it
/// did before ticket 39).
///
/// Bounded: [`IN_HAND_MAX_PER_GROUP`] lines per group, then "and N more";
/// titles and words cut at [`IN_HAND_TEXT_CHARS`] characters. `None` when
/// all three groups are empty: no section at all. Times are local (`tz`),
/// in the wake note's format (`2026-10-20 20:00 (Tue)`).
pub(crate) fn in_hand_section<Tz: chrono::TimeZone>(
    todo: &AssistantTodo,
    now: chrono::DateTime<chrono::Utc>,
    tz: &Tz,
) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    if todo.yours.is_empty() && todo.assistant.is_empty() && todo.routine.is_empty() {
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
/// time; `no due date`; `reminded …` once the reminder went off.
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
are the same assistant as in Galley's desktop app: do what they ask yourself,
with your tools.

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
            assert!(prompt.contains("in the Galley conversation atop the sidebar"));
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
    /// bar; to-dos in the redirect sentence) changed it by 0 bytes. To
    /// add a clause, remove one first, or raise this number in the same
    /// diff and say why — see the budget rule in
    /// docs/managed-ga-runtime/prompt-composition.md. Bytes, not tokens:
    /// there is no tokenizer in CI. `\r` is not counted: a Windows
    /// checkout (`core.autocrlf`) puts CRLF into the raw string literals.
    const STATIC_PROMPT_BUDGET_BYTES: usize = 6826;

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

    /// A manual path as Core passes it: absolute, with a space in it
    /// (`Application Support` on macOS).
    const MANUAL: &str =
        "/Users/u/Library/Application Support/app.galley/managed-ga-state/assistant/reference/galley-assistant-manual.md";

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
    /// the workbench's only in its configuration paragraph (ticket 36):
    /// every other workbench session gets the prompt it always had, and IM
    /// never carries it.
    #[test]
    fn main_chat_section_names_the_conversation_and_its_segment() {
        let state = main_chat_state();
        let ordinary = compose_runtime_prompt("t");
        let main = compose_main_chat_runtime_prompt("t", &state, None, MANUAL);
        assert_eq!(
            main,
            format!(
                "{}\n\n{}\n\n{}",
                ordinary.replacen(
                    USER_ONLY_CONFIGURATION,
                    MAIN_CHAT_USER_ONLY_CONFIGURATION,
                    1
                ),
                main_chat_section(&state),
                main_chat_entry_layer(MANUAL)
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
        let _ = compose_main_chat_runtime_prompt("t", &state, None, MANUAL);
        assert_eq!(prompt_hash(), hash);
    }

    /// Ticket 11: a segment that opens with turns carried over from
    /// before it says how many and when the last was said, and "earlier
    /// parts" becomes "anything older". Without carried turns the
    /// section reads exactly as 03b wrote it.
    #[test]
    fn main_chat_section_says_what_the_segment_carries_over() {
        let plain = main_chat_section(&main_chat_state());
        assert!(!plain.contains("from before it"));
        assert!(plain.contains("parts are not in your context"));

        let mut state = main_chat_state();
        state.carried = Some(CarriedPromptState {
            turns: 3,
            last_said_at: "2026-10-12 09:41".into(),
        });
        let carried = main_chat_section(&state);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(carried.contains("session `s-mgn4k2x1-7q3z9w0e`"));
        assert!(carried
            .contains("holds it from turnIndex 42 on, a segment that began 2026-10-12, and opens"));
        assert!(carried.contains(
            "with 3 exchanges from before it, the last said 2026-10-12 09:41: time has passed"
        ));
        assert!(carried.contains("Anything older is not in your context:"));
        assert!(!carried.contains("Earlier"));
        assert!(carried.contains("`session show <id> --around=<messageId>`"));

        state.carried = Some(CarriedPromptState {
            turns: 1,
            last_said_at: "2026-10-12 09:41".into(),
        });
        assert!(main_chat_section(&state).contains("with 1 exchange from before it, the last said"));
    }

    /// Byte cap on the main chat section, rendered with the longest
    /// values it takes in practice: a Core-minted session id (19
    /// characters until 2059; `mint_session_id`), a six-digit turn index,
    /// a date, and — since ticket 11 — the longer variant that says what
    /// the segment carries over, with the most turns it carries
    /// (`CARRY_TURNS`, one digit) and a minute-precise local time. No
    /// headroom, `\r` not counted. It rides every request of the main
    /// chat, and the static budget does not cover it. Raised from 327
    /// (03b; the variant without carried turns is unchanged) to 421 by
    /// ticket 11: +94 bytes for "and opens with N exchanges from before
    /// it, the last said <time>: time has passed since", with "Earlier
    /// parts … them" reworded to "Anything older … it". The count tells
    /// the model where the carried turns end; the time keeps it from
    /// reading a carried "I'm heading out" as said just now.
    const MAIN_CHAT_SECTION_BUDGET_BYTES: usize = 421;

    /// Ticket 03d: the entry layer follows the Main Chat section in the
    /// main chat and nowhere else.
    #[test]
    fn main_chat_entry_layer_is_main_chat_only() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), None, MANUAL);
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
        assert!(main.ends_with(&format!("read your manual at `{MANUAL}`.")));
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("Main Chat Entry Layer"));
        }
    }

    /// Ticket 06a: the entry layer ends with the dispatch clause — the
    /// tag Core reads ([`crate::subtask`]), what the instructions must
    /// carry, no waiting, and Galley's subtask over GA's file-based
    /// subagent. Main chat only, like the rest of the layer. Ticket 30:
    /// the instructions name the evidence to hand back, and Galley wakes
    /// the model instead of it looking the subtask up when asked.
    #[test]
    fn main_chat_entry_layer_dispatches_long_work_to_a_subtask() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), None, MANUAL);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains("free: end your reply with <subtask>what to do</subtask>. Galley"));
        assert!(main.contains("write everything it needs: the goal, the facts the user gave, and"));
        assert!(main.contains(
            "hand back, with the evidence for it (a confirmation number, a file path, a"
        ));
        assert!(main.contains(
            "When it finishes, asks something or fails, Galley wakes you to check it and"
        ));
        assert!(main
            .contains("tell the user, so do not wait on it or watch it. Do quick work yourself."));
        assert!(!main.contains("look it up when they ask"));
        assert!(main.contains("Use this, not the file-based subagent in your memory (subagent.md)"));
        let layer = main.find("Main Chat Entry Layer").unwrap();
        let clause = main.find("goes to a subtask").unwrap();
        assert!(layer < clause, "the clause closes the entry layer");
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("<subtask>"));
        }
    }

    /// Ticket 30: before its first CLI write the model reads the
    /// assistant manual, at the path Core wrote it to; every other
    /// session and IM never hear of it.
    #[test]
    fn main_chat_entry_layer_sends_the_model_to_the_manual() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), None, MANUAL);
        // Single-line fragments only (a Windows checkout makes the raw
        // string CRLF).
        assert!(main.contains(
            "Before your first Galley CLI write (a session, project, model, schedule or"
        ));
        assert!(main.contains("to-do command), read your manual at"));
        assert!(main.contains(&format!("read your manual at `{MANUAL}`.")));
        assert_eq!(main.matches(MANUAL).count(), 1);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("your manual"));
            assert!(!prompt.contains("galley-assistant-manual"));
        }
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
    /// opened for them.
    const MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES: usize = 2026;

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
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), None, MANUAL);
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
        assert!(!main.contains("never say one is noted or set"));
        // galley#31 and the capability rule stay for the main chat too.
        assert!(main.contains("never write `sche_tasks`"));
        assert!(main.contains("Do not"));
        assert!(
            main.contains("claim a capability you have not confirmed you have in this session.")
        );

        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            // Ruling 95: to-dos too, now that the panel opens beside
            // every conversation and the workbench has `galley todo`.
            assert!(prompt.contains(
                "the values to fill in. To-dos, reminders and scheduled tasks are kept by the"
            ));
            assert!(prompt.contains("it there, and never say one is noted or set."));
            assert!(!prompt.contains("Reminders and scheduled tasks are not on this list"));
            assert!(!prompt.contains("your manual"));
        }

        // The swap is the only difference, and it happened: the paragraph
        // is in the shared rules exactly once.
        assert_eq!(
            RUNTIME_PROMPT_STATIC
                .matches(USER_ONLY_CONFIGURATION)
                .count(),
            1
        );
        assert_ne!(main_chat_static_prompt(), workbench_static_prompt());
        assert_eq!(
            main_chat_static_prompt().replacen(
                MAIN_CHAT_USER_ONLY_CONFIGURATION,
                USER_ONLY_CONFIGURATION,
                1
            ),
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

    /// Ticket 36: the main chat's static rules are the shared ones with
    /// one paragraph swapped, and the swap may not make them longer than
    /// everyone's: they stay inside the static budget.
    #[test]
    fn main_chat_static_rules_stay_within_the_static_budget() {
        let len = main_chat_static_prompt()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        let shared = workbench_static_prompt()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(len <= shared, "main chat static {len} > shared {shared}");
        assert!(len <= STATIC_PROMPT_BUDGET_BYTES);
    }

    /// Tickets 36 and 41: the entry layer asks, unasked, for a to-do for
    /// what the user has to do (a reminder on it when it has a date), the
    /// tick when it is done, its own reminder for a follow-up it promises,
    /// and `todo list` before saying what is left; it names the manual's
    /// section, which exists. Main chat only.
    #[test]
    fn main_chat_entry_layer_asks_for_reminders_unasked() {
        let main = compose_main_chat_runtime_prompt("t", &main_chat_state(), None, MANUAL);
        // Single-line fragments only (CRLF on Windows).
        assert!(main.contains(
            "Note what the user has to do (a deadline, a call, a flight, a purchase) as"
        ));
        assert!(main
            .contains("a to-do, with a reminder when it has a date, and tick it off when it is"));
        assert!(main.contains(
            "done; set yourself a reminder when you promise to follow up. Do it unasked,"
        ));
        assert!(main.contains("and read `todo list` before saying what is left: see \"To-dos and"));
        assert!(main.contains("reminders\" in your manual."));
        assert!(!main.contains("Reminders and scheduled tasks\" in your manual"));
        assert!(crate::assistant_manual::manual_body().contains("## To-dos and reminders"));
        let layer = main.find("## Galley Main Chat Entry Layer").unwrap();
        let todo = main.find("Note what the user has to do").unwrap();
        let manual = main.find("read your manual at").unwrap();
        assert!(layer < todo && todo < manual);
        for prompt in [compose_runtime_prompt("t"), compose_im_runtime_prompt("t")] {
            assert!(!prompt.contains("set yourself a reminder"));
            assert!(!prompt.contains("`todo list`"));
        }
    }

    use crate::api::schedule::{ScheduleTarget, ScheduledTaskId, ScheduledTaskRepeat};
    use crate::api::todo::StoredDue;
    use crate::api::TodoReminder;
    use crate::assistant_todo::{
        AssistantTodo, TodoCreator, TodoItem, TodoKind, TodoState, YourTodos,
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
            cancelled_at: None,
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
        let text = in_hand_section(&todo, at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
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
            in_hand_section(&AssistantTodo::default(), now, &shanghai()),
            None
        );
        let only_done = AssistantTodo {
            done: vec![subtask("s-done", "做完的", TodoState::Done)],
            ..AssistantTodo::default()
        };
        assert_eq!(in_hand_section(&only_done, now, &shanghai()), None);

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
        let text = in_hand_section(&todo, now, &shanghai()).unwrap();
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
        let text = in_hand_section(&todo, now, &shanghai()).unwrap();
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
        let text = in_hand_section(&todo, now, &shanghai()).unwrap();
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
        let lines = in_hand_section(&todo, at("2026-10-16T06:05:00Z"), &shanghai()).unwrap();
        let without = compose_main_chat_runtime_prompt("t", &state, None, MANUAL);
        let with = compose_main_chat_runtime_prompt("t", &state, Some(&lines), MANUAL);
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
        let text = in_hand_section(&todo, now, &shanghai()).expect("lines");
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
        let text = in_hand_section(&todo, now, &shanghai()).expect("lines");
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
    }

    /// Byte cap on the "In Hand" lines (tickets 36 and 39), measured on
    /// the longest they get: five lines in each of the three groups, each
    /// with titles and words cut at the limit in three-byte characters —
    /// to-dos overdue, with a time and a paused reminder; one-off tasks
    /// paused with their time, set by an outside agent with a label past
    /// its cut, that start a conversation; routines the same with their
    /// next fire — and three-digit "more" counts. No headroom, `\r` not
    /// counted. Data, main chat only: outside the static budget and the
    /// prompt hash. Typical is far less (nothing at all when there is
    /// nothing in hand); fifteen lines cap what rides every request of a
    /// busy main chat.
    ///
    /// Ticket 39 raised it from 2467 to 4230 (ticket 36: two groups of
    /// five, tasks and subtasks). The same rule — five lines a group, cut
    /// at the same lengths — now covers three groups: the user's to-dos
    /// are new, and the tasks split between what the main chat is on (with
    /// its subtasks) and the routines. Fifteen lines instead of ten, a
    /// to-do's line (due date, overdue, reminder) about as long as a
    /// task's, and `todo list` named on the first line.
    const IN_HAND_BUDGET_BYTES: usize = 4230;

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
        let longest_todo = open_todo(
            "todo_ffffffffffffffff",
            &long,
            Some(StoredDue::At(at("2026-10-15T12:00:00Z"))),
            true,
            Some(("2026-10-20T12:00:00+00:00", TodoReminderState::Paused)),
        );
        let many = IN_HAND_MAX_PER_GROUP + 999;
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
        let len = in_hand_section(&todo, at("2026-10-16T06:05:00Z"), &shanghai())
            .unwrap()
            .bytes()
            .filter(|&byte| byte != b'\r')
            .count();
        assert!(
            len <= IN_HAND_BUDGET_BYTES,
            "In Hand lines are {len} bytes, budget {IN_HAND_BUDGET_BYTES}"
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
        assert!(feishu.contains("the same assistant as in Galley's desktop app"));
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

    /// IM is the same assistant reached from a phone (2026-10-06, JC). The
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
    /// list on 2026-10-13.
    const IM_PROMPT_BUDGET_BYTES: usize = 1376;

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
