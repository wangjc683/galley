use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(windows)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

static BRIDGE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
static BRIDGE_LOG_READERS: Mutex<Vec<thread::JoinHandle<()>>> = Mutex::new(Vec::new());
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq)]
struct BridgeEndpoint {
    host: String,
    port: u16,
}

impl BridgeEndpoint {
    fn socket_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    fn tcp_addr(&self) -> Option<SocketAddr> {
        (self.host.as_str(), self.port)
            .to_socket_addrs()
            .ok()?
            .find(|addr| addr.ip().is_loopback())
    }
}

fn bridge_endpoint_from_values(
    host: Option<&str>,
    port: Option<&str>,
) -> Result<BridgeEndpoint, String> {
    let host = host.unwrap_or("127.0.0.1").trim();
    if host != "127.0.0.1" && host != "localhost" && host != "::1" {
        return Err("BRIDGE_HOST must be loopback".to_string());
    }
    let port = port
        .unwrap_or("14168")
        .parse::<u16>()
        .map_err(|_| "BRIDGE_PORT must be between 1 and 65535".to_string())?;
    if port == 0 {
        return Err("BRIDGE_PORT must be between 1 and 65535".to_string());
    }
    Ok(BridgeEndpoint {
        host: host.to_string(),
        port,
    })
}

fn bridge_endpoint() -> BridgeEndpoint {
    bridge_endpoint_from_values(
        std::env::var("BRIDGE_HOST").ok().as_deref(),
        std::env::var("BRIDGE_PORT").ok().as_deref(),
    )
    .unwrap_or(BridgeEndpoint {
        host: "127.0.0.1".to_string(),
        port: 14168,
    })
}

const MAX_DIAGNOSTIC_LINES: usize = 100;
const MAX_DIAGNOSTIC_LINE_BYTES: usize = 2 * 1024;

fn sanitize_diagnostic_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    const SENSITIVE_MARKERS: [&str; 12] = [
        "apikey",
        "api_key",
        "authorization",
        "bearer",
        "secret",
        "token",
        "mykey",
        "[session]",
        "[turn]",
        "memory",
        "conversation",
        "llm_history",
    ];
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return "[redacted sensitive diagnostic line]".to_string();
    }

    let mut end = line.len().min(MAX_DIAGNOSTIC_LINE_BYTES);
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    line[..end].to_string()
}

fn push_bounded_log(logs: &mut VecDeque<String>, line: &str) {
    logs.push_back(sanitize_diagnostic_line(line));
    while logs.len() > MAX_DIAGNOSTIC_LINES {
        logs.pop_front();
    }
}

#[derive(Debug, PartialEq)]
enum ListenerIdentity {
    Owned,
    KnownGenericAgent,
    Foreign,
}

fn classify_listener_identity(
    identity: Option<&serde_json::Value>,
    project_dir: &str,
) -> ListenerIdentity {
    let Some(identity) = identity else {
        return ListenerIdentity::Foreign;
    };
    let reported_root = identity
        .get("ga_root")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let reported_build = identity
        .get("build_id")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let reported_pid = identity
        .get("pid")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    if reported_root.is_empty() || reported_pid == 0 {
        return ListenerIdentity::Foreign;
    }
    let same_root = {
        let (reported, expected) = (norm_path(reported_root), norm_path(project_dir));
        #[cfg(windows)]
        {
            reported.eq_ignore_ascii_case(&expected)
        }
        #[cfg(not(windows))]
        {
            reported == expected
        }
    };
    if same_root && reported_build == env!("GA_BUILD_ID") {
        ListenerIdentity::Owned
    } else {
        ListenerIdentity::KnownGenericAgent
    }
}

#[cfg(any(windows, test))]
fn should_retry_without_breakaway(raw_os_error: Option<i32>) -> bool {
    raw_os_error == Some(5)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum BootstrapMode {
    HotStart,
    ColdStart,
    Prepare,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum BootstrapPhase {
    Idle,
    Resolving,
    Preparing,
    StartingService,
    OpeningUi,
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum BootstrapFailureCode {
    ConfigUnresolved,
    PrepareFailed,
    SpawnFailed,
    BridgeShutdownRefused,
    PortConflict,
    ServiceTimeout,
    ServiceExited,
    UiNavigationFailed,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum PortState {
    Free,
    Owned,
    Foreign,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct BootstrapFailure {
    code: BootstrapFailureCode,
    detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapDiagnostics {
    build_id: String,
    platform: String,
    project_dir: String,
    python_path: String,
    port_state: PortState,
    bridge_identity: Option<String>,
    recent_logs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct BootstrapSnapshot {
    seq: u64,
    mode: BootstrapMode,
    phase: BootstrapPhase,
    stage: Option<String>,
    progress: u8,
    failure: Option<BootstrapFailure>,
    diagnostics: BootstrapDiagnostics,
}

fn current_platform() -> String {
    #[cfg(windows)]
    {
        "windows".to_string()
    }
    #[cfg(target_os = "macos")]
    {
        "macos".to_string()
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        "linux".to_string()
    }
}

static BOOTSTRAP_STATE: LazyLock<Mutex<BootstrapSnapshot>> = LazyLock::new(|| {
    Mutex::new(BootstrapSnapshot {
        seq: 0,
        mode: BootstrapMode::ColdStart,
        phase: BootstrapPhase::Idle,
        stage: None,
        progress: 0,
        failure: None,
        diagnostics: BootstrapDiagnostics {
            build_id: env!("GA_BUILD_ID").to_string(),
            platform: current_platform(),
            project_dir: String::new(),
            python_path: String::new(),
            port_state: PortState::Unknown,
            bridge_identity: None,
            recent_logs: Vec::new(),
        },
    })
});

fn write_e2e_bootstrap_snapshot(snapshot: &BootstrapSnapshot) {
    let Some(report_dir) = std::env::var_os("GA_DESKTOP_E2E_REPORT_DIR") else {
        return;
    };
    let report_dir = PathBuf::from(report_dir);
    if report_dir.as_os_str().is_empty() {
        return;
    }
    if std::fs::create_dir_all(&report_dir).is_err() {
        return;
    }

    let Ok(line) = serde_json::to_string(snapshot) else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(report_dir.join("bootstrap-events.jsonl"))
    {
        let _ = writeln!(file, "{line}");
    }

    if let Ok(json) = serde_json::to_vec_pretty(snapshot) {
        let _ = std::fs::write(report_dir.join("bootstrap-latest.json"), json);
    }
}

fn snapshot_update(
    app_handle: Option<&tauri::AppHandle>,
    update: impl FnOnce(&mut BootstrapSnapshot),
) -> BootstrapSnapshot {
    let snapshot = {
        let mut state = BOOTSTRAP_STATE.lock().unwrap();
        update(&mut state);
        state.seq = state.seq.saturating_add(1);
        state.clone()
    };
    if let Some(app_handle) = app_handle {
        let _ = app_handle.emit("bootstrap", snapshot.clone());
    }
    write_e2e_bootstrap_snapshot(&snapshot);
    snapshot
}

fn begin_bootstrap(
    app_handle: &tauri::AppHandle,
    mode: BootstrapMode,
    python_path: &str,
    project_dir: &str,
) {
    snapshot_update(Some(app_handle), |snapshot| {
        snapshot.mode = mode;
        snapshot.phase = BootstrapPhase::Resolving;
        snapshot.stage = Some("validate".to_string());
        snapshot.progress = 5;
        snapshot.failure = None;
        snapshot.diagnostics.project_dir = project_dir.to_string();
        snapshot.diagnostics.python_path = python_path.to_string();
        snapshot.diagnostics.port_state = PortState::Unknown;
        snapshot.diagnostics.bridge_identity = None;
        snapshot.diagnostics.recent_logs.clear();
    });
}

fn set_bootstrap_phase(
    app_handle: &tauri::AppHandle,
    phase: BootstrapPhase,
    stage: Option<&str>,
    progress: u8,
) {
    snapshot_update(Some(app_handle), |snapshot| {
        snapshot.phase = phase;
        snapshot.stage = stage.map(str::to_string);
        snapshot.progress = progress.min(100);
        snapshot.failure = None;
    });
}

fn record_diagnostic_log(app_handle: &tauri::AppHandle, line: &str) {
    if matches!(
        BOOTSTRAP_STATE.lock().unwrap().phase,
        BootstrapPhase::Ready | BootstrapPhase::Failed
    ) {
        return;
    }
    snapshot_update(Some(app_handle), |snapshot| {
        let mut logs: VecDeque<String> = snapshot.diagnostics.recent_logs.drain(..).collect();
        push_bounded_log(&mut logs, line);
        snapshot.diagnostics.recent_logs = logs.into_iter().collect();
    });
}

fn set_port_diagnostics(
    app_handle: &tauri::AppHandle,
    port_state: PortState,
    identity: Option<&serde_json::Value>,
) {
    snapshot_update(Some(app_handle), |snapshot| {
        snapshot.diagnostics.port_state = port_state;
        snapshot.diagnostics.bridge_identity = identity.map(ToString::to_string);
    });
}

#[tauri::command]
fn get_bootstrap_snapshot() -> BootstrapSnapshot {
    BOOTSTRAP_STATE.lock().unwrap().clone()
}

/// Get project root (parent of frontends/)
fn project_root() -> PathBuf {
    std::env::current_exe()
        .expect("cannot get exe path")
        .parent()
        .expect("cannot get exe dir") // frontends/
        .parent()
        .expect("cannot get project root") // project root
        .to_path_buf()
}

/// Directory next to which a self-contained bundle keeps its runtime/ folder.
/// Windows: the exe's folder. Linux: the .AppImage's folder ($APPIMAGE) when launched as an
/// AppImage (current_exe would otherwise point inside the read-only squashfs mount).
/// macOS portable package: the folder containing GenericAgent.app and runtime/.
fn bundle_anchor_dir() -> Option<PathBuf> {
    #[cfg(not(windows))]
    {
        if let Some(p) = std::env::var_os("APPIMAGE") {
            if let Some(d) = PathBuf::from(p).parent() {
                return Some(d.to_path_buf());
            }
        }
    }

    let exe = std::env::current_exe().ok()?;

    #[cfg(target_os = "macos")]
    {
        // current_exe() inside a bundle is:
        //   <package>/GenericAgent.app/Contents/MacOS/GenericAgent
        // Prefer the standard macOS layout where runtime is embedded in the app:
        //   GenericAgent.app/Contents/Resources/runtime/app/agentmain.py
        // Fall back to the old portable layout for compatibility:
        //   <package>/runtime/app/agentmain.py
        let mut d = exe.parent();
        while let Some(dir) = d {
            if dir.extension().and_then(|s| s.to_str()) == Some("app") {
                let resources = dir.join("Contents").join("Resources");
                if resources
                    .join("runtime")
                    .join("app")
                    .join("agentmain.py")
                    .exists()
                {
                    return Some(resources);
                }
                if let Some(parent) = dir.parent() {
                    return Some(parent.to_path_buf());
                }
            }
            d = dir.parent();
        }
    }

    Some(exe.parent()?.to_path_buf())
}

/// Embedded interpreter inside the bundle's runtime/python (base python, before venv).
fn bundle_python() -> Option<PathBuf> {
    let root = bundle_root()?;
    #[cfg(windows)]
    let p = root.join("python").join("python.exe");
    #[cfg(not(windows))]
    let p = root.join("python").join("bin").join("python3");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

fn platform_python_name() -> &'static str {
    #[cfg(windows)]
    {
        "python"
    }
    #[cfg(not(windows))]
    {
        "python3"
    }
}

fn project_venv_python(project: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        project.join(".venv").join("Scripts").join("python.exe")
    }
    #[cfg(not(windows))]
    {
        project.join(".venv").join("bin").join("python")
    }
}

fn portable_python(project: &Path) -> Option<PathBuf> {
    let root = project.join(".portable").join("uv-python");
    #[cfg(windows)]
    let direct = root.join("python.exe");
    #[cfg(not(windows))]
    let direct = root.join("bin").join("python3");
    if direct.is_file() {
        return Some(direct);
    }

    let mut children = std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    children.sort();
    children.into_iter().find_map(|path| {
        #[cfg(windows)]
        let python = path.join("python.exe");
        #[cfg(not(windows))]
        let python = path.join("bin").join("python3");
        python.is_file().then_some(python)
    })
}

fn discover_python_for_project_path(project: &Path, saved_python: Option<&str>) -> String {
    if let Some(python) = bundle_python() {
        return display_path(&python);
    }
    let venv = project_venv_python(project);
    if venv.is_file() {
        return display_path(&venv);
    }
    if let Some(python) = portable_python(project) {
        return display_path(&python);
    }
    if let Some(python) = saved_python
        .map(str::trim)
        .filter(|python| python_interpreter_resolves(python))
    {
        return python.to_string();
    }
    let fallback = platform_python_name();
    if python_interpreter_resolves(fallback) {
        fallback.to_string()
    } else {
        String::new()
    }
}

/// Resolve package, project-local, portable, saved, then PATH Python in that order.
fn find_python() -> String {
    let discovered = discover_python_for_project_path(&project_root(), None);
    if discovered.is_empty() {
        platform_python_name().to_string()
    } else {
        discovered
    }
}

fn python_interpreter_resolves(python_path: &str) -> bool {
    let python_path = python_path.trim();
    if python_path.is_empty() {
        return false;
    }

    let explicit_path = python_path.contains('/') || python_path.contains('\\');
    if explicit_path {
        return PathBuf::from(python_path).is_file();
    }

    let Some(path_entries) = std::env::var_os("PATH") else {
        return false;
    };
    for directory in std::env::split_paths(&path_entries) {
        if directory.join(python_path).is_file() {
            return true;
        }
        #[cfg(windows)]
        {
            let extensions =
                std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string());
            for extension in extensions
                .split(';')
                .filter(|extension| !extension.is_empty())
            {
                if directory
                    .join(format!("{python_path}{extension}"))
                    .is_file()
                    || directory
                        .join(format!("{python_path}{}", extension.to_ascii_lowercase()))
                        .is_file()
                {
                    return true;
                }
            }
        }
    }
    false
}

/// Find the project directory (folder containing agentmain.py).
/// Bundle layout: <exe dir>/runtime/app/agentmain.py. Dev layout: walk up from the exe.
fn find_project_dir() -> Option<String> {
    // Bundle layout: source tucked under <anchor>/runtime/app/
    if let Some(anchor) = bundle_anchor_dir() {
        let app = anchor.join("runtime").join("app");
        if app.join("agentmain.py").exists() {
            return Some(app.to_string_lossy().to_string());
        }
    }

    // Dev/source layout: walk up to 8 levels from the exe location.
    let exe = std::env::current_exe().ok()?;
    let mut dir = Some(exe.parent()?);
    for _ in 0..8 {
        match dir {
            Some(d) => {
                if d.join("agentmain.py").exists() {
                    return Some(d.to_string_lossy().to_string());
                }
                dir = d.parent();
            }
            None => break,
        }
    }
    None
}

fn resolve_settings_path(home_dir: Option<PathBuf>, e2e_override: Option<&str>) -> PathBuf {
    if let Some(path) = e2e_override.filter(|path| !path.trim().is_empty()) {
        return PathBuf::from(path);
    }
    home_dir
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ga_desktop_settings.json")
}

/// Settings file path: ~/.ga_desktop_settings.json.
///
/// Windows resolves the home directory through Known Folders and ignores an overridden
/// USERPROFILE. E2E builds therefore accept an explicit sandbox-owned settings file; the
/// production feature set never reads this override.
fn settings_path() -> PathBuf {
    #[cfg(feature = "e2e")]
    let e2e_override = if std::env::var("GA_E2E").ok().as_deref() == Some("1") {
        std::env::var("GA_E2E_SETTINGS_PATH").ok()
    } else {
        None
    };
    #[cfg(not(feature = "e2e"))]
    let e2e_override: Option<String> = None;

    resolve_settings_path(dirs::home_dir(), e2e_override.as_deref())
}

fn read_settings_from_strict(
    path: &Path,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read Desktop settings: {error}"))?;
    match serde_json::from_str(&content) {
        Ok(serde_json::Value::Object(object)) => Ok(object),
        Ok(_) => Err("Desktop settings must be a JSON object".to_string()),
        Err(error) => Err(format!("cannot parse Desktop settings: {error}")),
    }
}

fn read_settings_from(path: &Path) -> serde_json::Map<String, serde_json::Value> {
    read_settings_from_strict(path).unwrap_or_default()
}

/// Read the settings file as a JSON object (empty object when missing/unparseable).
fn read_settings() -> serde_json::Map<String, serde_json::Value> {
    read_settings_from(&settings_path())
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct SettingsFileLock {
    path: PathBuf,
    token: String,
}

impl SettingsFileLock {
    fn acquire(settings: &Path) -> Result<Self, String> {
        const TIMEOUT: Duration = Duration::from_secs(5);
        const STALE_AFTER: Duration = Duration::from_secs(30);
        let parent = settings
            .parent()
            .ok_or_else(|| "settings path has no parent".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create settings directory: {error}"))?;
        let name = settings
            .file_name()
            .and_then(|part| part.to_str())
            .unwrap_or("ga_desktop_settings.json");
        let path = settings.with_file_name(format!("{name}.lock"));
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let token = format!("{}:{nonce}", std::process::id());
        let deadline = Instant::now() + TIMEOUT;
        loop {
            match std::fs::create_dir(&path) {
                Ok(()) => {
                    if let Err(error) = std::fs::write(path.join("owner"), &token) {
                        let _ = std::fs::remove_dir(&path);
                        return Err(format!("write settings lock owner: {error}"));
                    }
                    return Ok(Self { path, token });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = std::fs::symlink_metadata(&path)
                        .map_err(|error| format!("inspect settings lock: {error}"))?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(format!(
                            "settings lock is not a directory: {}",
                            display_path(&path)
                        ));
                    }
                    let stale = metadata
                        .modified()
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .map(|age| age > STALE_AFTER)
                        .unwrap_or(false);
                    if stale {
                        let tombstone = path.with_file_name(format!("{name}.lock.stale.{nonce}"));
                        if std::fs::rename(&path, &tombstone).is_ok() {
                            let _ = std::fs::remove_dir_all(tombstone);
                            continue;
                        }
                    }
                    if Instant::now() >= deadline {
                        return Err(format!(
                            "timed out waiting for settings lock: {}",
                            display_path(&path)
                        ));
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => return Err(format!("create settings lock: {error}")),
            }
        }
    }
}

impl Drop for SettingsFileLock {
    fn drop(&mut self) {
        let owner = self.path.join("owner");
        if std::fs::read_to_string(&owner).ok().as_deref() == Some(self.token.as_str()) {
            let _ = std::fs::remove_file(owner);
            let _ = std::fs::remove_dir(&self.path);
        }
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

fn write_settings_atomically(path: &Path, value: &serde_json::Value) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "settings path has no parent",
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("ga_desktop_settings.json");
    let temporary = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), nonce));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(text.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        atomic_replace(&temporary, path)?;
        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn update_settings_at(
    path: &Path,
    mutator: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<(), String> {
    let _file_lock = SettingsFileLock::acquire(path)?;
    let mut object = read_settings_from_strict(path)?;
    mutator(&mut object);
    write_settings_atomically(path, &serde_json::Value::Object(object))
        .map_err(|error| format!("cannot write Desktop settings: {error}"))
}

fn update_settings(
    mutator: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    update_settings_at(&settings_path(), mutator)
}

/// Merge `updates` into the existing settings file and write it back, preserving any keys
/// we don't touch. The old code rewrote the file with only python_path/project_dir, which
/// would silently drop sibling keys like `desktop_shortcut`. Always go through here.
fn merge_settings(updates: serde_json::Value) -> Result<(), String> {
    if let serde_json::Value::Object(updates) = updates {
        return update_settings(move |object| {
            for (key, value) in updates {
                object.insert(key, value);
            }
        });
    }
    Err("settings update must be a JSON object".to_string())
}

fn valid_ga_source_override_from(
    settings: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    let source = settings
        .get("ga_source_override")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    if source.is_empty() {
        return None;
    }
    let path = PathBuf::from(source);
    if path.join("agentmain.py").exists() {
        Some(display_path(&path))
    } else {
        None
    }
}

fn effective_ga_root_from(
    project_dir: &str,
    settings: &serde_json::Map<String, serde_json::Value>,
) -> String {
    valid_ga_source_override_from(settings)
        .unwrap_or_else(|| display_path(&builtin_ga_root(project_dir)))
}

/// Desktop-shortcut preference stored in settings under `desktop_shortcut`.
/// None  = never asked (first run)
/// Some(true)/Some(false) = user's remembered choice.
fn read_shortcut_pref() -> Option<bool> {
    read_settings()
        .get("desktop_shortcut")
        .and_then(|v| v.as_bool())
}

fn write_shortcut_pref(enabled: bool) -> Result<(), String> {
    merge_settings(serde_json::json!({ "desktop_shortcut": enabled }))
}

/// Create (or overwrite) a desktop shortcut pointing at the CURRENT exe. Overwriting on every
/// enabled launch is what makes the portable bundle relocatable: move the folder, relaunch, and
/// the shortcut is rewritten to the new path. Windows-only (uses a .lnk via WScript.Shell).
#[cfg(windows)]
fn ensure_desktop_shortcut() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(desktop) = dirs::desktop_dir() else {
        return;
    };
    let lnk = desktop.join("GenericAgent.lnk");
    let work_dir = exe
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| exe.clone());

    let exe_s = exe.to_string_lossy().replace('\'', "''");
    let lnk_s = lnk.to_string_lossy().replace('\'', "''");
    let work_s = work_dir.to_string_lossy().replace('\'', "''");

    // Build the shortcut via WScript.Shell COM, consistent with the existing powershell usage
    // elsewhere in this file. No extra crate needed.
    let script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $sc = $ws.CreateShortcut('{lnk}'); \
         $sc.TargetPath = '{exe}'; \
         $sc.WorkingDirectory = '{work}'; \
         $sc.IconLocation = '{exe}'; \
         $sc.Save()",
        lnk = lnk_s,
        exe = exe_s,
        work = work_s
    );

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &script,
    ]);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let _ = cmd.status();
}

#[cfg(target_os = "linux")]
fn ensure_desktop_shortcut() {
    // Launch target: the AppImage path when running as one, else the current exe. Writing the
    // current path on every enabled launch keeps a relocated bundle's launcher valid.
    let Some(target) = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
    else {
        return;
    };
    let exec = target.to_string_lossy().replace('"', "");
    // Linux .desktop Icon= needs an image file (or themed name), not the AppImage path. The CI
    // ships GenericAgent.png next to the AppImage; fall back to a generic themed icon otherwise.
    let icon = bundle_anchor_dir()
        .map(|d| d.join("GenericAgent.png"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "application-x-executable".to_string());
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=GenericAgent\nComment=GenericAgent Desktop\n\
         Exec=\"{exec}\"\nIcon={icon}\nTerminal=false\nCategories=Utility;Development;\n",
        exec = exec,
        icon = icon
    );
    let write_desktop = |path: &std::path::Path| {
        if std::fs::write(path, &entry).is_ok() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
        }
    };
    if let Some(home) = dirs::home_dir() {
        let apps = home.join(".local/share/applications");
        let _ = std::fs::create_dir_all(&apps);
        write_desktop(&apps.join("GenericAgent.desktop"));
    }
    if let Some(desktop) = dirs::desktop_dir() {
        let _ = std::fs::create_dir_all(&desktop);
        let f = desktop.join("GenericAgent.desktop");
        write_desktop(&f);
        // GNOME marks unknown launchers "untrusted"; flag ours so it runs on double-click. Best effort.
        let _ = Command::new("gio")
            .args(["set", &f.to_string_lossy(), "metadata::trusted", "true"])
            .status();
    }
}

#[cfg(target_os = "macos")]
fn ensure_desktop_shortcut() {
    // The .app is the launchable unit; drop a symlink to it on the Desktop.
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut app: Option<PathBuf> = None;
    let mut d = exe.parent();
    while let Some(dir) = d {
        if dir.extension().and_then(|s| s.to_str()) == Some("app") {
            app = Some(dir.to_path_buf());
            break;
        }
        d = dir.parent();
    }
    let (Some(app), Some(desktop)) = (app, dirs::desktop_dir()) else {
        return;
    };
    let link = desktop.join("GenericAgent.app");
    let _ = std::fs::remove_file(&link);
    let _ = std::os::unix::fs::symlink(&app, &link);
}

#[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
fn ensure_desktop_shortcut() {}

/// First-run shortcut handling for portable bundles (all platforms). Self-heals the shortcut
/// path on every enabled launch (cheap, no UI). The first-run ASK is driven by the frontend
/// (see the `shortcut_should_ask` / `shortcut_decide` commands): a native dialog from this
/// background startup thread has no parent window and gets buried behind the main window on
/// first launch, so the prompt is owned by the web UI instead, which always renders on top.
fn maybe_setup_shortcut() {
    if bundle_root().is_none() {
        return;
    }
    // Only self-heal when the user already opted in. Never prompt here.
    if read_shortcut_pref() == Some(true) {
        ensure_desktop_shortcut();
    }
}

/// Frontend asks whether to show the first-run "create desktop shortcut?" prompt.
/// True only on a portable bundle whose preference has never been set.
#[tauri::command]
fn shortcut_should_ask() -> bool {
    bundle_root().is_some() && read_shortcut_pref().is_none()
}

/// Frontend reports the user's choice. Persists it and creates the shortcut when enabled.
#[tauri::command]
fn shortcut_decide(create: bool) -> Result<(), String> {
    write_shortcut_pref(create)?;
    if create {
        ensure_desktop_shortcut();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn running_inside_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .map(|path| {
            path.components()
                .any(|component| component.as_os_str().to_string_lossy().ends_with(".app"))
        })
        .unwrap_or(false)
}

/// User-set external GenericAgent core. The desktop bridge and conductor remain package-owned;
/// this path is only injected as GA_ROOT. A moved or deleted core falls back to the bundled one.
fn valid_ga_source_override() -> Option<String> {
    valid_ga_source_override_from(&read_settings())
}

/// Remove a single key from the settings file (merge_settings can only add/overwrite).
fn remove_setting(key: &str) -> Result<(), String> {
    let key = key.to_string();
    update_settings(move |object| {
        object.remove(&key);
    })
}

fn restore_setting(key: &str, value: Option<String>) -> Result<(), String> {
    match value {
        Some(value) => merge_settings(serde_json::json!({ key: value })),
        None => remove_setting(key),
    }
}

const RUNTIME_MARKER_FILENAME: &str = ".ga-package-runtime.json";
const RUNTIME_MARKER_SCHEMA: u32 = 1;
const PRESERVED_RUNTIME_PATHS: [&str; 4] = ["mykey.py", "mykey.json", "memory", "temp"];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimePackageMarker {
    schema: u32,
    package: String,
    package_version: String,
    build_id: String,
    source_revision: String,
}

#[derive(Debug, Eq, PartialEq)]
enum RuntimeCopyStatus {
    Current,
    Installed,
    Refreshed,
}

fn expected_runtime_marker() -> RuntimePackageMarker {
    RuntimePackageMarker {
        schema: RUNTIME_MARKER_SCHEMA,
        package: env!("CARGO_PKG_NAME").to_string(),
        package_version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: env!("GA_BUILD_ID").to_string(),
        source_revision: env!("GA_SOURCE_REVISION").to_string(),
    }
}

fn runtime_marker_path(runtime: &Path) -> PathBuf {
    runtime.join(RUNTIME_MARKER_FILENAME)
}

fn read_runtime_marker(runtime: &Path) -> Option<RuntimePackageMarker> {
    let text = std::fs::read_to_string(runtime_marker_path(runtime)).ok()?;
    serde_json::from_str(&text).ok()
}

fn runtime_copy_is_current(runtime: &Path, expected: &RuntimePackageMarker) -> bool {
    runtime.join("agentmain.py").is_file()
        && runtime
            .join("frontends")
            .join("desktop_bridge.py")
            .is_file()
        && read_runtime_marker(runtime).as_ref() == Some(expected)
}

fn remove_fs_path(path: &Path) -> Result<(), String> {
    if path.is_symlink() || path.is_file() {
        std::fs::remove_file(path).map_err(|error| format!("remove {:?}: {error}", path))
    } else if path.is_dir() {
        std::fs::remove_dir_all(path).map_err(|error| format!("remove {:?}: {error}", path))
    } else {
        Ok(())
    }
}

fn copy_dir_replace(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_symlink() || !src.is_dir() {
        return Err(format!("refusing to copy unsafe directory {:?}", src));
    }
    std::fs::create_dir_all(dst).map_err(|error| format!("create {:?}: {error}", dst))?;
    for entry in std::fs::read_dir(src).map_err(|error| format!("read {:?}: {error}", src))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source = entry.path();
        let destination = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err(format!("refusing to copy symbolic link {:?}", source));
        }
        if file_type.is_dir() {
            if destination.exists() && !destination.is_dir() {
                remove_fs_path(&destination)?;
            }
            copy_dir_replace(&source, &destination)?;
        } else if file_type.is_file() {
            if destination.exists() && !destination.is_file() {
                remove_fs_path(&destination)?;
            }
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::copy(&source, &destination)
                .map_err(|error| format!("copy {:?} -> {:?}: {error}", source, destination))?;
        } else {
            return Err(format!("refusing to copy special file {:?}", source));
        }
    }
    Ok(())
}

fn copy_preserved_runtime_data(existing: &Path, staging: &Path) -> Result<(), String> {
    for relative in PRESERVED_RUNTIME_PATHS {
        let source = existing.join(relative);
        if !source.exists() && !source.is_symlink() {
            continue;
        }
        if source.is_symlink() {
            return Err(format!(
                "refusing to preserve symbolic-link user data {:?}",
                source
            ));
        }
        let destination = staging.join(relative);
        remove_fs_path(&destination)?;
        if source.is_dir() {
            copy_dir_replace(&source, &destination)?;
        } else if source.is_file() {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::copy(&source, &destination)
                .map_err(|error| format!("preserve {:?} -> {:?}: {error}", source, destination))?;
        } else {
            return Err(format!("refusing to preserve special file {:?}", source));
        }
    }
    Ok(())
}

fn unique_runtime_sibling(parent: &Path, label: &str) -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for suffix in 0..1000_u32 {
        let candidate = parent.join(format!(
            ".app-{label}-{}-{nanos}-{suffix}",
            std::process::id()
        ));
        if !candidate.exists() && !candidate.is_symlink() {
            return Ok(candidate);
        }
    }
    Err(format!("cannot allocate runtime {label} path"))
}

fn refresh_runtime_copy_with_activation<F>(
    source: &Path,
    destination: &Path,
    preserved_source: Option<&Path>,
    expected: &RuntimePackageMarker,
    activate: F,
) -> Result<RuntimeCopyStatus, String>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    if runtime_copy_is_current(destination, expected) {
        return Ok(RuntimeCopyStatus::Current);
    }
    if source.is_symlink()
        || !source.join("agentmain.py").is_file()
        || !source.join("frontends").join("desktop_bridge.py").is_file()
    {
        return Err(format!(
            "bundled core is incomplete at {}",
            display_path(source)
        ));
    }
    if destination.is_symlink() || (destination.exists() && !destination.is_dir()) {
        return Err(format!(
            "writable runtime is not a safe directory at {}",
            display_path(destination)
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "writable runtime has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("create writable runtime parent: {error}"))?;
    let staging = unique_runtime_sibling(parent, "staging")?;
    std::fs::create_dir(&staging)
        .map_err(|error| format!("create writable runtime staging dir: {error}"))?;

    let prepare_result = (|| {
        copy_dir_replace(source, &staging)?;
        if let Some(existing) =
            preserved_source.or_else(|| destination.is_dir().then_some(destination))
        {
            copy_preserved_runtime_data(existing, &staging)?;
        }
        let marker = serde_json::to_string_pretty(expected)
            .map_err(|error| format!("serialize runtime marker: {error}"))?;
        std::fs::write(runtime_marker_path(&staging), marker + "\n")
            .map_err(|error| format!("write runtime marker: {error}"))?;
        if !runtime_copy_is_current(&staging, expected) {
            return Err("staged writable runtime failed validation".to_string());
        }
        Ok(())
    })();
    if let Err(error) = prepare_result {
        let _ = remove_fs_path(&staging);
        return Err(error);
    }

    let existed = destination.is_dir();
    let rollback = match unique_runtime_sibling(parent, "rollback") {
        Ok(path) => path,
        Err(error) => {
            let _ = remove_fs_path(&staging);
            return Err(error);
        }
    };
    if existed {
        if let Err(error) = std::fs::rename(destination, &rollback) {
            let _ = remove_fs_path(&staging);
            return Err(format!("backup previous writable runtime: {error}"));
        }
    }

    if let Err(error) = activate(&staging, destination) {
        let _ = remove_fs_path(&staging);
        if existed {
            if destination.exists() || destination.is_symlink() {
                let _ = remove_fs_path(destination);
            }
            if let Err(rollback_error) = std::fs::rename(&rollback, destination) {
                return Err(format!(
                    "activate writable runtime: {error}; restore previous runtime from {}: {rollback_error}",
                    display_path(&rollback)
                ));
            }
        }
        return Err(format!("activate writable runtime: {error}"));
    }

    if existed {
        // The activated tree already contains copied user data. This old tree is
        // retained until activation succeeds, then removed on a best-effort basis.
        let _ = remove_fs_path(&rollback);
        Ok(RuntimeCopyStatus::Refreshed)
    } else {
        Ok(RuntimeCopyStatus::Installed)
    }
}

fn refresh_runtime_copy(
    source: &Path,
    destination: &Path,
    expected: &RuntimePackageMarker,
) -> Result<RuntimeCopyStatus, String> {
    refresh_runtime_copy_with_activation(source, destination, None, expected, |staging, active| {
        std::fs::rename(staging, active)
    })
}

fn trusted_legacy_runtime(runtime_parent: &Path) -> Result<Option<PathBuf>, String> {
    if !runtime_parent.is_dir() {
        return Ok(None);
    }
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(runtime_parent)
        .map_err(|error| format!("read legacy runtime parent: {error}"))?
    {
        let entry = entry.map_err(|error| format!("read legacy runtime entry: {error}"))?;
        let version_dir = entry.path();
        if entry.file_name() == "app"
            || entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_symlink()
        {
            continue;
        }
        let version_name = entry.file_name().to_string_lossy().to_string();
        let version_key = version_name
            .split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>();
        let Ok(version_key) = version_key else {
            continue;
        };
        if version_key.is_empty() {
            continue;
        }
        let app = version_dir.join("app");
        if app.is_symlink()
            || !app.is_dir()
            || !app.join("agentmain.py").is_file()
            || !app.join("frontends").join("desktop_bridge.py").is_file()
        {
            continue;
        }
        let Some(marker) = read_runtime_marker(&app) else {
            continue;
        };
        if marker.schema != RUNTIME_MARKER_SCHEMA
            || marker.package != env!("CARGO_PKG_NAME")
            || marker.package_version != version_name
        {
            continue;
        }
        candidates.push((version_key, app));
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(candidates.pop().map(|(_, path)| path))
}

fn refresh_runtime_copy_from_legacy(
    source: &Path,
    legacy: &Path,
    destination: &Path,
    expected: &RuntimePackageMarker,
) -> Result<RuntimeCopyStatus, String> {
    let result = refresh_runtime_copy_with_activation(
        source,
        destination,
        Some(legacy),
        expected,
        |staging, active| std::fs::rename(staging, active),
    )?;
    let _ = remove_fs_path(legacy);
    if let Some(parent) = legacy.parent() {
        let _ = std::fs::remove_dir(parent);
    }
    Ok(result)
}

fn builtin_ga_root(project_dir: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if running_inside_app_bundle() {
            if let Some(data_dir) = dirs::data_dir() {
                return data_dir.join("GenericAgent").join("runtime").join("app");
            }
        }
    }
    PathBuf::from(project_dir)
}

fn ensure_builtin_ga_root(project_dir: &str) -> Result<(), String> {
    if valid_ga_source_override().is_some() {
        return Ok(());
    }
    let source = PathBuf::from(project_dir);
    let destination = builtin_ga_root(project_dir);
    if same_path(&source, &destination) {
        return Ok(());
    }
    let expected = expected_runtime_marker();
    if !destination.exists() {
        if let Some(parent) = destination.parent() {
            if let Some(legacy) = trusted_legacy_runtime(parent)? {
                return refresh_runtime_copy_from_legacy(&source, &legacy, &destination, &expected)
                    .map(|_| ());
            }
        }
    }
    refresh_runtime_copy(&source, &destination, &expected).map(|_| ())
}

fn same_path(a: &Path, b: &Path) -> bool {
    let a = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let b = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    #[cfg(windows)]
    {
        display_path(&a).eq_ignore_ascii_case(&display_path(&b))
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix("\\\\?\\") {
            return rest.to_string();
        }
    }
    value
}

/// Read config from settings file, or auto-discover and save.
/// Self-contained bundles always prefer their own runtime/app over stale user settings,
/// otherwise an old ~/.ga_desktop_settings.json can silently point the UI at a different checkout.
pub fn get_or_discover_config() -> (String, String) {
    let path = settings_path();

    // An external core never replaces project_dir: project_dir locates the package-owned bridge,
    // while sanitize_bundle_env injects the selected core as GA_ROOT.
    if bundle_root().is_some() {
        let python = find_python();
        let project = find_project_dir().unwrap_or_default();
        if !python.is_empty() && !project.is_empty() {
            let _ = merge_settings(serde_json::json!({
                "python_path": python,
                "project_dir": project
            }));
            return (python, project);
        }
    }

    #[cfg(target_os = "macos")]
    let trust_settings = !running_inside_app_bundle();
    #[cfg(not(target_os = "macos"))]
    let trust_settings = true;

    // A packaged macOS app never trusts a stale path from a previous install/translocation.
    if trust_settings && path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let python = val
                    .get("python_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let project = val
                    .get("project_dir")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if python_interpreter_resolves(&python)
                    && !project.is_empty()
                    && PathBuf::from(&project)
                        .join("frontends")
                        .join("desktop_bridge.py")
                        .exists()
                {
                    return (python, project);
                }
            }
        }
    }

    // Auto-discover
    let project = find_project_dir().unwrap_or_default();
    let python = if project.is_empty() {
        find_python()
    } else {
        discover_python_for_project_path(Path::new(&project), None)
    };

    // Save discovered config
    if !python.is_empty() && !project.is_empty() {
        let _ = merge_settings(serde_json::json!({
            "python_path": python,
            "project_dir": project
        }));
    }

    (python, project)
}

/// Self-contained bundle support dir: holds python/, wheels/, install_windows.ps1 and app/.
/// Typical portable layout keeps only the exe (+README) at the top level and tucks everything
/// else under <exe dir>/runtime/. Returns None when this is not a bundle (e.g. dev build).
fn bundle_root() -> Option<PathBuf> {
    let runtime = bundle_anchor_dir()?.join("runtime");
    if runtime.join("app").join("agentmain.py").exists() {
        return Some(runtime);
    }
    None
}

/// Marker written after a successful offline prepare. Lives under runtime/ so it travels
/// with the bundle: a relocated folder stays "prepared" (deps live in the embedded python,
/// which is itself relocatable) and won't re-run prepare.
fn prepared_marker() -> Option<PathBuf> {
    Some(bundle_root()?.join(".prepared"))
}

/// True when this is a self-contained bundle whose python env has not been prepared yet
/// (embedded python present but deps not yet installed into it).
fn needs_first_run_prepare(project_dir: &str) -> bool {
    if project_dir.is_empty() {
        return false;
    }
    bundle_python().is_some() && prepared_marker().map(|m| !m.exists()).unwrap_or(false)
}

/// Clear env vars a host launcher injects pointing at its own runtime. The Linux AppImage exports
/// PYTHONHOME/PYTHONPATH (-> bundled python crashes with "No module named 'encodings'") and
/// LD_LIBRARY_PATH (-> wrong shared libs). Our bundled python / prepare / bridge must run clean.
fn sanitize_bundle_env(cmd: &mut Command, project_dir: &str) {
    cmd.env_remove("PYTHONHOME");
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("LD_LIBRARY_PATH");
    cmd.env("PYTHONDONTWRITEBYTECODE", "1");
    // Stamp the bridge we spawn with this build's id so a later app launch can tell whether the
    // bridge holding :14168 is ours (see bridge_identity_matches / GET /services/identity).
    cmd.env("GA_BUILD_ID", env!("GA_BUILD_ID"));
    let ga_root = effective_ga_root(project_dir);
    if ga_root.is_empty() {
        cmd.env_remove("GA_ROOT");
    } else {
        cmd.env("GA_ROOT", ga_root);
    }
    let endpoint = bridge_endpoint();
    cmd.env("BRIDGE_HOST", &endpoint.host);
    cmd.env("BRIDGE_PORT", endpoint.port.to_string());
}

/// Run the offline prepare (install_windows.ps1 -Mode PrepareOnly) using bundled python + wheels.
/// Streams the script's stdout and forwards GAPROGRESS markers to `report(pct, message)`.
/// Blocking; intended to run on a background thread. Writes ~/.ga_desktop_settings.json.
fn run_offline_prepare(
    project_dir: &str,
    report: &dyn Fn(i32, &str),
    log: &dyn Fn(&str),
) -> Result<(), String> {
    let root = bundle_root().ok_or("cannot locate bundle root")?;
    let wheels = root.join("wheels");

    #[cfg(windows)]
    let (script, py) = (
        root.join("install_windows.ps1"),
        root.join("python").join("python.exe"),
    );
    #[cfg(target_os = "macos")]
    let (script, py) = (
        root.join("install_macos.sh"),
        root.join("python").join("bin").join("python3"),
    );
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let (script, py) = (
        root.join("install_linux.sh"),
        root.join("python").join("bin").join("python3"),
    );

    if !script.exists() || !py.exists() || !wheels.exists() {
        return Err(format!("prepare resources missing under {:?}", root));
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .arg("-PythonPath")
            .arg(&py)
            .arg("-ProjectDir")
            .arg(project_dir)
            .arg("-WheelDir")
            .arg(&wheels)
            .arg("-ExtraPipPackages")
            .arg("fastapi uvicorn websockets")
            // -NoVenv: install deps straight into the embedded python (no venv) so the
            // bundle is relocatable. See prepared_marker / find_python.
            .args(["-Mode", "PrepareOnly", "-SkipNpmInstall", "-NoVenv"]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("bash");
        c.arg(&script)
            .arg("--python-path")
            .arg(&py)
            .arg("--project-dir")
            .arg(project_dir)
            .arg("--wheel-dir")
            .arg(&wheels)
            .arg("--extra-packages")
            .arg("fastapi uvicorn websockets")
            // --no-venv: install deps straight into the embedded python (no venv) so the
            // bundle is relocatable. See prepared_marker / find_python.
            .args(["--mode", "PrepareOnly", "--no-venv"]);
        c
    };

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    sanitize_bundle_env(&mut cmd, project_dir);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch prepare: {}", e))?;

    // Drain both streams concurrently so a verbose prepare cannot deadlock on a full pipe.
    // Only stable stage keys reach the main copy; raw output is retained in diagnostics.
    let (sender, receiver) = std::sync::mpsc::channel::<Option<String>>();
    let mut stream_count = 0;
    if let Some(stdout) = child.stdout.take() {
        stream_count += 1;
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = sender.send(Some(line));
            }
            let _ = sender.send(None);
        });
    }
    if let Some(stderr) = child.stderr.take() {
        stream_count += 1;
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = sender.send(Some(line));
            }
            let _ = sender.send(None);
        });
    }
    drop(sender);

    let mut completed_streams = 0;
    while completed_streams < stream_count {
        match receiver.recv() {
            Ok(Some(line)) => {
                if let Some(key) = line.trim().strip_prefix("GAPROGRESS|") {
                    match key.trim() {
                        "venv" => report(25, "python"),
                        "deps" => report(50, "dependencies"),
                        "done" => report(75, "dependencies"),
                        _ => {}
                    }
                } else {
                    log(&line);
                }
            }
            Ok(None) => completed_streams += 1,
            Err(_) => break,
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("prepare wait failed: {}", e))?;
    if !status.success() {
        return Err(format!("prepare exited with status {:?}", status.code()));
    }
    // Record success so later launches (and relocated copies) skip the prepare step.
    if let Some(marker) = prepared_marker() {
        let _ = std::fs::write(&marker, b"ok\n");
    }
    Ok(())
}

const MAX_IDENTITY_RESPONSE_BYTES: usize = 32 * 1024;
const MAX_IDENTITY_PATH_BYTES: usize = 2 * 1024;
const MAX_IDENTITY_BUILD_BYTES: usize = 256;
const MAX_SHUTDOWN_RESPONSE_BYTES: usize = 4 * 1024;

#[derive(Debug, PartialEq, Eq)]
enum BridgeShutdownResponse {
    Accepted,
    Refused { status: u16, maintenance: bool },
    Indeterminate,
}

fn normalize_bridge_identity(identity: serde_json::Value) -> Option<serde_json::Value> {
    let ga_root = identity.get("ga_root")?.as_str()?;
    let build_id = identity
        .get("build_id")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let pid = identity.get("pid")?.as_u64()?;
    if ga_root.is_empty()
        || ga_root.len() > MAX_IDENTITY_PATH_BYTES
        || build_id.len() > MAX_IDENTITY_BUILD_BYTES
        || pid == 0
    {
        return None;
    }
    Some(serde_json::json!({
        "ga_root": ga_root,
        "build_id": build_id,
        "pid": pid
    }))
}

/// GET /services/identity from a running bridge; returns the parsed JSON (or None when the
/// endpoint is absent — i.e. an older/foreign bridge).
fn bridge_reported_identity() -> Option<serde_json::Value> {
    use std::io::{Read, Write};
    let endpoint = bridge_endpoint();
    let addr = endpoint.tcp_addr()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(800)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "GET /services/identity HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        endpoint.socket_addr(),
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    stream
        .take((MAX_IDENTITY_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut buf)
        .ok()?;
    if buf.len() > MAX_IDENTITY_RESPONSE_BYTES {
        return None;
    }
    let text = String::from_utf8_lossy(&buf);
    let mut response = text.splitn(2, "\r\n\r\n");
    let headers = response.next()?;
    let status = headers.lines().next()?;
    if !(status.starts_with("HTTP/1.1 200 ") || status.starts_with("HTTP/1.0 200 ")) {
        return None;
    }
    let body = response.next()?;
    normalize_bridge_identity(serde_json::from_str(body.trim()).ok()?)
}

fn norm_path(p: &str) -> String {
    std::fs::canonicalize(p)
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string())
}

fn effective_ga_root(project_dir: &str) -> String {
    effective_ga_root_from(project_dir, &read_settings())
}

fn bootstrap_failure(code: BootstrapFailureCode, detail: impl AsRef<str>) -> BootstrapFailure {
    BootstrapFailure {
        code,
        detail: sanitize_diagnostic_line(detail.as_ref()),
    }
}

fn parse_bridge_shutdown_response(response: &[u8]) -> BridgeShutdownResponse {
    // The HTTP status line is authoritative even if an error body is truncated
    // or contains non-UTF-8 bytes. Lossy decoding cannot turn an invalid status
    // line into one of the exact HTTP/version/status tokens accepted below.
    let text = String::from_utf8_lossy(response);
    let Some((status_line, _)) = text.split_once("\r\n") else {
        return BridgeShutdownResponse::Indeterminate;
    };
    let mut parts = status_line.split_ascii_whitespace();
    let Some(version) = parts.next() else {
        return BridgeShutdownResponse::Indeterminate;
    };
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return BridgeShutdownResponse::Indeterminate;
    }
    let Some(raw_status) = parts.next() else {
        return BridgeShutdownResponse::Indeterminate;
    };
    if raw_status.len() != 3 || !raw_status.bytes().all(|byte| byte.is_ascii_digit()) {
        return BridgeShutdownResponse::Indeterminate;
    }
    let Ok(status) = raw_status.parse::<u16>() else {
        return BridgeShutdownResponse::Indeterminate;
    };
    if (200..300).contains(&status) {
        return BridgeShutdownResponse::Accepted;
    }
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.trim())
        .unwrap_or("");
    let maintenance = status == 409
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|document| {
                document
                    .get("code")
                    .and_then(serde_json::Value::as_str)
                    .map(|code| code == "maintenance_conflict")
            })
            .unwrap_or(false);
    BridgeShutdownResponse::Refused {
        status,
        maintenance,
    }
}

fn request_bridge_shutdown() -> BridgeShutdownResponse {
    request_bridge_shutdown_at(&bridge_endpoint())
}

fn request_bridge_shutdown_at(endpoint: &BridgeEndpoint) -> BridgeShutdownResponse {
    use std::io::{Read, Write};
    let Some(addr) = endpoint.tcp_addr() else {
        return BridgeShutdownResponse::Indeterminate;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return BridgeShutdownResponse::Indeterminate;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = format!(
        "POST /services/bridge/exit HTTP/1.1\r\nHost: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        endpoint.socket_addr(),
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return BridgeShutdownResponse::Indeterminate;
    }
    let mut response = Vec::new();
    // A timeout or oversized body must not erase an already received explicit
    // non-2xx status. Parse the bounded prefix; an incomplete status line stays
    // indeterminate and retains the established own-child fallback.
    let _ = stream
        .take(MAX_SHUTDOWN_RESPONSE_BYTES as u64)
        .read_to_end(&mut response);
    parse_bridge_shutdown_response(&response)
}

fn shutdown_refusal_failure(response: BridgeShutdownResponse) -> Option<BootstrapFailure> {
    let BridgeShutdownResponse::Refused {
        status,
        maintenance,
    } = response
    else {
        return None;
    };
    let detail = if maintenance {
        "the Desktop bridge is busy with data maintenance and refused a safe restart".to_string()
    } else {
        format!("the Desktop bridge refused a safe restart with HTTP {status}")
    };
    Some(bootstrap_failure(
        BootstrapFailureCode::BridgeShutdownRefused,
        detail,
    ))
}

fn is_bridge_running() -> bool {
    bridge_endpoint()
        .tcp_addr()
        .is_some_and(|addr| TcpStream::connect(addr).is_ok())
}

fn resolve_existing_listener(
    app_handle: &tauri::AppHandle,
    project_dir: &str,
) -> Result<bool, BootstrapFailure> {
    if !is_bridge_running() {
        if BRIDGE_PROCESS.lock().unwrap().is_some() {
            record_diagnostic_log(
                app_handle,
                "A tracked bridge process no longer owns the local listener; stopping it before retry.",
            );
            stop_tracked_bridge();
        }
        set_port_diagnostics(app_handle, PortState::Free, None);
        return Ok(false);
    }

    let identity = bridge_reported_identity();
    match classify_listener_identity(identity.as_ref(), project_dir) {
        ListenerIdentity::Owned => {
            set_port_diagnostics(app_handle, PortState::Owned, identity.as_ref());
            Ok(true)
        }
        ListenerIdentity::Foreign => {
            set_port_diagnostics(app_handle, PortState::Foreign, None);
            Err(bootstrap_failure(
                BootstrapFailureCode::PortConflict,
                format!(
                    "{} is held by an unidentified process",
                    bridge_endpoint().socket_addr()
                ),
            ))
        }
        ListenerIdentity::KnownGenericAgent => {
            set_port_diagnostics(app_handle, PortState::Foreign, identity.as_ref());
            record_diagnostic_log(
                app_handle,
                "A previous GenericAgent bridge was found; requesting graceful shutdown.",
            );
            if let Some(failure) = shutdown_refusal_failure(request_bridge_shutdown()) {
                record_diagnostic_log(app_handle, &failure.detail);
                return Err(failure);
            }
            let start = Instant::now();
            while is_bridge_running() && start.elapsed() < Duration::from_secs(10) {
                thread::sleep(Duration::from_millis(200));
            }

            if is_bridge_running() {
                let remaining_identity = bridge_reported_identity();
                if classify_listener_identity(remaining_identity.as_ref(), project_dir)
                    != ListenerIdentity::KnownGenericAgent
                {
                    set_port_diagnostics(
                        app_handle,
                        PortState::Foreign,
                        remaining_identity.as_ref(),
                    );
                    return Err(bootstrap_failure(
                        BootstrapFailureCode::PortConflict,
                        "the local listener changed identity while waiting for shutdown",
                    ));
                }
                record_diagnostic_log(
                    app_handle,
                    "The identified old bridge ignored graceful shutdown; it will not be force-stopped.",
                );
                return Err(bootstrap_failure(
                    BootstrapFailureCode::PortConflict,
                    format!(
                        "the identified old bridge did not release {}",
                        bridge_endpoint().socket_addr()
                    ),
                ));
            }

            if is_bridge_running() {
                set_port_diagnostics(
                    app_handle,
                    PortState::Foreign,
                    bridge_reported_identity().as_ref(),
                );
                Err(bootstrap_failure(
                    BootstrapFailureCode::PortConflict,
                    format!(
                        "the identified old bridge did not release {}",
                        bridge_endpoint().socket_addr()
                    ),
                ))
            } else {
                // A bridge spawned by this desktop process may release the socket slightly
                // before its process and pipe readers finish. Reap only that tracked child;
                // an untracked bridge that exited gracefully is left untouched.
                let tracked_child = BRIDGE_PROCESS.lock().unwrap().is_some();
                if tracked_child {
                    stop_tracked_bridge();
                }
                set_port_diagnostics(app_handle, PortState::Free, None);
                Ok(false)
            }
        }
    }
}

fn bridge_command(python_path: &str, project_dir: &str) -> Result<Command, BootstrapFailure> {
    if python_path.trim().is_empty() {
        return Err(bootstrap_failure(
            BootstrapFailureCode::SpawnFailed,
            "Python interpreter path is empty",
        ));
    }
    let dir = PathBuf::from(project_dir);
    let script = dir.join("frontends").join("desktop_bridge.py");
    if !script.exists() {
        return Err(bootstrap_failure(
            BootstrapFailureCode::ConfigUnresolved,
            format!("desktop bridge not found under {}", dir.display()),
        ));
    }

    let mut cmd = Command::new(python_path);
    cmd.arg(&script).current_dir(&dir);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    sanitize_bundle_env(&mut cmd, project_dir);
    Ok(cmd)
}

fn capture_bridge_output<R: std::io::Read + Send + 'static>(
    app_handle: tauri::AppHandle,
    stream_name: &'static str,
    stream: R,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            record_diagnostic_log(&app_handle, &format!("{stream_name}: {line}"));
        }
    })
}

fn join_bridge_log_readers() {
    let readers = std::mem::take(&mut *BRIDGE_LOG_READERS.lock().unwrap());
    for reader in readers {
        let _ = reader.join();
    }
}

fn spawn_bridge_process(
    app_handle: &tauri::AppHandle,
    python_path: &str,
    project_dir: &str,
) -> Result<(), BootstrapFailure> {
    if is_bridge_running() {
        return Err(bootstrap_failure(
            BootstrapFailureCode::PortConflict,
            format!(
                "cannot spawn while {} is already in use",
                bridge_endpoint().socket_addr()
            ),
        ));
    }

    let mut command = bridge_command(python_path, project_dir)?;
    #[cfg(windows)]
    command.creation_flags(0x08000000 | 0x01000000); // CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB

    let spawn_result = command.spawn();
    #[cfg(windows)]
    let mut child = match spawn_result {
        Ok(child) => child,
        Err(error) if should_retry_without_breakaway(error.raw_os_error()) => {
            record_diagnostic_log(
                app_handle,
                "Windows denied CREATE_BREAKAWAY_FROM_JOB; retrying with CREATE_NO_WINDOW.",
            );
            let mut fallback = bridge_command(python_path, project_dir)?;
            fallback.creation_flags(0x08000000); // CREATE_NO_WINDOW
            fallback.spawn().map_err(|fallback_error| {
                bootstrap_failure(
                    BootstrapFailureCode::SpawnFailed,
                    format!("bridge spawn fallback failed: {fallback_error}"),
                )
            })?
        }
        Err(error) => {
            return Err(bootstrap_failure(
                BootstrapFailureCode::SpawnFailed,
                format!("bridge spawn failed: {error}"),
            ));
        }
    };
    #[cfg(not(windows))]
    let mut child = spawn_result.map_err(|error| {
        bootstrap_failure(
            BootstrapFailureCode::SpawnFailed,
            format!("bridge spawn failed: {error}"),
        )
    })?;

    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(capture_bridge_output(app_handle.clone(), "stdout", stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(capture_bridge_output(app_handle.clone(), "stderr", stderr));
    }
    *BRIDGE_LOG_READERS.lock().unwrap() = readers;
    *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    Ok(())
}

fn bridge_exit_status() -> Result<Option<String>, BootstrapFailure> {
    let result = {
        let mut process = BRIDGE_PROCESS.lock().unwrap();
        let result = match process.as_mut() {
            Some(child) => child.try_wait().map_err(|error| {
                bootstrap_failure(
                    BootstrapFailureCode::ServiceExited,
                    format!("failed to inspect bridge process: {error}"),
                )
            })?,
            None => None,
        };
        if result.is_some() {
            *process = None;
        }
        result
    };
    if let Some(status) = result {
        join_bridge_log_readers();
        return Ok(Some(format!("bridge exited with status {status}")));
    }
    Ok(None)
}

fn stop_tracked_bridge() {
    if let Some(mut child) = BRIDGE_PROCESS.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    join_bridge_log_readers();
}

fn wait_for_owned_bridge(
    app_handle: &tauri::AppHandle,
    project_dir: &str,
    timeout: Duration,
) -> Result<(), BootstrapFailure> {
    let start = Instant::now();
    let mut unidentified_since: Option<Instant> = None;
    while start.elapsed() < timeout {
        if let Some(detail) = bridge_exit_status()? {
            return Err(bootstrap_failure(
                BootstrapFailureCode::ServiceExited,
                detail,
            ));
        }

        if let Some(identity) = bridge_reported_identity() {
            match classify_listener_identity(Some(&identity), project_dir) {
                ListenerIdentity::Owned => {
                    set_port_diagnostics(app_handle, PortState::Owned, Some(&identity));
                    return Ok(());
                }
                ListenerIdentity::KnownGenericAgent => {
                    set_port_diagnostics(app_handle, PortState::Foreign, Some(&identity));
                    return Err(bootstrap_failure(
                        BootstrapFailureCode::PortConflict,
                        "a different GenericAgent bridge answered during readiness",
                    ));
                }
                ListenerIdentity::Foreign => {
                    set_port_diagnostics(app_handle, PortState::Foreign, None);
                    return Err(bootstrap_failure(
                        BootstrapFailureCode::PortConflict,
                        "a foreign identity response answered during readiness",
                    ));
                }
            }
        }

        if is_bridge_running() {
            let since = unidentified_since.get_or_insert_with(Instant::now);
            if BRIDGE_PROCESS.lock().unwrap().is_none() || since.elapsed() >= Duration::from_secs(2)
            {
                set_port_diagnostics(app_handle, PortState::Foreign, None);
                return Err(bootstrap_failure(
                    BootstrapFailureCode::PortConflict,
                    "an unidentified process answered during readiness",
                ));
            }
        } else {
            unidentified_since = None;
        }
        thread::sleep(Duration::from_millis(150));
    }

    Err(bootstrap_failure(
        BootstrapFailureCode::ServiceTimeout,
        format!(
            "bridge identity did not become ready within {} seconds",
            timeout.as_secs()
        ),
    ))
}

fn main_ui_url_from_current(mut current_url: tauri::Url) -> Result<tauri::Url, String> {
    if current_url.cannot_be_a_base() {
        return Err("current main window URL cannot resolve an application asset".to_string());
    }
    current_url.set_path("/index.html");
    current_url.set_query(None);
    current_url.set_fragment(None);
    Ok(current_url)
}

fn open_main_window(app_handle: &tauri::AppHandle, dev_mode: bool) -> Result<(), BootstrapFailure> {
    let main_window = app_handle.get_webview_window("main").ok_or_else(|| {
        bootstrap_failure(
            BootstrapFailureCode::UiNavigationFailed,
            "main window is unavailable",
        )
    })?;
    // Derive the target from the webview's current loading.html URL so each
    // platform keeps the asset scheme Tauri selected for it. WebView2 uses
    // http://tauri.localhost while WKWebView uses tauri://localhost.
    let current_url = main_window.url().map_err(|error| {
        bootstrap_failure(
            BootstrapFailureCode::UiNavigationFailed,
            format!("main window URL could not be read: {error}"),
        )
    })?;
    let url = main_ui_url_from_current(current_url.clone())
        .map_err(|error| bootstrap_failure(BootstrapFailureCode::UiNavigationFailed, error))?;
    // Source switches are invoked from index.html. Navigating that same webview while its
    // Tauri command is in flight destroys the JavaScript callback, so the caller never sees
    // the command resolve and a subsequent clear_ga_source can remain blocked. Initial
    // bootstrap still moves loading.html to index.html; hot restarts keep the current page.
    if current_url != url {
        main_window.navigate(url).map_err(|error| {
            bootstrap_failure(
                BootstrapFailureCode::UiNavigationFailed,
                format!("main window navigation failed: {error}"),
            )
        })?;
    }
    main_window.show().map_err(|error| {
        bootstrap_failure(
            BootstrapFailureCode::UiNavigationFailed,
            format!("main window could not be shown: {error}"),
        )
    })?;
    main_window.set_focus().map_err(|error| {
        bootstrap_failure(
            BootstrapFailureCode::UiNavigationFailed,
            format!("main window could not be focused: {error}"),
        )
    })?;

    if dev_mode {
        main_window.open_devtools();
    } else {
        let _ = main_window.eval(
            r#"
            document.addEventListener('keydown', function(e) {
                if (e.key === 'F12' || e.key === 'F5' ||
                    (e.ctrlKey && e.key === 'r') ||
                    (e.ctrlKey && e.shiftKey && e.key === 'I')) {
                    e.preventDefault();
                }
            });
            document.addEventListener('contextmenu', function(e) {
                e.preventDefault();
            });
        "#,
        );
    }

    if let Some(setup_window) = app_handle.get_webview_window("setup") {
        let _ = setup_window.hide();
    }
    Ok(())
}

fn show_bootstrap_recovery(app_handle: &tauri::AppHandle) {
    if let Some(main_window) = app_handle.get_webview_window("main") {
        let _ = main_window.hide();
    }
    if let Some(setup_window) = app_handle.get_webview_window("setup") {
        let _ = setup_window.show();
        let _ = setup_window.set_focus();
    }
}

static BOOTSTRAP_RUN_LOCK: Mutex<()> = Mutex::new(());

fn bootstrap_inner(
    app_handle: &tauri::AppHandle,
    python_path: &str,
    project_dir: &str,
    dev_mode: bool,
) -> Result<(), BootstrapFailure> {
    let project = PathBuf::from(project_dir);
    if project_dir.trim().is_empty()
        || !project.join("agentmain.py").exists()
        || !project.join("frontends").join("desktop_bridge.py").exists()
    {
        return Err(bootstrap_failure(
            BootstrapFailureCode::ConfigUnresolved,
            format!("GenericAgent source was not found at {}", project.display()),
        ));
    }
    if !python_interpreter_resolves(python_path) {
        return Err(bootstrap_failure(
            BootstrapFailureCode::SpawnFailed,
            format!("Python interpreter was not found at {python_path}"),
        ));
    }

    ensure_builtin_ga_root(project_dir)
        .map_err(|detail| bootstrap_failure(BootstrapFailureCode::PrepareFailed, detail))?;

    set_bootstrap_phase(app_handle, BootstrapPhase::Resolving, Some("validate"), 10);
    let expected_ga_root = effective_ga_root(project_dir);
    let prepare_needed = needs_first_run_prepare(project_dir);
    let already_ready = resolve_existing_listener(app_handle, &expected_ga_root)?;
    if already_ready {
        snapshot_update(Some(app_handle), |snapshot| {
            snapshot.mode = BootstrapMode::HotStart
        });
    } else {
        snapshot_update(Some(app_handle), |snapshot| {
            snapshot.mode = if prepare_needed {
                BootstrapMode::Prepare
            } else {
                BootstrapMode::ColdStart
            };
        });
        if prepare_needed {
            set_bootstrap_phase(app_handle, BootstrapPhase::Preparing, Some("validate"), 15);
            let report = |progress: i32, stage: &str| {
                set_bootstrap_phase(
                    app_handle,
                    BootstrapPhase::Preparing,
                    Some(stage),
                    progress.clamp(0, 100) as u8,
                );
            };
            let log = |line: &str| record_diagnostic_log(app_handle, line);
            run_offline_prepare(project_dir, &report, &log)
                .map_err(|detail| bootstrap_failure(BootstrapFailureCode::PrepareFailed, detail))?;
        }

        set_bootstrap_phase(
            app_handle,
            BootstrapPhase::StartingService,
            Some("service"),
            82,
        );
        spawn_bridge_process(app_handle, python_path, project_dir)?;
    }

    set_bootstrap_phase(
        app_handle,
        BootstrapPhase::StartingService,
        Some("service"),
        90,
    );
    let timeout = if prepare_needed && !already_ready {
        Duration::from_secs(60)
    } else {
        Duration::from_secs(30)
    };
    wait_for_owned_bridge(app_handle, &expected_ga_root, timeout)?;

    set_bootstrap_phase(app_handle, BootstrapPhase::OpeningUi, Some("ui"), 98);
    open_main_window(app_handle, dev_mode)?;
    set_bootstrap_phase(app_handle, BootstrapPhase::Ready, None, 100);
    maybe_setup_shortcut();
    Ok(())
}

fn execute_bootstrap(
    app_handle: &tauri::AppHandle,
    python_path: String,
    project_dir: String,
    dev_mode: bool,
) -> Result<(), String> {
    let _run_guard = BOOTSTRAP_RUN_LOCK
        .lock()
        .map_err(|_| "bootstrap lock poisoned".to_string())?;
    let initial_mode = if needs_first_run_prepare(&project_dir) {
        BootstrapMode::Prepare
    } else {
        BootstrapMode::ColdStart
    };
    begin_bootstrap(app_handle, initial_mode, &python_path, &project_dir);

    match bootstrap_inner(app_handle, &python_path, &project_dir, dev_mode) {
        Ok(()) => Ok(()),
        Err(failure) => {
            if should_force_stop_tracked_bridge(failure.code) {
                // This handle only ever refers to a child spawned by this desktop process.
                // It is safe to stop; the unidentified listener itself is never targeted.
                stop_tracked_bridge();
            }
            record_diagnostic_log(app_handle, &failure.detail);
            snapshot_update(Some(app_handle), |snapshot| {
                snapshot.phase = BootstrapPhase::Failed;
                snapshot.progress = snapshot.progress.min(99);
                snapshot.failure = Some(failure.clone());
            });
            show_bootstrap_recovery(app_handle);
            Err(failure.detail)
        }
    }
}

fn should_force_stop_tracked_bridge(code: BootstrapFailureCode) -> bool {
    matches!(
        code,
        BootstrapFailureCode::ServiceTimeout | BootstrapFailureCode::PortConflict
    )
}

async fn execute_bootstrap_async(
    app_handle: tauri::AppHandle,
    python_path: String,
    project_dir: String,
    dev_mode: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_bootstrap(&app_handle, python_path, project_dir, dev_mode)
    })
    .await
    .map_err(|error| format!("bootstrap task failed: {error}"))?
}

fn resolve_requested_bootstrap_config(
    requested_python: String,
    requested_project: String,
) -> Result<(String, String), String> {
    if bundle_root().is_some() {
        return Ok(get_or_discover_config());
    }
    let python = if requested_python.trim().is_empty() {
        let settings = read_settings();
        let saved = settings.get("python_path").and_then(|value| value.as_str());
        discover_python_for_project_path(Path::new(requested_project.trim()), saved)
    } else {
        requested_python
    };
    merge_settings(serde_json::json!({
        "python_path": python,
        "project_dir": requested_project
    }))?;
    Ok((python, requested_project))
}

#[tauri::command]
async fn retry_bootstrap(
    app_handle: tauri::AppHandle,
    python_path: String,
    project_dir: String,
) -> Result<(), String> {
    let (python_path, project_dir) = resolve_requested_bootstrap_config(python_path, project_dir)?;
    execute_bootstrap_async(app_handle, python_path, project_dir, false).await
}

#[tauri::command]
async fn start_bridge_with_config(
    app_handle: tauri::AppHandle,
    python_path: String,
    project_dir: String,
) -> Result<(), String> {
    let (python_path, project_dir) = resolve_requested_bootstrap_config(python_path, project_dir)?;
    execute_bootstrap_async(app_handle, python_path, project_dir, false).await
}

#[tauri::command]
async fn start_bridge(app_handle: tauri::AppHandle) -> Result<(), String> {
    let (python_path, project_dir) = get_or_discover_config();
    execute_bootstrap_async(app_handle, python_path, project_dir, false).await
}

#[tauri::command]
fn get_config() -> (String, String) {
    get_or_discover_config()
}

#[tauri::command]
fn discover_python_for_project(project_dir: String, current_python: Option<String>) -> String {
    discover_python_for_project_path(Path::new(project_dir.trim()), current_python.as_deref())
}

#[tauri::command]
fn export_mykey(content: String) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name("mykey.py")
        .add_filter("Python", &["py"])
        .save_file();
    match path {
        Some(p) => {
            std::fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())?;
            Ok(Some(p.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn pick_directory(title: Option<String>) -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    if let Some(t) = title {
        if !t.is_empty() {
            dlg = dlg.set_title(&t);
        }
    }
    dlg.pick_folder().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn pick_python_interpreter(title: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    #[cfg(windows)]
    {
        dialog = dialog.add_filter("Python", &["exe"]);
    }
    if let Some(value) = title.filter(|value| !value.is_empty()) {
        dialog = dialog.set_title(&value);
    }
    let Some(path) = dialog.pick_file() else {
        return Ok(None);
    };
    if !path.is_file() {
        return Err("the selected Python environment is unavailable".to_string());
    }
    Ok(Some(display_path(&path)))
}

#[tauri::command]
fn pick_data_backup_file(title: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("ZIP", &["zip"]);
    if let Some(value) = title.filter(|value| !value.is_empty()) {
        dialog = dialog.set_title(&value);
    }
    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn pick_data_export_path(default_name: String, title: Option<String>) -> Option<String> {
    let safe_default = Path::new(&default_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.to_ascii_lowercase().ends_with(".zip"))
        .unwrap_or("GenericAgent-data-backup.zip");
    let mut dialog = rfd::FileDialog::new()
        .add_filter("ZIP", &["zip"])
        .set_file_name(safe_default);
    if let Some(value) = title.filter(|value| !value.is_empty()) {
        dialog = dialog.set_title(&value);
    }
    dialog.save_file().map(|mut path| {
        if path.extension().and_then(|value| value.to_str()) != Some("zip") {
            path.set_extension("zip");
        }
        path.to_string_lossy().into_owned()
    })
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.is_file() {
        return Err("the selected file is unavailable".to_string());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&target);
        command
    };
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg("/select,").arg(&target);
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(target.parent().unwrap_or(Path::new(".")));
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("cannot reveal the selected file: {error}"))
}

#[tauri::command]
fn get_ga_source() -> String {
    valid_ga_source_override().unwrap_or_default()
}

fn saved_ga_source_override() -> Option<String> {
    read_settings()
        .get("ga_source_override")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn probe_ga_source(dir: &str) -> Result<(), String> {
    let (python, bundle_project) = get_or_discover_config();
    if python.is_empty() {
        return Err("no python available to run the compatibility probe".to_string());
    }
    let probe = PathBuf::from(&bundle_project)
        .join("frontends")
        .join("ga_contract_probe.py");
    if !probe.exists() {
        return Err("the packaged compatibility probe is missing".to_string());
    }

    let mut command = Command::new(python);
    command.arg(probe).arg(dir);
    sanitize_bundle_env(&mut command, &bundle_project);
    command.env("GA_ROOT", dir);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = command
        .output()
        .map_err(|error| format!("compatibility probe failed to run: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(line) = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
    {
        if let Ok(verdict) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if verdict.get("ok").and_then(|value| value.as_bool()) == Some(true) {
                return Ok(());
            }
            let missing = verdict
                .get("missing")
                .and_then(|value| value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let detail = verdict
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let mut message = "this GenericAgent core is not compatible".to_string();
            if !missing.is_empty() {
                message.push_str(&format!(": missing {missing}"));
            }
            if !detail.is_empty() {
                message.push_str(&format!(" ({detail})"));
            }
            return Err(message);
        }
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!(
        "compatibility probe returned no verdict: {}",
        stderr.lines().last().unwrap_or("")
    ))
}

fn validated_ga_source(dir: &str) -> Result<String, String> {
    let source = PathBuf::from(dir.trim());
    if !source.join("agentmain.py").exists() {
        return Err("not a GenericAgent source: agentmain.py not found".to_string());
    }
    let source = source.canonicalize().unwrap_or(source);
    let source_text = display_path(&source);
    probe_ga_source(&source_text)?;
    Ok(source_text)
}

async fn restart_for_current_source(app_handle: tauri::AppHandle) -> Result<String, String> {
    let (python_path, project_dir) = get_or_discover_config();
    let expected_ga_root = effective_ga_root(&project_dir);
    execute_bootstrap_async(app_handle, python_path, project_dir, false).await?;
    Ok(expected_ga_root)
}

async fn apply_ga_source_with_rollback(
    app_handle: tauri::AppHandle,
    next_override: Option<String>,
    previous_override: Option<String>,
) -> Result<String, String> {
    restore_setting("ga_source_override", next_override)?;
    match restart_for_current_source(app_handle.clone()).await {
        Ok(root) => Ok(root),
        Err(error) => {
            restore_setting("ga_source_override", previous_override).map_err(|rollback_error| {
                format!(
                    "{error}; restoring the previous workspace setting failed: {rollback_error}"
                )
            })?;
            match restart_for_current_source(app_handle).await {
                Ok(_) => Err(error),
                Err(rollback_error) => Err(format!(
                    "{error}; restoring the previous workspace also failed: {rollback_error}"
                )),
            }
        }
    }
}

#[tauri::command]
async fn validate_ga_source(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || validated_ga_source(&dir))
        .await
        .map_err(|error| format!("compatibility probe task failed: {error}"))?
}

#[tauri::command]
async fn set_ga_source(app_handle: tauri::AppHandle, dir: String) -> Result<String, String> {
    let source_text = validate_ga_source(dir).await?;
    let previous_override = saved_ga_source_override();
    apply_ga_source_with_rollback(app_handle, Some(source_text), previous_override).await
}

#[tauri::command]
async fn clear_ga_source(app_handle: tauri::AppHandle) -> Result<String, String> {
    let previous_override = saved_ga_source_override();
    apply_ga_source_with_rollback(app_handle, None, previous_override).await
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MacosTitlebarMetrics {
    traffic_light_center_y: f64,
    traffic_light_right_x: f64,
}

#[cfg(target_os = "macos")]
fn measure_macos_titlebar_metrics(
    webview: &tauri::webview::PlatformWebview,
) -> Result<MacosTitlebarMetrics, String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

    let ns_window = webview.ns_window();
    let webview_handle = webview.inner();
    if ns_window.is_null() || webview_handle.is_null() {
        return Err("macOS titlebar native handles are unavailable".to_string());
    }

    // SAFETY: Tauri documents these handles as the NSWindow and WKWebView for
    // this callback. with_webview schedules the callback on the main thread.
    let window = unsafe { &*ns_window.cast::<NSWindow>() };
    let content_view = unsafe { &*webview_handle.cast::<NSView>() };
    let bounds = content_view.bounds();

    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        let button = window
            .standardWindowButton(kind)
            .ok_or_else(|| "macOS titlebar button is unavailable".to_string())?;
        // SAFETY: AppKit owns the standard button and its superview for the
        // lifetime of this main-thread callback.
        let superview = unsafe { button.superview() }
            .ok_or_else(|| "macOS titlebar button has no superview".to_string())?;
        let rect = content_view.convertRect_fromView(button.frame(), Some(&superview));
        min_y = min_y.min(rect.origin.y);
        max_x = max_x.max(rect.origin.x + rect.size.width);
        max_y = max_y.max(rect.origin.y + rect.size.height);
    }

    let appkit_center_y = min_y + (max_y - min_y) / 2.0;
    let traffic_light_center_y = if content_view.isFlipped() {
        appkit_center_y - bounds.origin.y
    } else {
        bounds.origin.y + bounds.size.height - appkit_center_y
    };
    let metrics = MacosTitlebarMetrics {
        traffic_light_center_y,
        traffic_light_right_x: max_x - bounds.origin.x,
    };
    if !metrics.traffic_light_center_y.is_finite()
        || !metrics.traffic_light_right_x.is_finite()
        || metrics.traffic_light_center_y < 0.0
        || metrics.traffic_light_right_x < 0.0
    {
        return Err("macOS titlebar metrics are invalid".to_string());
    }
    Ok(metrics)
}

#[tauri::command]
async fn get_macos_titlebar_metrics(
    window: tauri::WebviewWindow,
) -> Result<Option<MacosTitlebarMetrics>, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .with_webview(move |webview| {
                let _ = sender.send(measure_macos_titlebar_metrics(&webview));
            })
            .map_err(|error| format!("cannot schedule macOS titlebar measurement: {error}"))?;
        return tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(Duration::from_secs(1))
                .map_err(|_| "macOS titlebar measurement timed out".to_string())?
                .map(Some)
        })
        .await
        .map_err(|error| format!("macOS titlebar measurement task failed: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(None)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let no_autostart = args.iter().any(|a| a == "--no-autostart");
    let dev_mode = args.iter().any(|a| a == "--dev");

    let (eff_py, eff_project) = get_or_discover_config();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let bootstrap_failed = matches!(
                BOOTSTRAP_STATE.lock().unwrap().phase,
                BootstrapPhase::Failed
            );
            if bootstrap_failed {
                if let Some(window) = app.get_webview_window("setup") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    #[cfg(feature = "e2e")]
    let builder = if std::env::var("GA_E2E").ok().as_deref() == Some("1") {
        builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init())
    } else {
        builder
    };

    builder
        .invoke_handler(tauri::generate_handler![
            start_bridge_with_config,
            start_bridge,
            retry_bootstrap,
            get_bootstrap_snapshot,
            get_config,
            discover_python_for_project,
            export_mykey,
            pick_directory,
            pick_python_interpreter,
            pick_data_backup_file,
            pick_data_export_path,
            reveal_in_file_manager,
            get_ga_source,
            validate_ga_source,
            set_ga_source,
            clear_ga_source,
            get_macos_titlebar_metrics,
            shortcut_should_ask,
            shortcut_decide
        ])
        .setup(move |app| {
            // Show the loading window immediately so the first-run prepare isn't a blank screen.
            // The window starts on loading.html (a local page), so no "connection refused" flash.
            if let Some(w) = app.get_webview_window("main") {
                // Windows: remove native decorations at runtime (config keeps them for macOS
                // traffic lights). titleBarStyle:"Overlay" is macOS-only in Tauri v2.
                #[cfg(windows)]
                let _ = w.set_decorations(false);
                let _ = w.show();
            }

            // Windows: system tray so the app can hide-on-close instead of exiting.
            #[cfg(windows)]
            {
                let show_item = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
                let menu = MenuBuilder::new(app)
                    .item(&show_item)
                    .separator()
                    .item(&quit_item)
                    .build()?;

                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("GenericAgent")
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(w) = tray.app_handle().get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            let handle = app.handle().clone();
            let python_path = eff_py.clone();
            let project_dir = eff_project.clone();
            thread::spawn(move || {
                if no_autostart && !is_bridge_running() {
                    begin_bootstrap(
                        &handle,
                        BootstrapMode::ColdStart,
                        &python_path,
                        &project_dir,
                    );
                    let failure = bootstrap_failure(
                        BootstrapFailureCode::Unknown,
                        "automatic bridge startup was disabled by --no-autostart",
                    );
                    snapshot_update(Some(&handle), |snapshot| {
                        snapshot.phase = BootstrapPhase::Failed;
                        snapshot.failure = Some(failure);
                    });
                    show_bootstrap_recovery(&handle);
                } else {
                    let _ = execute_bootstrap(&handle, python_path, project_dir, dev_mode);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" {
                    #[cfg(windows)]
                    {
                        // Windows: hide to tray instead of exiting. Bridge stays alive.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = api;
                        window.app_handle().exit(0);
                    }
                } else if label == "setup" {
                    // Setup closed -> exit if main is not visible
                    if let Some(main_win) = window.app_handle().get_webview_window("main") {
                        if !main_win.is_visible().unwrap_or(false) {
                            window.app_handle().exit(0);
                        }
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_diagnostic_lines_are_replaced_and_long_lines_are_bounded() {
        assert_eq!(
            sanitize_diagnostic_line("Authorization: Bearer super-secret"),
            "[redacted sensitive diagnostic line]"
        );
        assert_eq!(
            sanitize_diagnostic_line("API_KEY=should-not-leak"),
            "[redacted sensitive diagnostic line]"
        );
        assert_eq!(
            sanitize_diagnostic_line("[session] Quarterly planning"),
            "[redacted sensitive diagnostic line]"
        );
        assert_eq!(
            sanitize_diagnostic_line("restored memory entry: personal note"),
            "[redacted sensitive diagnostic line]"
        );
        assert!(sanitize_diagnostic_line(&"x".repeat(4096)).len() <= MAX_DIAGNOSTIC_LINE_BYTES);
    }

    #[test]
    fn recent_log_buffer_keeps_only_the_last_hundred_lines() {
        let mut logs = VecDeque::new();
        for index in 0..125 {
            push_bounded_log(&mut logs, &format!("line-{index}"));
        }
        assert_eq!(logs.len(), MAX_DIAGNOSTIC_LINES);
        assert_eq!(logs.front().map(String::as_str), Some("line-25"));
        assert_eq!(logs.back().map(String::as_str), Some("line-124"));
    }

    #[test]
    fn listener_identity_distinguishes_owned_known_and_foreign_ports() {
        let project = std::env::current_dir().unwrap();
        let project_text = project.to_string_lossy();
        let owned = serde_json::json!({
            "ga_root": project_text,
            "build_id": env!("GA_BUILD_ID"),
            "pid": 100
        });
        let old = serde_json::json!({
            "ga_root": project_text,
            "build_id": "older-build",
            "pid": 101
        });
        assert_eq!(
            classify_listener_identity(Some(&owned), &project_text),
            ListenerIdentity::Owned
        );
        assert_eq!(
            classify_listener_identity(Some(&old), &project_text),
            ListenerIdentity::KnownGenericAgent
        );
        assert_eq!(
            classify_listener_identity(None, &project_text),
            ListenerIdentity::Foreign
        );
        assert_eq!(
            classify_listener_identity(Some(&serde_json::json!({"status": "ok"})), &project_text),
            ListenerIdentity::Foreign
        );
    }

    #[test]
    fn bridge_identity_is_bounded_and_only_keeps_allowlisted_fields() {
        let normalized = normalize_bridge_identity(serde_json::json!({
            "ga_root": "/tmp/GenericAgent",
            "build_id": "build-1",
            "pid": 42,
            "authorization": "must-not-survive"
        }))
        .unwrap();
        assert_eq!(
            normalized.get("ga_root").and_then(|value| value.as_str()),
            Some("/tmp/GenericAgent")
        );
        assert_eq!(
            normalized.get("build_id").and_then(|value| value.as_str()),
            Some("build-1")
        );
        assert_eq!(
            normalized.get("pid").and_then(|value| value.as_u64()),
            Some(42)
        );
        assert!(normalized.get("authorization").is_none());

        assert!(normalize_bridge_identity(serde_json::json!({
            "ga_root": "x".repeat(MAX_IDENTITY_PATH_BYTES + 1),
            "build_id": "build-1",
            "pid": 42
        }))
        .is_none());
        assert!(normalize_bridge_identity(serde_json::json!({
            "ga_root": "/tmp/GenericAgent",
            "build_id": "x".repeat(MAX_IDENTITY_BUILD_BYTES + 1),
            "pid": 42
        }))
        .is_none());
    }

    #[test]
    fn bridge_shutdown_response_distinguishes_acceptance_and_explicit_refusal() {
        assert_eq!(
            parse_bridge_shutdown_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"),
            BridgeShutdownResponse::Accepted
        );
        assert_eq!(
            parse_bridge_shutdown_response(
                b"HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\n\r\n{\"code\":\"maintenance_conflict\"}"
            ),
            BridgeShutdownResponse::Refused {
                status: 409,
                maintenance: true,
            }
        );
        assert_eq!(
            parse_bridge_shutdown_response(b"HTTP/1.0 503 Unavailable\r\n\r\n"),
            BridgeShutdownResponse::Refused {
                status: 503,
                maintenance: false,
            }
        );
        assert_eq!(
            parse_bridge_shutdown_response(b"HTTP/1.1 409"),
            BridgeShutdownResponse::Indeterminate
        );
        assert_eq!(
            parse_bridge_shutdown_response(b"NOT-HTTP 200 OK\r\n\r\n"),
            BridgeShutdownResponse::Indeterminate
        );
        let mut non_utf8_refusal = b"HTTP/1.1 503 Unavailable\r\n\r\n".to_vec();
        non_utf8_refusal.push(0xff);
        assert_eq!(
            parse_bridge_shutdown_response(&non_utf8_refusal),
            BridgeShutdownResponse::Refused {
                status: 503,
                maintenance: false,
            }
        );
    }

    #[test]
    fn explicit_shutdown_refusal_never_allows_force_stopping_the_tracked_bridge() {
        let failure = shutdown_refusal_failure(BridgeShutdownResponse::Refused {
            status: 409,
            maintenance: true,
        })
        .unwrap();
        assert_eq!(failure.code, BootstrapFailureCode::BridgeShutdownRefused);
        assert!(failure.detail.contains("data maintenance"));
        assert!(!should_force_stop_tracked_bridge(failure.code));
        assert!(should_force_stop_tracked_bridge(
            BootstrapFailureCode::PortConflict
        ));
        assert!(should_force_stop_tracked_bridge(
            BootstrapFailureCode::ServiceTimeout
        ));
    }

    #[test]
    fn shutdown_request_honors_a_live_bridge_maintenance_refusal() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::mpsc;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (request_sender, request_receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let length = stream.read(&mut request).unwrap();
            request_sender.send(request[..length].to_vec()).unwrap();
            let body = br#"{"code":"maintenance_conflict"}"#;
            write!(
                stream,
                "HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        });
        let endpoint = BridgeEndpoint {
            host: "127.0.0.1".to_string(),
            port,
        };

        assert_eq!(
            request_bridge_shutdown_at(&endpoint),
            BridgeShutdownResponse::Refused {
                status: 409,
                maintenance: true,
            }
        );
        let request = String::from_utf8(request_receiver.recv().unwrap()).unwrap();
        assert!(request.starts_with("POST /services/bridge/exit HTTP/1.1\r\n"));
        server.join().unwrap();
    }

    #[test]
    fn breakaway_fallback_is_limited_to_access_denied() {
        assert!(should_retry_without_breakaway(Some(5)));
        assert!(!should_retry_without_breakaway(Some(2)));
        assert!(!should_retry_without_breakaway(None));
    }

    #[test]
    fn python_validation_rejects_an_unresolvable_explicit_path() {
        let current_exe = std::env::current_exe().unwrap();
        assert!(python_interpreter_resolves(&current_exe.to_string_lossy()));
        assert!(!python_interpreter_resolves(
            "/definitely/missing/genericagent-python"
        ));
    }

    #[test]
    fn project_python_discovery_prefers_venv_then_sorted_portable_then_saved() {
        let root = std::env::temp_dir().join(format!(
            "ga-python-discovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let portable_a = root.join(".portable").join("uv-python").join("a");
        let portable_z = root.join(".portable").join("uv-python").join("z");
        #[cfg(windows)]
        let portable_a_python = portable_a.join("python.exe");
        #[cfg(not(windows))]
        let portable_a_python = portable_a.join("bin").join("python3");
        #[cfg(windows)]
        let portable_z_python = portable_z.join("python.exe");
        #[cfg(not(windows))]
        let portable_z_python = portable_z.join("bin").join("python3");
        std::fs::create_dir_all(portable_a_python.parent().unwrap()).unwrap();
        std::fs::create_dir_all(portable_z_python.parent().unwrap()).unwrap();
        std::fs::write(&portable_a_python, []).unwrap();
        std::fs::write(&portable_z_python, []).unwrap();

        let current_exe = std::env::current_exe().unwrap();
        assert_eq!(
            discover_python_for_project_path(&root, Some(current_exe.to_str().unwrap())),
            display_path(&portable_a_python)
        );

        let venv = project_venv_python(&root);
        std::fs::create_dir_all(venv.parent().unwrap()).unwrap();
        std::fs::write(&venv, []).unwrap();
        assert_eq!(
            discover_python_for_project_path(&root, Some(current_exe.to_str().unwrap())),
            display_path(&venv)
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn bridge_endpoint_uses_defaults_and_validates_overrides() {
        let default = bridge_endpoint_from_values(None, None).unwrap();
        assert_eq!(default.host, "127.0.0.1");
        assert_eq!(default.port, 14168);
        assert_eq!(default.socket_addr(), "127.0.0.1:14168");

        let custom = bridge_endpoint_from_values(Some("localhost"), Some("24168")).unwrap();
        assert_eq!(custom.host, "localhost");
        assert_eq!(custom.port, 24168);

        assert!(bridge_endpoint_from_values(Some("0.0.0.0"), Some("24168")).is_err());
        assert!(bridge_endpoint_from_values(Some("127.0.0.1"), Some("0")).is_err());
        assert!(bridge_endpoint_from_values(Some("127.0.0.1"), Some("bad")).is_err());
    }

    #[test]
    fn main_ui_url_keeps_the_platform_asset_origin() {
        let windows = main_ui_url_from_current(
            tauri::Url::parse("http://tauri.localhost/loading.html?phase=ready#status").unwrap(),
        )
        .unwrap();
        assert_eq!(windows.as_str(), "http://tauri.localhost/index.html");

        let macos =
            main_ui_url_from_current(tauri::Url::parse("tauri://localhost/loading.html").unwrap())
                .unwrap();
        assert_eq!(macos.as_str(), "tauri://localhost/index.html");

        let dev = main_ui_url_from_current(
            tauri::Url::parse("http://localhost:5173/loading.html").unwrap(),
        )
        .unwrap();
        assert_eq!(dev.as_str(), "http://localhost:5173/index.html");

        let current = tauri::Url::parse("tauri://localhost/index.html").unwrap();
        assert_eq!(main_ui_url_from_current(current.clone()).unwrap(), current);
    }

    #[test]
    fn main_ui_url_rejects_non_hierarchical_urls() {
        let data_url = tauri::Url::parse("data:text/plain,loading").unwrap();
        assert!(main_ui_url_from_current(data_url).is_err());
    }

    #[test]
    fn explicit_e2e_settings_path_wins_over_platform_home_resolution() {
        let resolved = resolve_settings_path(
            Some(PathBuf::from("C:\\Users\\runneradmin")),
            Some("C:\\sandbox\\home\\.ga_desktop_settings.json"),
        );
        assert_eq!(
            resolved,
            PathBuf::from("C:\\sandbox\\home\\.ga_desktop_settings.json")
        );

        assert_eq!(
            resolve_settings_path(Some(PathBuf::from("/home/user")), None),
            PathBuf::from("/home/user/.ga_desktop_settings.json")
        );
    }

    fn runtime_test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ga-runtime-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn settings_update_rejects_malformed_json_without_overwriting_it() {
        let root = runtime_test_root("settings-malformed");
        let settings = root.join(".ga_desktop_settings.json");
        let malformed = b"{\"ga_source_override\":";
        std::fs::write(&settings, malformed).unwrap();

        let error = update_settings_at(&settings, |document| {
            document.insert("desktop_shortcut".to_string(), serde_json::json!(true));
        })
        .unwrap_err();

        assert!(error.contains("cannot parse Desktop settings"));
        assert_eq!(std::fs::read(&settings).unwrap(), malformed);
        assert!(!settings
            .with_file_name(".ga_desktop_settings.json.lock")
            .exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_lock_serializes_read_modify_replace_and_preserves_union() {
        use std::sync::mpsc;

        let root = runtime_test_root("settings-union");
        let settings = root.join(".ga_desktop_settings.json");
        std::fs::write(&settings, "{}\n").unwrap();
        let (locked_sender, locked_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let first_path = settings.clone();
        let first = thread::spawn(move || {
            let _lock = SettingsFileLock::acquire(&first_path).unwrap();
            let mut document = read_settings_from_strict(&first_path).unwrap();
            locked_sender.send(()).unwrap();
            release_receiver.recv().unwrap();
            document.insert("ui".to_string(), serde_json::json!({"lang": "en"}));
            write_settings_atomically(&first_path, &serde_json::Value::Object(document)).unwrap();
        });
        locked_receiver.recv().unwrap();
        let second_path = settings.clone();
        let second = thread::spawn(move || {
            update_settings_at(&second_path, |document| {
                document.insert("conductor".to_string(), serde_json::json!({"llmNo": 2}));
            })
            .unwrap();
        });
        thread::sleep(Duration::from_millis(100));
        assert!(!second.is_finished());
        release_sender.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();

        let document = read_settings_from_strict(&settings).unwrap();
        assert_eq!(document.get("ui"), Some(&serde_json::json!({"lang": "en"})));
        assert_eq!(
            document.get("conductor"),
            Some(&serde_json::json!({"llmNo": 2}))
        );
        assert!(!settings
            .with_file_name(".ga_desktop_settings.json.lock")
            .exists());
        let residue = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(residue, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserved_external_override_drives_spawn_and_listener_identity() {
        let root = runtime_test_root("external-identity");
        let package = root.join("bundle").join("app");
        let external = root.join("external-core");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("agentmain.py"), "# external").unwrap();
        let mut settings = serde_json::Map::new();
        settings.insert(
            "ga_source_override".to_string(),
            serde_json::json!(display_path(&external)),
        );
        settings.insert("conductor".to_string(), serde_json::json!({"llmNo": 3}));
        settings.insert("desktop_shortcut".to_string(), serde_json::json!(true));
        settings.insert("unknown".to_string(), serde_json::json!({"keep": true}));
        settings.insert(
            "python_path".to_string(),
            serde_json::json!("/bundle/python"),
        );
        settings.insert(
            "project_dir".to_string(),
            serde_json::json!(display_path(&package)),
        );
        settings.insert(
            "bridge_script".to_string(),
            serde_json::json!(display_path(&package.join("frontends/desktop_bridge.py"))),
        );

        let expected_root = effective_ga_root_from(&display_path(&package), &settings);
        let identity = serde_json::json!({
            "ga_root": expected_root,
            "build_id": env!("GA_BUILD_ID"),
            "pid": 42
        });

        assert_eq!(expected_root, display_path(&external));
        assert_eq!(
            classify_listener_identity(Some(&identity), &expected_root),
            ListenerIdentity::Owned
        );
        assert_eq!(settings["conductor"], serde_json::json!({"llmNo": 3}));
        assert_eq!(settings["desktop_shortcut"], serde_json::json!(true));
        assert_eq!(settings["unknown"], serde_json::json!({"keep": true}));
        std::fs::remove_dir_all(root).unwrap();
    }

    fn seed_package_runtime(root: &Path, agent_text: &str, bridge_text: &str) {
        std::fs::create_dir_all(root.join("frontends")).unwrap();
        std::fs::create_dir_all(root.join("memory")).unwrap();
        std::fs::create_dir_all(root.join("temp")).unwrap();
        std::fs::write(root.join("agentmain.py"), agent_text).unwrap();
        std::fs::write(
            root.join("frontends").join("desktop_bridge.py"),
            bridge_text,
        )
        .unwrap();
        std::fs::write(root.join("memory").join("package-default.md"), "package").unwrap();
        std::fs::write(root.join("temp").join("package-cache.txt"), "package").unwrap();
        std::fs::write(root.join("mykey_template.py"), "# template").unwrap();
    }

    fn write_runtime_marker(root: &Path, marker: &RuntimePackageMarker) {
        std::fs::write(
            runtime_marker_path(root),
            serde_json::to_string_pretty(marker).unwrap(),
        )
        .unwrap();
    }

    fn runtime_tree_bytes(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        fn collect(root: &Path, folder: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
            for entry in std::fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    collect(root, &path, output);
                } else {
                    output.push((
                        path.strip_prefix(root).unwrap().to_path_buf(),
                        std::fs::read(path).unwrap(),
                    ));
                }
            }
        }

        let mut output = Vec::new();
        collect(root, root, &mut output);
        output.sort_by(|left, right| left.0.cmp(&right.0));
        output
    }

    #[test]
    fn fresh_runtime_install_never_writes_the_packaged_source() {
        let root = runtime_test_root("fresh-install");
        let package = root
            .join("GenericAgent.app")
            .join("Contents")
            .join("Resources");
        let runtime = root.join("application-support").join("app");
        seed_package_runtime(&package, "packaged agent", "packaged bridge");
        let package_before = runtime_tree_bytes(&package);
        let expected = expected_runtime_marker();

        let result = refresh_runtime_copy(&package, &runtime, &expected).unwrap();

        assert_eq!(result, RuntimeCopyStatus::Installed);
        assert_eq!(runtime_tree_bytes(&package), package_before);
        assert!(!runtime_marker_path(&package).exists());
        assert_eq!(read_runtime_marker(&runtime), Some(expected));
        assert_eq!(
            std::fs::read_to_string(runtime.join("agentmain.py")).unwrap(),
            "packaged agent"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_same_version_runtime_refreshes_package_code_and_preserves_user_data() {
        let root = runtime_test_root("refresh");
        let package = root.join("signed-package-app");
        let runtime = root.join("application-support").join("app");
        seed_package_runtime(&package, "new agent", "new bridge");
        seed_package_runtime(&runtime, "old fork agent", "old fork bridge");

        std::fs::write(runtime.join("mykey.py"), "user key").unwrap();
        std::fs::write(runtime.join("mykey.json"), "user json key").unwrap();
        std::fs::write(runtime.join("memory").join("user.md"), "remember me").unwrap();
        std::fs::remove_file(runtime.join("memory").join("package-default.md")).unwrap();
        let responses = runtime.join("temp").join("model_responses");
        let sessions = runtime.join("temp").join("desktop_sessions");
        std::fs::create_dir_all(&responses).unwrap();
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(responses.join("response.txt"), "response").unwrap();
        std::fs::write(sessions.join("sess-one.json"), "session").unwrap();
        std::fs::write(
            runtime.join("temp").join("tui_v3_settings.json"),
            "settings",
        )
        .unwrap();
        std::fs::write(runtime.join("temp").join("token_ledger.jsonl"), "ledger").unwrap();
        let host_settings = root.join(".ga_desktop_settings.json");
        std::fs::write(&host_settings, "host settings").unwrap();

        let expected = expected_runtime_marker();
        let mut old_marker = expected.clone();
        old_marker.build_id = "old-fork-build".to_string();
        old_marker.source_revision = "old-fork-source".to_string();
        write_runtime_marker(&runtime, &old_marker);

        let result = refresh_runtime_copy(&package, &runtime, &expected).unwrap();

        assert_eq!(result, RuntimeCopyStatus::Refreshed);
        assert_eq!(
            std::fs::read_to_string(runtime.join("agentmain.py")).unwrap(),
            "new agent"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("frontends").join("desktop_bridge.py")).unwrap(),
            "new bridge"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("mykey.py")).unwrap(),
            "user key"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("mykey.json")).unwrap(),
            "user json key"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("memory").join("user.md")).unwrap(),
            "remember me"
        );
        assert!(!runtime.join("memory").join("package-default.md").exists());
        assert_eq!(
            std::fs::read_to_string(responses.join("response.txt")).unwrap(),
            "response"
        );
        assert_eq!(
            std::fs::read_to_string(sessions.join("sess-one.json")).unwrap(),
            "session"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("temp").join("tui_v3_settings.json")).unwrap(),
            "settings"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("temp").join("token_ledger.jsonl")).unwrap(),
            "ledger"
        );
        assert_eq!(read_runtime_marker(&runtime), Some(expected));
        assert_eq!(
            std::fs::read_to_string(&host_settings).unwrap(),
            "host settings"
        );
        assert_eq!(
            std::fs::read_to_string(package.join("agentmain.py")).unwrap(),
            "new agent"
        );
        assert!(!runtime_marker_path(&package).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn matching_runtime_marker_keeps_hot_start_copy_untouched() {
        let root = runtime_test_root("current");
        let package = root.join("signed-package-app");
        let runtime = root.join("application-support").join("app");
        seed_package_runtime(&package, "new package bytes", "new package bridge");
        seed_package_runtime(&runtime, "already active bytes", "already active bridge");
        let expected = expected_runtime_marker();
        write_runtime_marker(&runtime, &expected);

        let result = refresh_runtime_copy(&package, &runtime, &expected).unwrap();

        assert_eq!(result, RuntimeCopyStatus::Current);
        assert_eq!(
            std::fs::read_to_string(runtime.join("agentmain.py")).unwrap(),
            "already active bytes"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_runtime_activation_restores_old_code_marker_and_user_data() {
        let root = runtime_test_root("rollback");
        let package = root.join("signed-package-app");
        let runtime = root.join("application-support").join("app");
        seed_package_runtime(&package, "new agent", "new bridge");
        seed_package_runtime(&runtime, "old agent", "old bridge");
        std::fs::write(runtime.join("mykey.py"), "user key").unwrap();
        std::fs::write(runtime.join("memory").join("user.md"), "user memory").unwrap();
        let expected = expected_runtime_marker();
        let mut old_marker = expected.clone();
        old_marker.build_id = "old-build".to_string();
        write_runtime_marker(&runtime, &old_marker);

        let error = refresh_runtime_copy_with_activation(
            &package,
            &runtime,
            None,
            &expected,
            |_staging, _destination| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "simulated activation failure",
                ))
            },
        )
        .unwrap_err();

        assert!(error.contains("simulated activation failure"));
        assert_eq!(
            std::fs::read_to_string(runtime.join("agentmain.py")).unwrap(),
            "old agent"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("mykey.py")).unwrap(),
            "user key"
        );
        assert_eq!(
            std::fs::read_to_string(runtime.join("memory").join("user.md")).unwrap(),
            "user memory"
        );
        assert_eq!(read_runtime_marker(&runtime), Some(old_marker));
        let leftovers = std::fs::read_dir(runtime.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".app-"))
            .count();
        assert_eq!(leftovers, 0);
        assert_eq!(
            std::fs::read_to_string(package.join("agentmain.py")).unwrap(),
            "new agent"
        );
        assert!(!runtime_marker_path(&package).exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_versioned_runtime_migrates_into_stable_root_with_all_user_data() {
        let root = runtime_test_root("legacy-migration");
        let package = root.join("signed-package-app");
        let runtime_parent = root.join("application-support").join("runtime");
        let legacy = runtime_parent.join("0.2.0").join("app");
        let stable = runtime_parent.join("app");
        seed_package_runtime(&package, "new agent", "new bridge");
        seed_package_runtime(&legacy, "old agent", "old bridge");
        std::fs::write(legacy.join("mykey.py"), "user key").unwrap();
        std::fs::write(legacy.join("mykey.json"), "user json key").unwrap();
        std::fs::write(legacy.join("memory").join("user.md"), "memory").unwrap();
        std::fs::create_dir_all(legacy.join("temp").join("desktop_sessions")).unwrap();
        std::fs::write(
            legacy
                .join("temp")
                .join("desktop_sessions")
                .join("sess.json"),
            "session",
        )
        .unwrap();
        std::fs::write(legacy.join("temp").join("token_ledger.jsonl"), "ledger").unwrap();
        let mut legacy_marker = expected_runtime_marker();
        legacy_marker.package_version = "0.2.0".to_string();
        legacy_marker.build_id = "old-build".to_string();
        write_runtime_marker(&legacy, &legacy_marker);
        let mut expected = expected_runtime_marker();
        expected.package_version = "0.2.1".to_string();
        expected.build_id = "new-build".to_string();

        assert_eq!(
            trusted_legacy_runtime(&runtime_parent).unwrap(),
            Some(legacy.clone())
        );
        let result =
            refresh_runtime_copy_from_legacy(&package, &legacy, &stable, &expected).unwrap();

        assert_eq!(result, RuntimeCopyStatus::Installed);
        assert_eq!(
            std::fs::read_to_string(stable.join("agentmain.py")).unwrap(),
            "new agent"
        );
        assert_eq!(
            std::fs::read_to_string(stable.join("mykey.py")).unwrap(),
            "user key"
        );
        assert_eq!(
            std::fs::read_to_string(stable.join("mykey.json")).unwrap(),
            "user json key"
        );
        assert_eq!(
            std::fs::read_to_string(stable.join("memory").join("user.md")).unwrap(),
            "memory"
        );
        assert_eq!(
            std::fs::read_to_string(
                stable
                    .join("temp")
                    .join("desktop_sessions")
                    .join("sess.json")
            )
            .unwrap(),
            "session"
        );
        assert_eq!(
            std::fs::read_to_string(stable.join("temp").join("token_ledger.jsonl")).unwrap(),
            "ledger"
        );
        assert_eq!(read_runtime_marker(&stable), Some(expected));
        assert!(!legacy.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_legacy_runtime_activation_leaves_legacy_data_and_no_stable_root() {
        let root = runtime_test_root("legacy-rollback");
        let package = root.join("signed-package-app");
        let legacy = root.join("runtime").join("0.2.0").join("app");
        let stable = root.join("runtime").join("app");
        seed_package_runtime(&package, "new agent", "new bridge");
        seed_package_runtime(&legacy, "old agent", "old bridge");
        std::fs::write(legacy.join("mykey.py"), "user key").unwrap();
        let expected = expected_runtime_marker();

        let error = refresh_runtime_copy_with_activation(
            &package,
            &stable,
            Some(&legacy),
            &expected,
            |_staging, _active| {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "simulated migration activation failure",
                ))
            },
        )
        .unwrap_err();

        assert!(error.contains("simulated migration activation failure"));
        assert!(!stable.exists());
        assert_eq!(
            std::fs::read_to_string(legacy.join("agentmain.py")).unwrap(),
            "old agent"
        );
        assert_eq!(
            std::fs::read_to_string(legacy.join("mykey.py")).unwrap(),
            "user key"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
