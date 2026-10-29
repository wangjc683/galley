use super::*;
use crate::api::SUBTASK_REPORT_SUPERVISOR;

/// Title the main chat is created with. Not the GUI's label — the
/// sidebar and the header show their own localized 主聊天 / Main chat —
/// but what the CLI and the database see. Not the `新对话` seed title, so
/// neither the auto-title nor the derived title ever renames it, and the
/// launch sweep of empty `新对话` rows never matches it.
pub const MAIN_CHAT_TITLE: &str = "主聊天";

/// The main chat's first message, said by the AI the moment Core
/// creates it (PRD ruling 47, ticket 04c; ruling 49 kept its first
/// paragraph only): it says who it is and how to use it. Fixed text,
/// chosen by the UI language ([`main_chat_greeting`]); the Chinese is
/// JC's, word for word (2026-10-15, assistant PRD ruling 7: it opens by
/// naming its role, which the sidebar card shows on first launch).
///
/// Shown only. It is an assistant row Core writes itself, marked by its
/// origin ([`is_main_chat_greeting`]): the history replay skips it, so
/// the model never has it in context; and it is not a turn —
/// `turn_count` stays 0 and it sits at [`MAIN_CHAT_GREETING_TURN_INDEX`],
/// before the first one.
pub const MAIN_CHAT_GREETING_ZH: &str =
    "你好，我是你的私人助理。以后有什么事，直接在这里跟我说就行。费时间的活我派出去办，办完回来告诉你。";

/// [`MAIN_CHAT_GREETING_ZH`] for every other UI language.
pub const MAIN_CHAT_GREETING_EN: &str = concat!(
    "Hi, I'm your personal assistant. Whatever comes up, just tell me here. ",
    "Longer jobs I'll hand off, and come back to you when they're done.",
);

/// Origin supervisor label of the greeting row (with `created_via =
/// 'system'`). Assistant rows a runner's turn writes never carry an
/// origin of their own (`persist_assistant_message`), so the pair names
/// the greeting and nothing else.
pub const MAIN_CHAT_GREETING_SUPERVISOR: &str = "galley-greeting";

/// `turn_index` of the greeting: before the first turn, so the first
/// message is turn 0 as in every session — `turn_count`, the next turn
/// index and the first segment's start (turn 0) read exactly as they
/// would without it.
pub const MAIN_CHAT_GREETING_TURN_INDEX: i64 = -1;

/// The greeting for a UI language as the GUI resolves it (`zh-CN`,
/// `en-US`): Chinese for any `zh…`, English for anything else or none.
pub fn main_chat_greeting(language: Option<&str>) -> &'static str {
    match language {
        Some(tag) if tag.trim().to_ascii_lowercase().starts_with("zh") => MAIN_CHAT_GREETING_ZH,
        _ => MAIN_CHAT_GREETING_EN,
    }
}

/// Whether a persisted message is the main chat's greeting — shown to
/// the user, never the model's history.
pub fn is_main_chat_greeting(
    role: &str,
    created_via: Option<&str>,
    supervisor: Option<&str>,
) -> bool {
    role == "assistant"
        && created_via == Some("system")
        && supervisor == Some(MAIN_CHAT_GREETING_SUPERVISOR)
}

/// Whether a persisted message is a main chat reply said in silence
/// (tickets 29, 76): no answer left, and the raw text has the silent
/// reply's tag (`<no-reply/>`, which the turn derivation strips). The
/// desktop search's criterion (`HIDDEN_FROM_GUI_SEARCH` in
/// `db/search.rs`) in Rust, read the way SQLite reads it there: `TRIM`
/// takes spaces only, and `LIKE` ignores ASCII case. A new segment does
/// not carry a wake answered this way
/// (`crate::session_runner::carry`, [`SqliteGalley::main_chat_carry_from`]).
pub fn is_main_chat_silent_reply(role: &str, final_answer: Option<&str>, content: &str) -> bool {
    role == "assistant"
        && final_answer.unwrap_or("").trim_matches(' ').is_empty()
        && content.to_ascii_lowercase().contains("no-reply")
}

/// What Core writes with a new main chat, in the transaction that
/// creates it — so a main chat never exists without it, and a restore
/// from the archive (or a main chat that was simply there) writes none.
#[derive(Debug, Clone, Default)]
pub struct MainChatSeed {
    /// The AI's first message ([`MAIN_CHAT_GREETING_ZH`]).
    pub greeting: Option<String>,
}

/// What [`SqliteGalley::get_or_create_main_chat`] found.
#[derive(Debug, Clone)]
pub enum MainChatEnsured {
    /// It was there.
    Existing(SessionBrief),
    /// It was missing and is now created.
    Created(SessionBrief),
    /// It was archived (the CLI can archive any session) and is now
    /// restored: the main chat is always there.
    Restored(SessionBrief),
}

impl MainChatEnsured {
    pub fn brief(&self) -> &SessionBrief {
        match self {
            Self::Existing(b) | Self::Created(b) | Self::Restored(b) => b,
        }
    }

    pub fn into_brief(self) -> SessionBrief {
        match self {
            Self::Existing(b) | Self::Created(b) | Self::Restored(b) => b,
        }
    }
}

impl SqliteGalley {
    /// The main chat's id, if one exists. At most one row carries the
    /// flag (`sessions_single_main_chat`, migration 044).
    pub async fn main_chat_id(&self) -> Result<Option<SessionId>> {
        let id: Option<String> =
            sqlx::query_scalar("SELECT id FROM sessions WHERE main_chat = 1 LIMIT 1")
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        Ok(id.map(SessionId))
    }

    async fn main_chat_brief(&self) -> Result<Option<SessionBrief>> {
        match self.main_chat_id().await? {
            Some(id) => self.session_brief_db(id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The managed runtime's main chat, created on first ask with
    /// `new_id` (id minting is the caller's concern, as for
    /// `session.new`). Core is the authority here (Rule 5): the desktop
    /// asks for it, it never creates one itself.
    ///
    /// Refused (`invalid_args`) while the active runtime is not the
    /// managed one: an attached external GA has no main chat (PRD ruling
    /// 3), and nothing is written. An archived main chat comes back
    /// restored. Two concurrent asks both see none and both insert; the
    /// unique index refuses the second flag, which then rolls back and
    /// reads the first one's row.
    ///
    /// Only a creation writes `seed` (ticket 04c), in the same
    /// transaction as the row: the greeting.
    pub async fn get_or_create_main_chat(
        &self,
        new_id: &str,
        origin: Origin,
        seed: &MainChatSeed,
    ) -> Result<MainChatEnsured> {
        {
            let mut conn = self.pool.acquire().await.map_err(map_sqlx_err)?;
            if active_runtime_kind_inner(&mut conn).await? != RuntimeKind::Managed {
                return Err(GalleyError::InvalidArgs {
                    message: "the main chat exists only on the managed runtime".into(),
                });
            }
        }
        if let Some(brief) = self.main_chat_brief().await? {
            if brief.status != SessionStatus::Archived {
                return Ok(MainChatEnsured::Existing(brief));
            }
            sqlx::query(
                "UPDATE sessions SET status = 'idle', updated_at = ? \
                 WHERE id = ? AND status = 'archived'",
            )
            .bind(chrono_now_iso())
            .bind(brief.id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
            return Ok(MainChatEnsured::Restored(
                self.session_brief_db(brief.id).await?,
            ));
        }

        let input = CreateSessionInput {
            id: new_id.to_string(),
            title: MAIN_CHAT_TITLE.to_string(),
            project_id: None,
            selected_llm_index: None,
            selected_llm_key: None,
            selected_llm_display_name: None,
            ga_runtime_kind: Some(RuntimeKind::Managed),
            ga_runtime_id: None,
            prompt_profile: None,
        };
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let flagged = match insert_session_row_inner(&mut tx, &input, &origin).await {
            Ok(_) => sqlx::query("UPDATE sessions SET main_chat = 1 WHERE id = ?")
                .bind(new_id)
                .execute(&mut *tx)
                .await
                .map(|_| ())
                .map_err(|e| map_constraint_err("main chat", e)),
            Err(e) => Err(e),
        };
        let flagged = match flagged {
            Ok(()) => write_main_chat_seed(&mut tx, new_id, seed)
                .await
                .map_err(map_sqlx_err),
            Err(e) => Err(e),
        };
        match flagged {
            Ok(()) => {
                tx.commit().await.map_err(map_sqlx_err)?;
                Ok(MainChatEnsured::Created(
                    self.session_brief_db(SessionId(new_id.to_string())).await?,
                ))
            }
            Err(e) => {
                drop(tx);
                match self.main_chat_brief().await? {
                    Some(brief) => Ok(MainChatEnsured::Existing(brief)),
                    None => Err(e),
                }
            }
        }
    }
}

/// What [`SqliteGalley::delete_main_chat_for_reset`] took out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MainChatDeletion {
    /// The main chat.
    pub main_chat: SessionId,
    /// The subtasks it dispatched that the user never wrote in,
    /// whatever their status.
    pub subtasks: Vec<SessionId>,
    /// How many to-dos went with it (every one, ticket 39), their
    /// reminders' tasks with them, and how many items were under them
    /// (ticket 111).
    pub todos: u64,
    pub todo_items: u64,
    /// How many memos went with it (every one, ticket 95), and how many
    /// records of their writes (`memo_events`).
    pub memos: u64,
    pub memo_events: u64,
}

impl MainChatDeletion {
    /// Every deleted session: the subtasks, then the main chat.
    pub fn session_ids(&self) -> impl Iterator<Item = &SessionId> {
        self.subtasks.iter().chain(std::iter::once(&self.main_chat))
    }
}

/// The main chat's subtasks the user never wrote in: the main chat's own
/// records (ticket 06a). A promoted one is an ordinary conversation.
const UNPROMOTED_SUBTASKS_SQL: &str = "SELECT id FROM sessions \
     WHERE parent_session_id = ? AND promoted_at IS NULL ORDER BY created_at, id";

impl SqliteGalley {
    /// The subtasks `parent` dispatched that the user never wrote in
    /// (`promoted_at` unset), archived ones included.
    pub async fn unpromoted_subtask_ids(&self, parent: &SessionId) -> Result<Vec<SessionId>> {
        let ids: Vec<String> = sqlx::query_scalar(UNPROMOTED_SUBTASKS_SQL)
            .bind(parent.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(ids.into_iter().map(SessionId).collect())
    }

    /// The database half of resetting the main chat (ticket 15, PRD
    /// ruling 59): delete the main chat `id` and the subtasks it
    /// dispatched that the user never wrote in, in one transaction.
    /// CASCADE takes their messages, tool events, attachment rows,
    /// segments (`main_chat_segments`, 046) and dispatch records
    /// (`subtask_dispatches`, 048); their search-index rows go alongside
    /// (`messages_fts` is a standalone FTS5 table, no foreign key, no
    /// trigger). A promoted subtask stays, an ordinary conversation whose
    /// `parent_session_id` falls to NULL (SET NULL, 048); so do
    /// `scheduled_tasks.last_run_session_id` and the retired Goal tables'
    /// session references. Every to-do goes too (ticket 39: they are this
    /// conversation's by-products, the notebook Galley kept in it), with
    /// the scheduled tasks that were their reminders — explicitly, as no
    /// foreign key links the two (migration 050) — and the items under
    /// them (ticket 111, migration 054, no foreign key either); so does
    /// every memo, with
    /// every record of its writes (ticket 95, migration 053: what Galley
    /// learned about the user in this conversation). The assistant's own
    /// tasks, linked to no to-do, stay, but not who cancelled the
    /// cancelled ones or why (ticket 61, migration 051): what the user
    /// turned down goes with the conversation it was said in, as the
    /// engine's memory goes back to its seed, so the new main chat's
    /// "In Hand" starts with no follow-ups turned down. Attachment files
    /// live outside the database and are the caller's.
    ///
    /// The subtasks are read inside the transaction, so one dispatched
    /// after the caller last looked is deleted too (and listed). Refused
    /// (`not_found`) when `id` is not the main chat.
    pub async fn delete_main_chat_for_reset(&self, id: &SessionId) -> Result<MainChatDeletion> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let flag: Option<i64> = sqlx::query_scalar("SELECT main_chat FROM sessions WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if flag != Some(1) {
            return Err(GalleyError::NotFound {
                message: format!("session {id} is not the main chat"),
            });
        }
        let subtasks: Vec<String> = sqlx::query_scalar(UNPROMOTED_SUBTASKS_SQL)
            .bind(id.as_str())
            .fetch_all(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        let doomed: Vec<&str> = subtasks
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(id.as_str()))
            .collect();
        let placeholders = vec!["?"; doomed.len()].join(",");
        for sql in [
            format!("DELETE FROM messages_fts WHERE session_id IN ({placeholders})"),
            format!("DELETE FROM sessions WHERE id IN ({placeholders})"),
        ] {
            let mut q = sqlx::query(&sql);
            for doomed_id in &doomed {
                q = q.bind(*doomed_id);
            }
            q.execute(&mut *tx).await.map_err(map_sqlx_err)?;
        }
        sqlx::query("DELETE FROM scheduled_tasks WHERE todo_id IS NOT NULL")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        let todo_items = sqlx::query("DELETE FROM todo_subitems")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?
            .rows_affected();
        let todos = sqlx::query("DELETE FROM todos")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?
            .rows_affected();
        let memo_events = sqlx::query("DELETE FROM memo_events")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?
            .rows_affected();
        let memos = sqlx::query("DELETE FROM memos")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?
            .rows_affected();
        sqlx::query(
            "UPDATE scheduled_tasks SET cancelled_via = NULL, cancelled_by_supervisor = NULL, \
                cancelled_origin_note = NULL \
             WHERE cancelled_via IS NOT NULL",
        )
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(MainChatDeletion {
            main_chat: id.clone(),
            subtasks: subtasks.into_iter().map(SessionId).collect(),
            todos,
            todo_items,
            memos,
            memo_events,
        })
    }

    /// Rewrite the database file after a reset (ticket 15) so the rows it
    /// deleted leave nothing behind: merge the search index (FTS5 keeps
    /// deleted text in its old segments until they merge), `VACUUM`
    /// (freed pages still hold old rows), then checkpoint and truncate
    /// the WAL (it holds the pages the delete replaced). Takes the write
    /// lock for as long as it runs; nothing should be running.
    pub async fn compact(&self) -> Result<()> {
        for sql in [
            "INSERT INTO messages_fts(messages_fts) VALUES('optimize')",
            "VACUUM",
            "PRAGMA wal_checkpoint(TRUNCATE)",
        ] {
            sqlx::query(sql)
                .execute(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        }
        Ok(())
    }
}

/// The creation half of [`MainChatSeed`], inside the creating
/// transaction. The greeting is indexed for search like any reply: the
/// launch backfill counts every visible assistant row with an answer
/// (`backfill_fts_if_empty`), so an unindexed one would rebuild the
/// index on every launch.
async fn write_main_chat_seed(
    conn: &mut SqliteConnection,
    session_id: &str,
    seed: &MainChatSeed,
) -> std::result::Result<(), sqlx::Error> {
    let now = chrono_now_iso();
    if let Some(greeting) = seed.greeting.as_deref() {
        let id = format!("msg_{session_id}_greeting");
        sqlx::query(
            "INSERT INTO messages \
             (id, session_id, turn_index, sequence, role, content, final_answer, created_at, \
              created_via, supervisor, visibility) \
             VALUES (?, ?, ?, 1, 'assistant', ?, ?, ?, 'system', ?, 'visible')",
        )
        .bind(&id)
        .bind(session_id)
        .bind(MAIN_CHAT_GREETING_TURN_INDEX)
        .bind(greeting)
        .bind(greeting)
        .bind(&now)
        .bind(MAIN_CHAT_GREETING_SUPERVISOR)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
             VALUES (?, ?, 'assistant', ?, ?)",
        )
        .bind(&id)
        .bind(session_id)
        .bind(MAIN_CHAT_GREETING_TURN_INDEX)
        .bind(greeting)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// What the main chat's segment rule reads from the database
/// (`crate::session_runner::segment`, ticket 03a). Read in one query so
/// the rule judges one consistent snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MainChatSegmentFacts {
    /// `sessions.last_activity_at`: moved by a turn ending and by a user
    /// or Galley message being written, by nothing else.
    pub last_activity_at: String,
    /// The `turn_index` the next message written to the session gets
    /// (`MAX(turn_index) + 1`, `0` for an empty session, never below
    /// `turn_count`: the rule `insert_message_inner` writes by, ticket 32).
    pub next_turn_index: i64,
    /// Where the current segment starts; `None` while the session is
    /// still in its first segment.
    pub segment_start: Option<i64>,
    /// The latest reply ended on an `ask_user` question — the next
    /// message answers it, whatever Core remembers after a restart.
    pub ends_on_question: bool,
}

/// Where the main chat's current segment starts
/// ([`SqliteGalley::main_chat_current_segment`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MainChatSegmentStart {
    /// `turn_index` of the segment's first message.
    pub start_turn_index: i64,
    /// When the segment began (ISO 8601, as stored): the boundary's
    /// `created_at`, or the session's for the first segment.
    pub started_at: String,
}

impl SqliteGalley {
    /// [`MainChatSegmentFacts`] for `session_id` (migration 046).
    pub async fn main_chat_segment_facts(
        &self,
        session_id: &SessionId,
    ) -> Result<MainChatSegmentFacts> {
        let row: Option<(String, i64, Option<i64>, Option<String>)> = sqlx::query_as(
            "SELECT s.last_activity_at, \
               MAX((SELECT COALESCE(MAX(m.turn_index), -1) + 1 FROM messages m \
                 WHERE m.session_id = s.id), s.turn_count), \
               (SELECT MAX(g.start_turn_index) FROM main_chat_segments g \
                 WHERE g.session_id = s.id), \
               (SELECT r.tool_calls FROM messages r \
                 WHERE r.session_id = s.id AND r.role = 'assistant' \
                 ORDER BY r.turn_index DESC, r.sequence DESC LIMIT 1) \
             FROM sessions s WHERE s.id = ?",
        )
        .bind(session_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let (last_activity_at, next_turn_index, segment_start, reply_tool_calls) =
            row.ok_or_else(|| GalleyError::NotFound {
                message: format!("session '{}' does not exist", session_id.as_str()),
            })?;
        Ok(MainChatSegmentFacts {
            last_activity_at,
            next_turn_index,
            segment_start,
            ends_on_question: reply_tool_calls
                .as_deref()
                .and_then(crate::api::AskUserBrief::from_tool_calls_json)
                .is_some(),
        })
    }

    /// Where `session_id`'s current segment starts (the latest boundary,
    /// migration 046); `None` for a session that has none — every
    /// session but a main chat that has been idle past the threshold.
    pub async fn main_chat_segment_start(&self, session_id: &SessionId) -> Result<Option<i64>> {
        sqlx::query_scalar(
            "SELECT MAX(start_turn_index) FROM main_chat_segments WHERE session_id = ?",
        )
        .bind(session_id.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    /// Where `session_id`'s current segment starts, for the main chat's
    /// state block (ticket 03b): the latest boundary's `turn_index` and
    /// the time Core recorded it, or — still in the first segment — turn
    /// 0 and the session's creation time. Both are fixed once written, so
    /// every runner of one segment is told the same start. `None` when
    /// the session does not exist.
    pub async fn main_chat_current_segment(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<MainChatSegmentStart>> {
        let row: Option<(i64, String)> = sqlx::query_as(
            "SELECT COALESCE(g.start_turn_index, 0), COALESCE(g.created_at, s.created_at) \
             FROM sessions s \
             LEFT JOIN main_chat_segments g ON g.session_id = s.id \
               AND g.start_turn_index = (SELECT MAX(start_turn_index) \
                 FROM main_chat_segments WHERE session_id = s.id) \
             WHERE s.id = ?",
        )
        .bind(session_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(
            row.map(|(start_turn_index, started_at)| MainChatSegmentStart {
                start_turn_index,
                started_at,
            }),
        )
    }

    /// Where reading the turns a segment starting at `before` carries
    /// over begins (tickets 11, 77, 79): the `turn_index` of the oldest
    /// of the last `turns` turns before it that count, whichever segment
    /// they are in. A turn is the carry's own
    /// ([`CarriedWindow::from_rows`](crate::session_runner::carry::CarriedWindow::from_rows),
    /// the module docs of `crate::session_runner::carry`): a visible user
    /// message and every reply up to the next one, complete when a
    /// visible reply that is not the greeting comes before the next user
    /// message and before `before`. It does not count when a wake opens
    /// it (a subtask report or the daily review,
    /// [`Origin::is_stored_subtask_report`]) and its last such reply is
    /// said in silence ([`is_main_chat_silent_reply`]): the user never
    /// saw it, so it takes no place. Its replies may sit on later
    /// `turn_index`es than the user message (a run takes one per step),
    /// so the turn is found by its user message and the read, which runs
    /// on from here, takes every step of it. `None` when there is none.
    /// This only bounds the read; which turns are carried is decided from
    /// the rows themselves.
    pub async fn main_chat_carry_from(
        &self,
        session_id: &SessionId,
        before: i64,
        turns: i64,
    ) -> Result<Option<i64>> {
        // A reply comes before the next user message exactly when the
        // first `user` / `assistant` row after the user message, the
        // greeting aside, is a reply. A wake's turn ends on its last
        // such reply with no user message between: silent, the desktop
        // search's way (`HIDDEN_FROM_GUI_SEARCH`), it is left out.
        sqlx::query_scalar(
            "SELECT MIN(turn_index) FROM ( \
               SELECT u.turn_index FROM messages u \
               WHERE u.session_id = ? AND u.visibility = 'visible' AND u.role = 'user' \
                 AND u.turn_index < ? \
                 AND (SELECT n.role FROM messages n \
                   WHERE n.session_id = u.session_id AND n.visibility = 'visible' \
                     AND (n.role = 'user' OR (n.role = 'assistant' \
                       AND NOT (n.created_via IS 'system' AND n.supervisor IS ?))) \
                     AND (n.turn_index, n.sequence) > (u.turn_index, u.sequence) \
                     AND n.turn_index < ? \
                   ORDER BY n.turn_index ASC, n.sequence ASC LIMIT 1) = 'assistant' \
                 AND NOT (u.created_via IS 'system' AND u.supervisor IS ? \
                   AND COALESCE((SELECT TRIM(COALESCE(a.final_answer, '')) = '' \
                       AND a.content LIKE '%no-reply%' \
                     FROM messages a \
                     WHERE a.session_id = u.session_id AND a.visibility = 'visible' \
                       AND a.role = 'assistant' \
                       AND NOT (a.created_via IS 'system' AND a.supervisor IS ?) \
                       AND (a.turn_index, a.sequence) > (u.turn_index, u.sequence) \
                       AND a.turn_index < ? \
                       AND NOT EXISTS (SELECT 1 FROM messages b \
                         WHERE b.session_id = u.session_id AND b.visibility = 'visible' \
                           AND b.role = 'user' \
                           AND (b.turn_index, b.sequence) > (u.turn_index, u.sequence) \
                           AND (b.turn_index, b.sequence) < (a.turn_index, a.sequence)) \
                     ORDER BY a.turn_index DESC, a.sequence DESC LIMIT 1), 0)) \
               ORDER BY u.turn_index DESC, u.sequence DESC LIMIT ?)",
        )
        .bind(session_id.as_str())
        .bind(before)
        .bind(MAIN_CHAT_GREETING_SUPERVISOR)
        .bind(before)
        .bind(SUBTASK_REPORT_SUPERVISOR)
        .bind(MAIN_CHAT_GREETING_SUPERVISOR)
        .bind(before)
        .bind(turns)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    /// Every boundary of `session_id`, oldest first.
    pub async fn main_chat_segment_starts(&self, session_id: &SessionId) -> Result<Vec<i64>> {
        sqlx::query_scalar(
            "SELECT start_turn_index FROM main_chat_segments \
             WHERE session_id = ? ORDER BY start_turn_index ASC",
        )
        .bind(session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }

    /// Record a boundary: a segment starts at `start_turn_index`.
    /// `false` when that boundary was already there.
    pub async fn record_main_chat_segment(
        &self,
        session_id: &SessionId,
        start_turn_index: i64,
    ) -> Result<bool> {
        let done = sqlx::query(
            "INSERT OR IGNORE INTO main_chat_segments \
             (session_id, start_turn_index, created_at) VALUES (?, ?, ?)",
        )
        .bind(session_id.as_str())
        .bind(start_turn_index)
        .bind(chrono_now_iso())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(done.rows_affected() > 0)
    }

    /// Whether a visible reply was written at or after `from_turn_index`:
    /// without one (and with no turn to carry over,
    /// [`Self::main_chat_carry_from`]), a history replay from there
    /// converts to nothing (`crate::session_runner::rows_to_conversation_messages`
    /// drops a trailing user message).
    pub async fn has_reply_from(
        &self,
        session_id: &SessionId,
        from_turn_index: i64,
    ) -> Result<bool> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM messages \
             WHERE session_id = ? AND role = 'assistant' AND visibility = 'visible' \
               AND turn_index >= ?)",
        )
        .bind(session_id.as_str())
        .bind(from_turn_index)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }
}
