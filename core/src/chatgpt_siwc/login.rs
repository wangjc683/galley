//! The Sign in with ChatGPT authorization-code flow: build the authorize
//! URL (PKCE S256, `state`, `nonce`), keep the one pending sign-in, wait
//! for its loopback callback, exchange the code, verify the ID token and
//! hand the credential to `super::persist_and_probe`.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use crate::codex_oauth::CodexAuthSetupResult;
use crate::db::SqliteGalley;
use crate::error::GalleyError;

use super::callback::{
    bind_loopback, redirect_uri_for_port, serve_callback, AuthorizedCallback, CallbackOutcome,
};
use super::id_token::{fetch_jwks, verify_id_token};
use super::logout::revoke_refresh_token;
use super::refresh::{classify_token_error, RefreshFailure};
use super::secret::{
    has_plan_scope, load_or_create_registration, parse_scopes, random_token, save_registration,
    SiwcRegistration, SiwcSecret, TokenResponse,
};
use super::{
    http_client, persist_and_probe, ChatgptPlanError, PlanResult, SIWC_AGENT_NAME_HINT,
    SIWC_AUTHORIZE_URL, SIWC_DYNAMIC_CLIENT_ID, SIWC_LOGIN_TIMEOUT_SECS, SIWC_RESOURCE,
    SIWC_SCOPES, SIWC_TOKEN_URL,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanLoginStart {
    pub login_id: String,
    /// Opened by the GUI in the user's browser. May carry `id_token_hint`:
    /// never log it.
    pub auth_url: String,
    pub expires_at: String,
}

impl std::fmt::Debug for ChatgptPlanLoginStart {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatgptPlanLoginStart")
            .field("login_id", &self.login_id)
            .field("auth_url", &"[redacted]")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteChatgptPlanLoginInput {
    pub login_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelChatgptPlanLoginInput {
    /// Cancel only this sign-in; absent cancels whichever is pending.
    #[serde(default)]
    pub login_id: Option<String>,
}

/// What the code exchange needs from the start of the sign-in.
#[derive(Clone)]
pub(super) struct PendingExchange {
    pub(super) code_verifier: String,
    pub(super) redirect_uri: String,
    pub(super) nonce: String,
    /// The saved client id this sign-in re-used, if any — the fallback
    /// when the callback does not name the issued client.
    pub(super) saved_client_id: Option<String>,
}

struct PendingLogin {
    login_id: String,
    /// Dropping this sender (slot replaced or cleared) cancels the
    /// listener, which then closes its port.
    _cancel: oneshot::Sender<()>,
    outcome: Option<oneshot::Receiver<CallbackOutcome>>,
    exchange: PendingExchange,
}

/// At most one sign-in is pending; a newer start replaces (and so
/// cancels) the older one.
static PENDING_LOGIN: OnceLock<Mutex<Option<PendingLogin>>> = OnceLock::new();

fn pending_slot() -> &'static Mutex<Option<PendingLogin>> {
    PENDING_LOGIN.get_or_init(|| Mutex::new(None))
}

pub async fn start_login(galley: &SqliteGalley) -> PlanResult<ChatgptPlanLoginStart> {
    let registration = load_or_create_registration(galley).await?;
    // Close the previous sign-in's listener before opening a new one.
    drop(take_pending(None));
    let (listener, port) = bind_loopback().await.map_err(|e| {
        ChatgptPlanError::Core(GalleyError::Internal {
            message: format!("opening the ChatGPT sign-in callback listener failed: {e}"),
        })
    })?;
    let redirect_uri = redirect_uri_for_port(port);
    let pkce = Pkce::generate()?;
    let state = random_token::<32>()?;
    let nonce = random_token::<32>()?;
    let login_id = format!("siwc-{}", random_token::<12>()?);
    let params = AuthorizeParams::new(
        &registration,
        &redirect_uri,
        &state,
        &nonce,
        &pkce.challenge,
    );
    let auth_url = build_authorize_url(&params);

    let timeout = Duration::from_secs(SIWC_LOGIN_TIMEOUT_SECS);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let (outcome_tx, outcome_rx) = oneshot::channel();
    tokio::spawn(async move {
        let outcome = serve_callback(listener, state, timeout, cancel_rx).await;
        let _ = outcome_tx.send(outcome);
    });
    let expires_at = (Utc::now() + chrono::Duration::seconds(timeout.as_secs() as i64))
        .to_rfc3339_opts(SecondsFormat::Secs, true);
    let previous = pending_slot()
        .lock()
        .expect("SIWC pending login mutex poisoned")
        .replace(PendingLogin {
            login_id: login_id.clone(),
            _cancel: cancel_tx,
            outcome: Some(outcome_rx),
            exchange: PendingExchange {
                code_verifier: pkce.verifier,
                redirect_uri,
                nonce,
                saved_client_id: params.saved_client_id(),
            },
        });
    // A start that raced this one: its listener closes here.
    drop(previous);
    Ok(ChatgptPlanLoginStart {
        login_id,
        auth_url,
        expires_at,
    })
}

pub async fn complete_login(
    galley: &SqliteGalley,
    input: CompleteChatgptPlanLoginInput,
) -> PlanResult<CodexAuthSetupResult> {
    let (outcome_rx, exchange) = claim_pending(&input.login_id)?;
    let outcome = outcome_rx.await.unwrap_or(CallbackOutcome::Cancelled);
    release_pending(&input.login_id);
    let callback = callback_from_outcome(outcome)?;
    finish_sign_in(galley, callback, exchange).await
}

pub fn cancel_login(input: CancelChatgptPlanLoginInput) {
    drop(take_pending(input.login_id.as_deref()));
}

/// Take the pending sign-in if it matches `login_id` (any when `None`).
fn take_pending(login_id: Option<&str>) -> Option<PendingLogin> {
    let mut slot = pending_slot()
        .lock()
        .expect("SIWC pending login mutex poisoned");
    match (slot.as_ref(), login_id) {
        (Some(pending), Some(id)) if pending.login_id != id => None,
        _ => slot.take(),
    }
}

fn claim_pending(
    login_id: &str,
) -> PlanResult<(oneshot::Receiver<CallbackOutcome>, PendingExchange)> {
    let mut slot = pending_slot()
        .lock()
        .expect("SIWC pending login mutex poisoned");
    let pending = slot
        .as_mut()
        .filter(|pending| pending.login_id == login_id)
        .ok_or_else(|| {
            ChatgptPlanError::LoginNotFound(
                "this ChatGPT sign-in is no longer pending; start it again".into(),
            )
        })?;
    let outcome = pending.outcome.take().ok_or_else(|| {
        ChatgptPlanError::LoginNotFound("this ChatGPT sign-in is already being completed".into())
    })?;
    Ok((outcome, pending.exchange.clone()))
}

/// Clear the slot once its sign-in has an outcome — unless a newer
/// sign-in took the slot meanwhile.
fn release_pending(login_id: &str) {
    drop(take_pending(Some(login_id)));
}

pub(super) fn callback_from_outcome(outcome: CallbackOutcome) -> PlanResult<AuthorizedCallback> {
    match outcome {
        CallbackOutcome::Authorized(callback) => Ok(callback),
        CallbackOutcome::Denied { error, .. } if error == "access_denied" => Err(
            ChatgptPlanError::AccessDenied("ChatGPT sign-in was not authorized".into()),
        ),
        CallbackOutcome::Denied { error, description } => {
            let detail = description
                .map(|d| format!(": {}", super::compact_body_redacted(&d, &[])))
                .unwrap_or_default();
            Err(ChatgptPlanError::Failed(format!(
                "ChatGPT sign-in failed ({error}){detail}"
            )))
        }
        CallbackOutcome::TimedOut => Err(ChatgptPlanError::LoginTimedOut(
            "ChatGPT sign-in timed out; start it again".into(),
        )),
        CallbackOutcome::Cancelled => Err(ChatgptPlanError::LoginCancelled(
            "ChatGPT sign-in was cancelled".into(),
        )),
    }
}

async fn finish_sign_in(
    galley: &SqliteGalley,
    callback: AuthorizedCallback,
    exchange: PendingExchange,
) -> PlanResult<CodexAuthSetupResult> {
    // The issued client id comes back on the callback (probe: `oaiapp_…`).
    let client_id = callback
        .client_id
        .clone()
        .or_else(|| exchange.saved_client_id.clone())
        .ok_or_else(|| {
            ChatgptPlanError::Failed("ChatGPT sign-in callback did not name the client".into())
        })?;
    let http = http_client()?;
    let token = exchange_code(galley, &http, &client_id, &callback.code, &exchange).await?;
    let id_token = token
        .id_token
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            ChatgptPlanError::Failed("ChatGPT token response did not include an ID token".into())
        })?
        .to_string();
    let jwks = fetch_jwks(&http).await?;
    let now = Utc::now().timestamp();
    let claims =
        verify_id_token(&id_token, &jwks, &client_id, &exchange.nonce, now).map_err(|reason| {
            ChatgptPlanError::Failed(format!("ChatGPT sign-in rejected: {reason}"))
        })?;

    // The registration is kept from here on, whatever happens next.
    let mut registration = load_or_create_registration(galley).await?;
    registration.client_id = Some(client_id.clone());
    registration.id_token = Some(id_token.clone());
    registration.sub = Some(claims.sub.clone());
    save_registration(galley, &registration).await?;

    let scopes = token
        .scope
        .as_deref()
        .or(callback.scope.as_deref())
        .map(parse_scopes)
        .unwrap_or_default();
    if !has_plan_scope(&scopes) {
        // Not used for inference: hand the unused grant back.
        if let Some(refresh_token) = token.refresh_token.as_deref() {
            let _ = revoke_refresh_token(&http, &client_id, refresh_token, &[]).await;
        }
        return Err(ChatgptPlanError::UsageNotGranted(
            "ChatGPT sign-in did not grant plan usage to Galley".into(),
        ));
    }
    let secret = SiwcSecret::from_sign_in(client_id, &token, id_token, claims.sub, scopes, now)
        .map_err(ChatgptPlanError::Failed)?;
    persist_and_probe(galley, secret, &http).await
}

async fn exchange_code(
    galley: &SqliteGalley,
    http: &reqwest::Client,
    client_id: &str,
    code: &str,
    exchange: &PendingExchange,
) -> PlanResult<TokenResponse> {
    let resp = http
        .post(SIWC_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", exchange.code_verifier.as_str()),
            ("redirect_uri", exchange.redirect_uri.as_str()),
            ("resource", SIWC_RESOURCE),
        ])
        .send()
        .await
        .map_err(|e| {
            ChatgptPlanError::Temporary(format!("exchanging the ChatGPT sign-in code failed: {e}"))
        })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| {
        ChatgptPlanError::Temporary(format!("reading the ChatGPT token response failed: {e}"))
    })?;
    if !status.is_success() {
        let error_code = super::error_code_from_body(&body);
        if matches!(
            error_code.as_deref(),
            Some("invalid_client") | Some("unauthorized_client")
        ) {
            // The saved registration is no longer accepted: forget the
            // client (never the host id) so the next sign-in registers anew.
            forget_saved_client(galley).await;
        }
        let message =
            |detail: &str| format!("exchanging the ChatGPT sign-in code failed ({detail})");
        return Err(
            match classify_token_error(status, &body, &[code, exchange.code_verifier.as_str()]) {
                RefreshFailure::Temporary { detail } => {
                    ChatgptPlanError::Temporary(message(&detail))
                }
                RefreshFailure::Terminal { code } => ChatgptPlanError::Failed(message(&code)),
                RefreshFailure::Rejected { detail } => ChatgptPlanError::Failed(message(&detail)),
            },
        );
    }
    serde_json::from_str(&body).map_err(|e| {
        ChatgptPlanError::Failed(format!("ChatGPT token response is invalid JSON: {e}"))
    })
}

async fn forget_saved_client(galley: &SqliteGalley) {
    let Ok(mut registration) = load_or_create_registration(galley).await else {
        return;
    };
    registration.client_id = None;
    registration.id_token = None;
    if let Err(e) = save_registration(galley, &registration).await {
        eprintln!("[chatgpt-siwc] clearing the saved client failed: {e}");
    }
}

pub(super) struct Pkce {
    pub(super) verifier: String,
    pub(super) challenge: String,
}

impl Pkce {
    pub(super) fn generate() -> PlanResult<Self> {
        let verifier = random_token::<32>()?;
        Ok(Self {
            challenge: pkce_challenge(&verifier),
            verifier,
        })
    }
}

/// `BASE64URL(SHA256(verifier))` — the S256 code challenge (RFC 7636).
pub(super) fn pkce_challenge(verifier: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest.as_ref())
}

/// The authorize request's variable part.
#[derive(Clone)]
pub(super) struct AuthorizeParams {
    pub(super) client_id: String,
    pub(super) agent_name_hint: Option<String>,
    pub(super) id_token_hint: Option<String>,
    pub(super) host_id: String,
    pub(super) redirect_uri: String,
    pub(super) state: String,
    pub(super) nonce: String,
    pub(super) code_challenge: String,
}

impl AuthorizeParams {
    /// First sign-in on this installation registers a client
    /// (`dynamic_agent_client` + `agent_name_hint`); later ones re-use the
    /// issued client with `id_token_hint` and no name hint.
    pub(super) fn new(
        registration: &SiwcRegistration,
        redirect_uri: &str,
        state: &str,
        nonce: &str,
        code_challenge: &str,
    ) -> Self {
        let (client_id, agent_name_hint, id_token_hint) = match registration.saved_client() {
            Some((client_id, id_token)) => {
                (client_id.to_string(), None, Some(id_token.to_string()))
            }
            None => (
                SIWC_DYNAMIC_CLIENT_ID.to_string(),
                Some(SIWC_AGENT_NAME_HINT.to_string()),
                None,
            ),
        };
        Self {
            client_id,
            agent_name_hint,
            id_token_hint,
            host_id: registration.host_id.clone(),
            redirect_uri: redirect_uri.into(),
            state: state.into(),
            nonce: nonce.into(),
            code_challenge: code_challenge.into(),
        }
    }

    fn saved_client_id(&self) -> Option<String> {
        self.id_token_hint.as_ref().map(|_| self.client_id.clone())
    }
}

pub(super) fn build_authorize_url(params: &AuthorizeParams) -> String {
    let mut pairs: Vec<(&str, &str)> = vec![("client_id", params.client_id.as_str())];
    if let Some(hint) = params.agent_name_hint.as_deref() {
        pairs.push(("agent_name_hint", hint));
    }
    if let Some(hint) = params.id_token_hint.as_deref() {
        pairs.push(("id_token_hint", hint));
    }
    pairs.extend([
        ("ext_agent_host_id", params.host_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", params.redirect_uri.as_str()),
        ("resource", SIWC_RESOURCE),
        ("scope", SIWC_SCOPES),
        ("state", params.state.as_str()),
        ("nonce", params.nonce.as_str()),
        ("code_challenge", params.code_challenge.as_str()),
        ("code_challenge_method", "S256"),
    ]);
    let mut url = reqwest::Url::parse(SIWC_AUTHORIZE_URL).expect("authorize URL is valid");
    url.query_pairs_mut().extend_pairs(pairs);
    url.into()
}
