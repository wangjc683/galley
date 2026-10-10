//! The APNs sender against fake APNs servers: in-process HTTP/2 servers
//! (h2c, prior knowledge) on 127.0.0.1 that record every request and
//! answer from a script. One stands for production, one for the sandbox.
//! The key is a throwaway P-256 key made here; nothing reaches Apple.

use std::collections::VecDeque;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use galley_relay::apns::{
    ApnsClient, ApnsConfig, ApnsKey, ApnsResponse, ApnsSender, EXPIRATION_SECS,
    REASON_APNS_TIMEOUT, REASON_APNS_UNREACHABLE, REASON_PAYLOAD_TOO_LARGE,
};
use galley_relay::{Limits, Server};
use galley_remote_protocol::frame::{
    device_token_to_hex, Frame, PushEnv, PushPriority, PushRequest, PushResult, PushStatus, Role,
    CONNECT_PATH, HEADER_CHANNEL, HEADER_RELAY_VERSION, HEADER_ROLE, MAX_PUSH_SEALED_LEN,
};
use galley_remote_protocol::keys::ChannelSecret;
use galley_remote_protocol::push::{
    apns_payload, encode_g, APNS_MAX_PAYLOAD_LEN, PLACEHOLDER_BODY, PLACEHOLDER_TITLE, SEALED_LEN,
};
use http_body_util::{BodyExt as _, Full};
use hyper::body::Incoming;
use hyper::header::HeaderMap;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Version};
use hyper_util::rt::{TokioExecutor, TokioIo};
use ring::rand::SystemRandom;
use ring::signature::{
    EcdsaKeyPair, UnparsedPublicKey, ECDSA_P256_SHA256_FIXED, ECDSA_P256_SHA256_FIXED_SIGNING,
};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

const WAIT: Duration = Duration::from_secs(5);
const KEY_ID: &str = "KEYID12345";
const TEAM_ID: &str = "TEAM123456";
const TOPIC: &str = "xyz.inkstone.galley";

// ------------------------------------------------------- fake APNs ----

/// One request as the fake server saw it.
#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    path: String,
    version: Version,
    headers: HeaderMap,
    body: Bytes,
}

#[derive(Debug, Clone, Copy)]
enum Reply {
    /// This status, with `{"reason": …}` when given.
    Status(u16, Option<&'static str>),
    /// Never answer in time.
    Hang,
}

struct FakeApns {
    base: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    /// Answers in order; `200` once it runs out.
    script: Arc<Mutex<VecDeque<Reply>>>,
    connections: Arc<AtomicUsize>,
    task: JoinHandle<()>,
}

impl Drop for FakeApns {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeApns {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests: Arc<Mutex<Vec<Recorded>>> = Arc::default();
        let script: Arc<Mutex<VecDeque<Reply>>> = Arc::default();
        let connections = Arc::new(AtomicUsize::new(0));
        let (req, scr, conns) = (requests.clone(), script.clone(), connections.clone());
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                conns.fetch_add(1, Ordering::SeqCst);
                let (requests, script) = (req.clone(), scr.clone());
                let service = service_fn(move |request: Request<Incoming>| {
                    let (requests, script) = (requests.clone(), script.clone());
                    async move { Ok::<_, Infallible>(answer(request, &requests, &script).await) }
                });
                tokio::spawn(async move {
                    let _ = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        });
        Self {
            base,
            requests,
            script,
            connections,
            task,
        }
    }

    fn script(&self, replies: &[Reply]) {
        self.script.lock().unwrap().extend(replies.iter().copied());
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }
}

async fn answer(
    request: Request<Incoming>,
    requests: &Mutex<Vec<Recorded>>,
    script: &Mutex<VecDeque<Reply>>,
) -> Response<Full<Bytes>> {
    let (parts, body) = request.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    requests.lock().unwrap().push(Recorded {
        method: parts.method.to_string(),
        path: parts.uri.path().to_string(),
        version: parts.version,
        headers: parts.headers,
        body,
    });
    let reply = script
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or(Reply::Status(200, None));
    let (status, reason) = match reply {
        Reply::Status(status, reason) => (status, reason),
        Reply::Hang => {
            tokio::time::sleep(Duration::from_secs(60)).await;
            (200, None)
        }
    };
    let body = match reason {
        Some(reason) => Bytes::from(json!({ "reason": reason }).to_string()),
        None => Bytes::new(),
    };
    let mut response = Response::new(Full::new(body));
    *response.status_mut() = StatusCode::from_u16(status).unwrap();
    response
}

// ---------------------------------------------------------- sender ----

struct Setup {
    production: FakeApns,
    sandbox: FakeApns,
    client: Arc<ApnsClient>,
    public_key: Vec<u8>,
}

async fn setup_with_timeout(timeout: Duration) -> Setup {
    let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
        .unwrap();
    let key = ApnsKey::from_pkcs8_der(der.as_ref()).unwrap();
    let public_key = key.public_key().to_vec();
    let production = FakeApns::start().await;
    let sandbox = FakeApns::start().await;
    let config = ApnsConfig::new(key, KEY_ID, TEAM_ID, TOPIC).unwrap();
    let client =
        ApnsClient::with_endpoints_for_testing(config, &production.base, &sandbox.base, timeout)
            .unwrap();
    Setup {
        production,
        sandbox,
        client: Arc::new(client),
        public_key,
    }
}

async fn setup() -> Setup {
    setup_with_timeout(WAIT).await
}

fn push(env: PushEnv, priority: PushPriority, collapse_id: Option<&str>) -> PushRequest {
    PushRequest {
        request_id: 1,
        env,
        priority,
        device_token: (0u8..32).collect(),
        collapse_id: collapse_id.map(str::to_string),
        sealed: (0..SEALED_LEN).map(|i| (i % 251) as u8).collect(),
    }
}

fn header<'a>(request: &'a Recorded, name: &str) -> Option<&'a str> {
    request.headers.get(name).map(|v| v.to_str().unwrap())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn decode_json(part: &str) -> Value {
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
}

/// Check a request's provider token against Apple's rules and the key;
/// returns the JWT.
fn verify_jwt(request: &Recorded, public_key: &[u8]) -> String {
    let authorization = header(request, "authorization").expect("authorization header");
    let jwt = authorization
        .strip_prefix("bearer ")
        .expect("`bearer <token>`");
    let parts: Vec<&str> = jwt.split('.').collect();
    assert_eq!(parts.len(), 3, "header.claims.signature");
    assert_eq!(
        decode_json(parts[0]),
        json!({"alg": "ES256", "kid": KEY_ID})
    );
    let claims = decode_json(parts[1]);
    assert_eq!(claims.as_object().unwrap().len(), 2, "{claims}");
    assert_eq!(claims["iss"], TEAM_ID);
    let iat = claims["iat"].as_u64().expect("numeric iat");
    assert!(iat.abs_diff(now()) <= 60, "iat {iat} is now");
    let signature = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
    assert_eq!(signature.len(), 64, "ES256 is r ‖ s");
    UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, public_key)
        .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .expect("signed with the configured key");
    jwt.to_string()
}

fn ok() -> ApnsResponse {
    ApnsResponse {
        status: PushStatus::Ok,
        apns_status: 200,
        reason: String::new(),
    }
}

// ----------------------------------------------------------- tests ----

#[tokio::test]
async fn a_push_is_one_signed_http2_request_in_apples_shape() {
    let s = setup().await;
    let push = push(PushEnv::Sandbox, PushPriority::Immediate, Some("c-1"));
    assert_eq!(s.client.send(&push).await, ok());

    assert!(
        s.production.requests().is_empty(),
        "sandbox token, sandbox host"
    );
    let requests = s.sandbox.requests();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.version, Version::HTTP_2);
    assert_eq!(
        request.path,
        format!("/3/device/{}", device_token_to_hex(&push.device_token))
    );
    assert!(request
        .path
        .ends_with("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"));
    verify_jwt(request, &s.public_key);
    assert_eq!(header(request, "apns-topic"), Some(TOPIC));
    assert_eq!(header(request, "apns-push-type"), Some("alert"));
    assert_eq!(header(request, "apns-priority"), Some("10"));
    assert_eq!(header(request, "apns-collapse-id"), Some("c-1"));
    let expiration: u64 = header(request, "apns-expiration").unwrap().parse().unwrap();
    assert!(
        expiration.abs_diff(now() + EXPIRATION_SECS) <= 60,
        "{expiration}"
    );
    let mut apns_headers: Vec<&str> = request
        .headers
        .keys()
        .map(|name| name.as_str())
        .filter(|name| name.starts_with("apns-"))
        .collect();
    apns_headers.sort_unstable();
    assert_eq!(
        apns_headers,
        [
            "apns-collapse-id",
            "apns-expiration",
            "apns-priority",
            "apns-push-type",
            "apns-topic"
        ]
    );

    // The body: exactly 05a's payload, the shape of design §4.3.
    assert_eq!(request.body, apns_payload(&push.sealed).unwrap().as_bytes());
    assert!(request.body.len() <= APNS_MAX_PAYLOAD_LEN);
    assert_eq!(request.body.len(), 2871);
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(
        body,
        json!({
            "aps": {
                "alert": { "title": PLACEHOLDER_TITLE, "body": PLACEHOLDER_BODY },
                "mutable-content": 1,
                "sound": "default",
            },
            "g": encode_g(&push.sealed),
        })
    );
}

#[tokio::test]
async fn the_environment_picks_the_host_and_one_token_and_connection_serve_many() {
    let s = setup().await;
    let production = push(PushEnv::Production, PushPriority::PowerConsiderate, None);
    for _ in 0..3 {
        assert_eq!(s.client.send(&production).await, ok());
    }
    assert!(s.sandbox.requests().is_empty());
    let requests = s.production.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(header(&requests[0], "apns-priority"), Some("5"));
    assert_eq!(header(&requests[0], "apns-collapse-id"), None);
    let jwts: Vec<String> = requests
        .iter()
        .map(|r| verify_jwt(r, &s.public_key))
        .collect();
    assert!(
        jwts.iter().all(|jwt| *jwt == jwts[0]),
        "the token is cached"
    );
    assert_eq!(s.client.jwt_refreshes(), 1);
    assert_eq!(
        s.production.connections(),
        1,
        "one HTTP/2 connection reused"
    );

    let saving = push(PushEnv::Sandbox, PushPriority::PowerSaving, None);
    assert_eq!(s.client.send(&saving).await, ok());
    assert_eq!(header(&s.sandbox.requests()[0], "apns-priority"), Some("1"));
}

#[tokio::test]
async fn apns_answers_map_to_push_results() {
    let s = setup().await;
    s.sandbox.script(&[
        Reply::Status(410, Some("Unregistered")),
        Reply::Status(410, Some("ExpiredToken")),
        Reply::Status(400, Some("BadDeviceToken")),
        Reply::Status(429, Some("TooManyRequests")),
        Reply::Status(403, Some("Forbidden")),
        Reply::Status(500, None),
    ]);
    let push = push(PushEnv::Sandbox, PushPriority::Immediate, None);
    let expected = [
        (PushStatus::Unregistered, 410, "Unregistered"),
        (PushStatus::Unregistered, 410, "ExpiredToken"),
        (PushStatus::Failed, 400, "BadDeviceToken"),
        (PushStatus::Failed, 429, "TooManyRequests"),
        // A 403 that is not about the provider token is not retried.
        (PushStatus::Failed, 403, "Forbidden"),
        (PushStatus::Failed, 500, ""),
    ];
    for (status, apns_status, reason) in expected {
        let answer = s.client.send(&push).await;
        assert_eq!(
            (answer.status, answer.apns_status, answer.reason.as_str()),
            (status, apns_status, reason)
        );
    }
    assert_eq!(s.sandbox.requests().len(), expected.len());
    assert_eq!(s.client.jwt_refreshes(), 1);
}

#[tokio::test]
async fn a_rejected_provider_token_is_replaced_and_the_push_retried_once() {
    let s = setup().await;
    s.sandbox
        .script(&[Reply::Status(403, Some("ExpiredProviderToken"))]);
    let push = push(PushEnv::Sandbox, PushPriority::Immediate, None);
    assert_eq!(s.client.send(&push).await, ok());
    let requests = s.sandbox.requests();
    assert_eq!(requests.len(), 2, "the push, then its retry");
    let rejected = verify_jwt(&requests[0], &s.public_key);
    let fresh = verify_jwt(&requests[1], &s.public_key);
    assert_ne!(rejected, fresh, "retried with a new token");
    assert_eq!(requests[0].body, requests[1].body);
    assert_eq!(s.client.jwt_refreshes(), 2);

    // Rejected again right away: a new token cannot help yet (Apple's
    // 20-minute floor), so no retry and no new token.
    s.sandbox
        .script(&[Reply::Status(403, Some("InvalidProviderToken"))]);
    let answer = s.client.send(&push).await;
    assert_eq!(
        (answer.status, answer.apns_status, answer.reason.as_str()),
        (PushStatus::Failed, 403, "InvalidProviderToken")
    );
    assert_eq!(s.sandbox.requests().len(), 3);
    assert_eq!(s.client.jwt_refreshes(), 2);

    // The retry itself rejected: answered as it came, once.
    let s = setup().await;
    s.sandbox.script(&[
        Reply::Status(403, Some("InvalidProviderToken")),
        Reply::Status(403, Some("InvalidProviderToken")),
    ]);
    let answer = s.client.send(&push).await;
    assert_eq!(
        (answer.status, answer.apns_status),
        (PushStatus::Failed, 403)
    );
    assert_eq!(s.sandbox.requests().len(), 2);
}

#[tokio::test]
async fn no_answer_in_time_is_apns_timeout() {
    let s = setup_with_timeout(Duration::from_millis(300)).await;
    s.sandbox.script(&[Reply::Hang]);
    let push = push(PushEnv::Sandbox, PushPriority::Immediate, None);
    let started = Instant::now();
    assert_eq!(
        s.client.send(&push).await,
        ApnsResponse::not_sent(REASON_APNS_TIMEOUT)
    );
    assert!(started.elapsed() < Duration::from_secs(3));
    // The connection still serves the next push.
    assert_eq!(s.client.send(&push).await, ok());
}

#[tokio::test]
async fn no_server_is_apns_unreachable_and_an_oversize_push_is_not_sent() {
    let s = setup().await;
    // A port nobody listens on.
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let closed_base = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
        .unwrap();
    let config = ApnsConfig::new(
        ApnsKey::from_pkcs8_der(der.as_ref()).unwrap(),
        KEY_ID,
        TEAM_ID,
        TOPIC,
    )
    .unwrap();
    let nowhere =
        ApnsClient::with_endpoints_for_testing(config, &closed_base, &closed_base, WAIT).unwrap();
    let push = push(PushEnv::Production, PushPriority::Immediate, None);
    assert_eq!(
        nowhere.send(&push).await,
        ApnsResponse::not_sent(REASON_APNS_UNREACHABLE)
    );

    // Frames cap the sealed push so this never happens; the sender checks
    // the 4096 bytes itself anyway.
    let oversize = PushRequest {
        sealed: vec![0; MAX_PUSH_SEALED_LEN + 1],
        ..push
    };
    assert_eq!(
        s.client.send(&oversize).await,
        ApnsResponse::not_sent(REASON_PAYLOAD_TOO_LARGE)
    );
    assert!(s.production.requests().is_empty());
}

// ------------------------------------------------ through the relay ----

async fn next_frame<S>(ws: &mut S) -> Frame
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let message = timeout(WAIT, ws.next())
            .await
            .expect("a frame in time")
            .expect("open")
            .expect("no WebSocket error");
        if let Message::Binary(bytes) = message {
            return Frame::decode(&bytes).unwrap();
        }
    }
}

async fn metrics(addr: SocketAddr) -> Value {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(b"GET /metrics HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut out = String::new();
    timeout(WAIT, stream.read_to_string(&mut out))
        .await
        .unwrap()
        .unwrap();
    let (_, body) = out.split_once("\r\n\r\n").unwrap();
    serde_json::from_str(body).unwrap()
}

#[tokio::test]
async fn a_host_push_through_the_relay_reaches_apns_and_comes_back_as_push_result() {
    let s = setup().await;
    let loopback: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let server = Server::bind(loopback, loopback, Limits::default(), s.client.clone())
        .await
        .unwrap();
    let relay = server.relay_addr().unwrap();
    let metrics_addr = server.metrics_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let task = tokio::spawn(server.run(async {
        let _ = stopped.await;
    }));

    let mut request = format!("ws://{relay}{CONNECT_PATH}")
        .into_client_request()
        .unwrap();
    let headers = request.headers_mut();
    headers.insert(HEADER_RELAY_VERSION, HeaderValue::from_static("1"));
    headers.insert(HEADER_ROLE, HeaderValue::from_static(Role::Host.as_str()));
    headers.insert(
        HEADER_CHANNEL,
        HeaderValue::from_str(&ChannelSecret::from_bytes([9; 32]).to_header_value()).unwrap(),
    );
    let (mut host, _) = tokio_tungstenite::connect_async(request).await.unwrap();

    s.sandbox.script(&[
        Reply::Status(200, None),
        Reply::Status(410, Some("Unregistered")),
    ]);
    for (request_id, expected) in [
        (
            21,
            PushResult {
                request_id: 21,
                status: PushStatus::Ok,
                apns_status: 200,
                reason: String::new(),
            },
        ),
        (
            22,
            PushResult {
                request_id: 22,
                status: PushStatus::Unregistered,
                apns_status: 410,
                reason: "Unregistered".into(),
            },
        ),
    ] {
        let frame = Frame::Push(PushRequest {
            request_id,
            ..push(PushEnv::Sandbox, PushPriority::Immediate, Some("c-2"))
        });
        host.send(Message::binary(frame.encode().unwrap()))
            .await
            .unwrap();
        assert_eq!(next_frame(&mut host).await, Frame::PushResult(expected));
    }
    let requests = s.sandbox.requests();
    assert_eq!(requests.len(), 2);
    verify_jwt(&requests[0], &s.public_key);
    assert_eq!(header(&requests[0], "apns-collapse-id"), Some("c-2"));

    let m = metrics(metrics_addr).await;
    assert_eq!(m["pushes"]["requested"], 2);
    assert_eq!(m["pushes"]["ok"], 1);
    assert_eq!(m["pushes"]["unregistered"], 1);
    assert_eq!(m["pushes"]["failed"], 0);
    assert_eq!(m["pushes"]["jwtRefreshes"], 1);
    let raw = m.to_string();
    let token_hex =
        device_token_to_hex(&push(PushEnv::Sandbox, PushPriority::Immediate, None).device_token);
    assert!(!raw.contains(&token_hex) && !raw.contains("eyJ"), "{raw}");

    let _ = stop.send(());
    let _ = timeout(WAIT, task).await;
}
