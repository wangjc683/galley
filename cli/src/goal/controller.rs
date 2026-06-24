use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::args::RuntimeArg;
use crate::common::{emit_json, is_live_candidate, runtime_arg_from_kind, SCHEMA_VERSION};
use crate::goal::decision::goal_failure_summary;
pub(crate) use crate::goal::decision::{
    goal_controller_decision, goal_controller_decision_after_wait, goal_wrapping_summary,
};
use crate::goal::prompts::{
    goal_master_planning_prompt, goal_worker_prompt_template, goal_worker_protocol_reminder_prompt,
    goal_worker_wake_prompt, goal_workspace_file_listing,
};
use crate::goal::signals::{
    goal_activity_counts, goal_activity_increased, goal_any_worker_slot_has_progress_signal,
    goal_has_incomplete_tasks, goal_has_result_signal, goal_worker_max_wave,
    goal_worker_slot_session_ids, goal_worker_slots_all_capped,
};
pub(crate) use crate::goal::signals::{
    goal_drain_cap_seconds, goal_has_worker_material_signal, goal_ready_idle_worker_slot_indices,
    goal_worker_has_terminal_signal, goal_worker_session_ids, goal_worker_wave_baseline,
};
#[cfg(test)]
pub(crate) use crate::goal::signals::{
    goal_ready_worker_slot_indices, goal_worker_has_progress_signal, goal_worker_terminal_counts,
};
pub(crate) use crate::goal::task_seed::goal_seed_task_specs;
use crate::goal::task_seed::{
    goal_has_open_assigned_task, goal_open_assigned_task_for_worker, goal_worker_slot_exists,
};
use crate::goal::types::*;
use crate::project::project_follow;
use crate::session::{
    session_checkpoint_value, session_goal_master_plan_value, session_goal_synthesize_value,
    session_new_goal_worker_value, session_send_value, session_shutdown_runner_value,
};
use galley_core_lib::api::{
    goal_checkpoint_deadline_reached, goal_checkpoint_first_material,
    goal_checkpoint_planning_started, goal_checkpoint_workers_started, goal_synthesizing,
    CreateGoalEventInput, CreateGoalTaskInput, GalleyApi, GoalBrief, GoalEventType, GoalId,
    GoalLocale, GoalStatus, GoalStatusSnapshot, MessageBrief, MessageRole, RuntimeKind, SessionId,
    GOAL_CONFIRMATION_PHRASE,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use serde_json::Value;

static GOAL_NARRATION_LOCALE: std::sync::OnceLock<GoalLocale> = std::sync::OnceLock::new();

pub(crate) fn set_goal_narration_locale(locale: Option<String>) {
    let _ = GOAL_NARRATION_LOCALE.set(GoalLocale::parse(locale.as_deref()));
}

fn goal_narration_locale() -> GoalLocale {
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
        if goal.status == GoalStatus::Wrapping && !goal.stop_requested {
            let snapshot = galley.goal_status(goal.id.clone()).await?;
            finish_goal_with_master(
                galley,
                snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason.clone(),
            )
            .await?;
            return Ok(());
        }

        let wave_start_snapshot = galley.goal_status(goal.id.clone()).await?;
        goal = wave_start_snapshot.goal.clone();
        if goal.stop_requested {
            let summary = "Goal stopped before starting the next worker wave.".to_string();
            shutdown_goal_worker_runners(
                galley,
                &wave_start_snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason
                    .clone()
                    .or_else(|| Some(format!("goal {} stopped", goal.id))),
            )
            .await?;
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
                .update_goal_state(goal.id.clone(), GoalStatus::Stopped, Some(summary))
                .await?;
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "finished",
                goal: &final_goal,
                session_id: None,
                note: None,
            })?;
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
                        galley.goal_status(wrapping_goal.id.clone()).await?,
                        &worker_session_ids,
                        supervisor.clone(),
                        reason.clone().or_else(|| {
                            Some(format!("goal master synthesis after {wrap_reason:?}"))
                        }),
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
                    .await?;
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
                GoalControllerDecision::Continue => {}
                GoalControllerDecision::WaitForSignal => {}
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
                let checkpoint_snapshot = galley.goal_status(goal.id.clone()).await?;
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

        project_follow(goal.project_id.0.clone(), 80, false, true, true).await?;
        let wait_outcome = wait_goal_worker_sessions(
            galley,
            &mut worker_slots,
            &goal,
            controller_started,
            supervisor.clone(),
            reason.clone(),
        )
        .await?;

        let mut snapshot = galley.goal_status(goal.id.clone()).await?;
        let refreshed = snapshot.goal.clone();
        if refreshed.stop_requested {
            let summary = "Worker wave finished after stop request; Goal stopped.".to_string();
            shutdown_goal_worker_runners(
                galley,
                &snapshot,
                &worker_session_ids,
                supervisor.clone(),
                reason
                    .clone()
                    .or_else(|| Some(format!("goal {} stopped", refreshed.id))),
            )
            .await?;
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
                .update_goal_state(refreshed.id.clone(), GoalStatus::Stopped, Some(summary))
                .await?;
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "finished",
                goal: &final_goal,
                session_id: None,
                note: None,
            })?;
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
                galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: refreshed.id.clone(),
                        task_id: None,
                        author_session_id: None,
                        event_type: GoalEventType::Synthesis,
                        body: summary.clone(),
                    })
                    .await?;
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
                .await?;
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
                    galley.goal_status(wrapping_goal.id.clone()).await?,
                    &worker_session_ids,
                    supervisor.clone(),
                    reason
                        .clone()
                        .or_else(|| Some(format!("goal master synthesis after {wrap_reason:?}"))),
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
        let snapshot = galley.goal_status(goal_id.clone()).await?;
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
    galley.goal_status(snapshot.goal.id.clone()).await
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
    galley.goal_status(snapshot.goal.id.clone()).await
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
                Some(goal.project_id.0.clone()),
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
        if goal_stop_requested(galley, goal).await? {
            return Ok(GoalWorkerWaitOutcome::IdleWithoutSignal);
        }
        let snapshot = galley.goal_status(goal.id.clone()).await?;
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

async fn goal_stop_requested(galley: &SqliteGalley, goal: &GoalBrief) -> Result<bool, GalleyError> {
    Ok(galley
        .goal_status(goal.id.clone())
        .await?
        .goal
        .stop_requested)
}

async fn shutdown_goal_worker_runners(
    _galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let worker_ids = goal_worker_session_ids(snapshot, worker_session_ids);
    for session_id in worker_ids {
        session_shutdown_runner_value(
            session_id.0,
            supervisor.clone(),
            reason
                .clone()
                .or_else(|| Some(format!("goal {} worker runner cleanup", snapshot.goal.id))),
        )
        .await?;
    }
    Ok(())
}

async fn wait_master_final_answer(
    galley: &SqliteGalley,
    session_id: &SessionId,
    previous_turn_count: u32,
) -> Result<MessageBrief, GalleyError> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(300) {
        let session = galley.session_brief(session_id.clone()).await?;
        let messages = galley
            .session_messages(session_id.clone(), Some(12))
            .await?;
        let final_answer = messages
            .iter()
            .rev()
            .find(|message| {
                message.role == MessageRole::Agent
                    && message.turn_index.unwrap_or(0) >= previous_turn_count
                    && message
                        .final_answer
                        .as_deref()
                        .is_some_and(|answer| !answer.trim().is_empty())
            })
            .cloned();
        if let Some(message) = final_answer {
            if !is_live_candidate(session.status) {
                return Ok(message);
            }
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    Err(GalleyError::RunnerError {
        message: format!("master session {session_id} did not produce a final answer within 300s"),
    })
}

async fn finish_goal_with_master(
    galley: &SqliteGalley,
    snapshot: GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let goal = snapshot.goal.clone();
    shutdown_goal_worker_runners(
        galley,
        &snapshot,
        worker_session_ids,
        supervisor.clone(),
        reason
            .clone()
            .or_else(|| Some(format!("goal {} entering master synthesis", goal.id))),
    )
    .await?;
    let Some(master_session_id) = goal.master_session_id.clone() else {
        let summary = goal
            .latest_summary
            .clone()
            .unwrap_or_else(|| "Goal completed without a desktop master session.".to_string());
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
            .update_goal_state(goal.id.clone(), GoalStatus::Completed, Some(summary))
            .await?;
        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "finished",
            goal: &final_goal,
            session_id: None,
            note: None,
        })?;
        return Ok(());
    };

    let before_turn_count = galley
        .session_brief(master_session_id.clone())
        .await?
        .turn_count
        .unwrap_or(0);
    let dispatch_content =
        build_goal_synthesis_prompt(galley, &snapshot, worker_session_ids).await?;
    session_goal_synthesize_value(
        master_session_id.0.clone(),
        goal_synthesizing(goal_narration_locale()).to_string(),
        dispatch_content,
        supervisor.clone(),
        reason
            .clone()
            .or_else(|| Some(format!("goal {} master synthesis", goal.id))),
    )
    .await?;
    let final_answer_message =
        wait_master_final_answer(galley, &master_session_id, before_turn_count).await?;

    let summary = final_answer_message
        .final_answer
        .as_deref()
        .and_then(first_non_empty_line)
        .or_else(|| first_non_empty_line(&final_answer_message.content))
        .or_else(|| final_answer_message.summary.clone())
        .unwrap_or_else(|| "Goal completed and master synthesis was delivered.".to_string());

    galley
        .create_goal_event(CreateGoalEventInput {
            goal_id: goal.id.clone(),
            task_id: None,
            author_session_id: Some(master_session_id.clone()),
            event_type: GoalEventType::Synthesis,
            body: summary.clone(),
        })
        .await?;
    let final_goal = galley
        .update_goal_state(goal.id.clone(), GoalStatus::Completed, Some(summary))
        .await?;
    let completed_snapshot = galley.goal_status(final_goal.id.clone()).await?;
    shutdown_goal_worker_runners(
        galley,
        &completed_snapshot,
        worker_session_ids,
        supervisor.clone(),
        Some(format!("goal {} completed worker cleanup", final_goal.id)),
    )
    .await?;
    emit_json(&GoalRunFrame {
        schema_version: SCHEMA_VERSION,
        stream: "goal",
        phase: "finished",
        goal: &final_goal,
        session_id: Some(master_session_id.0),
        note: final_goal.latest_summary.clone(),
    })?;
    Ok(())
}

async fn build_goal_synthesis_prompt(
    galley: &SqliteGalley,
    snapshot: &GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
) -> Result<String, GalleyError> {
    let goal = &snapshot.goal;
    let fallback_worker_ids = goal_worker_session_ids(snapshot, worker_session_ids);
    let worker_ids = fallback_worker_ids.as_slice();
    let mut out = String::new();
    push_limited(
        &mut out,
        &format!(
            "[Galley Goal Master Synthesis]\n\nYou are the master session for this Galley Goal. Answer the user directly in their language. Do not expose worker protocol, Goal ids, command logs, or internal coordination unless it materially helps the user.\n\nObjective:\n{}\n\nProduce a concise final answer with: conclusion, key evidence, important gaps or caveats, and next actions. Internal temp paths are scratch; only report a file path as the deliverable when the user explicitly asked Galley to save there.\n\nGoal status: {:?}\nProject id: {}\n\n",
            goal.objective,
            goal.status,
            goal.project_id
        ),
        28_000,
    );

    if let Some(deliverable) = snapshot.deliverable.as_ref() {
        // The anchor is the curated current-best result. Deliver it as the
        // spine — polish/format only — rather than rebuilding from scattered
        // worker output. Task board / events / worker outputs below are
        // supporting context for final polish, not a fresh synthesis source.
        push_limited(
            &mut out,
            &format!(
                "Current deliverable anchor (version {}) — this is the curated best result. Deliver it as the final answer, polishing wording and structure only; do not discard or rebuild it. The sections below are context for last-mile polish.\n\n--- DELIVERABLE ANCHOR START ---\n{}\n--- DELIVERABLE ANCHOR END ---\n\n",
                deliverable.version, deliverable.content
            ),
            // Allow the anchor itself to be large; it is the payload.
            300_000,
        );
    }

    if let Some(listing) = goal_workspace_file_listing(goal) {
        // File/code deliverable: the real artifact lives in the workspace.
        // Tell the master to deliver a summary + point at the folder rather
        // than dumping file contents into the conversation.
        push_limited(
            &mut out,
            &format!(
                "This Goal produced files in its shared workspace ({}). These files are the deliverable. In the final answer, summarize what was built and how to use/run it, and tell the user the result files are in the Goal's output folder — do NOT paste full file contents into the conversation. Workspace files:\n{}\n\n",
                goal.workspace_path.as_deref().unwrap_or(""),
                listing
            ),
            34_000,
        );
    }

    if !snapshot.tasks.is_empty() {
        push_limited(&mut out, "Task board:\n", 28_000);
        for task in &snapshot.tasks {
            push_limited(
                &mut out,
                &format!(
                    "- [{:?}] {} | owner={:?} | scope={:?}\n  result={}\n",
                    task.status,
                    task.title,
                    task.owner_session_id,
                    task.scope,
                    task.result_summary.as_deref().unwrap_or("")
                ),
                28_000,
            );
        }
        push_limited(&mut out, "\n", 28_000);
    }

    if !snapshot.events.is_empty() {
        push_limited(&mut out, "Goal events:\n", 28_000);
        for event in &snapshot.events {
            push_limited(
                &mut out,
                &format!(
                    "- {:?} by {:?}: {}\n",
                    event.event_type, event.author_session_id, event.body
                ),
                28_000,
            );
        }
        push_limited(&mut out, "\n", 28_000);
    }

    push_limited(&mut out, "Worker session latest output:\n", 28_000);
    for session_id in worker_ids {
        let messages = galley.session_messages(session_id.clone(), Some(6)).await?;
        push_limited(
            &mut out,
            &format!("\n## Worker session {session_id}\n"),
            28_000,
        );
        for message in messages {
            let body = message
                .final_answer
                .as_deref()
                .filter(|answer| !answer.trim().is_empty())
                .unwrap_or(&message.content);
            if body.trim().is_empty() {
                continue;
            }
            push_limited(
                &mut out,
                &format!("{:?}: {}\n", message.role, compact_text(body, 2400)),
                28_000,
            );
        }
    }
    Ok(out)
}

fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| compact_text(line, 600))
}

fn compact_text(text: &str, max_chars: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max_chars {
        return one_line;
    }
    let mut out: String = one_line.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn push_limited(out: &mut String, text: &str, max_chars: usize) {
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

fn goal_budget_left(goal: &GoalBrief, controller_started: Instant) -> bool {
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
