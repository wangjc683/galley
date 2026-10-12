//! The main chat (主聊天, `.scratch/main-chat` ticket 02): migration 044
//! keeps at most one, managed-only; Core creates it on the first ask and
//! hands the same row back after that; the desktop's write path cannot
//! archive or delete it, while the socket's (CLI / supervisor) is left
//! as it was.

use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, Origin, OriginVia, RuntimeKind, SessionFilter, SessionId,
    SessionStatus,
};
use galley_core_lib::db::{SqliteGalley, MAIN_CHAT_TITLE};
use galley_core_lib::error::GalleyError;
use galley_core_lib::notify::Notifier;
use galley_core_lib::session_writes::{Writes, VIA_GUI};
use serde_json::{json, Value};
use std::sync::Mutex;

async fn fresh_pool() -> sqlx::SqlitePool {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    pool
}

async fn fresh_galley(active: RuntimeKind) -> SqliteGalley {
    galley_on(fresh_pool().await, active).await
}

async fn galley_on(pool: sqlx::SqlitePool, active: RuntimeKind) -> SqliteGalley {
    let galley = SqliteGalley::from_pool(pool);
    let kind = match active {
        RuntimeKind::Managed => "managed",
        _ => "external",
    };
    galley
        .set_pref_json("active_runtime_kind", json!(kind))
        .await
        .expect("set active runtime");
    galley
}

fn gui() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
        client: None,
    }
}

fn session_input(id: &str, kind: RuntimeKind) -> CreateSessionInput {
    CreateSessionInput {
        id: id.to_string(),
        title: "新对话".to_string(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(kind),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<(String, Value)>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl Recorder {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(n, _)| n.clone())
            .collect()
    }
    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

/// The desktop's write path, as the Tauri commands build it.
fn desktop<'a>(galley: &'a SqliteGalley, rec: &'a Recorder) -> Writes<'a> {
    Writes::new(galley, rec, VIA_GUI).protecting_main_chat()
}

async fn main_chat(galley: &SqliteGalley, rec: &Recorder) -> SessionId {
    desktop(galley, rec)
        .get_or_create_main_chat(gui())
        .await
        .expect("main chat")
        .id
}

// ---------------- migration 044 ----------------

#[tokio::test]
async fn the_schema_allows_one_main_chat_and_only_on_the_managed_runtime() {
    let pool = fresh_pool().await;
    let galley = galley_on(pool.clone(), RuntimeKind::Managed).await;
    for (id, kind) in [
        ("s-ext", RuntimeKind::External),
        ("s-a", RuntimeKind::Managed),
        ("s-b", RuntimeKind::Managed),
    ] {
        galley
            .create_session(session_input(id, kind), gui())
            .await
            .unwrap();
    }
    let flag = |id: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query("UPDATE sessions SET main_chat = 1 WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
        }
    };
    assert!(flag("s-ext").await.is_err(), "an external row cannot be it");
    flag("s-a").await.expect("the first managed one can");
    assert!(flag("s-b").await.is_err(), "a second one cannot");
}

// ---------------- get or create ----------------

#[tokio::test]
async fn the_first_ask_creates_it_and_later_asks_hand_the_same_row_back() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();

    let first = desktop(&galley, &rec)
        .get_or_create_main_chat(gui())
        .await
        .unwrap();
    assert_eq!(first.main_chat, Some(true));
    assert_eq!(first.title, MAIN_CHAT_TITLE);
    assert_eq!(first.ga_runtime_kind, RuntimeKind::Managed);
    assert_eq!(first.status, SessionStatus::Idle);
    assert_eq!(first.project_id, None);
    assert_eq!(rec.names(), vec!["session-created-external"]);
    let event = rec.events.lock().unwrap()[0].1.clone();
    assert_eq!(event["session"]["mainChat"], json!(true));

    rec.clear();
    let again = desktop(&galley, &rec)
        .get_or_create_main_chat(gui())
        .await
        .unwrap();
    assert_eq!(again.id, first.id);
    assert!(rec.names().is_empty(), "nothing new to broadcast");

    let all = galley
        .list_sessions(SessionFilter::default())
        .await
        .unwrap();
    assert_eq!(all.len(), 1);
}

#[tokio::test]
async fn only_the_main_chat_carries_main_chat_in_its_json() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-side", RuntimeKind::Managed), gui())
        .await
        .unwrap();

    let main_json = serde_json::to_value(galley.session_brief(main).await.unwrap()).unwrap();
    assert_eq!(main_json["mainChat"], json!(true));
    let side_json = serde_json::to_value(
        galley
            .session_brief(SessionId("s-side".into()))
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        side_json.get("mainChat").is_none(),
        "a side chat's brief is unchanged: {side_json}"
    );
}

#[tokio::test]
async fn an_attached_external_ga_has_no_main_chat() {
    let galley = fresh_galley(RuntimeKind::External).await;
    let rec = Recorder::default();
    let err = desktop(&galley, &rec)
        .get_or_create_main_chat(gui())
        .await
        .expect_err("external has none");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    assert!(rec.names().is_empty());
    assert_eq!(galley.main_chat_id().await.unwrap(), None);
}

#[tokio::test]
async fn an_archived_main_chat_comes_back_restored() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    // The socket path (CLI `session archive`) is not guarded.
    Writes::new(&galley, &rec, "session.archive")
        .archive_session(main.clone(), gui())
        .await
        .expect("the CLI can still archive it");

    rec.clear();
    let back = desktop(&galley, &rec)
        .get_or_create_main_chat(gui())
        .await
        .unwrap();
    assert_eq!(back.id, main);
    assert_eq!(back.status, SessionStatus::Idle);
    assert_eq!(rec.names(), vec!["session-unarchived-external"]);
}

// ---------------- the desktop cannot archive or delete it ----------------

#[tokio::test]
async fn the_desktop_cannot_archive_or_delete_the_main_chat() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    rec.clear();

    let err = desktop(&galley, &rec)
        .archive_session(main.clone(), gui())
        .await
        .expect_err("no archive");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    let err = desktop(&galley, &rec)
        .delete_session(main.clone(), gui())
        .await
        .expect_err("no delete");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");
    assert!(rec.names().is_empty(), "a refused write broadcasts nothing");
    let brief = galley.session_brief(main).await.unwrap();
    assert_eq!(brief.status, SessionStatus::Idle);
}

#[tokio::test]
async fn bulk_archive_and_delete_leave_the_main_chat_out() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    for id in ["s-1", "s-2"] {
        galley
            .create_session(session_input(id, RuntimeKind::Managed), gui())
            .await
            .unwrap();
    }
    let ids = |names: &[&str]| -> Vec<SessionId> {
        names.iter().map(|n| SessionId(n.to_string())).collect()
    };

    let mut batch = ids(&["s-1"]);
    batch.push(main.clone());
    let archived = desktop(&galley, &rec)
        .bulk_archive_sessions(batch, gui())
        .await
        .unwrap();
    assert_eq!(archived, 1, "only the side chat");

    let mut batch = ids(&["s-1", "s-2"]);
    batch.push(main.clone());
    let deleted = desktop(&galley, &rec)
        .bulk_delete_sessions(batch, gui())
        .await
        .unwrap();
    assert_eq!(deleted, 2, "only the side chats");
    assert_eq!(
        galley.session_brief(main).await.unwrap().status,
        SessionStatus::Idle
    );
}

#[tokio::test]
async fn side_chats_archive_and_delete_as_before() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-side", RuntimeKind::Managed), gui())
        .await
        .unwrap();
    let side = SessionId("s-side".into());
    desktop(&galley, &rec)
        .archive_session(side.clone(), gui())
        .await
        .expect("archive a side chat");
    desktop(&galley, &rec)
        .delete_session(side, gui())
        .await
        .expect("delete a side chat");
}

#[tokio::test]
async fn the_launch_sweep_keeps_an_empty_main_chat() {
    let galley = fresh_galley(RuntimeKind::Managed).await;
    let rec = Recorder::default();
    let main = main_chat(&galley, &rec).await;
    galley
        .create_session(session_input("s-empty", RuntimeKind::Managed), gui())
        .await
        .unwrap();

    let swept = galley.delete_empty_new_session_ids().await.unwrap();
    assert_eq!(swept, vec![SessionId("s-empty".into())]);
    assert!(galley.session_brief(main).await.is_ok());
}
