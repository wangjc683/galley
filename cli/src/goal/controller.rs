//! Goal controller entry + shared primitives. The engines live in
//! sibling modules — `hive` (master/worker orchestration), `solo`
//! (single-agent budget loop), `finish` (shared wrap-up/synthesis) —
//! and `run_goal_controller` dispatches by `goal.mode` after the shared
//! preamble. This module also re-exports engine internals so `mod.rs`
//! and `tests.rs` keep reaching everything through `super::controller`.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::common::{emit_json, SCHEMA_VERSION};
#[cfg(test)]
pub(crate) use crate::goal::decision::{
    goal_controller_decision, goal_controller_decision_after_wait, goal_wrapping_summary,
};
#[cfg(test)]
pub(crate) use crate::goal::signals::{
    goal_drain_cap_seconds, goal_has_worker_material_signal, goal_ready_idle_worker_slot_indices,
    goal_ready_worker_slot_indices, goal_worker_has_progress_signal,
    goal_worker_has_terminal_signal, goal_worker_session_ids, goal_worker_terminal_counts,
    goal_worker_wave_baseline,
};
#[cfg(test)]
pub(crate) use crate::goal::task_seed::goal_seed_task_specs;
use crate::goal::types::*;
use galley_core_lib::api::{
    GalleyApi, GoalBrief, GoalLocale, GoalMode, GoalStatus, SessionId, GOAL_CONFIRMATION_PHRASE,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;

use super::hive::run_hive_goal_loop;
use super::solo::run_solo_goal_loop;

// Engine internals re-exported for unit tests — tests.rs reaches everything
// through `super::controller`, same façade as the signals/decision
// re-exports above.
#[cfg(test)]
pub(crate) use super::finish::{
    goal_finish_synthesis_timeout, goal_synthesis_timeout, master_final_answer_after,
};
#[cfg(test)]
pub(crate) use super::hive::{goal_master_checkpoint_event_body, goal_master_checkpoint_seen};
#[cfg(test)]
pub(crate) use super::solo::solo_turn_produced_output;

static GOAL_NARRATION_LOCALE: std::sync::OnceLock<GoalLocale> = std::sync::OnceLock::new();

/// Outcome of trying to acquire the per-goal controller lock.
pub(crate) enum ControllerLock {
    /// Lock acquired; hold the File for the controller's lifetime.
    Held(std::fs::File),
    /// No lock in force (missing workspace path on an ancient goal). The DB
    /// single-active-Goal lock is still the hard guarantee.
    Unlocked,
    /// Another controller process already holds the lock.
    Busy,
}

/// Try to acquire `<goal-workspace>/controller.lock` exclusively (advisory,
/// non-blocking). The workspace path comes from the goal row so the CLI does
/// not depend on Core's path internals.
pub(crate) fn acquire_goal_controller_lock(goal: &GoalBrief) -> ControllerLock {
    use fs2::FileExt;
    let Some(workspace) = goal.workspace_path.as_deref() else {
        return ControllerLock::Unlocked;
    };
    let dir = std::path::Path::new(workspace);
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("[goal] controller lock: create workspace dir failed: {e}");
        return ControllerLock::Unlocked;
    }
    let lock_path = dir.join("controller.lock");
    let file = match std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
    {
        Ok(file) => file,
        Err(e) => {
            eprintln!("[goal] controller lock: open failed: {e}");
            return ControllerLock::Unlocked;
        }
    };
    match file.try_lock_exclusive() {
        Ok(()) => ControllerLock::Held(file),
        Err(_) => ControllerLock::Busy,
    }
}

pub(crate) fn set_goal_narration_locale(locale: Option<String>) {
    let _ = GOAL_NARRATION_LOCALE.set(GoalLocale::parse(locale.as_deref()));
}

pub(super) fn goal_narration_locale() -> GoalLocale {
    GOAL_NARRATION_LOCALE
        .get()
        .copied()
        .unwrap_or(GoalLocale::ZhCn)
}

pub(crate) async fn run_goal_controller(
    galley: &SqliteGalley,
    mut goal: GoalBrief,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    // Per-goal controller re-entrancy lock: if another controller process is
    // already driving this Goal (e.g. startup auto-resume racing a manual
    // `goal run --resume`), exit cleanly instead of double-dispatching. Held
    // for the whole run — dropping the File releases the advisory lock. A
    // missing workspace path (only truly ancient goals) degrades to no lock;
    // the DB single-active-Goal lock remains the hard guarantee.
    let _controller_lock = match acquire_goal_controller_lock(&goal) {
        ControllerLock::Held(file) => Some(file),
        ControllerLock::Unlocked => None,
        ControllerLock::Busy => {
            eprintln!(
                "[goal] controller for {} is already running; exiting cleanly",
                goal.id
            );
            return Ok(());
        }
    };

    if !matches!(goal.status, GoalStatus::Running | GoalStatus::Wrapping) {
        return Err(GalleyError::InvalidArgs {
            message: format!("goal {} is not active (status={:?})", goal.id, goal.status),
        });
    }
    emit_json(&GoalRunFrame {
        schema_version: SCHEMA_VERSION,
        stream: "goal",
        phase: "started",
        goal: &goal,
        session_id: None,
        note: Some(format!(
            "Goal controller started. User confirmation phrase is `{GOAL_CONFIRMATION_PHRASE}`."
        )),
    })?;

    if goal.stop_requested {
        goal = galley
            .update_goal_state(
                goal.id.clone(),
                GoalStatus::Stopped,
                Some("Goal stopped before spawning workers.".into()),
            )
            .await?;
        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "stopped",
            goal: &goal,
            session_id: None,
            note: None,
        })?;
        return Ok(());
    }

    // Solo engine: one agent runs the objective to budget, no worker/task
    // machinery. Dispatch here so it inherits the controller lock, status
    // guard, started frame, and stop handling above, but skips the whole
    // hive loop below. The lock lives in this frame and is held across the
    // solo run's await.
    if goal.mode == GoalMode::Solo {
        return run_solo_goal_loop(galley, goal, supervisor, reason).await;
    }
    run_hive_goal_loop(galley, goal, supervisor, reason).await
}

pub(super) fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| compact_text(line, 600))
}

pub(super) fn compact_text(text: &str, max_chars: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max_chars {
        return one_line;
    }
    let mut out: String = one_line.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

pub(super) fn push_limited(out: &mut String, text: &str, max_chars: usize) {
    if out.chars().count() >= max_chars {
        return;
    }
    let remaining = max_chars.saturating_sub(out.chars().count());
    if text.chars().count() <= remaining {
        out.push_str(text);
    } else {
        out.extend(text.chars().take(remaining.saturating_sub(1)));
        out.push('…');
    }
}

/// Truthful "is the session busy" poll for the goal wait loops. Asks
/// Core's `session.run_state` (runner registry + outbound-queue run
/// gate — closes only on RunComplete, so a multi-step turn reads busy
/// across its inter-step gaps). Falls back to the legacy DB-status read
/// when the probe fails (older Core without the command) — that read is
/// known-blind for desktop sessions (`sessions.status` persists as
/// `idle`), but blind-and-bounded beats hanging on a probe error.
pub(super) async fn goal_session_is_busy(
    galley: &SqliteGalley,
    session_id: &SessionId,
) -> Result<bool, GalleyError> {
    if let Ok(state) = crate::session::session_run_state_value(session_id.0.clone()).await {
        if let Some(busy) = crate::goal::signals::goal_run_state_busy(&state) {
            return Ok(busy);
        }
    }
    let session = galley.session_brief(session_id.clone()).await?;
    Ok(crate::common::is_live_candidate(session.status))
}

/// Grace added on top of the remaining goal budget when bounding the
/// follow phase: streaming may legitimately outlive the budget by the
/// drain window, and cutting follow exactly at the deadline would race
/// the deadline checkpoint.
const GOAL_FOLLOW_TIMEOUT_GRACE: Duration = Duration::from_secs(300);
/// Floor for the follow bound so a goal already past its deadline
/// still gets one streaming pass instead of a zero-length timeout.
const GOAL_FOLLOW_TIMEOUT_FLOOR: Duration = Duration::from_secs(60);

/// Outer bound for the until-idle follow phase: remaining goal budget
/// plus a grace margin, floored. This is a stuck-session backstop, not
/// a scheduler — a healthy follow returns on its own well before this.
pub(crate) fn goal_follow_timeout(budget_remaining: Duration) -> Duration {
    budget_remaining
        .saturating_add(GOAL_FOLLOW_TIMEOUT_GRACE)
        .max(GOAL_FOLLOW_TIMEOUT_FLOOR)
}

/// Remaining goal budget as a duration (zero once spent). Mirrors
/// `goal_budget_left`: an explicit deadline wins over the relative
/// budget counted from controller start.
pub(super) fn goal_budget_remaining(goal: &GoalBrief, controller_started: Instant) -> Duration {
    if let Some(deadline) = parse_goal_iso_seconds(&goal.deadline_at) {
        return Duration::from_secs(deadline.saturating_sub(unix_now_seconds()).max(0) as u64);
    }
    Duration::from_secs(u64::from(goal.budget_seconds.max(60)))
        .saturating_sub(controller_started.elapsed())
}

pub(super) fn goal_budget_left(goal: &GoalBrief, controller_started: Instant) -> bool {
    if let Some(deadline) = parse_goal_iso_seconds(&goal.deadline_at) {
        return unix_now_seconds() < deadline;
    }
    controller_started.elapsed() < Duration::from_secs(u64::from(goal.budget_seconds.max(60)))
}

fn parse_goal_iso_seconds(value: &str) -> Option<i64> {
    let year = value.get(0..4)?.parse::<i64>().ok()?;
    let month = value.get(5..7)?.parse::<i64>().ok()?;
    let day = value.get(8..10)?.parse::<i64>().ok()?;
    let hour = value.get(11..13)?.parse::<i64>().ok()?;
    let minute = value.get(14..16)?.parse::<i64>().ok()?;
    let second = value.get(17..19)?.parse::<i64>().ok()?;
    if value.get(4..5)? != "-"
        || value.get(7..8)? != "-"
        || value.get(10..11)? != "T"
        || value.get(13..14)? != ":"
        || value.get(16..17)? != ":"
    {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn unix_now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
