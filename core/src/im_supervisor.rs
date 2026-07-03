//! Galley-managed IM Supervisor process management.
//!
//! The process is Galley-owned managed runtime state, not an external
//! GenericAgent checkout.

use crate::api::GalleyApi;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::managed_model_config;
use crate::managed_prompt;
use crate::managed_runtime;
use crate::process_command;
use crate::runner_commands::prepare_managed_runtime_context;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

const EVENT_NAME: &str = "im-supervisor-updated";
const WECHAT: &str = "wechat";
const FEISHU: &str = "feishu";
const WECHAT_PREF: &str = "im_supervisor_wechat";
const FEISHU_PREF: &str = "im_supervisor_feishu";
const FEISHU_CONFIG_PREF: &str = "im_supervisor_feishu_config";
const FEISHU_SECRET_REF: &str = "im-supervisor:feishu:app-secret";
const GALLEY_CORE_PID_ENV: &str = "GALLEY_CORE_PID";
const PLATFORMS: [&str; 2] = [WECHAT, FEISHU];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImSupervisorState {
    NotConnected,
    Starting,
    WaitingScan,
    Reconnecting,
    Running,
    Expired,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImSupervisorStatus {
    pub platform: String,
    pub state: ImSupervisorState,
    pub enabled: bool,
    pub pid: Option<u32>,
    pub bot_id: Option<String>,
    pub qr_image_path: Option<String>,
    pub last_error: Option<String>,
    pub model_config_revision: Option<String>,
    pub model_config_stale: bool,
    pub updated_at: String,
}

impl ImSupervisorStatus {
    fn with_pref(
        mut self,
        pref: ImSupervisorPref,
        current_revision: Option<String>,
    ) -> ImSupervisorStatus {
        self.enabled = pref.enabled;
        self.model_config_stale = model_config_stale(
            self.model_config_revision.as_ref(),
            current_revision.as_ref(),
            pref.enabled,
        );
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ImSupervisorPref {
    enabled: bool,
    auto_start: bool,
    model_config_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FeishuConfigPref {
    app_id: String,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuImConfig {
    pub app_id: String,
    pub has_app_secret: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFeishuImConfigInput {
    pub app_id: String,
    pub app_secret: Option<String>,
}

struct ProcessSlot {
    child: Option<Arc<Mutex<Child>>>,
    status: ImSupervisorStatus,
}

#[derive(Default)]
pub struct ImSupervisorManager {
    slots: Mutex<HashMap<String, ProcessSlot>>,
    /// One lock per platform serializing whole lifecycle operations
    /// (start/stop/logout/restart/stop_all). `start_inner` spans many
    /// awaits between its status check and `set_slot`; without this,
    /// autostart racing a manual Connect double-spawns and the loser's
    /// process leaks untracked — the slot holds a dead child while the
    /// live bot has no handle, so Stop can't kill it and quit's
    /// `stop_all` misses it.
    wechat_lifecycle: Mutex<()>,
    feishu_lifecycle: Mutex<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImSupervisorLine {
    platform: Option<String>,
    state: ImSupervisorState,
    bot_id: Option<String>,
    qr_image_path: Option<String>,
    last_error: Option<String>,
    updated_at: Option<String>,
}

impl ImSupervisorManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lifecycle_lock(&self, platform: &str) -> &Mutex<()> {
        if platform == FEISHU {
            &self.feishu_lifecycle
        } else {
            &self.wechat_lifecycle
        }
    }

    pub async fn status(
        &self,
        app: &AppHandle,
        platform: String,
    ) -> Result<ImSupervisorStatus, String> {
        let platform = normalize_platform(&platform)?;
        if let Some(status) = self.current_status(platform).await {
            let pref = read_pref(platform).await;
            let current_revision = read_model_config_revision().await;
            return Ok(status.with_pref(pref, current_revision));
        }
        self.derived_status(app, platform).await
    }

    pub async fn start(
        self: &Arc<Self>,
        app: AppHandle,
        platform: String,
        relogin: bool,
    ) -> Result<ImSupervisorStatus, String> {
        self.start_inner(app, platform, relogin, false).await
    }

    async fn start_inner(
        self: &Arc<Self>,
        app: AppHandle,
        platform: String,
        relogin: bool,
        force_restart: bool,
    ) -> Result<ImSupervisorStatus, String> {
        let platform = normalize_platform(&platform)?;
        let _lifecycle = self.lifecycle_lock(platform).lock().await;
        if let Some(status) = self.current_status(platform).await {
            if matches!(
                status.state,
                ImSupervisorState::Starting
                    | ImSupervisorState::WaitingScan
                    | ImSupervisorState::Reconnecting
                    | ImSupervisorState::Running
            ) {
                if !relogin && !force_restart {
                    let pref = read_pref(platform).await;
                    let current_revision = read_model_config_revision().await;
                    return Ok(status.with_pref(pref, current_revision));
                }
                if let Some(child) = self.take_child(platform).await {
                    let _ = child.lock().await.start_kill();
                }
            }
        }

        let model_config_revision = read_model_config_revision().await;
        let context = prepare_managed_runtime_context(&app, None)
            .await
            .map_err(|e| e.to_string())?;
        let state_root = PathBuf::from(&context.diagnostics.paths.state_root);
        let state_dir = state_root.join("im").join(platform);
        let sop_path = materialize_sop_reference(&state_root).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&state_dir).map_err(|e| e.to_string())?;
        if platform == WECHAT {
            remove_wechat_qr_files(&state_dir);
        }
        if platform == WECHAT && relogin {
            let _ = std::fs::remove_file(state_dir.join("token.json"));
        }

        let mut env = context.env;
        let sop_path_str = sop_path.to_string_lossy().into_owned();
        env.push((
            "GALLEY_IM_SUPERVISOR_PROMPT_TEXT".into(),
            managed_prompt::im_supervisor_prompt(&sop_path_str, platform),
        ));
        env.push(("GALLEY_SUPERVISOR_SOP_PATH".into(), sop_path_str));
        env.push(("GALLEY_IM_PLATFORM".into(), platform.into()));
        env.push((GALLEY_CORE_PID_ENV.into(), std::process::id().to_string()));
        append_platform_env(platform, &mut env).await?;

        let python = managed_python_for_app(&app)?;
        let code_root = context.diagnostics.paths.code_root.clone();
        let state_dir_arg = state_dir.to_string_lossy().into_owned();
        let sop_path_arg = sop_path.to_string_lossy().into_owned();
        let mut cmd = Command::new(&python);
        cmd.args([
            "-m",
            "runner.managed_im_supervisor",
            "--platform",
            platform,
            "--ga-path",
            &code_root,
            "--state-dir",
            &state_dir_arg,
            "--sop-path",
            &sop_path_arg,
        ]);
        if relogin {
            cmd.arg("--relogin");
        }
        for (k, v) in env {
            cmd.env(k, v);
        }
        process_command::configure_python(&mut cmd);
        let mut child = cmd
            .current_dir(context.bridge_cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("starting managed IM supervisor failed: {e}"))?;
        let pref = ImSupervisorPref {
            enabled: true,
            auto_start: true,
            model_config_revision: model_config_revision.clone(),
        };
        if let Err(e) = write_pref(platform, pref).await {
            let _ = child.start_kill();
            return Err(e);
        }
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));

        let status = ImSupervisorStatus {
            platform: platform.into(),
            state: ImSupervisorState::Starting,
            enabled: true,
            pid,
            bot_id: None,
            qr_image_path: None,
            last_error: None,
            model_config_revision,
            model_config_stale: false,
            updated_at: now_iso(),
        };
        self.set_slot(platform, Some(child.clone()), status.clone(), &app)
            .await;

        if let Some(stdout) = stdout {
            let manager = Arc::clone(self);
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                manager
                    .read_stdout(app_for_task, platform, pid, stdout)
                    .await;
            });
        }
        if let Some(stderr) = stderr {
            let manager = Arc::clone(self);
            let app_for_task = app.clone();
            tauri::async_runtime::spawn(async move {
                manager
                    .read_stderr(app_for_task, platform, pid, stderr)
                    .await;
            });
        }
        {
            let manager = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                manager.wait_child(app, platform, pid, child).await;
            });
        }
        Ok(status)
    }

    pub async fn stop(
        &self,
        app: AppHandle,
        platform: String,
    ) -> Result<ImSupervisorStatus, String> {
        let platform = normalize_platform(&platform)?;
        let _lifecycle = self.lifecycle_lock(platform).lock().await;
        self.stop_locked(app, platform).await
    }

    /// Body of [`stop`]. Caller must hold the platform's lifecycle lock
    /// (split out so `logout` can compose without re-locking).
    async fn stop_locked(
        &self,
        app: AppHandle,
        platform: &'static str,
    ) -> Result<ImSupervisorStatus, String> {
        write_pref(
            platform,
            ImSupervisorPref {
                enabled: false,
                auto_start: false,
                model_config_revision: None,
            },
        )
        .await?;
        let child = {
            let mut slots = self.slots.lock().await;
            let Some(slot) = slots.get_mut(platform) else {
                return self.derived_status(&app, platform).await;
            };
            slot.child.clone()
        };
        if let Some(child) = child {
            let _ = child.lock().await.start_kill();
        }
        let status = ImSupervisorStatus {
            platform: platform.into(),
            state: ImSupervisorState::Stopped,
            enabled: false,
            pid: None,
            bot_id: None,
            qr_image_path: self.qr_path(&app, platform).await,
            last_error: None,
            model_config_revision: None,
            model_config_stale: false,
            updated_at: now_iso(),
        };
        self.set_slot(platform, None, status.clone(), &app).await;
        Ok(status)
    }

    pub async fn logout(
        &self,
        app: AppHandle,
        platform: String,
    ) -> Result<ImSupervisorStatus, String> {
        let platform = normalize_platform(&platform)?;
        let _lifecycle = self.lifecycle_lock(platform).lock().await;
        let _ = self.stop_locked(app.clone(), platform).await;
        write_pref(
            platform,
            ImSupervisorPref {
                enabled: false,
                auto_start: false,
                model_config_revision: None,
            },
        )
        .await?;
        if platform == WECHAT {
            if let Ok(state_dir) = im_state_dir(&app, WECHAT) {
                let _ = std::fs::remove_file(state_dir.join("token.json"));
                remove_wechat_qr_files(&state_dir);
            }
        } else if platform == FEISHU {
            let _ = delete_feishu_im_config().await;
        }
        let status = ImSupervisorStatus {
            platform: platform.into(),
            state: ImSupervisorState::NotConnected,
            enabled: false,
            pid: None,
            bot_id: None,
            qr_image_path: None,
            last_error: None,
            model_config_revision: None,
            model_config_stale: false,
            updated_at: now_iso(),
        };
        self.set_slot(platform, None, status.clone(), &app).await;
        Ok(status)
    }

    pub async fn autostart(self: Arc<Self>, app: AppHandle) {
        for platform in PLATFORMS {
            let pref = read_pref(platform).await;
            if pref.enabled && pref.auto_start {
                let _ = self.start(app.clone(), platform.into(), false).await;
            }
        }
    }

    pub async fn restart_enabled(
        self: &Arc<Self>,
        app: AppHandle,
    ) -> Result<Vec<ImSupervisorStatus>, String> {
        let mut statuses = Vec::new();
        for platform in PLATFORMS {
            let pref = read_pref(platform).await;
            if pref.enabled {
                statuses.push(
                    self.start_inner(app.clone(), platform.into(), false, true)
                        .await?,
                );
            }
        }
        Ok(statuses)
    }

    pub async fn refresh_model_config_staleness(&self, app: &AppHandle) {
        let current_revision = read_model_config_revision().await;
        for platform in PLATFORMS {
            let pref = read_pref(platform).await;
            let next_status = {
                let mut slots = self.slots.lock().await;
                let Some(slot) = slots.get_mut(platform) else {
                    continue;
                };
                let mut next = slot
                    .status
                    .clone()
                    .with_pref(pref.clone(), current_revision.clone());
                if next.enabled == slot.status.enabled
                    && next.model_config_stale == slot.status.model_config_stale
                {
                    continue;
                }
                next.updated_at = now_iso();
                slot.status = next.clone();
                next
            };
            let _ = app.emit(EVENT_NAME, next_status);
        }
    }

    pub async fn stop_all(&self) {
        // Take each platform's lifecycle lock so a start that hasn't
        // reached set_slot yet finishes registering before we look — a
        // spawn mid-flight during quit would otherwise slip past cleanup.
        for platform in PLATFORMS {
            let _lifecycle = self.lifecycle_lock(platform).lock().await;
            let child = {
                let slots = self.slots.lock().await;
                slots.get(platform).and_then(|slot| slot.child.clone())
            };
            if let Some(child) = child {
                let _ = child.lock().await.start_kill();
            }
        }
    }

    async fn current_status(&self, platform: &str) -> Option<ImSupervisorStatus> {
        let slots = self.slots.lock().await;
        slots.get(platform).map(|slot| slot.status.clone())
    }

    async fn take_child(&self, platform: &str) -> Option<Arc<Mutex<Child>>> {
        let mut slots = self.slots.lock().await;
        slots.get_mut(platform).and_then(|slot| slot.child.take())
    }

    async fn set_slot(
        &self,
        platform: &str,
        child: Option<Arc<Mutex<Child>>>,
        status: ImSupervisorStatus,
        app: &AppHandle,
    ) {
        let mut slots = self.slots.lock().await;
        slots.insert(
            platform.into(),
            ProcessSlot {
                child,
                status: status.clone(),
            },
        );
        let _ = app.emit(EVENT_NAME, status);
    }

    async fn read_stdout(
        self: Arc<Self>,
        app: AppHandle,
        platform: &'static str,
        pid: Option<u32>,
        stdout: tokio::process::ChildStdout,
    ) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(event) = serde_json::from_str::<ImSupervisorLine>(&line) else {
                continue;
            };
            let event_platform = event.platform.as_deref().unwrap_or(platform);
            if event_platform != platform {
                continue;
            }
            let mut slots = self.slots.lock().await;
            let Some(slot) = slots.get_mut(platform) else {
                continue;
            };
            if slot.status.pid != pid {
                continue;
            }
            slot.status.state = event.state;
            slot.status.updated_at = event.updated_at.unwrap_or_else(now_iso);
            slot.status.bot_id = event.bot_id.or_else(|| slot.status.bot_id.clone());
            if let Some(qr) = event.qr_image_path {
                slot.status.qr_image_path = Some(qr);
            }
            if let Some(err) = event.last_error {
                slot.status.last_error = Some(err);
            } else if slot.status.state != ImSupervisorState::Error {
                slot.status.last_error = None;
            }
            let status = slot.status.clone();
            drop(slots);
            let _ = app.emit(EVENT_NAME, status);
        }
    }

    async fn read_stderr(
        self: Arc<Self>,
        app: AppHandle,
        platform: &'static str,
        pid: Option<u32>,
        stderr: tokio::process::ChildStderr,
    ) {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            self.update_error(&app, platform, pid, line.to_string())
                .await;
        }
    }

    async fn wait_child(
        self: Arc<Self>,
        app: AppHandle,
        platform: &'static str,
        pid: Option<u32>,
        child: Arc<Mutex<Child>>,
    ) {
        let status = loop {
            let status = {
                let mut child = child.lock().await;
                child.try_wait()
            };
            match status {
                Ok(Some(exit)) => break Ok(exit),
                Ok(None) => sleep(Duration::from_millis(250)).await,
                Err(e) => break Err(e),
            }
        };
        let mut slots = self.slots.lock().await;
        let Some(slot) = slots.get_mut(platform) else {
            return;
        };
        if slot.status.pid != pid {
            return;
        }
        slot.child = None;
        slot.status.pid = None;
        match slot.status.state {
            ImSupervisorState::Expired | ImSupervisorState::Error | ImSupervisorState::Stopped => {}
            _ => match status {
                Ok(exit) if exit.success() => slot.status.state = ImSupervisorState::Stopped,
                Ok(exit) => {
                    slot.status.state = ImSupervisorState::Error;
                    slot.status.last_error = Some(format!("process exited with {exit}"));
                }
                Err(e) => {
                    slot.status.state = ImSupervisorState::Error;
                    slot.status.last_error = Some(format!("process wait failed: {e}"));
                }
            },
        }
        slot.status.updated_at = now_iso();
        let status = slot.status.clone();
        drop(slots);
        let _ = app.emit(EVENT_NAME, status);
    }

    async fn update_error(
        &self,
        app: &AppHandle,
        platform: &'static str,
        pid: Option<u32>,
        error: String,
    ) {
        let mut slots = self.slots.lock().await;
        let Some(slot) = slots.get_mut(platform) else {
            return;
        };
        if slot.status.pid != pid {
            return;
        }
        slot.status.last_error = Some(error);
        slot.status.updated_at = now_iso();
        let status = slot.status.clone();
        drop(slots);
        let _ = app.emit(EVENT_NAME, status);
    }

    async fn derived_status(
        &self,
        app: &AppHandle,
        platform: &'static str,
    ) -> Result<ImSupervisorStatus, String> {
        let pref = read_pref(platform).await;
        let current_revision = read_model_config_revision().await;
        let state_dir = im_state_dir(app, platform)?;
        let (state, qr_path) = if platform == WECHAT {
            let token_exists = state_dir.join("token.json").is_file();
            (
                if token_exists {
                    ImSupervisorState::Stopped
                } else {
                    ImSupervisorState::NotConnected
                },
                latest_wechat_qr_path(&state_dir),
            )
        } else if feishu_config_ready().await {
            (ImSupervisorState::Stopped, None)
        } else {
            (ImSupervisorState::NotConnected, None)
        };
        let model_config_stale = model_config_stale(
            pref.model_config_revision.as_ref(),
            current_revision.as_ref(),
            pref.enabled,
        );
        Ok(ImSupervisorStatus {
            platform: platform.into(),
            state,
            enabled: pref.enabled,
            pid: None,
            bot_id: None,
            qr_image_path: qr_path.map(|path| path.to_string_lossy().into_owned()),
            last_error: None,
            model_config_revision: pref.model_config_revision,
            model_config_stale,
            updated_at: now_iso(),
        })
    }

    async fn qr_path(&self, app: &AppHandle, platform: &'static str) -> Option<String> {
        if platform != WECHAT {
            return None;
        }
        latest_wechat_qr_path(&im_state_dir(app, WECHAT).ok()?)
            .map(|path| path.to_string_lossy().into_owned())
    }
}

fn remove_wechat_qr_files(state_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(state_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with("wx_qr") && name.ends_with(".png") {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn latest_wechat_qr_path(state_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(state_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with("wx_qr") && name.ends_with(".png"))
        })
        .max_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok()
        })
}

fn normalize_platform(platform: &str) -> Result<&'static str, String> {
    match platform.trim().to_ascii_lowercase().as_str() {
        WECHAT => Ok(WECHAT),
        FEISHU => Ok(FEISHU),
        other => Err(format!("unsupported IM platform: {other}")),
    }
}

pub async fn get_feishu_im_config() -> Result<FeishuImConfig, String> {
    read_feishu_im_config().await
}

pub async fn save_feishu_im_config(
    input: SaveFeishuImConfigInput,
) -> Result<FeishuImConfig, String> {
    let app_id = input.app_id.trim();
    if app_id.is_empty() {
        return Err("Feishu App ID is required".into());
    }

    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    let secret = input
        .app_secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(secret) = secret {
        credential_store::set_secret(&galley, FEISHU_SECRET_REF, secret)
            .await
            .map_err(|e| e.to_string())?;
    }
    let has_secret = feishu_has_secret(&galley).await;
    if !has_secret {
        return Err("Feishu App Secret is required".into());
    }

    let pref = FeishuConfigPref {
        app_id: app_id.to_string(),
        updated_at: Some(now_iso()),
    };
    galley
        .set_pref_json(FEISHU_CONFIG_PREF, json!(pref))
        .await
        .map_err(|e| e.to_string())?;
    read_feishu_im_config_with(&galley).await
}

pub async fn delete_feishu_im_config() -> Result<FeishuImConfig, String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    credential_store::delete_secret(&galley, FEISHU_SECRET_REF)
        .await
        .map_err(|e| e.to_string())?;
    galley
        .set_pref_json(FEISHU_CONFIG_PREF, json!(FeishuConfigPref::default()))
        .await
        .map_err(|e| e.to_string())?;
    read_feishu_im_config_with(&galley).await
}

async fn append_platform_env(
    platform: &str,
    env: &mut Vec<(String, String)>,
) -> Result<(), String> {
    if platform != FEISHU {
        return Ok(());
    }
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    let config = read_feishu_config_pref(&galley).await?;
    let app_id = config.app_id.trim();
    if app_id.is_empty() {
        return Err("Feishu App ID and App Secret are required before connecting".into());
    }
    let app_secret = credential_store::get_secret(&galley, FEISHU_SECRET_REF)
        .await
        .map_err(|_| "Feishu App ID and App Secret are required before connecting".to_string())?;
    if app_secret.trim().is_empty() {
        return Err("Feishu App ID and App Secret are required before connecting".into());
    }
    let config_json = serde_json::to_string(&json!({
        "fs_app_id": app_id,
        "fs_app_secret": app_secret,
        "fs_allowed_users": [],
    }))
    .map_err(|e| e.to_string())?;
    env.push(("GALLEY_FEISHU_CONFIG_JSON".into(), config_json));
    Ok(())
}

async fn feishu_config_ready() -> bool {
    read_feishu_im_config()
        .await
        .map(|config| !config.app_id.trim().is_empty() && config.has_app_secret)
        .unwrap_or(false)
}

async fn read_feishu_im_config() -> Result<FeishuImConfig, String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    read_feishu_im_config_with(&galley).await
}

async fn read_feishu_im_config_with(galley: &SqliteGalley) -> Result<FeishuImConfig, String> {
    let pref = read_feishu_config_pref(galley).await?;
    Ok(FeishuImConfig {
        app_id: pref.app_id,
        has_app_secret: feishu_has_secret(galley).await,
        updated_at: pref.updated_at,
    })
}

async fn read_feishu_config_pref(galley: &SqliteGalley) -> Result<FeishuConfigPref, String> {
    let value = galley
        .get_pref_json(FEISHU_CONFIG_PREF)
        .await
        .map_err(|e| e.to_string())?;
    Ok(value
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default())
}

async fn feishu_has_secret(galley: &SqliteGalley) -> bool {
    credential_store::get_secret(galley, FEISHU_SECRET_REF)
        .await
        .map(|secret| !secret.trim().is_empty())
        .unwrap_or(false)
}

async fn read_pref(platform: &str) -> ImSupervisorPref {
    let Ok(galley) = SqliteGalley::open().await else {
        return ImSupervisorPref::default();
    };
    let Some(key) = pref_key(platform) else {
        return ImSupervisorPref::default();
    };
    let Ok(Some(value)) = galley.get_pref_json(key).await else {
        return ImSupervisorPref::default();
    };
    serde_json::from_value(value).unwrap_or_default()
}

async fn write_pref(platform: &str, pref: ImSupervisorPref) -> Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    let key = pref_key(platform).ok_or_else(|| format!("unsupported IM platform: {platform}"))?;
    galley
        .set_pref_json(key, json!(pref))
        .await
        .map_err(|e| e.to_string())
}

async fn read_model_config_revision() -> Option<String> {
    let Ok(galley) = SqliteGalley::open().await else {
        return None;
    };
    let Ok(Some(value)) = galley
        .get_pref_json(managed_model_config::REVISION_PREF_KEY)
        .await
    else {
        return None;
    };
    value.as_str().map(ToOwned::to_owned)
}

fn model_config_stale(
    used_revision: Option<&String>,
    current_revision: Option<&String>,
    enabled: bool,
) -> bool {
    enabled && current_revision.is_some() && used_revision != current_revision
}

fn pref_key(platform: &str) -> Option<&'static str> {
    match platform {
        WECHAT => Some(WECHAT_PREF),
        FEISHU => Some(FEISHU_PREF),
        _ => None,
    }
}

fn materialize_sop_reference(state_root: &Path) -> std::io::Result<PathBuf> {
    let dir = state_root.join("im").join("reference");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("galley-supervisor-sop.md");
    std::fs::write(&path, crate::sop_install::sop_body())?;
    Ok(path)
}

fn im_state_dir(app: &AppHandle, platform: &str) -> Result<PathBuf, String> {
    let diagnostics = managed_runtime::ensure_for_app(app).map_err(|e| e.to_string())?;
    Ok(PathBuf::from(diagnostics.paths.state_root)
        .join("im")
        .join(platform))
}

fn managed_python_for_app(app: &AppHandle) -> Result<String, String> {
    if cfg!(debug_assertions) {
        return Ok(if cfg!(target_os = "windows") {
            "python".into()
        } else {
            "python3".into()
        });
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolving resource dir failed: {e}"))?;
    let python = if cfg!(target_os = "windows") {
        resource_dir.join("python").join("python.exe")
    } else {
        resource_dir.join("python").join("bin").join("python3")
    };
    Ok(python.to_string_lossy().into_owned())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_platform_accepts_supported_platforms() {
        assert_eq!(normalize_platform("wechat").unwrap(), WECHAT);
        assert_eq!(normalize_platform(" WeChat ").unwrap(), WECHAT);
        assert_eq!(normalize_platform("feishu").unwrap(), FEISHU);
        assert_eq!(normalize_platform(" FeiShu ").unwrap(), FEISHU);
        assert!(normalize_platform("telegram").is_err());
    }

    #[test]
    fn materialize_sop_reference_writes_galley_owned_copy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = materialize_sop_reference(tmp.path()).expect("write sop reference");
        assert!(path.ends_with("im/reference/galley-supervisor-sop.md"));
        let body = std::fs::read_to_string(path).expect("read sop");
        assert!(body.contains("Galley Supervisor SOP"));
    }
}
