//! ChatGPT / Codex OAuth and managed credential IPC support.
//!
//! This module is intentionally Core-owned: refresh/API keys stay in Galley's
//! encrypted local store and managed GA requests runtime credentials over a
//! localhost-only IPC channel.

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{SecondsFormat, TimeZone, Utc};
use reqwest::StatusCode;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

use crate::api::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelProtocol,
    ManagedModelProviderRecord, ManagedModelRecord,
};
use crate::commands::MANAGED_MODEL_DEFAULT_CONTEXT_WIN;
use crate::credential_store;
use crate::db::{SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata};
use crate::error::{GalleyError, Result};

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

static CODEX_REFRESH_GATES: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDeviceLoginStart {
    pub device_auth_id: String,
    pub user_code: String,
    pub verification_url: String,
    pub interval_seconds: u64,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteCodexDeviceLoginInput {
    pub device_auth_id: String,
    pub user_code: String,
    #[serde(default)]
    pub interval_seconds: Option<u64>,
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCredentialIpcConfig {
    pub kind: &'static str,
    pub address: String,
    pub token: String,
}

pub type CredentialIpcAllowlist = HashMap<String, ManagedModelAuthKind>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexOAuthSecret {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    last_refresh_at: Option<String>,
    #[serde(default)]
    last_refresh_error: Option<String>,
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

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    user_code: Option<String>,
    device_auth_id: Option<String>,
    interval: Option<Value>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct DevicePollResponse {
    authorization_code: Option<String>,
    code_verifier: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialIpcRequest {
    token: String,
    api_key_ref: String,
    #[serde(default)]
    credential_kind: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialIpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<i64>,
}

impl CredentialIpcResponse {
    fn api_key(api_key: String) -> Self {
        Self {
            api_key: Some(api_key),
            access_token: None,
            account_id: None,
            expires_at: None,
        }
    }

    fn codex_access_token(resolved: ResolvedCodexAccessToken) -> Self {
        Self {
            api_key: None,
            access_token: Some(resolved.access_token),
            account_id: resolved.account_id,
            expires_at: resolved.expires_at,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CredentialKind {
    ApiKey,
    ChatgptCodexOauth,
}

impl CredentialKind {
    fn parse(raw: Option<&str>) -> Result<Self> {
        match raw.unwrap_or("chatgpt_codex_oauth") {
            "api_key" => Ok(Self::ApiKey),
            "chatgpt_codex_oauth" => Ok(Self::ChatgptCodexOauth),
            other => Err(GalleyError::InvalidArgs {
                message: format!("credential IPC credentialKind is unsupported: {other}"),
            }),
        }
    }

    fn expected_auth_kind(self) -> ManagedModelAuthKind {
        match self {
            Self::ApiKey => ManagedModelAuthKind::ApiKey,
            Self::ChatgptCodexOauth => ManagedModelAuthKind::ChatgptCodexOauth,
        }
    }
}

pub async fn start_device_login() -> Result<CodexDeviceLoginStart> {
    let client = http_client()?;
    let resp = client
        .post(format!(
            "{CODEX_AUTH_ISSUER}/api/accounts/deviceauth/usercode"
        ))
        .json(&serde_json::json!({ "client_id": CODEX_OAUTH_CLIENT_ID }))
        .send()
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("ChatGPT sign-in request failed: {e}"),
        })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading ChatGPT sign-in response failed: {e}"),
    })?;
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "ChatGPT sign-in failed (HTTP {}: {})",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    let data: DeviceCodeResponse =
        serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
            message: format!("ChatGPT sign-in response is invalid JSON: {e}"),
        })?;
    let device_auth_id = nonempty(data.device_auth_id, "device_auth_id")?;
    let user_code = nonempty(data.user_code, "user_code")?;
    let interval_seconds = parse_interval(data.interval).unwrap_or(5).max(3);
    let expires_at = data.expires_in.map(|ttl| {
        (Utc::now() + chrono::Duration::seconds(ttl.max(0)))
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    });
    Ok(CodexDeviceLoginStart {
        device_auth_id,
        user_code,
        verification_url: CODEX_DEVICE_URL.into(),
        interval_seconds,
        expires_at,
    })
}

pub async fn complete_device_login(
    input: CompleteCodexDeviceLoginInput,
) -> Result<CodexAuthSetupResult> {
    let authorization = poll_device_authorization(&input).await?;
    let secret = exchange_authorization_code(authorization).await?;
    persist_probe_and_return(secret).await
}

pub async fn import_cli_login() -> Result<CodexAuthSetupResult> {
    let mut secret = read_codex_cli_secret()?;
    if secret.is_expiring(REFRESH_SKEW_SECONDS) {
        secret = refresh_secret_with_cli_sync(secret).await?;
    }
    persist_probe_and_return(secret).await
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

pub async fn resolve_access_token(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> Result<ResolvedCodexAccessToken> {
    resolve_access_token_with_refresh(galley, api_key_ref, &refresh_secret_with_cli_sync, true)
        .await
}

async fn resolve_access_token_with_refresh<F, Fut>(
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

#[derive(Debug, Clone)]
pub struct ResolvedCodexAccessToken {
    pub access_token: String,
    pub account_id: Option<String>,
    pub expires_at: Option<i64>,
}

/// Process-wide credential IPC handle. One listener serves every
/// managed runner: the per-spawn variant leaked a task + fd + socket
/// file on every spawn (they were never closed).
struct CredentialIpcHandle {
    config: CodexCredentialIpcConfig,
    allowlist: Arc<RwLock<CredentialIpcAllowlist>>,
}

static CREDENTIAL_IPC_SINGLETON: OnceLock<AsyncMutex<Option<CredentialIpcHandle>>> =
    OnceLock::new();

/// Get-or-create the process-wide credential IPC listener and merge
/// `allowed_credentials` into its allowlist. Refs are only added, never
/// removed — a logged-out credential's secret is gone from the store,
/// so a stale allowlist entry cannot leak anything.
pub async fn start_credential_ipc(
    allowed_credentials: CredentialIpcAllowlist,
) -> Result<CodexCredentialIpcConfig> {
    let singleton = CREDENTIAL_IPC_SINGLETON.get_or_init(|| AsyncMutex::new(None));
    let mut slot = singleton.lock().await;
    if let Some(handle) = slot.as_ref() {
        handle
            .allowlist
            .write()
            .expect("credential allowlist lock poisoned")
            .extend(allowed_credentials);
        return Ok(handle.config.clone());
    }
    let token = random_hex(24)?;
    let allowlist = Arc::new(RwLock::new(allowed_credentials));
    let config = start_platform_credential_ipc(token, allowlist.clone()).await?;
    *slot = Some(CredentialIpcHandle {
        config: config.clone(),
        allowlist,
    });
    Ok(config)
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

async fn poll_device_authorization(
    input: &CompleteCodexDeviceLoginInput,
) -> Result<DevicePollResponse> {
    let client = http_client()?;
    let interval = input.interval_seconds.unwrap_or(5).max(3);
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(15 * 60) {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let resp = client
            .post(format!("{CODEX_AUTH_ISSUER}/api/accounts/deviceauth/token"))
            .json(&serde_json::json!({
                "device_auth_id": input.device_auth_id,
                "user_code": input.user_code,
            }))
            .send()
            .await
            .map_err(|e| GalleyError::RunnerError {
                message: format!("polling ChatGPT sign-in failed: {e}"),
            })?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
            message: format!("reading ChatGPT sign-in poll response failed: {e}"),
        })?;
        if status.is_success() {
            let data: DevicePollResponse =
                serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
                    message: format!("ChatGPT sign-in poll response is invalid JSON: {e}"),
                })?;
            if data.authorization_code.is_some() && data.code_verifier.is_some() {
                return Ok(data);
            }
        } else if status.as_u16() == 403 || status.as_u16() == 404 {
            continue;
        } else {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "ChatGPT sign-in polling failed (HTTP {}: {})",
                    status.as_u16(),
                    compact_body(&body)
                ),
            });
        }
    }
    Err(GalleyError::InvalidArgs {
        message: "ChatGPT sign-in timed out".into(),
    })
}

async fn exchange_authorization_code(
    authorization: DevicePollResponse,
) -> Result<CodexOAuthSecret> {
    let code = nonempty(authorization.authorization_code, "authorization_code")?;
    let verifier = nonempty(authorization.code_verifier, "code_verifier")?;
    let client = http_client()?;
    let resp = client
        .post(CODEX_OAUTH_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            (
                "redirect_uri",
                "https://auth.openai.com/deviceauth/callback",
            ),
            ("client_id", CODEX_OAUTH_CLIENT_ID),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("exchanging ChatGPT sign-in code failed: {e}"),
        })?;
    token_response_to_secret(resp, None).await
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

fn refresh_gate(api_key_ref: &str) -> Arc<AsyncMutex<()>> {
    let gates = CODEX_REFRESH_GATES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut gates = gates.lock().expect("Codex refresh gate mutex poisoned");
    gates
        .entry(api_key_ref.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

async fn read_codex_oauth_secret(
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

async fn recover_codex_cli_secret<F, Fut>(
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

/// Refresh a ChatGPT / Codex secret and, if the Codex CLI's auth.json
/// still holds the exact refresh token we just consumed, sync the
/// rotated tokens back to it. OpenAI rotates refresh tokens with reuse
/// detection: leaving the CLI on the consumed token logs the CLI out on
/// its next refresh, and repeated reuse can revoke the whole token
/// family — taking Galley's copy down with it.
async fn refresh_secret_with_cli_sync(secret: CodexOAuthSecret) -> Result<CodexOAuthSecret> {
    let consumed_refresh_token = secret.refresh_token.clone();
    let refreshed = refresh_secret(secret).await?;
    sync_rotated_tokens_to_codex_cli(&consumed_refresh_token, &refreshed);
    Ok(refreshed)
}

/// Best-effort write-back of rotated tokens into `~/.codex/auth.json`.
/// Only touches the file when its refresh token equals the one we just
/// consumed — if the CLI re-logged-in to a different lineage in the
/// meantime, the file is not ours to change. Unknown fields are
/// preserved (Value-level merge, not a struct round-trip); the write is
/// atomic via temp-file + rename. Failures are logged and swallowed:
/// keeping the CLI in sync is a courtesy, not a Galley invariant.
fn sync_rotated_tokens_to_codex_cli(consumed_refresh_token: &str, refreshed: &CodexOAuthSecret) {
    let Ok(auth_path) = codex_cli_auth_path() else {
        return;
    };
    sync_rotated_tokens_to_codex_cli_at(&auth_path, consumed_refresh_token, refreshed);
}

fn sync_rotated_tokens_to_codex_cli_at(
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
        file["last_refresh"] = Value::String(
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        );
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

fn codex_secret_accounts_are_compatible(
    current: &CodexOAuthSecret,
    candidate: &CodexOAuthSecret,
) -> bool {
    match current.account_id.as_deref() {
        Some(current_account_id) => candidate.account_id.as_deref() == Some(current_account_id),
        None => true,
    }
}

async fn token_response_to_secret(
    resp: reqwest::Response,
    previous_refresh_token: Option<String>,
) -> Result<CodexOAuthSecret> {
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading ChatGPT / Codex token response failed: {e}"),
    })?;
    token_body_to_secret(status, &body, previous_refresh_token)
}

fn token_body_to_secret(
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
        serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
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

fn token_error_message(
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

async fn probe_with_access_token(
    access_token: &str,
    model: &str,
    reasoning_effort: &str,
) -> Result<ManagedModelConnectionResult> {
    let endpoint = format!("{CODEX_API_BASE}/responses");
    let client = http_client()?;
    let mut req = client
        .post(&endpoint)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "codex_cli_rs/0.0.0 (Galley)")
        .header("originator", "codex_cli_rs")
        .json(&codex_probe_payload(model, reasoning_effort));
    let account_id = account_id_from_jwt(access_token);
    if let Some(account_id) = account_id.as_deref() {
        req = req.header("ChatGPT-Account-ID", account_id);
    }
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("testing ChatGPT / Codex model failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading ChatGPT / Codex probe response failed: {e}"),
    })?;
    if status.as_u16() == 429 {
        let message = fetch_codex_usage_limit_message(access_token, account_id.as_deref())
            .await
            .unwrap_or_else(|| "Codex usage limit reached; retry after the limit resets".into());
        return Err(GalleyError::InvalidArgs { message });
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(GalleyError::InvalidArgs {
            message: "ChatGPT / Codex session is not ready; sign in again".into(),
        });
    }
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "ChatGPT / Codex model test failed (HTTP {}: {})",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint,
        model_found: Some(true),
        message: "ChatGPT / Codex ready".into(),
    })
}

fn codex_probe_payload(model: &str, reasoning_effort: &str) -> Value {
    serde_json::json!({
        "model": model,
        "instructions": CODEX_PROBE_INSTRUCTIONS,
        "input": [
            {
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "ping" }
                ]
            }
        ],
        "stream": true,
        "store": false,
        "reasoning": { "effort": normalize_reasoning(reasoning_effort) }
    })
}

async fn fetch_codex_usage_limit_message(
    access_token: &str,
    account_id: Option<&str>,
) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(WHAM_TIMEOUT_SECS))
        .build()
        .ok()?;
    let mut req = client
        .get(CODEX_WHAM_USAGE_URL)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .header("User-Agent", "codex_cli_rs/0.0.0 (Galley)")
        .header("originator", "codex_cli_rs");
    if let Some(account_id) = account_id {
        req = req.header("ChatGPT-Account-ID", account_id);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: Value = resp.json().await.ok()?;
    codex_usage_limit_message_from_wham(&body, Utc::now().timestamp())
}

fn codex_usage_limit_message_from_wham(body: &Value, now_ts: i64) -> Option<String> {
    let rate_limit = body
        .get("rate_limit")
        .or_else(|| body.get("rateLimit"))
        .unwrap_or(body);
    let limit_reached = bool_field(rate_limit, "limit_reached")
        .or_else(|| bool_field(rate_limit, "limitReached"))
        .or_else(|| bool_field(body, "limit_reached"))
        .or_else(|| bool_field(body, "limitReached"));
    let windows: Vec<CodexUsageWindow> = [
        "primary_window",
        "secondary_window",
        "primaryWindow",
        "secondaryWindow",
        "primary",
        "secondary",
    ]
    .into_iter()
    .filter_map(|key| rate_limit.get(key))
    .filter_map(|window| parse_codex_usage_window(window, now_ts))
    .collect();

    if limit_reached == Some(false) {
        return Some("Codex request was rate limited temporarily; retry shortly".into());
    }

    let exhausted_reset = windows
        .iter()
        .filter(|window| window.exhausted)
        .filter_map(|window| window.reset_at)
        .max();
    let fallback_reset = (limit_reached == Some(true))
        .then(|| windows.iter().filter_map(|window| window.reset_at).max())
        .flatten();
    let reset_at = exhausted_reset.or(fallback_reset)?;
    Some(format!(
        "Codex usage limit reached; next reset in {} ({})",
        format_reset_duration(reset_at, now_ts),
        format_reset_timestamp(reset_at)
    ))
}

#[derive(Debug, Clone, Copy)]
struct CodexUsageWindow {
    exhausted: bool,
    reset_at: Option<i64>,
}

fn parse_codex_usage_window(window: &Value, now_ts: i64) -> Option<CodexUsageWindow> {
    let used_percent = number_field(window, "used_percent")
        .or_else(|| number_field(window, "usedPercent"))
        .or_else(|| number_field(window, "usage_percent"))
        .or_else(|| number_field(window, "usagePercent"));
    let exhausted = used_percent
        .map(|percent| percent >= 100.0 || (percent - 1.0).abs() < f64::EPSILON)
        .unwrap_or(false);
    let reset_at = parse_reset_at(window, now_ts);
    if used_percent.is_none() && reset_at.is_none() {
        return None;
    }
    Some(CodexUsageWindow {
        exhausted,
        reset_at,
    })
}

fn parse_reset_at(window: &Value, now_ts: i64) -> Option<i64> {
    let reset_at = window
        .get("reset_at")
        .or_else(|| window.get("resetAt"))
        .and_then(parse_timestamp_value);
    if reset_at.is_some() {
        return reset_at;
    }
    let after_seconds = number_field(window, "reset_after_seconds")
        .or_else(|| number_field(window, "resetAfterSeconds"))
        .map(|seconds| seconds.max(0.0).ceil() as i64);
    after_seconds.map(|seconds| now_ts + seconds)
}

fn parse_timestamp_value(value: &Value) -> Option<i64> {
    if let Some(ts) = value.as_i64() {
        return Some(if ts > 10_000_000_000 { ts / 1000 } else { ts });
    }
    if let Some(ts) = value.as_f64() {
        let ts = if ts > 10_000_000_000.0 {
            ts / 1000.0
        } else {
            ts
        };
        return Some(ts.round() as i64);
    }
    let text = value.as_str()?.trim();
    if let Ok(ts) = text.parse::<i64>() {
        return Some(if ts > 10_000_000_000 { ts / 1000 } else { ts });
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|dt| dt.timestamp())
}

fn number_field(value: &Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn bool_field(value: &Value, key: &str) -> Option<bool> {
    match value.get(key)? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn format_reset_duration(reset_at: i64, now_ts: i64) -> String {
    let seconds = reset_at.saturating_sub(now_ts);
    if seconds < 60 {
        return "less than 1 minute".into();
    }
    let minutes = (seconds + 59) / 60;
    if minutes < 60 {
        return plural_duration(minutes, "minute");
    }
    let hours = minutes / 60;
    let remaining_minutes = minutes % 60;
    if remaining_minutes == 0 {
        plural_duration(hours, "hour")
    } else {
        format!(
            "{} {}",
            plural_duration(hours, "hour"),
            plural_duration(remaining_minutes, "minute")
        )
    }
}

fn plural_duration(value: i64, unit: &str) -> String {
    if value == 1 {
        format!("{value} {unit}")
    } else {
        format!("{value} {unit}s")
    }
}

fn format_reset_timestamp(reset_at: i64) -> String {
    match Utc.timestamp_opt(reset_at, 0).single() {
        Some(dt) => dt.to_rfc3339_opts(SecondsFormat::Secs, true),
        None => format!("unix {reset_at}"),
    }
}

impl CodexOAuthSecret {
    fn new(access_token: String, refresh_token: String) -> Result<Self> {
        Self::with_expires_in(access_token, refresh_token, None)
    }

    fn with_expires_in(
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

    fn is_expiring(&self, skew_seconds: i64) -> bool {
        let Some(exp) = self.expires_at.or_else(|| jwt_exp(&self.access_token)) else {
            return true;
        };
        exp <= Utc::now().timestamp() + skew_seconds
    }

    fn into_resolved(self) -> ResolvedCodexAccessToken {
        ResolvedCodexAccessToken {
            access_token: self.access_token,
            account_id: self.account_id,
            expires_at: self.expires_at,
        }
    }
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })
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

fn read_codex_cli_secret() -> Result<CodexOAuthSecret> {
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

fn nonempty(value: Option<String>, field: &str) -> Result<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: format!("ChatGPT / Codex response missing {field}"),
        })
}

fn parse_interval(value: Option<Value>) -> Option<u64> {
    match value? {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn normalize_reasoning(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => "none",
        "low" => "low",
        "high" => "high",
        "xhigh" => "xhigh",
        _ => CODEX_DEFAULT_REASONING,
    }
}

fn jwt_exp(token: &str) -> Option<i64> {
    let claims = jwt_claims(token)?;
    claims.get("exp").and_then(Value::as_i64)
}

fn account_id_from_jwt(token: &str) -> Option<String> {
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

fn random_hex(bytes_len: usize) -> Result<String> {
    let rng = SystemRandom::new();
    let mut bytes = vec![0_u8; bytes_len];
    rng.fill(&mut bytes).map_err(|_| GalleyError::Internal {
        message: "generating credential IPC token failed".into(),
    })?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn credential_token_matches(actual: &str, expected: &str) -> bool {
    let actual = actual.as_bytes();
    let expected = expected.as_bytes();
    let mut diff = actual.len() ^ expected.len();
    for (idx, expected_byte) in expected.iter().copied().enumerate() {
        let actual_byte = actual.get(idx).copied().unwrap_or(0);
        diff |= usize::from(actual_byte ^ expected_byte);
    }
    diff == 0
}

#[cfg(unix)]
async fn start_platform_credential_ipc(
    token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<CodexCredentialIpcConfig> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;

    let address = std::env::temp_dir().join(format!(
        "galley-codex-{}-{}.sock",
        std::process::id(),
        random_hex(8)?
    ));
    let _ = std::fs::remove_file(&address);
    let listener = UnixListener::bind(&address).map_err(|e| GalleyError::Internal {
        message: format!("binding credential IPC socket failed: {e}"),
    })?;
    std::fs::set_permissions(&address, std::fs::Permissions::from_mode(0o600)).map_err(|e| {
        GalleyError::Internal {
            message: format!("securing credential IPC socket permissions failed: {e}"),
        }
    })?;
    let token_for_task = token.clone();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let token = token_for_task.clone();
            let allowed_credentials = allowed_credentials.clone();
            tokio::spawn(async move {
                let _ = handle_credential_ipc_stream(stream, token, allowed_credentials).await;
            });
        }
    });
    Ok(CodexCredentialIpcConfig {
        kind: "unix",
        address: address.to_string_lossy().into_owned(),
        token,
    })
}

#[cfg(windows)]
async fn start_platform_credential_ipc(
    token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<CodexCredentialIpcConfig> {
    let address = format!(
        r"\\.\pipe\galley-codex-{}-{}",
        std::process::id(),
        random_hex(8)?
    );
    let pipe_name = address.clone();
    let token_for_task = token.clone();
    tokio::spawn(async move {
        loop {
            let server = match create_secure_credential_pipe(&pipe_name) {
                Ok(server) => server,
                Err(e) => {
                    // A silent break here killed credential IPC for the
                    // rest of the process lifetime; failures are
                    // transient (handle pressure) — retry with backoff.
                    eprintln!(
                        "[codex-oauth] creating credential pipe instance failed: {e} — retrying in 500ms"
                    );
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            };
            if server.connect().await.is_err() {
                continue;
            }
            let token = token_for_task.clone();
            let allowed_credentials = allowed_credentials.clone();
            tokio::spawn(async move {
                let _ = handle_credential_ipc_stream(server, token, allowed_credentials).await;
            });
        }
    });
    Ok(CodexCredentialIpcConfig {
        kind: "windows_named_pipe",
        address,
        token,
    })
}

#[cfg(windows)]
fn create_secure_credential_pipe(
    pipe_name: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
    use std::ffi::c_void;
    use std::mem;
    use std::ptr;
    use tokio::net::windows::named_pipe::ServerOptions;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    // Owner Rights (OW) resolves to the creating user for this new kernel
    // object. BA/SY keep administrators and LocalSystem unblocked for normal
    // service/debug scenarios while excluding other authenticated users.
    let sddl: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;BA)(A;;GA;;;SY)"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut security_descriptor: *mut c_void = ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut security_descriptor,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }

    let mut attrs = SECURITY_ATTRIBUTES {
        nLength: mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security_descriptor,
        bInheritHandle: 0,
    };
    let result = unsafe {
        ServerOptions::new().create_with_security_attributes_raw(
            pipe_name,
            (&mut attrs as *mut SECURITY_ATTRIBUTES).cast(),
        )
    };
    unsafe {
        LocalFree(security_descriptor);
    }
    result
}

async fn handle_credential_ipc_stream<S>(
    stream: S,
    expected_token: String,
    allowed_credentials: Arc<RwLock<CredentialIpcAllowlist>>,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("reading credential IPC request failed: {e}"),
        })?;
    let response = match serde_json::from_str::<CredentialIpcRequest>(&line) {
        Ok(req) => {
            // Snapshot under the read lock; never hold it across await.
            let allowlist_snapshot = allowed_credentials
                .read()
                .expect("credential allowlist lock poisoned")
                .clone();
            build_credential_ipc_response(req, &expected_token, &allowlist_snapshot).await
        }
        Err(e) => Err(GalleyError::InvalidArgs {
            message: format!("credential IPC request is invalid JSON: {e}"),
        }),
    };
    let body = match response {
        Ok(response) => serde_json::to_vec(&response),
        Err(err) => serde_json::to_vec(&err),
    }
    .map_err(|e| GalleyError::Internal {
        message: format!("serializing credential IPC response failed: {e}"),
    })?;
    writer
        .write_all(&body)
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("writing credential IPC response failed: {e}"),
        })?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!("writing credential IPC response failed: {e}"),
        })?;
    Ok(())
}

async fn build_credential_ipc_response(
    req: CredentialIpcRequest,
    expected_token: &str,
    allowed_credentials: &CredentialIpcAllowlist,
) -> Result<CredentialIpcResponse> {
    let (api_key_ref, requested_kind) =
        validate_credential_ipc_request(req, expected_token, allowed_credentials)?;
    let galley = SqliteGalley::open().await?;
    fulfill_credential_ipc_request(&galley, api_key_ref, requested_kind).await
}

fn validate_credential_ipc_request(
    req: CredentialIpcRequest,
    expected_token: &str,
    allowed_credentials: &CredentialIpcAllowlist,
) -> Result<(String, CredentialKind)> {
    if !credential_token_matches(&req.token, expected_token) {
        return Err(GalleyError::InvalidArgs {
            message: "credential IPC token mismatch".into(),
        });
    }
    let requested_kind = CredentialKind::parse(req.credential_kind.as_deref())?;
    let Some(actual_auth_kind) = allowed_credentials.get(&req.api_key_ref).copied() else {
        return Err(GalleyError::InvalidArgs {
            message: "credential IPC apiKeyRef is not allowed for this runner".into(),
        });
    };
    let expected_auth_kind = requested_kind.expected_auth_kind();
    if actual_auth_kind != expected_auth_kind {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "credential IPC credentialKind does not match apiKeyRef auth kind: requested {:?}, actual {:?}",
                expected_auth_kind, actual_auth_kind
            ),
        });
    }
    Ok((req.api_key_ref, requested_kind))
}

async fn fulfill_credential_ipc_request(
    galley: &SqliteGalley,
    api_key_ref: String,
    requested_kind: CredentialKind,
) -> Result<CredentialIpcResponse> {
    match requested_kind {
        CredentialKind::ApiKey => {
            let api_key = credential_store::get_secret(galley, &api_key_ref).await?;
            Ok(CredentialIpcResponse::api_key(api_key))
        }
        CredentialKind::ChatgptCodexOauth => {
            let resolved = resolve_access_token(galley, &api_key_ref).await?;
            Ok(CredentialIpcResponse::codex_access_token(resolved))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    #[test]
    fn cli_sync_writes_rotated_tokens_when_lineage_matches() {
        let tmp = TempDir::new().expect("tempdir");
        let auth_path = tmp.path().join("auth.json");
        std::fs::write(
            &auth_path,
            r#"{"OPENAI_API_KEY":null,"tokens":{"id_token":"idt","access_token":"old-access","refresh_token":"consumed-rt","account_id":"acct-1"},"last_refresh":"2026-06-01T00:00:00.000Z"}"#,
        )
        .expect("seed auth.json");
        let refreshed =
            CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");

        sync_rotated_tokens_to_codex_cli_at(&auth_path, "consumed-rt", &refreshed);

        let file: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth_path).unwrap()).unwrap();
        assert_eq!(file["tokens"]["access_token"], "new-access");
        assert_eq!(file["tokens"]["refresh_token"], "new-rt");
        // Unknown fields survive the Value-level merge.
        assert_eq!(file["tokens"]["id_token"], "idt");
        assert_eq!(file["tokens"]["account_id"], "acct-1");
        assert!(file.get("OPENAI_API_KEY").is_some());
        // last_refresh was bumped away from the seeded value.
        assert_ne!(file["last_refresh"], "2026-06-01T00:00:00.000Z");
    }

    #[test]
    fn cli_sync_leaves_foreign_lineage_untouched() {
        let tmp = TempDir::new().expect("tempdir");
        let auth_path = tmp.path().join("auth.json");
        let original = r#"{"tokens":{"access_token":"cli-access","refresh_token":"cli-relogged-rt"}}"#;
        std::fs::write(&auth_path, original).expect("seed auth.json");
        let refreshed =
            CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");

        // The CLI re-logged-in since our import: its refresh token is no
        // longer the one we consumed, so the file is not ours to change.
        sync_rotated_tokens_to_codex_cli_at(&auth_path, "consumed-rt", &refreshed);

        assert_eq!(std::fs::read_to_string(&auth_path).unwrap(), original);
    }

    #[test]
    fn cli_sync_missing_auth_file_is_a_no_op() {
        let tmp = TempDir::new().expect("tempdir");
        let auth_path = tmp.path().join("auth.json");
        let refreshed =
            CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");
        sync_rotated_tokens_to_codex_cli_at(&auth_path, "consumed-rt", &refreshed);
        assert!(!auth_path.exists());
    }

    #[test]
    fn codex_default_advanced_options_includes_context_window() {
        let options = codex_default_advanced_options();

        assert_eq!(options["context_win"], serde_json::json!(90_000));
        assert_eq!(options["api_mode"], serde_json::json!("responses"));
        assert_eq!(
            options["reasoning_effort"],
            serde_json::json!(CODEX_DEFAULT_REASONING)
        );
        assert_eq!(options["stream"], serde_json::json!(true));
        assert_eq!(options["codex_backend"], serde_json::json!(true));
    }

    #[test]
    fn codex_probe_payload_includes_required_instructions() {
        let payload = codex_probe_payload("gpt-5.5", "high");

        assert_eq!(payload["model"], "gpt-5.5");
        assert_eq!(
            payload["input"],
            serde_json::json!([
                {
                    "role": "user",
                    "content": [
                        { "type": "input_text", "text": "ping" }
                    ]
                }
            ])
        );
        assert_eq!(payload["instructions"], CODEX_PROBE_INSTRUCTIONS);
        assert_eq!(payload["stream"], true);
        assert_eq!(payload["store"], false);
        assert!(payload.get("max_output_tokens").is_none());
        assert_eq!(payload["reasoning"]["effort"], "high");
    }

    #[test]
    fn codex_probe_payload_normalizes_unknown_reasoning() {
        let payload = codex_probe_payload("gpt-5.5", "surprise");

        assert_eq!(payload["reasoning"]["effort"], CODEX_DEFAULT_REASONING);
    }

    #[test]
    fn token_body_to_secret_preserves_previous_refresh_token_when_missing() {
        let access_token = fake_codex_access_token_with(3600, Some("acct_test"));
        let secret = token_body_to_secret(
            StatusCode::OK,
            &serde_json::json!({
                "access_token": access_token,
                "expires_in": 3600
            })
            .to_string(),
            Some("refresh-previous".into()),
        )
        .expect("token body should parse");

        assert_eq!(secret.refresh_token, "refresh-previous");
        assert_eq!(secret.account_id.as_deref(), Some("acct_test"));
        assert!(!secret.is_expiring(REFRESH_SKEW_SECONDS));
    }

    #[test]
    fn token_body_to_secret_uses_returned_refresh_token() {
        let access_token = fake_codex_access_token_with(3600, Some("acct_test"));
        let secret = token_body_to_secret(
            StatusCode::OK,
            &serde_json::json!({
                "access_token": access_token,
                "refresh_token": "refresh-new",
                "expires_in": 3600
            })
            .to_string(),
            Some("refresh-previous".into()),
        )
        .expect("token body should parse");

        assert_eq!(secret.refresh_token, "refresh-new");
    }

    #[test]
    fn token_body_to_secret_uses_expires_in_when_jwt_has_no_exp() {
        let secret = token_body_to_secret(
            StatusCode::OK,
            &serde_json::json!({
                "access_token": fake_codex_access_token_without_exp(Some("acct_test")),
                "refresh_token": "refresh-new",
                "expires_in": 3600
            })
            .to_string(),
            None,
        )
        .expect("token body should parse");

        assert!(secret.expires_at.is_some());
        assert!(!secret.is_expiring(REFRESH_SKEW_SECONDS));
    }

    #[test]
    fn token_error_message_classifies_reused_refresh_without_leaking_secret() {
        let message = token_error_message(
            StatusCode::BAD_REQUEST,
            r#"{"error":"refresh_token_reused","refresh_token":"secret-refresh"}"#,
            Some("secret-refresh"),
        );

        assert!(message.contains("already refreshed elsewhere"));
        assert!(!message.contains("secret-refresh"));
    }

    #[test]
    fn token_error_message_classifies_invalid_grant() {
        let message = token_error_message(
            StatusCode::BAD_REQUEST,
            r#"{"error":"invalid_grant"}"#,
            Some("secret-refresh"),
        );

        assert!(message.contains("session expired"));
        assert!(!message.contains("secret-refresh"));
    }

    #[tokio::test]
    async fn resolve_access_token_does_not_refresh_when_access_token_is_current() {
        let galley = test_galley().await;
        let api_key_ref = "managed-provider:codex-current";
        let access_token = fake_codex_access_token_with(3600, Some("acct_test"));
        save_test_secret(
            &galley,
            api_key_ref,
            CodexOAuthSecret::new(access_token.clone(), "refresh-current".into()).unwrap(),
        )
        .await;
        let calls = Arc::new(AtomicUsize::new(0));
        let refresh = {
            let calls = calls.clone();
            move |_secret: CodexOAuthSecret| {
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Err(GalleyError::Internal {
                        message: "refresh should not be called".into(),
                    })
                }
            }
        };

        let resolved = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh, false)
            .await
            .expect("current token should resolve");

        assert_eq!(resolved.access_token, access_token);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn concurrent_resolve_access_token_refreshes_once() {
        let galley = test_galley().await;
        let api_key_ref = "managed-provider:codex-concurrent";
        save_test_secret(
            &galley,
            api_key_ref,
            CodexOAuthSecret::new(
                fake_codex_access_token_with(-60, Some("acct_test")),
                "refresh-old".into(),
            )
            .unwrap(),
        )
        .await;
        let calls = Arc::new(AtomicUsize::new(0));
        let refresh = {
            let calls = calls.clone();
            move |_secret: CodexOAuthSecret| {
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    CodexOAuthSecret::new(
                        fake_codex_access_token_with(3600, Some("acct_test")),
                        "refresh-new".into(),
                    )
                }
            }
        };

        let (left, right) = tokio::join!(
            resolve_access_token_with_refresh(&galley, api_key_ref, &refresh, false),
            resolve_access_token_with_refresh(&galley, api_key_ref, &refresh, false),
        );

        assert!(left.unwrap().access_token.contains('.'));
        assert!(right.unwrap().access_token.contains('.'));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let saved = read_codex_oauth_secret(&galley, api_key_ref).await.unwrap();
        assert_eq!(saved.refresh_token, "refresh-new");
    }

    #[tokio::test]
    async fn resolve_access_token_recovers_when_db_was_refreshed_after_failure() {
        let galley = test_galley().await;
        let api_key_ref = "managed-provider:codex-recover";
        save_test_secret(
            &galley,
            api_key_ref,
            CodexOAuthSecret::new(
                fake_codex_access_token_with(-60, Some("acct_test")),
                "refresh-old".into(),
            )
            .unwrap(),
        )
        .await;
        let refresh = {
            let galley = galley.clone();
            move |_secret: CodexOAuthSecret| {
                let galley = galley.clone();
                async move {
                    save_test_secret(
                        &galley,
                        api_key_ref,
                        CodexOAuthSecret::new(
                            fake_codex_access_token_with(3600, Some("acct_test")),
                            "refresh-new".into(),
                        )
                        .unwrap(),
                    )
                    .await;
                    Err(GalleyError::InvalidArgs {
                        message: "simulated stale refresh failure".into(),
                    })
                }
            }
        };

        let resolved = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh, false)
            .await
            .expect("latest DB token should be reused after failure");

        assert_eq!(resolved.account_id.as_deref(), Some("acct_test"));
        let saved = read_codex_oauth_secret(&galley, api_key_ref).await.unwrap();
        assert_eq!(saved.refresh_token, "refresh-new");
    }

    #[tokio::test]
    async fn resolve_access_token_does_not_recover_db_refresh_from_different_account() {
        let galley = test_galley().await;
        let api_key_ref = "managed-provider:codex-recover-mismatch";
        save_test_secret(
            &galley,
            api_key_ref,
            CodexOAuthSecret::new(
                fake_codex_access_token_with(-60, Some("acct_a")),
                "refresh-old".into(),
            )
            .unwrap(),
        )
        .await;
        let refresh = {
            let galley = galley.clone();
            move |_secret: CodexOAuthSecret| {
                let galley = galley.clone();
                async move {
                    save_test_secret(
                        &galley,
                        api_key_ref,
                        CodexOAuthSecret::new(
                            fake_codex_access_token_with(3600, Some("acct_b")),
                            "refresh-other-account".into(),
                        )
                        .unwrap(),
                    )
                    .await;
                    Err(GalleyError::InvalidArgs {
                        message: "simulated refresh failure".into(),
                    })
                }
            }
        };

        let err = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh, false)
            .await
            .expect_err("different-account DB token must not be adopted");

        assert!(err.to_string().contains("simulated refresh failure"));
        let saved = read_codex_oauth_secret(&galley, api_key_ref).await.unwrap();
        assert_eq!(saved.account_id.as_deref(), Some("acct_b"));
    }

    #[tokio::test]
    async fn codex_cli_fallback_accepts_same_account_and_rejects_mismatch() {
        let temp = TempDir::new().unwrap();
        let previous = std::env::var_os("CODEX_HOME");
        std::env::set_var("CODEX_HOME", temp.path());
        let old = CodexOAuthSecret::new(
            fake_codex_access_token_with(-60, Some("acct_a")),
            "refresh-old".into(),
        )
        .unwrap();
        let refresh = |_secret: CodexOAuthSecret| async move {
            Err(GalleyError::Internal {
                message: "refresh should not be called".into(),
            })
        };

        write_cli_auth(
            temp.path(),
            fake_codex_access_token_with(3600, Some("acct_a")),
            "refresh-cli",
        );
        let accepted = recover_codex_cli_secret(&old, &refresh).await;
        assert!(accepted.is_some());

        write_cli_auth(
            temp.path(),
            fake_codex_access_token_with(3600, Some("acct_b")),
            "refresh-cli",
        );
        let rejected = recover_codex_cli_secret(&old, &refresh).await;
        assert!(rejected.is_none());

        if let Some(previous) = previous {
            std::env::set_var("CODEX_HOME", previous);
        } else {
            std::env::remove_var("CODEX_HOME");
        }
    }

    #[test]
    fn wham_usage_message_uses_exhausted_primary_reset() {
        let message = codex_usage_limit_message_from_wham(
            &serde_json::json!({
                "rate_limit": {
                    "limit_reached": true,
                    "primary_window": {
                        "used_percent": 100,
                        "reset_after_seconds": 3600
                    }
                }
            }),
            1_700_000_000,
        )
        .expect("quota reset should parse");

        assert!(message.contains("next reset in 1 hour"));
        assert!(message.contains("2023-11-14T23:13:20Z"));
    }

    #[test]
    fn wham_usage_message_uses_later_exhausted_window() {
        let message = codex_usage_limit_message_from_wham(
            &serde_json::json!({
                "rate_limit": {
                    "limit_reached": true,
                    "primary_window": {
                        "used_percent": 100,
                        "reset_after_seconds": 600
                    },
                    "secondary_window": {
                        "used_percent": 100,
                        "reset_after_seconds": 7200
                    }
                }
            }),
            1_700_000_000,
        )
        .expect("quota reset should parse");

        assert!(message.contains("next reset in 2 hours"));
    }

    #[test]
    fn wham_usage_message_handles_temporary_rate_limit() {
        let message = codex_usage_limit_message_from_wham(
            &serde_json::json!({
                "rate_limit": {
                    "limit_reached": false
                }
            }),
            1_700_000_000,
        )
        .expect("temporary limit message should parse");

        assert!(message.contains("temporarily"));
    }

    #[test]
    fn wham_usage_message_returns_none_when_reset_is_missing() {
        let message = codex_usage_limit_message_from_wham(
            &serde_json::json!({
                "rate_limit": {
                    "limit_reached": true,
                    "primary_window": {
                        "used_percent": 100
                    }
                }
            }),
            1_700_000_000,
        );

        assert!(message.is_none());
    }

    #[test]
    fn credential_ipc_rejects_api_key_request_for_codex_ref() {
        let mut allowlist = CredentialIpcAllowlist::new();
        allowlist.insert(
            "managed-provider:mp_chatgpt_codex".into(),
            ManagedModelAuthKind::ChatgptCodexOauth,
        );

        let err = validate_credential_ipc_request(
            CredentialIpcRequest {
                token: "expected".into(),
                api_key_ref: "managed-provider:mp_chatgpt_codex".into(),
                credential_kind: Some("api_key".into()),
            },
            "expected",
            &allowlist,
        )
        .expect_err("api_key must not be accepted for a Codex OAuth ref");

        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
        assert!(err.to_string().contains("credentialKind does not match"));
    }

    #[tokio::test]
    async fn credential_ipc_token_mismatch_returns_json_error() {
        let mut allowlist = CredentialIpcAllowlist::new();
        allowlist.insert(
            "managed-provider:mp_test".into(),
            ManagedModelAuthKind::ApiKey,
        );
        let (mut client, server) = tokio::io::duplex(1024);
        let task = tokio::spawn(handle_credential_ipc_stream(
            server,
            "expected".into(),
            Arc::new(RwLock::new(allowlist)),
        ));

        client
            .write_all(
                br#"{"token":"bad","apiKeyRef":"managed-provider:mp_test","credentialKind":"api_key"}"#,
            )
            .await
            .unwrap();
        client.write_all(b"\n").await.unwrap();
        let mut reader = BufReader::new(client);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();

        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["error"], "invalid_args");
        assert!(value["message"]
            .as_str()
            .unwrap()
            .contains("token mismatch"));
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn credential_ipc_disallowed_ref_returns_json_error() {
        let allowlist = CredentialIpcAllowlist::new();
        let (mut client, server) = tokio::io::duplex(1024);
        let task = tokio::spawn(handle_credential_ipc_stream(
            server,
            "expected".into(),
            Arc::new(RwLock::new(allowlist)),
        ));

        client
            .write_all(
                br#"{"token":"expected","apiKeyRef":"managed-provider:mp_test","credentialKind":"api_key"}"#,
            )
            .await
            .unwrap();
        client.write_all(b"\n").await.unwrap();
        let mut reader = BufReader::new(client);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();

        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["error"], "invalid_args");
        assert!(value["message"].as_str().unwrap().contains("not allowed"));
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn credential_ipc_codex_response_never_includes_refresh_token() {
        let galley = test_galley().await;
        let access_token = fake_codex_access_token();
        let secret = CodexOAuthSecret::new(access_token.clone(), "refresh-long-term".into())
            .expect("build test secret");
        let api_key_ref = "managed-provider:mp_chatgpt_codex";
        credential_store::set_secret(
            &galley,
            api_key_ref,
            &serde_json::to_string(&secret).unwrap(),
        )
        .await
        .unwrap();

        let response = fulfill_credential_ipc_request(
            &galley,
            api_key_ref.into(),
            CredentialKind::ChatgptCodexOauth,
        )
        .await
        .unwrap();
        let value = serde_json::to_value(response).unwrap();

        assert_eq!(value["accessToken"], access_token);
        assert!(value.get("refreshToken").is_none());
        assert!(value.get("apiKey").is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn credential_ipc_unix_socket_is_0600() {
        use std::os::unix::fs::PermissionsExt;

        let config = start_credential_ipc(CredentialIpcAllowlist::new())
            .await
            .expect("start credential ipc");
        let mode = std::fs::metadata(&config.address)
            .expect("socket metadata")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&config.address);
    }

    fn fake_codex_access_token() -> String {
        fake_codex_access_token_with(3600, Some("acct_test"))
    }

    fn fake_codex_access_token_with(exp_delta_seconds: i64, account_id: Option<&str>) -> String {
        let payload = serde_json::json!({
            "exp": Utc::now().timestamp() + exp_delta_seconds,
            "https://api.openai.com/auth": {
                "chatgpt_account_id": account_id.unwrap_or("acct_test")
            }
        });
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
        format!("header.{encoded}.sig")
    }

    fn fake_codex_access_token_without_exp(account_id: Option<&str>) -> String {
        let payload = serde_json::json!({
            "https://api.openai.com/auth": {
                "chatgpt_account_id": account_id.unwrap_or("acct_test")
            }
        });
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap());
        format!("header.{encoded}.sig")
    }

    async fn test_galley() -> SqliteGalley {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!(
            "../migrations/012_managed_model_local_secrets.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        SqliteGalley::from_pool(pool)
    }

    async fn save_test_secret(galley: &SqliteGalley, api_key_ref: &str, secret: CodexOAuthSecret) {
        credential_store::set_secret(
            galley,
            api_key_ref,
            &serde_json::to_string(&secret).unwrap(),
        )
        .await
        .unwrap();
    }

    fn write_cli_auth(codex_home: &std::path::Path, access_token: String, refresh_token: &str) {
        std::fs::write(
            codex_home.join("auth.json"),
            serde_json::json!({
                "tokens": {
                    "access_token": access_token,
                    "refresh_token": refresh_token
                }
            })
            .to_string(),
        )
        .unwrap();
    }
}
