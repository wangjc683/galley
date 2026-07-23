//! The ChatGPT / Codex OAuth secret model, JWT claim helpers, and the
//! Codex CLI `auth.json` read / write-back coupling.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::error::{GalleyError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexOAuthSecret {
    pub(super) access_token: String,
    pub(super) refresh_token: String,
    #[serde(default)]
    pub(super) expires_at: Option<i64>,
    #[serde(default)]
    pub(super) account_id: Option<String>,
    #[serde(default)]
    pub(super) last_refresh_at: Option<String>,
    #[serde(default)]
    pub(super) last_refresh_error: Option<String>,
}

impl CodexOAuthSecret {
    pub(super) fn new(access_token: String, refresh_token: String) -> Result<Self> {
        Self::with_expires_in(access_token, refresh_token, None)
    }

    pub(super) fn with_expires_in(
        access_token: String,
        refresh_token: String,
        expires_in: Option<i64>,
    ) -> Result<Self> {
        let access_token = access_token.trim().to_string();
        let refresh_token = refresh_token.trim().to_string();
        if access_token.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "ChatGPT / Codex token response did not include an access token".into(),
            });
        }
        if refresh_token.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "ChatGPT / Codex token response did not include a refresh token".into(),
            });
        }
        let fallback_expires_at = expires_in.map(|ttl| Utc::now().timestamp() + ttl.max(0));
        Ok(Self {
            expires_at: jwt_exp(&access_token).or(fallback_expires_at),
            account_id: account_id_from_jwt(&access_token),
            access_token,
            refresh_token,
            last_refresh_at: Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)),
            last_refresh_error: None,
        })
    }

    pub(super) fn is_expiring(&self, skew_seconds: i64) -> bool {
        let Some(exp) = self.expires_at.or_else(|| jwt_exp(&self.access_token)) else {
            return true;
        };
        exp <= Utc::now().timestamp() + skew_seconds
    }

    pub(super) fn into_resolved(self) -> ResolvedCodexAccessToken {
        ResolvedCodexAccessToken {
            access_token: self.access_token,
            account_id: self.account_id,
            expires_at: self.expires_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedCodexAccessToken {
    pub access_token: String,
    pub account_id: Option<String>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CodexCliAuthFile {
    tokens: CodexCliTokens,
}

#[derive(Debug, Deserialize)]
struct CodexCliTokens {
    access_token: String,
    refresh_token: String,
}

pub(super) fn codex_secret_accounts_are_compatible(
    current: &CodexOAuthSecret,
    candidate: &CodexOAuthSecret,
) -> bool {
    match current.account_id.as_deref() {
        Some(current_account_id) => candidate.account_id.as_deref() == Some(current_account_id),
        None => true,
    }
}

fn codex_cli_auth_path() -> Result<PathBuf> {
    let codex_home = std::env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".codex")))
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: "cannot locate Codex CLI auth directory".into(),
        })?;
    Ok(codex_home.join("auth.json"))
}

pub(super) fn read_codex_cli_secret() -> Result<CodexOAuthSecret> {
    let auth_path = codex_cli_auth_path()?;
    let body = std::fs::read_to_string(&auth_path).map_err(|e| GalleyError::InvalidArgs {
        message: format!(
            "Codex CLI login was not found at {}: {e}",
            auth_path.display()
        ),
    })?;
    let file: CodexCliAuthFile =
        serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
            message: format!("Codex CLI auth file is invalid JSON: {e}"),
        })?;
    CodexOAuthSecret::new(file.tokens.access_token, file.tokens.refresh_token)
}

/// Best-effort write-back of rotated tokens into `~/.codex/auth.json`.
/// Only touches the file when its refresh token equals the one we just
/// consumed — if the CLI re-logged-in to a different lineage in the
/// meantime, the file is not ours to change. Unknown fields are
/// preserved (Value-level merge, not a struct round-trip); the write is
/// atomic via temp-file + rename. Failures are logged and swallowed:
/// keeping the CLI in sync is a courtesy, not a Galley invariant.
pub(super) fn sync_rotated_tokens_to_codex_cli(
    consumed_refresh_token: &str,
    refreshed: &CodexOAuthSecret,
) {
    let Ok(auth_path) = codex_cli_auth_path() else {
        return;
    };
    sync_rotated_tokens_to_codex_cli_at(&auth_path, consumed_refresh_token, refreshed);
}

pub(super) fn sync_rotated_tokens_to_codex_cli_at(
    auth_path: &std::path::Path,
    consumed_refresh_token: &str,
    refreshed: &CodexOAuthSecret,
) {
    let Ok(body) = std::fs::read_to_string(auth_path) else {
        return; // no CLI login on this machine
    };
    let Ok(mut file) = serde_json::from_str::<Value>(&body) else {
        return;
    };
    let Some(tokens) = file.get_mut("tokens").and_then(Value::as_object_mut) else {
        return;
    };
    if tokens.get("refresh_token").and_then(Value::as_str) != Some(consumed_refresh_token) {
        return;
    }
    tokens.insert(
        "access_token".into(),
        Value::String(refreshed.access_token.clone()),
    );
    tokens.insert(
        "refresh_token".into(),
        Value::String(refreshed.refresh_token.clone()),
    );
    if file.get("last_refresh").is_some() {
        file["last_refresh"] =
            Value::String(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
    }
    let serialized = match serde_json::to_string_pretty(&file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[codex-oauth] serializing auth.json write-back failed: {e}");
            return;
        }
    };
    let tmp_path = auth_path.with_extension("json.galley-tmp");
    if let Err(e) = std::fs::write(&tmp_path, &serialized) {
        eprintln!("[codex-oauth] writing auth.json write-back failed: {e}");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
    }
    if let Err(e) = std::fs::rename(&tmp_path, auth_path) {
        eprintln!("[codex-oauth] replacing auth.json failed: {e}");
        let _ = std::fs::remove_file(&tmp_path);
    }
}

pub(super) fn jwt_exp(token: &str) -> Option<i64> {
    let claims = jwt_claims(token)?;
    claims.get("exp").and_then(Value::as_i64)
}

pub(super) fn account_id_from_jwt(token: &str) -> Option<String> {
    let claims = jwt_claims(token)?;
    claims
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let normalized = payload.trim_end_matches('=');
    let bytes = URL_SAFE_NO_PAD.decode(normalized).ok()?;
    serde_json::from_slice(&bytes).ok()
}
