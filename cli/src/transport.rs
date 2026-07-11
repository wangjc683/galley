use galley_core_lib::error::GalleyError;
use galley_core_lib::socket_listener::socket_path;
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
    /// Test seam: a stream fed from canned in-memory lines instead of a
    /// live socket. Same type, same `next_line` path — replace, don't
    /// layer.
    #[cfg(test)]
    pub(crate) fn from_canned_lines(lines: &[&str]) -> Self {
        use tokio::io::AsyncBufReadExt;
        let joined = lines.join("\n") + "\n";
        let reader: Box<dyn tokio::io::AsyncRead + Unpin + Send> =
            Box::new(std::io::Cursor::new(joined.into_bytes()));
        Self {
            lines: tokio::io::BufReader::new(reader).lines(),
            awaiting_first_frame: false,
        }
    }

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

/// Open a subscription stream: send `line` (a pre-serialized request —
/// built by `crate::client::SocketClient`, never hand-assembled here)
/// and return the response line stream.
pub(crate) async fn open_watch_lines_raw(line: String) -> Result<WatchLines, GalleyError> {
    use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

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

    Ok(WatchLines {
        lines: BufReader::new(read_half).lines(),
        awaiting_first_frame: true,
    })
}

// Envelope parsing, frame classification, and error-tag mapping live in
// `crate::client` (SocketClient) on top of `galley_core_lib::protocol` —
// this module is deliberately JSON-blind: lines in, lines out.
