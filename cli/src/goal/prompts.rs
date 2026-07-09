use crate::goal::types::{
    GOAL_CHECK_REPORT_MARKER, GOAL_CONTROLLER_TASK_SCOPE_PREFIX, GOAL_WORKER_SESSION_ID_PLACEHOLDER,
};
use galley_core_lib::api::{
    GoalBrief, GoalStatusSnapshot, GoalTaskBrief, GoalTaskId, RuntimeKind, SessionId,
};

pub(crate) fn goal_latest_check_report(snapshot: &GoalStatusSnapshot) -> Option<String> {
    snapshot
        .events
        .iter()
        .rev()
        .find(|event| event.body.contains(GOAL_CHECK_REPORT_MARKER))
        .map(|event| {
            event
                .body
                .replacen(GOAL_CHECK_REPORT_MARKER, "", 1)
                .trim()
                .to_string()
        })
}

pub(crate) fn goal_master_planning_prompt(snapshot: &GoalStatusSnapshot, round: u32) -> String {
    let goal = &snapshot.goal;
    let memory_policy = goal_memory_policy_prompt(goal.runtime_kind);
    let master_duty = goal_master_duty_prompt(goal.runtime_kind);
    let workspace_block = goal_workspace_prompt_block(goal);
    let master_session_id = goal
        .master_session_id
        .as_ref()
        .map(SessionId::as_str)
        .unwrap_or("-");
    let anchor_summary = match snapshot.deliverable.as_ref() {
        Some(d) => format!(
            "- Current anchor: version {} ({} chars){}.",
            d.version,
            d.content.chars().count(),
            d.note
                .as_deref()
                .map(|n| format!(", last note: {n}"))
                .unwrap_or_default()
        ),
        None => {
            "- No deliverable anchor yet — this round should produce the first one.".to_string()
        }
    };
    let task_lines = if snapshot.tasks.is_empty() {
        "No tasks exist yet.".to_string()
    } else {
        snapshot
            .tasks
            .iter()
            .map(|task| {
                format!(
                    "- id={} status={:?} scope={} owner={} title={}",
                    task.id,
                    task.status,
                    task.scope.as_deref().unwrap_or("-"),
                    task.owner_session_id
                        .as_ref()
                        .map(SessionId::as_str)
                        .unwrap_or("-"),
                    task.title
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let event_lines = snapshot
        .events
        .iter()
        .rev()
        .take(12)
        .map(|event| {
            format!(
                "- {:?} author={} task={} body={}",
                event.event_type,
                event
                    .author_session_id
                    .as_ref()
                    .map(SessionId::as_str)
                    .unwrap_or("-"),
                event
                    .task_id
                    .as_ref()
                    .map(GoalTaskId::as_str)
                    .unwrap_or("-"),
                event.body.replace('\n', " ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let check_report_block = match goal_latest_check_report(snapshot) {
        Some(report) => format!(
            "Open issues to fix this round (from the latest check report — address P0 before P1):\n{report}"
        ),
        None => {
            "No check report yet. Early rounds: probe + produce the first anchor draft.".to_string()
        }
    };
    format!(
        r#"[Galley Goal Master Planner]

You are the hidden Master planner for a Galley Native Goal. You decompose, judge, and curate. You never claim or own a worker task — never pass --owner-session when creating tasks; workers own tasks (via claim) and produce candidate content. You DO produce the synthesized deliverable: fold accepted worker output into the anchor with `galley goal deliverable set`. "Not a production worker" means you never take on a single scoped task, not that you never write — synthesis is your job.

Goal id: {goal_id}
Master session: {master_session_id}
Objective: {objective}
Round: {round}
Max concurrent workers: {worker_limit}
Deadline: {deadline_at}

{master_duty}

{workspace_block}

Deliverable anchor (the single source of truth for the result):
{anchor_summary}
- Read the current anchor with: galley goal deliverable get {goal_id}
- Maintain ONE current-best deliverable. Each round, fold worker output that passes your review into a new version:
  galley goal deliverable set {goal_id} "<full updated deliverable>" --note "<what changed>" --author-session {master_session_id}
- Only replace the anchor when the result genuinely improves; if a change makes it worse, keep the current version (never lose ground). Workers produce candidates; you decide what merges.

Refinement loop (probe -> design -> execute -> check, repeat until budget):
- Probe/check rounds diverge: dispatch independent angles to different workers — user-view trial, attacker/edge cases, third-party review, and questioning the objective itself. Each check task must return reproducible evidence, not a "looks done" claim.
- After a check round, post ONE check report event listing issues ordered by harm (P0 then P1):
  galley goal event post {goal_id} --event-type system "{check_marker} P0: <blocking issues>; P1: <important-but-not-blocking>" --author-session {master_session_id}
- Design/execute rounds converge: read the latest check report and fix P0 first, then P1, folding accepted fixes into the next anchor version. Do not re-decide from scratch — fix by the list.

{check_report_block}

Rules:
1. First read state: galley goal status {goal_id} and galley goal deliverable get {goal_id}.
2. Create at most {worker_limit} open tasks for this round. Creating fewer is allowed.
3. Use only Galley CLI/Core writes: galley goal task|event|deliverable.
4. Do not call GA native /hive. Do not start agent_bbs.py. Do not write Goal state outside Galley Core.
{memory_policy}
5. Task scopes must be idempotent and slot-bound: goal-worker-N:master-round-{round}:short-kind, where N is 1..{worker_limit}.
6. Before creating a task, inspect existing task scopes and do not duplicate an existing scope.
7. Each task needs a concrete title, clear acceptance criteria in --description, one slot scope, and must drive a better anchor.
8. If a usable anchor already exists and budget remains, create validation, gap-fill, structure, or risk-check tasks that raise the next anchor version instead of declaring done early.
9. If Goal status is wrapping/completed/failed/stopped, stop without creating tasks.
10. End with a short hidden final answer: MASTER_PLAN_DONE round={round} tasks=<number_created>.

Current tasks:
{task_lines}

Recent events:
{event_lines}

Suggested CLI examples:
galley goal task create {goal_id} "Produce the deliverable's first complete draft" --description "Acceptance: ..." --scope "goal-worker-1:master-round-{round}:first-pass"
galley goal task create {goal_id} "Independent verification and gap check against the anchor" --description "Acceptance: ..." --scope "goal-worker-2:master-round-{round}:verify-gaps"
"#,
        goal_id = goal.id,
        master_session_id = master_session_id,
        objective = goal.objective,
        worker_limit = goal.worker_limit,
        deadline_at = goal.deadline_at,
        master_duty = master_duty,
        workspace_block = workspace_block,
        anchor_summary = anchor_summary,
        check_marker = GOAL_CHECK_REPORT_MARKER,
        check_report_block = check_report_block,
        memory_policy = memory_policy,
    )
}

fn goal_master_duty_prompt(runtime_kind: RuntimeKind) -> String {
    match runtime_kind {
        RuntimeKind::Managed => {
            // Managed GA has the Galley-seeded Hive master SOP in memory
            // (and may have self-evolved it), so point it at the file.
            r#"Master discipline:
- Read memory/goal_hive_master_duty.md and follow it. You are the design office: decompose, judge, aggregate. You never claim or own a worker task (workers own tasks via claim; never pass --owner-session when creating tasks); you DO produce the synthesized deliverable by folding accepted worker output into the anchor.
- Run rounds as probe -> design -> execute -> check: spread divergent work (probe/check) across parallel workers, converge yourself (design/execute selection).
- Keep a single "current best accepted version" as the anchor; each round make incremental changes on it; only merge a change when it raises quality, roll back if it gets worse.
- Drive toward a deliverable a critical reviewer can find no fault in within the budget; keep the core deliverable clean and separate from process notes."#
                .to_string()
        }
        RuntimeKind::External => {
            // Attached GA can't read the seeded memory file and Galley must
            // not write into the user's GA checkout (Rule 1). Point the
            // master at Galley's own materialized SOP copy (written by the
            // controller before planning). Mirrors managed "read a file",
            // just a Galley-owned path. Falls back to a short inline brief
            // only if the data dir can't be resolved.
            match galley_core_lib::goal_master_duty_sop_path() {
                Some(path) => format!(
                    "Master discipline — you are the Hive master (design office: decompose, judge, aggregate; never claim or own a worker task and never pass --owner-session when creating tasks — workers own tasks — but you DO produce the synthesized deliverable anchor). Read {} and follow it for the whole run.",
                    path.display()
                ),
                None => r#"Master discipline (you are the design office: decompose, judge, aggregate; never claim or own a worker task and never pass --owner-session when creating tasks — workers own tasks — but you DO produce the synthesized deliverable anchor):
- Run rounds as probe -> design -> execute -> check. Spread divergent work (probe/check) across parallel workers; converge yourself on design and selection.
- Keep a single "current best accepted version" as the anchor. Each round make incremental changes on it; only merge a change when it raises quality; roll back if it gets worse — never lose ground.
- Drive toward a deliverable a critical reviewer can find no fault in within the budget. Keep the core deliverable clean and separate from process notes."#
                    .to_string(),
            }
        }
    }
}

/// Shared file-workspace instruction injected into master + worker
/// prompts when the goal has a workspace path (P3). Empty string when
/// none, so callers can unconditionally interpolate it.
fn goal_workspace_prompt_block(goal: &GoalBrief) -> String {
    match goal.workspace_path.as_deref() {
        Some(path) => format!(
            r#"Shared file workspace: {path}
- This directory is shared by the master and all workers. For file/code deliverables, read and write files here (create it if it does not exist); coordinate who touches what via the task board to avoid clobbering.
- Keep the core deliverable at the top level; put scratch/intermediate files in subfolders so the final deliverable is easy to locate.
- Check tasks run/test artifacts here and return reproducible evidence (commands + output).
- For purely textual deliverables you may ignore the workspace and use the deliverable anchor instead."#
        ),
        None => String::new(),
    }
}

/// Relative listing of the goal workspace, or None when it is missing /
/// empty. Used at synthesis to decide file-vs-text delivery and to point
/// the master at the produced files.
pub(crate) fn goal_workspace_file_listing(goal: &GoalBrief) -> Option<String> {
    let path = goal.workspace_path.as_deref()?;
    let root = std::path::Path::new(path);
    let mut files: Vec<String> = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        // Only an unreadable root means "no workspace"; one unreadable
        // subdirectory (permissions, deleted mid-walk) must not discard
        // the files already found, or synthesis treats an existing file
        // deliverable as absent.
        let Ok(entries) = std::fs::read_dir(&dir) else {
            if dir.as_path() == root {
                return None;
            }
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(rel) = p.strip_prefix(root) {
                files.push(rel.to_string_lossy().into_owned());
                if files.len() >= 200 {
                    break;
                }
            }
        }
    }
    if files.is_empty() {
        return None;
    }
    files.sort();
    Some(files.join("\n"))
}

pub(crate) fn goal_memory_policy_prompt(runtime_kind: RuntimeKind) -> &'static str {
    match runtime_kind {
        RuntimeKind::Managed => {
            r#"Memory/SOP policy:
- Managed GA may use its normal memory/SOP self-evolution mechanism for durable, reusable learnings.
- Do not store Goal protocol state in memory/SOP: Goal ids, task ids, worker session ids, worker indexes, rounds/waves, temporary coordination logs, or transient task-board state.
- This does not permit modifying GenericAgent config, model config, credentials, or Galley Goal state."#
        }
        RuntimeKind::External => {
            r#"Memory/SOP policy:
- Attached external GA is user-owned; do not modify external GA memory, SOP, skills, config, temp state, or temp/goal_state.json.
- Do not store Goal protocol state in memory/SOP: Goal ids, task ids, worker session ids, worker indexes, rounds/waves, temporary coordination logs, or transient task-board state."#
        }
    }
}

pub(crate) fn goal_worker_prompt_template(
    goal: &GoalBrief,
    wave: u32,
    worker_index: u32,
    assigned_task: Option<&GoalTaskBrief>,
) -> String {
    let memory_policy = goal_memory_policy_prompt(goal.runtime_kind);
    let workspace_block = goal_workspace_prompt_block(goal);
    let assigned_task_block = assigned_task
        .map(goal_worker_assigned_task_block)
        .unwrap_or_else(|| {
            format!(
                "Assigned task:\n- Look for an open task whose scope starts with `{GOAL_CONTROLLER_TASK_SCOPE_PREFIX}{worker_index}:` and claim it first.\n"
            )
        });
    format!(
        r#"[Galley Goal Worker]

You are worker {worker_index} in wave {wave} of a Galley Goal/Hive run.

Goal id: {goal_id}
Project id: {project_id}
Your session id: {session_id_placeholder}
Objective:
{objective}

Budget: {budget_minutes} minutes total
Worker limit: {worker_limit}
Runtime: {runtime:?}
Write mode: {write_mode:?}

{assigned_task_block}

{workspace_block}

Budget semantics:
- The budget is a sustained work window, not an early-finish limit.
- While budget remains, do not treat the first useful result as the endpoint.
- Read Goal status and recent events before choosing work so you improve on prior waves instead of repeating them.
- If Goal status is wrapping, completed, failed, or stopped, stop immediately. Do not create tasks, post heartbeats, or ask the supervisor to stop you.

Protocol:
1. Read current state with: galley goal status {goal_id}
2. Use exactly the session id shown above for ownership and author attribution.
   Do not infer your session id from Project sessions, titles, Goal status, or other workers' events.
3. Claim your assigned task atomically before doing new work:
   galley goal task claim <task-id> --owner-session <your-session-id> --scope "<files/modules you expect to touch>"
4. Do not claim another worker slot's assigned task unless the Goal status clearly shows your own slot has no open/claimed/running task.
5. Post progress/conflict/result events:
   galley goal event post {goal_id} --event-type progress "<brief progress>" --author-session <your-session-id>
6. On completion, update the task with result and post a result event:
   galley goal task complete <task-id> --result-summary "<what you delivered>"
   galley goal event post {goal_id} --event-type result "<brief result>" --task <task-id> --author-session <your-session-id>
7. If you cannot complete the task, mark it blocked or cancelled with a short reason instead of continuing silently.
8. Internal temp paths are scratch. If the user asked to save a final artifact to an explicit path, save there and report that path; otherwise do not present internal temp paths as the deliverable.
9. Keep the deliverable clean: the deliverable (workspace files or your result content) contains only the deliverable itself — no meta like "this file is...", "needs verification", or process commentary. Put evidence, caveats, and process notes in your result event or a separate notes file, never inside the deliverable.
10. No echo: do not post pure acknowledgement or no-op events. Post only meaningful progress, results, conflicts, or blockers.

Autonomy:
- Coordinate through the Galley task board; do not call GenericAgent native /hive.
{memory_policy}
- Destructive, external-send, credential, payment, delete, commit, and push actions still require explicit confirmation.
"#,
        wave = wave,
        goal_id = goal.id,
        // Hive always has a project; "(none)" only on a data anomaly.
        project_id = goal
            .project_id
            .as_ref()
            .map(|project_id| project_id.0.as_str())
            .unwrap_or("(none)"),
        session_id_placeholder = GOAL_WORKER_SESSION_ID_PLACEHOLDER,
        objective = goal.objective,
        budget_minutes = goal.budget_seconds / 60,
        worker_limit = goal.worker_limit,
        runtime = goal.runtime_kind,
        write_mode = goal.write_mode,
        assigned_task_block = assigned_task_block,
        workspace_block = workspace_block,
        memory_policy = memory_policy,
    )
}

pub(crate) fn goal_worker_wake_prompt(
    goal: &GoalBrief,
    wave: u32,
    worker_index: u32,
    session_id: &SessionId,
    task: &GoalTaskBrief,
) -> String {
    let memory_policy = goal_memory_policy_prompt(goal.runtime_kind);
    let assigned_task_block = goal_worker_assigned_task_block(task);
    format!(
        r#"[Galley Goal Worker Task]

You are worker {worker_index} in wave {wave} of the same Galley Goal.

Goal id: {goal_id}
Your session id: {session_id}
Objective:
{objective}

Deadline: {deadline_at}

{assigned_task_block}

This is a task wake inside your existing worker session. Do not treat earlier useful results as the endpoint while budget remains.
If Goal status is wrapping, completed, failed, or stopped, stop immediately. Do not create tasks, post heartbeats, or ask the supervisor to stop you.

Next action:
1. Read current state with: galley goal status {goal_id}
2. Claim the assigned task if it is still open:
   galley goal task claim {task_id} --owner-session {session_id} --scope "{task_scope}"
3. Execute this task. If it is already claimed/running by your own session, continue it; if it is gone or terminal, inspect the task board and choose the closest task for this worker slot.
4. Post progress/result events with --author-session {session_id}, and complete or block your task when done. Galley will not wake this worker again until this session produces a terminal task/result signal.
5. Internal temp paths are scratch. If the user asked to save a final artifact to an explicit path, save there and report that path; otherwise do not present internal temp paths as the deliverable.

Keep coordinating through the Galley task board. Do not call GenericAgent native /hive.
{memory_policy}
"#,
        wave = wave,
        worker_index = worker_index,
        goal_id = goal.id,
        session_id = session_id,
        objective = goal.objective,
        deadline_at = goal.deadline_at,
        assigned_task_block = assigned_task_block,
        task_id = task.id,
        task_scope = task.scope.as_deref().unwrap_or(""),
        memory_policy = memory_policy,
    )
}

fn goal_worker_assigned_task_block(task: &GoalTaskBrief) -> String {
    format!(
        "Assigned task:\n- id: {task_id}\n- title: {title}\n- scope: {scope}\n- description: {description}\n",
        task_id = task.id,
        title = task.title,
        scope = task.scope.as_deref().unwrap_or(""),
        description = task.description.as_deref().unwrap_or("")
    )
}

pub(crate) fn goal_worker_protocol_reminder_prompt(
    goal: &GoalBrief,
    wave: u32,
    session_id: &SessionId,
) -> String {
    format!(
        r#"[Galley Goal Worker Checkpoint]

You are still in wave {wave} of the same Galley Goal.

Goal id: {goal_id}
Your session id: {session_id}

Before Galley can assign more work to this worker, leave a terminal signal for your current task.

Required action:
1. Read current state with: galley goal status {goal_id}
2. If Goal status is wrapping, completed, failed, or stopped, stop immediately. Do not post heartbeats.
3. If your task is done, run:
   galley goal task complete <task-id> --result-summary "<what you delivered>"
   galley goal event post {goal_id} --event-type result "<brief result>" --task <task-id> --author-session {session_id}
4. If you cannot finish, mark the task blocked or cancelled with a short reason.

Do not start a new task in this checkpoint.
"#,
        wave = wave,
        goal_id = goal.id,
        session_id = session_id,
    )
}
