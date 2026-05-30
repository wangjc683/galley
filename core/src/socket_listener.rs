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
//! Per [CLAUDE.md Galley 架构原则 #1](../../CLAUDE.md), Galley Core never
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

use crate::api::message::MessageBrief;
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
    BroadcastItem, RunnerManager, RunnerSpawnError, SendCommandError, SpawnArgs,
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

/// Wire-level schema version. Stable across additive changes; bumped on
/// breaking schema changes (and old-version clients use `?schema=1` to opt
/// into legacy framing — same convention as [docs/agent-api.md]).
pub const SCHEMA_VERSION: u32 = 1;

/// Per-connection idle timeout. 90s gives interactive shell scripts enough
/// breathing room; long-running watch subscriptions don't count as idle
/// because they push data continuously.
pub const CONNECTION_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRequest {
    /// Dotted command name. Examples: `"sessions.list"`, `"session.brief"`.
    pub command: String,
    /// Command-specific args. Each command's handler parses this further.
    #[serde(default)]
    pub args: Value,
    /// Client-chosen id for demuxing in mixed request/stream sessions.
    #[serde(default)]
    pub request_id: Option<String>,
    /// Schema version the client expects. Server checks for compatibility.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl SocketResponse {
    fn ok(request_id: Option<String>, result: Value) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(result),
            error: None,
            message: None,
        }
    }

    fn err(
        request_id: Option<String>,
        error: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            ok: false,
            request_id,
            result: None,
            error: Some(error.into()),
            message: Some(message.into()),
        }
    }
}

// ---------------- shared dispatch helpers (B4 M1) ----------------

/// Build an [`Origin`] from the supervisor + reason flags that every
/// write socket command accepts. `via` flips to `Supervisor` when a
/// supervisor label is present; otherwise `Cli`. Used by all B4 M1
/// write handlers (`session.new` / `session.btw` / `session.stop` /
/// `session.archive` / `session.restore` / `session.move` /
/// `project.create` / `project.delete`) so the rule lives in one place.
fn origin_from_args(supervisor: Option<String>, reason: Option<String>) -> Origin {
    Origin {
        via: if supervisor.is_some() {
            OriginVia::Supervisor
        } else {
            OriginVia::Cli
        },
        supervisor,
        reason,
    }
}

/// Map a [`GalleyError`] onto the wire `SocketResponse` envelope.
/// Each variant gets its own stable `error` discriminant string so
/// `cli/src/main.rs::map_error_tag` can round-trip back to a typed
/// error (and `exit_code_for` lands on the right exit category).
fn map_galley_err(request_id: Option<String>, err: crate::error::GalleyError) -> SocketResponse {
    use crate::error::GalleyError;
    match err {
        GalleyError::NotFound { message } => SocketResponse::err(request_id, "not_found", message),
        GalleyError::InvalidArgs { message } => {
            SocketResponse::err(request_id, "invalid_args", message)
        }
        GalleyError::DbUnavailable { message } => {
            SocketResponse::err(request_id, "db_unavailable", message)
        }
        GalleyError::RunnerError { message } => {
            SocketResponse::err(request_id, "runner_error", message)
        }
        GalleyError::Internal { message } => SocketResponse::err(request_id, "internal", message),
    }
}

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
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEnvelope {
    stream: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl StreamEnvelope {
    fn event(request_id: Option<String>, data: Value) -> Self {
        Self {
            stream: "event",
            request_id,
            data: Some(data),
            reason: None,
        }
    }
    fn end(request_id: Option<String>, reason: &str) -> Self {
        Self {
            stream: "end",
            request_id,
            data: None,
            reason: Some(reason.to_string()),
        }
    }
}

async fn write_stream_line<W: tokio::io::AsyncWrite + Unpin>(
    w: &mut W,
    env: &StreamEnvelope,
) -> std::io::Result<()> {
    let line = serde_json::to_string(env).unwrap_or_default();
    w.write_all(line.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await?;
    Ok(())
}

/// Output of [`dispatch_line`]. Most commands return a single response
/// (Unary); `session.watch` returns a Stream of broadcast events.
enum DispatchResult {
    Unary(SocketResponse),
    Stream {
        request_id: Option<String>,
        rx: broadcast::Receiver<BroadcastItem>,
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
        "session.watch" => dispatch_session_watch(request_id, req.args, manager).await,
        // ---- B4 M1 session write commands ----
        "session.new" => {
            DispatchResult::Unary(dispatch_session_new(request_id, req.args, app, manager).await)
        }
        "session.btw" => {
            DispatchResult::Unary(dispatch_session_btw(request_id, req.args, manager).await)
        }
        "session.stop" => {
            DispatchResult::Unary(dispatch_session_stop(request_id, req.args, manager).await)
        }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSendArgs {
    session_id: String,
    content: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionWatchArgs {
    session_id: String,
}

/// Tauri event payload broadcast to the GUI whenever a user message is
/// persisted via the socket path (CLI `galley session send` / supervisor
/// agents). GUI's listener calls `appendUserTurnExternal` to mirror the
/// row into the in-memory store so the conversation view renders the
/// message even though it wasn't typed in the Composer.
///
/// The GUI's own Composer path skips this — it persists locally via
/// `persistUserMessage` and mutates the store synchronously, so emitting
/// here would double-render.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserMessagePersistedPayload {
    session_id: String,
    message: MessageBrief,
    /// Whether the persisted message reached a runner in this command.
    /// GUI uses this to avoid showing "thinking" for saved-but-not-run
    /// messages.
    dispatch: &'static str,
}

/// Tauri event payload broadcast when the socket transport starts a
/// runner itself (currently `session.new`). The GUI attaches listeners
/// to this already-alive bridge so assistant events render/persist the
/// same way as GUI-spawned bridges.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RunnerSpawnedExternalPayload {
    session_id: String,
    pid: u32,
    via: &'static str,
}

async fn dispatch_session_send(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionSendArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.send args: {e}"),
            );
        }
    };
    // 1. Open DB + write message row with origin = cli/supervisor
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message(session_id, parsed.content.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    // 2. Best-effort dispatch to runner. If the session's runner isn't
    // alive (LRU evicted, never spawned, crashed), the message is still
    // persisted in the DB — caller can `galley session watch` and wait
    // for a future spawn / replay path. We surface the runner result in
    // the response so callers know whether the message reached the
    // subprocess this turn.
    let dispatch_status = match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: parsed.content,
                images: vec![],
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(_) => "persisted_only",
    };

    // Notify GUI so the conversation view picks up the new user row.
    // Emit covers both `dispatched` and `persisted_only` — the user
    // message exists in the DB either way, and the GUI must mirror it.
    // Best-effort: emit failure (no listeners registered yet, or app
    // handle gone) does not roll back the persist + dispatch above.
    if let Some(app) = app {
        let payload = UserMessagePersistedPayload {
            session_id: brief.session_id.0.clone(),
            message: brief.clone(),
            dispatch: dispatch_status,
        };
        let _ = app.emit("user-message-persisted", payload);
    }

    let result = serde_json::json!({
        "message": brief,
        "dispatch": dispatch_status,
    });
    SocketResponse::ok(request_id, result)
}

async fn dispatch_session_watch(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> DispatchResult {
    let parsed: SessionWatchArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return DispatchResult::Unary(SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.watch args: {e}"),
            ));
        }
    };
    match manager.subscribe(&parsed.session_id).await {
        Some(rx) => DispatchResult::Stream { request_id, rx },
        None => DispatchResult::Unary(SocketResponse::err(
            request_id,
            "not_found",
            format!("no live runner for session {}", parsed.session_id),
        )),
    }
}

// ---------------- B4 M1 · session write handlers ----------------
//
// All six new handlers share the same shape:
//   1. parse args (camelCase JSON from CLI / supervisor)
//   2. open SqliteGalley (db_unavailable on connect fail)
//   3. validate / execute via GalleyApi trait
//   4. on side-effecting state changes, emit a Tauri event so the GUI
//      can mirror the row into its in-memory stores without polling
//
// `session.new` is the only handler that needs the runner_manager AND a
// SQLite transaction (create + first message commit together, then a
// runner is spawned for true delegation). `session.btw` and `session.stop`
// drive the runner but don't persist anything new. `session.archive`,
// `session.restore`, `session.move` are thin GalleyApi wrappers.

/// Tauri event payload broadcast when a CLI / supervisor creates a new
/// session via `session.new`. GUI's sidebar listener inserts the row
/// without a list_sessions round-trip.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionExternalPayload {
    session: SessionBrief,
    /// Stable discriminant so a single listener can demultiplex multiple
    /// event types if we collapse the four event names into one in the
    /// future. Kept now for symmetry with `user-message-persisted`.
    via: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionNewArgs {
    task: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    llm_name: Option<String>,
    #[serde(default)]
    runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GaConfigPref {
    #[serde(default)]
    python: Option<String>,
    #[serde(default)]
    ga_path: Option<String>,
    #[serde(default)]
    bridge_cwd: Option<String>,
    #[serde(default)]
    use_external_python: Option<bool>,
}

async fn spawn_args_for_session_new(
    galley: &SqliteGalley,
    app: Option<&AppHandle>,
    session_id: &str,
    llm_index: Option<u32>,
    llm_key: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<SpawnArgs, SocketResponseLite> {
    if runtime_kind == RuntimeKind::Managed {
        let app = app.ok_or_else(|| {
            SocketResponseLite::runner_error(
                "managed runtime is unavailable without a Galley app handle",
            )
        })?;
        let args = SpawnArgs {
            python: resolve_python_for_socket(&GaConfigPref::default(), Some(app))?,
            ga_path: PathBuf::new(),
            session_id: session_id.to_string(),
            cwd: None,
            bridge_cwd: PathBuf::new(),
            llm_index: llm_index.map(i64::from),
            llm_key,
            env: Vec::new(),
        };
        return prepare_managed_spawn_args(args, app)
            .await
            .map_err(SocketResponseLite::runner_spawn_error);
    }

    let raw = galley
        .get_pref_json("ga_config")
        .await
        .map_err(SocketResponseLite::from_err)?
        .ok_or_else(|| {
            SocketResponseLite::runner_error(
                "session.new runner config is missing; open Galley Settings once to save runtime paths",
            )
        })?;
    let config: GaConfigPref = serde_json::from_value(raw).map_err(|e| {
        SocketResponseLite::runner_error(format!("ga_config pref shape mismatch: {e}"))
    })?;
    let ga_path = normalize_external_ga_path(&PathBuf::from(non_empty_pref(
        config.ga_path.as_deref(),
        "gaPath",
    )?))
    .map_err(SocketResponseLite::runner_spawn_error)?;

    let bridge_cwd = resolve_bridge_cwd(&config, app)?;
    let python = resolve_python_for_socket(&config, app)?;

    Ok(SpawnArgs {
        python,
        ga_path,
        session_id: session_id.to_string(),
        cwd: None,
        bridge_cwd,
        llm_index: llm_index.map(i64::from),
        llm_key,
        env: Vec::new(),
    })
}

fn non_empty_pref(value: Option<&str>, key: &str) -> Result<String, SocketResponseLite> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Err(SocketResponseLite::runner_error(format!(
            "session.new runner config missing {key}"
        )));
    };
    Ok(v.to_string())
}

fn resolve_bridge_cwd(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<PathBuf, SocketResponseLite> {
    if let Some(app) = app {
        return managed_runtime::bridge_cwd_for_app(app).map_err(|e| {
            SocketResponseLite::runner_error(format!("resolving Galley bridge cwd failed: {e}"))
        });
    }
    let bridge_cwd = PathBuf::from(non_empty_pref(config.bridge_cwd.as_deref(), "bridgeCwd")?);
    if !bridge_cwd.is_dir() {
        return Err(SocketResponseLite::runner_error(format!(
            "bridge cwd invalid: not a directory: {}",
            bridge_cwd.display()
        )));
    }
    Ok(bridge_cwd)
}

fn resolve_python_for_socket(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<String, SocketResponseLite> {
    let want_bundled = !cfg!(debug_assertions) && !config.use_external_python.unwrap_or(false);
    if want_bundled {
        if let Some(app) = app {
            if let Ok(resource_dir) = app.path().resource_dir() {
                let rel = if cfg!(windows) {
                    "python/python.exe"
                } else {
                    "python/bin/python3"
                };
                return path_to_utf8(resource_dir.join(rel), "bundled python");
            }
        }
    }

    let fallback = default_python_name();
    let raw = config
        .python
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback);
    Ok(resolve_python_alias(raw).unwrap_or_else(|| fallback.to_string()))
}

fn default_python_name() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn resolve_python_alias(raw: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = match raw {
        "python-ga-venv" => format!("{home}/Documents/GenericAgent/.venv/bin/python"),
        "python-ga-venv-alt" => format!("{home}/Documents/GenericAgent/venv/bin/python"),
        "python-brew-arm" => "/opt/homebrew/bin/python3".to_string(),
        "python-brew-intel" => "/usr/local/bin/python3".to_string(),
        "python-framework-3-14" => {
            "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3".to_string()
        }
        "python-framework-3-13" => {
            "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3".to_string()
        }
        "python-framework-3-12" => {
            "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3".to_string()
        }
        "python-framework-3-11" => {
            "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3".to_string()
        }
        "python3" | "python" => raw.to_string(),
        p if p.starts_with('/') || p.starts_with('\\') || looks_like_windows_abs_path(p) => {
            p.to_string()
        }
        _ => return None,
    };
    Some(path)
}

fn looks_like_windows_abs_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn path_to_utf8(path: PathBuf, label: &str) -> Result<String, SocketResponseLite> {
    path.into_os_string().into_string().map_err(|_| {
        SocketResponseLite::runner_error(format!("{label} path contains non-UTF-8 characters"))
    })
}

fn emit_user_message_persisted(
    app: Option<&AppHandle>,
    session_id: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "user-message-persisted",
            UserMessagePersistedPayload {
                session_id: session_id.to_string(),
                message: message.clone(),
                dispatch,
            },
        );
    }
}

/// Atomically create a session + persist its first user message, then
/// spawn a runner and dispatch that first message. The DB writes still
/// commit together; runner failures after commit surface as `runner_error`
/// so callers know the delegated task did not actually start.
async fn dispatch_session_new(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionNewArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.new args: {e}"),
            );
        }
    };
    let task = parsed.task.trim().to_string();
    if task.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "session.new: task is empty");
    }

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    let active_runtime_kind = match galley.active_runtime_kind().await {
        Ok(kind) => kind,
        Err(e) => return map_galley_err(request_id, e),
    };
    let target_runtime_kind = parsed.runtime_kind.unwrap_or(active_runtime_kind);
    let runtime_warning = parsed
        .runtime_kind
        .filter(|requested| *requested != active_runtime_kind)
        .map(|requested| {
            serde_json::json!({
                "id": "non_current_runtime",
                "message": "session created outside the current GUI runtime",
                "currentRuntimeKind": active_runtime_kind,
                "requestedRuntimeKind": requested,
            })
        });

    // Resolve --llm=<name> against the selected runtime's current model
    // source. Managed runtime resolves Galley model records; external
    // runtime resolves the cached raw GA LLM list.
    let llm_selection =
        match resolve_llm_selection(&galley, parsed.llm_name, target_runtime_kind).await {
            Ok(selection) => selection,
            Err(resp) => return resp.with_request_id(request_id),
        };

    let id = mint_session_id();
    let spawn_args = match spawn_args_for_session_new(
        &galley,
        app,
        &id,
        llm_selection.index,
        llm_selection.key.clone(),
        target_runtime_kind,
    )
    .await
    {
        Ok(args) => args,
        Err(resp) => return resp.with_request_id(request_id),
    };

    let input = CreateSessionInput {
        id: id.clone(),
        title: DEFAULT_NEW_SESSION_TITLE.to_string(),
        project_id: parsed.project_id,
        selected_llm_index: llm_selection.index,
        selected_llm_key: llm_selection.key,
        selected_llm_display_name: llm_selection.display_name,
        ga_runtime_kind: Some(target_runtime_kind),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());

    // BEGIN — create + send_message in one transaction (sub-plan O1).
    let mut tx = match galley.begin_tx().await {
        Ok(t) => t,
        Err(e) => return map_galley_err(request_id, e),
    };
    let brief = match galley
        .create_session_in_tx(&mut tx, input, origin.clone())
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };
    let msg = match galley
        .send_message_in_tx(&mut tx, SessionId(brief.id.0.clone()), task.clone(), origin)
        .await
    {
        Ok(m) => m,
        Err(e) => return map_galley_err(request_id, e),
    };
    if let Err(e) = tx.commit().await {
        return SocketResponse::err(request_id, "internal", format!("session.new commit: {e}"));
    }

    // Notify GUI early so the sidebar can show the session while we
    // start the runner. The first message event is emitted below after
    // we know whether it actually reached the bridge.
    if let Some(app) = app {
        let payload = SessionExternalPayload {
            session: brief.clone(),
            via: "session.new",
        };
        let _ = app.emit("session-created-external", payload);
    }

    let pid = match manager.spawn(spawn_args, Some(&brief.id.0)).await {
        Ok(pid) => pid,
        Err(e) => {
            emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("session.new runner spawn: {e}"),
            );
        }
    };

    let Some(rx) = manager.subscribe(&brief.id.0).await else {
        emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
        return SocketResponse::err(
            request_id,
            "runner_error",
            "session.new runner subscribe failed after spawn",
        );
    };
    if let Some(app) = app {
        let _ = app.emit(
            "runner-spawned-external",
            RunnerSpawnedExternalPayload {
                session_id: brief.id.0.clone(),
                pid,
                via: "session.new",
            },
        );
        spawn_emit_task(app.clone(), brief.id.0.clone(), rx);
    }

    match manager
        .send_command(
            &brief.id.0,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: task,
                images: vec![],
            }),
        )
        .await
    {
        Ok(()) => {}
        Err(e) => {
            emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("session.new runner dispatch: {e}"),
            );
        }
    }

    emit_user_message_persisted(app, &brief.id.0, &msg, "dispatched");

    let mut result = serde_json::json!({
        "session": brief,
        "message": msg,
        "dispatch": "dispatched",
    });
    if let Some(warning) = runtime_warning {
        result["warning"] = warning;
    }
    SocketResponse::ok(request_id, result)
}

/// CLI sends `supervisor` / `reason` for symmetry with the other write
/// commands, but `session.btw` is transient (no DB persist per sub-plan
/// §1.5) so we don't act on them in M1. M7 will surface them in the
/// supervisor action log — wire them in there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SessionBtwArgs {
    session_id: String,
    question: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// "By the way" side-question. Bypasses the agent's run queue via the
/// runner's `/btw` prefix detection. Transient by design — not persisted
/// to the `messages` table (v0.1 decision; see [messages.ts:445-455]).
async fn dispatch_session_btw(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionBtwArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.btw args: {e}"),
            );
        }
    };
    let question = parsed.question.trim().to_string();
    if question.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "session.btw: question is empty");
    }

    // Validate session exists so a typo'd id surfaces as `not_found`
    // rather than silently failing through `send_command -> ProcessGone`.
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }

    // Drop the implicit reference to galley so we can drop the
    // borrowed pool before the runner await. (galley is owned, so the
    // explicit drop is cosmetic — but it keeps the boundary obvious.)
    drop(galley);

    let cmd = IpcCommand::UserMessage(UserMessageCommand {
        text: format!("/btw {question}"),
        images: vec![],
    });
    match manager.send_command(&parsed.session_id, &cmd).await {
        Ok(()) => SocketResponse::ok(request_id, serde_json::json!({ "dispatch": "dispatched" })),
        Err(SendCommandError::ProcessGone { .. }) => SocketResponse::err(
            request_id,
            "runner_error",
            format!(
                "no live runner for session {}; /btw requires an alive bridge",
                parsed.session_id
            ),
        ),
        Err(e) => SocketResponse::err(request_id, "runner_error", e.to_string()),
    }
}

/// Same as [`SessionBtwArgs`]: supervisor / reason accepted for CLI
/// surface symmetry but parked until M7's audit log lands.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SessionStopArgs {
    session_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Map a user-facing "stop this turn" onto `IpcCommand::Abort` (NOT
/// `Shutdown`). The bridge stays alive so a subsequent `session send`
/// can resume without paying the 5-10s respawn cost. See sub-plan §1.4
/// for the Abort-vs-Shutdown decision. Idempotent: stopping an already-
/// idle session returns `already_stopped` and exit 0.
async fn dispatch_session_stop(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionStopArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.stop args: {e}"),
            );
        }
    };

    // Validate the session row exists so callers get `not_found` for
    // typos rather than `already_stopped` (which would silently swallow
    // the typo). The runner liveness check is separate.
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    if !manager.agent_running(&parsed.session_id).await {
        return SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        );
    }
    match manager
        .send_command(&parsed.session_id, &IpcCommand::Abort)
        .await
    {
        Ok(()) => SocketResponse::ok(request_id, serde_json::json!({ "dispatch": "abort_sent" })),
        // Race: agent_running was true but the process died before
        // we got the command out. Treat as already_stopped — the
        // observable end state is the same.
        Err(SendCommandError::ProcessGone { .. }) => SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        ),
        Err(e) => SocketResponse::err(request_id, "runner_error", e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionArchiveArgs {
    session_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

async fn dispatch_session_archive(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: SessionArchiveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.archive args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .archive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-archived-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.archive",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

async fn dispatch_session_restore(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    // Restore reuses the archive args shape — same flags, opposite verb.
    let parsed: SessionArchiveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.restore args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .unarchive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-unarchived-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.restore",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMoveArgs {
    session_id: String,
    /// `None` = detach from any project (move to ungrouped). Matches the
    /// CLI surface where omitting `--to` means "detach".
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

async fn dispatch_session_move(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: SessionMoveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.move args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .assign_session_to_project(SessionId(parsed.session_id), parsed.to, origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-moved-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.move",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

struct ResolvedLlmSelection {
    index: Option<u32>,
    key: Option<String>,
    display_name: Option<String>,
}

async fn resolve_llm_selection(
    galley: &SqliteGalley,
    name: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    match runtime_kind {
        RuntimeKind::Managed => resolve_managed_llm_name(galley, name).await,
        RuntimeKind::External => resolve_external_llm_name(galley, name).await,
    }
}

/// Look up an external `--llm=<display-name>` against the cached `llm_list`
/// pref. The stable key is the raw GA LLM name, falling back to display name
/// for old cache entries.
async fn resolve_external_llm_name(
    galley: &SqliteGalley,
    name: Option<String>,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    let Some(name) = name else {
        return Ok(ResolvedLlmSelection {
            index: None,
            key: None,
            display_name: None,
        });
    };
    let cached = match galley.get_pref_json("llm_list").await {
        Ok(v) => v,
        Err(e) => return Err(SocketResponseLite::from_err(e)),
    };
    let entries: Vec<LlmListEntry> = match cached {
        Some(v) => match serde_json::from_value(v) {
            Ok(es) => es,
            Err(e) => {
                return Err(SocketResponseLite::invalid_args(format!(
                    "llm_list pref shape mismatch: {e}"
                )))
            }
        },
        None => Vec::new(),
    };
    if entries.is_empty() {
        return Err(SocketResponseLite::invalid_args(
            "llm cache empty; open Galley GUI once to warmup",
        ));
    }
    let target = name.to_lowercase();
    if let Some(entry) = entries.iter().find(|e| e.name.to_lowercase() == target) {
        Ok(ResolvedLlmSelection {
            index: Some(entry.index),
            key: Some(entry.key.clone().unwrap_or_else(|| entry.name.clone())),
            display_name: Some(entry.name.clone()),
        })
    } else {
        Err(SocketResponseLite::invalid_args(format!(
            "unknown llm '{name}'; try `galley llm list` to see available"
        )))
    }
}

#[derive(Debug, Deserialize)]
struct LlmListEntry {
    index: u32,
    #[serde(alias = "displayName")]
    name: String,
    #[serde(default)]
    key: Option<String>,
}

async fn resolve_managed_llm_name(
    galley: &SqliteGalley,
    name: Option<String>,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    let Some(name) = name else {
        return Ok(ResolvedLlmSelection {
            index: None,
            key: None,
            display_name: None,
        });
    };
    let models = match galley.list_managed_models().await {
        Ok(models) => models,
        Err(e) => return Err(SocketResponseLite::from_err(e)),
    };
    let target = name.to_lowercase();
    let mut index = 0_u32;
    for model in models {
        if model.credential_status == ManagedModelCredentialStatus::Missing {
            continue;
        }
        let display_name = managed_model_display_name(&model.display_name, &model.model);
        if display_name.to_lowercase() == target || model.model.to_lowercase() == target {
            return Ok(ResolvedLlmSelection {
                index: Some(index),
                key: Some(model.id),
                display_name: Some(display_name),
            });
        }
        index += 1;
    }
    Err(SocketResponseLite::invalid_args(format!(
        "unknown managed llm '{name}'; configure it in Settings > Models"
    )))
}

fn managed_model_display_name(display_name: &str, model: &str) -> String {
    let trimmed = display_name.trim();
    if trimmed.is_empty() {
        model.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Carrier for errors raised before we know the request_id — bound to
/// the outer response by [`SocketResponseLite::with_request_id`]. Avoids
/// threading `request_id` through every helper. The "lite" suffix is
/// because the carrier doesn't include the request_id at construction.
enum SocketResponseLite {
    InvalidArgs(String),
    DbUnavailable(String),
    NotFound(String),
    Internal(String),
    RunnerError(String),
    RunnerSpawnError(RunnerSpawnError),
}

impl SocketResponseLite {
    fn invalid_args(msg: impl Into<String>) -> Self {
        SocketResponseLite::InvalidArgs(msg.into())
    }
    fn runner_error(msg: impl Into<String>) -> Self {
        SocketResponseLite::RunnerError(msg.into())
    }
    fn runner_spawn_error(e: RunnerSpawnError) -> Self {
        SocketResponseLite::RunnerSpawnError(e)
    }
    fn from_err(e: crate::error::GalleyError) -> Self {
        use crate::error::GalleyError;
        match e {
            GalleyError::NotFound { message } => SocketResponseLite::NotFound(message),
            GalleyError::InvalidArgs { message } => SocketResponseLite::InvalidArgs(message),
            GalleyError::DbUnavailable { message } => SocketResponseLite::DbUnavailable(message),
            GalleyError::RunnerError { message } => SocketResponseLite::RunnerError(message),
            GalleyError::Internal { message } => SocketResponseLite::Internal(message),
        }
    }
    fn with_request_id(self, request_id: Option<String>) -> SocketResponse {
        match self {
            SocketResponseLite::InvalidArgs(m) => {
                SocketResponse::err(request_id, "invalid_args", m)
            }
            SocketResponseLite::DbUnavailable(m) => {
                SocketResponse::err(request_id, "db_unavailable", m)
            }
            SocketResponseLite::NotFound(m) => SocketResponse::err(request_id, "not_found", m),
            SocketResponseLite::Internal(m) => SocketResponse::err(request_id, "internal", m),
            SocketResponseLite::RunnerError(m) => {
                SocketResponse::err(request_id, "runner_error", m)
            }
            SocketResponseLite::RunnerSpawnError(e) => {
                SocketResponse::err(request_id, runner_spawn_error_tag(&e), e.to_string())
            }
        }
    }
}

fn runner_spawn_error_tag(e: &RunnerSpawnError) -> &'static str {
    match e {
        RunnerSpawnError::PythonNotFound { .. } => "python_not_found",
        RunnerSpawnError::GaPathInvalid { .. } => "ga_path_invalid",
        RunnerSpawnError::ManagedRuntimeInvalid { .. } => "managed_runtime_invalid",
        RunnerSpawnError::ManagedModelNotConfigured { .. } => "managed_model_not_configured",
        RunnerSpawnError::BridgeCwdInvalid { .. } => "bridge_cwd_invalid",
        RunnerSpawnError::PathEncoding { .. } => "path_encoding",
        RunnerSpawnError::SpawnIo { .. } => "spawn_io",
        RunnerSpawnError::PipeUnavailable { .. } => "pipe_unavailable",
    }
}

/// Mint a session id matching the GUI's `s-<base36-time>-<base36-rand>`
/// shape. Kept here (rather than in `db::SqliteGalley`) because
/// id-minting is a caller concern — `create_session_in_tx` accepts a
/// caller-supplied id and validates the row insert.
fn mint_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SESSION_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let ts = dur.as_millis() as u64;
    let counter = SESSION_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nonce = (dur.as_nanos() as u64)
        ^ counter.rotate_left(17)
        ^ (u64::from(std::process::id())).rotate_left(32);
    let rand: u64 = {
        let mut x = ts ^ nonce;
        x ^= x.wrapping_mul(0x9E3779B97F4A7C15);
        x ^= x >> 33;
        x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53);
        x
    };
    let suffix = radix36(rand);
    let suffix_start = suffix.len().saturating_sub(8);
    format!("s-{}-{}", radix36(ts), &suffix[suffix_start..])
}

fn radix36(mut n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    const ALPHABET: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::with_capacity(13);
    while n > 0 {
        out.push(ALPHABET[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("radix36 alphabet is ASCII")
}

/// Default title for `session.new` — matches the GUI's localized seed
/// so a CLI-created row + a GUI-created row look identical in the
/// sidebar. The bridge derives a better title after the first turn ends.
const DEFAULT_NEW_SESSION_TITLE: &str = "新对话";

// ---------------- B4 M1.3 · project + llm write handlers ----------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectExternalPayload {
    project: ProjectBrief,
    via: &'static str,
}

/// `project.delete` carries extra payload that `ProjectExternalPayload`
/// can't express — the affected child sessions get their `project_id`
/// auto-detached (FK SET NULL), and the GUI needs to mirror that.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectDeletedPayload {
    project_id: String,
    /// Number of sessions whose `project_id` was just set to NULL.
    /// CLI returns this in the response too so a supervisor agent can
    /// surface the side effect in its action log.
    detached_sessions: u32,
    detached_session_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCreateArgs {
    name: String,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

async fn dispatch_project_create(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: ProjectCreateArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("project.create args: {e}"),
            );
        }
    };
    let name = parsed.name.trim().to_string();
    if name.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "project.create: name is empty");
    }
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    let input = CreateProjectInput {
        id: mint_project_id(),
        name,
        root_path: parsed.root_path.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }),
        icon: parsed.icon,
        color: parsed.color,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);

    match galley.create_project(input, origin).await {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "project-created-external",
                    ProjectExternalPayload {
                        project: brief.clone(),
                        via: "project.create",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "project": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDeleteArgs {
    project_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Destructive: removes the project row. FK CASCADE SET NULL detaches
/// child sessions to ungrouped — those rows survive but their
/// `project_id` flips to NULL. The CLI surface deliberately calls this
/// `delete` (not `archive`) per sub-plan O2 — the operation is
/// destructive and the naming should reflect that. A future v0.6+ may
/// ship a true reversible `project archive` alongside.
async fn dispatch_project_delete(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: ProjectDeleteArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("project.delete args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    // Snapshot child sessions BEFORE the delete so we can surface
    // `detachedSessions` to the caller + GUI listener. SQLite SET NULL
    // is atomic with the row drop, so a list-then-delete sequence races
    // against concurrent GUI writes only by the few ms between the two
    // queries — acceptable for a count meant for human-readable feedback.
    let detached_ids: Vec<String> = match galley
        .list_sessions(SessionFilter {
            project_id: Some(parsed.project_id.clone()),
            status: None,
            archived: None,
            runtime_kind: None,
        })
        .await
    {
        Ok(rows) => rows.into_iter().map(|s| s.id.0).collect(),
        Err(e) => return map_galley_err(request_id, e),
    };

    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    if let Err(e) = galley
        .delete_project(ProjectId(parsed.project_id.clone()), origin)
        .await
    {
        return map_galley_err(request_id, e);
    }

    let payload = ProjectDeletedPayload {
        project_id: parsed.project_id,
        detached_sessions: detached_ids.len() as u32,
        detached_session_ids: detached_ids.clone(),
    };
    if let Some(app) = app {
        let _ = app.emit("project-deleted-external", payload.clone());
    }
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "deleted": true,
            "projectId": payload.project_id,
            "detachedSessions": payload.detached_sessions,
            "detachedSessionIds": payload.detached_session_ids,
        }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmSetArgs {
    session_id: String,
    llm_name: String,
}

/// Persist a session's per-bridge LLM choice + best-effort dispatch
/// `SetLlm` to any live runner. Two-step semantics mirror `session.send`:
/// the DB row is the source of truth; runner dispatch is opportunistic.
/// `dispatch` field in the response tells the caller which path ran.
async fn dispatch_llm_set(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: LlmSetArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(request_id, "invalid_args", format!("llm.set args: {e}"));
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    // 1. Validate the session exists and use its runtime mode to resolve the
    //    display name against the correct model source.
    let sid = SessionId(parsed.session_id.clone());
    let session = match galley.session_brief(sid.clone()).await {
        Ok(session) => session,
        Err(e) => return map_galley_err(request_id, e),
    };
    let selection = match resolve_llm_selection(
        &galley,
        Some(parsed.llm_name.clone()),
        session.ga_runtime_kind,
    )
    .await
    {
        Ok(selection) => selection,
        Err(resp) => return resp.with_request_id(request_id),
    };
    let (Some(index), Some(display_name)) = (selection.index, selection.display_name.clone())
    else {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "llm.set: llm name resolved to empty (cache shape unexpected)",
        );
    };

    let brief = match galley
        .set_session_llm(
            sid,
            Some(index),
            selection.key.clone(),
            Some(display_name.clone()),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    // 3. Best-effort: tell any live runner the new pick. Drop the
    //    galley handle first so the manager's lock acquisition doesn't
    //    serialize against an unrelated SqliteGalley reference.
    drop(galley);
    let dispatch_status = match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::SetLlm(SetLlmCommand {
                llm_index: index as i64,
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(SendCommandError::ProcessGone { .. }) => "persisted_only",
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("llm.set runner dispatch: {e}"),
            );
        }
    };

    // 4. Mirror to GUI so the Composer pill / Inspector reflect the
    //    new persisted choice. Reuses the session-updated channel that
    //    the M1.2 listener handles via `applyExternalSessionUpdated`.
    if let Some(app) = app {
        let _ = app.emit(
            "session-updated-external",
            SessionExternalPayload {
                session: brief.clone(),
                via: "llm.set",
            },
        );
    }

    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "session": brief,
            "dispatch": dispatch_status,
        }),
    )
}

/// Mint a project id matching the GUI's `proj_<16-hex>` shape (see
/// `gui/src/stores/sessions.ts:929`). Hex is fine — collision space
/// for a single-user app is enormous and the id is opaque downstream.
fn mint_project_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x: u128 = ts;
    // Splitmix-ish stir so two ids minted in the same ns differ.
    x ^= x.wrapping_mul(0x9E3779B97F4A7C15_9E3779B97F4A7C15);
    x ^= x >> 64;
    x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53_C4CEB9FE1A85EC53);
    let hex = format!("{x:032x}");
    format!("proj_{}", &hex[..16])
}

async fn dispatch_sessions_list(request_id: Option<String>, args: Value) -> SocketResponse {
    let filter: SessionFilter = match serde_json::from_value(args) {
        Ok(f) => f,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("sessions.list args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    match galley.list_sessions(filter).await {
        Ok(sessions) => {
            let value = serde_json::to_value(&sessions).unwrap_or(Value::Null);
            SocketResponse::ok(request_id, value)
        }
        Err(e) => SocketResponse::err(request_id, "internal", format!("list_sessions: {e}")),
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

    #[test]
    fn socket_guard_dormant_does_nothing_on_drop() {
        let guard = SocketGuard::dormant();
        assert!(!guard.is_active());
        drop(guard); // no panic, no side effect
    }
}
