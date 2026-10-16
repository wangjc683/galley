-- 050_todos.sql · The to-do record: Galley's notebook of the user's own
-- things to do (.scratch/main-chat/issues/39-todo-core.md; main chat PRD
-- ruling 91).
--
-- Galley notes a to-do in the conversation ("周三下午 3 点前要交季度报告"),
-- through the CLI; the user can only tick it off, untick it, or cancel its
-- reminder from the desktop. A to-do is not a scheduled task: it is
-- something the user has to do, which may have a due date and may carry a
-- reminder. The reminder is a scheduled task (049: a one-off that wakes the
-- assistant), linked from the task's side (`scheduled_tasks.todo_id`).
--
-- `todos`:
--   - id: `todo_<16 hex>`, minted by Core.
--   - title (required), notes (optional).
--   - The due date, at most one of two forms (Core reads them in this
--     machine's zone):
--       due_date  'YYYY-MM-DD', a calendar day with no time ("by Friday").
--                 A floating local date: it stays Friday wherever the
--                 computer is, as a repeating task's time_of_day does.
--       due_at    a UTC ISO instant, when it has a time of day ("Wednesday
--                 3 pm"): an instant, as a one-off's fire_at is.
--     Neither: no due date.
--   - Its state is read off two stamps, as a scheduled task's is: open
--     while both are NULL; done when done_at is set; cancelled (a soft
--     delete, as 049's cancelled_at) when cancelled_at is set — whatever
--     done_at says. done_via / done_by_supervisor / done_origin_note say
--     who ticked it off: 'gui' is the user at the desktop, 'supervisor' +
--     'galley-assistant' is Galley through the CLI (the origin triple of
--     007 and 049). Unticking clears all four.
--   - created_via / created_by_supervisor / created_origin_note: who made
--     it (the same triple).
--   - created_in_session_id / created_in_run_turn / created_in_turn_index:
--     the main chat turn Galley noted it in, as 049 records it for tasks:
--     run_turn when the CLI call comes in, turn_index (the reply its card
--     hangs under) when that run ends. A deleted main chat leaves them
--     NULL (SET NULL); resetting the main chat deletes every to-do anyway.
--
-- `scheduled_tasks.todo_id`: the to-do a task reminds the user of. Core
-- keeps at most one task per to-do not cancelled (its reminder); setting
-- a new time updates that task, removing it cancels it, and ticking off
-- or cancelling the to-do cancels it while it has not reached the
-- assistant. A task without one (NULL) is the assistant's own: a
-- reminder to come back to something, or a routine.
--
-- No foreign key on todo_id, on purpose. Rebuilding either table later
-- drops it, and with foreign keys on (sqlx's default, also inside
-- migrations, where the pragma cannot be switched off) a DROP TABLE runs
-- the ON DELETE action on every row that points at it: SET NULL would cut
-- every reminder loose from its to-do, CASCADE would delete them. Core
-- keeps the link: to-dos are never deleted but by a main chat reset,
-- which deletes their tasks in the same transaction.

CREATE TABLE todos (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  notes                  TEXT,
  due_date               TEXT,
  due_at                 TEXT,
  done_at                TEXT,
  done_via               TEXT CHECK (done_via IN ('gui','cli','supervisor','system')),
  done_by_supervisor     TEXT,
  done_origin_note       TEXT,
  cancelled_at           TEXT,
  created_via            TEXT NOT NULL
                         CHECK (created_via IN ('gui','cli','supervisor','system')),
  created_by_supervisor  TEXT,
  created_origin_note    TEXT,
  created_in_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_in_run_turn    INTEGER,
  created_in_turn_index  INTEGER,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  CHECK (due_date IS NULL OR due_at IS NULL),
  CHECK ((done_at IS NULL) = (done_via IS NULL))
);

CREATE INDEX todos_by_created_in
  ON todos(created_in_session_id)
  WHERE created_in_session_id IS NOT NULL;

ALTER TABLE scheduled_tasks ADD COLUMN todo_id TEXT;

CREATE INDEX scheduled_tasks_by_todo
  ON scheduled_tasks(todo_id)
  WHERE todo_id IS NOT NULL;
