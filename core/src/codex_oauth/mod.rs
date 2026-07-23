//! ChatGPT / Codex OAuth and managed credential IPC support.
//!
//! This module is intentionally Core-owned: refresh/API keys stay in Galley's
//! encrypted local store and managed GA requests runtime credentials over a
//! localhost-only IPC channel.
//!
//! Submodules by domain: `login` (device flow + CLI import), `secret`
//! (the OAuth secret model + Codex CLI auth.json coupling), `refresh`
//! (token resolution, refresh gate, recovery), `probe` (connection
//! test), `usage` (429 usage-limit messaging), `ipc` (the credential
//! IPC listener). This file keeps the shared constants, the provider /
//! model persistence step, and small HTTP/error helpers.

mod ipc;
mod login;
mod probe;
mod refresh;
mod secret;
#[cfg(test)]
mod tests;
mod usage;

pub use ipc::{start_credential_ipc, CodexCredentialIpcConfig, CredentialIpcAllowlist};
pub use login::{
    complete_device_login, import_cli_login, start_device_login, CodexDeviceLoginStart,
    CompleteCodexDeviceLoginInput,
};
pub use refresh::resolve_access_token;
pub use secret::ResolvedCodexAccessToken;

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::api::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelProtocol,
    ManagedModelProviderRecord, ManagedModelRecord,
};
use crate::commands::MANAGED_MODEL_DEFAULT_CONTEXT_WIN;
use crate::credential_store;
use crate::db::{SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata};
use crate::error::{GalleyError, Result};

use probe::probe_with_access_token;
use secret::CodexOAuthSecret;

pub const CODEX_PROVIDER_ID: &str = "mp_chatgpt_codex";
pub const CODEX_MODEL_ID: &str = "mm_chatgpt_codex_gpt_55";
pub const CODEX_DISPLAY_NAME: &str = "ChatGPT / Codex";
pub const CODEX_API_BASE: &str = "https://chatgpt.com/backend-api/codex";
pub const CODEX_DEFAULT_MODEL: &str = "gpt-5.5";
pub const CODEX_DEFAULT_REASONING: &str = "medium";

const CODEX_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_AUTH_ISSUER: &str = "https://auth.openai.com";
const CODEX_DEVICE_URL: &str = "https://auth.openai.com/codex/device";
const CODEX_WHAM_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_PROBE_INSTRUCTIONS: &str =
    "This is a Galley model health check. Reply with a short acknowledgement.";
const REFRESH_SKEW_SECONDS: i64 = 120;
const HTTP_TIMEOUT_SECS: u64 = 20;
const WHAM_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderActionInput {
    #[serde(default)]
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAuthSetupResult {
    pub provider: ManagedModelProviderRecord,
    pub model: ManagedModelRecord,
    pub status: ManagedModelConnectionResult,
}

pub async fn logout_provider(input: CodexProviderActionInput) -> Result<()> {
    let provider_id = input
        .provider_id
        .unwrap_or_else(|| CODEX_PROVIDER_ID.into());
    let galley = SqliteGalley::open().await?;
    let api_key_ref = galley
        .list_managed_model_providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .map(|provider| provider.api_key_ref)
        .unwrap_or_else(|| credential_store::managed_provider_api_key_ref(&provider_id));
    credential_store::delete_secret(&galley, &api_key_ref).await
}

pub async fn test_codex_connection(
    api_key_ref: &str,
    model: &str,
    reasoning_effort: &str,
) -> Result<ManagedModelConnectionResult> {
    let galley = SqliteGalley::open().await?;
    let token = resolve_access_token(&galley, api_key_ref).await?;
    probe_with_access_token(&token.access_token, model, reasoning_effort).await
}

async fn persist_probe_and_return(secret: CodexOAuthSecret) -> Result<CodexAuthSetupResult> {
    let galley = SqliteGalley::open().await?;
    let api_key_ref = credential_store::managed_provider_api_key_ref(CODEX_PROVIDER_ID);
    let serialized = serde_json::to_string(&secret).map_err(|e| GalleyError::Internal {
        message: format!("serializing Codex credential failed: {e}"),
    })?;
    credential_store::set_secret(&galley, &api_key_ref, &serialized).await?;
    let provider = galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: CODEX_PROVIDER_ID.into(),
            display_name: CODEX_DISPLAY_NAME.into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ChatgptCodexOauth,
            api_base: CODEX_API_BASE.into(),
            api_key_ref,
        })
        .await?;
    let model = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: CODEX_MODEL_ID.into(),
            provider_id: CODEX_PROVIDER_ID.into(),
            display_name: CODEX_DEFAULT_MODEL.into(),
            model: CODEX_DEFAULT_MODEL.into(),
            advanced_options: codex_default_advanced_options(),
            make_default: false,
        })
        .await?;
    let status = match probe_with_access_token(
        &secret.access_token,
        CODEX_DEFAULT_MODEL,
        CODEX_DEFAULT_REASONING,
    )
    .await
    {
        Ok(status) => status,
        // Credentials, provider, and model are persisted above — a
        // transient probe failure (429 / 5xx / offline) must not surface
        // as "sign-in failed" when the sign-in in fact succeeded. Report
        // a non-ok connection status the GUI can show as retryable.
        Err(e) => ManagedModelConnectionResult {
            ok: false,
            endpoint: format!("{CODEX_API_BASE}/responses"),
            model_found: None,
            message: e.to_string(),
        },
    };
    Ok(CodexAuthSetupResult {
        provider,
        model,
        status,
    })
}

pub fn codex_default_advanced_options() -> serde_json::Value {
    serde_json::json!({
        "context_win": MANAGED_MODEL_DEFAULT_CONTEXT_WIN,
        "api_mode": "responses",
        "reasoning_effort": CODEX_DEFAULT_REASONING,
        "temperature": 1,
        "max_retries": 3,
        "connect_timeout": 10,
        "read_timeout": 180,
        "stream": true,
        "codex_backend": true
    })
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })
}

fn nonempty(value: Option<String>, field: &str) -> Result<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: format!("ChatGPT / Codex response missing {field}"),
        })
}

fn compact_body(body: &str) -> String {
    let trimmed = body.trim().replace('\n', " ");
    if trimmed.chars().count() <= 240 {
        return trimmed;
    }
    let prefix: String = trimmed.chars().take(240).collect();
    format!("{prefix}...")
}

fn compact_body_redacted(body: &str, secrets: &[Option<&str>]) -> String {
    let mut redacted = body.to_string();
    for secret in secrets.iter().flatten() {
        let secret = secret.trim();
        if !secret.is_empty() {
            redacted = redacted.replace(secret, "[redacted]");
        }
    }
    compact_body(&redacted)
}
