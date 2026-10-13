//! Main chat segments (`galley_core_lib::session_runner::segment`,
//! `.scratch/main-chat` ticket 03a), driven against an in-memory DB, a
//! scripted runner registry with the real run-gate rules, and a fake
//! managed spawn env:
//!
//! - the rule: after more than N hours idle the next message starts a
//!   new segment (N the hidden pref), never while a run is going or a
//!   question waits for its answer;
//! - a warm runner is swapped for a fresh one before that message, and a
//!   main chat opened after the gap starts the segment before it;
//! - a cold runner gets only the current segment back, the same after a
//!   "restart" (a new registry on the same database) and after N changes;
//! - a new segment opens with the last three complete turns before it,
//!   from any earlier segment, held to the character cap (ticket 11);
//! - the database keeps the whole thread;
//! - side chats — managed or attached — are untouched;
//! - what the main chat's state block says about its segment (03b) and
//!   about the turns it carries over (11).
//!
//! The pure rule (exactly N hours, empty segments, the pref fallback)
//! is unit-tested in `core/src/session_runner/segment.rs`.

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia, RuntimeKind, SessionId,
};
use galley_core_lib::db::{
    MainChatSeed, PersistAssistantMessage, SqliteGalley, MAIN_CHAT_GREETING_ZH,
};
use galley_core_lib::ipc::{HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunState,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::segment::IDLE_HOURS_PREF;
use galley_core_lib::session_runner::{
    ensure_session_runner, EnsureOptions, ReplayTimeouts, RunnerHost, SpawnEnv,
};
use galley_core_lib::session_send::{send_user_message, SendOutcome, SendRequest};
use galley_core_lib::socket_listener::RunnerPort;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

// ---------------- fixtures ----------------

async fn fresh() -> (SqlitePool, SqliteGalley) {
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
    (pool, galley)
}

fn gui_origin() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
        client: None,
    }
}

/// The main chat as Core creates it, greeting included (ticket 04c): a
/// row before the first turn that no rule here may count or replay.
async fn main_chat(galley: &SqliteGalley, id: &str) {
    let seed = MainChatSeed {
        greeting: Some(MAIN_CHAT_GREETING_ZH.into()),
    };
    let ensured = galley
        .get_or_create_main_chat(id, gui_origin(), &seed)
        .await
        .expect("main chat");
    assert_eq!(ensured.brief().id.as_str(), id);
}

async fn side_chat(galley: &SqliteGalley, id: &str, runtime: RuntimeKind) {
    galley
        .create_session(
            CreateSessionInput {
                id: id.to_string(),
                title: "旁聊".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(runtime),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            gui_origin(),
        )
        .await
        .expect("side chat");
}

/// One completed exchange, written the way Core writes it.
async fn seed_exchange(galley: &SqliteGalley, sid: &str, user: &str, reply: &str) {
    let row = galley
        .send_message(SessionId(sid.into()), user.into(), gui_origin())
        .await
        .expect("user row");
    reply_to(
        galley,
        sid,
        row.turn_index.expect("turn index"),
        reply,
        None,
    )
    .await;
}

/// The reply that ends the turn `turn_index`, and the session bump.
async fn reply_to(
    galley: &SqliteGalley,
    sid: &str,
    turn_index: u32,
    reply: &str,
    tool_calls: Option<Value>,
) {
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index,
            content: reply.into(),
            tool_calls: tool_calls.map(|calls| calls.to_string()),
            tool_results: None,
            thinking: None,
            final_answer: Some(reply.into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
    galley
        .bump_session_after_turn(SessionId(sid.into()), Some(reply.into()), None, false)
        .await
        .expect("bump");
}

/// The session went quiet `hours` ago.
async fn idle_for(pool: &SqlitePool, sid: &str, hours: f64) {
    let at = Utc::now() - ChronoDuration::milliseconds((hours * 3_600_000.0) as i64);
    sqlx::query("UPDATE sessions SET last_activity_at = ? WHERE id = ?")
        .bind(at.to_rfc3339())
        .bind(sid)
        .execute(pool)
        .await
        .expect("backdate");
}

async fn boundaries(galley: &SqliteGalley, sid: &str) -> Vec<i64> {
    galley
        .main_chat_segment_starts(&SessionId(sid.into()))
        .await
        .expect("boundaries")
}

async fn row_count(pool: &SqlitePool, sid: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ?")
        .bind(sid)
        .fetch_one(pool)
        .await
        .expect("count")
}

fn turn(user: &str, reply: &str) -> Vec<Value> {
    vec![
        json!({"role": "user", "content": user}),
        json!({"role": "assistant", "content": reply}),
    ]
}

#[derive(Default)]
struct NullNotifier;

impl Notifier for NullNotifier {
    fn emit(&self, _event: &str, _payload: Value) {}
}

/// Managed spawn env stand-in (no disk, no app).
struct FakeEnv;

#[async_trait]
impl SpawnEnv for FakeEnv {
    fn bundled_python(&self) -> Option<PathBuf> {
        Some(PathBuf::from("/bundle/python/bin/python3"))
    }
    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        Ok(PathBuf::from("/galley"))
    }
    async fn prepare_managed(&self, mut args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        args.ga_path = PathBuf::from("/managed/code");
        args.bridge_cwd = PathBuf::from("/galley");
        args.llm_key = None;
        Ok(args)
    }
}

// ---------------- scripted runner registry ----------------

#[derive(Debug, Default, Clone)]
struct Gate {
    open_run: bool,
    ask_pending: bool,
}

/// Registry fake: spawns register a live pid that reports `ready` at
/// once (unless `silent`), `load_history` is always loaded, a delivered
/// `user_message` / `ask_user_response` opens the run gate (and answers
/// a pending question), and the gate follows `queue_offer`'s
/// dispatch-now rule. `log` is one ordered record of the registry calls
/// a segment decision shows in.
#[derive(Default)]
struct SegRunner {
    silent: bool,
    next_pid: AtomicU32,
    alive: Mutex<HashMap<String, u32>>,
    confirmed: Mutex<HashMap<String, u32>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    agent_running: Mutex<HashMap<String, bool>>,
    gates: Mutex<HashMap<String, Gate>>,
    sent: Mutex<Vec<(String, IpcCommand)>>,
    log: Mutex<Vec<String>>,
}

impl SegRunner {
    /// A registry whose runners never report `ready`: an ensure that
    /// waited for one would time out.
    fn silent() -> Self {
        Self {
            silent: true,
            ..Self::default()
        }
    }
    /// A live runner Core already confirmed.
    fn live(&self, sid: &str, pid: u32) {
        self.alive.lock().unwrap().insert(sid.into(), pid);
        self.confirmed.lock().unwrap().insert(sid.into(), pid);
        self.ready.lock().unwrap().insert(sid.into(), ready(sid));
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid.into(), tx);
    }
    fn log(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }
    fn note(&self, entry: String) {
        self.log.lock().unwrap().push(entry);
    }
    fn set_gate(&self, sid: &str, gate: Gate) {
        self.gates.lock().unwrap().insert(sid.into(), gate);
    }
    fn gate(&self, sid: &str) -> Gate {
        self.gates
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default()
    }
    fn load_histories(&self) -> Vec<Vec<Value>> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, cmd)| match cmd {
                IpcCommand::LoadHistory(load) => Some(load.messages.clone()),
                _ => None,
            })
            .collect()
    }
    async fn spawn_inner(&self, args: SpawnArgs) -> Result<u32, RunnerSpawnError> {
        let sid = args.session_id.clone();
        tokio::time::sleep(Duration::from_millis(5)).await;
        let pid = 7000 + self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.alive.lock().unwrap().insert(sid.clone(), pid);
        self.confirmed.lock().unwrap().remove(&sid);
        if self.silent {
            self.ready.lock().unwrap().remove(&sid);
        } else {
            self.ready.lock().unwrap().insert(sid.clone(), ready(&sid));
        }
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid, tx);
        self.note(format!("spawn:{pid}"));
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

#[async_trait]
impl RunnerPort for SegRunner {
    async fn spawn(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn spawn_held(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        let pid = self.alive.lock().unwrap().get(sid).copied();
        let Some(pid) = pid else {
            return Err(SendCommandError::ProcessGone {
                session_id: sid.to_string(),
            });
        };
        self.sent
            .lock()
            .unwrap()
            .push((sid.to_string(), cmd.clone()));
        let kind = serde_json::to_value(cmd).unwrap()["kind"]
            .as_str()
            .unwrap()
            .to_string();
        self.note(format!("{kind}:{pid}"));
        match cmd {
            IpcCommand::LoadHistory(_) => {
                let tx = self.channels.lock().unwrap().get(sid).cloned();
                if let Some(tx) = tx {
                    let _ = tx.send(BroadcastItem::Event(Box::new(IpcEvent::HistoryLoaded(
                        HistoryLoadedEvent {
                            session_id: sid.into(),
                            message_count: 0,
                            timestamp: "t".into(),
                        },
                    ))));
                }
            }
            IpcCommand::UserMessage(m) if !is_side_question(&m.text) => {
                self.set_gate(
                    sid,
                    Gate {
                        open_run: true,
                        ask_pending: false,
                    },
                );
            }
            IpcCommand::AskUserResponse(_) => {
                self.set_gate(
                    sid,
                    Gate {
                        open_run: true,
                        ask_pending: false,
                    },
                );
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
    async fn agent_running(&self, sid: &str) -> bool {
        self.agent_running
            .lock()
            .unwrap()
            .get(sid)
            .copied()
            .unwrap_or(false)
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
    async fn retire(&self, sid: &str, pid: u32) -> bool {
        self.note(format!("retire:{pid}"));
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
        assert!(!gate.open_run, "these tests never queue");
        gate.open_run = true;
        QueueOffer::DispatchNow
    }
    async fn queue_try_reserve(&self, sid: &str) -> bool {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if gate.open_run {
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
        let gate = self.gate(sid);
        let runner_alive = self.alive.lock().unwrap().contains_key(sid);
        RunState {
            runner_alive,
            agent_running: self.agent_running(sid).await,
            open_run: gate.open_run,
            queued_count: 0,
            ask_pending: gate.ask_pending,
            last_exit: None,
        }
    }
}

fn host<'a>(galley: &'a SqliteGalley, runner: &'a SegRunner, env: &'a FakeEnv) -> RunnerHost<'a> {
    RunnerHost {
        galley,
        runner,
        notifier: Arc::new(NullNotifier),
        env: Some(env),
    }
}

fn fast() -> ReplayTimeouts {
    ReplayTimeouts {
        ready: Duration::from_millis(500),
        history: Duration::from_secs(2),
    }
}

/// What the GUI's ensure on opening a session passes.
fn opening() -> EnsureOptions<'static> {
    EnsureOptions {
        via: "gui",
        active_session_id: None,
        llm_override: None,
        ga_config: None,
        holds_run_gate: false,
        timeouts: fast(),
    }
}

fn request(sid: &str, text: &str) -> SendRequest {
    SendRequest {
        session_id: sid.into(),
        text: text.into(),
        images: vec![],
        client_request_id: None,
        origin: gui_origin(),
        via: "gui",
        llm_override: None,
        ga_config: None,
        timeouts: fast(),
    }
}

/// The dispatched message's turn index.
fn dispatched_turn(outcome: &SendOutcome) -> i64 {
    match outcome {
        SendOutcome::Dispatched { message, .. } => {
            i64::from(message.turn_index.expect("turn index"))
        }
        other => panic!("expected Dispatched, got {other:?}"),
    }
}

/// A main chat with two completed exchanges.
async fn main_chat_with_history(sid: &str) -> (SqlitePool, SqliteGalley) {
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    seed_exchange(&galley, sid, "记住暗号：蓝鲸 4721", "好").await;
    seed_exchange(&galley, sid, "复述一遍", "蓝鲸 4721").await;
    (pool, galley)
}

/// What a segment cut after [`main_chat_with_history`] opens with: both
/// exchanges, carried over (ticket 11).
fn carried_history() -> Vec<Value> {
    let mut carried = turn("记住暗号：蓝鲸 4721", "好");
    carried.extend(turn("复述一遍", "蓝鲸 4721"));
    carried
}

// ---------------- the warm runner ----------------

#[tokio::test]
async fn after_an_idle_gap_the_warm_runner_is_swapped_before_the_message() {
    let sid = "s-main-warm";
    let (pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    idle_for(&pool, sid, 5.0).await;
    let env = FakeEnv;

    let outcome = send_user_message(&host(&galley, &runner, &env), request(sid, "早上好"))
        .await
        .expect("send");

    let start = dispatched_turn(&outcome);
    // The old runner goes before anything reaches a runner; the fresh one
    // gets the turns the segment carries over (ticket 11), then the
    // message.
    let log = runner.log();
    assert_eq!(log.len(), 4, "{log:?}");
    assert_eq!(log[0], "retire:4242");
    assert!(log[1].starts_with("spawn:"), "{log:?}");
    let fresh_pid = log[1].trim_start_matches("spawn:");
    assert_eq!(log[2], format!("load_history:{fresh_pid}"));
    assert_eq!(log[3], format!("user_message:{fresh_pid}"));
    assert_eq!(runner.load_histories(), vec![carried_history()]);
    // The boundary is the message's own turn.
    assert_eq!(boundaries(&galley, sid).await, vec![start]);
    // The database keeps the whole thread (the greeting, two exchanges,
    // the new message).
    assert_eq!(row_count(&pool, sid).await, 6);
}

#[tokio::test]
async fn within_the_threshold_the_warm_runner_keeps_its_context() {
    let sid = "s-main-short";
    let (pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    idle_for(&pool, sid, 3.9).await;
    let env = FakeEnv;

    send_user_message(&host(&galley, &runner, &env), request(sid, "午饭回来了"))
        .await
        .expect("send");

    assert_eq!(runner.log(), vec!["user_message:4242".to_string()]);
    assert!(boundaries(&galley, sid).await.is_empty());
}

#[tokio::test]
async fn the_threshold_is_the_hidden_pref() {
    let env = FakeEnv;
    // One hour: two hours of silence cut.
    let sid = "s-main-pref-1";
    let (pool, galley) = main_chat_with_history(sid).await;
    galley
        .set_pref_json(IDLE_HOURS_PREF, json!(1))
        .await
        .unwrap();
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    idle_for(&pool, sid, 2.0).await;
    send_user_message(&host(&galley, &runner, &env), request(sid, "嗨"))
        .await
        .expect("send");
    assert_eq!(runner.log()[0], "retire:4242");
    assert_eq!(boundaries(&galley, sid).await.len(), 1);

    // Ten hours: five hours of silence do not.
    let sid = "s-main-pref-10";
    let (pool, galley) = main_chat_with_history(sid).await;
    galley
        .set_pref_json(IDLE_HOURS_PREF, json!(10))
        .await
        .unwrap();
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    idle_for(&pool, sid, 5.0).await;
    send_user_message(&host(&galley, &runner, &env), request(sid, "嗨"))
        .await
        .expect("send");
    assert_eq!(runner.log(), vec!["user_message:4242".to_string()]);
    assert!(boundaries(&galley, sid).await.is_empty());
}

// ---------------- opening the main chat ----------------

#[tokio::test]
async fn opening_an_idle_main_chat_starts_the_segment_before_its_first_message() {
    let sid = "s-main-open";
    let (pool, galley) = main_chat_with_history(sid).await;
    idle_for(&pool, sid, 9.0).await;
    let runner = SegRunner::default();
    let env = FakeEnv;
    let h = host(&galley, &runner, &env);

    let opened = ensure_session_runner(&h, sid, opening())
        .await
        .expect("open");
    assert!(opened.spawned);
    // The new segment has no reply yet; what it holds is what it carries.
    assert_eq!(runner.load_histories(), vec![carried_history()]);
    // The next message's turn (two exchanges: turns 0 and 1).
    assert_eq!(boundaries(&galley, sid).await, vec![2]);

    // The message itself finds the segment already open and the fresh
    // runner already there.
    let outcome = send_user_message(&h, request(sid, "早上好"))
        .await
        .expect("send");
    assert_eq!(dispatched_turn(&outcome), 2);
    assert_eq!(
        runner.log(),
        vec![
            format!("spawn:{}", opened.pid),
            format!("load_history:{}", opened.pid),
            format!("user_message:{}", opened.pid),
        ]
    );
    assert_eq!(boundaries(&galley, sid).await, vec![2]);
}

#[tokio::test]
async fn opening_a_warm_idle_main_chat_retires_its_runner() {
    let sid = "s-main-open-warm";
    let (pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    idle_for(&pool, sid, 5.0).await;
    let env = FakeEnv;

    let opened = ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("open");

    assert!(opened.spawned);
    assert_ne!(opened.pid, 4242);
    assert_eq!(
        runner.log(),
        vec![
            "retire:4242".to_string(),
            format!("spawn:{}", opened.pid),
            format!("load_history:{}", opened.pid),
        ]
    );
    assert_eq!(runner.load_histories(), vec![carried_history()]);
}

// ---------------- the cold runner ----------------

#[tokio::test]
async fn a_cold_main_chat_gets_its_segment_and_the_turns_it_carries_also_after_a_restart() {
    let sid = "s-main-cold";
    let (pool, galley) = main_chat_with_history(sid).await;
    idle_for(&pool, sid, 6.0).await;
    let env = FakeEnv;

    // The idle gap is crossed by a message; its turn completes.
    let before = SegRunner::default();
    let outcome = send_user_message(&host(&galley, &before, &env), request(sid, "新的一天"))
        .await
        .expect("send");
    let start = dispatched_turn(&outcome);
    reply_to(&galley, sid, start as u32, "早", None).await;
    seed_exchange(&galley, sid, "今天先做什么", "先回邮件").await;

    // "Core restarts": a new registry, nothing alive, same database. The
    // session is busy again (not idle), so no new boundary.
    for idle_hours in [None, Some(1000)] {
        if let Some(hours) = idle_hours {
            // Tuning N afterwards moves no boundary.
            galley
                .set_pref_json(IDLE_HOURS_PREF, json!(hours))
                .await
                .unwrap();
        }
        let after = SegRunner::default();
        ensure_session_runner(&host(&galley, &after, &env), sid, opening())
            .await
            .expect("restore");
        let mut expected = carried_history();
        expected.extend(turn("新的一天", "早"));
        expected.extend(turn("今天先做什么", "先回邮件"));
        assert_eq!(after.load_histories(), vec![expected]);
    }
    assert_eq!(boundaries(&galley, sid).await, vec![start]);
    // The greeting and four exchanges.
    assert_eq!(row_count(&pool, sid).await, 9);
}

#[tokio::test]
async fn a_main_chat_never_cut_replays_everything() {
    let sid = "s-main-whole";
    let (_pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    let env = FakeEnv;

    ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("restore");

    let mut expected = turn("记住暗号：蓝鲸 4721", "好");
    expected.extend(turn("复述一遍", "蓝鲸 4721"));
    assert_eq!(runner.load_histories(), vec![expected]);
}

// ---------------- never mid-task ----------------

#[tokio::test]
async fn a_run_going_is_never_cut() {
    let sid = "s-main-running";
    let (pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    runner
        .agent_running
        .lock()
        .unwrap()
        .insert(sid.into(), true);
    idle_for(&pool, sid, 12.0).await;
    let env = FakeEnv;

    let outcome = ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("ensure");

    assert_eq!(outcome.pid, 4242);
    assert!(runner.log().is_empty());
    assert!(boundaries(&galley, sid).await.is_empty());
}

#[tokio::test]
async fn an_answer_to_a_waiting_question_is_never_cut_off() {
    let sid = "s-main-ask";
    let (pool, galley) = main_chat_with_history(sid).await;
    let runner = SegRunner::default();
    runner.live(sid, 4242);
    runner.set_gate(
        sid,
        Gate {
            open_run: false,
            ask_pending: true,
        },
    );
    idle_for(&pool, sid, 12.0).await;
    let env = FakeEnv;

    send_user_message(&host(&galley, &runner, &env), request(sid, "选第二个"))
        .await
        .expect("answer");

    assert_eq!(runner.log(), vec!["ask_user_response:4242".to_string()]);
    assert!(boundaries(&galley, sid).await.is_empty());
}

#[tokio::test]
async fn a_question_survives_a_restart_and_keeps_its_answer_in_the_segment() {
    let sid = "s-main-ask-cold";
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    let row = galley
        .send_message(SessionId(sid.into()), "帮我订周五的票".into(), gui_origin())
        .await
        .unwrap();
    // The turn ended on a question nobody answered before Core restarted.
    reply_to(
        &galley,
        sid,
        row.turn_index.unwrap(),
        "上午还是下午？",
        Some(json!([{"toolName": "ask_user", "args": {"question": "上午还是下午？"}}])),
    )
    .await;
    idle_for(&pool, sid, 12.0).await;
    let runner = SegRunner::default();
    let env = FakeEnv;

    send_user_message(&host(&galley, &runner, &env), request(sid, "下午"))
        .await
        .expect("send");

    assert!(boundaries(&galley, sid).await.is_empty());
    assert_eq!(
        runner.load_histories(),
        vec![turn("帮我订周五的票", "上午还是下午？")]
    );
}

// ---------------- other sessions ----------------

#[tokio::test]
async fn side_chats_are_never_cut() {
    let env = FakeEnv;
    for (sid, runtime) in [
        ("s-side-managed", RuntimeKind::Managed),
        ("s-side-external", RuntimeKind::External),
    ] {
        let (pool, galley) = fresh().await;
        // A main chat exists beside it; the rule is about that one only.
        main_chat(&galley, "s-main-beside").await;
        side_chat(&galley, sid, runtime).await;
        seed_exchange(&galley, sid, "第一问", "第一答").await;
        idle_for(&pool, sid, 48.0).await;
        let runner = SegRunner::default();
        runner.live(sid, 4242);

        send_user_message(&host(&galley, &runner, &env), request(sid, "接着聊"))
            .await
            .expect("send");

        assert_eq!(runner.log(), vec!["user_message:4242".to_string()], "{sid}");
        assert!(boundaries(&galley, sid).await.is_empty(), "{sid}");
    }

    // Cold, a managed side chat idle for days still gets everything back.
    let sid = "s-side-cold";
    let (pool, galley) = fresh().await;
    side_chat(&galley, sid, RuntimeKind::Managed).await;
    seed_exchange(&galley, sid, "第一问", "第一答").await;
    idle_for(&pool, sid, 48.0).await;
    let runner = SegRunner::default();
    ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("restore");
    assert_eq!(runner.load_histories(), vec![turn("第一问", "第一答")]);
    assert!(boundaries(&galley, sid).await.is_empty());
}

// ---------------- what a new segment carries over (ticket 11) ----------------

#[tokio::test]
async fn a_new_segment_opens_with_the_last_three_turns_also_after_a_restart() {
    let sid = "s-main-carry";
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    for i in 0..5 {
        seed_exchange(&galley, sid, &format!("问{i}"), &format!("答{i}")).await;
    }
    idle_for(&pool, sid, 5.0).await;
    let env = FakeEnv;

    let runner = SegRunner::default();
    let outcome = send_user_message(&host(&galley, &runner, &env), request(sid, "接着说"))
        .await
        .expect("send");
    let start = dispatched_turn(&outcome);
    assert_eq!(boundaries(&galley, sid).await, vec![5]);
    // The last three of five, never the greeting; the message just sent
    // is input, not history.
    let mut carried = turn("问2", "答2");
    carried.extend(turn("问3", "答3"));
    carried.extend(turn("问4", "答4"));
    assert_eq!(runner.load_histories(), vec![carried.clone()]);

    // The turn completes; "Core restarts": the same opening, then the
    // segment.
    reply_to(&galley, sid, start as u32, "好", None).await;
    let after = SegRunner::default();
    ensure_session_runner(&host(&galley, &after, &env), sid, opening())
        .await
        .expect("restore");
    let mut expected = carried;
    expected.extend(turn("接着说", "好"));
    assert_eq!(after.load_histories(), vec![expected]);
}

#[tokio::test]
async fn a_short_previous_segment_is_topped_up_from_the_one_before() {
    let sid = "s-main-carry-back";
    let (pool, galley) = main_chat_with_history(sid).await;
    let env = FakeEnv;
    // Segment two: one exchange.
    idle_for(&pool, sid, 5.0).await;
    let first = SegRunner::default();
    let outcome = send_user_message(&host(&galley, &first, &env), request(sid, "午饭吃什么"))
        .await
        .expect("send");
    reply_to(&galley, sid, dispatched_turn(&outcome) as u32, "面", None).await;
    // Segment three.
    idle_for(&pool, sid, 5.0).await;
    let second = SegRunner::default();
    send_user_message(&host(&galley, &second, &env), request(sid, "晚饭呢"))
        .await
        .expect("send");

    assert_eq!(boundaries(&galley, sid).await, vec![2, 3]);
    let mut expected = carried_history();
    expected.extend(turn("午饭吃什么", "面"));
    assert_eq!(second.load_histories(), vec![expected]);
}

#[tokio::test]
async fn a_message_that_got_no_reply_is_not_carried() {
    let sid = "s-main-carry-skip";
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    seed_exchange(&galley, sid, "第一问", "第一答").await;
    // Persisted, never answered.
    galley
        .send_message(SessionId(sid.into()), "没人回的一句".into(), gui_origin())
        .await
        .expect("user row");
    idle_for(&pool, sid, 5.0).await;
    let runner = SegRunner::default();
    let env = FakeEnv;

    ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("open");

    assert_eq!(boundaries(&galley, sid).await, vec![2]);
    assert_eq!(runner.load_histories(), vec![turn("第一问", "第一答")]);
}

#[tokio::test]
async fn with_nothing_complete_before_the_boundary_there_is_nothing_to_replay() {
    use chrono_tz::Asia::Shanghai;
    use galley_core_lib::session_runner::segment::prompt_state_in;

    let sid = "s-main-carry-none";
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    // A turn that ended with no visible reply.
    galley
        .send_message(SessionId(sid.into()), "在吗".into(), gui_origin())
        .await
        .expect("user row");
    galley
        .bump_session_after_turn(SessionId(sid.into()), None, None, false)
        .await
        .expect("bump");
    idle_for(&pool, sid, 5.0).await;
    // Its runners never report ready: had the ensure gone to replay, it
    // would fail.
    let runner = SegRunner::silent();
    let env = FakeEnv;

    let opened = ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("open");

    assert!(opened.spawned);
    assert_eq!(boundaries(&galley, sid).await, vec![1]);
    assert!(runner.load_histories().is_empty());
    let state = prompt_state_in(&galley, sid, &Shanghai)
        .await
        .expect("state");
    assert_eq!(state.segment_start_turn, 1);
    assert_eq!(state.carried, None);
}

#[tokio::test]
async fn the_cap_holds_in_the_replay() {
    use galley_core_lib::session_runner::carry::{CARRY_MAX_CHARS, CUT_MARKER};

    let sid = "s-main-carry-cap";
    let (pool, galley) = fresh().await;
    main_chat(&galley, sid).await;
    seed_exchange(&galley, sid, "短问", "短答").await;
    let long = format!("开头{}结论在最后", "长".repeat(8_000));
    seed_exchange(&galley, sid, "写一篇长文", &long).await;
    idle_for(&pool, sid, 5.0).await;
    let runner = SegRunner::default();
    let env = FakeEnv;

    ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("open");

    let histories = runner.load_histories();
    assert_eq!(histories.len(), 1);
    let messages = &histories[0];
    // The older turn goes whole; the latest keeps its question and the
    // end of its reply.
    assert_eq!(messages.len(), 2, "{messages:?}");
    assert_eq!(messages[0]["content"], "写一篇长文");
    let reply = messages[1]["content"].as_str().expect("reply");
    assert!(
        reply.starts_with(CUT_MARKER),
        "{}",
        reply.chars().take(40).collect::<String>()
    );
    assert!(reply.ends_with("结论在最后"));
    let chars: usize = messages
        .iter()
        .map(|m| m["content"].as_str().unwrap().chars().count())
        .sum();
    assert_eq!(chars, CARRY_MAX_CHARS);
}

/// The state block names what the replay opens with, from the same read:
/// how many turns and, in local time to the minute, when the last was
/// said. The first segment carries nothing and says nothing.
#[tokio::test]
async fn the_state_block_and_the_replay_agree_on_what_is_carried() {
    use chrono_tz::Asia::Shanghai;
    use galley_core_lib::session_runner::segment::{prompt_state_in, CarriedPromptState};

    let sid = "s-main-carry-state";
    let (pool, galley) = main_chat_with_history(sid).await;
    // The last reply was written at 09:41:30 in Shanghai.
    sqlx::query(
        "UPDATE messages SET created_at = '2026-10-12T01:41:30Z' \
         WHERE session_id = ? AND role = 'assistant' AND turn_index = 1",
    )
    .bind(sid)
    .execute(&pool)
    .await
    .expect("reply time");
    let first = prompt_state_in(&galley, sid, &Shanghai)
        .await
        .expect("state");
    assert_eq!(first.carried, None, "first segment");

    idle_for(&pool, sid, 5.0).await;
    let runner = SegRunner::default();
    let env = FakeEnv;
    ensure_session_runner(&host(&galley, &runner, &env), sid, opening())
        .await
        .expect("open");

    assert_eq!(runner.load_histories(), vec![carried_history()]);
    let state = prompt_state_in(&galley, sid, &Shanghai)
        .await
        .expect("state");
    assert_eq!(
        state.carried,
        Some(CarriedPromptState {
            turns: 2,
            last_said_at: "2026-10-12 09:41".into(),
        })
    );
    // A runner respawned mid-segment is told the same.
    assert_eq!(prompt_state_in(&galley, sid, &Shanghai).await, Some(state));
}

// ---------------- the main chat's state block (ticket 03b) ----------------

/// What a main chat runner is told about the conversation at spawn: its
/// id and where the current segment begins (turn index, local date) —
/// the first segment from turn 0 on the day the main chat was created,
/// later ones from the latest recorded boundary. Every other session
/// gets nothing, so its prompt stays the ordinary one.
#[tokio::test]
async fn main_chat_prompt_state_names_the_current_segment() {
    use chrono_tz::Asia::Shanghai;
    use galley_core_lib::session_runner::segment::{prompt_state_in, MainChatPromptState};

    let (pool, galley) = fresh().await;
    let sid = "s-main-state";
    main_chat(&galley, sid).await;
    side_chat(&galley, "s-side-managed", RuntimeKind::Managed).await;
    side_chat(&galley, "s-side-external", RuntimeKind::External).await;
    // 01:30 the next day in Shanghai.
    sqlx::query("UPDATE sessions SET created_at = '2026-10-01T17:30:00+00:00' WHERE id = ?")
        .bind(sid)
        .execute(&pool)
        .await
        .expect("created_at");

    assert_eq!(
        prompt_state_in(&galley, sid, &Shanghai).await,
        Some(MainChatPromptState {
            session_id: sid.into(),
            segment_start_turn: 0,
            segment_start_date: "2026-10-02".into(),
            carried: None,
        }),
        "first segment"
    );

    for start in [4, 9] {
        galley
            .record_main_chat_segment(&SessionId(sid.into()), start)
            .await
            .expect("boundary");
    }
    sqlx::query(
        "UPDATE main_chat_segments SET created_at = CASE start_turn_index \
           WHEN 4 THEN '2026-10-05T03:00:00+00:00' \
           ELSE '2026-10-11T23:10:00+00:00' END \
         WHERE session_id = ?",
    )
    .bind(sid)
    .execute(&pool)
    .await
    .expect("boundary times");
    assert_eq!(
        prompt_state_in(&galley, sid, &Shanghai).await,
        Some(MainChatPromptState {
            session_id: sid.into(),
            segment_start_turn: 9,
            segment_start_date: "2026-10-12".into(),
            // Boundaries with no complete turn before them carry nothing.
            carried: None,
        }),
        "the latest boundary, on its local day"
    );

    for other in ["s-side-managed", "s-side-external", "s-missing"] {
        assert_eq!(
            prompt_state_in(&galley, other, &Shanghai).await,
            None,
            "{other}"
        );
    }
}
