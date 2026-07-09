use super::common::{map_galley_err, origin_from_args, SocketResponseLite};
use super::llm_cmds::resolve_llm_selection;
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSendArgs {
    session_id: String,
    content: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionCheckpointArgs {
    session_id: String,
    content: String,
    /// Goal this checkpoint narrates. Optional and additive
    /// (schemaVersion 1): older callers omit it and the row persists
    /// un-stamped, exactly as before 031.
    #[serde(default)]
    goal_id: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionGoalSynthesizeArgs {
    session_id: String,
    visible_content: String,
    dispatch_content: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionGoalMasterPlanArgs {
    session_id: String,
    dispatch_content: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionGoalSoloTurnArgs {
    session_id: String,
    dispatch_content: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionWatchArgs {
    session_id: String,
}

/// Tauri event payload broadcast to the GUI whenever a user message is
/// persisted via the socket path (CLI `galley session send` / supervisor
/// agents). GUI's listener calls `appendUserTurnExternal` to mirror the
/// row into the in-memory store so the conversation view renders the
/// message even though it wasn't typed in the Composer.
///
/// The GUI's own Composer path skips this — it persists locally via
/// `persistUserMessage` and mutates the store synchronously, so emitting
/// here would double-render.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserMessagePersistedPayload {
    session_id: String,
    message: MessageBrief,
    /// Whether the persisted message reached a runner in this command.
    /// GUI uses this to avoid showing "thinking" for saved-but-not-run
    /// messages.
    dispatch: &'static str,
}

/// Tauri event payload broadcast when the socket transport starts a
/// runner itself (currently `session.new`). The GUI attaches listeners
/// to this already-alive bridge so assistant events render/persist the
/// same way as GUI-spawned bridges.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RunnerSpawnedExternalPayload {
    session_id: String,
    pid: u32,
    via: &'static str,
}

pub(super) async fn dispatch_session_send(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionSendArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.send args: {e}"),
            );
        }
    };
    // 1. Open DB + write message row with origin = cli/supervisor
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message(session_id, parsed.content.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    // 2. Best-effort dispatch to runner. If the session's runner isn't
    // alive (LRU evicted, never spawned, crashed), the message is still
    // persisted in the DB — caller can `galley session watch` and wait
    // for a future spawn / replay path. We surface the runner result in
    // the response so callers know whether the message reached the
    // subprocess this turn.
    let dispatch_status = match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: parsed.content,
                images: vec![],
                visibility: None,
                absolute_turn_index: brief.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(_) => "persisted_only",
    };

    // Notify GUI so the conversation view picks up the new user row.
    // Emit covers both `dispatched` and `persisted_only` — the user
    // message exists in the DB either way, and the GUI must mirror it.
    // Best-effort: emit failure (no listeners registered yet, or app
    // handle gone) does not roll back the persist + dispatch above.
    if let Some(app) = app {
        let payload = UserMessagePersistedPayload {
            session_id: brief.session_id.0.clone(),
            message: brief.clone(),
            dispatch: dispatch_status,
        };
        let _ = app.emit("user-message-persisted", payload);
    }

    let result = serde_json::json!({
        "message": brief,
        "dispatch": dispatch_status,
    });
    SocketResponse::ok(request_id, result)
}

pub(super) async fn dispatch_session_checkpoint(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: SessionCheckpointArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.checkpoint args: {e}"),
            );
        }
    };
    let content = parsed.content.trim().to_string();
    if content.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.checkpoint: content is empty",
        );
    }

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    // Checkpoints are Galley-authored narration, not the human
    // operator's input — persist them as a `system` row so the GUI
    // renders neutral narration instead of a user bubble. Still
    // `persisted_only`: never dispatched to the runner.
    let send = match parsed.goal_id.as_deref().map(str::trim) {
        Some(goal_id) if !goal_id.is_empty() => {
            galley
                .send_system_message_for_goal(
                    session_id,
                    content,
                    origin,
                    GoalId(goal_id.to_string()),
                )
                .await
        }
        _ => {
            galley
                .send_system_message(session_id, content, origin)
                .await
        }
    };
    let brief = match send {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    emit_user_message_persisted(app, &parsed.session_id, &brief, "persisted_only");
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "message": brief,
            "dispatch": "persisted_only",
        }),
    )
}

pub(super) async fn dispatch_session_goal_synthesize(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionGoalSynthesizeArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.goal_synthesize args: {e}"),
            );
        }
    };
    let visible_content = parsed.visible_content.trim().to_string();
    if visible_content.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.goal_synthesize: visibleContent is empty",
        );
    }
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.goal_synthesize: dispatchContent is empty",
        );
    }

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message(session_id, visible_content.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) = ensure_goal_synthesis_runner(
        &galley,
        app,
        manager,
        &parsed.session_id,
        "session.goal_synthesize",
    )
    .await
    {
        emit_user_message_persisted(app, &parsed.session_id, &brief, "persisted_only");
        return e.with_request_id(request_id);
    }

    match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                visibility: None,
                absolute_turn_index: brief.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => {
            emit_user_message_persisted(app, &parsed.session_id, &brief, "dispatched");
            SocketResponse::ok(
                request_id,
                serde_json::json!({
                    "message": brief,
                    "dispatch": "dispatched",
                }),
            )
        }
        Err(e) => {
            emit_user_message_persisted(app, &parsed.session_id, &brief, "persisted_only");
            SocketResponse::err(
                request_id,
                "runner_error",
                format!("session.goal_synthesize runner dispatch: {e}"),
            )
        }
    }
}

pub(super) async fn dispatch_session_goal_master_plan(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionGoalMasterPlanArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.goal_master_plan args: {e}"),
            );
        }
    };
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.goal_master_plan: dispatchContent is empty",
        );
    }

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message_with_visibility(
            session_id,
            dispatch_content.clone(),
            origin,
            MessageVisibility::Internal,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) = ensure_goal_synthesis_runner(
        &galley,
        app,
        manager,
        &parsed.session_id,
        "session.goal_master_plan",
    )
    .await
    {
        return e.with_request_id(request_id);
    }

    let absolute_turn_index = brief.turn_index.map(i64::from).ok_or_else(|| {
        SocketResponseLite::runner_error("session.goal_master_plan missing turn_index")
    });
    let absolute_turn_index = match absolute_turn_index {
        Ok(v) => v,
        Err(e) => return e.with_request_id(request_id),
    };

    match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                visibility: Some("internal".to_string()),
                absolute_turn_index: Some(absolute_turn_index),
            }),
        )
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({
                "message": brief,
                "dispatch": "dispatched",
            }),
        ),
        Err(e) => SocketResponse::err(
            request_id,
            "runner_error",
            format!("session.goal_master_plan runner dispatch: {e}"),
        ),
    }
}

/// Solo-Goal working turn. The "keep going" nudge is **internal** (persisted
/// hidden, no GUI mirror) — it is scaffolding, not conversation — but the
/// agent turn it drives is **visible**: solo progress renders in the user
/// thread with the same step markers / tool callouts / streaming as a normal
/// session. Kept as a distinct command from `session.goal_master_plan`
/// (which hides the whole turn) for naming clarity and isolation.
///
/// Unlike `session.send` (best-effort to an already-live runner), this
/// **ensures the runner is spawned** first: a solo session has no runner until
/// the controller drives it, so a bare `session.send` would only pile
/// persisted messages onto a dead session (the original tight-loop bug).
/// Persist internal → spawn runner → dispatch visible.
pub(super) async fn dispatch_session_goal_solo_turn(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionGoalSoloTurnArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.goal_solo_turn args: {e}"),
            );
        }
    };
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.goal_solo_turn: dispatchContent is empty",
        );
    }

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    // Internal — the nudge and the turn it drives stay out of the user thread.
    let brief = match galley
        .send_message_with_visibility(
            session_id,
            dispatch_content.clone(),
            origin,
            MessageVisibility::Internal,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) = ensure_goal_synthesis_runner(
        &galley,
        app,
        manager,
        &parsed.session_id,
        "session.goal_solo_turn",
    )
    .await
    {
        return e.with_request_id(request_id);
    }

    let absolute_turn_index = match brief.turn_index.map(i64::from) {
        Some(v) => v,
        None => {
            return SocketResponseLite::runner_error("session.goal_solo_turn missing turn_index")
                .with_request_id(request_id);
        }
    };

    match manager
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                // Visible: the working turn renders in the user thread; only
                // the nudge row above stays internal.
                visibility: None,
                absolute_turn_index: Some(absolute_turn_index),
            }),
        )
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({
                "message": brief,
                "dispatch": "dispatched",
            }),
        ),
        Err(e) => SocketResponse::err(
            request_id,
            "runner_error",
            format!("session.goal_solo_turn runner dispatch: {e}"),
        ),
    }
}

async fn ensure_goal_synthesis_runner(
    galley: &SqliteGalley,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
    session_id: &str,
    via: &'static str,
) -> Result<(), SocketResponseLite> {
    if manager.pid(session_id).await.is_some() {
        return Ok(());
    }

    let session = galley
        .session_brief(SessionId(session_id.to_string()))
        .await
        .map_err(SocketResponseLite::from_err)?;
    let spawn_args = spawn_args_for_session_new(
        galley,
        app,
        session_id,
        session.project_id.as_ref().map(|id| id.as_str()),
        session.selected_llm_index,
        session.selected_llm_key.clone(),
        session.ga_runtime_kind,
    )
    .await?;
    let pid = manager
        .spawn(spawn_args, Some(session_id))
        .await
        .map_err(SocketResponseLite::runner_spawn_error)?;
    let rx = manager.subscribe(session_id).await.ok_or_else(|| {
        SocketResponseLite::runner_error(
            "session.goal_synthesize runner subscribe failed after spawn",
        )
    })?;
    if let Some(app) = app {
        let _ = app.emit(
            "runner-spawned-external",
            RunnerSpawnedExternalPayload {
                session_id: session_id.to_string(),
                pid,
                via,
            },
        );
        spawn_emit_task(app.clone(), session_id.to_string(), rx);
    }
    Ok(())
}

pub(super) async fn dispatch_session_watch(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> DispatchResult {
    let parsed: SessionWatchArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return DispatchResult::Unary(SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.watch args: {e}"),
            ));
        }
    };
    match manager.subscribe(&parsed.session_id).await {
        Some(rx) => DispatchResult::Stream { request_id, rx },
        None => DispatchResult::Unary(SocketResponse::err(
            request_id,
            "not_found",
            format!("no live runner for session {}", parsed.session_id),
        )),
    }
}

// ---------------- B4 M1 · session write handlers ----------------
//
// All six new handlers share the same shape:
//   1. parse args (camelCase JSON from CLI / supervisor)
//   2. open SqliteGalley (db_unavailable on connect fail)
//   3. validate / execute via GalleyApi trait
//   4. on side-effecting state changes, emit a Tauri event so the GUI
//      can mirror the row into its in-memory stores without polling
//
// `session.new` is the only handler that needs the runner_manager AND a
// SQLite transaction (create + first message commit together, then a
// runner is spawned for true delegation). `session.btw` and `session.stop`
// drive the runner but don't persist anything new. `session.archive`,
// `session.restore`, `session.move` are thin GalleyApi wrappers.

/// Tauri event payload broadcast when a CLI / supervisor creates a new
/// session via `session.new`. GUI's sidebar listener inserts the row
/// without a list_sessions round-trip.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionExternalPayload {
    pub(super) session: SessionBrief,
    /// Stable discriminant so a single listener can demultiplex multiple
    /// event types if we collapse the four event names into one in the
    /// future. Kept now for symmetry with `user-message-persisted`.
    pub(super) via: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionNewArgs {
    task: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    llm_name: Option<String>,
    #[serde(default)]
    runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionNewGoalWorkerArgs {
    task_template: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    llm_name: Option<String>,
    #[serde(default)]
    runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug)]
enum SessionNewTaskSource {
    Literal(String),
    GoalWorkerTemplate(String),
}

impl SessionNewTaskSource {
    fn render(self, session_id: &str) -> Result<String, String> {
        match self {
            SessionNewTaskSource::Literal(task) => Ok(task),
            SessionNewTaskSource::GoalWorkerTemplate(template) => {
                render_goal_worker_task_template(&template, session_id)
            }
        }
    }
}

pub(super) fn render_goal_worker_task_template(
    template: &str,
    session_id: &str,
) -> Result<String, String> {
    let placeholder_count = template.matches(GOAL_WORKER_SESSION_ID_PLACEHOLDER).count();
    if placeholder_count != 1 {
        return Err(format!(
            "session.new_goal_worker: taskTemplate must contain exactly one {GOAL_WORKER_SESSION_ID_PLACEHOLDER} placeholder"
        ));
    }
    Ok(template.replace(GOAL_WORKER_SESSION_ID_PLACEHOLDER, session_id))
}

struct SessionNewRequest {
    task_source: SessionNewTaskSource,
    project_id: Option<String>,
    llm_name: Option<String>,
    runtime_kind: Option<RuntimeKind>,
    supervisor: Option<String>,
    reason: Option<String>,
    command_name: &'static str,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GaConfigPref {
    #[serde(default)]
    python: Option<String>,
    #[serde(default)]
    ga_path: Option<String>,
    #[serde(default)]
    bridge_cwd: Option<String>,
    #[serde(default)]
    use_external_python: Option<bool>,
}

async fn spawn_args_for_session_new(
    galley: &SqliteGalley,
    app: Option<&AppHandle>,
    session_id: &str,
    project_id: Option<&str>,
    llm_index: Option<u32>,
    llm_key: Option<String>,
    runtime_kind: RuntimeKind,
) -> Result<SpawnArgs, SocketResponseLite> {
    let workspace_root = workspace_root_for_project(galley, project_id).await?;
    if runtime_kind == RuntimeKind::Managed {
        let app = app.ok_or_else(|| {
            SocketResponseLite::runner_error(
                "managed runtime is unavailable without a Galley app handle",
            )
        })?;
        let args = SpawnArgs {
            python: resolve_python_for_socket(&GaConfigPref::default(), Some(app))?,
            ga_path: PathBuf::new(),
            session_id: session_id.to_string(),
            cwd: None,
            workspace_root,
            bridge_cwd: PathBuf::new(),
            llm_index: llm_index.map(i64::from),
            llm_key,
            env: Vec::new(),
        };
        return prepare_managed_spawn_args(args, app)
            .await
            .map_err(SocketResponseLite::runner_spawn_error);
    }

    let raw = galley
        .get_pref_json("ga_config")
        .await
        .map_err(SocketResponseLite::from_err)?
        .ok_or_else(|| {
            SocketResponseLite::runner_error(
                "session.new runner config is missing; open Galley Settings once to save runtime paths",
            )
        })?;
    let config: GaConfigPref = serde_json::from_value(raw).map_err(|e| {
        SocketResponseLite::runner_error(format!("ga_config pref shape mismatch: {e}"))
    })?;
    let ga_path = normalize_external_ga_path(&PathBuf::from(non_empty_pref(
        config.ga_path.as_deref(),
        "gaPath",
    )?))
    .map_err(SocketResponseLite::runner_spawn_error)?;

    let bridge_cwd = resolve_bridge_cwd(&config, app)?;
    let python = resolve_python_for_socket(&config, app)?;

    Ok(SpawnArgs {
        python,
        ga_path,
        session_id: session_id.to_string(),
        cwd: None,
        workspace_root,
        bridge_cwd,
        llm_index: llm_index.map(i64::from),
        llm_key,
        env: Vec::new(),
    })
}

async fn workspace_root_for_project(
    galley: &SqliteGalley,
    project_id: Option<&str>,
) -> Result<Option<PathBuf>, SocketResponseLite> {
    let Some(project_id) = project_id else {
        return Ok(None);
    };
    let projects = galley
        .list_projects()
        .await
        .map_err(SocketResponseLite::from_err)?;
    let Some(project) = projects.into_iter().find(|p| p.id.as_str() == project_id) else {
        return Ok(None);
    };
    if !project.workspace_enabled {
        return Ok(None);
    }
    Ok(project
        .root_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from))
}

fn non_empty_pref(value: Option<&str>, key: &str) -> Result<String, SocketResponseLite> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Err(SocketResponseLite::runner_error(format!(
            "session.new runner config missing {key}"
        )));
    };
    Ok(v.to_string())
}

fn resolve_bridge_cwd(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<PathBuf, SocketResponseLite> {
    if let Some(app) = app {
        return managed_runtime::bridge_cwd_for_app(app).map_err(|e| {
            SocketResponseLite::runner_error(format!("resolving Galley bridge cwd failed: {e}"))
        });
    }
    let bridge_cwd = PathBuf::from(non_empty_pref(config.bridge_cwd.as_deref(), "bridgeCwd")?);
    if !bridge_cwd.is_dir() {
        return Err(SocketResponseLite::runner_error(format!(
            "bridge cwd invalid: not a directory: {}",
            bridge_cwd.display()
        )));
    }
    Ok(bridge_cwd)
}

fn resolve_python_for_socket(
    config: &GaConfigPref,
    app: Option<&AppHandle>,
) -> Result<String, SocketResponseLite> {
    let want_bundled = !cfg!(debug_assertions) && !config.use_external_python.unwrap_or(false);
    if want_bundled {
        if let Some(app) = app {
            if let Ok(resource_dir) = app.path().resource_dir() {
                let rel = if cfg!(windows) {
                    "python/python.exe"
                } else {
                    "python/bin/python3"
                };
                return path_to_utf8(resource_dir.join(rel), "bundled python");
            }
        }
    }

    let fallback = default_python_name();
    let raw = config
        .python
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback);
    Ok(resolve_python_alias(raw).unwrap_or_else(|| fallback.to_string()))
}

fn default_python_name() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn resolve_python_alias(raw: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = match raw {
        "python-ga-venv" => format!("{home}/Documents/GenericAgent/.venv/bin/python"),
        "python-ga-venv-alt" => format!("{home}/Documents/GenericAgent/venv/bin/python"),
        "python-brew-arm" => "/opt/homebrew/bin/python3".to_string(),
        "python-brew-intel" => "/usr/local/bin/python3".to_string(),
        "python-framework-3-14" => {
            "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3".to_string()
        }
        "python-framework-3-13" => {
            "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3".to_string()
        }
        "python-framework-3-12" => {
            "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3".to_string()
        }
        "python-framework-3-11" => {
            "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3".to_string()
        }
        "python3" | "python" => raw.to_string(),
        p if p.starts_with('/') || p.starts_with('\\') || looks_like_windows_abs_path(p) => {
            p.to_string()
        }
        _ => return None,
    };
    Some(path)
}

fn looks_like_windows_abs_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn path_to_utf8(path: PathBuf, label: &str) -> Result<String, SocketResponseLite> {
    path.into_os_string().into_string().map_err(|_| {
        SocketResponseLite::runner_error(format!("{label} path contains non-UTF-8 characters"))
    })
}

fn emit_user_message_persisted(
    app: Option<&AppHandle>,
    session_id: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    if let Some(app) = app {
        let _ = app.emit(
            "user-message-persisted",
            UserMessagePersistedPayload {
                session_id: session_id.to_string(),
                message: message.clone(),
                dispatch,
            },
        );
    }
}

/// Atomically create a session + persist its first user message, then
/// spawn a runner and dispatch that first message. The DB writes still
/// commit together; runner failures after commit surface as `runner_error`
/// so callers know the delegated task did not actually start.
pub(super) async fn dispatch_session_new(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionNewArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.new args: {e}"),
            );
        }
    };
    let task = parsed.task.trim().to_string();
    if task.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "session.new: task is empty");
    }
    dispatch_session_new_inner(
        request_id,
        SessionNewRequest {
            task_source: SessionNewTaskSource::Literal(task),
            project_id: parsed.project_id,
            llm_name: parsed.llm_name,
            runtime_kind: parsed.runtime_kind,
            supervisor: parsed.supervisor,
            reason: parsed.reason,
            command_name: "session.new",
        },
        app,
        manager,
    )
    .await
}

pub(super) async fn dispatch_session_new_goal_worker(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionNewGoalWorkerArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.new_goal_worker args: {e}"),
            );
        }
    };
    let template = parsed.task_template.trim().to_string();
    if template.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            "session.new_goal_worker: taskTemplate is empty",
        );
    }
    if let Err(message) = render_goal_worker_task_template(&template, "s-validation") {
        return SocketResponse::err(request_id, "invalid_args", message);
    }
    dispatch_session_new_inner(
        request_id,
        SessionNewRequest {
            task_source: SessionNewTaskSource::GoalWorkerTemplate(template),
            project_id: parsed.project_id,
            llm_name: parsed.llm_name,
            runtime_kind: parsed.runtime_kind,
            supervisor: parsed.supervisor,
            reason: parsed.reason,
            command_name: "session.new_goal_worker",
        },
        app,
        manager,
    )
    .await
}

async fn dispatch_session_new_inner(
    request_id: Option<String>,
    request: SessionNewRequest,
    app: Option<&AppHandle>,
    manager: &RunnerManager,
) -> SocketResponse {
    let SessionNewRequest {
        task_source,
        project_id,
        llm_name,
        runtime_kind,
        supervisor,
        reason,
        command_name,
    } = request;
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };

    let active_runtime_kind = match galley.active_runtime_kind().await {
        Ok(kind) => kind,
        Err(e) => return map_galley_err(request_id, e),
    };
    let target_runtime_kind = runtime_kind.unwrap_or(active_runtime_kind);
    let runtime_warning = runtime_kind
        .filter(|requested| *requested != active_runtime_kind)
        .map(|requested| {
            serde_json::json!({
                "id": "non_current_runtime",
                "message": "session created outside the current GUI runtime",
                "currentRuntimeKind": active_runtime_kind,
                "requestedRuntimeKind": requested,
            })
        });

    // Resolve --llm=<name> against the selected runtime's current model
    // source. Managed runtime resolves Galley model records; external
    // runtime resolves the cached raw GA LLM list.
    let llm_selection = match resolve_llm_selection(&galley, llm_name, target_runtime_kind).await {
        Ok(selection) => selection,
        Err(resp) => return resp.with_request_id(request_id),
    };

    let id = mint_session_id();
    let task = match task_source.render(&id) {
        Ok(task) => task.trim().to_string(),
        Err(message) => return SocketResponse::err(request_id, "invalid_args", message),
    };
    if task.is_empty() {
        return SocketResponse::err(
            request_id,
            "invalid_args",
            format!("{command_name}: rendered task is empty"),
        );
    }
    let spawn_args = match spawn_args_for_session_new(
        &galley,
        app,
        &id,
        project_id.as_deref(),
        llm_selection.index,
        llm_selection.key.clone(),
        target_runtime_kind,
    )
    .await
    {
        Ok(args) => args,
        Err(resp) => return resp.with_request_id(request_id),
    };

    let input = CreateSessionInput {
        id: id.clone(),
        title: DEFAULT_NEW_SESSION_TITLE.to_string(),
        project_id,
        selected_llm_index: llm_selection.index,
        selected_llm_key: llm_selection.key,
        selected_llm_display_name: llm_selection.display_name,
        ga_runtime_kind: Some(target_runtime_kind),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let origin = origin_from_args(supervisor.clone(), reason.clone());

    // BEGIN — create + send_message in one transaction (sub-plan O1).
    let mut tx = match galley.begin_tx().await {
        Ok(t) => t,
        Err(e) => return map_galley_err(request_id, e),
    };
    let brief = match galley
        .create_session_in_tx(&mut tx, input, origin.clone())
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };
    let msg = match galley
        .send_message_in_tx(&mut tx, SessionId(brief.id.0.clone()), task.clone(), origin)
        .await
    {
        Ok(m) => m,
        Err(e) => return map_galley_err(request_id, e),
    };
    if let Err(e) = tx.commit().await {
        return SocketResponse::err(
            request_id,
            "internal",
            format!("{command_name} commit: {e}"),
        );
    }

    // Notify GUI early so the sidebar can show the session while we
    // start the runner. The first message event is emitted below after
    // we know whether it actually reached the bridge.
    if let Some(app) = app {
        let payload = SessionExternalPayload {
            session: brief.clone(),
            via: command_name,
        };
        let _ = app.emit("session-created-external", payload);
    }

    let pid = match manager.spawn(spawn_args, Some(&brief.id.0)).await {
        Ok(pid) => pid,
        Err(e) => {
            emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("{command_name} runner spawn: {e}"),
            );
        }
    };

    let Some(rx) = manager.subscribe(&brief.id.0).await else {
        emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
        return SocketResponse::err(
            request_id,
            "runner_error",
            format!("{command_name} runner subscribe failed after spawn"),
        );
    };
    if let Some(app) = app {
        let _ = app.emit(
            "runner-spawned-external",
            RunnerSpawnedExternalPayload {
                session_id: brief.id.0.clone(),
                pid,
                via: command_name,
            },
        );
        spawn_emit_task(app.clone(), brief.id.0.clone(), rx);
    }

    match manager
        .send_command(
            &brief.id.0,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: task,
                images: vec![],
                visibility: None,
                absolute_turn_index: msg.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => {}
        Err(e) => {
            emit_user_message_persisted(app, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                "runner_error",
                format!("{command_name} runner dispatch: {e}"),
            );
        }
    }

    emit_user_message_persisted(app, &brief.id.0, &msg, "dispatched");

    let mut result = serde_json::json!({
        "session": brief,
        "message": msg,
        "dispatch": "dispatched",
    });
    if let Some(warning) = runtime_warning {
        result["warning"] = warning;
    }
    SocketResponse::ok(request_id, result)
}

/// CLI sends `supervisor` / `reason` for symmetry with the other write
/// commands, but `session.btw` is transient (no DB persist per sub-plan
/// §1.5) so we don't act on them in M1. M7 will surface them in the
/// supervisor action log — wire them in there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SessionBtwArgs {
    session_id: String,
    question: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// "By the way" side-question. Bypasses the agent's run queue via the
/// runner's `/btw` prefix detection. Transient by design — not persisted
/// to the `messages` table (v0.1 decision; see [messages.ts:445-455]).
pub(super) async fn dispatch_session_btw(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionBtwArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.btw args: {e}"),
            );
        }
    };
    let question = parsed.question.trim().to_string();
    if question.is_empty() {
        return SocketResponse::err(request_id, "invalid_args", "session.btw: question is empty");
    }

    // Validate session exists so a typo'd id surfaces as `not_found`
    // rather than silently failing through `send_command -> ProcessGone`.
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }

    // Drop the implicit reference to galley so we can drop the
    // borrowed pool before the runner await. (galley is owned, so the
    // explicit drop is cosmetic — but it keeps the boundary obvious.)
    drop(galley);

    let cmd = IpcCommand::UserMessage(UserMessageCommand {
        text: format!("/btw {question}"),
        images: vec![],
        visibility: None,
        absolute_turn_index: None,
    });
    match manager.send_command(&parsed.session_id, &cmd).await {
        Ok(()) => SocketResponse::ok(request_id, serde_json::json!({ "dispatch": "dispatched" })),
        Err(SendCommandError::ProcessGone { .. }) => SocketResponse::err(
            request_id,
            "runner_error",
            format!(
                "no live runner for session {}; /btw requires an alive bridge",
                parsed.session_id
            ),
        ),
        Err(e) => SocketResponse::err(request_id, "runner_error", e.to_string()),
    }
}

/// Same as [`SessionBtwArgs`]: supervisor / reason accepted for CLI
/// surface symmetry but parked until M7's audit log lands.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SessionStopArgs {
    session_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Map a user-facing "stop this turn" onto `IpcCommand::Abort` (NOT
/// `Shutdown`). The bridge stays alive so a subsequent `session send`
/// can resume without paying the 5-10s respawn cost. See sub-plan §1.4
/// for the Abort-vs-Shutdown decision. Idempotent: stopping an already-
/// idle session returns `already_stopped` and exit 0.
pub(super) async fn dispatch_session_stop(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionStopArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.stop args: {e}"),
            );
        }
    };

    // Validate the session row exists so callers get `not_found` for
    // typos rather than `already_stopped` (which would silently swallow
    // the typo). The runner liveness check is separate.
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    if !manager.agent_running(&parsed.session_id).await {
        return SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        );
    }
    match manager
        .send_command(&parsed.session_id, &IpcCommand::Abort)
        .await
    {
        Ok(()) => SocketResponse::ok(request_id, serde_json::json!({ "dispatch": "abort_sent" })),
        // Race: agent_running was true but the process died before
        // we got the command out. Treat as already_stopped — the
        // observable end state is the same.
        Err(SendCommandError::ProcessGone { .. }) => SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        ),
        Err(e) => SocketResponse::err(request_id, "runner_error", e.to_string()),
    }
}

pub(super) async fn dispatch_session_shutdown_runner(
    request_id: Option<String>,
    args: Value,
    manager: &RunnerManager,
) -> SocketResponse {
    let parsed: SessionStopArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.shutdown_runner args: {e}"),
            );
        }
    };

    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    match manager
        .shutdown(&parsed.session_id, Some(Duration::from_millis(1500)))
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "shutdown_sent" }),
        ),
        Err(ShutdownError::NotFound { .. }) => SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        ),
        Err(e) => SocketResponse::err(request_id, "runner_error", e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionArchiveArgs {
    session_id: String,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

pub(super) async fn dispatch_session_archive(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: SessionArchiveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.archive args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .archive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-archived-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.archive",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_session_restore(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    // Restore reuses the archive args shape — same flags, opposite verb.
    let parsed: SessionArchiveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.restore args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .unarchive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-unarchived-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.restore",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMoveArgs {
    session_id: String,
    /// `None` = detach from any project (move to ungrouped). Matches the
    /// CLI surface where omitting `--to` means "detach".
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

pub(super) async fn dispatch_session_move(
    request_id: Option<String>,
    args: Value,
    app: Option<&AppHandle>,
) -> SocketResponse {
    let parsed: SessionMoveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("session.move args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .assign_session_to_project(SessionId(parsed.session_id), parsed.to, origin)
        .await
    {
        Ok(brief) => {
            if let Some(app) = app {
                let _ = app.emit(
                    "session-moved-external",
                    SessionExternalPayload {
                        session: brief.clone(),
                        via: "session.move",
                    },
                );
            }
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

/// Mint a session id matching the GUI's `s-<base36-time>-<base36-rand>`
/// shape. Kept here (rather than in `db::SqliteGalley`) because
/// id-minting is a caller concern — `create_session_in_tx` accepts a
/// caller-supplied id and validates the row insert.
pub(super) fn mint_session_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SESSION_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let ts = dur.as_millis() as u64;
    let counter = SESSION_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nonce = (dur.as_nanos() as u64)
        ^ counter.rotate_left(17)
        ^ (u64::from(std::process::id())).rotate_left(32);
    let rand: u64 = {
        let mut x = ts ^ nonce;
        x ^= x.wrapping_mul(0x9E3779B97F4A7C15);
        x ^= x >> 33;
        x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53);
        x
    };
    let suffix = radix36(rand);
    let suffix_start = suffix.len().saturating_sub(8);
    format!("s-{}-{}", radix36(ts), &suffix[suffix_start..])
}

fn radix36(mut n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    const ALPHABET: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::with_capacity(13);
    while n > 0 {
        out.push(ALPHABET[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("radix36 alphabet is ASCII")
}

/// Default title for `session.new` — matches the GUI's localized seed
/// so a CLI-created row + a GUI-created row look identical in the
/// sidebar. The bridge derives a better title after the first turn ends.
const DEFAULT_NEW_SESSION_TITLE: &str = "新对话";

pub(super) async fn dispatch_sessions_list(
    request_id: Option<String>,
    args: Value,
) -> SocketResponse {
    let filter: SessionFilter = match serde_json::from_value(args) {
        Ok(f) => f,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                "invalid_args",
                format!("sessions.list args: {e}"),
            );
        }
    };
    let galley = match SqliteGalley::open().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, "db_unavailable", format!("open: {e}"));
        }
    };
    match galley.list_sessions(filter).await {
        Ok(sessions) => {
            let value = serde_json::to_value(&sessions).unwrap_or(Value::Null);
            SocketResponse::ok(request_id, value)
        }
        Err(e) => SocketResponse::err(request_id, "internal", format!("list_sessions: {e}")),
    }
}
