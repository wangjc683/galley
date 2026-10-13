-- 048_subtasks.sql · subtasks the main chat dispatches
-- (.scratch/main-chat/issues/06a-subtask-dispatch-and-cards.md, PRD rulings
-- 52, 53)
--
-- The main chat ends a reply with `<subtask>what to do</subtask>`; Core
-- starts each tag as a subtask: an ordinary managed session whose first
-- user message is the instructions. It is not a side chat yet — it shows
-- as a card under that reply, not in the sidebar — until the user says
-- something in it from the desktop or the phone, which promotes it to an
-- ordinary conversation.
--
-- On the session:
--   - `parent_session_id`: the main chat that dispatched it. Set once, at
--     creation, and never cleared by Galley; a deleted parent leaves the
--     subtask an ordinary conversation (SET NULL).
--   - `promoted_at`: when the user first wrote in it (NULL until then).
--
-- `subtask_dispatches` records what each reply asked for, one row per
-- tag in reply order, including the tags that started nothing (`failure`
-- names why: `empty`, `unclosed`, `start_failed`). The cards and the
-- history replay's markers read it; it is written once, when the reply's
-- run ends, and the primary key makes a second attempt for the same reply
-- a no-op. `session_id` is NULL when no session was created; with
-- `failure = 'start_failed'` and a `session_id`, the row exists but its
-- runner did not start. The reply is the assistant row
-- `msg_{parent_session_id}_{turn_index}_assistant`.
--
-- The subtask's origin is stored as `created_via = 'system'` with the
-- reserved supervisor label `galley-subtask` (Core reads it back as
-- `via: "subtask"`): the CHECK on `created_via` (006, 007, 021) names four
-- values, and a fifth would mean rebuilding `sessions` and `messages`,
-- the cascade hazard the 021 / 023 / 033 preflight exists for.
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT
  REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN promoted_at TEXT;

CREATE INDEX IF NOT EXISTS sessions_by_parent
  ON sessions(parent_session_id)
  WHERE parent_session_id IS NOT NULL;

CREATE TABLE subtask_dispatches (
  parent_session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index         INTEGER NOT NULL,
  ordinal            INTEGER NOT NULL,
  session_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  failure            TEXT CHECK (failure IN ('empty', 'unclosed', 'start_failed')),
  failure_detail     TEXT,
  created_at         TEXT NOT NULL,
  PRIMARY KEY (parent_session_id, turn_index, ordinal)
);

CREATE INDEX IF NOT EXISTS subtask_dispatches_by_session
  ON subtask_dispatches(session_id)
  WHERE session_id IS NOT NULL;
