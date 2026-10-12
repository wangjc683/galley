//! Who may touch the ledger when, and the Memory page's operations
//! (ticket 04). The Tauri commands (`crate::commands::ledger`) are thin
//! wrappers over these; tests drive them with their own
//! [`LedgerControl`].
//!
//! - **One run at a time** (`run` lock): the resident tick and
//!   `run_ledger_now` take it with `try_lock` and skip when it is held.
//! - **Deletes do not queue behind a run.** A delete while a run is going
//!   answers [`LEDGER_BUSY`]: the model is rewriting the same files.
//! - **Switching off stops the run in flight.** The switch is written
//!   first, then the stop generation is raised ([`super::run::StopSignal`]);
//!   a run takes its generation *before* it reads the switch, so it
//!   either sees off and does nothing or sees the stop. The run counts as
//!   failed (position unchanged), shuts its runner down and writes its
//!   state; only then is the run lock free, and only then does "clear"
//!   remove `history_insight/` — nothing the run does can write it back.
//! - **Galley's own files** (`forgotten.json`, `state.json` outside a
//!   run, the global-memory files) are changed under the `files` lock,
//!   so a clear and an "unforget" never interleave.
//! - **Managed runtime only** (Rule 1): every page operation first checks
//!   the active runtime and answers [`MANAGED_ONLY`] in attach mode,
//!   having read and written nothing.

use std::fmt::Display;
use std::fs;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use serde::Serialize;
use tokio::sync::{watch, Mutex, MutexGuard};

use super::config::{read_switch, LedgerSwitch, SWITCH_PREF};
use super::entries::{self, Activities, Emotions, EntryKind, Parsed};
use super::forgotten::{self, Forgotten};
use super::global_memory::{self, GlobalMemoryFile};
use super::run::{self, MiningDeps, RunHooks, RunReport, StopSignal, Trigger};
use super::state::LedgerState;
use super::{affairs, write_atomic, LedgerPaths, TitledExclusion};
use crate::api::RuntimeKind;
use crate::db::SqliteGalley;

/// Error identifiers of the Memory page's commands (the GUI words them).
pub const MANAGED_ONLY: &str = "managed_only";
pub const LEDGER_BUSY: &str = "ledger_busy";
pub const NOT_FOUND: &str = "not_found";
pub const CHANGED_ON_DISK: &str = "changed_on_disk";
/// `run_ledger_now` while the switch is not on.
pub const LEDGER_OFF: &str = "ledger_off";

/// How long a delete waits for the run lock: a tick that finds nothing
/// due holds it for milliseconds, a real run for up to hours.
const LOCK_PATIENCE: Duration = Duration::from_secs(2);

pub struct LedgerControl {
    run: Mutex<()>,
    files: Mutex<()>,
    running: AtomicBool,
    /// The stop generation; raised by every switch-off.
    stop: watch::Sender<u64>,
}

static GLOBAL: LazyLock<LedgerControl> = LazyLock::new(LedgerControl::new);

impl Default for LedgerControl {
    fn default() -> Self {
        Self::new()
    }
}

/// What the page is told about the last attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRunView {
    pub started_at: String,
    /// `running` / `succeeded` / `failed` / `empty`.
    pub outcome: String,
    pub turns: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerOverview {
    pub switch: LedgerSwitch,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<LastRunView>,
    /// RFC 3339; while on and not running.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    pub activities: Parsed<Activities>,
    pub emotions: Parsed<Emotions>,
    pub forgotten: Vec<Forgotten>,
    pub exclusions: Vec<TitledExclusion>,
}

/// `get_memory_overview`'s answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryOverview {
    pub ledger: LedgerOverview,
    pub global_memory: Vec<GlobalMemoryFile>,
}

/// `set_ledger_switch`'s two actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwitchChange {
    /// "From now" or "also read earlier conversations".
    Enable { look_back: bool },
    /// "Keep what is recorded" or "clear it too".
    Disable { clear: bool },
}

/// [`MANAGED_ONLY`] unless the active runtime is the managed one.
pub async fn require_managed(galley: &SqliteGalley) -> Result<(), String> {
    match galley.active_runtime_kind().await {
        Ok(RuntimeKind::Managed) => Ok(()),
        Ok(_) => Err(MANAGED_ONLY.into()),
        Err(e) => Err(format!("runtime kind unavailable: {e}")),
    }
}

fn io_error(what: &str, e: io::Error) -> String {
    format!("{what}: {e}")
}

impl LedgerControl {
    pub fn new() -> Self {
        Self {
            run: Mutex::new(()),
            files: Mutex::new(()),
            running: AtomicBool::new(false),
            stop: watch::channel(0).0,
        }
    }

    /// The one production instance.
    pub fn global() -> &'static Self {
        &GLOBAL
    }

    /// A run is going (past its due check).
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// The run lock without waiting (the startup IM archive).
    pub(crate) fn try_lock_run(&self) -> Option<MutexGuard<'_, ()>> {
        self.run.try_lock().ok()
    }

    async fn lock_run_briefly(&self) -> Option<MutexGuard<'_, ()>> {
        if self.is_running() {
            return None;
        }
        tokio::time::timeout(LOCK_PATIENCE, self.run.lock())
            .await
            .ok()
    }

    /// One attempt, if the switch is on and no other run holds the lock.
    /// The stop generation is taken before the switch is read (see the
    /// module notes).
    #[allow(clippy::too_many_arguments)]
    pub async fn run<Tz: TimeZone>(
        &self,
        deps: &MiningDeps<'_>,
        paths: &LedgerPaths,
        trigger: Trigger,
        now: DateTime<Utc>,
        tz: &Tz,
        timeout: Duration,
        on_change: Option<&(dyn Fn() + Send + Sync)>,
    ) -> RunReport
    where
        Tz::Offset: Display,
    {
        let Ok(_run) = self.run.try_lock() else {
            return RunReport::Skipped {
                reason: "a ledger run is already going".into(),
            };
        };
        let stop = StopSignal::new(self.stop.subscribe());
        let Some(config) = read_switch(deps.galley).await.config() else {
            return RunReport::Skipped {
                reason: "the affairs ledger is off".into(),
            };
        };
        let hooks = RunHooks {
            stop: Some(stop),
            running: Some(&self.running),
            on_change,
        };
        run::run_once(deps, paths, &config, trigger, now, tz, timeout, &hooks).await
    }

    /// `set_ledger_switch`. Returns the switch as now stored.
    pub async fn set_switch(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        change: SwitchChange,
        now: DateTime<Utc>,
    ) -> Result<LedgerSwitch, String> {
        require_managed(galley).await?;
        match change {
            SwitchChange::Enable { look_back } => self.enable(galley, paths, look_back, now).await,
            SwitchChange::Disable { clear } => self.disable(galley, paths, clear).await,
        }
    }

    async fn enable(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        look_back: bool,
        now: DateTime<Utc>,
    ) -> Result<LedgerSwitch, String> {
        let switch = LedgerSwitch::turned_on(look_back, now);
        let pref = switch.to_pref().expect("on is stored");
        galley
            .set_pref_json(SWITCH_PREF, pref)
            .await
            .map_err(|e| e.to_string())?;
        if look_back {
            // The first run within a minute (the next tick), not at the
            // next 04:00. "From now" has nothing to read yet.
            match self.lock_run_briefly().await {
                Some(_run) => {
                    let _files = self.files.lock().await;
                    let path = paths.state_file();
                    match LedgerState::load(&path) {
                        Ok(mut state) => {
                            state.due_at = Some(now.to_rfc3339());
                            if let Err(e) = state.save(&path) {
                                eprintln!("[ledger] scheduling the first run failed: {e}");
                            }
                        }
                        Err(e) => eprintln!("[ledger] scheduling the first run failed: {e}"),
                    }
                }
                None => eprintln!("[ledger] a run is going; the next one follows the schedule"),
            }
        }
        Ok(switch)
    }

    async fn disable(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        clear: bool,
    ) -> Result<LedgerSwitch, String> {
        let pref = LedgerSwitch::Off.to_pref().expect("off is stored");
        galley
            .set_pref_json(SWITCH_PREF, pref)
            .await
            .map_err(|e| e.to_string())?;
        self.stop
            .send_modify(|generation| *generation = generation.wrapping_add(1));
        // Wait for the run in flight, if any, to settle completely.
        let _run = self.run.lock().await;
        if clear {
            let _files = self.files.lock().await;
            match fs::remove_dir_all(paths.insight_dir()) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(io_error("clearing the affairs ledger", e)),
            }
        }
        Ok(LedgerSwitch::Off)
    }

    /// `delete_ledger_entry`: remove entry `id`'s block from its file,
    /// its line from the short list, and put it on the "do not record
    /// again" list.
    pub async fn delete_entry(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), String> {
        require_managed(galley).await?;
        let kind = EntryKind::of_id(id).ok_or(NOT_FOUND)?;
        let Some(_run) = self.lock_run_briefly().await else {
            return Err(LEDGER_BUSY.into());
        };
        let _files = self.files.lock().await;
        let file = match kind {
            EntryKind::Activity => paths.activities_file(),
            EntryKind::Emotion => paths.emotions_file(),
        };
        let text = match fs::read(&file) {
            Ok(bytes) => {
                String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8", file.display()))?
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(NOT_FOUND.into()),
            Err(e) => return Err(io_error("reading the ledger", e)),
        };
        let removed = entries::remove_entry(&text, id).ok_or(NOT_FOUND)?;
        // The list first: should the rest fail, the entry is at worst
        // still shown, never rebuilt unasked.
        forgotten::add(
            &paths.forgotten_file(),
            Forgotten {
                id: id.to_string(),
                kind,
                title: removed.title,
                deleted_at: now.to_rfc3339(),
            },
        )
        .map_err(|e| io_error("updating the deletion list", e))?;
        write_atomic(&file, removed.text.as_bytes())
            .map_err(|e| io_error("writing the ledger", e))?;
        if kind == EntryKind::Activity {
            let list = paths.affairs_file();
            if let Ok(raw) = fs::read_to_string(&list) {
                if let Some(rest) = affairs::remove_affair(&raw, id) {
                    write_atomic(&list, rest.as_bytes())
                        .map_err(|e| io_error("writing the affairs list", e))?;
                }
            }
        }
        Ok(())
    }

    /// `unforget_ledger_entry`: take `id` off the "do not record again"
    /// list (it may be recorded again; nothing deleted comes back).
    pub async fn unforget(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        id: &str,
    ) -> Result<(), String> {
        require_managed(galley).await?;
        let _files = self.files.lock().await;
        forgotten::remove(&paths.forgotten_file(), id)
            .map_err(|e| io_error("updating the deletion list", e))
    }

    /// `write_global_memory`: returns the new revision.
    pub async fn write_global_memory(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        name: &str,
        content: &str,
        revision: &str,
    ) -> Result<String, String> {
        require_managed(galley).await?;
        let _files = self.files.lock().await;
        global_memory::write(paths, name, content, revision).map_err(|e| match e {
            global_memory::WriteError::UnknownName => NOT_FOUND.to_string(),
            global_memory::WriteError::ChangedOnDisk => CHANGED_ON_DISK.to_string(),
            global_memory::WriteError::Io(e) => io_error("writing the global memory", e),
        })
    }

    /// `get_memory_overview`. Reads only; nothing is created.
    pub async fn overview<Tz: TimeZone>(
        &self,
        galley: &SqliteGalley,
        paths: &LedgerPaths,
        now: DateTime<Utc>,
        tz: &Tz,
    ) -> Result<MemoryOverview, String>
    where
        Tz::Offset: Display,
    {
        require_managed(galley).await?;
        let switch = read_switch(galley).await;
        let running = self.is_running();
        let state = LedgerState::load(&paths.state_file()).unwrap_or_else(|e| {
            eprintln!("[ledger] {e}");
            LedgerState::default()
        });
        let last_run = state.last_run.as_ref().map(|r| {
            // A "running" record with no run going: Galley quit mid-run.
            let interrupted = r.outcome == "running" && !running;
            LastRunView {
                started_at: r.started_at.clone(),
                outcome: if interrupted {
                    "failed".into()
                } else {
                    r.outcome.clone()
                },
                turns: r.turns,
                detail: if interrupted {
                    Some("interrupted: Galley quit before the run finished".into())
                } else {
                    r.detail.clone()
                },
            }
        });
        let next_run_at = match (switch.config(), running) {
            (Some(config), false) => Some(run::next_run_at(&state, &config, now, tz).to_rfc3339()),
            _ => None,
        };
        let forgotten = forgotten::load(&paths.forgotten_file()).unwrap_or_else(|e| {
            eprintln!("[ledger] {e}");
            Vec::new()
        });
        let exclusions = galley
            .list_ledger_exclusions_titled()
            .await
            .map_err(|e| e.to_string())?;
        Ok(MemoryOverview {
            ledger: LedgerOverview {
                switch,
                running,
                last_run,
                next_run_at,
                activities: entries::read_activities(&paths.activities_file()),
                emotions: entries::read_emotions(&paths.emotions_file()),
                forgotten,
                exclusions,
            },
            global_memory: global_memory::read_all(paths),
        })
    }
}

/// `get_ledger_switch`.
pub async fn get_switch(galley: &SqliteGalley) -> Result<LedgerSwitch, String> {
    require_managed(galley).await?;
    Ok(read_switch(galley).await)
}
