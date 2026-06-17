use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NativeMemoryLayer {
    L1,
    L2,
    L3,
    L4,
}

impl NativeMemoryLayer {
    fn as_sql(self) -> &'static str {
        match self {
            Self::L1 => "l1",
            Self::L2 => "l2",
            Self::L3 => "l3",
            Self::L4 => "l4",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum NativeMemoryScope {
    GlobalUser,
    Project(String),
    Workspace(String),
    CapabilityPack(String),
}

impl NativeMemoryScope {
    fn kind_sql(&self) -> &'static str {
        match self {
            Self::GlobalUser => "global_user",
            Self::Project(_) => "project",
            Self::Workspace(_) => "workspace",
            Self::CapabilityPack(_) => "capability_pack",
        }
    }

    fn key_sql(&self) -> Option<&str> {
        match self {
            Self::GlobalUser => None,
            Self::Project(key) | Self::Workspace(key) | Self::CapabilityPack(key) => {
                Some(key.as_str())
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NativeMemoryChangeKind {
    Create,
    Update,
    Supersede,
    Delete,
}

impl NativeMemoryChangeKind {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::Supersede => "supersede",
            Self::Delete => "delete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NativeMemoryRisk {
    Low,
    Medium,
    High,
}

impl NativeMemoryRisk {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NativeMemoryApprovalState {
    AutoApplied,
    AwaitingApproval,
    Approved,
    Denied,
    Reverted,
}

impl NativeMemoryApprovalState {
    fn as_sql(self) -> &'static str {
        match self {
            Self::AutoApplied => "auto_applied",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Reverted => "reverted",
        }
    }

    fn implies_applied(self) -> bool {
        matches!(self, Self::AutoApplied | Self::Approved)
    }
}

#[derive(Debug, Clone)]
pub struct CreateNativeMemoryItemInput {
    pub layer: NativeMemoryLayer,
    pub scope: NativeMemoryScope,
    pub title: String,
    pub body: String,
    pub triggers: Vec<String>,
    pub tags: Vec<String>,
    pub source_refs: serde_json::Value,
    pub supersedes_item_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateNativeMemoryIndexEntryInput {
    pub scope: NativeMemoryScope,
    pub trigger: String,
    pub target_item_id: String,
    pub rank: i64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateNativeMemoryEvidenceInput {
    pub session_id: Option<SessionId>,
    pub turn_index: Option<u32>,
    pub message_id: Option<MessageId>,
    pub tool_call_id: Option<String>,
    pub tool_event_id: Option<String>,
    pub content_hash: String,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct CreateNativeMemoryChangeInput {
    pub target_item_id: Option<String>,
    pub kind: NativeMemoryChangeKind,
    pub diff: serde_json::Value,
    pub evidence_ids: Vec<String>,
    pub risk: NativeMemoryRisk,
    pub approval_state: NativeMemoryApprovalState,
    pub created_by_session_id: Option<SessionId>,
    pub created_by_tool_call_id: Option<String>,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeMemoryItemRecord {
    pub id: String,
    pub layer: NativeMemoryLayer,
    pub scope: NativeMemoryScope,
    pub title: String,
    pub body: String,
    pub triggers: Vec<String>,
    pub tags: Vec<String>,
    pub source_refs: serde_json::Value,
    pub status: String,
    pub supersedes_item_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeMemoryIndexEntryRecord {
    pub id: String,
    pub scope: NativeMemoryScope,
    pub trigger: String,
    pub target_item_id: String,
    pub rank: i64,
    pub reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeMemoryEvidenceRecord {
    pub id: String,
    pub session_id: Option<SessionId>,
    pub turn_index: Option<u32>,
    pub message_id: Option<MessageId>,
    pub tool_call_id: Option<String>,
    pub tool_event_id: Option<String>,
    pub content_hash: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NativeMemoryChangeRecord {
    pub id: String,
    pub target_item_id: Option<String>,
    pub kind: NativeMemoryChangeKind,
    pub diff: serde_json::Value,
    pub evidence_ids: Vec<String>,
    pub risk: NativeMemoryRisk,
    pub approval_state: NativeMemoryApprovalState,
    pub created_by_session_id: Option<SessionId>,
    pub created_by_tool_call_id: Option<String>,
    pub applied_at: Option<String>,
    pub reverted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, FromRow)]
struct NativeMemoryItemRow {
    id: String,
    layer: String,
    scope_kind: String,
    scope_key: Option<String>,
    title: String,
    body: String,
    triggers_json: String,
    tags_json: String,
    source_refs_json: String,
    status: String,
    supersedes_item_id: Option<String>,
    created_at: String,
    updated_at: String,
}

impl NativeMemoryItemRow {
    fn into_record(self) -> Result<NativeMemoryItemRecord> {
        Ok(NativeMemoryItemRecord {
            id: self.id,
            layer: parse_native_memory_layer(&self.layer)?,
            scope: parse_native_memory_scope(&self.scope_kind, self.scope_key)?,
            title: self.title,
            body: self.body,
            triggers: parse_string_array_json(&self.triggers_json, "triggers_json")?,
            tags: parse_string_array_json(&self.tags_json, "tags_json")?,
            source_refs: parse_json_value(&self.source_refs_json, "source_refs_json")?,
            status: self.status,
            supersedes_item_id: self.supersedes_item_id,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
struct NativeMemoryIndexEntryRow {
    id: String,
    scope_kind: String,
    scope_key: Option<String>,
    trigger: String,
    target_item_id: String,
    rank: i64,
    reason: Option<String>,
    created_at: String,
    updated_at: String,
}

impl NativeMemoryIndexEntryRow {
    fn into_record(self) -> Result<NativeMemoryIndexEntryRecord> {
        Ok(NativeMemoryIndexEntryRecord {
            id: self.id,
            scope: parse_native_memory_scope(&self.scope_kind, self.scope_key)?,
            trigger: self.trigger,
            target_item_id: self.target_item_id,
            rank: self.rank,
            reason: self.reason,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
struct NativeMemoryEvidenceRow {
    id: String,
    session_id: Option<String>,
    turn_index: Option<i64>,
    message_id: Option<String>,
    tool_call_id: Option<String>,
    tool_event_id: Option<String>,
    content_hash: String,
    summary: String,
    created_at: String,
}

impl NativeMemoryEvidenceRow {
    fn into_record(self) -> NativeMemoryEvidenceRecord {
        NativeMemoryEvidenceRecord {
            id: self.id,
            session_id: self.session_id.map(SessionId),
            turn_index: self
                .turn_index
                .and_then(|n| if n < 0 { None } else { Some(n as u32) }),
            message_id: self.message_id.map(MessageId),
            tool_call_id: self.tool_call_id,
            tool_event_id: self.tool_event_id,
            content_hash: self.content_hash,
            summary: self.summary,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct NativeMemoryChangeRow {
    id: String,
    target_item_id: Option<String>,
    kind: String,
    diff_json: String,
    evidence_ids_json: String,
    risk: String,
    approval_state: String,
    created_by_session_id: Option<String>,
    created_by_tool_call_id: Option<String>,
    applied_at: Option<String>,
    reverted_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl NativeMemoryChangeRow {
    fn into_record(self) -> Result<NativeMemoryChangeRecord> {
        Ok(NativeMemoryChangeRecord {
            id: self.id,
            target_item_id: self.target_item_id,
            kind: parse_native_memory_change_kind(&self.kind)?,
            diff: parse_json_value(&self.diff_json, "diff_json")?,
            evidence_ids: parse_string_array_json(&self.evidence_ids_json, "evidence_ids_json")?,
            risk: parse_native_memory_risk(&self.risk)?,
            approval_state: parse_native_memory_approval_state(&self.approval_state)?,
            created_by_session_id: self.created_by_session_id.map(SessionId),
            created_by_tool_call_id: self.created_by_tool_call_id,
            applied_at: self.applied_at,
            reverted_at: self.reverted_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl SqliteGalley {
    pub async fn create_native_memory_item(
        &self,
        input: CreateNativeMemoryItemInput,
    ) -> Result<NativeMemoryItemRecord> {
        let title = trimmed_required("native_memory.item.create title", &input.title)?;
        let body = trimmed_required("native_memory.item.create body", &input.body)?;
        let scope_key = normalized_scope_key(&input.scope)?;
        if !input.source_refs.is_array() {
            return Err(GalleyError::InvalidArgs {
                message: "native_memory.item.create source_refs must be a JSON array".into(),
            });
        }
        let id = mint_goal_id("nmi");
        let now = chrono_now_iso();
        let triggers = serde_json::to_string(&clean_string_list(input.triggers)).map_err(|e| {
            GalleyError::Internal {
                message: format!("serializing native memory triggers: {e}"),
            }
        })?;
        let tags = serde_json::to_string(&clean_string_list(input.tags)).map_err(|e| {
            GalleyError::Internal {
                message: format!("serializing native memory tags: {e}"),
            }
        })?;
        let source_refs =
            serde_json::to_string(&input.source_refs).map_err(|e| GalleyError::Internal {
                message: format!("serializing native memory source refs: {e}"),
            })?;

        sqlx::query(
            "INSERT INTO native_memory_items (
                id, layer, scope_kind, scope_key, title, body, triggers_json, tags_json,
                source_refs_json, status, supersedes_item_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .bind(&id)
        .bind(input.layer.as_sql())
        .bind(input.scope.kind_sql())
        .bind(scope_key.as_deref())
        .bind(title)
        .bind(body)
        .bind(&triggers)
        .bind(&tags)
        .bind(&source_refs)
        .bind(&input.supersedes_item_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("native_memory.item.create", e))?;

        self.native_memory_item_by_id(&id).await
    }

    pub async fn native_memory_item_by_id(&self, id: &str) -> Result<NativeMemoryItemRecord> {
        let row = sqlx::query_as::<_, NativeMemoryItemRow>(
            "SELECT id, layer, scope_kind, scope_key, title, body, triggers_json, tags_json,
                    source_refs_json, status, supersedes_item_id, created_at, updated_at
             FROM native_memory_items
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("native memory item {id} not found"),
        })?;
        row.into_record()
    }

    pub async fn list_native_memory_items_for_scope(
        &self,
        scope: &NativeMemoryScope,
        limit: u32,
    ) -> Result<Vec<NativeMemoryItemRecord>> {
        let scope_key = normalized_scope_key(scope)?;
        let limit = i64::from(limit.clamp(1, 500));
        let rows = if let Some(scope_key) = scope_key.as_deref() {
            sqlx::query_as::<_, NativeMemoryItemRow>(
                "SELECT id, layer, scope_kind, scope_key, title, body, triggers_json, tags_json,
                        source_refs_json, status, supersedes_item_id, created_at, updated_at
                 FROM native_memory_items
                 WHERE scope_kind = ?
                   AND scope_key = ?
                   AND status = 'active'
                 ORDER BY layer ASC, updated_at DESC, id DESC
                 LIMIT ?",
            )
            .bind(scope.kind_sql())
            .bind(scope_key)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?
        } else {
            sqlx::query_as::<_, NativeMemoryItemRow>(
                "SELECT id, layer, scope_kind, scope_key, title, body, triggers_json, tags_json,
                        source_refs_json, status, supersedes_item_id, created_at, updated_at
                 FROM native_memory_items
                 WHERE scope_kind = ?
                   AND scope_key IS NULL
                   AND status = 'active'
                 ORDER BY layer ASC, updated_at DESC, id DESC
                 LIMIT ?",
            )
            .bind(scope.kind_sql())
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?
        };
        rows.into_iter()
            .map(NativeMemoryItemRow::into_record)
            .collect()
    }

    pub async fn create_native_memory_index_entry(
        &self,
        input: CreateNativeMemoryIndexEntryInput,
    ) -> Result<NativeMemoryIndexEntryRecord> {
        let trigger = trimmed_required("native_memory.index.create trigger", &input.trigger)?;
        let target_item_id = trimmed_required(
            "native_memory.index.create target_item_id",
            &input.target_item_id,
        )?;
        let scope_key = normalized_scope_key(&input.scope)?;
        let id = mint_goal_id("nmix");
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO native_memory_index_entries (
                id, scope_kind, scope_key, trigger, target_item_id, rank, reason,
                created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(input.scope.kind_sql())
        .bind(scope_key.as_deref())
        .bind(trigger)
        .bind(target_item_id)
        .bind(input.rank)
        .bind(
            input
                .reason
                .as_ref()
                .map(|reason| reason.trim())
                .filter(|s| !s.is_empty()),
        )
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("native_memory.index.create", e))?;

        self.native_memory_index_entry_by_id(&id).await
    }

    pub async fn native_memory_index_entry_by_id(
        &self,
        id: &str,
    ) -> Result<NativeMemoryIndexEntryRecord> {
        let row = sqlx::query_as::<_, NativeMemoryIndexEntryRow>(
            "SELECT id, scope_kind, scope_key, trigger, target_item_id, rank, reason,
                    created_at, updated_at
             FROM native_memory_index_entries
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("native memory index entry {id} not found"),
        })?;
        row.into_record()
    }

    pub async fn list_native_memory_index_entries_for_scope(
        &self,
        scope: &NativeMemoryScope,
        limit: u32,
    ) -> Result<Vec<NativeMemoryIndexEntryRecord>> {
        let scope_key = normalized_scope_key(scope)?;
        let limit = i64::from(limit.clamp(1, 500));
        let rows = if let Some(scope_key) = scope_key.as_deref() {
            sqlx::query_as::<_, NativeMemoryIndexEntryRow>(
                "SELECT id, scope_kind, scope_key, trigger, target_item_id, rank, reason,
                        created_at, updated_at
                 FROM native_memory_index_entries
                 WHERE scope_kind = ?
                   AND scope_key = ?
                 ORDER BY rank ASC, updated_at DESC, id DESC
                 LIMIT ?",
            )
            .bind(scope.kind_sql())
            .bind(scope_key)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?
        } else {
            sqlx::query_as::<_, NativeMemoryIndexEntryRow>(
                "SELECT id, scope_kind, scope_key, trigger, target_item_id, rank, reason,
                        created_at, updated_at
                 FROM native_memory_index_entries
                 WHERE scope_kind = ?
                   AND scope_key IS NULL
                 ORDER BY rank ASC, updated_at DESC, id DESC
                 LIMIT ?",
            )
            .bind(scope.kind_sql())
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?
        };
        rows.into_iter()
            .map(NativeMemoryIndexEntryRow::into_record)
            .collect()
    }

    pub async fn create_native_memory_evidence(
        &self,
        input: CreateNativeMemoryEvidenceInput,
    ) -> Result<NativeMemoryEvidenceRecord> {
        let content_hash = trimmed_required(
            "native_memory.evidence.create content_hash",
            &input.content_hash,
        )?;
        let summary = trimmed_required("native_memory.evidence.create summary", &input.summary)?;
        let id = mint_goal_id("nmev");
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO native_memory_evidence (
                id, session_id, turn_index, message_id, tool_call_id, tool_event_id,
                content_hash, summary, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(input.session_id.as_ref().map(SessionId::as_str))
        .bind(input.turn_index.map(i64::from))
        .bind(input.message_id.as_ref().map(|id| id.0.as_str()))
        .bind(
            input
                .tool_call_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|s| !s.is_empty()),
        )
        .bind(
            input
                .tool_event_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|s| !s.is_empty()),
        )
        .bind(content_hash)
        .bind(summary)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("native_memory.evidence.create", e))?;

        self.native_memory_evidence_by_id(&id).await
    }

    pub async fn native_memory_evidence_by_id(
        &self,
        id: &str,
    ) -> Result<NativeMemoryEvidenceRecord> {
        let row = sqlx::query_as::<_, NativeMemoryEvidenceRow>(
            "SELECT id, session_id, turn_index, message_id, tool_call_id, tool_event_id,
                    content_hash, summary, created_at
             FROM native_memory_evidence
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("native memory evidence {id} not found"),
        })?;
        Ok(row.into_record())
    }

    pub async fn create_native_memory_change(
        &self,
        input: CreateNativeMemoryChangeInput,
    ) -> Result<NativeMemoryChangeRecord> {
        if !input.diff.is_object() {
            return Err(GalleyError::InvalidArgs {
                message: "native_memory.change.create diff must be a JSON object".into(),
            });
        }
        let evidence_ids = clean_string_list(input.evidence_ids);
        if evidence_ids.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "native_memory.change.create evidence_ids must not be empty".into(),
            });
        }
        let diff_json = serde_json::to_string(&input.diff).map_err(|e| GalleyError::Internal {
            message: format!("serializing native memory change diff: {e}"),
        })?;
        let evidence_ids_json =
            serde_json::to_string(&evidence_ids).map_err(|e| GalleyError::Internal {
                message: format!("serializing native memory change evidence ids: {e}"),
            })?;
        let id = mint_goal_id("nmc");
        let now = chrono_now_iso();
        let applied_at = input
            .applied_at
            .or_else(|| input.approval_state.implies_applied().then(|| now.clone()));

        sqlx::query(
            "INSERT INTO native_memory_changes (
                id, target_item_id, kind, diff_json, evidence_ids_json, risk,
                approval_state, created_by_session_id, created_by_tool_call_id,
                applied_at, reverted_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(&id)
        .bind(&input.target_item_id)
        .bind(input.kind.as_sql())
        .bind(&diff_json)
        .bind(&evidence_ids_json)
        .bind(input.risk.as_sql())
        .bind(input.approval_state.as_sql())
        .bind(input.created_by_session_id.as_ref().map(SessionId::as_str))
        .bind(
            input
                .created_by_tool_call_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|s| !s.is_empty()),
        )
        .bind(&applied_at)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("native_memory.change.create", e))?;

        self.native_memory_change_by_id(&id).await
    }

    pub async fn native_memory_change_by_id(&self, id: &str) -> Result<NativeMemoryChangeRecord> {
        let row = sqlx::query_as::<_, NativeMemoryChangeRow>(
            "SELECT id, target_item_id, kind, diff_json, evidence_ids_json, risk,
                    approval_state, created_by_session_id, created_by_tool_call_id,
                    applied_at, reverted_at, created_at, updated_at
             FROM native_memory_changes
             WHERE id = ?
             LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("native memory change {id} not found"),
        })?;
        row.into_record()
    }

    pub async fn list_native_memory_changes(
        &self,
        limit: u32,
    ) -> Result<Vec<NativeMemoryChangeRecord>> {
        let limit = i64::from(limit.clamp(1, 200));
        let rows = sqlx::query_as::<_, NativeMemoryChangeRow>(
            "SELECT id, target_item_id, kind, diff_json, evidence_ids_json, risk,
                    approval_state, created_by_session_id, created_by_tool_call_id,
                    applied_at, reverted_at, created_at, updated_at
             FROM native_memory_changes
             ORDER BY created_at DESC, id DESC
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        rows.into_iter()
            .map(NativeMemoryChangeRow::into_record)
            .collect()
    }
}

fn trimmed_required<'a>(field: &str, value: &'a str) -> Result<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: format!("{field} must not be empty"),
        });
    }
    Ok(trimmed)
}

fn clean_string_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn normalized_scope_key(scope: &NativeMemoryScope) -> Result<Option<String>> {
    if let Some(key) = scope.key_sql() {
        let key = key.trim();
        if key.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "native memory {} scope key must not be empty",
                    scope.kind_sql()
                ),
            });
        }
        return Ok(Some(key.to_string()));
    }
    Ok(None)
}

fn parse_native_memory_layer(raw: &str) -> Result<NativeMemoryLayer> {
    Ok(match raw {
        "l1" => NativeMemoryLayer::L1,
        "l2" => NativeMemoryLayer::L2,
        "l3" => NativeMemoryLayer::L3,
        "l4" => NativeMemoryLayer::L4,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown native memory layer: {other}"),
            });
        }
    })
}

fn parse_native_memory_scope(kind: &str, key: Option<String>) -> Result<NativeMemoryScope> {
    Ok(match kind {
        "global_user" => NativeMemoryScope::GlobalUser,
        "project" => NativeMemoryScope::Project(scope_key_required(kind, key)?),
        "workspace" => NativeMemoryScope::Workspace(scope_key_required(kind, key)?),
        "capability_pack" => NativeMemoryScope::CapabilityPack(scope_key_required(kind, key)?),
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown native memory scope kind: {other}"),
            });
        }
    })
}

fn scope_key_required(kind: &str, key: Option<String>) -> Result<String> {
    key.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| GalleyError::Internal {
            message: format!("native memory scope {kind} missing key"),
        })
}

fn parse_native_memory_change_kind(raw: &str) -> Result<NativeMemoryChangeKind> {
    Ok(match raw {
        "create" => NativeMemoryChangeKind::Create,
        "update" => NativeMemoryChangeKind::Update,
        "supersede" => NativeMemoryChangeKind::Supersede,
        "delete" => NativeMemoryChangeKind::Delete,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown native memory change kind: {other}"),
            });
        }
    })
}

fn parse_native_memory_risk(raw: &str) -> Result<NativeMemoryRisk> {
    Ok(match raw {
        "low" => NativeMemoryRisk::Low,
        "medium" => NativeMemoryRisk::Medium,
        "high" => NativeMemoryRisk::High,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown native memory risk: {other}"),
            });
        }
    })
}

fn parse_native_memory_approval_state(raw: &str) -> Result<NativeMemoryApprovalState> {
    Ok(match raw {
        "auto_applied" => NativeMemoryApprovalState::AutoApplied,
        "awaiting_approval" => NativeMemoryApprovalState::AwaitingApproval,
        "approved" => NativeMemoryApprovalState::Approved,
        "denied" => NativeMemoryApprovalState::Denied,
        "reverted" => NativeMemoryApprovalState::Reverted,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown native memory approval state: {other}"),
            });
        }
    })
}

fn parse_json_value(raw: &str, field: &str) -> Result<serde_json::Value> {
    serde_json::from_str(raw).map_err(|e| GalleyError::Internal {
        message: format!("native memory {field} stored invalid JSON: {e}"),
    })
}

fn parse_string_array_json(raw: &str, field: &str) -> Result<Vec<String>> {
    let value = parse_json_value(raw, field)?;
    serde_json::from_value::<Vec<String>>(value).map_err(|e| GalleyError::Internal {
        message: format!("native memory {field} is not a string array: {e}"),
    })
}
