//! Galley CLI — agent-first interface to Galley Core.
//!
//! B1 M4 ships six **read-only** commands that all open the local
//! SQLite database directly (no daemon yet; B4 introduces the
//! socket-backed transport per refactor invariant B1-I5).
//!
//! Output discipline:
//!   - Success → JSON on stdout. List-returning commands emit
//!     NDJSON (one object per line) so agents can stream-parse.
//!   - Error   → JSON on stdout matching `GalleyError`'s
//!     `{"error": "<category>", "message": "..."}` shape (B4 M6 freeze:
//!     `message` is flat at the top level, matching the socket
//!     transport envelope so SOPs parse one shape across both
//!     transports). **Errors go to stdout, not stderr** — agents read
//!     one stream. stderr is reserved for unrecoverable runtime panics.
//!   - Exit code maps `GalleyError` variants to fixed categories
//!     (see [`run`]) so SOPs can branch without parsing.

mod args;
mod common;
mod goal;
mod llm;
mod project;
mod session;
mod system;
mod transport;

use std::process::ExitCode;

use args::{Cli, Command, GoalCmd, LlmCmd, ProjectCmd, SessionCmd, SessionsCmd};
use clap::Parser;
use common::{exit_code_for, SCHEMA_VERSION};
use galley_core_lib::error::GalleyError;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    // §1.2 schema pin: if the caller pinned --schema=N, verify the binary
    // speaks that schema. v0.2 only knows SCHEMA_VERSION (1); future
    // multi-schema binaries widen this check to a set.
    if let Some(pinned) = cli.schema {
        if pinned != SCHEMA_VERSION {
            let err = GalleyError::InvalidArgs {
                message: format!(
                    "schema_mismatch: client requested schema {pinned}, server speaks {SCHEMA_VERSION}"
                ),
            };
            println!(
                "{}",
                serde_json::to_string(&err).expect("serialize GalleyError")
            );
            return ExitCode::from(exit_code_for(&err));
        }
    }
    match run(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            // Error → JSON on stdout (agents read one stream).
            let json = serde_json::to_string(&e).unwrap_or_else(|_| {
                let escaped = e.to_string().replace('\\', "\\\\").replace('"', "\\\"");
                format!("{{\"error\":\"internal\",\"message\":\"{escaped}\"}}")
            });
            println!("{json}");
            ExitCode::from(exit_code_for(&e))
        }
    }
}

async fn run(cli: Cli) -> Result<(), GalleyError> {
    match cli.command {
        Command::Sessions(SessionsCmd::List {
            runtime,
            project,
            status,
            archived,
            all,
        }) => session::sessions_list(runtime, project, status, archived, all).await,
        Command::Sessions(SessionsCmd::Search {
            runtime,
            query,
            all,
        }) => session::sessions_search(runtime, query, all).await,
        Command::Session(SessionCmd::Brief { id }) => session::session_brief(id).await,
        Command::Session(SessionCmd::Show { id, tail }) => session::session_show(id, tail).await,
        Command::Session(SessionCmd::Send {
            id,
            content,
            supervisor,
            reason,
        }) => session::session_send(id, content, supervisor, reason).await,
        Command::Session(SessionCmd::CopyToNative {
            id,
            supervisor,
            reason,
        }) => session::session_copy_to_native(id, supervisor, reason).await,
        Command::Session(SessionCmd::ApprovalResponse {
            id,
            approval_id,
            decision,
            supervisor,
            reason,
        }) => {
            session::session_approval_response(id, approval_id, decision, supervisor, reason).await
        }
        Command::Session(SessionCmd::Watch { id }) => session::session_watch(id).await,
        Command::Session(SessionCmd::Follow { id, tail }) => {
            session::session_follow(id, tail).await
        }
        Command::Session(SessionCmd::New {
            task,
            project,
            llm,
            runtime,
            supervisor,
            reason,
        }) => session::session_new(task, project, llm, runtime, supervisor, reason).await,
        Command::Session(SessionCmd::Btw {
            id,
            question,
            supervisor,
            reason,
        }) => session::session_btw(id, question, supervisor, reason).await,
        Command::Session(SessionCmd::Stop {
            id,
            supervisor,
            reason,
        }) => session::session_stop(id, supervisor, reason).await,
        Command::Session(SessionCmd::Archive {
            id,
            supervisor,
            reason,
        }) => session::session_archive(id, supervisor, reason).await,
        Command::Session(SessionCmd::Restore {
            id,
            supervisor,
            reason,
        }) => session::session_restore(id, supervisor, reason).await,
        Command::Session(SessionCmd::Move {
            id,
            to,
            supervisor,
            reason,
        }) => session::session_move(id, to, supervisor, reason).await,
        Command::Status => system::status().await,
        Command::Health => system::health().await,
        Command::Version => system::version().await,
        Command::Project(ProjectCmd::Create {
            name,
            root_path,
            icon,
            color,
            supervisor,
            reason,
        }) => project::project_create(name, root_path, icon, color, supervisor, reason).await,
        Command::Project(ProjectCmd::List) => project::project_list().await,
        Command::Project(ProjectCmd::Brief { project_id, all }) => {
            project::project_brief(project_id, all).await
        }
        Command::Project(ProjectCmd::Show {
            project_id,
            tail,
            all,
        }) => project::project_show(project_id, tail, all).await,
        Command::Project(ProjectCmd::Follow {
            project_id,
            tail,
            all,
            until_idle,
            final_show,
        }) => project::project_follow(project_id, tail, all, until_idle, final_show).await,
        Command::Project(ProjectCmd::Delete {
            project_id,
            supervisor,
            reason,
        }) => project::project_delete(project_id, supervisor, reason).await,
        Command::Goal(GoalCmd::Propose {
            objective,
            project,
            budget_minutes,
            workers,
            runtime,
            write_mode,
            expires_minutes,
            supervisor,
            reason,
        }) => {
            goal::goal_propose(
                objective,
                project,
                budget_minutes,
                workers,
                runtime,
                write_mode,
                expires_minutes,
                supervisor,
                reason,
            )
            .await
        }
        Command::Goal(GoalCmd::Morphling {
            target,
            objective,
            tests,
            strategy,
            output,
            project,
            budget_minutes,
            workers,
            write_mode,
            expires_minutes,
            supervisor,
            reason,
        }) => {
            goal::goal_morphling(
                target,
                objective,
                tests,
                strategy,
                output,
                project,
                budget_minutes,
                workers,
                write_mode,
                expires_minutes,
                supervisor,
                reason,
            )
            .await
        }
        Command::Goal(GoalCmd::Run {
            goal_id,
            proposal,
            confirm_token,
            resume,
            locale,
            supervisor,
            reason,
        }) => {
            goal::goal_run(
                goal_id,
                proposal,
                confirm_token,
                resume,
                locale,
                supervisor,
                reason,
            )
            .await
        }
        Command::Goal(GoalCmd::Status { goal_id }) => goal::goal_status(goal_id).await,
        Command::Goal(GoalCmd::Stop {
            goal_id,
            supervisor,
            reason,
        }) => goal::goal_stop(goal_id, supervisor, reason).await,
        Command::Goal(GoalCmd::Task(cmd)) => goal::goal_task(cmd).await,
        Command::Goal(GoalCmd::Event(cmd)) => goal::goal_event(cmd).await,
        Command::Goal(GoalCmd::Deliverable(cmd)) => goal::goal_deliverable(cmd).await,
        Command::Llm(LlmCmd::List) => llm::llm_list().await,
        Command::Llm(LlmCmd::Set {
            session_id,
            llm_name,
        }) => llm::llm_set(session_id, llm_name).await,
    }
}
