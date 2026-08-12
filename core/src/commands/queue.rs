//! Tauri commands for the outbound message queue (galley#19/#20).
//!
//! GUI counterpart of the socket layer's queue-aware `session.send`:
//! the Composer's main-agent send path calls
//! [`queue_or_dispatch_user_message`] whenever it believes a run is
//! open, and the queue strip drives [`queue_jump_message`] /
//! [`queue_remove_message`]. All mutations broadcast
//! `session-queue:changed`; a Core-side dispatch also broadcasts
//! `user-message-persisted`, which the GUI applies the same way as a
//! CLI-originated send (it did not persist locally).

use tauri::{AppHandle, State};

use crate::api::{Origin, OriginVia, QueuedMessage, SessionId};
use crate::db::SqliteGalley;
use crate::message_queue::{dispatch_queued_message, notify_queue_changed};
use crate::notify::TauriNotifier;
use crate::runner_manager::{QueueJump, QueueOffer, RunnerManager};

/// Result of [`queue_or_dispatch_user_message`].
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueSendOutcome {
    /// True when the message entered the queue; false when it was
    /// persisted + dispatched immediately (idle session — the GUI
    /// receives the row via `user-message-persisted`).
    pub queued: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<usize>,
}

fn gui_origin() -> Origin {
    Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
    }
}

#[tauri::command]
pub(crate) async fn queue_or_dispatch_user_message(
    session_id: String,
    text: String,
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
) -> Result<QueueSendOutcome, String> {
    galley
        .assert_session_writable(&SessionId(session_id.clone()))
        .await
        .map_err(|e| e.to_string())?;
    let notifier = TauriNotifier::new(app);
    match manager
        .queue_offer(&session_id, text.clone(), Some(gui_origin()))
        .await
    {
        QueueOffer::Queued { queue_id, position } => {
            notify_queue_changed(manager.inner(), &notifier, &session_id).await;
            Ok(QueueSendOutcome {
                queued: true,
                queue_id: Some(queue_id),
                position: Some(position),
            })
        }
        QueueOffer::DispatchNow => {
            // Race lost (run completed between the GUI's state check
            // and this call): behave exactly like the drain — persist +
            // dispatch Core-side; the GUI picks the row up from the
            // `user-message-persisted` event. The gate reservation is
            // handled inside dispatch_queued_message's failure paths.
            let item = QueuedMessage {
                queue_id: String::new(),
                text,
                origin: Some(gui_origin()),
                queued_at: String::new(),
            };
            dispatch_queued_message(&galley, manager.inner(), &notifier, &session_id, item).await;
            Ok(QueueSendOutcome {
                queued: false,
                queue_id: None,
                position: None,
            })
        }
    }
}

/// 插队: move a queued item to the front and preempt the open run.
#[tauri::command]
pub(crate) async fn queue_jump_message(
    session_id: String,
    queue_id: String,
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
) -> Result<bool, String> {
    let notifier = TauriNotifier::new(app);
    match manager.queue_jump(&session_id, &queue_id).await {
        QueueJump::AbortThenDrain => {
            // Best-effort — abort failure leaves the item at the front,
            // which still honors "run me first" on the next drain.
            let _ = manager
                .send_command(&session_id, &crate::ipc::IpcCommand::Abort)
                .await;
            notify_queue_changed(manager.inner(), &notifier, &session_id).await;
            Ok(true)
        }
        QueueJump::DispatchNow(item) => {
            dispatch_queued_message(&galley, manager.inner(), &notifier, &session_id, item).await;
            Ok(true)
        }
        QueueJump::NotFound => Ok(false),
    }
}

/// Remove a queued item; returns it (verbatim text) so the GUI's
/// "edit = remove + refill composer" flow works without a second call.
#[tauri::command]
pub(crate) async fn queue_remove_message(
    session_id: String,
    queue_id: String,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
) -> Result<Option<QueuedMessage>, String> {
    let removed = manager.queue_remove(&session_id, &queue_id).await;
    if removed.is_some() {
        let notifier = TauriNotifier::new(app);
        notify_queue_changed(manager.inner(), &notifier, &session_id).await;
    }
    Ok(removed)
}

/// Current queue snapshot for one session — the GUI's initial load /
/// session-switch fetch; live updates ride `session-queue:changed`.
#[tauri::command]
pub(crate) async fn session_queue_snapshot(
    session_id: String,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
) -> Result<Vec<QueuedMessage>, String> {
    Ok(manager.queue_snapshot(&session_id).await)
}
