//! The mining output as entries (ticket 04): `activities.md` read in the
//! format the mining task pins ([`super::batch::task_prompt`]), one entry
//! deleted, one emotion of an entry deleted.
//!
//! ```text
//! # 活动知识层
//!
//! ## 持续活动
//!
//! ### A001｜标题
//! - 现状：一句话
//! - 最近：2026-09-27
//! - 会话：`s-1`、`im-feishu-…`
//! - 原文（`s-1`，2026-09-27 07:00）：“……”
//! - 情绪（`s-1`，2026-09-10 15:40）：焦急、不安——“……”
//!
//! ## 已消失事项
//! ### A002｜标题
//! ```
//!
//! **The block rule.** An entry is its heading line — `A\d+｜title` at
//! level 3 or deeper under a level-2 `持续活动` / `已消失事项` section —
//! and every line after it up to the next heading of the same or a
//! higher level (or the end of the file). The page shows exactly those
//! blocks, and a delete removes exactly one of them — its emotion lines
//! with it — every other byte of the file untouched.
//!
//! **Emotions live in their affair** (ticket 04d, PRD ruling 48). An
//! `- 情绪（…）：标签——“原话”` item inside a block is one [`EntryEmotion`].
//! There is no emotions file: the model records an emotion only under
//! the affair it belongs to. Each emotion keeps its lines verbatim
//! ([`EntryEmotion::line`]), and deleting one names that text
//! ([`remove_emotion`]) rather than a position a run could have shifted.
//!
//! **Nothing is dropped.** Inside an entry, `- 键：值` lines go to their
//! field by key; any other line (an unknown key, an emotion line that
//! does not read, a paragraph, a sub-heading) is kept in `extra`, bullet
//! marker removed. Outside the entries, every line that is not a
//! document title (`#`) or a known section heading goes to `other`,
//! verbatim, in file order — the model was told not to write such
//! paragraphs, and if it does the user still sees them. A file that has
//! content but not one recognisable entry is [`Parsed::Raw`]: the page
//! shows it read-only.

use std::fs;
use std::io;
use std::ops::Range;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// One `原文` line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerQuote {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    /// `YYYY-MM-DD HH:MM` as written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    pub text: String,
}

/// One `情绪` line of an entry: an emotional moment of this affair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryEmotion {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    /// `YYYY-MM-DD HH:MM` as written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    pub tags: Vec<String>,
    /// The user's words.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The item as the file has it — bullet, continuation lines joined
    /// with `\n`, no line ending: what `delete_ledger_emotion` names.
    pub line: String,
}

/// One ongoing or ended affair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub title: String,
    /// The `现状` line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// The `最近` line's date, `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<String>,
    pub sessions: Vec<String>,
    pub quotes: Vec<LedgerQuote>,
    /// Its emotion lines, in file order.
    pub emotions: Vec<EntryEmotion>,
    /// Every other line of the entry, bullet marker removed.
    pub extra: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activities {
    pub ongoing: Vec<LedgerEntry>,
    pub ended: Vec<LedgerEntry>,
    /// What was not recognised, verbatim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other: Option<String>,
}

/// The output file as the page gets it: `{"kind": "absent"}`,
/// `{"kind": "parsed", …}` or `{"kind": "raw", "text": …}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Parsed<T> {
    Absent,
    Parsed(T),
    Raw { text: String },
}

// ---------------- layout: the block rule ----------------

static ENTRY_HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(A\d+)\s*[｜|]\s*(.+)$").expect("entry heading regex"));
static DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{4}-\d{2}-\d{2}").expect("date regex"));
static TICKED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`([^`]+)`").expect("tick regex"));

/// `A<digits>`: the id of an entry.
pub fn is_entry_id(id: &str) -> bool {
    id.strip_prefix('A')
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Ongoing,
    Ended,
}

struct Line<'a> {
    start: usize,
    end: usize,
    /// Without its line ending (`\n` or `\r\n`).
    text: &'a str,
}

fn split_lines(text: &str) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let end = text[start..]
            .find('\n')
            .map_or(text.len(), |i| start + i + 1);
        let raw = &text[start..end];
        let raw = raw.strip_suffix('\n').unwrap_or(raw);
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        lines.push(Line {
            start,
            end,
            text: raw,
        });
        start = end;
    }
    lines
}

/// `(level, title)` of a Markdown ATX heading starting at column 0.
fn heading(line: &str) -> Option<(usize, &str)> {
    let level = line.bytes().take_while(|b| *b == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = &line[level..];
    if !(rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t')) {
        return None;
    }
    Some((level, rest.trim().trim_end_matches('#').trim_end()))
}

fn entry_heading(title: &str) -> Option<(String, String)> {
    let caps = ENTRY_HEADING.captures(title)?;
    Some((caps[1].to_string(), caps[2].trim().to_string()))
}

fn section_of(title: &str) -> Option<Section> {
    if title.starts_with("持续活动") {
        Some(Section::Ongoing)
    } else if title.starts_with("已消失事项") {
        Some(Section::Ended)
    } else {
        None
    }
}

struct Block {
    id: String,
    title: String,
    section: Option<Section>,
    /// Line indices: the heading, then the body up to `lines.end`.
    lines: Range<usize>,
}

struct Layout<'a> {
    lines: Vec<Line<'a>>,
    blocks: Vec<Block>,
    /// Lines that are structure, not content: titles, section headings
    /// and every line of an entry.
    claimed: Vec<bool>,
}

impl Layout<'_> {
    /// Bytes of lines `range` (indices into `lines`), line endings
    /// included.
    fn byte_range(&self, range: Range<usize>) -> Range<usize> {
        self.lines[range.start].start..self.lines[range.end - 1].end
    }

    fn body(&self, block: &Block) -> &[Line<'_>] {
        &self.lines[block.lines.start + 1..block.lines.end]
    }
}

fn layout(text: &str) -> Layout<'_> {
    let lines = split_lines(text);
    let mut claimed = vec![false; lines.len()];
    let mut blocks = Vec::new();
    let mut section: Option<Section> = None;
    let mut i = 0;
    while i < lines.len() {
        let Some((level, title)) = heading(lines[i].text) else {
            i += 1;
            continue;
        };
        if level == 1 {
            claimed[i] = true;
            i += 1;
            continue;
        }
        if level == 2 {
            section = section_of(title);
            claimed[i] = section.is_some();
            i += 1;
            continue;
        }
        if section.is_some() {
            if let Some((id, entry_title)) = entry_heading(title) {
                let end = (i + 1..lines.len())
                    .find(|&j| heading(lines[j].text).is_some_and(|(l, _)| l <= level))
                    .unwrap_or(lines.len());
                claimed[i..end].iter_mut().for_each(|c| *c = true);
                blocks.push(Block {
                    id,
                    title: entry_title,
                    section,
                    lines: i..end,
                });
                i = end;
                continue;
            }
        }
        i += 1;
    }
    Layout {
        lines,
        blocks,
        claimed,
    }
}

/// Unclaimed lines, verbatim, runs separated by a blank line; `None`
/// when there are none.
fn other_text(layout: &Layout<'_>) -> Option<String> {
    let mut runs: Vec<Vec<&str>> = Vec::new();
    let mut open = false;
    for (line, claimed) in layout.lines.iter().zip(&layout.claimed) {
        if *claimed {
            open = false;
            continue;
        }
        if line.text.trim().is_empty() {
            if open {
                runs.last_mut().expect("open run").push(line.text);
            }
            continue;
        }
        if !open {
            runs.push(Vec::new());
            open = true;
        }
        runs.last_mut().expect("open run").push(line.text);
    }
    let text = runs
        .into_iter()
        .map(|run| run.join("\n").trim_matches('\n').trim_end().to_string())
        .filter(|run| !run.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.is_empty()).then_some(text)
}

// ---------------- entry bodies ----------------

enum Piece {
    /// A top-level `- ` item, marker removed, continuation lines joined.
    Item(String),
    /// Any other line, trimmed.
    Loose(String),
}

/// The body's pieces, each with the lines (indices into `lines`) it was
/// read from.
fn pieces(lines: &[Line<'_>]) -> Vec<(Piece, Range<usize>)> {
    let mut out: Vec<(Piece, Range<usize>)> = Vec::new();
    let mut item_open = false;
    for (index, line) in lines.iter().enumerate() {
        let text = line.text;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            item_open = false;
            continue;
        }
        if heading(text).is_some() {
            item_open = false;
            out.push((Piece::Loose(trimmed.to_string()), index..index + 1));
            continue;
        }
        let indent = text.len() - text.trim_start().len();
        let bullet = ["- ", "* ", "+ "]
            .iter()
            .find_map(|m| trimmed.strip_prefix(m))
            .or(match trimmed {
                "-" | "*" | "+" => Some(""),
                _ => None,
            });
        match bullet {
            Some(content) if indent < 2 => {
                out.push((Piece::Item(content.trim().to_string()), index..index + 1));
                item_open = true;
            }
            _ if item_open => {
                if let Some((Piece::Item(item), range)) = out.last_mut() {
                    item.push('\n');
                    item.push_str(trimmed);
                    range.end = index + 1;
                }
            }
            _ => out.push((Piece::Loose(trimmed.to_string()), index..index + 1)),
        }
    }
    out
}

/// `(key, value)` of a `键：值` item: the key is what precedes the first
/// full-width colon (a half-width one when there is none), short and
/// plain.
fn key_value(item: &str) -> Option<(&str, &str)> {
    let (key, value) = item.split_once('：').or_else(|| item.split_once(':'))?;
    let key = key.trim();
    let plain =
        !key.is_empty() && key.chars().count() <= 16 && !key.contains(['`', '“', '"', '\n']);
    plain.then_some((key, value.trim()))
}

fn unquote(value: &str) -> String {
    let v = value.trim();
    let v = v.strip_suffix('。').unwrap_or(v).trim_end();
    for (open, close) in [('“', '”'), ('"', '"'), ('「', '」'), ('『', '』')] {
        if let Some(inner) = v.strip_prefix(open).and_then(|s| s.strip_suffix(close)) {
            return inner.to_string();
        }
    }
    value.trim().to_string()
}

/// A `键（`会话`，时间）：值` item taken apart.
struct Keyed<'a> {
    key: &'a str,
    session: Option<String>,
    at: Option<String>,
    value: &'a str,
}

/// The key (what precedes the first parenthesis or colon), the
/// parenthesis' session and time (either optional, the parenthesis
/// too), and the value after the colon. `None` without the colon.
fn keyed(item: &str) -> Option<Keyed<'_>> {
    let key_end = item.find(['（', '(', '：', ':'])?;
    let key = item[..key_end].trim();
    let mut rest = &item[key_end..];
    let (mut session, mut at) = (None, None);
    if let Some(open) = ['（', '(']
        .iter()
        .find(|c| rest.starts_with(**c))
        .map(|c| c.len_utf8())
    {
        let close = rest.find(['）', ')'])?;
        let inner = &rest[open..close];
        for part in inner.split(['，', ',', '、', '；', ';']) {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            if let Some(caps) = TICKED.captures(part) {
                session.get_or_insert_with(|| caps[1].trim().to_string());
            } else if DATE.is_match(part) && part.starts_with(|c: char| c.is_ascii_digit()) {
                at.get_or_insert_with(|| part.to_string());
            } else {
                session.get_or_insert_with(|| part.to_string());
            }
        }
        let close_len = rest[close..].chars().next().map_or(1, char::len_utf8);
        rest = &rest[close + close_len..];
    }
    let rest = rest.trim_start();
    let value = rest.strip_prefix('：').or_else(|| rest.strip_prefix(':'))?;
    Some(Keyed {
        key,
        session,
        at,
        value,
    })
}

/// A `原文（`会话`，时间）：“…”` item (`关键原文` and the like count
/// too).
fn quote(item: &str) -> Option<LedgerQuote> {
    let k = keyed(item)?;
    if !(k.key.starts_with("原文") || k.key.ends_with("原文")) || k.key.chars().count() > 8 {
        return None;
    }
    Some(LedgerQuote {
        session: k.session,
        at: k.at,
        text: unquote(k.value),
    })
}

/// A `情绪（`会话`，时间）：标签——“原话”` item. The parenthesis, the dash
/// and the words are each optional; without a dash the words start at
/// the first quotation mark. `None` (so the line goes to `extra`) when
/// the key is not `情绪…` or nothing follows the colon.
fn emotion(item: &str, line: String) -> Option<EntryEmotion> {
    let k = keyed(item)?;
    if !k.key.starts_with("情绪") || k.key.chars().count() > 4 {
        return None;
    }
    let value = k.value.trim();
    if value.is_empty() {
        return None;
    }
    let dash = ["——", "—", "--"]
        .iter()
        .filter_map(|d| value.find(d).map(|at| (at, d.len())))
        .min_by_key(|(at, _)| *at);
    let quote_mark = value.find(['“', '"', '「', '『']);
    let (tags, words) = match (dash, quote_mark) {
        (Some((at, len)), q) if q.is_none_or(|q| at < q) => (&value[..at], &value[at + len..]),
        (_, Some(q)) => (&value[..q], &value[q..]),
        _ => (value, ""),
    };
    let words = unquote(words);
    Some(EntryEmotion {
        session: k.session,
        at: k.at,
        tags: split_list(tags),
        text: (!words.is_empty()).then_some(words),
        line,
    })
}

fn sessions_in(value: &str) -> Vec<String> {
    let ticked: Vec<String> = TICKED
        .captures_iter(value)
        .map(|c| c[1].trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if !ticked.is_empty() {
        return ticked;
    }
    split_list(value)
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split(['、', '，', ',', '；', ';', '/', '／'])
        .map(|s| s.trim().trim_end_matches('。').trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn push_unique(into: &mut Vec<String>, items: Vec<String>) {
    for item in items {
        if !into.contains(&item) {
            into.push(item);
        }
    }
}

/// The item's lines as the file has them.
fn raw_lines(lines: &[Line<'_>], range: Range<usize>) -> String {
    lines[range]
        .iter()
        .map(|l| l.text)
        .collect::<Vec<_>>()
        .join("\n")
}

fn activity_entry(layout: &Layout<'_>, block: &Block) -> LedgerEntry {
    let mut entry = LedgerEntry {
        id: block.id.clone(),
        title: block.title.clone(),
        status: None,
        last_seen: None,
        sessions: Vec::new(),
        quotes: Vec::new(),
        emotions: Vec::new(),
        extra: Vec::new(),
    };
    let body = layout.body(block);
    for (piece, range) in pieces(body) {
        let item = match piece {
            Piece::Loose(text) => {
                entry.extra.push(text);
                continue;
            }
            Piece::Item(item) => item,
        };
        if let Some(q) = quote(&item) {
            entry.quotes.push(q);
            continue;
        }
        if let Some(e) = emotion(&item, raw_lines(body, range)) {
            entry.emotions.push(e);
            continue;
        }
        match key_value(&item) {
            Some(("现状", value)) if entry.status.is_none() && !value.is_empty() => {
                entry.status = Some(value.to_string());
            }
            Some(("最近", value)) if entry.last_seen.is_none() && DATE.is_match(value) => {
                entry.last_seen = DATE.find(value).map(|m| m.as_str().to_string());
            }
            Some(("会话", value)) => push_unique(&mut entry.sessions, sessions_in(value)),
            _ => entry.extra.push(item),
        }
    }
    entry
}

// ---------------- parse ----------------

pub fn parse_activities(text: &str) -> Parsed<Activities> {
    let layout = layout(text);
    let other = other_text(&layout);
    if layout.blocks.is_empty() && other.is_some() {
        return Parsed::Raw {
            text: text.to_string(),
        };
    }
    let (mut ongoing, mut ended) = (Vec::new(), Vec::new());
    for block in &layout.blocks {
        let entry = activity_entry(&layout, block);
        match block.section {
            Some(Section::Ended) => ended.push(entry),
            _ => ongoing.push(entry),
        }
    }
    Parsed::Parsed(Activities {
        ongoing,
        ended,
        other,
    })
}

fn read_text(path: &Path) -> Option<String> {
    match fs::read(path) {
        Ok(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => {
            eprintln!("[ledger] reading {} failed: {e}", path.display());
            None
        }
    }
}

/// `activities.md` as the page shows it; a missing (or unreadable) file
/// is [`Parsed::Absent`].
pub fn read_activities(path: &Path) -> Parsed<Activities> {
    read_text(path).map_or(Parsed::Absent, |t| parse_activities(&t))
}

// ---------------- delete ----------------

/// Remove every block of entry `id` from `text` — the same blocks
/// [`parse_activities`] shows, emotion lines and all — leaving every
/// other byte as it was. `None` when the file has no such entry.
pub fn remove_entry(text: &str, id: &str) -> Option<String> {
    if !is_entry_id(id) {
        return None;
    }
    let layout = layout(text);
    let ranges: Vec<Range<usize>> = layout
        .blocks
        .iter()
        .filter(|b| b.id == id)
        .map(|b| layout.byte_range(b.lines.clone()))
        .collect();
    if ranges.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for range in ranges {
        out.push_str(&text[at..range.start]);
        at = range.end;
    }
    out.push_str(&text[at..]);
    Some(out)
}

/// Remove one emotion of entry `id`: the first of its emotion items
/// whose lines read exactly `line` ([`EntryEmotion::line`]), continuation
/// lines and all, every other byte as it was. `None` when the entry has
/// no such emotion — gone already, or rewritten by a run since the page
/// read it.
pub fn remove_emotion(text: &str, id: &str, line: &str) -> Option<String> {
    if !is_entry_id(id) {
        return None;
    }
    let layout = layout(text);
    let found = layout.blocks.iter().filter(|b| b.id == id).find_map(|b| {
        let body = layout.body(b);
        pieces(body).into_iter().find_map(|(piece, range)| {
            let Piece::Item(item) = piece else {
                return None;
            };
            let raw = raw_lines(body, range.clone());
            (raw == line && emotion(&item, raw).is_some()).then(|| {
                let first = b.lines.start + 1;
                layout.byte_range(first + range.start..first + range.end)
            })
        })
    })?;
    Some(format!("{}{}", &text[..found.start], &text[found.end..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED_ACTIVITIES: &str = "# 活动知识层

## 持续活动

### A001｜杭州半程马拉松备赛
- 现状：9 月 27 日长距离 18 公里，离半马还有八周。
- 最近：2026-09-27
- 会话：`s-0907-run`、`im-feishu-2026-09-21`
- 频次：4 会话 / 5 消息
- 原文（`s-0927-run`，2026-09-27 07:00）：“今天长距离 18 公里，配速 6 分 15，比计划快。”
- 原文（`im-feishu-2026-09-21`，2026-09-21 08:15）：“早上跑了 10 公里轻松跑，
  膝盖没再酸了。”
- 情绪（`s-0920-run`，2026-09-20 07:30）：担心——“最后两公里膝盖外侧有点酸，是不是跑姿有问题？”

### A003｜日语 N3 备考
- 现状：这周进度落后，下周补两课。
- 最近：2026-09-27
- 会话：`s-0911-japanese`

## 已消失事项

### A002｜中秋活动页设计与上线
- 现状：9 月 16 日上线，首日点击率 4.2%。
- 最近：2026-09-16
- 会话：`s-0916-page`
- 原文（`s-0916-page`，2026-09-16 10:30）：“这个项目总算结束了。”
- 情绪（`s-0916-page`，2026-09-16 10:30）：如释重负——“这个项目总算结束了。”
";

    fn activities(text: &str) -> Activities {
        match parse_activities(text) {
            Parsed::Parsed(a) => a,
            other => panic!("not parsed: {other:?}"),
        }
    }

    /// One entry under `## 持续活动` with `body` as its lines.
    fn one(body: &str) -> LedgerEntry {
        let mut a = activities(&format!("## 持续活动\n### A001｜甲\n{body}"));
        assert_eq!(a.ongoing.len(), 1);
        a.ongoing.remove(0)
    }

    #[test]
    fn the_pinned_format_is_read_whole() {
        let a = activities(PINNED_ACTIVITIES);
        assert_eq!(a.other, None);
        assert_eq!(
            a.ongoing.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["A001", "A003"]
        );
        assert_eq!(a.ended.len(), 1);
        let run = &a.ongoing[0];
        assert_eq!(run.title, "杭州半程马拉松备赛");
        assert_eq!(
            run.status.as_deref(),
            Some("9 月 27 日长距离 18 公里，离半马还有八周。")
        );
        assert_eq!(run.last_seen.as_deref(), Some("2026-09-27"));
        assert_eq!(run.sessions, ["s-0907-run", "im-feishu-2026-09-21"]);
        assert_eq!(run.extra, ["频次：4 会话 / 5 消息"]);
        assert_eq!(
            run.quotes[0],
            LedgerQuote {
                session: Some("s-0927-run".into()),
                at: Some("2026-09-27 07:00".into()),
                text: "今天长距离 18 公里，配速 6 分 15，比计划快。".into(),
            }
        );
        // A continuation line stays with its item.
        assert_eq!(
            run.quotes[1].text,
            "早上跑了 10 公里轻松跑，\n膝盖没再酸了。"
        );
        assert_eq!(
            run.emotions,
            [EntryEmotion {
                session: Some("s-0920-run".into()),
                at: Some("2026-09-20 07:30".into()),
                tags: vec!["担心".into()],
                text: Some("最后两公里膝盖外侧有点酸，是不是跑姿有问题？".into()),
                line: "- 情绪（`s-0920-run`，2026-09-20 07:30）：担心——“最后两公里膝盖外侧有点酸，是不是跑姿有问题？”".into(),
            }]
        );
        assert!(a.ongoing[1].emotions.is_empty());
        assert_eq!(a.ended[0].id, "A002");
        assert_eq!(a.ended[0].quotes.len(), 1);
        assert_eq!(a.ended[0].emotions[0].tags, ["如释重负"]);
    }

    #[test]
    fn emotion_lines_read_with_or_without_their_optional_parts() {
        let e = one(concat!(
            "- 情绪：焦急、不安——“手术还没出来”\n",
            "- 情绪（2026-09-10 15:40）：焦急 “手术还没出来——已经三个多小时了”\n",
            "- 情绪事件（`s-1`）：愤怒、不满\n",
            "- 情绪（`s-2`，2026-09-18 20:30）：“气死了”\n",
        ))
        .emotions;
        assert_eq!(e.len(), 4);
        assert_eq!(
            (e[0].tags.as_slice(), e[0].session.as_deref()),
            (&["焦急".to_string(), "不安".to_string()][..], None)
        );
        assert_eq!(e[0].text.as_deref(), Some("手术还没出来"));
        // A dash inside the words does not split them: the quotation
        // mark comes first.
        assert_eq!(e[1].tags, ["焦急"]);
        assert_eq!(e[1].text.as_deref(), Some("手术还没出来——已经三个多小时了"));
        assert_eq!(e[1].at.as_deref(), Some("2026-09-10 15:40"));
        assert_eq!(e[2].tags, ["愤怒", "不满"]);
        assert_eq!(e[2].text, None);
        assert_eq!(e[2].session.as_deref(), Some("s-1"));
        assert!(e[3].tags.is_empty());
        assert_eq!(e[3].text.as_deref(), Some("气死了"));
    }

    #[test]
    fn an_emotion_line_that_does_not_read_is_kept_in_extra() {
        let entry = one(concat!(
            "- 情绪：\n",
            "- 情绪（`s-1`：焦急\n",
            "- 心情：不错\n",
            "- 情绪焦急，原文见上\n",
        ));
        assert!(entry.emotions.is_empty());
        assert_eq!(
            entry.extra,
            [
                "情绪：",
                "情绪（`s-1`：焦急",
                "心情：不错",
                "情绪焦急，原文见上"
            ]
        );
    }

    #[test]
    fn crlf_files_parse_the_same() {
        let crlf = PINNED_ACTIVITIES.replace('\n', "\r\n");
        assert_eq!(activities(&crlf), activities(PINNED_ACTIVITIES));
        assert_eq!(
            remove_entry(&crlf, "A003").unwrap(),
            remove_entry(PINNED_ACTIVITIES, "A003")
                .unwrap()
                .replace('\n', "\r\n")
        );
        let line = activities(&crlf).ongoing[0].emotions[0].line.clone();
        assert_eq!(
            remove_emotion(&crlf, "A001", &line).unwrap(),
            remove_emotion(PINNED_ACTIVITIES, "A001", &line)
                .unwrap()
                .replace('\n', "\r\n")
        );
    }

    #[test]
    fn empty_and_title_only_files_are_parsed_and_empty() {
        for text in ["", "\n\n", "# 活动知识层\n\n## 持续活动\n\n## 已消失事项\n"] {
            let a = activities(text);
            assert!(a.ongoing.is_empty() && a.ended.is_empty() && a.other.is_none());
        }
    }

    #[test]
    fn content_without_a_single_entry_is_raw() {
        let text = "# 活动知识层\n\n- 跑步\n- 日语\n";
        assert_eq!(parse_activities(text), Parsed::Raw { text: text.into() });
        // An entry heading outside the two sections is not an entry.
        let text = "## A001｜跑步\n- 现状：在跑\n";
        assert!(matches!(parse_activities(text), Parsed::Raw { .. }));
        // Nor is an emotional event of the retired format.
        let text = "## 持续活动\n### E001｜焦急\n- 时间：2026-09-10 15:40\n";
        assert!(matches!(parse_activities(text), Parsed::Raw { .. }));
    }

    #[test]
    fn unrecognised_paragraphs_are_kept_in_other() {
        let text = format!(
            "# 活动知识层\n\n## 口径\n- 本次增量依据 batch.md\n\n{}\n## 本批次证据边界\n- 排除 s-0923-test\n",
            PINNED_ACTIVITIES.trim_start_matches("# 活动知识层\n")
        );
        let a = activities(&text);
        assert_eq!(a.ongoing.len(), 2);
        assert_eq!(a.ended.len(), 1);
        assert_eq!(
            a.other.as_deref(),
            Some("## 口径\n- 本次增量依据 batch.md\n\n## 本批次证据边界\n- 排除 s-0923-test")
        );
    }

    #[test]
    fn the_unpinned_eval_output_is_recognised_in_part() {
        // The 2026-10-12 eval run, before the format was pinned.
        let a = activities(include_str!("testdata/activities-unpinned.md"));
        assert_eq!(
            a.ongoing.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["A001", "A004", "A005", "A009", "A010", "A011"]
        );
        assert_eq!(
            a.ended.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["A008", "A002", "A003", "A012", "A006", "A007"]
        );
        let other = a.other.as_deref().unwrap();
        assert!(other.starts_with("## 口径"), "{other}");
        assert!(other.contains("## 本批次证据边界"));
        assert!(other.contains("## 既往批次证据边界（保留）"));
        // Its free-form lines are not lost: they are the entry's extra.
        let run = &a.ongoing[0];
        assert_eq!(run.status, None);
        assert!(run.extra.iter().any(|l| l.starts_with("发现类型：")));
        assert_eq!(
            run.sessions,
            [
                "s-0907-run",
                "s-0920-run",
                "im-feishu-2026-09-21",
                "s-0927-run"
            ]
        );
        assert_eq!(run.quotes.len(), 5);
        assert_eq!(run.quotes[3].session, None);
        assert_eq!(run.quotes[3].at.as_deref(), Some("2026-09-07 08:40"));
        assert!(a
            .ongoing
            .iter()
            .chain(&a.ended)
            .all(|e| e.emotions.is_empty()));
    }

    #[test]
    fn removing_an_entry_takes_its_block_emotions_included_and_nothing_else() {
        let removed = remove_entry(PINNED_ACTIVITIES, "A001").unwrap();
        let start = PINNED_ACTIVITIES.find("### A001").unwrap();
        let end = PINNED_ACTIVITIES.find("### A003").unwrap();
        assert_eq!(
            removed,
            format!(
                "{}{}",
                &PINNED_ACTIVITIES[..start],
                &PINNED_ACTIVITIES[end..]
            )
        );
        assert!(!removed.contains("担心"));
        let a = activities(&removed);
        assert_eq!(a.ongoing.len(), 1);
        assert_eq!(a.ended.len(), 1);

        // The last entry of a section stops at the next section heading.
        let removed = remove_entry(PINNED_ACTIVITIES, "A003").unwrap();
        assert!(removed.contains("\n## 已消失事项\n"));
        assert_eq!(activities(&removed).ongoing.len(), 1);
        // The last entry of the file runs to its end.
        let removed = remove_entry(PINNED_ACTIVITIES, "A002").unwrap();
        assert!(removed.ends_with("## 已消失事项\n\n"));
    }

    #[test]
    fn a_block_ends_at_the_same_or_a_higher_heading_only() {
        let text =
            "## 持续活动\n### A001｜甲\n- 现状：一\n#### 细节\n更多\n### A002｜乙\n- 现状：二\n";
        let a = activities(text);
        assert_eq!(a.ongoing[0].extra, ["#### 细节", "更多"]);
        let removed = remove_entry(text, "A001").unwrap();
        assert_eq!(removed, "## 持续活动\n### A002｜乙\n- 现状：二\n");
    }

    #[test]
    fn removing_what_is_not_there_is_none() {
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "A999"), None);
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "E001"), None);
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "x"), None);
        assert_eq!(remove_entry("", "A001"), None);
    }

    #[test]
    fn removing_an_emotion_takes_that_line_only() {
        let a = activities(PINNED_ACTIVITIES);
        let line = a.ongoing[0].emotions[0].line.clone();
        let removed = remove_emotion(PINNED_ACTIVITIES, "A001", &line).unwrap();
        assert_eq!(
            removed,
            PINNED_ACTIVITIES.replacen(&format!("{line}\n"), "", 1)
        );
        let after = activities(&removed);
        assert!(after.ongoing[0].emotions.is_empty());
        assert_eq!(after.ongoing[0].quotes, a.ongoing[0].quotes);
        assert_eq!(after.ended, a.ended);
        // Gone is gone.
        assert_eq!(remove_emotion(&removed, "A001", &line), None);
    }

    #[test]
    fn an_emotion_is_found_by_its_text_and_its_entry_not_by_position() {
        let text = concat!(
            "## 持续活动\n",
            "### A001｜甲\n",
            "- 情绪（`s-1`）：焦急——“一”\n",
            "- 情绪（`s-2`）：开心——“二\n",
            "  接着说”\n",
            "- 原文：“三”\n",
            "### A002｜乙\n",
            "- 情绪（`s-1`）：焦急——“一”\n",
        );
        let a = activities(text);
        let wrapped = a.ongoing[0].emotions[1].line.clone();
        assert_eq!(wrapped, "- 情绪（`s-2`）：开心——“二\n  接着说”");
        assert_eq!(a.ongoing[0].emotions[1].text.as_deref(), Some("二\n接着说"));
        // A continuation line goes with its item.
        let removed = remove_emotion(text, "A001", &wrapped).unwrap();
        assert_eq!(
            removed,
            text.replacen("- 情绪（`s-2`）：开心——“二\n  接着说”\n", "", 1)
        );
        // The same words under another entry are that entry's.
        let same = a.ongoing[1].emotions[0].line.clone();
        let removed = remove_emotion(text, "A002", &same).unwrap();
        assert!(removed.ends_with("### A002｜乙\n"));
        assert_eq!(activities(&removed).ongoing[0].emotions.len(), 2);
        // A line that is no emotion is not removed through this door,
        // nor is a near miss.
        assert_eq!(remove_emotion(text, "A001", "- 原文：“三”"), None);
        assert_eq!(
            remove_emotion(text, "A001", "- 情绪（`s-1`）：焦急——“一"),
            None
        );
        assert_eq!(remove_emotion(text, "A003", &same), None);
        assert_eq!(remove_emotion(text, "x", &same), None);
    }

    #[test]
    fn a_repeated_emotion_line_goes_one_at_a_time() {
        let text = "## 持续活动\n### A001｜甲\n- 情绪：焦急——“一”\n- 情绪：焦急——“一”\n";
        let once = remove_emotion(text, "A001", "- 情绪：焦急——“一”").unwrap();
        assert_eq!(once, "## 持续活动\n### A001｜甲\n- 情绪：焦急——“一”\n");
        let twice = remove_emotion(&once, "A001", "- 情绪：焦急——“一”").unwrap();
        assert_eq!(twice, "## 持续活动\n### A001｜甲\n");
    }

    #[test]
    fn ids_are_a_and_digits() {
        assert!(is_entry_id("A001"));
        assert!(is_entry_id("A12"));
        for bad in ["", "A", "a001", "A00x", "B001", "E001", "A-1"] {
            assert!(!is_entry_id(bad), "{bad}");
        }
    }

    #[test]
    fn wire_shape() {
        let parsed = parse_activities(
            "## 持续活动\n### A001｜x\n- 情绪（`s`，2026-09-10 15:40）：焦急——“y”\n",
        );
        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            serde_json::json!({
                "kind": "parsed",
                "ongoing": [{
                    "id": "A001", "title": "x", "sessions": [], "quotes": [],
                    "emotions": [{
                        "session": "s", "at": "2026-09-10 15:40", "tags": ["焦急"],
                        "text": "y", "line": "- 情绪（`s`，2026-09-10 15:40）：焦急——“y”"
                    }],
                    "extra": []
                }],
                "ended": []
            })
        );
        assert_eq!(
            serde_json::to_value(Parsed::<Activities>::Absent).unwrap(),
            serde_json::json!({"kind": "absent"})
        );
        assert_eq!(
            serde_json::to_value(parse_activities("随手写的")).unwrap(),
            serde_json::json!({"kind": "raw", "text": "随手写的"})
        );
    }
}
