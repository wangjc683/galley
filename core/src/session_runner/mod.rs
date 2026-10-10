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
//! section a live runner is returned as-is — `RunnerManager::spawn` shuts
//! a session's existing runner down first, so spawning over a live one
//! would kill its run.
//!
//! Dependencies are seams, not transports: [`RunnerPort`] (the registry,
//! faked in tests), [`Notifier`], and [`SpawnEnv`] (the Tauri app). No
//! socket wire types, no Tauri `State`.
//!
//! Not here yet (02b): history replay. A freshly spawned runner starts
//! with an empty GA history; the GUI still sends `load_history` when the
//! real `ready` arrives.

mod spawn_config;

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
}

/// Result of [`ensure_session_runner`].
#[derive(Debug, Clone)]
pub struct EnsureOutcome {
    pub pid: u32,
    /// `true` when this call started the runner — its `ready` is still to
    /// come. `false` when a live runner was already there.
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

/// Make sure `session_id` has a live runner: return the one it has, or
/// start one from the session's persisted configuration.
pub async fn ensure_session_runner(
    host: &RunnerHost<'_>,
    session_id: &str,
    opts: EnsureOptions<'_>,
) -> Result<EnsureOutcome, SessionRunnerError> {
    let _flight = single_flight::enter(session_id).await;

    if let Some(pid) = host.runner.live_pid(session_id).await {
        return Ok(EnsureOutcome {
            pid,
            spawned: false,
            ready: host.runner.ready_snapshot(session_id).await,
        });
    }

    let session = host
        .galley
        .session_brief(SessionId(session_id.to_string()))
        .await
        .map_err(SessionRunnerError::Db)?;
    let llm = opts
        .llm_override
        .unwrap_or_else(|| persisted_llm_choice(&session));
    let args = resolve_spawn_args(
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
            ga_config: opts.ga_config,
        },
    )
    .await?;
    let pid = attach_spawned(host, args, opts.active_session_id, opts.via).await?;
    Ok(EnsureOutcome {
        pid,
        spawned: true,
        ready: None,
    })
}

/// Spawn a runner from ready-made args and attach Core's presentation
/// subscribers to it. Always spawns — callers that may meet a live
/// runner go through [`ensure_session_runner`] instead. Holds the
/// session's single-flight slot while it works, so a concurrent ensure
/// waits for this spawn and then finds it alive.
pub async fn spawn_and_attach(
    host: &RunnerHost<'_>,
    args: SpawnArgs,
    active_session_id: Option<&str>,
    via: &'static str,
) -> Result<u32, AttachError> {
    let _flight = single_flight::enter(&args.session_id).await;
    attach_spawned(host, args, active_session_id, via).await
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
/// caller holds the session's single-flight slot.
async fn attach_spawned(
    host: &RunnerHost<'_>,
    args: SpawnArgs,
    active_session_id: Option<&str>,
    via: &'static str,
) -> Result<u32, AttachError> {
    let session_id = args.session_id.clone();
    let pid = host
        .runner
        .spawn(args, active_session_id)
        .await
        .map_err(AttachError::Spawn)?;
    // Subscribe before anything else awaits so the emit task cannot miss
    // the runner's `ready` (~430ms after spawn).
    let rx = host
        .runner
        .subscribe(&session_id)
        .await
        .ok_or(AttachError::SubscribeFailed)?;
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
