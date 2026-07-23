//! Galley-managed IM Supervisor process management.
//!
//! The process is Galley-owned managed runtime state, not an external
//! GenericAgent checkout.
//!
//! `manager` owns the per-platform process slots and lifecycle;
//! `platform_config` owns the Feishu / Telegram credentials, owner
//! pairing, and spawn-time env. This file keeps the shared platform
//! constants, status types, enable-prefs, and path helpers.

mod manager;
mod platform_config;

pub use manager::ImSupervisorManager;
pub use platform_config::{
    delete_feishu_im_config, delete_telegram_im_config, get_feishu_im_config,
    get_telegram_im_config, save_feishu_im_config, save_telegram_im_config, FeishuImConfig,
    SaveFeishuImConfigInput, SaveTelegramImConfigInput, TelegramImConfig,
};

use crate::api::GalleyApi;
use crate::db::SqliteGalley;
use crate::managed_model_config;
use crate::managed_runtime;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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

fn normalize_platform(platform: &str) -> Result<&'static str, String> {
    match platform.trim().to_ascii_lowercase().as_str() {
        WECHAT => Ok(WECHAT),
        FEISHU => Ok(FEISHU),
        TELEGRAM => Ok(TELEGRAM),
        other => Err(format!("unsupported IM platform: {other}")),
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
    fn materialize_sop_reference_writes_galley_owned_copy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = materialize_sop_reference(tmp.path()).expect("write sop reference");
        assert!(path.ends_with("im/reference/galley-supervisor-sop.md"));
        let body = std::fs::read_to_string(path).expect("read sop");
        assert!(body.contains("Galley Supervisor SOP"));
    }
}
