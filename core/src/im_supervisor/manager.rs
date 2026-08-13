//! Per-platform IM supervisor process slots and lifecycle:
//! start / stop / logout / unbind / autostart / restart, plus the
//! stdout status stream, stderr capture, and child-exit watcher.

use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::managed_prompt;
use crate::process_command;
use crate::runner_commands::prepare_managed_runtime_context;

use super::platform_config::{
    append_platform_env, clear_owner_pref, delete_discord_im_config, delete_feishu_im_config,
    delete_telegram_im_config, discord_config_ready, feishu_config_ready, persist_owner,
    pref_owner, telegram_config_ready,
};
use super::{
    im_state_dir, latest_wechat_qr_path, managed_python_for_app, materialize_sop_reference,
    model_config_stale, normalize_platform, now_iso, read_model_config_revision, read_pref,
    remove_wechat_qr_files, write_pref, ImSupervisorPref, ImSupervisorState, ImSupervisorStatus,
    DISCORD, EVENT_NAME, FEISHU, GALLEY_CORE_PID_ENV, PLATFORMS, TELEGRAM, WECHAT,
};

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
    discord_lifecycle: Mutex<()>,
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
            DISCORD => &self.discord_lifecycle,
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
        self.start_locked(app, platform, relogin, force_restart)
            .await
    }

    /// Body of [`start_inner`]. Caller must hold the platform's
    /// lifecycle lock (split out so `unbind_owner` can compose the
    /// kill → clear-pref → respawn sequence under one lock).
    async fn start_locked(
        self: &Arc<Self>,
        app: AppHandle,
        platform: &'static str,
        relogin: bool,
        force_restart: bool,
    ) -> Result<ImSupervisorStatus, String> {
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
        // The shared context composes the WORKBENCH runtime prompt, whose
        // Next-Step Suggestion mandate is a GUI-composer feature. IM
        // supervisors have no composer — the mandate just leaked the tag
        // verbatim into chat replies (2026-08-13 dogfood) — so swap in
        // the suggestion-free composition.
        let app_version = app.package_info().version.to_string();
        if let Some(entry) = env
            .iter_mut()
            .find(|(key, _)| key == "GALLEY_RUNTIME_PROMPT_TEXT")
        {
            entry.1 = managed_prompt::compose_im_runtime_prompt(&app_version);
        }
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
        // Discord runs one supervisor context per channel, so the
        // process-wide prompt above cannot carry the identity: every
        // channel agent needs its own `galley-im/discord/ch:<id>`. Hand
        // the runner the same prompt with the id left as a placeholder
        // and let it substitute per channel at agent-creation time
        // (rewriting `os.environ` concurrently is not an option).
        // Single-context platforms get no template.
        if platform == DISCORD {
            env.push((
                "GALLEY_IM_SUPERVISOR_PROMPT_TEMPLATE".into(),
                managed_prompt::im_supervisor_prompt_template(&sop_path_str, platform),
            ));
        }
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
        } else if platform == DISCORD {
            let _ = delete_discord_im_config().await;
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
        let _lifecycle = self.lifecycle_lock(platform).lock().await;
        let live = matches!(
            self.current_status(platform).await.map(|s| s.state),
            Some(
                ImSupervisorState::Starting
                    | ImSupervisorState::WaitingScan
                    | ImSupervisorState::Reconnecting
                    | ImSupervisorState::Running
            )
        );
        // Retire the live generation BEFORE clearing the pref: a killed
        // process keeps draining buffered stdout lines, and until the
        // slot stops matching its pid those lines can re-persist the
        // owner we are about to clear (`read_stdout` admits events by
        // pid under the slots lock). Order: kill → de-register the pid
        // → clear pref → respawn fresh.
        if let Some(child) = self.take_child(platform).await {
            let mut child = child.lock().await;
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        }
        {
            let mut slots = self.slots.lock().await;
            if let Some(slot) = slots.get_mut(platform) {
                slot.status.pid = None;
                slot.status.owner_open_id = None;
                slot.status.bind_code = None;
                slot.status.updated_at = now_iso();
            }
        }
        clear_owner_pref(platform).await?;
        if live {
            return self.start_locked(app, platform, false, true).await;
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
            let mut slots = self.slots.lock().await;
            let Some(slot) = slots.get_mut(platform) else {
                continue;
            };
            let Some((owner_to_persist, status)) = admit_event(&mut slot.status, pid, event)
            else {
                continue;
            };
            // Owner binding: persist before releasing the slots lock and
            // before emitting, so a crash right after the bot's
            // confirmation reply cannot leave a bound bot whose owner is
            // lost on the next spawn. Staying inside the lock makes the
            // admit-check + persist atomic against `unbind_owner`'s
            // retire-generation-then-clear-pref sequence — a stale
            // generation's buffered binding event can never resurrect a
            // cleared owner (issue: im-owner-bind-race).
            if let Some(owner) = owner_to_persist {
                if let Err(e) = persist_owner(platform, &owner).await {
                    eprintln!("[im-supervisor] persisting {platform} owner failed: {e}");
                }
            }
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
                DISCORD => discord_config_ready().await,
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

/// Apply a stdout status event from process generation `pid` to the
/// slot's status. Returns `None` — rejecting the event entirely — when
/// the event's generation no longer matches the slot: a killed process
/// keeps draining buffered lines after unbind/restart retires it, and
/// nothing from a stale generation may touch the slot or the prefs.
/// On admission, returns the owner to persist (when the event carried
/// a binding) and the updated status to emit.
fn admit_event(
    status: &mut ImSupervisorStatus,
    pid: Option<u32>,
    event: ImSupervisorLine,
) -> Option<(Option<String>, ImSupervisorStatus)> {
    if status.pid != pid {
        return None;
    }
    status.state = event.state;
    status.updated_at = event.updated_at.unwrap_or_else(now_iso);
    status.bot_id = event.bot_id.or_else(|| status.bot_id.clone());
    let owner_to_persist = event.owner_open_id.clone();
    if let Some(owner) = event.owner_open_id {
        status.owner_open_id = Some(owner);
        status.bind_code = None;
    }
    if let Some(qr) = event.qr_image_path {
        status.qr_image_path = Some(qr);
    }
    if let Some(err) = event.last_error {
        status.last_error = Some(err);
    } else if status.state != ImSupervisorState::Error {
        status.last_error = None;
    }
    Some((owner_to_persist, status.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running_status(pid: Option<u32>) -> ImSupervisorStatus {
        ImSupervisorStatus {
            platform: TELEGRAM.into(),
            state: ImSupervisorState::Running,
            enabled: true,
            pid,
            bot_id: Some("my_bot".into()),
            qr_image_path: None,
            last_error: None,
            model_config_revision: None,
            model_config_stale: false,
            owner_open_id: None,
            bind_code: Some("123456".into()),
            updated_at: "2026-08-13T00:00:00Z".into(),
        }
    }

    fn owner_event(owner: &str) -> ImSupervisorLine {
        serde_json::from_str(&format!(
            r#"{{"platform":"telegram","state":"running","ownerOpenId":"{owner}","updatedAt":"2026-08-13T00:00:01Z"}}"#
        ))
        .expect("parse owner event")
    }

    #[test]
    fn admit_event_accepts_matching_generation_and_surfaces_owner() {
        let mut status = running_status(Some(42));
        let (owner, emitted) =
            admit_event(&mut status, Some(42), owner_event("111")).expect("admitted");
        assert_eq!(owner.as_deref(), Some("111"));
        assert_eq!(emitted.owner_open_id.as_deref(), Some("111"));
        // A live binding consumes the pairing code.
        assert!(emitted.bind_code.is_none());
    }

    #[test]
    fn admit_event_rejects_stale_generation_entirely() {
        // Slot already moved on to a new process generation.
        let mut status = running_status(Some(43));
        let before = status.clone();
        assert!(admit_event(&mut status, Some(42), owner_event("111")).is_none());
        // Rejection means no status mutation and, above all, no owner
        // handed back for persistence.
        assert_eq!(status.owner_open_id, before.owner_open_id);
        assert_eq!(status.updated_at, before.updated_at);
    }

    #[test]
    fn retired_generation_cannot_resurrect_cleared_owner() {
        // The unbind sequence: kill child, then retire the generation
        // (pid -> None) and clear owner fields, then clear the pref.
        let mut status = running_status(Some(42));
        status.pid = None;
        status.owner_open_id = None;
        status.bind_code = None;
        // A buffered binding event from the killed process arrives late:
        // it must be rejected outright, so `read_stdout` never reaches
        // `persist_owner` and the cleared pref stays cleared.
        assert!(admit_event(&mut status, Some(42), owner_event("111")).is_none());
        assert!(status.owner_open_id.is_none());
    }

    fn discord_running_status(pid: Option<u32>) -> ImSupervisorStatus {
        ImSupervisorStatus {
            platform: DISCORD.into(),
            state: ImSupervisorState::Running,
            enabled: true,
            pid,
            bot_id: Some("galley#4242".into()),
            qr_image_path: None,
            last_error: None,
            model_config_revision: None,
            model_config_stale: false,
            owner_open_id: None,
            bind_code: Some("654321".into()),
            updated_at: "2026-08-13T00:00:00Z".into(),
        }
    }

    fn discord_owner_event(owner: &str) -> ImSupervisorLine {
        serde_json::from_str(&format!(
            r#"{{"platform":"discord","state":"running","ownerOpenId":"{owner}","updatedAt":"2026-08-13T00:00:01Z"}}"#
        ))
        .expect("parse discord owner event")
    }

    #[test]
    fn discord_admit_event_binds_owner_and_consumes_bind_code() {
        let mut status = discord_running_status(Some(77));
        let (owner, emitted) =
            admit_event(&mut status, Some(77), discord_owner_event("1234567890"))
                .expect("admitted");
        assert_eq!(owner.as_deref(), Some("1234567890"));
        assert_eq!(emitted.owner_open_id.as_deref(), Some("1234567890"));
        assert!(emitted.bind_code.is_none());
    }

    #[test]
    fn discord_admit_event_rejects_stale_generation() {
        // The generation gate is platform-agnostic; Discord inherits it
        // unchanged, so a buffered event from a killed process can never
        // re-persist an owner that unbind just cleared.
        let mut status = discord_running_status(Some(78));
        status.pid = None;
        status.owner_open_id = None;
        assert!(admit_event(&mut status, Some(78), discord_owner_event("1234567890")).is_none());
        assert!(status.owner_open_id.is_none());
    }

    #[test]
    fn discord_supervisor_line_parses_owner_binding_event() {
        let line = r#"{"platform":"discord","state":"running","ownerOpenId":"1234567890","botId":"galley#4242","updatedAt":"2026-08-13T00:00:00Z"}"#;
        let parsed: ImSupervisorLine = serde_json::from_str(line).expect("parse");
        assert_eq!(parsed.owner_open_id.as_deref(), Some("1234567890"));
        assert_eq!(parsed.bot_id.as_deref(), Some("galley#4242"));
        assert_eq!(parsed.state, ImSupervisorState::Running);

        let plain =
            r#"{"platform":"discord","state":"starting","updatedAt":"2026-08-13T00:00:00Z"}"#;
        let parsed: ImSupervisorLine = serde_json::from_str(plain).expect("parse plain");
        assert!(parsed.owner_open_id.is_none());
        assert_eq!(parsed.state, ImSupervisorState::Starting);
    }

    #[test]
    fn every_platform_gets_a_distinct_lifecycle_lock() {
        // A shared lock would let two platforms serialize against each
        // other; a missing arm would silently fall back to WeChat's.
        let manager = ImSupervisorManager::new();
        let mut seen: Vec<*const Mutex<()>> = Vec::new();
        for platform in PLATFORMS {
            let lock = manager.lifecycle_lock(platform) as *const Mutex<()>;
            assert!(!seen.contains(&lock), "platform {platform} shares a lock");
            seen.push(lock);
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
}
