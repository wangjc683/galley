//! To-dos (main chat ticket 39): the record and every write, shared by the
//! desktop's three commands and the CLI (ticket 40). Reminders go through
//! the scheduled-task functions (`db/schedule.rs`, ticket 33). The items
//! under a to-do (ticket 111, `todo_subitems`) are read with it and
//! written here too, and so are the rules of repeating to-dos (ticket 154,
//! `todo_series`): a period ticked off or skipped makes the next one in
//! the same transaction ([`SqliteGalley::settle_todo`]).

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Utc};

use crate::api::schedule::{
    instant_to_utc_iso, mint_scheduled_task_id, parse_fire_at, CreateScheduledTaskInput,
    ScheduleTarget, ScheduledTaskCreatedIn, ScheduledTaskPatch, ScheduledTaskRepeat, ScheduledWake,
    TIME_IN_PAST,
};
use crate::api::todo::{
    mint_todo_series_id, mint_todo_subitem_id, parse_todo_due, todo_subitem_text, CreateTodoInput,
    StoredDue, TodoBrief, TodoId, TodoPatch, TodoReminder, TodoReminderState, TodoRepeat,
    TodoRepeatKind, TodoRepeatRemind, TodoSettled, TodoStatus, TodoSubitem, TodoSubitemCount,
    TodoSubitemId, NOT_REPEATING, REPEAT_NEEDS_DUE, REPEAT_SUPERVISOR,
};
use crate::todo_by_hand::{when_write, TodoWhenChange, TodoWhenNow};
use crate::todo_repeat::{
    due_time_of_day, hhmm, next_due_day, next_reminder_ahead, parse_hhmm, period_on, remind_offset,
    RemindOffset, RepeatRule,
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
    series_id: Option<String>,
    skipped: i64,
}

const TODO_COLUMNS: &str = "id, title, notes, due_date, due_at, done_at, done_via, \
    done_by_supervisor, done_origin_note, cancelled_at, cancelled_via, cancelled_by_supervisor, \
    cancelled_origin_note, created_via, created_by_supervisor, created_origin_note, \
    created_in_session_id, created_in_turn_index, created_at, updated_at, series_id, skipped";

/// A repeating rule (main chat ticket 154, migration 057): what the next
/// period carries and when it falls.
#[derive(Debug, FromRow)]
struct TodoSeriesRow {
    id: String,
    title: String,
    notes: Option<String>,
    items: Option<String>,
    repeat_kind: String,
    repeat_every: i64,
    repeat_days: Option<String>,
    anchor_date: String,
    time_of_day: Option<String>,
    remind_days_before: Option<i64>,
    remind_time: Option<String>,
    ended_at: Option<String>,
}

const TODO_SERIES_COLUMNS: &str = "id, title, notes, items, repeat_kind, repeat_every, \
    repeat_days, anchor_date, time_of_day, remind_days_before, remind_time, ended_at";

fn series_unreadable(id: &str, what: &str) -> GalleyError {
    GalleyError::Internal {
        message: format!("todo series {id}: bad {what}"),
    }
}

impl TodoSeriesRow {
    fn ended(&self) -> bool {
        self.ended_at.is_some()
    }

    fn rule(&self) -> Result<RepeatRule> {
        let kind = TodoRepeatKind::from_sql(&self.repeat_kind)?;
        let anchor = NaiveDate::parse_from_str(&self.anchor_date, "%Y-%m-%d")
            .map_err(|_| series_unreadable(&self.id, "anchor_date"))?;
        let every = u32::try_from(self.repeat_every)
            .ok()
            .filter(|every| *every >= 1)
            .ok_or_else(|| series_unreadable(&self.id, "repeat_every"))?;
        let days = self
            .repeat_days
            .as_deref()
            .unwrap_or("")
            .split(',')
            .filter(|cell| !cell.is_empty())
            .map(|cell| cell.parse::<u8>())
            .collect::<std::result::Result<Vec<u8>, _>>()
            .map_err(|_| series_unreadable(&self.id, "repeat_days"))?;
        Ok(RepeatRule {
            kind,
            every,
            days,
            anchor,
        })
    }

    fn time_of_day(&self) -> Option<NaiveTime> {
        self.time_of_day.as_deref().and_then(parse_hhmm)
    }

    fn remind(&self) -> Option<RemindOffset> {
        match (
            self.remind_days_before,
            self.remind_time.as_deref().and_then(parse_hhmm),
        ) {
            (Some(days_before), Some(time)) => Some(RemindOffset { days_before, time }),
            _ => None,
        }
    }

    /// The items' words the next period gets, each as Core keeps an
    /// item's ([`todo_subitem_text`]). A list that does not read (Core
    /// never writes one) is none: the period beats no period.
    fn items(&self) -> Vec<String> {
        let Some(raw) = self.items.as_deref() else {
            return Vec::new();
        };
        match serde_json::from_str::<Vec<String>>(raw) {
            Ok(texts) => texts
                .iter()
                .filter_map(|text| todo_subitem_text(text))
                .collect(),
            Err(e) => {
                eprintln!(
                    "[db] todo series {} items unreadable, left out: {e}",
                    self.id
                );
                Vec::new()
            }
        }
    }

    /// `Todo.repeat`: the rule while it has not ended. One that does not
    /// read (Core never writes one) is logged and left out, as an
    /// unreadable row is: the to-do still shows.
    fn wire(&self) -> Option<TodoRepeat> {
        if self.ended() {
            return None;
        }
        let rule = match self.rule() {
            Ok(rule) => rule,
            Err(e) => {
                eprintln!("[db] todo series {} unreadable, left out: {e:?}", self.id);
                return None;
            }
        };
        let remind = match (self.remind_days_before, self.remind_time.clone()) {
            (Some(days_before), Some(time)) => Some(TodoRepeatRemind { days_before, time }),
            _ => None,
        };
        Some(TodoRepeat {
            rule: rule.given(),
            remind,
        })
    }
}

/// One rule, ended or not; `None` when there is no such row.
async fn fetch_series<'e, E>(executor: E, id: &str) -> Result<Option<TodoSeriesRow>>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    let sql = format!("SELECT {TODO_SERIES_COLUMNS} FROM todo_series WHERE id = ?");
    sqlx::query_as::<_, TodoSeriesRow>(&sql)
        .bind(id)
        .fetch_optional(executor)
        .await
        .map_err(map_sqlx_err)
}

/// A rule being made: the rule, the due time its periods carry, and the
/// offset of their reminder.
struct NewSeries {
    rule: RepeatRule,
    time_of_day: Option<NaiveTime>,
    remind: Option<RemindOffset>,
}

impl NewSeries {
    /// The rule `rule` for a to-do due `due` with its reminder at
    /// `remind_at`, read in `tz`.
    fn of<Tz: TimeZone>(
        rule: RepeatRule,
        due: &StoredDue,
        remind_at: Option<DateTime<Utc>>,
        tz: &Tz,
    ) -> Self {
        Self {
            rule,
            time_of_day: due_time_of_day(due, tz),
            remind: remind_at.map(|at| remind_offset(due, at, tz)),
        }
    }
}

/// A period [`SqliteGalley::settle_todo`] made: its id, its title (its
/// reminder's words), and when its reminder goes off.
struct MadePeriod {
    id: String,
    title: String,
    remind_at: Option<DateTime<Utc>>,
}

/// An open period of a rule with a reminder
/// ([`SqliteGalley::rearm_unsettled_period_reminders`]).
#[derive(Debug, FromRow)]
struct UnsettledPeriod {
    id: String,
    title: String,
    due_date: Option<String>,
    due_at: Option<String>,
    series_id: String,
}

/// Who made a period (main chat ticket 154): Core, from its rule.
fn repeat_origin() -> Origin {
    Origin {
        via: OriginVia::System,
        supervisor: Some(REPEAT_SUPERVISOR.into()),
        reason: None,
        client: None,
    }
}

fn days_csv(days: &[u8]) -> Option<String> {
    (!days.is_empty()).then(|| days.iter().map(u8::to_string).collect::<Vec<_>>().join(","))
}

fn items_json(items: &[String]) -> Option<String> {
    (!items.is_empty()).then(|| serde_json::to_string(items).unwrap_or_else(|_| "[]".into()))
}

fn repeat_needs_due(context: &str) -> GalleyError {
    invalid(format!(
        "{REPEAT_NEEDS_DUE}: {context}: a repeating to-do needs a due date (--due)"
    ))
}

fn not_repeating(context: &str, id: &str) -> GalleyError {
    invalid(format!(
        "{NOT_REPEATING}: {context}: todo {id} does not repeat (it has no rule, or its rule ended)"
    ))
}

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
        repeat: Option<TodoRepeat>,
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
            repeat,
            series_id: self.series_id,
            skipped: self.skipped != 0,
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
        let repeat = match row.series_id.as_deref() {
            Some(series) => fetch_series(&self.pool, series)
                .await?
                .and_then(|series| series.wire()),
            None => None,
        };
        row.into_brief(reminder, items, repeat)
    }

    /// Every rule, by id (main chat ticket 154).
    async fn todo_series_all(&self) -> Result<HashMap<String, TodoSeriesRow>> {
        let sql = format!("SELECT {TODO_SERIES_COLUMNS} FROM todo_series");
        let rows = sqlx::query_as::<_, TodoSeriesRow>(&sql)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(rows.into_iter().map(|row| (row.id.clone(), row)).collect())
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
        let series = self.todo_series_all().await?;
        // Per-row tolerance, as for scheduled tasks: one unreadable row
        // must not hide the others.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = row.id.clone();
                let reminder = reminders.get(&id).and_then(reminder_of);
                let repeat = row
                    .series_id
                    .as_ref()
                    .and_then(|series_id| series.get(series_id))
                    .and_then(TodoSeriesRow::wire);
                row.into_brief(reminder, items.remove(&id).unwrap_or_default(), repeat)
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
    /// order, written with it. With `repeat` (main chat ticket 154 point
    /// 1), a rule written with it, the to-do its first period: due on the
    /// day given (the rule's anchor, whether or not the rule falls on it),
    /// the rule carrying its title, notes and items as they are now, its
    /// due time, and its reminder as days before the due day and a time
    /// of day.
    ///
    /// To-dos are the assistant's notebook: refused with
    /// [`crate::api::ASSISTANT_UNAVAILABLE`] unless the managed runtime
    /// is active and has a main chat. A reminder time already past is
    /// refused with [`crate::api::TIME_IN_PAST`] before anything is
    /// written, as is an item with no words, a rule that does not check
    /// ([`RepeatRule::checked`]) and a rule with no due date
    /// ([`REPEAT_NEEDS_DUE`]).
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
        let remind_instant = match remind_at {
            Some(raw) => {
                future_fire_at(raw, CONTEXT)?;
                Some(parse_fire_at(raw, &Local)?)
            }
            None => None,
        };
        let items = checked_subitem_texts(&input.items, CONTEXT)?;
        let series = match &input.repeat {
            Some(given) => {
                let due = due.as_ref().ok_or_else(|| repeat_needs_due(CONTEXT))?;
                let rule = RepeatRule::checked(given, due.local_date(&Local), CONTEXT)?;
                Some(NewSeries::of(rule, due, remind_instant, &Local))
            }
            None => None,
        };
        let (due_date, due_at) = due.as_ref().map(StoredDue::columns).unwrap_or_default();
        let (in_session, in_run_turn) = match created_in {
            Some((session, turn)) => (Some(session.0), Some(turn)),
            None => (None, None),
        };
        let id = crate::api::todo::mint_todo_id();
        let series_id = series.as_ref().map(|_| mint_todo_series_id());
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        if let (Some(series_id), Some(series)) = (&series_id, &series) {
            insert_series(
                &mut tx,
                series_id,
                &title,
                notes.as_deref(),
                &items,
                series,
                &origin,
                &now,
                CONTEXT,
            )
            .await?;
        }
        sqlx::query(
            "INSERT INTO todos (id, title, notes, due_date, due_at, created_via, \
                created_by_supervisor, created_origin_note, created_in_session_id, \
                created_in_run_turn, series_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        .bind(&series_id)
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
                // and its items and its rule with it.
                let _ = sqlx::query("DELETE FROM todo_subitems WHERE todo_id = ?")
                    .bind(&id)
                    .execute(&self.pool)
                    .await;
                let _ = sqlx::query("DELETE FROM todos WHERE id = ?")
                    .bind(&id)
                    .execute(&self.pool)
                    .await;
                if let Some(series_id) = &series_id {
                    let _ = sqlx::query("DELETE FROM todo_series WHERE id = ?")
                        .bind(series_id)
                        .execute(&self.pool)
                        .await;
                }
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
    /// Repeating to-dos (main chat ticket 154): every change above is the
    /// period's alone, the rule stays as it was (point 7). `repeat` gives
    /// one that does not repeat a rule, as `todo add` does (point 8: due
    /// on its due date, which it needs, [`REPEAT_NEEDS_DUE`]; refused on a
    /// done one, untick it first), and changes the kind, days and every of
    /// one that does, counted from its due date from now on.
    /// `no_repeat` ends its rule, the period left an ordinary to-do
    /// (point 5). `series` takes the period as it stands after this
    /// change into its rule: title, items' words, the reminder's offset
    /// from the due day (none, none), the due time; its notes only when
    /// this patch gives notes, and the anchor only when it gives a due
    /// date. A repeating period's due date cannot be taken away
    /// (`REPEAT_NEEDS_DUE`, point 9); `series` and `no_repeat` on one that
    /// does not repeat are [`NOT_REPEATING`]. Everything is checked before
    /// anything is written; the period and its rule are written in one
    /// transaction, its reminder after it.
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
        let series = match row.series_id.as_deref() {
            Some(series) => fetch_series(&self.pool, series).await?,
            None => None,
        }
        .filter(|series| !series.ended());
        if patch.no_repeat && (patch.repeat.is_some() || patch.series) {
            return Err(invalid(format!(
                "{CONTEXT}: ending the rule (noRepeat) takes no new rule and no series"
            )));
        }
        if (patch.no_repeat || (patch.series && patch.repeat.is_none())) && series.is_none() {
            return Err(not_repeating(CONTEXT, id.as_str()));
        }
        if patch.series && row.done_at.is_some() {
            // Ticking it off let its reminder go: taken into the rule, that
            // would read as "no reminder" and clear the rule's.
            return Err(invalid(format!(
                "{CONTEXT}: todo {id} is done; take the open period into the rule, or untick \
                 this one first"
            )));
        }
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
        // Ticket 154: what repeats once this change is made.
        let due = StoredDue::from_columns(due_date.as_deref(), due_at.as_deref())?;
        let repeats = !patch.no_repeat && (patch.repeat.is_some() || series.is_some());
        let rule = match (&patch.repeat, &due) {
            (_, None) if repeats => return Err(repeat_needs_due(CONTEXT)),
            (Some(_), _) if series.is_none() && row.done_at.is_some() => {
                return Err(invalid(format!(
                    "{CONTEXT}: todo {id} is done; untick it before making it repeat"
                )));
            }
            (Some(given), Some(due)) => {
                Some(RepeatRule::checked(given, due.local_date(&Local), CONTEXT)?)
            }
            _ => None,
        };
        // The reminder once this change is made: the rule keeps its
        // offset from the due day.
        let reminder_after: Option<DateTime<Utc>> = match &remind_at {
            Some(Some(raw)) => Some(parse_fire_at(raw, &Local)?),
            Some(None) => None,
            None if rule.is_some() || patch.series => self
                .todo_reminder_task(id.as_str())
                .await?
                .as_ref()
                .and_then(reminder_of)
                .and_then(|reminder| DateTime::parse_from_rfc3339(&reminder.at).ok())
                .map(|at| at.with_timezone(&Utc)),
            None => None,
        };
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query(
            "UPDATE todos SET title = ?, notes = ?, due_date = ?, due_at = ?, updated_at = ? \
             WHERE id = ?",
        )
        .bind(&title)
        .bind(&notes)
        .bind(&due_date)
        .bind(&due_at)
        .bind(&now)
        .bind(id.as_str())
        .execute(&mut *tx)
        .await
        .map_err(|e| map_constraint_err(CONTEXT, e))?;
        let mut series_id = series.as_ref().map(|series| series.id.clone());
        if patch.no_repeat {
            if let Some(series_id) = &series_id {
                end_series(&mut tx, series_id, &origin, &now).await?;
            }
        } else if let (Some(rule), Some(due)) = (rule, &due) {
            match &series_id {
                None => {
                    // Point 8, as `todo add` makes one (point 1).
                    let items = subitem_texts_in(&mut tx, id.as_str()).await?;
                    let new = mint_todo_series_id();
                    insert_series(
                        &mut tx,
                        &new,
                        &title,
                        notes.as_deref(),
                        &items,
                        &NewSeries::of(rule, due, reminder_after, &Local),
                        &origin,
                        &now,
                        CONTEXT,
                    )
                    .await?;
                    sqlx::query("UPDATE todos SET series_id = ? WHERE id = ?")
                        .bind(&new)
                        .bind(id.as_str())
                        .execute(&mut *tx)
                        .await
                        .map_err(map_sqlx_err)?;
                    series_id = Some(new);
                }
                Some(series_id) => {
                    // Point 8: a new rule, counted from this period's day;
                    // the rest of what it carries stays.
                    sqlx::query(
                        "UPDATE todo_series SET repeat_kind = ?, repeat_every = ?, \
                            repeat_days = ?, anchor_date = ?, updated_at = ? \
                         WHERE id = ?",
                    )
                    .bind(rule.kind.as_sql())
                    .bind(i64::from(rule.every))
                    .bind(days_csv(&rule.days))
                    .bind(rule.anchor.format("%Y-%m-%d").to_string())
                    .bind(&now)
                    .bind(series_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| map_constraint_err(CONTEXT, e))?;
                }
            }
        }
        if patch.series {
            if let (Some(series_id), Some(due)) = (&series_id, &due) {
                // Point 7: the rule takes the period as it now stands.
                let items = subitem_texts_in(&mut tx, id.as_str()).await?;
                let remind = reminder_after.map(|at| remind_offset(due, at, &Local));
                let mut sql = String::from(
                    "UPDATE todo_series SET title = ?, items = ?, time_of_day = ?, \
                        remind_days_before = ?, remind_time = ?, updated_at = ?",
                );
                if patch.notes.is_some() {
                    sql.push_str(", notes = ?");
                }
                if matches!(patch.due, Some(Some(_))) {
                    sql.push_str(", anchor_date = ?");
                }
                sql.push_str(" WHERE id = ?");
                let mut query = sqlx::query(&sql)
                    .bind(&title)
                    .bind(items_json(&items))
                    .bind(due_time_of_day(due, &Local).map(hhmm))
                    .bind(remind.map(|offset| offset.days_before))
                    .bind(remind.map(|offset| hhmm(offset.time)))
                    .bind(&now);
                if patch.notes.is_some() {
                    query = query.bind(&notes);
                }
                if matches!(patch.due, Some(Some(_))) {
                    query = query.bind(due.local_date(&Local).format("%Y-%m-%d").to_string());
                }
                query
                    .bind(series_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| map_constraint_err(CONTEXT, e))?;
            }
        }
        tx.commit().await.map_err(map_sqlx_err)?;
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

    /// The desktop's change of a to-do (main chat ticket 156, PRD ruling
    /// 205): its title and notes (`words`, [`TodoPatch::words`]), and its
    /// due date, reminder and rule as picked in the to-do panel's date
    /// popover (`when`). [`crate::todo_by_hand::when_write`] works out what
    /// that writes from the to-do as read once here, before anything is
    /// written: the reminder moves with the due day, a reminder whose time
    /// has passed is not hung (a repeating period's goes to the next time
    /// still ahead). One [`Self::update_todo`] then writes it all — the
    /// to-do and its rule in one transaction, its reminder's task right
    /// after, as `todo update --due --remind-at` does — and a reminder
    /// that is not hung is let go after it, as Core's own
    /// ([`Origin::system`]): the user did not turn it down. Every refusal
    /// comes before the first write. A reminder time that passes between
    /// working it out and `update_todo` checking it (`time_in_past:`) is
    /// worked out once more from the same reading. With no `when`, the
    /// title-and-notes change of ticket 107, unchanged.
    ///
    /// **Errors**: `update_todo`'s; `invalid_args` for a reminder days
    /// before a due date when there is none.
    pub async fn update_todo_by_hand(
        &self,
        id: &TodoId,
        words: TodoPatch,
        when: TodoWhenChange,
        origin: Origin,
    ) -> Result<TodoBrief> {
        const CONTEXT: &str = "update_todo";
        if when.is_empty() {
            return self.update_todo(id, words, origin).await;
        }
        self.ensure_assistant_available(CONTEXT).await?;
        let row = self.live_todo_row(id.as_str()).await?;
        let reminder = self
            .todo_reminder_task(id.as_str())
            .await?
            .as_ref()
            .and_then(reminder_of)
            .and_then(|reminder| DateTime::parse_from_rfc3339(&reminder.at).ok())
            .map(|at| at.with_timezone(&Utc));
        let rule = match row.series_id.as_deref() {
            Some(series) => fetch_series(&self.pool, series)
                .await?
                .filter(|series| !series.ended())
                .and_then(|series| series.rule().ok()),
            None => None,
        };
        let before = TodoWhenNow {
            due: StoredDue::from_columns(row.due_date.as_deref(), row.due_at.as_deref())?,
            reminder,
            rule,
        };
        let mut tries = 0;
        loop {
            tries += 1;
            let write = when_write(&when, &before, Utc::now(), &Local, CONTEXT)?;
            let patch = TodoPatch {
                due: write.due,
                remind_at: write.remind_at,
                repeat: write.repeat,
                ..words.clone()
            };
            match self.update_todo(id, patch, origin.clone()).await {
                Err(GalleyError::InvalidArgs { message })
                    if tries == 1 && message.starts_with(TIME_IN_PAST) => {}
                Err(e) => return Err(e),
                Ok(brief) => {
                    if !write.let_reminder_go {
                        return Ok(brief);
                    }
                    if let Some(task) = self.todo_reminder_task(id.as_str()).await? {
                        self.cancel_scheduled_task(&task.id, &Origin::system())
                            .await?;
                    }
                    return self.todo(id.as_str()).await;
                }
            }
        }
    }

    /// Tick a to-do off: when, and who (the user at the desktop, Galley
    /// through the CLI). Its reminder is cancelled while it has not
    /// reached the assistant ([`reminder_unspent`]). Ticking off one
    /// already done changes nothing. A period of a rule makes the next one
    /// ([`Self::complete_todo_with_next`], which says which).
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn complete_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        Ok(self.complete_todo_with_next(id, origin).await?.todo)
    }

    /// [`Self::complete_todo`], with the next period of the to-do's rule
    /// when ticking it off made one (`todo done`'s `next`).
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn complete_todo_with_next(
        &self,
        id: &TodoId,
        origin: Origin,
    ) -> Result<TodoSettled> {
        self.settle_todo(id, origin, Settle::Done, Utc::now(), &Local)
            .await
    }

    /// Skip a period of a rule (main chat ticket 154 point 3, `todo skip`,
    /// the desktop's 「跳过这一次」): a soft delete as [`Self::cancel_todo`]
    /// records it (who, and why: `origin`), marked skipped, its reminder
    /// let go as a cancel lets it go; then the next period, as a tick
    /// makes it. [`NOT_REPEATING`] for a to-do with no rule or one whose
    /// rule ended; a done period is refused (untick it first).
    ///
    /// **Errors**: `not_found` (no such to-do, or cancelled),
    /// `invalid_args`.
    pub async fn skip_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoSettled> {
        self.settle_todo(id, origin, Settle::Skip, Utc::now(), &Local)
            .await
    }

    /// Settle a to-do — tick it off or skip it — and, when it is a period
    /// of a rule that has not ended and no other period of it is still
    /// open, make the next period in the same transaction (main chat
    /// ticket 154 point 2): due on the rule's first day after the later of
    /// today in `tz` and every period's due day so far
    /// ([`next_due_day`]); carrying the rule's title, notes and items (all
    /// unticked); made by Core ([`REPEAT_SUPERVISOR`], `system`), in no
    /// turn; `created_at` and `updated_at` one instant, `now`. The
    /// settling and the next period are one transaction: a failure leaves
    /// neither. Then, outside it, the settled one's reminder is let go
    /// ([`Self::release_todo_reminder`]) and the next one's is hung
    /// through [`Self::set_todo_reminder`] at the rule's offset — none when
    /// that time has passed, and a failure there is logged, not returned:
    /// the period stands without it.
    async fn settle_todo<Tz: TimeZone>(
        &self,
        id: &TodoId,
        origin: Origin,
        how: Settle,
        now: DateTime<Utc>,
        tz: &Tz,
    ) -> Result<TodoSettled> {
        let context = how.context();
        self.ensure_assistant_available(context).await?;
        let row = self.live_todo_row(id.as_str()).await?;
        if how == Settle::Skip {
            let series = match row.series_id.as_deref() {
                Some(series) => fetch_series(&self.pool, series).await?,
                None => None,
            };
            if series.map_or(true, |series| series.ended()) {
                return Err(not_repeating(context, id.as_str()));
            }
            if row.done_at.is_some() {
                return Err(invalid(format!(
                    "{context}: todo {id} is done; untick it before skipping it"
                )));
            }
        }
        let stamp = instant_to_utc_iso(&now);
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        let sql = match how {
            Settle::Done => {
                "UPDATE todos SET done_at = ?, done_via = ?, done_by_supervisor = ?, \
                    done_origin_note = ?, updated_at = ? \
                 WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL"
            }
            Settle::Skip => {
                "UPDATE todos SET cancelled_at = ?, cancelled_via = ?, \
                    cancelled_by_supervisor = ?, cancelled_origin_note = ?, skipped = 1, \
                    updated_at = ? \
                 WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL"
            }
        };
        let settled = sqlx::query(sql)
            .bind(&stamp)
            .bind(origin.via.as_sql())
            .bind(origin.stored_supervisor())
            .bind(origin.reason.as_deref())
            .bind(&stamp)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| map_constraint_err(context, e))?
            .rows_affected()
            > 0;
        if !settled && how == Settle::Skip {
            // Ticked off or deleted since it was read: say which.
            tx.rollback().await.map_err(map_sqlx_err)?;
            let row = self.live_todo_row(id.as_str()).await?;
            return Err(invalid(format!(
                "{context}: todo {} is done; untick it before skipping it",
                row.id
            )));
        }
        let made = match (&row.series_id, settled) {
            (Some(series_id), true) => {
                match make_next_period(&mut tx, id.as_str(), series_id, now, tz, context).await {
                    Ok(made) => made,
                    Err(e) => {
                        // Neither the settling nor the next period.
                        let _ = tx.rollback().await;
                        return Err(e);
                    }
                }
            }
            _ => None,
        };
        tx.commit().await.map_err(map_sqlx_err)?;
        self.release_todo_reminder(id.as_str()).await?;
        if let Some(made) = &made {
            self.hang_period_reminder(made, now).await;
        }
        let todo = self.todo(id.as_str()).await?;
        let next = match &made {
            Some(made) => Some(self.todo(&made.id).await?),
            None => None,
        };
        Ok(TodoSettled { todo, next })
    }

    /// The reminder of a period Core made (main chat ticket 154 point 2),
    /// as Galley's are made ([`Self::set_todo_reminder`]), recorded as
    /// Core's ([`REPEAT_SUPERVISOR`]). None when its time is not after
    /// `now`, and none, logged, when it cannot be made: the period stands.
    /// `true` when it was made. It writes the reminder's task alone: the
    /// period's `updated_at` stays its `created_at`, which the morning
    /// review reads as "not moved" ([`crate::assistant_todo`]).
    async fn hang_period_reminder(&self, made: &MadePeriod, now: DateTime<Utc>) -> bool {
        let Some(at) = made.remind_at else {
            return false;
        };
        if at <= now {
            return false;
        }
        let raw = instant_to_utc_iso(&at);
        match self
            .set_todo_reminder(&made.id, &made.title, &raw, &repeat_origin())
            .await
        {
            Ok(()) => true,
            Err(GalleyError::InvalidArgs { message }) if message.starts_with(TIME_IN_PAST) => false,
            Err(e) => {
                eprintln!(
                    "[db] todo {}: the reminder of the period was not made: {e:?}",
                    made.id
                );
                false
            }
        }
    }

    /// Remind again of the periods left unsettled (main chat ticket 154
    /// behaviour 13): a period's reminder goes off once, and the next
    /// period comes only when this one is settled, so a weekly report
    /// handed in but not ticked off, or one day of a daily to-do missed,
    /// would never ring again. For each period still open of a rule that
    /// has not ended and carries a reminder:
    ///
    /// - Its own reminder task still there (not cancelled), enabled, a
    ///   one-off that went off for its time and whose wake reached an
    ///   outcome — delivered to the assistant, or turned into a system
    ///   notification: that same task is armed again
    ///   ([`Self::update_scheduled_task_db`], its `fireAt`) at the first
    ///   reminder time still after `now` of the rule's days after the
    ///   period's own due day ([`next_reminder_ahead`]).
    /// - No reminder task with its `todo_id` at all, cancelled ones
    ///   counted (the period was made after its reminder time had passed,
    ///   or Core stopped between making it and hanging its reminder): one
    ///   is hung as a settled period's next gets its own
    ///   ([`Self::hang_period_reminder`]), at the period's own reminder
    ///   time when it is still ahead, else the first of the rule's later
    ///   days'.
    ///
    /// The period itself stays as it is (its due date, overdue); no row of
    /// it is made. Nothing else is touched: a period settled or deleted, a
    /// rule ended, a reminder the user or Galley removed (its task
    /// cancelled, a tick's release followed by an untick included: none
    /// is made again; the next period still gets its own), one paused,
    /// one not gone off yet, and one whose wake is still pending. A
    /// function of what the database holds at `now`: run twice, the second
    /// does nothing (a task armed again has not gone off for its new time;
    /// a task hung is a row). The scheduler runs it on every tick
    /// ([`crate::scheduler::rearm_unsettled_periods`]). Returns how many
    /// reminders it armed or hung; a period whose reminder cannot be is
    /// logged and skipped.
    pub async fn rearm_unsettled_period_reminders<Tz: TimeZone>(
        &self,
        now: DateTime<Utc>,
        tz: &Tz,
    ) -> Result<u32> {
        let rows: Vec<UnsettledPeriod> = sqlx::query_as(
            "SELECT t.id, t.title, t.due_date, t.due_at, t.series_id FROM todos t \
             JOIN todo_series s ON s.id = t.series_id \
             WHERE t.done_at IS NULL AND t.cancelled_at IS NULL AND s.ended_at IS NULL \
               AND s.remind_days_before IS NOT NULL AND s.remind_time IS NOT NULL \
             ORDER BY t.created_at, t.id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let mut armed = 0;
        for period in rows {
            match self.remind_unsettled_period(&period, now, tz).await {
                Ok(true) => armed += 1,
                Ok(false) => {}
                Err(e) => eprintln!(
                    "[db] todo {}: reminding again of the unsettled period failed: {e:?}",
                    period.id
                ),
            }
        }
        Ok(armed)
    }

    /// One period of [`Self::rearm_unsettled_period_reminders`]: `true`
    /// when its reminder was armed again or hung.
    async fn remind_unsettled_period<Tz: TimeZone>(
        &self,
        period: &UnsettledPeriod,
        now: DateTime<Utc>,
        tz: &Tz,
    ) -> Result<bool> {
        let Some(series) = fetch_series(&self.pool, &period.series_id).await? else {
            return Ok(false);
        };
        let Some(remind) = series.remind() else {
            return Ok(false);
        };
        if series.ended() {
            return Ok(false);
        }
        let rule = series.rule()?;
        let due_day =
            StoredDue::from_columns(period.due_date.as_deref(), period.due_at.as_deref())?
                .map(|due| due.local_date(tz))
                .unwrap_or_else(|| now.with_timezone(tz).date_naive());
        let tasks: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM scheduled_tasks WHERE todo_id = ?")
                .bind(&period.id)
                .fetch_one(&self.pool)
                .await
                .map_err(map_sqlx_err)?;
        if tasks == 0 {
            // Never hung: its own time first.
            let remind_at =
                next_reminder_ahead(&rule, due_day, series.time_of_day(), remind, true, now, tz);
            let made = MadePeriod {
                id: period.id.clone(),
                title: period.title.clone(),
                remind_at,
            };
            return Ok(self.hang_period_reminder(&made, now).await);
        }
        // Removed on purpose (all its tasks cancelled): nothing.
        let Some(task) = self.todo_reminder_task(&period.id).await? else {
            return Ok(false);
        };
        let spent = task.repeat.is_once()
            && task.enabled
            && task.once_fired()
            && matches!(
                task.last_wake,
                Some(ScheduledWake::Delivered | ScheduledWake::Notified)
            );
        if !spent {
            return Ok(false);
        }
        let Some(at) =
            next_reminder_ahead(&rule, due_day, series.time_of_day(), remind, false, now, tz)
        else {
            return Ok(false);
        };
        let patch = ScheduledTaskPatch {
            fire_at: Some(instant_to_utc_iso(&at)),
            ..ScheduledTaskPatch::default()
        };
        self.update_scheduled_task_db(task.id, patch, repeat_origin())
            .await?;
        Ok(true)
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
    /// cancelling it again is `not_found`. A period of a rule ends the
    /// rule with it, recorded with the same `origin`, and makes no next
    /// period (main chat ticket 154 point 4): deleting is "neither this
    /// one nor the rule".
    ///
    /// **Errors**: `not_found`, `invalid_args` (no assistant).
    pub async fn cancel_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        const CONTEXT: &str = "cancel_todo";
        self.ensure_assistant_available(CONTEXT).await?;
        let now = chrono_now_iso();
        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
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
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            // Either no such row or cancelled before; say which.
            tx.rollback().await.map_err(map_sqlx_err)?;
            self.todo_row(id.as_str()).await?;
            return Err(gone(id.as_str()));
        }
        let series: Option<String> = sqlx::query_scalar("SELECT series_id FROM todos WHERE id = ?")
            .bind(id.as_str())
            .fetch_one(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        if let Some(series) = series {
            end_series(&mut tx, &series, &origin, &now).await?;
        }
        tx.commit().await.map_err(map_sqlx_err)?;
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
                   SELECT MAX(turn_index) FROM messages WHERE session_id = ? AND role = 'user' AND sequence = 0) \
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

/// How a to-do is settled ([`SqliteGalley::settle_todo`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Settle {
    /// Ticked off (`todo done`, the desktop's tick).
    Done,
    /// Skipped (`todo skip`, 「跳过这一次」).
    Skip,
}

impl Settle {
    fn context(self) -> &'static str {
        match self {
            Self::Done => "complete_todo",
            Self::Skip => "skip_todo",
        }
    }
}

/// Write a new rule (main chat ticket 154): what the next period carries
/// (`title`, `notes`, `items`), the rule, its due time and reminder
/// offset, and who made it.
#[allow(clippy::too_many_arguments)]
async fn insert_series(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    title: &str,
    notes: Option<&str>,
    items: &[String],
    series: &NewSeries,
    origin: &Origin,
    now: &str,
    context: &str,
) -> Result<()> {
    let rule = &series.rule;
    sqlx::query(
        "INSERT INTO todo_series (id, title, notes, items, repeat_kind, repeat_every, \
            repeat_days, anchor_date, time_of_day, remind_days_before, remind_time, \
            created_via, created_by_supervisor, created_origin_note, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(notes)
    .bind(items_json(items))
    .bind(rule.kind.as_sql())
    .bind(i64::from(rule.every))
    .bind(days_csv(&rule.days))
    .bind(rule.anchor.format("%Y-%m-%d").to_string())
    .bind(series.time_of_day.map(hhmm))
    .bind(series.remind.map(|offset| offset.days_before))
    .bind(series.remind.map(|offset| hhmm(offset.time)))
    .bind(origin.via.as_sql())
    .bind(origin.stored_supervisor())
    .bind(origin.reason.as_deref())
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|e| map_constraint_err(context, e))?;
    Ok(())
}

/// End a rule, recording who ended it (main chat ticket 154 points 4
/// and 5). One already ended stays as it was.
async fn end_series(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    origin: &Origin,
    now: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE todo_series SET ended_at = ?, ended_via = ?, ended_by_supervisor = ?, \
            ended_origin_note = ?, updated_at = ? \
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(now)
    .bind(origin.via.as_sql())
    .bind(origin.stored_supervisor())
    .bind(origin.reason.as_deref())
    .bind(now)
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(map_sqlx_err)?;
    Ok(())
}

/// The words of a to-do's items, in their order (what a rule carries).
async fn subitem_texts_in(tx: &mut Transaction<'_, Sqlite>, todo_id: &str) -> Result<Vec<String>> {
    sqlx::query_scalar("SELECT text FROM todo_subitems WHERE todo_id = ? ORDER BY position, id")
        .bind(todo_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(map_sqlx_err)
}

/// Inside the transaction that settled `settled`, a period of
/// `series_id`: make the next period when the rule has not ended and no
/// other period of it is still open ([`SqliteGalley::settle_todo`]).
async fn make_next_period<Tz: TimeZone>(
    tx: &mut Transaction<'_, Sqlite>,
    settled: &str,
    series_id: &str,
    now: DateTime<Utc>,
    tz: &Tz,
    context: &str,
) -> Result<Option<MadePeriod>> {
    let Some(series) = fetch_series(&mut **tx, series_id).await? else {
        return Ok(None);
    };
    if series.ended() {
        return Ok(None);
    }
    // Point 6: unticked after the next one was made, two may be open at
    // once; the next comes when both are settled.
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM todos \
         WHERE series_id = ? AND id != ? AND done_at IS NULL AND cancelled_at IS NULL",
    )
    .bind(series_id)
    .bind(settled)
    .fetch_one(&mut **tx)
    .await
    .map_err(map_sqlx_err)?;
    if open > 0 {
        return Ok(None);
    }
    let dues: Vec<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT due_date, due_at FROM todos WHERE series_id = ?")
            .bind(series_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(map_sqlx_err)?;
    let days = dues.iter().filter_map(|(date, at)| {
        StoredDue::from_columns(date.as_deref(), at.as_deref())
            .ok()
            .flatten()
            .map(|due| due.local_date(tz))
    });
    let rule = series.rule()?;
    let today = now.with_timezone(tz).date_naive();
    let day = next_due_day(&rule, today, days);
    let period = period_on(day, series.time_of_day(), series.remind(), tz);
    let (due_date, due_at) = period.due.columns();
    let id = crate::api::todo::mint_todo_id();
    let stamp = instant_to_utc_iso(&now);
    let origin = repeat_origin();
    sqlx::query(
        "INSERT INTO todos (id, title, notes, due_date, due_at, created_via, \
            created_by_supervisor, created_origin_note, series_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&series.title)
    .bind(&series.notes)
    .bind(&due_date)
    .bind(&due_at)
    .bind(origin.via.as_sql())
    .bind(origin.stored_supervisor())
    .bind(series_id)
    .bind(&stamp)
    .bind(&stamp)
    .execute(&mut **tx)
    .await
    .map_err(|e| map_constraint_err(context, e))?;
    insert_subitems(tx, &id, 0, &series.items(), &stamp, context).await?;
    Ok(Some(MadePeriod {
        id,
        title: series.title,
        remind_at: period.remind_at,
    }))
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
