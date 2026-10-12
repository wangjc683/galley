//! Main chat segments (`.scratch/main-chat/issues/03-segments-and-injection.md`,
//! 03a).
//!
//! The user sees the main chat as one thread; its runner sees one
//! segment of it. The rule is deterministic: **after the main chat has
//! been idle for more than N hours, the next message starts a new
//! segment.** N is the hidden Core pref [`IDLE_HOURS_PREF`] (default
//! [`DEFAULT_IDLE_HOURS`], no Settings UI). "Idle" is measured from
//! `sessions.last_activity_at`, which moves when a turn ends and when a
//! message is written, and nothing else.
//!
//! - **Recorded, not re-derived.** A boundary is written once, when Core
//!   decides (`main_chat_segments`, migration 046), as the `turn_index`
//!   the next message gets. Replay reads it back, so a runner restored
//!   after a Core restart gets exactly the segment the live runner had,
//!   and tuning N later never moves a past boundary. A path that does not
//!   apply the rule (below) simply continues the current segment.
//! - **Only between turns.** No cut while a run is going, while an
//!   `ask_user` question waits for its answer (live, or the latest reply
//!   ending on one, which survives a restart), or when the current
//!   segment has nothing in it yet.
//! - **Fresh context = a fresh runner.** Recording a boundary retires a
//!   live runner (quietly, like ensure's own restart): the next ensure
//!   spawns one whose GA history holds nothing from earlier segments and
//!   whose session-start state block — including the main chat's
//!   ongoing-affairs list ([`crate::ledger::affairs`]) — is composed
//!   anew. `load_history` with nothing would empty the history but keep
//!   the state block the runner was spawned with.
//!
//! Where the rule is applied: [`super::ensure_session_runner`] (every
//! caller: the GUI opening the main chat, a `/btw`, a Goal) and Core's
//! send ([`crate::session_send`]) just before it persists the message —
//! after that the message has moved `last_activity_at`, so the ensure
//! that follows finds nothing to do. Judging at ensure time records the
//! boundary a little before its first message (the GUI ensures on open);
//! the boundary is the same one, since the idle gap only grows until the
//! next message and the next message gets the recorded `turn_index`.
//! Not applied: socket `session send` and the queue drain dispatch to a
//! live runner as they always did (the drain runs right after a run
//! ends, so it is never idle), and a Goal persists its objective before
//! its ensure, so a Goal started on an idle main chat continues the
//! current segment.

use super::RunnerHost;
use crate::api::{GalleyApi, SessionId};
use crate::db::MainChatSegmentFacts;
use chrono::{DateTime, Duration, Utc};

/// Hidden Core pref: the main chat's idle threshold in hours (a JSON
/// number; fractions allowed, so `0.01` cuts after 36 seconds of
/// silence). Read on every judgement — no restart needed.
pub const IDLE_HOURS_PREF: &str = "main_chat_segment_idle_hours";

/// N when the pref is unset or unusable: a lunch break or a short
/// meeting stays in one segment, a night always ends one.
pub const DEFAULT_IDLE_HOURS: f64 = 4.0;

/// Upper bound on a usable pref (a year), so the conversion cannot
/// overflow.
const MAX_IDLE_HOURS: f64 = 24.0 * 366.0;

/// The pref value as a threshold. `None` (unset), a non-number, zero,
/// a negative or a non-finite number all mean [`DEFAULT_IDLE_HOURS`]; a
/// set but unusable value is logged.
pub fn idle_threshold_from(pref: Option<&serde_json::Value>) -> Duration {
    let hours = match pref {
        None | Some(serde_json::Value::Null) => DEFAULT_IDLE_HOURS,
        Some(value) => match value.as_f64() {
            Some(h) if h.is_finite() && h > 0.0 => h.min(MAX_IDLE_HOURS),
            _ => {
                eprintln!(
                    "[segment] {IDLE_HOURS_PREF}={value} is not a positive number of hours; \
                     using {DEFAULT_IDLE_HOURS}"
                );
                DEFAULT_IDLE_HOURS
            }
        },
    };
    Duration::milliseconds((hours * 3_600_000.0).round() as i64)
}

/// The segment rule on one snapshot: the `turn_index` a new segment
/// starts at, or `None` to stay in the current one. The caller has
/// already established that no run is going. Strictly more than `idle`
/// cuts: exactly N hours of silence does not.
pub fn decide(facts: &MainChatSegmentFacts, now: DateTime<Utc>, idle: Duration) -> Option<i64> {
    if facts.ends_on_question {
        return None;
    }
    // Nothing written since the current segment began: it is still fresh.
    if facts.next_turn_index <= facts.segment_start.unwrap_or(0) {
        return None;
    }
    let last = match DateTime::parse_from_rfc3339(&facts.last_activity_at) {
        Ok(at) => at.with_timezone(&Utc),
        Err(e) => {
            eprintln!(
                "[segment] unreadable last_activity_at {:?}: {e}; not cutting",
                facts.last_activity_at
            );
            return None;
        }
    };
    (now - last > idle).then_some(facts.next_turn_index)
}

/// Apply the rule to `session_id` if it is the main chat. The caller
/// holds the session's single-flight slot. `holds_run_gate`: the caller
/// reserved the run gate itself, so an open gate is not a run going
/// (Core's send). Returns the new segment's start when one was recorded.
/// Never fails: a database error is logged and leaves the segment as it
/// is — the main chat must still open.
pub(super) async fn open_if_due(
    host: &RunnerHost<'_>,
    session_id: &str,
    holds_run_gate: bool,
) -> Option<i64> {
    match host.galley.main_chat_id().await {
        Ok(Some(id)) if id.as_str() == session_id => {}
        Ok(_) => return None,
        Err(e) => {
            eprintln!("[segment {session_id}] main chat lookup failed: {e}");
            return None;
        }
    }
    let state = host.runner.run_state(session_id).await;
    if state.agent_running || (state.open_run && !holds_run_gate) || state.ask_pending {
        return None;
    }
    let sid = SessionId(session_id.to_string());
    let facts = match host.galley.main_chat_segment_facts(&sid).await {
        Ok(facts) => facts,
        Err(e) => {
            eprintln!("[segment {session_id}] reading the segment facts failed: {e}");
            return None;
        }
    };
    let pref = host
        .galley
        .get_pref_json(IDLE_HOURS_PREF)
        .await
        .ok()
        .flatten();
    let start = decide(&facts, Utc::now(), idle_threshold_from(pref.as_ref()))?;
    if let Err(e) = host.galley.record_main_chat_segment(&sid, start).await {
        eprintln!("[segment {session_id}] recording a boundary at turn {start} failed: {e}");
        return None;
    }
    let retired = match host.runner.live_pid(session_id).await {
        Some(pid) => {
            host.runner.retire(session_id, pid).await;
            format!("; retired runner pid {pid}")
        }
        None => String::new(),
    };
    eprintln!(
        "[segment {session_id}] idle since {}: new segment from turn {start}{retired}",
        facts.last_activity_at
    );
    Some(start)
}

/// What the main chat's session-start state block says about the
/// conversation (ticket 03b): it is the main chat, its id, and where the
/// segment its runner holds begins — so the model can tell a search hit
/// from an earlier segment (`turnIndex` below the start) and look it up
/// instead of guessing. Read at spawn, like the ongoing-affairs list: a
/// new segment retires the runner, so the start never changes under a
/// live one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MainChatPromptState {
    pub session_id: String,
    /// `turnIndex` of the current segment's first message; 0 in the
    /// first segment.
    pub segment_start_turn: i64,
    /// The local calendar day (`YYYY-MM-DD`) the segment began.
    pub segment_start_date: String,
}

/// [`MainChatPromptState`] for a runner of `session_id`, in this
/// machine's time zone. `None` unless it is the main chat (or on a
/// database error, logged: the runner still starts, with the ordinary
/// prompt).
pub async fn prompt_state(
    galley: &crate::db::SqliteGalley,
    session_id: &str,
) -> Option<MainChatPromptState> {
    prompt_state_in(galley, session_id, &chrono::Local).await
}

/// [`prompt_state`] with an explicit time zone (tests).
pub async fn prompt_state_in<Tz: chrono::TimeZone>(
    galley: &crate::db::SqliteGalley,
    session_id: &str,
    tz: &Tz,
) -> Option<MainChatPromptState> {
    match galley.main_chat_id().await {
        Ok(Some(id)) if id.as_str() == session_id => {}
        Ok(_) => return None,
        Err(e) => {
            eprintln!("[segment {session_id}] main chat lookup failed: {e}");
            return None;
        }
    }
    let start = match galley
        .main_chat_current_segment(&SessionId(session_id.to_string()))
        .await
    {
        Ok(Some(start)) => start,
        Ok(None) => return None,
        Err(e) => {
            eprintln!("[segment {session_id}] reading the segment start failed: {e}");
            return None;
        }
    };
    // Stored times are RFC 3339; anything else keeps its date part as
    // written rather than dropping the block.
    let segment_start_date = DateTime::parse_from_rfc3339(&start.started_at)
        .map(|at| at.with_timezone(tz).date_naive().to_string())
        .unwrap_or_else(|_| start.started_at.chars().take(10).collect());
    Some(MainChatPromptState {
        session_id: session_id.to_string(),
        segment_start_turn: start.start_turn_index,
        segment_start_date,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn facts(last_activity_at: &str) -> MainChatSegmentFacts {
        MainChatSegmentFacts {
            last_activity_at: last_activity_at.into(),
            next_turn_index: 6,
            segment_start: None,
            ends_on_question: false,
        }
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const LAST: &str = "2026-10-12T08:00:00+00:00";

    #[test]
    fn exactly_n_hours_stays_more_than_n_cuts() {
        let four = Duration::hours(4);
        assert_eq!(decide(&facts(LAST), at("2026-10-12T12:00:00Z"), four), None);
        assert_eq!(
            decide(&facts(LAST), at("2026-10-12T12:00:01Z"), four),
            Some(6),
            "a new segment starts at the next message's turn index"
        );
        assert_eq!(decide(&facts(LAST), at("2026-10-12T09:00:00Z"), four), None);
    }

    #[test]
    fn a_pending_question_is_never_cut_off_from_its_answer() {
        let mut f = facts(LAST);
        f.ends_on_question = true;
        assert_eq!(
            decide(&f, at("2026-10-13T08:00:00Z"), Duration::hours(4)),
            None
        );
    }

    #[test]
    fn an_empty_segment_is_not_cut_again() {
        let now = at("2026-10-13T08:00:00Z");
        let mut f = facts(LAST);
        // The boundary was recorded and nothing written since.
        f.segment_start = Some(6);
        assert_eq!(decide(&f, now, Duration::hours(4)), None);
        // Something was written since: the next idle gap cuts again.
        f.next_turn_index = 8;
        assert_eq!(decide(&f, now, Duration::hours(4)), Some(8));
        // A main chat with no message at all has nothing to cut.
        let mut empty = facts(LAST);
        empty.next_turn_index = 0;
        assert_eq!(decide(&empty, now, Duration::hours(4)), None);
    }

    #[test]
    fn an_unreadable_or_future_time_does_not_cut() {
        let now = at("2026-10-13T08:00:00Z");
        assert_eq!(decide(&facts("yesterday"), now, Duration::hours(4)), None);
        assert_eq!(
            decide(&facts("2026-10-14T08:00:00+00:00"), now, Duration::hours(4)),
            None
        );
    }

    #[test]
    fn the_pref_falls_back_to_four_hours() {
        assert_eq!(idle_threshold_from(None), Duration::hours(4));
        assert_eq!(idle_threshold_from(Some(&json!(null))), Duration::hours(4));
        assert_eq!(idle_threshold_from(Some(&json!(6))), Duration::hours(6));
        assert_eq!(
            idle_threshold_from(Some(&json!(0.01))),
            Duration::seconds(36)
        );
        for bad in [json!(0), json!(-2), json!("4"), json!(true)] {
            assert_eq!(idle_threshold_from(Some(&bad)), Duration::hours(4), "{bad}");
        }
        assert_eq!(
            idle_threshold_from(Some(&json!(1e12))),
            Duration::hours(24 * 366)
        );
    }
}
