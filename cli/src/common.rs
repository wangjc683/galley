use crate::args::RuntimeArg;
use galley_core_lib::api::{Origin, RuntimeKind, SessionStatus};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use serde::Serialize;

// Single source of truth for the wire schema version — the CLI speaks
// exactly what `galley_core_lib::protocol` defines.
pub(crate) use galley_core_lib::protocol::SCHEMA_VERSION;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamEndPayload<'a> {
    pub(crate) schema_version: u32,
    pub(crate) stream: &'static str,
    pub(crate) reason: &'a str,
}

/// Map `GalleyError` variants to stable exit code categories. SOPs can
/// branch on these without parsing the error JSON.
pub(crate) fn exit_code_for(e: &GalleyError) -> u8 {
    match e {
        GalleyError::NotFound { .. } => 3,
        GalleyError::InvalidArgs { .. } => 2,
        GalleyError::DbUnavailable { .. } => 4,
        GalleyError::RunnerError { .. } => 5,
        GalleyError::Internal { .. } => 1,
    }
}

pub(crate) fn parse_status_arg(s: &str) -> Result<SessionStatus, GalleyError> {
    Ok(match s {
        "idle" => SessionStatus::Idle,
        "connecting" => SessionStatus::Connecting,
        "running" => SessionStatus::Running,
        "waiting_approval" => SessionStatus::WaitingApproval,
        "error" => SessionStatus::Error,
        "completed" => SessionStatus::Completed,
        "cancelled" => SessionStatus::Cancelled,
        "archived" => SessionStatus::Archived,
        other => {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "unknown --status `{other}`. Allowed: idle, connecting, running, \
                     waiting_approval, error, completed, cancelled, archived"
                ),
            })
        }
    })
}

pub(crate) async fn runtime_filter(
    galley: &SqliteGalley,
    runtime: RuntimeArg,
) -> Result<Option<RuntimeKind>, GalleyError> {
    Ok(match runtime {
        RuntimeArg::Current => Some(galley.active_runtime_kind().await?),
        RuntimeArg::Managed => Some(RuntimeKind::Managed),
        RuntimeArg::External => Some(RuntimeKind::External),
        RuntimeArg::All => None,
    })
}

pub(crate) fn runtime_arg_for_session_new(
    runtime: RuntimeArg,
) -> Result<Option<RuntimeKind>, GalleyError> {
    match runtime {
        RuntimeArg::Current => Ok(None),
        RuntimeArg::Managed => Ok(Some(RuntimeKind::Managed)),
        RuntimeArg::External => Ok(Some(RuntimeKind::External)),
        RuntimeArg::All => Err(GalleyError::InvalidArgs {
            message: "session new: --runtime all is only valid for list commands".into(),
        }),
    }
}

pub(crate) async fn runtime_kind_for_goal(
    galley: &SqliteGalley,
    runtime: RuntimeArg,
) -> Result<RuntimeKind, GalleyError> {
    match runtime {
        RuntimeArg::Current => galley.active_runtime_kind().await,
        RuntimeArg::Managed => Ok(RuntimeKind::Managed),
        RuntimeArg::External => Ok(RuntimeKind::External),
        RuntimeArg::All => Err(GalleyError::InvalidArgs {
            message: "goal: --runtime all is not valid".into(),
        }),
    }
}

pub(crate) fn cli_origin(supervisor: Option<String>, reason: Option<String>) -> Origin {
    Origin::cli(supervisor, reason)
}

pub(crate) fn emit_json<T: serde::Serialize>(value: &T) -> Result<(), GalleyError> {
    let s = serde_json::to_string(value).map_err(|e| GalleyError::Internal {
        message: format!("serialize output: {e}"),
    })?;
    println!("{s}");
    Ok(())
}

pub(crate) fn runtime_arg_from_kind(kind: RuntimeKind) -> RuntimeArg {
    match kind {
        RuntimeKind::Managed => RuntimeArg::Managed,
        RuntimeKind::External => RuntimeArg::External,
    }
}

pub(crate) fn is_live_candidate(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Connecting | SessionStatus::Running | SessionStatus::WaitingApproval
    )
}
