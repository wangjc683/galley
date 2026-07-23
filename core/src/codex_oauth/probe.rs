//! Connection probe against the Codex `responses` endpoint, used by the
//! sign-in flows and the managed-model "test connection" action.

use serde_json::Value;

use crate::api::ManagedModelConnectionResult;
use crate::error::{GalleyError, Result};

use super::secret::account_id_from_jwt;
use super::usage::fetch_codex_usage_limit_message;
use super::{
    compact_body, http_client, CODEX_API_BASE, CODEX_DEFAULT_REASONING, CODEX_PROBE_INSTRUCTIONS,
};

pub(super) async fn probe_with_access_token(
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

pub(super) fn codex_probe_payload(model: &str, reasoning_effort: &str) -> Value {
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

fn normalize_reasoning(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "none" => "none",
        "low" => "low",
        "high" => "high",
        "xhigh" => "xhigh",
        _ => CODEX_DEFAULT_REASONING,
    }
}
