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
    CreateSessionInput, GalleyApi, ManagedModelAuthKind, ManagedModelProtocol, Origin, OriginVia,
    RuntimeKind, SessionBrief, SessionId,
};
use galley_core_lib::credential_store;
use galley_core_lib::db::{
    SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata,
};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunSignal, RunState, RunnerManager, RunnerSpawnError, SendCommandError,
    ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tokio::sync::{broadcast, mpsc};

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
const MIG_039: &str = include_str!("../migrations/039_goal_v2.sql");
const MIG_040: &str = include_str!("../migrations/040_session_reasoning_effort.sql");
const MIG_042: &str = include_str!("../migrations/042_managed_model_advanced_layers.sql");

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
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_038, MIG_039, MIG_040, MIG_042,
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
    /// What `try_reserve_run` answers (Goal-turn idle gate). Default true
    /// mirrors the trait default so pre-gate tests keep their behavior.
    reserve_result: bool,
    /// Sessions whose run-gate reservation was released after a failure.
    released: Mutex<Vec<String>>,
    /// Fixed `run_state` answer; None falls back to a running-derived one.
    run_state: Option<RunState>,
}

impl Default for FakeRunner {
    fn default() -> Self {
        Self {
            spawn_result: Mutex::new(Some(Ok(4242))),
            send_result: Mutex::new(Some(Ok(()))),
            subscribe_some: true,
            running: true,
            sent_commands: Mutex::new(Vec::new()),
            reserve_result: true,
            released: Mutex::new(Vec::new()),
            run_state: None,
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
    fn reserve_busy() -> Self {
        Self {
            reserve_result: false,
            ..Self::default()
        }
    }
    fn with_run_state(state: RunState) -> Self {
        Self {
            run_state: Some(state),
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
    async fn try_reserve_run(&self, _session_id: &str) -> bool {
        self.reserve_result
    }
    async fn queue_release_run(&self, session_id: &str) {
        self.released.lock().unwrap().push(session_id.to_string());
    }
    async fn run_state(&self, _session_id: &str) -> RunState {
        self.run_state.clone().unwrap_or(RunState {
            runner_alive: self.running,
            agent_running: self.running,
            ..RunState::default()
        })
    }
}

// ---------------- harness ----------------

#[tokio::test]
async fn git_review_uses_shared_api_and_existing_error_categories() {
    use galley_core_lib::api::GalleyApi;
    use galley_core_lib::protocol::{GitReviewRequest, SocketCommand};
    let h = Harness::new(FakeRunner::default()).await;
    let dir = tempfile::tempdir().unwrap();
    let output = std::process::Command::new("git")
        .arg("init")
        .arg(dir.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    std::fs::write(dir.path().join("report.md"), "# Report").unwrap();
    let args = GitReviewRequest::List {
        path: dir.path().to_string_lossy().into(),
        base: None,
    };
    let response = h
        .dispatch(req(
            GitReviewRequest::NAME,
            serde_json::to_value(&args).unwrap(),
        ))
        .await;
    assert!(response.ok, "{response:?}");
    assert_eq!(
        response.result.unwrap(),
        serde_json::to_value(h.galley.review_git(args).await.unwrap()).unwrap()
    );
    let response = h
        .dispatch(req(
            GitReviewRequest::NAME,
            json!({"action": "list", "path": "relative"}),
        ))
        .await;
    assert_eq!(
        serde_json::to_value(response).unwrap()["error"],
        "invalid_args"
    );
    let response = h
        .dispatch(req(
            GitReviewRequest::NAME,
            json!({"action": "checkout", "path": dir.path()}),
        ))
        .await;
    assert_eq!(
        serde_json::to_value(response).unwrap()["error"],
        "invalid_args"
    );
}

#[tokio::test]
async fn local_file_access_uses_shared_api_and_existing_error_categories() {
    use galley_core_lib::api::GalleyApi;
    use galley_core_lib::local_file::{LocalFileAction, LocalFileRequest};
    use galley_core_lib::protocol::SocketCommand;
    let h = Harness::new(FakeRunner::default()).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report.md");
    std::fs::write(&path, "# Report").unwrap();
    let args = LocalFileRequest {
        path: path.to_string_lossy().into_owned(),
        action: LocalFileAction::Read,
    };
    let response = h
        .dispatch(req(
            LocalFileRequest::NAME,
            serde_json::to_value(&args).unwrap(),
        ))
        .await;
    assert!(response.ok, "{response:?}");
    let direct = h.galley.access_local_file(args).await.unwrap();
    assert_eq!(
        response.result.unwrap(),
        serde_json::to_value(direct).unwrap()
    );
    std::fs::remove_file(&path).unwrap();
    let response = h
        .dispatch(req(
            LocalFileRequest::NAME,
            json!({"path": path, "action": "read"}),
        ))
        .await;
    assert!(!response.ok);
    assert_eq!(
        serde_json::to_value(response).unwrap()["error"],
        "not_found"
    );
    let response = h
        .dispatch(req(
            LocalFileRequest::NAME,
            json!({"path": "relative.md", "action": "read"}),
        ))
        .await;
    assert_eq!(
        serde_json::to_value(response).unwrap()["error"],
        "invalid_args"
    );
}

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

// ---------------- session.send × the real queue (galley#30) ----------------

/// A Python 3 for the mock bridge below; `None` skips the test (same
/// policy and candidates as `runner_manager_test.rs`).
fn mock_python() -> Option<String> {
    [
        "/usr/bin/python3",
        "/usr/local/bin/python3",
        "/opt/homebrew/bin/python3",
        "python3",
        "python",
    ]
    .into_iter()
    .find(|candidate| {
        std::process::Command::new(candidate)
            .args([
                "-c",
                "import sys; raise SystemExit(0 if sys.version_info.major >= 3 else 1)",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
    .map(str::to_string)
}

/// Mock `runner.workbench_bridge`: its first run ends on an `ask_user`
/// question (`EXITED`) after a beat — long enough for a second send to
/// land while that run is open — and every later run completes at once.
fn write_ask_user_bridge(dir: &std::path::Path) {
    let runner_dir = dir.join("runner");
    std::fs::create_dir_all(&runner_dir).expect("mkdir runner");
    std::fs::write(runner_dir.join("__init__.py"), "").expect("write __init__");
    let script = r#"
import argparse, json, os, sys, time

parser = argparse.ArgumentParser()
parser.add_argument("--ga-path", required=True)
parser.add_argument("--session-id", required=True)
args, _ = parser.parse_known_args()

def emit(obj):
    obj["sessionId"] = args.session_id
    obj["timestamp"] = "2026-10-01T00:00:00+00:00"
    print(json.dumps(obj), flush=True)

emit({"kind": "ready", "protocolVersion": "0.1", "gaCommit": "mock",
      "gaCommitDate": "2026-10-01T00:00:00+00:00", "gaPath": args.ga_path,
      "llmName": "mock-llm", "cwd": os.getcwd(), "pid": os.getpid(),
      "availableLLMs": []})
runs = 0
for line in sys.stdin:
    try:
        cmd = json.loads(line)
    except ValueError:
        continue
    if cmd.get("kind") == "shutdown":
        break
    if cmd.get("kind") != "user_message":
        continue
    runs += 1
    if runs == 1:
        time.sleep(0.5)
        emit({"kind": "ask_user", "question": "which one?", "candidates": []})
        result = "EXITED"
    else:
        result = "CURRENT_TASK_DONE"
    emit({"kind": "run_complete", "exitReason": {"result": result, "data": None},
          "finalContent": "", "totalTurns": 1})
"#;
    std::fs::write(runner_dir.join("workbench_bridge.py"), script).expect("write mock");
}

/// Stand-in for the global drain task: wait for the forwarder's next
/// `RunComplete` signal (skipping `UserRunStarted`).
async fn next_run_complete(signals: &mut mpsc::UnboundedReceiver<RunSignal>) -> RunSignal {
    loop {
        let signal = tokio::time::timeout(std::time::Duration::from_secs(5), signals.recv())
            .await
            .expect("run_complete within 5s")
            .expect("signal channel open");
        if matches!(signal, RunSignal::RunComplete { .. }) {
            return signal;
        }
    }
}

/// galley#30 end to end, through the real RunnerManager + forwarder: a
/// child's run ends on `ask_user` with a supervisor message already held
/// behind it. The next `session.send` must dispatch as the answer (it
/// used to queue behind the hold forever), and the held message drains
/// once the answer's run completes. `session.run_state` shows the
/// question and the last exit reason along the way.
#[tokio::test]
async fn session_send_answers_a_pending_question_ahead_of_held_messages() {
    let Some(python) = mock_python() else {
        eprintln!("[skip] no python on this machine");
        return;
    };
    let bridge = tempfile::tempdir().expect("tempdir");
    write_ask_user_bridge(bridge.path());
    let manager = RunnerManager::new();
    let (signal_tx, mut signals) = mpsc::unbounded_channel();
    manager.set_run_signal(signal_tx);
    manager
        .spawn(
            SpawnArgs {
                python,
                ga_path: bridge.path().to_path_buf(),
                session_id: "s-ask".into(),
                cwd: None,
                workspace_root: None,
                bridge_cwd: bridge.path().to_path_buf(),
                llm_index: None,
                llm_key: None,
                reasoning_effort: None,
                env: vec![],
            },
            None,
        )
        .await
        .expect("spawn mock bridge");

    // The harness supplies the DB + notifier; the runner is the real one.
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-ask").await;
    let ctx = HandlerCtx {
        db: &h.db,
        runner: &manager,
        notifier: h.notifier.clone(),
        app: None,
    };
    let dispatch = |request: Value| {
        let line = serde_json::to_string(&request).unwrap();
        let ctx = &ctx;
        async move {
            match dispatch_line_with(ctx, &line).await {
                DispatchResult::Unary(resp) => resp,
                DispatchResult::Stream { .. } => panic!("expected unary response"),
            }
        }
    };
    let send = |content: &str| {
        dispatch(req(
            "session.send",
            json!({"sessionId": "s-ask", "content": content}),
        ))
    };
    let run_state = || dispatch(req("session.run_state", json!({"sessionId": "s-ask"})));

    let first = send("start").await;
    assert_eq!(first.result.unwrap()["dispatch"], "dispatched");
    let held = send("queued before the question").await;
    assert_eq!(held.result.unwrap()["dispatch"], "queued");

    // The first run ends on the question: the drain holds the queue.
    let signal = next_run_complete(&mut signals).await;
    assert!(manager.queue_take_next(&signal).await.is_none());
    let live = run_state().await.result.unwrap();
    assert_eq!(live["askPending"], true);
    assert_eq!(live["lastExit"], "EXITED");
    assert_eq!(live["openRun"], false);
    assert_eq!(live["queuedCount"], 1);

    // The next send is the answer: dispatched now, ahead of the held one.
    let answer = send("the answer").await.result.unwrap();
    assert_eq!(answer["dispatch"], "dispatched");
    assert_eq!(answer["message"]["content"], "the answer");
    assert_eq!(run_state().await.result.unwrap()["askPending"], false);

    // The answer's run completes; the held message drains next.
    let signal = next_run_complete(&mut signals).await;
    let next = manager.queue_take_next(&signal).await.expect("held item");
    assert_eq!(next.text, "queued before the question");
    let live = run_state().await.result.unwrap();
    assert_eq!(live["lastExit"], "CURRENT_TASK_DONE");
    assert_eq!(live["queuedCount"], 0);

    manager
        .shutdown_all(std::time::Duration::from_millis(500))
        .await;
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

/// The external cache as current GUIs write it: every entry carries both
/// `name` and `displayName` (a serde alias between them used to fail the
/// whole cache with `duplicate field`). Either name resolves.
#[tokio::test]
async fn llm_set_external_resolves_gui_cache_with_name_and_display_name() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-ext").await;
    h.galley
        .set_pref_json(
            "llm_list",
            json!([
                {"displayName": "NativeOAI/gpt-6-astra", "index": 0, "isCurrent": false,
                 "key": "NativeOAI/gpt-6-astra", "name": "NativeOAI/gpt-6-astra"},
                {"displayName": "GLM Flash", "index": 1, "isCurrent": true,
                 "key": "NativeClaude/glm-5.3-flash", "name": "NativeClaude/glm-5.3-flash"}
            ]),
        )
        .await
        .unwrap();

    for llm_name in ["GLM FLASH", "nativeclaude/glm-5.3-flash"] {
        let resp = h
            .dispatch(req(
                "llm.set",
                json!({"sessionId": "s-ext", "llmName": llm_name}),
            ))
            .await;
        assert!(resp.ok, "{llm_name} must resolve: {resp:?}");
        let session = &resp.result.as_ref().unwrap()["session"];
        assert_eq!(session["selectedLlmKey"], "NativeClaude/glm-5.3-flash");
        assert_eq!(session["selectedLlmIndex"], 1);
        assert_eq!(session["selectedLlmDisplayName"], "GLM Flash");
    }

    let resp = h
        .dispatch(req(
            "llm.set",
            json!({"sessionId": "s-ext", "llmName": "gpt-6.1-sol"}),
        ))
        .await;
    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
}

async fn seed_managed_provider(galley: &SqliteGalley, id: &str, with_secret: bool) {
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

async fn seed_managed_model(
    galley: &SqliteGalley,
    id: &str,
    provider_id: &str,
    display_name: &str,
    model: &str,
) {
    galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: id.into(),
            provider_id: provider_id.into(),
            display_name: display_name.into(),
            model: model.into(),
            preset_options: None,
            advanced_overrides: None,
            make_default: false,
        })
        .await
        .unwrap();
}

/// `galley llm list --runtime=managed` prints `list_managed_llm_choices`;
/// every name it prints must resolve through `llm.set` to the same
/// key / index, and a model the list skips must not resolve.
#[tokio::test]
async fn llm_set_resolves_every_managed_llm_list_name() {
    let h = Harness::new(FakeRunner::default()).await;
    seed_managed_provider(&h.galley, "mp_key", true).await;
    seed_managed_provider(&h.galley, "mp_nokey", false).await;
    // The first model saved becomes the default (sort order 0).
    seed_managed_model(&h.galley, "mm_sol", "mp_key", "GPT 6.1 Sol", "gpt-6.1-sol").await;
    seed_managed_model(&h.galley, "mm_nokey", "mp_nokey", "No Key", "nokey-1").await;
    seed_managed_model(
        &h.galley,
        "mm_flash",
        "mp_key",
        "GLM Flash",
        "glm-5.3-flash",
    )
    .await;
    h.galley
        .create_session(
            CreateSessionInput {
                id: "s-managed".into(),
                title: "seed".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
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
        .unwrap();

    let choices = h.galley.list_managed_llm_choices().await.unwrap();
    let listed: Vec<(u32, &str, &str)> = choices
        .iter()
        .map(|c| (c.index, c.key.as_str(), c.display_name.as_str()))
        .collect();
    assert_eq!(
        listed,
        vec![(0, "mm_sol", "GPT 6.1 Sol"), (1, "mm_flash", "GLM Flash")]
    );

    for choice in &choices {
        let resp = h
            .dispatch(req(
                "llm.set",
                json!({"sessionId": "s-managed", "llmName": choice.display_name.to_uppercase()}),
            ))
            .await;
        assert!(resp.ok, "{} must resolve: {resp:?}", choice.display_name);
        let session = &resp.result.as_ref().unwrap()["session"];
        assert_eq!(session["selectedLlmKey"], choice.key);
        assert_eq!(session["selectedLlmIndex"], choice.index);
        assert_eq!(session["selectedLlmDisplayName"], choice.display_name);
        let sent = h.runner.sent_commands.lock().unwrap();
        let (_, last) = sent.last().expect("SetLlm dispatched");
        assert!(
            last.contains(&format!("llm_index: {}", choice.index)),
            "runner index must match the listed index: {last}"
        );
    }

    let resp = h
        .dispatch(req(
            "llm.set",
            json!({"sessionId": "s-managed", "llmName": "No Key"}),
        ))
        .await;
    assert!(!resp.ok, "a model llm list skips must not resolve");
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
}

// ---------------- schemaVersion 2 policy + goal.* (Goal v2) ----------------

fn req_v2(command: &str, args: Value) -> Value {
    json!({ "command": command, "args": args, "schemaVersion": 2, "requestId": "t2" })
}

#[tokio::test]
async fn schema_v1_still_serves_unchanged_commands() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s1").await;
    let resp = h
        .dispatch(req(
            "session.send",
            json!({"sessionId": "s1", "content": "hi"}),
        ))
        .await;
    assert!(resp.ok, "v1 request on an unchanged command: {resp:?}");
}

#[tokio::test]
async fn schema_v1_sees_the_goal_family_as_unknown() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s1").await;
    for (command, args) in [
        ("goal.start", json!({"sessionId": "s1", "objective": "o"})),
        ("goal.active", json!({})),
        // Retired v1 names are gone under every version.
        (
            "session.goal_solo_turn",
            json!({"sessionId": "s1", "dispatchContent": "x"}),
        ),
        ("session.new_goal_worker", json!({"taskTemplate": "x"})),
    ] {
        let resp = h.dispatch(req(command, args)).await;
        assert!(!resp.ok, "{command} under v1 must fail");
        assert_eq!(
            resp.error.as_deref(),
            Some("unknown_command"),
            "{command}: {resp:?}"
        );
    }
    let resp = h
        .dispatch(req_v2("session.goal_solo_turn", json!({"sessionId": "s1"})))
        .await;
    assert_eq!(
        resp.error.as_deref(),
        Some("unknown_command"),
        "retired name under v2 too"
    );
}

#[tokio::test]
async fn schema_outside_the_accepted_set_is_a_mismatch() {
    let h = Harness::new(FakeRunner::default()).await;
    let resp = h
        .dispatch(json!({ "command": "ping", "args": {}, "schemaVersion": 3, "requestId": "t3" }))
        .await;
    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("schema_mismatch"));
}

#[tokio::test]
async fn goal_start_status_active_stop_round_trip() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-goal").await;

    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "s-goal", "objective": "Ship it", "budgetSeconds": 1800,
                   "supervisor": "sup-1", "reason": "user asked"}),
        ))
        .await;
    assert!(resp.ok, "goal.start: {resp:?}");
    let result = resp.result.clone().unwrap();
    assert_eq!(result["dispatch"], "dispatched");
    assert_eq!(result["goal"]["status"], "active");
    assert_eq!(result["goal"]["sessionId"], "s-goal");
    assert_eq!(result["goal"]["budgetSeconds"], 1800);
    assert_eq!(result["goal"]["origin"]["supervisor"], "sup-1");
    assert_eq!(result["message"]["content"], "Ship it");
    assert_eq!(result["message"]["goalId"], result["goal"]["id"]);
    let goal_id = result["goal"]["id"].as_str().unwrap().to_string();
    // The opening turn went to the runner as the wrapped prompt, not the raw row.
    let sent = h.runner.sent_commands.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].1.contains("<objective>"), "{}", sent[0].1);
    drop(sent);
    // The objective row is announced to the GUI like a CLI send would be.
    let persisted = h
        .notifier
        .payload_of("user-message-persisted")
        .expect("user-message-persisted emitted");
    assert_eq!(persisted["message"]["goalId"], goal_id);
    assert!(h.notifier.names().iter().any(|n| n == "goal-updated"));

    let resp = h
        .dispatch(req_v2("goal.status", json!({"goalId": goal_id})))
        .await;
    assert!(resp.ok, "goal.status: {resp:?}");
    assert_eq!(resp.result.unwrap()["goal"]["id"], goal_id);

    let resp = h.dispatch(req_v2("goal.active", json!({}))).await;
    assert!(resp.ok, "goal.active: {resp:?}");
    let list = resp.result.unwrap();
    assert_eq!(list.as_array().map(|a| a.len()), Some(1));
    assert_eq!(list[0]["id"], goal_id);

    // A second open goal on the same session is refused with the id of the first.
    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "s-goal", "objective": "Another"}),
        ))
        .await;
    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    assert!(resp.message.as_deref().unwrap_or("").contains(&goal_id));

    let resp = h
        .dispatch(req_v2(
            "goal.stop",
            json!({"goalId": goal_id, "reason": "enough"}),
        ))
        .await;
    assert!(resp.ok, "goal.stop: {resp:?}");
    assert_eq!(resp.result.unwrap()["goal"]["status"], "stopped");
    let resp = h.dispatch(req_v2("goal.active", json!({}))).await;
    assert_eq!(resp.result.unwrap().as_array().map(|a| a.len()), Some(0));
}

#[tokio::test]
async fn goal_extend_raises_the_ceiling_and_refuses_open_ended_goals() {
    let h = Harness::new(FakeRunner::default()).await;
    h.seed_session("s-ext").await;
    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "s-ext", "objective": "o", "budgetSeconds": 600}),
        ))
        .await;
    let goal_id = resp.result.unwrap()["goal"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let resp = h
        .dispatch(req_v2(
            "goal.extend",
            json!({"goalId": goal_id, "extraSeconds": 1800}),
        ))
        .await;
    assert!(resp.ok, "goal.extend: {resp:?}");
    let goal = resp.result.unwrap();
    assert_eq!(goal["goal"]["budgetSeconds"], 2400);
    assert_eq!(goal["goal"]["status"], "active");

    h.seed_session("s-open").await;
    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "s-open", "objective": "o"}),
        ))
        .await;
    let open_id = resp.result.unwrap()["goal"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let resp = h
        .dispatch(req_v2(
            "goal.extend",
            json!({"goalId": open_id, "extraSeconds": 60}),
        ))
        .await;
    assert_eq!(resp.error.as_deref(), Some("invalid_args"), "{resp:?}");
    let resp = h
        .dispatch(req_v2(
            "goal.extend",
            json!({"goalId": "goal_missing", "extraSeconds": 60}),
        ))
        .await;
    assert_eq!(resp.error.as_deref(), Some("not_found"), "{resp:?}");
}

#[tokio::test]
async fn goal_start_on_a_busy_session_is_invalid_args_with_no_side_effects() {
    let h = Harness::new(FakeRunner::reserve_busy()).await;
    h.seed_session("s-busy").await;
    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "s-busy", "objective": "o"}),
        ))
        .await;
    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    assert!(h.runner.sent_commands.lock().unwrap().is_empty());
    assert!(h.galley.list_active_goals().await.unwrap().is_empty());
    let rows = h
        .galley
        .session_messages_including_internal(SessionId("s-busy".into()), None)
        .await
        .unwrap();
    assert!(rows.is_empty(), "busy must persist nothing");
}

#[tokio::test]
async fn goal_start_unknown_session_is_not_found_and_goal_status_unknown_id_too() {
    let h = Harness::new(FakeRunner::default()).await;
    let resp = h
        .dispatch(req_v2(
            "goal.start",
            json!({"sessionId": "nope", "objective": "o"}),
        ))
        .await;
    assert_eq!(resp.error.as_deref(), Some("not_found"), "{resp:?}");
    let resp = h
        .dispatch(req_v2("goal.status", json!({"goalId": "goal_missing"})))
        .await;
    assert_eq!(resp.error.as_deref(), Some("not_found"), "{resp:?}");
}

// ---------------- session.run_state ----------------

#[tokio::test]
async fn session_run_state_reports_manager_truth() {
    let h = Harness::new(FakeRunner::with_run_state(RunState {
        runner_alive: true,
        agent_running: false,
        open_run: true,
        queued_count: 2,
        ask_pending: false,
        last_exit: Some("MAX_TURNS_EXCEEDED".into()),
    }))
    .await;
    h.seed_session("s-live").await;

    let resp = h
        .dispatch(req("session.run_state", json!({"sessionId": "s-live"})))
        .await;

    assert!(resp.ok, "expected ok, got {resp:?}");
    let result = resp.result.unwrap();
    assert_eq!(result["sessionId"], "s-live");
    assert_eq!(result["runnerAlive"], true);
    assert_eq!(result["agentRunning"], false);
    assert_eq!(result["openRun"], true);
    assert_eq!(result["queuedCount"], 2);
    // galley#30: additive fields, passed through verbatim.
    assert_eq!(result["askPending"], false);
    assert_eq!(result["lastExit"], "MAX_TURNS_EXCEEDED");
}

#[tokio::test]
async fn sessions_run_state_answers_for_requested_ids_with_busy_verdict() {
    let h = Harness::new(FakeRunner::with_run_state(RunState {
        runner_alive: true,
        agent_running: false,
        open_run: true,
        queued_count: 0,
        ask_pending: true,
        last_exit: None,
    }))
    .await;

    // No DB existence check: a `sessions list` caller passes its whole
    // page, including ids Core has never spawned.
    let resp = h
        .dispatch(req(
            "sessions.run_state",
            json!({"sessionIds": ["s-a", "s-never-spawned"]}),
        ))
        .await;

    assert!(resp.ok, "expected ok, got {resp:?}");
    let sessions = resp.result.unwrap()["sessions"].as_array().unwrap().clone();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0]["sessionId"], "s-a");
    assert_eq!(sessions[0]["openRun"], true);
    assert_eq!(sessions[0]["busy"], true);
    assert_eq!(sessions[0]["askPending"], true);
    // No run has completed: an explicit null, not an absent key.
    assert_eq!(sessions[0].get("lastExit"), Some(&Value::Null));
    assert_eq!(sessions[1]["sessionId"], "s-never-spawned");
}

#[tokio::test]
async fn sessions_run_state_without_ids_scopes_to_known_sessions() {
    // The fake holds no live state, so the unscoped form is empty —
    // the same answer a fresh Core gives before any runner spawned.
    let h = Harness::new(FakeRunner::default()).await;

    let resp = h.dispatch(req("sessions.run_state", json!({}))).await;

    assert!(resp.ok, "expected ok, got {resp:?}");
    assert_eq!(resp.result.unwrap()["sessions"], json!([]));
}

#[tokio::test]
async fn session_run_state_unknown_session_is_not_found() {
    let h = Harness::new(FakeRunner::default()).await;

    let resp = h
        .dispatch(req("session.run_state", json!({"sessionId": "s-nope"})))
        .await;

    assert!(!resp.ok);
    assert_eq!(resp.error.as_deref(), Some("not_found"));
}
