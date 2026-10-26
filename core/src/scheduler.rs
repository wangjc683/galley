//! Scheduled-task background loop (.scratch/scheduled-tasks issue 02).
//!
//! A tokio task mounted from `start_background_services` ticks once a
//! minute, and every tick re-derives "is a fire due?" from the wall
//! clock instead of sleeping until a precomputed instant — that makes
//! the loop robust against Mac lid-sleep, manual clock changes, and
//! DST: waking up simply evaluates the current minute like any other.
//!
//! Catch-up contract (PRD 决策 4): the due check compares the most
//! recent planned fire against `max(last_fired_at, created_at)`, so a
//! missed 09:00 still fires once when the machine wakes at 09:40 —
//! but only while the planned fire's own local day lasts. Past
//! midnight the missed run is dropped, never fired retroactively:
//! without that bound, yesterday's missed 09:00 would fire at 08:59
//! today and today's at 09:00 — two digests a minute apart. Periods
//! that predate the task's creation never fire.
//!
//! Firing goes through the production `session.new` socket handler
//! (`dispatch_session_new_with`) — the same create + persist + spawn +
//! dispatch + GUI-event path a supervisor uses; no scheduler-private
//! session plumbing. A fire whose session creation fails still consumes
//! its period (`last_fired_at` stamped, `last_run_session_id` NULL) so
//! the GUI can show the failure instead of the loop retrying every
//! minute against a broken runner. [`fire`] touches its dependencies
//! only through [`HandlerCtx`], the same seam the socket handlers use —
//! production adapters are composed in [`tick`], fakes in
//! `core/tests/scheduler_fire_test.rs`.
//!
//! Two more contract points, both pinned by tests:
//!
//! - **Read errors are per-task, not fail-all**: a corrupt row is
//!   skipped (and logged) by the list read in `db/schedule.rs`; the
//!   healthy tasks keep firing.
//! - **Re-enabling does not rebase the baseline**: a 09:00 daily task
//!   disabled for a week and re-enabled at 10:00 fires today's 09:00
//!   immediately — its period is unconsumed and still inside its local
//!   day. `updated_at` is deliberately not consulted.
//!
//! Main chat ticket 33 adds:
//!
//! - **One-offs** fire once, at `fireAt`, when no fire at or after it is
//!   recorded ([`due_at`]). They are **not** bound to the local day: a
//!   computer asleep for two days fires a missed reminder when it wakes —
//!   a lost reminder is worse than a late one. A manual run before
//!   `fireAt` does not consume it; a later `fireAt` arms it again.
//! - **Cancelled** tasks never fire.
//! - **Waking the assistant** (`target = assistant`): no session. The fire
//!   is stamped `last_wake = 'pending'` ([`fire_reminder`]) and every tick
//!   reads the pending fires into the main chat's waiting reports
//!   (`crate::subtask_report::restore_pending_reminders`) and wakes it —
//!   the database is the queue, so a restart loses nothing. While the
//!   active runtime is not the managed one, or has no main chat, these
//!   tasks do not fire (a one-off fires late once the main chat is back).
//! - A session a `target = session` task started reports its runs to the
//!   main chat like a subtask (`crate::subtask_report`).
//!
//! Main chat ticket 39: a task that is a to-do's reminder (`todoId`) does
//! not go off once its to-do is ticked off or cancelled
//! ([`drop_reminders_of_closed_todos`]); Core cancels it then anyway.
//!
//! Main chat ticket 73 (assistant PRD ruling 10): the **morning review**,
//! the one task Galley makes itself ([`ensure_review`],
//! [`REVIEW_SUPERVISOR`]): every day a little before or after 9:00 (ticket
//! 78: a time picked once, when it is made, [`review_time_of_day`]) it
//! wakes the main chat to go over what is in hand and move forward what it
//! can. Coming due, it first looks without the model ([`fire_review`]),
//! and wakes only for what has no alarm of its own (ticket 81): a to-do of
//! the user's with no date or due within three days, or a subtask not
//! finished; or, since ticket 95, for a memo noted or changed since the
//! last review's day, in a turn the user started; with none it wakes
//! nobody. Its wake travels as a reminder's, with words of its own
//! (`crate::subtask_report`), and one that cannot be delivered is dropped,
//! never handed to a notification (its words are for the model). The user
//! stops it by asking the main chat, which pauses it; Galley never makes
//! it again.

use std::sync::Arc;

use chrono::{DateTime, Local, TimeZone, Utc};
use tauri::Manager;

use crate::api::schedule::{
    instant_to_utc_iso, next_fire_after, parse_time_of_day, parse_utc_secs, prev_fire_at_or_before,
    resolve_wall_clock, FirePreview, ScheduleTarget, ScheduledFireFailed, ScheduledTaskBrief,
    SCHEDULED_TASKS_CHANGED_EVENT, SCHEDULED_TASK_FIRE_FAILED_EVENT,
};
use crate::api::{GalleyApi, MemoBrief, MemoReviewWindow, Origin, ScheduledTaskId};
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::notify::{notify, Notifier};
use crate::protocol::{SessionNewArgs, SessionNewResult};
use crate::runner_manager::RunnerManager;
use crate::socket_listener::{dispatch_session_new_with, DbSource, HandlerCtx};
use crate::subtask_report::{
    restore_pending_reminders, spawn_wake_if_due, wake_if_due, SubtaskReports,
};

const TICK_SECONDS: u64 = 60;

/// Supervisor label stamped on scheduler-created sessions, in the
/// `galley-<source>` form. Mirrored as `SCHEDULER_SUPERVISOR` in
/// `gui/src/lib/scheduled-tasks.ts` (badge + sidebar marker) and pinned
/// by `gui/src/lib/scheduled-tasks.test.ts` — a rename must land on
/// both sides. `crate::subtask_report` reads it back to find the task
/// behind a session ([`task_id_from_reason`]).
pub const SCHEDULER_SUPERVISOR: &str = "galley-scheduler";

/// Supervisor label of the **morning review** (main chat ticket 73,
/// assistant PRD ruling 10): the one task Galley makes itself, stored
/// with `created_via = 'system'` ([`ScheduledTaskBrief::is_review`]).
/// Every day at the time picked when it is made ([`review_time_of_day`],
/// a little before or after 9:00) it wakes the main chat to go over what
/// is in hand. Read by the desktop (ticket 74) to show it by a name
/// of its own instead of [`REVIEW_PROMPT`], from `origin.supervisor` on
/// the task and `agent` on its item in the to-do list.
pub const REVIEW_SUPERVISOR: &str = "galley-review";

/// The window the review's time is picked in (main chat ticket 78, PRD
/// ruling 126), local wall clock, in minutes after midnight, both ends
/// included: 08:45 to 09:15.
pub const REVIEW_WINDOW: std::ops::RangeInclusive<u32> = (8 * 60 + 45)..=(9 * 60 + 15);

/// Every time the review may be made at, as `HH:MM`, earliest first: the
/// minutes of [`REVIEW_WINDOW`] that are not a multiple of five, so none
/// is a time people set (:00, :05, :15, :30, :45 …). There are 24.
pub fn review_times() -> Vec<String> {
    REVIEW_WINDOW
        .filter(|minute| minute % 5 != 0)
        .map(|minute| format!("{:02}:{:02}", minute / 60, minute % 60))
        .collect()
}

/// The review's time of day, one of [`review_times`] picked by `random`
/// (any number; Core passes `crate::api::schedule::mint_u64`'s). Main
/// chat ticket 78 (PRD ruling 126): not 09:00 on every machine, on the
/// hour people set their own tasks at. Picked once, when Galley makes the
/// review ([`ensure_review`]), and kept: the user moves it with `schedule
/// update`, Galley never does.
pub fn review_time_of_day(random: u64) -> String {
    let mut times = review_times();
    let pick = (random % times.len() as u64) as usize;
    times.swap_remove(pick)
}

/// The words the review carries: what `schedule list`, `schedule show` and
/// the "In Hand" lines show the model. The wake itself is Core's
/// ([`crate::subtask_report`]'s review paragraph), so a newer wording
/// reaches a review made by an older version; these stay as they were
/// written.
pub const REVIEW_PROMPT: &str = "Morning review: go over what is in hand and move forward \
     what you can without being asked (\"The morning review\" in `wake.md`). Galley made this \
     task; when the user asks, pause it with `schedule disable`, never `schedule delete`.";

/// The pref the review's log is kept under: one entry per fire and per
/// wake dropped ([`ReviewEvent`]), newest last, at most
/// [`REVIEW_LOG_MAX`]. The skips leave no other trace: a skipped fire
/// stamps the task like any other and wakes nobody. Read by the trial
/// snapshot (`.scratch/assistant/closed-loop-snapshot.py`).
pub const REVIEW_LOG_PREF: &str = "assistant_review_log";

/// How many entries the review's log keeps (about a year of fires).
pub const REVIEW_LOG_MAX: usize = 400;

/// The pref the morning review's memo window is kept under from its fire
/// to its wake (main chat ticket 95): `{taskId, firedAt, window}`, the
/// window as [`MemoReviewWindow::to_json`] writes it, for the review's
/// last fire only. The window is measured from the review before this one
/// (`last_fired_at` before the fire), which the fire overwrites; its wake
/// is written later, from the database (a restart included), and reads it
/// back here ([`review_wake_memos`]).
pub const REVIEW_MEMO_WINDOW_PREF: &str = "assistant_review_memo_window";

/// What became of the morning review once, in its log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewEvent {
    /// It came due with nothing to look at ([`fire_review`]): no wake, no
    /// tokens.
    Skipped,
    /// It came due and was stamped to wake the main chat.
    Woke,
    /// Fired by hand (`schedule run`, the desktop's run now): a wake
    /// without the look [`fire_review`] takes first, and not a coming due.
    Run,
    /// Its wake could not reach the main chat and was dropped, without
    /// the notification a reminder gets.
    Dropped,
}

/// The `reason` a scheduler-created session is stamped with, followed by
/// the task id.
const REASON_PREFIX: &str = "scheduled task ";

/// The task id in a scheduler-created session's origin reason.
pub fn task_id_from_reason(reason: &str) -> Option<&str> {
    reason
        .strip_prefix(REASON_PREFIX)
        .map(str::trim)
        .filter(|id| !id.is_empty())
}

pub(crate) fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    // The pool is managed state by setup time — the loop holds it
    // instead of re-opening the global on every tick.
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    let notifier = crate::notify::TauriNotifier::new(handle.clone());
    tauri::async_runtime::spawn(async move {
        // Ticket 73: a main chat made before the review existed gets it
        // now (a new one gets it when it is made).
        ensure_review(&galley, notifier.as_ref()).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(TICK_SECONDS));
        // After a long sleep the timer owes many ticks; the due check is
        // wall-clock-derived, so bursting through them is pure noise.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            // First tick fires immediately → an app launched at 09:30
            // catches up a missed 09:00 without waiting a minute.
            interval.tick().await;
            tick(&handle, &galley).await;
        }
    });
}

async fn tick(app: &tauri::AppHandle, galley: &SqliteGalley) {
    let tasks = match galley.list_scheduled_tasks().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[scheduler] list scheduled tasks failed: {e:?}");
            return;
        }
    };
    let now = Local::now();
    let due: Vec<_> = tasks
        .into_iter()
        .filter_map(|t| due_at(&t, &Local, &now).map(|planned| (t, planned)))
        .collect();
    let notifier = crate::notify::TauriNotifier::new(app.clone());
    let due = drop_reminders_of_closed_todos(galley, notifier.as_ref(), due).await;
    let mut sessions = Vec::new();
    // Read once per tick, only when a task wakes the assistant.
    let mut assistant: Option<bool> = None;
    for (task, planned) in due {
        match task.target {
            ScheduleTarget::Session => sessions.push(task),
            ScheduleTarget::Assistant => {
                let available = match assistant {
                    Some(available) => available,
                    None => {
                        let available =
                            galley.ensure_assistant_available("scheduler").await.is_ok();
                        assistant = Some(available);
                        available
                    }
                };
                if available {
                    if task.is_review() {
                        let manager: Arc<RunnerManager> =
                            app.state::<Arc<RunnerManager>>().inner().clone();
                        fire_review(
                            galley,
                            manager.as_ref(),
                            notifier.as_ref(),
                            &task,
                            &planned,
                            &now,
                        )
                        .await;
                    } else {
                        fire_reminder(galley, notifier.as_ref(), &task, &planned, &now).await;
                    }
                }
            }
        }
    }
    if !sessions.is_empty() {
        // Compose the production adapters behind the HandlerCtx seam once
        // per tick; `fire` itself never touches Tauri directly.
        let db = DbSource::Pool(galley.clone());
        let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
        let ctx = HandlerCtx {
            db: &db,
            runner: manager.as_ref(),
            notifier: notifier.clone(),
            app: Some(app),
        };
        for task in &sessions {
            fire(&ctx, task, &now).await;
        }
    }
    // Every pending fire — this tick's and any a restart left — goes to
    // the main chat.
    if let Some(reports) = app.try_state::<Arc<SubtaskReports>>() {
        wake_for_pending(app, galley, reports.inner()).await;
    }
}

/// The due tasks minus the reminders of to-dos no longer open (main chat
/// ticket 39's second safety: ticking off or cancelling a to-do cancels
/// its reminder, and should one slip through — a tick between this
/// tick's read and its fire — it does not go off). Those are cancelled
/// here instead, so they stop coming due. A failed read of the to-dos
/// keeps every task: a reminder lost is worse than one too many.
pub async fn drop_reminders_of_closed_todos<T>(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    due: Vec<(ScheduledTaskBrief, T)>,
) -> Vec<(ScheduledTaskBrief, T)> {
    if due.iter().all(|(task, _)| task.todo_id.is_none()) {
        return due;
    }
    let open = match galley.open_todo_ids().await {
        Ok(open) => open,
        Err(e) => {
            eprintln!("[scheduler] reading open to-dos failed: {e:?}");
            return due;
        }
    };
    let mut kept = Vec::with_capacity(due.len());
    for (task, planned) in due {
        match task.todo_id.as_deref() {
            Some(todo) if !open.contains(todo) => {
                eprintln!(
                    "[scheduler] task {} reminds of to-do {todo}, no longer open: cancelled",
                    task.id
                );
                // Core on its own (ticket 61): not the user turning it down.
                match galley
                    .cancel_scheduled_task(&task.id, &Origin::system())
                    .await
                {
                    Ok(_) => notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &()),
                    Err(e) => eprintln!("[scheduler] cancelling task {} failed: {e:?}", task.id),
                }
            }
            _ => kept.push((task, planned)),
        }
    }
    kept
}

/// Read the pending fires into the waiting reports and, when any was
/// new, wake the main chat in the background (the drain task's way).
async fn wake_for_pending(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
    reports: &Arc<SubtaskReports>,
) {
    let Some(main) = restore_pending_reminders(reports, galley).await else {
        return;
    };
    let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
    let notifier = crate::notify::TauriNotifier::new(app.clone());
    spawn_wake_if_due(reports, galley, &manager, &notifier, Some(app), &main).await;
}

/// Record the fire of a task that wakes the assistant (`target =
/// assistant`): no session; the fire is stamped pending with the period
/// it was due for, and the desktop is told the task changed. The main
/// chat hears of it through the pending fires
/// (`crate::subtask_report::restore_pending_reminders`). `false` when the
/// stamp failed.
pub async fn fire_reminder<Tz: TimeZone>(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    task: &ScheduledTaskBrief,
    due_at: &DateTime<Tz>,
    now: &DateTime<Tz>,
) -> bool {
    match galley
        .mark_scheduled_reminder_fired(
            &task.id,
            &instant_to_utc_iso(now),
            &instant_to_utc_iso(due_at),
        )
        .await
    {
        Ok(_) => {
            notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
            true
        }
        Err(e) => {
            eprintln!("[scheduler] task {} mark fired failed: {e:?}", task.id);
            false
        }
    }
}

/// Make sure the morning review exists (main chat ticket 73): a daily
/// task that wakes the main chat, made by Galley ([`REVIEW_SUPERVISOR`]),
/// at a time picked as it is made, a little before or after 9:00
/// ([`review_time_of_day`], ticket 78). Called when the main chat is
/// asked for (made, restored, or there: the desktop asks at every launch)
/// and once when Core starts. Made only on the managed runtime with its
/// main chat, and only once ever
/// ([`SqliteGalley::create_system_task_once`]): once the user has it
/// paused or cancelled, Galley does not make it again, and one there
/// keeps its time. The desktop hears of a new one; a failure is logged,
/// never in the caller's way. The task made, when this call made it.
pub async fn ensure_review(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
) -> Option<ScheduledTaskBrief> {
    let id = crate::api::schedule::mint_scheduled_task_id();
    let time = review_time_of_day(crate::api::schedule::mint_u64());
    match galley
        .create_system_task_once(&id, REVIEW_PROMPT, &time, REVIEW_SUPERVISOR)
        .await
    {
        Ok(Some(task)) => {
            eprintln!("[scheduler] made the morning review {}", task.id);
            notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
            Some(task)
        }
        Ok(None) => None,
        Err(e) => {
            eprintln!("[scheduler] making the morning review failed: {e:?}");
            None
        }
    }
}

/// How a coming due of the morning review went ([`fire_review`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewFire {
    /// Nothing to look at: the period consumed, no wake.
    Skipped,
    /// Stamped pending, to wake the main chat like a reminder.
    Woke,
    /// Recording the fire failed; the next tick tries again.
    Failed,
}

/// The morning review came due (ticket 73). Before any model call, Core
/// looks for something to look at, on the list the "In Hand" lines read
/// ([`crate::assistant_todo::assistant_todo`]); ticket 81 (main chat PRD
/// ruling 128 point 4): only what has no alarm of its own counts
/// ([`AssistantTodo::review_has_something_to_look_at`]) — a to-do of the
/// user's with no due date or due within
/// [`crate::assistant_todo::REVIEW_LOOKAHEAD_DAYS`] days of today (overdue
/// ones included), or a subtask not finished. A to-do due later, Galley's
/// own one-off tasks (each goes off at its time by itself) and routines
/// (the review is one) do not. Ticket 95 (main chat PRD ruling 143): nor
/// does it skip while a memo was noted or changed in a turn the user
/// started, since the day of the review before this one
/// ([`MemoReviewWindow`], read off `task.last_fired_at` as it stood
/// before this fire, in this machine's zone); the window is kept for the
/// wake to name them ([`REVIEW_MEMO_WINDOW_PREF`]). With nothing to look
/// at, the fire is stamped skipped — the period consumed, so it does not
/// come due again today, and no wake
/// ([`SqliteGalley::mark_scheduled_wake_skipped`]);
/// otherwise it fires like a reminder ([`fire_reminder`]) and the wake
/// pipeline takes it from there, and the review goes over everything in
/// hand. Either way its log says so ([`log_review`]). A failed read wakes
/// it: one turn too many beats a review that never runs. A catch-up (the
/// computer asleep at its time) comes through here too.
///
/// [`AssistantTodo::review_has_something_to_look_at`]: crate::assistant_todo::AssistantTodo::review_has_something_to_look_at
pub async fn fire_review<Tz: TimeZone>(
    galley: &SqliteGalley,
    runners: &RunnerManager,
    notifier: &dyn Notifier,
    task: &ScheduledTaskBrief,
    due_at: &DateTime<Tz>,
    now: &DateTime<Tz>,
) -> ReviewFire {
    let fired_at = instant_to_utc_iso(now);
    let planned = instant_to_utc_iso(due_at);
    let at = now.with_timezone(&Utc);
    // Today in the zone the list reads its due dates in: `assistant_todo`
    // builds it in this machine's.
    let today = at.with_timezone(&Local).date_naive();
    let todo_says = match crate::assistant_todo::assistant_todo(galley, runners, at).await {
        Ok(todo) => todo.review_has_something_to_look_at(today),
        Err(e) => {
            eprintln!(
                "[scheduler] review {}: reading the to-do list failed, waking it: {e:?}",
                task.id
            );
            true
        }
    };
    // Ticket 95: the memos new since the review before this one, read in
    // the zone the to-do list reads its days in.
    let window = MemoReviewWindow::before(task.last_fired_at.as_deref(), at, &Local);
    let memos_say = match galley.review_memos(&window).await {
        Ok(memos) => !memos.is_empty(),
        Err(e) => {
            eprintln!(
                "[scheduler] review {}: reading the memos failed, waking it: {e:?}",
                task.id
            );
            true
        }
    };
    if todo_says || memos_say {
        // Kept before the fire is stamped: a wake read from the pending
        // fire right after it then finds its window.
        keep_review_memo_window(galley, task.id.as_str(), &fired_at, &window).await;
        if !fire_reminder(galley, notifier, task, due_at, now).await {
            return ReviewFire::Failed;
        }
        log_review(
            galley,
            ReviewEvent::Woke,
            task.id.as_str(),
            &fired_at,
            Some(&planned),
            None,
        )
        .await;
        return ReviewFire::Woke;
    }
    match galley
        .mark_scheduled_wake_skipped(&task.id, &fired_at, &planned)
        .await
    {
        Ok(_) => {
            eprintln!(
                "[scheduler] review {}: nothing to look at (no to-do any time or due within \
                 {} days, no unfinished subtask, no new memo since {}), skipped",
                task.id,
                crate::assistant_todo::REVIEW_LOOKAHEAD_DAYS,
                window.since
            );
            notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
            log_review(
                galley,
                ReviewEvent::Skipped,
                task.id.as_str(),
                &fired_at,
                Some(&planned),
                None,
            )
            .await;
            ReviewFire::Skipped
        }
        Err(e) => {
            eprintln!("[scheduler] review {} mark skipped failed: {e:?}", task.id);
            ReviewFire::Failed
        }
    }
}

/// Keep the memo window of the review's fire at `fired_at` for its wake
/// ([`REVIEW_MEMO_WINDOW_PREF`]). A failed write is logged: the wake then
/// names no memo, and the review still wakes.
pub async fn keep_review_memo_window(
    galley: &SqliteGalley,
    task_id: &str,
    fired_at: &str,
    window: &MemoReviewWindow,
) {
    let kept = serde_json::json!({
        "taskId": task_id,
        "firedAt": fired_at,
        "window": window.to_json(),
    });
    if let Err(e) = galley.set_pref_json(REVIEW_MEMO_WINDOW_PREF, kept).await {
        eprintln!("[scheduler] review {task_id}: keeping its memo window failed: {e:?}");
    }
}

/// The memos the wake of `task`'s last fire names (ticket 95, main chat PRD
/// ruling 143 point 3): the ones in the window kept for that fire
/// ([`keep_review_memo_window`]), read now — one deleted or changed again
/// since is left out (a change moves it to the next window). None when no
/// window was kept for this fire, or reading fails (logged): the wake then
/// reads as it did before memos.
pub async fn review_wake_memos(galley: &SqliteGalley, task: &ScheduledTaskBrief) -> Vec<MemoBrief> {
    let Some(fired_at) = task.last_fired_at.as_deref() else {
        return Vec::new();
    };
    let kept = match galley.get_pref_json(REVIEW_MEMO_WINDOW_PREF).await {
        Ok(Some(kept)) => kept,
        Ok(None) => return Vec::new(),
        Err(e) => {
            eprintln!(
                "[scheduler] review {}: reading its memo window failed: {e:?}",
                task.id
            );
            return Vec::new();
        }
    };
    if kept["taskId"].as_str() != Some(task.id.as_str())
        || kept["firedAt"].as_str() != Some(fired_at)
    {
        return Vec::new();
    }
    let Some(window) = MemoReviewWindow::from_json(&kept["window"]) else {
        return Vec::new();
    };
    match galley.review_memos(&window).await {
        Ok(memos) => memos,
        Err(e) => {
            eprintln!(
                "[scheduler] review {}: reading its memos failed: {e:?}",
                task.id
            );
            Vec::new()
        }
    }
}

/// One entry in the morning review's log ([`REVIEW_LOG_PREF`]): what
/// happened, to which fire (`firedAt`, the planned `dueAt` when there is
/// one), when, and for a dropped wake why. A failed write is logged and
/// otherwise ignored: the log is the trial's count, not the review.
pub async fn log_review(
    galley: &SqliteGalley,
    event: ReviewEvent,
    task_id: &str,
    fired_at: &str,
    due_at: Option<&str>,
    reason: Option<&str>,
) {
    let mut entry = serde_json::json!({
        "event": event,
        "taskId": task_id,
        "firedAt": fired_at,
        "at": instant_to_utc_iso(&Utc::now()),
    });
    if let Some(due_at) = due_at {
        entry["dueAt"] = serde_json::json!(due_at);
    }
    if let Some(reason) = reason {
        entry["reason"] = serde_json::json!(reason);
    }
    if let Err(e) = galley
        .append_pref_log(REVIEW_LOG_PREF, entry, REVIEW_LOG_MAX)
        .await
    {
        eprintln!("[scheduler] review {task_id}: writing its log failed: {e:?}");
    }
}

/// Run a task once, now — the GUI's "run now" and the CLI's `schedule
/// run`, through the scheduled path ([`run_task_now`]'s contract): a
/// `session` task fires through [`fire`]; an `assistant` task is stamped
/// like a due fire planned for now and the main chat is woken, in the
/// background when there is an app, inline otherwise. Refused for a
/// cancelled task (`not_found`) and, for an `assistant` task, when there
/// is no assistant to wake (`invalid_args`,
/// [`crate::api::ASSISTANT_UNAVAILABLE`]). Returns the task as it stands
/// after the fire.
pub async fn run_now(
    ctx: &HandlerCtx<'_>,
    reports: Option<&Arc<SubtaskReports>>,
    id: &str,
) -> crate::error::Result<ScheduledTaskBrief> {
    let galley = ctx.db.get().await?;
    let task = galley.scheduled_task(id).await?;
    if task.cancelled_at.is_some() {
        return Err(GalleyError::NotFound {
            message: format!("scheduled task {id} is cancelled"),
        });
    }
    let now = Local::now();
    match task.target {
        ScheduleTarget::Session => fire(ctx, &task, &now).await,
        ScheduleTarget::Assistant => {
            galley
                .ensure_assistant_available("run_scheduled_task")
                .await?;
            if task.is_review() {
                // Ticket 95: run by hand, the review names the memos of
                // its own window, from the day of the one before it (run
                // again the same day: none).
                let window = MemoReviewWindow::before(
                    task.last_fired_at.as_deref(),
                    now.with_timezone(&Utc),
                    &Local,
                );
                let fired = instant_to_utc_iso(&now);
                keep_review_memo_window(&galley, id, &fired, &window).await;
            }
            if !fire_reminder(&galley, ctx.notifier.as_ref(), &task, &now, &now).await {
                return Err(GalleyError::Internal {
                    message: format!("scheduled task {id}: recording the fire failed"),
                });
            }
            if task.is_review() {
                let fired = instant_to_utc_iso(&now);
                log_review(&galley, ReviewEvent::Run, id, &fired, Some(&fired), None).await;
            }
            if let Some(reports) = reports {
                match ctx.app {
                    Some(app) => wake_for_pending(app, &galley, reports).await,
                    None => {
                        if let Some(main) = restore_pending_reminders(reports, &galley).await {
                            wake_if_due(reports, &ctx.runner_host(&galley), &main).await;
                        }
                    }
                }
            }
        }
    }
    galley.scheduled_task(id).await
}

/// Manual "run now" from the GUI (issue 13): fire this task once,
/// immediately, through the exact scheduled path — same supervisor
/// label, same `last_fired_at` stamp, same failure handling. Stamping
/// is deliberate, not incidental: it makes the manual run the row's
/// "上次运行" (trust loop) and lets a successful re-run clear the
/// failed-fire badge, while the due math keeps every *future* planned
/// fire intact — a manual run at 08:50 leaves today's 09:00 strictly
/// after the new baseline, so it still fires
/// (`manual_fire_before_planned_time_keeps_today_due`). The only
/// period a manual run absorbs is an already-due catch-up, which is
/// the point — the user just ran it. `enabled` is not checked: firing
/// a paused task by hand is a legitimate way to test its prompt.
pub(crate) async fn run_task_now(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
    id: &str,
) -> crate::error::Result<()> {
    // Same production-adapter composition as `tick`.
    let db = DbSource::Pool(galley.clone());
    let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.as_ref(),
        notifier: crate::notify::TauriNotifier::new(app.clone()),
        app: Some(app),
    };
    let reports = app
        .try_state::<Arc<SubtaskReports>>()
        .map(|r| r.inner().clone());
    run_now(&ctx, reports.as_ref(), id).await.map(|_| ())
}

/// Pure due check: is this task's most recent planned fire still
/// unconsumed? Generic over the timezone so DST behavior is unit-tested
/// with real tz data (production passes `chrono::Local`).
fn due_fire<Tz: TimeZone>(task: &ScheduledTaskBrief, tz: &Tz, now: &DateTime<Tz>) -> bool {
    due_at(task, tz, now).is_some()
}

/// The planned instant of the fire this task owes now, if any — the
/// due check behind [`due_fire`], with the instant a reminder's report
/// measures its lateness from. A one-off owes its `fireAt` from then on,
/// whatever day it is now, until a fire at or after it is recorded.
pub fn due_at<Tz: TimeZone>(
    task: &ScheduledTaskBrief,
    tz: &Tz,
    now: &DateTime<Tz>,
) -> Option<DateTime<Tz>> {
    if !task.enabled || task.cancelled_at.is_some() {
        return None;
    }
    if task.repeat.is_once() {
        let fire_at = DateTime::parse_from_rfc3339(task.fire_at.as_deref()?).ok()?;
        if fire_at.timestamp() > now.timestamp() {
            return None;
        }
        if let Some(last) = task.last_fired_at.as_deref().and_then(parse_utc_secs) {
            if last >= fire_at.timestamp() {
                return None;
            }
        }
        return Some(fire_at.with_timezone(tz));
    }
    let Ok(tod) = parse_time_of_day(&task.time_of_day) else {
        // Normally unreachable — the list read already skips (and logs)
        // corrupt rows. Fail closed for any other caller.
        return None;
    };
    let prev = prev_fire_at_or_before(&task.repeat, tod, now.naive_local());
    // Catch-up is bounded to the planned fire's own local day — a
    // missed run older than that is dropped, not fired retroactively.
    if prev.date() != now.naive_local().date() {
        return None;
    }
    let prev_instant = resolve_wall_clock(tz, prev);
    // A DST spring-forward gap can resolve "02:30" to an instant a few
    // minutes in the future; that fire belongs to a later tick.
    if prev_instant > *now {
        return None;
    }
    // Baseline: whatever is later of "last consumed period" and "task
    // exists since" — periods before creation, and re-fires within a
    // consumed period, are out. Compared as parsed instants, never as
    // strings: the DB holds both `+00:00` (row timestamps) and `Z`
    // (fire stamps written before the formatters were unified), and
    // lexicographically `'Z' > '+'` flips exact-second ties.
    let Some(created) = parse_utc_secs(&task.created_at) else {
        // Unparseable created_at (manual DB edit): fail closed.
        return None;
    };
    let last = task.last_fired_at.as_deref().and_then(parse_utc_secs);
    let baseline = last.map_or(created, |l| l.max(created));
    (prev_instant.timestamp() > baseline).then_some(prev_instant)
}

/// Preview what saving a task shaped like `task` would do: whether it
/// fires immediately (same [`due_fire`] semantics as the loop — an
/// unconsumed period earlier today, reachable only with an existing
/// task's baseline) and the next planned fire strictly after `now`.
/// Callers build the brief: the preview command synthesizes one from
/// form values, with `created_at = now` for a task being created.
/// Returns `Err` on an unparseable `time_of_day`.
pub fn preview_fire<Tz: TimeZone>(
    task: &ScheduledTaskBrief,
    tz: &Tz,
    now: &DateTime<Tz>,
) -> crate::error::Result<FirePreview> {
    if task.repeat.is_once() {
        return Err(GalleyError::InvalidArgs {
            message: "preview_scheduled_fire: a one-off has no rule to preview".into(),
        });
    }
    let tod = parse_time_of_day(&task.time_of_day)?;
    let next = next_fire_after(&task.repeat, tod, now.naive_local());
    Ok(FirePreview {
        due_now: due_fire(task, tz, now),
        next_fire_at: instant_to_utc_iso(&resolve_wall_clock(tz, next)),
    })
}

/// Best-effort per-task model: pre-resolve the pinned display name
/// against the active runtime so an unresolvable pin (model deleted,
/// runtime switched) degrades to the default model instead of failing
/// the whole fire inside `session.new` — a digest on the wrong model
/// beats a digest that silently never ran.
async fn resolve_task_llm(galley: &SqliteGalley, task: &ScheduledTaskBrief) -> Option<String> {
    let name = task
        .llm_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let runtime_kind = match galley.active_runtime_kind().await {
        Ok(kind) => kind,
        Err(e) => {
            eprintln!(
                "[scheduler] task {} runtime kind unavailable, using default model: {e:?}",
                task.id
            );
            return None;
        }
    };
    match crate::socket_listener::resolve_llm_selection_for_runtime(
        galley,
        Some(name.to_string()),
        runtime_kind,
    )
    .await
    {
        Ok(_) => Some(name.to_string()),
        Err(e) => {
            eprintln!(
                "[scheduler] task {} model {name:?} unresolved, using default: {e:?}",
                task.id
            );
            None
        }
    }
}

/// Fire one due task: create + dispatch its session through the
/// production `session.new` socket path, then stamp the period
/// consumed. Everything it touches comes through the [`HandlerCtx`]
/// seam — public so `core/tests/scheduler_fire_test.rs` can drive it
/// with the same fakes the socket write handlers are tested with.
pub async fn fire<Tz: TimeZone>(ctx: &HandlerCtx<'_>, task: &ScheduledTaskBrief, now: &DateTime<Tz>) {
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[scheduler] task {} db unavailable: {e:?}", task.id);
            return;
        }
    };
    let args = SessionNewArgs {
        task: task.prompt.clone(),
        project_id: task.project_id.as_ref().map(|p| p.as_str().to_string()),
        llm_name: resolve_task_llm(&galley, task).await,
        runtime_kind: None,
        supervisor: Some(SCHEDULER_SUPERVISOR.into()),
        reason: Some(format!("{REASON_PREFIX}{}", task.id)),
    };

    // The `session.new` handler itself, not the line router: the CLI's
    // `schedule run` reaches this through the router, which must not
    // contain itself (ticket 34).
    let session_id = match dispatch_session_new_with(ctx, args).await {
        resp if resp.ok => resp.result.and_then(|r| {
            match serde_json::from_value::<SessionNewResult>(r) {
                Ok(result) => Some(result.session.id),
                // Unreachable while both ends build `SessionNewResult`;
                // still a loud log beats a silent "failed run" row.
                Err(e) => {
                    eprintln!("[scheduler] task {} session.new result shape: {e}", task.id);
                    None
                }
            }
        }),
        resp => {
            eprintln!(
                "[scheduler] task {} fire failed: {} {}",
                task.id,
                resp.error.as_deref().unwrap_or("?"),
                resp.message.as_deref().unwrap_or("")
            );
            None
        }
    };

    // Stamp the period consumed even on failure — the GUI renders
    // "fired but no session" as a failed run, and the loop must not
    // retry a broken runner every minute.
    let failed = session_id.is_none();
    if let Err(e) = galley
        .mark_scheduled_task_fired(
            ScheduledTaskId(task.id.as_str().to_string()),
            instant_to_utc_iso(now),
            session_id,
        )
        .await
    {
        eprintln!("[scheduler] task {} mark fired failed: {e:?}", task.id);
    }
    ctx.notify(SCHEDULED_TASKS_CHANGED_EVENT, &());
    // A failed fire is "needs your action" (决策 7): the GUI turns this
    // into a gated system notification. Emitted only here — the GUI
    // owns OS notifications (issue 05's no-double-send rule).
    if failed {
        ctx.notify(
            SCHEDULED_TASK_FIRE_FAILED_EVENT,
            &ScheduledFireFailed {
                task_id: task.id.clone(),
                prompt: task.prompt.clone(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::schedule::ScheduledTaskRepeat;
    use chrono_tz::America::New_York;
    use chrono_tz::Tz;

    fn task(
        repeat: ScheduledTaskRepeat,
        time_of_day: &str,
        enabled: bool,
        created_at: &str,
        last_fired_at: Option<&str>,
    ) -> ScheduledTaskBrief {
        ScheduledTaskBrief {
            id: crate::api::ScheduledTaskId("sched_t".into()),
            project_id: None,
            prompt: "p".into(),
            repeat,
            time_of_day: time_of_day.into(),
            llm_name: None,
            enabled,
            last_fired_at: last_fired_at.map(str::to_string),
            last_run_session_id: None,
            next_fire_at: None,
            fire_at: None,
            target: ScheduleTarget::Session,
            last_due_at: None,
            last_wake: None,
            origin: None,
            created_in: None,
            cancelled_at: None,
            cancelled_by: None,
            todo_id: None,
            created_at: created_at.into(),
            updated_at: created_at.into(),
        }
    }

    fn once(fire_at: &str, last_fired_at: Option<&str>) -> ScheduledTaskBrief {
        let mut t = task(
            ScheduledTaskRepeat::Once,
            "20:00",
            true,
            CREATED_LONG_AGO,
            last_fired_at,
        );
        t.fire_at = Some(fire_at.into());
        t.target = ScheduleTarget::Assistant;
        t
    }

    // 2026-07-22T20:00 America/New_York (EDT) = 2026-07-23T00:00Z.
    const ONCE_AT: &str = "2026-07-23T00:00:00+00:00";

    #[test]
    fn a_one_off_fires_at_its_time_and_once() {
        let t = once(ONCE_AT, None);
        assert_eq!(due_at(&t, &New_York, &ny(2026, 7, 22, 19, 59)), None);
        let at = due_at(&t, &New_York, &ny(2026, 7, 22, 20, 0)).expect("due");
        assert_eq!(instant_to_utc_iso(&at), ONCE_AT);
        // Fired (on time): never again.
        let fired = once(ONCE_AT, Some("2026-07-23T00:00:20Z"));
        assert!(!due_fire(&fired, &New_York, &ny(2026, 7, 22, 20, 1)));
        assert!(!due_fire(&fired, &New_York, &ny(2026, 7, 25, 9, 0)));
    }

    #[test]
    fn a_missed_one_off_fires_days_later_with_its_planned_instant() {
        // Asleep across midnight, and across two: still owed, unlike a
        // repeating task's catch-up, and its planned instant is kept for
        // the report's "how late".
        let t = once(ONCE_AT, None);
        for now in [ny(2026, 7, 23, 0, 30), ny(2026, 7, 24, 23, 59)] {
            let at = due_at(&t, &New_York, &now).expect("still due");
            assert_eq!(instant_to_utc_iso(&at), ONCE_AT);
        }
    }

    #[test]
    fn a_manual_run_before_the_time_leaves_the_one_off_due() {
        // "Run now" at 19:00 stamps last_fired_at before fireAt: the
        // planned fire at 20:00 still happens.
        let t = once(ONCE_AT, Some("2026-07-22T23:00:00Z"));
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 19, 30)));
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 20, 0)));
        // A later fireAt arms a fired one-off again.
        let mut again = once(ONCE_AT, Some("2026-07-23T00:00:10Z"));
        again.fire_at = Some("2026-07-23T02:00:00+00:00".into());
        assert!(!due_fire(&again, &New_York, &ny(2026, 7, 22, 21, 0)));
        assert!(due_fire(&again, &New_York, &ny(2026, 7, 22, 22, 0)));
    }

    #[test]
    fn cancelled_and_disabled_one_offs_never_fire() {
        let mut cancelled = once(ONCE_AT, None);
        cancelled.cancelled_at = Some("2026-07-22T12:00:00Z".into());
        assert!(!due_fire(&cancelled, &New_York, &ny(2026, 7, 22, 21, 0)));
        let mut paused = once(ONCE_AT, None);
        paused.enabled = false;
        assert!(!due_fire(&paused, &New_York, &ny(2026, 7, 22, 21, 0)));
        // A cancelled repeating task too.
        let mut daily = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            None,
        );
        daily.cancelled_at = Some("2026-07-21T12:00:00Z".into());
        assert!(!due_fire(&daily, &New_York, &ny(2026, 7, 22, 9, 30)));
    }

    #[test]
    fn a_repeating_task_reports_the_period_it_owes() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            None,
        );
        let at = due_at(&t, &New_York, &ny(2026, 7, 22, 9, 40)).expect("due");
        assert_eq!(instant_to_utc_iso(&at), "2026-07-22T13:00:00+00:00");
    }

    #[test]
    fn the_task_id_reads_back_from_a_session_reason() {
        assert_eq!(
            task_id_from_reason("scheduled task sched_1"),
            Some("sched_1")
        );
        assert_eq!(task_id_from_reason("scheduled task "), None);
        assert_eq!(task_id_from_reason("weekly review"), None);
    }

    #[test]
    fn preview_refuses_a_one_off() {
        let t = once(ONCE_AT, None);
        assert!(preview_fire(&t, &New_York, &ny(2026, 7, 22, 8, 0)).is_err());
    }

    #[test]
    fn the_review_time_is_off_the_times_people_set_around_nine() {
        // Ticket 78: 08:45 to 09:15, both ends in the window, no minute a
        // multiple of five — 24 times, each one a pick can land on.
        use chrono::Timelike;
        let times = review_times();
        assert_eq!(times.len(), 24);
        assert_eq!(times.first().map(String::as_str), Some("08:46"));
        assert_eq!(times.last().map(String::as_str), Some("09:14"));
        for t in &times {
            let at = parse_time_of_day(t).expect("HH:MM");
            let minute = at.hour() * 60 + at.minute();
            assert!(REVIEW_WINDOW.contains(&minute), "{t} out of the window");
            assert_ne!(minute % 5, 0, "{t} is a time people set");
        }
        for t in [
            "08:45", "08:50", "08:55", "09:00", "09:05", "09:10", "09:15",
        ] {
            assert!(!times.iter().any(|x| x == t), "{t} picked");
        }
        assert!(!times.iter().any(|x| x == "08:44" || x == "09:16"));
        // Every one is picked by some number, and only these are.
        let picked: std::collections::BTreeSet<String> =
            (0..24u64).map(review_time_of_day).collect();
        assert_eq!(picked.len(), 24);
        assert!(picked.iter().all(|t| times.contains(t)));
        assert_eq!(review_time_of_day(0), "08:46");
        assert_eq!(review_time_of_day(23), "09:14");
        assert_eq!(review_time_of_day(24), "08:46");
        assert!(times.contains(&review_time_of_day(u64::MAX)));
    }

    fn ny(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Tz> {
        New_York
            .with_ymd_and_hms(y, mo, d, h, mi, 0)
            .single()
            .expect("unambiguous local time")
    }

    // 2026-07-22T09:00 America/New_York (EDT, UTC-4) = 13:00Z.
    // Row timestamps use the `+00:00` shape `chrono_now_iso` actually
    // writes; fire stamps in these tests keep the `Z` shape so the
    // mixed-format parsing stays exercised.
    const CREATED_LONG_AGO: &str = "2026-07-01T00:00:00+00:00";

    #[test]
    fn not_due_before_time_of_day() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            None,
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 8, 59)));
    }

    #[test]
    fn due_at_and_after_time_of_day() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            None,
        );
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 0)));
        // Lid-sleep wake at 09:40 still owes the 09:00 fire.
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 40)));
    }

    #[test]
    fn consumed_period_is_not_refired() {
        // Fired (possibly late) at 09:40 local = 13:40Z.
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-22T13:40:00Z"),
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 10, 0)));
        // Next day it is due again.
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 23, 9, 0)));
    }

    #[test]
    fn several_missed_periods_collapse_to_one() {
        // Last fired three days ago; only the latest planned fire
        // matters, so a single due signal (which fire() then stamps).
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-19T13:00:00Z"),
        );
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 5)));
    }

    #[test]
    fn periods_before_creation_never_fire() {
        // Created 2026-07-22 10:00 local (14:00Z) — after today's 09:00.
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            "2026-07-22T14:00:00Z",
            None,
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 10, 30)));
        // Tomorrow's period is its first real fire.
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 23, 9, 0)));
    }

    #[test]
    fn catch_up_expires_at_local_midnight() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-21T13:00:00Z"), // consumed July 21's fire
        );
        // Missed all of July 22; still owed late that evening…
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 23, 59)));
        // …but past local midnight the missed run is dropped, so the
        // 08:59 tick on July 23 fires nothing and 09:00 fires today's.
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 23, 8, 59)));
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 23, 9, 0)));
    }

    #[test]
    fn creation_in_same_second_as_planned_fire_is_not_due() {
        // Created exactly AT today's planned fire instant (09:00 EDT =
        // 13:00 UTC). The period does not strictly postdate creation, so
        // it is not due — regardless of which UTC shape the row carries.
        // (The old lexicographic compare flipped on this tie: 'Z' > '+'.)
        for created in ["2026-07-22T13:00:00+00:00", "2026-07-22T13:00:00Z"] {
            let t = task(ScheduledTaskRepeat::Daily, "09:00", true, created, None);
            assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 0)), "{created}");
            // Tomorrow's period is the first real fire.
            assert!(due_fire(&t, &New_York, &ny(2026, 7, 23, 9, 0)), "{created}");
        }
    }

    #[test]
    fn manual_fire_before_planned_time_keeps_today_due() {
        // "Run now" stamps `last_fired_at` like any fire (see
        // `run_task_now`); the promise is that a manual run must never
        // eat a future planned fire. Manual run at 08:05 → today's
        // 09:00 is strictly after the new baseline and still fires.
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-22T12:05:00Z"), // manual run, 08:05 EDT today
        );
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 0)));
    }

    #[test]
    fn reenabling_does_not_rebase_the_baseline() {
        // Disabled for days, re-enabled at 10:00 (the `enabled: true`
        // brief the next tick reads): today's 09:00 is unconsumed and
        // still inside its local day, so it fires immediately. Contract,
        // not accident — `updated_at` is deliberately not consulted.
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-15T13:00:00Z"), // last consumed a week ago
        );
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 22, 10, 0)));
    }

    #[test]
    fn disabled_task_is_never_due() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            false,
            CREATED_LONG_AGO,
            None,
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 30)));
    }

    #[test]
    fn weekly_only_due_on_allowed_days() {
        // 2026-07-22 is a Wednesday (ISO 3); Monday-only schedule.
        let t = task(
            ScheduledTaskRepeat::Weekly { weekdays: vec![1] },
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-20T13:05:00Z"), // consumed Monday's fire
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 7, 22, 9, 30)));
        // Next Monday is due.
        assert!(due_fire(&t, &New_York, &ny(2026, 7, 27, 9, 0)));
    }

    #[test]
    fn preview_new_task_first_fire_is_strictly_after_now() {
        // A task being created carries `created_at = now`, so its
        // earlier period today can never be due — the preview shows
        // tomorrow when the time already passed, today when it hasn't.
        let before = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            "2026-07-22T12:00:00+00:00", // = 08:00 EDT "now"
            None,
        );
        let p = preview_fire(&before, &New_York, &ny(2026, 7, 22, 8, 0)).unwrap();
        assert!(!p.due_now);
        assert_eq!(p.next_fire_at, "2026-07-22T13:00:00+00:00"); // today 09:00 EDT

        let after = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            "2026-07-22T14:00:00+00:00", // = 10:00 EDT "now"
            None,
        );
        let p = preview_fire(&after, &New_York, &ny(2026, 7, 22, 10, 0)).unwrap();
        assert!(!p.due_now);
        assert_eq!(p.next_fire_at, "2026-07-23T13:00:00+00:00"); // tomorrow
    }

    #[test]
    fn preview_edit_reports_due_now_for_unconsumed_period() {
        // Editing an existing task whose 09:00 today is unconsumed:
        // saving fires within a tick, and the next planned fire is
        // tomorrow's — both surfaced so the form can say "fires once
        // right after saving".
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-21T13:00:00Z"), // consumed yesterday only
        );
        let p = preview_fire(&t, &New_York, &ny(2026, 7, 22, 10, 0)).unwrap();
        assert!(p.due_now);
        assert_eq!(p.next_fire_at, "2026-07-23T13:00:00+00:00");

        // Consumed today → plain "next fire tomorrow".
        let t = task(
            ScheduledTaskRepeat::Daily,
            "09:00",
            true,
            CREATED_LONG_AGO,
            Some("2026-07-22T13:00:00Z"),
        );
        let p = preview_fire(&t, &New_York, &ny(2026, 7, 22, 10, 0)).unwrap();
        assert!(!p.due_now);
        assert_eq!(p.next_fire_at, "2026-07-23T13:00:00+00:00");
    }

    #[test]
    fn preview_rejects_bad_time_of_day() {
        let t = task(
            ScheduledTaskRepeat::Daily,
            "9am",
            true,
            CREATED_LONG_AGO,
            None,
        );
        assert!(preview_fire(&t, &New_York, &ny(2026, 7, 22, 8, 0)).is_err());
    }

    #[test]
    fn dst_gap_fire_defers_until_resolved_instant_arrives() {
        // 2026-03-08 America/New_York: 02:00→03:00 gap. An 02:30 task
        // resolves to 03:00; at 03:00 wall clock it is due, and the
        // pre-gap tick (01:59) is not.
        let t = task(
            ScheduledTaskRepeat::Daily,
            "02:30",
            true,
            "2026-01-01T00:00:00Z",
            Some("2026-03-07T07:30:00Z"), // consumed Mar 7's 02:30 EST
        );
        assert!(!due_fire(&t, &New_York, &ny(2026, 3, 8, 1, 59)));
        assert!(due_fire(&t, &New_York, &ny(2026, 3, 8, 3, 0)));
    }
}
