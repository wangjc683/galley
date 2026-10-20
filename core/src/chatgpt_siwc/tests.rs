//! Unit tests for the chatgpt_siwc module tree. Hermetic: the only
//! sockets are Galley's own loopback listener on 127.0.0.1.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{
    engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _,
};
use chrono::Utc;
use reqwest::StatusCode;
use ring::rand::SystemRandom;
use ring::signature::{RsaKeyPair, RsaPublicKeyComponents, RSA_PKCS1_SHA256};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

use crate::api::{
    ManagedModelAuthKind, ManagedModelCredentialStatus, ManagedModelProtocol, ManagedModelRecord,
};
use crate::credential_store;
use crate::db::{SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata};
use crate::error::GalleyError;

use super::callback::{
    bind_loopback, classify_request, redirect_uri_for_port, serve_callback, AuthorizedCallback,
    CallbackOutcome, RequestDisposition,
};
use super::id_token::{verify_id_token, Jwk, Jwks};
use super::login::{
    build_authorize_url, callback_from_outcome, cancel_login, complete_login, forget_stale_client,
    pkce_challenge, start_login, start_login_with_timeout, AuthorizeParams,
    CancelChatgptPlanLoginInput, CompleteChatgptPlanLoginInput, Pkce,
};
use super::logout::{logout, revoke_with_retry};
use super::probe::{clear_if_revoked, http_error, probe_payload, visible_models_from_body};
use super::refresh::{
    classify_token_error, read_secret, refresh_body_to_secret, resolve_access_token_with_refresh,
    save_secret, RefreshFailure,
};
use super::secret::{
    new_host_id, parse_timestamp, read_registration, save_registration, SiwcRegistration,
    SiwcSecret, TokenResponse,
};
use super::{
    galley_user_agent, is_siwc_secret, plan_model_upsert, plan_provider_display_name,
    retire_codex_cli_credentials, status_from_secret, ChatgptPlanError, ChatgptPlanProviderInput,
    LegacySweepOutcome, CHATGPT_MODEL_ID, CHATGPT_PROVIDER_ID, SIWC_API_BASE, SIWC_DEFAULT_MODEL,
    SIWC_ISSUER, TERMINAL_REFRESH_CODES,
};

// ---------------------------------------------------------------------
// Authorize URL, PKCE, host id
// ---------------------------------------------------------------------

fn query(url: &str) -> Vec<(String, String)> {
    reqwest::Url::parse(url)
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

fn param<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

fn registration(client: Option<(&str, &str)>) -> SiwcRegistration {
    SiwcRegistration {
        host_id: "urn:uuid:3f1c2a8e-5b7d-4c11-9a2e-0d6f4b8c1e27".into(),
        client_id: client.map(|(id, _)| id.to_string()),
        id_token: client.map(|(_, token)| token.to_string()),
        sub: None,
    }
}

#[test]
fn first_sign_in_registers_a_dynamic_client() {
    let params = AuthorizeParams::new(
        &registration(None),
        "http://127.0.0.1:51960/auth/callback",
        "state-1",
        "nonce-1",
        "challenge-1",
    );
    let url = build_authorize_url(&params);
    assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
    let pairs = query(&url);
    assert_eq!(param(&pairs, "client_id"), Some("dynamic_agent_client"));
    assert_eq!(param(&pairs, "agent_name_hint"), Some("Galley"));
    assert_eq!(param(&pairs, "id_token_hint"), None);
    assert_eq!(
        param(&pairs, "ext_agent_host_id"),
        Some("urn:uuid:3f1c2a8e-5b7d-4c11-9a2e-0d6f4b8c1e27")
    );
    assert_eq!(param(&pairs, "response_type"), Some("code"));
    assert_eq!(
        param(&pairs, "redirect_uri"),
        Some("http://127.0.0.1:51960/auth/callback")
    );
    assert_eq!(param(&pairs, "resource"), Some("https://api.openai.com/v1"));
    assert_eq!(
        param(&pairs, "scope"),
        Some("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct")
    );
    assert_eq!(param(&pairs, "state"), Some("state-1"));
    assert_eq!(param(&pairs, "nonce"), Some("nonce-1"));
    assert_eq!(param(&pairs, "code_challenge"), Some("challenge-1"));
    assert_eq!(param(&pairs, "code_challenge_method"), Some("S256"));
}

#[test]
fn re_login_reuses_the_saved_client_with_id_token_hint() {
    let params = AuthorizeParams::new(
        &registration(Some(("oaiapp_saved", "saved.id.token"))),
        "http://127.0.0.1:1/auth/callback",
        "s",
        "n",
        "c",
    );
    let pairs = query(&build_authorize_url(&params));
    assert_eq!(param(&pairs, "client_id"), Some("oaiapp_saved"));
    assert_eq!(param(&pairs, "id_token_hint"), Some("saved.id.token"));
    assert_eq!(param(&pairs, "agent_name_hint"), None);
    assert!(param(&pairs, "ext_agent_host_id").is_some());
}

#[test]
fn a_client_id_without_an_id_token_registers_again() {
    let mut reg = registration(None);
    reg.client_id = Some("oaiapp_half".into());
    let params = AuthorizeParams::new(&reg, "http://127.0.0.1:1/auth/callback", "s", "n", "c");
    let pairs = query(&build_authorize_url(&params));
    assert_eq!(param(&pairs, "client_id"), Some("dynamic_agent_client"));
    assert_eq!(param(&pairs, "id_token_hint"), None);
}

#[test]
fn pkce_challenge_is_s256_of_the_verifier() {
    // Expected value computed independently with
    // `printf %s <verifier> | openssl dgst -sha256 -binary | base64url`.
    assert_eq!(
        pkce_challenge("dBjftJeZ4CVP-mJ92K9IdT0hU4DNoS4kGHbkjPw7Fe0"),
        "wL4r2WvpGdYCuIpzEIaPIodMaaBipH9dGVzSuGu1a60"
    );
    let a = Pkce::generate().unwrap();
    let b = Pkce::generate().unwrap();
    assert_eq!(a.verifier.len(), 43);
    assert!(a
        .verifier
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    assert_eq!(a.challenge, pkce_challenge(&a.verifier));
    assert_ne!(a.verifier, b.verifier);
}

#[test]
fn host_id_is_a_v4_urn_uuid() {
    let id = new_host_id().unwrap();
    let uuid = id.strip_prefix("urn:uuid:").expect("urn:uuid: prefix");
    let groups: Vec<&str> = uuid.split('-').collect();
    assert_eq!(
        groups.iter().map(|g| g.len()).collect::<Vec<_>>(),
        vec![8, 4, 4, 4, 12]
    );
    assert!(groups[2].starts_with('4'));
    assert!(matches!(
        groups[3].chars().next(),
        Some('8' | '9' | 'a' | 'b')
    ));
    assert_ne!(id, new_host_id().unwrap());
}

#[test]
fn redirect_uri_is_loopback_ip_with_the_callback_path() {
    assert_eq!(
        redirect_uri_for_port(51960),
        "http://127.0.0.1:51960/auth/callback"
    );
}

// ---------------------------------------------------------------------
// Callback classification and the loopback listener
// ---------------------------------------------------------------------

fn head(target: &str) -> String {
    format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n")
}

#[test]
fn matching_callback_with_code_is_authorized() {
    let disposition = classify_request(
        &head("/auth/callback?client_id=oaiapp_x&code=the-code&scope=openid%20chatgpt.tokens.use.direct&state=st"),
        "st",
    );
    assert_eq!(
        disposition,
        RequestDisposition::Callback(CallbackOutcome::Authorized(AuthorizedCallback {
            code: "the-code".into(),
            client_id: Some("oaiapp_x".into()),
            scope: Some("openid chatgpt.tokens.use.direct".into()),
        }))
    );
}

#[test]
fn callback_with_wrong_or_missing_state_is_not_counted() {
    assert_eq!(
        classify_request(&head("/auth/callback?code=c&state=other"), "st"),
        RequestDisposition::StateMismatch
    );
    assert_eq!(
        classify_request(&head("/auth/callback?code=c"), "st"),
        RequestDisposition::StateMismatch
    );
    assert_eq!(
        classify_request(&head("/auth/callback?error=access_denied&state=s"), "st"),
        RequestDisposition::StateMismatch
    );
}

#[test]
fn access_denied_is_a_typed_error_once_state_matches() {
    let RequestDisposition::Callback(outcome) = classify_request(
        &head("/auth/callback?error=access_denied&error_description=User%20denied&state=st"),
        "st",
    ) else {
        panic!("matching access_denied must count as the callback");
    };
    let err = callback_from_outcome(outcome).unwrap_err();
    assert!(matches!(err, ChatgptPlanError::AccessDenied(_)));
    assert_eq!(err.code(), "chatgpt_plan_access_denied");
}

#[test]
fn other_paths_and_methods_are_not_found() {
    for request in [
        head("/"),
        head("/favicon.ico"),
        head("/auth/callback/extra?state=st&code=c"),
        head("/auth/callbacks?state=st&code=c"),
        "POST /auth/callback?state=st&code=c HTTP/1.1\r\n".to_string(),
        "HEAD /auth/callback?state=st&code=c HTTP/1.1\r\n".to_string(),
        "GET http://evil.test/auth/callback?state=st&code=c HTTP/1.1\r\n".to_string(),
        "garbage".to_string(),
    ] {
        assert_eq!(
            classify_request(&request, "st"),
            RequestDisposition::NotFound,
            "{request:?}"
        );
    }
}

#[test]
fn other_outcomes_map_to_typed_errors() {
    let timed_out = callback_from_outcome(CallbackOutcome::TimedOut).unwrap_err();
    assert_eq!(timed_out.code(), "chatgpt_plan_login_timed_out");
    let cancelled = callback_from_outcome(CallbackOutcome::Cancelled).unwrap_err();
    assert_eq!(cancelled.code(), "chatgpt_plan_login_cancelled");
    let other = callback_from_outcome(CallbackOutcome::Denied {
        error: "server_error".into(),
        description: None,
    })
    .unwrap_err();
    assert_eq!(other.code(), "chatgpt_plan_failed");
    assert!(other.message().contains("server_error"));
}

async fn http_get(port: u16, target: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
    stream
        .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes())
        .await?;
    let mut response = String::new();
    stream.read_to_string(&mut response).await?;
    Ok(response)
}

#[tokio::test]
async fn listener_accepts_one_matching_callback_then_closes() {
    let (listener, port) = bind_loopback().await.unwrap();
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let server = tokio::spawn(serve_callback(
        listener,
        "expected-state".into(),
        Duration::from_secs(30),
        cancel_rx,
    ));
    // A preconnect that never speaks must not block the real callback.
    let _idle = TcpStream::connect(("127.0.0.1", port)).await.unwrap();

    let not_found = http_get(port, "/favicon.ico").await.unwrap();
    assert!(not_found.starts_with("HTTP/1.1 404"), "{not_found}");
    let mismatch = http_get(port, "/auth/callback?code=c&state=wrong")
        .await
        .unwrap();
    assert!(mismatch.starts_with("HTTP/1.1 400"), "{mismatch}");

    let page = http_get(
        port,
        "/auth/callback?client_id=oaiapp_x&code=the-code&scope=openid&state=expected-state",
    )
    .await
    .unwrap();
    assert!(page.starts_with("HTTP/1.1 200"), "{page}");
    assert!(page.contains("可以回到 Galley 了"));
    assert!(page.contains("You can return to Galley"));
    assert!(page
        .to_ascii_lowercase()
        .contains("cache-control: no-store"));

    let outcome = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("listener returns after the matching callback")
        .unwrap();
    assert_eq!(
        outcome,
        CallbackOutcome::Authorized(AuthorizedCallback {
            code: "the-code".into(),
            client_id: Some("oaiapp_x".into()),
            scope: Some("openid".into()),
        })
    );
    assert!(
        http_get(port, "/auth/callback?code=again&state=expected-state")
            .await
            .is_err(),
        "the port must be closed after the one callback"
    );
}

#[tokio::test]
async fn listener_times_out_and_closes() {
    let (listener, port) = bind_loopback().await.unwrap();
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let outcome = serve_callback(
        listener,
        "state".into(),
        Duration::from_millis(50),
        cancel_rx,
    )
    .await;
    assert_eq!(outcome, CallbackOutcome::TimedOut);
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
}

#[tokio::test]
async fn listener_closes_when_its_sign_in_is_cancelled() {
    let (listener, port) = bind_loopback().await.unwrap();
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve_callback(
        listener,
        "state".into(),
        Duration::from_secs(30),
        cancel_rx,
    ));
    drop(cancel_tx);
    let outcome = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(outcome, CallbackOutcome::Cancelled);
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
}

/// Serializes the tests that touch the process-wide pending sign-in slot;
/// each of them leaves the slot empty.
fn pending_slot_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[tokio::test]
async fn pending_sign_in_lifecycle() {
    let _slot = pending_slot_lock().lock().await;
    let galley = test_galley().await;

    // Start: a dynamic registration, and the host id is persisted first.
    let first = start_login(&galley).await.unwrap();
    assert!(!format!("{first:?}").contains("auth.openai.com"));
    let first_pairs = query(&first.auth_url);
    assert_eq!(
        param(&first_pairs, "client_id"),
        Some("dynamic_agent_client")
    );
    let host_id = read_registration(&galley).await.unwrap().unwrap().host_id;
    assert_eq!(
        param(&first_pairs, "ext_agent_host_id"),
        Some(host_id.as_str())
    );
    assert!(chrono::DateTime::parse_from_rfc3339(&first.expires_at).is_ok());

    // A newer start cancels the older one; its waiter hears about it.
    let waiting = {
        let galley = galley.clone();
        let login_id = first.login_id.clone();
        tokio::spawn(async move {
            complete_login(&galley, CompleteChatgptPlanLoginInput { login_id }).await
        })
    };
    tokio::time::sleep(Duration::from_millis(30)).await;
    let second = start_login(&galley).await.unwrap();
    let err = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_login_cancelled");
    let second_pairs = query(&second.auth_url);
    assert_eq!(
        param(&second_pairs, "ext_agent_host_id"),
        Some(host_id.as_str()),
        "the host id is reused"
    );
    assert_ne!(param(&first_pairs, "state"), param(&second_pairs, "state"));
    let first_port = reqwest::Url::parse(param(&first_pairs, "redirect_uri").unwrap())
        .unwrap()
        .port()
        .unwrap();
    assert!(TcpStream::connect(("127.0.0.1", first_port)).await.is_err());

    // The user declines: the callback ends the sign-in with a typed
    // error, no token request is made.
    let waiting = {
        let galley = galley.clone();
        let login_id = second.login_id.clone();
        tokio::spawn(async move {
            complete_login(&galley, CompleteChatgptPlanLoginInput { login_id }).await
        })
    };
    let redirect = reqwest::Url::parse(param(&second_pairs, "redirect_uri").unwrap()).unwrap();
    let state = param(&second_pairs, "state").unwrap();
    let page = http_get(
        redirect.port().unwrap(),
        &format!("/auth/callback?error=access_denied&state={state}"),
    )
    .await
    .unwrap();
    assert!(page.starts_with("HTTP/1.1 200"));
    let err = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_access_denied");

    // Completed sign-ins and unknown ids are gone.
    let err = complete_login(
        &galley,
        CompleteChatgptPlanLoginInput {
            login_id: second.login_id.clone(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_login_not_found");

    // The cancel command closes a pending listener.
    let third = start_login(&galley).await.unwrap();
    let third_port = reqwest::Url::parse(param(&query(&third.auth_url), "redirect_uri").unwrap())
        .unwrap()
        .port()
        .unwrap();
    cancel_login(
        &galley,
        CancelChatgptPlanLoginInput {
            login_id: Some("someone-else".into()),
        },
    )
    .await;
    assert!(TcpStream::connect(("127.0.0.1", third_port)).await.is_ok());
    cancel_login(
        &galley,
        CancelChatgptPlanLoginInput {
            login_id: Some(third.login_id.clone()),
        },
    )
    .await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(TcpStream::connect(("127.0.0.1", third_port)).await.is_err());
}

// A saved client that ChatGPT no longer accepts (Galley disconnected in
// ChatGPT settings) never gets a callback: the authorize page errors and
// does not redirect. A saved-registration sign-in that times out or is
// cancelled therefore forgets the client, keeping the host id.

async fn galley_with_saved_client(client_id: &str) -> (SqliteGalley, String) {
    let galley = test_galley().await;
    let host_id = new_host_id().unwrap();
    save_registration(
        &galley,
        &SiwcRegistration {
            host_id: host_id.clone(),
            client_id: Some(client_id.into()),
            id_token: Some("saved.id.token".into()),
            sub: Some("user-sub-1".into()),
        },
    )
    .await
    .unwrap();
    (galley, host_id)
}

fn assert_fresh_registration_url(url: &str, host_id: &str) {
    let pairs = query(url);
    assert_eq!(param(&pairs, "client_id"), Some("dynamic_agent_client"));
    assert_eq!(param(&pairs, "agent_name_hint"), Some("Galley"));
    assert_eq!(param(&pairs, "id_token_hint"), None);
    assert_eq!(param(&pairs, "ext_agent_host_id"), Some(host_id));
}

async fn assert_client_forgotten(galley: &SqliteGalley, host_id: &str) {
    let registration = read_registration(galley).await.unwrap().unwrap();
    assert_eq!(registration.client_id, None);
    assert_eq!(registration.id_token, None);
    assert_eq!(registration.host_id, host_id, "the host id is kept");
}

async fn cancel_any(galley: &SqliteGalley) {
    cancel_login(galley, CancelChatgptPlanLoginInput { login_id: None }).await;
}

#[tokio::test]
async fn saved_client_sign_in_that_times_out_forgets_the_client() {
    let _slot = pending_slot_lock().lock().await;
    let (galley, host_id) = galley_with_saved_client("oaiapp_stale_timeout").await;

    let start = start_login_with_timeout(&galley, Duration::from_millis(100))
        .await
        .unwrap();
    let pairs = query(&start.auth_url);
    assert_eq!(param(&pairs, "client_id"), Some("oaiapp_stale_timeout"));
    assert_eq!(param(&pairs, "id_token_hint"), Some("saved.id.token"));

    let err = complete_login(
        &galley,
        CompleteChatgptPlanLoginInput {
            login_id: start.login_id.clone(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_login_timed_out");
    assert_client_forgotten(&galley, &host_id).await;

    let next = start_login(&galley).await.unwrap();
    assert_fresh_registration_url(&next.auth_url, &host_id);
    cancel_any(&galley).await;
}

#[tokio::test]
async fn saved_client_sign_in_that_is_cancelled_forgets_the_client() {
    let _slot = pending_slot_lock().lock().await;

    // The cancel command.
    let (galley, host_id) = galley_with_saved_client("oaiapp_stale_cancel").await;
    let start = start_login(&galley).await.unwrap();
    assert_eq!(
        param(&query(&start.auth_url), "client_id"),
        Some("oaiapp_stale_cancel")
    );
    cancel_login(
        &galley,
        CancelChatgptPlanLoginInput {
            login_id: Some(start.login_id.clone()),
        },
    )
    .await;
    assert_client_forgotten(&galley, &host_id).await;
    let next = start_login(&galley).await.unwrap();
    assert_fresh_registration_url(&next.auth_url, &host_id);
    cancel_any(&galley).await;

    // A newer sign-in replacing the pending one: the newer one already
    // registers afresh.
    let (galley, host_id) = galley_with_saved_client("oaiapp_stale_replaced").await;
    let first = start_login(&galley).await.unwrap();
    assert_eq!(
        param(&query(&first.auth_url), "client_id"),
        Some("oaiapp_stale_replaced")
    );
    let second = start_login(&galley).await.unwrap();
    assert_fresh_registration_url(&second.auth_url, &host_id);
    assert_client_forgotten(&galley, &host_id).await;
    cancel_any(&galley).await;
}

#[tokio::test]
async fn access_denied_keeps_the_saved_client() {
    let _slot = pending_slot_lock().lock().await;
    let (galley, host_id) = galley_with_saved_client("oaiapp_declined").await;
    let start = start_login(&galley).await.unwrap();
    let pairs = query(&start.auth_url);
    let waiting = {
        let galley = galley.clone();
        let login_id = start.login_id.clone();
        tokio::spawn(async move {
            complete_login(&galley, CompleteChatgptPlanLoginInput { login_id }).await
        })
    };
    let port = reqwest::Url::parse(param(&pairs, "redirect_uri").unwrap())
        .unwrap()
        .port()
        .unwrap();
    let state = param(&pairs, "state").unwrap();
    http_get(
        port,
        &format!("/auth/callback?error=access_denied&state={state}"),
    )
    .await
    .unwrap();
    let err = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_access_denied");

    let registration = read_registration(&galley).await.unwrap().unwrap();
    assert_eq!(registration.client_id.as_deref(), Some("oaiapp_declined"));
    assert_eq!(registration.id_token.as_deref(), Some("saved.id.token"));
    assert_eq!(registration.host_id, host_id);
    let next = start_login(&galley).await.unwrap();
    assert_eq!(
        param(&query(&next.auth_url), "client_id"),
        Some("oaiapp_declined")
    );

    // A declined sign-in whose result nobody collected is not "stale"
    // either when a newer one replaces it.
    let next_pairs = query(&next.auth_url);
    let port = reqwest::Url::parse(param(&next_pairs, "redirect_uri").unwrap())
        .unwrap()
        .port()
        .unwrap();
    let state = param(&next_pairs, "state").unwrap();
    http_get(
        port,
        &format!("/auth/callback?error=access_denied&state={state}"),
    )
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let replacing = start_login(&galley).await.unwrap();
    assert_eq!(
        param(&query(&replacing.auth_url), "client_id"),
        Some("oaiapp_declined")
    );
    cancel_any(&galley).await;
}

#[tokio::test]
async fn first_registration_timeout_leaves_the_registration_alone() {
    let _slot = pending_slot_lock().lock().await;
    let galley = test_galley().await;
    let start = start_login_with_timeout(&galley, Duration::from_millis(200))
        .await
        .unwrap();
    assert_eq!(
        param(&query(&start.auth_url), "client_id"),
        Some("dynamic_agent_client")
    );
    // Meanwhile a client gets saved (e.g. by a sign-in on the same store).
    let mut registration = read_registration(&galley).await.unwrap().unwrap();
    registration.client_id = Some("oaiapp_newer".into());
    registration.id_token = Some("newer.id.token".into());
    save_registration(&galley, &registration).await.unwrap();

    let err = complete_login(
        &galley,
        CompleteChatgptPlanLoginInput {
            login_id: start.login_id.clone(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_login_timed_out");
    let after = read_registration(&galley).await.unwrap().unwrap();
    assert_eq!(after.client_id.as_deref(), Some("oaiapp_newer"));
    assert_eq!(after.id_token.as_deref(), Some("newer.id.token"));
    cancel_any(&galley).await;
}

#[tokio::test]
async fn forgetting_a_stale_client_never_wipes_a_newer_one() {
    let (galley, host_id) = galley_with_saved_client("oaiapp_current").await;
    forget_stale_client(&galley, "oaiapp_old").await;
    let kept = read_registration(&galley).await.unwrap().unwrap();
    assert_eq!(kept.client_id.as_deref(), Some("oaiapp_current"));
    forget_stale_client(&galley, "oaiapp_current").await;
    assert_client_forgotten(&galley, &host_id).await;
}

// ---------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------

/// A 2048-bit RSA key made for these tests only (`openssl genpkey
/// -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -outform DER`).
const TEST_RSA_PKCS8_B64: &str = concat!(
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+RFErDK1GJddA+SZHJAoi8B2M",
    "RDUGsHQ7mjX16kayULpBvIE1JHh5cWR3Xyq6V7dS20VdGJ7DEYUljbbHR5nD1O2XkOk2gzFwPBRx",
    "dXSIWoqD5k5h1CnZ/j515bl8jkBUezHTaZKRyZtkoFkvPQAD0ykWLloaioLmli6qz9iZP/WvrREh",
    "a14Mdna+HtljcI0VUT4D7rTA0Z5XFhpAxZ8CcneiwnU0ZKuzxcu0/TNy4BBLs9miaorkgqUqNkDO",
    "j5IVveEGFK1fSZGCDRyfV9TNa2RoIkvqFN/0ok71BEMvQIBlvJJmLWT3KDz88QiJyk55qn4vQq86",
    "/iiqmAqs+fStAgMBAAECggEAAVLVVups9cBDcCxeuhj2++MJH/wre3ZUk90qdrr5+4YsClM6E0YQ",
    "YBV/Wh5uqPXKP/vOTp777Ix3JvM5uPoqoirQuk19dqEdm21d93B81PDLgBTLXJfbikYszHVcJhDE",
    "dsuVzAwy3LiQnN5J47yI/v3QwXQ+5GqS2leW6VF7BsBHK3mtug1tLdKG5Jb5wbMcaEtV7vKwy/Bo",
    "Hh+nNxfaEx00kdcifuIxApmRcx7Wiw25m3F4/OPpgG4J1vg3562i0q0mlthEx+Mbbo/Atkcx9/zP",
    "5+0g4U1R62DYZa0SQeU3uX8oO5qr2yZxm8uVWw8KMemBlCCb2Fxuz5XqNjLcGwKBgQDw3/n7qXNc",
    "vkwY/rnOZ1Hkq+f4zkyX7rES9twDrM7hJeNMki7+GSR7y22focrHP4m5a4hR+FvXJ1kZ9TKkfnkY",
    "pGNrsv1DkPrWhGPUZhHvkUNYp0YfTexmM4anyz8+47P5aqxoc9zgzHl6Xr2lqRiVeKM3cGse4Rnp",
    "6jxkquMCVwKBgQDKNtMlV6atqqVGmnbC17Hi3R4fXyw5GuYrgZkTocu/LBUoV//ulss5g7skOFIc",
    "+UsTHgFl4ZepuF3lKL19fKZkmmpsyrhjfEZ3HrAJCN2JmoDwcQw8w81FiIajOHFxXL7ijsFAtceV",
    "Dn59+j1L8ZlEHwNoMZGrUkRk7MKiS2KGmwKBgQCYwOFOSGqhYQjvPPLmQz16782fSmzmWPewmB50",
    "si1MOPPJhlcIyzcIzrxJZJgs/U1A6kG8Ae10Jz7pKEcibBYtm2p1TUAxjgqU6cZJVyV+sLdtzD66",
    "8Xa+ZWS6mjkUj+B9hrmpT/i+Es3i3ZwVJ4Qwnh2btc4o+gWuAt6j1H875wKBgFUcPkK5Ya425NmS",
    "qenYX0bdSpBpvnNKnxYwtf1NXDRamY0hfNcvINpUV7AnBGithKvHNU9sZClLMDoDq73leSNe2uxv",
    "Zqx44i/A+tbSpGwGW77X1g69WuipTgHk/9p27uDstOpHmHlkYFkluib8yUWiyAxS0L0LIz5XaJRm",
    "plGBAoGBAKU6YA54gwBBxUk/mBrYa68NRNoz+/QTBPJO189UHEqr3ZWR63rS4FtgiGiH/wxKsLQD",
    "oHX+bVj1PGQqiaMqcru5pPXkzoTpXxT8SI2Ou9xIPOh2uvrx9DW4QZhvt/Buh//NhtluaziFIWqx",
    "ty0SCumJByCQoE7zURea+/NYyq+4",
);

const TEST_KID: &str = "test-kid-1";
const TEST_CLIENT: &str = "oaiapp_test_client";
const TEST_NONCE: &str = "nonce-abc";

fn test_key() -> RsaKeyPair {
    let der = STANDARD.decode(TEST_RSA_PKCS8_B64).unwrap();
    RsaKeyPair::from_pkcs8(&der).expect("test RSA key parses")
}

fn test_jwks(key: &RsaKeyPair) -> Jwks {
    let public: RsaPublicKeyComponents<Vec<u8>> = key.public().into();
    Jwks {
        keys: vec![Jwk {
            kid: Some(TEST_KID.into()),
            kty: Some("RSA".into()),
            n: Some(URL_SAFE_NO_PAD.encode(&public.n)),
            e: Some(URL_SAFE_NO_PAD.encode(&public.e)),
        }],
    }
}

fn sign_jwt(key: &RsaKeyPair, header: &Value, claims: &Value) -> String {
    let signing_input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(header).unwrap()),
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap())
    );
    let mut signature = vec![0_u8; key.public().modulus_len()];
    key.sign(
        &RSA_PKCS1_SHA256,
        &SystemRandom::new(),
        signing_input.as_bytes(),
        &mut signature,
    )
    .unwrap();
    format!("{signing_input}.{}", URL_SAFE_NO_PAD.encode(signature))
}

fn rs256_header() -> Value {
    json!({ "alg": "RS256", "kid": TEST_KID, "typ": "JWT" })
}

fn good_claims(now: i64) -> Value {
    json!({
        "iss": SIWC_ISSUER,
        "aud": TEST_CLIENT,
        "sub": "user-sub-1",
        "exp": now + 3600,
        "iat": now,
        "nonce": TEST_NONCE,
    })
}

#[test]
fn id_token_with_valid_signature_and_claims_verifies() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let token = sign_jwt(&key, &rs256_header(), &good_claims(now));
    let claims = verify_id_token(&token, &test_jwks(&key), TEST_CLIENT, TEST_NONCE, now)
        .expect("valid ID token");
    assert_eq!(claims.sub, "user-sub-1");

    let mut array_aud = good_claims(now);
    array_aud["aud"] = json!([TEST_CLIENT, "https://api.openai.com/v1"]);
    array_aud["azp"] = json!(TEST_CLIENT);
    let token = sign_jwt(&key, &rs256_header(), &array_aud);
    assert!(verify_id_token(&token, &test_jwks(&key), TEST_CLIENT, TEST_NONCE, now).is_ok());
}

#[test]
fn id_token_with_a_bad_signature_is_rejected() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let token = sign_jwt(&key, &rs256_header(), &good_claims(now));
    // Swap in a payload the signature was not made over.
    let mut parts: Vec<String> = token.split('.').map(ToOwned::to_owned).collect();
    let mut tampered = good_claims(now);
    tampered["sub"] = json!("someone-else");
    parts[1] = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&tampered).unwrap());
    let err = verify_id_token(
        &parts.join("."),
        &test_jwks(&key),
        TEST_CLIENT,
        TEST_NONCE,
        now,
    )
    .unwrap_err();
    assert!(err.contains("signature"), "{err}");
    // A corrupted signature fails too.
    let mut sig = URL_SAFE_NO_PAD
        .decode(token.rsplit('.').next().unwrap())
        .unwrap();
    sig[10] ^= 0xff;
    let (signing_input, _) = token.rsplit_once('.').unwrap();
    let corrupted = format!("{signing_input}.{}", URL_SAFE_NO_PAD.encode(sig));
    assert!(verify_id_token(&corrupted, &test_jwks(&key), TEST_CLIENT, TEST_NONCE, now).is_err());
}

#[test]
fn id_token_for_another_audience_is_rejected() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let token = sign_jwt(&key, &rs256_header(), &good_claims(now));
    let err =
        verify_id_token(&token, &test_jwks(&key), "oaiapp_other", TEST_NONCE, now).unwrap_err();
    assert!(err.contains("audience"), "{err}");

    let mut wrong_azp = good_claims(now);
    wrong_azp["aud"] = json!([TEST_CLIENT, "x"]);
    wrong_azp["azp"] = json!("x");
    let token = sign_jwt(&key, &rs256_header(), &wrong_azp);
    assert!(verify_id_token(&token, &test_jwks(&key), TEST_CLIENT, TEST_NONCE, now).is_err());
}

#[test]
fn id_token_with_the_wrong_nonce_is_rejected() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let token = sign_jwt(&key, &rs256_header(), &good_claims(now));
    let err =
        verify_id_token(&token, &test_jwks(&key), TEST_CLIENT, "nonce-other", now).unwrap_err();
    assert!(err.contains("nonce"), "{err}");
}

#[test]
fn expired_id_token_is_rejected() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let mut claims = good_claims(now);
    claims["exp"] = json!(now - 3600);
    let token = sign_jwt(&key, &rs256_header(), &claims);
    let err = verify_id_token(&token, &test_jwks(&key), TEST_CLIENT, TEST_NONCE, now).unwrap_err();
    assert!(err.contains("expired"), "{err}");
}

#[test]
fn id_token_from_another_issuer_alg_or_key_is_rejected() {
    let key = test_key();
    let now = Utc::now().timestamp();
    let jwks = test_jwks(&key);

    let mut other_issuer = good_claims(now);
    other_issuer["iss"] = json!("https://evil.test");
    let token = sign_jwt(&key, &rs256_header(), &other_issuer);
    assert!(verify_id_token(&token, &jwks, TEST_CLIENT, TEST_NONCE, now)
        .unwrap_err()
        .contains("issuer"));

    let none_alg = format!(
        "{}.{}.",
        URL_SAFE_NO_PAD.encode(br#"{"alg":"none","kid":"test-kid-1"}"#),
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&good_claims(now)).unwrap())
    );
    assert!(
        verify_id_token(&none_alg, &jwks, TEST_CLIENT, TEST_NONCE, now)
            .unwrap_err()
            .contains("RS256")
    );

    let unknown_kid = sign_jwt(
        &key,
        &json!({ "alg": "RS256", "kid": "rotated-away" }),
        &good_claims(now),
    );
    assert!(
        verify_id_token(&unknown_kid, &jwks, TEST_CLIENT, TEST_NONCE, now)
            .unwrap_err()
            .contains("key set")
    );
}

// ---------------------------------------------------------------------
// Credential model and serde compatibility
// ---------------------------------------------------------------------

fn token_response(value: Value) -> TokenResponse {
    serde_json::from_value(value).unwrap()
}

fn siwc_secret(access_token: &str, refresh_token: &str, expires_in: i64) -> SiwcSecret {
    let now = Utc::now().timestamp();
    SiwcSecret::from_sign_in(
        TEST_CLIENT.into(),
        &token_response(json!({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "scope": "openid offline_access chatgpt.tokens.use.direct",
        })),
        "id.token.value".into(),
        "user-sub-1".into(),
        vec![
            "openid".into(),
            "offline_access".into(),
            "chatgpt.tokens.use.direct".into(),
        ],
        now,
    )
    .unwrap()
}

#[test]
fn a_codex_cli_login_credential_is_no_credential() {
    let codex = codex_cli_credential();
    assert!(!is_siwc_secret(&codex));
    assert!(!is_siwc_secret("sk-plain-api-key"));
    assert!(!is_siwc_secret(r#"{"flow":"other"}"#));
    // The card reads "sign in", not "signed in" or "needs a new sign-in".
    let status = status_from_secret(Some(&codex), true);
    assert_eq!(status.flow, None);
    assert!(!status.signed_in);
    assert!(!status.needs_reauth);
    assert!(status.registered);
}

#[test]
fn siwc_credential_round_trips_with_its_flow_and_fields() {
    let secret = siwc_secret("access-1", "refresh-1", 3600);
    let raw = serde_json::to_string(&secret).unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["flow"], "siwc");
    for key in [
        "clientId",
        "accessToken",
        "refreshToken",
        "idToken",
        "scopes",
        "expiresAt",
        "earliestRefreshAt",
        "sub",
        "lastRefreshAt",
        "lastRefreshError",
    ] {
        assert!(value.get(key).is_some(), "missing {key}");
    }
    assert!(is_siwc_secret(&raw));
    let parsed: SiwcSecret = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.access_token, "access-1");
    assert_eq!(parsed.client_id, TEST_CLIENT);
}

#[test]
fn sign_in_secret_reads_expiry_and_earliest_refresh_at() {
    let now = 1_800_000_000;
    let secret = SiwcSecret::from_sign_in(
        TEST_CLIENT.into(),
        &token_response(json!({
            "access_token": "opaque-access",
            "refresh_token": "r",
            "expires_in": 3600,
            "earliest_refresh_at": now + 3240,
        })),
        "idt".into(),
        "sub".into(),
        vec![],
        now,
    )
    .unwrap();
    assert_eq!(secret.expires_at, Some(now + 3600));
    assert_eq!(secret.earliest_refresh_at, Some(now + 3240));
    assert!(!secret.is_expiring(120, now));
    assert!(secret.is_expiring(120, now + 3500));

    assert_eq!(parse_timestamp(&json!(3240), now), Some(now + 3240));
    assert_eq!(
        parse_timestamp(&json!((now + 5) * 1000), now),
        Some(now + 5)
    );
    assert_eq!(
        parse_timestamp(&json!("2027-01-15T08:00:00Z"), now),
        Some(
            chrono::DateTime::parse_from_rfc3339("2027-01-15T08:00:00Z")
                .unwrap()
                .timestamp()
        )
    );
    assert_eq!(parse_timestamp(&json!(now + 10), now), Some(now + 10));
    assert_eq!(parse_timestamp(&json!(null), now), None);
}

#[test]
fn debug_output_never_contains_tokens() {
    let secret = siwc_secret("access-SECRET", "refresh-SECRET", 3600);
    let printed = format!("{secret:?}");
    assert!(!printed.contains("SECRET"), "{printed}");
    let callback = AuthorizedCallback {
        code: "code-SECRET".into(),
        client_id: None,
        scope: None,
    };
    assert!(!format!("{callback:?}").contains("SECRET"));
}

#[test]
fn status_reports_flow_reauth_and_absence() {
    let absent = status_from_secret(None, true);
    assert_eq!(absent.flow, None);
    assert!(!absent.signed_in);
    assert!(absent.registered);

    let secret = siwc_secret("a", "r", 3600);
    let live = status_from_secret(Some(&serde_json::to_string(&secret).unwrap()), true);
    assert_eq!(live.flow, Some("siwc"));
    assert!(live.signed_in);
    assert!(!live.needs_reauth);
    assert!(live.scopes.iter().any(|s| s == "chatgpt.tokens.use.direct"));

    let cleared = secret.cleared("refresh_token_invalidated".into());
    let stale = status_from_secret(Some(&serde_json::to_string(&cleared).unwrap()), true);
    assert_eq!(stale.flow, Some("siwc"));
    assert!(!stale.signed_in);
    assert!(stale.needs_reauth);
    assert_eq!(
        stale.last_refresh_error.as_deref(),
        Some("refresh_token_invalidated")
    );
}

// ---------------------------------------------------------------------
// Refresh: rotation, classification, the gate
// ---------------------------------------------------------------------

#[test]
fn refresh_rotates_tokens_expiry_and_scopes() {
    let previous = siwc_secret("access-old", "refresh-old", 60);
    let now = Utc::now().timestamp();
    let next = refresh_body_to_secret(
        &previous,
        StatusCode::OK,
        &json!({
            "access_token": "access-new",
            "refresh_token": "refresh-new",
            "id_token": "id-new",
            "expires_in": 3600,
            "scope": "openid chatgpt.tokens.use.direct resource.invoke",
            "token_type": "Bearer",
            "earliest_refresh_at": now + 3240,
        })
        .to_string(),
        now,
    )
    .unwrap();
    assert_eq!(next.access_token, "access-new");
    assert_eq!(next.refresh_token, "refresh-new");
    assert_eq!(next.id_token, "id-new");
    assert_eq!(next.expires_at, Some(now + 3600));
    assert_eq!(
        next.scopes,
        vec!["openid", "chatgpt.tokens.use.direct", "resource.invoke"]
    );
    assert_eq!(next.client_id, previous.client_id);
    assert_eq!(next.sub, previous.sub);
    assert_eq!(next.flow, "siwc");
    assert!(next.last_refresh_error.is_none());
}

#[test]
fn refresh_keeps_what_the_response_omits() {
    let previous = siwc_secret("access-old", "refresh-old", 60);
    let next = refresh_body_to_secret(
        &previous,
        StatusCode::OK,
        &json!({ "access_token": "access-new", "expires_in": 3600 }).to_string(),
        Utc::now().timestamp(),
    )
    .unwrap();
    assert_eq!(next.refresh_token, "refresh-old");
    assert_eq!(next.scopes, previous.scopes);
    assert_eq!(next.id_token, previous.id_token);
}

#[test]
fn refresh_after_revoke_is_terminal_via_error_reason() {
    // Live probe, 2026-10-20: refreshing a revoked grant.
    let body = r#"{"error":"invalid_grant","error_reason":"refresh_token_invalidated","error_description":"The refresh token has been invalidated."}"#;
    let previous = siwc_secret("a", "refresh-SECRET", 60);
    let failure = refresh_body_to_secret(&previous, StatusCode::BAD_REQUEST, body, 0).unwrap_err();
    assert_eq!(
        failure,
        RefreshFailure::Terminal {
            code: "refresh_token_invalidated".into()
        }
    );
}

#[test]
fn every_terminal_code_is_terminal_in_either_field() {
    for code in TERMINAL_REFRESH_CODES {
        for body in [
            json!({ "error": code }),
            json!({ "error": "invalid_request", "error_reason": code }),
            json!({ "error": { "code": code, "message": "x" } }),
        ] {
            assert_eq!(
                classify_token_error(StatusCode::BAD_REQUEST, &body.to_string(), &[]),
                RefreshFailure::Terminal {
                    code: code.to_string()
                },
                "{body}"
            );
        }
    }
}

#[test]
fn server_errors_are_temporary_and_other_rejections_keep_credentials() {
    assert!(matches!(
        classify_token_error(StatusCode::SERVICE_UNAVAILABLE, "upstream down", &[]),
        RefreshFailure::Temporary { .. }
    ));
    assert!(matches!(
        classify_token_error(StatusCode::TOO_MANY_REQUESTS, "{}", &[]),
        RefreshFailure::Temporary { .. }
    ));
    let rejected = classify_token_error(
        StatusCode::BAD_REQUEST,
        r#"{"echo":"refresh-SECRET"}"#,
        &["refresh-SECRET"],
    );
    let RefreshFailure::Rejected { detail } = rejected else {
        panic!("a non-terminal 400 keeps the credential");
    };
    assert!(detail.contains("HTTP 400"));
    assert!(!detail.contains("refresh-SECRET"), "{detail}");
}

#[tokio::test]
async fn resolve_returns_a_current_token_without_refreshing() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:siwc-current";
    save_secret(&galley, api_key_ref, &siwc_secret("access-now", "r", 3600))
        .await
        .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let refresh = {
        let calls = calls.clone();
        move |_secret: SiwcSecret| {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Err(RefreshFailure::Rejected {
                    detail: "must not be called".into(),
                })
            }
        }
    };
    let resolved = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh)
        .await
        .unwrap();
    assert_eq!(resolved.access_token, "access-now");
    assert!(resolved.expires_at.is_some());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn concurrent_resolves_refresh_once_and_save_the_rotation() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:siwc-concurrent";
    save_secret(
        &galley,
        api_key_ref,
        &siwc_secret("access-old", "refresh-old", 30),
    )
    .await
    .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let seen_refresh_tokens = Arc::new(Mutex::new(Vec::new()));
    let refresh = {
        let calls = calls.clone();
        let seen = seen_refresh_tokens.clone();
        move |secret: SiwcSecret| {
            let calls = calls.clone();
            let seen = seen.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                seen.lock().unwrap().push(secret.refresh_token.clone());
                tokio::time::sleep(Duration::from_millis(50)).await;
                Ok(secret
                    .refreshed(
                        &token_response(json!({
                            "access_token": "access-new",
                            "refresh_token": "refresh-new",
                            "expires_in": 3600,
                        })),
                        Utc::now().timestamp(),
                    )
                    .unwrap())
            }
        }
    };
    let (left, right) = tokio::join!(
        resolve_access_token_with_refresh(&galley, api_key_ref, &refresh),
        resolve_access_token_with_refresh(&galley, api_key_ref, &refresh),
    );
    assert_eq!(left.unwrap().access_token, "access-new");
    assert_eq!(right.unwrap().access_token, "access-new");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(*seen_refresh_tokens.lock().unwrap(), vec!["refresh-old"]);
    let saved = read_secret(&galley, api_key_ref).await.unwrap();
    assert_eq!(saved.refresh_token, "refresh-new");
}

#[tokio::test]
async fn terminal_refresh_clears_tokens_and_keeps_the_registration() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:siwc-terminal";
    save_secret(
        &galley,
        api_key_ref,
        &siwc_secret("access-old", "refresh-old", 30),
    )
    .await
    .unwrap();
    let registration = SiwcRegistration {
        host_id: new_host_id().unwrap(),
        client_id: Some(TEST_CLIENT.into()),
        id_token: Some("idt".into()),
        sub: Some("user-sub-1".into()),
    };
    save_registration(&galley, &registration).await.unwrap();
    let refresh = |_secret: SiwcSecret| async move {
        Err(RefreshFailure::Terminal {
            code: "refresh_token_expired".into(),
        })
    };

    let err = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_reauth_required");

    let raw = credential_store::get_secret(&galley, api_key_ref)
        .await
        .unwrap();
    assert!(is_siwc_secret(&raw), "the credential row stays, as SIWC");
    let cleared: SiwcSecret = serde_json::from_str(&raw).unwrap();
    assert!(cleared.access_token.is_empty());
    assert!(cleared.refresh_token.is_empty());
    assert!(cleared.id_token.is_empty());
    assert_eq!(cleared.client_id, TEST_CLIENT);
    assert_eq!(
        cleared.last_refresh_error.as_deref(),
        Some("refresh_token_expired")
    );
    let kept = read_registration(&galley).await.unwrap().unwrap();
    assert_eq!(kept.host_id, registration.host_id);
    assert_eq!(kept.client_id.as_deref(), Some(TEST_CLIENT));

    // From now on: "sign in again", without another refresh attempt.
    let calls = Arc::new(AtomicUsize::new(0));
    let counting = {
        let calls = calls.clone();
        move |_secret: SiwcSecret| {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Err(RefreshFailure::Rejected { detail: "x".into() })
            }
        }
    };
    let err = resolve_access_token_with_refresh(&galley, api_key_ref, &counting)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_reauth_required");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn temporary_refresh_failure_keeps_the_credential() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:siwc-temporary";
    save_secret(
        &galley,
        api_key_ref,
        &siwc_secret("access-old", "refresh-old", 30),
    )
    .await
    .unwrap();
    let refresh = |_secret: SiwcSecret| async move {
        Err(RefreshFailure::Temporary {
            detail: "HTTP 503".into(),
        })
    };
    let err = resolve_access_token_with_refresh(&galley, api_key_ref, &refresh)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_temporary");
    assert!(matches!(
        GalleyError::from(err),
        GalleyError::RunnerError { .. }
    ));
    let kept = read_secret(&galley, api_key_ref).await.unwrap();
    assert_eq!(kept.access_token, "access-old");
    assert_eq!(kept.refresh_token, "refresh-old");
    assert_eq!(kept.last_refresh_error.as_deref(), Some("HTTP 503"));
}

// ---------------------------------------------------------------------
// Model list, connection test, revoked access tokens
// ---------------------------------------------------------------------

#[test]
fn visible_models_are_filtered_and_mapped() {
    let models = visible_models_from_body(&json!({
        "models": [
            {
                "slug": "gpt-5.6-sol",
                "display_name": "GPT-5.6 Sol",
                "visibility": "list",
                "context_window": 272000,
                "supported_reasoning_levels": [
                    { "effort": "low", "description": "fast" },
                    { "effort": "medium", "description": "balanced" },
                    "high"
                ],
                "default_reasoning_level": "medium"
            },
            { "slug": "internal-model", "visibility": "hide" },
            { "slug": "gpt-6-luna", "visibility": "list" },
            { "display_name": "no slug", "visibility": "list" }
        ]
    }));
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].slug, "gpt-5.6-sol");
    assert_eq!(models[0].display_name, "GPT-5.6 Sol");
    assert_eq!(models[0].context_window, Some(272000));
    assert_eq!(
        models[0].supported_reasoning_levels,
        vec!["low", "medium", "high"]
    );
    assert_eq!(models[0].default_reasoning_level.as_deref(), Some("medium"));
    assert_eq!(models[1].slug, "gpt-6-luna");
    assert_eq!(models[1].display_name, "gpt-6-luna");
    let serialized = serde_json::to_value(&models[0]).unwrap();
    assert!(serialized.get("supportedReasoningLevels").is_some());
    assert!(serialized.get("contextWindow").is_some());
    assert!(visible_models_from_body(&json!({ "data": [] })).is_empty());
}

#[test]
fn probe_payload_is_a_stateless_streaming_responses_request() {
    let payload = probe_payload("gpt-5.6-sol", "surprise");
    assert_eq!(payload["model"], "gpt-5.6-sol");
    assert_eq!(payload["store"], false);
    assert_eq!(payload["stream"], true);
    assert!(payload["instructions"].as_str().is_some());
    assert_eq!(payload["input"][0]["role"], "user");
    assert_eq!(payload["reasoning"]["effort"], "medium");
    assert!(payload.get("max_output_tokens").is_none());
}

#[test]
fn api_errors_carry_status_and_code_and_revocation_needs_sign_in() {
    // Live probe, 2026-10-20: the access token of a revoked grant.
    let revoked = r#"{"error":{"message":"Encountered invalidated oauth token for user, failing request","type":null,"code":"token_revoked","param":null},"status":401}"#;
    let err = http_error(
        "ChatGPT model test",
        StatusCode::UNAUTHORIZED,
        revoked,
        "tok",
    );
    assert_eq!(err.code(), "chatgpt_plan_reauth_required");

    let limit =
        r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit"}}"#;
    let err = http_error(
        "ChatGPT model test",
        StatusCode::TOO_MANY_REQUESTS,
        limit,
        "tok",
    );
    assert_eq!(err.code(), "chatgpt_plan_failed");
    assert!(err
        .message()
        .contains("HTTP 429 subscription_sharing_usage_limit_exceeded"));

    let err = http_error(
        "ChatGPT model list",
        StatusCode::BAD_GATEWAY,
        "echo tok-SECRET",
        "tok-SECRET",
    );
    assert_eq!(err.code(), "chatgpt_plan_temporary");
    assert!(!err.message().contains("tok-SECRET"));
}

#[tokio::test]
async fn a_revoked_access_token_clears_only_the_credential_that_holds_it() {
    let galley = test_galley().await;
    let api_key_ref = "managed-provider:siwc-revoked";
    save_secret(
        &galley,
        api_key_ref,
        &siwc_secret("access-revoked", "r", 3600),
    )
    .await
    .unwrap();

    // A newer sign-in already replaced the token: nothing is cleared.
    let result: Result<(), ChatgptPlanError> =
        Err(ChatgptPlanError::ReauthRequired("revoked".into()));
    let _ = clear_if_revoked(&galley, api_key_ref, "access-older", result).await;
    assert!(read_secret(&galley, api_key_ref)
        .await
        .unwrap()
        .has_tokens());

    // Other failures leave the credential alone.
    let result: Result<(), ChatgptPlanError> = Err(ChatgptPlanError::Failed("HTTP 400".into()));
    let _ = clear_if_revoked(&galley, api_key_ref, "access-revoked", result).await;
    assert!(read_secret(&galley, api_key_ref)
        .await
        .unwrap()
        .has_tokens());

    let result: Result<(), ChatgptPlanError> =
        Err(ChatgptPlanError::ReauthRequired("revoked".into()));
    let err = clear_if_revoked(&galley, api_key_ref, "access-revoked", result)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "chatgpt_plan_reauth_required");
    let cleared = read_secret(&galley, api_key_ref).await.unwrap();
    assert!(!cleared.has_tokens());
    assert_eq!(cleared.last_refresh_error.as_deref(), Some("token_revoked"));
}

fn model_record(model: &str, display_name: &str) -> ManagedModelRecord {
    ManagedModelRecord {
        id: CHATGPT_MODEL_ID.into(),
        provider_id: CHATGPT_PROVIDER_ID.into(),
        provider_display_name: "ChatGPT / Codex".into(),
        display_name: display_name.into(),
        protocol: ManagedModelProtocol::Openai,
        auth_kind: ManagedModelAuthKind::ChatgptCodexOauth,
        api_base: "https://chatgpt.com/backend-api/codex".into(),
        model: model.into(),
        api_key_ref: "managed-provider:mp_chatgpt_codex".into(),
        preset_options: json!({}),
        advanced_overrides: json!({ "reasoning_effort": "high" }),
        advanced_options: json!({}),
        is_default: true,
        sort_order: 0,
        credential_status: ManagedModelCredentialStatus::Present,
        last_validated_at: None,
        created_at: "2026-10-20T00:00:00Z".into(),
        updated_at: "2026-10-20T00:00:00Z".into(),
    }
}

/// The visible catalog in the order the probe saw it (2026-10-20).
fn probe_catalog() -> Vec<String> {
    [
        "gpt-6.1-sol",
        "gpt-6-astra",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
    ]
    .map(String::from)
    .to_vec()
}

#[test]
fn sign_in_keeps_a_stored_slug_the_catalog_lists() {
    let catalog = probe_catalog();
    let kept = plan_model_upsert(
        Some(&model_record("gpt-5.6-terra", "gpt-5.6-terra")),
        Some(&catalog),
    );
    assert_eq!(kept.id, CHATGPT_MODEL_ID);
    assert_eq!(kept.model, "gpt-5.6-terra");
    assert_eq!(kept.display_name, "gpt-5.6-terra");
    // The stored option layers are kept.
    assert!(kept.preset_options.is_none());
    assert!(kept.advanced_overrides.is_none());
}

#[test]
fn sign_in_moves_an_unlisted_slug_to_the_first_visible_entry() {
    let catalog = probe_catalog();
    let moved = plan_model_upsert(Some(&model_record("gpt-5.5", "gpt-5.5")), Some(&catalog));
    assert_eq!(moved.model, "gpt-6.1-sol");
    assert_eq!(moved.display_name, "gpt-6.1-sol");
    assert!(moved.preset_options.is_none());
    assert!(moved.advanced_overrides.is_none());

    // A user-chosen display name stays.
    let renamed = plan_model_upsert(Some(&model_record("gpt-5.5", "Work model")), Some(&catalog));
    assert_eq!(renamed.model, "gpt-6.1-sol");
    assert_eq!(renamed.display_name, "Work model");

    // The fallback model is not preferred over the catalog's order.
    let new_record = plan_model_upsert(None, Some(&catalog));
    assert_eq!(new_record.model, "gpt-6.1-sol");
    assert_ne!(new_record.model, SIWC_DEFAULT_MODEL);
}

#[test]
fn sign_in_without_a_catalog_keeps_the_stored_slug() {
    let failed = plan_model_upsert(Some(&model_record("gpt-5.5", "gpt-5.5")), None);
    assert_eq!(failed.model, "gpt-5.5");
    assert_eq!(failed.display_name, "gpt-5.5");
    let empty = plan_model_upsert(Some(&model_record("gpt-5.5", "gpt-5.5")), Some(&[]));
    assert_eq!(empty.model, "gpt-5.5");
}

#[test]
fn sign_in_without_a_catalog_or_record_uses_the_fallback_model() {
    for created in [
        plan_model_upsert(None, None),
        plan_model_upsert(None, Some(&[])),
    ] {
        assert_eq!(created.model, SIWC_DEFAULT_MODEL);
        assert_eq!(created.display_name, SIWC_DEFAULT_MODEL);
        assert_eq!(created.provider_id, CHATGPT_PROVIDER_ID);
        assert!(created.preset_options.is_some());
        assert!(!created.make_default);
    }
}

// ---------------------------------------------------------------------
// Revocation retries
// ---------------------------------------------------------------------

fn scripted(
    script: Vec<Result<StatusCode, ()>>,
) -> (
    Arc<AtomicUsize>,
    impl Fn() -> std::future::Ready<Result<StatusCode, ()>>,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    let send = {
        let calls = calls.clone();
        move || {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            std::future::ready(script.get(n).cloned().unwrap_or(Err(())))
        }
    };
    (calls, send)
}

const NO_WAIT: [Duration; 3] = [Duration::ZERO; 3];

#[tokio::test]
async fn revoke_retries_network_and_server_errors() {
    let (calls, send) = scripted(vec![
        Err(()),
        Ok(StatusCode::SERVICE_UNAVAILABLE),
        Ok(StatusCode::OK),
    ]);
    assert!(revoke_with_retry(send, &NO_WAIT).await);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn revoke_stops_on_a_client_error() {
    let (calls, send) = scripted(vec![Ok(StatusCode::BAD_REQUEST), Ok(StatusCode::OK)]);
    assert!(!revoke_with_retry(send, &NO_WAIT).await);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn revoke_gives_up_after_its_backoff() {
    let (calls, send) = scripted(vec![]);
    assert!(!revoke_with_retry(send, &NO_WAIT).await);
    assert_eq!(calls.load(Ordering::SeqCst), NO_WAIT.len() + 1);
}

// ---------------------------------------------------------------------
// Errors and headers
// ---------------------------------------------------------------------

#[test]
fn plan_errors_have_a_stable_wire_shape() {
    let wire: Value =
        serde_json::from_str(&ChatgptPlanError::UsageNotGranted("no plan usage".into()).to_wire())
            .unwrap();
    assert_eq!(wire["error"], "chatgpt_plan_usage_not_granted");
    assert_eq!(wire["message"], "no plan usage");

    let core: Value = serde_json::from_str(
        &ChatgptPlanError::Core(GalleyError::NotFound {
            message: "x".into(),
        })
        .to_wire(),
    )
    .unwrap();
    assert_eq!(core["error"], "not_found");

    let galley = GalleyError::from(ChatgptPlanError::ReauthRequired("sign in".into()));
    assert!(galley.to_string().contains("chatgpt_plan_reauth_required"));
}

#[test]
fn user_agent_names_galley_os_and_arch() {
    let ua = galley_user_agent();
    assert!(ua.starts_with("Galley ("), "{ua}");
    assert!(ua.ends_with(')'));
    assert!(ua.contains("; "));
    if cfg!(target_os = "macos") {
        assert!(ua.starts_with("Galley (Darwin; "), "{ua}");
    }
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

#[test]
fn plan_sign_in_names_the_provider_chatgpt_unless_the_user_renamed_it() {
    assert_eq!(plan_provider_display_name(None), "ChatGPT");
    assert_eq!(
        plan_provider_display_name(Some("ChatGPT / Codex")),
        "ChatGPT"
    );
    assert_eq!(plan_provider_display_name(Some("  ")), "ChatGPT");
    assert_eq!(
        plan_provider_display_name(Some("Work ChatGPT")),
        "Work ChatGPT"
    );
}

// ---------------------------------------------------------------------
// Retiring the Codex CLI login (ticket 05): the startup sweep and sign-out
// ---------------------------------------------------------------------

const LEGACY_API_BASE: &str = "https://chatgpt.com/backend-api/codex";
const CHATGPT_REF: &str = "managed-provider:mp_chatgpt_codex";

/// What the removed Codex CLI login stored: tokens, no `flow`.
fn codex_cli_credential() -> String {
    json!({
        "accessToken": "legacy-access",
        "refreshToken": "legacy-refresh-shared-with-the-codex-cli",
        "expiresAt": 1,
        "accountId": "acct",
    })
    .to_string()
}

/// A store with every migration applied, holding the ChatGPT provider
/// (`api_base` and `credential` as given), its model, a session bound to
/// that model, an API-key provider with its key, and a SIWC registration.
async fn galley_with_chatgpt_provider(api_base: &str, credential: Option<&str>) -> SqliteGalley {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::apply_all_migrations_for_tests(&pool).await.unwrap();
    let galley = SqliteGalley::from_pool(pool);
    for (id, name, auth_kind, base) in [
        (
            CHATGPT_PROVIDER_ID,
            "ChatGPT / Codex",
            ManagedModelAuthKind::ChatgptCodexOauth,
            api_base,
        ),
        (
            "mp_openai",
            "OpenAI",
            ManagedModelAuthKind::ApiKey,
            "https://api.openai.com/v1",
        ),
    ] {
        galley
            .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
                id: id.into(),
                display_name: name.into(),
                protocol: ManagedModelProtocol::Openai,
                auth_kind,
                api_base: base.into(),
                api_key_ref: credential_store::managed_provider_api_key_ref(id),
            })
            .await
            .unwrap();
    }
    galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: CHATGPT_MODEL_ID.into(),
            provider_id: CHATGPT_PROVIDER_ID.into(),
            display_name: "gpt-5.5".into(),
            model: "gpt-5.5".into(),
            preset_options: Some(json!({ "codex_backend": true })),
            advanced_overrides: Some(json!({ "reasoning_effort": "high" })),
            make_default: true,
        })
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
            error_count, pinned, last_activity_at, created_at, updated_at, llm_key) \
         VALUES ('s_chatgpt', 't', 'idle', 0, 0, 0, 0, 'x', 'x', 'x', ?)",
    )
    .bind(CHATGPT_MODEL_ID)
    .execute(galley.pool())
    .await
    .unwrap();
    if let Some(credential) = credential {
        credential_store::set_secret(&galley, CHATGPT_REF, credential)
            .await
            .unwrap();
    }
    credential_store::set_secret(&galley, "managed-provider:mp_openai", "sk-test")
        .await
        .unwrap();
    save_registration(&galley, &registration(Some((TEST_CLIENT, "id.token"))))
        .await
        .unwrap();
    galley
}

async fn chatgpt_provider(galley: &SqliteGalley) -> crate::api::ManagedModelProviderRecord {
    galley
        .list_managed_model_providers()
        .await
        .unwrap()
        .into_iter()
        .find(|provider| provider.id == CHATGPT_PROVIDER_ID)
        .expect("the ChatGPT provider stays")
}

async fn session_llm_key(galley: &SqliteGalley) -> Option<String> {
    sqlx::query_scalar("SELECT llm_key FROM sessions WHERE id = 's_chatgpt'")
        .fetch_one(galley.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn startup_sweep_retires_a_codex_cli_credential_and_keeps_the_records() {
    let galley = galley_with_chatgpt_provider(LEGACY_API_BASE, Some(&codex_cli_credential())).await;
    let registration_before =
        credential_store::try_get_secret(&galley, "chatgpt-siwc:registration")
            .await
            .unwrap();

    let outcome = retire_codex_cli_credentials(&galley).await.unwrap();

    assert_eq!(
        outcome,
        LegacySweepOutcome {
            credentials_removed: vec![CHATGPT_PROVIDER_ID.into()],
            api_bases_rewritten: vec![CHATGPT_PROVIDER_ID.into()],
        }
    );
    assert!(outcome.changed());
    // The credential is gone locally ...
    assert_eq!(
        credential_store::try_get_secret(&galley, CHATGPT_REF)
            .await
            .unwrap(),
        None
    );
    // ... and the provider moved to the plan endpoint, otherwise as it was.
    let provider = chatgpt_provider(&galley).await;
    assert_eq!(provider.api_base, SIWC_API_BASE);
    assert_eq!(provider.display_name, "ChatGPT / Codex");
    assert_eq!(provider.auth_kind, ManagedModelAuthKind::ChatgptCodexOauth);
    assert_eq!(provider.api_key_ref, CHATGPT_REF);
    assert_eq!(
        provider.credential_status,
        ManagedModelCredentialStatus::Missing
    );
    // The model record, its options and the session bound to it stay.
    let model = galley
        .list_managed_models()
        .await
        .unwrap()
        .into_iter()
        .find(|model| model.id == CHATGPT_MODEL_ID)
        .expect("the ChatGPT model stays");
    assert_eq!(model.provider_id, CHATGPT_PROVIDER_ID);
    assert_eq!(model.model, "gpt-5.5");
    assert_eq!(model.advanced_overrides["reasoning_effort"], "high");
    assert!(model.is_default);
    assert_eq!(
        session_llm_key(&galley).await.as_deref(),
        Some(CHATGPT_MODEL_ID)
    );
    // Other credentials, including the SIWC registration, are untouched.
    assert_eq!(
        credential_store::get_secret(&galley, "managed-provider:mp_openai")
            .await
            .unwrap(),
        "sk-test"
    );
    assert_eq!(
        credential_store::try_get_secret(&galley, "chatgpt-siwc:registration")
            .await
            .unwrap(),
        registration_before
    );
}

#[tokio::test]
async fn startup_sweep_is_a_no_op_once_done() {
    let galley = galley_with_chatgpt_provider(LEGACY_API_BASE, Some(&codex_cli_credential())).await;
    assert!(retire_codex_cli_credentials(&galley)
        .await
        .unwrap()
        .changed());
    let providers_after_first = galley.list_managed_model_providers().await.unwrap();

    let second = retire_codex_cli_credentials(&galley).await.unwrap();

    assert_eq!(second, LegacySweepOutcome::default());
    assert!(!second.changed());
    // Nothing was written: not even `updated_at` moved.
    let providers_after_second = galley.list_managed_model_providers().await.unwrap();
    assert_eq!(
        serde_json::to_value(&providers_after_second).unwrap(),
        serde_json::to_value(&providers_after_first).unwrap()
    );
}

#[tokio::test]
async fn startup_sweep_leaves_a_siwc_credential_alone() {
    let siwc = serde_json::to_string(&siwc_secret("access-1", "refresh-1", 3600)).unwrap();
    let galley = galley_with_chatgpt_provider(SIWC_API_BASE, Some(&siwc)).await;
    let provider_before = chatgpt_provider(&galley).await;

    let outcome = retire_codex_cli_credentials(&galley).await.unwrap();

    assert_eq!(outcome, LegacySweepOutcome::default());
    assert_eq!(
        credential_store::try_get_secret(&galley, CHATGPT_REF)
            .await
            .unwrap()
            .as_deref(),
        Some(siwc.as_str())
    );
    assert_eq!(
        serde_json::to_value(chatgpt_provider(&galley).await).unwrap(),
        serde_json::to_value(provider_before).unwrap()
    );
}

#[tokio::test]
async fn startup_sweep_moves_the_endpoint_of_a_signed_out_provider() {
    // Signed out of the Codex CLI login long ago: no credential, old base.
    let galley = galley_with_chatgpt_provider(LEGACY_API_BASE, None).await;

    let outcome = retire_codex_cli_credentials(&galley).await.unwrap();

    assert!(outcome.credentials_removed.is_empty());
    assert_eq!(
        outcome.api_bases_rewritten,
        vec![CHATGPT_PROVIDER_ID.to_string()]
    );
    assert_eq!(chatgpt_provider(&galley).await.api_base, SIWC_API_BASE);
}

/// The sweep never revokes and never writes outside Galley's store: its
/// code has no HTTP client, no revoke call and no file access. Checked on
/// the source (comments stripped), since the sweep takes no client to fake.
#[test]
fn startup_sweep_makes_no_network_call_and_writes_no_file() {
    let code: String = include_str!("legacy.rs")
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "reqwest",
        "http_client",
        "revoke",
        "SIWC_REVOKE_URL",
        "std::fs",
        "tokio::fs",
        "auth.json",
        "CODEX_HOME",
    ] {
        assert!(!code.contains(forbidden), "legacy.rs uses {forbidden}");
    }
}

#[tokio::test]
async fn sign_out_deletes_a_codex_cli_credential_without_revoking_it() {
    // The early return comes before any HTTP client exists: no network.
    let galley = galley_with_chatgpt_provider(LEGACY_API_BASE, Some(&codex_cli_credential())).await;

    let result = logout(&galley, ChatgptPlanProviderInput::default())
        .await
        .unwrap();

    assert!(!result.remote_revoke_confirmed);
    assert_eq!(
        credential_store::try_get_secret(&galley, CHATGPT_REF)
            .await
            .unwrap(),
        None
    );
}
