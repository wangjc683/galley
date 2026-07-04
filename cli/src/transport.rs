use crate::common::SCHEMA_VERSION;
use galley_core_lib::error::GalleyError;
use galley_core_lib::socket_listener::socket_path;
use serde_json::Value;
use std::time::Duration;

// ---- socket transport helpers (B2 M4) ----

/// Bound on establishing the socket/pipe connection. A live core
/// accepts on localhost within milliseconds; anything past this means
/// the core is wedged, and an agent driving the CLI needs "dead", not
/// an infinite hang with zero output.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound on the first response line (unary) / first frame (watch).
/// Generous: some commands legitimately spawn a runner and wait for its
/// ready event. After the first watch frame the stream is exempt —
/// sessions may be quiet for arbitrarily long.
const FIRST_RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

/// `ERROR_PIPE_BUSY` (same constant / detection idiom as
/// `core/src/socket_listener/mod.rs`). Core's accept loop creates the
/// next pipe instance only after the previous `connect()` returns, so
/// concurrent CLI invocations can transiently see every instance taken
/// (`ERROR_PIPE_BUSY`) or no instance at all (`NotFound`) while the
/// core is alive and healthy.
#[cfg(windows)]
const WIN_ERROR_PIPE_BUSY: i32 = 231;
#[cfg(windows)]
const PIPE_OPEN_ATTEMPTS: u32 = 10;
#[cfg(windows)]
const PIPE_OPEN_RETRY_DELAY: Duration = Duration::from_millis(100);

/// Open the core named pipe, retrying transient instance-gap errors
/// (`ERROR_PIPE_BUSY`, `NotFound`) with a short backoff before mapping
/// the failure to `DbUnavailable` (exit 4). Worst case ~1s, well inside
/// [`CONNECT_TIMEOUT`]. If the core truly isn't running the retries
/// only delay the same "Core not running" error slightly.
#[cfg(windows)]
async fn open_pipe_client(
    path_str: &str,
) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, GalleyError> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let mut attempt = 0;
    loop {
        match ClientOptions::new().open(path_str) {
            Ok(stream) => return Ok(stream),
            Err(e)
                if attempt + 1 < PIPE_OPEN_ATTEMPTS
                    && (e.raw_os_error() == Some(WIN_ERROR_PIPE_BUSY)
                        || e.kind() == std::io::ErrorKind::NotFound) =>
            {
                attempt += 1;
                tokio::time::sleep(PIPE_OPEN_RETRY_DELAY).await;
            }
            Err(e) => {
                return Err(GalleyError::DbUnavailable {
                    message: format!("Galley Core not running (pipe {}: {})", path_str, e),
                });
            }
        }
    }
}

fn core_unresponsive(what: &str) -> GalleyError {
    GalleyError::DbUnavailable {
        message: format!(
            "Galley Core is not responding ({what} exceeded {}s)",
            FIRST_RESPONSE_TIMEOUT.as_secs()
        ),
    }
}

/// One round-trip request → response over the Unix socket / Windows
/// named pipe. Maps connect errors to `DbUnavailable` (exit 4) per the
/// CLI exit-code contract.
#[cfg(unix)]
pub(crate) async fn socket_send_recv(req: serde_json::Value) -> Result<String, GalleyError> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;
    let path = socket_path();
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, UnixStream::connect(&path))
        .await
        .map_err(|_| GalleyError::DbUnavailable {
            message: format!(
                "Galley Core is not responding (connect to {} exceeded {}s)",
                path.display(),
                CONNECT_TIMEOUT.as_secs()
            ),
        })?
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("Galley Core not running (socket {}: {})", path.display(), e),
        })?;
    let (read_half, mut write_half) = stream.into_split();
    let line = serde_json::to_string(&req).unwrap();
    write_half
        .write_all(line.as_bytes())
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("socket write: {e}"),
        })?;
    write_half
        .write_all(b"\n")
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("socket write: {e}"),
        })?;
    write_half
        .flush()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("socket flush: {e}"),
        })?;
    let mut lines = BufReader::new(read_half).lines();
    let resp = tokio::time::timeout(FIRST_RESPONSE_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| core_unresponsive("socket response"))?
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("socket read: {e}"),
        })?
        .ok_or_else(|| GalleyError::DbUnavailable {
            message: "socket EOF before response".into(),
        })?;
    Ok(resp)
}

#[cfg(windows)]
pub(crate) async fn socket_send_recv(req: serde_json::Value) -> Result<String, GalleyError> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let path = socket_path();
    let path_str = path.to_str().ok_or_else(|| GalleyError::Internal {
        message: "named pipe path not UTF-8".into(),
    })?;
    let stream = open_pipe_client(path_str).await?;
    let (read_half, mut write_half) = tokio::io::split(stream);
    let line = serde_json::to_string(&req).unwrap();
    write_half
        .write_all(line.as_bytes())
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("pipe write: {e}"),
        })?;
    write_half
        .write_all(b"\n")
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("pipe write: {e}"),
        })?;
    write_half
        .flush()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("pipe flush: {e}"),
        })?;
    let mut lines = BufReader::new(read_half).lines();
    let resp = tokio::time::timeout(FIRST_RESPONSE_TIMEOUT, lines.next_line())
        .await
        .map_err(|_| core_unresponsive("pipe response"))?
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("pipe read: {e}"),
        })?
        .ok_or_else(|| GalleyError::DbUnavailable {
            message: "pipe EOF before response".into(),
        })?;
    Ok(resp)
}

type RawWatchLines =
    tokio::io::Lines<tokio::io::BufReader<Box<dyn tokio::io::AsyncRead + Unpin + Send>>>;

/// Watch subscription stream. The FIRST frame is read under
/// [`FIRST_RESPONSE_TIMEOUT`] — a wedged core otherwise hangs the
/// watcher forever with zero output. Later frames are exempt: a quiet
/// session legitimately produces nothing for hours.
pub(crate) struct WatchLines {
    lines: RawWatchLines,
    awaiting_first_frame: bool,
}

impl WatchLines {
    /// Next raw line. The first line is read under
    /// [`FIRST_RESPONSE_TIMEOUT`] (timeout surfaces as `TimedOut`);
    /// later lines wait indefinitely — quiet sessions are legitimate.
    pub(crate) async fn next_line(&mut self) -> std::io::Result<Option<String>> {
        let next = if self.awaiting_first_frame {
            match tokio::time::timeout(FIRST_RESPONSE_TIMEOUT, self.lines.next_line()).await {
                Ok(result) => result,
                Err(_) => Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    format!(
                        "Galley Core is not responding (first watch frame exceeded {}s)",
                        FIRST_RESPONSE_TIMEOUT.as_secs()
                    ),
                )),
            }
        } else {
            self.lines.next_line().await
        };
        self.awaiting_first_frame = false;
        next
    }
}

#[derive(Debug)]
pub(crate) enum WatchFrame {
    Event(Value),
    End(String),
}

pub(crate) async fn open_watch_lines(id: &str) -> Result<WatchLines, GalleyError> {
    use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
    let req = serde_json::json!({
        "command": "session.watch",
        "args": { "sessionId": id },
        "schemaVersion": SCHEMA_VERSION,
    });

    #[cfg(unix)]
    let (read_half, mut write_half): (
        Box<dyn AsyncRead + Unpin + Send>,
        Box<dyn AsyncWrite + Unpin + Send>,
    ) = {
        use tokio::net::UnixStream;
        let path = socket_path();
        let stream = tokio::time::timeout(CONNECT_TIMEOUT, UnixStream::connect(&path))
            .await
            .map_err(|_| GalleyError::DbUnavailable {
                message: format!(
                    "Galley Core is not responding (connect to {} exceeded {}s)",
                    path.display(),
                    CONNECT_TIMEOUT.as_secs()
                ),
            })?
            .map_err(|e| GalleyError::DbUnavailable {
                message: format!("Galley Core not running (socket {}: {})", path.display(), e),
            })?;
        let (read_half, write_half) = stream.into_split();
        (Box::new(read_half), Box::new(write_half))
    };
    #[cfg(windows)]
    let (read_half, mut write_half): (
        Box<dyn AsyncRead + Unpin + Send>,
        Box<dyn AsyncWrite + Unpin + Send>,
    ) = {
        let path = socket_path();
        let path_str = path.to_str().ok_or_else(|| GalleyError::Internal {
            message: "named pipe path not UTF-8".into(),
        })?;
        let stream = open_pipe_client(path_str).await?;
        let (read_half, write_half) = tokio::io::split(stream);
        (Box::new(read_half), Box::new(write_half))
    };

    let line = serde_json::to_string(&req).unwrap();
    write_half
        .write_all(line.as_bytes())
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch write: {e}"),
        })?;
    write_half
        .write_all(b"\n")
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch write: {e}"),
        })?;
    write_half
        .flush()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch flush: {e}"),
        })?;

    Ok(WatchLines {
        lines: BufReader::new(read_half).lines(),
        awaiting_first_frame: true,
    })
}

pub(crate) async fn read_watch_frame(
    watch: &mut WatchLines,
) -> Result<Option<WatchFrame>, GalleyError> {
    let Some(line) = watch
        .next_line()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch read: {e}"),
        })?
    else {
        return Ok(None);
    };

    let parsed: Value = serde_json::from_str(&line).map_err(|e| GalleyError::Internal {
        message: format!("malformed watch frame: {e}"),
    })?;
    if parsed["ok"] == Value::Bool(false) {
        let tag = parsed["error"].as_str().unwrap_or("internal");
        let msg = parsed["message"].as_str().unwrap_or("").to_string();
        return Err(map_error_tag(tag, msg));
    }
    if parsed["stream"] == "end" {
        let reason = parsed["reason"]
            .as_str()
            .unwrap_or("subprocess_exited")
            .to_string();
        return Ok(Some(WatchFrame::End(reason)));
    }
    if parsed["stream"] == "event" {
        return Ok(Some(WatchFrame::Event(
            parsed.get("data").cloned().unwrap_or(Value::Null),
        )));
    }
    Ok(Some(WatchFrame::Event(parsed)))
}

/// Shared socket round-trip for unary write commands. All return
/// JSON-shaped success payloads, so callers can either print the `result`
/// field or use it internally.
pub(crate) async fn unary_command(req: serde_json::Value) -> Result<(), GalleyError> {
    let result = unary_command_value(req).await?;
    println!("{result}");
    Ok(())
}

pub(crate) async fn unary_command_value(
    req: serde_json::Value,
) -> Result<serde_json::Value, GalleyError> {
    let resp_line = socket_send_recv(req).await?;
    let parsed: serde_json::Value =
        serde_json::from_str(&resp_line).map_err(|e| GalleyError::Internal {
            message: format!("malformed socket response: {e}"),
        })?;
    if parsed["ok"] == serde_json::Value::Bool(true) {
        Ok(parsed["result"].clone())
    } else {
        let tag = parsed["error"].as_str().unwrap_or("internal");
        let msg = parsed["message"].as_str().unwrap_or("").to_string();
        Err(map_error_tag(tag, msg))
    }
}

/// Map a server-side error discriminant tag onto the CLI's typed
/// error so exit_code_for() picks the right exit code.
pub(crate) fn map_error_tag(tag: &str, msg: String) -> GalleyError {
    match tag {
        "not_found" => GalleyError::NotFound { message: msg },
        "invalid_args" => GalleyError::InvalidArgs { message: msg },
        "db_unavailable" => GalleyError::DbUnavailable { message: msg },
        "runner_error"
        | "python_not_found"
        | "ga_path_invalid"
        | "managed_runtime_invalid"
        | "managed_model_not_configured"
        | "bridge_cwd_invalid"
        | "path_encoding"
        | "spawn_io"
        | "pipe_unavailable" => GalleyError::RunnerError { message: msg },
        _ => GalleyError::Internal { message: msg },
    }
}
