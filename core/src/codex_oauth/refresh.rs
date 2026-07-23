//! Access-token resolution and refresh: the per-ref refresh gate, token
//! endpoint parsing, and the two recovery paths after a failed refresh
//! (a concurrent process already rotated the DB secret, or the Codex
//! CLI holds a usable same-account credential).

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};

use reqwest::StatusCode;
use serde::Deserialize;
use tokio::sync::Mutex as AsyncMutex;

use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

use super::secret::{
    codex_secret_accounts_are_compatible, read_codex_cli_secret, sync_rotated_tokens_to_codex_cli,
    CodexOAuthSecret, ResolvedCodexAccessToken,
};
use super::{
    compact_body_redacted, http_client, nonempty, CODEX_OAUTH_CLIENT_ID, CODEX_OAUTH_TOKEN_URL,
    REFRESH_SKEW_SECONDS,
};

static CODEX_REFRESH_GATES: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

pub async fn resolve_access_token(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> Result<ResolvedCodexAccessToken> {
    resolve_access_token_with_refresh(galley, api_key_ref, &refresh_secret_with_cli_sync, true)
        .await
}

pub(super) async fn resolve_access_token_with_refresh<F, Fut>(
    galley: &SqliteGalley,
    api_key_ref: &str,
    refresh: &F,
    allow_cli_fallback: bool,
) -> Result<ResolvedCodexAccessToken>
where
    F: Fn(CodexOAuthSecret) -> Fut + Send + Sync,
    Fut: Future<Output = Result<CodexOAuthSecret>> + Send,
{
    let secret = read_codex_oauth_secret(galley, api_key_ref).await?;
    if !secret.is_expiring(REFRESH_SKEW_SECONDS) {
        return Ok(secret.into_resolved());
    }

    let gate = refresh_gate(api_key_ref);
    let _guard = gate.lock().await;

    let secret = read_codex_oauth_secret(galley, api_key_ref).await?;
    if !secret.is_expiring(REFRESH_SKEW_SECONDS) {
        return Ok(secret.into_resolved());
    }

    match refresh(secret.clone()).await {
        Ok(refreshed) => {
            save_codex_oauth_secret(galley, api_key_ref, &refreshed).await?;
            Ok(refreshed.into_resolved())
        }
        Err(err) => {
            if let Some(recovered) =
                recover_refreshed_codex_secret(galley, api_key_ref, &secret).await?
            {
                return Ok(recovered.into_resolved());
            }
            if allow_cli_fallback {
                if let Some(recovered) = recover_codex_cli_secret(&secret, refresh).await {
                    save_codex_oauth_secret(galley, api_key_ref, &recovered).await?;
                    return Ok(recovered.into_resolved());
                }
            }
            Err(err)
        }
    }
}

async fn refresh_secret(secret: CodexOAuthSecret) -> Result<CodexOAuthSecret> {
    if secret.refresh_token.trim().is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "ChatGPT / Codex session expired; sign in again".into(),
        });
    }
    let client = http_client()?;
    let resp = client
        .post(CODEX_OAUTH_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", secret.refresh_token.as_str()),
            ("client_id", CODEX_OAUTH_CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("refreshing ChatGPT / Codex token failed: {e}"),
        })?;
    token_response_to_secret(resp, Some(secret.refresh_token)).await
}

/// Refresh a ChatGPT / Codex secret and, if the Codex CLI's auth.json
/// still holds the exact refresh token we just consumed, sync the
/// rotated tokens back to it. OpenAI rotates refresh tokens with reuse
/// detection: leaving the CLI on the consumed token logs the CLI out on
/// its next refresh, and repeated reuse can revoke the whole token
/// family — taking Galley's copy down with it.
pub(super) async fn refresh_secret_with_cli_sync(
    secret: CodexOAuthSecret,
) -> Result<CodexOAuthSecret> {
    let consumed_refresh_token = secret.refresh_token.clone();
    let refreshed = refresh_secret(secret).await?;
    sync_rotated_tokens_to_codex_cli(&consumed_refresh_token, &refreshed);
    Ok(refreshed)
}

fn refresh_gate(api_key_ref: &str) -> Arc<AsyncMutex<()>> {
    let gates = CODEX_REFRESH_GATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut gates = gates.lock().expect("Codex refresh gate mutex poisoned");
    gates
        .entry(api_key_ref.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

pub(super) async fn read_codex_oauth_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> Result<CodexOAuthSecret> {
    let raw = credential_store::get_secret(galley, api_key_ref).await?;
    serde_json::from_str(&raw).map_err(|e| GalleyError::InvalidArgs {
        message: format!("ChatGPT / Codex credential is invalid: {e}"),
    })
}

async fn save_codex_oauth_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
    secret: &CodexOAuthSecret,
) -> Result<()> {
    let serialized = serde_json::to_string(secret).map_err(|e| GalleyError::Internal {
        message: format!("serializing refreshed Codex credential failed: {e}"),
    })?;
    credential_store::set_secret(galley, api_key_ref, &serialized).await
}

async fn recover_refreshed_codex_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
    attempted: &CodexOAuthSecret,
) -> Result<Option<CodexOAuthSecret>> {
    let latest = read_codex_oauth_secret(galley, api_key_ref).await?;
    let changed = latest.access_token != attempted.access_token
        || latest.refresh_token != attempted.refresh_token
        || latest.expires_at != attempted.expires_at;
    if changed
        && !latest.is_expiring(REFRESH_SKEW_SECONDS)
        && codex_secret_accounts_are_compatible(attempted, &latest)
    {
        return Ok(Some(latest));
    }
    Ok(None)
}

pub(super) async fn recover_codex_cli_secret<F, Fut>(
    attempted: &CodexOAuthSecret,
    refresh: &F,
) -> Option<CodexOAuthSecret>
where
    F: Fn(CodexOAuthSecret) -> Fut + Send + Sync,
    Fut: Future<Output = Result<CodexOAuthSecret>> + Send,
{
    let mut candidate = read_codex_cli_secret().ok()?;
    if !codex_secret_accounts_are_compatible(attempted, &candidate) {
        return None;
    }
    if candidate.is_expiring(REFRESH_SKEW_SECONDS) {
        candidate = refresh(candidate).await.ok()?;
        if !codex_secret_accounts_are_compatible(attempted, &candidate) {
            return None;
        }
    }
    if candidate.is_expiring(REFRESH_SKEW_SECONDS) {
        return None;
    }
    Some(candidate)
}

pub(super) async fn token_response_to_secret(
    resp: reqwest::Response,
    previous_refresh_token: Option<String>,
) -> Result<CodexOAuthSecret> {
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading ChatGPT / Codex token response failed: {e}"),
    })?;
    token_body_to_secret(status, &body, previous_refresh_token)
}

pub(super) fn token_body_to_secret(
    status: StatusCode,
    body: &str,
    previous_refresh_token: Option<String>,
) -> Result<CodexOAuthSecret> {
    if status.as_u16() == 429 {
        return Err(GalleyError::InvalidArgs {
            message: "Codex usage limit reached; retry after the limit resets".into(),
        });
    }
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: token_error_message(status, body, previous_refresh_token.as_deref()),
        });
    }
    let token: TokenResponse =
        serde_json::from_str(body).map_err(|e| GalleyError::InvalidArgs {
            message: format!("ChatGPT / Codex token response is invalid JSON: {e}"),
        })?;
    let access_token = nonempty(token.access_token, "access_token")?;
    let refresh_token = token
        .refresh_token
        .filter(|s| !s.trim().is_empty())
        .or(previous_refresh_token)
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: "ChatGPT / Codex token response did not include a refresh token".into(),
        })?;
    CodexOAuthSecret::with_expires_in(access_token, refresh_token, token.expires_in)
}

pub(super) fn token_error_message(
    status: StatusCode,
    body: &str,
    previous_refresh_token: Option<&str>,
) -> String {
    let lower = body.to_ascii_lowercase();
    if lower.contains("refresh_token_reused") || lower.contains("refresh token reused") {
        return "ChatGPT / Codex token was already refreshed elsewhere; sign in again if it persists"
            .into();
    }
    if lower.contains("invalid_grant") || status.as_u16() == 401 || status.as_u16() == 403 {
        return "ChatGPT / Codex session expired; sign in again".into();
    }
    format!(
        "ChatGPT / Codex token request failed (HTTP {}: {})",
        status.as_u16(),
        compact_body_redacted(body, &[previous_refresh_token])
    )
}
