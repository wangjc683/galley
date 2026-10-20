//! ID token verification: RS256 against the issuer's JWKS, then `iss`,
//! `aud`, `exp` and `nonce`. Uses `ring` (already a Core dependency) — no
//! JWT crate.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::Deserialize;
use serde_json::Value;

use super::{ChatgptPlanError, PlanResult, SIWC_ISSUER, SIWC_JWKS_URL};

/// Clock skew tolerated on `exp`.
const EXP_LEEWAY_SECONDS: i64 = 60;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Jwks {
    #[serde(default)]
    pub(super) keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Jwk {
    #[serde(default)]
    pub(super) kid: Option<String>,
    #[serde(default)]
    pub(super) kty: Option<String>,
    #[serde(default)]
    pub(super) n: Option<String>,
    #[serde(default)]
    pub(super) e: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct IdTokenClaims {
    pub(super) sub: String,
}

pub(super) async fn fetch_jwks(http: &reqwest::Client) -> PlanResult<Jwks> {
    let resp = http
        .get(SIWC_JWKS_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            ChatgptPlanError::Temporary(format!("fetching ChatGPT signing keys failed: {e}"))
        })?;
    let status = resp.status();
    if status.is_server_error() || status.as_u16() == 429 {
        return Err(ChatgptPlanError::Temporary(format!(
            "fetching ChatGPT signing keys failed (HTTP {})",
            status.as_u16()
        )));
    }
    if !status.is_success() {
        return Err(ChatgptPlanError::Failed(format!(
            "fetching ChatGPT signing keys failed (HTTP {})",
            status.as_u16()
        )));
    }
    resp.json::<Jwks>().await.map_err(|e| {
        ChatgptPlanError::Failed(format!("ChatGPT signing keys are invalid JSON: {e}"))
    })
}

/// Verify `token` and return its claims. Errors are short reasons that
/// never echo the token.
pub(super) fn verify_id_token(
    token: &str,
    jwks: &Jwks,
    expected_client_id: &str,
    expected_nonce: &str,
    now: i64,
) -> Result<IdTokenClaims, String> {
    let mut parts = token.trim().split('.');
    let (Some(header_b64), Some(payload_b64), Some(signature_b64), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err("ID token is not a JWS compact token".into());
    };
    let header: Value = decode_json(header_b64).ok_or("ID token header is invalid")?;
    if header.get("alg").and_then(Value::as_str) != Some("RS256") {
        return Err("ID token is not signed with RS256".into());
    }
    let kid = header
        .get("kid")
        .and_then(Value::as_str)
        .ok_or("ID token header has no kid")?;
    let key = jwks
        .keys
        .iter()
        .find(|key| key.kid.as_deref() == Some(kid) && key.kty.as_deref() == Some("RSA"))
        .ok_or("ID token signing key is not in the issuer's key set")?;
    let n =
        decode_b64(key.n.as_deref().unwrap_or_default()).ok_or("signing key modulus is invalid")?;
    let e = decode_b64(key.e.as_deref().unwrap_or_default())
        .ok_or("signing key exponent is invalid")?;
    let signature = decode_b64(signature_b64).ok_or("ID token signature is invalid")?;
    let signing_input = &token.trim()[..header_b64.len() + 1 + payload_b64.len()];
    RsaPublicKeyComponents { n: &n, e: &e }
        .verify(
            &RSA_PKCS1_2048_8192_SHA256,
            signing_input.as_bytes(),
            &signature,
        )
        .map_err(|_| "ID token signature does not verify")?;

    let claims: Value = decode_json(payload_b64).ok_or("ID token payload is invalid")?;
    if claims.get("iss").and_then(Value::as_str) != Some(SIWC_ISSUER) {
        return Err("ID token issuer is not https://auth.openai.com".into());
    }
    let audience_ok = match claims.get("aud") {
        Some(Value::String(aud)) => aud == expected_client_id,
        Some(Value::Array(auds)) => {
            auds.iter()
                .any(|aud| aud.as_str() == Some(expected_client_id))
                && claims
                    .get("azp")
                    .and_then(Value::as_str)
                    .is_none_or(|azp| azp == expected_client_id)
        }
        _ => false,
    };
    if !audience_ok {
        return Err("ID token audience is not this client".into());
    }
    let exp = claims
        .get("exp")
        .and_then(Value::as_i64)
        .ok_or("ID token has no exp")?;
    if exp + EXP_LEEWAY_SECONDS <= now {
        return Err("ID token has expired".into());
    }
    if claims.get("nonce").and_then(Value::as_str) != Some(expected_nonce) {
        return Err("ID token nonce does not match this sign-in".into());
    }
    let sub = claims
        .get("sub")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("ID token has no subject")?;
    Ok(IdTokenClaims { sub: sub.into() })
}

fn decode_b64(raw: &str) -> Option<Vec<u8>> {
    let raw = raw.trim().trim_end_matches('=');
    if raw.is_empty() {
        return None;
    }
    URL_SAFE_NO_PAD.decode(raw).ok()
}

fn decode_json(raw: &str) -> Option<Value> {
    serde_json::from_slice(&decode_b64(raw)?).ok()
}
