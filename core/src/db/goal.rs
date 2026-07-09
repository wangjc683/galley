use super::*;

impl SqliteGalley {
    pub(super) async fn fetch_goal_proposal(&self, id: &str) -> Result<GoalProposalBrief> {
        let row = sqlx::query_as::<_, GoalProposalRow>(
            "SELECT id, objective, project_id, master_session_id, budget_seconds, worker_limit, \
                    runtime_kind, write_mode, mode, status, internal_confirm_token, \
                    expires_at, created_at, updated_at \
             FROM goal_proposals WHERE id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("goal proposal {id} not found"),
        })?;
        row.into_brief()
    }

    pub(super) async fn fetch_goal(&self, id: &str) -> Result<GoalBrief> {
        let row = sqlx::query_as::<_, GoalRow>(
            "SELECT id, proposal_id, project_id, master_session_id, objective, status, budget_seconds, \
                    worker_limit, runtime_kind, write_mode, mode, started_at, deadline_at, \
                    ended_at, latest_summary, result_seen_at, stop_requested, workspace_path, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id) AS task_count, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id \
                        AND t.status = 'completed') AS completed_task_count, \
                    (SELECT MAX(version) FROM goal_deliverables d WHERE d.goal_id = goals.id) \
                        AS deliverable_version, \
                    created_at, updated_at \
             FROM goals WHERE id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("goal {id} not found"),
        })?;
        row.into_brief()
    }

    pub(super) async fn fetch_goal_task(&self, id: &str) -> Result<GoalTaskBrief> {
        let row = sqlx::query_as::<_, GoalTaskRow>(
            "SELECT id, goal_id, title, description, status, owner_session_id, \
                    scope, result_summary, created_at, updated_at \
             FROM goal_tasks WHERE id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("goal task {id} not found"),
        })?;
        row.into_brief()
    }

    pub(super) async fn goal_tasks_for(&self, goal_id: &str) -> Result<Vec<GoalTaskBrief>> {
        let rows = sqlx::query_as::<_, GoalTaskRow>(
            "SELECT id, goal_id, title, description, status, owner_session_id, \
                    scope, result_summary, created_at, updated_at \
             FROM goal_tasks WHERE goal_id = ? \
             ORDER BY updated_at DESC, created_at DESC",
        )
        .bind(goal_id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalTaskRow::into_brief).collect()
    }

    /// Events for a goal in ascending id order. `limit` keeps the most
    /// recent N (display views); `None` returns the complete history —
    /// signal logic (counts, marker existence, dedup) must see all
    /// events, or eviction silently flips its answers.
    pub(super) async fn goal_events_for(
        &self,
        goal_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<GoalEventBrief>> {
        let rows = match limit {
            Some(limit) => {
                let mut rows = sqlx::query_as::<_, GoalEventRow>(
                    "SELECT id, goal_id, task_id, author_session_id, event_type, body, created_at \
                     FROM goal_events WHERE goal_id = ? \
                     ORDER BY id DESC LIMIT ?",
                )
                .bind(goal_id)
                .bind(limit)
                .fetch_all(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
                rows.reverse();
                rows
            }
            None => sqlx::query_as::<_, GoalEventRow>(
                "SELECT id, goal_id, task_id, author_session_id, event_type, body, created_at \
                 FROM goal_events WHERE goal_id = ? \
                 ORDER BY id ASC",
            )
            .bind(goal_id)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?,
        };
        rows.into_iter().map(GoalEventRow::into_brief).collect()
    }
}

impl SqliteGalley {
    pub(super) async fn create_goal_proposal_db(
        &self,
        input: CreateGoalProposalInput,
        _origin: Origin,
    ) -> Result<GoalProposalBrief> {
        let objective = input.objective.trim();
        if objective.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "goal.propose: objective must not be empty".into(),
            });
        }
        let budget_seconds = input
            .budget_seconds
            .unwrap_or(DEFAULT_GOAL_BUDGET_SECONDS)
            .max(60);
        let worker_limit = input
            .worker_limit
            .unwrap_or(DEFAULT_GOAL_WORKER_LIMIT)
            .clamp(MIN_GOAL_WORKER_LIMIT, MAX_GOAL_WORKER_LIMIT);
        let runtime_kind = input.runtime_kind.unwrap_or(RuntimeKind::Managed);
        let write_mode = input.write_mode.unwrap_or(GoalWriteMode::Autonomous);
        // API/CLI default is Hive for backward compat; the GUI sends Solo
        // explicitly as the product default (see issue 02 assumption A).
        let mode = input.mode.unwrap_or(GoalMode::Hive);
        // Solo is a single agent — `worker_limit` is a hive concept and any
        // requested value would misrender as "N agents". Pin it to 1.
        let worker_limit = if mode == GoalMode::Solo {
            1
        } else {
            worker_limit
        };
        let expires_in_seconds = input.expires_in_seconds.unwrap_or(10 * 60).max(60);
        let id = mint_goal_id("gprop");
        let token = mint_goal_id("gtok");
        let now = chrono_now_iso();
        let expires_at = chrono_after_seconds_iso(expires_in_seconds);

        sqlx::query(
            "INSERT INTO goal_proposals (
                id, objective, project_id, master_session_id, budget_seconds, worker_limit,
                runtime_kind, write_mode, mode, status, internal_confirm_token,
                expires_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(objective)
        .bind(input.project_id.as_ref().map(ProjectId::as_str))
        .bind(input.master_session_id.as_ref().map(SessionId::as_str))
        .bind(i64::from(budget_seconds))
        .bind(i64::from(worker_limit))
        .bind(runtime_kind_sql(runtime_kind))
        .bind(goal_write_mode_sql(write_mode))
        .bind(goal_mode_sql(mode))
        .bind(goal_proposal_status_sql(
            GoalProposalStatus::AwaitingConfirmation,
        ))
        .bind(&token)
        .bind(&expires_at)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.propose", e))?;

        self.fetch_goal_proposal(&id).await
    }

    pub(super) async fn start_goal_from_proposal_db(
        &self,
        proposal_id: GoalProposalId,
        internal_confirm_token: String,
        _origin: Origin,
    ) -> Result<GoalBrief> {
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let proposal_row = sqlx::query_as::<_, GoalProposalRow>(
            "SELECT id, objective, project_id, master_session_id, budget_seconds, worker_limit, \
                    runtime_kind, write_mode, mode, status, internal_confirm_token, \
                    expires_at, created_at, updated_at \
             FROM goal_proposals WHERE id = ? LIMIT 1",
        )
        .bind(proposal_id.as_str())
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("goal proposal {proposal_id} not found"),
        })?;
        let proposal = proposal_row.into_brief()?;
        if proposal.status != GoalProposalStatus::AwaitingConfirmation {
            return Err(GalleyError::InvalidArgs {
                message: format!("goal proposal {proposal_id} is not awaiting confirmation"),
            });
        }
        if proposal.internal_confirm_token != internal_confirm_token {
            return Err(GalleyError::InvalidArgs {
                message: "goal.run: confirm token mismatch".into(),
            });
        }
        let now = chrono_now_iso();
        if proposal.expires_at <= now {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "goal proposal {proposal_id} expired at {}",
                    proposal.expires_at
                ),
            });
        }

        // Single active Goal: Galley runs at most one Goal at a time. Reject a
        // second start with a message the Supervisor / GUI can relay verbatim.
        // The partial unique index goals_single_active (migration 030) is the
        // race-proof backstop; this check exists for the friendly message.
        if let Some((active_id, active_objective)) = sqlx::query_as::<_, (String, String)>(
            "SELECT id, objective FROM goals \
                 WHERE status IN ('running','wrapping') LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sqlx_err)?
        {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "A Goal is already running: \"{active_objective}\" ({active_id}). \
                     Stop it or wait for it to finish before starting another."
                ),
            });
        }

        let project_id = match proposal.project_id.as_ref() {
            Some(id) => Some(id.0.clone()),
            // A solo Goal launched outside a project stays project-less,
            // like a plain session. Only hive mints a project: it needs one
            // to hold the master + worker session fleet.
            None if proposal.mode == GoalMode::Solo => None,
            None => {
                let project_id = mint_goal_id("proj");
                let project_name = goal_project_name(&proposal.objective);
                sqlx::query(
                    "INSERT INTO projects (id, name, root_path, icon, color, pinned, \
                        last_activity_at, created_at, updated_at) \
                     VALUES (?, ?, NULL, NULL, NULL, 0, ?, ?, ?)",
                )
                .bind(&project_id)
                .bind(&project_name)
                .bind(&now)
                .bind(&now)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .map_err(|e| map_constraint_err("goal.run create project", e))?;
                Some(project_id)
            }
        };
        if let (Some(master_session_id), Some(project_id)) =
            (proposal.master_session_id.as_ref(), project_id.as_ref())
        {
            let master_project_id: Option<String> =
                sqlx::query_scalar("SELECT project_id FROM sessions WHERE id = ? LIMIT 1")
                    .bind(master_session_id.as_str())
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(map_sqlx_err)?
                    .ok_or_else(|| GalleyError::NotFound {
                        message: format!("master session {master_session_id} not found"),
                    })?;
            if master_project_id.is_none() {
                sqlx::query("UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?")
                    .bind(project_id)
                    .bind(&now)
                    .bind(master_session_id.as_str())
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| map_constraint_err("goal.run assign master session", e))?;
            }
        }

        let goal_id = mint_goal_id("goal");
        let deadline_at = chrono_after_seconds_iso(proposal.budget_seconds);
        let workspace_path = crate::app_paths::goal_workspace_dir(&goal_id)
            .map(|p| p.to_string_lossy().into_owned());
        sqlx::query(
            "INSERT INTO goals (
                id, proposal_id, project_id, master_session_id, objective, status, budget_seconds,
                worker_limit, runtime_kind, write_mode, mode, started_at, deadline_at,
                ended_at, latest_summary, result_seen_at, stop_requested, workspace_path,
                created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?)",
        )
        .bind(&goal_id)
        .bind(proposal.id.as_str())
        .bind(&project_id)
        .bind(proposal.master_session_id.as_ref().map(SessionId::as_str))
        .bind(&proposal.objective)
        .bind(goal_status_sql(GoalStatus::Running))
        .bind(i64::from(proposal.budget_seconds))
        .bind(i64::from(proposal.worker_limit))
        .bind(runtime_kind_sql(proposal.runtime_kind))
        .bind(goal_write_mode_sql(proposal.write_mode))
        .bind(goal_mode_sql(proposal.mode))
        .bind(&now)
        .bind(&deadline_at)
        .bind(&workspace_path)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err("goal.run create goal", e))?;

        sqlx::query("UPDATE goal_proposals SET status = 'started', updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(proposal.id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;

        sqlx::query(
            "INSERT INTO goal_events (goal_id, task_id, author_session_id, event_type, body, created_at) \
             VALUES (?, NULL, NULL, 'system', ?, ?)",
        )
        .bind(&goal_id)
        .bind(format!(
            "Goal started. Confirmation phrase: {GOAL_CONFIRMATION_PHRASE}. Workers: {}. Budget: {}m. Write mode: {:?}.",
            proposal.worker_limit,
            proposal.budget_seconds / 60,
            proposal.write_mode
        ))
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;

        tx.commit().await.map_err(map_sqlx_err)?;
        self.fetch_goal(&goal_id).await
    }

    pub(super) async fn goal_status_db(
        &self,
        id: GoalId,
        event_limit: Option<i64>,
    ) -> Result<GoalStatusSnapshot> {
        let goal = self.fetch_goal(id.as_str()).await?;
        let project = match goal.project_id.as_ref() {
            Some(project_id) => self.fetch_project(project_id.as_str()).await.ok(),
            None => None,
        };
        let tasks = self.goal_tasks_for(id.as_str()).await?;
        let events = self.goal_events_for(id.as_str(), event_limit).await?;
        let deliverable = self.latest_goal_deliverable(id.clone()).await?;
        let sessions = match goal.project_id.as_ref() {
            Some(project_id) => {
                self.list_sessions(SessionFilter {
                    project_id: Some(project_id.0.clone()),
                    status: None,
                    archived: Some(false),
                    runtime_kind: None,
                })
                .await?
            }
            // Project-less solo: the master session is the whole fleet.
            None => match goal.master_session_id.clone() {
                Some(session_id) => self
                    .session_brief(session_id)
                    .await
                    .map(|brief| vec![brief])
                    .unwrap_or_default(),
                None => Vec::new(),
            },
        };
        Ok(GoalStatusSnapshot {
            goal,
            project,
            tasks,
            events,
            sessions,
            deliverable,
        })
    }

    pub(super) async fn set_goal_deliverable_db(
        &self,
        goal_id: GoalId,
        content: String,
        note: Option<String>,
        author_session_id: Option<SessionId>,
    ) -> Result<GoalDeliverable> {
        // Bound stored size. Truncate on a char boundary and annotate the
        // note so an oversized write never fails the master's round.
        let (content, note) = cap_goal_deliverable_content(content, note);
        let mut conn = self.pool.acquire().await.map_err(map_sqlx_err)?;
        // Confirm the goal exists for a clean not_found rather than an FK error.
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM goals WHERE id = ?")
            .bind(goal_id.as_str())
            .fetch_optional(&mut *conn)
            .await
            .map_err(map_sqlx_err)?;
        if exists.is_none() {
            return Err(GalleyError::NotFound {
                message: format!("goal {goal_id} not found"),
            });
        }
        let next_version: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM goal_deliverables WHERE goal_id = ?",
        )
        .bind(goal_id.as_str())
        .fetch_one(&mut *conn)
        .await
        .map_err(map_sqlx_err)?;
        let now = chrono_now_iso();
        let row_id = format!("gdlv_{}_{}", goal_id.0, next_version);
        sqlx::query(
            "INSERT INTO goal_deliverables \
             (id, goal_id, version, content, note, author_session_id, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&row_id)
        .bind(goal_id.as_str())
        .bind(next_version)
        .bind(&content)
        .bind(&note)
        .bind(author_session_id.as_ref().map(SessionId::as_str))
        .bind(&now)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_err)?;
        Ok(GoalDeliverable {
            id: row_id,
            goal_id,
            version: next_version.max(0) as u32,
            content,
            note,
            author_session_id,
            created_at: now,
        })
    }

    pub(super) async fn latest_goal_deliverable_db(
        &self,
        goal_id: GoalId,
    ) -> Result<Option<GoalDeliverable>> {
        let row = sqlx::query_as::<_, GoalDeliverableRow>(
            "SELECT id, goal_id, version, content, note, author_session_id, created_at \
             FROM goal_deliverables WHERE goal_id = ? ORDER BY version DESC LIMIT 1",
        )
        .bind(goal_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(row.map(GoalDeliverableRow::into_brief))
    }

    pub(super) async fn list_active_goals_db(&self) -> Result<Vec<GoalBrief>> {
        let rows = sqlx::query_as::<_, GoalRow>(
            "SELECT id, proposal_id, project_id, master_session_id, objective, status, budget_seconds, \
                    worker_limit, runtime_kind, write_mode, mode, started_at, deadline_at, \
                    ended_at, latest_summary, result_seen_at, stop_requested, workspace_path, \
                    created_at, updated_at \
             FROM goals WHERE status IN ('running','wrapping') \
             ORDER BY deadline_at ASC, started_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalRow::into_brief).collect()
    }

    /// Reverse lookup for worker sessions: "which Goal does this session
    /// work for, on what task". Worker sessions carry no schema marker —
    /// the ownership chain lives in `goal_tasks.owner_session_id` (fed by
    /// the atomic claim), so the most recently updated owned task is the
    /// session's current assignment. Returns `None` for non-worker
    /// sessions.
    ///
    /// A master must never own a task (enforced by
    /// `ensure_task_owner_not_master`), but pre-guard dirty data can still
    /// have a master stamped as an owner. Guard against it here too so the
    /// master session never renders the worker context banner — the master
    /// has its own task-board / synthesis surface, not a worker banner.
    pub async fn goal_worker_context(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<GoalWorkerContext>> {
        let row = sqlx::query_as::<_, GoalTaskRow>(
            "SELECT id, goal_id, title, description, status, owner_session_id, \
                    scope, result_summary, created_at, updated_at \
             FROM goal_tasks WHERE owner_session_id = ? \
             ORDER BY updated_at DESC, id DESC LIMIT 1",
        )
        .bind(session_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let task = row.into_brief()?;
        let goal = self.fetch_goal(task.goal_id.as_str()).await?;
        if goal.master_session_id.as_ref() == Some(session_id) {
            return Ok(None);
        }
        Ok(Some(GoalWorkerContext { goal, task }))
    }

    pub(super) async fn list_visible_goals_db(&self) -> Result<Vec<GoalBrief>> {
        // `stopped` stays visible until seen, like completed/failed:
        // stop now ends in a brief wrap-up summary, and the GUI's
        // poll-diff toast/mark-seen flow only ever observes goals that
        // appear in this list.
        let rows = sqlx::query_as::<_, GoalRow>(
            "SELECT id, proposal_id, project_id, master_session_id, objective, status, budget_seconds, \
                    worker_limit, runtime_kind, write_mode, mode, started_at, deadline_at, \
                    ended_at, latest_summary, result_seen_at, stop_requested, workspace_path, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id) AS task_count, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id \
                        AND t.status = 'completed') AS completed_task_count, \
                    (SELECT MAX(version) FROM goal_deliverables d WHERE d.goal_id = goals.id) \
                        AS deliverable_version, \
                    created_at, updated_at \
             FROM goals \
             WHERE status IN ('running','wrapping') \
                OR (status IN ('completed','failed','stopped') AND result_seen_at IS NULL) \
             ORDER BY CASE status \
                    WHEN 'running' THEN 0 \
                    WHEN 'wrapping' THEN 1 \
                    WHEN 'failed' THEN 2 \
                    WHEN 'completed' THEN 3 \
                    WHEN 'stopped' THEN 4 \
                    ELSE 5 END, \
                deadline_at ASC, updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        rows.into_iter().map(GoalRow::into_brief).collect()
    }

    pub(super) async fn list_goals_for_session_db(
        &self,
        master_session_id: SessionId,
    ) -> Result<Vec<GoalBrief>> {
        let rows = sqlx::query_as::<_, GoalRow>(
            "SELECT id, proposal_id, project_id, master_session_id, objective, status, budget_seconds, \
                    worker_limit, runtime_kind, write_mode, mode, started_at, deadline_at, \
                    ended_at, latest_summary, result_seen_at, stop_requested, workspace_path, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id) AS task_count, \
                    (SELECT COUNT(*) FROM goal_tasks t WHERE t.goal_id = goals.id \
                        AND t.status = 'completed') AS completed_task_count, \
                    (SELECT MAX(version) FROM goal_deliverables d WHERE d.goal_id = goals.id) \
                        AS deliverable_version, \
                    created_at, updated_at \
             FROM goals WHERE master_session_id = ? \
             ORDER BY started_at ASC",
        )
        .bind(master_session_id.as_str())
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

    pub(super) async fn request_goal_stop_db(
        &self,
        id: GoalId,
        _origin: Origin,
    ) -> Result<GoalBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goals SET stop_requested = 1, status = CASE \
                WHEN status = 'running' THEN 'wrapping' ELSE status END, updated_at = ? \
             WHERE id = ?",
        )
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

    pub(super) async fn update_goal_state_db(
        &self,
        id: GoalId,
        status: GoalStatus,
        latest_summary: Option<String>,
    ) -> Result<GoalBrief> {
        let now = chrono_now_iso();
        let ended_at = matches!(
            status,
            GoalStatus::Completed | GoalStatus::Stopped | GoalStatus::Failed
        )
        .then_some(now.clone());
        let res = sqlx::query(
            "UPDATE goals SET status = ?, latest_summary = COALESCE(?, latest_summary), \
                ended_at = COALESCE(?, ended_at), updated_at = ? WHERE id = ?",
        )
        .bind(goal_status_sql(status))
        .bind(
            latest_summary
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(&ended_at)
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

    /// Reject assigning a Goal task to the Goal's own master session.
    ///
    /// The master is a scheduler/editor, not a production worker (agent-api
    /// `goal-commands.md` §5.19; master duty SOP). A master that owns a scoped
    /// task breaks the worker-slot invariant (its born-`claimed` task leaves the
    /// slot with no open work, forcing the controller into fallback) and
    /// misrenders as a worker in the UI, since `goal_worker_context` resolves
    /// worker identity purely by `owner_session_id`. Workers acquire tasks via
    /// `claim`; the master never owns one. Guarding here covers every write path
    /// (create / claim / update) regardless of CLI or socket caller.
    async fn ensure_task_owner_not_master(
        &self,
        goal_id: &str,
        owner: Option<&SessionId>,
    ) -> Result<()> {
        let Some(owner) = owner else {
            return Ok(());
        };
        let goal = self.fetch_goal(goal_id).await?;
        if goal.master_session_id.as_ref().map(SessionId::as_str) == Some(owner.as_str()) {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "goal task cannot be owned by the master session {}: the master \
                     decomposes and curates, workers own tasks. Create the task open \
                     (no --owner-session) so a worker can claim it.",
                    owner.as_str()
                ),
            });
        }
        Ok(())
    }

    pub(super) async fn create_goal_task_db(
        &self,
        input: CreateGoalTaskInput,
    ) -> Result<GoalTaskBrief> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "goal.task.create: title must not be empty".into(),
            });
        }
        self.ensure_task_owner_not_master(input.goal_id.as_str(), input.owner_session_id.as_ref())
            .await?;
        let id = mint_goal_id("gtask");
        let now = chrono_now_iso();
        let status = if input.owner_session_id.is_some() {
            GoalTaskStatus::Claimed
        } else {
            GoalTaskStatus::Open
        };
        sqlx::query(
            "INSERT INTO goal_tasks (
                id, goal_id, title, description, status, owner_session_id,
                scope, result_summary, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(&id)
        .bind(input.goal_id.as_str())
        .bind(title)
        .bind(
            input
                .description
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(goal_task_status_sql(status))
        .bind(input.owner_session_id.as_ref().map(SessionId::as_str))
        .bind(
            input
                .scope
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.task.create", e))?;
        self.fetch_goal_task(&id).await
    }

    pub(super) async fn claim_goal_task_db(
        &self,
        input: ClaimGoalTaskInput,
    ) -> Result<GoalTaskBrief> {
        let task = self.fetch_goal_task(input.task_id.as_str()).await?;
        self.ensure_task_owner_not_master(task.goal_id.as_str(), Some(&input.owner_session_id))
            .await?;
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE goal_tasks SET status = 'claimed', owner_session_id = ?, \
                scope = COALESCE(?, scope), updated_at = ? \
             WHERE id = ? AND status = 'open' AND owner_session_id IS NULL",
        )
        .bind(input.owner_session_id.as_str())
        .bind(
            input
                .scope
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(&now)
        .bind(input.task_id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.task.claim", e))?;
        if res.rows_affected() == 0 {
            let existing = self.fetch_goal_task(input.task_id.as_str()).await?;
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "goal task {} is not claimable (status={:?}, owner={:?})",
                    existing.id, existing.status, existing.owner_session_id
                ),
            });
        }
        self.fetch_goal_task(input.task_id.as_str()).await
    }

    pub(super) async fn update_goal_task_db(
        &self,
        input: UpdateGoalTaskInput,
    ) -> Result<GoalTaskBrief> {
        let existing = self.fetch_goal_task(input.task_id.as_str()).await?;
        if let Some(Some(new_owner)) = input.owner_session_id.as_ref() {
            self.ensure_task_owner_not_master(existing.goal_id.as_str(), Some(new_owner))
                .await?;
        }
        let status = input.status.unwrap_or(existing.status);
        let owner = input
            .owner_session_id
            .unwrap_or(existing.owner_session_id)
            .map(|s| s.0);
        let scope = input
            .scope
            .unwrap_or(existing.scope)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let result_summary = input
            .result_summary
            .unwrap_or(existing.result_summary)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let now = chrono_now_iso();
        sqlx::query(
            "UPDATE goal_tasks SET status = ?, owner_session_id = ?, scope = ?, \
                result_summary = ?, updated_at = ? WHERE id = ?",
        )
        .bind(goal_task_status_sql(status))
        .bind(&owner)
        .bind(&scope)
        .bind(&result_summary)
        .bind(&now)
        .bind(input.task_id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.task.update", e))?;
        self.fetch_goal_task(input.task_id.as_str()).await
    }

    pub(super) async fn create_goal_event_db(
        &self,
        input: CreateGoalEventInput,
    ) -> Result<GoalEventBrief> {
        let body = input.body.trim();
        if body.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "goal.event.post: body must not be empty".into(),
            });
        }
        let now = chrono_now_iso();
        let res = sqlx::query(
            "INSERT INTO goal_events (
                goal_id, task_id, author_session_id, event_type, body, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(input.goal_id.as_str())
        .bind(input.task_id.as_ref().map(GoalTaskId::as_str))
        .bind(input.author_session_id.as_ref().map(SessionId::as_str))
        .bind(goal_event_type_sql(input.event_type))
        .bind(body)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("goal.event.post", e))?;
        let id = res.last_insert_rowid();
        let row = sqlx::query_as::<_, GoalEventRow>(
            "SELECT id, goal_id, task_id, author_session_id, event_type, body, created_at \
             FROM goal_events WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        row.into_brief()
    }
}
