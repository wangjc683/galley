//! To-dos (main chat ticket 39, PRD ruling 91): Galley's notebook of the
//! user's own things to do.
//!
//! Galley notes one in the conversation when the user mentions something
//! they have to do — with a due date or without — and may hang a reminder
//! on it. The user only ticks it off, unticks it, cancels its reminder or,
//! since main chat ticket 88, deletes it, and since ticket 107 changes its
//! title and notes (the desktop's five commands); everything else they say
//! to Galley, which changes it through the CLI (ticket 40). Core holds the
//! record (`todos`, migration 050) and decides every write (Rule 5).
//!
//! A reminder is a scheduled task (main chat ticket 33): a one-off that
//! wakes the assistant, linked to its to-do (`scheduled_tasks.todo_id`,
//! [`super::ScheduledTaskBrief::todo_id`]). Setting, moving and removing it
//! go through the scheduled-task functions; there is no second scheduler.
//!
//! The due date keeps the form the user gave it ([`TodoDue`]): a calendar
//! day with no time ("by Friday") is a floating local date, stored as
//! `YYYY-MM-DD`; a day with a time ("Wednesday 3 pm") is an instant,
//! stored in UTC. A day alone cannot be an instant without picking a zone
//! and an hour, and would then drift to Thursday when the computer moves
//! west; a time of day is an instant like a reminder's. Readers group by
//! day in this machine's zone.

use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use super::schedule::{
    instant_to_utc_iso, parse_fire_at, resolve_wall_clock, ScheduledTaskCreatedIn, ScheduledTaskId,
};
use super::Origin;
use crate::error::{GalleyError, Result};

/// Tauri event fired after any to-do change: made, changed, ticked off,
/// unticked, cancelled, its reminder cancelled, the turn it was noted in
/// settled, every to-do cleared by a main chat reset. Payload is empty —
/// the desktop reads again, as for
/// [`super::SCHEDULED_TASKS_CHANGED_EVENT`]. A write that also touched the
/// reminder fires that event too. Desktop only: the remote module does not
/// forward it.
pub const TODOS_CHANGED_EVENT: &str = "todos:changed";

/// Opaque to-do identifier, `todo_<16 hex>` ([`mint_todo_id`]).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TodoId(pub String);

impl TodoId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for TodoId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Mint a to-do id: `todo_` and 16 hex digits, stirred like a scheduled
/// task's ([`super::schedule::mint_scheduled_task_id`]).
pub fn mint_todo_id() -> String {
    format!("todo_{}", super::schedule::mint_hex16())
}

/// Where a to-do stands. Read off its stamps: cancelled wins, then done.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Open,
    Done,
    /// A soft delete: the row stays, no list but `--all` shows it.
    Cancelled,
}

/// When a to-do is due. `date` is always there; `at` and `time` only when
/// it has a time of day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDue {
    /// The local calendar day, `YYYY-MM-DD`: as stored for a day without
    /// a time; read off `at` in this machine's zone for one with a time.
    pub date: String,
    /// Whether it has a time of day (then `at` and `time` are set).
    pub has_time: bool,
    /// The instant, UTC ISO.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// Local `HH:MM` of `at`, for display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
}

/// A due date as stored: one of the two columns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredDue {
    /// `due_date`: a calendar day with no time.
    Date(NaiveDate),
    /// `due_at`: an instant.
    At(DateTime<Utc>),
}

impl StoredDue {
    /// From the two columns (`due_date`, `due_at`); `None` for neither.
    pub fn from_columns(date: Option<&str>, at: Option<&str>) -> Result<Option<Self>> {
        match (date, at) {
            (None, None) => Ok(None),
            (Some(date), None) => NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .map(|d| Some(Self::Date(d)))
                .map_err(|_| GalleyError::Internal {
                    message: format!("todo: bad due_date {date:?}"),
                }),
            (None, Some(at)) => DateTime::parse_from_rfc3339(at)
                .map(|at| Some(Self::At(at.with_timezone(&Utc))))
                .map_err(|_| GalleyError::Internal {
                    message: format!("todo: bad due_at {at:?}"),
                }),
            (Some(_), Some(_)) => Err(GalleyError::Internal {
                message: "todo: both due_date and due_at".into(),
            }),
        }
    }

    /// The two columns.
    pub fn columns(&self) -> (Option<String>, Option<String>) {
        match self {
            Self::Date(d) => (Some(d.format("%Y-%m-%d").to_string()), None),
            Self::At(at) => (None, Some(instant_to_utc_iso(at))),
        }
    }

    /// The day it is due on, in `tz`.
    pub fn local_date<Tz: TimeZone>(&self, tz: &Tz) -> NaiveDate {
        match self {
            Self::Date(d) => *d,
            Self::At(at) => at.with_timezone(tz).date_naive(),
        }
    }

    /// The instant it stops being on time: its instant, or the end of its
    /// day in `tz` (the next day's first instant) for a day without a time.
    pub fn deadline<Tz: TimeZone>(&self, tz: &Tz) -> DateTime<Utc> {
        match self {
            Self::At(at) => *at,
            Self::Date(d) => {
                let next = (*d + Duration::days(1)).and_time(NaiveTime::MIN);
                resolve_wall_clock(tz, next).with_timezone(&Utc)
            }
        }
    }

    /// Whether it is past due at `now`: its instant passed, or its day is
    /// before today in `tz`.
    pub fn overdue<Tz: TimeZone>(&self, now: DateTime<Utc>, tz: &Tz) -> bool {
        match self {
            Self::At(at) => *at < now,
            Self::Date(d) => *d < now.with_timezone(tz).date_naive(),
        }
    }

    /// The wire form, read in `tz`.
    pub fn to_wire<Tz: TimeZone>(&self, tz: &Tz) -> TodoDue
    where
        Tz::Offset: std::fmt::Display,
    {
        match self {
            Self::Date(d) => TodoDue {
                date: d.format("%Y-%m-%d").to_string(),
                has_time: false,
                at: None,
                time: None,
            },
            Self::At(at) => {
                let local = at.with_timezone(tz);
                TodoDue {
                    date: local.format("%Y-%m-%d").to_string(),
                    has_time: true,
                    at: Some(instant_to_utc_iso(at)),
                    time: Some(local.format("%H:%M").to_string()),
                }
            }
        }
    }

    /// For the model, local: `2026-10-21 15:00 (Wed)`, `2026-10-23 (Fri)`.
    pub fn words<Tz: TimeZone>(&self, tz: &Tz) -> String
    where
        Tz::Offset: std::fmt::Display,
    {
        match self {
            Self::Date(d) => d.format("%Y-%m-%d (%a)").to_string(),
            Self::At(at) => at
                .with_timezone(tz)
                .format("%Y-%m-%d %H:%M (%a)")
                .to_string(),
        }
    }
}

impl TodoDue {
    /// Back to the stored form (`at` when it has a time, else `date`).
    pub fn stored(&self) -> Option<StoredDue> {
        match self.at.as_deref() {
            Some(at) => StoredDue::from_columns(None, Some(at)).ok().flatten(),
            None => StoredDue::from_columns(Some(&self.date), None)
                .ok()
                .flatten(),
        }
    }
}

/// Read a due date (CLI `--due`): `YYYY-MM-DD` is a day with no time;
/// anything a one-off's time takes ([`parse_fire_at`]: RFC 3339, or a
/// local `YYYY-MM-DDTHH:MM`, read in `tz`) is a day with a time. A date in
/// the past is fine: the user may note something already late.
pub fn parse_todo_due<Tz: TimeZone>(input: &str, tz: &Tz) -> Result<StoredDue> {
    let value = input.trim();
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(StoredDue::Date(date));
    }
    parse_fire_at(value, tz)
        .map(StoredDue::At)
        .map_err(|_| GalleyError::InvalidArgs {
            message: format!(
                "todo: a due date is a local date YYYY-MM-DD, a local YYYY-MM-DDTHH:MM, or an \
                 RFC 3339 instant, got {value:?}"
            ),
        })
}

/// How a to-do's reminder stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoReminderState {
    /// It will go off.
    Scheduled,
    /// Switched off (`schedule disable`): it will not go off until resumed.
    Paused,
    /// It went off.
    Fired,
}

/// A to-do's reminder: its scheduled task, not cancelled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoReminder {
    pub task_id: ScheduledTaskId,
    /// When it goes off (went off for [`TodoReminderState::Fired`]: the
    /// planned time), UTC ISO.
    pub at: String,
    pub state: TodoReminderState,
}

/// The record (`todo show`, and what every write returns).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoBrief {
    pub id: TodoId,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<TodoDue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminder: Option<TodoReminder>,
    pub status: TodoStatus,
    /// When it was ticked off (a done to-do), UTC ISO.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_at: Option<String>,
    /// Who ticked it off: `gui` is the user at the desktop, `supervisor` +
    /// `galley-assistant` is Galley.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_by: Option<Origin>,
    /// Who made it.
    pub origin: Origin,
    /// The main chat turn Galley noted it in: the reply its card hangs
    /// under, and where the list jumps to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_in: Option<ScheduledTaskCreatedIn>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<String>,
    /// Who cancelled it, and why (main chat ticket 61): `gui` is the user
    /// at the desktop, `supervisor` + `galley-assistant` is Galley on the
    /// user's word, its `reason` the note it gave. Absent while it is not
    /// cancelled, and on a to-do cancelled before this was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_by: Option<Origin>,
    pub created_at: String,
    pub updated_at: String,
}

impl TodoBrief {
    pub fn is_open(&self) -> bool {
        self.status == TodoStatus::Open
    }

    /// The due date in its stored form.
    pub fn stored_due(&self) -> Option<StoredDue> {
        self.due.as_ref().and_then(TodoDue::stored)
    }
}

/// What a new to-do says ([`crate::db::SqliteGalley::create_todo`]).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoInput {
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    /// [`parse_todo_due`]'s forms.
    #[serde(default)]
    pub due: Option<String>,
    /// A reminder's time ([`parse_fire_at`]'s forms); one already past is
    /// refused ([`super::TIME_IN_PAST`]).
    #[serde(default)]
    pub remind_at: Option<String>,
}

/// A change: only what is given. The double `Option`s clear with
/// `Some(None)`: no notes, no due date, no reminder.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<Option<String>>,
    /// `Some(Some(time))` sets the reminder or moves it; `Some(None)`
    /// removes it (cancels its task).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remind_at: Option<Option<String>>,
}

impl TodoPatch {
    /// The desktop's change (main chat ticket 107, PRD ruling 153 point
    /// 4): the title and the notes, edited in place in the to-do panel,
    /// and nothing else — the due date and the reminder are said to
    /// Galley (point 5: moving one leaves the other where it was). Only
    /// what is given; empty notes take the notes away (Core trims them,
    /// and empty is none), as `todo update --notes=""` does.
    pub fn words(title: Option<String>, notes: Option<String>) -> Self {
        Self {
            title,
            notes: notes.map(Some),
            due: None,
            remind_at: None,
        }
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

    #[test]
    fn a_due_date_is_a_day_or_an_instant() {
        assert_eq!(
            parse_todo_due("2026-10-23", &Shanghai).unwrap(),
            StoredDue::Date(NaiveDate::from_ymd_opt(2026, 10, 23).unwrap())
        );
        // A local time reads in the zone; an instant is that instant.
        assert_eq!(
            parse_todo_due("2026-10-21T15:00", &Shanghai).unwrap(),
            StoredDue::At(utc("2026-10-21T07:00:00Z"))
        );
        assert_eq!(
            parse_todo_due("2026-10-21T15:00:00-07:00", &Shanghai).unwrap(),
            StoredDue::At(utc("2026-10-21T22:00:00Z"))
        );
        // A past date is fine (no time_in_past for a due date).
        assert!(parse_todo_due("2020-01-01", &Shanghai).is_ok());
        let err = parse_todo_due("Friday", &Shanghai).unwrap_err();
        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    }

    #[test]
    fn a_day_stays_put_and_an_instant_moves_with_the_zone() {
        let friday = StoredDue::Date(NaiveDate::from_ymd_opt(2026, 10, 23).unwrap());
        assert_eq!(friday.to_wire(&Los_Angeles).date, "2026-10-23");
        assert_eq!(friday.to_wire(&Shanghai).date, "2026-10-23");
        assert!(!friday.to_wire(&Shanghai).has_time);
        // 2026-10-21 01:00 UTC: the 21st in Shanghai, the 20th in LA.
        let early = StoredDue::At(utc("2026-10-21T01:00:00Z"));
        let wire = early.to_wire(&Shanghai);
        assert_eq!(wire.date, "2026-10-21");
        assert_eq!(wire.time.as_deref(), Some("09:00"));
        assert_eq!(wire.at.as_deref(), Some("2026-10-21T01:00:00+00:00"));
        assert!(wire.has_time);
        assert_eq!(early.to_wire(&Los_Angeles).date, "2026-10-20");
        // The wire form reads back as stored.
        assert_eq!(wire.stored(), Some(early.clone()));
        assert_eq!(friday.to_wire(&Shanghai).stored(), Some(friday.clone()));
        assert_eq!(early.words(&Shanghai), "2026-10-21 09:00 (Wed)");
        assert_eq!(friday.words(&Shanghai), "2026-10-23 (Fri)");
    }

    #[test]
    fn overdue_and_deadline() {
        let now = utc("2026-10-16T06:00:00Z"); // 14:00 Fri in Shanghai
        let today = StoredDue::Date(NaiveDate::from_ymd_opt(2026, 10, 16).unwrap());
        let yesterday = StoredDue::Date(NaiveDate::from_ymd_opt(2026, 10, 15).unwrap());
        // A day is on time all of that day.
        assert!(!today.overdue(now, &Shanghai));
        assert!(yesterday.overdue(now, &Shanghai));
        assert_eq!(
            today.deadline(&Shanghai),
            utc("2026-10-16T16:00:00Z") // midnight into Saturday, Shanghai
        );
        // A time is on time until it passes.
        assert!(StoredDue::At(utc("2026-10-16T05:59:00Z")).overdue(now, &Shanghai));
        assert!(!StoredDue::At(utc("2026-10-16T06:01:00Z")).overdue(now, &Shanghai));
    }

    #[test]
    fn the_desktops_change_is_the_title_and_the_notes_only() {
        let both = TodoPatch::words(Some("交周报".into()), Some("A 座 3 楼".into()));
        assert_eq!(both.title.as_deref(), Some("交周报"));
        assert_eq!(both.notes, Some(Some("A 座 3 楼".to_string())));
        assert!(both.due.is_none() && both.remind_at.is_none());
        // Only what is given; empty notes are given, and clear them.
        let notes = TodoPatch::words(None, Some(String::new()));
        assert!(notes.title.is_none());
        assert_eq!(notes.notes, Some(Some(String::new())));
        let none = TodoPatch::words(None, None);
        assert!(none.title.is_none() && none.notes.is_none());
    }

    #[test]
    fn ids_are_todo_and_sixteen_hex() {
        let a = mint_todo_id();
        let b = mint_todo_id();
        assert_ne!(a, b);
        let hex = a.strip_prefix("todo_").expect("prefix");
        assert_eq!(hex.len(), 16);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
