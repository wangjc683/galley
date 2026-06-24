use crate::goal::types::{
    GoalControllerDecision, GoalFailReason, GoalWorkerWaitOutcome, GoalWrapReason,
};

pub(crate) fn goal_controller_decision(
    budget_left: bool,
    has_synthesis_material: bool,
    all_worker_slots_capped: bool,
) -> GoalControllerDecision {
    if budget_left && all_worker_slots_capped {
        return if has_synthesis_material {
            GoalControllerDecision::Wrap(GoalWrapReason::WaveCap)
        } else {
            GoalControllerDecision::Fail(GoalFailReason::NoResultByWaveCap)
        };
    }
    if budget_left {
        return GoalControllerDecision::Continue;
    }
    if has_synthesis_material {
        GoalControllerDecision::Wrap(GoalWrapReason::Deadline)
    } else {
        GoalControllerDecision::Fail(GoalFailReason::NoResultByDeadline)
    }
}

pub(crate) fn goal_controller_decision_after_wait(
    wait_outcome: GoalWorkerWaitOutcome,
    budget_left: bool,
    has_synthesis_material: bool,
    all_worker_slots_capped: bool,
) -> GoalControllerDecision {
    if wait_outcome == GoalWorkerWaitOutcome::DrainCapReached {
        return GoalControllerDecision::Wrap(GoalWrapReason::DrainCap);
    }
    if wait_outcome == GoalWorkerWaitOutcome::IdleWithoutSignal && budget_left {
        return GoalControllerDecision::WaitForSignal;
    }
    goal_controller_decision(budget_left, has_synthesis_material, all_worker_slots_capped)
}

pub(crate) fn goal_wrapping_summary(reason: GoalWrapReason, incomplete_tasks: bool) -> String {
    match (reason, incomplete_tasks) {
        (GoalWrapReason::Deadline, true) => {
            "Goal budget reached with unfinished tasks; starting master synthesis with the best available results.".to_string()
        }
        (GoalWrapReason::Deadline, false) => {
            "Goal budget reached; starting master synthesis.".to_string()
        }
        (GoalWrapReason::DrainCap, true) => {
            "Goal drain cap reached while some workers may still be active; synthesizing available results with unfinished tasks noted.".to_string()
        }
        (GoalWrapReason::DrainCap, false) => {
            "Goal drain cap reached while some workers may still be active; synthesizing available results.".to_string()
        }
        (GoalWrapReason::WaveCap, true) => {
            "Goal wave cap reached with unfinished tasks; starting master synthesis with accumulated results.".to_string()
        }
        (GoalWrapReason::WaveCap, false) => {
            "Goal wave cap reached; starting master synthesis with accumulated results.".to_string()
        }
    }
}

pub(crate) fn goal_failure_summary(reason: GoalFailReason) -> String {
    match reason {
        GoalFailReason::NoResultByDeadline => {
            "Goal failed: budget ended without worker activity or available output.".to_string()
        }
        GoalFailReason::NoResultByWaveCap => {
            "Goal failed: wave cap reached without worker activity or available output.".to_string()
        }
    }
}
