//! Per-command argument shapes. Field declaration order mirrors the legacy
//! CLI `json!` literals; optional fields carry `#[serde(default)]` (never
//! `deny_unknown_fields` — schemaVersion 1 evolves additively, so both
//! ends must tolerate fields they don't know).
//!
//! `Option` fields serialize as explicit `null` (no `skip_serializing_if`),
//! matching the byte shape the CLI's `json!` builders produced before this
//! module existed.

use crate::api::{MessageBrief, RuntimeKind, SessionBrief};
use serde::{Deserialize, Serialize};

/// Binds a command's wire name to its argument shape at the type level.
/// `SocketClient::call` takes the args struct alone — the command-name
/// string cannot be paired with the wrong arguments.
pub trait SocketCommand: Serialize {
    const NAME: &'static str;
}

macro_rules! socket_command {
    ($ty:ty, $name:literal) => {
        impl SocketCommand for $ty {
            const NAME: &'static str = $name;
        }
    };
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSendArgs {
    pub session_id: String,
    pub content: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    /// Jump the queue (galley#19): when the target session's run is
    /// open, abort it and run this message first instead of waiting at
    /// the back. No effect on an idle session. Additive since v1;
    /// skipped when false so the legacy wire shape is unchanged.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub jump: bool,
}
socket_command!(SessionSendArgs, "session.send");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointArgs {
    pub session_id: String,
    pub content: String,
    /// Goal this checkpoint narrates. Optional and additive
    /// (schemaVersion 1): older callers omit it and the row persists
    /// un-stamped, exactly as before 031.
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionCheckpointArgs, "session.checkpoint");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGoalSynthesizeArgs {
    pub session_id: String,
    pub visible_content: String,
    pub dispatch_content: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionGoalSynthesizeArgs, "session.goal_synthesize");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGoalMasterPlanArgs {
    pub session_id: String,
    pub dispatch_content: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionGoalMasterPlanArgs, "session.goal_master_plan");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGoalSoloTurnArgs {
    pub session_id: String,
    pub dispatch_content: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionGoalSoloTurnArgs, "session.goal_solo_turn");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWatchArgs {
    pub session_id: String,
}
socket_command!(SessionWatchArgs, "session.watch");

/// Live busy probe for one session (additive since v1). The Goal
/// controller polls this between working turns — the DB `sessions.status`
/// column persists transient statuses as `idle`, so it cannot answer
/// "is a run still open".
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunStateArgs {
    pub session_id: String,
}
socket_command!(SessionRunStateArgs, "session.run_state");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewArgs {
    pub task: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub llm_name: Option<String>,
    #[serde(default)]
    pub runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionNewArgs, "session.new");

/// Result shape of a successful `session.new` / `session.new_goal_worker`
/// (schemaVersion 1; documented in agent-api/session-commands). Shared by
/// the producing handler and the in-process scheduler consumer so a field
/// rename is a compile error, not a silently dropped session id. Unlike
/// args structs, `warning` is omitted when absent — that is the wire shape
/// the handler has always produced.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewResult {
    pub session: SessionBrief,
    pub message: MessageBrief,
    /// Always `"dispatched"` on the success envelope; failure modes
    /// return error envelopes instead (see ADR-0002's table).
    pub dispatch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewGoalWorkerArgs {
    pub task_template: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub llm_name: Option<String>,
    #[serde(default)]
    pub runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionNewGoalWorkerArgs, "session.new_goal_worker");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBtwArgs {
    pub session_id: String,
    pub question: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionBtwArgs, "session.btw");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStopArgs {
    pub session_id: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionStopArgs, "session.stop");

/// Same shape as [`SessionStopArgs`] — distinct type so the command name
/// binds at the type level (stop aborts the turn, shutdown kills the
/// bridge; see sub-plan §1.4).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionShutdownRunnerArgs {
    pub session_id: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionShutdownRunnerArgs, "session.shutdown_runner");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArchiveArgs {
    pub session_id: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionArchiveArgs, "session.archive");

/// Same shape as [`SessionArchiveArgs`] — same flags, opposite verb.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRestoreArgs {
    pub session_id: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionRestoreArgs, "session.restore");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMoveArgs {
    pub session_id: String,
    /// `None` = detach from any project (move to ungrouped). Matches the
    /// CLI surface where omitting `--to` means "detach".
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionMoveArgs, "session.move");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateArgs {
    pub name: String,
    #[serde(default)]
    pub root_path: Option<String>,
    #[serde(default)]
    pub workspace_enabled: bool,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(ProjectCreateArgs, "project.create");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteArgs {
    pub project_id: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(ProjectDeleteArgs, "project.delete");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSetArgs {
    pub session_id: String,
    pub llm_name: String,
}
socket_command!(LlmSetArgs, "llm.set");

/// Legacy-equivalence pins: each args struct must serialize to the same
/// `Value` the CLI's hand-written `json!` literal produced before this
/// module existed (2026-07-11). These tests are what makes a field rename
/// a loud failure instead of a silently-dropped argument.
#[cfg(test)]
mod legacy_equivalence {
    use super::*;
    use serde_json::json;

    fn assert_matches_legacy<T: Serialize>(args: &T, legacy: serde_json::Value) {
        assert_eq!(serde_json::to_value(args).unwrap(), legacy);
    }

    #[test]
    fn session_send() {
        assert_matches_legacy(
            &SessionSendArgs {
                session_id: "s1".into(),
                content: "hello".into(),
                supervisor: Some("sup".into()),
                reason: None,
                jump: false,
            },
            json!({"sessionId": "s1", "content": "hello", "supervisor": "sup", "reason": null}),
        );
    }

    #[test]
    fn session_checkpoint() {
        assert_matches_legacy(
            &SessionCheckpointArgs {
                session_id: "s1".into(),
                content: "cp".into(),
                goal_id: Some("g1".into()),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "content": "cp", "goalId": "g1", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_goal_synthesize() {
        assert_matches_legacy(
            &SessionGoalSynthesizeArgs {
                session_id: "s1".into(),
                visible_content: "v".into(),
                dispatch_content: "d".into(),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "visibleContent": "v", "dispatchContent": "d", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_goal_master_plan() {
        assert_matches_legacy(
            &SessionGoalMasterPlanArgs {
                session_id: "s1".into(),
                dispatch_content: "d".into(),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "dispatchContent": "d", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_goal_solo_turn() {
        assert_matches_legacy(
            &SessionGoalSoloTurnArgs {
                session_id: "s1".into(),
                dispatch_content: "d".into(),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "dispatchContent": "d", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_watch() {
        assert_matches_legacy(
            &SessionWatchArgs {
                session_id: "s1".into(),
            },
            json!({"sessionId": "s1"}),
        );
    }

    #[test]
    fn session_new() {
        assert_matches_legacy(
            &SessionNewArgs {
                task: "t".into(),
                project_id: Some("p1".into()),
                llm_name: None,
                runtime_kind: None,
                supervisor: None,
                reason: None,
            },
            json!({"task": "t", "projectId": "p1", "llmName": null, "runtimeKind": null, "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_new_goal_worker() {
        assert_matches_legacy(
            &SessionNewGoalWorkerArgs {
                task_template: "tpl".into(),
                project_id: None,
                llm_name: None,
                runtime_kind: None,
                supervisor: None,
                reason: None,
            },
            json!({"taskTemplate": "tpl", "projectId": null, "llmName": null, "runtimeKind": null, "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_btw() {
        assert_matches_legacy(
            &SessionBtwArgs {
                session_id: "s1".into(),
                question: "q".into(),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "question": "q", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn session_stop_and_shutdown_and_archive_family() {
        for legacy in [json!({"sessionId": "s1", "supervisor": null, "reason": null})] {
            assert_matches_legacy(
                &SessionStopArgs {
                    session_id: "s1".into(),
                    supervisor: None,
                    reason: None,
                },
                legacy.clone(),
            );
            assert_matches_legacy(
                &SessionShutdownRunnerArgs {
                    session_id: "s1".into(),
                    supervisor: None,
                    reason: None,
                },
                legacy.clone(),
            );
            assert_matches_legacy(
                &SessionArchiveArgs {
                    session_id: "s1".into(),
                    supervisor: None,
                    reason: None,
                },
                legacy.clone(),
            );
            assert_matches_legacy(
                &SessionRestoreArgs {
                    session_id: "s1".into(),
                    supervisor: None,
                    reason: None,
                },
                legacy,
            );
        }
    }

    #[test]
    fn session_move() {
        assert_matches_legacy(
            &SessionMoveArgs {
                session_id: "s1".into(),
                to: Some("p2".into()),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "to": "p2", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn project_create() {
        assert_matches_legacy(
            &ProjectCreateArgs {
                name: "n".into(),
                root_path: Some("/tmp/x".into()),
                workspace_enabled: true,
                icon: None,
                color: None,
                supervisor: None,
                reason: None,
            },
            json!({"name": "n", "rootPath": "/tmp/x", "workspaceEnabled": true, "icon": null, "color": null, "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn project_delete() {
        assert_matches_legacy(
            &ProjectDeleteArgs {
                project_id: "p1".into(),
                supervisor: None,
                reason: None,
            },
            json!({"projectId": "p1", "supervisor": null, "reason": null}),
        );
    }

    #[test]
    fn llm_set() {
        assert_matches_legacy(
            &LlmSetArgs {
                session_id: "s1".into(),
                llm_name: "glm-5".into(),
            },
            json!({"sessionId": "s1", "llmName": "glm-5"}),
        );
    }

    #[test]
    fn command_names_are_the_dispatch_names() {
        // One place to eyeball the full name↔type table.
        assert_eq!(SessionSendArgs::NAME, "session.send");
        assert_eq!(SessionCheckpointArgs::NAME, "session.checkpoint");
        assert_eq!(SessionGoalSynthesizeArgs::NAME, "session.goal_synthesize");
        assert_eq!(SessionGoalMasterPlanArgs::NAME, "session.goal_master_plan");
        assert_eq!(SessionGoalSoloTurnArgs::NAME, "session.goal_solo_turn");
        assert_eq!(SessionWatchArgs::NAME, "session.watch");
        assert_eq!(SessionNewArgs::NAME, "session.new");
        assert_eq!(SessionNewGoalWorkerArgs::NAME, "session.new_goal_worker");
        assert_eq!(SessionBtwArgs::NAME, "session.btw");
        assert_eq!(SessionStopArgs::NAME, "session.stop");
        assert_eq!(SessionShutdownRunnerArgs::NAME, "session.shutdown_runner");
        assert_eq!(SessionArchiveArgs::NAME, "session.archive");
        assert_eq!(SessionRestoreArgs::NAME, "session.restore");
        assert_eq!(SessionMoveArgs::NAME, "session.move");
        assert_eq!(ProjectCreateArgs::NAME, "project.create");
        assert_eq!(ProjectDeleteArgs::NAME, "project.delete");
        assert_eq!(LlmSetArgs::NAME, "llm.set");
    }
}
