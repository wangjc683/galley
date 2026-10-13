//! What the human said in Galley sessions (the database half of the
//! ledger's input; the IM half is `im_archive`).
//!
//! The rule is the ticket's: read user messages a human typed —
//! `created_via = 'gui'` on the message AND on its session (the phone
//! writes `gui` too, with `client = 'ios'`), managed runtime, visible.
//! (Ticket 04d retired the per-session / per-project opt-out of
//! migration 045: the switch is the one way to stop the reading.)
//! Never CLI, supervisor, scheduler, Goal or `system` sessions —
//! their "user" messages are another agent's or an automation's — never
//! the mining session itself (`system`), never assistant text. The SQL
//! is `SqliteGalley::ledger_human_turns`; this module adds the time
//! window, compared as parsed instants (rows carry both `+00:00` and the
//! GUI's older `…Z` shape).

use chrono::{DateTime, Duration, Utc};

use crate::db::SqliteGalley;
use crate::error::Result;

/// One message a human typed into a Galley session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuiTurn {
    pub session_id: String,
    pub message_id: String,
    pub at: DateTime<Utc>,
    pub text: String,
}

/// Human turns created in `[from, until)`, oldest first.
pub async fn gui_turns(
    galley: &SqliteGalley,
    from: DateTime<Utc>,
    until: DateTime<Utc>,
) -> Result<Vec<GuiTurn>> {
    // Coarse SQL floor on the date prefix (both stored shapes start with
    // `YYYY-MM-DD`); a day of slack, the exact cut is below.
    let floor = (from - Duration::days(1)).format("%Y-%m-%d").to_string();
    let rows = galley.ledger_human_turns(&floor).await?;
    let mut turns: Vec<GuiTurn> = rows
        .into_iter()
        .filter_map(|row| {
            let at = match DateTime::parse_from_rfc3339(&row.created_at) {
                Ok(at) => at.with_timezone(&Utc),
                Err(_) => {
                    eprintln!(
                        "[ledger] message {} has an unreadable created_at {:?}; skipped",
                        row.message_id, row.created_at
                    );
                    return None;
                }
            };
            let text = row.content.trim();
            (at >= from && at < until && !text.is_empty()).then(|| GuiTurn {
                session_id: row.session_id,
                message_id: row.message_id,
                at,
                text: text.to_string(),
            })
        })
        .collect();
    turns.sort_by(|a, b| {
        a.at.cmp(&b.at)
            .then_with(|| a.message_id.cmp(&b.message_id))
    });
    Ok(turns)
}
