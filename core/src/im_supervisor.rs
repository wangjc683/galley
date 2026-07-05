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
const TELEGRAM: &str = "telegram";
const WECHAT_PREF: &str = "im_supervisor_wechat";
const FEISHU_PREF: &str = "im_supervisor_feishu";
const TELEGRAM_PREF: &str = "im_supervisor_telegram";
const FEISHU_CONFIG_PREF: &str = "im_supervisor_feishu_config";
const TELEGRAM_CONFIG_PREF: &str = "im_supervisor_telegram_config";
const FEISHU_SECRET_REF: &str = "im-supervisor:feishu:app-secret";
const TELEGRAM_TOKEN_REF: &str = "im-supervisor:telegram:bot-token";
const GALLEY_CORE_PID_ENV: &str = "GALLEY_CORE_PID";
const PLATFORMS: [&str; 3] = [WECHAT, FEISHU, TELEGRAM];

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
    /// Owner-paired channels (Feishu / Telegram): the bound owner's id
    /// (Feishu open_id / Telegram user id). While set, the bot responds
    /// exclusively to this user.
    pub owner_open_id: Option<String>,
    /// Owner-paired channels: the active pairing code while the bot is
    /// running unbound. The GUI shows it; DMing it to the bot binds the
    /// sender.
    pub bind_code: Option<String>,
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
    /// open_id of the paired owner. None = locked, awaiting pairing.
    /// open_ids are app-scoped, so switching to a different Feishu app
    /// invalidates this (see `save_feishu_im_config`).
    owner_open_id: Option<String>,
    owner_bound_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuImConfig {
    pub app_id: String,
    pub has_app_secret: bool,
    pub updated_at: Option<String>,
    pub owner_open_id: Option<String>,
    pub owner_bound_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFeishuImConfigInput {
    pub app_id: String,
    pub app_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TelegramConfigPref {
    updated_at: Option<String>,
    /// Telegram user id of the paired owner. None = locked, awaiting
    /// pairing. Telegram user ids are global (not bot-scoped), so the
    /// binding survives a bot-token change — the same human owns the
    /// channel regardless of which bot fronts it.
    owner_user_id: Option<String>,
    owner_bound_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramImConfig {
    pub has_bot_token: bool,
    pub updated_at: Option<String>,
    pub owner_user_id: Option<String>,
    pub owner_bound_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTelegramImConfigInput {
    /// None / blank keeps the already-saved token (it is never echoed
    /// back to the GUI), mirroring the Feishu app-secret semantics.
    pub bot_token: Option<String>,
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
    telegram_lifecycle: Mutex<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImSupervisorLine {
    platform: Option<String>,
    state: ImSupervisorState,
    bot_id: Option<String>,
    qr_image_path: Option<String>,
    last_error: Option<String>,
    /// Present on the Feishu owner-binding event: the open_id that just
    /// paired with the bot. Core persists it and locks the config to it.
    owner_open_id: Option<String>,
    updated_at: Option<String>,
}

impl ImSupervisorManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lifecycle_lock(&self, platform: &str) -> &Mutex<()> {
        match platform {
            FEISHU => &self.feishu_lifecycle,
            TELEGRAM => &self.telegram_lifecycle,
            _ => &self.wechat_lifecycle,
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
                    let mut child = child.lock().await;
                    let _ = child.start_kill();
                    // Wait (bounded) for the old process to actually die
                    // before spawning the replacement: on Windows its
                    // state-dir file lock outlives start_kill, and the
                    // new supervisor intermittently failed with
                    // "already running".
                    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
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
        // Stable per-channel supervisor identity. The prompt mandates it on
        // every CLI write, and the completion reporter filters delegated
        // sessions by this exact string — a model-invented freeform id
        // would make that filter an empty set.
        let supervisor_id = managed_prompt::im_supervisor_id(platform);
        env.push((
            "GALLEY_IM_SUPERVISOR_PROMPT_TEXT".into(),
            managed_prompt::im_supervisor_prompt(&sop_path_str, platform, &supervisor_id),
        ));
        env.push(("GALLEY_SUPERVISOR_SOP_PATH".into(), sop_path_str));
        env.push(("GALLEY_SUPERVISOR_ID".into(), supervisor_id));
        env.push(("GALLEY_IM_PLATFORM".into(), platform.into()));
        env.push((GALLEY_CORE_PID_ENV.into(), std::process::id().to_string()));
        let binding = append_platform_env(platform, &mut env).await?;

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
            owner_open_id: binding.owner_open_id,
            bind_code: binding.bind_code,
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
            owner_open_id: pref_owner(platform).await,
            bind_code: None,
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
        } else if platform == TELEGRAM {
            let _ = delete_telegram_im_config().await;
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
            owner_open_id: None,
            bind_code: None,
            updated_at: now_iso(),
        };
        self.set_slot(platform, None, status.clone(), &app).await;
        Ok(status)
    }

    /// Unpair an owner-paired channel (Feishu / Telegram). Clears the
    /// persisted owner and, if the supervisor is live, force-restarts it
    /// so the bot comes back in locked mode with a fresh pairing code
    /// (the restart is also what makes recovery from a hijacked binding
    /// race-proof: the new code is only visible on this machine's
    /// screen).
    pub async fn unbind_owner(
        self: &Arc<Self>,
        app: AppHandle,
        platform: String,
    ) -> Result<ImSupervisorStatus, String> {
        let platform = normalize_platform(&platform)?;
        clear_owner_pref(platform).await?;
        let live = matches!(
            self.current_status(platform).await.map(|s| s.state),
            Some(
                ImSupervisorState::Starting
                    | ImSupervisorState::WaitingScan
                    | ImSupervisorState::Reconnecting
                    | ImSupervisorState::Running
            )
        );
        if live {
            return self.start_inner(app, platform.into(), false, true).await;
        }
        // Not running: just reflect the cleared owner in the slot (if
        // any) and report the derived state.
        {
            let mut slots = self.slots.lock().await;
            if let Some(slot) = slots.get_mut(platform) {
                slot.status.owner_open_id = None;
                slot.status.bind_code = None;
                slot.status.updated_at = now_iso();
            }
        }
        let status = self.status(&app, platform.into()).await?;
        let _ = app.emit(EVENT_NAME, status.clone());
        Ok(status)
    }

    pub async fn autostart(self: Arc<Self>, app: AppHandle) {
        for platform in PLATFORMS {
            let pref = read_pref(platform).await;
            if pref.enabled && pref.auto_start {
                if let Err(e) = self.start(app.clone(), platform.into(), false).await {
                    // Swallowing this left the UI reading "enabled but
                    // nothing happened": pref on, no slot, no last_error.
                    // Record an Error slot so the failure is visible and
                    // retryable from the Channels card.
                    eprintln!("[im-supervisor] autostart {platform} failed: {e}");
                    let status = ImSupervisorStatus {
                        platform: platform.into(),
                        state: ImSupervisorState::Error,
                        enabled: true,
                        pid: None,
                        bot_id: None,
                        qr_image_path: None,
                        last_error: Some(e),
                        model_config_revision: pref.model_config_revision.clone(),
                        model_config_stale: false,
                        owner_open_id: pref_owner(platform).await,
                        bind_code: None,
                        updated_at: now_iso(),
                    };
                    self.set_slot(platform, None, status, &app).await;
                }
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
            // Owner binding: persist BEFORE touching the slot, so a crash
            // right after the bot's confirmation reply cannot leave a
            // bound bot whose owner is lost on the next spawn.
            if let Some(owner) = event.owner_open_id.as_deref() {
                if let Err(e) = persist_owner(platform, owner).await {
                    eprintln!("[im-supervisor] persisting {platform} owner failed: {e}");
                }
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
            if let Some(owner) = event.owner_open_id {
                slot.status.owner_open_id = Some(owner);
                slot.status.bind_code = None;
            }
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
        // A pairing code dies with its process; reconnect issues a new one.
        slot.status.bind_code = None;
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
        } else {
            let ready = match platform {
                FEISHU => feishu_config_ready().await,
                TELEGRAM => telegram_config_ready().await,
                _ => false,
            };
            (
                if ready {
                    ImSupervisorState::Stopped
                } else {
                    ImSupervisorState::NotConnected
                },
                None,
            )
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
            owner_open_id: pref_owner(platform).await,
            bind_code: None,
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
        TELEGRAM => Ok(TELEGRAM),
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

    // open_ids are scoped to the Feishu app: keeping the same app keeps
    // the pairing; switching to a different app invalidates it (the old
    // owner's open_id means nothing there and would lock everyone out).
    let existing = read_feishu_config_pref(&galley).await?;
    let keep_owner = existing.app_id.trim() == app_id;
    let pref = FeishuConfigPref {
        app_id: app_id.to_string(),
        updated_at: Some(now_iso()),
        owner_open_id: if keep_owner {
            existing.owner_open_id
        } else {
            None
        },
        owner_bound_at: if keep_owner {
            existing.owner_bound_at
        } else {
            None
        },
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

pub async fn get_telegram_im_config() -> Result<TelegramImConfig, String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    read_telegram_im_config_with(&galley).await
}

pub async fn save_telegram_im_config(
    input: SaveTelegramImConfigInput,
) -> Result<TelegramImConfig, String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    let token = input
        .bot_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(token) = token {
        credential_store::set_secret(&galley, TELEGRAM_TOKEN_REF, token)
            .await
            .map_err(|e| e.to_string())?;
    }
    if !telegram_has_token(&galley).await {
        return Err("Telegram Bot Token is required".into());
    }
    // The owner binding intentionally survives a token change: Telegram
    // user ids are global, so the paired human stays the same even when
    // a different bot fronts the channel.
    let mut pref = read_telegram_config_pref(&galley).await?;
    pref.updated_at = Some(now_iso());
    galley
        .set_pref_json(TELEGRAM_CONFIG_PREF, json!(pref))
        .await
        .map_err(|e| e.to_string())?;
    read_telegram_im_config_with(&galley).await
}

pub async fn delete_telegram_im_config() -> Result<TelegramImConfig, String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    credential_store::delete_secret(&galley, TELEGRAM_TOKEN_REF)
        .await
        .map_err(|e| e.to_string())?;
    galley
        .set_pref_json(TELEGRAM_CONFIG_PREF, json!(TelegramConfigPref::default()))
        .await
        .map_err(|e| e.to_string())?;
    read_telegram_im_config_with(&galley).await
}

/// Owner-paired access state resolved at spawn time: either a bound
/// owner (bot responds only to them) or a fresh pairing code (bot is
/// locked until someone DMs the code). Empty defaults for platforms
/// without owner pairing (WeChat).
#[derive(Default)]
struct OwnerBindingContext {
    owner_open_id: Option<String>,
    bind_code: Option<String>,
}

async fn append_platform_env(
    platform: &str,
    env: &mut Vec<(String, String)>,
) -> Result<OwnerBindingContext, String> {
    match platform {
        FEISHU => {
            let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
            let config = read_feishu_config_pref(&galley).await?;
            let app_id = config.app_id.trim();
            if app_id.is_empty() {
                return Err("Feishu App ID and App Secret are required before connecting".into());
            }
            let app_secret = credential_store::get_secret(&galley, FEISHU_SECRET_REF)
                .await
                .map_err(|_| {
                    "Feishu App ID and App Secret are required before connecting".to_string()
                })?;
            if app_secret.trim().is_empty() {
                return Err("Feishu App ID and App Secret are required before connecting".into());
            }
            // Owner-locked access: the bot only ever answers the paired
            // owner. Unbound → issue a pairing code; the empty allow-list
            // plus the code tells fsapp to run locked (never public)
            // until the code arrives.
            let owner_open_id = config
                .owner_open_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
            let bind_code = if owner_open_id.is_none() {
                Some(generate_bind_code())
            } else {
                None
            };
            let allowed_users: Vec<&String> = owner_open_id.iter().collect();
            let config_json = serde_json::to_string(&json!({
                "fs_app_id": app_id,
                "fs_app_secret": app_secret,
                "fs_allowed_users": allowed_users,
                "fs_owner_bind_code": bind_code,
            }))
            .map_err(|e| e.to_string())?;
            env.push(("GALLEY_FEISHU_CONFIG_JSON".into(), config_json));
            Ok(OwnerBindingContext {
                owner_open_id,
                bind_code,
            })
        }
        TELEGRAM => {
            let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
            let bot_token = credential_store::get_secret(&galley, TELEGRAM_TOKEN_REF)
                .await
                .map_err(|_| "Telegram Bot Token is required before connecting".to_string())?;
            if bot_token.trim().is_empty() {
                return Err("Telegram Bot Token is required before connecting".into());
            }
            let config = read_telegram_config_pref(&galley).await?;
            // Same owner-locked semantics as Feishu, with tgapp reading
            // GALLEY_TELEGRAM_CONFIG_JSON (managed-ga patch 0014).
            let owner_user_id = config
                .owner_user_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned);
            let bind_code = if owner_user_id.is_none() {
                Some(generate_bind_code())
            } else {
                None
            };
            let allowed_users: Vec<&String> = owner_user_id.iter().collect();
            let config_json = serde_json::to_string(&json!({
                "tg_bot_token": bot_token.trim(),
                "tg_allowed_users": allowed_users,
                "tg_owner_bind_code": bind_code,
            }))
            .map_err(|e| e.to_string())?;
            env.push(("GALLEY_TELEGRAM_CONFIG_JSON".into(), config_json));
            Ok(OwnerBindingContext {
                owner_open_id: owner_user_id,
                bind_code,
            })
        }
        _ => Ok(OwnerBindingContext::default()),
    }
}

/// 6-digit pairing code. `RandomState` seeds per-instance from OS
/// entropy — enough for a code that is only shown on the owner's own
/// screen, rate-limited on the bot side, and regenerated per connect.
fn generate_bind_code() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    );
    format!("{:06}", hasher.finish() % 1_000_000)
}

/// Bound owner from the persisted platform config, for status snapshots
/// of non-running states. None for platforms without owner pairing.
async fn pref_owner(platform: &str) -> Option<String> {
    let galley = SqliteGalley::open().await.ok()?;
    match platform {
        FEISHU => read_feishu_config_pref(&galley)
            .await
            .ok()?
            .owner_open_id
            .filter(|s| !s.trim().is_empty()),
        TELEGRAM => read_telegram_config_pref(&galley)
            .await
            .ok()?
            .owner_user_id
            .filter(|s| !s.trim().is_empty()),
        _ => None,
    }
}

async fn persist_owner(platform: &str, owner_id: &str) -> Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    match platform {
        FEISHU => {
            let mut pref = read_feishu_config_pref(&galley).await?;
            pref.owner_open_id = Some(owner_id.to_string());
            pref.owner_bound_at = Some(now_iso());
            galley
                .set_pref_json(FEISHU_CONFIG_PREF, json!(pref))
                .await
                .map_err(|e| e.to_string())
        }
        TELEGRAM => {
            let mut pref = read_telegram_config_pref(&galley).await?;
            pref.owner_user_id = Some(owner_id.to_string());
            pref.owner_bound_at = Some(now_iso());
            galley
                .set_pref_json(TELEGRAM_CONFIG_PREF, json!(pref))
                .await
                .map_err(|e| e.to_string())
        }
        other => Err(format!("platform {other} has no owner pairing")),
    }
}

async fn clear_owner_pref(platform: &str) -> Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(|e| e.to_string())?;
    match platform {
        FEISHU => {
            let mut pref = read_feishu_config_pref(&galley).await?;
            pref.owner_open_id = None;
            pref.owner_bound_at = None;
            galley
                .set_pref_json(FEISHU_CONFIG_PREF, json!(pref))
                .await
                .map_err(|e| e.to_string())
        }
        TELEGRAM => {
            let mut pref = read_telegram_config_pref(&galley).await?;
            pref.owner_user_id = None;
            pref.owner_bound_at = None;
            galley
                .set_pref_json(TELEGRAM_CONFIG_PREF, json!(pref))
                .await
                .map_err(|e| e.to_string())
        }
        other => Err(format!("platform {other} has no owner pairing")),
    }
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
        owner_open_id: pref.owner_open_id.filter(|s| !s.trim().is_empty()),
        owner_bound_at: pref.owner_bound_at,
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

async fn telegram_config_ready() -> bool {
    let Ok(galley) = SqliteGalley::open().await else {
        return false;
    };
    telegram_has_token(&galley).await
}

async fn read_telegram_im_config_with(galley: &SqliteGalley) -> Result<TelegramImConfig, String> {
    let pref = read_telegram_config_pref(galley).await?;
    Ok(TelegramImConfig {
        has_bot_token: telegram_has_token(galley).await,
        updated_at: pref.updated_at,
        owner_user_id: pref.owner_user_id.filter(|s| !s.trim().is_empty()),
        owner_bound_at: pref.owner_bound_at,
    })
}

async fn read_telegram_config_pref(galley: &SqliteGalley) -> Result<TelegramConfigPref, String> {
    let value = galley
        .get_pref_json(TELEGRAM_CONFIG_PREF)
        .await
        .map_err(|e| e.to_string())?;
    Ok(value
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default())
}

async fn telegram_has_token(galley: &SqliteGalley) -> bool {
    credential_store::get_secret(galley, TELEGRAM_TOKEN_REF)
        .await
        .map(|token| !token.trim().is_empty())
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
        TELEGRAM => Some(TELEGRAM_PREF),
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
        assert_eq!(normalize_platform("telegram").unwrap(), TELEGRAM);
        assert_eq!(normalize_platform(" Telegram ").unwrap(), TELEGRAM);
        assert!(normalize_platform("discord").is_err());
    }

    #[test]
    fn bind_code_is_six_digits() {
        for _ in 0..20 {
            let code = generate_bind_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()), "code: {code}");
        }
    }

    #[test]
    fn telegram_supervisor_line_parses_owner_binding_event() {
        let line = r#"{"platform":"telegram","state":"running","ownerOpenId":"123456789","botId":"my_bot","updatedAt":"2026-07-05T00:00:00Z"}"#;
        let parsed: ImSupervisorLine = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.owner_open_id.as_deref(), Some("123456789"));
        assert_eq!(parsed.bot_id.as_deref(), Some("my_bot"));
        assert_eq!(parsed.state, ImSupervisorState::Running);
    }

    #[test]
    fn telegram_config_pref_deserializes_defaults() {
        let empty: TelegramConfigPref = serde_json::from_str("{}").expect("parse empty pref");
        assert!(empty.owner_user_id.is_none());
        assert!(empty.owner_bound_at.is_none());
    }

    #[test]
    fn supervisor_line_parses_owner_binding_event() {
        let line = r#"{"platform":"feishu","state":"running","ownerOpenId":"ou_abc123","updatedAt":"2026-07-03T00:00:00Z"}"#;
        let parsed: ImSupervisorLine = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.owner_open_id.as_deref(), Some("ou_abc123"));
        assert_eq!(parsed.state, ImSupervisorState::Running);

        // Ordinary status lines (no owner field) must keep parsing.
        let plain = r#"{"platform":"feishu","state":"running","updatedAt":"2026-07-03T00:00:00Z"}"#;
        let parsed: ImSupervisorLine = serde_json::from_str(plain).expect("parse plain");
        assert!(parsed.owner_open_id.is_none());
    }

    #[test]
    fn feishu_config_pref_deserializes_without_owner_fields() {
        // Prefs written before owner binding shipped must load cleanly.
        let old = r#"{"appId":"cli_a1b2","updatedAt":"2026-06-01T00:00:00Z"}"#;
        let pref: FeishuConfigPref = serde_json::from_str(old).expect("parse old pref");
        assert_eq!(pref.app_id, "cli_a1b2");
        assert!(pref.owner_open_id.is_none());
        assert!(pref.owner_bound_at.is_none());
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
