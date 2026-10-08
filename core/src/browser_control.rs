//! Browser Control capability for the managed GenericAgent runtime.
//!
//! Galley ships the upstream `tmwd_cdp_bridge` extension as managed GA code,
//! but Chromium should load it from a stable user-data directory rather than
//! directly from the app bundle. This module owns that synced directory and a
//! small probe that verifies the extension can connect to TMWebDriver. The
//! live connection state comes from the resident bridge
//! (`crate::browser_bridge`); with it running, this probe is a remote client
//! of that master and only verifies tab discovery and a script round trip.

#[cfg(target_os = "windows")]
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs, io};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time;

use crate::{managed_runtime, process_command};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlLayout {
    pub extension_dir: String,
    pub source_dir: String,
    pub manifest_version: String,
    pub files_copied: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlProbe {
    pub status: BrowserControlProbeStatus,
    /// Why the probe ended this way; the GUI words each kind itself.
    pub kind: BrowserControlProbeKind,
    pub extension_dir: String,
    pub manifest_version: String,
    pub tab_count: usize,
    pub sample_title: Option<String>,
    /// Core's Chinese sentence: logs and older GUIs only, never the GUI's
    /// main line.
    pub message: Option<String>,
    /// Raw technical text for the failure kinds (the page-script error,
    /// the probe's stderr tail, the exception); `None` otherwise.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserControlProbeStatus {
    Connected,
    ConnectedNoTabs,
    NotConnected,
    Error,
}

/// Mirrored by `gui/src/lib/browser-control.ts` `BrowserControlProbeKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserControlProbeKind {
    /// Tabs listed and the `document.title` round trip worked.
    Connected,
    /// The extension reached the master but lists no operable tab.
    NoTabs,
    /// No extension connection within the wait window (or the probe
    /// process overran it).
    NotConnected,
    /// Tabs listed but `execute_js` raised.
    ScriptFailed,
    /// The probe process printed no parsable result.
    NoResult,
    /// The probe script itself raised.
    Exception,
}

impl BrowserControlProbeKind {
    /// The script's `kind`; an older or unknown one falls back to what
    /// its `status` implies.
    fn from_probe_output(kind: Option<&str>, status: &str) -> Self {
        match kind {
            Some("connected") => Self::Connected,
            Some("no_tabs") => Self::NoTabs,
            Some("not_connected") => Self::NotConnected,
            Some("script_failed") => Self::ScriptFailed,
            Some("no_result") => Self::NoResult,
            Some("exception") => Self::Exception,
            _ => match status {
                "connected" => Self::Connected,
                "connected_no_tabs" => Self::NoTabs,
                "not_connected" => Self::NotConnected,
                _ => Self::Exception,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserControlProbeContext {
    /// The GUI's one-shot verification when the resident bridge first sees
    /// the extension connect while setup is not yet verified.
    AutoVerify,
    Recheck,
    Manual,
}

impl BrowserControlProbeContext {
    fn wait_duration(self) -> Duration {
        match self {
            // Chromium MV3 service workers can be asleep when Galley starts a
            // probe. Keep waiting long enough for the extension's alarm-based
            // reconnect path to fire (to the resident bridge's master, or to
            // the probe's own temporary one when no master is running).
            Self::AutoVerify => Duration::from_secs(35),
            Self::Recheck => Duration::from_secs(35),
            Self::Manual => Duration::from_secs(35),
        }
    }

    fn process_timeout(self) -> Duration {
        self.wait_duration() + Duration::from_secs(3)
    }
}

impl Default for BrowserControlProbeContext {
    fn default() -> Self {
        Self::Manual
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserControlBrowser {
    Chrome,
    Edge,
}

const CHROME_EXTENSION_MANAGEMENT_URL: &str = "chrome://extensions";
const EDGE_EXTENSION_MANAGEMENT_URL: &str = "edge://extensions";
const BROWSER_CONTROL_TEST_PAGE_URL: &str = "https://example.com";
const PROBE_STDERR_TAIL_MAX_CHARS: usize = 240;
const PROBE_NOT_CONNECTED_MESSAGE: &str = "未检测到浏览器插件连接。";

#[cfg(any(target_os = "windows", test))]
const CHROME_EXTENSION_MANAGEMENT_ARGS: &[&str] = &[CHROME_EXTENSION_MANAGEMENT_URL];
#[cfg(any(target_os = "windows", test))]
const EDGE_EXTENSION_MANAGEMENT_ARGS: &[&str] = &["--new-window", EDGE_EXTENSION_MANAGEMENT_URL];

fn extension_management_url(browser: BrowserControlBrowser) -> &'static str {
    match browser {
        BrowserControlBrowser::Chrome => CHROME_EXTENSION_MANAGEMENT_URL,
        BrowserControlBrowser::Edge => EDGE_EXTENSION_MANAGEMENT_URL,
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_extension_management_launch(
    browser: BrowserControlBrowser,
) -> (&'static str, &'static [&'static str]) {
    match browser {
        BrowserControlBrowser::Chrome => ("chrome", CHROME_EXTENSION_MANAGEMENT_ARGS),
        BrowserControlBrowser::Edge => ("msedge", EDGE_EXTENSION_MANAGEMENT_ARGS),
    }
}

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
    version: String,
}

#[derive(Debug, Deserialize)]
struct PythonProbeOutput {
    status: String,
    /// A string, not the enum: an unknown kind must not drop the line.
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    tab_count: usize,
    #[serde(default)]
    sample_title: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    detail: Option<String>,
}

pub fn ensure_for_app(app: &AppHandle) -> std::io::Result<BrowserControlLayout> {
    let diagnostics = managed_runtime::ensure_for_app(app)?;
    let source_dir = PathBuf::from(diagnostics.paths.code_root).join("assets/tmwd_cdp_bridge");
    if !source_dir.join("manifest.json").is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!(
                "browser extension manifest missing at {}",
                source_dir.join("manifest.json").display()
            ),
        ));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;
    let extension_dir = app_data_dir.join("browser-control").join("tmwd_cdp_bridge");
    let (files_copied, manifest_version) = prepare_extension_layout(&source_dir, &extension_dir)?;

    Ok(BrowserControlLayout {
        extension_dir: path_to_string(&extension_dir),
        source_dir: path_to_string(&source_dir),
        manifest_version,
        files_copied,
    })
}

pub async fn probe_for_app(
    app: AppHandle,
    context: BrowserControlProbeContext,
) -> std::io::Result<BrowserControlProbe> {
    let layout = ensure_for_app(&app)?;
    let diagnostics = managed_runtime::ensure_for_app(&app)?;
    let python = resolve_python(&app);
    let code_root = diagnostics.paths.code_root;
    let state_root = diagnostics.paths.state_root;
    let script = python_probe_script();
    let wait_duration = context.wait_duration();

    let mut cmd = Command::new(python);
    process_command::configure_python(&mut cmd);
    let mut child = cmd
        .arg("-c")
        .arg(script)
        .current_dir(&code_root)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("GALLEY_GA_STATE_ROOT", state_root)
        .env("GALLEY_BROWSER_PROBE_CODE_ROOT", code_root)
        .env(
            "GALLEY_BROWSER_PROBE_TIMEOUT_SECONDS",
            format!("{:.3}", wait_duration.as_secs_f64()),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.shutdown().await;
    }

    let output = match time::timeout(context.process_timeout(), child.wait_with_output()).await {
        Ok(output) => output?,
        Err(_) => return Ok(probe_timed_out(layout)),
    };

    Ok(probe_from_output(
        layout,
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    ))
}

/// The probe process overran its wait window: nothing connected in time.
fn probe_timed_out(layout: BrowserControlLayout) -> BrowserControlProbe {
    BrowserControlProbe {
        status: BrowserControlProbeStatus::NotConnected,
        kind: BrowserControlProbeKind::NotConnected,
        extension_dir: layout.extension_dir,
        manifest_version: layout.manifest_version,
        tab_count: 0,
        sample_title: None,
        message: Some(PROBE_NOT_CONNECTED_MESSAGE.into()),
        detail: None,
    }
}

/// Read the probe script's result: the last stdout line that parses as
/// its JSON. With none, the result is `NoResult` carrying the stderr tail
/// (the end of a Python traceback names the error).
fn probe_from_output(
    layout: BrowserControlLayout,
    stdout: &str,
    stderr: &str,
) -> BrowserControlProbe {
    let parsed = stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<PythonProbeOutput>(line).ok());
    let Some(parsed) = parsed else {
        let tail = stderr_tail(stderr);
        return BrowserControlProbe {
            status: BrowserControlProbeStatus::Error,
            kind: BrowserControlProbeKind::NoResult,
            extension_dir: layout.extension_dir,
            manifest_version: layout.manifest_version,
            tab_count: 0,
            sample_title: None,
            message: Some(format!(
                "浏览器控制测试没有返回有效结果。{}",
                tail.as_deref().unwrap_or("")
            )),
            detail: tail,
        };
    };

    let status = match parsed.status.as_str() {
        "connected" => BrowserControlProbeStatus::Connected,
        "connected_no_tabs" => BrowserControlProbeStatus::ConnectedNoTabs,
        "not_connected" => BrowserControlProbeStatus::NotConnected,
        _ => BrowserControlProbeStatus::Error,
    };
    let kind = BrowserControlProbeKind::from_probe_output(parsed.kind.as_deref(), &parsed.status);
    BrowserControlProbe {
        status,
        kind,
        extension_dir: layout.extension_dir,
        manifest_version: layout.manifest_version,
        tab_count: parsed.tab_count,
        sample_title: parsed.sample_title,
        message: parsed.message,
        detail: parsed
            .detail
            .map(|detail| detail.trim().to_string())
            .filter(|detail| !detail.is_empty()),
    }
}

fn stderr_tail(stderr: &str) -> Option<String> {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let skip = trimmed
        .chars()
        .count()
        .saturating_sub(PROBE_STDERR_TAIL_MAX_CHARS);
    Some(trimmed.chars().skip(skip).collect())
}

pub async fn open_extensions_page(browser: BrowserControlBrowser) -> io::Result<()> {
    open_extensions_page_for_platform(browser).await
}

pub async fn open_test_page(browser: BrowserControlBrowser) -> io::Result<()> {
    open_test_page_for_platform(browser).await
}

#[cfg(target_os = "macos")]
async fn open_extensions_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let (bundle_id, app_name, url) = match browser {
        BrowserControlBrowser::Chrome => (
            "com.google.Chrome",
            "Google Chrome",
            extension_management_url(browser),
        ),
        BrowserControlBrowser::Edge => (
            "com.microsoft.edgemac",
            "Microsoft Edge",
            extension_management_url(browser),
        ),
    };
    match run_command("open", &["-b", bundle_id, url]).await {
        Ok(()) => Ok(()),
        Err(_) => run_command("open", &["-a", app_name, url]).await,
    }
}

#[cfg(target_os = "macos")]
async fn open_test_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let (bundle_id, app_name) = match browser {
        BrowserControlBrowser::Chrome => ("com.google.Chrome", "Google Chrome"),
        BrowserControlBrowser::Edge => ("com.microsoft.edgemac", "Microsoft Edge"),
    };
    match run_command("open", &["-b", bundle_id, BROWSER_CONTROL_TEST_PAGE_URL]).await {
        Ok(()) => Ok(()),
        Err(_) => run_command("open", &["-a", app_name, BROWSER_CONTROL_TEST_PAGE_URL]).await,
    }
}

#[cfg(target_os = "windows")]
async fn open_extensions_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let (command, args) = windows_extension_management_launch(browser);
    let mut last_error = None;
    for candidate in windows_browser_candidates(browser) {
        if !candidate.is_file() {
            continue;
        }
        let program = candidate.to_string_lossy().into_owned();
        match spawn_command(&program, args) {
            Ok(()) => return Ok(()),
            Err(e) => last_error = Some(e),
        }
    }
    let mut start_args = vec!["/C", "start", "", command];
    start_args.extend_from_slice(args);
    match run_command("cmd", &start_args).await {
        Ok(()) => Ok(()),
        Err(e) => Err(last_error.unwrap_or(e)),
    }
}

#[cfg(target_os = "windows")]
async fn open_test_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let command = match browser {
        BrowserControlBrowser::Chrome => "chrome",
        BrowserControlBrowser::Edge => "msedge",
    };
    let mut last_error = None;
    for candidate in windows_browser_candidates(browser) {
        if !candidate.is_file() {
            continue;
        }
        let program = candidate.to_string_lossy().into_owned();
        match spawn_command(&program, &[BROWSER_CONTROL_TEST_PAGE_URL]) {
            Ok(()) => return Ok(()),
            Err(e) => last_error = Some(e),
        }
    }
    let start_args = vec!["/C", "start", "", command, BROWSER_CONTROL_TEST_PAGE_URL];
    match run_command("cmd", &start_args).await {
        Ok(()) => Ok(()),
        Err(e) => Err(last_error.unwrap_or(e)),
    }
}

#[cfg(target_os = "windows")]
fn windows_browser_candidates(browser: BrowserControlBrowser) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Some(value) = env::var_os(key) {
            bases.push(PathBuf::from(value));
        }
    }

    let relative = match browser {
        BrowserControlBrowser::Chrome => Path::new("Google/Chrome/Application/chrome.exe"),
        BrowserControlBrowser::Edge => Path::new("Microsoft/Edge/Application/msedge.exe"),
    };
    bases.into_iter().map(|base| base.join(relative)).collect()
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
async fn open_extensions_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let (commands, url): (&[&str], &str) = match browser {
        BrowserControlBrowser::Chrome => (
            &[
                "google-chrome",
                "google-chrome-stable",
                "chromium",
                "chromium-browser",
            ],
            extension_management_url(browser),
        ),
        BrowserControlBrowser::Edge => (
            &["microsoft-edge", "microsoft-edge-stable"],
            extension_management_url(browser),
        ),
    };
    let mut last_error = None;
    for command in commands {
        match spawn_command(command, &[url]) {
            Ok(()) => return Ok(()),
            Err(e) => last_error = Some(e),
        }
    }
    Err(last_error
        .unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "browser command not found")))
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
async fn open_test_page_for_platform(browser: BrowserControlBrowser) -> io::Result<()> {
    let commands: &[&str] = match browser {
        BrowserControlBrowser::Chrome => &[
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ],
        BrowserControlBrowser::Edge => &["microsoft-edge", "microsoft-edge-stable"],
    };
    let mut last_error = None;
    for command in commands {
        match spawn_command(command, &[BROWSER_CONTROL_TEST_PAGE_URL]) {
            Ok(()) => return Ok(()),
            Err(e) => last_error = Some(e),
        }
    }
    Err(last_error
        .unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "browser command not found")))
}

async fn run_command(program: &str, args: &[&str]) -> io::Result<()> {
    let mut cmd = Command::new(program);
    process_command::configure_background(&mut cmd);
    let output = cmd
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(io::Error::other(if stderr.is_empty() {
        format!("{program} exited with {}", output.status)
    } else {
        stderr
    }))
}

#[cfg(not(target_os = "macos"))]
fn spawn_command(program: &str, args: &[&str]) -> io::Result<()> {
    let mut cmd = Command::new(program);
    process_command::configure_background(&mut cmd);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(dest)?;
    let mut count = 0;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if ty.is_dir() {
            count += copy_dir_recursive(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
            count += 1;
        }
    }
    Ok(count)
}

fn prepare_extension_layout(
    source_dir: &Path,
    extension_dir: &Path,
) -> std::io::Result<(usize, String)> {
    // Sync must also REMOVE files deleted or renamed upstream — copying
    // over the live dir left stale scripts in the unpacked extension,
    // mixing versions after upgrades. Stage a fresh copy next to the
    // target and swap it in.
    let staging_dir = staging_dir_for(extension_dir)?;
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)?;
    }
    let files_copied = copy_dir_recursive(source_dir, &staging_dir)?;
    // The generated per-install TID in config.js survives the swap.
    let old_config = extension_dir.join("config.js");
    if old_config.is_file() {
        fs::copy(&old_config, staging_dir.join("config.js"))?;
    }
    ensure_config_js(&staging_dir)?;
    let manifest_version = read_manifest_version(&staging_dir)?;
    if extension_dir.exists() {
        fs::remove_dir_all(extension_dir)?;
    }
    fs::rename(&staging_dir, extension_dir)?;
    Ok((files_copied, manifest_version))
}

fn staging_dir_for(extension_dir: &Path) -> std::io::Result<PathBuf> {
    let name = extension_dir.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "extension dir has no directory name",
        )
    })?;
    Ok(extension_dir.with_file_name(format!("{}.staging", name.to_string_lossy())))
}

fn read_manifest_version(extension_dir: &Path) -> std::io::Result<String> {
    let body = fs::read_to_string(extension_dir.join("manifest.json"))?;
    let manifest = serde_json::from_str::<ExtensionManifest>(&body)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(manifest.version)
}

fn ensure_config_js(extension_dir: &Path) -> std::io::Result<()> {
    let config_path = extension_dir.join("config.js");
    if config_path.is_file() {
        return Ok(());
    }
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    fs::write(
        config_path,
        format!("const TID = '__galley_{:x}';\n", micros % 0xFF_FFFF),
    )
}

pub(crate) fn resolve_python(app: &AppHandle) -> PathBuf {
    if !cfg!(debug_assertions) {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let rel = if cfg!(windows) {
                "python/python.exe"
            } else {
                "python/bin/python3"
            };
            return resource_dir.join(rel);
        }
    }
    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

fn python_probe_script() -> &'static str {
    r#"
import json, os, sys, time, traceback

code_root = os.environ.get("GALLEY_BROWSER_PROBE_CODE_ROOT")
if code_root:
    sys.path.insert(0, code_root)

try:
    from TMWebDriver import TMWebDriver
    driver = TMWebDriver()
    try:
        wait_seconds = float(os.environ.get("GALLEY_BROWSER_PROBE_TIMEOUT_SECONDS", "12"))
    except Exception:
        wait_seconds = 12.0
    deadline = time.time() + max(0.5, wait_seconds)
    sessions = []
    bridge_status = {}
    while time.time() < deadline:
        sessions = driver.get_all_sessions()
        if sessions:
            break
        try:
            bridge_status = driver.get_status()
            if bridge_status.get("extension_connected"):
                break
        except Exception:
            bridge_status = {}
        time.sleep(0.25)
    if not sessions:
        if bridge_status.get("extension_connected"):
            print(json.dumps({
                "status": "connected_no_tabs",
                "kind": "no_tabs",
                "tab_count": 0,
                "message": "浏览器插件已连接，但没有可用网页。"
            }, ensure_ascii=True))
            raise SystemExit(0)
        print(json.dumps({
            "status": "not_connected",
            "kind": "not_connected",
            "tab_count": 0,
            "message": "未检测到浏览器插件连接。"
        }, ensure_ascii=True))
    else:
        session_id = str(sessions[0].get("id"))
        title = None
        try:
            result = driver.execute_js("return document.title", timeout=5, session_id=session_id)
            if isinstance(result, dict):
                title = result.get("data")
            else:
                title = str(result)
        except Exception as exec_error:
            detail = str(exec_error) or type(exec_error).__name__
            print(json.dumps({
                "status": "error",
                "kind": "script_failed",
                "tab_count": len(sessions),
                "message": "插件已连接，但网页脚本测试失败：" + detail,
                "detail": detail
            }, ensure_ascii=True))
            raise SystemExit(0)
        print(json.dumps({
            "status": "connected",
            "kind": "connected",
            "tab_count": len(sessions),
            "sample_title": title,
            "message": "浏览器控制已连接。"
        }, ensure_ascii=True))
except Exception as e:
    detail = str(e) or type(e).__name__
    print(json.dumps({
        "status": "error",
        "kind": "exception",
        "tab_count": 0,
        "message": detail,
        "detail": detail
    }, ensure_ascii=True))
    traceback.print_exc()
"#
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_minimal_extension_source(source_dir: &Path) {
        fs::create_dir_all(source_dir).expect("source dir");
        fs::write(source_dir.join("manifest.json"), r#"{"version":"1.2.3"}"#).expect("manifest");
        fs::write(source_dir.join("content.js"), "console.log('bridge');").expect("content");
    }

    #[test]
    fn probe_contexts_wait_through_mv3_reconnect_alarm() {
        let reconnect_window = Duration::from_secs(35);
        assert_eq!(
            BrowserControlProbeContext::AutoVerify.wait_duration(),
            reconnect_window
        );
        assert_eq!(
            BrowserControlProbeContext::Recheck.wait_duration(),
            reconnect_window
        );
        assert_eq!(
            BrowserControlProbeContext::Manual.wait_duration(),
            reconnect_window
        );
        assert_eq!(
            BrowserControlProbeContext::Manual.process_timeout(),
            reconnect_window + Duration::from_secs(3)
        );
    }

    #[test]
    fn prepare_extension_layout_recreates_missing_directory_and_config() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source_dir = tmp.path().join("source/tmwd_cdp_bridge");
        let extension_dir = tmp.path().join("app-data/browser-control/tmwd_cdp_bridge");
        write_minimal_extension_source(&source_dir);

        let (files_copied, manifest_version) =
            prepare_extension_layout(&source_dir, &extension_dir).expect("prepare layout");

        assert_eq!(files_copied, 2);
        assert_eq!(manifest_version, "1.2.3");
        assert!(extension_dir.join("manifest.json").is_file());
        assert!(extension_dir.join("content.js").is_file());
        let config = fs::read_to_string(extension_dir.join("config.js")).expect("config");
        assert!(config.starts_with("const TID = '__galley_"));
    }

    #[test]
    fn prepare_extension_layout_recreates_missing_config_without_replacing_existing_one() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source_dir = tmp.path().join("source/tmwd_cdp_bridge");
        let extension_dir = tmp.path().join("app-data/browser-control/tmwd_cdp_bridge");
        write_minimal_extension_source(&source_dir);

        prepare_extension_layout(&source_dir, &extension_dir).expect("first prepare");
        fs::remove_file(extension_dir.join("config.js")).expect("remove config");
        prepare_extension_layout(&source_dir, &extension_dir).expect("recreate config");
        assert!(extension_dir.join("config.js").is_file());

        let stable_config = "const TID = '__galley_existing';\n";
        fs::write(extension_dir.join("config.js"), stable_config).expect("write stable config");
        prepare_extension_layout(&source_dir, &extension_dir).expect("preserve config");
        let config = fs::read_to_string(extension_dir.join("config.js")).expect("config");
        assert_eq!(config, stable_config);
    }

    #[test]
    fn prepare_extension_layout_removes_files_deleted_upstream() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source_dir = tmp.path().join("source/tmwd_cdp_bridge");
        let extension_dir = tmp.path().join("app-data/browser-control/tmwd_cdp_bridge");
        write_minimal_extension_source(&source_dir);
        fs::write(source_dir.join("legacy.js"), "old script").expect("write legacy");

        prepare_extension_layout(&source_dir, &extension_dir).expect("first prepare");
        assert!(extension_dir.join("legacy.js").is_file());
        let config = fs::read_to_string(extension_dir.join("config.js")).expect("config");

        // Upstream renamed legacy.js → renamed.js. The old additive copy
        // left legacy.js behind, mixing extension versions after upgrade.
        fs::remove_file(source_dir.join("legacy.js")).expect("remove from source");
        fs::write(source_dir.join("renamed.js"), "new script").expect("write renamed");
        prepare_extension_layout(&source_dir, &extension_dir).expect("resync");

        assert!(!extension_dir.join("legacy.js").exists());
        assert!(extension_dir.join("renamed.js").is_file());
        // The generated per-install config survives the swap.
        assert_eq!(
            fs::read_to_string(extension_dir.join("config.js")).expect("config"),
            config
        );
    }

    fn test_layout() -> BrowserControlLayout {
        BrowserControlLayout {
            extension_dir: "/data/browser-control/tmwd_cdp_bridge".into(),
            source_dir: "/code/assets/tmwd_cdp_bridge".into(),
            manifest_version: "1.2.3".into(),
            files_copied: 2,
        }
    }

    #[test]
    fn probe_output_maps_each_script_branch_to_its_kind() {
        let cases = [
            (
                r#"{"status":"connected","kind":"connected","tab_count":2,"sample_title":"Example Domain","message":"ok"}"#,
                BrowserControlProbeStatus::Connected,
                BrowserControlProbeKind::Connected,
                None,
            ),
            (
                r#"{"status":"connected_no_tabs","kind":"no_tabs","tab_count":0}"#,
                BrowserControlProbeStatus::ConnectedNoTabs,
                BrowserControlProbeKind::NoTabs,
                None,
            ),
            (
                r#"{"status":"not_connected","kind":"not_connected","tab_count":0}"#,
                BrowserControlProbeStatus::NotConnected,
                BrowserControlProbeKind::NotConnected,
                None,
            ),
            (
                r#"{"status":"error","kind":"script_failed","tab_count":1,"detail":"timeout waiting for tab"}"#,
                BrowserControlProbeStatus::Error,
                BrowserControlProbeKind::ScriptFailed,
                Some("timeout waiting for tab"),
            ),
            (
                r#"{"status":"error","kind":"exception","tab_count":0,"detail":"No module named 'bottle'"}"#,
                BrowserControlProbeStatus::Error,
                BrowserControlProbeKind::Exception,
                Some("No module named 'bottle'"),
            ),
        ];
        for (line, status, kind, detail) in cases {
            // Driver chatter before the result line is ignored.
            let stdout = format!("[TMWebDriver] remote client\n{line}\n");
            let probe = probe_from_output(test_layout(), &stdout, "");
            assert_eq!(probe.status, status, "{line}");
            assert_eq!(probe.kind, kind, "{line}");
            assert_eq!(probe.detail.as_deref(), detail, "{line}");
            assert_eq!(probe.extension_dir, "/data/browser-control/tmwd_cdp_bridge");
            assert_eq!(probe.manifest_version, "1.2.3");
        }
    }

    #[test]
    fn probe_output_without_kind_falls_back_to_status() {
        let kind_for = |line: &str| probe_from_output(test_layout(), line, "").kind;
        assert_eq!(
            kind_for(r#"{"status":"connected","tab_count":1}"#),
            BrowserControlProbeKind::Connected
        );
        assert_eq!(
            kind_for(r#"{"status":"connected_no_tabs"}"#),
            BrowserControlProbeKind::NoTabs
        );
        assert_eq!(
            kind_for(r#"{"status":"not_connected"}"#),
            BrowserControlProbeKind::NotConnected
        );
        assert_eq!(
            kind_for(r#"{"status":"error","message":"boom"}"#),
            BrowserControlProbeKind::Exception
        );
        // An unknown kind keeps the line instead of turning it into NoResult.
        assert_eq!(
            kind_for(r#"{"status":"connected","kind":"from_the_future"}"#),
            BrowserControlProbeKind::Connected
        );
        // A blank detail is no detail.
        let probe = probe_from_output(
            test_layout(),
            r#"{"status":"error","kind":"exception","detail":"  "}"#,
            "",
        );
        assert_eq!(probe.detail, None);
    }

    #[test]
    fn probe_output_without_a_result_line_reports_the_stderr_tail() {
        let traceback = format!(
            "Traceback (most recent call last):\n{}\nKilledError: probe interrupted\n",
            "  File \"probe.py\", line 1, in <module>\n".repeat(20)
        );
        let probe = probe_from_output(test_layout(), "not json\n", &traceback);
        assert_eq!(probe.status, BrowserControlProbeStatus::Error);
        assert_eq!(probe.kind, BrowserControlProbeKind::NoResult);
        let detail = probe.detail.expect("stderr tail");
        assert_eq!(detail.chars().count(), PROBE_STDERR_TAIL_MAX_CHARS);
        assert!(detail.ends_with("KilledError: probe interrupted"));
        assert!(probe.message.expect("message").ends_with(&detail));

        let silent = probe_from_output(test_layout(), "", "  \n");
        assert_eq!(silent.kind, BrowserControlProbeKind::NoResult);
        assert_eq!(silent.detail, None);
    }

    #[test]
    fn probe_timeout_reads_as_not_connected_without_detail() {
        let probe = probe_timed_out(test_layout());
        assert_eq!(probe.status, BrowserControlProbeStatus::NotConnected);
        assert_eq!(probe.kind, BrowserControlProbeKind::NotConnected);
        assert_eq!(probe.detail, None);
    }

    #[test]
    fn probe_serializes_kind_and_detail_for_the_gui() {
        let probe = probe_from_output(
            test_layout(),
            r#"{"status":"error","kind":"script_failed","tab_count":1,"message":"m","detail":"boom"}"#,
            "",
        );
        let json = serde_json::to_value(&probe).expect("serialize");
        assert_eq!(json["status"], "error");
        assert_eq!(json["kind"], "script_failed");
        assert_eq!(json["detail"], "boom");
        assert_eq!(json["tabCount"], 1);
        assert_eq!(
            json["extensionDir"],
            "/data/browser-control/tmwd_cdp_bridge"
        );

        let connected = serde_json::to_value(probe_from_output(
            test_layout(),
            r#"{"status":"connected_no_tabs","kind":"no_tabs"}"#,
            "",
        ))
        .expect("serialize");
        assert_eq!(connected["kind"], "no_tabs");
        assert!(connected["detail"].is_null());
    }

    #[test]
    fn extension_management_launch_uses_stable_internal_urls() {
        assert_eq!(
            extension_management_url(BrowserControlBrowser::Chrome),
            "chrome://extensions"
        );
        assert_eq!(
            extension_management_url(BrowserControlBrowser::Edge),
            "edge://extensions"
        );
        assert_eq!(
            windows_extension_management_launch(BrowserControlBrowser::Chrome),
            ("chrome", &["chrome://extensions"][..])
        );
        assert_eq!(
            windows_extension_management_launch(BrowserControlBrowser::Edge),
            ("msedge", &["--new-window", "edge://extensions"][..])
        );
    }
}
