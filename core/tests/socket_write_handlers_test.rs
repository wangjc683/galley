//! Integration tests for the socket WRITE handlers — driven from the full
//! request line through `dispatch_line_with`, with every dependency
//! injected: in-memory DB (`DbSource::Pool`, same seam as
//! `db_writes_test.rs`), a configurable fake `RunnerPort`, and a
//! recording `Notifier`. This is the coverage the handlers could not have
//! while they reached for `SqliteGalley::open()` and `AppHandle` as
//! globals: the persist → dispatch → emit orchestration, including every
//! `spawn_failed` rollback-narration branch of `session.new`.
//!
//! Shared setup (`fresh_pool` + migrations) is intentionally duplicated
//! from `db_writes_test.rs` — cargo compiles each `tests/*.rs` as its own
//! crate root, and a `tests/common/` scaffold isn't worth it yet.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, Origin, OriginVia, RuntimeKind, SessionBrief,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tokio::sync::broadcast;

const MIG_001: &str = include_str!("../migrations/001_init.sql");
const MIG_002: &str = include_str!("../migrations/002_add_has_unread.sql");
const MIG_003: &str = include_str!("../migrations/003_add_message_summary.sql");
const MIG_004: &str = include_str!("../migrations/004_add_messages_fts.sql");
const MIG_005: &str = include_str!("../migrations/005_add_message_preamble.sql");
const MIG_006: &str = include_str!("../migrations/006_messages_origin.sql");
const MIG_007: &str = include_str!("../migrations/007_sessions_origin.sql");
const MIG_008: &str = include_str!("../migrations/008_runtime_identity.sql");
const MIG_009: &str = include_str!("../migrations/009_managed_models.sql");
const MIG_010: &str = include_str!("../migrations/010_managed_model_providers.sql");
const MIG_011: &str = include_str!("../migrations/011_managed_model_sort_order.sql");
const MIG_012: &str = include_str!("../migrations/012_managed_model_local_secrets.sql");
const MIG_013: &str = include_str!("../migrations/013_session_llm_key.sql");
const MIG_014: &str = include_str!("../migrations/014_managed_model_auth_kind.sql");
const MIG_015: &str = include_str!("../migrations/015_goal_v1.sql");
const MIG_016: &str = include_str!("../migrations/016_goal_master_session.sql");
const MIG_017: &str = include_str!("../migrations/017_message_visibility.sql");
const MIG_018: &str = include_str!("../migrations/018_goal_deliverable.sql");
const MIG_019: &str = include_str!("../migrations/019_goal_workspace.sql");
const MIG_020: &str = include_str!("../migrations/020_message_attachments.sql");
const MIG_021: &str = include_str!("../migrations/021_native_session_runtime.sql");
const MIG_022: &str = include_str!("../migrations/022_native_memory_substrate.sql");
const MIG_023: &str = include_str!("../migrations/023_native_goal_runtime.sql");
const MIG_024: &str = include_str!("../migrations/024_native_default_runtime.sql");
const MIG_025: &str = include_str!("../migrations/025_restore_managed_runtime_default.sql");
const MIG_026: &str = include_str!("../migrations/026_project_workspace.sql");
const MIG_027: &str = include_str!("../migrations/027_managed_model_context_win.sql");
const MIG_028: &str = include_str!("../migrations/028_message_telemetry.sql");
const MIG_029: &str = include_str!("../migrations/029_managed_model_custom_context_win.sql");
const MIG_030: &str = include_str!("../migrations/030_single_active_goal.sql");
const MIG_031: &str = include_str!("../migrations/031_message_goal_id.sql");
const MIG_032: &str = include_str!("../migrations/032_goal_mode.sql");
const MIG_033: &str = include_str!("../migrations/033_goal_optional_project.sql");
const MIG_034: &str = include_str!("../migrations/034_session_approval_mode.sql");
const MIG_038: &str = include_str!("../migrations/038_session_title_source.sql");

async fn fresh_galley() -> SqliteGalley {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_038,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    SqliteGalley::from_pool(pool)
}

// ---------------- fakes ----------------

/// Recording notifier: every emit lands in a Vec the test can assert on.
#[derive(Default)]
struct RecordingNotifier {
    events: Mutex<Vec<(String, Value)>>,
}

impl Notifier for RecordingNotifier {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl RecordingNotifier {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(n, _)| n.clone())
            .collect()
    }
    fn payload_of(&self, event: &str) -> Option<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .find(|(n, _)| n == event)
            .map(|(_, p)| p.clone())
    }
}

/// Configurable fake runner. Each behavior mirrors one real failure mode
/// the handlers must narrate correctly.
struct FakeRunner {
    spawn_result: Mutex<Option<Result<u32, RunnerSpawnError>>>,
    send_result: Mutex<Option<Result<(), SendCommandError>>>,
    subscribe_some: bool,
    running: bool,
    sent_commands: Mutex<Vec<(String, String)>>,
}

impl Default for FakeRunner {
    fn default() -> Self {
        Self {
            spawn_result: Mutex::new(Some(Ok(4242))),
            send_result: Mutex::new(Some(Ok(()))),
            subscribe_some: true,
            running: true,
            sent_commands: Mutex::new(Vec::new()),
        }
    }
}

impl FakeRunner {
    fn send_fails_process_gone() -> Self {
        Self {
            send_result: Mutex::new(Some(Err(SendCommandError::ProcessGone {
                session_id: "gone".into(),
            }))),
            ..Self::default()
        }
    }
    fn spawn_fails(e: RunnerSpawnError) -> Self {
        Self {
            spawn_result: Mutex::new(Some(Err(e))),
            ..Self::default()
        }
    }
    fn subscribe_none() -> Self {
        Self {
            subscribe_some: false,
            ..Self::default()
        }
    }
}

#[async_trait]
impl RunnerPort for FakeRunner {
    async fn spawn(
        &self,
        _args: SpawnArgs,
        _active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        self.spawn_result
            .lock()
            .unwrap()
            .take()
            .expect("spawn configured once")
    }
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        self.sent_commands
            .lock()
            .unwrap()
            .push((session_id.to_string(), format!("{cmd:?}")));
        match &*self.send_result.lock().unwrap() {
            Some(Ok(())) => Ok(()),
            Some(Err(SendCommandError::ProcessGone { session_id })) => {
                Err(SendCommandError::ProcessGone {
                    session_id: session_id.clone(),
                })
            }
            Some(Err(SendCommandError::Serialize { detail }))
            | Some(Err(SendCommandError::WriteIo { detail })) => Err(SendCommandError::WriteIo {
                detail: detail.clone(),
            }),
            None => Ok(()),
        }
    }
    async fn subscribe(&self, _session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        if self.subscribe_some {
            let (tx, rx) = broadcast::channel(8);
            // Keep the sender alive long enough for the emit task to attach;
            // dropping tx immediately closes the stream, which is fine.
            drop(tx);
            Some(rx)
        } else {
            None
        }
    }
    async fn pid(&self, _session_id: &str) -> Option<u32> {
        if self.running {
            Some(4242)
        } else {
            None
        }
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        self.running
    }
    async fn shutdown(
        &self,
        session_id: &str,
        _grace: Option<std::time::Duration>,
    ) -> Result<(), ShutdownError> {
        if self.running {
            Ok(())
        } else {
            Err(ShutdownError::NotFound {
                session_id: session_id.to_string(),
            })
        }
    }
}

// ---------------- harness ----------------

struct Harness {
    galley: SqliteGalley,
    db: DbSource,
    runner: FakeRunner,
    notifier: std::sync::Arc<RecordingNotifier>,
}

impl Harness {
    async fn new(runner: FakeRunner) -> Self {
        let galley = fresh_galley().await;
        let db = DbSource::Pool(galley.clone());
        Self {
            galley,
            db,
            runner,
            notifier: std::sync::Arc::new(RecordingNotifier::default()),
        }
    }

    async fn dispatch(&self, req: Value) -> SocketResponse {
        let ctx = HandlerCtx {
            db: &self.db,
            runner: &self.runner,
            notifier: self.notifier.clone(),
            app: None,
        };
        let line = serde_json::to_string(&req).unwrap();
        match dispatch_line_with(&ctx, &line).await {
            DispatchResult::Unary(resp) => resp,
            DispatchResult::Stream { .. } => panic!("expected unary response"),
        }
    }

    async fn seed_session(&self, id: &str) -> SessionBrief {
        self.galley
            .create_session(
                CreateSessionInput {
                    id: id.to_string(),
                    title: "seed".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(RuntimeKind::External),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin {
                    via: OriginVia::Cli,
                    supervisor: None,
                    reason: None,
                },
            )
            .await
            .expect("seed session")
    }
}

fn req(command: &str, args: Value) -> Value {
    json!({ "command": command, "args": args, "schemaVersion": 1, "requestId": "t1" })
}

// ---------------- session.send ----------------

#[tokio::test]
async fn session_send_dispatched_persists_and_emits() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-send").await;

    let resp = h
        .dispatch(req(
            "session.send",
            json!({"sessionId": "s-send", "content": "hello runner"}),
        ))
        .await;

    assert!(resp.ok, "expected ok, got {resp:?}");
    let result = resp.result.unwrap();
    assert_eq!(result["dispatch"], "dispatched");
    // Persisted: the message row exists with the sent content.
    assert_eq!(result["message"]["content"], "hello runner");
    // Dispatched: the fake runner saw exactly one UserMessage command.
    let sent = h.runner.sent_commands.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "s-send");
    // Emitted: the GUI mirror event fired with the same dispatch status.
    let payload = h
        .notifier
        .payload_of("user-message-persisted")
        .expect("user-message-persisted emitted");
    assert_eq!(payload["dispatch"], "dispatched");
    assert_eq!(payload["sessionId"], "s-send");
}

#[tokio::test]
async fn session_send_runner_gone_is_tolerant_and_still_emits() {
    // The send contract: dispatch failure is NOT fatal — success envelope
    // with dispatch=persisted_only, and the persisted-row emit still fires
    // (the invariant ADR-0002 calls out per handler).
    let h = Harness::new(FakeRunner::send_fails_process_gone()).await;
    h.seed_session("s-gone").await;

    let resp = h
        .dispatch(req(
            "session.send",
            json!({"sessionId": "s-gone", "content": "saved anyway"}),
        ))
        .await;

    assert!(resp.ok, "send must tolerate a gone runner: {resp:?}");
    assert_eq!(resp.result.as_ref().unwrap()["dispatch"], "persisted_only");
    let payload = h.notifier.payload_of("user-message-persisted").unwrap();
    assert_eq!(payload["dispatch"], "persisted_only");
}

#[tokio::test]
async fn session_send_unknown_session_is_not_found_and_silent() {
    let h = Harness::new(FakeRunner::default()).await;

    let resp = h
        .dispatch(req(
            "session.send",
            json!({"sessionId": "s-nope", "content": "x"}),
        ))
        .await;

    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("not_found"));
    // Nothing persisted → nothing emitted.
    assert!(h.notifier.names().is_empty(), "no emit on failed persist");
}

// ---------------- session.checkpoint ----------------

#[tokio::test]
async fn session_checkpoint_persists_system_row_never_dispatches() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-cp").await;

    let resp = h
        .dispatch(req(
            "session.checkpoint",
            json!({"sessionId": "s-cp", "content": "阶段小结"}),
        ))
        .await;

    assert!(resp.ok, "{resp:?}");
    assert_eq!(resp.result.as_ref().unwrap()["dispatch"], "persisted_only");
    // Checkpoint never touches the runner.
    assert!(h.runner.sent_commands.lock().unwrap().is_empty());
    assert!(h.notifier.payload_of("user-message-persisted").is_some());
}

// ---------------- session.new (the rollback-narration branches) ----------------

fn session_new_req(h_dir: &std::path::Path) -> Value {
    // External runtime so spawn-args preparation needs no AppHandle:
    // gaPath/bridgeCwd must be real directories (validated before spawn).
    req(
        "session.new",
        json!({"task": "audit the repo", "runtimeKind": "external"}),
    )
    .as_object()
    .cloned()
    .map(|o| {
        let _ = h_dir; // pref carries the dirs; args stay minimal
        Value::Object(o)
    })
    .unwrap()
}

async fn seed_ga_config(h: &Harness, dir: &std::path::Path) {
    h.galley
        .set_pref_json(
            "ga_config",
            json!({
                "gaPath": dir.to_str().unwrap(),
                "bridgeCwd": dir.to_str().unwrap(),
                "python": "python3",
            }),
        )
        .await
        .expect("seed ga_config");
}

#[tokio::test]
async fn session_new_success_creates_spawns_and_narrates_dispatched() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(FakeRunner::default()).await;
    seed_ga_config(&h, dir.path()).await;

    let resp = h.dispatch(session_new_req(dir.path())).await;

    assert!(resp.ok, "{resp:?}");
    let result = resp.result.unwrap();
    assert_eq!(result["dispatch"], "dispatched");
    let sid = result["session"]["id"].as_str().unwrap().to_string();

    // Event choreography, in order: sidebar insert → runner up → message narration.
    let names = h.notifier.names();
    assert_eq!(
        names,
        vec![
            "session-created-external",
            "runner-spawned-external",
            "user-message-persisted"
        ],
        "event order is part of the GUI contract"
    );
    assert_eq!(
        h.notifier.payload_of("user-message-persisted").unwrap()["dispatch"],
        "dispatched"
    );
    // The first user message reached the (fake) bridge.
    let sent = h.runner.sent_commands.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, sid);
}

#[tokio::test]
async fn session_new_spawn_failure_commits_rows_and_narrates_spawn_failed() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(FakeRunner::spawn_fails(RunnerSpawnError::SpawnIo {
        detail: "fork failed".into(),
    }))
    .await;
    seed_ga_config(&h, dir.path()).await;

    let resp = h.dispatch(session_new_req(dir.path())).await;

    // Contract: spawn failure AFTER commit is fatal (runner_error), but
    // the session + message rows survive and the GUI is told the truth.
    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("runner_error"));
    let names = h.notifier.names();
    assert!(names.contains(&"session-created-external".to_string()));
    let payload = h.notifier.payload_of("user-message-persisted").unwrap();
    assert_eq!(payload["dispatch"], "spawn_failed");
    // Rows committed: the created session is listable.
    let sessions = h
        .galley
        .list_sessions(Default::default())
        .await
        .expect("list");
    assert_eq!(sessions.len(), 1, "session row survives spawn failure");
}

#[tokio::test]
async fn session_new_subscribe_race_narrates_spawn_failed() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(FakeRunner::subscribe_none()).await;
    seed_ga_config(&h, dir.path()).await;

    let resp = h.dispatch(session_new_req(dir.path())).await;

    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("runner_error"));
    assert!(resp
        .message
        .as_deref()
        .unwrap_or("")
        .contains("subscribe failed after spawn"));
    assert_eq!(
        h.notifier.payload_of("user-message-persisted").unwrap()["dispatch"],
        "spawn_failed"
    );
}

#[tokio::test]
async fn session_new_first_dispatch_failure_narrates_spawn_failed_after_runner_up() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(FakeRunner::send_fails_process_gone()).await;
    seed_ga_config(&h, dir.path()).await;

    let resp = h.dispatch(session_new_req(dir.path())).await;

    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("runner_error"));
    // The runner DID come up — GUI saw it — then the first message failed.
    let names = h.notifier.names();
    assert!(names.contains(&"runner-spawned-external".to_string()));
    assert_eq!(
        h.notifier.payload_of("user-message-persisted").unwrap()["dispatch"],
        "spawn_failed"
    );
}

// ---------------- archive / restore / move ----------------

#[tokio::test]
async fn session_archive_restore_move_emit_their_events() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-arc").await;

    let resp = h
        .dispatch(req("session.archive", json!({"sessionId": "s-arc"})))
        .await;
    assert!(resp.ok, "{resp:?}");
    assert!(h.notifier.payload_of("session-archived-external").is_some());

    let resp = h
        .dispatch(req("session.restore", json!({"sessionId": "s-arc"})))
        .await;
    assert!(resp.ok, "{resp:?}");
    assert!(h
        .notifier
        .payload_of("session-unarchived-external")
        .is_some());

    let resp = h
        .dispatch(req("session.move", json!({"sessionId": "s-arc"})))
        .await;
    assert!(resp.ok, "{resp:?}");
    let payload = h.notifier.payload_of("session-moved-external").unwrap();
    assert_eq!(payload["via"], "session.move");
}

// ---------------- llm.set ----------------

#[tokio::test]
async fn llm_set_process_gone_persists_and_emits_updated() {
    let h = Harness::new(FakeRunner::send_fails_process_gone()).await;
    h.seed_session("s-llm").await;
    h.galley
        .set_pref_json(
            "llm_list",
            json!([{"index": 0, "displayName": "GLM 5.1", "key": "glm-5.1"}]),
        )
        .await
        .unwrap();

    let resp = h
        .dispatch(req(
            "llm.set",
            json!({"sessionId": "s-llm", "llmName": "GLM 5.1"}),
        ))
        .await;

    assert!(resp.ok, "llm.set tolerates a gone runner: {resp:?}");
    assert_eq!(resp.result.as_ref().unwrap()["dispatch"], "persisted_only");
    let payload = h.notifier.payload_of("session-updated-external").unwrap();
    assert_eq!(payload["via"], "llm.set");
}
