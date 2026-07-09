-- 033_goal_optional_project.sql · Solo Goal without a project
-- A solo Goal launched outside a project stays project-less (like a plain
-- session) instead of minting a "Goal · X" project. That needs
-- goals.project_id to be nullable, which SQLite only allows via a table
-- rebuild — same pattern as 023. Shape is post-032 (023 columns + mode);
-- only the project_id constraint changes: NOT NULL + ON DELETE CASCADE
-- becomes nullable + ON DELETE SET NULL (deleting a project orphans its
-- goals rather than destroying their history).
--
-- DATA SAFETY: this rebuild MUST run through the safe-rebuild preflight
-- (core/src/migration_backup.rs) on a foreign_keys=OFF connection. Inside
-- SQLx's migration transaction the PRAGMA below is a no-op and DROP TABLE
-- goals would cascade-delete goal_tasks / goal_events / goal_deliverables.
-- SAFE_REBUILD_PREFLIGHT_MAX_VERSION covers this migration.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS goals_by_status;
DROP INDEX IF EXISTS goals_by_project;
DROP INDEX IF EXISTS goals_by_master_session;
DROP INDEX IF EXISTS goals_visible_unseen_results;
DROP INDEX IF EXISTS goals_single_active;

CREATE TABLE goals_new (
  id                  TEXT PRIMARY KEY,
  proposal_id         TEXT REFERENCES goal_proposals(id) ON DELETE SET NULL,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  objective           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN
    ('running','wrapping','completed','stopped','failed')),
  budget_seconds      INTEGER NOT NULL,
  worker_limit        INTEGER NOT NULL,
  runtime_kind        TEXT NOT NULL CHECK (runtime_kind IN ('managed','external','galley_native')),
  write_mode          TEXT NOT NULL CHECK (write_mode IN ('autonomous','read_only')),
  started_at          TEXT NOT NULL,
  deadline_at         TEXT NOT NULL,
  ended_at            TEXT,
  latest_summary      TEXT,
  stop_requested      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  master_session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  result_seen_at      TEXT,
  workspace_path      TEXT,
  mode                TEXT NOT NULL DEFAULT 'hive'
    CHECK (mode IN ('hive', 'solo'))
);

INSERT INTO goals_new (
  id, proposal_id, project_id, objective, status, budget_seconds,
  worker_limit, runtime_kind, write_mode, started_at, deadline_at,
  ended_at, latest_summary, stop_requested, created_at, updated_at,
  master_session_id, result_seen_at, workspace_path, mode
)
SELECT
  id, proposal_id, project_id, objective, status, budget_seconds,
  worker_limit, runtime_kind, write_mode, started_at, deadline_at,
  ended_at, latest_summary, stop_requested, created_at, updated_at,
  master_session_id, result_seen_at, workspace_path, mode
FROM goals;

DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;

CREATE INDEX goals_by_status
  ON goals(status, deadline_at ASC);

CREATE INDEX goals_by_project
  ON goals(project_id, status);

CREATE INDEX goals_by_master_session
  ON goals(master_session_id, status)
  WHERE master_session_id IS NOT NULL;

CREATE INDEX goals_visible_unseen_results
  ON goals(status, result_seen_at, updated_at DESC)
  WHERE status IN ('completed','failed');

-- 030's single-active lock: at most one running/wrapping Goal.
CREATE UNIQUE INDEX goals_single_active
  ON goals((1))
  WHERE status IN ('running', 'wrapping');

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
