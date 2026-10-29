//! To-dos (main chat ticket 39): the record and every write, shared by the
//! desktop's three commands and the CLI (ticket 40). Reminders go through
//! the scheduled-task functions (`db/schedule.rs`, ticket 33). The items
//! under a to-do (ticket 111, `todo_subitems`) are read with it and
//! written here too.

use std::collections::{HashMap, HashSet};

use chrono::Local;

use crate::api::schedule::{
    mint_scheduled_task_id, CreateScheduledTaskInput, ScheduleTarget, ScheduledTaskCreatedIn,
    ScheduledTaskPatch, ScheduledTaskRepeat, ScheduledWake,
};
use crate::api::todo::{
    mint_todo_subitem_id, parse_todo_due, todo_subitem_text, CreateTodoInput, StoredDue, TodoBrief,
    TodoId, TodoPatch, TodoReminder, TodoReminderState, TodoStatus, TodoSubitem, TodoSubitemCount,
    TodoSubitemId,
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
    cancelled_via: Option<String>,
    cancelled_by_supervisor: Option<String>,
    cancelled_origin_note: Option<String>,
    created_via: String,
    created_by_supervisor: Option<String>,
    created_origin_note: Option<String>,
    created_in_session_id: Option<String>,
    created_in_turn_index: Option<i64>,
    created_at: String,
    updated_at: String,
}

const TODO_COLUMNS: &str = "id, title, notes, due_date, due_at, done_at, done_via, \
    done_by_supervisor, done_origin_note, cancelled_at, cancelled_via, cancelled_by_supervisor, \
    cancelled_origin_note, created_via, created_by_supervisor, created_origin_note, \
    created_in_session_id, created_in_turn_index, created_at, updated_at";

/// An item under a to-do (main chat ticket 111, migration 054).
#[derive(Debug, FromRow)]
struct TodoSubitemRow {
    id: String,
    todo_id: String,
    text: String,
    done_at: Option<String>,
    done_via: Option<String>,
    done_by_supervisor: Option<String>,
    done_origin_note: Option<String>,
    created_at: String,
}

const TODO_SUBITEM_COLUMNS: &str = "id, todo_id, text, done_at, done_via, done_by_supervisor, \
    done_origin_note, created_at";

impl TodoSubitemRow {
    fn into_item(self) -> Result<TodoSubitem> {
        let done_by = match self.done_via.as_deref() {
            Some(via) => Some(origin_from_stored(
                via,
                self.done_by_supervisor,
                self.done_origin_note,
            )?),
            None => None,
        };
        Ok(TodoSubitem {
            id: TodoSubitemId(self.id),
            text: self.text,
            done: self.done_at.is_some(),
            done_at: self.done_at,
            done_by,
            created_at: self.created_at,
        })
    }
}

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

    fn into_brief(
        self,
        reminder: Option<TodoReminder>,
        items: Vec<TodoSubitem>,
    ) -> Result<TodoBrief> {
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
        let cancelled_by = match self.cancelled_via.as_deref() {
            Some(via) => Some(origin_from_stored(
                via,
                self.cancelled_by_supervisor,
                self.cancelled_origin_note,
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
            cancelled_by,
            item_count: TodoSubitemCount::of(&items),
            items,
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

/// Items' words as Core keeps them ([`todo_subitem_text`]), every one
/// checked before anything is written: one with no words refuses them all.
fn checked_subitem_texts(raw: &[String], context: &str) -> Result<Vec<String>> {
    raw.iter()
        .map(|text| {
            todo_subitem_text(text)
                .ok_or_else(|| invalid(format!("{context}: an item needs words")))
        })
        .collect()
}

fn subitem_not_found(id: &str) -> GalleyError {
    GalleyError::NotFound {
        message: format!("todo item {id} not found"),
    }
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

    /// One to-do, cancelled or not (`todo show`), with its items.
    ///
    /// **Errors**: `not_found`.
    pub async fn todo(&self, id: &str) -> Result<TodoBrief> {
        let row = self.todo_row(id).await?;
        let reminder = self
            .todo_reminder_task(id)
            .await?
            .as_ref()
            .and_then(reminder_of);
        let items = self
            .todo_subitems(Some(id))
            .await?
            .remove(id)
            .unwrap_or_default();
        row.into_brief(reminder, items)
    }

    /// The items under one to-do (`Some(id)`) or under every one (`None`),
    /// by to-do id, each to-do's in its order (main chat ticket 111). Per
    /// row tolerance, as for the to-dos: one unreadable item must not hide
    /// the others.
    async fn todo_subitems(
        &self,
        todo_id: Option<&str>,
    ) -> Result<HashMap<String, Vec<TodoSubitem>>> {
        let filter = if todo_id.is_some() {
            "WHERE todo_id = ? "
        } else {
            ""
        };
        let sql = format!(
            "SELECT {TODO_SUBITEM_COLUMNS} FROM todo_subitems {filter}\
             ORDER BY todo_id, position, id"
        );
        let mut query = sqlx::query_as::<_, TodoSubitemRow>(&sql);
        if let Some(id) = todo_id {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await.map_err(map_sqlx_err)?;
        let mut by_todo: HashMap<String, Vec<TodoSubitem>> = HashMap::new();
        for row in rows {
            let todo = row.todo_id.clone();
            let id = row.id.clone();
            match row.into_item() {
                Ok(item) => by_todo.entry(todo).or_default().push(item),
                Err(e) => eprintln!("[db] todo item {id} unreadable, skipped: {e:?}"),
            }
        }
        Ok(by_todo)
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
        let mut items = self.todo_subitems(None).await?;
        // Per-row tolerance, as for scheduled tasks: one unreadable row
        // must not hide the others.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = row.id.clone();
                let reminder = reminders.get(&id).and_then(reminder_of);
                row.into_brief(reminder, items.remove(&id).unwrap_or_default())
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
    /// With `items` (main chat ticket 111), the items under it, in that
    /// order, written with it.
    ///
    /// To-dos are the assistant's notebook: refused with
    /// [`crate::api::ASSISTANT_UNAVAILABLE`] unless the managed runtime
    /// is active and has a main chat. A reminder time already past is
    /// refused with [`crate::api::TIME_IN_PAST`] before anything is
    /// written, as is an item with no words.
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
        let items = checked_subitem_texts(&input.items, CONTEXT)?;
        let (due_date, due_at) = due.as_ref().map(StoredDue::columns).unwrap_or_default();
        let (in_session, in_run_turn) = match created_in {
            Some((session, turn)) => (Some(session.0), Some(turn)),
            None => (None, None),
        };
        let id = crate::api::todo::mint_todo_id();
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
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
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        insert_subitems(&mut tx, &id, 0, &items, &now, CONTEXT).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        if let Some(raw) = remind_at {
            if let Err(e) = self.set_todo_reminder(&id, &title, raw, &origin).await {
                // Nothing half made: the to-do goes with its reminder,
                // and its items with it.
                let _ = sqlx::query("DELETE FROM todo_subitems WHERE todo_id = ?")
                    .bind(&id)
                    .execute(&self.pool)
                    .await;
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
    /// Core does it on its own ([`Origin::system`], ticket 61): the user
    /// turned down the to-do, or did it, not the reminder.
    async fn release_todo_reminder(&self, todo_id: &str) -> Result<()> {
        if let Some(task) = self.todo_reminder_task(todo_id).await? {
            if reminder_unspent(&task) {
                self.cancel_scheduled_task(&task.id, &Origin::system())
                    .await?;
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
                // Removing the reminder is the caller's own cancel (ticket
                // 61: `--no-remind` records its `--supervisor` and
                // `--reason`).
                if let Some(task) = self.todo_reminder_task(id.as_str()).await? {
                    self.cancel_scheduled_task(&task.id, &origin).await?;
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

    /// Cancel a to-do: a soft delete (the row stays with `cancelledAt`
    /// and, since ticket 61, who cancelled it and why: `origin`), its
    /// reminder cancelled as when it is ticked off. Gone for every write:
    /// cancelling it again is `not_found`.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn cancel_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "cancel_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let now = chrono_now_iso();
        let res = sqlx::query(
            "UPDATE todos SET cancelled_at = ?, cancelled_via = ?, cancelled_by_supervisor = ?, \
                cancelled_origin_note = ?, updated_at = ? \
             WHERE id = ? AND cancelled_at IS NULL",
        )
        .bind(&now)
        .bind(origin.via.as_sql())
        .bind(origin.stored_supervisor())
        .bind(origin.reason.as_deref())
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
    /// to-do as it is (the desktop's 「取消提醒」). The task records
    /// `origin` as who cancelled it (ticket 61: the desktop's is `gui`).
    ///
    /// **Errors**: `not_found` (no such to-do, cancelled, or no reminder),
    /// `invalid_args` (no assistant).
    pub async fn cancel_todo_reminder(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "cancel_todo_reminder";
        self.ensure_assistant_available(CONTEXT).await?;
        self.live_todo_row(id.as_str()).await?;
        let task =
            self.todo_reminder_task(id.as_str())
                .await?
                .ok_or_else(|| GalleyError::NotFound {
                    message: format!("todo {id} has no reminder"),
                })?;
        self.cancel_scheduled_task(&task.id, &origin).await?;
        self.todo(id.as_str()).await
    }

    // ---------------- items under a to-do (main chat ticket 111) ----------------
    //
    // PRD ruling 157: one level, words and a box, no time. The user adds,
    // ticks, unticks, changes and deletes them on the desktop, Galley through
    // `todo item …`; each write is Core's alone (Rule 5), needs the managed
    // runtime with its main chat as every to-do write does, is refused on a
    // cancelled to-do (`not_found`, as any write on it), and stamps the
    // to-do's `updated_at` (the morning review reads it, ruling 157 point 8).
    // A done to-do's items may be written (as its title may): the panel
    // opens none, Galley may. Nothing here ticks the to-do off or on
    // (point 4). Each returns the to-do as it now stands, items and all.

    /// Add items under a to-do, after the ones there, in this order (the
    /// panel's 「添加一项」, a pasted block of lines; `todo item add`).
    /// `origin` is who asked; nothing records it (who added an item is not
    /// kept, migration 054).
    ///
    /// **Errors**: `not_found` (no such to-do, or cancelled),
    /// `invalid_args` (no items, an item with no words, no assistant).
    pub async fn add_todo_subitems(
        &self,
        todo_id: &TodoId,
        texts: &[String],
        _origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "add_todo_subitems";
        self.ensure_assistant_available(CONTEXT).await?;
        if texts.is_empty() {
            return Err(invalid(format!("{CONTEXT}: give at least one item")));
        }
        let items = checked_subitem_texts(texts, CONTEXT)?;
        self.live_todo_row(todo_id.as_str()).await?;
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let last: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), 0) FROM todo_subitems WHERE todo_id = ?",
        )
        .bind(todo_id.as_str())
        .fetch_one(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        insert_subitems(&mut tx, todo_id.as_str(), last, &items, &now, CONTEXT).await?;
        touch_live_todo(&mut tx, todo_id.as_str(), &now).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        self.todo(todo_id.as_str()).await
    }

    /// Tick an item: when, and who (the user at the desktop, Galley through
    /// the CLI). Ticking one already ticked changes nothing (its `doneBy`
    /// keeps the first tick), and the to-do stays as it is, the last item
    /// ticked or not (ruling 157 point 4).
    ///
    /// **Errors**: `not_found` (no such item, or its to-do cancelled),
    /// `invalid_args` (no assistant).
    pub async fn complete_todo_subitem(
        &self,
        id: &TodoSubitemId,
        origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "complete_todo_subitem";
        self.ensure_assistant_available(CONTEXT).await?;
        let item = self.live_subitem(id.as_str()).await?;
        if !item.done {
            let now = chrono_now_iso();
            let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
            sqlx::query(
                "UPDATE todo_subitems SET done_at = ?, done_via = ?, done_by_supervisor = ?, \
                    done_origin_note = ?, updated_at = ? \
                 WHERE id = ? AND done_at IS NULL",
            )
            .bind(&now)
            .bind(origin.via.as_sql())
            .bind(origin.stored_supervisor())
            .bind(origin.reason.as_deref())
            .bind(&now)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| map_constraint_err(CONTEXT, e))?;
            touch_live_todo(&mut tx, &item.todo_id, &now).await?;
            tx.commit().await.map_err(map_sqlx_err)?;
        }
        self.todo(&item.todo_id).await
    }

    /// Untick an item: its done stamps cleared. Unticking one not ticked
    /// changes nothing.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn reopen_todo_subitem(
        &self,
        id: &TodoSubitemId,
        _origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "reopen_todo_subitem";
        self.ensure_assistant_available(CONTEXT).await?;
        let item = self.live_subitem(id.as_str()).await?;
        if item.done {
            let now = chrono_now_iso();
            let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
            sqlx::query(
                "UPDATE todo_subitems SET done_at = NULL, done_via = NULL, \
                    done_by_supervisor = NULL, done_origin_note = NULL, updated_at = ? \
                 WHERE id = ?",
            )
            .bind(&now)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| map_constraint_err(CONTEXT, e))?;
            touch_live_todo(&mut tx, &item.todo_id, &now).await?;
            tx.commit().await.map_err(map_sqlx_err)?;
        }
        self.todo(&item.todo_id).await
    }

    /// Change an item's words ([`todo_subitem_text`]); ticked or not, it
    /// stays so. The same words change nothing.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no words, no assistant).
    pub async fn update_todo_subitem(
        &self,
        id: &TodoSubitemId,
        text: &str,
        _origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "update_todo_subitem";
        self.ensure_assistant_available(CONTEXT).await?;
        let text = todo_subitem_text(text)
            .ok_or_else(|| invalid(format!("{CONTEXT}: an item needs words")))?;
        let item = self.live_subitem(id.as_str()).await?;
        if item.text != text {
            let now = chrono_now_iso();
            let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
            sqlx::query("UPDATE todo_subitems SET text = ?, updated_at = ? WHERE id = ?")
                .bind(&text)
                .bind(&now)
                .bind(id.as_str())
                .execute(&mut *tx)
                .await
                .map_err(|e| map_constraint_err(CONTEXT, e))?;
            touch_live_todo(&mut tx, &item.todo_id, &now).await?;
            tx.commit().await.map_err(map_sqlx_err)?;
        }
        self.todo(&item.todo_id).await
    }

    /// Move an item to place `to` among its to-do's items (main chat
    /// ticket 112, PRD ruling 158: the panel's drag, `todo item move
    /// --to`): 1 is the first, and a place past the last is the last.
    /// The to-do's items get their positions again, 1, 2, … in their new
    /// order, in one transaction with the stamp of the to-do's
    /// `updated_at` (ruling 157 point 8: every item write moves it) and
    /// the moved item's own. Already there (a drag dropped back where it
    /// started) changes nothing, the stamps included.
    ///
    /// **Errors**: `not_found` (no such item, or its to-do cancelled),
    /// `invalid_args` (`to` below 1, no assistant).
    pub async fn move_todo_subitem(
        &self,
        id: &TodoSubitemId,
        to: i64,
        _origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "move_todo_subitem";
        self.ensure_assistant_available(CONTEXT).await?;
        if to < 1 {
            return Err(invalid(format!("{CONTEXT}: a place counts from 1")));
        }
        let item = self.live_subitem(id.as_str()).await?;
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        // The order every read gives (`todo_subitems`).
        let mut order: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM todo_subitems WHERE todo_id = ? ORDER BY position, id",
        )
        .bind(&item.todo_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        let from = order
            .iter()
            .position(|each| each == id.as_str())
            .ok_or_else(|| subitem_not_found(id.as_str()))?;
        let at = usize::try_from(to - 1)
            .unwrap_or(usize::MAX)
            .min(order.len() - 1);
        if at == from {
            return self.todo(&item.todo_id).await;
        }
        let moved = order.remove(from);
        order.insert(at, moved);
        for (place, each) in order.iter().enumerate() {
            sqlx::query("UPDATE todo_subitems SET position = ? WHERE id = ?")
                .bind(place as i64 + 1)
                .bind(each)
                .execute(&mut *tx)
                .await
                .map_err(|e| map_constraint_err(CONTEXT, e))?;
        }
        sqlx::query("UPDATE todo_subitems SET updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        touch_live_todo(&mut tx, &item.todo_id, &now).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        self.todo(&item.todo_id).await
    }

    /// Delete an item for good (the panel's ×, once its undo toast has
    /// gone; `todo item remove`): nothing keeps a record of it, as nothing
    /// reads one.
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn remove_todo_subitem(
        &self,
        id: &TodoSubitemId,
        _origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "remove_todo_subitem";
        self.ensure_assistant_available(CONTEXT).await?;
        let item = self.live_subitem(id.as_str()).await?;
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query("DELETE FROM todo_subitems WHERE id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        touch_live_todo(&mut tx, &item.todo_id, &now).await?;
        tx.commit().await.map_err(map_sqlx_err)?;
        self.todo(&item.todo_id).await
    }

    /// An item that may be written: there, under a to-do not cancelled.
    async fn live_subitem(&self, id: &str) -> Result<LiveSubitem> {
        let row: Option<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT s.todo_id, s.text, s.done_at, t.cancelled_at \
             FROM todo_subitems s JOIN todos t ON t.id = s.todo_id \
             WHERE s.id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let (todo_id, text, done_at, cancelled_at) = row.ok_or_else(|| subitem_not_found(id))?;
        if cancelled_at.is_some() {
            return Err(gone(&todo_id));
        }
        Ok(LiveSubitem {
            todo_id,
            text,
            done: done_at.is_some(),
        })
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

/// An item about to be written ([`SqliteGalley::live_subitem`]).
struct LiveSubitem {
    todo_id: String,
    text: String,
    done: bool,
}

/// Write `texts` as items under `todo_id`, after `last` (the largest
/// position there), in their order.
async fn insert_subitems(
    tx: &mut Transaction<'_, Sqlite>,
    todo_id: &str,
    last: i64,
    texts: &[String],
    now: &str,
    context: &str,
) -> Result<()> {
    for (at, text) in texts.iter().enumerate() {
        sqlx::query(
            "INSERT INTO todo_subitems (id, todo_id, text, position, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(mint_todo_subitem_id())
        .bind(todo_id)
        .bind(text)
        .bind(last + 1 + at as i64)
        .bind(now)
        .bind(now)
        .execute(&mut **tx)
        .await
        .map_err(|e| map_constraint_err(context, e))?;
    }
    Ok(())
}

/// Stamp a to-do's `updated_at` for a write of its items, inside that
/// write: the to-do moved (main chat PRD ruling 157 point 8). `not_found`,
/// and the write rolls back, when it was cancelled meanwhile.
async fn touch_live_todo(tx: &mut Transaction<'_, Sqlite>, todo_id: &str, now: &str) -> Result<()> {
    let res = sqlx::query("UPDATE todos SET updated_at = ? WHERE id = ? AND cancelled_at IS NULL")
        .bind(now)
        .bind(todo_id)
        .execute(&mut **tx)
        .await
        .map_err(map_sqlx_err)?;
    if res.rows_affected() == 0 {
        return Err(gone(todo_id));
    }
    Ok(())
}
