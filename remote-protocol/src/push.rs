//! Push content (design §4.3): what the desktop puts in a push, sealed
//! with [`PushKey`] so the relay and APNs see only ciphertext; the phone's
//! Notification Service Extension opens it.
//!
//! - Plaintext: [`PushContent`] as JSON (`{seq, sessionId, kind, title,
//!   body}`), padded with [`crate::padding::pad_to`] to exactly
//!   [`PADDED_LEN`] bytes. One fixed size, so every push looks the same
//!   to the relay.
//! - Sealed: `nonce (12 random bytes) ‖ ChaCha20-Poly1305(push_key, nonce,
//!   plaintext, aad = "galley-push/1")`, always [`SEALED_LEN`] bytes. The
//!   AAD binds the format version: a future format changes the AAD, and an
//!   old extension fails to open it instead of misreading it.
//! - The APNs field `g` is the sealed bytes in standard base64 with
//!   padding; [`apns_payload`] builds the whole APNs JSON, which stays
//!   under APNs' 4096-byte limit by construction.
//!
//! `title` and `body` are cut to fit ([`PushContent::new`]): measured in
//! bytes after JSON escaping, cut on a character boundary, ending in `…`
//! when cut. `seq` is carried, not checked: the extension keeps the
//! highest `seq` it has shown and drops anything not above it (relay
//! replay). Core should seed its counter from wall-clock milliseconds
//! (`max(last + 1, now_ms)`) so a lost counter cannot restart below what
//! the phone has seen.

use std::fmt;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use serde::{Deserialize, Serialize};

use crate::keys::PushKey;
use crate::padding::{self, PaddingError};

/// AEAD associated data: the push format version.
pub const AAD: &[u8] = b"galley-push/1";
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
/// Padded plaintext size of every push.
pub const PADDED_LEN: usize = 2048;
/// `nonce ‖ ciphertext ‖ tag`.
pub const SEALED_LEN: usize = NONCE_LEN + PADDED_LEN + TAG_LEN;
/// APNs payload limit for alert pushes.
pub const APNS_MAX_PAYLOAD_LEN: usize = 4096;
/// `title` budget, in bytes after JSON escaping.
pub const TITLE_MAX_JSON_BYTES: usize = 256;
/// `body` budget, in bytes after JSON escaping.
pub const BODY_MAX_JSON_BYTES: usize = 1536;
/// Longest `sessionId` (printable ASCII without `"` and `\`).
pub const SESSION_ID_MAX_BYTES: usize = 128;
/// Longest `kind` (`[a-z0-9_]`).
pub const KIND_MAX_BYTES: usize = 32;
/// What the lock screen shows if the extension cannot open the push in
/// time (design §4.3).
pub const PLACEHOLDER_TITLE: &str = "Galley";
pub const PLACEHOLDER_BODY: &str = "有新消息";

/// Known `kind` values: the four "needs attention" events of PRD ruling
/// 17, decided by Core (ticket 08). Open set: an extension shows unknown
/// kinds like any other push.
pub mod kind {
    /// A turn the human started finished.
    pub const REPLY_DONE: &str = "reply_done";
    /// The agent asks the human (`ask_user`).
    pub const ASK_USER: &str = "ask_user";
    /// A Goal finished or needs the human.
    pub const GOAL: &str = "goal";
    /// A scheduled task failed to fire.
    pub const SCHEDULE_FAILED: &str = "schedule_failed";
}

/// The push plaintext.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushContent {
    /// Monotonic per desktop; see the module docs.
    pub seq: u64,
    /// Session the tap opens; `null` when there is none.
    pub session_id: Option<String>,
    /// One of [`kind`].
    pub kind: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushError {
    /// `sessionId` or `kind` breaks its rules.
    BadField(&'static str),
    /// The content does not fit [`PADDED_LEN`] (only possible when built
    /// by hand instead of with [`PushContent::new`]).
    TooLarge,
    /// The OS random source failed.
    Random,
    /// Wrong length for a sealed push.
    BadLength {
        expected: usize,
        actual: usize,
    },
    /// Not standard base64.
    BadBase64,
    /// Wrong key, tampered, or another format version.
    Decrypt,
    Padding(PaddingError),
    Json(String),
}

impl fmt::Display for PushError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PushError::BadField(field) => write!(f, "push {field} is invalid"),
            PushError::TooLarge => f.write_str("push content too large"),
            PushError::Random => f.write_str("the OS random source failed"),
            PushError::BadLength { expected, actual } => {
                write!(f, "sealed push is {actual} bytes, expected {expected}")
            }
            PushError::BadBase64 => f.write_str("push g is not base64"),
            PushError::Decrypt => f.write_str("push decryption failed"),
            PushError::Padding(e) => write!(f, "push padding: {e}"),
            PushError::Json(e) => write!(f, "push JSON: {e}"),
        }
    }
}

impl std::error::Error for PushError {}

/// Bytes `c` takes once serde_json has escaped it inside a string.
fn json_escaped_len(c: char) -> usize {
    match c {
        '"' | '\\' | '\u{08}' | '\u{0c}' | '\n' | '\r' | '\t' => 2,
        c if (c as u32) < 0x20 => 6,
        c => c.len_utf8(),
    }
}

/// Bytes `s` takes inside a JSON string.
pub fn json_escaped_len_of(s: &str) -> usize {
    s.chars().map(json_escaped_len).sum()
}

/// Cut `s` so its JSON-escaped form is at most `max` bytes, on a
/// character boundary, ending in `…` when anything was cut.
pub fn truncate_for_json(s: &str, max: usize) -> String {
    if json_escaped_len_of(s) <= max {
        return s.to_string();
    }
    let budget = max.saturating_sub('…'.len_utf8());
    let mut used = 0;
    let mut out = String::new();
    for c in s.chars() {
        let len = json_escaped_len(c);
        if used + len > budget {
            break;
        }
        used += len;
        out.push(c);
    }
    if max >= '…'.len_utf8() {
        out.push('…');
    }
    out
}

impl PushContent {
    /// Build a push, cutting `title` to [`TITLE_MAX_JSON_BYTES`] and `body`
    /// to [`BODY_MAX_JSON_BYTES`]. `session_id` must be printable ASCII
    /// without `"` or `\`, at most [`SESSION_ID_MAX_BYTES`]; `kind` is
    /// `[a-z0-9_]`, 1..=[`KIND_MAX_BYTES`]. With those rules every push
    /// fits [`PADDED_LEN`].
    pub fn new(
        seq: u64,
        session_id: Option<String>,
        kind: &str,
        title: &str,
        body: &str,
    ) -> Result<Self, PushError> {
        if let Some(id) = &session_id {
            if id.is_empty()
                || id.len() > SESSION_ID_MAX_BYTES
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
            {
                return Err(PushError::BadField("sessionId"));
            }
        }
        if kind.is_empty()
            || kind.len() > KIND_MAX_BYTES
            || !kind
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err(PushError::BadField("kind"));
        }
        Ok(Self {
            seq,
            session_id,
            kind: kind.to_string(),
            title: truncate_for_json(title, TITLE_MAX_JSON_BYTES),
            body: truncate_for_json(body, BODY_MAX_JSON_BYTES),
        })
    }

    /// The JSON padded to [`PADDED_LEN`].
    pub fn to_padded_plaintext(&self) -> Result<Vec<u8>, PushError> {
        let json = serde_json::to_vec(self).map_err(|e| PushError::Json(e.to_string()))?;
        padding::pad_to(&json, PADDED_LEN).map_err(|_| PushError::TooLarge)
    }
}

/// Seal `content` with a fresh random nonce: `nonce ‖ ciphertext`.
pub fn seal(key: &PushKey, content: &PushContent) -> Result<Vec<u8>, PushError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|_| PushError::Random)?;
    seal_inner(key, content, &nonce)
}

/// [`seal`] with a caller-chosen nonce, for golden fixtures only: reusing
/// a nonce under one key breaks ChaCha20-Poly1305.
#[cfg(feature = "test-hooks")]
pub fn seal_with_nonce_for_testing_only(
    key: &PushKey,
    content: &PushContent,
    nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, PushError> {
    seal_inner(key, content, nonce)
}

fn seal_inner(
    key: &PushKey,
    content: &PushContent,
    nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, PushError> {
    let plaintext = content.to_padded_plaintext()?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key.expose_secret()));
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: &plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| PushError::TooLarge)?;
    let mut sealed = Vec::with_capacity(SEALED_LEN);
    sealed.extend_from_slice(nonce);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

/// Open a sealed push: exact length, tag, padding, JSON (unknown fields
/// ignored).
pub fn open(key: &PushKey, sealed: &[u8]) -> Result<PushContent, PushError> {
    if sealed.len() != SEALED_LEN {
        return Err(PushError::BadLength {
            expected: SEALED_LEN,
            actual: sealed.len(),
        });
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key.expose_secret()));
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: AAD,
            },
        )
        .map_err(|_| PushError::Decrypt)?;
    let json = padding::unpad_exact(&plaintext, PADDED_LEN).map_err(PushError::Padding)?;
    serde_json::from_slice(json).map_err(|e| PushError::Json(e.to_string()))
}

/// The APNs `g` value: standard base64 with padding.
pub fn encode_g(sealed: &[u8]) -> String {
    STANDARD.encode(sealed)
}

/// Strict inverse of [`encode_g`], then [`open`].
pub fn open_g(key: &PushKey, g: &str) -> Result<PushContent, PushError> {
    let sealed = STANDARD.decode(g).map_err(|_| PushError::BadBase64)?;
    open(key, &sealed)
}

/// The full APNs JSON payload for a sealed push (design §4.3): the
/// placeholder alert, `mutable-content: 1` so the extension runs, and `g`.
/// Fails if it would exceed [`APNS_MAX_PAYLOAD_LEN`], which a sealed push
/// within [`crate::frame::MAX_PUSH_SEALED_LEN`] never does.
pub fn apns_payload(sealed: &[u8]) -> Result<String, PushError> {
    let payload = format!(
        concat!(
            r#"{{"aps":{{"alert":{{"title":"{title}","body":"{body}"}},"#,
            r#""mutable-content":1,"sound":"default"}},"g":"{g}"}}"#
        ),
        title = PLACEHOLDER_TITLE,
        body = PLACEHOLDER_BODY,
        g = encode_g(sealed),
    );
    if payload.len() > APNS_MAX_PAYLOAD_LEN {
        return Err(PushError::TooLarge);
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::MAX_PUSH_SEALED_LEN;
    use crate::keys::MasterKey;

    fn key(seed: u8) -> PushKey {
        MasterKey::from_bytes([seed; 32]).derive().push_key
    }

    #[test]
    fn seal_open_round_trip() {
        let content = PushContent::new(
            42,
            Some("ses_abc".into()),
            kind::ASK_USER,
            "标题",
            "在问你：继续吗？",
        )
        .unwrap();
        let sealed = seal(&key(1), &content).unwrap();
        assert_eq!(sealed.len(), SEALED_LEN);
        assert_eq!(open(&key(1), &sealed).unwrap(), content);
        assert_eq!(open_g(&key(1), &encode_g(&sealed)).unwrap(), content);
        let other = seal(&key(1), &content).unwrap();
        assert_ne!(
            sealed[..NONCE_LEN],
            other[..NONCE_LEN],
            "fresh nonce per push"
        );
    }

    #[test]
    fn open_rejects_wrong_key_tampering_and_bad_input() {
        let content = PushContent::new(1, None, kind::GOAL, "t", "b").unwrap();
        let sealed = seal(&key(1), &content).unwrap();
        assert_eq!(open(&key(2), &sealed), Err(PushError::Decrypt));
        for i in [0, NONCE_LEN, SEALED_LEN - 1] {
            let mut bad = sealed.clone();
            bad[i] ^= 1;
            assert_eq!(open(&key(1), &bad), Err(PushError::Decrypt), "byte {i}");
        }
        assert!(matches!(
            open(&key(1), &sealed[1..]),
            Err(PushError::BadLength { .. })
        ));
        assert_eq!(open_g(&key(1), "not base64!"), Err(PushError::BadBase64));
        // 2076 bytes encode without padding, so any `=` is non-canonical.
        let g = encode_g(&sealed);
        assert!(!g.ends_with('='));
        assert_eq!(open_g(&key(1), &format!("{g}=")), Err(PushError::BadBase64));
        assert_eq!(
            open_g(&key(1), &format!("-{}", &g[1..])),
            Err(PushError::BadBase64),
            "url-safe alphabet"
        );
        assert!(matches!(
            open_g(&key(1), &g[..g.len() - 4]),
            Err(PushError::BadLength { .. })
        ));
    }

    #[test]
    fn aad_binds_the_version() {
        let content = PushContent::new(1, None, kind::GOAL, "t", "b").unwrap();
        let plaintext = content.to_padded_plaintext().unwrap();
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key(1).expose_secret()));
        let nonce = [7u8; NONCE_LEN];
        let ct = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: b"galley-push/2",
                },
            )
            .unwrap();
        let mut sealed = nonce.to_vec();
        sealed.extend_from_slice(&ct);
        assert_eq!(open(&key(1), &sealed), Err(PushError::Decrypt));
    }

    #[test]
    fn fields_are_validated() {
        for id in ["", "a\"b", "a\\b", "a b", "é"] {
            assert_eq!(
                PushContent::new(1, Some(id.into()), kind::GOAL, "", "").unwrap_err(),
                PushError::BadField("sessionId"),
                "{id:?}"
            );
        }
        assert!(PushContent::new(1, Some("x".repeat(129)), kind::GOAL, "", "").is_err());
        for k in ["", "Goal", "goal-x", &"k".repeat(33)] {
            assert_eq!(
                PushContent::new(1, None, k, "", "").unwrap_err(),
                PushError::BadField("kind"),
                "{k:?}"
            );
        }
    }

    #[test]
    fn truncation_is_char_safe_and_escape_aware() {
        assert_eq!(truncate_for_json("short", 10), "short");
        assert_eq!(truncate_for_json("abcdefghij", 10), "abcdefghij");
        assert_eq!(truncate_for_json("abcdefghijk", 10), "abcdefg…");
        // 3-byte characters: 10 - 3 = 7 bytes of budget holds two of them.
        assert_eq!(truncate_for_json("一二三四", 10), "一二…");
        // A quote costs 2 escaped bytes, a control character 6.
        assert_eq!(truncate_for_json("\"\"\"\"\"\"", 10), "\"\"\"…");
        assert_eq!(truncate_for_json("\u{1}\u{1}", 10), "\u{1}…");
        for s in [
            "😀".repeat(500),
            "\u{1}".repeat(500),
            "\"".repeat(900),
            "a".repeat(5000),
        ] {
            let cut = truncate_for_json(&s, BODY_MAX_JSON_BYTES);
            assert!(json_escaped_len_of(&cut) <= BODY_MAX_JSON_BYTES);
            assert!(cut.ends_with('…'));
            let json = serde_json::to_string(&cut).unwrap();
            assert_eq!(
                json.len(),
                json_escaped_len_of(&cut) + 2,
                "escape model matches serde_json"
            );
        }
    }

    #[test]
    fn worst_case_push_fits_apns() {
        // Longest legal session id and kind, max seq, and title / body made
        // of the characters that expand most under JSON escaping.
        let session_id = "z".repeat(SESSION_ID_MAX_BYTES);
        let kind = "k".repeat(KIND_MAX_BYTES);
        for filler in ["\u{1}", "\"", "😀", "一", "a"] {
            let content = PushContent::new(
                u64::MAX,
                Some(session_id.clone()),
                &kind,
                &filler.repeat(5000),
                &filler.repeat(50_000),
            )
            .unwrap();
            let json = serde_json::to_vec(&content).unwrap();
            assert!(
                json.len() <= PADDED_LEN - padding::LEN_PREFIX,
                "{filler:?}: {}",
                json.len()
            );
            let sealed = seal(&key(1), &content).unwrap();
            let payload = apns_payload(&sealed).unwrap();
            assert!(payload.len() <= APNS_MAX_PAYLOAD_LEN);
            assert_eq!(open(&key(1), &sealed).unwrap(), content);
        }
    }

    #[test]
    fn largest_frame_sealed_push_still_fits_apns() {
        let payload = apns_payload(&vec![0u8; MAX_PUSH_SEALED_LEN]).unwrap();
        assert!(payload.len() <= APNS_MAX_PAYLOAD_LEN);
        // A real push is far below the limit.
        assert_eq!(apns_payload(&vec![0u8; SEALED_LEN]).unwrap().len(), 2871);
        assert_eq!(
            apns_payload(&vec![0u8; MAX_PUSH_SEALED_LEN + 1]),
            Err(PushError::TooLarge)
        );
    }

    #[test]
    fn hand_built_oversized_content_is_refused() {
        let content = PushContent {
            seq: 1,
            session_id: None,
            kind: "goal".into(),
            title: String::new(),
            body: "a".repeat(PADDED_LEN),
        };
        assert_eq!(seal(&key(1), &content), Err(PushError::TooLarge));
    }
}
