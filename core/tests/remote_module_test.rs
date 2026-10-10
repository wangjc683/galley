//! The remote module (`galley_core_lib::remote`, ticket 05b) end to end,
//! in process: a minimal fake relay (a tokio-tungstenite server on
//! 127.0.0.1 speaking `galley_remote_protocol` frames — one host, numbered
//! clients, `PEER` notices, `DATA` routing, `PONG`, captured `PUSH`es) and
//! a fake phone built from the crate's client side (QR parsing, key
//! derivation, `client_start`, chunking). Nothing leaves 127.0.0.1.
//!
//! Core runs against an in-memory database and a scripted runner registry
//! whose runner for a session is already live with its history confirmed,
//! so `session.send` takes Core's real send path (persist, announce,
//! ensure, dispatch) and stops at the recorded `user_message` command.
//! Events are fed to the module's sink the way `TauriNotifier` does.

use async_trait::async_trait;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use galley_core_lib::api::{
    CreateProjectInput, CreateSessionInput, GalleyApi, MessageVisibility, Origin, RuntimeKind,
    SessionId,
};
use galley_core_lib::db::{PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::{Notifier, RemoteEventSink};
use galley_core_lib::remote::{
    push::{push_devices, PUSH_DEVICES_PREF},
    resolve_relay_url, RemoteConfig, RemoteDeps, RemoteModule, RemoteStatus, RemoteTuning,
    REMOTE_STATUS_EVENT, SESSION_NOT_MANAGED,
};
use galley_core_lib::remote_pairing;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::RunnerPort;
use galley_remote_protocol::app::{
    self as phone, chunk::Chunker, chunk::Reassembler, error_code, AppEvent, CoreHello, Envelope,
    ErrorBody, Event, Method, ProtocolVersion, Request, PROTOCOL_VERSION,
};
use galley_remote_protocol::frame::{
    Frame, PeerId, PushEnv, PushRequest, PushResult, PushStatus, Role, HEADER_CHANNEL,
    HEADER_RELAY_VERSION, HEADER_ROLE,
};
use galley_remote_protocol::keys::{DerivedKeys, MasterKey, NoisePsk, PairingCode, RelayUrl};
use galley_remote_protocol::noise::{self, CloseReason, Record, Transport};
use galley_remote_protocol::push as push_seal;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse, Request as WsRequest, Response as WsResponse,
};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

const WAIT: Duration = Duration::from_secs(5);
/// How long "nothing arrives" is watched for.
const QUIET: Duration = Duration::from_millis(400);

// ---------------- fake relay ----------------

#[derive(Debug, Clone)]
struct HostHeaders {
    path: String,
    channel: Option<String>,
    role: Option<String>,
    relay_version: Option<String>,
    extensions: Option<String>,
}

#[derive(Default)]
struct RelayState {
    host: Option<(mpsc::UnboundedSender<Frame>, JoinHandle<()>, u64)>,
    host_generation: u64,
    clients: BTreeMap<u32, mpsc::UnboundedSender<Frame>>,
    next_peer: u32,
    host_headers: Vec<HostHeaders>,
    pushes: Vec<PushRequest>,
}

/// One channel's relay: routes `DATA` between the host and numbered
/// clients, announces `PEER`s, answers `PING`, keeps `PUSH`es.
struct FakeRelay {
    url: String,
    state: Arc<Mutex<RelayState>>,
    accept: JoinHandle<()>,
}

impl Drop for FakeRelay {
    fn drop(&mut self) {
        self.accept.abort();
        let mut state = self.state.lock().unwrap();
        if let Some((_, task, _)) = state.host.take() {
            task.abort();
        }
    }
}

fn send_frame(tx: &mpsc::UnboundedSender<Frame>, frame: Frame) {
    let _ = tx.send(frame);
}

impl FakeRelay {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(RelayState {
            next_peer: 1,
            ..RelayState::default()
        }));
        let accept_state = state.clone();
        let accept = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let state = accept_state.clone();
                tokio::spawn(async move { serve(state, stream).await });
            }
        });
        Self { url, state, accept }
    }

    fn host_connects(&self) -> usize {
        self.state.lock().unwrap().host_headers.len()
    }

    async fn wait_host_connects(&self, n: usize) {
        wait_until(|| self.host_connects() >= n && self.host_online()).await;
    }

    fn host_online(&self) -> bool {
        self.state.lock().unwrap().host.is_some()
    }

    fn host_headers(&self) -> Vec<HostHeaders> {
        self.state.lock().unwrap().host_headers.clone()
    }

    fn pushes(&self) -> Vec<PushRequest> {
        self.state.lock().unwrap().pushes.clone()
    }

    /// Cut the host's connection, as a relay restart or a network drop
    /// would.
    fn drop_host(&self) {
        let mut state = self.state.lock().unwrap();
        if let Some((_, task, _)) = state.host.take() {
            task.abort();
        }
        for tx in state.clients.values() {
            send_frame(
                tx,
                Frame::Peer {
                    peer: PeerId::HOST,
                    role: Role::Host,
                    online: false,
                },
            );
        }
    }

    fn send_to_host(&self, frame: Frame) {
        if let Some((tx, _, _)) = &self.state.lock().unwrap().host {
            send_frame(tx, frame);
        }
    }
}

// The handshake callback's error type is tungstenite's.
#[allow(clippy::result_large_err)]
async fn serve(state: Arc<Mutex<RelayState>>, stream: TcpStream) {
    let captured: Arc<Mutex<Option<HostHeaders>>> = Arc::default();
    let capture = captured.clone();
    let callback = move |request: &WsRequest, response: WsResponse| {
        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        *capture.lock().unwrap() = Some(HostHeaders {
            path: request.uri().path().to_string(),
            channel: header(HEADER_CHANNEL),
            role: header(HEADER_ROLE),
            relay_version: header(HEADER_RELAY_VERSION),
            extensions: header("sec-websocket-extensions"),
        });
        Ok::<WsResponse, ErrorResponse>(response)
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, callback).await else {
        return;
    };
    let headers = captured.lock().unwrap().clone().unwrap();
    let (tx, rx) = mpsc::unbounded_channel::<Frame>();
    if headers.role.as_deref() == Some("host") {
        // The task is registered before it runs, so its first frames find
        // the host in place.
        let mut guard = state.lock().unwrap();
        guard.host_headers.push(headers);
        guard.host_generation += 1;
        let generation = guard.host_generation;
        if let Some((_, old, _)) = guard.host.take() {
            old.abort();
        }
        for (peer, client) in &guard.clients {
            send_frame(
                &tx,
                Frame::Peer {
                    peer: PeerId(*peer),
                    role: Role::Client,
                    online: true,
                },
            );
            send_frame(
                client,
                Frame::Peer {
                    peer: PeerId::HOST,
                    role: Role::Host,
                    online: true,
                },
            );
        }
        let task_state = state.clone();
        let task = tokio::spawn(run_host(task_state, ws, rx, generation));
        guard.host = Some((tx, task, generation));
    } else {
        let peer = {
            let mut guard = state.lock().unwrap();
            let peer = guard.next_peer;
            guard.next_peer += 1;
            guard.clients.insert(peer, tx.clone());
            if let Some((host, _, _)) = &guard.host {
                send_frame(
                    host,
                    Frame::Peer {
                        peer: PeerId(peer),
                        role: Role::Client,
                        online: true,
                    },
                );
                send_frame(
                    &tx,
                    Frame::Peer {
                        peer: PeerId::HOST,
                        role: Role::Host,
                        online: true,
                    },
                );
            }
            peer
        };
        run_client(state, ws, rx, peer).await;
    }
}

async fn run_host(
    state: Arc<Mutex<RelayState>>,
    ws: WebSocketStream<TcpStream>,
    mut rx: mpsc::UnboundedReceiver<Frame>,
    generation: u64,
) {
    let (mut sink, mut stream) = ws.split();
    loop {
        tokio::select! {
            out = rx.recv() => {
                let Some(frame) = out else { break };
                if sink.send(Message::Binary(frame.encode().unwrap().into())).await.is_err() {
                    break;
                }
            }
            incoming = stream.next() => {
                let Some(Ok(Message::Binary(bytes))) = incoming else {
                    if matches!(incoming, Some(Ok(_))) {
                        continue;
                    }
                    break;
                };
                let frame = Frame::decode(&bytes).expect("host sent a valid frame");
                let mut guard = state.lock().unwrap();
                match frame {
                    Frame::Data { peer, payload } => {
                        if let Some(client) = guard.clients.get(&peer.0) {
                            send_frame(client, Frame::Data { peer: PeerId::HOST, payload });
                        }
                    }
                    Frame::Ping(nonce) => {
                        if let Some((tx, _, _)) = &guard.host {
                            send_frame(tx, Frame::Pong(nonce));
                        }
                    }
                    Frame::Push(push) => guard.pushes.push(push),
                    other => panic!("a host does not send {}", other.type_name()),
                }
            }
        }
    }
    let mut guard = state.lock().unwrap();
    if guard
        .host
        .as_ref()
        .is_some_and(|(_, _, g)| *g == generation)
    {
        guard.host = None;
        for client in guard.clients.values() {
            send_frame(
                client,
                Frame::Peer {
                    peer: PeerId::HOST,
                    role: Role::Host,
                    online: false,
                },
            );
        }
    }
}

async fn run_client(
    state: Arc<Mutex<RelayState>>,
    ws: WebSocketStream<TcpStream>,
    mut rx: mpsc::UnboundedReceiver<Frame>,
    peer: u32,
) {
    let (mut sink, mut stream) = ws.split();
    loop {
        tokio::select! {
            out = rx.recv() => {
                let Some(frame) = out else { break };
                if sink.send(Message::Binary(frame.encode().unwrap().into())).await.is_err() {
                    break;
                }
            }
            incoming = stream.next() => {
                let Some(Ok(Message::Binary(bytes))) = incoming else {
                    if matches!(incoming, Some(Ok(_))) {
                        continue;
                    }
                    break;
                };
                let frame = Frame::decode(&bytes).expect("client sent a valid frame");
                let guard = state.lock().unwrap();
                match frame {
                    Frame::Data { payload, .. } => {
                        if let Some((host, _, _)) = &guard.host {
                            send_frame(host, Frame::Data { peer: PeerId(peer), payload });
                        }
                    }
                    Frame::Ping(nonce) => {
                        if let Some(client) = guard.clients.get(&peer) {
                            send_frame(client, Frame::Pong(nonce));
                        }
                    }
                    other => panic!("a client does not send {}", other.type_name()),
                }
            }
        }
    }
    let mut guard = state.lock().unwrap();
    guard.clients.remove(&peer);
    if let Some((host, _, _)) = &guard.host {
        send_frame(
            host,
            Frame::Peer {
                peer: PeerId(peer),
                role: Role::Client,
                online: false,
            },
        );
    }
}

// ---------------- fake phone ----------------

type PhoneWs = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug)]
enum Incoming {
    Message(Envelope),
    Close(CloseReason),
    HostOnline(bool),
}

/// A phone: one client connection to the relay, one Noise session at a
/// time, chunking both ways.
struct FakePhone {
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
    async fn connect(relay: &FakeRelay, keys: &DerivedKeys) -> Self {
        let mut request = format!("{}/v1/connect", relay.url)
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

    async fn send_data(&mut self, payload: Vec<u8>) {
        let frame = Frame::Data {
            peer: PeerId::HOST,
            payload,
        };
        self.sink
            .send(Message::Binary(frame.encode().unwrap().into()))
            .await
            .unwrap();
    }

    async fn next_frame(&mut self, wait: Duration) -> Option<Frame> {
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
    async fn try_handshake(&mut self, psk: &NoisePsk, wait: Duration) -> Option<CoreHello> {
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

    async fn handshake(&mut self, keys: &DerivedKeys) -> CoreHello {
        self.try_handshake(&keys.noise_psk, WAIT)
            .await
            .expect("Core answered the handshake")
    }

    async fn next_incoming(&mut self, wait: Duration) -> Option<Incoming> {
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

    async fn send_envelope(&mut self, envelope: &Envelope) {
        for body in self.chunker.encode(envelope).unwrap() {
            let sealed = self.transport.as_mut().unwrap().seal_app(&body).unwrap();
            self.send_data(sealed).await;
        }
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, ErrorBody> {
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

    async fn call<M: Method>(&mut self, params: &M::Params) -> Result<M::Result, ErrorBody> {
        self.request(M::NAME, serde_json::to_value(params).unwrap())
            .await
            .map(|r| serde_json::from_value(r).unwrap())
    }

    /// The next event named `name`, skipping (and keeping) others.
    async fn event(&mut self, name: &str, wait: Duration) -> Option<AppEvent> {
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
    async fn events_within(&mut self, wait: Duration) -> Vec<Event> {
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

    async fn expect_close(&mut self) -> CloseReason {
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
struct FakeRunner {
    live: Mutex<HashSet<String>>,
    states: Mutex<HashMap<String, RunState>>,
    commands: Mutex<Vec<(String, IpcCommand)>>,
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
struct TestNotifier {
    sink: Mutex<Option<Arc<dyn RemoteEventSink>>>,
    emitted: Mutex<Vec<(String, Value)>>,
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
    fn statuses(&self) -> Vec<Value> {
        self.emitted
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == REMOTE_STATUS_EVENT)
            .map(|(_, payload)| payload.clone())
            .collect()
    }
}

async fn wait_until(mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
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

fn fast() -> RemoteTuning {
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

struct Fixture {
    pool: sqlx::SqlitePool,
    galley: SqliteGalley,
    runner: Arc<FakeRunner>,
    notifier: Arc<TestNotifier>,
    module: RemoteModule,
    relay: FakeRelay,
}

impl Fixture {
    /// A module on a fresh database, configured for a fresh relay, not
    /// started.
    async fn new(tuning: RemoteTuning) -> Self {
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
        let relay = FakeRelay::start().await;
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
                relay: RelayUrl::parse(&relay.url).unwrap(),
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
            relay,
        }
    }

    /// Pair (the module starts and connects) and return the keys a phone
    /// gets from scanning the code.
    async fn paired(tuning: RemoteTuning) -> (Self, DerivedKeys) {
        let fixture = Self::new(tuning).await;
        let qr = fixture.module.pair().await.unwrap();
        let code = PairingCode::parse(qr.as_str()).unwrap();
        assert_eq!(code.relay().as_str(), fixture.relay.url);
        assert_eq!(code.desktop_name(), "Test Mac");
        let keys = code.master_key().derive();
        fixture.relay.wait_host_connects(1).await;
        *fixture.notifier.sink.lock().unwrap() = fixture.module.event_sink().await;
        (fixture, keys)
    }

    async fn phone(&self, keys: &DerivedKeys) -> FakePhone {
        let mut phone = FakePhone::connect(&self.relay, keys).await;
        phone.handshake(keys).await;
        phone
    }

    fn forward(&self, event: &str, payload: Value) {
        self.notifier.emit(event, payload);
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
                Origin::cli(None, None),
            )
            .await
            .unwrap();
    }

    async fn exchange(&self, sid: &str, user: &str, reply: &str) {
        let row = self
            .galley
            .send_message(SessionId(sid.into()), user.into(), Origin::cli(None, None))
            .await
            .unwrap();
        self.galley
            .persist_assistant_message(PersistAssistantMessage {
                session_id: SessionId(sid.into()),
                turn_index: row.turn_index.unwrap(),
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
            .unwrap();
    }
}

fn hello_params(major: u32) -> phone::HelloParams {
    phone::HelloParams {
        protocol: ProtocolVersion { major, minor: 0 },
        app_version: "1.0 (test)".into(),
    }
}

fn sid(id: &str) -> phone::SessionIdParams {
    phone::SessionIdParams {
        session_id: id.into(),
    }
}

// ---------------- tests ----------------

#[tokio::test]
async fn a_phone_handshakes_and_says_hello() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let headers = fx.relay.host_headers();
    assert_eq!(headers[0].path, "/v1/connect");
    assert_eq!(
        headers[0].channel.as_deref(),
        Some(keys.channel_secret.to_header_value().as_str())
    );
    assert_eq!(headers[0].role.as_deref(), Some("host"));
    assert_eq!(headers[0].relay_version.as_deref(), Some("1"));
    assert_eq!(headers[0].extensions, None, "no permessage-deflate");

    let mut phone = FakePhone::connect(&fx.relay, &keys).await;
    let hello = phone.handshake(&keys).await;
    assert_eq!(hello.protocol, PROTOCOL_VERSION);
    assert_eq!(hello.desktop_name, "Test Mac");
    assert_eq!(hello.core_version, "0.0.0-test");
    let again = phone.call::<phone::Hello>(&hello_params(1)).await.unwrap();
    assert_eq!(again, hello);

    wait_until(|| fx.module.status().online_phones == 1).await;
    let status = fx.module.status();
    assert!(status.paired && status.relay_connected);
    assert!(status.last_phone_connected_at.is_some());
    // Every change was announced, the last one being the current state.
    let last = fx.notifier.statuses().last().cloned().unwrap();
    assert_eq!(last, serde_json::to_value(&status).unwrap());

    let unknown = phone.request("session.teleport", json!({})).await;
    assert_eq!(unknown.unwrap_err().code, error_code::UNKNOWN_METHOD);
}

#[tokio::test]
async fn a_wrong_psk_gets_no_answer_and_the_right_one_still_works() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let stranger = MasterKey::generate().unwrap().derive();
    let mut wrong = FakePhone::connect(&fx.relay, &keys).await;
    assert!(wrong
        .try_handshake(&stranger.noise_psk, QUIET)
        .await
        .is_none());
    assert_eq!(fx.module.status().online_phones, 0);

    let mut right = fx.phone(&keys).await;
    right.call::<phone::Hello>(&hello_params(1)).await.unwrap();
    wait_until(|| fx.module.status().online_phones == 1).await;
}

#[tokio::test]
async fn another_protocol_major_is_refused_and_closed() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let mut phone = fx.phone(&keys).await;
    let refused = phone.call::<phone::Hello>(&hello_params(2)).await;
    assert_eq!(refused.unwrap_err().code, error_code::PROTOCOL_MISMATCH);
    assert_eq!(phone.expect_close().await, CloseReason::VersionMismatch);
    wait_until(|| fx.module.status().online_phones == 0).await;
}

#[tokio::test]
async fn the_session_list_shows_managed_sessions_only() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let project = fx
        .galley
        .create_project(
            CreateProjectInput {
                id: "p-1".into(),
                name: "项目".into(),
                root_path: Some("/Users/someone/code".into()),
                workspace_enabled: true,
                icon: None,
                color: None,
            },
            Origin::cli(None, None),
        )
        .await
        .unwrap();
    fx.session("m1", RuntimeKind::Managed, Some(project.id.as_str()))
        .await;
    fx.session("m2", RuntimeKind::Managed, None).await;
    fx.session("e1", RuntimeKind::External, None).await;
    {
        let mut states = fx.runner.states.lock().unwrap();
        let busy = RunState {
            runner_alive: true,
            agent_running: true,
            open_run: true,
            ..RunState::default()
        };
        states.insert("m1".into(), busy.clone());
        states.insert("e1".into(), busy);
        states.insert("m2".into(), RunState::default());
    }
    let mut phone = fx.phone(&keys).await;
    let list = phone
        .call::<phone::SessionsList>(&phone::Empty {})
        .await
        .unwrap();
    let mut ids: Vec<&str> = list.sessions.iter().map(|s| s.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, ["m1", "m2"]);
    assert_eq!(list.projects.len(), 1);
    assert_eq!(list.projects[0].name, "项目");
    // Only non-idle managed sessions carry a run state.
    assert_eq!(list.run_states.len(), 1);
    assert_eq!(list.run_states[0].session_id, "m1");
    assert!(list.run_states[0].agent_running);
    let raw = serde_json::to_string(&list).unwrap();
    assert!(!raw.contains("/Users/someone"), "{raw}");

    for (method, params) in [
        (
            "session.messages",
            json!({"sessionId": "e1", "before": null, "limit": null}),
        ),
        ("session.subscribe", json!({"sessionId": "e1"})),
        ("session.markRead", json!({"sessionId": "e1"})),
        ("session.stop", json!({"sessionId": "e1"})),
    ] {
        let refused = phone.request(method, params).await.unwrap_err();
        assert_eq!(refused.code, SESSION_NOT_MANAGED, "{method}");
    }
    let missing = phone
        .call::<phone::SessionStop>(&sid("nope"))
        .await
        .unwrap_err();
    assert_eq!(missing.code, error_code::NOT_FOUND);
    let bad = phone
        .request("session.messages", json!({"sessionId": 7}))
        .await
        .unwrap_err();
    assert_eq!(bad.code, error_code::INVALID_PARAMS);
}

#[tokio::test]
async fn messages_page_backwards_by_message_id() {
    let (fx, keys) = Fixture::paired(fast()).await;
    fx.session("m1", RuntimeKind::Managed, None).await;
    for turn in 0..3 {
        fx.exchange("m1", &format!("q{turn}"), &format!("a{turn}"))
            .await;
    }
    let mut phone = fx.phone(&keys).await;
    let page = |before: Option<String>| phone::SessionMessagesParams {
        session_id: "m1".into(),
        before,
        limit: Some(4),
    };
    let tail = phone
        .call::<phone::SessionMessages>(&page(None))
        .await
        .unwrap();
    let contents: Vec<&str> = tail.messages.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents, ["q1", "a1", "q2", "a2"]);
    assert!(tail.has_more);
    assert_eq!(tail.messages[0].role, phone::MessageRole::User);
    assert_eq!(tail.messages[1].role, phone::MessageRole::Agent);
    assert_eq!(tail.messages[1].final_answer.as_deref(), Some("a1"));

    let older = phone
        .call::<phone::SessionMessages>(&page(Some(tail.messages[0].id.clone())))
        .await
        .unwrap();
    let contents: Vec<&str> = older.messages.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents, ["q0", "a0"]);
    assert!(!older.has_more);

    let unknown = phone
        .call::<phone::SessionMessages>(&page(Some("no-such-message".into())))
        .await
        .unwrap_err();
    assert_eq!(unknown.code, error_code::NOT_FOUND);
}

#[tokio::test]
async fn a_send_persists_as_ios_dispatches_and_reads_back_its_image() {
    let (fx, keys) = Fixture::paired(fast()).await;
    fx.session("m1", RuntimeKind::Managed, None).await;
    fx.runner.live.lock().unwrap().insert("m1".into());
    let mut phone = fx.phone(&keys).await;

    // Large enough that both the request and the attachment answer go
    // as chunks.
    let image: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
    let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &image);
    let sent = phone
        .call::<phone::SessionSend>(&phone::SessionSendParams {
            session_id: "m1".into(),
            text: "看看这张图".into(),
            images: vec![phone::ImageUpload {
                mime_type: "image/png".into(),
                data,
                width: Some(10),
                height: Some(20),
            }],
            client_request_id: Some("phone-1".into()),
        })
        .await
        .unwrap();
    assert_eq!(sent.outcome, phone::SendOutcome::Dispatched);
    let message = sent.message.unwrap();
    assert_eq!(message.content, "看看这张图");
    assert_eq!(message.origin.unwrap().via, phone::OriginVia::Gui);
    let attachment = message.attachments[0].clone();
    assert_eq!(attachment.byte_size, image.len() as u64);

    // Stored as a human's send through the phone.
    let (via, client): (String, Option<String>) = sqlx::query_as(
        "SELECT created_via, client FROM messages WHERE session_id = 'm1' AND role = 'user'",
    )
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    assert_eq!((via.as_str(), client.as_deref()), ("gui", Some("ios")));
    // Dispatched to the session's runner, image included.
    let commands = fx.runner.commands.lock().unwrap().clone();
    let IpcCommand::UserMessage(command) = &commands[0].1 else {
        panic!("user_message expected, got {commands:?}");
    };
    assert_eq!(command.text, "看看这张图");
    assert_eq!(command.images.len(), 1);
    // Announced to the phone with its own request id: pending, then
    // dispatched.
    for expected in [phone::Dispatch::Pending, phone::Dispatch::Dispatched] {
        let Some(AppEvent::MessagePersisted(event)) = phone.event("message.persisted", WAIT).await
        else {
            panic!("message.persisted expected");
        };
        assert_eq!(event.dispatch, expected);
        assert_eq!(event.client_request_id.as_deref(), Some("phone-1"));
        assert_eq!(event.message.id, message.id);
    }

    let read = phone
        .call::<phone::AttachmentRead>(&phone::AttachmentReadParams {
            session_id: "m1".into(),
            attachment_id: attachment.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(read.mime_type, "image/png");
    let bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, read.data).unwrap();
    assert_eq!(bytes, image);
    let wrong_session = phone
        .call::<phone::AttachmentRead>(&phone::AttachmentReadParams {
            session_id: "m1".into(),
            attachment_id: "att_other_0".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(wrong_session.code, "attachment_not_found");

    let bad_image = phone
        .call::<phone::SessionSend>(&phone::SessionSendParams {
            session_id: "m1".into(),
            text: "gif".into(),
            images: vec![phone::ImageUpload {
                mime_type: "image/gif".into(),
                data: "aGVsbG8=".into(),
                width: None,
                height: None,
            }],
            client_request_id: None,
        })
        .await
        .unwrap_err();
    assert_eq!(bad_image.code, error_code::INVALID_ARGS);
}

#[tokio::test]
async fn create_and_mark_read_write_through_core() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let mut phone = fx.phone(&keys).await;
    let created = phone
        .call::<phone::SessionCreate>(&phone::SessionCreateParams {
            project_id: None,
            title: None,
        })
        .await
        .unwrap()
        .session;
    assert!(created.id.starts_with("s-"), "{}", created.id);
    assert_eq!(created.title, "新对话");
    let (runtime, client): (String, Option<String>) =
        sqlx::query_as("SELECT ga_runtime_kind, client FROM sessions WHERE id = ?")
            .bind(&created.id)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert_eq!(
        (runtime.as_str(), client.as_deref()),
        ("managed", Some("ios"))
    );
    let Some(AppEvent::SessionCreated(event)) = phone.event("session.created", WAIT).await else {
        panic!("session.created expected");
    };
    assert_eq!(event.session.id, created.id);
    assert_eq!(event.via, "ios");

    fx.galley
        .mark_session_unread(SessionId(created.id.clone()))
        .await
        .unwrap();
    phone
        .call::<phone::SessionMarkRead>(&sid(&created.id))
        .await
        .unwrap();
    let brief = fx
        .galley
        .session_brief(SessionId(created.id.clone()))
        .await
        .unwrap();
    assert_ne!(brief.has_unread, Some(true));
}

#[tokio::test]
async fn runner_events_reach_subscribed_phones_only_in_batches() {
    let (fx, keys) = Fixture::paired(fast()).await;
    fx.session("m1", RuntimeKind::Managed, None).await;
    fx.session("m2", RuntimeKind::Managed, None).await;
    fx.session("e1", RuntimeKind::External, None).await;
    let mut phone = fx.phone(&keys).await;
    phone
        .call::<phone::SessionSubscribe>(&sid("m1"))
        .await
        .unwrap();

    let progress = |session: &str, n: u32| json!({"sessionId": session, "event": {"kind": "turn_progress", "n": n}});
    for n in 0..3 {
        fx.forward("runner-event", progress("m1", n));
        fx.forward("runner-event", progress("m2", n));
    }
    // A state event of an external session never reaches the phone; one
    // of a managed session does.
    let state = |session: &str| {
        json!({
            "sessionId": session, "runnerAlive": true, "agentRunning": true,
            "openRun": true, "queuedCount": 0, "askPending": false, "lastExit": null,
        })
    };
    fx.forward("session-run-state", state("e1"));
    fx.forward("session-run-state", state("m2"));

    let events = phone.events_within(QUIET).await;
    let mut batched = Vec::new();
    let mut run_states = Vec::new();
    for event in &events {
        match AppEvent::from_event(event).unwrap().unwrap() {
            AppEvent::RunnerEvent(batch) => {
                assert_eq!(batch.session_id, "m1");
                batched.extend(batch.events.iter().map(|e| e["n"].as_u64().unwrap()));
            }
            AppEvent::SessionRunState(state) => run_states.push(state.session_id),
            other => panic!("unexpected {}", other.name()),
        }
    }
    assert_eq!(batched, [0, 1, 2]);
    assert!(
        events.iter().filter(|e| e.name == "runner.event").count() < 3,
        "batched, not one message per event"
    );
    assert_eq!(run_states, ["m2"]);

    phone
        .call::<phone::SessionUnsubscribe>(&sid("m1"))
        .await
        .unwrap();
    fx.forward("runner-event", progress("m1", 9));
    assert!(phone.events_within(QUIET).await.is_empty());
}

#[tokio::test]
async fn a_full_event_queue_asks_the_phone_to_resync() {
    let (fx, keys) = Fixture::paired(RemoteTuning {
        sink_capacity: 2,
        ..fast()
    })
    .await;
    fx.session("m1", RuntimeKind::Managed, None).await;
    let mut phone = fx.phone(&keys).await;
    wait_until(|| fx.module.status().online_phones == 1).await;
    // Synchronously, faster than the mapping task can drain two slots.
    for n in 0..200 {
        fx.forward(
            "session-queue:changed",
            json!({"sessionId": "m1", "items": [{"queueId": format!("q{n}"), "text": "t", "queuedAt": "now"}]}),
        );
    }
    let Some(AppEvent::SyncRequired(sync)) = phone.event("sync.required", WAIT).await else {
        panic!("sync.required expected");
    };
    assert_eq!(sync.session_id, None);
}

#[tokio::test]
async fn a_dropped_relay_connection_reconnects_and_the_phone_handshakes_again() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let mut phone = fx.phone(&keys).await;
    phone.call::<phone::Hello>(&hello_params(1)).await.unwrap();

    fx.relay.drop_host();
    let mut saw_offline = false;
    loop {
        match phone.next_incoming(WAIT).await.expect("PEER notices") {
            Incoming::HostOnline(false) => saw_offline = true,
            Incoming::HostOnline(true) if saw_offline => break,
            other => panic!("unexpected {other:?}"),
        }
    }
    fx.relay.wait_host_connects(2).await;
    let hello = phone.handshake(&keys).await;
    assert_eq!(hello.desktop_name, "Test Mac");
    phone.call::<phone::Hello>(&hello_params(1)).await.unwrap();
    wait_until(|| {
        let status = fx.module.status();
        status.relay_connected && status.online_phones == 1
    })
    .await;
}

#[tokio::test]
async fn unpairing_closes_phones_and_forgets_the_key() {
    let (fx, keys) = Fixture::paired(fast()).await;
    let mut phone = fx.phone(&keys).await;
    wait_until(|| fx.module.status().online_phones == 1).await;

    fx.module.unpair().await.unwrap();
    assert_eq!(phone.expect_close().await, CloseReason::Unpaired);
    assert!(remote_pairing::read_master_key(&fx.galley)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        fx.module.status(),
        RemoteStatus {
            paired: false,
            relay_connected: false,
            online_phones: 0,
            last_phone_connected_at: fx.module.status().last_phone_connected_at,
        }
    );
    // Stopped for good: no reconnect.
    tokio::time::sleep(QUIET).await;
    assert_eq!(fx.relay.host_connects(), 1);
    assert!(!fx.relay.host_online());
    assert!(fx.module.event_sink().await.is_none());

    // Pairing again makes a new key, so the old phone cannot get in.
    let qr = fx.module.pair().await.unwrap();
    let fresh = PairingCode::parse(qr.as_str())
        .unwrap()
        .master_key()
        .derive();
    assert_ne!(
        fresh.noise_psk.expose_secret(),
        keys.noise_psk.expose_secret()
    );
}

#[tokio::test]
async fn pushes_are_sealed_per_device_and_a_410_forgets_the_token() {
    let (fx, keys) = Fixture::paired(fast()).await;
    // Nobody registered: nothing to send.
    assert_eq!(
        fx.module
            .send_push("reply_done", Some("m1"), "t", "b")
            .await
            .unwrap(),
        0
    );
    let mut phone = fx.phone(&keys).await;
    phone
        .call::<phone::DeviceRegisterPush>(&phone::RegisterPushParams {
            token: "AABBCC".into(),
            env: PushEnv::Sandbox,
        })
        .await
        .unwrap();
    let invalid = phone
        .call::<phone::DeviceRegisterPush>(&phone::RegisterPushParams {
            token: "not hex".into(),
            env: PushEnv::Sandbox,
        })
        .await
        .unwrap_err();
    assert_eq!(invalid.code, error_code::INVALID_ARGS);
    assert_eq!(push_devices(&fx.galley).await.unwrap()[0].token, "aabbcc");

    let sent = fx
        .module
        .send_push("reply_done", Some("m1"), "会话标题", "回复摘要")
        .await
        .unwrap();
    assert_eq!(sent, 1);
    wait_until(|| fx.relay.pushes().len() == 1).await;
    let push = fx.relay.pushes()[0].clone();
    assert_eq!(push.device_token, vec![0xaa, 0xbb, 0xcc]);
    assert_eq!(push.env, PushEnv::Sandbox);
    let content = push_seal::open(&keys.push_key, &push.sealed).unwrap();
    assert_eq!(content.kind, "reply_done");
    assert_eq!(content.session_id.as_deref(), Some("m1"));
    assert_eq!(
        (content.title.as_str(), content.body.as_str()),
        ("会话标题", "回复摘要")
    );
    assert!(content.seq > 1_700_000_000_000);

    let bad_kind = fx.module.send_push("Reply Done", None, "t", "b").await;
    assert!(bad_kind.is_err());

    fx.relay.send_to_host(Frame::PushResult(PushResult {
        request_id: push.request_id,
        status: PushStatus::Unregistered,
        apns_status: 410,
        reason: "Unregistered".into(),
    }));
    let deadline = Instant::now() + WAIT;
    while !push_devices(&fx.galley).await.unwrap().is_empty() {
        assert!(Instant::now() < deadline, "the token was not removed");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let stored = fx
        .galley
        .get_pref_json(PUSH_DEVICES_PREF)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored, json!([]));
}

#[tokio::test]
async fn an_unpaired_desktop_does_not_connect() {
    let fx = Fixture::new(fast()).await;
    assert!(!fx.module.start_if_paired().await.unwrap());
    tokio::time::sleep(QUIET).await;
    assert_eq!(fx.relay.host_connects(), 0);
    assert!(!fx.module.status().paired);
    assert!(fx.module.send_push("goal", None, "t", "b").await.is_err());
    // And with no relay URL anywhere there is no module at all.
    assert_eq!(resolve_relay_url(None, None), Ok(None));
}

#[tokio::test]
async fn a_session_past_its_age_is_closed_as_expired() {
    let (fx, keys) = Fixture::paired(RemoteTuning {
        session_max_age: Duration::from_millis(300),
        ..fast()
    })
    .await;
    let mut phone = fx.phone(&keys).await;
    assert_eq!(phone.expect_close().await, CloseReason::Expired);
    wait_until(|| fx.module.status().online_phones == 0).await;
    // The phone reconnects (re-handshakes) and is served again.
    phone.handshake(&keys).await;
    phone.call::<phone::Hello>(&hello_params(1)).await.unwrap();
}
