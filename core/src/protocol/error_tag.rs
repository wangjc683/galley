/// Wire error discriminant for the `error` field of an `ok:false`
/// [`super::SocketResponse`]. The string values are a frozen part of the
/// schemaVersion 1 contract (docs/agent-api/stability-and-versioning.md
/// §2/§2A) — new variants may be added (additive), existing strings may
/// never change.
///
/// Both ends speak this enum: Core emission sites construct variants,
/// and the CLI's tag→exit-code mapping matches on it exhaustively
/// (listing [`ErrorTag::Other`] explicitly, no `_` arm) so adding a
/// variant here fails CLI compilation until the mapping is extended —
/// drift surfaces at compile time instead of silently landing in the
/// exit-1 bucket.
///
/// [`ErrorTag::Other`] preserves forward compatibility at runtime: an
/// older CLI receiving a tag minted by a newer Core still degrades to
/// the documented exit-1 collapse instead of failing to parse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorTag {
    // GalleyError-backed tags (map 1-1 onto exit-code classes).
    NotFound,
    InvalidArgs,
    DbUnavailable,
    RunnerError,
    Internal,
    // Runner spawn failure tags (all exit-code class: runner_error).
    PythonNotFound,
    GaPathInvalid,
    ManagedRuntimeInvalid,
    ManagedModelNotConfigured,
    BridgeCwdInvalid,
    PathEncoding,
    SpawnIo,
    PipeUnavailable,
    // Transport/protocol-level tags (documented exit-1 collapse:
    // stability-and-versioning.md §2A).
    SchemaMismatch,
    UnknownCommand,
    AppUnavailable,
    IdleTimeout,
    /// A tag this build doesn't know — emitted by a newer Core.
    Other(String),
}

impl ErrorTag {
    pub fn as_wire(&self) -> &str {
        match self {
            ErrorTag::NotFound => "not_found",
            ErrorTag::InvalidArgs => "invalid_args",
            ErrorTag::DbUnavailable => "db_unavailable",
            ErrorTag::RunnerError => "runner_error",
            ErrorTag::Internal => "internal",
            ErrorTag::PythonNotFound => "python_not_found",
            ErrorTag::GaPathInvalid => "ga_path_invalid",
            ErrorTag::ManagedRuntimeInvalid => "managed_runtime_invalid",
            ErrorTag::ManagedModelNotConfigured => "managed_model_not_configured",
            ErrorTag::BridgeCwdInvalid => "bridge_cwd_invalid",
            ErrorTag::PathEncoding => "path_encoding",
            ErrorTag::SpawnIo => "spawn_io",
            ErrorTag::PipeUnavailable => "pipe_unavailable",
            ErrorTag::SchemaMismatch => "schema_mismatch",
            ErrorTag::UnknownCommand => "unknown_command",
            ErrorTag::AppUnavailable => "app_unavailable",
            ErrorTag::IdleTimeout => "idle_timeout",
            ErrorTag::Other(s) => s,
        }
    }

    pub fn from_wire(s: &str) -> Self {
        match s {
            "not_found" => ErrorTag::NotFound,
            "invalid_args" => ErrorTag::InvalidArgs,
            "db_unavailable" => ErrorTag::DbUnavailable,
            "runner_error" => ErrorTag::RunnerError,
            "internal" => ErrorTag::Internal,
            "python_not_found" => ErrorTag::PythonNotFound,
            "ga_path_invalid" => ErrorTag::GaPathInvalid,
            "managed_runtime_invalid" => ErrorTag::ManagedRuntimeInvalid,
            "managed_model_not_configured" => ErrorTag::ManagedModelNotConfigured,
            "bridge_cwd_invalid" => ErrorTag::BridgeCwdInvalid,
            "path_encoding" => ErrorTag::PathEncoding,
            "spawn_io" => ErrorTag::SpawnIo,
            "pipe_unavailable" => ErrorTag::PipeUnavailable,
            "schema_mismatch" => ErrorTag::SchemaMismatch,
            "unknown_command" => ErrorTag::UnknownCommand,
            "app_unavailable" => ErrorTag::AppUnavailable,
            "idle_timeout" => ErrorTag::IdleTimeout,
            other => ErrorTag::Other(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_round_trip_is_identity_for_known_tags() {
        for tag in [
            "not_found",
            "invalid_args",
            "db_unavailable",
            "runner_error",
            "internal",
            "python_not_found",
            "ga_path_invalid",
            "managed_runtime_invalid",
            "managed_model_not_configured",
            "bridge_cwd_invalid",
            "path_encoding",
            "spawn_io",
            "pipe_unavailable",
            "schema_mismatch",
            "unknown_command",
            "app_unavailable",
            "idle_timeout",
        ] {
            let parsed = ErrorTag::from_wire(tag);
            assert!(!matches!(parsed, ErrorTag::Other(_)), "{tag} fell to Other");
            assert_eq!(parsed.as_wire(), tag);
        }
    }

    #[test]
    fn unknown_tag_survives_round_trip_via_other() {
        let parsed = ErrorTag::from_wire("some_future_tag");
        assert_eq!(parsed, ErrorTag::Other("some_future_tag".into()));
        assert_eq!(parsed.as_wire(), "some_future_tag");
    }
}
