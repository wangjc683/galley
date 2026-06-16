use super::common::{SocketResponseLite, map_galley_err};
use super::session_cmds::SessionExternalPayload;
use super::*;

pub(crate) struct ResolvedLlmSelection {
    pub(crate) index: Option<u32>,
    pub(crate) key: Option<String>,
    pub(crate) display_name: Option<String>,
}

/// Crate-visible by-name LLM resolution for callers outside the socket
/// layer (e.g. `start_desktop_goal` applying the launch model to the
/// goal's master session). Maps the internal `SocketResponseLite` error
/// back to `GalleyError` so non-socket callers get a normal error.
pub(crate) async fn resolve_llm_selection_for_runtime(
    galley: &SqliteGalley,
    name: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<ResolvedLlmSelection, crate::error::GalleyError> {
    resolve_llm_selection(galley, name, runtime_kind)
        .await
        .map_err(SocketResponseLite::into_galley_error)
}

pub(super) async fn resolve_llm_selection(
    galley: &SqliteGalley,
    name: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    match runtime_kind {
        RuntimeKind::Managed => resolve_managed_llm_name(galley, name).await,
        RuntimeKind::External => resolve_external_llm_name(galley, name).await,
        RuntimeKind::GalleyNative => Err(SocketResponseLite::from_err(
            crate::runtime::ensure_runtime_execution_available(runtime_kind)
                .expect_err("native model adapter is unavailable in Slice 1"),
        )),
    }
}

/// Look up an external `--llm=<display-name>` against the cached `llm_list`
/// pref. The stable key is the raw GA LLM name, falling back to display name
/// for old cache entries.
async fn resolve_external_llm_name(
    galley: &SqliteGalley,
    name: Option<String>,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    let Some(name) = name else {
        return Ok(ResolvedLlmSelection {
            index: None,
            key: None,
            display_name: None,
        });
    };
    let cached = match galley.get_pref_json("llm_list").await {
        Ok(v) => v,
        Err(e) => return Err(SocketResponseLite::from_err(e)),
    };
    let entries: Vec<LlmListEntry> = match cached {
        Some(v) => match serde_json::from_value(v) {
            Ok(es) => es,
            Err(e) => {
                return Err(SocketResponseLite::invalid_args(format!(
                    "llm_list pref shape mismatch: {e}"
                )));
            }
        },
        None => Vec::new(),
    };
    if entries.is_empty() {
        return Err(SocketResponseLite::invalid_args(
            "llm cache empty; open Galley GUI once to warmup",
        ));
    }
    let target = name.to_lowercase();
    if let Some(entry) = entries.iter().find(|e| e.name.to_lowercase() == target) {
        Ok(ResolvedLlmSelection {
            index: Some(entry.index),
            key: Some(entry.key.clone().unwrap_or_else(|| entry.name.clone())),
            display_name: Some(entry.name.clone()),
        })
    } else {
        Err(SocketResponseLite::invalid_args(format!(
            "unknown llm '{name}'; try `galley llm list` to see available"
        )))
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct LlmListEntry {
    pub(super) index: u32,
    #[serde(alias = "displayName")]
    pub(super) name: String,
    #[serde(default)]
    key: Option<String>,
}

async fn resolve_managed_llm_name(
    galley: &SqliteGalley,
    name: Option<String>,
) -> Result<ResolvedLlmSelection, SocketResponseLite> {
    let Some(name) = name else {
        return Ok(ResolvedLlmSelection {
            index: None,
            key: None,
            display_name: None,
        });
    };
    let models = match galley.list_managed_models().await {
        Ok(models) => models,
        Err(e) => return Err(SocketResponseLite::from_err(e)),
    };
    let target = name.to_lowercase();
    let mut index = 0_u32;
    for model in models {
        if model.credential_status == ManagedModelCredentialStatus::Missing {
            continue;
        }
        let display_name = managed_model_display_name(&model.display_name, &model.model);
        if display_name.to_lowercase() == target || model.model.to_lowercase() == target {
            return Ok(ResolvedLlmSelection {
                index: Some(index),
                key: Some(model.id),
                display_name: Some(display_name),
            });
        }
        index += 1;
    }
    Err(SocketResponseLite::invalid_args(format!(
        "unknown managed llm '{name}'; configure it in Settings > Models"
    )))
}

fn managed_model_display_name(display_name: &str, model: &str) -> String {
    let trimmed = display_name.trim();
    if trimmed.is_empty() {
        model.to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmSetArgs {
    session_id: String,
    llm_name: String,
}

/// Persist a session's per-bridge LLM choice + best-effort dispatch
/// `SetLlm` to any live runner. Two-step semantics mirror `session.send`:
/// the DB row is the source of truth; runner dispatch is opportunistic.
/// `dispatch` field in the response tells the caller which path ran.
pub(super) async fn dispatch_llm_set(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: LlmSetArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(request_id, "invalid_args", format!("llm.set args: {e}"));
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    // 1. Validate the session exists and use its runtime mode to resolve the
    //    display name against the correct model source.
    let sid = SessionId(parsed.session_id.clone());
    let session = match galley.session_brief(sid.clone()).await {
        Ok(session) => session,
        Err(e) => return map_galley_err(request_id, e),
    };
    let selection = match resolve_llm_selection(
        &galley,
        Some(parsed.llm_name.clone()),
        session.ga_runtime_kind,
    )
    .await
    {
        Ok(selection) => selection,
        Err(resp) => return resp.with_request_id(request_id),
    };
    let (Some(index), Some(display_name)) = (selection.index, selection.display_name.clone())
    else {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "llm.set: llm name resolved to empty (cache shape unexpected)",
        );
    };

    let brief = match galley
        .set_session_llm(
            sid,
            Some(index),
            selection.key.clone(),
            Some(display_name.clone()),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    // 3. Best-effort: tell any live runner the new pick. Drop the
    //    galley handle first so the manager's lock acquisition doesn't
    //    serialize against an unrelated SqliteGalley reference.
    drop(galley);
    let dispatch_status = match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::SetLlm(SetLlmCommand {
                llm_index: index as i64,
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(SendCommandError::ProcessGone { .. }) => "persisted_only",
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("llm.set runner dispatch: {e}"),
            );
        }
    };

    // 4. Mirror to GUI so the Composer pill / Inspector reflect the
    //    new persisted choice. Reuses the session-updated channel that
    //    the M1.2 listener handles via `applyExternalSessionUpdated`.
    if let Some(app) = app {
        let _ = app.emit(
            "session-updated-external",
            SessionExternalPayload {
                session: brief.clone(),
                via: "llm.set",
            },
        );
    }

    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "session": brief,
            "dispatch": dispatch_status,
        }),
    )
}
