-- 054_todo_subitems.sql · The items under a to-do (main chat ticket 111;
-- PRD ruling 157): one level, each only its words and a box, no due date
-- and no reminder ("订酒店", "订机票", "换港币" under 「下周三去上海出差」).
-- The user and Galley both add them, tick them and untick them; ticking
-- the last one does not tick the to-do off, and ticking the to-do off
-- touches none of them (ruling 157 point 4). The desktop says no noun for
-- them (「添加一项」, 「2/5 项」); the CLI calls one an `item`; in Core's
-- code it is a sub-item, as `TodoItem` is the to-do list's row and
-- `Subtask` a conversation the main chat dispatched.
--
-- `todo_subitems`, a table of their own and not a column on `todos`: each
-- has its own id for the CLI's `todo item done <item-id>`, its own box
-- written alone (the user's tick and Galley's change to another item
-- never meet in one read-modify-write), and its own done stamps in the
-- columns `todos` keeps them in, with the same CHECK:
--   - id: `item_<16 hex>`, minted by Core.
--   - todo_id: the to-do it is under.
--   - text: one line, not empty (Core trims it and makes a line break one
--     space).
--   - position: its place under its to-do, the order it was added in, the
--     user's and Galley's mixed (ruling 157 point 7). Core appends at the
--     largest plus one; nothing reorders (the panel has no drag).
--   - done_at / done_via / done_by_supervisor / done_origin_note: ticked,
--     and who ticked it, as on `todos` (050): 'gui' is the user at the
--     desktop, 'supervisor' + 'galley-assistant' is Galley through the
--     CLI. Unticking clears all four.
--   - created_at (when it was added), updated_at.
-- Who added one is not kept: the list draws Galley's and the user's in
-- one column (ruling 157 point 7), and nothing reads it.
--
-- Every write of an item also stamps its to-do's `updated_at`: the
-- morning review reads that to know the to-do moved (ruling 157 point 8,
-- ruling 155), as it does for a change to the notes.
--
-- No foreign key on todo_id, for the reason 050 gives for
-- `scheduled_tasks.todo_id`: rebuilding `todos` later drops it, and with
-- foreign keys on a DROP TABLE runs the ON DELETE action on every row
-- that points at it (CASCADE would delete every item). Core keeps the
-- link: a to-do is deleted only by a main chat reset, which deletes every
-- item in the same transaction; a cancelled to-do (a soft delete) keeps
-- its items with its row, gone for every write as it is.

CREATE TABLE todo_subitems (
  id                  TEXT PRIMARY KEY,
  todo_id             TEXT NOT NULL,
  text                TEXT NOT NULL CHECK (length(trim(text)) > 0),
  position            INTEGER NOT NULL,
  done_at             TEXT,
  done_via            TEXT CHECK (done_via IN ('gui','cli','supervisor','system')),
  done_by_supervisor  TEXT,
  done_origin_note    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK ((done_at IS NULL) = (done_via IS NULL))
);

CREATE INDEX todo_subitems_by_todo ON todo_subitems(todo_id, position);
