use super::common::{map_galley_err, origin_from_args};
use super::*;

// ---------------- B4 M1.3 · project + llm write handlers ----------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectExternalPayload {
    project: ProjectBrief,
    via: &'static str,
}

/// `project.delete` carries extra payload that `ProjectExternalPayload`
/// can't express — the affected child sessions get their `project_id`
/// auto-detached (FK SET NULL), and the GUI needs to mirror that.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectDeletedPayload {
    project_id: String,
    /// Number of sessions whose `project_id` was just set to NULL.
    /// CLI returns this in the response too so a supervisor agent can
    /// surface the side effect in its action log.
    detached_sessions: u32,
    detached_session_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectCreateArgs {
    name: String,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

pub(super) async fn dispatch_project_create(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: ProjectCreateArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("project.create args: {e}"),
            );
        }
    };
    let name = parsed.name.trim().to_string();
    if name.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "project.create: name is empty");
    }
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
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
        icon: parsed.icon,
        color: parsed.color,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);

    match galley.create_project(input, origin).await {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "project-created-external",
                    ProjectExternalPayload {
                        project: brief.clone(),
                        via: "project.create",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "project": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDeleteArgs {
    project_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
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
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: ProjectDeleteArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("project.delete args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    // Snapshot child sessions BEFORE the delete so we can surface
    // `detachedSessions` to the caller + GUI listener. SQLite SET NULL
    // is atomic with the row drop, so a list-then-delete sequence races
    // against concurrent GUI writes only by the few ms between the two
    // queries — acceptable for a count meant for human-readable feedback.
    let detached_ids: Vec<String> = match galley
        .list_sessions(SessionFilter {
            project_id: Some(parsed.project_id.clone()),
            status: None,
            archived: None,
            runtime_kind: None,
        })
        .await
    {
        Ok(rows) => rows.into_iter().map(|s| s.id.0).collect(),
        Err(e) => return map_galley_err(request_id, e),
    };

    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    if let Err(e) = galley
        .delete_project(ProjectId(parsed.project_id.clone()), origin)
        .await
    {
        return map_galley_err(request_id, e);
    }

    let payload = ProjectDeletedPayload {
        project_id: parsed.project_id,
        detached_sessions: detached_ids.len() as u32,
        detached_session_ids: detached_ids.clone(),
    };
    if let Some(app) = app {
        let _ = app.emit("project-deleted-external", payload.clone());
    }
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
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut x: u128 = ts;
    // Splitmix-ish stir so two ids minted in the same ns differ.
    x ^= x.wrapping_mul(0x9E3779B97F4A7C15_9E3779B97F4A7C15);
    x ^= x >> 64;
    x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53_C4CEB9FE1A85EC53);
    let hex = format!("{x:032x}");
    format!("proj_{}", &hex[..16])
}
