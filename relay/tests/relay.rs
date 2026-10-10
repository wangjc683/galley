//! In-process relay tests: the relay on `127.0.0.1:0`, a fake host and
//! fake clients as plain WebSocket clients speaking 05a frames. Timers
//! that would make a test slow (idle timeout, stall timeout, rate) are
//! shrunk through `Limits` instead of pausing tokio's clock, because
//! paused time auto-advances while the runtime waits on real sockets.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use galley_relay::apns::REASON_PUSH_UNAVAILABLE;
use galley_relay::{close, ApnsResponse, ApnsSender, Limits, PushUnavailable, Server};
use galley_remote_protocol::frame::{
    Frame, PeerId, PushEnv, PushPriority, PushRequest, PushResult, PushStatus, Role, CONNECT_PATH,
    HEADER_CHANNEL, HEADER_RELAY_VERSION, HEADER_ROLE, MAX_DATA_PAYLOAD, MAX_FRAME_LEN,
};
use galley_remote_protocol::keys::ChannelSecret;
use galley_remote_protocol::push::SEALED_LEN;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const WAIT: Duration = Duration::from_secs(5);

// ------------------------------------------------------------ harness ----

struct TestRelay {
    addr: SocketAddr,
    metrics: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

async fn start(limits: Limits) -> TestRelay {
    start_with(limits, Arc::new(PushUnavailable)).await
}

async fn start_with(limits: Limits, apns: Arc<dyn ApnsSender>) -> TestRelay {
    let loopback: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let server = Server::bind(loopback, loopback, limits, apns)
        .await
        .unwrap();
    let addr = server.relay_addr().unwrap();
    let metrics = server.metrics_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let task = tokio::spawn(server.run(async {
        let _ = stopped.await;
    }));
    TestRelay {
        addr,
        metrics,
        stop: Some(stop),
        task,
    }
}

fn secret(byte: u8) -> ChannelSecret {
    ChannelSecret::from_bytes([byte; 32])
}

fn galley_headers(role: Role, secret: &ChannelSecret) -> Vec<(String, String)> {
    vec![
        (HEADER_RELAY_VERSION.into(), "1".into()),
        (HEADER_ROLE.into(), role.as_str().into()),
        (HEADER_CHANNEL.into(), secret.to_header_value()),
    ]
}

fn request(addr: SocketAddr, path: &str, headers: &[(String, String)]) -> Request {
    let mut req = format!("ws://{addr}{path}").into_client_request().unwrap();
    for (name, value) in headers {
        req.headers_mut().append(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value).unwrap(),
        );
    }
    req
}

async fn join(relay: &TestRelay, role: Role, secret: &ChannelSecret) -> Ws {
    let req = request(relay.addr, CONNECT_PATH, &galley_headers(role, secret));
    let (ws, response) = connect_async(req).await.expect("upgrade");
    assert_eq!(response.status(), 101);
    ws
}

/// The HTTP status of a refused upgrade.
async fn refused(relay: &TestRelay, path: &str, headers: &[(String, String)]) -> u16 {
    match connect_async(request(relay.addr, path, headers)).await {
        Err(WsError::Http(response)) => response.status().as_u16(),
        Err(e) => panic!("expected an HTTP refusal, got {e}"),
        Ok(_) => panic!("expected an HTTP refusal, got an upgrade"),
    }
}

async fn send(ws: &mut Ws, frame: Frame) {
    ws.send(Message::binary(frame.encode().unwrap()))
        .await
        .unwrap();
}

async fn next_frame(ws: &mut Ws) -> Frame {
    loop {
        let message = timeout(WAIT, ws.next())
            .await
            .expect("a frame in time")
            .expect("connection open")
            .expect("no WebSocket error");
        match message {
            Message::Binary(bytes) => return Frame::decode(&bytes).expect("a valid frame"),
            Message::Ping(_) | Message::Pong(_) => continue,
            other => panic!("expected a frame, got {other:?}"),
        }
    }
}

/// Read until the relay closes; its close code, or `None` if the socket
/// just ended.
async fn closed(ws: &mut Ws) -> Option<u16> {
    loop {
        match timeout(WAIT, ws.next()).await.expect("closed in time") {
            Some(Ok(Message::Close(frame))) => return frame.map(|f| u16::from(f.code)),
            Some(Ok(_)) => continue,
            Some(Err(_)) | None => return None,
        }
    }
}

/// Nothing arrives for `wait`.
async fn quiet(ws: &mut Ws, wait: Duration) {
    if let Ok(message) = timeout(wait, ws.next()).await {
        panic!("expected silence, got {message:?}");
    }
}

/// A PING / PONG round trip: everything this connection sent before has
/// been handled by the relay.
async fn round_trip(ws: &mut Ws, nonce: u64) {
    send(ws, Frame::Ping(nonce)).await;
    assert_eq!(next_frame(ws).await, Frame::Pong(nonce));
}

fn peer(id: u32, online: bool) -> Frame {
    Frame::Peer {
        peer: PeerId(id),
        role: if id == 0 { Role::Host } else { Role::Client },
        online,
    }
}

fn data(id: u32, payload: &[u8]) -> Frame {
    Frame::Data {
        peer: PeerId(id),
        payload: payload.to_vec(),
    }
}

fn push(request_id: u32) -> Frame {
    Frame::Push(PushRequest {
        request_id,
        env: PushEnv::Sandbox,
        priority: PushPriority::Immediate,
        device_token: vec![0xab; 32],
        collapse_id: Some("c1".into()),
        sealed: vec![0x11; SEALED_LEN],
    })
}

async fn http_get(addr: SocketAddr, path: &str) -> String {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    let mut out = String::new();
    timeout(WAIT, stream.read_to_string(&mut out))
        .await
        .expect("response in time")
        .unwrap();
    out
}

async fn metrics_body(relay: &TestRelay) -> String {
    let response = http_get(relay.metrics, "/metrics").await;
    let (head, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(head.starts_with("HTTP/1.1 200"), "{head}");
    assert!(head.to_ascii_lowercase().contains("application/json"));
    body.to_string()
}

async fn metrics(relay: &TestRelay) -> Value {
    serde_json::from_str(&metrics_body(relay).await).unwrap()
}

/// Poll the counters until `ready` holds (gauges settle just after the
/// event a test sees).
async fn metrics_when(relay: &TestRelay, ready: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + WAIT;
    loop {
        let m = metrics(relay).await;
        if ready(&m) {
            return m;
        }
        assert!(Instant::now() < deadline, "metrics never settled: {m}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// -------------------------------------------------------------- tests ----

#[tokio::test]
async fn data_is_routed_both_ways_with_peer_stamping() {
    let relay = start(Limits::default()).await;
    let s = secret(1);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut a = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    assert_eq!(next_frame(&mut a).await, peer(0, true));
    let mut b = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(2, true));
    assert_eq!(next_frame(&mut b).await, peer(0, true));

    // Client → host: stamped with the client's id.
    send(&mut a, data(0, b"from a")).await;
    assert_eq!(next_frame(&mut host).await, data(1, b"from a"));
    send(&mut b, data(0, b"from b")).await;
    assert_eq!(next_frame(&mut host).await, data(2, b"from b"));

    // Host → one client: the peer becomes 0, the other client hears
    // nothing.
    send(&mut host, data(2, b"to b")).await;
    assert_eq!(next_frame(&mut b).await, data(0, b"to b"));
    send(&mut host, data(1, b"to a")).await;
    assert_eq!(next_frame(&mut a).await, data(0, b"to a"));
    quiet(&mut b, Duration::from_millis(100)).await;

    // The largest legal frame passes.
    let full = vec![0x5a; MAX_DATA_PAYLOAD];
    send(&mut a, data(0, &full)).await;
    assert_eq!(next_frame(&mut host).await, data(1, &full));

    // A host frame for a client that is not there is dropped and counted.
    send(&mut host, data(9, b"nobody")).await;
    round_trip(&mut host, 1).await;
    let m = metrics(&relay).await;
    assert_eq!(m["dropped"]["unknown_peer"], 1);
    assert_eq!(m["channels"], 1);
    assert_eq!(m["connections"]["host"], 1);
    assert_eq!(m["connections"]["client"], 2);

    // A client naming any peer but 0 breaks the protocol.
    send(&mut a, data(2, b"sideways")).await;
    assert_eq!(closed(&mut a).await, Some(close::POLICY_VIOLATION));
    assert_eq!(next_frame(&mut host).await, peer(1, false));
    assert_eq!(metrics(&relay).await["errors"]["bad_peer"], 1);
}

#[tokio::test]
async fn peer_notices_and_replay_to_a_late_host() {
    let relay = start(Limits::default()).await;
    let s = secret(2);
    // Clients before any host learn it is offline.
    let mut a = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut a).await, peer(0, false));
    let mut b = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut b).await, peer(0, false));

    // Client data with no host is dropped and counted.
    send(&mut a, data(0, b"anyone?")).await;
    round_trip(&mut a, 7).await;
    assert_eq!(metrics(&relay).await["dropped"]["no_host"], 1);

    // The host is told about every client already there.
    let mut host = join(&relay, Role::Host, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    assert_eq!(next_frame(&mut host).await, peer(2, true));
    assert_eq!(next_frame(&mut a).await, peer(0, true));
    assert_eq!(next_frame(&mut b).await, peer(0, true));

    // A client leaves: the host hears it; ids are not reused.
    a.close(None).await.unwrap();
    assert_eq!(next_frame(&mut host).await, peer(1, false));
    let mut c = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut c).await, peer(0, true));
    assert_eq!(next_frame(&mut host).await, peer(3, true));

    // The host leaves: every client hears it.
    host.close(None).await.unwrap();
    assert_eq!(next_frame(&mut b).await, peer(0, false));
    assert_eq!(next_frame(&mut c).await, peer(0, false));

    // A channel lives while it has a connection.
    drop(b);
    drop(c);
    metrics_when(&relay, |m| {
        m["channels"] == 0 && m["connections"]["client"] == 0 && m["connections"]["host"] == 0
    })
    .await;
}

#[tokio::test]
async fn a_new_host_replaces_the_old_one() {
    let relay = start(Limits::default()).await;
    let s = secret(3);
    let mut old = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut old).await, peer(1, true));
    assert_eq!(next_frame(&mut client).await, peer(0, true));

    let mut new = join(&relay, Role::Host, &s).await;
    assert_eq!(closed(&mut old).await, Some(close::REPLACED));
    // The client sees the old host go and the new one come.
    assert_eq!(next_frame(&mut client).await, peer(0, false));
    assert_eq!(next_frame(&mut client).await, peer(0, true));
    assert_eq!(next_frame(&mut new).await, peer(1, true));

    send(&mut client, data(0, b"hello new host")).await;
    assert_eq!(next_frame(&mut new).await, data(1, b"hello new host"));
    send(&mut new, data(1, b"hello client")).await;
    assert_eq!(next_frame(&mut client).await, data(0, b"hello client"));

    // The old host leaving later says nothing to the client.
    quiet(&mut client, Duration::from_millis(100)).await;
    let m = metrics_when(&relay, |m| m["connections"]["host"] == 1).await;
    assert_eq!(m["hostsReplaced"], 1);
    assert_eq!(m["connectionsTotal"]["host"], 2);
}

#[tokio::test]
async fn a_fifth_client_is_refused() {
    let relay = start(Limits::default()).await;
    let s = secret(4);
    let mut clients = Vec::new();
    for _ in 0..4 {
        clients.push(join(&relay, Role::Client, &s).await);
    }
    let headers = galley_headers(Role::Client, &s);
    assert_eq!(refused(&relay, CONNECT_PATH, &headers).await, 429);
    // Another channel is unaffected, and a host still gets in.
    let _other = join(&relay, Role::Client, &secret(5)).await;
    let mut host = join(&relay, Role::Host, &s).await;
    for id in 1..=4 {
        assert_eq!(next_frame(&mut host).await, peer(id, true));
    }

    // When one leaves, the next one gets a fresh id.
    let mut first = clients.remove(0);
    first.close(None).await.unwrap();
    assert_eq!(next_frame(&mut host).await, peer(1, false));
    let _fifth = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(5, true));
    assert_eq!(metrics(&relay).await["rejected"]["channel_full"], 1);
}

#[tokio::test]
async fn bad_requests_are_refused_before_the_upgrade() {
    let relay = start(Limits::default()).await;
    let s = secret(6);
    let good = galley_headers(Role::Host, &s);
    let without = |name: &str| -> Vec<(String, String)> {
        good.iter().filter(|(n, _)| n != name).cloned().collect()
    };
    let with = |name: &str, value: &str| -> Vec<(String, String)> {
        let mut h = without(name);
        h.push((name.into(), value.into()));
        h
    };

    assert_eq!(refused(&relay, "/v1/other", &good).await, 404);
    assert_eq!(refused(&relay, "/v1/connect?channel=x", &good).await, 400);
    assert_eq!(
        refused(&relay, CONNECT_PATH, &without(HEADER_RELAY_VERSION)).await,
        400
    );
    assert_eq!(
        refused(&relay, CONNECT_PATH, &with(HEADER_RELAY_VERSION, "2")).await,
        400
    );
    assert_eq!(
        refused(&relay, CONNECT_PATH, &without(HEADER_ROLE)).await,
        400
    );
    assert_eq!(
        refused(&relay, CONNECT_PATH, &with(HEADER_ROLE, "Host")).await,
        400
    );
    assert_eq!(
        refused(&relay, CONNECT_PATH, &without(HEADER_CHANNEL)).await,
        400
    );
    // 31 bytes, padded base64, not base64url.
    let short = ChannelSecret::from_bytes([7; 32]).to_header_value()[..42].to_string();
    for bad in [short.as_str(), "AAAA=", "+/+/"] {
        assert_eq!(
            refused(&relay, CONNECT_PATH, &with(HEADER_CHANNEL, bad)).await,
            400,
            "{bad}"
        );
    }
    // The same header twice.
    let mut twice = good.clone();
    twice.push((HEADER_CHANNEL.into(), secret(8).to_header_value()));
    assert_eq!(refused(&relay, CONNECT_PATH, &twice).await, 400);

    // Plain HTTP: not a WebSocket upgrade, or not the connect path.
    assert!(http_get(relay.addr, CONNECT_PATH)
        .await
        .starts_with("HTTP/1.1 400"));
    assert!(http_get(relay.addr, "/").await.starts_with("HTTP/1.1 404"));

    let m = metrics(&relay).await;
    assert_eq!(m["rejected"]["not_found"], 2);
    assert_eq!(m["rejected"]["bad_request"], 2);
    assert_eq!(m["rejected"]["bad_relay_version"], 2);
    assert_eq!(m["rejected"]["bad_role"], 2);
    assert_eq!(m["rejected"]["bad_channel"], 5);
    // Nothing joined.
    assert_eq!(m["channels"], 0);
    assert_eq!(m["connectionsTotal"]["host"], 0);
}

#[tokio::test]
async fn malformed_frames_are_counted_and_closed() {
    let relay = start(Limits::default()).await;
    let s = secret(9);
    let cases: [(&[u8], &str); 5] = [
        (&[], "empty"),
        (&[0x07, 0x00], "unknown_type"),
        (&[0x01, 0x00, 0x00, 0x00], "truncated"),
        (&[0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0], "trailing_bytes"),
        (&[0x02, 0, 0, 0, 1, 3, 1], "invalid_field"),
    ];
    for (bytes, label) in cases {
        let mut client = join(&relay, Role::Client, &s).await;
        assert_eq!(next_frame(&mut client).await, peer(0, false));
        client.send(Message::binary(bytes.to_vec())).await.unwrap();
        assert_eq!(
            closed(&mut client).await,
            Some(close::POLICY_VIOLATION),
            "{label}"
        );
        assert_eq!(metrics(&relay).await["errors"][label], 1, "{label}");
    }

    // Text is not a relay frame.
    let mut client = join(&relay, Role::Client, &s).await;
    client.send(Message::text("hello")).await.unwrap();
    assert_eq!(closed(&mut client).await, Some(close::UNSUPPORTED_DATA));
    assert_eq!(metrics(&relay).await["errors"]["text_message"], 1);

    // Relay → end frames from an end break the protocol.
    for frame in [
        peer(0, true),
        Frame::Pong(1),
        Frame::PushResult(PushResult {
            request_id: 1,
            status: PushStatus::Failed,
            apns_status: 0,
            reason: String::new(),
        }),
    ] {
        let mut host = join(&relay, Role::Host, &s).await;
        send(&mut host, frame).await;
        assert_eq!(closed(&mut host).await, Some(close::POLICY_VIOLATION));
    }
    assert_eq!(metrics(&relay).await["errors"]["wrong_direction"], 3);
}

#[tokio::test]
async fn an_oversize_message_is_refused() {
    let relay = start(Limits::default()).await;
    let s = secret(10);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    let mut too_big = data(0, &[1]).encode().unwrap();
    too_big.resize(MAX_FRAME_LEN + 1, 0);
    // The relay stops reading at the header, so the close frame may lose
    // the race against a reset; either way the connection ends.
    let _ = client.send(Message::binary(too_big)).await;
    let code = closed(&mut client).await;
    assert!(
        code.is_none() || code == Some(close::MESSAGE_TOO_BIG),
        "{code:?}"
    );
    assert_eq!(next_frame(&mut host).await, peer(1, false));
    assert_eq!(metrics(&relay).await["errors"]["oversize"], 1);
}

#[tokio::test]
async fn heartbeat_timeout_closes_idle_connections_only() {
    let limits = Limits {
        idle_timeout: Duration::from_millis(500),
        ..Limits::default()
    };
    let relay = start(limits).await;
    let s = secret(11);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    assert_eq!(next_frame(&mut client).await, peer(0, true));

    // Both PING every 100 ms for 1.5 s: answered by the relay, and both
    // connections outlive three idle timeouts.
    for nonce in 0..15u64 {
        round_trip(&mut client, nonce).await;
        round_trip(&mut host, nonce).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // The client goes quiet while the host keeps pinging: the client is
    // closed after the idle timeout, and the host only ever sees its own
    // PONGs and then the offline notice, so no PING was forwarded.
    let quiet_from = Instant::now();
    let mut nonce = 100;
    loop {
        assert!(
            quiet_from.elapsed() < WAIT,
            "the idle client was never closed"
        );
        send(&mut host, Frame::Ping(nonce)).await;
        match next_frame(&mut host).await {
            Frame::Pong(_) => {}
            frame if frame == peer(1, false) => break,
            other => panic!("host got {other:?}"),
        }
        nonce += 1;
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(quiet_from.elapsed() >= Duration::from_millis(400));
    assert_eq!(closed(&mut client).await, Some(close::IDLE_TIMEOUT));

    // Then the host goes quiet too.
    assert_eq!(closed(&mut host).await, Some(close::IDLE_TIMEOUT));
    assert_eq!(metrics(&relay).await["errors"]["idle_timeout"], 2);
}

#[tokio::test]
async fn the_rate_limit_slows_a_sender_down_without_dropping_it() {
    let limits = Limits {
        rate_bytes_per_sec: 64 * 1024,
        burst_bytes: 64 * 1024,
        ..Limits::default()
    };
    let relay = start(limits).await;
    let s = secret(12);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    assert_eq!(next_frame(&mut client).await, peer(0, true));

    // Four 32 KiB frames: two fit the burst, the other two owe 0.5 s each.
    let payload = vec![0x42; 32 * 1024 - 5];
    let sent_at = Instant::now();
    for _ in 0..4 {
        send(&mut client, data(0, &payload)).await;
    }
    for _ in 0..4 {
        assert_eq!(next_frame(&mut host).await, data(1, &payload));
    }
    let elapsed = sent_at.elapsed();
    assert!(elapsed >= Duration::from_millis(900), "{elapsed:?}");

    // Still connected, nothing counted as an error.
    round_trip(&mut client, 3).await;
    let m = metrics(&relay).await;
    assert!(
        m["errors"].as_object().unwrap().values().all(|v| v == 0),
        "{m}"
    );
}

#[tokio::test]
async fn a_receiver_that_stops_reading_is_closed_as_too_slow() {
    let limits = Limits {
        rate_bytes_per_sec: 1 << 30,
        burst_bytes: 1 << 30,
        outbound_queue_bytes: 64 * 1024,
        stall_timeout: Duration::from_millis(300),
        ..Limits::default()
    };
    let relay = start(limits).await;
    let s = secret(13);
    let host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut client).await, peer(0, true));
    // From here on the client never reads.

    let (mut host_tx, mut host_rx) = host.split();
    let flood = tokio::spawn(async move {
        let frame = data(1, &vec![0x33; 60 * 1024]).encode().unwrap();
        // Enough to fill both sockets' kernel buffers and the queue.
        for _ in 0..2000 {
            if host_tx.send(Message::binary(frame.clone())).await.is_err() {
                break;
            }
        }
        host_tx
    });
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        assert!(
            Instant::now() < deadline,
            "the slow client was never closed"
        );
        let message = timeout(Duration::from_secs(20), host_rx.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Binary(bytes) = message {
            let frame = Frame::decode(&bytes).unwrap();
            if frame == peer(1, false) {
                break;
            }
            assert_eq!(frame, peer(1, true));
        }
    }
    flood.abort();
    let m = metrics(&relay).await;
    assert_eq!(m["errors"]["slow_consumer"], 1);
    drop(client);
}

struct FixedApns(ApnsResponse);

#[async_trait]
impl ApnsSender for FixedApns {
    async fn send(&self, push: &PushRequest) -> ApnsResponse {
        assert_eq!(push.device_token, vec![0xab; 32]);
        assert_eq!(push.sealed.len(), SEALED_LEN);
        self.0.clone()
    }
}

#[tokio::test]
async fn a_host_push_is_answered_push_unavailable_by_default() {
    let relay = start(Limits::default()).await;
    let mut host = join(&relay, Role::Host, &secret(14)).await;
    send(&mut host, push(42)).await;
    assert_eq!(
        next_frame(&mut host).await,
        Frame::PushResult(PushResult {
            request_id: 42,
            status: PushStatus::Failed,
            apns_status: 0,
            reason: REASON_PUSH_UNAVAILABLE.into(),
        })
    );
    let m = metrics(&relay).await;
    assert_eq!(m["pushes"]["requested"], 1);
    assert_eq!(m["pushes"]["failed"], 1);
}

#[tokio::test]
async fn a_push_sender_answer_reaches_the_host() {
    let gone = ApnsResponse {
        status: PushStatus::Unregistered,
        apns_status: 410,
        reason: "Unregistered".into(),
    };
    let relay = start_with(Limits::default(), Arc::new(FixedApns(gone))).await;
    let mut host = join(&relay, Role::Host, &secret(15)).await;
    send(&mut host, push(7)).await;
    assert_eq!(
        next_frame(&mut host).await,
        Frame::PushResult(PushResult {
            request_id: 7,
            status: PushStatus::Unregistered,
            apns_status: 410,
            reason: "Unregistered".into(),
        })
    );
    assert_eq!(metrics(&relay).await["pushes"]["unregistered"], 1);

    // A sender answer that breaks the PUSH_RESULT rules still gets the
    // host an answer.
    let broken = ApnsResponse {
        status: PushStatus::Ok,
        apns_status: 500,
        reason: String::new(),
    };
    let relay = start_with(Limits::default(), Arc::new(FixedApns(broken))).await;
    let mut host = join(&relay, Role::Host, &secret(15)).await;
    send(&mut host, push(8)).await;
    assert_eq!(
        next_frame(&mut host).await,
        Frame::PushResult(PushResult {
            request_id: 8,
            status: PushStatus::Failed,
            apns_status: 0,
            reason: "relay_error".into(),
        })
    );
}

#[tokio::test]
async fn a_client_may_not_push() {
    let relay = start(Limits::default()).await;
    let s = secret(16);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    send(&mut client, push(1)).await;
    assert_eq!(closed(&mut client).await, Some(close::POLICY_VIOLATION));
    // The host sees the client leave and no push result.
    assert_eq!(next_frame(&mut host).await, peer(1, false));
    let m = metrics(&relay).await;
    assert_eq!(m["errors"]["wrong_direction"], 1);
    assert_eq!(m["pushes"]["requested"], 0);
}

#[tokio::test]
async fn metrics_carry_no_identifiers() {
    let relay = start(Limits::default()).await;
    let s = secret(17);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    send(&mut client, data(0, b"payload")).await;
    assert_eq!(next_frame(&mut host).await, data(1, b"payload"));
    send(&mut host, push(1)).await;
    next_frame(&mut host).await;

    let body = metrics_body(&relay).await;
    let m: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(m["channels"], 1);
    assert!(m["bytesIn"].as_u64().unwrap() > 0);
    assert!(m["bytesOut"].as_u64().unwrap() > 0);

    let key = s.channel_key();
    let hex: String = key.as_bytes().iter().map(|b| format!("{b:02x}")).collect();
    let hex_upper = hex.to_ascii_uppercase();
    let token_hex = "ab".repeat(32);
    for needle in [
        s.to_header_value(),
        hex,
        hex_upper,
        token_hex,
        "127.0.0.1".to_string(),
    ] {
        assert!(!body.contains(&needle), "metrics contain {needle}");
    }
    // The raw key bytes cannot appear in JSON numbers or ASCII keys, and
    // every string value is a fixed one.
    fn strings(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => out.push(s.clone()),
            Value::Array(a) => a.iter().for_each(|v| strings(v, out)),
            Value::Object(o) => o.values().for_each(|v| strings(v, out)),
            _ => {}
        }
    }
    let mut values = Vec::new();
    strings(&m, &mut values);
    assert_eq!(values, vec![env!("CARGO_PKG_VERSION").to_string()]);

    assert!(http_get(relay.metrics, "/")
        .await
        .starts_with("HTTP/1.1 404"));
}

#[tokio::test]
async fn shutdown_closes_every_connection_with_going_away() {
    let mut relay = start(Limits::default()).await;
    let s = secret(18);
    let mut host = join(&relay, Role::Host, &s).await;
    let mut client = join(&relay, Role::Client, &s).await;
    assert_eq!(next_frame(&mut host).await, peer(1, true));
    assert_eq!(next_frame(&mut client).await, peer(0, true));

    relay.stop.take().unwrap().send(()).unwrap();
    // Either close may come after a last PEER offline notice.
    assert_eq!(closed(&mut host).await, Some(close::GOING_AWAY));
    assert_eq!(closed(&mut client).await, Some(close::GOING_AWAY));
    timeout(WAIT, relay.task).await.unwrap().unwrap();
    assert!(TcpStream::connect(relay.addr).await.is_err());
}
