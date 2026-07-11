use super::*;
use std::time::Duration;

// The wire types themselves live in `crate::protocol` — the single home
// for schemaVersion 1 shapes shared with the CLI. This module keeps only
// the server-side transport concerns (idle policy, line writer) and
// re-exports the envelope types for the handler modules' `use super::*`.
pub use crate::protocol::{
    ErrorTag, SocketRequest, SocketResponse, StreamEnvelope, SCHEMA_VERSION,
};

/// Per-connection idle timeout. 90s gives interactive shell scripts enough
/// breathing room; long-running watch subscriptions don't count as idle
/// because they push data continuously.
pub const CONNECTION_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

pub(super) async fn write_stream_line<W: tokio::io::AsyncWrite + Unpin>(
    w: &mut W,
    env: &StreamEnvelope,
) -> std::io::Result<()> {
    let line = serde_json::to_string(env).unwrap_or_default();
    w.write_all(line.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await?;
    Ok(())
}
