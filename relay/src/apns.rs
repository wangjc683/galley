//! The seam between the relay and APNs (design §4.3).
//!
//! A host's `PUSH` reaches an [`ApnsSender`]; whatever it answers goes back
//! to that host as `PUSH_RESULT`. [`ApnsClient`] is the real sender (ticket
//! 06b: ES256 provider token, HTTP/2 to `api.push.apple.com` or the
//! sandbox, the payload from
//! [`galley_remote_protocol::push::apns_payload`]). A relay without APNs
//! settings runs with [`PushUnavailable`] ([`ApnsConfig::from_settings`]).

mod client;
mod token;

use std::fmt;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use galley_remote_protocol::frame::{PushRequest, PushStatus};

pub use client::{
    ApnsClient, EXPIRATION_SECS, KEEP_ALIVE_INTERVAL, KEEP_ALIVE_TIMEOUT, POOL_IDLE_TIMEOUT,
    PRODUCTION_ENDPOINT, REASON_APNS_TIMEOUT, REASON_APNS_UNREACHABLE, REASON_PAYLOAD_TOO_LARGE,
    REQUEST_TIMEOUT, SANDBOX_ENDPOINT,
};
pub use token::{ApnsKey, KeyError, FORCED_REFRESH_MIN_INTERVAL_SECS, TOKEN_REFRESH_AFTER_SECS};

/// `reason` of [`PushUnavailable`]: this relay has no APNs sender.
pub const REASON_PUSH_UNAVAILABLE: &str = "push_unavailable";
/// `reason` when a host already has [`crate::Limits::max_pushes_in_flight`]
/// pushes waiting on APNs.
pub const REASON_PUSH_BUSY: &str = "push_busy";
/// `reason` when a sender's answer is not a valid `PUSH_RESULT` (e.g.
/// `Ok` without HTTP 200, or a reason that is not printable ASCII), or
/// the sender failed inside the relay.
pub const REASON_RELAY_ERROR: &str = "relay_error";

/// The four settings, by their environment variable names (each also has
/// a flag, `relay/README.md`).
pub const ENV_KEY_PATH: &str = "GALLEY_RELAY_APNS_KEY_PATH";
pub const ENV_KEY_ID: &str = "GALLEY_RELAY_APNS_KEY_ID";
pub const ENV_TEAM_ID: &str = "GALLEY_RELAY_APNS_TEAM_ID";
pub const ENV_TOPIC: &str = "GALLEY_RELAY_APNS_TOPIC";

/// What APNs said about one push, or why the relay did not ask it. The
/// relay adds the host's `request_id` and sends it back as `PUSH_RESULT`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApnsResponse {
    /// `Ok` must come with 200 and `Unregistered` with 410
    /// ([`galley_remote_protocol::frame::PushResult`]).
    pub status: PushStatus,
    /// APNs' HTTP status; `0` when APNs never answered.
    pub apns_status: u16,
    /// APNs' `reason` or a short relay code; printable ASCII, at most 255
    /// bytes, may be empty.
    pub reason: String,
}

impl ApnsResponse {
    /// A failure APNs never saw (`apns_status` 0).
    pub fn not_sent(reason: &str) -> Self {
        Self {
            status: PushStatus::Failed,
            apns_status: 0,
            reason: reason.to_string(),
        }
    }
}

/// Sends one push to APNs. Called once per `PUSH`, concurrently, from its
/// own task; the host's connection keeps running meanwhile.
///
/// `push.device_token` and `push.env` pick the device and endpoint;
/// `push.sealed` is opaque ciphertext for the APNs `g` field. An
/// implementation must not log or keep any of them.
#[async_trait]
pub trait ApnsSender: Send + Sync + 'static {
    async fn send(&self, push: &PushRequest) -> ApnsResponse;

    /// Provider tokens signed so far, for the counters (`pushes.jwtRefreshes`).
    fn jwt_refreshes(&self) -> u64 {
        0
    }
}

/// The sender of a relay without APNs settings: every push fails with
/// [`REASON_PUSH_UNAVAILABLE`] and `apns_status` 0.
#[derive(Debug, Default, Clone, Copy)]
pub struct PushUnavailable;

#[async_trait]
impl ApnsSender for PushUnavailable {
    async fn send(&self, _push: &PushRequest) -> ApnsResponse {
        ApnsResponse::not_sent(REASON_PUSH_UNAVAILABLE)
    }
}

/// What [`ApnsClient`] needs: the auth key and its key id, the team, and
/// the app's bundle id (`apns-topic`). The environment (production or
/// sandbox) is per push, in the `PUSH` frame.
pub struct ApnsConfig {
    key: ApnsKey,
    key_id: String,
    team_id: String,
    topic: String,
}

impl fmt::Debug for ApnsConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ApnsConfig")
            .field("key", &self.key)
            .field("key_id", &self.key_id)
            .field("team_id", &self.team_id)
            .field("topic", &self.topic)
            .finish()
    }
}

/// Why the APNs settings cannot be used; the relay refuses to start.
#[derive(Debug)]
pub enum ConfigError {
    /// Some of the four settings are set, not all.
    Partial { missing: Vec<&'static str> },
    /// A setting is not printable ASCII without spaces.
    BadValue { setting: &'static str },
    /// The key file cannot be read or is not a P-256 `.p8`.
    Key { path: PathBuf, error: KeyError },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Partial { missing } => write!(
                f,
                "APNs settings are incomplete: set all of {ENV_KEY_PATH}, {ENV_KEY_ID}, \
                 {ENV_TEAM_ID} and {ENV_TOPIC} (or their flags), or none; missing: {}",
                missing.join(", ")
            ),
            ConfigError::BadValue { setting } => {
                write!(f, "{setting} must be printable ASCII without spaces")
            }
            ConfigError::Key { path, error } => {
                write!(f, "the APNs key {} is unusable: {error}", path.display())
            }
        }
    }
}

impl std::error::Error for ConfigError {}

fn checked(setting: &'static str, value: &str) -> Result<String, ConfigError> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(ConfigError::BadValue { setting });
    }
    Ok(value.to_string())
}

impl ApnsConfig {
    /// Key id, team id and topic must be printable ASCII without spaces
    /// (Apple's are 10-character ids and a bundle id).
    pub fn new(
        key: ApnsKey,
        key_id: &str,
        team_id: &str,
        topic: &str,
    ) -> Result<Self, ConfigError> {
        Ok(Self {
            key,
            key_id: checked(ENV_KEY_ID, key_id)?,
            team_id: checked(ENV_TEAM_ID, team_id)?,
            topic: checked(ENV_TOPIC, topic)?,
        })
    }

    /// The relay's APNs settings (flags or environment), all or nothing:
    /// none set → `Ok(None)`, the relay runs with [`PushUnavailable`]; all
    /// four set → the key is read and checked now, so a bad key stops the
    /// relay at startup rather than at the first push; some set → an
    /// error. A blank value counts as not set.
    pub fn from_settings(
        key_path: Option<&Path>,
        key_id: Option<&str>,
        team_id: Option<&str>,
        topic: Option<&str>,
    ) -> Result<Option<Self>, ConfigError> {
        let key_path = key_path.filter(|p| !p.as_os_str().is_empty());
        let [key_id, team_id, topic] =
            [key_id, team_id, topic].map(|v| v.map(str::trim).filter(|v| !v.is_empty()));
        let missing: Vec<&'static str> = [
            (ENV_KEY_PATH, key_path.is_none()),
            (ENV_KEY_ID, key_id.is_none()),
            (ENV_TEAM_ID, team_id.is_none()),
            (ENV_TOPIC, topic.is_none()),
        ]
        .into_iter()
        .filter_map(|(name, absent)| absent.then_some(name))
        .collect();
        match (key_path, key_id, team_id, topic) {
            (Some(path), Some(key_id), Some(team_id), Some(topic)) => {
                let key = ApnsKey::from_file(path).map_err(|error| ConfigError::Key {
                    path: path.to_path_buf(),
                    error,
                })?;
                Self::new(key, key_id, team_id, topic).map(Some)
            }
            _ if missing.len() == 4 => Ok(None),
            _ => Err(ConfigError::Partial { missing }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use ring::rand::SystemRandom;
    use ring::signature::{
        EcdsaKeyPair, ECDSA_P256_SHA256_FIXED_SIGNING, ECDSA_P384_SHA384_FIXED_SIGNING,
    };
    use std::io::Write as _;

    fn p8_file(alg: &'static ring::signature::EcdsaSigningAlgorithm) -> tempfile::NamedTempFile {
        let der = EcdsaKeyPair::generate_pkcs8(alg, &SystemRandom::new()).unwrap();
        let body = base64::engine::general_purpose::STANDARD.encode(der.as_ref());
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            file,
            "-----BEGIN PRIVATE KEY-----\n{body}\n-----END PRIVATE KEY-----"
        )
        .unwrap();
        file
    }

    #[test]
    fn no_settings_means_no_sender() {
        assert!(ApnsConfig::from_settings(None, None, None, None)
            .unwrap()
            .is_none());
        // Blank counts as unset (an empty line in an EnvironmentFile).
        assert!(
            ApnsConfig::from_settings(Some(Path::new("")), Some(" "), Some(""), None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn all_settings_load_and_check_the_key() {
        let file = p8_file(&ECDSA_P256_SHA256_FIXED_SIGNING);
        let config = ApnsConfig::from_settings(
            Some(file.path()),
            Some("KEYID12345"),
            Some("TEAM123456"),
            Some("xyz.inkstone.galley"),
        )
        .unwrap()
        .unwrap();
        let shown = format!("{config:?}");
        assert!(
            shown.contains("ApnsKey(..)") && shown.contains("xyz.inkstone.galley"),
            "{shown}"
        );
        assert!(ApnsClient::new(config).is_ok());
    }

    #[test]
    fn a_partial_set_is_refused_naming_what_is_missing() {
        let err =
            ApnsConfig::from_settings(None, Some("KEYID12345"), None, Some("xyz.inkstone.galley"))
                .unwrap_err();
        let ConfigError::Partial { missing } = &err else {
            panic!("{err}");
        };
        assert_eq!(missing, &[ENV_KEY_PATH, ENV_TEAM_ID]);
        assert!(err
            .to_string()
            .contains("missing: GALLEY_RELAY_APNS_KEY_PATH, GALLEY_RELAY_APNS_TEAM_ID"));
    }

    #[test]
    fn a_bad_key_or_value_is_refused() {
        let p384 = p8_file(&ECDSA_P384_SHA384_FIXED_SIGNING);
        let settings = |path: &Path, key_id: &str| {
            ApnsConfig::from_settings(
                Some(path),
                Some(key_id),
                Some("TEAM123456"),
                Some("xyz.inkstone.galley"),
            )
        };
        let err = settings(p384.path(), "KEYID12345").unwrap_err();
        assert!(
            matches!(
                err,
                ConfigError::Key {
                    error: KeyError::NotP256(_),
                    ..
                }
            ),
            "{err}"
        );
        let err = settings(Path::new("/nonexistent/AuthKey.p8"), "KEYID12345").unwrap_err();
        assert!(
            matches!(
                err,
                ConfigError::Key {
                    error: KeyError::Unreadable(_),
                    ..
                }
            ),
            "{err}"
        );
        assert!(err.to_string().contains("/nonexistent/AuthKey.p8"));
        let good = p8_file(&ECDSA_P256_SHA256_FIXED_SIGNING);
        let err = settings(good.path(), "KEY ID").unwrap_err();
        assert!(
            matches!(
                err,
                ConfigError::BadValue {
                    setting: ENV_KEY_ID
                }
            ),
            "{err}"
        );
    }
}
