//! Core's one path for "make sure this session has a runner" (ticket 02a,
//! `.scratch/ios-client/issues/02-core-send-takeover.md`).
//!
//! Before 02a the GUI started runners itself — `spawn_runner` with
//! arguments assembled in TypeScript — while the socket transport had its
//! own `ensure_session_runner` + spawn config. A phone client needs the
//! same capability, and Rule 5 puts it in Core, so every caller now comes
//! through here:
//!
//! - the GUI, via the Tauri command `runner_commands::ensure_session_runner`;
//! - Core's send for the GUI and the phone ([`crate::session_send`],
//!   ticket 02c), with the run gate already reserved;
//! - Goal dispatch, via `socket_listener::ensure_runner_for_session`;
//! - socket `session.new`, via [`spawn_and_attach`] (it always spawns: the
//!   session did not exist a moment ago);
//! - next, the remote module.
//!
//! What a Core-started runner gets, whoever asked ([`spawn_and_attach`]):
//! the `runner-event` emit task, the auto-title watcher
//! ([`crate::auto_title`]), and a `runner-spawned-external` broadcast so a
//! page that did not ask can attach. (`RunnerManager::spawn` itself adds
//! the turn-persistence / queue watcher.)
//!
//! [`ensure_session_runner`] is single-flight per session: concurrent
//! calls for one session spawn once and all get the same pid; calls for
//! different sessions never wait on each other. Inside the critical
//! section a live runner is never spawned over — `RunnerManager::spawn`
//! shuts a session's existing runner down first, so that would kill its
//! run.
//!
//! Success means more than "alive" since ticket 02b: the runner's GA
//! history holds the session's persisted conversation. A runner starts
//! empty, so for a session with completed turns ensure replays them
//! ([`replay`]: wait for `ready`, send `load_history`, wait for
//! `history_loaded`) before it returns, and records the runner as
//! confirmed (in the process, so it dies with it). A live runner that is
//! not confirmed gets the same replay when it is idle; one that is running
//! is left alone (`load_history` replaces the history a run is using, and
//! the runner refuses it mid-run). A failed replay restarts the runner
//! once, quietly; a second failure is [`SessionRunnerError::HistoryReplay`].
//! The whole replay holds the single-flight slot, so a concurrent ensure
//! finds a confirmed runner.
//!
//! "Quietly" is load-bearing. While ensure replays into a runner it holds
//! that runner's close (`RunnerPort::spawn_held` / `hold_close`), and a
//! runner it replaces is retired (`RunnerPort::retire`): neither close
//! reaches the drain task as `RunSignal::Closed` — which would release the
//! run gate a Goal reserved before calling ensure and park its goal as
//! paused — nor the GUI as `runner-closed`, which would tear down the
//! listeners of the page waiting on this very ensure. A held runner that
//! exits and is not replaced has its close announced when ensure lets go
//! (`RunnerPort::release_close`).
//!
//! Dependencies are seams, not transports: [`RunnerPort`] (the registry,
//! faked in tests), [`Notifier`], and [`SpawnEnv`] (the Tauri app). No
//! socket wire types, no Tauri `State`.

mod replay;
mod spawn_config;

pub use replay::{
    rows_to_conversation_messages, ConversationMessage, HistoryReplayPayload, HistoryReplayPhase,
    ReplayAttachment, ReplayRow, ReplayTimeouts, RUNNER_HISTORY_REPLAY_EVENT,
};

pub use spawn_config::{
    resolve_spawn_args, resolve_user_python, GaConfigPref, SpawnEnv, SpawnRequest,
};

use crate::api::{GalleyApi, SessionBrief, SessionId};
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::notify::{notify, Notifier};
use crate::runner_manager::{ReadySnapshot, RunnerSpawnError, SpawnArgs};
use crate::socket_listener::RunnerPort;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;

/// Tauri event broadcast whenever Core starts a session runner, so a page
/// that did not start it attaches listeners (`runner-spawned-external`).
/// `via` names the caller: `gui`, `goal`, `session.new`.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunnerSpawnedExternalPayload {
    pub session_id: String,
    pub pid: u32,
    pub via: &'static str,
}

/// What the shared path may touch.
pub struct RunnerHost<'a> {
    pub galley: &'a SqliteGalley,
    pub runner: &'a dyn RunnerPort,
    pub notifier: Arc<dyn Notifier>,
    /// `None` in headless dispatch: managed spawns are refused and the
    /// external bridge cwd comes from the stored pref.
    pub env: Option<&'a dyn SpawnEnv>,
}

/// An explicit model choice that overrides the session row's.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LlmChoice {
    pub index: Option<i64>,
    pub key: Option<String>,
}

pub struct EnsureOptions<'a> {
    /// Caller label for `runner-spawned-external` (and socket messages).
    pub via: &'static str,
    /// The eviction-protected session for the LRU cap
    /// (`RunnerManager::spawn`).
    pub active_session_id: Option<&'a str>,
    /// Model to start with instead of the session row's persisted choice.
    /// The GUI passes one only for a brand-new session that consumes the
    /// EmptyState picker's pending pick.
    pub llm_override: Option<LlmChoice>,
    /// Config to resolve with instead of the stored `ga_config` pref
    /// (GUI transition, see [`SpawnRequest::ga_config`]).
    pub ga_config: Option<GaConfigPref>,
    /// The caller reserved the session's run gate before calling (Goal
    /// dispatch, Core's send). An open gate is then the caller's own, not
    /// a run going on the runner, so it does not keep an idle live runner
    /// from being replayed into or restarted.
    pub holds_run_gate: bool,
    /// Bounds of each replay attempt.
    pub timeouts: ReplayTimeouts,
}

/// Result of [`ensure_session_runner`].
#[derive(Debug, Clone)]
pub struct EnsureOutcome {
    pub pid: u32,
    /// `true` when this call started the runner (including one it
    /// restarted after a failed replay). Its `ready` went out as an event
    /// — before this returns when there was history to replay, since the
    /// replay waits for it. `false` when a live runner was already there.
    pub spawned: bool,
    /// The live runner's latest `ready` state; only on `spawned: false`
    /// (and `None` there too if it has not reported yet).
    pub ready: Option<ReadySnapshot>,
}

/// Why the shared path could not produce a runner. Each transport renders
/// these its own way; the socket rendering is a frozen contract.
#[derive(Debug)]
pub enum SessionRunnerError {
    /// Reading the session, project or prefs failed.
    Db(GalleyError),
    /// Managed runtime requested without an app (headless dispatch).
    ManagedNeedsApp,
    /// External runtime, but no `ga_config` pref has been saved.
    GaConfigMissing,
    /// The stored `ga_config` does not parse.
    GaConfigShape(String),
    /// A required `ga_config` key is blank (`gaPath`, or `bridgeCwd`
    /// in headless dispatch).
    GaConfigKeyMissing(&'static str),
    /// Headless dispatch: the configured bridge cwd is not a directory.
    BridgeCwdNotDir(PathBuf),
    /// Resolving Galley's own bridge cwd failed.
    BridgeCwdResolve(String),
    /// A resolved path is not valid UTF-8.
    NonUtf8Path(&'static str),
    /// Spawn preparation or the spawn itself failed.
    Spawn(RunnerSpawnError),
    /// The runner was spawned but its broadcast was gone before Core
    /// could subscribe (it exited at once).
    SubscribeFailed,
    /// The session's history could not be restored into its runner, even
    /// after one restart; the reason is the last attempt's.
    HistoryReplay(String),
}

/// The two ways [`spawn_and_attach`] fails.
#[derive(Debug)]
pub enum AttachError {
    Spawn(RunnerSpawnError),
    SubscribeFailed,
}

impl From<AttachError> for SessionRunnerError {
    fn from(e: AttachError) -> Self {
        match e {
            AttachError::Spawn(e) => SessionRunnerError::Spawn(e),
            AttachError::SubscribeFailed => SessionRunnerError::SubscribeFailed,
        }
    }
}

/// Make sure `session_id` has a live runner whose GA history holds the
/// session's conversation: return the one it has (replaying into it if it
/// is idle and unconfirmed), or start one from the session's persisted
/// configuration and replay into that. See the module docs for the rules.
pub async fn ensure_session_runner(
    host: &RunnerHost<'_>,
    session_id: &str,
    opts: EnsureOptions<'_>,
) -> Result<EnsureOutcome, SessionRunnerError> {
    let _flight = single_flight::enter(session_id).await;

    if let Some(pid) = host.runner.live_pid(session_id).await {
        return ensure_live_history(host, session_id, pid, &opts).await;
    }

    let session = read_session(host, session_id).await?;
    let args = spawn_args_for(host, session_id, &session, &opts).await?;
    if completed_turns(&session) == 0 {
        // Nothing to replay: the runner's empty history is the session's.
        let pid = attach_spawned(host, args, opts.active_session_id, opts.via, false).await?;
        host.runner.release_close(session_id, pid, true).await;
        return Ok(EnsureOutcome {
            pid,
            spawned: true,
            ready: None,
        });
    }
    let pid = attach_spawned(host, args.clone(), opts.active_session_id, opts.via, true).await?;
    let pid = replay_or_restart(host, session_id, pid, Some(args), &opts).await?;
    Ok(EnsureOutcome {
        pid,
        spawned: true,
        ready: None,
    })
}

/// The live-runner half of [`ensure_session_runner`].
async fn ensure_live_history(
    host: &RunnerHost<'_>,
    session_id: &str,
    pid: u32,
    opts: &EnsureOptions<'_>,
) -> Result<EnsureOutcome, SessionRunnerError> {
    let live = |pid| async move {
        Ok(EnsureOutcome {
            pid,
            spawned: false,
            ready: host.runner.ready_snapshot(session_id).await,
        })
    };
    if host.runner.history_confirmed(session_id, pid).await {
        return live(pid).await;
    }
    let session = read_session(host, session_id).await?;
    if completed_turns(&session) == 0 {
        // Nothing completed yet, so whatever this runner holds is all the
        // session has — and every later turn completes on it.
        host.runner.release_close(session_id, pid, true).await;
        return live(pid).await;
    }
    if run_in_progress(host, session_id, opts).await {
        // Not ours to replace: `load_history` would swap out the history
        // the run is using (the runner refuses it mid-run anyway). It stays
        // unconfirmed; an ensure on the idle runner replays.
        return live(pid).await;
    }
    // An exit before the hold fails the attempt below, which restarts.
    host.runner.hold_close(session_id, pid).await;
    let confirmed = replay_or_restart(host, session_id, pid, None, opts).await?;
    if confirmed == pid {
        live(pid).await
    } else {
        Ok(EnsureOutcome {
            pid: confirmed,
            spawned: true,
            ready: None,
        })
    }
}

/// Replay into held runner `pid`; on failure restart it once (same args
/// for a runner this ensure started, the session row's otherwise) and
/// replay again. Returns the confirmed runner's pid. Every path ends
/// Core's hold on the runner it leaves behind.
async fn replay_or_restart(
    host: &RunnerHost<'_>,
    session_id: &str,
    pid: u32,
    args: Option<SpawnArgs>,
    opts: &EnsureOptions<'_>,
) -> Result<u32, SessionRunnerError> {
    let reason = match replay::replay_once(host, session_id, pid, opts.timeouts).await {
        Ok(replay::Attempt::Confirmed) => {
            let_go(host, session_id, pid, true).await;
            return Ok(pid);
        }
        Ok(replay::Attempt::Failed(reason)) => reason,
        Err(e) => {
            let_go(host, session_id, pid, false).await;
            return Err(SessionRunnerError::Db(e));
        }
    };
    if run_in_progress(host, session_id, opts).await {
        // Something dispatched a run onto it meanwhile: a restart would
        // kill that run.
        eprintln!(
            "[session_runner {session_id}] history replay into pid {pid} failed ({reason}); \
             a run is going on it, not restarting"
        );
        let_go(host, session_id, pid, false).await;
        return Err(SessionRunnerError::HistoryReplay(reason));
    }
    eprintln!(
        "[session_runner {session_id}] history replay into pid {pid} failed ({reason}); \
         restarting the runner once"
    );
    let args = match args {
        Some(args) => args,
        None => {
            let session = match read_session(host, session_id).await {
                Ok(session) => session,
                Err(e) => {
                    let_go(host, session_id, pid, false).await;
                    return Err(e);
                }
            };
            match spawn_args_for(host, session_id, &session, opts).await {
                Ok(args) => args,
                Err(e) => {
                    let_go(host, session_id, pid, false).await;
                    return Err(e);
                }
            }
        }
    };
    host.runner.retire(session_id, pid).await;
    let pid = attach_spawned(host, args, opts.active_session_id, opts.via, true).await?;
    match replay::replay_once(host, session_id, pid, opts.timeouts).await {
        Ok(replay::Attempt::Confirmed) => {
            let_go(host, session_id, pid, true).await;
            Ok(pid)
        }
        Ok(replay::Attempt::Failed(reason)) => {
            let_go(host, session_id, pid, false).await;
            Err(SessionRunnerError::HistoryReplay(reason))
        }
        Err(e) => {
            let_go(host, session_id, pid, false).await;
            Err(SessionRunnerError::Db(e))
        }
    }
}

/// End Core's hold on runner `pid` (recording its history as confirmed
/// when it is). If it exited during the hold, the run gate has been told
/// by the registry; tell the GUI here.
async fn let_go(host: &RunnerHost<'_>, session_id: &str, pid: u32, confirmed: bool) {
    if let Some(closed) = host.runner.release_close(session_id, pid, confirmed).await {
        crate::runner_commands::notify_runner_closed(
            host.notifier.as_ref(),
            session_id,
            closed.code,
            closed.signal,
        );
    }
}

/// A run is going on the session that the caller did not reserve itself.
async fn run_in_progress(
    host: &RunnerHost<'_>,
    session_id: &str,
    opts: &EnsureOptions<'_>,
) -> bool {
    let state = host.runner.run_state(session_id).await;
    state.agent_running || (state.open_run && !opts.holds_run_gate)
}

fn completed_turns(session: &SessionBrief) -> u32 {
    session.turn_count.unwrap_or(0)
}

async fn read_session(
    host: &RunnerHost<'_>,
    session_id: &str,
) -> Result<SessionBrief, SessionRunnerError> {
    host.galley
        .session_brief(SessionId(session_id.to_string()))
        .await
        .map_err(SessionRunnerError::Db)
}

/// Spawn arguments from the session row (or the caller's overrides).
async fn spawn_args_for(
    host: &RunnerHost<'_>,
    session_id: &str,
    session: &SessionBrief,
    opts: &EnsureOptions<'_>,
) -> Result<SpawnArgs, SessionRunnerError> {
    let llm = opts
        .llm_override
        .clone()
        .unwrap_or_else(|| persisted_llm_choice(session));
    resolve_spawn_args(
        host.galley,
        host.env,
        SpawnRequest {
            session_id,
            project_id: session.project_id.as_ref().map(|id| id.as_str()),
            runtime_kind: session.ga_runtime_kind,
            llm_index: llm.index,
            llm_key: llm.key,
            // An existing session carries its reasoning-effort override
            // into the fresh runner.
            reasoning_effort: session.reasoning_effort.clone(),
            ga_config: opts.ga_config.clone(),
        },
    )
    .await
}

/// Spawn a runner for a session created a moment ago (socket
/// `session.new`) and attach Core's presentation subscribers to it.
/// Always spawns — callers that may meet a live runner go through
/// [`ensure_session_runner`] instead. The session has no history yet, so
/// the runner is confirmed as it starts. Holds the session's
/// single-flight slot while it works, so a concurrent ensure waits for
/// this spawn and then finds it alive and confirmed.
pub async fn spawn_and_attach(
    host: &RunnerHost<'_>,
    args: SpawnArgs,
    active_session_id: Option<&str>,
    via: &'static str,
) -> Result<u32, AttachError> {
    let session_id = args.session_id.clone();
    let _flight = single_flight::enter(&session_id).await;
    let pid = attach_spawned(host, args, active_session_id, via, false).await?;
    host.runner.release_close(&session_id, pid, true).await;
    Ok(pid)
}

/// The session row's persisted model choice, by the rule the GUI applied
/// before 02a: a stable key wins (the runner resolves it by name, managed
/// prep by model id) and the index rides along only without one.
pub fn persisted_llm_choice(session: &SessionBrief) -> LlmChoice {
    let key = session.selected_llm_key.clone();
    let has_key = key.as_deref().is_some_and(|k| !k.is_empty());
    LlmChoice {
        index: if has_key {
            None
        } else {
            session.selected_llm_index.map(i64::from)
        },
        key,
    }
}

/// Spawn + subscribe + emit task + auto-title watcher + broadcast. The
/// caller holds the session's single-flight slot. `held`: spawn with the
/// close held, for a runner ensure is about to replay into.
async fn attach_spawned(
    host: &RunnerHost<'_>,
    args: SpawnArgs,
    active_session_id: Option<&str>,
    via: &'static str,
    held: bool,
) -> Result<u32, AttachError> {
    let session_id = args.session_id.clone();
    let spawned = if held {
        host.runner.spawn_held(args, active_session_id).await
    } else {
        host.runner.spawn(args, active_session_id).await
    };
    let pid = spawned.map_err(AttachError::Spawn)?;
    // Subscribe before anything else awaits so the emit task cannot miss
    // the runner's `ready` (~430ms after spawn).
    let Some(rx) = host.runner.subscribe(&session_id).await else {
        if held {
            // Nobody will replay into it: hand its close back to the
            // registry's usual announcements.
            let_go(host, &session_id, pid, false).await;
        }
        return Err(AttachError::SubscribeFailed);
    };
    // Second, independent subscriber: the auto-title watcher. Registries
    // without a command sink (test fakes) get none.
    let title = match host.runner.command_sink() {
        Some(sink) => host
            .runner
            .subscribe(&session_id)
            .await
            .map(|title_rx| (sink, title_rx)),
        None => None,
    };
    notify(
        host.notifier.as_ref(),
        "runner-spawned-external",
        &RunnerSpawnedExternalPayload {
            session_id: session_id.clone(),
            pid,
            via,
        },
    );
    crate::runner_commands::spawn_emit_task(host.notifier.clone(), session_id.clone(), rx);
    if let Some((sink, title_rx)) = title {
        crate::auto_title::spawn_auto_title_task(
            host.galley.clone(),
            sink,
            host.notifier.clone(),
            session_id,
            title_rx,
        );
    }
    Ok(pid)
}

/// Per-session single-flight slots. Process-global like the runners they
/// guard; an entry lives only while someone holds or awaits its slot.
mod single_flight {
    use std::collections::HashMap;
    use std::sync::{Arc, LazyLock, Mutex, Weak};
    use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

    type Slots = HashMap<String, Weak<AsyncMutex<()>>>;

    static SLOTS: LazyLock<Mutex<Slots>> = LazyLock::new(|| Mutex::new(HashMap::new()));

    pub(super) async fn enter(session_id: &str) -> OwnedMutexGuard<()> {
        let slot = {
            let mut slots = SLOTS.lock().unwrap_or_else(|p| p.into_inner());
            slots.retain(|_, slot| slot.strong_count() > 0);
            match slots.get(session_id).and_then(Weak::upgrade) {
                Some(slot) => slot,
                None => {
                    let slot = Arc::new(AsyncMutex::new(()));
                    slots.insert(session_id.to_string(), Arc::downgrade(&slot));
                    slot
                }
            }
        };
        slot.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(index: Option<u32>, key: Option<&str>) -> SessionBrief {
        let mut brief: SessionBrief = serde_json::from_value(serde_json::json!({
            "id": "s1",
            "title": "t",
            "status": "idle",
            "lastActivityAt": "t",
            "createdAt": "t",
            "updatedAt": "t",
            "runtimeKind": "external",
            "runtimeLabel": "外部 GA",
            "gaRuntimeKind": "external",
        }))
        .expect("brief fixture");
        brief.selected_llm_index = index;
        brief.selected_llm_key = key.map(str::to_string);
        brief
    }

    #[test]
    fn persisted_choice_prefers_the_key() {
        assert_eq!(
            persisted_llm_choice(&brief(Some(2), Some("B/b"))),
            LlmChoice {
                index: None,
                key: Some("B/b".into())
            }
        );
        assert_eq!(
            persisted_llm_choice(&brief(Some(2), None)),
            LlmChoice {
                index: Some(2),
                key: None
            }
        );
        // An empty key is no key (the GUI's truthiness rule), but it is
        // passed through as-is.
        assert_eq!(
            persisted_llm_choice(&brief(Some(2), Some(""))),
            LlmChoice {
                index: Some(2),
                key: Some(String::new())
            }
        );
    }

    #[tokio::test]
    async fn single_flight_serializes_one_session_only() {
        let a = single_flight::enter("sf-a").await;
        // Another session is not blocked.
        let b = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            single_flight::enter("sf-b"),
        )
        .await
        .expect("other session enters at once");
        // The same session waits until the first holder leaves.
        let waiting = tokio::spawn(async { single_flight::enter("sf-a").await });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waiting.is_finished());
        drop(a);
        tokio::time::timeout(std::time::Duration::from_millis(200), waiting)
            .await
            .expect("enters after release")
            .expect("join");
        drop(b);
    }
}
