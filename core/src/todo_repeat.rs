//! Repeating to-dos (main chat ticket 154, PRD rulings 204 and 202): where
//! the next period of a rule falls. A rule is kept on its own
//! (`todo_series`, migration 057); at any time there is at most one period
//! of it not settled, an ordinary to-do. When that period is ticked off or
//! skipped, Core makes the next one from the rule in the same transaction
//! (`crate::db`'s `settle_todo`): no timer, no model call. This module is
//! the arithmetic alone — no database, no clock, the zone a parameter, as
//! [`crate::assistant_todo::build_todo`] takes it — so the tests pin every
//! rule in two zones.
//!
//! - **daily**, every N days: `anchor + k·N` days.
//! - **weekly**, every N weeks on a set of ISO weekdays (1 is Monday): the
//!   days of the set in the ISO weeks (Monday first) N apart from the
//!   anchor's.
//! - **monthly**, every N months on a set of days of the month: those
//!   days in the months N apart from the anchor's; a month without one of
//!   them takes its last day, as a scheduled task's monthly rule does. A
//!   quarter is monthly every 3.
//! - **yearly**, every N years: the anchor's month and day; Feb 29 falls on
//!   Feb 28 in a common year.
//!
//! The next period's day is the rule's first day after the later of today
//! and the due days of the rule's periods so far ([`next_due_day`]): a
//! Monday report ticked off a week late gets next Monday, not today
//! (ruling 204 point 4, "不堆积").

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};

use crate::api::schedule::resolve_wall_clock;
use crate::api::todo::{StoredDue, TodoRepeatKind, TodoRepeatRule};
use crate::error::{GalleyError, Result};

/// The largest `every` a rule takes (`--every`, `repeat.every`): every
/// 365 days, weeks, months or years. Nobody says more; the bound keeps
/// every walk below short.
pub const REPEAT_EVERY_MAX: u32 = 365;

/// A rule as Core computes with it: what `todo_series` holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepeatRule {
    pub kind: TodoRepeatKind,
    /// Every N, at least 1.
    pub every: u32,
    /// Weekly: ISO weekdays 1–7; monthly: days of the month 1–31. Sorted,
    /// no repeats, never empty for those two; empty for daily and yearly.
    pub days: Vec<u8>,
    /// The day the every-N phase counts from (yearly: its month and day).
    pub anchor: NaiveDate,
}

fn invalid(message: String) -> GalleyError {
    GalleyError::InvalidArgs { message }
}

/// A set of days: sorted, no repeats, not empty, each in `1..=max`.
fn checked_days(mut days: Vec<u8>, max: u8, what: &str, context: &str) -> Result<Vec<u8>> {
    days.sort_unstable();
    days.dedup();
    if days.is_empty() {
        return Err(invalid(format!(
            "{context}: a {what} repeat needs at least one day"
        )));
    }
    if days.iter().any(|d| !(1..=max).contains(d)) {
        return Err(invalid(format!(
            "{context}: {what} repeat days are 1 to {max}, got {days:?}"
        )));
    }
    Ok(days)
}

impl RepeatRule {
    /// A rule as given (`todo add` / `update`, the socket's `repeat`),
    /// checked and pinned to `anchor`: `every` 1 to [`REPEAT_EVERY_MAX`];
    /// weekdays for weekly alone (1–7, at least one), days of the month
    /// for monthly alone (1–31, at least one); daily and yearly take
    /// neither. `invalid_args` otherwise, `context` first.
    pub fn checked(given: &TodoRepeatRule, anchor: NaiveDate, context: &str) -> Result<Self> {
        if !(1..=REPEAT_EVERY_MAX).contains(&given.every) {
            return Err(invalid(format!(
                "{context}: a repeat's every is 1 to {REPEAT_EVERY_MAX}, got {}",
                given.every
            )));
        }
        let kind = given.kind;
        let days = match kind {
            TodoRepeatKind::Weekly => {
                if !given.monthdays.is_empty() {
                    return Err(invalid(format!(
                        "{context}: a weekly repeat takes weekdays, not days of the month"
                    )));
                }
                checked_days(given.weekdays.clone(), 7, "weekly", context)?
            }
            TodoRepeatKind::Monthly => {
                if !given.weekdays.is_empty() {
                    return Err(invalid(format!(
                        "{context}: a monthly repeat takes days of the month, not weekdays"
                    )));
                }
                checked_days(given.monthdays.clone(), 31, "monthly", context)?
            }
            TodoRepeatKind::Daily | TodoRepeatKind::Yearly => {
                if !given.weekdays.is_empty() || !given.monthdays.is_empty() {
                    return Err(invalid(format!(
                        "{context}: a {} repeat takes no weekdays or days of the month",
                        kind.as_sql()
                    )));
                }
                Vec::new()
            }
        };
        Ok(Self {
            kind,
            every: given.every,
            days,
            anchor,
        })
    }

    /// The rule as the wire gives it (`Todo.repeat` without its reminder).
    pub fn given(&self) -> TodoRepeatRule {
        let (weekdays, monthdays) = match self.kind {
            TodoRepeatKind::Weekly => (self.days.clone(), Vec::new()),
            TodoRepeatKind::Monthly => (Vec::new(), self.days.clone()),
            TodoRepeatKind::Daily | TodoRepeatKind::Yearly => (Vec::new(), Vec::new()),
        };
        TodoRepeatRule {
            kind: self.kind,
            weekdays,
            monthdays,
            every: self.every,
        }
    }

    /// The rule's first day strictly after `after`.
    pub fn next_after(&self, after: NaiveDate) -> NaiveDate {
        let n = i64::from(self.every.clamp(1, REPEAT_EVERY_MAX));
        match self.kind {
            TodoRepeatKind::Daily => {
                let k = (after - self.anchor).num_days().div_euclid(n) + 1;
                self.anchor + Duration::days(k * n)
            }
            TodoRepeatKind::Weekly => {
                let days = self.days_or(self.anchor.weekday().number_from_monday() as u8);
                let anchor_week = monday_of(self.anchor);
                // Within N weeks and a week a day of the set comes in a
                // week of the phase.
                let mut day = after + Duration::days(1);
                loop {
                    let weeks = (monday_of(day) - anchor_week).num_days() / 7;
                    if weeks.rem_euclid(n) == 0
                        && days.contains(&(day.weekday().number_from_monday() as u8))
                    {
                        return day;
                    }
                    day += Duration::days(1);
                }
            }
            TodoRepeatKind::Monthly => {
                let days = self.days_or(self.anchor.day() as u8);
                let anchor_month = month_index(self.anchor.year(), self.anchor.month());
                let (mut year, mut month) = (after.year(), after.month());
                // Within N months and one a month of the phase holds a day
                // after `after`.
                loop {
                    if (month_index(year, month) - anchor_month).rem_euclid(n) == 0 {
                        let last = last_day_of_month(year, month);
                        let found = days
                            .iter()
                            .filter_map(|&d| {
                                NaiveDate::from_ymd_opt(year, month, u32::from(d).min(last))
                            })
                            .filter(|day| *day > after)
                            .min();
                        if let Some(day) = found {
                            return day;
                        }
                    }
                    (year, month) = if month == 12 {
                        (year + 1, 1)
                    } else {
                        (year, month + 1)
                    };
                }
            }
            TodoRepeatKind::Yearly => {
                let mut year = after.year();
                loop {
                    if i64::from(year - self.anchor.year()).rem_euclid(n) == 0 {
                        let day = day_in_year(year, self.anchor.month(), self.anchor.day());
                        if day > after {
                            return day;
                        }
                    }
                    year += 1;
                }
            }
        }
    }

    /// The set of days, or `fallback` alone for a set Core never writes
    /// empty: a walk on an empty set would not end.
    fn days_or(&self, fallback: u8) -> Vec<u8> {
        if self.days.is_empty() {
            vec![fallback]
        } else {
            self.days.clone()
        }
    }
}

fn monday_of(day: NaiveDate) -> NaiveDate {
    day - Duration::days(i64::from(day.weekday().num_days_from_monday()))
}

fn month_index(year: i32, month: u32) -> i64 {
    i64::from(year) * 12 + i64::from(month) - 1
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let first_of_next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("the first of a month is a day");
    (first_of_next - Duration::days(1)).day()
}

/// `month`/`day` of `year`, a day past the month's end on its last day
/// (Feb 29 in a common year is Feb 28).
fn day_in_year(year: i32, month: u32, day: u32) -> NaiveDate {
    let last = last_day_of_month(year, month);
    NaiveDate::from_ymd_opt(year, month, day.min(last)).expect("a day within its month")
}

/// The day the next period is due: the rule's first day after the later
/// of `today` and every day in `period_days` — the due days of the rule's
/// periods so far, the one being settled among them. Ticked off late, the
/// next is the rule's next day after today; ticked off early, the one
/// after the period's own day; and a period unticked and ticked again
/// after the next one was made does not make that day twice.
pub fn next_due_day(
    rule: &RepeatRule,
    today: NaiveDate,
    period_days: impl IntoIterator<Item = NaiveDate>,
) -> NaiveDate {
    let after = period_days.into_iter().fold(today, NaiveDate::max);
    rule.next_after(after)
}

/// When a period's reminder goes off, relative to its due day: how many
/// days before it (0 the same day; below 0 after it) and at what local
/// time of day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemindOffset {
    pub days_before: i64,
    pub time: NaiveTime,
}

/// A reminder at `remind_at` on a to-do due `due`, as an offset read in
/// `tz`: the days between the reminder's local day and the due day, and
/// the reminder's local time (to the minute).
pub fn remind_offset<Tz: TimeZone>(
    due: &StoredDue,
    remind_at: DateTime<Utc>,
    tz: &Tz,
) -> RemindOffset {
    let local = remind_at.with_timezone(tz);
    RemindOffset {
        days_before: (due.local_date(tz) - local.date_naive()).num_days(),
        time: to_the_minute(local.time()),
    }
}

/// The local time of day a due date has (to the minute), `None` for a
/// day with no time.
pub fn due_time_of_day<Tz: TimeZone>(due: &StoredDue, tz: &Tz) -> Option<NaiveTime> {
    match due {
        StoredDue::Date(_) => None,
        StoredDue::At(at) => Some(to_the_minute(at.with_timezone(tz).time())),
    }
}

fn to_the_minute(time: NaiveTime) -> NaiveTime {
    NaiveTime::from_hms_opt(time.hour(), time.minute(), 0).expect("an hour and a minute")
}

/// A next period: when it is due, and when its reminder goes off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextPeriod {
    pub due: StoredDue,
    pub remind_at: Option<DateTime<Utc>>,
}

/// The period due on `day`: at `time_of_day` there (an instant, read in
/// `tz`) or on the day alone; and, with `remind`, its reminder at that
/// offset from the day, read in `tz`. A wall-clock time that does not
/// exist or exists twice (daylight saving) resolves as a scheduled task's
/// does.
pub fn period_on<Tz: TimeZone>(
    day: NaiveDate,
    time_of_day: Option<NaiveTime>,
    remind: Option<RemindOffset>,
    tz: &Tz,
) -> NextPeriod {
    let due = match time_of_day {
        Some(time) => StoredDue::At(resolve_wall_clock(tz, day.and_time(time)).with_timezone(&Utc)),
        None => StoredDue::Date(day),
    };
    let remind_at = remind.map(|offset| {
        let on = day - Duration::days(offset.days_before);
        resolve_wall_clock(tz, on.and_time(offset.time)).with_timezone(&Utc)
    });
    NextPeriod { due, remind_at }
}

/// The first reminder time still after `now` for a period due on
/// `due_day` that is left unsettled (main chat ticket 154 behaviour 13):
/// with `own`, the period's own reminder time first; then the reminder
/// times of the rule's days after `due_day`, in order. Each day's
/// reminder is `remind` from it, read in `tz`. The days whose reminder
/// falls on a day before today are passed over at once (their time is
/// past whatever it is), so a period overdue for a long time costs no
/// long walk; `None` only when the rule gives none within the bound.
pub fn next_reminder_ahead<Tz: TimeZone>(
    rule: &RepeatRule,
    due_day: NaiveDate,
    time_of_day: Option<NaiveTime>,
    remind: RemindOffset,
    own: bool,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Option<DateTime<Utc>> {
    let reminder_of = |day: NaiveDate| {
        period_on(day, time_of_day, Some(remind), tz)
            .remind_at
            .filter(|at| *at > now)
    };
    if own {
        if let Some(at) = reminder_of(due_day) {
            return Some(at);
        }
    }
    // A day whose reminder falls before today: its time is past. The
    // first that may still be ahead is due `days_before` days from today.
    let today = now.with_timezone(tz).date_naive();
    let floor = today
        .checked_add_signed(Duration::days(
            remind.days_before.clamp(-100_000, 100_000) - 1,
        ))
        .unwrap_or(due_day);
    let mut day = rule.next_after(due_day.max(floor));
    for _ in 0..800 {
        if let Some(at) = reminder_of(day) {
            return Some(at);
        }
        day = rule.next_after(day);
    }
    None
}

/// `HH:MM` as stored (`time_of_day`, `remind_time`).
pub fn hhmm(time: NaiveTime) -> String {
    time.format("%H:%M").to_string()
}

/// A stored `HH:MM`.
pub fn parse_hhmm(raw: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(raw, "%H:%M").ok()
}

const WEEKDAY_WORDS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

fn ordinal(day: u8) -> String {
    let suffix = match (day % 10, day % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{day}{suffix}")
}

/// The rule in English, for the main chat's 「在办的事」 line (main chat
/// ticket 154 point 12): `repeats weekly on Mon`, `repeats every 2 weeks
/// on Mon, Thu`, `repeats monthly on the 15th`, `repeats every 3 months on
/// the 1st, 15th`, `repeats daily`, `repeats every 2 days`, `repeats
/// yearly`, `repeats every 2 years` (the day of a yearly one is the due
/// date on the same line).
pub fn repeat_words(rule: &TodoRepeatRule) -> String {
    let every = rule.every.max(1);
    let (one, many) = match rule.kind {
        TodoRepeatKind::Daily => ("daily", "days"),
        TodoRepeatKind::Weekly => ("weekly", "weeks"),
        TodoRepeatKind::Monthly => ("monthly", "months"),
        TodoRepeatKind::Yearly => ("yearly", "years"),
    };
    let mut words = if every == 1 {
        format!("repeats {one}")
    } else {
        format!("repeats every {every} {many}")
    };
    match rule.kind {
        TodoRepeatKind::Weekly if !rule.weekdays.is_empty() => {
            let days: Vec<&str> = rule
                .weekdays
                .iter()
                .filter_map(|&d| WEEKDAY_WORDS.get(usize::from(d).wrapping_sub(1)).copied())
                .collect();
            words.push_str(&format!(" on {}", days.join(", ")));
        }
        TodoRepeatKind::Monthly if !rule.monthdays.is_empty() => {
            let days: Vec<String> = rule.monthdays.iter().map(|&d| ordinal(d)).collect();
            words.push_str(&format!(" on the {}", days.join(", ")));
        }
        _ => {}
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::Los_Angeles;
    use chrono_tz::Asia::Shanghai;

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn utc(iso: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(iso)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn rule(kind: TodoRepeatKind, every: u32, days: &[u8], anchor: NaiveDate) -> RepeatRule {
        RepeatRule {
            kind,
            every,
            days: days.to_vec(),
            anchor,
        }
    }

    fn given(
        kind: TodoRepeatKind,
        weekdays: &[u8],
        monthdays: &[u8],
        every: u32,
    ) -> TodoRepeatRule {
        TodoRepeatRule {
            kind,
            weekdays: weekdays.to_vec(),
            monthdays: monthdays.to_vec(),
            every,
        }
    }

    fn walk(rule: &RepeatRule, from: NaiveDate, n: usize) -> Vec<NaiveDate> {
        let mut out = Vec::new();
        let mut at = from;
        for _ in 0..n {
            at = rule.next_after(at);
            out.push(at);
        }
        out
    }

    #[test]
    fn daily_every_n_days_from_the_anchor() {
        let every_day = rule(TodoRepeatKind::Daily, 1, &[], day(2026, 11, 10));
        assert_eq!(every_day.next_after(day(2026, 11, 10)), day(2026, 11, 11));
        // Across the year's end.
        assert_eq!(every_day.next_after(day(2026, 12, 31)), day(2027, 1, 1));
        // Every 3 days keeps the anchor's phase, whatever `after` is.
        let every_three = rule(TodoRepeatKind::Daily, 3, &[], day(2026, 11, 10));
        assert_eq!(
            walk(&every_three, day(2026, 11, 10), 3),
            [day(2026, 11, 13), day(2026, 11, 16), day(2026, 11, 19)]
        );
        assert_eq!(every_three.next_after(day(2026, 11, 14)), day(2026, 11, 16));
        assert_eq!(every_three.next_after(day(2026, 11, 15)), day(2026, 11, 16));
        // Before the anchor: the phase counts backwards too.
        assert_eq!(every_three.next_after(day(2026, 11, 5)), day(2026, 11, 7));
        assert_eq!(every_three.next_after(day(2026, 11, 9)), day(2026, 11, 10));
    }

    #[test]
    fn weekly_on_a_set_of_weekdays_every_n_weeks() {
        // Anchor Mon 2026-11-16; every week on Monday.
        let mondays = rule(TodoRepeatKind::Weekly, 1, &[1], day(2026, 11, 16));
        assert_eq!(mondays.next_after(day(2026, 11, 16)), day(2026, 11, 23));
        assert_eq!(mondays.next_after(day(2026, 11, 19)), day(2026, 11, 23));
        // Across the year's end (Mon 2026-12-28, then Mon 2027-01-04).
        assert_eq!(
            walk(&mondays, day(2026, 12, 21), 2),
            [day(2026, 12, 28), day(2027, 1, 4)]
        );
        // Monday and Thursday.
        let two = rule(TodoRepeatKind::Weekly, 1, &[1, 4], day(2026, 11, 16));
        assert_eq!(
            walk(&two, day(2026, 11, 16), 3),
            [day(2026, 11, 19), day(2026, 11, 23), day(2026, 11, 26)]
        );
        // Every 2 weeks: the anchor's week, then two weeks on, both ways.
        let fortnight = rule(TodoRepeatKind::Weekly, 2, &[1, 5], day(2026, 11, 18));
        assert_eq!(
            walk(&fortnight, day(2026, 11, 16), 4),
            [
                day(2026, 11, 20),
                day(2026, 11, 30),
                day(2026, 12, 4),
                day(2026, 12, 14)
            ]
        );
        assert_eq!(fortnight.next_after(day(2026, 11, 21)), day(2026, 11, 30));
        assert_eq!(fortnight.next_after(day(2026, 11, 8)), day(2026, 11, 16));
        // An anchor on a Sunday: its ISO week starts the Monday before.
        let sunday_anchor = rule(TodoRepeatKind::Weekly, 2, &[1], day(2026, 11, 22));
        assert_eq!(
            sunday_anchor.next_after(day(2026, 11, 22)),
            day(2026, 11, 30)
        );
    }

    #[test]
    fn monthly_on_days_of_the_month_falls_on_the_last_day_of_a_short_month() {
        let fifteenth = rule(TodoRepeatKind::Monthly, 1, &[15], day(2026, 11, 15));
        assert_eq!(fifteenth.next_after(day(2026, 11, 15)), day(2026, 12, 15));
        assert_eq!(fifteenth.next_after(day(2026, 12, 20)), day(2027, 1, 15));
        // The 31st: Apr 30, Feb 28 in 2027, Feb 29 in 2028.
        let month_end = rule(TodoRepeatKind::Monthly, 1, &[31], day(2027, 1, 31));
        assert_eq!(
            walk(&month_end, day(2027, 1, 31), 3),
            [day(2027, 2, 28), day(2027, 3, 31), day(2027, 4, 30)]
        );
        assert_eq!(month_end.next_after(day(2028, 1, 31)), day(2028, 2, 29));
        // The 30th and the 31st both land on Feb 28: one day, not two.
        let both = rule(TodoRepeatKind::Monthly, 1, &[30, 31], day(2027, 1, 30));
        assert_eq!(
            walk(&both, day(2027, 1, 31), 2),
            [day(2027, 2, 28), day(2027, 3, 30)]
        );
        // A quarter: every 3 months from the anchor's month, across the
        // year's end.
        let quarter = rule(TodoRepeatKind::Monthly, 3, &[15], day(2026, 11, 15));
        assert_eq!(
            walk(&quarter, day(2026, 11, 15), 3),
            [day(2027, 2, 15), day(2027, 5, 15), day(2027, 8, 15)]
        );
        // `after` in a month out of the phase.
        assert_eq!(quarter.next_after(day(2026, 12, 1)), day(2027, 2, 15));
        // Before the anchor: the phase counts backwards too.
        assert_eq!(quarter.next_after(day(2026, 7, 1)), day(2026, 8, 15));
        // Two days in a month.
        let twice = rule(TodoRepeatKind::Monthly, 1, &[1, 15], day(2026, 11, 1));
        assert_eq!(
            walk(&twice, day(2026, 11, 1), 3),
            [day(2026, 11, 15), day(2026, 12, 1), day(2026, 12, 15)]
        );
    }

    #[test]
    fn yearly_on_the_anchors_day_and_feb_29_in_a_common_year() {
        let birthday = rule(TodoRepeatKind::Yearly, 1, &[], day(2026, 3, 15));
        assert_eq!(birthday.next_after(day(2026, 3, 15)), day(2027, 3, 15));
        assert_eq!(birthday.next_after(day(2026, 3, 14)), day(2026, 3, 15));
        assert_eq!(birthday.next_after(day(2026, 12, 31)), day(2027, 3, 15));
        let leap = rule(TodoRepeatKind::Yearly, 1, &[], day(2028, 2, 29));
        assert_eq!(
            walk(&leap, day(2028, 2, 29), 4),
            [
                day(2029, 2, 28),
                day(2030, 2, 28),
                day(2031, 2, 28),
                day(2032, 2, 29)
            ]
        );
        let every_two = rule(TodoRepeatKind::Yearly, 2, &[], day(2026, 6, 1));
        assert_eq!(every_two.next_after(day(2026, 6, 1)), day(2028, 6, 1));
        assert_eq!(every_two.next_after(day(2027, 1, 1)), day(2028, 6, 1));
        assert_eq!(every_two.next_after(day(2025, 1, 1)), day(2026, 6, 1));
    }

    #[test]
    fn the_next_day_comes_after_today_and_after_every_period_so_far() {
        let mondays = rule(TodoRepeatKind::Weekly, 1, &[1], day(2026, 11, 2));
        // A Monday's period ticked off a week late, on a Monday: next
        // Monday, not today.
        assert_eq!(
            next_due_day(&mondays, day(2026, 11, 16), [day(2026, 11, 9)]),
            day(2026, 11, 23)
        );
        // Ticked off early (a Thursday, for next Monday's): the Monday
        // after that.
        assert_eq!(
            next_due_day(&mondays, day(2026, 11, 12), [day(2026, 11, 16)]),
            day(2026, 11, 23)
        );
        // Yesterday's daily period ticked off today: tomorrow.
        let daily = rule(TodoRepeatKind::Daily, 1, &[], day(2026, 11, 1));
        assert_eq!(
            next_due_day(&daily, day(2026, 11, 10), [day(2026, 11, 9)]),
            day(2026, 11, 11)
        );
        // A period unticked after its next was made, ticked off again: the
        // day after the latest period, not that one's day once more.
        assert_eq!(
            next_due_day(
                &mondays,
                day(2026, 11, 17),
                [day(2026, 11, 16), day(2026, 11, 23)]
            ),
            day(2026, 11, 30)
        );
    }

    #[test]
    fn a_period_with_a_time_and_its_reminder_read_in_the_zone() {
        // Due Mon 2026-11-16 at 15:00, reminded the evening before at
        // 20:00, in Shanghai (UTC+8).
        let next = period_on(
            day(2026, 11, 23),
            NaiveTime::from_hms_opt(15, 0, 0),
            Some(RemindOffset {
                days_before: 1,
                time: NaiveTime::from_hms_opt(20, 0, 0).unwrap(),
            }),
            &Shanghai,
        );
        assert_eq!(next.due, StoredDue::At(utc("2026-11-23T07:00:00Z")));
        assert_eq!(next.remind_at, Some(utc("2026-11-22T12:00:00Z")));
        // The same rule in Los Angeles (UTC-8 in November).
        let next = period_on(
            day(2026, 11, 23),
            NaiveTime::from_hms_opt(15, 0, 0),
            Some(RemindOffset {
                days_before: 1,
                time: NaiveTime::from_hms_opt(20, 0, 0).unwrap(),
            }),
            &Los_Angeles,
        );
        assert_eq!(next.due, StoredDue::At(utc("2026-11-23T23:00:00Z")));
        assert_eq!(next.remind_at, Some(utc("2026-11-23T04:00:00Z")));
        // A day with no time stays a day, in any zone; no reminder, none.
        let next = period_on(day(2026, 11, 23), None, None, &Los_Angeles);
        assert_eq!(next.due, StoredDue::Date(day(2026, 11, 23)));
        assert_eq!(next.remind_at, None);
        // A time inside the spring-forward gap (LA, 2027-03-14 02:30)
        // moves to the first minute after it, as a scheduled task's does.
        let next = period_on(
            day(2027, 3, 14),
            NaiveTime::from_hms_opt(2, 30, 0),
            None,
            &Los_Angeles,
        );
        assert_eq!(next.due, StoredDue::At(utc("2027-03-14T10:00:00Z")));
    }

    #[test]
    fn a_reminder_reads_as_days_before_and_a_time_in_the_zone() {
        // Due Mon 2026-11-16 15:00 Shanghai; reminder Sun 20:00 Shanghai.
        let due = StoredDue::At(utc("2026-11-16T07:00:00Z"));
        let offset = remind_offset(&due, utc("2026-11-15T12:00:00Z"), &Shanghai);
        assert_eq!(offset.days_before, 1);
        assert_eq!(offset.time, NaiveTime::from_hms_opt(20, 0, 0).unwrap());
        // The same two instants in Los Angeles: due Sun 23:00, reminder
        // Sun 04:00 — the same day there.
        let offset = remind_offset(&due, utc("2026-11-15T12:00:00Z"), &Los_Angeles);
        assert_eq!(offset.days_before, 0);
        assert_eq!(offset.time, NaiveTime::from_hms_opt(4, 0, 0).unwrap());
        assert_eq!(
            due_time_of_day(&due, &Los_Angeles),
            NaiveTime::from_hms_opt(23, 0, 0)
        );
        // A day with no time: the day itself; seconds are dropped.
        let monday = StoredDue::Date(day(2026, 11, 16));
        let offset = remind_offset(&monday, utc("2026-11-16T01:00:30Z"), &Shanghai);
        assert_eq!(offset.days_before, 0);
        assert_eq!(offset.time, NaiveTime::from_hms_opt(9, 0, 0).unwrap());
        assert_eq!(due_time_of_day(&monday, &Shanghai), None);
        // A reminder after the due day reads below zero.
        let offset = remind_offset(&monday, utc("2026-11-17T01:00:00Z"), &Shanghai);
        assert_eq!(offset.days_before, -1);
    }

    #[test]
    fn an_unsettled_period_is_reminded_at_the_first_time_still_ahead() {
        let at = |day: NaiveDate, h: u32| {
            resolve_wall_clock(&Shanghai, day.and_hms_opt(h, 0, 0).unwrap()).with_timezone(&Utc)
        };
        let nine = RemindOffset {
            days_before: 0,
            time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
        };
        // Weekly on Monday, reminded that day at 09:00; the period due Mon
        // Nov 9 rang that day, and the computer opens next Monday at
        // 08:00: today's ring, not next week's.
        let mondays = rule(TodoRepeatKind::Weekly, 1, &[1], day(2026, 11, 9));
        let next =
            |due, own, now| next_reminder_ahead(&mondays, due, None, nine, own, now, &Shanghai);
        assert_eq!(
            next(day(2026, 11, 9), false, at(day(2026, 11, 16), 8)),
            Some(at(day(2026, 11, 16), 9))
        );
        // At 10:00 it has passed: the Monday after.
        assert_eq!(
            next(day(2026, 11, 9), false, at(day(2026, 11, 16), 10)),
            Some(at(day(2026, 11, 23), 9))
        );
        // Right after the ring on its own day: next Monday.
        assert_eq!(
            next(day(2026, 11, 9), false, at(day(2026, 11, 9), 9)),
            Some(at(day(2026, 11, 16), 9))
        );
        // Its own time first, when asked and still ahead.
        assert_eq!(
            next(day(2026, 11, 16), true, at(day(2026, 11, 16), 8)),
            Some(at(day(2026, 11, 16), 9))
        );
        assert_eq!(
            next(day(2026, 11, 16), false, at(day(2026, 11, 16), 8)),
            Some(at(day(2026, 11, 23), 9))
        );
        // Daily: rang on day D, first looked at on D+1 before 09:00.
        let daily = rule(TodoRepeatKind::Daily, 1, &[], day(2026, 11, 1));
        assert_eq!(
            next_reminder_ahead(
                &daily,
                day(2026, 11, 10),
                None,
                nine,
                false,
                at(day(2026, 11, 11), 7),
                &Shanghai
            ),
            Some(at(day(2026, 11, 11), 9))
        );
        // Overdue a long time: no long walk, the next one ahead.
        assert_eq!(
            next_reminder_ahead(
                &daily,
                day(2020, 1, 1),
                None,
                nine,
                false,
                at(day(2026, 11, 11), 10),
                &Shanghai
            ),
            Some(at(day(2026, 11, 12), 9))
        );
        // Reminded the evening before: Sunday 20:00 for Monday.
        let eve = RemindOffset {
            days_before: 1,
            time: NaiveTime::from_hms_opt(20, 0, 0).unwrap(),
        };
        let at_eve =
            |now| next_reminder_ahead(&mondays, day(2026, 11, 16), None, eve, true, now, &Shanghai);
        // Made on Sunday at 21:00, its own eve gone: the next Sunday's.
        assert_eq!(
            at_eve(at(day(2026, 11, 15), 21)),
            Some(at(day(2026, 11, 22), 20))
        );
        // Made on Sunday at 19:00: its own eve still ahead.
        assert_eq!(
            at_eve(at(day(2026, 11, 15), 19)),
            Some(at(day(2026, 11, 15), 20))
        );
    }

    #[test]
    fn a_rule_as_given_is_checked() {
        let anchor = day(2026, 11, 16);
        let weekly = RepeatRule::checked(
            &given(TodoRepeatKind::Weekly, &[4, 1, 1], &[], 2),
            anchor,
            "t",
        )
        .unwrap();
        assert_eq!(weekly.days, [1, 4]);
        assert_eq!(weekly.given().weekdays, [1, 4]);
        assert_eq!(weekly.anchor, anchor);
        let refused = |g: TodoRepeatRule| {
            matches!(
                RepeatRule::checked(&g, anchor, "t"),
                Err(GalleyError::InvalidArgs { .. })
            )
        };
        assert!(refused(given(TodoRepeatKind::Weekly, &[], &[], 1)));
        assert!(refused(given(TodoRepeatKind::Weekly, &[8], &[], 1)));
        assert!(refused(given(TodoRepeatKind::Weekly, &[0], &[], 1)));
        assert!(refused(given(TodoRepeatKind::Weekly, &[1], &[1], 1)));
        assert!(refused(given(TodoRepeatKind::Monthly, &[], &[], 1)));
        assert!(refused(given(TodoRepeatKind::Monthly, &[], &[32], 1)));
        assert!(refused(given(TodoRepeatKind::Monthly, &[1], &[1], 1)));
        assert!(refused(given(TodoRepeatKind::Daily, &[1], &[], 1)));
        assert!(refused(given(TodoRepeatKind::Yearly, &[], &[1], 1)));
        assert!(refused(given(TodoRepeatKind::Daily, &[], &[], 0)));
        assert!(refused(given(
            TodoRepeatKind::Daily,
            &[],
            &[],
            REPEAT_EVERY_MAX + 1
        )));
        assert!(!refused(given(
            TodoRepeatKind::Daily,
            &[],
            &[],
            REPEAT_EVERY_MAX
        )));
        assert!(!refused(given(TodoRepeatKind::Yearly, &[], &[], 1)));
    }

    #[test]
    fn the_rule_in_words() {
        let words = |kind, weekdays: &[u8], monthdays: &[u8], every| {
            repeat_words(&given(kind, weekdays, monthdays, every))
        };
        assert_eq!(words(TodoRepeatKind::Daily, &[], &[], 1), "repeats daily");
        assert_eq!(
            words(TodoRepeatKind::Daily, &[], &[], 2),
            "repeats every 2 days"
        );
        assert_eq!(
            words(TodoRepeatKind::Weekly, &[1], &[], 1),
            "repeats weekly on Mon"
        );
        assert_eq!(
            words(TodoRepeatKind::Weekly, &[1, 4], &[], 2),
            "repeats every 2 weeks on Mon, Thu"
        );
        assert_eq!(
            words(TodoRepeatKind::Monthly, &[], &[15], 1),
            "repeats monthly on the 15th"
        );
        assert_eq!(
            words(TodoRepeatKind::Monthly, &[], &[15], 3),
            "repeats every 3 months on the 15th"
        );
        assert_eq!(
            words(TodoRepeatKind::Monthly, &[], &[1, 2, 3, 11, 21, 22, 31], 1),
            "repeats monthly on the 1st, 2nd, 3rd, 11th, 21st, 22nd, 31st"
        );
        assert_eq!(words(TodoRepeatKind::Yearly, &[], &[], 1), "repeats yearly");
        assert_eq!(
            words(TodoRepeatKind::Yearly, &[], &[], 2),
            "repeats every 2 years"
        );
    }
}
