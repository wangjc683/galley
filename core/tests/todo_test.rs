//! To-dos (main chat ticket 39) against an in-memory database: the
//! record and its writes (`SqliteGalley::create_todo` and the rest), the
//! reminder that hangs on one (a scheduled task, ticket 33), the four
//! groups of the to-do list (`galley_core_lib::assistant_todo`) read in
//! this machine's zone, the turn a to-do was noted in, the events the
//! write path sends, and a main chat reset. The wake a reminder sends is
//! in `schedule_wake_test.rs`; the pure grouping, ordering and zones in
//! the module's unit tests.

use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone, Utc};
use galley_core_lib::api::schedule::{
    instant_to_utc_iso, CreateScheduledTaskInput, ScheduleTarget, ScheduledTaskId,
    ScheduledTaskRepeat, ScheduledWake, ASSISTANT_UNAVAILABLE, SCHEDULED_TASKS_CHANGED_EVENT,
    TIME_IN_PAST,
};
use galley_core_lib::api::{
    CreateTodoInput, GalleyApi, MessageVisibility, Origin, OriginVia, SessionId, TodoBrief, TodoId,
    TodoPatch, TodoReminderState, TodoStatus, ASSISTANT_SUPERVISOR, TODOS_CHANGED_EVENT,
};
use galley_core_lib::assistant_todo::{assistant_todo, AssistantTodo, TodoCreator, TodoKind};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley, TodoListScope};
use galley_core_lib::error::GalleyError;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::RunnerManager;
use galley_core_lib::session_writes::Writes;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;

const MAIN: &str = "s-main";

async fn fresh(runtime: &str) -> (SqlitePool, SqliteGalley) {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .set_pref_json("active_runtime_kind", json!(runtime))
        .await
        .expect("runtime");
    (pool, galley)
}

async fn with_main_chat() -> (SqlitePool, SqliteGalley) {
    let (pool, galley) = fresh("managed").await;
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    (pool, galley)
}

fn assistant() -> Origin {
    Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(ASSISTANT_SUPERVISOR.into()),
        reason: Some("noted".into()),
        client: None,
    }
}

fn hours(n: i64) -> String {
    instant_to_utc_iso(&(Utc::now() + Duration::hours(n)))
}

fn titled(title: &str) -> CreateTodoInput {
    CreateTodoInput {
        title: title.into(),
        ..CreateTodoInput::default()
    }
}

async fn note(galley: &SqliteGalley, input: CreateTodoInput) -> TodoBrief {
    galley
        .create_todo(input, assistant(), None)
        .await
        .expect("create to-do")
}

fn id(todo: &TodoBrief) -> TodoId {
    todo.id.clone()
}

fn reminder_id(todo: &TodoBrief) -> ScheduledTaskId {
    todo.reminder.as_ref().expect("a reminder").task_id.clone()
}

async fn read(galley: &SqliteGalley) -> AssistantTodo {
    assistant_todo(galley, &RunnerManager::new(), Utc::now())
        .await
        .expect("todo")
}

fn ids<'a>(
    items: impl IntoIterator<Item = &'a galley_core_lib::assistant_todo::TodoItem>,
) -> Vec<&'a str> {
    items.into_iter().map(|i| i.id.as_str()).collect()
}

fn invalid_with(err: GalleyError, prefix: &str) -> bool {
    matches!(err, GalleyError::InvalidArgs { ref message } if message.starts_with(prefix))
}

// ---------------- the record ----------------

#[tokio::test]
async fn a_to_do_is_noted_with_its_due_date_and_who() {
    let (_pool, galley) = with_main_chat().await;
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "  交季度报告 ".into(),
                notes: Some("发给王总".into()),
                due: Some("2026-10-21T15:00".into()),
                remind_at: None,
            },
            assistant(),
            Some((SessionId(MAIN.into()), 4)),
        )
        .await
        .expect("create");
    let hex = report.id.as_str().strip_prefix("todo_").expect("todo_ id");
    assert_eq!(hex.len(), 16);
    assert_eq!(report.title, "交季度报告");
    assert_eq!(report.notes.as_deref(), Some("发给王总"));
    assert_eq!(report.status, TodoStatus::Open);
    // A day and a time: a local time read in this machine's zone, kept
    // as an instant.
    let due = report.due.as_ref().expect("due");
    assert!(due.has_time);
    assert_eq!(due.date, "2026-10-21");
    assert_eq!(due.time.as_deref(), Some("15:00"));
    let local_three = Local
        .from_local_datetime(
            &chrono::NaiveDate::from_ymd_opt(2026, 10, 21)
                .unwrap()
                .and_time(NaiveTime::from_hms_opt(15, 0, 0).unwrap()),
        )
        .earliest()
        .unwrap();
    assert_eq!(
        due.at.as_deref(),
        Some(instant_to_utc_iso(&local_three).as_str())
    );
    assert_eq!(report.origin.via, OriginVia::Supervisor);
    assert_eq!(
        report.origin.supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );
    assert_eq!(report.origin.reason.as_deref(), Some("noted"));
    // Noted in a run: the reply's turn comes when the run ends.
    let at = report.created_in.as_ref().expect("noted in a turn");
    assert_eq!(at.session_id.as_str(), MAIN);
    assert_eq!(at.turn_index, None);
    assert!(report.reminder.is_none() && report.done_at.is_none());

    // A day without a time stays that day.
    let friday = note(
        &galley,
        CreateTodoInput {
            due: Some("2026-10-23".into()),
            ..titled("交材料")
        },
    )
    .await;
    let due = friday.due.as_ref().unwrap();
    assert!(!due.has_time && due.at.is_none() && due.time.is_none());
    assert_eq!(due.date, "2026-10-23");
    // Empty notes are none; no due date is none.
    let soil = note(
        &galley,
        CreateTodoInput {
            notes: Some("  ".into()),
            ..titled("买营养土")
        },
    )
    .await;
    assert!(soil.notes.is_none() && soil.due.is_none());
    assert_eq!(
        galley.todo(soil.id.as_str()).await.unwrap().title,
        "买营养土"
    );

    // Refused: no title, a due date it cannot read.
    for bad in [
        titled("   "),
        CreateTodoInput {
            due: Some("Friday".into()),
            ..titled("x")
        },
    ] {
        let err = galley
            .create_todo(bad, assistant(), None)
            .await
            .unwrap_err();
        assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    }
    assert_eq!(
        galley.list_todos(TodoListScope::All).await.unwrap().len(),
        3
    );
}

#[tokio::test]
async fn to_dos_are_the_assistants_only_on_the_managed_runtime_with_a_main_chat() {
    let (_pool, galley) = fresh("managed").await;
    let err = galley
        .create_todo(titled("交报告"), assistant(), None)
        .await
        .unwrap_err();
    assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    let (_pool, galley) = fresh("external").await;
    let err = galley
        .create_todo(titled("交报告"), assistant(), None)
        .await
        .unwrap_err();
    assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    assert!(galley
        .list_todos(TodoListScope::All)
        .await
        .unwrap()
        .is_empty());
}

// ---------------- reminders ----------------

#[tokio::test]
async fn a_reminder_is_a_one_off_that_wakes_the_assistant() {
    let (_pool, galley) = with_main_chat().await;
    let fire = hours(5);
    let report = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(fire.clone()),
            ..titled("交季度报告")
        },
    )
    .await;
    let reminder = report.reminder.as_ref().expect("reminder");
    assert_eq!(reminder.at, fire);
    assert_eq!(reminder.state, TodoReminderState::Scheduled);
    let task = galley
        .scheduled_task(reminder.task_id.as_str())
        .await
        .unwrap();
    assert!(task.id.as_str().starts_with("sched_"));
    assert_eq!(task.repeat, ScheduledTaskRepeat::Once);
    assert_eq!(task.target, ScheduleTarget::Assistant);
    assert_eq!(task.fire_at.as_deref(), Some(fire.as_str()));
    // Its words are the title: what a notification shows should it not
    // reach the assistant.
    assert_eq!(task.prompt, "交季度报告");
    assert_eq!(task.todo_id.as_deref(), Some(report.id.as_str()));
    // Who set it: the to-do's writer. No card of its own: the to-do's
    // stands for both.
    assert_eq!(
        task.origin.as_ref().unwrap().supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );
    assert!(task.created_in.is_none());
    // `schedule show`'s wire carries the link.
    let wire = serde_json::to_value(&task).unwrap();
    assert_eq!(wire["todoId"], report.id.as_str());

    // A time already past: refused before anything is written.
    let err = galley
        .create_todo(
            CreateTodoInput {
                remind_at: Some(hours(-1)),
                ..titled("昨天的事")
            },
            assistant(),
            None,
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, TIME_IN_PAST));
    assert_eq!(
        galley.list_todos(TodoListScope::All).await.unwrap().len(),
        1
    );
    assert_eq!(galley.list_scheduled_tasks().await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_reminder_is_set_moved_renamed_and_removed_on_its_one_task() {
    let (_pool, galley) = with_main_chat().await;
    let soil = note(&galley, titled("买营养土")).await;
    let set = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                remind_at: Some(Some(hours(3))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("set");
    let task = reminder_id(&set);
    // Moved: the same task, armed again for the new time.
    let later = hours(6);
    let moved = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                remind_at: Some(Some(later.clone())),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("move");
    assert_eq!(reminder_id(&moved), task);
    assert_eq!(moved.reminder.as_ref().unwrap().at, later);
    // Renamed: the task's words follow.
    galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                title: Some("买两袋营养土".into()),
                notes: Some(Some("阳台用".into())),
                due: Some(Some("2026-11-01".into())),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("rename");
    assert_eq!(
        galley.scheduled_task(task.as_str()).await.unwrap().prompt,
        "买两袋营养土"
    );
    // Cleared: notes and due date.
    let cleared = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                notes: Some(None),
                due: Some(None),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("clear");
    assert!(cleared.notes.is_none() && cleared.due.is_none());
    assert_eq!(cleared.title, "买两袋营养土");
    assert!(cleared.reminder.is_some());
    // Removed: the task is cancelled, kept.
    let removed = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                remind_at: Some(None),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("remove");
    assert!(removed.reminder.is_none());
    assert!(galley
        .scheduled_task(task.as_str())
        .await
        .unwrap()
        .cancelled_at
        .is_some());
    // Set again: a new task.
    let again = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                remind_at: Some(Some(hours(2))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .expect("again");
    assert_ne!(reminder_id(&again), task);
    // A time past is refused and changes nothing.
    let err = galley
        .update_todo(
            &id(&soil),
            TodoPatch {
                title: Some("改了".into()),
                remind_at: Some(Some(hours(-2))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, TIME_IN_PAST));
    assert_eq!(
        galley.todo(soil.id.as_str()).await.unwrap().title,
        "买两袋营养土"
    );
}

/// Mark a reminder's task as gone off for its time, its wake `wake`.
async fn fired(pool: &SqlitePool, task: &ScheduledTaskId, wake: &str) {
    let past = instant_to_utc_iso(&(Utc::now() - Duration::minutes(5)));
    sqlx::query(
        "UPDATE scheduled_tasks SET fire_at = ?, last_due_at = ?, last_fired_at = ?, \
            last_wake = ? WHERE id = ?",
    )
    .bind(&past)
    .bind(&past)
    .bind(&past)
    .bind(wake)
    .bind(task.as_str())
    .execute(pool)
    .await
    .expect("fired");
}

#[tokio::test]
async fn ticking_off_and_cancelling_cancel_a_reminder_that_has_not_reminded() {
    let (pool, galley) = with_main_chat().await;
    let reminded = |title: &str| CreateTodoInput {
        remind_at: Some(hours(4)),
        ..titled(title)
    };
    // Not gone off yet: cancelled by the tick.
    let pending = note(&galley, reminded("交报告")).await;
    let done = galley
        .complete_todo(&id(&pending), Origin::desktop())
        .await
        .expect("tick");
    assert_eq!(done.status, TodoStatus::Done);
    assert!(done.reminder.is_none());
    let task = galley
        .scheduled_task(reminder_id(&pending).as_str())
        .await
        .unwrap();
    assert!(task.cancelled_at.is_some());
    // Gone off and reached the assistant: left as it is.
    let delivered = note(&galley, reminded("打电话")).await;
    fired(&pool, &reminder_id(&delivered), "delivered").await;
    let done = galley
        .complete_todo(&id(&delivered), assistant())
        .await
        .expect("tick");
    let kept = done.reminder.as_ref().expect("kept");
    assert_eq!(kept.state, TodoReminderState::Fired);
    assert!(galley
        .scheduled_task(reminder_id(&delivered).as_str())
        .await
        .unwrap()
        .cancelled_at
        .is_none());
    // Gone off, its wake not delivered yet: the user was not reminded,
    // so it goes too (unticking must not bring the wake back).
    let waiting = note(&galley, reminded("取快递")).await;
    fired(&pool, &reminder_id(&waiting), "pending").await;
    galley
        .complete_todo(&id(&waiting), Origin::desktop())
        .await
        .expect("tick");
    assert!(galley
        .scheduled_task(reminder_id(&waiting).as_str())
        .await
        .unwrap()
        .cancelled_at
        .is_some());
    assert!(galley.pending_scheduled_wakes().await.unwrap().is_empty());
    // Cancelling the to-do does the same.
    let cancelled = note(&galley, reminded("退货")).await;
    let gone = galley
        .cancel_todo(&id(&cancelled), assistant())
        .await
        .expect("cancel");
    assert_eq!(gone.status, TodoStatus::Cancelled);
    assert!(galley
        .scheduled_task(reminder_id(&cancelled).as_str())
        .await
        .unwrap()
        .cancelled_at
        .is_some());
}

#[tokio::test]
async fn tick_untick_cancel_and_who_ticked() {
    let (_pool, galley) = with_main_chat().await;
    let report = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(4)),
            ..titled("交报告")
        },
    )
    .await;
    // The user at the desktop ticks it.
    let done = galley
        .complete_todo(&id(&report), Origin::desktop())
        .await
        .unwrap();
    assert!(done.done_at.is_some());
    let by = done.done_by.as_ref().expect("who");
    assert_eq!(by.via, OriginVia::Gui);
    assert!(by.supervisor.is_none());
    // Ticking again changes nothing.
    let again = galley
        .complete_todo(&id(&report), assistant())
        .await
        .unwrap();
    assert_eq!(again.done_at, done.done_at);
    assert_eq!(again.done_by.unwrap().via, OriginVia::Gui);
    // A done one takes no reminder: untick it first.
    let err = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                remind_at: Some(Some(hours(5))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    // Unticked: open, the stamps gone, the reminder not back.
    let open = galley
        .reopen_todo(&id(&report), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(open.status, TodoStatus::Open);
    assert!(open.done_at.is_none() && open.done_by.is_none() && open.reminder.is_none());
    let reopened_again = galley
        .reopen_todo(&id(&report), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(reopened_again.status, TodoStatus::Open);
    // Galley ticks it through the CLI.
    let by_galley = galley
        .complete_todo(&id(&report), assistant())
        .await
        .unwrap();
    let by = by_galley.done_by.unwrap();
    assert_eq!(by.via, OriginVia::Supervisor);
    assert_eq!(by.supervisor.as_deref(), Some(ASSISTANT_SUPERVISOR));
    // Cancelled: gone for every write.
    galley.cancel_todo(&id(&report), assistant()).await.unwrap();
    let kept = galley.todo(report.id.as_str()).await.unwrap();
    assert_eq!(kept.status, TodoStatus::Cancelled);
    assert!(kept.cancelled_at.is_some());
    for err in [
        galley
            .cancel_todo(&id(&report), assistant())
            .await
            .unwrap_err(),
        galley
            .complete_todo(&id(&report), assistant())
            .await
            .unwrap_err(),
        galley
            .reopen_todo(&id(&report), assistant())
            .await
            .unwrap_err(),
        galley
            .update_todo(&id(&report), TodoPatch::default(), assistant())
            .await
            .unwrap_err(),
        galley
            .cancel_todo_reminder(&id(&report), Origin::desktop())
            .await
            .unwrap_err(),
    ] {
        assert!(matches!(err, GalleyError::NotFound { .. }), "{err:?}");
    }
    let err = galley
        .complete_todo(&TodoId("todo_nope".into()), assistant())
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::NotFound { .. }));
    // Lists: open only by default, everything with --all.
    assert!(galley
        .list_todos(TodoListScope::Open)
        .await
        .unwrap()
        .is_empty());
    assert!(galley
        .list_todos(TodoListScope::Live)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        galley.list_todos(TodoListScope::All).await.unwrap().len(),
        1
    );
}

#[tokio::test]
async fn the_desktop_cancels_a_reminder_and_leaves_the_to_do() {
    let (pool, galley) = with_main_chat().await;
    let report = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(4)),
            ..titled("交报告")
        },
    )
    .await;
    let task = reminder_id(&report);
    let after = galley
        .cancel_todo_reminder(&id(&report), Origin::desktop())
        .await
        .expect("cancel reminder");
    assert_eq!(after.status, TodoStatus::Open);
    assert!(after.reminder.is_none());
    assert!(galley
        .scheduled_task(task.as_str())
        .await
        .unwrap()
        .cancelled_at
        .is_some());
    // None left to cancel.
    let err = galley
        .cancel_todo_reminder(&id(&report), Origin::desktop())
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::NotFound { .. }));
    // One that went off can be cancelled too.
    let call = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(4)),
            ..titled("打电话")
        },
    )
    .await;
    fired(&pool, &reminder_id(&call), "delivered").await;
    let after = galley
        .cancel_todo_reminder(&id(&call), Origin::desktop())
        .await
        .expect("cancel a fired one");
    assert!(after.reminder.is_none());
}

// ---------------- the list ----------------

/// The instant `days` from today, at `h:00` local.
fn local_day_at(days: i64, h: u32) -> DateTime<Local> {
    let day = Local::now().date_naive() + Duration::days(days);
    Local
        .from_local_datetime(&day.and_time(NaiveTime::from_hms_opt(h, 0, 0).unwrap()))
        .earliest()
        .unwrap()
}

#[tokio::test]
async fn the_four_groups_and_todays_count_in_this_machines_zone() {
    let (pool, galley) = with_main_chat().await;
    let today = Local::now().date_naive();
    let day = |days: i64| {
        (today + Duration::days(days))
            .format("%Y-%m-%d")
            .to_string()
    };
    let yesterday = note(
        &galley,
        CreateTodoInput {
            due: Some(day(-1)),
            ..titled("昨天该交的")
        },
    )
    .await;
    let today_day = note(
        &galley,
        CreateTodoInput {
            due: Some(day(0)),
            remind_at: Some(hours(30)),
            ..titled("今天交")
        },
    )
    .await;
    let tomorrow = note(
        &galley,
        CreateTodoInput {
            due: Some(instant_to_utc_iso(&local_day_at(1, 9))),
            ..titled("明早开会")
        },
    )
    .await;
    let anytime = note(&galley, titled("买营养土")).await;
    let ticked = note(&galley, titled("交房租")).await;
    galley
        .complete_todo(&id(&ticked), Origin::desktop())
        .await
        .unwrap();
    let old = note(&galley, titled("上个月的")).await;
    galley.complete_todo(&id(&old), assistant()).await.unwrap();
    sqlx::query("UPDATE todos SET done_at = ? WHERE id = ?")
        .bind(instant_to_utc_iso(&(Utc::now() - Duration::days(8))))
        .bind(old.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    let dropped = note(&galley, titled("不用了")).await;
    galley
        .cancel_todo(&id(&dropped), assistant())
        .await
        .unwrap();
    // The assistant's own: a reminder to come back to something, and a
    // routine.
    let assistant_task =
        |id: &str, repeat: ScheduledTaskRepeat, fire: Option<String>| CreateScheduledTaskInput {
            id: id.into(),
            project_id: None,
            prompt: format!("{id} 的话"),
            time_of_day: if fire.is_none() {
                "08:00".into()
            } else {
                String::new()
            },
            repeat,
            llm_name: None,
            enabled: true,
            fire_at: fire,
            target: ScheduleTarget::Assistant,
        };
    galley
        .create_scheduled_task(
            assistant_task("sched_look", ScheduledTaskRepeat::Once, Some(hours(2))),
            assistant(),
        )
        .await
        .unwrap();
    galley
        .create_scheduled_task(
            assistant_task("sched_daily", ScheduledTaskRepeat::Daily, None),
            assistant(),
        )
        .await
        .unwrap();

    let todo = read(&galley).await;
    assert_eq!(
        ids(&todo.yours.today),
        [yesterday.id.as_str(), today_day.id.as_str()]
    );
    assert!(todo.yours.today[0].overdue && !todo.yours.today[1].overdue);
    assert_eq!(ids(&todo.yours.later), [tomorrow.id.as_str()]);
    assert_eq!(ids(&todo.yours.anytime), [anytime.id.as_str()]);
    assert_eq!(todo.today_count, 2);
    // The to-do's reminder is on it, not one of Galley's.
    let on = todo.yours.today[1].reminder.as_ref().expect("reminder");
    assert_eq!(on.task_id, reminder_id(&today_day));
    assert_eq!(ids(&todo.assistant), ["sched_look"]);
    assert_eq!(ids(&todo.routine), ["sched_daily"]);
    // Done lately: the one ticked today; not the one ticked eight days
    // ago, nor the cancelled one.
    assert_eq!(ids(&todo.done), [ticked.id.as_str()]);
    let done = &todo.done[0];
    assert_eq!(done.kind, TodoKind::Todo);
    assert_eq!(done.done_by, Some(TodoCreator::User));
    assert_eq!(done.created_by, TodoCreator::Assistant);
    // The wire's day is this machine's.
    let due = todo.yours.later[0].due.as_ref().unwrap();
    assert_eq!(due.date, day(1));
    assert_eq!(due.time.as_deref(), Some("09:00"));
}

#[tokio::test]
async fn the_turn_a_to_do_was_noted_in_is_settled_to_its_reply() {
    let (_pool, galley) = with_main_chat().await;
    let turn = galley
        .send_message(
            SessionId(MAIN.into()),
            "周三前要交报告".into(),
            Origin::desktop(),
        )
        .await
        .unwrap()
        .turn_index
        .unwrap();
    let noted = galley
        .create_todo(
            titled("交报告"),
            assistant(),
            Some((SessionId(MAIN.into()), i64::from(turn))),
        )
        .await
        .unwrap();
    // No reply yet: nothing to settle.
    assert_eq!(galley.settle_todo_created_in(MAIN).await.unwrap(), 0);
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(MAIN.into()),
            turn_index: turn + 1,
            content: "记下了".into(),
            tool_calls: Some("[]".into()),
            tool_results: None,
            thinking: None,
            final_answer: Some("记下了".into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .unwrap();
    assert_eq!(galley.settle_todo_created_in(MAIN).await.unwrap(), 1);
    let settled = galley.todo(noted.id.as_str()).await.unwrap();
    assert_eq!(
        settled.created_in.unwrap().turn_index,
        Some(i64::from(turn + 1))
    );
    assert_eq!(galley.settle_todo_created_in(MAIN).await.unwrap(), 0);
    // The list jumps there.
    let todo = read(&galley).await;
    assert_eq!(
        todo.yours.anytime[0]
            .created_in
            .as_ref()
            .unwrap()
            .turn_index,
        Some(i64::from(turn + 1))
    );
}

// ---------------- events ----------------

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<String>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, _payload: Value) {
        self.events.lock().unwrap().push(event.to_string());
    }
}

impl Recorder {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }
}

#[tokio::test]
async fn every_write_tells_the_desktop() {
    let (_pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "test");
    let both = [
        TODOS_CHANGED_EVENT.to_string(),
        SCHEDULED_TASKS_CHANGED_EVENT.to_string(),
    ];
    let made = writes
        .create_todo(
            CreateTodoInput {
                remind_at: Some(hours(3)),
                ..titled("交报告")
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    assert_eq!(rec.take(), both);
    writes
        .create_todo(titled("买营养土"), assistant(), None)
        .await
        .unwrap();
    assert_eq!(rec.take(), [TODOS_CHANGED_EVENT]);
    writes
        .complete_todo(&id(&made), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(rec.take(), both);
    writes
        .reopen_todo(&id(&made), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(rec.take(), [TODOS_CHANGED_EVENT]);
    writes
        .update_todo(
            &id(&made),
            TodoPatch {
                remind_at: Some(Some(hours(4))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    assert_eq!(rec.take(), both);
    writes
        .cancel_todo_reminder(&id(&made), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(rec.take(), both);
    writes.cancel_todo(&id(&made), assistant()).await.unwrap();
    assert_eq!(rec.take(), both);
    // A refused write still says so: a page that reads again reads the
    // truth.
    assert!(writes.cancel_todo(&id(&made), assistant()).await.is_err());
    assert_eq!(rec.take(), both);
}

// ---------------- reset ----------------

#[tokio::test]
async fn a_main_chat_reset_clears_every_to_do_and_their_reminders() {
    let (pool, galley) = with_main_chat().await;
    let report = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(3)),
            ..titled("交报告")
        },
    )
    .await;
    let soil = note(&galley, titled("买营养土")).await;
    galley.complete_todo(&id(&soil), assistant()).await.unwrap();
    // A reminder removed earlier: a cancelled task still linked.
    let moved = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(5)),
            ..titled("打电话")
        },
    )
    .await;
    galley
        .update_todo(
            &id(&moved),
            TodoPatch {
                remind_at: Some(None),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    // The assistant's own reminder stays.
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                id: "sched_own".into(),
                project_id: None,
                prompt: "回头查物流".into(),
                repeat: ScheduledTaskRepeat::Once,
                time_of_day: String::new(),
                llm_name: None,
                enabled: true,
                fire_at: Some(hours(2)),
                target: ScheduleTarget::Assistant,
            },
            assistant(),
        )
        .await
        .unwrap();
    let deletion = galley
        .delete_main_chat_for_reset(&SessionId(MAIN.into()))
        .await
        .expect("reset");
    assert_eq!(deletion.todos, 3);
    assert!(galley
        .list_todos(TodoListScope::All)
        .await
        .unwrap()
        .is_empty());
    let left: Vec<String> = sqlx::query_scalar("SELECT id FROM scheduled_tasks ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, ["sched_own"]);
    assert!(galley
        .scheduled_task(reminder_id(&report).as_str())
        .await
        .is_err());
    // Nothing points nowhere.
    let orphans: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks WHERE todo_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(orphans, 0);
}

#[tokio::test]
async fn a_pending_wake_of_a_closed_to_do_is_not_read_back() {
    let (pool, galley) = with_main_chat().await;
    let call = note(
        &galley,
        CreateTodoInput {
            remind_at: Some(hours(3)),
            ..titled("打电话")
        },
    )
    .await;
    fired(&pool, &reminder_id(&call), "pending").await;
    assert_eq!(galley.pending_scheduled_wakes().await.unwrap().len(), 1);
    // Ticked off behind Core's back (the write that cancels the reminder
    // skipped): the restart read leaves it out all the same.
    sqlx::query("UPDATE todos SET done_at = ?, done_via = 'gui' WHERE id = ?")
        .bind(instant_to_utc_iso(&Utc::now()))
        .bind(call.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    assert!(galley.pending_scheduled_wakes().await.unwrap().is_empty());
    let task = galley
        .scheduled_task(reminder_id(&call).as_str())
        .await
        .unwrap();
    assert_eq!(task.last_wake, Some(ScheduledWake::Pending));
}
