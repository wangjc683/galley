//! A to-do's day, reminder and rule changed by hand on the desktop (main
//! chat ticket 156, PRD ruling 205; `SqliteGalley::update_todo_by_hand`,
//! the Tauri `update_todo`'s new arguments) against an in-memory database:
//! the reminder moving with the due day (the same task), left where it is
//! when only the time of day changes, a reminder moved or set into the
//! past not hung and let go as Core's own, a repeating period's hung at
//! the next time still ahead instead, 「不提醒」 the user's removal, the
//! due date taken away with its reminder (and refused on a repeating
//! period), a rule given and the rule left alone by a period's change, the
//! title-and-notes change as before, and the CLI's `todo update --due`
//! still moving no reminder. Core reads days in this machine's zone
//! (`Local`), so every date here is counted from today there; the
//! arithmetic itself, in fixed zones, is `todo_by_hand`'s unit tests.

use std::sync::Mutex;

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use galley_core_lib::api::schedule::{instant_to_utc_iso, SCHEDULED_TASKS_CHANGED_EVENT};
use galley_core_lib::api::{
    CreateTodoInput, Origin, OriginVia, SessionId, TodoBrief, TodoId, TodoPatch, TodoReminderState,
    TodoRepeatKind, TodoRepeatRemind, TodoRepeatRule, ASSISTANT_SUPERVISOR, REPEAT_NEEDS_DUE,
    TODOS_CHANGED_EVENT,
};
use galley_core_lib::db::{MainChatSeed, SqliteGalley};
use galley_core_lib::error::GalleyError;
use galley_core_lib::notify::Notifier;
use galley_core_lib::session_writes::Writes;
use galley_core_lib::todo_by_hand::TodoWhenChange;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const MAIN: &str = "s-main";

async fn with_main_chat() -> SqliteGalley {
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
    let galley = SqliteGalley::from_pool(pool);
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("runtime");
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    galley
}

fn assistant() -> Origin {
    Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(ASSISTANT_SUPERVISOR.into()),
        reason: None,
        client: None,
    }
}

fn day(offset: i64) -> NaiveDate {
    Local::now().date_naive() + Duration::days(offset)
}

fn ymd(day: NaiveDate) -> String {
    day.format("%Y-%m-%d").to_string()
}

/// A local wall-clock time on `day`, as `--due` / `--remind-at` take it.
fn local(day: NaiveDate, h: u32, m: u32) -> String {
    format!("{}T{h:02}:{m:02}", ymd(day))
}

/// The instant of a local wall-clock time, UTC ISO.
fn instant(day: NaiveDate, h: u32, m: u32) -> String {
    let naive = day.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap());
    let at = Local
        .from_local_datetime(&naive)
        .earliest()
        .expect("a local time");
    instant_to_utc_iso(&at)
}

fn weekly_on(on: NaiveDate) -> TodoRepeatRule {
    TodoRepeatRule {
        kind: TodoRepeatKind::Weekly,
        weekdays: vec![on.weekday().number_from_monday() as u8],
        monthdays: Vec::new(),
        every: 1,
    }
}

fn id(todo: &TodoBrief) -> TodoId {
    todo.id.clone()
}

/// A to-do Galley notes, due `due`, reminded at `remind_at`, repeating by
/// `repeat`.
async fn note(
    galley: &SqliteGalley,
    due: Option<String>,
    remind_at: Option<String>,
    repeat: Option<TodoRepeatRule>,
) -> TodoBrief {
    galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due,
                remind_at,
                repeat,
                ..CreateTodoInput::default()
            },
            assistant(),
            Some((SessionId(MAIN.into()), 1)),
        )
        .await
        .expect("note a to-do")
}

fn move_to(due: &str) -> TodoWhenChange {
    TodoWhenChange {
        due: Some(Some(due.into())),
        ..TodoWhenChange::default()
    }
}

fn remind(days_before: i64, time: &str) -> TodoWhenChange {
    TodoWhenChange {
        remind: Some(Some(TodoRepeatRemind {
            days_before,
            time: time.into(),
        })),
        ..TodoWhenChange::default()
    }
}

async fn by_hand(galley: &SqliteGalley, todo: &TodoBrief, when: TodoWhenChange) -> TodoBrief {
    galley
        .update_todo_by_hand(&id(todo), TodoPatch::default(), when, Origin::desktop())
        .await
        .expect("change by hand")
}

#[tokio::test]
async fn the_reminder_moves_with_the_day_on_the_same_task() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(5))), Some(local(day(4), 20, 0)), None).await;
    let task = todo.reminder.clone().expect("a reminder").task_id;
    let moved = by_hand(&galley, &todo, move_to(&ymd(day(10)))).await;
    assert_eq!(moved.due.as_ref().unwrap().date, ymd(day(10)));
    let reminder = moved.reminder.clone().expect("still a reminder");
    assert_eq!(reminder.task_id, task);
    assert_eq!(reminder.at, instant(day(9), 20, 0));
    assert_eq!(reminder.state, TodoReminderState::Scheduled);
    // Given a time on another day: the same offset from that day.
    let moved = by_hand(&galley, &moved, move_to(&local(day(12), 15, 0))).await;
    assert!(moved.due.as_ref().unwrap().has_time);
    assert_eq!(moved.reminder.unwrap().at, instant(day(11), 20, 0));
}

#[tokio::test]
async fn only_the_time_of_day_leaves_the_reminder_alone() {
    let galley = with_main_chat().await;
    let todo = note(
        &galley,
        Some(local(day(5), 15, 0)),
        Some(local(day(5), 14, 0)),
        None,
    )
    .await;
    let before = todo.reminder.clone().unwrap();
    let moved = by_hand(&galley, &todo, move_to(&local(day(5), 17, 0))).await;
    assert_eq!(moved.due.as_ref().unwrap().time.as_deref(), Some("17:00"));
    let after = moved.reminder.clone().unwrap();
    assert_eq!((after.task_id, after.at), (before.task_id, before.at));
    // The time taken off, the day kept: the same.
    let moved = by_hand(&galley, &moved, move_to(&ymd(day(5)))).await;
    assert!(!moved.due.as_ref().unwrap().has_time);
    assert_eq!(moved.reminder.unwrap().at, instant(day(5), 14, 0));
}

#[tokio::test]
async fn a_reminder_moved_into_the_past_is_let_go_as_cores_own() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(5))), Some(local(day(4), 9, 0)), None).await;
    let task = todo.reminder.clone().unwrap().task_id;
    // Due today: the day before at 09:00 has passed. No error, no bell.
    let moved = by_hand(&galley, &todo, move_to(&ymd(day(0)))).await;
    assert_eq!(moved.due.as_ref().unwrap().date, ymd(day(0)));
    assert!(moved.reminder.is_none());
    let cancelled = galley.scheduled_task(task.as_str()).await.unwrap();
    assert!(cancelled.cancelled_at.is_some());
    assert_eq!(cancelled.cancelled_by.unwrap().via, OriginVia::System);
}

#[tokio::test]
async fn a_reminder_set_into_the_past_is_not_hung() {
    let galley = with_main_chat().await;
    // Due yesterday, reminded that day at 09:00: past, so none.
    let late = note(&galley, Some(ymd(day(-1))), None, None).await;
    let got = by_hand(&galley, &late, remind(0, "09:00")).await;
    assert!(got.reminder.is_none());
    // One it had is let go: a week before a day three days away.
    let todo = note(&galley, Some(ymd(day(3))), Some(local(day(2), 9, 0)), None).await;
    let got = by_hand(&galley, &todo, remind(7, "09:00")).await;
    assert!(got.reminder.is_none());
    // Ahead, it is hung: the same task, at the offset picked.
    let task = todo.reminder.clone().unwrap().task_id;
    let got = by_hand(&galley, &todo, remind(1, "20:30")).await;
    assert_ne!(got.reminder.as_ref().unwrap().task_id, task);
    assert_eq!(got.reminder.unwrap().at, instant(day(2), 20, 30));
    let got = by_hand(&galley, &got_todo(&galley, &todo).await, remind(0, "08:15")).await;
    assert_eq!(got.reminder.unwrap().at, instant(day(3), 8, 15));
}

async fn got_todo(galley: &SqliteGalley, todo: &TodoBrief) -> TodoBrief {
    galley.todo(todo.id.as_str()).await.unwrap()
}

#[tokio::test]
async fn a_repeating_periods_reminder_goes_to_the_next_time_ahead() {
    let galley = with_main_chat().await;
    let period = note(
        &galley,
        Some(ymd(day(7))),
        Some(local(day(6), 9, 0)),
        Some(weekly_on(day(7))),
    )
    .await;
    let task = period.reminder.clone().unwrap().task_id;
    let rule = period.repeat.clone().expect("a rule");
    // Moved to today: the day before at 09:00 has passed. The same task
    // goes to the day before the rule's first day after today — a week on.
    let moved = by_hand(&galley, &period, move_to(&ymd(day(0)))).await;
    assert_eq!(moved.due.as_ref().unwrap().date, ymd(day(0)));
    let reminder = moved.reminder.clone().expect("kept alive");
    assert_eq!(reminder.task_id, task);
    assert_eq!(reminder.at, instant(day(6), 9, 0));
    assert_eq!(reminder.state, TodoReminderState::Scheduled);
    // The period's change is its own: the rule as it was.
    assert_eq!(moved.repeat, Some(rule));
    // Set by hand into the past: kept alive the same way.
    let got = by_hand(&galley, &moved, remind(3, "09:00")).await;
    let reminder = got.reminder.expect("kept alive");
    assert_eq!(reminder.task_id, task);
    assert_eq!(reminder.at, instant(day(4), 9, 0));
}

#[tokio::test]
async fn no_reminder_picked_is_the_users_removal() {
    let galley = with_main_chat().await;
    let period = note(
        &galley,
        Some(ymd(day(7))),
        Some(local(day(6), 9, 0)),
        Some(weekly_on(day(7))),
    )
    .await;
    let task = period.reminder.clone().unwrap().task_id;
    let none = TodoWhenChange {
        remind: Some(None),
        ..TodoWhenChange::default()
    };
    let got = by_hand(&galley, &period, none).await;
    assert!(got.reminder.is_none());
    let cancelled = galley.scheduled_task(task.as_str()).await.unwrap();
    assert_eq!(cancelled.cancelled_by.unwrap().via, OriginVia::Gui);
    // Ticket 154's sweep reads it as removed on purpose.
    let armed = galley
        .rearm_unsettled_period_reminders(Utc::now(), &Local)
        .await
        .unwrap();
    assert_eq!(armed, 0);
    assert!(got_todo(&galley, &period).await.reminder.is_none());
}

#[tokio::test]
async fn no_due_date_takes_the_reminder_and_a_period_keeps_its_day() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(5))), Some(local(day(4), 20, 0)), None).await;
    let task = todo.reminder.clone().unwrap().task_id;
    let no_date = || TodoWhenChange {
        due: Some(None),
        ..TodoWhenChange::default()
    };
    let got = by_hand(&galley, &todo, no_date()).await;
    assert!(got.due.is_none() && got.reminder.is_none());
    let cancelled = galley.scheduled_task(task.as_str()).await.unwrap();
    assert_eq!(cancelled.cancelled_by.unwrap().via, OriginVia::System);
    // A repeating period needs its due date: refused, nothing written.
    let period = note(
        &galley,
        Some(ymd(day(7))),
        Some(local(day(6), 9, 0)),
        Some(weekly_on(day(7))),
    )
    .await;
    let err = galley
        .update_todo_by_hand(
            &id(&period),
            TodoPatch::default(),
            no_date(),
            Origin::desktop(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&err, GalleyError::InvalidArgs { message } if message.starts_with(REPEAT_NEEDS_DUE)),
        "{err:?}"
    );
    let still = got_todo(&galley, &period).await;
    assert_eq!(still.due, period.due);
    assert_eq!(still.reminder, period.reminder);
}

#[tokio::test]
async fn a_rule_given_by_hand_and_a_periods_day_leaving_it_alone() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(3))), None, None).await;
    let weekly = TodoWhenChange {
        repeat: Some(weekly_on(day(3))),
        ..TodoWhenChange::default()
    };
    let got = by_hand(&galley, &todo, weekly).await;
    let rule = got.repeat.clone().expect("repeats");
    assert_eq!(rule.rule, weekly_on(day(3)));
    assert!(got.series_id.is_some());
    // The period moved: the rule stays.
    let moved = by_hand(&galley, &got, move_to(&ymd(day(4)))).await;
    assert_eq!(moved.repeat, Some(rule));
    assert_eq!(moved.series_id, got.series_id);
    // Monthly on the due day's date, by hand too.
    let monthly = TodoWhenChange {
        repeat: Some(TodoRepeatRule {
            kind: TodoRepeatKind::Monthly,
            weekdays: Vec::new(),
            monthdays: vec![day(4).day() as u8],
            every: 1,
        }),
        ..TodoWhenChange::default()
    };
    let got = by_hand(&galley, &moved, monthly).await;
    assert_eq!(got.repeat.unwrap().rule.kind, TodoRepeatKind::Monthly);
}

#[tokio::test]
async fn the_words_alone_are_as_before_and_the_cli_moves_no_reminder() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(5))), Some(local(day(4), 20, 0)), None).await;
    let got = galley
        .update_todo_by_hand(
            &id(&todo),
            TodoPatch::words(Some("交季度报告".into()), None),
            TodoWhenChange::default(),
            Origin::desktop(),
        )
        .await
        .unwrap();
    assert_eq!(got.title, "交季度报告");
    assert_eq!(got.reminder, todo.reminder);
    // `todo update --due` as the CLI sends it: the reminder stays put.
    let got = galley
        .update_todo(
            &id(&todo),
            TodoPatch {
                due: Some(Some(ymd(day(10)))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    assert_eq!(got.due.unwrap().date, ymd(day(10)));
    assert_eq!(got.reminder.unwrap().at, instant(day(4), 20, 0));
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<String>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, _payload: Value) {
        self.events.lock().unwrap().push(event.to_string());
    }
}

#[tokio::test]
async fn a_change_by_hand_tells_the_desktop() {
    let galley = with_main_chat().await;
    let todo = note(&galley, Some(ymd(day(5))), Some(local(day(4), 20, 0)), None).await;
    let rec = Recorder::default();
    Writes::new(&galley, &rec, "test")
        .update_todo_by_hand(
            &id(&todo),
            TodoPatch::default(),
            move_to(&ymd(day(6))),
            Origin::desktop(),
        )
        .await
        .unwrap();
    assert_eq!(
        *rec.events.lock().unwrap(),
        [TODOS_CHANGED_EVENT, SCHEDULED_TASKS_CHANGED_EVENT]
    );
}
