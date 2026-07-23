//! ChatGPT / Codex sign-in flows: the device-code login and the Codex
//! CLI credential import. Both end in `super::persist_probe_and_return`,
//! which persists the secret and upserts the provider + model records.

use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{GalleyError, Result};

use super::refresh::{refresh_secret_with_cli_sync, token_response_to_secret};
use super::secret::read_codex_cli_secret;
use super::{
    compact_body, http_client, nonempty, persist_probe_and_return, CodexAuthSetupResult,
    CODEX_AUTH_ISSUER, CODEX_DEVICE_URL, CODEX_OAUTH_CLIENT_ID, CODEX_OAUTH_TOKEN_URL,
    REFRESH_SKEW_SECONDS,
};

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

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    user_code: Option<String>,
    device_auth_id: Option<String>,
    interval: Option<Value>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct DevicePollResponse {
    authorization_code: Option<String>,
    code_verifier: Option<String>,
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
) -> Result<super::secret::CodexOAuthSecret> {
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

fn parse_interval(value: Option<Value>) -> Option<u64> {
    match value? {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    }
}
