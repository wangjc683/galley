-- 035_scheduled_tasks.sql · Scheduled tasks (desktop recurring sessions)
-- A scheduled task is "project + prompt + repeat rule + enabled switch".
-- Firing creates an ordinary session through the existing command path;
-- there is no special session type. Galley Core owns these rows.
--
-- time_of_day is LOCAL wall clock ('HH:MM'): "every day at 09:00" must
-- follow the user across timezone changes, so the local rule is the
-- source of truth and instants are derived at fire time. last_fired_at
-- is a UTC ISO instant like every other timestamp column.

CREATE TABLE scheduled_tasks (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT REFERENCES projects(id) ON DELETE SET NULL,
  prompt               TEXT NOT NULL,
  repeat_kind          TEXT NOT NULL CHECK (repeat_kind IN ('daily','weekly')),
  -- CSV of ISO weekday numbers 1-7 (Mon=1), sorted, deduped. NULL unless
  -- repeat_kind = 'weekly'.
  weekdays             TEXT,
  time_of_day          TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  last_fired_at        TEXT,
  last_run_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX scheduled_tasks_by_enabled
  ON scheduled_tasks(enabled, updated_at DESC);
