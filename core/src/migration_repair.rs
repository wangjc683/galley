//! Best-effort repair for migration-induced history loss.
//!
//! Context: migration 021 rebuilt `sessions` inside sqlx's transactional
//! migrator. SQLite ignores `PRAGMA foreign_keys = OFF` inside a transaction,
//! so dropping the parent table can cascade-delete `messages` rows while the
//! rebuilt `sessions` metadata survives. Galley creates a full app-data backup
//! immediately before migrations, so we can restore missing child rows from the
//! newest usable backup without overwriting current data.

use std::fs;
use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{ConnectOptions, Executor, SqliteConnection};

use crate::app_paths::{self, DB_FILENAME};

const BACKUP_DIR_PREFIX: &str = "app.galley.backup.";
const BACKUP_SCHEMA: &str = "galley_repair_backup";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoryRepairOutcome {
    NoDataDir,
    NoDatabase,
    NoSessionHistory,
    NoUsableBackup,
    Repaired {
        backup_path: PathBuf,
        messages_restored: u64,
        attachments_restored: u64,
        tool_events_restored: u64,
        session_refs_restored: u64,
        fts_rows_rebuilt: u64,
    },
}

#[derive(Debug)]
pub enum HistoryRepairError {
    Io(String),
    Sql(String),
}

impl std::fmt::Display for HistoryRepairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HistoryRepairError::Io(message) => write!(f, "io: {message}"),
            HistoryRepairError::Sql(message) => write!(f, "sql: {message}"),
        }
    }
}

impl std::error::Error for HistoryRepairError {}

impl From<sqlx::Error> for HistoryRepairError {
    fn from(value: sqlx::Error) -> Self {
        HistoryRepairError::Sql(value.to_string())
    }
}

impl From<std::io::Error> for HistoryRepairError {
    fn from(value: std::io::Error) -> Self {
        HistoryRepairError::Io(value.to_string())
    }
}

pub fn repair_history_from_latest_backup() -> Result<HistoryRepairOutcome, HistoryRepairError> {
    let Some(data_dir) = app_paths::app_config_dir() else {
        return Ok(HistoryRepairOutcome::NoDataDir);
    };
    tauri::async_runtime::block_on(repair_history_from_latest_backup_in(&data_dir))
}

async fn repair_history_from_latest_backup_in(
    data_dir: &Path,
) -> Result<HistoryRepairOutcome, HistoryRepairError> {
    let db_path = data_dir.join(DB_FILENAME);
    if !db_path.exists() {
        return Ok(HistoryRepairOutcome::NoDatabase);
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(false),
        )
        .await?;

    let session_turns: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(turn_count), 0) FROM sessions")
            .fetch_one(&pool)
            .await?;
    if session_turns <= 0 {
        return Ok(HistoryRepairOutcome::NoSessionHistory);
    }

    let Some(backup_db) = newest_backup_with_messages(data_dir).await? else {
        return Ok(HistoryRepairOutcome::NoUsableBackup);
    };

    let mut conn = pool.acquire().await?;
    let outcome = restore_missing_history_from_backup(&mut conn, backup_db).await?;
    Ok(outcome)
}

async fn newest_backup_with_messages(
    data_dir: &Path,
) -> Result<Option<PathBuf>, HistoryRepairError> {
    let Some(parent) = data_dir.parent() else {
        return Ok(None);
    };
    let mut candidates = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with(BACKUP_DIR_PREFIX) {
            candidates.push(path.join(DB_FILENAME));
        }
    }
    candidates.sort_by(|a, b| b.cmp(a));

    for db_path in candidates {
        if !db_path.exists() {
            continue;
        }
        if backup_message_count(&db_path).await.unwrap_or(0) > 0 {
            return Ok(Some(db_path));
        }
    }
    Ok(None)
}

async fn backup_message_count(db_path: &Path) -> Result<i64, HistoryRepairError> {
    let mut conn = SqliteConnectOptions::new()
        .filename(db_path)
        .read_only(true)
        .create_if_missing(false)
        .connect()
        .await?;
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages")
        .fetch_one(&mut conn)
        .await?;
    Ok(count)
}

async fn restore_missing_history_from_backup(
    conn: &mut SqliteConnection,
    backup_db: PathBuf,
) -> Result<HistoryRepairOutcome, HistoryRepairError> {
    let attach_sql = format!(
        "ATTACH DATABASE {} AS {BACKUP_SCHEMA}",
        sqlite_string_literal(&backup_db.to_string_lossy())
    );
    conn.execute(attach_sql.as_str()).await?;

    let messages_restored = sqlx::query(&format!(
        "INSERT OR IGNORE INTO main.messages (
           id, session_id, turn_index, sequence, role, content,
           tool_calls, tool_results, thinking, final_answer, created_at,
           summary, preamble, created_via, supervisor, origin_note, visibility
         )
         SELECT
           b.id, b.session_id, b.turn_index, b.sequence, b.role, b.content,
           b.tool_calls, b.tool_results, b.thinking, b.final_answer, b.created_at,
           b.summary, b.preamble, b.created_via, b.supervisor, b.origin_note, b.visibility
         FROM {BACKUP_SCHEMA}.messages b
         JOIN main.sessions s ON s.id = b.session_id"
    ))
    .execute(&mut *conn)
    .await?
    .rows_affected();

    let attachments_restored = if backup_table_exists(conn, "message_attachments").await? {
        sqlx::query(&format!(
            "INSERT OR IGNORE INTO main.message_attachments (
               id, message_id, session_id, kind, file_path, mime_type,
               byte_size, width, height, created_at
             )
             SELECT
               b.id, b.message_id, b.session_id, b.kind, b.file_path, b.mime_type,
               b.byte_size, b.width, b.height, b.created_at
             FROM {BACKUP_SCHEMA}.message_attachments b
             JOIN main.messages m ON m.id = b.message_id"
        ))
        .execute(&mut *conn)
        .await?
        .rows_affected()
    } else {
        0
    };

    let tool_events_restored = if backup_table_exists(conn, "tool_events").await? {
        sqlx::query(&format!(
            "INSERT OR IGNORE INTO main.tool_events (
               id, session_id, turn_index, tool_name, status, args_json,
               args_preview, result_preview, risk_level, approval_id,
               approval_decision, elapsed_ms, started_at, ended_at
             )
             SELECT
               b.id, b.session_id, b.turn_index, b.tool_name, b.status, b.args_json,
               b.args_preview, b.result_preview, b.risk_level, b.approval_id,
               b.approval_decision, b.elapsed_ms, b.started_at, b.ended_at
             FROM {BACKUP_SCHEMA}.tool_events b
             JOIN main.sessions s ON s.id = b.session_id"
        ))
        .execute(&mut *conn)
        .await?
        .rows_affected()
    } else {
        0
    };

    let session_refs_restored = restore_nullable_session_refs(conn).await?;

    let fts_rows_rebuilt = if main_table_exists(conn, "messages_fts").await? {
        conn.execute("DELETE FROM main.messages_fts").await?;
        sqlx::query(
            "INSERT INTO main.messages_fts (message_id, session_id, role, turn_index, body)
             SELECT
               id,
               session_id,
               role,
               turn_index,
               CASE
                 WHEN role = 'assistant' THEN COALESCE(NULLIF(final_answer, ''), content)
                 ELSE content
               END
             FROM main.messages
             WHERE visibility = 'visible'",
        )
        .execute(&mut *conn)
        .await?
        .rows_affected()
    } else {
        0
    };

    conn.execute(format!("DETACH DATABASE {BACKUP_SCHEMA}").as_str())
        .await?;

    Ok(HistoryRepairOutcome::Repaired {
        backup_path: backup_db,
        messages_restored,
        attachments_restored,
        tool_events_restored,
        session_refs_restored,
        fts_rows_rebuilt,
    })
}

async fn restore_nullable_session_refs(
    conn: &mut SqliteConnection,
) -> Result<u64, HistoryRepairError> {
    let refs = [
        ("goal_proposals", "id", "master_session_id"),
        ("goals", "id", "master_session_id"),
        ("goal_tasks", "id", "owner_session_id"),
        ("goal_events", "id", "author_session_id"),
        ("goal_deliverables", "id", "author_session_id"),
    ];
    let mut restored = 0;
    for (table, id_column, session_column) in refs {
        if !main_table_exists(conn, table).await?
            || !backup_table_exists(conn, table).await?
            || !table_column_exists(conn, "main", table, session_column).await?
            || !table_column_exists(conn, BACKUP_SCHEMA, table, session_column).await?
        {
            continue;
        }
        let sql = format!(
            "UPDATE main.{table}
             SET {session_column} = (
               SELECT b.{session_column}
               FROM {BACKUP_SCHEMA}.{table} b
               JOIN main.sessions s ON s.id = b.{session_column}
               WHERE b.{id_column} = main.{table}.{id_column}
               LIMIT 1
             )
             WHERE {session_column} IS NULL
               AND EXISTS (
                 SELECT 1
                 FROM {BACKUP_SCHEMA}.{table} b
                 JOIN main.sessions s ON s.id = b.{session_column}
                 WHERE b.{id_column} = main.{table}.{id_column}
                   AND b.{session_column} IS NOT NULL
               )"
        );
        restored += sqlx::query(&sql).execute(&mut *conn).await?.rows_affected();
    }
    Ok(restored)
}

async fn backup_table_exists(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<bool, HistoryRepairError> {
    let sql = format!(
        "SELECT 1 FROM {BACKUP_SCHEMA}.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    );
    let row = sqlx::query(&sql).bind(table).fetch_optional(conn).await?;
    Ok(row.is_some())
}

async fn table_column_exists(
    conn: &mut SqliteConnection,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool, HistoryRepairError> {
    let sql = format!("SELECT 1 FROM {schema}.pragma_table_info(?) WHERE name = ? LIMIT 1");
    let row = sqlx::query(&sql)
        .bind(table)
        .bind(column)
        .fetch_optional(conn)
        .await?;
    Ok(row.is_some())
}

async fn main_table_exists(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<bool, HistoryRepairError> {
    let row =
        sqlx::query("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
            .bind(table)
            .fetch_optional(conn)
            .await?;
    Ok(row.is_some())
}

fn sqlite_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    #[tokio::test]
    async fn restores_missing_messages_from_newest_usable_backup() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let data_dir = tmp.path().join("app.galley");
        let empty_backup = tmp.path().join("app.galley.backup.20260617T040000Z");
        let good_backup = tmp.path().join("app.galley.backup.20260617T032113Z");
        fs::create_dir_all(&data_dir).unwrap();
        fs::create_dir_all(&empty_backup).unwrap();
        fs::create_dir_all(&good_backup).unwrap();

        create_fixture_db(&data_dir.join(DB_FILENAME), false).await;
        create_empty_fixture_db(&empty_backup.join(DB_FILENAME)).await;
        create_fixture_db(&good_backup.join(DB_FILENAME), true).await;

        let outcome = repair_history_from_latest_backup_in(&data_dir)
            .await
            .expect("repair");

        match outcome {
            HistoryRepairOutcome::Repaired {
                messages_restored,
                attachments_restored,
                tool_events_restored,
                session_refs_restored,
                fts_rows_rebuilt,
                ..
            } => {
                assert_eq!(messages_restored, 2);
                assert_eq!(attachments_restored, 1);
                assert_eq!(tool_events_restored, 1);
                assert_eq!(session_refs_restored, 1);
                assert_eq!(fts_rows_rebuilt, 2);
            }
            other => panic!("unexpected outcome: {other:?}"),
        }

        let pool = open_fixture_pool(&data_dir.join(DB_FILENAME)).await;
        let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
            .fetch_one(&pool)
            .await
            .unwrap();
        let fts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts")
            .fetch_one(&pool)
            .await
            .unwrap();
        let master_session_id: Option<String> =
            sqlx::query_scalar("SELECT master_session_id FROM goal_proposals WHERE id = 'gp-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(messages, 2);
        assert_eq!(fts, 2);
        assert_eq!(master_session_id.as_deref(), Some("s-1"));
    }

    #[tokio::test]
    async fn noops_when_no_session_history_exists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let data_dir = tmp.path().join("app.galley");
        fs::create_dir_all(&data_dir).unwrap();
        create_empty_fixture_db(&data_dir.join(DB_FILENAME)).await;

        let outcome = repair_history_from_latest_backup_in(&data_dir)
            .await
            .expect("repair");

        assert_eq!(outcome, HistoryRepairOutcome::NoSessionHistory);
    }

    async fn create_empty_fixture_db(path: &Path) {
        let pool = open_fixture_pool(path).await;
        create_schema(&pool).await;
    }

    async fn create_fixture_db(path: &Path, with_history: bool) {
        let pool = open_fixture_pool(path).await;
        create_schema(&pool).await;
        sqlx::query(
            "INSERT INTO sessions (
               id, title, status, turn_count, last_activity_at, created_at, updated_at
             ) VALUES ('s-1', 'History', 'idle', 1, '2026-06-17T00:00:00Z',
                       '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        if !with_history {
            sqlx::query(
                "INSERT INTO goal_proposals (
                   id, objective, project_id, budget_seconds, worker_limit,
                   runtime_kind, write_mode, status, internal_confirm_token,
                   expires_at, created_at, updated_at, master_session_id
                 ) VALUES (
                   'gp-1', 'Objective', NULL, 60, 1, 'managed', 'autonomous',
                   'started', 'token', '2026-06-17T00:10:00Z',
                   '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z', NULL
                 )",
            )
            .execute(&pool)
            .await
            .unwrap();
            return;
        }
        sqlx::query(
            "INSERT INTO goal_proposals (
               id, objective, project_id, budget_seconds, worker_limit,
               runtime_kind, write_mode, status, internal_confirm_token,
               expires_at, created_at, updated_at, master_session_id
             ) VALUES (
               'gp-1', 'Objective', NULL, 60, 1, 'managed', 'autonomous',
               'started', 'token', '2026-06-17T00:10:00Z',
               '2026-06-17T00:00:00Z', '2026-06-17T00:00:00Z', 's-1'
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO messages (
               id, session_id, turn_index, sequence, role, content, created_at,
               created_via, visibility
             ) VALUES
               ('m-user', 's-1', 0, 0, 'user', 'hello', '2026-06-17T00:00:01Z', 'gui', 'visible'),
               ('m-agent', 's-1', 0, 1, 'assistant', 'hi', '2026-06-17T00:00:02Z', 'gui', 'visible')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO message_attachments (
               id, message_id, session_id, kind, file_path, mime_type,
               byte_size, created_at
             ) VALUES (
               'a-1', 'm-user', 's-1', 'image', '/tmp/a.png',
               'image/png', 1, '2026-06-17T00:00:01Z'
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO tool_events (
               id, session_id, turn_index, tool_name, status, started_at
             ) VALUES ('t-1', 's-1', 0, 'read_file', 'success', '2026-06-17T00:00:02Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    async fn create_schema(pool: &SqlitePool) {
        sqlx::raw_sql(
            "CREATE TABLE sessions (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               status TEXT NOT NULL,
               turn_count INTEGER NOT NULL DEFAULT 0,
               last_activity_at TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE messages (
               id TEXT PRIMARY KEY,
               session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               turn_index INTEGER NOT NULL,
               sequence INTEGER NOT NULL,
               role TEXT NOT NULL,
               content TEXT NOT NULL,
               tool_calls TEXT,
               tool_results TEXT,
               thinking TEXT,
               final_answer TEXT,
               created_at TEXT NOT NULL,
               summary TEXT,
               preamble TEXT,
               created_via TEXT NOT NULL DEFAULT 'gui',
               supervisor TEXT,
               origin_note TEXT,
               visibility TEXT NOT NULL DEFAULT 'visible'
             );
             CREATE TABLE message_attachments (
               id TEXT PRIMARY KEY,
               message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
               session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               kind TEXT NOT NULL,
               file_path TEXT NOT NULL,
               mime_type TEXT NOT NULL,
               byte_size INTEGER NOT NULL,
               width INTEGER,
               height INTEGER,
               created_at TEXT NOT NULL
             );
             CREATE TABLE tool_events (
               id TEXT PRIMARY KEY,
               session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               turn_index INTEGER NOT NULL,
               tool_name TEXT NOT NULL,
               status TEXT NOT NULL,
               args_json TEXT,
               args_preview TEXT,
               result_preview TEXT,
               risk_level TEXT,
               approval_id TEXT,
               approval_decision TEXT,
               elapsed_ms INTEGER,
               started_at TEXT NOT NULL,
               ended_at TEXT
             );
             CREATE TABLE goal_proposals (
               id TEXT PRIMARY KEY,
               objective TEXT NOT NULL,
               project_id TEXT,
               budget_seconds INTEGER NOT NULL,
               worker_limit INTEGER NOT NULL,
               runtime_kind TEXT NOT NULL,
               write_mode TEXT NOT NULL,
               status TEXT NOT NULL,
               internal_confirm_token TEXT NOT NULL,
               expires_at TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               master_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL
             );
             CREATE VIRTUAL TABLE messages_fts USING fts5(
               message_id UNINDEXED,
               session_id UNINDEXED,
               role UNINDEXED,
               turn_index UNINDEXED,
               body,
               tokenize = 'trigram case_sensitive 0'
             );",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn open_fixture_pool(path: &Path) -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true),
            )
            .await
            .unwrap()
    }
}
