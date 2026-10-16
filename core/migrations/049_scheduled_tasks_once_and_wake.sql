-- 049_scheduled_tasks_once_and_wake.sql · One-off tasks, "wake the
-- assistant", who made a task and where, soft cancel
-- (.scratch/main-chat/issues/33-schedule-once-and-wake.md; assistant PRD
-- ruling 9, main chat PRD ruling 84).
--
-- The assistant sets reminders by itself: "remind me in ten minutes" is a
-- one-off task whose fire wakes the main chat for a turn, carrying the
-- words it noted. SQLite cannot widen the repeat_kind CHECK in place, so
-- the table is rebuilt as in 036; every row created before keeps its
-- values and reads as before: target 'session', created by 'gui'.
--
-- New and changed columns:
--   - repeat_kind gains 'once'. A one-off fires at `fire_at`, a UTC ISO
--     instant; `time_of_day` and `repeat_days` mean nothing for it and
--     stay NULL (time_of_day is NOT NULL for every repeating kind).
--   - target: what a fire does. 'session' starts a new session that runs
--     the prompt (the only behavior before 049); 'assistant' starts no
--     session and wakes the main chat with the prompt instead.
--   - created_via / created_by_supervisor / created_origin_note: who made
--     the task, the origin triple `sessions` has (007): 'gui' for the
--     desktop form, 'supervisor' + 'galley-assistant' for the assistant
--     through the CLI, an external agent's own label otherwise.
--   - created_in_session_id / created_in_run_turn / created_in_turn_index:
--     the main chat turn the assistant made it in, for the card under its
--     reply. run_turn is the turn of the user row that started that run,
--     recorded when the CLI call comes in; turn_index is the reply's,
--     filled when that run ends. NULL for tasks not made in a main chat
--     run. A deleted main chat leaves them NULL (SET NULL).
--   - last_due_at: the planned instant of the last fire (fire_at for a
--     one-off; for a repeating task the period it consumed), so a wake
--     can say how late it is even after a restart.
--   - last_wake: how the last fire of an 'assistant' task reached the
--     main chat: 'pending' (fired, not yet confirmed delivered — what a
--     restart sends again), 'delivered', or 'notified' (could not be
--     delivered; the desktop showed a system notification with the
--     prompt instead). NULL for 'session' tasks and before a first fire.
--   - cancelled_at: a soft delete. Cancelling or deleting keeps the row,
--     so a card can say "cancelled"; the scheduler and the default lists
--     skip it.
--
-- No table references scheduled_tasks, so the rebuild cascades nothing.

CREATE TABLE scheduled_tasks_new (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT REFERENCES projects(id) ON DELETE SET NULL,
  prompt                 TEXT NOT NULL,
  repeat_kind            TEXT NOT NULL
                         CHECK (repeat_kind IN ('daily','weekly','monthly','once')),
  -- CSV day set, sorted, deduped. weekly: ISO weekdays 1-7 (Mon=1);
  -- monthly: month days 1-31. NULL for daily and once.
  repeat_days            TEXT,
  -- Local wall clock 'HH:MM' for the repeating kinds; NULL for once.
  time_of_day            TEXT,
  -- UTC ISO instant; once only.
  fire_at                TEXT,
  enabled                INTEGER NOT NULL DEFAULT 1,
  last_fired_at          TEXT,
  last_run_session_id    TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  llm_name               TEXT,
  target                 TEXT NOT NULL DEFAULT 'session'
                         CHECK (target IN ('session','assistant')),
  created_via            TEXT NOT NULL DEFAULT 'gui'
                         CHECK (created_via IN ('gui','cli','supervisor','system')),
  created_by_supervisor  TEXT,
  created_origin_note    TEXT,
  created_in_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_in_run_turn    INTEGER,
  created_in_turn_index  INTEGER,
  last_due_at            TEXT,
  last_wake              TEXT CHECK (last_wake IN ('pending','delivered','notified')),
  cancelled_at           TEXT,
  CHECK ((repeat_kind = 'once') = (fire_at IS NOT NULL)),
  CHECK (repeat_kind = 'once' OR time_of_day IS NOT NULL)
);

INSERT INTO scheduled_tasks_new
  (id, project_id, prompt, repeat_kind, repeat_days, time_of_day, enabled,
   last_fired_at, last_run_session_id, created_at, updated_at, llm_name)
  SELECT id, project_id, prompt, repeat_kind, repeat_days, time_of_day, enabled,
         last_fired_at, last_run_session_id, created_at, updated_at, llm_name
  FROM scheduled_tasks;

DROP TABLE scheduled_tasks;
ALTER TABLE scheduled_tasks_new RENAME TO scheduled_tasks;

CREATE INDEX scheduled_tasks_by_enabled
  ON scheduled_tasks(enabled, updated_at DESC);

-- Restart recovery reads the fired-but-unconfirmed reminders.
CREATE INDEX scheduled_tasks_pending_wake
  ON scheduled_tasks(last_wake)
  WHERE last_wake = 'pending';
