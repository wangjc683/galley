//! A to-do's day, reminder and rule changed by hand on the desktop (main
//! chat ticket 156, PRD ruling 205): the to-do panel's date popover. The
//! user says what they picked — the due day (or none), the reminder as days
//! before that day and a time (or none), a rule — and Core works out what
//! that means for the reminder:
//!
//! - **The reminder moves with the day** (ruling 205 point 2): the due day
//!   going from A to B moves a reminder to the same number of days before
//!   B, at the same local time. Only the time of day changing (the local
//!   due day the same) leaves the reminder where it is. Taking the due
//!   date away takes the reminder with it.
//! - **A repeating period's reminder Core moved on moves by its rule**
//!   (main chat ticket 157): a period's reminder goes off once, and left
//!   unsettled Core arms the same reminder again at a later period's time
//!   (ticket 154 behaviour 13), past the period's due day. Read off where
//!   it is, that is "7 days after" and the move would carry it; under a
//!   rule that records a reminder, one that reads as after the due day is
//!   moved by the rule's offset instead (`carried_offset`) — what the
//!   desktop's popover reads it as too. One set on the period by hand
//!   (the popover's choices are the same day or days before) keeps its own.
//! - **A reminder that follows the day falls back toward it** (main chat
//!   ticket 157, the main session's addendum): "push it to tomorrow" is the
//!   commonest hand edit, and a reminder the day before then lands on a
//!   time already past today. So a reminder moved with the due day keeps
//!   its local time and, from its N days before the new day, tries N − 1,
//!   N − 2, … down to the due day itself (0), hanging at the first still
//!   ahead: due Friday reminded Thursday 09:00, moved to tomorrow at 21:00
//!   tonight, rings tomorrow 09:00. One after its due day (below 0) is not
//!   walked. Only for a reminder following a day change: one picked in the
//!   popover's reminder row is hung where picked or not at all (the
//!   desktop says so under the row), and `todo update --due` moves none.
//! - **A time already passed is not hung**: a reminder set to a time no
//!   later than now, or moved with its day and none of its fallbacks still
//!   ahead, leaves the to-do with none (its task let go as Core's own,
//!   [`WhenWrite::let_reminder_go`]: the user did not turn it down, as Core
//!   cancelling it with its to-do is not), and no error.
//! - **But a repeating period keeps its reminder alive**: there the same
//!   reminder is hung — after the fallback toward the due day, when nothing
//!   on or before it is ahead — at the first reminder time still ahead
//!   among the rule's days after the period's due day
//!   ([`crate::todo_repeat::next_reminder_ahead`], ticket 154). Let go, it
//!   would never ring again: ticket 154's sweep re-arms a reminder that
//!   went off and hangs one only on a period with no reminder task at all,
//!   reading a cancelled one as removed on purpose. 「不提醒」 picked in the
//!   popover is the user's removal, on a repeating period too.
//! - A change of day, time or reminder on a period is the period's alone:
//!   the rule stays (ruling 204 point 8; no `series`).
//!
//! This module is the arithmetic alone, as [`crate::todo_repeat`] is: what
//! the to-do holds now, what was picked, `now` and the zone in; what Core's
//! `update_todo` writes out. [`crate::db::SqliteGalley::update_todo_by_hand`]
//! reads, writes and lets the reminder go.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};

use crate::api::schedule::instant_to_utc_iso;
use crate::api::todo::{parse_todo_due, StoredDue, TodoRepeatRemind, TodoRepeatRule};
use crate::error::{GalleyError, Result};
use crate::todo_repeat::{
    due_time_of_day, parse_hhmm, remind_offset, reminder_toward_due, RemindOffset, RepeatRule,
};

/// What the desktop picked (the Tauri `update_todo`'s new arguments).
/// `None` leaves that part as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TodoWhenChange {
    /// `Some(Some(raw))`: due then ([`parse_todo_due`]'s forms: a day
    /// `YYYY-MM-DD`, or a local `YYYY-MM-DDTHH:MM`); `Some(None)`: no due
    /// date (「不定日子」).
    pub due: Option<Option<String>>,
    /// `Some(Some(offset))`: the reminder `daysBefore` the due day (0 the
    /// same day, below 0 after it) at local `time`; `Some(None)`: none
    /// (「不提醒」, the user's removal). `None`: the reminder follows the
    /// day.
    pub remind: Option<Option<TodoRepeatRemind>>,
    /// Give the to-do this rule, or change its rule (ticket 154's
    /// `repeat`), counted from its due date.
    pub repeat: Option<TodoRepeatRule>,
}

impl TodoWhenChange {
    /// Whether it changes neither the day, nor the reminder, nor the rule.
    pub fn is_empty(&self) -> bool {
        self.due.is_none() && self.remind.is_none() && self.repeat.is_none()
    }
}

/// What the to-do holds before the change.
#[derive(Debug, Clone, Default)]
pub struct TodoWhenNow {
    pub due: Option<StoredDue>,
    /// When its reminder goes off (went off), its task not cancelled.
    pub reminder: Option<DateTime<Utc>>,
    /// The rule it is a period of, while that has not ended.
    pub rule: Option<RepeatRule>,
    /// The reminder each period of `rule` gets, when the rule records one
    /// (main chat ticket 154: days before the due day, a local time).
    pub rule_remind: Option<RemindOffset>,
}

/// What Core writes for a [`TodoWhenChange`]: the [`crate::api::TodoPatch`]
/// fields, and whether the reminder is let go as Core's own afterwards.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WhenWrite {
    /// `TodoPatch::due`.
    pub due: Option<Option<String>>,
    /// `TodoPatch::remind_at`: `Some(Some(iso))` hangs the reminder there
    /// (moves its task, arms one that went off); `Some(None)` is the
    /// user's removal (its task cancelled as the desktop's).
    pub remind_at: Option<Option<String>>,
    /// `TodoPatch::repeat`.
    pub repeat: Option<TodoRepeatRule>,
    /// Let the reminder go as Core's ([`crate::api::Origin::system`]): its
    /// time passed and nothing repeats, or its due date was taken away.
    pub let_reminder_go: bool,
}

fn invalid(message: String) -> GalleyError {
    GalleyError::InvalidArgs { message }
}

/// Where the reminder ends up.
enum Reminder {
    /// As it is.
    Keep,
    /// Hung at this instant.
    At(DateTime<Utc>),
    /// The user's removal.
    Remove,
    /// Let go as Core's.
    LetGo,
}

/// The offset a reminder at `at` on a to-do due `due` keeps when the due
/// day moves (ruling 205 point 2): read off where it is
/// ([`remind_offset`]); but under a rule that records a reminder
/// (`rule_remind`), one that reads as after the due day is Core's re-arm
/// at a later period's time (ticket 154 behaviour 13), and keeps the
/// rule's offset (main chat ticket 157).
fn carried_offset<Tz: TimeZone>(
    due: &StoredDue,
    at: DateTime<Utc>,
    rule_remind: Option<RemindOffset>,
    tz: &Tz,
) -> RemindOffset {
    let own = remind_offset(due, at, tz);
    match rule_remind {
        Some(rule) if own.days_before < 0 => rule,
        _ => own,
    }
}

/// What `change` writes on a to-do holding `before`, at `now`, its days
/// read in `tz`. `invalid_args` for a reminder days before a due date when
/// there is none after the change, or a time that is not `HH:MM`; a rule
/// that does not check is refused as `update_todo` refuses it
/// ([`RepeatRule::checked`]). A rule given with no due date is left for
/// `update_todo` to refuse (`repeat_needs_due:`).
pub fn when_write<Tz: TimeZone>(
    change: &TodoWhenChange,
    before: &TodoWhenNow,
    now: DateTime<Utc>,
    tz: &Tz,
    context: &str,
) -> Result<WhenWrite> {
    let due_after = match &change.due {
        None => before.due.clone(),
        Some(None) => None,
        Some(Some(raw)) => Some(parse_todo_due(raw, tz)?),
    };
    let day_before = before.due.as_ref().map(|due| due.local_date(tz));
    let day_after = due_after.as_ref().map(|due| due.local_date(tz));
    // The rule once this change is made: the one given, counted from the
    // due day; else the one it already has.
    let rule_after = match (&change.repeat, &due_after) {
        (Some(given), Some(due)) => Some(RepeatRule::checked(given, due.local_date(tz), context)?),
        (Some(_), None) => None,
        (None, _) => before.rule.clone(),
    };
    // A reminder `offset` from the due day after the change: there when it
    // is still ahead; past, one following the day (`toward_due`, ticket 157)
    // tries a day nearer the due day at the same time, down to the due day
    // itself (an offset below 0 is not walked); none ahead, a repeating
    // period's goes to the first time still ahead after its day, anything
    // else's is let go ([`reminder_toward_due`], which `todo update
    // --series` uses too since ticket 158).
    let hang = |offset: RemindOffset, day: NaiveDate, toward_due: bool| -> Reminder {
        let time_of_day = due_after.as_ref().and_then(|due| due_time_of_day(due, tz));
        match reminder_toward_due(
            day,
            offset,
            toward_due,
            rule_after.as_ref(),
            time_of_day,
            now,
            tz,
        ) {
            Some(at) => Reminder::At(at),
            None => Reminder::LetGo,
        }
    };
    let reminder = match &change.remind {
        Some(None) => Reminder::Remove,
        Some(Some(given)) => {
            let Some(day) = day_after else {
                return Err(invalid(format!(
                    "{context}: a reminder days before the due date needs a due date"
                )));
            };
            let time = parse_hhmm(given.time.trim()).ok_or_else(|| {
                invalid(format!(
                    "{context}: a reminder's time is HH:MM, got {:?}",
                    given.time
                ))
            })?;
            hang(
                RemindOffset {
                    days_before: given.days_before,
                    time,
                },
                day,
                false,
            )
        }
        // It follows the day.
        None => match (before.reminder, &before.due, day_before, day_after) {
            (None, ..) => Reminder::Keep,
            // 「不定日子」: the reminder goes with the due date.
            (Some(_), _, Some(_), None) => Reminder::LetGo,
            (Some(at), Some(due), Some(was), Some(day)) if was != day => {
                let rule_remind = before.rule.as_ref().and(before.rule_remind);
                hang(carried_offset(due, at, rule_remind, tz), day, true)
            }
            // The same day (only the time of day changed), or no due date
            // before: no offset to carry, the reminder stays.
            _ => Reminder::Keep,
        },
    };
    let (remind_at, let_reminder_go) = match reminder {
        Reminder::Keep => (None, false),
        Reminder::At(at) => (Some(Some(instant_to_utc_iso(&at))), false),
        Reminder::Remove => (Some(None), false),
        Reminder::LetGo => (None, before.reminder.is_some()),
    };
    Ok(WhenWrite {
        due: change.due.clone(),
        remind_at,
        repeat: change.repeat.clone(),
        let_reminder_go,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::schedule::resolve_wall_clock;
    use crate::api::todo::TodoRepeatKind;
    use chrono::NaiveTime;
    use chrono_tz::America::Los_Angeles;
    use chrono_tz::Asia::Shanghai;
    use chrono_tz::Tz;

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    /// A local wall-clock time in `tz`, as an instant.
    fn at(tz: &Tz, on: NaiveDate, h: u32, m: u32) -> DateTime<Utc> {
        resolve_wall_clock(tz, on.and_time(NaiveTime::from_hms_opt(h, m, 0).unwrap()))
            .with_timezone(&Utc)
    }

    fn iso(at: DateTime<Utc>) -> Option<Option<String>> {
        Some(Some(instant_to_utc_iso(&at)))
    }

    fn move_to(raw: &str) -> TodoWhenChange {
        TodoWhenChange {
            due: Some(Some(raw.into())),
            ..TodoWhenChange::default()
        }
    }

    fn remind(days_before: i64, time: &str) -> TodoWhenChange {
        TodoWhenChange {
            remind: Some(Some(TodoRepeatRemind {
                days_before,
                time: time.into(),
            })),
            ..TodoWhenChange::default()
        }
    }

    fn weekly(on: NaiveDate) -> RepeatRule {
        use chrono::Datelike;
        RepeatRule {
            kind: TodoRepeatKind::Weekly,
            every: 1,
            days: vec![on.weekday().number_from_monday() as u8],
            anchor: on,
        }
    }

    fn write(
        change: &TodoWhenChange,
        before: &TodoWhenNow,
        now: DateTime<Utc>,
        tz: &Tz,
    ) -> WhenWrite {
        when_write(change, before, now, tz, "t").unwrap()
    }

    #[test]
    fn the_reminder_moves_with_the_day_by_days_and_a_local_time() {
        for tz in [Shanghai, Los_Angeles] {
            let now = at(&tz, day(2026, 11, 10), 12, 0);
            // Due Fri Nov 20, reminded the evening before at 20:00; moved
            // to Wed Nov 25: the evening before that.
            let before = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 20))),
                reminder: Some(at(&tz, day(2026, 11, 19), 20, 0)),
                rule: None,
                rule_remind: None,
            };
            let got = write(&move_to("2026-11-25"), &before, now, &tz);
            assert_eq!(got.due, Some(Some("2026-11-25".into())));
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 24), 20, 0)));
            assert!(!got.let_reminder_go);
            // A day with a time: the same, read off its local day.
            let before = TodoWhenNow {
                due: Some(StoredDue::At(at(&tz, day(2026, 11, 20), 15, 0))),
                reminder: Some(at(&tz, day(2026, 11, 20), 14, 0)),
                rule: None,
                rule_remind: None,
            };
            let got = write(&move_to("2026-11-23T09:30"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 23), 14, 0)));
            // A reminder after the due day keeps being after it.
            let before = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 20))),
                reminder: Some(at(&tz, day(2026, 11, 21), 9, 0)),
                rule: None,
                rule_remind: None,
            };
            let got = write(&move_to("2026-12-01"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 12, 2), 9, 0)));
        }
    }

    #[test]
    fn only_the_time_of_day_changing_leaves_the_reminder_alone() {
        let tz = Shanghai;
        let now = at(&tz, day(2026, 11, 10), 12, 0);
        // 15:00 to 17:00 the same day: nothing for the reminder, even one
        // that went off earlier today (moving it would let it go).
        let before = TodoWhenNow {
            due: Some(StoredDue::At(at(&tz, day(2026, 11, 10), 15, 0))),
            reminder: Some(at(&tz, day(2026, 11, 10), 9, 0)),
            rule: None,
            rule_remind: None,
        };
        let got = write(&move_to("2026-11-10T17:00"), &before, now, &tz);
        assert_eq!(got.due, Some(Some("2026-11-10T17:00".into())));
        assert_eq!(got.remind_at, None);
        assert!(!got.let_reminder_go);
        // A day given a time, or a time taken off the same day: the same.
        let day_only = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 12))),
            reminder: Some(at(&tz, day(2026, 11, 11), 20, 0)),
            rule: None,
            rule_remind: None,
        };
        let got = write(&move_to("2026-11-12T08:00"), &day_only, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (None, false));
        let got = write(&move_to("2026-11-10"), &before, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (None, false));
    }

    #[test]
    fn a_reminder_moved_or_set_into_the_past_is_not_hung() {
        let tz = Los_Angeles;
        let now = at(&tz, day(2026, 11, 10), 12, 0);
        let before = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 20))),
            reminder: Some(at(&tz, day(2026, 11, 19), 9, 0)),
            rule: None,
            rule_remind: None,
        };
        // Moved to today: the day before at 09:00 has passed.
        let got = write(&move_to("2026-11-10"), &before, now, &tz);
        assert_eq!(got.remind_at, None);
        assert!(got.let_reminder_go);
        // Set to today at 12:00 itself on a to-do due today: no later than
        // now is passed, and the reminder it had is let go...
        let today = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 10))),
            reminder: Some(at(&tz, day(2026, 11, 9), 9, 0)),
            rule: None,
            rule_remind: None,
        };
        let got = write(&remind(0, "12:00"), &today, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (None, true));
        // ...with none, there is nothing to let go; a minute later is hung.
        let bare = TodoWhenNow {
            reminder: None,
            ..today.clone()
        };
        let got = write(&remind(0, "12:00"), &bare, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (None, false));
        let got = write(&remind(0, "12:01"), &bare, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 10), 12, 1)));
    }

    #[test]
    fn a_repeating_periods_reminder_is_hung_at_the_next_time_ahead() {
        let tz = Shanghai;
        // Wednesday Nov 11, 21:00.
        let now = at(&tz, day(2026, 11, 11), 21, 0);
        // Weekly on Monday; this period due Mon Nov 16, reminded the
        // evening before at 20:00. Moved to today, Wed Nov 11: Tue 20:00
        // and, falling back toward the due day (ticket 157), Wed 20:00
        // have passed, so the same reminder goes to the evening before the
        // rule's first Monday after Wednesday (Sun Nov 15, 20:00).
        let before = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 16))),
            reminder: Some(at(&tz, day(2026, 11, 15), 20, 0)),
            rule: Some(weekly(day(2026, 11, 16))),
            rule_remind: None,
        };
        let got = write(&move_to("2026-11-11"), &before, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 15), 20, 0)));
        assert!(!got.let_reminder_go);
        // The rule is not touched.
        assert_eq!(got.repeat, None);
        // Moved to Tue Nov 10, a day after its time too (Mon 20:00): the
        // first Monday after Tuesday is Nov 16 again.
        let got = write(&move_to("2026-11-10"), &before, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 15), 20, 0)));
        // Moved to Thu Nov 12: Wed 20:00 has passed, but Thu 20:00, on the
        // due day, is still ahead (ticket 157): there, not after the day.
        let got = write(&move_to("2026-11-12"), &before, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 12), 20, 0)));
        // Set by hand: still ahead, there; passed, the same as moved.
        let got = write(&remind(0, "09:00"), &before, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 16), 9, 0)));
        let moved = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 11))),
            ..before.clone()
        };
        let got = write(&remind(0, "09:00"), &moved, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 16), 9, 0)));
        assert!(!got.let_reminder_go);
        // 「不提醒」 picked is the user's removal, repeating or not.
        let none = TodoWhenChange {
            remind: Some(None),
            ..TodoWhenChange::default()
        };
        let got = write(&none, &before, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (Some(None), false));
    }

    #[test]
    fn a_periods_reminder_core_moved_on_moves_by_its_rule() {
        let nine = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        for tz in [Shanghai, Los_Angeles] {
            // Wednesday Nov 11, 12:00.
            let now = at(&tz, day(2026, 11, 11), 12, 0);
            // Weekly on Monday, each period reminded on its day at 09:00.
            // This period was due Mon Nov 9; its reminder went off then and
            // Core armed it again at the next period's time, Mon Nov 16
            // 09:00 (ticket 154 behaviour 13): seven days after its day.
            let before = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 9))),
                reminder: Some(at(&tz, day(2026, 11, 16), 9, 0)),
                rule: Some(weekly(day(2026, 11, 9))),
                rule_remind: Some(RemindOffset {
                    days_before: 0,
                    time: nine,
                }),
            };
            // Moved to Fri Nov 13: the rule's offset from that day, not
            // seven days after it (Nov 20).
            let got = write(&move_to("2026-11-13"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 13), 9, 0)));
            assert!(!got.let_reminder_go);
            assert_eq!(got.repeat, None);
            // Moved to today: 09:00 has passed, so the first reminder time
            // still ahead among the rule's later days (Mon Nov 16).
            let got = write(&move_to("2026-11-11"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 16), 9, 0)));
            // A rule that records no reminder: read off where it is, as
            // before (Core moves nothing on then).
            let unrecorded = TodoWhenNow {
                rule_remind: None,
                ..before.clone()
            };
            let got = write(&move_to("2026-11-13"), &unrecorded, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 20), 9, 0)));
            // An ordinary to-do's reminder after its day keeps being after
            // it, whatever is passed for a rule's: there is no rule.
            let ordinary = TodoWhenNow {
                rule: None,
                ..before.clone()
            };
            let got = write(&move_to("2026-11-13"), &ordinary, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 20), 9, 0)));
        }
    }

    #[test]
    fn a_periods_own_reminder_set_by_hand_keeps_its_offset() {
        for tz in [Shanghai, Los_Angeles] {
            let now = at(&tz, day(2026, 11, 11), 12, 0);
            // The rule reminds on the day at 09:00; this period, due Mon
            // Nov 16, was set by hand to two days before at 20:00. Moved to
            // Wed Nov 18: two days before that at 20:00, not the rule's.
            let before = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 16))),
                reminder: Some(at(&tz, day(2026, 11, 14), 20, 0)),
                rule: Some(weekly(day(2026, 11, 16))),
                rule_remind: Some(RemindOffset {
                    days_before: 0,
                    time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                }),
            };
            let got = write(&move_to("2026-11-18"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 16), 20, 0)));
        }
    }

    #[test]
    fn a_reminder_following_the_day_falls_back_toward_it() {
        for tz in [Shanghai, Los_Angeles] {
            // Tuesday Nov 10, 21:00.
            let now = at(&tz, day(2026, 11, 10), 21, 0);
            // Due Fri Nov 13, reminded the day before at 09:00; pushed to
            // tomorrow: today 09:00 has passed, so the due day itself at
            // the same time.
            let friday = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 13))),
                reminder: Some(at(&tz, day(2026, 11, 12), 9, 0)),
                rule: None,
                rule_remind: None,
            };
            let got = write(&move_to("2026-11-11"), &friday, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 11), 9, 0)));
            assert!(!got.let_reminder_go);
            // A week before, moved to three days out: the nearest offset
            // still ahead, two days before (Wed Nov 11 09:00).
            let week = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 20))),
                reminder: Some(at(&tz, day(2026, 11, 13), 9, 0)),
                rule: None,
                rule_remind: None,
            };
            let got = write(&move_to("2026-11-13"), &week, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 11), 9, 0)));
            // Moved to today, after the time: nothing on or before the due
            // day is ahead, and nothing repeats — let go, as before.
            let got = write(&move_to("2026-11-10"), &friday, now, &tz);
            assert_eq!((got.remind_at, got.let_reminder_go), (None, true));
            // One after its due day is not walked: moved with the day, and
            // past, let go.
            let after = TodoWhenNow {
                reminder: Some(at(&tz, day(2026, 11, 14), 9, 0)),
                ..friday.clone()
            };
            let got = write(&move_to("2026-11-09"), &after, now, &tz);
            assert_eq!((got.remind_at, got.let_reminder_go), (None, true));
            // A reminder picked in the popover's row is not walked: the
            // day before tomorrow at 09:00 has passed, so none.
            let tomorrow = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 11))),
                ..friday.clone()
            };
            let got = write(&remind(1, "09:00"), &tomorrow, now, &tz);
            assert_eq!((got.remind_at, got.let_reminder_go), (None, true));
        }
    }

    #[test]
    fn a_repeating_periods_reminder_falls_back_toward_its_day_first() {
        let eight_pm = NaiveTime::from_hms_opt(20, 0, 0).unwrap();
        for tz in [Shanghai, Los_Angeles] {
            // Tuesday Nov 10, 21:00.
            let now = at(&tz, day(2026, 11, 10), 21, 0);
            // Weekly on Monday, each period reminded the evening before at
            // 20:00; this one due Mon Nov 16.
            let before = TodoWhenNow {
                due: Some(StoredDue::Date(day(2026, 11, 16))),
                reminder: Some(at(&tz, day(2026, 11, 15), 20, 0)),
                rule: Some(weekly(day(2026, 11, 16))),
                rule_remind: Some(RemindOffset {
                    days_before: 1,
                    time: eight_pm,
                }),
            };
            // Pushed to tomorrow: today 20:00 has passed, so the due day's
            // 20:00 — not the next period's, after the new day.
            let got = write(&move_to("2026-11-11"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 11), 20, 0)));
            // Moved to today: nothing on or before it ahead, so the next
            // period's time (the evening before Mon Nov 16).
            let got = write(&move_to("2026-11-10"), &before, now, &tz);
            assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 15), 20, 0)));
            assert!(!got.let_reminder_go);
        }
    }

    #[test]
    fn a_rule_given_with_the_change_counts_as_repeating() {
        let tz = Shanghai;
        // Thursday Nov 12, 21:00: the reminder's 20:00 has passed on the
        // new due day too, so nothing on or before it is ahead.
        let now = at(&tz, day(2026, 11, 12), 21, 0);
        let before = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 16))),
            reminder: Some(at(&tz, day(2026, 11, 15), 20, 0)),
            rule: None,
            rule_remind: None,
        };
        let change = TodoWhenChange {
            due: Some(Some("2026-11-12".into())),
            repeat: Some(TodoRepeatRule {
                kind: TodoRepeatKind::Weekly,
                weekdays: vec![4],
                monthdays: Vec::new(),
                every: 1,
            }),
            ..TodoWhenChange::default()
        };
        // Weekly on Thursday from Nov 12: the evening before Nov 19.
        let got = write(&change, &before, now, &tz);
        assert_eq!(got.remind_at, iso(at(&tz, day(2026, 11, 18), 20, 0)));
        assert_eq!(got.repeat, change.repeat);
    }

    #[test]
    fn no_due_date_takes_the_reminder_and_a_reminder_needs_one() {
        let tz = Shanghai;
        let now = at(&tz, day(2026, 11, 10), 12, 0);
        let before = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 20))),
            reminder: Some(at(&tz, day(2026, 11, 19), 20, 0)),
            rule: None,
            rule_remind: None,
        };
        let no_date = TodoWhenChange {
            due: Some(None),
            ..TodoWhenChange::default()
        };
        let got = write(&no_date, &before, now, &tz);
        assert_eq!(got.due, Some(None));
        assert_eq!((got.remind_at, got.let_reminder_go), (None, true));
        // With no reminder, nothing to let go.
        let bare = TodoWhenNow {
            reminder: None,
            ..before.clone()
        };
        assert!(!write(&no_date, &bare, now, &tz).let_reminder_go);
        // A reminder with no due date given a day: no offset to carry.
        let floating = TodoWhenNow {
            due: None,
            reminder: Some(at(&tz, day(2026, 11, 19), 20, 0)),
            rule: None,
            rule_remind: None,
        };
        let got = write(&move_to("2026-11-25"), &floating, now, &tz);
        assert_eq!((got.remind_at, got.let_reminder_go), (None, false));
        // Days before no due date: refused.
        let err = when_write(&remind(1, "20:00"), &floating, now, &tz, "t").unwrap_err();
        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
        let err = when_write(&remind(1, "8pm"), &before, now, &tz, "t").unwrap_err();
        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    }

    #[test]
    fn the_title_alone_changes_nothing_here() {
        let before = TodoWhenNow {
            due: Some(StoredDue::Date(day(2026, 11, 20))),
            reminder: Some(at(&Shanghai, day(2026, 11, 19), 20, 0)),
            rule: None,
            rule_remind: None,
        };
        let change = TodoWhenChange::default();
        assert!(change.is_empty());
        let got = write(
            &change,
            &before,
            at(&Shanghai, day(2026, 11, 10), 12, 0),
            &Shanghai,
        );
        assert_eq!(got, WhenWrite::default());
    }
}
