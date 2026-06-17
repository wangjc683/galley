use galley_core_lib::api::{
    GoalBrief, GoalEventBrief, GoalEventType, GoalId, GoalStatus, GoalStatusSnapshot,
    GoalTaskBrief, GoalTaskId, GoalTaskStatus, GoalWriteMode, ProjectId, RuntimeKind, SessionBrief,
    SessionId, SessionStatus,
};

use crate::args::{MorphlingOutputArg, MorphlingStrategyArg};

use super::controller::{
    goal_controller_decision, goal_controller_decision_after_wait, goal_drain_cap_seconds,
    goal_has_worker_material_signal, goal_master_checkpoint_event_body,
    goal_master_checkpoint_seen, goal_ready_idle_worker_slot_indices,
    goal_ready_worker_slot_indices, goal_seed_task_specs, goal_worker_has_progress_signal,
    goal_worker_has_terminal_signal, goal_worker_session_ids, goal_worker_terminal_counts,
    goal_worker_wave_baseline, goal_wrapping_summary,
};
use super::prompts::{
    goal_latest_check_report, goal_master_planning_prompt, goal_memory_policy_prompt,
    goal_worker_prompt_template, goal_worker_wake_prompt,
};
use super::types::{
    GoalControllerDecision, GoalFailReason, GoalMasterCheckpointKind, GoalWorkerSlot,
    GoalWorkerWaitOutcome, GoalWrapReason, GOAL_CHECK_REPORT_MARKER,
    GOAL_WORKER_SESSION_ID_PLACEHOLDER,
};
use super::{build_morphling_goal_objective, MorphlingGoalSpec};

fn test_goal() -> GoalBrief {
    GoalBrief {
        id: GoalId("goal_test".to_string()),
        proposal_id: None,
        project_id: ProjectId("proj_test".to_string()),
        master_session_id: Some(SessionId("master".to_string())),
        objective: "Test goal".to_string(),
        status: GoalStatus::Running,
        budget_seconds: 900,
        worker_limit: 2,
        runtime_kind: RuntimeKind::Managed,
        write_mode: GoalWriteMode::Autonomous,
        started_at: "2026-06-05T00:00:00Z".to_string(),
        deadline_at: "2026-06-05T00:15:00Z".to_string(),
        ended_at: None,
        latest_summary: None,
        result_seen_at: None,
        stop_requested: false,
        workspace_path: None,
        created_at: "2026-06-05T00:00:00Z".to_string(),
        updated_at: "2026-06-05T00:00:00Z".to_string(),
    }
}

fn test_task(id: &str, status: GoalTaskStatus, owner: Option<&str>) -> GoalTaskBrief {
    test_task_with_scope(id, status, owner, None)
}

fn test_task_with_scope(
    id: &str,
    status: GoalTaskStatus,
    owner: Option<&str>,
    scope: Option<&str>,
) -> GoalTaskBrief {
    GoalTaskBrief {
        id: GoalTaskId(id.to_string()),
        goal_id: GoalId("goal_test".to_string()),
        title: id.to_string(),
        description: None,
        status,
        owner_session_id: owner.map(|sid| SessionId(sid.to_string())),
        scope: scope.map(str::to_string),
        result_summary: None,
        created_at: "2026-06-05T00:00:00Z".to_string(),
        updated_at: "2026-06-05T00:00:00Z".to_string(),
    }
}

fn test_event(
    id: i64,
    event_type: GoalEventType,
    task: Option<&str>,
    author: Option<&str>,
) -> GoalEventBrief {
    GoalEventBrief {
        id,
        goal_id: GoalId("goal_test".to_string()),
        task_id: task.map(|task_id| GoalTaskId(task_id.to_string())),
        author_session_id: author.map(|sid| SessionId(sid.to_string())),
        event_type,
        body: "event".to_string(),
        created_at: "2026-06-05T00:00:00Z".to_string(),
    }
}

fn test_session(id: &str) -> SessionBrief {
    SessionBrief {
        id: SessionId(id.to_string()),
        project_id: Some("proj_test".to_string()),
        title: id.to_string(),
        status: SessionStatus::Completed,
        summary: None,
        turn_count: None,
        last_activity_at: "2026-06-05T00:00:00Z".to_string(),
        created_at: "2026-06-05T00:00:00Z".to_string(),
        updated_at: "2026-06-05T00:00:00Z".to_string(),
        pinned: None,
        has_unread: None,
        origin: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        runtime_kind: RuntimeKind::Managed,
        runtime_label: "Galley".to_string(),
        ga_runtime_kind: RuntimeKind::Managed,
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

fn test_snapshot(
    tasks: Vec<GoalTaskBrief>,
    events: Vec<GoalEventBrief>,
    sessions: Vec<SessionBrief>,
) -> GoalStatusSnapshot {
    GoalStatusSnapshot {
        goal: test_goal(),
        project: None,
        tasks,
        events,
        sessions,
        deliverable: None,
    }
}

fn test_slot(worker_index: u32, session_id: &str, baseline: &GoalStatusSnapshot) -> GoalWorkerSlot {
    GoalWorkerSlot {
        worker_index,
        wave: 1,
        baseline: goal_worker_wave_baseline(baseline, SessionId(session_id.to_string())),
        capped: false,
    }
}

#[test]
fn goal_controller_continues_with_results_while_budget_remains() {
    assert_eq!(
        goal_controller_decision(true, true, false),
        GoalControllerDecision::Continue
    );
}

#[test]
fn goal_controller_wraps_results_after_deadline() {
    assert_eq!(
        goal_controller_decision(false, true, false),
        GoalControllerDecision::Wrap(GoalWrapReason::Deadline)
    );
}

#[test]
fn goal_controller_continues_without_material_while_budget_remains() {
    assert_eq!(
        goal_controller_decision(true, false, false),
        GoalControllerDecision::Continue
    );
}

#[test]
fn goal_controller_does_not_fail_before_deadline_after_prior_results() {
    assert_eq!(
        goal_controller_decision(true, true, false),
        GoalControllerDecision::Continue
    );
}

#[test]
fn goal_controller_all_worker_slot_cap_wraps_when_results_exist() {
    assert_eq!(
        goal_controller_decision(true, true, true),
        GoalControllerDecision::Wrap(GoalWrapReason::WaveCap)
    );
}

#[test]
fn goal_controller_all_worker_slot_cap_fails_without_results() {
    assert_eq!(
        goal_controller_decision(true, false, true),
        GoalControllerDecision::Fail(GoalFailReason::NoResultByWaveCap)
    );
}

#[test]
fn goal_controller_deadline_fails_without_results() {
    assert_eq!(
        goal_controller_decision(false, false, false),
        GoalControllerDecision::Fail(GoalFailReason::NoResultByDeadline)
    );
}

#[test]
fn goal_controller_drain_cap_wraps_even_without_results() {
    assert_eq!(
        goal_controller_decision_after_wait(
            GoalWorkerWaitOutcome::DrainCapReached,
            false,
            false,
            false,
        ),
        GoalControllerDecision::Wrap(GoalWrapReason::DrainCap)
    );
}

#[test]
fn goal_controller_waits_when_worker_idle_without_terminal_signal() {
    assert_eq!(
        goal_controller_decision_after_wait(
            GoalWorkerWaitOutcome::IdleWithoutSignal,
            true,
            true,
            false,
        ),
        GoalControllerDecision::WaitForSignal
    );
}

#[test]
fn goal_controller_keeps_waiting_idle_without_signal_until_deadline() {
    assert_eq!(
        goal_controller_decision_after_wait(
            GoalWorkerWaitOutcome::IdleWithoutSignal,
            true,
            false,
            false,
        ),
        GoalControllerDecision::WaitForSignal
    );
}

#[test]
fn goal_worker_initial_prompt_binds_session_id_placeholder() {
    let task = test_task_with_scope(
        "task_1",
        GoalTaskStatus::Open,
        None,
        Some("goal-worker-1:first-pass"),
    );
    let prompt = goal_worker_prompt_template(&test_goal(), 1, 1, Some(&task));
    assert!(prompt.contains(GOAL_WORKER_SESSION_ID_PLACEHOLDER));
    assert_eq!(
        prompt.matches(GOAL_WORKER_SESSION_ID_PLACEHOLDER).count(),
        1
    );
    assert!(prompt.contains("Your session id: {{GALLEY_SESSION_ID}}"));
    assert!(prompt.contains("Do not infer your session id"));
    assert!(prompt.contains("Assigned task:"));
    assert!(prompt.contains("task_1"));
    assert!(prompt.contains("goal-worker-1:first-pass"));
    assert!(!prompt.contains("Identify your session id from the Goal status"));
}

#[test]
fn goal_memory_policy_allows_managed_self_evolution_without_protocol_state() {
    let task = test_task_with_scope(
        "task_1",
        GoalTaskStatus::Open,
        None,
        Some("goal-worker-1:first-pass"),
    );
    let prompt = goal_worker_prompt_template(&test_goal(), 1, 1, Some(&task));

    assert!(prompt.contains("Managed GA may use its normal memory/SOP self-evolution mechanism"));
    assert!(prompt.contains("durable, reusable learnings"));
    assert!(prompt.contains("Do not store Goal protocol state in memory/SOP"));
    assert!(prompt.contains("Goal ids, task ids, worker session ids"));
    assert!(prompt.contains("does not permit modifying GenericAgent config"));
    assert!(!prompt.contains("Do not write GenericAgent memory/SOP/config"));
}

#[test]
fn goal_memory_policy_keeps_external_ga_state_read_only() {
    let mut goal = test_goal();
    goal.runtime_kind = RuntimeKind::External;
    let task = test_task_with_scope(
        "task_1",
        GoalTaskStatus::Open,
        None,
        Some("goal-worker-1:first-pass"),
    );
    let prompt = goal_worker_prompt_template(&goal, 1, 1, Some(&task));

    assert!(prompt.contains("Attached external GA is user-owned"));
    assert!(prompt.contains("do not modify external GA memory, SOP, skills, config"));
    assert!(prompt.contains("temp/goal_state.json"));
    assert!(prompt.contains("Do not store Goal protocol state in memory/SOP"));
}

#[test]
fn goal_master_planner_uses_runtime_aware_memory_policy() {
    let managed_prompt = goal_master_planning_prompt(&test_snapshot(vec![], vec![], vec![]), 1);
    assert!(managed_prompt.contains("Managed GA may use its normal memory/SOP"));
    assert!(managed_prompt.contains("Do not store Goal protocol state in memory/SOP"));
    assert!(!managed_prompt.contains("Do not write GA memory, SOP, config"));

    let mut external_snapshot = test_snapshot(vec![], vec![], vec![]);
    external_snapshot.goal.runtime_kind = RuntimeKind::External;
    let external_prompt = goal_master_planning_prompt(&external_snapshot, 1);
    assert!(external_prompt.contains("Attached external GA is user-owned"));
    assert!(external_prompt.contains("do not modify external GA memory, SOP"));
    // Both runtimes get the Hive master discipline; attach reads a
    // Galley-owned SOP file (or inline fallback), managed reads memory.
    assert!(external_prompt.contains("decompose, judge, aggregate"));
    assert!(managed_prompt.contains("Read memory/goal_hive_master_duty.md"));
}

#[test]
fn goal_master_planner_uses_native_goal_policy() {
    let mut snapshot = test_snapshot(vec![], vec![], vec![]);
    snapshot.goal.runtime_kind = RuntimeKind::GalleyNative;
    let prompt = goal_master_planning_prompt(&snapshot, 1);

    assert!(prompt.contains("native Hive master"));
    assert!(prompt.contains("Galley Core owns the task board"));
    assert!(prompt.contains("deliverable anchor"));
    assert!(prompt.contains("evidence-backed start_long_term_update"));
    assert!(prompt.contains("Goal protocol state belongs in Galley Core"));
    assert!(!prompt.contains("not executable yet"));
    assert!(!prompt.contains("use managed or external runtime"));
}

#[test]
fn goal_worker_wake_prompt_reuses_memory_policy() {
    let task = GoalTaskBrief {
        description: Some("Review the current answer and find gaps.".to_string()),
        ..test_task_with_scope(
            "task_wake",
            GoalTaskStatus::Open,
            None,
            Some("goal-worker-2:verification"),
        )
    };
    let prompt = goal_worker_wake_prompt(
        &test_goal(),
        2,
        2,
        &SessionId("worker_2".to_string()),
        &task,
    );

    assert!(prompt.contains(goal_memory_policy_prompt(RuntimeKind::Managed)));
    assert!(!prompt.contains("write GenericAgent memory/SOP/config"));
}

#[test]
fn goal_worker_wake_prompt_reuses_native_memory_policy() {
    let mut goal = test_goal();
    goal.runtime_kind = RuntimeKind::GalleyNative;
    let task = GoalTaskBrief {
        description: Some("Review the current answer and find gaps.".to_string()),
        ..test_task_with_scope(
            "task_native_wake",
            GoalTaskStatus::Open,
            None,
            Some("goal-worker-1:verification"),
        )
    };
    let prompt =
        goal_worker_wake_prompt(&goal, 2, 1, &SessionId("worker_native".to_string()), &task);

    assert!(prompt.contains(goal_memory_policy_prompt(RuntimeKind::GalleyNative)));
    assert!(prompt.contains("Do not store Goal protocol state in native memory"));
    assert!(!prompt.contains("not executable yet"));
}

#[test]
fn morphling_goal_objective_requires_same_test_and_blocks_clone_strategy() {
    let prompt = build_morphling_goal_objective(&MorphlingGoalSpec {
        target: "toy-cli".to_string(),
        objective: Some("Absorb only the greeting command behavior.".to_string()),
        tests: vec![
            "toy-cli --help exits 0".to_string(),
            "toy-cli greet JC prints greeting".to_string(),
        ],
        strategy: MorphlingStrategyArg::Decide,
        output: MorphlingOutputArg::CapabilityPackCandidate,
    })
    .unwrap();

    assert!(prompt.contains("[Galley Morphling Native Goal]"));
    assert!(prompt.contains("Mode: morphling"));
    assert!(prompt.contains("Target: toy-cli"));
    assert!(prompt.contains("same-test comparison"));
    assert!(prompt.contains("toy-cli --help exits 0"));
    assert!(prompt.contains("disabled capability-pack candidate"));
    assert!(prompt.contains("Do not reproduce proprietary code"));
    assert!(prompt.contains("call, wrap, rewrite, discard"));
    assert!(prompt.contains("Capability pack scripts stay read-only candidates"));
}

#[test]
fn morphling_goal_objective_constructs_tests_when_none_are_supplied() {
    let prompt = build_morphling_goal_objective(&MorphlingGoalSpec {
        target: "https://example.test/tool".to_string(),
        objective: None,
        tests: vec!["  ".to_string()],
        strategy: MorphlingStrategyArg::Rewrite,
        output: MorphlingOutputArg::Report,
    })
    .unwrap();

    assert!(prompt.contains("Infer the smallest useful capability boundary"));
    assert!(prompt.contains("No official tests supplied"));
    assert!(prompt.contains("minimal objective same-test"));
    assert!(prompt.contains("prefer a clean-room rewrite when justified"));
}

#[test]
fn morphling_goal_objective_rejects_empty_target() {
    let err = build_morphling_goal_objective(&MorphlingGoalSpec {
        target: "  ".to_string(),
        objective: None,
        tests: vec![],
        strategy: MorphlingStrategyArg::Decide,
        output: MorphlingOutputArg::Report,
    })
    .unwrap_err();

    assert!(err.to_string().contains("target must not be empty"));
}

#[test]
fn goal_seed_tasks_adapt_to_worker_limit_without_domain_roles() {
    let mut goal = test_goal();
    goal.worker_limit = 2;
    let two = goal_seed_task_specs(&goal);
    assert_eq!(two.len(), 2);
    assert_eq!(two[0].1.scope, "goal-worker-1:first-pass");
    assert_eq!(two[1].1.scope, "goal-worker-2:independent-review");
    assert!(two[0].1.title.contains("第一版完整结果"));
    assert!(two[1].1.title.contains("独立核对"));

    goal.worker_limit = 3;
    let three = goal_seed_task_specs(&goal);
    assert_eq!(three.len(), 3);
    assert_eq!(three[2].1.scope, "goal-worker-3:synthesis-polish");

    goal.worker_limit = 5;
    let five = goal_seed_task_specs(&goal);
    assert_eq!(five.len(), 5);
    assert_eq!(five[4].1.scope, "goal-worker-5:final-quality-review");

    let combined = five
        .iter()
        .map(|(_, spec)| format!("{} {}", spec.title, spec.description))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!combined.contains("最新信息"));
    assert!(!combined.contains("来源交叉验证"));
    assert!(!combined.contains("Worker 1=核心调研"));
}

#[test]
fn goal_worker_wake_prompt_points_to_concrete_task_not_generic_continuation() {
    let task = GoalTaskBrief {
        description: Some("Review the current answer and find gaps.".to_string()),
        ..test_task_with_scope(
            "task_wake",
            GoalTaskStatus::Open,
            None,
            Some("goal-worker-2:verification"),
        )
    };
    let prompt = goal_worker_wake_prompt(
        &test_goal(),
        2,
        2,
        &SessionId("worker_2".to_string()),
        &task,
    );

    assert!(prompt.contains("[Galley Goal Worker Task]"));
    assert!(prompt.contains("task_wake"));
    assert!(prompt.contains("goal-worker-2:verification"));
    assert!(prompt.contains("galley goal task claim task_wake"));
    assert!(!prompt.contains("[Galley Goal Worker Continuation]"));
    assert!(!prompt.contains("Continue as worker"));
}

#[test]
fn goal_master_checkpoint_body_carries_internal_marker() {
    let body = goal_master_checkpoint_event_body(
        GoalMasterCheckpointKind::WorkersStarted,
        "已启动 2 个 Agent，正在拆分任务。",
    );
    assert!(body.starts_with(GoalMasterCheckpointKind::WorkersStarted.marker()));
    assert!(body.contains("已启动 2 个 Agent，正在拆分任务。"));
}

#[test]
fn goal_master_checkpoint_seen_dedupes_by_kind_and_master_session() {
    let mut workers_event = test_event(1, GoalEventType::System, None, Some("master"));
    workers_event.body = goal_master_checkpoint_event_body(
        GoalMasterCheckpointKind::WorkersStarted,
        "已启动 2 个 Agent，正在拆分任务。",
    );
    let mut worker_authored_event = test_event(2, GoalEventType::System, None, Some("worker_1"));
    worker_authored_event.body = goal_master_checkpoint_event_body(
        GoalMasterCheckpointKind::FirstMaterial,
        "已有初步进展，正在继续核对和整理。",
    );
    let snapshot = test_snapshot(vec![], vec![workers_event, worker_authored_event], vec![]);

    assert!(goal_master_checkpoint_seen(
        &snapshot,
        GoalMasterCheckpointKind::WorkersStarted
    ));
    assert!(!goal_master_checkpoint_seen(
        &snapshot,
        GoalMasterCheckpointKind::FirstMaterial
    ));
}

#[test]
fn goal_latest_check_report_returns_newest_stripped_body() {
    let none_snapshot = test_snapshot(vec![], vec![], vec![]);
    assert!(goal_latest_check_report(&none_snapshot).is_none());

    let mut older = test_event(1, GoalEventType::System, None, Some("master"));
    older.body = format!("{GOAL_CHECK_REPORT_MARKER} P0: missing tests; P1: naming");
    let mut unrelated = test_event(2, GoalEventType::System, None, Some("worker_1"));
    unrelated.body = "Wave 1 worker 1 session started.".to_string();
    let mut newer = test_event(3, GoalEventType::System, None, Some("master"));
    newer.body = format!("{GOAL_CHECK_REPORT_MARKER} P0: crash on empty input");
    let snapshot = test_snapshot(vec![], vec![older, unrelated, newer], vec![]);

    let report = goal_latest_check_report(&snapshot).expect("latest report");
    assert_eq!(report, "P0: crash on empty input");
}

#[test]
fn goal_worker_terminal_signal_requires_task_or_result_growth() {
    let worker = SessionId("worker_1".to_string());
    let before = test_snapshot(vec![], vec![], vec![]);
    let baseline = goal_worker_wave_baseline(&before, worker.clone());
    let turn_count_only = test_snapshot(vec![], vec![], vec![test_session("worker_1")]);
    assert!(!goal_worker_has_terminal_signal(
        &turn_count_only,
        &baseline
    ));

    let completed_task = test_snapshot(
        vec![test_task(
            "task_1",
            GoalTaskStatus::Completed,
            Some("worker_1"),
        )],
        vec![],
        vec![],
    );
    assert!(goal_worker_has_terminal_signal(&completed_task, &baseline));

    let result_event = test_snapshot(
        vec![],
        vec![test_event(1, GoalEventType::Result, None, Some("worker_1"))],
        vec![],
    );
    assert!(goal_worker_has_terminal_signal(&result_event, &baseline));

    assert_eq!(
        goal_worker_terminal_counts(&result_event, &worker).result_event_count,
        1
    );
}

#[test]
fn goal_worker_progress_signal_accepts_claimed_task_without_terminal_result() {
    let worker = SessionId("worker_1".to_string());
    let before = test_snapshot(vec![], vec![], vec![]);
    let baseline = goal_worker_wave_baseline(&before, worker);
    let claimed_task = test_snapshot(
        vec![test_task(
            "task_1",
            GoalTaskStatus::Claimed,
            Some("worker_1"),
        )],
        vec![],
        vec![],
    );
    assert!(!goal_worker_has_terminal_signal(&claimed_task, &baseline));
    assert!(goal_worker_has_progress_signal(&claimed_task, &baseline));
}

#[test]
fn goal_worker_result_event_can_belong_to_owned_task() {
    let before = test_snapshot(
        vec![test_task(
            "task_1",
            GoalTaskStatus::Running,
            Some("worker_1"),
        )],
        vec![],
        vec![],
    );
    let baseline = goal_worker_wave_baseline(&before, SessionId("worker_1".to_string()));
    let after = test_snapshot(
        vec![test_task(
            "task_1",
            GoalTaskStatus::Running,
            Some("worker_1"),
        )],
        vec![test_event(1, GoalEventType::Result, Some("task_1"), None)],
        vec![],
    );
    assert!(goal_worker_has_terminal_signal(&after, &baseline));
}

#[test]
fn goal_ready_worker_slots_are_independent_per_session() {
    let before = test_snapshot(vec![], vec![], vec![]);
    let slots = vec![
        test_slot(1, "worker_1", &before),
        test_slot(2, "worker_2", &before),
    ];
    let after = test_snapshot(
        vec![test_task(
            "task_2",
            GoalTaskStatus::Completed,
            Some("worker_2"),
        )],
        vec![],
        vec![],
    );
    assert_eq!(goal_ready_worker_slot_indices(&after, &slots), vec![1]);
}

#[test]
fn goal_ready_worker_slot_must_be_idle_before_wake() {
    let before = test_snapshot(vec![], vec![], vec![]);
    let slots = vec![test_slot(1, "worker_1", &before)];
    let after = test_snapshot(
        vec![test_task(
            "task_1",
            GoalTaskStatus::Completed,
            Some("worker_1"),
        )],
        vec![],
        vec![],
    );

    assert_eq!(goal_ready_worker_slot_indices(&after, &slots), vec![0]);
    assert!(goal_ready_idle_worker_slot_indices(
        &after,
        &slots,
        &[SessionId("worker_1".to_string())]
    )
    .is_empty());
    assert_eq!(
        goal_ready_idle_worker_slot_indices(&after, &slots, &[]),
        vec![0]
    );
}

#[test]
fn controller_assigned_open_tasks_are_not_worker_material_until_claimed() {
    let open_seed = test_snapshot(
        vec![test_task_with_scope(
            "seed",
            GoalTaskStatus::Open,
            None,
            Some("goal-worker-1:first-pass"),
        )],
        vec![],
        vec![],
    );
    assert!(!goal_has_worker_material_signal(&open_seed));

    let claimed_seed = test_snapshot(
        vec![test_task_with_scope(
            "seed",
            GoalTaskStatus::Claimed,
            Some("worker_1"),
            Some("goal-worker-1:first-pass"),
        )],
        vec![],
        vec![],
    );
    assert!(goal_has_worker_material_signal(&claimed_seed));
}

#[test]
fn goal_worker_session_ids_falls_back_to_project_sessions_without_master() {
    let snapshot = test_snapshot(
        vec![],
        vec![],
        vec![
            test_session("master"),
            test_session("worker_1"),
            test_session("worker_2"),
        ],
    );
    assert_eq!(
        goal_worker_session_ids(&snapshot, &[]),
        vec![
            SessionId("worker_1".to_string()),
            SessionId("worker_2".to_string())
        ]
    );
}

#[test]
fn goal_worker_session_ids_prefers_goal_event_authors_over_project_sessions() {
    let snapshot = test_snapshot(
        vec![],
        vec![test_event(1, GoalEventType::System, None, Some("worker_1"))],
        vec![
            test_session("master"),
            test_session("worker_1"),
            test_session("unrelated_project_session"),
        ],
    );
    assert_eq!(
        goal_worker_session_ids(&snapshot, &[]),
        vec![SessionId("worker_1".to_string())]
    );
}

#[test]
fn goal_drain_cap_scales_with_budget_inside_bounds() {
    assert_eq!(goal_drain_cap_seconds(15 * 60), 5 * 60);
    assert_eq!(goal_drain_cap_seconds(30 * 60), 450);
    assert_eq!(goal_drain_cap_seconds(60 * 60), 15 * 60);
    assert_eq!(goal_drain_cap_seconds(120 * 60), 15 * 60);
}

#[test]
fn goal_wrapping_summary_marks_drain_cap() {
    let summary = goal_wrapping_summary(GoalWrapReason::DrainCap, false);
    assert!(summary.contains("drain cap reached"));
    assert!(summary.contains("available results"));
}
