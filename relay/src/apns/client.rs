//! The APNs sender (design §4.3): one push, one HTTP/2 request to
//! `api.push.apple.com` or the sandbox, its answer mapped to a
//! `PUSH_RESULT`.
//!
//! - Transport: hyper-util's pooled client with hyper-rustls (rustls 0.23
//!   with ring, Mozilla roots), HTTP/2 only (ALPN `h2`). One client for the
//!   process; each APNs host gets one multiplexed connection, kept open
//!   while it is in use and pinged while idle, so a connection that died
//!   quietly is replaced before a push waits on it (Apple: keep
//!   connections open, check them with HTTP/2 `PING`).
//! - Request: `POST /3/device/<hex token>` with `authorization: bearer
//!   <JWT>`, `apns-topic`, `apns-push-type: alert`, `apns-priority` from
//!   the frame, `apns-expiration` ([`EXPIRATION_SECS`] ahead) and
//!   `apns-collapse-id` when the frame has one. The body is
//!   `galley_remote_protocol::push::apns_payload`: the placeholder alert,
//!   `mutable-content: 1`, `sound: default` and `g`, the sealed push.
//! - Answer: 200 → `Ok`; 410 → `Unregistered` (the desktop deletes the
//!   token); anything else → `Failed` with APNs' `reason`. A 403
//!   `ExpiredProviderToken` / `InvalidProviderToken` replaces the token and
//!   retries once ([`super::token`]). No answer within the timeout →
//!   `Failed`, `apns_timeout`; no connection → `Failed`,
//!   `apns_unreachable`.
//!
//! Nothing is logged per push: not the device token (it is in the URL),
//! not the JWT, not the payload, not APNs' answer.

use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use galley_remote_protocol::frame::{device_token_to_hex, PushEnv, PushRequest, PushStatus};
use galley_remote_protocol::push::{apns_payload, APNS_MAX_PAYLOAD_LEN};
use http_body_util::{BodyExt as _, Full, Limited};
use hyper::header::{HeaderValue, AUTHORIZATION};
use hyper::Request;
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioTimer};

use super::token::{unix_now, ProviderToken, Token};
use super::{ApnsConfig, ApnsResponse, ApnsSender, REASON_RELAY_ERROR};

/// Production APNs (`PushEnv::Production`).
pub const PRODUCTION_ENDPOINT: &str = "https://api.push.apple.com";
/// Development APNs (`PushEnv::Sandbox`): what debug builds register with.
pub const SANDBOX_ENDPOINT: &str = "https://api.sandbox.push.apple.com";

/// One attempt (request and answer) that takes longer fails with
/// [`REASON_APNS_TIMEOUT`].
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// `apns-expiration`: how long APNs keeps trying a phone that is offline.
/// A day covers a phone off overnight or on a long flight; APNs keeps
/// only the newest push per app anyway, and after a day the phone's own
/// resync tells the story better than an old alert.
pub const EXPIRATION_SECS: u64 = 24 * 60 * 60;
/// A connection with no push for this long is closed; the next push
/// opens a new one (Apple: fine for infrequent sends, rapid
/// reconnecting is what it treats as abuse).
pub const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// HTTP/2 `PING` on an idle connection this often; no `PING` ack within
/// [`KEEP_ALIVE_TIMEOUT`] closes it.
pub const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(5 * 60);
pub const KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(20);

/// `reason` when APNs did not answer within [`REQUEST_TIMEOUT`].
pub const REASON_APNS_TIMEOUT: &str = "apns_timeout";
/// `reason` when no connection to APNs could be made or it broke before
/// the answer (DNS, TCP, TLS, HTTP/2).
pub const REASON_APNS_UNREACHABLE: &str = "apns_unreachable";
/// `reason` when the payload would exceed APNs' 4096 bytes (a `PUSH`
/// within the frame limits never does).
pub const REASON_PAYLOAD_TOO_LARGE: &str = "payload_too_large";

/// APNs error bodies are a small JSON object; more is not read.
const MAX_ANSWER_BODY: usize = 4096;
/// `PUSH_RESULT` reason limit.
const MAX_REASON_LEN: usize = 255;

/// The real [`ApnsSender`].
pub struct ApnsClient {
    token: ProviderToken,
    topic: HeaderValue,
    production: String,
    sandbox: String,
    http: Client<HttpsConnector<HttpConnector>, Full<Bytes>>,
    timeout: Duration,
}

impl std::fmt::Debug for ApnsClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApnsClient")
            .field("production", &self.production)
            .field("sandbox", &self.sandbox)
            .finish_non_exhaustive()
    }
}

/// What came back from one attempt.
enum Attempt {
    Answered {
        status: u16,
        reason: String,
    },
    TimedOut,
    Unreachable,
    /// The request could not be built (a `PushRequest` that did not come
    /// through frame decoding, e.g. a collapse id that is no header value).
    NotBuilt,
}

impl ApnsClient {
    /// The production sender: Apple's two endpoints over HTTPS.
    pub fn new(config: ApnsConfig) -> Result<Self, rustls::Error> {
        Self::build(
            config,
            PRODUCTION_ENDPOINT,
            SANDBOX_ENDPOINT,
            REQUEST_TIMEOUT,
            false,
        )
    }

    /// A sender for fake APNs servers: `production` and `sandbox` are base
    /// URLs (`http://127.0.0.1:PORT` speaks HTTP/2 with prior knowledge,
    /// h2c). Only with the `test-hooks` feature; the shipped relay talks
    /// to Apple over HTTPS only.
    #[cfg(feature = "test-hooks")]
    pub fn with_endpoints_for_testing(
        config: ApnsConfig,
        production: &str,
        sandbox: &str,
        timeout: Duration,
    ) -> Result<Self, rustls::Error> {
        Self::build(config, production, sandbox, timeout, true)
    }

    fn build(
        config: ApnsConfig,
        production: &str,
        sandbox: &str,
        timeout: Duration,
        allow_plain_http: bool,
    ) -> Result<Self, rustls::Error> {
        let tls = hyper_rustls::HttpsConnectorBuilder::new()
            .with_provider_and_webpki_roots(rustls::crypto::ring::default_provider())?;
        let schemes = if allow_plain_http {
            tls.https_or_http()
        } else {
            tls.https_only()
        };
        // ALPN `h2` only: APNs speaks HTTP/2 and nothing else.
        let connector = schemes.enable_http2().build();
        let http = Client::builder(TokioExecutor::new())
            .http2_only(true)
            .timer(TokioTimer::new())
            .pool_timer(TokioTimer::new())
            .pool_idle_timeout(POOL_IDLE_TIMEOUT)
            .http2_keep_alive_interval(KEEP_ALIVE_INTERVAL)
            .http2_keep_alive_timeout(KEEP_ALIVE_TIMEOUT)
            .http2_keep_alive_while_idle(true)
            .build(connector);
        let ApnsConfig {
            key,
            key_id,
            team_id,
            topic,
        } = config;
        Ok(Self {
            token: ProviderToken::new(key, key_id, team_id),
            // `ApnsConfig::new` allows printable ASCII only.
            topic: HeaderValue::from_str(&topic).expect("a checked topic is a header value"),
            production: production.trim_end_matches('/').to_string(),
            sandbox: sandbox.trim_end_matches('/').to_string(),
            http,
            timeout,
        })
    }

    async fn attempt(&self, uri: &str, body: &Bytes, push: &PushRequest, token: &Token) -> Attempt {
        let mut request = Request::post(uri)
            .header(AUTHORIZATION, format!("bearer {}", token.jwt))
            .header("apns-topic", self.topic.clone())
            .header("apns-push-type", "alert")
            .header("apns-priority", push.priority.code().to_string())
            .header(
                "apns-expiration",
                unix_now().saturating_add(EXPIRATION_SECS).to_string(),
            );
        // Printable ASCII, at most 64 bytes: checked when the frame was
        // decoded.
        if let Some(collapse_id) = &push.collapse_id {
            request = request.header("apns-collapse-id", collapse_id.as_str());
        }
        let Ok(request) = request.body(Full::new(body.clone())) else {
            return Attempt::NotBuilt;
        };
        let exchange = async {
            let response = self.http.request(request).await.ok()?;
            let status = response.status().as_u16();
            // An answer whose body breaks off still has its status.
            let body = Limited::new(response.into_body(), MAX_ANSWER_BODY)
                .collect()
                .await
                .map(|collected| collected.to_bytes())
                .unwrap_or_default();
            Some(Attempt::Answered {
                status,
                reason: reason_of(&body),
            })
        };
        match tokio::time::timeout(self.timeout, exchange).await {
            Ok(Some(answered)) => answered,
            Ok(None) => Attempt::Unreachable,
            Err(_) => Attempt::TimedOut,
        }
    }
}

/// APNs' `reason` from an error body, cut to what a `PUSH_RESULT` carries
/// (printable ASCII, no spaces, at most 255 bytes). Empty when absent.
fn reason_of(body: &[u8]) -> String {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("reason")?.as_str().map(str::to_string))
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_graphic)
        .take(MAX_REASON_LEN)
        .collect()
}

fn is_provider_token_rejection(attempt: &Attempt) -> bool {
    matches!(
        attempt,
        Attempt::Answered { status: 403, reason }
            if reason == "ExpiredProviderToken" || reason == "InvalidProviderToken"
    )
}

impl From<Attempt> for ApnsResponse {
    fn from(attempt: Attempt) -> Self {
        match attempt {
            Attempt::Answered { status: 200, .. } => ApnsResponse {
                status: PushStatus::Ok,
                apns_status: 200,
                reason: String::new(),
            },
            Attempt::Answered {
                status: 410,
                reason,
            } => ApnsResponse {
                status: PushStatus::Unregistered,
                apns_status: 410,
                reason,
            },
            Attempt::Answered { status, reason } => ApnsResponse {
                status: PushStatus::Failed,
                apns_status: status,
                reason,
            },
            Attempt::TimedOut => ApnsResponse::not_sent(REASON_APNS_TIMEOUT),
            Attempt::Unreachable => ApnsResponse::not_sent(REASON_APNS_UNREACHABLE),
            Attempt::NotBuilt => ApnsResponse::not_sent(REASON_RELAY_ERROR),
        }
    }
}

#[async_trait]
impl ApnsSender for ApnsClient {
    async fn send(&self, push: &PushRequest) -> ApnsResponse {
        let body = match apns_payload(&push.sealed) {
            Ok(body) if body.len() <= APNS_MAX_PAYLOAD_LEN => Bytes::from(body),
            _ => return ApnsResponse::not_sent(REASON_PAYLOAD_TOO_LARGE),
        };
        let base = match push.env {
            PushEnv::Production => &self.production,
            PushEnv::Sandbox => &self.sandbox,
        };
        let uri = format!(
            "{base}/3/device/{}",
            device_token_to_hex(&push.device_token)
        );
        let Ok(token) = self.token.current(unix_now()) else {
            return ApnsResponse::not_sent(REASON_RELAY_ERROR);
        };
        let first = self.attempt(&uri, &body, push, &token).await;
        if !is_provider_token_rejection(&first) {
            return first.into();
        }
        match self.token.after_rejection(&token, unix_now()) {
            Ok(Some(fresh)) => self.attempt(&uri, &body, push, &fresh).await.into(),
            Ok(None) | Err(_) => first.into(),
        }
    }

    fn jwt_refreshes(&self) -> u64 {
        self.token.refreshes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasons_are_cut_to_the_push_result_rules() {
        assert_eq!(
            reason_of(br#"{"reason":"BadDeviceToken"}"#),
            "BadDeviceToken"
        );
        assert_eq!(
            reason_of(br#"{"reason":"Unregistered","timestamp":1700000000000}"#),
            "Unregistered"
        );
        assert_eq!(reason_of(b""), "");
        assert_eq!(reason_of(b"<html>"), "");
        assert_eq!(reason_of(br#"{"reason":7}"#), "");
        assert_eq!(
            reason_of("{\"reason\":\"Bad Token é\\n\"}".as_bytes()),
            "BadToken"
        );
        let long = format!(r#"{{"reason":"{}"}}"#, "x".repeat(400));
        assert_eq!(reason_of(long.as_bytes()).len(), MAX_REASON_LEN);
    }

    #[test]
    fn answers_map_to_push_results() {
        let answered = |status: u16, reason: &str| {
            ApnsResponse::from(Attempt::Answered {
                status,
                reason: reason.into(),
            })
        };
        assert_eq!(answered(200, "").status, PushStatus::Ok);
        let gone = answered(410, "ExpiredToken");
        assert_eq!(
            (gone.status, gone.apns_status, gone.reason.as_str()),
            (PushStatus::Unregistered, 410, "ExpiredToken")
        );
        let bad = answered(400, "BadDeviceToken");
        assert_eq!((bad.status, bad.apns_status), (PushStatus::Failed, 400));
        assert_eq!(
            ApnsResponse::from(Attempt::TimedOut),
            ApnsResponse::not_sent(REASON_APNS_TIMEOUT)
        );
        assert_eq!(
            ApnsResponse::from(Attempt::Unreachable),
            ApnsResponse::not_sent(REASON_APNS_UNREACHABLE)
        );
        assert_eq!(
            ApnsResponse::from(Attempt::NotBuilt),
            ApnsResponse::not_sent(REASON_RELAY_ERROR)
        );
        assert!(is_provider_token_rejection(&Attempt::Answered {
            status: 403,
            reason: "InvalidProviderToken".into()
        }));
        assert!(!is_provider_token_rejection(&Attempt::Answered {
            status: 403,
            reason: "Forbidden".into()
        }));
    }
}
