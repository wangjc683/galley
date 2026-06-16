//! Typed errors for the runner_manager surface.
//!
//! Style matches [`crate::error::GalleyError`]: hand-rolled `Display` +
//! `std::error::Error`, no `thiserror`. Each variant is a stable identifier
//! that downstream callers (Tauri commands, socket protocol) pattern-match
//! on. The string `Display` form is what gets surfaced to logs / UI.
//!
//! ## Why a separate error type from `GalleyError`
//!
//! Runner errors are operational (subprocess didn't start, write failed,
//! shutdown timed out) — different category from `GalleyError` which models
//! API-surface failures (not found, invalid args, db unavailable). Mixing
//! the two would force every CLI / Tauri command handler to know about
//! both shapes. Instead, the trait layer (when [`crate::api::GalleyApi`]
//! starts having write methods in B2 M4) translates `Send/Shutdown` errors
//! into appropriate `GalleyError` variants at the boundary.

use serde::Serialize;
use std::fmt;
use std::io;

/// Failures during [`RunnerProcess::spawn`](super::process::RunnerProcess::spawn).
#[derive(Debug, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum RunnerSpawnError {
    /// `args.python` (or bundled Python alias) couldn't be exec'd. Most
    /// commonly: PATH-resolved interpreter doesn't exist or isn't a
    /// regular file. Carries the OS error message for diagnostics.
    PythonNotFound { detail: String },
    /// `args.ga_path` doesn't point at a usable GA install. We don't
    /// validate exhaustively here — Python `import agentmain` will be the
    /// authoritative check — but the path itself has to be a directory.
    GaPathInvalid { detail: String },
    /// Galley's managed GA code/state layout is incomplete or inconsistent.
    ManagedRuntimeInvalid { detail: String },
    /// Managed runtime was selected but no model credential can be used.
    ManagedModelNotConfigured { detail: String },
    /// Galley Native was selected before the native worker exists.
    NativeRuntimeUnavailable { detail: String },
    /// `args.bridge_cwd` doesn't exist (used as `cwd` for the subprocess).
    BridgeCwdInvalid { detail: String },
    /// `args.ga_path` or `args.bridge_cwd` had a non-UTF-8 path component
    /// that can't be passed via CLI args. Rare on macOS/Linux, but
    /// theoretically possible.
    PathEncoding { detail: String },
    /// The Tokio `Command::spawn` call itself failed at the OS layer.
    /// Subsumes EACCES, ENOMEM, fork rate-limit, etc.
    SpawnIo { detail: String },
    /// Couldn't take ownership of one of the subprocess pipes — usually
    /// means stdio config got changed away from `piped()`. This is a
    /// programming error, not a runtime one.
    PipeUnavailable { detail: String },
}

impl fmt::Display for RunnerSpawnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PythonNotFound { detail } => write!(f, "python not found: {}", detail),
            Self::GaPathInvalid { detail } => write!(f, "GA path invalid: {}", detail),
            Self::ManagedRuntimeInvalid { detail } => {
                write!(f, "managed runtime invalid: {}", detail)
            }
            Self::ManagedModelNotConfigured { detail } => {
                write!(f, "managed model not configured: {}", detail)
            }
            Self::NativeRuntimeUnavailable { detail } => {
                write!(f, "native runtime unavailable: {}", detail)
            }
            Self::BridgeCwdInvalid { detail } => write!(f, "bridge cwd invalid: {}", detail),
            Self::PathEncoding { detail } => write!(f, "path encoding error: {}", detail),
            Self::SpawnIo { detail } => write!(f, "subprocess spawn failed: {}", detail),
            Self::PipeUnavailable { detail } => {
                write!(f, "subprocess pipe unavailable: {}", detail)
            }
        }
    }
}

impl std::error::Error for RunnerSpawnError {}

impl From<io::Error> for RunnerSpawnError {
    fn from(e: io::Error) -> Self {
        // `Command::spawn` returns NotFound when the program isn't
        // resolvable from PATH (or the absolute path doesn't exist).
        // Map that specific case so callers can distinguish.
        if e.kind() == io::ErrorKind::NotFound {
            Self::PythonNotFound {
                detail: e.to_string(),
            }
        } else {
            Self::SpawnIo {
                detail: e.to_string(),
            }
        }
    }
}

/// Failures during [`RunnerProcess::send_command`](super::process::RunnerProcess::send_command).
#[derive(Debug, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum SendCommandError {
    /// The session id had no matching alive [`RunnerProcess`] in the
    /// manager. Either the process never spawned, exited cleanly, or
    /// was evicted by LRU.
    ProcessGone { session_id: String },
    /// `serde_json` serialization of the command failed. Programming
    /// error (commands are typed structs and should always serialize).
    Serialize { detail: String },
    /// Writing the JSON line to stdin failed at the IO layer — broken
    /// pipe (subprocess crashed mid-write), interrupted, etc.
    WriteIo { detail: String },
}

impl fmt::Display for SendCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProcessGone { session_id } => {
                write!(f, "runner process for session {} is gone", session_id)
            }
            Self::Serialize { detail } => write!(f, "command serialize failed: {}", detail),
            Self::WriteIo { detail } => write!(f, "stdin write failed: {}", detail),
        }
    }
}

impl std::error::Error for SendCommandError {}

/// Failures during [`RunnerProcess::shutdown`](super::process::RunnerProcess::shutdown).
#[derive(Debug, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum ShutdownError {
    /// The session id had no matching alive process. Idempotent shutdown
    /// callers should treat this as success.
    NotFound { session_id: String },
    /// Sending `{"kind":"shutdown"}` to stdin failed AND the kill
    /// fallback also failed. Process is in an unknown state. Carries
    /// the underlying message for diagnostics.
    KillFailed { detail: String },
}

impl fmt::Display for ShutdownError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { session_id } => {
                write!(f, "no runner process for session {}", session_id)
            }
            Self::KillFailed { detail } => write!(f, "kill failed: {}", detail),
        }
    }
}

impl std::error::Error for ShutdownError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_spawn_error_carries_discriminant() {
        let e = RunnerSpawnError::PythonNotFound {
            detail: "no such file".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"error\":\"python_not_found\""));
        assert!(s.contains("\"detail\":\"no such file\""));
    }

    #[test]
    fn display_format_is_stable() {
        let e = SendCommandError::ProcessGone {
            session_id: "s1".into(),
        };
        assert_eq!(e.to_string(), "runner process for session s1 is gone");
    }

    #[test]
    fn io_error_notfound_maps_to_python_not_found() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "exec failed");
        let spawn_err: RunnerSpawnError = io_err.into();
        assert!(matches!(spawn_err, RunnerSpawnError::PythonNotFound { .. }));
    }

    #[test]
    fn io_error_other_maps_to_spawn_io() {
        let io_err = io::Error::other("eacces");
        let spawn_err: RunnerSpawnError = io_err.into();
        assert!(matches!(spawn_err, RunnerSpawnError::SpawnIo { .. }));
    }

    #[test]
    fn native_runtime_unavailable_serializes_stable_tag() {
        let e = RunnerSpawnError::NativeRuntimeUnavailable {
            detail: "not implemented".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"error\":\"native_runtime_unavailable\""));
        assert!(s.contains("\"detail\":\"not implemented\""));
    }
}
