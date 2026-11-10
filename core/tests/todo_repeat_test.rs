//! Repeating to-dos (main chat ticket 154; PRD rulings 204 and 202)
//! against an in-memory database: the rule (`todo_series`, migration 057)
//! made with its first period, the next period made in the transaction
//! that ticks one off or skips one, deleting a period ending the rule,
//! `noRepeat`, a change to one period and `series` taking it into the
//! rule, a rule given to an ordinary to-do and a rule changed, the due date
//! a repeating period keeps, the reminder each period gets, the list's
//! fields, the follow-ups turned down, a main chat reset, the external
//! runtime refusing every write, and (behaviour 13) a period left
//! unsettled reminded again at each later period's time. Core reads days in this machine's zone
//! (`Local`), so every date here is counted from today there; the date
//! arithmetic itself, in fixed zones, is `todo_repeat`'s unit tests.

use std::sync::Mutex;

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use galley_core_lib::api::schedule::{
    instant_to_utc_iso, ScheduledTaskId, ScheduledWake, SCHEDULED_TASKS_CHANGED_EVENT,
};
use galley_core_lib::api::{
    CreateTodoInput, GalleyApi, Origin, OriginVia, ScheduledTaskPatch, SessionId, TodoBrief,
    TodoId, TodoPatch, TodoReminderState, TodoRepeatKind, TodoRepeatRemind, TodoRepeatRule,
    TodoStatus, ASSISTANT_SUPERVISOR, ASSISTANT_UNAVAILABLE, NOT_REPEATING, REPEAT_NEEDS_DUE,
    REPEAT_SUPERVISOR, TIME_IN_PAST, TODOS_CHANGED_EVENT,
};
use galley_core_lib::assistant_todo::{assistant_todo, declined_follow_ups};
use galley_core_lib::db::{MainChatSeed, SqliteGalley};
use galley_core_lib::error::GalleyError;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::RunnerManager;
use galley_core_lib::scheduler::{due_at, rearm_unsettled_periods};
use galley_core_lib::session_writes::Writes;
use serde_json::{json, Value};
use sqlx::SqlitePool;

const MAIN: &str = "s-main";

async fn with_main_chat() -> (SqlitePool, SqliteGalley) {
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
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("runtime");
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
        reason: Some("the user said so".into()),
        client: None,
    }
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn day(offset: i64) -> NaiveDate {
    today() + Duration::days(offset)
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

fn weekday(day: NaiveDate) -> u8 {
    day.weekday().number_from_monday() as u8
}

fn rule(kind: TodoRepeatKind, weekdays: &[u8], monthdays: &[u8], every: u32) -> TodoRepeatRule {
    TodoRepeatRule {
        kind,
        weekdays: weekdays.to_vec(),
        monthdays: monthdays.to_vec(),
        every,
    }
}

/// Weekly on the weekday of `on`.
fn weekly_on(on: NaiveDate) -> TodoRepeatRule {
    rule(TodoRepeatKind::Weekly, &[weekday(on)], &[], 1)
}

fn daily() -> TodoRepeatRule {
    rule(TodoRepeatKind::Daily, &[], &[], 1)
}

/// A repeating to-do Galley notes, due `due`.
async fn repeating(
    galley: &SqliteGalley,
    title: &str,
    due: &str,
    repeat: TodoRepeatRule,
) -> TodoBrief {
    galley
        .create_todo(
            CreateTodoInput {
                title: title.into(),
                due: Some(due.into()),
                repeat: Some(repeat),
                ..CreateTodoInput::default()
            },
            assistant(),
            Some((SessionId(MAIN.into()), 1)),
        )
        .await
        .expect("create a repeating to-do")
}

fn id(todo: &TodoBrief) -> TodoId {
    todo.id.clone()
}

fn invalid_with(err: GalleyError, prefix: &str) -> bool {
    matches!(err, GalleyError::InvalidArgs { ref message } if message.starts_with(prefix))
}

/// The rule's row, as stored.
#[derive(Debug, sqlx::FromRow)]
struct SeriesRow {
    title: String,
    notes: Option<String>,
    items: Option<String>,
    repeat_kind: String,
    repeat_every: i64,
    repeat_days: Option<String>,
    anchor_date: String,
    time_of_day: Option<String>,
    remind_days_before: Option<i64>,
    remind_time: Option<String>,
    ended_at: Option<String>,
    ended_via: Option<String>,
    ended_by_supervisor: Option<String>,
    ended_origin_note: Option<String>,
    created_via: String,
    created_by_supervisor: Option<String>,
}

async fn series(pool: &SqlitePool, todo: &TodoBrief) -> SeriesRow {
    let series_id = todo.series_id.as_deref().expect("a period of a rule");
    sqlx::query_as::<_, SeriesRow>(
        "SELECT title, notes, items, repeat_kind, repeat_every, repeat_days, anchor_date, \
            time_of_day, remind_days_before, remind_time, ended_at, ended_via, \
            ended_by_supervisor, ended_origin_note, created_via, created_by_supervisor \
         FROM todo_series WHERE id = ?",
    )
    .bind(series_id)
    .fetch_one(pool)
    .await
    .expect("the rule")
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.expect(sql)
}

/// The periods of `todo`'s rule, oldest first: (due day, status).
async fn periods(galley: &SqliteGalley, todo: &TodoBrief) -> Vec<(String, TodoStatus)> {
    let mut all: Vec<TodoBrief> = galley
        .list_todos(galley_core_lib::db::TodoListScope::All)
        .await
        .unwrap()
        .into_iter()
        .filter(|t| t.series_id == todo.series_id)
        .collect();
    let mut periods: Vec<(String, TodoStatus)> = all
        .drain(..)
        .map(|t| (t.due.map(|d| d.date).unwrap_or_default(), t.status))
        .collect();
    periods.sort_by(|a, b| a.0.cmp(&b.0));
    periods
}

// ---------------- the rule and its first period ----------------

#[tokio::test]
async fn a_repeating_to_do_is_a_rule_and_its_first_period() {
    let (pool, galley) = with_main_chat().await;
    let monday = day(3);
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: " 交周报 ".into(),
                notes: Some("发给王总".into()),
                due: Some(ymd(monday)),
                items: vec!["汇总数据".into(), "写结论".into()],
                repeat: Some(rule(
                    TodoRepeatKind::Weekly,
                    &[weekday(monday), weekday(monday)],
                    &[],
                    2,
                )),
                ..CreateTodoInput::default()
            },
            assistant(),
            Some((SessionId(MAIN.into()), 1)),
        )
        .await
        .expect("create");
    // The first period: an ordinary to-do, due on the day given.
    assert_eq!(report.status, TodoStatus::Open);
    assert_eq!(report.due.as_ref().unwrap().date, ymd(monday));
    let series_id = report.series_id.clone().expect("series id");
    let hex = series_id.strip_prefix("series_").expect("series_ id");
    assert_eq!(hex.len(), 16);
    // `repeat` on the wire: every 2, the weekday once, no reminder.
    let wire = serde_json::to_value(&report).unwrap();
    assert_eq!(
        wire["repeat"],
        json!({"kind": "weekly", "weekdays": [weekday(monday)], "every": 2})
    );
    assert_eq!(wire["seriesId"], json!(series_id));
    assert!(wire.get("skipped").is_none());
    // The rule carries the to-do as it is now, anchored on its day.
    let row = series(&pool, &report).await;
    assert_eq!(row.title, "交周报");
    assert_eq!(row.notes.as_deref(), Some("发给王总"));
    assert_eq!(row.items.as_deref(), Some(r#"["汇总数据","写结论"]"#));
    assert_eq!(row.repeat_kind, "weekly");
    assert_eq!(row.repeat_every, 2);
    assert_eq!(row.repeat_days, Some(weekday(monday).to_string()));
    assert_eq!(row.anchor_date, ymd(monday));
    assert_eq!(row.time_of_day, None);
    assert_eq!((row.remind_days_before, row.remind_time), (None, None));
    assert_eq!(row.ended_at, None);
    assert_eq!(row.created_via, "supervisor");
    assert_eq!(
        row.created_by_supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );

    // With a due time and a reminder: the rule keeps the time, and the
    // reminder as days before and a time of day; `every` 1 is not written.
    let call = galley
        .create_todo(
            CreateTodoInput {
                title: "给妈妈打电话".into(),
                due: Some(local(day(2), 15, 0)),
                remind_at: Some(local(day(1), 20, 0)),
                repeat: Some(rule(TodoRepeatKind::Monthly, &[], &[31, 15], 1)),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .expect("create");
    let row = series(&pool, &call).await;
    assert_eq!(row.time_of_day.as_deref(), Some("15:00"));
    assert_eq!(row.remind_days_before, Some(1));
    assert_eq!(row.remind_time.as_deref(), Some("20:00"));
    assert_eq!(row.repeat_days.as_deref(), Some("15,31"));
    let wire = serde_json::to_value(&call).unwrap();
    assert_eq!(
        wire["repeat"],
        json!({"kind": "monthly", "monthdays": [15, 31], "remind": {"daysBefore": 1, "time": "20:00"}})
    );
    // A to-do that does not repeat says nothing of it.
    let plain = galley
        .create_todo(
            CreateTodoInput {
                title: "买营养土".into(),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let wire = serde_json::to_value(&plain).unwrap();
    for field in ["repeat", "seriesId", "skipped"] {
        assert!(wire.get(field).is_none(), "{field}");
    }
}

#[tokio::test]
async fn a_rule_needs_a_due_date_and_a_bad_rule_writes_nothing() {
    let (pool, galley) = with_main_chat().await;
    let refused = |input: CreateTodoInput| {
        let galley = galley.clone();
        async move {
            galley
                .create_todo(input, assistant(), None)
                .await
                .unwrap_err()
        }
    };
    let no_due = refused(CreateTodoInput {
        title: "交周报".into(),
        repeat: Some(weekly_on(day(0))),
        ..CreateTodoInput::default()
    })
    .await;
    assert!(invalid_with(no_due, REPEAT_NEEDS_DUE));
    for bad in [
        rule(TodoRepeatKind::Weekly, &[], &[], 1),
        rule(TodoRepeatKind::Weekly, &[8], &[], 1),
        rule(TodoRepeatKind::Monthly, &[], &[0], 1),
        rule(TodoRepeatKind::Daily, &[1], &[], 1),
        rule(TodoRepeatKind::Daily, &[], &[], 0),
        rule(TodoRepeatKind::Daily, &[], &[], 366),
    ] {
        let err = refused(CreateTodoInput {
            title: "交周报".into(),
            due: Some(ymd(day(1))),
            repeat: Some(bad.clone()),
            ..CreateTodoInput::default()
        })
        .await;
        assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{bad:?}");
    }
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todo_series").await, 0);
}

// ---------------- settling a period makes the next ----------------

#[tokio::test]
async fn ticked_off_a_week_late_the_next_is_next_week_not_today() {
    let (pool, galley) = with_main_chat().await;
    // Due on today's weekday a week ago: overdue a week.
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                notes: Some("发给王总".into()),
                due: Some(ymd(day(-7))),
                items: vec!["汇总数据".into(), "写结论".into()],
                repeat: Some(weekly_on(day(0))),
                ..CreateTodoInput::default()
            },
            assistant(),
            Some((SessionId(MAIN.into()), 1)),
        )
        .await
        .unwrap();
    // This period's progress: an item ticked, notes added to.
    let first_item = report.items[0].id.clone();
    galley
        .complete_todo_subitem(&first_item, assistant())
        .await
        .unwrap();
    galley
        .update_todo(
            &id(&report),
            TodoPatch {
                notes: Some(Some("发给王总；数据已汇总".into())),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let settled = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap();
    assert_eq!(settled.todo.status, TodoStatus::Done);
    let next = settled.next.expect("the next period");
    assert_eq!(next.due.as_ref().unwrap().date, ymd(day(7)));
    assert!(!next.due.as_ref().unwrap().has_time);
    // What the rule carries: title, the notes it was made with, every
    // item unticked.
    assert_eq!(next.title, "交周报");
    assert_eq!(next.notes.as_deref(), Some("发给王总"));
    let texts: Vec<(&str, bool)> = next
        .items
        .iter()
        .map(|i| (i.text.as_str(), i.done))
        .collect();
    assert_eq!(texts, [("汇总数据", false), ("写结论", false)]);
    // Made by Core, in no turn, made and changed in one instant.
    assert_eq!(next.origin.via, OriginVia::System);
    assert_eq!(next.origin.supervisor.as_deref(), Some(REPEAT_SUPERVISOR));
    assert!(next.created_in.is_none());
    assert_eq!(next.created_at, next.updated_at);
    assert_eq!(next.series_id, report.series_id);
    assert_eq!(next.status, TodoStatus::Open);
    assert!(next.repeat.is_some());
    // The wire: `next` beside `todo`.
    let wire = serde_json::to_value(galley_core_lib::api::TodoSettled {
        todo: settled.todo.clone(),
        next: Some(next.clone()),
    })
    .unwrap();
    assert_eq!(
        wire["next"]["origin"],
        json!({"via": "system", "supervisor": "galley-repeat"})
    );
    // Ticking it off again changes nothing and makes nothing.
    let again = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap();
    assert!(again.next.is_none());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 2);
}

#[tokio::test]
async fn ticked_off_early_the_next_is_the_one_after_its_day() {
    let (_pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(3)), weekly_on(day(3))).await;
    let next = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(next.due.unwrap().date, ymd(day(10)));
}

#[tokio::test]
async fn a_daily_one_ticked_off_a_day_late_is_due_tomorrow() {
    let (_pool, galley) = with_main_chat().await;
    let pills = repeating(&galley, "吃药", &ymd(day(-1)), daily()).await;
    let next = galley
        .complete_todo_with_next(&id(&pills), Origin::desktop())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(next.due.unwrap().date, ymd(day(1)));
    // The desktop's tick is the plain write: the to-do, ticked.
    let next_next = galley
        .complete_todo(&next.id, Origin::desktop())
        .await
        .unwrap();
    assert_eq!(next_next.status, TodoStatus::Done);
}

#[tokio::test]
async fn a_next_period_that_fails_leaves_the_tick_undone() {
    let (pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    sqlx::raw_sql(
        "CREATE TRIGGER no_next BEFORE INSERT ON todos \
         WHEN NEW.created_by_supervisor = 'galley-repeat' \
         BEGIN SELECT RAISE(ABORT, 'no next period'); END;",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .is_err());
    // Nothing half done: the period is still open, nothing was made.
    let still = galley.todo(report.id.as_str()).await.unwrap();
    assert_eq!(still.status, TodoStatus::Open);
    assert_eq!(still.done_at, None);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 1);
    // Skipping fails the same way.
    assert!(galley.skip_todo(&id(&report), assistant()).await.is_err());
    let still = galley.todo(report.id.as_str()).await.unwrap();
    assert_eq!(still.status, TodoStatus::Open);
    assert!(!still.skipped);
    sqlx::raw_sql("DROP TRIGGER no_next")
        .execute(&pool)
        .await
        .unwrap();
    let settled = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap();
    assert!(settled.next.is_some());
}

#[tokio::test]
async fn unticked_after_the_next_was_made_two_are_open_and_no_day_comes_twice() {
    let (pool, galley) = with_main_chat().await;
    let first = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    let second = galley
        .complete_todo_with_next(&id(&first), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(second.due.as_ref().unwrap().date, ymd(day(7)));
    // Unticking opens this one only; the next stays.
    let reopened = galley.reopen_todo(&id(&first), assistant()).await.unwrap();
    assert_eq!(reopened.status, TodoStatus::Open);
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM todos WHERE done_at IS NULL AND cancelled_at IS NULL"
        )
        .await,
        2
    );
    // Ticking one off while the other is open makes nothing.
    let settled = galley
        .complete_todo_with_next(&id(&second), assistant())
        .await
        .unwrap();
    assert!(settled.next.is_none());
    // Both settled: the next, after the latest day so far.
    let third = galley
        .complete_todo_with_next(&id(&first), assistant())
        .await
        .unwrap()
        .next
        .expect("the next once both are settled");
    assert_eq!(third.due.unwrap().date, ymd(day(14)));
    assert_eq!(
        periods(&galley, &first).await,
        [
            (ymd(day(0)), TodoStatus::Done),
            (ymd(day(7)), TodoStatus::Done),
            (ymd(day(14)), TodoStatus::Open),
        ]
    );
}

// ---------------- skipping ----------------

#[tokio::test]
async fn skipping_cancels_this_period_marked_and_makes_the_next() {
    let (pool, galley) = with_main_chat().await;
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(local(day(1), 18, 0)),
                remind_at: Some(local(day(1), 9, 0)),
                repeat: Some(weekly_on(day(1))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let reminder = report.reminder.clone().expect("a reminder").task_id;
    let settled = galley
        .skip_todo(&id(&report), Origin::desktop())
        .await
        .unwrap();
    let skipped = settled.todo;
    assert_eq!(skipped.status, TodoStatus::Cancelled);
    assert!(skipped.skipped);
    let by = skipped.cancelled_by.as_ref().expect("who skipped it");
    assert_eq!(by.via, OriginVia::Gui);
    let wire = serde_json::to_value(&skipped).unwrap();
    assert_eq!(wire["skipped"], json!(true));
    // Its reminder let go, as a cancel lets it go.
    let task = galley.scheduled_task(reminder.as_str()).await.unwrap();
    assert!(task.cancelled_at.is_some());
    assert_eq!(task.cancelled_by.unwrap().via, OriginVia::System);
    // The next one, a week on, with its own reminder at the same offset.
    let next = settled.next.expect("the next period");
    assert_eq!(
        next.due.as_ref().unwrap().at.as_deref(),
        Some(instant(day(8), 18, 0).as_str())
    );
    let next_reminder = next.reminder.as_ref().expect("the next reminder");
    assert_eq!(next_reminder.at, instant(day(8), 9, 0));
    assert_eq!(next_reminder.state, TodoReminderState::Scheduled);
    let task = galley
        .scheduled_task(next_reminder.task_id.as_str())
        .await
        .unwrap();
    assert_eq!(task.origin.as_ref().unwrap().via, OriginVia::System);
    assert_eq!(
        task.origin.as_ref().unwrap().supervisor.as_deref(),
        Some(REPEAT_SUPERVISOR)
    );
    assert_eq!(task.todo_id.as_deref(), Some(next.id.as_str()));
    // A cancelled period is gone for every write, a second skip included.
    assert!(matches!(
        galley
            .skip_todo(&id(&report), assistant())
            .await
            .unwrap_err(),
        GalleyError::NotFound { .. }
    ));
    // A done period is not skipped: untick it first.
    galley.complete_todo(&next.id, assistant()).await.unwrap();
    let err = galley.skip_todo(&next.id, assistant()).await.unwrap_err();
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    assert!(!invalid_with(err, NOT_REPEATING));
    // A to-do that does not repeat: `not_repeating:`.
    let plain = galley
        .create_todo(
            CreateTodoInput {
                title: "买营养土".into(),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let err = galley
        .skip_todo(&id(&plain), assistant())
        .await
        .unwrap_err();
    assert!(invalid_with(err, NOT_REPEATING));
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM todos WHERE skipped = 1").await,
        1
    );
}

#[tokio::test]
async fn a_next_reminder_whose_time_has_passed_is_not_hung() {
    let (pool, galley) = with_main_chat().await;
    let call = galley
        .create_todo(
            CreateTodoInput {
                title: "给妈妈打电话".into(),
                due: Some(ymd(day(1))),
                remind_at: Some(local(day(1), 10, 0)),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    // Thirty days ahead of each period: the next one's time is long past.
    sqlx::query("UPDATE todo_series SET remind_days_before = 30")
        .execute(&pool)
        .await
        .unwrap();
    let next = galley
        .complete_todo_with_next(&id(&call), assistant())
        .await
        .expect("no error for a time past")
        .next
        .unwrap();
    assert_eq!(next.due.as_ref().unwrap().date, ymd(day(2)));
    assert!(next.reminder.is_none());
    // Left unticked, the sweep hangs it one (behaviour 13): not its own
    // (thirty days back), the first of the rule's later days' still ahead.
    // Late tonight, tomorrow's day-31 period's reminder is the first.
    let tonight = utc(&instant(day(0), 23, 0));
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(tonight, &Local)
            .await
            .unwrap(),
        1
    );
    let hung = galley.todo(next.id.as_str()).await.unwrap();
    assert_eq!(hung.reminder.as_ref().unwrap().at, instant(day(1), 10, 0));
    assert_eq!(hung.updated_at, hung.created_at, "hanging it is no move");
    // A second sweep makes nothing more.
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(tonight, &Local)
            .await
            .unwrap(),
        0
    );
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks WHERE todo_id = ?")
        .bind(next.id.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tasks, 1);
}

// ---------------- ending the rule ----------------

#[tokio::test]
async fn deleting_a_period_ends_its_rule_and_makes_no_next() {
    let (pool, galley) = with_main_chat().await;
    let first = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    let second = galley
        .complete_todo_with_next(&id(&first), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    let cancelled = galley
        .cancel_todo(&id(&second), Origin::desktop())
        .await
        .unwrap();
    assert_eq!(cancelled.status, TodoStatus::Cancelled);
    assert!(!cancelled.skipped);
    assert!(cancelled.repeat.is_none(), "the rule ended");
    assert_eq!(cancelled.series_id, first.series_id);
    let row = series(&pool, &first).await;
    assert!(row.ended_at.is_some());
    assert_eq!(row.ended_via.as_deref(), Some("gui"));
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 2);
    // The done period no longer repeats either.
    assert!(galley
        .todo(first.id.as_str())
        .await
        .unwrap()
        .repeat
        .is_none());
    // An ended rule takes no skip.
    let reopened = galley.reopen_todo(&id(&first), assistant()).await.unwrap();
    let err = galley
        .skip_todo(&id(&reopened), assistant())
        .await
        .unwrap_err();
    assert!(invalid_with(err, NOT_REPEATING));
}

#[tokio::test]
async fn no_repeat_ends_the_rule_and_leaves_the_period() {
    let (pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(2)), weekly_on(day(2))).await;
    let stopped = galley
        .update_todo(&id(&report), TodoPatch::stop_repeating(), assistant())
        .await
        .unwrap();
    assert_eq!(stopped.status, TodoStatus::Open);
    assert!(stopped.repeat.is_none());
    assert_eq!(stopped.series_id, report.series_id);
    assert_eq!(stopped.due, report.due);
    let row = series(&pool, &report).await;
    assert!(row.ended_at.is_some());
    assert_eq!(row.ended_via.as_deref(), Some("supervisor"));
    assert_eq!(
        row.ended_by_supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );
    assert_eq!(row.ended_origin_note.as_deref(), Some("the user said so"));
    // Ticked off, it makes nothing.
    let settled = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap();
    assert!(settled.next.is_none());
    // Once more, and `series`, on one that does not repeat: refused.
    galley.reopen_todo(&id(&report), assistant()).await.unwrap();
    for patch in [
        TodoPatch::stop_repeating(),
        TodoPatch {
            series: true,
            ..TodoPatch::default()
        },
    ] {
        let err = galley
            .update_todo(&id(&report), patch, assistant())
            .await
            .unwrap_err();
        assert!(invalid_with(err, NOT_REPEATING));
    }
    // A new rule with `noRepeat`, or `series` with it: refused.
    let err = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                no_repeat: true,
                repeat: Some(daily()),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

// ---------------- changing a period, and the rule ----------------

#[tokio::test]
async fn a_change_is_the_periods_alone_unless_series_takes_it_into_the_rule() {
    let (pool, galley) = with_main_chat().await;
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                notes: Some("发给王总".into()),
                due: Some(ymd(day(2))),
                items: vec!["汇总数据".into()],
                repeat: Some(weekly_on(day(2))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let before = series(&pool, &report).await;
    // This period alone: title, notes, due time, reminder.
    galley
        .update_todo(
            &id(&report),
            TodoPatch {
                title: Some("交周报（本周加图表）".into()),
                notes: Some(Some("发给王总；本周要加图表".into())),
                due: Some(Some(local(day(3), 17, 0))),
                remind_at: Some(Some(local(day(3), 9, 30))),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let after = series(&pool, &report).await;
    assert_eq!(after.title, before.title);
    assert_eq!(after.notes, before.notes);
    assert_eq!(after.anchor_date, before.anchor_date);
    assert_eq!(after.time_of_day, None);
    assert_eq!(after.remind_time, None);

    // `series` alone: the title, the items' words, the reminder's offset,
    // the due time — not the notes (none given), not the anchor (no due).
    galley
        .add_todo_subitems(&id(&report), &["画图表".into()], assistant())
        .await
        .unwrap();
    galley
        .update_todo(
            &id(&report),
            TodoPatch {
                series: true,
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &report).await;
    assert_eq!(row.title, "交周报（本周加图表）");
    assert_eq!(row.items.as_deref(), Some(r#"["汇总数据","画图表"]"#));
    assert_eq!(row.time_of_day.as_deref(), Some("17:00"));
    assert_eq!(row.remind_days_before, Some(0));
    assert_eq!(row.remind_time.as_deref(), Some("09:30"));
    assert_eq!(row.notes.as_deref(), Some("发给王总"));
    assert_eq!(row.anchor_date, ymd(day(2)));

    // With `--notes` and `--due` in the same command: the notes and the
    // anchor too; no reminder any more clears the offset.
    galley
        .update_todo(
            &id(&report),
            TodoPatch {
                notes: Some(Some("发给李总".into())),
                due: Some(Some(ymd(day(4)))),
                remind_at: Some(None),
                series: true,
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &report).await;
    assert_eq!(row.notes.as_deref(), Some("发给李总"));
    assert_eq!(row.anchor_date, ymd(day(4)));
    assert_eq!(row.time_of_day, None);
    assert_eq!((row.remind_days_before, row.remind_time), (None, None));
    // Empty notes with `series`: the rule's go too.
    galley
        .update_todo(
            &id(&report),
            TodoPatch {
                notes: Some(None),
                series: true,
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    assert_eq!(series(&pool, &report).await.notes, None);
    // A done period is not taken into the rule: ticking it off let its
    // reminder go, which would read as none.
    galley
        .complete_todo(&id(&report), assistant())
        .await
        .unwrap();
    let err = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                title: Some("交周报".into()),
                series: true,
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    assert!(!invalid_with(err, NOT_REPEATING));
}

/// Ticket 158: 「以后都提前两天提醒」 said of a weekly period due tomorrow.
/// Two days before it has passed: with `series` that is not
/// `time_in_past:`. The rule takes the offset (two days before, 09:00), and
/// this period's reminder — the same task, moved — goes to the first of
/// the rule's reminder times still ahead: its own has passed, so next
/// week's, two days before the next period's day. The output carries both.
/// Without `series` the same time is refused as before and nothing moves;
/// on a to-do that does not repeat, `series` is still `not_repeating:`.
#[tokio::test]
async fn series_takes_a_past_reminder_time_into_the_rule_and_hangs_the_next_ahead() {
    let (pool, galley) = with_main_chat().await;
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(ymd(day(1))),
                remind_at: Some(local(day(1), 9, 0)),
                repeat: Some(weekly_on(day(1))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let task = report.reminder.clone().unwrap().task_id;
    let two_days_before = || TodoPatch {
        remind_at: Some(Some(local(day(-1), 9, 0))),
        ..TodoPatch::default()
    };
    // This period alone: refused, as before; nothing moved.
    let err = galley
        .update_todo(&id(&report), two_days_before(), assistant())
        .await
        .unwrap_err();
    assert!(invalid_with(err, TIME_IN_PAST));
    let row = series(&pool, &report).await;
    assert_eq!(
        (row.remind_days_before, row.remind_time.as_deref()),
        (Some(0), Some("09:00"))
    );
    assert_eq!(
        reminder_task(&galley, &task).await.fire_at.as_deref(),
        Some(instant(day(1), 9, 0).as_str())
    );
    // Every one from now on: the rule's offset, and this one's reminder at
    // the next time still ahead.
    let updated = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                series: true,
                ..two_days_before()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &report).await;
    assert_eq!(
        (row.remind_days_before, row.remind_time.as_deref()),
        (Some(2), Some("09:00"))
    );
    assert_eq!(
        updated.repeat.as_ref().unwrap().remind,
        Some(TodoRepeatRemind {
            days_before: 2,
            time: "09:00".into()
        })
    );
    let reminder = updated.reminder.clone().unwrap();
    assert_eq!(reminder.task_id, task);
    assert_eq!(reminder.at, instant(day(6), 9, 0));
    assert_eq!(reminder.state, TodoReminderState::Scheduled);
    assert_eq!(updated.due.as_ref().unwrap().date, ymd(day(1)));
    assert_eq!(live_reminders(&pool).await.len(), 1);
    // A period with no reminder yet gets one, at the same next time.
    let call = repeating(&galley, "回房东电话", &ymd(day(1)), weekly_on(day(1))).await;
    let updated = galley
        .update_todo(
            &id(&call),
            TodoPatch {
                series: true,
                ..two_days_before()
            },
            assistant(),
        )
        .await
        .unwrap();
    assert_eq!(updated.reminder.unwrap().at, instant(day(6), 9, 0));
    // A rule given in the same command counts too.
    let plain = galley
        .create_todo(
            CreateTodoInput {
                title: "交房租".into(),
                due: Some(ymd(day(1))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let rent = galley
        .update_todo(
            &id(&plain),
            TodoPatch {
                repeat: Some(weekly_on(day(1))),
                series: true,
                ..two_days_before()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &rent).await;
    assert_eq!(
        (row.remind_days_before, row.remind_time.as_deref()),
        (Some(2), Some("09:00"))
    );
    assert_eq!(rent.reminder.unwrap().at, instant(day(6), 9, 0));
    // Every two weeks, moved a week on with `--due` in the same command:
    // the rule counts from the new day, so the next time ahead is two
    // weeks after it (day 22, nine days before: day 13), not the old
    // phase's day 15 (day 6).
    let fortnight = repeating(
        &galley,
        "交双周报",
        &ymd(day(1)),
        rule(TodoRepeatKind::Weekly, &[weekday(day(1))], &[], 2),
    )
    .await;
    let moved = galley
        .update_todo(
            &id(&fortnight),
            TodoPatch {
                due: Some(Some(ymd(day(8)))),
                series: true,
                ..two_days_before()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &moved).await;
    assert_eq!(row.anchor_date, ymd(day(8)));
    assert_eq!(
        (row.remind_days_before, row.remind_time.as_deref()),
        (Some(9), Some("09:00"))
    );
    assert_eq!(moved.reminder.unwrap().at, instant(day(13), 9, 0));
    // A to-do that does not repeat: `series` is refused first.
    let once = galley
        .create_todo(
            CreateTodoInput {
                title: "买营养土".into(),
                due: Some(ymd(day(1))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let err = galley
        .update_todo(
            &id(&once),
            TodoPatch {
                series: true,
                ..two_days_before()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, NOT_REPEATING));
    assert!(galley
        .todo(once.id.as_str())
        .await
        .unwrap()
        .reminder
        .is_none());
}

#[tokio::test]
async fn an_ordinary_to_do_takes_a_rule_and_a_repeating_one_a_new_rule() {
    let (pool, galley) = with_main_chat().await;
    let plain = galley
        .create_todo(
            CreateTodoInput {
                title: "交房租".into(),
                notes: Some("转给房东".into()),
                items: vec!["查余额".into()],
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let monthly = rule(TodoRepeatKind::Monthly, &[], &[15], 1);
    // No due date: refused, nothing written.
    let err = galley
        .update_todo(
            &id(&plain),
            TodoPatch {
                repeat: Some(monthly.clone()),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, REPEAT_NEEDS_DUE));
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todo_series").await, 0);
    // With one in the same command: a rule anchored there, carrying the
    // to-do as it now is.
    let rent = galley
        .update_todo(
            &id(&plain),
            TodoPatch {
                due: Some(Some(ymd(day(5)))),
                repeat: Some(monthly),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &rent).await;
    assert_eq!(row.title, "交房租");
    assert_eq!(row.notes.as_deref(), Some("转给房东"));
    assert_eq!(row.items.as_deref(), Some(r#"["查余额"]"#));
    assert_eq!(row.repeat_kind, "monthly");
    assert_eq!(row.repeat_days.as_deref(), Some("15"));
    assert_eq!(row.anchor_date, ymd(day(5)));
    assert_eq!(
        row.created_by_supervisor.as_deref(),
        Some(ASSISTANT_SUPERVISOR)
    );
    assert!(rent.repeat.is_some());
    // A new rule on a repeating one: kind, days, every, the anchor on its
    // due date; the rest stays.
    galley
        .update_todo(
            &id(&rent),
            TodoPatch {
                title: Some("交房租和水电".into()),
                due: Some(Some(ymd(day(6)))),
                repeat: Some(rule(TodoRepeatKind::Monthly, &[], &[1], 3)),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    let row = series(&pool, &rent).await;
    assert_eq!(row.repeat_every, 3);
    assert_eq!(row.repeat_days.as_deref(), Some("1"));
    assert_eq!(row.anchor_date, ymd(day(6)));
    assert_eq!(row.title, "交房租");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todo_series").await, 1);
    // A done to-do that does not repeat takes no rule: untick it first.
    let done = galley
        .create_todo(
            CreateTodoInput {
                title: "体检".into(),
                due: Some(ymd(day(1))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    galley.complete_todo(&id(&done), assistant()).await.unwrap();
    let err = galley
        .update_todo(
            &id(&done),
            TodoPatch {
                repeat: Some(rule(TodoRepeatKind::Yearly, &[], &[], 1)),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn a_repeating_period_keeps_its_due_date() {
    let (_pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(2)), weekly_on(day(2))).await;
    let err = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                title: Some("改了".into()),
                due: Some(None),
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, REPEAT_NEEDS_DUE));
    let unchanged = galley.todo(report.id.as_str()).await.unwrap();
    assert_eq!(unchanged.title, "交周报");
    assert_eq!(unchanged.due, report.due);
    // Ending the rule in the same command lets it go.
    let plain = galley
        .update_todo(
            &id(&report),
            TodoPatch {
                due: Some(None),
                no_repeat: true,
                ..TodoPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    assert!(plain.due.is_none() && plain.repeat.is_none());
}

// ---------------- what reads them ----------------

#[tokio::test]
async fn the_list_carries_the_rule_and_the_follow_ups_leave_a_skip_out() {
    let (_pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    let list = assistant_todo(&galley, &RunnerManager::new(), Utc::now())
        .await
        .unwrap();
    let row = list
        .yours
        .iter()
        .find(|i| i.id == report.id.as_str())
        .unwrap();
    assert_eq!(row.series_id, report.series_id);
    let wire = serde_json::to_value(row).unwrap();
    assert_eq!(
        wire["todoRepeat"],
        json!({"kind": "weekly", "weekdays": [weekday(day(0))]})
    );
    assert!(wire.get("repeat").is_none(), "a task's field");
    // Skipped on the desktop: no follow-up turned down. The next, deleted
    // on the desktop: one.
    let next = galley
        .skip_todo(&id(&report), Origin::desktop())
        .await
        .unwrap()
        .next
        .unwrap();
    galley
        .cancel_todo(&next.id, Origin::desktop())
        .await
        .unwrap();
    let declined = declined_follow_ups(&galley, Utc::now()).await.unwrap();
    let ids: Vec<&str> = declined.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, [next.id.as_str()]);
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
async fn skipping_tells_the_desktop() {
    let (_pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    let rec = Recorder::default();
    let writes = Writes::new(&galley, &rec, "test");
    writes.skip_todo(&id(&report), assistant()).await.unwrap();
    assert_eq!(
        *rec.events.lock().unwrap(),
        [TODOS_CHANGED_EVENT, SCHEDULED_TASKS_CHANGED_EVENT]
    );
}

#[tokio::test]
async fn a_main_chat_reset_deletes_every_rule() {
    let (pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    galley
        .complete_todo(&id(&report), assistant())
        .await
        .unwrap();
    repeating(&galley, "吃药", &ymd(day(0)), daily()).await;
    let deletion = galley
        .delete_main_chat_for_reset(&SessionId(MAIN.into()))
        .await
        .expect("reset");
    assert_eq!(deletion.todo_series, 2);
    assert_eq!(deletion.todos, 3);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todo_series").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 0);
}

#[tokio::test]
async fn the_external_runtime_refuses_every_repeating_write() {
    let (_pool, galley) = with_main_chat().await;
    let report = repeating(&galley, "交周报", &ymd(day(0)), weekly_on(day(0))).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let err = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(ymd(day(0))),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap_err();
    assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    for patch in [
        TodoPatch {
            repeat: Some(daily()),
            ..TodoPatch::default()
        },
        TodoPatch::stop_repeating(),
        TodoPatch {
            series: true,
            ..TodoPatch::default()
        },
    ] {
        let err = galley
            .update_todo(&id(&report), patch, assistant())
            .await
            .unwrap_err();
        assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    }
    let err = galley
        .skip_todo(&id(&report), assistant())
        .await
        .unwrap_err();
    assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    let err = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap_err();
    assert!(invalid_with(err, ASSISTANT_UNAVAILABLE));
    // The reads still answer.
    assert!(galley
        .todo(report.id.as_str())
        .await
        .unwrap()
        .repeat
        .is_some());
}

// ---------------- reminded again while unsettled (behaviour 13) ----------------

fn utc(iso: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(iso)
        .unwrap()
        .with_timezone(&Utc)
}

/// The to-do's reminder task as it now stands.
async fn reminder_task(
    galley: &SqliteGalley,
    id: &ScheduledTaskId,
) -> galley_core_lib::api::ScheduledTaskBrief {
    galley.scheduled_task(id.as_str()).await.unwrap()
}

/// The reminder rings at `now` as the scheduler would see it (due, then
/// stamped pending), and its wake reaches `wake`.
async fn ring(
    galley: &SqliteGalley,
    id: &ScheduledTaskId,
    now: DateTime<Utc>,
    wake: ScheduledWake,
) {
    let task = reminder_task(galley, id).await;
    assert!(
        due_at(&task, &Local, &now.with_timezone(&Local)).is_some(),
        "{id} rings at {now}"
    );
    let fired = instant_to_utc_iso(&now);
    galley
        .mark_scheduled_reminder_fired(id, &fired, task.fire_at.as_deref().unwrap())
        .await
        .unwrap();
    assert!(galley
        .settle_scheduled_wake(id.as_str(), &fired, wake)
        .await
        .unwrap());
}

async fn live_reminders(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT id, todo_id FROM scheduled_tasks \
         WHERE todo_id IS NOT NULL AND cancelled_at IS NULL ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_daily_period_left_unticked_rings_again_the_next_day_on_the_same_row() {
    let (pool, galley) = with_main_chat().await;
    let pills = galley
        .create_todo(
            CreateTodoInput {
                title: "吃药".into(),
                due: Some(ymd(day(2))),
                remind_at: Some(local(day(2), 9, 0)),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let task = pills.reminder.clone().unwrap().task_id;
    // Gone off, its wake not yet delivered: left alone.
    let now = utc(&instant(day(2), 9, 1));
    let fired = instant_to_utc_iso(&now);
    galley
        .mark_scheduled_reminder_fired(&task, &fired, &instant(day(2), 9, 0))
        .await
        .unwrap();
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        0
    );
    galley
        .settle_scheduled_wake(task.as_str(), &fired, ScheduledWake::Delivered)
        .await
        .unwrap();
    // Delivered: the same task, armed for tomorrow's 09:00.
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        1
    );
    let armed = reminder_task(&galley, &task).await;
    assert_eq!(
        armed.fire_at.as_deref(),
        Some(instant(day(3), 9, 0).as_str())
    );
    assert!(armed.cancelled_at.is_none());
    // A second sweep arms nothing more.
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        0
    );
    assert_eq!(reminder_task(&galley, &task).await.fire_at, armed.fire_at);
    // The period itself: one row, its due date unmoved, its reminder ahead.
    let still = galley.todo(pills.id.as_str()).await.unwrap();
    assert_eq!(still.due.as_ref().unwrap().date, ymd(day(2)));
    assert_eq!(
        still.reminder.as_ref().unwrap().state,
        TodoReminderState::Scheduled
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 1);
    // It rings the next day, undelivered this time (a notification): and
    // again the day after.
    ring(
        &galley,
        &task,
        utc(&instant(day(3), 9, 1)),
        ScheduledWake::Notified,
    )
    .await;
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(utc(&instant(day(3), 9, 1)), &Local)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        reminder_task(&galley, &task).await.fire_at.as_deref(),
        Some(instant(day(4), 9, 0).as_str())
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 1);
}

#[tokio::test]
async fn a_weekly_period_two_weeks_overdue_has_rung_three_times_on_one_row() {
    let (pool, galley) = with_main_chat().await;
    // Due on a day ten days on, reminded the evening before.
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(ymd(day(10))),
                remind_at: Some(local(day(9), 20, 0)),
                repeat: Some(weekly_on(day(10))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let task = report.reminder.clone().unwrap().task_id;
    // Rings on the eve of its day, then on the eve of each later period's
    // day; a reminder time already past (the eve of day 17, seen on day
    // 16 after 20:00) gives way to the one after it.
    for (rings_on, next) in [(9, 16), (16, 23), (23, 30)] {
        let now = utc(&instant(day(rings_on), 20, 5));
        ring(&galley, &task, now, ScheduledWake::Delivered).await;
        assert_eq!(
            galley
                .rearm_unsettled_period_reminders(now, &Local)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            reminder_task(&galley, &task).await.fire_at.as_deref(),
            Some(instant(day(next), 20, 0).as_str()),
            "armed after the ring on day {rings_on}"
        );
    }
    // One row, due where it was, overdue by the third ring.
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM todos").await, 1);
    let still = galley.todo(report.id.as_str()).await.unwrap();
    assert_eq!(still.due.as_ref().unwrap().date, ymd(day(10)));
    assert_eq!(still.reminder.as_ref().unwrap().task_id, task);
    // Settled: its reminder is let go, and only the next period's own
    // reminder remains, at the rule's offset from the next period's day.
    let next = galley
        .complete_todo_with_next(&id(&report), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(next.due.as_ref().unwrap().date, ymd(day(17)));
    let next_task = next.reminder.as_ref().unwrap().task_id.clone();
    assert_eq!(next.reminder.as_ref().unwrap().at, instant(day(16), 20, 0));
    assert_eq!(
        live_reminders(&pool).await,
        [(next_task.as_str().to_string(), next.id.as_str().to_string())]
    );
    assert!(reminder_task(&galley, &task).await.cancelled_at.is_some());
}

#[tokio::test]
async fn a_reminder_removed_paused_or_of_an_ended_rule_is_not_armed_again() {
    let (pool, galley) = with_main_chat().await;
    let make = |title: &'static str| {
        let galley = galley.clone();
        async move {
            galley
                .create_todo(
                    CreateTodoInput {
                        title: title.into(),
                        due: Some(ymd(day(2))),
                        remind_at: Some(local(day(2), 9, 0)),
                        repeat: Some(daily()),
                        ..CreateTodoInput::default()
                    },
                    assistant(),
                    None,
                )
                .await
                .unwrap()
        }
    };
    let now = utc(&instant(day(2), 9, 1));
    let cancelled = make("吃药").await;
    let paused = make("量血压").await;
    let ended = make("浇花").await;
    for todo in [&cancelled, &paused, &ended] {
        ring(
            &galley,
            &todo.reminder.as_ref().unwrap().task_id,
            now,
            ScheduledWake::Delivered,
        )
        .await;
    }
    // The user cancels one reminder at the desktop; one is paused; one
    // rule stops repeating.
    galley
        .cancel_todo_reminder(&id(&cancelled), Origin::desktop())
        .await
        .unwrap();
    galley
        .update_scheduled_task(
            paused.reminder.as_ref().unwrap().task_id.clone(),
            ScheduledTaskPatch {
                enabled: Some(false),
                ..ScheduledTaskPatch::default()
            },
            assistant(),
        )
        .await
        .unwrap();
    galley
        .update_todo(&id(&ended), TodoPatch::stop_repeating(), assistant())
        .await
        .unwrap();
    let before = live_reminders(&pool).await;
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        live_reminders(&pool).await,
        before,
        "nothing made, nothing moved"
    );
    assert!(galley
        .todo(cancelled.id.as_str())
        .await
        .unwrap()
        .reminder
        .is_none());
    // The next period still gets its own reminder from the rule.
    let next = galley
        .complete_todo_with_next(&id(&cancelled), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(next.reminder.as_ref().unwrap().at, instant(day(3), 9, 0));
}

#[tokio::test]
async fn the_scheduler_arms_them_again_only_while_there_is_an_assistant() {
    let (_pool, galley) = with_main_chat().await;
    let pills = galley
        .create_todo(
            CreateTodoInput {
                title: "吃药".into(),
                due: Some(ymd(day(2))),
                remind_at: Some(local(day(2), 9, 0)),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let task = pills.reminder.clone().unwrap().task_id;
    let now = utc(&instant(day(2), 9, 1));
    ring(&galley, &task, now, ScheduledWake::Delivered).await;
    let rec = Recorder::default();
    // The external runtime: left as it is.
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    rearm_unsettled_periods(&galley, &rec, now, &Local).await;
    assert_eq!(
        reminder_task(&galley, &task).await.fire_at.as_deref(),
        Some(instant(day(2), 9, 0).as_str())
    );
    assert!(rec.events.lock().unwrap().is_empty());
    // Back on the managed one: armed, and the desktop told.
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .unwrap();
    rearm_unsettled_periods(&galley, &rec, now, &Local).await;
    assert_eq!(
        reminder_task(&galley, &task).await.fire_at.as_deref(),
        Some(instant(day(3), 9, 0).as_str())
    );
    assert_eq!(
        *rec.events.lock().unwrap(),
        [SCHEDULED_TASKS_CHANGED_EVENT, TODOS_CHANGED_EVENT]
    );
}

#[tokio::test]
async fn a_period_first_looked_at_on_a_later_rule_day_rings_that_day() {
    let (_pool, galley) = with_main_chat().await;
    // Weekly, reminded the same day at 09:00; the period rang on its day
    // and the computer stays off until the next of the rule's days, opened
    // at 08:00: that morning's ring, not the week after's.
    let report = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(ymd(day(2))),
                remind_at: Some(local(day(2), 9, 0)),
                repeat: Some(weekly_on(day(2))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let task = report.reminder.clone().unwrap().task_id;
    ring(
        &galley,
        &task,
        utc(&instant(day(2), 9, 1)),
        ScheduledWake::Delivered,
    )
    .await;
    let opened = utc(&instant(day(9), 8, 0));
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(opened, &Local)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        reminder_task(&galley, &task).await.fire_at.as_deref(),
        Some(instant(day(9), 9, 0).as_str())
    );
    // Daily: rang on its day, first looked at the next morning before
    // 09:00: that day's 09:00.
    let pills = galley
        .create_todo(
            CreateTodoInput {
                title: "吃药".into(),
                due: Some(ymd(day(2))),
                remind_at: Some(local(day(2), 9, 0)),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let pills_task = pills.reminder.clone().unwrap().task_id;
    ring(
        &galley,
        &pills_task,
        utc(&instant(day(2), 9, 1)),
        ScheduledWake::Delivered,
    )
    .await;
    let morning = utc(&instant(day(3), 7, 30));
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(morning, &Local)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        reminder_task(&galley, &pills_task).await.fire_at.as_deref(),
        Some(instant(day(3), 9, 0).as_str())
    );
}

#[tokio::test]
async fn a_period_left_with_no_reminder_gets_one_and_one_removed_gets_none() {
    let (pool, galley) = with_main_chat().await;
    // Weekly, reminded the evening before at 20:00.
    let first = galley
        .create_todo(
            CreateTodoInput {
                title: "交周报".into(),
                due: Some(ymd(day(3))),
                remind_at: Some(local(day(2), 20, 0)),
                repeat: Some(weekly_on(day(3))),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    let next = galley
        .complete_todo_with_next(&id(&first), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    assert_eq!(next.due.as_ref().unwrap().date, ymd(day(10)));
    // Core stopped between making it and hanging its reminder: no task
    // row for it at all.
    sqlx::query("DELETE FROM scheduled_tasks WHERE todo_id = ?")
        .bind(next.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    // Its own reminder time still ahead: its own.
    let now = Utc::now();
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        1
    );
    let hung = galley.todo(next.id.as_str()).await.unwrap();
    let reminder = hung.reminder.clone().unwrap();
    assert_eq!(reminder.at, instant(day(9), 20, 0));
    let task = reminder_task(&galley, &reminder.task_id).await;
    assert_eq!(
        task.origin.as_ref().unwrap().supervisor.as_deref(),
        Some(REPEAT_SUPERVISOR)
    );
    // Two sweeps in a row make one task.
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        0
    );
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks WHERE todo_id = ?")
        .bind(next.id.as_str())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tasks, 1);
    // Its own time gone by the time it is looked at (made Sunday 21:00
    // for Monday): the following Sunday's ring.
    sqlx::query("DELETE FROM scheduled_tasks WHERE todo_id = ?")
        .bind(next.id.as_str())
        .execute(&pool)
        .await
        .unwrap();
    let late = utc(&instant(day(9), 21, 0));
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(late, &Local)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        galley
            .todo(next.id.as_str())
            .await
            .unwrap()
            .reminder
            .unwrap()
            .at,
        instant(day(16), 20, 0)
    );
    // A period whose reminder was let go (ticked, its reminder released,
    // then unticked): a cancelled task is a removal, nothing is made.
    let reopened = galley.reopen_todo(&id(&first), assistant()).await.unwrap();
    assert!(reopened.reminder.is_none());
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(late, &Local)
            .await
            .unwrap(),
        0
    );
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, before);
    assert!(galley
        .todo(first.id.as_str())
        .await
        .unwrap()
        .reminder
        .is_none());
}

#[tokio::test]
async fn hanging_or_arming_a_reminder_leaves_the_period_unmoved() {
    let (_pool, galley) = with_main_chat().await;
    let pills = galley
        .create_todo(
            CreateTodoInput {
                title: "吃药".into(),
                due: Some(ymd(day(1))),
                remind_at: Some(local(day(1), 9, 0)),
                repeat: Some(daily()),
                ..CreateTodoInput::default()
            },
            assistant(),
            None,
        )
        .await
        .unwrap();
    // The next period, with its reminder hung after the settling commit.
    let next = galley
        .complete_todo_with_next(&id(&pills), assistant())
        .await
        .unwrap()
        .next
        .unwrap();
    let read = galley.todo(next.id.as_str()).await.unwrap();
    let task = read.reminder.clone().expect("its own reminder").task_id;
    assert_eq!(read.updated_at, read.created_at);
    // Its reminder rings, is delivered, and is armed again: still unmoved.
    let now = utc(&instant(day(2), 9, 1));
    ring(&galley, &task, now, ScheduledWake::Delivered).await;
    assert_eq!(
        galley
            .rearm_unsettled_period_reminders(now, &Local)
            .await
            .unwrap(),
        1
    );
    let read = galley.todo(next.id.as_str()).await.unwrap();
    assert_eq!(read.updated_at, read.created_at);
    // So the morning review, its day already seen, does not count it as
    // moved.
    let list = assistant_todo(&galley, &RunnerManager::new(), now)
        .await
        .unwrap();
    let last = galley_core_lib::assistant_todo::LastReview::read(
        Some(&instant_to_utc_iso(&(now - Duration::hours(1)))),
        &Local,
    );
    assert!(!list.review_has_something_to_look_at(now.with_timezone(&Local).date_naive(), last));
}
