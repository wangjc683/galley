//! The remote module's test peers, shared by `remote_module_test.rs`
//! (ticket 05b, against a minimal fake relay) and `remote_e2e_test.rs`
//! (ticket 06b, against the real relay):
//!
//! - [`FakePhone`]: a phone built from `galley_remote_protocol`'s client
//!   side (Noise `client_start`, chunking), connecting to a relay's base
//!   URL as a `client`.
//! - [`Core`]: Core on an in-memory database with a [`FakeRunner`] whose
//!   runner for a session is already live with its history confirmed, so
//!   `session.send` takes Core's real send path and stops at the recorded
//!   `user_message` command; and a [`TestNotifier`] that hands each emit
//!   to the module's sink, as `TauriNotifier` does.
//!
//! Nothing leaves 127.0.0.1.

// Each test binary uses a different part of this module.
#![allow(dead_code)]

use async_trait::async_trait;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use galley_core_lib::api::{CreateSessionInput, GalleyApi, Origin, RuntimeKind};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::{Notifier, RemoteEventSink};
use galley_core_lib::remote::{
    RemoteConfig, RemoteDeps, RemoteModule, RemoteTuning, REMOTE_STATUS_EVENT,
};
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::RunnerPort;
use galley_remote_protocol::app::{
    self as phone, chunk::Chunker, chunk::Reassembler, AppEvent, CoreHello, Envelope, ErrorBody,
    Event, Method, ProtocolVersion, Request,
};
use galley_remote_protocol::frame::{Frame, PeerId};
use galley_remote_protocol::keys::{DerivedKeys, NoisePsk, RelayUrl};
use galley_remote_protocol::noise::{self, CloseReason, Record, Transport};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::broadcast;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const WAIT: Duration = Duration::from_secs(5);
/// How long "nothing arrives" is watched for.
pub const QUIET: Duration = Duration::from_millis(400);

// ---------------- fake phone ----------------

pub type PhoneWs = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug)]
pub enum Incoming {
    Message(Envelope),
    Close(CloseReason),
    HostOnline(bool),
}

/// A phone: one client connection to the relay, one Noise session at a
/// time, chunking both ways.
pub struct FakePhone {
    sink: SplitSink<PhoneWs, Message>,
    stream: SplitStream<PhoneWs>,
    transport: Option<Transport>,
    reassembler: Reassembler,
    chunker: Chunker,
    next_id: u64,
    /// Events read while waiting for something else.
    inbox: VecDeque<Event>,
    closes: Vec<CloseReason>,
}

impl FakePhone {
    /// Connect as a client to the relay at `relay_url` (its base URL).
    pub async fn connect(relay_url: &str, keys: &DerivedKeys) -> Self {
        let mut request = format!("{relay_url}/v1/connect")
            .into_client_request()
            .unwrap();
        let headers = request.headers_mut();
        headers.insert(
            "x-galley-channel",
            keys.channel_secret.to_header_value().parse().unwrap(),
        );
        headers.insert("x-galley-role", "client".parse().unwrap());
        headers.insert("x-galley-relay", "1".parse().unwrap());
        let (ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let (sink, stream) = ws.split();
        Self {
            sink,
            stream,
            transport: None,
            reassembler: Reassembler::new(),
            chunker: Chunker::new(),
            next_id: 1,
            inbox: VecDeque::new(),
            closes: Vec::new(),
        }
    }

    pub async fn send_data(&mut self, payload: Vec<u8>) {
        let frame = Frame::Data {
            peer: PeerId::HOST,
            payload,
        };
        self.sink
            .send(Message::Binary(frame.encode().unwrap().into()))
            .await
            .unwrap();
    }

    pub async fn next_frame(&mut self, wait: Duration) -> Option<Frame> {
        loop {
            match timeout(wait, self.stream.next()).await.ok()?? {
                Ok(Message::Binary(bytes)) => return Some(Frame::decode(&bytes).unwrap()),
                Ok(_) => continue,
                Err(_) => return None,
            }
        }
    }

    /// Run the Noise handshake; Core's hello, or `None` if Core never
    /// answers.
    pub async fn try_handshake(&mut self, psk: &NoisePsk, wait: Duration) -> Option<CoreHello> {
        self.transport = None;
        self.reassembler.clear();
        let (request, handshake) = noise::client_start(psk).unwrap();
        self.send_data(request).await;
        let deadline = Instant::now() + wait;
        loop {
            let left = deadline.checked_duration_since(Instant::now())?;
            match self.next_frame(left).await? {
                Frame::Data { payload, .. } => {
                    let (hello, transport) = handshake.finish(&payload).unwrap();
                    self.transport = Some(transport);
                    return Some(serde_json::from_slice(&hello).unwrap());
                }
                Frame::Peer { .. } | Frame::Pong(_) => continue,
                other => panic!("unexpected {}", other.type_name()),
            }
        }
    }

    pub async fn handshake(&mut self, keys: &DerivedKeys) -> CoreHello {
        self.try_handshake(&keys.noise_psk, WAIT)
            .await
            .expect("Core answered the handshake")
    }

    pub async fn next_incoming(&mut self, wait: Duration) -> Option<Incoming> {
        let deadline = Instant::now() + wait;
        loop {
            let left = deadline.checked_duration_since(Instant::now())?;
            match self.next_frame(left).await? {
                Frame::Peer { online, .. } => return Some(Incoming::HostOnline(online)),
                Frame::Data { payload, .. } => {
                    let transport = self.transport.as_mut().expect("a session");
                    match transport.open(&payload).expect("record opens") {
                        Record::Close(reason) => {
                            self.closes.push(reason);
                            self.transport = None;
                            return Some(Incoming::Close(reason));
                        }
                        Record::App(body) => {
                            let envelope = Envelope::from_json(&body).unwrap();
                            if let Some(message) = self.reassembler.push(envelope).unwrap() {
                                return Some(Incoming::Message(message));
                            }
                        }
                    }
                }
                _ => continue,
            }
        }
    }

    pub async fn send_envelope(&mut self, envelope: &Envelope) {
        for body in self.chunker.encode(envelope).unwrap() {
            let sealed = self.transport.as_mut().unwrap().seal_app(&body).unwrap();
            self.send_data(sealed).await;
        }
    }

    pub async fn request(&mut self, method: &str, params: Value) -> Result<Value, ErrorBody> {
        let id = self.next_id;
        self.next_id += 1;
        let request = Request {
            id,
            method: method.to_string(),
            params,
        };
        self.send_envelope(&Envelope::Request(request)).await;
        loop {
            match self.next_incoming(WAIT).await.expect("an answer") {
                Incoming::Message(Envelope::Response(response)) if response.id == id => {
                    return response.outcome;
                }
                Incoming::Message(Envelope::Event(event)) => self.inbox.push_back(event),
                other => panic!("waiting for response {id}, got {other:?}"),
            }
        }
    }

    pub async fn call<M: Method>(&mut self, params: &M::Params) -> Result<M::Result, ErrorBody> {
        self.request(M::NAME, serde_json::to_value(params).unwrap())
            .await
            .map(|r| serde_json::from_value(r).unwrap())
    }

    /// The next event named `name`, skipping (and keeping) others.
    pub async fn event(&mut self, name: &str, wait: Duration) -> Option<AppEvent> {
        if let Some(at) = self.inbox.iter().position(|e| e.name == name) {
            let event = self.inbox.remove(at).unwrap();
            return AppEvent::from_event(&event).unwrap();
        }
        let deadline = Instant::now() + wait;
        loop {
            let left = deadline.checked_duration_since(Instant::now())?;
            match self.next_incoming(left).await? {
                Incoming::Message(Envelope::Event(event)) if event.name == name => {
                    return AppEvent::from_event(&event).unwrap();
                }
                Incoming::Message(Envelope::Event(event)) => self.inbox.push_back(event),
                other => panic!("waiting for {name}, got {other:?}"),
            }
        }
    }

    /// Every event that arrives within `wait`.
    pub async fn events_within(&mut self, wait: Duration) -> Vec<Event> {
        let mut events: Vec<Event> = self.inbox.drain(..).collect();
        let deadline = Instant::now() + wait;
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match self.next_incoming(left).await {
                Some(Incoming::Message(Envelope::Event(event))) => events.push(event),
                Some(other) => panic!("only events expected, got {other:?}"),
                None => break,
            }
        }
        events
    }

    pub async fn expect_close(&mut self) -> CloseReason {
        loop {
            match self.next_incoming(WAIT).await.expect("a CLOSE") {
                Incoming::Close(reason) => return reason,
                Incoming::Message(Envelope::Event(event)) => self.inbox.push_back(event),
                other => panic!("waiting for CLOSE, got {other:?}"),
            }
        }
    }
}

// ---------------- Core side ----------------

/// Live runners whose history is confirmed: `ensure` returns them as
/// they are, `send_command` is recorded.
#[derive(Default)]
pub struct FakeRunner {
    pub live: Mutex<HashSet<String>>,
    pub states: Mutex<HashMap<String, RunState>>,
    pub commands: Mutex<Vec<(String, IpcCommand)>>,
}

#[async_trait]
impl RunnerPort for FakeRunner {
    async fn spawn(&self, _: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        Err(RunnerSpawnError::SpawnIo {
            detail: "no spawning in this test".into(),
        })
    }
    async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        self.commands
            .lock()
            .unwrap()
            .push((sid.to_string(), cmd.clone()));
        Ok(())
    }
    async fn subscribe(&self, _: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, sid: &str) -> Option<u32> {
        self.live.lock().unwrap().contains(sid).then_some(4242)
    }
    async fn agent_running(&self, _: &str) -> bool {
        false
    }
    async fn shutdown(&self, _: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
        Ok(())
    }
    async fn history_confirmed(&self, _: &str, _: u32) -> bool {
        true
    }
    async fn run_state(&self, sid: &str) -> RunState {
        self.states
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default()
    }
    async fn known_session_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.states.lock().unwrap().keys().cloned().collect();
        ids.sort();
        ids
    }
}

/// Records emits and hands each to the module's sink, as `TauriNotifier`
/// does.
#[derive(Default)]
pub struct TestNotifier {
    pub sink: Mutex<Option<Arc<dyn RemoteEventSink>>>,
    pub emitted: Mutex<Vec<(String, Value)>>,
}

impl Notifier for TestNotifier {
    fn emit(&self, event: &str, payload: Value) {
        self.emitted
            .lock()
            .unwrap()
            .push((event.to_string(), payload.clone()));
        let sink = self.sink.lock().unwrap().clone();
        if let Some(sink) = sink {
            sink.forward(event, &payload);
        }
    }
}

impl TestNotifier {
    pub fn statuses(&self) -> Vec<Value> {
        self.emitted
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == REMOTE_STATUS_EVENT)
            .map(|(_, payload)| payload.clone())
            .collect()
    }
}

pub async fn wait_until(mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Attachment files land next to the database (`GALLEY_DB_PATH`); point
/// it at a temp dir once for this test binary.
pub fn attachment_root() -> &'static Path {
    static ROOT: OnceLock<tempfile::TempDir> = OnceLock::new();
    ROOT.get_or_init(|| {
        let dir = tempfile::tempdir().expect("attachment root");
        std::env::set_var("GALLEY_DB_PATH", dir.path().join("workbench.db"));
        dir
    })
    .path()
}

pub fn fast() -> RemoteTuning {
    RemoteTuning {
        ping_interval: Duration::from_millis(200),
        pong_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(2),
        backoff_initial: Duration::from_millis(50),
        backoff_max: Duration::from_millis(200),
        housekeeping_interval: Duration::from_millis(50),
        runner_batch_window: Duration::from_millis(20),
        ..RemoteTuning::default()
    }
}

pub fn hello_params(major: u32) -> phone::HelloParams {
    phone::HelloParams {
        protocol: ProtocolVersion { major, minor: 0 },
        app_version: "1.0 (test)".into(),
    }
}

pub fn sid(id: &str) -> phone::SessionIdParams {
    phone::SessionIdParams {
        session_id: id.into(),
    }
}

/// Core's side of a test: the database, the fake runner, the notifier
/// and a remote module configured for a relay, not started.
pub struct Core {
    pub pool: sqlx::SqlitePool,
    pub galley: SqliteGalley,
    pub runner: Arc<FakeRunner>,
    pub notifier: Arc<TestNotifier>,
    pub module: RemoteModule,
}

impl Core {
    /// A module on a fresh database for the relay at `relay_url`, named
    /// "Test Mac", not started.
    pub async fn new(relay_url: &str, tuning: RemoteTuning) -> Self {
        attachment_root();
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .unwrap();
        galley_core_lib::apply_all_migrations_for_tests(&pool)
            .await
            .unwrap();
        let galley = SqliteGalley::from_pool(pool.clone());
        let runner = Arc::new(FakeRunner::default());
        let notifier = Arc::new(TestNotifier::default());
        let module = RemoteModule::new(
            RemoteDeps {
                galley: galley.clone(),
                runner: runner.clone(),
                notifier: notifier.clone(),
                env: None,
            },
            RemoteConfig {
                relay: RelayUrl::parse(relay_url).unwrap(),
                desktop_name: "Test Mac".into(),
                core_version: "0.0.0-test".into(),
                tuning,
                register_global_sink: false,
            },
        );
        Self {
            pool,
            galley,
            runner,
            notifier,
            module,
        }
    }
}

/// A session titled `title <id>` on `runtime`, made through the CLI path.
pub async fn create_session(
    galley: &SqliteGalley,
    id: &str,
    runtime: RuntimeKind,
    project: Option<&str>,
) {
    galley
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
            Origin::cli(None, None),
        )
        .await
        .unwrap();
}
