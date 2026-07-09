//! Shared Goal wrap-up: the synthesis dispatch, its timeout policy, the
//! strict-newer final-answer wait, and the timeout fallbacks. Both engines
//! end here — hive after its wave loop, solo after budget exhaustion.

use std::time::{Duration, Instant};

use crate::common::{emit_json, is_live_candidate, SCHEMA_VERSION};
use crate::goal::prompts::goal_workspace_file_listing;
use crate::goal::signals::{goal_has_stop_wrap_up_material, goal_worker_session_ids};
use crate::goal::types::*;
use crate::session::{session_goal_synthesize_value, session_shutdown_runner_value};
use galley_core_lib::api::{
    goal_finished_no_master, goal_solo_wrap_timeout, goal_stopped_before_results,
    goal_synthesizing, CreateGoalEventInput, GalleyApi, GoalEventType, GoalMode, GoalStatus,
    GoalStatusSnapshot, MessageBrief, MessageRole, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;

use super::controller::{compact_text, first_non_empty_line, goal_narration_locale, push_limited};
use super::hive::shutdown_goal_worker_runners;

/// Synthesis wait budget scales with the dispatched prompt size: a
/// deliverable anchor can legitimately be 300k chars, and a flat 300s
/// cannot cover generating a final answer over it. 300s base + 1s per
/// 1k chars, capped at 900s (the drain-cap ceiling).
pub(crate) fn goal_synthesis_timeout(dispatch_chars: usize) -> Duration {
    let extra_seconds = (dispatch_chars / 1_000) as u64;
    Duration::from_secs((300 + extra_seconds).min(900))
}

/// Mode-aware synthesis wait: the normal wrap scales with prompt size;
/// the stop wrap-up is additionally capped at
/// [`GOAL_STOP_SYNTHESIS_TIMEOUT_SECONDS`] — the user asked to stop.
///
/// A solo normal wrap is further capped at half the goal's budget
/// (floored at 120s): the 300–900s base can exceed a short budget
/// outright, and solo's promise is "the budget ends, you get the current
/// best" — total wall clock stays predictable (~budget × 1.5 worst case).
pub(crate) fn goal_finish_synthesis_timeout(
    mode: GoalFinishMode,
    dispatch_chars: usize,
    engine: GoalMode,
    budget_seconds: u32,
) -> Duration {
    let base = goal_synthesis_timeout(dispatch_chars);
    match mode {
        GoalFinishMode::Normal => match engine {
            GoalMode::Solo => {
                let budget_cap = u64::from(budget_seconds / 2).max(120);
                base.min(Duration::from_secs(budget_cap))
            }
            GoalMode::Hive => base,
        },
        GoalFinishMode::StopWrapUp => {
            base.min(Duration::from_secs(GOAL_STOP_SYNTHESIS_TIMEOUT_SECONDS))
        }
    }
}

/// `Ok(None)` = timed out — the master may still be generating; the
/// caller decides what that means (it is NOT a goal failure).
///
/// `after_agent_turn` is the newest agent turn_index that existed BEFORE
/// the synthesis dispatch; only a strictly newer reply counts (same
/// anti-race shape as `wait_solo_turn`).
async fn wait_master_final_answer(
    galley: &SqliteGalley,
    session_id: &SessionId,
    after_agent_turn: Option<u32>,
    timeout: Duration,
) -> Result<Option<MessageBrief>, GalleyError> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        let session = galley.session_brief(session_id.clone()).await?;
        let messages = galley
            .session_messages(session_id.clone(), Some(12))
            .await?;
        if let Some(message) = master_final_answer_after(&messages, after_agent_turn) {
            if !is_live_candidate(session.status) {
                return Ok(Some(message));
            }
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    Ok(None)
}

/// The newest agent reply that (a) landed STRICTLY after `after_agent_turn`
/// and (b) carries a non-empty final answer — i.e. the synthesis wrap-up,
/// never a pre-dispatch working turn. The old check compared turn_index
/// against `session.turn_count` (a different counter) with `>=`, so a
/// working turn that landed a second before dispatch passed for the
/// wrap-up (2026-07-09 solo dogfood). Pure so the anti-race logic is
/// unit-testable without a live bridge.
pub(crate) fn master_final_answer_after(
    messages: &[MessageBrief],
    after_agent_turn: Option<u32>,
) -> Option<MessageBrief> {
    messages
        .iter()
        .rev()
        .find(|message| {
            message.role == MessageRole::Agent
                && after_agent_turn.is_none_or(|after| message.turn_index.unwrap_or(0) > after)
                && message
                    .final_answer
                    .as_deref()
                    .is_some_and(|answer| !answer.trim().is_empty())
        })
        .cloned()
}

/// The newest turn_index among the session's Agent messages (`None` if the
/// agent hasn't replied yet). Captured before dispatching a solo turn so
/// `wait_solo_turn` recognizes only the reply that dispatch produces.
pub(super) async fn latest_agent_turn_index(
    galley: &SqliteGalley,
    session_id: &SessionId,
) -> Result<Option<u32>, GalleyError> {
    // Read the internal-inclusive view so the completion check never depends
    // on turn visibility policy (working turns are visible today, but the
    // nudge rows sharing the session are internal).
    let messages = galley
        .session_messages_including_internal(session_id.clone(), Some(30))
        .await?;
    Ok(messages
        .iter()
        .filter(|message| message.role == MessageRole::Agent)
        .filter_map(|message| message.turn_index)
        .max())
}

pub(super) async fn finish_goal_with_master(
    galley: &SqliteGalley,
    snapshot: GoalStatusSnapshot,
    worker_session_ids: &[SessionId],
    supervisor: Option<String>,
    reason: Option<String>,
    mode: GoalFinishMode,
) -> Result<(), GalleyError> {
    let goal = snapshot.goal.clone();
    // Terminal state is decided by why we're finishing, not by whether
    // synthesis succeeds: a stop wrap-up that produced a fine summary is
    // still a *stopped* goal, never a completed one.
    let terminal_status = match mode {
        GoalFinishMode::Normal => GoalStatus::Completed,
        GoalFinishMode::StopWrapUp => GoalStatus::Stopped,
    };
    shutdown_goal_worker_runners(
        galley,
        &snapshot,
        worker_session_ids,
        supervisor.clone(),
        reason
            .clone()
            .or_else(|| Some(format!("goal {} entering master synthesis", goal.id))),
    )
    .await;
    // A stop with nothing to account for (no worker material, no result,
    // an empty task board) keeps the historical instant-stop behavior —
    // dispatching a wrap-up turn over nothing would only delay the stop.
    if mode == GoalFinishMode::StopWrapUp && !goal_has_stop_wrap_up_material(&snapshot) {
        let summary = goal_stopped_before_results(goal_narration_locale()).to_string();
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
    let Some(master_session_id) = goal.master_session_id.clone() else {
        let summary = goal.latest_summary.clone().unwrap_or_else(|| {
            goal_finished_no_master(goal_narration_locale(), mode == GoalFinishMode::StopWrapUp)
                .to_string()
        });
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
            .update_goal_state(goal.id.clone(), terminal_status, Some(summary))
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

    // Baseline BEFORE dispatching synthesis: only an agent reply strictly
    // newer than this counts as the wrap-up answer (see
    // `master_final_answer_after` for the dogfood incident this fixes).
    let before_agent_turn = latest_agent_turn_index(galley, &master_session_id).await?;
    let dispatch_content =
        build_goal_synthesis_prompt(galley, &snapshot, worker_session_ids, mode).await?;
    let synthesis_timeout = goal_finish_synthesis_timeout(
        mode,
        dispatch_content.chars().count(),
        goal.mode,
        goal.budget_seconds,
    );
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
    let Some(final_answer_message) = wait_master_final_answer(
        galley,
        &master_session_id,
        before_agent_turn,
        synthesis_timeout,
    )
    .await?
    else {
        // Timed out — engine + mode decide what that means.
        if goal.mode == GoalMode::Solo {
            // Solo's promise is "the budget ends, you get the current
            // best". Deliver the newest agent output as the best-effort
            // result, land the terminal state, and shut the runner down —
            // otherwise the wrap-up turn grinds on unbounded (the
            // 2026-07-09 dogfood ran 8 extra minutes past a 5-minute
            // budget). No Wrapping+resume dead end: desktop users have no
            // CLI resume entry point.
            let messages = galley
                .session_messages_including_internal(master_session_id.clone(), Some(12))
                .await?;
            let best_effort = messages
                .iter()
                .rev()
                .find(|message| message.role == MessageRole::Agent)
                .and_then(|message| {
                    message
                        .final_answer
                        .as_deref()
                        .and_then(first_non_empty_line)
                        .or_else(|| first_non_empty_line(&message.content))
                        .or_else(|| message.summary.as_deref().and_then(first_non_empty_line))
                });
            let note =
                goal_solo_wrap_timeout(goal_narration_locale(), mode == GoalFinishMode::StopWrapUp);
            let summary = best_effort.unwrap_or_else(|| note.to_string());
            let _ = galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: goal.id.clone(),
                    task_id: None,
                    author_session_id: Some(master_session_id.clone()),
                    event_type: GoalEventType::Synthesis,
                    body: note.to_string(),
                })
                .await;
            let final_goal = galley
                .update_goal_state(goal.id.clone(), terminal_status, Some(summary))
                .await?;
            if let Err(err) = session_shutdown_runner_value(
                master_session_id.0.clone(),
                supervisor.clone(),
                Some(format!("goal {} wrap-up timeout runner cleanup", goal.id)),
            )
            .await
            {
                let _ = galley
                    .create_goal_event(CreateGoalEventInput {
                        goal_id: goal.id.clone(),
                        task_id: None,
                        author_session_id: None,
                        event_type: GoalEventType::System,
                        body: format!("Solo runner shutdown after wrap-up timeout failed: {err}"),
                    })
                    .await;
            }
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "finished",
                goal: &final_goal,
                session_id: Some(master_session_id.0),
                note: Some(note.to_string()),
            })?;
            return Ok(());
        }
        if mode == GoalFinishMode::StopWrapUp {
            // The user asked to stop; keeping the goal Wrapping until a
            // resume would mean "stop" never terminates. Stop now,
            // pointing at the master session where a late wrap-up may
            // still land.
            let summary = format!(
                "Goal stopped; the wrap-up summary exceeded {}s — a late summary may still appear in master session {}.",
                synthesis_timeout.as_secs(),
                master_session_id
            );
            let _ = galley
                .create_goal_event(CreateGoalEventInput {
                    goal_id: goal.id.clone(),
                    task_id: None,
                    author_session_id: Some(master_session_id.clone()),
                    event_type: GoalEventType::Synthesis,
                    body: summary.clone(),
                })
                .await;
            let final_goal = galley
                .update_goal_state(goal.id.clone(), GoalStatus::Stopped, Some(summary.clone()))
                .await?;
            emit_json(&GoalRunFrame {
                schema_version: SCHEMA_VERSION,
                stream: "goal",
                phase: "finished",
                goal: &final_goal,
                session_id: Some(master_session_id.0),
                note: Some(summary),
            })?;
            return Ok(());
        }
        // Normal wrap: the master may STILL be generating the answer.
        // Failing the goal here threw away a successful run over a slow
        // final turn (and stamped it with a stale pre-run status). Keep
        // it Wrapping and point the user at the master session; `goal
        // run <id> --resume` retries synthesis.
        let summary = format!(
            "Master synthesis exceeded {}s; check master session {} — the final answer may still arrive there. Resume with `galley goal run {} --resume`.",
            synthesis_timeout.as_secs(),
            master_session_id,
            goal.id
        );
        let _ = galley
            .create_goal_event(CreateGoalEventInput {
                goal_id: goal.id.clone(),
                task_id: None,
                author_session_id: Some(master_session_id.clone()),
                event_type: GoalEventType::Synthesis,
                body: summary.clone(),
            })
            .await;
        let wrapping_goal = galley
            .update_goal_state(goal.id.clone(), GoalStatus::Wrapping, Some(summary.clone()))
            .await?;
        emit_json(&GoalRunFrame {
            schema_version: SCHEMA_VERSION,
            stream: "goal",
            phase: "synthesis_timeout",
            goal: &wrapping_goal,
            session_id: Some(master_session_id.0),
            note: Some(summary),
        })?;
        return Ok(());
    };

    let summary = final_answer_message
        .final_answer
        .as_deref()
        .and_then(first_non_empty_line)
        .or_else(|| first_non_empty_line(&final_answer_message.content))
        .or_else(|| final_answer_message.summary.clone())
        .unwrap_or_else(|| match mode {
            GoalFinishMode::Normal => {
                "Goal completed and master synthesis was delivered.".to_string()
            }
            GoalFinishMode::StopWrapUp => {
                "Goal stopped and a wrap-up summary was delivered.".to_string()
            }
        });

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
        .update_goal_state(goal.id.clone(), terminal_status, Some(summary))
        .await?;
    let completed_snapshot = galley.goal_status_full(final_goal.id.clone()).await?;
    shutdown_goal_worker_runners(
        galley,
        &completed_snapshot,
        worker_session_ids,
        supervisor.clone(),
        Some(format!("goal {} completed worker cleanup", final_goal.id)),
    )
    .await;
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
    mode: GoalFinishMode,
) -> Result<String, GalleyError> {
    let goal = &snapshot.goal;
    let fallback_worker_ids = goal_worker_session_ids(snapshot, worker_session_ids);
    let worker_ids = fallback_worker_ids.as_slice();
    // Stop wrap-up trims the prompt everywhere: fewer worker messages
    // and no full-anchor allowance — the user asked to stop, so the
    // master owes a brief accounting, not an anchor-polishing pass.
    let worker_message_tail = match mode {
        GoalFinishMode::Normal => Some(6),
        GoalFinishMode::StopWrapUp => Some(3),
    };
    let anchor_char_limit = match mode {
        // Allow the anchor itself to be large; it is the payload.
        GoalFinishMode::Normal => 300_000,
        // push_limited caps are cumulative: a lower anchor cap here keeps
        // room under the later 28k caps for the task board, which is the
        // part a stop accounting actually needs.
        GoalFinishMode::StopWrapUp => 12_000,
    };
    let mut out = String::new();
    // Agent-facing context line; a project-less solo goal renders "(none)".
    let project_id_note = goal
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .unwrap_or("(none)");
    // Solo goals have no workers/master framing — the one agent that ran the
    // objective is being asked for its own final answer. Give it a clean
    // prompt that doesn't reference a hive it never had.
    if goal.mode == GoalMode::Solo && mode == GoalFinishMode::Normal {
        push_limited(
            &mut out,
            &format!(
                "[Galley Goal — final answer]\n\nThe time budget for this Goal is over. This is a TERMINATION instruction, not another improvement loop: every earlier \"keep going\" instruction is now void. Do NOT probe for gaps, do NOT expand or self-check, do NOT start new work; use a tool only if you must re-read your current best result. In this single turn, write out the complete final answer to the user, directly and in their language. Do not expose Goal ids, command logs, or internal process notes.\n\nObjective:\n{}\n\nProduce a concise final answer with: conclusion, key evidence, important gaps or caveats, and next actions. Internal temp paths are scratch; only report a file path as the deliverable when the user explicitly asked Galley to save there.\n\nGoal status: {:?}\nProject id: {}\n\n",
                goal.objective, goal.status, project_id_note
            ),
            28_000,
        );
    }
    match mode {
        GoalFinishMode::Normal if goal.mode == GoalMode::Solo => {}
        GoalFinishMode::Normal => push_limited(
            &mut out,
            &format!(
                "[Galley Goal Master Synthesis]\n\nYou are the master session for this Galley Goal. Answer the user directly in their language. Do not expose worker protocol, Goal ids, command logs, or internal coordination unless it materially helps the user.\n\nObjective:\n{}\n\nProduce a concise final answer with: conclusion, key evidence, important gaps or caveats, and next actions. Internal temp paths are scratch; only report a file path as the deliverable when the user explicitly asked Galley to save there.\n\nGoal status: {:?}\nProject id: {}\n\n",
                goal.objective,
                goal.status,
                project_id_note
            ),
            28_000,
        ),
        GoalFinishMode::StopWrapUp => push_limited(
            &mut out,
            &format!(
                "[Galley Goal Stop Wrap-Up]\n\nYou are the master session for this Galley Goal. The user asked to STOP the goal early. Answer the user directly in their language, in a few sentences: what was completed, what remains unfinished, and where any partial results live. Do not start new work, do not expose worker protocol, Goal ids, command logs, or internal coordination.\n\nObjective:\n{}\n\nGoal status: {:?}\nProject id: {}\n\n",
                goal.objective,
                goal.status,
                project_id_note
            ),
            28_000,
        ),
    }

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
            anchor_char_limit,
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

    // Solo has no worker sessions to summarize; the agent's own conversation
    // is the source, so skip this block entirely for it.
    if goal.mode != GoalMode::Solo {
        push_limited(&mut out, "Worker session latest output:\n", 28_000);
        for session_id in worker_ids {
            let messages = galley
                .session_messages(session_id.clone(), worker_message_tail)
                .await?;
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
    }
    Ok(out)
}
