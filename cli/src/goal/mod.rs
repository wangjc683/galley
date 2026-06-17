mod controller;
mod prompts;
mod types;

#[cfg(test)]
mod tests;

use crate::args::{
    GoalDeliverableCmd, GoalEventCmd, GoalTaskCmd, GoalWriteModeArg, MorphlingOutputArg,
    MorphlingStrategyArg, RuntimeArg,
};
use crate::common::{cli_origin, emit_json, runtime_kind_for_goal};
use galley_core_lib::api::{
    ClaimGoalTaskInput, CreateGoalEventInput, CreateGoalProposalInput, CreateGoalTaskInput,
    GalleyApi, GoalId, GoalProposalId, GoalStatus, GoalTaskId, GoalTaskStatus, RuntimeKind,
    SessionId, UpdateGoalTaskInput,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;

pub(crate) async fn goal_propose(
    objective: String,
    project: Option<String>,
    budget_minutes: u32,
    workers: u32,
    runtime: RuntimeArg,
    write_mode: GoalWriteModeArg,
    expires_minutes: u32,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let runtime_kind = runtime_kind_for_goal(&galley, runtime).await?;
    let proposal = galley
        .create_goal_proposal(
            CreateGoalProposalInput {
                objective,
                project_id: project.map(galley_core_lib::api::ProjectId),
                master_session_id: None,
                budget_seconds: Some(budget_minutes.saturating_mul(60)),
                worker_limit: Some(workers),
                runtime_kind: Some(runtime_kind),
                write_mode: Some(write_mode.into()),
                expires_in_seconds: Some(expires_minutes.saturating_mul(60)),
            },
            cli_origin(supervisor, reason),
        )
        .await?;
    emit_json(&proposal)?;
    Ok(())
}

pub(crate) struct MorphlingGoalSpec {
    pub(crate) target: String,
    pub(crate) objective: Option<String>,
    pub(crate) tests: Vec<String>,
    pub(crate) strategy: MorphlingStrategyArg,
    pub(crate) output: MorphlingOutputArg,
}

pub(crate) fn build_morphling_goal_objective(
    spec: &MorphlingGoalSpec,
) -> Result<String, GalleyError> {
    let target = spec.target.trim();
    if target.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "goal morphling: target must not be empty".into(),
        });
    }
    let objective = spec
        .objective
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Infer the smallest useful capability boundary and decide whether Galley should call, wrap, rewrite, discard, or only document it.");
    let tests = spec
        .tests
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let tests_block = if tests.is_empty() {
        "- No official tests supplied. First find official tests, CI, benchmarks, demos, examples, issue repros, or construct a minimal objective same-test before claiming parity.".to_string()
    } else {
        tests
            .iter()
            .enumerate()
            .map(|(index, test)| format!("{}. {test}", index + 1))
            .collect::<Vec<_>>()
            .join("\n")
    };

    Ok(format!(
        r#"[Galley Morphling Native Goal]

Mode: morphling
Runtime requirement: galley_native
Target: {target}
Objective: {objective}
Initial strategy bias: {strategy}
Requested output: {output}

Mission:
Morphling is capability absorption or replacement, not cloning. Extract what the target solves, who it serves, what evidence proves it works, which components matter, and how Galley can match or exceed the target on the same exam.

Operating loop:
1. Lock target source, version, license/terms signal, and scope. If the target is ambiguous, narrow it before implementation.
2. Extract target claims, user value, main workflows, interfaces, and constraints.
3. Find official tests, CI, benchmarks, demos, examples, issue repros, or published acceptance criteria.
4. If no objective tests exist, construct a minimal same-test suite that measures the user-visible capability instead of surface similarity.
5. Decompose components and decide per component: call, wrap, rewrite, discard, or defer.
6. Implement only the smallest lawful path needed for the objective.
7. Run the same-test comparison against the target or documented target behavior.
8. Record evidence, command output, gaps, tradeoffs, and why the chosen component strategy is justified.
9. Produce the requested output. Capability-pack output must remain a disabled candidate until a human explicitly approves activation.
10. Propose durable memory/capability absorption only with evidence; never store Goal protocol state in native memory.

Same-test evidence to use or construct:
{tests_block}

Safety rules:
- Do not reproduce proprietary code, protected assets, private prompts, private datasets, or brand-confusing surface as the strategy.
- Prefer calling mature lawful dependencies when that is enough; prefer clean-room rewrite only for small, coupled, outdated, UX-critical, or strategically differentiating parts.
- Destructive filesystem changes, package/service installation, external sends, credentials, commits, pushes, and high-risk capability activation still require explicit approval.
- Capability pack scripts stay read-only candidates; do not execute `capability://` scripts directly.
- If the target cannot be lawfully or safely absorbed, produce a report explaining why not and what narrower capability remains useful.

Final deliverable requirements:
- conclusion: call / wrap / rewrite / discard / no-absorb;
- target claims and evidence source;
- component strategy table;
- same-test comparison with commands/results or a clear blocker;
- produced artifact or disabled capability-pack candidate, if requested;
- limitations, rollback path, and next action.
"#,
        strategy = spec.strategy.as_label(),
        output = spec.output.as_label(),
    ))
}

pub(crate) async fn goal_morphling(
    target: String,
    objective: Option<String>,
    tests: Vec<String>,
    strategy: MorphlingStrategyArg,
    output: MorphlingOutputArg,
    project: Option<String>,
    budget_minutes: u32,
    workers: u32,
    write_mode: GoalWriteModeArg,
    expires_minutes: u32,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    galley_core_lib::runtime::ensure_goal_runtime_available(RuntimeKind::GalleyNative)?;
    let objective = build_morphling_goal_objective(&MorphlingGoalSpec {
        target,
        objective,
        tests,
        strategy,
        output,
    })?;
    let galley = SqliteGalley::open().await?;
    let proposal = galley
        .create_goal_proposal(
            CreateGoalProposalInput {
                objective,
                project_id: project.map(galley_core_lib::api::ProjectId),
                master_session_id: None,
                budget_seconds: Some(budget_minutes.saturating_mul(60)),
                worker_limit: Some(workers),
                runtime_kind: Some(RuntimeKind::GalleyNative),
                write_mode: Some(write_mode.into()),
                expires_in_seconds: Some(expires_minutes.saturating_mul(60)),
            },
            cli_origin(supervisor, reason),
        )
        .await?;
    emit_json(&proposal)?;
    Ok(())
}

pub(crate) async fn goal_run(
    goal_id: Option<String>,
    proposal: Option<String>,
    confirm_token: Option<String>,
    resume: bool,
    locale: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    controller::set_goal_narration_locale(locale);
    let galley = SqliteGalley::open().await?;
    let goal = if let Some(proposal_id) = proposal {
        let token = confirm_token.ok_or_else(|| GalleyError::InvalidArgs {
            message: "goal run: --confirm-token is required with --proposal".into(),
        })?;
        galley
            .start_goal_from_proposal(
                GoalProposalId(proposal_id),
                token,
                cli_origin(supervisor.clone(), reason.clone()),
            )
            .await?
    } else if resume {
        let id = goal_id.ok_or_else(|| GalleyError::InvalidArgs {
            message: "goal run --resume requires <goal-id>".into(),
        })?;
        galley.goal_status(GoalId(id)).await?.goal
    } else {
        return Err(GalleyError::InvalidArgs {
            message: "goal run requires --proposal <id> or <goal-id> --resume".into(),
        });
    };
    if let Err(err) =
        controller::run_goal_controller(&galley, goal.clone(), supervisor, reason).await
    {
        if matches!(goal.status, GoalStatus::Running | GoalStatus::Wrapping) {
            let _ = galley
                .update_goal_state(
                    goal.id.clone(),
                    GoalStatus::Failed,
                    Some(format!("Goal controller failed: {err}")),
                )
                .await;
        }
        return Err(err);
    }
    Ok(())
}

pub(crate) async fn goal_status(goal_id: String) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let snapshot = galley.goal_status(GoalId(goal_id)).await?;
    emit_json(&snapshot)?;
    Ok(())
}

pub(crate) async fn goal_stop(
    goal_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let goal = galley
        .request_goal_stop(GoalId(goal_id), cli_origin(supervisor, reason))
        .await?;
    emit_json(&goal)?;
    Ok(())
}

pub(crate) async fn goal_task(cmd: GoalTaskCmd) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    match cmd {
        GoalTaskCmd::Create {
            goal_id,
            title,
            description,
            scope,
            owner_session,
        } => {
            let task = galley
                .create_goal_task(CreateGoalTaskInput {
                    goal_id: GoalId(goal_id),
                    title,
                    description,
                    scope,
                    owner_session_id: owner_session.map(SessionId),
                })
                .await?;
            emit_json(&task)?;
        }
        GoalTaskCmd::Claim {
            task_id,
            owner_session,
            scope,
        } => {
            let task = galley
                .claim_goal_task(ClaimGoalTaskInput {
                    task_id: GoalTaskId(task_id),
                    owner_session_id: SessionId(owner_session),
                    scope,
                })
                .await?;
            emit_json(&task)?;
        }
        GoalTaskCmd::Update {
            task_id,
            status,
            owner_session,
            clear_owner,
            scope,
            clear_scope,
            result_summary,
            clear_result,
        } => {
            let task = galley
                .update_goal_task(UpdateGoalTaskInput {
                    task_id: GoalTaskId(task_id),
                    status: status.map(Into::into),
                    owner_session_id: if clear_owner {
                        Some(None)
                    } else {
                        owner_session.map(|s| Some(SessionId(s)))
                    },
                    scope: if clear_scope {
                        Some(None)
                    } else {
                        scope.map(Some)
                    },
                    result_summary: if clear_result {
                        Some(None)
                    } else {
                        result_summary.map(Some)
                    },
                })
                .await?;
            emit_json(&task)?;
        }
        GoalTaskCmd::Complete {
            task_id,
            result_summary,
        } => {
            let task = galley
                .update_goal_task(UpdateGoalTaskInput {
                    task_id: GoalTaskId(task_id),
                    status: Some(GoalTaskStatus::Completed),
                    owner_session_id: None,
                    scope: None,
                    result_summary: result_summary.map(Some),
                })
                .await?;
            emit_json(&task)?;
        }
    }
    Ok(())
}

pub(crate) async fn goal_event(cmd: GoalEventCmd) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    match cmd {
        GoalEventCmd::Post {
            goal_id,
            event_type,
            body,
            task,
            author_session,
        } => {
            let event = galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: GoalId(goal_id),
                    task_id: task.map(GoalTaskId),
                    author_session_id: author_session.map(SessionId),
                    event_type: event_type.into(),
                    body,
                })
                .await?;
            emit_json(&event)?;
        }
    }
    Ok(())
}

pub(crate) async fn goal_deliverable(cmd: GoalDeliverableCmd) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    match cmd {
        GoalDeliverableCmd::Get { goal_id } => {
            let deliverable = galley.latest_goal_deliverable(GoalId(goal_id)).await?;
            // Empty stdout (exit 0) when no anchor exists yet — same
            // "absent is not an error" convention as `llm list`.
            if let Some(deliverable) = deliverable {
                emit_json(&deliverable)?;
            }
        }
        GoalDeliverableCmd::Set {
            goal_id,
            content,
            note,
            author_session,
        } => {
            let deliverable = galley
                .set_goal_deliverable(
                    GoalId(goal_id),
                    content,
                    note,
                    author_session.map(SessionId),
                )
                .await?;
            emit_json(&deliverable)?;
        }
    }
    Ok(())
}
