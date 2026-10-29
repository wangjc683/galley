use clap::builder::NonEmptyStringValueParser;
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser, Debug)]
#[command(
    name = "galley",
    version,
    about = "Agent-first interface to Galley (the local agent team orchestrator)."
)]
pub(crate) struct Cli {
    /// Pin the schema version this caller expects. Current binaries speak
    /// `3` and still accept `1` and `2` for every command that survived
    /// unchanged. A mismatch exits 2 (`invalid_args`) with a message
    /// prefixed `schema_mismatch:`. Omit to use the binary's default
    /// (currently `3`).
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
    /// update / pin / unpin / archive-sessions / delete). `delete` is
    /// destructive: child sessions detach to ungrouped and survive.
    /// `archive-sessions` archives the conversations and keeps the
    /// project; there is no archive of the project itself.
    #[command(subcommand)]
    Project(ProjectCmd),

    /// LLM commands. `llm list` prints the model list of the current
    /// runtime (Galley model store for managed, the GUI's warmup cache for
    /// external GA). `llm set` persists a per-session pick and tells any
    /// live runner. `llm set-default` changes the managed default model.
    #[command(subcommand)]
    Llm(LlmCmd),

    /// Scheduled tasks: one-off or repeating, that start a session or wake
    /// the assistant (the main chat). `list` / `show` read SQLite
    /// directly; the writes go through Galley Core. `delete` cancels: the
    /// task stays readable with `cancelledAt`.
    #[command(subcommand)]
    Schedule(ScheduleCmd),

    /// The user's to-dos, Galley's notebook: things the user has to do,
    /// with a due date or without, a reminder optional. `list` / `show`
    /// read SQLite directly; the writes go through Galley Core and need
    /// the managed runtime with its main chat. `cancel` is a soft delete:
    /// the to-do stays readable with `cancelledAt`. `item` writes the items
    /// under a to-do (one level, words and a box).
    #[command(subcommand)]
    Todo(TodoCmd),

    /// Memos: what Galley knows about the user (who they are, what they
    /// prefer, the people and places they deal with, interests), one thing
    /// per memo, 1 to 100 characters, a last day optional. `list` reads
    /// SQLite directly; the writes go through Galley Core and need the
    /// managed runtime with its main chat. `delete` deletes.
    #[command(subcommand)]
    Memo(MemoCmd),
}

#[derive(Subcommand, Debug)]
pub(crate) enum MemoCmd {
    /// List the memos that hold today, NDJSON, in the order they were
    /// noted. One past its last day is not listed. Read-only — opens
    /// SQLite directly.
    List,
    /// Note a memo. When the memos then total more than 2000 characters
    /// it is kept, and the result carries `overLimit`.
    Add {
        /// The memo, 1 to 100 characters.
        text: String,
        /// Its last day, a local date `YYYY-MM-DD`, not before today
        /// (`time_in_past:`, exit 2). After that day it is in no list.
        #[arg(long, value_name = "DATE", value_parser = NonEmptyStringValueParser::new())]
        until: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Change a memo; only what is given changes.
    #[command(group(
        clap::ArgGroup::new("change")
            .required(true)
            .multiple(true)
            .args(["text", "until", "no_until"])
    ))]
    Update {
        /// Memo id (`memo_<16-hex>`).
        memo_id: String,
        /// The new text, 1 to 100 characters.
        #[arg(long)]
        text: Option<String>,
        /// The new last day (`add --until`'s form).
        #[arg(
            long,
            value_name = "DATE",
            conflicts_with = "no_until",
            value_parser = NonEmptyStringValueParser::new()
        )]
        until: Option<String>,
        /// No last day any more.
        #[arg(long)]
        no_until: bool,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Delete a memo. The record of its writes stays (the cards under the
    /// replies read it); the memo is gone from every read.
    Delete {
        memo_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum TodoCmd {
    /// List to-dos, NDJSON. Default: the ones not done, in the order the
    /// desktop's to-do list shows them (due today or overdue, then later,
    /// then no due date). Each with the count of its items (`itemCount`),
    /// not the items: `show` reads them. Read-only — opens SQLite directly.
    List {
        /// Also done ones (most recently ticked off first) and cancelled
        /// ones, after the open ones.
        #[arg(long)]
        all: bool,
    },
    /// One to-do, done or cancelled or not, with its items. Read-only —
    /// opens SQLite directly.
    Show {
        /// To-do id (`todo_<16-hex>`).
        todo_id: String,
    },
    /// Note a to-do.
    Add {
        /// What the user has to do.
        title: String,
        #[arg(long)]
        notes: Option<String>,
        /// When it is due: a local date `YYYY-MM-DD` (a day with no time),
        /// or a time as `schedule create --at` takes it (local
        /// `YYYY-MM-DDTHH:MM`, or RFC 3339). A past date is fine.
        #[arg(long, value_name = "DATE|TIME", value_parser = NonEmptyStringValueParser::new())]
        due: Option<String>,
        /// Hang a reminder on it at this time (`schedule create --at`'s
        /// forms): it wakes Galley. A time already past is refused
        /// (`time_in_past:`, exit 2).
        #[arg(long, value_name = "TIME", value_parser = NonEmptyStringValueParser::new())]
        remind_at: Option<String>,
        /// An item under it: words and a box, no time. Repeat for more, in
        /// order.
        #[arg(long = "item", value_name = "TEXT")]
        items: Vec<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Change a to-do; only what is given changes. An empty `--notes=`
    /// clears the notes.
    #[command(group(
        clap::ArgGroup::new("change")
            .required(true)
            .multiple(true)
            .args(["title", "notes", "due", "no_due", "remind_at", "no_remind"])
    ))]
    Update {
        todo_id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        notes: Option<String>,
        /// The new due date (`add --due`'s forms).
        #[arg(
            long,
            value_name = "DATE|TIME",
            conflicts_with = "no_due",
            value_parser = NonEmptyStringValueParser::new()
        )]
        due: Option<String>,
        /// No due date any more.
        #[arg(long)]
        no_due: bool,
        /// Set the reminder, or move it (one that went off is armed
        /// again). Refused on a done to-do: reopen it first.
        #[arg(
            long,
            value_name = "TIME",
            conflicts_with = "no_remind",
            value_parser = NonEmptyStringValueParser::new()
        )]
        remind_at: Option<String>,
        /// Remove the reminder (its scheduled task is cancelled).
        #[arg(long)]
        no_remind: bool,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Tick a to-do off. Its reminder is cancelled if it has not reminded
    /// the user yet. Ticking off a done one changes nothing.
    Done {
        todo_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Untick a to-do. A reminder cancelled when it was ticked off stays
    /// cancelled (`update --remind-at` sets a new one).
    Reopen {
        todo_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Cancel a to-do (a soft delete), and its reminder with it: it leaves
    /// the lists; `show` and `list --all` still read it.
    Cancel {
        todo_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// The items under a to-do: one level, each only its words and a box,
    /// no due date and no reminder. Ticking the last one does not tick the
    /// to-do off. Every write prints the to-do with its items.
    #[command(subcommand)]
    Item(TodoSubitemCmd),
}

#[derive(Subcommand, Debug)]
pub(crate) enum TodoSubitemCmd {
    /// Add items under a to-do, after the ones there, in this order.
    Add {
        /// To-do id (`todo_<16-hex>`).
        todo_id: String,
        /// The item's words; give several for several items.
        #[arg(required = true, value_name = "TEXT")]
        texts: Vec<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Tick an item. The to-do stays as it is. Ticking a ticked one
    /// changes nothing.
    Done {
        /// Item id (`item_<16-hex>`).
        item_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Untick an item.
    Reopen {
        item_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Change an item's words.
    Update {
        item_id: String,
        /// The new words.
        #[arg(long, value_parser = NonEmptyStringValueParser::new())]
        text: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Delete an item for good.
    Remove {
        item_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum ScheduleCmd {
    /// List scheduled tasks, NDJSON, enabled first then most recently
    /// updated. Default: the ones that may still fire (enabled, not
    /// cancelled, not a one-off that already fired). Read-only — opens
    /// SQLite directly.
    List {
        /// Also fired one-offs, disabled and cancelled tasks.
        #[arg(long)]
        all: bool,
    },
    /// One task, cancelled or not. Read-only — opens SQLite directly.
    Show {
        /// Task id (`sched_<16-hex>`).
        task_id: String,
    },
    /// Create a task. Give exactly one of `--at` (a one-off) and
    /// `--daily` / `--weekly` / `--monthly` (with `--time`).
    #[command(group(
        clap::ArgGroup::new("when")
            .required(true)
            .args(["at", "daily", "weekly", "monthly"])
    ))]
    Create {
        /// What to do: for `--target=assistant` the words the assistant
        /// gets when it comes due; for `--target=session` the new
        /// session's first message.
        prompt: String,
        /// A one-off, at this time: RFC 3339 (`2026-10-20T20:00:00+08:00`)
        /// or local `YYYY-MM-DDTHH:MM`, read in this machine's time zone.
        /// A time already past is refused (`time_in_past:`, exit 2).
        #[arg(long, value_name = "TIME")]
        at: Option<String>,
        #[command(flatten)]
        rule: RepeatArgs,
        /// What a fire does. `assistant` needs the managed runtime with
        /// its main chat (`assistant_unavailable:`, exit 2).
        #[arg(long, value_enum, default_value = "session")]
        target: ScheduleTargetArg,
        /// Project for the sessions it starts (target session only).
        #[arg(long)]
        project: Option<String>,
        /// Model display name for the sessions it starts (target session
        /// only).
        #[arg(long)]
        llm: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Change a task; only the fields given change. `--at` makes it a
    /// one-off (a later time arms a fired one again); `--daily` /
    /// `--weekly` / `--monthly` make it repeating. An empty `--project=`
    /// or `--llm=` clears it.
    Update {
        task_id: String,
        /// The new words / first message.
        #[arg(long)]
        prompt: Option<String>,
        #[arg(long, value_name = "TIME")]
        at: Option<String>,
        #[command(flatten)]
        rule: RepeatArgs,
        #[arg(long, value_enum)]
        target: Option<ScheduleTargetArg>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        llm: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Cancel a task (a soft delete): it never fires again and leaves
    /// the default list; `show` and `list --all` still read it.
    Delete {
        task_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Turn a task back on.
    Enable {
        task_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Pause a task.
    Disable {
        task_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Fire a task once, now, through the scheduled path (the desktop's
    /// "run now"): a session task starts its session; an assistant task
    /// wakes the main chat. Planned fires are not consumed.
    Run {
        task_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

/// A repeating rule's flags, shared by `schedule create` and `update`.
#[derive(clap::Args, Debug)]
pub(crate) struct RepeatArgs {
    /// Every day, at `--time`.
    #[arg(long, conflicts_with_all = ["at", "weekly", "monthly"])]
    pub(crate) daily: bool,
    /// On these ISO weekdays (Mon=1 … Sun=7, comma-separated), at
    /// `--time`.
    #[arg(long, value_name = "DAYS", conflicts_with_all = ["at", "monthly"])]
    pub(crate) weekly: Option<String>,
    /// On these days of the month (1-31, comma-separated; short months
    /// fire on their last day), at `--time`.
    #[arg(long, value_name = "DAYS", conflicts_with = "at")]
    pub(crate) monthly: Option<String>,
    /// Local wall-clock time `HH:MM` for a repeating rule.
    #[arg(long, value_name = "HH:MM", conflicts_with = "at")]
    pub(crate) time: Option<String>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ScheduleTargetArg {
    /// Wake the assistant (the main chat) with the words.
    Assistant,
    /// Start a new session that runs the prompt.
    Session,
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
    /// Rename a project or change its icon / colour; only the flags given
    /// change. An empty `--name=` is refused (exit 2); an empty `--icon=`
    /// or `--color=` clears it.
    Update {
        /// Project id.
        project_id: String,
        /// New name (trimmed).
        #[arg(long)]
        name: Option<String>,
        /// Icon metadata (the desktop draws a folder whatever it holds).
        #[arg(long)]
        icon: Option<String>,
        /// Accent colour, hex (e.g. `#7c84ff`).
        #[arg(long)]
        color: Option<String>,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Pin a project: the desktop lists it first, always in sight.
    Pin {
        /// Project id.
        project_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Unpin a project.
    Unpin {
        /// Project id.
        project_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Archive the project's conversations — the desktop's 「归档全部对话」:
    /// the sessions its sidebar group lists (the active runtime's, not
    /// archived, not pinned, not the main chat, not a subtask the user has
    /// not written in). The project stays; `session restore` brings a
    /// session back. Returns `archivedSessions` and their ids.
    ArchiveSessions {
        /// Project id.
        project_id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub(crate) enum LlmCmd {
    /// List the LLMs a runtime can pick by name (`llm set` accepts every
    /// printed `name`).
    ///
    /// Read-only — opens SQLite directly. NDJSON rows
    /// `{index, name, key, displayName, isCurrent}`. `managed` reads the
    /// Galley model store (Settings > Models) with the same rules
    /// `llm set` resolves against: models without a credential are
    /// skipped, `index` counts usable models from 0, `key` is the model
    /// id, and `isCurrent` marks index 0 — the model a session or IM
    /// channel started without a model pick uses (not a per-session
    /// choice; see `sessions list` `selectedLlmDisplayName`). `external`
    /// prints the model list the GUI cached after an external-GA bridge
    /// warmup, where `isCurrent` is that bridge's pick; empty output when
    /// the cache is unwarmed (open an external session once to populate).
    List {
        /// Runtime whose model list to print. Default follows the GUI's
        /// current runtime. `all` is refused (exit 2): each runtime has
        /// its own model list.
        #[arg(long, value_enum, default_value = "current")]
        runtime: RuntimeArg,
    },
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
    /// Make a model the default — Settings > Models 「设为默认（移到顶部）」:
    /// the model sessions and IM channels start on without a model pick,
    /// index 0 of `llm list --runtime=managed` afterwards. Any name that
    /// list prints (case-insensitive; the provider model id works too).
    /// Managed runtime only: under an attached GenericAgent it exits 2
    /// (`managed_runtime_only:`).
    SetDefault {
        /// Model name as `galley llm list --runtime=managed` prints it.
        llm_name: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
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
    /// FTS5 trigram search across persisted message bodies. Each hit
    /// carries `sessionId`, `messageId`, `createdAt`, `role` and
    /// `turnIndex`; read one in context with `session show <sessionId>
    /// --around=<messageId>`.
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
        /// Only hits from this session. Applies on top of `--runtime`
        /// and `--all`: pass `--runtime all --all` to be sure an archived
        /// or other-runtime session is searched.
        #[arg(long)]
        session: Option<String>,
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
    /// Conversation messages for a session, oldest first. Without a
    /// window flag: the full transcript (or its last `--tail` messages).
    Show {
        /// Session id.
        id: String,
        /// Return only the last N messages instead of the full
        /// transcript. Useful for agents catching up. With `--since` /
        /// `--until`: the last N messages of that window.
        #[arg(long)]
        tail: Option<usize>,
        /// Read around one message (e.g. a `sessions search` hit): the
        /// message plus `--context` messages before and after it. Exit 3
        /// when the session has no such visible message.
        #[arg(long, value_name = "MESSAGE_ID", conflicts_with_all = ["tail", "since", "until"])]
        around: Option<String>,
        /// Messages on each side of `--around` (default 10).
        #[arg(long, value_name = "N", requires = "around")]
        context: Option<usize>,
        /// Messages written at or after this time. `YYYY-MM-DD` = from
        /// the start of that local day; `YYYY-MM-DDTHH:MM[:SS]` = local
        /// time; RFC 3339 with `Z` / `±HH:MM` = that instant.
        #[arg(long, value_name = "TIME")]
        since: Option<String>,
        /// Messages written before this time (exclusive). Same forms as
        /// `--since`; a bare `YYYY-MM-DD` includes that whole local day.
        #[arg(long, value_name = "TIME")]
        until: Option<String>,
    },
    /// Send a user message into a session. Persists the message with the
    /// supplied origin and dispatches it to the live runner; a mid-run
    /// send is held in Galley Core's queue (`dispatch: "queued"`) and
    /// runs when the current task finishes. While the agent waits on an
    /// `ask_user` question (`live.askPending`), a send is the answer and
    /// dispatches at once, ahead of queued messages. Requires Galley
    /// Core (exit 4 if the socket isn't reachable).
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
        /// Start the session's runner when it has none (its history
        /// restored first), so the message runs (`dispatch:
        /// "dispatched"`) instead of only being saved (`dispatch:
        /// "persisted_only"`). No effect when a runner is alive or the
        /// message is queued.
        #[arg(long)]
        ensure_runner: bool,
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
    /// appears (with `--until-idle`, and the run has ended) or the
    /// bounded wait times out. Intended for Supervisor / IM flows where
    /// a local tool timeout must not be treated as task failure.
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
        /// Complete only when the run has also ended. Without this flag
        /// any agent message with content (past `--after-turn`) completes
        /// the wait, and every intermediate step has content, so a long
        /// run returns on a progress step. With it, completion also needs
        /// Galley Core to report no run open or in progress
        /// (`live.openRun` and `live.agentRunning` both false). A pending
        /// ask_user question counts as ended: read `live.askPending` from
        /// the final frame's `session` and the question from the asking
        /// row's `askUser`. Queued messages keep the run open, so the wait
        /// lasts until they have all run. A run seen ended is confirmed by
        /// a second read 1s later (so the last row can land) before the
        /// wait completes from that read. On a poll where Core is
        /// unreachable, the output condition alone decides, with no pause.
        #[arg(long)]
        until_idle: bool,
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
        /// Optional LLM display name (case-insensitive), as printed by
        /// `galley llm list --runtime=<the new session's runtime>`: managed
        /// resolves against the Galley model store, external against the
        /// GUI's warmup cache. An unknown name (or an empty external cache)
        /// exits 2 (invalid args).
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
    /// Rename a session, as the desktop does: the title stays, the auto
    /// title no longer replaces it. An empty title gives it back to
    /// Galley. The main chat cannot be renamed (`main_chat_protected:`,
    /// exit 2).
    Rename {
        /// Session id.
        id: String,
        /// New title (trimmed).
        title: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Pin a session to the top of the desktop's list. An archived
    /// session cannot be pinned (exit 2), nor the main chat
    /// (`main_chat_protected:`).
    Pin {
        /// Session id.
        id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Unpin a session.
    Unpin {
        /// Session id.
        id: String,
        #[arg(long)]
        supervisor: Option<String>,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Permanently delete a session: its messages and attachments go too,
    /// and nothing brings it back (`session archive` is the reversible
    /// one). A live runner is shut down first. The main chat cannot be
    /// deleted (`main_chat_protected:`, exit 2).
    Delete {
        /// Session id.
        id: String,
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
