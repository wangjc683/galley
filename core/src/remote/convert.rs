//! Core's types → the phone's (`galley_remote_protocol::app`, design §6.1:
//! the phone never sees a Core type serialized as it is).
//!
//! Every conversion destructures or names the Core fields it reads, so a
//! renamed Core field stops this file compiling instead of reaching the
//! phone as a silent `null`. What a phone type leaves out (runtime fields,
//! desktop paths, the legacy model index) is dropped here.

use crate::api::{
    AskUserBrief, MessageAttachmentBrief, MessageBrief, MessageRole, MessageTelemetry, Origin,
    OriginVia, ProjectBrief, QueuedMessage, SessionBrief, SessionStatus,
};
use crate::db::PersistedMessageRow;
use crate::runner_manager::{RunState, SessionRunStatePayload};
use crate::session_runner::{HistoryReplayPayload, HistoryReplayPhase};
use galley_remote_protocol::app as phone;
use serde_json::Value;

pub(super) fn session_status(status: SessionStatus) -> phone::SessionStatus {
    match status {
        SessionStatus::Idle => phone::SessionStatus::Idle,
        SessionStatus::Connecting => phone::SessionStatus::Connecting,
        SessionStatus::Running => phone::SessionStatus::Running,
        SessionStatus::WaitingApproval => phone::SessionStatus::WaitingApproval,
        SessionStatus::Error => phone::SessionStatus::Error,
        SessionStatus::Completed => phone::SessionStatus::Completed,
        SessionStatus::Cancelled => phone::SessionStatus::Cancelled,
        SessionStatus::Archived => phone::SessionStatus::Archived,
    }
}

fn origin_via(via: OriginVia) -> phone::OriginVia {
    match via {
        OriginVia::Gui => phone::OriginVia::Gui,
        OriginVia::Cli => phone::OriginVia::Cli,
        OriginVia::Supervisor => phone::OriginVia::Supervisor,
        OriginVia::System => phone::OriginVia::System,
    }
}

/// `Origin.client` is Core-internal (never serialized) and stays here.
pub(super) fn origin(origin: Origin) -> phone::Origin {
    let Origin {
        via,
        supervisor,
        reason,
        client: _,
    } = origin;
    phone::Origin {
        via: origin_via(via),
        supervisor,
        reason,
    }
}

/// A session row. Whether it is a managed session is the caller's check
/// (PRD ruling 18): the phone type has no runtime fields.
pub(super) fn session(brief: SessionBrief) -> phone::Session {
    let SessionBrief {
        id,
        project_id,
        title,
        status,
        summary,
        turn_count,
        last_activity_at,
        created_at,
        updated_at,
        pinned,
        has_unread,
        origin: session_origin,
        selected_llm_index: _,
        selected_llm_key,
        selected_llm_display_name,
        runtime_kind: _,
        runtime_label: _,
        ga_runtime_kind: _,
        ga_runtime_id: _,
        prompt_profile: _,
        reasoning_effort,
    } = brief;
    phone::Session {
        id: id.0,
        project_id,
        title,
        status: session_status(status),
        summary,
        turn_count,
        last_activity_at,
        created_at,
        updated_at,
        pinned,
        has_unread,
        origin: session_origin.map(origin),
        selected_llm_key,
        selected_llm_display_name,
        reasoning_effort,
    }
}

pub(super) fn project(brief: ProjectBrief) -> phone::Project {
    let ProjectBrief {
        id,
        name,
        root_path: _,
        workspace_enabled: _,
        icon,
        color,
        pinned,
        last_activity_at,
        created_at,
        updated_at,
    } = brief;
    phone::Project {
        id: id.0,
        name,
        icon,
        color,
        pinned,
        last_activity_at,
        created_at,
        updated_at,
    }
}

pub(super) fn run_state(session_id: &str, state: RunState) -> phone::SessionRunState {
    let RunState {
        runner_alive,
        agent_running,
        open_run,
        queued_count,
        ask_pending,
        last_exit,
    } = state;
    phone::SessionRunState {
        session_id: session_id.to_string(),
        runner_alive,
        agent_running,
        open_run,
        queued_count: u32::try_from(queued_count).unwrap_or(u32::MAX),
        ask_pending,
        last_exit,
    }
}

fn message_role(role: MessageRole) -> phone::MessageRole {
    match role {
        MessageRole::User => phone::MessageRole::User,
        MessageRole::Agent => phone::MessageRole::Agent,
        MessageRole::System => phone::MessageRole::System,
    }
}

/// A persisted row's `role` column: `assistant` and `tool` rows are the
/// agent's, as `MessageBrief` reads them (`db::helpers::parse_message_role`).
fn stored_role(role: &str) -> phone::MessageRole {
    match role {
        "user" => phone::MessageRole::User,
        "assistant" | "tool" => phone::MessageRole::Agent,
        "system" => phone::MessageRole::System,
        _ => phone::MessageRole::Unknown,
    }
}

fn ask_user(ask: AskUserBrief) -> phone::AskUser {
    let AskUserBrief {
        question,
        candidates,
    } = ask;
    phone::AskUser {
        question,
        candidates,
    }
}

fn telemetry(telemetry: MessageTelemetry) -> phone::MessageTelemetry {
    let MessageTelemetry {
        elapsed_ms,
        input_tokens,
        output_tokens,
        cache_create_tokens,
        cache_read_tokens,
        request_count,
        context_used_chars,
        context_limit_chars,
    } = telemetry;
    phone::MessageTelemetry {
        elapsed_ms,
        input_tokens,
        output_tokens,
        cache_create_tokens,
        cache_read_tokens,
        request_count,
        context_used_chars,
        context_limit_chars,
    }
}

/// The desktop `path` stays on the desktop; the phone reads the bytes
/// with `attachment.read`.
fn attachment(attachment: MessageAttachmentBrief) -> phone::Attachment {
    let MessageAttachmentBrief {
        id,
        message_id,
        session_id,
        kind,
        path: _,
        mime_type,
        byte_size,
        width,
        height,
        created_at,
    } = attachment;
    phone::Attachment {
        id,
        message_id: message_id.0,
        session_id: session_id.0,
        kind,
        mime_type,
        byte_size,
        width,
        height,
        created_at,
    }
}

/// A stored `tool_calls` / `tool_results` column, parsed for pass-through
/// (design §6.6). A value that is not JSON — never written by Core — is
/// left out rather than handed over as a string the phone cannot read.
fn stored_json(raw: Option<&str>) -> Option<Value> {
    raw.and_then(|raw| serde_json::from_str(raw).ok())
}

/// A stored `created_via` with its supervisor and note, as the phone's
/// origin; `None` for rows older than the origin columns.
fn stored_origin(
    created_via: Option<String>,
    supervisor: Option<String>,
    note: Option<String>,
) -> Option<phone::Origin> {
    let via = created_via?;
    Some(phone::Origin {
        via: serde_json::from_value(Value::String(via)).unwrap_or(phone::OriginVia::Unknown),
        supervisor,
        reason: note,
    })
}

/// One `session.messages` row (Core `PersistedMessageRow`).
pub(super) fn persisted_message(row: PersistedMessageRow) -> phone::Message {
    let PersistedMessageRow {
        id,
        session_id,
        turn_index,
        sequence,
        role,
        content,
        tool_calls,
        tool_results,
        thinking,
        final_answer,
        summary,
        preamble,
        created_via,
        supervisor,
        origin_note,
        visibility: _,
        telemetry: row_telemetry,
        goal_id,
        created_at,
        attachments,
    } = row;
    let ask = tool_calls
        .as_deref()
        .and_then(AskUserBrief::from_tool_calls_json)
        .map(ask_user);
    phone::Message {
        id,
        session_id,
        role: stored_role(&role),
        content,
        turn_index: Some(turn_index),
        sequence: Some(sequence),
        final_answer,
        summary,
        thinking,
        preamble,
        tool_calls: stored_json(tool_calls.as_deref()),
        tool_results: stored_json(tool_results.as_deref()),
        ask_user: ask,
        telemetry: row_telemetry.map(telemetry),
        goal_id,
        origin: stored_origin(created_via, supervisor, origin_note),
        attachments: attachments.into_iter().map(attachment).collect(),
        created_at,
    }
}

/// A message as a send result or `user-message-persisted` carries it
/// (Core `MessageBrief`): no sequence, tool calls, thinking, preamble or
/// telemetry (05a's `Message` docs).
pub(super) fn brief_message(brief: MessageBrief) -> phone::Message {
    let MessageBrief {
        id,
        session_id,
        role,
        content,
        final_answer,
        created_at,
        summary,
        turn_index,
        visibility: _,
        goal_id,
        attachments,
        origin: message_origin,
        ask_user: ask,
    } = brief;
    phone::Message {
        id: id.0,
        session_id: session_id.0,
        role: message_role(role),
        content,
        turn_index: turn_index.map(i64::from),
        sequence: None,
        final_answer,
        summary,
        thinking: None,
        preamble: None,
        tool_calls: None,
        tool_results: None,
        ask_user: ask.map(ask_user),
        telemetry: None,
        goal_id,
        origin: message_origin.map(origin),
        attachments: attachments.into_iter().map(attachment).collect(),
        created_at,
    }
}

/// A queued item; its origin stays on the desktop.
pub(super) fn queued_message(item: QueuedMessage) -> phone::QueuedMessage {
    let QueuedMessage {
        queue_id,
        text,
        origin: _,
        queued_at,
    } = item;
    phone::QueuedMessage {
        queue_id,
        text,
        queued_at,
    }
}

/// `session-run-state` → `session.runState`.
pub(super) fn run_state_event(payload: SessionRunStatePayload) -> phone::SessionRunState {
    let SessionRunStatePayload {
        session_id,
        runner_alive,
        agent_running,
        open_run,
        queued_count,
        ask_pending,
        last_exit,
    } = payload;
    run_state(
        &session_id,
        RunState {
            runner_alive,
            agent_running,
            open_run,
            queued_count,
            ask_pending,
            last_exit,
        },
    )
}

/// `runner-history-replay` → `history.replay`.
pub(super) fn history_replay(payload: HistoryReplayPayload) -> phone::HistoryReplayEvent {
    let HistoryReplayPayload { session_id, phase } = payload;
    phone::HistoryReplayEvent {
        session_id,
        phase: match phase {
            HistoryReplayPhase::Started => phone::ReplayPhase::Started,
            HistoryReplayPhase::Done => phone::ReplayPhase::Done,
            HistoryReplayPhase::Failed => phone::ReplayPhase::Failed,
        },
    }
}

/// `user-message-persisted`'s `dispatch` (`pending` | `dispatched` |
/// `persisted_only`); a value this build does not know reads as `Unknown`.
pub(super) fn dispatch(value: String) -> phone::Dispatch {
    serde_json::from_value(Value::String(value)).unwrap_or(phone::Dispatch::Unknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{MessageId, ProjectId, RuntimeKind, SessionId};
    use serde_json::json;

    fn brief() -> SessionBrief {
        SessionBrief {
            id: SessionId("s-1".into()),
            project_id: Some("p-1".into()),
            title: "标题".into(),
            status: SessionStatus::Idle,
            summary: None,
            turn_count: Some(2),
            last_activity_at: "2026-10-10T00:00:00.000Z".into(),
            created_at: "2026-10-09T00:00:00.000Z".into(),
            updated_at: "2026-10-10T00:00:00.000Z".into(),
            pinned: Some(true),
            has_unread: None,
            origin: Some(Origin::gui()),
            selected_llm_index: Some(3),
            selected_llm_key: Some("m-1".into()),
            selected_llm_display_name: Some("Model".into()),
            runtime_kind: RuntimeKind::Managed,
            runtime_label: "Galley".into(),
            ga_runtime_kind: RuntimeKind::Managed,
            ga_runtime_id: Some("rt".into()),
            prompt_profile: Some("profile".into()),
            reasoning_effort: None,
        }
    }

    #[test]
    fn a_session_keeps_what_the_phone_shows_and_writes_nulls() {
        let value = serde_json::to_value(session(brief())).unwrap();
        assert_eq!(value["id"], "s-1");
        assert_eq!(value["turnCount"], 2);
        assert_eq!(
            value["origin"],
            json!({"via": "gui", "supervisor": null, "reason": null})
        );
        // Cleared fields are explicit nulls, runtime fields are gone.
        assert!(value["reasoningEffort"].is_null());
        assert!(value.as_object().unwrap().contains_key("hasUnread"));
        for gone in [
            "runtimeKind",
            "gaRuntimeKind",
            "selectedLlmIndex",
            "promptProfile",
        ] {
            assert!(value.get(gone).is_none(), "{gone}");
        }
    }

    #[test]
    fn a_project_drops_its_desktop_root() {
        let value = serde_json::to_value(project(ProjectBrief {
            id: ProjectId("p-1".into()),
            name: "项目".into(),
            root_path: Some("/Users/x/code".into()),
            workspace_enabled: true,
            icon: None,
            color: Some("blue".into()),
            pinned: false,
            last_activity_at: "a".into(),
            created_at: "b".into(),
            updated_at: "c".into(),
        }))
        .unwrap();
        assert_eq!(value["name"], "项目");
        assert!(value["icon"].is_null());
        assert!(value.get("rootPath").is_none());
        assert!(!value.to_string().contains("/Users/x"));
    }

    fn row(role: &str, tool_calls: Option<&str>) -> PersistedMessageRow {
        PersistedMessageRow {
            id: "m-1".into(),
            session_id: "s-1".into(),
            turn_index: 4,
            sequence: 1,
            role: role.into(),
            content: "c".into(),
            tool_calls: tool_calls.map(str::to_string),
            tool_results: Some("not json".into()),
            thinking: None,
            final_answer: Some("f".into()),
            summary: None,
            preamble: None,
            created_via: Some("supervisor".into()),
            supervisor: Some("ga-1".into()),
            origin_note: Some("why".into()),
            visibility: "visible".into(),
            telemetry: None,
            goal_id: None,
            created_at: "t".into(),
            attachments: vec![MessageAttachmentBrief {
                id: "att_m-1_0".into(),
                message_id: MessageId("m-1".into()),
                session_id: SessionId("s-1".into()),
                kind: "image".into(),
                path: "/Users/x/Library/attachment.png".into(),
                mime_type: "image/png".into(),
                byte_size: 9,
                width: Some(2),
                height: None,
                created_at: "t".into(),
            }],
        }
    }

    #[test]
    fn a_stored_row_parses_its_json_columns_and_hides_the_attachment_path() {
        let calls = r#"[{"toolName":"ask_user","args":{"question":"Q?","candidates":["a","b"]}}]"#;
        let message = persisted_message(row("assistant", Some(calls)));
        assert_eq!(message.role, phone::MessageRole::Agent);
        assert_eq!(message.sequence, Some(1));
        assert_eq!(
            message.tool_calls.as_ref().unwrap()[0]["toolName"],
            "ask_user"
        );
        // Unparseable stored JSON is left out.
        assert_eq!(message.tool_results, None);
        assert_eq!(
            message.ask_user,
            Some(phone::AskUser {
                question: "Q?".into(),
                candidates: vec!["a".into(), "b".into()],
            })
        );
        let origin = message.origin.clone().unwrap();
        assert_eq!(origin.via, phone::OriginVia::Supervisor);
        assert_eq!(origin.reason.as_deref(), Some("why"));
        let text = serde_json::to_string(&message).unwrap();
        assert!(!text.contains("/Users/x"), "{text}");
        assert_eq!(
            persisted_message(row("tool", None)).role,
            phone::MessageRole::Agent
        );
        assert_eq!(
            persisted_message(row("odd", None)).role,
            phone::MessageRole::Unknown
        );
    }
}
