-- 045_ledger_exclusions.sql · "not used to understand me" marks
-- (.scratch/main-chat/issues/01-affairs-ledger.md)
--
-- The affairs ledger (core/src/ledger/) reads what the human said in
-- GUI sessions. A row here takes one session, or every session of one
-- project, out of that reading. Exactly one target per row; the row
-- goes with its session / project when that is deleted. No row = read.
--
-- Its own table rather than a column on sessions / projects: the mark
-- belongs to the ledger, which is switched off on every machine without
-- GALLEY_LEDGER_SINCE, and `created_at` lets the page of ticket 04 say
-- since when. Numbered 045: ticket 02 lands 044 in parallel.
CREATE TABLE ledger_exclusions (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  CHECK ((session_id IS NULL) <> (project_id IS NULL))
);

CREATE UNIQUE INDEX ledger_exclusions_by_session
  ON ledger_exclusions(session_id) WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX ledger_exclusions_by_project
  ON ledger_exclusions(project_id) WHERE project_id IS NOT NULL;
