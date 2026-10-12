//! Affairs-ledger storage (`crate::ledger`): the "not used to
//! understand me" marks of migration 045, and the read of what humans
//! typed into Galley sessions.

use super::*;
use crate::ledger::{LedgerExclusion, LedgerTarget};

/// One user message as `ledger_human_turns` reads it.
#[derive(Debug, Clone, FromRow)]
pub struct LedgerHumanTurnRow {
    pub message_id: String,
    pub session_id: String,
    pub content: String,
    pub created_at: String,
}

impl SqliteGalley {
    /// Mark (`excluded = true`) or unmark one session or one project as
    /// "not used to understand me". Idempotent both ways.
    ///
    /// **Errors**: `not_found` when the session / project does not exist.
    pub async fn set_ledger_excluded(&self, target: &LedgerTarget, excluded: bool) -> Result<()> {
        let (table, column, id) = match target {
            LedgerTarget::Session(id) => ("sessions", "session_id", id.as_str()),
            LedgerTarget::Project(id) => ("projects", "project_id", id.as_str()),
        };
        let exists: Option<i64> =
            sqlx::query_scalar(&format!("SELECT 1 FROM {table} WHERE id = ? LIMIT 1"))
                .bind(id)
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if exists.is_none() {
            let kind = if table == "sessions" {
                "session"
            } else {
                "project"
            };
            return Err(GalleyError::NotFound {
                message: format!("{kind} {id} not found"),
            });
        }
        if excluded {
            sqlx::query(&format!(
                "INSERT OR IGNORE INTO ledger_exclusions ({column}, created_at) VALUES (?, ?)"
            ))
            .bind(id)
            .bind(chrono_now_iso())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        } else {
            sqlx::query(&format!("DELETE FROM ledger_exclusions WHERE {column} = ?"))
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        }
        Ok(())
    }

    /// Every mark, oldest first.
    pub async fn list_ledger_exclusions(&self) -> Result<Vec<LedgerExclusion>> {
        let rows: Vec<(Option<String>, Option<String>, String)> = sqlx::query_as(
            "SELECT session_id, project_id, created_at FROM ledger_exclusions ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(rows
            .into_iter()
            .filter_map(|(session, project, created_at)| {
                let target = match (session, project) {
                    (Some(id), None) => LedgerTarget::Session(id),
                    (None, Some(id)) => LedgerTarget::Project(id),
                    _ => return None, // the CHECK rules this out
                };
                Some(LedgerExclusion { target, created_at })
            })
            .collect())
    }

    /// User messages a human typed into a GUI-created managed session,
    /// visible, created on or after `created_at_floor` (string compare on
    /// the `YYYY-MM-DD` prefix; the caller cuts the exact window), from
    /// sessions and projects not marked "not used to understand me".
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
               AND NOT EXISTS (SELECT 1 FROM ledger_exclusions e WHERE e.session_id = s.id) \
               AND NOT EXISTS (SELECT 1 FROM ledger_exclusions e \
                               WHERE e.project_id IS NOT NULL AND e.project_id = s.project_id) \
             ORDER BY m.created_at, m.session_id, m.turn_index",
        )
        .bind(created_at_floor)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }
}
