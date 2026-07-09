//! The hive Goal engine: master planning, seed/fallback tasks, worker
//! waves, and the wait/reminder machinery around them. Entered from
//! `controller::run_goal_controller` after the shared preamble (lock,
//! status guard, started frame, stop short-circuit); wrap-up is shared
//! with solo in `finish`.

use std::time::{Duration, Instant};

use crate::args::RuntimeArg;
use crate::common::{emit_json, is_live_candidate, runtime_arg_from_kind, SCHEMA_VERSION};
use crate::goal::decision::{
    goal_controller_decision, goal_controller_decision_after_wait, goal_failure_summary,
    goal_wrapping_summary,
};
use crate::goal::prompts::{
    goal_master_planning_prompt, goal_worker_prompt_template, goal_worker_protocol_reminder_prompt,
    goal_worker_wake_prompt,
};
use crate::goal::signals::{
    goal_activity_counts, goal_activity_increased, goal_any_worker_slot_has_progress_signal,
    goal_drain_cap_seconds, goal_has_incomplete_tasks, goal_has_result_signal,
    goal_has_worker_material_signal, goal_ready_idle_worker_slot_indices,
    goal_summary_event_is_new, goal_worker_has_terminal_signal, goal_worker_max_wave,
    goal_worker_session_ids, goal_worker_slot_session_ids, goal_worker_slots_all_capped,
    goal_worker_wave_baseline,
};
use crate::goal::task_seed::{
    goal_has_open_assigned_task, goal_open_assigned_task_for_worker, goal_seed_task_specs,
    goal_worker_slot_exists,
};
use crate::goal::types::*;
use crate::project::project_follow;
use crate::session::{
    session_checkpoint_value, session_goal_master_plan_value, session_new_goal_worker_value,
    session_send_value, session_shutdown_runner_value,
};
use galley_core_lib::api::{
    goal_checkpoint_deadline_reached, goal_checkpoint_first_material,
    goal_checkpoint_planning_started, goal_checkpoint_workers_started, CreateGoalEventInput,
    CreateGoalTaskInput, GalleyApi, GoalBrief, GoalEventType, GoalId, GoalStatus,
    GoalStatusSnapshot, MessageRole, RuntimeKind, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use serde_json::Value;

use super::controller::{
    goal_budget_left, goal_budget_remaining, goal_follow_timeout, goal_narration_locale,
};
use super::finish::finish_goal_with_master;

/// The hive loop proper. `run_goal_controller` owns the shared preamble and
/// holds the controller lock across this await.
pub(super) async fn run_hive_goal_loop(
    galley: &SqliteGalley,
    mut goal: GoalBrief,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let runtime = runtime_arg_from_kind(goal.runtime_kind);
    // Attach masters read Galley's own SOP copy from disk (they can't read
    // the seeded memory file, and Galley must not write the user's GA
    // checkout). Materialize it once before planning; managed reads its
    // memory copy and ignores this.
    if goal.runtime_kind == RuntimeKind::External {
        let _ = galley_core_lib::ensure_goal_master_duty_sop();
    }
    let controller_started = Instant::now();
    let mut worker_session_ids: Vec<SessionId> = Vec::new();
    let mut worker_slots: Vec<GoalWorkerSlot> = Vec::new();
    loop {
        // Wrapping enters synthesis in both flavors: budget/wave-cap wraps
        // run the full synthesis, a requested stop runs the brief wrap-up.
        // This also covers "stop requested, controller crashed, resumed".
        if goal.status == GoalStatus::Wrapping {
            let mode = if goal.stop_requested {
                GoalFinishMode::StopWrapUp
            } else {
                GoalFinishMode::Normal
            };
            let snapshot = galley.goal_status_full(goal.id.clone()).await?;
            finish_goal_with_master(
                galley,
                snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason.clone(),
                mode,
            )
            .await?;
            return Ok(());
        }

        let wave_start_snapshot = galley.goal_status_full(goal.id.clone()).await?;
        goal = wave_start_snapshot.goal.clone();
        if goal.stop_requested {
            // Race-window catch (stop landing between the loop-top fetch
            // and this one): same brief wrap-up as the loop-top path.
            // `finish_goal_with_master` stops instantly when there is no
            // material worth accounting for.
            let summary = "Stop requested before the next worker wave; wrapping up.".to_string();
            galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: goal.id.clone(),
                    task_id: None,
                    author_session_id: None,
                    event_type: GoalEventType::Synthesis,
                    body: summary.clone(),
                })
                .await?;
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "wrapping",
                goal: &goal,
                session_id: None,
                note: Some(summary),
            })?;
            finish_goal_with_master(
                galley,
                wave_start_snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason
                    .clone()
                    .or_else(|| Some(format!("goal {} stopped", goal.id))),
                GoalFinishMode::StopWrapUp,
            )
            .await?;
            return Ok(());
        }
        if !goal_budget_left(&goal, controller_started) {
            let incomplete_tasks = goal_has_incomplete_tasks(&wave_start_snapshot);
            let protocol_result_signal = goal_has_result_signal(&wave_start_snapshot);
            let accumulated_worker_output_signal = if protocol_result_signal {
                false
            } else {
                goal_worker_sessions_have_output(galley, &worker_session_ids).await?
            };
            let has_synthesis_material = protocol_result_signal
                || accumulated_worker_output_signal
                || goal_has_worker_material_signal(&wave_start_snapshot);
            if has_synthesis_material {
                post_goal_master_checkpoint(
                    galley,
                    &wave_start_snapshot,
                    GoalMasterCheckpointKind::FirstMaterial,
                    goal_checkpoint_first_material(goal_narration_locale()).to_string(),
                    supervisor.clone(),
                    reason.clone(),
                )
                .await?;
            }
            post_goal_master_checkpoint(
                galley,
                &wave_start_snapshot,
                GoalMasterCheckpointKind::DeadlineReached,
                goal_checkpoint_deadline_reached(goal_narration_locale()).to_string(),
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
            match goal_controller_decision(
                false,
                has_synthesis_material,
                goal_worker_slots_all_capped(&worker_slots),
            ) {
                GoalControllerDecision::Wrap(wrap_reason) => {
                    let summary = goal_wrapping_summary(wrap_reason, incomplete_tasks);
                    galley
                        .create_goal_event(CreateGoalEventInput {
                            goal_id: goal.id.clone(),
                            task_id: None,
                            author_session_id: None,
                            event_type: GoalEventType::Synthesis,
                            body: summary.clone(),
                        })
                        .await?;
                    let wrapping_goal = galley
                        .update_goal_state(goal.id.clone(), GoalStatus::Wrapping, Some(summary))
                        .await?;
                    emit_json(&GoalRunFrame {
                        schema_version: SCHEMA_VERSION,
                        stream: "goal",
                        phase: "wrapping",
                        goal: &wrapping_goal,
                        session_id: None,
                        note: wrapping_goal.latest_summary.clone(),
                    })?;
                    finish_goal_with_master(
                        galley,
                        galley.goal_status_full(wrapping_goal.id.clone()).await?,
                        &worker_session_ids,
                        supervisor.clone(),
                        reason.clone().or_else(|| {
                            Some(format!("goal master synthesis after {wrap_reason:?}"))
                        }),
                        GoalFinishMode::Normal,
                    )
                    .await?;
                    return Ok(());
                }
                GoalControllerDecision::Fail(reason) => {
                    let summary = goal_failure_summary(reason);
                    shutdown_goal_worker_runners(
                        galley,
                        &wave_start_snapshot,
                        &worker_session_ids,
                        supervisor.clone(),
                        Some(format!("goal {} failed before next wave", goal.id)),
                    )
                    .await;
                    galley
                        .create_goal_event(CreateGoalEventInput {
                            goal_id: goal.id.clone(),
                            task_id: None,
                            author_session_id: None,
                            event_type: GoalEventType::Synthesis,
                            body: summary.clone(),
                        })
                        .await?;
                    let final_goal = galley
                        .update_goal_state(goal.id.clone(), GoalStatus::Failed, Some(summary))
                        .await?;
                    emit_json(&GoalRunFrame {
                        schema_version: SCHEMA_VERSION,
                        stream: "goal",
                        phase: "failed",
                        goal: &final_goal,
                        session_id: None,
                        note: final_goal.latest_summary.clone(),
                    })?;
                    return Ok(());
                }
                // Unreachable by construction: budget_left is hardcoded
                // false in this call, so goal_controller_decision only
                // returns Wrap or Fail here.
                GoalControllerDecision::Continue | GoalControllerDecision::WaitForSignal => {}
            }
        }
        let wave_start_activity = goal_activity_counts(&wave_start_snapshot);

        if worker_slots.is_empty() {
            let worker_start_snapshot = ensure_goal_master_planned_or_fallback(
                galley,
                &wave_start_snapshot,
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
            let new_slots = start_goal_worker_slots(
                galley,
                &worker_start_snapshot,
                &goal,
                &worker_slots,
                runtime,
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
            worker_slots.extend(new_slots);
            worker_session_ids = goal_worker_slot_session_ids(&worker_slots);
            if !worker_slots.is_empty() {
                let checkpoint_snapshot = galley.goal_status_full(goal.id.clone()).await?;
                post_goal_master_checkpoint(
                    galley,
                    &checkpoint_snapshot,
                    GoalMasterCheckpointKind::WorkersStarted,
                    goal_checkpoint_workers_started(goal_narration_locale(), worker_slots.len()),
                    supervisor.clone(),
                    reason.clone(),
                )
                .await?;
            }
        }

        // Stream live output from this goal's own sessions only (master +
        // workers). Following the whole project let user chatter in
        // unrelated sessions reset the until-idle quiet window forever,
        // burning the goal budget. And a follow failure must not abort
        // the goal — streaming is a nicety; progress detection happens in
        // wait_goal_worker_sessions below.
        let mut follow_scope: Vec<String> = goal
            .master_session_id
            .iter()
            .map(|sid| sid.0.clone())
            .collect();
        follow_scope.extend(
            goal_worker_session_ids(&wave_start_snapshot, &worker_session_ids)
                .into_iter()
                .map(|sid| sid.0),
        );
        // The until-idle follow is the controller's only wait without its
        // own bound: a worker stuck at status Running with a silent bridge
        // (hung LLM call, wedged tool, stale status row) resets the quiet
        // window forever and budget/deadline enforcement below never runs.
        // Bound it by the remaining goal budget plus a grace margin so a
        // healthy goal is never cut short; on timeout treat it as an idle
        // return and let the existing budget logic take over wrap-up.
        let follow_timeout = goal_follow_timeout(goal_budget_remaining(&goal, controller_started));
        // Hive always mints a project at start; a missing one is a data
        // anomaly. `None` skips the follow and falls through to the
        // budget/deadline enforcement below rather than crashing.
        let follow_result = match goal.project_id.as_ref() {
            Some(project_id) => Some(
                tokio::time::timeout(
                    follow_timeout,
                    project_follow(
                        project_id.0.clone(),
                        80,
                        false,
                        true,
                        true,
                        Some(follow_scope),
                    ),
                )
                .await,
            ),
            None => None,
        };
        match follow_result {
            None | Some(Ok(Ok(()))) => {}
            Some(Ok(Err(err))) => {
                let _ = emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "follow_interrupted",
                    goal: &goal,
                    session_id: None,
                    note: Some(format!("project follow interrupted: {err}")),
                });
            }
            Some(Err(_)) => {
                let note = format!(
                    "Follow phase hit its {}s bound without the goal's sessions going idle; returning control to the controller loop so budget/deadline enforcement can run.",
                    follow_timeout.as_secs()
                );
                let _ = galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: goal.id.clone(),
                        task_id: None,
                        author_session_id: None,
                        event_type: GoalEventType::System,
                        body: note.clone(),
                    })
                    .await;
                let _ = emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "follow_timeout",
                    goal: &goal,
                    session_id: None,
                    note: Some(note),
                });
            }
        }
        let wait_outcome = wait_goal_worker_sessions(
            galley,
            &mut worker_slots,
            &goal,
            controller_started,
            supervisor.clone(),
            reason.clone(),
        )
        .await?;

        let mut snapshot = galley.goal_status_full(goal.id.clone()).await?;
        let refreshed = snapshot.goal.clone();
        if refreshed.stop_requested {
            // Stop landed while a wave was running: the finished wave's
            // output is exactly what the brief wrap-up should account for.
            let summary = "Worker wave finished after stop request; wrapping up.".to_string();
            galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: refreshed.id.clone(),
                    task_id: None,
                    author_session_id: None,
                    event_type: GoalEventType::Synthesis,
                    body: summary.clone(),
                })
                .await?;
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "wrapping",
                goal: &refreshed,
                session_id: None,
                note: Some(summary),
            })?;
            finish_goal_with_master(
                galley,
                snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason
                    .clone()
                    .or_else(|| Some(format!("goal {} stopped", refreshed.id))),
                GoalFinishMode::StopWrapUp,
            )
            .await?;
            return Ok(());
        }

        let incomplete_tasks = goal_has_incomplete_tasks(&snapshot);
        let budget_left = goal_budget_left(&refreshed, controller_started);
        let protocol_result_signal = goal_has_result_signal(&snapshot);
        let accumulated_worker_output_signal = if protocol_result_signal {
            false
        } else {
            goal_worker_sessions_have_output(galley, &worker_session_ids).await?
        };
        let has_result_signal = protocol_result_signal || accumulated_worker_output_signal;
        let has_synthesis_material =
            has_result_signal || goal_has_worker_material_signal(&snapshot);
        if has_synthesis_material {
            post_goal_master_checkpoint(
                galley,
                &snapshot,
                GoalMasterCheckpointKind::FirstMaterial,
                goal_checkpoint_first_material(goal_narration_locale()).to_string(),
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
        }
        if !budget_left {
            post_goal_master_checkpoint(
                galley,
                &snapshot,
                GoalMasterCheckpointKind::DeadlineReached,
                goal_checkpoint_deadline_reached(goal_narration_locale()).to_string(),
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
        }
        let wave_protocol_activity =
            goal_activity_increased(wave_start_activity, goal_activity_counts(&snapshot));
        let mut decision_wait_outcome = wait_outcome.clone();

        if let GoalWorkerWaitOutcome::ReadySlots(ready_slot_indices) = wait_outcome.clone() {
            if budget_left {
                snapshot = ensure_goal_master_planned_or_fallback(
                    galley,
                    &snapshot,
                    supervisor.clone(),
                    reason.clone(),
                )
                .await?;
                let new_slots = start_goal_worker_slots(
                    galley,
                    &snapshot,
                    &refreshed,
                    &worker_slots,
                    runtime,
                    supervisor.clone(),
                    reason.clone(),
                )
                .await?;
                worker_slots.extend(new_slots);
                let mut continued_workers = Vec::new();
                for slot_index in ready_slot_indices {
                    if let Some(slot) = worker_slots.get_mut(slot_index) {
                        let worker_index = slot.worker_index;
                        if continue_goal_worker_slot(
                            galley,
                            &snapshot,
                            &refreshed,
                            slot,
                            supervisor.clone(),
                            reason.clone(),
                        )
                        .await?
                        {
                            continued_workers.push(worker_index);
                        }
                    }
                }
                worker_session_ids = goal_worker_slot_session_ids(&worker_slots);
                if !continued_workers.is_empty() {
                    let summary = goal_slot_wake_summary(
                        &continued_workers,
                        has_result_signal,
                        incomplete_tasks,
                    );
                    galley
                        .create_goal_event(CreateGoalEventInput {
                            goal_id: refreshed.id.clone(),
                            task_id: None,
                            author_session_id: None,
                            event_type: GoalEventType::Synthesis,
                            body: summary.clone(),
                        })
                        .await?;
                    let continuing_goal = galley
                        .update_goal_state(refreshed.id.clone(), GoalStatus::Running, Some(summary))
                        .await?;
                    emit_json(&GoalRunFrame {
                        schema_version: SCHEMA_VERSION,
                        stream: "goal",
                        phase: "continuing",
                        goal: &continuing_goal,
                        session_id: None,
                        note: continuing_goal.latest_summary.clone(),
                    })?;
                    goal = continuing_goal;
                    continue;
                }
                decision_wait_outcome = GoalWorkerWaitOutcome::IdleWithoutSignal;
            }
        }

        match goal_controller_decision_after_wait(
            decision_wait_outcome.clone(),
            budget_left,
            has_synthesis_material,
            goal_worker_slots_all_capped(&worker_slots),
        ) {
            GoalControllerDecision::WaitForSignal => {
                let summary = goal_waiting_for_worker_signal_summary(
                    goal_worker_max_wave(&worker_slots),
                    wave_protocol_activity,
                );
                if goal_summary_event_is_new(refreshed.latest_summary.as_deref(), &summary) {
                    galley
                        .create_goal_event(CreateGoalEventInput {
                            goal_id: refreshed.id.clone(),
                            task_id: None,
                            author_session_id: None,
                            event_type: GoalEventType::Synthesis,
                            body: summary.clone(),
                        })
                        .await?;
                }
                let waiting_goal = galley
                    .update_goal_state(refreshed.id.clone(), GoalStatus::Running, Some(summary))
                    .await?;
                emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "waiting",
                    goal: &waiting_goal,
                    session_id: None,
                    note: waiting_goal.latest_summary.clone(),
                })?;
                goal = waiting_goal;
                tokio::time::sleep(Duration::from_millis(1500)).await;
                continue;
            }
            GoalControllerDecision::Continue => {
                let summary = goal_waiting_for_worker_signal_summary(
                    goal_worker_max_wave(&worker_slots),
                    wave_protocol_activity,
                );
                if goal_summary_event_is_new(refreshed.latest_summary.as_deref(), &summary) {
                    galley
                        .create_goal_event(CreateGoalEventInput {
                            goal_id: refreshed.id.clone(),
                            task_id: None,
                            author_session_id: None,
                            event_type: GoalEventType::Synthesis,
                            body: summary.clone(),
                        })
                        .await?;
                }
                let continuing_goal = galley
                    .update_goal_state(refreshed.id.clone(), GoalStatus::Running, Some(summary))
                    .await?;
                emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "continuing",
                    goal: &continuing_goal,
                    session_id: None,
                    note: continuing_goal.latest_summary.clone(),
                })?;
                goal = continuing_goal;
                tokio::time::sleep(Duration::from_millis(1500)).await;
                continue;
            }
            GoalControllerDecision::Fail(reason) => {
                let summary = goal_failure_summary(reason);
                shutdown_goal_worker_runners(
                    galley,
                    &snapshot,
                    &worker_session_ids,
                    supervisor.clone(),
                    Some(format!("goal {} failed after worker wave", refreshed.id)),
                )
                .await;
                galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: refreshed.id.clone(),
                        task_id: None,
                        author_session_id: None,
                        event_type: GoalEventType::Synthesis,
                        body: summary.clone(),
                    })
                    .await?;
                let final_goal = galley
                    .update_goal_state(refreshed.id.clone(), GoalStatus::Failed, Some(summary))
                    .await?;
                emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "failed",
                    goal: &final_goal,
                    session_id: None,
                    note: final_goal.latest_summary.clone(),
                })?;
                return Ok(());
            }
            GoalControllerDecision::Wrap(wrap_reason) => {
                let wrap_reason = match (wrap_reason, decision_wait_outcome) {
                    (GoalWrapReason::Deadline, GoalWorkerWaitOutcome::DrainCapReached) => {
                        GoalWrapReason::DrainCap
                    }
                    _ => wrap_reason,
                };
                let summary = goal_wrapping_summary(wrap_reason, incomplete_tasks);
                galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: refreshed.id.clone(),
                        task_id: None,
                        author_session_id: None,
                        event_type: GoalEventType::Synthesis,
                        body: summary.clone(),
                    })
                    .await?;
                let wrapping_goal = galley
                    .update_goal_state(refreshed.id.clone(), GoalStatus::Wrapping, Some(summary))
                    .await?;
                emit_json(&GoalRunFrame {
                    schema_version: SCHEMA_VERSION,
                    stream: "goal",
                    phase: "wrapping",
                    goal: &wrapping_goal,
                    session_id: None,
                    note: wrapping_goal.latest_summary.clone(),
                })?;
                finish_goal_with_master(
                    galley,
                    galley.goal_status_full(wrapping_goal.id.clone()).await?,
                    &worker_session_ids,
                    supervisor.clone(),
                    reason
                        .clone()
                        .or_else(|| Some(format!("goal master synthesis after {wrap_reason:?}"))),
                    GoalFinishMode::Normal,
                )
                .await?;
                return Ok(());
            }
        }
    }
}

async fn post_goal_master_checkpoint(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    kind: GoalMasterCheckpointKind,
    content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<bool, GalleyError> {
    let Some(master_session_id) = snapshot.goal.master_session_id.clone() else {
        return Ok(false);
    };
    if goal_master_checkpoint_seen(snapshot, kind) {
        return Ok(false);
    }
    session_checkpoint_value(
        master_session_id.0.clone(),
        content.clone(),
        Some(snapshot.goal.id.to_string()),
        supervisor.clone(),
        reason.clone().or_else(|| {
            Some(format!(
                "goal {} master checkpoint: {}",
                snapshot.goal.id,
                kind.reason_label()
            ))
        }),
    )
    .await?;
    galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: snapshot.goal.id.clone(),
            task_id: None,
            author_session_id: Some(master_session_id),
            event_type: GoalEventType::System,
            body: goal_master_checkpoint_event_body(kind, &content),
        })
        .await?;
    Ok(true)
}

pub(crate) fn goal_master_checkpoint_seen(
    snapshot: &GoalStatusSnapshot,
    kind: GoalMasterCheckpointKind,
) -> bool {
    let marker = kind.marker();
    snapshot.events.iter().any(|event| {
        event.event_type == GoalEventType::System
            && event.author_session_id.as_ref() == snapshot.goal.master_session_id.as_ref()
            && event.body.starts_with(marker)
    })
}

pub(crate) fn goal_master_checkpoint_event_body(
    kind: GoalMasterCheckpointKind,
    content: &str,
) -> String {
    format!("{} {}", kind.marker(), content)
}

async fn ensure_goal_master_planned_or_fallback(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<GoalStatusSnapshot, GalleyError> {
    if goal_has_open_assigned_task(snapshot) {
        return Ok(snapshot.clone());
    }

    let planned =
        match run_goal_master_planning_turn(galley, snapshot, supervisor.clone(), reason.clone())
            .await
        {
            Ok(s) => s,
            Err(e) => {
                let _ = galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: snapshot.goal.id.clone(),
                        task_id: None,
                        author_session_id: snapshot.goal.master_session_id.clone(),
                        event_type: GoalEventType::System,
                        body: format!("{GOAL_MASTER_PLANNING_MARKER} failed: {e}"),
                    })
                    .await;
                snapshot.clone()
            }
        };

    if goal_has_open_assigned_task(&planned) {
        return Ok(planned);
    }
    if planned.tasks.is_empty() {
        ensure_goal_seed_tasks(galley, &planned).await
    } else {
        ensure_goal_fallback_followup_tasks(galley, &planned).await
    }
}

async fn run_goal_master_planning_turn(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<GoalStatusSnapshot, GalleyError> {
    let Some(master_session_id) = snapshot.goal.master_session_id.clone() else {
        return Ok(snapshot.clone());
    };
    post_goal_master_checkpoint(
        galley,
        snapshot,
        GoalMasterCheckpointKind::PlanningStarted,
        goal_checkpoint_planning_started(goal_narration_locale()).to_string(),
        supervisor.clone(),
        reason.clone(),
    )
    .await?;

    let round = goal_master_planning_next_round(snapshot);
    galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: snapshot.goal.id.clone(),
            task_id: None,
            author_session_id: Some(master_session_id.clone()),
            event_type: GoalEventType::System,
            body: format!("{GOAL_MASTER_PLANNING_MARKER} round {round} dispatched."),
        })
        .await?;

    let dispatch_content = goal_master_planning_prompt(snapshot, round);
    session_goal_master_plan_value(
        master_session_id.0.clone(),
        dispatch_content,
        supervisor,
        reason.or_else(|| {
            Some(format!(
                "goal {} master planning round {round}",
                snapshot.goal.id
            ))
        }),
    )
    .await?;

    wait_goal_master_planning_result(galley, &snapshot.goal.id, snapshot.tasks.len()).await
}

async fn wait_goal_master_planning_result(
    galley: &SqliteGalley,
    goal_id: &GoalId,
    before_task_count: usize,
) -> Result<GoalStatusSnapshot, GalleyError> {
    let started = Instant::now();
    loop {
        let snapshot = galley.goal_status_full(goal_id.clone()).await?;
        if goal_has_open_assigned_task(&snapshot) || snapshot.tasks.len() > before_task_count {
            return Ok(snapshot);
        }
        if !matches!(snapshot.goal.status, GoalStatus::Running) || snapshot.goal.stop_requested {
            return Ok(snapshot);
        }
        if started.elapsed() >= GOAL_MASTER_PLANNING_TIMEOUT {
            return Ok(snapshot);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn goal_master_planning_next_round(snapshot: &GoalStatusSnapshot) -> u32 {
    snapshot
        .events
        .iter()
        .filter(|event| {
            event.event_type == GoalEventType::System
                && event.body.starts_with(GOAL_MASTER_PLANNING_MARKER)
                && event.body.contains(" dispatched.")
        })
        .count()
        .saturating_add(1) as u32
}

/// Most recent master check report (P0/P1 issue list), body with the
/// marker stripped. None until the master posts its first check report.
/// Threaded into the next planning prompt so design rounds fix by the
/// list instead of re-deciding from scratch.
async fn ensure_goal_seed_tasks(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
) -> Result<GoalStatusSnapshot, GalleyError> {
    if !snapshot.tasks.is_empty() || goal_seed_task_marker_seen(snapshot) {
        return Ok(snapshot.clone());
    }

    for (worker_index, spec) in goal_seed_task_specs(&snapshot.goal) {
        galley
            .create_goal_task(CreateGoalTaskInput {
                goal_id: snapshot.goal.id.clone(),
                title: spec.title,
                description: Some(spec.description),
                scope: Some(spec.scope),
                owner_session_id: None,
            })
            .await?;
        galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: snapshot.goal.id.clone(),
                task_id: None,
                author_session_id: None,
                event_type: GoalEventType::System,
                body: format!(
                    "{GOAL_SEED_TASK_MARKER} created seed task for worker {worker_index}."
                ),
            })
            .await?;
    }

    galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: snapshot.goal.id.clone(),
            task_id: None,
            author_session_id: None,
            event_type: GoalEventType::System,
            body: format!(
                "{GOAL_SEED_TASK_MARKER} seeded {} worker tasks.",
                snapshot.goal.worker_limit
            ),
        })
        .await?;
    galley.goal_status_full(snapshot.goal.id.clone()).await
}

async fn ensure_goal_fallback_followup_tasks(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
) -> Result<GoalStatusSnapshot, GalleyError> {
    let round = goal_master_planning_next_round(snapshot);
    let existing_scopes = snapshot
        .tasks
        .iter()
        .filter_map(|task| task.scope.as_deref())
        .collect::<Vec<_>>();
    for worker_index in 1..=snapshot.goal.worker_limit {
        let scope =
            format!("{GOAL_CONTROLLER_TASK_SCOPE_PREFIX}{worker_index}:master-fallback-round-{round}:validate");
        if existing_scopes.iter().any(|existing| *existing == scope) {
            continue;
        }
        galley
            .create_goal_task(CreateGoalTaskInput {
                goal_id: snapshot.goal.id.clone(),
                title: "验证、补缺和改进当前结果".to_string(),
                description: Some(format!(
                    "基于目标「{}」和已有结果，找出最需要补齐、核对或改进的地方；完成时写清新增结论、证据、风险和仍未解决的问题。",
                    snapshot.goal.objective
                )),
                scope: Some(scope),
                owner_session_id: None,
            })
            .await?;
    }
    galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: snapshot.goal.id.clone(),
            task_id: None,
            author_session_id: snapshot.goal.master_session_id.clone(),
            event_type: GoalEventType::System,
            body: format!("{GOAL_MASTER_PLANNING_MARKER} fallback follow-up tasks created."),
        })
        .await?;
    galley.goal_status_full(snapshot.goal.id.clone()).await
}

fn goal_seed_task_marker_seen(snapshot: &GoalStatusSnapshot) -> bool {
    snapshot.events.iter().any(|event| {
        event.event_type == GoalEventType::System && event.body.starts_with(GOAL_SEED_TASK_MARKER)
    })
}

async fn start_goal_worker_slots(
    galley: &SqliteGalley,
    wave_start_snapshot: &GoalStatusSnapshot,
    goal: &GoalBrief,
    existing_slots: &[GoalWorkerSlot],
    runtime: RuntimeArg,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<Vec<GoalWorkerSlot>, GalleyError> {
    let wave = 1_u32;
    // Workers inherit the master session's model (set at launch from the
    // operator's Composer pick) so the whole goal runs on one model
    // rather than the GA default. None → default, same as before.
    let worker_llm = match goal.master_session_id.as_ref() {
        Some(master_id) => galley
            .session_brief(master_id.clone())
            .await
            .ok()
            .and_then(|s| s.selected_llm_display_name),
        None => None,
    };
    let mut slots = Vec::new();
    for worker_index in 1..=goal.worker_limit {
        if goal_worker_slot_exists(existing_slots, worker_index) {
            continue;
        }
        let Some(assigned_task) =
            goal_open_assigned_task_for_worker(wave_start_snapshot, worker_index)
        else {
            continue;
        };
        let prompt = goal_worker_prompt_template(goal, wave, worker_index, Some(assigned_task));
        let result =
            session_new_goal_worker_value(
                prompt,
                goal.project_id
                    .as_ref()
                    .map(|project_id| project_id.0.clone()),
                worker_llm.clone(),
                runtime,
                supervisor.clone(),
                Some(reason.clone().unwrap_or_else(|| {
                    format!("goal {} wave {wave} worker {worker_index}", goal.id)
                })),
            )
            .await?;
        let session_id = result
            .get("session")
            .and_then(|s| s.get("id"))
            .and_then(Value::as_str)
            .map(|sid| SessionId(sid.to_string()))
            .ok_or_else(|| GalleyError::Internal {
                message: "session.new_goal_worker response missing session.id".to_string(),
            })?;
        let baseline = goal_worker_wave_baseline(wave_start_snapshot, session_id.clone());
        let _ = galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: goal.id.clone(),
                task_id: None,
                author_session_id: Some(session_id.clone()),
                event_type: GoalEventType::System,
                body: format!("Wave {wave} worker {worker_index} session started."),
            })
            .await;
        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "worker_started",
            goal,
            session_id: Some(session_id.0.clone()),
            note: Some(format!(
                "wave {wave}; worker {worker_index}/{}",
                goal.worker_limit
            )),
        })?;
        slots.push(GoalWorkerSlot {
            worker_index,
            wave,
            baseline,
            capped: false,
        });
    }
    Ok(slots)
}

async fn continue_goal_worker_slot(
    galley: &SqliteGalley,
    snapshot_before_continue: &GoalStatusSnapshot,
    goal: &GoalBrief,
    slot: &mut GoalWorkerSlot,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<bool, GalleyError> {
    if slot.capped {
        return Ok(false);
    }
    if slot.wave >= GOAL_CONTROLLER_MAX_WAVES {
        slot.capped = true;
        let _ = galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: goal.id.clone(),
                task_id: None,
                author_session_id: Some(slot.session_id().clone()),
                event_type: GoalEventType::System,
                body: format!(
                    "Worker {} reached the per-slot wave cap at wave {}; no more task wakes will be dispatched for this slot.",
                    slot.worker_index, slot.wave
                ),
            })
            .await;
        return Ok(false);
    }

    let next_wave = slot.wave.saturating_add(1);
    let session_id = slot.session_id().clone();
    let Some(task) =
        goal_open_assigned_task_for_worker(snapshot_before_continue, slot.worker_index)
    else {
        return Ok(false);
    };
    let task = task.clone();
    let prompt = goal_worker_wake_prompt(goal, next_wave, slot.worker_index, &session_id, &task);
    session_send_value(
        session_id.0.clone(),
        prompt,
        supervisor.clone(),
        Some(reason.clone().unwrap_or_else(|| {
            format!(
                "goal {} wave {next_wave} worker {}",
                goal.id, slot.worker_index
            )
        })),
    )
    .await?;
    slot.wave = next_wave;
    slot.baseline = goal_worker_wave_baseline(snapshot_before_continue, session_id.clone());
    let _ = galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: goal.id.clone(),
            task_id: Some(task.id.clone()),
            author_session_id: Some(session_id.clone()),
            event_type: GoalEventType::System,
            body: format!(
                "Wave {next_wave} worker {} wake task {} dispatched in existing session.",
                slot.worker_index, task.id
            ),
        })
        .await;
    emit_json(&GoalRunFrame {
        schema_version: SCHEMA_VERSION,
        stream: "goal",
        phase: "worker_started",
        goal,
        session_id: Some(session_id.0),
        note: Some(format!(
            "wave {next_wave}; worker {}/{}",
            slot.worker_index, goal.worker_limit
        )),
    })?;
    Ok(true)
}

fn goal_waiting_for_worker_signal_summary(wave: u32, had_protocol_activity: bool) -> String {
    if had_protocol_activity {
        return format!(
            "Wave {wave} has worker activity but no terminal task/result yet; waiting until the Goal deadline without assigning another task."
        );
    }
    format!(
        "Wave {wave} has no terminal task/result yet; waiting until the Goal deadline without assigning another task."
    )
}

fn goal_slot_wake_summary(
    worker_indices: &[u32],
    has_result_signal: bool,
    incomplete_tasks: bool,
) -> String {
    let workers = worker_indices
        .iter()
        .map(|index| format!("worker {index}"))
        .collect::<Vec<_>>()
        .join(", ");
    if has_result_signal && incomplete_tasks {
        return format!(
            "{workers} produced terminal results while tasks remain; budget remains, assigning concrete follow-up tasks."
        );
    }
    if has_result_signal {
        return format!(
            "{workers} produced a terminal result signal; budget remains, assigning concrete review, validation, and refinement tasks."
        );
    }
    format!(
        "{workers} produced a terminal task signal without a result; budget remains, assigning concrete follow-up tasks."
    )
}

async fn goal_worker_sessions_have_output(
    galley: &SqliteGalley,
    worker_session_ids: &[SessionId],
) -> Result<bool, GalleyError> {
    for session_id in worker_session_ids {
        let messages = galley
            .session_messages(session_id.clone(), Some(12))
            .await?;
        if messages
            .iter()
            .any(|message| message.role == MessageRole::Agent && !message.content.trim().is_empty())
        {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn wait_goal_worker_sessions(
    galley: &SqliteGalley,
    worker_slots: &mut [GoalWorkerSlot],
    goal: &GoalBrief,
    controller_started: Instant,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<GoalWorkerWaitOutcome, GalleyError> {
    if worker_slots.is_empty() {
        return Ok(GoalWorkerWaitOutcome::IdleWithoutSignal);
    }

    let started_wait = Instant::now();
    let drain_cap = Duration::from_secs(goal_drain_cap_seconds(goal.budget_seconds));
    let mut drain_started: Option<Instant> = None;
    loop {
        let snapshot = galley.goal_status_full(goal.id.clone()).await?;
        if snapshot.goal.stop_requested {
            return Ok(GoalWorkerWaitOutcome::IdleWithoutSignal);
        }
        if goal_has_result_signal(&snapshot) || goal_has_worker_material_signal(&snapshot) {
            post_goal_master_checkpoint(
                galley,
                &snapshot,
                GoalMasterCheckpointKind::FirstMaterial,
                goal_checkpoint_first_material(goal_narration_locale()).to_string(),
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
        }
        let mut live_session_ids = Vec::new();
        for slot in worker_slots.iter() {
            let session = galley.session_brief(slot.session_id().clone()).await?;
            if is_live_candidate(session.status) {
                live_session_ids.push(slot.session_id().clone());
            }
        }
        if goal_budget_left(goal, controller_started) {
            let ready_slots =
                goal_ready_idle_worker_slot_indices(&snapshot, worker_slots, &live_session_ids);
            if !ready_slots.is_empty() {
                return Ok(GoalWorkerWaitOutcome::ReadySlots(ready_slots));
            }
        }
        let has_progress_signal = goal_any_worker_slot_has_progress_signal(&snapshot, worker_slots);
        let any_live = !live_session_ids.is_empty();
        if !any_live {
            if goal_budget_left(goal, controller_started) {
                if has_progress_signal {
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    continue;
                }
                if started_wait.elapsed() < Duration::from_secs(GOAL_WORKER_SIGNAL_GRACE_SECONDS) {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
                if send_goal_worker_protocol_reminders(
                    galley,
                    goal,
                    worker_slots,
                    &snapshot,
                    supervisor.clone(),
                    reason.clone(),
                )
                .await?
                {
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    continue;
                }
            }
            return Ok(GoalWorkerWaitOutcome::IdleWithoutSignal);
        }
        if goal_budget_left(goal, controller_started) {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            continue;
        }
        if drain_started.is_none() {
            post_goal_master_checkpoint(
                galley,
                &snapshot,
                GoalMasterCheckpointKind::DeadlineReached,
                goal_checkpoint_deadline_reached(goal_narration_locale()).to_string(),
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
            let summary = format!(
                "Goal deadline reached; waiting up to {}s for active workers to finish before master synthesis.",
                drain_cap.as_secs()
            );
            galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: goal.id.clone(),
                    task_id: None,
                    author_session_id: None,
                    event_type: GoalEventType::Synthesis,
                    body: summary,
                })
                .await?;
            drain_started = Some(Instant::now());
        }
        if drain_started
            .map(|started| started.elapsed() >= drain_cap)
            .unwrap_or(false)
        {
            return Ok(GoalWorkerWaitOutcome::DrainCapReached);
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

async fn send_goal_worker_protocol_reminders(
    galley: &SqliteGalley,
    goal: &GoalBrief,
    worker_slots: &mut [GoalWorkerSlot],
    snapshot: &GoalStatusSnapshot,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<bool, GalleyError> {
    let mut sent = false;
    for slot in worker_slots.iter_mut() {
        if slot.capped
            || slot.baseline.reminder_sent
            || goal_worker_has_terminal_signal(snapshot, &slot.baseline)
        {
            continue;
        }
        let wave = slot.wave;
        let session_id = slot.session_id().clone();
        let prompt = goal_worker_protocol_reminder_prompt(goal, wave, &session_id);
        session_send_value(
            session_id.0.clone(),
            prompt,
            supervisor.clone(),
            Some(reason.clone().unwrap_or_else(|| {
                format!(
                    "goal {} wave {wave} worker {} protocol reminder",
                    goal.id, slot.worker_index
                )
            })),
        )
        .await?;
        slot.baseline.reminder_sent = true;
        sent = true;
        let _ = galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: goal.id.clone(),
                task_id: None,
                author_session_id: Some(session_id),
                event_type: GoalEventType::System,
                body: format!(
                    "Wave {wave} worker {} protocol reminder sent; waiting for terminal task/result signal.",
                    slot.worker_index
                ),
            })
            .await;
    }
    Ok(sent)
}

/// Best-effort worker runner cleanup. Shutting down runners is not the
/// goal's deliverable: a transient socket failure here must not abort
/// the caller (it used to fail master synthesis and mark a finished
/// goal Failed). Failures are recorded as a System event and skipped.
pub(super) async fn shutdown_goal_worker_runners(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
    supervisor: Option<String>,
    reason: Option<String>,
) {
    let worker_ids = goal_worker_session_ids(snapshot, worker_session_ids);
    let mut failures: Vec<String> = Vec::new();
    for session_id in worker_ids {
        let session_id = session_id.0;
        if let Err(err) = session_shutdown_runner_value(
            session_id.clone(),
            supervisor.clone(),
            reason
                .clone()
                .or_else(|| Some(format!("goal {} worker runner cleanup", snapshot.goal.id))),
        )
        .await
        {
            failures.push(format!("{session_id}: {err}"));
        }
    }
    if !failures.is_empty() {
        let _ = galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: snapshot.goal.id.clone(),
                task_id: None,
                author_session_id: None,
                event_type: GoalEventType::System,
                body: format!(
                    "Worker runner cleanup failed for {} session(s); continuing without them: {}",
                    failures.len(),
                    failures.join("; ")
                ),
            })
            .await;
    }
}
