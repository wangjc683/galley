-- 031_message_goal_id.sql
-- Goal-scoped conversation rows (objective user turn, launch ack,
-- master checkpoints) carry the Goal they belong to, replacing the
-- GUI-side objective-text + closest-timestamp heuristic
-- (gui/src/lib/goal-thread.ts). NULL = not goal-scoped, or written
-- before this migration (the GUI falls back to the heuristic there).
-- No REFERENCES clause: consistent with the other additive message
-- columns (017/028), and message rows must not couple their lifetime
-- to goal rows.
ALTER TABLE messages ADD COLUMN goal_id TEXT;

CREATE INDEX messages_by_goal
  ON messages(goal_id) WHERE goal_id IS NOT NULL;
