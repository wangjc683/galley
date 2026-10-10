//! Where the remote module connects, how it names this desktop, and its
//! tunables (design §2 "relay 地址从哪来", §4.2, §5, §6.5).
//!
//! The relay URL is never something the user types: a release build gets
//! it at compile time from CI (`option_env!("GALLEY_REMOTE_RELAY_URL")`,
//! the same pattern as the updater endpoint in `app_update.rs`), and the
//! runtime environment variable of the same name overrides it — a dev
//! relay on this machine, or a self-hosted one. With neither, the module
//! does not exist ([`super::RemoteModule::for_app`] returns `None`).

use galley_remote_protocol::keys::{RelayUrl, RelayUrlError, DESKTOP_NAME_MAX_BYTES};
use std::time::Duration;

/// Environment variable (runtime) and compile-time variable naming the
/// relay base URL (`wss://host[/path]`; `ws://` only to a loopback host).
pub const RELAY_URL_ENV: &str = "GALLEY_REMOTE_RELAY_URL";

/// Name used when the machine reports none.
const FALLBACK_DESKTOP_NAME: &str = "Galley";

/// The relay URL from the runtime environment, else from the build.
/// `Ok(None)`: not configured, remote access is off. `Err`: configured
/// but not a valid relay URL (also off; the caller logs it).
pub fn relay_url_from_env() -> Result<Option<RelayUrl>, RelayUrlError> {
    resolve_relay_url(
        std::env::var(RELAY_URL_ENV).ok().as_deref(),
        option_env!("GALLEY_REMOTE_RELAY_URL"),
    )
}

/// [`relay_url_from_env`] with the two sources passed in: the first
/// non-blank of `runtime` and `compiled`, parsed strictly.
pub fn resolve_relay_url(
    runtime: Option<&str>,
    compiled: Option<&str>,
) -> Result<Option<RelayUrl>, RelayUrlError> {
    fn pick(value: Option<&str>) -> Option<&str> {
        value.map(str::trim).filter(|v| !v.is_empty())
    }
    match pick(runtime).or_else(|| pick(compiled)) {
        Some(url) => RelayUrl::parse(url).map(Some),
        None => Ok(None),
    }
}

/// This machine's name for the pairing code and Core's hello: the
/// computer name the OS shows (macOS "Computer Name", Windows' computer
/// name), else the host name, else `Galley`.
pub fn desktop_name() -> String {
    let raw = whoami::fallible::devicename()
        .ok()
        .filter(|name| !name.trim().is_empty())
        .or_else(|| whoami::fallible::hostname().ok())
        .unwrap_or_default();
    sanitize_desktop_name(&raw)
}

/// A name the pairing code accepts: control characters removed, trimmed,
/// cut to [`DESKTOP_NAME_MAX_BYTES`] on a character boundary, never empty.
pub fn sanitize_desktop_name(raw: &str) -> String {
    let cleaned: String = raw.chars().filter(|c| !c.is_control()).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return FALLBACK_DESKTOP_NAME.to_string();
    }
    let mut out = String::new();
    for c in trimmed.chars() {
        if out.len() + c.len_utf8() > DESKTOP_NAME_MAX_BYTES {
            break;
        }
        out.push(c);
    }
    let out = out.trim_end().to_string();
    if out.is_empty() {
        FALLBACK_DESKTOP_NAME.to_string()
    } else {
        out
    }
}

/// Timings and limits. [`Default`] is production; tests shorten them.
#[derive(Debug, Clone)]
pub struct RemoteTuning {
    /// `PING` to the relay this often (design §4.2: 25 s; the relay drops
    /// a connection after 90 s without one).
    pub ping_interval: Duration,
    /// No `PONG` for this long: the connection is dead, reconnect.
    pub pong_timeout: Duration,
    /// A connect attempt (TCP, TLS, WebSocket upgrade) that takes longer
    /// is abandoned and retried.
    pub connect_timeout: Duration,
    /// First reconnect delay; doubles per failed attempt, with jitter.
    pub backoff_initial: Duration,
    /// Reconnect delay cap.
    pub backoff_max: Duration,
    /// A connection that lived this long resets the backoff. Shorter-lived
    /// ones keep backing off, so two desktops with the same pairing key
    /// (each displacing the other, design §4.2) do not spin.
    pub stable_after: Duration,
    /// An end-to-end session older than this is closed with `Expired`
    /// and the phone reconnects, rekeying (design §5: 24 h).
    pub session_max_age: Duration,
    /// How often session ages are checked.
    pub housekeeping_interval: Duration,
    /// `runner-event`s of one session are batched this long into one
    /// `runner.event` (design §4.4: 100 ms).
    pub runner_batch_window: Duration,
    /// Events the sink holds for the mapping task before it drops them
    /// and asks every phone to resync.
    pub sink_capacity: usize,
    /// Per phone: events (not responses) waiting to be sent before the
    /// queue sheds `runner.event`s and asks for a resync (design §6.5).
    pub phone_queue_events: usize,
    /// Per phone: the same bound in bytes.
    pub phone_queue_bytes: usize,
}

impl Default for RemoteTuning {
    fn default() -> Self {
        Self {
            ping_interval: Duration::from_secs(25),
            pong_timeout: Duration::from_secs(60),
            connect_timeout: Duration::from_secs(20),
            backoff_initial: Duration::from_secs(1),
            backoff_max: Duration::from_secs(60),
            stable_after: Duration::from_secs(30),
            session_max_age: Duration::from_secs(
                galley_remote_protocol::noise::SESSION_MAX_AGE_SECS,
            ),
            housekeeping_interval: Duration::from_secs(30),
            runner_batch_window: Duration::from_millis(100),
            sink_capacity: 1024,
            phone_queue_events: 512,
            phone_queue_bytes: 4 * 1024 * 1024,
        }
    }
}

/// What a [`super::RemoteModule`] is configured with.
#[derive(Debug, Clone)]
pub struct RemoteConfig {
    pub relay: RelayUrl,
    /// Shown on the phone (pairing code `name=`, hello `desktopName`).
    pub desktop_name: String,
    /// Galley's version, in Core's hello.
    pub core_version: String,
    pub tuning: RemoteTuning,
    /// Register the event sink process-wide
    /// ([`crate::notify::register_remote_sink`]) while running, so every
    /// `TauriNotifier` emit reaches the phones. Production: `true`. Tests
    /// that run several modules in one process feed each module's sink
    /// themselves and pass `false`.
    pub register_global_sink: bool,
}

impl RemoteConfig {
    /// Production configuration for `relay`.
    pub fn new(relay: RelayUrl) -> Self {
        Self {
            relay,
            desktop_name: desktop_name(),
            core_version: env!("CARGO_PKG_VERSION").to_string(),
            tuning: RemoteTuning::default(),
            register_global_sink: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_url_anywhere_means_not_configured() {
        assert_eq!(resolve_relay_url(None, None), Ok(None));
        assert_eq!(resolve_relay_url(Some("  "), Some("")), Ok(None));
    }

    #[test]
    fn the_runtime_variable_overrides_the_build() {
        let url = resolve_relay_url(Some("ws://127.0.0.1:9000"), Some("wss://relay.example"))
            .unwrap()
            .unwrap();
        assert_eq!(url.as_str(), "ws://127.0.0.1:9000");
        let url = resolve_relay_url(None, Some(" wss://relay.example/ "))
            .unwrap()
            .unwrap();
        assert_eq!(url.as_str(), "wss://relay.example");
        assert_eq!(url.connect_url(), "wss://relay.example/v1/connect");
    }

    #[test]
    fn an_invalid_url_is_an_error_not_a_fallback() {
        assert!(resolve_relay_url(Some("http://relay.example"), Some("wss://ok.example")).is_err());
        // Plain ws:// only to a loopback dev relay.
        assert!(resolve_relay_url(Some("ws://relay.example"), None).is_err());
    }

    #[test]
    fn desktop_names_fit_the_pairing_code() {
        assert_eq!(sanitize_desktop_name(""), "Galley");
        assert_eq!(sanitize_desktop_name(" \t\n "), "Galley");
        assert_eq!(sanitize_desktop_name("JC\u{7}'s Mac\n"), "JC's Mac");
        let long = "名".repeat(100);
        let cut = sanitize_desktop_name(&long);
        assert!(cut.len() <= DESKTOP_NAME_MAX_BYTES);
        assert_eq!(cut, "名".repeat(DESKTOP_NAME_MAX_BYTES / 3));
        assert!(!desktop_name().is_empty());
        assert!(desktop_name().len() <= DESKTOP_NAME_MAX_BYTES);
    }
}
