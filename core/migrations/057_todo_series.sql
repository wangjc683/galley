-- 057_todo_series.sql · Repeating to-dos: a rule and its current period
-- (main chat ticket 154; PRD rulings 204 and 202).
--
-- A report due every Monday (「交周报」) is a to-do (ruling 92: ignore this
-- time's reminder, and it still belongs on the list), but a to-do record
-- had no room for a rule. Now the rule is kept on its own, and at any
-- time there is at most one period of it not settled: an ordinary to-do,
-- with its box, items, notes, reminder and card as any other. When that period is
-- ticked off or skipped, Core makes the next one from the rule in the
-- same transaction that settles it: no timer, no model call. A computer
-- off for three days finds the period still there, overdue.
--
-- `todo_series`, one row per rule:
--   - id: `series_<16 hex>`, minted by Core.
--   - What the next period carries: title (required), notes (optional),
--     items (optional: a JSON array of strings, each an item's words, in
--     order; the next period gets them all unticked). Taken from the
--     to-do as it stood when the rule was made, and again only when told
--     to (`todo update --series`): changing a period changes that period
--     alone, and its notes, where the progress of that period goes, are
--     carried into the rule only when given in that same command.
--   - The rule:
--       repeat_kind   'daily' / 'weekly' / 'monthly' / 'yearly'.
--       repeat_every  every N of them, at least 1 (a quarter is monthly
--                     every 3).
--       repeat_days   comma-separated: ISO weekdays 1–7 (1 is Monday) for
--                     weekly, days of the month 1–31 for monthly (a month
--                     without that day takes its last day, as a
--                     scheduled task's monthly rule does); NULL for daily
--                     and yearly.
--       anchor_date   'YYYY-MM-DD': the day the every-N phase counts
--                     from (daily: anchor + k·N days; weekly: the ISO
--                     weeks N apart from the anchor's; monthly: the
--                     months N apart from the anchor's; yearly: the
--                     anchor's month and day, every N years, Feb 29
--                     falling on Feb 28 in a common year). The first
--                     period's due date when the rule is made; the
--                     period's due date when the rule is changed, or when
--                     `--series` comes with a new `--due`.
--       time_of_day   'HH:MM' local, when the periods are due at a time of
--                     day (stored on each period as due_at); NULL when
--                     they are due on a day (due_date).
--   - The reminder each period gets: remind_days_before (an integer: how
--     many days before the due day, 0 the same day) and remind_time
--     ('HH:MM' local), both set or both NULL. A period whose reminder
--     time has already passed when it is made gets none.
--   - ended_at, and ended_via / ended_by_supervisor / ended_origin_note:
--     the rule ended, and who ended it (the origin triple, as 051's
--     cancelled_*): `todo update --no-repeat` and the desktop's 「不再重复」
--     (the period stays, an ordinary to-do), or deleting a period (`todo
--     cancel`, the desktop's 「删除」: the period and the rule both go).
--     An ended rule makes no period again.
--   - created_via / created_by_supervisor / created_origin_note: who made
--     the rule (the same triple); created_at, updated_at.
--
-- `todos.series_id`: the rule a to-do is (or was) a period of; NULL for a
-- to-do that never repeated. It stays when the rule ends.
-- `todos.skipped`: 1 on a period skipped (「跳过这一次」, `todo skip`): a
-- soft delete as cancel's (cancelled_at, cancelled_*), which makes the
-- next period as a tick does. The follow-ups the user turned down
-- (ticket 61) leave a skipped period out.
--
-- A period Core makes records `created_via = 'system'` with
-- `created_by_supervisor = 'galley-repeat'`, as the morning review's task
-- records 'galley-review' (ticket 73), and no `created_in_*` (it was
-- noted in no turn, so no card hangs under a reply for it); its
-- created_at and updated_at are the same instant.
--
-- No foreign key on series_id, for the reason 050 gives for
-- `scheduled_tasks.todo_id`: rebuilding either table later drops it, and
-- with foreign keys on a DROP TABLE runs the ON DELETE action on every row
-- that points at it. Core keeps the link: a rule is deleted only by a main
-- chat reset, which deletes every to-do in the same transaction.

CREATE TABLE todo_series (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  notes                  TEXT,
  items                  TEXT,
  repeat_kind            TEXT NOT NULL
                         CHECK (repeat_kind IN ('daily','weekly','monthly','yearly')),
  repeat_every           INTEGER NOT NULL DEFAULT 1 CHECK (repeat_every >= 1),
  repeat_days            TEXT,
  anchor_date            TEXT NOT NULL,
  time_of_day            TEXT,
  remind_days_before     INTEGER,
  remind_time            TEXT,
  ended_at               TEXT,
  ended_via              TEXT CHECK (ended_via IN ('gui','cli','supervisor','system')),
  ended_by_supervisor    TEXT,
  ended_origin_note      TEXT,
  created_via            TEXT NOT NULL
                         CHECK (created_via IN ('gui','cli','supervisor','system')),
  created_by_supervisor  TEXT,
  created_origin_note    TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  CHECK ((remind_days_before IS NULL) = (remind_time IS NULL)),
  CHECK (ended_via IS NULL OR ended_at IS NOT NULL)
);

ALTER TABLE todos ADD COLUMN series_id TEXT;
ALTER TABLE todos ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0
  CHECK (skipped IN (0, 1))
  CHECK (skipped = 0 OR cancelled_at IS NOT NULL);

CREATE INDEX todos_by_series
  ON todos(series_id)
  WHERE series_id IS NOT NULL;
