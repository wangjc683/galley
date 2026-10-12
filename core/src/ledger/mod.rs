//! Affairs ledger, background mining
//! (`.scratch/main-chat/issues/01-affairs-ledger.md`), and the Memory
//! page's view of it (`.scratch/main-chat/issues/04-what-it-remembers-page.md`).
//!
//! Once a day Core reads what the human said — user messages typed into
//! GUI-created managed sessions ([`sources`]), and IM private-chat turns
//! recognised in the engine logs and archived before those logs are
//! pruned ([`im_archive`]) — writes the new turns into one batch file
//! ([`batch`]) and starts a hidden managed session that follows
//! upstream's 历史重点挖掘 SOP over it, in a format Galley pins and
//! parses ([`entries`]), maintaining `memory/history_insight/` in the
//! managed state root ([`run`]). The processed position ([`state`])
//! moves only after that run completed successfully. Each run ends with
//! a short list of the ongoing affairs ([`affairs`], ticket 03a), which
//! Core puts in the main chat's and the IM channels' session-start state
//! block.
//!
//! - **Switch**: Core pref `affairs_ledger` ([`config`]), set from the
//!   Memory page. Default undecided, which is off. Read live: the daily
//!   tick is resident ([`start`]) and does nothing while off; the startup
//!   IM archive ([`archive_before_prune`]) and both injections read it
//!   too. While off nothing here creates a file or a directory.
//! - **The user's say** ([`control`], ticket 04): the page shows every
//!   entry, deletes one deterministically (the "do not record again"
//!   list, [`forgotten`], asks the model not to rebuild it), switches the
//!   ledger off (keeping or clearing everything, stopping a run in
//!   flight), and edits GA's global memory ([`global_memory`]).
//! - **Managed runtime only** (Rule 1): every entry point does nothing —
//!   and every page command answers `managed_only` — while the active
//!   runtime is attach mode, and nothing here reads or writes outside the
//!   managed state root.
//! - **Not GA's reflect mode**: the schedule is Core's (a wall-clock
//!   tick like `crate::scheduler`), the run is an ordinary managed
//!   session. No managed patch, no upstream file edited.
//! - **Not `native_memory_*`**: those tables are the June Galley Native
//!   experiment's (`022_native_memory_substrate.sql`), unrelated.
//!
//! Files, all under `<state root>/memory/history_insight/` ("clear"
//! removes the directory):
//!
//! ```text
//! history_insight/            the SOP's outputs (the model's; user state)
//!   activities.md             ongoing and ended affairs (`entries`)
//!   emotional_events.md       emotional events (`entries`)
//!   ongoing_affairs.md        the short list each run ends with: ongoing
//!                             affairs only, one numbered line each
//!                             (`affairs`); written by the model, read
//!                             by Core
//!   galley/                   Galley's own, read-only to the model
//!     state.json              positions + last run (`state`)
//!     im_archive.jsonl        archived IM user turns (`im_archive`)
//!     batch.md                the current run's input (`batch`)
//!     forgotten.json          entries the user deleted (`forgotten`)
//!     rollback/               the three files as a running run found
//!                             them; restored if it fails (`rollback`)
//! ```
//!
//! Nothing of the ledger stays in Galley's database: the hidden mining
//! session is deleted — messages, attachments, search index — as soon as
//! its run settles, whatever the outcome (`run`); "clear" and every
//! launch delete any mining session still there ([`control`]).

pub mod affairs;
pub mod batch;
pub mod config;
pub mod control;
pub mod entries;
pub mod forgotten;
pub mod global_memory;
pub mod im_archive;
pub mod rollback;
pub mod run;
pub mod sources;
pub mod state;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::api::{OriginVia, RuntimeKind, SessionBrief};
use crate::db::SqliteGalley;
use crate::runner_manager::RunnerManager;

pub use config::{read_switch, LedgerConfig, LedgerSwitch};
pub use control::LedgerControl;
pub use run::{MiningDeps, RunReport, Trigger};

/// Supervisor label on the mining session (origin `system`). The GUI
/// and phone session lists drop sessions carrying it
/// ([`is_mining_session`]).
pub const LEDGER_SUPERVISOR: &str = "galley-ledger";

/// Tauri event (no payload) after anything the Memory page shows
/// changed: the switch, a run starting or settling, a delete, an
/// "unforget", an exclusion, a global-memory write. The page refetches
/// the overview.
pub const MEMORY_CHANGED_EVENT: &str = "memory-changed";

const TICK_SECONDS: u64 = 60;

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

/// A mark with its session's title or project's name (archived sessions
/// included; a deleted target takes its mark with it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitledExclusion {
    pub target: LedgerTarget,
    pub created_at: String,
    pub title: Option<String>,
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
    /// GA's memory directory (global memory, SOPs, the ledger).
    pub fn memory_dir(&self) -> PathBuf {
        self.state_root.join("memory")
    }
    /// Upstream's mining SOP, seeded into the managed memory.
    pub fn sop_file(&self) -> PathBuf {
        self.memory_dir()
            .join("L4_raw_sessions")
            .join("salient_mining_sop.md")
    }
    /// The SOP's output directory.
    pub fn insight_dir(&self) -> PathBuf {
        self.memory_dir().join("history_insight")
    }
    /// Ongoing and ended affairs, in the pinned format ([`entries`]).
    pub fn activities_file(&self) -> PathBuf {
        self.insight_dir().join("activities.md")
    }
    /// Emotional events, in the pinned format ([`entries`]).
    pub fn emotions_file(&self) -> PathBuf {
        self.insight_dir().join("emotional_events.md")
    }
    /// The ongoing-affairs short list ([`affairs`]): beside the SOP's
    /// own outputs, since the model writes it.
    pub fn affairs_file(&self) -> PathBuf {
        self.insight_dir().join("ongoing_affairs.md")
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
    /// The "do not record again" list ([`forgotten`]).
    pub fn forgotten_file(&self) -> PathBuf {
        self.galley_dir().join("forgotten.json")
    }
    /// A running run's snapshot of the files it may change ([`rollback`]).
    pub fn rollback_dir(&self) -> PathBuf {
        self.galley_dir().join("rollback")
    }
}

/// Replace `path` with `body` through a temp file beside it and a rename,
/// creating the directory.
pub(crate) fn write_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, path)
}

pub(crate) fn paths_for_app(app: &tauri::AppHandle) -> std::io::Result<LedgerPaths> {
    crate::managed_runtime::state_root_for_app(app).map(LedgerPaths::new)
}

/// Tell the Memory page to refetch.
pub(crate) fn emit_memory_changed(app: &tauri::AppHandle) {
    let _ = app.emit(MEMORY_CHANGED_EVENT, ());
}

/// Startup step, before `model_responses_prune` (see `app_setup`): copy
/// the IM turns the logs gained since the last pass into the archive,
/// so a log the prune is about to delete is never lost. No bridge exists
/// yet, so every log's last block counts as complete. Synchronous; it
/// reads only logs written since the last pass (or since `since`).
/// Nothing while the switch is not on.
pub(crate) fn archive_before_prune(app: &tauri::App) {
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    let Some(config) = tauri::async_runtime::block_on(read_switch(&galley)).config() else {
        return;
    };
    match tauri::async_runtime::block_on(galley.active_runtime_kind()) {
        Ok(RuntimeKind::Managed) => {}
        Ok(_) => return,
        Err(e) => {
            eprintln!("[ledger] startup archive skipped: runtime kind unavailable: {e}");
            return;
        }
    }
    let Some(_run) = LedgerControl::global().try_lock_run() else {
        return;
    };
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
    match im_archive::archive_im_turns(&paths, &mut state, config.since, false) {
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

/// Mount the resident tick (from `start_background_services`). Once a
/// minute it reads the switch and, while on, re-derives "is a run due?"
/// from the wall clock and `state.json`, so lid sleep, clock changes and
/// the switch flipping need no special case.
pub(crate) fn start(app: &tauri::App) {
    let handle = app.handle().clone();
    let galley: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
        // A mining session still in the database is a run Galley quit in
        // the middle of; at launch no run is going. Under the run lock
        // all the same, ahead of the first tick.
        match LedgerControl::global().sweep_mining_sessions(&galley).await {
            Ok(0) => {}
            Ok(n) => eprintln!("[ledger] deleted {n} leftover mining session(s)"),
            Err(e) => eprintln!("[ledger] deleting leftover mining sessions failed: {e}"),
        }
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECONDS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            run_for_app(&handle, &galley, Trigger::Scheduled).await;
        }
    });
}

/// One attempt with the production adapters, under the switch.
pub(crate) async fn run_for_app(
    app: &tauri::AppHandle,
    galley: &SqliteGalley,
    trigger: Trigger,
) -> RunReport {
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
    let on_change = || emit_memory_changed(app);
    let report = LedgerControl::global()
        .run(
            &deps,
            &paths,
            trigger,
            Utc::now(),
            &Local,
            run::RUN_TIMEOUT,
            Some(&on_change),
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
        assert_eq!(
            p.affairs_file(),
            PathBuf::from("/x/managed-ga-state/memory/history_insight/ongoing_affairs.md")
        );
        assert_eq!(
            p.forgotten_file(),
            PathBuf::from("/x/managed-ga-state/memory/history_insight/galley/forgotten.json")
        );
        assert_eq!(
            p.emotions_file(),
            PathBuf::from("/x/managed-ga-state/memory/history_insight/emotional_events.md")
        );
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a/b/activities.md");
        write_atomic(&path, "一".as_bytes()).unwrap();
        write_atomic(&path, "二".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "二");
        assert!(!dir.path().join("a/b/activities.md.tmp").exists());
    }
}
