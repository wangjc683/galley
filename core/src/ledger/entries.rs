//! The mining outputs as entries (ticket 04): `activities.md` and
//! `emotional_events.md` read in the format the mining task pins
//! ([`super::batch::task_prompt`]), and one entry deleted.
//!
//! ```text
//! # 活动知识层                      # 情绪事件
//!
//! ## 持续活动                       ## E001｜标题
//!                                   - 时间：2026-09-10 15:40
//! ### A001｜标题                    - 会话：`s-0910-surgery`
//! - 现状：一句话                    - 标签：焦急、不安
//! - 最近：2026-09-27                - 原文：“……”
//! - 会话：`s-1`、`im-feishu-…`      - 关联活动：A006
//! - 原文（`s-1`，2026-09-27 07:00）：“……”
//!
//! ## 已消失事项
//! ### A002｜标题
//! ```
//!
//! **One block rule for both.** An entry is its heading line —
//! `A\d+｜title` at level 3 or deeper under a level-2 `持续活动` /
//! `已消失事项` section, `E\d+｜title` at level 2 or deeper in the
//! emotions file — and every line after it up to the next heading of the
//! same or a higher level (or the end of the file). The page shows
//! exactly those blocks, and a delete removes exactly one of them, every
//! other byte of the file untouched.
//!
//! **Nothing is dropped.** Inside an entry, `- 键：值` lines go to their
//! field by key; any other line (an unknown key, a paragraph, a
//! sub-heading) is kept in `extra`, bullet marker removed. Outside the
//! entries, every line that is not a document title (`#`) or a known
//! section heading goes to `other`, verbatim, in file order — the
//! model was told not to write such paragraphs, and if it does the user
//! still sees them. A file that has content but not one recognisable
//! entry is [`Parsed::Raw`]: the page shows it read-only.

use std::fs;
use std::io;
use std::ops::Range;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Which file an entry lives in, from its id's letter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    /// `A001`, `activities.md`.
    Activity,
    /// `E001`, `emotional_events.md`.
    Emotion,
}

impl EntryKind {
    /// `A<digits>` / `E<digits>`; anything else is no entry id.
    pub fn of_id(id: &str) -> Option<Self> {
        let kind = match id.chars().next()? {
            'A' => Self::Activity,
            'E' => Self::Emotion,
            _ => return None,
        };
        let digits = &id[1..];
        (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(kind)
    }

    fn letter(self) -> char {
        match self {
            Self::Activity => 'A',
            Self::Emotion => 'E',
        }
    }
}

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
    /// Every other line of the entry, bullet marker removed.
    pub extra: Vec<String>,
}

/// One emotional event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEmotion {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    pub sessions: Vec<String>,
    pub tags: Vec<String>,
    pub quotes: Vec<LedgerQuote>,
    /// The related activity's id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Emotions {
    pub entries: Vec<LedgerEmotion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other: Option<String>,
}

/// One output file as the page gets it: `{"kind": "absent"}`,
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
    LazyLock::new(|| Regex::new(r"^([AE]\d+)\s*[｜|]\s*(.+)$").expect("entry heading regex"));
static DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{4}-\d{2}-\d{2}").expect("date regex"));
static ACTIVITY_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bA\d+\b").expect("activity id regex"));
static TICKED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`([^`]+)`").expect("tick regex"));

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

fn entry_heading(title: &str, kind: EntryKind) -> Option<(String, String)> {
    let caps = ENTRY_HEADING.captures(title)?;
    let id = caps.get(1)?.as_str();
    (id.starts_with(kind.letter())).then(|| (id.to_string(), caps[2].trim().to_string()))
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
    fn byte_range(&self, block: &Block) -> Range<usize> {
        let start = self.lines[block.lines.start].start;
        let end = self.lines[block.lines.end - 1].end;
        start..end
    }
}

fn layout(text: &str, kind: EntryKind) -> Layout<'_> {
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
        let entry_level_ok = match kind {
            EntryKind::Activity => {
                if level == 2 {
                    section = section_of(title);
                    claimed[i] = section.is_some();
                    i += 1;
                    continue;
                }
                section.is_some()
            }
            EntryKind::Emotion => true,
        };
        if entry_level_ok {
            if let Some((id, entry_title)) = entry_heading(title, kind) {
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
        if kind == EntryKind::Emotion && title.starts_with("情绪事件") {
            claimed[i] = true;
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

fn pieces(lines: &[Line<'_>]) -> Vec<Piece> {
    let mut out: Vec<Piece> = Vec::new();
    let mut item_open = false;
    for line in lines {
        let text = line.text;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            item_open = false;
            continue;
        }
        if heading(text).is_some() {
            item_open = false;
            out.push(Piece::Loose(trimmed.to_string()));
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
                out.push(Piece::Item(content.trim().to_string()));
                item_open = true;
            }
            _ if item_open => {
                if let Some(Piece::Item(item)) = out.last_mut() {
                    item.push('\n');
                    item.push_str(trimmed);
                }
            }
            _ => out.push(Piece::Loose(trimmed.to_string())),
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

/// A `原文（`会话`，时间）：“…”` item (the parenthesis optional, either
/// part optional; `关键原文` and the like count too).
fn quote(item: &str) -> Option<LedgerQuote> {
    let key_end = item.find(['（', '(', '：', ':'])?;
    let key = item[..key_end].trim();
    if !(key.starts_with("原文") || key.ends_with("原文")) || key.chars().count() > 8 {
        return None;
    }
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
    let text = rest.strip_prefix('：').or_else(|| rest.strip_prefix(':'))?;
    Some(LedgerQuote {
        session,
        at,
        text: unquote(text),
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

fn activity_entry(layout: &Layout<'_>, block: &Block) -> LedgerEntry {
    let mut entry = LedgerEntry {
        id: block.id.clone(),
        title: block.title.clone(),
        status: None,
        last_seen: None,
        sessions: Vec::new(),
        quotes: Vec::new(),
        extra: Vec::new(),
    };
    let body = &layout.lines[block.lines.start + 1..block.lines.end];
    for piece in pieces(body) {
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

fn emotion_entry(layout: &Layout<'_>, block: &Block) -> LedgerEmotion {
    let mut entry = LedgerEmotion {
        id: block.id.clone(),
        title: block.title.clone(),
        at: None,
        sessions: Vec::new(),
        tags: Vec::new(),
        quotes: Vec::new(),
        related: None,
        extra: Vec::new(),
    };
    let body = &layout.lines[block.lines.start + 1..block.lines.end];
    for piece in pieces(body) {
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
        match key_value(&item) {
            Some(("时间", value)) if entry.at.is_none() && !value.is_empty() => {
                entry.at = Some(value.trim_end_matches('。').trim().to_string());
            }
            Some(("会话", value)) => push_unique(&mut entry.sessions, sessions_in(value)),
            Some(("标签", value)) => push_unique(&mut entry.tags, split_list(value)),
            Some(("关联活动", value)) if entry.related.is_none() && ACTIVITY_ID.is_match(value) =>
            {
                entry.related = ACTIVITY_ID.find(value).map(|m| m.as_str().to_string());
            }
            _ => entry.extra.push(item),
        }
    }
    entry
}

// ---------------- parse ----------------

pub fn parse_activities(text: &str) -> Parsed<Activities> {
    let layout = layout(text, EntryKind::Activity);
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

pub fn parse_emotions(text: &str) -> Parsed<Emotions> {
    let layout = layout(text, EntryKind::Emotion);
    let other = other_text(&layout);
    if layout.blocks.is_empty() && other.is_some() {
        return Parsed::Raw {
            text: text.to_string(),
        };
    }
    let entries = layout
        .blocks
        .iter()
        .map(|block| emotion_entry(&layout, block))
        .collect();
    Parsed::Parsed(Emotions { entries, other })
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

pub fn read_emotions(path: &Path) -> Parsed<Emotions> {
    read_text(path).map_or(Parsed::Absent, |t| parse_emotions(&t))
}

// ---------------- delete ----------------

/// The file with one entry's block(s) removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removed {
    pub text: String,
    /// The entry's title (the first block's, when the model reused an
    /// id).
    pub title: String,
}

/// Remove every block of entry `id` from `text` — the same blocks
/// [`parse_activities`] / [`parse_emotions`] show — leaving every other
/// byte as it was. `None` when the file has no such entry.
pub fn remove_entry(text: &str, id: &str) -> Option<Removed> {
    let kind = EntryKind::of_id(id)?;
    let layout = layout(text, kind);
    let ranges: Vec<Range<usize>> = layout
        .blocks
        .iter()
        .filter(|b| b.id == id)
        .map(|b| layout.byte_range(b))
        .collect();
    let title = layout.blocks.iter().find(|b| b.id == id)?.title.clone();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for range in ranges {
        out.push_str(&text[at..range.start]);
        at = range.end;
    }
    out.push_str(&text[at..]);
    Some(Removed { text: out, title })
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
";

    const PINNED_EMOTIONS: &str = "# 情绪事件

## E001｜手术等待超预期时的明显焦急
- 时间：2026-09-10 15:40
- 会话：`s-0910-surgery`
- 标签：焦急、不安
- 原文：“手术还没出来，已经三个多小时了……”
- 关联活动：A006

## E002｜房东临签加价的气愤
- 时间：2026-09-18 20:30
- 会话：`s-0918-house`
- 标签：愤怒
- 原文：“气死了。”
- 关联活动：A004（找房）
";

    fn activities(text: &str) -> Activities {
        match parse_activities(text) {
            Parsed::Parsed(a) => a,
            other => panic!("not parsed: {other:?}"),
        }
    }

    fn emotions(text: &str) -> Emotions {
        match parse_emotions(text) {
            Parsed::Parsed(e) => e,
            other => panic!("not parsed: {other:?}"),
        }
    }

    #[test]
    fn the_pinned_activities_format_is_read_whole() {
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
        assert_eq!(a.ended[0].id, "A002");
        assert_eq!(a.ended[0].quotes.len(), 1);
    }

    #[test]
    fn the_pinned_emotions_format_is_read_whole() {
        let e = emotions(PINNED_EMOTIONS);
        assert_eq!(e.other, None);
        assert_eq!(e.entries.len(), 2);
        let first = &e.entries[0];
        assert_eq!(first.id, "E001");
        assert_eq!(first.at.as_deref(), Some("2026-09-10 15:40"));
        assert_eq!(first.sessions, ["s-0910-surgery"]);
        assert_eq!(first.tags, ["焦急", "不安"]);
        assert_eq!(first.related.as_deref(), Some("A006"));
        assert_eq!(
            first.quotes,
            [LedgerQuote {
                session: None,
                at: None,
                text: "手术还没出来，已经三个多小时了……".into(),
            }]
        );
        assert!(first.extra.is_empty());
        assert_eq!(e.entries[1].related.as_deref(), Some("A004"));
    }

    #[test]
    fn crlf_files_parse_the_same() {
        let crlf = PINNED_ACTIVITIES.replace('\n', "\r\n");
        assert_eq!(activities(&crlf), activities(PINNED_ACTIVITIES));
        let removed = remove_entry(&crlf, "A003").unwrap();
        assert_eq!(
            removed.text,
            remove_entry(PINNED_ACTIVITIES, "A003")
                .unwrap()
                .text
                .replace('\n', "\r\n")
        );
    }

    #[test]
    fn empty_and_title_only_files_are_parsed_and_empty() {
        for text in ["", "\n\n", "# 活动知识层\n\n## 持续活动\n\n## 已消失事项\n"] {
            let a = activities(text);
            assert!(a.ongoing.is_empty() && a.ended.is_empty() && a.other.is_none());
        }
        for text in ["", "# 情绪事件\n"] {
            let e = emotions(text);
            assert!(e.entries.is_empty() && e.other.is_none());
        }
    }

    #[test]
    fn content_without_a_single_entry_is_raw() {
        let text = "# 活动知识层\n\n- 跑步\n- 日语\n";
        assert_eq!(parse_activities(text), Parsed::Raw { text: text.into() });
        // An entry heading outside the two sections is not an entry.
        let text = "## A001｜跑步\n- 现状：在跑\n";
        assert!(matches!(parse_activities(text), Parsed::Raw { .. }));
        let text = "# 情绪事件\n\n9 月 10 日很焦虑。\n";
        assert!(matches!(parse_emotions(text), Parsed::Raw { .. }));
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

        let e = emotions(include_str!("testdata/emotional_events-unpinned.md"));
        assert_eq!(
            e.entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["E001", "E002", "E003", "E004", "E005", "E006"]
        );
        let other = e.other.as_deref().unwrap();
        assert!(other.starts_with("只追加、不改写既有事件。"), "{other}");
        assert!(other.contains("## 追加批次｜2026-09-14—2026-09-20"));
        assert_eq!(e.entries[0].related.as_deref(), Some("A006"));
        assert!(e.entries[0]
            .quotes
            .iter()
            .any(|q| q.text.starts_with("手术还没出来")));
    }

    #[test]
    fn removing_an_entry_takes_its_block_and_nothing_else() {
        let removed = remove_entry(PINNED_ACTIVITIES, "A001").unwrap();
        assert_eq!(removed.title, "杭州半程马拉松备赛");
        let start = PINNED_ACTIVITIES.find("### A001").unwrap();
        let end = PINNED_ACTIVITIES.find("### A003").unwrap();
        assert_eq!(
            removed.text,
            format!(
                "{}{}",
                &PINNED_ACTIVITIES[..start],
                &PINNED_ACTIVITIES[end..]
            )
        );
        let a = activities(&removed.text);
        assert_eq!(a.ongoing.len(), 1);
        assert_eq!(a.ended.len(), 1);

        // The last entry of a section stops at the next section heading.
        let removed = remove_entry(PINNED_ACTIVITIES, "A003").unwrap();
        assert!(removed.text.contains("\n## 已消失事项\n"));
        assert_eq!(activities(&removed.text).ongoing.len(), 1);
        // The last entry of the file runs to its end.
        let removed = remove_entry(PINNED_ACTIVITIES, "A002").unwrap();
        assert!(removed.text.ends_with("## 已消失事项\n\n"));

        let removed = remove_entry(PINNED_EMOTIONS, "E001").unwrap();
        assert_eq!(
            removed.text,
            PINNED_EMOTIONS.replacen(
                &PINNED_EMOTIONS[PINNED_EMOTIONS.find("## E001").unwrap()
                    ..PINNED_EMOTIONS.find("## E002").unwrap()],
                "",
                1
            )
        );
    }

    #[test]
    fn a_block_ends_at_the_same_or_a_higher_heading_only() {
        let text =
            "## 持续活动\n### A001｜甲\n- 现状：一\n#### 细节\n更多\n### A002｜乙\n- 现状：二\n";
        let a = activities(text);
        assert_eq!(a.ongoing[0].extra, ["#### 细节", "更多"]);
        let removed = remove_entry(text, "A001").unwrap();
        assert_eq!(removed.text, "## 持续活动\n### A002｜乙\n- 现状：二\n");
    }

    #[test]
    fn removing_what_is_not_there_is_none() {
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "A999"), None);
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "E001"), None);
        assert_eq!(remove_entry(PINNED_ACTIVITIES, "x"), None);
        assert_eq!(remove_entry("", "A001"), None);
    }

    #[test]
    fn ids_name_their_file() {
        assert_eq!(EntryKind::of_id("A001"), Some(EntryKind::Activity));
        assert_eq!(EntryKind::of_id("E12"), Some(EntryKind::Emotion));
        for bad in ["", "A", "a001", "A00x", "B001", "E-1"] {
            assert_eq!(EntryKind::of_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn wire_shape() {
        let parsed = parse_emotions("## E001｜x\n- 原文：“y”\n");
        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            serde_json::json!({
                "kind": "parsed",
                "entries": [{
                    "id": "E001", "title": "x", "sessions": [], "tags": [],
                    "quotes": [{"text": "y"}], "extra": []
                }]
            })
        );
        assert_eq!(
            serde_json::to_value(Parsed::<Emotions>::Absent).unwrap(),
            serde_json::json!({"kind": "absent"})
        );
        assert_eq!(
            serde_json::to_value(parse_activities("随手写的")).unwrap(),
            serde_json::json!({"kind": "raw", "text": "随手写的"})
        );
    }
}
