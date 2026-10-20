//! The plan's model list (`GET /v1/models`) and the connection test
//! (`POST /v1/responses`) for Sign in with ChatGPT credentials.

use serde::Serialize;
use serde_json::Value;

use crate::api::{ManagedModelConnectionResult, ManagedModelListResult};
use crate::db::SqliteGalley;

use super::refresh::{clear_revoked_secret, resolve_access_token};
use super::{
    compact_body_redacted, error_code_from_body, http_client, provider_api_key_ref,
    ChatgptPlanError, PlanResult, SIWC_API_BASE, SIWC_PROBE_INSTRUCTIONS,
};

/// One model the user's plan offers (`visibility == "list"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanModel {
    pub slug: String,
    pub display_name: String,
    pub context_window: Option<i64>,
    pub supported_reasoning_levels: Vec<String>,
    pub default_reasoning_level: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanModelList {
    pub models: Vec<ChatgptPlanModel>,
    pub endpoint: String,
}

/// The plan's visible models for the ChatGPT provider's SIWC credential.
pub async fn list_models(
    galley: &SqliteGalley,
    provider_id: Option<String>,
) -> PlanResult<ChatgptPlanModelList> {
    let api_key_ref = provider_api_key_ref(galley, provider_id).await?;
    let token = resolve_access_token(galley, &api_key_ref).await?;
    let http = http_client()?;
    let models = fetch_visible_models(&http, &token.access_token).await;
    let models = clear_if_revoked(galley, &api_key_ref, &token.access_token, models).await?;
    Ok(ChatgptPlanModelList {
        models,
        endpoint: models_endpoint(),
    })
}

/// [`list_models`] in the generic model-picker shape (slugs only), for
/// `list_managed_model_options` on a SIWC provider.
pub async fn list_model_slugs(
    galley: &SqliteGalley,
    api_key_ref: &str,
) -> PlanResult<ManagedModelListResult> {
    let token = resolve_access_token(galley, api_key_ref).await?;
    let http = http_client()?;
    let models = fetch_visible_models(&http, &token.access_token).await;
    let models = clear_if_revoked(galley, api_key_ref, &token.access_token, models).await?;
    Ok(ManagedModelListResult {
        models: models.into_iter().map(|model| model.slug).collect(),
        endpoint: models_endpoint(),
    })
}

pub async fn test_connection(
    galley: &SqliteGalley,
    api_key_ref: &str,
    model: &str,
    reasoning_effort: &str,
) -> PlanResult<ManagedModelConnectionResult> {
    let token = resolve_access_token(galley, api_key_ref).await?;
    let http = http_client()?;
    let result = probe_with_access_token(&http, &token.access_token, model, reasoning_effort).await;
    clear_if_revoked(galley, api_key_ref, &token.access_token, result).await
}

/// After one of Core's own API calls: an access token the API reported
/// revoked takes the credential to "sign in again", as a dead refresh
/// does (live probe, 2026-10-20: a revoked grant's access token is
/// refused at once with 401 `token_revoked`).
pub(super) async fn clear_if_revoked<T>(
    galley: &SqliteGalley,
    api_key_ref: &str,
    access_token: &str,
    result: PlanResult<T>,
) -> PlanResult<T> {
    if let Err(ChatgptPlanError::ReauthRequired(_)) = &result {
        clear_revoked_secret(galley, api_key_ref, access_token, TOKEN_REVOKED_CODE).await?;
    }
    result
}

const TOKEN_REVOKED_CODE: &str = "token_revoked";

fn models_endpoint() -> String {
    format!("{SIWC_API_BASE}/models")
}

pub(super) async fn fetch_visible_models(
    http: &reqwest::Client,
    access_token: &str,
) -> PlanResult<Vec<ChatgptPlanModel>> {
    let resp = http
        .get(models_endpoint())
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            ChatgptPlanError::Temporary(format!("ChatGPT model list request failed: {e}"))
        })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| {
        ChatgptPlanError::Temporary(format!("reading the ChatGPT model list failed: {e}"))
    })?;
    if !status.is_success() {
        return Err(http_error(
            "ChatGPT model list",
            status,
            &body,
            access_token,
        ));
    }
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| ChatgptPlanError::Failed(format!("ChatGPT model list is not JSON: {e}")))?;
    Ok(visible_models_from_body(&json))
}

/// `{"models": [...]}` → the entries with `visibility == "list"`.
pub(super) fn visible_models_from_body(body: &Value) -> Vec<ChatgptPlanModel> {
    let Some(models) = body.get("models").and_then(Value::as_array) else {
        return Vec::new();
    };
    models
        .iter()
        .filter(|model| model.get("visibility").and_then(Value::as_str) == Some("list"))
        .filter_map(|model| {
            let slug = model
                .get("slug")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())?
                .to_string();
            let display_name = model
                .get("display_name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&slug)
                .to_string();
            let supported_reasoning_levels = model
                .get("supported_reasoning_levels")
                .and_then(Value::as_array)
                .map(|levels| {
                    levels
                        .iter()
                        .filter_map(|level| match level {
                            Value::String(effort) => Some(effort.clone()),
                            Value::Object(level) => level
                                .get("effort")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(ChatgptPlanModel {
                display_name,
                context_window: model.get("context_window").and_then(Value::as_i64),
                supported_reasoning_levels,
                default_reasoning_level: model
                    .get("default_reasoning_level")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                slug,
            })
        })
        .collect()
}

pub(super) async fn probe_with_access_token(
    http: &reqwest::Client,
    access_token: &str,
    model: &str,
    reasoning_effort: &str,
) -> PlanResult<ManagedModelConnectionResult> {
    let endpoint = format!("{SIWC_API_BASE}/responses");
    let resp = http
        .post(&endpoint)
        .bearer_auth(access_token)
        .header("Accept", "text/event-stream")
        .json(&probe_payload(model, reasoning_effort))
        .send()
        .await
        .map_err(|e| {
            ChatgptPlanError::Temporary(format!("testing the ChatGPT model failed: {e}"))
        })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| {
        ChatgptPlanError::Temporary(format!("reading the ChatGPT model test failed: {e}"))
    })?;
    if !status.is_success() {
        return Err(http_error(
            "ChatGPT model test",
            status,
            &body,
            access_token,
        ));
    }
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint,
        model_found: Some(true),
        message: "ChatGPT plan ready".into(),
    })
}

/// The Responses request of the connection test. `store: false` is
/// required for plan usage (probe: omitting it is a 400).
pub(super) fn probe_payload(model: &str, reasoning_effort: &str) -> Value {
    serde_json::json!({
        "model": model,
        "instructions": SIWC_PROBE_INSTRUCTIONS,
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

fn normalize_reasoning(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => "none",
        "low" => "low",
        "high" => "high",
        "xhigh" => "xhigh",
        _ => "medium",
    }
}

/// An error with the HTTP status and the API's error code up front, so
/// the GUI's status parsing and a later code-to-copy mapping both work.
pub(super) fn http_error(
    what: &str,
    status: reqwest::StatusCode,
    body: &str,
    access_token: &str,
) -> ChatgptPlanError {
    let error_code = error_code_from_body(body);
    if status.as_u16() == 401 && error_code.as_deref() == Some(TOKEN_REVOKED_CODE) {
        return ChatgptPlanError::ReauthRequired(format!(
            "ChatGPT access was revoked ({TOKEN_REVOKED_CODE}); sign in with ChatGPT again"
        ));
    }
    let code = error_code
        .map(|code| format!(" {code}"))
        .unwrap_or_default();
    let message = format!(
        "{what} failed (HTTP {}{code}: {})",
        status.as_u16(),
        compact_body_redacted(body, &[access_token])
    );
    if status.is_server_error() {
        ChatgptPlanError::Temporary(message)
    } else {
        ChatgptPlanError::Failed(message)
    }
}
