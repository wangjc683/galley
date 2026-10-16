//! The remaining hands (main chat ticket 35): what the desktop can do to
//! sessions, projects and the default model that the CLI could not —
//! `session rename / pin / unpin / delete`, `project update / pin / unpin
//! / archive-sessions`, `llm set-default`. All writes, so all go through
//! Galley Core's socket, which runs the desktop's own Core functions,
//! records the origin and broadcasts.

use crate::client::call_print;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    LlmSetDefaultArgs, ProjectArchiveSessionsArgs, ProjectPinArgs, ProjectUnpinArgs,
    ProjectUpdateArgs, SessionDeleteArgs, SessionPinArgs, SessionRenameArgs, SessionUnpinArgs,
};

pub(crate) async fn session_rename(
    id: String,
    title: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionRenameArgs {
        session_id: id,
        title,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_pin(
    id: String,
    pinned: bool,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    if pinned {
        call_print(SessionPinArgs {
            session_id: id,
            supervisor,
            reason,
        })
        .await
    } else {
        call_print(SessionUnpinArgs {
            session_id: id,
            supervisor,
            reason,
        })
        .await
    }
}

pub(crate) async fn session_delete(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionDeleteArgs {
        session_id: id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn project_update(args: ProjectUpdateArgs) -> Result<(), GalleyError> {
    call_print(args).await
}

pub(crate) async fn project_pin(
    project_id: String,
    pinned: bool,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    if pinned {
        call_print(ProjectPinArgs {
            project_id,
            supervisor,
            reason,
        })
        .await
    } else {
        call_print(ProjectUnpinArgs {
            project_id,
            supervisor,
            reason,
        })
        .await
    }
}

pub(crate) async fn project_archive_sessions(
    project_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(ProjectArchiveSessionsArgs {
        project_id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn llm_set_default(
    llm_name: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(LlmSetDefaultArgs {
        llm_name,
        supervisor,
        reason,
    })
    .await
}
