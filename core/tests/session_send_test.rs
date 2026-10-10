//! Core's send for the GUI and the phone (`galley_core_lib::session_send`,
//! ticket 02c), driven against an in-memory DB, a scripted runner registry
//! with a queue that follows the real offer rules, and a recording
//! notifier: the step order, the run gate on every way out, images,
//! `/btw`, answers to `ask_user`, the race with a socket send during a
//! history replay, stop, and the first-message title Core now derives on
//! every path that persists a user message (fixture
//! `fixtures/title-derive-cases.json`).

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia, QueuedMessage,
    RuntimeKind, SessionId,
};
use galley_core_lib::db::{MessageAttachmentCreate, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::{ErrorEvent, HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunState, RunnerManager,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::{ReplayTimeouts, RunnerHost, SessionRunnerError};
use galley_core_lib::session_send::{
    send_user_message, stop_session_run, SendError, SendOutcome, SendRequest, StopOutcome,
};
use galley_core_lib::session_title::{derive_title_from_text, derive_title_if_seed};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::broadcast;

// ---------------- fixtures ----------------

const SEED_TITLE: &str = "新对话";

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

fn gui_origin() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
    }
}

async fn seed_session(galley: &SqliteGalley, id: &str, title: &str, runtime: RuntimeKind) {
    galley
        .create_session(
            CreateSessionInput {
                id: id.to_string(),
                title: title.into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(runtime),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            cli_origin(),
        )
        .await
        .expect("seed session");
}

/// A stored `ga_config` pointing at a real directory, so a headless
/// ensure can resolve external spawn arguments.
async fn seed_ga_config(galley: &SqliteGalley, dir: &Path) {
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
        .expect("seed ga_config");
}

/// One completed exchange written straight to the DB (no title logic).
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

async fn title_of(galley: &SqliteGalley, sid: &str) -> (String, String) {
    let title = galley
        .session_brief(SessionId(sid.into()))
        .await
        .expect("session")
        .title;
    let source = galley
        .session_title_source(sid)
        .await
        .expect("title source")
        .expect("session exists");
    (title, source)
}

async fn user_rows(galley: &SqliteGalley, sid: &str) -> Vec<String> {
    galley
        .session_messages(SessionId(sid.into()), None)
        .await
        .expect("messages")
        .into_iter()
        .filter(|m| serde_json::to_value(m.role).unwrap() == "user")
        .map(|m| m.content)
        .collect()
}

/// Attachment files land next to the database (`GALLEY_DB_PATH`); point
/// it at a temp dir once for this test binary.
fn attachment_root() -> &'static Path {
    static ROOT: OnceLock<tempfile::TempDir> = OnceLock::new();
    ROOT.get_or_init(|| {
        let dir = tempfile::tempdir().expect("attachment root");
        std::env::set_var("GALLEY_DB_PATH", dir.path().join("workbench.db"));
        dir
    })
    .path()
}

fn png() -> MessageAttachmentCreate {
    MessageAttachmentCreate {
        mime_type: "image/png".into(),
        bytes: b"png bytes".to_vec(),
        width: Some(2),
        height: Some(1),
    }
}

fn fast() -> ReplayTimeouts {
    ReplayTimeouts {
        ready: Duration::from_secs(2),
        history: Duration::from_secs(2),
    }
}

fn request(sid: &str, text: &str) -> SendRequest {
    SendRequest {
        session_id: sid.into(),
        text: text.into(),
        images: vec![],
        client_request_id: Some("c-1".into()),
        origin: gui_origin(),
        via: "gui",
        llm_override: None,
        ga_config: None,
        timeouts: fast(),
    }
}

fn with_image(mut req: SendRequest) -> SendRequest {
    req.images = vec![png()];
    req
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
    /// Everything but the presentation stream (`runner-event` comes from
    /// a background emit task, so its interleaving is not deterministic).
    fn events(&self) -> Vec<(String, Value)> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name != "runner-event")
            .cloned()
            .collect()
    }
    fn names(&self) -> Vec<String> {
        self.events().into_iter().map(|(name, _)| name).collect()
    }
    fn of(&self, event: &str) -> Vec<Value> {
        self.events()
            .into_iter()
            .filter(|(name, _)| name == event)
            .map(|(_, payload)| payload)
            .collect()
    }
    fn dispatches(&self) -> Vec<String> {
        self.of("user-message-persisted")
            .iter()
            .map(|p| p["dispatch"].as_str().unwrap().to_string())
            .collect()
    }
}

// ---------------- scripted runner registry ----------------

#[derive(Debug, Clone, Copy)]
enum Reply {
    Loaded,
    Refuse,
    Silent,
}

#[derive(Debug, Default, Clone)]
struct Queue {
    open_run: bool,
    ask_pending: bool,
    items: Vec<QueuedMessage>,
}

impl Queue {
    /// `RunnerManager::queue_offer`'s dispatch-now rule.
    fn may_dispatch_now(&self) -> bool {
        !self.open_run && (self.items.is_empty() || self.ask_pending)
    }
}

/// Runner registry fake. Spawns register a live pid and a broadcast the
/// test can feed; `load_history` is answered from a per-session script
/// (default `Loaded`); the queue and run gate follow the real manager's
/// rules, including the send funnel (a delivered `user_message` /
/// `ask_user_response` opens the gate and clears a pending question).
#[derive(Default)]
struct SendRunner {
    spawns: Mutex<Vec<SpawnArgs>>,
    spawn_fails: AtomicBool,
    dispatch_fails: AtomicBool,
    alive: Mutex<HashMap<String, u32>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    /// `imagesSupported` of the `ready` every spawned runner reports at
    /// once (`None`: it reports none).
    ready_on_spawn: Option<bool>,
    next_pid: AtomicU32,
    sent: Mutex<Vec<(String, IpcCommand)>>,
    timeline: Mutex<Vec<String>>,
    replies: Mutex<HashMap<String, VecDeque<Reply>>>,
    confirmed: Mutex<HashMap<String, u32>>,
    agent_running: Mutex<HashMap<String, bool>>,
    queues: Mutex<HashMap<String, Queue>>,
}

impl SendRunner {
    fn ready_on_spawn() -> Self {
        Self {
            ready_on_spawn: Some(true),
            ..Self::default()
        }
    }
    /// A live runner Core already confirmed, with a `ready` on record.
    fn live(&self, sid: &str, pid: u32, images_supported: bool) {
        self.alive.lock().unwrap().insert(sid.into(), pid);
        self.confirmed.lock().unwrap().insert(sid.into(), pid);
        self.ready
            .lock()
            .unwrap()
            .insert(sid.into(), ready_event(sid, images_supported));
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid.into(), tx);
    }
    fn queue(&self, sid: &str) -> Queue {
        self.queues
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default()
    }
    fn set_queue(&self, sid: &str, queue: Queue) {
        self.queues.lock().unwrap().insert(sid.into(), queue);
    }
    fn script(&self, sid: &str, replies: &[Reply]) {
        self.replies
            .lock()
            .unwrap()
            .insert(sid.into(), replies.iter().copied().collect());
    }
    fn sent(&self) -> Vec<IpcCommand> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .map(|(_, cmd)| cmd.clone())
            .collect()
    }
    fn timeline(&self) -> Vec<String> {
        self.timeline.lock().unwrap().clone()
    }
    fn load_history_sent(&self) -> bool {
        self.sent()
            .iter()
            .any(|cmd| matches!(cmd, IpcCommand::LoadHistory(_)))
    }
    fn broadcast(&self, sid: &str, event: IpcEvent) {
        let tx = self.channels.lock().unwrap().get(sid).cloned();
        if let Some(tx) = tx {
            let _ = tx.send(BroadcastItem::Event(Box::new(event)));
        }
    }
    fn play(&self, sid: &str, reply: Reply) {
        match reply {
            Reply::Loaded => {
                self.timeline.lock().unwrap().push("history_loaded".into());
                self.broadcast(sid, history_loaded(sid));
            }
            Reply::Refuse => self.broadcast(sid, load_history_refused(sid)),
            Reply::Silent => {}
        }
    }
    async fn spawn_inner(&self, args: SpawnArgs) -> Result<u32, RunnerSpawnError> {
        let sid = args.session_id.clone();
        self.spawns.lock().unwrap().push(args);
        if self.spawn_fails.load(Ordering::SeqCst) {
            return Err(RunnerSpawnError::SpawnIo {
                detail: "fork failed".into(),
            });
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        let pid = 6000 + self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.alive.lock().unwrap().insert(sid.clone(), pid);
        self.confirmed.lock().unwrap().remove(&sid);
        match self.ready_on_spawn {
            Some(images) => {
                self.ready
                    .lock()
                    .unwrap()
                    .insert(sid.clone(), ready_event(&sid, images));
            }
            None => {
                self.ready.lock().unwrap().remove(&sid);
            }
        }
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid, tx);
        Ok(pid)
    }
}

fn ready_event(sid: &str, images_supported: bool) -> ReadyEvent {
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
        images_supported,
        reasoning_effort: None,
        configured_reasoning_effort: None,
        timestamp: "t".into(),
    }
}

fn history_loaded(sid: &str) -> IpcEvent {
    IpcEvent::HistoryLoaded(HistoryLoadedEvent {
        session_id: sid.into(),
        message_count: 0,
        timestamp: "t".into(),
    })
}

fn load_history_refused(sid: &str) -> IpcEvent {
    IpcEvent::Error(ErrorEvent {
        session_id: sid.into(),
        message: "History restore refused".into(),
        category: "business".into(),
        severity: "error".into(),
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
impl RunnerPort for SendRunner {
    async fn spawn(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn spawn_held(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        self.sent
            .lock()
            .unwrap()
            .push((sid.to_string(), cmd.clone()));
        self.timeline.lock().unwrap().push(command_kind(cmd));
        if let IpcCommand::LoadHistory(_) = cmd {
            let reply = self
                .replies
                .lock()
                .unwrap()
                .get_mut(sid)
                .and_then(VecDeque::pop_front)
                .unwrap_or(Reply::Loaded);
            self.play(sid, reply);
            return Ok(());
        }
        let gone = || SendCommandError::ProcessGone {
            session_id: sid.to_string(),
        };
        if self.dispatch_fails.load(Ordering::SeqCst)
            || !self.alive.lock().unwrap().contains_key(sid)
        {
            return Err(gone());
        }
        let opens = match cmd {
            IpcCommand::UserMessage(m) => !is_side_question(&m.text),
            IpcCommand::AskUserResponse(_) => true,
            _ => false,
        };
        if opens {
            let mut queues = self.queues.lock().unwrap();
            let q = queues.entry(sid.to_string()).or_default();
            q.open_run = true;
            q.ask_pending = false;
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
    async fn retire(&self, sid: &str, _pid: u32) -> bool {
        self.alive.lock().unwrap().remove(sid);
        self.ready.lock().unwrap().remove(sid);
        true
    }
    async fn history_confirmed(&self, sid: &str, pid: u32) -> bool {
        self.confirmed.lock().unwrap().get(sid) == Some(&pid)
            && self.alive.lock().unwrap().get(sid) == Some(&pid)
    }
    async fn queue_offer(&self, sid: &str, text: String, origin: Option<Origin>) -> QueueOffer {
        let mut queues = self.queues.lock().unwrap();
        let q = queues.entry(sid.to_string()).or_default();
        if q.may_dispatch_now() {
            q.open_run = true;
            return QueueOffer::DispatchNow;
        }
        let queue_id = format!("qm_{}", q.items.len());
        q.items.push(QueuedMessage {
            queue_id: queue_id.clone(),
            text,
            origin,
            queued_at: "t".into(),
        });
        QueueOffer::Queued {
            queue_id,
            position: q.items.len() - 1,
        }
    }
    async fn queue_try_reserve(&self, sid: &str) -> bool {
        let mut queues = self.queues.lock().unwrap();
        let q = queues.entry(sid.to_string()).or_default();
        if q.may_dispatch_now() {
            q.open_run = true;
            true
        } else {
            false
        }
    }
    async fn queue_release_run(&self, sid: &str) {
        if let Some(q) = self.queues.lock().unwrap().get_mut(sid) {
            q.open_run = false;
        }
    }
    async fn queue_snapshot(&self, sid: &str) -> Vec<QueuedMessage> {
        self.queue(sid).items
    }
    async fn run_state(&self, sid: &str) -> RunState {
        let q = self.queue(sid);
        let runner_alive = self.alive.lock().unwrap().contains_key(sid);
        RunState {
            runner_alive,
            agent_running: self.agent_running(sid).await,
            open_run: q.open_run,
            queued_count: q.items.len(),
            ask_pending: q.ask_pending,
            last_exit: None,
        }
    }
}

fn host<'a>(
    galley: &'a SqliteGalley,
    runner: &'a SendRunner,
    notifier: &Arc<RecordingNotifier>,
) -> RunnerHost<'a> {
    RunnerHost {
        galley,
        runner,
        notifier: notifier.clone(),
        env: None,
    }
}

async fn dispatch(ctx: &HandlerCtx<'_>, req: Value) -> SocketResponse {
    let line = serde_json::to_string(&req).unwrap();
    match dispatch_line_with(ctx, &line).await {
        DispatchResult::Unary(resp) => resp,
        DispatchResult::Stream { .. } => panic!("expected unary response"),
    }
}

// ---------------- the dispatched path ----------------

#[tokio::test]
async fn a_cold_session_send_persists_restores_and_dispatches_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    // Still wearing the seed title, with history to restore.
    seed_session(&galley, "s-cold", SEED_TITLE, RuntimeKind::External).await;
    seed_exchange(&galley, "s-cold", "记住暗号：蓝鲸 4721", "好").await;
    let runner = SendRunner::ready_on_spawn();
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-cold", "暗号是什么？\n只回答暗号"),
    )
    .await
    .expect("send");

    let SendOutcome::Dispatched {
        message,
        runner: ensured,
    } = outcome
    else {
        panic!("expected Dispatched, got {outcome:?}");
    };
    assert!(ensured.spawned);
    assert_eq!(message.content, "暗号是什么？\n只回答暗号");
    // The history went in before the message did.
    assert_eq!(
        runner.timeline(),
        ["load_history", "history_loaded", "user_message"]
    );
    let IpcCommand::UserMessage(sent) = runner.sent().pop().unwrap() else {
        panic!("expected user_message");
    };
    assert_eq!(sent.absolute_turn_index, message.turn_index.map(i64::from));
    assert!(sent.images.is_empty());

    // pending → the title → (runner up, history restored) → dispatched.
    assert_eq!(
        notifier.names(),
        [
            "user-message-persisted",
            "session-updated-external",
            "runner-spawned-external",
            "runner-history-replay",
            "runner-history-replay",
            "user-message-persisted",
        ]
    );
    let persisted = notifier.of("user-message-persisted");
    assert_eq!(notifier.dispatches(), ["pending", "dispatched"]);
    for payload in &persisted {
        assert_eq!(payload["clientRequestId"], "c-1");
        assert_eq!(payload["sessionId"], "s-cold");
        assert_eq!(payload["message"]["id"], json!(message.id.0));
    }
    let titled = &notifier.of("session-updated-external")[0];
    assert_eq!(titled["session"]["title"], "暗号是什么？ 只回答暗号");
    assert_eq!(titled["via"], "title-derive");
    assert_eq!(
        title_of(&galley, "s-cold").await,
        ("暗号是什么？ 只回答暗号".into(), "derived".into())
    );
    // The run is open (the gate stays reserved for it).
    assert!(runner.queue("s-cold").open_run);
}

#[tokio::test]
async fn images_go_to_the_runner_as_the_persisted_attachment_paths() {
    attachment_root();
    let galley = fresh_galley().await;
    seed_session(&galley, "s-img", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-img", 4242, true);
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &notifier),
        with_image(request("s-img", "看图")),
    )
    .await
    .expect("send");

    let SendOutcome::Dispatched {
        message,
        runner: ensured,
    } = outcome
    else {
        panic!("expected Dispatched, got {outcome:?}");
    };
    assert!(!ensured.spawned);
    assert_eq!(message.attachments.len(), 1);
    let path = &message.attachments[0].path;
    assert!(Path::new(path).starts_with(attachment_root()), "{path}");
    let IpcCommand::UserMessage(sent) = runner.sent().pop().unwrap() else {
        panic!("expected user_message");
    };
    assert_eq!(sent.images, vec![path.clone()]);
    // A named session keeps its title.
    assert_eq!(notifier.of("session-updated-external").len(), 0);
}

#[tokio::test]
async fn managed_sessions_take_images_whatever_the_snapshot_says() {
    attachment_root();
    let galley = fresh_galley().await;
    seed_session(&galley, "s-man-img", "named", RuntimeKind::Managed).await;
    let runner = SendRunner::default();
    runner.live("s-man-img", 4242, false);
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &notifier),
        with_image(request("s-man-img", "看图")),
    )
    .await
    .expect("managed always delivers images");
    assert!(matches!(outcome, SendOutcome::Dispatched { .. }));
}

// ---------------- the run gate ----------------

#[tokio::test]
async fn text_sent_during_an_open_run_is_queued_and_not_persisted() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-busy", SEED_TITLE, RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-busy", 4242, true);
    runner.set_queue(
        "s-busy",
        Queue {
            open_run: true,
            ..Queue::default()
        },
    );
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-busy", "next"),
    )
    .await
    .expect("send");

    let SendOutcome::Queued { queue_id, position } = outcome else {
        panic!("expected Queued, got {outcome:?}");
    };
    assert_eq!(position, 0);
    assert_eq!(runner.queue("s-busy").items[0].queue_id, queue_id);
    assert_eq!(
        runner.queue("s-busy").items[0].origin.as_ref().unwrap().via,
        OriginVia::Gui
    );
    assert_eq!(notifier.names(), ["session-queue:changed"]);
    assert_eq!(
        notifier.of("session-queue:changed")[0]["items"][0]["text"],
        "next"
    );
    assert!(user_rows(&galley, "s-busy").await.is_empty());
    assert!(runner.sent().is_empty());
    // Not persisted, so not titled yet either (the drain will).
    assert_eq!(title_of(&galley, "s-busy").await.1, "seed");
}

#[tokio::test]
async fn images_while_a_run_is_open_are_refused_and_change_nothing() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-busy-img", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-busy-img", 4242, true);
    let notifier = Arc::new(RecordingNotifier::default());

    for queue in [
        // A run is open.
        Queue {
            open_run: true,
            ..Queue::default()
        },
        // No run, but messages are waiting.
        Queue {
            items: vec![QueuedMessage {
                queue_id: "qm_held".into(),
                text: "held".into(),
                origin: None,
                queued_at: "t".into(),
            }],
            ..Queue::default()
        },
    ] {
        runner.set_queue("s-busy-img", queue.clone());
        let err = send_user_message(
            &host(&galley, &runner, &notifier),
            with_image(request("s-busy-img", "看图")),
        )
        .await
        .expect_err("refused");
        assert!(matches!(err, SendError::ImagesNotQueueable), "{err:?}");
        assert_eq!(err.tag(), Some("images_not_queueable"));
        let after = runner.queue("s-busy-img");
        assert_eq!(after.open_run, queue.open_run, "gate untouched");
        assert_eq!(after.items.len(), queue.items.len(), "nothing queued");
    }
    assert!(notifier.names().is_empty());
    assert!(user_rows(&galley, "s-busy-img").await.is_empty());
}

#[tokio::test]
async fn a_pending_question_makes_the_send_its_answer() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-ask", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-ask", 4242, true);
    runner.set_queue(
        "s-ask",
        Queue {
            ask_pending: true,
            ..Queue::default()
        },
    );
    let notifier = Arc::new(RecordingNotifier::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-ask", "用方案 B"),
    )
    .await
    .expect("send");

    let SendOutcome::Dispatched { message, .. } = outcome else {
        panic!("expected Dispatched, got {outcome:?}");
    };
    let IpcCommand::AskUserResponse(answer) = runner.sent().pop().unwrap() else {
        panic!("expected ask_user_response");
    };
    assert_eq!(answer.text, "用方案 B");
    assert_eq!(
        answer.absolute_turn_index,
        message.turn_index.map(i64::from)
    );
    let after = runner.queue("s-ask");
    assert!(after.open_run && !after.ask_pending, "the answer's run");
    assert_eq!(notifier.dispatches(), ["pending", "dispatched"]);
}

#[tokio::test]
async fn images_on_an_answer_are_refused_and_release_the_gate() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-ask-img", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-ask-img", 4242, true);
    runner.set_queue(
        "s-ask-img",
        Queue {
            ask_pending: true,
            ..Queue::default()
        },
    );
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        with_image(request("s-ask-img", "看图")),
    )
    .await
    .expect_err("refused");
    assert!(matches!(err, SendError::ImagesNotAllowed(_)), "{err:?}");
    assert_eq!(err.tag(), Some("images_not_allowed"));
    let after = runner.queue("s-ask-img");
    assert!(!after.open_run, "gate released");
    assert!(after.ask_pending, "the question still waits");
    assert!(runner.sent().is_empty());
    assert!(notifier.names().is_empty());
    assert!(user_rows(&galley, "s-ask-img").await.is_empty());
}

#[tokio::test]
async fn an_attached_model_without_image_support_refuses_images() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-noimg", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-noimg", 4242, false);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        with_image(request("s-noimg", "看图")),
    )
    .await
    .expect_err("refused");
    assert!(matches!(err, SendError::ImagesNotSupported), "{err:?}");
    assert_eq!(err.tag(), Some("images_not_supported"));
    assert!(!runner.queue("s-noimg").open_run, "gate released");
    assert!(runner.sent().is_empty());
    assert!(notifier.names().is_empty());
    assert!(user_rows(&galley, "s-noimg").await.is_empty());
}

// ---------------- /btw ----------------

#[tokio::test]
async fn a_side_question_is_neither_persisted_nor_gated() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-btw", SEED_TITLE, RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-btw", 4242, true);
    let notifier = Arc::new(RecordingNotifier::default());

    for open_run in [true, false] {
        runner.set_queue(
            "s-btw",
            Queue {
                open_run,
                ..Queue::default()
            },
        );
        runner
            .agent_running
            .lock()
            .unwrap()
            .insert("s-btw".into(), open_run);
        let outcome = send_user_message(
            &host(&galley, &runner, &notifier),
            request("s-btw", "  /btw 进度如何"),
        )
        .await
        .expect("send");
        let SendOutcome::SideQuestion { runner: ensured } = outcome else {
            panic!("expected SideQuestion, got {outcome:?}");
        };
        assert_eq!(ensured.pid, 4242);
        let IpcCommand::UserMessage(sent) = runner.sent().pop().unwrap() else {
            panic!("expected user_message");
        };
        assert_eq!(sent.text, "  /btw 进度如何");
        assert!(sent.images.is_empty());
        assert_eq!(sent.absolute_turn_index, None);
        let after = runner.queue("s-btw");
        assert_eq!(after.open_run, open_run, "gate untouched");
        assert!(after.items.is_empty(), "never queued");
    }
    assert!(user_rows(&galley, "s-btw").await.is_empty());
    assert!(notifier.names().is_empty(), "{:?}", notifier.names());
    assert_eq!(title_of(&galley, "s-btw").await.1, "seed");

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        with_image(request("s-btw", "/btw 看图")),
    )
    .await
    .expect_err("refused");
    assert!(matches!(err, SendError::ImagesNotAllowed(_)), "{err:?}");
}

// ---------------- failures release the gate ----------------

async fn assert_failed_after_persist(
    galley: &SqliteGalley,
    runner: &SendRunner,
    notifier: &RecordingNotifier,
    sid: &str,
) {
    assert!(!runner.queue(sid).open_run, "gate released");
    assert_eq!(notifier.dispatches(), ["pending", "persisted_only"]);
    let persisted = notifier.of("user-message-persisted");
    assert_eq!(persisted[0]["message"]["id"], persisted[1]["message"]["id"]);
    assert_eq!(persisted[1]["clientRequestId"], "c-1");
    assert_eq!(user_rows(galley, sid).await.last().unwrap(), "do it");
}

#[tokio::test]
async fn a_failed_spawn_releases_the_gate_and_reports_persisted_only() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, "s-nospawn", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.spawn_fails.store(true, Ordering::SeqCst);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-nospawn", "do it"),
    )
    .await
    .expect_err("spawn fails");
    assert!(
        matches!(
            err,
            SendError::Runner(SessionRunnerError::Spawn(RunnerSpawnError::SpawnIo { .. }))
        ),
        "{err:?}"
    );
    assert_failed_after_persist(&galley, &runner, &notifier, "s-nospawn").await;
}

#[tokio::test]
async fn a_failed_replay_releases_the_gate_and_reports_persisted_only() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, "s-noreplay", "named", RuntimeKind::External).await;
    seed_exchange(&galley, "s-noreplay", "q", "a").await;
    let runner = SendRunner::ready_on_spawn();
    runner.script("s-noreplay", &[Reply::Refuse, Reply::Refuse]);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-noreplay", "do it"),
    )
    .await
    .expect_err("replay fails");
    assert!(
        matches!(err, SendError::Runner(SessionRunnerError::HistoryReplay(_))),
        "{err:?}"
    );
    assert_eq!(runner.spawns.lock().unwrap().len(), 2, "one quiet restart");
    assert!(
        !runner
            .sent()
            .iter()
            .any(|cmd| matches!(cmd, IpcCommand::UserMessage(_))),
        "nothing dispatched onto an empty history"
    );
    assert_failed_after_persist(&galley, &runner, &notifier, "s-noreplay").await;
}

#[tokio::test]
async fn a_failed_dispatch_releases_the_gate_and_reports_persisted_only() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-nodispatch", "named", RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-nodispatch", 4242, true);
    runner.dispatch_fails.store(true, Ordering::SeqCst);
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-nodispatch", "do it"),
    )
    .await
    .expect_err("dispatch fails");
    assert!(matches!(err, SendError::DispatchFailed(_)), "{err:?}");
    assert_eq!(err.tag(), Some("dispatch_failed"));
    assert_failed_after_persist(&galley, &runner, &notifier, "s-nodispatch").await;
}

#[tokio::test]
async fn archived_and_missing_sessions_are_not_writable() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-archived", "named", RuntimeKind::External).await;
    galley
        .archive_session(SessionId("s-archived".into()), cli_origin())
        .await
        .unwrap();
    let runner = SendRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-archived", "hi"),
    )
    .await
    .expect_err("archived");
    let SendError::Db(e) = err else {
        panic!("expected Db, got {err:?}");
    };
    assert_eq!(serde_json::to_value(&e).unwrap()["error"], "invalid_args");

    let err = send_user_message(
        &host(&galley, &runner, &notifier),
        request("s-missing", "/btw hi"),
    )
    .await
    .expect_err("missing");
    let SendError::Db(e) = err else {
        panic!("expected Db, got {err:?}");
    };
    assert_eq!(serde_json::to_value(&e).unwrap()["error"], "not_found");

    assert!(notifier.names().is_empty());
    assert!(runner.queues.lock().unwrap().is_empty(), "no gate touched");
    assert!(runner.sent().is_empty());
}

// ---------------- the replay window (02b's leftover race) ----------------

#[tokio::test]
async fn a_socket_send_during_the_replay_window_is_queued() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, "s-race", "named", RuntimeKind::External).await;
    seed_exchange(&galley, "s-race", "q", "a").await;
    let runner = SendRunner::ready_on_spawn();
    // The runner answers the replay only when the test says so.
    runner.script("s-race", &[Reply::Silent]);
    let notifier = Arc::new(RecordingNotifier::default());
    let h = host(&galley, &runner, &notifier);
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };

    let mut req = request("s-race", "GUI 的消息");
    req.timeouts = ReplayTimeouts {
        ready: Duration::from_secs(5),
        history: Duration::from_secs(5),
    };
    let cli = async {
        for _ in 0..200 {
            if runner.load_history_sent() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(runner.load_history_sent(), "the send is replaying");
        let resp = dispatch(
            &ctx,
            json!({"command": "session.send",
                   "args": {"sessionId": "s-race", "content": "CLI 的消息"},
                   "schemaVersion": 1, "requestId": "r"}),
        )
        .await;
        runner
            .timeline
            .lock()
            .unwrap()
            .push("history_loaded".into());
        runner.broadcast("s-race", history_loaded("s-race"));
        resp
    };
    let (outcome, resp) = tokio::join!(send_user_message(&h, req), cli);

    assert!(resp.ok, "{resp:?}");
    let result = resp.result.unwrap();
    assert_eq!(result["dispatch"], "queued", "the gate was already ours");
    assert_eq!(result["message"], Value::Null);
    assert!(matches!(
        outcome.expect("send"),
        SendOutcome::Dispatched { .. }
    ));
    assert_eq!(
        runner.timeline(),
        ["load_history", "history_loaded", "user_message"],
        "one run, on the restored history"
    );
    let IpcCommand::UserMessage(sent) = runner.sent().pop().unwrap() else {
        panic!("expected user_message");
    };
    assert_eq!(sent.text, "GUI 的消息");
    let queued = runner.queue("s-race").items;
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].text, "CLI 的消息");
}

// ---------------- stop ----------------

#[tokio::test]
async fn stop_aborts_only_an_open_run_on_a_live_runner() {
    let runner = SendRunner::default();

    // Idle: nothing to stop.
    runner.live("s-stop", 4242, true);
    assert_eq!(
        stop_session_run(&runner, "s-stop").await.unwrap(),
        StopOutcome::AlreadyStopped
    );
    assert!(runner.sent().is_empty());

    // An open run (between turns: agent_running reads false) is aborted.
    runner.set_queue(
        "s-stop",
        Queue {
            open_run: true,
            ..Queue::default()
        },
    );
    assert_eq!(
        stop_session_run(&runner, "s-stop").await.unwrap(),
        StopOutcome::AbortSent
    );
    assert!(matches!(runner.sent().pop(), Some(IpcCommand::Abort)));

    // A turn going with the gate closed is aborted too.
    runner.set_queue("s-stop", Queue::default());
    runner
        .agent_running
        .lock()
        .unwrap()
        .insert("s-stop".into(), true);
    assert_eq!(
        stop_session_run(&runner, "s-stop").await.unwrap(),
        StopOutcome::AbortSent
    );

    // The runner went away under the abort.
    runner.dispatch_fails.store(true, Ordering::SeqCst);
    assert_eq!(
        stop_session_run(&runner, "s-stop").await.unwrap(),
        StopOutcome::AlreadyStopped
    );

    // An open gate with no live runner (a send still starting one).
    let cold = SendRunner::default();
    cold.set_queue(
        "s-cold-stop",
        Queue {
            open_run: true,
            ..Queue::default()
        },
    );
    assert_eq!(
        stop_session_run(&cold, "s-cold-stop").await.unwrap(),
        StopOutcome::AlreadyStopped
    );
    assert!(cold.sent().is_empty());
    assert_eq!(StopOutcome::AbortSent.as_str(), "abort_sent");
    assert_eq!(StopOutcome::AlreadyStopped.as_str(), "already_stopped");
}

// ---------------- the first-message title ----------------

#[test]
fn derived_titles_match_the_gui_fixture() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/title-derive-cases.json")).expect("fixture");
    let cases = fixture["cases"].as_array().expect("cases");
    assert!(cases.len() >= 20);
    for case in cases {
        let input = case["input"].as_str().unwrap();
        assert_eq!(
            derive_title_from_text(input),
            case["expected"].as_str().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[tokio::test]
async fn only_a_seed_title_is_derived_and_only_once() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-seed", SEED_TITLE, RuntimeKind::External).await;
    seed_session(&galley, "s-user", "我起的名字", RuntimeKind::External).await;
    seed_session(&galley, "s-auto", SEED_TITLE, RuntimeKind::External).await;
    galley
        .try_apply_auto_title(&SessionId("s-auto".into()), "模型起的名字")
        .await
        .unwrap()
        .expect("auto title applied");

    let first = derive_title_if_seed(&galley, "s-seed", "第一条")
        .await
        .unwrap()
        .expect("derived");
    assert_eq!(first.title, "第一条");
    assert_eq!(
        title_of(&galley, "s-seed").await,
        ("第一条".into(), "derived".into())
    );
    // Once: a derived title is not derived again.
    assert!(derive_title_if_seed(&galley, "s-seed", "第二条")
        .await
        .unwrap()
        .is_none());
    assert_eq!(title_of(&galley, "s-seed").await.0, "第一条");
    // User and auto titles are never touched.
    for (sid, title, source) in [
        ("s-user", "我起的名字", "user"),
        ("s-auto", "模型起的名字", "auto"),
    ] {
        assert!(derive_title_if_seed(&galley, sid, "消息")
            .await
            .unwrap()
            .is_none());
        assert_eq!(title_of(&galley, sid).await, (title.into(), source.into()));
    }
    // A blank (images-only) message leaves a seed title alone.
    seed_session(&galley, "s-blank", SEED_TITLE, RuntimeKind::External).await;
    assert!(derive_title_if_seed(&galley, "s-blank", " \n ")
        .await
        .unwrap()
        .is_none());
    assert_eq!(title_of(&galley, "s-blank").await.1, "seed");
    // Missing session: nothing, no error.
    assert!(derive_title_if_seed(&galley, "s-gone", "x")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn a_second_send_does_not_rename_the_session() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-twice", SEED_TITLE, RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-twice", 4242, true);
    let notifier = Arc::new(RecordingNotifier::default());
    let h = host(&galley, &runner, &notifier);

    send_user_message(&h, request("s-twice", "第一条"))
        .await
        .expect("first");
    // The first run settles.
    runner.set_queue("s-twice", Queue::default());
    send_user_message(&h, request("s-twice", "第二条"))
        .await
        .expect("second");

    assert_eq!(notifier.of("session-updated-external").len(), 1);
    assert_eq!(
        title_of(&galley, "s-twice").await,
        ("第一条".into(), "derived".into())
    );
}

#[tokio::test]
async fn socket_session_send_derives_the_title_and_keeps_its_response() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-sock", SEED_TITLE, RuntimeKind::External).await;
    let runner = SendRunner::default();
    runner.live("s-sock", 4242, true);
    let notifier = Arc::new(RecordingNotifier::default());
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };

    let resp = dispatch(
        &ctx,
        json!({"command": "session.send",
               "args": {"sessionId": "s-sock", "content": "整理一下\t周报"},
               "schemaVersion": 1, "requestId": "r"}),
    )
    .await;

    assert!(resp.ok, "{resp:?}");
    let result = resp.result.unwrap();
    let mut keys: Vec<&String> = result.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(keys, ["dispatch", "message"], "response shape unchanged");
    assert_eq!(result["dispatch"], "dispatched");
    assert_eq!(
        notifier.names(),
        ["user-message-persisted", "session-updated-external"]
    );
    assert!(
        notifier.of("user-message-persisted")[0]
            .get("clientRequestId")
            .is_none(),
        "socket events carry no clientRequestId"
    );
    assert_eq!(
        title_of(&galley, "s-sock").await,
        ("整理一下 周报".into(), "derived".into())
    );
}

#[tokio::test]
async fn socket_session_new_derives_the_title_but_answers_the_created_row() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    let runner = SendRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };

    let resp = dispatch(
        &ctx,
        json!({"command": "session.new",
               "args": {"task": "审计这个仓库的依赖", "runtimeKind": "external"},
               "schemaVersion": 1, "requestId": "n"}),
    )
    .await;

    assert!(resp.ok, "{resp:?}");
    let result = resp.result.unwrap();
    // The frozen response still carries the row as created.
    assert_eq!(result["session"]["title"], SEED_TITLE);
    let sid = result["session"]["id"].as_str().unwrap().to_string();
    assert_eq!(
        title_of(&galley, &sid).await,
        ("审计这个仓库的依赖".into(), "derived".into())
    );
    // No extra event: the sidebar gets the title with the created row.
    assert_eq!(
        notifier.names(),
        [
            "session-created-external",
            "runner-spawned-external",
            "user-message-persisted"
        ]
    );
    assert_eq!(
        notifier.of("session-created-external")[0]["session"]["title"],
        "审计这个仓库的依赖"
    );
}

#[tokio::test]
async fn a_queued_first_message_names_the_session_when_it_is_drained() {
    let galley = fresh_galley().await;
    seed_session(&galley, "s-drain", SEED_TITLE, RuntimeKind::External).await;
    // No runner registered: the dispatch fails, the row is persisted all
    // the same — and that is when the title is derived.
    let manager = RunnerManager::new();
    let notifier = Arc::new(RecordingNotifier::default());
    let as_dyn: Arc<dyn Notifier> = notifier.clone();

    galley_core_lib::message_queue::dispatch_queued_message(
        &galley,
        &manager,
        &as_dyn,
        "s-drain",
        QueuedMessage {
            queue_id: "qm_1".into(),
            text: "排队的第一条".into(),
            origin: None,
            queued_at: "t".into(),
        },
    )
    .await;

    assert_eq!(
        notifier.names(),
        [
            "user-message-persisted",
            "session-updated-external",
            "session-queue:changed"
        ]
    );
    assert_eq!(
        title_of(&galley, "s-drain").await,
        ("排队的第一条".into(), "derived".into())
    );
}

#[tokio::test]
async fn a_goal_objective_names_the_session() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_ga_config(&galley, dir.path()).await;
    seed_session(&galley, "s-goal", SEED_TITLE, RuntimeKind::External).await;
    let runner = SendRunner::default();
    let notifier = Arc::new(RecordingNotifier::default());
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };

    let resp = dispatch(
        &ctx,
        json!({"command": "goal.start",
               "args": {"sessionId": "s-goal", "objective": "把测试覆盖率提到 80%"},
               "schemaVersion": 2, "requestId": "g"}),
    )
    .await;

    assert!(resp.ok, "{resp:?}");
    assert_eq!(
        title_of(&galley, "s-goal").await,
        ("把测试覆盖率提到 80%".into(), "derived".into())
    );
    let names = notifier.names();
    let persisted = names
        .iter()
        .position(|n| n == "user-message-persisted")
        .unwrap();
    let titled = names
        .iter()
        .position(|n| n == "session-updated-external")
        .unwrap();
    assert!(persisted < titled, "{names:?}");
}
