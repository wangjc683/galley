//! Goal v2 persistence (.scratch/goal-simplify/PRD.md §3.5): one row per
//! goal, hanging off the session it drives. No proposals, tasks, events
//! or deliverables — the continuation loop in `message_queue` and the
//! model's own `<goal-status>` tag are the whole engine.

use super::*;

const GOAL_SELECT_COLS: &str = "id, session_id, objective, status, budget_seconds, started_at, \
     ended_at, paused_at, latest_summary, result_seen_at, continuation_count, \
     wrap_up_dispatched, created_via, supervisor, origin_note, created_at, updated_at";

impl SqliteGalley {
    pub(super) async fn fetch_goal(&self, id: &str) -> Result<GoalBrief> {
        let sql = format!("SELECT {GOAL_SELECT_COLS} FROM goals WHERE id = ? LIMIT 1");
        let row = sqlx::query_as::<_, GoalRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("goal {id} not found"),
            })?;
        row.into_brief()
    }

    pub(super) async fn create_goal_db(
        &self,
        input: CreateGoalInput,
        origin: Origin,
    ) -> Result<GoalBrief> {
        let objective = input.objective.trim();
        if objective.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "goal.start: objective must not be empty".into(),
            });
        }
        // A ceiling below a minute is a typo, not a plan.
        let budget_seconds = input.budget_seconds.map(|s| s.max(60));

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let session_exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM sessions WHERE id = ? LIMIT 1")
                .bind(input.session_id.as_str())
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_sqlx_err)?;
        if session_exists.is_none() {
            return Err(GalleyError::NotFound {
                message: format!("session {} not found", input.session_id),
            });
        }
        // One open goal per session. The partial unique index
        // goals_one_open_per_session (migration 039) is the race-proof
        // backstop; this check exists for the message a Supervisor / GUI
        // can relay verbatim.
        if let Some((open_id, open_status)) = sqlx::query_as::<_, (String, String)>(
            "SELECT id, status FROM goals \
             WHERE session_id = ? AND status IN ('active','paused','blocked') LIMIT 1",
        )
        .bind(input.session_id.as_str())
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_err)?
        {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "session {} already has an open goal {open_id} ({open_status}). \
                     Stop it before starting another.",
                    input.session_id
                ),
            });
        }

        let id = mint_goal_id("goal");
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO goals (
                id, session_id, objective, status, budget_seconds, started_at,
                ended_at, paused_at, latest_summary, result_seen_at,
                continuation_count, wrap_up_dispatched,
                created_via, supervisor, origin_note, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(input.session_id.as_str())
        .bind(objective)
        .bind(goal_status_sql(GoalStatus::Active))
        .bind(budget_seconds.map(i64::from))
        .bind(&now)
        .bind(origin.via.as_sql())
        .bind(&origin.supervisor)
        .bind(&origin.reason)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err("goal.start", e))?;
        tx.commit().await.map_err(map_sqlx_err)?;

        self.fetch_goal(&id).await
    }

    /// Open goals (active / paused / blocked), oldest first.
    pub(super) async fn list_active_goals_db(&self) -> Result<Vec<GoalBrief>> {
        let sql = format!(
            "SELECT {GOAL_SELECT_COLS} FROM goals \
             WHERE status IN ('active','paused','blocked') \
             ORDER BY started_at ASC"
        );
        let rows = sqlx::query_as::<_, GoalRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalRow::into_brief).collect()
    }

    /// What the live surfaces (top-bar pill, sidebar) show: open goals plus
    /// terminal ones whose result has not been seen yet. Needs-attention
    /// first (blocked, then failed), then running, then finished.
    pub(super) async fn list_visible_goals_db(&self) -> Result<Vec<GoalBrief>> {
        let sql = format!(
            "SELECT {GOAL_SELECT_COLS} FROM goals \
             WHERE status IN ('active','paused','blocked') \
                OR (status IN ('completed','budget_limited','stopped','failed') \
                    AND result_seen_at IS NULL) \
             ORDER BY CASE status \
                    WHEN 'blocked' THEN 0 \
                    WHEN 'failed' THEN 1 \
                    WHEN 'active' THEN 2 \
                    WHEN 'paused' THEN 3 \
                    WHEN 'completed' THEN 4 \
                    WHEN 'budget_limited' THEN 5 \
                    WHEN 'stopped' THEN 6 \
                    ELSE 7 END, \
                started_at ASC, updated_at DESC"
        );
        let rows = sqlx::query_as::<_, GoalRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalRow::into_brief).collect()
    }

    pub(super) async fn list_goals_for_session_db(
        &self,
        session_id: SessionId,
    ) -> Result<Vec<GoalBrief>> {
        let sql = format!(
            "SELECT {GOAL_SELECT_COLS} FROM goals WHERE session_id = ? ORDER BY started_at ASC"
        );
        let rows = sqlx::query_as::<_, GoalRow>(&sql)
            .bind(session_id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalRow::into_brief).collect()
    }

    pub(super) async fn mark_goal_result_seen_db(
        &self,
        id: GoalId,
        _origin: Origin,
    ) -> Result<GoalBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goals SET result_seen_at = COALESCE(result_seen_at, ?), updated_at = ? \
             WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("goal {id} not found"),
            });
        }
        self.fetch_goal(id.as_str()).await
    }

    /// Move a goal to `status`. Terminal statuses stamp `ended_at` (once);
    /// `Paused` / `Blocked` stamp `paused_at`; `Active` clears it. A
    /// `latest_summary` of `None` or blank keeps the stored one.
    pub(super) async fn update_goal_status_db(
        &self,
        id: GoalId,
        status: GoalStatus,
        latest_summary: Option<String>,
    ) -> Result<GoalBrief> {
        let now = chrono_now_iso();
        let ended_at = status.is_terminal().then_some(now.clone());
        let paused_at =
            matches!(status, GoalStatus::Paused | GoalStatus::Blocked).then_some(now.clone());
        let res = sqlx::query(
            "UPDATE goals SET status = ?, \
                latest_summary = COALESCE(?, latest_summary), \
                ended_at = COALESCE(ended_at, ?), \
                paused_at = ?, \
                updated_at = ? \
             WHERE id = ?",
        )
        .bind(goal_status_sql(status))
        .bind(
            latest_summary
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(&ended_at)
        .bind(&paused_at)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.status", e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("goal {id} not found"),
            });
        }
        self.fetch_goal(id.as_str()).await
    }

    /// Record one dispatched continuation; `wrap_up` marks it as the
    /// budget-limit wrap-up so the next idle can land `BudgetLimited`.
    pub(super) async fn bump_goal_continuation_db(
        &self,
        id: GoalId,
        wrap_up: bool,
    ) -> Result<GoalBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goals SET continuation_count = continuation_count + 1, \
                wrap_up_dispatched = CASE WHEN ? THEN 1 ELSE wrap_up_dispatched END, \
                updated_at = ? \
             WHERE id = ?",
        )
        .bind(wrap_up)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("goal {id} not found"),
            });
        }
        self.fetch_goal(id.as_str()).await
    }

    /// Give a goal more time. Allowed on an `active` goal (the ceiling
    /// simply grows) and on a `budget_limited` one, which reopens: back
    /// to `active`, `ended_at` / `result_seen_at` cleared, the wrap-up
    /// flag reset so the next ceiling gets its own wrap-up turn. A goal
    /// with no ceiling has nothing to extend (`invalid_args`), as does one
    /// in any other status. The per-session open-goal index still applies:
    /// reopening next to a newer open goal is refused by the constraint.
    pub(super) async fn extend_goal_budget_db(
        &self,
        id: GoalId,
        extra_seconds: u32,
    ) -> Result<GoalBrief> {
        if extra_seconds == 0 {
            return Err(GalleyError::InvalidArgs {
                message: "goal.extend: extraSeconds must be positive".into(),
            });
        }
        let current = self.fetch_goal(id.as_str()).await?;
        if current.budget_seconds.is_none() {
            return Err(GalleyError::InvalidArgs {
                message: format!("goal {id} has no time ceiling to extend"),
            });
        }
        if !matches!(
            current.status,
            GoalStatus::Active | GoalStatus::BudgetLimited
        ) {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "goal {id} is {}; only active or budget_limited goals can be extended",
                    goal_status_sql(current.status)
                ),
            });
        }
        // Extra time counts from NOW once the old ceiling has passed: a
        // goal that sat budget_limited for an hour and gets "30 more
        // minutes" must not be over its ceiling again on the very next
        // idle. An active goal below its ceiling keeps its base.
        let current_budget = u64::from(current.budget_seconds.unwrap_or(0));
        let new_budget = current_budget.max(current.elapsed_seconds) + u64::from(extra_seconds);
        let new_budget = i64::try_from(new_budget).unwrap_or(i64::MAX);
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goals SET budget_seconds = ?, status = 'active', \
                ended_at = NULL, paused_at = NULL, result_seen_at = NULL, \
                wrap_up_dispatched = 0, updated_at = ? \
             WHERE id = ? AND status IN ('active', 'budget_limited')",
        )
        .bind(new_budget)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.extend", e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("goal {id} not found"),
            });
        }
        self.fetch_goal(id.as_str()).await
    }

    /// Core restart: nothing is running any more, so every `active` goal
    /// becomes `paused` (honest state; no background spend the user did
    /// not just ask for). Returns how many rows moved.
    pub(super) async fn pause_open_goals_db(&self) -> Result<u64> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goals SET status = 'paused', paused_at = ?, updated_at = ? \
             WHERE status = 'active'",
        )
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected())
    }
}
