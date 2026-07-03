//! Multi-session orchestrator for [`RunnerProcess`]es with LRU eviction.
//!
//! See [parent module docs](super) for the migration history (TS-side
//! `_bridgeClients` Map + `_lruOrder` + `_stderrTails` → here).

use crate::ipc::IpcCommand;
use crate::runner_manager::error::{RunnerSpawnError, SendCommandError, ShutdownError};
use crate::runner_manager::process::{BroadcastItem, RunnerProcess};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, Mutex, RwLock};

/// Default cap on concurrent alive runner subprocesses. Mirrored on the
/// TS side as `LRU_CAP` in `gui/src/stores/runtime.ts` — keep the two in
/// sync. Sized for modern Macs (incl. 8 GB Intel): each alive runner is
/// roughly a bundled-Python process (~100 MB resident), 20 fits in <2 GB
/// while covering virtually any realistic "today's active sessions" set.
pub const DEFAULT_LRU_CAP: usize = 20;

/// Default graceful-shutdown timeout per process. Prototype measured ~2.5s
/// per bridge for graceful exit; 3s gives a small safety margin.
pub const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

/// Re-export so callers can construct spawn args without reaching into the
/// `process` submodule directly.
pub use crate::runner_manager::process::SpawnArgs;

/// Multi-session runner orchestrator.
///
/// Hold this in Tauri app state via `app.manage(RunnerManager::new())`. All
/// callers (Tauri commands, socket protocol handlers in B2 M3+) reach the
/// individual subprocesses through this singleton.
///
/// ## Concurrency model
///
/// - `processes`: `Arc<RwLock<HashMap<SessionId, Arc<Mutex<RunnerProcess>>>>>`.
///   The outer `RwLock` allows concurrent reads (subscribe / pid query) and
///   serializes mutations (spawn / shutdown). Each `RunnerProcess` lives in
///   its own `Mutex` so per-process `send_command` doesn't block siblings.
/// - `lru_order`: `Mutex<Vec<SessionId>>`. Push-to-end on touch, pop-from-
///   front on eviction. Always taken AFTER `processes` to avoid deadlock
///   (or held alone for read-only inspection).
pub struct RunnerManager {
    processes: Arc<RwLock<HashMap<String, Arc<Mutex<RunnerProcess>>>>>,
    lru_order: Arc<Mutex<Vec<String>>>,
    cap: usize,
}

impl Default for RunnerManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RunnerManager {
    /// Construct with the default LRU cap.
    pub fn new() -> Self {
        Self::with_cap(DEFAULT_LRU_CAP)
    }

    /// Construct with a specific LRU cap. Used by tests to make eviction
    /// reachable without spawning 6 real subprocesses.
    pub fn with_cap(cap: usize) -> Self {
        Self {
            processes: Arc::new(RwLock::new(HashMap::new())),
            lru_order: Arc::new(Mutex::new(Vec::new())),
            cap,
        }
    }

    /// Spawn a new runner subprocess for `args.session_id`. Returns its PID.
    ///
    /// If a process is already registered for that session id, the existing
    /// one is shut down first (cleanly, with [`DEFAULT_SHUTDOWN_TIMEOUT`])
    /// and the new one replaces it. This matches the TS-side
    /// `_bridgeClients.has(sessionId) → shutdown first` flow.
    ///
    /// LRU eviction runs AFTER successful spawn: the new process is touched
    /// to the end of the LRU first (so it's protected from being its own
    /// eviction victim), then we walk the front looking for an evictable
    /// victim. Caller passes `active_session_id` so the active session is
    /// protected from eviction.
    pub async fn spawn(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        let session_id = args.session_id.clone();

        // If an old process exists for this session, take it out and shut
        // it down before spawning the new one. Releases the write lock
        // before the (potentially long) shutdown wait.
        let old = {
            let mut map = self.processes.write().await;
            map.remove(&session_id)
        };
        if let Some(old) = old {
            let mut p = old.lock().await;
            let graceful = p.shutdown(DEFAULT_SHUTDOWN_TIMEOUT).await;
            if !graceful {
                // kill_on_drop is NOT a real backstop here: the stdout
                // reader task holds an Arc to the Child, so dropping our
                // handle doesn't drop the Child. A runner that ignores
                // Shutdown must be killed explicitly or it lives forever,
                // untracked. Same fallback as `shutdown`/`shutdown_all`.
                let _ = p.kill().await;
            }
        }

        let process = RunnerProcess::spawn(args).await?;
        let pid = process.pid().unwrap_or(0);

        {
            let mut map = self.processes.write().await;
            map.insert(session_id.clone(), Arc::new(Mutex::new(process)));
        }
        self.touch(&session_id).await;

        // Now enforce the cap. The just-spawned session is at the END of
        // the LRU so it's safe from being its own victim.
        self.enforce_cap(active_session_id).await;

        Ok(pid)
    }

    /// Move `session_id` to the end of the LRU (most-recently-used).
    /// Idempotent — calling for an unknown id is a no-op no-error.
    pub async fn touch(&self, session_id: &str) {
        let mut order = self.lru_order.lock().await;
        order.retain(|s| s != session_id);
        order.push(session_id.to_string());
    }

    /// LRU snapshot (oldest-first). Used by tests + diagnostics.
    pub async fn lru_snapshot(&self) -> Vec<String> {
        self.lru_order.lock().await.clone()
    }

    /// Number of alive subprocesses. Cheap — no contention with spawn /
    /// shutdown if no writes are pending.
    pub async fn alive_count(&self) -> usize {
        self.processes.read().await.len()
    }

    /// PID for a session. None if no process is registered for that id.
    pub async fn pid(&self, session_id: &str) -> Option<u32> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?;
        let p = proc.lock().await;
        p.pid()
    }

    /// Whether a session's runner is mid-turn. Used by [`enforce_cap`] to
    /// protect long-running tasks. Returns `false` if the session id has
    /// no registered process.
    pub async fn agent_running(&self, session_id: &str) -> bool {
        let map = self.processes.read().await;
        if let Some(proc) = map.get(session_id) {
            let p = proc.lock().await;
            p.agent_running()
        } else {
            false
        }
    }

    /// Whether any alive runner is mid-turn. Used by desktop quit
    /// confirmation so Cmd+Q / tray Quit cannot silently interrupt a
    /// long-running task.
    pub async fn any_agent_running(&self) -> bool {
        let processes = {
            let map = self.processes.read().await;
            map.values().cloned().collect::<Vec<_>>()
        };
        for proc in processes {
            let p = proc.lock().await;
            if p.agent_running() {
                return true;
            }
        }
        false
    }

    /// Subscribe to a session's runner event stream. Each call returns a
    /// fresh receiver; events broadcast before subscribe are NOT delivered.
    ///
    /// **For the `Ready` event** (which fires once, ~430ms after spawn):
    /// callers should subscribe BEFORE awaiting any subsequent operation.
    /// The recommended pattern is:
    ///
    /// ```text
    /// let rx = manager.subscribe(&sid).await?;
    /// // … wait for Ready on `rx` here
    /// ```
    ///
    /// Subscribing happens synchronously relative to the broadcast channel
    /// — once `subscribe` returns, all subsequent events go to this rx.
    pub async fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?;
        let p = proc.lock().await;
        Some(p.broadcast_sender().subscribe())
    }

    /// Send a command to a session's runner.
    pub async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        let map = self.processes.read().await;
        let proc = map
            .get(session_id)
            .ok_or_else(|| SendCommandError::ProcessGone {
                session_id: session_id.to_string(),
            })?;
        let proc = proc.clone();
        // Release the outer read lock before awaiting the per-process
        // Mutex — otherwise long writes would block siblings' reads.
        drop(map);
        let mut p = proc.lock().await;
        p.send_command(cmd).await
    }

    /// Snapshot of the last N stderr lines for a session. Returns None if
    /// the session has no registered process.
    pub async fn stderr_tail(&self, session_id: &str) -> Option<Vec<String>> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?;
        let proc = proc.clone();
        drop(map);
        let p = proc.lock().await;
        Some(p.stderr_tail().await)
    }

    /// Graceful shutdown of one session's runner. Idempotent — returns
    /// `NotFound` (not an error in spirit; treat as success) if no
    /// process is registered.
    pub async fn shutdown(
        &self,
        session_id: &str,
        timeout: Option<Duration>,
    ) -> Result<(), ShutdownError> {
        let timeout = timeout.unwrap_or(DEFAULT_SHUTDOWN_TIMEOUT);
        let proc = {
            let mut map = self.processes.write().await;
            map.remove(session_id)
        };
        let proc = proc.ok_or_else(|| ShutdownError::NotFound {
            session_id: session_id.to_string(),
        })?;
        {
            let mut p = proc.lock().await;
            let graceful = p.shutdown(timeout).await;
            if !graceful {
                // Best-effort kill before drop.
                let _ = p.kill().await;
            }
        }
        // Remove from LRU.
        let mut order = self.lru_order.lock().await;
        order.retain(|s| s != session_id);
        Ok(())
    }

    /// Shut down ALL alive runners concurrently. Called from Tauri app
    /// cleanup hook on quit / window close. Bounded by `timeout` per
    /// process — any process that hasn't gracefully exited gets
    /// force-killed explicitly.
    pub async fn shutdown_all(&self, timeout: Duration) {
        let processes = {
            let mut map = self.processes.write().await;
            std::mem::take(&mut *map)
        };
        let mut order = self.lru_order.lock().await;
        order.clear();
        drop(order);

        // Fan out shutdown calls concurrently.
        let mut joins = Vec::with_capacity(processes.len());
        for (_, proc) in processes {
            joins.push(tokio::spawn(async move {
                let mut p = proc.lock().await;
                let graceful = p.shutdown(timeout).await;
                if !graceful {
                    let _ = p.kill().await;
                }
            }));
        }
        for j in joins {
            let _ = j.await;
        }
    }

    /// Walk the LRU front-to-back evicting candidates until alive count
    /// is at or under [`cap`](Self::cap). Protected: active session +
    /// any session currently mid-turn (`agent_running == true`).
    async fn enforce_cap(&self, active_session_id: Option<&str>) {
        loop {
            let snapshot = self.lru_snapshot().await;
            if snapshot.len() <= self.cap {
                return;
            }
            // Find the oldest evictable candidate.
            let mut victim: Option<String> = None;
            for sid in &snapshot {
                if Some(sid.as_str()) == active_session_id {
                    continue;
                }
                if self.agent_running(sid).await {
                    continue;
                }
                victim = Some(sid.clone());
                break;
            }
            let Some(sid) = victim else {
                // Everyone left is protected. Bail and let the next
                // spawn trigger try again after a turn finishes.
                return;
            };
            if let Err(_e) = self.shutdown(&sid, Some(DEFAULT_SHUTDOWN_TIMEOUT)).await {
                // Even if shutdown errored, force-remove from LRU so
                // the loop doesn't spin forever on a wedged victim.
                let mut order = self.lru_order.lock().await;
                order.retain(|s| s != &sid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_manager_is_empty() {
        let mgr = RunnerManager::new();
        assert_eq!(mgr.alive_count().await, 0);
        assert!(mgr.lru_snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn touch_updates_order() {
        let mgr = RunnerManager::new();
        mgr.touch("a").await;
        mgr.touch("b").await;
        mgr.touch("c").await;
        assert_eq!(mgr.lru_snapshot().await, vec!["a", "b", "c"]);
        // Re-touch "a" moves it to the end.
        mgr.touch("a").await;
        assert_eq!(mgr.lru_snapshot().await, vec!["b", "c", "a"]);
    }

    #[tokio::test]
    async fn touch_is_idempotent_per_session() {
        let mgr = RunnerManager::new();
        for _ in 0..5 {
            mgr.touch("a").await;
        }
        assert_eq!(mgr.lru_snapshot().await, vec!["a"]);
    }

    #[tokio::test]
    async fn pid_unknown_session_returns_none() {
        let mgr = RunnerManager::new();
        assert_eq!(mgr.pid("nope").await, None);
    }

    #[tokio::test]
    async fn agent_running_unknown_session_returns_false() {
        let mgr = RunnerManager::new();
        assert!(!mgr.agent_running("nope").await);
    }

    #[tokio::test]
    async fn stderr_tail_unknown_session_returns_none() {
        let mgr = RunnerManager::new();
        assert!(mgr.stderr_tail("nope").await.is_none());
    }

    #[tokio::test]
    async fn shutdown_unknown_session_returns_notfound() {
        let mgr = RunnerManager::new();
        let r = mgr.shutdown("nope", None).await;
        assert!(matches!(r, Err(ShutdownError::NotFound { .. })));
    }

    #[tokio::test]
    async fn subscribe_unknown_session_returns_none() {
        let mgr = RunnerManager::new();
        assert!(mgr.subscribe("nope").await.is_none());
    }

    #[tokio::test]
    async fn send_command_unknown_session_errors() {
        let mgr = RunnerManager::new();
        let r = mgr.send_command("nope", &IpcCommand::Shutdown).await;
        assert!(matches!(r, Err(SendCommandError::ProcessGone { .. })));
    }

    #[tokio::test]
    async fn shutdown_all_when_empty_completes() {
        let mgr = RunnerManager::new();
        mgr.shutdown_all(Duration::from_millis(100)).await;
        assert_eq!(mgr.alive_count().await, 0);
    }
}
