//! Socket `session send` with `ensureRunner` (2026-10-16, the consequence
//! ADR-0003 named), driven from the request line through
//! `dispatch_line_with` with an in-memory database, a scripted runner
//! registry with the run gate's rules, and an external-runtime session
//! (headless spawn resolution needs no app):
//!
//! - a cold session: a runner is started on the shared path, the history
//!   replayed before the message, and the message dispatched;
//! - without the flag, the same send is `persisted_only`, as ever;
//! - an asking session is answered after a cold start, past the messages
//!   its question holds (galley#30 unchanged);
//! - a live runner is used as it is;
//! - a runner that cannot start, or whose history cannot be restored,
//!   leaves the message saved only, never dispatched to a runner without
//!   its history.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, RuntimeKind, SessionId,
};
use galley_core_lib::db::{PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::{ErrorEvent, HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunState,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

const SID: &str = "s-cold";

// ---------------- fixtures ----------------

async fn fresh() -> SqliteGalley {
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
    SqliteGalley::from_pool(pool)
}

/// An attached-runtime session with one exchange, and the `ga_config`
/// headless spawn resolution reads (real directories).
async fn session_with_history(dir: &std::path::Path, reply_tool_calls: Value) -> SqliteGalley {
    let galley = fresh().await;
    galley
        .set_pref_json(
            "ga_config",
            json!({
                "gaPath": dir.to_str().unwrap(),
                "bridgeCwd": dir.to_str().unwrap(),
                "python": "python3",
            }),
        )
        .await
        .expect("ga_config");
    galley
        .create_session(
            CreateSessionInput {
                id: SID.into(),
                title: "冷会话".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::External),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::cli(None, None),
        )
        .await
        .expect("session");
    let row = galley
        .send_message(
            SessionId(SID.into()),
            "订周五的机票".into(),
            Origin::cli(None, None),
        )
        .await
        .expect("user row");
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(SID.into()),
            turn_index: row.turn_index.unwrap(),
            content: "要哪家航空？".into(),
            tool_calls: Some(reply_tool_calls.to_string()),
            tool_results: None,
            thinking: None,
            final_answer: Some("要哪家航空？".into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
    galley
        .bump_session_after_turn(SessionId(SID.into()), None, None, false)
        .await
        .expect("bump");
    galley
}

fn history() -> Vec<Value> {
    vec![
        json!({"role": "user", "content": "订周五的机票"}),
        json!({"role": "assistant", "content": "要哪家航空？"}),
    ]
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
    fn named(&self, name: &str) -> Vec<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, p)| p.clone())
            .collect()
    }
}

// ---------------- scripted runner registry ----------------

#[derive(Debug, Default, Clone)]
struct Gate {
    open_run: bool,
    ask_pending: bool,
    queued: usize,
}

/// A spawn registers a live runner that reports `ready` at once (unless
/// `fail_spawn`); `load_history` is loaded (or refused, `refuse_history`);
/// a delivered `user_message` opens the run gate and clears a question;
/// an offer or a reservation dispatches now only with no run open and
/// nothing queued, or a question pending (the manager's rule).
#[derive(Default)]
struct Runner {
    fail_spawn: AtomicBool,
    refuse_history: AtomicBool,
    next_pid: AtomicU32,
    spawns: AtomicU32,
    alive: Mutex<HashMap<String, u32>>,
    confirmed: Mutex<HashMap<String, u32>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    gates: Mutex<HashMap<String, Gate>>,
    sent: Mutex<Vec<IpcCommand>>,
}

impl Runner {
    fn gate(&self) -> Gate {
        self.gates
            .lock()
            .unwrap()
            .get(SID)
            .cloned()
            .unwrap_or_default()
    }
    fn set_gate(&self, gate: Gate) {
        self.gates.lock().unwrap().insert(SID.into(), gate);
    }
    /// What reached the runner, in order: `load_history` with its
    /// messages, `user_message` with its text.
    fn log(&self) -> Vec<(String, Value)> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter_map(|cmd| match cmd {
                IpcCommand::LoadHistory(load) => {
                    Some(("load_history".into(), Value::Array(load.messages.clone())))
                }
                IpcCommand::UserMessage(m) => Some(("user_message".into(), json!(m.text))),
                IpcCommand::AskUserResponse(m) => Some(("ask_user_response".into(), json!(m.text))),
                _ => None,
            })
            .collect()
    }
    fn emit(&self, sid: &str, event: IpcEvent) {
        let tx = self.channels.lock().unwrap().get(sid).cloned();
        if let Some(tx) = tx {
            let _ = tx.send(BroadcastItem::Event(Box::new(event)));
        }
    }
    async fn spawn_inner(&self, args: SpawnArgs) -> Result<u32, RunnerSpawnError> {
        if self.fail_spawn.load(Ordering::SeqCst) {
            return Err(RunnerSpawnError::SpawnIo {
                detail: "fork failed".into(),
            });
        }
        self.spawns.fetch_add(1, Ordering::SeqCst);
        let sid = args.session_id.clone();
        let pid = 7000 + self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.alive.lock().unwrap().insert(sid.clone(), pid);
        self.confirmed.lock().unwrap().remove(&sid);
        self.ready.lock().unwrap().insert(sid.clone(), ready(&sid));
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid, tx);
        Ok(pid)
    }
}

fn ready(sid: &str) -> ReadySnapshot {
    ReadyEvent {
        session_id: sid.into(),
        protocol_version: "0.1".into(),
        ga_commit: "c".into(),
        ga_commit_date: "d".into(),
        ga_path: "/ga".into(),
        llm_name: "B/b".into(),
        cwd: "/".into(),
        pid: 77,
        available_llms: vec![],
        images_supported: true,
        reasoning_effort: None,
        configured_reasoning_effort: None,
        timestamp: "t".into(),
    }
}

fn opens_run(gate: &Gate) -> bool {
    !gate.open_run && (gate.queued == 0 || gate.ask_pending)
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn spawn_held(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        if !self.alive.lock().unwrap().contains_key(sid) {
            return Err(SendCommandError::ProcessGone {
                session_id: sid.to_string(),
            });
        }
        self.sent.lock().unwrap().push(cmd.clone());
        match cmd {
            IpcCommand::LoadHistory(_) if self.refuse_history.load(Ordering::SeqCst) => {
                let refused: ErrorEvent = serde_json::from_value(json!({
                    "sessionId": sid,
                    "message": "history refused",
                    "severity": "error",
                    "context": "load_history",
                    "timestamp": "t",
                }))
                .expect("error event");
                self.emit(sid, IpcEvent::Error(refused));
            }
            IpcCommand::LoadHistory(_) => self.emit(
                sid,
                IpcEvent::HistoryLoaded(HistoryLoadedEvent {
                    session_id: sid.into(),
                    message_count: 2,
                    timestamp: "t".into(),
                }),
            ),
            IpcCommand::UserMessage(m) if !is_side_question(&m.text) => {
                let mut gates = self.gates.lock().unwrap();
                let gate = gates.entry(sid.into()).or_default();
                gate.open_run = true;
                gate.ask_pending = false;
            }
            _ => {}
        }
        Ok(())
    }
    async fn subscribe(&self, sid: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        self.channels
            .lock()
            .unwrap()
            .get(sid)
            .map(broadcast::Sender::subscribe)
    }
    async fn pid(&self, sid: &str) -> Option<u32> {
        self.alive.lock().unwrap().get(sid).copied()
    }
    async fn agent_running(&self, _: &str) -> bool {
        false
    }
    async fn shutdown(&self, _: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
        Ok(())
    }
    async fn ready_snapshot(&self, sid: &str) -> Option<ReadySnapshot> {
        self.ready.lock().unwrap().get(sid).cloned()
    }
    async fn release_close(&self, sid: &str, pid: u32, confirmed: bool) -> Option<HeldClose> {
        if confirmed {
            self.confirmed.lock().unwrap().insert(sid.into(), pid);
        }
        None
    }
    async fn retire(&self, sid: &str, _pid: u32) -> bool {
        self.alive.lock().unwrap().remove(sid);
        self.ready.lock().unwrap().remove(sid);
        true
    }
    async fn history_confirmed(&self, sid: &str, pid: u32) -> bool {
        self.confirmed.lock().unwrap().get(sid) == Some(&pid)
            && self.alive.lock().unwrap().get(sid) == Some(&pid)
    }
    async fn queue_offer(&self, sid: &str, _text: String, _origin: Option<Origin>) -> QueueOffer {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if !opens_run(gate) {
            gate.queued += 1;
            return QueueOffer::Queued {
                queue_id: "q-1".into(),
                position: gate.queued - 1,
            };
        }
        gate.open_run = true;
        QueueOffer::DispatchNow
    }
    async fn queue_try_reserve(&self, sid: &str) -> bool {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if !opens_run(gate) {
            return false;
        }
        gate.open_run = true;
        true
    }
    async fn queue_release_run(&self, sid: &str) {
        if let Some(gate) = self.gates.lock().unwrap().get_mut(sid) {
            gate.open_run = false;
        }
    }
    async fn run_state(&self, sid: &str) -> RunState {
        let gate = self
            .gates
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default();
        RunState {
            runner_alive: self.alive.lock().unwrap().contains_key(sid),
            agent_running: false,
            open_run: gate.open_run,
            queued_count: gate.queued,
            ask_pending: gate.ask_pending,
            last_exit: None,
        }
    }
}

async fn send(
    galley: &SqliteGalley,
    runner: &Runner,
    rec: &Arc<Recorder>,
    args: Value,
) -> SocketResponse {
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner,
        notifier: rec.clone(),
        app: None,
    };
    let line = json!({
        "command": "session.send",
        "args": args,
        "schemaVersion": 3,
        "requestId": "t1",
    })
    .to_string();
    match dispatch_line_with(&ctx, &line).await {
        DispatchResult::Unary(resp) => resp,
        DispatchResult::Stream { .. } => panic!("expected a unary response"),
    }
}

fn dispatch_of(resp: &SocketResponse) -> &str {
    assert!(resp.ok, "{resp:?}");
    resp.result.as_ref().unwrap()["dispatch"].as_str().unwrap()
}

// ---------------- the tests ----------------

#[tokio::test]
async fn a_cold_session_gets_a_runner_its_history_and_the_message() {
    let dir = tempfile::tempdir().unwrap();
    let galley = session_with_history(dir.path(), json!([])).await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());

    let resp = send(
        &galley,
        &runner,
        &rec,
        json!({"sessionId": SID, "content": "国航", "supervisor": "galley-assistant",
               "ensureRunner": true}),
    )
    .await;

    assert_eq!(dispatch_of(&resp), "dispatched");
    assert_eq!(runner.spawns.load(Ordering::SeqCst), 1);
    // The history first, then the message — never the other way round.
    assert_eq!(
        runner.log(),
        vec![
            ("load_history".to_string(), Value::Array(history())),
            ("user_message".to_string(), json!("国航")),
        ]
    );
    // The run it started holds the gate.
    assert!(runner.gate().open_run);
    // The response is the one `session send` always gave.
    let result = resp.result.unwrap();
    assert_eq!(result["message"]["content"], "国航");
    assert_eq!(
        result["message"]["origin"]["supervisor"],
        "galley-assistant"
    );
    assert!(result.get("queue").is_none());
    let spawned = rec.named("runner-spawned-external");
    assert_eq!(spawned.len(), 1);
    assert_eq!(spawned[0]["via"], "session.send");
    let persisted = rec.named("user-message-persisted");
    assert_eq!(persisted.len(), 1);
    assert_eq!(persisted[0]["dispatch"], "dispatched");
}

#[tokio::test]
async fn without_the_flag_a_cold_session_is_persisted_only_as_ever() {
    let dir = tempfile::tempdir().unwrap();
    let galley = session_with_history(dir.path(), json!([])).await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());

    for args in [
        json!({"sessionId": SID, "content": "国航"}),
        json!({"sessionId": SID, "content": "国航", "ensureRunner": false}),
    ] {
        let resp = send(&galley, &runner, &rec, args).await;
        assert_eq!(dispatch_of(&resp), "persisted_only");
    }
    assert_eq!(runner.spawns.load(Ordering::SeqCst), 0);
    assert!(runner.log().is_empty());
    assert!(!runner.gate().open_run, "the gate is released");
    assert!(rec.named("runner-spawned-external").is_empty());
}

#[tokio::test]
async fn an_asking_session_is_answered_after_a_cold_start() {
    let dir = tempfile::tempdir().unwrap();
    let asked = json!([{"toolName": "ask_user", "args": {"question": "要哪家航空？",
                                                          "candidates": ["国航", "东航"]}}]);
    let galley = session_with_history(dir.path(), asked).await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    // Its run ended on the question (the runner since gone), with a
    // message queued before it held back.
    runner.set_gate(Gate {
        open_run: false,
        ask_pending: true,
        queued: 1,
    });

    let resp = send(
        &galley,
        &runner,
        &rec,
        json!({"sessionId": SID, "content": "国航", "supervisor": "galley-assistant",
               "reason": "answer", "ensureRunner": true}),
    )
    .await;

    // The answer went at once, past the held message, as galley#30 has
    // it — after the history.
    assert_eq!(dispatch_of(&resp), "dispatched");
    assert_eq!(
        runner.log(),
        vec![
            ("load_history".to_string(), Value::Array(history())),
            ("user_message".to_string(), json!("国航")),
        ]
    );
    let gate = runner.gate();
    assert!(gate.open_run && !gate.ask_pending);
    assert_eq!(gate.queued, 1, "the held message keeps waiting");
}

#[tokio::test]
async fn a_live_runner_is_used_as_it_is() {
    let dir = tempfile::tempdir().unwrap();
    let galley = session_with_history(dir.path(), json!([])).await;
    let runner = Runner::default();
    runner.alive.lock().unwrap().insert(SID.into(), 4242);
    let rec = Arc::new(Recorder::default());

    let resp = send(
        &galley,
        &runner,
        &rec,
        json!({"sessionId": SID, "content": "国航", "ensureRunner": true}),
    )
    .await;

    assert_eq!(dispatch_of(&resp), "dispatched");
    assert_eq!(runner.spawns.load(Ordering::SeqCst), 0);
    assert_eq!(
        runner.log(),
        vec![("user_message".to_string(), json!("国航"))]
    );
}

#[tokio::test]
async fn a_runner_that_cannot_start_leaves_the_message_saved_only() {
    let dir = tempfile::tempdir().unwrap();
    let galley = session_with_history(dir.path(), json!([])).await;
    let runner = Runner::default();
    runner.fail_spawn.store(true, Ordering::SeqCst);
    let rec = Arc::new(Recorder::default());

    let resp = send(
        &galley,
        &runner,
        &rec,
        json!({"sessionId": SID, "content": "国航", "ensureRunner": true}),
    )
    .await;

    assert_eq!(dispatch_of(&resp), "persisted_only");
    assert!(runner.log().is_empty());
    assert!(!runner.gate().open_run, "the gate is released");
    let rows = galley
        .persisted_message_rows(&SessionId(SID.into()))
        .await
        .unwrap();
    assert_eq!(rows.last().unwrap().content, "国航", "saved");
}

#[tokio::test]
async fn a_runner_whose_history_cannot_be_restored_is_not_sent_the_message() {
    let dir = tempfile::tempdir().unwrap();
    let galley = session_with_history(dir.path(), json!([])).await;
    let runner = Runner::default();
    runner.refuse_history.store(true, Ordering::SeqCst);
    let rec = Arc::new(Recorder::default());

    let resp = send(
        &galley,
        &runner,
        &rec,
        json!({"sessionId": SID, "content": "国航", "ensureRunner": true}),
    )
    .await;

    // Two attempts (one restart), both refused; the message never went
    // to a runner without its history.
    assert_eq!(dispatch_of(&resp), "persisted_only");
    assert_eq!(runner.spawns.load(Ordering::SeqCst), 2);
    let kinds: Vec<String> = runner.log().into_iter().map(|(kind, _)| kind).collect();
    assert_eq!(kinds, vec!["load_history", "load_history"]);
    assert!(!runner.gate().open_run, "the gate is released");
}
