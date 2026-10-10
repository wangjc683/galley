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
/// Each variant gets its own stable [`ErrorTag`] discriminant so the
/// CLI (`cli/src/client.rs::galley_error_for_tag`) can round-trip back
/// to a typed error (and `exit_code_for` lands on the right exit
/// category).
pub(super) fn map_galley_err(
    request_id: Option<String>,
    err: crate::error::GalleyError,
) -> SocketResponse {
    use crate::error::GalleyError;
    match err {
        GalleyError::NotFound { message } => {
            SocketResponse::err(request_id, ErrorTag::NotFound, message)
        }
        GalleyError::InvalidArgs { message } => {
            SocketResponse::err(request_id, ErrorTag::InvalidArgs, message)
        }
        GalleyError::DbUnavailable { message } => {
            SocketResponse::err(request_id, ErrorTag::DbUnavailable, message)
        }
        GalleyError::RunnerError { message } => {
            SocketResponse::err(request_id, ErrorTag::RunnerError, message)
        }
        GalleyError::Internal { message } => {
            SocketResponse::err(request_id, ErrorTag::Internal, message)
        }
    }
}

/// Carrier for errors raised before we know the request_id — bound to
/// the outer response by [`SocketResponseLite::with_request_id`]. Avoids
/// threading `request_id` through every helper. The "lite" suffix is
/// because the carrier doesn't include the request_id at construction.
#[derive(Debug)]
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
    /// Render a shared-runner-path error ([`crate::session_runner`]) as
    /// the socket transport always has. The texts below are the frozen
    /// Agent API wording from before the path moved out of this module
    /// (`spawn_config.rs` / `session_cmds::ensure_session_runner`) —
    /// change none of them; the `session.new` wording appears on the
    /// Goal path too, as it always did.
    pub(super) fn from_session_runner(
        e: crate::session_runner::SessionRunnerError,
        via: &str,
    ) -> Self {
        use crate::session_runner::SessionRunnerError as E;
        match e {
            E::Db(e) => SocketResponseLite::from_err(e),
            E::ManagedNeedsApp => SocketResponseLite::runner_error(
                "managed runtime is unavailable without a Galley app handle",
            ),
            E::GaConfigMissing => SocketResponseLite::runner_error(
                "session.new runner config is missing; open Galley Settings once to save runtime paths",
            ),
            E::GaConfigShape(e) => {
                SocketResponseLite::runner_error(format!("ga_config pref shape mismatch: {e}"))
            }
            E::GaConfigKeyMissing(key) => {
                SocketResponseLite::runner_error(format!("session.new runner config missing {key}"))
            }
            E::BridgeCwdNotDir(path) => SocketResponseLite::runner_error(format!(
                "bridge cwd invalid: not a directory: {}",
                path.display()
            )),
            E::BridgeCwdResolve(e) => {
                SocketResponseLite::runner_error(format!("resolving Galley bridge cwd failed: {e}"))
            }
            E::NonUtf8Path(label) => SocketResponseLite::runner_error(format!(
                "{label} path contains non-UTF-8 characters"
            )),
            E::Spawn(e) => SocketResponseLite::runner_spawn_error(e),
            E::SubscribeFailed => SocketResponseLite::runner_error(format!(
                "{via}: runner subscribe failed after spawn"
            )),
            // New with ticket 02b; only the Goal path can meet it.
            E::HistoryReplay(reason) => SocketResponseLite::runner_error(format!(
                "{via}: history replay failed: {reason}"
            )),
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
                SocketResponse::err(request_id, ErrorTag::InvalidArgs, m)
            }
            SocketResponseLite::DbUnavailable(m) => {
                SocketResponse::err(request_id, ErrorTag::DbUnavailable, m)
            }
            SocketResponseLite::NotFound(m) => {
                SocketResponse::err(request_id, ErrorTag::NotFound, m)
            }
            SocketResponseLite::Internal(m) => {
                SocketResponse::err(request_id, ErrorTag::Internal, m)
            }
            SocketResponseLite::RunnerError(m) => {
                SocketResponse::err(request_id, ErrorTag::RunnerError, m)
            }
            SocketResponseLite::RunnerSpawnError(e) => {
                SocketResponse::err(request_id, runner_spawn_error_tag(&e), e.to_string())
            }
        }
    }
}

pub(super) fn runner_spawn_error_tag(e: &RunnerSpawnError) -> ErrorTag {
    match e {
        RunnerSpawnError::PythonNotFound { .. } => ErrorTag::PythonNotFound,
        RunnerSpawnError::GaPathInvalid { .. } => ErrorTag::GaPathInvalid,
        RunnerSpawnError::ManagedRuntimeInvalid { .. } => ErrorTag::ManagedRuntimeInvalid,
        RunnerSpawnError::ManagedModelNotConfigured { .. } => ErrorTag::ManagedModelNotConfigured,
        RunnerSpawnError::BridgeCwdInvalid { .. } => ErrorTag::BridgeCwdInvalid,
        RunnerSpawnError::PathEncoding { .. } => ErrorTag::PathEncoding,
        RunnerSpawnError::SpawnIo { .. } => ErrorTag::SpawnIo,
        RunnerSpawnError::PipeUnavailable { .. } => ErrorTag::PipeUnavailable,
    }
}
