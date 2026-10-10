use super::common::{map_galley_err, SocketResponseLite};
use super::*;
use crate::session_writes::Writes;

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
    }
}

/// Look up an external `--llm=<display-name>` against the cached `llm_list`
/// pref (what `galley llm list --runtime=external` prints). Matches the
/// entry's `name` or `displayName`, case-insensitively. The stable key is
/// the cached `key`, else the raw GA LLM name, else the display name for
/// old cache entries.
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
            "external llm cache empty; open an attached-GenericAgent session once to warm it up",
        ));
    }
    if let Some(index) = entries.iter().position(|e| e.label().is_none()) {
        return Err(SocketResponseLite::invalid_args(format!(
            "llm_list pref shape mismatch: entry {index} has neither name nor displayName"
        )));
    }
    let target = name.to_lowercase();
    if let Some(entry) = entries.iter().find(|e| e.matches(&target)) {
        let label = entry.label().unwrap_or_default().to_string();
        Ok(ResolvedLlmSelection {
            index: Some(entry.index),
            key: Some(
                entry
                    .key
                    .clone()
                    .or_else(|| entry.name.clone())
                    .unwrap_or_else(|| label.clone()),
            ),
            display_name: Some(label),
        })
    } else {
        Err(SocketResponseLite::invalid_args(format!(
            "unknown llm '{name}'; try `galley llm list --runtime=external` to see available"
        )))
    }
}

/// One entry of the `llm_list` pref the GUI caches after an external-GA
/// bridge warmup. Current GUIs write both `name` (the raw GA LLM name) and
/// `displayName`; older caches carried `displayName` only. They are two
/// separate optional fields on purpose: a `name` field with
/// `alias = "displayName"` rejects every current cache with serde's
/// `duplicate field` error, because both keys are present.
#[derive(Debug, Deserialize)]
pub(super) struct LlmListEntry {
    pub(super) index: u32,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default, rename = "displayName")]
    pub(super) display_name: Option<String>,
    #[serde(default)]
    key: Option<String>,
}

impl LlmListEntry {
    /// The name an entry is shown and persisted by: `displayName`, else the
    /// raw `name`. `None` when the entry carries neither (schema drift).
    pub(super) fn label(&self) -> Option<&str> {
        [&self.display_name, &self.name]
            .into_iter()
            .flatten()
            .map(|s| s.trim())
            .find(|s| !s.is_empty())
    }

    /// Case-insensitive match against either name; `target` is lowercase.
    fn matches(&self, target: &str) -> bool {
        [&self.name, &self.display_name]
            .into_iter()
            .flatten()
            .any(|s| s.trim().to_lowercase() == target)
    }
}

/// Resolve a managed `--llm=<name>` against the Galley model store. The
/// candidate set, order, index and display names come from
/// `SqliteGalley::list_managed_llm_choices` — the same enumeration
/// `galley llm list --runtime=managed` prints — so every listed name
/// resolves here. The provider model id is accepted as an alias.
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
    let choices = match galley.list_managed_llm_choices().await {
        Ok(choices) => choices,
        Err(e) => return Err(SocketResponseLite::from_err(e)),
    };
    let target = name.to_lowercase();
    if let Some(choice) = choices.into_iter().find(|choice| {
        choice.display_name.to_lowercase() == target || choice.model.to_lowercase() == target
    }) {
        return Ok(ResolvedLlmSelection {
            index: Some(choice.index),
            key: Some(choice.key),
            display_name: Some(choice.display_name),
        });
    }
    Err(SocketResponseLite::invalid_args(format!(
        "unknown managed llm '{name}'; configure it in Settings > Models"
    )))
}

/// Persist a session's per-bridge LLM choice + best-effort dispatch
/// `SetLlm` to any live runner. Two-step semantics mirror `session.send`:
/// the DB row is the source of truth; runner dispatch is opportunistic.
/// `dispatch` field in the response tells the caller which path ran.
///
/// The write and its `session-updated-external` broadcast go through
/// Core's write path ([`Writes::set_session_llm`], ticket 02d), shared
/// with the GUI's `set_session_llm`; since then the broadcast precedes the
/// dispatch and also goes out when the dispatch fails — the row changed
/// either way. The response is unchanged.
pub(super) async fn dispatch_llm_set(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: LlmSetArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("llm.set args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
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
            ErrorTag::InvalidArgs,
            "llm.set: llm name resolved to empty (cache shape unexpected)",
        );
    };

    let brief = match Writes::new(&galley, ctx.notifier.as_ref(), "llm.set")
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
    let dispatch_status = match ctx
        .runner
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
                ErrorTag::RunnerError,
                format!("llm.set runner dispatch: {e}"),
            );
        }
    };

    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "session": brief,
            "dispatch": dispatch_status,
        }),
    )
}
