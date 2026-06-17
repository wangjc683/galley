//! Galley Core's local socket transport (Unix domain socket on macOS/Linux,
//! Windows named pipe on Windows).
//!
//! ## Purpose
//!
//! The transport that lets CLI clients talk to a running Galley Core process.
//! From B2 M4 onward, `galley session send <id> "..."` opens this socket and
//! sends a typed command; Rust dispatches via [`crate::api::GalleyApi`]
//! (same trait Tauri commands use, per [invariants.md §I5]).
//!
//! For B2 M3 only the read commands (B1 surface) are wired through — write
//! commands land in M4 together with the CLI binary side.
//!
//! ## Localhost only
//!
//! Per [AGENTS.md § Localhost Only](../../AGENTS.md), Galley Core never
//! binds TCP. Filesystem permissions on the socket file (0600 on Unix,
//! user-scoped pipe namespace on Windows) are the only access control —
//! no tokens, no TLS, no auth layer. Remote access (e.g. supervisor agents
//! on the same machine) goes through this localhost socket; cross-machine
//! access goes through GA's IM frontends + Galley CLI on the host machine.
//!
//! ## Protocol
//!
//! Newline-delimited JSON (NDJSON). One request line = one response line
//! for unary commands; subscription commands (`session.watch` in M4) keep
//! the connection open and push event lines until SIGINT.
//!
//! Request shape:
//!   `{"command":"sessions.list","args":{...},"schemaVersion":1,"requestId":"uuid"}`
//!
//! Response shape (success):
//!   `{"ok":true,"requestId":"...","result":<command-specific>}`
//!
//! Response shape (error):
//!   `{"ok":false,"requestId":"...","error":"<tag>","message":"..."}`
//!
//! Stream events (subscription mode, M4+):
//!   `{"stream":"event","requestId":"...","data":<payload>}`
//!
//! ## Race detection at startup
//!
//! Two cases:
//!   - **another Galley instance running**: try-connect succeeds → log a
//!     diagnostic + return without binding. The other instance owns the
//!     socket; we don't fight it.
//!   - **stale socket file** (previous process crashed before cleanup):
//!     try-connect fails (ECONNREFUSED) → unlink stale file → bind fresh.
//!
//! See [B2 playbook M3 G5](../../docs/refactor/B2-bridge-ownership.md) for
//! the residual narrow race window between try-connect and the next
//! process's bind (~ms; OS-level atomic bind would close this fully).

use crate::api::message::{MessageBrief, MessageVisibility};
use crate::api::project::{CreateProjectInput, ProjectBrief, ProjectId};
use crate::api::session::{CreateSessionInput, SessionBrief};
use crate::api::{
    GalleyApi, ManagedModelCredentialStatus, Origin, OriginVia, RuntimeKind, SessionFilter,
    SessionId,
};
use crate::db::SqliteGalley;
use crate::ipc::{IpcCommand, SetLlmCommand, UserMessageCommand};
use crate::managed_runtime;
use crate::runner_commands::{
    normalize_external_ga_path, prepare_managed_spawn_args, spawn_emit_task,
};
use crate::runner_manager::{
    BroadcastItem, RunnerManager, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

#[cfg(windows)]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::timeout;

mod common;
mod llm_cmds;
mod project_cmds;
mod session_cmds;
mod wire;

use llm_cmds::*;
use project_cmds::*;
use session_cmds::*;
use wire::{write_stream_line, StreamEnvelope, CONNECTION_IDLE_TIMEOUT};
pub use wire::{SocketRequest, SocketResponse, SCHEMA_VERSION};

#[allow(unused_imports)]
pub(crate) use llm_cmds::{resolve_llm_selection_for_runtime, ResolvedLlmSelection};

const GOAL_WORKER_SESSION_ID_PLACEHOLDER: &str = "{{GALLEY_SESSION_ID}}";

/// Resolve the per-user socket path.
///
/// - macOS/Linux: `${TMPDIR:-/tmp}/galley-${UID}.sock`
/// - Windows: `\\.\pipe\galley-${USERNAME}`
pub fn socket_path() -> PathBuf {
    #[cfg(unix)]
    {
        let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
        // SAFETY: getuid is always safe — POSIX guarantees it can't fail.
        let uid = unsafe { libc_getuid() };
        PathBuf::from(format!("{}/galley-{}.sock", tmp.trim_end_matches('/'), uid))
    }
    #[cfg(windows)]
    {
        let user = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_else(|_| "unknown".to_string());
        // Sanitize: Windows named-pipe names can't contain '\\' or '/'.
        let safe = user.replace(['\\', '/'], "_");
        PathBuf::from(format!(r"\\.\pipe\galley-{}", safe))
    }
}

// Minimal `getuid()` shim. We don't pull in the `libc` or `nix` crates
// just for this one call — the syscall is stable POSIX and the bind to
// `geteuid` would be one extra dep for ~6 chars of code. (`extern` blocks
// can't carry doc comments, so this is `//` not `///`.)
#[cfg(unix)]
extern "C" {
    #[link_name = "getuid"]
    fn libc_getuid() -> u32;
}

/// Start the listener. Spawns a tokio task that owns the listener for the
/// app's lifetime. Idempotent at startup boundary — if another Galley
/// instance is already bound, logs + returns without crashing.
///
/// `manager`: shared reference to the RunnerManager. Cloned into the
/// per-connection dispatch tasks so write commands (`session.send`,
/// `session.watch`) can talk to subprocesses.
///
/// Returns a guard that unlinks the socket file when dropped (Unix only —
/// Windows pipes auto-clean). Hold this in app state to keep the socket
/// alive until process exit.
pub async fn start(
    app: AppHandle,
    manager: Arc<RunnerManager>,
) -> Result<SocketGuard, std::io::Error> {
    let path = socket_path();

    // Race detection: try connecting to see if another instance owns it.
    #[cfg(unix)]
    {
        if path.exists() {
            // Probe with a 200ms timeout — owners should accept fast on
            // localhost; if it hangs longer than this we treat it as
            // stale and reclaim.
            match timeout(Duration::from_millis(200), UnixStream::connect(&path)).await {
                Ok(Ok(_)) => {
                    eprintln!(
                        "[socket] another Galley instance is bound to {} — \
                         not starting a second listener",
                        path.display()
                    );
                    return Ok(SocketGuard::dormant());
                }
                _ => {
                    // ECONNREFUSED or timeout → stale socket file. Unlink
                    // before bind() — bind() doesn't replace existing
                    // files on Unix.
                    if let Err(e) = std::fs::remove_file(&path) {
                        eprintln!(
                            "[socket] failed to remove stale socket {}: {} — \
                             listener won't start",
                            path.display(),
                            e
                        );
                        return Ok(SocketGuard::dormant());
                    }
                }
            }
        }
    }

    let listener_result = bind_listener(&path).await;
    match listener_result {
        Ok(listener) => {
            // Apply 0600 permission on Unix. Windows named pipes are
            // user-scoped by default (their namespace + DACL).
            #[cfg(unix)]
            apply_socket_permissions(&path);

            let task_path = path.clone();
            let task_manager = manager.clone();
            let task_app = app.clone();
            tokio::spawn(async move {
                eprintln!("[socket] listening on {}", task_path.display());
                accept_loop(task_app, listener, task_manager).await;
            });
            Ok(SocketGuard::active(path))
        }
        Err(e) => {
            eprintln!(
                "[socket] bind failed at {}: {} — CLI will report exit 4",
                path.display(),
                e
            );
            // We don't error here — bind failure shouldn't kill Galley
            // Core. The CLI will just see a connection refusal and
            // report exit 4 (db_unavailable / "Galley Core not running").
            Ok(SocketGuard::dormant())
        }
    }
}

#[cfg(unix)]
async fn bind_listener(path: &PathBuf) -> Result<UnixListener, std::io::Error> {
    UnixListener::bind(path)
}

#[cfg(windows)]
async fn bind_listener(path: &PathBuf) -> Result<NamedPipeServer, std::io::Error> {
    let path_str = path
        .to_str()
        .ok_or_else(|| std::io::Error::other("named pipe path not UTF-8"))?;
    ServerOptions::new()
        .first_pipe_instance(true)
        .create(path_str)
}

#[cfg(unix)]
fn apply_socket_permissions(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
        eprintln!(
            "[socket] failed to set 0600 permissions on {}: {} — \
             other local users could read",
            path.display(),
            e
        );
    }
}

#[cfg(unix)]
async fn accept_loop(app: AppHandle, listener: UnixListener, manager: Arc<RunnerManager>) {
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let m = manager.clone();
                let app_c = app.clone();
                tokio::spawn(async move {
                    let (read_half, write_half) = stream.into_split();
                    handle_stream(app_c, read_half, write_half, m).await;
                });
            }
            Err(e) => {
                eprintln!("[socket] accept error: {e}");
                // Brief backoff to avoid tight loop on persistent errors.
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

#[cfg(windows)]
async fn accept_loop(app: AppHandle, mut listener: NamedPipeServer, manager: Arc<RunnerManager>) {
    loop {
        // `connect()` blocks until a client connects to this pipe.
        if let Err(e) = listener.connect().await {
            eprintln!("[socket] connect error: {e}");
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }
        // Need a new server instance for the next client; `connect` on
        // the same server only handles one client.
        let path = socket_path();
        let path_str = match path.to_str() {
            Some(s) => s,
            None => {
                eprintln!("[socket] named pipe path not UTF-8");
                return;
            }
        };
        let new_listener = match ServerOptions::new().create(path_str) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[socket] create next pipe instance failed: {e}");
                return;
            }
        };
        let connected = std::mem::replace(&mut listener, new_listener);
        let m = manager.clone();
        let app_c = app.clone();
        tokio::spawn(async move {
            let (read_half, write_half) = tokio::io::split(connected);
            handle_stream(app_c, read_half, write_half, m).await;
        });
    }
}

async fn handle_stream<R, W>(
    app: AppHandle,
    read_half: R,
    mut write_half: W,
    manager: Arc<RunnerManager>,
) where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut lines = BufReader::new(read_half).lines();
    loop {
        let next_line = timeout(CONNECTION_IDLE_TIMEOUT, lines.next_line()).await;
        let line = match next_line {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => return, // client closed
            Ok(Err(_e)) => return,
            Err(_) => {
                // Idle timeout → polite close
                let _ = write_resp(
                    &mut write_half,
                    &SocketResponse::err(None, "idle_timeout", "connection idle > 90s"),
                )
                .await;
                return;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        match dispatch_line(&line, Some(&app), &manager).await {
            DispatchResult::Unary(resp) => {
                if write_resp(&mut write_half, &resp).await.is_err() {
                    return;
                }
            }
            DispatchResult::Stream { request_id, mut rx } => {
                // Long-running subscription: forward each broadcast item
                // as a stream line until the receiver closes (subprocess
                // exited) or the client disconnects.
                use tokio::sync::broadcast::error::RecvError;
                loop {
                    match rx.recv().await {
                        Ok(BroadcastItem::Event(boxed)) => {
                            let payload = StreamEnvelope::event(
                                request_id.clone(),
                                serde_json::to_value(&*boxed).unwrap_or(Value::Null),
                            );
                            if write_stream_line(&mut write_half, &payload).await.is_err() {
                                return;
                            }
                        }
                        Ok(BroadcastItem::Malformed(line)) => {
                            let payload = StreamEnvelope::event(
                                request_id.clone(),
                                serde_json::json!({ "kind": "malformed", "line": line }),
                            );
                            if write_stream_line(&mut write_half, &payload).await.is_err() {
                                return;
                            }
                        }
                        Ok(BroadcastItem::Closed { .. }) => {
                            let payload =
                                StreamEnvelope::end(request_id.clone(), "subprocess_exited");
                            let _ = write_stream_line(&mut write_half, &payload).await;
                            return;
                        }
                        Err(RecvError::Lagged(_)) => continue,
                        Err(RecvError::Closed) => {
                            let payload =
                                StreamEnvelope::end(request_id.clone(), "subprocess_exited");
                            let _ = write_stream_line(&mut write_half, &payload).await;
                            return;
                        }
                    }
                }
            }
            DispatchResult::NativeStream { request_id, mut rx } => {
                while let Some(item) = rx.recv().await {
                    match item {
                        crate::native_runtime::NativeRuntimeStreamItem::Event(boxed) => {
                            let payload = StreamEnvelope::event(
                                request_id.clone(),
                                serde_json::to_value(&*boxed).unwrap_or(Value::Null),
                            );
                            if write_stream_line(&mut write_half, &payload).await.is_err() {
                                return;
                            }
                        }
                        crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                            let payload = StreamEnvelope::end(request_id.clone(), &reason);
                            let _ = write_stream_line(&mut write_half, &payload).await;
                            return;
                        }
                    }
                }
                let payload = StreamEnvelope::end(request_id.clone(), "native_stream_closed");
                let _ = write_stream_line(&mut write_half, &payload).await;
                return;
            }
        }
    }
}

/// Output of [`dispatch_line`]. Most commands return a single response
/// (Unary); `session.watch` returns a Stream of broadcast events.
enum DispatchResult {
    Unary(SocketResponse),
    Stream {
        request_id: Option<String>,
        rx: broadcast::Receiver<BroadcastItem>,
    },
    NativeStream {
        request_id: Option<String>,
        rx: tokio::sync::mpsc::UnboundedReceiver<crate::native_runtime::NativeRuntimeStreamItem>,
    },
}

async fn write_resp<W: tokio::io::AsyncWrite + Unpin>(
    w: &mut W,
    resp: &SocketResponse,
) -> std::io::Result<()> {
    let line = serde_json::to_string(resp).unwrap_or_else(|_| {
        r#"{"ok":false,"error":"internal","message":"response serialize failed"}"#.to_string()
    });
    w.write_all(line.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await?;
    Ok(())
}

/// Parse a request line and dispatch to a command handler. Returns either
/// a single [`SocketResponse`] or a streaming broadcast receiver for
/// subscription commands like `session.watch`.
async fn dispatch_line(
    line: &str,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> DispatchResult {
    let req: SocketRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return DispatchResult::Unary(SocketResponse::err(
                None,
                "invalid_args",
                format!("malformed request JSON: {e}"),
            ));
        }
    };
    if req.schema_version != SCHEMA_VERSION {
        return DispatchResult::Unary(SocketResponse::err(
            req.request_id,
            "schema_mismatch",
            format!(
                "client schema_version {} != server {}",
                req.schema_version, SCHEMA_VERSION
            ),
        ));
    }

    let request_id = req.request_id.clone();
    match req.command.as_str() {
        // ---- B1 read commands ----
        "sessions.list" => {
            DispatchResult::Unary(dispatch_sessions_list(request_id, req.args).await)
        }
        "ping" => DispatchResult::Unary(SocketResponse::ok(
            request_id,
            serde_json::json!({ "pong": true }),
        )),
        "version" => DispatchResult::Unary(SocketResponse::ok(
            request_id,
            serde_json::json!({ "schemaVersion": SCHEMA_VERSION }),
        )),
        // ---- B2 M4 write commands ----
        "session.send" => {
            DispatchResult::Unary(dispatch_session_send(request_id, req.args, app, manager).await)
        }
        "session.copy_to_native" => {
            DispatchResult::Unary(dispatch_session_copy_to_native(request_id, req.args, app).await)
        }
        "session.approval_response" => DispatchResult::Unary(
            dispatch_session_approval_response(request_id, req.args, app).await,
        ),
        "session.checkpoint" => {
            DispatchResult::Unary(dispatch_session_checkpoint(request_id, req.args, app).await)
        }
        "session.goal_synthesize" => DispatchResult::Unary(
            dispatch_session_goal_synthesize(request_id, req.args, app, manager).await,
        ),
        "session.goal_master_plan" => DispatchResult::Unary(
            dispatch_session_goal_master_plan(request_id, req.args, app, manager).await,
        ),
        "session.watch" => dispatch_session_watch(request_id, req.args, manager).await,
        // ---- B4 M1 session write commands ----
        "session.new" => {
            DispatchResult::Unary(dispatch_session_new(request_id, req.args, app, manager).await)
        }
        "session.new_goal_worker" => DispatchResult::Unary(
            dispatch_session_new_goal_worker(request_id, req.args, app, manager).await,
        ),
        "session.btw" => {
            DispatchResult::Unary(dispatch_session_btw(request_id, req.args, manager).await)
        }
        "session.stop" => {
            DispatchResult::Unary(dispatch_session_stop(request_id, req.args, manager).await)
        }
        "session.shutdown_runner" => DispatchResult::Unary(
            dispatch_session_shutdown_runner(request_id, req.args, manager).await,
        ),
        "session.archive" => {
            DispatchResult::Unary(dispatch_session_archive(request_id, req.args, app).await)
        }
        "session.restore" => {
            DispatchResult::Unary(dispatch_session_restore(request_id, req.args, app).await)
        }
        "session.move" => {
            DispatchResult::Unary(dispatch_session_move(request_id, req.args, app).await)
        }
        // ---- B4 M1.3 project + llm write commands ----
        "project.create" => {
            DispatchResult::Unary(dispatch_project_create(request_id, req.args, app).await)
        }
        "project.delete" => {
            DispatchResult::Unary(dispatch_project_delete(request_id, req.args, app).await)
        }
        "llm.set" => {
            DispatchResult::Unary(dispatch_llm_set(request_id, req.args, app, manager).await)
        }
        other => DispatchResult::Unary(SocketResponse::err(
            request_id,
            "unknown_command",
            format!("no handler for '{other}'"),
        )),
    }
}

/// Lifetime guard for the socket file. Held in app state; when the app
/// drops it (or panics with unwind), Drop unlinks the socket file on Unix.
/// On Windows the named pipe namespace auto-cleans when all handles drop.
///
/// A "dormant" guard is returned when bind failed or another instance
/// owned the socket — Drop is a no-op in that case (we don't want to
/// unlink the OTHER instance's socket).
pub struct SocketGuard {
    path: Option<PathBuf>,
}

impl SocketGuard {
    fn dormant() -> Self {
        Self { path: None }
    }
    fn active(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    /// True iff this guard owns a real listener (vs being the "another
    /// instance owned it" no-op variant). Test helper.
    pub fn is_active(&self) -> bool {
        self.path.is_some()
    }
}

impl Drop for SocketGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(path) = &self.path {
            if let Err(e) = std::fs::remove_file(path) {
                eprintln!(
                    "[socket] failed to unlink {} on drop: {}",
                    path.display(),
                    e
                );
            }
        }
        // Windows: nothing to do — named pipe namespace cleans on handle drop.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_unix_uses_tmpdir() {
        #[cfg(unix)]
        {
            // Force a known TMPDIR to make the assertion deterministic.
            let old = std::env::var("TMPDIR").ok();
            // SAFETY: tests are single-threaded for env-var manipulation
            // because we restore at the end. cargo test default is parallel
            // but env mutation here only touches this one test.
            unsafe {
                std::env::set_var("TMPDIR", "/tmp/test-socket-path");
            }
            let path = socket_path();
            let s = path.to_string_lossy();
            assert!(s.starts_with("/tmp/test-socket-path/galley-"));
            assert!(s.ends_with(".sock"));
            // Restore
            unsafe {
                match old {
                    Some(v) => std::env::set_var("TMPDIR", v),
                    None => std::env::remove_var("TMPDIR"),
                }
            }
        }
    }

    #[test]
    fn socket_path_windows_uses_username() {
        #[cfg(windows)]
        {
            let path = socket_path();
            let s = path.to_string_lossy();
            assert!(s.starts_with(r"\\.\pipe\galley-"));
        }
    }

    #[test]
    fn mint_session_id_is_unique_under_burst() {
        use std::collections::HashSet;

        let ids: Vec<String> = (0..512).map(|_| mint_session_id()).collect();
        let unique: HashSet<String> = ids.iter().cloned().collect();
        assert_eq!(unique.len(), ids.len());
        assert!(ids.iter().all(|id| id.starts_with("s-")));
    }

    #[test]
    fn goal_worker_task_template_requires_exactly_one_session_placeholder() {
        let missing = render_goal_worker_task_template("hello", "s-real");
        assert!(missing.is_err());

        let multiple = render_goal_worker_task_template(
            "{{GALLEY_SESSION_ID}} and {{GALLEY_SESSION_ID}}",
            "s-real",
        );
        assert!(multiple.is_err());
    }

    #[test]
    fn goal_worker_task_template_renders_real_session_id() {
        let rendered =
            render_goal_worker_task_template("Your session id: {{GALLEY_SESSION_ID}}", "s-real")
                .unwrap();
        assert_eq!(rendered, "Your session id: s-real");
    }

    #[test]
    fn parse_socket_request_minimal() {
        let line = r#"{"command":"ping"}"#;
        let req: SocketRequest = serde_json::from_str(line).unwrap();
        assert_eq!(req.command, "ping");
        assert!(req.request_id.is_none());
        assert_eq!(req.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn parse_socket_request_full() {
        let line = r#"{
            "command":"sessions.list",
            "args":{"archived":false},
            "requestId":"abc-123",
            "schemaVersion":1
        }"#;
        let req: SocketRequest = serde_json::from_str(line).unwrap();
        assert_eq!(req.command, "sessions.list");
        assert_eq!(req.request_id, Some("abc-123".into()));
    }

    #[test]
    fn llm_list_entry_accepts_gui_display_name_cache() {
        let entry: LlmListEntry =
            serde_json::from_str(r#"{"index":0,"displayName":"GPT 5.5"}"#).unwrap();
        assert_eq!(entry.index, 0);
        assert_eq!(entry.name, "GPT 5.5");
    }

    #[test]
    fn response_serializes_compactly() {
        let resp = SocketResponse::ok(Some("r1".into()), serde_json::json!({"x":1}));
        let s = serde_json::to_string(&resp).unwrap();
        assert!(s.contains("\"ok\":true"));
        assert!(s.contains("\"requestId\":\"r1\""));
        assert!(s.contains("\"result\":{\"x\":1}"));
        // null fields suppressed by skip_serializing_if
        assert!(!s.contains("\"error\":"));
        assert!(!s.contains("\"message\":"));
    }

    #[test]
    fn response_error_shape() {
        let resp = SocketResponse::err(None, "not_found", "session does not exist");
        let s = serde_json::to_string(&resp).unwrap();
        assert!(s.contains("\"ok\":false"));
        assert!(s.contains("\"error\":\"not_found\""));
        assert!(s.contains("\"message\":\"session does not exist\""));
    }

    /// Helper: unwrap the Unary variant for tests that only exercise
    /// non-stream commands. Streaming command tests live in the
    /// `core/tests/socket_listener_test.rs` integration suite where
    /// a real RunnerManager + spawned subprocess exists.
    fn expect_unary(r: DispatchResult) -> SocketResponse {
        match r {
            DispatchResult::Unary(resp) => resp,
            DispatchResult::Stream { .. } => panic!("expected Unary, got Stream"),
            DispatchResult::NativeStream { .. } => panic!("expected Unary, got NativeStream"),
        }
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyNativeEventView {
        kind: String,
        session_id: String,
    }

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyStreamFrameView {
        stream: String,
        request_id: Option<String>,
        data: Option<LegacyNativeEventView>,
        reason: Option<String>,
    }

    const TEST_MIGRATIONS: &[&str] = &[
        include_str!("../../migrations/001_init.sql"),
        include_str!("../../migrations/002_add_has_unread.sql"),
        include_str!("../../migrations/003_add_message_summary.sql"),
        include_str!("../../migrations/004_add_messages_fts.sql"),
        include_str!("../../migrations/005_add_message_preamble.sql"),
        include_str!("../../migrations/006_messages_origin.sql"),
        include_str!("../../migrations/007_sessions_origin.sql"),
        include_str!("../../migrations/008_runtime_identity.sql"),
        include_str!("../../migrations/009_managed_models.sql"),
        include_str!("../../migrations/010_managed_model_providers.sql"),
        include_str!("../../migrations/011_managed_model_sort_order.sql"),
        include_str!("../../migrations/012_managed_model_local_secrets.sql"),
        include_str!("../../migrations/013_session_llm_key.sql"),
        include_str!("../../migrations/014_managed_model_auth_kind.sql"),
        include_str!("../../migrations/015_goal_v1.sql"),
        include_str!("../../migrations/016_goal_master_session.sql"),
        include_str!("../../migrations/017_message_visibility.sql"),
        include_str!("../../migrations/018_goal_deliverable.sql"),
        include_str!("../../migrations/019_goal_workspace.sql"),
        include_str!("../../migrations/020_message_attachments.sql"),
        include_str!("../../migrations/021_native_session_runtime.sql"),
        include_str!("../../migrations/022_native_memory_substrate.sql"),
        include_str!("../../migrations/023_native_goal_runtime.sql"),
        include_str!("../../migrations/024_native_default_runtime.sql"),
    ];

    struct EnvGuard {
        key: &'static str,
        old: Option<std::ffi::OsString>,
    }

    fn socket_env_lock() -> &'static tokio::sync::Mutex<()> {
        static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
    }

    impl EnvGuard {
        fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
            let old = std::env::var_os(key);
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, old }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.old {
                    Some(value) => std::env::set_var(self.key, value),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }

    async fn seed_socket_test_db(path: &std::path::Path) {
        let opts = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = sqlx::SqlitePool::connect_with(opts).await.unwrap();
        for sql in TEST_MIGRATIONS {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
    }

    #[tokio::test]
    async fn dispatch_unknown_command_yields_error() {
        let mgr = RunnerManager::new();
        let resp =
            expect_unary(dispatch_line(r#"{"command":"nope.does_not_exist"}"#, None, &mgr).await);
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("unknown_command"));
    }

    #[tokio::test]
    async fn dispatch_ping_succeeds() {
        let mgr = RunnerManager::new();
        let resp =
            expect_unary(dispatch_line(r#"{"command":"ping","requestId":"r1"}"#, None, &mgr).await);
        assert!(resp.ok);
        assert_eq!(resp.request_id.as_deref(), Some("r1"));
    }

    #[tokio::test]
    async fn dispatch_invalid_json() {
        let mgr = RunnerManager::new();
        let resp = expect_unary(dispatch_line("not-json", None, &mgr).await);
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    }

    #[tokio::test]
    async fn dispatch_schema_mismatch() {
        let mgr = RunnerManager::new();
        let resp = expect_unary(
            dispatch_line(r#"{"command":"ping","schemaVersion":42}"#, None, &mgr).await,
        );
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("schema_mismatch"));
    }

    #[tokio::test]
    async fn dispatch_session_watch_unknown_session_returns_not_found() {
        let mgr = RunnerManager::new();
        let line = r#"{"command":"session.watch","args":{"sessionId":"nope"}}"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("not_found"));
    }

    #[tokio::test]
    async fn dispatch_session_shutdown_runner_rejects_bad_args() {
        let mgr = RunnerManager::new();
        let line = r#"{"command":"session.shutdown_runner","args":{"sessionId":123}}"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    }

    #[tokio::test]
    async fn dispatch_session_checkpoint_rejects_empty_content() {
        let mgr = RunnerManager::new();
        let line =
            r#"{"command":"session.checkpoint","args":{"sessionId":"s-test","content":"   "}}"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    }

    #[tokio::test]
    async fn dispatch_session_new_native_mock_persists_visible_turn() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Investigate native path",
                "runtimeKind":"galley_native"
            },
            "requestId":"native-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        assert_eq!(resp.request_id.as_deref(), Some("native-r1"));
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert_eq!(result["session"]["gaRuntimeKind"], "galley_native");
        assert_eq!(result["session"]["turnCount"], 1);
        assert!(result["assistantMessage"]["finalAnswer"]
            .as_str()
            .unwrap()
            .contains("Galley Native mock response"));

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let galley = SqliteGalley::open().await.unwrap();
        let messages = galley
            .session_messages(SessionId(session_id), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "Investigate native path");
        assert_eq!(messages[1].role, crate::api::MessageRole::Agent);
        assert!(messages[1]
            .final_answer
            .as_deref()
            .unwrap()
            .contains("mock-model fallback"));

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": result["session"]["id"].as_str().unwrap() },
            "requestId": "native-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { request_id, mut rx } = watch else {
            panic!("expected native stream");
        };
        assert_eq!(request_id.as_deref(), Some("native-watch-r1"));
        let mut kinds = Vec::new();
        let mut end_reason = None;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    kinds.push(event.kind());
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    end_reason = Some(reason);
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert_eq!(end_reason.as_deref(), Some("native_run_complete"));
    }

    #[tokio::test]
    async fn p15_socket_schema_v1_native_watch_events_are_additive() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"P15 native compatibility",
                "runtimeKind":"galley_native"
            },
            "schemaVersion":1,
            "requestId":"p15-native-new"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        assert_eq!(resp.request_id.as_deref(), Some("p15-native-new"));
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert_eq!(result["session"]["runtimeKind"], "galley_native");
        assert_eq!(result["session"]["gaRuntimeKind"], "galley_native");
        let session_id = result["session"]["id"].as_str().unwrap().to_string();

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "schemaVersion": 1,
            "requestId": "p15-native-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { request_id, mut rx } = watch else {
            panic!("expected native stream");
        };
        assert_eq!(request_id.as_deref(), Some("p15-native-watch"));

        let mut legacy_kinds = Vec::new();
        let mut saw_additive_native_field = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let data = serde_json::to_value(&*event).unwrap();
                    if data["kind"] == "runtime_ready" {
                        assert_eq!(data["runtimeKind"], "galley_native");
                        saw_additive_native_field = true;
                    }
                    let envelope = StreamEnvelope::event(Some("p15-native-watch".into()), data);
                    let legacy: LegacyStreamFrameView =
                        serde_json::from_value(serde_json::to_value(envelope).unwrap()).unwrap();
                    assert_eq!(legacy.stream, "event");
                    assert_eq!(legacy.request_id.as_deref(), Some("p15-native-watch"));
                    let legacy_event = legacy.data.expect("legacy event data");
                    assert_eq!(legacy_event.session_id, session_id);
                    legacy_kinds.push(legacy_event.kind);
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    let envelope = StreamEnvelope::end(Some("p15-native-watch".into()), &reason);
                    let legacy: LegacyStreamFrameView =
                        serde_json::from_value(serde_json::to_value(envelope).unwrap()).unwrap();
                    assert_eq!(legacy.stream, "end");
                    assert_eq!(legacy.request_id.as_deref(), Some("p15-native-watch"));
                    assert_eq!(legacy.reason.as_deref(), Some("native_run_complete"));
                    break;
                }
            }
        }

        assert_eq!(
            legacy_kinds,
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_additive_native_field);
    }

    #[tokio::test]
    async fn create_native_goal_proposal_allowed_when_gate_enabled() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let galley = SqliteGalley::open().await.unwrap();
        let proposal = galley
            .create_goal_proposal(
                crate::api::CreateGoalProposalInput {
                    objective: "Run native Goal Hive smoke".into(),
                    project_id: None,
                    master_session_id: None,
                    budget_seconds: Some(60),
                    worker_limit: Some(1),
                    runtime_kind: Some(RuntimeKind::GalleyNative),
                    write_mode: None,
                    expires_in_seconds: Some(60),
                },
                Origin::cli(
                    Some("slice7-test".into()),
                    Some("native goal proposal".into()),
                ),
            )
            .await
            .unwrap();

        assert_eq!(proposal.runtime_kind, RuntimeKind::GalleyNative);
        assert_eq!(proposal.worker_limit, 1);
    }

    #[tokio::test]
    async fn dispatch_session_goal_master_plan_native_stays_internal() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let galley = SqliteGalley::open().await.unwrap();
        let session_id = SessionId("s-native-goal-master".into());
        galley
            .create_session(
                CreateSessionInput {
                    id: session_id.as_str().to_string(),
                    title: "Native goal master".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(RuntimeKind::GalleyNative),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::cli(None, Some("native master test".into())),
            )
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = serde_json::json!({
            "command": "session.goal_master_plan",
            "args": {
                "sessionId": session_id.as_str(),
                "dispatchContent": "Hidden native master planning prompt"
            },
            "requestId": "native-master-plan"
        })
        .to_string();
        let resp = expect_unary(dispatch_line(&line, None, &mgr).await);

        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native_goal_master_plan");

        let visible = galley
            .session_messages(session_id.clone(), None)
            .await
            .unwrap();
        assert!(visible.is_empty());
        let all = galley
            .session_messages_including_internal(session_id, None)
            .await
            .unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].content, "Hidden native master planning prompt");
        assert_eq!(all[0].visibility, Some(MessageVisibility::Internal));
    }

    #[tokio::test]
    async fn dispatch_session_goal_synthesize_native_runs_inline() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let galley = SqliteGalley::open().await.unwrap();
        let session_id = SessionId("s-native-goal-synthesis".into());
        galley
            .create_session(
                CreateSessionInput {
                    id: session_id.as_str().to_string(),
                    title: "Native goal synthesis".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(RuntimeKind::GalleyNative),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::cli(None, Some("native synthesis test".into())),
            )
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = serde_json::json!({
            "command": "session.goal_synthesize",
            "args": {
                "sessionId": session_id.as_str(),
                "visibleContent": "正在综合 Goal 结果。",
                "dispatchContent": "Native final synthesis payload"
            },
            "requestId": "native-goal-synthesize"
        })
        .to_string();
        let resp = expect_unary(dispatch_line(&line, None, &mgr).await);

        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert_eq!(result["session"]["status"], "idle");
        assert!(result["assistantMessage"]["finalAnswer"]
            .as_str()
            .unwrap()
            .contains("Native final synthesis payload"));

        let messages = galley.session_messages(session_id, None).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "正在综合 Goal 结果。");
        assert_eq!(messages[0].visibility, Some(MessageVisibility::Visible));
        assert!(messages[1]
            .final_answer
            .as_deref()
            .unwrap()
            .contains("Galley Native mock response"));
    }

    #[tokio::test]
    async fn dispatch_session_new_native_uses_configured_openai_model() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let api_base = start_fake_openai_server("Native real model answer").await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_openai".into(),
                display_name: "Native OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_openai".into(),
                provider_id: "mp_native_openai".into(),
                display_name: "Native Test Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Answer from configured model",
                "runtimeKind":"galley_native",
                "llmName":"Native Test Model"
            },
            "requestId":"native-model-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert!(result["session"]["selectedLlmIndex"].is_null());
        assert_eq!(result["session"]["selectedLlmKey"], "mm_native_openai");
        assert_eq!(
            result["session"]["selectedLlmDisplayName"],
            "Native Test Model"
        );
        assert_eq!(
            result["assistantMessage"]["finalAnswer"],
            "Native real model answer"
        );

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let messages = galley
            .session_messages(SessionId(session_id), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[1].final_answer.as_deref(),
            Some("Native real model answer")
        );

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": result["session"]["id"].as_str().unwrap() },
            "requestId": "native-model-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut saw_model_progress = false;
        let mut saw_usage = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["source"], "model");
                        assert_eq!(value["delta"], "Native real model answer");
                        saw_model_progress = true;
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["stopReason"], "stop");
                        assert_eq!(value["usage"]["total_tokens"], 9);
                        saw_usage = true;
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert!(saw_model_progress);
        assert!(saw_usage);
    }

    #[tokio::test]
    async fn dispatch_session_new_native_waits_for_approval_on_risky_tool() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"start_long_term_update","arguments":{"topic":"learn approval","risk":"high"}}
```"#;
        let api_base =
            start_fake_openai_server_for("Route native tool call", tool_answer.to_string()).await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_tool_openai".into(),
                display_name: "Native Tool OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_tool_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_tool_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_tool_openai".into(),
                provider_id: "mp_native_tool_openai".into(),
                display_name: "Native Tool Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Route native tool call",
                "runtimeKind":"galley_native",
                "llmName":"Native Tool Model"
            },
            "requestId":"native-tool-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert_eq!(result["session"]["status"], "waiting_approval");
        assert_eq!(result["assistantMessage"]["finalAnswer"], tool_answer);

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let (tool_calls_raw, tool_results_raw): (String, String) = sqlx::query_as(
            "SELECT tool_calls, tool_results FROM messages \
             WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let tool_calls: serde_json::Value = serde_json::from_str(&tool_calls_raw).unwrap();
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_calls.as_array().unwrap().len(), 1);
        assert_eq!(tool_calls[0]["name"], "start_long_term_update");
        let approval_id = tool_calls[0]["id"].as_str().unwrap().to_string();
        assert_eq!(tool_results, serde_json::json!([]));
        let tool_row: (String, String, String) =
            sqlx::query_as("SELECT status, tool_name, risk_level FROM tool_events WHERE id = ?")
                .bind(&approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            tool_row,
            (
                "waiting_approval".into(),
                "start_long_term_update".into(),
                "high".into()
            )
        );
        let pending_count: i64 =
            sqlx::query_scalar("SELECT pending_approval_count FROM sessions WHERE id = ?")
                .bind(&session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(pending_count, 1);

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-tool-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        let mut saw_approval_required = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    kinds.push(event.kind());
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "APPROVAL_REQUIRED");
                        saw_approval_required = true;
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_waiting_approval");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "tool_pending",
                "approval_pending",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_approval_required);
    }

    #[tokio::test]
    async fn dispatch_session_new_native_file_read_continues_to_final_answer() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(
            workspace.path().join("notes.txt"),
            "hello from fixture\nsecond line\n",
        )
        .unwrap();
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"file_read","arguments":{"path":"notes.txt","startLine":1,"endLine":1}}
```"#;
        let final_answer = "The file says: hello from fixture.";
        let api_base = start_fake_openai_sequence_server(vec![
            ("Read workspace note", tool_answer.to_string()),
            ("hello from fixture", final_answer.to_string()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .create_project(
                CreateProjectInput {
                    id: "proj_native_file_read".into(),
                    name: "Native File Read".into(),
                    root_path: Some(workspace.path().to_string_lossy().to_string()),
                    icon: None,
                    color: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_file_read_openai".into(),
                display_name: "Native File Read OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_file_read_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_file_read_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_file_read_openai".into(),
                provider_id: "mp_native_file_read_openai".into(),
                display_name: "Native File Read Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Read workspace note",
                "projectId":"proj_native_file_read",
                "runtimeKind":"galley_native",
                "llmName":"Native File Read Model"
            },
            "requestId":"native-file-read-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(result["dispatch"], "completed_native");
        assert_eq!(result["session"]["status"], "idle");
        assert_eq!(result["assistantMessage"]["finalAnswer"], final_answer);

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let (assistant_final_answer, tool_calls_raw, tool_results_raw): (String, String, String) =
            sqlx::query_as(
                "SELECT final_answer, tool_calls, tool_results FROM messages \
             WHERE session_id = ? AND role = 'assistant'",
            )
            .bind(&session_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(assistant_final_answer, final_answer);
        let tool_calls: serde_json::Value = serde_json::from_str(&tool_calls_raw).unwrap();
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_calls.as_array().unwrap().len(), 1);
        assert_eq!(tool_calls[0]["name"], "file_read");
        assert_eq!(tool_results.as_array().unwrap().len(), 1);
        assert_eq!(tool_results[0]["toolName"], "file_read");
        assert_eq!(tool_results[0]["status"], "success");
        assert!(tool_results[0]["content"]
            .as_str()
            .unwrap()
            .contains("hello from fixture"));

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-file-read-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut progress_sources = Vec::new();
        let mut progress_deltas = Vec::new();
        let mut saw_file_read_tool_end = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "turn_progress" {
                        progress_sources.push(value["source"].as_str().unwrap().to_string());
                        progress_deltas.push(value["delta"].as_str().unwrap().to_string());
                    }
                    if value["kind"] == "tool_end" {
                        assert_eq!(value["toolName"], "file_read");
                        assert_eq!(value["status"], "success");
                        saw_file_read_tool_end = true;
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "CURRENT_TASK_DONE");
                        assert_eq!(value["finalContent"], final_answer);
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(progress_sources, vec!["model_stream", "model_continuation"]);
        assert!(progress_deltas[0].contains("file_read"));
        assert_eq!(progress_deltas[1], final_answer);
        assert!(saw_file_read_tool_end);
    }

    #[tokio::test]
    async fn dispatch_session_approval_response_native_file_read_continues_to_final_answer() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_path = outside_dir.path().join("outside.txt");
        std::fs::write(&outside_path, "approved outside file\nsecond line\n").unwrap();
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = format!(
            "```json\n{}\n```",
            serde_json::json!({
                "tool": "file_read",
                "arguments": {
                    "path": outside_path.to_string_lossy().to_string(),
                    "startLine": 1,
                    "endLine": 1
                }
            })
        );
        let final_answer = "The approved file says: approved outside file.";
        let api_base = start_fake_openai_sequence_server(vec![
            ("Approve outside file read", tool_answer.clone()),
            ("approved outside file", final_answer.to_string()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_approved_file_read_openai".into(),
                display_name: "Native Approved File Read OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_approved_file_read_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_approved_file_read_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_approved_file_read_openai".into(),
                provider_id: "mp_native_approved_file_read_openai".into(),
                display_name: "Native Approved File Read Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let mgr = RunnerManager::new();
        let new_line = serde_json::json!({
            "command": "session.new",
            "args": {
                "task": "Approve outside file read",
                "runtimeKind": "galley_native",
                "llmName": "Native Approved File Read Model"
            },
            "requestId": "native-approved-file-read-new"
        })
        .to_string();
        let new_resp = expect_unary(dispatch_line(&new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(new_result["dispatch"], "completed_native");
        assert_eq!(new_result["session"]["status"], "waiting_approval");
        assert_eq!(new_result["assistantMessage"]["finalAnswer"], tool_answer);
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();
        let approval_id: String = sqlx::query_scalar(
            "SELECT id FROM tool_events WHERE session_id = ? AND status = 'waiting_approval'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        let allow_line = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": session_id.clone(),
                "approvalId": approval_id.clone(),
                "decision": "allow_once"
            },
            "requestId": "native-approved-file-read-allow"
        })
        .to_string();
        let allow_resp = expect_unary(dispatch_line(&allow_line, None, &mgr).await);
        assert!(allow_resp.ok, "response: {allow_resp:?}");
        let allow_result = allow_resp.result.expect("result");
        assert_eq!(allow_result["dispatch"], "completed_native_approval");
        assert_eq!(allow_result["session"]["status"], "idle");
        assert_eq!(
            allow_result["assistantMessage"]["finalAnswer"],
            final_answer
        );
        assert_eq!(allow_result["toolResult"]["toolName"], "file_read");
        assert_eq!(allow_result["toolResult"]["status"], "success");
        assert_eq!(
            allow_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(false)
        );
        assert!(allow_result["toolResult"]["content"]
            .as_str()
            .unwrap()
            .contains("approved outside file"));

        let (assistant_content, assistant_final_answer, tool_results_raw): (
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT content, final_answer, tool_results FROM messages \
             WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(assistant_content, final_answer);
        assert_eq!(assistant_final_answer, final_answer);
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_results.as_array().unwrap().len(), 1);
        assert_eq!(tool_results[0]["toolName"], "file_read");
        assert_eq!(tool_results[0]["status"], "success");
        assert!(tool_results[0]["content"]
            .as_str()
            .unwrap()
            .contains("approved outside file"));

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-approved-file-read-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        let mut saw_continuation_progress = false;
        let mut saw_turn_end = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    kinds.push(event.kind());
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["source"], "model_continuation");
                        assert_eq!(value["delta"], final_answer);
                        saw_continuation_progress = true;
                    }
                    if value["kind"] == "turn_end" {
                        assert_eq!(value["responseContent"], final_answer);
                        assert_eq!(value["toolResults"][0]["status"], "success");
                        saw_turn_end = true;
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "CURRENT_TASK_DONE");
                        assert_eq!(
                            value["exitReason"]["data"]["mode"],
                            "approval_response_continuation"
                        );
                        assert_eq!(value["finalContent"], final_answer);
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "approval_resolved",
                "tool_start",
                "tool_progress",
                "tool_end",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_continuation_progress);
        assert!(saw_turn_end);
    }

    #[tokio::test]
    async fn dispatch_session_approval_response_native_file_patch_applies_after_approval() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(workspace.path().join("notes.txt"), "alpha\nbeta\ngamma\n").unwrap();
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"file_patch","arguments":{"path":"notes.txt","oldContent":"beta\n","newContent":"bravo\n","explanation":"rename beta"}}
```"#;
        let final_answer = "Patch applied; notes.txt now uses bravo.".to_string();
        let api_base = start_fake_openai_sequence_server(vec![
            ("Patch workspace note", tool_answer.to_string()),
            ("Patch workspace note", final_answer.clone()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .create_project(
                CreateProjectInput {
                    id: "proj_native_file_patch".into(),
                    name: "Native File Patch".into(),
                    root_path: Some(workspace.path().to_string_lossy().to_string()),
                    icon: None,
                    color: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_file_patch_openai".into(),
                display_name: "Native File Patch OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_file_patch_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_file_patch_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_file_patch_openai".into(),
                provider_id: "mp_native_file_patch_openai".into(),
                display_name: "Native File Patch Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let mgr = RunnerManager::new();
        let new_line = serde_json::json!({
            "command": "session.new",
            "args": {
                "task": "Patch workspace note",
                "projectId": "proj_native_file_patch",
                "runtimeKind": "galley_native",
                "llmName": "Native File Patch Model"
            },
            "requestId": "native-file-patch-new"
        })
        .to_string();
        let new_resp = expect_unary(dispatch_line(&new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(new_result["dispatch"], "completed_native");
        assert_eq!(new_result["session"]["status"], "waiting_approval");
        assert_eq!(new_result["assistantMessage"]["finalAnswer"], tool_answer);
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("notes.txt")).unwrap(),
            "alpha\nbeta\ngamma\n"
        );
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();
        let (approval_id, args_json): (String, String) = sqlx::query_as(
            "SELECT id, args_json FROM tool_events \
             WHERE session_id = ? AND status = 'waiting_approval'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let args: serde_json::Value = serde_json::from_str(&args_json).unwrap();
        assert_eq!(args["old_content"], "beta\n");
        assert_eq!(args["new_content"], "bravo\n");

        let allow_line = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": session_id.clone(),
                "approvalId": approval_id.clone(),
                "decision": "allow_once"
            },
            "requestId": "native-file-patch-allow"
        })
        .to_string();
        let allow_resp = expect_unary(dispatch_line(&allow_line, None, &mgr).await);
        assert!(allow_resp.ok, "response: {allow_resp:?}");
        let allow_result = allow_resp.result.expect("result");
        assert_eq!(allow_result["dispatch"], "completed_native_approval");
        assert_eq!(allow_result["session"]["status"], "idle");
        assert_eq!(
            allow_result["assistantMessage"]["finalAnswer"],
            final_answer
        );
        assert_eq!(allow_result["toolResult"]["toolName"], "file_patch");
        assert_eq!(allow_result["toolResult"]["status"], "success");
        assert_eq!(
            allow_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(true)
        );
        assert!(allow_result["toolResult"]["content"]
            .as_str()
            .unwrap()
            .contains("matched: 1"));
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("notes.txt")).unwrap(),
            "alpha\nbravo\ngamma\n"
        );

        let tool_row: (String, String) =
            sqlx::query_as("SELECT status, approval_decision FROM tool_events WHERE id = ?")
                .bind(&approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(tool_row, ("success".into(), "allow_once".into()));
        let (assistant_final_answer, tool_results_raw): (String, String) = sqlx::query_as(
            "SELECT final_answer, tool_results FROM messages WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(assistant_final_answer, final_answer);
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_results[0]["toolName"], "file_patch");
        assert_eq!(tool_results[0]["status"], "success");
        assert_eq!(tool_results[0]["sideEffectsPerformed"], true);

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-file-patch-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        let mut saw_continuation_progress = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    kinds.push(event.kind());
                    if value["kind"] == "tool_end" {
                        assert_eq!(value["toolName"], "file_patch");
                        assert_eq!(value["status"], "success");
                        assert_eq!(value["sideEffectsPerformed"], true);
                    }
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["source"], "model_continuation");
                        assert_eq!(value["delta"], final_answer);
                        saw_continuation_progress = true;
                    }
                    if value["kind"] == "turn_end" {
                        assert_eq!(value["responseContent"], final_answer);
                        assert_eq!(value["toolResults"][0]["toolName"], "file_patch");
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "CURRENT_TASK_DONE");
                        assert_eq!(
                            value["exitReason"]["data"]["mode"],
                            "approval_response_continuation"
                        );
                        assert_eq!(value["finalContent"], final_answer);
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "approval_resolved",
                "tool_start",
                "tool_progress",
                "tool_end",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_continuation_progress);
    }

    #[tokio::test]
    async fn dispatch_session_approval_response_native_file_write_creates_after_approval() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let workspace = tempfile::tempdir().unwrap();
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"file_write","arguments":{"path":"draft.txt","content":"hello\n","mode":"create"}}
```"#;
        let final_answer = "Created draft.txt with hello.".to_string();
        let api_base = start_fake_openai_sequence_server(vec![
            ("Write workspace note", tool_answer.to_string()),
            ("Write workspace note", final_answer.clone()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .create_project(
                CreateProjectInput {
                    id: "proj_native_file_write".into(),
                    name: "Native File Write".into(),
                    root_path: Some(workspace.path().to_string_lossy().to_string()),
                    icon: None,
                    color: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_file_write_openai".into(),
                display_name: "Native File Write OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_file_write_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_file_write_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_file_write_openai".into(),
                provider_id: "mp_native_file_write_openai".into(),
                display_name: "Native File Write Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let mgr = RunnerManager::new();
        let new_line = serde_json::json!({
            "command": "session.new",
            "args": {
                "task": "Write workspace note",
                "projectId": "proj_native_file_write",
                "runtimeKind": "galley_native",
                "llmName": "Native File Write Model"
            },
            "requestId": "native-file-write-new"
        })
        .to_string();
        let new_resp = expect_unary(dispatch_line(&new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(new_result["dispatch"], "completed_native");
        assert_eq!(new_result["session"]["status"], "waiting_approval");
        assert_eq!(new_result["assistantMessage"]["finalAnswer"], tool_answer);
        assert!(!workspace.path().join("draft.txt").exists());
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();
        let (approval_id, args_json): (String, String) = sqlx::query_as(
            "SELECT id, args_json FROM tool_events \
             WHERE session_id = ? AND status = 'waiting_approval'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let args: serde_json::Value = serde_json::from_str(&args_json).unwrap();
        assert_eq!(args["path"], "draft.txt");
        assert_eq!(args["mode"], "create");
        assert_eq!(args["content"], "hello\n");
        assert_eq!(args["existing_content"], "");

        let allow_line = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": session_id.clone(),
                "approvalId": approval_id.clone(),
                "decision": "allow_once"
            },
            "requestId": "native-file-write-allow"
        })
        .to_string();
        let allow_resp = expect_unary(dispatch_line(&allow_line, None, &mgr).await);
        assert!(allow_resp.ok, "response: {allow_resp:?}");
        let allow_result = allow_resp.result.expect("result");
        assert_eq!(allow_result["dispatch"], "completed_native_approval");
        assert_eq!(allow_result["session"]["status"], "idle");
        assert_eq!(
            allow_result["assistantMessage"]["finalAnswer"],
            final_answer
        );
        assert_eq!(allow_result["toolResult"]["toolName"], "file_write");
        assert_eq!(allow_result["toolResult"]["status"], "success");
        assert_eq!(
            allow_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(true)
        );
        assert!(allow_result["toolResult"]["content"]
            .as_str()
            .unwrap()
            .contains("mode: create"));
        assert_eq!(
            std::fs::read_to_string(workspace.path().join("draft.txt")).unwrap(),
            "hello\n"
        );

        let tool_row: (String, String) =
            sqlx::query_as("SELECT status, approval_decision FROM tool_events WHERE id = ?")
                .bind(&approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(tool_row, ("success".into(), "allow_once".into()));
        let (assistant_final_answer, tool_results_raw): (String, String) = sqlx::query_as(
            "SELECT final_answer, tool_results FROM messages WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(assistant_final_answer, final_answer);
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_results[0]["toolName"], "file_write");
        assert_eq!(tool_results[0]["status"], "success");
        assert_eq!(tool_results[0]["sideEffectsPerformed"], true);

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-file-write-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        let mut saw_continuation_progress = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    kinds.push(event.kind());
                    if value["kind"] == "tool_end" {
                        assert_eq!(value["toolName"], "file_write");
                        assert_eq!(value["status"], "success");
                        assert_eq!(value["sideEffectsPerformed"], true);
                    }
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["source"], "model_continuation");
                        assert_eq!(value["delta"], final_answer);
                        saw_continuation_progress = true;
                    }
                    if value["kind"] == "turn_end" {
                        assert_eq!(value["responseContent"], final_answer);
                        assert_eq!(value["toolResults"][0]["toolName"], "file_write");
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "CURRENT_TASK_DONE");
                        assert_eq!(
                            value["exitReason"]["data"]["mode"],
                            "approval_response_continuation"
                        );
                        assert_eq!(value["finalContent"], final_answer);
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "approval_resolved",
                "tool_start",
                "tool_progress",
                "tool_end",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_continuation_progress);
    }

    #[tokio::test]
    async fn dispatch_session_approval_response_native_code_run_executes_after_approval() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let workspace = tempfile::tempdir().unwrap();
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"code_run","arguments":{"command":"echo hi","timeoutSeconds":2}}
```"#;
        let final_answer = "Command completed and printed hi.".to_string();
        let api_base = start_fake_openai_sequence_server(vec![
            ("Run workspace command", tool_answer.to_string()),
            ("Run workspace command", final_answer.clone()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .create_project(
                CreateProjectInput {
                    id: "proj_native_code_run".into(),
                    name: "Native Code Run".into(),
                    root_path: Some(workspace.path().to_string_lossy().to_string()),
                    icon: None,
                    color: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_code_run_openai".into(),
                display_name: "Native Code Run OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_code_run_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_code_run_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_code_run_openai".into(),
                provider_id: "mp_native_code_run_openai".into(),
                display_name: "Native Code Run Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let mgr = RunnerManager::new();
        let new_line = serde_json::json!({
            "command": "session.new",
            "args": {
                "task": "Run workspace command",
                "projectId": "proj_native_code_run",
                "runtimeKind": "galley_native",
                "llmName": "Native Code Run Model"
            },
            "requestId": "native-code-run-new"
        })
        .to_string();
        let new_resp = expect_unary(dispatch_line(&new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(new_result["dispatch"], "completed_native");
        assert_eq!(new_result["session"]["status"], "waiting_approval");
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();
        let (approval_id, args_json): (String, String) = sqlx::query_as(
            "SELECT id, args_json FROM tool_events \
             WHERE session_id = ? AND status = 'waiting_approval'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let args: serde_json::Value = serde_json::from_str(&args_json).unwrap();
        assert_eq!(args["command"], "echo hi");
        assert_eq!(args["timeoutSeconds"], 2);
        assert_eq!(
            args["resolved_cwd"].as_str(),
            Some(
                workspace
                    .path()
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );

        let allow_line = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": session_id.clone(),
                "approvalId": approval_id.clone(),
                "decision": "allow_once"
            },
            "requestId": "native-code-run-allow"
        })
        .to_string();
        let allow_resp = expect_unary(dispatch_line(&allow_line, None, &mgr).await);
        assert!(allow_resp.ok, "response: {allow_resp:?}");
        let allow_result = allow_resp.result.expect("result");
        assert_eq!(allow_result["dispatch"], "completed_native_approval");
        assert_eq!(allow_result["session"]["status"], "idle");
        assert_eq!(
            allow_result["assistantMessage"]["finalAnswer"],
            final_answer
        );
        assert_eq!(allow_result["toolResult"]["toolName"], "code_run");
        assert_eq!(allow_result["toolResult"]["status"], "success");
        assert_eq!(
            allow_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(true)
        );
        let content = allow_result["toolResult"]["content"].as_str().unwrap();
        assert!(content.contains("exit_code: 0"));
        assert!(content.contains("stdout:"));
        assert!(content.contains("hi"));

        let tool_row: (String, String) =
            sqlx::query_as("SELECT status, approval_decision FROM tool_events WHERE id = ?")
                .bind(&approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(tool_row, ("success".into(), "allow_once".into()));
        let (assistant_final_answer, tool_results_raw): (String, String) = sqlx::query_as(
            "SELECT final_answer, tool_results FROM messages WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&session_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(assistant_final_answer, final_answer);
        let tool_results: serde_json::Value = serde_json::from_str(&tool_results_raw).unwrap();
        assert_eq!(tool_results[0]["toolName"], "code_run");
        assert_eq!(tool_results[0]["status"], "success");
        assert_eq!(tool_results[0]["sideEffectsPerformed"], true);

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-code-run-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        let mut saw_stdout_progress = false;
        let mut saw_continuation_progress = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    kinds.push(event.kind());
                    if value["kind"] == "tool_progress" && value["stream"] == "stdout" {
                        assert_eq!(value["toolName"], "code_run");
                        assert_eq!(value["delta"], "hi\n");
                        assert_eq!(value["truncated"], false);
                        saw_stdout_progress = true;
                    }
                    if value["kind"] == "tool_end" {
                        assert_eq!(value["toolName"], "code_run");
                        assert_eq!(value["status"], "success");
                        assert_eq!(value["sideEffectsPerformed"], true);
                    }
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["source"], "model_continuation");
                        assert_eq!(value["delta"], final_answer);
                        saw_continuation_progress = true;
                    }
                    if value["kind"] == "turn_end" {
                        assert_eq!(value["responseContent"], final_answer);
                        assert_eq!(value["toolResults"][0]["toolName"], "code_run");
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "CURRENT_TASK_DONE");
                        assert_eq!(
                            value["exitReason"]["data"]["mode"],
                            "approval_response_continuation"
                        );
                        assert_eq!(value["finalContent"], final_answer);
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "approval_resolved",
                "tool_start",
                "tool_progress",
                "tool_progress",
                "tool_end",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert!(saw_stdout_progress);
        assert!(saw_continuation_progress);
    }

    #[tokio::test]
    async fn dispatch_session_approval_response_native_allows_and_denies_pending_tool() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let tool_answer = r#"```json
{"tool":"start_long_term_update","arguments":{"topic":"learn approval","risk":"high"}}
```"#;
        let api_base = start_fake_openai_sequence_server(vec![
            ("Allow risky tool", tool_answer.to_string()),
            ("Deny risky tool", tool_answer.to_string()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_approval_openai".into(),
                display_name: "Native Approval OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_approval_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_approval_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_approval_openai".into(),
                provider_id: "mp_native_approval_openai".into(),
                display_name: "Native Approval Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db_path)
                    .create_if_missing(false),
            )
            .await
            .unwrap();
        let mgr = RunnerManager::new();

        let allow_line = r#"{
            "command":"session.new",
            "args":{
                "task":"Allow risky tool",
                "runtimeKind":"galley_native",
                "llmName":"Native Approval Model"
            },
            "requestId":"native-approval-allow-new"
        }"#;
        let allow_new = expect_unary(dispatch_line(allow_line, None, &mgr).await);
        assert!(allow_new.ok, "response: {allow_new:?}");
        let allow_session_id = allow_new.result.as_ref().unwrap()["session"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let allow_approval_id: String =
            sqlx::query_scalar("SELECT id FROM tool_events WHERE session_id = ?")
                .bind(&allow_session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let allow_response = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": allow_session_id,
                "approvalId": allow_approval_id,
                "decision": "allow_once"
            },
            "requestId": "native-approval-allow"
        })
        .to_string();
        let allow_resp = expect_unary(dispatch_line(&allow_response, None, &mgr).await);
        assert!(allow_resp.ok, "response: {allow_resp:?}");
        let allow_result = allow_resp.result.expect("result");
        assert_eq!(allow_result["dispatch"], "completed_native_approval");
        assert_eq!(allow_result["session"]["status"], "idle");
        assert_eq!(
            allow_result["toolResult"]["status"],
            "stub_long_term_update_deferred"
        );
        assert_eq!(
            allow_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(false)
        );
        let allow_tool_row: (String, String) =
            sqlx::query_as("SELECT status, approval_decision FROM tool_events WHERE id = ?")
                .bind(&allow_approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(allow_tool_row, ("success".into(), "allow_once".into()));
        let allow_pending_count: i64 =
            sqlx::query_scalar("SELECT pending_approval_count FROM sessions WHERE id = ?")
                .bind(&allow_session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(allow_pending_count, 0);

        let allow_watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": allow_session_id },
            "requestId": "native-approval-allow-watch"
        })
        .to_string();
        let allow_watch = dispatch_line(&allow_watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = allow_watch else {
            panic!("expected native stream");
        };
        let mut kinds = Vec::new();
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    kinds.push(event.kind());
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(
            kinds,
            vec![
                "approval_resolved",
                "tool_start",
                "tool_progress",
                "tool_end",
                "run_complete"
            ]
        );

        let deny_line = r#"{
            "command":"session.new",
            "args":{
                "task":"Deny risky tool",
                "runtimeKind":"galley_native",
                "llmName":"Native Approval Model"
            },
            "requestId":"native-approval-deny-new"
        }"#;
        let deny_new = expect_unary(dispatch_line(deny_line, None, &mgr).await);
        assert!(deny_new.ok, "response: {deny_new:?}");
        let deny_session_id = deny_new.result.as_ref().unwrap()["session"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let deny_approval_id: String =
            sqlx::query_scalar("SELECT id FROM tool_events WHERE session_id = ?")
                .bind(&deny_session_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let deny_response = serde_json::json!({
            "command": "session.approval_response",
            "args": {
                "sessionId": deny_session_id,
                "approvalId": deny_approval_id,
                "decision": "deny"
            },
            "requestId": "native-approval-deny"
        })
        .to_string();
        let deny_resp = expect_unary(dispatch_line(&deny_response, None, &mgr).await);
        assert!(deny_resp.ok, "response: {deny_resp:?}");
        let deny_result = deny_resp.result.expect("result");
        assert_eq!(deny_result["session"]["status"], "idle");
        assert_eq!(deny_result["toolResult"]["status"], "denied");
        assert_eq!(
            deny_result["toolResult"]["sideEffectsPerformed"].as_bool(),
            Some(false)
        );
        let deny_tool_row: (String, String) =
            sqlx::query_as("SELECT status, approval_decision FROM tool_events WHERE id = ?")
                .bind(&deny_approval_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(deny_tool_row, ("denied".into(), "deny".into()));
    }

    #[tokio::test]
    async fn dispatch_session_send_native_runs_follow_up_turn() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let api_base = start_fake_openai_sequence_server(vec![
            ("First native turn", "First native answer".to_string()),
            ("Second native turn", "Second native answer".to_string()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_send_openai".into(),
                display_name: "Native Send OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_send_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_send_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_send_openai".into(),
                provider_id: "mp_native_send_openai".into(),
                display_name: "Native Send Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let new_line = r#"{
            "command":"session.new",
            "args":{
                "task":"First native turn",
                "runtimeKind":"galley_native",
                "llmName":"Native Send Model"
            },
            "requestId":"native-send-new"
        }"#;
        let new_resp = expect_unary(dispatch_line(new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(
            new_result["assistantMessage"]["finalAnswer"],
            "First native answer"
        );
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();

        let send_line = serde_json::json!({
            "command": "session.send",
            "args": {
                "sessionId": session_id,
                "content": "Second native turn"
            },
            "requestId": "native-send-follow-up"
        })
        .to_string();
        let send_resp = expect_unary(dispatch_line(&send_line, None, &mgr).await);
        assert!(send_resp.ok, "response: {send_resp:?}");
        let send_result = send_resp.result.expect("result");
        assert_eq!(send_result["dispatch"], "completed_native");
        assert_eq!(
            send_result["assistantMessage"]["finalAnswer"],
            "Second native answer"
        );
        assert_eq!(send_result["session"]["status"], "idle");
        assert_eq!(send_result["session"]["turnCount"], 2);

        let session_id = send_result["session"]["id"].as_str().unwrap().to_string();
        let messages = galley
            .session_messages(SessionId(session_id.clone()), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2].content, "Second native turn");
        assert_eq!(
            messages[3].final_answer.as_deref(),
            Some("Second native answer")
        );

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-send-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut saw_second_progress = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "turn_progress" {
                        assert_eq!(value["delta"], "Second native answer");
                        saw_second_progress = true;
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert!(saw_second_progress);
    }

    #[tokio::test]
    async fn dispatch_session_send_native_running_session_is_occupied_without_write() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let galley = SqliteGalley::open().await.unwrap();
        let session_id = SessionId("s-native-occupied".into());
        galley
            .create_session(
                CreateSessionInput {
                    id: session_id.as_str().to_string(),
                    title: "Occupied native".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(RuntimeKind::GalleyNative),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::cli(None, Some("occupied test".into())),
            )
            .await
            .unwrap();
        galley
            .set_native_session_running(session_id.clone())
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let send_line = serde_json::json!({
            "command": "session.send",
            "args": {
                "sessionId": session_id.as_str(),
                "content": "Should not be persisted"
            },
            "requestId": "native-occupied-send"
        })
        .to_string();
        let send_resp = expect_unary(dispatch_line(&send_line, None, &mgr).await);

        assert!(!send_resp.ok);
        assert_eq!(send_resp.error.as_deref(), Some("session_occupied"));
        assert!(send_resp
            .message
            .as_deref()
            .unwrap()
            .contains("copy-and-continue"));
        assert!(galley
            .session_messages(session_id, None)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn dispatch_session_copy_to_native_copies_visible_context_only() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");

        let galley = SqliteGalley::open().await.unwrap();
        let raw_pool = sqlx::SqlitePool::connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(false),
        )
        .await
        .unwrap();
        galley
            .create_project(
                CreateProjectInput {
                    id: "p1".into(),
                    name: "Copy Project".into(),
                    root_path: None,
                    icon: None,
                    color: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        let source_session_id = SessionId("s-managed-copy-source".into());
        galley
            .create_session(
                CreateSessionInput {
                    id: source_session_id.as_str().to_string(),
                    title: "Managed source".into(),
                    project_id: Some("p1".into()),
                    selected_llm_index: Some(2),
                    selected_llm_key: Some("managed-model-key".into()),
                    selected_llm_display_name: Some("Managed Model".into()),
                    ga_runtime_kind: Some(RuntimeKind::Managed),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::cli(None, Some("copy source".into())),
            )
            .await
            .unwrap();
        galley
            .send_message(
                source_session_id.clone(),
                "Visible user context".into(),
                Origin::cli(None, Some("visible user".into())),
            )
            .await
            .unwrap();
        galley
            .persist_gui_assistant_message(crate::db::PersistAssistantMessage {
                session_id: source_session_id.clone(),
                turn_index: 0,
                content: "Visible assistant context".into(),
                tool_calls: None,
                tool_results: None,
                thinking: None,
                final_answer: Some("Visible assistant context".into()),
                summary: Some("assistant summary".into()),
                preamble: None,
                visibility: MessageVisibility::Visible,
            })
            .await
            .unwrap();
        galley
            .send_message_with_visibility(
                source_session_id.clone(),
                "Internal-only note".into(),
                Origin::cli(None, Some("internal".into())),
                MessageVisibility::Internal,
            )
            .await
            .unwrap();
        sqlx::query("UPDATE sessions SET summary = ?, turn_count = ? WHERE id = ?")
            .bind("source summary")
            .bind(3_i64)
            .bind(source_session_id.as_str())
            .execute(&raw_pool)
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let copy_line = serde_json::json!({
            "command": "session.copy_to_native",
            "args": {
                "sessionId": source_session_id.as_str(),
                "supervisor": "slice6-test",
                "reason": "copy managed to native"
            },
            "requestId": "copy-to-native"
        })
        .to_string();
        let copy_resp = expect_unary(dispatch_line(&copy_line, None, &mgr).await);
        assert!(copy_resp.ok, "response: {copy_resp:?}");
        let result = copy_resp.result.expect("result");
        assert_eq!(result["dispatch"], "copied_to_native");
        assert_eq!(result["sourceSessionId"], source_session_id.as_str());
        assert_eq!(result["copiedMessages"], 2);
        assert_eq!(result["session"]["gaRuntimeKind"], "galley_native");
        assert_eq!(result["session"]["projectId"], "p1");
        assert_eq!(result["session"]["selectedLlmKey"], "managed-model-key");
        assert_eq!(result["session"]["turnCount"], 3);
        assert_eq!(result["session"]["summary"], "source summary");
        let native_session_id = result["session"]["id"].as_str().unwrap().to_string();

        let source_messages = galley
            .session_messages_including_internal(source_session_id.clone(), None)
            .await
            .unwrap();
        assert_eq!(source_messages.len(), 3);

        let native_messages = galley
            .session_messages(SessionId(native_session_id.clone()), None)
            .await
            .unwrap();
        assert_eq!(native_messages.len(), 2);
        assert_eq!(native_messages[0].content, "Visible user context");
        assert_eq!(
            native_messages[1].final_answer.as_deref(),
            Some("Visible assistant context")
        );
        assert!(native_messages
            .iter()
            .all(|message| message.content != "Internal-only note"));

        let copied_fts_hits: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts WHERE session_id = ?")
                .bind(&native_session_id)
                .fetch_one(&raw_pool)
                .await
                .unwrap();
        assert_eq!(copied_fts_hits, 2);
    }

    #[tokio::test]
    async fn dispatch_session_send_native_resumes_after_ask_user() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let ask_answer = r#"```json
{"tool":"ask_user","arguments":{"question":"Which workspace should I use?","candidates":["A","B"]}}
```"#;
        let api_base = start_fake_openai_sequence_server(vec![
            ("Need input", ask_answer.to_string()),
            ("Use workspace A", "Continuing with workspace A".to_string()),
        ])
        .await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_ask_openai".into(),
                display_name: "Native Ask OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_ask_openai".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_ask_openai",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_ask_openai".into(),
                provider_id: "mp_native_ask_openai".into(),
                display_name: "Native Ask Model".into(),
                model: "gpt-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let new_line = r#"{
            "command":"session.new",
            "args":{
                "task":"Need input",
                "runtimeKind":"galley_native",
                "llmName":"Native Ask Model"
            },
            "requestId":"native-ask-new"
        }"#;
        let new_resp = expect_unary(dispatch_line(new_line, None, &mgr).await);
        assert!(new_resp.ok, "response: {new_resp:?}");
        let new_result = new_resp.result.expect("result");
        assert_eq!(new_result["dispatch"], "completed_native");
        assert_eq!(new_result["session"]["status"], "waiting_approval");
        assert_eq!(new_result["assistantMessage"]["finalAnswer"], ask_answer);
        let session_id = new_result["session"]["id"].as_str().unwrap().to_string();

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": session_id },
            "requestId": "native-ask-watch"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut saw_ask_user = false;
        let mut saw_waiting_exit = false;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "ask_user" {
                        assert_eq!(value["question"], "Which workspace should I use?");
                        assert_eq!(value["candidates"], serde_json::json!(["A", "B"]));
                        saw_ask_user = true;
                    }
                    if value["kind"] == "run_complete" {
                        assert_eq!(value["exitReason"]["result"], "ASK_USER");
                        saw_waiting_exit = true;
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_waiting_user");
                    break;
                }
            }
        }
        assert!(saw_ask_user);
        assert!(saw_waiting_exit);

        let send_line = serde_json::json!({
            "command": "session.send",
            "args": {
                "sessionId": session_id,
                "content": "Use workspace A"
            },
            "requestId": "native-ask-resume"
        })
        .to_string();
        let send_resp = expect_unary(dispatch_line(&send_line, None, &mgr).await);
        assert!(send_resp.ok, "response: {send_resp:?}");
        let send_result = send_resp.result.expect("result");
        assert_eq!(send_result["dispatch"], "completed_native");
        assert_eq!(send_result["session"]["status"], "idle");
        assert_eq!(send_result["session"]["turnCount"], 2);
        assert_eq!(
            send_result["assistantMessage"]["finalAnswer"],
            "Continuing with workspace A"
        );
    }

    #[tokio::test]
    async fn dispatch_session_new_native_streams_openai_deltas() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let api_base = start_fake_openai_stream_server().await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_stream".into(),
                display_name: "Native Stream OpenAI".into(),
                protocol: crate::api::ManagedModelProtocol::Openai,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_stream".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_stream",
            "sk-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_stream".into(),
                provider_id: "mp_native_stream".into(),
                display_name: "Native Stream Model".into(),
                model: "gpt-test-stream".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5,
                    "stream": true
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Stream from configured model",
                "runtimeKind":"galley_native"
            },
            "requestId":"native-stream-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(
            result["assistantMessage"]["finalAnswer"],
            "Native stream answer"
        );

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let messages = galley
            .session_messages(SessionId(session_id), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[1].final_answer.as_deref(),
            Some("Native stream answer")
        );

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": result["session"]["id"].as_str().unwrap() },
            "requestId": "native-stream-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut deltas = Vec::new();
        let mut stop_reason = None;
        let mut usage_total = None;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "turn_progress" {
                        deltas.push(value["delta"].as_str().unwrap().to_string());
                        assert_eq!(value["source"], "model_stream");
                    }
                    if value["kind"] == "run_complete" {
                        stop_reason = value["stopReason"].as_str().map(str::to_string);
                        usage_total = value["usage"]["total_tokens"].as_u64();
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(deltas, vec!["Native ", "stream ", "answer"]);
        assert_eq!(stop_reason.as_deref(), Some("stop"));
        assert_eq!(usage_total, Some(11));
    }

    #[tokio::test]
    async fn dispatch_session_new_native_uses_configured_anthropic_model() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let api_base = start_fake_anthropic_server("Claude real model answer").await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_anthropic_nonstream".into(),
                display_name: "Native Anthropic".into(),
                protocol: crate::api::ManagedModelProtocol::Anthropic,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_anthropic_nonstream".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_anthropic_nonstream",
            "sk-ant-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_anthropic_nonstream".into(),
                provider_id: "mp_native_anthropic_nonstream".into(),
                display_name: "Native Claude Nonstream".into(),
                model: "claude-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Answer from Anthropic model",
                "runtimeKind":"galley_native",
                "llmName":"Native Claude Nonstream"
            },
            "requestId":"native-anthropic-nonstream-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(
            result["assistantMessage"]["finalAnswer"],
            "Claude real model answer"
        );
    }

    #[tokio::test]
    async fn dispatch_session_new_native_streams_anthropic_deltas() {
        let _env_lock = socket_env_lock().lock().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("workbench.db");
        seed_socket_test_db(&db_path).await;
        let _db_guard = EnvGuard::set("GALLEY_DB_PATH", db_path.as_os_str());
        let _native_guard = EnvGuard::set(crate::runtime::GALLEY_NATIVE_EXPERIMENTAL_ENV, "1");
        let api_base = start_fake_anthropic_stream_server().await;

        let galley = SqliteGalley::open().await.unwrap();
        galley
            .upsert_managed_model_provider_metadata(crate::db::UpsertManagedModelProviderMetadata {
                id: "mp_native_anthropic".into(),
                display_name: "Native Anthropic".into(),
                protocol: crate::api::ManagedModelProtocol::Anthropic,
                auth_kind: crate::api::ManagedModelAuthKind::ApiKey,
                api_base,
                api_key_ref: "managed-provider:mp_native_anthropic".into(),
            })
            .await
            .unwrap();
        crate::credential_store::set_secret(
            &galley,
            "managed-provider:mp_native_anthropic",
            "sk-ant-native-test",
        )
        .await
        .unwrap();
        galley
            .upsert_managed_model_metadata(crate::db::UpsertManagedModelMetadata {
                id: "mm_native_anthropic".into(),
                provider_id: "mp_native_anthropic".into(),
                display_name: "Native Claude".into(),
                model: "claude-test".into(),
                advanced_options: serde_json::json!({
                    "temperature": 1,
                    "max_tokens": 64,
                    "read_timeout": 5,
                    "stream": true
                }),
                make_default: true,
            })
            .await
            .unwrap();

        let mgr = RunnerManager::new();
        let line = r#"{
            "command":"session.new",
            "args":{
                "task":"Stream from Anthropic model",
                "runtimeKind":"galley_native",
                "llmName":"Native Claude"
            },
            "requestId":"native-anthropic-r1"
        }"#;
        let resp = expect_unary(dispatch_line(line, None, &mgr).await);
        assert!(resp.ok, "response: {resp:?}");
        let result = resp.result.expect("result");
        assert_eq!(
            result["assistantMessage"]["finalAnswer"],
            "Claude stream answer"
        );

        let session_id = result["session"]["id"].as_str().unwrap().to_string();
        let messages = galley
            .session_messages(SessionId(session_id), None)
            .await
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[1].final_answer.as_deref(),
            Some("Claude stream answer")
        );

        let watch_line = serde_json::json!({
            "command": "session.watch",
            "args": { "sessionId": result["session"]["id"].as_str().unwrap() },
            "requestId": "native-anthropic-watch-r1"
        })
        .to_string();
        let watch = dispatch_line(&watch_line, None, &mgr).await;
        let DispatchResult::NativeStream { mut rx, .. } = watch else {
            panic!("expected native stream");
        };
        let mut deltas = Vec::new();
        let mut stop_reason = None;
        let mut usage_output = None;
        while let Some(item) = rx.recv().await {
            match item {
                crate::native_runtime::NativeRuntimeStreamItem::Event(event) => {
                    let value = serde_json::to_value(&*event).unwrap();
                    if value["kind"] == "turn_progress" {
                        deltas.push(value["delta"].as_str().unwrap().to_string());
                        assert_eq!(value["source"], "model_stream");
                    }
                    if value["kind"] == "run_complete" {
                        stop_reason = value["stopReason"].as_str().map(str::to_string);
                        usage_output = value["usage"]["output_tokens"].as_u64();
                    }
                }
                crate::native_runtime::NativeRuntimeStreamItem::Closed { reason } => {
                    assert_eq!(reason, "native_run_complete");
                    break;
                }
            }
        }
        assert_eq!(deltas, vec!["Claude ", "stream ", "answer"]);
        assert_eq!(stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(usage_output, Some(6));
    }

    async fn start_fake_openai_server(answer: &'static str) -> String {
        start_fake_openai_server_for("Answer from configured model", answer.to_string()).await
    }

    async fn start_fake_openai_server_for(expected_task: &'static str, answer: String) -> String {
        start_fake_openai_sequence_server(vec![(expected_task, answer)]).await
    }

    async fn start_fake_openai_sequence_server(responses: Vec<(&'static str, String)>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for (expected_task, answer) in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = vec![0_u8; 8192];
                let n = socket.read(&mut buf).await.unwrap();
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let request_lower = request.to_ascii_lowercase();
                assert!(request.starts_with("POST /v1/chat/completions "));
                assert!(request_lower.contains("authorization: bearer sk-native-test"));
                assert!(request.contains("\"model\":\"gpt-test\""));
                assert!(request.contains(expected_task));
                let is_stream = request.contains("\"stream\":true");
                assert!(is_stream || request.contains("\"stream\":false"));

                let response = if is_stream {
                    let event = serde_json::json!({
                        "model": "gpt-test",
                        "choices": [
                            {
                                "delta": { "content": answer },
                                "finish_reason": "stop"
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 4,
                            "completion_tokens": 5,
                            "total_tokens": 9
                        }
                    })
                    .to_string();
                    let body = format!("data: {event}\n\ndata: [DONE]\n\n");
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                } else {
                    let body = serde_json::json!({
                        "model": "gpt-test",
                        "choices": [
                            {
                                "message": { "role": "assistant", "content": answer },
                                "finish_reason": "stop"
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 4,
                            "completion_tokens": 5,
                            "total_tokens": 9
                        }
                    })
                    .to_string();
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                };
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        format!("http://{addr}")
    }

    async fn start_fake_openai_stream_server() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0_u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let request_lower = request.to_ascii_lowercase();
            assert!(request.starts_with("POST /v1/chat/completions "));
            assert!(request_lower.contains("authorization: bearer sk-native-test"));
            assert!(request.contains("\"model\":\"gpt-test-stream\""));
            assert!(request.contains("Stream from configured model"));
            assert!(request.contains("\"stream\":true"));

            let body = concat!(
                "data: {\"model\":\"gpt-test-stream\",\"choices\":[{\"delta\":{\"content\":\"Native \"},\"finish_reason\":null}]}\n\n",
                "data: {\"model\":\"gpt-test-stream\",\"choices\":[{\"delta\":{\"content\":\"stream \"},\"finish_reason\":null}]}\n\n",
                "data: {\"model\":\"gpt-test-stream\",\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"answer\"}]},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":6,\"total_tokens\":11}}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n{:X}\r\n{}\r\n0\r\n\r\n",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{addr}")
    }

    async fn start_fake_anthropic_server(answer: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0_u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let request_lower = request.to_ascii_lowercase();
            assert!(request.starts_with("POST /v1/messages?beta=true "));
            assert!(request_lower.contains("x-api-key: sk-ant-native-test"));
            assert!(request_lower.contains("anthropic-version: 2023-06-01"));
            assert!(request.contains("\"model\":\"claude-test\""));
            assert!(request.contains("Answer from Anthropic model"));
            assert!(request.contains("\"stream\":false"));

            let body = serde_json::json!({
                "model": "claude-test",
                "content": [
                    { "type": "text", "text": answer }
                ],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 4,
                    "output_tokens": 5
                }
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{addr}")
    }

    async fn start_fake_anthropic_stream_server() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0_u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let request_lower = request.to_ascii_lowercase();
            assert!(request.starts_with("POST /v1/messages?beta=true "));
            assert!(request_lower.contains("x-api-key: sk-ant-native-test"));
            assert!(request_lower.contains("anthropic-version: 2023-06-01"));
            assert!(request.contains("\"model\":\"claude-test\""));
            assert!(request.contains("Stream from Anthropic model"));
            assert!(request.contains("\"stream\":true"));

            let body = concat!(
                "event: message_start\n",
                "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-test\",\"usage\":{\"input_tokens\":5}}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Claude \"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"stream \"}}\n\n",
                "event: content_block_delta\n",
                "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"answer\"}}\n\n",
                "event: message_delta\n",
                "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":6}}\n\n",
                "event: message_stop\n",
                "data: {\"type\":\"message_stop\"}\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n{:X}\r\n{}\r\n0\r\n\r\n",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{addr}")
    }

    #[test]
    fn socket_guard_dormant_does_nothing_on_drop() {
        let guard = SocketGuard::dormant();
        assert!(!guard.is_active());
        drop(guard); // no panic, no side effect
    }
}
