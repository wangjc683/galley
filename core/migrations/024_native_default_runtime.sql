-- 024_native_default_runtime.sql · Galley v0.3 default runtime
--
-- Galley-owned built-in runtime moves from Python managed GA to Rust
-- Galley Native. User-owned external GA remains external. The old
-- managed runtime stays available as an explicit advanced fallback.

UPDATE prefs
SET value = '"galley_native"',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE key = 'active_runtime_kind'
  AND value = '"managed"';

INSERT INTO prefs (key, value, updated_at)
SELECT
  'active_runtime_kind',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM prefs
      WHERE key = 'ga_config'
        AND COALESCE(json_extract(value, '$.gaPath'), '') <> ''
    )
    THEN '"external"'
    ELSE '"galley_native"'
  END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM prefs WHERE key = 'active_runtime_kind'
);

UPDATE sessions
SET ga_runtime_kind = 'galley_native',
    ga_runtime_id = NULL,
    prompt_profile = NULL
WHERE ga_runtime_kind = 'managed';

UPDATE goal_proposals
SET runtime_kind = 'galley_native'
WHERE runtime_kind = 'managed';

UPDATE goals
SET runtime_kind = 'galley_native'
WHERE runtime_kind = 'managed';
