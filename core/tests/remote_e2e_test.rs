//! Remote access end to end (ticket 06b): the real relay (`galley-relay`,
//! in process on 127.0.0.1:0) between Core's remote module and a fake
//! phone, with a recording `ApnsSender` where APNs would be.
//!
//! `remote_module_test.rs` runs the same Core and phone against a minimal
//! fake relay; this one proves the three agree on the wire as built:
//! Core's host connection and the phone's client connection pass the
//! relay's header checks, `PEER` notices and `DATA` routing carry the
//! Noise session, a `PUSH` from Core reaches the APNs seam with content
//! only the phone's push key opens, and the relay's `PUSH_RESULT` makes
//! Core forget a dead token. Nothing leaves 127.0.0.1.

mod common;

use async_trait::async_trait;
use common::remote::{create_session, fast, hello_params, sid, wait_until, Core, FakePhone, WAIT};
use galley_core_lib::api::RuntimeKind;
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::remote::push::push_devices;
use galley_relay::{ApnsResponse, ApnsSender, Limits, Server};
use galley_remote_protocol::app::{self as phone, AppEvent, PROTOCOL_VERSION};
use galley_remote_protocol::frame::{
    device_token_from_hex, PushEnv, PushPriority, PushRequest, PushStatus,
};
use galley_remote_protocol::keys::PairingCode;
use galley_remote_protocol::push::{self as push_seal, kind, APNS_MAX_PAYLOAD_LEN, SEALED_LEN};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Instant};

/// A 32-byte APNs device token, as the phone registers it.
const DEVICE_TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

/// Stands where APNs would: keeps every push, answers from a script
/// (200 once it runs out).
#[derive(Default)]
struct RecordingApns {
    pushes: Mutex<Vec<PushRequest>>,
    answers: Mutex<VecDeque<ApnsResponse>>,
}

#[async_trait]
impl ApnsSender for RecordingApns {
    async fn send(&self, push: &PushRequest) -> ApnsResponse {
        self.pushes.lock().unwrap().push(push.clone());
        self.answers
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(ApnsResponse {
                status: PushStatus::Ok,
                apns_status: 200,
                reason: String::new(),
            })
    }
}

impl RecordingApns {
    fn pushes(&self) -> Vec<PushRequest> {
        self.pushes.lock().unwrap().clone()
    }
}

/// The relay library, serving until dropped.
struct RealRelay {
    url: String,
    metrics: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl RealRelay {
    async fn start(apns: Arc<dyn ApnsSender>) -> Self {
        let loopback: SocketAddr = "127.0.0.1:0".parse().unwrap();
        let server = Server::bind(loopback, loopback, Limits::default(), apns)
            .await
            .unwrap();
        let url = format!("ws://{}", server.relay_addr().unwrap());
        let metrics = server.metrics_addr().unwrap();
        let (stop, stopped) = oneshot::channel::<()>();
        let task = tokio::spawn(server.run(async {
            let _ = stopped.await;
        }));
        Self {
            url,
            metrics,
            stop: Some(stop),
            task,
        }
    }

    /// `GET /metrics`, as the operator would read it.
    async fn metrics(&self) -> Value {
        let mut stream = TcpStream::connect(self.metrics).await.unwrap();
        stream
            .write_all(b"GET /metrics HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        timeout(WAIT, stream.read_to_string(&mut response))
            .await
            .unwrap()
            .unwrap();
        let (_, body) = response.split_once("\r\n\r\n").unwrap();
        serde_json::from_str(body).unwrap()
    }

    async fn metrics_when(&self, ready: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + WAIT;
        loop {
            let m = self.metrics().await;
            if ready(&m) {
                return m;
            }
            assert!(Instant::now() < deadline, "metrics never settled: {m}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

impl Drop for RealRelay {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        self.task.abort();
    }
}

#[tokio::test]
async fn core_and_a_phone_talk_through_the_real_relay_and_pushes_reach_apns() {
    let apns = Arc::new(RecordingApns::default());
    let relay = RealRelay::start(apns.clone()).await;
    let core = Core::new(&relay.url, fast()).await;

    // Pairing: the QR carries the relay's base URL; Core connects as host.
    let qr = core.module.pair().await.unwrap();
    let code = PairingCode::parse(qr.as_str()).unwrap();
    assert_eq!(code.relay().as_str(), relay.url);
    let keys = code.master_key().derive();
    wait_until(|| core.module.status().relay_connected).await;
    *core.notifier.sink.lock().unwrap() = core.module.event_sink().await;

    // Handshake and hello through the relay.
    let mut phone = FakePhone::connect(&relay.url, &keys).await;
    let hello = phone.handshake(&keys).await;
    assert_eq!(hello.protocol, PROTOCOL_VERSION);
    assert_eq!(hello.desktop_name, "Test Mac");
    let again = phone.call::<phone::Hello>(&hello_params(1)).await.unwrap();
    assert_eq!(again, hello);
    wait_until(|| core.module.status().online_phones == 1).await;
    let m = relay
        .metrics_when(|m| m["connections"]["client"] == 1)
        .await;
    assert_eq!(m["connections"]["host"], 1);
    assert_eq!(m["channels"], 1);

    // sessions.list: managed sessions only.
    create_session(&core.galley, "m1", RuntimeKind::Managed, None).await;
    create_session(&core.galley, "e1", RuntimeKind::External, None).await;
    core.runner.live.lock().unwrap().insert("m1".into());
    let list = phone
        .call::<phone::SessionsList>(&phone::Empty {})
        .await
        .unwrap();
    let ids: Vec<&str> = list.sessions.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["m1"]);

    // session.send: persisted, dispatched to the runner, announced back.
    let sent = phone
        .call::<phone::SessionSend>(&phone::SessionSendParams {
            session_id: "m1".into(),
            text: "从手机发的".into(),
            images: vec![],
            client_request_id: Some("phone-1".into()),
        })
        .await
        .unwrap();
    assert_eq!(sent.outcome, phone::SendOutcome::Dispatched);
    let message = sent.message.unwrap();
    assert_eq!(message.content, "从手机发的");
    let commands = core.runner.commands.lock().unwrap().clone();
    let [(session, IpcCommand::UserMessage(command))] = commands.as_slice() else {
        panic!("one user_message expected, got {commands:?}");
    };
    assert_eq!(
        (session.as_str(), command.text.as_str()),
        ("m1", "从手机发的")
    );
    for expected in [phone::Dispatch::Pending, phone::Dispatch::Dispatched] {
        let Some(AppEvent::MessagePersisted(event)) = phone.event("message.persisted", WAIT).await
        else {
            panic!("message.persisted expected");
        };
        assert_eq!(event.dispatch, expected);
        assert_eq!(event.client_request_id.as_deref(), Some("phone-1"));
        assert_eq!(event.message.id, message.id);
    }

    // A subscribed session's runner events reach the phone.
    phone
        .call::<phone::SessionSubscribe>(&sid("m1"))
        .await
        .unwrap();
    core.notifier.emit(
        "runner-event",
        json!({"sessionId": "m1", "event": {"kind": "turn_progress", "n": 7}}),
    );
    let Some(AppEvent::RunnerEvent(batch)) = phone.event("runner.event", WAIT).await else {
        panic!("runner.event expected");
    };
    assert_eq!(batch.session_id, "m1");
    assert_eq!(batch.events, [json!({"kind": "turn_progress", "n": 7})]);

    // The phone registers its token; a push goes out through the relay.
    phone
        .call::<phone::DeviceRegisterPush>(&phone::RegisterPushParams {
            token: DEVICE_TOKEN.to_uppercase(),
            env: PushEnv::Sandbox,
        })
        .await
        .unwrap();
    let sent = core
        .module
        .send_push(kind::REPLY_DONE, Some("m1"), "会话标题", "回复摘要")
        .await
        .unwrap();
    assert_eq!(sent, 1);
    wait_until(|| apns.pushes().len() == 1).await;
    let push = apns.pushes().remove(0);
    assert_eq!(
        push.device_token,
        device_token_from_hex(DEVICE_TOKEN).unwrap()
    );
    assert_eq!(push.env, PushEnv::Sandbox);
    assert_eq!(push.priority, PushPriority::Immediate);
    assert_eq!(push.collapse_id, None);
    assert_eq!(push.sealed.len(), SEALED_LEN);
    // What the relay hands APNs never shows the text. (Strings long
    // enough not to turn up in 2076 random bytes by chance.)
    for plain in ["会话标题", "回复摘要", "reply_done"] {
        assert!(
            !push
                .sealed
                .windows(plain.len())
                .any(|w| w == plain.as_bytes()),
            "{plain} in the sealed push"
        );
    }
    // The phone opens what APNs would deliver: `g` of the payload the
    // relay builds, with its push key.
    let payload = push_seal::apns_payload(&push.sealed).unwrap();
    assert!(payload.len() <= APNS_MAX_PAYLOAD_LEN);
    let payload: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(payload["aps"]["mutable-content"], 1);
    let content = push_seal::open_g(&keys.push_key, payload["g"].as_str().unwrap()).unwrap();
    assert_eq!(content.kind, kind::REPLY_DONE);
    assert_eq!(content.session_id.as_deref(), Some("m1"));
    assert_eq!(
        (content.title.as_str(), content.body.as_str()),
        ("会话标题", "回复摘要")
    );
    assert!(content.seq > 1_700_000_000_000);
    // APNs said 200: the token stays.
    relay.metrics_when(|m| m["pushes"]["ok"] == 1).await;
    assert_eq!(push_devices(&core.galley).await.unwrap().len(), 1);

    // APNs says 410: the relay's PUSH_RESULT makes Core forget the token.
    apns.answers.lock().unwrap().push_back(ApnsResponse {
        status: PushStatus::Unregistered,
        apns_status: 410,
        reason: "Unregistered".into(),
    });
    let sent = core
        .module
        .send_push(kind::ASK_USER, Some("m1"), "会话标题", "在问你：继续吗？")
        .await
        .unwrap();
    assert_eq!(sent, 1);
    let deadline = Instant::now() + WAIT;
    while !push_devices(&core.galley).await.unwrap().is_empty() {
        assert!(Instant::now() < deadline, "the token was not removed");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let second = apns.pushes().remove(1);
    let content = push_seal::open(&keys.push_key, &second.sealed).unwrap();
    assert_eq!(content.kind, kind::ASK_USER);
    let m = relay.metrics().await;
    assert_eq!(m["pushes"]["requested"], 2);
    assert_eq!(m["pushes"]["ok"], 1);
    assert_eq!(m["pushes"]["unregistered"], 1);
    assert_eq!(m["pushes"]["failed"], 0);

    // No device left: the next push has nobody to go to.
    assert_eq!(
        core.module
            .send_push(kind::GOAL, None, "t", "b")
            .await
            .unwrap(),
        0
    );
    core.module.stop().await;
}
