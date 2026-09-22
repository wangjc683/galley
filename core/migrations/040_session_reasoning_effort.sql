-- Per-session reasoning-effort override (composer LLM pill, 2026-09-22).
-- NULL = follow the selected model's configured `reasoning_effort`
-- (which may itself be unset = provider default, no parameter sent).
-- Values mirror GA's `_enum('reasoning_effort', ...)`: none / minimal /
-- low / medium / high / xhigh / max. Written only when the user picks a
-- tier that deviates from the model configuration; picking the
-- configured tier again clears it back to NULL (override = deviation).
ALTER TABLE sessions ADD COLUMN reasoning_effort TEXT;
