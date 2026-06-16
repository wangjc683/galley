use crate::api::{
    GalleyApi, MessageBrief, MessageRole, MessageVisibility, SessionBrief, SessionId,
};
use crate::db::{PersistAssistantMessage, PersistToolEventPending, SqliteGalley, ToolEventRow};
use crate::error::{GalleyError, Result};
use crate::native_model::{NativeModelConfig, NativeModelResponse};
use crate::native_tools::{
    approval_for_tool_call, approval_required, execute_native_tool, parse_text_tool_calls,
    NativeToolCall, NativeToolExecutionContext, NativeToolStubResult,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokio::sync::{broadcast, mpsc};

#[derive(Debug, Clone)]
pub struct NativeTurn {
    pub assistant_message: MessageBrief,
    pub session: SessionBrief,
    pub messages: Vec<NativeMessage>,
    pub events: Vec<NativeRuntimeEvent>,
    pub model_name: String,
    pub mode: String,
    pub awaiting_user: bool,
    pub awaiting_approval: bool,
    pub close_reason: String,
    pub events_already_published: bool,
}

#[derive(Debug, Clone)]
pub enum NativeRuntimeStreamItem {
    Event(Box<NativeRuntimeEvent>),
    Closed { reason: String },
}

#[derive(Debug)]
struct NativeSessionEventState {
    tx: broadcast::Sender<NativeRuntimeStreamItem>,
    backlog: Vec<NativeRuntimeEvent>,
    closed_reason: Option<String>,
}

#[derive(Debug, Default)]
pub struct NativeRuntimeEventBus {
    sessions: Mutex<HashMap<String, NativeSessionEventState>>,
}

impl NativeRuntimeEventBus {
    pub fn start_session(&self, session_id: &str) {
        let (tx, _) = broadcast::channel(64);
        let mut sessions = self.sessions.lock().expect("native runtime event bus");
        sessions.insert(
            session_id.to_string(),
            NativeSessionEventState {
                tx,
                backlog: Vec::new(),
                closed_reason: None,
            },
        );
    }

    pub fn publish(&self, session_id: &str, event: NativeRuntimeEvent) {
        let mut sessions = self.sessions.lock().expect("native runtime event bus");
        let state = sessions.entry(session_id.to_string()).or_insert_with(|| {
            let (tx, _) = broadcast::channel(64);
            NativeSessionEventState {
                tx,
                backlog: Vec::new(),
                closed_reason: None,
            }
        });
        state.backlog.push(event.clone());
        let _ = state
            .tx
            .send(NativeRuntimeStreamItem::Event(Box::new(event)));
    }

    pub fn publish_many(&self, session_id: &str, events: &[NativeRuntimeEvent]) {
        for event in events {
            self.publish(session_id, event.clone());
        }
    }

    pub fn close_session(&self, session_id: &str, reason: impl Into<String>) {
        let reason = reason.into();
        let mut sessions = self.sessions.lock().expect("native runtime event bus");
        let state = sessions.entry(session_id.to_string()).or_insert_with(|| {
            let (tx, _) = broadcast::channel(64);
            NativeSessionEventState {
                tx,
                backlog: Vec::new(),
                closed_reason: None,
            }
        });
        state.closed_reason = Some(reason.clone());
        let _ = state.tx.send(NativeRuntimeStreamItem::Closed { reason });
    }

    pub fn subscribe(
        &self,
        session_id: &str,
    ) -> Option<mpsc::UnboundedReceiver<NativeRuntimeStreamItem>> {
        let (backlog, closed_reason, mut live_rx) = {
            let sessions = self.sessions.lock().expect("native runtime event bus");
            let state = sessions.get(session_id)?;
            (
                state.backlog.clone(),
                state.closed_reason.clone(),
                state.tx.subscribe(),
            )
        };

        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            for event in backlog {
                if tx
                    .send(NativeRuntimeStreamItem::Event(Box::new(event)))
                    .is_err()
                {
                    return;
                }
            }
            if let Some(reason) = closed_reason {
                let _ = tx.send(NativeRuntimeStreamItem::Closed { reason });
                return;
            }
            loop {
                match live_rx.recv().await {
                    Ok(item) => {
                        let closed = matches!(item, NativeRuntimeStreamItem::Closed { .. });
                        if tx.send(item).is_err() || closed {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = tx.send(NativeRuntimeStreamItem::Closed {
                            reason: "native_stream_closed".to_string(),
                        });
                        return;
                    }
                }
            }
        });
        Some(rx)
    }
}

pub fn event_bus() -> &'static NativeRuntimeEventBus {
    static BUS: OnceLock<NativeRuntimeEventBus> = OnceLock::new();
    BUS.get_or_init(NativeRuntimeEventBus::default)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeContentBlock {
    Text { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMessage {
    pub role: NativeRole,
    pub content: Vec<NativeContentBlock>,
}

impl NativeMessage {
    pub fn text(role: NativeRole, text: impl Into<String>) -> Self {
        Self {
            role,
            content: vec![NativeContentBlock::Text { text: text.into() }],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NativeRuntimeEvent {
    RuntimeReady(NativeRuntimeReadyEvent),
    TurnStart(NativeTurnStartEvent),
    TurnProgress(NativeTurnProgressEvent),
    ToolPending(NativeToolPendingEvent),
    ApprovalPending(NativeApprovalPendingEvent),
    ApprovalResolved(NativeApprovalResolvedEvent),
    ToolStart(NativeToolStartEvent),
    ToolProgress(NativeToolProgressEvent),
    ToolEnd(NativeToolEndEvent),
    AskUser(NativeAskUserEvent),
    TurnEnd(NativeTurnEndEvent),
    RunComplete(NativeRunCompleteEvent),
    RuntimeError(NativeRuntimeErrorEvent),
}

impl NativeRuntimeEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RuntimeReady(_) => "runtime_ready",
            Self::TurnStart(_) => "turn_start",
            Self::TurnProgress(_) => "turn_progress",
            Self::ToolPending(_) => "tool_pending",
            Self::ApprovalPending(_) => "approval_pending",
            Self::ApprovalResolved(_) => "approval_resolved",
            Self::ToolStart(_) => "tool_start",
            Self::ToolProgress(_) => "tool_progress",
            Self::ToolEnd(_) => "tool_end",
            Self::AskUser(_) => "ask_user",
            Self::TurnEnd(_) => "turn_end",
            Self::RunComplete(_) => "run_complete",
            Self::RuntimeError(_) => "runtime_error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeReadyEvent {
    pub session_id: String,
    pub runtime_kind: String,
    pub model_name: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTurnStartEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub visibility: MessageVisibility,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTurnProgressEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub delta: String,
    pub source: String,
    pub visibility: MessageVisibility,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolPendingEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub source: String,
    pub risk_hint: Option<String>,
    pub approval: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeApprovalPendingEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub policy: String,
    pub reason: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeApprovalResolvedEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub decision: String,
    pub decided_by: String,
    pub note: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolStartEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub executor: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolProgressEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolEndEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub tool_name: String,
    pub status: String,
    pub result: serde_json::Value,
    pub side_effects_performed: bool,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAskUserEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub tool_call_id: String,
    pub question: String,
    pub candidates: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTurnEndEvent {
    pub session_id: String,
    pub turn_index: u32,
    pub summary: String,
    pub response_content: String,
    pub output: NativeMessage,
    pub tool_calls: Vec<serde_json::Value>,
    pub tool_results: Vec<serde_json::Value>,
    pub visibility: MessageVisibility,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRunCompleteEvent {
    pub session_id: String,
    pub exit_reason: serde_json::Value,
    pub final_content: String,
    pub total_turns: u32,
    pub visibility: MessageVisibility,
    pub stop_reason: Option<String>,
    pub usage: Option<serde_json::Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeErrorEvent {
    pub session_id: String,
    pub category: String,
    pub message: String,
    pub hint: Option<String>,
    pub timestamp: String,
}

pub async fn run_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    command_name: &str,
    mark_unread: bool,
    model: Option<NativeModelConfig>,
) -> Result<NativeTurn> {
    match model {
        Some(model) => {
            run_model_turn(galley, session_id, turn_index, task, mark_unread, model).await
        }
        None => {
            run_mock_turn(
                galley,
                session_id,
                turn_index,
                task,
                command_name,
                mark_unread,
            )
            .await
        }
    }
}

pub async fn run_mock_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    command_name: &str,
    mark_unread: bool,
) -> Result<NativeTurn> {
    let final_answer = mock_final_answer(task, command_name);
    let summary = mock_summary(task);
    let messages = vec![
        NativeMessage::text(NativeRole::User, task.trim()),
        NativeMessage::text(NativeRole::Assistant, final_answer.clone()),
    ];
    let tool_context = native_tool_context(galley, &session_id).await?;
    let trace = native_event_trace_with_context(
        session_id.as_str(),
        turn_index,
        &final_answer,
        &summary,
        native_now_iso(),
        "Galley Native mock",
        "mock_model",
        "mock",
        None,
        None,
        &tool_context,
    );
    persist_native_turn(
        galley,
        session_id,
        turn_index,
        final_answer,
        summary,
        messages,
        trace.events,
        trace.tool_calls,
        trace.tool_results,
        trace.awaiting_user,
        trace.pending_approval,
        "Galley Native mock".to_string(),
        "mock".to_string(),
        mark_unread,
        false,
    )
    .await
}

async fn run_model_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    mark_unread: bool,
    model: NativeModelConfig,
) -> Result<NativeTurn> {
    if model.streaming_enabled() {
        return run_streaming_model_turn(galley, session_id, turn_index, task, mark_unread, model)
            .await;
    }

    let model_response = crate::native_model::complete_no_tool_turn(&model, task).await?;
    let first_answer = model_response.content.trim().to_string();
    let NativeModelResponse {
        model_name: first_model_name,
        stop_reason: first_stop_reason,
        usage: first_usage,
        ..
    } = model_response;
    let tool_context = native_tool_context(galley, &session_id).await?;
    let session_id_str = session_id.as_str().to_string();
    let first_timestamp = native_now_iso();
    let tool_trace = native_tool_trace(
        &session_id_str,
        turn_index,
        &first_answer,
        first_timestamp.clone(),
        &tool_context,
    );
    let mut final_answer = first_answer.clone();
    let mut model_name = first_model_name;
    let mut mode = "model".to_string();
    let mut stop_reason = first_stop_reason;
    let mut usage = first_usage.clone();
    let mut events = vec![
        runtime_ready_event(
            &session_id_str,
            &model.display_name,
            first_timestamp.clone(),
        ),
        turn_start_event(&session_id_str, turn_index, first_timestamp.clone()),
        turn_progress_event(
            &session_id_str,
            turn_index,
            &first_answer,
            "model",
            first_timestamp.clone(),
        ),
    ];
    events.extend(tool_trace.events.clone());

    if should_continue_after_file_read(&tool_trace) {
        let continuation_response = crate::native_model::complete_tool_result_turn(
            &model,
            task,
            &first_answer,
            &tool_trace.tool_results,
        )
        .await?;
        final_answer = continuation_response.content.trim().to_string();
        model_name = continuation_response.model_name;
        mode = "model_continuation".to_string();
        stop_reason = continuation_response.stop_reason;
        usage = continuation_usage(first_usage, continuation_response.usage);
        events.push(turn_progress_event(
            &session_id_str,
            turn_index,
            &final_answer,
            "model_continuation",
            native_now_iso(),
        ));
    }

    let summary = model_summary(task, &final_answer);
    events.extend([
        turn_end_event(
            &session_id_str,
            turn_index,
            &final_answer,
            &summary,
            tool_trace.tool_calls.clone(),
            tool_trace.tool_results.clone(),
            native_now_iso(),
        ),
        run_complete_event(
            &session_id_str,
            &final_answer,
            &mode,
            tool_trace.awaiting_user,
            tool_trace.pending_approval.is_some(),
            stop_reason,
            usage,
            native_now_iso(),
        ),
    ]);
    let messages = vec![
        NativeMessage::text(NativeRole::User, task.trim()),
        NativeMessage::text(NativeRole::Assistant, final_answer.clone()),
    ];
    let trace = NativeRuntimeTrace {
        events,
        tool_calls: tool_trace.tool_calls,
        tool_results: tool_trace.tool_results,
        awaiting_user: tool_trace.awaiting_user,
        pending_approval: tool_trace.pending_approval,
    };
    persist_native_turn(
        galley,
        session_id,
        turn_index,
        final_answer,
        summary,
        messages,
        trace.events,
        trace.tool_calls,
        trace.tool_results,
        trace.awaiting_user,
        trace.pending_approval,
        model_name,
        mode,
        mark_unread,
        false,
    )
    .await
}

async fn run_streaming_model_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    mark_unread: bool,
    model: NativeModelConfig,
) -> Result<NativeTurn> {
    let session_id_str = session_id.as_str().to_string();
    let tool_context = native_tool_context(galley, &session_id).await?;
    let mut events = Vec::new();
    let ready = runtime_ready_event(&session_id_str, &model.display_name, native_now_iso());
    event_bus().publish(&session_id_str, ready.clone());
    events.push(ready);
    let start = turn_start_event(&session_id_str, turn_index, native_now_iso());
    event_bus().publish(&session_id_str, start.clone());
    events.push(start);

    let model_response =
        crate::native_model::complete_no_tool_turn_with_delta(&model, task, |delta| {
            let event = turn_progress_event(
                &session_id_str,
                turn_index,
                delta,
                "model_stream",
                native_now_iso(),
            );
            event_bus().publish(&session_id_str, event.clone());
            events.push(event);
        })
        .await?;

    let final_answer = model_response.content.trim().to_string();
    let summary = model_summary(task, &final_answer);
    let messages = vec![
        NativeMessage::text(NativeRole::User, task.trim()),
        NativeMessage::text(NativeRole::Assistant, final_answer.clone()),
    ];
    let NativeModelResponse {
        model_name,
        stop_reason,
        usage,
        ..
    } = model_response;
    let tool_trace = native_tool_trace(
        &session_id_str,
        turn_index,
        &final_answer,
        native_now_iso(),
        &tool_context,
    );
    for event in &tool_trace.events {
        event_bus().publish(&session_id_str, event.clone());
    }
    events.extend(tool_trace.events.clone());
    let end = turn_end_event(
        &session_id_str,
        turn_index,
        &final_answer,
        &summary,
        tool_trace.tool_calls.clone(),
        tool_trace.tool_results.clone(),
        native_now_iso(),
    );
    event_bus().publish(&session_id_str, end.clone());
    events.push(end);
    let complete = run_complete_event(
        &session_id_str,
        &final_answer,
        "model_stream",
        tool_trace.awaiting_user,
        tool_trace.pending_approval.is_some(),
        stop_reason,
        usage,
        native_now_iso(),
    );
    event_bus().publish(&session_id_str, complete.clone());
    events.push(complete);

    persist_native_turn(
        galley,
        session_id,
        turn_index,
        final_answer,
        summary,
        messages,
        events,
        tool_trace.tool_calls,
        tool_trace.tool_results,
        tool_trace.awaiting_user,
        tool_trace.pending_approval,
        model_name,
        "model_stream".to_string(),
        mark_unread,
        true,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn persist_native_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    final_answer: String,
    summary: String,
    messages: Vec<NativeMessage>,
    events: Vec<NativeRuntimeEvent>,
    tool_calls: Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
    awaiting_user: bool,
    pending_approval: Option<NativePendingApproval>,
    model_name: String,
    mode: String,
    mark_unread: bool,
    events_already_published: bool,
) -> Result<NativeTurn> {
    let tool_calls_json =
        serde_json::to_string(&tool_calls).map_err(|err| GalleyError::Internal {
            message: format!("serialize native tool calls: {err}"),
        })?;
    let tool_results_json =
        serde_json::to_string(&tool_results).map_err(|err| GalleyError::Internal {
            message: format!("serialize native tool results: {err}"),
        })?;
    galley
        .persist_gui_assistant_message(PersistAssistantMessage {
            session_id: session_id.clone(),
            turn_index,
            content: final_answer.clone(),
            tool_calls: Some(tool_calls_json),
            tool_results: Some(tool_results_json),
            thinking: None,
            final_answer: Some(final_answer),
            summary: Some(summary.clone()),
            preamble: None,
            visibility: MessageVisibility::Visible,
        })
        .await?;
    galley
        .bump_session_after_turn(session_id.clone(), Some(summary), None, mark_unread)
        .await?;
    if let Some(pending) = &pending_approval {
        galley
            .persist_tool_event_pending(PersistToolEventPending {
                approval_id: pending.call.id.clone(),
                session_id: session_id.clone(),
                turn_index,
                tool_name: pending.call.name.clone(),
                args: pending.call.arguments_json.clone(),
                args_preview: native_tool_args_preview(&pending.call),
                risk_level: native_risk_level(&pending.approval).to_string(),
                started_at: native_now_iso(),
            })
            .await?;
    }
    let session = if pending_approval.is_some() {
        galley
            .set_native_session_waiting_for_approval(session_id.clone())
            .await?
    } else if awaiting_user {
        galley
            .set_native_session_waiting_for_user(session_id.clone())
            .await?
    } else {
        galley.set_native_session_idle(session_id.clone()).await?
    };
    let assistant_message = galley
        .session_messages(session_id.clone(), Some(1))
        .await?
        .into_iter()
        .find(|message| message.role == MessageRole::Agent)
        .ok_or_else(|| GalleyError::Internal {
            message: format!("native turn missing assistant message for {session_id}"),
        })?;
    Ok(NativeTurn {
        assistant_message,
        session,
        messages,
        events,
        model_name,
        mode,
        awaiting_user,
        awaiting_approval: pending_approval.is_some(),
        close_reason: if awaiting_user {
            "native_waiting_user".to_string()
        } else if pending_approval.is_some() {
            "native_waiting_approval".to_string()
        } else {
            "native_run_complete".to_string()
        },
        events_already_published,
    })
}

pub fn runtime_error_event(
    session_id: &str,
    category: impl Into<String>,
    message: impl Into<String>,
    hint: Option<String>,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::RuntimeError(NativeRuntimeErrorEvent {
        session_id: session_id.to_string(),
        category: category.into(),
        message: message.into(),
        hint,
        timestamp: native_now_iso(),
    })
}

async fn native_tool_context(
    galley: &SqliteGalley,
    session_id: &SessionId,
) -> Result<NativeToolExecutionContext> {
    let session = galley.session_brief(session_id.clone()).await?;
    let workspace_root = if let Some(project_id) = session.project_id.as_deref() {
        galley
            .list_projects()
            .await?
            .into_iter()
            .find(|project| project.id.as_str() == project_id)
            .and_then(|project| project.root_path)
            .map(PathBuf::from)
    } else {
        None
    };
    Ok(NativeToolExecutionContext::new(workspace_root))
}

#[derive(Debug, Clone)]
pub struct NativeApprovalResolution {
    pub session: SessionBrief,
    pub events: Vec<NativeRuntimeEvent>,
    pub tool_result: serde_json::Value,
    pub assistant_message: Option<MessageBrief>,
    pub close_reason: String,
}

pub async fn resolve_native_approval(
    galley: &SqliteGalley,
    session_id: SessionId,
    approval_id: &str,
    decision: &str,
) -> Result<NativeApprovalResolution> {
    let row = galley
        .native_tool_event_by_approval_id(&session_id, approval_id)
        .await?;
    if row.status != "waiting_approval" {
        return Err(GalleyError::InvalidArgs {
            message: format!("approval {approval_id} is not waiting for a decision"),
        });
    }
    let turn_index = u32::try_from(row.turn_index).map_err(|_| GalleyError::Internal {
        message: format!("invalid native approval turn index: {}", row.turn_index),
    })?;
    let call = native_tool_call_from_row(&row)?;
    let tool_context = native_tool_context(galley, &session_id).await?;
    let timestamp = native_now_iso();
    let mut events = Vec::new();
    events.push(approval_resolved_event(
        session_id.as_str(),
        turn_index,
        &call,
        decision,
        "operator",
        "Native approval decision recorded through Galley Core.",
        timestamp.clone(),
    ));

    let result = if decision == "deny" {
        NativeToolStubResult {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            status: "denied".to_string(),
            content: "Tool call denied by operator; no side effect was performed.".to_string(),
            side_effects_performed: false,
            requires_user_response: false,
            approval: approval_for_tool_call(&call, &tool_context),
        }
    } else {
        events.push(tool_start_event(
            session_id.as_str(),
            turn_index,
            &call,
            timestamp.clone(),
        ));
        events.push(tool_progress_event(
            session_id.as_str(),
            turn_index,
            &call,
            timestamp.clone(),
        ));
        execute_native_tool(&call, &tool_context)
    };
    events.push(tool_end_event(
        session_id.as_str(),
        turn_index,
        &call,
        &result,
        timestamp.clone(),
    ));
    let tool_result = tool_result_value(&result);
    let tool_results = vec![tool_result.clone()];
    galley
        .update_native_assistant_tool_results(session_id.clone(), turn_index, tool_results.clone())
        .await?;
    galley
        .complete_native_tool_event_approval(
            approval_id,
            decision,
            if decision == "deny" {
                "denied"
            } else {
                "success"
            },
            &result.content,
            &timestamp,
        )
        .await?;
    let mut assistant_message = None;
    let mut final_content = result.content.clone();
    let mut mode = "approval_response".to_string();
    let mut stop_reason = None;
    let mut usage = None;
    if decision != "deny" && result.tool_name == "file_read" && result.status == "success" {
        match continue_after_approved_file_read(
            galley,
            &session_id,
            turn_index,
            &call,
            &tool_results,
        )
        .await
        {
            Ok(Some(continuation)) => {
                final_content = continuation.final_answer;
                mode = "approval_response_continuation".to_string();
                stop_reason = continuation.stop_reason;
                usage = continuation.usage;
                assistant_message = Some(continuation.assistant_message);
                events.push(turn_progress_event(
                    session_id.as_str(),
                    turn_index,
                    &final_content,
                    "model_continuation",
                    native_now_iso(),
                ));
                events.push(turn_end_event(
                    session_id.as_str(),
                    turn_index,
                    &final_content,
                    &continuation.summary,
                    vec![tool_call_value(&call)],
                    tool_results.clone(),
                    native_now_iso(),
                ));
            }
            Ok(None) => {
                events.push(runtime_error_event(
                    session_id.as_str(),
                    "model_continuation",
                    "approved file_read continuation skipped because no usable native model is available",
                    Some("The approved file_read result was recorded, but Galley Native could not produce a follow-up answer.".to_string()),
                ));
            }
            Err(err) => {
                events.push(runtime_error_event(
                    session_id.as_str(),
                    "model_continuation",
                    format!("approved file_read continuation failed: {err}"),
                    Some("The approved file_read result was recorded, but Galley Native could not produce a follow-up answer.".to_string()),
                ));
            }
        }
    }
    let session = galley.set_native_session_idle(session_id.clone()).await?;
    events.push(run_complete_event(
        session_id.as_str(),
        &final_content,
        &mode,
        false,
        false,
        stop_reason,
        usage,
        timestamp,
    ));
    Ok(NativeApprovalResolution {
        session,
        events,
        tool_result,
        assistant_message,
        close_reason: "native_run_complete".to_string(),
    })
}

pub fn event_kind_sequence(events: &[NativeRuntimeEvent]) -> Vec<&'static str> {
    events.iter().map(NativeRuntimeEvent::kind).collect()
}

fn mock_final_answer(task: &str, command_name: &str) -> String {
    let task = task.trim();
    format!(
        "Galley Native mock response\n\n\
         Command: {command_name}\n\
         Runtime: galley_native\n\n\
         Received task:\n{task}\n\n\
         Slice 2 has created the native session and persisted this deterministic answer. \
         Real model adapters, tools, memory, browser control, Goal Hive, and Morphling are not active in this slice."
    )
}

fn mock_summary(task: &str) -> String {
    let mut preview = task
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if preview.is_empty() {
        preview = "native mock turn".to_string();
    }
    format!("Galley Native mock: {preview}")
}

fn model_summary(task: &str, final_answer: &str) -> String {
    let mut preview = final_answer
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_else(|| task.lines().next().unwrap_or(""))
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if preview.is_empty() {
        preview = "native model turn".to_string();
    }
    format!("Galley Native model: {preview}")
}

#[derive(Debug, Clone)]
struct NativeToolTrace {
    events: Vec<NativeRuntimeEvent>,
    tool_calls: Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
    awaiting_user: bool,
    pending_approval: Option<NativePendingApproval>,
}

#[derive(Debug, Clone)]
struct NativeRuntimeTrace {
    events: Vec<NativeRuntimeEvent>,
    tool_calls: Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
    awaiting_user: bool,
    pending_approval: Option<NativePendingApproval>,
}

#[derive(Debug, Clone)]
struct NativePendingApproval {
    call: NativeToolCall,
    approval: String,
}

struct NativeApprovalContinuation {
    assistant_message: MessageBrief,
    final_answer: String,
    summary: String,
    stop_reason: Option<String>,
    usage: Option<serde_json::Value>,
}

async fn continue_after_approved_file_read(
    galley: &SqliteGalley,
    session_id: &SessionId,
    turn_index: u32,
    call: &NativeToolCall,
    tool_results: &[serde_json::Value],
) -> Result<Option<NativeApprovalContinuation>> {
    let session = galley.session_brief(session_id.clone()).await?;
    let Some(model) = crate::native_model::load_selected_or_default_model(
        galley,
        session.selected_llm_key.as_deref(),
    )
    .await?
    else {
        return Ok(None);
    };
    let (task, assistant_tool_request) =
        native_turn_continuation_context(galley, session_id, turn_index, call).await?;
    let response = crate::native_model::complete_tool_result_turn(
        &model,
        &task,
        &assistant_tool_request,
        tool_results,
    )
    .await?;
    let final_answer = response.content.trim().to_string();
    let summary = model_summary(&task, &final_answer);
    let assistant_message = galley
        .update_native_assistant_after_approval(
            session_id.clone(),
            turn_index,
            &final_answer,
            &summary,
            tool_results.to_vec(),
        )
        .await?;
    let _ = galley
        .update_native_session_summary(session_id.clone(), &summary)
        .await?;
    Ok(Some(NativeApprovalContinuation {
        assistant_message,
        final_answer,
        summary,
        stop_reason: response.stop_reason,
        usage: response.usage,
    }))
}

async fn native_turn_continuation_context(
    galley: &SqliteGalley,
    session_id: &SessionId,
    turn_index: u32,
    call: &NativeToolCall,
) -> Result<(String, String)> {
    let messages = galley.session_messages(session_id.clone(), None).await?;
    let task = messages
        .iter()
        .find(|message| {
            message.role == MessageRole::User && message.turn_index == Some(turn_index)
        })
        .map(|message| message.content.clone())
        .ok_or_else(|| GalleyError::Internal {
            message: format!("native approval continuation missing user message for {session_id} turn {turn_index}"),
        })?;
    let fallback_request = tool_call_value(call).to_string();
    let assistant_tool_request = messages
        .iter()
        .find(|message| {
            message.role == MessageRole::Agent && message.turn_index == Some(turn_index)
        })
        .and_then(|message| {
            message
                .final_answer
                .as_deref()
                .or(Some(message.content.as_str()))
        })
        .map(str::to_string)
        .unwrap_or(fallback_request);
    Ok((task, assistant_tool_request))
}

fn should_continue_after_file_read(trace: &NativeToolTrace) -> bool {
    !trace.awaiting_user
        && trace.pending_approval.is_none()
        && trace.tool_results.iter().any(|result| {
            result.get("toolName").and_then(serde_json::Value::as_str) == Some("file_read")
        })
}

fn continuation_usage(
    first_usage: Option<serde_json::Value>,
    continuation_usage: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    match (first_usage, continuation_usage) {
        (None, None) => None,
        (None, Some(usage)) | (Some(usage), None) => Some(usage),
        (Some(initial), Some(continuation)) => Some(serde_json::json!({
            "initial": initial,
            "continuation": continuation
        })),
    }
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn native_event_trace(
    session_id: &str,
    turn_index: u32,
    final_answer: &str,
    summary: &str,
    timestamp: String,
    model_name: &str,
    progress_source: &str,
    mode: &str,
    stop_reason: Option<String>,
    usage: Option<serde_json::Value>,
) -> NativeRuntimeTrace {
    native_event_trace_with_context(
        session_id,
        turn_index,
        final_answer,
        summary,
        timestamp,
        model_name,
        progress_source,
        mode,
        stop_reason,
        usage,
        &NativeToolExecutionContext::default(),
    )
}

#[allow(clippy::too_many_arguments)]
fn native_event_trace_with_context(
    session_id: &str,
    turn_index: u32,
    final_answer: &str,
    summary: &str,
    timestamp: String,
    model_name: &str,
    progress_source: &str,
    mode: &str,
    stop_reason: Option<String>,
    usage: Option<serde_json::Value>,
    tool_context: &NativeToolExecutionContext,
) -> NativeRuntimeTrace {
    let tool_trace = native_tool_trace(
        session_id,
        turn_index,
        final_answer,
        timestamp.clone(),
        tool_context,
    );
    let mut events = vec![
        runtime_ready_event(session_id, model_name, timestamp.clone()),
        turn_start_event(session_id, turn_index, timestamp.clone()),
        turn_progress_event(
            session_id,
            turn_index,
            final_answer,
            progress_source,
            timestamp.clone(),
        ),
    ];
    events.extend(tool_trace.events.clone());
    events.extend([
        turn_end_event(
            session_id,
            turn_index,
            final_answer,
            summary,
            tool_trace.tool_calls.clone(),
            tool_trace.tool_results.clone(),
            timestamp.clone(),
        ),
        run_complete_event(
            session_id,
            final_answer,
            mode,
            tool_trace.awaiting_user,
            tool_trace.pending_approval.is_some(),
            stop_reason,
            usage,
            timestamp,
        ),
    ]);
    NativeRuntimeTrace {
        events,
        tool_calls: tool_trace.tool_calls,
        tool_results: tool_trace.tool_results,
        awaiting_user: tool_trace.awaiting_user,
        pending_approval: tool_trace.pending_approval,
    }
}

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn mock_event_trace(
    session_id: &str,
    turn_index: u32,
    final_answer: &str,
    summary: &str,
    timestamp: String,
    model_name: &str,
    progress_source: &str,
    mode: &str,
    stop_reason: Option<String>,
    usage: Option<serde_json::Value>,
) -> Vec<NativeRuntimeEvent> {
    native_event_trace(
        session_id,
        turn_index,
        final_answer,
        summary,
        timestamp,
        model_name,
        progress_source,
        mode,
        stop_reason,
        usage,
    )
    .events
}

fn native_tool_trace(
    session_id: &str,
    turn_index: u32,
    final_answer: &str,
    timestamp: String,
    tool_context: &NativeToolExecutionContext,
) -> NativeToolTrace {
    let outcome = parse_text_tool_calls(final_answer);
    let mut events = Vec::new();
    let mut tool_calls = Vec::new();
    let mut tool_results = Vec::new();
    let mut awaiting_user = false;
    let mut pending_approval = None;

    for mut call in outcome.calls {
        call.id = scoped_tool_call_id(session_id, turn_index, &call.id);
        let approval = approval_for_tool_call(&call, tool_context);
        tool_calls.push(tool_call_value(&call));
        events.push(tool_pending_event(
            session_id,
            turn_index,
            &call,
            &approval,
            timestamp.clone(),
        ));
        if approval_required(&approval) {
            events.push(approval_pending_event(
                session_id,
                turn_index,
                &call,
                &approval,
                timestamp.clone(),
            ));
            pending_approval = Some(NativePendingApproval { call, approval });
            break;
        }
        events.push(tool_start_event(
            session_id,
            turn_index,
            &call,
            timestamp.clone(),
        ));
        if call.name == "ask_user" {
            awaiting_user = true;
            events.push(ask_user_event(
                session_id,
                turn_index,
                &call,
                timestamp.clone(),
            ));
        }
        events.push(tool_progress_event(
            session_id,
            turn_index,
            &call,
            timestamp.clone(),
        ));
        let result = execute_native_tool(&call, tool_context);
        tool_results.push(tool_result_value(&result));
        events.push(tool_end_event(
            session_id,
            turn_index,
            &call,
            &result,
            timestamp.clone(),
        ));
    }

    NativeToolTrace {
        events,
        tool_calls,
        tool_results,
        awaiting_user,
        pending_approval,
    }
}

fn runtime_ready_event(
    session_id: &str,
    model_name: &str,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::RuntimeReady(NativeRuntimeReadyEvent {
        session_id: session_id.to_string(),
        runtime_kind: "galley_native".to_string(),
        model_name: model_name.to_string(),
        timestamp,
    })
}

fn turn_start_event(session_id: &str, turn_index: u32, timestamp: String) -> NativeRuntimeEvent {
    NativeRuntimeEvent::TurnStart(NativeTurnStartEvent {
        session_id: session_id.to_string(),
        turn_index,
        visibility: MessageVisibility::Visible,
        timestamp,
    })
}

fn turn_progress_event(
    session_id: &str,
    turn_index: u32,
    delta: &str,
    source: &str,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::TurnProgress(NativeTurnProgressEvent {
        session_id: session_id.to_string(),
        turn_index,
        delta: delta.to_string(),
        source: source.to_string(),
        visibility: MessageVisibility::Visible,
        timestamp,
    })
}

fn tool_pending_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    approval: &str,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ToolPending(NativeToolPendingEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        arguments: call.arguments_json.clone(),
        source: serde_json::to_value(&call.source)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| "text_fallback".to_string()),
        risk_hint: call.risk_hint.clone(),
        approval: approval.to_string(),
        timestamp,
    })
}

fn approval_pending_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    approval: &str,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ApprovalPending(NativeApprovalPendingEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        policy: approval.to_string(),
        reason: "Slice 4A records the approval surface but routes only to a no-side-effect stub."
            .to_string(),
        timestamp,
    })
}

fn approval_resolved_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    decision: &str,
    decided_by: &str,
    note: &str,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ApprovalResolved(NativeApprovalResolvedEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        decision: decision.to_string(),
        decided_by: decided_by.to_string(),
        note: note.to_string(),
        timestamp,
    })
}

fn tool_start_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ToolStart(NativeToolStartEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        executor: "native_stub".to_string(),
        timestamp,
    })
}

fn tool_progress_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ToolProgress(NativeToolProgressEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        message: "Routed to deterministic stub; no side effect executed.".to_string(),
        timestamp,
    })
}

fn ask_user_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::AskUser(NativeAskUserEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        question: ask_user_question(call),
        candidates: ask_user_candidates(call),
        timestamp,
    })
}

fn tool_end_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    result: &NativeToolStubResult,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::ToolEnd(NativeToolEndEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: result.status.clone(),
        result: tool_result_value(result),
        side_effects_performed: result.side_effects_performed,
        timestamp,
    })
}

fn ask_user_question(call: &NativeToolCall) -> String {
    call.arguments_json
        .get("question")
        .or_else(|| call.arguments_json.get("prompt"))
        .or_else(|| call.arguments_json.get("message"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|question| !question.is_empty())
        .unwrap_or("Galley Native is waiting for your input.")
        .to_string()
}

fn ask_user_candidates(call: &NativeToolCall) -> Vec<String> {
    call.arguments_json
        .get("candidates")
        .or_else(|| call.arguments_json.get("options"))
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn scoped_tool_call_id(session_id: &str, turn_index: u32, raw_id: &str) -> String {
    let safe_raw = raw_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("native_{session_id}_{turn_index}_{safe_raw}")
}

fn native_tool_args_preview(call: &NativeToolCall) -> String {
    let raw = call.arguments_json.to_string();
    raw.chars().take(240).collect()
}

fn native_tool_call_from_row(row: &ToolEventRow) -> Result<NativeToolCall> {
    let arguments_json = row
        .args_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|err| GalleyError::Internal {
            message: format!("parse native approval args: {err}"),
        })?
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(NativeToolCall {
        id: row.approval_id.clone().unwrap_or_else(|| row.id.clone()),
        name: row.tool_name.clone(),
        arguments_json,
        raw_arguments_text: row.args_json.clone(),
        source: crate::native_tools::NativeToolCallSource::Structured,
        risk_hint: row.risk_level.clone(),
    })
}

fn native_risk_level(approval: &str) -> &'static str {
    match approval {
        "durable_write" => "high",
        "risk_based" => "medium",
        _ => "low",
    }
}

fn tool_call_value(call: &NativeToolCall) -> serde_json::Value {
    serde_json::to_value(call).unwrap_or_else(|_| {
        serde_json::json!({
            "id": call.id.clone(),
            "name": call.name.clone(),
            "argumentsJson": call.arguments_json.clone(),
            "source": "text_fallback"
        })
    })
}

fn tool_result_value(result: &NativeToolStubResult) -> serde_json::Value {
    serde_json::to_value(result).unwrap_or_else(|_| {
        serde_json::json!({
            "toolCallId": result.tool_call_id.clone(),
            "toolName": result.tool_name.clone(),
            "status": result.status.clone(),
            "sideEffectsPerformed": result.side_effects_performed
        })
    })
}

fn turn_end_event(
    session_id: &str,
    turn_index: u32,
    final_answer: &str,
    summary: &str,
    tool_calls: Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
    timestamp: String,
) -> NativeRuntimeEvent {
    NativeRuntimeEvent::TurnEnd(NativeTurnEndEvent {
        session_id: session_id.to_string(),
        turn_index,
        summary: summary.to_string(),
        response_content: final_answer.to_string(),
        output: NativeMessage::text(NativeRole::Assistant, final_answer.to_string()),
        tool_calls,
        tool_results,
        visibility: MessageVisibility::Visible,
        timestamp,
    })
}

fn run_complete_event(
    session_id: &str,
    final_answer: &str,
    mode: &str,
    awaiting_user: bool,
    awaiting_approval: bool,
    stop_reason: Option<String>,
    usage: Option<serde_json::Value>,
    timestamp: String,
) -> NativeRuntimeEvent {
    let result = if awaiting_user {
        "ASK_USER"
    } else if awaiting_approval {
        "APPROVAL_REQUIRED"
    } else {
        "CURRENT_TASK_DONE"
    };
    NativeRuntimeEvent::RunComplete(NativeRunCompleteEvent {
        session_id: session_id.to_string(),
        exit_reason: serde_json::json!({
            "result": result,
            "data": {
                "runtime": "galley_native",
                "mode": mode,
                "awaitingUser": awaiting_user,
                "awaitingApproval": awaiting_approval
            }
        }),
        final_content: final_answer.to_string(),
        total_turns: 1,
        visibility: MessageVisibility::Visible,
        stop_reason,
        usage,
        timestamp,
    })
}

fn native_now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn mock_response_discloses_slice_boundary() {
        let answer = mock_final_answer("Investigate", "session.new");
        assert!(answer.contains("Galley Native mock response"));
        assert!(answer.contains("Runtime: galley_native"));
        assert!(answer.contains("Real model adapters"));
    }

    #[test]
    fn mock_event_trace_uses_ga_shaped_turn_order_without_tools() {
        let events = mock_event_trace(
            "s-native",
            0,
            "final answer",
            "mock summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );

        assert_eq!(
            event_kind_sequence(&events),
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        let turn_end = serde_json::to_value(&events[3]).unwrap();
        assert_eq!(turn_end["kind"], "turn_end");
        assert_eq!(turn_end["toolCalls"], serde_json::json!([]));
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
        assert_eq!(turn_end["output"]["role"], "assistant");
    }

    #[test]
    fn mock_event_trace_routes_no_approval_tools_to_stubs() {
        let tool_calls = ["file_read", "web_scan", "update_working_checkpoint"]
            .iter()
            .map(|name| {
                serde_json::json!({
                    "name": name,
                    "arguments": { "slice": "4A" }
                })
            })
            .collect::<Vec<_>>();
        let final_answer = format!(
            "```json\n{}\n```",
            serde_json::json!({ "tool_calls": tool_calls })
        );

        let events = mock_event_trace(
            "s-native-tools",
            0,
            &final_answer,
            "mock summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );

        let mut expected = vec!["runtime_ready", "turn_start", "turn_progress"];
        for _name in ["file_read", "web_scan", "update_working_checkpoint"] {
            expected.push("tool_pending");
            expected.push("tool_start");
            expected.push("tool_progress");
            expected.push("tool_end");
        }
        expected.extend(["turn_end", "run_complete"]);
        assert_eq!(event_kind_sequence(&events), expected);

        let turn_end = serde_json::to_value(&events[events.len() - 2]).unwrap();
        assert_eq!(turn_end["kind"], "turn_end");
        assert_eq!(turn_end["toolCalls"].as_array().unwrap().len(), 3);
        assert_eq!(turn_end["toolResults"].as_array().unwrap().len(), 3);
        assert!(turn_end["toolResults"]
            .as_array()
            .unwrap()
            .iter()
            .all(|result| result["sideEffectsPerformed"].as_bool() == Some(false)));
    }

    #[test]
    fn workspace_relative_file_read_executes_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\nbeta\n").unwrap();
        let final_answer = r#"```json
{"tool":"file_read","arguments":{"path":"notes.txt","startLine":2,"endLine":2}}
```"#;

        let trace = native_event_trace_with_context(
            "s-native-file-read",
            1,
            final_answer,
            "file read summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
        );

        assert!(trace.pending_approval.is_none());
        assert_eq!(
            event_kind_sequence(&trace.events),
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "tool_pending",
                "tool_start",
                "tool_progress",
                "tool_end",
                "turn_end",
                "run_complete"
            ]
        );
        let turn_end = serde_json::to_value(&trace.events[trace.events.len() - 2]).unwrap();
        assert_eq!(turn_end["toolResults"][0]["status"], "success");
        assert_eq!(turn_end["toolResults"][0]["approval"], "none");
        assert!(turn_end["toolResults"][0]["content"]
            .as_str()
            .unwrap()
            .contains("beta"));
    }

    #[test]
    fn absolute_file_read_outside_workspace_waits_for_approval() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), "private note").unwrap();
        let final_answer = format!(
            "```json\n{}\n```",
            serde_json::json!({
                "tool": "file_read",
                "arguments": { "path": file.path().to_string_lossy() }
            })
        );

        let trace = native_event_trace(
            "s-native-file-read-approval",
            1,
            &final_answer,
            "file read summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );

        assert!(trace.pending_approval.is_some());
        assert_eq!(
            event_kind_sequence(&trace.events),
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "tool_pending",
                "approval_pending",
                "turn_end",
                "run_complete"
            ]
        );
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
        let complete = serde_json::to_value(trace.events.last().unwrap()).unwrap();
        assert_eq!(complete["exitReason"]["result"], "APPROVAL_REQUIRED");
    }

    #[test]
    fn approval_required_tool_stops_at_pending_approval() {
        let final_answer = r#"```json
{"tool":"code_run","arguments":{"command":"echo hi"}}
```"#;

        let trace = native_event_trace(
            "s-native-approval",
            1,
            final_answer,
            "approval summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );

        assert!(trace.pending_approval.is_some());
        assert!(!trace.awaiting_user);
        assert_eq!(
            event_kind_sequence(&trace.events),
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "tool_pending",
                "approval_pending",
                "turn_end",
                "run_complete"
            ]
        );
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(turn_end["toolCalls"].as_array().unwrap().len(), 1);
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
        let complete = serde_json::to_value(trace.events.last().unwrap()).unwrap();
        assert_eq!(complete["exitReason"]["result"], "APPROVAL_REQUIRED");
        assert_eq!(
            complete["exitReason"]["data"]["awaitingApproval"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn ask_user_tool_marks_trace_waiting_for_user() {
        let final_answer = r#"```json
{"tool":"ask_user","arguments":{"question":"Which path should I use?","candidates":["A","B"]}}
```"#;

        let trace = native_event_trace(
            "s-native-ask",
            2,
            final_answer,
            "ask summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );

        assert!(trace.awaiting_user);
        assert_eq!(
            event_kind_sequence(&trace.events),
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "tool_pending",
                "tool_start",
                "ask_user",
                "tool_progress",
                "tool_end",
                "turn_end",
                "run_complete"
            ]
        );
        let ask = trace
            .events
            .iter()
            .find(|event| event.kind() == "ask_user")
            .map(serde_json::to_value)
            .transpose()
            .unwrap()
            .unwrap();
        assert_eq!(ask["question"], "Which path should I use?");
        assert_eq!(ask["candidates"], serde_json::json!(["A", "B"]));
        let complete = serde_json::to_value(trace.events.last().unwrap()).unwrap();
        assert_eq!(complete["exitReason"]["result"], "ASK_USER");
        assert_eq!(
            complete["exitReason"]["data"]["awaitingUser"].as_bool(),
            Some(true)
        );
    }

    #[test]
    fn native_message_serializes_text_content_block() {
        let msg = NativeMessage::text(NativeRole::User, "hello");
        let value = serde_json::to_value(msg).unwrap();
        assert_eq!(value["role"], "user");
        assert_eq!(value["content"][0]["type"], "text");
        assert_eq!(value["content"][0]["text"], "hello");
    }

    #[tokio::test]
    async fn event_bus_replays_closed_trace_to_late_subscriber() {
        let session_id = "s-native-bus-replay";
        let bus = NativeRuntimeEventBus::default();
        let events = mock_event_trace(
            session_id,
            0,
            "final answer",
            "mock summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
        );
        bus.start_session(session_id);
        bus.publish_many(session_id, &events);
        bus.close_session(session_id, "native_run_complete");

        let mut rx = bus.subscribe(session_id).expect("native subscription");
        let mut kinds = Vec::new();
        let mut reason = None;
        while let Some(item) = rx.recv().await {
            match item {
                NativeRuntimeStreamItem::Event(event) => kinds.push(event.kind()),
                NativeRuntimeStreamItem::Closed { reason: r } => {
                    reason = Some(r);
                    break;
                }
            }
        }

        assert_eq!(
            kinds,
            vec![
                "runtime_ready",
                "turn_start",
                "turn_progress",
                "turn_end",
                "run_complete"
            ]
        );
        assert_eq!(reason.as_deref(), Some("native_run_complete"));
    }
}
