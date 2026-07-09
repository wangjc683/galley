//! The solo Goal engine: one agent driven to budget exhaustion with
//! keep-going nudges (internal rows, visible turns), then handed to the
//! shared wrap-up in `finish`.

use std::time::{Duration, Instant};

use crate::common::{emit_json, is_live_candidate, SCHEMA_VERSION};
use crate::goal::types::*;
use crate::session::session_goal_solo_turn_value;
use galley_core_lib::api::{
    GalleyApi, GoalBrief, GoalStatus, MessageBrief, MessageRole, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;

use super::controller::{goal_budget_left, goal_budget_remaining, goal_follow_timeout};
use super::finish::{finish_goal_with_master, latest_agent_turn_index};

/// Solo Goal engine loop: drive one agent (the goal's session) to the time
/// budget, nudging it to keep working, then produce a final answer. No
/// workers, task board, waves, or master-duty SOP — the entire hive
/// coordination surface is skipped. Budget / follow / finish primitives are
/// shared with the hive path (`finish_goal_with_master` handles the
/// zero-worker case); only the loop shape and the continuation nudge are
/// solo-specific.
pub(super) async fn run_solo_goal_loop(
    galley: &SqliteGalley,
    mut goal: GoalBrief,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let Some(session_id) = goal.master_session_id.clone() else {
        // Solo needs a session to run in; without one there is nothing to
        // drive. Fail loudly rather than spin to the deadline.
        let final_goal = galley
            .update_goal_state(
                goal.id.clone(),
                GoalStatus::Failed,
                Some("Solo Goal has no session to run in.".into()),
            )
            .await?;
        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "failed",
            goal: &final_goal,
            session_id: None,
            note: Some("Solo Goal requires an attached session; none was found.".to_string()),
        })?;
        return Ok(());
    };

    let controller_started = Instant::now();
    // The objective was already sent into the session at launch; the agent
    // is (or will shortly be) working its first turn. Announce it so live
    // surfaces show the solo agent as running.
    emit_json(&GoalRunFrame {
        schema_version: SCHEMA_VERSION,
        stream: "goal",
        phase: "worker_started",
        goal: &goal,
        session_id: Some(session_id.0.clone()),
        note: Some("Solo agent running the objective.".to_string()),
    })?;

    loop {
        let snapshot = galley.goal_status_full(goal.id.clone()).await?;
        goal = snapshot.goal.clone();

        // A requested stop, or a resume that lands in Wrapping, goes
        // straight to the final answer.
        if goal.stop_requested || goal.status == GoalStatus::Wrapping {
            let finish_mode = if goal.stop_requested {
                GoalFinishMode::StopWrapUp
            } else {
                GoalFinishMode::Normal
            };
            return finish_goal_with_master(galley, snapshot, &[], supervisor, reason, finish_mode)
                .await;
        }

        if !goal_budget_left(&goal, controller_started) {
            break;
        }

        let remaining = goal_budget_remaining(&goal, controller_started);
        // The newest agent turn index BEFORE this dispatch, so `wait_solo_turn`
        // recognizes only the *new* reply this dispatch produces — not the
        // previous turn's reply (which shares the session and would otherwise
        // read as "already done", firing a burst of nudges).
        let before_agent_turn = latest_agent_turn_index(galley, &session_id).await?;

        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "continuing",
            goal: &goal,
            session_id: Some(session_id.0.clone()),
            note: None,
        })?;

        // Dispatch a working turn (visible in the user thread; only the nudge
        // row is internal) and SPAWN the runner if it isn't alive (a solo
        // session has no runner until we drive it). A bare `session.send` only
        // reaches an already-live runner, so it would pile persisted messages
        // onto a dead session — the tight-loop bug.
        session_goal_solo_turn_value(
            session_id.0.clone(),
            solo_continuation_prompt(&goal, remaining),
            supervisor.clone(),
            reason.clone(),
        )
        .await?;

        // Wait for THIS turn to actually complete before nudging again. Bound
        // by remaining budget so a wedged Running turn can't hang the loop.
        // (Spawn failure already errored at dispatch above, so reaching here
        // means the runner is up and the turn is coming — even a slow cold
        // start.)
        let turn_timeout = goal_follow_timeout(goal_budget_remaining(&goal, controller_started));
        wait_solo_turn(galley, &session_id, before_agent_turn, turn_timeout).await?;
    }

    // Budget exhausted → wrap into a final answer via the shared finish path.
    let goal = galley
        .update_goal_state(
            goal.id.clone(),
            GoalStatus::Wrapping,
            goal.latest_summary.clone(),
        )
        .await?;
    emit_json(&GoalRunFrame {
        schema_version: SCHEMA_VERSION,
        stream: "goal",
        phase: "wrapping",
        goal: &goal,
        session_id: Some(session_id.0.clone()),
        note: None,
    })?;
    let snapshot = galley.goal_status_full(goal.id.clone()).await?;
    finish_goal_with_master(
        galley,
        snapshot,
        &[],
        supervisor,
        reason,
        GoalFinishMode::Normal,
    )
    .await
}

/// Continuation nudge for the solo engine: the single agent may not declare
/// the task done while budget remains; keep improving a single current-best
/// result. Borrows the "budget-driven continuation" idea from GA's reflect
/// goal mode, but is fully Core-owned (no `goal_state.json` / `--reflect`).
fn solo_continuation_prompt(goal: &GoalBrief, remaining: Duration) -> String {
    let remaining_min = remaining.as_secs().div_ceil(60).max(1);
    format!(
        "[Galley Goal — keep going]\n\nYou are running this Goal on your own and the time budget has NOT run out (~{remaining_min} min left). You cannot declare the task finished yet — keep raising the quality of the result until the budget is reached.\n\nWork one loop now: (1) probe what is still missing, weak, or unverified; (2) produce or expand the result to address it; (3) self-check the result critically and fix the biggest problems you find. Keep a single current-best answer and only change it when the change genuinely makes it better.\n\nIf roughly 2 minutes or less remain, do not open new exploration — tighten and finalize the current best answer so it can be delivered as-is when the budget ends.\n\nYour work here is shown live to the user. End each turn with a short progress note — a few lines on what you checked and what changed — not the full work-in-progress result; you will present the complete answer at wrap-up.\n\nObjective:\n{}",
        goal.objective
    )
}

/// Did a *new* agent turn land — an Agent message with non-empty output and a
/// turn_index STRICTLY GREATER than `after_agent_turn` (the newest agent
/// turn_index that already existed when we dispatched)? This is the completion
/// signal for `wait_solo_turn`, pulled out as a pure fn so the anti-tight-loop
/// logic is unit-testable without a live bridge.
///
/// The `>` (not `>=`) against the *previous agent reply's* index is the crux:
/// a `>=` against `session.turn_count` re-matched the previous turn's reply
/// (it shares the session), so every wait returned instantly and the loop
/// fired a burst of nudges before the agent could answer once. A user nudge
/// never matches (only Agent role does); `None` means no prior agent reply, so
/// any agent reply counts.
pub(crate) fn solo_turn_produced_output(
    messages: &[MessageBrief],
    after_agent_turn: Option<u32>,
) -> bool {
    messages.iter().any(|message| {
        message.role == MessageRole::Agent
            && after_agent_turn.map_or(true, |after| message.turn_index.unwrap_or(0) > after)
            && (message
                .final_answer
                .as_deref()
                .is_some_and(|answer| !answer.trim().is_empty())
                || !message.content.trim().is_empty())
    })
}

/// Wait for the solo agent's dispatched turn to finish: the session has been
/// live and returned to idle (or a fresh Agent reply landed and the session
/// is idle). Bounded by `timeout` (remaining budget + grace) so a hung/silent
/// turn can't block past the budget.
///
/// Deliberately NO fixed "did it start?" grace. `session.goal_solo_turn`
/// already spawns the runner and errors at dispatch if that fails, so reaching
/// here means the runner is up and the turn is coming. A slow managed-GA cold
/// start keeps the session `Idle` for tens of seconds — treating that as a
/// dead session (the old 60s grace) wrapped a healthy solo goal after ~1 min,
/// right as the bridge finished warming.
async fn wait_solo_turn(
    galley: &SqliteGalley,
    session_id: &SessionId,
    after_agent_turn: Option<u32>,
    timeout: Duration,
) -> Result<(), GalleyError> {
    let started = Instant::now();
    let mut observed_live = false;
    loop {
        let session = galley.session_brief(session_id.clone()).await?;
        let live = is_live_candidate(session.status);
        if live {
            observed_live = true;
        }
        // Internal-inclusive: solo working turns are internal, so the default
        // read would never surface the agent's reply.
        let messages = galley
            .session_messages_including_internal(session_id.clone(), Some(12))
            .await?;
        let has_new_agent_turn = solo_turn_produced_output(&messages, after_agent_turn);
        // The turn cycle finished: it ran (or a reply landed) and is idle
        // again. `observed_live` guards against the pre-start Idle window so
        // we don't return before the (possibly cold-starting) turn even runs.
        if !live && (observed_live || has_new_agent_turn) {
            return Ok(());
        }
        // Budget bound: a silent/hung turn hands control back so the caller
        // re-checks budget and wraps.
        if started.elapsed() >= timeout {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
