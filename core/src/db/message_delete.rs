//! The database half of deleting one message of the main chat (main chat
//! ticket 32, PRD ruling 83). Which rows a message is, and every refusal,
//! are [`crate::message_delete`]'s; this module reads what it needs and
//! deletes the rows it is handed.

use super::*;

/// A visible row of a session as the deletion reads it: enough to tell
/// a message apart and to group a reply's rows the way the desktop does
/// (`buildRunGroups`, `gui/src/lib/run-groups.ts`).
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct MessageUnitRow {
    pub id: String,
    pub role: String,
    pub turn_index: i64,
    pub tool_calls: Option<String>,
    pub final_answer: Option<String>,
    pub created_via: Option<String>,
    pub supervisor: Option<String>,
}

/// What [`SqliteGalley::delete_main_chat_messages`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagesDeletion {
    /// The rows deleted, as handed in.
    pub ids: Vec<String>,
    /// `sessions.turn_count` after the delete: never lower than before,
    /// and at least one past every turn index the session ever used.
    pub turn_count: i64,
}

impl SqliteGalley {
    /// Whether `id` is the main chat (`sessions.main_chat = 1`).
    pub async fn is_main_chat(&self, id: &SessionId) -> Result<bool> {
        let flag: Option<i64> = sqlx::query_scalar("SELECT main_chat FROM sessions WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(flag == Some(1))
    }

    /// Every visible row of `session_id` in conversation order (the
    /// order the desktop reads them in, `persisted_message_rows`).
    pub async fn message_unit_rows(&self, session_id: &SessionId) -> Result<Vec<MessageUnitRow>> {
        sqlx::query_as::<_, MessageUnitRow>(
            "SELECT id, role, turn_index, tool_calls, final_answer, created_via, supervisor \
             FROM messages \
             WHERE session_id = ? AND visibility = 'visible' \
             ORDER BY turn_index ASC, sequence ASC, id ASC",
        )
        .bind(session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    /// Whether `parent` recorded a subtask dispatch (a card under the
    /// reply, ticket 06a — one that started nothing included) for any
    /// of `turns`.
    pub async fn has_subtask_dispatch_in(&self, parent: &SessionId, turns: &[i64]) -> Result<bool> {
        if turns.is_empty() {
            return Ok(false);
        }
        let placeholders = vec!["?"; turns.len()].join(",");
        let sql = format!(
            "SELECT EXISTS (SELECT 1 FROM subtask_dispatches \
             WHERE parent_session_id = ? AND turn_index IN ({placeholders}))"
        );
        let mut query = sqlx::query_scalar::<_, bool>(&sql).bind(parent.as_str());
        for turn in turns {
            query = query.bind(*turn);
        }
        query.fetch_one(&self.pool).await.map_err(map_sqlx_err)
    }

    /// Delete rows `ids` of the main chat `session_id` in one
    /// transaction, with their attachment rows and search-index rows
    /// (`messages_fts` is a standalone FTS5 table: no foreign key, no
    /// trigger). Attachment files live outside the database and are the
    /// caller's.
    ///
    /// Turn indices are not reused (ticket 32): segments
    /// (`main_chat_segments`), the CLI's `--after-turn` and the replay
    /// all key on them. The next message's index is
    /// `MAX(MAX(turn_index) + 1, turn_count)` (`insert_message_inner`),
    /// so before the rows go `turn_count` is raised to one past the
    /// highest index the session holds — a deletion leaves a hole and
    /// the next message lands after it, at `turn_count`, as the Agent API
    /// documents for `--after-turn`. `turn_count` never goes down.
    ///
    /// When the deleted rows hold the latest reply, the session's
    /// `summary` (the last reply's one-liner, which the phone and the CLI
    /// list) is taken again from the latest reply left that has one, or
    /// cleared: it would otherwise still quote what was deleted.
    ///
    /// Refused (`not_found`) when `session_id` is not the main chat or a
    /// row is not one of its own; then nothing changes.
    pub async fn delete_main_chat_messages(
        &self,
        session_id: &SessionId,
        ids: &[String],
    ) -> Result<MessagesDeletion> {
        let sid = session_id.as_str();
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let flag: Option<i64> = sqlx::query_scalar("SELECT main_chat FROM sessions WHERE id = ?")
            .bind(sid)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if flag != Some(1) {
            return Err(GalleyError::NotFound {
                message: format!("session {sid} is not the main chat"),
            });
        }
        if ids.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "no message to delete".into(),
            });
        }
        let placeholders = vec!["?"; ids.len()].join(",");

        // Every row must be the main chat's.
        let owned: i64 = {
            let sql = format!(
                "SELECT COUNT(*) FROM messages WHERE session_id = ? AND id IN ({placeholders})"
            );
            let mut query = sqlx::query_scalar(&sql).bind(sid);
            for id in ids {
                query = query.bind(id);
            }
            query.fetch_one(&mut *tx).await.map_err(map_sqlx_err)?
        };
        if owned != ids.len() as i64 {
            return Err(GalleyError::NotFound {
                message: format!(
                    "{} of {} messages are not in the main chat {sid}",
                    ids.len() as i64 - owned,
                    ids.len()
                ),
            });
        }

        let latest_reply: Option<String> = sqlx::query_scalar(
            "SELECT id FROM messages \
             WHERE session_id = ? AND role = 'assistant' AND visibility = 'visible' \
             ORDER BY turn_index DESC, sequence DESC LIMIT 1",
        )
        .bind(sid)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;

        // The floor first, while the highest index is still there.
        sqlx::query(
            "UPDATE sessions SET turn_count = MAX(turn_count, \
               (SELECT COALESCE(MAX(turn_index), -1) + 1 FROM messages WHERE session_id = ?)) \
             WHERE id = ?",
        )
        .bind(sid)
        .bind(sid)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;

        for table in ["messages_fts", "message_attachments"] {
            let sql = format!(
                "DELETE FROM {table} WHERE session_id = ? AND message_id IN ({placeholders})"
            );
            let mut query = sqlx::query(&sql).bind(sid);
            for id in ids {
                query = query.bind(id);
            }
            query.execute(&mut *tx).await.map_err(map_sqlx_err)?;
        }
        let deleted = {
            let sql =
                format!("DELETE FROM messages WHERE session_id = ? AND id IN ({placeholders})");
            let mut query = sqlx::query(&sql).bind(sid);
            for id in ids {
                query = query.bind(id);
            }
            query
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_err)?
                .rows_affected()
        };
        if deleted != ids.len() as u64 {
            return Err(GalleyError::Internal {
                message: format!("deleted {deleted} of {} rows; nothing changed", ids.len()),
            });
        }

        if latest_reply.is_some_and(|latest| ids.contains(&latest)) {
            let summary: Option<String> = sqlx::query_scalar(
                "SELECT summary FROM messages \
                 WHERE session_id = ? AND role = 'assistant' AND visibility = 'visible' \
                   AND TRIM(COALESCE(summary, '')) != '' \
                 ORDER BY turn_index DESC, sequence DESC LIMIT 1",
            )
            .bind(sid)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
            sqlx::query("UPDATE sessions SET summary = ? WHERE id = ?")
                .bind(summary.as_deref().map(truncate_summary))
                .bind(sid)
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_err)?;
        }

        let turn_count: i64 = sqlx::query_scalar("SELECT turn_count FROM sessions WHERE id = ?")
            .bind(sid)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(MessagesDeletion {
            ids: ids.to_vec(),
            turn_count,
        })
    }
}
