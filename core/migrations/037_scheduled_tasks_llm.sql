-- 037_scheduled_tasks_llm.sql · Optional per-task model.
-- Scheduled tasks run unattended and repeat, so their model cost
-- multiplies; a digest-grade task should be able to pin a cheaper
-- model. NULL = follow the runtime default (previous behavior). The
-- value is the model display name, same semantic as `--llm=<name>`;
-- resolution failure at fire time falls back to the default rather
-- than killing the run.

ALTER TABLE scheduled_tasks ADD COLUMN llm_name TEXT;
