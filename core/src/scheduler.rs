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

use std::sync::Arc;

use chrono::{DateTime, Local, TimeZone};
use tauri::Manager;

use crate::api::schedule::{
    instant_to_utc_iso, parse_time_of_day, prev_fire_at_or_before, resolve_wall_clock,
    ScheduledTaskBrief, SCHEDULED_TASKS_CHANGED_EVENT,
};
use crate::api::{GalleyApi, ScheduledTaskId};
use crate::db::SqliteGalley;
use crate::protocol::{SessionNewArgs, SessionNewResult, SocketRequest, SCHEMA_VERSION};
use crate::runner_manager::RunnerManager;
use crate::socket_listener::{dispatch_line_with, DbSource, DispatchResult, HandlerCtx};

const TICK_SECONDS: u64 = 60;

/// Supervisor label stamped on scheduler-created sessions, following
/// the `galley-desktop` / `galley-core` convention of the Goal
/// controller spawns. Mirrored as `SCHEDULER_SUPERVISOR` in
/// `gui/src/lib/scheduled-tasks.ts` (badge + sidebar marker) and pinned
/// by `gui/src/lib/scheduled-tasks.test.ts` — a rename must land on
/// both sides.
const SCHEDULER_SUPERVISOR: &str = "galley-scheduler";

pub(crate) fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    // Same injection as `resume_active_goals`: the pool is managed
    // state by setup time — the loop holds it instead of re-opening the
    // global on every tick.
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
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
        .filter(|t| due_fire(t, &Local, &now))
        .collect();
    if due.is_empty() {
        return;
    }
    // Compose the production adapters behind the HandlerCtx seam once
    // per tick; `fire` itself never touches Tauri directly.
    let db = DbSource::Pool(galley.clone());
    let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.as_ref(),
        notifier: crate::notify::TauriNotifier::new(app.clone()),
        app: Some(app),
    };
    for task in &due {
        fire(&ctx, task, &now).await;
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
        // Normally unreachable — the list read already skips (and logs)
        // corrupt rows. Fail closed for any other caller.
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
    // Baseline: whatever is later of "last consumed period" and "task
    // exists since" — periods before creation, and re-fires within a
    // consumed period, are out. Compared as parsed instants, never as
    // strings: the DB holds both `+00:00` (row timestamps) and `Z`
    // (fire stamps written before the formatters were unified), and
    // lexicographically `'Z' > '+'` flips exact-second ties.
    let Some(created) = parse_utc_secs(&task.created_at) else {
        // Unparseable created_at (manual DB edit): fail closed.
        return false;
    };
    let last = task.last_fired_at.as_deref().and_then(parse_utc_secs);
    let baseline = last.map_or(created, |l| l.max(created));
    prev_instant.timestamp() > baseline
}

/// Second-resolution UTC instant of an ISO-8601 timestamp; `None` when
/// unparseable (callers fail closed).
fn parse_utc_secs(iso: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(iso).ok().map(|dt| dt.timestamp())
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
    let request = SocketRequest {
        command: "session.new".into(),
        args: serde_json::to_value(SessionNewArgs {
            task: task.prompt.clone(),
            project_id: task.project_id.as_ref().map(|p| p.as_str().to_string()),
            llm_name: resolve_task_llm(&galley, task).await,
            runtime_kind: None,
            supervisor: Some(SCHEDULER_SUPERVISOR.into()),
            reason: Some(format!("scheduled task {}", task.id)),
        })
        .expect("SessionNewArgs serializes"),
        request_id: None,
        schema_version: SCHEMA_VERSION,
    };
    let line = serde_json::to_string(&request).expect("SocketRequest serializes");

    let session_id = match dispatch_line_with(ctx, &line).await {
        DispatchResult::Unary(resp) if resp.ok => resp.result.and_then(|r| {
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
    ctx.notify(SCHEDULED_TASKS_CHANGED_EVENT, &());
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
