//! Core's shared "ensure a runner" path (`galley_core_lib::session_runner`,
//! ticket 02a), driven against an in-memory DB and a scripted fake runner
//! registry: single-flight per session, liveness, spawn-argument parity
//! between the GUI's and the socket's entry points, the frozen socket
//! error wording, and the auto-title watcher on socket-started runners.
//!
//! Since ticket 02b also history replay: what ensure sends as
//! `load_history`, the one quiet restart, the `HistoryReplay` error, the
//! live-runner rules, the `runner-history-replay` events, and a Goal on a
//! cold session getting its history before its objective.
//!
//! The real `RunnerManager` + mock bridge side (ready cache, concurrent
//! ensure on real processes, replay end to end, the run-gate race) lives
//! in `runner_manager_test.rs`.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateProjectInput, CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia,
    RuntimeKind, SessionId,
};
use galley_core_lib::db::{PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::{
    ErrorEvent, HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent, RunCompleteEvent,
};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, HeldClose, ReadySnapshot, RunState, RunnerCommandSink, RunnerSpawnError,
    SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::{
    ensure_session_runner, resolve_user_python, EnsureOptions, GaConfigPref, ReplayTimeouts,
    RunnerHost, SessionRunnerError, SpawnEnv,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, Notify};

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

fn cli_origin() -> Origin {
    Origin {
        via: OriginVia::Cli,
        supervisor: None,
        reason: None,
    }
}

struct SessionSeed<'a> {
    id: &'a str,
    runtime: RuntimeKind,
    project_id: Option<&'a str>,
    llm_index: Option<u32>,
    llm_key: Option<&'a str>,
}

impl<'a> SessionSeed<'a> {
    fn external(id: &'a str) -> Self {
        Self {
            id,
            runtime: RuntimeKind::External,
            project_id: None,
            llm_index: None,
            llm_key: None,
        }
    }
}

async fn seed_session(galley: &SqliteGalley, seed: SessionSeed<'_>) {
    galley
        .create_session(
            CreateSessionInput {
                id: seed.id.to_string(),
                title: "seed".into(),
                project_id: seed.project_id.map(str::to_string),
                selected_llm_index: seed.llm_index,
                selected_llm_key: seed.llm_key.map(str::to_string),
                selected_llm_display_name: None,
                ga_runtime_kind: Some(seed.runtime),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            cli_origin(),
        )
        .await
        .expect("seed session");
}

/// The stored `ga_config` pref, pointing at real directories (validated
/// before spawn) and a v0.1 interpreter alias.
fn ga_config_json(dir: &Path) -> Value {
    json!({
        "gaPath": dir.to_str().unwrap(),
        "bridgeCwd": dir.to_str().unwrap(),
        "python": "python-brew-intel",
        "useExternalPython": false,
    })
}

async fn seed_ga_config(galley: &SqliteGalley, dir: &Path) -> GaConfigPref {
    let value = ga_config_json(dir);
    galley
        .set_pref_json("ga_config", value.clone())
        .await
        .expect("seed ga_config");
    serde_json::from_value(value).expect("pref parses")
}

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
    fn count(&self, event: &str) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == event)
            .count()
    }
    fn payload_of(&self, event: &str) -> Option<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .find(|(name, _)| name == event)
            .map(|(_, payload)| payload.clone())
    }
}

/// Send-only sink the auto-title watcher writes to.
#[derive(Default)]
struct RecordingSink {
    sent: Mutex<Vec<(String, IpcCommand)>>,
}

#[async_trait]
impl RunnerCommandSink for RecordingSink {
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        self.sent
            .lock()
            .unwrap()
            .push((session_id.to_string(), cmd.clone()));
        Ok(())
    }
}

/// How the scripted runner answers one `load_history`.
#[derive(Debug, Clone, Copy)]
enum Reply {
    /// `history_loaded`.
    Loaded,
    /// An `error` with `context: "load_history"` (severity `error`).
    Refuse,
    /// The unvalidated-backend warning, then `history_loaded` anyway.
    WarnThenLoaded,
    /// The runner exits (its close was held: broadcast quiet).
    Exit,
    /// No answer at all.
    Silent,
}

/// Scripted runner registry. `spawn` yields (so a racing caller gets a
/// chance to interleave), optionally parks on a per-session gate, then
/// registers a live pid and a broadcast channel the test can feed.
/// `load_history` is answered from a per-session script (default
/// `Loaded`); `auto_ready` puts a `ready` in the cache at spawn.
#[derive(Default)]
struct ScriptedRunner {
    spawns: Mutex<Vec<(SpawnArgs, Option<String>)>>,
    registered: Mutex<HashMap<String, u32>>,
    alive: Mutex<HashMap<String, u32>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    subscribes: Mutex<HashMap<String, usize>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    gates: Mutex<HashMap<String, Arc<Notify>>>,
    next_pid: AtomicU32,
    sink: Option<Arc<RecordingSink>>,
    auto_ready: bool,
    /// Every command sent, in order (the auto-title sink is separate).
    sent: Mutex<Vec<(String, IpcCommand)>>,
    /// Commands sent and replies played, as one ordered log.
    timeline: Mutex<Vec<String>>,
    replies: Mutex<HashMap<String, VecDeque<Reply>>>,
    /// Session → the pid recorded as confirmed.
    confirmed: Mutex<HashMap<String, u32>>,
    /// Ensure-side hook calls, in order (`spawn_held:5000`, ...).
    hooks: Mutex<Vec<String>>,
    run_states: Mutex<HashMap<String, RunState>>,
}

impl ScriptedRunner {
    fn with_sink() -> (Self, Arc<RecordingSink>) {
        let sink = Arc::new(RecordingSink::default());
        (
            Self {
                sink: Some(sink.clone()),
                ..Self::default()
            },
            sink,
        )
    }
    fn spawn_count(&self) -> usize {
        self.spawns.lock().unwrap().len()
    }
    fn spawned_args(&self) -> Vec<SpawnArgs> {
        self.spawns
            .lock()
            .unwrap()
            .iter()
            .map(|(args, _)| args.clone())
            .collect()
    }
    fn subscribe_count(&self, session_id: &str) -> usize {
        *self
            .subscribes
            .lock()
            .unwrap()
            .get(session_id)
            .unwrap_or(&0)
    }
    fn mark_alive(&self, session_id: &str, pid: u32) {
        self.registered
            .lock()
            .unwrap()
            .insert(session_id.into(), pid);
        self.alive.lock().unwrap().insert(session_id.into(), pid);
    }
    fn gate(&self, session_id: &str) -> Arc<Notify> {
        let gate = Arc::new(Notify::new());
        self.gates
            .lock()
            .unwrap()
            .insert(session_id.into(), gate.clone());
        gate
    }
    fn feed(&self, session_id: &str, event: IpcEvent) {
        let tx = self
            .channels
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .expect("runner spawned");
        tx.send(BroadcastItem::Event(Box::new(event)))
            .expect("someone subscribed");
    }
    fn ready_on_spawn() -> Self {
        Self {
            auto_ready: true,
            ..Self::default()
        }
    }
    fn script(&self, session_id: &str, replies: &[Reply]) {
        self.replies
            .lock()
            .unwrap()
            .insert(session_id.into(), replies.iter().copied().collect());
    }
    fn set_run_state(&self, session_id: &str, state: RunState) {
        self.run_states
            .lock()
            .unwrap()
            .insert(session_id.into(), state);
    }
    fn hooks(&self) -> Vec<String> {
        self.hooks.lock().unwrap().clone()
    }
    fn hook(&self, entry: String) {
        self.hooks.lock().unwrap().push(entry);
    }
    fn timeline(&self) -> Vec<String> {
        self.timeline.lock().unwrap().clone()
    }
    fn load_histories(&self, session_id: &str) -> Vec<Vec<Value>> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter(|(sid, _)| sid == session_id)
            .filter_map(|(_, cmd)| match cmd {
                IpcCommand::LoadHistory(load) => Some(load.messages.clone()),
                _ => None,
            })
            .collect()
    }
    fn confirmed_pid(&self, session_id: &str) -> Option<u32> {
        self.confirmed.lock().unwrap().get(session_id).copied()
    }
    fn broadcast(&self, session_id: &str, item: BroadcastItem) {
        let tx = self.channels.lock().unwrap().get(session_id).cloned();
        if let Some(tx) = tx {
            let _ = tx.send(item);
        }
    }
    fn play(&self, session_id: &str, reply: Reply) {
        let event = |e: IpcEvent| BroadcastItem::Event(Box::new(e));
        match reply {
            Reply::Loaded => {
                self.timeline.lock().unwrap().push("history_loaded".into());
                self.broadcast(session_id, event(history_loaded(session_id)));
            }
            Reply::Refuse => {
                self.broadcast(session_id, event(load_history_error(session_id, "error")));
            }
            Reply::WarnThenLoaded => {
                self.broadcast(session_id, event(load_history_error(session_id, "warning")));
                self.timeline.lock().unwrap().push("history_loaded".into());
                self.broadcast(session_id, event(history_loaded(session_id)));
            }
            Reply::Exit => {
                self.alive.lock().unwrap().remove(session_id);
                self.ready.lock().unwrap().remove(session_id);
                self.broadcast(
                    session_id,
                    BroadcastItem::Closed {
                        code: Some(1),
                        signal: None,
                        quiet: true,
                    },
                );
            }
            Reply::Silent => {}
        }
    }
    async fn spawn_inner(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
        held: bool,
    ) -> Result<u32, RunnerSpawnError> {
        let session_id = args.session_id.clone();
        self.spawns
            .lock()
            .unwrap()
            .push((args, active_session_id.map(str::to_string)));
        let gate = self.gates.lock().unwrap().get(&session_id).cloned();
        if let Some(gate) = gate {
            gate.notified().await;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
        let pid = 5000 + self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.mark_alive(&session_id, pid);
        // A new process: no confirmation, a fresh ready cache.
        self.confirmed.lock().unwrap().remove(&session_id);
        if self.auto_ready {
            self.ready
                .lock()
                .unwrap()
                .insert(session_id.clone(), ready_event(&session_id));
        } else {
            self.ready.lock().unwrap().remove(&session_id);
        }
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(session_id, tx);
        self.hook(format!(
            "{}:{pid}",
            if held { "spawn_held" } else { "spawn" }
        ));
        Ok(pid)
    }
}

fn history_loaded(session_id: &str) -> IpcEvent {
    IpcEvent::HistoryLoaded(HistoryLoadedEvent {
        session_id: session_id.into(),
        message_count: 0,
        timestamp: "t".into(),
    })
}

fn load_history_error(session_id: &str, severity: &str) -> IpcEvent {
    IpcEvent::Error(ErrorEvent {
        session_id: session_id.into(),
        message: format!("History restore: {severity}"),
        category: "business".into(),
        severity: severity.into(),
        retryable: false,
        hint: None,
        context: Some("load_history".into()),
        traceback: None,
        visibility: None,
        timestamp: "t".into(),
    })
}

fn command_kind(cmd: &IpcCommand) -> String {
    serde_json::to_value(cmd).unwrap()["kind"]
        .as_str()
        .unwrap()
        .to_string()
}

#[async_trait]
impl RunnerPort for ScriptedRunner {
    async fn spawn(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args, active_session_id, false).await
    }
    async fn spawn_held(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args, active_session_id, true).await
    }
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        self.sent
            .lock()
            .unwrap()
            .push((session_id.to_string(), cmd.clone()));
        self.timeline.lock().unwrap().push(command_kind(cmd));
        if let IpcCommand::LoadHistory(_) = cmd {
            let reply = self
                .replies
                .lock()
                .unwrap()
                .get_mut(session_id)
                .and_then(VecDeque::pop_front)
                .unwrap_or(Reply::Loaded);
            self.play(session_id, reply);
        }
        Ok(())
    }
    async fn hold_close(&self, session_id: &str, pid: u32) -> bool {
        self.hook(format!("hold:{pid}"));
        self.alive.lock().unwrap().get(session_id) == Some(&pid)
    }
    async fn release_close(
        &self,
        session_id: &str,
        pid: u32,
        history_confirmed: bool,
    ) -> Option<HeldClose> {
        self.hook(format!("release:{pid}:{history_confirmed}"));
        if history_confirmed {
            self.confirmed
                .lock()
                .unwrap()
                .insert(session_id.into(), pid);
        }
        // A runner that exited while held hands its close back.
        (self.alive.lock().unwrap().get(session_id) != Some(&pid)).then_some(HeldClose {
            code: Some(1),
            signal: None,
        })
    }
    async fn retire(&self, session_id: &str, pid: u32) -> bool {
        self.hook(format!("retire:{pid}"));
        // A retired runner's close is quiet, like the real registry's.
        self.broadcast(
            session_id,
            BroadcastItem::Closed {
                code: Some(0),
                signal: None,
                quiet: true,
            },
        );
        self.alive.lock().unwrap().remove(session_id);
        self.registered.lock().unwrap().remove(session_id);
        self.ready.lock().unwrap().remove(session_id);
        true
    }
    async fn history_confirmed(&self, session_id: &str, pid: u32) -> bool {
        self.confirmed_pid(session_id) == Some(pid)
            && self.alive.lock().unwrap().get(session_id) == Some(&pid)
    }
    async fn run_state(&self, session_id: &str) -> RunState {
        self.run_states
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }
    async fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        *self
            .subscribes
            .lock()
            .unwrap()
            .entry(session_id.to_string())
            .or_default() += 1;
        self.channels
            .lock()
            .unwrap()
            .get(session_id)
            .map(broadcast::Sender::subscribe)
    }
    async fn pid(&self, session_id: &str) -> Option<u32> {
        self.registered.lock().unwrap().get(session_id).copied()
    }
    async fn live_pid(&self, session_id: &str) -> Option<u32> {
        self.alive.lock().unwrap().get(session_id).copied()
    }
    async fn ready_snapshot(&self, session_id: &str) -> Option<ReadySnapshot> {
        self.ready.lock().unwrap().get(session_id).cloned()
    }
    fn command_sink(&self) -> Option<Arc<dyn RunnerCommandSink>> {
        self.sink
            .clone()
            .map(|sink| sink as Arc<dyn RunnerCommandSink>)
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        false
    }
    async fn shutdown(
        &self,
        _session_id: &str,
        _grace: Option<Duration>,
    ) -> Result<(), ShutdownError> {
        Ok(())
    }
}

/// Managed-runtime stand-in for the Tauri app: a fixed bridge cwd and a
/// `prepare_managed` that does what the real one does to the args'
/// shape (code root, env, key → index) without touching disk.
struct FakeEnv {
    bridge_cwd: PathBuf,
}

#[async_trait]
impl SpawnEnv for FakeEnv {
    fn bundled_python(&self) -> Option<PathBuf> {
        Some(PathBuf::from("/bundle/python/bin/python3"))
    }
    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        Ok(self.bridge_cwd.clone())
    }
    async fn prepare_managed(&self, mut args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        if args.llm_key.is_some() {
            args.llm_index = Some(0);
        }
        args.llm_key = None;
        args.ga_path = PathBuf::from("/managed/code");
        args.bridge_cwd = self.bridge_cwd.clone();
        args.cwd = None;
        args.env
            .push(("GALLEY_RUNTIME_KIND".into(), "managed".into()));
        Ok(args)
    }
}

fn gui_options(ga_config: Option<GaConfigPref>) -> EnsureOptions<'static> {
    EnsureOptions {
        via: "gui",
        active_session_id: None,
        llm_override: None,
        ga_config,
        holds_run_gate: false,
        timeouts: Default::default(),
    }
}

fn ready_event(session_id: &str) -> ReadyEvent {
    ReadyEvent {
        session_id: session_id.into(),
        protocol_version: "0.1".into(),
        ga_commit: "c".into(),
        ga_commit_date: "d".into(),
        ga_path: "/ga".into(),
        llm_name: "B/b".into(),
        cwd: "/".into(),
        pid: 77,
        available_llms: vec![
            json!({"index": 1, "name": "B/b", "displayName": "b", "isCurrent": true}),
        ],
        images_supported: false,
        reasoning_effort: Some("high".into()),
        configured_reasoning_effort: None,
        timestamp: "t".into(),
    }
}

async fn dispatch(ctx: &HandlerCtx<'_>, req: Value) -> SocketResponse {
    let line = serde_json::to_string(&req).unwrap();
    match dispatch_line_with(ctx, &line).await {
        DispatchResult::Unary(resp) => resp,
        DispatchResult::Stream { .. } => panic!("expected unary response"),
    }
}

// ---------------- single flight + liveness ----------------

#[tokio::test]
async fn concurrent_ensures_for_one_session_spawn_once_and_share_the_pid() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-race")).await;
    let runner = ScriptedRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: notifier.clone(),
        env: None,
    };

    let (a, b) = tokio::join!(
        ensure_session_runner(&host, "s-race", gui_options(None)),
        ensure_session_runner(&host, "s-race", gui_options(None)),
    );
    let (a, b) = (a.expect("first ensure"), b.expect("second ensure"));

    assert_eq!(runner.spawn_count(), 1, "one session, one spawn");
    assert_eq!(a.pid, b.pid, "both callers get the same runner");
    assert_ne!(a.spawned, b.spawned, "exactly one caller started it");
    assert_eq!(notifier.count("runner-spawned-external"), 1);
    assert_eq!(
        notifier.payload_of("runner-spawned-external").unwrap()["via"],
        "gui"
    );
}

#[tokio::test]
async fn ensure_returns_a_live_runner_with_its_ready_snapshot_and_never_spawns() {
    let galley = fresh_galley().await;
    seed_session(&galley, SessionSeed::external("s-live")).await;
    let runner = ScriptedRunner::default();
    runner.mark_alive("s-live", 4242);
    runner
        .ready
        .lock()
        .unwrap()
        .insert("s-live".into(), ready_event("s-live"));
    let notifier = Arc::new(RecordingNotifier::default());
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: notifier.clone(),
        env: None,
    };

    // No ga_config pref at all: an alive runner must not even resolve args.
    let outcome = ensure_session_runner(&host, "s-live", gui_options(None))
        .await
        .expect("ensure");

    assert_eq!(outcome.pid, 4242);
    assert!(!outcome.spawned);
    let ready = outcome.ready.expect("snapshot handed out");
    assert_eq!(ready.llm_name, "B/b");
    assert!(!ready.images_supported);
    assert_eq!(runner.spawn_count(), 0);
    assert_eq!(notifier.count("runner-spawned-external"), 0);
}

#[tokio::test]
async fn ensure_respawns_a_runner_that_is_registered_but_dead() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-crashed")).await;
    let runner = ScriptedRunner::default();
    // A crashed runner stays registered (pid) but is not alive.
    runner
        .registered
        .lock()
        .unwrap()
        .insert("s-crashed".into(), 13);
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: None,
    };

    let outcome = ensure_session_runner(&host, "s-crashed", gui_options(None))
        .await
        .expect("ensure");

    assert!(outcome.spawned);
    assert_ne!(outcome.pid, 13);
    assert_eq!(runner.spawn_count(), 1);
}

#[tokio::test]
async fn ensures_for_different_sessions_never_wait_on_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-slow")).await;
    seed_session(&galley, SessionSeed::external("s-fast")).await;
    let runner = ScriptedRunner::default();
    // s-slow's spawn is parked until s-fast's ensure has finished — if
    // the second ensure waited on the first, neither would ever finish.
    let gate = runner.gate("s-slow");
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: None,
    };

    let both = async {
        tokio::join!(
            ensure_session_runner(&host, "s-slow", gui_options(None)),
            async {
                let fast = ensure_session_runner(&host, "s-fast", gui_options(None)).await;
                gate.notify_one();
                fast
            },
        )
    };
    let (slow, fast) = tokio::time::timeout(Duration::from_secs(5), both)
        .await
        .expect("ensures for different sessions run independently");
    assert!(slow.expect("slow").spawned);
    assert!(fast.expect("fast").spawned);
}

// ---------------- spawn-argument parity ----------------

#[tokio::test]
async fn gui_and_socket_resolve_the_same_spawn_args_external() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    let config = seed_ga_config(&galley, dir.path()).await;
    galley
        .create_project(
            CreateProjectInput {
                id: "p-ws".into(),
                name: "ws".into(),
                root_path: Some(workspace.path().to_str().unwrap().into()),
                workspace_enabled: true,
                icon: None,
                color: None,
            },
            cli_origin(),
        )
        .await
        .expect("seed project");
    seed_session(
        &galley,
        SessionSeed {
            id: "s-ext",
            runtime: RuntimeKind::External,
            project_id: Some("p-ws"),
            llm_index: Some(2),
            llm_key: Some("NativeClaudeSession/glm"),
        },
    )
    .await;
    galley
        .set_session_reasoning_effort(SessionId("s-ext".into()), Some("high".into()), cli_origin())
        .await
        .expect("seed effort");

    // Socket: the Goal engine's dispatch goes through the socket layer's
    // ensure wrapper (headless, so the stored pref supplies bridgeCwd).
    let socket_runner = ScriptedRunner::default();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &socket_runner,
        notifier: Arc::new(RecordingNotifier::default()),
        app: None,
    };
    let resp = dispatch(
        &ctx,
        json!({"command": "goal.start", "args": {"sessionId": "s-ext", "objective": "o"},
               "schemaVersion": 2, "requestId": "g"}),
    )
    .await;
    assert!(resp.ok, "goal.start: {resp:?}");
    let socket_args = socket_runner.spawned_args();
    assert_eq!(socket_args.len(), 1);
    assert_eq!(
        socket_runner.spawns.lock().unwrap()[0].1.as_deref(),
        Some("s-ext"),
        "the socket path protects the session it spawns for"
    );

    // GUI: the Tauri command's options, with the page's in-memory
    // gaConfig equal to the stored pref.
    let gui_runner = ScriptedRunner::default();
    let host = RunnerHost {
        galley: &galley,
        runner: &gui_runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: None,
    };
    ensure_session_runner(&host, "s-ext", gui_options(Some(config)))
        .await
        .expect("gui ensure");
    let gui_args = gui_runner.spawned_args();

    assert_eq!(socket_args, gui_args);
    // And both are what the GUI's own TypeScript spawn produced.
    let args = &gui_args[0];
    let home = std::env::var("HOME").unwrap_or_default();
    assert_eq!(
        args.python,
        resolve_user_python(Some("python-brew-intel"), &home)
    );
    assert_eq!(args.python, "/usr/local/bin/python3");
    assert_eq!(args.ga_path, dir.path());
    assert_eq!(args.bridge_cwd, dir.path());
    assert_eq!(args.workspace_root.as_deref(), Some(workspace.path()));
    assert_eq!(args.cwd, None);
    // A stable key wins; the index rides along only without one.
    assert_eq!(args.llm_key.as_deref(), Some("NativeClaudeSession/glm"));
    assert_eq!(args.llm_index, None);
    assert_eq!(args.reasoning_effort.as_deref(), Some("high"));
    assert!(args.env.is_empty());
}

#[tokio::test]
async fn gui_and_socket_resolve_the_same_spawn_args_managed() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    let config = seed_ga_config(&galley, dir.path()).await;
    seed_session(
        &galley,
        SessionSeed {
            id: "s-man",
            runtime: RuntimeKind::Managed,
            project_id: None,
            llm_index: Some(3),
            llm_key: Some("model-id"),
        },
    )
    .await;
    let env = FakeEnv {
        bridge_cwd: dir.path().to_path_buf(),
    };

    // The socket wrapper's options (Goal dispatch): stored pref, protect
    // the session itself. Managed needs the app, so this runs the shared
    // path with the wrapper's options rather than the headless wrapper.
    let socket_runner = ScriptedRunner::default();
    let socket_host = RunnerHost {
        galley: &galley,
        runner: &socket_runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: Some(&env),
    };
    ensure_session_runner(
        &socket_host,
        "s-man",
        EnsureOptions {
            via: "goal",
            active_session_id: Some("s-man"),
            llm_override: None,
            ga_config: None,
            holds_run_gate: true,
            timeouts: Default::default(),
        },
    )
    .await
    .expect("socket ensure");

    let gui_runner = ScriptedRunner::default();
    let gui_host = RunnerHost {
        galley: &galley,
        runner: &gui_runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: Some(&env),
    };
    ensure_session_runner(&gui_host, "s-man", gui_options(Some(config)))
        .await
        .expect("gui ensure");

    let socket_args = socket_runner.spawned_args();
    assert_eq!(socket_args, gui_runner.spawned_args());
    let args = &socket_args[0];
    // Dev build: the configured interpreter, as the GUI's dev spawn used
    // (before 02a the socket path handed managed spawns `python3`).
    assert_eq!(args.python, "/usr/local/bin/python3");
    assert_eq!(args.ga_path, Path::new("/managed/code"));
    assert_eq!(args.llm_index, Some(0), "managed prep resolved the key");
    assert_eq!(args.llm_key, None);
}

#[tokio::test]
async fn managed_spawn_ignores_a_stored_config_without_a_ga_path() {
    // The GUI's hydrate keeps its defaults when the stored ga_config has
    // no gaPath; the socket path now reads it the same way.
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    galley
        .set_pref_json(
            "ga_config",
            json!({"gaPath": "", "python": "python-brew-arm"}),
        )
        .await
        .unwrap();
    seed_session(
        &galley,
        SessionSeed {
            id: "s-man-default",
            runtime: RuntimeKind::Managed,
            project_id: None,
            llm_index: None,
            llm_key: None,
        },
    )
    .await;
    let env = FakeEnv {
        bridge_cwd: dir.path().to_path_buf(),
    };
    let runner = ScriptedRunner::default();
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: Some(&env),
    };
    ensure_session_runner(&host, "s-man-default", gui_options(None))
        .await
        .expect("ensure");
    let expected = if cfg!(windows) { "python" } else { "python3" };
    assert_eq!(runner.spawned_args()[0].python, expected);
}

#[tokio::test]
async fn an_explicit_llm_choice_overrides_the_session_row() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(
        &galley,
        SessionSeed {
            id: "s-pick",
            runtime: RuntimeKind::External,
            project_id: None,
            llm_index: Some(0),
            llm_key: None,
        },
    )
    .await;
    let runner = ScriptedRunner::default();
    let host = RunnerHost {
        galley: &galley,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        env: None,
    };
    ensure_session_runner(
        &host,
        "s-pick",
        EnsureOptions {
            via: "gui",
            active_session_id: None,
            llm_override: Some(galley_core_lib::session_runner::LlmChoice {
                index: Some(4),
                key: None,
            }),
            ga_config: None,
            holds_run_gate: false,
            timeouts: Default::default(),
        },
    )
    .await
    .expect("ensure");
    let args = &runner.spawned_args()[0];
    assert_eq!(args.llm_index, Some(4));
    assert_eq!(args.llm_key, None);
}

// ---------------- frozen socket wording ----------------

/// The exact error texts the socket transport answered before the spawn
/// path moved to `session_runner` (Agent API contract, Rule 3).
#[tokio::test]
async fn socket_spawn_config_errors_keep_their_tags_and_wording() {
    async fn session_new(galley: &SqliteGalley, runtime: &str) -> SocketResponse {
        let runner = ScriptedRunner::default();
        let db = DbSource::Pool(galley.clone());
        let ctx = HandlerCtx {
            db: &db,
            runner: &runner,
            notifier: Arc::new(RecordingNotifier::default()),
            app: None,
        };
        dispatch(
            &ctx,
            json!({"command": "session.new", "args": {"task": "t", "runtimeKind": runtime},
                   "schemaVersion": 1, "requestId": "n"}),
        )
        .await
    }
    fn err(resp: &SocketResponse) -> (String, String) {
        let v = serde_json::to_value(resp).unwrap();
        (
            v["error"].as_str().unwrap_or_default().to_string(),
            v["message"].as_str().unwrap_or_default().to_string(),
        )
    }

    let galley = fresh_galley().await;
    assert_eq!(
        err(&session_new(&galley, "external").await),
        (
            "runner_error".into(),
            "session.new runner config is missing; open Galley Settings once to save runtime paths"
                .into()
        )
    );
    assert_eq!(
        err(&session_new(&galley, "managed").await),
        (
            "runner_error".into(),
            "managed runtime is unavailable without a Galley app handle".into()
        )
    );

    galley
        .set_pref_json("ga_config", json!({"gaPath": "  ", "bridgeCwd": "/tmp"}))
        .await
        .unwrap();
    assert_eq!(
        err(&session_new(&galley, "external").await),
        (
            "runner_error".into(),
            "session.new runner config missing gaPath".into()
        )
    );

    galley
        .set_pref_json("ga_config", json!({"gaPath": 5}))
        .await
        .unwrap();
    let (tag, message) = err(&session_new(&galley, "external").await);
    assert_eq!(tag, "runner_error");
    assert!(
        message.starts_with("ga_config pref shape mismatch: "),
        "{message}"
    );

    let ga = tempfile::tempdir().unwrap();
    let missing_cwd = ga.path().join("missing");
    galley
        .set_pref_json(
            "ga_config",
            json!({"gaPath": ga.path().to_str().unwrap(), "bridgeCwd": missing_cwd.to_str().unwrap()}),
        )
        .await
        .unwrap();
    assert_eq!(
        err(&session_new(&galley, "external").await),
        (
            "runner_error".into(),
            format!(
                "bridge cwd invalid: not a directory: {}",
                missing_cwd.display()
            )
        )
    );

    galley
        .set_pref_json(
            "ga_config",
            json!({"gaPath": missing_cwd.to_str().unwrap(), "bridgeCwd": ga.path().to_str().unwrap()}),
        )
        .await
        .unwrap();
    assert_eq!(
        err(&session_new(&galley, "external").await),
        (
            "ga_path_invalid".into(),
            format!(
                "GA path invalid: not a directory: {}",
                missing_cwd.display()
            )
        )
    );
}

#[tokio::test]
async fn goal_dispatch_ensure_failures_keep_their_recorded_wording() {
    let galley = fresh_galley().await;
    seed_session(&galley, SessionSeed::external("s-goal-cold")).await;
    let runner = ScriptedRunner::default();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        app: None,
    };
    let resp = dispatch(
        &ctx,
        json!({"command": "goal.start", "args": {"sessionId": "s-goal-cold", "objective": "o"},
               "schemaVersion": 2, "requestId": "g"}),
    )
    .await;
    let v = serde_json::to_value(&resp).unwrap();
    assert_eq!(v["error"], "runner_error");
    assert_eq!(
        v["message"],
        "runner spawn: RunnerError(\"session.new runner config is missing; open Galley Settings once to save runtime paths\")"
    );
}

// ---------------- auto-title on socket-started runners ----------------

async fn wait_for_generate_title(sink: &RecordingSink) -> Option<(String, IpcCommand)> {
    for _ in 0..100 {
        let found = sink
            .sent
            .lock()
            .unwrap()
            .iter()
            .find(|(_, cmd)| matches!(cmd, IpcCommand::GenerateTitle(_)))
            .cloned();
        if found.is_some() {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    None
}

fn run_complete(session_id: &str) -> IpcEvent {
    IpcEvent::RunComplete(RunCompleteEvent {
        session_id: session_id.into(),
        exit_reason: json!({"result": "CURRENT_TASK_DONE", "data": null}),
        final_content: "审计完成".into(),
        total_turns: 1,
        visibility: None,
        timestamp: "t".into(),
    })
}

#[tokio::test]
async fn session_new_runner_gets_the_auto_title_watcher() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    let (runner, sink) = ScriptedRunner::with_sink();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        app: None,
    };

    let resp = dispatch(
        &ctx,
        json!({"command": "session.new", "args": {"task": "audit the repo", "runtimeKind": "external"},
               "schemaVersion": 1, "requestId": "n"}),
    )
    .await;
    assert!(resp.ok, "{resp:?}");
    let sid = resp.result.unwrap()["session"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    // Emit task + auto-title watcher.
    assert_eq!(runner.subscribe_count(&sid), 2);

    // `session.new` seeds the default title, so the first finished run
    // asks the runner for a title.
    runner.feed(&sid, run_complete(&sid));
    let (target, cmd) = wait_for_generate_title(&sink)
        .await
        .expect("generate_title sent after run_complete");
    assert_eq!(target, sid);
    let IpcCommand::GenerateTitle(title) = cmd else {
        unreachable!()
    };
    assert_eq!(title.first_user_message, "audit the repo");
    assert_eq!(title.final_answer.as_deref(), Some("审计完成"));
}

#[tokio::test]
async fn goal_dispatch_runner_gets_the_auto_title_watcher() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-goal-title")).await;
    let (runner, _sink) = ScriptedRunner::with_sink();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        app: None,
    };
    let resp = dispatch(
        &ctx,
        json!({"command": "goal.start", "args": {"sessionId": "s-goal-title", "objective": "o"},
               "schemaVersion": 2, "requestId": "g"}),
    )
    .await;
    assert!(resp.ok, "{resp:?}");
    assert_eq!(runner.spawn_count(), 1);
    assert_eq!(runner.subscribe_count("s-goal-title"), 2);
}

// ---------------- history replay (ticket 02b) ----------------

/// Short bounds so the timeout cases finish quickly.
fn fast() -> ReplayTimeouts {
    ReplayTimeouts {
        ready: Duration::from_secs(2),
        history: Duration::from_millis(300),
    }
}

fn replay_options(holds_run_gate: bool) -> EnsureOptions<'static> {
    EnsureOptions {
        via: "gui",
        active_session_id: None,
        llm_override: None,
        ga_config: None,
        holds_run_gate,
        timeouts: fast(),
    }
}

/// One completed exchange, written the way Core writes it: the user row,
/// the one-step reply on the same turn index, the session bump.
async fn seed_exchange(galley: &SqliteGalley, sid: &str, user: &str, reply: &str) {
    let row = galley
        .send_message(SessionId(sid.into()), user.into(), cli_origin())
        .await
        .expect("user row");
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index: row.turn_index.expect("turn index"),
            content: reply.into(),
            tool_calls: None,
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

/// A session with two completed exchanges and a ga_config to spawn with.
async fn session_with_history(sid: &str) -> (tempfile::TempDir, SqliteGalley) {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external(sid)).await;
    seed_exchange(&galley, sid, "记住暗号：蓝鲸 4721", "好").await;
    seed_exchange(&galley, sid, "复述一遍", "蓝鲸 4721").await;
    (dir, galley)
}

fn expected_history() -> Vec<Value> {
    vec![
        json!({"role": "user", "content": "记住暗号：蓝鲸 4721"}),
        json!({"role": "assistant", "content": "好"}),
        json!({"role": "user", "content": "复述一遍"}),
        json!({"role": "assistant", "content": "蓝鲸 4721"}),
    ]
}

fn replay_phases(notifier: &RecordingNotifier, sid: &str) -> Vec<String> {
    notifier
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|(name, payload)| name == "runner-history-replay" && payload["sessionId"] == sid)
        .map(|(_, payload)| payload["phase"].as_str().unwrap().to_string())
        .collect()
}

fn host<'a>(
    galley: &'a SqliteGalley,
    runner: &'a ScriptedRunner,
    notifier: &Arc<RecordingNotifier>,
) -> RunnerHost<'a> {
    RunnerHost {
        galley,
        runner,
        notifier: notifier.clone(),
        env: None,
    }
}

#[tokio::test]
async fn a_spawned_runner_gets_the_history_before_ensure_returns() {
    let (_dir, galley) = session_with_history("s-rp-ok").await;
    // The message persisted for the dispatch this ensure precedes: input,
    // not history.
    galley
        .send_message(
            SessionId("s-rp-ok".into()),
            "暗号是什么？".into(),
            cli_origin(),
        )
        .await
        .unwrap();
    let runner = ScriptedRunner::ready_on_spawn();
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-ok",
        replay_options(false),
    )
    .await
    .expect("ensure");

    assert!(outcome.spawned);
    assert_eq!(runner.load_histories("s-rp-ok"), vec![expected_history()]);
    assert_eq!(runner.confirmed_pid("s-rp-ok"), Some(outcome.pid));
    assert_eq!(
        runner.hooks(),
        vec![
            format!("spawn_held:{}", outcome.pid),
            format!("release:{}:true", outcome.pid),
        ]
    );
    assert_eq!(replay_phases(&notifier, "s-rp-ok"), ["started", "done"]);
    assert_eq!(notifier.count("runner-closed"), 0);

    // Confirmed: the next ensure returns at once and sends nothing.
    let again = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-ok",
        replay_options(false),
    )
    .await
    .expect("second ensure");
    assert_eq!(again.pid, outcome.pid);
    assert!(!again.spawned);
    assert_eq!(runner.load_histories("s-rp-ok").len(), 1);
}

#[tokio::test]
async fn ensure_waits_for_a_ready_that_is_not_cached_yet() {
    let (_dir, galley) = session_with_history("s-rp-wait").await;
    let runner = ScriptedRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());
    let h = host(&galley, &runner, &notifier);

    let feeder = async {
        // Ensure has spawned and subscribed (emit + title-less + replay).
        for _ in 0..100 {
            if runner.subscribe_count("s-rp-wait") >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            runner.load_histories("s-rp-wait").is_empty(),
            "not before ready"
        );
        runner.feed("s-rp-wait", IpcEvent::Ready(ready_event("s-rp-wait")));
    };
    let (outcome, ()) = tokio::join!(
        ensure_session_runner(&h, "s-rp-wait", replay_options(false)),
        feeder
    );
    outcome.expect("ensure");
    assert_eq!(runner.load_histories("s-rp-wait"), vec![expected_history()]);
}

async fn restarts_once_after(first: Reply, sid: &str) {
    let (_dir, galley) = session_with_history(sid).await;
    let runner = ScriptedRunner::ready_on_spawn();
    runner.script(sid, &[first, Reply::Loaded]);
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        sid,
        replay_options(false),
    )
    .await
    .unwrap_or_else(|e| panic!("{first:?}: {e:?}"));

    assert!(outcome.spawned);
    assert_eq!(runner.spawn_count(), 2, "{first:?}: one restart");
    let (a, b) = (5000, 5001);
    assert_eq!(outcome.pid, b);
    assert_eq!(
        runner.hooks(),
        vec![
            format!("spawn_held:{a}"),
            format!("retire:{a}"),
            format!("spawn_held:{b}"),
            format!("release:{b}:true"),
        ],
        "{first:?}"
    );
    // The same args both times.
    let args = runner.spawned_args();
    assert_eq!(args[0], args[1]);
    assert_eq!(
        runner.load_histories(sid),
        vec![expected_history(), expected_history()]
    );
    assert_eq!(runner.confirmed_pid(sid), Some(b));
    assert_eq!(
        replay_phases(&notifier, sid),
        ["started", "failed", "started", "done"],
        "{first:?}"
    );
    // The replacement is announced as a spawn, the retired runner's close
    // is not announced at all.
    assert_eq!(notifier.count("runner-spawned-external"), 2);
    assert_eq!(notifier.count("runner-closed"), 0, "{first:?}");
}

#[tokio::test]
async fn a_refused_replay_restarts_the_runner_once() {
    restarts_once_after(Reply::Refuse, "s-rp-refuse").await;
}

#[tokio::test]
async fn an_unanswered_replay_restarts_the_runner_once() {
    restarts_once_after(Reply::Silent, "s-rp-silent").await;
}

#[tokio::test]
async fn a_runner_exiting_during_replay_is_restarted_once() {
    restarts_once_after(Reply::Exit, "s-rp-exit").await;
}

#[tokio::test]
async fn two_failed_replays_are_a_history_replay_error() {
    let (_dir, galley) = session_with_history("s-rp-twice").await;
    let runner = ScriptedRunner::ready_on_spawn();
    runner.script("s-rp-twice", &[Reply::Refuse, Reply::Refuse]);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-twice",
        replay_options(false),
    )
    .await
    .expect_err("history replay fails");

    let SessionRunnerError::HistoryReplay(reason) = err else {
        panic!("expected HistoryReplay, got {err:?}");
    };
    assert!(reason.contains("refused load_history"), "{reason}");
    assert_eq!(runner.spawn_count(), 2, "one restart, not two");
    // The second runner is left alive, unconfirmed, with Core's hold over.
    assert_eq!(
        runner.hooks().last().map(String::as_str),
        Some("release:5001:false")
    );
    assert_eq!(runner.confirmed_pid("s-rp-twice"), None);
    assert_eq!(
        replay_phases(&notifier, "s-rp-twice"),
        ["started", "failed", "started", "failed"]
    );
    assert_eq!(notifier.count("runner-closed"), 0, "the runner lives");
}

#[tokio::test]
async fn a_held_runner_that_exits_for_good_is_announced_closed() {
    let (_dir, galley) = session_with_history("s-rp-dead").await;
    let runner = ScriptedRunner::ready_on_spawn();
    runner.script("s-rp-dead", &[Reply::Exit, Reply::Exit]);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-dead",
        replay_options(false),
    )
    .await
    .expect_err("history replay fails");
    assert!(matches!(err, SessionRunnerError::HistoryReplay(_)));
    // The first exit was replaced (quiet); the last one is announced once
    // Core lets go of the runner.
    assert_eq!(notifier.count("runner-closed"), 1);
    assert_eq!(
        notifier.payload_of("runner-closed").unwrap(),
        json!({"sessionId": "s-rp-dead", "code": 1, "signal": null})
    );
}

#[tokio::test]
async fn a_load_history_warning_is_not_a_failure() {
    let (_dir, galley) = session_with_history("s-rp-warn").await;
    let runner = ScriptedRunner::ready_on_spawn();
    runner.script("s-rp-warn", &[Reply::WarnThenLoaded]);
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-warn",
        replay_options(false),
    )
    .await
    .expect("a warning still loads");

    assert_eq!(runner.spawn_count(), 1);
    assert_eq!(runner.confirmed_pid("s-rp-warn"), Some(outcome.pid));
    assert_eq!(replay_phases(&notifier, "s-rp-warn"), ["started", "done"]);
}

#[tokio::test]
async fn no_completed_turns_sends_no_load_history_and_waits_for_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-rp-new")).await;
    // The first message is persisted before the ensure; nothing completed.
    galley
        .send_message(SessionId("s-rp-new".into()), "第一条".into(), cli_origin())
        .await
        .unwrap();
    // No `ready` will ever come: an ensure that waited would time out.
    let runner = ScriptedRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-new",
        replay_options(false),
    )
    .await
    .expect("ensure");

    assert!(outcome.spawned);
    assert!(runner.sent.lock().unwrap().is_empty());
    assert_eq!(
        runner.hooks(),
        vec![
            format!("spawn:{}", outcome.pid),
            format!("release:{}:true", outcome.pid),
        ],
        "plain spawn, confirmed as it starts"
    );
    assert!(replay_phases(&notifier, "s-rp-new").is_empty());
}

#[tokio::test]
async fn completed_turns_that_convert_to_nothing_send_no_load_history() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, SessionSeed::external("s-rp-empty")).await;
    // A completed turn whose reply never landed: the lone user message is
    // dropped as a trailing user turn, leaving nothing to send.
    galley
        .send_message(SessionId("s-rp-empty".into()), "q".into(), cli_origin())
        .await
        .unwrap();
    galley
        .bump_session_after_turn(SessionId("s-rp-empty".into()), None, None, false)
        .await
        .unwrap();
    let runner = ScriptedRunner::ready_on_spawn();
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-empty",
        replay_options(false),
    )
    .await
    .expect("ensure");
    assert!(runner.sent.lock().unwrap().is_empty());
    assert_eq!(runner.confirmed_pid("s-rp-empty"), Some(outcome.pid));
    assert!(replay_phases(&notifier, "s-rp-empty").is_empty());
}

#[tokio::test]
async fn a_live_unconfirmed_idle_runner_is_replayed_into() {
    let (_dir, galley) = session_with_history("s-rp-live").await;
    let runner = ScriptedRunner::default();
    runner.mark_alive("s-rp-live", 4242);
    runner
        .ready
        .lock()
        .unwrap()
        .insert("s-rp-live".into(), ready_event("s-rp-live"));
    let (tx, _) = broadcast::channel(64);
    runner
        .channels
        .lock()
        .unwrap()
        .insert("s-rp-live".into(), tx);
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-live",
        replay_options(false),
    )
    .await
    .expect("ensure");

    assert_eq!(outcome.pid, 4242);
    assert!(!outcome.spawned);
    assert!(outcome.ready.is_some());
    assert_eq!(runner.spawn_count(), 0);
    assert_eq!(runner.load_histories("s-rp-live"), vec![expected_history()]);
    assert_eq!(
        runner.hooks(),
        vec!["hold:4242".to_string(), "release:4242:true".to_string()]
    );
    assert_eq!(runner.confirmed_pid("s-rp-live"), Some(4242));
}

#[tokio::test]
async fn a_live_runner_mid_run_is_left_alone() {
    let (_dir, galley) = session_with_history("s-rp-busy").await;
    let runner = ScriptedRunner::default();
    runner.mark_alive("s-rp-busy", 4242);
    let notifier = Arc::new(RecordingNotifier::default());

    for state in [
        RunState {
            agent_running: true,
            ..RunState::default()
        },
        // A run the caller did not reserve.
        RunState {
            open_run: true,
            ..RunState::default()
        },
    ] {
        runner.set_run_state("s-rp-busy", state.clone());
        let outcome = ensure_session_runner(
            &host(&galley, &runner, &notifier),
            "s-rp-busy",
            replay_options(false),
        )
        .await
        .expect("ensure");
        assert_eq!(outcome.pid, 4242, "{state:?}");
        assert!(!outcome.spawned);
        assert!(runner.sent.lock().unwrap().is_empty(), "{state:?}");
        assert!(runner.hooks().is_empty(), "{state:?}: no hold, no confirm");
        assert_eq!(runner.confirmed_pid("s-rp-busy"), None);
    }
}

#[tokio::test]
async fn an_open_gate_the_caller_holds_does_not_block_the_replay() {
    let (_dir, galley) = session_with_history("s-rp-gate").await;
    let runner = ScriptedRunner::default();
    runner.mark_alive("s-rp-gate", 4242);
    runner
        .ready
        .lock()
        .unwrap()
        .insert("s-rp-gate".into(), ready_event("s-rp-gate"));
    let (tx, _) = broadcast::channel(64);
    runner
        .channels
        .lock()
        .unwrap()
        .insert("s-rp-gate".into(), tx);
    // The Goal engine reserved the gate before calling ensure.
    runner.set_run_state(
        "s-rp-gate",
        RunState {
            open_run: true,
            ..RunState::default()
        },
    );
    let notifier = Arc::new(RecordingNotifier::default());

    ensure_session_runner(
        &host(&galley, &runner, &notifier),
        "s-rp-gate",
        replay_options(true),
    )
    .await
    .expect("ensure");
    assert_eq!(runner.load_histories("s-rp-gate"), vec![expected_history()]);
    assert_eq!(runner.confirmed_pid("s-rp-gate"), Some(4242));
}

#[tokio::test]
async fn concurrent_ensures_wait_for_the_replay_to_finish() {
    let (_dir, galley) = session_with_history("s-rp-race").await;
    let runner = ScriptedRunner::ready_on_spawn();
    // The answer comes from the test, once the second ensure is waiting.
    runner.script("s-rp-race", &[Reply::Silent]);
    let notifier = Arc::new(RecordingNotifier::default());
    let h = host(&galley, &runner, &notifier);
    let options = || EnsureOptions {
        timeouts: ReplayTimeouts {
            ready: Duration::from_secs(5),
            history: Duration::from_secs(5),
        },
        ..replay_options(false)
    };

    let second_done = std::sync::atomic::AtomicBool::new(false);
    let answer = async {
        for _ in 0..200 {
            if !runner.load_histories("s-rp-race").is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !second_done.load(Ordering::SeqCst),
            "the second ensure waits for the replay"
        );
        runner.feed("s-rp-race", history_loaded("s-rp-race"));
    };
    let second = async {
        // Let the first ensure take the slot.
        tokio::time::sleep(Duration::from_millis(5)).await;
        let outcome = ensure_session_runner(&h, "s-rp-race", options()).await;
        second_done.store(true, Ordering::SeqCst);
        outcome
    };
    let (first, second, ()) = tokio::join!(
        ensure_session_runner(&h, "s-rp-race", options()),
        second,
        answer
    );
    let (first, second) = (first.expect("first"), second.expect("second"));
    assert_eq!(first.pid, second.pid);
    assert!(first.spawned && !second.spawned);
    assert_eq!(runner.spawn_count(), 1);
    assert_eq!(runner.load_histories("s-rp-race").len(), 1);
}

#[tokio::test]
async fn goal_on_a_cold_session_gets_its_history_before_the_objective() {
    let (_dir, galley) = session_with_history("s-rp-goal").await;
    let runner = ScriptedRunner::ready_on_spawn();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: Arc::new(RecordingNotifier::default()),
        app: None,
    };

    let resp = dispatch(
        &ctx,
        json!({"command": "goal.start",
               "args": {"sessionId": "s-rp-goal", "objective": "暗号是什么？"},
               "schemaVersion": 2, "requestId": "g"}),
    )
    .await;
    assert!(resp.ok, "{resp:?}");
    assert_eq!(resp.result.unwrap()["dispatch"], "dispatched");

    assert_eq!(
        runner.timeline(),
        ["load_history", "history_loaded", "user_message"],
        "the objective goes out only after the runner confirmed the history"
    );
    // The objective row is persisted before the dispatch, but it is the
    // turn being started, not history.
    let history = runner.load_histories("s-rp-goal");
    assert_eq!(history, vec![expected_history()]);
    assert!(!serde_json::to_string(&history)
        .unwrap()
        .contains("暗号是什么"));
}
