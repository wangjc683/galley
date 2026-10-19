-- 051_cancelled_by.sql · Who cancelled a to-do or a scheduled task, and
-- why (.scratch/main-chat/issues/61-declined-follow-ups-in-hand.md; main
-- chat PRD ruling 113).
--
-- A cancel (the soft delete of 049 and 050, `cancelled_at`) now records
-- who made it, as `done_*` (050) records who ticked a to-do off and
-- `created_*` (049) who made a task. The main chat reads these at the start
-- of each segment: the follow-ups Galley set that the user turned down
-- stay in front of it ("这类别提醒我"), where a preference written only
-- into the engine's memory would be out of sight by the next segment.
--
-- On both `todos` and `scheduled_tasks`:
--   - cancelled_via / cancelled_by_supervisor / cancelled_origin_note: who
--     cancelled it, the origin triple of 007, 049 and 050, from three
--     sources:
--       'gui'         the user at the desktop (cancelling a reminder on a
--                     to-do, the 取消 on a task's card or in the lists);
--       'supervisor'  an agent through the CLI (`todo cancel`, `schedule
--                     delete`, `todo update --no-remind`) with its
--                     `--supervisor` label and its `--reason` as the
--                     note; 'supervisor' + 'galley-assistant' is Galley
--                     doing it on the user's word ('cli' when no label
--                     was given);
--       'system'      Core on its own: a to-do's reminder cancelled
--                     because the to-do was ticked off or cancelled, or
--                     dropped by the scheduler because its to-do is no
--                     longer open.
--     Set only together with cancelled_at. Rows cancelled before 051 keep
--     NULL: who it was is not known, and is not guessed. Resetting the
--     main chat clears them on the tasks it keeps (its to-dos and their
--     reminders it deletes): what the user turned down goes with the
--     conversation it was said in.
--
-- Columns only, no rebuild: ADD COLUMN keeps every row as it is, and no
-- foreign key is touched.

ALTER TABLE todos ADD COLUMN cancelled_via TEXT
  CHECK (cancelled_via IN ('gui','cli','supervisor','system'))
  CHECK (cancelled_via IS NULL OR cancelled_at IS NOT NULL);
ALTER TABLE todos ADD COLUMN cancelled_by_supervisor TEXT;
ALTER TABLE todos ADD COLUMN cancelled_origin_note TEXT;

ALTER TABLE scheduled_tasks ADD COLUMN cancelled_via TEXT
  CHECK (cancelled_via IN ('gui','cli','supervisor','system'))
  CHECK (cancelled_via IS NULL OR cancelled_at IS NOT NULL);
ALTER TABLE scheduled_tasks ADD COLUMN cancelled_by_supervisor TEXT;
ALTER TABLE scheduled_tasks ADD COLUMN cancelled_origin_note TEXT;
