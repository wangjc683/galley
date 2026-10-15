//! Galley CLI — agent-first interface to Galley Core.
//!
//! Read commands open the local SQLite database directly; write and
//! streaming commands talk to Galley Core over the per-user local socket.
//! Three read commands (`sessions list`, `session brief`, `status`) also
//! make one best-effort socket probe for the additive `live` field.
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
mod client;
mod common;
mod llm;
mod project;
mod session;
mod system;
mod transport;

use std::process::ExitCode;

use args::{Cli, Command, LlmCmd, ProjectCmd, SessionCmd, SessionsCmd};
use clap::Parser;
use common::{emit_line, exit_code_for, ACCEPTED_SCHEMA_VERSIONS, SCHEMA_VERSION};
use galley_core_lib::error::GalleyError;

#[tokio::main]
async fn main() -> ExitCode {
    // try_parse instead of parse: clap's default error path prints
    // human-readable text to STDERR, which violates the "errors are
    // JSON on stdout" contract above — an SOP parsing stdout saw
    // nothing at all on a typo'd flag. Help/version keep their human
    // output (they're requested, not errors).
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => {
            use clap::error::ErrorKind;
            if matches!(
                err.kind(),
                ErrorKind::DisplayHelp
                    | ErrorKind::DisplayVersion
                    | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
            ) {
                let _ = err.print();
                return ExitCode::SUCCESS;
            }
            let invalid = GalleyError::InvalidArgs {
                message: err.to_string(),
            };
            emit_line(&serde_json::to_string(&invalid).expect("serialize GalleyError"));
            return ExitCode::from(exit_code_for(&invalid));
        }
    };
    // §1.2 schema pin: if the caller pinned --schema=N, verify this binary
    // answers that schema. Every accepted version still answers every
    // command that survived unchanged (stability §1). Mismatch exits 2
    // (`invalid_args`) with the stable `schema_mismatch:` prefix.
    if let Some(pinned) = cli.schema {
        if !ACCEPTED_SCHEMA_VERSIONS.contains(&pinned) {
            let err = GalleyError::InvalidArgs {
                message: format!(
                    "schema_mismatch: client requested schema {pinned}, server speaks {SCHEMA_VERSION} (accepts {ACCEPTED_SCHEMA_VERSIONS:?})"
                ),
            };
            emit_line(&serde_json::to_string(&err).expect("serialize GalleyError"));
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
            emit_line(&json);
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
            session,
        }) => session::sessions_search(runtime, query, all, session).await,
        Command::Session(SessionCmd::Brief { id }) => session::session_brief(id).await,
        Command::Session(SessionCmd::Show {
            id,
            tail,
            around,
            context,
            since,
            until,
        }) => session::session_show(id, tail, around, context, since, until).await,
        Command::Session(SessionCmd::Send {
            id,
            content,
            supervisor,
            reason,
            jump,
            ensure_runner,
        }) => session::session_send(id, content, supervisor, reason, jump, ensure_runner).await,
        Command::Session(SessionCmd::Watch { id }) => session::session_watch(id).await,
        Command::Session(SessionCmd::Follow { id, tail }) => {
            session::session_follow(id, tail).await
        }
        Command::Session(SessionCmd::Wait {
            id,
            timeout,
            poll,
            tail,
            final_show,
            after_turn,
            until_idle,
        }) => {
            session::session_wait(id, timeout, poll, tail, final_show, after_turn, until_idle).await
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
            enable_workspace,
            icon,
            color,
            supervisor,
            reason,
        }) => {
            project::project_create(
                name,
                root_path,
                enable_workspace,
                icon,
                color,
                supervisor,
                reason,
            )
            .await
        }
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
        }) => project::project_follow(project_id, tail, all, until_idle, final_show, None).await,
        Command::Project(ProjectCmd::Delete {
            project_id,
            supervisor,
            reason,
        }) => project::project_delete(project_id, supervisor, reason).await,
        Command::Llm(LlmCmd::List { runtime }) => llm::llm_list(runtime).await,
        Command::Llm(LlmCmd::Set {
            session_id,
            llm_name,
        }) => llm::llm_set(session_id, llm_name).await,
    }
}
