//! Auto-title watcher — Core-side orchestration for LLM session titles.
//!
//! One task per spawned runner (sibling of `spawn_emit_task`): it watches
//! the session's broadcast stream and drives the F2 flow from
//! `.scratch/session-auto-title/`:
//!
//!   run_complete (visible, not aborted)
//!     → still `seed` / `derived`?  → send `generate_title` to the runner
//!   title_generated
//!     → CAS write ([`SqliteGalley::try_apply_auto_title`])
//!     → on success broadcast `session-updated-external` so the GUI's
//!       existing `applyExternalSessionUpdated` picks the title up with
//!       zero GUI-side changes.
//!
//! Failure at any step is silent by design: the session simply keeps its
//! current title and the next run_complete retries. v1 scope: attached on
//! the GUI spawn path only (`runner_commands::spawn_runner`) — socket
//! spawns keep `HandlerCtx`'s narrow `RunnerPort` seam untouched, and
//! CLI / Goal sessions carry real titles by contract anyway.

use crate::api::{SessionBrief, SessionId};
use crate::db::SqliteGalley;
use crate::ipc::{GenerateTitleCommand, IpcCommand, IpcEvent, RunCompleteEvent};
use crate::notify::Notifier;
use crate::runner_manager::{BroadcastItem, RunnerManager};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Char cap for each prompt context snippet sent to the runner. Chars,
/// not bytes — titles are routinely CJK.
const TITLE_CONTEXT_MAX_CHARS: usize = 500;

/// Same wire shape as the socket layer's `SessionExternalPayload` — the
/// GUI listener demultiplexes on `via`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionAutoTitledPayload {
    session: SessionBrief,
    via: &'static str,
}

/// A run qualifies for a title attempt when it is user-visible and was
/// not aborted mid-flight (an aborted first exchange retries next run).
fn run_qualifies(rc: &RunCompleteEvent) -> bool {
    if rc.visibility.as_deref() == Some("internal") {
        return false;
    }
    rc.exit_reason.get("result").and_then(|v| v.as_str()) != Some("ABORTED")
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.trim().chars().take(max_chars).collect()
}

pub(crate) fn spawn_auto_title_task(
    galley: SqliteGalley,
    manager: Arc<RunnerManager>,
    notifier: Arc<dyn Notifier>,
    session_id: String,
    mut rx: broadcast::Receiver<BroadcastItem>,
) {
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(BroadcastItem::Event(boxed)) => match *boxed {
                    IpcEvent::RunComplete(rc) => {
                        if !run_qualifies(&rc) {
                            continue;
                        }
                        match galley.session_title_source(&session_id).await {
                            Ok(Some(src)) if src == "seed" || src == "derived" => {}
                            _ => continue,
                        }
                        let first = match galley.first_visible_user_message(&session_id).await
                        {
                            Ok(Some(content)) if !content.trim().is_empty() => content,
                            _ => continue,
                        };
                        let final_answer = truncate_chars(&rc.final_content, TITLE_CONTEXT_MAX_CHARS);
                        let cmd = IpcCommand::GenerateTitle(GenerateTitleCommand {
                            first_user_message: truncate_chars(&first, TITLE_CONTEXT_MAX_CHARS),
                            final_answer: (!final_answer.is_empty()).then_some(final_answer),
                        });
                        if let Err(e) = manager.send_command(&session_id, &cmd).await {
                            eprintln!("[auto-title {session_id}] send generate_title: {e}");
                        }
                    }
                    IpcEvent::TitleGenerated(event) => {
                        let sid = SessionId(session_id.clone());
                        match galley.try_apply_auto_title(&sid, &event.title).await {
                            Ok(Some(brief)) => {
                                crate::notify::notify(
                                    notifier.as_ref(),
                                    "session-updated-external",
                                    &SessionAutoTitledPayload {
                                        session: brief,
                                        via: "auto-title",
                                    },
                                );
                            }
                            Ok(None) => {} // lost the race to a user rename — drop
                            Err(e) => {
                                eprintln!("[auto-title {session_id}] apply title: {e}");
                            }
                        }
                    }
                    _ => {}
                },
                Ok(BroadcastItem::Malformed(_)) => continue,
                Ok(BroadcastItem::Closed { .. }) => break,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rc(visibility: Option<&str>, result: &str) -> RunCompleteEvent {
        RunCompleteEvent {
            session_id: "s1".into(),
            exit_reason: serde_json::json!({ "result": result, "data": null }),
            final_content: "done".into(),
            total_turns: 1,
            visibility: visibility.map(str::to_string),
            timestamp: "t".into(),
        }
    }

    #[test]
    fn qualifies_visible_completed_run() {
        assert!(run_qualifies(&rc(None, "CURRENT_TASK_DONE")));
        assert!(run_qualifies(&rc(Some("visible"), "EXITED")));
    }

    #[test]
    fn skips_internal_and_aborted_runs() {
        assert!(!run_qualifies(&rc(Some("internal"), "CURRENT_TASK_DONE")));
        assert!(!run_qualifies(&rc(None, "ABORTED")));
    }

    #[test]
    fn truncate_chars_respects_cjk_boundaries() {
        assert_eq!(truncate_chars("  帮我修这个 bug  ", 4), "帮我修这");
        assert_eq!(truncate_chars("short", 500), "short");
    }
}
