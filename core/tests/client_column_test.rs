//! `messages.client` / `sessions.client` (migration 043, iOS PRD ruling
//! 9, ticket 05c): which app a human used. Written from `Origin.client`
//! — `desktop` by the GUI's Tauri send / create / Goal start
//! (`Origin::desktop()`), `ios` by the remote module — NULL for every
//! other writer, and never part of the CLI's JSON (Rule 3).

use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, GoalId, MessageVisibility, Origin, OriginClient, OriginVia,
    RuntimeKind, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::message_queue::dispatch_queued_message;
use galley_core_lib::notify::{Notifier, NullNotifier};
use galley_core_lib::runner_manager::{QueueOffer, RunSignal, RunnerManager};
use sqlx::SqlitePool;
use std::sync::Arc;

async fn db() -> (SqlitePool, SqliteGalley) {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    (pool.clone(), SqliteGalley::from_pool(pool))
}

fn input(id: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.into(),
        title: "新对话".into(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

async fn session_client(pool: &SqlitePool, id: &str) -> Option<String> {
    sqlx::query_scalar("SELECT client FROM sessions WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("session row")
}

async fn message_client(pool: &SqlitePool, id: &str) -> Option<String> {
    sqlx::query_scalar("SELECT client FROM messages WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("message row")
}

#[tokio::test]
async fn sessions_record_the_app_that_created_them() {
    let (pool, galley) = db().await;
    galley
        .create_session(input("s-desktop"), Origin::desktop())
        .await
        .unwrap();
    galley
        .create_session(
            input("s-phone"),
            Origin::gui().with_client(OriginClient::Ios),
        )
        .await
        .unwrap();
    galley
        .create_session(input("s-cli"), Origin::cli(Some("agent".into()), None))
        .await
        .unwrap();
    // A GUI origin nobody stamped (an older path) stays NULL.
    galley
        .create_session(input("s-unstamped"), Origin::gui())
        .await
        .unwrap();

    assert_eq!(
        session_client(&pool, "s-desktop").await.as_deref(),
        Some("desktop")
    );
    assert_eq!(
        session_client(&pool, "s-phone").await.as_deref(),
        Some("ios")
    );
    assert_eq!(session_client(&pool, "s-cli").await, None);
    assert_eq!(session_client(&pool, "s-unstamped").await, None);
}

#[tokio::test]
async fn messages_record_the_app_a_human_sent_them_from() {
    let (pool, galley) = db().await;
    galley
        .create_session(input("s"), Origin::cli(None, None))
        .await
        .unwrap();
    let sid = || SessionId("s".into());

    let desktop = galley
        .send_message(sid(), "from the window".into(), Origin::desktop())
        .await
        .unwrap();
    let phone = galley
        .send_message(
            sid(),
            "from the phone".into(),
            Origin::gui().with_client(OriginClient::Ios),
        )
        .await
        .unwrap();
    let cli = galley
        .send_message(sid(), "from an agent".into(), Origin::cli(None, None))
        .await
        .unwrap();
    let system = galley
        .send_system_message(
            sid(),
            "narration".into(),
            Origin {
                via: OriginVia::System,
                supervisor: None,
                reason: None,
                client: None,
            },
        )
        .await
        .unwrap();
    let internal = galley
        .send_message_with_visibility(
            sid(),
            "hidden".into(),
            Origin::desktop(),
            MessageVisibility::Internal,
        )
        .await
        .unwrap();

    assert_eq!(
        message_client(&pool, &desktop.id.0).await.as_deref(),
        Some("desktop")
    );
    assert_eq!(
        message_client(&pool, &phone.id.0).await.as_deref(),
        Some("ios")
    );
    assert_eq!(message_client(&pool, &cli.id.0).await, None);
    assert_eq!(message_client(&pool, &system.id.0).await, None);
    assert_eq!(
        message_client(&pool, &internal.id.0).await.as_deref(),
        Some("desktop")
    );
    // `via` is unchanged: `gui` still means "a human".
    let via: String = sqlx::query_scalar("SELECT created_via FROM messages WHERE id = ?")
        .bind(&phone.id.0)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(via, "gui");
}

#[tokio::test]
async fn a_goal_objective_typed_at_the_desktop_is_desktop() {
    let (pool, galley) = db().await;
    galley
        .create_session(input("s"), Origin::cli(None, None))
        .await
        .unwrap();
    let goal = galley
        .create_goal(
            galley_core_lib::api::CreateGoalInput {
                session_id: SessionId("s".into()),
                objective: "做完它".into(),
                budget_seconds: None,
            },
            Origin::desktop(),
        )
        .await
        .unwrap();
    let objective = galley
        .send_message_for_goal(
            SessionId("s".into()),
            "做完它".into(),
            Origin::desktop(),
            GoalId(goal.id.0.clone()),
        )
        .await
        .unwrap();
    assert_eq!(
        message_client(&pool, &objective.id.0).await.as_deref(),
        Some("desktop")
    );
}

#[tokio::test]
async fn a_queued_desktop_send_is_still_desktop_when_it_is_dispatched() {
    let (pool, galley) = db().await;
    galley
        .create_session(input("s"), Origin::cli(None, None))
        .await
        .unwrap();
    let manager = RunnerManager::new();
    // A run is open: the GUI's send waits in the queue, text only.
    assert!(matches!(
        manager.queue_offer("s", "first".into(), None).await,
        QueueOffer::DispatchNow
    ));
    assert!(matches!(
        manager
            .queue_offer("s", "queued".into(), Some(Origin::desktop()))
            .await,
        QueueOffer::Queued { .. }
    ));
    // The run completes; the drain takes the item and persists it.
    let item = manager
        .queue_take_next(&RunSignal::RunComplete {
            session_id: "s".into(),
        })
        .await
        .expect("queued item");
    let notifier: Arc<dyn Notifier> = NullNotifier::arc();
    dispatch_queued_message(&galley, &manager, &notifier, "s", item).await;

    let (id, client): (String, Option<String>) =
        sqlx::query_as("SELECT id, client FROM messages WHERE content = 'queued'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(client.as_deref(), Some("desktop"), "row {id}");
}

#[tokio::test]
async fn the_cli_json_never_carries_a_client() {
    let (_pool, galley) = db().await;
    let phone =
        Origin::cli(Some("agent".into()), Some("why".into())).with_client(OriginClient::Ios);
    let session = galley
        .create_session(input("s"), phone.clone())
        .await
        .unwrap();
    let message = galley
        .send_message(SessionId("s".into()), "hi".into(), phone.clone())
        .await
        .unwrap();
    let reread = galley
        .session_messages(SessionId("s".into()), None)
        .await
        .unwrap();
    let manager = RunnerManager::new();
    let _ = manager.queue_offer("s", "a".into(), None).await;
    let _ = manager.queue_offer("s", "b".into(), Some(phone)).await;
    let queued = manager.queue_snapshot("s").await;

    for json in [
        serde_json::to_string(&session).unwrap(),
        serde_json::to_string(&galley.session_brief(SessionId("s".into())).await.unwrap()).unwrap(),
        serde_json::to_string(&message).unwrap(),
        serde_json::to_string(&reread).unwrap(),
        serde_json::to_string(&queued).unwrap(),
    ] {
        assert!(json.contains(r#""supervisor":"agent""#), "{json}");
        assert!(!json.contains("client"), "{json}");
        assert!(!json.contains("ios"), "{json}");
    }
}
