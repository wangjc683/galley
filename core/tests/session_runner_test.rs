//! Core's shared "ensure a runner" path (`galley_core_lib::session_runner`,
//! ticket 02a), driven against an in-memory DB and a scripted fake runner
//! registry: single-flight per session, liveness, spawn-argument parity
//! between the GUI's and the socket's entry points, the frozen socket
//! error wording, and the auto-title watcher on socket-started runners.
//!
//! The real `RunnerManager` + mock bridge side (ready cache, concurrent
//! ensure on real processes) lives in `runner_manager_test.rs`.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateProjectInput, CreateSessionInput, GalleyApi, Origin, OriginVia, RuntimeKind, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::{IpcCommand, IpcEvent, ReadyEvent, RunCompleteEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, ReadySnapshot, RunnerCommandSink, RunnerSpawnError, SendCommandError,
    ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::{
    ensure_session_runner, resolve_user_python, EnsureOptions, GaConfigPref, RunnerHost, SpawnEnv,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use std::collections::HashMap;
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

/// Scripted runner registry. `spawn` yields (so a racing caller gets a
/// chance to interleave), optionally parks on a per-session gate, then
/// registers a live pid and a broadcast channel the test can feed.
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
}

#[async_trait]
impl RunnerPort for ScriptedRunner {
    async fn spawn(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
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
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(session_id, tx);
        Ok(pid)
    }
    async fn send_command(
        &self,
        _session_id: &str,
        _cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        Ok(())
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
