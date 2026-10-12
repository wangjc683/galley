//! The ledger's switch: Core pref [`SWITCH_PREF`] (ticket 04).
//!
//! - `{"on": true, "since": "<RFC 3339>", "lookBack": bool}`: on, reading
//!   what was said from `since` on. An optional `"notBefore": "<RFC 3339>"`
//!   holds every scheduled run back until then (ticket 04c, below).
//! - `{"on": false}`: off.
//! - No key (or JSON `null`): undecided — never set. Behaves exactly like
//!   off; Core turns it on when it creates the main chat (below).
//!
//! Read on every use — the resident daily tick, the startup IM archive,
//! the two injections (main chat, IM channels), `run_ledger_now` — so a
//! change takes effect without a restart. A running IM channel keeps the
//! list it started with (ticket 03a's known gap). A value that is set but
//! does not parse is off, and logged: a typo must never start reading
//! conversations.
//!
//! `since` is an instant, not a day: "from now" is the moment the user
//! turned it on (test messages typed earlier that day stay out); "look
//! back" stores the Unix epoch, no lower bound. Turning it on again keeps
//! the processed position (`from = max(processed, since)`, see
//! `run::prepare`), so "from now" skips the gap since it was turned off
//! and "look back" reads it; after a clear there is no position and it
//! starts at `since`.
//!
//! **On by default** (PRD ruling 47, ticket 04c). When Core creates the
//! main chat and the key is not there yet, it writes the switch on,
//! reading every earlier conversation ([`LedgerSwitch::on_by_default`]),
//! in the same transaction as the main chat's first message — a fixed
//! greeting that tells the user so. The first run then waits for the
//! next 04:00 (`notBefore`), not the next tick: whoever reads the
//! greeting has hours to turn it off before any conversation goes to
//! the model provider. Nothing is read before then, not even the startup
//! IM archive ([`super::archive_before_prune`]). Turning it on from the
//! Memory page writes no `notBefore` (04a: "look back" runs within a
//! minute).

use std::fmt::Display;

use chrono::{DateTime, TimeZone, Utc};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};
use serde_json::{json, Value};

use crate::api::GalleyApi;
use crate::db::SqliteGalley;

/// Core pref holding the switch.
pub const SWITCH_PREF: &str = "affairs_ledger";

/// The ledger is on: it reads conversations from `since` onwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LedgerConfig {
    pub since: DateTime<Utc>,
    /// The user chose "also read earlier conversations" (`since` is then
    /// the Unix epoch).
    pub look_back: bool,
    /// No scheduled run before this instant: the next 04:00 after Core
    /// turned the ledger on by default (ticket 04c). `None` for a switch
    /// turned on from the Memory page.
    pub not_before: Option<DateTime<Utc>>,
}

impl LedgerConfig {
    /// Whether `now` is still before [`Self::not_before`]: on, but not
    /// started yet.
    pub fn waiting_at(&self, now: DateTime<Utc>) -> bool {
        self.not_before.is_some_and(|not_before| now < not_before)
    }
}

/// The switch as the pref holds it. Wire shape (Tauri commands):
/// `{"state": "undecided"}`, `{"state": "off"}`, or
/// `{"state": "on", "since": "<RFC 3339>", "lookBack": bool}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerSwitch {
    Undecided,
    Off,
    On(LedgerConfig),
}

impl LedgerSwitch {
    /// The configuration while on; `None` while off or undecided.
    pub fn config(&self) -> Option<LedgerConfig> {
        match self {
            Self::On(config) => Some(*config),
            Self::Undecided | Self::Off => None,
        }
    }

    pub fn is_on(&self) -> bool {
        matches!(self, Self::On(_))
    }

    /// "From now" (`look_back = false`, `since = now` in whole seconds) or
    /// "also read earlier conversations" (`since` = the Unix epoch).
    pub fn turned_on(look_back: bool, now: DateTime<Utc>) -> Self {
        let since = if look_back {
            DateTime::<Utc>::UNIX_EPOCH
        } else {
            DateTime::<Utc>::from_timestamp(now.timestamp(), 0).expect("in range")
        };
        Self::On(LedgerConfig {
            since,
            look_back,
            not_before: None,
        })
    }

    /// What Core writes when it creates the main chat and the switch was
    /// never set (PRD ruling 47): on, reading every earlier conversation,
    /// with the first run held back to the next 04:00 after `now`
    /// ([`super::run::next_daily_run_time`]).
    pub fn on_by_default<Tz: TimeZone>(now: DateTime<Utc>, tz: &Tz) -> Self
    where
        Tz::Offset: Display,
    {
        Self::On(LedgerConfig {
            since: DateTime::<Utc>::UNIX_EPOCH,
            look_back: true,
            not_before: Some(super::run::next_daily_run_time(now, tz)),
        })
    }

    /// The pref value; `None` for undecided (no key).
    pub fn to_pref(&self) -> Option<Value> {
        match self {
            Self::Undecided => None,
            Self::Off => Some(json!({ "on": false })),
            Self::On(config) => {
                let mut value = json!({
                    "on": true,
                    "since": config.since.to_rfc3339(),
                    "lookBack": config.look_back,
                });
                if let Some(not_before) = config.not_before {
                    value["notBefore"] = json!(not_before.to_rfc3339());
                }
                Some(value)
            }
        }
    }
}

impl Serialize for LedgerSwitch {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Undecided | Self::Off => {
                let mut map = serializer.serialize_map(Some(1))?;
                let state = if matches!(self, Self::Off) {
                    "off"
                } else {
                    "undecided"
                };
                map.serialize_entry("state", state)?;
                map.end()
            }
            Self::On(config) => {
                let mut map = serializer.serialize_map(Some(3))?;
                map.serialize_entry("state", "on")?;
                map.serialize_entry("since", &config.since.to_rfc3339())?;
                map.serialize_entry("lookBack", &config.look_back)?;
                map.end()
            }
        }
    }
}

/// The switch from the pref's value (`None`: no key). Anything set but
/// not one of the two shapes is off, logged — a `notBefore` that does
/// not read as a time included: it must never make a run come early.
pub fn parse_switch(value: Option<&Value>) -> LedgerSwitch {
    let value = match value {
        None | Some(Value::Null) => return LedgerSwitch::Undecided,
        Some(value) => value,
    };
    match value.get("on").and_then(Value::as_bool) {
        Some(false) => LedgerSwitch::Off,
        Some(true) => {
            let since = value
                .get("since")
                .and_then(Value::as_str)
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|t| t.with_timezone(&Utc));
            let look_back = value
                .get("lookBack")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let not_before = match value.get("notBefore") {
                None | Some(Value::Null) => Ok(None),
                Some(raw) => raw
                    .as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| Some(t.with_timezone(&Utc)))
                    .ok_or(()),
            };
            match (since, not_before) {
                (Some(since), Ok(not_before)) => LedgerSwitch::On(LedgerConfig {
                    since,
                    look_back,
                    not_before,
                }),
                (Some(_), Err(())) => {
                    eprintln!(
                        "[ledger] {SWITCH_PREF}={value} has an unreadable \"notBefore\"; \
                         the affairs ledger stays off"
                    );
                    LedgerSwitch::Off
                }
                (None, _) => {
                    eprintln!(
                        "[ledger] {SWITCH_PREF}={value} has no readable \"since\"; \
                         the affairs ledger stays off"
                    );
                    LedgerSwitch::Off
                }
            }
        }
        None => {
            eprintln!(
                "[ledger] {SWITCH_PREF}={value} is not a switch; the affairs ledger stays off"
            );
            LedgerSwitch::Off
        }
    }
}

/// The switch as stored now. A database error reads as off (logged):
/// never start reading on a guess.
pub async fn read_switch(galley: &SqliteGalley) -> LedgerSwitch {
    match galley.get_pref_json(SWITCH_PREF).await {
        Ok(value) => parse_switch(value.as_ref()),
        Err(e) => {
            eprintln!("[ledger] reading {SWITCH_PREF} failed: {e}; treating the ledger as off");
            LedgerSwitch::Off
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    #[test]
    fn no_key_or_null_is_undecided() {
        assert_eq!(parse_switch(None), LedgerSwitch::Undecided);
        assert_eq!(parse_switch(Some(&Value::Null)), LedgerSwitch::Undecided);
    }

    #[test]
    fn the_two_shapes_round_trip() {
        let off = LedgerSwitch::Off;
        assert_eq!(parse_switch(off.to_pref().as_ref()), off);
        let on = LedgerSwitch::turned_on(false, utc("2026-10-12T06:30:15.700Z"));
        assert_eq!(
            on.to_pref().unwrap(),
            json!({"on": true, "since": "2026-10-12T06:30:15+00:00", "lookBack": false})
        );
        assert_eq!(parse_switch(on.to_pref().as_ref()), on);
        assert_eq!(LedgerSwitch::Undecided.to_pref(), None);
    }

    #[test]
    fn look_back_starts_at_the_epoch() {
        let on = LedgerSwitch::turned_on(true, utc("2026-10-12T06:30:00Z"));
        let config = on.config().unwrap();
        assert_eq!(config.since.timestamp(), 0);
        assert!(config.look_back);
        assert_eq!(
            on.to_pref().unwrap()["since"],
            json!("1970-01-01T00:00:00+00:00")
        );
    }

    #[test]
    fn anything_else_is_off() {
        for bad in [
            json!(true),
            json!("2026-10-12"),
            json!({"on": "yes"}),
            json!({"on": true}),
            json!({"on": true, "since": "2026-10-12"}),
            json!({"since": "2026-10-12T00:00:00Z"}),
            // A hold-back that does not read must not let a run come early.
            json!({"on": true, "since": "1970-01-01T00:00:00Z", "notBefore": "tomorrow"}),
            json!({"on": true, "since": "1970-01-01T00:00:00Z", "notBefore": 4}),
        ] {
            assert_eq!(parse_switch(Some(&bad)), LedgerSwitch::Off, "{bad}");
        }
    }

    /// Ticket 04c: on by default reads every earlier conversation and
    /// holds the first run back to the next 04:00, today's before four,
    /// tomorrow's from four on; the hold-back survives the pref.
    #[test]
    fn on_by_default_waits_for_the_next_four_oclock() {
        let shanghai = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        let cases = [
            ("2026-10-12T10:30:00+08:00", "2026-10-13T04:00:00+08:00"),
            ("2026-10-12T02:15:00+08:00", "2026-10-12T04:00:00+08:00"),
            ("2026-10-12T04:00:00+08:00", "2026-10-13T04:00:00+08:00"),
            ("2026-10-12T23:59:00+08:00", "2026-10-13T04:00:00+08:00"),
        ];
        for (now, first) in cases {
            let on = LedgerSwitch::on_by_default(utc(now), &shanghai);
            let config = on.config().unwrap();
            assert_eq!(config.since.timestamp(), 0, "{now}");
            assert!(config.look_back);
            assert_eq!(config.not_before, Some(utc(first)), "{now}");
            assert!(config.waiting_at(utc(now)));
            assert!(!config.waiting_at(utc(first)));
            let pref = on.to_pref().unwrap();
            assert_eq!(pref["notBefore"], json!(utc(first).to_rfc3339()));
            assert_eq!(parse_switch(Some(&pref)), on, "round trip");
        }
        // The page's own "on" has no hold-back, and its pref no key.
        let page = LedgerSwitch::turned_on(true, utc("2026-10-12T10:30:00Z"));
        assert_eq!(page.config().unwrap().not_before, None);
        assert!(page.to_pref().unwrap().get("notBefore").is_none());
        assert!(!page
            .config()
            .unwrap()
            .waiting_at(utc("2026-10-12T10:30:00Z")));
    }

    #[test]
    fn wire_shape() {
        assert_eq!(
            serde_json::to_value(LedgerSwitch::Undecided).unwrap(),
            json!({"state": "undecided"})
        );
        assert_eq!(
            serde_json::to_value(LedgerSwitch::Off).unwrap(),
            json!({"state": "off"})
        );
        assert_eq!(
            serde_json::to_value(LedgerSwitch::turned_on(true, utc("2026-10-12T00:00:00Z")))
                .unwrap(),
            json!({"state": "on", "since": "1970-01-01T00:00:00+00:00", "lookBack": true})
        );
    }
}
