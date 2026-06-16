use super::*;

impl SqliteGalley {
    pub async fn persist_tool_event_pending(&self, p: PersistToolEventPending) -> Result<()> {
        let args_json = serde_json::to_string(&p.args).ok();
        sqlx::query(
            "INSERT INTO tool_events ( \
               id, session_id, turn_index, tool_name, status, \
               args_json, args_preview, result_preview, \
               risk_level, approval_id, approval_decision, \
               elapsed_ms, started_at, ended_at \
             ) VALUES ( \
               ?, ?, ?, ?, 'waiting_approval', \
               ?, ?, NULL, \
               ?, ?, NULL, \
               NULL, ?, NULL \
             ) \
             ON CONFLICT(id) DO UPDATE SET \
               session_id   = excluded.session_id, \
               turn_index   = excluded.turn_index, \
               tool_name    = excluded.tool_name, \
               args_json    = excluded.args_json, \
               args_preview = excluded.args_preview, \
               risk_level   = excluded.risk_level, \
               started_at   = excluded.started_at",
        )
        .bind(&p.approval_id)
        .bind(p.session_id.as_str())
        .bind(i64::from(p.turn_index))
        .bind(&p.tool_name)
        .bind(args_json)
        .bind(&p.args_preview)
        .bind(&p.risk_level)
        .bind(&p.approval_id)
        .bind(&p.started_at)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("persist_tool_event_pending", e))?;
        Ok(())
    }

    pub async fn persist_tool_event_approval_decision(
        &self,
        approval_id: &str,
        decision: &str,
        decided_at: &str,
    ) -> Result<()> {
        let denied = decision == "deny";
        sqlx::query(
            "UPDATE tool_events \
               SET status = ?, \
                   approval_decision = ?, \
                   ended_at = ? \
             WHERE id = ?",
        )
        .bind(if denied { "denied" } else { "running" })
        .bind(decision)
        .bind(if denied { Some(decided_at) } else { None })
        .bind(approval_id)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("persist_tool_event_approval_decision", e))?;
        Ok(())
    }

    pub async fn native_tool_event_by_approval_id(
        &self,
        session_id: &SessionId,
        approval_id: &str,
    ) -> Result<ToolEventRow> {
        sqlx::query_as::<_, ToolEventRow>(
            "SELECT id, session_id, turn_index, tool_name, status, \
                    args_json, args_preview, result_preview, risk_level, \
                    approval_id, approval_decision, elapsed_ms, \
                    started_at, ended_at \
             FROM tool_events \
             WHERE session_id = ? AND approval_id = ? \
             LIMIT 1",
        )
        .bind(session_id.as_str())
        .bind(approval_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("approval {approval_id} not found for session {session_id}"),
        })
    }

    pub async fn complete_native_tool_event_approval(
        &self,
        approval_id: &str,
        decision: &str,
        status: &str,
        result_preview: &str,
        decided_at: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE tool_events \
               SET status = ?, \
                   approval_decision = ?, \
                   result_preview = ?, \
                   ended_at = ? \
             WHERE id = ?",
        )
        .bind(status)
        .bind(decision)
        .bind(result_preview)
        .bind(decided_at)
        .bind(approval_id)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("complete_native_tool_event_approval", e))?;
        Ok(())
    }

    pub async fn tool_event_rows_by_session(
        &self,
        session_id: &SessionId,
    ) -> Result<Vec<ToolEventRow>> {
        sqlx::query_as::<_, ToolEventRow>(
            "SELECT id, session_id, turn_index, tool_name, status, \
                    args_json, args_preview, result_preview, risk_level, \
                    approval_id, approval_decision, elapsed_ms, \
                    started_at, ended_at \
             FROM tool_events \
             WHERE session_id = ? \
             ORDER BY started_at ASC",
        )
        .bind(session_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)
    }
}
