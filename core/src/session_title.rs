//! A session's first title from its first user message (ticket 02c,
//! `.scratch/ios-client/issues/02-core-send-takeover.md`, ruling 2).
//!
//! A session is born with the default title `新对话` (`title_source =
//! 'seed'`). Its first user message replaces that with a one-line
//! truncation of the message (`derived`), which the LLM auto-title
//! ([`crate::auto_title`]) may upgrade after the first finished run.
//!
//! Until 02c the GUI derived it: on every user message it rendered —
//! including the ones CLI, Goal or the queue had persisted — it truncated
//! the text and wrote the title back with `rename_session`. A database
//! write triggered by an event broke the [`crate::notify`] rule (Core
//! writes everything durable itself), and a phone-created session would
//! have had no page to do it. Core now derives it wherever it persists a
//! user message: its own send ([`crate::session_send`]), socket
//! `session.send` and `session.new`, the queue drain, and a Goal's
//! objective row. One rule, one write ([`derive_title_if_seed`], a
//! compare-and-swap on `seed`), so it happens once.
//!
//! The truncation is the GUI's `deriveTitleFromText` to the letter, JS
//! string semantics included (UTF-16 code units, JS `\s`), pinned by
//! `core/tests/fixtures/title-derive-cases.json`; the expected values were
//! produced by running the TypeScript original.

use crate::api::{SessionBrief, SessionId};
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::notify::{notify, Notifier};
use serde::Serialize;

/// Upper bound of a derived title, in UTF-16 code units (JS `length`),
/// before the ellipsis. Sidebar rows truncate visually; this only keeps
/// prompt-sized text out of rename / search surfaces.
pub const TITLE_DERIVE_MAX: usize = 80;

/// Broadcast after a derived title lands — the same event (and payload
/// shape) every other external title change uses, so a page applies it
/// with `applyExternalSessionUpdated`.
pub const SESSION_UPDATED_EXTERNAL_EVENT: &str = "session-updated-external";

/// `via` of the broadcast.
pub const TITLE_DERIVE_VIA: &str = "title-derive";

/// Same wire shape as the socket layer's `SessionExternalPayload`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTitleDerivedPayload {
    session: SessionBrief,
    via: &'static str,
}

/// The GUI's `deriveTitleFromText`: collapse every whitespace run to one
/// space and trim; keep the result when it is at most
/// [`TITLE_DERIVE_MAX`] UTF-16 code units, otherwise cut it there and
/// append `…`. Where JS would cut a surrogate pair in half (keeping a
/// lone high surrogate, which no Rust string can hold), the half
/// character is dropped.
pub fn derive_title_from_text(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut in_space = false;
    for ch in text.chars() {
        if is_js_whitespace(ch) {
            if !in_space {
                collapsed.push(' ');
                in_space = true;
            }
        } else {
            collapsed.push(ch);
            in_space = false;
        }
    }
    let one_line = collapsed.trim_matches(' ');
    let units: usize = one_line.chars().map(char::len_utf16).sum();
    if units <= TITLE_DERIVE_MAX {
        return one_line.to_string();
    }
    let mut out = String::with_capacity(one_line.len());
    let mut used = 0;
    for ch in one_line.chars() {
        used += ch.len_utf16();
        if used > TITLE_DERIVE_MAX {
            break;
        }
        out.push(ch);
    }
    out.push('…');
    out
}

/// JS `\s` (and what `String.prototype.trim` strips): WhiteSpace —
/// TAB, VT, FF, ZWNBSP and every `Zs` — plus LineTerminator. Not Rust's
/// `char::is_whitespace`, which adds U+0085 and lacks U+FEFF.
fn is_js_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// Give a session still wearing its creation default a title from
/// `text`, the user message just persisted to it. Returns the updated
/// row, or `None` when there was nothing to do: the session already has
/// a derived, auto or user title (or is gone), or `text` is blank (an
/// images-only message). The write is a compare-and-swap on `seed`
/// ([`SqliteGalley::try_apply_derived_title`]), so concurrent senders
/// derive once. Writes only; see [`derive_and_announce`].
pub async fn derive_title_if_seed(
    galley: &SqliteGalley,
    session_id: &str,
    text: &str,
) -> Result<Option<SessionBrief>, GalleyError> {
    let title = derive_title_from_text(text);
    if title.is_empty() {
        return Ok(None);
    }
    galley
        .try_apply_derived_title(&SessionId(session_id.to_string()), &title)
        .await
}

/// [`derive_title_if_seed`], then broadcast the new title as
/// `session-updated-external` when one landed. Best effort, like the
/// auto-title: a failure is logged and the session keeps its title — the
/// message itself is already persisted, and the caller's command must
/// not fail over a title.
pub async fn derive_and_announce(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    session_id: &str,
    text: &str,
) {
    match derive_title_if_seed(galley, session_id, text).await {
        Ok(Some(session)) => announce_derived_title(notifier, session),
        Ok(None) => {}
        Err(e) => eprintln!("[title-derive {session_id}] {e}"),
    }
}

/// Broadcast a derived title (`session-updated-external`).
pub fn announce_derived_title(notifier: &dyn Notifier, session: SessionBrief) {
    notify(
        notifier,
        SESSION_UPDATED_EXTERNAL_EVENT,
        &SessionTitleDerivedPayload {
            session,
            via: TITLE_DERIVE_VIA,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_whitespace_set_differs_from_rust_where_js_does() {
        assert!(is_js_whitespace('\u{FEFF}'));
        assert!(!'\u{FEFF}'.is_whitespace());
        assert!(!is_js_whitespace('\u{0085}'));
        assert!('\u{0085}'.is_whitespace());
        // Everywhere else in the BMP the two agree.
        for cp in 0u32..=0xFFFF {
            let Some(ch) = char::from_u32(cp) else {
                continue;
            };
            if ch == '\u{FEFF}' || ch == '\u{0085}' {
                continue;
            }
            assert_eq!(is_js_whitespace(ch), ch.is_whitespace(), "U+{cp:04X}");
        }
    }
}
