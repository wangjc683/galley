//! Pairing keys and the pairing QR string (design §3.1).
//!
//! The desktop generates one 32-byte pairing master key (MK) and shows it
//! to the phone once, in the pairing QR code. Both ends derive three
//! single-purpose keys from it with HKDF-SHA256 (salt `galley-remote-v1`,
//! one `info` label per purpose), because the Noise spec wants a PSK used
//! inside Noise only (spec §14):
//!
//! | Key | `info` | Who sees it |
//! |---|---|---|
//! | [`ChannelSecret`] | `channel` | the relay (it routes by `SHA-256(channel_secret)`, [`ChannelKey`]) |
//! | [`NoisePsk`] | `noise-psk` | the two ends |
//! | [`PushKey`] | `push` | the two ends and the phone's Notification Service Extension |
//!
//! Key types zeroize on drop and print `<redacted>` in `Debug`, so a key
//! cannot reach a log line through `{:?}`. "Unpairing" is rotating the MK
//! (design §3.1); nothing here stores keys.

use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

/// Every key here is 32 bytes.
pub const KEY_LEN: usize = 32;
/// HKDF-SHA256 salt for every derivation from the master key.
pub const HKDF_SALT: &[u8] = b"galley-remote-v1";
/// HKDF `info` of [`ChannelSecret`].
pub const INFO_CHANNEL: &[u8] = b"channel";
/// HKDF `info` of [`NoisePsk`].
pub const INFO_NOISE_PSK: &[u8] = b"noise-psk";
/// HKDF `info` of [`PushKey`].
pub const INFO_PUSH: &[u8] = b"push";

macro_rules! secret_key {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone)]
        pub struct $name([u8; KEY_LEN]);

        impl $name {
            /// Wrap raw key bytes (e.g. read back from the credential store).
            pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
                Self(bytes)
            }

            /// The raw key bytes. Keep them out of logs and error text.
            pub fn expose_secret(&self) -> &[u8; KEY_LEN] {
                &self.0
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                self.0.zeroize();
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "(<redacted>)"))
            }
        }
    };
}

secret_key! {
    /// The pairing master key (MK): 32 random bytes, generated on the
    /// desktop, stored in Core's credential store (`remote:pairing:mk`) and
    /// in the phone's keychain. Everything else is derived from it.
    MasterKey
}

secret_key! {
    /// Shown to the relay on connect (`X-Galley-Channel`); the relay keys
    /// its channel table by [`ChannelSecret::channel_key`]. Knowing it lets
    /// a peer join the channel, not read or forge any traffic.
    ChannelSecret
}

secret_key! {
    /// The `psk` of the `NNpsk0` handshake ([`crate::noise`]).
    NoisePsk
}

secret_key! {
    /// The ChaCha20-Poly1305 key of push content ([`crate::push`]).
    PushKey
}

/// Why key material could not be produced or read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyError {
    /// The OS random source failed.
    Random,
    /// Not base64url without padding (or non-canonical trailing bits).
    BadBase64,
    /// Decoded to the wrong number of bytes.
    BadLength { expected: usize, actual: usize },
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::Random => f.write_str("the OS random source failed"),
            KeyError::BadBase64 => f.write_str("key is not unpadded base64url"),
            KeyError::BadLength { expected, actual } => {
                write!(f, "key is {actual} bytes, expected {expected}")
            }
        }
    }
}

impl std::error::Error for KeyError {}

/// Decode unpadded base64url into exactly [`KEY_LEN`] bytes. The base64
/// engine rejects padding and non-canonical trailing bits.
fn decode_key(value: &str) -> Result<[u8; KEY_LEN], KeyError> {
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| KeyError::BadBase64)?,
    );
    if bytes.len() != KEY_LEN {
        return Err(KeyError::BadLength {
            expected: KEY_LEN,
            actual: bytes.len(),
        });
    }
    let mut out = [0u8; KEY_LEN];
    out.copy_from_slice(&bytes);
    Ok(out)
}

/// The three keys derived from one [`MasterKey`].
#[derive(Debug, Clone)]
pub struct DerivedKeys {
    pub channel_secret: ChannelSecret,
    pub noise_psk: NoisePsk,
    pub push_key: PushKey,
}

impl MasterKey {
    /// 32 fresh bytes from the OS random source.
    pub fn generate() -> Result<Self, KeyError> {
        let mut bytes = [0u8; KEY_LEN];
        getrandom::fill(&mut bytes).map_err(|_| KeyError::Random)?;
        let key = Self(bytes);
        bytes.zeroize();
        Ok(key)
    }

    /// HKDF-SHA256 with [`HKDF_SALT`]; one `expand` per purpose.
    pub fn derive(&self) -> DerivedKeys {
        let hk = Hkdf::<Sha256>::new(Some(HKDF_SALT), &self.0);
        let expand = |info: &[u8]| {
            let mut okm = [0u8; KEY_LEN];
            // 32 bytes is far below HKDF-SHA256's 255 * 32 limit.
            hk.expand(info, &mut okm)
                .expect("32-byte HKDF-SHA256 output is always valid");
            okm
        };
        DerivedKeys {
            channel_secret: ChannelSecret(expand(INFO_CHANNEL)),
            noise_psk: NoisePsk(expand(INFO_NOISE_PSK)),
            push_key: PushKey(expand(INFO_PUSH)),
        }
    }

    /// Unpadded base64url, as the QR string's `mk=` carries it.
    pub fn to_base64url(&self) -> Zeroizing<String> {
        Zeroizing::new(URL_SAFE_NO_PAD.encode(self.0))
    }

    /// Strict inverse of [`MasterKey::to_base64url`]: exactly 32 bytes.
    pub fn from_base64url(value: &str) -> Result<Self, KeyError> {
        decode_key(value).map(Self)
    }
}

impl ChannelSecret {
    /// The relay's channel table key: `SHA-256(channel_secret)`.
    pub fn channel_key(&self) -> ChannelKey {
        ChannelKey(Sha256::digest(self.0).into())
    }

    /// Value of the `X-Galley-Channel` connect header: unpadded base64url.
    pub fn to_header_value(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0)
    }

    /// Strict inverse of [`ChannelSecret::to_header_value`] (the relay's
    /// side): exactly 32 bytes.
    pub fn from_header_value(value: &str) -> Result<Self, KeyError> {
        decode_key(value).map(Self)
    }
}

/// `SHA-256(channel_secret)`: the relay's routing key for one pairing.
/// Not a secret that opens anything, but it identifies a user's channel,
/// so `Debug` hides it too (the relay's counters must not carry it,
/// design §4.4).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ChannelKey([u8; KEY_LEN]);

impl ChannelKey {
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl fmt::Debug for ChannelKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ChannelKey(<redacted>)")
    }
}

// ---------------------------------------------------------------- QR ----

/// Scheme and version of the pairing QR string. A different version is a
/// different format; this parser accepts version 1 only.
pub const QR_PREFIX: &str = "galley-pair:1?";
/// Longest QR string [`PairingCode::parse`] looks at.
pub const QR_MAX_LEN: usize = 2048;
/// Longest relay URL, before percent-encoding.
pub const RELAY_URL_MAX_LEN: usize = 512;
/// Longest desktop display name, in UTF-8 bytes.
pub const DESKTOP_NAME_MAX_BYTES: usize = 128;

/// Why a QR string or one of its fields was rejected. No variant carries
/// key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QrError {
    /// Not `galley-pair:1?…` (other scheme or version).
    BadPrefix,
    TooLong,
    /// A `key=value` pair without `=`, or an empty query.
    MalformedQuery,
    UnknownKey(String),
    DuplicateKey(&'static str),
    MissingKey(&'static str),
    /// A `%` not followed by two hex digits, or a raw character that must
    /// be percent-encoded (space, control, non-ASCII, `&`, `=`, `#`, `+`).
    BadPercentEncoding,
    BadUtf8,
    BadMasterKey(KeyError),
    BadRelayUrl(RelayUrlError),
    /// Empty, blank, longer than [`DESKTOP_NAME_MAX_BYTES`], or with
    /// control characters.
    BadDesktopName,
}

impl fmt::Display for QrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            QrError::BadPrefix => write!(f, "not a {QR_PREFIX} pairing code"),
            QrError::TooLong => f.write_str("pairing code too long"),
            QrError::MalformedQuery => f.write_str("malformed pairing code query"),
            QrError::UnknownKey(key) => write!(f, "unknown pairing code field {key:?}"),
            QrError::DuplicateKey(key) => write!(f, "pairing code field {key} appears twice"),
            QrError::MissingKey(key) => write!(f, "pairing code field {key} is missing"),
            QrError::BadPercentEncoding => f.write_str("bad percent-encoding in pairing code"),
            QrError::BadUtf8 => f.write_str("pairing code field is not UTF-8"),
            QrError::BadMasterKey(e) => write!(f, "bad mk: {e}"),
            QrError::BadRelayUrl(e) => write!(f, "bad relay: {e}"),
            QrError::BadDesktopName => f.write_str("bad desktop name"),
        }
    }
}

impl std::error::Error for QrError {}

/// Why a relay URL was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayUrlError {
    TooLong,
    /// Neither `wss://` nor `ws://`.
    BadScheme,
    /// `ws://` to a host that is not loopback (only a local dev relay may
    /// skip TLS).
    InsecureRemote,
    /// Whitespace, control or non-ASCII characters, or a userinfo / query
    /// / fragment part.
    BadCharacter,
    BadHost,
    BadPort,
    BadPath,
}

impl fmt::Display for RelayUrlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            RelayUrlError::TooLong => "relay URL too long",
            RelayUrlError::BadScheme => "relay URL must start with wss://",
            RelayUrlError::InsecureRemote => "ws:// is only allowed for a loopback relay",
            RelayUrlError::BadCharacter => "relay URL has a character it may not have",
            RelayUrlError::BadHost => "relay URL host is invalid",
            RelayUrlError::BadPort => "relay URL port is invalid",
            RelayUrlError::BadPath => "relay URL path is invalid",
        })
    }
}

impl std::error::Error for RelayUrlError {}

/// A relay base URL: `wss://host[:port][/path]`, or `ws://` to a loopback
/// host (`localhost`, `127.0.0.0/8`, `[::1]`) for a dev relay. No userinfo,
/// query or fragment. Normalized: lowercase host, no trailing `/`.
/// [`RelayUrl::connect_url`] appends the connect path (design §4.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayUrl {
    url: String,
    host: String,
    secure: bool,
}

impl RelayUrl {
    pub fn parse(input: &str) -> Result<Self, RelayUrlError> {
        if input.len() > RELAY_URL_MAX_LEN {
            return Err(RelayUrlError::TooLong);
        }
        let (secure, rest) = if let Some(rest) = input.strip_prefix("wss://") {
            (true, rest)
        } else if let Some(rest) = input.strip_prefix("ws://") {
            (false, rest)
        } else {
            return Err(RelayUrlError::BadScheme);
        };
        if !rest.bytes().all(|b| b.is_ascii_graphic()) || rest.contains(['@', '?', '#']) {
            return Err(RelayUrlError::BadCharacter);
        }
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        let (host, port) = split_host_port(authority)?;
        let host = host.to_ascii_lowercase();
        let path = normalize_path(path)?;
        if !secure && !is_loopback_host(&host) {
            return Err(RelayUrlError::InsecureRemote);
        }
        let scheme = if secure { "wss" } else { "ws" };
        let url = match port {
            Some(port) => format!("{scheme}://{host}:{port}{path}"),
            None => format!("{scheme}://{host}{path}"),
        };
        Ok(Self { url, host, secure })
    }

    /// The normalized URL.
    pub fn as_str(&self) -> &str {
        &self.url
    }

    /// Host as written in the URL (lowercase; IPv6 keeps its brackets).
    pub fn host(&self) -> &str {
        &self.host
    }

    /// `true` for `wss://`.
    pub fn is_secure(&self) -> bool {
        self.secure
    }

    /// The WebSocket URL to connect to: this URL plus
    /// [`crate::frame::CONNECT_PATH`].
    pub fn connect_url(&self) -> String {
        format!("{}{}", self.url, crate::frame::CONNECT_PATH)
    }
}

impl fmt::Display for RelayUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.url)
    }
}

fn split_host_port(authority: &str) -> Result<(&str, Option<u16>), RelayUrlError> {
    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']').ok_or(RelayUrlError::BadHost)?;
        let inner = &authority[1..end];
        if inner.parse::<Ipv6Addr>().is_err() {
            return Err(RelayUrlError::BadHost);
        }
        let rest = &authority[end + 1..];
        let port = if rest.is_empty() {
            None
        } else {
            Some(rest.strip_prefix(':').ok_or(RelayUrlError::BadPort)?)
        };
        (&authority[..=end], port)
    } else {
        let (host, port) = match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        };
        if !is_reg_name(host) {
            return Err(RelayUrlError::BadHost);
        }
        (host, port)
    };
    let port = match port {
        None => None,
        Some(p) => {
            if p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()) {
                return Err(RelayUrlError::BadPort);
            }
            match p.parse::<u16>() {
                Ok(0) | Err(_) => return Err(RelayUrlError::BadPort),
                Ok(n) => Some(n),
            }
        }
    };
    Ok((host, port))
}

/// DNS name or dotted IPv4: dot-separated labels of ASCII letters, digits
/// and inner hyphens. Internationalized names must arrive as punycode.
fn is_reg_name(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

fn is_loopback_host(host: &str) -> bool {
    if host == "localhost" {
        return true;
    }
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<Ipv6Addr>().is_ok_and(|ip| ip.is_loopback());
    }
    host.parse::<Ipv4Addr>().is_ok_and(|ip| ip.is_loopback())
}

/// Optional base path: `/`-separated segments of unreserved characters,
/// no `.` / `..` / empty segments; trailing slashes dropped.
fn normalize_path(path: &str) -> Result<String, RelayUrlError> {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    for segment in trimmed[1..].split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || !segment.bytes().all(is_unreserved)
        {
            return Err(RelayUrlError::BadPath);
        }
    }
    Ok(trimmed.to_string())
}

/// RFC 3986 unreserved: the only bytes [`percent_encode`] leaves as they are.
fn is_unreserved(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
}

fn percent_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(value.len());
    for &b in value.as_bytes() {
        if is_unreserved(b) {
            out.push(char::from(b));
        } else {
            out.push('%');
            out.push(char::from(HEX[usize::from(b >> 4)]));
            out.push(char::from(HEX[usize::from(b & 0x0f)]));
        }
    }
    out
}

/// Strict percent-decoding: `%XX` (either hex case) or a printable ASCII
/// character that is not `%`, `&`, `=`, `#` or `+`; the result must be
/// UTF-8. `+` is not a space here (this is not form encoding).
fn percent_decode(value: &str) -> Result<String, QrError> {
    fn hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'%' {
            let hi = bytes.get(i + 1).copied().and_then(hex);
            let lo = bytes.get(i + 2).copied().and_then(hex);
            match (hi, lo) {
                (Some(hi), Some(lo)) => out.push((hi << 4) | lo),
                _ => return Err(QrError::BadPercentEncoding),
            }
            i += 3;
        } else if b.is_ascii_graphic() && !matches!(b, b'&' | b'=' | b'#' | b'+') {
            out.push(b);
            i += 1;
        } else {
            return Err(QrError::BadPercentEncoding);
        }
    }
    String::from_utf8(out).map_err(|_| QrError::BadUtf8)
}

fn validate_desktop_name(name: &str) -> Result<(), QrError> {
    if name.trim().is_empty()
        || name.len() > DESKTOP_NAME_MAX_BYTES
        || name.chars().any(char::is_control)
    {
        return Err(QrError::BadDesktopName);
    }
    Ok(())
}

/// What the pairing QR code carries:
/// `galley-pair:1?relay=<url>&mk=<base64url(MK)>&name=<desktop name>`.
///
/// `relay` and `name` are percent-encoded (everything but RFC 3986
/// unreserved characters); `mk` is unpadded base64url. [`PairingCode::parse`]
/// is strict: exact scheme and version, each of the three fields exactly
/// once (any order), no other field, `mk` decoding to exactly 32 bytes,
/// `relay` a valid [`RelayUrl`]. A new field means a new version.
#[derive(Debug, Clone)]
pub struct PairingCode {
    relay: RelayUrl,
    master_key: MasterKey,
    desktop_name: String,
}

impl PairingCode {
    pub fn new(
        relay: RelayUrl,
        master_key: MasterKey,
        desktop_name: String,
    ) -> Result<Self, QrError> {
        validate_desktop_name(&desktop_name)?;
        Ok(Self {
            relay,
            master_key,
            desktop_name,
        })
    }

    pub fn relay(&self) -> &RelayUrl {
        &self.relay
    }

    pub fn master_key(&self) -> &MasterKey {
        &self.master_key
    }

    pub fn desktop_name(&self) -> &str {
        &self.desktop_name
    }

    /// The QR string. It holds the master key: show it on screen only,
    /// never write it to a file or a log (design §3.1).
    pub fn to_qr_string(&self) -> Zeroizing<String> {
        let mut out = Zeroizing::new(String::with_capacity(160));
        out.push_str(QR_PREFIX);
        out.push_str("relay=");
        out.push_str(&percent_encode(self.relay.as_str()));
        out.push_str("&mk=");
        out.push_str(&self.master_key.to_base64url());
        out.push_str("&name=");
        out.push_str(&percent_encode(&self.desktop_name));
        out
    }

    pub fn parse(input: &str) -> Result<Self, QrError> {
        if input.len() > QR_MAX_LEN {
            return Err(QrError::TooLong);
        }
        let query = input.strip_prefix(QR_PREFIX).ok_or(QrError::BadPrefix)?;
        let (mut relay, mut mk, mut name) = (None, None, None);
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').ok_or(QrError::MalformedQuery)?;
            let (slot, key) = match key {
                "relay" => (&mut relay, "relay"),
                "mk" => (&mut mk, "mk"),
                "name" => (&mut name, "name"),
                other => return Err(QrError::UnknownKey(other.to_string())),
            };
            if slot.replace(value).is_some() {
                return Err(QrError::DuplicateKey(key));
            }
        }
        let relay = relay.ok_or(QrError::MissingKey("relay"))?;
        let mk = mk.ok_or(QrError::MissingKey("mk"))?;
        let name = name.ok_or(QrError::MissingKey("name"))?;

        let relay = RelayUrl::parse(&percent_decode(relay)?).map_err(QrError::BadRelayUrl)?;
        let master_key = MasterKey::from_base64url(mk).map_err(QrError::BadMasterKey)?;
        let desktop_name = percent_decode(name)?;
        Self::new(relay, master_key, desktop_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk() -> MasterKey {
        let mut bytes = [0u8; KEY_LEN];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = i as u8;
        }
        MasterKey::from_bytes(bytes)
    }

    fn code() -> PairingCode {
        PairingCode::new(
            RelayUrl::parse("wss://relay.example.com").unwrap(),
            mk(),
            "JC 的 MacBook".into(),
        )
        .unwrap()
    }

    #[test]
    fn derived_keys_are_distinct_and_deterministic() {
        let a = mk().derive();
        let b = mk().derive();
        assert_eq!(
            a.channel_secret.expose_secret(),
            b.channel_secret.expose_secret()
        );
        assert_ne!(
            a.channel_secret.expose_secret(),
            a.noise_psk.expose_secret()
        );
        assert_ne!(a.noise_psk.expose_secret(), a.push_key.expose_secret());
        assert_ne!(a.channel_secret.expose_secret(), mk().expose_secret());
    }

    #[test]
    fn debug_never_prints_key_bytes() {
        let keys = mk().derive();
        let text = format!("{:?} {:?} {:?}", mk(), keys, code());
        assert!(text.contains("<redacted>"));
        assert!(!text.contains(&*mk().to_base64url()));
        assert!(!text.contains("[0, 1, 2"));
        let channel = format!("{:?}", keys.channel_secret.channel_key());
        assert_eq!(channel, "ChannelKey(<redacted>)");
    }

    #[test]
    fn generate_gives_fresh_keys() {
        let a = MasterKey::generate().unwrap();
        let b = MasterKey::generate().unwrap();
        assert_ne!(a.expose_secret(), b.expose_secret());
    }

    #[test]
    fn channel_header_round_trips_strictly() {
        let secret = mk().derive().channel_secret;
        let header = secret.to_header_value();
        assert_eq!(header.len(), 43);
        let back = ChannelSecret::from_header_value(&header).unwrap();
        assert_eq!(back.expose_secret(), secret.expose_secret());
        assert_eq!(
            ChannelSecret::from_header_value(&format!("{header}=")).unwrap_err(),
            KeyError::BadBase64
        );
        assert_eq!(
            ChannelSecret::from_header_value(&header[..42]).unwrap_err(),
            KeyError::BadBase64,
            "42 chars leave non-canonical trailing bits"
        );
        assert_eq!(
            ChannelSecret::from_header_value("AAAA").unwrap_err(),
            KeyError::BadLength {
                expected: 32,
                actual: 3
            }
        );
    }

    #[test]
    fn qr_round_trips() {
        let qr = code().to_qr_string();
        assert!(qr.starts_with("galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk="));
        assert!(qr.ends_with("&name=JC%20%E7%9A%84%20MacBook"));
        let back = PairingCode::parse(&qr).unwrap();
        assert_eq!(back.relay(), code().relay());
        assert_eq!(back.desktop_name(), "JC 的 MacBook");
        assert_eq!(back.master_key().expose_secret(), mk().expose_secret());
    }

    #[test]
    fn qr_accepts_any_field_order_and_lowercase_hex() {
        let mk64 = mk().to_base64url();
        let qr = format!(
            "galley-pair:1?name=Mac%e7%9a%84&mk={}&relay=wss://relay.example.com/",
            *mk64
        );
        let code = PairingCode::parse(&qr).unwrap();
        assert_eq!(code.desktop_name(), "Mac的");
        assert_eq!(code.relay().as_str(), "wss://relay.example.com");
    }

    #[test]
    fn qr_rejects_malformed_input() {
        let mk64 = mk().to_base64url();
        let good = |relay: &str, mk: &str, name: &str| {
            format!("galley-pair:1?relay={relay}&mk={mk}&name={name}")
        };
        let r = "wss%3A%2F%2Frelay.example.com";
        let cases: Vec<(String, QrError)> = vec![
            (
                good(r, &mk64, "Mac").replace("pair:1", "pair:2"),
                QrError::BadPrefix,
            ),
            (
                good(r, &mk64, "Mac").replace("galley-pair", "Galley-pair"),
                QrError::BadPrefix,
            ),
            (
                format!("{}&x=1", good(r, &mk64, "Mac")),
                QrError::UnknownKey("x".into()),
            ),
            (
                format!("{}&name=b", good(r, &mk64, "Mac")),
                QrError::DuplicateKey("name"),
            ),
            (
                format!("galley-pair:1?relay={r}&mk={}", *mk64),
                QrError::MissingKey("name"),
            ),
            (
                format!("{}&", good(r, &mk64, "Mac")),
                QrError::MalformedQuery,
            ),
            ("galley-pair:1?".to_string(), QrError::MalformedQuery),
            (good(r, &mk64, "Mac%2"), QrError::BadPercentEncoding),
            (good(r, &mk64, "Mac%zz"), QrError::BadPercentEncoding),
            (good(r, &mk64, "Mac Book"), QrError::BadPercentEncoding),
            (good(r, &mk64, "Mac+Book"), QrError::BadPercentEncoding),
            (good(r, &mk64, "%FF"), QrError::BadUtf8),
            (good(r, &mk64, "%0A"), QrError::BadDesktopName),
            (good(r, &mk64, "%20"), QrError::BadDesktopName),
            (good(r, &mk64, ""), QrError::BadDesktopName),
            (good(r, &mk64, &"a".repeat(129)), QrError::BadDesktopName),
            (
                good(r, &format!("{}=", *mk64), "Mac"),
                QrError::BadMasterKey(KeyError::BadBase64),
            ),
            (
                good(r, &mk64[..40], "Mac"),
                QrError::BadMasterKey(KeyError::BadLength {
                    expected: 32,
                    actual: 30,
                }),
            ),
            (
                good(r, &mk64.replace('A', "+"), "Mac"),
                QrError::BadMasterKey(KeyError::BadBase64),
            ),
            (
                good("http%3A%2F%2Fx.com", &mk64, "Mac"),
                QrError::BadRelayUrl(RelayUrlError::BadScheme),
            ),
            (
                good("ws%3A%2F%2Frelay.example.com", &mk64, "Mac"),
                QrError::BadRelayUrl(RelayUrlError::InsecureRemote),
            ),
            (good(r, &mk64, &"a".repeat(2048)), QrError::TooLong),
        ];
        for (input, expected) in cases {
            match PairingCode::parse(&input) {
                Ok(_) => panic!("accepted {input:?}"),
                Err(e) => assert_eq!(e, expected, "{input:?}"),
            }
        }
    }

    #[test]
    fn qr_errors_never_echo_the_key() {
        let mk64 = mk().to_base64url();
        let qr = format!(
            "galley-pair:1?relay=ws%3A%2F%2Fevil.com&mk={}&name=a",
            *mk64
        );
        let err = PairingCode::parse(&qr).unwrap_err();
        assert!(!err.to_string().contains(&*mk64));
        assert!(!format!("{err:?}").contains(&*mk64));
    }

    #[test]
    fn relay_url_rules() {
        let ok = [
            ("wss://relay.example.com", "wss://relay.example.com"),
            (
                "wss://Relay.Example.com:8443/",
                "wss://relay.example.com:8443",
            ),
            (
                "wss://relay.example.com/galley/",
                "wss://relay.example.com/galley",
            ),
            ("ws://localhost:8787", "ws://localhost:8787"),
            ("ws://127.0.0.1:8787", "ws://127.0.0.1:8787"),
            ("ws://127.1.2.3", "ws://127.1.2.3"),
            ("ws://[::1]:8787", "ws://[::1]:8787"),
            ("wss://[2001:db8::1]", "wss://[2001:db8::1]"),
        ];
        for (input, normalized) in ok {
            let url = RelayUrl::parse(input).unwrap_or_else(|e| panic!("{input}: {e}"));
            assert_eq!(url.as_str(), normalized);
        }
        assert_eq!(
            RelayUrl::parse("wss://relay.example.com/")
                .unwrap()
                .connect_url(),
            "wss://relay.example.com/v1/connect"
        );
        let bad = [
            ("https://relay.example.com", RelayUrlError::BadScheme),
            ("WSS://relay.example.com", RelayUrlError::BadScheme),
            ("ws://relay.example.com", RelayUrlError::InsecureRemote),
            ("ws://10.0.0.1", RelayUrlError::InsecureRemote),
            ("ws://localhost.evil.com", RelayUrlError::InsecureRemote),
            ("ws://[::2]", RelayUrlError::InsecureRemote),
            ("wss://user@relay.example.com", RelayUrlError::BadCharacter),
            ("wss://relay.example.com/?a=b", RelayUrlError::BadCharacter),
            ("wss://relay.example.com/#x", RelayUrlError::BadCharacter),
            ("wss://relay example.com", RelayUrlError::BadCharacter),
            ("wss://reläy.example.com", RelayUrlError::BadCharacter),
            ("wss://", RelayUrlError::BadHost),
            ("wss://relay..example.com", RelayUrlError::BadHost),
            ("wss://-relay.example.com", RelayUrlError::BadHost),
            ("wss://relay_x.example.com", RelayUrlError::BadHost),
            ("wss://[::1", RelayUrlError::BadHost),
            ("wss://[zz::1]", RelayUrlError::BadHost),
            ("wss://relay.example.com:", RelayUrlError::BadPort),
            ("wss://relay.example.com:0", RelayUrlError::BadPort),
            ("wss://relay.example.com:65536", RelayUrlError::BadPort),
            ("wss://relay.example.com:+80", RelayUrlError::BadPort),
            ("wss://relay.example.com:80:80", RelayUrlError::BadPort),
            ("wss://[::1]8080", RelayUrlError::BadPort),
            ("wss://relay.example.com//x", RelayUrlError::BadPath),
            ("wss://relay.example.com/../x", RelayUrlError::BadPath),
            ("wss://relay.example.com/a%20b", RelayUrlError::BadPath),
        ];
        for (input, expected) in bad {
            assert_eq!(RelayUrl::parse(input).unwrap_err(), expected, "{input}");
        }
        let long = format!("wss://{}.com", "a".repeat(RELAY_URL_MAX_LEN));
        assert_eq!(RelayUrl::parse(&long).unwrap_err(), RelayUrlError::TooLong);
    }
}
