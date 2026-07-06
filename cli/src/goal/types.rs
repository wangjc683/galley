use std::time::Duration;

use galley_core_lib::api::{GoalBrief, SessionId};
use serde::Serialize;

pub(crate) const GOAL_CONTROLLER_MAX_WAVES: u32 = 50;
pub(crate) const GOAL_WORKER_SIGNAL_GRACE_SECONDS: u64 = 60;
pub(crate) const GOAL_CONTROLLER_MIN_DRAIN_SECONDS: u64 = 300;
pub(crate) const GOAL_CONTROLLER_MAX_DRAIN_SECONDS: u64 = 900;
pub(crate) const GOAL_WORKER_SESSION_ID_PLACEHOLDER: &str = "{{GALLEY_SESSION_ID}}";
pub(crate) const GOAL_SEED_TASK_MARKER: &str = "[galley-seed-tasks:v1]";
pub(crate) const GOAL_MASTER_PLANNING_MARKER: &str = "[galley-master-planning:v1]";
/// Marker that opens a master-authored check report event. The body
/// after it is a free-text P0/P1 issue list the next design round reads
/// as its changelog. Reuses the event stream (no schema/CLI change).
pub(crate) const GOAL_CHECK_REPORT_MARKER: &str = "[galley-check-report]";
pub(crate) const GOAL_CONTROLLER_TASK_SCOPE_PREFIX: &str = "goal-worker-";
pub(crate) const GOAL_MASTER_PLANNING_TIMEOUT_SECONDS: u64 = 180;
pub(crate) const GOAL_MASTER_PLANNING_TIMEOUT: Duration =
    Duration::from_secs(GOAL_MASTER_PLANNING_TIMEOUT_SECONDS);
/// Hard ceiling for the stop-mode wrap-up synthesis. The user asked to
/// stop; a brief accounting is worth ~2 minutes, an anchor-polishing
/// final answer is not.
pub(crate) const GOAL_STOP_SYNTHESIS_TIMEOUT_SECONDS: u64 = 120;

/// How `finish_goal_with_master` ends the run. `Normal` is the budget /
/// wave-cap wrap: full synthesis, terminal `Completed`. `StopWrapUp` is
/// the user-requested stop: brief wrap-up prompt, tight timeout, and the
/// terminal state stays `Stopped` — on timeout it stops without a
/// summary instead of keeping the goal alive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalFinishMode {
    Normal,
    StopWrapUp,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoalRunFrame<'a> {
    pub(crate) schema_version: u32,
    pub(crate) stream: &'static str,
    pub(crate) phase: &'a str,
    pub(crate) goal: &'a GoalBrief,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) note: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GoalWorkerWaveBaseline {
    pub(crate) session_id: SessionId,
    pub(crate) terminal_counts: GoalWorkerTerminalCounts,
    pub(crate) progress_counts: GoalWorkerProgressCounts,
    pub(crate) reminder_sent: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct GoalWorkerSlot {
    pub(crate) worker_index: u32,
    pub(crate) wave: u32,
    pub(crate) baseline: GoalWorkerWaveBaseline,
    pub(crate) capped: bool,
}

impl GoalWorkerSlot {
    pub(crate) fn session_id(&self) -> &SessionId {
        &self.baseline.session_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GoalTaskSpec {
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) scope: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalMasterCheckpointKind {
    PlanningStarted,
    WorkersStarted,
    FirstMaterial,
    DeadlineReached,
}

impl GoalMasterCheckpointKind {
    pub(crate) fn marker(self) -> &'static str {
        match self {
            GoalMasterCheckpointKind::PlanningStarted => {
                "[galley-master-checkpoint:planning_started]"
            }
            GoalMasterCheckpointKind::WorkersStarted => {
                "[galley-master-checkpoint:workers_started]"
            }
            GoalMasterCheckpointKind::FirstMaterial => "[galley-master-checkpoint:first_material]",
            GoalMasterCheckpointKind::DeadlineReached => {
                "[galley-master-checkpoint:deadline_reached]"
            }
        }
    }

    pub(crate) fn reason_label(self) -> &'static str {
        match self {
            GoalMasterCheckpointKind::PlanningStarted => "planning started",
            GoalMasterCheckpointKind::WorkersStarted => "workers started",
            GoalMasterCheckpointKind::FirstMaterial => "first material",
            GoalMasterCheckpointKind::DeadlineReached => "deadline reached",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct GoalWorkerTerminalCounts {
    pub(crate) terminal_task_count: usize,
    pub(crate) result_event_count: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct GoalWorkerProgressCounts {
    pub(crate) task_count: usize,
    pub(crate) worker_event_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalControllerDecision {
    Continue,
    WaitForSignal,
    Wrap(GoalWrapReason),
    Fail(GoalFailReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalWrapReason {
    Deadline,
    DrainCap,
    WaveCap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GoalFailReason {
    NoResultByDeadline,
    NoResultByWaveCap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GoalActivityCounts {
    pub(crate) task_count: usize,
    pub(crate) completed_task_count: usize,
    pub(crate) worker_event_count: usize,
    pub(crate) result_event_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GoalWorkerWaitOutcome {
    ReadySlots(Vec<usize>),
    IdleWithoutSignal,
    DrainCapReached,
}
