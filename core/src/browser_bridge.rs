//! Resident browser bridge for the managed GenericAgent runtime.
//!
//! While the managed runtime is active, Core owns one long-lived
//! `python -m runner.managed_browser_bridge` process. It hosts GA's own
//! TMWebDriver master, so the Chromium extension connects as soon as the
//! browser runs and every managed GA session becomes a remote client of
//! it (upstream's remote mode). Core reads the live connection state from
//! the process's stdout status lines, keeps the latest one, and pushes
//! changes to the GUI as `browser-bridge-updated`.
//!
//! Boundaries:
//! - Core opens no listener (Rule 2). Ports 18765 / 18766 are the GA
//!   engine's own: a managed session opens the same ones today whenever it
//!   is the first to use the browser.
//! - Never started for attach / external GA (Rule 1): an external GA's
//!   sessions would otherwise attach to a Galley-owned master.
//!
//! Lifecycle mirrors the IM supervisors (`im_supervisor::manager`): spawned
//! at app setup and on a switch to managed, stopped on a switch to external
//! and on quit / update install, restarted with backoff when it exits on
//! its own. Process generations gate every late stdout line and exit
//! notice, so a killed process can never overwrite its successor's status.
//! See docs/managed-ga-runtime/browser-control.md.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::api::RuntimeKind;
use crate::db::SqliteGalley;
use crate::{browser_control, managed_runtime, process_command};

pub const EVENT_NAME: &str = "browser-bridge-updated";
/// The pref the GUI writes when the user switches runtime; `set_pref_json`
/// reconciles the bridge when it changes.
pub const ACTIVE_RUNTIME_KIND_PREF: &str = "active_runtime_kind";
const GALLEY_CORE_PID_ENV: &str = "GALLEY_CORE_PID";
/// A process that lived at least this long counts as healthy: its exit
/// restarts quickly and resets the backoff.
const MIN_HEALTHY_RUN: Duration = Duration::from_secs(10);
const RESTART_BASE_DELAY: Duration = Duration::from_secs(1);
const RESTART_MAX_DELAY: Duration = Duration::from_secs(60);
const STDERR_TAIL_MAX_CHARS: usize = 240;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserBridgeState {
    /// Not running: external runtime, quitting, or before the first start.
    Stopped,
    /// Spawned (or about to respawn) and no status line yet.
    Starting,
    /// Status lines are flowing; the extension fields are live.
    Running,
    /// The bridge reported it cannot serve, or it keeps exiting.
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BrowserBridgeRole {
    /// This process hosts the TMWebDriver master.
    Master,
    /// Another process already serves the ports; status is read through it.
    Remote,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBridgeStatus {
    pub state: BrowserBridgeState,
    pub role: Option<BrowserBridgeRole>,
    pub extension_connected: bool,
    pub tab_count: u32,
    /// Stable machine kind from the bridge (`port_in_use`,
    /// `missing_dependency`, …) or Core (`spawn_failed`, `exited`).
    pub error_kind: Option<String>,
    pub error: Option<String>,
    pub pid: Option<u32>,
    pub updated_at: String,
}

impl BrowserBridgeStatus {
    fn with_state(state: BrowserBridgeState) -> Self {
        Self {
            state,
            role: None,
            extension_connected: false,
            tab_count: 0,
            error_kind: None,
            error: None,
            pid: None,
            updated_at: now_iso(),
        }
    }

    fn error(kind: &str, message: String) -> Self {
        Self {
            error_kind: Some(kind.into()),
            error: Some(message),
            ..Self::with_state(BrowserBridgeState::Error)
        }
    }
}

/// One stdout line from `runner/managed_browser_bridge.py`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeLine {
    state: BrowserBridgeState,
    role: Option<BrowserBridgeRole>,
    #[serde(default)]
    extension_connected: bool,
    #[serde(default)]
    tab_count: u32,
    error_kind: Option<String>,
    error: Option<String>,
    updated_at: Option<String>,
}

fn status_from_line(line: BridgeLine, pid: Option<u32>) -> BrowserBridgeStatus {
    let running = line.state == BrowserBridgeState::Running;
    BrowserBridgeStatus {
        state: line.state,
        role: line.role,
        extension_connected: running && line.extension_connected,
        tab_count: if running { line.tab_count } else { 0 },
        error_kind: if running { None } else { line.error_kind },
        error: if running { None } else { line.error },
        pid,
        updated_at: line.updated_at.unwrap_or_else(now_iso),
    }
}

fn restart_delay(failures: u32) -> Duration {
    let exponent = failures.saturating_sub(1).min(16);
    RESTART_BASE_DELAY
        .saturating_mul(1u32 << exponent)
        .min(RESTART_MAX_DELAY)
}

/// Status to show after the process exited on its own and a restart is
/// scheduled. A crash after a healthy run is a blip: show `starting` so
/// the GUI does not flash an error while the replacement comes up. A
/// process that keeps dying fast is an honest `error`, keeping the
/// bridge's own last error if it reported one before exiting.
fn status_after_exit(
    previous: &BrowserBridgeStatus,
    healthy_run: bool,
    exit: &str,
    stderr_tail: Option<&str>,
) -> BrowserBridgeStatus {
    if healthy_run {
        return BrowserBridgeStatus::with_state(BrowserBridgeState::Starting);
    }
    if previous.state == BrowserBridgeState::Error && previous.error.is_some() {
        return BrowserBridgeStatus {
            pid: None,
            updated_at: now_iso(),
            ..previous.clone()
        };
    }
    let detail = stderr_tail
        .map(|tail| format!("：{tail}"))
        .unwrap_or_default();
    BrowserBridgeStatus::error(
        "exited",
        format!("浏览器控制服务意外退出（{exit}）{detail}"),
    )
}

struct Inner {
    /// Whether the bridge should be running (managed runtime active).
    desired: bool,
    /// Bumped on every spawn and stop; tasks of older generations no-op.
    generation: u64,
    child: Option<Arc<Mutex<Child>>>,
    started_at: Option<Instant>,
    failures: u32,
    stderr_tail: Option<String>,
    status: BrowserBridgeStatus,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            desired: false,
            generation: 0,
            child: None,
            started_at: None,
            failures: 0,
            stderr_tail: None,
            status: BrowserBridgeStatus::with_state(BrowserBridgeState::Stopped),
        }
    }
}

#[derive(Default)]
pub struct BrowserBridgeManager {
    inner: Mutex<Inner>,
    /// Serializes reconcile / restart / stop so two triggers (app setup
    /// racing a runtime switch, a scheduled restart racing either) cannot
    /// double-spawn.
    lifecycle: Mutex<()>,
}

impl BrowserBridgeManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn status(&self) -> BrowserBridgeStatus {
        self.inner.lock().await.status.clone()
    }

    /// Start the bridge if the active runtime is managed, stop it
    /// otherwise. Called at app setup and whenever the runtime pref is
    /// written.
    pub async fn reconcile(self: &Arc<Self>, app: AppHandle) {
        let _lifecycle = self.lifecycle.lock().await;
        if active_runtime_kind(&app).await == Some(RuntimeKind::Managed) {
            {
                let mut inner = self.inner.lock().await;
                inner.desired = true;
                if inner.child.is_some() {
                    return;
                }
            }
            self.spawn_locked(&app).await;
        } else {
            self.stop_locked(Some(&app)).await;
        }
    }

    /// Quit / update install: kill without emitting.
    pub async fn stop_all(&self) {
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_locked(None).await;
    }

    async fn stop_locked(&self, app: Option<&AppHandle>) {
        let (child, status) = {
            let mut inner = self.inner.lock().await;
            inner.desired = false;
            inner.generation += 1;
            inner.failures = 0;
            inner.started_at = None;
            let child = inner.child.take();
            let changed = inner.status.state != BrowserBridgeState::Stopped;
            inner.status = BrowserBridgeStatus::with_state(BrowserBridgeState::Stopped);
            (child, changed.then(|| inner.status.clone()))
        };
        if let Some(child) = child {
            let mut child = child.lock().await;
            let _ = child.start_kill();
            // The ports are free only once the process is gone; an external
            // GA session started right after the switch must not find them
            // still held.
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        }
        if let (Some(app), Some(status)) = (app, status) {
            let _ = app.emit(EVENT_NAME, status);
        }
    }

    /// Caller holds the lifecycle lock.
    async fn spawn_locked(self: &Arc<Self>, app: &AppHandle) {
        let generation = {
            let mut inner = self.inner.lock().await;
            inner.generation += 1;
            inner.generation
        };
        let mut child = match spawn_bridge_process(app) {
            Ok(child) => child,
            Err(message) => {
                eprintln!("[browser-bridge] start failed: {message}");
                let delay = {
                    let mut inner = self.inner.lock().await;
                    inner.failures += 1;
                    inner.status = BrowserBridgeStatus::error("spawn_failed", message);
                    let _ = app.emit(EVENT_NAME, inner.status.clone());
                    restart_delay(inner.failures)
                };
                self.schedule_restart(app.clone(), generation, delay);
                return;
            }
        };
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        {
            let mut inner = self.inner.lock().await;
            inner.child = Some(child.clone());
            inner.started_at = Some(Instant::now());
            inner.stderr_tail = None;
            // Keep the last error visible while a fast-failing bridge
            // retries; any other state becomes `starting`.
            if inner.status.state != BrowserBridgeState::Error {
                inner.status = BrowserBridgeStatus {
                    pid,
                    ..BrowserBridgeStatus::with_state(BrowserBridgeState::Starting)
                };
            }
            let _ = app.emit(EVENT_NAME, inner.status.clone());
        }
        if let Some(stdout) = stdout {
            let manager = Arc::clone(self);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                manager.read_stdout(app, generation, pid, stdout).await;
            });
        }
        if let Some(stderr) = stderr {
            let manager = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                manager.read_stderr(generation, stderr).await;
            });
        }
        {
            let manager = Arc::clone(self);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                manager.wait_child(app, generation, child).await;
            });
        }
    }

    fn schedule_restart(self: &Arc<Self>, app: AppHandle, generation: u64, delay: Duration) {
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            sleep(delay).await;
            let _lifecycle = manager.lifecycle.lock().await;
            let current = {
                let inner = manager.inner.lock().await;
                inner.desired && inner.generation == generation && inner.child.is_none()
            };
            if current {
                manager.spawn_locked(&app).await;
            }
        });
    }

    async fn read_stdout(
        self: Arc<Self>,
        app: AppHandle,
        generation: u64,
        pid: Option<u32>,
        stdout: tokio::process::ChildStdout,
    ) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(parsed) = serde_json::from_str::<BridgeLine>(&line) else {
                continue;
            };
            let next = status_from_line(parsed, pid);
            let mut inner = self.inner.lock().await;
            if inner.generation != generation || inner.status == next {
                continue;
            }
            inner.status = next.clone();
            drop(inner);
            let _ = app.emit(EVENT_NAME, next);
        }
    }

    async fn read_stderr(self: Arc<Self>, generation: u64, stderr: tokio::process::ChildStderr) {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            eprintln!("[browser-bridge] {line}");
            let mut inner = self.inner.lock().await;
            if inner.generation == generation {
                inner.stderr_tail = Some(line.chars().take(STDERR_TAIL_MAX_CHARS).collect());
            }
        }
    }

    async fn wait_child(
        self: Arc<Self>,
        app: AppHandle,
        generation: u64,
        child: Arc<Mutex<Child>>,
    ) {
        // Poll instead of awaiting `wait()` so stop can take the lock to
        // kill (same shape as the IM supervisors).
        let exit = loop {
            let status = {
                let mut child = child.lock().await;
                child.try_wait()
            };
            match status {
                Ok(Some(exit)) => break exit.to_string(),
                Ok(None) => sleep(Duration::from_millis(250)).await,
                Err(e) => break format!("wait failed: {e}"),
            }
        };
        let delay = {
            let mut inner = self.inner.lock().await;
            if inner.generation != generation {
                return;
            }
            inner.child = None;
            if !inner.desired {
                return;
            }
            let healthy_run = inner
                .started_at
                .is_some_and(|started| started.elapsed() >= MIN_HEALTHY_RUN);
            if healthy_run {
                inner.failures = 0;
            }
            inner.failures += 1;
            let next = status_after_exit(
                &inner.status,
                healthy_run,
                &exit,
                inner.stderr_tail.as_deref(),
            );
            eprintln!("[browser-bridge] exited ({exit}); restarting");
            inner.status = next.clone();
            let _ = app.emit(EVENT_NAME, next);
            restart_delay(inner.failures)
        };
        self.schedule_restart(app, generation, delay);
    }
}

fn spawn_bridge_process(app: &AppHandle) -> Result<Child, String> {
    let diagnostics = managed_runtime::ensure_for_app(app)
        .map_err(|e| format!("浏览器控制服务无法启动：内置内核目录不可用（{e}）"))?;
    let code_root = diagnostics.paths.code_root;
    if !Path::new(&code_root).join("TMWebDriver.py").is_file() {
        return Err(format!(
            "浏览器控制服务无法启动：内置内核缺少 TMWebDriver.py（{code_root}）"
        ));
    }
    let cwd = managed_runtime::bridge_cwd_for_app(app)
        .map_err(|e| format!("浏览器控制服务无法启动：{e}"))?;
    let python = browser_control::resolve_python(app);
    let mut cmd = Command::new(&python);
    cmd.args([
        "-m",
        "runner.managed_browser_bridge",
        "--ga-path",
        &code_root,
        "--exit-on-stdin-eof",
    ]);
    process_command::configure_python(&mut cmd);
    // stdin stays piped and unused: Core holds the write end for the
    // process lifetime, so the bridge sees EOF the moment Core goes away
    // (the GALLEY_CORE_PID watchdog is the slower backstop).
    cmd.current_dir(cwd)
        .env("GALLEY_RUNTIME_KIND", "managed")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env(GALLEY_CORE_PID_ENV, std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("浏览器控制服务无法启动（{}）：{e}", python.display()))
}

async fn active_runtime_kind(app: &AppHandle) -> Option<RuntimeKind> {
    let galley = app.try_state::<SqliteGalley>()?.inner().clone();
    match galley.active_runtime_kind().await {
        Ok(kind) => Some(kind),
        Err(e) => {
            // Unknown means not started: Rule 1 forbids guessing managed.
            eprintln!("[browser-bridge] reading active runtime kind failed: {e:?}");
            None
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(json: &str) -> BridgeLine {
        serde_json::from_str(json).expect("parse bridge line")
    }

    #[test]
    fn running_line_maps_to_live_status() {
        let status = status_from_line(
            line(
                r#"{"state":"running","role":"master","extensionConnected":true,"tabCount":3,"updatedAt":"2026-10-04T00:00:00.000Z"}"#,
            ),
            Some(42),
        );
        assert_eq!(status.state, BrowserBridgeState::Running);
        assert_eq!(status.role, Some(BrowserBridgeRole::Master));
        assert!(status.extension_connected);
        assert_eq!(status.tab_count, 3);
        assert_eq!(status.pid, Some(42));
        assert_eq!(status.error, None);
        assert_eq!(status.updated_at, "2026-10-04T00:00:00.000Z");
    }

    #[test]
    fn remote_role_parses() {
        let status = status_from_line(
            line(r#"{"state":"running","role":"remote","extensionConnected":false,"tabCount":0}"#),
            None,
        );
        assert_eq!(status.role, Some(BrowserBridgeRole::Remote));
        assert!(!status.extension_connected);
    }

    #[test]
    fn error_line_keeps_kind_and_message_and_drops_extension_fields() {
        let status = status_from_line(
            line(
                r#"{"state":"error","role":null,"errorKind":"port_in_use","error":"端口被占用","extensionConnected":true,"tabCount":2}"#,
            ),
            Some(7),
        );
        assert_eq!(status.state, BrowserBridgeState::Error);
        assert_eq!(status.role, None);
        assert_eq!(status.error_kind.as_deref(), Some("port_in_use"));
        assert_eq!(status.error.as_deref(), Some("端口被占用"));
        assert!(!status.extension_connected);
        assert_eq!(status.tab_count, 0);
    }

    #[test]
    fn running_line_clears_stale_error_fields() {
        let status = status_from_line(
            line(
                r#"{"state":"running","role":"master","extensionConnected":false,"tabCount":0,"error":"old"}"#,
            ),
            None,
        );
        assert_eq!(status.error, None);
        assert_eq!(status.error_kind, None);
    }

    #[test]
    fn non_status_output_is_ignored() {
        assert!(serde_json::from_str::<BridgeLine>("WebSocket server running").is_err());
        assert!(serde_json::from_str::<BridgeLine>(r#"{"hello":1}"#).is_err());
    }

    #[test]
    fn status_serializes_camel_case_for_the_gui() {
        let value = serde_json::to_value(BrowserBridgeStatus {
            role: Some(BrowserBridgeRole::Remote),
            tab_count: 2,
            extension_connected: true,
            ..BrowserBridgeStatus::with_state(BrowserBridgeState::Running)
        })
        .expect("serialize");
        assert_eq!(value["state"], "running");
        assert_eq!(value["role"], "remote");
        assert_eq!(value["extensionConnected"], true);
        assert_eq!(value["tabCount"], 2);
        assert!(value["errorKind"].is_null());
        assert!(value.get("updatedAt").is_some());
    }

    #[test]
    fn restart_delay_backs_off_to_a_cap() {
        assert_eq!(restart_delay(1), Duration::from_secs(1));
        assert_eq!(restart_delay(2), Duration::from_secs(2));
        assert_eq!(restart_delay(4), Duration::from_secs(8));
        assert_eq!(restart_delay(7), Duration::from_secs(60));
        assert_eq!(restart_delay(u32::MAX), Duration::from_secs(60));
        // Zero is never passed (failures is bumped first) but must not panic.
        assert_eq!(restart_delay(0), Duration::from_secs(1));
    }

    #[test]
    fn crash_after_a_healthy_run_shows_starting_not_error() {
        let previous = BrowserBridgeStatus {
            extension_connected: true,
            tab_count: 4,
            ..BrowserBridgeStatus::with_state(BrowserBridgeState::Running)
        };
        let next = status_after_exit(&previous, true, "signal: 9", Some("Traceback"));
        assert_eq!(next.state, BrowserBridgeState::Starting);
        assert!(!next.extension_connected);
        assert_eq!(next.error, None);
    }

    #[test]
    fn fast_exit_keeps_the_bridges_own_error() {
        let previous = BrowserBridgeStatus::error(
            "http_failed",
            "浏览器控制服务没能在端口 18766 启动。".into(),
        );
        let next = status_after_exit(&previous, false, "exit status: 1", Some("exiting"));
        assert_eq!(next.error_kind.as_deref(), Some("http_failed"));
        assert_eq!(next.error, previous.error);
        assert_eq!(next.pid, None);
    }

    #[test]
    fn fast_exit_without_a_reported_error_quotes_stderr() {
        let previous = BrowserBridgeStatus::with_state(BrowserBridgeState::Starting);
        let next = status_after_exit(
            &previous,
            false,
            "exit status: 1",
            Some("ModuleNotFoundError: No module named 'runner'"),
        );
        assert_eq!(next.state, BrowserBridgeState::Error);
        assert_eq!(next.error_kind.as_deref(), Some("exited"));
        let message = next.error.expect("message");
        assert!(message.contains("exit status: 1"));
        assert!(message.contains("No module named 'runner'"));
    }
}
