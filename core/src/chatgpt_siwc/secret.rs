//! The Sign in with ChatGPT credential and registration models.
//!
//! The credential lives in Core's encrypted store under the ChatGPT
//! provider's `api_key_ref`, as JSON carrying `"flow": "siwc"`. Codex OAuth
//! credentials (flow A) have no `flow` field and keep parsing as A. The
//! registration (host id, issued client id, last ID token, subject) lives
//! under its own ref and survives sign-out.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, SecondsFormat, Utc};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::ManagedModelAuthKind;
use crate::codex_oauth::ResolvedCodexAccessToken;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

use super::{SIWC_FLOW, SIWC_PLAN_SCOPE, SIWC_REGISTRATION_REF};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SiwcSecret {
    /// Always [`SIWC_FLOW`]; what tells this credential from flow A.
    pub(super) flow: String,
    pub(super) client_id: String,
    #[serde(default)]
    pub(super) access_token: String,
    #[serde(default)]
    pub(super) refresh_token: String,
    #[serde(default)]
    pub(super) id_token: String,
    #[serde(default)]
    pub(super) scopes: Vec<String>,
    #[serde(default)]
    pub(super) expires_at: Option<i64>,
    /// Undocumented token-response field (seen by the 2026-10-20 probe):
    /// the earliest time the server expects a refresh. Kept, not enforced.
    #[serde(default)]
    pub(super) earliest_refresh_at: Option<i64>,
    #[serde(default)]
    pub(super) sub: Option<String>,
    #[serde(default)]
    pub(super) last_refresh_at: Option<String>,
    #[serde(default)]
    pub(super) last_refresh_error: Option<String>,
}

// Never print a token, even by accident in a `{:?}`.
impl std::fmt::Debug for SiwcSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SiwcSecret")
            .field("flow", &self.flow)
            .field("has_access_token", &!self.access_token.is_empty())
            .field("has_refresh_token", &!self.refresh_token.is_empty())
            .field("scopes", &self.scopes)
            .field("expires_at", &self.expires_at)
            .field("last_refresh_error", &self.last_refresh_error)
            .finish_non_exhaustive()
    }
}

/// The token endpoint's response (authorization code and refresh grants).
#[derive(Default, Deserialize)]
pub(super) struct TokenResponse {
    #[serde(default)]
    pub(super) access_token: Option<String>,
    #[serde(default)]
    pub(super) refresh_token: Option<String>,
    #[serde(default)]
    pub(super) id_token: Option<String>,
    #[serde(default)]
    pub(super) scope: Option<String>,
    #[serde(default)]
    pub(super) expires_in: Option<i64>,
    #[serde(default)]
    pub(super) earliest_refresh_at: Option<Value>,
}

impl SiwcSecret {
    /// The credential a successful sign-in stores.
    pub(super) fn from_sign_in(
        client_id: String,
        token: &TokenResponse,
        id_token: String,
        sub: String,
        scopes: Vec<String>,
        now: i64,
    ) -> std::result::Result<Self, String> {
        let access_token = nonempty(token.access_token.as_deref())
            .ok_or("ChatGPT token response did not include an access token")?;
        let refresh_token = nonempty(token.refresh_token.as_deref())
            .ok_or("ChatGPT token response did not include a refresh token")?;
        Ok(Self {
            flow: SIWC_FLOW.into(),
            client_id,
            expires_at: expires_at(&access_token, token.expires_in, now),
            earliest_refresh_at: token
                .earliest_refresh_at
                .as_ref()
                .and_then(|value| parse_timestamp(value, now)),
            access_token,
            refresh_token,
            id_token,
            scopes,
            sub: Some(sub),
            last_refresh_at: Some(rfc3339(now)),
            last_refresh_error: None,
        })
    }

    /// Apply a refresh response: access token, rotated refresh token,
    /// expiry and scopes are replaced together; a field the response
    /// omits keeps its previous value.
    pub(super) fn refreshed(
        &self,
        token: &TokenResponse,
        now: i64,
    ) -> std::result::Result<Self, String> {
        let access_token = nonempty(token.access_token.as_deref())
            .ok_or("ChatGPT token response did not include an access token")?;
        let refresh_token =
            nonempty(token.refresh_token.as_deref()).unwrap_or_else(|| self.refresh_token.clone());
        let scopes = token
            .scope
            .as_deref()
            .map(parse_scopes)
            .filter(|scopes| !scopes.is_empty())
            .unwrap_or_else(|| self.scopes.clone());
        Ok(Self {
            flow: SIWC_FLOW.into(),
            client_id: self.client_id.clone(),
            expires_at: expires_at(&access_token, token.expires_in, now),
            earliest_refresh_at: token
                .earliest_refresh_at
                .as_ref()
                .and_then(|value| parse_timestamp(value, now)),
            access_token,
            refresh_token,
            id_token: nonempty(token.id_token.as_deref()).unwrap_or_else(|| self.id_token.clone()),
            scopes,
            sub: self.sub.clone(),
            last_refresh_at: Some(rfc3339(now)),
            last_refresh_error: None,
        })
    }

    /// The credential after a dead refresh: tokens cleared, everything
    /// that is not a token kept, the reason recorded. The provider keeps
    /// a credential row, so its sessions report "sign in again" instead
    /// of silently moving to another model.
    pub(super) fn cleared(&self, reason: String) -> Self {
        Self {
            flow: SIWC_FLOW.into(),
            client_id: self.client_id.clone(),
            access_token: String::new(),
            refresh_token: String::new(),
            id_token: String::new(),
            scopes: self.scopes.clone(),
            expires_at: None,
            earliest_refresh_at: None,
            sub: self.sub.clone(),
            last_refresh_at: self.last_refresh_at.clone(),
            last_refresh_error: Some(reason),
        }
    }

    pub(super) fn has_tokens(&self) -> bool {
        !self.access_token.trim().is_empty() && !self.refresh_token.trim().is_empty()
    }

    pub(super) fn is_expiring(&self, skew_seconds: i64, now: i64) -> bool {
        match self.expires_at {
            Some(exp) => exp <= now + skew_seconds,
            None => true,
        }
    }

    pub(super) fn into_resolved(self) -> ResolvedCodexAccessToken {
        ResolvedCodexAccessToken {
            access_token: self.access_token,
            // SIWC access tokens carry no `chatgpt_account_id`, so no
            // `ChatGPT-Account-ID` header is sent (probe, 2026-10-20).
            account_id: None,
            expires_at: self.expires_at,
        }
    }
}

/// Whether a stored credential string is a SIWC credential. Flow-A JSON
/// (no `flow`), API keys and anything unparsable are not.
pub fn is_siwc_secret(raw: &str) -> bool {
    #[derive(Deserialize)]
    struct FlowProbe {
        #[serde(default)]
        flow: Option<String>,
    }
    serde_json::from_str::<FlowProbe>(raw)
        .ok()
        .and_then(|probe| probe.flow)
        .is_some_and(|flow| flow == SIWC_FLOW)
}

/// The `chatgptPlan` flag of a runtime model: a `chatgpt_codex_oauth`
/// model whose stored credential is a SIWC one.
pub fn runtime_chatgpt_plan(auth_kind: ManagedModelAuthKind, raw_secret: Option<&str>) -> bool {
    auth_kind == ManagedModelAuthKind::ChatgptCodexOauth && raw_secret.is_some_and(is_siwc_secret)
}

pub(super) fn has_plan_scope(scopes: &[String]) -> bool {
    scopes.iter().any(|scope| scope == SIWC_PLAN_SCOPE)
}

pub(super) fn parse_scopes(raw: &str) -> Vec<String> {
    raw.split_whitespace().map(ToOwned::to_owned).collect()
}

/// Per-installation registration with the SIWC authorization server.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SiwcRegistration {
    /// `urn:uuid:<v4>`, created before the first sign-in, never rotated.
    pub(super) host_id: String,
    #[serde(default)]
    pub(super) client_id: Option<String>,
    #[serde(default)]
    pub(super) id_token: Option<String>,
    #[serde(default)]
    pub(super) sub: Option<String>,
}

impl SiwcRegistration {
    /// The saved client id and ID token when both exist: a re-login uses
    /// them (with `id_token_hint`) instead of registering a new client.
    pub(super) fn saved_client(&self) -> Option<(&str, &str)> {
        let client_id = self
            .client_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        let id_token = self
            .id_token
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        Some((client_id, id_token))
    }
}

pub(super) async fn read_registration(galley: &SqliteGalley) -> Result<Option<SiwcRegistration>> {
    let Some(raw) = credential_store::try_get_secret(galley, SIWC_REGISTRATION_REF).await? else {
        return Ok(None);
    };
    Ok(serde_json::from_str::<SiwcRegistration>(&raw)
        .ok()
        .filter(|registration| !registration.host_id.trim().is_empty()))
}

/// The registration, creating (and persisting) the host id first if this
/// installation has none yet.
pub(super) async fn load_or_create_registration(galley: &SqliteGalley) -> Result<SiwcRegistration> {
    if let Some(existing) = read_registration(galley).await? {
        return Ok(existing);
    }
    let registration = SiwcRegistration {
        host_id: new_host_id()?,
        ..SiwcRegistration::default()
    };
    save_registration(galley, &registration).await?;
    Ok(registration)
}

pub(super) async fn save_registration(
    galley: &SqliteGalley,
    registration: &SiwcRegistration,
) -> Result<()> {
    let serialized = serde_json::to_string(registration).map_err(|e| GalleyError::Internal {
        message: format!("serializing ChatGPT registration failed: {e}"),
    })?;
    credential_store::set_secret(galley, SIWC_REGISTRATION_REF, &serialized).await
}

/// `urn:uuid:` + a random (version 4, RFC 4122 variant) UUID.
pub(super) fn new_host_id() -> Result<String> {
    let mut bytes = random_bytes::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

pub(super) fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0_u8; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| GalleyError::Internal {
            message: "generating random bytes failed".into(),
        })?;
    Ok(bytes)
}

/// A URL-safe random token of `N` bytes of entropy.
pub(super) fn random_token<const N: usize>() -> Result<String> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes::<N>()?))
}

fn expires_at(access_token: &str, expires_in: Option<i64>, now: i64) -> Option<i64> {
    jwt_exp(access_token).or_else(|| expires_in.map(|ttl| now + ttl.max(0)))
}

/// `exp` of a JWT access token, when it is one (no signature check: the
/// value only schedules our own refresh).
fn jwt_exp(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp").and_then(Value::as_i64)
}

/// Read a timestamp the server may send as unix seconds, unix
/// milliseconds, a seconds-from-now count, a numeric string, or RFC 3339.
pub(super) fn parse_timestamp(value: &Value, now: i64) -> Option<i64> {
    fn from_number(n: i64, now: i64) -> i64 {
        if n >= 1_000_000_000_000 {
            n / 1000
        } else if n >= 1_000_000_000 {
            n
        } else {
            now + n.max(0)
        }
    }
    match value {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .map(|n| from_number(n, now)),
        Value::String(s) => {
            let s = s.trim();
            if let Ok(n) = s.parse::<i64>() {
                return Some(from_number(n, now));
            }
            DateTime::parse_from_rfc3339(s)
                .ok()
                .map(|dt| dt.timestamp())
        }
        _ => None,
    }
}

fn rfc3339(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}
