//! Golden fixtures in `tests/golden/`: the bytes and JSON this crate
//! produces, which the Swift package (ticket 07a) decodes and reproduces.
//!
//! Each test builds its fixture from the code, checks that the code also
//! decodes it back, and compares it with the file. A mismatch means the
//! wire format changed: if that is intended, regenerate with
//!
//! ```text
//! GALLEY_UPDATE_GOLDEN=1 cargo test --manifest-path core/Cargo.toml -p galley-remote-protocol --test golden
//! ```
//!
//! and review the diff. Files are pretty JSON with object keys sorted
//! (so they do not depend on serde_json's `preserve_order` feature, which
//! the workspace turns on for the CLI), LF line endings, and a top-level
//! `fixture` naming what they hold.

use std::any::type_name;
use std::fmt::Debug;
use std::path::PathBuf;

use galley_remote_protocol::app::chunk::{Chunker, Reassembler};
use galley_remote_protocol::app::*;
use galley_remote_protocol::frame::*;
use galley_remote_protocol::keys::*;
use galley_remote_protocol::noise::{self, CloseReason, Record};
use galley_remote_protocol::padding;
use galley_remote_protocol::push::{self, PushContent};
use serde::Serialize;
use serde_json::{json, Value};

// ------------------------------------------------------------ harness ----

fn golden_path(file: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("golden")
        .join(file)
}

/// Sort object keys recursively.
fn canonical(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(k, v)| (k, canonical(v)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(canonical).collect()),
        other => other,
    }
}

fn check_golden(file: &str, doc: Value) {
    let text = serde_json::to_string_pretty(&canonical(doc)).unwrap() + "\n";
    let path = golden_path(file);
    if std::env::var("GALLEY_UPDATE_GOLDEN").as_deref() == Ok("1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
        return;
    }
    let on_disk = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| {
            panic!(
                "{}: {e}; generate it with GALLEY_UPDATE_GOLDEN=1",
                path.display()
            )
        })
        // A Windows checkout may have converted line endings.
        .replace("\r\n", "\n");
    if on_disk != text {
        let line = on_disk
            .lines()
            .zip(text.lines())
            .position(|(a, b)| a != b)
            .map_or_else(|| "end of file".to_string(), |i| format!("line {}", i + 1));
        panic!(
            "{file} no longer matches the code (first difference at {line}). If the wire \
             format change is intended, rerun with GALLEY_UPDATE_GOLDEN=1 and review the diff."
        );
    }
}

fn hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn short_type_name<T>() -> &'static str {
    type_name::<T>().rsplit("::").next().unwrap()
}

/// The fixed master key of every fixture: bytes 0x00..=0x1f.
fn master_key() -> MasterKey {
    let mut bytes = [0u8; KEY_LEN];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    MasterKey::from_bytes(bytes)
}

const RELAY: &str = "wss://relay.example.com";
const DESKTOP_NAME: &str = "JC 的 MacBook";

// --------------------------------------------------------------- keys ----

#[test]
fn golden_keys() {
    let mk = master_key();
    let keys = mk.derive();
    let code = PairingCode::new(
        RelayUrl::parse(RELAY).unwrap(),
        mk.clone(),
        DESKTOP_NAME.into(),
    )
    .unwrap();
    let qr = code.to_qr_string();
    let parsed = PairingCode::parse(&qr).unwrap();
    assert_eq!(parsed.master_key().expose_secret(), mk.expose_secret());
    assert_eq!(parsed.desktop_name(), DESKTOP_NAME);

    let mk64 = mk.to_base64url();
    let bad_qr = [
        (
            "wrong version",
            format!(
                "galley-pair:2?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=a",
                *mk64
            ),
        ),
        (
            "mk too short",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=a",
                &mk64[..41]
            ),
        ),
        (
            "mk is padded",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}=&name=a",
                *mk64
            ),
        ),
        (
            "ws:// to a remote relay",
            format!(
                "galley-pair:1?relay=ws%3A%2F%2Frelay.example.com&mk={}&name=a",
                *mk64
            ),
        ),
        (
            "unknown field",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=a&v=2",
                *mk64
            ),
        ),
        (
            "duplicate field",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=a&name=b",
                *mk64
            ),
        ),
        (
            "incomplete UTF-8 sequence",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=%E7%9A",
                *mk64
            ),
        ),
        (
            "bad percent escape",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=%G1",
                *mk64
            ),
        ),
        (
            "raw space",
            format!(
                "galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk={}&name=a b",
                *mk64
            ),
        ),
    ];
    let invalid: Vec<Value> = bad_qr
        .iter()
        .map(|(why, input)| {
            let err = PairingCode::parse(input).expect_err(why);
            json!({"input": input, "why": why, "rustError": format!("{err:?}")})
        })
        .collect();

    check_golden(
        "keys.json",
        json!({
            "fixture": "galley-remote/keys",
            "description": "Pairing master key, its HKDF-SHA256 derivations, the channel key and the pairing QR string (design §3.1). Hex unless named otherwise.",
            "masterKey": hex(mk.expose_secret()),
            "masterKeyBase64url": *mk64,
            "hkdf": {
                "salt": "galley-remote-v1",
                "info": {"channelSecret": "channel", "noisePsk": "noise-psk", "pushKey": "push"},
            },
            "channelSecret": hex(keys.channel_secret.expose_secret()),
            "channelSecretHeader": keys.channel_secret.to_header_value(),
            "channelKey": hex(keys.channel_secret.channel_key().as_bytes()),
            "noisePsk": hex(keys.noise_psk.expose_secret()),
            "pushKey": hex(keys.push_key.expose_secret()),
            "qr": {
                "string": *qr,
                "relay": code.relay().as_str(),
                "relayConnectUrl": code.relay().connect_url(),
                "desktopName": DESKTOP_NAME,
            },
            "qrInvalid": invalid,
        }),
    );
}

// ------------------------------------------------------------- frames ----

fn frame_fields(frame: &Frame) -> Value {
    match frame {
        Frame::Data { peer, payload } => json!({"peer": peer.0, "payload": hex(payload)}),
        Frame::Peer { peer, role, online } => {
            json!({"peer": peer.0, "role": role.as_str(), "online": online})
        }
        Frame::Push(p) => json!({
            "requestId": p.request_id,
            "env": p.env,
            "priority": p.priority.code(),
            "deviceToken": hex(&p.device_token),
            "collapseId": p.collapse_id,
            "sealed": hex(&p.sealed),
        }),
        Frame::PushResult(r) => json!({
            "requestId": r.request_id,
            "status": match r.status {
                PushStatus::Ok => "ok",
                PushStatus::Unregistered => "unregistered",
                PushStatus::Failed => "failed",
            },
            "apnsStatus": r.apns_status,
            "reason": r.reason,
        }),
        Frame::Ping(nonce) | Frame::Pong(nonce) => json!({"nonce": nonce}),
    }
}

#[test]
fn golden_frames() {
    let token: Vec<u8> = (0..32u8).map(|i| 0xa0 ^ i).collect();
    let frames: Vec<(&str, Frame)> = vec![
        (
            "data-host-to-client-3",
            Frame::Data {
                peer: PeerId(3),
                payload: b"noise message bytes".to_vec(),
            },
        ),
        (
            "data-client-side",
            Frame::Data {
                peer: PeerId::HOST,
                payload: vec![0x00, 0xff, 0x10],
            },
        ),
        (
            "peer-host-online",
            Frame::Peer {
                peer: PeerId::HOST,
                role: Role::Host,
                online: true,
            },
        ),
        (
            "peer-client-7-offline",
            Frame::Peer {
                peer: PeerId(7),
                role: Role::Client,
                online: false,
            },
        ),
        (
            "push",
            Frame::Push(PushRequest {
                request_id: 0x0102_0304,
                env: PushEnv::Production,
                priority: PushPriority::Immediate,
                device_token: token.clone(),
                collapse_id: Some("c-5f2a".into()),
                sealed: (0..28u8).collect(),
            }),
        ),
        (
            "push-sandbox-no-collapse",
            Frame::Push(PushRequest {
                request_id: 9,
                env: PushEnv::Sandbox,
                priority: PushPriority::PowerConsiderate,
                device_token: token,
                collapse_id: None,
                sealed: vec![0x5a; 30],
            }),
        ),
        (
            "push-result-ok",
            Frame::PushResult(PushResult {
                request_id: 0x0102_0304,
                status: PushStatus::Ok,
                apns_status: 200,
                reason: String::new(),
            }),
        ),
        (
            "push-result-unregistered",
            Frame::PushResult(PushResult {
                request_id: 9,
                status: PushStatus::Unregistered,
                apns_status: 410,
                reason: "Unregistered".into(),
            }),
        ),
        (
            "push-result-failed",
            Frame::PushResult(PushResult {
                request_id: 10,
                status: PushStatus::Failed,
                apns_status: 0,
                reason: "apns_unreachable".into(),
            }),
        ),
        ("ping", Frame::Ping(1_234_567_890)),
        ("pong", Frame::Pong(1_234_567_890)),
    ];
    let mut valid = Vec::new();
    for (name, frame) in &frames {
        let bytes = frame.encode().unwrap();
        assert_eq!(&Frame::decode(&bytes).unwrap(), frame, "{name}");
        valid.push(json!({
            "name": name,
            "type": frame.type_name(),
            "fields": frame_fields(frame),
            "hex": hex(&bytes),
        }));
    }
    let invalid_cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("unknown type 0x00", vec![0x00, 1, 2]),
        ("unknown type 0x7f", vec![0x7f]),
        ("DATA without payload", vec![0x01, 0, 0, 0, 3]),
        ("DATA header cut", vec![0x01, 0, 0]),
        (
            "PEER host id with client role",
            vec![0x02, 0, 0, 0, 0, 0x02, 1],
        ),
        ("PEER online byte 2", vec![0x02, 0, 0, 0, 1, 0x02, 2]),
        ("PEER trailing byte", vec![0x02, 0, 0, 0, 1, 0x02, 1, 0]),
        ("PUSH unknown env", {
            let mut b = vec![0x03, 0, 0, 0, 1, 0x02, 10, 0, 1, 0xaa, 0];
            b.extend([0u8; 28]);
            b
        }),
        ("PUSH priority 9", {
            let mut b = vec![0x03, 0, 0, 0, 1, 0x00, 9, 0, 1, 0xaa, 0];
            b.extend([0u8; 28]);
            b
        }),
        ("PUSH sealed shorter than nonce and tag", {
            let mut b = vec![0x03, 0, 0, 0, 1, 0x00, 10, 0, 1, 0xaa, 0];
            b.extend([0u8; 27]);
            b
        }),
        (
            "PUSH_RESULT ok with HTTP 400",
            vec![0x04, 0, 0, 0, 1, 0x00, 0x01, 0x90, 0],
        ),
        (
            "PUSH_RESULT reason cut",
            vec![0x04, 0, 0, 0, 1, 0x02, 0, 0, 5, b'a'],
        ),
        ("PING cut", vec![0x05, 0, 0, 0, 0, 0, 0, 0]),
        ("PONG trailing byte", vec![0x06, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
    ];
    let invalid: Vec<Value> = invalid_cases
        .iter()
        .map(|(why, bytes)| {
            let err = Frame::decode(bytes).expect_err(why);
            json!({"why": why, "hex": hex(bytes), "error": err.label()})
        })
        .collect();
    check_golden(
        "frames.json",
        json!({
            "fixture": "galley-remote/frames",
            "description": "Relay frames (design §4.2): each valid frame's fields and exact bytes, and invalid byte strings with the error label a strict decoder gives.",
            "relayProtocolVersion": RELAY_PROTOCOL_VERSION,
            "connect": {
                "path": CONNECT_PATH,
                "headers": [HEADER_CHANNEL, HEADER_ROLE, HEADER_RELAY_VERSION],
            },
            "frames": valid,
            "invalid": invalid,
        }),
    );
}

// ------------------------------------------------------------ padding ----

#[test]
fn golden_padding() {
    let lens = [
        0usize,
        1,
        100,
        254,
        255,
        256,
        300,
        1000,
        1022,
        1023,
        4096,
        10_000,
        48_000,
        65_000,
        padding::MAX_PAYLOAD_LEN,
    ];
    let sizes: Vec<Value> = lens
        .iter()
        .map(|&len| json!({"payloadLen": len, "paddedLen": padding::padded_len(len).unwrap()}))
        .collect();
    let example = padding::pad(b"hello").unwrap();
    assert_eq!(padding::unpad(&example).unwrap(), b"hello");
    check_golden(
        "padding.json",
        json!({
            "fixture": "galley-remote/padding",
            "description": "Plaintext padding (design §5): u16 BE length ‖ payload ‖ zeros; total = max(256, Padmé(2 + len)) capped at 65519.",
            "minPaddedLen": padding::MIN_PADDED_LEN,
            "maxPlaintextLen": padding::MAX_PLAINTEXT_LEN,
            "maxPayloadLen": padding::MAX_PAYLOAD_LEN,
            "sizes": sizes,
            "example": {"payload": hex(b"hello"), "padded": hex(&example)},
        }),
    );
}

// -------------------------------------------------------------- noise ----

/// Fixed ephemerals: 0x40..=0x5f for the phone, 0x60..=0x7f for Core.
fn ephemeral(base: u8) -> [u8; 32] {
    let mut e = [0u8; 32];
    for (i, b) in e.iter_mut().enumerate() {
        *b = base + i as u8;
    }
    e
}

/// A record's padded plaintext, built the way `Transport` builds it.
fn record_plaintext(record_type: u8, body: &[u8]) -> Vec<u8> {
    let mut content = vec![record_type];
    content.extend_from_slice(body);
    padding::pad(&content).unwrap()
}

#[test]
fn golden_noise_nnpsk0() {
    let psk = master_key().derive().noise_psk;
    let client_e = ephemeral(0x40);
    let host_e = ephemeral(0x60);
    // Literal JSON (not generated) so the bytes cannot depend on serde
    // feature flags.
    let hello =
        r#"{"coreVersion":"0.6.2","desktopName":"JC 的 MacBook","protocol":{"major":1,"minor":0}}"#;
    let request = r#"{"t":"req","id":1,"m":"hello","p":{"appVersion":"1.0.0","protocol":{"major":1,"minor":0}}}"#;
    let response = r#"{"t":"res","id":1,"ok":true,"r":{"coreVersion":"0.6.2","desktopName":"JC 的 MacBook","protocol":{"major":1,"minor":0}}}"#;

    let (m1, client) =
        noise::client_start_with_fixed_ephemeral_for_testing_only(&psk, &client_e).unwrap();
    let host =
        noise::host_accept_with_fixed_ephemeral_for_testing_only(&psk, &m1, &host_e).unwrap();
    let (m2, mut host_t) = host.finish(hello.as_bytes()).unwrap();
    let (got_hello, mut client_t) = client.finish(&m2).unwrap();
    assert_eq!(got_hello, hello.as_bytes());
    assert_eq!(client_t.handshake_hash(), host_t.handshake_hash());

    let m3 = client_t.seal_app(request.as_bytes()).unwrap();
    assert_eq!(
        host_t.open(&m3).unwrap(),
        Record::App(request.as_bytes().to_vec())
    );
    let m4 = host_t.seal_app(response.as_bytes()).unwrap();
    assert_eq!(
        client_t.open(&m4).unwrap(),
        Record::App(response.as_bytes().to_vec())
    );
    let m5 = client_t.seal_close(CloseReason::Normal).unwrap();
    assert_eq!(
        host_t.open(&m5).unwrap(),
        Record::Close(CloseReason::Normal)
    );

    check_golden(
        "noise-nnpsk0.json",
        json!({
            "fixture": "galley-remote/noise",
            "description": "A whole P0 session with fixed ephemeral keys (design §5): handshake message 1 (empty payload), message 2 (padded Core hello), then APP records and a CLOSE. `plaintext` is what goes into the cipher; hex unless named *Text.",
            "protocolName": noise::NOISE_PARAMS,
            "prologue": hex(&noise::prologue()),
            "psk": hex(psk.expose_secret()),
            "pskSource": "keys.json noisePsk",
            "clientEphemeralPrivate": hex(&client_e),
            "hostEphemeralPrivate": hex(&host_e),
            "handshakeHash": hex(client_t.handshake_hash()),
            "recordTypes": {"app": noise::RECORD_APP, "close": noise::RECORD_CLOSE},
            "messages": [
                {"step": "handshake-1", "from": "client", "payload": "", "message": hex(&m1)},
                {
                    "step": "handshake-2", "from": "host",
                    "payloadText": hello,
                    "plaintext": hex(&padding::pad(hello.as_bytes()).unwrap()),
                    "message": hex(&m2),
                },
                {
                    "step": "transport", "from": "client", "record": "app",
                    "bodyText": request,
                    "plaintext": hex(&record_plaintext(noise::RECORD_APP, request.as_bytes())),
                    "message": hex(&m3),
                },
                {
                    "step": "transport", "from": "host", "record": "app",
                    "bodyText": response,
                    "plaintext": hex(&record_plaintext(noise::RECORD_APP, response.as_bytes())),
                    "message": hex(&m4),
                },
                {
                    "step": "transport", "from": "client", "record": "close",
                    "closeReason": CloseReason::Normal.code(),
                    "plaintext": hex(&record_plaintext(noise::RECORD_CLOSE, &[CloseReason::Normal.code()])),
                    "message": hex(&m5),
                },
            ],
        }),
    );
}

// --------------------------------------------------------------- push ----

#[test]
fn golden_push() {
    let key = master_key().derive().push_key;
    let nonce: [u8; push::NONCE_LEN] = core::array::from_fn(|i| 0xc0 + i as u8);
    let content = PushContent::new(
        1_791_600_000_000,
        Some("ses_7f3a9c".into()),
        push::kind::ASK_USER,
        "整理周报",
        "在问你：要不要把附件也发给 Alice？",
    )
    .unwrap();
    let sealed = push::seal_with_nonce_for_testing_only(&key, &content, &nonce).unwrap();
    let g = push::encode_g(&sealed);
    assert_eq!(push::open_g(&key, &g).unwrap(), content);
    let payload = push::apns_payload(&sealed).unwrap();
    assert!(payload.len() <= push::APNS_MAX_PAYLOAD_LEN);
    check_golden(
        "push.json",
        json!({
            "fixture": "galley-remote/push",
            "description": "One sealed push with a fixed nonce (design §4.3): content JSON padded to 2048 bytes, ChaCha20-Poly1305 with pushKey and AAD, g = base64(nonce ‖ ciphertext), and the full APNs payload.",
            "pushKey": hex(key.expose_secret()),
            "pushKeySource": "keys.json pushKey",
            "aadText": std::str::from_utf8(push::AAD).unwrap(),
            "nonce": hex(&nonce),
            "content": content,
            "contentJsonText": serde_json::to_string(&content).unwrap(),
            "paddedLen": push::PADDED_LEN,
            "paddedPlaintext": hex(&content.to_padded_plaintext().unwrap()),
            "sealedLen": push::SEALED_LEN,
            "g": g,
            "apnsPayloadText": payload,
            "apnsPayloadLen": payload.len(),
        }),
    );
}

// ---------------------------------------------------------------- app ----

fn wire_value(env: &Envelope) -> Value {
    serde_json::from_slice(&env.to_json()).unwrap()
}

/// Builds `app-messages.json`, checking every sample decodes back.
#[derive(Default)]
struct Samples {
    list: Vec<Value>,
    requested: Vec<&'static str>,
    answered: Vec<&'static str>,
    evented: Vec<&'static str>,
}

impl Samples {
    fn request<M: Method>(&mut self, id: u64, params: M::Params)
    where
        M::Params: PartialEq + Debug,
    {
        let env = Envelope::Request(Request::new::<M>(id, &params));
        let Envelope::Request(back) = Envelope::from_json(&env.to_json()).unwrap() else {
            panic!("{} request did not decode as a request", M::NAME)
        };
        assert_eq!(back.params::<M>().unwrap(), params);
        assert_eq!(
            ClientRequest::from_request(&back).unwrap().method(),
            M::NAME
        );
        self.requested.push(M::NAME);
        self.list.push(json!({
            "name": format!("{}.request", M::NAME),
            "kind": "request",
            "method": M::NAME,
            "type": short_type_name::<M::Params>(),
            "message": wire_value(&env),
        }));
    }

    fn response<M: Method>(&mut self, id: u64, result: M::Result)
    where
        M::Result: PartialEq + Debug,
    {
        let env = Envelope::Response(Response::ok::<M>(id, &result));
        let Envelope::Response(back) = Envelope::from_json(&env.to_json()).unwrap() else {
            panic!("{} response did not decode as a response", M::NAME)
        };
        assert_eq!(back.result::<M>().unwrap().unwrap(), result);
        self.answered.push(M::NAME);
        self.list.push(json!({
            "name": format!("{}.response", M::NAME),
            "kind": "response",
            "method": M::NAME,
            "type": short_type_name::<M::Result>(),
            "message": wire_value(&env),
        }));
    }

    fn error(&mut self, name: &str, method: &str, id: u64, error: ErrorBody) {
        let env = Envelope::Response(Response::error(id, error.clone()));
        let Envelope::Response(back) = Envelope::from_json(&env.to_json()).unwrap() else {
            panic!("{name} did not decode as a response")
        };
        assert_eq!(back.outcome, Err(error));
        self.list.push(json!({
            "name": name,
            "kind": "error",
            "method": method,
            "type": "ErrorBody",
            "message": wire_value(&env),
        }));
    }

    fn event<T: Serialize + Clone>(&mut self, make: fn(T) -> AppEvent, payload: T) {
        let event = make(payload);
        let env = Envelope::Event(event.to_event());
        let Envelope::Event(back) = Envelope::from_json(&env.to_json()).unwrap() else {
            panic!("{} did not decode as an event", event.name())
        };
        assert_eq!(AppEvent::from_event(&back).unwrap().as_ref(), Some(&event));
        self.evented.push(event.name());
        self.list.push(json!({
            "name": format!("event.{}", event.name()),
            "kind": "event",
            "event": event.name(),
            "type": short_type_name::<T>(),
            "message": wire_value(&env),
        }));
    }
}

fn session(id: &str) -> Session {
    Session {
        id: id.into(),
        project_id: Some("proj_a1b2c3d4e5f6a7b8".into()),
        title: "整理周报".into(),
        status: SessionStatus::Idle,
        summary: Some("Turn 3 · 汇总了三份周报".into()),
        turn_count: Some(3),
        last_activity_at: "2026-10-10T08:30:00.000Z".into(),
        created_at: "2026-10-09T02:00:00.000Z".into(),
        updated_at: "2026-10-10T08:30:00.000Z".into(),
        pinned: Some(true),
        has_unread: None,
        origin: Some(Origin {
            via: OriginVia::Gui,
            supervisor: None,
            reason: None,
        }),
        selected_llm_key: Some("mm_claude".into()),
        selected_llm_display_name: Some("Claude".into()),
        reasoning_effort: None,
    }
}

fn project() -> Project {
    Project {
        id: "proj_a1b2c3d4e5f6a7b8".into(),
        name: "周报".into(),
        icon: Some("📁".into()),
        color: None,
        pinned: false,
        last_activity_at: "2026-10-10T08:30:00.000Z".into(),
        created_at: "2026-09-01T00:00:00.000Z".into(),
        updated_at: "2026-09-01T00:00:00.000Z".into(),
    }
}

fn run_state() -> SessionRunState {
    SessionRunState {
        session_id: "ses_7f3a9c".into(),
        runner_alive: true,
        agent_running: true,
        open_run: true,
        queued_count: 1,
        ask_pending: false,
        last_exit: None,
    }
}

fn user_message() -> Message {
    Message {
        id: "msg_01".into(),
        session_id: "ses_7f3a9c".into(),
        role: MessageRole::User,
        content: "把三份周报合成一份".into(),
        turn_index: Some(3),
        sequence: None,
        final_answer: None,
        summary: None,
        thinking: None,
        preamble: None,
        tool_calls: None,
        tool_results: None,
        ask_user: None,
        telemetry: None,
        goal_id: None,
        origin: Some(Origin {
            via: OriginVia::Gui,
            supervisor: None,
            reason: None,
        }),
        attachments: vec![Attachment {
            id: "att_01".into(),
            message_id: "msg_01".into(),
            session_id: "ses_7f3a9c".into(),
            kind: "image".into(),
            mime_type: "image/jpeg".into(),
            byte_size: 182_044,
            width: Some(1179),
            height: Some(2556),
            created_at: "2026-10-10T08:29:58.000Z".into(),
        }],
        created_at: "2026-10-10T08:29:58.000Z".into(),
    }
}

fn agent_message() -> Message {
    Message {
        id: "msg_02".into(),
        session_id: "ses_7f3a9c".into(),
        role: MessageRole::Agent,
        content: "已合并。".into(),
        turn_index: Some(3),
        sequence: Some(1),
        final_answer: Some("已合并为 weekly.md。要不要把附件也发给 Alice？".into()),
        summary: Some("合并周报".into()),
        thinking: Some("先读三份文件。".into()),
        preamble: None,
        tool_calls: Some(json!([
            {"args": {"path": "weekly.md"}, "id": "call_1", "name": "file_write"},
            {"args": {"candidates": ["发", "不发"], "question": "要不要把附件也发给 Alice？"}, "id": "call_2", "name": "ask_user"}
        ])),
        tool_results: Some(json!([{"id": "call_1", "status": "success"}])),
        ask_user: Some(AskUser {
            question: "要不要把附件也发给 Alice？".into(),
            candidates: vec!["发".into(), "不发".into()],
        }),
        telemetry: Some(MessageTelemetry {
            elapsed_ms: Some(18_250),
            input_tokens: Some(5120),
            output_tokens: Some(388),
            cache_create_tokens: None,
            cache_read_tokens: Some(4096),
            request_count: Some(3),
            context_used_chars: None,
            context_limit_chars: None,
        }),
        goal_id: None,
        origin: None,
        attachments: vec![],
        created_at: "2026-10-10T08:30:16.000Z".into(),
    }
}

#[test]
fn golden_app_messages() {
    let mut s = Samples::default();
    let sid = || "ses_7f3a9c".to_string();
    let hello = CoreHello {
        protocol: PROTOCOL_VERSION,
        core_version: "0.6.2".into(),
        desktop_name: DESKTOP_NAME.into(),
    };

    s.request::<Hello>(
        1,
        HelloParams {
            protocol: PROTOCOL_VERSION,
            app_version: "1.0.0".into(),
        },
    );
    s.response::<Hello>(1, hello);
    s.request::<SessionsList>(2, Empty {});
    s.response::<SessionsList>(
        2,
        SessionsListResult {
            sessions: vec![session("ses_7f3a9c")],
            projects: vec![project()],
            run_states: vec![run_state()],
        },
    );
    s.request::<SessionMessages>(
        3,
        SessionMessagesParams {
            session_id: sid(),
            before: Some("msg_01".into()),
            limit: Some(MESSAGES_PAGE_DEFAULT),
        },
    );
    s.response::<SessionMessages>(
        3,
        SessionMessagesResult {
            messages: vec![user_message(), agent_message()],
            has_more: true,
        },
    );
    s.request::<SessionSend>(
        4,
        SessionSendParams {
            session_id: sid(),
            text: "发".into(),
            images: vec![ImageUpload {
                mime_type: "image/png".into(),
                data: "iVBORw0KGgo=".into(),
                width: Some(2),
                height: Some(2),
            }],
            client_request_id: Some("crq_ios_0001".into()),
        },
    );
    s.response::<SessionSend>(
        4,
        SessionSendResult {
            outcome: SendOutcome::Dispatched,
            message: Some(user_message()),
            queue: None,
        },
    );
    s.request::<SessionStop>(5, SessionIdParams { session_id: sid() });
    s.response::<SessionStop>(
        5,
        SessionStopResult {
            dispatch: StopDispatch::AbortSent,
        },
    );
    s.request::<SessionCreate>(
        6,
        SessionCreateParams {
            project_id: Some("proj_a1b2c3d4e5f6a7b8".into()),
            title: None,
        },
    );
    s.response::<SessionCreate>(
        6,
        SessionCreateResult {
            session: session("ses_new01"),
        },
    );
    s.request::<SessionMarkRead>(7, SessionIdParams { session_id: sid() });
    s.response::<SessionMarkRead>(7, Empty {});
    s.request::<SessionSubscribe>(8, SessionIdParams { session_id: sid() });
    s.response::<SessionSubscribe>(8, Empty {});
    s.request::<SessionUnsubscribe>(9, SessionIdParams { session_id: sid() });
    s.response::<SessionUnsubscribe>(9, Empty {});
    s.request::<AttachmentRead>(
        10,
        AttachmentReadParams {
            session_id: sid(),
            attachment_id: "att_01".into(),
        },
    );
    s.response::<AttachmentRead>(
        10,
        AttachmentReadResult {
            attachment_id: "att_01".into(),
            mime_type: "image/png".into(),
            byte_size: 8,
            data: "iVBORw0KGgo=".into(),
        },
    );
    s.request::<DeviceRegisterPush>(
        11,
        RegisterPushParams {
            token: "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf".into(),
            env: PushEnv::Sandbox,
        },
    );
    s.response::<DeviceRegisterPush>(11, Empty {});

    s.error(
        "error.unknown_method",
        "session.fly",
        12,
        ErrorBody::unknown_method("session.fly"),
    );
    s.error(
        "error.images_not_queueable",
        "session.send",
        13,
        ErrorBody::new(
            error_code::IMAGES_NOT_QUEUEABLE,
            "a run is in progress and a message with images cannot wait in the queue",
        ),
    );
    s.error(
        "error.protocol_mismatch",
        "hello",
        14,
        ErrorBody::new(
            error_code::PROTOCOL_MISMATCH,
            "desktop speaks 1.0, app speaks 2.0",
        ),
    );

    let session_event = |via: &str| SessionEvent {
        session: session("ses_7f3a9c"),
        via: via.into(),
    };
    s.event(AppEvent::SessionCreated, session_event("gui"));
    s.event(AppEvent::SessionUpdated, session_event("auto-title"));
    s.event(AppEvent::SessionArchived, session_event("session.archive"));
    s.event(AppEvent::SessionUnarchived, session_event("gui"));
    s.event(AppEvent::SessionMoved, session_event("gui"));
    s.event(
        AppEvent::SessionDeleted,
        SessionDeletedEvent {
            session_id: sid(),
            via: "gui".into(),
        },
    );
    s.event(
        AppEvent::ProjectCreated,
        ProjectEvent {
            project: project(),
            via: "gui".into(),
        },
    );
    s.event(
        AppEvent::ProjectUpdated,
        ProjectEvent {
            project: project(),
            via: "project.update".into(),
        },
    );
    s.event(
        AppEvent::ProjectDeleted,
        ProjectDeletedEvent {
            project_id: "proj_a1b2c3d4e5f6a7b8".into(),
            detached_session_ids: vec![sid()],
        },
    );
    s.event(
        AppEvent::MessagePersisted,
        MessagePersistedEvent {
            session_id: sid(),
            message: user_message(),
            dispatch: Dispatch::Pending,
            client_request_id: Some("crq_ios_0001".into()),
        },
    );
    s.event(AppEvent::RunnerEvent, RunnerEventBatch {
        session_id: sid(),
        events: vec![
            json!({"kind": "turn_progress", "sessionId": "ses_7f3a9c", "text": "正在读取", "timestamp": "2026-10-10T08:30:01.000Z", "turnIndex": 3}),
            json!({"absoluteTurnIndex": 3, "args": {"path": "a.md"}, "argsPreview": "a.md", "kind": "tool_call_start", "sessionId": "ses_7f3a9c", "timestamp": "2026-10-10T08:30:01.100Z", "toolCallId": "call_1", "toolName": "file_read", "turnIndex": 3}),
        ],
    });
    s.event(AppEvent::SessionRunState, run_state());
    s.event(
        AppEvent::HistoryReplay,
        HistoryReplayEvent {
            session_id: sid(),
            phase: ReplayPhase::Started,
        },
    );
    s.event(AppEvent::GoalUpdated, GoalUpdatedEvent {
        goal: json!({"id": "goal_01", "objective": "把周报发出去", "sessionId": "ses_7f3a9c", "status": "active"}),
    });
    s.event(
        AppEvent::QueueChanged,
        QueueChangedEvent {
            session_id: sid(),
            items: vec![QueuedMessage {
                queue_id: "qm_01".into(),
                text: "再检查一遍".into(),
                queued_at: "2026-10-10T08:30:05.000Z".into(),
            }],
        },
    );
    s.event(
        AppEvent::SyncRequired,
        SyncRequiredEvent { session_id: None },
    );

    // Every method and event has its sample.
    assert_eq!(s.requested, METHODS);
    assert_eq!(s.answered, METHODS);
    assert_eq!(s.evented, EVENTS);

    // A chunked response, with a small chunk size so it stays readable;
    // receivers accept any size up to CHUNK_DATA_MAX. The message is a
    // literal so the chunk bytes cannot depend on serde feature flags.
    let big_json = format!(
        r#"{{"t":"res","id":15,"ok":true,"r":{{"attachmentId":"att_02","mimeType":"image/png","byteSize":96,"data":"{}"}}}}"#,
        "A".repeat(128)
    );
    let big = Envelope::from_json(big_json.as_bytes()).unwrap();
    let typed = Response::ok::<AttachmentRead>(
        15,
        &AttachmentReadResult {
            attachment_id: "att_02".into(),
            mime_type: "image/png".into(),
            byte_size: 96,
            data: "A".repeat(128),
        },
    );
    assert_eq!(big, Envelope::Response(typed));
    let chunks = Chunker::new().split(big_json.as_bytes(), 96);
    let mut reassembler = Reassembler::new();
    let mut out = None;
    for c in &chunks {
        out = reassembler.push(Envelope::from_json(c).unwrap()).unwrap();
    }
    assert_eq!(out, Some(big.clone()));
    let chunk_values: Vec<Value> = chunks
        .iter()
        .map(|c| serde_json::from_slice(c).unwrap())
        .collect();

    check_golden(
        "app-messages.json",
        json!({
            "fixture": "galley-remote/app",
            "description": "App protocol samples (design §6): one request and one response per method, error responses, one event per event name, and a chunked message. `type` names the Rust type of p / r / e; `message` is the wire JSON (keys sorted here; key order on the wire is not significant).",
            "protocol": PROTOCOL_VERSION,
            "methods": METHODS,
            "events": EVENTS,
            "samples": s.list,
            "chunked": {
                "description": "The chunks' data joined in order is the JSON of `reassembled`.",
                "chunkSize": 96,
                "chunks": chunk_values,
                "reassembled": wire_value(&big),
            },
            "limits": {
                "maxAppRecordLen": noise::MAX_APP_RECORD_LEN,
                "chunkDataMax": galley_remote_protocol::app::chunk::CHUNK_DATA_MAX,
                "maxMessageLen": galley_remote_protocol::app::chunk::MAX_MESSAGE_LEN,
                "maxStreams": galley_remote_protocol::app::chunk::MAX_STREAMS,
                "messagesPageDefault": MESSAGES_PAGE_DEFAULT,
                "messagesPageMax": MESSAGES_PAGE_MAX,
            },
        }),
    );
}
