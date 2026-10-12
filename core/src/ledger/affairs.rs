//! The ongoing-affairs short list (`.scratch/main-chat/issues/03-segments-and-injection.md`,
//! 03a).
//!
//! The full ledger is too long to put in a conversation (three weeks of
//! the ticket-01 corpus already made `activities.md` 17 KB), so every
//! mining run ends by writing a short list beside it
//! ([`LedgerPaths::affairs_file`]): ongoing affairs only, one per line
//! (the step is in [`super::batch::task_prompt`]). Core reads it when a
//! runner is spawned and puts it in the session-start state block
//! (`crate::managed_prompt`) of two surfaces: the main chat, and the IM
//! channels (IM L0, PRD ruling 27). Nothing else reads it.
//!
//! Core does not trust the file's length or shape — a model wrote it:
//! blank lines and Markdown headings are dropped (a heading would read
//! as a section of the prompt), and the list is cut to
//! [`AFFAIRS_CAP_BYTES`] at a line boundary, keeping the top (the most
//! recently active items, as the task asks).
//!
//! Each line carries its activity's number (`- A001｜…`, ticket 04) so a
//! delete on the Memory page takes the line with the entry
//! ([`remove_affair`]). The number is for Galley, not the model: it is
//! stripped before injection ([`strip_number`]; a line without one is
//! kept as it is), and the caps count what is left.
//!
//! Same switch as the ledger: while it is off (or undecided) there is no
//! section, and the file is not even read ([`for_injection`]).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::LedgerPaths;

/// `A001｜` at the start of a line (after its `- `): the activity's
/// number, for Galley only.
static NUMBER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([AE]\d+)\s*[｜|]\s*").expect("number regex"));

/// Byte cap on the injected list (the lines, not the section heading).
///
/// The mining task's own limits fit under it at their worst: twelve
/// lines of `- ` and forty Chinese characters are 12 × 122 + 11 = 1475
/// bytes. So the cut only bites when the model ignores those limits,
/// and then the bottom (least recently active) lines go first. Typical
/// lists are far shorter: the six ongoing affairs of the ticket-01
/// corpus after three weeks, one line each, come to about 480 bytes
/// (≈ 80 per line). It rides every request of the main chat and the IM
/// channels: the same order as the IM entry layer (1383 bytes), a
/// fraction of Galley's static rules (6855) — a reminder list, not a
/// second ledger.
pub const AFFAIRS_CAP_BYTES: usize = 1536;

/// The file never needs more than this read to fill the cap; a runaway
/// file costs no more.
const READ_LIMIT_BYTES: u64 = 64 * 1024;

/// `(bullet, number, rest)` of a short-list line: `- A001｜事` is
/// `("- ", Some("A001"), "事")`.
fn split_number(line: &str) -> (&str, Option<&str>, &str) {
    let (bullet, body) = match line.strip_prefix("- ") {
        Some(body) => ("- ", body),
        None => ("", line),
    };
    match NUMBER.captures(body) {
        Some(caps) => {
            let whole = caps.get(0).expect("group 0");
            let number = caps.get(1).expect("group 1").as_str();
            (bullet, Some(number), &body[whole.end()..])
        }
        None => (bullet, None, body),
    }
}

/// One line as it is injected: its number taken out.
pub fn strip_number(line: &str) -> String {
    let (bullet, _, rest) = split_number(line);
    format!("{bullet}{rest}")
}

/// The short list without the lines numbered `id`, every other byte as
/// it was; `None` when no line carries that number.
pub fn remove_affair(raw: &str, id: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut removed = false;
    for line in raw.split_inclusive('\n') {
        let (_, number, _) = split_number(line.trim());
        if number == Some(id) {
            removed = true;
        } else {
            out.push_str(line);
        }
    }
    removed.then_some(out)
}

/// The list cleaned and cut to `cap` bytes, or `None` when nothing is
/// left. Lines are trimmed and their numbers stripped; blank lines,
/// Markdown headings and bare numbers are dropped; whole lines are kept
/// from the top while they fit (counting the newline between them). A
/// first line longer than the cap on its own is cut at a character
/// boundary and marked with `…`.
pub fn cap_affairs(raw: &str, cap: usize) -> Option<String> {
    let mut out = String::new();
    for line in raw.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let stripped = strip_number(line);
        let line = stripped.trim_end();
        if line.is_empty() || line == "-" {
            continue;
        }
        let needed = if out.is_empty() {
            line.len()
        } else {
            out.len() + 1 + line.len()
        };
        if needed <= cap {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
            continue;
        }
        if out.is_empty() {
            const MARK: &str = "…";
            let mut end = cap.saturating_sub(MARK.len());
            while end > 0 && !line.is_char_boundary(end) {
                end -= 1;
            }
            if end > 0 {
                out.push_str(&line[..end]);
                out.push_str(MARK);
            }
        }
        break;
    }
    (!out.is_empty()).then_some(out)
}

/// Read and cap the list; `None` when the file is missing, unreadable or
/// empty after cleaning.
pub fn read_affairs(paths: &LedgerPaths) -> Option<String> {
    use std::io::Read;
    let file = std::fs::File::open(paths.affairs_file()).ok()?;
    let mut bytes = Vec::new();
    if let Err(e) = file.take(READ_LIMIT_BYTES).read_to_end(&mut bytes) {
        eprintln!(
            "[ledger] reading {} failed: {e}",
            paths.affairs_file().display()
        );
        return None;
    }
    cap_affairs(&String::from_utf8_lossy(&bytes), AFFAIRS_CAP_BYTES)
}

/// The list to inject, under the ledger's switch: `None` while the
/// ledger is not on (the file is not read) or before the first run wrote
/// a list.
pub fn for_injection(on: bool, state_root: &Path) -> Option<String> {
    if !on {
        return None;
    }
    read_affairs(&LedgerPaths::new(state_root.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_whole_lines_from_the_top_within_the_cap() {
        let raw =
            "- 半马备赛：本周长距离 18 公里\n- 日语 N3：进度落后，下周补两课\n- 豆包控制体重\n";
        // Everything fits.
        assert_eq!(
            cap_affairs(raw, AFFAIRS_CAP_BYTES).as_deref(),
            Some(raw.trim_end())
        );
        // Room for exactly the first two lines and their separator.
        let two = "- 半马备赛：本周长距离 18 公里\n- 日语 N3：进度落后，下周补两课";
        assert_eq!(cap_affairs(raw, two.len()).as_deref(), Some(two));
        assert_eq!(
            cap_affairs(raw, two.len() - 1).as_deref(),
            Some("- 半马备赛：本周长距离 18 公里")
        );
    }

    /// The cap test of the ticket: whatever the model wrote, the list
    /// that reaches the prompt is at most `AFFAIRS_CAP_BYTES`, whole
    /// lines, valid UTF-8, top first.
    #[test]
    fn a_long_list_never_exceeds_the_cap() {
        let raw: String = (1..=200)
            .map(|i| format!("- 第 {i} 件事：进行中，最近一次提到是十月某日，还没有结果\n"))
            .collect();
        let capped = cap_affairs(&raw, AFFAIRS_CAP_BYTES).unwrap();
        assert!(capped.len() <= AFFAIRS_CAP_BYTES, "{}", capped.len());
        assert!(capped.starts_with("- 第 1 件事"));
        for line in capped.lines() {
            assert!(raw.lines().any(|l| l == line), "cut mid-line: {line}");
        }
        // Close to the cap, not far under it.
        let line_len = raw.lines().next().unwrap().len();
        assert!(capped.len() + line_len + 1 > AFFAIRS_CAP_BYTES);
    }

    /// A list within the mining task's limits (12 lines, 40 characters
    /// each, `super::super::batch::task_prompt`) is never cut.
    #[test]
    fn the_tasks_own_limits_fit_whole() {
        let line = format!("- {}", "事".repeat(40));
        let raw = vec![line; 12].join("\n");
        assert_eq!(
            cap_affairs(&raw, AFFAIRS_CAP_BYTES).as_deref(),
            Some(raw.as_str())
        );
    }

    #[test]
    fn blank_lines_and_headings_are_dropped() {
        let raw = "# 进行中的事项\n\n  - 搬家后整理新家  \n## Galley Runtime Layer\n- 学车\n\n";
        assert_eq!(
            cap_affairs(raw, AFFAIRS_CAP_BYTES).as_deref(),
            Some("- 搬家后整理新家\n- 学车")
        );
        assert_eq!(cap_affairs("\n# 只有标题\n\n", AFFAIRS_CAP_BYTES), None);
        assert_eq!(cap_affairs("", AFFAIRS_CAP_BYTES), None);
    }

    #[test]
    fn a_single_overlong_line_is_cut_at_a_character_boundary() {
        let raw = format!("- {}", "很长".repeat(1000));
        let capped = cap_affairs(&raw, AFFAIRS_CAP_BYTES).unwrap();
        assert!(capped.len() <= AFFAIRS_CAP_BYTES);
        assert!(capped.ends_with('…'));
        assert!(capped.starts_with("- 很长很长"));
    }

    #[test]
    fn nothing_while_the_ledger_is_off_or_before_the_first_list() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().to_path_buf());
        // On, but no run has written a list yet.
        assert_eq!(for_injection(true, dir.path()), None);
        std::fs::create_dir_all(paths.insight_dir()).unwrap();
        std::fs::write(paths.affairs_file(), "- 半马备赛\n").unwrap();
        assert_eq!(
            for_injection(true, dir.path()).as_deref(),
            Some("- 半马备赛")
        );
        // Off: the file is not even read.
        assert_eq!(for_injection(false, dir.path()), None);
        // A list the run emptied (no ongoing affairs) is no section.
        std::fs::write(paths.affairs_file(), "\n").unwrap();
        assert_eq!(for_injection(true, dir.path()), None);
    }

    /// Ticket 04: the numbers are Galley's; the model never sees them,
    /// and the caps count what is left.
    #[test]
    fn numbers_are_stripped_before_injection() {
        let raw = "- A001｜半马备赛：本周长距离 18 公里\n- A003 | 日语 N3\n- 没带编号的一行\nA004｜没有横线\n";
        assert_eq!(
            cap_affairs(raw, AFFAIRS_CAP_BYTES).as_deref(),
            Some("- 半马备赛：本周长距离 18 公里\n- 日语 N3\n- 没带编号的一行\n没有横线")
        );
        let line = format!("- A012｜{}", "事".repeat(40));
        let raw = vec![line; 12].join("\n");
        let capped = cap_affairs(&raw, AFFAIRS_CAP_BYTES).unwrap();
        assert_eq!(capped.lines().count(), 12);
        assert!(!capped.contains("A012"));
        // A line that is only a number is no item.
        assert_eq!(cap_affairs("- A001｜\n", AFFAIRS_CAP_BYTES), None);
    }

    #[test]
    fn removing_an_affair_takes_its_numbered_line_only() {
        let raw = "- A001｜半马\n- A003｜日语\n- 没编号\n- A0031｜别的\n";
        assert_eq!(
            remove_affair(raw, "A003").as_deref(),
            Some("- A001｜半马\n- 没编号\n- A0031｜别的\n")
        );
        assert_eq!(remove_affair(raw, "A009"), None);
        let crlf = raw.replace('\n', "\r\n");
        assert_eq!(
            remove_affair(&crlf, "A001").as_deref(),
            Some("- A003｜日语\r\n- 没编号\r\n- A0031｜别的\r\n")
        );
    }

    #[test]
    fn a_runaway_file_is_read_only_up_to_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LedgerPaths::new(dir.path().to_path_buf());
        std::fs::create_dir_all(paths.insight_dir()).unwrap();
        let line = "- 一件进行中的事\n";
        std::fs::write(paths.affairs_file(), line.repeat(100_000)).unwrap();
        let capped = read_affairs(&paths).unwrap();
        assert!(capped.len() <= AFFAIRS_CAP_BYTES);
    }
}
