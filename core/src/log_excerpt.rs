//! Error text fit for a log line (main chat ticket 122): what can carry a
//! credential is masked ([`scrub`]), whitespace runs become one space,
//! and the rest is cut to a length ([`log_excerpt`]). Core's own logs
//! (stderr, the morning review's log) quote errors from the runner, the
//! engine and the token endpoint; none of them may quote a token.
//!
//! The rules match the runner's (`runner/ga_print_forward.py`
//! `scrub_log_text`, which scrubs the GA lines it forwards): URL query
//! strings and user info, `Bearer` / `Basic` values, `key=value` pairs
//! whose key names a credential, and strings shaped like one (an
//! `sk-` key, a JWT, a Google API key, any other run of 40+ token
//! characters mixing letters and digits). Hosts and paths stay: they say
//! which endpoint failed, and these logs stay on this machine.

use std::sync::OnceLock;

use regex::{Captures, Regex};

const REDACTED: &str = "[redacted]";

struct Rules {
    userinfo: Regex,
    query: Regex,
    auth_scheme: Regex,
    key_value: Regex,
    key_shape: Regex,
    long_run: Regex,
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| {
        let re = |pattern: &str| Regex::new(pattern).expect("log_excerpt pattern");
        Rules {
            // `scheme://user:password@host`.
            userinfo: re(r"(?i)\b([a-z][a-z0-9+.\-]*://)[^\s/@:]+:[^\s/@]+@"),
            // `?a=b&c=d`, in a URL or after a bare path.
            query: re(r#"\?[^\s'"<>()\[\]{}]*=[^\s'"<>()\[\]{}]*"#),
            // `Bearer …` / `Basic …`, as in an Authorization header.
            auth_scheme: re(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=\-]{8,}"),
            // `api_key=…`, `"access_token": "…"`, `password: …`.
            key_value: re(concat!(
                r"(?i)\b(api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|id[_-]?token",
                r"|client[_-]?secret|secret|password|passwd|token)",
                r#"(["']?\s*[:=]\s*["']?)[^\s"',;&}]+"#,
            )),
            key_shape: re(concat!(
                r"\bsk-[A-Za-z0-9_\-]{16,}",
                r"|\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*",
                r"|\bAIza[0-9A-Za-z_\-]{20,}",
            )),
            long_run: re(r"[A-Za-z0-9_\-]{40,}"),
        }
    })
}

/// `text` with every part that can carry a credential masked as
/// `[redacted]` (see the module doc for the rules).
pub(crate) fn scrub(text: &str) -> String {
    let r = rules();
    let text = r.userinfo.replace_all(text, format!("${{1}}{REDACTED}@"));
    let text = r.query.replace_all(&text, format!("?{REDACTED}"));
    let text = r
        .auth_scheme
        .replace_all(&text, format!("${{1}} {REDACTED}"));
    let text = r
        .key_value
        .replace_all(&text, format!("${{1}}${{2}}{REDACTED}"));
    let text = r.key_shape.replace_all(&text, REDACTED);
    r.long_run
        .replace_all(&text, |c: &Captures<'_>| {
            let run = &c[0];
            if run.chars().any(|ch| ch.is_ascii_digit())
                && run.chars().any(|ch| ch.is_ascii_alphabetic())
            {
                REDACTED.to_string()
            } else {
                run.to_string()
            }
        })
        .into_owned()
}

/// [`scrub`]bed `text` on one line, at most `max_chars` characters (the
/// last one `…` when cut).
pub(crate) fn log_excerpt(text: &str, max_chars: usize) -> String {
    let line = scrub(text).split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= max_chars {
        return line;
    }
    let kept: String = line.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{kept}…")
}

#[cfg(test)]
mod tests {
    use super::{log_excerpt, scrub};

    #[test]
    fn scrub_masks_what_can_carry_a_credential() {
        // The runner's `test_scrub_log_text` cases, and a query after a bare path.
        let cases = [
            (
                "https://user:hunter2@relay.example/v1?api_key=sk-x&model=y",
                "https://[redacted]@relay.example/v1?[redacted]",
            ),
            (
                "Authorization: Bearer eyJhbGciOi.payloadpart.sig",
                "Authorization: Bearer [redacted]",
            ),
            (
                r#"{"access_token": "abc123xyz"}"#,
                r#"{"access_token": "[redacted]"}"#,
            ),
            ("api-key=k3y-value; next", "api-key=[redacted]; next"),
            (
                "key sk-ant-api03-FAKEFAKEFAKEFAKE in text",
                "key [redacted] in text",
            ),
            (
                "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl end",
                "jwt [redacted] end",
            ),
            (
                "run 0123456789abcdef0123456789abcdef01234567 end",
                "run [redacted] end",
            ),
            (
                "Max retries exceeded with url: /v1/chat?key=AIzaFAKEFAKEFAKEFAKEFAKE1234 (x)",
                "Max retries exceeded with url: /v1/chat?[redacted] (x)",
            ),
        ];
        for (raw, scrubbed) in cases {
            assert_eq!(scrub(raw), scrubbed, "{raw}");
        }
    }

    #[test]
    fn scrub_keeps_ordinary_error_text() {
        for text in [
            "max_tokens=4096, HTTP 503, retry in 3.0s (1/4) @ llmcore.py:657",
            "RuntimeError: Galley Codex credential refresh failed: credential IPC rejected \
             request (invalid_args: chatgpt_plan_reauth_required: sign in again)",
            "HTTPSConnectionPool(host='relay.example', port=443): Read timed out.",
            "_galley_codex_access_token_and_a_long_identifier",
            "credential IPC response missing accessToken",
            "巡看失败：取令牌超时",
        ] {
            assert_eq!(scrub(text), text);
        }
    }

    #[test]
    fn log_excerpt_is_one_line_and_cut_to_length() {
        assert_eq!(
            log_excerpt("RuntimeError: x\n  @ llmcore.py:657\r\n\tdone ", 100),
            "RuntimeError: x @ llmcore.py:657 done"
        );
        let cut = log_excerpt(&"错".repeat(50), 10);
        assert_eq!(cut.chars().count(), 10);
        assert!(cut.ends_with('…'));
        assert_eq!(log_excerpt("token=abcdefgh", 100), "token=[redacted]");
    }
}
