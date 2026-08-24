//! Session commands against an **existing** session: send / checkpoint /
//! watch / btw / stop / shutdown_runner / archive / restore / move /
//! list, plus the Tauri event payloads and id minting shared with the
//! sibling command modules. Session creation lives in
//! `session_new_cmds`; goal-turn commands in `session_goal_cmds`; runner
//! spawn-config resolution in `spawn_config`.
//!
//! All write handlers share the same shape:
//!   1. parse args (camelCase JSON from CLI / supervisor)
//!   2. open SqliteGalley (db_unavailable on connect fail)
//!   3. validate / execute via GalleyApi trait
//!   4. on side-effecting state changes, emit a Tauri event so the GUI
//!      can mirror the row into its in-memory stores without polling

use super::common::{map_galley_err, origin_from_args};
use super::*;
use crate::runner_manager::{QueueJump, QueueOffer};
// Args shapes live in `crate::protocol` (imported via super::*) — the
// single home for schemaVersion 1 command shapes shared with the CLI.
// Do not declare per-command arg structs in this module.

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
/// runner itself (`session.new` and the goal-turn ensure path). The GUI
/// attaches listeners to this already-alive bridge so assistant events
/// render/persist the same way as GUI-spawned bridges.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct RunnerSpawnedExternalPayload {
    pub(super) session_id: String,
    pub(super) pid: u32,
    pub(super) via: &'static str,
}

/// Tauri event payload broadcast when a CLI / supervisor creates or
/// mutates a session row (`session.new` / archive / restore / move).
/// GUI's sidebar listener applies the row without a list_sessions
/// round-trip.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionExternalPayload {
    pub(super) session: SessionBrief,
    /// Stable discriminant so a single listener can demultiplex multiple
    /// event types if we collapse the four event names into one in the
    /// future. Kept now for symmetry with `user-message-persisted`.
    pub(super) via: &'static str,
}

pub(super) fn emit_user_message_persisted(
    ctx: &HandlerCtx<'_>,
    session_id: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    ctx.notify(
        "user-message-persisted",
        &UserMessagePersistedPayload {
            session_id: session_id.to_string(),
            message: message.clone(),
            dispatch,
        },
    );
}

pub(super) async fn dispatch_session_send(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionSendArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.send args: {e}"),
            );
        }
    };
    // 1. Open DB early — even the queued branch validates the session
    // row first (archived / missing must fail the same as before).
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    if let Err(e) = galley.assert_session_writable(&session_id).await {
        return map_galley_err(request_id, e);
    }

    // 2. Queue gate (galley#19/#20). A send to a session whose run is
    // open (or whose queue is non-empty) is HELD in the Core queue and
    // persisted only at dequeue — the old passthrough silently stacked
    // it in GA's internal task queue while the bridge's event stream
    // claimed it had started (`.scratch/message-queue/PRD.md` 调查结论
    // 3). `dispatch: "queued"` + null `message` is the honest shape;
    // `--jump` converts the hold into "abort current, run me first".
    match ctx
        .runner
        .queue_offer(&parsed.session_id, parsed.content.clone(), Some(origin.clone()))
        .await
    {
        QueueOffer::Queued { queue_id, position } => {
            let mut position = position;
            if parsed.jump {
                match ctx.runner.queue_jump(&parsed.session_id, &queue_id).await {
                    QueueJump::AbortThenDrain => {
                        position = 0;
                        // Best-effort — abort failure leaves the item
                        // queued at the front, which still honors the
                        // "run me first" intent on the next drain.
                        let _ = ctx
                            .runner
                            .send_command(&parsed.session_id, &IpcCommand::Abort)
                            .await;
                    }
                    QueueJump::DispatchNow(item) => {
                        // Run closed between offer and jump: dispatch
                        // directly after all.
                        emit_queue_changed(ctx, &parsed.session_id).await;
                        return send_now(
                            request_id,
                            ctx,
                            &galley,
                            &parsed.session_id,
                            item.text,
                            origin,
                        )
                        .await;
                    }
                    QueueJump::NotFound => {}
                }
            }
            emit_queue_changed(ctx, &parsed.session_id).await;
            let result = serde_json::json!({
                "message": Value::Null,
                "dispatch": "queued",
                "queue": { "queueId": queue_id, "position": position },
            });
            SocketResponse::ok(request_id, result)
        }
        QueueOffer::DispatchNow => {
            send_now(request_id, ctx, &galley, &parsed.session_id, parsed.content, origin).await
        }
    }
}

/// The pre-queue immediate path: persist the row, dispatch to the
/// runner, notify the GUI. The caller holds the run-gate reservation
/// (QueueOffer::DispatchNow / QueueJump::DispatchNow); a failed
/// dispatch releases it so the queue never waits on a run that never
/// started.
async fn send_now(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    galley: &crate::db::SqliteGalley,
    session_id: &str,
    content: String,
    origin: crate::api::Origin,
) -> SocketResponse {
    let brief = match galley
        .send_message(SessionId(session_id.to_string()), content.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            ctx.runner.queue_release_run(session_id).await;
            return map_galley_err(request_id, e);
        }
    };

    // Best-effort dispatch to runner. If the session's runner isn't
    // alive (LRU evicted, never spawned, crashed), the message is still
    // persisted in the DB — caller can `galley session watch` and wait
    // for a future spawn / replay path. We surface the runner result in
    // the response so callers know whether the message reached the
    // subprocess this turn.
    let dispatch_status = match ctx
        .runner
        .send_command(
            session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: content,
                images: vec![],
                visibility: None,
                absolute_turn_index: brief.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(_) => {
            ctx.runner.queue_release_run(session_id).await;
            "persisted_only"
        }
    };

    // Notify GUI so the conversation view picks up the new user row.
    // Emit covers both `dispatched` and `persisted_only` — the user
    // message exists in the DB either way, and the GUI must mirror it.
    // Best-effort: emit failure (no listeners registered yet, or app
    // handle gone) does not roll back the persist + dispatch above.
    emit_user_message_persisted(ctx, &brief.session_id.0, &brief, dispatch_status);

    let result = serde_json::json!({
        "message": brief,
        "dispatch": dispatch_status,
    });
    SocketResponse::ok(request_id, result)
}

/// Broadcast the session's queue snapshot after a mutation.
pub(super) async fn emit_queue_changed(ctx: &HandlerCtx<'_>, session_id: &str) {
    let items = ctx.runner.queue_snapshot(session_id).await;
    ctx.notify(
        crate::api::SESSION_QUEUE_CHANGED_EVENT,
        &crate::api::SessionQueueChangedPayload {
            session_id: session_id.to_string(),
            items,
        },
    );
}

pub(super) async fn dispatch_session_checkpoint(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionCheckpointArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.checkpoint args: {e}"),
            );
        }
    };
    let content = parsed.content.trim().to_string();
    if content.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.checkpoint: content is empty",
        );
    }

    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
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

    emit_user_message_persisted(ctx, &parsed.session_id, &brief, "persisted_only");
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "message": brief,
            "dispatch": "persisted_only",
        }),
    )
}

pub(super) async fn dispatch_session_watch(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> DispatchResult {
    let parsed: SessionWatchArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return DispatchResult::Unary(SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.watch args: {e}"),
            ));
        }
    };
    match ctx.runner.subscribe(&parsed.session_id).await {
        Some(rx) => DispatchResult::Stream { request_id, rx },
        None => DispatchResult::Unary(SocketResponse::err(
            request_id,
            ErrorTag::NotFound,
            format!("no live runner for session {}", parsed.session_id),
        )),
    }
}

/// "By the way" side-question. Bypasses the agent's run queue via the
/// runner's `/btw` prefix detection. Transient by design — not persisted
/// to the `messages` table (v0.1 decision; see [messages.ts:445-455]).
/// CLI sends `supervisor` / `reason` for symmetry with the other write
/// commands, but btw is transient so we don't act on them in M1; M7 will
/// surface them in the supervisor action log.
pub(super) async fn dispatch_session_btw(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionBtwArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.btw args: {e}"),
            );
        }
    };
    let question = parsed.question.trim().to_string();
    if question.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.btw: question is empty",
        );
    }

    // Validate session exists so a typo'd id surfaces as `not_found`
    // rather than silently failing through `send_command -> ProcessGone`.
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
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
    match ctx.runner.send_command(&parsed.session_id, &cmd).await {
        Ok(()) => SocketResponse::ok(request_id, serde_json::json!({ "dispatch": "dispatched" })),
        Err(SendCommandError::ProcessGone { .. }) => SocketResponse::err(
            request_id,
            ErrorTag::RunnerError,
            format!(
                "no live runner for session {}; /btw requires an alive bridge",
                parsed.session_id
            ),
        ),
        Err(e) => SocketResponse::err(request_id, ErrorTag::RunnerError, e.to_string()),
    }
}

/// Map a user-facing "stop this turn" onto `IpcCommand::Abort` (NOT
/// `Shutdown`). The bridge stays alive so a subsequent `session send`
/// can resume without paying the 5-10s respawn cost. See sub-plan §1.4
/// for the Abort-vs-Shutdown decision. Idempotent: stopping an already-
/// idle session returns `already_stopped` and exit 0.
pub(super) async fn dispatch_session_stop(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionStopArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.stop args: {e}"),
            );
        }
    };

    // Validate the session row exists so callers get `not_found` for
    // typos rather than `already_stopped` (which would silently swallow
    // the typo). The runner liveness check is separate.
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    if !ctx.runner.agent_running(&parsed.session_id).await {
        return SocketResponse::ok(
            request_id,
            serde_json::json!({ "dispatch": "already_stopped" }),
        );
    }
    match ctx
        .runner
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
        Err(e) => SocketResponse::err(request_id, ErrorTag::RunnerError, e.to_string()),
    }
}

/// `session.run_state` — the live busy signal for one session, read
/// straight from the RunnerManager (runner registry + outbound-queue run
/// gate). Poll target for the Goal controller's turn-completion waits:
/// `sessions.status` in SQLite persists transient statuses as `idle`, so
/// a DB read can never answer "is the dispatched run still open".
pub(super) async fn dispatch_session_run_state(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionRunStateArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.run_state args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    let state = ctx.runner.run_state(&parsed.session_id).await;
    SocketResponse::ok(
        request_id,
        serde_json::json!({
            "sessionId": parsed.session_id,
            "runnerAlive": state.runner_alive,
            "agentRunning": state.agent_running,
            "openRun": state.open_run,
            "queuedCount": state.queued_count,
        }),
    )
}

pub(super) async fn dispatch_session_shutdown_runner(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionShutdownRunnerArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.shutdown_runner args: {e}"),
            );
        }
    };

    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    if let Err(e) = galley
        .session_brief(SessionId(parsed.session_id.clone()))
        .await
    {
        return map_galley_err(request_id, e);
    }
    drop(galley);

    match ctx
        .runner
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
        Err(e) => SocketResponse::err(request_id, ErrorTag::RunnerError, e.to_string()),
    }
}

pub(super) async fn dispatch_session_archive(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionArchiveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.archive args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .archive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            ctx.notify(
                "session-archived-external",
                &SessionExternalPayload {
                    session: brief.clone(),
                    via: "session.archive",
                },
            );
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_session_restore(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionRestoreArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.restore args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .unarchive_session(SessionId(parsed.session_id), origin)
        .await
    {
        Ok(brief) => {
            ctx.notify(
                "session-unarchived-external",
                &SessionExternalPayload {
                    session: brief.clone(),
                    via: "session.restore",
                },
            );
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_session_move(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionMoveArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.move args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match galley
        .assign_session_to_project(SessionId(parsed.session_id), parsed.to, origin)
        .await
    {
        Ok(brief) => {
            ctx.notify(
                "session-moved-external",
                &SessionExternalPayload {
                    session: brief.clone(),
                    via: "session.move",
                },
            );
            SocketResponse::ok(request_id, serde_json::json!({ "session": brief }))
        }
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_sessions_list(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let filter: SessionFilter = match serde_json::from_value(args) {
        Ok(f) => f,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("sessions.list args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    match galley.list_sessions(filter).await {
        Ok(sessions) => {
            let value = serde_json::to_value(&sessions).unwrap_or(Value::Null);
            SocketResponse::ok(request_id, value)
        }
        Err(e) => SocketResponse::err(
            request_id,
            ErrorTag::Internal,
            format!("list_sessions: {e}"),
        ),
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
