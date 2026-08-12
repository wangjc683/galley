//! Outbound message queue — Core-side orchestration (galley#19 / #20).
//!
//! The queue STATE lives in [`RunnerManager`] (per-session, in-memory;
//! see `runner_manager::queue` for the model). This module owns the
//! two pieces that need DB + notifier context:
//!
//! - [`dispatch_queued_message`]: persist a dequeued item into
//!   `messages` and send it to the bridge — the one shared "actually
//!   run it now" path used by the drain task, the jump command, and
//!   the dispatch-now branch of enqueue-capable send paths.
//! - [`spawn_queue_drain_task`]: the single global consumer of
//!   [`RunSignal`]s wired at app init. On `RunComplete` it pops the
//!   next allowed item and dispatches it; on `Closed` it just lets the
//!   manager close the run gate (queue held for manual resume — PRD
//!   定案 4, no auto-respawn).
//!
//! Queued items are persisted only HERE, at dispatch time (定案 5):
//! transcript order always matches execution order and a removed item
//! leaves no ghost row.

use crate::api::{
    GalleyApi, Origin, OriginVia, QueuedMessage, SessionId, SessionQueueChangedPayload,
    SESSION_QUEUE_CHANGED_EVENT,
};
use crate::db::SqliteGalley;
use crate::ipc::{IpcCommand, UserMessageCommand};
use crate::notify::Notifier;
use crate::runner_manager::{RunSignal, RunnerManager};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::mpsc;

/// Wire twin of the socket layer's `user-message-persisted` payload
/// (socket_listener/session_cmds.rs `UserMessagePersistedPayload` —
/// keep the shape in sync). Re-declared here because queue dispatches
/// happen outside any socket request context, but the GUI listener
/// must see the exact same event shape either way.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QueueDispatchPersistedPayload {
    session_id: String,
    message: crate::api::MessageBrief,
    dispatch: &'static str,
}

/// Broadcast one session's full queue snapshot. Called after every
/// mutation — enqueue sites, remove, jump, and the drain task.
pub async fn notify_queue_changed(
    manager: &RunnerManager,
    notifier: &Arc<dyn Notifier>,
    session_id: &str,
) {
    let items = manager.queue_snapshot(session_id).await;
    crate::notify::notify(
        notifier.as_ref(),
        SESSION_QUEUE_CHANGED_EVENT,
        &SessionQueueChangedPayload {
            session_id: session_id.to_string(),
            items,
        },
    );
}

/// Persist + dispatch one dequeued item. The caller must hold the run
/// gate reservation (queue_take_next / QueueJump::DispatchNow /
/// QueueOffer::DispatchNow all reserve it). On dispatch failure the
/// item is re-queued at the front and the gate released, so nothing is
/// lost; the persisted row stays (same "persisted_only" standing as a
/// CLI send to a dead runner).
pub async fn dispatch_queued_message(
    galley: &SqliteGalley,
    manager: &RunnerManager,
    notifier: &Arc<dyn Notifier>,
    session_id: &str,
    item: QueuedMessage,
) {
    let origin = item.origin.clone().unwrap_or(Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
    });
    let brief = match galley
        .send_message(SessionId(session_id.to_string()), item.text.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[queue {session_id}] persist failed, requeueing: {e}");
            manager.queue_requeue_front(session_id, item).await;
            notify_queue_changed(manager, notifier, session_id).await;
            return;
        }
    };
    let dispatch = match manager
        .send_command(
            session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: item.text.clone(),
                images: vec![],
                visibility: None,
                absolute_turn_index: brief.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => "dispatched",
        Err(e) => {
            eprintln!("[queue {session_id}] dispatch failed: {e}");
            // Row is persisted; the run never started. Release the
            // gate so the queue resumes on the next manual action.
            manager.queue_release_run(session_id).await;
            "persisted_only"
        }
    };
    crate::notify::notify(
        notifier.as_ref(),
        "user-message-persisted",
        &QueueDispatchPersistedPayload {
            session_id: session_id.to_string(),
            message: brief,
            dispatch,
        },
    );
    notify_queue_changed(manager, notifier, session_id).await;
}

/// Global drain task — single consumer of the manager's run signals,
/// wired once at app init (`app_setup::start_background_services`).
/// One task for all sessions keeps pop + dispatch strictly serialized
/// per signal, so two RunCompletes can never double-dispatch a
/// session's queue.
///
/// `tauri::async_runtime::spawn`, NOT `tokio::spawn`: the caller is
/// the synchronous setup hook, where no ambient tokio runtime exists —
/// a raw `tokio::spawn` panics the app at startup (broke `tauri dev`
/// on 2026-08-12; same idiom as every other task spawned from
/// `start_background_services`).
pub fn spawn_queue_drain_task(
    galley: SqliteGalley,
    manager: Arc<RunnerManager>,
    notifier: Arc<dyn Notifier>,
    mut rx: mpsc::UnboundedReceiver<RunSignal>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(signal) = rx.recv().await {
            let session_id = match &signal {
                RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => {
                    session_id.clone()
                }
            };
            if let Some(item) = manager.queue_take_next(&signal).await {
                dispatch_queued_message(&galley, &manager, &notifier, &session_id, item).await;
            }
        }
    });
}
