//! Windows into a session's visible transcript, for `galley session show
//! --around` and `--since` / `--until` (main chat ticket 03b,
//! `.scratch/main-chat/issues/03-segments-and-injection.md`): a search
//! hit read in context, and "what we talked about last Wednesday".
//! Contract: `docs/agent-api/session-commands.md` §5.5.

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};

use super::message::MessageId;
use crate::error::{GalleyError, Result};

/// Messages read on each side of `--around` when `--context` is not
/// given. One look is then at most 21 rows, the size of the `--tail=20`
/// read the managed prompt already teaches; ten rows either side usually
/// reach from a hit back to the user message that opened its turn and on
/// to the reply (a turn is one user row plus a row per agent step).
pub const DEFAULT_AROUND_CONTEXT: usize = 10;

/// Which part of a session's visible transcript to read. Rows come back
/// oldest first, in transcript order `(turn_index, sequence, id)`, as
/// `MessageBrief`s — the same rows a full `session show` prints.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageWindow {
    /// The message plus up to `context` visible messages before it and
    /// `context` after it.
    Around {
        message_id: MessageId,
        context: usize,
    },
    /// Visible messages with `since <= createdAt < until` (either bound
    /// may be absent); of those, only the last `tail` when it is set.
    Between {
        since: Option<DateTime<Utc>>,
        until: Option<DateTime<Utc>>,
        tail: Option<usize>,
    },
}

impl MessageWindow {
    /// A time window. `invalid_args` when `since` is not before `until`:
    /// that window can never hold a message.
    pub fn between(
        since: Option<DateTime<Utc>>,
        until: Option<DateTime<Utc>>,
        tail: Option<usize>,
    ) -> Result<Self> {
        if let (Some(since), Some(until)) = (since, until) {
            if since >= until {
                return Err(GalleyError::InvalidArgs {
                    message: format!(
                        "--since ({}) must be earlier than --until ({})",
                        since.to_rfc3339_opts(SecondsFormat::Secs, true),
                        until.to_rfc3339_opts(SecondsFormat::Secs, true)
                    ),
                });
            }
        }
        Ok(Self::Between { since, until, tail })
    }
}

/// Which end of a time window a value bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeBound {
    Since,
    Until,
}

impl TimeBound {
    fn flag(self) -> &'static str {
        match self {
            Self::Since => "--since",
            Self::Until => "--until",
        }
    }
}

/// [`parse_time_bound`] in this machine's time zone — the user's, since
/// the CLI runs on the user's computer.
pub fn parse_local_time_bound(input: &str, bound: TimeBound) -> Result<DateTime<Utc>> {
    parse_time_bound(input, bound, &chrono::Local)
}

/// Read a `--since` / `--until` value. Accepted forms:
///
/// - `YYYY-MM-DD`: a whole local calendar day. `--since` starts at the
///   beginning of that day, `--until` includes all of it (the bound is
///   the start of the next day, exclusive).
/// - `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS[.fff]` (a space works in
///   place of the `T`): local time.
/// - RFC 3339 with `Z` or a `±HH:MM` offset: that instant.
///
/// A local time that falls in a daylight-saving gap is refused; one that
/// occurs twice means its first occurrence. A day that starts inside a
/// gap starts at its first existing hour.
pub fn parse_time_bound<Tz: TimeZone>(
    input: &str,
    bound: TimeBound,
    tz: &Tz,
) -> Result<DateTime<Utc>> {
    let value = input.trim();
    let invalid = |why: String| GalleyError::InvalidArgs {
        message: format!("{}: {why}", bound.flag()),
    };
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let day = match bound {
            TimeBound::Since => Some(date),
            TimeBound::Until => date.succ_opt(),
        }
        .ok_or_else(|| invalid(format!("`{value}` is out of range")))?;
        return start_of_local_day(day, tz)
            .ok_or_else(|| invalid(format!("`{value}` has no start in the local time zone")));
    }
    if let Ok(at) = DateTime::parse_from_rfc3339(value) {
        return Ok(at.with_timezone(&Utc));
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, format) {
            return tz
                .from_local_datetime(&naive)
                .earliest()
                .map(|at| at.with_timezone(&Utc))
                .ok_or_else(|| {
                    invalid(format!("`{value}` does not exist in the local time zone"))
                });
        }
    }
    Err(invalid(format!(
        "unreadable time `{value}`; use YYYY-MM-DD (a local day), YYYY-MM-DDTHH:MM[:SS] \
         (local time), or RFC 3339 with Z or ±HH:MM"
    )))
}

fn start_of_local_day<Tz: TimeZone>(day: NaiveDate, tz: &Tz) -> Option<DateTime<Utc>> {
    (0..=3).find_map(|hour| {
        let naive = day.and_hms_opt(hour, 0, 0)?;
        tz.from_local_datetime(&naive)
            .earliest()
            .map(|at| at.with_timezone(&Utc))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    use chrono_tz::America::{New_York, Santiago};
    use chrono_tz::Asia::Shanghai;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn a_bare_date_is_the_whole_local_day() {
        assert_eq!(
            parse_time_bound("2026-10-08", TimeBound::Since, &Shanghai).unwrap(),
            utc("2026-10-07T16:00:00Z")
        );
        assert_eq!(
            parse_time_bound("2026-10-08", TimeBound::Until, &Shanghai).unwrap(),
            utc("2026-10-08T16:00:00Z"),
            "--until includes the whole day: the bound is the next day's start"
        );
        // The same day as since and until is a one-day window, not empty.
        let window = MessageWindow::between(
            Some(parse_time_bound("2026-10-08", TimeBound::Since, &Shanghai).unwrap()),
            Some(parse_time_bound("2026-10-08", TimeBound::Until, &Shanghai).unwrap()),
            None,
        );
        assert!(window.is_ok());
    }

    #[test]
    fn local_times_and_offsets() {
        assert_eq!(
            parse_time_bound("2026-10-08T14:30", TimeBound::Since, &Shanghai).unwrap(),
            utc("2026-10-08T06:30:00Z")
        );
        assert_eq!(
            parse_time_bound("2026-10-08T14:30:15.5", TimeBound::Until, &Shanghai).unwrap(),
            utc("2026-10-08T06:30:15.5Z")
        );
        // An explicit offset is that instant, whatever the local zone.
        for value in ["2026-10-08T14:30:00+08:00", "2026-10-08T06:30:00Z"] {
            assert_eq!(
                parse_time_bound(value, TimeBound::Since, &New_York).unwrap(),
                utc("2026-10-08T06:30:00Z"),
                "{value}"
            );
        }
        assert_eq!(
            parse_time_bound("2026-10-08 14:30", TimeBound::Since, &Shanghai).unwrap(),
            utc("2026-10-08T06:30:00Z"),
            "a space in place of the T"
        );
        assert_eq!(
            parse_time_bound(
                " 2026-10-08 ",
                TimeBound::Since,
                &FixedOffset::east_opt(0).unwrap()
            )
            .unwrap(),
            utc("2026-10-08T00:00:00Z")
        );
    }

    #[test]
    fn daylight_saving_edges() {
        // New York springs forward at 02:00 on 2026-03-08: 02:30 never
        // happens, and the day itself still starts at 00:00 EST.
        let err = parse_time_bound("2026-03-08T02:30", TimeBound::Since, &New_York).unwrap_err();
        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
        assert_eq!(
            parse_time_bound("2026-03-08", TimeBound::Since, &New_York).unwrap(),
            utc("2026-03-08T05:00:00Z")
        );
        // Falls back at 02:00 on 2026-11-01: 01:30 happens twice, the
        // first (EDT) one counts.
        assert_eq!(
            parse_time_bound("2026-11-01T01:30", TimeBound::Since, &New_York).unwrap(),
            utc("2026-11-01T05:30:00Z")
        );
        // Santiago springs forward at midnight (2026-09-06): that day
        // starts at 01:00 local.
        assert_eq!(
            parse_time_bound("2026-09-06", TimeBound::Since, &Santiago).unwrap(),
            utc("2026-09-06T04:00:00Z")
        );
    }

    #[test]
    fn unreadable_values_are_invalid_args_naming_the_flag() {
        for value in [
            "last wednesday",
            "2026-13-01",
            "2026-10-08T25:00",
            "",
            "1696723200",
        ] {
            let err = parse_time_bound(value, TimeBound::Until, &Shanghai).unwrap_err();
            match err {
                GalleyError::InvalidArgs { message } => {
                    assert!(message.starts_with("--until: "), "{message}")
                }
                other => panic!("{value}: {other:?}"),
            }
        }
    }

    #[test]
    fn a_window_that_cannot_hold_a_message_is_refused() {
        let at = utc("2026-10-08T06:30:00Z");
        for (since, until) in [(at, at), (at, utc("2026-10-08T06:00:00Z"))] {
            let err = MessageWindow::between(Some(since), Some(until), None).unwrap_err();
            assert!(matches!(err, GalleyError::InvalidArgs { .. }));
        }
        assert!(MessageWindow::between(Some(at), None, Some(5)).is_ok());
        assert!(MessageWindow::between(None, Some(at), None).is_ok());
    }
}
