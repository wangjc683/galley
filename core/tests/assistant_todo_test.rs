//! The assistant's to-do list (main chat ticket 37, regrouped by ticket
//! 39) against an in-memory database: which tasks and which of the main
//! chat's subtasks land in which group, read the way the desktop and the
//! 「在办的事」 lines read them (`galley_core_lib::assistant_todo`). The
//! ordering, the window's edge and the live run states are pinned by the
//! module's unit tests; here the database half — what a subtask's rows
//! say after a restart, which subtasks count, cancelled tasks. The
//! to-dos' own groups are in `todo_test.rs`.

use chrono::{DateTime, Duration, Utc};
use galley_core_lib::api::schedule::{
    instant_to_utc_iso, CreateScheduledTaskInput, ScheduleTarget, ScheduledTaskRepeat,
};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia, RuntimeKind, SessionId,
    SubtaskDispatch, SubtaskFailure, ASSISTANT_SUPERVISOR,
};
use galley_core_lib::assistant_todo::{
    assistant_todo, AssistantTodo, TodoCreator, TodoKind, TodoState,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::runner_manager::RunnerManager;
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
        .expect("managed runtime");
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    (pool, galley)
}

fn input(id: &str, title: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.into(),
        title: title.into(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

fn assistant() -> Origin {
    Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(ASSISTANT_SUPERVISOR.into()),
        reason: None,
        client: None,
    }
}

/// A subtask of `parent` with its dispatch record (`failure` when its
/// runner did not start).
async fn subtask(
    galley: &SqliteGalley,
    parent: &str,
    id: &str,
    title: &str,
    failure: Option<SubtaskFailure>,
) {
    galley
        .create_subtask_session(
            input(id, title),
            Origin::subtask(),
            &SessionId(parent.into()),
            Some(format!("{title}\n细节")),
        )
        .await
        .expect("subtask");
    let ordinal = galley
        .subtask_dispatches(&SessionId(parent.into()))
        .await
        .expect("records")
        .len() as i64;
    galley
        .record_subtask_dispatch(&SubtaskDispatch {
            parent_session_id: parent.into(),
            turn_index: 0,
            ordinal,
            message_id: SubtaskDispatch::reply_message_id(parent, 0),
            session_id: Some(id.into()),
            title: title.into(),
            failure,
            failure_detail: failure.map(|_| "spawn failed".into()),
            created_at: "2026-10-15T00:00:00Z".into(),
            send_backs: 0,
        })
        .await
        .expect("dispatch record");
}

/// A visible assistant row of `sid` at `turn_index`.
async fn step(galley: &SqliteGalley, sid: &str, turn_index: u32, tool_calls: Value) {
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index,
            content: "…".into(),
            tool_calls: Some(tool_calls.to_string()),
            tool_results: None,
            thinking: None,
            final_answer: Some("好了".into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
}

async fn set_activity(pool: &SqlitePool, sid: &str, at: DateTime<Utc>) {
    sqlx::query("UPDATE sessions SET last_activity_at = ? WHERE id = ?")
        .bind(instant_to_utc_iso(&at))
        .bind(sid)
        .execute(pool)
        .await
        .expect("activity");
}

async fn read(galley: &SqliteGalley) -> AssistantTodo {
    assistant_todo(galley, &RunnerManager::new(), Utc::now())
        .await
        .expect("todo")
}

fn ids(items: &[galley_core_lib::assistant_todo::TodoItem]) -> Vec<&str> {
    items.iter().map(|i| i.id.as_str()).collect()
}

fn once(id: &str, prompt: &str, at: DateTime<Utc>) -> CreateScheduledTaskInput {
    CreateScheduledTaskInput {
        id: id.into(),
        project_id: None,
        prompt: prompt.into(),
        repeat: ScheduledTaskRepeat::Once,
        time_of_day: String::new(),
        llm_name: None,
        enabled: true,
        fire_at: Some(instant_to_utc_iso(&at)),
        target: ScheduleTarget::Assistant,
    }
}

#[tokio::test]
async fn subtask_groups_from_their_rows() {
    let (pool, galley) = with_main_chat().await;
    let ask = json!([{ "toolName": "ask_user", "args": { "question": "哪个？" } }]);
    let tool = json!([{ "toolName": "web_scan", "args": {} }]);

    subtask(&galley, MAIN, "s-done", "整理下载", None).await;
    step(&galley, "s-done", 1, json!([])).await;
    subtask(&galley, MAIN, "s-asking", "订机票", None).await;
    step(&galley, "s-asking", 1, ask).await;
    subtask(&galley, MAIN, "s-cut", "查物流", None).await;
    step(&galley, "s-cut", 1, tool).await;
    subtask(
        &galley,
        MAIN,
        "s-nostart",
        "比价",
        Some(SubtaskFailure::StartFailed),
    )
    .await;
    // Promoted, archived, someone else's: not the assistant's to list.
    subtask(&galley, MAIN, "s-promoted", "写周报", None).await;
    galley
        .promote_subtask(&SessionId("s-promoted".into()))
        .await
        .expect("promote");
    subtask(&galley, MAIN, "s-archived", "归档", None).await;
    sqlx::query("UPDATE sessions SET status = 'archived' WHERE id = 's-archived'")
        .execute(&pool)
        .await
        .expect("archive");
    galley
        .create_session(input("s-other", "普通对话"), Origin::gui())
        .await
        .expect("plain session");

    let now = Utc::now();
    set_activity(&pool, "s-done", now - Duration::hours(1)).await;
    set_activity(&pool, "s-asking", now - Duration::minutes(5)).await;
    set_activity(&pool, "s-cut", now - Duration::minutes(30)).await;
    set_activity(&pool, "s-nostart", now - Duration::minutes(40)).await;

    let todo = read(&galley).await;
    assert!(todo.routine.is_empty() && todo.yours.is_empty());
    // No runner in this process: the rows say asking, done, stopped
    // short; a runner that never started says failed.
    assert_eq!(ids(&todo.assistant), ["s-asking", "s-cut", "s-nostart"]);
    let states: Vec<TodoState> = todo.assistant.iter().map(|i| i.state).collect();
    assert_eq!(
        states,
        [TodoState::Asking, TodoState::Stopped, TodoState::Failed]
    );
    assert_eq!(ids(&todo.done), ["s-done"]);
    assert_eq!(todo.done[0].state, TodoState::Done);
    assert_eq!(todo.done[0].kind, TodoKind::Subtask);
    assert_eq!(todo.done[0].text, "整理下载");
    assert_eq!(todo.done[0].created_by, TodoCreator::Assistant);

    // A week without moving: out of both groups.
    set_activity(&pool, "s-cut", now - Duration::days(8)).await;
    set_activity(&pool, "s-done", now - Duration::days(8)).await;
    let todo = read(&galley).await;
    assert_eq!(ids(&todo.assistant), ["s-asking", "s-nostart"]);
    assert!(todo.done.is_empty());
}

#[tokio::test]
async fn a_new_run_after_a_finished_one_is_not_done() {
    let (_pool, galley) = with_main_chat().await;
    subtask(&galley, MAIN, "s-1", "整理下载", None).await;
    step(&galley, "s-1", 1, json!([])).await;
    // Sent back: a new run from the assistant's message, no reply yet.
    galley
        .send_message(SessionId("s-1".into()), "再查一遍".into(), assistant())
        .await
        .expect("send back");
    let todo = read(&galley).await;
    assert_eq!(ids(&todo.assistant), ["s-1"]);
    assert_eq!(todo.assistant[0].state, TodoState::Stopped);
    assert!(todo.done.is_empty());
}

#[tokio::test]
async fn tasks_galleys_routine_and_cancelled() {
    let (pool, galley) = with_main_chat().await;
    let soon = Utc::now() + Duration::minutes(10);
    let made = galley
        .create_scheduled_task_in(
            once("sched_water", "提醒用户喝水", soon),
            assistant(),
            Some((SessionId(MAIN.into()), 3)),
        )
        .await
        .expect("reminder");
    sqlx::query("UPDATE scheduled_tasks SET created_in_turn_index = 4 WHERE id = ?")
        .bind(made.id.as_str())
        .execute(&pool)
        .await
        .expect("settle the reply");
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "08:00".into(),
                fire_at: None,
                target: ScheduleTarget::Session,
                ..once("sched_news", "看新闻", soon)
            },
            Origin::gui(),
        )
        .await
        .expect("form task");
    galley
        .create_scheduled_task(
            once("sched_gone", "取消的", Utc::now() + Duration::hours(2)),
            assistant(),
        )
        .await
        .expect("to cancel");
    galley
        .delete_scheduled_task(
            galley_core_lib::api::ScheduledTaskId("sched_gone".into()),
            Origin::gui(),
        )
        .await
        .expect("cancel");

    let todo = read(&galley).await;
    // A one-off is Galley's; a repeating task a routine.
    assert_eq!(ids(&todo.assistant), ["sched_water"]);
    assert_eq!(ids(&todo.routine), ["sched_news"]);
    let water = &todo.assistant[0];
    assert_eq!(water.kind, TodoKind::Task);
    assert_eq!(water.state, TodoState::Scheduled);
    assert_eq!(water.created_by, TodoCreator::Assistant);
    assert_eq!(water.target, Some(ScheduleTarget::Assistant));
    assert_eq!(
        water.at.as_deref(),
        Some(instant_to_utc_iso(&soon).as_str())
    );
    let anchor = water.created_in.as_ref().expect("made in a turn");
    assert_eq!(anchor.session_id.as_str(), MAIN);
    assert_eq!(anchor.turn_index, Some(4));
    let news = &todo.routine[0];
    assert_eq!(news.created_by, TodoCreator::User);
    assert_eq!(news.time_of_day.as_deref(), Some("08:00"));
}

#[tokio::test]
async fn without_a_main_chat_tasks_only() {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool);
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "08:00".into(),
                fire_at: None,
                target: ScheduleTarget::Session,
                ..once("sched_news", "看新闻", Utc::now())
            },
            Origin::gui(),
        )
        .await
        .expect("form task");
    let todo = read(&galley).await;
    assert_eq!(ids(&todo.routine), ["sched_news"]);
    assert!(todo.assistant.is_empty() && todo.done.is_empty() && todo.yours.is_empty());
}
