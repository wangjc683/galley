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
//!   定案 4, no auto-respawn). Around that step it runs the main chat's
//!   subtask hooks ([`crate::subtask`], [`crate::subtask_report`]).
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
use crate::socket_listener::RunnerPort;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
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
    notify_queue_changed_via(manager, notifier.as_ref(), session_id).await;
}

/// [`notify_queue_changed`] over the registry seam, for callers that
/// hold a [`RunnerPort`] rather than the manager (Core's send,
/// `crate::session_send`).
pub async fn notify_queue_changed_via(
    runner: &dyn RunnerPort,
    notifier: &dyn Notifier,
    session_id: &str,
) {
    let items = runner.queue_snapshot(session_id).await;
    crate::notify::notify(
        notifier,
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
        client: None,
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
    // A session's first message may well be a queued one (ticket 02c:
    // Core derives the title wherever it persists a user message).
    crate::session_title::derive_and_announce(galley, notifier.as_ref(), session_id, &item.text)
        .await;
    // The assistant's send-back that waited behind a run (ticket 29).
    if let Some(origin) = &item.origin {
        crate::subtask::announce_send_back(galley, notifier.as_ref(), session_id, origin).await;
    }
    notify_queue_changed(manager, notifier, session_id).await;
}

/// Global drain task — single consumer of the manager's run signals,
/// wired once at app init (`app_setup::start_background_services`).
/// One task for all sessions keeps pop + dispatch strictly serialized
/// per signal, so two RunCompletes can never double-dispatch a
/// session's queue.
///
/// Per signal, in order: the main chat's reply dispatches its subtasks
/// ([`crate::subtask::after_run_complete`]); a subtask's run that ended
/// is reported to its main chat
/// ([`crate::subtask_report::record_run_end`], read while the run gate
/// still shows the run); the queue step; then the main chat is woken for
/// waiting reports — the one just reported to, and this session if it is
/// a main chat that took no queued message, so the user's queued
/// messages go before a report ([`crate::subtask_report::spawn_wake_if_due`]).
/// Before the queue step, too: a main chat turn that a wake for due
/// scheduled tasks started settles them
/// ([`crate::subtask_report::record_wake_run_end`]), and the tasks the
/// assistant made in the run get its reply's turn
/// ([`SqliteGalley::settle_scheduled_created_in`], ticket 33).
/// `reports` is the app's one store, shared with the scheduler, which
/// adds due tasks to it.
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
    app: Option<AppHandle>,
    reports: Arc<crate::subtask_report::SubtaskReports>,
    mut rx: mpsc::UnboundedReceiver<RunSignal>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(signal) = rx.recv().await {
            let session_id = match &signal {
                RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => {
                    session_id.clone()
                }
            };
            // The main chat's subtasks (ticket 06a): read the settled
            // run's reply before the next queued message can start a run
            // that writes another one. Dispatched in the background.
            if matches!(signal, RunSignal::RunComplete { .. }) {
                crate::subtask::after_run_complete(
                    &galley,
                    &manager,
                    &notifier,
                    &reports,
                    app.as_ref(),
                    &session_id,
                )
                .await;
            }
            // A subtask's run that ended reports to its main chat
            // (ticket 29), read before the queue step closes its gate.
            let report_to =
                crate::subtask_report::record_run_end(&reports, &galley, manager.as_ref(), &signal)
                    .await;
            // Due scheduled tasks a wake carried: delivered, or not
            // (ticket 33). Then the tasks the assistant made in the run.
            crate::subtask_report::record_wake_run_end(
                &reports,
                &galley,
                manager.as_ref(),
                notifier.as_ref(),
                &signal,
            )
            .await;
            match galley.settle_scheduled_created_in(&session_id).await {
                Ok(0) => {}
                Ok(_) => crate::notify::notify(
                    notifier.as_ref(),
                    crate::api::SCHEDULED_TASKS_CHANGED_EVENT,
                    &(),
                ),
                Err(e) => eprintln!("[queue {session_id}] settling scheduled tasks failed: {e}"),
            }
            let next = manager.queue_take_next(&signal).await;
            let took_next = next.is_some();
            if let Some(item) = next {
                dispatch_queued_message(&galley, &manager, &notifier, &session_id, item).await;
            }
            if let Some(main) = report_to {
                crate::subtask_report::spawn_wake_if_due(
                    &reports,
                    &galley,
                    &manager,
                    &notifier,
                    app.as_ref(),
                    &main,
                )
                .await;
            }
            if !took_next {
                // A main chat whose run ended, with reports waiting.
                crate::subtask_report::spawn_wake_if_due(
                    &reports,
                    &galley,
                    &manager,
                    &notifier,
                    app.as_ref(),
                    &session_id,
                )
                .await;
            }
        }
    });
}
