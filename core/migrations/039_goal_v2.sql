-- 039_goal_v2.sql · Goal v2: one persistent objective on a session
--
-- Goal is no longer a master + worker fleet driven by a detached CLI
-- controller (.scratch/goal-simplify/PRD.md). A goal now hangs off ONE
-- session: Core re-dispatches a continuation whenever that session goes
-- idle, the model declares completion (or a blocker) itself, and the time
-- budget is a ceiling rather than a target. Everything the hive engine
-- needed — proposals with confirm tokens, the task board, the event
-- stream, deliverable anchors, worker limits, write modes, workspaces —
-- is retired here.
--
-- Data carried over: every goal row that had a master session survives
-- as a v2 row on that session so the in-thread commission / terminal
-- markers of finished runs still render. Rows caught mid-run by the
-- upgrade (running / wrapping) cannot be resumed — the engine that drove
-- them is gone — so they land as `stopped`, already marked seen so the
-- upgrade does not raise a "result to review" prompt for them. Rows with
-- no master session (headless CLI goals) have no thread to render into
-- and are dropped. `messages.goal_id` (031) is untouched: it is the id
-- the commission marker matches on and it never carried an FK.
--
-- Table-rebuild safety: the child tables are dropped BEFORE the old
-- `goals` table, and nothing else references `goals(id)` with an FK, so
-- the implicit DELETE that DROP TABLE performs under foreign_keys=ON has
-- nothing to cascade into. This migration therefore runs under SQLx's
-- ordinary migration transaction and does not extend the safe-rebuild
-- preflight boundary (SAFE_REBUILD_PREFLIGHT_MAX_VERSION stays at 033).

DROP TABLE IF EXISTS goal_deliverables;
DROP TABLE IF EXISTS goal_events;
DROP TABLE IF EXISTS goal_tasks;

DROP INDEX IF EXISTS goals_by_status;
DROP INDEX IF EXISTS goals_by_project;
DROP INDEX IF EXISTS goals_by_master_session;
DROP INDEX IF EXISTS goals_visible_unseen_results;
DROP INDEX IF EXISTS goals_single_active;

CREATE TABLE goals_v2 (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  objective           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN
    ('active','paused','blocked','completed','budget_limited','stopped','failed')),
  -- NULL = no time ceiling.
  budget_seconds      INTEGER,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  paused_at           TEXT,
  latest_summary      TEXT,
  result_seen_at      TEXT,
  continuation_count  INTEGER NOT NULL DEFAULT 0,
  wrap_up_dispatched  INTEGER NOT NULL DEFAULT 0,
  created_via         TEXT NOT NULL DEFAULT 'system',
  supervisor          TEXT,
  origin_note         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

INSERT INTO goals_v2 (
  id, session_id, objective, status, budget_seconds, started_at, ended_at,
  paused_at, latest_summary, result_seen_at, continuation_count,
  wrap_up_dispatched, created_via, supervisor, origin_note, created_at,
  updated_at
)
SELECT
  id,
  master_session_id,
  objective,
  CASE WHEN status IN ('running', 'wrapping') THEN 'stopped' ELSE status END,
  budget_seconds,
  started_at,
  CASE WHEN status IN ('running', 'wrapping') THEN COALESCE(ended_at, updated_at)
       ELSE ended_at END,
  NULL,
  latest_summary,
  CASE WHEN status IN ('running', 'wrapping') THEN COALESCE(result_seen_at, updated_at)
       ELSE result_seen_at END,
  0,
  0,
  'system',
  NULL,
  NULL,
  created_at,
  updated_at
FROM goals
WHERE master_session_id IS NOT NULL;

DROP TABLE goals;
ALTER TABLE goals_v2 RENAME TO goals;

-- Proposals were only ever a handshake for the retired confirm-token
-- flow. Dropped after `goals` so the old goals.proposal_id FK is gone
-- before its parent disappears.
DROP TABLE IF EXISTS goal_proposals;

CREATE INDEX goals_by_session
  ON goals(session_id, started_at ASC);

-- One open goal per session. Replaces 030's global single-active lock:
-- a v2 goal is a single continuation loop with nothing to contend for,
-- so sessions may each carry their own.
CREATE UNIQUE INDEX goals_one_open_per_session
  ON goals(session_id)
  WHERE status IN ('active', 'paused', 'blocked');

CREATE INDEX goals_visible_unseen_results
  ON goals(status, result_seen_at, updated_at DESC)
  WHERE status IN ('completed', 'budget_limited', 'stopped', 'failed');
