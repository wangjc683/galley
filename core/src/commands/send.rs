//! The GUI's send and stop (ticket 02c): thin Tauri wrappers over Core's
//! send path ([`crate::session_send`]), which a phone will reach through
//! the remote module the same way.

use super::*;
use crate::api::MessageBrief;
use crate::runner_commands::{await_session_row, gui_error_json, EnsureSessionRunnerResult};
use crate::runner_manager::RunnerManager;
use crate::session_runner::{EnsureOutcome, GaConfigPref, LlmChoice, RunnerHost};
use crate::session_send::{SendError, SendOutcome, SendRequest};
use serde::Serialize;
use tauri::AppHandle;

/// Where a queued message sits (`send_user_message`, `outcome: "queued"`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueuedPlacement {
    pub queue_id: String,
    /// 0-based within the session's queue.
    pub position: usize,
}

/// Result of [`send_user_message`]. Every field is always present
/// (`null` when it does not apply).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendUserMessageResult {
    /// `dispatched` | `queued` | `side_question`.
    pub outcome: &'static str,
    /// The persisted row, on `dispatched`.
    pub message: Option<MessageBrief>,
    /// On `queued`.
    pub queue: Option<QueuedPlacement>,
    /// The runner the message went to, on `dispatched` / `side_question`;
    /// the same shape `ensure_session_runner` returns.
    pub runner: Option<EnsureSessionRunnerResult>,
}

fn runner_result(outcome: EnsureOutcome) -> EnsureSessionRunnerResult {
    EnsureSessionRunnerResult {
        pid: outcome.pid,
        spawned: outcome.spawned,
        ready: outcome.ready,
    }
}

/// Error JSON for the page, in the families `ensure_session_runner` uses
/// (`{error, message}` for a `GalleyError`, `{error, detail}` for runner
/// and spawn problems and `history_replay`) plus the send's own four:
/// `images_not_supported`, `images_not_queueable`, `images_not_allowed`,
/// `dispatch_failed` (`{error, detail}`).
fn send_error_json(e: SendError) -> String {
    match e {
        SendError::Db(e) => stringify_error(e),
        SendError::Runner(e) => gui_error_json(e),
        other => serde_json::json!({
            "error": other.tag().unwrap_or("internal"),
            "detail": other.detail(),
        })
        .to_string(),
    }
}

/// Send one user message the way Core sends for every frontend
/// ([`crate::session_send::send_user_message`]): queue it behind an open
/// run (text only), or reserve the run gate, persist it, make sure a
/// runner holds the session's history, and dispatch it — as the answer
/// when an `ask_user` question is pending. A `/btw` side question is
/// dispatched without being persisted or queued.
///
/// The message is announced as `user-message-persisted` with
/// `dispatch: "pending"` once persisted and again as `dispatched` /
/// `persisted_only`, both carrying `client_request_id`. A first message
/// names a session still titled `新对话` (`session-updated-external`).
///
/// - `images`: base64 `data:` URLs (PNG / JPEG / WebP, at most four,
///   10 MB each, 25 MB together).
/// - `llm_index` / `llm_key`, `ga_config`: used only if a runner has to
///   be started (see `ensure_session_runner`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn send_user_message(
    session_id: String,
    text: String,
    images: Option<Vec<PersistUserMessageAttachmentInput>>,
    client_request_id: Option<String>,
    llm_index: Option<i64>,
    llm_key: Option<String>,
    ga_config: Option<GaConfigPref>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    galley: State<'_, SqliteGalley>,
    app: AppHandle,
) -> std::result::Result<SendUserMessageResult, String> {
    let images = decode_message_attachments(images.unwrap_or_default()).map_err(stringify_error)?;
    // A first message can follow the page's fire-and-forget
    // `createSession` immediately.
    await_session_row(galley.inner(), &session_id).await;
    let host = RunnerHost {
        galley: galley.inner(),
        runner: manager.inner().as_ref(),
        notifier: crate::notify::TauriNotifier::new(app.clone()),
        env: Some(&app),
    };
    let llm_override = (llm_index.is_some() || llm_key.is_some()).then_some(LlmChoice {
        index: llm_index,
        key: llm_key,
    });
    let outcome = crate::session_send::send_user_message(
        &host,
        SendRequest {
            session_id,
            text,
            images,
            client_request_id,
            // A human at the desktop window (`client = desktop`); a send
            // that waits in the queue carries it to its dispatch.
            origin: Origin::desktop(),
            via: "gui",
            llm_override,
            ga_config,
            timeouts: Default::default(),
        },
    )
    .await
    .map_err(send_error_json)?;
    Ok(match outcome {
        SendOutcome::Dispatched { message, runner } => SendUserMessageResult {
            outcome: "dispatched",
            message: Some(message),
            queue: None,
            runner: Some(runner_result(runner)),
        },
        SendOutcome::Queued { queue_id, position } => SendUserMessageResult {
            outcome: "queued",
            message: None,
            queue: Some(QueuedPlacement { queue_id, position }),
            runner: None,
        },
        SendOutcome::SideQuestion { runner } => SendUserMessageResult {
            outcome: "side_question",
            message: None,
            queue: None,
            runner: Some(runner_result(runner)),
        },
    })
}

/// Result of [`stop_session_run`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StopSessionRunResult {
    /// `abort_sent` | `already_stopped`.
    pub dispatch: &'static str,
}

/// Stop the session's run ([`crate::session_send::stop_session_run`]):
/// `abort` when a run is open or a turn is going and a live runner is
/// there, otherwise `already_stopped`. Errors are the runner's
/// `SendCommandError` JSON (`{error, ...}`).
#[tauri::command]
pub(crate) async fn stop_session_run(
    session_id: String,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> std::result::Result<StopSessionRunResult, String> {
    let outcome = crate::session_send::stop_session_run(manager.inner().as_ref(), &session_id)
        .await
        .map_err(|e| serde_json::to_string(&e).unwrap_or_else(|_| e.to_string()))?;
    Ok(StopSessionRunResult {
        dispatch: outcome.as_str(),
    })
}
