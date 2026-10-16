use chrono::{Local, Utc};

use crate::api::schedule::{
    instant_to_utc_iso, next_fire_after, parse_fire_at, parse_time_of_day, parse_utc_secs,
    resolve_wall_clock, wall_clock_hhmm, ScheduleTarget, ScheduledTaskCreatedIn, ScheduledWake,
    ASSISTANT_UNAVAILABLE, TIME_IN_PAST,
};

use super::helpers::origin_from_stored;
use super::*;

/// Row ↔ brief conversion lives here (not `rows.rs`) because the brief
/// carries the read-time-computed `next_fire_at`, which needs "now".
#[derive(Debug, FromRow)]
pub(super) struct ScheduledTaskRow {
    pub(super) id: String,
    pub(super) project_id: Option<String>,
    pub(super) prompt: String,
    pub(super) repeat_kind: String,
    pub(super) repeat_days: Option<String>,
    pub(super) time_of_day: Option<String>,
    pub(super) fire_at: Option<String>,
    pub(super) llm_name: Option<String>,
    pub(super) enabled: i64,
    pub(super) last_fired_at: Option<String>,
    pub(super) last_run_session_id: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) target: String,
    pub(super) created_via: String,
    pub(super) created_by_supervisor: Option<String>,
    pub(super) created_origin_note: Option<String>,
    pub(super) created_in_session_id: Option<String>,
    pub(super) created_in_turn_index: Option<i64>,
    pub(super) last_due_at: Option<String>,
    pub(super) last_wake: Option<String>,
    pub(super) cancelled_at: Option<String>,
}

const SCHEDULED_TASK_COLUMNS: &str = "id, project_id, prompt, repeat_kind, repeat_days, \
    time_of_day, fire_at, llm_name, enabled, last_fired_at, last_run_session_id, created_at, \
    updated_at, target, created_via, created_by_supervisor, created_origin_note, \
    created_in_session_id, created_in_turn_index, last_due_at, last_wake, cancelled_at";

/// Which scheduled tasks a list read returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleListScope {
    /// Every task not cancelled — the desktop's list and the scheduler
    /// ([`GalleyApi::list_scheduled_tasks`]).
    Live,
    /// Tasks that may still fire: enabled, not cancelled, not a one-off
    /// that fired ([`ScheduledTaskBrief::is_active`]) — `schedule list`.
    Active,
    /// Every row, cancelled ones included — `schedule list --all`.
    All,
}

fn parse_day_csv(raw: Option<&str>) -> Result<Vec<u8>> {
    raw.unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<u8>().map_err(|_| GalleyError::Internal {
                message: format!("scheduled task: bad repeat_days cell {s:?}"),
            })
        })
        .collect()
}

fn parse_repeat_row(kind: &str, repeat_days: Option<&str>) -> Result<ScheduledTaskRepeat> {
    match kind {
        "daily" => Ok(ScheduledTaskRepeat::Daily),
        "weekly" => ScheduledTaskRepeat::Weekly {
            weekdays: parse_day_csv(repeat_days)?,
        }
        .normalized(),
        "monthly" => ScheduledTaskRepeat::Monthly {
            monthdays: parse_day_csv(repeat_days)?,
        }
        .normalized(),
        "once" => Ok(ScheduledTaskRepeat::Once),
        other => Err(GalleyError::Internal {
            message: format!("scheduled task: unknown repeat_kind {other:?}"),
        }),
    }
}

fn day_csv(days: &[u8]) -> Option<String> {
    Some(days.iter().map(u8::to_string).collect::<Vec<_>>().join(","))
}

fn repeat_to_columns(repeat: &ScheduledTaskRepeat) -> (&'static str, Option<String>) {
    match repeat {
        ScheduledTaskRepeat::Daily => ("daily", None),
        ScheduledTaskRepeat::Weekly { weekdays } => ("weekly", day_csv(weekdays)),
        ScheduledTaskRepeat::Monthly { monthdays } => ("monthly", day_csv(monthdays)),
        ScheduledTaskRepeat::Once => ("once", None),
    }
}

impl ScheduledTaskRow {
    fn into_brief(self) -> Result<ScheduledTaskBrief> {
        let repeat = parse_repeat_row(&self.repeat_kind, self.repeat_days.as_deref())?;
        let enabled = self.enabled != 0;
        let target = ScheduleTarget::from_sql(&self.target)?;
        let last_wake = self
            .last_wake
            .as_deref()
            .map(ScheduledWake::from_sql)
            .transpose()?;
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
        let mut brief = ScheduledTaskBrief {
            id: ScheduledTaskId(self.id),
            project_id: self.project_id.map(ProjectId),
            prompt: self.prompt,
            time_of_day: String::new(),
            fire_at: None,
            target,
            llm_name: self.llm_name,
            enabled,
            last_fired_at: self.last_fired_at,
            last_run_session_id: self.last_run_session_id.map(SessionId),
            next_fire_at: None,
            last_due_at: self.last_due_at,
            last_wake,
            origin: Some(origin),
            created_in,
            cancelled_at: self.cancelled_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
            repeat,
        };
        if brief.repeat.is_once() {
            let fire_at = self.fire_at.ok_or_else(|| GalleyError::Internal {
                message: "scheduled task: one-off without fire_at".into(),
            })?;
            parse_utc_secs(&fire_at).ok_or_else(|| GalleyError::Internal {
                message: format!("scheduled task: bad fire_at {fire_at:?}"),
            })?;
            brief.time_of_day = wall_clock_hhmm(&fire_at, &Local).unwrap_or_default();
            brief.fire_at = Some(fire_at);
            if brief.enabled && brief.cancelled_at.is_none() && !brief.once_fired() {
                brief.next_fire_at = brief.fire_at.clone();
            }
        } else {
            let raw_tod = self.time_of_day.ok_or_else(|| GalleyError::Internal {
                message: "scheduled task: repeating task without time_of_day".into(),
            })?;
            let tod = parse_time_of_day(&raw_tod)?;
            brief.time_of_day = raw_tod;
            if brief.enabled && brief.cancelled_at.is_none() {
                let next = next_fire_after(&brief.repeat, tod, Local::now().naive_local());
                brief.next_fire_at = Some(instant_to_utc_iso(&resolve_wall_clock(&Local, next)));
            }
        }
        Ok(brief)
    }
}

/// A task's shape after validation: the columns that decide when it
/// fires and what that does.
struct Shape {
    repeat: ScheduledTaskRepeat,
    time_of_day: Option<String>,
    fire_at: Option<String>,
    target: ScheduleTarget,
}

fn invalid(message: impl Into<String>) -> GalleyError {
    GalleyError::InvalidArgs {
        message: message.into(),
    }
}

/// A one-off's fire time, refused when already past: [`TIME_IN_PAST`].
fn future_fire_at(raw: &str, context: &str) -> Result<String> {
    let at = parse_fire_at(raw, &Local)?;
    let now = Utc::now();
    if at.timestamp() < now.timestamp() {
        return Err(invalid(format!(
            "{TIME_IN_PAST}: {context}: {} is in the past (now {})",
            instant_to_utc_iso(&at),
            instant_to_utc_iso(&now)
        )));
    }
    Ok(instant_to_utc_iso(&at))
}

impl SqliteGalley {
    /// Whether a task may wake the assistant now: the active runtime is
    /// the managed one and it has a main chat. Refused otherwise with
    /// [`ASSISTANT_UNAVAILABLE`]: an attached external GA has no main
    /// chat (main chat PRD ruling 3), so a task made for one could never
    /// fire.
    pub async fn ensure_assistant_available(&self, context: &str) -> Result<SessionId> {
        if self.active_runtime_kind().await? != RuntimeKind::Managed {
            return Err(invalid(format!(
                "{ASSISTANT_UNAVAILABLE}: {context}: target assistant needs the managed runtime; \
                 the active runtime is the external one"
            )));
        }
        self.main_chat_id().await?.ok_or_else(|| {
            invalid(format!(
                "{ASSISTANT_UNAVAILABLE}: {context}: target assistant needs the main chat, and \
                 there is none yet"
            ))
        })
    }

    async fn scheduled_task_row(&self, id: &str) -> Result<ScheduledTaskRow> {
        let sql = format!("SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_tasks WHERE id = ?");
        sqlx::query_as::<_, ScheduledTaskRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            })
    }

    pub(super) async fn fetch_scheduled_task(&self, id: &str) -> Result<ScheduledTaskBrief> {
        self.scheduled_task_row(id).await?.into_brief()
    }

    /// One scheduled task, cancelled or not (`schedule show`).
    ///
    /// **Errors**: `not_found`.
    pub async fn scheduled_task(&self, id: &str) -> Result<ScheduledTaskBrief> {
        self.fetch_scheduled_task(id).await
    }

    pub(super) async fn list_scheduled_tasks_db(&self) -> Result<Vec<ScheduledTaskBrief>> {
        self.list_scheduled_tasks_in(ScheduleListScope::Live).await
    }

    /// The scheduled tasks `scope` names, enabled first, then most
    /// recently updated.
    pub async fn list_scheduled_tasks_in(
        &self,
        scope: ScheduleListScope,
    ) -> Result<Vec<ScheduledTaskBrief>> {
        let filter = match scope {
            ScheduleListScope::All => "",
            ScheduleListScope::Live | ScheduleListScope::Active => "WHERE cancelled_at IS NULL ",
        };
        let sql = format!(
            "SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_tasks {filter}\
             ORDER BY enabled DESC, updated_at DESC"
        );
        let rows = sqlx::query_as::<_, ScheduledTaskRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        // Per-row tolerance: one corrupt row (manual DB edit, version
        // skew) must not hide the healthy tasks from the GUI or stop
        // the scheduler from firing them. Skip and log; the single-row
        // fetch above still errors loudly for direct lookups.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = row.id.clone();
                row.into_brief()
                    .map_err(|e| eprintln!("[db] scheduled task {id} unreadable, skipped: {e:?}"))
                    .ok()
            })
            .filter(|t| scope != ScheduleListScope::Active || t.is_active())
            .collect())
    }

    /// Validate what decides when a task fires and what that does.
    /// `context` prefixes the error messages.
    async fn checked_shape(
        &self,
        repeat: ScheduledTaskRepeat,
        time_of_day: Option<&str>,
        fire_at: Option<&str>,
        target: ScheduleTarget,
        target_changed: bool,
        project_id: Option<&str>,
        llm_name: Option<&str>,
        context: &str,
    ) -> Result<Shape> {
        let repeat = repeat.normalized()?;
        let (time_of_day, fire_at) = if repeat.is_once() {
            let raw = fire_at.ok_or_else(|| {
                invalid(format!(
                    "{context}: a one-off task needs a fire time (fireAt)"
                ))
            })?;
            (None, Some(future_fire_at(raw, context)?))
        } else {
            if fire_at.is_some() {
                return Err(invalid(format!(
                    "{context}: a fire time (fireAt) is for one-off tasks only"
                )));
            }
            let tod = time_of_day
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| {
                    invalid(format!(
                        "{context}: a repeating task needs a time of day (HH:MM)"
                    ))
                })?;
            parse_time_of_day(tod)?;
            (Some(tod.to_string()), None)
        };
        if target == ScheduleTarget::Assistant {
            if target_changed {
                self.ensure_assistant_available(context).await?;
            }
            if project_id.is_some() || llm_name.is_some() {
                return Err(invalid(format!(
                    "{context}: a project and a model apply to target session only; clear them \
                     for target assistant"
                )));
            }
        }
        Ok(Shape {
            repeat,
            time_of_day,
            fire_at,
            target,
        })
    }

    pub(super) async fn create_scheduled_task_db(
        &self,
        input: CreateScheduledTaskInput,
        origin: Origin,
    ) -> Result<ScheduledTaskBrief> {
        self.create_scheduled_task_in(input, origin, None).await
    }

    /// Create a scheduled task, recording where: `created_in` is the main
    /// chat and the turn of the user row that started the run the
    /// assistant made it in ([`Self::settle_scheduled_created_in`] fills
    /// the reply's turn when that run ends). The GUI form and other
    /// callers pass `None`.
    pub async fn create_scheduled_task_in(
        &self,
        input: CreateScheduledTaskInput,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<ScheduledTaskBrief> {
        let id = input.id.trim();
        if id.is_empty() {
            return Err(invalid("create_scheduled_task: id must not be empty"));
        }
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(invalid("create_scheduled_task: prompt must not be empty"));
        }
        let project_id = input
            .project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let llm_name = input
            .llm_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let shape = self
            .checked_shape(
                input.repeat,
                Some(&input.time_of_day),
                input.fire_at.as_deref(),
                input.target,
                true,
                project_id.as_deref(),
                llm_name.as_deref(),
                "create_scheduled_task",
            )
            .await?;
        let (repeat_kind, repeat_days) = repeat_to_columns(&shape.repeat);
        let (in_session, in_run_turn) = match created_in {
            Some((session, turn)) => (Some(session.0), Some(turn)),
            None => (None, None),
        };
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO scheduled_tasks (id, project_id, prompt, repeat_kind, repeat_days, \
                time_of_day, fire_at, llm_name, enabled, created_at, updated_at, target, \
                created_via, created_by_supervisor, created_origin_note, created_in_session_id, \
                created_in_run_turn) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&project_id)
        .bind(prompt)
        .bind(repeat_kind)
        .bind(&repeat_days)
        .bind(&shape.time_of_day)
        .bind(&shape.fire_at)
        .bind(&llm_name)
        .bind(if input.enabled { 1_i64 } else { 0_i64 })
        .bind(&now)
        .bind(&now)
        .bind(shape.target.as_sql())
        .bind(origin.via.as_sql())
        .bind(origin.stored_supervisor())
        .bind(origin.reason.as_deref())
        .bind(&in_session)
        .bind(in_run_turn)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("create_scheduled_task", e))?;
        self.fetch_scheduled_task(id).await
    }

    pub(super) async fn update_scheduled_task_db(
        &self,
        id: ScheduledTaskId,
        patch: ScheduledTaskPatch,
        _origin: Origin,
    ) -> Result<ScheduledTaskBrief> {
        let row = self.scheduled_task_row(id.as_str()).await?;
        if row.cancelled_at.is_some() {
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} is cancelled"),
            });
        }
        let current_repeat = parse_repeat_row(&row.repeat_kind, row.repeat_days.as_deref())?;
        let current_target = ScheduleTarget::from_sql(&row.target)?;

        let prompt = match patch.prompt.as_ref() {
            Some(raw) => {
                let t = raw.trim();
                if t.is_empty() {
                    return Err(invalid("update_scheduled_task: prompt must not be empty"));
                }
                t.to_string()
            }
            None => row.prompt.clone(),
        };
        let (write_project, project_val) = project_nullable_patch(&patch.project_id);
        let project_id = if write_project {
            project_val
        } else {
            row.project_id.clone()
        };
        let (write_llm, llm_val) = project_nullable_patch(&patch.llm_name);
        let llm_name = if write_llm {
            llm_val
        } else {
            row.llm_name.clone()
        };
        // A new fire time alone makes the task a one-off; a repeat rule
        // alone makes it a repeating one again.
        let repeat = match (&patch.repeat, &patch.fire_at) {
            (Some(repeat), _) => repeat.clone(),
            (None, Some(_)) => ScheduledTaskRepeat::Once,
            (None, None) => current_repeat.clone(),
        };
        let fire_at_input = match (&patch.fire_at, repeat.is_once()) {
            (Some(raw), _) => Some(raw.clone()),
            // Still the same one-off: its fire time stands as is (even
            // when past — it already fired or is about to).
            (None, true) if current_repeat.is_once() => None,
            (None, true) => {
                return Err(invalid(
                    "update_scheduled_task: a one-off task needs a fire time (fireAt)",
                ))
            }
            (None, false) => None,
        };
        let time_of_day = patch
            .time_of_day
            .clone()
            .or_else(|| row.time_of_day.clone());
        let target = patch.target.unwrap_or(current_target);
        let target_changed = patch.target.is_some() && target != current_target;

        let shape = if repeat.is_once() && fire_at_input.is_none() {
            // Unchanged one-off fire time: only the target rules apply.
            let unchanged = self
                .checked_shape(
                    ScheduledTaskRepeat::Daily,
                    Some("00:00"),
                    None,
                    target,
                    target_changed,
                    project_id.as_deref(),
                    llm_name.as_deref(),
                    "update_scheduled_task",
                )
                .await?;
            Shape {
                repeat: ScheduledTaskRepeat::Once,
                time_of_day: None,
                fire_at: row.fire_at.clone(),
                target: unchanged.target,
            }
        } else {
            self.checked_shape(
                repeat,
                if fire_at_input.is_some() {
                    None
                } else {
                    time_of_day.as_deref()
                },
                fire_at_input.as_deref(),
                target,
                target_changed,
                project_id.as_deref(),
                llm_name.as_deref(),
                "update_scheduled_task",
            )
            .await?
        };
        let (repeat_kind, repeat_days) = repeat_to_columns(&shape.repeat);
        let enabled = patch.enabled.unwrap_or(row.enabled != 0);

        sqlx::query(
            "UPDATE scheduled_tasks SET prompt = ?, project_id = ?, repeat_kind = ?, \
                repeat_days = ?, time_of_day = ?, fire_at = ?, llm_name = ?, enabled = ?, \
                target = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(&prompt)
        .bind(&project_id)
        .bind(repeat_kind)
        .bind(&repeat_days)
        .bind(&shape.time_of_day)
        .bind(&shape.fire_at)
        .bind(&llm_name)
        .bind(if enabled { 1_i64 } else { 0_i64 })
        .bind(shape.target.as_sql())
        .bind(chrono_now_iso())
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("update_scheduled_task", e))?;
        self.fetch_scheduled_task(id.as_str()).await
    }

    pub(super) async fn delete_scheduled_task_db(
        &self,
        id: ScheduledTaskId,
        _origin: Origin,
    ) -> Result<()> {
        self.cancel_scheduled_task(&id).await.map(|_| ())
    }

    /// Cancel a task (main chat ticket 33): the soft delete behind every
    /// delete, the desktop's and the CLI's. The row stays with
    /// `cancelled_at`. A cancelled task is gone for every write, so
    /// cancelling it again is `not_found`, as deleting twice always was.
    ///
    /// **Errors**: `not_found`.
    pub async fn cancel_scheduled_task(&self, id: &ScheduledTaskId) -> Result<ScheduledTaskBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE scheduled_tasks SET cancelled_at = ?, updated_at = ? \
             WHERE id = ? AND cancelled_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            // Either no such row or cancelled before; say which.
            self.scheduled_task_row(id.as_str()).await?;
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} is cancelled"),
            });
        }
        self.fetch_scheduled_task(id.as_str()).await
    }

    pub(super) async fn mark_scheduled_task_fired_db(
        &self,
        id: ScheduledTaskId,
        fired_at_iso: String,
        session_id: Option<SessionId>,
    ) -> Result<ScheduledTaskBrief> {
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE scheduled_tasks \
             SET last_fired_at = ?, last_run_session_id = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(&fired_at_iso)
        .bind(session_id.as_ref().map(|s| s.as_str().to_string()))
        .bind(&now)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("mark_scheduled_task_fired", e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            });
        }
        self.fetch_scheduled_task(id.as_str()).await
    }

    /// Record the fire of a task that wakes the assistant: when it fired,
    /// the period it was due for, and its wake as pending — durable, so a
    /// restart sends it again until it is delivered or notified.
    ///
    /// **Errors**: `not_found`.
    pub async fn mark_scheduled_reminder_fired(
        &self,
        id: &ScheduledTaskId,
        fired_at_iso: &str,
        due_at_iso: &str,
    ) -> Result<ScheduledTaskBrief> {
        let res = sqlx::query(
            "UPDATE scheduled_tasks \
             SET last_fired_at = ?, last_due_at = ?, last_wake = 'pending', \
                 last_run_session_id = NULL, updated_at = ? \
             WHERE id = ?",
        )
        .bind(fired_at_iso)
        .bind(due_at_iso)
        .bind(chrono_now_iso())
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("mark_scheduled_reminder_fired", e))?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            });
        }
        self.fetch_scheduled_task(id.as_str()).await
    }

    /// Settle the pending wake of the fire at `fired_at_iso`: `true` when
    /// this call moved it (it was still that fire's, still pending).
    pub async fn settle_scheduled_wake(
        &self,
        id: &str,
        fired_at_iso: &str,
        wake: ScheduledWake,
    ) -> Result<bool> {
        let res = sqlx::query(
            "UPDATE scheduled_tasks SET last_wake = ?, updated_at = ? \
             WHERE id = ? AND last_fired_at = ? AND last_wake = 'pending'",
        )
        .bind(wake.as_sql())
        .bind(chrono_now_iso())
        .bind(id)
        .bind(fired_at_iso)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected() > 0)
    }

    /// The fires of tasks that wake the assistant still waiting to be
    /// delivered — what a restart sends again. Cancelled tasks drop out.
    pub async fn pending_scheduled_wakes(&self) -> Result<Vec<ScheduledTaskBrief>> {
        let sql = format!(
            "SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_tasks \
             WHERE last_wake = 'pending' AND target = 'assistant' AND cancelled_at IS NULL \
             ORDER BY last_fired_at, id"
        );
        let rows = sqlx::query_as::<_, ScheduledTaskRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = row.id.clone();
                row.into_brief()
                    .map_err(|e| eprintln!("[db] scheduled task {id} unreadable, skipped: {e:?}"))
                    .ok()
            })
            .collect())
    }

    /// When a run of `session_id` ends: the tasks the assistant made in
    /// that run get the run's reply turn — its latest visible assistant
    /// row — so their cards hang under it. The run is the one the latest
    /// user row started (read before the next queued message is written).
    /// Returns how many tasks were settled; a run that wrote no reply
    /// leaves them unsettled.
    pub async fn settle_scheduled_created_in(&self, session_id: &str) -> Result<u64> {
        let res = sqlx::query(
            "UPDATE scheduled_tasks \
             SET created_in_turn_index = ( \
                   SELECT MAX(m.turn_index) FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= scheduled_tasks.created_in_run_turn), \
                 updated_at = ? \
             WHERE created_in_session_id = ? AND created_in_turn_index IS NULL \
               AND created_in_run_turn = ( \
                   SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user') \
               AND EXISTS ( \
                   SELECT 1 FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= scheduled_tasks.created_in_run_turn)",
        )
        .bind(session_id)
        .bind(chrono_now_iso())
        .bind(session_id)
        .bind(session_id)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected())
    }

    /// Whether a person wrote in `session_id` from an app (the desktop or
    /// the phone): a user row with `created_via = 'gui'`.
    pub async fn has_user_written(&self, session_id: &SessionId) -> Result<bool> {
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM messages \
             WHERE session_id = ? AND role = 'user' AND created_via = 'gui'",
        )
        .bind(session_id.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(n > 0)
    }
}
