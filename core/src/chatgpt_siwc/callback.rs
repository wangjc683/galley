//! The loopback redirect listener of Sign in with ChatGPT.
//!
//! This is the one narrow exception to Rule 2 (`AGENTS.md`): a sign-in
//! the user starts may open a one-shot HTTP listener bound to `127.0.0.1`
//! on an ephemeral port. It lives only while that sign-in is pending,
//! accepts exactly one callback whose `state` matches, then closes; it
//! times out, and it never accepts commands or serves anything else.
//!
//! Concretely: only `GET /auth/callback` is looked at. Every other method
//! or path is a 404 and does not count; a callback whose `state` does not
//! match is a 400 and does not count either. The first matching callback
//! gets a short static page, its outcome is handed to the sign-in, and
//! the listener is dropped. Cancelling (a newer sign-in, or the cancel
//! command) and the timeout drop it too. Nothing here is logged except
//! accept errors: request lines carry the authorization code.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

use super::SIWC_CALLBACK_PATH;

const MAX_REQUEST_HEAD_BYTES: usize = 16 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);

const DONE_PAGE: &str = concat!(
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Galley</title><style>body{font-family:-apple-system,BlinkMacSystemFont,",
    "\"Segoe UI\",sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;",
    "line-height:1.6;color:#222;background:#fff}@media (prefers-color-scheme:dark)",
    "{body{color:#eee;background:#1c1c1c}}</style></head><body>",
    "<p lang=\"zh-CN\">可以回到 Galley 了。</p>",
    "<p lang=\"en\">You can return to Galley now.</p>",
    "</body></html>"
);

#[derive(Clone, PartialEq, Eq)]
pub(super) struct AuthorizedCallback {
    pub(super) code: String,
    pub(super) client_id: Option<String>,
    pub(super) scope: Option<String>,
}

impl std::fmt::Debug for AuthorizedCallback {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthorizedCallback")
            .field("code", &"[redacted]")
            .field("client_id", &self.client_id)
            .field("scope", &self.scope)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CallbackOutcome {
    Authorized(AuthorizedCallback),
    /// The authorization server redirected back with `error=`.
    Denied {
        error: String,
        description: Option<String>,
    },
    TimedOut,
    Cancelled,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RequestDisposition {
    /// Not `GET /auth/callback`: 404, not counted.
    NotFound,
    /// The callback path with a missing or wrong `state`: 400, not counted.
    StateMismatch,
    /// The callback with the expected `state`: the one that counts.
    Callback(CallbackOutcome),
}

pub(super) async fn bind_loopback() -> std::io::Result<(TcpListener, u16)> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

pub(super) fn redirect_uri_for_port(port: u16) -> String {
    format!("http://127.0.0.1:{port}{SIWC_CALLBACK_PATH}")
}

/// Serve the loopback listener until the first callback with the
/// expected `state`, the timeout, or cancellation (the sender sending or
/// being dropped). The listener and every connection still open are
/// dropped on return.
pub(super) async fn serve_callback(
    listener: TcpListener,
    expected_state: String,
    timeout: Duration,
    cancel: oneshot::Receiver<()>,
) -> CallbackOutcome {
    let expected_state = Arc::new(expected_state);
    let claimed = Arc::new(AtomicBool::new(false));
    let (outcome_tx, mut outcome_rx) = mpsc::channel::<CallbackOutcome>(1);
    let mut connections = JoinSet::new();
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    tokio::pin!(cancel);
    loop {
        tokio::select! {
            biased;
            _ = &mut cancel => return CallbackOutcome::Cancelled,
            Some(outcome) = outcome_rx.recv() => return outcome,
            _ = &mut deadline => return CallbackOutcome::TimedOut,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    connections.spawn(handle_connection(
                        stream,
                        expected_state.clone(),
                        claimed.clone(),
                        outcome_tx.clone(),
                    ));
                }
                Err(e) => {
                    eprintln!("[chatgpt-siwc] accepting loopback connection failed: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            },
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    expected_state: Arc<String>,
    claimed: Arc<AtomicBool>,
    outcome_tx: mpsc::Sender<CallbackOutcome>,
) {
    // A connection that never sends a full head (a browser preconnect,
    // a stray client) is dropped after the read timeout without an answer.
    let head =
        match tokio::time::timeout(REQUEST_READ_TIMEOUT, read_request_head(&mut stream)).await {
            Ok(Ok(Some(head))) => head,
            _ => return,
        };
    match classify_request(&head, &expected_state) {
        RequestDisposition::NotFound => {
            let _ = write_response(&mut stream, "404 Not Found", "text/plain", "Not Found").await;
        }
        RequestDisposition::StateMismatch => {
            let _ =
                write_response(&mut stream, "400 Bad Request", "text/plain", "Bad Request").await;
        }
        RequestDisposition::Callback(outcome) => {
            // Exactly one matching callback is accepted; a replay that
            // races the first one is just another 404.
            if claimed
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                let _ =
                    write_response(&mut stream, "404 Not Found", "text/plain", "Not Found").await;
                return;
            }
            let _ =
                write_response(&mut stream, "200 OK", "text/html; charset=utf-8", DONE_PAGE).await;
            let _ = outcome_tx.send(outcome).await;
        }
    }
}

/// Read up to the end of the request head. `None` on EOF before a full
/// head or when the head is larger than any real callback.
async fn read_request_head(stream: &mut TcpStream) -> std::io::Result<Option<String>> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 2048];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = find_head_end(&buf) {
            return Ok(Some(String::from_utf8_lossy(&buf[..end]).into_owned()));
        }
        if buf.len() > MAX_REQUEST_HEAD_BYTES {
            return Ok(None);
        }
    }
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\
         Referrer-Policy: no-referrer\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.flush().await?;
    let _ = stream.shutdown().await;
    Ok(())
}

/// Classify one request head against the expected `state`. Pure: the
/// whole Rule 2 surface of the listener is decided here.
pub(super) fn classify_request(head: &str, expected_state: &str) -> RequestDisposition {
    let request_line = head.lines().next().unwrap_or_default();
    let mut parts = request_line.split(' ');
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else {
        return RequestDisposition::NotFound;
    };
    if method != "GET" || !target.starts_with('/') {
        return RequestDisposition::NotFound;
    }
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return RequestDisposition::NotFound;
    };
    if url.path() != SIWC_CALLBACK_PATH {
        return RequestDisposition::NotFound;
    }
    let mut params: HashMap<String, String> = HashMap::new();
    for (key, value) in url.query_pairs() {
        params
            .entry(key.into_owned())
            .or_insert_with(|| value.into_owned());
    }
    let state_matches = params
        .get("state")
        .is_some_and(|state| constant_time_eq(state.as_bytes(), expected_state.as_bytes()));
    if !state_matches {
        return RequestDisposition::StateMismatch;
    }
    let nonempty = |key: &str| {
        params
            .get(key)
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
    };
    if let Some(error) = nonempty("error") {
        return RequestDisposition::Callback(CallbackOutcome::Denied {
            error,
            description: nonempty("error_description"),
        });
    }
    match nonempty("code") {
        Some(code) => {
            RequestDisposition::Callback(CallbackOutcome::Authorized(AuthorizedCallback {
                code,
                client_id: nonempty("client_id"),
                scope: nonempty("scope"),
            }))
        }
        None => RequestDisposition::Callback(CallbackOutcome::Denied {
            error: "invalid_callback".into(),
            description: Some("the callback carried neither a code nor an error".into()),
        }),
    }
}

fn constant_time_eq(actual: &[u8], expected: &[u8]) -> bool {
    let mut diff = actual.len() ^ expected.len();
    for (idx, expected_byte) in expected.iter().copied().enumerate() {
        let actual_byte = actual.get(idx).copied().unwrap_or(0);
        diff |= usize::from(actual_byte ^ expected_byte);
    }
    diff == 0
}
