//! Shared CLI↔Core socket protocol — the single home for schemaVersion 1
//! command names, argument shapes, envelopes, and error discriminants.
//!
//! # The rule this module enforces
//!
//! Every `socket_listener` dispatch arm that parses `args` MUST parse into
//! a type defined here (or a shared `crate::api` type such as
//! [`crate::api::SessionFilter`], which is `sessions.list`'s args shape).
//! Every CLI request MUST be built by serializing the same type via
//! [`SocketCommand::NAME`]. Never hand-write a command-name or field-name
//! literal on either side: with `#[serde(default)]` and no
//! `deny_unknown_fields` (both required for schemaVersion 1 additive
//! evolution), a drifted field name does not error — it silently becomes
//! `None` on the server, which is exactly the bug class this module exists
//! to make unrepresentable.
//!
//! # Wire compatibility
//!
//! These types serialize to the same schemaVersion 1 JSON the CLI and Core
//! exchanged before this module existed. Response and stream-envelope
//! bytes are pinned by the golden tests in [`envelope`]; per-command field
//! names are pinned by the legacy-equivalence tests in [`commands`].
//! Breaking either requires `schemaVersion: 2` (see Rule 3 in AGENTS.md
//! and docs/agent-api/stability-and-versioning.md).

mod commands;
mod envelope;
mod error_tag;

pub use commands::{
    LlmSetArgs, ProjectCreateArgs, ProjectDeleteArgs, SessionArchiveArgs, SessionBtwArgs,
    SessionCheckpointArgs, SessionGoalMasterPlanArgs, SessionGoalSoloTurnArgs,
    SessionGoalSynthesizeArgs, SessionMoveArgs, SessionNewArgs, SessionNewGoalWorkerArgs,
    SessionNewResult, SessionRestoreArgs, SessionRunStateArgs, SessionSendArgs,
    SessionShutdownRunnerArgs, SessionStopArgs, SessionWatchArgs, SocketCommand,
};
pub use envelope::{SocketRequest, SocketResponse, StreamEnvelope, WatchFrame, SCHEMA_VERSION};
pub use error_tag::ErrorTag;
