use super::*;

#[derive(Debug, FromRow)]
pub(super) struct SessionRow {
    pub(super) id: String,
    pub(super) project_id: Option<String>,
    pub(super) title: String,
    pub(super) status: String,
    pub(super) summary: Option<String>,
    pub(super) turn_count: i64,
    pub(super) pinned: i64,
    pub(super) has_unread: i64,
    pub(super) last_activity_at: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) created_via: Option<String>,
    pub(super) created_by_supervisor: Option<String>,
    pub(super) created_origin_note: Option<String>,
    pub(super) llm_index: Option<i64>,
    pub(super) llm_key: Option<String>,
    pub(super) llm_display_name: Option<String>,
    pub(super) ga_runtime_kind: String,
    pub(super) ga_runtime_id: Option<String>,
    pub(super) prompt_profile: Option<String>,
    pub(super) approval_mode: Option<String>,
}

impl SessionRow {
    pub(super) fn into_brief(self) -> Result<SessionBrief> {
        let runtime_kind = parse_runtime_kind(&self.ga_runtime_kind)?;
        Ok(SessionBrief {
            id: SessionId(self.id),
            project_id: self.project_id,
            title: self.title,
            status: parse_session_status(&self.status)?,
            summary: self.summary,
            turn_count: Some(self.turn_count.max(0) as u32),
            last_activity_at: self.last_activity_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
            pinned: Some(self.pinned != 0),
            has_unread: Some(self.has_unread != 0),
            origin: self
                .created_via
                .map(|via| {
                    Ok(Origin {
                        via: parse_origin_via(&via)?,
                        supervisor: self.created_by_supervisor,
                        reason: self.created_origin_note,
                    })
                })
                .transpose()?
                .filter(|origin| origin.via != OriginVia::Gui),
            selected_llm_index: self.llm_index.and_then(
                |n| {
                    if n < 0 {
                        None
                    } else {
                        Some(n as u32)
                    }
                },
            ),
            selected_llm_key: self.llm_key,
            selected_llm_display_name: self.llm_display_name,
            runtime_kind,
            runtime_label: runtime_kind.label().into(),
            ga_runtime_kind: runtime_kind,
            ga_runtime_id: self.ga_runtime_id,
            prompt_profile: self.prompt_profile,
            approval_mode: self.approval_mode,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct MessageRow {
    pub(super) id: String,
    pub(super) session_id: String,
    pub(super) turn_index: i64,
    pub(super) role: String,
    pub(super) content: String,
    pub(super) final_answer: Option<String>,
    pub(super) summary: Option<String>,
    pub(super) created_via: Option<String>,
    pub(super) supervisor: Option<String>,
    pub(super) origin_note: Option<String>,
    pub(super) visibility: String,
    pub(super) goal_id: Option<String>,
    pub(super) created_at: String,
}

impl MessageRow {
    pub(super) fn into_brief(self) -> Result<MessageBrief> {
        Ok(MessageBrief {
            id: MessageId(self.id),
            session_id: SessionId(self.session_id),
            role: parse_message_role(&self.role)?,
            content: self.content,
            final_answer: self.final_answer,
            created_at: self.created_at,
            summary: self.summary,
            turn_index: Some(self.turn_index.max(0) as u32),
            visibility: Some(parse_message_visibility(&self.visibility)?),
            goal_id: self.goal_id,
            attachments: Vec::new(),
            origin: self
                .created_via
                .map(|via| {
                    Ok(Origin {
                        via: parse_origin_via(&via)?,
                        supervisor: self.supervisor,
                        reason: self.origin_note,
                    })
                })
                .transpose()?,
        })
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub(super) struct PersistedMessageRowRecord {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub sequence: i64,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub tool_results: Option<String>,
    pub thinking: Option<String>,
    pub final_answer: Option<String>,
    pub summary: Option<String>,
    pub preamble: Option<String>,
    pub created_via: Option<String>,
    pub supervisor: Option<String>,
    pub origin_note: Option<String>,
    pub visibility: String,
    pub telemetry_json: Option<String>,
    pub goal_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersistedMessageRow {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub sequence: i64,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub tool_results: Option<String>,
    pub thinking: Option<String>,
    pub final_answer: Option<String>,
    pub summary: Option<String>,
    pub preamble: Option<String>,
    pub created_via: Option<String>,
    pub supervisor: Option<String>,
    pub origin_note: Option<String>,
    pub visibility: String,
    pub telemetry: Option<MessageTelemetry>,
    pub goal_id: Option<String>,
    pub created_at: String,
    pub attachments: Vec<MessageAttachmentBrief>,
}

impl PersistedMessageRowRecord {
    pub(super) fn into_persisted(self) -> PersistedMessageRow {
        PersistedMessageRow {
            id: self.id,
            session_id: self.session_id,
            turn_index: self.turn_index,
            sequence: self.sequence,
            role: self.role,
            content: self.content,
            tool_calls: self.tool_calls,
            tool_results: self.tool_results,
            thinking: self.thinking,
            final_answer: self.final_answer,
            summary: self.summary,
            preamble: self.preamble,
            created_via: self.created_via,
            supervisor: self.supervisor,
            origin_note: self.origin_note,
            visibility: self.visibility,
            telemetry: self
                .telemetry_json
                .and_then(|raw| serde_json::from_str::<MessageTelemetry>(&raw).ok()),
            goal_id: self.goal_id,
            created_at: self.created_at,
            attachments: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, FromRow)]
pub(super) struct MessageAttachmentRow {
    pub id: String,
    pub message_id: String,
    pub session_id: String,
    pub kind: String,
    pub file_path: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub created_at: String,
}

impl MessageAttachmentRow {
    pub(super) fn into_brief(self) -> MessageAttachmentBrief {
        MessageAttachmentBrief {
            id: self.id,
            message_id: MessageId(self.message_id),
            session_id: SessionId(self.session_id),
            kind: self.kind,
            path: self.file_path,
            mime_type: self.mime_type,
            byte_size: self.byte_size.max(0) as u64,
            width: self
                .width
                .and_then(|n| if n < 0 { None } else { Some(n as u32) }),
            height: self
                .height
                .and_then(|n| if n < 0 { None } else { Some(n as u32) }),
            created_at: self.created_at,
        }
    }
}

#[derive(Debug)]
pub struct MessageAttachmentCreate {
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub struct PersistAssistantMessage {
    pub session_id: SessionId,
    pub turn_index: u32,
    pub content: String,
    pub tool_calls: Option<String>,
    pub tool_results: Option<String>,
    pub thinking: Option<String>,
    pub final_answer: Option<String>,
    pub summary: Option<String>,
    pub preamble: Option<String>,
    pub visibility: MessageVisibility,
    pub telemetry: Option<MessageTelemetry>,
}

pub struct PersistToolEventPending {
    pub approval_id: String,
    pub session_id: SessionId,
    pub turn_index: u32,
    pub tool_name: String,
    pub args: serde_json::Value,
    pub args_preview: String,
    pub risk_level: String,
    pub started_at: String,
}

pub struct UpsertManagedModelProviderMetadata {
    pub id: String,
    pub display_name: String,
    pub protocol: ManagedModelProtocol,
    pub auth_kind: ManagedModelAuthKind,
    pub api_base: String,
    pub api_key_ref: String,
}

pub struct UpsertManagedModelMetadata {
    pub id: String,
    pub provider_id: String,
    pub display_name: String,
    pub model: String,
    pub advanced_options: serde_json::Value,
    pub make_default: bool,
}

#[derive(Debug, FromRow)]
pub struct ManagedModelSecretRow {
    pub key_id: String,
    pub encryption_version: i64,
    pub algorithm: String,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, FromRow)]
pub(super) struct ManagedModelProviderRow {
    pub(super) id: String,
    pub(super) display_name: String,
    pub(super) protocol: String,
    pub(super) auth_kind: String,
    pub(super) api_base: String,
    pub(super) api_key_ref: String,
    pub(super) has_secret: i64,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl ManagedModelProviderRow {
    pub(super) fn into_record(self) -> Result<ManagedModelProviderRecord> {
        let auth_kind = parse_managed_model_auth_kind(&self.auth_kind)?;
        Ok(ManagedModelProviderRecord {
            id: self.id,
            display_name: self.display_name,
            protocol: parse_managed_model_protocol(&self.protocol)?,
            auth_kind,
            api_base: self.api_base,
            api_key_ref: self.api_key_ref,
            credential_status: managed_credential_status(auth_kind, self.has_secret),
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// A no-auth provider deliberately has no secret row — nothing is
/// missing, so every "re-enter the key" surface must stay quiet.
fn managed_credential_status(
    auth_kind: ManagedModelAuthKind,
    has_secret: i64,
) -> ManagedModelCredentialStatus {
    if has_secret != 0 || auth_kind == ManagedModelAuthKind::None {
        ManagedModelCredentialStatus::Present
    } else {
        ManagedModelCredentialStatus::Missing
    }
}

#[derive(Debug, FromRow)]
pub(super) struct ManagedModelRow {
    pub(super) id: String,
    pub(super) provider_id: String,
    pub(super) provider_display_name: String,
    pub(super) display_name: String,
    pub(super) protocol: String,
    pub(super) auth_kind: String,
    pub(super) api_base: String,
    pub(super) model: String,
    pub(super) api_key_ref: String,
    pub(super) advanced_options: String,
    pub(super) is_default: i64,
    pub(super) sort_order: i64,
    pub(super) has_secret: i64,
    pub(super) last_validated_at: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl ManagedModelRow {
    pub(super) fn into_record(self) -> Result<ManagedModelRecord> {
        let advanced_options = serde_json::from_str::<serde_json::Value>(&self.advanced_options)
            .map_err(|e| GalleyError::Internal {
                message: format!("managed model advanced_options JSON invalid: {e}"),
            })?;
        let auth_kind = parse_managed_model_auth_kind(&self.auth_kind)?;
        Ok(ManagedModelRecord {
            id: self.id,
            provider_id: self.provider_id,
            provider_display_name: self.provider_display_name,
            display_name: self.display_name,
            protocol: parse_managed_model_protocol(&self.protocol)?,
            auth_kind,
            api_base: self.api_base,
            model: self.model,
            api_key_ref: self.api_key_ref,
            advanced_options,
            is_default: self.is_default != 0,
            sort_order: self.sort_order,
            credential_status: managed_credential_status(auth_kind, self.has_secret),
            last_validated_at: self.last_validated_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageSearchHit {
    pub message_id: String,
    pub session_id: String,
    pub session_title: String,
    pub role: String,
    pub turn_index: i64,
    pub snippet: String,
    pub session_activity_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ToolEventRow {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub tool_name: String,
    pub status: String,
    pub args_json: Option<String>,
    pub args_preview: Option<String>,
    pub result_preview: Option<String>,
    pub risk_level: Option<String>,
    pub approval_id: Option<String>,
    pub approval_decision: Option<String>,
    pub elapsed_ms: Option<i64>,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, FromRow)]
pub(super) struct SearchHitRow {
    pub(super) message_id: String,
    pub(super) session_id: String,
    pub(super) snippet: String,
    /// FTS5 BM25 ranking — lower is better. Absent in the LIKE fallback
    /// (decoded as `0.0`).
    #[sqlx(default)]
    pub(super) rank: f64,
}

#[derive(Debug, FromRow)]
pub(super) struct StatusCounts {
    pub(super) total: i64,
    pub(super) running: i64,
    pub(super) waiting_input: i64,
    pub(super) errored: i64,
}

#[derive(Debug, FromRow)]
pub(super) struct ProjectRow {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) root_path: Option<String>,
    pub(super) workspace_enabled: i64,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) pinned: i64,
    pub(super) last_activity_at: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl ProjectRow {
    pub(super) fn into_brief(self) -> ProjectBrief {
        ProjectBrief {
            id: ProjectId(self.id),
            name: self.name,
            root_path: self.root_path,
            workspace_enabled: self.workspace_enabled != 0,
            icon: self.icon,
            color: self.color,
            pinned: self.pinned != 0,
            last_activity_at: self.last_activity_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, FromRow)]
pub(super) struct GoalRow {
    pub(super) id: String,
    pub(super) session_id: String,
    pub(super) objective: String,
    pub(super) status: String,
    pub(super) budget_seconds: Option<i64>,
    pub(super) started_at: String,
    pub(super) ended_at: Option<String>,
    pub(super) paused_at: Option<String>,
    pub(super) latest_summary: Option<String>,
    pub(super) result_seen_at: Option<String>,
    pub(super) continuation_count: i64,
    pub(super) wrap_up_dispatched: i64,
    pub(super) created_via: String,
    pub(super) supervisor: Option<String>,
    pub(super) origin_note: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl GoalRow {
    pub(super) fn into_brief(self) -> Result<GoalBrief> {
        let elapsed_seconds = elapsed_seconds_between(&self.started_at, self.ended_at.as_deref());
        let origin = Origin {
            via: parse_origin_via(&self.created_via)?,
            supervisor: self.supervisor,
            reason: self.origin_note,
        };
        Ok(GoalBrief {
            id: GoalId(self.id),
            session_id: SessionId(self.session_id),
            objective: self.objective,
            status: parse_goal_status(&self.status)?,
            budget_seconds: self.budget_seconds.map(|n| n.max(0) as u32),
            started_at: self.started_at,
            ended_at: self.ended_at,
            paused_at: self.paused_at,
            latest_summary: self.latest_summary,
            result_seen_at: self.result_seen_at,
            continuation_count: self.continuation_count.max(0) as u32,
            wrap_up_dispatched: self.wrap_up_dispatched != 0,
            elapsed_seconds,
            created_at: self.created_at,
            updated_at: self.updated_at,
            origin: Some(origin).filter(|o| o.via != OriginVia::Gui),
        })
    }
}

/// Wall-clock seconds between two ISO-8601 stamps (`ended_at` defaults to
/// now). Unparseable input degrades to 0 rather than failing the read:
/// elapsed time is a display figure, not a state field.
pub(super) fn elapsed_seconds_between(started_at: &str, ended_at: Option<&str>) -> u64 {
    let Ok(start) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return 0;
    };
    let end = match ended_at {
        Some(e) => match chrono::DateTime::parse_from_rfc3339(e) {
            Ok(t) => t.with_timezone(&chrono::Utc),
            Err(_) => return 0,
        },
        None => chrono::Utc::now(),
    };
    (end - start.with_timezone(&chrono::Utc))
        .num_seconds()
        .max(0) as u64
}
