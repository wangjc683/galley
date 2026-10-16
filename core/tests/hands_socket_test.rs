//! The remaining hands (main chat ticket 35) through the production router
//! (`dispatch_line_with`) with an in-memory database, a recording notifier
//! and a fake runner registry: `session.rename / pin / unpin / delete`,
//! `project.update / pin / unpin / archive_sessions`, `llm.set_default`.
//! Each success writes what the desktop's own action writes and broadcasts
//! it once; each refusal (`main_chat_protected:`, `managed_runtime_only:`,
//! the existing ones) leaves the database and every runner alone. The
//! default model a `llm.set_default` leaves is what the desktop's list
//! (`list_managed_models`) and `llm list` (`list_managed_llm_choices`)
//! read, and the same order the desktop's own 「设为默认」 save produces.
//! The CLI over a real socket is `cli/tests/hands_test.rs`.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateProjectInput, CreateSessionInput, GalleyApi, ManagedModelAuthKind, ManagedModelProtocol,
    Origin, ProjectId, RuntimeKind, SessionId,
};
use galley_core_lib::credential_store;
use galley_core_lib::db::{
    MainChatSeed, SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata,
};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

const MAIN: &str = "s-main";

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
    fn take(&self) -> Vec<(String, Value)> {
        std::mem::take(&mut *self.events.lock().unwrap())
    }
}

/// A registry whose only runners are the ids in `alive`; it records every
/// shutdown it is asked for.
#[derive(Default)]
struct Runner {
    alive: Mutex<HashSet<String>>,
    shutdowns: Mutex<Vec<String>>,
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(&self, _: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        Err(RunnerSpawnError::SpawnIo {
            detail: "no runners here".into(),
        })
    }
    async fn send_command(&self, sid: &str, _: &IpcCommand) -> Result<(), SendCommandError> {
        Err(SendCommandError::ProcessGone {
            session_id: sid.to_string(),
        })
    }
    async fn subscribe(&self, _: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, sid: &str) -> Option<u32> {
        self.alive.lock().unwrap().contains(sid).then_some(4242)
    }
    async fn agent_running(&self, _: &str) -> bool {
        false
    }
    async fn shutdown(&self, sid: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
        self.shutdowns.lock().unwrap().push(sid.to_string());
        if self.alive.lock().unwrap().remove(sid) {
            Ok(())
        } else {
            Err(ShutdownError::NotFound {
                session_id: sid.to_string(),
            })
        }
    }
    async fn run_state(&self, _: &str) -> RunState {
        RunState::default()
    }
}

struct Harness {
    pool: SqlitePool,
    galley: SqliteGalley,
    db: DbSource,
    runner: Runner,
    rec: Arc<Recorder>,
}

impl Harness {
    /// The managed runtime with its main chat.
    async fn new() -> Self {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .expect("foreign keys");
        galley_core_lib::apply_all_migrations_for_tests(&pool)
            .await
            .expect("migrate");
        let galley = SqliteGalley::from_pool(pool.clone());
        galley
            .set_pref_json("active_runtime_kind", json!("managed"))
            .await
            .expect("managed");
        galley
            .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
            .await
            .expect("main chat");
        Self {
            pool,
            db: DbSource::Pool(galley.clone()),
            galley,
            runner: Runner::default(),
            rec: Arc::new(Recorder::default()),
        }
    }

    async fn call(&self, command: &str, args: Value) -> SocketResponse {
        self.call_pinned(command, args, 3).await
    }

    async fn call_pinned(&self, command: &str, args: Value, schema: u32) -> SocketResponse {
        let ctx = HandlerCtx {
            db: &self.db,
            runner: &self.runner,
            notifier: self.rec.clone(),
            app: None,
        };
        let line = json!({"command": command, "args": args, "schemaVersion": schema}).to_string();
        match dispatch_line_with(&ctx, &line).await {
            DispatchResult::Unary(resp) => resp,
            _ => panic!("{command} streamed"),
        }
    }

    async fn session(&self, id: &str, runtime: RuntimeKind, project: Option<&str>) {
        self.galley
            .create_session(
                CreateSessionInput {
                    id: id.into(),
                    title: format!("title {id}"),
                    project_id: project.map(str::to_string),
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(runtime),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::desktop(),
            )
            .await
            .expect("session");
    }

    async fn project(&self, id: &str) {
        self.galley
            .create_project(
                CreateProjectInput {
                    id: id.into(),
                    name: format!("project {id}"),
                    root_path: None,
                    workspace_enabled: false,
                    icon: Some("📁".into()),
                    color: Some("#7c84ff".into()),
                },
                Origin::desktop(),
            )
            .await
            .expect("project");
    }

    async fn sql(&self, sql: &str) {
        sqlx::raw_sql(sql).execute(&self.pool).await.expect(sql);
    }
}

fn ok(resp: SocketResponse) -> Value {
    assert!(resp.ok, "{resp:?}");
    resp.result.expect("result")
}

/// `(error, message)` of a refusal.
fn refused(resp: SocketResponse) -> (String, String) {
    assert!(!resp.ok, "{resp:?}");
    (
        resp.error.clone().unwrap_or_default(),
        resp.message.clone().unwrap_or_default(),
    )
}

fn names(events: &[(String, Value)]) -> Vec<&str> {
    events.iter().map(|(n, _)| n.as_str()).collect()
}

// ---------------- sessions ----------------

#[tokio::test]
async fn session_rename_is_the_desktops_rename() {
    let h = Harness::new().await;
    h.session("s-a", RuntimeKind::Managed, None).await;

    let out = ok(h
        .call(
            "session.rename",
            json!({"sessionId": "s-a", "title": "  周报草稿  ", "supervisor": "galley-assistant",
                   "reason": "user asked"}),
        )
        .await);
    assert_eq!(out["session"]["title"], "周报草稿");
    let events = h.rec.take();
    assert_eq!(names(&events), ["session-updated-external"]);
    assert_eq!(events[0].1["via"], "session.rename");
    // A user title: the auto title leaves it alone.
    assert_eq!(
        h.galley
            .session_title_source("s-a")
            .await
            .unwrap()
            .as_deref(),
        Some("user")
    );

    // An empty title gives it back to Galley.
    let out = ok(h
        .call("session.rename", json!({"sessionId": "s-a", "title": "  "}))
        .await);
    assert_eq!(out["session"]["title"], "新对话");
    assert_eq!(
        h.galley
            .session_title_source("s-a")
            .await
            .unwrap()
            .as_deref(),
        Some("seed")
    );

    let (error, _) = refused(
        h.call(
            "session.rename",
            json!({"sessionId": "s-nope", "title": "x"}),
        )
        .await,
    );
    assert_eq!(error, "not_found");
    let (error, _) = refused(h.call("session.rename", json!({"sessionId": "s-a"})).await);
    assert_eq!(error, "invalid_args");
}

#[tokio::test]
async fn session_pin_and_unpin() {
    let h = Harness::new().await;
    h.session("s-a", RuntimeKind::Managed, None).await;

    let out = ok(h.call("session.pin", json!({"sessionId": "s-a"})).await);
    assert_eq!(out["session"]["pinned"], true);
    let out = ok(h
        .call(
            "session.unpin",
            json!({"sessionId": "s-a", "reason": "done"}),
        )
        .await);
    assert_eq!(out["session"]["pinned"], false);
    let events = h.rec.take();
    assert_eq!(
        names(&events),
        ["session-updated-external", "session-updated-external"]
    );
    assert_eq!(events[0].1["via"], "session.pin");
    assert_eq!(events[1].1["via"], "session.unpin");

    // Archived rows refuse a pin, as on the desktop.
    h.galley
        .archive_session(SessionId("s-a".into()), Origin::desktop())
        .await
        .unwrap();
    let (error, message) = refused(h.call("session.pin", json!({"sessionId": "s-a"})).await);
    assert_eq!(error, "invalid_args");
    assert!(message.contains("archived"), "{message}");
    let (error, _) = refused(
        h.call("session.unpin", json!({"sessionId": "s-nope"}))
            .await,
    );
    assert_eq!(error, "not_found");
}

#[tokio::test]
async fn session_delete_stops_the_runner_then_deletes() {
    let h = Harness::new().await;
    h.session("s-live", RuntimeKind::Managed, None).await;
    h.session("s-cold", RuntimeKind::External, None).await;
    h.runner.alive.lock().unwrap().insert("s-live".into());

    let out = ok(h
        .call(
            "session.delete",
            json!({"sessionId": "s-live", "supervisor": "galley-assistant"}),
        )
        .await);
    assert_eq!(out, json!({"deleted": true, "sessionId": "s-live"}));
    assert_eq!(*h.runner.shutdowns.lock().unwrap(), ["s-live"]);
    assert!(h.runner.alive.lock().unwrap().is_empty());
    let events = h.rec.take();
    assert_eq!(names(&events), ["session-deleted-external"]);
    assert_eq!(
        events[0].1,
        json!({"sessionId": "s-live", "via": "session.delete"})
    );
    let (error, _) = refused(
        h.call("session.delete", json!({"sessionId": "s-live"}))
            .await,
    );
    assert_eq!(error, "not_found");

    // No runner is fine; any runtime, archived or not.
    ok(h.call("session.delete", json!({"sessionId": "s-cold"}))
        .await);
    assert!(h
        .galley
        .session_brief(SessionId("s-cold".into()))
        .await
        .is_err());

    // An unknown id stops nothing.
    h.runner.shutdowns.lock().unwrap().clear();
    let (error, _) = refused(
        h.call("session.delete", json!({"sessionId": "s-nope"}))
            .await,
    );
    assert_eq!(error, "not_found");
    assert!(h.runner.shutdowns.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_main_chat_cannot_be_renamed_pinned_or_deleted() {
    let h = Harness::new().await;
    h.runner.alive.lock().unwrap().insert(MAIN.into());
    let before = h
        .galley
        .session_brief(SessionId(MAIN.into()))
        .await
        .unwrap();

    for (command, args) in [
        ("session.rename", json!({"sessionId": MAIN, "title": "x"})),
        ("session.pin", json!({"sessionId": MAIN})),
        ("session.unpin", json!({"sessionId": MAIN})),
        ("session.delete", json!({"sessionId": MAIN})),
    ] {
        let (error, message) = refused(h.call(command, args).await);
        assert_eq!(error, "invalid_args", "{command}");
        assert!(
            message.starts_with("main_chat_protected:"),
            "{command}: {message}"
        );
    }
    // Nothing changed, nothing was announced, its runner still runs.
    let after = h
        .galley
        .session_brief(SessionId(MAIN.into()))
        .await
        .unwrap();
    assert_eq!(after.title, before.title);
    assert_eq!(after.pinned, before.pinned);
    assert!(h.rec.take().is_empty());
    assert!(h.runner.shutdowns.lock().unwrap().is_empty());
}

// ---------------- projects ----------------

#[tokio::test]
async fn project_update_pin_and_unpin() {
    let h = Harness::new().await;
    h.project("p1").await;

    let out = ok(h
        .call(
            "project.update",
            json!({"projectId": "p1", "name": "  季度复盘  ", "color": "#00aa88",
                   "supervisor": "galley-assistant"}),
        )
        .await);
    assert_eq!(out["project"]["name"], "季度复盘");
    assert_eq!(out["project"]["color"], "#00aa88");
    assert_eq!(out["project"]["icon"], "📁");
    // An empty icon clears it; the rest stays.
    let out = ok(h
        .call("project.update", json!({"projectId": "p1", "icon": ""}))
        .await);
    assert!(out["project"].get("icon").is_none(), "{out}");
    assert_eq!(out["project"]["name"], "季度复盘");

    let out = ok(h.call("project.pin", json!({"projectId": "p1"})).await);
    assert_eq!(out["project"]["pinned"], true);
    let out = ok(h.call("project.unpin", json!({"projectId": "p1"})).await);
    assert_eq!(out["project"]["pinned"], false);
    let events = h.rec.take();
    assert_eq!(names(&events), ["project-updated-external"; 4]);
    let vias: Vec<&Value> = events.iter().map(|(_, p)| &p["via"]).collect();
    assert_eq!(
        vias,
        [
            "project.update",
            "project.update",
            "project.pin",
            "project.unpin"
        ]
    );

    let (error, _) = refused(
        h.call("project.update", json!({"projectId": "p1", "name": " "}))
            .await,
    );
    assert_eq!(error, "invalid_args");
    let (error, message) = refused(h.call("project.update", json!({"projectId": "p1"})).await);
    assert_eq!(error, "invalid_args");
    assert!(message.contains("at least one"), "{message}");
    let (error, _) = refused(
        h.call(
            "project.update",
            json!({"projectId": "p-nope", "name": "x"}),
        )
        .await,
    );
    assert_eq!(error, "not_found");
    let (error, _) = refused(h.call("project.pin", json!({"projectId": "p-nope"})).await);
    assert_eq!(error, "not_found");
    assert!(h.rec.take().is_empty());
}

#[tokio::test]
async fn project_archive_sessions_archives_what_its_sidebar_group_lists() {
    let h = Harness::new().await;
    h.project("p1").await;
    h.project("p2").await;
    // Listed in p1's group: archived.
    h.session("s-plain", RuntimeKind::Managed, Some("p1")).await;
    h.session("s-promoted", RuntimeKind::Managed, Some("p1"))
        .await;
    // Not listed there: left alone.
    h.session("s-pinned", RuntimeKind::Managed, Some("p1"))
        .await;
    h.session("s-external", RuntimeKind::External, Some("p1"))
        .await;
    h.session("s-subtask", RuntimeKind::Managed, Some("p1"))
        .await;
    h.session("s-archived", RuntimeKind::Managed, Some("p1"))
        .await;
    h.session("s-other", RuntimeKind::Managed, Some("p2")).await;
    h.sql(&format!(
        "UPDATE sessions SET pinned = 1 WHERE id = 's-pinned'; \
         UPDATE sessions SET parent_session_id = '{MAIN}' WHERE id IN ('s-subtask', 's-promoted'); \
         UPDATE sessions SET promoted_at = '2026-10-16T00:00:00Z' WHERE id = 's-promoted'; \
         UPDATE sessions SET status = 'archived' WHERE id = 's-archived'; \
         UPDATE sessions SET project_id = 'p1' WHERE id = '{MAIN}';"
    ))
    .await;

    let out = ok(h
        .call(
            "project.archive_sessions",
            json!({"projectId": "p1", "supervisor": "galley-assistant", "reason": "wrapped up"}),
        )
        .await);
    assert_eq!(out["projectId"], "p1");
    assert_eq!(out["archivedSessions"], 2);
    let mut ids: Vec<String> = serde_json::from_value(out["archivedSessionIds"].clone()).unwrap();
    ids.sort();
    assert_eq!(ids, ["s-plain", "s-promoted"]);
    let events = h.rec.take();
    assert_eq!(names(&events), ["session-archived-external"; 2]);
    assert!(events
        .iter()
        .all(|(_, p)| p["via"] == "project.archive_sessions"));

    for (id, archived) in [
        ("s-plain", true),
        ("s-promoted", true),
        ("s-pinned", false),
        ("s-external", false),
        ("s-subtask", false),
        ("s-other", false),
        (MAIN, false),
    ] {
        let brief = h.galley.session_brief(SessionId(id.into())).await.unwrap();
        assert_eq!(
            brief.status == galley_core_lib::api::SessionStatus::Archived,
            archived,
            "{id}"
        );
    }
    // The project stays.
    assert_eq!(
        h.galley.fetch_project("p1").await.unwrap().id,
        ProjectId("p1".into())
    );

    // Again: nothing left to archive.
    let out = ok(h
        .call("project.archive_sessions", json!({"projectId": "p1"}))
        .await);
    assert_eq!(out["archivedSessions"], 0);
    assert_eq!(out["archivedSessionIds"], json!([]));
    let (error, _) = refused(
        h.call("project.archive_sessions", json!({"projectId": "p-nope"}))
            .await,
    );
    assert_eq!(error, "not_found");
}

/// The external runtime archives its own sessions of the project.
#[tokio::test]
async fn project_archive_sessions_follows_the_active_runtime() {
    let h = Harness::new().await;
    h.project("p1").await;
    h.session("s-managed", RuntimeKind::Managed, Some("p1"))
        .await;
    h.session("s-external", RuntimeKind::External, Some("p1"))
        .await;
    h.galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let out = ok(h
        .call("project.archive_sessions", json!({"projectId": "p1"}))
        .await);
    assert_eq!(out["archivedSessionIds"], json!(["s-external"]));
}

// ---------------- the default model ----------------

async fn seed_provider(galley: &SqliteGalley, id: &str, with_secret: bool) {
    let api_key_ref = format!("managed-provider:{id}");
    galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: id.into(),
            display_name: id.into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://example.test/v1".into(),
            api_key_ref: api_key_ref.clone(),
        })
        .await
        .unwrap();
    if with_secret {
        credential_store::set_secret(galley, &api_key_ref, "sk-test")
            .await
            .unwrap();
    }
}

async fn seed_model(galley: &SqliteGalley, id: &str, provider: &str, name: &str, model: &str) {
    galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: id.into(),
            provider_id: provider.into(),
            display_name: name.into(),
            model: model.into(),
            preset_options: None,
            advanced_overrides: Some(json!({"temperature": 0.3})),
            make_default: false,
        })
        .await
        .unwrap();
}

/// Three usable models and one without a key; the first saved is the
/// default.
async fn seed_models(galley: &SqliteGalley) {
    seed_provider(galley, "mp_key", true).await;
    seed_provider(galley, "mp_nokey", false).await;
    seed_model(galley, "mm_sol", "mp_key", "GPT 6.1 Sol", "gpt-6.1-sol").await;
    seed_model(galley, "mm_flash", "mp_key", "GLM Flash", "glm-5.3-flash").await;
    seed_model(galley, "mm_nokey", "mp_nokey", "No Key", "nokey-1").await;
    seed_model(galley, "mm_mini", "mp_key", "Mini", "mini-2").await;
}

/// What the desktop's model list reads: `(id, isDefault, sortOrder,
/// advancedOverrides)` in its order.
async fn desktop_models(galley: &SqliteGalley) -> Vec<(String, bool, i64, Value)> {
    galley
        .list_managed_models()
        .await
        .unwrap()
        .into_iter()
        .map(|m| (m.id, m.is_default, m.sort_order, m.advanced_overrides))
        .collect()
}

#[tokio::test]
async fn llm_set_default_moves_the_model_to_the_top_like_the_desktop() {
    let h = Harness::new().await;
    seed_models(&h.galley).await;
    // The desktop's own 「设为默认」 on a twin store: `save_managed_model`
    // with the record unchanged and `makeDefault`.
    let twin = Harness::new().await;
    seed_models(&twin.galley).await;

    let out = ok(h
        .call(
            "llm.set_default",
            json!({"llmName": "glm-5.3-FLASH", "supervisor": "galley-assistant",
                   "reason": "user agreed"}),
        )
        .await);
    assert_eq!(
        out,
        json!({"llm": {"index": 0, "name": "GLM Flash", "key": "mm_flash",
                       "displayName": "GLM Flash", "isCurrent": true},
               "changed": true})
    );
    assert_eq!(names(&h.rec.take()), ["managed-models:changed"]);

    // `llm list` reads it at index 0.
    let choices = h.galley.list_managed_llm_choices().await.unwrap();
    let order: Vec<&str> = choices.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(order, ["mm_flash", "mm_sol", "mm_mini"]);

    twin.galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_flash".into(),
            provider_id: "mp_key".into(),
            display_name: "GLM Flash".into(),
            model: "glm-5.3-flash".into(),
            preset_options: None,
            advanced_overrides: Some(json!({"temperature": 0.3})),
            make_default: true,
        })
        .await
        .unwrap();
    let ours = desktop_models(&h.galley).await;
    assert_eq!(ours, desktop_models(&twin.galley).await);
    assert_eq!(ours[0].0, "mm_flash");
    assert!(ours[0].1, "is_default");
    assert_eq!(ours.iter().filter(|m| m.1).count(), 1);
    // The model's own layers are kept.
    assert!(ours.iter().all(|m| m.3 == json!({"temperature": 0.3})));

    // Already the default: nothing written, nothing announced.
    let out = ok(h
        .call("llm.set_default", json!({"llmName": "GLM Flash"}))
        .await);
    assert_eq!(out["changed"], false);
    assert_eq!(out["llm"]["key"], "mm_flash");
    assert!(h.rec.take().is_empty());
    assert_eq!(desktop_models(&h.galley).await, ours);
}

#[tokio::test]
async fn llm_set_default_refusals() {
    let h = Harness::new().await;
    seed_models(&h.galley).await;
    let before = desktop_models(&h.galley).await;

    // A name `llm list` does not print: unknown, or a model with no key.
    for name in ["nope", "No Key"] {
        let (error, message) = refused(h.call("llm.set_default", json!({"llmName": name})).await);
        assert_eq!(error, "invalid_args", "{name}");
        assert!(message.contains("unknown managed llm"), "{message}");
    }
    let (error, _) = refused(h.call("llm.set_default", json!({})).await);
    assert_eq!(error, "invalid_args");

    // Under an attached GenericAgent there is no Galley default to set.
    h.galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let (error, message) = refused(
        h.call("llm.set_default", json!({"llmName": "GLM Flash"}))
            .await,
    );
    assert_eq!(error, "invalid_args");
    assert!(message.starts_with("managed_runtime_only:"), "{message}");
    assert_eq!(desktop_models(&h.galley).await, before);
    assert!(h.rec.take().is_empty());
}

/// New commands, served under every accepted pin like the rest of `3`'s
/// unchanged surface.
#[tokio::test]
async fn the_hands_answer_every_pin() {
    let h = Harness::new().await;
    h.session("s-a", RuntimeKind::Managed, None).await;
    for schema in [1, 2, 3] {
        ok(
            h.call_pinned("session.pin", json!({"sessionId": "s-a"}), schema)
                .await,
        );
    }
}
