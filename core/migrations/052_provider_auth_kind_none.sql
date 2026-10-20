-- 052_provider_auth_kind_none.sql · let a no-auth provider be saved
-- (.scratch/chatgpt-siwc/issues/01-providers-auth-kind-check.md).
--
-- The no-auth provider (galley#24, 2026-08-31) saves auth_kind 'none', but
-- the CHECK that 014 put on managed_model_providers.auth_kind names only
-- 'api_key' and 'chatgpt_codex_oauth', so every such save failed with
-- "CHECK constraint failed". This widens it to
--
--   auth_kind IN ('api_key', 'chatgpt_codex_oauth', 'none')
--
-- and changes nothing else: same columns in the same order, same
-- constraints, same indexes, every row kept with its rowid.
--
-- SQLite cannot change a CHECK in place, so the table is rebuilt. It is the
-- parent of managed_models (010: provider_id REFERENCES ... ON DELETE
-- CASCADE), and SQLx runs each migration inside a transaction, where
-- PRAGMA foreign_keys = OFF is a no-op (the v0.2.9 incident, see
-- core/src/migration_backup.rs): dropping the parent while the child is
-- still there would cascade-delete every model. So the child goes first and
-- comes back last, around the parent:
--
--   1. copy both tables, rowids included, into TEMP tables;
--   2. drop managed_models, then managed_model_providers (the child is gone
--      before the parent goes, so nothing cascades);
--   3. create managed_model_providers with the wider CHECK, copy it back;
--   4. create managed_models as 010 + 011 + 042 left it (the two columns
--      those ALTERs appended are written inline, in the same positions),
--      copy it back;
--   5. drop the TEMP tables and recreate the five indexes. The autoindexes
--      behind the PRIMARY KEYs and UNIQUE api_key_ref come back with the
--      tables, under the same names.
--
-- No ALTER TABLE ... RENAME: a rename re-checks every view and trigger in
-- the schema and fails on a stale one, a drop and create of these two
-- tables does not. No other table references either of them by foreign key,
-- and neither has triggers.
--
-- A model whose provider no longer exists cannot be copied back under
-- foreign-key enforcement; it would abort this migration, and with it
-- Galley's startup. Such a row can only have been written with enforcement
-- off, which no Galley path does; every read JOINs the provider, so it was
-- never shown, and ON DELETE CASCADE says it should not exist. The copy
-- back leaves it out.

CREATE TEMP TABLE _mmp_052 AS
SELECT
  rowid AS old_rowid,
  id, display_name, protocol, api_base, api_key_ref, created_at, updated_at,
  auth_kind
FROM managed_model_providers;

CREATE TEMP TABLE _mm_052 AS
SELECT
  rowid AS old_rowid,
  id, provider_id, display_name, model, advanced_options, is_default,
  last_validated_at, created_at, updated_at, sort_order, preset_options
FROM managed_models;

DROP TABLE managed_models;
DROP TABLE managed_model_providers;

CREATE TABLE managed_model_providers (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  protocol           TEXT NOT NULL CHECK (protocol IN ('anthropic', 'openai')),
  api_base           TEXT NOT NULL,
  api_key_ref        TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  auth_kind          TEXT NOT NULL DEFAULT 'api_key'
    CHECK (auth_kind IN ('api_key', 'chatgpt_codex_oauth', 'none'))
);

INSERT INTO managed_model_providers (
  rowid, id, display_name, protocol, api_base, api_key_ref, created_at,
  updated_at, auth_kind
)
SELECT
  old_rowid, id, display_name, protocol, api_base, api_key_ref, created_at,
  updated_at, auth_kind
FROM _mmp_052;

CREATE TABLE managed_models (
  id                 TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL REFERENCES managed_model_providers(id) ON DELETE CASCADE,
  display_name       TEXT NOT NULL,
  model              TEXT NOT NULL,
  advanced_options   TEXT NOT NULL DEFAULT '{}',
  is_default         INTEGER NOT NULL DEFAULT 0,
  last_validated_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  preset_options     TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO managed_models (
  rowid, id, provider_id, display_name, model, advanced_options, is_default,
  last_validated_at, created_at, updated_at, sort_order, preset_options
)
SELECT
  old_rowid, id, provider_id, display_name, model, advanced_options,
  is_default, last_validated_at, created_at, updated_at, sort_order,
  preset_options
FROM _mm_052
WHERE provider_id IN (SELECT id FROM managed_model_providers);

DROP TABLE _mm_052;
DROP TABLE _mmp_052;

CREATE INDEX managed_model_providers_by_updated_at
  ON managed_model_providers(updated_at DESC);

CREATE INDEX managed_models_by_provider
  ON managed_models(provider_id);

CREATE INDEX managed_models_by_updated_at
  ON managed_models(updated_at DESC);

CREATE UNIQUE INDEX managed_models_one_default
  ON managed_models(is_default)
  WHERE is_default = 1;

CREATE INDEX managed_models_by_sort_order
  ON managed_models(sort_order ASC);
