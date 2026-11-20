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
//!
//! Browser auto-open (ticket browser-auto-open 01): the bridge reports the
//! browser program the extension last connected from (`browserApp`), which
//! Core keeps in a pref and hands back as `--known-browser-app`. When a GA
//! session's web tool finds no tab (the extension gone, or connected with no
//! web page: ticket 02), the bridge moves `browserWantedAt`; Core then opens
//! that browser at the setup test page
//! (`browser_control::open_browser_app`), whether or not it is already
//! running: the page gives the extension an http(s) tab to drive and wakes
//! an extension worker that is asleep. Opening at an address and dropping
//! the "already running" check are the main session's amendment of
//! 2026-11-20, kept by JC the same day. Managed runtime only, like the
//! bridge itself.
//! See docs/managed-ga-runtime/browser-control.md.

use std::io;
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

use crate::api::{GalleyApi, RuntimeKind};
use crate::db::SqliteGalley;
use crate::{browser_control, managed_runtime, process_command};

pub const EVENT_NAME: &str = "browser-bridge-updated";
/// The pref the GUI writes when the user switches runtime; `set_pref_json`
/// reconciles the bridge when it changes.
pub const ACTIVE_RUNTIME_KIND_PREF: &str = "active_runtime_kind";
/// The browser program the extension was last seen in (the bridge's
/// `browserApp`, a JSON string): passed back as `--known-browser-app`.
pub const LAST_BROWSER_APP_PREF: &str = "browser_control_last_browser_app";
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
    /// The program the extension connected from in this bridge run.
    #[serde(default)]
    browser_app: Option<String>,
    /// Moves when a GA web tool asked for a page (at most every 30 s).
    #[serde(default)]
    browser_wanted_at: Option<String>,
}

/// The browser fields Core tracks for the current bridge process. Kept
/// out of [`BrowserBridgeStatus`], which the GUI reads unchanged.
#[derive(Debug, Default)]
struct BrowserMemory {
    /// The stored pref, then whatever the bridge recognises.
    app: Option<String>,
    /// The last `browserWantedAt` of this process generation.
    wanted_at: Option<String>,
}

/// What one status line asks of Core about the browser.
#[derive(Debug, Default, PartialEq, Eq)]
struct BrowserLineEffects {
    /// A program that differs from the stored one: write the pref.
    store_app: Option<String>,
    /// Open this program at the setup test page.
    open_app: Option<String>,
}

fn browser_line_effects(memory: &mut BrowserMemory, line: &BridgeLine) -> BrowserLineEffects {
    let mut effects = BrowserLineEffects::default();
    if let Some(app) = line.browser_app.as_deref().filter(|app| !app.is_empty()) {
        if memory.app.as_deref() != Some(app) {
            memory.app = Some(app.to_owned());
            effects.store_app = Some(app.to_owned());
        }
    }
    if let Some(wanted_at) = line.browser_wanted_at.as_deref() {
        if memory.wanted_at.as_deref() != Some(wanted_at) {
            memory.wanted_at = Some(wanted_at.to_owned());
            // No extension, or an extension with no web page to drive.
            if line.state == BrowserBridgeState::Running
                && (!line.extension_connected || line.tab_count == 0)
            {
                effects.open_app = memory.app.clone();
            }
        }
    }
    effects
}

/// The launch, replaceable in tests.
#[async_trait::async_trait]
trait BrowserOpener: Send + Sync {
    async fn open(&self, app: &str) -> io::Result<()>;
}

struct SystemBrowserOpener;

#[async_trait::async_trait]
impl BrowserOpener for SystemBrowserOpener {
    async fn open(&self, app: &str) -> io::Result<()> {
        browser_control::open_browser_app(app).await
    }
}

/// The program's file name, for logs.
fn browser_app_label(app: &str) -> &str {
    app.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(app)
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
    browser: BrowserMemory,
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
            browser: BrowserMemory::default(),
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
        let (generation, known_app) = {
            let mut inner = self.inner.lock().await;
            inner.generation += 1;
            (inner.generation, inner.browser.app.clone())
        };
        let known_app = match known_app {
            Some(known) => Some(known),
            None => read_last_browser_app(app).await,
        };
        let mut child = match spawn_bridge_process(app, known_app.as_deref()) {
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
            inner.browser = BrowserMemory {
                app: known_app,
                wanted_at: None,
            };
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
            let mut inner = self.inner.lock().await;
            if inner.generation != generation {
                continue;
            }
            let effects = browser_line_effects(&mut inner.browser, &parsed);
            let next = status_from_line(parsed, pid);
            let changed = inner.status != next;
            if changed {
                inner.status = next.clone();
            }
            drop(inner);
            if let Some(browser_app) = effects.store_app {
                store_last_browser_app(&app, browser_app).await;
            }
            if let Some(browser_app) = effects.open_app {
                tauri::async_runtime::spawn(async move {
                    // Already logged; nothing else changes on a failure.
                    let _ = open_wanted_browser(&SystemBrowserOpener, &browser_app).await;
                });
            }
            if changed {
                let _ = app.emit(EVENT_NAME, next);
            }
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

/// A GA web tool is waiting for the browser (the bridge moved
/// `browserWantedAt` while the extension was gone): open it at the setup
/// test page, running or not (a running Chromium browser takes the address
/// as a new tab). Failures only log.
async fn open_wanted_browser(opener: &dyn BrowserOpener, browser_app: &str) -> io::Result<()> {
    let label = browser_app_label(browser_app);
    let result = opener.open(browser_app).await;
    match &result {
        Ok(()) => eprintln!("[browser-bridge] browser wanted: opened {label}"),
        Err(e) => eprintln!("[browser-bridge] browser wanted: opening {label} failed: {e}"),
    }
    result
}

async fn read_last_browser_app(app: &AppHandle) -> Option<String> {
    let galley = app.try_state::<SqliteGalley>()?.inner().clone();
    last_browser_app(&galley).await
}

async fn store_last_browser_app(app: &AppHandle, browser_app: String) {
    let Some(galley) = app
        .try_state::<SqliteGalley>()
        .map(|state| state.inner().clone())
    else {
        return;
    };
    if let Err(e) = set_last_browser_app(&galley, browser_app).await {
        eprintln!("[browser-bridge] storing the browser failed: {e:?}");
    }
}

/// The stored program, when the pref holds a non-empty string.
async fn last_browser_app(galley: &SqliteGalley) -> Option<String> {
    let value = galley
        .get_pref_json(LAST_BROWSER_APP_PREF)
        .await
        .ok()
        .flatten()?;
    value
        .as_str()
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
}

async fn set_last_browser_app(
    galley: &SqliteGalley,
    browser_app: String,
) -> crate::error::Result<()> {
    galley
        .set_pref_json(
            LAST_BROWSER_APP_PREF,
            serde_json::Value::String(browser_app),
        )
        .await
}

fn spawn_bridge_process(app: &AppHandle, known_browser_app: Option<&str>) -> Result<Child, String> {
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
    if let Some(known) = known_browser_app {
        cmd.args(["--known-browser-app", known]);
    }
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

    const VIVALDI: &str = "/Applications/Vivaldi.app";

    /// A running line; a connected extension lists one tab.
    fn running(connected: bool, app: Option<&str>, wanted_at: Option<&str>) -> BridgeLine {
        running_tabs(connected, u32::from(connected), app, wanted_at)
    }

    fn running_tabs(
        connected: bool,
        tabs: u32,
        app: Option<&str>,
        wanted_at: Option<&str>,
    ) -> BridgeLine {
        line(
            &serde_json::json!({
                "state": "running",
                "role": "master",
                "extensionConnected": connected,
                "tabCount": tabs,
                "browserApp": app,
                "browserWantedAt": wanted_at,
            })
            .to_string(),
        )
    }

    #[test]
    fn browser_fields_parse_and_stay_out_of_the_gui_status() {
        let parsed = line(
            r#"{"state":"running","role":"master","extensionConnected":false,"tabCount":0,"browserApp":"/Applications/Vivaldi.app","browserWantedAt":"2026-11-20T08:00:00.000Z"}"#,
        );
        assert_eq!(parsed.browser_app.as_deref(), Some(VIVALDI));
        assert_eq!(
            parsed.browser_wanted_at.as_deref(),
            Some("2026-11-20T08:00:00.000Z")
        );
        let value = serde_json::to_value(status_from_line(parsed, None)).expect("serialize");
        assert!(value.get("browserApp").is_none());
        assert!(value.get("browserWantedAt").is_none());

        // An older bridge sends neither field.
        let old =
            line(r#"{"state":"running","role":"master","extensionConnected":true,"tabCount":1}"#);
        assert_eq!(old.browser_app, None);
        assert_eq!(old.browser_wanted_at, None);
    }

    #[test]
    fn a_new_browser_app_is_stored_once() {
        let mut memory = BrowserMemory::default();
        let effects = browser_line_effects(&mut memory, &running(true, Some(VIVALDI), None));
        assert_eq!(effects.store_app.as_deref(), Some(VIVALDI));
        assert_eq!(effects.open_app, None);
        assert_eq!(memory.app.as_deref(), Some(VIVALDI));

        // Same program again, or none: nothing to store.
        let again = browser_line_effects(&mut memory, &running(true, Some(VIVALDI), None));
        assert_eq!(again, BrowserLineEffects::default());
        let none = browser_line_effects(&mut memory, &running(false, None, None));
        assert_eq!(none, BrowserLineEffects::default());
        assert_eq!(memory.app.as_deref(), Some(VIVALDI));
        let empty = browser_line_effects(&mut memory, &running(false, Some(""), None));
        assert_eq!(empty, BrowserLineEffects::default());

        // The stored pref seeds the memory: equal means no write.
        let mut seeded = BrowserMemory {
            app: Some(VIVALDI.into()),
            wanted_at: None,
        };
        let effects = browser_line_effects(&mut seeded, &running(true, Some(VIVALDI), None));
        assert_eq!(effects.store_app, None);
        let edge = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
        let effects = browser_line_effects(&mut seeded, &running(true, Some(edge), None));
        assert_eq!(effects.store_app.as_deref(), Some(edge));
    }

    #[test]
    fn a_moved_browser_wanted_at_opens_only_while_disconnected() {
        let mut memory = BrowserMemory {
            app: Some(VIVALDI.into()),
            wanted_at: None,
        };
        let first = "2026-11-20T08:00:00.000Z";
        let effects = browser_line_effects(&mut memory, &running(false, None, Some(first)));
        assert_eq!(effects.open_app.as_deref(), Some(VIVALDI));

        // The same stamp on later lines does not open again.
        let effects = browser_line_effects(&mut memory, &running(false, None, Some(first)));
        assert_eq!(effects.open_app, None);
        let effects = browser_line_effects(&mut memory, &running(true, None, Some(first)));
        assert_eq!(effects.open_app, None);

        // Moved while the extension is connected: noted, not opened.
        let second = "2026-11-20T08:00:40.000Z";
        let effects = browser_line_effects(&mut memory, &running(true, None, Some(second)));
        assert_eq!(effects.open_app, None);
        assert_eq!(memory.wanted_at.as_deref(), Some(second));

        let third = "2026-11-20T08:01:20.000Z";
        let effects = browser_line_effects(&mut memory, &running(false, None, Some(third)));
        assert_eq!(effects.open_app.as_deref(), Some(VIVALDI));
    }

    #[test]
    fn a_moved_browser_wanted_at_opens_when_connected_without_a_tab() {
        let mut memory = BrowserMemory {
            app: Some(VIVALDI.into()),
            wanted_at: None,
        };
        let first = "2026-11-20T09:00:00.000Z";
        let effects = browser_line_effects(&mut memory, &running_tabs(true, 0, None, Some(first)));
        assert_eq!(effects.open_app.as_deref(), Some(VIVALDI));

        // Connected with a tab: noted, not opened.
        let second = "2026-11-20T09:00:40.000Z";
        let effects = browser_line_effects(&mut memory, &running_tabs(true, 2, None, Some(second)));
        assert_eq!(effects.open_app, None);
        assert_eq!(memory.wanted_at.as_deref(), Some(second));
    }

    #[test]
    fn browser_wanted_without_a_known_browser_opens_nothing() {
        let mut memory = BrowserMemory::default();
        let effects = browser_line_effects(
            &mut memory,
            &running(false, None, Some("2026-11-20T08:00:00.000Z")),
        );
        assert_eq!(effects.open_app, None);
    }

    #[test]
    fn browser_wanted_on_an_error_line_opens_nothing() {
        let mut memory = BrowserMemory {
            app: Some(VIVALDI.into()),
            wanted_at: None,
        };
        let error = line(
            r#"{"state":"error","role":"master","errorKind":"status_failed","error":"x","browserWantedAt":"2026-11-20T08:00:00.000Z"}"#,
        );
        assert_eq!(browser_line_effects(&mut memory, &error).open_app, None);
    }

    #[derive(Default)]
    struct FakeOpener {
        open_fails: bool,
        opened: std::sync::Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl BrowserOpener for FakeOpener {
        async fn open(&self, app: &str) -> io::Result<()> {
            self.opened.lock().unwrap().push(app.to_owned());
            if self.open_fails {
                return Err(io::Error::other("open failed"));
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn a_wanted_browser_is_opened_and_a_failure_is_only_reported() {
        let opener = FakeOpener::default();
        open_wanted_browser(&opener, VIVALDI).await.expect("opened");
        assert_eq!(*opener.opened.lock().unwrap(), vec![VIVALDI.to_owned()]);

        let opener = FakeOpener {
            open_fails: true,
            ..FakeOpener::default()
        };
        let error = open_wanted_browser(&opener, VIVALDI)
            .await
            .expect_err("failed");
        assert!(error.to_string().contains("open failed"));
        assert_eq!(*opener.opened.lock().unwrap(), vec![VIVALDI.to_owned()]);
    }

    #[tokio::test]
    async fn the_browser_app_pref_round_trips() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        crate::apply_all_migrations_for_tests(&pool)
            .await
            .expect("migrate");
        let galley = SqliteGalley::from_pool(pool);
        assert_eq!(last_browser_app(&galley).await, None);

        set_last_browser_app(&galley, VIVALDI.into())
            .await
            .expect("store");
        assert_eq!(last_browser_app(&galley).await.as_deref(), Some(VIVALDI));
        let stored = galley
            .get_pref_json(LAST_BROWSER_APP_PREF)
            .await
            .expect("read");
        assert_eq!(stored, Some(serde_json::json!(VIVALDI)));

        // Anything but a non-empty string counts as unknown.
        for odd in [
            serde_json::json!(""),
            serde_json::json!(3),
            serde_json::json!(null),
        ] {
            galley
                .set_pref_json(LAST_BROWSER_APP_PREF, odd)
                .await
                .expect("store");
            assert_eq!(last_browser_app(&galley).await, None);
        }
    }

    #[test]
    fn browser_app_label_is_the_file_name() {
        assert_eq!(browser_app_label(VIVALDI), "Vivaldi.app");
        assert_eq!(
            browser_app_label("/Applications/Vivaldi.app/"),
            "Vivaldi.app"
        );
        assert_eq!(
            browser_app_label(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            "chrome.exe"
        );
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
