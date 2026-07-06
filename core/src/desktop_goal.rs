//! Desktop Goal launch: the `start_desktop_goal` command (operator presses
//! Send on a desktop objective) plus the Galley-owned Hive master SOP
//! materialization the Goal controller reads. Extracted from `lib.rs`.
//! `goal_master_duty_sop_path` / `ensure_goal_master_duty_sop` are
//! re-exported at the crate root so the CLI's `galley_core_lib::…` paths
//! are unchanged; `start_desktop_goal` is registered as
//! `desktop_goal::start_desktop_goal` in the command handler.

use crate::api::{
    self, CreateGoalProposalInput, GalleyApi, GoalBrief, GoalLocale, GoalStatus, GoalWriteMode,
    MessageBrief, Origin, ProjectId, RuntimeKind, SessionId,
};
use crate::commands::stringify_error;
use crate::db::SqliteGalley;
use crate::{app_paths, discovery, process_command};
use serde::{Deserialize, Serialize};
use std::process::Stdio;

/// Galley's own copy of the Hive master SOP, embedded at compile time.
/// Managed GA reads its (self-evolvable) seeded memory copy; attach GA
/// can't read that and Galley must not seed the user's GA checkout
/// (Rule 1), so its master reads this Galley-owned materialized copy.
const GOAL_HIVE_MASTER_DUTY_SOP: &str =
    include_str!("../../managed-ga/state-seed/memory/goal_hive_master_duty.md");

/// Absolute path to Galley's materialized Hive master SOP copy. Pure
/// path computation (no filesystem touch) so prompt builders can embed
/// the read path without side effects.
pub fn goal_master_duty_sop_path() -> Option<std::path::PathBuf> {
    app_paths::goal_runtime_dir().map(|dir| dir.join("master_duty.md"))
}

/// Materialize Galley's embedded Hive master SOP to its data-dir copy
/// (idempotent overwrite, keeping it in sync with the binary). Returns
/// the path on success. Called by the Goal controller before attach-mode
/// master planning so the attach master has a Galley-owned file to read.
pub fn ensure_goal_master_duty_sop() -> Option<std::path::PathBuf> {
    let path = goal_master_duty_sop_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&path, GOAL_HIVE_MASTER_DUTY_SOP).ok()?;
    Some(path)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartDesktopGoalInput {
    objective: String,
    #[serde(default)]
    project_id: Option<ProjectId>,
    master_session_id: SessionId,
    #[serde(default)]
    runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    budget_seconds: Option<u32>,
    #[serde(default)]
    worker_limit: Option<u32>,
    /// Display name of the model the operator picked in the Composer at
    /// launch (case-insensitive). Best-effort applied to the master
    /// session's LLM so its bridge — and, via inheritance, the goal's
    /// worker sessions — run on the chosen model instead of the GA
    /// default. Resolution failure never blocks the launch.
    #[serde(default)]
    llm_name: Option<String>,
    /// Operator's resolved UI locale (`zh-CN` / `en-US`) at launch.
    /// Selects the language of the Galley-authored system narration the
    /// Core launch ack and the CLI controller persist into the master
    /// session, which Rust can't pull from GUI i18n. Omitted → Chinese
    /// (the surface's original behavior).
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartDesktopGoalResult {
    goal: GoalBrief,
    /// The user's objective, persisted as the master session's first
    /// user turn (the human's own words — no Galley framing).
    objective_message: MessageBrief,
    /// Galley's launch acknowledgement, persisted as a `system`
    /// narration turn right after the objective.
    master_message: MessageBrief,
}

#[tauri::command]
pub(crate) async fn start_desktop_goal(
    galley: tauri::State<'_, SqliteGalley>,
    input: StartDesktopGoalInput,
) -> std::result::Result<StartDesktopGoalResult, String> {
    let master_session_id = input.master_session_id.clone();
    let launch_llm_name = input.llm_name.clone();
    let locale = GoalLocale::parse(input.locale.as_deref());
    let proposal = galley
        .create_goal_proposal(
            CreateGoalProposalInput {
                objective: input.objective.clone(),
                project_id: input.project_id,
                master_session_id: Some(master_session_id.clone()),
                budget_seconds: input.budget_seconds,
                worker_limit: input.worker_limit,
                runtime_kind: input.runtime_kind.or(Some(RuntimeKind::Managed)),
                write_mode: Some(GoalWriteMode::Autonomous),
                expires_in_seconds: None,
            },
            Origin::gui(),
        )
        .await
        .map_err(stringify_error)?;
    let goal = galley
        .start_goal_from_proposal(proposal.id, proposal.internal_confirm_token, Origin::gui())
        .await
        .map_err(stringify_error)?;
    // Best-effort: apply the operator's chosen model to the master
    // session so its bridge — and, via inheritance, the goal's worker
    // sessions — run on it rather than the GA default. A resolution miss
    // (empty LLM cache / unknown name) must never block the launch.
    if let Some(name) = launch_llm_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        match crate::socket_listener::resolve_llm_selection_for_runtime(
            &galley,
            Some(name.to_string()),
            goal.runtime_kind,
        )
        .await
        {
            Ok(sel) => {
                if let Err(e) = galley
                    .set_session_llm(
                        master_session_id.clone(),
                        sel.index,
                        sel.key,
                        sel.display_name,
                    )
                    .await
                {
                    eprintln!("[goal] set master session llm failed: {e:?}");
                }
            }
            Err(e) => eprintln!("[goal] resolve launch llm '{name}' failed: {e:?}"),
        }
    }
    // The objective is the user's own words → a normal user turn.
    // Both launch rows carry the goal id so the GUI brackets the Goal
    // episode by exact id (objective-text matching stays only as the
    // fallback for pre-031 rows).
    let objective_message = galley
        .send_message_for_goal(
            master_session_id.clone(),
            input.objective.trim().to_string(),
            Origin::gui(),
            goal.id.clone(),
        )
        .await
        .map_err(stringify_error)?;
    // Galley's launch acknowledgement → system narration, so it reads
    // as Galley speaking, not the operator. Gives immediate feedback
    // before the first controller checkpoint lands and anchors the
    // "results return here" promise inside the session.
    let master_message = galley
        .send_system_message_for_goal(
            master_session_id,
            api::goal_launch_ack(locale).to_string(),
            Origin::gui(),
            goal.id.clone(),
        )
        .await
        .map_err(stringify_error)?;

    if let Err(message) =
        spawn_goal_controller(&goal, locale, "galley-desktop", "desktop Goal Send")
    {
        let _ = galley
            .update_goal_state(goal.id.clone(), GoalStatus::Failed, Some(message.clone()))
            .await;
        return Err(message);
    }

    Ok(StartDesktopGoalResult {
        goal,
        objective_message,
        master_message,
    })
}

/// Spawn a detached Goal controller (`galley goal run <id> --resume`). The
/// controller acquires a per-goal file lock on start, so a duplicate spawn
/// (e.g. startup auto-resume racing a manual resume) exits cleanly instead
/// of double-dispatching work.
pub(crate) fn spawn_goal_controller(
    goal: &GoalBrief,
    locale: GoalLocale,
    supervisor: &str,
    reason: &str,
) -> std::result::Result<(), String> {
    let cli = discovery::locate_cli_binary().ok_or_else(|| {
        "Galley CLI binary was not found next to the desktop app; cannot start Goal controller."
            .to_string()
    })?;
    let mut cmd = tokio::process::Command::new(cli);
    cmd.arg("goal")
        .arg("run")
        .arg(goal.id.as_str())
        .arg("--resume")
        .arg("--locale")
        .arg(locale.as_tag())
        .arg("--supervisor")
        .arg(supervisor)
        .arg("--reason")
        .arg(reason)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    process_command::configure_background(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start Galley Goal controller: {e}"))
}

/// Re-spawn controllers for goals left `running`/`wrapping` in the DB.
///
/// The controller is a detached process, so a Galley Core restart (crash,
/// quit, machine reboot) orphans it — without this, a dead Goal would sit
/// `running` in the DB forever and, under the single-active-Goal lock, block
/// every new Goal. Called once from the Core setup hook. The per-goal file
/// lock makes this safe even if a controller somehow survived: the duplicate
/// spawn just exits.
pub(crate) async fn resume_active_goals(galley: &SqliteGalley) {
    let goals = match galley.list_active_goals().await {
        Ok(goals) => goals,
        Err(e) => {
            eprintln!("[goal] startup resume: list active goals failed: {e:?}");
            return;
        }
    };
    for goal in goals {
        // No GUI locale at startup; narration falls back to the default.
        match spawn_goal_controller(
            &goal,
            GoalLocale::ZhCn,
            "galley-core",
            "startup auto-resume",
        ) {
            Ok(()) => eprintln!(
                "[goal] startup resume: respawned controller for {}",
                goal.id
            ),
            Err(message) => {
                eprintln!("[goal] startup resume: {} failed: {message}", goal.id);
            }
        }
    }
}
