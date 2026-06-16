use super::*;

pub(super) fn managed_model_select_sql(suffix: &str) -> String {
    format!(
        "SELECT \
           m.id, \
           m.provider_id, \
           p.display_name AS provider_display_name, \
           m.display_name, \
           p.protocol, \
           p.auth_kind, \
           p.api_base, \
           m.model, \
           p.api_key_ref, \
           m.advanced_options, \
           m.is_default, \
           m.sort_order, \
           CASE WHEN s.api_key_ref IS NULL THEN 0 ELSE 1 END AS has_secret, \
           m.last_validated_at, \
           m.created_at, \
           m.updated_at \
         FROM managed_models m \
         JOIN managed_model_providers p ON p.id = m.provider_id \
         LEFT JOIN managed_model_secrets s ON s.api_key_ref = p.api_key_ref \
         {suffix}"
    )
}

pub(super) async fn set_latest_model_default(tx: &mut Transaction<'_, Sqlite>) -> Result<()> {
    sqlx::query(
        "UPDATE managed_models
         SET is_default = 1
         WHERE id = (
           SELECT id FROM managed_models ORDER BY sort_order ASC, updated_at DESC LIMIT 1
         )",
    )
    .execute(&mut **tx)
    .await
    .map_err(map_sqlx_err)?;
    Ok(())
}

// ---------------- enum parsers ----------------

pub(super) fn parse_session_status(s: &str) -> Result<SessionStatus> {
    Ok(match s {
        "idle" => SessionStatus::Idle,
        "connecting" => SessionStatus::Connecting,
        "running" => SessionStatus::Running,
        "waiting_approval" => SessionStatus::WaitingApproval,
        "error" => SessionStatus::Error,
        "completed" => SessionStatus::Completed,
        "cancelled" => SessionStatus::Cancelled,
        "archived" => SessionStatus::Archived,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown session status: {other}"),
            });
        }
    })
}

pub(super) fn session_status_sql(s: SessionStatus) -> &'static str {
    match s {
        SessionStatus::Idle => "idle",
        SessionStatus::Connecting => "connecting",
        SessionStatus::Running => "running",
        SessionStatus::WaitingApproval => "waiting_approval",
        SessionStatus::Error => "error",
        SessionStatus::Completed => "completed",
        SessionStatus::Cancelled => "cancelled",
        SessionStatus::Archived => "archived",
    }
}

pub(super) fn parse_runtime_kind(s: &str) -> Result<RuntimeKind> {
    Ok(match s {
        "managed" => RuntimeKind::Managed,
        "external" => RuntimeKind::External,
        "galley_native" => RuntimeKind::GalleyNative,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown runtime kind: {other}"),
            });
        }
    })
}

pub(super) fn runtime_kind_sql(kind: RuntimeKind) -> &'static str {
    match kind {
        RuntimeKind::Managed => "managed",
        RuntimeKind::External => "external",
        RuntimeKind::GalleyNative => "galley_native",
    }
}

pub(super) fn parse_goal_proposal_status(s: &str) -> Result<GoalProposalStatus> {
    Ok(match s {
        "awaiting_confirmation" => GoalProposalStatus::AwaitingConfirmation,
        "started" => GoalProposalStatus::Started,
        "cancelled" => GoalProposalStatus::Cancelled,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown goal proposal status: {other}"),
            });
        }
    })
}

pub(super) fn goal_proposal_status_sql(s: GoalProposalStatus) -> &'static str {
    match s {
        GoalProposalStatus::AwaitingConfirmation => "awaiting_confirmation",
        GoalProposalStatus::Started => "started",
        GoalProposalStatus::Cancelled => "cancelled",
    }
}

pub(super) fn parse_goal_status(s: &str) -> Result<GoalStatus> {
    Ok(match s {
        "running" => GoalStatus::Running,
        "wrapping" => GoalStatus::Wrapping,
        "completed" => GoalStatus::Completed,
        "stopped" => GoalStatus::Stopped,
        "failed" => GoalStatus::Failed,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown goal status: {other}"),
            });
        }
    })
}

pub(super) fn goal_status_sql(s: GoalStatus) -> &'static str {
    match s {
        GoalStatus::Running => "running",
        GoalStatus::Wrapping => "wrapping",
        GoalStatus::Completed => "completed",
        GoalStatus::Stopped => "stopped",
        GoalStatus::Failed => "failed",
    }
}

/// Max stored deliverable content size in bytes. 256 KiB is far beyond
/// any reasonable text deliverable; exceeding it signals runaway output,
/// so we truncate on a char boundary rather than fail the master's write.
const GOAL_DELIVERABLE_MAX_BYTES: usize = 256 * 1024;

pub(super) fn cap_goal_deliverable_content(
    content: String,
    note: Option<String>,
) -> (String, Option<String>) {
    if content.len() <= GOAL_DELIVERABLE_MAX_BYTES {
        return (content, note);
    }
    let mut end = GOAL_DELIVERABLE_MAX_BYTES;
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    let truncated = content[..end].to_string();
    let marker = "[galley: deliverable truncated at 256KB]";
    let note = Some(match note {
        Some(n) if !n.trim().is_empty() => format!("{n} · {marker}"),
        _ => marker.to_string(),
    });
    (truncated, note)
}

#[derive(sqlx::FromRow)]
pub(super) struct GoalDeliverableRow {
    id: String,
    goal_id: String,
    version: i64,
    content: String,
    note: Option<String>,
    author_session_id: Option<String>,
    created_at: String,
}

impl GoalDeliverableRow {
    pub(super) fn into_brief(self) -> GoalDeliverable {
        GoalDeliverable {
            id: self.id,
            goal_id: GoalId(self.goal_id),
            version: self.version.max(0) as u32,
            content: self.content,
            note: self.note,
            author_session_id: self.author_session_id.map(SessionId),
            created_at: self.created_at,
        }
    }
}

pub(super) fn parse_goal_write_mode(s: &str) -> Result<GoalWriteMode> {
    Ok(match s {
        "autonomous" => GoalWriteMode::Autonomous,
        "read_only" => GoalWriteMode::ReadOnly,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown goal write mode: {other}"),
            });
        }
    })
}

pub(super) fn goal_write_mode_sql(mode: GoalWriteMode) -> &'static str {
    match mode {
        GoalWriteMode::Autonomous => "autonomous",
        GoalWriteMode::ReadOnly => "read_only",
    }
}

pub(super) fn parse_goal_task_status(s: &str) -> Result<GoalTaskStatus> {
    Ok(match s {
        "open" => GoalTaskStatus::Open,
        "claimed" => GoalTaskStatus::Claimed,
        "running" => GoalTaskStatus::Running,
        "completed" => GoalTaskStatus::Completed,
        "blocked" => GoalTaskStatus::Blocked,
        "cancelled" => GoalTaskStatus::Cancelled,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown goal task status: {other}"),
            });
        }
    })
}

pub(super) fn goal_task_status_sql(s: GoalTaskStatus) -> &'static str {
    match s {
        GoalTaskStatus::Open => "open",
        GoalTaskStatus::Claimed => "claimed",
        GoalTaskStatus::Running => "running",
        GoalTaskStatus::Completed => "completed",
        GoalTaskStatus::Blocked => "blocked",
        GoalTaskStatus::Cancelled => "cancelled",
    }
}

pub(super) fn parse_goal_event_type(s: &str) -> Result<GoalEventType> {
    Ok(match s {
        "plan" => GoalEventType::Plan,
        "claim" => GoalEventType::Claim,
        "progress" => GoalEventType::Progress,
        "result" => GoalEventType::Result,
        "conflict" => GoalEventType::Conflict,
        "synthesis" => GoalEventType::Synthesis,
        "system" => GoalEventType::System,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown goal event type: {other}"),
            });
        }
    })
}

pub(super) fn goal_event_type_sql(t: GoalEventType) -> &'static str {
    match t {
        GoalEventType::Plan => "plan",
        GoalEventType::Claim => "claim",
        GoalEventType::Progress => "progress",
        GoalEventType::Result => "result",
        GoalEventType::Conflict => "conflict",
        GoalEventType::Synthesis => "synthesis",
        GoalEventType::System => "system",
    }
}

pub(super) fn parse_managed_model_protocol(s: &str) -> Result<ManagedModelProtocol> {
    Ok(match s {
        "anthropic" => ManagedModelProtocol::Anthropic,
        "openai" => ManagedModelProtocol::Openai,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown managed model protocol: {other}"),
            });
        }
    })
}

pub(super) fn managed_model_protocol_sql(protocol: ManagedModelProtocol) -> &'static str {
    match protocol {
        ManagedModelProtocol::Anthropic => "anthropic",
        ManagedModelProtocol::Openai => "openai",
    }
}

pub(super) fn parse_managed_model_auth_kind(s: &str) -> Result<ManagedModelAuthKind> {
    Ok(match s {
        "api_key" => ManagedModelAuthKind::ApiKey,
        "chatgpt_codex_oauth" => ManagedModelAuthKind::ChatgptCodexOauth,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown managed model auth kind: {other}"),
            });
        }
    })
}

pub(super) fn managed_model_auth_kind_sql(auth_kind: ManagedModelAuthKind) -> &'static str {
    match auth_kind {
        ManagedModelAuthKind::ApiKey => "api_key",
        ManagedModelAuthKind::ChatgptCodexOauth => "chatgpt_codex_oauth",
    }
}

pub(super) fn parse_message_role(s: &str) -> Result<MessageRole> {
    Ok(match s {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Agent,
        "system" => MessageRole::System,
        // GA's schema also persists role="tool" message rows for tool
        // results. The agent-facing API merges them into the agent's
        // turn rather than surfacing them as a distinct role.
        "tool" => MessageRole::Agent,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown message role: {other}"),
            });
        }
    })
}

pub(super) fn parse_message_visibility(s: &str) -> Result<MessageVisibility> {
    Ok(match s {
        "visible" => MessageVisibility::Visible,
        "internal" => MessageVisibility::Internal,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown message visibility: {other}"),
            });
        }
    })
}

pub(super) fn message_visibility_sql(visibility: MessageVisibility) -> &'static str {
    match visibility {
        MessageVisibility::Visible => "visible",
        MessageVisibility::Internal => "internal",
    }
}

pub(super) fn parse_origin_via(s: &str) -> Result<OriginVia> {
    Ok(match s {
        "gui" => OriginVia::Gui,
        "cli" => OriginVia::Cli,
        "supervisor" => OriginVia::Supervisor,
        "system" => OriginVia::System,
        other => {
            return Err(GalleyError::Internal {
                message: format!("unknown origin via: {other}"),
            });
        }
    })
}

pub(super) fn map_sqlx_err(e: sqlx::Error) -> GalleyError {
    GalleyError::Internal {
        message: format!("sqlx: {e}"),
    }
}

/// FK / CHECK constraint violations bubble out of sqlx as
/// `Database(...)` with no Rust-level discriminator. We want them to
/// surface as `invalid_args` (exit code 2) rather than `internal`
/// (exit code 1) so SOPs can distinguish "you passed a bad project id"
/// from "something blew up server-side". This shim looks at the SQLite
/// error message; everything else falls through to [`map_sqlx_err`].
pub(super) fn map_constraint_err(context: &str, e: sqlx::Error) -> GalleyError {
    if let sqlx::Error::Database(ref db_err) = e {
        let msg = db_err.message().to_ascii_lowercase();
        if msg.contains("foreign key")
            || msg.contains("unique")
            || msg.contains("check")
            || msg.contains("primary key")
        {
            return GalleyError::InvalidArgs {
                message: format!("{context}: {}", db_err.message()),
            };
        }
    }
    map_sqlx_err(e)
}

// ---------------- B4 M1 · transaction-aware inner helpers ----------------
//
// The owned-pool trait methods (`create_session`, `send_message`) and
// the transaction-aware variants (`*_in_tx`, B4 M1 O1 resolution for
// `session.new` atomicity) share these inner helpers. Both take
// `&mut SqliteConnection` — callers acquire the connection from the
// pool or from a `Transaction` via deref.
//
// The helpers return fully-populated `SessionBrief` / `MessageBrief`
// without an extra SELECT — every field is known from the input +
// server-side `now` + table defaults.

/// INSERT a session row. Validates `title` + `id` non-empty (matches
/// the existing `create_session` rules); maps PK / FK / CHECK
/// violations to `invalid_args` via `map_constraint_err`.
pub(super) async fn insert_session_row_inner(
    conn: &mut SqliteConnection,
    input: &CreateSessionInput,
    origin: &Origin,
) -> Result<SessionBrief> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "create_session: title must not be empty".into(),
        });
    }
    let id = input.id.trim();
    if id.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "create_session: id must not be empty".into(),
        });
    }
    let now = chrono_now_iso();
    let llm_idx: Option<i64> = input.selected_llm_index.map(|v| v as i64);
    let runtime_kind = match input.ga_runtime_kind {
        Some(kind) => kind,
        None => active_runtime_kind_inner(conn).await?,
    };
    crate::runtime::ensure_runtime_execution_available(runtime_kind)?;
    let runtime_kind_value = runtime_kind_sql(runtime_kind);
    let prompt_profile = input.prompt_profile.clone().or_else(|| {
        (runtime_kind == RuntimeKind::Managed).then(|| managed_runtime::PROMPT_PROFILE_ID.into())
    });
    sqlx::query(
        "INSERT INTO sessions (id, project_id, title, status, summary, turn_count, \
            pending_approval_count, error_count, pinned, has_unread, \
            llm_index, llm_key, llm_display_name, last_activity_at, created_at, updated_at, \
            created_via, created_by_supervisor, created_origin_note, \
            ga_runtime_kind, ga_runtime_id, prompt_profile) \
         VALUES (?, ?, ?, 'idle', NULL, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(&input.project_id)
    .bind(title)
    .bind(llm_idx)
    .bind(&input.selected_llm_key)
    .bind(&input.selected_llm_display_name)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .bind(origin.via.as_sql())
    .bind(&origin.supervisor)
    .bind(&origin.reason)
    .bind(runtime_kind_value)
    .bind(&input.ga_runtime_id)
    .bind(&prompt_profile)
    .execute(&mut *conn)
    .await
    .map_err(|e| map_constraint_err("create_session", e))?;

    Ok(SessionBrief {
        id: SessionId(id.to_string()),
        project_id: input.project_id.clone(),
        title: title.to_string(),
        status: SessionStatus::Idle,
        summary: None,
        turn_count: Some(0),
        last_activity_at: now.clone(),
        created_at: now.clone(),
        updated_at: now,
        pinned: Some(false),
        has_unread: Some(false),
        origin: (origin.via != OriginVia::Gui).then(|| origin.clone()),
        selected_llm_index: input.selected_llm_index,
        selected_llm_key: input.selected_llm_key.clone(),
        selected_llm_display_name: input.selected_llm_display_name.clone(),
        runtime_kind,
        runtime_label: runtime_kind.label().into(),
        ga_runtime_kind: runtime_kind,
        ga_runtime_id: input.ga_runtime_id.clone(),
        prompt_profile,
    })
}

pub(super) async fn active_runtime_kind_inner(conn: &mut SqliteConnection) -> Result<RuntimeKind> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM prefs WHERE key = 'active_runtime_kind' LIMIT 1")
            .fetch_optional(&mut *conn)
            .await
            .map_err(map_sqlx_err)?;

    if let Some(raw) = raw {
        let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| {
            GalleyError::InvalidArgs {
                message: format!("pref 'active_runtime_kind' stored value is not valid JSON: {e}"),
            }
        })?;
        let Some(kind) = value.as_str() else {
            return Err(GalleyError::InvalidArgs {
                message: "pref 'active_runtime_kind' must be a string".into(),
            });
        };
        let parsed = parse_runtime_kind(kind)?;
        if parsed != RuntimeKind::GalleyNative
            || crate::runtime::galley_native_experimental_enabled()
        {
            return Ok(parsed);
        }
        return active_runtime_kind_fallback_inner(conn).await;
    }

    active_runtime_kind_fallback_inner(conn).await
}

async fn active_runtime_kind_fallback_inner(conn: &mut SqliteConnection) -> Result<RuntimeKind> {
    // Defensive fallback for dev/test DBs that have not run migration 008:
    // an existing GA path means attach/external, otherwise fresh managed.
    let ga_path: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(value, '$.gaPath') FROM prefs WHERE key = 'ga_config' LIMIT 1",
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(map_sqlx_err)?;
    if ga_path.as_deref().is_some_and(|s| !s.trim().is_empty()) {
        Ok(RuntimeKind::External)
    } else {
        Ok(RuntimeKind::Managed)
    }
}

/// INSERT a user message row + bump session `last_activity_at`.
/// Validates target session exists and isn't archived (both happen
/// inside whatever connection / tx the caller provides, so a
/// concurrent archive can't sneak between check and write when the
/// caller uses a transaction).
pub(super) async fn insert_user_message_inner(
    conn: &mut SqliteConnection,
    session_id: SessionId,
    content: String,
    origin: Origin,
    visibility: MessageVisibility,
) -> Result<MessageBrief> {
    insert_message_inner(
        conn,
        session_id,
        MessageRole::User,
        content,
        origin,
        visibility,
    )
    .await
}

/// Shared writer for standalone (sequence=0) conversation messages.
/// `role` selects user vs Galley system narration; both occupy their
/// own `turn_index` so the `(turn_index, sequence)` ordering and the
/// `msg_{session}_{turn}_{role}` id stay collision-free. Assistant
/// rows are written by a different path (they hang off a user turn at
/// sequence=1), so this helper only mints `user` / `system` rows.
pub(super) async fn insert_message_inner(
    conn: &mut SqliteConnection,
    session_id: SessionId,
    role: MessageRole,
    content: String,
    origin: Origin,
    visibility: MessageVisibility,
) -> Result<MessageBrief> {
    let role_sql = match role {
        MessageRole::User => "user",
        MessageRole::System => "system",
        MessageRole::Agent => {
            return Err(GalleyError::InvalidArgs {
                message: "insert_message_inner only writes user/system rows".into(),
            });
        }
    };
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, status FROM sessions WHERE id = ?")
            .bind(&session_id.0)
            .fetch_optional(&mut *conn)
            .await
            .map_err(map_sqlx_err)?;
    let (_id, status) = row.ok_or_else(|| GalleyError::NotFound {
        message: format!("session '{}' does not exist", session_id.0),
    })?;
    if status == "archived" {
        return Err(GalleyError::InvalidArgs {
            message: format!("session {} is archived", session_id.0),
        });
    }
    let next_turn: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(turn_index), -1) + 1 FROM messages WHERE session_id = ?",
    )
    .bind(&session_id.0)
    .fetch_one(&mut *conn)
    .await
    .map_err(map_sqlx_err)?;
    let now = chrono_now_iso();
    let msg_id = format!("msg_{}_{}_{}", session_id.0, next_turn, role_sql);
    sqlx::query(
        "INSERT INTO messages \
         (id, session_id, turn_index, sequence, role, content, created_at, \
          created_via, supervisor, origin_note, visibility) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&msg_id)
    .bind(&session_id.0)
    .bind(next_turn)
    .bind(0_i64)
    .bind(role_sql)
    .bind(&content)
    .bind(&now)
    .bind(origin.via.as_sql())
    .bind(&origin.supervisor)
    .bind(&origin.reason)
    .bind(message_visibility_sql(visibility))
    .execute(&mut *conn)
    .await
    .map_err(map_sqlx_err)?;
    if visibility == MessageVisibility::Visible {
        let fts_res = async {
            sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
                .bind(&msg_id)
                .execute(&mut *conn)
                .await?;
            sqlx::query(
                "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&msg_id)
            .bind(&session_id.0)
            .bind(role_sql)
            .bind(next_turn)
            .bind(&content)
            .execute(&mut *conn)
            .await?;
            std::result::Result::<(), sqlx::Error>::Ok(())
        }
        .await;
        if let Err(e) = fts_res {
            eprintln!("[galley-core] index {role_sql} message fts failed: {e}");
        }
    }
    sqlx::query("UPDATE sessions SET last_activity_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&session_id.0)
        .execute(&mut *conn)
        .await
        .map_err(map_sqlx_err)?;
    Ok(MessageBrief {
        id: MessageId(msg_id),
        session_id,
        role,
        content,
        final_answer: None,
        created_at: now,
        summary: None,
        turn_index: Some(next_turn.max(0) as u32),
        visibility: Some(visibility),
        attachments: Vec::new(),
        origin: Some(origin),
    })
}

/// Server-side title fallback. Mirrors the GUI's
/// `DEFAULT_NEW_SESSION_TITLE = "新对话"` constant so renames /
/// creates that trim to empty don't end up with a literal blank.
pub(super) const DEFAULT_NEW_SESSION_TITLE: &str = "新对话";

/// Summary truncation budget. Matches `gui/src/stores/useAppStore.ts`
/// `truncateSummary` (80 char cap then `…`). Sidebar layout assumes
/// no wider than this for a single-line summary row.
const SUMMARY_TRUNCATE_LEN: usize = 80;

pub(super) fn truncate_summary(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= SUMMARY_TRUNCATE_LEN {
        return trimmed.to_string();
    }
    let prefix: String = trimmed.chars().take(SUMMARY_TRUNCATE_LEN).collect();
    format!("{prefix}…")
}

/// Normalise `Option<Option<String>>` patch behaviour for nullable
/// string columns. Returns `(should_write, value)`:
/// - `None` (outer) → leave the column alone
/// - `Some(None)` → write SQL NULL
/// - `Some(Some(s))` → write `s` (with leading/trailing whitespace trimmed;
///   empty after trim also lands as NULL to match the GUI's "trim → undefined" behaviour)
pub(super) fn project_nullable_patch(field: &Option<Option<String>>) -> (bool, Option<String>) {
    match field {
        None => (false, None),
        Some(None) => (true, None),
        Some(Some(v)) => {
            let t = v.trim();
            if t.is_empty() {
                (true, None)
            } else {
                (true, Some(t.to_string()))
            }
        }
    }
}

pub(super) fn goal_project_name(objective: &str) -> String {
    let trimmed = objective.trim();
    let short: String = trimmed.chars().take(48).collect();
    if short.is_empty() {
        "Goal".to_string()
    } else if trimmed.chars().count() > 48 {
        format!("Goal · {short}…")
    } else {
        format!("Goal · {short}")
    }
}

// ---------------- trait impl ----------------

pub(super) const SESSIONS_SELECT_COLS: &str = "id, project_id, title, status, summary, turn_count, \
    pinned, has_unread, last_activity_at, created_at, updated_at, \
    created_via, created_by_supervisor, created_origin_note, \
    llm_index, llm_key, llm_display_name, ga_runtime_kind, ga_runtime_id, prompt_profile";

pub(super) fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    iso_from_unix_secs(dur.as_secs() as i64)
}

pub(super) fn chrono_after_seconds_iso(seconds: u32) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    iso_from_unix_secs(dur.as_secs() as i64 + i64::from(seconds))
}

pub(super) fn iso_from_unix_secs(total_secs: i64) -> String {
    let days = total_secs / 86_400;
    let rem = total_secs % 86_400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    // Civil-from-days algorithm (Howard Hinnant) for date components.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}+00:00",
        y, m, d, hour, min, sec
    )
}

pub(super) fn mint_goal_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static GOAL_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let counter = GOAL_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x = (dur.as_nanos() as u64)
        ^ counter.rotate_left(21)
        ^ (u64::from(std::process::id())).rotate_left(32);
    x ^= x.wrapping_mul(0x9E3779B97F4A7C15);
    x ^= x >> 33;
    x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53);
    format!("{prefix}_{x:016x}")
}

pub(super) fn into_search_hit(r: SearchHitRow) -> SearchHit {
    SearchHit {
        session_id: SessionId(r.session_id),
        message_id: MessageId(r.message_id),
        snippet: r.snippet,
        rank: r.rank,
    }
}

pub(super) fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' | '%' | '_' => {
                out.push('\\');
                out.push(c);
            }
            other => out.push(other),
        }
    }
    out
}

pub(super) fn highlight_like(snippet: &str, q: &str) -> String {
    let q_chars = q.chars().count();
    if q_chars == 0 {
        return snippet.to_string();
    }
    let needle = q.to_lowercase();
    for (start, _) in snippet.char_indices() {
        let Some(end) = nth_char_boundary(snippet, start, q_chars) else {
            break;
        };
        if snippet[start..end].to_lowercase() == needle {
            return format!(
                "{}«{}»{}",
                &snippet[..start],
                &snippet[start..end],
                &snippet[end..]
            );
        }
    }
    snippet.to_string()
}

pub(super) fn nth_char_boundary(s: &str, start: usize, n: usize) -> Option<usize> {
    let mut iter = s[start..].char_indices();
    for _ in 0..n {
        iter.next()?;
    }
    Some(
        iter.next()
            .map(|(offset, _)| start + offset)
            .unwrap_or_else(|| s.len()),
    )
}
