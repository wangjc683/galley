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
    emit_line(&s);
    Ok(())
}

/// Write one protocol line to stdout. The only stdout writer in the
/// binary: `println!` panics on a closed pipe, and agents routinely do
/// `galley sessions list | head`, which closed stdout after the first
/// lines and left a Rust panic trace on stderr. A broken pipe means the
/// reader has everything it wanted — exit 0 silently.
pub(crate) fn emit_line(line: &str) {
    use std::io::Write;
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let result = out
        .write_all(line.as_bytes())
        .and_then(|_| out.write_all(b"\n"))
        .and_then(|_| out.flush());
    if let Err(e) = result {
        if e.kind() == std::io::ErrorKind::BrokenPipe {
            std::process::exit(0);
        }
        // Any other stdout failure is unrecoverable for a protocol
        // writer; surface it the way println! would have.
        panic!("failed printing to stdout: {e}");
    }
}

/// Best-effort live run-state probe against Galley Core
/// (`sessions.run_state`). Read commands stay direct-SQLite; this adds the
/// one thing SQLite cannot know — whether a run is open right now — as
/// the additive `live` field. `None` when Core is unreachable or slow to
/// answer: the caller omits `live` and the persisted answer stands.
///
/// `ids = None` asks for every session Core holds state for (`status`);
/// `Some(ids)` scopes to a listing page (`sessions list` / `session brief`).
pub(crate) async fn probe_live_states(
    ids: Option<Vec<String>>,
) -> Option<std::collections::HashMap<String, serde_json::Value>> {
    use galley_core_lib::protocol::SessionsRunStateArgs;
    const LIVE_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
    let call = crate::client::call_value(SessionsRunStateArgs { session_ids: ids });
    let result = tokio::time::timeout(LIVE_PROBE_TIMEOUT, call)
        .await
        .ok()?
        .ok()?;
    let sessions = result.get("sessions")?.as_array()?;
    Some(
        sessions
            .iter()
            .filter_map(|entry| {
                let id = entry.get("sessionId")?.as_str()?.to_string();
                let mut live = entry.clone();
                live.as_object_mut()?.remove("sessionId");
                Some((id, live))
            })
            .collect(),
    )
}

/// Serialize a row and, when the probe answered, attach its `live`
/// object. A probed session Core has no state for still gets an explicit
/// idle `live` (every field false / 0), so absence of the key always
/// means "Core unreachable", never "not running".
pub(crate) fn with_live<T: serde::Serialize>(
    row: &T,
    live: Option<&serde_json::Value>,
) -> Result<serde_json::Value, GalleyError> {
    let mut value = serde_json::to_value(row).map_err(|e| GalleyError::Internal {
        message: format!("serialize output: {e}"),
    })?;
    if let (Some(live), Some(obj)) = (live, value.as_object_mut()) {
        obj.insert("live".to_string(), live.clone());
    }
    Ok(value)
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
