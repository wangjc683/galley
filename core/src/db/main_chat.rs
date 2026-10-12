use super::*;

/// Title the main chat is created with. Not the GUI's label — the
/// sidebar and the header show their own localized 主聊天 / Main chat —
/// but what the CLI and the database see. Not the `新对话` seed title, so
/// neither the auto-title nor the derived title ever renames it, and the
/// launch sweep of empty `新对话` rows never matches it.
pub const MAIN_CHAT_TITLE: &str = "主聊天";

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
    /// 3). An archived main chat comes back restored. Two concurrent
    /// asks both see none and both insert; the unique index refuses the
    /// second flag, which then rolls back and reads the first one's row.
    pub async fn get_or_create_main_chat(
        &self,
        new_id: &str,
        origin: Origin,
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
