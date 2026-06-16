use super::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

impl SqliteGalley {
    pub async fn persisted_message_rows(
        &self,
        session_id: &SessionId,
    ) -> Result<Vec<PersistedMessageRow>> {
        let records: Vec<PersistedMessageRowRecord> =
            sqlx::query_as::<_, PersistedMessageRowRecord>(
                "SELECT id, session_id, turn_index, sequence, role, content, \
                    tool_calls, tool_results, thinking, final_answer, summary, \
                    preamble, created_via, supervisor, origin_note, visibility, created_at \
             FROM messages \
             WHERE session_id = ? AND visibility = 'visible' \
             ORDER BY turn_index ASC, sequence ASC",
            )
            .bind(session_id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        let message_ids: Vec<String> = records.iter().map(|row| row.id.clone()).collect();
        let attachments = self.attachment_map_for_message_ids(&message_ids).await?;
        Ok(records
            .into_iter()
            .map(|row| {
                let mut row = row.into_persisted();
                row.attachments = attachments.get(&row.id).cloned().unwrap_or_default();
                row
            })
            .collect())
    }

    pub async fn session_messages_including_internal(
        &self,
        id: SessionId,
        tail: Option<usize>,
    ) -> Result<Vec<MessageBrief>> {
        self.session_messages_inner(id, tail, true).await
    }

    pub(super) async fn session_messages_inner(
        &self,
        id: SessionId,
        tail: Option<usize>,
        include_internal: bool,
    ) -> Result<Vec<MessageBrief>> {
        let visibility_clause = if include_internal {
            ""
        } else {
            " AND visibility = 'visible'"
        };
        let rows = if let Some(n) = tail {
            let limit = i64::try_from(n).unwrap_or(i64::MAX);
            let sql = format!(
                "SELECT id, session_id, turn_index, role, content, final_answer, summary, \
                        created_via, supervisor, origin_note, visibility, created_at \
                 FROM messages \
                 WHERE session_id = ?{visibility_clause} \
                 ORDER BY turn_index DESC, sequence DESC \
                 LIMIT ?"
            );
            let mut rows: Vec<MessageRow> = sqlx::query_as::<_, MessageRow>(&sql)
                .bind(id.as_str())
                .bind(limit)
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
            rows.reverse();
            rows
        } else {
            let sql = format!(
                "SELECT id, session_id, turn_index, role, content, final_answer, summary, \
                        created_via, supervisor, origin_note, visibility, created_at \
                 FROM messages \
                 WHERE session_id = ?{visibility_clause} \
                 ORDER BY turn_index ASC, sequence ASC"
            );
            sqlx::query_as::<_, MessageRow>(&sql)
                .bind(id.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_err)?
        };
        let mut briefs: Vec<MessageBrief> = rows
            .into_iter()
            .map(MessageRow::into_brief)
            .collect::<Result<Vec<_>>>()?;
        self.attach_message_attachments(&mut briefs).await?;
        Ok(briefs)
    }

    pub async fn persist_gui_user_message(
        &self,
        session_id: SessionId,
        turn_index: u32,
        content: String,
        origin: Origin,
    ) -> Result<()> {
        let id = format!("msg_{}_{}_user", session_id.as_str(), turn_index);
        let created_at = chrono_now_iso();
        sqlx::query(
            "INSERT INTO messages (
               id, session_id, turn_index, sequence, role, content,
               tool_calls, tool_results, thinking, final_answer, created_at,
               created_via, supervisor, origin_note, visibility
             ) VALUES (?, ?, ?, 0, 'user', ?,
                       NULL, NULL, NULL, NULL, ?,
                       ?, ?, ?, 'visible')
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               created_via = excluded.created_via,
               supervisor = excluded.supervisor,
               origin_note = excluded.origin_note",
        )
        .bind(&id)
        .bind(session_id.as_str())
        .bind(i64::from(turn_index))
        .bind(&content)
        .bind(&created_at)
        .bind(origin.via.as_sql())
        .bind(&origin.supervisor)
        .bind(&origin.reason)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        self.index_message_fts(&id, session_id.as_str(), "user", turn_index, &content)
            .await;
        Ok(())
    }

    pub async fn persist_gui_assistant_message(&self, p: PersistAssistantMessage) -> Result<()> {
        let id = format!("msg_{}_{}_assistant", p.session_id.as_str(), p.turn_index);
        let created_at = chrono_now_iso();
        sqlx::query(
            "INSERT INTO messages (
               id, session_id, turn_index, sequence, role, content,
               tool_calls, tool_results, thinking, final_answer, summary,
               preamble, created_at, visibility
             ) VALUES (?, ?, ?, 1, 'assistant', ?,
                       ?, ?, ?, ?, ?,
                       ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               content       = excluded.content,
               tool_calls    = excluded.tool_calls,
               tool_results  = excluded.tool_results,
               thinking      = excluded.thinking,
               final_answer  = excluded.final_answer,
               summary       = excluded.summary,
               preamble      = excluded.preamble,
               visibility    = excluded.visibility",
        )
        .bind(&id)
        .bind(p.session_id.as_str())
        .bind(i64::from(p.turn_index))
        .bind(&p.content)
        .bind(&p.tool_calls)
        .bind(&p.tool_results)
        .bind(&p.thinking)
        .bind(&p.final_answer)
        .bind(&p.summary)
        .bind(&p.preamble)
        .bind(&created_at)
        .bind(message_visibility_sql(p.visibility))
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if p.visibility == MessageVisibility::Visible {
            if let Some(body) = p.final_answer.as_deref().filter(|s| !s.trim().is_empty()) {
                self.index_message_fts(&id, p.session_id.as_str(), "assistant", p.turn_index, body)
                    .await;
            }
        }
        Ok(())
    }
}

impl SqliteGalley {
    pub(super) async fn list_sessions_db(
        &self,
        filter: SessionFilter,
    ) -> Result<Vec<SessionBrief>> {
        if let Some(kind) = filter.runtime_kind {
            crate::runtime::ensure_runtime_filter_available(kind)?;
        }
        // Hand-build WHERE so we can bind only the filters that are
        // set. sqlx doesn't have a fluent builder; query_builder works
        // but verbose for this scale.
        let mut sql = format!("SELECT {SESSIONS_SELECT_COLS} FROM sessions WHERE 1=1");
        if filter.project_id.is_some() {
            sql.push_str(" AND project_id = ?");
        }
        if filter.status.is_some() {
            sql.push_str(" AND status = ?");
        }
        if filter.runtime_kind.is_some() {
            sql.push_str(" AND ga_runtime_kind = ?");
        }
        // Standard Option<bool> filter semantics:
        //   None        → no archived filter (active + archived both returned)
        //   Some(false) → exclude archived
        //   Some(true)  → only archived
        // The CLI's `--all` flag passes None for this; the CLI default
        // and the GUI sidebar pass Some(false). GUI's `loadSessions`
        // historically returned everything (no filter) — matches None.
        match filter.archived {
            Some(false) => sql.push_str(" AND status != 'archived'"),
            Some(true) => sql.push_str(" AND status = 'archived'"),
            None => {}
        }
        sql.push_str(" ORDER BY pinned DESC, last_activity_at DESC");

        let mut q = sqlx::query_as::<_, SessionRow>(&sql);
        if let Some(pid) = filter.project_id.as_deref() {
            q = q.bind(pid);
        }
        if let Some(status) = filter.status {
            q = q.bind(session_status_sql(status));
        }
        if let Some(kind) = filter.runtime_kind {
            q = q.bind(runtime_kind_sql(kind));
        }
        let rows = q.fetch_all(&self.pool).await.map_err(map_sqlx_err)?;
        rows.into_iter().map(SessionRow::into_brief).collect()
    }

    pub(super) async fn session_brief_db(&self, id: SessionId) -> Result<SessionBrief> {
        let row = sqlx::query_as::<_, SessionRow>(&format!(
            "SELECT {SESSIONS_SELECT_COLS} FROM sessions WHERE id = ? LIMIT 1"
        ))
        .bind(id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("session {id} not found"),
        })?;
        row.into_brief()
    }

    pub(super) async fn session_messages_db(
        &self,
        id: SessionId,
        tail: Option<usize>,
    ) -> Result<Vec<MessageBrief>> {
        self.session_messages_inner(id, tail, false).await
    }

    pub(super) async fn status_db(&self) -> Result<StatusSummary> {
        // Persistence reality check: this is a direct SQLite rollup,
        // not a live RunnerManager dashboard. GUI transient statuses
        // are normally mirrored in-memory and persisted as "idle", so
        // running/waiting_input/errored often read as 0 here.
        let counts: StatusCounts = sqlx::query_as(
            "SELECT \
               COUNT(*) AS total, \
               SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running, \
               SUM(CASE WHEN status='waiting_approval' THEN 1 ELSE 0 END) AS waiting_input, \
               SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errored \
             FROM sessions \
             WHERE status != 'archived'",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(StatusSummary {
            total: counts.total.max(0) as u32,
            running: counts.running.max(0) as u32,
            waiting_input: counts.waiting_input.max(0) as u32,
            errored: counts.errored.max(0) as u32,
        })
    }

    pub(super) async fn health_db(&self) -> Result<HealthReport> {
        // B1 partial: filesystem / SQLite-only checks. Python /
        // agentmain / LLM-config probes need to spawn a runner sub-
        // process and are deferred to B4 daemon stage (see playbook G8 +
        // running note for T3.9 decision).
        let mut checks: Vec<HealthCheck> = Vec::new();

        // 1. DB readable — the fact this call ran means the pool
        // opened. Surface it explicitly so absent-DB scenarios still
        // produce a useful report.
        let probe: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0);
        checks.push(HealthCheck {
            id: "db_readable".into(),
            status: if probe == 1 {
                HealthStatus::Ok
            } else {
                HealthStatus::Fail
            },
            detail: db_path().map(|p| p.display().to_string()),
        });

        // 2. GA path (from prefs.ga_config JSON, field `gaPath`).
        // The pref key is snake_case (`ga_config`) but the inner JSON
        // uses camelCase to match the TS gaConfig shape — see
        // gui/src/stores/useAppStore.ts setPref("ga_config", ...).
        let ga_path: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(value, '$.gaPath') FROM prefs WHERE key = 'ga_config' LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .flatten();
        match ga_path.as_deref() {
            Some(p) if std::path::Path::new(p).is_dir() => {
                checks.push(HealthCheck {
                    id: "ga_path".into(),
                    status: HealthStatus::Ok,
                    detail: Some(p.to_string()),
                });
            }
            Some(p) => {
                checks.push(HealthCheck {
                    id: "ga_path".into(),
                    status: HealthStatus::Fail,
                    detail: Some(format!("not a directory: {p}")),
                });
            }
            None => {
                checks.push(HealthCheck {
                    id: "ga_path".into(),
                    status: HealthStatus::Warn,
                    detail: Some("not set — finish Onboarding to attach a GA install".into()),
                });
            }
        }

        // 3. mykey.py — readability gated on ga_path being valid.
        match ga_path.as_deref() {
            Some(p) if std::path::Path::new(p).is_dir() => {
                let mykey = std::path::Path::new(p).join("mykey.py");
                if mykey.is_file() {
                    checks.push(HealthCheck {
                        id: "mykey_py".into(),
                        status: HealthStatus::Ok,
                        detail: Some(mykey.display().to_string()),
                    });
                } else {
                    checks.push(HealthCheck {
                        id: "mykey_py".into(),
                        status: HealthStatus::Fail,
                        detail: Some(format!("missing: {}", mykey.display())),
                    });
                }
            }
            _ => {
                checks.push(HealthCheck {
                    id: "mykey_py".into(),
                    status: HealthStatus::DeferredB4,
                    detail: Some("gated on ga_path".into()),
                });
            }
        }

        // 4. agentmain importable — kept as a stable check id, but
        // this command does not currently spawn Python.
        checks.push(HealthCheck {
            id: "agentmain_import".into(),
            status: HealthStatus::DeferredB4,
            detail: Some("not currently probed by galley health".into()),
        });

        // 5. LLM session init — kept as a stable check id; deeper
        // validation happens through Models setup or live runner start.
        checks.push(HealthCheck {
            id: "llm_session_init".into(),
            status: HealthStatus::DeferredB4,
            detail: Some("not currently probed by galley health".into()),
        });

        Ok(HealthReport { checks })
    }

    pub(super) async fn send_message_db(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
    ) -> Result<MessageBrief> {
        // Thin wrapper: acquire a pool connection and delegate to the
        // shared inner helper. The `_in_tx` sibling reuses the same
        // helper so SQL + validation lives in one place. See
        // [insert_user_message_inner] for the body.
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let msg = insert_user_message_inner(
            &mut tx,
            session_id,
            content,
            origin,
            MessageVisibility::Visible,
        )
        .await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(msg)
    }

    pub(crate) async fn send_message_with_attachments_db(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
        attachments: Vec<MessageAttachmentCreate>,
    ) -> Result<MessageBrief> {
        if attachments.is_empty() {
            return self.send_message_db(session_id, content, origin).await;
        }

        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let mut msg = insert_user_message_inner(
            &mut tx,
            session_id.clone(),
            content,
            origin,
            MessageVisibility::Visible,
        )
        .await?;

        let dir = crate::app_paths::conversation_attachment_dir(session_id.as_str(), &msg.id.0)
            .ok_or_else(|| GalleyError::Internal {
                message: "conversation attachment directory unavailable".into(),
            })?;
        let write_result = self
            .write_message_attachments(&mut tx, &session_id, &msg.id.0, &dir, attachments)
            .await;

        let saved = match write_result {
            Ok(saved) => saved,
            Err(e) => {
                cleanup_attachment_dir(&dir).await;
                return Err(e);
            }
        };

        if let Err(e) = tx.commit().await.map_err(map_sqlx_err) {
            cleanup_attachment_dir(&dir).await;
            return Err(e);
        }
        msg.attachments = saved;
        Ok(msg)
    }

    pub(super) async fn send_message_with_visibility_db(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
        visibility: MessageVisibility,
    ) -> Result<MessageBrief> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let msg =
            insert_user_message_inner(&mut tx, session_id, content, origin, visibility).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(msg)
    }

    pub(super) async fn send_system_message_db(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
    ) -> Result<MessageBrief> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(map_sqlx_err)?;
        let msg = insert_message_inner(
            &mut tx,
            session_id,
            MessageRole::System,
            content,
            origin,
            MessageVisibility::Visible,
        )
        .await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(msg)
    }

    pub(super) async fn create_session_db(
        &self,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief> {
        // Thin wrapper: acquire a pool connection and delegate to the
        // shared inner helper. The `_in_tx` sibling reuses the same
        // helper so SQL + validation lives in one place. See
        // [insert_session_row_inner] for the body.
        let mut conn = self.pool.acquire().await.map_err(map_sqlx_err)?;
        insert_session_row_inner(&mut conn, &input, &origin).await
    }

    pub(super) async fn archive_session_db(
        &self,
        id: SessionId,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let res =
            sqlx::query("UPDATE sessions SET status = 'archived', updated_at = ? WHERE id = ?")
                .bind(&now)
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub(super) async fn unarchive_session_db(
        &self,
        id: SessionId,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        // Only flip rows that are currently archived. A no-op on a
        // non-archived row is still a success (returns the unchanged
        // brief) so the GUI doesn't have to pre-check status.
        let _ = sqlx::query(
            "UPDATE sessions SET status = 'idle', updated_at = ? \
             WHERE id = ? AND status = 'archived'",
        )
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        // Confirm the row exists — UPDATE returns 0 rows_affected for
        // both "row missing" AND "row not archived"; we need a real
        // existence probe to distinguish NotFound from no-op.
        self.session_brief(id).await
    }

    pub(super) async fn rename_session_db(
        &self,
        id: SessionId,
        title: String,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        let trimmed = title.trim();
        let final_title: &str = if trimmed.is_empty() {
            DEFAULT_NEW_SESSION_TITLE
        } else {
            trimmed
        };
        let now = chrono_now_iso();
        let res = sqlx::query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
            .bind(final_title)
            .bind(&now)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub(super) async fn set_session_pinned_db(
        &self,
        id: SessionId,
        pinned: bool,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        // Reject pin on archived rows up-front so the caller gets a
        // distinct error category instead of a silent no-op.
        let current_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM sessions WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        let status = current_status.ok_or_else(|| GalleyError::NotFound {
            message: format!("session {id} not found"),
        })?;
        if status == "archived" {
            return Err(GalleyError::InvalidArgs {
                message: format!("session {id} is archived; cannot change pinned"),
            });
        }
        let now = chrono_now_iso();
        sqlx::query("UPDATE sessions SET pinned = ?, updated_at = ? WHERE id = ?")
            .bind(if pinned { 1_i64 } else { 0_i64 })
            .bind(&now)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        self.session_brief(id).await
    }

    pub(super) async fn delete_session_db(&self, id: SessionId, _origin: Origin) -> Result<()> {
        let attachment_dir = crate::app_paths::conversation_attachment_session_dir(id.as_str());
        let res = sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {id} not found"),
            });
        }
        if let Some(dir) = attachment_dir {
            cleanup_attachment_dir(&dir).await;
        }
        Ok(())
    }

    pub(super) async fn assign_session_to_project_db(
        &self,
        session_id: SessionId,
        project_id: Option<String>,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query("UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?")
            .bind(&project_id)
            .bind(&now)
            .bind(session_id.as_str())
            .execute(&self.pool)
            .await
            .map_err(|e| map_constraint_err("assign_session_to_project", e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {session_id} not found"),
            });
        }
        self.session_brief(session_id).await
    }

    pub(super) async fn set_session_llm_db(
        &self,
        id: SessionId,
        index: Option<u32>,
        key: Option<String>,
        display_name: Option<String>,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let idx: Option<i64> = index.map(|v| v as i64);
        let res = sqlx::query(
            "UPDATE sessions SET llm_index = ?, llm_key = ?, llm_display_name = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(idx)
        .bind(&key)
        .bind(&display_name)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub(super) async fn bump_session_after_turn_db(
        &self,
        id: SessionId,
        summary: Option<String>,
        step_number: Option<u32>,
        mark_unread: bool,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        // Only refresh summary when caller passed a non-empty value.
        // Bridge sometimes emits turn_end with empty summary (no recap
        // generated this round); we keep the previous summary so the
        // sidebar row doesn't blank out mid-conversation.
        let new_summary: Option<String> = summary
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(truncate_summary);
        let step = step_number.map(|n| n as i64);

        // bumpSessionAfterTurn historically didn't touch
        // `last_step_index` if the bridge didn't send `stepNumber`.
        // Sqlite COALESCE keeps the previous value when the bind is NULL.
        if let Some(s) = new_summary {
            let res = sqlx::query(
                "UPDATE sessions SET \
                    turn_count = turn_count + 1, \
                    summary = ?, \
                    last_activity_at = ?, \
                    updated_at = ?, \
                    has_unread = CASE WHEN ? = 1 THEN 1 ELSE has_unread END \
                 WHERE id = ?",
            )
            .bind(&s)
            .bind(&now)
            .bind(&now)
            .bind(if mark_unread { 1_i64 } else { 0_i64 })
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
            if res.rows_affected() == 0 {
                return Err(GalleyError::NotFound {
                    message: format!("session {id} not found"),
                });
            }
        } else {
            let res = sqlx::query(
                "UPDATE sessions SET \
                    turn_count = turn_count + 1, \
                    last_activity_at = ?, \
                    updated_at = ?, \
                    has_unread = CASE WHEN ? = 1 THEN 1 ELSE has_unread END \
                 WHERE id = ?",
            )
            .bind(&now)
            .bind(&now)
            .bind(if mark_unread { 1_i64 } else { 0_i64 })
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
            if res.rows_affected() == 0 {
                return Err(GalleyError::NotFound {
                    message: format!("session {id} not found"),
                });
            }
        }

        // last_step_index isn't a column on the sessions table — it's
        // a transient runtime field the GUI computes from per-turn
        // events. Persisting it here was discussed in the M4 sub-plan
        // but rejected: bumpSessionAfterTurn's GUI counterpart only
        // mirrors it into in-memory state, not SQLite. Suppress the
        // unused param to keep the signature stable for B4+ where a
        // future audit table may pick it up.
        let _ = step;
        self.session_brief(id).await
    }

    pub async fn set_native_session_waiting_for_user(&self, id: SessionId) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE sessions SET \
                status = 'waiting_approval', \
                pending_approval_count = 0, \
                updated_at = ? \
             WHERE id = ? AND ga_runtime_kind = 'galley_native'",
        )
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("native session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub async fn set_native_session_waiting_for_approval(
        &self,
        id: SessionId,
    ) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE sessions SET \
                status = 'waiting_approval', \
                pending_approval_count = 1, \
                updated_at = ? \
             WHERE id = ? AND ga_runtime_kind = 'galley_native'",
        )
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("native session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub async fn set_native_session_idle(&self, id: SessionId) -> Result<SessionBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE sessions SET \
                status = 'idle', \
                pending_approval_count = 0, \
                updated_at = ? \
             WHERE id = ? AND ga_runtime_kind = 'galley_native'",
        )
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("native session {id} not found"),
            });
        }
        self.session_brief(id).await
    }

    pub async fn update_native_assistant_tool_results(
        &self,
        session_id: SessionId,
        turn_index: u32,
        tool_results: Vec<serde_json::Value>,
    ) -> Result<()> {
        let tool_results_json =
            serde_json::to_string(&tool_results).map_err(|err| GalleyError::Internal {
                message: format!("serialize native tool results: {err}"),
            })?;
        let res = sqlx::query(
            "UPDATE messages \
               SET tool_results = ? \
             WHERE session_id = ? AND turn_index = ? AND role = 'assistant'",
        )
        .bind(tool_results_json)
        .bind(session_id.as_str())
        .bind(i64::from(turn_index))
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!(
                    "native assistant message not found for {session_id} turn {turn_index}"
                ),
            });
        }
        Ok(())
    }

    pub(super) async fn clear_session_unread_db(&self, id: SessionId) -> Result<()> {
        let now = chrono_now_iso();
        let res = sqlx::query("UPDATE sessions SET has_unread = 0, updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("session {id} not found"),
            });
        }
        Ok(())
    }

    pub(super) async fn bulk_archive_sessions_db(
        &self,
        ids: Vec<SessionId>,
        _origin: Origin,
    ) -> Result<u32> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let now = chrono_now_iso();
        let sql = format!(
            "UPDATE sessions SET status = 'archived', updated_at = ? \
             WHERE id IN ({placeholders}) AND status != 'archived'",
        );
        let mut q = sqlx::query(&sql).bind(&now);
        for id in &ids {
            q = q.bind(id.as_str());
        }
        let res = q.execute(&mut *tx).await.map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(res.rows_affected() as u32)
    }

    pub(super) async fn bulk_unarchive_sessions_db(
        &self,
        ids: Vec<SessionId>,
        _origin: Origin,
    ) -> Result<u32> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let now = chrono_now_iso();
        let sql = format!(
            "UPDATE sessions SET status = 'idle', updated_at = ? \
             WHERE id IN ({placeholders}) AND status = 'archived'",
        );
        let mut q = sqlx::query(&sql).bind(&now);
        for id in &ids {
            q = q.bind(id.as_str());
        }
        let res = q.execute(&mut *tx).await.map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(res.rows_affected() as u32)
    }

    pub(super) async fn bulk_delete_sessions_db(
        &self,
        ids: Vec<SessionId>,
        _origin: Origin,
    ) -> Result<u32> {
        if ids.is_empty() {
            return Ok(0);
        }
        let attachment_dirs: Vec<PathBuf> = ids
            .iter()
            .filter_map(|id| crate::app_paths::conversation_attachment_session_dir(id.as_str()))
            .collect();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM sessions WHERE id IN ({placeholders})");
        let mut q = sqlx::query(&sql);
        for id in &ids {
            q = q.bind(id.as_str());
        }
        let res = q.execute(&mut *tx).await.map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        for dir in attachment_dirs {
            cleanup_attachment_dir(&dir).await;
        }
        Ok(res.rows_affected() as u32)
    }

    pub(super) async fn create_session_in_tx_db<'c>(
        &self,
        tx: &mut Transaction<'c, Sqlite>,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief> {
        insert_session_row_inner(tx, &input, &origin).await
    }

    pub(super) async fn send_message_in_tx_db<'c>(
        &self,
        tx: &mut Transaction<'c, Sqlite>,
        session_id: SessionId,
        content: String,
        origin: Origin,
    ) -> Result<MessageBrief> {
        insert_user_message_inner(tx, session_id, content, origin, MessageVisibility::Visible).await
    }

    pub(super) async fn begin_tx_db(&self) -> Result<Transaction<'_, Sqlite>> {
        self.pool.begin().await.map_err(map_sqlx_err)
    }

    async fn write_message_attachments<'c>(
        &self,
        tx: &mut Transaction<'c, Sqlite>,
        session_id: &SessionId,
        message_id: &str,
        dir: &Path,
        attachments: Vec<MessageAttachmentCreate>,
    ) -> Result<Vec<MessageAttachmentBrief>> {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| GalleyError::Internal {
                message: format!("create attachment directory: {e}"),
            })?;
        let created_at = chrono_now_iso();
        let mut saved = Vec::with_capacity(attachments.len());
        for (idx, attachment) in attachments.into_iter().enumerate() {
            let ext = image_extension_for_mime(&attachment.mime_type).ok_or_else(|| {
                GalleyError::InvalidArgs {
                    message: format!("unsupported image mime type: {}", attachment.mime_type),
                }
            })?;
            let attachment_id = format!("att_{message_id}_{}", idx + 1);
            let path = dir.join(format!("{attachment_id}.{ext}"));
            tokio::fs::write(&path, &attachment.bytes)
                .await
                .map_err(|e| GalleyError::Internal {
                    message: format!("write attachment image: {e}"),
                })?;
            let path_str = path.to_string_lossy().into_owned();
            sqlx::query(
                "INSERT INTO message_attachments (
                   id, message_id, session_id, kind, file_path, mime_type,
                   byte_size, width, height, created_at
                 ) VALUES (?, ?, ?, 'image', ?, ?, ?, ?, ?, ?)",
            )
            .bind(&attachment_id)
            .bind(message_id)
            .bind(session_id.as_str())
            .bind(&path_str)
            .bind(&attachment.mime_type)
            .bind(i64::try_from(attachment.bytes.len()).unwrap_or(i64::MAX))
            .bind(attachment.width.map(i64::from))
            .bind(attachment.height.map(i64::from))
            .bind(&created_at)
            .execute(&mut **tx)
            .await
            .map_err(map_sqlx_err)?;
            saved.push(MessageAttachmentBrief {
                id: attachment_id,
                message_id: MessageId(message_id.to_string()),
                session_id: session_id.clone(),
                kind: "image".into(),
                path: path_str,
                mime_type: attachment.mime_type,
                byte_size: attachment.bytes.len() as u64,
                width: attachment.width,
                height: attachment.height,
                created_at: created_at.clone(),
            });
        }
        Ok(saved)
    }

    async fn attach_message_attachments(&self, messages: &mut [MessageBrief]) -> Result<()> {
        let ids: Vec<String> = messages
            .iter()
            .map(|message| message.id.0.clone())
            .collect();
        let attachments = self.attachment_map_for_message_ids(&ids).await?;
        for message in messages {
            message.attachments = attachments.get(&message.id.0).cloned().unwrap_or_default();
        }
        Ok(())
    }

    async fn attachment_map_for_message_ids(
        &self,
        message_ids: &[String],
    ) -> Result<HashMap<String, Vec<MessageAttachmentBrief>>> {
        if message_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders = vec!["?"; message_ids.len()].join(",");
        let sql = format!(
            "SELECT id, message_id, session_id, kind, file_path, mime_type, \
                    byte_size, width, height, created_at \
             FROM message_attachments \
             WHERE message_id IN ({placeholders}) \
             ORDER BY message_id ASC, id ASC"
        );
        let mut query = sqlx::query_as::<_, MessageAttachmentRow>(&sql);
        for id in message_ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await.map_err(map_sqlx_err)?;
        let mut grouped: HashMap<String, Vec<MessageAttachmentBrief>> = HashMap::new();
        for row in rows {
            grouped
                .entry(row.message_id.clone())
                .or_default()
                .push(row.into_brief());
        }
        Ok(grouped)
    }
}

fn image_extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

async fn cleanup_attachment_dir(path: &PathBuf) {
    let _ = tokio::fs::remove_dir_all(path).await;
}
