//! Tauri commands for the outbound message queue (galley#19/#20).
//!
//! The queue strip drives [`queue_jump_message`] /
//! [`queue_remove_message`]; [`session_queue_snapshot`] serves the
//! initial load. Messages enter the queue through Core's send
//! (`send_user_message`, [`crate::session_send`]) since ticket 02c —
//! the GUI no longer decides whether a run is open. All mutations
//! broadcast `session-queue:changed`; a Core-side dispatch also
//! broadcasts `user-message-persisted`.

use tauri::{AppHandle, State};

use crate::api::QueuedMessage;
use crate::db::SqliteGalley;
use crate::message_queue::{dispatch_queued_message, notify_queue_changed};
use crate::notify::TauriNotifier;
use crate::runner_manager::{QueueJump, RunnerManager};

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
