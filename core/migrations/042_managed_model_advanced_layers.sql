-- 042_managed_model_advanced_layers.sql · layered managed model advanced options
--
-- Before: managed_models.advanced_options held one full snapshot per model —
-- the provider preset's seed and the user's own edits, indistinguishable, so
-- every model had to be configured by hand and a preset bump never reached
-- existing rows. After:
--
--   effective = preset_options ⊕ defaults ⊕ advanced_options
--
--   preset_options    the row's baseline: what the preset seeded at creation
--                     (protocol-dialect keys, engine tuning the GUI never
--                     edits, the preset's own values for the layered keys).
--   defaults          one user-owned object for every model, stored in
--                     prefs.managed_model_defaults. Only the six layered keys
--                     (max_retries, read_timeout, max_retry_after,
--                     trim_keep_prefix, stream, reasoning_effort).
--   advanced_options  now the model's own deviations from preset ⊕ defaults.
--                     A JSON null is a tombstone: "unset, do not send".
--
-- Data rule — Core has no preset knowledge beyond the five factory values of
-- the layered keys (3 / 180 / 60 / 0 / true) and the three first-party URLs:
--
--   1. preset_options := the whole old snapshot. It is the row's baseline, so
--      nothing the row used to send can go missing.
--   2. advanced_options := the snapshot's layered keys, minus those at their
--      factory value (the baseline already carries them; keeping them would
--      show "N overrides" on rows the user never touched and would shadow a
--      later defaults value), minus a first-party reasoning_effort seed
--      ("high" on api.openai.com / api.anthropic.com, "high" or "medium" on
--      the ChatGPT Codex backend — otherwise a defaults tier could never reach
--      those models, and "follow defaults" would silently drop them to the
--      provider's own default).
--   3. A layered key that EVERY object row still carries with one identical
--      value is lifted into defaults and removed from every row
--      (reasoning_effort only for the five defaults-layer tiers). Rows that
--      pruned the key in step 2 block the lift, which is what keeps their
--      effective value intact.
--   4. Whatever remains stays on the row as its override.
--
-- Invariant: the effective object of every row is unchanged by this
-- migration. Rows whose advanced_options is not a JSON object are skipped
-- (preset_options stays '{}', advanced_options untouched).

ALTER TABLE managed_models ADD COLUMN preset_options TEXT NOT NULL DEFAULT '{}';

-- Steps 1 + 2. `->` yields JSON text (subtype preserved through json()), so
-- booleans and numbers keep their JSON type; json_patch('{}', …) drops the
-- null entries that json_object produces for absent keys (RFC 7396).
-- `->>` yields the SQL value (true → 1) for the factory comparisons.
UPDATE managed_models
SET preset_options = advanced_options,
    advanced_options = json_remove(
      json_patch('{}', json_object(
        'max_retries',      json(advanced_options -> '$.max_retries'),
        'read_timeout',     json(advanced_options -> '$.read_timeout'),
        'max_retry_after',  json(advanced_options -> '$.max_retry_after'),
        'trim_keep_prefix', json(advanced_options -> '$.trim_keep_prefix'),
        'stream',           json(advanced_options -> '$.stream'),
        'reasoning_effort', json(advanced_options -> '$.reasoning_effort'))),
      CASE WHEN advanced_options ->> '$.max_retries' = 3
           THEN '$.max_retries' ELSE '$.__galley_keep' END,
      CASE WHEN advanced_options ->> '$.read_timeout' = 180
           THEN '$.read_timeout' ELSE '$.__galley_keep' END,
      CASE WHEN advanced_options ->> '$.max_retry_after' = 60
           THEN '$.max_retry_after' ELSE '$.__galley_keep' END,
      CASE WHEN advanced_options ->> '$.trim_keep_prefix' = 0
           THEN '$.trim_keep_prefix' ELSE '$.__galley_keep' END,
      CASE WHEN advanced_options ->> '$.stream' = 1
           THEN '$.stream' ELSE '$.__galley_keep' END,
      CASE
        WHEN (
          SELECT rtrim(p.api_base, '/') FROM managed_model_providers p
          WHERE p.id = managed_models.provider_id
        ) IN ('https://api.openai.com/v1', 'https://api.anthropic.com')
          AND advanced_options ->> '$.reasoning_effort' = 'high'
        THEN '$.reasoning_effort'
        WHEN (
          SELECT rtrim(p.api_base, '/') FROM managed_model_providers p
          WHERE p.id = managed_models.provider_id
        ) = 'https://chatgpt.com/backend-api/codex'
          AND advanced_options ->> '$.reasoning_effort' IN ('high', 'medium')
        THEN '$.reasoning_effort'
        ELSE '$.__galley_keep'
      END)
WHERE json_valid(advanced_options)
  AND json_type(advanced_options) = 'object';

-- Step 3a. Per layered key: does every object row still carry it, with one
-- value? (COUNT / COUNT DISTINCT skip NULL = absent.) A JSON null is never
-- lifted. Nothing is lifted when a defaults pref already exists.
CREATE TEMP TABLE _mm_layer_lift AS
WITH rows AS (
  SELECT advanced_options AS a
  FROM managed_models
  WHERE json_valid(advanced_options) AND json_type(advanced_options) = 'object'
),
stats AS (
  SELECT
    COUNT(*) AS n,
    COUNT(a -> '$.max_retries')      AS n_mr, COUNT(DISTINCT a -> '$.max_retries')      AS d_mr, MIN(a -> '$.max_retries')      AS v_mr,
    COUNT(a -> '$.read_timeout')     AS n_rt, COUNT(DISTINCT a -> '$.read_timeout')     AS d_rt, MIN(a -> '$.read_timeout')     AS v_rt,
    COUNT(a -> '$.max_retry_after')  AS n_ra, COUNT(DISTINCT a -> '$.max_retry_after')  AS d_ra, MIN(a -> '$.max_retry_after')  AS v_ra,
    COUNT(a -> '$.trim_keep_prefix') AS n_tk, COUNT(DISTINCT a -> '$.trim_keep_prefix') AS d_tk, MIN(a -> '$.trim_keep_prefix') AS v_tk,
    COUNT(a -> '$.stream')           AS n_st, COUNT(DISTINCT a -> '$.stream')           AS d_st, MIN(a -> '$.stream')           AS v_st,
    COUNT(a -> '$.reasoning_effort') AS n_re, COUNT(DISTINCT a -> '$.reasoning_effort') AS d_re, MIN(a -> '$.reasoning_effort') AS v_re
  FROM rows
),
gate AS (
  SELECT
    (n > 0 AND NOT EXISTS (SELECT 1 FROM prefs WHERE key = 'managed_model_defaults')) AS can_lift,
    *
  FROM stats
)
SELECT
  (can_lift AND n_mr = n AND d_mr = 1 AND v_mr <> 'null') AS lift_max_retries,      v_mr AS v_max_retries,
  (can_lift AND n_rt = n AND d_rt = 1 AND v_rt <> 'null') AS lift_read_timeout,     v_rt AS v_read_timeout,
  (can_lift AND n_ra = n AND d_ra = 1 AND v_ra <> 'null') AS lift_max_retry_after,  v_ra AS v_max_retry_after,
  (can_lift AND n_tk = n AND d_tk = 1 AND v_tk <> 'null') AS lift_trim_keep_prefix, v_tk AS v_trim_keep_prefix,
  (can_lift AND n_st = n AND d_st = 1 AND v_st <> 'null') AS lift_stream,           v_st AS v_stream,
  (can_lift AND n_re = n AND d_re = 1
     AND v_re IN ('"low"', '"medium"', '"high"', '"xhigh"', '"max"')) AS lift_reasoning_effort, v_re AS v_reasoning_effort
FROM gate;

-- Step 3b. The lifted keys become the defaults object. Values passed through
-- MIN() lost their JSON subtype; json() restores it. Non-lifted keys are
-- removed by path (a CASE on a path string has no subtype to lose).
INSERT INTO prefs (key, value, updated_at)
SELECT
  'managed_model_defaults',
  json_remove(
    json_object(
      'max_retries',      json(v_max_retries),
      'read_timeout',     json(v_read_timeout),
      'max_retry_after',  json(v_max_retry_after),
      'trim_keep_prefix', json(v_trim_keep_prefix),
      'stream',           json(v_stream),
      'reasoning_effort', json(v_reasoning_effort)),
    CASE WHEN lift_max_retries      THEN '$.__galley_keep' ELSE '$.max_retries'      END,
    CASE WHEN lift_read_timeout     THEN '$.__galley_keep' ELSE '$.read_timeout'     END,
    CASE WHEN lift_max_retry_after  THEN '$.__galley_keep' ELSE '$.max_retry_after'  END,
    CASE WHEN lift_trim_keep_prefix THEN '$.__galley_keep' ELSE '$.trim_keep_prefix' END,
    CASE WHEN lift_stream           THEN '$.__galley_keep' ELSE '$.stream'           END,
    CASE WHEN lift_reasoning_effort THEN '$.__galley_keep' ELSE '$.reasoning_effort' END),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM _mm_layer_lift
WHERE lift_max_retries OR lift_read_timeout OR lift_max_retry_after
   OR lift_trim_keep_prefix OR lift_stream OR lift_reasoning_effort;

-- Step 3c. Lifted keys leave every row.
UPDATE managed_models
SET advanced_options = json_remove(
  advanced_options,
  CASE WHEN (SELECT lift_max_retries      FROM _mm_layer_lift) THEN '$.max_retries'      ELSE '$.__galley_keep' END,
  CASE WHEN (SELECT lift_read_timeout     FROM _mm_layer_lift) THEN '$.read_timeout'     ELSE '$.__galley_keep' END,
  CASE WHEN (SELECT lift_max_retry_after  FROM _mm_layer_lift) THEN '$.max_retry_after'  ELSE '$.__galley_keep' END,
  CASE WHEN (SELECT lift_trim_keep_prefix FROM _mm_layer_lift) THEN '$.trim_keep_prefix' ELSE '$.__galley_keep' END,
  CASE WHEN (SELECT lift_stream           FROM _mm_layer_lift) THEN '$.stream'           ELSE '$.__galley_keep' END,
  CASE WHEN (SELECT lift_reasoning_effort FROM _mm_layer_lift) THEN '$.reasoning_effort' ELSE '$.__galley_keep' END)
WHERE json_valid(advanced_options)
  AND json_type(advanced_options) = 'object';

DROP TABLE _mm_layer_lift;
