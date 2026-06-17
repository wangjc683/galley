-- 023_native_goal_runtime.sql · Galley Native Slice 7
-- Allow hidden native Goal rows behind the runtime gate. This rebuild keeps
-- the current post-019 table shape while widening only the runtime CHECKs.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS goal_proposals_by_status;
DROP INDEX IF EXISTS goals_by_status;
DROP INDEX IF EXISTS goals_by_project;
DROP INDEX IF EXISTS goals_by_master_session;
DROP INDEX IF EXISTS goals_visible_unseen_results;

CREATE TABLE goal_proposals_new (
  id                       TEXT PRIMARY KEY,
  objective                TEXT NOT NULL,
  project_id               TEXT REFERENCES projects(id) ON DELETE SET NULL,
  budget_seconds           INTEGER NOT NULL,
  worker_limit             INTEGER NOT NULL,
  runtime_kind             TEXT NOT NULL CHECK (runtime_kind IN ('managed','external','galley_native')),
  write_mode               TEXT NOT NULL CHECK (write_mode IN ('autonomous','read_only')),
  status                   TEXT NOT NULL CHECK (status IN ('awaiting_confirmation','started','cancelled')),
  internal_confirm_token   TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  master_session_id        TEXT REFERENCES sessions(id) ON DELETE SET NULL
);

INSERT INTO goal_proposals_new (
  id, objective, project_id, budget_seconds, worker_limit, runtime_kind,
  write_mode, status, internal_confirm_token, expires_at, created_at,
  updated_at, master_session_id
)
SELECT
  id, objective, project_id, budget_seconds, worker_limit, runtime_kind,
  write_mode, status, internal_confirm_token, expires_at, created_at,
  updated_at, master_session_id
FROM goal_proposals;

DROP TABLE goal_proposals;
ALTER TABLE goal_proposals_new RENAME TO goal_proposals;

CREATE TABLE goals_new (
  id                  TEXT PRIMARY KEY,
  proposal_id         TEXT REFERENCES goal_proposals(id) ON DELETE SET NULL,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  workspace_path      TEXT
);

INSERT INTO goals_new (
  id, proposal_id, project_id, objective, status, budget_seconds,
  worker_limit, runtime_kind, write_mode, started_at, deadline_at,
  ended_at, latest_summary, stop_requested, created_at, updated_at,
  master_session_id, result_seen_at, workspace_path
)
SELECT
  id, proposal_id, project_id, objective, status, budget_seconds,
  worker_limit, runtime_kind, write_mode, started_at, deadline_at,
  ended_at, latest_summary, stop_requested, created_at, updated_at,
  master_session_id, result_seen_at, workspace_path
FROM goals;

DROP TABLE goals;
ALTER TABLE goals_new RENAME TO goals;

CREATE INDEX goal_proposals_by_status
  ON goal_proposals(status, expires_at DESC);

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

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
