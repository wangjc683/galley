use clap::{Parser, Subcommand, ValueEnum};
use galley_core_lib::api::{
    GoalEventType, GoalMode, GoalTaskStatus, GoalWriteMode, DEFAULT_GOAL_BUDGET_SECONDS,
    DEFAULT_GOAL_WORKER_LIMIT,
};

#[derive(Parser, Debug)]
#[command(
    name = "galley",
    version,
    about = "Agent-first interface to Galley (the local agent team orchestrator)."
)]
pub(crate) struct Cli {
    /// Pin the schema version this caller expects. Current binaries speak
    /// only `1`; a mismatch exits 2 (`invalid_args`) with a message
    /// prefixed `schema_mismatch:`. Omit to use the binary's default
    /// (currently `1`).
    #[arg(long = "schema", value_name = "N", global = true)]
    pub(crate) schema: Option<u32>,

    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    /// Operations on multiple sessions (list / search).
    #[command(subcommand)]
    Sessions(SessionsCmd),

    /// Operations on a single session (brief / show / follow / write).
    #[command(subcommand)]
    Session(SessionCmd),

    /// Aggregate counts (total / running / waitingInput / errored) plus a
    /// `live` busy/queued rollup when Galley Core is reachable.
    Status,

    /// Run local health probes. Python-dependent rows report the legacy
    /// value `deferred_b4`, meaning "not probed by this command".
    Health,

    /// Print the CLI + schema version.
    Version,

    /// Project operations (create / list / brief / show / follow /
    /// delete). `delete` is destructive: child sessions detach to
    /// ungrouped and survive; there is no reversible project archive.
    #[command(subcommand)]
    Project(ProjectCmd),

    /// Autonomous Goal operations (propose / run / status / active / stop /
    /// task / event / deliverable).
    #[command(subcommand)]
    Goal(GoalCmd),

    /// LLM commands. `llm list` reads the model list the GUI cached
    /// after a bridge warmup (open Galley once to populate). `llm set`
    /// persists a per-session pick and tells any live runner.
    #[command(subcommand)]
    Llm(LlmCmd),
}

#[derive(Subcommand, Debug)]
pub(crate) enum ProjectCmd {
    /// Create a project.
    Create {
        /// Project name (will be trimmed; empty → exit 2).
        name: String,
        /// Optional Project folder. Metadata only unless paired with
        /// --enable-workspace.
        #[arg(long)]
        root_path: Option<String>,
        /// Activate GenericAgent Workspace / Project Mode for sessions
        /// in this Project. Requires --root-path.
        #[arg(long)]
        enable_workspace: bool,
        /// Optional legacy icon metadata. Current GUI renders Phosphor folder icons.
        #[arg(long)]
        icon: Option<String>,
        /// Optional accent color (hex e.g. `#7c84ff`).
        #[arg(long)]
        color: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// List all projects ordered pinned-first then by recency.
    /// Read-only — opens SQLite directly without requiring Galley Core
    /// to be running.
    List,
    /// One-project rollup for supervisor batch orchestration.
    /// Read-only — opens SQLite directly and includes session status
    /// counts plus currently-running sessions.
    Brief {
        /// Project id.
        project_id: String,
        /// Include archived sessions in counts and rollup.
        #[arg(long)]
        all: bool,
    },
    /// Project rollup plus each session's recent transcript tail.
    /// Read-only — useful when a supervisor is preparing a final
    /// batch summary.
    Show {
        /// Project id.
        project_id: String,
        /// Return only the last N messages per session.
        #[arg(long, default_value_t = 20)]
        tail: usize,
        /// Include archived sessions.
        #[arg(long)]
        all: bool,
    },
    /// Follow live sessions inside a project. Emits an initial project
    /// snapshot, then merged live runner events tagged with sessionId,
    /// then a final snapshot when all live subscriptions end.
    Follow {
        /// Project id.
        project_id: String,
        /// Return only the last N messages per session in snapshots.
        #[arg(long, default_value_t = 10)]
        tail: usize,
        /// Include archived sessions in snapshots and subscription attempts.
        #[arg(long)]
        all: bool,
        /// Exit after the project has had no active sessions for a short
        /// quiet window. Useful for supervisor batch jobs where runner
        /// processes may stay alive after a turn completes.
        #[arg(long)]
        until_idle: bool,
        /// Emit one final project snapshot before the stream end frame.
        /// This is especially useful with --until-idle so supervisors can
        /// synthesize without running a separate project show.
        #[arg(long)]
        final_show: bool,
    },
    /// Permanently delete a project. Destructive and not reversible.
    /// Child sessions detach to ungrouped and survive; the response
    /// carries `detachedSessions` plus the affected session ids so a
    /// supervisor can log the side effect.
    Delete {
        /// Project id.
        project_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum GoalCmd {
    /// Create a pending conversational-confirmation proposal. Does not start work.
    Propose {
        objective: String,
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = DEFAULT_GOAL_BUDGET_SECONDS / 60)]
        budget_minutes: u32,
        #[arg(long, default_value_t = DEFAULT_GOAL_WORKER_LIMIT)]
        workers: u32,
        #[arg(long, value_enum, default_value = "current")]
        runtime: RuntimeArg,
        #[arg(long, value_enum, default_value = "autonomous")]
        write_mode: GoalWriteModeArg,
        /// Engine: `hive` (master + parallel workers, cross-verified) or
        /// `solo` (single agent to budget). Defaults to `hive` for
        /// backward compatibility; the desktop GUI defaults to `solo`.
        #[arg(long, value_enum, default_value = "hive")]
        mode: GoalModeArg,
        #[arg(long, default_value_t = 10)]
        expires_minutes: u32,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Start or resume the blocking Goal controller.
    Run {
        /// Existing goal id when used with --resume.
        goal_id: Option<String>,
        #[arg(long)]
        proposal: Option<String>,
        #[arg(long)]
        confirm_token: Option<String>,
        #[arg(long)]
        resume: bool,
        /// Operator's resolved UI locale (`zh-CN` / `en-US`) for the
        /// Galley-authored master-session narration this controller
        /// writes. Optional; defaults to Chinese when omitted, matching
        /// the surface's pre-localization behavior.
        #[arg(long)]
        locale: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Return Goal status, task board, recent events, and project sessions.
    Status { goal_id: String },
    /// List active (running / wrapping) goals. Galley runs at most one Goal
    /// at a time; empty output means none is active. Read-only.
    Active,
    /// Request a graceful stop.
    Stop {
        goal_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Goal task board commands.
    #[command(subcommand)]
    Task(GoalTaskCmd),
    /// Append-only Goal event stream commands.
    #[command(subcommand)]
    Event(GoalEventCmd),
    /// Deliverable anchor commands (current best result, refined over rounds).
    #[command(subcommand)]
    Deliverable(GoalDeliverableCmd),
}

#[derive(Subcommand, Debug)]
pub(crate) enum GoalDeliverableCmd {
    /// Print the current deliverable anchor (highest version). Empty when none.
    Get { goal_id: String },
    /// Append a new deliverable anchor version (the current best result).
    Set {
        goal_id: String,
        content: String,
        #[arg(long)]
        note: Option<String>,
        #[arg(long)]
        author_session: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum GoalTaskCmd {
    Create {
        goal_id: String,
        title: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        scope: Option<String>,
        #[arg(long)]
        owner_session: Option<String>,
    },
    Claim {
        task_id: String,
        #[arg(long)]
        owner_session: String,
        #[arg(long)]
        scope: Option<String>,
    },
    Update {
        task_id: String,
        #[arg(long, value_enum)]
        status: Option<GoalTaskStatusArg>,
        #[arg(long)]
        owner_session: Option<String>,
        #[arg(long)]
        clear_owner: bool,
        #[arg(long)]
        scope: Option<String>,
        #[arg(long)]
        clear_scope: bool,
        #[arg(long)]
        result_summary: Option<String>,
        #[arg(long)]
        clear_result: bool,
    },
    Complete {
        task_id: String,
        #[arg(long)]
        result_summary: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum GoalEventCmd {
    Post {
        goal_id: String,
        #[arg(long, value_enum)]
        event_type: GoalEventTypeArg,
        body: String,
        #[arg(long)]
        task: Option<String>,
        #[arg(long)]
        author_session: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum LlmCmd {
    /// List LLMs configured in the user's `mykey.py`. Read-only — opens
    /// SQLite directly. Returns the same cached shape the GUI stores after
    /// a bridge warmup. Empty NDJSON when the cache is unwarmed (open the
    /// GUI once to populate).
    List,
    /// Pick the LLM for a session by display name (case-insensitive).
    /// Persists stable `selectedLlmKey` plus the legacy index/display
    /// companion on the session row + best-effort tells the live runner via
    /// `IpcCommand::SetLlm`. The DB write is the source of truth; the
    /// runner dispatch is opportunistic. `dispatch=dispatched` /
    /// `persisted_only` indicates which path ran.
    Set {
        /// Session id.
        session_id: String,
        /// Display name of the LLM as it appears in `galley llm list`
        /// (case-insensitive).
        llm_name: String,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum SessionsCmd {
    /// List sessions, ordered pinned first then by recency. Each row
    /// carries a `live` run-state object when Galley Core is reachable —
    /// the persisted `status` column never reads `running`, so check
    /// `live.busy` to see which sessions are actually working.
    List {
        /// Runtime scope. Default follows the GUI's current runtime so
        /// agents see the same session set as the human operator.
        #[arg(long, value_enum, default_value = "current")]
        runtime: RuntimeArg,
        /// Filter to one project id.
        #[arg(long)]
        project: Option<String>,
        /// Filter to one session status (idle / running / archived / …).
        #[arg(long)]
        status: Option<String>,
        /// Include only archived sessions.
        #[arg(long)]
        archived: bool,
        /// Include archived + active sessions (overrides --archived).
        #[arg(long)]
        all: bool,
    },
    /// FTS5 trigram search across persisted message bodies.
    Search {
        /// Runtime scope. Default follows the GUI's current runtime so
        /// agents see the same session set as the human operator.
        #[arg(long, value_enum, default_value = "current")]
        runtime: RuntimeArg,
        /// Query string. Returns no hits for <2 chars; LIKE fallback
        /// for 2-char queries; FTS5 phrase match for >=3 chars.
        query: String,
        /// Search archived sessions too (default: active only).
        #[arg(long)]
        all: bool,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum SessionCmd {
    /// One-row summary for a session id, plus a `live` run-state object
    /// (`busy` / `openRun` / `queuedCount` …) when Galley Core is reachable.
    Brief {
        /// Session id (e.g. `sess_abc…`).
        id: String,
    },
    /// Conversation messages for a session.
    Show {
        /// Session id.
        id: String,
        /// Return only the last N messages instead of the full
        /// transcript. Useful for agents catching up.
        #[arg(long)]
        tail: Option<usize>,
    },
    /// Send a user message into a session. Persists the message with the
    /// supplied origin and dispatches it to the live runner; a mid-run
    /// send is held in Galley Core's queue (`dispatch: "queued"`) and
    /// runs when the current task finishes. Requires Galley Core (exit 4
    /// if the socket isn't reachable).
    Send {
        /// Session id.
        id: String,
        /// Message body.
        content: String,
        /// Supervisor label — the agent identity / SOP name (e.g.
        /// "ga-claude-1"). Required for via=supervisor; optional for
        /// via=cli.
        #[arg(long)]
        supervisor: Option<String>,
        /// Free-text reason for the action. Shows up in audit/log views.
        #[arg(long)]
        reason: Option<String>,
        /// Jump the queue: when the session is mid-run, abort the
        /// current task and run this message first. Without it a
        /// mid-run send waits its turn (`dispatch: "queued"`).
        #[arg(long)]
        jump: bool,
    },
    /// Stream live runner events from a session. NDJSON on stdout, one
    /// event per line, no backlog. Exits cleanly when the runner exits
    /// (`{"stream":"end",...}`) or on SIGINT; exit 3 when the session
    /// has no live runner — prefer `follow` unless you need raw events.
    Watch {
        /// Session id.
        id: String,
    },
    /// Read the recent transcript, then follow live runner events if a
    /// runner is available. Unlike `watch`, this command gracefully
    /// ends when there is no live runner.
    Follow {
        /// Session id.
        id: String,
        /// Return only the last N messages in the initial/final snapshots.
        #[arg(long, default_value_t = 20)]
        tail: usize,
    },
    /// Poll persisted session state until an agent-visible message
    /// appears or the bounded wait times out. Intended for Supervisor /
    /// IM flows where a local tool timeout must not be treated as task
    /// failure.
    Wait {
        /// Session id.
        id: String,
        /// Maximum wait time in seconds.
        #[arg(long, default_value_t = 300)]
        timeout: u64,
        /// Poll interval in seconds. Values below 1 are clamped to 1.
        #[arg(long, default_value_t = 5)]
        poll: u64,
        /// Return only the last N messages in wait snapshots.
        #[arg(long, default_value_t = 20)]
        tail: usize,
        /// Include final tail messages in the final payload. Defaults
        /// true; pass `--final-show=false` for a compact final row.
        #[arg(
            long,
            default_value_t = true,
            default_missing_value = "true",
            num_args = 0..=1,
            action = clap::ArgAction::Set
        )]
        final_show: bool,
        /// Only count agent messages with turnIndex >= N as completion.
        /// Guards multi-turn sessions: without it, send→wait returns
        /// immediately on the PREVIOUS turn's answer.
        #[arg(long)]
        after_turn: Option<u32>,
    },
    /// Create a new session with a first user message. Atomic: session
    /// row + first message commit together or roll back together. Returns
    /// `{session, message, dispatch}` with `dispatch=dispatched` after
    /// Galley Core starts a runner and sends the first task. Runner
    /// start/send failures exit 5 so callers know delegation did not begin.
    New {
        /// First user message. Doubles as the seed for title derivation
        /// after the bridge finishes the first turn.
        task: String,
        /// Optional project id. Session is detached (ungrouped) if omitted.
        #[arg(long)]
        project: Option<String>,
        /// Optional LLM display name (case-insensitive). Resolved against
        /// the `llm_list` pref cached by the GUI after warmup; if the
        /// cache is empty or the name is unknown, exits 2 (invalid args).
        #[arg(long)]
        llm: Option<String>,
        /// Runtime for the new session. Default follows the GUI's
        /// current runtime; managed/external must be explicit when an
        /// agent intentionally creates work outside the visible mode.
        #[arg(long, value_enum, default_value = "current")]
        runtime: RuntimeArg,
        /// Supervisor label — agent identity / SOP name. Sets origin via
        /// to `supervisor`; omit for via=`cli`.
        #[arg(long)]
        supervisor: Option<String>,
        /// Free-text reason for the action. Surfaces in audit views.
        #[arg(long)]
        reason: Option<String>,
    },
    /// Send a transient "by the way" side question into a running
    /// session. The runner answers it inline without disturbing the main
    /// task. Not persisted to the transcript; requires a live runner
    /// (exit 5 otherwise).
    Btw {
        /// Session id.
        id: String,
        /// Side question body.
        question: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Stop the current turn in a session. Aborts the running task but
    /// keeps the runner alive, so a later `session send` resumes without
    /// a respawn. Reversible in effect. Idempotent: stopping an idle
    /// session returns `{dispatch: "already_stopped"}` and exit 0.
    Stop {
        /// Session id.
        id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Archive a session — flips status to `archived` and hides it from
    /// the GUI sidebar's active list. Reversible via `session restore`.
    Archive {
        /// Session id.
        id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Restore (unarchive) a previously archived session. Flips status
    /// from `archived` back to `idle`; no-op if the session wasn't
    /// archived.
    Restore {
        /// Session id.
        id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Move a session into / out of a project. `--to=<project-id>`
    /// attaches; omit `--to` to detach (move to ungrouped).
    Move {
        /// Session id.
        id: String,
        /// Target project id. Omit to detach from any project.
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum RuntimeArg {
    Current,
    Managed,
    External,
    All,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum GoalWriteModeArg {
    Autonomous,
    ReadOnly,
}

impl From<GoalWriteModeArg> for GoalWriteMode {
    fn from(value: GoalWriteModeArg) -> Self {
        match value {
            GoalWriteModeArg::Autonomous => GoalWriteMode::Autonomous,
            GoalWriteModeArg::ReadOnly => GoalWriteMode::ReadOnly,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum GoalModeArg {
    Hive,
    Solo,
}

impl From<GoalModeArg> for GoalMode {
    fn from(value: GoalModeArg) -> Self {
        match value {
            GoalModeArg::Hive => GoalMode::Hive,
            GoalModeArg::Solo => GoalMode::Solo,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum GoalTaskStatusArg {
    Open,
    Claimed,
    Running,
    Completed,
    Blocked,
    Cancelled,
}

impl From<GoalTaskStatusArg> for GoalTaskStatus {
    fn from(value: GoalTaskStatusArg) -> Self {
        match value {
            GoalTaskStatusArg::Open => GoalTaskStatus::Open,
            GoalTaskStatusArg::Claimed => GoalTaskStatus::Claimed,
            GoalTaskStatusArg::Running => GoalTaskStatus::Running,
            GoalTaskStatusArg::Completed => GoalTaskStatus::Completed,
            GoalTaskStatusArg::Blocked => GoalTaskStatus::Blocked,
            GoalTaskStatusArg::Cancelled => GoalTaskStatus::Cancelled,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum GoalEventTypeArg {
    Plan,
    Claim,
    Progress,
    Result,
    Conflict,
    Synthesis,
    System,
}

impl From<GoalEventTypeArg> for GoalEventType {
    fn from(value: GoalEventTypeArg) -> Self {
        match value {
            GoalEventTypeArg::Plan => GoalEventType::Plan,
            GoalEventTypeArg::Claim => GoalEventType::Claim,
            GoalEventTypeArg::Progress => GoalEventType::Progress,
            GoalEventTypeArg::Result => GoalEventType::Result,
            GoalEventTypeArg::Conflict => GoalEventType::Conflict,
            GoalEventTypeArg::Synthesis => GoalEventType::Synthesis,
            GoalEventTypeArg::System => GoalEventType::System,
        }
    }
}
