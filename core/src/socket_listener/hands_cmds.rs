use super::common::{map_galley_err, origin_from_args};
use super::*;
use crate::api::{ProjectId, ProjectPatch, MANAGED_MODELS_CHANGED_EVENT, MANAGED_RUNTIME_ONLY};
use crate::protocol::{
    LlmSetDefaultArgs, ProjectArchiveSessionsArgs, ProjectPinArgs, ProjectUnpinArgs,
    ProjectUpdateArgs, SessionDeleteArgs, SessionPinArgs, SessionRenameArgs, SessionUnpinArgs,
};
use crate::session_writes::{refuse_main_chat, Writes};
use serde::de::DeserializeOwned;

// ---------------- the remaining hands (main chat ticket 35) ----------------
//
// What the desktop can do to sessions, projects and the default model that
// the CLI could not: `session rename / pin / unpin / delete`, `project
// update / pin / unpin / archive-sessions`, `llm set-default`. Each runs
// the Core function behind the desktop's own action — the session and
// project writes through Core's write path ([`Writes`], which broadcasts
// them), the default model through the model store's upsert and the
// config sync the desktop's model settings run. Every write takes
// `--supervisor` / `--reason`. The main chat cannot be renamed, pinned,
// unpinned or deleted ([`refuse_main_chat`], `main_chat_protected:`), and
// a project's archive leaves it alone.

/// How long a deleted session's runner gets to exit — the desktop's
/// fallback shutdown waits as long (`shutdownBridge`).
const DELETE_SHUTDOWN_GRACE: Duration = Duration::from_millis(3000);

fn parse<T: DeserializeOwned>(
    request_id: &Option<String>,
    args: Value,
    name: &str,
) -> Result<T, SocketResponse> {
    serde_json::from_value(args).map_err(|e| {
        SocketResponse::err(
            request_id.clone(),
            ErrorTag::InvalidArgs,
            format!("{name} args: {e}"),
        )
    })
}

async fn open(
    request_id: &Option<String>,
    ctx: &HandlerCtx<'_>,
) -> Result<SqliteGalley, SocketResponse> {
    ctx.db.get().await.map_err(|e| {
        SocketResponse::err(
            request_id.clone(),
            ErrorTag::DbUnavailable,
            format!("open: {e}"),
        )
    })
}

fn session_result(
    request_id: Option<String>,
    session: &crate::api::SessionBrief,
) -> SocketResponse {
    SocketResponse::ok(request_id, serde_json::json!({ "session": session }))
}

fn project_result(
    request_id: Option<String>,
    project: &crate::api::ProjectBrief,
) -> SocketResponse {
    SocketResponse::ok(request_id, serde_json::json!({ "project": project }))
}

// ---------------- sessions ----------------

/// `session.rename`: the desktop's rename (a user title, which the auto
/// title no longer replaces). An empty title gives the title back to
/// Galley — the creation default, which the auto title may replace again.
pub(super) async fn dispatch_session_rename(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionRenameArgs = match parse(&request_id, args, "session.rename") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let id = SessionId(parsed.session_id);
    if let Err(e) = refuse_main_chat(&galley, &id, "renamed").await {
        return map_galley_err(request_id, e);
    }
    match Writes::new(&galley, ctx.notifier.as_ref(), "session.rename")
        .rename_session(
            id,
            parsed.title,
            crate::db::RenameTitleSource::User,
            origin_from_args(parsed.supervisor, parsed.reason),
        )
        .await
    {
        Ok(brief) => session_result(request_id, &brief),
        Err(e) => map_galley_err(request_id, e),
    }
}

async fn set_session_pinned(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    session_id: String,
    pinned: bool,
    origin: Origin,
    via: &'static str,
) -> SocketResponse {
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let id = SessionId(session_id);
    let action = if pinned { "pinned" } else { "unpinned" };
    if let Err(e) = refuse_main_chat(&galley, &id, action).await {
        return map_galley_err(request_id, e);
    }
    match Writes::new(&galley, ctx.notifier.as_ref(), via)
        .set_session_pinned(id, pinned, origin)
        .await
    {
        Ok(brief) => session_result(request_id, &brief),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_session_pin(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionPinArgs = match parse(&request_id, args, "session.pin") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    set_session_pinned(
        request_id,
        ctx,
        parsed.session_id,
        true,
        origin,
        "session.pin",
    )
    .await
}

pub(super) async fn dispatch_session_unpin(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionUnpinArgs = match parse(&request_id, args, "session.unpin") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    set_session_pinned(
        request_id,
        ctx,
        parsed.session_id,
        false,
        origin,
        "session.unpin",
    )
    .await
}

/// `session.delete`: what the desktop's 永久删除 does, as one command —
/// shut the session's runner down (best effort; none is fine), then delete
/// the session with its messages, search rows and attachments
/// (`session-deleted-external`). Any session, archived or not; Core does
/// not check that the user agreed (the assistant's manual asks first).
pub(super) async fn dispatch_session_delete(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionDeleteArgs = match parse(&request_id, args, "session.delete") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let id = SessionId(parsed.session_id);
    // Refuse and look up before anything stops: a refused or unknown id
    // must leave every runner alone.
    if let Err(e) = refuse_main_chat(&galley, &id, "deleted").await {
        return map_galley_err(request_id, e);
    }
    if let Err(e) = galley.session_brief(id.clone()).await {
        return map_galley_err(request_id, e);
    }
    match ctx
        .runner
        .shutdown(id.as_str(), Some(DELETE_SHUTDOWN_GRACE))
        .await
    {
        Ok(()) | Err(ShutdownError::NotFound { .. }) => {}
        Err(e) => eprintln!("[session.delete {id}] runner shutdown failed (deleting anyway): {e}"),
    }
    match Writes::new(&galley, ctx.notifier.as_ref(), "session.delete")
        .protecting_main_chat()
        .delete_session(
            id.clone(),
            origin_from_args(parsed.supervisor, parsed.reason),
        )
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({ "deleted": true, "sessionId": id.0 }),
        ),
        Err(e) => map_galley_err(request_id, e),
    }
}

// ---------------- projects ----------------

/// An empty value clears a nullable field; absence leaves it alone.
fn clearable(value: Option<String>) -> Option<Option<String>> {
    value.map(|v| {
        let t = v.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

/// `project.update`: name, icon, colour — only the fields given change
/// (the desktop's `update_project`). An empty name is refused; an empty
/// icon or colour clears it.
pub(super) async fn dispatch_project_update(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectUpdateArgs = match parse(&request_id, args, "project.update") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    if parsed.name.is_none() && parsed.icon.is_none() && parsed.color.is_none() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "project.update: give at least one of name (--name), icon (--icon), color (--color)",
        );
    }
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let patch = ProjectPatch {
        name: parsed.name,
        icon: clearable(parsed.icon),
        color: clearable(parsed.color),
        ..ProjectPatch::default()
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), "project.update")
        .update_project(
            ProjectId(parsed.project_id),
            patch,
            origin_from_args(parsed.supervisor, parsed.reason),
        )
        .await
    {
        Ok(brief) => project_result(request_id, &brief),
        Err(e) => map_galley_err(request_id, e),
    }
}

async fn set_project_pinned(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    project_id: String,
    pinned: bool,
    origin: Origin,
    via: &'static str,
) -> SocketResponse {
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let patch = ProjectPatch {
        pinned: Some(pinned),
        ..ProjectPatch::default()
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), via)
        .update_project(ProjectId(project_id), patch, origin)
        .await
    {
        Ok(brief) => project_result(request_id, &brief),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_project_pin(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectPinArgs = match parse(&request_id, args, "project.pin") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    set_project_pinned(
        request_id,
        ctx,
        parsed.project_id,
        true,
        origin,
        "project.pin",
    )
    .await
}

pub(super) async fn dispatch_project_unpin(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectUnpinArgs = match parse(&request_id, args, "project.unpin") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    set_project_pinned(
        request_id,
        ctx,
        parsed.project_id,
        false,
        origin,
        "project.unpin",
    )
    .await
}

/// `project.archive_sessions`: the desktop's 「归档全部对话」
/// ([`Writes::archive_project_sessions`]). The project itself stays.
pub(super) async fn dispatch_project_archive_sessions(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectArchiveSessionsArgs =
        match parse(&request_id, args, "project.archive_sessions") {
            Ok(a) => a,
            Err(resp) => return resp,
        };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let project_id = parsed.project_id.clone();
    match Writes::new(&galley, ctx.notifier.as_ref(), "project.archive_sessions")
        .protecting_main_chat()
        .archive_project_sessions(
            ProjectId(parsed.project_id),
            origin_from_args(parsed.supervisor, parsed.reason),
        )
        .await
    {
        Ok(rows) => {
            let ids: Vec<String> = rows.into_iter().map(|s| s.id.0).collect();
            SocketResponse::ok(
                request_id,
                serde_json::json!({
                    "projectId": project_id,
                    "archivedSessions": ids.len(),
                    "archivedSessionIds": ids,
                }),
            )
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

// ---------------- the default model ----------------

/// `llm.set_default`: make a managed model the default — Settings >
/// Models 「设为默认（移到顶部）」 — by any name `llm list
/// --runtime=managed` prints (or its provider model id), the names
/// `llm set` resolves. Managed runtime only (`managed_runtime_only:`): an
/// attached GenericAgent's default is the first model of its own config,
/// which Galley does not write. After a change Core rewrites the managed
/// runtime's generated config as after any model save, and tells the
/// desktop to re-list its models (`managed-models:changed`).
pub(super) async fn dispatch_llm_set_default(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: LlmSetDefaultArgs = match parse(&request_id, args, "llm.set_default") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match galley.active_runtime_kind().await {
        Ok(RuntimeKind::Managed) => {}
        Ok(RuntimeKind::External) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!(
                    "{MANAGED_RUNTIME_ONLY}: llm.set_default: the active runtime is an attached \
                     GenericAgent, whose default model is the first one in its own config; \
                     Galley does not change it"
                ),
            )
        }
        Err(e) => return map_galley_err(request_id, e),
    }
    // Origin is accepted like every write's; the model store keeps none.
    let _ = (parsed.supervisor, parsed.reason);
    let selection =
        match resolve_llm_selection(&galley, Some(parsed.llm_name.clone()), RuntimeKind::Managed)
            .await
        {
            Ok(selection) => selection,
            Err(resp) => return resp.with_request_id(request_id),
        };
    let Some(key) = selection.key else {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "llm.set_default: llm name resolved to no model",
        );
    };
    let changed = match galley.set_default_managed_model(&key).await {
        Ok(changed) => changed,
        Err(e) => return map_galley_err(request_id, e),
    };
    if changed {
        // The store changed: the desktop re-lists whatever happens next.
        ctx.notify(MANAGED_MODELS_CHANGED_EVENT, &());
        if let Some(app) = ctx.app {
            if let Err(e) = crate::managed_model_config::sync_for_app(app, &galley).await {
                let message = match e {
                    crate::managed_model_config::ConfigSyncError::Layout(e) => e.to_string(),
                    crate::managed_model_config::ConfigSyncError::Store(e) => e.to_string(),
                };
                return SocketResponse::err(
                    request_id,
                    ErrorTag::Internal,
                    format!(
                        "llm.set_default: the default changed, but the runtime config was not \
                         rewritten: {message}"
                    ),
                );
            }
        }
    }
    let choices = match galley.list_managed_llm_choices().await {
        Ok(choices) => choices,
        Err(e) => return map_galley_err(request_id, e),
    };
    let Some(first) = choices.into_iter().next() else {
        return SocketResponse::err(
            request_id,
            ErrorTag::Internal,
            "llm.set_default: the model list is empty after the write",
        );
    };
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "llm": {
                "index": first.index,
                "name": first.display_name,
                "key": first.key,
                "displayName": first.display_name,
                "isCurrent": true,
            },
            "changed": changed,
        }),
    )
}
