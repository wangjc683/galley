//! Unit tests for the credential IPC listener. Hermetic: an in-memory
//! store and in-process duplex streams; the one real socket is the
//! listener's own Unix socket file.

use std::sync::{Arc, RwLock};

use chrono::Utc;
use serde_json::Value;
use sqlx::SqlitePool;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::api::ManagedModelAuthKind;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::GalleyError;

use super::{
    fulfill_credential_ipc_request, handle_credential_ipc_stream, validate_credential_ipc_request,
    CredentialIpcAllowlist, CredentialIpcRequest, CredentialKind,
};

const CHATGPT_REF: &str = "managed-provider:mp_chatgpt_codex";

#[test]
fn credential_ipc_rejects_api_key_request_for_a_chatgpt_ref() {
    let mut allowlist = CredentialIpcAllowlist::new();
    allowlist.insert(CHATGPT_REF.into(), ManagedModelAuthKind::ChatgptCodexOauth);

    let err = validate_credential_ipc_request(
        CredentialIpcRequest {
            token: "expected".into(),
            api_key_ref: CHATGPT_REF.into(),
            credential_kind: Some("api_key".into()),
        },
        "expected",
        &allowlist,
    )
    .expect_err("api_key must not be accepted for a ChatGPT ref");

    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    assert!(err.to_string().contains("credentialKind does not match"));
}

#[test]
fn credential_ipc_request_without_a_kind_asks_for_the_chatgpt_token() {
    // Managed GA's patch 0007 sends `{token, apiKeyRef}` only.
    let mut allowlist = CredentialIpcAllowlist::new();
    allowlist.insert(CHATGPT_REF.into(), ManagedModelAuthKind::ChatgptCodexOauth);
    let request: CredentialIpcRequest = serde_json::from_str(
        r#"{"token":"expected","apiKeyRef":"managed-provider:mp_chatgpt_codex"}"#,
    )
    .unwrap();

    let (api_key_ref, kind) =
        validate_credential_ipc_request(request, "expected", &allowlist).unwrap();

    assert_eq!(api_key_ref, CHATGPT_REF);
    assert_eq!(kind, CredentialKind::ChatgptPlan);
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
async fn credential_ipc_api_key_response_is_the_key_alone() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:mp_openai";
    credential_store::set_secret(&galley, api_key_ref, "sk-test")
        .await
        .unwrap();

    let response =
        fulfill_credential_ipc_request(&galley, api_key_ref.into(), CredentialKind::ApiKey)
            .await
            .unwrap();
    let value = serde_json::to_value(response).unwrap();

    assert_eq!(value, serde_json::json!({ "apiKey": "sk-test" }));
}

#[tokio::test]
async fn credential_ipc_returns_a_siwc_access_token_and_never_a_refresh_token() {
    let galley = test_galley().await;
    let expires_at = Utc::now().timestamp() + 3600;
    credential_store::set_secret(
        &galley,
        CHATGPT_REF,
        &serde_json::json!({
            "flow": "siwc",
            "clientId": "oaiapp_test",
            "accessToken": "access-current",
            "refreshToken": "refresh-long-term",
            "idToken": "id.token.value",
            "scopes": ["openid", "chatgpt.tokens.use.direct"],
            "expiresAt": expires_at,
        })
        .to_string(),
    )
    .await
    .unwrap();

    let response =
        fulfill_credential_ipc_request(&galley, CHATGPT_REF.into(), CredentialKind::ChatgptPlan)
            .await
            .unwrap();
    let value = serde_json::to_value(response).unwrap();

    // Exactly the token and its expiry: no refresh token, ID token or
    // account id (SIWC access tokens carry none).
    assert_eq!(
        value,
        serde_json::json!({ "accessToken": "access-current", "expiresAt": expires_at })
    );
}

#[tokio::test]
async fn credential_ipc_reports_sign_in_again_for_a_cleared_siwc_credential() {
    let galley = test_galley().await;
    credential_store::set_secret(
        &galley,
        CHATGPT_REF,
        &serde_json::json!({
            "flow": "siwc",
            "clientId": "oaiapp_test",
            "accessToken": "",
            "refreshToken": "",
            "lastRefreshError": "refresh_token_invalidated",
        })
        .to_string(),
    )
    .await
    .unwrap();

    let err =
        fulfill_credential_ipc_request(&galley, CHATGPT_REF.into(), CredentialKind::ChatgptPlan)
            .await
            .expect_err("a cleared SIWC credential must not resolve");

    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    assert!(err.to_string().contains("chatgpt_plan_reauth_required"));
}

#[tokio::test]
async fn credential_ipc_treats_a_codex_cli_credential_as_signed_out() {
    // A Codex CLI login credential (no `flow`) left over from before the
    // startup sweep: never refreshed, never returned.
    let galley = test_galley().await;
    let stored = serde_json::json!({
        "accessToken": "legacy-access",
        "refreshToken": "legacy-refresh",
        "expiresAt": Utc::now().timestamp() + 3600,
        "accountId": "acct_legacy",
    })
    .to_string();
    credential_store::set_secret(&galley, CHATGPT_REF, &stored)
        .await
        .unwrap();

    let err =
        fulfill_credential_ipc_request(&galley, CHATGPT_REF.into(), CredentialKind::ChatgptPlan)
            .await
            .expect_err("a Codex CLI credential must not resolve");

    assert!(err.to_string().contains("chatgpt_plan_reauth_required"));
    assert_eq!(
        credential_store::try_get_secret(&galley, CHATGPT_REF)
            .await
            .unwrap()
            .as_deref(),
        Some(stored.as_str()),
        "the IPC path only reads"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn credential_ipc_unix_socket_is_0600() {
    use std::os::unix::fs::PermissionsExt;

    let config = super::start_credential_ipc(CredentialIpcAllowlist::new())
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
