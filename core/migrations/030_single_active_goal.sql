-- 030_single_active_goal.sql · Goal single-instance lock
-- Galley treats a Goal as a heavy, one-at-a-time operation: at most one
-- Goal may be active (running or wrapping) at a time. This partial unique
-- index enforces that at the DB level, independent of any application-layer
-- check, so a concurrency race between two starts cannot both win.
--
-- The index key is the constant expression (1): every active-status row maps
-- to the same key, so UNIQUE permits at most one such row. A running->wrapping
-- transition updates the same row (rowid unchanged) and does not conflict;
-- completed/stopped/failed rows drop out of the partial predicate and free
-- the slot immediately.
CREATE UNIQUE INDEX IF NOT EXISTS goals_single_active
  ON goals((1))
  WHERE status IN ('running', 'wrapping');
