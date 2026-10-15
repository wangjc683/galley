//! Subtask storage (main chat ticket 06a, migration 048): a subtask's
//! session row with its parent, its promotion to an ordinary
//! conversation, and `subtask_dispatches`. What dispatches and when is
//! [`crate::subtask`]'s. Ticket 29 adds what a subtask report reads (the
//! latest run's replies, the send-back count) and the report row itself;
//! when to report is [`crate::subtask_report`]'s.

use super::*;
use crate::api::{SubtaskDispatch, SubtaskFailure, ASSISTANT_SUPERVISOR};
use std::collections::HashMap;

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
            // Counted by the caller ([`SqliteGalley::subtask_send_backs`]).
            send_backs: 0,
        }
    }
}

/// Columns of a [`SubtaskDispatchRow`].
const SUBTASK_DISPATCH_COLS: &str = "parent_session_id, turn_index, ordinal, session_id, title, \
    failure, failure_detail, created_at";

/// One visible assistant row of a subtask's latest run, as its report
/// reads it ([`SqliteGalley::latest_run_replies`]).
#[derive(Debug, Clone, PartialEq, Eq, FromRow)]
pub struct RunReply {
    pub turn_index: i64,
    /// The derived final answer (tags and markers stripped); `None` when
    /// nothing was left.
    pub final_answer: Option<String>,
    /// The text before a tool call, on a step that called one.
    pub preamble: Option<String>,
    /// `tool_calls` as stored (JSON).
    pub tool_calls: Option<String>,
}

/// One row the send-back count reads, in transcript order: an assistant
/// row (with its `tool_calls` only when it may hold `ask_user`) or one of
/// the assistant's user messages.
#[derive(Debug, FromRow)]
struct SendBackRow {
    session_id: String,
    role: String,
    ask_user_tool_calls: Option<String>,
}

/// Rows the send-back count reads, for the sessions `{filter}` selects
/// (a `session_id` condition with one placeholder): the visible assistant
/// rows, and the visible user rows from [`ASSISTANT_SUPERVISOR`] (second
/// placeholder), in transcript order per session.
fn send_back_rows_sql(filter: &str) -> String {
    format!(
        "SELECT session_id, role, \
                CASE WHEN role = 'assistant' AND tool_calls LIKE '%ask_user%' \
                     THEN tool_calls END AS ask_user_tool_calls \
         FROM messages \
         WHERE {filter} AND visibility = 'visible' \
           AND (role = 'assistant' OR (role = 'user' AND supervisor = ?)) \
         ORDER BY session_id, turn_index, sequence"
    )
}

/// Send-backs per session: an assistant user message counts unless the
/// reply before it ended on `ask_user` (then it is the answer).
fn count_send_backs(rows: Vec<SendBackRow>) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut session: Option<String> = None;
    let mut asked = false;
    for row in rows {
        if session.as_deref() != Some(row.session_id.as_str()) {
            session = Some(row.session_id.clone());
            asked = false;
        }
        if row.role == "assistant" {
            asked = row
                .ask_user_tool_calls
                .as_deref()
                .is_some_and(super::session::tool_calls_ask_user);
        } else if !asked {
            *counts.entry(row.session_id).or_default() += 1;
        }
    }
    counts
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

    /// Every dispatch a parent's replies made, in reply order, each with
    /// its subtask's send-back count.
    pub async fn subtask_dispatches(
        &self,
        parent_session_id: &SessionId,
    ) -> Result<Vec<SubtaskDispatch>> {
        let rows = sqlx::query_as::<_, SubtaskDispatchRow>(&format!(
            "SELECT {SUBTASK_DISPATCH_COLS} \
             FROM subtask_dispatches WHERE parent_session_id = ? \
             ORDER BY turn_index, ordinal"
        ))
        .bind(parent_session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let counts = count_send_backs(
            sqlx::query_as::<_, SendBackRow>(&send_back_rows_sql(
                "session_id IN (SELECT session_id FROM subtask_dispatches \
                                WHERE parent_session_id = ? AND session_id IS NOT NULL)",
            ))
            .bind(parent_session_id.as_str())
            .bind(ASSISTANT_SUPERVISOR)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?,
        );
        Ok(rows
            .into_iter()
            .map(|row| {
                let mut dispatch = row.into_dispatch();
                if let Some(id) = &dispatch.session_id {
                    dispatch.send_backs = counts.get(id).copied().unwrap_or(0);
                }
                dispatch
            })
            .collect())
    }

    /// The dispatch record that created `session_id`, with its send-back
    /// count; `None` for a session no reply dispatched.
    pub async fn subtask_dispatch_for_session(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<SubtaskDispatch>> {
        let row = sqlx::query_as::<_, SubtaskDispatchRow>(&format!(
            "SELECT {SUBTASK_DISPATCH_COLS} \
             FROM subtask_dispatches WHERE session_id = ? \
             ORDER BY created_at LIMIT 1"
        ))
        .bind(session_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let mut dispatch = row.into_dispatch();
        dispatch.send_backs = self.subtask_send_backs(session_id).await?;
        Ok(Some(dispatch))
    }

    /// How many times the assistant sent `session_id` back (ticket 29):
    /// its user messages from [`ASSISTANT_SUPERVISOR`] whose previous
    /// reply did not end on `ask_user` — an answer to the subtask's
    /// question is part of its work. From the rows, so the same after a
    /// restart.
    pub async fn subtask_send_backs(&self, session_id: &SessionId) -> Result<u32> {
        let rows = sqlx::query_as::<_, SendBackRow>(&send_back_rows_sql("session_id = ?"))
            .bind(session_id.as_str())
            .bind(ASSISTANT_SUPERVISOR)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(count_send_backs(rows)
            .get(session_id.as_str())
            .copied()
            .unwrap_or(0))
    }

    /// The visible assistant rows of a session's latest run — from its
    /// latest user message on — oldest first.
    pub async fn latest_run_replies(&self, session_id: &SessionId) -> Result<Vec<RunReply>> {
        sqlx::query_as::<_, RunReply>(
            "SELECT turn_index, final_answer, preamble, tool_calls FROM messages \
             WHERE session_id = ? AND role = 'assistant' AND visibility = 'visible' \
               AND turn_index >= COALESCE( \
                 (SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user'), \
                 0) \
             ORDER BY turn_index, sequence",
        )
        .bind(session_id.as_str())
        .bind(session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    /// Write a subtask report into the main chat (ticket 29): a visible
    /// user row with `origin` ([`Origin::subtask_report`]), its text for
    /// the model as `content`, and `replay` — the one line per subtask the
    /// main chat's replayed history shows instead
    /// ([`crate::subtask::mark_rows`]) — as its `summary`, a column user
    /// rows do not otherwise use. One transaction.
    pub async fn persist_subtask_report(
        &self,
        main_chat_id: &SessionId,
        content: String,
        origin: Origin,
        replay: &str,
    ) -> Result<MessageBrief> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let mut message = insert_user_message_inner(
            &mut tx,
            main_chat_id.clone(),
            content,
            origin,
            MessageVisibility::Visible,
        )
        .await?;
        sqlx::query("UPDATE messages SET summary = ? WHERE id = ?")
            .bind(replay)
            .bind(&message.id.0)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        message.summary = Some(replay.to_string());
        Ok(message)
    }
}
