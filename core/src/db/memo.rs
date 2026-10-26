//! Memos (main chat ticket 95): the record and every write, shared by the
//! CLI (`galley memo`) and the desktop's delete, with the event each write
//! leaves (`memo_events`, for the cards under the replies), and the reads
//! the panel, the cards, the segment start and the morning review make.

use std::collections::HashMap;

use chrono::{Local, NaiveDate};

use crate::api::memo::{
    checked_memo_text, memo_holds, mint_memo_id, parse_memo_until, CreateMemoInput, MemoAction,
    MemoBrief, MemoEventItem, MemoId, MemoItem, MemoOverLimit, MemoPatch, MemoReviewWindow,
    MemoWrite,
};
use crate::api::schedule::ScheduledTaskCreatedIn;

use super::helpers::origin_from_stored;
use super::*;

#[derive(Debug, FromRow)]
struct MemoRow {
    id: String,
    text: String,
    until_date: Option<String>,
    created_via: String,
    created_by_supervisor: Option<String>,
    created_origin_note: Option<String>,
    created_in_session_id: Option<String>,
    created_in_turn_index: Option<i64>,
    fresh_at: Option<String>,
    created_at: String,
    updated_at: String,
}

const MEMO_COLUMNS: &str = "id, text, until_date, created_via, created_by_supervisor, \
    created_origin_note, created_in_session_id, created_in_turn_index, fresh_at, created_at, \
    updated_at";

impl MemoRow {
    fn holds(&self, today: NaiveDate) -> bool {
        memo_holds(self.until_date.as_deref(), today)
    }

    fn into_brief(self) -> Result<MemoBrief> {
        let origin = origin_from_stored(
            &self.created_via,
            self.created_by_supervisor,
            self.created_origin_note,
        )?;
        let created_in = self
            .created_in_session_id
            .map(|session_id| ScheduledTaskCreatedIn {
                session_id: SessionId(session_id),
                turn_index: self.created_in_turn_index,
            });
        Ok(MemoBrief {
            id: MemoId(self.id),
            text: self.text,
            until: self.until_date,
            origin,
            created_in,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
struct MemoEventRow {
    id: i64,
    memo_id: String,
    action: String,
    text: String,
    until_date: Option<String>,
    session_id: String,
    turn_index: Option<i64>,
    created_at: String,
    memo_exists: bool,
}

/// Today in this machine's zone: the day `until` is read against.
fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// Briefs of `rows`, one unreadable row skipped, not the others (as for
/// to-dos).
fn briefs(rows: impl IntoIterator<Item = MemoRow>) -> Vec<MemoBrief> {
    rows.into_iter()
        .filter_map(|row| {
            let id = row.id.clone();
            row.into_brief()
                .map_err(|e| eprintln!("[db] memo {id} unreadable, skipped: {e:?}"))
                .ok()
        })
        .collect()
}

/// Record one write of a memo, in the write's transaction.
#[allow(clippy::too_many_arguments)]
async fn insert_memo_event(
    conn: &mut SqliteConnection,
    memo_id: &str,
    action: MemoAction,
    text: &str,
    until: Option<&str>,
    origin: &Origin,
    created_in: Option<&(SessionId, i64)>,
    now: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO memo_events (memo_id, action, text, until_date, via, supervisor, \
            origin_note, session_id, run_turn, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(memo_id)
    .bind(action.as_sql())
    .bind(text)
    .bind(until)
    .bind(origin.via.as_sql())
    .bind(origin.stored_supervisor())
    .bind(origin.reason.as_deref())
    .bind(created_in.map(|(session, _)| session.as_str()))
    .bind(created_in.map(|(_, turn)| *turn))
    .bind(now)
    .execute(conn)
    .await
    .map_err(|e| map_constraint_err("memo_events", e))?;
    Ok(())
}

impl SqliteGalley {
    async fn memo_row(&self, id: &str) -> Result<MemoRow> {
        let sql = format!("SELECT {MEMO_COLUMNS} FROM memos WHERE id = ?");
        sqlx::query_as::<_, MemoRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("memo {id} not found"),
            })
    }

    /// Every row, in the order they were noted (the same second: the
    /// order they were written).
    async fn memo_rows(&self) -> Result<Vec<MemoRow>> {
        let sql = format!("SELECT {MEMO_COLUMNS} FROM memos ORDER BY created_at, rowid");
        sqlx::query_as::<_, MemoRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)
    }

    /// One memo, past its day or not.
    ///
    /// **Errors**: `not_found` (none, or deleted).
    pub async fn memo(&self, id: &str) -> Result<MemoBrief> {
        self.memo_row(id).await?.into_brief()
    }

    /// The memos that hold on `today` (none past its last day), in the
    /// order they were noted — `memo list`, and what the segment start
    /// reads.
    pub async fn list_memos(&self, today: NaiveDate) -> Result<Vec<MemoBrief>> {
        let rows = self.memo_rows().await?;
        Ok(briefs(rows.into_iter().filter(|row| row.holds(today))))
    }

    /// [`Self::list_memos`] for today in this machine's zone: what `memo
    /// list` prints, read by the CLI directly and by the socket's
    /// `memo.list` alike.
    pub async fn memos_today(&self) -> Result<Vec<MemoBrief>> {
        self.list_memos(today()).await
    }

    /// [`Self::list_memos`] as the desktop's 「备忘」 page lists them: each
    /// with where in the main chat it was last noted or changed (the last
    /// add or update written in a main chat run).
    pub async fn memo_items(&self, today: NaiveDate) -> Result<Vec<MemoItem>> {
        let memos = self.list_memos(today).await?;
        let places: Vec<(String, String, Option<i64>)> = sqlx::query_as(
            "SELECT memo_id, session_id, turn_index FROM memo_events \
             WHERE session_id IS NOT NULL AND action IN ('add', 'update') ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let mut last: HashMap<String, ScheduledTaskCreatedIn> = HashMap::new();
        for (memo_id, session_id, turn_index) in places {
            last.insert(
                memo_id,
                ScheduledTaskCreatedIn {
                    session_id: SessionId(session_id),
                    turn_index,
                },
            );
        }
        Ok(memos
            .into_iter()
            .map(|memo| {
                let changed_in = last.remove(memo.id.as_str());
                MemoItem { memo, changed_in }
            })
            .collect())
    }

    /// The writes of memos made in `session`'s runs, in the order they
    /// were made, each saying whether its memo is still there — the cards
    /// under the main chat's replies (Tauri `list_memo_events`).
    pub async fn memo_events_in(&self, session: &SessionId) -> Result<Vec<MemoEventItem>> {
        let rows: Vec<MemoEventRow> = sqlx::query_as(
            "SELECT e.id, e.memo_id, e.action, e.text, e.until_date, e.session_id, e.turn_index, \
                e.created_at, (m.id IS NOT NULL) AS memo_exists \
             FROM memo_events e LEFT JOIN memos m ON m.id = e.memo_id \
             WHERE e.session_id = ? ORDER BY e.id",
        )
        .bind(session.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let Some(action) = MemoAction::from_sql(&row.action) else {
                    eprintln!("[db] memo event {} unreadable, skipped", row.id);
                    return None;
                };
                Some(MemoEventItem {
                    id: row.id,
                    memo_id: MemoId(row.memo_id),
                    action,
                    text: row.text,
                    until: row.until_date,
                    session_id: SessionId(row.session_id),
                    turn_index: row.turn_index,
                    memo_exists: row.memo_exists,
                    created_at: row.created_at,
                })
            })
            .collect())
    }

    /// The memos the morning review wakes for in `window` (main chat
    /// ticket 95, PRD ruling 143): noted or changed in a turn the user
    /// started within it, holding on the review's day, still there. In the
    /// order they were noted. None for an empty window.
    pub async fn review_memos(&self, window: &MemoReviewWindow) -> Result<Vec<MemoBrief>> {
        if window.is_empty() {
            return Ok(Vec::new());
        }
        let rows = self.memo_rows().await?;
        Ok(briefs(rows.into_iter().filter(|row| {
            window.takes(row.fresh_at.as_deref(), row.until_date.as_deref())
        })))
    }

    /// The memos that hold on `today`, their text summed in characters —
    /// what [`crate::api::MEMO_TOTAL_MAX_CHARS`] measures.
    pub async fn memo_total_chars(&self, today: NaiveDate) -> Result<usize> {
        Ok(self
            .memo_rows()
            .await?
            .iter()
            .filter(|row| row.holds(today))
            .map(|row| row.text.chars().count())
            .sum())
    }

    /// Whether `created_in` (the main chat and the turn of the user row
    /// that opened the run a CLI write came in: the schedule family's
    /// rule) is a turn the user started (ticket 95, PRD ruling 143 point
    /// 2): its opening user row is not one Galley wrote. Every wake Core
    /// sends the main chat — the morning review, a reminder, a subtask's
    /// report — is a user row with `created_via = 'system'` (supervisor
    /// `galley-report`, `Origin::subtask_report`); a row the user sent
    /// from an app is `gui`, one an agent sent `cli` or `supervisor`. No
    /// turn (outside a main chat run, another agent's write) is not the
    /// user's either.
    async fn turn_the_user_started(&self, created_in: Option<&(SessionId, i64)>) -> Result<bool> {
        let Some((session, turn)) = created_in else {
            return Ok(false);
        };
        let via: Option<String> = sqlx::query_scalar(
            "SELECT created_via FROM messages \
             WHERE session_id = ? AND turn_index = ? AND role = 'user' \
             ORDER BY sequence LIMIT 1",
        )
        .bind(session.as_str())
        .bind(turn)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(via.is_some_and(|via| via != "system"))
    }

    /// What a write returns: the memo as it now stands, and how far past
    /// the total the memos are, when they are.
    async fn memo_write(&self, id: &str, today: NaiveDate) -> Result<MemoWrite> {
        let memo = self.memo(id).await?;
        let over_limit = MemoOverLimit::of(self.memo_total_chars(today).await?);
        Ok(MemoWrite { memo, over_limit })
    }

    /// Note a memo (main chat ticket 95). `created_in` is the main chat
    /// and the turn of the user row that started the run Galley noted it
    /// in ([`Self::settle_memo_created_in`] fills the reply's turn when
    /// that run ends), as for a to-do; when the user started that turn the
    /// memo is fresh for the next morning review ([`MemoReviewWindow`]).
    /// The write is recorded as an `add` event in the same transaction.
    /// Kept past the total, which the result then says
    /// ([`MemoOverLimit`]).
    ///
    /// Memos are the assistant's: refused with
    /// [`crate::api::ASSISTANT_UNAVAILABLE`] unless the managed runtime is
    /// active and has a main chat.
    ///
    /// **Errors**: `invalid_args` (no assistant; the text empty or past
    /// [`crate::api::MEMO_TEXT_MAX_CHARS`]; `until` not a day, or
    /// [`crate::api::TIME_IN_PAST`] for a day before today).
    pub async fn create_memo(
        &self,
        input: CreateMemoInput,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<MemoWrite> {
        const CONTEXT: &str = "create_memo";
        self.ensure_assistant_available(CONTEXT).await?;
        let today = today();
        let text = checked_memo_text(&input.text, CONTEXT)?;
        let until = input
            .until
            .as_deref()
            .map(|raw| parse_memo_until(raw, today, CONTEXT))
            .transpose()?
            .map(|day| day.format("%Y-%m-%d").to_string());
        let now = chrono_now_iso();
        let fresh_at = self
            .turn_the_user_started(created_in.as_ref())
            .await?
            .then(|| now.clone());
        let id = mint_memo_id();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query(
            "INSERT INTO memos (id, text, until_date, created_via, created_by_supervisor, \
                created_origin_note, created_in_session_id, created_in_run_turn, fresh_at, \
                created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&text)
        .bind(&until)
        .bind(origin.via.as_sql())
        .bind(origin.stored_supervisor())
        .bind(origin.reason.as_deref())
        .bind(created_in.as_ref().map(|(session, _)| session.as_str()))
        .bind(created_in.as_ref().map(|(_, turn)| *turn))
        .bind(&fresh_at)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        insert_memo_event(
            &mut tx,
            &id,
            MemoAction::Add,
            &text,
            until.as_deref(),
            &origin,
            created_in.as_ref(),
            &now,
        )
        .await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        self.memo_write(&id, today).await
    }

    /// Change a memo: only what `patch` gives — its text, its last day (or
    /// none). One past its day can be changed too (given a later day, it
    /// holds again). `origin` is not changed: it says who noted it. Fresh
    /// again for the next morning review when the user started the turn,
    /// as when it was noted; an `update` event records it.
    ///
    /// An update that changes nothing (main chat ticket 98) — the same text
    /// once trimmed and the same last day — is not a write: `updated_at`
    /// and `fresh_at` stay as they were, and no event is recorded (its card
    /// would read 「改为」 the words it already had). Otherwise the
    /// assistant writing the same memo again each time the user brings the
    /// thing up would wake the next morning review for it every day (PRD
    /// ruling 143 point 1). It answers as a write does: the memo, and
    /// `overLimit` when the memos are past the total.
    ///
    /// **Errors**: `not_found`, `invalid_args` (as [`Self::create_memo`]).
    pub async fn update_memo(
        &self,
        id: &MemoId,
        patch: MemoPatch,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<MemoWrite> {
        const CONTEXT: &str = "update_memo";
        self.ensure_assistant_available(CONTEXT).await?;
        let today = today();
        let row = self.memo_row(id.as_str()).await?;
        let text = match patch.text.as_deref() {
            Some(raw) => checked_memo_text(raw, CONTEXT)?,
            None => row.text.clone(),
        };
        let until = match &patch.until {
            Some(Some(raw)) => Some(
                parse_memo_until(raw, today, CONTEXT)?
                    .format("%Y-%m-%d")
                    .to_string(),
            ),
            Some(None) => None,
            None => row.until_date.clone(),
        };
        if text == row.text && until == row.until_date {
            return self.memo_write(id.as_str(), today).await;
        }
        let now = chrono_now_iso();
        let fresh_at = if self.turn_the_user_started(created_in.as_ref()).await? {
            Some(now.clone())
        } else {
            row.fresh_at.clone()
        };
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let res = sqlx::query(
            "UPDATE memos SET text = ?, until_date = ?, fresh_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&text)
        .bind(&until)
        .bind(&fresh_at)
        .bind(&now)
        .bind(id.as_str())
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("memo {id} not found"),
            });
        }
        insert_memo_event(
            &mut tx,
            id.as_str(),
            MemoAction::Update,
            &text,
            until.as_deref(),
            &origin,
            created_in.as_ref(),
            &now,
        )
        .await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        self.memo_write(id.as_str(), today).await
    }

    /// Delete a memo: its row goes, a `delete` event with its words as
    /// they were stays (the card says 「不再记 · …」). By Galley through the
    /// CLI, or by the user on the desktop (`origin` `gui`, no turn). Gone
    /// for every read and write: deleting it again is `not_found`. Returns
    /// the memo as it was.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn delete_memo(
        &self,
        id: &MemoId,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<MemoBrief> {
        const CONTEXT: &str = "delete_memo";
        self.ensure_assistant_available(CONTEXT).await?;
        let row = self.memo_row(id.as_str()).await?;
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let res = sqlx::query("DELETE FROM memos WHERE id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("memo {id} not found"),
            });
        }
        insert_memo_event(
            &mut tx,
            id.as_str(),
            MemoAction::Delete,
            &row.text,
            row.until_date.as_deref(),
            &origin,
            created_in.as_ref(),
            &now,
        )
        .await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        row.into_brief()
    }

    /// When a run of `session_id` ends: the memos Galley noted in that run
    /// and every write of one it made there get the run's reply turn, as
    /// [`Self::settle_todo_created_in`] does for to-dos. Unlike a to-do's,
    /// a memo's `updated_at` stays: the day a memo was last noted or
    /// changed is what the segment start and the panel show, and settling
    /// changes neither its text nor its day. Returns how many rows were
    /// settled, memos and events together.
    pub async fn settle_memo_created_in(&self, session_id: &str) -> Result<u64> {
        let memos = sqlx::query(
            "UPDATE memos \
             SET created_in_turn_index = ( \
                   SELECT MAX(m.turn_index) FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= memos.created_in_run_turn) \
             WHERE created_in_session_id = ? AND created_in_turn_index IS NULL \
               AND created_in_run_turn = ( \
                   SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user') \
               AND EXISTS ( \
                   SELECT 1 FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= memos.created_in_run_turn)",
        )
        .bind(session_id)
        .bind(session_id)
        .bind(session_id)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .rows_affected();
        let events = sqlx::query(
            "UPDATE memo_events \
             SET turn_index = ( \
                   SELECT MAX(m.turn_index) FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= memo_events.run_turn) \
             WHERE session_id = ? AND turn_index IS NULL \
               AND run_turn = ( \
                   SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user') \
               AND EXISTS ( \
                   SELECT 1 FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= memo_events.run_turn)",
        )
        .bind(session_id)
        .bind(session_id)
        .bind(session_id)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .rows_affected();
        Ok(memos + events)
    }
}
