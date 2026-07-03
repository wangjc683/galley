//! SQLite-backed implementation of [`GalleyApi`].
//!
//! Connection pool is held inside [`SqliteGalley`] which is `Clone`able
//! (the inner `sqlx::SqlitePool` is `Arc`-shared). Tauri commands grab
//! a handle from app state and `await` reads concurrently. The pool
//! sits on `sqlx` 0.8 — the same version `tauri-plugin-sql` already
//! brings in via Cargo.lock, so the binding to `libsqlite3-sys 0.30.x`
//! is shared (one set of SQLite symbols in the binary, FTS5 + trigram
//! tokenizer available on the same flags the GUI's writes use).
//!
//! **Path resolution.** The DB file lives in the same directory where
//! `tauri-plugin-sql` resolves `sqlite:workbench.db`: Tauri's
//! app-config directory under the identifier `app.galley`. [`db_path`]
//! reproduces that lookup without an `AppHandle` so the Galley CLI
//! binary can find the same DB. **Identifier change == data move** — see
//! [desktop runtime](../../docs/desktop-runtime.md#tauri-identifier).

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{FromRow, Sqlite, SqliteConnection, SqlitePool, Transaction};

use crate::api::{
    ClaimGoalTaskInput, CreateGoalEventInput, CreateGoalProposalInput, CreateGoalTaskInput,
    CreateProjectInput, CreateSessionInput, GalleyApi, GoalBrief, GoalDeliverable, GoalEventBrief,
    GoalEventType, GoalId, GoalProposalBrief, GoalProposalId, GoalProposalStatus, GoalStatus,
    GoalStatusSnapshot, GoalTaskBrief, GoalTaskId, GoalTaskStatus, GoalWriteMode, HealthCheck,
    HealthReport, HealthStatus, ManagedModelAuthKind, ManagedModelCredentialStatus,
    ManagedModelProtocol, ManagedModelProviderRecord, ManagedModelRecord, MessageAttachmentBrief,
    MessageBrief, MessageId, MessageRole, MessageTelemetry, MessageVisibility, Origin, OriginVia,
    ProjectBrief, ProjectId, ProjectPatch, RuntimeKind, SearchHit, SearchScope, SessionBrief,
    SessionFilter, SessionId, SessionStatus, StatusSummary, UpdateGoalTaskInput,
    DEFAULT_GOAL_BUDGET_SECONDS, DEFAULT_GOAL_WORKER_LIMIT, GOAL_CONFIRMATION_PHRASE,
    MAX_GOAL_WORKER_LIMIT, MIN_GOAL_WORKER_LIMIT,
};
use crate::app_paths;
use crate::error::{GalleyError, Result};
use crate::managed_runtime;

/// Resolve the absolute path of Galley's SQLite database file. Works
/// both inside a Tauri process (no `AppHandle` needed) and inside the
/// CLI binary. Returns `None` if the platform's config directory
/// can't be determined (very rare — would mean `$HOME` / `%APPDATA%`
/// are both unset).
///
/// **Override.** `GALLEY_DB_PATH` env var, when set, takes precedence
/// — Galley uses that exact file path. Intended for CLI integration
/// tests (point at a fixture) and advanced agent SOPs that want to
/// read from a snapshot. The Tauri GUI process inherits the user's
/// env so setting it for an interactive session works too.
pub fn db_path() -> Option<PathBuf> {
    app_paths::db_path()
}

/// SQLite-backed Galley Core. Cheap to clone (pool internally is
/// `Arc<sqlx::PoolInner>`).
#[derive(Clone)]
pub struct SqliteGalley {
    pool: SqlitePool,
}

impl SqliteGalley {
    /// Handle to the process-wide shared pool against the resolved
    /// [`db_path`]. The pool is opened once per process and cloned on
    /// every later call — callers all over the codebase (socket
    /// handlers, IM supervisor, Codex OAuth) call this per request, and
    /// each used to build its own fresh 4-connection pool, multiplying
    /// WAL writer contention against the design of one shared pool.
    /// A failed open is not cached; the next call retries.
    ///
    /// Fails with `DbUnavailable` when the file is missing or
    /// unopenable — indicates the GUI has never run on this machine.
    /// CLI callers should surface a "Galley hasn't been initialized"
    /// message rather than auto-creating an empty schema (which would
    /// mask a configuration mistake).
    pub async fn open() -> Result<Self> {
        static SHARED: tokio::sync::OnceCell<SqliteGalley> = tokio::sync::OnceCell::const_new();
        SHARED
            .get_or_try_init(|| async { Self::open_uncached().await })
            .await
            .cloned()
    }

    async fn open_uncached() -> Result<Self> {
        let path = db_path().ok_or_else(|| GalleyError::DbUnavailable {
            message: "platform app config directory unavailable".into(),
        })?;
        let opts = SqliteConnectOptions::new()
            .filename(&path)
            // Do not auto-create: B1 reads against a DB the GUI owns
            // and populates. M3 read failure on a missing DB should
            // surface clearly instead of silently returning empty
            // rows from an auto-created blank schema.
            .create_if_missing(false)
            // WAL + relaxed fsync + busy retry. The Rust pool and the
            // GUI's `tauri-plugin-sql` connection are two independent
            // openers on the same `workbench.db`. Without these
            // pragmas the Rust pool runs SQLite defaults
            // (`journal_mode=DELETE`, `synchronous=FULL`,
            // `busy_timeout=0`): every transaction fsyncs, and a
            // concurrent writer/read from the other opener returns
            // `SQLITE_BUSY` instead of waiting.
            //
            // WAL is a file-level persistent property — once set here
            // it persists in the DB header, so the plugin's opener
            // also reads WAL on subsequent process starts.
            // `synchronous=Normal` is the documented safe pairing
            // with WAL (no fsync per commit, still crash-safe). These
            // two are connection-scoped, so only this pool benefits,
            // which is fine: the plugin only runs migrations.
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(opts)
            .await
            .map_err(|e| GalleyError::DbUnavailable {
                message: format!("opening {}: {e}", path.display()),
            })?;
        Ok(Self { pool })
    }

    /// Construct directly from an existing pool — used by tests against
    /// an in-memory DB and by future code paths that share a pool with
    /// `tauri-plugin-sql`.
    pub fn from_pool(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

mod api_impl;
mod goal;
mod helpers;
mod managed_model;
mod prefs;
mod project;
mod rows;
mod search;
mod session;
mod tool_event;

use helpers::*;
use rows::*;

pub use rows::{
    ManagedModelSecretRow, MessageAttachmentCreate, MessageSearchHit, PersistAssistantMessage,
    PersistToolEventPending, PersistedMessageRow, ToolEventRow, UpsertManagedModelMetadata,
    UpsertManagedModelProviderMetadata,
};
