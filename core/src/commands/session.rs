use super::*;
use base64::Engine as _;

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
    galley: State<'_, SqliteGalley>,
    filter: SessionFilter,
) -> std::result::Result<Vec<SessionBrief>, String> {
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
    galley: State<'_, SqliteGalley>,
    input: CreateSessionInput,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    galley
        .create_session(input, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn archive_session(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    galley
        .archive_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn unarchive_session(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    galley
        .unarchive_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn rename_session(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    title: String,
    origin: Origin,
    title_source: Option<String>,
) -> std::result::Result<SessionBrief, String> {
    // Only the GUI's first-message truncation may claim "derived" (it
    // stays auto-title-upgradable); everything else — including omitted —
    // is a user rename and locks the title.
    let source = match title_source.as_deref() {
        Some("derived") => crate::db::RenameTitleSource::Derived,
        _ => crate::db::RenameTitleSource::User,
    };
    galley
        .rename_session_with_source(id, title, source, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_session_pinned(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    pinned: bool,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    galley
        .set_session_pinned(id, pinned, origin)
        .await
        .map_err(stringify_error)
}

/// Persist the per-session reasoning-effort override, then push it to
/// the session's live runner if one exists. Galley Core owns both halves
/// (Rule 5): the GUI never talks to the bridge for this. A missing runner
/// is not an error — the next spawn reads the column
/// (`SpawnArgs::reasoning_effort`). A forward failure is logged, not
/// rolled back: the DB is authoritative and the runner catches up on
/// its next spawn.
#[tauri::command]
pub(crate) async fn set_session_reasoning_effort(
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<crate::runner_manager::RunnerManager>>,
    id: SessionId,
    value: Option<String>,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    let brief = galley
        .set_session_reasoning_effort(id.clone(), value, origin)
        .await
        .map_err(stringify_error)?;
    if manager.pid(id.as_str()).await.is_some() {
        let cmd =
            crate::ipc::IpcCommand::SetReasoningEffort(crate::ipc::SetReasoningEffortCommand {
                value: brief.reasoning_effort.clone(),
            });
        if let Err(e) = manager.send_command(id.as_str(), &cmd).await {
            eprintln!(
                "[reasoning-effort] forward to runner {} failed (DB kept): {e}",
                id.as_str()
            );
        }
    }
    Ok(brief)
}

#[tauri::command]
pub(crate) async fn delete_session(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    origin: Origin,
) -> std::result::Result<(), String> {
    galley
        .delete_session(id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn assign_session_to_project(
    galley: State<'_, SqliteGalley>,
    session_id: SessionId,
    project_id: Option<String>,
    origin: Origin,
) -> std::result::Result<SessionBrief, String> {
    galley
        .assign_session_to_project(session_id, project_id, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_session_llm(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
    index: Option<u32>,
    key: Option<String>,
    display_name: Option<String>,
) -> std::result::Result<SessionBrief, String> {
    galley
        .set_session_llm(id, index, key, display_name)
        .await
        .map_err(stringify_error)
}

/// Unread is the GUI's half of a turn: Core writes the row and the
/// session bump itself (`crate::turn_persistence`), the GUI flags the
/// reply unread when its session is not on screen.
#[tauri::command]
pub(crate) async fn mark_session_unread(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
) -> std::result::Result<(), String> {
    galley
        .mark_session_unread(id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn clear_session_unread(
    galley: State<'_, SqliteGalley>,
    id: SessionId,
) -> std::result::Result<(), String> {
    galley
        .clear_session_unread(id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn session_message_rows(
    galley: State<'_, SqliteGalley>,
    session_id: SessionId,
) -> std::result::Result<Vec<PersistedMessageRow>, String> {
    galley
        .persisted_message_rows(&session_id)
        .await
        .map_err(stringify_error)
}

/// One image of a user message as the page sends it: a base64 `data:`
/// URL plus the dimensions it measured (`send_user_message`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistUserMessageAttachmentInput {
    data_url: String,
    width: Option<u32>,
    height: Option<u32>,
}

/// Decode a message's images, enforcing the per-message limits (count,
/// per-image and total size, PNG / JPEG / WebP only).
pub(crate) fn decode_message_attachments(
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

#[tauri::command]
pub(crate) async fn delete_empty_new_sessions(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<u32, String> {
    galley
        .delete_empty_new_sessions()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn delete_demo_sessions(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<u32, String> {
    galley.delete_demo_sessions().await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn backfill_fts_if_empty(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<u32, String> {
    galley
        .backfill_fts_if_empty()
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn search_messages(
    galley: State<'_, SqliteGalley>,
    query: String,
    limit: u32,
    runtime_kind: Option<RuntimeKind>,
) -> std::result::Result<Vec<MessageSearchHit>, String> {
    galley
        .search_message_hits(query, limit, runtime_kind)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn get_pref_json(
    galley: State<'_, SqliteGalley>,
    key: String,
) -> std::result::Result<Option<serde_json::Value>, String> {
    galley.get_pref_json(&key).await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn set_pref_json(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    key: String,
    value: serde_json::Value,
) -> std::result::Result<(), String> {
    galley
        .set_pref_json(&key, value)
        .await
        .map_err(stringify_error)?;
    // A runtime switch is only this pref write (GUI Settings / onboarding),
    // so this is where the resident browser bridge follows it: started for
    // managed, stopped for external (Rule 1).
    if key == browser_bridge::ACTIVE_RUNTIME_KIND_PREF {
        use tauri::Manager;
        if let Some(bridge) =
            app.try_state::<std::sync::Arc<browser_bridge::BrowserBridgeManager>>()
        {
            let bridge = bridge.inner().clone();
            tauri::async_runtime::spawn(async move {
                bridge.reconcile(app).await;
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn bulk_archive_sessions(
    galley: State<'_, SqliteGalley>,
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    galley
        .bulk_archive_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bulk_unarchive_sessions(
    galley: State<'_, SqliteGalley>,
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    galley
        .bulk_unarchive_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn bulk_delete_sessions(
    galley: State<'_, SqliteGalley>,
    ids: Vec<SessionId>,
    origin: Origin,
) -> std::result::Result<u32, String> {
    galley
        .bulk_delete_sessions(ids, origin)
        .await
        .map_err(stringify_error)
}
