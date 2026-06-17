-- 022_native_memory_substrate.sql · Galley Native Slice 5B
--
-- Core-owned native memory substrate. This is an audit/reversibility
-- ledger first: model tools are not wired to write these tables until
-- the later start_long_term_update slice.

CREATE TABLE native_memory_items (
  id                  TEXT PRIMARY KEY,
  layer               TEXT NOT NULL CHECK (layer IN ('l1','l2','l3','l4')),
  scope_kind          TEXT NOT NULL CHECK (scope_kind IN
    ('global_user','project','workspace','capability_pack')),
  scope_key           TEXT,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  triggers_json       TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(triggers_json) AND json_type(triggers_json) = 'array'),
  tags_json           TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  source_refs_json    TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(source_refs_json) AND json_type(source_refs_json) = 'array'),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN
    ('draft','active','superseded','deleted')),
  supersedes_item_id  TEXT REFERENCES native_memory_items(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (length(trim(title)) > 0),
  CHECK (
    (scope_kind = 'global_user' AND scope_key IS NULL)
    OR
    (scope_kind != 'global_user' AND scope_key IS NOT NULL AND length(trim(scope_key)) > 0)
  )
);

CREATE INDEX native_memory_items_by_scope
  ON native_memory_items(scope_kind, scope_key, layer, status, updated_at DESC);

CREATE INDEX native_memory_items_by_supersedes
  ON native_memory_items(supersedes_item_id) WHERE supersedes_item_id IS NOT NULL;

CREATE TABLE native_memory_index_entries (
  id                  TEXT PRIMARY KEY,
  scope_kind          TEXT NOT NULL CHECK (scope_kind IN
    ('global_user','project','workspace','capability_pack')),
  scope_key           TEXT,
  trigger             TEXT NOT NULL,
  target_item_id      TEXT NOT NULL REFERENCES native_memory_items(id) ON DELETE CASCADE,
  rank                INTEGER NOT NULL DEFAULT 100,
  reason              TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (length(trim(trigger)) > 0),
  CHECK (
    (scope_kind = 'global_user' AND scope_key IS NULL)
    OR
    (scope_kind != 'global_user' AND scope_key IS NOT NULL AND length(trim(scope_key)) > 0)
  )
);

CREATE INDEX native_memory_index_entries_by_scope
  ON native_memory_index_entries(scope_kind, scope_key, rank ASC, updated_at DESC);

CREATE UNIQUE INDEX native_memory_index_entries_unique_global
  ON native_memory_index_entries(scope_kind, trigger, target_item_id)
  WHERE scope_key IS NULL;

CREATE UNIQUE INDEX native_memory_index_entries_unique_scoped
  ON native_memory_index_entries(scope_kind, scope_key, trigger, target_item_id)
  WHERE scope_key IS NOT NULL;

CREATE TABLE native_memory_evidence (
  id              TEXT PRIMARY KEY,
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  turn_index      INTEGER,
  message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
  tool_call_id    TEXT,
  tool_event_id   TEXT REFERENCES tool_events(id) ON DELETE SET NULL,
  content_hash    TEXT NOT NULL,
  summary         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  CHECK (turn_index IS NULL OR turn_index >= 0),
  CHECK (length(trim(content_hash)) > 0),
  CHECK (length(trim(summary)) > 0)
);

CREATE INDEX native_memory_evidence_by_session
  ON native_memory_evidence(session_id, turn_index, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX native_memory_evidence_by_hash
  ON native_memory_evidence(content_hash);

CREATE TABLE native_memory_changes (
  id                       TEXT PRIMARY KEY,
  target_item_id           TEXT REFERENCES native_memory_items(id) ON DELETE SET NULL,
  kind                     TEXT NOT NULL CHECK (kind IN
    ('create','update','supersede','delete')),
  diff_json                TEXT NOT NULL
    CHECK (json_valid(diff_json) AND json_type(diff_json) = 'object'),
  evidence_ids_json        TEXT NOT NULL
    CHECK (
      json_valid(evidence_ids_json)
      AND json_type(evidence_ids_json) = 'array'
      AND json_array_length(evidence_ids_json) > 0
    ),
  risk                     TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  approval_state           TEXT NOT NULL CHECK (approval_state IN
    ('auto_applied','awaiting_approval','approved','denied','reverted')),
  created_by_session_id    TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_by_tool_call_id  TEXT,
  applied_at               TEXT,
  reverted_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX native_memory_changes_by_item
  ON native_memory_changes(target_item_id, created_at DESC)
  WHERE target_item_id IS NOT NULL;

CREATE INDEX native_memory_changes_by_session
  ON native_memory_changes(created_by_session_id, created_at DESC)
  WHERE created_by_session_id IS NOT NULL;

CREATE INDEX native_memory_changes_by_state
  ON native_memory_changes(approval_state, created_at DESC);
