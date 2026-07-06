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
        Ok(ManagedModelProviderRecord {
            id: self.id,
            display_name: self.display_name,
            protocol: parse_managed_model_protocol(&self.protocol)?,
            auth_kind: parse_managed_model_auth_kind(&self.auth_kind)?,
            api_base: self.api_base,
            api_key_ref: self.api_key_ref,
            credential_status: if self.has_secret != 0 {
                ManagedModelCredentialStatus::Present
            } else {
                ManagedModelCredentialStatus::Missing
            },
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
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
        Ok(ManagedModelRecord {
            id: self.id,
            provider_id: self.provider_id,
            provider_display_name: self.provider_display_name,
            display_name: self.display_name,
            protocol: parse_managed_model_protocol(&self.protocol)?,
            auth_kind: parse_managed_model_auth_kind(&self.auth_kind)?,
            api_base: self.api_base,
            model: self.model,
            api_key_ref: self.api_key_ref,
            advanced_options,
            is_default: self.is_default != 0,
            sort_order: self.sort_order,
            credential_status: if self.has_secret != 0 {
                ManagedModelCredentialStatus::Present
            } else {
                ManagedModelCredentialStatus::Missing
            },
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
pub(super) struct GoalProposalRow {
    pub(super) id: String,
    pub(super) objective: String,
    pub(super) project_id: Option<String>,
    pub(super) master_session_id: Option<String>,
    pub(super) budget_seconds: i64,
    pub(super) worker_limit: i64,
    pub(super) runtime_kind: String,
    pub(super) write_mode: String,
    pub(super) status: String,
    pub(super) internal_confirm_token: String,
    pub(super) expires_at: String,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl GoalProposalRow {
    pub(super) fn into_brief(self) -> Result<GoalProposalBrief> {
        Ok(GoalProposalBrief {
            id: GoalProposalId(self.id),
            objective: self.objective,
            project_id: self.project_id.map(ProjectId),
            master_session_id: self.master_session_id.map(SessionId),
            budget_seconds: self.budget_seconds.max(0) as u32,
            worker_limit: self.worker_limit.max(0) as u32,
            runtime_kind: parse_runtime_kind(&self.runtime_kind)?,
            write_mode: parse_goal_write_mode(&self.write_mode)?,
            status: parse_goal_proposal_status(&self.status)?,
            internal_confirm_token: self.internal_confirm_token,
            confirmation_phrase: GOAL_CONFIRMATION_PHRASE.to_string(),
            expires_at: self.expires_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct GoalRow {
    pub(super) id: String,
    pub(super) proposal_id: Option<String>,
    pub(super) project_id: String,
    pub(super) master_session_id: Option<String>,
    pub(super) objective: String,
    pub(super) status: String,
    pub(super) budget_seconds: i64,
    pub(super) worker_limit: i64,
    pub(super) runtime_kind: String,
    pub(super) write_mode: String,
    pub(super) started_at: String,
    pub(super) deadline_at: String,
    pub(super) ended_at: Option<String>,
    pub(super) latest_summary: Option<String>,
    pub(super) result_seen_at: Option<String>,
    pub(super) stop_requested: i64,
    pub(super) workspace_path: Option<String>,
    /// Scalar-subquery counters. Only the queries feeding live surfaces
    /// select them; everywhere else `#[sqlx(default)]` decodes None.
    #[sqlx(default)]
    pub(super) task_count: Option<i64>,
    #[sqlx(default)]
    pub(super) completed_task_count: Option<i64>,
    #[sqlx(default)]
    pub(super) deliverable_version: Option<i64>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl GoalRow {
    pub(super) fn into_brief(self) -> Result<GoalBrief> {
        Ok(GoalBrief {
            id: GoalId(self.id),
            proposal_id: self.proposal_id.map(GoalProposalId),
            project_id: ProjectId(self.project_id),
            master_session_id: self.master_session_id.map(SessionId),
            objective: self.objective,
            status: parse_goal_status(&self.status)?,
            budget_seconds: self.budget_seconds.max(0) as u32,
            worker_limit: self.worker_limit.max(0) as u32,
            runtime_kind: parse_runtime_kind(&self.runtime_kind)?,
            write_mode: parse_goal_write_mode(&self.write_mode)?,
            started_at: self.started_at,
            deadline_at: self.deadline_at,
            ended_at: self.ended_at,
            latest_summary: self.latest_summary,
            result_seen_at: self.result_seen_at,
            stop_requested: self.stop_requested != 0,
            workspace_path: self.workspace_path,
            task_count: self.task_count.map(|n| n.max(0) as u32),
            completed_task_count: self.completed_task_count.map(|n| n.max(0) as u32),
            deliverable_version: self.deliverable_version.map(|n| n.max(0) as u32),
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct GoalTaskRow {
    pub(super) id: String,
    pub(super) goal_id: String,
    pub(super) title: String,
    pub(super) description: Option<String>,
    pub(super) status: String,
    pub(super) owner_session_id: Option<String>,
    pub(super) scope: Option<String>,
    pub(super) result_summary: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

impl GoalTaskRow {
    pub(super) fn into_brief(self) -> Result<GoalTaskBrief> {
        Ok(GoalTaskBrief {
            id: GoalTaskId(self.id),
            goal_id: GoalId(self.goal_id),
            title: self.title,
            description: self.description,
            status: parse_goal_task_status(&self.status)?,
            owner_session_id: self.owner_session_id.map(SessionId),
            scope: self.scope,
            result_summary: self.result_summary,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(Debug, FromRow)]
pub(super) struct GoalEventRow {
    pub(super) id: i64,
    pub(super) goal_id: String,
    pub(super) task_id: Option<String>,
    pub(super) author_session_id: Option<String>,
    pub(super) event_type: String,
    pub(super) body: String,
    pub(super) created_at: String,
}

impl GoalEventRow {
    pub(super) fn into_brief(self) -> Result<GoalEventBrief> {
        Ok(GoalEventBrief {
            id: self.id,
            goal_id: GoalId(self.goal_id),
            task_id: self.task_id.map(GoalTaskId),
            author_session_id: self.author_session_id.map(SessionId),
            event_type: parse_goal_event_type(&self.event_type)?,
            body: self.body,
            created_at: self.created_at,
        })
    }
}
