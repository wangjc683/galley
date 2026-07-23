//! Unit tests for the codex_oauth module tree.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use reqwest::StatusCode;
use serde_json::Value;
use sqlx::SqlitePool;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::api::ManagedModelAuthKind;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::GalleyError;

use super::ipc::{
    fulfill_credential_ipc_request, handle_credential_ipc_stream, validate_credential_ipc_request,
    CredentialIpcRequest, CredentialKind,
};
use super::probe::codex_probe_payload;
use super::refresh::{
    read_codex_oauth_secret, recover_codex_cli_secret, resolve_access_token_with_refresh,
    token_body_to_secret, token_error_message,
};
use super::secret::{sync_rotated_tokens_to_codex_cli_at, CodexOAuthSecret};
use super::usage::codex_usage_limit_message_from_wham;
use super::{
    codex_default_advanced_options, start_credential_ipc, CredentialIpcAllowlist,
    CODEX_DEFAULT_REASONING, CODEX_PROBE_INSTRUCTIONS, REFRESH_SKEW_SECONDS,
};

#[test]
fn cli_sync_writes_rotated_tokens_when_lineage_matches() {
    let tmp = TempDir::new().expect("tempdir");
    let auth_path = tmp.path().join("auth.json");
    std::fs::write(
        &auth_path,
        r#"{"OPENAI_API_KEY":null,"tokens":{"id_token":"idt","access_token":"old-access","refresh_token":"consumed-rt","account_id":"acct-1"},"last_refresh":"2026-06-01T00:00:00.000Z"}"#,
    )
    .expect("seed auth.json");
    let refreshed = CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");

    sync_rotated_tokens_to_codex_cli_at(&auth_path, "consumed-rt", &refreshed);

    let file: Value = serde_json::from_str(&std::fs::read_to_string(&auth_path).unwrap()).unwrap();
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
    let refreshed = CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");

    // The CLI re-logged-in since our import: its refresh token is no
    // longer the one we consumed, so the file is not ours to change.
    sync_rotated_tokens_to_codex_cli_at(&auth_path, "consumed-rt", &refreshed);

    assert_eq!(std::fs::read_to_string(&auth_path).unwrap(), original);
}

#[test]
fn cli_sync_missing_auth_file_is_a_no_op() {
    let tmp = TempDir::new().expect("tempdir");
    let auth_path = tmp.path().join("auth.json");
    let refreshed = CodexOAuthSecret::new("new-access".into(), "new-rt".into()).expect("secret");
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
        "../../migrations/012_managed_model_local_secrets.sql"
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
