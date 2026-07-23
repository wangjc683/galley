//! Feishu / Telegram channel configuration: credentials in the
//! encrypted store, config prefs, owner pairing, and the spawn-time
//! platform env handed to the supervisor process.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::api::GalleyApi;
use crate::credential_store;
use crate::db::SqliteGalley;

use super::{
    now_iso, FEISHU, FEISHU_CONFIG_PREF, FEISHU_SECRET_REF, TELEGRAM, TELEGRAM_CONFIG_PREF,
    TELEGRAM_TOKEN_REF,
};

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
pub(super) struct OwnerBindingContext {
    pub(super) owner_open_id: Option<String>,
    pub(super) bind_code: Option<String>,
}

pub(super) async fn append_platform_env(
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
pub(super) async fn pref_owner(platform: &str) -> Option<String> {
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

pub(super) async fn persist_owner(platform: &str, owner_id: &str) -> Result<(), String> {
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

pub(super) async fn clear_owner_pref(platform: &str) -> Result<(), String> {
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

pub(super) async fn feishu_config_ready() -> bool {
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

pub(super) async fn telegram_config_ready() -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_code_is_six_digits() {
        for _ in 0..20 {
            let code = generate_bind_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()), "code: {code}");
        }
    }

    #[test]
    fn telegram_config_pref_deserializes_defaults() {
        let empty: TelegramConfigPref = serde_json::from_str("{}").expect("parse empty pref");
        assert!(empty.owner_user_id.is_none());
        assert!(empty.owner_bound_at.is_none());
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
}
