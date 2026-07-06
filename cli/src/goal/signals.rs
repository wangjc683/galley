use crate::goal::task_seed::goal_task_is_controller_assigned;
use crate::goal::types::{
    GoalActivityCounts, GoalWorkerProgressCounts, GoalWorkerSlot, GoalWorkerTerminalCounts,
    GoalWorkerWaveBaseline, GOAL_CONTROLLER_MAX_DRAIN_SECONDS, GOAL_CONTROLLER_MIN_DRAIN_SECONDS,
};
use galley_core_lib::api::{
    GoalEventBrief, GoalEventType, GoalStatusSnapshot, GoalTaskStatus, SessionId,
};

pub(crate) fn goal_has_incomplete_tasks(snapshot: &GoalStatusSnapshot) -> bool {
    snapshot.tasks.iter().any(|task| {
        matches!(
            task.status,
            GoalTaskStatus::Open
                | GoalTaskStatus::Claimed
                | GoalTaskStatus::Running
                | GoalTaskStatus::Blocked
        )
    })
}

pub(crate) fn goal_has_result_signal(snapshot: &GoalStatusSnapshot) -> bool {
    snapshot
        .tasks
        .iter()
        .any(|task| task.status == GoalTaskStatus::Completed)
        || snapshot
            .events
            .iter()
            .any(|event| event.event_type == GoalEventType::Result)
}

pub(crate) fn goal_has_worker_material_signal(snapshot: &GoalStatusSnapshot) -> bool {
    snapshot.tasks.iter().any(|task| {
        task.owner_session_id.is_some()
            || task.status != GoalTaskStatus::Open
            || !goal_task_is_controller_assigned(task)
    }) || snapshot.events.iter().any(|event| {
        matches!(
            event.event_type,
            GoalEventType::Plan
                | GoalEventType::Claim
                | GoalEventType::Progress
                | GoalEventType::Result
                | GoalEventType::Conflict
        )
    })
}

/// Stop wrap-up material gate: does the run hold anything worth a brief
/// master accounting? Non-empty task board counts — even claimed-but-
/// unfinished tasks give the wrap-up something honest to report ("X was
/// in progress"). With nothing here, stop keeps its historical instant
/// termination instead of dispatching a synthesis turn over nothing.
pub(crate) fn goal_has_stop_wrap_up_material(snapshot: &GoalStatusSnapshot) -> bool {
    goal_has_result_signal(snapshot)
        || goal_has_worker_material_signal(snapshot)
        || !snapshot.tasks.is_empty()
}

pub(crate) fn goal_activity_counts(snapshot: &GoalStatusSnapshot) -> GoalActivityCounts {
    GoalActivityCounts {
        task_count: snapshot
            .tasks
            .iter()
            .filter(|task| {
                task.owner_session_id.is_some()
                    || task.status != GoalTaskStatus::Open
                    || !goal_task_is_controller_assigned(task)
            })
            .count(),
        completed_task_count: snapshot
            .tasks
            .iter()
            .filter(|task| task.status == GoalTaskStatus::Completed)
            .count(),
        worker_event_count: snapshot
            .events
            .iter()
            .filter(|event| {
                matches!(
                    event.event_type,
                    GoalEventType::Plan
                        | GoalEventType::Claim
                        | GoalEventType::Progress
                        | GoalEventType::Result
                        | GoalEventType::Conflict
                )
            })
            .count(),
        result_event_count: snapshot
            .events
            .iter()
            .filter(|event| event.event_type == GoalEventType::Result)
            .count(),
    }
}

pub(crate) fn goal_activity_increased(
    before: GoalActivityCounts,
    after: GoalActivityCounts,
) -> bool {
    after.task_count > before.task_count
        || after.completed_task_count > before.completed_task_count
        || after.worker_event_count > before.worker_event_count
        || after.result_event_count > before.result_event_count
}

pub(crate) fn goal_worker_slot_session_ids(slots: &[GoalWorkerSlot]) -> Vec<SessionId> {
    slots.iter().map(|slot| slot.session_id().clone()).collect()
}

pub(crate) fn goal_worker_slots_all_capped(slots: &[GoalWorkerSlot]) -> bool {
    !slots.is_empty() && slots.iter().all(|slot| slot.capped)
}

pub(crate) fn goal_worker_max_wave(slots: &[GoalWorkerSlot]) -> u32 {
    slots.iter().map(|slot| slot.wave).max().unwrap_or(1)
}

pub(crate) fn goal_ready_worker_slot_indices(
    snapshot: &GoalStatusSnapshot,
    slots: &[GoalWorkerSlot],
) -> Vec<usize> {
    slots
        .iter()
        .enumerate()
        .filter_map(|(index, slot)| {
            if slot.capped || !goal_worker_has_terminal_signal(snapshot, &slot.baseline) {
                None
            } else {
                Some(index)
            }
        })
        .collect()
}

pub(crate) fn goal_ready_idle_worker_slot_indices(
    snapshot: &GoalStatusSnapshot,
    slots: &[GoalWorkerSlot],
    live_session_ids: &[SessionId],
) -> Vec<usize> {
    goal_ready_worker_slot_indices(snapshot, slots)
        .into_iter()
        .filter(|index| {
            slots.get(*index).is_some_and(|slot| {
                !live_session_ids
                    .iter()
                    .any(|live| live == slot.session_id())
            })
        })
        .collect()
}

pub(crate) fn goal_any_worker_slot_has_progress_signal(
    snapshot: &GoalStatusSnapshot,
    slots: &[GoalWorkerSlot],
) -> bool {
    slots
        .iter()
        .filter(|slot| !slot.capped)
        .any(|slot| goal_worker_has_progress_signal(snapshot, &slot.baseline))
}

pub(crate) fn goal_worker_wave_baseline(
    snapshot: &GoalStatusSnapshot,
    session_id: SessionId,
) -> GoalWorkerWaveBaseline {
    GoalWorkerWaveBaseline {
        terminal_counts: goal_worker_terminal_counts(snapshot, &session_id),
        progress_counts: goal_worker_progress_counts(snapshot, &session_id),
        session_id,
        reminder_sent: false,
    }
}

pub(crate) fn goal_worker_has_terminal_signal(
    snapshot: &GoalStatusSnapshot,
    baseline: &GoalWorkerWaveBaseline,
) -> bool {
    let current = goal_worker_terminal_counts(snapshot, &baseline.session_id);
    current.terminal_task_count > baseline.terminal_counts.terminal_task_count
        || current.result_event_count > baseline.terminal_counts.result_event_count
}

pub(crate) fn goal_worker_has_progress_signal(
    snapshot: &GoalStatusSnapshot,
    baseline: &GoalWorkerWaveBaseline,
) -> bool {
    if goal_worker_has_terminal_signal(snapshot, baseline) {
        return true;
    }
    let current = goal_worker_progress_counts(snapshot, &baseline.session_id);
    current.task_count > baseline.progress_counts.task_count
        || current.worker_event_count > baseline.progress_counts.worker_event_count
}

pub(crate) fn goal_worker_terminal_counts(
    snapshot: &GoalStatusSnapshot,
    session_id: &SessionId,
) -> GoalWorkerTerminalCounts {
    let terminal_task_count = snapshot
        .tasks
        .iter()
        .filter(|task| {
            task.owner_session_id.as_ref() == Some(session_id)
                && goal_task_status_is_terminal(task.status)
        })
        .count();
    let result_event_count = snapshot
        .events
        .iter()
        .filter(|event| goal_result_event_belongs_to_worker(snapshot, event, session_id))
        .count();
    GoalWorkerTerminalCounts {
        terminal_task_count,
        result_event_count,
    }
}

fn goal_worker_progress_counts(
    snapshot: &GoalStatusSnapshot,
    session_id: &SessionId,
) -> GoalWorkerProgressCounts {
    let task_count = snapshot
        .tasks
        .iter()
        .filter(|task| task.owner_session_id.as_ref() == Some(session_id))
        .count();
    let worker_event_count = snapshot
        .events
        .iter()
        .filter(|event| {
            event.author_session_id.as_ref() == Some(session_id)
                && matches!(
                    event.event_type,
                    GoalEventType::Plan
                        | GoalEventType::Claim
                        | GoalEventType::Progress
                        | GoalEventType::Result
                        | GoalEventType::Conflict
                )
        })
        .count();
    GoalWorkerProgressCounts {
        task_count,
        worker_event_count,
    }
}

fn goal_task_status_is_terminal(status: GoalTaskStatus) -> bool {
    matches!(
        status,
        GoalTaskStatus::Completed | GoalTaskStatus::Blocked | GoalTaskStatus::Cancelled
    )
}

fn goal_result_event_belongs_to_worker(
    snapshot: &GoalStatusSnapshot,
    event: &GoalEventBrief,
    session_id: &SessionId,
) -> bool {
    if event.event_type != GoalEventType::Result {
        return false;
    }
    if event.author_session_id.as_ref() == Some(session_id) {
        return true;
    }
    let Some(task_id) = event.task_id.as_ref() else {
        return false;
    };
    snapshot
        .tasks
        .iter()
        .any(|task| task.id == *task_id && task.owner_session_id.as_ref() == Some(session_id))
}

/// The controller re-evaluates idle waits every ~1.5s with an unchanged
/// summary. Reposting the same Synthesis event each cycle floods the
/// event history that signal logic and the synthesis prompt read (and,
/// while events were windowed, evicted real worker signals). Post only
/// when the summary actually changes.
pub(crate) fn goal_summary_event_is_new(latest_summary: Option<&str>, summary: &str) -> bool {
    latest_summary != Some(summary)
}

pub(crate) fn goal_drain_cap_seconds(budget_seconds: u32) -> u64 {
    let quarter_budget = u64::from(budget_seconds).saturating_div(4);
    quarter_budget
        .max(GOAL_CONTROLLER_MIN_DRAIN_SECONDS)
        .min(GOAL_CONTROLLER_MAX_DRAIN_SECONDS)
}

/// Sessions this goal's cleanup and synthesis may treat as workers: the
/// union of the controller's tracked slots and every event author other
/// than the master. Worker starts and wakes always post a worker-authored
/// System event, so with the full event history (goal_status_full) this
/// also recovers workers from before a `goal run --resume`. There is
/// deliberately no "all project sessions" fallback: a goal that never
/// started workers has none to shut down, and that fallback used to kill
/// unrelated live runners sharing the project.
pub(crate) fn goal_worker_session_ids(
    snapshot: &GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
) -> Vec<SessionId> {
    let event_worker_ids = snapshot
        .events
        .iter()
        .filter_map(|event| event.author_session_id.clone())
        .filter(|session_id| Some(session_id) != snapshot.goal.master_session_id.as_ref());
    let mut out: Vec<SessionId> = Vec::new();
    for session_id in worker_session_ids.iter().cloned().chain(event_worker_ids) {
        if !out.iter().any(|existing| existing == &session_id) {
            out.push(session_id);
        }
    }
    out
}
