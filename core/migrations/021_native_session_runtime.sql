-- 021_native_session_runtime.sql · Galley Native Slice 2
--
-- Slice 2 opens only persisted native sessions. Goal runtime CHECKs stay
-- managed/external until native Goal Hive has its own event bus and worker
-- lifecycle.

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS sessions_by_last_activity;
DROP INDEX IF EXISTS sessions_by_project;
DROP INDEX IF EXISTS sessions_by_runtime_last_activity;

CREATE TABLE sessions_new (
  id                       TEXT PRIMARY KEY,
  project_id               TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title                    TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
    ('idle','connecting','running','waiting_approval','error',
     'completed','cancelled','archived')),
  summary                  TEXT,
  turn_count               INTEGER NOT NULL DEFAULT 0,
  current_tool             TEXT,
  pending_approval_count   INTEGER NOT NULL DEFAULT 0,
  error_count              INTEGER NOT NULL DEFAULT 0,
  pid                      INTEGER,
  cwd                      TEXT,
  pinned                   INTEGER NOT NULL DEFAULT 0,
  llm_index                INTEGER,
  llm_display_name         TEXT,
  last_activity_at         TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  has_unread               INTEGER NOT NULL DEFAULT 0,
  created_via              TEXT NOT NULL DEFAULT 'gui'
    CHECK (created_via IN ('gui', 'cli', 'supervisor', 'system')),
  created_by_supervisor    TEXT,
  created_origin_note      TEXT,
  ga_runtime_kind          TEXT NOT NULL DEFAULT 'external'
    CHECK (ga_runtime_kind IN ('managed', 'external', 'galley_native')),
  ga_runtime_id            TEXT,
  prompt_profile           TEXT,
  llm_key                  TEXT
);

INSERT INTO sessions_new (
  id, project_id, title, status, summary, turn_count,
  current_tool, pending_approval_count, error_count, pid, cwd, pinned,
  llm_index, llm_display_name, last_activity_at, created_at, updated_at,
  has_unread, created_via, created_by_supervisor, created_origin_note,
  ga_runtime_kind, ga_runtime_id, prompt_profile, llm_key
)
SELECT
  id, project_id, title, status, summary, turn_count,
  current_tool, pending_approval_count, error_count, pid, cwd, pinned,
  llm_index, llm_display_name, last_activity_at, created_at, updated_at,
  has_unread, created_via, created_by_supervisor, created_origin_note,
  ga_runtime_kind, ga_runtime_id, prompt_profile, llm_key
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX sessions_by_last_activity
  ON sessions(last_activity_at DESC);

CREATE INDEX sessions_by_project
  ON sessions(project_id, last_activity_at DESC);

CREATE INDEX sessions_by_runtime_last_activity
  ON sessions(ga_runtime_kind, last_activity_at DESC);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
