//! Single Python runner subprocess + its stdin / stdout / stderr / broadcast
//! channel.
//!
//! See [parent module docs](super) for history and lifetime contract.

use crate::ipc::{IpcCommand, IpcEvent};
use crate::process_command;
use crate::runner_manager::error::{RunnerSpawnError, SendCommandError};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex};

/// Buffer capacity for the per-process broadcast channel. Sized for streaming
/// `turn_progress` events (~1000 tokens per turn typically). Subscribers that
/// fall behind by more than this many events will see `RecvError::Lagged` and
/// can choose to skip-ahead. Same cap as the prototype's S3 stress test
/// (4548 events/sec sustained).
const BROADCAST_CAPACITY: usize = 1024;

/// Max stderr lines retained in the rolling buffer. Sized for "show last N
/// lines on abnormal exit" toasts — matches the TS-side
/// `_STDERR_TAIL_MAX = 8` value being migrated from
/// `gui/src/stores/useAppStore.ts`.
const STDERR_TAIL_MAX: usize = 8;

/// Bound on a single stdin write to the runner. The runner drains stdin on a
/// dedicated reader thread, so a healthy child never comes close; hitting
/// this means the child is alive but wedged with a full pipe buffer. Bounding
/// the write keeps the per-session Mutex acquisition in
/// `RunnerManager::send_command` finite, which in turn keeps the manager's
/// outer map lock livelock-free (see the audit trail in
/// docs/audits/concurrency-audit-2026-07-04/, CONC-1).
const STDIN_WRITE_TIMEOUT: Duration = Duration::from_secs(15);

/// What gets fanned out over the broadcast channel.
///
/// `Event` carries already-parsed [`IpcEvent`]s — saves every subscriber from
/// re-parsing the same line.
///
/// `Malformed` carries lines that didn't parse as IPC events: Python
/// tracebacks that slipped past the runner's stdout discipline, partial
/// flushes on crash, etc. Subscribers can log or skip these.
#[derive(Debug, Clone)]
pub enum BroadcastItem {
    Event(Box<IpcEvent>),
    Malformed(String),
    Closed {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

/// Arguments to [`RunnerProcess::spawn`].
///
/// Mirrors the `BridgeSpawnArgs` interface on the TypeScript side
/// ([`gui/src/lib/bridge.ts`]) so a 1:1 port is achievable in B2 M2. The
/// caller (Tauri command handler) is responsible for resolving the bundled-
/// vs-external Python question and supplying the right `python` path.
#[derive(Debug, Clone)]
pub struct SpawnArgs {
    /// Path to the Python interpreter. Caller decides whether this is the
    /// bundled `$RESOURCE/python/bin/python3` or a user-supplied external
    /// (e.g. `/usr/local/bin/python3`).
    pub python: String,
    /// Absolute path to the GA repo (forwarded as `--ga-path`).
    pub ga_path: PathBuf,
    /// Stable session id (forwarded as `--session-id`).
    pub session_id: String,
    /// Working directory for the GA subprocess (forwarded as `--cwd`).
    /// None means "let GA inherit from the runner's cwd".
    pub cwd: Option<PathBuf>,
    /// Optional Project Workspace root. Forwarded separately from cwd so
    /// Project folders never chdir the GA process away from its state root.
    pub workspace_root: Option<PathBuf>,
    /// Working directory for the *runner* subprocess itself. In production
    /// this is the Tauri resourceDir (where `runner/` was packaged); in
    /// dev it's the repo root.
    pub bridge_cwd: PathBuf,
    /// Initial LLM index (forwarded as `--llm-no`). None = runner's
    /// default (the first LLM in mykey.py).
    pub llm_index: Option<i64>,
    /// Stable LLM identity for runtimes that can resolve by name. For
    /// external GA this is the raw `agent.list_llms()` name and is
    /// forwarded as `--llm-name`; managed GA resolves its model id before
    /// process spawn and clears this field.
    pub llm_key: Option<String>,
    /// Extra environment variables passed to the child.
    pub env: Vec<(String, String)>,
}

/// One Python runner subprocess + the live infrastructure around it.
pub struct RunnerProcess {
    session_id: String,
    child: Arc<Mutex<Child>>,
    pid: Option<u32>,
    stdin: ChildStdin,
    /// Cloned by [`subscribe`](Self::subscribe) to hand out receivers.
    stdout_tx: broadcast::Sender<BroadcastItem>,
    /// Set by the stdout reader on `TurnStart` and cleared on `TurnEnd` /
    /// `RunComplete`. Read by [`RunnerManager`](super::manager::RunnerManager)
    /// to decide whether the session is eviction-protected. Shared with the
    /// reader task via `Arc`.
    agent_running: Arc<AtomicBool>,
    /// True once shutdown/kill is user-initiated by Galley. The stdout reader
    /// still emits a close event, but maps it to a clean close so GUI does not
    /// show a crash toast for deliberate lifecycle transitions.
    expected_close: Arc<AtomicBool>,
    /// Rolling buffer of the last [`STDERR_TAIL_MAX`] stderr lines. Used to
    /// surface "bridge died with this Python error" toasts on abnormal exit
    /// (the prod-build failure mode hit 2026-05-15 on first .dmg dogfood,
    /// see project_v01_windows_plan memory).
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

impl RunnerProcess {
    /// Spawn a new Python `runner.workbench_bridge` subprocess.
    ///
    /// On success the subprocess is alive with stdout/stderr being read on
    /// background tasks. Subscribers should call [`subscribe`](Self::subscribe)
    /// before the first event arrives if they want the `Ready` event — the
    /// pre-subscribed receiver is held in the manager and handed to the
    /// first subscriber (same pattern as the prototype's `preload_rx`).
    pub async fn spawn(args: SpawnArgs) -> Result<Self, RunnerSpawnError> {
        // Path validation: surface a clear error rather than letting the
        // subprocess fail with a cryptic GA traceback. We don't validate
        // that `bridge_cwd` contains a `runner/` package — that's the
        // subprocess's job, and CI sometimes runs without one.
        if !args.bridge_cwd.is_dir() {
            return Err(RunnerSpawnError::BridgeCwdInvalid {
                detail: format!("not a directory: {}", args.bridge_cwd.display()),
            });
        }
        let ga_path_str = args
            .ga_path
            .to_str()
            .ok_or_else(|| RunnerSpawnError::PathEncoding {
                detail: format!("ga_path not UTF-8: {}", args.ga_path.display()),
            })?
            .to_string();

        let mut cmd = Command::new(&args.python);
        cmd.args([
            "-m",
            "runner.workbench_bridge",
            "--ga-path",
            &ga_path_str,
            "--session-id",
            &args.session_id,
        ]);
        if let Some(ref cwd) = args.cwd {
            let cwd_str = cwd.to_str().ok_or_else(|| RunnerSpawnError::PathEncoding {
                detail: format!("cwd not UTF-8: {}", cwd.display()),
            })?;
            cmd.args(["--cwd", cwd_str]);
        }
        if let Some(ref workspace_root) = args.workspace_root {
            let workspace_root_str =
                workspace_root
                    .to_str()
                    .ok_or_else(|| RunnerSpawnError::PathEncoding {
                        detail: format!("workspace root not UTF-8: {}", workspace_root.display()),
                    })?;
            cmd.args(["--workspace-root", workspace_root_str]);
        }
        if let Some(idx) = args.llm_index {
            cmd.args(["--llm-no", &idx.to_string()]);
        }
        if let Some(ref key) = args.llm_key {
            cmd.args(["--llm-name", key]);
        }
        for (k, v) in &args.env {
            cmd.env(k, v);
        }
        cmd.env("GALLEY_CORE_PID", std::process::id().to_string());
        process_command::configure_python(&mut cmd);

        let mut child = cmd
            .current_dir(&args.bridge_cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                // Wrap with the actual attempted path so the user sees
                // *which* python the spawn failed for. Raw `io::Error`'s
                // `NotFound` doesn't carry the program name.
                if e.kind() == std::io::ErrorKind::NotFound {
                    RunnerSpawnError::PythonNotFound {
                        detail: format!(
                            "no such file: '{}' (set Settings → Python or check PATH)",
                            args.python
                        ),
                    }
                } else {
                    RunnerSpawnError::SpawnIo {
                        detail: format!("'{}': {}", args.python, e),
                    }
                }
            })?;

        let pid = child.id();
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RunnerSpawnError::PipeUnavailable {
                detail: "stdin not piped".into(),
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RunnerSpawnError::PipeUnavailable {
                detail: "stdout not piped".into(),
            })?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| RunnerSpawnError::PipeUnavailable {
                detail: "stderr not piped".into(),
            })?;

        let (tx, _) = broadcast::channel::<BroadcastItem>(BROADCAST_CAPACITY);
        let agent_running = Arc::new(AtomicBool::new(false));
        let expected_close = Arc::new(AtomicBool::new(false));
        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_MAX)));
        let child = Arc::new(Mutex::new(child));

        // stdout reader task: parse each line as IpcEvent, broadcast.
        // Also flips agent_running on turn_start / clears on turn_end /
        // run_complete — the LRU manager reads this to decide eviction
        // protection without subscribing.
        {
            let tx = tx.clone();
            let agent_running = agent_running.clone();
            let child = child.clone();
            let expected_close = expected_close.clone();
            let sid_for_log = args.session_id.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                loop {
                    match reader.next_line().await {
                        Ok(Some(line)) => {
                            if line.is_empty() {
                                continue;
                            }
                            let item = match serde_json::from_str::<IpcEvent>(&line) {
                                Ok(event) => {
                                    match &event {
                                        IpcEvent::TurnStart(_) => {
                                            agent_running.store(true, Ordering::SeqCst);
                                        }
                                        IpcEvent::TurnEnd(_) | IpcEvent::RunComplete(_) => {
                                            agent_running.store(false, Ordering::SeqCst);
                                        }
                                        _ => {}
                                    }
                                    BroadcastItem::Event(Box::new(event))
                                }
                                Err(_) => BroadcastItem::Malformed(line),
                            };
                            let _ = tx.send(item);
                        }
                        Ok(None) => break,
                        Err(e) => {
                            eprintln!("[runner stdout read error {sid_for_log}] {e}");
                            break;
                        }
                    }
                }
                agent_running.store(false, Ordering::SeqCst);
                // After stdout EOF, learn the exit status WITHOUT holding
                // the child lock across an unbounded `wait()`: a child that
                // closes stdout but keeps running would park this task
                // inside the lock forever, wedging `shutdown()`/`kill()` —
                // and with them the app's quit cleanup (tray
                // `cleanup_and_exit` would never reach `app.exit(0)`).
                // Poll `try_wait` so the lock is held only for an instant.
                let closed = {
                    let status = loop {
                        let polled = {
                            let mut child = child.lock().await;
                            child.try_wait()
                        };
                        match polled {
                            Ok(Some(status)) => break Some(status),
                            Ok(None) => {
                                tokio::time::sleep(Duration::from_millis(200)).await;
                            }
                            Err(e) => {
                                eprintln!("[runner wait error {sid_for_log}] {e}");
                                break None;
                            }
                        }
                    };
                    match status {
                        Some(_) if expected_close.load(Ordering::SeqCst) => BroadcastItem::Closed {
                            code: Some(0),
                            signal: None,
                        },
                        Some(status) => BroadcastItem::Closed {
                            code: status.code(),
                            signal: exit_signal(&status),
                        },
                        None => BroadcastItem::Closed {
                            code: None,
                            signal: None,
                        },
                    }
                };
                let _ = tx.send(closed);
            });
        }

        // stderr reader task: tee to (a) caller's eprintln for ops
        // visibility and (b) the rolling tail buffer for abnormal-exit
        // toasts.
        {
            let stderr_tail = stderr_tail.clone();
            let sid_for_log = args.session_id.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    eprintln!("[runner stderr {sid_for_log}] {line}");
                    let mut buf = stderr_tail.lock().await;
                    if buf.len() >= STDERR_TAIL_MAX {
                        buf.pop_front();
                    }
                    buf.push_back(line);
                }
            });
        }

        Ok(Self {
            session_id: args.session_id,
            child,
            pid,
            stdin,
            stdout_tx: tx,
            agent_running,
            expected_close,
            stderr_tail,
        })
    }

    /// PID of the live subprocess. None if the OS reported the process as
    /// already gone at spawn time (extremely rare).
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Subscribe to the broadcast channel. Each subscriber gets its own
    /// receiver; messages buffered before subscribe are NOT delivered
    /// (broadcast channel is fan-out, not history).
    ///
    /// **For the `Ready` event**: the manager pre-subscribes a receiver at
    /// spawn time and hands it to the very first caller; the prototype
    /// validated this idiom is necessary because the spawn-to-first-event
    /// gap (~430ms for Python startup) is wide enough that a naive
    /// `spawn().await; subscribe()` misses Ready. See
    /// [`RunnerManager::subscribe`](super::manager::RunnerManager::subscribe).
    pub fn subscribe(&self) -> broadcast::Receiver<BroadcastItem> {
        self.stdout_tx.subscribe()
    }

    /// Internal helper used by the manager to capture the pre-spawn
    /// receiver. Not exposed publicly because callers should go through
    /// the manager's [`subscribe`](super::manager::RunnerManager::subscribe).
    pub(super) fn broadcast_sender(&self) -> &broadcast::Sender<BroadcastItem> {
        &self.stdout_tx
    }

    /// Send a typed [`IpcCommand`] to the subprocess's stdin. Serializes to
    /// JSON Lines (one command per `\n`-terminated line).
    ///
    /// The whole write is bounded by [`STDIN_WRITE_TIMEOUT`]. A healthy
    /// runner drains stdin on a dedicated reader thread, so even multi-MB
    /// payloads (`LoadHistory`, goal synthesis prompts) complete in well
    /// under a second; the only way to hit the timeout is a wedged-but-alive
    /// child with a full pipe buffer. Without the bound, that wedge would
    /// hold this session's manager Mutex forever and pile up every later
    /// command for the session.
    pub async fn send_command(&mut self, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        let line = serde_json::to_string(cmd).map_err(|e| SendCommandError::Serialize {
            detail: e.to_string(),
        })?;
        let write = async {
            self.stdin.write_all(line.as_bytes()).await?;
            self.stdin.write_all(b"\n").await?;
            self.stdin.flush().await?;
            Ok::<(), std::io::Error>(())
        };
        match tokio::time::timeout(STDIN_WRITE_TIMEOUT, write).await {
            Ok(result) => result.map_err(|e| SendCommandError::WriteIo {
                detail: e.to_string(),
            }),
            Err(_) => Err(SendCommandError::WriteIo {
                detail: format!(
                    "stdin write timed out after {}s — runner alive but not \
                     reading stdin (wedged process, full pipe buffer)",
                    STDIN_WRITE_TIMEOUT.as_secs()
                ),
            }),
        }
    }

    /// Whether the subprocess is mid-turn. Used by the LRU eviction policy
    /// to protect long-running tasks from being killed.
    pub fn agent_running(&self) -> bool {
        self.agent_running.load(Ordering::SeqCst)
    }

    /// Snapshot the last [`STDERR_TAIL_MAX`] stderr lines. Used by the
    /// abnormal-exit toast surfaced by the GUI.
    pub async fn stderr_tail(&self) -> Vec<String> {
        let buf = self.stderr_tail.lock().await;
        buf.iter().cloned().collect()
    }

    /// Graceful shutdown: send `{"kind":"shutdown"}` then wait up to
    /// `timeout` for the child to exit on its own.
    ///
    /// Returns whether shutdown was graceful (`true`). On `false` the
    /// caller must follow up with [`kill`](Self::kill) — `kill_on_drop`
    /// is NOT a reliable fallback here because the stdout reader task
    /// holds an `Arc` to the child, so dropping `self` does not drop it.
    pub async fn shutdown(&mut self, timeout: Duration) -> bool {
        self.expected_close.store(true, Ordering::SeqCst);
        // Best-effort: write to stdin can fail if the subprocess already
        // crashed. Either way we proceed to wait.
        let _ = self.send_command(&IpcCommand::Shutdown).await;
        // The timeout covers lock acquisition too: shutdown must return
        // in bounded time even if another task is inside the child lock,
        // or quit cleanup hangs and the app can only be force-killed.
        let wait = async {
            let mut child = self.child.lock().await;
            child.wait().await
        };
        match tokio::time::timeout(timeout, wait).await {
            Ok(Ok(_)) => true,
            // Subprocess exit returned an io error → treat as ungraceful.
            Ok(Err(_)) => false,
            Err(_) => false, // timeout
        }
    }

    /// Force kill the subprocess and block until it has been reaped.
    /// Bounded for the same reason as [`shutdown`](Self::shutdown): quit
    /// cleanup calls this and must never hang. SIGKILL delivery + reap is
    /// fast; hitting the bound means something else is wedged inside the
    /// child lock, and `kill_on_drop` stays the final backstop.
    pub async fn kill(&mut self) -> std::io::Result<()> {
        self.expected_close.store(true, Ordering::SeqCst);
        let kill = async {
            let mut child = self.child.lock().await;
            child.start_kill()?;
            let _ = child.wait().await;
            Ok(())
        };
        match tokio::time::timeout(Duration::from_secs(5), kill).await {
            Ok(result) => result,
            Err(_) => {
                eprintln!("[runner kill timed out {}]", self.session_id);
                Ok(())
            }
        }
    }

    /// Wait for the child to exit. Idempotent — `tokio::Child::wait`
    /// caches the result internally.
    #[allow(dead_code)] // Used by tests + reserved for future watchers
    pub async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        let mut child = self.child.lock().await;
        child.wait().await
    }
}

fn exit_signal(status: &ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// A path the OS guarantees doesn't exist. Used to probe spawn-error
    /// paths without needing a sandbox.
    fn nonexistent_python() -> String {
        "/nonexistent/path/to/python_that_will_not_exist_anywhere".into()
    }

    // `RunnerProcess` can't derive Debug (holds `Child`/`ChildStdin`,
    // neither of which is Debug), so `Result::unwrap_err()` is unavailable.
    // Match on the error variant directly.

    #[tokio::test]
    async fn spawn_with_invalid_bridge_cwd_errors() {
        let args = SpawnArgs {
            python: "python3".into(),
            ga_path: PathBuf::from("/tmp"),
            session_id: "s1".into(),
            cwd: None,
            workspace_root: None,
            bridge_cwd: PathBuf::from("/no/such/dir/anywhere"),
            llm_index: None,
            llm_key: None,
            env: vec![],
        };
        match RunnerProcess::spawn(args).await {
            Err(RunnerSpawnError::BridgeCwdInvalid { .. }) => {}
            Err(other) => panic!("expected BridgeCwdInvalid, got {}", other),
            Ok(_) => panic!("expected error, got Ok"),
        }
    }

    #[tokio::test]
    async fn spawn_with_nonexistent_python_errors() {
        let args = SpawnArgs {
            python: nonexistent_python(),
            ga_path: PathBuf::from("/tmp"),
            session_id: "s1".into(),
            cwd: None,
            workspace_root: None,
            // Use a real existing dir so the cwd check passes and we get
            // to the spawn step.
            bridge_cwd: env::temp_dir(),
            llm_index: None,
            llm_key: None,
            env: vec![],
        };
        match RunnerProcess::spawn(args).await {
            Err(RunnerSpawnError::PythonNotFound { .. }) => {}
            Err(other) => panic!("expected PythonNotFound, got {}", other),
            Ok(_) => panic!("expected error, got Ok"),
        }
    }

    // Note: real-subprocess behavior is covered by integration tests
    // in `core/tests/runner_manager_test.rs` where we can control the
    // mock runner contents on disk. The unit tests here exercise the
    // construction-time error paths (above) and the value-type semantics
    // (below).

    #[test]
    fn broadcast_item_clone_preserves_payload() {
        let line = r#"{"kind":"turn_start","sessionId":"s1","turnIndex":1,"timestamp":"t"}"#;
        let event: IpcEvent = serde_json::from_str(line).unwrap();
        let item = BroadcastItem::Event(Box::new(event));
        let cloned = item.clone();
        match cloned {
            BroadcastItem::Event(boxed) => {
                if let IpcEvent::TurnStart(t) = boxed.as_ref() {
                    assert_eq!(t.turn_index, 1);
                } else {
                    panic!("wrong variant");
                }
            }
            BroadcastItem::Malformed(_) => panic!("wrong variant"),
            BroadcastItem::Closed { .. } => panic!("wrong variant"),
        }
    }

    #[test]
    fn broadcast_item_malformed_carries_string() {
        let item = BroadcastItem::Malformed("Traceback (most recent call last):".into());
        match item {
            BroadcastItem::Malformed(s) => assert!(s.contains("Traceback")),
            _ => panic!("wrong"),
        }
    }
}
