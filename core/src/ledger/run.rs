//! One mining run: archive IM turns, prepare the batch, start the hidden
//! session, watch it, and move the processed position only when it
//! completed successfully.
//!
//! The session is created the way `session.new` creates one (row + first
//! user message in one transaction, then spawn and dispatch through the
//! shared [`RunnerPort`]), with three differences that keep it out of
//! sight: origin `system` / supervisor [`LEDGER_SUPERVISOR`] (the GUI and
//! phone lists drop it, `super::is_mining_session`), no
//! `session-created-external` / `runner-spawned-external` broadcast and
//! no `runner-event` emit task (no page attaches to it, so no page's LRU
//! can evict it), and a caller-chosen title (no auto-title model call).
//! Afterwards its runner is shut down and its row archived, which also
//! keeps its messages out of search.
//!
//! "Completed successfully" is exact: the run's `run_complete` arrives
//! with GA's `CURRENT_TASK_DONE`, no fatal error was reported during the
//! run, it did not stop on an `ask_user` question, and no event was
//! missed. Anything else — abort, max turns, runner exit, timeout — is a
//! failure: `mined` stays where it was, so the next batch includes this
//! one.

use std::fmt::Display;
use std::fs;
use std::time::Duration;

use chrono::{DateTime, NaiveDateTime, NaiveTime, TimeZone, Utc};
use tokio::sync::broadcast::{self, error::RecvError};

use super::batch::{build_batch, render_batch, task_prompt, Batch};
use super::im_archive::{self, read_archive_from, ArchiveOutcome};
use super::sources;
use super::state::{LastRun, LedgerState, MinedCursor};
use super::{LedgerConfig, LedgerPaths, LEDGER_SUPERVISOR};
use crate::api::{CreateSessionInput, GalleyApi, Origin, OriginVia, RuntimeKind, SessionId};
use crate::db::SqliteGalley;
use crate::ipc::{IpcCommand, IpcEvent, UserMessageCommand};
use crate::runner_manager::BroadcastItem;
use crate::session_runner::{resolve_spawn_args, SpawnEnv, SpawnRequest};
use crate::socket_listener::RunnerPort;

/// The daily run is due from this local time on (first tick at or after
/// it, any time later that day when the Mac was asleep or Galley closed).
pub const RUN_AT: NaiveTime = match NaiveTime::from_hms_opt(4, 0, 0) {
    Some(t) => t,
    None => panic!("04:00 is a time"),
};

/// A run still going after this long is stopped and counts as failed.
pub const RUN_TIMEOUT: Duration = Duration::from_secs(3 * 60 * 60);

/// What a run may touch.
pub struct MiningDeps<'a> {
    pub galley: &'a SqliteGalley,
    pub runner: &'a dyn RunnerPort,
    /// The Tauri app in production (managed spawns need it); a fake in
    /// tests.
    pub env: Option<&'a dyn SpawnEnv>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// The daily tick: once per local day, from [`RUN_AT`].
    Scheduled,
    /// `run_ledger_now`: whenever asked.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum RunReport {
    /// Nothing done: attach mode, not due, or a run already going.
    Skipped { reason: String },
    /// Nothing new since the last processed position: the position moved
    /// on without a model call.
    Empty,
    #[serde(rename_all = "camelCase")]
    Succeeded { session_id: String, turns: usize },
    #[serde(rename_all = "camelCase")]
    Failed {
        session_id: Option<String>,
        reason: String,
    },
}

/// The batch a run is given, and the position it stands for.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub batch: Batch,
    pub pending: MinedCursor,
    pub archive: ArchiveOutcome,
}

/// Archive new IM turns, then gather everything not yet processed: GUI
/// turns from the processed instant (or `since`) up to `now`, archive
/// lines from the processed offset to the end. Advances
/// `state.im_logs`; leaves `mined` alone.
pub async fn prepare<Tz: TimeZone>(
    galley: &SqliteGalley,
    paths: &LedgerPaths,
    config: &LedgerConfig,
    state: &mut LedgerState,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<Prepared, String>
where
    Tz::Offset: Display,
{
    let since = config.since_instant(tz);
    let archive = im_archive::archive_im_turns_in(paths, state, since, true, now.into(), tz)
        .map_err(|e| format!("archiving IM turns: {e}"))?;

    let processed = state
        .mined
        .as_ref()
        .and_then(|m| DateTime::parse_from_rfc3339(&m.gui_until).ok())
        .map(|t| t.with_timezone(&Utc));
    let from = processed.map_or(since, |t| t.max(since));
    // Whole seconds: `created_at` has second precision, so a message
    // stamped in this very second is left for the next run instead of
    // being half-read.
    let until = DateTime::<Utc>::from_timestamp(now.timestamp(), 0).expect("in range");
    let gui = sources::gui_turns(galley, from, until)
        .await
        .map_err(|e| format!("reading GUI turns: {e}"))?;

    let im_from = state.mined.as_ref().map_or(0, |m| m.im_archive_offset);
    let (records, im_end) = read_archive_from(&paths.archive_file(), im_from)
        .map_err(|e| format!("reading the IM archive: {e}"))?;

    Ok(Prepared {
        batch: build_batch(&gui, &records, tz),
        pending: MinedCursor {
            gui_until: until.to_rfc3339(),
            im_archive_offset: im_end,
        },
        archive,
    })
}

/// Due once per local day, from [`RUN_AT`].
pub fn due(state: &LedgerState, now_local: NaiveDateTime) -> bool {
    if now_local.time() < RUN_AT {
        return false;
    }
    let today = now_local.date().format("%Y-%m-%d").to_string();
    state.last_attempt_date.as_deref() != Some(today.as_str())
}

/// What [`begin`] left to do.
#[derive(Debug, Clone)]
pub enum Begun {
    /// Nothing new: the position already moved, no model call needed.
    Empty,
    /// The batch file is written and recorded as pending; `task` is what
    /// the mining session is given.
    Ready { batch: Batch, task: String },
}

/// Prepare one attempt and record it in `state.json`: archive IM turns,
/// gather what is new, stamp today's attempt, then either move the
/// position (nothing new) or write the batch file and record its position
/// as pending. The production run and the eval harness
/// (`examples/ledger_eval_prepare.rs`) share it.
pub async fn begin<Tz: TimeZone>(
    galley: &SqliteGalley,
    paths: &LedgerPaths,
    config: &LedgerConfig,
    state: &mut LedgerState,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<Begun, String>
where
    Tz::Offset: Display,
{
    let prepared = prepare(galley, paths, config, state, now, tz).await?;
    let local_now = now.with_timezone(tz);
    state.last_attempt_date = Some(local_now.format("%Y-%m-%d").to_string());
    let turns = prepared.batch.turn_count;
    let save = |state: &LedgerState| {
        state
            .save(&paths.state_file())
            .map_err(|e| format!("saving ledger state: {e}"))
    };

    if prepared.batch.is_empty() {
        state.mined = Some(prepared.pending);
        state.pending = None;
        state.last_run = Some(LastRun {
            started_at: now.to_rfc3339(),
            session_id: None,
            outcome: "empty".into(),
            detail: None,
            turns: 0,
        });
        save(state)?;
        return Ok(Begun::Empty);
    }

    let generated_at = local_now.format("%Y-%m-%d %H:%M").to_string();
    fs::create_dir_all(paths.galley_dir())
        .and_then(|()| {
            fs::write(
                paths.batch_file(),
                render_batch(&prepared.batch, &generated_at),
            )
        })
        .map_err(|e| format!("writing the batch: {e}"))?;
    state.pending = Some(prepared.pending);
    state.last_run = Some(LastRun {
        started_at: now.to_rfc3339(),
        session_id: None,
        outcome: "running".into(),
        detail: None,
        turns,
    });
    save(state)?;
    let task = task_prompt(paths, &prepared.batch);
    Ok(Begun::Ready {
        batch: prepared.batch,
        task,
    })
}

/// Settle the attempt [`begin`] recorded. Only `Ok` — a run that
/// completed successfully — turns the pending position into the
/// processed one; a failure drops it, so the next batch repeats this one.
pub fn finish(
    paths: &LedgerPaths,
    state: &mut LedgerState,
    session_id: Option<String>,
    verdict: &Result<(), String>,
) -> std::io::Result<()> {
    let begun = state.last_run.take();
    let (outcome, detail) = match verdict {
        Ok(()) => {
            state.mined = state.pending.take();
            ("succeeded", None)
        }
        Err(reason) => {
            state.pending = None;
            ("failed", Some(reason.clone()))
        }
    };
    state.last_run = Some(LastRun {
        started_at: begun
            .as_ref()
            .map_or_else(|| Utc::now().to_rfc3339(), |r| r.started_at.clone()),
        session_id,
        outcome: outcome.into(),
        detail,
        turns: begun.map_or(0, |r| r.turns),
    });
    state.save(&paths.state_file())
}

/// One attempt. Writes `state.json` (and the batch file when there is
/// something to read); never anything when the active runtime is not the
/// managed one (Rule 1: attach mode runs nothing).
pub async fn run_once<Tz: TimeZone>(
    deps: &MiningDeps<'_>,
    paths: &LedgerPaths,
    config: &LedgerConfig,
    trigger: Trigger,
    now: DateTime<Utc>,
    tz: &Tz,
    timeout: Duration,
) -> RunReport
where
    Tz::Offset: Display,
{
    let failed =
        |session_id: Option<String>, reason: String| RunReport::Failed { session_id, reason };
    match deps.galley.active_runtime_kind().await {
        Ok(RuntimeKind::Managed) => {}
        Ok(_) => {
            return RunReport::Skipped {
                reason: "the active runtime is not the managed one".into(),
            }
        }
        Err(e) => {
            return RunReport::Skipped {
                reason: format!("runtime kind unavailable: {e}"),
            }
        }
    }
    let mut state = match LedgerState::load(&paths.state_file()) {
        Ok(s) => s,
        Err(e) => return failed(None, format!("ledger state: {e}")),
    };
    let local_now = now.with_timezone(tz);
    if trigger == Trigger::Scheduled && !due(&state, local_now.naive_local()) {
        return RunReport::Skipped {
            reason: "not due".into(),
        };
    }

    let (batch, task) = match begin(deps.galley, paths, config, &mut state, now, tz).await {
        Ok(Begun::Empty) => return RunReport::Empty,
        Ok(Begun::Ready { batch, task }) => (batch, task),
        Err(reason) => return failed(None, reason),
    };

    let day = local_now.format("%Y-%m-%d").to_string();
    let (session_id, verdict) = match start_session(deps, &task, &day).await {
        Ok((session_id, rx)) => {
            let verdict = watch_run(rx, timeout).await;
            (Some(session_id), verdict)
        }
        Err((session_id, reason)) => (session_id, Err(reason)),
    };
    if let Some(id) = &session_id {
        wind_down(deps, id).await;
    }
    if let Err(e) = finish(paths, &mut state, session_id.clone(), &verdict) {
        return failed(
            session_id,
            format!("saving ledger state after the run: {e}"),
        );
    }
    match verdict {
        Ok(()) => RunReport::Succeeded {
            session_id: session_id.unwrap_or_default(),
            turns: batch.turn_count,
        },
        Err(reason) => failed(session_id, reason),
    }
}

fn mining_origin() -> Origin {
    Origin {
        via: OriginVia::System,
        supervisor: Some(LEDGER_SUPERVISOR.into()),
        reason: Some("affairs ledger mining".into()),
        client: None,
    }
}

type StartError = (Option<String>, String);

/// Create the hidden session and its task message, spawn its runner on
/// the default model, subscribe, dispatch. The subscription is taken
/// before the dispatch, so the run's `run_complete` cannot be missed.
async fn start_session(
    deps: &MiningDeps<'_>,
    task: &str,
    day: &str,
) -> Result<(String, broadcast::Receiver<BroadcastItem>), StartError> {
    let id = crate::socket_listener::mint_session_id();
    let spawn_args = resolve_spawn_args(
        deps.galley,
        deps.env,
        SpawnRequest {
            session_id: &id,
            project_id: None,
            runtime_kind: RuntimeKind::Managed,
            llm_index: None,
            llm_key: None,
            reasoning_effort: None,
            ga_config: None,
        },
    )
    .await
    .map_err(|e| (None, format!("spawn arguments: {e:?}")))?;

    let input = CreateSessionInput {
        id: id.clone(),
        title: format!("事项账本整理 {day}"),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let db_err = |e: crate::error::GalleyError| (None, format!("creating the session: {e}"));
    let mut tx = deps.galley.begin_tx().await.map_err(db_err)?;
    deps.galley
        .create_session_in_tx(&mut tx, input, mining_origin())
        .await
        .map_err(db_err)?;
    let message = deps
        .galley
        .send_message_in_tx(
            &mut tx,
            SessionId(id.clone()),
            task.to_string(),
            mining_origin(),
        )
        .await
        .map_err(db_err)?;
    tx.commit()
        .await
        .map_err(|e| (None, format!("creating the session: {e}")))?;

    let failed = |reason: String| (Some(id.clone()), reason);
    let pid = deps
        .runner
        .spawn(spawn_args, None)
        .await
        .map_err(|e| failed(format!("runner spawn: {e:?}")))?;
    // No history to replay: the runner holds the whole conversation.
    deps.runner.release_close(&id, pid, true).await;
    let rx = deps
        .runner
        .subscribe(&id)
        .await
        .ok_or_else(|| failed("runner exited before Core could subscribe".into()))?;
    deps.runner
        .send_command(
            &id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: task.to_string(),
                images: vec![],
                visibility: None,
                absolute_turn_index: message.turn_index.map(i64::from),
            }),
        )
        .await
        .map_err(|e| failed(format!("dispatching the task: {e:?}")))?;
    Ok((id, rx))
}

/// Follow one run on its runner's broadcast until it settles.
pub async fn watch_run(
    mut rx: broadcast::Receiver<BroadcastItem>,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut fatal: Option<String> = None;
    let mut asked = false;
    let mut lagged = false;
    loop {
        let item = match tokio::time::timeout_at(deadline, rx.recv()).await {
            Err(_) => return Err(format!("still running after {}s", timeout.as_secs())),
            Ok(Err(RecvError::Lagged(_))) => {
                lagged = true;
                continue;
            }
            Ok(Err(RecvError::Closed)) => {
                return Err("the runner's event stream ended before the run completed".into())
            }
            Ok(Ok(item)) => item,
        };
        match item {
            BroadcastItem::Event(event) => match *event {
                IpcEvent::Error(e) if e.category != "business" && e.severity == "error" => {
                    fatal = Some(e.message);
                }
                IpcEvent::AskUser(_) => asked = true,
                IpcEvent::RunComplete(e) => {
                    let result = e
                        .exit_reason
                        .get("result")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("?");
                    return match (result, fatal, asked, lagged) {
                        (_, Some(err), _, _) => Err(format!("runtime error: {err}")),
                        (_, None, true, _) => Err("the run stopped on an ask_user question".into()),
                        (_, None, false, true) => {
                            Err("missed runner events; outcome unknown".into())
                        }
                        ("CURRENT_TASK_DONE", None, false, false) => Ok(()),
                        (other, None, false, false) => Err(format!("run ended with {other}")),
                    };
                }
                _ => {}
            },
            BroadcastItem::Closed { .. } => {
                return Err("the runner exited before the run completed".into())
            }
            BroadcastItem::Malformed(_) => {}
        }
    }
}

/// Stop the mining runner and archive its row (out of search, out of
/// every non-`--all` list). Best effort: a failure here does not change
/// the run's verdict.
async fn wind_down(deps: &MiningDeps<'_>, session_id: &str) {
    if let Err(e) = deps
        .runner
        .shutdown(session_id, Some(Duration::from_secs(10)))
        .await
    {
        eprintln!("[ledger] shutting down mining runner {session_id}: {e:?}");
    }
    if let Err(e) = deps
        .galley
        .archive_session(SessionId(session_id.to_string()), mining_origin())
        .await
    {
        eprintln!("[ledger] archiving mining session {session_id}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::{AskUserEvent, ErrorEvent, RunCompleteEvent};
    use serde_json::json;

    fn complete(result: &str) -> BroadcastItem {
        BroadcastItem::Event(Box::new(IpcEvent::RunComplete(RunCompleteEvent {
            session_id: "s".into(),
            exit_reason: json!({ "result": result, "data": null }),
            final_content: String::new(),
            total_turns: 3,
            visibility: None,
            timestamp: "t".into(),
        })))
    }

    fn error(category: &str, severity: &str) -> BroadcastItem {
        BroadcastItem::Event(Box::new(IpcEvent::Error(ErrorEvent {
            session_id: "s".into(),
            message: "boom".into(),
            category: category.into(),
            severity: severity.into(),
            retryable: false,
            hint: None,
            context: None,
            traceback: None,
            visibility: None,
            timestamp: "t".into(),
        })))
    }

    async fn verdict(items: Vec<BroadcastItem>) -> Result<(), String> {
        let (tx, rx) = broadcast::channel(16);
        for item in items {
            tx.send(item).unwrap();
        }
        watch_run(rx, Duration::from_secs(5)).await
    }

    #[tokio::test]
    async fn only_a_clean_task_done_succeeds() {
        assert_eq!(verdict(vec![complete("CURRENT_TASK_DONE")]).await, Ok(()));
        // A business error (e.g. a refused tool) is not fatal.
        assert_eq!(
            verdict(vec![
                error("business", "error"),
                complete("CURRENT_TASK_DONE")
            ])
            .await,
            Ok(())
        );
        for result in [
            "ABORTED",
            "MAX_TURNS_EXCEEDED",
            "DONE_WITHOUT_EXIT",
            "EXITED",
        ] {
            assert!(verdict(vec![complete(result)]).await.is_err(), "{result}");
        }
        assert!(verdict(vec![
            error("runtime", "error"),
            complete("CURRENT_TASK_DONE")
        ])
        .await
        .is_err());
        let ask = BroadcastItem::Event(Box::new(IpcEvent::AskUser(AskUserEvent {
            session_id: "s".into(),
            question: "?".into(),
            candidates: vec![],
            timestamp: "t".into(),
        })));
        assert!(verdict(vec![ask, complete("CURRENT_TASK_DONE")])
            .await
            .is_err());
    }

    #[tokio::test]
    async fn a_runner_exit_or_a_silent_runner_fails() {
        let closed = BroadcastItem::Closed {
            code: Some(1),
            signal: None,
            quiet: false,
        };
        assert!(verdict(vec![closed]).await.is_err());
        let (_tx, rx) = broadcast::channel::<BroadcastItem>(4);
        assert!(watch_run(rx, Duration::from_millis(50)).await.is_err());
    }

    #[test]
    fn due_once_a_day_from_four() {
        let at = |s: &str| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap();
        let mut state = LedgerState::default();
        assert!(!due(&state, at("2026-10-12 03:59")));
        assert!(due(&state, at("2026-10-12 04:00")));
        assert!(due(&state, at("2026-10-12 23:00")));
        state.last_attempt_date = Some("2026-10-12".into());
        assert!(!due(&state, at("2026-10-12 23:00")));
        assert!(!due(&state, at("2026-10-13 03:00")));
        assert!(due(&state, at("2026-10-13 09:30")));
    }
}
