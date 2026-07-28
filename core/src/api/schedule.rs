//! Scheduled tasks: "project + prompt + repeat rule + enabled switch".
//!
//! Firing a scheduled task creates an ordinary session through the
//! existing command path — no new session type. This module holds the
//! wire types plus the pure next-fire calendar math shared by the Core
//! scheduler loop and the read path (`nextFireAt` on the brief).
//!
//! Time model: the repeat rule is LOCAL wall clock ("every day at
//! 09:00" follows the user across timezones), so next-fire math runs on
//! `NaiveDateTime` and is resolved to an instant only at the edge
//! ([`resolve_wall_clock`]), where DST gaps / ambiguities are handled.

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat,
    TimeZone, Utc,
};
use serde::{Deserialize, Serialize};

use super::{ProjectId, SessionId};
use crate::error::{GalleyError, Result};

/// Tauri event fired after any scheduled-task state change (CRUD from
/// the GUI, scheduler marking a fire). Payload is empty — the GUI
/// refetches; the DB stays authoritative and events are best-effort.
pub const SCHEDULED_TASKS_CHANGED_EVENT: &str = "scheduled-tasks:changed";

/// Opaque scheduled-task identifier (GUI mints `sched_<random16>`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ScheduledTaskId(pub String);

impl ScheduledTaskId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ScheduledTaskId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Repeat rules: daily, weekly on a set of ISO weekdays (Mon=1 …
/// Sun=7), or monthly on a set of month days (1..=31). Kept as a
/// tagged enum so later kinds (`every_nh`, …) are additive on the wire.
///
/// Monthly clamps to short months: a task on the 31st fires on Apr 30
/// and Feb 28/29 rather than silently skipping the month — a
/// month-end task that vanishes half the year destroys trust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduledTaskRepeat {
    Daily,
    Weekly { weekdays: Vec<u8> },
    Monthly { monthdays: Vec<u8> },
}

fn normalize_days(mut days: Vec<u8>, max: u8, what: &str) -> Result<Vec<u8>> {
    days.sort_unstable();
    days.dedup();
    if days.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: format!("scheduled task: {what} repeat needs at least one day"),
        });
    }
    if days.iter().any(|d| !(1..=max).contains(d)) {
        return Err(GalleyError::InvalidArgs {
            message: format!("scheduled task: {what} days must be 1..={max}"),
        });
    }
    Ok(days)
}

impl ScheduledTaskRepeat {
    /// Validate and normalize: day sets sorted, deduped, non-empty,
    /// weekly in 1..=7, monthly in 1..=31.
    pub fn normalized(self) -> Result<Self> {
        match self {
            Self::Daily => Ok(Self::Daily),
            Self::Weekly { weekdays } => Ok(Self::Weekly {
                weekdays: normalize_days(weekdays, 7, "weekly")?,
            }),
            Self::Monthly { monthdays } => Ok(Self::Monthly {
                monthdays: normalize_days(monthdays, 31, "monthly")?,
            }),
        }
    }

    fn allows_date(&self, date: NaiveDate) -> bool {
        match self {
            Self::Daily => true,
            Self::Weekly { weekdays } => {
                weekdays.contains(&(date.weekday().number_from_monday() as u8))
            }
            Self::Monthly { monthdays } => {
                let last = last_day_of_month(date);
                let day = date.day() as u8;
                monthdays.iter().any(|&d| d.min(last) == day)
            }
        }
    }
}

fn last_day_of_month(date: NaiveDate) -> u8 {
    let (y, m) = (date.year(), date.month());
    let first_of_next = if m == 12 {
        NaiveDate::from_ymd_opt(y + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(y, m + 1, 1)
    }
    .expect("first of month is always valid");
    (first_of_next - Duration::days(1)).day() as u8
}

/// Parse and validate a `"HH:MM"` local wall-clock string.
pub fn parse_time_of_day(raw: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(raw, "%H:%M").map_err(|_| GalleyError::InvalidArgs {
        message: format!("scheduled task: time_of_day must be HH:MM, got {raw:?}"),
    })
}

/// Next wall-clock fire strictly after `after`. Pure calendar math on
/// naive local time — DST resolution happens in [`resolve_wall_clock`].
pub fn next_fire_after(
    repeat: &ScheduledTaskRepeat,
    time_of_day: NaiveTime,
    after: NaiveDateTime,
) -> NaiveDateTime {
    let mut candidate = after.date().and_time(time_of_day);
    if candidate <= after {
        candidate += Duration::days(1);
    }
    // Bounded walk: weekly hits within 7 days, monthly within 31
    // (clamping guarantees every month has at least one fire day).
    while !repeat.allows_date(candidate.date()) {
        candidate += Duration::days(1);
    }
    candidate
}

/// Most recent wall-clock fire at or before `at` — the scheduler's
/// catch-up anchor ("should today's 09:00 already have fired?").
pub fn prev_fire_at_or_before(
    repeat: &ScheduledTaskRepeat,
    time_of_day: NaiveTime,
    at: NaiveDateTime,
) -> NaiveDateTime {
    let mut candidate = at.date().and_time(time_of_day);
    if candidate > at {
        candidate -= Duration::days(1);
    }
    while !repeat.allows_date(candidate.date()) {
        candidate -= Duration::days(1);
    }
    candidate
}

/// Resolve a naive local wall-clock time to an instant in `tz`.
///
/// - DST fall-back (time exists twice): the earlier instant — a 02:30
///   task fires at the first 02:30, not an hour later.
/// - DST spring-forward (time doesn't exist): the first valid minute
///   after the gap — a 02:30 task fires at 03:00, not silently skipped
///   (silent skips destroy trust in the feature).
pub fn resolve_wall_clock<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> DateTime<Tz> {
    let mut probe = naive;
    // Real-world DST gaps are ≤ 2h; 49 × 5min bounds the walk safely.
    for _ in 0..49 {
        match tz.from_local_datetime(&probe) {
            LocalResult::Single(dt) => return dt,
            LocalResult::Ambiguous(earliest, _) => return earliest,
            LocalResult::None => probe += Duration::minutes(5),
        }
    }
    // Unreachable for sane tz data; fall back to interpreting as UTC.
    tz.from_utc_datetime(&naive)
}

/// Format an instant in the exact UTC ISO shape every other timestamp
/// column uses (`YYYY-MM-DDTHH:MM:SS+00:00`, matching
/// `db/helpers.rs::iso_from_unix_secs`). Fire stamps written before the
/// formatters were unified are `…Z`; readers must parse (rfc3339
/// accepts both), never compare these strings lexicographically.
pub fn instant_to_utc_iso<Tz: TimeZone>(dt: &DateTime<Tz>) -> String {
    dt.with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Secs, false)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskBrief {
    pub id: ScheduledTaskId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<ProjectId>,
    pub prompt: String,
    pub repeat: ScheduledTaskRepeat,
    /// Local wall clock, `"HH:MM"`.
    pub time_of_day: String,
    /// Model display name to run fires on (same semantic as
    /// `--llm=<name>`). `None` = runtime default. Resolution failure at
    /// fire time falls back to the default rather than killing the run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_name: Option<String>,
    pub enabled: bool,
    /// UTC ISO instant of the last successful fire.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fired_at: Option<String>,
    /// Session created by the last fire. May dangle (session deleted) —
    /// readers degrade to plain text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_session_id: Option<SessionId>,
    /// UTC ISO instant of the next fire, computed at read time from the
    /// local rule. `None` when disabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_fire_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Payload for [`crate::api::GalleyApi::create_scheduled_task`].
/// Caller-assigned id, same shape as `CreateProjectInput`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduledTaskInput {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub prompt: String,
    pub repeat: ScheduledTaskRepeat,
    pub time_of_day: String,
    #[serde(default)]
    pub llm_name: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Partial update. `project_id` is double-`Option` so `Some(None)`
/// detaches the project (same semantic as `ProjectPatch.root_path`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<ScheduledTaskRepeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    /// Double-`Option`: `Some(None)` clears back to the runtime default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_name: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn dt(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, mo, d)
            .unwrap()
            .and_hms_opt(h, mi, 0)
            .unwrap()
    }

    #[test]
    fn daily_same_day_when_time_still_ahead() {
        let next = next_fire_after(&ScheduledTaskRepeat::Daily, t(9, 0), dt(2026, 7, 23, 8, 0));
        assert_eq!(next, dt(2026, 7, 23, 9, 0));
    }

    #[test]
    fn daily_rolls_past_midnight_when_time_passed() {
        let next = next_fire_after(&ScheduledTaskRepeat::Daily, t(9, 0), dt(2026, 7, 23, 9, 30));
        assert_eq!(next, dt(2026, 7, 24, 9, 0));
    }

    #[test]
    fn exact_fire_instant_advances_to_next_period() {
        // "strictly after": being handed the fire instant itself must
        // not return the same instant (scheduler would spin).
        let next = next_fire_after(&ScheduledTaskRepeat::Daily, t(9, 0), dt(2026, 7, 23, 9, 0));
        assert_eq!(next, dt(2026, 7, 24, 9, 0));
    }

    #[test]
    fn daily_crosses_month_and_year_boundaries() {
        let next = next_fire_after(
            &ScheduledTaskRepeat::Daily,
            t(0, 30),
            dt(2026, 12, 31, 1, 0),
        );
        assert_eq!(next, dt(2027, 1, 1, 0, 30));
    }

    #[test]
    fn weekly_skips_to_allowed_weekday() {
        // 2026-07-23 is a Thursday (ISO 4). Mon+Wed schedule → next
        // Monday 2026-07-27.
        let repeat = ScheduledTaskRepeat::Weekly {
            weekdays: vec![1, 3],
        };
        let next = next_fire_after(&repeat, t(10, 0), dt(2026, 7, 23, 8, 0));
        assert_eq!(next, dt(2026, 7, 27, 10, 0));
    }

    #[test]
    fn weekly_same_day_before_time_fires_today() {
        // Thursday schedule, asked on Thursday 08:00 → today 10:00.
        let repeat = ScheduledTaskRepeat::Weekly { weekdays: vec![4] };
        let next = next_fire_after(&repeat, t(10, 0), dt(2026, 7, 23, 8, 0));
        assert_eq!(next, dt(2026, 7, 23, 10, 0));
    }

    #[test]
    fn weekly_same_day_after_time_wraps_a_full_week() {
        let repeat = ScheduledTaskRepeat::Weekly { weekdays: vec![4] };
        let next = next_fire_after(&repeat, t(10, 0), dt(2026, 7, 23, 11, 0));
        assert_eq!(next, dt(2026, 7, 30, 10, 0));
    }

    #[test]
    fn monthly_fires_on_chosen_days() {
        let repeat = ScheduledTaskRepeat::Monthly {
            monthdays: vec![1, 15],
        };
        // July 10 → July 15; July 20 → Aug 1.
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 7, 10, 12, 0));
        assert_eq!(next, dt(2026, 7, 15, 9, 0));
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 7, 20, 12, 0));
        assert_eq!(next, dt(2026, 8, 1, 9, 0));
    }

    #[test]
    fn monthly_clamps_to_short_month_end() {
        // Day 31 in 2026: Jan 31 → Feb 28 (not leap) → Mar 31 → Apr 30.
        let repeat = ScheduledTaskRepeat::Monthly {
            monthdays: vec![31],
        };
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 1, 31, 9, 30));
        assert_eq!(next, dt(2026, 2, 28, 9, 0));
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 2, 28, 9, 30));
        assert_eq!(next, dt(2026, 3, 31, 9, 0));
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 3, 31, 9, 30));
        assert_eq!(next, dt(2026, 4, 30, 9, 0));
        // Leap year Feb still clamps correctly: 2028 → Feb 29.
        let next = next_fire_after(&repeat, t(9, 0), dt(2028, 1, 31, 9, 30));
        assert_eq!(next, dt(2028, 2, 29, 9, 0));
    }

    #[test]
    fn monthly_crosses_year_boundary() {
        let repeat = ScheduledTaskRepeat::Monthly { monthdays: vec![1] };
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 12, 15, 0, 0));
        assert_eq!(next, dt(2027, 1, 1, 9, 0));
    }

    #[test]
    fn monthly_prev_fire_mirrors_clamping() {
        let repeat = ScheduledTaskRepeat::Monthly {
            monthdays: vec![31],
        };
        // Early March looks back to Feb's clamped fire.
        let prev = prev_fire_at_or_before(&repeat, t(9, 0), dt(2026, 3, 5, 12, 0));
        assert_eq!(prev, dt(2026, 2, 28, 9, 0));
    }

    #[test]
    fn monthly_clamped_days_collapse_to_one_fire_date() {
        // [30, 31] both clamp to Feb 28 — one fire date, not two.
        let repeat = ScheduledTaskRepeat::Monthly {
            monthdays: vec![30, 31],
        };
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 2, 1, 0, 0));
        assert_eq!(next, dt(2026, 2, 28, 9, 0));
        let next = next_fire_after(&repeat, t(9, 0), dt(2026, 2, 28, 9, 30));
        assert_eq!(next, dt(2026, 3, 30, 9, 0));
    }

    #[test]
    fn monthly_normalized_validates_range() {
        assert!(ScheduledTaskRepeat::Monthly { monthdays: vec![] }
            .normalized()
            .is_err());
        assert!(ScheduledTaskRepeat::Monthly { monthdays: vec![0] }
            .normalized()
            .is_err());
        assert!(ScheduledTaskRepeat::Monthly {
            monthdays: vec![32]
        }
        .normalized()
        .is_err());
        let r = ScheduledTaskRepeat::Monthly {
            monthdays: vec![15, 1, 15],
        }
        .normalized()
        .unwrap();
        assert_eq!(
            r,
            ScheduledTaskRepeat::Monthly {
                monthdays: vec![1, 15]
            }
        );
    }

    #[test]
    fn monthly_serde_is_tagged_snake_case() {
        let monthly = serde_json::to_string(&ScheduledTaskRepeat::Monthly {
            monthdays: vec![1, 31],
        })
        .unwrap();
        assert_eq!(monthly, r#"{"kind":"monthly","monthdays":[1,31]}"#);
    }

    #[test]
    fn prev_fire_mirrors_next_fire() {
        let repeat = ScheduledTaskRepeat::Weekly { weekdays: vec![1] };
        // Thursday → previous Monday.
        let prev = prev_fire_at_or_before(&repeat, t(9, 0), dt(2026, 7, 23, 8, 0));
        assert_eq!(prev, dt(2026, 7, 20, 9, 0));
        // Exactly at the fire instant counts as "at or before".
        let prev =
            prev_fire_at_or_before(&ScheduledTaskRepeat::Daily, t(9, 0), dt(2026, 7, 23, 9, 0));
        assert_eq!(prev, dt(2026, 7, 23, 9, 0));
    }

    #[test]
    fn normalized_sorts_dedups_and_validates() {
        let r = ScheduledTaskRepeat::Weekly {
            weekdays: vec![5, 1, 5, 3],
        }
        .normalized()
        .unwrap();
        assert_eq!(
            r,
            ScheduledTaskRepeat::Weekly {
                weekdays: vec![1, 3, 5]
            }
        );
        assert!(ScheduledTaskRepeat::Weekly { weekdays: vec![] }
            .normalized()
            .is_err());
        assert!(ScheduledTaskRepeat::Weekly { weekdays: vec![8] }
            .normalized()
            .is_err());
    }

    #[test]
    fn parse_time_of_day_accepts_hhmm_only() {
        assert_eq!(parse_time_of_day("09:05").unwrap(), t(9, 5));
        assert!(parse_time_of_day("9am").is_err());
        assert!(parse_time_of_day("24:00").is_err());
        assert!(parse_time_of_day("09:60").is_err());
    }

    #[test]
    fn repeat_serde_is_tagged_snake_case() {
        let daily = serde_json::to_string(&ScheduledTaskRepeat::Daily).unwrap();
        assert_eq!(daily, r#"{"kind":"daily"}"#);
        let weekly = serde_json::to_string(&ScheduledTaskRepeat::Weekly {
            weekdays: vec![1, 5],
        })
        .unwrap();
        assert_eq!(weekly, r#"{"kind":"weekly","weekdays":[1,5]}"#);
    }

    mod dst {
        use super::*;
        use chrono_tz::America::New_York;
        use chrono_tz::Europe::Berlin;

        #[test]
        fn spring_forward_gap_pushes_to_first_valid_minute() {
            // US DST 2026: clocks jump 02:00 → 03:00 on Mar 8. A 02:30
            // task resolves to 03:00 EDT, not skipped.
            let resolved = resolve_wall_clock(&New_York, dt(2026, 3, 8, 2, 30));
            assert_eq!(instant_to_utc_iso(&resolved), "2026-03-08T07:00:00+00:00");
        }

        #[test]
        fn fall_back_ambiguity_picks_earliest() {
            // US DST 2026: 01:30 happens twice on Nov 1 (EDT then EST).
            // Earliest wins: 01:30 EDT = 05:30 UTC (EST would be 06:30).
            let resolved = resolve_wall_clock(&New_York, dt(2026, 11, 1, 1, 30));
            assert_eq!(instant_to_utc_iso(&resolved), "2026-11-01T05:30:00+00:00");
        }

        #[test]
        fn plain_time_resolves_singly() {
            let resolved = resolve_wall_clock(&Berlin, dt(2026, 7, 23, 9, 0));
            assert_eq!(instant_to_utc_iso(&resolved), "2026-07-23T07:00:00+00:00");
        }
    }
}
