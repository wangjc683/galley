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
//! Once the run settles — success, failure or stop alike — its runner is
//! shut down and the session is deleted through the ordinary session
//! delete (messages, attachments, search index): its task names what
//! the user asked not to be recorded, its tool calls carry the ledger,
//! its tool results the batch. The ledger never stays in Galley's
//! database (Rule 4); nothing records the session's id.
//!
//! "Completed successfully" is exact: the run's `run_complete` arrives
//! with GA's `CURRENT_TASK_DONE`, no fatal error was reported during the
//! run, it did not stop on an `ask_user` question, and no event was
//! missed. Anything else — abort, max turns, runner exit, timeout, the
//! user switching the ledger off mid-run ([`StopSignal`]) — is a
//! failure: `mined` stays where it was, so the next batch includes this
//! one, and the files the run may have half-written are put back as it
//! found them ([`super::rollback`]). A failure is exactly "nothing
//! happened".
//!
//! **Read cap** (ticket 04). One run reads at most [`READ_CAP_CHARS`]
//! characters of what the user said; "also read earlier conversations"
//! can hand it a long history. Past the cap the batch is cut by time
//! before one message ([`cap_batch`]) and the position moves only to the
//! cut; a run that succeeded with more left is due again
//! [`CONTINUE_AFTER`] later (`state.dueAt`), until everything is read. A
//! failed run waits for the next day as before — no retry loop that
//! spends the user's money on a failure. Cutting by time can split a
//! session across two runs; accepted, since every run first reads the
//! outputs so far.

use std::fmt::Display;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, FixedOffset, NaiveDateTime, NaiveTime, TimeZone, Utc};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::watch;

use super::batch::{build_batch, render_batch, task_prompt, Batch};
use super::im_archive::{self, read_archive_entries, ArchiveOutcome, ImRecord};
use super::sources::{self, GuiTurn};
use super::state::{LastRun, LedgerState, MinedCursor};
use super::{forgotten, rollback, LedgerConfig, LedgerPaths, LEDGER_SUPERVISOR};
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

/// Most characters of the user's words one run reads (GUI messages and
/// IM turns together).
pub const READ_CAP_CHARS: usize = 60_000;

/// After a successful run that stopped at the read cap, the next one is
/// due this much later.
pub const CONTINUE_AFTER: chrono::Duration = chrono::Duration::minutes(10);

/// Why a run stopped when the user switched the ledger off.
pub const STOPPED_REASON: &str = "stopped: the affairs ledger was switched off";

/// What a run may touch.
pub struct MiningDeps<'a> {
    pub galley: &'a SqliteGalley,
    pub runner: &'a dyn RunnerPort,
    /// The Tauri app in production (managed spawns need it); a fake in
    /// tests.
    pub env: Option<&'a dyn SpawnEnv>,
}

/// Raised from outside to stop the run in flight (the switch turned
/// off). Holds the stop generation it was taken at; any later one stops
/// it. See `super::control`.
#[derive(Debug, Clone)]
pub struct StopSignal {
    rx: watch::Receiver<u64>,
    at: u64,
}

impl StopSignal {
    pub fn new(rx: watch::Receiver<u64>) -> Self {
        let at = *rx.borrow();
        Self { rx, at }
    }

    /// A signal nothing can raise (tests, the eval harness).
    pub fn never() -> Self {
        let (_tx, rx) = watch::channel(0);
        Self::new(rx)
    }

    pub fn is_stopped(&self) -> bool {
        *self.rx.borrow() != self.at
    }

    /// Resolves once stopped; never when nothing can raise it.
    pub async fn stopped(&self) {
        let mut rx = self.rx.clone();
        loop {
            if *rx.borrow_and_update() != self.at {
                return;
            }
            if rx.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
        }
    }
}

/// How a run reports itself to the rest of Core; all optional (tests and
/// the eval harness leave them out).
#[derive(Default)]
pub struct RunHooks<'a> {
    pub stop: Option<StopSignal>,
    /// Set while a run is actually going (past the due check).
    pub running: Option<&'a AtomicBool>,
    /// Called when a run starts and when it settles (`memory-changed`).
    pub on_change: Option<&'a (dyn Fn() + Send + Sync)>,
}

/// Holds `running` and announces the start; announces the end on drop.
struct Going<'a>(&'a RunHooks<'a>);

impl<'a> Going<'a> {
    fn start(hooks: &'a RunHooks<'a>) -> Self {
        if let Some(flag) = hooks.running {
            flag.store(true, Ordering::SeqCst);
        }
        if let Some(on_change) = hooks.on_change {
            on_change();
        }
        Self(hooks)
    }
}

impl Drop for Going<'_> {
    fn drop(&mut self) {
        if let Some(flag) = self.0.running {
            flag.store(false, Ordering::SeqCst);
        }
        if let Some(on_change) = self.0.on_change {
            on_change();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// The resident tick: once per local day from [`RUN_AT`], and at
    /// `state.dueAt`.
    Scheduled,
    /// `run_ledger_now`: whenever asked.
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum RunReport {
    /// Nothing done: switched off, attach mode, not due, or a run already
    /// going.
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
    /// The batch stopped at the read cap; more is left.
    pub more: bool,
}

/// What [`cap_batch`] keeps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capped {
    pub gui: Vec<GuiTurn>,
    pub im: Vec<ImRecord>,
    /// `None`: everything fits. `Some`: GUI turns from this instant on
    /// and archive lines from `im_offset` on are left for later.
    pub cut: Option<Cut>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cut {
    pub gui_until: DateTime<Utc>,
    pub im_offset: u64,
}

fn chars(text: &str) -> usize {
    text.trim().chars().count()
}

/// Keep at most `cap` characters of what was said, oldest first, cutting
/// by time before one message: `gui` (sorted by time) up to the cut, and
/// the longest run of archive lines (`im`, in archive order, each with
/// the offset past its line, from `im_start`) said before it. Archive
/// lines are ordered by a running maximum of their times, so the kept
/// ones are always a prefix. Lines said before `since` are dropped and
/// count nothing. At least the earliest messages are kept, so every run
/// moves on, and messages of the same instant are never split.
pub fn cap_batch(
    gui: Vec<GuiTurn>,
    im: Vec<(ImRecord, u64)>,
    im_start: u64,
    since: DateTime<Utc>,
    cap: usize,
) -> Capped {
    // (time, chars, Some(im index) | None for GUI), in time order.
    let mut timeline: Vec<(DateTime<Utc>, usize, Option<usize>)> = Vec::new();
    let mut envelope = DateTime::<Utc>::MIN_UTC;
    let mut im_times = Vec::with_capacity(im.len());
    for (record, _) in &im {
        let at = DateTime::<FixedOffset>::parse_from_rfc3339(&record.at)
            .ok()
            .map(|t| t.with_timezone(&Utc));
        envelope = envelope.max(at.unwrap_or(envelope));
        let counted = at.is_some_and(|t| t >= since);
        im_times.push((envelope, if counted { chars(&record.text) } else { 0 }));
    }
    let (mut g, mut i) = (0, 0);
    while g < gui.len() || i < im.len() {
        let take_gui = i >= im.len() || (g < gui.len() && gui[g].at <= im_times[i].0);
        if take_gui {
            timeline.push((gui[g].at, chars(&gui[g].text), None));
            g += 1;
        } else {
            timeline.push((im_times[i].0, im_times[i].1, Some(i)));
            i += 1;
        }
    }

    let mut total = 0usize;
    let mut keep = timeline.len();
    for (k, (_, n, _)) in timeline.iter().enumerate() {
        if total > 0 && total + n > cap {
            keep = k;
            break;
        }
        total += n;
    }
    // Never split an instant: take every message of the last kept one.
    while keep < timeline.len() && keep > 0 && timeline[keep].0 == timeline[keep - 1].0 {
        keep += 1;
    }
    let cut = (keep < timeline.len()).then(|| {
        let gui_until = timeline[keep].0;
        let last_im = timeline[..keep].iter().rev().find_map(|(_, _, i)| *i);
        Cut {
            gui_until,
            im_offset: last_im.map_or(im_start, |i| im[i].1),
        }
    });
    let (gui, im) = match &cut {
        None => (gui, im.into_iter().map(|(r, _)| r).collect::<Vec<_>>()),
        Some(cut) => (
            gui.into_iter().filter(|t| t.at < cut.gui_until).collect(),
            im.into_iter()
                .take_while(|(_, end)| *end <= cut.im_offset)
                .map(|(r, _)| r)
                .collect(),
        ),
    };
    let im = im
        .into_iter()
        .filter(|r| {
            DateTime::<FixedOffset>::parse_from_rfc3339(&r.at)
                .is_ok_and(|t| t.with_timezone(&Utc) >= since)
        })
        .collect();
    Capped { gui, im, cut }
}

/// Archive new IM turns, then gather everything not yet processed: GUI
/// turns from the processed instant (or `since`) up to `now`, archive
/// lines from the processed offset to the end that were said from
/// `since` on, cut to [`READ_CAP_CHARS`]. Advances `state.im_logs`;
/// leaves `mined` alone.
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
    let since = config.since;
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
    let read = read_archive_entries(&paths.archive_file(), im_from)
        .map_err(|e| format!("reading the IM archive: {e}"))?;
    let capped = cap_batch(gui, read.records, read.start, since, READ_CAP_CHARS);

    let pending = match &capped.cut {
        None => MinedCursor {
            gui_until: until.to_rfc3339(),
            im_archive_offset: read.end,
        },
        Some(cut) => MinedCursor {
            gui_until: cut.gui_until.to_rfc3339(),
            im_archive_offset: cut.im_offset,
        },
    };
    Ok(Prepared {
        batch: build_batch(&capped.gui, &capped.im, tz),
        pending,
        archive,
        more: capped.cut.is_some(),
    })
}

fn parse_instant(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// A local wall time as an instant; a time a DST jump skips resolves an
/// hour later.
fn local_instant<Tz: TimeZone>(tz: &Tz, local: NaiveDateTime) -> DateTime<Utc> {
    tz.from_local_datetime(&local)
        .earliest()
        .or_else(|| {
            tz.from_local_datetime(&(local + chrono::Duration::hours(1)))
                .earliest()
        })
        .map_or_else(|| Utc.from_utc_datetime(&local), |t| t.with_timezone(&Utc))
}

/// The next daily run from the wall clock: today's [`RUN_AT`] (or now,
/// if that has passed) unless today has had its attempt or the ledger
/// was turned on after it — "from now" turned on at 10:00 has nothing
/// to read on today's schedule — else tomorrow's.
fn next_daily<Tz: TimeZone>(
    state: &LedgerState,
    config: &LedgerConfig,
    now: DateTime<Utc>,
    tz: &Tz,
) -> DateTime<Utc>
where
    Tz::Offset: Display,
{
    let local = now.with_timezone(tz).naive_local();
    let today = local.date();
    let today_run = today.and_time(RUN_AT);
    let attempted =
        state.last_attempt_date.as_deref() == Some(today.format("%Y-%m-%d").to_string().as_str());
    let since_local = config.since.with_timezone(tz).naive_local();
    if !attempted && since_local < today_run {
        local_instant(tz, today_run).max(now)
    } else {
        let tomorrow = today.succ_opt().expect("not the end of time");
        local_instant(tz, tomorrow.and_time(RUN_AT))
    }
}

/// When the resident tick will next run (at or after `now`): the daily
/// schedule, or `state.dueAt` when that is earlier.
pub fn next_run_at<Tz: TimeZone>(
    state: &LedgerState,
    config: &LedgerConfig,
    now: DateTime<Utc>,
    tz: &Tz,
) -> DateTime<Utc>
where
    Tz::Offset: Display,
{
    let daily = next_daily(state, config, now, tz);
    let next = match state.due_at.as_deref().and_then(parse_instant) {
        Some(due) => due.min(daily),
        None => daily,
    };
    next.max(now)
}

/// Due once per local day from [`RUN_AT`] (see [`next_run_at`]), and
/// from `state.dueAt` on.
pub fn due<Tz: TimeZone>(
    state: &LedgerState,
    config: &LedgerConfig,
    now: DateTime<Utc>,
    tz: &Tz,
) -> bool
where
    Tz::Offset: Display,
{
    next_run_at(state, config, now, tz) <= now
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
/// as pending and snapshot the files the run may change
/// ([`super::rollback`]). A snapshot an interrupted run left behind is
/// restored first. The task lists the entries the user deleted
/// (`forgotten.json`). The production run and the eval harness
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
    // Galley quit in the middle of the last run: undo what it wrote.
    if rollback::restore(paths).map_err(|e| format!("rolling back an interrupted run: {e}"))? {
        eprintln!("[ledger] rolled back the files of an interrupted run");
    }
    let prepared = prepare(galley, paths, config, state, now, tz).await?;
    let local_now = now.with_timezone(tz);
    state.last_attempt_date = Some(local_now.format("%Y-%m-%d").to_string());
    state.due_at = None;
    let turns = prepared.batch.turn_count;
    let save = |state: &LedgerState| {
        state
            .save(&paths.state_file())
            .map_err(|e| format!("saving ledger state: {e}"))
    };

    if prepared.batch.is_empty() {
        state.mined = Some(prepared.pending);
        state.pending = None;
        state.pending_more = false;
        state.last_run = Some(LastRun {
            started_at: now.to_rfc3339(),
            outcome: "empty".into(),
            detail: None,
            turns: 0,
        });
        save(state)?;
        return Ok(Begun::Empty);
    }

    let deleted = forgotten::load(&paths.forgotten_file()).unwrap_or_else(|e| {
        eprintln!("[ledger] the deletion list is unreadable, the task goes without it: {e}");
        Vec::new()
    });
    let generated_at = local_now.format("%Y-%m-%d %H:%M").to_string();
    fs::create_dir_all(paths.galley_dir())
        .and_then(|()| {
            fs::write(
                paths.batch_file(),
                render_batch(&prepared.batch, &generated_at),
            )
        })
        .map_err(|e| format!("writing the batch: {e}"))?;
    rollback::snapshot(paths).map_err(|e| format!("snapshotting the ledger: {e}"))?;
    state.pending = Some(prepared.pending);
    state.pending_more = prepared.more;
    state.last_run = Some(LastRun {
        started_at: now.to_rfc3339(),
        outcome: "running".into(),
        detail: None,
        turns,
    });
    save(state)?;
    let task = task_prompt(paths, &prepared.batch, &deleted);
    Ok(Begun::Ready {
        batch: prepared.batch,
        task,
    })
}

/// Settle the attempt [`begin`] recorded. Only `Ok` — a run that
/// completed successfully — turns the pending position into the
/// processed one, and when its batch stopped at the read cap makes the
/// next run due [`CONTINUE_AFTER`] after `ended_at`, and keeps the files
/// it wrote; a failure drops the pending position, so the next batch
/// repeats this one, puts the files back as the run found them
/// ([`super::rollback`]), and waits for the daily schedule.
pub fn finish(
    paths: &LedgerPaths,
    state: &mut LedgerState,
    verdict: &Result<(), String>,
    ended_at: DateTime<Utc>,
) -> std::io::Result<()> {
    let begun = state.last_run.take();
    let more = std::mem::take(&mut state.pending_more);
    let (outcome, detail) = match verdict {
        Ok(()) => {
            state.mined = state.pending.take();
            state.due_at = more.then(|| (ended_at + CONTINUE_AFTER).to_rfc3339());
            if let Err(e) = rollback::discard(paths) {
                eprintln!("[ledger] dropping the run's snapshot failed: {e}");
            }
            ("succeeded", None)
        }
        Err(reason) => {
            state.pending = None;
            state.due_at = None;
            // A failed restore keeps the snapshot; the next run's `begin`
            // restores it before anything else.
            if let Err(e) = rollback::restore(paths) {
                eprintln!("[ledger] rolling back the failed run failed: {e}");
            }
            ("failed", Some(reason.clone()))
        }
    };
    state.last_run = Some(LastRun {
        started_at: begun
            .as_ref()
            .map_or_else(|| ended_at.to_rfc3339(), |r| r.started_at.clone()),
        outcome: outcome.into(),
        detail,
        turns: begun.map_or(0, |r| r.turns),
    });
    state.save(&paths.state_file())
}

/// One attempt. Writes `state.json` (and the batch file when there is
/// something to read); never anything when the active runtime is not the
/// managed one (Rule 1: attach mode runs nothing).
#[allow(clippy::too_many_arguments)]
pub async fn run_once<Tz: TimeZone>(
    deps: &MiningDeps<'_>,
    paths: &LedgerPaths,
    config: &LedgerConfig,
    trigger: Trigger,
    now: DateTime<Utc>,
    tz: &Tz,
    timeout: Duration,
    hooks: &RunHooks<'_>,
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
    if trigger == Trigger::Scheduled && !due(&state, config, now, tz) {
        return RunReport::Skipped {
            reason: "not due".into(),
        };
    }
    let _going = Going::start(hooks);
    let started = std::time::Instant::now();
    let ended_at = || {
        now + chrono::Duration::from_std(started.elapsed())
            .unwrap_or_else(|_| chrono::Duration::zero())
    };
    let never = StopSignal::never();
    let stop = hooks.stop.as_ref().unwrap_or(&never);

    let (batch, task) = match begin(deps.galley, paths, config, &mut state, now, tz).await {
        Ok(Begun::Empty) => return RunReport::Empty,
        Ok(Begun::Ready { batch, task }) => (batch, task),
        Err(reason) => return failed(None, reason),
    };

    let day = now.with_timezone(tz).format("%Y-%m-%d").to_string();
    let (session_id, verdict) = if stop.is_stopped() {
        (None, Err(STOPPED_REASON.to_string()))
    } else {
        match start_session(deps, &task, &day).await {
            Ok((session_id, rx)) => {
                let verdict = watch_run(rx, timeout, stop).await;
                (Some(session_id), verdict)
            }
            Err((session_id, reason)) => (session_id, Err(reason)),
        }
    };
    if let Some(id) = &session_id {
        wind_down(deps, id).await;
    }
    if let Err(e) = finish(paths, &mut state, &verdict, ended_at()) {
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

pub(super) fn mining_origin() -> Origin {
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
/// Follow one run on its runner's broadcast until it settles, or until
/// `stop` is raised (the caller then shuts the runner down).
pub async fn watch_run(
    mut rx: broadcast::Receiver<BroadcastItem>,
    timeout: Duration,
    stop: &StopSignal,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut fatal: Option<String> = None;
    let mut asked = false;
    let mut lagged = false;
    loop {
        let next = tokio::select! {
            next = tokio::time::timeout_at(deadline, rx.recv()) => next,
            () = stop.stopped() => return Err(STOPPED_REASON.into()),
        };
        let item = match next {
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

/// Stop the mining runner, then delete its session through the ordinary
/// session delete (CASCADE: messages, tool events, attachments; the
/// search index alongside). Best effort: a failure here does not change
/// the run's verdict, and a session left behind is deleted at the next
/// launch or "clear" (`super::control`).
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
        .delete_session(SessionId(session_id.to_string()), mining_origin())
        .await
    {
        eprintln!("[ledger] deleting mining session {session_id}: {e}");
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
        watch_run(rx, Duration::from_secs(5), &StopSignal::never()).await
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
        assert!(
            watch_run(rx, Duration::from_millis(50), &StopSignal::never())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn raising_the_stop_signal_ends_the_watch_as_a_failure() {
        let (stop_tx, stop_rx) = watch::channel(0u64);
        let stop = StopSignal::new(stop_rx);
        let (_tx, rx) = broadcast::channel::<BroadcastItem>(4);
        let watching = tokio::spawn({
            let stop = stop.clone();
            async move { watch_run(rx, Duration::from_secs(60), &stop).await }
        });
        stop_tx.send_modify(|g| *g += 1);
        assert_eq!(watching.await.unwrap(), Err(STOPPED_REASON.to_string()));
        assert!(stop.is_stopped());
        // A signal taken after the raise is not stopped.
        assert!(!StopSignal::new(stop_tx.subscribe()).is_stopped());
        assert!(!StopSignal::never().is_stopped());
    }

    fn shanghai() -> FixedOffset {
        FixedOffset::east_opt(8 * 3600).unwrap()
    }

    /// Shanghai wall time → instant.
    fn at(s: &str) -> DateTime<Utc> {
        let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap();
        shanghai()
            .from_local_datetime(&naive)
            .single()
            .unwrap()
            .with_timezone(&Utc)
    }

    fn on_since(s: &str) -> LedgerConfig {
        LedgerConfig {
            since: at(s),
            look_back: false,
        }
    }

    #[test]
    fn due_once_a_day_from_four() {
        let config = on_since("2026-10-01 00:00");
        let due_at = |state: &LedgerState, s: &str| due(state, &config, at(s), &shanghai());
        let mut state = LedgerState::default();
        assert!(!due_at(&state, "2026-10-12 03:59"));
        assert!(due_at(&state, "2026-10-12 04:00"));
        assert!(due_at(&state, "2026-10-12 23:00"));
        state.last_attempt_date = Some("2026-10-12".into());
        assert!(!due_at(&state, "2026-10-12 23:00"));
        assert!(!due_at(&state, "2026-10-13 03:00"));
        assert!(due_at(&state, "2026-10-13 09:30"));
        assert_eq!(
            next_run_at(&state, &config, at("2026-10-12 23:00"), &shanghai()),
            at("2026-10-13 04:00")
        );
        assert_eq!(
            next_run_at(&state, &config, at("2026-10-13 03:00"), &shanghai()),
            at("2026-10-13 04:00")
        );
    }

    /// Ticket 04: "from now" turned on after today's run time has nothing
    /// to read on today's schedule.
    #[test]
    fn turned_on_from_now_after_four_waits_for_tomorrow() {
        let config = on_since("2026-10-12 10:00");
        let state = LedgerState::default();
        assert!(!due(&state, &config, at("2026-10-12 10:01"), &shanghai()));
        assert!(!due(&state, &config, at("2026-10-12 23:59"), &shanghai()));
        assert!(due(&state, &config, at("2026-10-13 04:00"), &shanghai()));
        assert_eq!(
            next_run_at(&state, &config, at("2026-10-12 10:01"), &shanghai()),
            at("2026-10-13 04:00")
        );
        // Turned on before four: today's run reads what was said since.
        let early = on_since("2026-10-12 02:00");
        assert!(due(&state, &early, at("2026-10-12 04:00"), &shanghai()));
    }

    #[test]
    fn due_at_overrides_the_daily_schedule() {
        let config = on_since("2026-10-01 00:00");
        let mut state = LedgerState {
            last_attempt_date: Some("2026-10-12".into()),
            ..LedgerState::default()
        };
        state.due_at = Some(at("2026-10-12 10:10").to_rfc3339());
        assert!(!due(&state, &config, at("2026-10-12 10:09"), &shanghai()));
        assert!(due(&state, &config, at("2026-10-12 10:10"), &shanghai()));
        assert_eq!(
            next_run_at(&state, &config, at("2026-10-12 10:00"), &shanghai()),
            at("2026-10-12 10:10")
        );
        // Overdue reads as now.
        assert_eq!(
            next_run_at(&state, &config, at("2026-10-12 11:00"), &shanghai()),
            at("2026-10-12 11:00")
        );
    }

    fn gui_turn(at_s: &str, text: &str) -> GuiTurn {
        GuiTurn {
            session_id: "s".into(),
            message_id: format!("m-{at_s}-{text}"),
            at: at(at_s),
            text: text.into(),
        }
    }

    /// Archive lines with their end offsets, 100 bytes each from 1000.
    fn im_lines(items: &[(&str, &str)]) -> Vec<(ImRecord, u64)> {
        items
            .iter()
            .enumerate()
            .map(|(i, (t, text))| {
                (
                    ImRecord {
                        at: at(t).with_timezone(&shanghai()).to_rfc3339(),
                        channel: Some("feishu".into()),
                        log: "model_responses_1.txt".into(),
                        text: (*text).into(),
                    },
                    1000 + 100 * (i as u64 + 1),
                )
            })
            .collect()
    }

    #[test]
    fn under_the_cap_everything_is_kept() {
        let capped = cap_batch(
            vec![gui_turn("2026-10-12 09:00", "一二三")],
            im_lines(&[("2026-10-12 08:00", "四五")]),
            1000,
            at("2026-10-01 00:00"),
            5,
        );
        assert_eq!(capped.cut, None);
        assert_eq!((capped.gui.len(), capped.im.len()), (1, 1));
    }

    #[test]
    fn over_the_cap_the_batch_is_cut_by_time_before_one_message() {
        let gui = vec![
            gui_turn("2026-10-12 08:00", "一二三"),
            gui_turn("2026-10-12 10:00", "七八"),
            gui_turn("2026-10-12 12:00", "九"),
        ];
        let im = im_lines(&[("2026-10-12 09:00", "四五六"), ("2026-10-12 11:00", "十")]);
        // 3 + 3 = 6 fit; the 10:00 message would make 8.
        let capped = cap_batch(gui, im, 1000, at("2026-10-01 00:00"), 7);
        let cut = capped.cut.expect("cut");
        assert_eq!(cut.gui_until, at("2026-10-12 10:00"));
        assert_eq!(cut.im_offset, 1100);
        assert_eq!(capped.gui.len(), 1);
        assert_eq!(capped.im.len(), 1);
        assert_eq!(capped.im[0].text, "四五六");
    }

    #[test]
    fn the_cut_always_moves_on_and_never_splits_an_instant() {
        // One message bigger than the cap on its own is still read.
        let huge = "字".repeat(100);
        let capped = cap_batch(
            vec![
                gui_turn("2026-10-12 08:00", &huge),
                gui_turn("2026-10-12 09:00", "后面"),
            ],
            Vec::new(),
            0,
            at("2026-10-01 00:00"),
            10,
        );
        assert_eq!(capped.gui.len(), 1);
        assert_eq!(capped.cut.unwrap().gui_until, at("2026-10-12 09:00"));

        // Two messages of the same second go together.
        let capped = cap_batch(
            vec![
                gui_turn("2026-10-12 08:00", "一二三"),
                gui_turn("2026-10-12 08:00", "四五六"),
                gui_turn("2026-10-12 09:00", "七"),
            ],
            Vec::new(),
            0,
            at("2026-10-01 00:00"),
            4,
        );
        assert_eq!(capped.gui.len(), 2);
        assert_eq!(capped.cut.unwrap().gui_until, at("2026-10-12 09:00"));
    }

    #[test]
    fn archive_lines_are_kept_as_a_prefix_and_before_since_count_nothing() {
        // Out of order in the archive (two logs appended in one pass): the
        // 08:00 line comes after the 10:00 one and is read with it.
        let im = im_lines(&[
            ("2026-09-30 08:00", "起点之前说的很长很长的一段话"),
            ("2026-10-12 10:00", "一二三"),
            ("2026-10-12 08:00", "四五六"),
            ("2026-10-12 11:00", "七八九"),
        ]);
        let capped = cap_batch(Vec::new(), im, 1000, at("2026-10-01 00:00"), 6);
        let cut = capped.cut.expect("cut");
        assert_eq!(cut.im_offset, 1300);
        assert_eq!(cut.gui_until, at("2026-10-12 11:00"));
        assert_eq!(
            capped
                .im
                .iter()
                .map(|r| r.text.as_str())
                .collect::<Vec<_>>(),
            ["一二三", "四五六"]
        );
    }
}
