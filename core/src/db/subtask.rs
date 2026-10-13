//! Subtask storage (main chat ticket 06a, migration 048): a subtask's
//! session row with its parent, its promotion to an ordinary
//! conversation, and `subtask_dispatches`. What dispatches and when is
//! [`crate::subtask`]'s.

use super::*;
use crate::api::{SubtaskDispatch, SubtaskFailure};

/// A main chat reply as the dispatch reads it: the latest visible
/// assistant row of a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LatestReply {
    pub turn_index: i64,
    /// GA's raw response, tags and all.
    pub content: String,
    /// `tool_calls` as stored (JSON), `None` for rows without.
    pub tool_calls: Option<String>,
}

#[derive(Debug, FromRow)]
struct SubtaskDispatchRow {
    parent_session_id: String,
    turn_index: i64,
    ordinal: i64,
    session_id: Option<String>,
    title: String,
    failure: Option<String>,
    failure_detail: Option<String>,
    created_at: String,
}

impl SubtaskDispatchRow {
    fn into_dispatch(self) -> SubtaskDispatch {
        SubtaskDispatch {
            message_id: SubtaskDispatch::reply_message_id(&self.parent_session_id, self.turn_index),
            parent_session_id: self.parent_session_id,
            turn_index: self.turn_index,
            ordinal: self.ordinal,
            session_id: self.session_id,
            title: self.title,
            // The CHECK keeps the column to the three known values.
            failure: self.failure.as_deref().and_then(SubtaskFailure::from_sql),
            failure_detail: self.failure_detail,
            created_at: self.created_at,
        }
    }
}

impl SqliteGalley {
    /// Create a subtask: its session row (with `origin`, the subtask
    /// origin, and `parent_session_id`) and, when given, its first user
    /// message, in one transaction, as `session.new` writes a session and
    /// its task. Nothing is announced here (the caller does,
    /// [`crate::session_writes::announce_session`]).
    pub async fn create_subtask_session(
        &self,
        input: CreateSessionInput,
        origin: Origin,
        parent_session_id: &SessionId,
        first_message: Option<String>,
    ) -> Result<(SessionBrief, Option<MessageBrief>)> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let brief = insert_session_row_inner(&mut tx, &input, &origin).await?;
        sqlx::query("UPDATE sessions SET parent_session_id = ? WHERE id = ?")
            .bind(parent_session_id.as_str())
            .bind(brief.id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| map_constraint_err("create_subtask_session", e))?;
        let message = match first_message {
            Some(content) => Some(
                insert_user_message_inner(
                    &mut tx,
                    brief.id.clone(),
                    content,
                    origin,
                    MessageVisibility::Visible,
                )
                .await?,
            ),
            None => None,
        };
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok((self.session_brief_db(brief.id).await?, message))
    }

    /// Promote a subtask to an ordinary conversation: the user wrote in
    /// it. Returns the row when this call promoted it; `None` for a
    /// session that is no subtask or was promoted before.
    pub async fn promote_subtask(&self, session_id: &SessionId) -> Result<Option<SessionBrief>> {
        let changed = sqlx::query(
            "UPDATE sessions SET promoted_at = ?, updated_at = ? \
             WHERE id = ? AND parent_session_id IS NOT NULL AND promoted_at IS NULL",
        )
        .bind(chrono_now_iso())
        .bind(chrono_now_iso())
        .bind(session_id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        self.session_brief_db(session_id.clone()).await.map(Some)
    }

    /// The latest visible assistant row of a session, if any.
    pub async fn latest_reply(&self, session_id: &SessionId) -> Result<Option<LatestReply>> {
        let row: Option<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT turn_index, content, tool_calls FROM messages \
             WHERE session_id = ? AND role = 'assistant' AND visibility = 'visible' \
             ORDER BY turn_index DESC, sequence DESC LIMIT 1",
        )
        .bind(session_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(row.map(|(turn_index, content, tool_calls)| LatestReply {
            turn_index,
            content,
            tool_calls,
        }))
    }

    /// Whether anything is recorded for this reply already.
    pub async fn has_subtask_dispatches(
        &self,
        parent_session_id: &SessionId,
        turn_index: i64,
    ) -> Result<bool> {
        let found: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM subtask_dispatches \
             WHERE parent_session_id = ? AND turn_index = ? LIMIT 1",
        )
        .bind(parent_session_id.as_str())
        .bind(turn_index)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(found.is_some())
    }

    /// Record one tag's dispatch. A record already there for the same
    /// tag stays as it is (a reply is dispatched once).
    pub async fn record_subtask_dispatch(&self, dispatch: &SubtaskDispatch) -> Result<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO subtask_dispatches \
             (parent_session_id, turn_index, ordinal, session_id, title, failure, \
              failure_detail, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&dispatch.parent_session_id)
        .bind(dispatch.turn_index)
        .bind(dispatch.ordinal)
        .bind(&dispatch.session_id)
        .bind(&dispatch.title)
        .bind(dispatch.failure.map(SubtaskFailure::as_sql))
        .bind(&dispatch.failure_detail)
        .bind(&dispatch.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("record_subtask_dispatch", e))?;
        Ok(())
    }

    /// A recorded subtask whose runner then did not start:
    /// [`SubtaskFailure::StartFailed`] with why.
    pub async fn mark_subtask_dispatch_failed(
        &self,
        dispatch: &SubtaskDispatch,
        detail: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE subtask_dispatches SET failure = ?, failure_detail = ? \
             WHERE parent_session_id = ? AND turn_index = ? AND ordinal = ?",
        )
        .bind(SubtaskFailure::StartFailed.as_sql())
        .bind(detail)
        .bind(&dispatch.parent_session_id)
        .bind(dispatch.turn_index)
        .bind(dispatch.ordinal)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(())
    }

    /// Every dispatch a parent's replies made, in reply order.
    pub async fn subtask_dispatches(
        &self,
        parent_session_id: &SessionId,
    ) -> Result<Vec<SubtaskDispatch>> {
        let rows = sqlx::query_as::<_, SubtaskDispatchRow>(
            "SELECT parent_session_id, turn_index, ordinal, session_id, title, failure, \
                    failure_detail, created_at \
             FROM subtask_dispatches WHERE parent_session_id = ? \
             ORDER BY turn_index, ordinal",
        )
        .bind(parent_session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(rows
            .into_iter()
            .map(SubtaskDispatchRow::into_dispatch)
            .collect())
    }
}
