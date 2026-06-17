use clap::{Parser, Subcommand, ValueEnum};
use galley_core_lib::api::{
    GoalEventType, GoalTaskStatus, GoalWriteMode, DEFAULT_GOAL_BUDGET_SECONDS,
    DEFAULT_GOAL_WORKER_LIMIT,
};

#[derive(Parser, Debug)]
#[command(
    name = "galley",
    version,
    about = "Agent-first interface to Galley (the local agent team orchestrator)."
)]
pub(crate) struct Cli {
    /// Pin the schema version the supervisor expects. v0.2 only knows
    /// `1`; mismatch exits 2 with `error: "schema_mismatch"`. Future
    /// binaries that speak multiple schema versions will accept all of
    /// them. Omit to let the binary use its default (currently `1`).
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

    /// Aggregate counts: total / running / waiting_input / errored.
    Status,

    /// Run local health probes. Python-dependent rows currently surface
    /// as the stable legacy value `deferred_b4`.
    Health,

    /// Print the CLI + schema version.
    Version,

    /// Project operations (create / list / brief / show / follow / delete). v0.2 has no
    /// reversible "archive" surface — `delete` is destructive (FK SET
    /// NULL detaches child sessions to ungrouped). A future v0.6+ ships
    /// `archive` separately with reversible semantics (sub-plan O2).
    #[command(subcommand)]
    Project(ProjectCmd),

    /// Headless autonomous Goal/Hive operations.
    #[command(subcommand)]
    Goal(GoalCmd),

    /// LLM configuration commands. `llm list` reads the cached
    /// `llm_list` pref that the GUI seeds after a bridge warmup —
    /// requires Galley GUI to have been opened at least once. `llm set`
    /// persists a per-session pick + best-effort tells any live runner.
    #[command(subcommand)]
    Llm(LlmCmd),
}

#[derive(Subcommand, Debug)]
pub(crate) enum ProjectCmd {
    /// Create a project.
    Create {
        /// Project name (will be trimmed; empty → exit 2).
        name: String,
        /// Optional filesystem root path. Historical — currently stored
        /// on the row but no longer injected at runner spawn (see
        /// 2026-05-14 devlog on the rootPath rollback).
        #[arg(long)]
        root_path: Option<String>,
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
    /// Permanently delete a project. Child sessions auto-detach to
    /// ungrouped (FK SET NULL); the sessions themselves survive.
    /// Response includes `detachedSessions` count + the list of
    /// affected session ids so a supervisor agent can log the side
    /// effect.
    ///
    /// v0.2: this is destructive. v0.6+ will ship a separate
    /// `archive` command with reversible semantics (sub-plan O2).
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
    /// List sessions, ordered pinned first then by recency.
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
    /// One-row summary for a session id.
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
    /// Send a user message into a session (B2 M4). Persists to the
    /// `messages` table with the supplied origin triple + dispatches
    /// to the live runner subprocess (if one is alive). Requires Galley
    /// Core to be running (exit 4 if the socket isn't reachable).
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
    },
    /// Copy an existing session into a new `galley_native` session.
    /// The source session is left untouched; only visible transcript rows
    /// and the Project association are copied. Use when a native session is
    /// occupied or when migrating managed history into the native runtime.
    CopyToNative {
        /// Source session id.
        id: String,
        /// Supervisor label. Sets origin via to `supervisor`; omit for via=`cli`.
        #[arg(long)]
        supervisor: Option<String>,
        /// Free-text reason for the action. Surfaces in audit views.
        #[arg(long)]
        reason: Option<String>,
    },
    /// Respond to a pending native tool approval. Currently supports
    /// hidden `galley_native` sessions; managed/external approvals are
    /// handled by the live GUI/runner IPC path.
    ApprovalResponse {
        /// Session id.
        id: String,
        /// Approval id from the pending approval event.
        approval_id: String,
        /// Decision: allow_once / deny / always_allow_project / always_allow_global.
        decision: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Stream live IPC events from a session's runner (B2 M4). NDJSON
    /// on stdout — one event per line. Exits cleanly when the
    /// subprocess terminates (`{"stream":"end",...}`) or the user
    /// sends SIGINT.
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
    /// Create a new session with a first user message (B4 M1). Atomic:
    /// session row + first message commit together or roll back together.
    /// Returns `{session, message, dispatch}` with `dispatch=dispatched`
    /// after Galley Core starts a runner and sends the first task. Runner
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
    /// Send a transient "by the way" side question into a running session
    /// (B4 M1). The runner detects the `/btw` prefix and bypasses its
    /// task queue — useful for asking the agent a quick question mid-run
    /// without disturbing the main thread. Not persisted to the messages
    /// table (v0.1 transient policy); requires an alive bridge (exit 5
    /// otherwise).
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
    /// Stop the current turn in a session (B4 M1). Sends `Abort` to the
    /// runner — the agent's loop exits and emits `run_complete` with the
    /// `ABORTED` marker, but the bridge process stays alive so a
    /// subsequent `session send` resumes without paying the respawn cost.
    /// Idempotent: stopping an already-idle session returns
    /// `{dispatch: "already_stopped"}` and exit 0.
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
    /// Move a session into / out of a project (B4 M1). `--to=<project-id>`
    /// attaches; omit `--to` to detach (move to ungrouped). The session is
    /// the subject of the move — projects don't shuffle, sessions migrate
    /// between them (sub-plan O3 noun-as-subject grammar).
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
    #[value(alias = "galley_native", hide = true)]
    GalleyNative,
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
