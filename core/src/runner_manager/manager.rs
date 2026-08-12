//! Multi-session orchestrator for [`RunnerProcess`]es with LRU eviction.
//!
//! See [parent module docs](super) for the migration history (TS-side
//! `_bridgeClients` Map + `_lruOrder` + `_stderrTails` → here).

use crate::api::QueuedMessage;
use crate::ipc::{IpcCommand, IpcEvent};
use crate::runner_manager::error::{RunnerSpawnError, SendCommandError, ShutdownError};
use crate::runner_manager::process::{BroadcastItem, RunnerProcess};
use crate::runner_manager::queue::{
    mint_queue_id, now_iso, QueueJump, QueueOffer, SessionQueueState,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

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
    /// Per-session outbound message queues + run gates (galley#19/#20).
    /// Keyed by session id — entries survive process crash / respawn.
    /// See [`crate::runner_manager::queue`] for the state model.
    queues: Arc<Mutex<HashMap<String, SessionQueueState>>>,
    /// Drain signal wired once at app init ([`Self::set_run_signal`]):
    /// each spawn attaches a forwarder that reports RunComplete / close
    /// here; the global drain task (`crate::message_queue`) consumes it.
    run_signal_tx: std::sync::RwLock<Option<mpsc::UnboundedSender<RunSignal>>>,
}

/// What the per-spawn forwarder reports to the global drain task.
#[derive(Debug, Clone)]
pub enum RunSignal {
    /// A `RunCompleteEvent` arrived for this session: close the run
    /// gate and drain the next queued message if allowed.
    RunComplete { session_id: String },
    /// The bridge process closed (crash or shutdown): close the run
    /// gate but HOLD the queue (PRD 定案 4 — no auto-respawn; the user
    /// resumes via jump / a fresh send).
    Closed { session_id: String },
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
            queues: Arc::new(Mutex::new(HashMap::new())),
            run_signal_tx: std::sync::RwLock::new(None),
        }
    }

    /// Wire the queue-drain signal channel. Called exactly once at app
    /// init before any spawn; spawns that happen with no signal set
    /// simply attach no forwarder (headless tests).
    pub fn set_run_signal(&self, tx: mpsc::UnboundedSender<RunSignal>) {
        *self.run_signal_tx.write().expect("run_signal_tx poisoned") = Some(tx);
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

        // Attach the queue forwarder (galley#19/#20): watches this
        // process's broadcast for AskUser / RunComplete / close and
        // keeps the queue state + global drain task informed. Attached
        // HERE so every spawn path (GUI, socket session.new, goal) is
        // covered by construction.
        self.attach_queue_forwarder(&session_id).await;

        // Now enforce the cap. The just-spawned session is at the END of
        // the LRU so it's safe from being its own victim.
        self.enforce_cap(active_session_id).await;

        Ok(pid)
    }

    /// Subscribe to the just-spawned process and forward queue-relevant
    /// happenings: `ask_user` flips the hold flag synchronously (so it
    /// is set before the same stream's RunComplete reaches the drain),
    /// RunComplete / close go to the global drain task via
    /// [`RunSignal`]. No-op when no signal channel is wired.
    async fn attach_queue_forwarder(&self, session_id: &str) {
        let tx = self
            .run_signal_tx
            .read()
            .expect("run_signal_tx poisoned")
            .clone();
        let Some(tx) = tx else { return };
        let Some(mut rx) = self.subscribe(session_id).await else {
            return;
        };
        let queues = self.queues.clone();
        let sid = session_id.to_string();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(BroadcastItem::Event(boxed)) => match *boxed {
                        IpcEvent::AskUser(_) => {
                            let mut q = queues.lock().await;
                            q.entry(sid.clone()).or_default().ask_pending = true;
                        }
                        IpcEvent::RunComplete(_) => {
                            if tx
                                .send(RunSignal::RunComplete {
                                    session_id: sid.clone(),
                                })
                                .is_err()
                            {
                                break;
                            }
                        }
                        _ => {}
                    },
                    Ok(BroadcastItem::Closed { .. }) => {
                        let _ = tx.send(RunSignal::Closed {
                            session_id: sid.clone(),
                        });
                        break;
                    }
                    Ok(BroadcastItem::Malformed(_)) => continue,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
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
        let proc = map.get(session_id)?.clone();
        // Release the outer read lock before awaiting the per-process
        // Mutex — same discipline as `send_command`. tokio's RwLock is
        // write-preferring: a read guard parked on a busy session Mutex
        // plus one queued writer would stall every other reader.
        drop(map);
        let p = proc.lock().await;
        p.pid()
    }

    /// Whether a session's runner is mid-turn. Used by [`enforce_cap`] to
    /// protect long-running tasks. Returns `false` if the session id has
    /// no registered process.
    pub async fn agent_running(&self, session_id: &str) -> bool {
        let map = self.processes.read().await;
        let Some(proc) = map.get(session_id).cloned() else {
            return false;
        };
        // Release before the per-process Mutex — see `pid` / `send_command`.
        drop(map);
        let p = proc.lock().await;
        p.agent_running()
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
        let proc = map.get(session_id)?.clone();
        // Release before the per-process Mutex — see `pid` / `send_command`.
        drop(map);
        let p = proc.lock().await;
        Some(p.broadcast_sender().subscribe())
    }

    /// Send a command to a session's runner.
    ///
    /// Doubles as the queue's run-gate funnel: EVERY dispatch path (GUI
    /// Tauri command, socket handlers, queue drain) goes through here,
    /// so a successfully sent `UserMessage` / `AskUserResponse` opens
    /// the session's run gate and clears any ask-user hold. The gate
    /// closes only on `RunComplete` / process close (see
    /// [`crate::runner_manager::queue`] for why not `agent_running`).
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
        let result = p.send_command(cmd).await;
        drop(p);
        if result.is_ok() && Self::opens_run_gate(cmd) {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            state.open_run = true;
            state.ask_pending = false;
        }
        result
    }

    /// Whether a command starts a main-agent run. `/btw` side questions
    /// ride the UserMessage kind but are handled by the bridge's
    /// interruption-free bypass (workbench_bridge.dispatch_command —
    /// keep the prefix rule in sync) and never open a run.
    fn opens_run_gate(cmd: &IpcCommand) -> bool {
        match cmd {
            IpcCommand::UserMessage(m) => {
                let t = m.text.trim_start();
                !(t == "/btw" || t.starts_with("/btw ") || t.starts_with("/btw\t"))
            }
            IpcCommand::AskUserResponse(_) => true,
            _ => false,
        }
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

    // ---------------- Outbound message queue (galley#19/#20) ----------------

    /// Atomic queue-or-dispatch decision for a new outbound message.
    ///
    /// - Run open OR queue non-empty → enqueue (returns position).
    /// - Otherwise → reserve the run gate and tell the caller to
    ///   persist + dispatch now. Reservation means a concurrent offer
    ///   routes behind this message; dispatch failure must release via
    ///   [`Self::queue_release_run`].
    pub async fn queue_offer(
        &self,
        session_id: &str,
        text: String,
        origin: Option<crate::api::Origin>,
    ) -> QueueOffer {
        let mut q = self.queues.lock().await;
        let state = q.entry(session_id.to_string()).or_default();
        if state.open_run || !state.items.is_empty() {
            let queue_id = mint_queue_id();
            state.items.push_back(QueuedMessage {
                queue_id: queue_id.clone(),
                text,
                origin,
                queued_at: now_iso(),
            });
            QueueOffer::Queued {
                queue_id,
                position: state.items.len() - 1,
            }
        } else {
            state.open_run = true;
            QueueOffer::DispatchNow
        }
    }

    /// Release a run-gate reservation after a failed dispatch, so the
    /// queue does not wait for a `RunComplete` that will never come.
    pub async fn queue_release_run(&self, session_id: &str) {
        let mut q = self.queues.lock().await;
        if let Some(state) = q.get_mut(session_id) {
            state.open_run = false;
        }
    }

    /// Jump a queued item to the front ("插队"). If a run is open the
    /// caller must send `Abort` (the RunComplete drain then dispatches
    /// the front item); on an idle session the item is popped with the
    /// run gate reserved and the caller dispatches it directly.
    pub async fn queue_jump(&self, session_id: &str, queue_id: &str) -> QueueJump {
        let mut q = self.queues.lock().await;
        let Some(state) = q.get_mut(session_id) else {
            return QueueJump::NotFound;
        };
        let Some(pos) = state.items.iter().position(|m| m.queue_id == queue_id) else {
            return QueueJump::NotFound;
        };
        let item = state.items.remove(pos).expect("position just found");
        if state.open_run {
            state.items.push_front(item);
            QueueJump::AbortThenDrain
        } else {
            state.open_run = true;
            QueueJump::DispatchNow(item)
        }
    }

    /// Push a popped item back to the front — the undo of
    /// [`QueueJump::DispatchNow`] / [`Self::queue_take_next`] when the
    /// dispatch failed. Releases the run gate.
    pub async fn queue_requeue_front(&self, session_id: &str, item: QueuedMessage) {
        let mut q = self.queues.lock().await;
        let state = q.entry(session_id.to_string()).or_default();
        state.items.push_front(item);
        state.open_run = false;
    }

    /// Remove a queued item. Returns the removed item so the GUI's
    /// "edit = remove + refill composer" flow gets the verbatim text.
    pub async fn queue_remove(&self, session_id: &str, queue_id: &str) -> Option<QueuedMessage> {
        let mut q = self.queues.lock().await;
        let state = q.get_mut(session_id)?;
        let pos = state.items.iter().position(|m| m.queue_id == queue_id)?;
        state.items.remove(pos)
    }

    /// Snapshot of one session's queued items (front first).
    pub async fn queue_snapshot(&self, session_id: &str) -> Vec<QueuedMessage> {
        let q = self.queues.lock().await;
        q.get(session_id)
            .map(|s| s.items.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Drain step for a [`RunSignal`]: close the run gate; on
    /// `RunComplete` (and only then), if no ask-user hold and items are
    /// pending, pop the front with the gate re-reserved for the caller
    /// to persist + dispatch. `Closed` never pops — a crashed bridge
    /// holds its queue for manual resume (PRD 定案 4).
    pub async fn queue_take_next(&self, signal: &RunSignal) -> Option<QueuedMessage> {
        let (session_id, may_pop) = match signal {
            RunSignal::RunComplete { session_id } => (session_id, true),
            RunSignal::Closed { session_id } => (session_id, false),
        };
        let mut q = self.queues.lock().await;
        let state = q.entry(session_id.clone()).or_default();
        state.open_run = false;
        if !may_pop || state.ask_pending || state.items.is_empty() {
            return None;
        }
        let item = state.items.pop_front();
        if item.is_some() {
            state.open_run = true;
        }
        item
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

    // ---------------- queue state machine (galley#19/#20) ----------------

    async fn offer(mgr: &RunnerManager, sid: &str, text: &str) -> QueueOffer {
        mgr.queue_offer(sid, text.to_string(), None).await
    }

    fn rc_signal(sid: &str) -> RunSignal {
        RunSignal::RunComplete {
            session_id: sid.to_string(),
        }
    }

    #[tokio::test]
    async fn first_offer_dispatches_and_reserves_the_gate() {
        let mgr = RunnerManager::new();
        assert!(matches!(offer(&mgr, "s", "a").await, QueueOffer::DispatchNow));
        // Gate reserved: the next offers queue in order.
        match offer(&mgr, "s", "b").await {
            QueueOffer::Queued { position, .. } => assert_eq!(position, 0),
            other => panic!("expected Queued, got {other:?}"),
        }
        match offer(&mgr, "s", "c").await {
            QueueOffer::Queued { position, .. } => assert_eq!(position, 1),
            other => panic!("expected Queued, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn release_reopens_direct_dispatch_when_queue_empty() {
        let mgr = RunnerManager::new();
        assert!(matches!(offer(&mgr, "s", "a").await, QueueOffer::DispatchNow));
        mgr.queue_release_run("s").await;
        assert!(matches!(offer(&mgr, "s", "b").await, QueueOffer::DispatchNow));
    }

    #[tokio::test]
    async fn run_complete_drains_fifo_and_rereserves() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await; // DispatchNow
        let _ = offer(&mgr, "s", "b").await;
        let _ = offer(&mgr, "s", "c").await;
        let b = mgr.queue_take_next(&rc_signal("s")).await.expect("pops b");
        assert_eq!(b.text, "b");
        // Gate re-reserved by the pop: a new offer queues BEHIND c.
        match offer(&mgr, "s", "d").await {
            QueueOffer::Queued { position, .. } => assert_eq!(position, 1),
            other => panic!("expected Queued, got {other:?}"),
        }
        let c = mgr.queue_take_next(&rc_signal("s")).await.expect("pops c");
        assert_eq!(c.text, "c");
        let d = mgr.queue_take_next(&rc_signal("s")).await.expect("pops d");
        assert_eq!(d.text, "d");
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
    }

    #[tokio::test]
    async fn ask_pending_holds_the_drain() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await;
        let _ = offer(&mgr, "s", "b").await;
        mgr.queues.lock().await.get_mut("s").unwrap().ask_pending = true;
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        // Items are held, not dropped.
        assert_eq!(mgr.queue_snapshot("s").await.len(), 1);
        // Answering (funnel clears ask_pending) resumes the drain.
        {
            let mut q = mgr.queues.lock().await;
            let st = q.get_mut("s").unwrap();
            st.ask_pending = false;
            st.open_run = true;
        }
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_some());
    }

    #[tokio::test]
    async fn bridge_close_holds_queue_but_closes_gate() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await;
        let _ = offer(&mgr, "s", "b").await;
        let closed = RunSignal::Closed {
            session_id: "s".to_string(),
        };
        assert!(mgr.queue_take_next(&closed).await.is_none());
        // Queue held for manual resume…
        assert_eq!(mgr.queue_snapshot("s").await.len(), 1);
        // …and the gate is closed, so a jump can dispatch directly.
        let qid = mgr.queue_snapshot("s").await[0].queue_id.clone();
        assert!(matches!(
            mgr.queue_jump("s", &qid).await,
            QueueJump::DispatchNow(_)
        ));
    }

    #[tokio::test]
    async fn jump_moves_to_front_when_run_open() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await; // DispatchNow, gate open
        let _ = offer(&mgr, "s", "b").await;
        let _ = offer(&mgr, "s", "c").await;
        let qid_c = mgr.queue_snapshot("s").await[1].queue_id.clone();
        assert!(matches!(
            mgr.queue_jump("s", &qid_c).await,
            QueueJump::AbortThenDrain
        ));
        let front = mgr.queue_take_next(&rc_signal("s")).await.expect("front");
        assert_eq!(front.text, "c");
        assert!(matches!(
            mgr.queue_jump("s", "qm_nope").await,
            QueueJump::NotFound
        ));
    }

    #[tokio::test]
    async fn remove_returns_item_and_requeue_front_restores() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await;
        let _ = offer(&mgr, "s", "b").await;
        let _ = offer(&mgr, "s", "c").await;
        let qid_b = mgr.queue_snapshot("s").await[0].queue_id.clone();
        let removed = mgr.queue_remove("s", &qid_b).await.expect("b removed");
        assert_eq!(removed.text, "b");
        assert!(mgr.queue_remove("s", &qid_b).await.is_none());
        // Failed dispatch path: item goes back to the front, gate
        // released.
        mgr.queue_requeue_front("s", removed).await;
        let snap = mgr.queue_snapshot("s").await;
        assert_eq!(snap[0].text, "b");
        assert_eq!(snap[1].text, "c");
    }
}
