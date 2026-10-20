//! Access-token resolution for Sign in with ChatGPT credentials, behind
//! a per-`apiKeyRef` gate: read before locking, read again after locking,
//! and reuse a token another request already refreshed. Every write of
//! the credential (sign-in, refresh, clearing, sign-out, the startup
//! sweep) takes the same gate.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Utc;
use reqwest::StatusCode;
use tokio::sync::Mutex as AsyncMutex;

use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::GalleyError;

use super::secret::{SiwcSecret, TokenResponse};
use super::{
    compact_body_redacted, error_code_from_body, http_client, ChatgptPlanError, PlanResult,
    ResolvedAccessToken, REFRESH_SKEW_SECONDS, SIWC_RESOURCE, SIWC_TOKEN_URL,
    TERMINAL_REFRESH_CODES,
};

static SIWC_REFRESH_GATES: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();

/// Why a refresh did not produce a new credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RefreshFailure {
    /// The refresh token is dead (one of [`TERMINAL_REFRESH_CODES`]).
    Terminal { code: String },
    /// Network error, 5xx or 429: try again later.
    Temporary { detail: String },
    /// Any other rejection: kept as an error, credentials untouched.
    Rejected { detail: String },
}

pub async fn resolve_access_token(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> PlanResult<ResolvedAccessToken> {
    resolve_access_token_with_refresh(galley, api_key_ref, &refresh_over_network).await
}

pub(super) async fn resolve_access_token_with_refresh<F, Fut>(
    galley: &SqliteGalley,
    api_key_ref: &str,
    refresh: &F,
) -> PlanResult<ResolvedAccessToken>
where
    F: Fn(SiwcSecret) -> Fut + Send + Sync,
    Fut: Future<Output = Result<SiwcSecret, RefreshFailure>> + Send,
{
    let secret = read_secret(galley, api_key_ref).await?;
    ensure_has_tokens(&secret)?;
    if !secret.is_expiring(REFRESH_SKEW_SECONDS, Utc::now().timestamp()) {
        return Ok(secret.into_resolved());
    }

    let gate = refresh_gate(api_key_ref);
    let _guard = gate.lock().await;

    let secret = read_secret(galley, api_key_ref).await?;
    ensure_has_tokens(&secret)?;
    if !secret.is_expiring(REFRESH_SKEW_SECONDS, Utc::now().timestamp()) {
        return Ok(secret.into_resolved());
    }

    match refresh(secret.clone()).await {
        Ok(refreshed) => {
            save_secret(galley, api_key_ref, &refreshed).await?;
            Ok(refreshed.into_resolved())
        }
        Err(failure) => {
            // Another process may have rotated the stored credential
            // while our copy went stale; adopt it rather than clearing.
            if let Some(latest) = recover_refreshed_secret(galley, api_key_ref, &secret).await? {
                return Ok(latest.into_resolved());
            }
            match failure {
                RefreshFailure::Terminal { code } => {
                    save_secret(galley, api_key_ref, &secret.cleared(code.clone())).await?;
                    Err(ChatgptPlanError::ReauthRequired(format!(
                        "ChatGPT sign-in has expired ({code}); sign in with ChatGPT again"
                    )))
                }
                RefreshFailure::Temporary { detail } => {
                    record_refresh_error(galley, api_key_ref, &secret, &detail).await;
                    Err(ChatgptPlanError::Temporary(format!(
                        "refreshing the ChatGPT sign-in failed for now: {detail}"
                    )))
                }
                RefreshFailure::Rejected { detail } => {
                    record_refresh_error(galley, api_key_ref, &secret, &detail).await;
                    Err(ChatgptPlanError::Failed(format!(
                        "refreshing the ChatGPT sign-in failed: {detail}"
                    )))
                }
            }
        }
    }
}

fn ensure_has_tokens(secret: &SiwcSecret) -> PlanResult<()> {
    if secret.has_tokens() {
        return Ok(());
    }
    let reason = secret
        .last_refresh_error
        .as_deref()
        .map(|reason| format!(" ({reason})"))
        .unwrap_or_default();
    Err(ChatgptPlanError::ReauthRequired(format!(
        "ChatGPT sign-in has expired{reason}; sign in with ChatGPT again"
    )))
}

async fn refresh_over_network(secret: SiwcSecret) -> Result<SiwcSecret, RefreshFailure> {
    let http = http_client().map_err(|e| RefreshFailure::Temporary {
        detail: e.message(),
    })?;
    let resp = http
        .post(SIWC_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", secret.client_id.as_str()),
            ("refresh_token", secret.refresh_token.as_str()),
            ("resource", SIWC_RESOURCE),
        ])
        .send()
        .await
        .map_err(|e| RefreshFailure::Temporary {
            detail: format!("token request failed: {e}"),
        })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| RefreshFailure::Temporary {
        detail: format!("reading token response failed: {e}"),
    })?;
    refresh_body_to_secret(&secret, status, &body, Utc::now().timestamp())
}

/// Turn a refresh response into the next credential or a classified
/// failure. Pure, so the classification is testable without a network.
pub(super) fn refresh_body_to_secret(
    previous: &SiwcSecret,
    status: StatusCode,
    body: &str,
    now: i64,
) -> Result<SiwcSecret, RefreshFailure> {
    if !status.is_success() {
        return Err(classify_token_error(
            status,
            body,
            &[&previous.refresh_token, &previous.access_token],
        ));
    }
    let token: TokenResponse =
        serde_json::from_str(body).map_err(|e| RefreshFailure::Rejected {
            detail: format!("token response is invalid JSON: {e}"),
        })?;
    previous
        .refreshed(&token, now)
        .map_err(|detail| RefreshFailure::Rejected { detail })
}

/// Classify a failed token-endpoint response. The terminal reason may
/// sit in `error` or, more specifically, in `error_reason` (live probe,
/// 2026-10-20: a refresh after revocation answers 400 with
/// `{"error":"invalid_grant","error_reason":"refresh_token_invalidated"}`);
/// both are checked, and the more specific one is reported.
pub(super) fn classify_token_error(
    status: StatusCode,
    body: &str,
    secrets: &[&str],
) -> RefreshFailure {
    let code = error_code_from_body(body);
    let reason = error_reason_from_body(body);
    let terminal = [reason.as_deref(), code.as_deref()]
        .into_iter()
        .flatten()
        .find(|candidate| TERMINAL_REFRESH_CODES.contains(candidate));
    if let Some(terminal) = terminal {
        return RefreshFailure::Terminal {
            code: terminal.into(),
        };
    }
    let detail = match code {
        Some(code) => format!("HTTP {} {code}", status.as_u16()),
        None => format!(
            "HTTP {}: {}",
            status.as_u16(),
            compact_body_redacted(body, secrets)
        ),
    };
    if status.is_server_error() || status.as_u16() == 429 {
        RefreshFailure::Temporary { detail }
    } else {
        RefreshFailure::Rejected { detail }
    }
}

fn error_reason_from_body(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let reason = value.get("error_reason")?.as_str()?.trim();
    (!reason.is_empty()).then(|| reason.to_string())
}

/// Clear the stored tokens after the API itself reported the access
/// token revoked (401 `token_revoked`: signed out elsewhere, or Galley
/// disconnected in ChatGPT settings) — the same end state as a dead
/// refresh. Only when the stored credential still holds the rejected
/// token, so a newer sign-in is never wiped.
pub(super) async fn clear_revoked_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
    rejected_access_token: &str,
    reason: &str,
) -> PlanResult<()> {
    let gate = refresh_gate(api_key_ref);
    let _guard = gate.lock().await;
    let Ok(secret) = read_secret(galley, api_key_ref).await else {
        return Ok(());
    };
    if secret.access_token != rejected_access_token {
        return Ok(());
    }
    save_secret(galley, api_key_ref, &secret.cleared(reason.into())).await
}

pub(super) fn refresh_gate(api_key_ref: &str) -> Arc<AsyncMutex<()>> {
    let gates = SIWC_REFRESH_GATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut gates = gates.lock().expect("SIWC refresh gate mutex poisoned");
    gates
        .entry(api_key_ref.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

pub(super) async fn read_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> PlanResult<SiwcSecret> {
    let raw = credential_store::get_secret(galley, api_key_ref).await?;
    serde_json::from_str::<SiwcSecret>(&raw)
        .ok()
        .filter(|secret| secret.flow == super::SIWC_FLOW)
        .ok_or_else(|| {
            ChatgptPlanError::ReauthRequired(
                "the stored ChatGPT credential is not a ChatGPT plan sign-in; sign in with ChatGPT again"
                    .into(),
            )
        })
}

pub(super) async fn save_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
    secret: &SiwcSecret,
) -> PlanResult<()> {
    let serialized = serde_json::to_string(secret).map_err(|e| GalleyError::Internal {
        message: format!("serializing ChatGPT credential failed: {e}"),
    })?;
    credential_store::set_secret(galley, api_key_ref, &serialized).await?;
    Ok(())
}

/// Best effort: note why the last refresh failed without touching tokens.
async fn record_refresh_error(
    galley: &SqliteGalley,
    api_key_ref: &str,
    attempted: &SiwcSecret,
    detail: &str,
) {
    let mut noted = attempted.clone();
    noted.last_refresh_error = Some(detail.to_string());
    if let Err(e) = save_secret(galley, api_key_ref, &noted).await {
        eprintln!(
            "[chatgpt-siwc] recording refresh error failed: {}",
            e.code()
        );
    }
}

async fn recover_refreshed_secret(
    galley: &SqliteGalley,
    api_key_ref: &str,
    attempted: &SiwcSecret,
) -> PlanResult<Option<SiwcSecret>> {
    let Ok(latest) = read_secret(galley, api_key_ref).await else {
        return Ok(None);
    };
    let changed = latest.access_token != attempted.access_token
        || latest.refresh_token != attempted.refresh_token
        || latest.expires_at != attempted.expires_at;
    let same_account = latest.sub.is_none() || latest.sub == attempted.sub;
    if changed
        && same_account
        && latest.has_tokens()
        && !latest.is_expiring(REFRESH_SKEW_SECONDS, Utc::now().timestamp())
    {
        return Ok(Some(latest));
    }
    Ok(None)
}
