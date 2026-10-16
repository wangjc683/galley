//! The assistant's to-do list (main chat ticket 37; assistant PRD
//! rulings 5 and 9, main chat PRD ruling 86): what it has coming up,
//! what it is working on, and what it finished lately. One read, two
//! readers — the desktop's 「待办」 list behind the sidebar masthead, and
//! the 「在办的事」 lines Core writes at the start of each segment of the
//! main chat (ticket 36). "What you see is what it sees": both read the
//! same groups in the same order.
//!
//! - **Upcoming** ([`AssistantTodo::upcoming`]): every scheduled task not
//!   cancelled that may still fire — one-offs not yet fired, repeating
//!   tasks — made by the assistant, by the user's form, or by another
//!   agent. Enabled ones by their next fire, soonest first; paused ones
//!   after them.
//! - **Active** ([`AssistantTodo::active`]): the main chat's subtasks not
//!   promoted, not archived and not finished — running, asking, failed,
//!   paused at the step limit, or stopped short — most recent activity
//!   first. One that is not running and has not moved for
//!   [`RECENT_WINDOW_DAYS`] drops out: it was reported to the assistant
//!   when its run ended, and a stale failure carried forever is noise in
//!   both readers.
//! - **Recent** ([`AssistantTodo::recent`]): within the last
//!   [`RECENT_WINDOW_DAYS`] (a rolling window, not calendar days) — a
//!   one-off that fired, a repeating task's last fire, a finished
//!   subtask; newest first, at most [`RECENT_LIMIT`].
//!
//! A cancelled task is in no group (its card in the conversation says
//! 已取消). A repeating task can be in two: its next fire in upcoming,
//! its last one in recent.
//!
//! A subtask's state comes from its live run state (Core's run gate)
//! and its latest run's last reply in the database: running while a run
//! is open; asking when the run ended on `ask_user`; done when it ended
//! on a final answer; else how it ended, when this Core process saw it
//! end (the step limit, an error), or stopped short. Deterministic, no
//! model call. Times are UTC ISO; formatting is the reader's.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::api::schedule::{
    parse_utc_secs, ScheduleTarget, ScheduledTaskBrief, ScheduledTaskCreatedIn, ScheduledTaskRepeat,
};
use crate::api::{OriginVia, SessionId, ASSISTANT_SUPERVISOR};
use crate::db::{LastRunReply, ScheduleListScope, SqliteGalley, TodoSubtaskRow};
use crate::error::Result;
use crate::runner_manager::{RunState, RunnerManager};

/// How far back 「最近做完」 reaches, and how long a subtask that is not
/// running stays in 「在办」 without moving.
pub const RECENT_WINDOW_DAYS: i64 = 7;

/// At most this many items in [`AssistantTodo::recent`]; the rest are
/// counted in [`AssistantTodo::recent_omitted`].
pub const RECENT_LIMIT: usize = 50;

/// The three groups (Tauri `list_assistant_todo`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTodo {
    pub upcoming: Vec<TodoItem>,
    pub active: Vec<TodoItem>,
    pub recent: Vec<TodoItem>,
    /// Finished within the window but past [`RECENT_LIMIT`]: left out.
    pub recent_omitted: u32,
}

/// What an item is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoKind {
    /// A scheduled task: a reminder that wakes the assistant
    /// (`target = assistant`) or a task that starts a session.
    Task,
    /// A subtask the main chat dispatched.
    Subtask,
}

/// Where an item stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoState {
    /// A task that will fire.
    Scheduled,
    /// A task switched off: it will not fire until resumed.
    Paused,
    /// A task's fire (recent): a one-off that went off, a repeating
    /// task's last run.
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
    /// A subtask that finished with an answer (recent).
    Done,
}

/// Who made an item. The assistant's own and the ones the user asked it
/// for are one (main chat PRD ruling 86 point 4: Core cannot tell them
/// apart; the words where it was made can).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoCreator {
    /// The assistant (`--supervisor=galley-assistant`); every subtask.
    Assistant,
    /// The user, with the desktop's form.
    User,
    /// Another agent ([`TodoItem::agent`] names it when it said).
    Agent,
}

/// One row of the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub kind: TodoKind,
    /// The task id, or the subtask's session id (where it leads).
    pub id: String,
    /// The words the task carries, or the subtask's title. Uncut: the
    /// reader truncates.
    pub text: String,
    pub state: TodoState,
    /// The instant the group orders by (UTC ISO): the next fire
    /// (upcoming; a paused one-off's planned fire; absent for a paused
    /// repeating task), the latest activity (active), the fire or the
    /// finish (recent).
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
    /// Tasks the assistant made in a main chat turn: that turn — the reply
    /// its card hangs under, and where the list jumps to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_in: Option<ScheduledTaskCreatedIn>,
    /// Recent tasks that start a session: the session that run made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_session_id: Option<String>,
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

/// Read the list: the tasks not cancelled, and the main chat's subtasks
/// with their run states. `now` decides the window.
pub async fn assistant_todo(
    galley: &SqliteGalley,
    runners: &RunnerManager,
    now: DateTime<Utc>,
) -> Result<AssistantTodo> {
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
    Ok(build_todo(&tasks, &subtasks, now))
}

fn window_start(now: DateTime<Utc>) -> i64 {
    now.timestamp() - RECENT_WINDOW_DAYS * 86_400
}

/// The three groups from what was read. Pure: `now` decides the window.
pub fn build_todo(
    tasks: &[ScheduledTaskBrief],
    subtasks: &[SubtaskFacts],
    now: DateTime<Utc>,
) -> AssistantTodo {
    let since = window_start(now);
    let mut upcoming = Vec::new();
    let mut active = Vec::new();
    let mut recent = Vec::new();

    for task in tasks {
        if task.cancelled_at.is_some() {
            continue;
        }
        let fired_once = task.once_fired();
        if !fired_once {
            let (state, at) = if task.enabled {
                (TodoState::Scheduled, task.next_fire_at.clone())
            } else {
                // A paused one-off keeps its planned time; a paused
                // repeating task has no next fire (its rule is shown).
                (TodoState::Paused, task.fire_at.clone())
            };
            upcoming.push(task_item(task, state, at, None));
        }
        // A one-off's fire counts once it fired for its time (a manual
        // run before it does not); a repeating task's last fire counts.
        let counts = fired_once || !task.repeat.is_once();
        if let Some(fired) = task.last_fired_at.as_deref() {
            if counts && parse_utc_secs(fired).is_some_and(|at| at >= since) {
                let run = (task.target == ScheduleTarget::Session)
                    .then(|| task.last_run_session_id.as_ref())
                    .flatten()
                    .map(|id| id.as_str().to_string());
                recent.push(task_item(
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
            TodoState::Done if moved => recent.push(item),
            TodoState::Done => {}
            TodoState::Running => active.push(item),
            _ if moved => active.push(item),
            _ => {}
        }
    }

    upcoming.sort_by(|a, b| {
        (a.state == TodoState::Paused)
            .cmp(&(b.state == TodoState::Paused))
            .then_with(|| secs_or_last(a).cmp(&secs_or_last(b)))
            .then_with(|| a.id.cmp(&b.id))
    });
    let newest_first = |a: &TodoItem, b: &TodoItem| {
        secs_or_first(b)
            .cmp(&secs_or_first(a))
            .then_with(|| a.id.cmp(&b.id))
    };
    active.sort_by(newest_first);
    recent.sort_by(newest_first);
    let recent_omitted = recent.len().saturating_sub(RECENT_LIMIT) as u32;
    recent.truncate(RECENT_LIMIT);

    AssistantTodo {
        upcoming,
        active,
        recent,
        recent_omitted,
    }
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

fn creator(task: &ScheduledTaskBrief) -> (TodoCreator, Option<String>) {
    // A row that cannot say predates the column: the form made it.
    let Some(origin) = task.origin.as_ref() else {
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

fn task_item(
    task: &ScheduledTaskBrief,
    state: TodoState,
    at: Option<String>,
    run_session_id: Option<String>,
) -> TodoItem {
    let (created_by, agent) = creator(task);
    TodoItem {
        kind: TodoKind::Task,
        id: task.id.as_str().to_string(),
        text: task.prompt.clone(),
        state,
        at,
        created_by,
        agent,
        target: Some(task.target),
        repeat: Some(task.repeat.clone()),
        time_of_day: (!task.time_of_day.is_empty()).then(|| task.time_of_day.clone()),
        created_in: task.created_in.clone(),
        run_session_id,
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
        kind: TodoKind::Subtask,
        id: row.session_id.clone(),
        text,
        state,
        at: (!row.last_activity_at.is_empty()).then(|| row.last_activity_at.clone()),
        created_by: TodoCreator::Assistant,
        agent: None,
        target: None,
        repeat: None,
        time_of_day: None,
        created_in: None,
        run_session_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::schedule::ScheduledTaskId;
    use crate::api::Origin;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-16T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
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

    fn ids(items: &[TodoItem]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn upcoming_by_next_fire_paused_last() {
        let mut later = task("t-later");
        later.next_fire_at = Some("2026-10-20T01:00:00+00:00".into());
        later.fire_at = later.next_fire_at.clone();
        let soon = daily("t-daily", "2026-10-16T13:00:00+00:00");
        let mut paused = daily("t-paused", "2026-10-16T12:30:00+00:00");
        paused.enabled = false;
        paused.next_fire_at = None;
        let mut overdue = task("t-overdue");
        // Asleep past its time: still upcoming (it fires on the next
        // tick), first.
        overdue.fire_at = Some("2026-10-16T08:00:00+00:00".into());
        overdue.next_fire_at = overdue.fire_at.clone();
        let todo = build_todo(&[later, paused, soon, overdue, task("t-once")], &[], now());
        assert_eq!(
            ids(&todo.upcoming),
            ["t-overdue", "t-daily", "t-once", "t-later", "t-paused"]
        );
        let paused = todo.upcoming.last().unwrap();
        assert_eq!(paused.state, TodoState::Paused);
        assert_eq!(paused.at, None);
        assert!(todo.active.is_empty() && todo.recent.is_empty());
    }

    #[test]
    fn a_paused_one_off_keeps_its_time() {
        let mut t = task("t-1");
        t.enabled = false;
        t.next_fire_at = None;
        let todo = build_todo(&[t], &[], now());
        assert_eq!(todo.upcoming[0].state, TodoState::Paused);
        assert_eq!(
            todo.upcoming[0].at.as_deref(),
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
        assert_eq!(build_todo(&[t, d], &[], now()), AssistantTodo::default());
    }

    #[test]
    fn a_fired_one_off_moves_to_recent_within_seven_days() {
        let fired = |id: &str, at: &str| {
            let mut t = task(id);
            t.fire_at = Some(at.into());
            t.last_due_at = Some(at.into());
            t.last_fired_at = Some(at.into());
            t.next_fire_at = None;
            t
        };
        let todo = build_todo(
            &[
                fired("t-edge", "2026-10-09T12:00:00+00:00"),
                fired("t-old", "2026-10-09T11:59:59+00:00"),
                fired("t-new", "2026-10-16T11:00:00+00:00"),
            ],
            &[],
            now(),
        );
        assert!(todo.upcoming.is_empty());
        // Exactly seven days back is in; a second more is out.
        assert_eq!(ids(&todo.recent), ["t-new", "t-edge"]);
        assert!(todo.recent.iter().all(|i| i.state == TodoState::Fired));
        assert_eq!(
            todo.recent[0].at.as_deref(),
            Some("2026-10-16T11:00:00+00:00")
        );
    }

    #[test]
    fn a_manual_run_before_its_time_leaves_a_one_off_upcoming() {
        let mut t = task("t-1");
        t.target = ScheduleTarget::Session;
        t.last_fired_at = Some("2026-10-16T11:00:00+00:00".into());
        t.last_run_session_id = Some(SessionId("s-run".into()));
        let todo = build_todo(&[t], &[], now());
        assert_eq!(ids(&todo.upcoming), ["t-1"]);
        assert!(todo.recent.is_empty());
    }

    #[test]
    fn a_repeating_task_is_upcoming_and_its_last_run_recent() {
        let mut d = daily("t-daily", "2026-10-17T01:00:00+00:00");
        d.last_fired_at = Some("2026-10-16T01:00:00+00:00".into());
        d.last_run_session_id = Some(SessionId("s-run".into()));
        let mut stale = daily("t-stale", "2026-10-17T02:00:00+00:00");
        stale.last_fired_at = Some("2026-10-01T02:00:00+00:00".into());
        let todo = build_todo(&[d, stale], &[], now());
        assert_eq!(ids(&todo.upcoming), ["t-daily", "t-stale"]);
        assert_eq!(ids(&todo.recent), ["t-daily"]);
        let run = &todo.recent[0];
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
        let todo = build_todo(&[agent, cli, legacy, gui, task("t-assistant")], &[], now());
        let by = |id: &str| {
            let item = todo.upcoming.iter().find(|i| i.id == id).unwrap();
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
        let todo = build_todo(&[task("t-1")], &[], now());
        let item = &todo.upcoming[0];
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
    fn active_by_latest_activity_done_in_recent() {
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
        let todo = build_todo(
            &[],
            &[running_old, asking, stopped, stale, done, done_old],
            now(),
        );
        // Running whatever its age; not running only within the window.
        assert_eq!(
            ids(&todo.active),
            ["s-asking", "s-stopped", "s-running-old"]
        );
        assert_eq!(ids(&todo.recent), ["s-done"]);
        let item = &todo.recent[0];
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
        let todo = build_todo(&[], &[facts], now());
        assert_eq!(todo.active[0].text, "查物流");
    }

    #[test]
    fn recent_mixes_kinds_newest_first_and_is_capped() {
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
        let todo = build_todo(&tasks, &[done], now());
        assert_eq!(todo.recent.len(), RECENT_LIMIT);
        assert_eq!(todo.recent_omitted, 4);
        assert_eq!(todo.recent[0].id, "s-done");
        assert_eq!(todo.recent[1].id, "t-052");
    }
}
