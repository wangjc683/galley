use super::common::{map_galley_err, origin_from_args};
use super::*;
use crate::session_writes::Writes;

// ---------------- B4 M1.3 · project + llm write handlers ----------------
//
// The writes and their broadcasts (`project-created-external`,
// `project-deleted-external`) go through Core's write path
// ([`Writes`], ticket 02d), shared with the GUI's Tauri commands.

pub(super) async fn dispatch_project_create(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectCreateArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("project.create args: {e}"),
            );
        }
    };
    let name = parsed.name.trim().to_string();
    if name.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "project.create: name is empty",
        );
    }
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };

    let input = CreateProjectInput {
        id: mint_project_id(),
        name,
        root_path: parsed.root_path.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }),
        workspace_enabled: parsed.workspace_enabled,
        icon: parsed.icon,
        color: parsed.color,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);

    match Writes::new(&galley, ctx.notifier.as_ref(), "project.create")
        .create_project(input, origin)
        .await
    {
        Ok(brief) => SocketResponse::ok(request_id, serde_json::json!({ "project": brief })),
        Err(e) => map_galley_err(request_id, e),
    }
}

/// Destructive: removes the project row. FK CASCADE SET NULL detaches
/// child sessions to ungrouped — those rows survive but their
/// `project_id` flips to NULL. The CLI surface deliberately calls this
/// `delete` (not `archive`) per sub-plan O2 — the operation is
/// destructive and the naming should reflect that. A future v0.6+ may
/// ship a true reversible `project archive` alongside.
pub(super) async fn dispatch_project_delete(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ProjectDeleteArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("project.delete args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };

    // `detachedSessions` (the sessions FK SET NULL is about to detach,
    // listed before the delete) is surfaced to the caller + GUI listener
    // so a supervisor agent can log the side effect.
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let payload = match Writes::new(&galley, ctx.notifier.as_ref(), "project.delete")
        .delete_project(ProjectId(parsed.project_id), origin)
        .await
    {
        Ok(p) => p,
        Err(e) => return map_galley_err(request_id, e),
    };
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "deleted": true,
            "projectId": payload.project_id,
            "detachedSessions": payload.detached_sessions,
            "detachedSessionIds": payload.detached_session_ids,
        }),
    )
}

/// Mint a project id matching the GUI's `proj_<16-hex>` shape (see
/// `gui/src/stores/sessions.ts:929`). Hex is fine — collision space
/// for a single-user app is enormous and the id is opaque downstream.
fn mint_project_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    // Without the counter this was a pure function of the timestamp:
    // two creates landing on the same tick minted the SAME id and hit a
    // PK conflict. Mirrors `mint_session_id`.
    static PROJECT_ID_COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = PROJECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x: u128 = ts ^ u128::from(counter.rotate_left(17));
    // Splitmix-ish stir so ids don't visibly encode the timestamp.
    x ^= x.wrapping_mul(0x9E3779B97F4A7C15_9E3779B97F4A7C15);
    x ^= x >> 64;
    x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53_C4CEB9FE1A85EC53);
    let hex = format!("{x:032x}");
    format!("proj_{}", &hex[..16])
}
