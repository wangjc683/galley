-- 053_memos.sql · The memo: what Galley knows about the user
-- (.scratch/main-chat/issues/95-memo-core-and-cli.md; main chat PRD
-- rulings 140, 141, 143).
--
-- A to-do records something to do (050); a memo records something
-- known: what the user is called, their family, what they prefer or
-- avoid, the people and places they deal with, an interest that keeps
-- coming up ("看你这周常问 76 人"). It does not get done, it only holds
-- or stops holding, and one that will stop on a day carries that day.
-- Galley writes it in the turn it learns it (`galley memo`, the CLI),
-- Core puts the memos at the start of every main chat segment, and the
-- user can only delete one on the desktop.
--
-- `memos`:
--   - id: `memo_<16 hex>`, minted by Core, as a to-do's `todo_`.
--   - text: 1 to 100 characters once trimmed (Core checks; ruling 141).
--   - until_date: 'YYYY-MM-DD' or NULL, the last day the memo holds. A
--     floating local date, as todos.due_date: read in this machine's
--     zone. Once that day is over the memo is in no reader (the segment
--     start, `memo list`, the panel, the total Core counts) and the row
--     stays: Core deletes nothing of the user's on its own.
--   - created_via / created_by_supervisor / created_origin_note: who
--     noted it, the origin triple of 007, 049 and 050.
--   - created_in_session_id / created_in_run_turn /
--     created_in_turn_index: the main chat turn Galley noted it in, as
--     050 records it for a to-do: run_turn when the CLI call comes in,
--     turn_index (the reply) when that run ends.
--   - fresh_at: UTC ISO, the last time it was noted or changed in a
--     turn the user started — a run of the main chat whose opening user
--     row Galley did not write (its `created_via` is not 'system': not a
--     morning review's, a reminder's or a subtask's wake). NULL while it
--     never was (written in a wake's turn, outside a main chat run, by
--     another agent). The morning review wakes for the memos whose
--     fresh_at falls in its window (ruling 143); a memo Galley writes
--     while it wakes does not wake it again the next morning.
--   - created_at, updated_at: updated_at moves with every change of its
--     text or its day, and nothing else.
--
-- `memo_events`: one row per add, update and delete, kept when the memo
-- is deleted: the cards under the replies read them (「记下了 · …」,
-- 「改为 · …」, 「不再记 · …」).
--   - id: in the order they were written.
--   - memo_id: no foreign key, on purpose: a delete removes the memo and
--     keeps its events.
--   - action: 'add', 'update' or 'delete'.
--   - text / until_date: the memo after the action; for a delete, as it
--     was before it.
--   - via / supervisor / origin_note: who wrote it (the triple again):
--     'gui' is the user at the desktop.
--   - session_id / run_turn / turn_index: where, as for the memo's own
--     created_in_* (NULL for the desktop's delete and for a write
--     outside a main chat run).
--
-- Deleting a memo deletes its row. Resetting the main chat deletes both
-- tables' rows, as it does the to-dos: what Galley learned in that
-- conversation goes with it.

CREATE TABLE memos (
  id                     TEXT PRIMARY KEY,
  text                   TEXT NOT NULL CHECK (text <> ''),
  until_date             TEXT,
  created_via            TEXT NOT NULL
                         CHECK (created_via IN ('gui','cli','supervisor','system')),
  created_by_supervisor  TEXT,
  created_origin_note    TEXT,
  created_in_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_in_run_turn    INTEGER,
  created_in_turn_index  INTEGER,
  fresh_at               TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE memo_events (
  id           INTEGER PRIMARY KEY,
  memo_id      TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('add','update','delete')),
  text         TEXT NOT NULL,
  until_date   TEXT,
  via          TEXT NOT NULL CHECK (via IN ('gui','cli','supervisor','system')),
  supervisor   TEXT,
  origin_note  TEXT,
  session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  run_turn     INTEGER,
  turn_index   INTEGER,
  created_at   TEXT NOT NULL
);

CREATE INDEX memo_events_by_session
  ON memo_events(session_id, turn_index)
  WHERE session_id IS NOT NULL;

CREATE INDEX memo_events_by_memo
  ON memo_events(memo_id);
