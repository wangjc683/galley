//! Memos (main chat ticket 95; main chat PRD rulings 140, 141, 143): what
//! Galley knows about the user.
//!
//! A to-do records something to do; a memo records something known — what
//! the user is called, their family, what they prefer or avoid, the people
//! and places they deal with, an interest that keeps coming up. It does not
//! get done: it holds, or stops holding, and one that stops on a day
//! carries that day ([`MemoBrief::until`]). Galley writes it in the turn
//! it learns it, through the CLI (`galley memo add / update / delete`); the
//! user can only delete one on the desktop (the panel's 「备忘」 page,
//! ticket 97). Core holds the record (`memos` and `memo_events`, migration
//! 053) and decides every write (Rule 5).
//!
//! Whether to note something is the model's call (the manual, ticket 96);
//! how much is Core's, by deterministic rules (ruling 141): one memo is at
//! most [`MEMO_TEXT_MAX_CHARS`] characters, refused past it; the memos that
//! hold come to at most [`MEMO_TOTAL_MAX_CHARS`] characters at the start of
//! a segment, and a write that takes them past it is kept and says so
//! ([`MemoOverLimit`]). A memo past its day is in no reader: not the
//! segment's start, not `memo list`, not the panel, not the total — and its
//! row stays, as Core deletes nothing of the user's on its own.
//!
//! The morning review also wakes for the memos noted or changed since the
//! last one, in turns the user started ([`MemoReviewWindow`], ruling 143).

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use super::schedule::{resolve_wall_clock, ScheduledTaskCreatedIn, TIME_IN_PAST};
use super::{Origin, SessionId};
use crate::error::{GalleyError, Result};

/// Tauri event fired after any memo change: noted, changed, deleted (from
/// the CLI or the desktop), the turn it was written in settled, every memo
/// cleared by a main chat reset. Payload is empty — the desktop reads
/// again, as for [`super::TODOS_CHANGED_EVENT`]. Desktop only: the remote
/// module does not forward it.
pub const MEMOS_CHANGED_EVENT: &str = "memos:changed";

/// A memo is at most this many characters once trimmed — Unicode scalar
/// values (`str::chars`), not bytes: 「我不吃香菜」 is 5. Past it a write is
/// refused (`invalid_args`), the message saying the limit and the count.
/// Main chat PRD ruling 141 point 4: one thing per memo, said in a
/// sentence.
pub const MEMO_TEXT_MAX_CHARS: usize = 100;

/// What the start of a main chat segment holds of the memos, in
/// characters of their text, the ones that hold summed; also the total a
/// write is measured against. Main chat PRD ruling 141 points 1 and 6:
/// about 2.5% of a segment at its busiest (80,000 characters), so what has
/// to be kept out is what is of no use, not the size. A write that takes
/// the total past it is kept and says by how much ([`MemoOverLimit`]); the
/// segment start then leaves the last ones noted out and says how many.
pub const MEMO_TOTAL_MAX_CHARS: usize = 2_000;

/// Opaque memo identifier, `memo_<16 hex>` ([`mint_memo_id`]).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoId(pub String);

impl MemoId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MemoId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Mint a memo id: `memo_` and 16 hex digits, as a to-do's
/// ([`super::todo::mint_todo_id`]).
pub fn mint_memo_id() -> String {
    format!("memo_{}", super::schedule::mint_hex16())
}

/// The record (what `memo list` prints and every write returns).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoBrief {
    pub id: MemoId,
    pub text: String,
    /// The last day it holds, a local date `YYYY-MM-DD`; absent for a
    /// memo with no end.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    /// Who noted it.
    pub origin: Origin,
    /// The main chat turn Galley noted it in, as for a to-do.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_in: Option<ScheduledTaskCreatedIn>,
    pub created_at: String,
    /// When its text or its day last changed.
    pub updated_at: String,
}

impl MemoBrief {
    /// Its text in characters, as the limits count them.
    pub fn chars(&self) -> usize {
        self.text.chars().count()
    }
}

/// The memos that hold come to more than [`MEMO_TOTAL_MAX_CHARS`] after a
/// write (`overLimit` next to `memo` in what `memo add` and `memo update`
/// print). The write was kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoOverLimit {
    /// The total now, in characters.
    pub chars: usize,
    /// [`MEMO_TOTAL_MAX_CHARS`].
    pub limit: usize,
    /// `chars - limit`.
    pub over: usize,
    /// The same in a sentence, for whoever reads it.
    pub message: String,
}

impl MemoOverLimit {
    /// `Some` when `chars` is past the limit.
    pub fn of(chars: usize) -> Option<Self> {
        let limit = MEMO_TOTAL_MAX_CHARS;
        (chars > limit).then(|| Self {
            chars,
            limit,
            over: chars - limit,
            message: format!(
                "Memos now total {chars} characters, {} over the {limit} the start of each \
                 segment holds, so the last ones noted will be left out of it: merge memos or \
                 delete the ones out of date first.",
                chars - limit
            ),
        })
    }
}

/// What a write returns: the memo, and [`MemoOverLimit`] when the memos
/// are past the total (`memo add`, `memo update`; never a delete).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoWrite {
    pub memo: MemoBrief,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub over_limit: Option<MemoOverLimit>,
}

/// What a new memo says ([`crate::db::SqliteGalley::create_memo`]).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoInput {
    pub text: String,
    /// The last day it holds, `YYYY-MM-DD` ([`parse_memo_until`]).
    #[serde(default)]
    pub until: Option<String>,
}

/// A change: only what is given. `until: Some(None)` takes the day off.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<Option<String>>,
}

/// What a write did to a memo (`memo_events.action`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoAction {
    /// Noted (`memo add`): 「记下了 · …」.
    Add,
    /// Changed (`memo update`): 「改为 · …」.
    Update,
    /// Deleted, by Galley or on the desktop: 「不再记 · …」.
    Delete,
}

impl MemoAction {
    /// The stored value.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }

    /// From the stored value.
    pub fn from_sql(value: &str) -> Option<Self> {
        match value {
            "add" => Some(Self::Add),
            "update" => Some(Self::Update),
            "delete" => Some(Self::Delete),
            _ => None,
        }
    }
}

/// A memo as the desktop's 「备忘」 page lists it (Tauri `list_memos`): the
/// record, and where in the main chat it was last noted or changed — the
/// row jumps there.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoItem {
    #[serde(flatten)]
    pub memo: MemoBrief,
    /// The turn of the last add or update written in a main chat run
    /// (its reply's `turnIndex` once that run ended). Absent when no
    /// write of it was.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_in: Option<ScheduledTaskCreatedIn>,
}

/// One write of a memo in the main chat, for the card under the reply it
/// was made in (Tauri `list_memo_events`): what was done, the memo's words
/// after it (before it, for a delete), and whether the memo is still
/// there.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoEventItem {
    /// In the order they were written.
    pub id: i64,
    pub memo_id: MemoId,
    pub action: MemoAction,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    pub session_id: SessionId,
    /// The reply the card hangs under, filled when the run ends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_index: Option<i64>,
    /// Whether the memo is still there (not deleted since).
    pub memo_exists: bool,
    pub created_at: String,
}

fn invalid(message: String) -> GalleyError {
    GalleyError::InvalidArgs { message }
}

/// A memo's text: trimmed, 1 to [`MEMO_TEXT_MAX_CHARS`] characters.
///
/// **Errors**: `invalid_args`, saying the limit and how long it is.
pub fn checked_memo_text(raw: &str, context: &str) -> Result<String> {
    let text = raw.trim();
    let chars = text.chars().count();
    if chars == 0 || chars > MEMO_TEXT_MAX_CHARS {
        return Err(invalid(format!(
            "{context}: a memo is 1 to {MEMO_TEXT_MAX_CHARS} characters once trimmed; this one \
             is {chars}"
        )));
    }
    Ok(text.to_string())
}

/// Read a memo's last day (CLI `--until`): a local date `YYYY-MM-DD`, not
/// before `today` (this machine's day; today itself is fine: it holds to
/// the end of it).
///
/// **Errors**: `invalid_args`; [`TIME_IN_PAST`] for a day already over.
pub fn parse_memo_until(raw: &str, today: NaiveDate, context: &str) -> Result<NaiveDate> {
    let value = raw.trim();
    let day = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
        invalid(format!(
            "{context}: until is a local date YYYY-MM-DD, got {value:?}"
        ))
    })?;
    if day < today {
        return Err(invalid(format!(
            "{TIME_IN_PAST}: {context}: until {day} is before today ({today})"
        )));
    }
    Ok(day)
}

/// Whether a memo with this last day (`None`: no end) holds on `today`.
/// A day that does not read (Core never writes one) holds: shown once too
/// often beats lost.
pub fn memo_holds(until: Option<&str>, today: NaiveDate) -> bool {
    match until {
        None => true,
        Some(day) => NaiveDate::parse_from_str(day, "%Y-%m-%d").map_or(true, |day| day >= today),
    }
}

/// The days the morning review looks over for new memos (main chat ticket
/// 95, PRD ruling 143 point 2): from midnight of the day the review last
/// came due (woken or skipped, `last_fired_at` before this fire), or of
/// yesterday when it never did, to midnight of today, local, today out.
/// Each memo falls in one window: a computer asleep for a day loses none
/// (the window reaches back to the last review), one noted this morning
/// before the review is tomorrow's, and the review run again today has an
/// empty window. A memo is in it when it was noted or changed in a turn
/// the user started within it (`memos.fresh_at`), still holds on the
/// review's day, and is still there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoReviewWindow {
    /// The first day in.
    pub since: NaiveDate,
    /// The review's own day, the first day out.
    pub until: NaiveDate,
    /// `since`'s first instant in the zone it was made in.
    pub since_at: DateTime<Utc>,
    /// `until`'s first instant.
    pub until_at: DateTime<Utc>,
}

impl MemoReviewWindow {
    /// The window of a review coming due at `now`, the one before it
    /// having come due at `last_review_at` (UTC ISO, `None` for none),
    /// both read in `tz` (this machine's zone in production).
    pub fn before<Tz: TimeZone>(last_review_at: Option<&str>, now: DateTime<Utc>, tz: &Tz) -> Self {
        let until = now.with_timezone(tz).date_naive();
        let since = last_review_at
            .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
            .map(|at| at.with_timezone(tz).date_naive())
            .unwrap_or(until - Duration::days(1));
        let midnight = |day: NaiveDate| {
            resolve_wall_clock(tz, day.and_time(NaiveTime::MIN)).with_timezone(&Utc)
        };
        Self {
            since,
            until,
            since_at: midnight(since),
            until_at: midnight(until),
        }
    }

    /// The window as JSON (`since` and `until` as `YYYY-MM-DD`, the two
    /// instants as UTC ISO), for the scheduler to keep with a review's
    /// fire until its wake is written.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "since": self.since.format("%Y-%m-%d").to_string(),
            "until": self.until.format("%Y-%m-%d").to_string(),
            "sinceAt": super::schedule::instant_to_utc_iso(&self.since_at),
            "untilAt": super::schedule::instant_to_utc_iso(&self.until_at),
        })
    }

    /// [`Self::to_json`] read back; `None` for anything else.
    pub fn from_json(value: &serde_json::Value) -> Option<Self> {
        let day = |key: &str| NaiveDate::parse_from_str(value.get(key)?.as_str()?, "%Y-%m-%d").ok();
        let at = |key: &str| {
            DateTime::parse_from_rfc3339(value.get(key)?.as_str()?)
                .ok()
                .map(|at| at.with_timezone(&Utc))
        };
        Some(Self {
            since: day("since")?,
            until: day("until")?,
            since_at: at("sinceAt")?,
            until_at: at("untilAt")?,
        })
    }

    /// No day in it: the review before this one came due today (or later,
    /// with the clock set back).
    pub fn is_empty(&self) -> bool {
        self.since >= self.until
    }

    /// Whether a memo noted or changed at `fresh_at` (in a turn the user
    /// started; `None`: never), with last day `until_date`, is in it.
    pub fn takes(&self, fresh_at: Option<&str>, until_date: Option<&str>) -> bool {
        let Some(at) = fresh_at.and_then(|at| DateTime::parse_from_rfc3339(at).ok()) else {
            return false;
        };
        let at = at.with_timezone(&Utc);
        !self.is_empty()
            && at >= self.since_at
            && at < self.until_at
            && memo_holds(until_date, self.until)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::Los_Angeles;
    use chrono_tz::Asia::Shanghai;

    fn utc(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn a_memo_is_one_to_a_hundred_characters_counted_as_characters() {
        let refused = |raw: &str| match checked_memo_text(raw, "memo") {
            Err(GalleyError::InvalidArgs { message }) => message,
            other => panic!("{raw:?}: {other:?}"),
        };
        assert_eq!(
            refused("   "),
            "memo: a memo is 1 to 100 characters once trimmed; this one is 0"
        );
        assert_eq!(refused(""), refused(" \n "));
        assert_eq!(checked_memo_text(" 我 ", "memo").unwrap(), "我");
        // A hundred three-byte characters, and a hundred four-byte ones:
        // characters, not bytes.
        let hundred = "香".repeat(100);
        assert_eq!(checked_memo_text(&hundred, "memo").unwrap(), hundred);
        let emoji = "🏀".repeat(100);
        assert_eq!(emoji.len(), 400);
        assert_eq!(checked_memo_text(&emoji, "memo").unwrap(), emoji);
        assert!(refused(&format!("{hundred}菜")).ends_with("; this one is 101"));
        assert!(refused(&"🏀".repeat(101)).ends_with("; this one is 101"));
        // Whitespace inside counts, around it does not.
        assert!(checked_memo_text(&format!("  {}  ", "a".repeat(100)), "memo").is_ok());
        assert!(refused(&format!("{} {}", "a".repeat(50), "b".repeat(50))).ends_with("is 101"));
    }

    #[test]
    fn until_is_a_day_not_before_today() {
        let today = day("2026-10-26");
        assert_eq!(
            parse_memo_until("2026-10-26", today, "memo").unwrap(),
            today
        );
        assert_eq!(
            parse_memo_until(" 2026-11-01 ", today, "memo").unwrap(),
            day("2026-11-01")
        );
        match parse_memo_until("2026-10-25", today, "memo") {
            Err(GalleyError::InvalidArgs { message }) => {
                assert!(
                    message.starts_with("time_in_past: memo: until 2026-10-25"),
                    "{message}"
                )
            }
            other => panic!("{other:?}"),
        }
        for bad in ["Friday", "2026-10-26T09:00", "26/10/2026", ""] {
            assert!(
                matches!(
                    parse_memo_until(bad, today, "memo"),
                    Err(GalleyError::InvalidArgs { ref message }) if !message.starts_with("time_in_past")
                ),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn a_memo_holds_through_its_day() {
        let today = day("2026-10-26");
        assert!(memo_holds(None, today));
        assert!(memo_holds(Some("2026-10-26"), today));
        assert!(memo_holds(Some("2026-10-27"), today));
        assert!(!memo_holds(Some("2026-10-25"), today));
        assert!(memo_holds(Some("not a day"), today));
    }

    #[test]
    fn over_the_total_says_by_how_much() {
        assert_eq!(MemoOverLimit::of(MEMO_TOTAL_MAX_CHARS), None);
        let over = MemoOverLimit::of(2_010).expect("over");
        assert_eq!((over.chars, over.limit, over.over), (2_010, 2_000, 10));
        assert_eq!(
            over.message,
            "Memos now total 2010 characters, 10 over the 2000 the start of each segment holds, \
             so the last ones noted will be left out of it: merge memos or delete the ones out \
             of date first."
        );
        let wire = serde_json::to_value(&over).unwrap();
        assert_eq!(wire["chars"], 2_010);
        assert_eq!(wire["limit"], 2_000);
        assert_eq!(wire["over"], 10);
    }

    #[test]
    fn ids_are_memo_and_sixteen_hex() {
        let a = mint_memo_id();
        assert_ne!(a, mint_memo_id());
        let hex = a.strip_prefix("memo_").expect("prefix");
        assert_eq!(hex.len(), 16);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// The review's window, in the zone it reads days in (ticket 81's
    /// way: the zone passed in, not this machine's).
    #[test]
    fn the_review_window_runs_from_the_last_reviews_day_to_today() {
        // Shanghai, the review at 09:03 on the 26th.
        let now = utc("2026-10-26T01:03:00Z");
        // Yesterday's review: the 25th, all of it.
        let w = MemoReviewWindow::before(Some("2026-10-25T01:07:00+00:00"), now, &Shanghai);
        assert_eq!((w.since, w.until), (day("2026-10-25"), day("2026-10-26")));
        assert_eq!(w.since_at, utc("2026-10-24T16:00:00Z"));
        assert_eq!(w.until_at, utc("2026-10-25T16:00:00Z"));
        // Before the last review that day, after it, late that night: in.
        for at in [
            "2026-10-24T16:00:00+00:00",
            "2026-10-25T00:30:00+00:00",
            "2026-10-25T15:59:59+00:00",
        ] {
            assert!(w.takes(Some(at), None), "{at}");
        }
        // This morning before the review, and the day before yesterday: out.
        for at in ["2026-10-25T16:00:00+00:00", "2026-10-24T15:59:59+00:00"] {
            assert!(!w.takes(Some(at), None), "{at}");
        }
        // Never in a turn the user started: out.
        assert!(!w.takes(None, None));
        // Past its day on the review's day: out. Its last day today: in.
        let at = Some("2026-10-25T03:00:00+00:00");
        assert!(!w.takes(at, Some("2026-10-25")));
        assert!(w.takes(at, Some("2026-10-26")));

        // Asleep through the 25th's review: the window reaches back to the
        // 24th's, so a memo of the 24th's evening is not lost.
        let w = MemoReviewWindow::before(Some("2026-10-24T01:05:00+00:00"), now, &Shanghai);
        assert_eq!((w.since, w.until), (day("2026-10-24"), day("2026-10-26")));
        assert!(w.takes(Some("2026-10-24T12:00:00+00:00"), None));
        assert!(w.takes(Some("2026-10-25T12:00:00+00:00"), None));

        // Never reviewed: from yesterday.
        let w = MemoReviewWindow::before(None, now, &Shanghai);
        assert_eq!((w.since, w.until), (day("2026-10-25"), day("2026-10-26")));
        let unreadable = MemoReviewWindow::before(Some("yesterday"), now, &Shanghai);
        assert_eq!(unreadable, w);

        // Run again today: empty, whatever was noted.
        let w = MemoReviewWindow::before(Some("2026-10-26T01:00:00+00:00"), now, &Shanghai);
        assert!(w.is_empty());
        assert!(!w.takes(Some("2026-10-25T12:00:00+00:00"), None));
        assert!(!w.takes(Some("2026-10-26T01:01:00+00:00"), None));
        // The clock set back past the last review: empty too.
        let w = MemoReviewWindow::before(Some("2026-10-27T01:00:00+00:00"), now, &Shanghai);
        assert!(w.is_empty());

        // Kept as JSON and read back as it was.
        let w = MemoReviewWindow::before(Some("2026-10-24T01:05:00+00:00"), now, &Shanghai);
        let kept = w.to_json();
        assert_eq!(
            kept,
            serde_json::json!({
                "since": "2026-10-24",
                "until": "2026-10-26",
                "sinceAt": "2026-10-23T16:00:00+00:00",
                "untilAt": "2026-10-25T16:00:00+00:00",
            })
        );
        assert_eq!(MemoReviewWindow::from_json(&kept), Some(w));
        assert_eq!(MemoReviewWindow::from_json(&serde_json::json!({})), None);
    }

    #[test]
    fn the_review_window_reads_days_in_its_zone() {
        // 2026-10-26 01:03 UTC is the 26th in Shanghai and the 25th in Los
        // Angeles: the same instants make different days.
        let now = utc("2026-10-26T01:03:00Z");
        let last = Some("2026-10-25T01:07:00+00:00");
        let la = MemoReviewWindow::before(last, now, &Los_Angeles);
        assert_eq!((la.since, la.until), (day("2026-10-24"), day("2026-10-25")));
        assert_eq!(la.since_at, utc("2026-10-24T07:00:00Z"));
        assert_eq!(la.until_at, utc("2026-10-25T07:00:00Z"));
        // 2026-10-25 03:00 UTC: the 25th in Shanghai (in its window), the
        // 24th in Los Angeles (in its).
        assert!(la.takes(Some("2026-10-25T03:00:00+00:00"), None));
        // Midnight across a change of clocks (Los Angeles leaves daylight
        // time on 2026-11-01): the first instant of each local day.
        let w = MemoReviewWindow::before(
            Some("2026-11-01T16:00:00+00:00"),
            utc("2026-11-02T17:00:00Z"),
            &Los_Angeles,
        );
        assert_eq!((w.since, w.until), (day("2026-11-01"), day("2026-11-02")));
        assert_eq!(w.since_at, utc("2026-11-01T07:00:00Z"));
        assert_eq!(w.until_at, utc("2026-11-02T08:00:00Z"));
    }
}
