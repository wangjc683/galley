//! Core's one send path for the GUI and the phone (ticket 02c,
//! `.scratch/ios-client/issues/02-core-send-takeover.md`).
//!
//! Before 02c the GUI orchestrated a send in TypeScript: persist the row
//! (`persist_user_message`, no broadcast), make sure a runner is up, send
//! `user_message` — without reserving the run gate, so a CLI send could
//! slip into a cold session's spawn-and-replay window and start a second
//! run — and derive the session title by writing it back from the page.
//! A phone has no desktop page to lean on, and Rule 5 puts the authority
//! in Core, so [`send_user_message`] does the whole thing:
//!
//! 1. the session must be writable;
//! 2. a `/btw` side question ([`is_side_question`]) is neither persisted
//!    nor gated: ensure a runner, dispatch it as it is (no images);
//! 3. the run gate: a text message goes through `queue_offer` (queued
//!    while a run is open, like every other sender); a message with
//!    images may not wait in the queue (items are text only), so it
//!    either reserves the gate at once (`queue_try_reserve`) or is
//!    refused;
//! 4. with the gate held: an `ask_user` question pending makes this the
//!    answer (`ask_user_response`, no images); an attached runtime whose
//!    live runner reported that its model takes no images refuses them;
//! 5. persist (with attachments), broadcast `user-message-persisted`
//!    (`dispatch: "pending"`), derive the title ([`crate::session_title`]);
//! 6. ensure a runner with the session's history in it
//!    ([`crate::session_runner`], `holds_run_gate`);
//! 7. dispatch, and broadcast the same message again as `dispatched`.
//!
//! Every failure after step 3 releases the gate, and every failure after
//! step 5 broadcasts the message again as `persisted_only` — it is saved,
//! nothing is running it.
//!
//! Because the gate is reserved before the ensure, anyone else sending
//! meanwhile (socket `session.send`, the queue drain, a Goal) sees a run
//! open and queues or backs off: the window 02b left between a runner's
//! spawn and its replay is closed on this path.
//!
//! Socket `session.send` does not come through here. Its contract is
//! frozen (ADR-0002, Agent API): with no runner it persists and answers
//! `persisted_only`, it never starts one. ADR-0003 records the split.
//!
//! Dependencies are the shared runner path's seams ([`RunnerHost`]): no
//! Tauri `State`, so the remote module calls this as it is.

use crate::api::{GalleyApi, MessageBrief, Origin, RuntimeKind, SessionId};
use crate::db::MessageAttachmentCreate;
use crate::error::GalleyError;
use crate::ipc::{AskUserResponseCommand, IpcCommand, UserMessageCommand};
use crate::notify::notify;
use crate::runner_manager::{is_side_question, QueueOffer, SendCommandError};
use crate::session_runner::{
    ensure_session_runner, EnsureOptions, EnsureOutcome, GaConfigPref, LlmChoice, ReplayTimeouts,
    RunnerHost, SessionRunnerError,
};
use crate::socket_listener::RunnerPort;
use serde::Serialize;

/// Tauri event announcing a persisted user message. The socket handlers,
/// the queue drain and the Goal engine send it too, with the same shape
/// minus `clientRequestId`.
pub const USER_MESSAGE_PERSISTED_EVENT: &str = "user-message-persisted";

/// Payload of [`USER_MESSAGE_PERSISTED_EVENT`] on this path. One message
/// is announced up to twice, with the same `message.id`: `pending` once
/// it is persisted, then `dispatched` or `persisted_only`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserMessagePersistedPayload {
    pub session_id: String,
    pub message: MessageBrief,
    /// `pending` | `dispatched` | `persisted_only`.
    pub dispatch: &'static str,
    /// The sender's own id for this send, echoed so the page that sent it
    /// can match the row to its optimistic echo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_request_id: Option<String>,
}

/// One user send.
pub struct SendRequest {
    pub session_id: String,
    pub text: String,
    /// Decoded image attachments
    /// (`commands::decode_message_attachments` enforces the limits).
    pub images: Vec<MessageAttachmentCreate>,
    /// Echoed on this message's `user-message-persisted` broadcasts.
    pub client_request_id: Option<String>,
    /// Stamped on the persisted row (and a queued item).
    pub origin: Origin,
    /// Caller label for the ensure (`runner-spawned-external`).
    pub via: &'static str,
    /// Start a runner on this model instead of the session row's choice;
    /// only takes effect when one has to be started.
    pub llm_override: Option<LlmChoice>,
    /// The caller's `ga_config` in place of the stored pref; only takes
    /// effect when a runner has to be started (see
    /// `SpawnRequest::ga_config`).
    pub ga_config: Option<GaConfigPref>,
    /// Bounds of each history-replay attempt inside the ensure.
    pub timeouts: ReplayTimeouts,
}

/// What a send did.
#[derive(Debug)]
pub enum SendOutcome {
    /// Persisted and dispatched; `message` is the persisted row.
    Dispatched {
        message: MessageBrief,
        runner: EnsureOutcome,
    },
    /// Held in the session's queue (a run is open); persisted when it is
    /// dispatched. Text only.
    Queued { queue_id: String, position: usize },
    /// A `/btw` side question went to the runner; nothing persisted.
    SideQuestion { runner: EnsureOutcome },
}

/// Why a send failed. A failure after the message was persisted has
/// already been broadcast as `persisted_only`.
#[derive(Debug)]
pub enum SendError {
    /// Session missing / archived, or a database read or write failed.
    Db(GalleyError),
    /// No runner with the session's history could be had
    /// ([`crate::session_runner::ensure_session_runner`]).
    Runner(SessionRunnerError),
    /// The session's attached runtime reported that its model cannot
    /// receive images.
    ImagesNotSupported,
    /// A run is open (or messages are waiting), and a message with
    /// images may not wait in the queue.
    ImagesNotQueueable,
    /// Images on a message that cannot carry them: a `/btw` side question
    /// or the answer to an `ask_user` question.
    ImagesNotAllowed(&'static str),
    /// The runner did not take the command.
    DispatchFailed(String),
}

impl SendError {
    /// Stable tag of the four send-specific failures (`None` for the
    /// database and runner families, which carry their own).
    pub fn tag(&self) -> Option<&'static str> {
        match self {
            SendError::Db(_) | SendError::Runner(_) => None,
            SendError::ImagesNotSupported => Some("images_not_supported"),
            SendError::ImagesNotQueueable => Some("images_not_queueable"),
            SendError::ImagesNotAllowed(_) => Some("images_not_allowed"),
            SendError::DispatchFailed(_) => Some("dispatch_failed"),
        }
    }

    /// Human-readable detail of the four send-specific failures.
    pub fn detail(&self) -> String {
        match self {
            SendError::Db(e) => e.to_string(),
            SendError::Runner(e) => format!("{e:?}"),
            SendError::ImagesNotSupported => {
                "the session's model cannot receive images (its runner reported imagesSupported: false)"
                    .into()
            }
            SendError::ImagesNotQueueable => {
                "a run is in progress and a message with images cannot wait in the queue".into()
            }
            SendError::ImagesNotAllowed(what) => format!("images are not allowed on {what}"),
            SendError::DispatchFailed(reason) => reason.clone(),
        }
    }
}

/// Send one user message for the GUI or the phone. See the module docs
/// for the steps; the order is the contract.
pub async fn send_user_message(
    host: &RunnerHost<'_>,
    req: SendRequest,
) -> Result<SendOutcome, SendError> {
    let sid = req.session_id.clone();
    host.galley
        .assert_session_writable(&SessionId(sid.clone()))
        .await
        .map_err(SendError::Db)?;

    if is_side_question(&req.text) {
        return send_side_question(host, req).await;
    }

    if req.images.is_empty() {
        match host
            .runner
            .queue_offer(&sid, req.text.clone(), Some(req.origin.clone()))
            .await
        {
            QueueOffer::Queued { queue_id, position } => {
                crate::message_queue::notify_queue_changed_via(
                    host.runner,
                    host.notifier.as_ref(),
                    &sid,
                )
                .await;
                return Ok(SendOutcome::Queued { queue_id, position });
            }
            QueueOffer::DispatchNow => {}
        }
    } else if !host.runner.queue_try_reserve(&sid).await {
        return Err(SendError::ImagesNotQueueable);
    }

    // The gate is ours from here on: every way out but success releases it.
    let result = send_reserved(host, req).await;
    if result.is_err() {
        host.runner.queue_release_run(&sid).await;
    }
    result
}

/// Steps 4-7, with the run gate held by the caller.
async fn send_reserved(host: &RunnerHost<'_>, req: SendRequest) -> Result<SendOutcome, SendError> {
    let sid = req.session_id.as_str();
    let has_images = !req.images.is_empty();
    // Nobody else dispatches while we hold the gate, so the question
    // cannot be answered from under us.
    let answer = host.runner.run_state(sid).await.ask_pending;
    if answer && has_images {
        return Err(SendError::ImagesNotAllowed(
            "an answer to an ask_user question",
        ));
    }
    if has_images && !answer {
        refuse_unsupported_images(host, sid).await?;
    }

    let message = host
        .galley
        .send_message_with_attachments_db(
            SessionId(sid.to_string()),
            req.text.clone(),
            req.origin.clone(),
            req.images,
        )
        .await
        .map_err(SendError::Db)?;
    let announce = |dispatch: &'static str| {
        notify(
            host.notifier.as_ref(),
            USER_MESSAGE_PERSISTED_EVENT,
            &UserMessagePersistedPayload {
                session_id: sid.to_string(),
                message: message.clone(),
                dispatch,
                client_request_id: req.client_request_id.clone(),
            },
        );
    };
    announce("pending");
    crate::session_title::derive_and_announce(host.galley, host.notifier.as_ref(), sid, &req.text)
        .await;

    let runner = match ensure_session_runner(
        host,
        sid,
        EnsureOptions {
            via: req.via,
            // The session being sent to is the one to keep.
            active_session_id: Some(sid),
            llm_override: req.llm_override,
            ga_config: req.ga_config,
            holds_run_gate: true,
            timeouts: req.timeouts,
        },
    )
    .await
    {
        Ok(runner) => runner,
        Err(e) => {
            announce("persisted_only");
            return Err(SendError::Runner(e));
        }
    };

    let absolute_turn_index = message.turn_index.map(i64::from);
    let cmd = if answer {
        IpcCommand::AskUserResponse(AskUserResponseCommand {
            text: req.text,
            absolute_turn_index,
        })
    } else {
        IpcCommand::UserMessage(UserMessageCommand {
            text: req.text,
            images: message.attachments.iter().map(|a| a.path.clone()).collect(),
            visibility: None,
            absolute_turn_index,
        })
    };
    if let Err(e) = host.runner.send_command(sid, &cmd).await {
        announce("persisted_only");
        return Err(SendError::DispatchFailed(e.to_string()));
    }
    announce("dispatched");
    Ok(SendOutcome::Dispatched { message, runner })
}

/// An attached (external) runtime whose live runner reported
/// `imagesSupported: false` cannot deliver images. Managed always can;
/// a session with no live runner (or none that reported yet) is let
/// through — the same optimistic rule as the GUI's composer.
async fn refuse_unsupported_images(host: &RunnerHost<'_>, sid: &str) -> Result<(), SendError> {
    let session = host
        .galley
        .session_brief(SessionId(sid.to_string()))
        .await
        .map_err(SendError::Db)?;
    if session.ga_runtime_kind != RuntimeKind::External || host.runner.live_pid(sid).await.is_none()
    {
        return Ok(());
    }
    match host.runner.ready_snapshot(sid).await {
        Some(ready) if !ready.images_supported => Err(SendError::ImagesNotSupported),
        _ => Ok(()),
    }
}

/// `/btw`: not persisted, not gated, never queued — the bridge answers it
/// beside whatever runs. Only the answer is visible elsewhere.
async fn send_side_question(
    host: &RunnerHost<'_>,
    req: SendRequest,
) -> Result<SendOutcome, SendError> {
    if !req.images.is_empty() {
        return Err(SendError::ImagesNotAllowed("a side question (/btw)"));
    }
    let sid = req.session_id.as_str();
    let runner = ensure_session_runner(
        host,
        sid,
        EnsureOptions {
            via: req.via,
            active_session_id: Some(sid),
            llm_override: req.llm_override,
            ga_config: req.ga_config,
            holds_run_gate: false,
            timeouts: req.timeouts,
        },
    )
    .await
    .map_err(SendError::Runner)?;
    host.runner
        .send_command(
            sid,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: req.text,
                images: vec![],
                visibility: None,
                absolute_turn_index: None,
            }),
        )
        .await
        .map_err(|e| SendError::DispatchFailed(e.to_string()))?;
    Ok(SendOutcome::SideQuestion { runner })
}

/// What [`stop_session_run`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    /// `abort` reached the runner.
    AbortSent,
    /// Nothing to stop: no run open, no turn going, or no live runner.
    AlreadyStopped,
}

impl StopOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            StopOutcome::AbortSent => "abort_sent",
            StopOutcome::AlreadyStopped => "already_stopped",
        }
    }
}

/// Stop the session's run for the GUI or the phone: `abort` when a run
/// is open or a turn is going (`open_run || agent_running` — the gate
/// stays open across a multi-turn run's gaps, where `agent_running`
/// flickers false) and a live runner is there to receive it. A runner
/// gone by the time the command is written reads as already stopped.
/// Socket `session.stop` keeps its own rule.
pub async fn stop_session_run(
    runner: &dyn RunnerPort,
    session_id: &str,
) -> Result<StopOutcome, SendCommandError> {
    let state = runner.run_state(session_id).await;
    if !(state.open_run || state.agent_running) || runner.live_pid(session_id).await.is_none() {
        return Ok(StopOutcome::AlreadyStopped);
    }
    match runner.send_command(session_id, &IpcCommand::Abort).await {
        Ok(()) => Ok(StopOutcome::AbortSent),
        Err(SendCommandError::ProcessGone { .. }) => Ok(StopOutcome::AlreadyStopped),
        Err(e) => Err(e),
    }
}
