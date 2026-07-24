-- 036_scheduled_tasks_monthly.sql · Add the monthly repeat kind.
-- SQLite cannot widen a CHECK constraint in place, so rebuild the
-- table; the day-set column is renamed weekdays → repeat_days now that
-- it also carries month days (1-31) for repeat_kind = 'monthly'.
-- Copy-then-rename keeps rows created under 035 intact.

CREATE TABLE scheduled_tasks_new (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT REFERENCES projects(id) ON DELETE SET NULL,
  prompt               TEXT NOT NULL,
  repeat_kind          TEXT NOT NULL CHECK (repeat_kind IN ('daily','weekly','monthly')),
  -- CSV day set, sorted, deduped. weekly: ISO weekdays 1-7 (Mon=1);
  -- monthly: month days 1-31 (short months clamp to their last day at
  -- fire time). NULL for daily.
  repeat_days          TEXT,
  time_of_day          TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  last_fired_at        TEXT,
  last_run_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

INSERT INTO scheduled_tasks_new
  SELECT id, project_id, prompt, repeat_kind, weekdays, time_of_day,
         enabled, last_fired_at, last_run_session_id, created_at, updated_at
  FROM scheduled_tasks;

DROP TABLE scheduled_tasks;
ALTER TABLE scheduled_tasks_new RENAME TO scheduled_tasks;

CREATE INDEX scheduled_tasks_by_enabled
  ON scheduled_tasks(enabled, updated_at DESC);
