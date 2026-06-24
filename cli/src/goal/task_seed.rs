use crate::goal::types::{GoalTaskSpec, GOAL_CONTROLLER_TASK_SCOPE_PREFIX};
use galley_core_lib::api::{GoalBrief, GoalStatusSnapshot, GoalTaskBrief, GoalTaskStatus};

pub(crate) fn goal_seed_task_specs(goal: &GoalBrief) -> Vec<(u32, GoalTaskSpec)> {
    let worker_limit = goal.worker_limit.max(1);
    let mut specs = Vec::new();
    specs.push((
        1,
        goal_task_spec(
            1,
            "first-pass",
            "第一版完整结果",
            format!(
                "围绕目标「{}」产出第一版可交付结果，写清主要结论、依据、假设和仍需补齐的缺口。",
                goal.objective
            ),
        ),
    ));
    if worker_limit >= 2 {
        specs.push((
            2,
            goal_task_spec(
                2,
                "independent-review",
                "独立核对与补缺",
                format!(
                    "独立检查目标「{}」的事实、约束、风险和遗漏，优先找出第一版结果最需要改进的地方。",
                    goal.objective
                ),
            ),
        ));
    }
    if worker_limit >= 3 {
        specs.push((
            3,
            goal_task_spec(
                3,
                "synthesis-polish",
                "结构整理与下一步建议",
                format!(
                    "把围绕目标「{}」的已有发现整理成用户容易理解的结构，并补充可执行的下一步建议。",
                    goal.objective
                ),
            ),
        ));
    }
    if worker_limit >= 4 {
        specs.push((
            4,
            goal_task_spec(
                4,
                "alternatives-edge-cases",
                "替代方案、边界和反例检查",
                format!(
                    "从替代路径、边界情况和反例角度检查目标「{}」，指出可能被忽略的选择或风险。",
                    goal.objective
                ),
            ),
        ));
    }
    if worker_limit >= 5 {
        specs.push((
            5,
            goal_task_spec(
                5,
                "final-quality-review",
                "最终质量、风险和交付检查",
                format!(
                    "对目标「{}」的最终交付做质量检查，确认结论、风险、缺口和下一步都可直接交给用户。",
                    goal.objective
                ),
            ),
        ));
    }
    specs
}

fn goal_task_spec(
    worker_index: u32,
    kind: &str,
    title: impl Into<String>,
    description: impl Into<String>,
) -> GoalTaskSpec {
    GoalTaskSpec {
        title: title.into(),
        description: description.into(),
        scope: format!("{GOAL_CONTROLLER_TASK_SCOPE_PREFIX}{worker_index}:{kind}"),
    }
}

pub(crate) fn goal_open_assigned_task_for_worker(
    snapshot: &GoalStatusSnapshot,
    worker_index: u32,
) -> Option<&GoalTaskBrief> {
    let prefix = format!("{GOAL_CONTROLLER_TASK_SCOPE_PREFIX}{worker_index}:");
    snapshot.tasks.iter().find(|task| {
        task.status == GoalTaskStatus::Open
            && task
                .scope
                .as_deref()
                .is_some_and(|scope| scope.starts_with(&prefix))
    })
}

pub(crate) fn goal_has_open_assigned_task(snapshot: &GoalStatusSnapshot) -> bool {
    snapshot.tasks.iter().any(|task| {
        task.status == GoalTaskStatus::Open
            && task
                .scope
                .as_deref()
                .is_some_and(|scope| scope.starts_with(GOAL_CONTROLLER_TASK_SCOPE_PREFIX))
    })
}

pub(crate) fn goal_worker_slot_exists(
    slots: &[crate::goal::types::GoalWorkerSlot],
    worker_index: u32,
) -> bool {
    slots.iter().any(|slot| slot.worker_index == worker_index)
}

pub(crate) fn goal_task_is_controller_assigned(task: &GoalTaskBrief) -> bool {
    task.scope
        .as_deref()
        .is_some_and(|scope| scope.starts_with(GOAL_CONTROLLER_TASK_SCOPE_PREFIX))
}
