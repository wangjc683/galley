//! Multi-session orchestrator for [`RunnerProcess`]es with LRU eviction.
//!
//! See [parent module docs](super) for the migration history (TS-side
//! `_bridgeClients` Map + `_lruOrder` + `_stderrTails` → here).

use crate::api::QueuedMessage;
use crate::db::SqliteGalley;
use crate::ipc::{IpcCommand, IpcEvent};
use crate::notify::Notifier;
use crate::runner_manager::error::{RunnerSpawnError, SendCommandError, ShutdownError};
use crate::runner_manager::process::{BroadcastItem, HeldClose, RunnerProcess};
use crate::runner_manager::queue::{
    mint_queue_id, now_iso, QueueJump, QueueOffer, RunKind, RunOutcome, SessionQueueState,
};
use crate::runner_manager::ready::ReadySnapshot;
use crate::runner_manager::run_state_events::RunStateFeed;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

type ProcessMap = RwLock<HashMap<String, Arc<Mutex<RunnerProcess>>>>;
type QueueMap = Mutex<HashMap<String, SessionQueueState>>;

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
    /// each spawn attaches a watcher that reports RunComplete / close
    /// here; the global drain task (`crate::message_queue`) consumes it.
    run_signal_tx: std::sync::RwLock<Option<mpsc::UnboundedSender<RunSignal>>>,
    /// Core-owned turn persistence, wired once at app init
    /// ([`Self::set_turn_store`]): each spawn's watcher writes the
    /// runner's `turn_end`s to this database ([`crate::turn_persistence`])
    /// and announces each session bump through the notifier.
    turn_store: std::sync::RwLock<Option<(SqliteGalley, Arc<dyn Notifier>)>>,
    /// Where every change to a session's [`RunState`] is reported for
    /// the `session-run-state` event, wired once at app init
    /// ([`Self::set_run_state_feed`]). Shared with
    /// [`RunnerCommandHandle`]s.
    run_state_feed: RunStateFeed,
}

/// Live run-state snapshot for one session ([`RunnerManager::run_state`]).
/// The busy truth the DB's `sessions.status` column cannot carry —
/// transient statuses live in memory and persist as `idle`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunState {
    /// A runner subprocess is registered and has a pid.
    pub runner_alive: bool,
    /// The bridge is mid-turn (flickers false in inter-turn gaps —
    /// see [`crate::runner_manager::queue`] for why `open_run` is the
    /// run-level gate).
    pub agent_running: bool,
    /// A dispatched run has not seen its `RunCompleteEvent` yet.
    pub open_run: bool,
    /// Messages waiting in the outbound queue.
    pub queued_count: usize,
    /// The last run ended on an `ask_user` question nobody has answered
    /// yet; the queue drain is held until an answer is dispatched.
    pub ask_pending: bool,
    /// `exitReason.result` of the most recently completed run in this
    /// Core process, verbatim (`None` until one completes). Kept across
    /// the next run's start; replaced only by the next `RunComplete`.
    pub last_exit: Option<String>,
}

/// What the per-spawn runner watcher reports to the global drain task.
#[derive(Debug, Clone)]
pub enum RunSignal {
    /// A `RunCompleteEvent` arrived for this session: close the run
    /// gate and drain the next queued message if allowed.
    RunComplete { session_id: String },
    /// The bridge process closed (crash or shutdown): close the run
    /// gate but HOLD the queue (PRD 定案 4 — no auto-respawn; the user
    /// resumes via jump / a fresh send).
    Closed { session_id: String },
    /// A user-initiated run (not a goal continuation) emitted its first
    /// `TurnStart`. Goal v2 resumes a paused / blocked goal on this —
    /// the user's message IS the intervention, and waiting for the run
    /// to settle would leave the goal looking parked for the whole run
    /// it is being resumed by.
    UserRunStarted { session_id: String },
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
            turn_store: std::sync::RwLock::new(None),
            run_state_feed: RunStateFeed::default(),
        }
    }

    /// Wire the queue-drain signal channel. Called exactly once at app
    /// init before any spawn; spawns that happen with no signal set
    /// simply get no queue bookkeeping (headless tests).
    pub fn set_run_signal(&self, tx: mpsc::UnboundedSender<RunSignal>) {
        *self.run_signal_tx.write().expect("run_signal_tx poisoned") = Some(tx);
    }

    /// Wire Core-owned turn persistence: every runner spawned afterwards
    /// has its `turn_end`s written to `galley` by Core itself, whether or
    /// not a GUI page is listening (2026-10-07 — a webview reload used to
    /// drop whole runs), and each visible turn's session bump announced
    /// through `notifier` (`session-updated-external`, ticket 05c).
    /// Called once at app init, before anything can spawn; headless tests
    /// that skip it get no persistence.
    pub fn set_turn_store(&self, galley: SqliteGalley, notifier: Arc<dyn Notifier>) {
        *self.turn_store.write().expect("turn_store poisoned") = Some((galley, notifier));
    }

    /// Wire the `session-run-state` feed: from now on every change to a
    /// session's [`RunState`] — the run gate, the queue, the ask-user
    /// hold, a runner registered or gone, a turn starting or ending —
    /// sends the session id on `tx`, for
    /// [`crate::runner_manager::publish_run_states`]. Called once at app
    /// init, before anything can spawn (a runner spawned earlier gets no
    /// watcher for its turn changes); headless callers that skip it
    /// report nothing.
    pub fn set_run_state_feed(&self, tx: mpsc::UnboundedSender<String>) {
        self.run_state_feed.wire(tx);
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
        self.spawn_inner(args, active_session_id, false).await
    }

    /// [`Self::spawn`] with the new runner's close held
    /// ([`RunnerProcess::spawn_held`]) until [`Self::release_close`] —
    /// Core's ensure replays history into it first (ticket 02b).
    pub async fn spawn_held(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args, active_session_id, true).await
    }

    async fn spawn_inner(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
        held: bool,
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

        let process = if held {
            RunnerProcess::spawn_held(args).await?
        } else {
            RunnerProcess::spawn(args).await?
        };
        let pid = process.pid().unwrap_or(0);

        {
            let mut map = self.processes.write().await;
            map.insert(session_id.clone(), Arc::new(Mutex::new(process)));
        }
        self.touch(&session_id).await;
        self.run_state_feed.touch(&session_id);

        // Attach the runner watcher: persists every turn_end (Core-owned
        // turn persistence) and keeps the queue state + global drain
        // task informed (galley#19/#20). Attached HERE so every spawn
        // path (GUI, socket session.new, goal, scheduler) is covered by
        // construction.
        self.attach_runner_watcher(&session_id).await;

        // Now enforce the cap. The just-spawned session is at the END of
        // the LRU so it's safe from being its own victim.
        self.enforce_cap(active_session_id).await;

        Ok(pid)
    }

    /// Subscribe to the just-spawned process and act on its events in
    /// stream order, without a GUI:
    ///
    /// - `turn_end` → the assistant row + session bump, the bump
    ///   announced ([`crate::turn_persistence`]), when a turn store is
    ///   wired;
    /// - queue bookkeeping, when a run-signal channel is wired: `ask_user`
    ///   flips the hold flag (before the same stream's RunComplete reaches
    ///   the drain), RunComplete / close go to the global drain task via
    ///   [`RunSignal`]. A quiet close (a runner Core retired, or one that
    ///   closed while held — see [`BroadcastItem::Closed`]) sends no
    ///   `Closed`: the run gate and an active goal belong to whoever is
    ///   replacing the runner, and a held close is announced on release;
    /// - a run-state report after each event and the close, when the
    ///   run-state feed is wired: these are where `agent_running`,
    ///   `ask_pending` and `last_exit` change.
    ///
    /// One ordered consumer does all of it, so a run's rows are in SQLite
    /// before its RunComplete closes the run gate — `session wait
    /// --until-idle` and `session show` never see a run as ended ahead of
    /// its final answer. The broadcast is drained by a separate pump
    /// ([`pump_watched_events`]) so a slow write cannot make this
    /// subscriber lag and skip events. No-op when nothing is wired.
    async fn attach_runner_watcher(&self, session_id: &str) {
        let mut signal_tx = self
            .run_signal_tx
            .read()
            .expect("run_signal_tx poisoned")
            .clone();
        let store = self.turn_store.read().expect("turn_store poisoned").clone();
        let feed = self.run_state_feed.clone();
        if signal_tx.is_none() && store.is_none() && !feed.is_wired() {
            return;
        }
        let Some(rx) = self.subscribe(session_id).await else {
            return;
        };
        let mut events = pump_watched_events(rx, session_id.to_string());
        let queues = self.queues.clone();
        let sid = session_id.to_string();
        tokio::spawn(async move {
            while let Some(item) = events.recv().await {
                let event = match item {
                    BroadcastItem::Event(boxed) => *boxed,
                    BroadcastItem::Closed { quiet, .. } => {
                        if let (false, Some(tx)) = (quiet, &signal_tx) {
                            let _ = tx.send(RunSignal::Closed {
                                session_id: sid.clone(),
                            });
                        }
                        feed.touch(&sid);
                        break;
                    }
                    BroadcastItem::Malformed(_) => continue,
                };
                if let (IpcEvent::TurnEnd(turn), Some((galley, notifier))) = (&event, &store) {
                    crate::turn_persistence::persist_turn_end(
                        galley,
                        notifier.as_ref(),
                        &sid,
                        turn,
                    )
                    .await;
                }
                if let Some(tx) = &signal_tx {
                    if !queue_bookkeeping(&queues, &sid, tx, event).await {
                        // The drain task is gone (app shutting down);
                        // keep persisting whatever is still in flight.
                        signal_tx = None;
                    }
                }
                feed.touch(&sid);
            }
        });
    }

    /// Every runner whose child is still alive, with its pid (order not
    /// kept). Lets a GUI page that lost its listeners — a webview reload —
    /// re-attach instead of re-spawning (which would kill a running
    /// turn). A crashed runner stays registered until a shutdown or
    /// respawn but is left out here, so re-clicking its session still
    /// respawns it.
    pub async fn live_runners(&self) -> Vec<(String, u32)> {
        let processes: Vec<(String, Arc<Mutex<RunnerProcess>>)> = {
            let map = self.processes.read().await;
            map.iter()
                .map(|(sid, proc)| (sid.clone(), proc.clone()))
                .collect()
        };
        let mut out = Vec::with_capacity(processes.len());
        for (sid, proc) in processes {
            let p = proc.lock().await;
            if let (Some(pid), false) = (p.pid(), p.has_closed()) {
                out.push((sid, pid));
            }
        }
        out
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

    /// PID of a runner whose child is still alive. Unlike [`Self::pid`],
    /// a crashed runner the manager still holds (it stays registered
    /// until a shutdown or respawn) reads as absent — the liveness rule
    /// [`Self::live_runners`] uses, and what "ensure a runner" means.
    pub async fn live_pid(&self, session_id: &str) -> Option<u32> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?.clone();
        // Release before the per-process Mutex — see `pid`.
        drop(map);
        let p = proc.lock().await;
        if p.has_closed() {
            return None;
        }
        p.pid()
    }

    /// The runner's latest `ready` state, folded with later
    /// `llm_changed` / `reasoning_effort_changed`
    /// ([`crate::runner_manager::ready`]). `None` when no live runner is
    /// registered or it has not reported `ready` yet.
    pub async fn ready_snapshot(&self, session_id: &str) -> Option<ReadySnapshot> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?.clone();
        // Release before the per-process Mutex — see `pid`.
        drop(map);
        let p = proc.lock().await;
        p.ready_snapshot()
    }

    /// The registered process for `session_id` when its pid is `pid` —
    /// the guard every ensure-side call below goes through, so a call
    /// meant for one runner never touches its replacement.
    async fn process_with_pid(
        &self,
        session_id: &str,
        pid: u32,
    ) -> Option<Arc<Mutex<RunnerProcess>>> {
        let map = self.processes.read().await;
        let proc = map.get(session_id)?.clone();
        // Release before the per-process Mutex — see `pid`.
        drop(map);
        let matches = proc.lock().await.pid() == Some(pid);
        matches.then_some(proc)
    }

    /// Hold the close of the live runner `pid` (ticket 02b): until
    /// [`Self::release_close`], its exit is deferred rather than
    /// announced. `false` when it is not registered or already closed.
    pub async fn hold_close(&self, session_id: &str, pid: u32) -> bool {
        match self.process_with_pid(session_id, pid).await {
            Some(proc) => proc.lock().await.hold_close(),
            None => false,
        }
    }

    /// End Core's hold on runner `pid` and, when `history_confirmed`,
    /// record that its GA history holds the session's conversation. A
    /// close that happened during the hold is announced now: the run-gate
    /// watcher stayed silent, so the drain task gets its `Closed` here,
    /// and the returned exit status is the caller's to send to the GUI
    /// (`runner-closed`). `None` while the runner lives.
    pub async fn release_close(
        &self,
        session_id: &str,
        pid: u32,
        history_confirmed: bool,
    ) -> Option<HeldClose> {
        let proc = self.process_with_pid(session_id, pid).await?;
        let held = {
            let mut p = proc.lock().await;
            if history_confirmed {
                p.confirm_history();
            }
            p.release_close()
        };
        if held.is_some() {
            let tx = self
                .run_signal_tx
                .read()
                .expect("run_signal_tx poisoned")
                .clone();
            if let Some(tx) = tx {
                let _ = tx.send(RunSignal::Closed {
                    session_id: session_id.to_string(),
                });
            }
        }
        held
    }

    /// Shut runner `pid` down to replace it, without announcing the
    /// close: no `RunSignal::Closed` (the run gate and an active goal are
    /// the replacing caller's) and no `runner-closed` (a listening page
    /// keeps its listeners for the replacement). `false` when `pid` is
    /// not the session's registered runner.
    pub async fn retire(&self, session_id: &str, pid: u32) -> bool {
        let Some(proc) = self.process_with_pid(session_id, pid).await else {
            return false;
        };
        proc.lock().await.retire();
        // Unregister it unless something replaced it meanwhile.
        let removed = {
            let mut map = self.processes.write().await;
            match map.get(session_id) {
                Some(current) if Arc::ptr_eq(current, &proc) => map.remove(session_id),
                _ => None,
            }
        };
        if let Some(proc) = removed {
            let mut p = proc.lock().await;
            if !p.shutdown(DEFAULT_SHUTDOWN_TIMEOUT).await {
                // Same fallback as `shutdown` / `spawn`'s replace path.
                let _ = p.kill().await;
            }
            drop(p);
            let mut order = self.lru_order.lock().await;
            order.retain(|s| s != session_id);
            drop(order);
            self.run_state_feed.touch(session_id);
        }
        true
    }

    /// Whether runner `pid` is the session's registered, still-running
    /// runner and Core confirmed its GA history (ticket 02b).
    pub async fn history_confirmed(&self, session_id: &str, pid: u32) -> bool {
        match self.process_with_pid(session_id, pid).await {
            Some(proc) => {
                let p = proc.lock().await;
                p.history_confirmed() && !p.has_closed()
            }
            None => false,
        }
    }

    /// An owned handle that sends commands exactly like
    /// [`Self::send_command`], for tasks that outlive the borrow they
    /// were started from (the auto-title watcher started by
    /// [`crate::session_runner`] holds one).
    pub fn command_handle(&self) -> RunnerCommandHandle {
        RunnerCommandHandle {
            processes: self.processes.clone(),
            queues: self.queues.clone(),
            run_state_feed: self.run_state_feed.clone(),
        }
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
        send_command_via(
            &self.processes,
            &self.queues,
            &self.run_state_feed,
            session_id,
            cmd,
        )
        .await
    }

    /// Whether a command starts a main-agent run. `/btw` side questions
    /// ride the UserMessage kind but are handled by the bridge's
    /// interruption-free bypass and never open a run
    /// ([`is_side_question`]).
    fn opens_run_gate(cmd: &IpcCommand) -> bool {
        match cmd {
            IpcCommand::UserMessage(m) => !is_side_question(&m.text),
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
        drop(order);
        self.run_state_feed.touch(session_id);
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
        let mut session_ids = Vec::with_capacity(processes.len());
        for (session_id, proc) in processes {
            session_ids.push(session_id);
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
        for session_id in &session_ids {
            self.run_state_feed.touch(session_id);
        }
    }

    // ---------------- Outbound message queue (galley#19/#20) ----------------

    /// Atomic queue-or-dispatch decision for a new outbound message.
    ///
    /// - Run open → enqueue (returns position).
    /// - No run open, but the last run ended on a pending `ask_user`
    ///   question → dispatch now even if items are queued (galley#30):
    ///   this message is the answer. The held items were queued before
    ///   the question, so they keep waiting and drain FIFO once the
    ///   answer's run completes — the same outcome as the GUI composer,
    ///   which bypasses the queue while a question is pending. Without
    ///   this, a CLI / supervisor send queued behind the hold and nothing
    ///   could ever release it.
    /// - Otherwise, queue non-empty → enqueue behind it.
    /// - Otherwise → dispatch now.
    ///
    /// Dispatch-now reserves the run gate and tells the caller to
    /// persist + dispatch. Reservation means a concurrent offer routes
    /// behind this message; dispatch failure must release via
    /// [`Self::queue_release_run`] (`ask_pending` stays set until the
    /// send funnel actually delivers the answer).
    pub async fn queue_offer(
        &self,
        session_id: &str,
        text: String,
        origin: Option<crate::api::Origin>,
    ) -> QueueOffer {
        let offer = {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            // With no run open, a pending question lets this message past
            // the held items as the answer (see above).
            if !state.may_dispatch_now() {
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
        };
        self.run_state_feed.touch(session_id);
        offer
    }

    /// [`Self::queue_offer`]'s dispatch-now branch without its queue
    /// branch: reserve the run gate when the offer would dispatch now,
    /// otherwise change nothing and return `false`. For a message that
    /// must not wait in the queue — one with images (queued items are
    /// text only, PRD 定案 6) — so the caller can refuse it instead
    /// (`crate::session_send`, ticket 02c). On `true` the caller must
    /// dispatch or release via [`Self::queue_release_run`].
    pub async fn queue_try_reserve(&self, session_id: &str) -> bool {
        let reserved = {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            if state.may_dispatch_now() {
                state.open_run = true;
                true
            } else {
                false
            }
        };
        if reserved {
            self.run_state_feed.touch(session_id);
        }
        reserved
    }

    /// Release a run-gate reservation after a failed dispatch, so the
    /// queue does not wait for a `RunComplete` that will never come.
    pub async fn queue_release_run(&self, session_id: &str) {
        {
            let mut q = self.queues.lock().await;
            if let Some(state) = q.get_mut(session_id) {
                state.open_run = false;
            }
        }
        self.run_state_feed.touch(session_id);
    }

    /// Jump a queued item to the front ("插队"). If a run is open the
    /// caller must send `Abort` (the RunComplete drain then dispatches
    /// the front item); on an idle session the item is popped with the
    /// run gate reserved and the caller dispatches it directly.
    pub async fn queue_jump(&self, session_id: &str, queue_id: &str) -> QueueJump {
        let jump = {
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
        };
        self.run_state_feed.touch(session_id);
        jump
    }

    /// Push a popped item back to the front — the undo of
    /// [`QueueJump::DispatchNow`] / [`Self::queue_take_next`] when the
    /// dispatch failed. Releases the run gate.
    pub async fn queue_requeue_front(&self, session_id: &str, item: QueuedMessage) {
        {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            state.items.push_front(item);
            state.open_run = false;
        }
        self.run_state_feed.touch(session_id);
    }

    /// Remove a queued item. Returns the removed item so the GUI's
    /// "edit = remove + refill composer" flow gets the verbatim text.
    pub async fn queue_remove(&self, session_id: &str, queue_id: &str) -> Option<QueuedMessage> {
        let removed = {
            let mut q = self.queues.lock().await;
            let state = q.get_mut(session_id)?;
            let pos = state.items.iter().position(|m| m.queue_id == queue_id)?;
            state.items.remove(pos)
        };
        if removed.is_some() {
            self.run_state_feed.touch(session_id);
        }
        removed
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
            // A run starting changes nothing about the gate or the queue.
            RunSignal::UserRunStarted { .. } => return None,
        };
        let item = {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.clone()).or_default();
            state.open_run = false;
            if !may_pop || state.ask_pending || state.items.is_empty() {
                None
            } else {
                let item = state.items.pop_front();
                if item.is_some() {
                    state.open_run = true;
                }
                item
            }
        };
        self.run_state_feed.touch(session_id);
        item
    }

    /// Reserve the run gate ONLY if the session is fully idle: no open
    /// run, empty queue, and no ask_user question pending (a goal
    /// continuation must not talk over a question the agent asked the
    /// user). The queue-less sibling of [`Self::queue_offer`] for the
    /// Goal v2 engine, whose continuation is regenerated fresh each time
    /// — a stale queued copy is worse than no copy. On `false` the
    /// caller sends nothing; on `true` the caller must dispatch or
    /// release via [`Self::queue_release_run`].
    pub async fn try_reserve_run(&self, session_id: &str) -> bool {
        let reserved = {
            let mut q = self.queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            if state.open_run || state.ask_pending || !state.items.is_empty() {
                false
            } else {
                state.open_run = true;
                true
            }
        };
        if reserved {
            self.run_state_feed.touch(session_id);
        }
        reserved
    }

    /// Stamp the run just opened on `session_id` as a Goal continuation
    /// (the engine calls this right after its dispatch succeeded), so the
    /// settled [`RunOutcome`] reports `continuation: true` and a user
    /// turn can be told apart from the engine's own.
    pub async fn mark_goal_continuation(&self, session_id: &str) {
        let mut q = self.queues.lock().await;
        q.entry(session_id.to_string()).or_default().run_kind = RunKind::GoalContinuation;
    }

    /// Take the outcome of the most recently settled run (cleared on
    /// read). `None` when no run has completed since the last take — or
    /// ever.
    pub async fn take_run_outcome(&self, session_id: &str) -> Option<RunOutcome> {
        let mut q = self.queues.lock().await;
        q.get_mut(session_id).and_then(|s| s.last_outcome.take())
    }

    /// Live run-state snapshot for one session — the truthful busy
    /// signal `sessions.status` in SQLite cannot provide (transient
    /// statuses are in-memory only; the DB column persists as `idle`).
    /// Serves the `session.run_state` socket command the Goal controller
    /// polls between working turns.
    pub async fn run_state(&self, session_id: &str) -> RunState {
        let (open_run, queued_count, ask_pending, last_exit) = {
            let q = self.queues.lock().await;
            match q.get(session_id) {
                Some(s) => (
                    s.open_run,
                    s.items.len(),
                    s.ask_pending,
                    s.last_exit.clone(),
                ),
                None => (false, 0, false, None),
            }
        };
        let runner_alive = self.pid(session_id).await.is_some();
        let agent_running = self.agent_running(session_id).await;
        RunState {
            runner_alive,
            agent_running,
            open_run,
            queued_count,
            ask_pending,
            last_exit,
        }
    }

    /// Every session id the manager holds state for: a registered runner
    /// process or a queue entry (open run gate / queued messages). This is
    /// the scope of the bulk `sessions.run_state` probe when the caller
    /// passes no ids — anything not listed here is idle by construction.
    pub async fn known_session_ids(&self) -> Vec<String> {
        let mut ids: std::collections::BTreeSet<String> =
            self.processes.read().await.keys().cloned().collect();
        ids.extend(self.queues.lock().await.keys().cloned());
        ids.into_iter().collect()
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

/// Whether a `user_message` text is a `/btw` side question: after
/// leading whitespace, exactly `/btw`, or `/btw` followed by a space or a
/// tab. The bridge's rule (`runner/workbench_bridge.py`,
/// `dispatch_command`'s UserMessageCommand branch) is authoritative; this
/// is Core's one copy of it — the run gate ([`RunnerManager::send_command`]
/// never opens one for a side question) and Core's send
/// (`crate::session_send`, which neither persists nor queues one) both
/// call it.
pub fn is_side_question(text: &str) -> bool {
    let t = text.trim_start();
    t == "/btw" || t.starts_with("/btw ") || t.starts_with("/btw\t")
}

/// The body of [`RunnerManager::send_command`], shared with
/// [`RunnerCommandHandle`] so both funnel through the same run gate.
async fn send_command_via(
    processes: &ProcessMap,
    queues: &QueueMap,
    run_state_feed: &RunStateFeed,
    session_id: &str,
    cmd: &IpcCommand,
) -> Result<(), SendCommandError> {
    let map = processes.read().await;
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
    if result.is_ok() && RunnerManager::opens_run_gate(cmd) {
        {
            let mut q = queues.lock().await;
            let state = q.entry(session_id.to_string()).or_default();
            state.open_run = true;
            state.ask_pending = false;
            // `last_exit` is deliberately left alone: it keeps saying why
            // the previous run ended until this one completes (galley#30).
            // Every gate-opening dispatch is a user turn until the Goal
            // engine says otherwise (`mark_goal_continuation`).
            state.run_kind = RunKind::UserTurn;
            state.draft = Default::default();
        }
        run_state_feed.touch(session_id);
    }
    result
}

/// Send-only view of the runner registry for a long-lived task
/// (the auto-title watcher). The width of this trait is all such a
/// task may do to a runner.
#[async_trait]
pub trait RunnerCommandSink: Send + Sync {
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError>;
}

#[async_trait]
impl RunnerCommandSink for RunnerManager {
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        RunnerManager::send_command(self, session_id, cmd).await
    }
}

/// Owned [`RunnerCommandSink`] over a manager's registry
/// ([`RunnerManager::command_handle`]). Shares the manager's maps, so it
/// reaches whatever runner the session holds when the command is sent.
#[derive(Clone)]
pub struct RunnerCommandHandle {
    processes: Arc<ProcessMap>,
    queues: Arc<QueueMap>,
    run_state_feed: RunStateFeed,
}

#[async_trait]
impl RunnerCommandSink for RunnerCommandHandle {
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        send_command_via(
            &self.processes,
            &self.queues,
            &self.run_state_feed,
            session_id,
            cmd,
        )
        .await
    }
}

/// The events the runner watcher acts on.
fn is_watched(event: &IpcEvent) -> bool {
    matches!(
        event,
        IpcEvent::AskUser(_)
            | IpcEvent::TurnStart(_)
            | IpcEvent::TurnEnd(_)
            | IpcEvent::Error(_)
            | IpcEvent::RunComplete(_)
    )
}

/// Drain a runner's broadcast into an unbounded queue of the events the
/// watcher acts on, in stream order. The pump awaits nothing but the
/// broadcast itself, so a slow SQLite write downstream can never push
/// this subscriber past the broadcast capacity (where events are
/// silently skipped). Ends after forwarding `Closed`, or when the
/// broadcast closes.
fn pump_watched_events(
    mut rx: broadcast::Receiver<BroadcastItem>,
    session_id: String,
) -> mpsc::UnboundedReceiver<BroadcastItem> {
    let (tx, out) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(item @ BroadcastItem::Closed { .. }) => {
                    let _ = tx.send(item);
                    break;
                }
                Ok(BroadcastItem::Event(event)) if is_watched(&event) => {
                    if tx.send(BroadcastItem::Event(event)).is_err() {
                        break;
                    }
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    eprintln!("[runner watch {session_id}] lagged, skipped {skipped} events");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    out
}

/// Queue-side handling of one watched event (galley#19/#20, Goal v2).
/// Returns `false` once the drain task's channel is gone.
async fn queue_bookkeeping(
    queues: &Mutex<HashMap<String, SessionQueueState>>,
    sid: &str,
    tx: &mpsc::UnboundedSender<RunSignal>,
    event: IpcEvent,
) -> bool {
    match event {
        IpcEvent::AskUser(_) => {
            let mut q = queues.lock().await;
            q.entry(sid.to_string()).or_default().ask_pending = true;
        }
        IpcEvent::TurnStart(_) => {
            let announce = {
                let mut q = queues.lock().await;
                let state = q.entry(sid.to_string()).or_default();
                if state.run_kind == RunKind::UserTurn && !state.started_notified {
                    state.started_notified = true;
                    true
                } else {
                    false
                }
            };
            if announce
                && tx
                    .send(RunSignal::UserRunStarted {
                        session_id: sid.to_string(),
                    })
                    .is_err()
            {
                return false;
            }
        }
        // Goal v2 bookkeeping: remember the final turn's
        // `<goal-status>` tag and any fatal error so the drain task can
        // judge the run once it settles.
        IpcEvent::TurnEnd(e) if e.exit_reason.is_some() => {
            let mut q = queues.lock().await;
            let draft = &mut q.entry(sid.to_string()).or_default().draft;
            draft.goal_tag = e.goal_status;
            draft.summary = Some(e.summary).filter(|s| !s.trim().is_empty());
        }
        IpcEvent::Error(e) if e.category != "business" && e.severity == "error" => {
            let mut q = queues.lock().await;
            q.entry(sid.to_string()).or_default().draft.errored = Some(e.message);
        }
        IpcEvent::RunComplete(e) => {
            // Settles the RunOutcome and records `last_exit`
            // (galley#30) in one step.
            queues
                .lock()
                .await
                .entry(sid.to_string())
                .or_default()
                .settle_run(&e.exit_reason);
            if tx
                .send(RunSignal::RunComplete {
                    session_id: sid.to_string(),
                })
                .is_err()
            {
                return false;
            }
        }
        _ => {}
    }
    true
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
        assert!(matches!(
            offer(&mgr, "s", "a").await,
            QueueOffer::DispatchNow
        ));
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
        assert!(matches!(
            offer(&mgr, "s", "a").await,
            QueueOffer::DispatchNow
        ));
        mgr.queue_release_run("s").await;
        assert!(matches!(
            offer(&mgr, "s", "b").await,
            QueueOffer::DispatchNow
        ));
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

    fn texts(items: Vec<QueuedMessage>) -> Vec<String> {
        items.into_iter().map(|m| m.text).collect()
    }

    async fn set_ask_pending(mgr: &RunnerManager, sid: &str, pending: bool) {
        mgr.queues
            .lock()
            .await
            .entry(sid.into())
            .or_default()
            .ask_pending = pending;
    }

    /// Stand-in for the forwarder's `RunComplete` handling.
    async fn settle(mgr: &RunnerManager, sid: &str, exit_reason: serde_json::Value) {
        mgr.queues
            .lock()
            .await
            .entry(sid.into())
            .or_default()
            .settle_run(&exit_reason);
    }

    // galley#30: a CLI / supervisor send while a question is pending used
    // to queue behind the held items forever.
    #[tokio::test]
    async fn offer_while_a_question_is_pending_dispatches_as_the_answer() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await; // DispatchNow, gate open
        let _ = offer(&mgr, "s", "b").await; // queued before the question
        let _ = offer(&mgr, "s", "c").await;
        set_ask_pending(&mgr, "s", true).await;
        // Run "a" ends on the question: the drain holds b / c.
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());

        // The next send is the answer: dispatched now, ahead of b / c.
        assert!(matches!(
            offer(&mgr, "s", "answer").await,
            QueueOffer::DispatchNow
        ));
        assert!(mgr.run_state("s").await.open_run, "gate reserved");
        assert_eq!(texts(mgr.queue_snapshot("s").await), ["b", "c"]);

        // A failed dispatch releases the gate; the hold is still on, so
        // the retry is still the answer.
        mgr.queue_release_run("s").await;
        assert!(matches!(
            offer(&mgr, "s", "answer").await,
            QueueOffer::DispatchNow
        ));
        // Reserved gate: a concurrent offer routes behind the held items.
        match offer(&mgr, "s", "d").await {
            QueueOffer::Queued { position, .. } => assert_eq!(position, 2),
            other => panic!("expected Queued, got {other:?}"),
        }

        // The send funnel delivers the answer (clears the hold); once the
        // answer's run completes the held items drain FIFO.
        set_ask_pending(&mgr, "s", false).await;
        for expected in ["b", "c", "d"] {
            let item = mgr.queue_take_next(&rc_signal("s")).await.expect("pops");
            assert_eq!(item.text, expected);
        }
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
    }

    #[tokio::test]
    async fn offer_while_a_question_is_pending_but_the_run_is_open_still_queues() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await; // gate open
                                             // `ask_user` arrived; the run's `RunComplete` has not.
        set_ask_pending(&mgr, "s", true).await;
        match offer(&mgr, "s", "b").await {
            QueueOffer::Queued { position, .. } => assert_eq!(position, 0),
            other => panic!("expected Queued, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn last_exit_is_kept_across_the_next_run_until_its_run_complete() {
        let mgr = RunnerManager::new();
        assert_eq!(mgr.run_state("s").await.last_exit, None, "no run yet");
        let _ = offer(&mgr, "s", "a").await; // gate open
        let _ = offer(&mgr, "s", "b").await; // queued
        settle(
            &mgr,
            "s",
            serde_json::json!({"result": "MAX_TURNS_EXCEEDED", "data": {"maxTurns": 70}}),
        )
        .await;
        // The drain starts "b" at once; lastExit still says why "a" ended.
        let b = mgr.queue_take_next(&rc_signal("s")).await.expect("pops b");
        assert_eq!(b.text, "b");
        let state = mgr.run_state("s").await;
        assert!(state.open_run);
        assert_eq!(state.last_exit.as_deref(), Some("MAX_TURNS_EXCEEDED"));
        // The Goal engine taking the outcome does not clear it either.
        assert!(mgr.take_run_outcome("s").await.is_some());
        assert_eq!(
            mgr.run_state("s").await.last_exit.as_deref(),
            Some("MAX_TURNS_EXCEEDED")
        );
        // The next RunComplete replaces it (and still settles the outcome).
        settle(
            &mgr,
            "s",
            serde_json::json!({"result": "ABORTED", "data": null}),
        )
        .await;
        assert_eq!(
            mgr.run_state("s").await.last_exit.as_deref(),
            Some("ABORTED")
        );
        assert!(mgr.take_run_outcome("s").await.expect("outcome").aborted);
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

    #[tokio::test]
    async fn queue_try_reserve_follows_the_offer_rule_but_never_enqueues() {
        let mgr = RunnerManager::new();
        // Idle: reserved, exactly like an offer's dispatch-now.
        assert!(mgr.queue_try_reserve("s").await);
        assert!(mgr.run_state("s").await.open_run);
        // Run open: refused, and nothing was queued.
        assert!(!mgr.queue_try_reserve("s").await);
        assert!(mgr.queue_snapshot("s").await.is_empty());
        // Gate closed but items waiting: an offer would queue behind
        // them, so this refuses (and still queues nothing).
        let _ = offer(&mgr, "s", "b").await; // queued behind the open run
        mgr.queue_release_run("s").await;
        assert!(!mgr.queue_try_reserve("s").await);
        assert_eq!(texts(mgr.queue_snapshot("s").await), ["b"]);
        assert!(!mgr.run_state("s").await.open_run, "gate untouched");
        // A pending question lets it past the held items as the answer,
        // the same exception the offer makes (galley#30).
        set_ask_pending(&mgr, "s", true).await;
        assert!(mgr.queue_try_reserve("s").await);
        assert_eq!(texts(mgr.queue_snapshot("s").await), ["b"]);
        assert!(mgr.run_state("s").await.open_run);
    }

    #[test]
    fn side_question_prefix_rule() {
        for text in ["/btw", "/btw what?", "/btw\twhat?", "  /btw x", "\n/btw"] {
            assert!(is_side_question(text), "{text:?}");
        }
        for text in ["/btwx", "/BTW x", "x /btw", "", "/bt w", "/btw\nx"] {
            assert!(!is_side_question(text), "{text:?}");
        }
    }

    #[tokio::test]
    async fn try_reserve_run_only_when_fully_idle() {
        let mgr = RunnerManager::new();
        // Idle session: reserved; a second attempt sees the open gate.
        assert!(mgr.try_reserve_run("s").await);
        assert!(!mgr.try_reserve_run("s").await);
        // RunComplete closes the gate: reservable again.
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        assert!(mgr.try_reserve_run("s").await);
        // Release (failed dispatch) also reopens.
        mgr.queue_release_run("s").await;
        assert!(mgr.try_reserve_run("s").await);
    }

    #[tokio::test]
    async fn try_reserve_run_refuses_while_an_ask_user_is_pending() {
        let mgr = RunnerManager::new();
        mgr.queues
            .lock()
            .await
            .entry("s".into())
            .or_default()
            .ask_pending = true;
        assert!(
            !mgr.try_reserve_run("s").await,
            "never talk over a pending question"
        );
        mgr.queues.lock().await.get_mut("s").unwrap().ask_pending = false;
        assert!(mgr.try_reserve_run("s").await);
    }

    #[tokio::test]
    async fn run_outcome_is_taken_once_and_carries_the_continuation_mark() {
        let mgr = RunnerManager::new();
        assert!(mgr.take_run_outcome("s").await.is_none());
        mgr.mark_goal_continuation("s").await;
        {
            // Stand in for the forwarder's RunComplete handling.
            let mut q = mgr.queues.lock().await;
            let state = q.entry("s".into()).or_default();
            assert_eq!(state.run_kind, RunKind::GoalContinuation);
            state.last_outcome = Some(RunOutcome {
                continuation: state.run_kind == RunKind::GoalContinuation,
                goal_tag: Some("complete".into()),
                ..RunOutcome::default()
            });
            state.run_kind = RunKind::UserTurn;
        }
        let taken = mgr.take_run_outcome("s").await.expect("outcome");
        assert!(taken.continuation);
        assert_eq!(taken.goal_tag.as_deref(), Some("complete"));
        assert!(mgr.take_run_outcome("s").await.is_none(), "cleared on read");
    }

    #[tokio::test]
    async fn try_reserve_run_refuses_when_items_queued() {
        let mgr = RunnerManager::new();
        let _ = offer(&mgr, "s", "a").await; // DispatchNow, gate open
        let _ = offer(&mgr, "s", "b").await; // queued
        assert!(!mgr.try_reserve_run("s").await);
        // Gate closes on RunComplete but "b" pops with the gate
        // re-reserved — still not reservable until the queue drains dry.
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_some());
        assert!(!mgr.try_reserve_run("s").await);
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        assert!(mgr.try_reserve_run("s").await);
    }

    #[tokio::test]
    async fn run_state_reflects_gate_and_queue() {
        let mgr = RunnerManager::new();
        let idle = mgr.run_state("s").await;
        assert!(!idle.runner_alive && !idle.agent_running && !idle.open_run);
        assert_eq!(idle.queued_count, 0);
        let _ = offer(&mgr, "s", "a").await; // gate open
        let _ = offer(&mgr, "s", "b").await; // queued
        let busy = mgr.run_state("s").await;
        assert!(busy.open_run);
        assert_eq!(busy.queued_count, 1);
        // No subprocess in these tests: process-derived fields stay
        // false; the queue-side truth carries the busy signal.
        assert!(!busy.runner_alive && !busy.agent_running);
        assert!(!busy.ask_pending);
        assert_eq!(busy.last_exit, None);
        // The run ends on a question: both surface in the snapshot.
        set_ask_pending(&mgr, "s", true).await;
        settle(
            &mgr,
            "s",
            serde_json::json!({"result": "EXITED", "data": null}),
        )
        .await;
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        let asking = mgr.run_state("s").await;
        assert!(asking.ask_pending && !asking.open_run);
        assert_eq!(asking.queued_count, 1);
        assert_eq!(asking.last_exit.as_deref(), Some("EXITED"));
    }

    // ---------------- session-run-state (ticket 05c) ----------------

    #[derive(Default)]
    struct RecordingNotifier {
        events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl Notifier for RecordingNotifier {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }
    }

    impl RecordingNotifier {
        fn run_states(&self) -> Vec<serde_json::Value> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter(|(name, _)| name == crate::runner_manager::SESSION_RUN_STATE_EVENT)
                .map(|(_, payload)| payload.clone())
                .collect()
        }

        /// Wait for the `n`th run-state event and return all of them.
        async fn wait_for(&self, n: usize) -> Vec<serde_json::Value> {
            for _ in 0..200 {
                let states = self.run_states();
                if states.len() >= n {
                    return states;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            panic!(
                "expected {n} run-state events, got {:#?}",
                self.run_states()
            );
        }
    }

    fn publishing_manager() -> (Arc<RunnerManager>, Arc<RecordingNotifier>) {
        let mgr = Arc::new(RunnerManager::new());
        let notifier = Arc::new(RecordingNotifier::default());
        let (tx, rx) = mpsc::unbounded_channel();
        mgr.set_run_state_feed(tx);
        tokio::spawn(crate::runner_manager::publish_run_states(
            mgr.clone(),
            notifier.clone(),
            rx,
        ));
        (mgr, notifier)
    }

    /// `(openRun, queuedCount, askPending)` of a payload.
    fn gate(p: &serde_json::Value) -> (bool, u64, bool) {
        (
            p["openRun"].as_bool().unwrap(),
            p["queuedCount"].as_u64().unwrap(),
            p["askPending"].as_bool().unwrap(),
        )
    }

    #[tokio::test]
    async fn run_state_events_follow_the_gate_and_queue_once_per_change() {
        let (mgr, notifier) = publishing_manager();

        // A change that changes nothing: an idle session stays silent.
        mgr.queue_release_run("s").await;
        let _ = offer(&mgr, "s", "a").await; // gate open
        let states = notifier.wait_for(1).await;
        assert_eq!(
            states[0],
            serde_json::json!({
                "sessionId": "s",
                "runnerAlive": false,
                "agentRunning": false,
                "openRun": true,
                "queuedCount": 0,
                "askPending": false,
                "lastExit": null,
            })
        );

        let queued = match offer(&mgr, "s", "b").await {
            QueueOffer::Queued { queue_id, .. } => queue_id,
            other => panic!("expected queued, got {other:?}"),
        };
        assert_eq!(gate(&notifier.wait_for(2).await[1]), (true, 1, false));

        // The run ends on a question: one event, with the hold and the
        // reason the run ended.
        set_ask_pending(&mgr, "s", true).await;
        settle(
            &mgr,
            "s",
            serde_json::json!({"result": "EXITED", "data": null}),
        )
        .await;
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        let states = notifier.wait_for(3).await;
        assert_eq!(gate(&states[2]), (false, 1, true));
        assert_eq!(states[2]["lastExit"], "EXITED");

        // Repeats are dropped: releasing an already closed gate and a
        // second drain step change nothing.
        mgr.queue_release_run("s").await;
        assert!(mgr.queue_take_next(&rc_signal("s")).await.is_none());
        // The next real change is the very next event.
        assert!(mgr.queue_remove("s", &queued).await.is_some());
        let states = notifier.wait_for(4).await;
        assert_eq!(gate(&states[3]), (false, 0, true));
        assert_eq!(states.len(), 4, "no repeated snapshot: {states:#?}");

        // A second session is tracked on its own.
        assert!(mgr.try_reserve_run("t").await);
        let states = notifier.wait_for(5).await;
        assert_eq!(states[4]["sessionId"], "t");
        assert_eq!(gate(&states[4]), (true, 0, false));
    }
}
