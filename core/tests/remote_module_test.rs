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
//! Events are fed to the module's sink the way `TauriNotifier` does. The
//! phone and Core helpers live in `common/remote.rs`, shared with
//! `remote_e2e_test.rs` (the same pieces against the real relay).

mod common;

use common::remote::{
    create_session, fast, hello_params, sid, wait_until, Core, FakePhone, FakeRunner, Incoming,
    TestNotifier, QUIET, WAIT,
};
use futures_util::{SinkExt, StreamExt};
use galley_core_lib::api::{
    CreateProjectInput, GalleyApi, MessageVisibility, Origin, RuntimeKind, SessionId,
};
use galley_core_lib::db::{PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::remote::{
    push::{push_devices, PUSH_DEVICES_PREF},
    resolve_relay_url, RemoteModule, RemoteStatus, RemoteTuning, SESSION_NOT_MANAGED,
};
use galley_core_lib::remote_pairing;
use galley_core_lib::runner_manager::RunState;
use galley_remote_protocol::app::{self as phone, error_code, AppEvent, PROTOCOL_VERSION};
use galley_remote_protocol::frame::{
    Frame, PeerId, PushEnv, PushRequest, PushResult, PushStatus, Role, HEADER_CHANNEL,
    HEADER_RELAY_VERSION, HEADER_ROLE,
};
use galley_remote_protocol::keys::{DerivedKeys, MasterKey, PairingCode};
use galley_remote_protocol::noise::CloseReason;
use galley_remote_protocol::push as push_seal;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse, Request as WsRequest, Response as WsResponse,
};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

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
        let relay = FakeRelay::start().await;
        let Core {
            pool,
            galley,
            runner,
            notifier,
            module,
        } = Core::new(&relay.url, tuning).await;
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
        let mut phone = FakePhone::connect(&self.relay.url, keys).await;
        phone.handshake(keys).await;
        phone
    }

    fn forward(&self, event: &str, payload: Value) {
        self.notifier.emit(event, payload);
    }

    async fn session(&self, id: &str, runtime: RuntimeKind, project: Option<&str>) {
        create_session(&self.galley, id, runtime, project).await;
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

    let mut phone = FakePhone::connect(&fx.relay.url, &keys).await;
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
    let mut wrong = FakePhone::connect(&fx.relay.url, &keys).await;
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
