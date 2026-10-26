//! Subtask reports: Core wakes the main chat when one of its subtasks
//! finished, asks or failed (main chat ticket 29,
//! `.scratch/main-chat/issues/29-subtask-wake-core.md`; assistant PRD
//! rulings 2 and 8, main chat PRD rulings 80 and 82).
//!
//! Before this the assistant handed work off and forgot it: the result
//! showed on the subtask's card, and the assistant looked only when the
//! user asked. Now each run of a subtask that ends is **reported** to its
//! main chat, which gets one turn (a **wake**) to check the result, send
//! the subtask back, answer its question, or tell the user.
//!
//! - **Which runs** ([`record_run_end`]): the drain task calls it for
//!   every run signal, before the queue step, while the run gate still
//!   says whether a run was open. Only a subtask the user never wrote in
//!   (a parent, not promoted) of the current main chat reports. How the
//!   run ended decides what ([`RunEnd`]): finished (with its final
//!   answer), asking (the question and its candidates), paused at the
//!   step limit (its last words), failed (`DONE_WITHOUT_EXIT` with the
//!   engine's error, or its runner exiting mid-run). A stopped run
//!   (`ABORTED`) is not reported — a person or the assistant stopped it —
//!   and neither is a slash command's (`SLASH_COMMAND_COMPLETED`: no work
//!   was done). A reply whose tags started nothing reports too, once
//!   ([`not_started_report`]).
//! - **Once**: a report is keyed by its subtask and the user message that
//!   started the run ([`SubtaskReport::key`]); a key is reported once per
//!   process. Reports wait in memory ([`SubtaskReports`]): a subtask runs
//!   inside Galley, so Galley quitting stops it too; what is lost is only
//!   a report waiting while Galley quits (ruling 8). A subtask's newer
//!   report replaces its older one still waiting.
//! - **When** ([`take_due`]): at once when the main chat is idle — its run
//!   gate free, nothing the user queued, no question of its own waiting —
//!   else after its run completes (the drain task asks again after the
//!   queue step, so the user's queued messages go first). While the main
//!   chat waits for the user's answer, any `user_message` would be taken
//!   as that answer, so reports wait and the desktop is told they could
//!   not be delivered ([`SUBTASK_REPORT_UNDELIVERED_EVENT`]).
//! - **What is sent** ([`deliver`]): with the run gate taken (never the
//!   visible queue), the waiting reports are read again — a subtask
//!   running again, its question answered, promoted or deleted drops out
//!   — and the rest go as one message ([`report_text`]): a visible user
//!   row in the main chat, origin `system` +
//!   [`SUBTASK_REPORT_SUPERVISOR`](crate::api::SUBTASK_REPORT_SUPERVISOR)
//!   with the subtask ids as its note ([`Origin::subtask_report`]), its
//!   replay form ([`replay_lines`]) as its `summary`, announced as
//!   `user-message-persisted`, dispatched on the shared runner path
//!   (segments included) as Core's send does. The page hides the row.
//! - **Not delivered**: when the runner does not start or does not take
//!   the message, the reports stay and are tried again on the main
//!   chat's next run signal or the next report; the desktop is told once
//!   per report, and falls back to the subtask's own notification.
//! - **Silent replies**: when the assistant only sent the subtask back or
//!   answered for the user, its reply is `<no-reply/>`, which the turn
//!   derivation strips (`turn_persistence::derive`); the raw reply keeps
//!   it, so the model sees it in its history.
//! - **Replay**: the main chat's replayed history shows a report as its
//!   replay lines, one per subtask ([`crate::subtask::mark_rows`]).
//!
//! Managed runtime only, and only for the main chat's subtasks: attach
//! mode has no main chat, and no other session has a parent.
//!
//! **Scheduled tasks** use the same pipeline (main chat ticket 33,
//! assistant PRD ruling 9):
//!
//! - A task that wakes the assistant (`target = assistant`) came due: a
//!   [`ReportOutcome::Due`] report carrying the words it noted, when it
//!   was planned for and when it went off. Unlike a subtask's report it
//!   is durable: the scheduler stamps the fire `last_wake = 'pending'` in
//!   `scheduled_tasks`, and [`restore_pending_reminders`] reads every
//!   pending fire back into the waiting reports — on every scheduler
//!   tick, so after a restart too. It is consumed only when delivered or
//!   when it could not be: while the main chat waits for the user's
//!   answer, when its runner does not start or take the message, or when
//!   the turn it woke ends on an error without a reply
//!   ([`record_wake_run_end`]). Then the desktop is told to notify with
//!   the task's own words ([`SCHEDULED_REMINDER_UNDELIVERED_EVENT`]) and
//!   it is not tried again.
//! - A session a task started (`target = session`) reports each run that
//!   ends, like a subtask, while the managed runtime has a main chat and
//!   nobody wrote in that session from an app (main chat PRD ruling 80).
//!   It stays an ordinary session in the sidebar.
//! - The **morning review** (main chat ticket 73,
//!   `crate::scheduler::fire_review`) travels as a due task, with words of
//!   its own ([`DueReminder::review`]): what it is, the part of the manual
//!   to read, at most two subtasks, silent unless something got done; since
//!   ticket 95, the memos new since the review before it, by id and text
//!   ([`DueReminder::memos`]), when there are any.
//!   Not delivered, it is dropped with no notification
//!   (`drop_review_wake`): its words are for the model, not the user.

use crate::api::schedule::{
    ReminderUndeliveredReason, ScheduledReminderUndelivered, ScheduledTaskBrief,
    ScheduledTaskRepeat, ScheduledWake, SCHEDULED_REMINDER_UNDELIVERED_EVENT,
    SCHEDULED_TASKS_CHANGED_EVENT,
};
use crate::api::{
    AskUserBrief, GalleyApi, MessageBrief, Origin, RuntimeKind, SessionBrief, SessionId,
    SubtaskDispatch, SubtaskFailure, SubtaskReportUndeliveredPayload,
    SUBTASK_REPORT_UNDELIVERED_EVENT,
};
use crate::db::{RunReply, SqliteGalley};
use crate::error::GalleyError;
use crate::ipc::{IpcCommand, UserMessageCommand};
use crate::notify::{notify, Notifier};
use crate::runner_manager::{RunSignal, RunState, RunnerManager};
use crate::session_runner::{
    ensure_session_runner, EnsureOptions, ReplayTimeouts, RunnerHost, SpawnEnv,
};
use crate::session_send::{UserMessagePersistedPayload, USER_MESSAGE_PERSISTED_EVENT};
use crate::socket_listener::RunnerPort;
use chrono::{DateTime, TimeZone};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};
use tauri::AppHandle;

/// `via` of the main chat's `runner-spawned-external` when a report
/// starts its runner.
pub const VIA_SUBTASK_REPORT: &str = "subtask-report";

/// A final answer (or last words) longer than this, in characters, is cut
/// in a report, which then says where to read all of it.
pub const REPORT_TEXT_MAX_CHARS: usize = 3_000;

/// From this many send-backs on, a report tells the assistant not to send
/// the subtask back again but to tell the user what it has (ticket 29).
/// Core refuses no send: the user may still ask for another try.
pub const SEND_BACK_LIMIT: u32 = 2;

// ---------------- wording ----------------
//
// For the model, in English. Ticket 30 evaluates this draft with a real
// model and may change the words; the structure stays.

const OPENING: &str = "[Galley — not a message from the user] A subtask you started has an update. Act on it, then reply to the user. Do not mention this note.";

const OPENING_REMINDER: &str = "[Galley — not a message from the user] A reminder you set came due. Act on it, then reply to the user. Do not mention this note.";

const OPENING_SCHEDULED: &str = "[Galley — not a message from the user] A scheduled task ran. Act on it, then reply to the user. Do not mention this note.";

const OPENING_MIXED: &str = "[Galley — not a message from the user] Things you are looking after have updates. Act on them, then reply to the user. Do not mention this note.";

const OPENING_REVIEW: &str = "[Galley — not a message from the user] It is time for the morning review. Act on it as below. Do not mention this note.";

/// From this much lateness on, a reminder's report says how late it is
/// and asks the assistant to say so (the computer slept, Galley was
/// closed). Less is on time: the scheduler ticks once a minute.
pub const LATE_AFTER_SECS: i64 = 120;

const CLOSING_MANY: &str = "Reply once, covering all of them.";

const NO_REPLY_END: &str = "end your reply with exactly <no-reply/>";

// ---------------- reports ----------------

/// How a subtask's run ended, with what its report says about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportOutcome {
    /// It finished; its final answer.
    Done { answer: String },
    /// It stopped on an `ask_user` question.
    Asking {
        question: String,
        candidates: Vec<String>,
    },
    /// It paused at the engine's step limit; the last thing it said.
    StepLimit { last_words: String },
    /// It stopped on an error; what went wrong.
    Error { detail: String },
    /// The tag started nothing, or its session's runner did not start.
    NotStarted { why: String },
    /// A scheduled task that wakes the assistant came due (ticket 33).
    Due(DueReminder),
}

/// A scheduled task that came due, as its report tells it. The times are
/// rendered when the report is made, in this machine's zone
/// ([`DueReminder::from_task`]), so the wording itself is pure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueReminder {
    pub task_id: String,
    /// What the assistant noted when it set the task.
    pub prompt: String,
    pub once: bool,
    /// The rule in words: `one-off`, `every day at 09:00`, …
    pub rule: String,
    /// The planned instant and when it went off, UTC ISO — the fire's
    /// identity in `scheduled_tasks` (`last_due_at`, `last_fired_at`).
    pub due_at: String,
    pub fired_at: String,
    /// The same two in local time, as people read them.
    pub due_local: String,
    pub fired_local: String,
    /// How late it went off, in words; `None` within [`LATE_AFTER_SECS`].
    pub late: Option<String>,
    /// The user's to-do it reminds of, when it is one's reminder (ticket
    /// 39): the wake then says it is the user's own thing to do.
    pub todo: Option<DueTodo>,
    /// The morning review (ticket 73,
    /// [`ScheduledTaskBrief::is_review`]): words of its own, and dropped
    /// silently when it cannot be delivered.
    pub review: bool,
    /// For the morning review (ticket 95, main chat PRD ruling 143 point
    /// 3): the memos noted or changed in turns the user started since the
    /// review before it (`crate::scheduler::review_wake_memos`), which its
    /// words name. Empty otherwise, and then the words are as before.
    pub memos: Vec<DueMemo>,
}

/// A memo the morning review's wake names (ticket 95): its id and its
/// text, read when the report is made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueMemo {
    pub id: String,
    pub text: String,
}

impl DueMemo {
    pub fn from_memo(memo: &crate::api::MemoBrief) -> Self {
        Self {
            id: memo.id.as_str().to_string(),
            text: memo.text.clone(),
        }
    }
}

/// The to-do a reminder is on, as its wake tells it (ticket 39). Read when
/// the report is made, so a title changed since the reminder was set
/// reads as it is now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueTodo {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    /// When it is due, local (`2026-10-21 15:00 (Wed)`, `2026-10-23
    /// (Fri)`); `None` for no due date.
    pub due: Option<String>,
}

impl DueTodo {
    /// The to-do as `tz` reads its due date.
    pub fn from_todo<Tz: TimeZone>(todo: &crate::api::TodoBrief, tz: &Tz) -> Self
    where
        Tz::Offset: std::fmt::Display,
    {
        Self {
            id: todo.id.as_str().to_string(),
            title: todo.title.clone(),
            notes: todo.notes.clone(),
            due: todo.stored_due().map(|due| due.words(tz)),
        }
    }
}

impl DueReminder {
    /// The report of `task`'s last fire, when it has one (`last_fired_at`;
    /// a fire without its planned instant counts as on time).
    pub fn from_task<Tz: TimeZone>(task: &ScheduledTaskBrief, tz: &Tz) -> Option<Self>
    where
        Tz::Offset: std::fmt::Display,
    {
        let fired_at = task.last_fired_at.clone()?;
        let due_at = task.last_due_at.clone().unwrap_or_else(|| fired_at.clone());
        let fired = DateTime::parse_from_rfc3339(&fired_at).ok()?;
        let due = DateTime::parse_from_rfc3339(&due_at).ok()?;
        let late_secs = fired.timestamp() - due.timestamp();
        Some(Self {
            task_id: task.id.as_str().to_string(),
            prompt: task.prompt.clone(),
            once: task.repeat.is_once(),
            rule: rule_words(&task.repeat, &task.time_of_day),
            due_local: local_words(&due.with_timezone(tz)),
            fired_local: local_words(&fired.with_timezone(tz)),
            late: (late_secs >= LATE_AFTER_SECS).then(|| lateness_words(late_secs)),
            due_at,
            fired_at,
            todo: None,
            review: task.is_review(),
            memos: Vec::new(),
        })
    }
}

/// `2026-10-20 20:00 (Tue)`.
fn local_words<Tz: TimeZone>(at: &DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    at.format("%Y-%m-%d %H:%M (%a)").to_string()
}

/// `3 minutes`, `2 hours 5 minutes`, `1 day 13 hours`.
pub fn lateness_words(secs: i64) -> String {
    fn unit(n: i64, one: &str) -> String {
        if n == 1 {
            format!("1 {one}")
        } else {
            format!("{n} {one}s")
        }
    }
    let minutes = secs.max(0) / 60;
    let (days, hours, mins) = (minutes / 1440, (minutes % 1440) / 60, minutes % 60);
    match (days, hours, mins) {
        (0, 0, m) => unit(m, "minute"),
        (0, h, 0) => unit(h, "hour"),
        (0, h, m) => format!("{} {}", unit(h, "hour"), unit(m, "minute")),
        (d, 0, _) => unit(d, "day"),
        (d, h, _) => format!("{} {}", unit(d, "day"), unit(h, "hour")),
    }
}

/// A rule in words, for the model.
fn rule_words(repeat: &ScheduledTaskRepeat, time_of_day: &str) -> String {
    fn days(list: &[u8]) -> String {
        list.iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    }
    const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    match repeat {
        ScheduledTaskRepeat::Once => "one-off".into(),
        ScheduledTaskRepeat::Daily => format!("every day at {time_of_day}"),
        ScheduledTaskRepeat::Weekly { weekdays } => {
            let names: Vec<&str> = weekdays
                .iter()
                .filter_map(|d| WEEKDAYS.get(usize::from(*d).wrapping_sub(1)).copied())
                .collect();
            format!("every {} at {time_of_day}", names.join(", "))
        }
        ScheduledTaskRepeat::Monthly { monthdays } => {
            format!("monthly on day {} at {time_of_day}", days(monthdays))
        }
    }
}

impl ReportOutcome {
    /// The outcome in a replay line.
    fn replay_phrase(&self) -> &'static str {
        match self {
            Self::Done { .. } => "finished",
            Self::Asking { .. } => "is asking",
            Self::StepLimit { .. } => "stopped at the step limit",
            Self::Error { .. } => "failed",
            Self::NotStarted { .. } => "could not be started",
            Self::Due(_) => "came due",
        }
    }
}

/// One subtask's report to its main chat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtaskReport {
    pub main_chat_id: String,
    /// `None` for a tag that started no session.
    pub subtask_id: Option<String>,
    /// The dispatch record's title (the instructions' first line).
    pub title: String,
    /// How many times the assistant sent it back
    /// ([`SqliteGalley::subtask_send_backs`]); the round is one more.
    pub send_backs: u32,
    pub outcome: ReportOutcome,
    /// Which end this reports, so it is reported once: the subtask and
    /// the turn of the user message that started the run
    /// (`<subtask>#<turn>`), or the tag (`<main>#<turn>#<ordinal>`); for a
    /// scheduled task's fire, `sched:<task>@<fired at>`.
    pub key: String,
    /// The scheduled task behind it (ticket 33): the task that came due
    /// ([`ReportOutcome::Due`]), or the task whose session this is — then
    /// `subtask_id` is that session, which is no subtask.
    pub scheduled_task_id: Option<String>,
}

impl SubtaskReport {
    fn round(&self) -> u32 {
        self.send_backs + 1
    }

    /// The due task, when this reports one.
    pub fn due(&self) -> Option<&DueReminder> {
        match &self.outcome {
            ReportOutcome::Due(due) => Some(due),
            _ => None,
        }
    }

    /// A report about a scheduled task's session (not a subtask's).
    fn is_scheduled_session(&self) -> bool {
        self.scheduled_task_id.is_some() && self.due().is_none()
    }

    /// The report of `task`'s last fire, for `main_chat_id`; `todo` is the
    /// to-do it reminds of, when it is one's reminder; `memos` the memos a
    /// morning review names (ticket 95).
    pub fn reminder(
        main_chat_id: &str,
        task: &ScheduledTaskBrief,
        todo: Option<DueTodo>,
        memos: Vec<DueMemo>,
    ) -> Option<Self> {
        let mut due = DueReminder::from_task(task, &chrono::Local)?;
        due.todo = todo;
        due.memos = memos;
        Some(Self {
            main_chat_id: main_chat_id.to_string(),
            subtask_id: None,
            title: task.prompt.clone(),
            send_backs: 0,
            key: format!("sched:{}@{}", due.task_id, due.fired_at),
            scheduled_task_id: Some(due.task_id.clone()),
            outcome: ReportOutcome::Due(due),
        })
    }
}

/// The message a wake sends: the opening, each report in turn, and — for
/// more than one — the closing.
pub fn report_text(reports: &[SubtaskReport]) -> String {
    let mut parts = vec![opening(reports).to_string()];
    parts.extend(reports.iter().map(report_paragraph));
    if reports.len() > 1 {
        parts.push(CLOSING_MANY.to_string());
    }
    parts.join("\n\n")
}

/// The opening for what the wake carries: one kind names it, a mix is
/// general.
fn opening(reports: &[SubtaskReport]) -> &'static str {
    let kind = |r: &SubtaskReport| {
        if r.due().is_some_and(|due| due.review) {
            OPENING_REVIEW
        } else if r.due().is_some() {
            OPENING_REMINDER
        } else if r.is_scheduled_session() {
            OPENING_SCHEDULED
        } else {
            OPENING
        }
    };
    let mut kinds = reports.iter().map(kind);
    let first = kinds.next().unwrap_or(OPENING);
    if kinds.all(|k| k == first) {
        first
    } else {
        OPENING_MIXED
    }
}

fn due_paragraph(due: &DueReminder) -> String {
    let id = &due.task_id;
    if due.review {
        return review_paragraph(due);
    }
    if let Some(todo) = &due.todo {
        return todo_due_paragraph(due, todo);
    }
    let what = if due.once {
        format!("Reminder `{id}` (one-off) came due.")
    } else {
        format!("Scheduled reminder `{id}` ({}) came due.", due.rule)
    };
    // Late: the lateness sits in the sentence the model acts on, and is
    // for the reply itself. Ticket 36's eval: the model put 「晚了 9 小时」
    // in GA's `<summary>`, which the main chat does not show, and the
    // reply only relayed the words (one run in three with "Tell the user
    // it comes late, and how late." after the times; two in two with
    // "say first", the summary being what comes first).
    //
    // What is of use now, not the words read back (ticket 63, main chat
    // PRD ruling 115): this note is what every wake has in front of it.
    // In ticket 60's eval one wake read only `wake.md` and the other read
    // nothing, while the rule was in `reminders.md`.
    let (when, act) = due_when_and_act(due);
    format!(
        "{what} {when} What you noted when you set it:\n<<<\n{}\n>>>\n\
         {act} tell the user what is of use to them now, in a sentence or two (not your \
         words read back), look something up first, or start a subtask. If it no longer \
         applies (the user already did it), {NO_REPLY_END}.",
        due.prompt.trim()
    )
}

/// The morning review came due (ticket 73, assistant PRD ruling 10). No
/// words of the model's own to act on, as Galley made the task: the note
/// says what it is, sends the model to the part of the manual that says
/// what to do (`wake.md`), and carries the two rules it acts on at once,
/// the limit on subtasks and when to stay silent. Late is not for the
/// user, who was promised nothing at 9:00: the times are there, with no
/// "say it comes late". Ticket 75 (ruling 10, the review goes unnoticed):
/// no fixed heading, and only what the user will want to know.
fn review_paragraph(due: &DueReminder) -> String {
    let id = &due.task_id;
    let when = match &due.late {
        None => format!("Planned for {}, local time.", due.due_local),
        Some(late) => format!(
            "Planned for {}, local time; it went off at {}, {late} late (the computer was \
             asleep or Galley was closed), which you need not mention.",
            due.due_local, due.fired_local
        ),
    };
    format!(
        "The morning review `{id}` ({}) came due. {when} Galley made this task, not you: once \
         a day, go over what is in hand. Read \"The morning review\" in `wake.md` in your \
         manual and do as it says: read `todo list`, `schedule list` and your running subtasks, \
         move forward what you can without being asked, and start at most two subtasks in all. \
         Speak only when you got something done the user will want to know, in one message, \
         in your own words, with no fixed heading. If you only started subtasks, write nothing \
         else for the user and {NO_REPLY_END}; if you did nothing, your whole reply is exactly \
         <no-reply/>.{}",
        due.rule,
        review_memos_paragraph(&due.memos)
    )
}

/// The memos a morning review names (ticket 95, main chat PRD ruling 143
/// point 3), after a blank line: each by id and text, on one line, and
/// what to ask of each, with the part of the manual that says more.
/// Nothing at all without memos: the wake reads as before.
fn review_memos_paragraph(memos: &[DueMemo]) -> String {
    if memos.is_empty() {
        return String::new();
    }
    let mut out = String::from(
        "\n\nMemos noted or changed since the last review, in turns the user started:",
    );
    for memo in memos {
        let text = memo.text.split_whitespace().collect::<Vec<_>>().join(" ");
        out.push_str(&format!("\n- `{}`: {text}", memo.id));
    }
    out.push_str(
        "\nFor each, ask whether there is something you could get done for the user that they \
         would want to know, as \"The morning review\" in `wake.md` says; most need nothing.",
    );
    out
}

/// The planned time, and how late it went off when it did (ticket 33's
/// words, unchanged), with the sentence the model acts on.
fn due_when_and_act(due: &DueReminder) -> (String, String) {
    match &due.late {
        None => (
            format!("Planned for {}, local time.", due.due_local),
            "Act on it now:".to_string(),
        ),
        Some(late) => (
            format!(
                "Planned for {}, local time; it went off at {}, {late} late (the computer was \
                 asleep or Galley was closed).",
                due.due_local, due.fired_local
            ),
            format!(
                "Act on it now, and say in the reply itself (the user does not see your \
                 summary) that it comes {late} late:"
            ),
        ),
    }
}

/// A reminder on one of the user's to-dos (ticket 39): which to-do, when
/// it is due, when the reminder was planned and went off — so the model
/// knows this is on the user's list, not something it noted for itself.
/// Ticket 63 (main chat PRD ruling 115): the list holds what is coming up
/// as well as what the user has to do (ruling 112: a renovation due to
/// finish), so the model says what is of use now (did it happen, what
/// next) instead of reminding them of the title, and still leaves the
/// to-do open until the user says it is done.
fn todo_due_paragraph(due: &DueReminder, todo: &DueTodo) -> String {
    let id = &due.task_id;
    let (when, act) = due_when_and_act(due);
    let body = match todo.notes.as_deref().map(str::trim) {
        Some(notes) if !notes.is_empty() => format!("{}\n{notes}", todo.title.trim()),
        _ => todo.title.trim().to_string(),
    };
    let due_line = match &todo.due {
        Some(at) => format!("It is due {at}, local time."),
        None => "It has no due date.".to_string(),
    };
    format!(
        "Reminder `{id}` on the user's to-do `{}` came due. {when} The to-do is on the user's \
         list, something to do or something coming up they want to hear about:\n\
         <<<\n{body}\n>>>\n{due_line} {act} tell the user what is of use to them now, in a \
         sentence or two (not the to-do read back: ask whether it is done or has happened, or \
         give the next step), look something up first, or start a subtask. Do not tick it off \
         until they say it is done or has happened. If it no longer applies (the user already \
         did it), {NO_REPLY_END}.",
        todo.id
    )
}

fn scheduled_session_paragraph(report: &SubtaskReport, id: &str) -> String {
    let task = report.scheduled_task_id.as_deref().unwrap_or_default();
    let title = &report.title;
    let subject = format!("Scheduled task `{task}` ran in session `{id}` (\"{title}\")");
    match &report.outcome {
        ReportOutcome::Done { answer } => format!(
            "{subject} and finished. Its final answer:\n<<<\n{}\n>>>\n\
             Tell the user the result in a sentence or two. The session stays in their \
             sidebar (`session show {id}`).",
            cut(answer, id)
        ),
        ReportOutcome::Asking {
            question,
            candidates,
        } => {
            let options = if candidates.is_empty() {
                String::new()
            } else {
                let quoted: Vec<String> = candidates.iter().map(|c| format!("\"{c}\"")).collect();
                format!(" Options: {}", quoted.join(", "))
            };
            format!(
                "{subject} and is asking: \"{question}\"{options}.\n\
                 Ask the user in a sentence, and pass their answer on with `session send {id} \
                 \"<answer>\" --supervisor=galley-assistant --reason=\"answer\" --ensure-runner` \
                 when they reply."
            )
        }
        ReportOutcome::StepLimit { .. } => format!(
            "{subject} and paused at the engine's step limit, mid-work. Tell the user how far it \
             got (`session show {id} --tail=40`)."
        ),
        ReportOutcome::Error { detail } => format!(
            "{subject} and stopped on an error: {}. Tell the user in a sentence what failed.",
            one_line(detail).trim_end_matches('.')
        ),
        ReportOutcome::NotStarted { why } => format!(
            "{subject} but could not be started: {}. Tell the user in a sentence.",
            one_line(why).trim_end_matches('.')
        ),
        ReportOutcome::Due(due) => due_paragraph(due),
    }
}

fn report_paragraph(report: &SubtaskReport) -> String {
    if let Some(due) = report.due() {
        return due_paragraph(due);
    }
    if let (true, Some(id)) = (report.is_scheduled_session(), report.subtask_id.as_deref()) {
        return scheduled_session_paragraph(report, id);
    }
    let title = &report.title;
    let round = report.round();
    let enough = report.send_backs >= SEND_BACK_LIMIT;
    let send_backs = report.send_backs;
    let Some(id) = report.subtask_id.as_deref() else {
        let ReportOutcome::NotStarted { why } = &report.outcome else {
            // Every other outcome comes from a session.
            return format!("A subtask \"{title}\" has an update.");
        };
        return not_started_paragraph(title, why);
    };
    let enough_said = format!(
        "It has been sent back {send_backs} times already: do not send it back again. \
         Tell the user what it found and what is still missing."
    );
    match &report.outcome {
        ReportOutcome::Done { answer } => {
            let next = if enough {
                enough_said
            } else {
                format!(
                    "If something is missing or wrong, send it back with \
                     `session send {id} \"<what is missing>\" --supervisor=galley-assistant \
                     --reason=\"send back\" --ensure-runner` and {NO_REPLY_END} and nothing \
                     else."
                )
            };
            format!(
                "Subtask `{id}` \"{title}\" (round {round}) finished. Its final answer:\n\
                 <<<\n{}\n>>>\n\
                 Check it against what you asked for in its instructions (its first \
                 message: `session show {id} --around=msg_{id}_0_user`; its last steps: \
                 `session show {id} --tail=40`). If it holds, \
                 tell the user the result in a sentence or two and name the evidence \
                 (a confirmation number, a file path, a link). {next}",
                cut(answer, id)
            )
        }
        ReportOutcome::Asking {
            question,
            candidates,
        } => {
            let options = if candidates.is_empty() {
                String::new()
            } else {
                let quoted: Vec<String> = candidates.iter().map(|c| format!("\"{c}\"")).collect();
                format!(" Options: {}", quoted.join(", "))
            };
            format!(
                "Subtask `{id}` \"{title}\" is asking: \"{question}\"{options}.\n\
                 If the user already told you the answer, or it plainly follows from what \
                 they asked for, answer with `session send {id} \"<answer>\" \
                 --supervisor=galley-assistant --reason=\"answer\" --ensure-runner` and \
                 {NO_REPLY_END}. \
                 If it involves money, sending something to someone, anything that cannot \
                 be undone, or something only the user has (a code sent to their phone, a \
                 password), ask the user in a sentence, and pass their answer on the same \
                 way when they reply."
            )
        }
        ReportOutcome::StepLimit { last_words } => {
            let said = if last_words.trim().is_empty() {
                String::new()
            } else {
                format!(
                    " The last thing it said:\n<<<\n{}\n>>>\n",
                    cut(last_words, id)
                )
            };
            let next = if enough {
                enough_said
            } else {
                format!(
                    "If it is getting somewhere, send it on with `session send {id} \
                     \"continue\" --supervisor=galley-assistant --reason=\"continue\" \
                     --ensure-runner` and {NO_REPLY_END}; this counts as a round. Otherwise \
                     tell the user how far it got."
                )
            };
            let sep = if said.is_empty() { " " } else { "" };
            format!(
                "Subtask `{id}` \"{title}\" (round {round}) paused at the engine's step limit, \
                 mid-work.{said}{sep}{next}"
            )
        }
        ReportOutcome::Error { detail } => format!(
            "Subtask `{id}` \"{title}\" stopped on an error: {}. Tell the user in a sentence \
             what failed and what you suggest. Do not start it again unless they ask.",
            one_line(detail).trim_end_matches('.')
        ),
        ReportOutcome::NotStarted { why } => not_started_paragraph(title, why),
        ReportOutcome::Due(due) => due_paragraph(due),
    }
}

fn not_started_paragraph(title: &str, why: &str) -> String {
    let subject = if title.is_empty() {
        "A subtask".to_string()
    } else {
        format!("The subtask \"{title}\"")
    };
    format!(
        "{subject} could not be started: {}. Tell the user in a sentence, and offer to try \
         again.",
        one_line(why).trim_end_matches('.')
    )
}

/// `text` within [`REPORT_TEXT_MAX_CHARS`]: its start, and where to read
/// all of it.
fn cut(text: &str, id: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        return "(nothing)".into();
    }
    if text.chars().count() <= REPORT_TEXT_MAX_CHARS {
        return text.to_string();
    }
    let kept: String = text.chars().take(REPORT_TEXT_MAX_CHARS).collect();
    format!("{kept}\n[… cut for length; all of it: `session show {id} --tail=1`]")
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// What the main chat's replayed history shows instead of a report
/// message: one line per subtask (stored as the row's `summary`).
pub fn replay_lines(reports: &[SubtaskReport]) -> String {
    reports
        .iter()
        .map(|report| {
            let phrase = report.outcome.replay_phrase();
            let title = &report.title;
            if let Some(due) = report.due() {
                let id = &due.task_id;
                if due.review {
                    return format!(
                        "[Galley: the morning review {id} came due ({}) — details: schedule \
                         show {id}]",
                        due.due_local
                    );
                }
                let on = due
                    .todo
                    .as_ref()
                    .map(|todo| format!(" for to-do {}", todo.id))
                    .unwrap_or_default();
                return match &due.late {
                    None => format!(
                        "[Galley: reminder {id}{on} came due ({}) — details: schedule show \
                         {id}]",
                        due.due_local
                    ),
                    Some(late) => format!(
                        "[Galley: reminder {id}{on} came due (planned {}, went off {}, {late} \
                         late) — details: schedule show {id}]",
                        due.due_local, due.fired_local
                    ),
                };
            }
            if let (true, Some(id), Some(task)) = (
                report.is_scheduled_session(),
                report.subtask_id.as_deref(),
                report.scheduled_task_id.as_deref(),
            ) {
                return format!(
                    "[Galley: scheduled task {task} ran in session {id} \"{title}\": {phrase} — \
                     details: session show {id}]"
                );
            }
            match (&report.subtask_id, title.is_empty()) {
                (Some(id), _) => format!(
                    "[Galley: subtask {id} \"{title}\" {phrase} — details: session show {id}]"
                ),
                (None, false) => format!("[Galley: subtask \"{title}\" {phrase}]"),
                (None, true) => format!("[Galley: a subtask {phrase}]"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The replay form of a report row without its stored lines: one line
/// per subtask id in its note.
pub fn replay_fallback(origin_note: Option<&str>) -> String {
    let lines: Vec<String> = origin_note
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| {
            if id.starts_with("sched_") {
                format!("[Galley: scheduled task {id} came due — details: schedule show {id}]")
            } else {
                format!("[Galley: subtask {id} has an update — details: session show {id}]")
            }
        })
        .collect();
    if lines.is_empty() {
        "[Galley: a subtask has an update]".into()
    } else {
        lines.join("\n")
    }
}

// ---------------- how a run ended ----------------

/// How a subtask's run ended, as far as the run gate tells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnd {
    Done,
    Asking,
    StepLimit,
    /// `DONE_WITHOUT_EXIT`: the engine's task ended without an exit,
    /// after a runtime error.
    NoExit,
    /// The runner exited while a run was open.
    RunnerExited,
}

/// The end a run signal reports, read before the queue step: `state` is
/// the session's run state with the gate still as the run left it. `None`
/// for nothing to report — a stopped run, a slash command, a runner that
/// closed with no run open.
pub fn run_end(signal: &RunSignal, state: &RunState) -> Option<RunEnd> {
    if matches!(signal, RunSignal::Closed { .. }) {
        return state.open_run.then_some(RunEnd::RunnerExited);
    }
    match state.last_exit.as_deref() {
        Some("ABORTED") | Some("SLASH_COMMAND_COMPLETED") => None,
        _ if state.ask_pending => Some(RunEnd::Asking),
        Some("MAX_TURNS_EXCEEDED") => Some(RunEnd::StepLimit),
        Some("DONE_WITHOUT_EXIT") => Some(RunEnd::NoExit),
        _ => Some(RunEnd::Done),
    }
}

/// What a reply said last: the final answer of a final step, else the
/// text before a step's tool call — the latest that is not empty.
fn last_words(rows: &[RunReply]) -> String {
    rows.iter()
        .rev()
        .find_map(|row| {
            let text = if crate::subtask::is_final_answer(row.tool_calls.as_deref()) {
                row.final_answer.as_deref()
            } else {
                row.preamble.as_deref().or(row.final_answer.as_deref())
            };
            text.map(str::trim).filter(|t| !t.is_empty())
        })
        .unwrap_or_default()
        .to_string()
}

/// The question the run stopped on: the latest `ask_user` call, else its
/// last words.
fn asked(rows: &[RunReply]) -> (String, Vec<String>) {
    rows.iter()
        .rev()
        .find_map(|row| {
            row.tool_calls
                .as_deref()
                .and_then(AskUserBrief::from_tool_calls_json)
        })
        .map(|ask| (ask.question, ask.candidates))
        .unwrap_or_else(|| (last_words(rows), Vec::new()))
}

/// The report of `session_id`'s run that ended as `end`, when the session
/// is a subtask of the current main chat the user never wrote in, or a
/// session a scheduled task started ([`scheduled_session_report`]).
pub async fn report_for_run_end(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    session_id: &str,
    end: RunEnd,
) -> Result<Option<SubtaskReport>, GalleyError> {
    let sid = SessionId(session_id.to_string());
    let session = match galley.session_brief(sid.clone()).await {
        Ok(session) => session,
        Err(GalleyError::NotFound { .. }) => return Ok(None),
        Err(e) => return Err(e),
    };
    let Some(parent) = session.parent_session_id.clone() else {
        return scheduled_session_report(galley, runner, &session, end).await;
    };
    if session.promoted == Some(true) {
        return Ok(None);
    }
    match galley.main_chat_id().await? {
        Some(main) if main.as_str() == parent => {}
        _ => return Ok(None),
    }
    let (title, send_backs) = match galley.subtask_dispatch_for_session(&sid).await? {
        Some(dispatch) => (dispatch.title, dispatch.send_backs),
        None => (
            session.title.clone(),
            galley.subtask_send_backs(&sid).await?,
        ),
    };
    let turn = galley
        .latest_user_turn_index(session_id)
        .await?
        .unwrap_or(-1);
    let outcome = run_outcome(galley, runner, session_id, end).await?;
    Ok(Some(SubtaskReport {
        main_chat_id: parent,
        subtask_id: Some(session_id.to_string()),
        title,
        send_backs,
        outcome,
        key: format!("{session_id}#{turn}"),
        scheduled_task_id: None,
    }))
}

/// The report of a run of a session a scheduled task started
/// (`target = session`, ticket 33, main chat PRD ruling 80): while the
/// managed runtime is active and has a main chat, the session is a
/// managed one, and nobody wrote in it from an app — once someone did,
/// it is theirs. The task is read off the session's origin, which the
/// scheduler stamps ([`crate::scheduler::SCHEDULER_SUPERVISOR`]).
async fn scheduled_session_report(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    session: &SessionBrief,
    end: RunEnd,
) -> Result<Option<SubtaskReport>, GalleyError> {
    let Some(task_id) = session
        .origin
        .as_ref()
        .filter(|o| o.supervisor.as_deref() == Some(crate::scheduler::SCHEDULER_SUPERVISOR))
        .and_then(|o| o.reason.as_deref())
        .and_then(crate::scheduler::task_id_from_reason)
        .map(str::to_string)
    else {
        return Ok(None);
    };
    if session.ga_runtime_kind != RuntimeKind::Managed
        || galley.active_runtime_kind().await? != RuntimeKind::Managed
    {
        return Ok(None);
    }
    let Some(main) = galley.main_chat_id().await? else {
        return Ok(None);
    };
    if galley.has_user_written(&session.id).await? {
        return Ok(None);
    }
    let session_id = session.id.as_str();
    let title = match galley.scheduled_task(&task_id).await {
        Ok(task) => task.prompt,
        Err(_) => session.title.clone(),
    };
    let turn = galley
        .latest_user_turn_index(session_id)
        .await?
        .unwrap_or(-1);
    let outcome = run_outcome(galley, runner, session_id, end).await?;
    Ok(Some(SubtaskReport {
        main_chat_id: main.0,
        subtask_id: Some(session_id.to_string()),
        title,
        send_backs: 0,
        outcome,
        key: format!("{session_id}#{turn}"),
        scheduled_task_id: Some(task_id),
    }))
}

/// What a run of `session_id` that ended as `end` says.
async fn run_outcome(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    session_id: &str,
    end: RunEnd,
) -> Result<ReportOutcome, GalleyError> {
    let rows = galley
        .latest_run_replies(&SessionId(session_id.to_string()))
        .await?;
    Ok(match end {
        RunEnd::Done => ReportOutcome::Done {
            answer: last_words(&rows),
        },
        RunEnd::Asking => {
            let (question, candidates) = asked(&rows);
            ReportOutcome::Asking {
                question,
                candidates,
            }
        }
        RunEnd::StepLimit => ReportOutcome::StepLimit {
            last_words: last_words(&rows),
        },
        RunEnd::NoExit => ReportOutcome::Error {
            detail: runner
                .last_run_error(session_id)
                .await
                .unwrap_or_else(|| "the engine ended the run without finishing it".into()),
        },
        RunEnd::RunnerExited => ReportOutcome::Error {
            detail: "its engine process exited before the run finished".into(),
        },
    })
}

/// The report of a tag that started nothing, or whose session's runner
/// did not start; `None` for a dispatch that started.
pub fn not_started_report(dispatch: &SubtaskDispatch) -> Option<SubtaskReport> {
    let failure = dispatch.failure?;
    let why = match (failure, dispatch.failure_detail.as_deref()) {
        (SubtaskFailure::Empty, _) => "the tag was empty".to_string(),
        (SubtaskFailure::Unclosed, _) => "the tag was not closed".to_string(),
        (SubtaskFailure::StartFailed, Some(detail)) if !detail.trim().is_empty() => {
            one_line(detail)
        }
        (SubtaskFailure::StartFailed, _) => "it failed to start".to_string(),
    };
    Some(SubtaskReport {
        main_chat_id: dispatch.parent_session_id.clone(),
        subtask_id: dispatch.session_id.clone(),
        title: dispatch.title.clone(),
        send_backs: 0,
        outcome: ReportOutcome::NotStarted { why },
        key: format!(
            "{}#{}#{}",
            dispatch.parent_session_id, dispatch.turn_index, dispatch.ordinal
        ),
        scheduled_task_id: None,
    })
}

// ---------------- waiting reports ----------------

#[derive(Debug, Clone)]
struct Waiting {
    report: SubtaskReport,
    /// The desktop was told this report could not be delivered.
    announced: bool,
}

#[derive(Default)]
struct State {
    /// Per main chat, oldest first.
    waiting: HashMap<String, Vec<Waiting>>,
    /// Keys reported in this process.
    seen: HashSet<String>,
    /// Per main chat, the due tasks a delivered wake carried, until the
    /// turn it started ends ([`record_wake_run_end`]).
    in_flight: HashMap<String, Vec<SubtaskReport>>,
}

/// The reports waiting for their main chat, in memory. One per process,
/// owned by the drain task (`crate::message_queue`).
#[derive(Default)]
pub struct SubtaskReports {
    state: Mutex<State>,
}

impl SubtaskReports {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keep `report` for its main chat, replacing the same subtask's
    /// earlier one. `false` when its end was reported before.
    pub fn add(&self, report: SubtaskReport) -> bool {
        let mut state = self.lock();
        if !state.seen.insert(report.key.clone()) {
            return false;
        }
        let waiting = state
            .waiting
            .entry(report.main_chat_id.clone())
            .or_default();
        if let Some(id) = &report.subtask_id {
            waiting.retain(|w| w.report.subtask_id.as_ref() != Some(id));
        }
        // A task's newer fire replaces its older one still waiting.
        if let Some(task) = report.due().map(|d| d.task_id.clone()) {
            waiting.retain(|w| w.report.due().map(|d| &d.task_id) != Some(&task));
        }
        waiting.push(Waiting {
            report,
            announced: false,
        });
        true
    }

    /// The reports waiting for `main_chat_id`, oldest first.
    pub fn waiting(&self, main_chat_id: &str) -> Vec<SubtaskReport> {
        self.lock()
            .waiting
            .get(main_chat_id)
            .map(|list| list.iter().map(|w| w.report.clone()).collect())
            .unwrap_or_default()
    }

    fn has_waiting(&self, main_chat_id: &str) -> bool {
        self.lock()
            .waiting
            .get(main_chat_id)
            .is_some_and(|list| !list.is_empty())
    }

    fn take(&self, main_chat_id: &str) -> Vec<Waiting> {
        self.lock().waiting.remove(main_chat_id).unwrap_or_default()
    }

    /// Take the due tasks waiting for `main_chat_id`, leaving the rest.
    fn take_due_tasks(&self, main_chat_id: &str) -> Vec<SubtaskReport> {
        let mut state = self.lock();
        let Some(list) = state.waiting.get_mut(main_chat_id) else {
            return Vec::new();
        };
        let (due, rest): (Vec<Waiting>, Vec<Waiting>) =
            list.drain(..).partition(|w| w.report.due().is_some());
        *list = rest;
        due.into_iter().map(|w| w.report).collect()
    }

    fn set_in_flight(&self, main_chat_id: &str, reports: Vec<SubtaskReport>) {
        let mut state = self.lock();
        if reports.is_empty() {
            state.in_flight.remove(main_chat_id);
        } else {
            state.in_flight.insert(main_chat_id.to_string(), reports);
        }
    }

    fn take_in_flight(&self, main_chat_id: &str) -> Vec<SubtaskReport> {
        self.lock()
            .in_flight
            .remove(main_chat_id)
            .unwrap_or_default()
    }

    /// The due tasks a delivered wake carried whose turn has not ended.
    pub fn in_flight(&self, main_chat_id: &str) -> Vec<SubtaskReport> {
        self.lock()
            .in_flight
            .get(main_chat_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Put reports back after a failed delivery, ahead of any that came
    /// in meanwhile — except a subtask's that a newer one replaced.
    fn restore(&self, main_chat_id: &str, back: Vec<Waiting>) {
        let mut state = self.lock();
        let waiting = state.waiting.entry(main_chat_id.to_string()).or_default();
        let newer: HashSet<String> = waiting
            .iter()
            .filter_map(|w| w.report.subtask_id.clone())
            .collect();
        let mut merged: Vec<Waiting> = back
            .into_iter()
            .filter(|w| {
                w.report
                    .subtask_id
                    .as_ref()
                    .is_none_or(|id| !newer.contains(id))
            })
            .collect();
        merged.append(waiting);
        *waiting = merged;
    }

    /// Mark the waiting reports of `main_chat_id` as announced
    /// undelivered; the subtask ids not announced before.
    fn announce_waiting(&self, main_chat_id: &str) -> Vec<String> {
        let mut state = self.lock();
        match state.waiting.get_mut(main_chat_id) {
            Some(list) => mark_announced(list),
            None => Vec::new(),
        }
    }
}

fn mark_announced(list: &mut [Waiting]) -> Vec<String> {
    list.iter_mut()
        .filter(|w| !w.announced)
        .filter_map(|w| {
            w.announced = true;
            w.report.subtask_id.clone()
        })
        .collect()
}

fn announce_undelivered(notifier: &dyn Notifier, main_chat_id: &str, subtask_ids: Vec<String>) {
    if subtask_ids.is_empty() {
        return;
    }
    eprintln!(
        "[subtask-report {main_chat_id}] not delivered: {}",
        subtask_ids.join(", ")
    );
    notify(
        notifier,
        SUBTASK_REPORT_UNDELIVERED_EVENT,
        &SubtaskReportUndeliveredPayload {
            main_chat_id: main_chat_id.to_string(),
            subtask_ids,
        },
    );
}

// ---------------- recording ----------------

/// The drain task's hook for a run signal, called before the queue step:
/// a subtask's run that ended is reported to its main chat. Returns that
/// main chat when a report was added, for the caller to wake once the
/// queue step is done ([`take_due`]).
pub async fn record_run_end(
    reports: &SubtaskReports,
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    signal: &RunSignal,
) -> Option<String> {
    let session_id = match signal {
        RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => session_id,
    };
    let state = runner.run_state(session_id).await;
    let end = run_end(signal, &state)?;
    match report_for_run_end(galley, runner, session_id, end).await {
        Ok(Some(report)) => {
            let main = report.main_chat_id.clone();
            reports.add(report).then_some(main)
        }
        Ok(None) => None,
        Err(e) => {
            eprintln!("[subtask-report {session_id}] reading the run that ended failed: {e}");
            None
        }
    }
}

/// Report the dispatches of a reply that started nothing. Returns the
/// main chat to wake when any was added.
pub fn record_not_started(
    reports: &SubtaskReports,
    dispatches: &[SubtaskDispatch],
) -> Option<String> {
    let mut main = None;
    for report in dispatches.iter().filter_map(not_started_report) {
        let parent = report.main_chat_id.clone();
        if reports.add(report) {
            main = Some(parent);
        }
    }
    main
}

// ---------------- waking ----------------

/// A wake whose run gate is taken: the reports it carries.
#[derive(Debug)]
pub struct WakeJob {
    main_chat_id: String,
    reports: Vec<Waiting>,
}

impl WakeJob {
    pub fn main_chat_id(&self) -> &str {
        &self.main_chat_id
    }
}

/// What [`deliver`] did.
#[derive(Debug)]
pub enum WakeOutcome {
    /// The report message was written and dispatched.
    Delivered {
        message: MessageBrief,
        /// The subtasks it covers (also its `origin.reason`).
        subtask_ids: Vec<String>,
        /// The reports it carries, in order.
        reports: Vec<SubtaskReport>,
    },
    /// Read again, none was still worth reporting; nothing was sent.
    NothingLeft,
    /// Not delivered: the reports wait for the next try.
    Failed(String),
}

/// Take `main_chat_id`'s run gate for its waiting reports, when it has
/// any and is idle. While it waits for the user's answer the reports
/// stay, and the desktop is told they could not be delivered — except a
/// due task's, which is consumed and handed to a notification instead
/// ([`return_due_tasks`]). `None` when there is nothing to send now.
pub async fn take_due(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main_chat_id: &str,
) -> Option<WakeJob> {
    if !reports.has_waiting(main_chat_id) {
        return None;
    }
    // A question of the main chat's own is waiting: a message now would
    // be its answer. A run cannot start while the gate is free, so the
    // flag holds until the reservation below.
    if host.runner.run_state(main_chat_id).await.ask_pending {
        return_due_tasks(
            host.galley,
            host.notifier.as_ref(),
            reports.take_due_tasks(main_chat_id),
            ReminderUndeliveredReason::Asking,
        )
        .await;
        announce_undelivered(
            host.notifier.as_ref(),
            main_chat_id,
            reports.announce_waiting(main_chat_id),
        );
        return None;
    }
    // Busy, or the user's queued messages go first: the next run signal
    // asks again.
    if !host.runner.queue_try_reserve(main_chat_id).await {
        return None;
    }
    let taken = reports.take(main_chat_id);
    if taken.is_empty() {
        host.runner.queue_release_run(main_chat_id).await;
        return None;
    }
    Some(WakeJob {
        main_chat_id: main_chat_id.to_string(),
        reports: taken,
    })
}

/// Send the wake `job` carries, with its run gate held: read the reports
/// again, then ensure the main chat's runner, write the message and
/// dispatch it. Every way out but delivery releases the gate; a failure
/// keeps the reports for the next try and tells the desktop, except due
/// tasks, which are consumed and handed to a notification. Due tasks
/// that went out wait for the turn they start ([`record_wake_run_end`]).
pub async fn deliver(reports: &SubtaskReports, host: &RunnerHost<'_>, job: WakeJob) -> WakeOutcome {
    let WakeJob {
        main_chat_id: main,
        reports: taken,
    } = job;
    let due = still_due(host, &main, taken).await;
    if due.is_empty() {
        host.runner.queue_release_run(&main).await;
        return WakeOutcome::NothingLeft;
    }
    let carried: Vec<SubtaskReport> = due.iter().map(|w| w.report.clone()).collect();
    let subtask_ids: Vec<String> = carried
        .iter()
        .filter_map(|r| r.subtask_id.clone())
        .collect();
    // The row's note names every session and every due task it covers.
    let note_ids: Vec<String> = carried
        .iter()
        .filter_map(|r| {
            r.subtask_id
                .clone()
                .or_else(|| r.due().map(|d| d.task_id.clone()))
        })
        .collect();
    let due_tasks: Vec<SubtaskReport> = carried
        .iter()
        .filter(|r| r.due().is_some())
        .cloned()
        .collect();
    let text = report_text(&carried);

    // The shared runner path, as Core's send: the segment rule, a runner
    // with the main chat's history. Before the message is written, so the
    // idle gap is measured to the last message before it and a runner that
    // cannot start leaves no row behind.
    if let Err(e) = ensure_session_runner(
        host,
        &main,
        EnsureOptions {
            via: VIA_SUBTASK_REPORT,
            active_session_id: Some(&main),
            llm_override: None,
            ga_config: None,
            holds_run_gate: true,
            timeouts: ReplayTimeouts::default(),
        },
    )
    .await
    {
        return keep_for_later(reports, host, &main, due, format!("{e:?}")).await;
    }
    let message = match host
        .galley
        .persist_subtask_report(
            &SessionId(main.clone()),
            text.clone(),
            Origin::subtask_report(&note_ids),
            &replay_lines(&carried),
        )
        .await
    {
        Ok(message) => message,
        Err(e) => return keep_for_later(reports, host, &main, due, e.to_string()).await,
    };
    announce_message(host, &main, &message, "pending");
    // Before the dispatch, so the turn's end cannot outrun it.
    reports.set_in_flight(&main, due_tasks);
    let dispatched = host
        .runner
        .send_command(
            &main,
            &IpcCommand::UserMessage(UserMessageCommand {
                text,
                images: Vec::new(),
                visibility: None,
                absolute_turn_index: message.turn_index.map(i64::from),
            }),
        )
        .await;
    if let Err(e) = dispatched {
        reports.set_in_flight(&main, Vec::new());
        announce_message(host, &main, &message, "persisted_only");
        return keep_for_later(reports, host, &main, due, e.to_string()).await;
    }
    announce_message(host, &main, &message, "dispatched");
    eprintln!(
        "[subtask-report {main}] woke the main chat for {} report(s)",
        carried.len()
    );
    WakeOutcome::Delivered {
        message,
        subtask_ids,
        reports: carried,
    }
}

/// [`take_due`] then [`deliver`], in the caller's task.
pub async fn wake_if_due(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main_chat_id: &str,
) -> Option<WakeOutcome> {
    let job = take_due(reports, host, main_chat_id).await?;
    Some(deliver(reports, host, job).await)
}

/// The drain task's wake: the run gate is taken here, in signal order
/// (after the queue step), and the delivery — which may start a runner —
/// runs in the background, so it never holds up other sessions' queues.
pub async fn spawn_wake_if_due(
    reports: &Arc<SubtaskReports>,
    galley: &SqliteGalley,
    manager: &Arc<RunnerManager>,
    notifier: &Arc<dyn Notifier>,
    app: Option<&AppHandle>,
    main_chat_id: &str,
) {
    let job = {
        let host = RunnerHost {
            galley,
            runner: manager.as_ref(),
            notifier: notifier.clone(),
            env: app.map(|app| app as &dyn SpawnEnv),
        };
        take_due(reports, &host, main_chat_id).await
    };
    let Some(job) = job else {
        return;
    };
    let reports = reports.clone();
    let galley = galley.clone();
    let manager = manager.clone();
    let notifier = notifier.clone();
    let app = app.cloned();
    // `tauri::async_runtime::spawn`, like the drain task itself: no
    // ambient tokio runtime is guaranteed where Core's tasks start.
    tauri::async_runtime::spawn(async move {
        let host = RunnerHost {
            galley: &galley,
            runner: manager.as_ref(),
            notifier,
            env: app.as_ref().map(|app| app as &dyn SpawnEnv),
        };
        let main = job.main_chat_id().to_string();
        if let WakeOutcome::Failed(why) = deliver(&reports, &host, job).await {
            eprintln!("[subtask-report {main}] wake failed, kept for the next try: {why}");
        }
    });
}

/// The reports still worth sending, read again with the gate held: the
/// main chat must still be the main chat; a subtask that is running
/// again, whose question was answered, that the user promoted or that
/// was deleted drops out; so does a due task cancelled or fired again
/// since. Due tasks for a main chat that is gone are consumed and handed
/// to a notification.
async fn still_due(host: &RunnerHost<'_>, main: &str, taken: Vec<Waiting>) -> Vec<Waiting> {
    match host.galley.main_chat_id().await {
        Ok(Some(id)) if id.as_str() == main => {}
        Ok(_) => {
            let due_tasks = taken
                .into_iter()
                .map(|w| w.report)
                .filter(|r| r.due().is_some())
                .collect();
            return_due_tasks(
                host.galley,
                host.notifier.as_ref(),
                due_tasks,
                ReminderUndeliveredReason::NoMainChat,
            )
            .await;
            return Vec::new();
        }
        Err(e) => eprintln!("[subtask-report {main}] reading the main chat failed: {e}"),
    }
    let mut due = Vec::with_capacity(taken.len());
    for waiting in taken {
        if is_still_due(host, &waiting.report).await {
            due.push(waiting);
        }
    }
    due
}

async fn is_still_due(host: &RunnerHost<'_>, report: &SubtaskReport) -> bool {
    if let Some(due) = report.due() {
        return match host.galley.scheduled_task(&due.task_id).await {
            Ok(task) => {
                task.cancelled_at.is_none()
                    && task.last_wake == Some(ScheduledWake::Pending)
                    && task.last_fired_at.as_deref() == Some(due.fired_at.as_str())
                    && todo_still_open(host.galley, task.todo_id.as_deref()).await
            }
            Err(GalleyError::NotFound { .. }) => false,
            Err(e) => {
                eprintln!(
                    "[subtask-report {}] reading the task failed: {e}",
                    due.task_id
                );
                true
            }
        };
    }
    let Some(id) = report.subtask_id.as_deref() else {
        return true;
    };
    match host.galley.session_brief(SessionId(id.to_string())).await {
        Ok(session) if session.promoted == Some(true) => return false,
        Ok(_) => {}
        Err(GalleyError::NotFound { .. }) => return false,
        Err(e) => eprintln!("[subtask-report {id}] reading the subtask failed: {e}"),
    }
    let state = host.runner.run_state(id).await;
    if state.open_run {
        return false;
    }
    !matches!(report.outcome, ReportOutcome::Asking { .. }) || state.ask_pending
}

/// Whether the to-do a reminder is on is still open (ticket 39's second
/// safety: a to-do ticked off is not reminded of). A task on no to-do, or
/// a read that failed (a reminder lost is worse than one too many), says
/// yes.
async fn todo_still_open(galley: &SqliteGalley, todo_id: Option<&str>) -> bool {
    let Some(todo_id) = todo_id else {
        return true;
    };
    match galley.todo(todo_id).await {
        Ok(todo) => todo.is_open(),
        Err(GalleyError::NotFound { .. }) => false,
        Err(e) => {
            eprintln!("[subtask-report] reading to-do {todo_id} failed: {e}");
            true
        }
    }
}

/// A delivery that failed: release the gate, keep the reports for the
/// next try, tell the desktop about the ones it has not heard of. Due
/// tasks are not kept: they are consumed and handed to a notification.
async fn keep_for_later(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main: &str,
    due: Vec<Waiting>,
    why: String,
) -> WakeOutcome {
    host.runner.queue_release_run(main).await;
    eprintln!("[subtask-report {main}] could not wake the main chat: {why}");
    let (due_tasks, mut kept): (Vec<Waiting>, Vec<Waiting>) =
        due.into_iter().partition(|w| w.report.due().is_some());
    return_due_tasks(
        host.galley,
        host.notifier.as_ref(),
        due_tasks.into_iter().map(|w| w.report).collect(),
        ReminderUndeliveredReason::NotStarted,
    )
    .await;
    let ids = mark_announced(&mut kept);
    reports.restore(main, kept);
    announce_undelivered(host.notifier.as_ref(), main, ids);
    WakeOutcome::Failed(why)
}

// ---------------- scheduled tasks (ticket 33) ----------------

/// Consume due tasks that could not reach the assistant: their fire is
/// settled as notified and the desktop is told to show the task's own
/// words ([`SCHEDULED_REMINDER_UNDELIVERED_EVENT`]). A fire that is no
/// longer pending (cancelled, fired again, settled) says nothing.
pub async fn return_due_tasks(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    due_tasks: Vec<SubtaskReport>,
    reason: ReminderUndeliveredReason,
) {
    if due_tasks.is_empty() {
        return;
    }
    for report in &due_tasks {
        let Some(due) = report.due() else {
            continue;
        };
        if due.review {
            drop_review_wake(galley, report, due, reason).await;
            continue;
        }
        match galley
            .settle_scheduled_wake(&due.task_id, &due.fired_at, ScheduledWake::Notified)
            .await
        {
            Ok(true) => {
                eprintln!(
                    "[subtask-report {}] reminder {} not delivered ({reason:?}), notified",
                    report.main_chat_id, due.task_id
                );
                notify(
                    notifier,
                    SCHEDULED_REMINDER_UNDELIVERED_EVENT,
                    &ScheduledReminderUndelivered {
                        task_id: crate::api::ScheduledTaskId(due.task_id.clone()),
                        prompt: due.prompt.clone(),
                        reason,
                    },
                );
            }
            Ok(false) => {}
            Err(e) => eprintln!(
                "[subtask-report {}] settling reminder {} failed: {e}",
                report.main_chat_id, due.task_id
            ),
        }
    }
    notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
}

/// A wake of the morning review that could not reach the main chat
/// (ticket 73): dropped, with no notification — its words are for the
/// model, and a system notification would show them to the user. The
/// fire stays consumed (it does not come due again today) and its log
/// says why. A fire no longer pending says nothing.
async fn drop_review_wake(
    galley: &SqliteGalley,
    report: &SubtaskReport,
    due: &DueReminder,
    reason: ReminderUndeliveredReason,
) {
    match galley
        .drop_scheduled_wake(&due.task_id, &due.fired_at)
        .await
    {
        Ok(true) => {
            eprintln!(
                "[subtask-report {}] morning review {} not delivered ({reason:?}), dropped",
                report.main_chat_id, due.task_id
            );
            let why = serde_json::to_value(reason)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string));
            crate::scheduler::log_review(
                galley,
                crate::scheduler::ReviewEvent::Dropped,
                &due.task_id,
                &due.fired_at,
                Some(&due.due_at),
                why.as_deref(),
            )
            .await;
        }
        Ok(false) => {}
        Err(e) => eprintln!(
            "[subtask-report {}] dropping review {} failed: {e}",
            report.main_chat_id, due.task_id
        ),
    }
}

/// The drain task's hook for a run signal of the main chat, before the
/// queue step: when a delivered wake carried due tasks, the turn it
/// started has ended. A turn that ended on an error or lost its runner
/// before replying did not deliver them — they are handed to a
/// notification; any other end delivered them (a `<no-reply/>`, a stop
/// by the user included).
pub async fn record_wake_run_end(
    reports: &SubtaskReports,
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    notifier: &dyn Notifier,
    signal: &RunSignal,
) {
    let session_id = match signal {
        RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => session_id,
    };
    let carried = reports.take_in_flight(session_id);
    if carried.is_empty() {
        return;
    }
    let state = runner.run_state(session_id).await;
    if matches!(
        run_end(signal, &state),
        Some(RunEnd::NoExit | RunEnd::RunnerExited)
    ) {
        return_due_tasks(
            galley,
            notifier,
            carried,
            ReminderUndeliveredReason::NoReply,
        )
        .await;
        return;
    }
    for report in &carried {
        let Some(due) = report.due() else {
            continue;
        };
        if let Err(e) = galley
            .settle_scheduled_wake(&due.task_id, &due.fired_at, ScheduledWake::Delivered)
            .await
        {
            eprintln!(
                "[subtask-report {session_id}] settling reminder {} failed: {e}",
                due.task_id
            );
        }
    }
    notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
}

/// Read the fires still pending in `scheduled_tasks` into the waiting
/// reports — every scheduler tick, so a fire the scheduler just stamped
/// and one left over from before a restart travel the same way. A fire
/// already reported in this process is not added again. Returns the main
/// chat to wake when any was added; nothing while the managed runtime is
/// not active or has no main chat (the fires stay pending).
pub async fn restore_pending_reminders(
    reports: &SubtaskReports,
    galley: &SqliteGalley,
) -> Option<String> {
    let main = match galley.active_runtime_kind().await {
        Ok(RuntimeKind::Managed) => match galley.main_chat_id().await {
            Ok(Some(main)) => main.0,
            Ok(None) => return None,
            Err(e) => {
                eprintln!("[subtask-report] reading the main chat failed: {e}");
                return None;
            }
        },
        Ok(_) => return None,
        Err(e) => {
            eprintln!("[subtask-report] reading the runtime failed: {e}");
            return None;
        }
    };
    let pending = match galley.pending_scheduled_wakes().await {
        Ok(pending) => pending,
        Err(e) => {
            eprintln!("[subtask-report] reading pending reminders failed: {e}");
            return None;
        }
    };
    let mut added = false;
    for task in &pending {
        // A to-do's reminder says which to-do (ticket 39), as it reads now.
        let todo = match task.todo_id.as_deref() {
            Some(todo_id) => match galley.todo(todo_id).await {
                Ok(todo) => Some(DueTodo::from_todo(&todo, &chrono::Local)),
                Err(e) => {
                    eprintln!("[subtask-report] reading to-do {todo_id} failed: {e}");
                    None
                }
            },
            None => None,
        };
        // A morning review names the memos new since the one before it
        // (ticket 95), as they read now.
        let memos = if task.is_review() {
            crate::scheduler::review_wake_memos(galley, task)
                .await
                .iter()
                .map(DueMemo::from_memo)
                .collect()
        } else {
            Vec::new()
        };
        if let Some(report) = SubtaskReport::reminder(&main, task, todo, memos) {
            added |= reports.add(report);
        }
    }
    added.then_some(main)
}

fn announce_message(
    host: &RunnerHost<'_>,
    main: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    notify(
        host.notifier.as_ref(),
        USER_MESSAGE_PERSISTED_EVENT,
        &UserMessagePersistedPayload {
            session_id: main.to_string(),
            message: message.clone(),
            dispatch,
            client_request_id: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(id: Option<&str>, send_backs: u32, outcome: ReportOutcome) -> SubtaskReport {
        SubtaskReport {
            main_chat_id: "s-main".into(),
            subtask_id: id.map(str::to_string),
            title: "把 PDF 分类".into(),
            send_backs,
            outcome,
            key: format!("{}#1", id.unwrap_or("tag")),
            scheduled_task_id: None,
        }
    }

    fn due(once: bool, late: Option<&str>) -> DueReminder {
        DueReminder {
            review: false,
            task_id: "sched_a".into(),
            prompt: "提醒他喝水".into(),
            once,
            rule: if once {
                "one-off".into()
            } else {
                "every day at 09:00".into()
            },
            due_at: "2026-10-20T12:00:00+00:00".into(),
            fired_at: "2026-10-20T12:00:30+00:00".into(),
            due_local: "2026-10-20 20:00 (Tue)".into(),
            fired_local: "2026-10-22 09:15 (Thu)".into(),
            late: late.map(str::to_string),
            todo: None,
            memos: Vec::new(),
        }
    }

    fn due_report(d: DueReminder) -> SubtaskReport {
        SubtaskReport {
            main_chat_id: "s-main".into(),
            subtask_id: None,
            title: d.prompt.clone(),
            send_backs: 0,
            key: format!("sched:{}@{}", d.task_id, d.fired_at),
            scheduled_task_id: Some(d.task_id.clone()),
            outcome: ReportOutcome::Due(d),
        }
    }

    #[test]
    fn a_due_reminder_carries_its_words_and_when() {
        let text = report_text(&[due_report(due(true, None))]);
        assert!(text.starts_with(OPENING_REMINDER));
        assert!(text.contains(
            "Reminder `sched_a` (one-off) came due. Planned for 2026-10-20 20:00 (Tue), local \
             time. What you noted when you set it:\n<<<\n提醒他喝水\n>>>\n"
        ));
        assert!(text.contains(
            "If it no longer applies (the user already did it), end your reply with exactly \
             <no-reply/>."
        ));
        assert!(!text.contains("late"));
        let late = report_text(&[due_report(due(false, Some("1 day 13 hours")))]);
        assert!(late.contains(
            "Scheduled reminder `sched_a` (every day at 09:00) came due. Planned for \
             2026-10-20 20:00 (Tue), local time; it went off at 2026-10-22 09:15 (Thu), 1 day \
             13 hours late (the computer was asleep or Galley was closed). What you noted"
        ));
        assert!(late.contains(
            ">>>\nAct on it now, and say in the reply itself (the user does not see your summary) \
             that it comes 1 day 13 hours late: tell the user what is of use to them now"
        ));
        // Ticket 63: what is of use now, not the words read back.
        assert!(text.contains(
            ">>>\nAct on it now: tell the user what is of use to them now, in a sentence or two \
             (not your words read back), look something up first, or start a subtask. If it no \
             longer applies"
        ));
        assert!(!text.contains("tell the user in a sentence or two"));
        assert_eq!(
            replay_lines(&[due_report(due(true, None))]),
            "[Galley: reminder sched_a came due (2026-10-20 20:00 (Tue)) — details: schedule \
             show sched_a]"
        );
        assert_eq!(
            replay_lines(&[due_report(due(true, Some("3 minutes")))]),
            "[Galley: reminder sched_a came due (planned 2026-10-20 20:00 (Tue), went off \
             2026-10-22 09:15 (Thu), 3 minutes late) — details: schedule show sched_a]"
        );
        assert_eq!(
            replay_fallback(Some("s-1,sched_a")),
            "[Galley: subtask s-1 has an update — details: session show s-1]\n\
             [Galley: scheduled task sched_a came due — details: schedule show sched_a]"
        );
    }

    /// Ticket 73: the morning review opens as itself, names the part of
    /// the manual and the two rules it acts on at once, carries no words of
    /// the model's own (Galley made it), and asks nothing about lateness;
    /// its replay line says what it was. With other updates it opens in
    /// general, as any mix does.
    #[test]
    fn the_morning_review_says_what_it_is_and_what_to_do() {
        let mut review = due(false, None);
        review.review = true;
        review.prompt = "Morning review: …".into();
        let text = report_text(&[due_report(review.clone())]);
        assert!(text.starts_with(
            "[Galley — not a message from the user] It is time for the morning review. Act on \
             it as below. Do not mention this note."
        ));
        assert!(text.contains(
            "The morning review `sched_a` (every day at 09:00) came due. Planned for 2026-10-20 \
             20:00 (Tue), local time. Galley made this task, not you: once a day, go over what \
             is in hand. Read \"The morning review\" in `wake.md` in your manual and do as it \
             says:"
        ));
        assert!(text.contains("and start at most two subtasks in all."));
        assert!(text.contains(
            "Speak only when you got something done the user will want to know, in one \
             message, in your own words, with no fixed heading. If you only started subtasks, \
             write nothing else for the user and end your reply with exactly <no-reply/>; if you \
             did nothing, your whole reply is exactly <no-reply/>."
        ));
        assert!(!text.contains("going over what is in hand this morning"));
        assert!(!text.contains("What you noted"));
        assert!(!text.contains("Morning review: …"));
        let mut late = review.clone();
        late.late = Some("2 hours".into());
        let late_text = report_text(&[due_report(late)]);
        assert!(late_text.contains(
            "2 hours late (the computer was asleep or Galley was closed), which you need not \
             mention."
        ));
        assert!(!late_text.contains("say in the reply itself"));
        assert_eq!(
            replay_lines(&[due_report(review.clone())]),
            "[Galley: the morning review sched_a came due (2026-10-20 20:00 (Tue)) — details: \
             schedule show sched_a]"
        );
        let mixed = report_text(&[report(Some("s-1"), 0, done("x")), due_report(review)]);
        assert!(mixed.starts_with(OPENING_MIXED));
        assert!(mixed.ends_with(CLOSING_MANY));
    }

    /// Ticket 95 (main chat PRD ruling 143 point 3): a review with new
    /// memos names each by id and text, one line each, after what it says
    /// without them, and sends the model to the manual's part; without
    /// memos the words are as they were, byte for byte.
    #[test]
    fn the_morning_review_names_the_new_memos() {
        let mut review = due(false, None);
        review.review = true;
        let without = report_text(&[due_report(review.clone())]);
        review.memos = vec![
            DueMemo {
                id: "memo_1a2b3c4d5e6f7a8b".into(),
                text: "看他这周常问 76 人\n的比赛".into(),
            },
            DueMemo {
                id: "memo_4d5e6f7a8b9c0d1e".into(),
                text: "想学吉他".into(),
            },
        ];
        let with = report_text(&[due_report(review.clone())]);
        assert_eq!(
            with,
            format!(
                "{without}\n\nMemos noted or changed since the last review, in turns the user \
                 started:\n\
                 - `memo_1a2b3c4d5e6f7a8b`: 看他这周常问 76 人 的比赛\n\
                 - `memo_4d5e6f7a8b9c0d1e`: 想学吉他\n\
                 For each, ask whether there is something you could get done for the user that \
                 they would want to know, as \"The morning review\" in `wake.md` says; most \
                 need nothing."
            )
        );
        // The replay line does not carry them.
        assert_eq!(
            replay_lines(&[due_report(review)]),
            "[Galley: the morning review sched_a came due (2026-10-20 20:00 (Tue)) — details: \
             schedule show sched_a]"
        );
    }

    /// Ticket 39: a reminder on one of the user's to-dos says which to-do,
    /// its title and notes, when it is due, with ticket 33's times and
    /// lateness unchanged; its replay line names the to-do. Ticket 63: the
    /// to-do is on the user's list whoever does it, and the model says
    /// what is of use now, not the to-do read back, and does not tick it
    /// off until the user says it is done or has happened.
    #[test]
    fn a_to_dos_reminder_says_it_is_on_the_users_list() {
        let mut on_todo = due(true, None);
        on_todo.todo = Some(DueTodo {
            id: "todo_1".into(),
            title: "交季度报告".into(),
            notes: Some("发给王总".into()),
            due: Some("2026-10-21 15:00 (Wed)".into()),
        });
        let text = report_text(&[due_report(on_todo.clone())]);
        assert!(text.starts_with(OPENING_REMINDER));
        assert!(text.contains(
            "Reminder `sched_a` on the user's to-do `todo_1` came due. Planned for 2026-10-20 \
             20:00 (Tue), local time. The to-do is on the user's list, something to do or \
             something coming up they want to hear about:\n<<<\n交季度报告\n发给王总\n>>>\nIt is \
             due 2026-10-21 15:00 (Wed), local time. Act on it now: tell the user what is of use \
             to them now, in a sentence or two (not the to-do read back: ask whether it is done \
             or has happened, or give the next step), look something up first, or start a \
             subtask. Do not tick it off until they say it is done or has happened. If it no \
             longer applies"
        ));
        assert!(!text.contains("something they have to do") && !text.contains("remind the user"));
        assert!(text.ends_with(
            "If it no longer applies (the user already did it), end your reply with exactly \
             <no-reply/>."
        ));
        // Not the words it noted: the to-do's title is.
        assert!(!text.contains("提醒他喝水") && !text.contains("What you noted"));
        let mut late = on_todo.clone();
        late.late = Some("9 hours".into());
        late.todo.as_mut().unwrap().due = None;
        late.todo.as_mut().unwrap().notes = None;
        let text = report_text(&[due_report(late.clone())]);
        assert!(text.contains(
            "it went off at 2026-10-22 09:15 (Thu), 9 hours late (the computer was asleep or \
             Galley was closed). The to-do"
        ));
        assert!(text.contains(
            "<<<\n交季度报告\n>>>\nIt has no due date. Act on it now, and say in the reply \
             itself (the user does not see your summary) that it comes 9 hours late: tell the \
             user what is of use"
        ));
        assert_eq!(
            replay_lines(&[due_report(on_todo)]),
            "[Galley: reminder sched_a for to-do todo_1 came due (2026-10-20 20:00 (Tue)) — \
             details: schedule show sched_a]"
        );
        assert_eq!(
            replay_lines(&[due_report(late)]),
            "[Galley: reminder sched_a for to-do todo_1 came due (planned 2026-10-20 20:00 \
             (Tue), went off 2026-10-22 09:15 (Thu), 9 hours late) — details: schedule show \
             sched_a]"
        );
    }

    #[test]
    fn a_mix_of_kinds_opens_in_general() {
        let mut scheduled = report(Some("s-9"), 0, done("今天的摘要"));
        scheduled.scheduled_task_id = Some("sched_b".into());
        scheduled.title = "每天早上的摘要".into();
        let alone = report_text(std::slice::from_ref(&scheduled));
        assert!(alone.starts_with(OPENING_SCHEDULED));
        assert!(alone.contains(
            "Scheduled task `sched_b` ran in session `s-9` (\"每天早上的摘要\") and finished. \
             Its final answer:\n<<<\n今天的摘要\n>>>\nTell the user the result in a sentence \
             or two."
        ));
        assert!(!alone.contains("send it back"));
        assert_eq!(
            replay_lines(std::slice::from_ref(&scheduled)),
            "[Galley: scheduled task sched_b ran in session s-9 \"每天早上的摘要\": finished — \
             details: session show s-9]"
        );
        let mixed = report_text(&[
            report(Some("s-1"), 0, done("x")),
            due_report(due(true, None)),
            scheduled,
        ]);
        assert!(mixed.starts_with(OPENING_MIXED));
        assert!(mixed.ends_with(CLOSING_MANY));
        let only_subtasks = report_text(&[report(Some("s-1"), 0, done("x"))]);
        assert!(only_subtasks.starts_with(OPENING));
    }

    #[test]
    fn lateness_and_rules_in_words() {
        assert_eq!(lateness_words(180), "3 minutes");
        assert_eq!(lateness_words(60), "1 minute");
        assert_eq!(lateness_words(3600), "1 hour");
        assert_eq!(lateness_words(2 * 3600 + 5 * 60), "2 hours 5 minutes");
        assert_eq!(
            lateness_words(86_400 + 13 * 3600 + 40 * 60),
            "1 day 13 hours"
        );
        assert_eq!(lateness_words(2 * 86_400), "2 days");
        assert_eq!(rule_words(&ScheduledTaskRepeat::Once, "20:00"), "one-off");
        assert_eq!(
            rule_words(&ScheduledTaskRepeat::Daily, "09:00"),
            "every day at 09:00"
        );
        assert_eq!(
            rule_words(
                &ScheduledTaskRepeat::Weekly {
                    weekdays: vec![1, 5]
                },
                "09:00"
            ),
            "every Mon, Fri at 09:00"
        );
        assert_eq!(
            rule_words(
                &ScheduledTaskRepeat::Monthly {
                    monthdays: vec![1, 15]
                },
                "08:30"
            ),
            "monthly on day 1, 15 at 08:30"
        );
    }

    #[test]
    fn a_due_report_reads_its_fire_in_the_given_zone() {
        use crate::api::schedule::{ScheduleTarget, ScheduledTaskBrief};
        use crate::api::ScheduledTaskId;
        let task = ScheduledTaskBrief {
            id: ScheduledTaskId("sched_x".into()),
            project_id: None,
            prompt: "带身份证".into(),
            repeat: ScheduledTaskRepeat::Once,
            time_of_day: "20:00".into(),
            fire_at: Some("2026-10-20T12:00:00+00:00".into()),
            target: ScheduleTarget::Assistant,
            llm_name: None,
            enabled: true,
            last_fired_at: Some("2026-10-22T01:15:00+00:00".into()),
            last_run_session_id: None,
            next_fire_at: None,
            last_due_at: Some("2026-10-20T12:00:00+00:00".into()),
            last_wake: Some(ScheduledWake::Pending),
            origin: None,
            created_in: None,
            cancelled_at: None,
            cancelled_by: None,
            todo_id: None,
            created_at: "2026-10-16T00:00:00+00:00".into(),
            updated_at: "2026-10-16T00:00:00+00:00".into(),
        };
        let shanghai = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        let due = DueReminder::from_task(&task, &shanghai).unwrap();
        assert_eq!(due.due_local, "2026-10-20 20:00 (Tue)");
        assert_eq!(due.fired_local, "2026-10-22 09:15 (Thu)");
        assert_eq!(due.late.as_deref(), Some("1 day 13 hours"));
        assert!(due.once);
        // Within two minutes it is on time.
        let mut on_time = task.clone();
        on_time.last_fired_at = Some("2026-10-20T12:01:59+00:00".into());
        assert_eq!(
            DueReminder::from_task(&on_time, &shanghai).unwrap().late,
            None
        );
        // Never fired: nothing to report.
        let mut never = task;
        never.last_fired_at = None;
        assert!(DueReminder::from_task(&never, &shanghai).is_none());
    }

    fn done(answer: &str) -> ReportOutcome {
        ReportOutcome::Done {
            answer: answer.into(),
        }
    }

    fn state(last_exit: Option<&str>, ask_pending: bool, open_run: bool) -> RunState {
        RunState {
            open_run,
            ask_pending,
            last_exit: last_exit.map(str::to_string),
            ..RunState::default()
        }
    }

    fn complete() -> RunSignal {
        RunSignal::RunComplete {
            session_id: "s".into(),
        }
    }

    #[test]
    fn how_a_run_ended() {
        let closed = RunSignal::Closed {
            session_id: "s".into(),
        };
        let cases = [
            (
                complete(),
                state(Some("CURRENT_TASK_DONE"), false, true),
                Some(RunEnd::Done),
            ),
            (
                complete(),
                state(Some("EXITED"), false, true),
                Some(RunEnd::Done),
            ),
            (complete(), state(None, false, true), Some(RunEnd::Done)),
            (
                complete(),
                state(Some("EXITED"), true, true),
                Some(RunEnd::Asking),
            ),
            (
                complete(),
                state(Some("MAX_TURNS_EXCEEDED"), false, true),
                Some(RunEnd::StepLimit),
            ),
            (
                complete(),
                state(Some("DONE_WITHOUT_EXIT"), false, true),
                Some(RunEnd::NoExit),
            ),
            (complete(), state(Some("ABORTED"), false, true), None),
            (
                complete(),
                state(Some("SLASH_COMMAND_COMPLETED"), false, true),
                None,
            ),
            (
                closed.clone(),
                state(Some("CURRENT_TASK_DONE"), false, true),
                Some(RunEnd::RunnerExited),
            ),
            // Closed while idle (evicted, shut down): no run ended.
            (closed, state(Some("CURRENT_TASK_DONE"), false, false), None),
        ];
        for (signal, state, want) in cases {
            assert_eq!(run_end(&signal, &state), want, "{signal:?} {state:?}");
        }
    }

    #[test]
    fn one_report_has_the_opening_and_no_closing() {
        let text = report_text(&[report(Some("s-1"), 0, done("分好了：发票 3 份。"))]);
        assert!(text.starts_with(OPENING));
        assert!(!text.contains(CLOSING_MANY));
        assert!(
            text.contains("Subtask `s-1` \"把 PDF 分类\" (round 1) finished. Its final answer:")
        );
        assert!(text.contains("<<<\n分好了：发票 3 份。\n>>>"));
        assert!(text.contains("`session show s-1 --tail=40`"));
        // The instructions are the subtask's first message (turn 0), which
        // a long run pushes out of the last 40 (ticket 30's eval).
        assert!(text.contains("its first message: `session show s-1 --around=msg_s-1_0_user`"));
        assert!(text.contains(
            "send it back with `session send s-1 \"<what is missing>\" \
             --supervisor=galley-assistant --reason=\"send back\" --ensure-runner` and end \
             your reply with exactly <no-reply/> and nothing else."
        ));
    }

    #[test]
    fn every_send_starts_the_subtasks_runner_if_it_is_gone() {
        let text = report_text(&[
            report(Some("s-1"), 0, done("x")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "q".into(),
                    candidates: vec![],
                },
            ),
        ]);
        let sends: Vec<&str> = text
            .split("`session send ")
            .skip(1)
            .map(|rest| rest.split('`').next().unwrap())
            .collect();
        assert_eq!(sends.len(), 2);
        for send in sends {
            assert!(
                send.ends_with(
                    "--supervisor=galley-assistant --reason=\"send back\" --ensure-runner"
                ) || send
                    .ends_with("--supervisor=galley-assistant --reason=\"answer\" --ensure-runner"),
                "{send}"
            );
        }
    }

    #[test]
    fn several_reports_go_in_one_message() {
        let text = report_text(&[
            report(Some("s-1"), 0, done("好了")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "要哪家？".into(),
                    candidates: vec!["A 店".into(), "B 店".into()],
                },
            ),
        ]);
        assert_eq!(text.matches(OPENING).count(), 1);
        assert!(text.ends_with(CLOSING_MANY));
        let first = text.find("`s-1`").unwrap();
        let second = text.find("`s-2`").unwrap();
        assert!(first < second);
        assert!(text.contains(
            "Subtask `s-2` \"把 PDF 分类\" is asking: \"要哪家？\" Options: \"A 店\", \"B 店\"."
        ));
        assert!(text.contains(
            "--reason=\"answer\" --ensure-runner` and end your reply with exactly <no-reply/>."
        ));
    }

    #[test]
    fn a_question_without_options_ends_after_it() {
        let text = report_text(&[report(
            Some("s-2"),
            0,
            ReportOutcome::Asking {
                question: "验证码是多少？".into(),
                candidates: vec![],
            },
        )]);
        assert!(text.contains("is asking: \"验证码是多少？\".\n"));
    }

    #[test]
    fn the_round_counts_send_backs_and_two_is_enough() {
        let once = report_text(&[report(Some("s-1"), 1, done("x"))]);
        assert!(once.contains("(round 2) finished"));
        assert!(once.contains("send it back with"));
        let twice = report_text(&[report(Some("s-1"), 2, done("x"))]);
        assert!(twice.contains("(round 3) finished"));
        assert!(!twice.contains("send it back with"));
        assert!(twice.contains(
            "It has been sent back 2 times already: do not send it back again. \
             Tell the user what it found and what is still missing."
        ));
        let step = report_text(&[report(
            Some("s-1"),
            2,
            ReportOutcome::StepLimit {
                last_words: "".into(),
            },
        )]);
        assert!(step.contains("do not send it back again"));
        assert!(!step.contains("continue"));
    }

    #[test]
    fn a_long_answer_is_cut_with_where_to_read_it() {
        let answer = format!("{}尾巴", "长".repeat(REPORT_TEXT_MAX_CHARS));
        let text = report_text(&[report(Some("s-1"), 0, done(&answer))]);
        assert!(text.contains(&"长".repeat(REPORT_TEXT_MAX_CHARS)));
        assert!(!text.contains("尾巴"));
        assert!(text.contains("[… cut for length; all of it: `session show s-1 --tail=1`]"));
        let exact = "短".repeat(REPORT_TEXT_MAX_CHARS);
        assert!(!report_text(&[report(Some("s-1"), 0, done(&exact))]).contains("cut for length"));
    }

    #[test]
    fn step_limit_error_and_not_started() {
        let step = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::StepLimit {
                last_words: "已经分完一半。".into(),
            },
        )]);
        assert!(step.contains(
            "Subtask `s-1` \"把 PDF 分类\" (round 1) paused at the engine's step limit, mid-work. \
             The last thing it said:\n<<<\n已经分完一半。\n>>>\nIf it is getting somewhere, \
             send it on with `session send s-1 \"continue\" --supervisor=galley-assistant \
             --reason=\"continue\" --ensure-runner` and end your reply with exactly <no-reply/>"
        ));
        let quiet = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::StepLimit {
                last_words: " ".into(),
            },
        )]);
        assert!(quiet.contains("mid-work. If it is getting somewhere"));
        let error = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::Error {
                detail: "429 Too Many\nRequests.".into(),
            },
        )]);
        assert!(error.contains(
            "Subtask `s-1` \"把 PDF 分类\" stopped on an error: 429 Too Many Requests. \
             Tell the user in a sentence what failed and what you suggest. \
             Do not start it again unless they ask."
        ));
        let not_started = report_text(&[report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was not closed".into(),
            },
        )]);
        assert!(not_started.contains(
            "The subtask \"把 PDF 分类\" could not be started: the tag was not closed. \
             Tell the user in a sentence, and offer to try again."
        ));
        let mut empty = report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was empty".into(),
            },
        );
        empty.title = String::new();
        assert!(
            report_text(&[empty]).contains("A subtask could not be started: the tag was empty.")
        );
    }

    #[test]
    fn replay_lines_name_each_subtask_and_how_it_ended() {
        let mut nameless = report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was empty".into(),
            },
        );
        nameless.title = String::new();
        let lines = replay_lines(&[
            report(Some("s-1"), 0, done("x")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "q".into(),
                    candidates: vec![],
                },
            ),
            report(
                Some("s-3"),
                0,
                ReportOutcome::StepLimit {
                    last_words: "w".into(),
                },
            ),
            report(Some("s-4"), 0, ReportOutcome::Error { detail: "d".into() }),
            report(
                None,
                0,
                ReportOutcome::NotStarted {
                    why: "the tag was not closed".into(),
                },
            ),
            nameless,
        ]);
        assert_eq!(
            lines.split('\n').collect::<Vec<_>>(),
            vec![
                "[Galley: subtask s-1 \"把 PDF 分类\" finished — details: session show s-1]",
                "[Galley: subtask s-2 \"把 PDF 分类\" is asking — details: session show s-2]",
                "[Galley: subtask s-3 \"把 PDF 分类\" stopped at the step limit — details: session show s-3]",
                "[Galley: subtask s-4 \"把 PDF 分类\" failed — details: session show s-4]",
                "[Galley: subtask \"把 PDF 分类\" could not be started]",
                "[Galley: a subtask could not be started]",
            ]
        );
        assert_eq!(
            replay_fallback(Some("s-1, s-2")),
            "[Galley: subtask s-1 has an update — details: session show s-1]\n\
             [Galley: subtask s-2 has an update — details: session show s-2]"
        );
        assert_eq!(replay_fallback(None), "[Galley: a subtask has an update]");
    }

    fn reply(
        final_answer: Option<&str>,
        preamble: Option<&str>,
        tool_calls: Option<&str>,
    ) -> RunReply {
        RunReply {
            turn_index: 1,
            final_answer: final_answer.map(str::to_string),
            preamble: preamble.map(str::to_string),
            tool_calls: tool_calls.map(str::to_string),
        }
    }

    #[test]
    fn last_words_and_the_question() {
        let rows = vec![
            reply(
                Some("先看看"),
                Some("先看看"),
                Some(r#"[{"toolName":"code_run"}]"#),
            ),
            reply(Some("分好了"), None, Some("[]")),
        ];
        assert_eq!(last_words(&rows), "分好了");
        let rows = vec![
            reply(Some("答完了"), None, None),
            reply(None, Some("还差一步"), Some(r#"[{"toolName":"code_run"}]"#)),
        ];
        assert_eq!(last_words(&rows), "还差一步");
        assert_eq!(last_words(&[reply(None, None, None)]), "");
        let rows = vec![reply(
            None,
            None,
            Some(
                r#"[{"toolName":"ask_user","args":{"question":"要哪家？","candidates":["A","B"]}}]"#,
            ),
        )];
        assert_eq!(
            asked(&rows),
            ("要哪家？".into(), vec!["A".into(), "B".into()])
        );
        assert_eq!(
            asked(&[reply(Some("你说呢"), None, None)]),
            ("你说呢".into(), vec![])
        );
    }

    #[test]
    fn a_report_is_kept_once_and_replaces_its_subtasks_older_one() {
        let reports = SubtaskReports::new();
        assert!(reports.add(report(Some("s-1"), 0, done("a"))));
        // The same end again.
        assert!(!reports.add(report(Some("s-1"), 0, done("a"))));
        assert!(reports.add(report(
            None,
            0,
            ReportOutcome::NotStarted { why: "x".into() }
        )));
        let mut newer = report(Some("s-1"), 1, done("b"));
        newer.key = "s-1#5".into();
        assert!(reports.add(newer.clone()));
        let waiting = reports.waiting("s-main");
        assert_eq!(waiting.len(), 2);
        assert_eq!(waiting[1], newer);

        // Announced once each.
        assert_eq!(reports.announce_waiting("s-main"), vec!["s-1".to_string()]);
        assert!(reports.announce_waiting("s-main").is_empty());

        // Restored ahead of later ones, unless a newer one replaced it.
        let taken = reports.take("s-main");
        assert!(reports.waiting("s-main").is_empty());
        let mut newest = report(Some("s-1"), 2, done("c"));
        newest.key = "s-1#9".into();
        reports.add(newest.clone());
        reports.restore("s-main", taken);
        let waiting = reports.waiting("s-main");
        assert_eq!(waiting.len(), 2);
        assert_eq!(waiting[0].subtask_id, None);
        assert_eq!(waiting[1], newest);
    }
}
