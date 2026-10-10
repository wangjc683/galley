//! HTTP in front of the WebSocket: the `GET /v1/connect` upgrade with its
//! header checks (design §4.2), and the metrics endpoint.
//!
//! Every refusal is a plain HTTP response before any upgrade, counted
//! under `rejected`. Nothing about the request (address, headers, path)
//! is logged.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use galley_remote_protocol::frame::{
    Role, CONNECT_PATH, HEADER_CHANNEL, HEADER_RELAY_VERSION, HEADER_ROLE, RELAY_PROTOCOL_VERSION,
};
use galley_remote_protocol::keys::ChannelSecret;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::header::{
    HeaderMap, HeaderName, HeaderValue, CONNECTION, CONTENT_TYPE, SEC_WEBSOCKET_ACCEPT,
    SEC_WEBSOCKET_KEY, SEC_WEBSOCKET_VERSION, UPGRADE,
};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;

use crate::channels::{Refused, State};
use crate::conn;

/// A client that has not sent a request head by then is dropped; this
/// also ends idle keep-alive connections.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Path of the counters on the metrics port.
pub(crate) const METRICS_PATH: &str = "/metrics";

type Body = Full<Bytes>;

fn http1_builder() -> http1::Builder {
    let mut builder = http1::Builder::new();
    // Keep-alive stays on: turning it off makes hyper answer the upgrade
    // with `connection: close` instead of `Connection: Upgrade`.
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_READ_TIMEOUT);
    builder
}

/// Serve one TCP connection on the relay port.
pub(crate) async fn serve_relay(stream: TcpStream, state: Arc<State>) {
    let service = service_fn(move |req| {
        let state = Arc::clone(&state);
        async move { Ok::<_, Infallible>(connect(req, &state)) }
    });
    let _ = http1_builder()
        .serve_connection(TokioIo::new(stream), service)
        .with_upgrades()
        .await;
}

/// Serve one TCP connection on the metrics port.
pub(crate) async fn serve_metrics(stream: TcpStream, state: Arc<State>) {
    let service = service_fn(move |req: Request<Incoming>| {
        let state = Arc::clone(&state);
        async move {
            let response = if req.uri().path() != METRICS_PATH {
                plain(StatusCode::NOT_FOUND, "not found")
            } else if req.method() != Method::GET {
                plain(StatusCode::METHOD_NOT_ALLOWED, "method not allowed")
            } else {
                let body = state
                    .metrics
                    .snapshot(state.channel_count(), state.apns.jwt_refreshes())
                    .to_string();
                let mut response = Response::new(Body::from(body));
                response
                    .headers_mut()
                    .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
                response
            };
            Ok::<_, Infallible>(response)
        }
    });
    let _ = http1_builder()
        .serve_connection(TokioIo::new(stream), service)
        .await;
}

fn plain(status: StatusCode, text: &'static str) -> Response<Body> {
    let mut response = Response::new(Body::from(text));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("text/plain"));
    response
}

fn reject(state: &State, label: &str, status: StatusCode, text: &'static str) -> Response<Body> {
    state.metrics.rejected(label);
    plain(status, text)
}

/// The value of a header that must appear exactly once.
fn single<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

/// Whether a comma-separated header (any number of lines) has `token`.
fn has_token(headers: &HeaderMap, name: HeaderName, token: &str) -> bool {
    headers
        .get_all(name)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .any(|t| t.trim().eq_ignore_ascii_case(token))
}

fn connect(mut req: Request<Incoming>, state: &Arc<State>) -> Response<Body> {
    if req.uri().path() != CONNECT_PATH {
        return reject(state, "not_found", StatusCode::NOT_FOUND, "not found");
    }
    if req.method() != Method::GET {
        return reject(
            state,
            "method_not_allowed",
            StatusCode::METHOD_NOT_ALLOWED,
            "method not allowed",
        );
    }
    // Credentials travel in headers only (design §4.2): a URL may end up
    // in someone's access log.
    if req.uri().query().is_some() {
        return reject(
            state,
            "bad_request",
            StatusCode::BAD_REQUEST,
            "no query string",
        );
    }
    let headers = req.headers();
    if !has_token(headers, UPGRADE, "websocket") || !has_token(headers, CONNECTION, "upgrade") {
        return reject(
            state,
            "bad_request",
            StatusCode::BAD_REQUEST,
            "not a WebSocket upgrade",
        );
    }
    if single(headers, SEC_WEBSOCKET_VERSION.as_str()) != Some("13") {
        let mut response = reject(
            state,
            "bad_request",
            StatusCode::UPGRADE_REQUIRED,
            "WebSocket version 13 only",
        );
        response
            .headers_mut()
            .insert(SEC_WEBSOCKET_VERSION, HeaderValue::from_static("13"));
        return response;
    }
    let Some(ws_key) = single(headers, SEC_WEBSOCKET_KEY.as_str()).filter(|k| !k.is_empty()) else {
        return reject(
            state,
            "bad_request",
            StatusCode::BAD_REQUEST,
            "missing Sec-WebSocket-Key",
        );
    };
    let accept = derive_accept_key(ws_key.as_bytes());

    if single(headers, HEADER_RELAY_VERSION) != Some(&RELAY_PROTOCOL_VERSION.to_string()[..]) {
        return reject(
            state,
            "bad_relay_version",
            StatusCode::BAD_REQUEST,
            "unsupported X-Galley-Relay version",
        );
    }
    let Some(role) = single(headers, HEADER_ROLE).and_then(Role::from_header_value) else {
        return reject(
            state,
            "bad_role",
            StatusCode::BAD_REQUEST,
            "bad X-Galley-Role",
        );
    };
    let Some(channel_key) = single(headers, HEADER_CHANNEL)
        .and_then(|v| ChannelSecret::from_header_value(v).ok())
        // The secret is dropped (and zeroized) here; only its hash stays.
        .map(|secret| secret.channel_key())
    else {
        return reject(
            state,
            "bad_channel",
            StatusCode::BAD_REQUEST,
            "bad X-Galley-Channel",
        );
    };

    let (registration, rx) = match state.register(channel_key, role) {
        Ok(joined) => joined,
        Err(Refused::ChannelFull) => {
            return reject(
                state,
                "channel_full",
                StatusCode::TOO_MANY_REQUESTS,
                "channel full",
            )
        }
    };
    let on_upgrade = hyper::upgrade::on(&mut req);
    let state = Arc::clone(state);
    tokio::spawn(async move {
        match on_upgrade.await {
            Ok(upgraded) => conn::run(TokioIo::new(upgraded), registration, rx, state).await,
            // Dropping the registration leaves the channel again.
            Err(_) => state.metrics.error("upgrade_failed"),
        }
    });

    let mut response = Response::new(Body::default());
    *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    let headers = response.headers_mut();
    headers.insert(UPGRADE, HeaderValue::from_static("websocket"));
    headers.insert(CONNECTION, HeaderValue::from_static("Upgrade"));
    headers.insert(
        SEC_WEBSOCKET_ACCEPT,
        HeaderValue::from_str(&accept).expect("base64 is a valid header value"),
    );
    response
}
