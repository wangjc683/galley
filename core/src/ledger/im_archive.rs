//! IM turns: recognised in the engine logs, archived before the logs go.
//!
//! IM conversations never reach `workbench.db` (Rule 4). The only record
//! of what the user said in a managed IM channel is the engine's own LLM
//! log, `temp/model_responses/model_responses_<id>.txt`, which Galley
//! prunes at 30 days / 500 MB (`crate::model_responses_prune`). The
//! ledger copies the user's words out — only theirs, never the agent's
//! — into its own append-only archive, `history_insight/galley/
//! im_archive.jsonl`, incrementally (a byte offset per log in
//! [`LedgerState::im_logs`]).
//!
//! **Read-only coupling** (`docs/ga-baseline.md`, Contract Surface item
//! 20). Nothing marks a log as an IM channel's or a block as the user's;
//! three upstream facts are relied on:
//!
//! 1. `llmcore._write_llm_log` writes `=== Prompt === <local
//!    %Y-%m-%d %H:%M:%S>[ model=…]\n<body>\n\n` (and `=== Response ===`
//!    the same way) to the log, appending.
//! 2. The IM frontends hand GA a user message as
//!    `f"{FILE_HINT}\n\n{text}"` (`frontends/chatapp_common.py:39` and
//!    its callers; Galley's own `runner/im_wechat.py:61` copies it). The
//!    hint is the IM marker; it is stripped from the archived text.
//! 3. A task's first prompt carries that message as written:
//!    `NativeToolClient` logs `{"role": "user", "content": [blocks]}`
//!    with it in a `text` block, `ToolClient` logs the full protocol
//!    prompt with it as a `=== USER ===` section. GA's long-prompt
//!    indirection (`agentmain.run`: over 2000 characters the query is
//!    saved to `temp/user_prompt_*.md` and the prompt says so) is
//!    followed back to that file.
//!
//! Known gaps, accepted: a text-protocol IM message that carried images
//! is logged as a Python list repr and not recognised; group and private
//! chats are not told apart (the log does not say); a block quoting
//! another log's marker lines at a line start (text protocol only) can
//! be split wrongly — upstream's own `/restore` parser shares that.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use regex::bytes::Regex as BytesRegex;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::state::{LedgerState, LogCursor};
use super::LedgerPaths;

/// Upstream IM frontends' prompt prefix (`chatapp_common.FILE_HINT`).
pub const FILE_HINT: &str =
    "If you need to show files to user, use [FILE:filepath] in your response.";

const LOG_PREFIX: &str = "model_responses_";
const LOG_SUFFIX: &str = ".txt";

/// A log nobody wrote for this long has no block in flight: its last
/// prompt is complete even without a following marker.
const QUIET_AFTER: Duration = Duration::from_secs(10 * 60);

/// IM channels whose state directory names the log they write
/// (`runner/im_resume.py`, `context_log.json`).
const SINGLE_LOG_CHANNELS: &[&str] = &["wechat", "feishu", "telegram"];

static MARKER: LazyLock<BytesRegex> = LazyLock::new(|| {
    BytesRegex::new(
        r"(?m)^=== (Prompt|Response) ===(?: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}))?[^\n]*\n",
    )
    .expect("marker regex")
});

static LONG_PROMPT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^Long user prompt saved to (.+?\.md)\. Read and execute\.\s*$")
        .expect("long prompt regex")
});

/// One archived IM user turn: one line of `im_archive.jsonl`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImRecord {
    /// When the LLM call carrying the turn started, local time with its
    /// offset (RFC 3339).
    pub at: String,
    /// `wechat` / `feishu` / `telegram` / `discord`, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    /// The engine log it came from (gone once that log is pruned).
    pub log: String,
    pub text: String,
}

impl ImRecord {
    fn key(&self) -> String {
        format!("{}\u{0}{}", self.at, self.text)
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ArchiveOutcome {
    /// Logs that had unread bytes.
    pub logs_read: usize,
    pub appended: usize,
    /// Turns already in the archive (a log copied by `/continue`, a pass
    /// interrupted between append and state save).
    pub duplicates: usize,
}

/// One `=== Prompt ===` / `=== Response ===` block.
struct Block<'a> {
    prompt: bool,
    ts: Option<NaiveDateTime>,
    body: &'a [u8],
}

/// Split a log chunk (starting at a block boundary) into blocks. Returns
/// the complete blocks and how many bytes they cover. The last block is
/// complete only when `tail_complete` (nobody is writing the log);
/// otherwise it stays unread until the next pass.
fn complete_blocks(chunk: &[u8], tail_complete: bool) -> (Vec<Block<'_>>, usize) {
    let markers: Vec<_> = MARKER.captures_iter(chunk).collect();
    if markers.is_empty() {
        return (Vec::new(), if tail_complete { chunk.len() } else { 0 });
    }
    let mut blocks = Vec::with_capacity(markers.len());
    for (i, caps) in markers.iter().enumerate() {
        let whole = caps.get(0).expect("group 0");
        let end = markers
            .get(i + 1)
            .map_or(chunk.len(), |next| next.get(0).expect("group 0").start());
        let ts = caps
            .get(2)
            .and_then(|m| std::str::from_utf8(m.as_bytes()).ok())
            .and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok());
        blocks.push(Block {
            prompt: &caps[1] == b"Prompt",
            ts,
            body: &chunk[whole.end()..end],
        });
    }
    if tail_complete {
        return (blocks, chunk.len());
    }
    let last_start = markers
        .last()
        .and_then(|caps| caps.get(0))
        .expect("non-empty")
        .start();
    blocks.pop();
    (blocks, last_start)
}

/// The user's words in one prompt body that came from an IM channel,
/// hint stripped. `temp_dir` resolves GA's long-prompt indirection.
pub fn im_texts(body: &str, temp_dir: Option<&Path>) -> Vec<String> {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return native_texts(&value)
                .into_iter()
                .filter_map(|t| human_text(t, temp_dir))
                .collect();
        }
    }
    protocol_user_sections(body)
        .into_iter()
        .filter_map(|t| human_text(t, temp_dir))
        .collect()
}

/// `text` blocks of a `NativeToolClient` prompt (`{"role": "user",
/// "content": [...]}`).
fn native_texts(value: &Value) -> Vec<&str> {
    if value.get("role").and_then(Value::as_str) != Some("user") {
        return Vec::new();
    }
    let Some(blocks) = value.get("content").and_then(Value::as_array) else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect()
}

/// `=== USER ===` sections of a `ToolClient` protocol prompt.
fn protocol_user_sections(body: &str) -> Vec<&str> {
    const USER: &str = "=== USER ===\n";
    let mut sections = Vec::new();
    for (idx, _) in body.match_indices(USER) {
        if idx != 0 && !body[..idx].ends_with('\n') {
            continue;
        }
        let start = idx + USER.len();
        let rest = &body[start..];
        let end = ["\n=== ASSISTANT ===\n", "\n=== USER ===\n"]
            .iter()
            .filter_map(|m| rest.find(m))
            .min()
            .unwrap_or(rest.len());
        sections.push(&rest[..end]);
    }
    sections
}

fn human_text(text: &str, temp_dir: Option<&Path>) -> Option<String> {
    let t = text.trim_start();
    if let Some(rest) = t.strip_prefix(FILE_HINT) {
        let words = rest.trim();
        return (!words.is_empty()).then(|| words.to_string());
    }
    let saved = long_prompt_file(t, temp_dir?)?;
    let raw = fs::read_to_string(saved).ok()?;
    let words = raw.trim_start().strip_prefix(FILE_HINT)?.trim();
    (!words.is_empty()).then(|| words.to_string())
}

/// The `temp/user_prompt_*.md` file a long-prompt notice points at, only
/// when it really is inside the state root's `temp/`.
fn long_prompt_file(text: &str, temp_dir: &Path) -> Option<PathBuf> {
    let caps = LONG_PROMPT.captures(text.trim())?;
    let path = fs::canonicalize(caps.get(1)?.as_str()).ok()?;
    let temp = fs::canonicalize(temp_dir).ok()?;
    let name = path.file_name()?.to_str()?;
    (path.starts_with(&temp) && name.starts_with("user_prompt_")).then_some(path)
}

/// Engine log name → IM channel, from Galley's channel state under
/// `<state root>/im/` (written by `runner/im_resume.py` and managed
/// patch `0026`'s Discord app). Only the logs channels write now.
fn channels_by_log(im_dir: &Path) -> HashMap<String, String> {
    fn read_json(path: PathBuf) -> Option<Value> {
        serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
    }
    let mut out = HashMap::new();
    for channel in SINGLE_LOG_CHANNELS {
        let mapped = read_json(im_dir.join(channel).join("context_log.json"));
        if let Some(name) = mapped
            .as_ref()
            .and_then(|v| v.get("log"))
            .and_then(Value::as_str)
        {
            out.insert(name.to_string(), (*channel).to_string());
        }
    }
    if let Some(Value::Object(active)) =
        read_json(im_dir.join("discord").join("discord_active_channels.json"))
    {
        for item in active.values() {
            if let Some(name) = item.get("log").and_then(Value::as_str) {
                out.insert(name.to_string(), "discord".to_string());
            }
        }
    }
    out
}

struct LogFile {
    name: String,
    path: PathBuf,
    len: u64,
    modified: SystemTime,
}

fn list_logs(dir: &Path) -> io::Result<Vec<LogFile>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut logs = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !(name.starts_with(LOG_PREFIX) && name.ends_with(LOG_SUFFIX)) {
            continue;
        }
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        logs.push(LogFile {
            name,
            path: entry.path(),
            len: meta.len(),
            modified: meta.modified()?,
        });
    }
    logs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(logs)
}

fn read_range(path: &Path, from: u64, to: u64) -> io::Result<Vec<u8>> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::with_capacity(to.saturating_sub(from) as usize);
    file.take(to.saturating_sub(from)).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Archive lines read from some offset: each record with the offset just
/// past its line, and where the read started and ended.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ArchiveRead {
    pub records: Vec<(ImRecord, u64)>,
    /// Where reading started (the requested offset, or 0 when the
    /// archive is shorter than it).
    pub start: u64,
    /// Just past the last complete line.
    pub end: u64,
}

/// Read archive records from byte `offset` to the last complete line,
/// each with the offset just past it (so a reader can stop after any
/// record).
pub fn read_archive_entries(path: &Path, offset: u64) -> io::Result<ArchiveRead> {
    let len = match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(ArchiveRead::default()),
        Err(e) => return Err(e),
    };
    // A shorter archive than the processed offset was replaced by hand:
    // read it all again rather than nothing forever.
    let from = if offset > len { 0 } else { offset };
    let buf = read_range(path, from, len)?;
    let complete = buf.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let mut records = Vec::new();
    let mut at = 0usize;
    for line in buf[..complete].split_inclusive(|b| *b == b'\n') {
        at += line.len();
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<ImRecord>(line) {
            Ok(record) => records.push((record, from + at as u64)),
            Err(e) => eprintln!("[ledger] skipping an unreadable archive line: {e}"),
        }
    }
    Ok(ArchiveRead {
        records,
        start: from,
        end: from + complete as u64,
    })
}

/// Read archive records from byte `offset` to the last complete line.
/// Returns the records and the offset just past them.
pub fn read_archive_from(path: &Path, offset: u64) -> io::Result<(Vec<ImRecord>, u64)> {
    let read = read_archive_entries(path, offset)?;
    Ok((
        read.records.into_iter().map(|(record, _)| record).collect(),
        read.end,
    ))
}

fn existing_keys(path: &Path) -> io::Result<HashSet<String>> {
    let (records, _) = read_archive_from(path, 0)?;
    Ok(records.iter().map(ImRecord::key).collect())
}

fn append_records(path: &Path, records: &[ImRecord]) -> io::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut buf = String::new();
    for record in records {
        buf.push_str(&serde_json::to_string(record).expect("record serializes"));
        buf.push('\n');
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(buf.as_bytes())?;
    file.flush()
}

/// One archive pass in the machine's zone. See [`archive_im_turns_in`].
pub fn archive_im_turns(
    paths: &LedgerPaths,
    state: &mut LedgerState,
    since: DateTime<Utc>,
    writers_alive: bool,
) -> io::Result<ArchiveOutcome> {
    archive_im_turns_in(
        paths,
        state,
        since,
        writers_alive,
        SystemTime::now(),
        &Local,
    )
}

/// Append every IM user turn said at or after `since` that the engine
/// logs gained since the last pass, and advance `state.im_logs`. The
/// state is touched only when the append succeeded. `writers_alive`:
/// some engine may be mid-write (false at startup, before any bridge).
/// `tz` is the zone the logs' naive timestamps were written in.
pub fn archive_im_turns_in<Tz: TimeZone>(
    paths: &LedgerPaths,
    state: &mut LedgerState,
    since: DateTime<Utc>,
    writers_alive: bool,
    now: SystemTime,
    tz: &Tz,
) -> io::Result<ArchiveOutcome>
where
    Tz::Offset: std::fmt::Display,
{
    let logs = list_logs(&paths.model_responses_dir())?;
    let channels = channels_by_log(&paths.im_state_dir());
    let archive = paths.archive_file();
    let mut seen = existing_keys(&archive)?;
    let since_time: SystemTime = since.into();
    let temp_dir = paths.temp_dir();

    let mut cursors = state.im_logs.clone();
    let mut fresh: Vec<ImRecord> = Vec::new();
    let mut outcome = ArchiveOutcome::default();
    for log in &logs {
        let cursor: &mut LogCursor = cursors.entry(log.name.clone()).or_default();
        if cursor.channel.is_none() {
            cursor.channel = channels.get(&log.name).cloned();
        }
        if log.len < cursor.offset {
            // Replaced or truncated under the same name: start over.
            cursor.offset = 0;
        }
        if log.len == cursor.offset {
            continue;
        }
        if cursor.offset == 0 && log.modified < since_time {
            // Last written before `since`: nothing in it is new.
            cursor.offset = log.len;
            continue;
        }
        outcome.logs_read += 1;
        let quiet = !writers_alive
            || now
                .duration_since(log.modified)
                .is_ok_and(|age| age >= QUIET_AFTER);
        let chunk = read_range(&log.path, cursor.offset, log.len)?;
        let (blocks, consumed) = complete_blocks(&chunk, quiet);
        for block in blocks.iter().filter(|b| b.prompt) {
            let Some(at) = block
                .ts
                .and_then(|ts| tz.from_local_datetime(&ts).earliest())
            else {
                continue;
            };
            if at.with_timezone(&Utc) < since {
                continue;
            }
            let body = String::from_utf8_lossy(block.body);
            for text in im_texts(&body, Some(&temp_dir)) {
                let record = ImRecord {
                    at: at.to_rfc3339(),
                    channel: cursor.channel.clone(),
                    log: log.name.clone(),
                    text,
                };
                if seen.insert(record.key()) {
                    fresh.push(record);
                } else {
                    outcome.duplicates += 1;
                }
            }
        }
        cursor.offset += consumed as u64;
    }
    // Pruned logs need no position.
    cursors.retain(|name, _| logs.iter().any(|log| &log.name == name));

    append_records(&archive, &fresh)?;
    outcome.appended = fresh.len();
    state.im_logs = cursors;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn shanghai() -> FixedOffset {
        FixedOffset::east_opt(8 * 3600).unwrap()
    }

    /// `_write_llm_log`'s exact shape.
    fn entry(label: &str, ts: &str, content: &str) -> String {
        format!("=== {label} === {ts}\n{content}\n\n")
    }

    fn native_prompt(text: &str) -> String {
        let block = serde_json::json!({"type": "text", "text": text});
        format!("{{\"role\": \"user\", \"content\": [\n{block}]}}")
    }

    fn protocol_prompt(user: &str) -> String {
        format!("You are GA.\n### 交互协议\n...\n=== USER ===\n{user}\n=== ASSISTANT ===\n")
    }

    fn hinted(text: &str) -> String {
        format!("{FILE_HINT}\n\n{text}")
    }

    fn setup() -> (tempfile::TempDir, LedgerPaths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
        fs::create_dir_all(paths.model_responses_dir()).unwrap();
        (dir, paths)
    }

    fn since() -> DateTime<Utc> {
        // 2026-10-01 00:00 +08:00
        "2026-09-30T16:00:00Z".parse().unwrap()
    }

    fn archived(paths: &LedgerPaths) -> Vec<ImRecord> {
        read_archive_from(&paths.archive_file(), 0).unwrap().0
    }

    fn pass(paths: &LedgerPaths, state: &mut LedgerState, writers_alive: bool) -> ArchiveOutcome {
        archive_im_turns_in(
            paths,
            state,
            since(),
            writers_alive,
            SystemTime::now(),
            &shanghai(),
        )
        .unwrap()
    }

    #[test]
    fn native_and_protocol_prompts_yield_the_hint_stripped_words() {
        assert_eq!(
            im_texts(&native_prompt(&hinted("下周三去复查")), None),
            vec!["下周三去复查"]
        );
        assert_eq!(
            im_texts(&protocol_prompt(&hinted("明天提醒我交房租")), None),
            vec!["明天提醒我交房租"]
        );
    }

    #[test]
    fn prompts_without_the_hint_are_not_im() {
        // A Galley GUI / CLI turn, a continuation anchor, a tool result.
        assert!(im_texts(&native_prompt("帮我写个脚本"), None).is_empty());
        assert!(im_texts(
            &native_prompt("\n### [WORKING MEMORY]\n<history>…</history>"),
            None
        )
        .is_empty());
        let tool_turn = "{\"role\": \"user\", \"content\": [\n{\"type\": \"tool_result\", \"tool_use_id\": \"t1\", \"content\": \"If you need to show files to user, use [FILE:filepath] in your response.\"}]}";
        assert!(im_texts(tool_turn, None).is_empty());
        assert!(im_texts(
            &protocol_prompt("<tool_result>ok</tool_result>\n继续"),
            None
        )
        .is_empty());
        // A hint with nothing after it is not a turn.
        assert!(im_texts(&native_prompt(FILE_HINT), None).is_empty());
    }

    #[test]
    fn a_long_prompt_is_followed_to_its_saved_file_inside_temp_only() {
        let (_dir, paths) = setup();
        let temp = paths.temp_dir();
        fs::create_dir_all(&temp).unwrap();
        let saved = temp.join("user_prompt_1_2.md");
        fs::write(&saved, hinted("一段很长的话")).unwrap();
        let notice = format!(
            "Long user prompt saved to {}. Read and execute.",
            saved.display()
        );
        assert_eq!(
            im_texts(&native_prompt(&notice), Some(&temp)),
            vec!["一段很长的话"]
        );
        // The same notice pointing outside temp/ is ignored.
        let outside = paths.state_root().join("user_prompt_3_4.md");
        fs::write(&outside, hinted("不该读")).unwrap();
        let notice = format!(
            "Long user prompt saved to {}. Read and execute.",
            outside.display()
        );
        assert!(im_texts(&native_prompt(&notice), Some(&temp)).is_empty());
    }

    #[test]
    fn archives_only_im_user_turns_and_only_since() {
        let (_dir, paths) = setup();
        let log = paths
            .model_responses_dir()
            .join("model_responses_100001.txt");
        let body = [
            entry(
                "Prompt",
                "2026-09-30 23:59:00",
                &native_prompt(&hinted("since 之前")),
            ),
            entry(
                "Response",
                "2026-09-30 23:59:05",
                "[{'type': 'text', 'text': '好'}]",
            ),
            entry(
                "Prompt",
                "2026-10-01 09:00:00",
                &native_prompt(&hinted("周末去爬山")),
            ),
            entry("Response", "2026-10-01 09:00:09", "助理的回答不会被归档"),
            entry(
                "Prompt",
                "2026-10-01 09:00:10",
                &native_prompt("<tool_result>…"),
            ),
            entry("Response", "2026-10-01 09:00:12", "…"),
        ]
        .concat();
        fs::write(&log, body).unwrap();

        let mut state = LedgerState::default();
        let out = pass(&paths, &mut state, false);
        assert_eq!(out.appended, 1);
        let records = archived(&paths);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].text, "周末去爬山");
        assert_eq!(records[0].at, "2026-10-01T09:00:00+08:00");
        assert_eq!(records[0].log, "model_responses_100001.txt");
        assert_eq!(
            state.im_logs["model_responses_100001.txt"].offset,
            fs::metadata(&log).unwrap().len()
        );
    }

    #[test]
    fn incremental_passes_read_only_new_blocks_and_wait_for_a_prompt_in_flight() {
        let (_dir, paths) = setup();
        let log = paths
            .model_responses_dir()
            .join("model_responses_200002.txt");
        let first = entry(
            "Prompt",
            "2026-10-02 08:00:00",
            &protocol_prompt(&hinted("第一句")),
        );
        let in_flight = entry(
            "Prompt",
            "2026-10-02 08:05:00",
            &protocol_prompt(&hinted("第二句")),
        );
        fs::write(
            &log,
            format!(
                "{first}{}{in_flight}",
                entry("Response", "2026-10-02 08:00:03", "答")
            ),
        )
        .unwrap();

        // A live writer: the trailing prompt has no response yet.
        let mut state = LedgerState::default();
        assert_eq!(pass(&paths, &mut state, true).appended, 1);
        let offset = state.im_logs["model_responses_200002.txt"].offset;
        assert!(offset < fs::metadata(&log).unwrap().len());

        // Its response arrives: the second turn is complete now.
        let mut f = fs::OpenOptions::new().append(true).open(&log).unwrap();
        f.write_all(entry("Response", "2026-10-02 08:05:04", "答").as_bytes())
            .unwrap();
        drop(f);
        assert_eq!(pass(&paths, &mut state, true).appended, 1);
        // Nothing new: nothing appended, nothing duplicated.
        let out = pass(&paths, &mut state, true);
        assert_eq!((out.appended, out.duplicates), (0, 0));

        let texts: Vec<_> = archived(&paths).into_iter().map(|r| r.text).collect();
        assert_eq!(texts, vec!["第一句", "第二句"]);
    }

    #[test]
    fn a_copied_log_does_not_duplicate_the_archive() {
        // `/continue` copy: same content under a new log name.
        let (_dir, paths) = setup();
        let content = [
            entry(
                "Prompt",
                "2026-10-03 10:00:00",
                &native_prompt(&hinted("同一句话")),
            ),
            entry("Response", "2026-10-03 10:00:02", "答"),
        ]
        .concat();
        fs::write(
            paths.model_responses_dir().join("model_responses_1.txt"),
            &content,
        )
        .unwrap();
        fs::write(
            paths.model_responses_dir().join("model_responses_2.txt"),
            &content,
        )
        .unwrap();
        let mut state = LedgerState::default();
        let out = pass(&paths, &mut state, false);
        assert_eq!((out.appended, out.duplicates), (1, 1));
    }

    #[test]
    fn channel_comes_from_galley_channel_state_and_sticks() {
        let (_dir, paths) = setup();
        let feishu = paths.im_state_dir().join("feishu");
        fs::create_dir_all(&feishu).unwrap();
        fs::write(
            feishu.join("context_log.json"),
            r#"{"log": "model_responses_3.txt"}"#,
        )
        .unwrap();
        let discord = paths.im_state_dir().join("discord");
        fs::create_dir_all(&discord).unwrap();
        fs::write(
            discord.join("discord_active_channels.json"),
            r#"{"123": {"log": "model_responses_4.txt", "at": 1}}"#,
        )
        .unwrap();
        for (name, words) in [
            ("3", "飞书说的"),
            ("4", "Discord 说的"),
            ("5", "不知道哪来的"),
        ] {
            fs::write(
                paths
                    .model_responses_dir()
                    .join(format!("model_responses_{name}.txt")),
                entry(
                    "Prompt",
                    "2026-10-04 12:00:00",
                    &native_prompt(&hinted(words)),
                ),
            )
            .unwrap();
        }
        let mut state = LedgerState::default();
        pass(&paths, &mut state, false);
        let by_text: HashMap<_, _> = archived(&paths)
            .into_iter()
            .map(|r| (r.text, r.channel))
            .collect();
        assert_eq!(by_text["飞书说的"].as_deref(), Some("feishu"));
        assert_eq!(by_text["Discord 说的"].as_deref(), Some("discord"));
        assert_eq!(by_text["不知道哪来的"], None);

        // The channel moved on (`/new`); the log keeps its attribution.
        fs::remove_file(feishu.join("context_log.json")).unwrap();
        pass(&paths, &mut state, false);
        assert_eq!(
            state.im_logs["model_responses_3.txt"].channel.as_deref(),
            Some("feishu")
        );
    }

    #[test]
    fn pruned_logs_drop_out_of_the_state_and_a_missing_dir_is_fine() {
        let (_dir, paths) = setup();
        let log = paths.model_responses_dir().join("model_responses_6.txt");
        fs::write(
            &log,
            entry(
                "Prompt",
                "2026-10-05 12:00:00",
                &native_prompt(&hinted("在")),
            ),
        )
        .unwrap();
        let mut state = LedgerState::default();
        pass(&paths, &mut state, false);
        assert!(state.im_logs.contains_key("model_responses_6.txt"));
        fs::remove_dir_all(paths.model_responses_dir()).unwrap();
        pass(&paths, &mut state, false);
        assert!(state.im_logs.is_empty());
        assert_eq!(archived(&paths).len(), 1);
    }

    #[test]
    fn an_old_untouched_log_is_skipped_without_reading() {
        let (_dir, paths) = setup();
        let log = paths.model_responses_dir().join("model_responses_7.txt");
        fs::write(
            &log,
            entry(
                "Prompt",
                "2026-10-06 12:00:00",
                &native_prompt(&hinted("旧")),
            ),
        )
        .unwrap();
        // mtime before `since`: the timestamp inside is never looked at.
        let old = SystemTime::from(since()) - Duration::from_secs(3600);
        fs::OpenOptions::new()
            .write(true)
            .open(&log)
            .unwrap()
            .set_modified(old)
            .unwrap();
        let mut state = LedgerState::default();
        let out = pass(&paths, &mut state, false);
        assert_eq!((out.logs_read, out.appended), (0, 0));
        assert_eq!(
            state.im_logs["model_responses_7.txt"].offset,
            fs::metadata(&log).unwrap().len()
        );
    }

    #[test]
    fn read_archive_from_stops_at_the_last_full_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("im_archive.jsonl");
        let line = serde_json::to_string(&ImRecord {
            at: "2026-10-01T09:00:00+08:00".into(),
            channel: None,
            log: "model_responses_1.txt".into(),
            text: "一".into(),
        })
        .unwrap();
        fs::write(&path, format!("{line}\n{{\"at\": \"half")).unwrap();
        let (records, end) = read_archive_from(&path, 0).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(end, line.len() as u64 + 1);
        let (again, end2) = read_archive_from(&path, end).unwrap();
        assert!(again.is_empty());
        assert_eq!(end2, end);
    }
}
