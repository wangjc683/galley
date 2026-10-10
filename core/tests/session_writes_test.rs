//! Core's write path (`core/src/session_writes.rs`, ticket 02d): every
//! session, project and scheduled-task write is broadcast through the
//! `Notifier` exactly once, with the event form of the row (every
//! optional field written out, `null` when empty), and the socket
//! handlers that share it do not broadcast a second time.
//!
//! The GUI's Tauri write commands are thin wrappers over `Writes` (they
//! only build a `TauriNotifier` and stringify the error), so the
//! `Writes` tests below are their tests too.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateProjectInput, CreateScheduledTaskInput, CreateSessionInput, GalleyApi, Origin, OriginVia,
    ProjectId, ProjectPatch, RuntimeKind, ScheduledTaskId, ScheduledTaskPatch, ScheduledTaskRepeat,
    SessionBrief, SessionId,
};
use galley_core_lib::db::{RenameTitleSource, SqliteGalley};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_writes::{SessionBriefEvent, Writes, VIA_GUI};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

// ---------------- fixtures ----------------

async fn fresh_galley() -> SqliteGalley {
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
    SqliteGalley::from_pool(pool)
}

fn gui() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
    }
}

fn sid(id: &str) -> SessionId {
    SessionId(id.to_string())
}

fn session_input(id: &str, title: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.to_string(),
        title: title.to_string(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::External),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

/// A session written straight to the database — no broadcast.
async fn seed(galley: &SqliteGalley, id: &str) {
    galley
        .create_session(session_input(id, "种子"), gui())
        .await
        .expect("seed session");
}

async fn seed_project(galley: &SqliteGalley, id: &str, root_path: Option<&str>) {
    galley
        .create_project(
            CreateProjectInput {
                id: id.to_string(),
                name: "项目".into(),
                root_path: root_path.map(str::to_string),
                workspace_enabled: root_path.is_some(),
                icon: None,
                color: None,
            },
            gui(),
        )
        .await
        .expect("seed project");
}

/// Recording notifier: every emit lands in a Vec.
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
    fn payloads(&self) -> Vec<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(_, p)| p.clone())
            .collect()
    }
    /// The only event recorded so far, which must be `event`.
    fn only(&self, event: &str) -> Value {
        let events = self.events.lock().unwrap();
        assert_eq!(
            events.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
            vec![event],
            "exactly one broadcast"
        );
        events[0].1.clone()
    }
    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

/// Runner registry stand-in: a live runner (or none) that records what
/// it was sent.
struct FakeRunner {
    live: bool,
    sent: Mutex<Vec<(String, IpcCommand)>>,
}

impl FakeRunner {
    fn live() -> Self {
        Self {
            live: true,
            sent: Mutex::new(Vec::new()),
        }
    }
    fn none() -> Self {
        Self {
            live: false,
            sent: Mutex::new(Vec::new()),
        }
    }
    fn sent(&self) -> Vec<(String, String)> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|(s, c)| (s.clone(), format!("{c:?}")))
            .collect()
    }
}

#[async_trait]
impl RunnerPort for FakeRunner {
    async fn spawn(
        &self,
        _args: SpawnArgs,
        _active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        panic!("no write spawns a runner")
    }
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        if !self.live {
            return Err(SendCommandError::ProcessGone {
                session_id: session_id.to_string(),
            });
        }
        self.sent
            .lock()
            .unwrap()
            .push((session_id.to_string(), cmd.clone()));
        Ok(())
    }
    async fn subscribe(&self, _session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, _session_id: &str) -> Option<u32> {
        self.live.then_some(4242)
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        false
    }
    async fn shutdown(
        &self,
        session_id: &str,
        _grace: Option<std::time::Duration>,
    ) -> Result<(), ShutdownError> {
        Err(ShutdownError::NotFound {
            session_id: session_id.to_string(),
        })
    }
}

/// Assert `payload.session` is the event form of a session row: every
/// optional field present, `via` as given.
fn assert_session_payload(payload: &Value, id: &str, via: &str) {
    assert_eq!(payload["via"], via);
    let session = payload["session"].as_object().expect("session object");
    assert_eq!(session["id"], id);
    for key in [
        "projectId",
        "summary",
        "turnCount",
        "pinned",
        "hasUnread",
        "origin",
        "selectedLlmIndex",
        "selectedLlmKey",
        "selectedLlmDisplayName",
        "gaRuntimeId",
        "promptProfile",
        "reasoningEffort",
    ] {
        assert!(session.contains_key(key), "event payload lacks `{key}`");
    }
}

// ---------------- sessions ----------------

#[tokio::test]
async fn create_session_broadcasts_created_once_with_every_field() {
    let galley = fresh_galley().await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    let brief = w
        .create_session(session_input("s-new", "新对话"), gui())
        .await
        .unwrap();

    let payload = rec.only("session-created-external");
    assert_session_payload(&payload, "s-new", "gui");
    assert_eq!(payload["session"]["title"], brief.title);
    // A fresh row's empty fields go out as explicit nulls.
    assert_eq!(payload["session"]["projectId"], Value::Null);
    assert_eq!(payload["session"]["reasoningEffort"], Value::Null);
    assert_eq!(payload["session"]["summary"], Value::Null);

    // A failed write broadcasts nothing (id conflict).
    rec.clear();
    assert!(w
        .create_session(session_input("s-new", "新对话"), gui())
        .await
        .is_err());
    assert!(rec.names().is_empty());
}

#[tokio::test]
async fn rename_pin_and_unread_broadcast_updated_once_each() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.rename_session(sid("s1"), "新名字".into(), RenameTitleSource::User, gui())
        .await
        .unwrap();
    let payload = rec.only("session-updated-external");
    assert_session_payload(&payload, "s1", "gui");
    assert_eq!(payload["session"]["title"], "新名字");

    rec.clear();
    w.set_session_pinned(sid("s1"), true, gui()).await.unwrap();
    assert_eq!(
        rec.only("session-updated-external")["session"]["pinned"],
        true
    );

    rec.clear();
    w.mark_session_unread(sid("s1")).await.unwrap();
    assert_eq!(
        rec.only("session-updated-external")["session"]["hasUnread"],
        true
    );

    rec.clear();
    w.clear_session_unread(sid("s1")).await.unwrap();
    assert_eq!(
        rec.only("session-updated-external")["session"]["hasUnread"],
        false
    );

    // Failures broadcast nothing: unknown session, archived pin.
    rec.clear();
    assert!(w.mark_session_unread(sid("s-gone")).await.is_err());
    assert!(w
        .rename_session(sid("s-gone"), "x".into(), RenameTitleSource::User, gui())
        .await
        .is_err());
    w.archive_session(sid("s1"), gui()).await.unwrap();
    rec.clear();
    assert!(w.set_session_pinned(sid("s1"), false, gui()).await.is_err());
    assert!(rec.names().is_empty());
}

#[tokio::test]
async fn clearing_reasoning_effort_broadcasts_an_explicit_null_and_forwards_it() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let runner = FakeRunner::live();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.set_session_reasoning_effort(&runner, sid("s1"), Some("high".into()), gui())
        .await
        .unwrap();
    assert_eq!(
        rec.only("session-updated-external")["session"]["reasoningEffort"],
        "high"
    );

    rec.clear();
    let cleared = w
        .set_session_reasoning_effort(&runner, sid("s1"), None, gui())
        .await
        .unwrap();
    let payload = rec.only("session-updated-external");
    let session = payload["session"].as_object().unwrap();
    assert!(
        session.contains_key("reasoningEffort") && session["reasoningEffort"].is_null(),
        "a cleared effort is an explicit null: {payload}"
    );
    // The CLI's JSON of the same row still leaves the field out.
    let cli = serde_json::to_value(&cleared).unwrap();
    assert!(cli.get("reasoningEffort").is_none(), "{cli}");

    // Both values reached the live runner.
    let sent = runner.sent();
    assert_eq!(sent.len(), 2);
    assert!(sent[0].1.contains("SetReasoningEffort") && sent[0].1.contains("high"));
    assert!(sent[1].1.contains("SetReasoningEffort") && sent[1].1.contains("None"));

    // No live runner: still persisted and broadcast, nothing sent.
    rec.clear();
    let idle = FakeRunner::none();
    w.set_session_reasoning_effort(&idle, sid("s1"), Some("low".into()), gui())
        .await
        .unwrap();
    rec.only("session-updated-external");
    assert!(idle.sent().is_empty());
}

#[tokio::test]
async fn a_picked_model_is_forwarded_to_a_live_runner_once() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let runner = FakeRunner::live();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.pick_session_llm(
        &runner,
        sid("s1"),
        Some(2),
        Some("glm-5.1".into()),
        Some("GLM 5.1".into()),
        true,
    )
    .await
    .unwrap();

    let payload = rec.only("session-updated-external");
    assert_eq!(payload["session"]["selectedLlmIndex"], 2);
    assert_eq!(payload["session"]["selectedLlmKey"], "glm-5.1");
    let sent = runner.sent();
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].0, "s1");
    let first = runner.sent.lock().unwrap()[0].1.clone();
    match first {
        IpcCommand::SetLlm(cmd) => assert_eq!(cmd.llm_index, 2),
        other => panic!("expected SetLlm, got {other:?}"),
    }
}

#[tokio::test]
async fn a_runner_reported_model_is_persisted_but_not_sent_back() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let runner = FakeRunner::live();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.pick_session_llm(&runner, sid("s1"), Some(1), None, Some("A".into()), false)
        .await
        .unwrap();
    rec.only("session-updated-external");
    assert!(runner.sent().is_empty());

    // No live runner: a pick is persisted and broadcast, nothing sent.
    rec.clear();
    let idle = FakeRunner::none();
    w.pick_session_llm(&idle, sid("s1"), Some(3), None, Some("B".into()), true)
        .await
        .unwrap();
    rec.only("session-updated-external");
    assert!(idle.sent().is_empty());
}

#[tokio::test]
async fn archive_and_unarchive_broadcast_their_events() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.archive_session(sid("s1"), gui()).await.unwrap();
    let payload = rec.only("session-archived-external");
    assert_session_payload(&payload, "s1", "gui");
    assert_eq!(payload["session"]["status"], "archived");

    rec.clear();
    w.unarchive_session(sid("s1"), gui()).await.unwrap();
    assert_eq!(
        rec.only("session-unarchived-external")["session"]["status"],
        "idle"
    );
}

#[tokio::test]
async fn bulk_archive_broadcasts_once_per_session_it_changed() {
    let galley = fresh_galley().await;
    for id in ["a", "b", "c"] {
        seed(&galley, id).await;
    }
    galley.archive_session(sid("b"), gui()).await.unwrap();
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    let count = w
        .bulk_archive_sessions(vec![sid("c"), sid("b"), sid("ghost"), sid("a")], gui())
        .await
        .unwrap();

    assert_eq!(count, 2);
    assert_eq!(
        rec.names(),
        vec!["session-archived-external", "session-archived-external"]
    );
    // In the caller's order; the already-archived and unknown ids are skipped.
    let ids: Vec<Value> = rec
        .payloads()
        .iter()
        .map(|p| p["session"]["id"].clone())
        .collect();
    assert_eq!(ids, vec![json!("c"), json!("a")]);
    for p in rec.payloads() {
        assert_eq!(p["session"]["status"], "archived");
        assert_eq!(p["via"], "gui");
    }

    rec.clear();
    let count = w
        .bulk_unarchive_sessions(vec![sid("a"), sid("b"), sid("c")], gui())
        .await
        .unwrap();
    assert_eq!(count, 3);
    assert_eq!(rec.names(), vec!["session-unarchived-external"; 3]);

    // Nothing to do, nothing said.
    rec.clear();
    assert_eq!(w.bulk_archive_sessions(vec![], gui()).await.unwrap(), 0);
    assert_eq!(
        w.bulk_unarchive_sessions(vec![sid("a")], gui())
            .await
            .unwrap(),
        0
    );
    assert!(rec.names().is_empty());
}

#[tokio::test]
async fn deletes_broadcast_session_deleted_per_session() {
    let galley = fresh_galley().await;
    for id in ["a", "b", "c"] {
        seed(&galley, id).await;
    }
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.delete_session(sid("a"), gui()).await.unwrap();
    assert_eq!(
        rec.only("session-deleted-external"),
        json!({ "sessionId": "a", "via": "gui" })
    );

    rec.clear();
    assert!(w.delete_session(sid("a"), gui()).await.is_err());
    assert!(rec.names().is_empty(), "a failed delete says nothing");

    let count = w
        .bulk_delete_sessions(vec![sid("c"), sid("ghost"), sid("b")], gui())
        .await
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        rec.payloads(),
        vec![
            json!({ "sessionId": "c", "via": "gui" }),
            json!({ "sessionId": "b", "via": "gui" }),
        ]
    );
    assert!(galley
        .list_sessions(Default::default())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn the_launch_sweeps_broadcast_each_deleted_session() {
    let galley = fresh_galley().await;
    // Abandoned 新对话 rows go; one with a message stays.
    galley
        .create_session(session_input("s-empty", "新对话"), gui())
        .await
        .unwrap();
    galley
        .create_session(session_input("s-used", "新对话"), gui())
        .await
        .unwrap();
    galley
        .send_message(sid("s-used"), "你好".into(), gui())
        .await
        .unwrap();
    galley
        .create_session(session_input("s-today-1", "演示"), gui())
        .await
        .unwrap();
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    assert_eq!(w.delete_empty_new_sessions().await.unwrap(), 1);
    assert_eq!(
        rec.only("session-deleted-external"),
        json!({ "sessionId": "s-empty", "via": "gui" })
    );

    rec.clear();
    assert_eq!(w.delete_demo_sessions().await.unwrap(), 1);
    assert_eq!(
        rec.only("session-deleted-external"),
        json!({ "sessionId": "s-today-1", "via": "gui" })
    );

    rec.clear();
    assert_eq!(w.delete_empty_new_sessions().await.unwrap(), 0);
    assert_eq!(w.delete_demo_sessions().await.unwrap(), 0);
    assert!(rec.names().is_empty());
}

#[tokio::test]
async fn moving_out_of_a_project_broadcasts_an_explicit_null_project() {
    let galley = fresh_galley().await;
    seed_project(&galley, "proj_a", None).await;
    seed(&galley, "s1").await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.assign_session_to_project(sid("s1"), Some("proj_a".into()), gui())
        .await
        .unwrap();
    assert_eq!(
        rec.only("session-moved-external")["session"]["projectId"],
        "proj_a"
    );

    rec.clear();
    let moved_out = w
        .assign_session_to_project(sid("s1"), None, gui())
        .await
        .unwrap();
    let payload = rec.only("session-moved-external");
    let session = payload["session"].as_object().unwrap();
    assert!(
        session.contains_key("projectId") && session["projectId"].is_null(),
        "{payload}"
    );
    let cli = serde_json::to_value(&moved_out).unwrap();
    assert!(cli.get("projectId").is_none(), "{cli}");
}

// ---------------- projects ----------------

#[tokio::test]
async fn project_writes_broadcast_created_updated_deleted_once_each() {
    let galley = fresh_galley().await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.create_project(
        CreateProjectInput {
            id: "proj_a".into(),
            name: "甲".into(),
            root_path: Some("/tmp/a".into()),
            workspace_enabled: true,
            icon: None,
            color: None,
        },
        gui(),
    )
    .await
    .unwrap();
    let payload = rec.only("project-created-external");
    assert_eq!(payload["via"], "gui");
    assert_eq!(payload["project"]["id"], "proj_a");
    assert_eq!(payload["project"]["rootPath"], "/tmp/a");
    assert!(payload["project"].as_object().unwrap()["icon"].is_null());

    // Clearing the root: the event says null, the brief's JSON leaves it out.
    rec.clear();
    let updated = w
        .update_project(
            ProjectId("proj_a".into()),
            ProjectPatch {
                name: Some("乙".into()),
                root_path: Some(None),
                workspace_enabled: Some(false),
                ..ProjectPatch::default()
            },
            gui(),
        )
        .await
        .unwrap();
    let payload = rec.only("project-updated-external");
    assert_eq!(payload["via"], "gui");
    assert_eq!(payload["project"]["name"], "乙");
    let project = payload["project"].as_object().unwrap();
    assert!(project.contains_key("rootPath") && project["rootPath"].is_null());
    assert_eq!(project["workspaceEnabled"], false);
    assert!(serde_json::to_value(&updated)
        .unwrap()
        .get("rootPath")
        .is_none());

    // Delete: the socket's payload shape, with the detached sessions.
    seed(&galley, "s1").await;
    galley
        .assign_session_to_project(sid("s1"), Some("proj_a".into()), gui())
        .await
        .unwrap();
    rec.clear();
    let deleted = w
        .delete_project(ProjectId("proj_a".into()), gui())
        .await
        .unwrap();
    assert_eq!(deleted.detached_session_ids, vec!["s1".to_string()]);
    assert_eq!(
        rec.only("project-deleted-external"),
        json!({
            "projectId": "proj_a",
            "detachedSessions": 1,
            "detachedSessionIds": ["s1"],
        })
    );

    rec.clear();
    assert!(w
        .delete_project(ProjectId("proj_a".into()), gui())
        .await
        .is_err());
    assert!(w
        .update_project(ProjectId("proj_a".into()), ProjectPatch::default(), gui())
        .await
        .is_err());
    assert!(rec.names().is_empty());
}

// ---------------- scheduled tasks ----------------

#[tokio::test]
async fn scheduled_task_writes_broadcast_changed_once_each() {
    let galley = fresh_galley().await;
    let rec = Recorder::default();
    let w = Writes::new(&galley, &rec, VIA_GUI);

    w.create_scheduled_task(
        CreateScheduledTaskInput {
            id: "sched_a".into(),
            project_id: None,
            prompt: "早报".into(),
            repeat: ScheduledTaskRepeat::Daily,
            time_of_day: "09:00".into(),
            llm_name: None,
            enabled: true,
        },
        gui(),
    )
    .await
    .unwrap();
    assert_eq!(rec.only("scheduled-tasks:changed"), Value::Null);

    rec.clear();
    w.update_scheduled_task(
        ScheduledTaskId("sched_a".into()),
        ScheduledTaskPatch {
            enabled: Some(false),
            ..ScheduledTaskPatch::default()
        },
        gui(),
    )
    .await
    .unwrap();
    rec.only("scheduled-tasks:changed");

    rec.clear();
    w.delete_scheduled_task(ScheduledTaskId("sched_a".into()), gui())
        .await
        .unwrap();
    rec.only("scheduled-tasks:changed");

    rec.clear();
    assert!(w
        .delete_scheduled_task(ScheduledTaskId("sched_a".into()), gui())
        .await
        .is_err());
    assert!(rec.names().is_empty());
}

// ---------------- the event form vs the CLI form ----------------

fn all_none_brief() -> SessionBrief {
    SessionBrief {
        id: sid("s1"),
        project_id: None,
        title: "t".into(),
        status: galley_core_lib::api::SessionStatus::Idle,
        summary: None,
        turn_count: None,
        last_activity_at: "2026-10-10T00:00:00Z".into(),
        created_at: "2026-10-10T00:00:00Z".into(),
        updated_at: "2026-10-10T00:00:00Z".into(),
        pinned: None,
        has_unread: None,
        origin: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        runtime_kind: RuntimeKind::Managed,
        runtime_label: "Galley".into(),
        ga_runtime_kind: RuntimeKind::Managed,
        ga_runtime_id: None,
        prompt_profile: None,
        reasoning_effort: None,
    }
}

fn all_some_brief() -> SessionBrief {
    SessionBrief {
        project_id: Some("p".into()),
        summary: Some("s".into()),
        turn_count: Some(1),
        pinned: Some(true),
        has_unread: Some(true),
        origin: Some(Origin {
            via: OriginVia::Cli,
            supervisor: None,
            reason: None,
        }),
        selected_llm_index: Some(1),
        selected_llm_key: Some("k".into()),
        selected_llm_display_name: Some("d".into()),
        ga_runtime_id: Some("r".into()),
        prompt_profile: Some("p".into()),
        reasoning_effort: Some("high".into()),
        ..all_none_brief()
    }
}

fn keys(v: &Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    k.sort();
    k
}

/// The CLI's `SessionBrief` JSON keeps skipping empty fields (Agent API,
/// unchanged); the event form writes every field, null when empty, and
/// has exactly the brief's keys.
#[test]
fn the_cli_brief_skips_empty_fields_and_the_event_form_writes_them_as_null() {
    let cli = serde_json::to_value(all_none_brief()).unwrap();
    for key in ["projectId", "summary", "reasoningEffort", "selectedLlmKey"] {
        assert!(cli.get(key).is_none(), "CLI JSON must skip `{key}`: {cli}");
    }
    let event = serde_json::to_value(SessionBriefEvent::from(all_none_brief())).unwrap();
    let full = serde_json::to_value(all_some_brief()).unwrap();
    assert_eq!(keys(&event), keys(&full), "event form has the brief's keys");
    for key in keys(&full) {
        if cli.get(&key).is_none() {
            assert!(event[&key].is_null(), "`{key}` is an explicit null");
        }
    }
    assert_eq!(
        keys(&serde_json::to_value(SessionBriefEvent::from(all_some_brief())).unwrap()),
        keys(&full)
    );
}

// ---------------- the socket shares the path, once ----------------

async fn dispatch(
    galley: &SqliteGalley,
    runner: &FakeRunner,
    rec: &Arc<Recorder>,
    command: &str,
    args: Value,
) -> SocketResponse {
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner,
        notifier: rec.clone(),
        app: None,
    };
    let line = serde_json::to_string(&json!({
        "command": command, "args": args, "schemaVersion": 1, "requestId": "t1",
    }))
    .unwrap();
    match dispatch_line_with(&ctx, &line).await {
        DispatchResult::Unary(resp) => resp,
        DispatchResult::Stream { .. } => panic!("expected unary response"),
    }
}

#[tokio::test]
async fn socket_session_writes_broadcast_once_in_the_event_form() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    seed_project(&galley, "proj_a", None).await;
    let runner = FakeRunner::live();
    let rec = Arc::new(Recorder::default());

    for (command, args, event, via) in [
        (
            "session.archive",
            json!({"sessionId": "s1"}),
            "session-archived-external",
            "session.archive",
        ),
        (
            "session.restore",
            json!({"sessionId": "s1"}),
            "session-unarchived-external",
            "session.restore",
        ),
        (
            "session.move",
            json!({"sessionId": "s1", "to": "proj_a"}),
            "session-moved-external",
            "session.move",
        ),
        (
            "session.move",
            json!({"sessionId": "s1"}),
            "session-moved-external",
            "session.move",
        ),
    ] {
        rec.clear();
        let resp = dispatch(&galley, &runner, &rec, command, args).await;
        assert!(resp.ok, "{command}: {resp:?}");
        let payload = rec.only(event);
        assert_session_payload(&payload, "s1", via);
        // The response is the CLI's brief: empty fields skipped as ever.
        let session = &resp.result.as_ref().unwrap()["session"];
        assert!(session.get("reasoningEffort").is_none(), "{session}");
    }
    // The last move took the session out: explicit null in the event.
    assert!(rec.payloads()[0]["session"]["projectId"].is_null());
}

#[tokio::test]
async fn socket_llm_set_broadcasts_once_and_still_dispatches() {
    let galley = fresh_galley().await;
    seed(&galley, "s1").await;
    galley
        .set_pref_json(
            "llm_list",
            json!([{"index": 0, "displayName": "GLM 5.1", "key": "glm-5.1"}]),
        )
        .await
        .unwrap();
    let runner = FakeRunner::live();
    let rec = Arc::new(Recorder::default());

    let resp = dispatch(
        &galley,
        &runner,
        &rec,
        "llm.set",
        json!({"sessionId": "s1", "llmName": "GLM 5.1"}),
    )
    .await;

    assert!(resp.ok, "{resp:?}");
    assert_eq!(resp.result.as_ref().unwrap()["dispatch"], "dispatched");
    let payload = rec.only("session-updated-external");
    assert_session_payload(&payload, "s1", "llm.set");
    assert_eq!(payload["session"]["selectedLlmKey"], "glm-5.1");
    let sent = runner.sent();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].1.contains("SetLlm"));
}

#[tokio::test]
async fn socket_project_writes_broadcast_once() {
    let galley = fresh_galley().await;
    let runner = FakeRunner::none();
    let rec = Arc::new(Recorder::default());

    let resp = dispatch(
        &galley,
        &runner,
        &rec,
        "project.create",
        json!({"name": "甲"}),
    )
    .await;
    assert!(resp.ok, "{resp:?}");
    let project_id = resp.result.as_ref().unwrap()["project"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let payload = rec.only("project-created-external");
    assert_eq!(payload["via"], "project.create");
    assert!(payload["project"]["rootPath"].is_null());

    seed(&galley, "s1").await;
    galley
        .assign_session_to_project(sid("s1"), Some(project_id.clone()), gui())
        .await
        .unwrap();
    rec.clear();
    let resp = dispatch(
        &galley,
        &runner,
        &rec,
        "project.delete",
        json!({"projectId": project_id}),
    )
    .await;
    assert!(resp.ok, "{resp:?}");
    assert_eq!(
        resp.result.unwrap(),
        json!({
            "deleted": true,
            "projectId": project_id,
            "detachedSessions": 1,
            "detachedSessionIds": ["s1"],
        })
    );
    assert_eq!(
        rec.only("project-deleted-external"),
        json!({
            "projectId": project_id,
            "detachedSessions": 1,
            "detachedSessionIds": ["s1"],
        })
    );
}
