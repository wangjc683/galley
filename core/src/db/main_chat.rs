use super::*;

/// Title the main chat is created with. Not the GUI's label — the
/// sidebar and the header show their own localized 主聊天 / Main chat —
/// but what the CLI and the database see. Not the `新对话` seed title, so
/// neither the auto-title nor the derived title ever renames it, and the
/// launch sweep of empty `新对话` rows never matches it.
pub const MAIN_CHAT_TITLE: &str = "主聊天";

/// The main chat's first message, said by the AI the moment Core
/// creates it (PRD ruling 47, ticket 04c): the main chat is for
/// everything, the affairs ledger is on — reading earlier conversations
/// too — and where to see it or turn it off. Fixed text, chosen by the
/// UI language ([`main_chat_greeting`]); the Chinese is JC's
/// (2026-10-12), word for word.
///
/// Shown only. It is an assistant row Core writes itself, marked by its
/// origin ([`is_main_chat_greeting`]): the history replay skips it, so
/// the model never has it in context (the main chat's state block says
/// the ledger is on instead, `crate::managed_prompt`); the ledger reads
/// user messages only; and it is not a turn — `turn_count` stays 0 and
/// it sits at [`MAIN_CHAT_GREETING_TURN_INDEX`], before the first one.
///
/// Paragraph breaks are spelled `\n\n`, not line breaks in the source,
/// so a Windows (CRLF) checkout stores the same text.
pub const MAIN_CHAT_GREETING_ZH: &str = concat!(
    "你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。",
    "\n\n",
    "为了接得上你在忙的事，我会整理你在 Galley 和聊天软件私聊里说过的话（包括以前的对话，",
    "不含我的回复），记下你在忙什么、到了哪一步，也会记下让你着急或开心的时刻，只用来把事办好。",
    "第一次整理在今晚，之后每天一次，只看新说的；整理要多调用模型，记下的内容只存在这台电脑上。",
    "\n\n",
    "建议保持开启。想看我记了什么、删掉某一条或者关掉，点上面的「主对话」→「它记得我什么」。",
);

/// [`MAIN_CHAT_GREETING_ZH`] for every other UI language. The menu path
/// names the English UI's labels (`sidebar.mainChat`,
/// `memory.whatItRemembers` in `gui/src/i18n/locales/en.ts`).
pub const MAIN_CHAT_GREETING_EN: &str = concat!(
    "Hi. From now on, whatever comes up, just tell me here. No need to decide ",
    "whether to start a new conversation or pick up an old one.",
    "\n\n",
    "To keep up with what you're working on, I'll go through what you've said in ",
    "Galley and in private chats on your chat apps (earlier conversations included, ",
    "my replies left out) and note what you're busy with and how far along it is. ",
    "I'll also note the moments that made you anxious or happy, only to help get ",
    "things done. The first pass is tonight, then once a day, only over what's new; ",
    "each pass takes extra model calls, and what I note stays only on this computer.",
    "\n\n",
    "I suggest keeping it on. To see what I've noted, delete an entry, or turn it ",
    "off, click “Main chat” → “What it remembers about me” at the top.",
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

/// What Core writes with a new main chat, in the transaction that
/// creates it — so a main chat never exists without them, and a restore
/// from the archive (or a main chat that was simply there) writes none.
#[derive(Debug, Clone, Default)]
pub struct MainChatSeed {
    /// The AI's first message ([`MAIN_CHAT_GREETING_ZH`]).
    pub greeting: Option<String>,
    /// Core prefs set only where the key is missing (or JSON `null`):
    /// the affairs ledger's switch, on by default.
    pub prefs_if_absent: Vec<(String, serde_json::Value)>,
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
    /// transaction as the row: the greeting, and the prefs it names where
    /// they are not set yet.
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
    for (key, value) in &seed.prefs_if_absent {
        sqlx::query(
            "INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, \
               updated_at = excluded.updated_at \
             WHERE prefs.value = 'null'",
        )
        .bind(key)
        .bind(value.to_string())
        .bind(&now)
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
    /// (`MAX(turn_index) + 1`, `0` for an empty session).
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
               (SELECT COALESCE(MAX(m.turn_index), -1) + 1 FROM messages m \
                 WHERE m.session_id = s.id), \
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
    /// without one, a history replay from there converts to nothing
    /// (`crate::session_runner::rows_to_conversation_messages` drops a
    /// trailing user message).
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
