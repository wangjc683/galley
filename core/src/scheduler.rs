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
//! Firing goes through the production `session.new` socket dispatch
//! (`dispatch_line_with`) — the same create + persist + spawn +
//! dispatch + GUI-event path a supervisor uses; no scheduler-private
//! session plumbing. A fire whose session creation fails still consumes
//! its period (`last_fired_at` stamped, `last_run_session_id` NULL) so
//! the GUI can show the failure instead of the loop retrying every
//! minute against a broken runner.

use std::sync::Arc;

use chrono::{DateTime, Local, TimeZone};
use tauri::{Emitter, Manager};

use crate::api::schedule::{
    instant_to_utc_iso, parse_time_of_day, prev_fire_at_or_before, resolve_wall_clock,
    ScheduledTaskBrief, SCHEDULED_TASKS_CHANGED_EVENT,
};
use crate::api::{GalleyApi, ScheduledTaskId, SessionId};
use crate::db::SqliteGalley;
use crate::protocol::{SessionNewArgs, SocketRequest, SCHEMA_VERSION};
use crate::runner_manager::RunnerManager;
use crate::socket_listener::{dispatch_line_with, DbSource, DispatchResult, HandlerCtx};

const TICK_SECONDS: u64 = 60;

/// Supervisor label stamped on scheduler-created sessions, following
/// the `galley-desktop` / `galley-core` convention of the Goal
/// controller spawns.
const SCHEDULER_SUPERVISOR: &str = "galley-scheduler";

pub(crate) fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(TICK_SECONDS));
        // After a long sleep the timer owes many ticks; the due check is
        // wall-clock-derived, so bursting through them is pure noise.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            // First tick fires immediately → an app launched at 09:30
            // catches up a missed 09:00 without waiting a minute.
            interval.tick().await;
            tick(&handle).await;
        }
    });
}

async fn tick(app: &tauri::AppHandle) {
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        // DB not openable (first run before GUI init, transient IO):
        // skip quietly, next tick retries. Not worth a per-minute log.
        Err(_) => return,
    };
    let tasks = match galley.list_scheduled_tasks().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[scheduler] list scheduled tasks failed: {e:?}");
            return;
        }
    };
    let now = Local::now();
    for task in tasks {
        if due_fire(&task, &Local, &now) {
            fire(app, &galley, &task, &now).await;
        }
    }
}

/// Pure due check: is this task's most recent planned fire still
/// unconsumed? Generic over the timezone so DST behavior is unit-tested
/// with real tz data (production passes `chrono::Local`).
fn due_fire<Tz: TimeZone>(task: &ScheduledTaskBrief, tz: &Tz, now: &DateTime<Tz>) -> bool {
    if !task.enabled {
        return false;
    }
    let Ok(tod) = parse_time_of_day(&task.time_of_day) else {
        // Corrupt row; validation prevents this, don't loop-log on it.
        return false;
    };
    let prev = prev_fire_at_or_before(&task.repeat, tod, now.naive_local());
    // Catch-up is bounded to the planned fire's own local day — a
    // missed run older than that is dropped, not fired retroactively.
    if prev.date() != now.naive_local().date() {
        return false;
    }
    let prev_instant = resolve_wall_clock(tz, prev);
    // A DST spring-forward gap can resolve "02:30" to an instant a few
    // minutes in the future; that fire belongs to a later tick.
    if prev_instant > *now {
        return false;
    }
    let prev_iso = instant_to_utc_iso(&prev_instant);
    // ISO-8601 Z strings order lexicographically. Baseline: whatever is
    // later of "last consumed period" and "task exists since" — periods
    // before creation, and re-fires within a consumed period, are out.
    let baseline = match &task.last_fired_at {
        Some(last) if last.as_str() >= task.created_at.as_str() => last.as_str(),
        _ => task.created_at.as_str(),
    };
    prev_iso.as_str() > baseline
}

/// Best-effort per-task model: pre-resolve the pinned display name
/// against the active runtime so an unresolvable pin (model deleted,
/// runtime switched) degrades to the default model instead of failing
/// the whole fire inside `session.new` — a digest on the wrong model
/// beats a digest that silently never ran. Same contract as the Goal
/// launch LLM selection.
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

async fn fire<Tz: TimeZone>(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
    task: &ScheduledTaskBrief,
    now: &DateTime<Tz>,
) {
    let request = SocketRequest {
        command: "session.new".into(),
        args: serde_json::to_value(SessionNewArgs {
            task: task.prompt.clone(),
            project_id: task.project_id.as_ref().map(|p| p.as_str().to_string()),
            llm_name: resolve_task_llm(galley, task).await,
            runtime_kind: None,
            supervisor: Some(SCHEDULER_SUPERVISOR.into()),
            reason: Some(format!("scheduled task {}", task.id)),
        })
        .expect("SessionNewArgs serializes"),
        request_id: None,
        schema_version: SCHEMA_VERSION,
    };
    let line = serde_json::to_string(&request).expect("SocketRequest serializes");

    let db = DbSource::Global;
    let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.as_ref(),
        notifier: crate::notify::TauriNotifier::new(app.clone()),
        app: Some(app),
    };

    let session_id = match dispatch_line_with(&ctx, &line).await {
        DispatchResult::Unary(resp) if resp.ok => resp
            .result
            .as_ref()
            .and_then(|r| r.get("session"))
            .and_then(|s| s.get("id"))
            .and_then(|id| id.as_str())
            .map(|id| SessionId(id.to_string())),
        DispatchResult::Unary(resp) => {
            eprintln!(
                "[scheduler] task {} fire failed: {} {}",
                task.id,
                resp.error.as_deref().unwrap_or("?"),
                resp.message.as_deref().unwrap_or("")
            );
            None
        }
        // session.new never streams; treat it like a failed fire.
        DispatchResult::Stream { .. } => {
            eprintln!("[scheduler] task {} fire returned a stream", task.id);
            None
        }
    };

    // Stamp the period consumed even on failure — the GUI renders
    // "fired but no session" as a failed run, and the loop must not
    // retry a broken runner every minute.
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
    let _ = app.emit(SCHEDULED_TASKS_CHANGED_EVENT, ());
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
            created_at: created_at.into(),
            updated_at: created_at.into(),
        }
    }

    fn ny(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Tz> {
        New_York
            .with_ymd_and_hms(y, mo, d, h, mi, 0)
            .single()
            .expect("unambiguous local time")
    }

    // 2026-07-22T09:00 America/New_York (EDT, UTC-4) = 13:00Z.
    const CREATED_LONG_AGO: &str = "2026-07-01T00:00:00Z";

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
