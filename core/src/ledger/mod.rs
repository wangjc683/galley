//! Affairs ledger, background mining
//! (`.scratch/main-chat/issues/01-affairs-ledger.md`).
//!
//! Once a day Core reads what the human said — user messages typed into
//! GUI-created managed sessions ([`sources`]), and IM private-chat turns
//! recognised in the engine logs and archived before those logs are
//! pruned ([`im_archive`]) — writes the new turns into one batch file
//! ([`batch`]) and starts a hidden managed session that follows
//! upstream's 历史重点挖掘 SOP over it, maintaining
//! `memory/history_insight/` in the managed state root ([`run`]). The
//! processed position ([`state`]) moves only after that run completed
//! successfully.
//!
//! - **Switch**: [`LedgerConfig::from_env`] (`GALLEY_LEDGER_SINCE`).
//!   Unset → [`start`] and [`archive_before_prune`] return at once; no
//!   task, no file, no directory.
//! - **Managed runtime only** (Rule 1): both entry points do nothing
//!   while the active runtime is attach mode, and nothing here reads or
//!   writes outside the managed state root.
//! - **Not GA's reflect mode**: the schedule is Core's (a wall-clock
//!   tick like `crate::scheduler`), the run is an ordinary managed
//!   session. No managed patch, no upstream file edited.
//! - **Not `native_memory_*`**: those tables are the June Galley Native
//!   experiment's (`022_native_memory_substrate.sql`), unrelated.
//!
//! Files, all under `<state root>/memory/history_insight/`:
//!
//! ```text
//! history_insight/            the SOP's outputs (the model's; user state)
//!   galley/                   Galley's own, read-only to the model
//!     state.json              positions + last run (`state`)
//!     im_archive.jsonl        archived IM user turns (`im_archive`)
//!     batch.md                the current run's input (`batch`)
//! ```

pub mod batch;
pub mod config;
pub mod im_archive;
pub mod run;
pub mod sources;
pub mod state;

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::api::{OriginVia, RuntimeKind, SessionBrief};
use crate::db::SqliteGalley;
use crate::runner_manager::RunnerManager;

pub use config::LedgerConfig;
pub use run::{MiningDeps, RunReport, Trigger};

/// Supervisor label on the mining session (origin `system`). The GUI
/// and phone session lists drop sessions carrying it
/// ([`is_mining_session`]).
pub const LEDGER_SUPERVISOR: &str = "galley-ledger";

const TICK_SECONDS: u64 = 60;

/// One run at a time: the daily tick and `run_ledger_now` share it.
static RUN_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Whether `session` is a ledger mining session — never shown in the
/// sidebar, the archived list or on the phone.
pub fn is_mining_session(session: &SessionBrief) -> bool {
    session.origin.as_ref().is_some_and(|origin| {
        origin.via == OriginVia::System && origin.supervisor.as_deref() == Some(LEDGER_SUPERVISOR)
    })
}

/// What a "not used to understand me" mark is on (migration 045). Wire
/// shape: `{"kind": "session" | "project", "id": "…"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum LedgerTarget {
    Session(String),
    Project(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerExclusion {
    pub target: LedgerTarget,
    pub created_at: String,
}

/// Where the ledger's inputs and outputs live, from the managed state
/// root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerPaths {
    state_root: PathBuf,
}

impl LedgerPaths {
    pub fn new(state_root: PathBuf) -> Self {
        Self { state_root }
    }
    pub fn state_root(&self) -> &Path {
        &self.state_root
    }
    pub fn temp_dir(&self) -> PathBuf {
        self.state_root.join("temp")
    }
    /// The engine's LLM logs (`crate::model_responses_prune`).
    pub fn model_responses_dir(&self) -> PathBuf {
        self.temp_dir().join("model_responses")
    }
    /// Galley's IM channel state (`<state root>/im/<channel>/`).
    pub fn im_state_dir(&self) -> PathBuf {
        self.state_root.join("im")
    }
    /// Upstream's mining SOP, seeded into the managed memory.
    pub fn sop_file(&self) -> PathBuf {
        self.state_root
            .join("memory")
            .join("L4_raw_sessions")
            .join("salient_mining_sop.md")
    }
    /// The SOP's output directory.
    pub fn insight_dir(&self) -> PathBuf {
        self.state_root.join("memory").join("history_insight")
    }
    pub fn galley_dir(&self) -> PathBuf {
        self.insight_dir().join("galley")
    }
    pub fn state_file(&self) -> PathBuf {
        self.galley_dir().join("state.json")
    }
    pub fn archive_file(&self) -> PathBuf {
        self.galley_dir().join("im_archive.jsonl")
    }
    pub fn batch_file(&self) -> PathBuf {
        self.galley_dir().join("batch.md")
    }
}

fn paths_for_app(app: &tauri::AppHandle) -> std::io::Result<LedgerPaths> {
    crate::managed_runtime::state_root_for_app(app).map(LedgerPaths::new)
}

/// Startup step, before `model_responses_prune` (see `app_setup`): copy
/// the IM turns the logs gained since the last pass into the archive,
/// so a log the prune is about to delete is never lost. No bridge exists
/// yet, so every log's last block counts as complete. Synchronous; it
/// reads only logs written since the last pass (or since `since`).
pub(crate) fn archive_before_prune(app: &tauri::App) {
    let Some(config) = LedgerConfig::from_env() else {
        return;
    };
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    match tauri::async_runtime::block_on(galley.active_runtime_kind()) {
        Ok(RuntimeKind::Managed) => {}
        Ok(_) => return,
        Err(e) => {
            eprintln!("[ledger] startup archive skipped: runtime kind unavailable: {e}");
            return;
        }
    }
    let paths = match paths_for_app(app.handle()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[ledger] startup archive skipped: {e}");
            return;
        }
    };
    let mut state = match state::LedgerState::load(&paths.state_file()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[ledger] startup archive skipped: {e}");
            return;
        }
    };
    match im_archive::archive_im_turns(&paths, &mut state, config.since_local(), false) {
        Ok(outcome) => {
            if let Err(e) = state.save(&paths.state_file()) {
                eprintln!("[ledger] startup archive: saving state failed: {e}");
            } else if outcome.appended > 0 {
                eprintln!("[ledger] startup archive: {outcome:?}");
            }
        }
        Err(e) => eprintln!("[ledger] startup archive failed: {e}"),
    }
}

/// Mount the daily job (from `start_background_services`). A tick a
/// minute re-derives "is today's run due?" from the wall clock, so lid
/// sleep and clock changes need no special case.
pub(crate) fn start(app: &tauri::App) {
    let Some(config) = LedgerConfig::from_env() else {
        return;
    };
    eprintln!(
        "[ledger] on: reading what was said since {} (daily from {})",
        config.since,
        run::RUN_AT.format("%H:%M")
    );
    let handle = app.handle().clone();
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECONDS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            run_for_app(&handle, &galley, &config, Trigger::Scheduled).await;
        }
    });
}

/// One attempt with the production adapters.
pub(crate) async fn run_for_app(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
    config: &LedgerConfig,
    trigger: Trigger,
) -> RunReport {
    let Ok(_guard) = RUN_LOCK.try_lock() else {
        return RunReport::Skipped {
            reason: "a ledger run is already going".into(),
        };
    };
    let paths = match paths_for_app(app) {
        Ok(p) => p,
        Err(e) => {
            return RunReport::Failed {
                session_id: None,
                reason: format!("managed state root: {e}"),
            }
        }
    };
    let manager: Arc<RunnerManager> = app.state::<Arc<RunnerManager>>().inner().clone();
    let deps = MiningDeps {
        galley,
        runner: manager.as_ref(),
        env: Some(app as &dyn crate::session_runner::SpawnEnv),
    };
    let report = run::run_once(
        &deps,
        &paths,
        config,
        trigger,
        Utc::now(),
        &Local,
        run::RUN_TIMEOUT,
    )
    .await;
    match &report {
        RunReport::Skipped { .. } if trigger == Trigger::Scheduled => {}
        other => eprintln!("[ledger] {other:?}"),
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::Origin;

    fn brief(origin: Option<Origin>) -> SessionBrief {
        let mut brief: SessionBrief = serde_json::from_value(serde_json::json!({
            "id": "s1",
            "title": "t",
            "status": "idle",
            "lastActivityAt": "2026-10-12T00:00:00+00:00",
            "createdAt": "2026-10-12T00:00:00+00:00",
            "updatedAt": "2026-10-12T00:00:00+00:00",
            "runtimeKind": "managed",
            "runtimeLabel": "Galley",
            "gaRuntimeKind": "managed",
        }))
        .unwrap();
        brief.origin = origin;
        brief
    }

    fn origin(via: OriginVia, supervisor: Option<&str>) -> Option<Origin> {
        Some(Origin {
            via,
            supervisor: supervisor.map(str::to_string),
            reason: None,
            client: None,
        })
    }

    #[test]
    fn only_system_sessions_with_the_ledger_label_are_mining_sessions() {
        assert!(is_mining_session(&brief(origin(
            OriginVia::System,
            Some(LEDGER_SUPERVISOR)
        ))));
        assert!(!is_mining_session(&brief(None)));
        assert!(!is_mining_session(&brief(origin(OriginVia::System, None))));
        // A supervisor that happens to use the label is still shown.
        assert!(!is_mining_session(&brief(origin(
            OriginVia::Supervisor,
            Some(LEDGER_SUPERVISOR)
        ))));
    }

    #[test]
    fn target_wire_shape() {
        assert_eq!(
            serde_json::to_value(LedgerTarget::Project("p1".into())).unwrap(),
            serde_json::json!({"kind": "project", "id": "p1"})
        );
        let t: LedgerTarget =
            serde_json::from_value(serde_json::json!({"kind": "session", "id": "s1"})).unwrap();
        assert_eq!(t, LedgerTarget::Session("s1".into()));
    }

    #[test]
    fn paths_hang_off_the_state_root() {
        let p = LedgerPaths::new(PathBuf::from("/x/managed-ga-state"));
        assert_eq!(
            p.archive_file(),
            PathBuf::from("/x/managed-ga-state/memory/history_insight/galley/im_archive.jsonl")
        );
        assert_eq!(
            p.model_responses_dir(),
            PathBuf::from("/x/managed-ga-state/temp/model_responses")
        );
        assert_eq!(
            p.sop_file(),
            PathBuf::from("/x/managed-ga-state/memory/L4_raw_sessions/salient_mining_sop.md")
        );
    }
}
