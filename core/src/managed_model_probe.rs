//! Lightweight provider probes for managed model setup.
//!
//! This is intentionally not a full inference call. The setup flow only needs
//! to verify that the endpoint and credential can talk to the provider, and
//! optionally offer model ids. A real first conversation still exercises the
//! runtime path in M5.
//!
//! The test payload deliberately carries one minimal tool definition in the
//! protocol's native shape (Anthropic `input_schema` vs OpenAI `function`).
//! Galley always runs as an agent, so every real request includes tools; a
//! gateway that accepts plain chat but mistranslates tool schemas would
//! otherwise pass a tool-free probe and only fail on the first real message.

use std::time::Duration;

use serde_json::Value;

use crate::api::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelListResult,
    ManagedModelProbeInput, ManagedModelProtocol,
};
use crate::codex_oauth;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

const PROBE_TIMEOUT_SECS: u64 = 20;

pub async fn list_models(input: ManagedModelProbeInput) -> Result<ManagedModelListResult> {
    if input.auth_kind == Some(ManagedModelAuthKind::ChatgptCodexOauth) {
        return Ok(ManagedModelListResult {
            models: vec![
                "gpt-5.5".into(),
                "gpt-5.4".into(),
                "gpt-5.4-mini".into(),
                "gpt-5.3-codex".into(),
                "gpt-5.1".into(),
            ],
            endpoint: format!("{}/responses", codex_oauth::CODEX_API_BASE),
        });
    }
    let secret = resolve_secret(&input).await?;
    let endpoint = models_endpoint(&input.api_base)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })?;
    let mut req = client.get(&endpoint);
    req = apply_auth_headers(req, input.protocol, &secret);
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("model list request failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading model list response failed: {e}"),
    })?;
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "无法获取模型列表，可手动添加（HTTP {}: {}）",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    let json: Value = serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
        message: format!("model list response is not JSON: {e}"),
    })?;
    let mut models = extract_model_ids(&json);
    models.sort();
    models.dedup();
    Ok(ManagedModelListResult { models, endpoint })
}

pub async fn test_connection(
    input: ManagedModelProbeInput,
) -> Result<ManagedModelConnectionResult> {
    let target_model = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    if let Some(model) = target_model {
        return test_model(input, model).await;
    }

    let listed = list_models(input).await?;
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint: listed.endpoint,
        model_found: None,
        message: "连接可用".into(),
    })
}

async fn test_model(
    input: ManagedModelProbeInput,
    model: String,
) -> Result<ManagedModelConnectionResult> {
    if input.auth_kind == Some(ManagedModelAuthKind::ChatgptCodexOauth) {
        let api_key_ref = resolve_api_key_ref(&input).await?;
        let reasoning = input
            .advanced_options
            .as_ref()
            .and_then(|value| value.get("reasoning_effort"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(codex_oauth::CODEX_DEFAULT_REASONING);
        return codex_oauth::test_codex_connection(&api_key_ref, &model, reasoning).await;
    }
    let secret = resolve_secret(&input).await?;
    let endpoint = inference_endpoint(&input.api_base, input.protocol)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })?;
    let payload = probe_payload(input.protocol, &model);
    let mut req = client.post(&endpoint).json(&payload);
    req = apply_auth_headers(req, input.protocol, &secret);
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("model test request failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading model test response failed: {e}"),
    })?;
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "模型测试失败（HTTP {}: {}）",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint,
        model_found: Some(true),
        message: "模型可用".into(),
    })
}

async fn resolve_secret(input: &ManagedModelProbeInput) -> Result<String> {
    if let Some(secret) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(secret.to_string());
    }
    if input.auth_kind == Some(ManagedModelAuthKind::None) {
        // No-auth endpoint: probe with an empty credential (the auth
        // header still goes out, mirroring the GA engine's behavior).
        return Ok(String::new());
    }
    let has_id = input
        .provider_id
        .as_deref()
        .or(input.id.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    if !has_id {
        return Err(GalleyError::InvalidArgs {
            message: "API key is required before testing this provider".into(),
        });
    }
    let galley = SqliteGalley::open().await?;
    let api_key_ref = resolve_api_key_ref(input).await?;
    credential_store::get_secret(&galley, &api_key_ref).await
}

async fn resolve_api_key_ref(input: &ManagedModelProbeInput) -> Result<String> {
    let id = input
        .provider_id
        .as_deref()
        .or(input.id.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: "managed provider id is required before testing this provider".into(),
        })?;
    let galley = SqliteGalley::open().await?;
    galley
        .list_managed_model_providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == id)
        .map(|provider| provider.api_key_ref)
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: format!("managed provider {id} not found"),
        })
}

fn apply_auth_headers(
    req: reqwest::RequestBuilder,
    protocol: ManagedModelProtocol,
    secret: &str,
) -> reqwest::RequestBuilder {
    match protocol {
        ManagedModelProtocol::Openai => req.bearer_auth(secret),
        ManagedModelProtocol::Anthropic => {
            let req = req
                .header("anthropic-version", "2023-06-01")
                .header(
                    "anthropic-beta",
                    "claude-code-20250219,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,prompt-caching-scope-2026-01-05",
                )
                .header("anthropic-dangerous-direct-browser-access", "true")
                .header("user-agent", "claude-cli/2.1.113 (external, cli)")
                .header("x-app", "cli");
            if secret.starts_with("sk-ant-") {
                req.header("x-api-key", secret)
            } else {
                req.bearer_auth(secret)
            }
        }
    }
}

fn models_endpoint(api_base: &str) -> Result<String> {
    provider_endpoint(api_base, "models")
}

fn inference_endpoint(api_base: &str, protocol: ManagedModelProtocol) -> Result<String> {
    match protocol {
        ManagedModelProtocol::Anthropic => {
            let endpoint = provider_endpoint(api_base, "messages")?;
            Ok(with_beta_query(&endpoint))
        }
        ManagedModelProtocol::Openai => provider_endpoint(api_base, "chat/completions"),
    }
}

fn provider_endpoint(api_base: &str, path: &str) -> Result<String> {
    let trimmed = api_base.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "Base URL is required".into(),
        });
    }
    if let Some(exact) = trimmed.strip_suffix('$') {
        return Ok(exact.trim_end_matches('/').to_string());
    }
    let target_suffix = format!("/{path}");
    if trimmed.ends_with(&target_suffix) {
        return Ok(trimmed.to_string());
    }
    let base = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/responses"))
        .or_else(|| trimmed.strip_suffix("/messages"))
        .or_else(|| trimmed.strip_suffix("/models"))
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    if has_version_segment(base) {
        Ok(format!("{base}/{path}"))
    } else {
        Ok(format!("{base}/v1/{path}"))
    }
}

fn has_version_segment(api_base: &str) -> bool {
    api_base.split('/').any(|segment| {
        segment.len() > 1
            && segment.starts_with('v')
            && segment[1..].chars().all(|c| c.is_ascii_digit())
    })
}

fn with_beta_query(endpoint: &str) -> String {
    if endpoint.contains('?') {
        format!("{endpoint}&beta=true")
    } else {
        format!("{endpoint}?beta=true")
    }
}

fn probe_payload(protocol: ManagedModelProtocol, model: &str) -> Value {
    match protocol {
        ManagedModelProtocol::Anthropic => serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "ping"
                        }
                    ]
                }
            ],
            "max_tokens": 1,
            "stream": false,
            "tools": [
                {
                    "name": "ping",
                    "description": "Connectivity probe tool. Never invoked.",
                    "input_schema": {
                        "type": "object",
                        "properties": {}
                    }
                }
            ]
        }),
        ManagedModelProtocol::Openai => {
            let lower_model = model.to_ascii_lowercase();
            let token_key = if ["gpt-5", "o1", "o2", "o3", "o4"]
                .iter()
                .any(|prefix| lower_model.starts_with(prefix))
            {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            let mut payload = serde_json::json!({
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": "ping"
                    }
                ],
                "stream": false,
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "ping",
                            "description": "Connectivity probe tool. Never invoked.",
                            "parameters": {
                                "type": "object",
                                "properties": {}
                            }
                        }
                    }
                ]
            });
            payload[token_key] = serde_json::json!(1);
            payload
        }
    }
}

fn extract_model_ids(json: &Value) -> Vec<String> {
    let candidates = json
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| json.get("models").and_then(Value::as_array));
    let Some(items) = candidates else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            item.get("id")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn compact_body(body: &str) -> String {
    let trimmed = body.trim().replace('\n', " ");
    if trimmed.chars().count() <= 240 {
        return trimmed;
    }
    let prefix: String = trimmed.chars().take(240).collect();
    format!("{prefix}...")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_endpoint_normalizes_common_provider_bases() {
        assert_eq!(
            models_endpoint("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/chat/completions").unwrap(),
            "https://relay.example/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/responses").unwrap(),
            "https://relay.example/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.anthropic.com/v1/models").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.anthropic.com").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.deepseek.com/anthropic").unwrap(),
            "https://api.deepseek.com/anthropic/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/messages").unwrap(),
            "https://relay.example/v1/models"
        );
    }

    #[test]
    fn inference_endpoint_matches_managed_runtime_url_rules() {
        assert_eq!(
            inference_endpoint("https://api.anthropic.com", ManagedModelProtocol::Anthropic)
                .unwrap(),
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint(
                "https://api.deepseek.com/anthropic",
                ManagedModelProtocol::Anthropic
            )
            .unwrap(),
            "https://api.deepseek.com/anthropic/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint(
                "https://relay.example/v1/messages",
                ManagedModelProtocol::Anthropic
            )
            .unwrap(),
            "https://relay.example/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint("https://openrouter.ai/api/v1", ManagedModelProtocol::Openai)
                .unwrap(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
    }

    #[test]
    fn probe_payload_carries_protocol_native_tool_schema() {
        // Anthropic tools must be {name, description, input_schema} — never the
        // OpenAI {type:function, function:{...}} shape, or an Anthropic-compatible
        // gateway fronting an OpenAI upstream rejects the request (issue #10).
        let anthropic = probe_payload(ManagedModelProtocol::Anthropic, "claude-x");
        let tool = &anthropic["tools"][0];
        assert!(tool.get("name").is_some());
        assert!(tool.get("input_schema").is_some());
        assert!(tool.get("function").is_none());

        // OpenAI tools must be {type:function, function:{name, parameters}}.
        let openai = probe_payload(ManagedModelProtocol::Openai, "gpt-4o");
        let tool = &openai["tools"][0];
        assert_eq!(tool["type"], "function");
        assert!(tool["function"].get("name").is_some());
        assert!(tool["function"].get("parameters").is_some());
        assert!(tool.get("input_schema").is_none());
    }

    #[test]
    fn extract_model_ids_handles_openai_and_anthropic_shapes() {
        let openai = serde_json::json!({
            "data": [{"id": "gpt-4.1"}, {"id": "gpt-4o"}]
        });
        assert_eq!(extract_model_ids(&openai), vec!["gpt-4.1", "gpt-4o"]);

        let fallback = serde_json::json!({
            "models": [{"name": "claude-sonnet-4-6"}]
        });
        assert_eq!(extract_model_ids(&fallback), vec!["claude-sonnet-4-6"]);
    }
}
