//! To-dos (main chat ticket 39): the record and every write, shared by the
//! desktop's three commands and the CLI (ticket 40). Reminders go through
//! the scheduled-task functions (`db/schedule.rs`, ticket 33).

use std::collections::{HashMap, HashSet};

use chrono::Local;

use crate::api::schedule::{
    mint_scheduled_task_id, CreateScheduledTaskInput, ScheduleTarget, ScheduledTaskCreatedIn,
    ScheduledTaskPatch, ScheduledTaskRepeat, ScheduledWake,
};
use crate::api::todo::{
    parse_todo_due, CreateTodoInput, StoredDue, TodoBrief, TodoId, TodoPatch, TodoReminder,
    TodoReminderState, TodoStatus,
};

use super::helpers::origin_from_stored;
use super::schedule::future_fire_at;
use super::*;

#[derive(Debug, FromRow)]
struct TodoRow {
    id: String,
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    due_at: Option<String>,
    done_at: Option<String>,
    done_via: Option<String>,
    done_by_supervisor: Option<String>,
    done_origin_note: Option<String>,
    cancelled_at: Option<String>,
    created_via: String,
    created_by_supervisor: Option<String>,
    created_origin_note: Option<String>,
    created_in_session_id: Option<String>,
    created_in_turn_index: Option<i64>,
    created_at: String,
    updated_at: String,
}

const TODO_COLUMNS: &str = "id, title, notes, due_date, due_at, done_at, done_via, \
    done_by_supervisor, done_origin_note, cancelled_at, created_via, created_by_supervisor, \
    created_origin_note, created_in_session_id, created_in_turn_index, created_at, updated_at";

/// Which to-dos a list read returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoListScope {
    /// Not done, not cancelled — `todo list`.
    Open,
    /// Open and done (the desktop's list and the 「在办的事」 lines read
    /// these: open ones, and done ones within their window).
    Live,
    /// Every row, cancelled ones included — `todo list --all`.
    All,
}

impl TodoRow {
    fn status(&self) -> TodoStatus {
        if self.cancelled_at.is_some() {
            TodoStatus::Cancelled
        } else if self.done_at.is_some() {
            TodoStatus::Done
        } else {
            TodoStatus::Open
        }
    }

    fn into_brief(self, reminder: Option<TodoReminder>) -> Result<TodoBrief> {
        let status = self.status();
        let due = StoredDue::from_columns(self.due_date.as_deref(), self.due_at.as_deref())?
            .map(|due| due.to_wire(&Local));
        let done_by = match self.done_via.as_deref() {
            Some(via) => Some(origin_from_stored(
                via,
                self.done_by_supervisor,
                self.done_origin_note,
            )?),
            None => None,
        };
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
        Ok(TodoBrief {
            id: TodoId(self.id),
            title: self.title,
            notes: self.notes,
            due,
            reminder,
            status,
            done_at: self.done_at,
            done_by,
            origin,
            created_in,
            cancelled_at: self.cancelled_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// A to-do's reminder as the to-do shows it: its task's time and whether
/// it went off. `None` for a task with no time to show (a repeating task
/// someone paused).
fn reminder_of(task: &ScheduledTaskBrief) -> Option<TodoReminder> {
    let (state, at) = if task.repeat.is_once() {
        let state = if task.once_fired() {
            TodoReminderState::Fired
        } else if task.enabled {
            TodoReminderState::Scheduled
        } else {
            TodoReminderState::Paused
        };
        (state, task.fire_at.clone()?)
    } else {
        // Made repeating through `schedule update`: its next fire.
        let state = if task.enabled {
            TodoReminderState::Scheduled
        } else {
            TodoReminderState::Paused
        };
        (state, task.next_fire_at.clone()?)
    };
    Some(TodoReminder {
        task_id: task.id.clone(),
        at,
        state,
    })
}

/// Whether ticking off or cancelling the to-do cancels this reminder: it
/// has not gone off for its time, or it went off and its wake has not
/// reached the assistant yet (`last_wake = 'pending'`). Either way the
/// user has not been reminded; one that reached the assistant stays as it
/// is (ticket 39: "已触发的不动"), and unticking never brings one back.
fn reminder_unspent(task: &ScheduledTaskBrief) -> bool {
    !task.once_fired() || task.last_wake == Some(ScheduledWake::Pending)
}

fn invalid(message: impl Into<String>) -> GalleyError {
    GalleyError::InvalidArgs {
        message: message.into(),
    }
}

fn gone(id: &str) -> GalleyError {
    GalleyError::NotFound {
        message: format!("todo {id} is cancelled"),
    }
}

/// A title: trimmed, not empty.
fn checked_title(raw: &str, context: &str) -> Result<String> {
    let title = raw.trim();
    if title.is_empty() {
        return Err(invalid(format!("{context}: a to-do needs a title")));
    }
    Ok(title.to_string())
}

/// Notes: trimmed; empty is none.
fn clean_notes(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
}

impl SqliteGalley {
    async fn todo_row(&self, id: &str) -> Result<TodoRow> {
        let sql = format!("SELECT {TODO_COLUMNS} FROM todos WHERE id = ?");
        sqlx::query_as::<_, TodoRow>(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?
            .ok_or_else(|| GalleyError::NotFound {
                message: format!("todo {id} not found"),
            })
    }

    /// A row that may be written: there, not cancelled.
    async fn live_todo_row(&self, id: &str) -> Result<TodoRow> {
        let row = self.todo_row(id).await?;
        if row.cancelled_at.is_some() {
            return Err(gone(id));
        }
        Ok(row)
    }

    /// The to-do's reminder: its task not cancelled (Core keeps one at
    /// most; the newest, should there be more).
    pub(super) async fn todo_reminder_task(
        &self,
        todo_id: &str,
    ) -> Result<Option<ScheduledTaskBrief>> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM scheduled_tasks \
             WHERE todo_id = ? AND cancelled_at IS NULL \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(todo_id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        match ids.first() {
            Some(id) => Ok(Some(self.fetch_scheduled_task(id).await?)),
            None => Ok(None),
        }
    }

    /// One to-do, cancelled or not (`todo show`).
    ///
    /// **Errors**: `not_found`.
    pub async fn todo(&self, id: &str) -> Result<TodoBrief> {
        let row = self.todo_row(id).await?;
        let reminder = self
            .todo_reminder_task(id)
            .await?
            .as_ref()
            .and_then(reminder_of);
        row.into_brief(reminder)
    }

    /// The to-dos `scope` names, oldest first (the readers sort).
    pub async fn list_todos(&self, scope: TodoListScope) -> Result<Vec<TodoBrief>> {
        let filter = match scope {
            TodoListScope::Open => "WHERE cancelled_at IS NULL AND done_at IS NULL ",
            TodoListScope::Live => "WHERE cancelled_at IS NULL ",
            TodoListScope::All => "",
        };
        let sql = format!("SELECT {TODO_COLUMNS} FROM todos {filter}ORDER BY created_at, id");
        let rows = sqlx::query_as::<_, TodoRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        let reminders = self.todo_reminders().await?;
        // Per-row tolerance, as for scheduled tasks: one unreadable row
        // must not hide the others.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = row.id.clone();
                let reminder = reminders.get(&id).and_then(reminder_of);
                row.into_brief(reminder)
                    .map_err(|e| eprintln!("[db] todo {id} unreadable, skipped: {e:?}"))
                    .ok()
            })
            .collect())
    }

    /// Every to-do's reminder, by to-do id.
    async fn todo_reminders(&self) -> Result<HashMap<String, ScheduledTaskBrief>> {
        let mut by_todo: HashMap<String, ScheduledTaskBrief> = HashMap::new();
        for task in self
            .list_scheduled_tasks_in(ScheduleListScope::Live)
            .await?
        {
            let Some(todo_id) = task.todo_id.clone() else {
                continue;
            };
            match by_todo.get(&todo_id) {
                Some(kept)
                    if (kept.created_at.as_str(), kept.id.as_str())
                        >= (task.created_at.as_str(), task.id.as_str()) => {}
                _ => {
                    by_todo.insert(todo_id, task);
                }
            }
        }
        Ok(by_todo)
    }

    /// The ids of the to-dos still open — the scheduler's check before a
    /// reminder goes off.
    pub async fn open_todo_ids(&self) -> Result<HashSet<String>> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM todos WHERE done_at IS NULL AND cancelled_at IS NULL",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(ids.into_iter().collect())
    }

    /// Note a to-do (main chat ticket 39). `created_in` is the main chat
    /// and the turn of the user row that started the run Galley noted it
    /// in ([`Self::settle_todo_created_in`] fills the reply's turn when
    /// that run ends), as for a scheduled task. With `remind_at`, a
    /// reminder: a one-off scheduled task that wakes the assistant, made
    /// by [`Self::create_scheduled_task_in`] and linked to the to-do.
    ///
    /// To-dos are the assistant's notebook: refused with
    /// [`crate::api::ASSISTANT_UNAVAILABLE`] unless the managed runtime
    /// is active and has a main chat. A reminder time already past is
    /// refused with [`crate::api::TIME_IN_PAST`] before anything is
    /// written.
    ///
    /// **Errors**: `invalid_args`.
    pub async fn create_todo(
        &self,
        input: CreateTodoInput,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "create_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let title = checked_title(&input.title, CONTEXT)?;
        let notes = clean_notes(input.notes.as_deref());
        let due = input
            .due
            .as_deref()
            .map(|raw| parse_todo_due(raw, &Local))
            .transpose()?;
        let remind_at = input.remind_at.as_deref().map(str::trim);
        if let Some(raw) = remind_at {
            future_fire_at(raw, CONTEXT)?;
        }
        let (due_date, due_at) = due.as_ref().map(StoredDue::columns).unwrap_or_default();
        let (in_session, in_run_turn) = match created_in {
            Some((session, turn)) => (Some(session.0), Some(turn)),
            None => (None, None),
        };
        let id = crate::api::todo::mint_todo_id();
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO todos (id, title, notes, due_date, due_at, created_via, \
                created_by_supervisor, created_origin_note, created_in_session_id, \
                created_in_run_turn, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&title)
        .bind(&notes)
        .bind(&due_date)
        .bind(&due_at)
        .bind(origin.via.as_sql())
        .bind(origin.stored_supervisor())
        .bind(origin.reason.as_deref())
        .bind(&in_session)
        .bind(in_run_turn)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        if let Some(raw) = remind_at {
            if let Err(e) = self.set_todo_reminder(&id, &title, raw, &origin).await {
                // Nothing half made: the to-do goes with its reminder.
                let _ = sqlx::query("DELETE FROM todos WHERE id = ?")
                    .bind(&id)
                    .execute(&self.pool)
                    .await;
                return Err(e);
            }
        }
        self.todo(&id).await
    }

    /// Set the to-do's reminder to `raw`, or move it there: its task is
    /// updated when it has one ([`Self::update_scheduled_task_db`], which
    /// arms a fired one-off again), made otherwise.
    async fn set_todo_reminder(
        &self,
        todo_id: &str,
        title: &str,
        raw: &str,
        origin: &Origin,
    ) -> Result<()> {
        match self.todo_reminder_task(todo_id).await? {
            Some(task) => {
                let patch = ScheduledTaskPatch {
                    prompt: Some(title.to_string()),
                    fire_at: Some(raw.to_string()),
                    enabled: Some(true),
                    ..ScheduledTaskPatch::default()
                };
                self.update_scheduled_task_db(task.id, patch, origin.clone())
                    .await?;
            }
            None => {
                let input = CreateScheduledTaskInput {
                    id: mint_scheduled_task_id(),
                    project_id: None,
                    prompt: title.to_string(),
                    repeat: ScheduledTaskRepeat::Once,
                    time_of_day: String::new(),
                    llm_name: None,
                    enabled: true,
                    fire_at: Some(raw.to_string()),
                    target: ScheduleTarget::Assistant,
                };
                // Not made "in a turn": the to-do is, and its card stands
                // for both (ticket 42); the task gets no card of its own.
                let task = self
                    .create_scheduled_task_in(input, origin.clone(), None)
                    .await?;
                sqlx::query("UPDATE scheduled_tasks SET todo_id = ? WHERE id = ?")
                    .bind(todo_id)
                    .bind(task.id.as_str())
                    .execute(&self.pool)
                    .await
                    .map_err(map_sqlx_err)?;
            }
        }
        Ok(())
    }

    /// Cancel the to-do's reminder when ticking off or cancelling the
    /// to-do leaves it with nothing to remind of ([`reminder_unspent`]).
    async fn release_todo_reminder(&self, todo_id: &str) -> Result<()> {
        if let Some(task) = self.todo_reminder_task(todo_id).await? {
            if reminder_unspent(&task) {
                self.cancel_scheduled_task(&task.id).await?;
            }
        }
        Ok(())
    }

    /// Change a to-do: only what `patch` gives. A done one can be renamed
    /// and redated, not given a reminder (untick it first); a cancelled
    /// one is `not_found`, as a cancelled task is. Renaming carries the
    /// new title to the reminder's task (the words its notification shows
    /// should it not reach the assistant).
    ///
    /// **Errors**: `not_found`, `invalid_args`.
    pub async fn update_todo(
        &self,
        id: &TodoId,
        patch: TodoPatch,
        origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "update_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let row = self.live_todo_row(id.as_str()).await?;
        let title = match patch.title.as_deref() {
            Some(raw) => checked_title(raw, CONTEXT)?,
            None => row.title.clone(),
        };
        let notes = match &patch.notes {
            Some(raw) => clean_notes(raw.as_deref()),
            None => row.notes.clone(),
        };
        let (due_date, due_at) = match &patch.due {
            Some(Some(raw)) => parse_todo_due(raw, &Local)?.columns(),
            Some(None) => (None, None),
            None => (row.due_date.clone(), row.due_at.clone()),
        };
        let remind_at = match &patch.remind_at {
            Some(Some(raw)) => {
                if row.done_at.is_some() {
                    return Err(invalid(format!(
                        "{CONTEXT}: todo {id} is done; untick it before giving it a reminder"
                    )));
                }
                let raw = raw.trim().to_string();
                future_fire_at(&raw, CONTEXT)?;
                Some(Some(raw))
            }
            other => other.clone(),
        };
        sqlx::query(
            "UPDATE todos SET title = ?, notes = ?, due_date = ?, due_at = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(&title)
        .bind(&notes)
        .bind(&due_date)
        .bind(&due_at)
        .bind(chrono_now_iso())
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        match remind_at {
            Some(Some(raw)) => {
                self.set_todo_reminder(id.as_str(), &title, &raw, &origin)
                    .await?;
            }
            Some(None) => {
                if let Some(task) = self.todo_reminder_task(id.as_str()).await? {
                    self.cancel_scheduled_task(&task.id).await?;
                }
            }
            None if title != row.title => {
                if let Some(task) = self.todo_reminder_task(id.as_str()).await? {
                    let patch = ScheduledTaskPatch {
                        prompt: Some(title.clone()),
                        ..ScheduledTaskPatch::default()
                    };
                    self.update_scheduled_task_db(task.id, patch, origin.clone())
                        .await?;
                }
            }
            None => {}
        }
        self.todo(id.as_str()).await
    }

    /// Tick a to-do off: when, and who (the user at the desktop, Galley
    /// through the CLI). Its reminder is cancelled while it has not
    /// reached the assistant ([`reminder_unspent`]). Ticking off one
    /// already done changes nothing.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn complete_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "complete_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let row = self.live_todo_row(id.as_str()).await?;
        if row.done_at.is_none() {
            sqlx::query(
                "UPDATE todos SET done_at = ?, done_via = ?, done_by_supervisor = ?, \
                    done_origin_note = ?, updated_at = ? \
                 WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL",
            )
            .bind(chrono_now_iso())
            .bind(origin.via.as_sql())
            .bind(origin.stored_supervisor())
            .bind(origin.reason.as_deref())
            .bind(chrono_now_iso())
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(|e| map_constraint_err(CONTEXT, e))?;
        }
        self.release_todo_reminder(id.as_str()).await?;
        self.todo(id.as_str()).await
    }

    /// Untick a to-do: open again, its done stamps cleared. A reminder
    /// cancelled when it was ticked off stays cancelled (the user asks
    /// Galley for a new one). Unticking an open one changes nothing.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn reopen_todo(&self, id: &TodoId, _origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "reopen_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let row = self.live_todo_row(id.as_str()).await?;
        if row.done_at.is_some() {
            sqlx::query(
                "UPDATE todos SET done_at = NULL, done_via = NULL, done_by_supervisor = NULL, \
                    done_origin_note = NULL, updated_at = ? \
                 WHERE id = ? AND cancelled_at IS NULL",
            )
            .bind(chrono_now_iso())
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(|e| map_constraint_err(CONTEXT, e))?;
        }
        self.todo(id.as_str()).await
    }

    /// Cancel a to-do: a soft delete (the row stays with `cancelledAt`),
    /// its reminder cancelled as when it is ticked off. Gone for every
    /// write: cancelling it again is `not_found`.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn cancel_todo(&self, id: &TodoId, _origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "cancel_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE todos SET cancelled_at = ?, updated_at = ? \
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
            self.todo_row(id.as_str()).await?;
            return Err(gone(id.as_str()));
        }
        self.release_todo_reminder(id.as_str()).await?;
        self.todo(id.as_str()).await
    }

    /// Cancel a to-do's reminder, whatever it stands at, and leave the
    /// to-do as it is (the desktop's 「取消提醒」).
    ///
    /// **Errors**: `not_found` (no such to-do, cancelled, or no reminder),
    /// `invalid_args` (no assistant).
    pub async fn cancel_todo_reminder(&self, id: &TodoId, _origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "cancel_todo_reminder";
        self.ensure_assistant_available(CONTEXT).await?;
        self.live_todo_row(id.as_str()).await?;
        let task =
            self.todo_reminder_task(id.as_str())
                .await?
                .ok_or_else(|| GalleyError::NotFound {
                    message: format!("todo {id} has no reminder"),
                })?;
        self.cancel_scheduled_task(&task.id).await?;
        self.todo(id.as_str()).await
    }

    /// When a run of `session_id` ends: the to-dos Galley noted in that
    /// run get the run's reply turn, as
    /// [`Self::settle_scheduled_created_in`] does for tasks. Returns how
    /// many were settled.
    pub async fn settle_todo_created_in(&self, session_id: &str) -> Result<u64> {
        let res = sqlx::query(
            "UPDATE todos \
             SET created_in_turn_index = ( \
                   SELECT MAX(m.turn_index) FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= todos.created_in_run_turn), \
                 updated_at = ? \
             WHERE created_in_session_id = ? AND created_in_turn_index IS NULL \
               AND created_in_run_turn = ( \
                   SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user') \
               AND EXISTS ( \
                   SELECT 1 FROM messages m \
                   WHERE m.session_id = ? AND m.role = 'assistant' \
                     AND m.visibility = 'visible' \
                     AND m.turn_index >= todos.created_in_run_turn)",
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
}
