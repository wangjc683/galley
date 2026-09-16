use serde::{Deserialize, Serialize};

use super::{Origin, SessionId};

/// Default time ceiling when a caller asks for "the default" (the GUI's
/// recommended preset, the CLI's `--budget-minutes` fallback). `None` on
/// [`CreateGoalInput::budget_seconds`] means no ceiling at all — that is
/// an explicit choice, never a default.
pub const DEFAULT_GOAL_BUDGET_SECONDS: u32 = 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GoalId(pub String);

impl GoalId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GoalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Goal v2 state machine (.scratch/goal-simplify/PRD.md §3.2).
///
/// - `Active`: Core re-dispatches a continuation whenever the session goes
///   idle.
/// - `Paused`: the user aborted the current run, or Core restarted with the
///   goal active. Recoverable — the next user message on the session
///   resumes it.
/// - `Blocked`: the model declared a blocker, or the run ended in an error.
///   Recoverable the same way as `Paused`; the distinction is who judged.
/// - `Completed` / `BudgetLimited` / `Stopped` / `Failed`: terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Paused,
    Blocked,
    Completed,
    BudgetLimited,
    Stopped,
    Failed,
}

impl GoalStatus {
    /// Not terminal: the goal still owns its session's idle time (`Active`)
    /// or can get it back with one user message (`Paused` / `Blocked`).
    /// This is the set the per-session uniqueness index guards.
    pub fn is_open(self) -> bool {
        matches!(self, Self::Active | Self::Paused | Self::Blocked)
    }

    pub fn is_terminal(self) -> bool {
        !self.is_open()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalBrief {
    pub id: GoalId,
    /// The session this goal drives. A goal has exactly one; the session
    /// may carry many goals over its life, at most one of them open.
    pub session_id: SessionId,
    pub objective: String,
    pub status: GoalStatus,
    /// Time ceiling in seconds. `None` = no ceiling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_seconds: Option<u32>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_seen_at: Option<String>,
    /// Continuations Core has dispatched so far (the wrap-up one included).
    pub continuation_count: u32,
    /// True once the budget-limit wrap-up continuation went out; the next
    /// idle after it lands the goal in `BudgetLimited`.
    pub wrap_up_dispatched: bool,
    /// Wall-clock seconds from `started_at` to `ended_at` (terminal) or to
    /// now (open). Computed at read time, never stored. Paused time is not
    /// subtracted in v2.
    pub elapsed_seconds: u64,
    pub created_at: String,
    pub updated_at: String,
    /// Who set the goal. Absent for GUI-set goals (same convention as
    /// `SessionBrief.origin`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalInput {
    pub session_id: SessionId,
    pub objective: String,
    /// `None` = no ceiling. Callers that want the product default pass
    /// [`DEFAULT_GOAL_BUDGET_SECONDS`] explicitly.
    #[serde(default)]
    pub budget_seconds: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_and_terminal_partition_the_status_set() {
        for s in [GoalStatus::Active, GoalStatus::Paused, GoalStatus::Blocked] {
            assert!(s.is_open());
            assert!(!s.is_terminal());
        }
        for s in [
            GoalStatus::Completed,
            GoalStatus::BudgetLimited,
            GoalStatus::Stopped,
            GoalStatus::Failed,
        ] {
            assert!(s.is_terminal());
            assert!(!s.is_open());
        }
    }

    #[test]
    fn status_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&GoalStatus::BudgetLimited).unwrap(),
            "\"budget_limited\""
        );
    }
}
