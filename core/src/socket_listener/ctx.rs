//! Dependency seams for the socket write handlers.
//!
//! Handlers receive everything they may touch through [`HandlerCtx`]
//! instead of reaching for globals (`SqliteGalley::open()`) or concrete
//! process state (`&RunnerManager`, `Option<&AppHandle>`). Production
//! builds the ctx once per dispatched line ([`super::dispatch_line`]);
//! integration tests build it from an in-memory pool, a fake
//! [`RunnerPort`], and a recording [`Notifier`] — which is what makes the
//! persist → dispatch → emit orchestration (and every `spawn_failed`
//! rollback branch) testable without a live Tauri app.
//!
//! ADR-0002 note: this changes where dependencies COME FROM, not what the
//! handlers do. Each command keeps its own explicit, contract-bound
//! failure behavior.

use crate::api::QueuedMessage;
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::ipc::IpcCommand;
use crate::notify::{notify, Notifier};
use crate::runner_manager::{
    BroadcastItem, QueueJump, QueueOffer, RunState, RunnerManager, RunnerSpawnError,
    SendCommandError, ShutdownError, SpawnArgs,
};
use async_trait::async_trait;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::broadcast;

/// Exactly what the socket layer is allowed to do to the runner
/// registry — nothing more. The width of this trait IS the documented
/// coupling between the two modules.
#[async_trait]
pub trait RunnerPort: Send + Sync {
    async fn spawn(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError>;
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError>;
    async fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>>;
    async fn pid(&self, session_id: &str) -> Option<u32>;
    async fn agent_running(&self, session_id: &str) -> bool;
    async fn shutdown(
        &self,
        session_id: &str,
        grace: Option<Duration>,
    ) -> Result<(), ShutdownError>;

    // ---- Outbound message queue (galley#19/#20) ----
    //
    // Defaults encode "no queue support": offer always says dispatch
    // now, everything else is a no-op. The real RunnerManager overrides
    // all of them; test fakes keep pre-queue behavior for free.

    async fn queue_offer(
        &self,
        _session_id: &str,
        _text: String,
        _origin: Option<crate::api::Origin>,
    ) -> QueueOffer {
        QueueOffer::DispatchNow
    }
    async fn queue_release_run(&self, _session_id: &str) {}
    async fn queue_jump(&self, _session_id: &str, _queue_id: &str) -> QueueJump {
        QueueJump::NotFound
    }
    async fn queue_requeue_front(&self, _session_id: &str, _item: QueuedMessage) {}
    async fn queue_remove(&self, _session_id: &str, _queue_id: &str) -> Option<QueuedMessage> {
        None
    }
    async fn queue_snapshot(&self, _session_id: &str) -> Vec<QueuedMessage> {
        Vec::new()
    }
    /// Reserve the run gate only when the session is idle with an empty
    /// queue (Goal-turn dispatch gate). Default says "reserved" so
    /// queue-less test fakes keep pre-gate behavior for free.
    async fn try_reserve_run(&self, _session_id: &str) -> bool {
        true
    }
    /// Live run-state snapshot (`session.run_state`). Default reads as
    /// fully idle, matching the no-queue-support fakes.
    async fn run_state(&self, _session_id: &str) -> RunState {
        RunState {
            runner_alive: false,
            agent_running: false,
            open_run: false,
            queued_count: 0,
        }
    }
}

#[async_trait]
impl RunnerPort for RunnerManager {
    async fn spawn(
        &self,
        args: SpawnArgs,
        active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        RunnerManager::spawn(self, args, active_session_id).await
    }
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        RunnerManager::send_command(self, session_id, cmd).await
    }
    async fn subscribe(&self, session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        RunnerManager::subscribe(self, session_id).await
    }
    async fn pid(&self, session_id: &str) -> Option<u32> {
        RunnerManager::pid(self, session_id).await
    }
    async fn agent_running(&self, session_id: &str) -> bool {
        RunnerManager::agent_running(self, session_id).await
    }
    async fn shutdown(
        &self,
        session_id: &str,
        grace: Option<Duration>,
    ) -> Result<(), ShutdownError> {
        RunnerManager::shutdown(self, session_id, grace).await
    }

    async fn queue_offer(
        &self,
        session_id: &str,
        text: String,
        origin: Option<crate::api::Origin>,
    ) -> QueueOffer {
        RunnerManager::queue_offer(self, session_id, text, origin).await
    }
    async fn queue_release_run(&self, session_id: &str) {
        RunnerManager::queue_release_run(self, session_id).await
    }
    async fn queue_jump(&self, session_id: &str, queue_id: &str) -> QueueJump {
        RunnerManager::queue_jump(self, session_id, queue_id).await
    }
    async fn queue_requeue_front(&self, session_id: &str, item: QueuedMessage) {
        RunnerManager::queue_requeue_front(self, session_id, item).await
    }
    async fn queue_remove(&self, session_id: &str, queue_id: &str) -> Option<QueuedMessage> {
        RunnerManager::queue_remove(self, session_id, queue_id).await
    }
    async fn queue_snapshot(&self, session_id: &str) -> Vec<QueuedMessage> {
        RunnerManager::queue_snapshot(self, session_id).await
    }
    async fn try_reserve_run(&self, session_id: &str) -> bool {
        RunnerManager::try_reserve_run(self, session_id).await
    }
    async fn run_state(&self, session_id: &str) -> RunState {
        RunnerManager::run_state(self, session_id).await
    }
}

/// Where a handler's DB connection comes from. `Global` preserves the
/// production behavior exactly (per-handler `SqliteGalley::open()`
/// against the on-disk `workbench.db`, failing with `db_unavailable`
/// when it's absent — commands that never touch the DB, like `ping`,
/// stay alive when it's broken). `Pool` is the test seam: the same
/// injection point `db_writes_test.rs` already drives 78 tests through.
pub enum DbSource {
    Global,
    Pool(SqliteGalley),
}

impl DbSource {
    pub async fn get(&self) -> Result<SqliteGalley, GalleyError> {
        match self {
            DbSource::Global => SqliteGalley::open().await,
            DbSource::Pool(g) => Ok(g.clone()),
        }
    }
}

/// Everything a socket write handler may touch.
pub struct HandlerCtx<'a> {
    pub db: &'a DbSource,
    pub runner: &'a dyn RunnerPort,
    pub notifier: Arc<dyn Notifier>,
    /// Documented residual coupling: managed-runtime spawn preparation
    /// (`prepare_managed_spawn_args`) genuinely needs the Tauri app (data
    /// dirs, credential store). `None` in headless/test dispatch — tests
    /// exercise spawn paths with external runtime kind instead.
    pub app: Option<&'a AppHandle>,
}

impl HandlerCtx<'_> {
    /// Best-effort GUI event with a typed payload. Replaces the old
    /// `if let Some(app) = app { let _ = app.emit(...) }` blocks.
    pub fn notify<T: Serialize>(&self, event: &str, payload: &T) {
        notify(self.notifier.as_ref(), event, payload);
    }
}
