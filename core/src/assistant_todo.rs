//! The assistant's to-do list (main chat ticket 37, regrouped by ticket
//! 39; main chat PRD rulings 86 and 91, assistant PRD rulings 5 and 9):
//! the user's to-dos, what Galley is on, its routines, and what was done
//! lately. One read, two readers — the desktop's 「待办」 and the
//! 「在办的事」 lines Core writes at the start of each segment of the main
//! chat (ticket 36). "What you see is what it sees": both read the same groups
//! in the same order.
//!
//! - **Yours** ([`AssistantTodo::yours`], 你的事): the user's to-dos not
//!   done (`crate::api::todo`), in three parts by their due date read in
//!   this machine's zone: **today** (due today or before: overdue ones
//!   first, marked, then by when they are due), **later** (due after
//!   today, soonest first), **any time** (no due date, in the order they
//!   were noted). [`AssistantTodo::today_count`] counts today's: the
//!   sidebar's 「今天 N」.
//! - **Galley's** ([`AssistantTodo::assistant`], Galley 在办): the main
//!   chat's subtasks not promoted, not archived and not finished —
//!   running, asking, failed, paused at the step limit, or stopped short
//!   — most recent activity first; then the one-off tasks on no to-do
//!   still to go off (its own reminders to come back to something, either
//!   target), soonest first, paused ones last. A subtask that is not
//!   running and has not moved for [`RECENT_WINDOW_DAYS`] drops out: it
//!   was reported to the assistant when its run ended, and a stale
//!   failure carried forever is noise in both readers.
//! - **Routine** ([`AssistantTodo::routine`], 例行): the repeating tasks,
//!   either target, by their next fire; paused ones after them.
//! - **Done** ([`AssistantTodo::done`], 已完成): within the last
//!   [`RECENT_WINDOW_DAYS`] (a rolling window, not calendar days) — a
//!   to-do ticked off, a one-off on no to-do that went off, a routine's
//!   last fire, a finished subtask; newest first, at most
//!   [`RECENT_LIMIT`]. The morning review's fires are not here (main
//!   chat ticket 73): it is in routine, and what it got done shows as
//!   itself.
//!
//! A to-do's reminder is part of its to-do ([`TodoItem::reminder`]), in no
//! group of its own. A cancelled to-do or task is in no group (a task's
//! card in the conversation says 已取消). A routine can be in two: its
//! next fire in routine, its last one in done.
//!
//! The cards under the replies read the to-dos a second way
//! ([`noted_todos`], main chat ticket 43): every one Galley noted in the
//! main chat, done however long ago or cancelled, each as the list words
//! it — a card under a reply stays where 已完成 lets go.
//!
//! The 「在办的事」 lines read one thing the desktop does not
//! ([`declined_follow_ups`], main chat ticket 61, PRD ruling 113): the
//! follow-ups Galley set that the user turned down — its to-dos and
//! tasks cancelled within [`DECLINED_WINDOW_DAYS`] by the user at the
//! desktop, or by Galley on the user's word — so a "don't remind me of
//! this kind" is in front of the main chat at every segment, not in a
//! memory it may not open. A read of its own, on purpose: "what you see
//! is what it sees" has this one exception (ruling 113 point 4). It is a
//! record for the main chat's judgement, not a list, so the panel has no
//! such group, and [`AssistantTodo`] (what the panel reads) never carries
//! it; [`in_hand_read`] reads both for the main chat.
//!
//! A subtask's state comes from its live run state (Core's run gate)
//! and its latest run's last reply in the database: running while a run
//! is open; asking when the run ended on `ask_user`; done when it ended
//! on a final answer; else how it ended, when this Core process saw it
//! end (the step limit, an error), or stopped short. Deterministic, no
//! model call. Times are UTC ISO; formatting is the reader's.

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::api::schedule::{
    parse_utc_secs, ScheduleTarget, ScheduledTaskBrief, ScheduledTaskCreatedIn, ScheduledTaskRepeat,
};
use crate::api::{
    Origin, OriginVia, RuntimeKind, SessionId, TodoBrief, TodoDue, TodoReminder, TodoStatus,
    ASSISTANT_SUPERVISOR,
};
use crate::db::{LastRunReply, ScheduleListScope, SqliteGalley, TodoListScope, TodoSubtaskRow};
use crate::error::Result;
use crate::runner_manager::{RunState, RunnerManager};

/// How far back 「已完成」 reaches, and how long a subtask that is not
/// running stays in 「Galley 在办」 without moving.
pub const RECENT_WINDOW_DAYS: i64 = 7;

/// At most this many items in [`AssistantTodo::done`]; the rest are
/// counted in [`AssistantTodo::done_omitted`].
pub const RECENT_LIMIT: usize = 50;

/// How far back 「最近不要的跟进」 reaches (main chat ticket 61): a
/// follow-up the user turned down stays in front of the main chat this
/// long (a rolling window), then leaves on its own.
pub const DECLINED_WINDOW_DAYS: i64 = 90;

/// The four groups and the day's count (Tauri `list_assistant_todo`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTodo {
    /// 你的事: the user's to-dos not done.
    pub yours: YourTodos,
    /// Galley 在办: subtasks not finished, then its own one-off tasks.
    pub assistant: Vec<TodoItem>,
    /// 例行: the repeating tasks.
    pub routine: Vec<TodoItem>,
    /// 已完成: the last seven days.
    pub done: Vec<TodoItem>,
    /// Done within the window but past [`RECENT_LIMIT`]: left out.
    pub done_omitted: u32,
    /// 「今天 N」: the to-dos due today or overdue, not done
    /// (`yours.today`'s length).
    pub today_count: u32,
}

/// The user's to-dos not done, by when they are due.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YourTodos {
    /// Due today or before, overdue ones first.
    pub today: Vec<TodoItem>,
    /// Due after today.
    pub later: Vec<TodoItem>,
    /// No due date.
    pub anytime: Vec<TodoItem>,
}

impl YourTodos {
    /// All three parts, in order.
    pub fn iter(&self) -> impl Iterator<Item = &TodoItem> {
        self.today.iter().chain(&self.later).chain(&self.anytime)
    }

    pub fn len(&self) -> usize {
        self.today.len() + self.later.len() + self.anytime.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl AssistantTodo {
    /// Nothing in any group.
    pub fn is_empty(&self) -> bool {
        self.yours.is_empty()
            && self.assistant.is_empty()
            && self.routine.is_empty()
            && self.done.is_empty()
    }

    /// Something in hand for the morning review to look at (main chat
    /// ticket 73): a to-do of the user's not done, or something Galley
    /// is on (a subtask not finished, a one-off reminder or task to come).
    /// Routines are not, the review being one; nor is what is done.
    pub fn anything_in_hand(&self) -> bool {
        !self.yours.is_empty() || !self.assistant.is_empty()
    }
}

/// What an item is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoKind {
    /// One of the user's to-dos (ticket 39).
    Todo,
    /// A scheduled task on no to-do: a reminder that wakes the assistant
    /// (`target = assistant`) or a task that starts a session.
    Task,
    /// A subtask the main chat dispatched.
    Subtask,
}

/// Where an item stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoState {
    /// A to-do not done.
    Open,
    /// A task that will fire.
    Scheduled,
    /// A task switched off: it will not fire until resumed.
    Paused,
    /// A task's fire (done): a one-off that went off, a routine's last
    /// run.
    Fired,
    /// A subtask with a run open.
    Running,
    /// A subtask waiting for the user's answer.
    Asking,
    /// A subtask whose run ended on an error, or whose runner did not
    /// start.
    Failed,
    /// A subtask paused at the engine's step limit.
    StepLimit,
    /// A subtask whose run stopped short of an answer — stopped, its
    /// runner gone, or ended before this Core process started.
    Stopped,
    /// A to-do ticked off, or a subtask that finished with an answer
    /// (done).
    Done,
}

/// Who made an item (or ticked a to-do off). The assistant's own and the
/// ones the user asked it for are one (main chat PRD ruling 86 point 4:
/// Core cannot tell them apart; the words where it was made can).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoCreator {
    /// The assistant (`--supervisor=galley-assistant`); every subtask.
    Assistant,
    /// The user: the desktop's form, or their tick on a to-do.
    User,
    /// Another agent ([`TodoItem::agent`] names it when it said).
    Agent,
}

/// One row of the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub kind: TodoKind,
    /// The to-do's or task's id, or the subtask's session id (where it
    /// leads).
    pub id: String,
    /// A to-do's title, the words a task carries, or the subtask's title.
    /// Uncut: the reader truncates.
    pub text: String,
    pub state: TodoState,
    /// The instant the item orders by (UTC ISO): a task's next fire (a
    /// paused one-off's planned fire; absent for a paused routine), a
    /// subtask's latest activity, a fire or a finish (done), when a to-do
    /// was ticked off (done). Absent for an open to-do: its `due` says
    /// when.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    pub created_by: TodoCreator,
    /// The other agent's supervisor label, when [`TodoCreator::Agent`]
    /// and it gave one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    /// Tasks: what a fire does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ScheduleTarget>,
    /// Tasks: the rule (`once` for a one-off).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<ScheduledTaskRepeat>,
    /// Tasks: local `HH:MM` (a one-off's is read off its fire time).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    /// To-dos and tasks the assistant made in a main chat turn: that turn
    /// — the reply its card hangs under, and where the list jumps to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_in: Option<ScheduledTaskCreatedIn>,
    /// Done tasks that start a session: the session that run made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_session_id: Option<String>,
    /// To-dos: the notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// To-dos: when it is due (its day read in this machine's zone).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<TodoDue>,
    /// To-dos not done: past due (its time passed, or its day is before
    /// today).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub overdue: bool,
    /// To-dos: the reminder on it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminder: Option<TodoReminder>,
    /// To-dos ticked off: who ticked it — the user at the desktop
    /// ([`TodoCreator::User`]), Galley, another agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_by: Option<TodoCreator>,
    /// To-dos: when it was noted (UTC ISO) — the panel's 「记下」 day
    /// (main chat ticket 43).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// To-dos cancelled: when (UTC ISO); `state` and `at` say how it
    /// stood. Only [`noted_todos`] returns a cancelled to-do (its card
    /// says 已取消); no group of the list holds one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
}

/// Who turned a follow-up down ([`DeclinedFollowUp::by`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeclinedBy {
    /// The user at the desktop (`cancelled_via = 'gui'`): a reminder
    /// cancelled on its to-do, the 取消 on a card or in the lists.
    User,
    /// Galley at the user's request: cancelled through the CLI with
    /// `--supervisor=galley-assistant`.
    Assistant,
}

/// A follow-up the user turned down (main chat ticket 61): a to-do or a
/// scheduled task Galley made (`created_by_supervisor =
/// 'galley-assistant'`), cancelled within [`DECLINED_WINDOW_DAYS`] by the
/// user at the desktop or by Galley at the user's request. Cancelled by
/// Core on its own (`system`: a reminder going with its to-do), by
/// another agent, or before who cancelled was recorded (NULL): not one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclinedFollowUp {
    /// [`TodoKind::Todo`] or [`TodoKind::Task`].
    pub kind: TodoKind,
    /// The to-do's or the task's id.
    pub id: String,
    /// The to-do's title or the task's words. Uncut: the reader truncates.
    pub text: String,
    /// When it was cancelled (UTC ISO).
    pub cancelled_at: String,
    pub by: DeclinedBy,
    /// The reason the cancel gave (`--reason`), when there was one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// What the main chat's 「在办的事」 lines read (ticket 61): the list the
/// desktop's 「待办」 reads, and the follow-ups the user turned down,
/// which only the main chat reads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InHandRead {
    pub todo: AssistantTodo,
    pub declined: Vec<DeclinedFollowUp>,
}

/// What [`build_todo`] knows of one subtask: its row, its live run state
/// (default when no runner was ever registered), and its latest run's
/// last reply.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SubtaskFacts {
    pub row: TodoSubtaskRow,
    pub live: RunState,
    pub last_reply: Option<LastRunReply>,
}

/// Read the list: the to-dos not cancelled, the tasks not cancelled, and
/// the main chat's subtasks with their run states. `now` decides the
/// window and, in this machine's zone, what today is.
pub async fn assistant_todo(
    galley: &SqliteGalley,
    runners: &RunnerManager,
    now: DateTime<Utc>,
) -> Result<AssistantTodo> {
    let todos = galley.list_todos(TodoListScope::Live).await?;
    let tasks = galley
        .list_scheduled_tasks_in(ScheduleListScope::Live)
        .await?;
    let mut subtasks = Vec::new();
    if let Some(main) = galley.main_chat_id().await? {
        let since = window_start(now);
        for row in galley.todo_subtask_rows(&main).await? {
            let live = runners.run_state(&row.session_id).await;
            let moved = parse_utc_secs(&row.last_activity_at).is_some_and(|at| at >= since);
            // Neither running nor in the window: in no group, so its
            // reply is not read.
            if !live.open_run && !moved {
                continue;
            }
            let last_reply = galley
                .latest_run_last_reply(&SessionId(row.session_id.clone()))
                .await?;
            subtasks.push(SubtaskFacts {
                row,
                live,
                last_reply,
            });
        }
    }
    Ok(build_todo(&todos, &tasks, &subtasks, now, &chrono::Local))
}

/// What `todo list` prints (main chat ticket 40), read for the socket's
/// `todo.list` and the CLI's direct read alike: the to-dos not done, or
/// with `all` every one (done and cancelled too), in
/// [`todo_list_order`] — read now, in this machine's zone.
pub async fn todo_list(galley: &SqliteGalley, all: bool) -> Result<Vec<TodoBrief>> {
    let scope = if all {
        TodoListScope::All
    } else {
        TodoListScope::Open
    };
    let todos = galley.list_todos(scope).await?;
    Ok(todo_list_order(todos, Utc::now(), &chrono::Local))
}

/// The to-dos Galley noted in the main chat (main chat ticket 43), every
/// one — not done, done however long ago, cancelled — for the cards under
/// the replies that noted them: a card stays under its reply for good,
/// where 已完成 lets a done one go after [`RECENT_WINDOW_DAYS`] and holds
/// no cancelled one. In the order they were noted ([`noted_items`]).
/// Empty on the external runtime (it has no assistant: to-dos noted on the
/// managed one stay out of its sight) and before there is a main chat.
/// Read now, in this machine's zone (Tauri `list_noted_todos`).
pub async fn noted_todos(galley: &SqliteGalley, now: DateTime<Utc>) -> Result<Vec<TodoItem>> {
    if galley.active_runtime_kind().await? != RuntimeKind::Managed {
        return Ok(Vec::new());
    }
    let Some(main) = galley.main_chat_id().await? else {
        return Ok(Vec::new());
    };
    let todos = galley.list_todos(TodoListScope::All).await?;
    Ok(noted_items(&todos, &main, now, &chrono::Local))
}

/// [`noted_todos`] from what was read: the to-dos noted in a turn of
/// `main_chat`, oldest first (same second: by id, as the list orders),
/// each as the list words it — not done (overdue read at `now` in `tz`),
/// done (`at` is when it was ticked off), or cancelled
/// ([`TodoItem::cancelled_at`]; `state` and `at` as it stood, never
/// overdue). Pure.
pub fn noted_items<Tz: TimeZone>(
    todos: &[TodoBrief],
    main_chat: &SessionId,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Vec<TodoItem>
where
    Tz::Offset: std::fmt::Display,
{
    let mut noted: Vec<&TodoBrief> = todos
        .iter()
        .filter(|todo| {
            todo.created_in
                .as_ref()
                .is_some_and(|turn| turn.session_id == *main_chat)
        })
        .collect();
    noted.sort_by(|a, b| {
        parse_utc_secs(&a.created_at)
            .cmp(&parse_utc_secs(&b.created_at))
            .then_with(|| a.id.as_str().cmp(b.id.as_str()))
    });
    noted
        .into_iter()
        .map(|todo| {
            let done = todo.done_at.is_some();
            let (state, at) = if done {
                (TodoState::Done, todo.done_at.clone())
            } else {
                (TodoState::Open, None)
            };
            let overdue = todo.status == TodoStatus::Open
                && todo.stored_due().is_some_and(|due| due.overdue(now, tz));
            todo_item(todo, state, at, overdue, tz)
        })
        .collect()
}

/// The main chat's read for its 「在办的事」 (ticket 61): [`assistant_todo`]
/// as the desktop reads it, and [`declined_follow_ups`]. A failed read of
/// the second is logged and leaves it empty: the rest of the lines beat
/// none.
pub async fn in_hand_read(
    galley: &SqliteGalley,
    runners: &RunnerManager,
    now: DateTime<Utc>,
) -> Result<InHandRead> {
    let todo = assistant_todo(galley, runners, now).await?;
    let declined = match declined_follow_ups(galley, now).await {
        Ok(declined) => declined,
        Err(e) => {
            eprintln!("[main chat] reading the follow-ups turned down failed: {e}");
            Vec::new()
        }
    };
    Ok(InHandRead { todo, declined })
}

/// The follow-ups the user turned down (ticket 61, PRD ruling 113), read
/// now: every to-do and task, cancelled ones included, through
/// [`declined_items`]. The main chat's alone: the desktop's 「待办」 does
/// not read it (see the module docs).
pub async fn declined_follow_ups(
    galley: &SqliteGalley,
    now: DateTime<Utc>,
) -> Result<Vec<DeclinedFollowUp>> {
    let todos = galley.list_todos(TodoListScope::All).await?;
    let tasks = galley
        .list_scheduled_tasks_in(ScheduleListScope::All)
        .await?;
    Ok(declined_items(&todos, &tasks, now))
}

/// [`declined_follow_ups`] from what was read: the to-dos and tasks
/// Galley made that were cancelled within [`DECLINED_WINDOW_DAYS`] of
/// `now` (exactly 90 days back is in) by the user at the desktop or by
/// Galley at the user's request, most recently cancelled first (the same
/// second: by id). A to-do's reminder is a task of its own here: the
/// user cancelling it is turning that reminder down, while Core
/// cancelling it with its to-do is not. Pure.
pub fn declined_items(
    todos: &[TodoBrief],
    tasks: &[ScheduledTaskBrief],
    now: DateTime<Utc>,
) -> Vec<DeclinedFollowUp> {
    let since = now.timestamp() - DECLINED_WINDOW_DAYS * 86_400;
    let mut declined: Vec<(i64, DeclinedFollowUp)> = todos
        .iter()
        .filter_map(|todo| {
            declined_one(
                TodoKind::Todo,
                todo.id.as_str(),
                &todo.title,
                Some(&todo.origin),
                todo.cancelled_at.as_deref(),
                todo.cancelled_by.as_ref(),
                since,
            )
        })
        .chain(tasks.iter().filter_map(|task| {
            declined_one(
                TodoKind::Task,
                task.id.as_str(),
                &task.prompt,
                task.origin.as_ref(),
                task.cancelled_at.as_deref(),
                task.cancelled_by.as_ref(),
                since,
            )
        }))
        .collect();
    declined.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    declined.into_iter().map(|(_, item)| item).collect()
}

/// One to-do or task as a follow-up turned down, with the instant it was
/// cancelled, or `None` when it is not one ([`declined_items`]).
fn declined_one(
    kind: TodoKind,
    id: &str,
    text: &str,
    made_by: Option<&Origin>,
    cancelled_at: Option<&str>,
    cancelled_by: Option<&Origin>,
    since: i64,
) -> Option<(i64, DeclinedFollowUp)> {
    if made_by?.supervisor.as_deref() != Some(ASSISTANT_SUPERVISOR) {
        return None;
    }
    let cancelled_at = cancelled_at?;
    let at = parse_utc_secs(cancelled_at).filter(|&at| at >= since)?;
    let by = cancelled_by?;
    let who = match by.via {
        OriginVia::Gui => DeclinedBy::User,
        OriginVia::Supervisor if by.supervisor.as_deref() == Some(ASSISTANT_SUPERVISOR) => {
            DeclinedBy::Assistant
        }
        _ => return None,
    };
    let reason = by
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_string);
    Some((
        at,
        DeclinedFollowUp {
            kind,
            id: id.to_string(),
            text: text.to_string(),
            cancelled_at: cancelled_at.to_string(),
            by: who,
            reason,
        },
    ))
}

fn window_start(now: DateTime<Utc>) -> i64 {
    now.timestamp() - RECENT_WINDOW_DAYS * 86_400
}

/// The four groups from what was read. Pure: `now` decides the window,
/// and with `tz` (production passes this machine's zone) what today is.
pub fn build_todo<Tz: TimeZone>(
    todos: &[TodoBrief],
    tasks: &[ScheduledTaskBrief],
    subtasks: &[SubtaskFacts],
    now: DateTime<Utc>,
    tz: &Tz,
) -> AssistantTodo
where
    Tz::Offset: std::fmt::Display,
{
    let since = window_start(now);
    let today = now.with_timezone(tz).date_naive();
    // (overdue, due by, noted at, id) orders today's and later's.
    let mut today_items: Vec<((bool, i64, String, String), TodoItem)> = Vec::new();
    let mut later: Vec<((i64, String, String), TodoItem)> = Vec::new();
    let mut anytime: Vec<((String, String), TodoItem)> = Vec::new();
    let mut assistant_tasks = Vec::new();
    let mut subtasks_on = Vec::new();
    let mut routine = Vec::new();
    let mut done = Vec::new();

    for todo in todos {
        match todo.status {
            TodoStatus::Cancelled => {}
            TodoStatus::Done => {
                let at = todo.done_at.as_deref();
                if at.and_then(parse_utc_secs).is_some_and(|t| t >= since) {
                    let item = todo_item(todo, TodoState::Done, at.map(str::to_string), false, tz);
                    done.push(item);
                }
            }
            TodoStatus::Open => {
                let noted = todo.created_at.clone();
                let id = todo.id.as_str().to_string();
                match todo.stored_due() {
                    None => anytime.push((
                        (noted, id),
                        todo_item(todo, TodoState::Open, None, false, tz),
                    )),
                    Some(due) => {
                        let overdue = due.overdue(now, tz);
                        let by = due.deadline(tz).timestamp();
                        let item = todo_item(todo, TodoState::Open, None, overdue, tz);
                        if due.local_date(tz) <= today {
                            today_items.push(((!overdue, by, noted, id), item));
                        } else {
                            later.push(((by, noted, id), item));
                        }
                    }
                }
            }
        }
    }

    for task in tasks {
        // A to-do's reminder shows on its to-do.
        if task.cancelled_at.is_some() || task.todo_id.is_some() {
            continue;
        }
        let once = task.repeat.is_once();
        let fired_once = task.once_fired();
        if !fired_once {
            let (state, at) = if task.enabled {
                (TodoState::Scheduled, task.next_fire_at.clone())
            } else if once {
                // A paused one-off keeps its planned time.
                (TodoState::Paused, task.fire_at.clone())
            } else {
                // A paused routine has no next fire (its rule is shown).
                (TodoState::Paused, None)
            };
            let item = task_item(task, state, at, None);
            if once {
                assistant_tasks.push(item);
            } else {
                routine.push(item);
            }
        }
        // A one-off's fire counts once it fired for its time (a manual
        // run before it does not); a routine's last fire counts. The
        // morning review's does not (ticket 73): it did nothing for the
        // user by itself, and what it did shows on its own.
        let counts = (fired_once || !once) && !task.is_review();
        if let Some(fired) = task.last_fired_at.as_deref() {
            if counts && parse_utc_secs(fired).is_some_and(|at| at >= since) {
                let run = (task.target == ScheduleTarget::Session)
                    .then(|| task.last_run_session_id.as_ref())
                    .flatten()
                    .map(|id| id.as_str().to_string());
                done.push(task_item(
                    task,
                    TodoState::Fired,
                    Some(fired.to_string()),
                    run,
                ));
            }
        }
    }

    for facts in subtasks {
        let state = subtask_state(facts);
        let moved = parse_utc_secs(&facts.row.last_activity_at).is_some_and(|at| at >= since);
        let item = subtask_item(facts, state);
        match state {
            TodoState::Done if moved => done.push(item),
            TodoState::Done => {}
            TodoState::Running => subtasks_on.push(item),
            _ if moved => subtasks_on.push(item),
            _ => {}
        }
    }

    today_items.sort_by(|a, b| a.0.cmp(&b.0));
    later.sort_by(|a, b| a.0.cmp(&b.0));
    // In the order they were noted: a notebook adds at the bottom.
    anytime.sort_by(|a, b| a.0.cmp(&b.0));
    let soonest_paused_last = |a: &TodoItem, b: &TodoItem| {
        (a.state == TodoState::Paused)
            .cmp(&(b.state == TodoState::Paused))
            .then_with(|| secs_or_last(a).cmp(&secs_or_last(b)))
            .then_with(|| a.id.cmp(&b.id))
    };
    assistant_tasks.sort_by(soonest_paused_last);
    routine.sort_by(soonest_paused_last);
    let newest_first = |a: &TodoItem, b: &TodoItem| {
        secs_or_first(b)
            .cmp(&secs_or_first(a))
            .then_with(|| a.id.cmp(&b.id))
    };
    subtasks_on.sort_by(newest_first);
    done.sort_by(newest_first);
    let done_omitted = done.len().saturating_sub(RECENT_LIMIT) as u32;
    done.truncate(RECENT_LIMIT);

    let today: Vec<TodoItem> = today_items.into_iter().map(|(_, item)| item).collect();
    let today_count = today.len() as u32;
    let mut assistant = subtasks_on;
    assistant.extend(assistant_tasks);
    AssistantTodo {
        yours: YourTodos {
            today,
            later: later.into_iter().map(|(_, item)| item).collect(),
            anytime: anytime.into_iter().map(|(_, item)| item).collect(),
        },
        assistant,
        routine,
        done,
        done_omitted,
        today_count,
    }
}

/// The order `todo list` prints (main chat ticket 40): the to-dos not
/// done in the order 你的事 lists them ([`build_todo`]'s today, later and
/// any time, read in `tz` at `now`), then the done ones, most recently
/// ticked off first, then the cancelled ones, most recently cancelled
/// first. The order is the list's alone; it decides no membership.
pub fn todo_list_order<Tz: TimeZone>(
    todos: Vec<TodoBrief>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Vec<TodoBrief>
where
    Tz::Offset: std::fmt::Display,
{
    let position: std::collections::HashMap<String, usize> = build_todo(&todos, &[], &[], now, tz)
        .yours
        .iter()
        .enumerate()
        .map(|(at, item)| (item.id.clone(), at))
        .collect();
    let (mut open, mut done, mut cancelled) = (Vec::new(), Vec::new(), Vec::new());
    for todo in todos {
        match todo.status {
            TodoStatus::Open => open.push(todo),
            TodoStatus::Done => done.push(todo),
            TodoStatus::Cancelled => cancelled.push(todo),
        }
    }
    open.sort_by_key(|todo| {
        position
            .get(todo.id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
    });
    let newest_first = |a: &Option<String>, b: &Option<String>| {
        b.as_deref()
            .and_then(parse_utc_secs)
            .cmp(&a.as_deref().and_then(parse_utc_secs))
    };
    done.sort_by(|a, b| newest_first(&a.done_at, &b.done_at));
    cancelled.sort_by(|a, b| newest_first(&a.cancelled_at, &b.cancelled_at));
    open.into_iter().chain(done).chain(cancelled).collect()
}

fn secs_or_last(item: &TodoItem) -> i64 {
    item.at
        .as_deref()
        .and_then(parse_utc_secs)
        .unwrap_or(i64::MAX)
}

fn secs_or_first(item: &TodoItem) -> i64 {
    item.at
        .as_deref()
        .and_then(parse_utc_secs)
        .unwrap_or(i64::MIN)
}

/// Where a subtask stands: its live run state first, then its latest
/// run's last reply, then how its last run ended in this process.
pub fn subtask_state(facts: &SubtaskFacts) -> TodoState {
    if facts.live.open_run {
        return TodoState::Running;
    }
    if facts.live.ask_pending {
        return TodoState::Asking;
    }
    match &facts.last_reply {
        Some(reply) if reply.asks_user() => return TodoState::Asking,
        Some(reply) if reply.is_final_answer() => return TodoState::Done,
        _ => {}
    }
    match facts.live.last_exit.as_deref() {
        Some("MAX_TURNS_EXCEEDED") => TodoState::StepLimit,
        Some("DONE_WITHOUT_EXIT") => TodoState::Failed,
        _ if facts.row.start_failed && facts.last_reply.is_none() => TodoState::Failed,
        _ => TodoState::Stopped,
    }
}

/// Who an origin is. A row that cannot say predates the column: the
/// desktop's form made it.
fn creator(origin: Option<&Origin>) -> (TodoCreator, Option<String>) {
    let Some(origin) = origin else {
        return (TodoCreator::User, None);
    };
    if origin.via == OriginVia::Gui {
        return (TodoCreator::User, None);
    }
    match origin.supervisor.as_deref() {
        Some(ASSISTANT_SUPERVISOR) => (TodoCreator::Assistant, None),
        other => (TodoCreator::Agent, other.map(str::to_string)),
    }
}

fn blank(kind: TodoKind, id: String, text: String, state: TodoState) -> TodoItem {
    TodoItem {
        kind,
        id,
        text,
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

fn todo_item<Tz: TimeZone>(
    todo: &TodoBrief,
    state: TodoState,
    at: Option<String>,
    overdue: bool,
    tz: &Tz,
) -> TodoItem
where
    Tz::Offset: std::fmt::Display,
{
    let (created_by, agent) = creator(Some(&todo.origin));
    TodoItem {
        at,
        created_by,
        agent,
        created_in: todo.created_in.clone(),
        notes: todo.notes.clone(),
        due: todo.stored_due().map(|due| due.to_wire(tz)),
        overdue,
        reminder: todo.reminder.clone(),
        done_by: todo.done_by.as_ref().map(|by| creator(Some(by)).0),
        created_at: Some(todo.created_at.clone()),
        cancelled_at: todo.cancelled_at.clone(),
        ..blank(
            TodoKind::Todo,
            todo.id.as_str().to_string(),
            todo.title.clone(),
            state,
        )
    }
}

fn task_item(
    task: &ScheduledTaskBrief,
    state: TodoState,
    at: Option<String>,
    run_session_id: Option<String>,
) -> TodoItem {
    let (created_by, agent) = creator(task.origin.as_ref());
    TodoItem {
        at,
        created_by,
        agent,
        target: Some(task.target),
        repeat: Some(task.repeat.clone()),
        time_of_day: (!task.time_of_day.is_empty()).then(|| task.time_of_day.clone()),
        created_in: task.created_in.clone(),
        run_session_id,
        ..blank(
            TodoKind::Task,
            task.id.as_str().to_string(),
            task.prompt.clone(),
            state,
        )
    }
}

fn subtask_item(facts: &SubtaskFacts, state: TodoState) -> TodoItem {
    let row = &facts.row;
    let text = if row.title.trim().is_empty() {
        row.dispatch_title.clone().unwrap_or_default()
    } else {
        row.title.clone()
    };
    TodoItem {
        at: (!row.last_activity_at.is_empty()).then(|| row.last_activity_at.clone()),
        ..blank(TodoKind::Subtask, row.session_id.clone(), text, state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::schedule::ScheduledTaskId;
    use crate::api::todo::StoredDue;
    use crate::api::{TodoId, TodoReminderState};
    use chrono::NaiveDate;
    use chrono_tz::America::Los_Angeles;
    use chrono_tz::Asia::Shanghai;

    fn now() -> DateTime<Utc> {
        utc("2026-10-16T12:00:00Z")
    }

    fn utc(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    /// The tasks and subtasks alone, read in UTC.
    fn build(tasks: &[ScheduledTaskBrief], subtasks: &[SubtaskFacts]) -> AssistantTodo {
        build_todo(&[], tasks, subtasks, now(), &Utc)
    }

    fn supervisor(label: &str) -> Origin {
        Origin {
            via: OriginVia::Supervisor,
            supervisor: Some(label.into()),
            reason: None,
            client: None,
        }
    }

    fn task(id: &str) -> ScheduledTaskBrief {
        ScheduledTaskBrief {
            id: ScheduledTaskId(id.into()),
            project_id: None,
            prompt: format!("words of {id}"),
            repeat: ScheduledTaskRepeat::Once,
            time_of_day: "09:00".into(),
            fire_at: Some("2026-10-17T01:00:00+00:00".into()),
            target: ScheduleTarget::Assistant,
            llm_name: None,
            enabled: true,
            last_fired_at: None,
            last_run_session_id: None,
            next_fire_at: Some("2026-10-17T01:00:00+00:00".into()),
            last_due_at: None,
            last_wake: None,
            origin: Some(supervisor(ASSISTANT_SUPERVISOR)),
            created_in: Some(ScheduledTaskCreatedIn {
                session_id: SessionId("s-main".into()),
                turn_index: Some(7),
            }),
            cancelled_at: None,
            cancelled_by: None,
            todo_id: None,
            created_at: "2026-10-16T10:00:00+00:00".into(),
            updated_at: "2026-10-16T10:00:00+00:00".into(),
        }
    }

    fn daily(id: &str, next: &str) -> ScheduledTaskBrief {
        ScheduledTaskBrief {
            repeat: ScheduledTaskRepeat::Daily,
            fire_at: None,
            target: ScheduleTarget::Session,
            next_fire_at: Some(next.into()),
            origin: Some(Origin::gui()),
            created_in: None,
            ..task(id)
        }
    }

    fn subtask(id: &str, last_activity_at: &str) -> SubtaskFacts {
        SubtaskFacts {
            row: TodoSubtaskRow {
                session_id: id.into(),
                title: format!("title of {id}"),
                last_activity_at: last_activity_at.into(),
                dispatch_title: None,
                start_failed: false,
            },
            live: RunState::default(),
            last_reply: None,
        }
    }

    fn reply(tool_calls: Option<&str>) -> Option<LastRunReply> {
        Some(LastRunReply {
            tool_calls: tool_calls.map(str::to_string),
        })
    }

    fn date(y: i32, m: u32, d: u32) -> StoredDue {
        StoredDue::Date(NaiveDate::from_ymd_opt(y, m, d).unwrap())
    }

    /// An open to-do Galley noted, due `due`, noted at `noted`.
    fn todo(id: &str, due: Option<StoredDue>, noted: &str) -> TodoBrief {
        TodoBrief {
            id: TodoId(id.into()),
            title: format!("title of {id}"),
            notes: None,
            due: due.map(|due| due.to_wire(&Utc)),
            reminder: None,
            status: TodoStatus::Open,
            done_at: None,
            done_by: None,
            origin: supervisor(ASSISTANT_SUPERVISOR),
            created_in: Some(ScheduledTaskCreatedIn {
                session_id: SessionId("s-main".into()),
                turn_index: Some(3),
            }),
            cancelled_at: None,
            cancelled_by: None,
            created_at: noted.into(),
            updated_at: noted.into(),
        }
    }

    fn done_todo(id: &str, done_at: &str, by: Origin) -> TodoBrief {
        TodoBrief {
            status: TodoStatus::Done,
            done_at: Some(done_at.into()),
            done_by: Some(by),
            ..todo(id, None, "2026-10-01T00:00:00+00:00")
        }
    }

    fn ids<'a>(items: impl IntoIterator<Item = &'a TodoItem>) -> Vec<&'a str> {
        items.into_iter().map(|i| i.id.as_str()).collect()
    }

    // ---- the user's to-dos (ticket 39) ----

    #[test]
    fn yours_today_later_and_any_time() {
        // Now: Fri 2026-10-16 12:00 UTC.
        let noted = "2026-10-10T00:00:00+00:00";
        let todos = [
            todo("t-anytime-new", None, "2026-10-12T00:00:00+00:00"),
            todo("t-anytime-old", None, "2026-10-11T00:00:00+00:00"),
            todo("t-later-day", Some(date(2026, 10, 20)), noted),
            todo(
                "t-later-time",
                Some(StoredDue::At(utc("2026-10-17T09:00:00Z"))),
                noted,
            ),
            todo("t-today-day", Some(date(2026, 10, 16)), noted),
            todo(
                "t-today-time",
                Some(StoredDue::At(utc("2026-10-16T15:00:00Z"))),
                noted,
            ),
            todo(
                "t-today-passed",
                Some(StoredDue::At(utc("2026-10-16T09:00:00Z"))),
                noted,
            ),
            todo("t-last-week", Some(date(2026, 10, 9)), noted),
        ];
        let got = build_todo(&todos, &[], &[], now(), &Utc);
        // Overdue first (the oldest first), then today by when it is due;
        // a day without a time is due by its end.
        assert_eq!(
            ids(&got.yours.today),
            [
                "t-last-week",
                "t-today-passed",
                "t-today-time",
                "t-today-day"
            ]
        );
        let overdue: Vec<bool> = got.yours.today.iter().map(|i| i.overdue).collect();
        assert_eq!(overdue, [true, true, false, false]);
        assert_eq!(ids(&got.yours.later), ["t-later-time", "t-later-day"]);
        // Any time: in the order they were noted.
        assert_eq!(ids(&got.yours.anytime), ["t-anytime-old", "t-anytime-new"]);
        assert_eq!(got.today_count, 4);
        assert!(got.yours.iter().all(|i| i.kind == TodoKind::Todo));
        assert!(got.yours.iter().all(|i| i.state == TodoState::Open));
        assert!(got.assistant.is_empty() && got.routine.is_empty() && got.done.is_empty());
    }

    #[test]
    fn todo_list_prints_yours_in_order_then_done_then_cancelled() {
        let noted = "2026-10-10T00:00:00+00:00";
        let cancelled = |id: &str, at: &str| TodoBrief {
            status: TodoStatus::Cancelled,
            cancelled_at: Some(at.into()),
            ..todo(id, None, noted)
        };
        let todos = vec![
            cancelled("t-cancelled-old", "2026-10-12T00:00:00+00:00"),
            done_todo("t-done-old", "2026-10-13T00:00:00+00:00", Origin::gui()),
            todo("t-anytime", None, "2026-10-11T00:00:00+00:00"),
            cancelled("t-cancelled-new", "2026-10-15T00:00:00+00:00"),
            todo("t-later", Some(date(2026, 10, 20)), noted),
            done_todo("t-done-new", "2026-10-15T00:00:00+00:00", Origin::gui()),
            todo("t-overdue", Some(date(2026, 10, 9)), noted),
            todo("t-today", Some(date(2026, 10, 16)), noted),
        ];
        let got = todo_list_order(todos, now(), &Utc);
        let order: Vec<&str> = got.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            order,
            [
                "t-overdue",
                "t-today",
                "t-later",
                "t-anytime",
                "t-done-new",
                "t-done-old",
                "t-cancelled-new",
                "t-cancelled-old",
            ]
        );
    }

    #[test]
    fn today_and_overdue_are_this_machines_days() {
        // 2026-10-16 23:30 in Shanghai is 08:30 the same day in Los
        // Angeles (UTC 15:30).
        let now = utc("2026-10-16T15:30:00Z");
        let noted = "2026-10-10T00:00:00+00:00";
        let todos = [
            // Saturday 01:00 in Shanghai; Friday 10:00 in Los Angeles.
            todo(
                "t-instant",
                Some(StoredDue::At(utc("2026-10-16T17:00:00Z"))),
                noted,
            ),
            // A day stays that day everywhere: Friday.
            todo("t-friday", Some(date(2026, 10, 16)), noted),
            // Thursday: overdue in both.
            todo("t-thursday", Some(date(2026, 10, 15)), noted),
        ];
        let shanghai = build_todo(&todos, &[], &[], now, &Shanghai);
        assert_eq!(ids(&shanghai.yours.today), ["t-thursday", "t-friday"]);
        assert_eq!(ids(&shanghai.yours.later), ["t-instant"]);
        assert_eq!(shanghai.today_count, 2);
        let la = build_todo(&todos, &[], &[], now, &Los_Angeles);
        assert_eq!(
            ids(&la.yours.today),
            ["t-thursday", "t-instant", "t-friday"]
        );
        assert_eq!(la.today_count, 3);
        // The wire's day is read in the zone too.
        let instant = &la.yours.today[1];
        let due = instant.due.as_ref().unwrap();
        assert_eq!(due.date, "2026-10-16");
        assert_eq!(due.time.as_deref(), Some("10:00"));
        assert!(due.has_time && !instant.overdue);
        let sh_due = shanghai.yours.later[0].due.as_ref().unwrap();
        assert_eq!(sh_due.date, "2026-10-17");
        assert_eq!(sh_due.time.as_deref(), Some("01:00"));
    }

    #[test]
    fn done_to_dos_within_seven_days_cancelled_nowhere() {
        let mut cancelled = todo(
            "t-cancelled",
            Some(date(2026, 10, 16)),
            "2026-10-10T00:00:00Z",
        );
        cancelled.status = TodoStatus::Cancelled;
        cancelled.cancelled_at = Some("2026-10-16T11:00:00+00:00".into());
        let todos = [
            done_todo("t-by-user", "2026-10-16T11:00:00+00:00", Origin::desktop()),
            done_todo(
                "t-edge",
                "2026-10-09T12:00:00+00:00",
                supervisor(ASSISTANT_SUPERVISOR),
            ),
            done_todo(
                "t-old",
                "2026-10-09T11:59:59+00:00",
                supervisor(ASSISTANT_SUPERVISOR),
            ),
            cancelled,
        ];
        let got = build_todo(&todos, &[], &[], now(), &Utc);
        assert!(got.yours.is_empty());
        assert_eq!(got.today_count, 0);
        // Exactly seven days back is in; a second more is out.
        assert_eq!(ids(&got.done), ["t-by-user", "t-edge"]);
        assert!(got.done.iter().all(|i| i.state == TodoState::Done));
        assert_eq!(got.done[0].done_by, Some(TodoCreator::User));
        assert_eq!(got.done[1].done_by, Some(TodoCreator::Assistant));
        assert_eq!(got.done[0].at.as_deref(), Some("2026-10-16T11:00:00+00:00"));
    }

    #[test]
    fn a_to_dos_reminder_is_on_it_and_in_no_group() {
        let mut on_todo = task("sched_on");
        on_todo.todo_id = Some("t-1".into());
        let mut fired = task("sched_fired_on");
        fired.todo_id = Some("t-2".into());
        fired.last_fired_at = fired.fire_at.clone();
        let mut t1 = todo("t-1", None, "2026-10-10T00:00:00Z");
        t1.reminder = Some(TodoReminder {
            task_id: ScheduledTaskId("sched_on".into()),
            at: "2026-10-17T01:00:00+00:00".into(),
            state: TodoReminderState::Scheduled,
        });
        let todos = [
            t1,
            done_todo("t-2", "2026-10-16T11:00:00Z", Origin::desktop()),
        ];
        let got = build_todo(
            &todos,
            &[on_todo, fired, task("sched_own")],
            &[],
            now(),
            &Utc,
        );
        // Only the assistant's own reminder is Galley's.
        assert_eq!(ids(&got.assistant), ["sched_own"]);
        assert_eq!(ids(&got.done), ["t-2"]);
        let reminder = got.yours.anytime[0].reminder.as_ref().unwrap();
        assert_eq!(reminder.task_id.as_str(), "sched_on");
    }

    #[test]
    fn a_to_do_on_the_wire() {
        let mut t = todo(
            "t-1",
            Some(StoredDue::At(utc("2026-10-16T09:00:00Z"))),
            "2026-10-10T00:00:00Z",
        );
        t.notes = Some("A 座 3 楼".into());
        let got = build_todo(
            &[t, todo("t-2", None, "2026-10-11T00:00:00Z")],
            &[],
            &[],
            now(),
            &Utc,
        );
        let json = serde_json::to_value(&got).unwrap();
        assert_eq!(json["todayCount"], 1);
        assert_eq!(json["doneOmitted"], 0);
        let item = &json["yours"]["today"][0];
        assert_eq!(item["kind"], "todo");
        assert_eq!(item["state"], "open");
        assert_eq!(item["overdue"], true);
        assert_eq!(item["notes"], "A 座 3 楼");
        assert_eq!(item["due"]["hasTime"], true);
        assert_eq!(item["due"]["date"], "2026-10-16");
        assert_eq!(item["createdIn"]["turnIndex"], 3);
        assert_eq!(item["createdBy"], "assistant");
        assert!(item.get("at").is_none());
        // When it was noted (ticket 43); never cancelled in the list.
        assert_eq!(item["createdAt"], "2026-10-10T00:00:00Z");
        assert!(item.get("cancelledAt").is_none());
        // Not overdue: no field at all.
        assert!(json["yours"]["anytime"][0].get("overdue").is_none());
        assert!(json["yours"]["anytime"][0].get("due").is_none());
        assert_eq!(
            json["yours"]["anytime"][0]["createdAt"],
            "2026-10-11T00:00:00Z"
        );
        // A task or a subtask carries no 「记下」 day.
        let tasks = build(
            &[task("t-task")],
            &[subtask("s-sub", "2026-10-16T11:00:00Z")],
        );
        let json = serde_json::to_value(&tasks).unwrap();
        assert!(json["assistant"][0].get("createdAt").is_none());
        assert!(json["assistant"][1].get("createdAt").is_none());
    }

    // ---- the cards under the replies (ticket 43) ----

    #[test]
    fn the_cards_read_every_to_do_noted_in_the_main_chat_in_the_order_noted() {
        // Now: Fri 2026-10-16 12:00 UTC.
        let main = SessionId("s-main".into());
        let noted_at = |mut t: TodoBrief, at: &str| {
            t.created_at = at.into();
            t
        };
        let cancel = |mut t: TodoBrief, at: &str| {
            t.status = TodoStatus::Cancelled;
            t.cancelled_at = Some(at.into());
            t
        };
        // Ticked off a month ago: out of 已完成, still a card.
        let long_done = noted_at(
            done_todo(
                "t-long-done",
                "2026-09-16T00:00:00+00:00",
                Origin::desktop(),
            ),
            "2026-09-15T00:00:00+00:00",
        );
        // Cancelled while due last week: not overdue, as it stood.
        let cancelled = cancel(
            todo(
                "t-cancelled",
                Some(date(2026, 10, 9)),
                "2026-10-03T00:00:00+00:00",
            ),
            "2026-10-05T00:00:00+00:00",
        );
        // Ticked off, then cancelled: done as it stood.
        let done_cancelled = cancel(
            noted_at(
                done_todo(
                    "t-done-cancelled",
                    "2026-10-04T00:00:00+00:00",
                    Origin::gui(),
                ),
                "2026-10-03T12:00:00+00:00",
            ),
            "2026-10-06T00:00:00+00:00",
        );
        let overdue = todo(
            "t-overdue",
            Some(date(2026, 10, 9)),
            "2026-10-04T00:00:00+00:00",
        );
        // Noted in another conversation, or outside a turn: no card here.
        let mut elsewhere = todo("t-elsewhere", None, "2026-10-05T00:00:00+00:00");
        elsewhere.created_in = Some(ScheduledTaskCreatedIn {
            session_id: SessionId("s-other".into()),
            turn_index: Some(2),
        });
        let mut nowhere = todo("t-nowhere", None, "2026-10-05T00:00:00+00:00");
        nowhere.created_in = None;
        // The same second: by id, as the list orders.
        let same_b = todo("t-same-b", None, "2026-10-06T00:00:00+00:00");
        let same_a = todo("t-same-a", None, "2026-10-06T00:00:00+00:00");
        let todos = [
            same_b,
            overdue,
            cancelled,
            elsewhere,
            done_cancelled,
            long_done,
            nowhere,
            same_a,
        ];
        let got = noted_items(&todos, &main, now(), &Utc);
        assert_eq!(
            ids(&got),
            [
                "t-long-done",
                "t-cancelled",
                "t-done-cancelled",
                "t-overdue",
                "t-same-a",
                "t-same-b",
            ]
        );
        assert!(got.iter().all(|i| i.kind == TodoKind::Todo));
        let long_done = &got[0];
        assert_eq!(long_done.state, TodoState::Done);
        assert_eq!(long_done.at.as_deref(), Some("2026-09-16T00:00:00+00:00"));
        assert_eq!(long_done.done_by, Some(TodoCreator::User));
        assert!(long_done.cancelled_at.is_none());
        let cancelled = &got[1];
        assert_eq!(cancelled.state, TodoState::Open);
        assert_eq!(
            cancelled.cancelled_at.as_deref(),
            Some("2026-10-05T00:00:00+00:00")
        );
        assert!(!cancelled.overdue && cancelled.at.is_none());
        assert_eq!(got[2].state, TodoState::Done);
        assert!(got[2].cancelled_at.is_some());
        assert!(got[3].overdue && got[3].cancelled_at.is_none());
        assert_eq!(
            got[3].created_at.as_deref(),
            Some("2026-10-04T00:00:00+00:00")
        );
        // The list itself lets the month-old one go and holds no
        // cancelled one.
        let list = build_todo(&todos, &[], &[], now(), &Utc);
        assert!(list.done.is_empty());
        assert!(!list.yours.iter().any(|i| i.id == "t-cancelled"));
        // On the wire.
        let json = serde_json::to_value(&got).unwrap();
        assert_eq!(json[1]["state"], "open");
        assert_eq!(json[1]["cancelledAt"], "2026-10-05T00:00:00+00:00");
        assert_eq!(json[1]["createdAt"], "2026-10-03T00:00:00+00:00");
        assert!(json[1].get("overdue").is_none());
        assert!(json[0].get("cancelledAt").is_none());
        // Another main chat: none of these.
        assert!(noted_items(&todos, &SessionId("s-new".into()), now(), &Utc).is_empty());
    }

    // ---- tasks and subtasks (ticket 37's rules, regrouped) ----

    #[test]
    fn one_offs_are_galleys_and_repeating_tasks_routine() {
        let mut later = task("t-later");
        later.next_fire_at = Some("2026-10-20T01:00:00+00:00".into());
        later.fire_at = later.next_fire_at.clone();
        let soon = daily("t-daily", "2026-10-16T13:00:00+00:00");
        let mut paused = daily("t-paused", "2026-10-16T12:30:00+00:00");
        paused.enabled = false;
        paused.next_fire_at = None;
        let mut overdue = task("t-overdue");
        // Asleep past its time: still to go off (it fires on the next
        // tick), first.
        overdue.fire_at = Some("2026-10-16T08:00:00+00:00".into());
        overdue.next_fire_at = overdue.fire_at.clone();
        let mut session_once = task("t-session-once");
        session_once.target = ScheduleTarget::Session;
        session_once.fire_at = Some("2026-10-18T01:00:00+00:00".into());
        session_once.next_fire_at = session_once.fire_at.clone();
        let todo = build(
            &[later, paused, soon, overdue, task("t-once"), session_once],
            &[],
        );
        // Either target of a one-off is Galley's.
        assert_eq!(
            ids(&todo.assistant),
            ["t-overdue", "t-once", "t-session-once", "t-later"]
        );
        assert_eq!(ids(&todo.routine), ["t-daily", "t-paused"]);
        let paused = todo.routine.last().unwrap();
        assert_eq!(paused.state, TodoState::Paused);
        assert_eq!(paused.at, None);
        assert!(todo.yours.is_empty() && todo.done.is_empty());
    }

    #[test]
    fn a_paused_one_off_keeps_its_time_and_goes_last() {
        let mut t = task("t-1");
        t.enabled = false;
        t.next_fire_at = None;
        let mut sooner = task("t-0");
        sooner.fire_at = Some("2026-10-18T01:00:00+00:00".into());
        sooner.next_fire_at = sooner.fire_at.clone();
        let todo = build(&[t, sooner], &[]);
        assert_eq!(ids(&todo.assistant), ["t-0", "t-1"]);
        assert_eq!(todo.assistant[1].state, TodoState::Paused);
        assert_eq!(
            todo.assistant[1].at.as_deref(),
            Some("2026-10-17T01:00:00+00:00")
        );
    }

    #[test]
    fn cancelled_tasks_are_in_no_group() {
        let mut t = task("t-1");
        t.cancelled_at = Some("2026-10-16T11:00:00+00:00".into());
        let mut d = daily("t-2", "2026-10-17T01:00:00+00:00");
        d.last_fired_at = Some("2026-10-16T01:00:00+00:00".into());
        d.cancelled_at = Some("2026-10-16T11:00:00+00:00".into());
        assert_eq!(build(&[t, d], &[]), AssistantTodo::default());
    }

    #[test]
    fn a_fired_one_off_is_done_within_seven_days() {
        let fired = |id: &str, at: &str| {
            let mut t = task(id);
            t.fire_at = Some(at.into());
            t.last_due_at = Some(at.into());
            t.last_fired_at = Some(at.into());
            t.next_fire_at = None;
            t
        };
        let todo = build(
            &[
                fired("t-edge", "2026-10-09T12:00:00+00:00"),
                fired("t-old", "2026-10-09T11:59:59+00:00"),
                fired("t-new", "2026-10-16T11:00:00+00:00"),
            ],
            &[],
        );
        assert!(todo.assistant.is_empty());
        // Exactly seven days back is in; a second more is out.
        assert_eq!(ids(&todo.done), ["t-new", "t-edge"]);
        assert!(todo.done.iter().all(|i| i.state == TodoState::Fired));
        assert_eq!(
            todo.done[0].at.as_deref(),
            Some("2026-10-16T11:00:00+00:00")
        );
    }

    #[test]
    fn a_manual_run_before_its_time_leaves_a_one_off_to_go_off() {
        let mut t = task("t-1");
        t.target = ScheduleTarget::Session;
        t.last_fired_at = Some("2026-10-16T11:00:00+00:00".into());
        t.last_run_session_id = Some(SessionId("s-run".into()));
        let todo = build(&[t], &[]);
        assert_eq!(ids(&todo.assistant), ["t-1"]);
        assert!(todo.done.is_empty());
    }

    #[test]
    fn a_routine_and_its_last_run() {
        let mut d = daily("t-daily", "2026-10-17T01:00:00+00:00");
        d.last_fired_at = Some("2026-10-16T01:00:00+00:00".into());
        d.last_run_session_id = Some(SessionId("s-run".into()));
        let mut stale = daily("t-stale", "2026-10-17T02:00:00+00:00");
        stale.last_fired_at = Some("2026-10-01T02:00:00+00:00".into());
        let todo = build(&[d, stale], &[]);
        assert_eq!(ids(&todo.routine), ["t-daily", "t-stale"]);
        assert_eq!(ids(&todo.done), ["t-daily"]);
        let run = &todo.done[0];
        assert_eq!(run.state, TodoState::Fired);
        assert_eq!(run.run_session_id.as_deref(), Some("s-run"));
        assert_eq!(run.created_by, TodoCreator::User);
    }

    #[test]
    fn creators() {
        let mut agent = task("t-agent");
        agent.origin = Some(supervisor("claude-code"));
        let mut cli = task("t-cli");
        cli.origin = Some(Origin::cli(None, None));
        let mut legacy = task("t-legacy");
        legacy.origin = None;
        let mut gui = task("t-gui");
        gui.origin = Some(Origin::gui());
        let todo = build(&[agent, cli, legacy, gui, task("t-assistant")], &[]);
        let by = |id: &str| {
            let item = todo.assistant.iter().find(|i| i.id == id).unwrap();
            (item.created_by, item.agent.clone())
        };
        assert_eq!(
            by("t-agent"),
            (TodoCreator::Agent, Some("claude-code".into()))
        );
        assert_eq!(by("t-cli"), (TodoCreator::Agent, None));
        assert_eq!(by("t-legacy"), (TodoCreator::User, None));
        assert_eq!(by("t-gui"), (TodoCreator::User, None));
        assert_eq!(by("t-assistant"), (TodoCreator::Assistant, None));
    }

    #[test]
    fn an_item_carries_where_it_leads() {
        let todo = build(&[task("t-1")], &[]);
        let item = &todo.assistant[0];
        assert_eq!(item.kind, TodoKind::Task);
        assert_eq!(item.text, "words of t-1");
        assert_eq!(item.target, Some(ScheduleTarget::Assistant));
        assert_eq!(item.repeat, Some(ScheduledTaskRepeat::Once));
        assert_eq!(
            item.created_in,
            Some(ScheduledTaskCreatedIn {
                session_id: SessionId("s-main".into()),
                turn_index: Some(7),
            })
        );
        let json = serde_json::to_value(item).unwrap();
        assert_eq!(json["createdBy"], "assistant");
        assert_eq!(json["createdIn"]["turnIndex"], 7);
        assert_eq!(json["state"], "scheduled");
        assert_eq!(json["repeat"]["kind"], "once");
        assert!(json.get("runSessionId").is_none());
        assert!(json.get("overdue").is_none() && json.get("doneBy").is_none());
    }

    #[test]
    fn subtask_states() {
        let base = subtask("s-1", "2026-10-16T11:00:00+00:00");
        let with = |live: RunState, last_reply: Option<LastRunReply>| {
            subtask_state(&SubtaskFacts {
                live,
                last_reply,
                ..base.clone()
            })
        };
        let ask = r#"[{"toolName":"ask_user","args":{}}]"#;
        let step = r#"[{"toolName":"web_scan","args":{}}]"#;
        let open = RunState {
            open_run: true,
            ..RunState::default()
        };
        let exit = |reason: &str| RunState {
            last_exit: Some(reason.into()),
            ..RunState::default()
        };
        assert_eq!(with(open.clone(), reply(None)), TodoState::Running);
        assert_eq!(
            with(
                RunState {
                    ask_pending: true,
                    ..RunState::default()
                },
                None
            ),
            TodoState::Asking
        );
        // After a restart the run state is gone: the rows still say.
        assert_eq!(
            with(RunState::default(), reply(Some(ask))),
            TodoState::Asking
        );
        assert_eq!(with(RunState::default(), reply(None)), TodoState::Done);
        assert_eq!(
            with(
                RunState::default(),
                reply(Some(r#"[{"toolName":"no_tool"}]"#))
            ),
            TodoState::Done
        );
        assert_eq!(
            with(exit("MAX_TURNS_EXCEEDED"), reply(Some(step))),
            TodoState::StepLimit
        );
        assert_eq!(
            with(exit("DONE_WITHOUT_EXIT"), reply(Some(step))),
            TodoState::Failed
        );
        assert_eq!(with(exit("ABORTED"), reply(Some(step))), TodoState::Stopped);
        assert_eq!(
            with(RunState::default(), reply(Some(step))),
            TodoState::Stopped
        );
        assert_eq!(with(RunState::default(), None), TodoState::Stopped);
        let failed_start = SubtaskFacts {
            row: TodoSubtaskRow {
                start_failed: true,
                ..base.row.clone()
            },
            ..base.clone()
        };
        assert_eq!(subtask_state(&failed_start), TodoState::Failed);
    }

    #[test]
    fn galleys_subtasks_by_latest_activity_then_its_tasks() {
        let running_old = SubtaskFacts {
            live: RunState {
                open_run: true,
                ..RunState::default()
            },
            ..subtask("s-running-old", "2026-10-01T00:00:00+00:00")
        };
        let asking = SubtaskFacts {
            last_reply: reply(Some(r#"[{"toolName":"ask_user"}]"#)),
            ..subtask("s-asking", "2026-10-16T11:30:00+00:00")
        };
        let stopped = subtask("s-stopped", "2026-10-15T00:00:00+00:00");
        let stale = subtask("s-stale", "2026-10-09T11:59:59+00:00");
        let done = SubtaskFacts {
            last_reply: reply(None),
            ..subtask("s-done", "2026-10-16T09:00:00+00:00")
        };
        let done_old = SubtaskFacts {
            last_reply: reply(None),
            ..subtask("s-done-old", "2026-10-09T11:59:59+00:00")
        };
        let todo = build(
            &[task("t-wake")],
            &[running_old, asking, stopped, stale, done, done_old],
        );
        // Running whatever its age; not running only within the window;
        // the subtasks before the tasks.
        assert_eq!(
            ids(&todo.assistant),
            ["s-asking", "s-stopped", "s-running-old", "t-wake"]
        );
        assert_eq!(ids(&todo.done), ["s-done"]);
        let item = &todo.done[0];
        assert_eq!(item.kind, TodoKind::Subtask);
        assert_eq!(item.state, TodoState::Done);
        assert_eq!(item.created_by, TodoCreator::Assistant);
        assert_eq!(item.text, "title of s-done");
    }

    #[test]
    fn subtask_text_falls_back_to_the_dispatch_title() {
        let mut facts = subtask("s-1", "2026-10-16T11:00:00+00:00");
        facts.row.title = String::new();
        facts.row.dispatch_title = Some("查物流".into());
        let todo = build(&[], &[facts]);
        assert_eq!(todo.assistant[0].text, "查物流");
    }

    #[test]
    fn done_mixes_kinds_newest_first_and_is_capped() {
        let mut tasks = Vec::new();
        for i in 0..(RECENT_LIMIT + 3) {
            let mut t = task(&format!("t-{i:03}"));
            let at = format!(
                "2026-10-16T{:02}:{:02}:00+00:00",
                10 - (i / 60) as u32,
                i % 60
            );
            t.fire_at = Some(at.clone());
            t.last_fired_at = Some(at);
            t.next_fire_at = None;
            tasks.push(t);
        }
        let done = SubtaskFacts {
            last_reply: reply(None),
            ..subtask("s-done", "2026-10-16T11:00:00+00:00")
        };
        let todos = [done_todo(
            "todo-done",
            "2026-10-16T11:30:00+00:00",
            Origin::desktop(),
        )];
        let got = build_todo(&todos, &tasks, &[done], now(), &Utc);
        assert_eq!(got.done.len(), RECENT_LIMIT);
        assert_eq!(got.done_omitted, 5);
        assert_eq!(ids(&got.done[..3]), ["todo-done", "s-done", "t-052"]);
    }

    // ---- the follow-ups turned down (ticket 61) ----

    fn cancelled_by(via: OriginVia, label: Option<&str>, reason: Option<&str>) -> Origin {
        Origin {
            via,
            supervisor: label.map(str::to_string),
            reason: reason.map(str::to_string),
            client: None,
        }
    }

    fn cancelled_todo(id: &str, at: &str, by: Option<Origin>) -> TodoBrief {
        TodoBrief {
            status: TodoStatus::Cancelled,
            cancelled_at: Some(at.into()),
            cancelled_by: by,
            ..todo(id, None, "2026-07-01T00:00:00+00:00")
        }
    }

    fn cancelled_task(id: &str, at: &str, by: Option<Origin>) -> ScheduledTaskBrief {
        ScheduledTaskBrief {
            cancelled_at: Some(at.into()),
            cancelled_by: by,
            next_fire_at: None,
            ..task(id)
        }
    }

    #[test]
    fn declined_are_galleys_cancelled_by_the_user_or_at_their_request() {
        // Now: Fri 2026-10-16 12:00 UTC.
        let desktop = || Some(Origin::desktop());
        let galley = |reason: Option<&str>| {
            Some(cancelled_by(
                OriginVia::Supervisor,
                Some(ASSISTANT_SUPERVISOR),
                reason,
            ))
        };
        let mut users_task = cancelled_task("t-users-task", "2026-10-15T00:00:00Z", desktop());
        users_task.origin = Some(Origin::gui());
        let mut agents_todo = cancelled_todo("t-agents-todo", "2026-10-15T00:00:00Z", desktop());
        agents_todo.origin = supervisor("claude-code");
        let mut a_reminder = cancelled_task("t-reminder", "2026-10-14T00:00:00Z", desktop());
        a_reminder.todo_id = Some("t-open".into());
        let todos = [
            cancelled_todo(
                "t-asked",
                "2026-10-16T09:00:00Z",
                galley(Some("  用户说装修这类别提醒 ")),
            ),
            cancelled_todo("t-desktop", "2026-10-13T00:00:00Z", desktop()),
            // Core on its own, another agent, through the CLI with no
            // label, before 051: none of them the user's no.
            cancelled_todo("t-system", "2026-10-16T09:00:00Z", Some(Origin::system())),
            cancelled_todo(
                "t-other-agent",
                "2026-10-16T09:00:00Z",
                Some(supervisor("claude-code")),
            ),
            cancelled_todo(
                "t-cli",
                "2026-10-16T09:00:00Z",
                Some(Origin::cli(None, Some("x".into()))),
            ),
            cancelled_todo("t-unknown", "2026-10-16T09:00:00Z", None),
            // Not Galley's.
            agents_todo,
            // Not cancelled.
            todo("t-open", None, "2026-10-10T00:00:00Z"),
            done_todo("t-done", "2026-10-16T09:00:00Z", Origin::desktop()),
        ];
        let tasks = [
            cancelled_task("t-card", "2026-10-16T10:00:00Z", desktop()),
            cancelled_task("t-released", "2026-10-16T10:00:00Z", Some(Origin::system())),
            users_task,
            a_reminder,
            task("t-live"),
        ];
        let got = declined_items(&todos, &tasks, now());
        // Newest first, to-dos and tasks together; a to-do's reminder the
        // user cancelled is one of its own.
        let order: Vec<&str> = got.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(order, ["t-card", "t-asked", "t-reminder", "t-desktop"]);
        assert_eq!(got[0].kind, TodoKind::Task);
        assert_eq!(got[0].by, DeclinedBy::User);
        assert_eq!(got[0].text, "words of t-card");
        assert_eq!(got[1].kind, TodoKind::Todo);
        assert_eq!(got[1].by, DeclinedBy::Assistant);
        assert_eq!(got[1].text, "title of t-asked");
        // The reason, trimmed; none when the cancel gave none.
        assert_eq!(got[1].reason.as_deref(), Some("用户说装修这类别提醒"));
        assert_eq!(got[0].reason, None);
        assert_eq!(got[1].cancelled_at, "2026-10-16T09:00:00Z");
        // On the wire (the eval's mirror reads this shape).
        let json = serde_json::to_value(&got[1]).unwrap();
        assert_eq!(json["kind"], "todo");
        assert_eq!(json["by"], "assistant");
        assert_eq!(json["cancelledAt"], "2026-10-16T09:00:00Z");
        assert!(serde_json::to_value(&got[0])
            .unwrap()
            .get("reason")
            .is_none());
    }

    #[test]
    fn declined_reach_back_ninety_days() {
        // Now: 2026-10-16 12:00 UTC; ninety days back: 2026-07-18 12:00.
        let by = || Some(Origin::desktop());
        let todos = [
            cancelled_todo("t-edge", "2026-07-18T12:00:00+00:00", by()),
            cancelled_todo("t-old", "2026-07-18T11:59:59+00:00", by()),
            cancelled_todo("t-bad", "not a time", by()),
        ];
        let tasks = [cancelled_task("t-recent", "2026-10-16T11:59:00Z", by())];
        let got = declined_items(&todos, &tasks, now());
        let order: Vec<&str> = got.iter().map(|d| d.id.as_str()).collect();
        // Exactly ninety days back is in; a second more is out.
        assert_eq!(order, ["t-recent", "t-edge"]);
        assert_eq!(DECLINED_WINDOW_DAYS, 90);
        // The same second: by id.
        let same = [
            cancelled_todo("t-b", "2026-10-16T09:00:00Z", by()),
            cancelled_todo("t-a", "2026-10-16T09:00:00Z", by()),
        ];
        let order: Vec<String> = declined_items(&same, &[], now())
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(order, ["t-a", "t-b"]);
    }

    #[test]
    fn empty_is_every_group() {
        assert!(AssistantTodo::default().is_empty());
        assert!(!build(&[task("t-1")], &[]).is_empty());
        let only_yours = build_todo(
            &[todo("t-1", None, "2026-10-10T00:00:00Z")],
            &[],
            &[],
            now(),
            &Utc,
        );
        assert!(!only_yours.is_empty());
    }
}
