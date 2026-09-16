//! `galley goal …` — Goal v2 (schemaVersion 2). Four thin socket calls;
//! the whole engine lives in Galley Core (`crate::goal_engine` there).

use crate::client::call_print;
use galley_core_lib::api::DEFAULT_GOAL_BUDGET_SECONDS;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    GoalActiveArgs, GoalExtendArgs, GoalStartArgs, GoalStatusArgs, GoalStopArgs,
};

/// Resolve the CLI's budget flags into the wire's explicit choice:
/// `--budget-minutes=N` → N minutes, `--no-budget` → no ceiling, neither →
/// the product default. Both together is a contradiction.
pub(crate) fn budget_seconds_from_flags(
    budget_minutes: Option<u32>,
    no_budget: bool,
) -> Result<Option<u32>, GalleyError> {
    match (budget_minutes, no_budget) {
        (Some(_), true) => Err(GalleyError::InvalidArgs {
            message: "goal start: --budget-minutes and --no-budget are mutually exclusive".into(),
        }),
        (Some(0), false) => Err(GalleyError::InvalidArgs {
            message: "goal start: --budget-minutes must be at least 1 (or use --no-budget)".into(),
        }),
        (Some(minutes), false) => Ok(Some(minutes.saturating_mul(60))),
        (None, true) => Ok(None),
        (None, false) => Ok(Some(DEFAULT_GOAL_BUDGET_SECONDS)),
    }
}

pub(crate) async fn goal_start(
    session_id: String,
    objective: String,
    budget_minutes: Option<u32>,
    no_budget: bool,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let budget_seconds = budget_seconds_from_flags(budget_minutes, no_budget)?;
    call_print(GoalStartArgs {
        session_id,
        objective,
        budget_seconds,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn goal_status(goal_id: String) -> Result<(), GalleyError> {
    call_print(GoalStatusArgs { goal_id }).await
}

pub(crate) async fn goal_active() -> Result<(), GalleyError> {
    call_print(GoalActiveArgs {}).await
}

pub(crate) async fn goal_stop(
    goal_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(GoalStopArgs {
        goal_id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn goal_extend(
    goal_id: String,
    minutes: u32,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    if minutes == 0 {
        return Err(GalleyError::InvalidArgs {
            message: "goal extend: --minutes must be at least 1".into(),
        });
    }
    call_print(GoalExtendArgs {
        goal_id,
        extra_seconds: minutes.saturating_mul(60),
        supervisor,
        reason,
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_flags_resolve_to_the_wire_choice() {
        assert_eq!(
            budget_seconds_from_flags(None, false).unwrap(),
            Some(DEFAULT_GOAL_BUDGET_SECONDS)
        );
        assert_eq!(
            budget_seconds_from_flags(Some(30), false).unwrap(),
            Some(1800)
        );
        assert_eq!(budget_seconds_from_flags(None, true).unwrap(), None);
        assert!(matches!(
            budget_seconds_from_flags(Some(30), true),
            Err(GalleyError::InvalidArgs { .. })
        ));
        assert!(matches!(
            budget_seconds_from_flags(Some(0), false),
            Err(GalleyError::InvalidArgs { .. })
        ));
    }
}
