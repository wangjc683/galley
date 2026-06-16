use super::*;

// ---------------- shared dispatch helpers (B4 M1) ----------------

/// Build an [`Origin`] from the supervisor + reason flags that every
/// write socket command accepts. `via` flips to `Supervisor` when a
/// supervisor label is present; otherwise `Cli`. Used by all B4 M1
/// write handlers (`session.new` / `session.btw` / `session.stop` /
/// `session.archive` / `session.restore` / `session.move` /
/// `project.create` / `project.delete`) so the rule lives in one place.
pub(super) fn origin_from_args(supervisor: Option<String>, reason: Option<String>) -> Origin {
    Origin {
        via: if supervisor.is_some() {
            OriginVia::Supervisor
        } else {
            OriginVia::Cli
        },
        supervisor,
        reason,
    }
}

/// Map a [`GalleyError`] onto the wire `SocketResponse` envelope.
/// Each variant gets its own stable `error` discriminant string so
/// `cli/src/main.rs::map_error_tag` can round-trip back to a typed
/// error (and `exit_code_for` lands on the right exit category).
pub(super) fn map_galley_err(
    request_id: Option<String>,
    err: crate::error::GalleyError,
) -> SocketResponse {
    use crate::error::GalleyError;
    match err {
        GalleyError::NotFound { message } => SocketResponse::err(request_id, "not_found", message),
        GalleyError::InvalidArgs { message } => {
            SocketResponse::err(request_id, "invalid_args", message)
        }
        GalleyError::DbUnavailable { message } => {
            SocketResponse::err(request_id, "db_unavailable", message)
        }
        GalleyError::RunnerError { message } => {
            SocketResponse::err(request_id, "runner_error", message)
        }
        GalleyError::Internal { message } => SocketResponse::err(request_id, "internal", message),
    }
}

/// Carrier for errors raised before we know the request_id — bound to
/// the outer response by [`SocketResponseLite::with_request_id`]. Avoids
/// threading `request_id` through every helper. The "lite" suffix is
/// because the carrier doesn't include the request_id at construction.
pub(super) enum SocketResponseLite {
    InvalidArgs(String),
    DbUnavailable(String),
    NotFound(String),
    Internal(String),
    RunnerError(String),
    RunnerSpawnError(RunnerSpawnError),
}

impl SocketResponseLite {
    pub(super) fn invalid_args(msg: impl Into<String>) -> Self {
        SocketResponseLite::InvalidArgs(msg.into())
    }
    pub(super) fn runner_error(msg: impl Into<String>) -> Self {
        SocketResponseLite::RunnerError(msg.into())
    }
    pub(super) fn runner_spawn_error(e: RunnerSpawnError) -> Self {
        SocketResponseLite::RunnerSpawnError(e)
    }
    pub(super) fn from_err(e: crate::error::GalleyError) -> Self {
        use crate::error::GalleyError;
        match e {
            GalleyError::NotFound { message } => SocketResponseLite::NotFound(message),
            GalleyError::InvalidArgs { message } => SocketResponseLite::InvalidArgs(message),
            GalleyError::DbUnavailable { message } => SocketResponseLite::DbUnavailable(message),
            GalleyError::RunnerError { message } => SocketResponseLite::RunnerError(message),
            GalleyError::Internal { message } => SocketResponseLite::Internal(message),
        }
    }
    pub(super) fn into_galley_error(self) -> crate::error::GalleyError {
        use crate::error::GalleyError;
        match self {
            SocketResponseLite::NotFound(message) => GalleyError::NotFound { message },
            SocketResponseLite::InvalidArgs(message) => GalleyError::InvalidArgs { message },
            SocketResponseLite::DbUnavailable(message) => GalleyError::DbUnavailable { message },
            SocketResponseLite::RunnerError(message) => GalleyError::RunnerError { message },
            SocketResponseLite::Internal(message) => GalleyError::Internal { message },
            SocketResponseLite::RunnerSpawnError(e) => GalleyError::RunnerError {
                message: format!("runner spawn failed: {e:?}"),
            },
        }
    }
    pub(super) fn with_request_id(self, request_id: Option<String>) -> SocketResponse {
        match self {
            SocketResponseLite::InvalidArgs(m) => {
                SocketResponse::err(request_id, "invalid_args", m)
            }
            SocketResponseLite::DbUnavailable(m) => {
                SocketResponse::err(request_id, "db_unavailable", m)
            }
            SocketResponseLite::NotFound(m) => SocketResponse::err(request_id, "not_found", m),
            SocketResponseLite::Internal(m) => SocketResponse::err(request_id, "internal", m),
            SocketResponseLite::RunnerError(m) => {
                SocketResponse::err(request_id, "runner_error", m)
            }
            SocketResponseLite::RunnerSpawnError(e) => {
                SocketResponse::err(request_id, runner_spawn_error_tag(&e), e.to_string())
            }
        }
    }
}

pub(super) fn runner_spawn_error_tag(e: &RunnerSpawnError) -> &'static str {
    match e {
        RunnerSpawnError::PythonNotFound { .. } => "python_not_found",
        RunnerSpawnError::GaPathInvalid { .. } => "ga_path_invalid",
        RunnerSpawnError::ManagedRuntimeInvalid { .. } => "managed_runtime_invalid",
        RunnerSpawnError::ManagedModelNotConfigured { .. } => "managed_model_not_configured",
        RunnerSpawnError::NativeRuntimeUnavailable { .. } => "native_runtime_unavailable",
        RunnerSpawnError::BridgeCwdInvalid { .. } => "bridge_cwd_invalid",
        RunnerSpawnError::PathEncoding { .. } => "path_encoding",
        RunnerSpawnError::SpawnIo { .. } => "spawn_io",
        RunnerSpawnError::PipeUnavailable { .. } => "pipe_unavailable",
    }
}
