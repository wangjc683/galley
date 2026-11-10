use galley_core_lib::error::GalleyError;
use galley_core_lib::socket_listener::socket_path;
use std::time::Duration;

// ---- socket transport helpers (B2 M4) ----

/// Bound on establishing the socket/pipe connection, unary and watch
/// alike. A live core accepts on localhost within milliseconds; anything
/// past this means the core is wedged, and an agent driving the CLI needs
/// "dead", not an infinite hang with zero output.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound on a unary command's response line. Generous: some commands
/// legitimately spawn a runner and wait for its ready event. A watch
/// stream has no read bound at all: Core writes nothing when it accepts a
/// subscription and nothing while the runner is quiet, so silence on a
/// stream says nothing about Core. `SocketClient::open_watch` proves Core
/// answers with a `ping` round trip under this bound before subscribing.
const UNARY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);

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
            UNARY_RESPONSE_TIMEOUT.as_secs()
        ),
    }
}

/// One round-trip request → response over the Unix socket / Windows
/// named pipe. Maps connect errors to `DbUnavailable` (exit 4) per the
/// CLI exit-code contract.
#[cfg(unix)]
pub(crate) async fn socket_send_recv(line: String) -> Result<String, GalleyError> {
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
    let resp = tokio::time::timeout(UNARY_RESPONSE_TIMEOUT, lines.next_line())
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
pub(crate) async fn socket_send_recv(line: String) -> Result<String, GalleyError> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let path = socket_path();
    let path_str = path.to_str().ok_or_else(|| GalleyError::Internal {
        message: "named pipe path not UTF-8".into(),
    })?;
    let stream = open_pipe_client(path_str).await?;
    let (read_half, mut write_half) = tokio::io::split(stream);
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
    let resp = tokio::time::timeout(UNARY_RESPONSE_TIMEOUT, lines.next_line())
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

/// Watch subscription stream. No read is bounded, the first included:
/// Core sends nothing when it accepts a subscription and nothing while
/// the runner is quiet, which can last for hours (a run that ended with
/// the runner left alive, a long tool call). Whether Core is alive was
/// settled before subscribing, by `SocketClient::open_watch`'s `ping`.
pub(crate) struct WatchLines {
    lines: RawWatchLines,
}

impl WatchLines {
    /// The one constructor: the live socket in production, an in-memory
    /// reader in tests — same type, same `next_line` path.
    pub(crate) fn from_reader(reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>) -> Self {
        use tokio::io::AsyncBufReadExt;
        Self {
            lines: tokio::io::BufReader::new(reader).lines(),
        }
    }

    /// Test seam: a stream fed from canned in-memory lines instead of a
    /// live socket.
    #[cfg(test)]
    pub(crate) fn from_canned_lines(lines: &[&str]) -> Self {
        let joined = lines.join("\n") + "\n";
        Self::from_reader(Box::new(std::io::Cursor::new(joined.into_bytes())))
    }

    /// Next raw line; waits as long as the stream stays open and silent.
    pub(crate) async fn next_line(&mut self) -> std::io::Result<Option<String>> {
        self.lines.next_line().await
    }
}

/// Open a subscription stream: send `line` (a pre-serialized request —
/// built by `crate::client::SocketClient`, never hand-assembled here)
/// and return the response line stream. Only connecting is bounded
/// ([`CONNECT_TIMEOUT`]); see [`WatchLines`] for why reads are not.
pub(crate) async fn open_watch_lines_raw(line: String) -> Result<WatchLines, GalleyError> {
    use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};

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

    Ok(WatchLines::from_reader(read_half))
}

// Envelope parsing, frame classification, and error-tag mapping live in
// `crate::client` (SocketClient) on top of `galley_core_lib::protocol` —
// this module is deliberately JSON-blind: lines in, lines out.
