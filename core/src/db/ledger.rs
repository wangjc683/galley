//! Affairs-ledger storage (`crate::ledger`): the read of what humans
//! typed into Galley sessions. The ledger keeps nothing else in the
//! database (Rule 4).

use super::*;

/// One user message as `ledger_human_turns` reads it.
#[derive(Debug, Clone, FromRow)]
pub struct LedgerHumanTurnRow {
    pub message_id: String,
    pub session_id: String,
    pub content: String,
    pub created_at: String,
}

impl SqliteGalley {
    /// User messages a human typed into a GUI-created managed session,
    /// visible, created on or after `created_at_floor` (string compare on
    /// the `YYYY-MM-DD` prefix; the caller cuts the exact window).
    /// See `crate::ledger::sources` for why each condition is there.
    pub async fn ledger_human_turns(
        &self,
        created_at_floor: &str,
    ) -> Result<Vec<LedgerHumanTurnRow>> {
        sqlx::query_as::<_, LedgerHumanTurnRow>(
            "SELECT m.id AS message_id, m.session_id AS session_id, \
                    m.content AS content, m.created_at AS created_at \
             FROM messages m \
             JOIN sessions s ON s.id = m.session_id \
             WHERE m.role = 'user' \
               AND m.created_via = 'gui' \
               AND m.visibility = 'visible' \
               AND s.created_via = 'gui' \
               AND s.ga_runtime_kind = 'managed' \
               AND m.created_at >= ? \
             ORDER BY m.created_at, m.session_id, m.turn_index",
        )
        .bind(created_at_floor)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }
}
