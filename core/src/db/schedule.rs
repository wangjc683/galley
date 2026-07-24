use chrono::Local;

use crate::api::schedule::{
    instant_to_utc_iso, next_fire_after, parse_time_of_day, resolve_wall_clock,
};

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
    pub(super) time_of_day: String,
    pub(super) llm_name: Option<String>,
    pub(super) enabled: i64,
    pub(super) last_fired_at: Option<String>,
    pub(super) last_run_session_id: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

const SCHEDULED_TASK_COLUMNS: &str = "id, project_id, prompt, repeat_kind, repeat_days, \
    time_of_day, llm_name, enabled, last_fired_at, last_run_session_id, created_at, updated_at";

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
    }
}

impl ScheduledTaskRow {
    fn into_brief(self) -> Result<ScheduledTaskBrief> {
        let repeat = parse_repeat_row(&self.repeat_kind, self.repeat_days.as_deref())?;
        let enabled = self.enabled != 0;
        let next_fire_at = if enabled {
            let tod = parse_time_of_day(&self.time_of_day)?;
            let now_local = Local::now();
            let next = next_fire_after(&repeat, tod, now_local.naive_local());
            Some(instant_to_utc_iso(&resolve_wall_clock(&Local, next)))
        } else {
            None
        };
        Ok(ScheduledTaskBrief {
            id: ScheduledTaskId(self.id),
            project_id: self.project_id.map(ProjectId),
            prompt: self.prompt,
            repeat,
            time_of_day: self.time_of_day,
            llm_name: self.llm_name,
            enabled,
            last_fired_at: self.last_fired_at,
            last_run_session_id: self.last_run_session_id.map(SessionId),
            next_fire_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl SqliteGalley {
    pub(super) async fn fetch_scheduled_task(&self, id: &str) -> Result<ScheduledTaskBrief> {
        let sql = format!("SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_tasks WHERE id = ?");
        let row = sqlx::query_as::<_, ScheduledTaskRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            })?;
        row.into_brief()
    }

    pub(super) async fn list_scheduled_tasks_db(&self) -> Result<Vec<ScheduledTaskBrief>> {
        let sql = format!(
            "SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_tasks \
             ORDER BY enabled DESC, updated_at DESC"
        );
        let rows = sqlx::query_as::<_, ScheduledTaskRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        rows.into_iter().map(ScheduledTaskRow::into_brief).collect()
    }

    pub(super) async fn create_scheduled_task_db(
        &self,
        input: CreateScheduledTaskInput,
        _origin: Origin,
    ) -> Result<ScheduledTaskBrief> {
        let id = input.id.trim();
        if id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "create_scheduled_task: id must not be empty".into(),
            });
        }
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "create_scheduled_task: prompt must not be empty".into(),
            });
        }
        parse_time_of_day(&input.time_of_day)?;
        let repeat = input.repeat.normalized()?;
        let (repeat_kind, repeat_days) = repeat_to_columns(&repeat);
        let project_id = input
            .project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO scheduled_tasks (id, project_id, prompt, repeat_kind, repeat_days, \
                time_of_day, llm_name, enabled, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&project_id)
        .bind(prompt)
        .bind(repeat_kind)
        .bind(&repeat_days)
        .bind(&input.time_of_day)
        .bind(
            input
                .llm_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty()),
        )
        .bind(if input.enabled { 1_i64 } else { 0_i64 })
        .bind(&now)
        .bind(&now)
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
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM scheduled_tasks WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if exists.is_none() {
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            });
        }

        let mut sets: Vec<&str> = Vec::with_capacity(7);
        let mut prompt_val: Option<String> = None;
        if let Some(raw) = patch.prompt.as_ref() {
            let t = raw.trim();
            if t.is_empty() {
                return Err(GalleyError::InvalidArgs {
                    message: "update_scheduled_task: prompt must not be empty".into(),
                });
            }
            prompt_val = Some(t.to_string());
            sets.push("prompt = ?");
        }
        let (write_project, project_val) = project_nullable_patch(&patch.project_id);
        if write_project {
            sets.push("project_id = ?");
        }
        let mut repeat_cols: Option<(&'static str, Option<String>)> = None;
        if let Some(repeat) = patch.repeat {
            repeat_cols = Some(repeat_to_columns(&repeat.normalized()?));
            sets.push("repeat_kind = ?");
            sets.push("repeat_days = ?");
        }
        if let Some(tod) = patch.time_of_day.as_ref() {
            parse_time_of_day(tod)?;
            sets.push("time_of_day = ?");
        }
        let (write_llm, llm_val) = project_nullable_patch(&patch.llm_name);
        if write_llm {
            sets.push("llm_name = ?");
        }
        if patch.enabled.is_some() {
            sets.push("enabled = ?");
        }
        sets.push("updated_at = ?");

        let now = chrono_now_iso();
        let sql = format!(
            "UPDATE scheduled_tasks SET {} WHERE id = ?",
            sets.join(", ")
        );
        let mut q = sqlx::query(&sql);
        if let Some(v) = prompt_val.as_ref() {
            q = q.bind(v);
        }
        if write_project {
            q = q.bind(&project_val);
        }
        if let Some((kind, weekdays)) = repeat_cols.as_ref() {
            q = q.bind(kind).bind(weekdays);
        }
        if let Some(tod) = patch.time_of_day.as_ref() {
            q = q.bind(tod);
        }
        if write_llm {
            q = q.bind(&llm_val);
        }
        if let Some(enabled) = patch.enabled {
            q = q.bind(if enabled { 1_i64 } else { 0_i64 });
        }
        q = q.bind(&now).bind(id.as_str());
        q.execute(&self.pool)
            .await
            .map_err(|e| map_constraint_err("update_scheduled_task", e))?;
        self.fetch_scheduled_task(id.as_str()).await
    }

    pub(super) async fn delete_scheduled_task_db(
        &self,
        id: ScheduledTaskId,
        _origin: Origin,
    ) -> Result<()> {
        let res = sqlx::query("DELETE FROM scheduled_tasks WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("scheduled task {id} not found"),
            });
        }
        Ok(())
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
}
