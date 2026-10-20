//! Sign-out for the ChatGPT provider.
//!
//! The stored credential is removed, then a SIWC refresh token is revoked
//! (RFC 7009; live probe 2026-10-20: `200` with an empty body, idempotent).
//! The registration and host id stay. A stored value that is not a SIWC
//! credential (a Codex CLI login credential the startup sweep has not
//! removed yet) is only deleted, never revoked: its refresh token may be
//! the one the Codex CLI itself uses.

use std::future::Future;
use std::time::Duration;

use reqwest::StatusCode;
use serde::Serialize;

use crate::credential_store;
use crate::db::SqliteGalley;

use super::refresh::refresh_gate;
use super::secret::SiwcSecret;
use super::{
    provider_api_key_ref, ChatgptPlanProviderInput, PlanResult, SIWC_FLOW, SIWC_REVOKE_URL,
};

/// Waits between revoke attempts on a network error, 5xx or 429.
const REVOKE_BACKOFF: [Duration; 2] = [Duration::from_millis(500), Duration::from_millis(1500)];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanLogoutResult {
    /// The authorization server confirmed the revocation. Always `false`
    /// when no SIWC refresh token was stored (nothing to revoke).
    pub remote_revoke_confirmed: bool,
}

pub async fn logout(
    galley: &SqliteGalley,
    input: ChatgptPlanProviderInput,
) -> PlanResult<ChatgptPlanLogoutResult> {
    let api_key_ref = provider_api_key_ref(galley, input.provider_id).await?;
    // Read and remove under the refresh gate: a refresh in flight has
    // saved its rotated token by the time we read, so we revoke the live
    // one, and none can start from a credential we are deleting.
    let secret = {
        let gate = refresh_gate(&api_key_ref);
        let _guard = gate.lock().await;
        let secret = credential_store::try_get_secret(galley, &api_key_ref)
            .await?
            .and_then(|raw| serde_json::from_str::<SiwcSecret>(&raw).ok())
            .filter(|secret| secret.flow == SIWC_FLOW);
        credential_store::delete_secret(galley, &api_key_ref).await?;
        secret
    };
    let Some(secret) = secret.filter(|secret| !secret.refresh_token.trim().is_empty()) else {
        // Nothing stored, not a SIWC credential, or tokens already
        // cleared (dead refresh): nothing to revoke.
        return Ok(ChatgptPlanLogoutResult {
            remote_revoke_confirmed: false,
        });
    };
    let http = super::http_client()?;
    let confirmed = revoke_refresh_token(
        &http,
        &secret.client_id,
        &secret.refresh_token,
        &REVOKE_BACKOFF,
    )
    .await;
    Ok(ChatgptPlanLogoutResult {
        remote_revoke_confirmed: confirmed,
    })
}

/// Revoke `refresh_token`, retrying network errors and 5xx / 429 after
/// each wait in `backoff`. `true` only on a 2xx.
pub(super) async fn revoke_refresh_token(
    http: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
    backoff: &[Duration],
) -> bool {
    revoke_with_retry(
        || async {
            http.post(SIWC_REVOKE_URL)
                .form(&[
                    ("token", refresh_token),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", client_id),
                ])
                .send()
                .await
                .map(|resp| resp.status())
                .map_err(|_| ())
        },
        backoff,
    )
    .await
}

pub(super) async fn revoke_with_retry<F, Fut>(send: F, backoff: &[Duration]) -> bool
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<StatusCode, ()>>,
{
    let mut waits = backoff.iter();
    loop {
        match send().await {
            Ok(status) if status.is_success() => return true,
            Ok(status) if status.is_server_error() || status.as_u16() == 429 => {}
            Ok(_) => return false,
            Err(()) => {}
        }
        match waits.next() {
            Some(wait) => tokio::time::sleep(*wait).await,
            None => return false,
        }
    }
}
