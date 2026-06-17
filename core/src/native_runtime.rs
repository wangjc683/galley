use crate::api::{
    GalleyApi, MessageBrief, MessageRole, MessageVisibility, SessionBrief, SessionId,
};
use crate::db::{
    CreateNativeMemoryChangeInput, CreateNativeMemoryEvidenceInput,
    CreateNativeMemoryIndexEntryInput, CreateNativeMemoryItemInput, NativeMemoryApprovalState,
    NativeMemoryChangeKind, NativeMemoryIndexEntryRecord, NativeMemoryItemRecord,
    NativeMemoryLayer, NativeMemoryRisk, NativeMemoryScope, PersistAssistantMessage,
    PersistToolEventPending, SqliteGalley, ToolEventRow,
};
use crate::error::{GalleyError, Result};
use crate::native_model::{NativeModelConfig, NativeModelResponse};
use crate::native_tools::{
    approval_for_tool_call, approval_required, execute_native_tool, normalize_native_tool_call,
    parse_text_tool_calls, NativeBrowserExecutionContext, NativeToolCall,
    NativeToolExecutionContext, NativeToolProgressChunk, NativeToolStubResult,
};
use ring::digest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
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

#[derive(Debug, Clone, Default)]
pub struct NativeRuntimeHostContext {
    pub browser: Option<NativeBrowserExecutionContext>,
    pub browser_unavailable_reason: Option<String>,
}

impl NativeRuntimeHostContext {
    pub fn with_browser(browser: NativeBrowserExecutionContext) -> Self {
        Self {
            browser: Some(browser),
            browser_unavailable_reason: None,
        }
    }

    pub fn with_browser_unavailable(reason: impl Into<String>) -> Self {
        Self {
            browser: None,
            browser_unavailable_reason: Some(reason.into()),
        }
    }
}

pub async fn run_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    command_name: &str,
    mark_unread: bool,
    model: Option<NativeModelConfig>,
    host_context: NativeRuntimeHostContext,
) -> Result<NativeTurn> {
    galley
        .set_native_session_running(session_id.clone())
        .await?;
    let result = match model {
        Some(model) => {
            run_model_turn(
                galley,
                session_id.clone(),
                turn_index,
                task,
                mark_unread,
                model,
                host_context,
            )
            .await
        }
        None => {
            run_mock_turn(
                galley,
                session_id.clone(),
                turn_index,
                task,
                command_name,
                mark_unread,
                host_context,
            )
            .await
        }
    };
    if result.is_err() {
        let _ = galley.set_native_session_idle(session_id.clone()).await;
    }
    result
}

pub async fn run_mock_turn(
    galley: &SqliteGalley,
    session_id: SessionId,
    turn_index: u32,
    task: &str,
    command_name: &str,
    mark_unread: bool,
    host_context: NativeRuntimeHostContext,
) -> Result<NativeTurn> {
    let final_answer = mock_final_answer(task, command_name);
    let summary = mock_summary(task);
    let messages = vec![
        NativeMessage::text(NativeRole::User, task.trim()),
        NativeMessage::text(NativeRole::Assistant, final_answer.clone()),
    ];
    let tool_context = native_tool_context(galley, &session_id, &host_context).await?;
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
    host_context: NativeRuntimeHostContext,
) -> Result<NativeTurn> {
    if model.streaming_enabled() {
        return run_streaming_model_turn(
            galley,
            session_id,
            turn_index,
            task,
            mark_unread,
            model,
            host_context,
        )
        .await;
    }

    let working_checkpoint = galley.latest_native_working_checkpoint(&session_id).await?;
    let model_task =
        crate::native_model::task_with_working_checkpoint(task, working_checkpoint.as_deref());
    let model_response = crate::native_model::complete_no_tool_turn(&model, &model_task).await?;
    let first_answer = model_response.content.trim().to_string();
    let NativeModelResponse {
        model_name: first_model_name,
        stop_reason: first_stop_reason,
        usage: first_usage,
        ..
    } = model_response;
    let tool_context = native_tool_context(galley, &session_id, &host_context).await?;
    let session_id_str = session_id.as_str().to_string();
    let first_timestamp = native_now_iso();
    let mut tool_trace = native_tool_trace(
        &session_id_str,
        turn_index,
        &first_answer,
        first_timestamp.clone(),
        &tool_context,
    );
    apply_native_durable_tool_effects(galley, &session_id, turn_index, &mut tool_trace).await?;
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

    if should_continue_after_read_only_tool(&tool_trace) {
        let continuation_response = crate::native_model::complete_tool_result_turn(
            &model,
            &model_task,
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
    host_context: NativeRuntimeHostContext,
) -> Result<NativeTurn> {
    let session_id_str = session_id.as_str().to_string();
    let tool_context = native_tool_context(galley, &session_id, &host_context).await?;
    let mut events = Vec::new();
    let ready = runtime_ready_event(&session_id_str, &model.display_name, native_now_iso());
    event_bus().publish(&session_id_str, ready.clone());
    events.push(ready);
    let start = turn_start_event(&session_id_str, turn_index, native_now_iso());
    event_bus().publish(&session_id_str, start.clone());
    events.push(start);

    let working_checkpoint = galley.latest_native_working_checkpoint(&session_id).await?;
    let model_task =
        crate::native_model::task_with_working_checkpoint(task, working_checkpoint.as_deref());
    let model_response =
        crate::native_model::complete_no_tool_turn_with_delta(&model, &model_task, |delta| {
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
    let mut tool_trace = native_tool_trace(
        &session_id_str,
        turn_index,
        &final_answer,
        native_now_iso(),
        &tool_context,
    );
    apply_native_durable_tool_effects(galley, &session_id, turn_index, &mut tool_trace).await?;
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
    host_context: &NativeRuntimeHostContext,
) -> Result<NativeToolExecutionContext> {
    let session = galley.session_brief(session_id.clone()).await?;
    let project_id = session.project_id.clone();
    let project_workspace = if let Some(project_id) = session.project_id.as_deref() {
        galley
            .list_projects()
            .await?
            .into_iter()
            .find(|project| project.id.as_str() == project_id)
            .and_then(|project| project.root_path)
    } else {
        None
    };
    let workspace = native_workspace_context(
        session_id,
        project_id.as_deref(),
        project_workspace.as_deref(),
    )?;
    let workspace_root = workspace.effective_root.clone();
    let mut context = match host_context.browser.clone() {
        Some(browser) => NativeToolExecutionContext::with_browser(workspace_root, browser),
        None => NativeToolExecutionContext::new(workspace_root),
    };
    context.scratch_root = workspace.scratch_root.clone();
    context.workspace_kind = Some(workspace.kind.clone());
    context.workspace_status = Some(workspace.status.clone());
    context.browser_unavailable_reason = host_context.browser_unavailable_reason.clone();
    let capability_packs = builtin_capability_packs();
    let mut resources = native_memory_resource_files(galley, project_id.as_deref()).await?;
    let capability_resources = native_capability_resource_files(&capability_packs)?;
    let workspace_resources = native_workspace_resource_files(&workspace)?;
    attach_capability_triggers_to_memory_l1(&mut resources, &capability_packs);
    resources.extend(capability_resources);
    resources.extend(workspace_resources);
    context.resource_files = resources;
    Ok(context)
}

#[derive(Debug, Clone)]
struct NativeWorkspaceContext {
    session_id: String,
    project_id: Option<String>,
    project_workspace: Option<PathBuf>,
    effective_root: Option<PathBuf>,
    scratch_root: Option<PathBuf>,
    kind: String,
    status: String,
    recovery: Option<String>,
}

fn native_workspace_context(
    session_id: &SessionId,
    project_id: Option<&str>,
    project_workspace: Option<&str>,
) -> Result<NativeWorkspaceContext> {
    let scratch_root = crate::app_paths::native_session_scratch_dir(session_id.as_str());
    native_workspace_context_with_scratch(session_id, project_id, project_workspace, scratch_root)
}

fn native_workspace_context_with_scratch(
    session_id: &SessionId,
    project_id: Option<&str>,
    project_workspace: Option<&str>,
    scratch_root: Option<PathBuf>,
) -> Result<NativeWorkspaceContext> {
    if let Some(scratch_root) = scratch_root.as_deref() {
        fs::create_dir_all(scratch_root).map_err(|err| GalleyError::Internal {
            message: format!(
                "create native session scratch {}: {err}",
                scratch_root.display()
            ),
        })?;
    }

    let project_workspace = project_workspace
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    let project_id = project_id.map(str::to_string);
    let (effective_root, kind, status, recovery) = match project_workspace.as_ref() {
        Some(root) if root.is_dir() => (
            Some(root.clone()),
            "project_workspace".to_string(),
            "available".to_string(),
            None,
        ),
        Some(root) => (
            Some(root.clone()),
            "project_workspace".to_string(),
            "missing".to_string(),
            Some(format!(
                "Project workspace {} is unavailable. Locate the folder, clear the Project workspace binding, or continue in a new scratch-only native session.",
                root.display()
            )),
        ),
        None => (
            scratch_root.clone(),
            "scratch".to_string(),
            if scratch_root.is_some() {
                "available".to_string()
            } else {
                "unavailable".to_string()
            },
            scratch_root.is_none().then(|| {
                "Native session scratch is unavailable because Galley could not resolve its app data directory.".to_string()
            }),
        ),
    };

    Ok(NativeWorkspaceContext {
        session_id: session_id.as_str().to_string(),
        project_id,
        project_workspace,
        effective_root,
        scratch_root,
        kind,
        status,
        recovery,
    })
}

fn native_workspace_resource_files(
    workspace: &NativeWorkspaceContext,
) -> Result<HashMap<String, String>> {
    let mut resources = HashMap::new();
    resources.insert(
        "workspace://snapshot".to_string(),
        render_workspace_snapshot(workspace),
    );
    resources.insert(
        "workspace://index".to_string(),
        render_workspace_index(workspace),
    );
    if let Some(scratch_root) = workspace.scratch_root.as_ref() {
        resources.insert(
            "workspace://scratch".to_string(),
            render_workspace_scratch(workspace, scratch_root),
        );
    }
    Ok(resources)
}

fn render_workspace_snapshot(workspace: &NativeWorkspaceContext) -> String {
    let mut lines = vec![
        "workspace_resource: workspace://snapshot".to_string(),
        format!("session_id: {}", workspace.session_id),
        format!("kind: {}", workspace.kind),
        format!("status: {}", workspace.status),
    ];
    if let Some(project_id) = workspace.project_id.as_deref() {
        lines.push(format!("project_id: {project_id}"));
    }
    if let Some(project_workspace) = workspace.project_workspace.as_ref() {
        lines.push(format!(
            "project_workspace: {}",
            project_workspace.display()
        ));
    }
    if let Some(root) = workspace.effective_root.as_ref() {
        lines.push(format!("effective_root: {}", root.display()));
    }
    if let Some(scratch_root) = workspace.scratch_root.as_ref() {
        lines.push(format!("scratch_root: {}", scratch_root.display()));
    }
    lines.push("scratch_retention: keep while the session is active or recoverable; clean only Galley-owned native-session-scratch paths".to_string());
    if let Some(recovery) = workspace.recovery.as_deref() {
        lines.push(format!("recovery: {recovery}"));
    }
    lines.join("\n")
}

fn render_workspace_scratch(workspace: &NativeWorkspaceContext, scratch_root: &Path) -> String {
    [
        "workspace_resource: workspace://scratch".to_string(),
        format!("session_id: {}", workspace.session_id),
        format!("scratch_root: {}", scratch_root.display()),
        "purpose: Galley-owned temporary workspace for this native session".to_string(),
        "retention: keep while active or recently recoverable; never clean Project workspaces"
            .to_string(),
    ]
    .join("\n")
}

fn render_workspace_index(workspace: &NativeWorkspaceContext) -> String {
    const FILE_LIMIT: usize = 500;
    let mut lines = vec![
        "workspace_resource: workspace://index".to_string(),
        format!("kind: {}", workspace.kind),
        format!("status: {}", workspace.status),
        String::new(),
    ];
    if workspace.status != "available" {
        lines.push(
            workspace
                .recovery
                .clone()
                .unwrap_or_else(|| "Workspace is unavailable.".to_string()),
        );
        return lines.join("\n");
    }
    let Some(root) = workspace.effective_root.as_ref() else {
        lines.push("No effective workspace root is available.".to_string());
        return lines.join("\n");
    };
    let Ok(root) = root.canonicalize() else {
        lines.push(format!(
            "Workspace root {} cannot be resolved.",
            root.display()
        ));
        return lines.join("\n");
    };
    let mut files = Vec::new();
    collect_workspace_files(&root, &root, 0, FILE_LIMIT, &mut files);
    lines.push(format!("root: {}", root.display()));
    lines.push(format!("files_indexed: {}", files.len()));
    lines.push(
        "file_mentions: use @path for these relative paths; read contents with file_read"
            .to_string(),
    );
    lines.push(String::new());
    if files.is_empty() {
        lines.push("No files indexed for this workspace.".to_string());
    } else {
        for file in files {
            lines.push(format!("- @{file}"));
        }
    }
    lines.join("\n")
}

fn collect_workspace_files(
    root: &Path,
    dir: &Path,
    depth: usize,
    limit: usize,
    files: &mut Vec<String>,
) {
    if files.len() >= limit || depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries = entries.filter_map(|entry| entry.ok()).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if files.len() >= limit {
            break;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if should_skip_workspace_entry(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_workspace_files(root, &path, depth + 1, limit, files);
        } else if metadata.is_file() {
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

fn should_skip_workspace_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".venv"
            | ".mypy_cache"
            | ".pytest_cache"
            | ".ruff_cache"
            | ".next"
    )
}

async fn native_memory_resource_files(
    galley: &SqliteGalley,
    project_id: Option<&str>,
) -> Result<HashMap<String, String>> {
    const RESOURCE_LIMIT: u32 = 200;

    let mut resources = HashMap::new();
    let mut scopes = vec![NativeMemoryScope::GlobalUser];
    if let Some(project_id) = project_id.map(str::trim).filter(|id| !id.is_empty()) {
        scopes.push(NativeMemoryScope::Project(project_id.to_string()));
    }

    for scope in scopes {
        let items = galley
            .list_native_memory_items_for_scope(&scope, RESOURCE_LIMIT)
            .await?;
        let entries = galley
            .list_native_memory_index_entries_for_scope(&scope, RESOURCE_LIMIT)
            .await?;
        resources.insert(
            format!("{}/l1", native_memory_scope_uri(&scope)),
            render_native_memory_l1(&scope, &items, &entries),
        );
        for layer in [
            NativeMemoryLayer::L2,
            NativeMemoryLayer::L3,
            NativeMemoryLayer::L4,
        ] {
            resources.insert(
                format!(
                    "{}/{}",
                    native_memory_scope_uri(&scope),
                    native_memory_layer_segment(layer)
                ),
                render_native_memory_layer_list(&scope, layer, &items),
            );
        }
        for item in &items {
            resources.insert(
                native_memory_item_uri(&item.scope, item.layer, &item.id),
                render_native_memory_item(item),
            );
        }
    }

    Ok(resources)
}

#[derive(Debug, Clone)]
struct NativeCapabilityPack {
    id: &'static str,
    display_name: &'static str,
    description: &'static str,
    version: &'static str,
    origin: &'static str,
    activation: &'static str,
    triggers: &'static [&'static str],
    permissions: &'static [&'static str],
    resources: &'static [NativeCapabilityResource],
}

#[derive(Debug, Clone)]
struct NativeCapabilityResource {
    path: &'static str,
    kind: &'static str,
    title: &'static str,
    body: &'static str,
    executable: bool,
}

fn builtin_capability_packs() -> Vec<NativeCapabilityPack> {
    vec![
        NativeCapabilityPack {
            id: "goal-hive",
            display_name: "Goal Hive",
            description: "Long-running goal decomposition, worker coordination, and checkpoint discipline.",
            version: "0.1.0",
            origin: "builtin",
            activation: "goal_mode",
            triggers: &[
                "goal mode",
                "long running task",
                "worker coordination",
                "checkpoint",
            ],
            permissions: &["read_memory", "write_memory", "manage_goal_tasks"],
            resources: &[
                NativeCapabilityResource {
                    path: "sops/main",
                    kind: "sop",
                    title: "Goal Hive operating loop",
                    body: "Use Goal Hive when a task is too large for one turn. Keep one visible objective, split concrete tasks, checkpoint after each durable change, and prefer small verified worker outputs over speculative broad rewrites.",
                    executable: false,
                },
                NativeCapabilityResource {
                    path: "tests/checkpoint-discipline",
                    kind: "test",
                    title: "Checkpoint discipline smoke",
                    body: "A Goal Hive run is healthy when every material code or doc change has a visible checkpoint, a clear next task, and a verification result or an explicit blocker.",
                    executable: false,
                },
            ],
        },
        NativeCapabilityPack {
            id: "morphling",
            display_name: "Morphling",
            description: "Long-horizon capability absorption through evidence-backed SOP and script proposals.",
            version: "0.1.0",
            origin: "builtin",
            activation: "morphling_mode",
            triggers: &[
                "capability absorption",
                "self evolution",
                "reusable workflow",
                "morphling",
            ],
            permissions: &["read_memory", "write_memory", "propose_capability_pack"],
            resources: &[
                NativeCapabilityResource {
                    path: "sops/main",
                    kind: "sop",
                    title: "Morphling absorption loop",
                    body: "Promote a repeated workflow only after evidence shows it saves future work. Capture the trigger, minimal procedure, failure cases, verification command, and rollback path. New scripts or tool schemas require approval before activation.",
                    executable: false,
                },
                NativeCapabilityResource {
                    path: "tests/promotion-gate",
                    kind: "test",
                    title: "Promotion gate",
                    body: "A capability proposal must cite evidence, avoid secrets, include at least one verification path, and explain why memory alone is not enough.",
                    executable: false,
                },
            ],
        },
        NativeCapabilityPack {
            id: "browser-control",
            display_name: "Browser Control",
            description: "Browser inspection and controlled JavaScript execution through the Galley Browser bridge.",
            version: "0.1.0",
            origin: "builtin",
            activation: "session_requested",
            triggers: &[
                "browser",
                "web_scan",
                "web_execute_js",
                "inspect page",
                "cdp bridge",
            ],
            permissions: &["use_browser", "read_memory"],
            resources: &[
                NativeCapabilityResource {
                    path: "sops/main",
                    kind: "sop",
                    title: "Browser Control usage",
                    body: "Use web_scan for tab and page inspection. Use web_execute_js only after approval, and prefer read-only JavaScript unless the user explicitly asked for page mutation or automation.",
                    executable: false,
                },
                NativeCapabilityResource {
                    path: "tests/readiness",
                    kind: "test",
                    title: "Browser readiness",
                    body: "The browser bridge is ready only when a scriptable http or https tab is available. If unavailable, explain the setup action instead of pretending browser access worked.",
                    executable: false,
                },
            ],
        },
    ]
}

fn native_capability_resource_files(
    packs: &[NativeCapabilityPack],
) -> Result<HashMap<String, String>> {
    let mut resources = HashMap::new();
    let mut all_uris = HashSet::new();
    for pack in packs {
        validate_capability_pack(pack, &mut all_uris)?;
    }
    resources.insert(
        "capability://index".to_string(),
        render_capability_index(packs),
    );
    for pack in packs {
        resources.insert(
            format!("capability://{}/manifest", pack.id),
            render_capability_manifest(pack),
        );
        for resource in pack.resources {
            resources.insert(
                capability_resource_uri(pack, resource),
                render_capability_resource(pack, resource),
            );
        }
    }
    Ok(resources)
}

fn validate_capability_pack(
    pack: &NativeCapabilityPack,
    all_uris: &mut HashSet<String>,
) -> Result<()> {
    if !valid_capability_id(pack.id) {
        return Err(GalleyError::InvalidArgs {
            message: format!("invalid builtin capability pack id `{}`", pack.id),
        });
    }
    if pack.display_name.trim().is_empty()
        || pack.description.trim().is_empty()
        || pack.version.trim().is_empty()
        || pack.triggers.is_empty()
        || pack.resources.is_empty()
    {
        return Err(GalleyError::InvalidArgs {
            message: format!("capability pack `{}` has an incomplete manifest", pack.id),
        });
    }
    let allowed_permissions = [
        "read_memory",
        "write_memory",
        "manage_goal_tasks",
        "propose_capability_pack",
        "use_browser",
    ];
    for permission in pack.permissions {
        if !allowed_permissions.contains(permission) {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "capability pack `{}` declares unknown permission `{permission}`",
                    pack.id
                ),
            });
        }
    }
    let mut paths = HashSet::new();
    for resource in pack.resources {
        if resource.path.trim().is_empty()
            || resource.path.starts_with('/')
            || resource.path.contains("..")
            || resource.body.trim().is_empty()
            || native_memory_update_looks_secret(resource.body)
        {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "capability pack `{}` has an invalid resource `{}`",
                    pack.id, resource.path
                ),
            });
        }
        if !paths.insert(resource.path) {
            return Err(GalleyError::InvalidArgs {
                message: format!(
                    "capability pack `{}` duplicates resource `{}`",
                    pack.id, resource.path
                ),
            });
        }
        let uri = capability_resource_uri(pack, resource);
        if !all_uris.insert(uri) {
            return Err(GalleyError::InvalidArgs {
                message: format!("capability pack `{}` duplicates a resource URI", pack.id),
            });
        }
    }
    Ok(())
}

fn valid_capability_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn capability_resource_uri(
    pack: &NativeCapabilityPack,
    resource: &NativeCapabilityResource,
) -> String {
    format!("capability://{}/{}", pack.id, resource.path)
}

fn render_capability_index(packs: &[NativeCapabilityPack]) -> String {
    let mut lines = vec![
        "capability_resource: capability://index".to_string(),
        "purpose: active Galley Native capability pack index".to_string(),
        format!("packs: {}", packs.len()),
        String::new(),
    ];
    for pack in packs {
        lines.push(format!("- id: {}", pack.id));
        lines.push(format!("  display_name: {}", pack.display_name));
        lines.push(format!("  description: {}", pack.description));
        lines.push(format!("  activation: {}", pack.activation));
        lines.push(format!("  manifest: capability://{}/manifest", pack.id));
        lines.push(format!("  triggers: {}", pack.triggers.join(", ")));
    }
    lines.join("\n")
}

fn render_capability_manifest(pack: &NativeCapabilityPack) -> String {
    let mut lines = vec![
        format!("capability_manifest: capability://{}/manifest", pack.id),
        "schema_version: 1".to_string(),
        format!("id: {}", pack.id),
        format!("display_name: {}", pack.display_name),
        format!("description: {}", pack.description),
        format!("version: {}", pack.version),
        format!("origin: {}", pack.origin),
        format!("activation: {}", pack.activation),
        format!("triggers: {}", pack.triggers.join(", ")),
        format!("permissions: {}", pack.permissions.join(", ")),
        String::new(),
        "resources:".to_string(),
    ];
    for resource in pack.resources {
        lines.push(format!(
            "- uri: {}",
            capability_resource_uri(pack, resource)
        ));
        lines.push(format!("  kind: {}", resource.kind));
        lines.push(format!("  title: {}", resource.title));
        lines.push(format!("  executable: {}", resource.executable));
    }
    lines.join("\n")
}

fn render_capability_resource(
    pack: &NativeCapabilityPack,
    resource: &NativeCapabilityResource,
) -> String {
    [
        format!(
            "capability_resource: {}",
            capability_resource_uri(pack, resource)
        ),
        format!("pack_id: {}", pack.id),
        format!("kind: {}", resource.kind),
        format!("title: {}", resource.title),
        format!("executable: {}", resource.executable),
        String::new(),
        resource.body.to_string(),
    ]
    .join("\n")
}

fn attach_capability_triggers_to_memory_l1(
    resources: &mut HashMap<String, String>,
    packs: &[NativeCapabilityPack],
) {
    let section = render_capability_l1_section(packs);
    for (uri, body) in resources.iter_mut() {
        if uri.starts_with("memory://") && uri.ends_with("/l1") {
            body.push_str("\n\n");
            body.push_str(&section);
        }
    }
}

fn render_capability_l1_section(packs: &[NativeCapabilityPack]) -> String {
    let mut lines = vec![
        "Capability packs:".to_string(),
        "- index: capability://index".to_string(),
    ];
    for pack in packs {
        lines.push(format!("- trigger: {}", pack.triggers.join(", ")));
        lines.push(format!("  target: capability://{}/manifest", pack.id));
        lines.push(format!("  target_title: {}", pack.display_name));
    }
    lines.join("\n")
}

fn native_memory_scope_uri(scope: &NativeMemoryScope) -> String {
    match scope {
        NativeMemoryScope::GlobalUser => "memory://global".to_string(),
        NativeMemoryScope::Project(project_id) => format!("memory://project/{project_id}"),
        NativeMemoryScope::Workspace(workspace_id) => format!("memory://workspace/{workspace_id}"),
        NativeMemoryScope::CapabilityPack(pack_id) => {
            format!("memory://capability-pack/{pack_id}")
        }
    }
}

fn native_memory_scope_label(scope: &NativeMemoryScope) -> String {
    match scope {
        NativeMemoryScope::GlobalUser => "global_user".to_string(),
        NativeMemoryScope::Project(project_id) => format!("project:{project_id}"),
        NativeMemoryScope::Workspace(workspace_id) => format!("workspace:{workspace_id}"),
        NativeMemoryScope::CapabilityPack(pack_id) => format!("capability_pack:{pack_id}"),
    }
}

fn native_memory_layer_segment(layer: NativeMemoryLayer) -> &'static str {
    match layer {
        NativeMemoryLayer::L1 => "l1",
        NativeMemoryLayer::L2 => "l2",
        NativeMemoryLayer::L3 => "l3",
        NativeMemoryLayer::L4 => "l4",
    }
}

fn native_memory_item_uri(
    scope: &NativeMemoryScope,
    layer: NativeMemoryLayer,
    item_id: &str,
) -> String {
    format!(
        "{}/{}/{}",
        native_memory_scope_uri(scope),
        native_memory_layer_segment(layer),
        item_id
    )
}

fn render_native_memory_l1(
    scope: &NativeMemoryScope,
    items: &[NativeMemoryItemRecord],
    entries: &[NativeMemoryIndexEntryRecord],
) -> String {
    let mut lines = vec![
        format!("memory_resource: {}/l1", native_memory_scope_uri(scope)),
        format!("scope: {}", native_memory_scope_label(scope)),
        "layer: l1".to_string(),
        format!("entries: {}", entries.len()),
        String::new(),
    ];
    if entries.is_empty() {
        lines.push("No active memory index entries for this scope.".to_string());
    } else {
        for entry in entries {
            let item = items.iter().find(|item| item.id == entry.target_item_id);
            let target = item
                .map(|item| native_memory_item_uri(&item.scope, item.layer, &item.id))
                .unwrap_or_else(|| format!("memory://missing/{}", entry.target_item_id));
            lines.push(format!("- trigger: {}", entry.trigger));
            lines.push(format!("  target: {target}"));
            if let Some(item) = item {
                lines.push(format!("  target_title: {}", item.title));
            }
            lines.push(format!("  rank: {}", entry.rank));
            if let Some(reason) = entry.reason.as_deref() {
                lines.push(format!("  reason: {reason}"));
            }
        }
    }
    lines.push(String::new());
    lines.push("Layer lists:".to_string());
    for layer in [
        NativeMemoryLayer::L2,
        NativeMemoryLayer::L3,
        NativeMemoryLayer::L4,
    ] {
        lines.push(format!(
            "- {}/{}",
            native_memory_scope_uri(scope),
            native_memory_layer_segment(layer)
        ));
    }
    lines.join("\n")
}

fn render_native_memory_layer_list(
    scope: &NativeMemoryScope,
    layer: NativeMemoryLayer,
    items: &[NativeMemoryItemRecord],
) -> String {
    let layer_items = items
        .iter()
        .filter(|item| item.layer == layer)
        .collect::<Vec<_>>();
    let mut lines = vec![
        format!(
            "memory_resource: {}/{}",
            native_memory_scope_uri(scope),
            native_memory_layer_segment(layer)
        ),
        format!("scope: {}", native_memory_scope_label(scope)),
        format!("layer: {}", native_memory_layer_segment(layer)),
        format!("items: {}", layer_items.len()),
        String::new(),
    ];
    if layer_items.is_empty() {
        lines.push("No active memory items for this layer.".to_string());
    } else {
        for item in layer_items {
            lines.push(format!("- id: {}", item.id));
            lines.push(format!("  title: {}", item.title));
            lines.push(format!(
                "  uri: {}",
                native_memory_item_uri(&item.scope, item.layer, &item.id)
            ));
            if !item.triggers.is_empty() {
                lines.push(format!("  triggers: {}", item.triggers.join(", ")));
            }
            if !item.tags.is_empty() {
                lines.push(format!("  tags: {}", item.tags.join(", ")));
            }
        }
    }
    lines.join("\n")
}

fn render_native_memory_item(item: &NativeMemoryItemRecord) -> String {
    let source_refs = serde_json::to_string_pretty(&item.source_refs)
        .unwrap_or_else(|_| item.source_refs.to_string());
    let mut lines = vec![
        format!(
            "memory_item: {}",
            native_memory_item_uri(&item.scope, item.layer, &item.id)
        ),
        format!("id: {}", item.id),
        format!("layer: {}", native_memory_layer_segment(item.layer)),
        format!("scope: {}", native_memory_scope_label(&item.scope)),
        format!("status: {}", item.status),
        format!("title: {}", item.title),
    ];
    if !item.triggers.is_empty() {
        lines.push(format!("triggers: {}", item.triggers.join(", ")));
    }
    if !item.tags.is_empty() {
        lines.push(format!("tags: {}", item.tags.join(", ")));
    }
    if let Some(supersedes) = item.supersedes_item_id.as_deref() {
        lines.push(format!("supersedes: {supersedes}"));
    }
    lines.push("source_refs:".to_string());
    lines.push(source_refs);
    lines.push(String::new());
    lines.push("body:".to_string());
    lines.push(item.body.clone());
    lines.join("\n")
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
    host_context: NativeRuntimeHostContext,
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
    let tool_context = native_tool_context(galley, &session_id, &host_context).await?;
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
            progress_chunks: Vec::new(),
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
    events.extend(tool_progress_events_from_result(
        session_id.as_str(),
        turn_index,
        &call,
        &result,
        timestamp.clone(),
    ));
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
    if decision != "deny" && should_continue_after_approved_tool_result(&result) {
        match continue_after_approved_tool_result(
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
                    format!(
                        "approved {} continuation skipped because no usable native model is available",
                        result.tool_name
                    ),
                    Some("The approved tool result was recorded, but Galley Native could not produce a follow-up answer.".to_string()),
                ));
            }
            Err(err) => {
                events.push(runtime_error_event(
                    session_id.as_str(),
                    "model_continuation",
                    format!("approved {} continuation failed: {err}", result.tool_name),
                    Some("The approved tool result was recorded, but Galley Native could not produce a follow-up answer.".to_string()),
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
         Galley Native used the deterministic mock-model fallback for this turn. \
         Some native tools may be active depending on the current implementation slice, but memory, Goal Hive, and Morphling remain deferred."
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
    raw_calls: Vec<NativeToolCall>,
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

async fn continue_after_approved_tool_result(
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
    let working_checkpoint = galley.latest_native_working_checkpoint(session_id).await?;
    let model_task =
        crate::native_model::task_with_working_checkpoint(&task, working_checkpoint.as_deref());
    let response = crate::native_model::complete_tool_result_turn(
        &model,
        &model_task,
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

fn should_continue_after_approved_tool_result(result: &NativeToolStubResult) -> bool {
    match result.tool_name.as_str() {
        "file_read" | "web_scan" => result.status == "success",
        "file_patch" | "file_write" => {
            matches!(
                result.status.as_str(),
                "success" | "success_no_change" | "failed"
            )
        }
        "code_run" => matches!(result.status.as_str(), "success" | "failed" | "timed_out"),
        "web_execute_js" => matches!(result.status.as_str(), "success" | "failed"),
        _ => false,
    }
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

fn should_continue_after_read_only_tool(trace: &NativeToolTrace) -> bool {
    !trace.awaiting_user
        && trace.pending_approval.is_none()
        && trace.tool_results.iter().any(|result| {
            matches!(
                result.get("toolName").and_then(serde_json::Value::as_str),
                Some("file_read" | "web_scan" | "update_working_checkpoint")
            ) && result.get("status").and_then(serde_json::Value::as_str) == Some("success")
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
    let mut raw_calls = Vec::new();
    let mut awaiting_user = false;
    let mut pending_approval = None;

    for call in outcome.calls {
        let mut call = normalize_native_tool_call(call, tool_context);
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
        raw_calls.push(call.clone());
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
        events.extend(tool_progress_events_from_result(
            session_id,
            turn_index,
            &call,
            &result,
            timestamp.clone(),
        ));
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
        raw_calls,
        awaiting_user,
        pending_approval,
    }
}

async fn apply_native_durable_tool_effects(
    galley: &SqliteGalley,
    session_id: &SessionId,
    turn_index: u32,
    trace: &mut NativeToolTrace,
) -> Result<()> {
    if trace.pending_approval.is_some() {
        return Ok(());
    }
    let session = galley.session_brief(session_id.clone()).await?;
    for call in trace.raw_calls.clone() {
        if call.name != "start_long_term_update" {
            continue;
        }
        let result =
            start_long_term_update_tool_result(galley, session_id, turn_index, &call, &session)
                .await;
        let message = if result.status == "success" {
            "Native memory update applied."
        } else {
            "Native memory update rejected."
        };
        replace_native_tool_result(
            trace,
            session_id.as_str(),
            turn_index,
            &call,
            result,
            message,
        );
    }
    Ok(())
}

async fn start_long_term_update_tool_result(
    galley: &SqliteGalley,
    session_id: &SessionId,
    turn_index: u32,
    call: &NativeToolCall,
    session: &SessionBrief,
) -> NativeToolStubResult {
    match apply_start_long_term_update(galley, session_id, turn_index, call, session).await {
        Ok(applied) => NativeToolStubResult {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            status: "success".to_string(),
            content: format!(
                "start_long_term_update applied.\nitem: {}\nchange_id: {}\nevidence_id: {}\nscope: {}\nlayer: {}\ntriggers: {}",
                applied.item_uri,
                applied.change_id,
                applied.evidence_id,
                applied.scope_label,
                native_memory_layer_segment(applied.layer),
                applied.triggers.join(", ")
            ),
            side_effects_performed: true,
            requires_user_response: false,
            approval: "none".to_string(),
            progress_chunks: Vec::new(),
        },
        Err(err) => NativeToolStubResult {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            status: "failed".to_string(),
            content: format!("start_long_term_update rejected: {err}"),
            side_effects_performed: false,
            requires_user_response: false,
            approval: "none".to_string(),
            progress_chunks: Vec::new(),
        },
    }
}

struct AppliedNativeMemoryUpdate {
    item_uri: String,
    change_id: String,
    evidence_id: String,
    scope_label: String,
    layer: NativeMemoryLayer,
    triggers: Vec<String>,
}

async fn apply_start_long_term_update(
    galley: &SqliteGalley,
    session_id: &SessionId,
    turn_index: u32,
    call: &NativeToolCall,
    session: &SessionBrief,
) -> Result<AppliedNativeMemoryUpdate> {
    let topic = native_string_arg_any(call, &["topic", "title"]).ok_or_else(|| {
        GalleyError::InvalidArgs {
            message: "start_long_term_update requires a non-empty `topic`.".into(),
        }
    })?;
    let body = native_string_arg_any(call, &["proposal", "content", "body", "summary"])
        .unwrap_or_else(|| topic.clone());
    let combined = format!("{topic}\n{body}");
    if native_memory_update_looks_secret(&combined) {
        return Err(GalleyError::InvalidArgs {
            message:
                "candidate appears to contain a raw secret; store credentials in Galley secrets and remember only a reference"
                    .into(),
        });
    }

    let scope = native_memory_scope_for_update(call, session.project_id.as_deref());
    let layer = native_memory_layer_for_update(call)?;
    let mut triggers = native_string_list_arg_any(call, &["triggers", "trigger", "keywords"]);
    if triggers.is_empty() {
        triggers.push(topic.clone());
    }
    let tags = native_string_list_arg_any(call, &["tags", "tag"]);
    let evidence_summary = format!("start_long_term_update: {topic}");
    let evidence = galley
        .create_native_memory_evidence(CreateNativeMemoryEvidenceInput {
            session_id: Some(session_id.clone()),
            turn_index: Some(turn_index),
            message_id: None,
            tool_call_id: Some(call.id.clone()),
            tool_event_id: None,
            content_hash: native_memory_content_hash(&combined),
            summary: evidence_summary,
        })
        .await?;
    let item = galley
        .create_native_memory_item(CreateNativeMemoryItemInput {
            layer,
            scope: scope.clone(),
            title: topic.clone(),
            body: body.clone(),
            triggers: triggers.clone(),
            tags: tags.clone(),
            source_refs: serde_json::json!([{
                "kind": "native_tool_call",
                "session_id": session_id.as_str(),
                "turn_index": turn_index,
                "tool_call_id": call.id,
                "evidence_id": evidence.id
            }]),
            supersedes_item_id: None,
        })
        .await?;

    let mut index_entry_ids = Vec::new();
    for (rank, trigger) in triggers.iter().enumerate() {
        let entry = galley
            .create_native_memory_index_entry(CreateNativeMemoryIndexEntryInput {
                scope: scope.clone(),
                trigger: trigger.clone(),
                target_item_id: item.id.clone(),
                rank: i64::try_from(rank).unwrap_or(i64::MAX),
                reason: Some(format!("start_long_term_update routed `{topic}`")),
            })
            .await?;
        index_entry_ids.push(entry.id);
    }

    let change = galley
        .create_native_memory_change(CreateNativeMemoryChangeInput {
            target_item_id: Some(item.id.clone()),
            kind: NativeMemoryChangeKind::Create,
            diff: serde_json::json!({
                "after": {
                    "item_id": item.id,
                    "title": topic,
                    "scope": native_memory_scope_label(&scope),
                    "layer": native_memory_layer_segment(layer),
                    "triggers": triggers,
                    "tags": tags,
                    "index_entry_ids": index_entry_ids
                }
            }),
            evidence_ids: vec![evidence.id.clone()],
            risk: NativeMemoryRisk::Low,
            approval_state: NativeMemoryApprovalState::AutoApplied,
            created_by_session_id: Some(session_id.clone()),
            created_by_tool_call_id: Some(call.id.clone()),
            applied_at: None,
        })
        .await?;

    Ok(AppliedNativeMemoryUpdate {
        item_uri: native_memory_item_uri(&scope, layer, &item.id),
        change_id: change.id,
        evidence_id: evidence.id,
        scope_label: native_memory_scope_label(&scope),
        layer,
        triggers,
    })
}

fn replace_native_tool_result(
    trace: &mut NativeToolTrace,
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    result: NativeToolStubResult,
    progress_message: &str,
) {
    let result_value = tool_result_value(&result);
    let progress_delta = result.content.clone();
    if let Some(existing) = trace.tool_results.iter_mut().find(|value| {
        value.get("toolCallId").and_then(serde_json::Value::as_str) == Some(call.id.as_str())
    }) {
        *existing = result_value.clone();
    } else {
        trace.tool_results.push(result_value.clone());
    }

    let mut tool_end_index = None;
    for (index, event) in trace.events.iter_mut().enumerate() {
        let NativeRuntimeEvent::ToolEnd(end) = event else {
            continue;
        };
        if end.tool_call_id != call.id {
            continue;
        }
        end.status = result.status.clone();
        end.result = result_value.clone();
        end.side_effects_performed = result.side_effects_performed;
        tool_end_index = Some(index);
        break;
    }

    let progress = NativeRuntimeEvent::ToolProgress(NativeToolProgressEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        message: progress_message.to_string(),
        stream: None,
        delta: Some(progress_delta.clone()),
        truncated: Some(false),
        timestamp: native_now_iso(),
    });

    if let Some(index) = tool_end_index {
        if let NativeRuntimeEvent::ToolEnd(end) = &trace.events[index] {
            let progress = NativeRuntimeEvent::ToolProgress(NativeToolProgressEvent {
                session_id: end.session_id.clone(),
                turn_index: end.turn_index,
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                message: progress_message.to_string(),
                stream: None,
                delta: Some(progress_delta),
                truncated: Some(false),
                timestamp: native_now_iso(),
            });
            trace.events.insert(index, progress);
        }
    } else {
        trace.events.push(progress);
    }
}

fn native_string_arg_any(call: &NativeToolCall, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| {
            call.arguments_json
                .get(*name)
                .and_then(serde_json::Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn native_string_list_arg_any(call: &NativeToolCall, names: &[&str]) -> Vec<String> {
    for name in names {
        let Some(value) = call.arguments_json.get(*name) else {
            continue;
        };
        let list = if let Some(array) = value.as_array() {
            array
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        } else if let Some(raw) = value.as_str() {
            raw.split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        if !list.is_empty() {
            return list;
        }
    }
    Vec::new()
}

fn native_memory_scope_for_update(
    call: &NativeToolCall,
    project_id: Option<&str>,
) -> NativeMemoryScope {
    let requested = native_string_arg_any(call, &["scope", "memory_scope", "memoryScope"])
        .map(|scope| scope.to_ascii_lowercase());
    match requested.as_deref() {
        Some("global" | "global_user" | "user") => NativeMemoryScope::GlobalUser,
        Some("project") | None => project_id
            .map(|id| NativeMemoryScope::Project(id.to_string()))
            .unwrap_or(NativeMemoryScope::GlobalUser),
        _ => project_id
            .map(|id| NativeMemoryScope::Project(id.to_string()))
            .unwrap_or(NativeMemoryScope::GlobalUser),
    }
}

fn native_memory_layer_for_update(call: &NativeToolCall) -> Result<NativeMemoryLayer> {
    let Some(raw) = native_string_arg_any(call, &["layer", "memory_layer", "memoryLayer"]) else {
        return Ok(NativeMemoryLayer::L2);
    };
    match raw.to_ascii_lowercase().as_str() {
        "l2" | "fact" | "facts" | "preference" | "preferences" => Ok(NativeMemoryLayer::L2),
        "l3" | "procedure" | "procedures" | "sop" | "sops" => Ok(NativeMemoryLayer::L3),
        "l4" | "identity" | "policy" | "policies" => Ok(NativeMemoryLayer::L4),
        "l1" | "index" => Err(GalleyError::InvalidArgs {
            message: "L1 is generated from triggers; write the memory body to L2/L3/L4 instead"
                .into(),
        }),
        other => Err(GalleyError::InvalidArgs {
            message: format!("unknown native memory layer `{other}`"),
        }),
    }
}

fn native_memory_content_hash(content: &str) -> String {
    let hash = digest::digest(&digest::SHA256, content.as_bytes());
    let hex = hash
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

fn native_memory_update_looks_secret(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    [
        "begin private key",
        "api_key=",
        "api key:",
        "password=",
        "password:",
        "secret=",
        "token=",
        "authorization: bearer",
        "ghp_",
        "xoxb-",
        "sk-",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
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
        reason: native_approval_reason(&call.name).to_string(),
        timestamp,
    })
}

fn native_approval_reason(tool_name: &str) -> &'static str {
    match tool_name {
        "code_run" => "Review the command, cwd, and timeout before Galley Native runs it.",
        "file_patch" => "Review the diff before Galley Native modifies this file.",
        "file_write" => "Review the full file preview before Galley Native writes it.",
        "file_read" => "Approve this read before Galley Native opens a path outside the workspace.",
        _ => "Approve this native tool call before Galley Core resumes execution.",
    }
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
        executor: "galley_native".to_string(),
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
        message: "Native executor running.".to_string(),
        stream: None,
        delta: None,
        truncated: None,
        timestamp,
    })
}

fn tool_progress_events_from_result(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    result: &NativeToolStubResult,
    timestamp: String,
) -> Vec<NativeRuntimeEvent> {
    result
        .progress_chunks
        .iter()
        .map(|chunk| {
            tool_output_progress_event(session_id, turn_index, call, chunk, timestamp.clone())
        })
        .collect()
}

fn tool_output_progress_event(
    session_id: &str,
    turn_index: u32,
    call: &NativeToolCall,
    chunk: &NativeToolProgressChunk,
    timestamp: String,
) -> NativeRuntimeEvent {
    let truncated_suffix = if chunk.truncated { " (truncated)" } else { "" };
    NativeRuntimeEvent::ToolProgress(NativeToolProgressEvent {
        session_id: session_id.to_string(),
        turn_index,
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        message: format!("code_run {} output{}", chunk.stream, truncated_suffix),
        stream: Some(chunk.stream.clone()),
        delta: Some(chunk.delta.clone()),
        truncated: Some(chunk.truncated),
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
    use crate::api::{RuntimeKind, SessionStatus};
    use crate::native_tools::NativeToolCallSource;
    use std::fs;

    async fn native_memory_test_galley(session_id: &str) -> SqliteGalley {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        sqlx::raw_sql(include_str!("../migrations/001_init.sql"))
            .execute(&pool)
            .await
            .expect("run base migration");
        sqlx::raw_sql(include_str!(
            "../migrations/022_native_memory_substrate.sql"
        ))
        .execute(&pool)
        .await
        .expect("run native memory migration");
        sqlx::query(
            "INSERT INTO sessions (
                id, title, status, turn_count, pending_approval_count, error_count,
                pinned, last_activity_at, created_at, updated_at
             ) VALUES (?, ?, 'idle', 0, 0, 0, 0, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(format!("title-{session_id}"))
        .bind("2026-06-17T00:00:00Z")
        .bind("2026-06-17T00:00:00Z")
        .bind("2026-06-17T00:00:00Z")
        .execute(&pool)
        .await
        .expect("seed session");
        SqliteGalley::from_pool(pool)
    }

    fn native_test_session(session_id: &str, project_id: Option<&str>) -> SessionBrief {
        SessionBrief {
            id: SessionId(session_id.to_string()),
            project_id: project_id.map(str::to_string),
            title: format!("title-{session_id}"),
            status: SessionStatus::Idle,
            summary: None,
            turn_count: Some(0),
            last_activity_at: "2026-06-17T00:00:00Z".into(),
            created_at: "2026-06-17T00:00:00Z".into(),
            updated_at: "2026-06-17T00:00:00Z".into(),
            pinned: Some(false),
            has_unread: Some(false),
            origin: None,
            selected_llm_index: None,
            selected_llm_key: None,
            selected_llm_display_name: None,
            runtime_kind: RuntimeKind::GalleyNative,
            runtime_label: "Galley Native".into(),
            ga_runtime_kind: RuntimeKind::GalleyNative,
            ga_runtime_id: None,
            prompt_profile: None,
        }
    }

    #[test]
    fn mock_response_discloses_slice_boundary() {
        let answer = mock_final_answer("Investigate", "session.new");
        assert!(answer.contains("Galley Native mock response"));
        assert!(answer.contains("Runtime: galley_native"));
        assert!(answer.contains("mock-model fallback"));
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
    fn mock_event_trace_routes_no_approval_tools_without_side_effects() {
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
        let web_scan = turn_end["toolResults"]
            .as_array()
            .unwrap()
            .iter()
            .find(|result| result["toolName"] == "web_scan")
            .unwrap();
        assert_eq!(web_scan["status"], "failed");
        assert!(web_scan["content"]
            .as_str()
            .unwrap()
            .contains("Browser Control is unavailable"));
    }

    #[test]
    fn successful_web_scan_result_requests_continuation() {
        let trace = NativeToolTrace {
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: vec![serde_json::json!({
                "toolName": "web_scan",
                "status": "success"
            })],
            raw_calls: Vec::new(),
            awaiting_user: false,
            pending_approval: None,
        };

        assert!(should_continue_after_read_only_tool(&trace));
    }

    #[test]
    fn successful_working_checkpoint_requests_continuation() {
        let trace = NativeToolTrace {
            events: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: vec![serde_json::json!({
                "toolName": "update_working_checkpoint",
                "status": "success"
            })],
            raw_calls: Vec::new(),
            awaiting_user: false,
            pending_approval: None,
        };

        assert!(should_continue_after_read_only_tool(&trace));
    }

    #[test]
    fn native_memory_l1_renders_file_read_resource_pointers() {
        let scope = NativeMemoryScope::GlobalUser;
        let item = NativeMemoryItemRecord {
            id: "nmi_test".to_string(),
            layer: NativeMemoryLayer::L2,
            scope: scope.clone(),
            title: "Verified command".to_string(),
            body: "Run cargo check.".to_string(),
            triggers: vec!["cargo check".to_string()],
            tags: vec!["testing".to_string()],
            source_refs: serde_json::json!([{ "kind": "session", "id": "sess_1" }]),
            status: "active".to_string(),
            supersedes_item_id: None,
            created_at: "2026-06-17T00:00:00+00:00".to_string(),
            updated_at: "2026-06-17T00:00:00+00:00".to_string(),
        };
        let entry = NativeMemoryIndexEntryRecord {
            id: "nmix_test".to_string(),
            scope: scope.clone(),
            trigger: "cargo check".to_string(),
            target_item_id: item.id.clone(),
            rank: 10,
            reason: Some("Route test work.".to_string()),
            created_at: "2026-06-17T00:00:00+00:00".to_string(),
            updated_at: "2026-06-17T00:00:00+00:00".to_string(),
        };

        let l1 = render_native_memory_l1(&scope, std::slice::from_ref(&item), &[entry]);
        let item_body = render_native_memory_item(&item);

        assert!(l1.contains("memory_resource: memory://global/l1"));
        assert!(l1.contains("target: memory://global/l2/nmi_test"));
        assert!(l1.contains("target_title: Verified command"));
        assert!(item_body.contains("memory_item: memory://global/l2/nmi_test"));
        assert!(item_body.contains("body:\nRun cargo check."));
    }

    #[test]
    fn builtin_capability_packs_render_resources_and_l1_triggers() {
        let packs = builtin_capability_packs();
        let resources = native_capability_resource_files(&packs).expect("capability resources");

        assert!(resources
            .get("capability://index")
            .expect("index")
            .contains("capability://morphling/manifest"));
        assert!(resources
            .get("capability://goal-hive/manifest")
            .expect("goal hive manifest")
            .contains("permissions: read_memory, write_memory, manage_goal_tasks"));
        assert!(resources
            .get("capability://morphling/sops/main")
            .expect("morphling sop")
            .contains("Promote a repeated workflow only after evidence"));

        let mut memory_resources = HashMap::from([(
            "memory://global/l1".to_string(),
            "memory_resource: memory://global/l1".to_string(),
        )]);
        attach_capability_triggers_to_memory_l1(&mut memory_resources, &packs);
        let l1 = memory_resources
            .get("memory://global/l1")
            .expect("global l1");
        assert!(l1.contains("Capability packs:"));
        assert!(l1.contains("target: capability://goal-hive/manifest"));
        assert!(l1.contains("target: capability://browser-control/manifest"));
    }

    #[test]
    fn workspace_resources_index_project_files_and_skip_heavy_dirs() {
        let root = tempfile::tempdir().unwrap();
        let scratch = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("src")).unwrap();
        fs::create_dir_all(root.path().join("node_modules/pkg")).unwrap();
        fs::write(root.path().join("Cargo.toml"), "[package]\n").unwrap();
        fs::write(root.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(root.path().join("node_modules/pkg/index.js"), "ignored\n").unwrap();

        let workspace = native_workspace_context_with_scratch(
            &SessionId("s-workspace-index".into()),
            Some("proj_workspace"),
            Some(root.path().to_str().unwrap()),
            Some(scratch.path().join("scratch")),
        )
        .expect("workspace context");
        let resources = native_workspace_resource_files(&workspace).expect("workspace resources");
        let snapshot = resources.get("workspace://snapshot").unwrap();
        let index = resources.get("workspace://index").unwrap();

        assert_eq!(workspace.kind, "project_workspace");
        assert_eq!(workspace.status, "available");
        assert!(snapshot.contains("project_id: proj_workspace"));
        assert!(index.contains("@Cargo.toml"));
        assert!(index.contains("@src/main.rs"));
        assert!(!index.contains("node_modules"));
        assert!(resources
            .get("workspace://scratch")
            .unwrap()
            .contains("scratch_root:"));
    }

    #[test]
    fn missing_project_workspace_snapshot_is_actionable() {
        let scratch = tempfile::tempdir().unwrap();
        let missing = scratch.path().join("missing-project");

        let workspace = native_workspace_context_with_scratch(
            &SessionId("s-workspace-missing".into()),
            Some("proj_missing"),
            Some(missing.to_str().unwrap()),
            Some(scratch.path().join("scratch")),
        )
        .expect("workspace context");
        let resources = native_workspace_resource_files(&workspace).expect("workspace resources");

        assert_eq!(workspace.kind, "project_workspace");
        assert_eq!(workspace.status, "missing");
        assert_eq!(workspace.effective_root.as_deref(), Some(missing.as_path()));
        assert!(resources
            .get("workspace://snapshot")
            .unwrap()
            .contains("Locate the folder"));
        assert!(resources
            .get("workspace://index")
            .unwrap()
            .contains("Project workspace"));
    }

    #[test]
    fn scratch_workspace_is_default_without_project_workspace() {
        let scratch = tempfile::tempdir().unwrap();
        let scratch_root = scratch.path().join("scratch");
        let workspace = native_workspace_context_with_scratch(
            &SessionId("s-workspace-scratch".into()),
            None,
            None,
            Some(scratch_root.clone()),
        )
        .expect("workspace context");

        assert_eq!(workspace.kind, "scratch");
        assert_eq!(workspace.status, "available");
        assert_eq!(
            workspace.effective_root.as_deref(),
            Some(scratch_root.as_path())
        );
        assert!(scratch_root.is_dir());
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
    fn file_patch_waits_for_approval_with_preview_args() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\nbeta\n").unwrap();
        let final_answer = r#"```json
{"tool":"file_patch","arguments":{"path":"notes.txt","oldContent":"beta\n","newContent":"bravo\n"}}
```"#;

        let trace = native_event_trace_with_context(
            "s-native-file-patch",
            1,
            final_answer,
            "file patch summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
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
        let pending = serde_json::to_value(&trace.events[3]).unwrap();
        assert_eq!(pending["toolName"], "file_patch");
        assert_eq!(pending["arguments"]["path"], "notes.txt");
        assert_eq!(pending["arguments"]["old_content"], "beta\n");
        assert_eq!(pending["arguments"]["new_content"], "bravo\n");
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(
            turn_end["toolCalls"][0]["argumentsJson"]["old_content"],
            "beta\n"
        );
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\nbeta\n"
        );
    }

    #[test]
    fn file_write_waits_for_approval_with_preview_args() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let final_answer = r#"```json
{"tool":"file_write","arguments":{"path":"notes.txt","content":"bravo\n","overwrite":true}}
```"#;

        let trace = native_event_trace_with_context(
            "s-native-file-write",
            1,
            final_answer,
            "file write summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
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
        let pending = serde_json::to_value(&trace.events[3]).unwrap();
        assert_eq!(pending["toolName"], "file_write");
        assert_eq!(pending["arguments"]["path"], "notes.txt");
        assert_eq!(pending["arguments"]["mode"], "overwrite");
        assert_eq!(pending["arguments"]["existing_content"], "alpha\n");
        assert_eq!(pending["arguments"]["content"], "bravo\n");
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(
            turn_end["toolCalls"][0]["argumentsJson"]["existing_content"],
            "alpha\n"
        );
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\n"
        );
    }

    #[test]
    fn high_risk_long_term_update_stops_at_pending_approval() {
        let final_answer = r#"```json
{"tool":"start_long_term_update","arguments":{"topic":"learn testing","kind":"capability","risk":"high"}}
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

    #[tokio::test]
    async fn low_risk_long_term_update_applies_native_memory() {
        let session_id = SessionId("s-native-memory-apply".into());
        let galley = native_memory_test_galley(session_id.as_str()).await;
        let session = native_test_session(session_id.as_str(), Some("proj-native-memory-apply"));
        let final_answer = r#"```json
{"tool":"start_long_term_update","arguments":{"topic":"Preferred test command","proposal":"Use cargo test --manifest-path core/Cargo.toml when touching Rust core code.","triggers":["rust core tests","cargo test"],"tags":["testing"]}}
```"#;
        let mut trace = native_tool_trace(
            session_id.as_str(),
            1,
            final_answer,
            "2026-06-17T00:00:00.000Z".to_string(),
            &NativeToolExecutionContext::default(),
        );

        assert!(trace.pending_approval.is_none());
        assert_eq!(trace.raw_calls.len(), 1);
        let call = trace.raw_calls[0].clone();
        assert_eq!(call.source, NativeToolCallSource::TextFallback);
        let result =
            start_long_term_update_tool_result(&galley, &session_id, 1, &call, &session).await;
        replace_native_tool_result(
            &mut trace,
            session_id.as_str(),
            1,
            &call,
            result,
            "Native memory update applied.",
        );

        assert_eq!(trace.tool_results[0]["status"], "success");
        assert_eq!(
            trace.tool_results[0]["sideEffectsPerformed"].as_bool(),
            Some(true)
        );
        assert!(trace.events.iter().any(|event| matches!(
            event,
            NativeRuntimeEvent::ToolProgress(progress)
                if progress.message == "Native memory update applied."
        )));
        assert!(trace.events.iter().any(|event| matches!(
            event,
            NativeRuntimeEvent::ToolEnd(end)
                if end.tool_call_id == call.id
                    && end.status == "success"
                    && end.side_effects_performed
        )));
        let scope = NativeMemoryScope::Project("proj-native-memory-apply".into());
        let items = galley
            .list_native_memory_items_for_scope(&scope, 10)
            .await
            .expect("list applied memory");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].layer, NativeMemoryLayer::L2);
        assert_eq!(
            items[0].body,
            "Use cargo test --manifest-path core/Cargo.toml when touching Rust core code."
        );
        let entries = galley
            .list_native_memory_index_entries_for_scope(&scope, 10)
            .await
            .expect("list memory index");
        assert_eq!(entries.len(), 2);
        let changes = galley
            .list_native_memory_changes(10)
            .await
            .expect("list memory changes");
        assert_eq!(changes.len(), 1);
        assert_eq!(
            changes[0].approval_state,
            NativeMemoryApprovalState::AutoApplied
        );
    }

    #[test]
    fn code_run_waits_for_approval_with_resolved_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let final_answer = r#"```json
{"tool":"code_run","arguments":{"command":"echo hi","timeoutSeconds":2}}
```"#;

        let trace = native_event_trace_with_context(
            "s-native-code-run",
            1,
            final_answer,
            "code run summary",
            "2026-06-16T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
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
        let pending = serde_json::to_value(&trace.events[3]).unwrap();
        assert_eq!(pending["toolName"], "code_run");
        assert_eq!(pending["arguments"]["command"], "echo hi");
        assert_eq!(pending["arguments"]["timeoutSeconds"], 2);
        assert_eq!(
            pending["arguments"]["resolved_cwd"].as_str(),
            Some(
                dir.path()
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(
            turn_end["toolCalls"][0]["argumentsJson"]["resolved_cwd"].as_str(),
            Some(
                dir.path()
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
    }

    #[test]
    fn web_execute_js_waits_for_approval_when_browser_context_exists() {
        let dir = tempfile::tempdir().unwrap();
        let final_answer = r#"```json
{"tool":"web_execute_js","arguments":{"code":"document.title","tabId":"101"}}
```"#;
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python: PathBuf::from(if cfg!(windows) { "python" } else { "python3" }),
                code_root: dir.path().join("code"),
                state_root: dir.path().join("state"),
                wait_timeout_seconds: 1,
            },
        );

        let trace = native_event_trace_with_context(
            "s-native-web-js",
            1,
            final_answer,
            "web execute js summary",
            "2026-06-17T00:00:00.000Z".to_string(),
            "Galley Native mock",
            "mock_model",
            "mock",
            None,
            None,
            &context,
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
        let pending = serde_json::to_value(&trace.events[3]).unwrap();
        assert_eq!(pending["toolName"], "web_execute_js");
        assert_eq!(pending["arguments"]["script"], "document.title");
        assert_eq!(pending["arguments"]["switch_tab_id"], "101");
        let turn_end = serde_json::to_value(&trace.events[5]).unwrap();
        assert_eq!(turn_end["toolResults"], serde_json::json!([]));
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
