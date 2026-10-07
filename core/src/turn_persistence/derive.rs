//! JavaScript-faithful port of the GUI's turn_end derivations.
//!
//! Until 2026-10-07 the assistant row was derived in TypeScript
//! (`gui/src/lib/ipc/ga-output-cleaning.ts` + `gui/src/lib/agent-turn.ts`,
//! assembled by `turnFromTurnEnd` in `gui/src/lib/ipc-handlers.ts`) and
//! handed to Core to write. Core now writes the row itself, so the same
//! derivation lives here and must produce byte-identical columns: the GUI
//! still renders live turns with the TypeScript version, and a reopened
//! session renders from what Core stored.
//!
//! Every function mirrors one TS function, step for step, with the
//! ECMAScript semantics spelled out where Rust differs:
//!
//! - `\s` / `String.prototype.trim` use the ECMAScript whitespace set
//!   ([`is_js_space`]), not Unicode `White_Space` (JS adds U+FEFF, drops
//!   U+0085).
//! - `^` / `$` under the `m` flag see four line terminators (`\n`, `\r`,
//!   U+2028, U+2029). The `regex` crate's multi-line mode knows only `\n`,
//!   so the four line-anchored patterns are matched by hand
//!   ([`replace_line_anchored`]); each matcher documents why its
//!   backtracking collapses to one deterministic scan.
//! - `JSON.stringify` orders integer-like keys first and prints numbers
//!   the JS way ([`js_json_stringify`]).
//!
//! The shared golden fixtures under `core/tests/fixtures/` pin the two
//! implementations together (vitest and cargo test read the same files).

use regex::Regex;
use serde_json::{Number, Value};
use std::sync::LazyLock;

/// ECMAScript `WhiteSpace` ∪ `LineTerminator` — the set `\s` and
/// `String.prototype.trim` use.
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// ECMAScript `LineTerminator`: what `^` / `$` (m flag) and `.` treat as
/// a line break.
fn is_js_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `String.prototype.trim`.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// The ECMAScript `\s` class in `regex` syntax.
const JS_SPACE_CLASS: &str = r"[\t\n\x0B\x0C\r \xA0\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]";

/// Compile a pattern written with JS's `\s`. Only used for patterns
/// without `^` / `$` / `.` outside `(?s)` — those carry no other
/// semantic difference from JS.
fn js_regex(pattern: &str) -> Regex {
    Regex::new(&pattern.replace(r"\s", JS_SPACE_CLASS)).expect("turn derivation regex compiles")
}

/// `GA_TAG_PATTERNS`, in the same order.
static GA_TAG_BLOCKS: LazyLock<[Regex; 6]> = LazyLock::new(|| {
    [
        js_regex(r"(?s)<thinking>.*?</thinking>"),
        js_regex(r"(?s)<summary>.*?</summary>"),
        js_regex(r"(?s)<tool_use>.*?</tool_use>"),
        js_regex(r"(?s)<file_content[^>]*>.*?</file_content>"),
        js_regex(r"(?s)<next-suggestion>.*?</next-suggestion>"),
        js_regex(r"(?s)<goal-status>.*?</goal-status>"),
    ]
});

/// `FILE_REF_PATTERN`.
static FILE_REF: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\[FILE:[^\]]+\]"));

/// `/\n{3,}/g`.
static BLANK_LINE_RUNS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\n{3,}"));

/// `TOOL_DISPATCH_VERBOSE_BLOCK`. JS without the `u` flag reads `🛠️?` as
/// "🛠, then an optional U+FE0F" — the `?` binds to the last code unit.
static TOOL_DISPATCH_VERBOSE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    js_regex("🛠\u{FE0F}?\\s+Tool:\\s+`[^`\\n]+`\\s+📥\\s+args:\\n````text\\n(?s:.)*?\\n````\\n?")
});

/// `TOOL_DISPATCH_VERBOSE_PARTIAL`.
static TOOL_DISPATCH_VERBOSE_PARTIAL: LazyLock<Regex> =
    LazyLock::new(|| js_regex("🛠\u{FE0F}?\\s+Tool:\\s+`"));

/// `extractPreamble`'s unclosed-open-tag truncation. Without the `m`
/// flag `$` is end of input in both engines, and `[\s\S]*` always runs
/// there, so only the match start matters.
static UNCLOSED_GA_TAG: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"<(?:thinking|summary|tool_use|file_content|next-suggestion|goal-status)(?:\s[^>]*)?>",
    )
});

/// `extractThinking`'s `/<thinking>([\s\S]*?)<\/thinking>/`.
static THINKING_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| js_regex(r"(?s)<thinking>(.*?)</thinking>"));

// ---------------- line-anchored (`m` flag) patterns ----------------

/// `String.prototype.replace(re, "")` for a `/^…/gm` pattern. `try_at`
/// attempts an anchored match at a line start and returns its end.
/// Scanning mirrors JS: candidates are offset 0 and every offset right
/// after a line terminator of the ORIGINAL string; after a match the
/// scan resumes at its end. Every matcher here consumes at least one
/// character, so JS's empty-match bump never comes into play.
fn replace_line_anchored(text: &str, try_at: impl Fn(&str, usize) -> Option<usize>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut pos = 0;
    loop {
        let at_line_start = pos == 0
            || text[..pos]
                .chars()
                .next_back()
                .is_some_and(is_js_line_terminator);
        if at_line_start {
            if let Some(end) = try_at(text, pos) {
                out.push_str(&text[copied..pos]);
                copied = end;
                pos = end;
                continue;
            }
        }
        match text[pos..].chars().next() {
            Some(c) => pos += c.len_utf8(),
            None => break,
        }
    }
    out.push_str(&text[copied..]);
    out
}

fn skip_while(text: &str, from: usize, pred: impl Fn(char) -> bool) -> usize {
    text[from..]
        .char_indices()
        .find(|&(_, c)| !pred(c))
        .map_or(text.len(), |(i, _)| from + i)
}

/// `\*{0,2}`, greedy.
fn skip_stars(text: &str, from: usize) -> usize {
    let mut i = from;
    for _ in 0..2 {
        if text[i..].starts_with('*') {
            i += 1;
        }
    }
    i
}

fn expect(text: &str, at: usize, literal: &str) -> Option<usize> {
    text[at..].starts_with(literal).then(|| at + literal.len())
}

/// `$` under the `m` flag.
fn at_js_line_end(text: &str, at: usize) -> bool {
    text[at..].chars().next().is_none_or(is_js_line_terminator)
}

/// End of the line `at` sits on: the next line terminator, or the end
/// of input (where JS's `.*` stops).
fn js_line_end(text: &str, at: usize) -> usize {
    text[at..]
        .find(is_js_line_terminator)
        .map_or(text.len(), |i| at + i)
}

/// `LLM_RUNNING_MARKER`:
/// `/^\s*\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}\s*$/gm`.
///
/// Every quantifier but the last `\s*` is followed by a character it
/// cannot consume itself (`*` / `L` / `)` / non-space), so the greedy
/// first choice is the only one that can succeed. The trailing `\s*`
/// backtracks until `$` holds.
fn llm_running_marker_at(text: &str, p: usize) -> Option<usize> {
    let mut i = skip_while(text, p, is_js_space);
    i = skip_stars(text, i);
    i = expect(text, i, "LLM Running (Turn ")?;
    let digits_end = skip_while(text, i, |c| c.is_ascii_digit());
    if digits_end == i {
        return None;
    }
    i = expect(text, digits_end, ") ...")?;
    i = skip_stars(text, i);
    let mut q = skip_while(text, i, is_js_space);
    loop {
        if at_js_line_end(text, q) {
            return Some(q);
        }
        if q == i {
            return None;
        }
        q -= text[..q].chars().next_back().map_or(1, char::len_utf8);
    }
}

/// `TOOL_ACTION_LINE`: `/^\[Action\] [^\n]*$/gm`. `[^\n]*` runs to the
/// next `\n` (or the end), where `$` always holds.
fn action_line_at(text: &str, p: usize) -> Option<usize> {
    let i = expect(text, p, "[Action] ")?;
    Some(text[i..].find('\n').map_or(text.len(), |k| i + k))
}

/// `PHASE_PREAMBLE`:
/// `/^\*{0,2}当前阶段\*{0,2}\s*[：:][\s\S]*?(?=\n\n|$)/gm`.
///
/// The lazy tail stops at the first offset where the lookahead holds;
/// `$` (m flag) already holds before ANY line terminator, so that is the
/// first line terminator or the end — the `\n\n` branch never matters.
fn phase_preamble_at(text: &str, p: usize) -> Option<usize> {
    let mut i = skip_stars(text, p);
    i = expect(text, i, "当前阶段")?;
    i = skip_stars(text, i);
    i = skip_while(text, i, is_js_space);
    let colon = text[i..].chars().next()?;
    if colon != '：' && colon != ':' {
        return None;
    }
    Some(js_line_end(text, i + colon.len_utf8()))
}

/// `TOOL_DISPATCH_MARKER_LINE`: `/^🛠️?\s+\w+\(.*\)[ \t]*$/gm`.
///
/// `.*` covers the rest of the line; backtracking needs a `)` followed
/// only by spaces / tabs up to the line end, so the line (after the
/// `(`) must end in `)` once trailing spaces / tabs are dropped.
fn dispatch_marker_line_at(text: &str, p: usize) -> Option<usize> {
    let mut i = expect(text, p, "🛠")?;
    if text[i..].starts_with('\u{FE0F}') {
        i += '\u{FE0F}'.len_utf8();
    }
    let spaces_end = skip_while(text, i, is_js_space);
    if spaces_end == i {
        return None;
    }
    let word_end = skip_while(text, spaces_end, |c| c.is_ascii_alphanumeric() || c == '_');
    if word_end == spaces_end {
        return None;
    }
    let args_start = expect(text, word_end, "(")?;
    let line_end = js_line_end(text, args_start);
    text[args_start..line_end]
        .trim_end_matches([' ', '\t'])
        .ends_with(')')
        .then_some(line_end)
}

fn strip_ga_tag_blocks(text: &str) -> String {
    let mut out = text.to_string();
    for re in GA_TAG_BLOCKS.iter() {
        out = re.replace_all(&out, "").into_owned();
    }
    out
}

// ---------------- the derivations ----------------

/// `cleanFinalAnswer`.
pub(crate) fn clean_final_answer(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = strip_ga_tag_blocks(text);
    out = replace_line_anchored(&out, llm_running_marker_at);
    out = replace_line_anchored(&out, action_line_at);
    out = replace_line_anchored(&out, phase_preamble_at);
    out = FILE_REF.replace_all(&out, "").into_owned();
    out = BLANK_LINE_RUNS.replace_all(&out, "\n\n").into_owned();
    js_trim(&out).to_string()
}

/// `extractPreamble`.
pub(crate) fn extract_preamble(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    let mut segment = strip_ga_tag_blocks(text);
    segment = replace_line_anchored(&segment, llm_running_marker_at);
    segment = replace_line_anchored(&segment, dispatch_marker_line_at);
    segment = TOOL_DISPATCH_VERBOSE_BLOCK
        .replace_all(&segment, "")
        .into_owned();
    if let Some(m) = TOOL_DISPATCH_VERBOSE_PARTIAL.find(&segment) {
        segment.truncate(m.start());
    }
    segment = replace_line_anchored(&segment, action_line_at);
    segment = FILE_REF.replace_all(&segment, "").into_owned();
    if let Some(m) = UNCLOSED_GA_TAG.find(&segment) {
        segment.truncate(m.start());
    }
    segment = BLANK_LINE_RUNS.replace_all(&segment, "\n\n").into_owned();
    let trimmed = js_trim(&segment);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// `extractThinking`.
pub(crate) fn extract_thinking(text: &str) -> Option<String> {
    let inner = THINKING_BLOCK.captures(text)?.get(1)?.as_str();
    let inner = js_trim(inner);
    (!inner.is_empty()).then(|| inner.to_string())
}

// ---------------- JSON.stringify ----------------

/// `JSON.stringify(value)` of the value the GUI received — i.e. what the
/// webview's JSON parse of Core's serialization would print back.
pub(crate) fn js_json_stringify(value: &Value) -> String {
    let mut out = String::new();
    write_js_json(value, &mut out);
    out
}

fn write_js_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js_number_to_string(js_number_value(n))),
        // serde_json escapes exactly what JSON.stringify escapes: `"`,
        // `\`, and C0 controls (short forms for \b \t \n \f \r, else
        // lowercase `\u00xx`).
        Value::String(s) => out.push_str(&serde_json::to_string(s).expect("string serializes")),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_js_json(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // JS property order: integer-like ("array index") keys
            // ascending, then the remaining keys in insertion order —
            // which, for the object the page parsed, is the order Core
            // serialized it in: this map's own iteration order (sorted
            // by key bytes; Core's serde_json has no `preserve_order`).
            let mut index_keys: Vec<(u32, &String, &Value)> = Vec::new();
            let mut other_keys: Vec<(&String, &Value)> = Vec::new();
            for (k, v) in map {
                match js_array_index(k) {
                    Some(n) => index_keys.push((n, k, v)),
                    None => other_keys.push((k, v)),
                }
            }
            index_keys.sort_by_key(|(n, _, _)| *n);
            out.push('{');
            let ordered = index_keys
                .into_iter()
                .map(|(_, k, v)| (k, v))
                .chain(other_keys);
            for (i, (k, v)) in ordered.enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).expect("key serializes"));
                out.push(':');
                write_js_json(v, out);
            }
            out.push('}');
        }
    }
}

/// A canonical decimal below 2³² − 1 — what JS orders as an array index.
fn js_array_index(key: &str) -> Option<u32> {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    let n: u64 = key.parse().ok()?;
    (n < u64::from(u32::MAX)).then_some(n as u32)
}

/// The double the webview parses for a JSON number (integers beyond 2⁵³
/// round to the nearest double, like JS).
fn js_number_value(n: &Number) -> f64 {
    if let Some(i) = n.as_i64() {
        i as f64
    } else if let Some(u) = n.as_u64() {
        u as f64
    } else {
        n.as_f64().unwrap_or(0.0)
    }
}

/// `Number.prototype.toString()` (ECMAScript Number::toString, radix 10).
fn js_number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".into(); // covers -0
    }
    if !x.is_finite() {
        return "null".into(); // JSON.stringify(NaN / ±Infinity)
    }
    // Shortest round-trip digits, same as JS.
    let sci = format!("{:e}", x.abs());
    let (mantissa, exponent) = sci.split_once('e').expect("LowerExp has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().expect("exponent parses") + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let e = (n - 1).abs();
        if k == 1 {
            format!("{digits}e{sign}{e}")
        } else {
            format!("{}.{}e{sign}{e}", &digits[..1], &digits[1..])
        }
    };
    if x < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_trim_uses_the_ecmascript_space_set() {
        assert_eq!(js_trim("\u{FEFF} a \u{3000}"), "a");
        // U+0085 is Unicode White_Space but not JS whitespace.
        assert_eq!(js_trim("\u{85}a\u{85}"), "\u{85}a\u{85}");
    }

    #[test]
    fn numbers_print_like_javascript() {
        let cases = [
            (30.0, "30"),
            (1.5, "1.5"),
            (-0.0, "0"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (123456789012345680000.0, "123456789012345680000"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (-2.5, "-2.5"),
            (18446744073709552000.0, "18446744073709552000"),
        ];
        for (x, want) in cases {
            assert_eq!(js_number_to_string(x), want, "{x:e}");
        }
    }

    #[test]
    fn objects_put_array_index_keys_first() {
        // Written in byte order, so the map iterates the same with or
        // without serde_json's `preserve_order` (galley-cli enables it
        // in workspace-wide builds).
        let v: Value =
            serde_json::from_str(r#"{"01":5,"10":2,"2":4,"4294967295":6,"a":3,"b":1}"#).unwrap();
        // Index keys numerically first; the rest in map order ("01" and
        // 2^32-1 are not array indices).
        assert_eq!(
            js_json_stringify(&v),
            r#"{"2":4,"10":2,"01":5,"4294967295":6,"a":3,"b":1}"#
        );
    }

    #[test]
    fn line_anchors_see_every_js_line_terminator() {
        // `^` matches after a bare `\r`; `[^\n]*` then swallows the `\r`
        // of the CRLF before `$`.
        assert_eq!(
            clean_final_answer("答案\r[Action] 写文件\r\n结尾"),
            "答案\r\n结尾"
        );
        assert_eq!(
            clean_final_answer("答案\u{2028}当前阶段：读文件\n结尾"),
            "答案\u{2028}\n结尾"
        );
    }
}
