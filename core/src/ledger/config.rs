//! The ledger's switch: `GALLEY_LEDGER_SINCE=YYYY-MM-DD`.
//!
//! Same shape as the remote module's `GALLEY_REMOTE_RELAY_URL`
//! (`remote/config.rs`): read once at startup, blank or unset means the
//! feature does not exist on this machine — no loop, no file, no
//! directory. A value that is set but not a date is logged and also
//! means off; a typo must never start reading conversations from an
//! unintended day. The public switch and the "from now / look back"
//! choice belong to ticket 04.

use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};

/// Environment variable naming the first local day the ledger reads.
pub const SINCE_ENV: &str = "GALLEY_LEDGER_SINCE";

/// The ledger is on: it reads conversations from `since` (local midnight)
/// onwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LedgerConfig {
    pub since: NaiveDate,
}

impl LedgerConfig {
    /// The switch as this process sees it. `None` is off (unset, blank or
    /// invalid; an invalid value is logged).
    pub fn from_env() -> Option<Self> {
        match parse_since(std::env::var(SINCE_ENV).ok().as_deref()) {
            Ok(Some(since)) => Some(Self { since }),
            Ok(None) => None,
            Err(e) => {
                eprintln!("[ledger] {e}; the affairs ledger stays off");
                None
            }
        }
    }

    /// Local midnight of `since` as an instant, in `tz` (production:
    /// [`Local`]). A midnight that a DST jump skips resolves to the first
    /// instant of that day.
    pub fn since_instant<Tz: TimeZone>(&self, tz: &Tz) -> DateTime<Utc> {
        let midnight = self.since.and_hms_opt(0, 0, 0).expect("midnight exists");
        match tz.from_local_datetime(&midnight).earliest() {
            Some(t) => t.with_timezone(&Utc),
            // A gap at midnight (a few zones jump 00:00 → 01:00): an hour
            // later is always inside the day.
            None => tz
                .from_local_datetime(&(midnight + chrono::Duration::hours(1)))
                .earliest()
                .map(|t| t.with_timezone(&Utc))
                .unwrap_or_else(|| Utc.from_utc_datetime(&midnight)),
        }
    }

    /// [`Self::since_instant`] in the machine's zone.
    pub fn since_local(&self) -> DateTime<Utc> {
        self.since_instant(&Local)
    }
}

/// Parse the switch value: `Ok(None)` when unset or blank, `Err` when
/// set but not a `YYYY-MM-DD` date.
pub fn parse_since(raw: Option<&str>) -> Result<Option<NaiveDate>, String> {
    let Some(value) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(Some)
        .map_err(|_| format!("{SINCE_ENV}={value:?} is not a YYYY-MM-DD date"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unset_or_blank_is_off() {
        assert_eq!(parse_since(None), Ok(None));
        assert_eq!(parse_since(Some("")), Ok(None));
        assert_eq!(parse_since(Some("   ")), Ok(None));
    }

    #[test]
    fn a_date_is_on() {
        assert_eq!(
            parse_since(Some(" 2026-10-12 ")),
            Ok(NaiveDate::from_ymd_opt(2026, 10, 12))
        );
    }

    #[test]
    fn anything_else_is_an_error_and_stays_off() {
        for bad in [
            "2026-13-01",
            "12/10/2026",
            "yesterday",
            "2026-10-12T00:00:00",
        ] {
            assert!(parse_since(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn since_is_local_midnight() {
        let config = LedgerConfig {
            since: NaiveDate::from_ymd_opt(2026, 10, 12).unwrap(),
        };
        let shanghai = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        assert_eq!(
            config.since_instant(&shanghai).to_rfc3339(),
            "2026-10-11T16:00:00+00:00"
        );
    }
}
