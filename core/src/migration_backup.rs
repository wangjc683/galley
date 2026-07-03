//! Pre-migration backup of the Galley data directory (B4 M8).
//!
//! When the on-disk SQLite schema version is older than the highest
//! version Galley Core knows about, the Rust-side `tauri-plugin-sql`
//! preload will run pending migrations. Per
//! [B4-I6](../../docs/refactor/B4-cli-bg-artifact.md), Galley must
//! snapshot the entire data directory **before** that happens so a
//! botched migration is recoverable.
//!
//! Trigger policy (B4 M8 sub-plan §1.2 strategy A):
//! - Fresh install (data dir / DB file missing) → [`BackupOutcome::FreshInstall`].
//! - On-disk version == latest known → [`BackupOutcome::UpToDate`].
//! - On-disk version > latest known → [`BackupOutcome::NotApplicable`]
//!   (user downgraded; log + let the plugin no-op).
//! - On-disk version < latest known → copy data dir to
//!   `app.galley.backup.<utc-timestamp>/` sibling, then return
//!   [`BackupOutcome::Backed`].
//!
//! Backup failures are surfaced as [`BackupError`]. The Tauri setup
//! hook in [`crate::run`](crate) turns those into a blocking error
//! dialog + `std::process::exit(2)` — Galley refuses to open the DB
//! when its safety net broke.
//!
//! Schema version is **derived from the migrations vec** in
//! `crate::run`, not hard-coded here. That keeps the "bump the
//! migration list" workflow as a single edit site.

use std::borrow::Cow;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Instant;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{
    migrate::{Migration as SqlxMigration, MigrationType},
    ConnectOptions, Connection, Executor, Row,
};

use crate::app_paths::{self, DB_FILENAME};

/// Sibling directory name prefix (e.g. `app.galley.backup.20260520T140530Z/`
/// next to `app.galley/`).
const BACKUP_DIR_PREFIX: &str = "app.galley.backup.";
/// Newest migration backups kept after a successful new backup. Each is
/// a full data-dir copy (attachments included); unbounded retention
/// grows by the whole data dir on every schema bump.
const BACKUP_RETENTION_COUNT: usize = 3;
/// Marker in the data dir recording that the one-shot v0.2.9 cascade
/// recovery pass has completed; its presence skips backup scanning at
/// startup.
const RECOVERY_SENTINEL_FILENAME: &str = "backup-recovery.done";
const SAFE_REBUILD_PREFLIGHT_MAX_VERSION: i64 = 23;

#[derive(Debug, Clone, Copy)]
struct MigrationSpec {
    version: i64,
    description: &'static str,
    sql: &'static str,
}

const SAFE_PREFLIGHT_MIGRATIONS: &[MigrationSpec] = &[
    MigrationSpec {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/001_init.sql"),
    },
    MigrationSpec {
        version: 2,
        description: "add sessions.has_unread",
        sql: include_str!("../migrations/002_add_has_unread.sql"),
    },
    MigrationSpec {
        version: 3,
        description: "add messages.summary",
        sql: include_str!("../migrations/003_add_message_summary.sql"),
    },
    MigrationSpec {
        version: 4,
        description: "add messages_fts (full-text search)",
        sql: include_str!("../migrations/004_add_messages_fts.sql"),
    },
    MigrationSpec {
        version: 5,
        description: "add messages.preamble",
        sql: include_str!("../migrations/005_add_message_preamble.sql"),
    },
    MigrationSpec {
        version: 6,
        description: "add messages origin (created_via, supervisor, origin_note)",
        sql: include_str!("../migrations/006_messages_origin.sql"),
    },
    MigrationSpec {
        version: 7,
        description:
            "add sessions origin (created_via, created_by_supervisor, created_origin_note)",
        sql: include_str!("../migrations/007_sessions_origin.sql"),
    },
    MigrationSpec {
        version: 8,
        description: "add managed/external runtime identity",
        sql: include_str!("../migrations/008_runtime_identity.sql"),
    },
    MigrationSpec {
        version: 9,
        description: "add managed model metadata",
        sql: include_str!("../migrations/009_managed_models.sql"),
    },
    MigrationSpec {
        version: 10,
        description: "split managed model providers from models",
        sql: include_str!("../migrations/010_managed_model_providers.sql"),
    },
    MigrationSpec {
        version: 11,
        description: "add managed model display order",
        sql: include_str!("../migrations/011_managed_model_sort_order.sql"),
    },
    MigrationSpec {
        version: 12,
        description: "add managed model local encrypted secrets",
        sql: include_str!("../migrations/012_managed_model_local_secrets.sql"),
    },
    MigrationSpec {
        version: 13,
        description: "add stable per-session LLM identity",
        sql: include_str!("../migrations/013_session_llm_key.sql"),
    },
    MigrationSpec {
        version: 14,
        description: "add managed model provider auth kind",
        sql: include_str!("../migrations/014_managed_model_auth_kind.sql"),
    },
    MigrationSpec {
        version: 15,
        description: "add Galley Goal V1 state",
        sql: include_str!("../migrations/015_goal_v1.sql"),
    },
    MigrationSpec {
        version: 16,
        description: "add Goal master session delivery state",
        sql: include_str!("../migrations/016_goal_master_session.sql"),
    },
    MigrationSpec {
        version: 17,
        description: "add message visibility",
        sql: include_str!("../migrations/017_message_visibility.sql"),
    },
    MigrationSpec {
        version: 18,
        description: "add Goal deliverable anchor",
        sql: include_str!("../migrations/018_goal_deliverable.sql"),
    },
    MigrationSpec {
        version: 19,
        description: "add Goal file workspace path",
        sql: include_str!("../migrations/019_goal_workspace.sql"),
    },
    MigrationSpec {
        version: 20,
        description: "add message attachments",
        sql: include_str!("../migrations/020_message_attachments.sql"),
    },
    MigrationSpec {
        version: 21,
        description: "allow Galley Native session runtime",
        sql: include_str!("../migrations/021_native_session_runtime.sql"),
    },
    MigrationSpec {
        version: 22,
        description: "add Galley Native memory substrate",
        sql: include_str!("../migrations/022_native_memory_substrate.sql"),
    },
    MigrationSpec {
        version: 23,
        description: "allow Galley Native Goal runtime",
        sql: include_str!("../migrations/023_native_goal_runtime.sql"),
    },
];

/// Outcome of [`ensure_backup_before_migrate`].
#[derive(Debug, Clone)]
pub enum BackupOutcome {
    /// Data directory / DB file does not exist. Nothing to back up;
    /// `tauri-plugin-sql` will create a fresh schema.
    FreshInstall,
    /// On-disk migration version equals the latest Galley Core ships.
    /// No migration will run, no backup needed.
    UpToDate { version: i64 },
    /// On-disk version is **higher** than the latest Galley knows about.
    /// User likely ran a newer Galley and downgraded — neither migration
    /// nor backup makes sense. The plugin will no-op.
    NotApplicable { on_disk: i64, code_max: i64 },
    /// Migration pending and backup completed successfully.
    /// `skipped_symlinks` > 0 means the data dir contained symlinks or
    /// special files the copy deliberately left behind (logged per
    /// path) — the backup is otherwise complete.
    Backed {
        from: i64,
        to: i64,
        backup_path: PathBuf,
        skipped_symlinks: u64,
    },
}

/// Errors during the backup probe / copy.
#[derive(Debug)]
pub enum BackupError {
    /// The platform app config directory could not be resolved.
    /// Extremely unusual; Galley can't proceed safely.
    DataDirUnavailable,
    /// `sqlx` open / probe query failed against the existing DB file.
    /// Likely a corrupted DB; user should restore from a Time Machine
    /// snapshot or contact support.
    DbProbe { message: String },
    /// `fs::copy_dir_all` failed midway (disk full, permission, etc.).
    /// Partial backup directory is left in place for the user to
    /// inspect / clean up.
    CopyFailed {
        src: PathBuf,
        dst: PathBuf,
        message: String,
    },
}

/// Outcome of the pre-plugin safe migration guard.
#[derive(Debug, Clone)]
pub enum SafeMigrationOutcome {
    /// No DB file exists yet.
    FreshInstall,
    /// The codebase does not include the hazardous rebuild migrations.
    NotApplicable { latest_version: i64 },
    /// The DB has already crossed the guarded migration boundary.
    UpToDate { version: i64 },
    /// We applied pending migrations through
    /// [`SAFE_REBUILD_PREFLIGHT_MAX_VERSION`] outside SQLx's DDL
    /// transaction so parent-table rebuilds cannot cascade-delete child rows.
    Applied { from: i64, to: i64 },
}

#[derive(Debug)]
pub enum SafeMigrationError {
    DataDirUnavailable,
    DbProbe { message: String },
    Apply { version: i64, message: String },
}

impl std::fmt::Display for SafeMigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SafeMigrationError::DataDirUnavailable => write!(
                f,
                "data_dir_unavailable: cannot resolve app config directory"
            ),
            SafeMigrationError::DbProbe { message } => write!(f, "db_probe: {message}"),
            SafeMigrationError::Apply { version, message } => {
                write!(f, "safe_migration_{version}: {message}")
            }
        }
    }
}

impl std::error::Error for SafeMigrationError {}

/// Outcome of the best-effort repair for v0.2.9 databases whose child rows were
/// removed by the transactional 021/023 table rebuilds.
#[derive(Debug, Clone)]
pub enum CascadedRowRecoveryOutcome {
    FreshInstall,
    NoBackups,
    NoRowsToRecover,
    /// A previous startup already completed the recovery pass (sentinel
    /// file present). Backups are not scanned or attached again — the
    /// v0.2.9 repair is one-shot, not a startup routine.
    AlreadyCompleted,
    Recovered {
        backup_path: PathBuf,
        messages: u64,
        tool_events: u64,
        message_attachments: u64,
        goal_rows: u64,
    },
}

#[derive(Debug)]
pub enum CascadedRowRecoveryError {
    DataDirUnavailable,
    DbOpen { message: String },
}

impl std::fmt::Display for CascadedRowRecoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CascadedRowRecoveryError::DataDirUnavailable => write!(
                f,
                "data_dir_unavailable: cannot resolve app config directory"
            ),
            CascadedRowRecoveryError::DbOpen { message } => write!(f, "db_open: {message}"),
        }
    }
}

impl std::error::Error for CascadedRowRecoveryError {}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupError::DataDirUnavailable => {
                write!(
                    f,
                    "data_dir_unavailable: cannot resolve app config directory"
                )
            }
            BackupError::DbProbe { message } => write!(f, "db_probe: {message}"),
            BackupError::CopyFailed { src, dst, message } => write!(
                f,
                "copy_failed: copying {} → {}: {message}",
                src.display(),
                dst.display()
            ),
        }
    }
}

impl std::error::Error for BackupError {}

/// Resolve the directory where `tauri-plugin-sql` opens `workbench.db`.
///
/// Historical note: this function kept the "data dir" name from B4 M8,
/// but the correct source of truth is Tauri's app-config dir because
/// that is what `tauri-plugin-sql` uses for `sqlite:workbench.db`.
/// `None` only when the platform's home/config directory is
/// unresolvable (extremely rare; see B4-M8 sub-plan §R1).
///
/// Public so the failure dialog can show the path to the user even when
/// resolution succeeded but later steps failed.
pub fn resolve_data_dir() -> Option<PathBuf> {
    app_paths::app_config_dir()
}

/// Production entry point — resolves the data dir and delegates to
/// [`ensure_backup_before_migrate_in`]. Called from the Tauri setup
/// hook in [`crate::run`].
pub fn ensure_backup_before_migrate(latest_version: i64) -> Result<BackupOutcome, BackupError> {
    let data_dir = resolve_data_dir().ok_or(BackupError::DataDirUnavailable)?;
    ensure_backup_before_migrate_in(&data_dir, latest_version)
}

/// SQLx runs SQLite migrations inside a DDL transaction, and
/// `tauri-plugin-sql` does not expose the `no_tx` escape hatch. That makes
/// parent-table rebuild migrations dangerous: SQLite ignores
/// `PRAGMA foreign_keys = OFF` inside an active transaction, so
/// `DROP TABLE sessions` can cascade-delete `messages`.
///
/// This guard runs before the SQL plugin. If the user's DB has not crossed the
/// known parent-table rebuild boundary (021 / 023), we apply pending migrations
/// through 023 on a connection with FK enforcement disabled and record the same
/// checksums SQLx expects. The plugin then validates/skips those rows and
/// continues with later migrations normally.
pub fn ensure_safe_rebuild_migrations_before_plugin(
    latest_version: i64,
) -> Result<SafeMigrationOutcome, SafeMigrationError> {
    let data_dir = resolve_data_dir().ok_or(SafeMigrationError::DataDirUnavailable)?;
    ensure_safe_rebuild_migrations_in(&data_dir, latest_version)
}

pub fn ensure_safe_rebuild_migrations_in(
    data_dir: &Path,
    latest_version: i64,
) -> Result<SafeMigrationOutcome, SafeMigrationError> {
    if latest_version < SAFE_REBUILD_PREFLIGHT_MAX_VERSION {
        return Ok(SafeMigrationOutcome::NotApplicable { latest_version });
    }
    let db_path = data_dir.join(DB_FILENAME);
    if !db_path.exists() {
        return Ok(SafeMigrationOutcome::FreshInstall);
    }

    let on_disk = probe_on_disk_version(&db_path).map_err(|e| SafeMigrationError::DbProbe {
        message: e.to_string(),
    })?;
    if on_disk >= SAFE_REBUILD_PREFLIGHT_MAX_VERSION {
        return Ok(SafeMigrationOutcome::UpToDate { version: on_disk });
    }

    tauri::async_runtime::block_on(async {
        let mut conn = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(false)
            .foreign_keys(false)
            .connect()
            .await
            .map_err(|e| SafeMigrationError::DbProbe {
                message: format!("opening {}: {e}", db_path.display()),
            })?;

        ensure_sqlx_migrations_table(&mut conn)
            .await
            .map_err(|e| SafeMigrationError::DbProbe {
                message: format!("ensuring _sqlx_migrations: {e}"),
            })?;

        for spec in SAFE_PREFLIGHT_MIGRATIONS
            .iter()
            .filter(|spec| spec.version > on_disk)
        {
            apply_preflight_migration(&mut conn, spec).await?;
        }

        Ok(SafeMigrationOutcome::Applied {
            from: on_disk,
            to: SAFE_REBUILD_PREFLIGHT_MAX_VERSION,
        })
    })
}

/// Best-effort recovery for users who already launched the bad 0.2.9 migration.
/// It restores only child rows whose parent session/goal still exists in the
/// active DB, so it does not resurrect conversations the user deleted after the
/// upgrade.
pub fn recover_cascaded_rows_from_backups(
) -> Result<CascadedRowRecoveryOutcome, CascadedRowRecoveryError> {
    let data_dir = resolve_data_dir().ok_or(CascadedRowRecoveryError::DataDirUnavailable)?;
    recover_cascaded_rows_from_backups_in(&data_dir)
}

pub fn recover_cascaded_rows_from_backups_in(
    data_dir: &Path,
) -> Result<CascadedRowRecoveryOutcome, CascadedRowRecoveryError> {
    let db_path = data_dir.join(DB_FILENAME);
    if !db_path.exists() {
        return Ok(CascadedRowRecoveryOutcome::FreshInstall);
    }
    // One-shot gate: this repair targets the v0.2.9 incident. Without
    // the sentinel, every startup re-scanned and read-write ATTACHed
    // every backup DB (checkpointing their WALs — mutating the backups
    // it exists to preserve).
    let sentinel = data_dir.join(RECOVERY_SENTINEL_FILENAME);
    if sentinel.exists() {
        return Ok(CascadedRowRecoveryOutcome::AlreadyCompleted);
    }
    let outcome = recover_cascaded_rows_pass(data_dir, &db_path)?;
    // Any completed pass (recovered, nothing to recover, or no backups
    // at all) settles the incident; only errors leave the gate open for
    // a retry on the next startup.
    if let Err(e) = fs::write(&sentinel, format!("{outcome:?}\n{}\n", timestamp_now())) {
        eprintln!(
            "[backup-recovery] writing sentinel {} failed: {e}",
            sentinel.display()
        );
    }
    Ok(outcome)
}

fn recover_cascaded_rows_pass(
    data_dir: &Path,
    db_path: &Path,
) -> Result<CascadedRowRecoveryOutcome, CascadedRowRecoveryError> {
    let mut backups = backup_db_candidates(data_dir)?;
    if backups.is_empty() {
        return Ok(CascadedRowRecoveryOutcome::NoBackups);
    }

    tauri::async_runtime::block_on(async {
        let mut conn = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(false)
            .connect()
            .await
            .map_err(|e| CascadedRowRecoveryError::DbOpen {
                message: format!("opening {}: {e}", db_path.display()),
            })?;

        for backup in backups.drain(..) {
            match recover_from_one_backup(&mut conn, &backup).await {
                Ok(Some(outcome)) => return Ok(outcome),
                Ok(None) => {}
                Err(e) => {
                    eprintln!("[backup-recovery] skipping {}: {e}", backup.display());
                }
            }
        }
        Ok(CascadedRowRecoveryOutcome::NoRowsToRecover)
    })
}

/// Test-injectable version. Operates on an arbitrary `data_dir` so
/// integration tests don't need to mutate `~/Library/...`.
pub fn ensure_backup_before_migrate_in(
    data_dir: &Path,
    latest_version: i64,
) -> Result<BackupOutcome, BackupError> {
    // 1. Data dir doesn't exist → fresh install.
    if !data_dir.exists() {
        return Ok(BackupOutcome::FreshInstall);
    }

    // 2. DB file doesn't exist → also fresh install (data dir is
    //    empty or holds non-DB Galley state we don't track).
    let db_path = data_dir.join(DB_FILENAME);
    if !db_path.exists() {
        return Ok(BackupOutcome::FreshInstall);
    }

    // 3. Probe the DB for the highest applied migration. Read-only +
    //    create_if_missing(false) — never touch user data here.
    let on_disk = probe_on_disk_version(&db_path)?;

    // 4. Decide.
    if on_disk == latest_version {
        return Ok(BackupOutcome::UpToDate { version: on_disk });
    }
    if on_disk > latest_version {
        return Ok(BackupOutcome::NotApplicable {
            on_disk,
            code_max: latest_version,
        });
    }

    // 5. on_disk < latest_version → migration pending → backup.
    let parent = data_dir.parent().ok_or(BackupError::DataDirUnavailable)?;
    let backup_path = parent.join(format!("{BACKUP_DIR_PREFIX}{}", timestamp_now()));
    let skipped_symlinks =
        copy_dir_all(data_dir, &backup_path).map_err(|err| BackupError::CopyFailed {
            src: data_dir.to_path_buf(),
            dst: backup_path.clone(),
            message: err.to_string(),
        })?;
    // Only after the new backup fully succeeded: the newest copies are
    // the safety net for the migration about to run, older ones are
    // history we cap.
    prune_old_backups(parent, BACKUP_RETENTION_COUNT);

    Ok(BackupOutcome::Backed {
        from: on_disk,
        to: latest_version,
        backup_path,
        skipped_symlinks,
    })
}

/// Keep only the newest `keep` migration backups. Timestamped dir names
/// sort lexicographically = chronologically. Best-effort: a failed
/// removal is logged and skipped — pruning never blocks startup.
fn prune_old_backups(parent: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let mut backups: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(BACKUP_DIR_PREFIX)
        })
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    if backups.len() <= keep {
        return;
    }
    backups.sort();
    for path in backups.iter().take(backups.len() - keep) {
        match fs::remove_dir_all(path) {
            Ok(()) => eprintln!("[backup] pruned old backup {}", path.display()),
            Err(e) => eprintln!("[backup] pruning {} failed: {e}", path.display()),
        }
    }
}

/// Probe `_sqlx_migrations` for the highest successfully-applied
/// version. Returns 0 when the table doesn't exist (e.g. extremely
/// old Galley pre-init state, or an empty DB) so the caller treats
/// it as "everything pending".
fn probe_on_disk_version(db_path: &Path) -> Result<i64, BackupError> {
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .read_only(true)
        .create_if_missing(false);

    // We're called from a sync setup-hook closure. Use the Tauri
    // async-runtime's block_on (same pattern as socket_listener
    // start in lib.rs).
    tauri::async_runtime::block_on(async move {
        let mut conn = opts.connect().await.map_err(|e| BackupError::DbProbe {
            message: format!("opening {}: {e}", db_path.display()),
        })?;

        // `_sqlx_migrations` is the table `sqlx` (and therefore
        // `tauri-plugin-sql`) writes per its standard migrator. If
        // the user is on a DB that pre-dates Galley's own
        // migrations (shouldn't happen since 001_init.sql creates
        // the schema), the table is missing — we treat that as
        // version 0 to fall through to the backup branch.
        let row = sqlx::query("SELECT MAX(version) AS v FROM _sqlx_migrations WHERE success = 1")
            .fetch_optional(&mut conn)
            .await;
        let version = match row {
            Ok(Some(r)) => r.try_get::<Option<i64>, _>("v").ok().flatten().unwrap_or(0),
            Ok(None) => 0,
            Err(e) => {
                let s = e.to_string();
                // sqlx returns "no such table: _sqlx_migrations" when
                // the migration table simply hasn't been created
                // yet. Treat as version 0.
                if s.contains("no such table") {
                    0
                } else {
                    return Err(BackupError::DbProbe { message: s });
                }
            }
        };

        Ok(version)
    })
}

async fn ensure_sqlx_migrations_table(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// One transaction per migration: the SQL and its `_sqlx_migrations`
/// version row commit together. Without this, a crash between the table
/// rebuild and the version insert leaves the rebuild applied but
/// unrecorded — every subsequent launch re-runs it into
/// "table already exists" and exits, permanently. The in-file
/// `PRAGMA foreign_keys` statements in 021/023 become no-ops inside the
/// transaction, which is what this preflight wants anyway: the
/// connection already runs with FK enforcement disabled.
async fn apply_preflight_migration(
    conn: &mut sqlx::SqliteConnection,
    spec: &MigrationSpec,
) -> Result<(), SafeMigrationError> {
    let start = Instant::now();
    let mut tx = conn
        .begin()
        .await
        .map_err(|e| SafeMigrationError::Apply {
            version: spec.version,
            message: format!("begin transaction: {e}"),
        })?;

    (&mut *tx)
        .execute(spec.sql)
        .await
        .map_err(|e| SafeMigrationError::Apply {
            version: spec.version,
            message: format!("execute SQL: {e}"),
        })?;

    let checksum = migration_checksum(spec);
    let elapsed = start.elapsed().as_nanos().try_into().unwrap_or(i64::MAX);
    sqlx::query(
        "INSERT INTO _sqlx_migrations
            (version, description, success, checksum, execution_time)
         VALUES (?, ?, TRUE, ?, ?)
         ON CONFLICT(version) DO NOTHING",
    )
    .bind(spec.version)
    .bind(spec.description)
    .bind(checksum.as_slice())
    .bind(elapsed)
    .execute(&mut *tx)
    .await
    .map_err(|e| SafeMigrationError::Apply {
        version: spec.version,
        message: format!("record migration: {e}"),
    })?;

    tx.commit().await.map_err(|e| SafeMigrationError::Apply {
        version: spec.version,
        message: format!("commit: {e}"),
    })?;
    Ok(())
}

fn migration_checksum(spec: &MigrationSpec) -> Vec<u8> {
    let migration = SqlxMigration::new(
        spec.version,
        Cow::Borrowed(spec.description),
        MigrationType::ReversibleUp,
        Cow::Borrowed(spec.sql),
        false,
    );
    migration.checksum.into_owned()
}

fn backup_db_candidates(data_dir: &Path) -> Result<Vec<PathBuf>, CascadedRowRecoveryError> {
    let parent = data_dir
        .parent()
        .ok_or(CascadedRowRecoveryError::DataDirUnavailable)?;
    let entries = fs::read_dir(parent).map_err(|e| CascadedRowRecoveryError::DbOpen {
        message: format!("reading backup parent {}: {e}", parent.display()),
    })?;
    let mut candidates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| CascadedRowRecoveryError::DbOpen {
            message: format!("reading backup entry: {e}"),
        })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(BACKUP_DIR_PREFIX) {
            continue;
        }
        let db = entry.path().join(DB_FILENAME);
        if db.is_file() {
            candidates.push(db);
        }
    }
    candidates.sort_by(|a, b| b.cmp(a));
    Ok(candidates)
}

async fn recover_from_one_backup(
    conn: &mut sqlx::SqliteConnection,
    backup_db: &Path,
) -> Result<Option<CascadedRowRecoveryOutcome>, sqlx::Error> {
    sqlx::query("ATTACH DATABASE ? AS galley_recovery")
        .bind(backup_db.to_string_lossy().as_ref())
        .execute(&mut *conn)
        .await?;

    let result = recover_from_attached_backup(conn, backup_db).await;
    let detach = sqlx::query("DETACH DATABASE galley_recovery")
        .execute(&mut *conn)
        .await;
    match (result, detach) {
        (Ok(outcome), Ok(_)) => Ok(outcome),
        (Err(e), _) => Err(e),
        (Ok(_), Err(e)) => Err(e),
    }
}

async fn recover_from_attached_backup(
    conn: &mut sqlx::SqliteConnection,
    backup_db: &Path,
) -> Result<Option<CascadedRowRecoveryOutcome>, sqlx::Error> {
    let restorable_messages = restorable_message_count(conn).await.unwrap_or(0);
    let restorable_tool_events = restorable_tool_event_count(conn).await.unwrap_or(0);
    let restorable_message_attachments =
        restorable_message_attachment_count(conn).await.unwrap_or(0);

    let restorable_goal_rows = restorable_goal_row_count(conn).await.unwrap_or(0);
    if restorable_messages == 0
        && restorable_tool_events == 0
        && restorable_message_attachments == 0
        && restorable_goal_rows == 0
    {
        return Ok(None);
    }

    let messages = import_messages(conn).await?;
    let tool_events = import_tool_events(conn).await.unwrap_or(0);
    let message_attachments = import_message_attachments(conn).await.unwrap_or(0);
    let goal_rows = import_goal_rows(conn).await.unwrap_or(0);

    Ok(Some(CascadedRowRecoveryOutcome::Recovered {
        backup_path: backup_db.to_path_buf(),
        messages,
        tool_events,
        message_attachments,
        goal_rows,
    }))
}

async fn restorable_message_count(conn: &mut sqlx::SqliteConnection) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM galley_recovery.messages b
         JOIN main.sessions s ON s.id = b.session_id
         LEFT JOIN main.messages m ON m.id = b.id
         WHERE m.id IS NULL",
    )
    .fetch_one(conn)
    .await
}

async fn restorable_tool_event_count(
    conn: &mut sqlx::SqliteConnection,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM galley_recovery.tool_events b
         JOIN main.sessions s ON s.id = b.session_id
         LEFT JOIN main.tool_events t ON t.id = b.id
         WHERE t.id IS NULL",
    )
    .fetch_one(conn)
    .await
}

async fn restorable_message_attachment_count(
    conn: &mut sqlx::SqliteConnection,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM galley_recovery.message_attachments b
         JOIN main.sessions s ON s.id = b.session_id
         JOIN main.messages m ON m.id = b.message_id
         LEFT JOIN main.message_attachments a ON a.id = b.id
         WHERE a.id IS NULL",
    )
    .fetch_one(conn)
    .await
}

async fn restorable_goal_row_count(conn: &mut sqlx::SqliteConnection) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT
           (SELECT COUNT(*)
            FROM galley_recovery.goal_tasks b
            JOIN main.goals g ON g.id = b.goal_id
            LEFT JOIN main.goal_tasks t ON t.id = b.id
            WHERE t.id IS NULL)
         + (SELECT COUNT(*)
            FROM galley_recovery.goal_events b
            JOIN main.goals g ON g.id = b.goal_id
            LEFT JOIN main.goal_events e ON e.id = b.id
            WHERE e.id IS NULL)
         + (SELECT COUNT(*)
            FROM galley_recovery.goal_deliverables b
            JOIN main.goals g ON g.id = b.goal_id
            LEFT JOIN main.goal_deliverables d ON d.id = b.id
            WHERE d.id IS NULL)",
    )
    .fetch_one(conn)
    .await
}

async fn import_messages(conn: &mut sqlx::SqliteConnection) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        "INSERT OR IGNORE INTO main.messages (
           id, session_id, turn_index, sequence, role, content,
           tool_calls, tool_results, thinking, final_answer, created_at,
           summary, preamble, created_via, supervisor, origin_note, visibility
         )
         SELECT
           b.id, b.session_id, b.turn_index, b.sequence, b.role, b.content,
           b.tool_calls, b.tool_results, b.thinking, b.final_answer, b.created_at,
           b.summary, b.preamble, b.created_via, b.supervisor, b.origin_note, b.visibility
         FROM galley_recovery.messages b
         JOIN main.sessions s ON s.id = b.session_id",
    )
    .execute(conn)
    .await?;
    Ok(res.rows_affected())
}

async fn import_tool_events(conn: &mut sqlx::SqliteConnection) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        "INSERT OR IGNORE INTO main.tool_events (
           id, session_id, turn_index, tool_name, status, args_json, args_preview,
           result_preview, risk_level, approval_id, approval_decision, elapsed_ms,
           started_at, ended_at
         )
         SELECT
           b.id, b.session_id, b.turn_index, b.tool_name, b.status, b.args_json, b.args_preview,
           b.result_preview, b.risk_level, b.approval_id, b.approval_decision, b.elapsed_ms,
           b.started_at, b.ended_at
         FROM galley_recovery.tool_events b
         JOIN main.sessions s ON s.id = b.session_id",
    )
    .execute(conn)
    .await?;
    Ok(res.rows_affected())
}

async fn import_message_attachments(conn: &mut sqlx::SqliteConnection) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        "INSERT OR IGNORE INTO main.message_attachments (
           id, message_id, session_id, kind, file_path, mime_type,
           byte_size, width, height, created_at
         )
         SELECT
           b.id, b.message_id, b.session_id, b.kind, b.file_path, b.mime_type,
           b.byte_size, b.width, b.height, b.created_at
         FROM galley_recovery.message_attachments b
         JOIN main.messages m ON m.id = b.message_id
         JOIN main.sessions s ON s.id = b.session_id",
    )
    .execute(conn)
    .await?;
    Ok(res.rows_affected())
}

/// Restores only goal child rows whose parent goal still exists in the
/// active DB. Parent tables (`goals`, `goal_proposals`) are deliberately
/// NOT imported: the 021/023 rebuilds copy parent rows into the `*_new`
/// table before dropping the old one, so parents were never cascade
/// victims — a goal present in the backup but missing from `main` was
/// deleted by the user, and importing it would resurrect deleted data.
async fn import_goal_rows(conn: &mut sqlx::SqliteConnection) -> Result<u64, sqlx::Error> {
    let mut total = 0;

    total += sqlx::query(
        "INSERT OR IGNORE INTO main.goal_tasks (
           id, goal_id, title, description, status, owner_session_id,
           scope, result_summary, created_at, updated_at
         )
         SELECT
           b.id, b.goal_id, b.title, b.description, b.status, b.owner_session_id,
           b.scope, b.result_summary, b.created_at, b.updated_at
         FROM galley_recovery.goal_tasks b
         JOIN main.goals g ON g.id = b.goal_id",
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();

    total += sqlx::query(
        "INSERT OR IGNORE INTO main.goal_events (
           id, goal_id, task_id, author_session_id, event_type, body, created_at
         )
         SELECT
           b.id, b.goal_id, b.task_id, b.author_session_id, b.event_type, b.body, b.created_at
         FROM galley_recovery.goal_events b
         JOIN main.goals g ON g.id = b.goal_id",
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();

    total += sqlx::query(
        "INSERT OR IGNORE INTO main.goal_deliverables (
           id, goal_id, version, content, note, author_session_id, created_at
         )
         SELECT
           b.id, b.goal_id, b.version, b.content, b.note, b.author_session_id, b.created_at
         FROM galley_recovery.goal_deliverables b
         JOIN main.goals g ON g.id = b.goal_id",
    )
    .execute(&mut *conn)
    .await?
    .rows_affected();

    Ok(total)
}

/// Recursive directory copy. `std::fs` has no `copy_dir_all`, so we
/// roll our own — no extra deps (B4 M8 sub-plan §1.8).
///
/// Returns the number of symlinks / special files skipped. Galley's
/// data dir never creates any; if a user manually drops one in, we'd
/// rather leave it than follow into untrusted territory — but the skip
/// is counted and logged so a "backup succeeded" report stays honest.
///
/// On Windows both roots are canonicalized to `\\?\` verbatim form
/// first: MAX_PATH (260) only applies to non-verbatim paths, and the
/// backup dir name is longer than the data dir's, so deep attachment
/// paths that fit fine in the data dir would otherwise fail to copy —
/// and the backup gate then refuses to start Galley (exit 2).
fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<u64> {
    fs::create_dir_all(dst)?;
    #[cfg(windows)]
    {
        let src = fs::canonicalize(src)?;
        let dst = fs::canonicalize(dst)?;
        copy_dir_all_inner(&src, &dst)
    }
    #[cfg(not(windows))]
    copy_dir_all_inner(src, dst)
}

fn copy_dir_all_inner(src: &Path, dst: &Path) -> io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut skipped_symlinks = 0_u64;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            skipped_symlinks += copy_dir_all_inner(&from, &to)?;
        } else if ty.is_file() {
            fs::copy(&from, &to)?;
        } else {
            eprintln!("[backup] skipping symlink/special file {}", from.display());
            skipped_symlinks += 1;
        }
    }
    Ok(skipped_symlinks)
}

/// Compact ISO-8601 UTC timestamp suitable for filenames (no `:` so
/// Windows is happy). Example: `20260520T140530Z`.
fn timestamp_now() -> String {
    chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
}

// ===================== tests =====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper — initialize a minimal SQLite DB with `_sqlx_migrations`
    /// containing one row at `version`.
    fn init_db_with_version(db_path: &Path, version: i64) {
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);
        tauri::async_runtime::block_on(async {
            let mut conn = opts.connect().await.expect("open db");
            sqlx::query(
                "CREATE TABLE _sqlx_migrations (
                    version BIGINT PRIMARY KEY,
                    description TEXT NOT NULL,
                    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    success BOOLEAN NOT NULL,
                    checksum BLOB NOT NULL,
                    execution_time BIGINT NOT NULL
                )",
            )
            .execute(&mut conn)
            .await
            .expect("create _sqlx_migrations");
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (?, 'test', 1, X'00', 0)",
            )
            .bind(version)
            .execute(&mut conn)
            .await
            .expect("insert version row");
        });
    }

    fn init_db_through_migration(db_path: &Path, version: i64) {
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .foreign_keys(false);
        tauri::async_runtime::block_on(async {
            let mut conn = opts.connect().await.expect("open db");
            ensure_sqlx_migrations_table(&mut conn)
                .await
                .expect("create migration table");
            for spec in SAFE_PREFLIGHT_MIGRATIONS
                .iter()
                .filter(|spec| spec.version <= version)
            {
                apply_preflight_migration(&mut conn, spec)
                    .await
                    .expect("apply migration");
            }
        });
    }

    #[test]
    fn copy_dir_all_flat() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), b"hello").unwrap();
        fs::write(src.join("b.txt"), b"world").unwrap();

        copy_dir_all(&src, &dst).unwrap();
        assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"hello");
        assert_eq!(fs::read(dst.join("b.txt")).unwrap(), b"world");
    }

    #[test]
    fn copy_dir_all_nested() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir_all(src.join("inner/deep")).unwrap();
        fs::write(src.join("top.txt"), b"top").unwrap();
        fs::write(src.join("inner/mid.txt"), b"mid").unwrap();
        fs::write(src.join("inner/deep/bottom.txt"), b"bottom").unwrap();

        copy_dir_all(&src, &dst).unwrap();
        assert_eq!(fs::read(dst.join("top.txt")).unwrap(), b"top");
        assert_eq!(fs::read(dst.join("inner/mid.txt")).unwrap(), b"mid");
        assert_eq!(
            fs::read(dst.join("inner/deep/bottom.txt")).unwrap(),
            b"bottom"
        );
    }

    #[test]
    fn copy_dir_all_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir(&src).unwrap();
        copy_dir_all(&src, &dst).unwrap();
        assert!(dst.is_dir());
        assert_eq!(fs::read_dir(&dst).unwrap().count(), 0);
    }

    #[test]
    fn copy_dir_all_counts_skipped_symlinks() {
        #[cfg(unix)]
        {
            let tmp = TempDir::new().unwrap();
            let src = tmp.path().join("src");
            fs::create_dir_all(src.join("sub")).unwrap();
            fs::write(src.join("real.txt"), b"real").unwrap();
            std::os::unix::fs::symlink(src.join("real.txt"), src.join("sub").join("link.txt"))
                .unwrap();

            let dst = tmp.path().join("dst");
            let skipped = copy_dir_all(&src, &dst).unwrap();
            // The symlink is deliberately not copied, but the skip must
            // be visible to the caller — a "Backed" report that silently
            // dropped entries would overstate what the backup contains.
            assert_eq!(skipped, 1);
            assert_eq!(fs::read(dst.join("real.txt")).unwrap(), b"real");
            assert!(!dst.join("sub").join("link.txt").exists());
        }
    }

    #[test]
    fn copy_dir_all_src_missing() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("nope");
        let dst = tmp.path().join("dst");
        assert!(copy_dir_all(&src, &dst).is_err());
    }

    /// Helper — create a parent + nested data dir layout that mirrors
    /// the production `~/Library/Application Support/app.galley/`
    /// structure (parent must exist because backup goes to a sibling).
    fn make_parent_with_data_dir(tmp: &TempDir) -> PathBuf {
        let parent = tmp.path().join("AppData");
        fs::create_dir(&parent).unwrap();
        let data = parent.join("app.galley");
        fs::create_dir(&data).unwrap();
        data
    }

    #[test]
    fn backup_pruning_keeps_only_newest_backups() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        init_db_with_version(&data.join(DB_FILENAME), 5);
        let parent = data.parent().unwrap();
        // Seed older backups (lexicographic = chronological order).
        for stamp in [
            "20260101T000000Z",
            "20260201T000000Z",
            "20260301T000000Z",
            "20260401T000000Z",
        ] {
            fs::create_dir(parent.join(format!("{BACKUP_DIR_PREFIX}{stamp}"))).unwrap();
        }

        let out = ensure_backup_before_migrate_in(&data, 9).unwrap();
        let new_backup = match out {
            BackupOutcome::Backed { backup_path, .. } => backup_path,
            other => panic!("expected Backed, got {other:?}"),
        };

        let mut remaining: Vec<String> = fs::read_dir(parent)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(BACKUP_DIR_PREFIX))
            .collect();
        remaining.sort();
        assert_eq!(remaining.len(), BACKUP_RETENTION_COUNT);
        // The two oldest were pruned; the just-created backup survives.
        assert_eq!(remaining[0], format!("{BACKUP_DIR_PREFIX}20260301T000000Z"));
        assert!(new_backup.is_dir());
    }

    #[test]
    fn cascade_recovery_is_one_shot_via_sentinel() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        init_db_with_version(&data.join(DB_FILENAME), 9);

        // First pass completes (nothing to recover) and writes the
        // sentinel; every later startup must skip without scanning.
        let first = recover_cascaded_rows_from_backups_in(&data).unwrap();
        assert!(matches!(first, CascadedRowRecoveryOutcome::NoBackups));
        assert!(data.join(RECOVERY_SENTINEL_FILENAME).is_file());

        let second = recover_cascaded_rows_from_backups_in(&data).unwrap();
        assert!(matches!(
            second,
            CascadedRowRecoveryOutcome::AlreadyCompleted
        ));
    }

    #[test]
    fn fresh_install_data_dir_missing() {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("doesnt-exist");
        let out = ensure_backup_before_migrate_in(&data, 7).unwrap();
        assert!(matches!(out, BackupOutcome::FreshInstall));
    }

    #[test]
    fn fresh_install_db_missing() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        // data dir exists but no workbench.db inside
        let out = ensure_backup_before_migrate_in(&data, 7).unwrap();
        assert!(matches!(out, BackupOutcome::FreshInstall));
    }

    #[test]
    fn up_to_date() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        init_db_with_version(&data.join(DB_FILENAME), 7);
        let out = ensure_backup_before_migrate_in(&data, 7).unwrap();
        match out {
            BackupOutcome::UpToDate { version } => assert_eq!(version, 7),
            other => panic!("expected UpToDate, got {other:?}"),
        }
        // Confirm no backup dir was created.
        let siblings: Vec<_> = fs::read_dir(data.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(!siblings.iter().any(|n| n.starts_with(BACKUP_DIR_PREFIX)));
    }

    #[test]
    fn pending_triggers_copy() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        // Seed DB at version 5 (simulating a v0.1.1-alpha.X install
        // before mig 006/007 shipped — purely synthetic since real
        // v0.1.1 ships with mig 7, but the mechanism is forward-looking).
        init_db_with_version(&data.join(DB_FILENAME), 5);
        // Put a sibling file inside data dir so we can verify byte-identical copy.
        fs::write(data.join("sentinel.txt"), b"hello sentinel").unwrap();
        fs::create_dir(data.join("sub")).unwrap();
        fs::write(data.join("sub").join("nested.txt"), b"hello nested").unwrap();
        fs::create_dir_all(data.join("managed-ga-state").join("memory")).unwrap();
        fs::write(
            data.join("managed-ga-state").join("memory").join("user.md"),
            b"managed memory",
        )
        .unwrap();
        fs::create_dir_all(data.join("managed-model-config")).unwrap();
        fs::write(
            data.join("managed-model-config")
                .join("managed-models.json"),
            br#"{"schemaVersion":1,"models":[]}"#,
        )
        .unwrap();

        let out = ensure_backup_before_migrate_in(&data, 9).unwrap();
        match out {
            BackupOutcome::Backed {
                from,
                to,
                backup_path,
                skipped_symlinks,
            } => {
                assert_eq!(from, 5);
                assert_eq!(to, 9);
                assert_eq!(skipped_symlinks, 0);
                assert!(backup_path.is_dir(), "backup path must exist");
                // Sibling: parent is the same as data.parent()
                assert_eq!(backup_path.parent(), data.parent());
                // File copied byte-identical
                let copied = fs::read(backup_path.join("sentinel.txt")).unwrap();
                assert_eq!(copied, b"hello sentinel");
                let nested = fs::read(backup_path.join("sub").join("nested.txt")).unwrap();
                assert_eq!(nested, b"hello nested");
                // DB file also copied
                assert!(backup_path.join(DB_FILENAME).is_file());
                // Managed GA state is Galley-owned user state and must travel
                // with ordinary app-data backup.
                assert_eq!(
                    fs::read(
                        backup_path
                            .join("managed-ga-state")
                            .join("memory")
                            .join("user.md")
                    )
                    .unwrap(),
                    b"managed memory"
                );
                // Non-secret generated model config is app data. Managed model
                // API keys live in encrypted SQLite rows, so plaintext keys are
                // not part of this directory-level backup.
                assert!(backup_path
                    .join("managed-model-config")
                    .join("managed-models.json")
                    .is_file());
            }
            other => panic!("expected Backed, got {other:?}"),
        }
    }

    #[test]
    fn safe_rebuild_preflight_preserves_session_and_goal_child_rows() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        let db = data.join(DB_FILENAME);
        init_db_through_migration(&db, 19);

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open seeded db");
            sqlx::query(
                "INSERT INTO projects (id, name, last_activity_at, created_at, updated_at)
                 VALUES ('p1', 'Project', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed project");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut conn)
            .await
            .expect("seed session");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at)
                 VALUES ('m1', 's1', 1, 0, 'user', 'hello', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed message");
            sqlx::query(
                "INSERT INTO tool_events (id, session_id, turn_index, tool_name, status, started_at)
                 VALUES ('t1', 's1', 1, 'noop', 'success', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed tool event");
            sqlx::query(
                "INSERT INTO goal_proposals (
                   id, objective, project_id, budget_seconds, worker_limit, runtime_kind,
                   write_mode, status, internal_confirm_token, expires_at, created_at,
                   updated_at, master_session_id
                 )
                 VALUES (
                   'gp1', 'Do work', 'p1', 60, 1, 'managed',
                   'autonomous', 'started', 'tok', '2026-06-18T01:00:00Z',
                   '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', 's1'
                 )",
            )
            .execute(&mut conn)
            .await
            .expect("seed proposal");
            sqlx::query(
                "INSERT INTO goals (
                   id, proposal_id, project_id, objective, status, budget_seconds,
                   worker_limit, runtime_kind, write_mode, started_at, deadline_at,
                   created_at, updated_at, master_session_id, result_seen_at, workspace_path
                 )
                 VALUES (
                   'g1', 'gp1', 'p1', 'Do work', 'running', 60,
                   1, 'managed', 'autonomous', '2026-06-18T00:00:00Z', '2026-06-18T01:00:00Z',
                   '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', 's1', NULL, NULL
                 )",
            )
            .execute(&mut conn)
            .await
            .expect("seed goal");
            sqlx::query(
                "INSERT INTO goal_tasks (id, goal_id, title, status, created_at, updated_at)
                 VALUES ('gt1', 'g1', 'Task', 'open', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed goal task");
            sqlx::query(
                "INSERT INTO goal_events (goal_id, task_id, author_session_id, event_type, body, created_at)
                 VALUES ('g1', 'gt1', 's1', 'progress', 'started', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed goal event");
            sqlx::query(
                "INSERT INTO goal_deliverables (id, goal_id, version, content, created_at)
                 VALUES ('gd1', 'g1', 1, 'draft', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut conn)
            .await
            .expect("seed deliverable");
        });

        let outcome = ensure_safe_rebuild_migrations_in(&data, 26).unwrap();
        assert!(matches!(
            outcome,
            SafeMigrationOutcome::Applied { from: 19, to: 23 }
        ));

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open migrated db");
            let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
                .fetch_one(&mut conn)
                .await
                .expect("read version");
            assert_eq!(version, 23);
            for (label, table) in [
                ("messages", "messages"),
                ("tool_events", "tool_events"),
                ("goal_tasks", "goal_tasks"),
                ("goal_events", "goal_events"),
                ("goal_deliverables", "goal_deliverables"),
            ] {
                let sql = format!("SELECT COUNT(*) FROM {table}");
                let count: i64 = sqlx::query_scalar(&sql)
                    .fetch_one(&mut conn)
                    .await
                    .unwrap_or_else(|e| panic!("count {label}: {e}"));
                assert_eq!(count, 1, "{label} should survive table rebuild");
            }
        });
    }

    #[test]
    fn cascaded_row_recovery_restores_missing_messages_from_backup() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        let db = data.join(DB_FILENAME);
        init_db_through_migration(&db, 23);

        let backup_dir = data
            .parent()
            .unwrap()
            .join("app.galley.backup.20260618T010203Z");
        fs::create_dir(&backup_dir).unwrap();
        let backup_db = backup_dir.join(DB_FILENAME);
        init_db_through_migration(&backup_db, 19);

        tauri::async_runtime::block_on(async {
            let mut active = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut active)
            .await
            .expect("seed active session");

            let mut backup = SqliteConnectOptions::new()
                .filename(&backup_db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open backup db");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup session");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at)
                 VALUES ('m1', 's1', 1, 0, 'user', 'hello', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup message");
            sqlx::query(
                "INSERT INTO tool_events (id, session_id, turn_index, tool_name, status, started_at)
                 VALUES ('t1', 's1', 1, 'noop', 'success', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup tool event");
        });

        let outcome = recover_cascaded_rows_from_backups_in(&data).unwrap();
        match outcome {
            CascadedRowRecoveryOutcome::Recovered {
                messages,
                tool_events,
                ..
            } => {
                assert_eq!(messages, 1);
                assert_eq!(tool_events, 1);
            }
            other => panic!("expected recovery, got {other:?}"),
        }

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
                .fetch_one(&mut conn)
                .await
                .expect("count messages");
            let tool_events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tool_events")
                .fetch_one(&mut conn)
                .await
                .expect("count tool events");
            assert_eq!(messages, 1);
            assert_eq!(tool_events, 1);
        });
    }

    #[test]
    fn cascaded_row_recovery_restores_tool_events_when_messages_exist() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        let db = data.join(DB_FILENAME);
        init_db_through_migration(&db, 23);

        let backup_dir = data
            .parent()
            .unwrap()
            .join("app.galley.backup.20260618T040506Z");
        fs::create_dir(&backup_dir).unwrap();
        let backup_db = backup_dir.join(DB_FILENAME);
        init_db_through_migration(&backup_db, 19);

        tauri::async_runtime::block_on(async {
            let mut active = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut active)
            .await
            .expect("seed active session");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at)
                 VALUES ('m1', 's1', 1, 0, 'user', 'hello', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut active)
            .await
            .expect("seed active message");

            let mut backup = SqliteConnectOptions::new()
                .filename(&backup_db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open backup db");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup session");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at)
                 VALUES ('m1', 's1', 1, 0, 'user', 'hello', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup message");
            sqlx::query(
                "INSERT INTO tool_events (id, session_id, turn_index, tool_name, status, started_at)
                 VALUES ('t1', 's1', 1, 'noop', 'success', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup tool event");
        });

        let outcome = recover_cascaded_rows_from_backups_in(&data).unwrap();
        match outcome {
            CascadedRowRecoveryOutcome::Recovered {
                messages,
                tool_events,
                ..
            } => {
                assert_eq!(messages, 0);
                assert_eq!(tool_events, 1);
            }
            other => panic!("expected recovery, got {other:?}"),
        }

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            let tool_events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tool_events")
                .fetch_one(&mut conn)
                .await
                .expect("count tool events");
            assert_eq!(tool_events, 1);
        });
    }

    #[test]
    fn not_applicable_future_version() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        // DB claims version 99 (e.g. user downgraded after running a
        // future Galley).
        init_db_with_version(&data.join(DB_FILENAME), 99);
        let out = ensure_backup_before_migrate_in(&data, 7).unwrap();
        match out {
            BackupOutcome::NotApplicable { on_disk, code_max } => {
                assert_eq!(on_disk, 99);
                assert_eq!(code_max, 7);
            }
            other => panic!("expected NotApplicable, got {other:?}"),
        }
    }

    #[test]
    fn no_migrations_table_treated_as_zero() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        // Create an empty DB with no `_sqlx_migrations` table.
        let db_path = data.join(DB_FILENAME);
        let opts = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
        tauri::async_runtime::block_on(async {
            let mut conn = opts.connect().await.expect("open empty db");
            sqlx::query("CREATE TABLE placeholder (x INTEGER)")
                .execute(&mut conn)
                .await
                .expect("create placeholder");
        });
        let out = ensure_backup_before_migrate_in(&data, 7).unwrap();
        // version probe returns 0 → 0 < 7 → backup path
        assert!(matches!(out, BackupOutcome::Backed { from: 0, to: 7, .. }));
    }

    #[test]
    fn preflight_migration_failure_leaves_no_partial_state() {
        // A migration whose SQL fails after its first statement must
        // roll back entirely: the pre-fix behavior committed the first
        // statement in autocommit mode, so a retry hit "table already
        // exists" on every subsequent launch.
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join(DB_FILENAME);
        let bad = MigrationSpec {
            version: 99,
            description: "fails midway",
            sql: "CREATE TABLE preflight_tx_probe (x INTEGER);
                  INSERT INTO no_such_table VALUES (1);",
        };
        let good = MigrationSpec {
            version: 99,
            description: "succeeds on retry",
            sql: "CREATE TABLE preflight_tx_probe (x INTEGER);",
        };

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true)
                .foreign_keys(false)
                .connect()
                .await
                .expect("open db");
            ensure_sqlx_migrations_table(&mut conn)
                .await
                .expect("create migration table");

            let err = apply_preflight_migration(&mut conn, &bad)
                .await
                .expect_err("bad migration must fail");
            assert!(matches!(err, SafeMigrationError::Apply { version: 99, .. }));

            // Nothing from the failed migration may survive.
            let table_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'preflight_tx_probe'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("probe table existence");
            assert_eq!(table_count, 0, "partial DDL must be rolled back");
            let version_rows: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 99")
                    .fetch_one(&mut conn)
                    .await
                    .expect("probe version row");
            assert_eq!(version_rows, 0, "no version row for a failed migration");

            // Retry with corrected SQL succeeds — the launch-loop brick
            // scenario is exactly this retry failing.
            apply_preflight_migration(&mut conn, &good)
                .await
                .expect("retry must succeed");
            let version_rows: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 99")
                    .fetch_one(&mut conn)
                    .await
                    .expect("probe version row after retry");
            assert_eq!(version_rows, 1);
        });
    }

    #[test]
    fn cascaded_row_recovery_does_not_resurrect_deleted_goals() {
        let tmp = TempDir::new().unwrap();
        let data = make_parent_with_data_dir(&tmp);
        let db = data.join(DB_FILENAME);
        init_db_through_migration(&db, 23);

        let backup_dir = data
            .parent()
            .unwrap()
            .join("app.galley.backup.20260618T070809Z");
        fs::create_dir(&backup_dir).unwrap();
        let backup_db = backup_dir.join(DB_FILENAME);
        init_db_through_migration(&backup_db, 19);

        tauri::async_runtime::block_on(async {
            // Active DB: session survives, but the user deleted the
            // goal (and its proposal) after the upgrade.
            let mut active = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut active)
            .await
            .expect("seed active session");

            // Backup: same session plus the goal the user later
            // deleted, with child rows — and one genuinely restorable
            // message so recovery triggers at all.
            let mut backup = SqliteConnectOptions::new()
                .filename(&backup_db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open backup db");
            sqlx::query(
                "INSERT INTO projects (id, name, last_activity_at, created_at, updated_at)
                 VALUES ('p1', 'Project', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup project");
            sqlx::query(
                "INSERT INTO sessions (
                   id, title, status, turn_count, pending_approval_count,
                   error_count, pinned, last_activity_at, created_at, updated_at,
                   ga_runtime_kind
                 )
                 VALUES (
                   's1', 'Old', 'idle', 1, 0,
                   0, 0, '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z',
                   'managed'
                 )",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup session");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at)
                 VALUES ('m1', 's1', 1, 0, 'user', 'hello', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup message");
            sqlx::query(
                "INSERT INTO goal_proposals (
                   id, objective, project_id, budget_seconds, worker_limit, runtime_kind,
                   write_mode, status, internal_confirm_token, expires_at, created_at,
                   updated_at, master_session_id
                 )
                 VALUES (
                   'gp1', 'Do work', 'p1', 60, 1, 'managed',
                   'autonomous', 'started', 'tok', '2026-06-18T01:00:00Z',
                   '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', 's1'
                 )",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup proposal");
            sqlx::query(
                "INSERT INTO goals (
                   id, proposal_id, project_id, objective, status, budget_seconds,
                   worker_limit, runtime_kind, write_mode, started_at, deadline_at,
                   created_at, updated_at, master_session_id
                 )
                 VALUES (
                   'g1', 'gp1', 'p1', 'Do work', 'completed', 60,
                   1, 'managed', 'autonomous', '2026-06-18T00:00:00Z', '2026-06-18T01:00:00Z',
                   '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z', 's1'
                 )",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup goal");
            sqlx::query(
                "INSERT INTO goal_tasks (id, goal_id, title, status, created_at, updated_at)
                 VALUES ('gt1', 'g1', 'Task', 'open', '2026-06-18T00:00:00Z', '2026-06-18T00:00:00Z')",
            )
            .execute(&mut backup)
            .await
            .expect("seed backup goal task");
        });

        let outcome = recover_cascaded_rows_from_backups_in(&data).unwrap();
        match outcome {
            CascadedRowRecoveryOutcome::Recovered {
                messages,
                goal_rows,
                ..
            } => {
                assert_eq!(messages, 1, "restorable message should come back");
                assert_eq!(goal_rows, 0, "no goal child has a surviving parent");
            }
            other => panic!("expected recovery, got {other:?}"),
        }

        tauri::async_runtime::block_on(async {
            let mut conn = SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(false)
                .connect()
                .await
                .expect("open active db");
            for table in ["goals", "goal_proposals", "goal_tasks"] {
                let sql = format!("SELECT COUNT(*) FROM {table}");
                let count: i64 = sqlx::query_scalar(&sql)
                    .fetch_one(&mut conn)
                    .await
                    .unwrap_or_else(|e| panic!("count {table}: {e}"));
                assert_eq!(count, 0, "{table}: user-deleted rows must stay deleted");
            }
        });
    }

    #[test]
    fn timestamp_format_is_filename_safe() {
        let ts = timestamp_now();
        // YYYYMMDDTHHMMSSZ → 16 chars, all alphanumeric (no ':')
        assert_eq!(ts.len(), 16);
        assert!(ts.ends_with('Z'));
        assert!(
            ts.chars().all(|c| c.is_ascii_alphanumeric()),
            "timestamp must be filename-safe: {ts}"
        );
        assert!(!ts.contains(':'));
    }
}
