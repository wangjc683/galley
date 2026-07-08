-- 032_goal_mode.sql
-- Goal engine mode: 'hive' (master + parallel workers, the historical
-- default) vs 'solo' (single agent runs the objective to budget, Core-owned,
-- no worker coordination). Additive column on both goal_proposals and goals;
-- NOT NULL DEFAULT 'hive' backfills existing rows so pre-migration goals keep
-- their current behavior. See .scratch/goal-solo-hive/.
--
-- Inline CHECK is allowed on a freshly-added column (unlike retroactively
-- adding CHECK to an existing one), matching the write_mode/runtime_kind
-- constraint style from migration 015.
ALTER TABLE goal_proposals
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'hive'
    CHECK (mode IN ('hive', 'solo'));

ALTER TABLE goals
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'hive'
    CHECK (mode IN ('hive', 'solo'));
