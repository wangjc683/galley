//! Per-command argument shapes. Field declaration order mirrors the legacy
//! CLI `json!` literals; optional fields carry `#[serde(default)]` (never
//! `deny_unknown_fields` — schemaVersion 1 evolves additively, so both
//! ends must tolerate fields they don't know).
//!
//! `Option` fields serialize as explicit `null` (no `skip_serializing_if`),
//! matching the byte shape the CLI's `json!` builders produced before this
//! module existed.

use crate::api::schedule::{ScheduleTarget, ScheduledTaskRepeat};
use crate::api::{MessageBrief, RuntimeKind, SessionBrief};
use serde::{Deserialize, Serialize};

pub use crate::git_review::GitReviewRequest;
pub use crate::local_file::LocalFileRequest;

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

socket_command!(LocalFileRequest, "local_file.access");
socket_command!(GitReviewRequest, "git.review");

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
    /// Start a runner when the session has none (ADR-0003's consequence,
    /// additive since 2026-10-16): when the message dispatches now and no
    /// runner is alive, Core ensures one on its shared path — history
    /// replayed, the run gate held across the spawn and the replay — and
    /// then dispatches, so a send to a cold session answers `dispatched`
    /// instead of `persisted_only`. A live runner, or a message that is
    /// queued, is handled exactly as without it. Skipped when false so the
    /// legacy wire shape is unchanged.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ensure_runner: bool,
}
socket_command!(SessionSendArgs, "session.send");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointArgs {
    pub session_id: String,
    pub content: String,
    #[serde(default)]
    pub supervisor: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}
socket_command!(SessionCheckpointArgs, "session.checkpoint");

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWatchArgs {
    pub session_id: String,
}
socket_command!(SessionWatchArgs, "session.watch");

/// Live busy probe for one session (additive since v1). A Supervisor
/// polls this between turns — the DB `sessions.status` column persists
/// transient statuses as `idle`, so it cannot answer "is a run still
/// open".
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunStateArgs {
    pub session_id: String,
}
socket_command!(SessionRunStateArgs, "session.run_state");

/// Bulk live busy probe (additive since v0.4.13). `sessionIds` scopes the
/// answer; omit it to get every session the RunnerManager currently knows
/// about (live runner or non-empty queue). The CLI attaches the result to
/// `sessions list` / `session brief` / `status` as the `live` field so a
/// Supervisor can see which sessions are actually running — the persisted
/// `status` column never says `running`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsRunStateArgs {
    #[serde(default)]
    pub session_ids: Option<Vec<String>>,
}
socket_command!(SessionsRunStateArgs, "sessions.run_state");

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

/// Result shape of a successful `session.new`
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

// ---- scheduled tasks (main chat ticket 34, additive inside 3) ----
//
// New commands, so their optional fields skip when absent: there is no
// legacy shape to keep byte-for-byte.

/// `schedule.list`: the tasks that may still fire, or every one.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleListArgs {
    /// Fired one-offs, disabled and cancelled tasks too.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub all: bool,
}
socket_command!(ScheduleListArgs, "schedule.list");

/// `schedule.show`: one task, cancelled or not.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleShowArgs {
    pub task_id: String,
}
socket_command!(ScheduleShowArgs, "schedule.show");

/// `schedule.create`. Exactly one of `fireAt` (a one-off) and `repeat` (a
/// daily / weekly / monthly rule, with `timeOfDay`).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleCreateArgs {
    pub prompt: String,
    /// A one-off's time: RFC 3339, or local `YYYY-MM-DDTHH:MM[:SS]` read
    /// in the zone of the machine Galley runs on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fire_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<ScheduledTaskRepeat>,
    /// `HH:MM`, local, for a repeating rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    /// `session` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ScheduleTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supervisor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
socket_command!(ScheduleCreateArgs, "schedule.create");

/// `schedule.update`: only the fields given change. An empty `projectId`
/// or `llmName` clears it.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleUpdateArgs {
    pub task_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fire_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<ScheduledTaskRepeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<ScheduleTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supervisor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
socket_command!(ScheduleUpdateArgs, "schedule.update");

macro_rules! schedule_task_command {
    ($(#[$doc:meta])* $ty:ident, $name:literal) => {
        $(#[$doc])*
        #[derive(Debug, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct $ty {
            pub task_id: String,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            pub supervisor: Option<String>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            pub reason: Option<String>,
        }
        socket_command!($ty, $name);
    };
}

schedule_task_command!(
    /// `schedule.delete`: cancel the task (a soft delete).
    ScheduleDeleteArgs,
    "schedule.delete"
);
schedule_task_command!(
    /// `schedule.enable`.
    ScheduleEnableArgs,
    "schedule.enable"
);
schedule_task_command!(
    /// `schedule.disable`.
    ScheduleDisableArgs,
    "schedule.disable"
);
schedule_task_command!(
    /// `schedule.run`: fire it once now, through the scheduled path.
    ScheduleRunArgs,
    "schedule.run"
);

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
                ensure_runner: false,
            },
            json!({"sessionId": "s1", "content": "hello", "supervisor": "sup", "reason": null}),
        );
        // The additive flags appear only when set.
        assert_matches_legacy(
            &SessionSendArgs {
                session_id: "s1".into(),
                content: "hello".into(),
                supervisor: None,
                reason: None,
                jump: false,
                ensure_runner: true,
            },
            json!({"sessionId": "s1", "content": "hello", "supervisor": null, "reason": null,
                   "ensureRunner": true}),
        );
        // An older client that never sends it gets today's behavior.
        let parsed: SessionSendArgs =
            serde_json::from_value(json!({"sessionId": "s1", "content": "hello"})).unwrap();
        assert!(!parsed.ensure_runner && !parsed.jump);
    }

    #[test]
    fn session_checkpoint() {
        assert_matches_legacy(
            &SessionCheckpointArgs {
                session_id: "s1".into(),
                content: "cp".into(),
                supervisor: None,
                reason: None,
            },
            json!({"sessionId": "s1", "content": "cp", "supervisor": null, "reason": null}),
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
        assert_eq!(SessionWatchArgs::NAME, "session.watch");
        assert_eq!(SessionNewArgs::NAME, "session.new");
        assert_eq!(SessionBtwArgs::NAME, "session.btw");
        assert_eq!(SessionStopArgs::NAME, "session.stop");
        assert_eq!(SessionShutdownRunnerArgs::NAME, "session.shutdown_runner");
        assert_eq!(SessionArchiveArgs::NAME, "session.archive");
        assert_eq!(SessionRestoreArgs::NAME, "session.restore");
        assert_eq!(SessionMoveArgs::NAME, "session.move");
        assert_eq!(ProjectCreateArgs::NAME, "project.create");
        assert_eq!(ProjectDeleteArgs::NAME, "project.delete");
        assert_eq!(LlmSetArgs::NAME, "llm.set");
        assert_eq!(ScheduleListArgs::NAME, "schedule.list");
        assert_eq!(ScheduleShowArgs::NAME, "schedule.show");
        assert_eq!(ScheduleCreateArgs::NAME, "schedule.create");
        assert_eq!(ScheduleUpdateArgs::NAME, "schedule.update");
        assert_eq!(ScheduleDeleteArgs::NAME, "schedule.delete");
        assert_eq!(ScheduleEnableArgs::NAME, "schedule.enable");
        assert_eq!(ScheduleDisableArgs::NAME, "schedule.disable");
        assert_eq!(ScheduleRunArgs::NAME, "schedule.run");
    }

    #[test]
    fn schedule_commands_wire_shape() {
        assert_matches_legacy(&ScheduleListArgs::default(), json!({}));
        assert_matches_legacy(&ScheduleListArgs { all: true }, json!({"all": true}));
        assert_matches_legacy(
            &ScheduleCreateArgs {
                prompt: "带身份证".into(),
                fire_at: Some("2026-10-20T20:00".into()),
                target: Some(ScheduleTarget::Assistant),
                supervisor: Some("galley-assistant".into()),
                ..ScheduleCreateArgs::default()
            },
            json!({"prompt": "带身份证", "fireAt": "2026-10-20T20:00", "target": "assistant",
                   "supervisor": "galley-assistant"}),
        );
        assert_matches_legacy(
            &ScheduleCreateArgs {
                prompt: "早报".into(),
                repeat: Some(ScheduledTaskRepeat::Weekly {
                    weekdays: vec![1, 5],
                }),
                time_of_day: Some("09:00".into()),
                ..ScheduleCreateArgs::default()
            },
            json!({"prompt": "早报", "repeat": {"kind": "weekly", "weekdays": [1, 5]},
                   "timeOfDay": "09:00"}),
        );
        assert_matches_legacy(
            &ScheduleUpdateArgs {
                task_id: "sched_1".into(),
                project_id: Some(String::new()),
                ..ScheduleUpdateArgs::default()
            },
            json!({"taskId": "sched_1", "projectId": ""}),
        );
        assert_matches_legacy(
            &ScheduleRunArgs {
                task_id: "sched_1".into(),
                supervisor: None,
                reason: Some("try it".into()),
            },
            json!({"taskId": "sched_1", "reason": "try it"}),
        );
    }
}
