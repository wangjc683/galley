//! The APNs provider token (design §4.3): an ES256 JWT signed with the
//! `.p8` key, cached and replaced on Apple's schedule.
//!
//! Apple ("Establishing a token-based connection to APNs"): header
//! `{"alg":"ES256","kid":<key id>}`, claims `{"iss":<team id>,"iat":<unix
//! seconds>}`; refresh the token no more than once every 20 minutes and
//! no less than once every 60. A token older than an hour gets 403
//! `ExpiredProviderToken`; refreshing too often gets 429
//! `TooManyProviderTokenUpdates`.
//!
//! Nothing here logs or prints the key or a token: [`ApnsKey`]'s `Debug`
//! is opaque and [`KeyError`] never quotes the file.

use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair as _, ECDSA_P256_SHA256_FIXED_SIGNING};

/// A cached token is replaced once it is this old: inside Apple's 20–60
/// minute window, leaving ten minutes for clock drift between the relay
/// and APNs.
pub const TOKEN_REFRESH_AFTER_SECS: u64 = 50 * 60;

/// A token APNs rejects (403 `ExpiredProviderToken` /
/// `InvalidProviderToken`) is replaced at once, but at most once per this
/// long, Apple's refresh floor. A fresh token cures a token APNs stopped
/// accepting; it does not cure a wrong key id, a revoked key or a skewed
/// clock, and those must not mint a token per push.
pub const FORCED_REFRESH_MIN_INTERVAL_SECS: u64 = 20 * 60;

const PEM_BEGIN: &str = "-----BEGIN PRIVATE KEY-----";
const PEM_END: &str = "-----END PRIVATE KEY-----";

/// Why a `.p8` key cannot be used. The messages never contain key bytes.
#[derive(Debug)]
pub enum KeyError {
    /// The file could not be read.
    Unreadable(std::io::Error),
    /// Not a PEM `PRIVATE KEY` block (a `.p8` is PKCS#8 in PEM).
    NotPem,
    /// The PEM body is not base64.
    BadBase64,
    /// Not an unencrypted PKCS#8 ECDSA P-256 key (ring's reason).
    NotP256(String),
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::Unreadable(e) => write!(f, "cannot read it: {e}"),
            KeyError::NotPem => write!(
                f,
                "not a PEM private key (expected the .p8 file Apple issues, \
                 `{PEM_BEGIN}` … `{PEM_END}`)"
            ),
            KeyError::BadBase64 => f.write_str("the PEM body is not valid base64"),
            KeyError::NotP256(why) => {
                write!(f, "not a PKCS#8 ECDSA P-256 private key ({why})")
            }
        }
    }
}

impl std::error::Error for KeyError {}

/// The APNs auth key: an ECDSA P-256 private key from Apple's `.p8` file.
pub struct ApnsKey {
    pair: EcdsaKeyPair,
}

impl fmt::Debug for ApnsKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApnsKey(..)")
    }
}

impl ApnsKey {
    /// An unencrypted PKCS#8 (DER) ECDSA P-256 key. Any other curve or key
    /// type is refused.
    pub fn from_pkcs8_der(der: &[u8]) -> Result<Self, KeyError> {
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, der, &SystemRandom::new())
            .map(|pair| Self { pair })
            .map_err(|e| KeyError::NotP256(e.to_string()))
    }

    /// The `.p8` file's text: one PEM `PRIVATE KEY` block.
    pub fn from_pem(pem: &str) -> Result<Self, KeyError> {
        let start = pem.find(PEM_BEGIN).ok_or(KeyError::NotPem)? + PEM_BEGIN.len();
        let len = pem[start..].find(PEM_END).ok_or(KeyError::NotPem)?;
        let body: String = pem[start..start + len]
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .collect();
        let der = zeroize::Zeroizing::new(STANDARD.decode(body).map_err(|_| KeyError::BadBase64)?);
        Self::from_pkcs8_der(&der)
    }

    /// Read and parse a `.p8` file.
    pub fn from_file(path: &Path) -> Result<Self, KeyError> {
        let text =
            zeroize::Zeroizing::new(std::fs::read_to_string(path).map_err(KeyError::Unreadable)?);
        Self::from_pem(&text)
    }

    /// The public key (uncompressed point), e.g. to verify a token's
    /// signature in tests. Not secret.
    pub fn public_key(&self) -> &[u8] {
        self.pair.public_key().as_ref()
    }
}

/// Seconds since the Unix epoch by the system clock (`iat`).
pub(crate) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One signed token.
#[derive(Clone)]
pub(crate) struct Token {
    /// `header.claims.signature`, the value after `bearer `.
    pub(crate) jwt: Arc<str>,
    /// Counts up per token, to tell "the token that was rejected" from
    /// "a token someone already replaced it with".
    generation: u64,
}

#[derive(Default)]
struct Cache {
    current: Option<(Token, u64)>,
    last_forced: Option<u64>,
    generations: u64,
}

/// The token cache: one token at a time, shared by every push.
pub(crate) struct ProviderToken {
    key: ApnsKey,
    key_id: String,
    team_id: String,
    rng: SystemRandom,
    cache: Mutex<Cache>,
    signed: AtomicU64,
}

impl ProviderToken {
    pub(crate) fn new(key: ApnsKey, key_id: String, team_id: String) -> Self {
        Self {
            key,
            key_id,
            team_id,
            rng: SystemRandom::new(),
            cache: Mutex::new(Cache::default()),
            signed: AtomicU64::new(0),
        }
    }

    /// Tokens signed so far, the first one included.
    pub(crate) fn refreshes(&self) -> u64 {
        self.signed.load(Relaxed)
    }

    /// The token to send at `now`: the cached one while it is younger than
    /// [`TOKEN_REFRESH_AFTER_SECS`], else a new one. A clock that went
    /// backwards past the token's `iat` also gets a new one.
    pub(crate) fn current(&self, now: u64) -> Result<Token, ring::error::Unspecified> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((token, iat)) = &cache.current {
            if now >= *iat && now - *iat < TOKEN_REFRESH_AFTER_SECS {
                return Ok(token.clone());
            }
        }
        self.sign(&mut cache, now)
    }

    /// APNs rejected `rejected` as a provider token. The token to retry
    /// with: the one that already replaced it, or a new one; `None` when
    /// a token was force-replaced less than
    /// [`FORCED_REFRESH_MIN_INTERVAL_SECS`] ago, so a retry cannot help.
    pub(crate) fn after_rejection(
        &self,
        rejected: &Token,
        now: u64,
    ) -> Result<Option<Token>, ring::error::Unspecified> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((token, _)) = &cache.current {
            if token.generation != rejected.generation {
                return Ok(Some(token.clone()));
            }
        }
        if let Some(at) = cache.last_forced {
            if now >= at && now - at < FORCED_REFRESH_MIN_INTERVAL_SECS {
                return Ok(None);
            }
        }
        cache.last_forced = Some(now);
        self.sign(&mut cache, now).map(Some)
    }

    fn sign(&self, cache: &mut Cache, now: u64) -> Result<Token, ring::error::Unspecified> {
        let header = format!(r#"{{"alg":"ES256","kid":{}}}"#, json_string(&self.key_id));
        let claims = format!(r#"{{"iss":{},"iat":{now}}}"#, json_string(&self.team_id));
        let input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(header),
            URL_SAFE_NO_PAD.encode(claims)
        );
        // ECDSA_P256_SHA256_FIXED: r ‖ s, 64 bytes, as JWS ES256 wants.
        let signature = self.key.pair.sign(&self.rng, input.as_bytes())?;
        cache.generations += 1;
        let token = Token {
            jwt: format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature.as_ref())).into(),
            generation: cache.generations,
        };
        cache.current = Some((token.clone(), now));
        self.signed.fetch_add(1, Relaxed);
        Ok(token)
    }
}

fn json_string(s: &str) -> String {
    serde_json::to_string(s).expect("a string serializes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_FIXED};
    use serde_json::{json, Value};

    fn p256_der() -> Vec<u8> {
        EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
            .unwrap()
            .as_ref()
            .to_vec()
    }

    fn pem(der: &[u8]) -> String {
        let body = STANDARD.encode(der);
        let lines: Vec<&str> = body
            .as_bytes()
            .chunks(64)
            .map(|c| std::str::from_utf8(c).unwrap())
            .collect();
        format!("{PEM_BEGIN}\n{}\n{PEM_END}\n", lines.join("\n"))
    }

    /// ring writes P-256 PKCS#8 without the `ECPrivateKey` curve
    /// parameters; the `.p8` files Apple issues carry them (every public
    /// example starts `MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg`).
    /// Rebuild ring's key in that shape.
    fn apple_shaped(der: &[u8]) -> Vec<u8> {
        // ring: 30 81 87 | 02 01 00 | 30 13 <ids> | 04 6d 30 6b 02 01 01
        // 04 20 <d> | a1 44 <public key>
        assert_eq!(&der[..3], &[0x30, 0x81, 0x87]);
        let ids = &der[6..27];
        let d = &der[36..68];
        let public = &der[68..];
        assert_eq!(public[..2], [0xa1, 0x44]);
        let p256: [u8; 12] = [
            0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
        ];
        let mut out = vec![0x30, 0x81, 0x93, 0x02, 0x01, 0x00];
        out.extend_from_slice(ids);
        out.extend_from_slice(&[0x04, 0x79, 0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]);
        out.extend_from_slice(d);
        out.extend_from_slice(&p256);
        out.extend_from_slice(public);
        out
    }

    fn decode_part(part: &str) -> Value {
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(part).unwrap()).unwrap()
    }

    fn cache() -> ProviderToken {
        let key = ApnsKey::from_pkcs8_der(&p256_der()).unwrap();
        ProviderToken::new(key, "KEYID12345".into(), "TEAM123456".into())
    }

    #[test]
    fn a_p8_loads_from_pem_including_apples_layout() {
        let der = p256_der();
        let key = ApnsKey::from_pem(&pem(&der)).unwrap();
        assert_eq!(key.public_key()[0], 0x04, "uncompressed point");
        let apple = apple_shaped(&der);
        assert!(STANDARD
            .encode(&apple)
            .starts_with("MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg"));
        let from_apple = ApnsKey::from_pem(&pem(&apple)).unwrap();
        assert_eq!(from_apple.public_key(), key.public_key());
        // CRLF line ends and surrounding text are fine.
        let crlf = format!("issued by Apple\r\n{}", pem(&der).replace('\n', "\r\n"));
        assert!(ApnsKey::from_pem(&crlf).is_ok());
        assert_eq!(format!("{key:?}"), "ApnsKey(..)");
    }

    #[test]
    fn other_keys_and_garbage_are_refused() {
        let rng = SystemRandom::new();
        let p384 =
            EcdsaKeyPair::generate_pkcs8(&ring::signature::ECDSA_P384_SHA384_FIXED_SIGNING, &rng)
                .unwrap();
        assert!(matches!(
            ApnsKey::from_pem(&pem(p384.as_ref())),
            Err(KeyError::NotP256(_))
        ));
        let ed25519 = ring::signature::Ed25519KeyPair::generate_pkcs8(&rng).unwrap();
        assert!(matches!(
            ApnsKey::from_pkcs8_der(ed25519.as_ref()),
            Err(KeyError::NotP256(_))
        ));
        assert!(matches!(ApnsKey::from_pem("hello"), Err(KeyError::NotPem)));
        let sec1 = pem(&p256_der()).replace("PRIVATE KEY", "EC PRIVATE KEY");
        assert!(matches!(ApnsKey::from_pem(&sec1), Err(KeyError::NotPem)));
        assert!(matches!(
            ApnsKey::from_pem(&format!("{PEM_BEGIN}\n!!!\n{PEM_END}")),
            Err(KeyError::BadBase64)
        ));
        let missing = ApnsKey::from_file(Path::new("/nonexistent/AuthKey.p8")).unwrap_err();
        assert!(matches!(missing, KeyError::Unreadable(_)));
    }

    #[test]
    fn the_token_is_an_es256_jwt_apple_can_verify() {
        let cache = cache();
        let token = cache.current(1_800_000_000).unwrap();
        let parts: Vec<&str> = token.jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(
            decode_part(parts[0]),
            json!({"alg": "ES256", "kid": "KEYID12345"})
        );
        assert_eq!(
            decode_part(parts[1]),
            json!({"iss": "TEAM123456", "iat": 1_800_000_000u64})
        );
        assert!(!token.jwt.contains('='), "base64url without padding");
        let signature = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
        assert_eq!(signature.len(), 64, "fixed r ‖ s, not DER");
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, cache.key.public_key())
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .expect("the signature verifies with the key's public half");
    }

    #[test]
    fn the_token_is_reused_inside_the_window_and_replaced_after_it() {
        let cache = cache();
        let t0 = 1_800_000_000;
        let first = cache.current(t0).unwrap();
        assert_eq!(cache.refreshes(), 1);
        let later = cache.current(t0 + TOKEN_REFRESH_AFTER_SECS - 1).unwrap();
        assert!(Arc::ptr_eq(&first.jwt, &later.jwt));
        assert_eq!(cache.refreshes(), 1);
        let renewed = cache.current(t0 + TOKEN_REFRESH_AFTER_SECS).unwrap();
        assert_ne!(renewed.jwt, first.jwt);
        assert_eq!(cache.refreshes(), 2);
        // Apple's window, the reason for the constant.
        const { assert!(TOKEN_REFRESH_AFTER_SECS >= 20 * 60 && TOKEN_REFRESH_AFTER_SECS < 60 * 60) };
        // The clock jumping back before `iat` replaces the token too.
        let back = cache.current(t0).unwrap();
        assert_ne!(back.jwt, renewed.jwt);
    }

    #[test]
    fn a_rejected_token_is_replaced_once_per_interval() {
        let cache = cache();
        let t0 = 1_800_000_000;
        let first = cache.current(t0).unwrap();
        let second = cache
            .after_rejection(&first, t0)
            .unwrap()
            .expect("refreshed");
        assert_ne!(second.jwt, first.jwt);
        assert_eq!(cache.refreshes(), 2);
        // A concurrent push rejected with the first token retries with the
        // second one; nothing new is signed.
        let same = cache.after_rejection(&first, t0).unwrap().unwrap();
        assert!(Arc::ptr_eq(&same.jwt, &second.jwt));
        assert_eq!(cache.refreshes(), 2);
        // The new token rejected again within the interval: no retry.
        assert!(cache.after_rejection(&second, t0 + 60).unwrap().is_none());
        assert!(Arc::ptr_eq(
            &cache.current(t0 + 60).unwrap().jwt,
            &second.jwt
        ));
        // After the interval a rejection refreshes again.
        let third = cache
            .after_rejection(&second, t0 + FORCED_REFRESH_MIN_INTERVAL_SECS)
            .unwrap()
            .unwrap();
        assert_ne!(third.jwt, second.jwt);
        assert_eq!(cache.refreshes(), 3);
    }
}
