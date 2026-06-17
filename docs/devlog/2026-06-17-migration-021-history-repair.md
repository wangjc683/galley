# 2026-06-17 · Migration 021 History Repair

## Context

Dev dogfood found that old sessions still appeared in the sidebar, but clicking
them could not restore the conversation body.

## Root Cause

Migration `021_native_session_runtime.sql` rebuilt the `sessions` table to widen
the `ga_runtime_kind` CHECK constraint for `galley_native`.

The migration used `PRAGMA foreign_keys = OFF` around the rebuild, but
`tauri-plugin-sql` runs migrations through SQLx inside a transaction. SQLite
does not change `foreign_keys` inside an active transaction, so dropping the
parent `sessions` table triggered child-table foreign key actions:

- `messages.session_id REFERENCES sessions(id) ON DELETE CASCADE` deleted
  conversation bodies.
- `tool_events.session_id ... ON DELETE CASCADE` could delete tool audit rows.
- nullable Goal session references could be set to `NULL`.

The rebuilt `sessions` rows survived, so the sidebar still had titles and
`turn_count`, while `messages` was empty.

## Repair

Added a startup repair pass after SQL migrations:

- Scan sibling `app.galley.backup.*` directories.
- Pick the newest backup DB with message rows.
- `INSERT OR IGNORE` missing `messages`, `message_attachments`, and
  `tool_events` rows for sessions that still exist in the current DB.
- Restore nullable Goal session references when the backup still points at an
  existing current session.
- Rebuild `messages_fts` from `messages` so search cannot retain orphaned rows.

The repair is best-effort and does not block app startup if it fails; the
pre-migration backup remains the source of recovery.

## Follow-Up Rule

Do not rebuild a foreign-key parent table in a `tauri-plugin-sql` / SQLx
migration using `PRAGMA foreign_keys = OFF`. The plugin does not expose
`no_tx`, so SQLite will keep foreign key enforcement active inside the migration
transaction.

For future CHECK-only changes, prefer a dedicated non-transaction migration
runner or a narrowly-scoped `sqlite_schema` edit that does not touch table data.
