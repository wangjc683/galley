use super::*;
use base64::Engine as _;
use tauri::Emitter;

const MAX_MESSAGE_IMAGES: usize = 4;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// B1 M3 read — first GalleyApi method exposed through the Tauri
/// invoke transport. Validates the end-to-end path
/// (GUI → Tauri invoke → Rust core → SQLite). Used as the migration
/// template for B2/B3 (gui/src/lib/db.ts `loadSessions` → `loadSessionsViaCore`).
///
/// Returns `(SessionBrief[])` on success and a JSON-stringified
/// [`crate::error::GalleyError`] on failure. The error shape matches
/// the CLI agent-api.md schema (B1 M5) so all transports surface the
/// same `error: <category>` discriminant.
#[tauri::command]
pub(crate) async fn list_sessions(
    filter: SessionFilter,
) -> std::result::Result<Vec<SessionBrief>, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley.list_sessions(filter).await.map_err(stringify_error)
}

// ============= B3 M4a · session/project CRUD Tauri commands =============
//
// Each command is a thin wrapper around the matching `GalleyApi` trait
// method:
//   1. open the Sqlite pool (lazy — `SqliteGalley::open` is cheap; the
//      pool is internally Arc-shared and re-used);
//   2. forward the args;
//   3. stringify the `GalleyError` envelope for the invoke wire.
//
// The GUI routes through these commands instead of opening SQLite
// directly; CLI/socket transports wrap the same Core layer.

#[tauri::command]
pub(crate) async fn create_session(
    input: CreateSessionInput,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .create_session(input, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn archive_session(
    id: SessionId,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .archive_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn unarchive_session(
    id: SessionId,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .unarchive_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn rename_session(
    id: SessionId,
    title: String,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .rename_session(id, title, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_session_pinned(
    id: SessionId,
    pinned: bool,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .set_session_pinned(id, pinned, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn delete_session(
    id: SessionId,
    origin: Origin,
) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .delete_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn assign_session_to_project(
    session_id: SessionId,
    project_id: Option<String>,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .assign_session_to_project(session_id, project_id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_session_llm(
    id: SessionId,
    index: Option<u32>,
    key: Option<String>,
    display_name: Option<String>,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .set_session_llm(id, index, key, display_name)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bump_session_after_turn(
    id: SessionId,
    summary: Option<String>,
    step_number: Option<u32>,
    mark_unread: bool,
) -> std::result::Result<SessionBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .bump_session_after_turn(id, summary, step_number, mark_unread)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn clear_session_unread(id: SessionId) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .clear_session_unread(id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn session_message_rows(
    session_id: SessionId,
) -> std::result::Result<Vec<PersistedMessageRow>, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .persisted_message_rows(&session_id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn persist_user_message(
    session_id: SessionId,
    content: String,
    origin: Origin,
    attachments: Option<Vec<PersistUserMessageAttachmentInput>>,
) -> std::result::Result<api::MessageBrief, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    let attachments =
        decode_message_attachments(attachments.unwrap_or_default()).map_err(stringify_error)?;
    galley
        .send_message_with_attachments_db(session_id, content, origin, attachments)
        .await
        .map_err(stringify_error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistUserMessageAttachmentInput {
    data_url: String,
    width: Option<u32>,
    height: Option<u32>,
}

fn decode_message_attachments(
    inputs: Vec<PersistUserMessageAttachmentInput>,
) -> error::Result<Vec<MessageAttachmentCreate>> {
    if inputs.len() > MAX_MESSAGE_IMAGES {
        return Err(error::GalleyError::InvalidArgs {
            message: format!("too many images: max {MAX_MESSAGE_IMAGES}"),
        });
    }
    let mut total = 0usize;
    let mut decoded = Vec::with_capacity(inputs.len());
    for input in inputs {
        let (mime_type, encoded) = parse_image_data_url(&input.data_url)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| error::GalleyError::InvalidArgs {
                message: format!("invalid image data: {e}"),
            })?;
        if bytes.is_empty() {
            return Err(error::GalleyError::InvalidArgs {
                message: "image data is empty".into(),
            });
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(error::GalleyError::InvalidArgs {
                message: format!("image too large: max {} MB", MAX_IMAGE_BYTES / 1024 / 1024),
            });
        }
        total = total.saturating_add(bytes.len());
        if total > MAX_MESSAGE_IMAGE_BYTES {
            return Err(error::GalleyError::InvalidArgs {
                message: format!(
                    "message images too large: max {} MB total",
                    MAX_MESSAGE_IMAGE_BYTES / 1024 / 1024
                ),
            });
        }
        decoded.push(MessageAttachmentCreate {
            mime_type,
            bytes,
            width: input.width,
            height: input.height,
        });
    }
    Ok(decoded)
}

fn parse_image_data_url(data_url: &str) -> error::Result<(String, &str)> {
    let (header, encoded) =
        data_url
            .split_once(',')
            .ok_or_else(|| error::GalleyError::InvalidArgs {
                message: "image data URL is missing a base64 payload".into(),
            })?;
    let Some(meta) = header.strip_prefix("data:") else {
        return Err(error::GalleyError::InvalidArgs {
            message: "image data URL must start with data:".into(),
        });
    };
    let mut parts = meta.split(';');
    let mime_type = parts.next().unwrap_or_default();
    if !matches!(mime_type, "image/png" | "image/jpeg" | "image/webp") {
        return Err(error::GalleyError::InvalidArgs {
            message: format!("unsupported image type: {mime_type}"),
        });
    }
    if !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return Err(error::GalleyError::InvalidArgs {
            message: "image data URL must be base64 encoded".into(),
        });
    }
    Ok((mime_type.to_string(), encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_input(data_url: &str) -> PersistUserMessageAttachmentInput {
        PersistUserMessageAttachmentInput {
            data_url: data_url.into(),
            width: Some(2),
            height: Some(1),
        }
    }

    #[test]
    fn decode_message_attachments_accepts_supported_image_data_url() {
        let decoded =
            decode_message_attachments(vec![image_input("data:image/png;base64,aGVsbG8=")])
                .expect("decode image attachment");

        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].mime_type, "image/png");
        assert_eq!(decoded[0].bytes, b"hello");
        assert_eq!(decoded[0].width, Some(2));
        assert_eq!(decoded[0].height, Some(1));
    }

    #[test]
    fn decode_message_attachments_rejects_unsupported_mime() {
        let err = decode_message_attachments(vec![image_input("data:image/gif;base64,aGVsbG8=")])
            .expect_err("reject gif");

        assert!(matches!(
            err,
            error::GalleyError::InvalidArgs { message } if message.contains("unsupported image type")
        ));
    }

    #[test]
    fn decode_message_attachments_rejects_invalid_base64() {
        let err = decode_message_attachments(vec![image_input("data:image/png;base64,not base64")])
            .expect_err("reject invalid base64");

        assert!(matches!(
            err,
            error::GalleyError::InvalidArgs { message } if message.contains("invalid image data")
        ));
    }

    #[test]
    fn decode_message_attachments_rejects_too_many_images() {
        let inputs = (0..=MAX_MESSAGE_IMAGES)
            .map(|_| image_input("data:image/png;base64,aA=="))
            .collect();
        let err = decode_message_attachments(inputs).expect_err("reject too many images");

        assert!(matches!(
            err,
            error::GalleyError::InvalidArgs { message } if message.contains("too many images")
        ));
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistAssistantMessageInput {
    session_id: SessionId,
    turn_index: u32,
    content: String,
    tool_calls: Option<String>,
    tool_results: Option<String>,
    thinking: Option<String>,
    final_answer: Option<String>,
    summary: Option<String>,
    preamble: Option<String>,
    visibility: Option<MessageVisibility>,
}

#[tauri::command]
pub(crate) async fn persist_assistant_message(
    input: PersistAssistantMessageInput,
) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .persist_gui_assistant_message(PersistAssistantMessage {
            session_id: input.session_id,
            turn_index: input.turn_index,
            content: input.content,
            tool_calls: input.tool_calls,
            tool_results: input.tool_results,
            thinking: input.thinking,
            final_answer: input.final_answer,
            summary: input.summary,
            preamble: input.preamble,
            visibility: input.visibility.unwrap_or(MessageVisibility::Visible),
        })
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn delete_empty_new_sessions() -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .delete_empty_new_sessions()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn delete_demo_sessions() -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley.delete_demo_sessions().await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn backfill_fts_if_empty() -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .backfill_fts_if_empty()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn search_messages(
    query: String,
    limit: u32,
    runtime_kind: Option<RuntimeKind>,
) -> std::result::Result<Vec<MessageSearchHit>, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .search_message_hits(query, limit, runtime_kind)
        .await
        .map_err(stringify_error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistToolEventPendingInput {
    approval_id: String,
    session_id: SessionId,
    turn_index: u32,
    tool_name: String,
    args: serde_json::Value,
    args_preview: String,
    risk_level: String,
    started_at: String,
}

#[tauri::command]
pub(crate) async fn persist_tool_event_pending(
    input: PersistToolEventPendingInput,
) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .persist_tool_event_pending(PersistToolEventPending {
            approval_id: input.approval_id,
            session_id: input.session_id,
            turn_index: input.turn_index,
            tool_name: input.tool_name,
            args: input.args,
            args_preview: input.args_preview,
            risk_level: input.risk_level,
            started_at: input.started_at,
        })
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn persist_tool_event_approval_decision(
    approval_id: String,
    decision: String,
    decided_at: String,
) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .persist_tool_event_approval_decision(&approval_id, &decision, &decided_at)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn load_tool_events_by_session(
    session_id: SessionId,
) -> std::result::Result<Vec<ToolEventRow>, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .tool_event_rows_by_session(&session_id)
        .await
        .map_err(stringify_error)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionRunTurnInput {
    session_id: SessionId,
    content: String,
    turn_index: u32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionRunTurnResult {
    session: SessionBrief,
    assistant_message: MessageBrief,
    dispatch: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeApprovalResponseInput {
    session_id: SessionId,
    approval_id: String,
    decision: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeApprovalResponseResult {
    session: SessionBrief,
    approval_id: String,
    decision: String,
    tool_result: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    assistant_message: Option<MessageBrief>,
    dispatch: &'static str,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionExternalPayload {
    session: SessionBrief,
    via: &'static str,
}

#[tauri::command]
pub(crate) async fn native_session_run_turn(
    app: tauri::AppHandle,
    input: NativeSessionRunTurnInput,
) -> std::result::Result<NativeSessionRunTurnResult, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    let session = galley
        .session_brief(input.session_id.clone())
        .await
        .map_err(stringify_error)?;
    if session.ga_runtime_kind != RuntimeKind::GalleyNative {
        return Err(stringify_error(crate::error::GalleyError::InvalidArgs {
            message: "native_session_run_turn supports only galley_native sessions".into(),
        }));
    }

    crate::native_runtime::event_bus().start_session(input.session_id.as_str());
    let model = match crate::native_model::load_selected_or_default_model(
        &galley,
        session.selected_llm_key.as_deref(),
    )
    .await
    {
        Ok(model) => model,
        Err(e) => {
            publish_native_gui_error(&app, input.session_id.as_str(), &e);
            return Err(stringify_error(e));
        }
    };
    let native_turn = match crate::native_runtime::run_turn(
        &galley,
        input.session_id.clone(),
        input.turn_index,
        &input.content,
        "gui.native_session_run_turn",
        false,
        model,
        native_host_context(Some(&app)),
    )
    .await
    {
        Ok(turn) => turn,
        Err(e) => {
            publish_native_gui_error(&app, input.session_id.as_str(), &e);
            return Err(stringify_error(e));
        }
    };
    if !native_turn.events_already_published {
        crate::native_runtime::event_bus()
            .publish_many(input.session_id.as_str(), &native_turn.events);
    }
    crate::native_runtime::event_bus()
        .close_session(input.session_id.as_str(), native_turn.close_reason.clone());
    emit_native_runtime_events(&app, &native_turn.events);
    emit_session_updated(&app, native_turn.session.clone(), "native_session_run_turn");
    Ok(NativeSessionRunTurnResult {
        session: native_turn.session,
        assistant_message: native_turn.assistant_message,
        dispatch: "completed_native",
    })
}

#[tauri::command]
pub(crate) async fn native_approval_response(
    app: tauri::AppHandle,
    input: NativeApprovalResponseInput,
) -> std::result::Result<NativeApprovalResponseResult, String> {
    let decision = input.decision.trim();
    if !matches!(
        decision,
        "allow_once" | "deny" | "always_allow_project" | "always_allow_global"
    ) {
        return Err(stringify_error(crate::error::GalleyError::InvalidArgs {
            message:
                "native_approval_response decision must be allow_once, deny, always_allow_project, or always_allow_global"
                    .into(),
        }));
    }
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    let session = galley
        .session_brief(input.session_id.clone())
        .await
        .map_err(stringify_error)?;
    if session.ga_runtime_kind != RuntimeKind::GalleyNative {
        return Err(stringify_error(crate::error::GalleyError::InvalidArgs {
            message: "native_approval_response supports only galley_native sessions".into(),
        }));
    }
    let resolution = crate::native_runtime::resolve_native_approval(
        &galley,
        input.session_id.clone(),
        &input.approval_id,
        decision,
        native_host_context(Some(&app)),
    )
    .await
    .map_err(stringify_error)?;
    crate::native_runtime::event_bus().start_session(input.session_id.as_str());
    crate::native_runtime::event_bus().publish_many(input.session_id.as_str(), &resolution.events);
    crate::native_runtime::event_bus()
        .close_session(input.session_id.as_str(), resolution.close_reason.clone());
    emit_native_runtime_events(&app, &resolution.events);
    emit_session_updated(&app, resolution.session.clone(), "native_approval_response");
    Ok(NativeApprovalResponseResult {
        session: resolution.session,
        approval_id: input.approval_id,
        decision: decision.to_string(),
        tool_result: resolution.tool_result,
        assistant_message: resolution.assistant_message,
        dispatch: "completed_native_approval",
    })
}

fn emit_native_runtime_events(
    app: &tauri::AppHandle,
    events: &[crate::native_runtime::NativeRuntimeEvent],
) {
    for event in events {
        let _ = app.emit("native-runtime-event", event);
    }
}

fn native_host_context(
    app: Option<&tauri::AppHandle>,
) -> crate::native_runtime::NativeRuntimeHostContext {
    let Some(app) = app else {
        return crate::native_runtime::NativeRuntimeHostContext::with_browser_unavailable(
            "Tauri app handle is unavailable",
        );
    };
    match crate::browser_control::native_execution_context_for_app(app) {
        Ok(browser) => crate::native_runtime::NativeRuntimeHostContext::with_browser(browser),
        Err(err) => crate::native_runtime::NativeRuntimeHostContext::with_browser_unavailable(
            err.to_string(),
        ),
    }
}

fn emit_session_updated(app: &tauri::AppHandle, session: SessionBrief, via: &'static str) {
    let _ = app.emit(
        "session-updated-external",
        SessionExternalPayload { session, via },
    );
}

fn publish_native_gui_error(
    app: &tauri::AppHandle,
    session_id: &str,
    error: &crate::error::GalleyError,
) {
    let event = crate::native_runtime::runtime_error_event(
        session_id,
        "runtime",
        error.to_string(),
        Some("Check the native model configuration and retry.".to_string()),
    );
    crate::native_runtime::event_bus().publish(session_id, event.clone());
    crate::native_runtime::event_bus().close_session(session_id, "native_runtime_error");
    let _ = app.emit("native-runtime-event", event);
}

#[tauri::command]
pub(crate) async fn get_pref_json(
    key: String,
) -> std::result::Result<Option<serde_json::Value>, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley.get_pref_json(&key).await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_pref_json(
    key: String,
    value: serde_json::Value,
) -> std::result::Result<(), String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .set_pref_json(&key, value)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bulk_archive_sessions(
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .bulk_archive_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bulk_unarchive_sessions(
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .bulk_unarchive_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bulk_delete_sessions(
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    galley
        .bulk_delete_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}
