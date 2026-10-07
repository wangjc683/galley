//! Core-owned turn persistence (2026-10-07).
//!
//! Every runner's `turn_end` becomes an assistant `messages` row — and,
//! for visible turns, a `sessions` bump (`turn_count`, `summary`,
//! `last_activity_at`) — written by Core itself, whether or not a GUI
//! page is listening. Before this, both writes were triggered by the GUI
//! page's `runner-event` listener, so a webview reload (macOS WebContent
//! crash recovery, Windows F5, dev HMR) silently dropped whole runs, and
//! `session wait` returned the last step that happened to land.
//!
//! [`RunnerManager`](crate::runner_manager::RunnerManager) calls
//! [`persist_turn_end`] from the per-runner watcher it attaches on every
//! spawn path, in event order and before that runner's `RunComplete`
//! closes the run gate — so a run never reads as ended ahead of its
//! final answer.
//!
//! What stays in the GUI: rendering, the unread flag (it alone knows
//! which session is on screen; `mark_session_unread`), notifications.
//!
//! Row contract: the columns are exactly what the GUI wrote through the
//! retired `persist_assistant_message` Tauri command — same id, turn
//! index, visibility and derived fields ([`derive`]); shared golden
//! fixtures keep the TypeScript and Rust derivations identical.

mod derive;

use crate::api::{GalleyApi, MessageTelemetry, MessageVisibility, SessionId};
use crate::db::{PersistAssistantMessage, SqliteGalley};
use crate::error::GalleyError;
use crate::ipc::{TurnEndEvent, TurnTelemetry};
use serde_json::Value;
use std::future::Future;
use std::time::Duration;

/// The derived columns of one assistant row — everything it holds
/// besides its id, turn index and `created_at`.
#[derive(Debug, Clone)]
pub struct AssistantRowColumns {
    /// GA's raw `responseContent`, verbatim (history replay feeds it back).
    pub content: String,
    /// `JSON.stringify(toolCalls)` as the GUI computed it.
    pub tool_calls: String,
    /// `JSON.stringify(toolResults)`.
    pub tool_results: String,
    pub thinking: Option<String>,
    /// `None` for tool-only steps.
    pub final_answer: Option<String>,
    pub summary: Option<String>,
    /// Never set on a final-answer step (it would double-render).
    pub preamble: Option<String>,
    pub telemetry: Option<MessageTelemetry>,
    pub visibility: MessageVisibility,
}

/// Derive an assistant row from a `turn_end`, rule for rule what
/// `turnFromTurnEnd` + `persistTurnEndToMessages` did in the GUI.
/// `None` when the event's visibility is not one the row can carry —
/// the GUI's write failed to deserialize there too.
pub fn assistant_row_columns(event: &TurnEndEvent) -> Option<AssistantRowColumns> {
    let visibility = match event.visibility.as_deref() {
        None | Some("visible") => MessageVisibility::Visible,
        Some("internal") => MessageVisibility::Internal,
        Some(_) => return None,
    };
    // `event.responseThinking?.trim() || extractThinking(responseContent)`
    let thinking = event
        .response_thinking
        .as_deref()
        .map(derive::js_trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| derive::extract_thinking(&event.response_content));
    // `isFinalAnswerTurn`: no tools, or only GA's synthetic `no_tool`.
    let final_answer_turn = event
        .tool_calls
        .iter()
        .all(|call| call.get("toolName").and_then(Value::as_str) == Some("no_tool"));
    let preamble = if final_answer_turn {
        None
    } else {
        derive::extract_preamble(&event.response_content)
    };
    // `normalizeFinalAnswer(cleanFinalAnswer(…))` — already trimmed.
    let final_answer =
        Some(derive::clean_final_answer(&event.response_content)).filter(|s| !s.is_empty());
    let summary = Some(derive::js_trim(&event.summary))
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(AssistantRowColumns {
        content: event.response_content.clone(),
        tool_calls: derive::js_json_stringify(&Value::Array(event.tool_calls.clone())),
        tool_results: derive::js_json_stringify(&Value::Array(event.tool_results.clone())),
        thinking,
        final_answer,
        summary,
        preamble,
        telemetry: event.telemetry.as_ref().map(message_telemetry),
        visibility,
    })
}

fn message_telemetry(t: &TurnTelemetry) -> MessageTelemetry {
    MessageTelemetry {
        elapsed_ms: t.elapsed_ms,
        input_tokens: t.input_tokens,
        output_tokens: t.output_tokens,
        cache_create_tokens: t.cache_create_tokens,
        cache_read_tokens: t.cache_read_tokens,
        request_count: t.request_count,
        context_used_chars: t.context_used_chars,
        context_limit_chars: t.context_limit_chars,
    }
}

/// Write one `turn_end`: the assistant row (upsert on the deterministic
/// `msg_{session}_{turn}_assistant` id, so a repeat is harmless), then —
/// visible turns only — the session bump. Failures are logged, never
/// raised: the runner's event stream must keep flowing.
pub(crate) async fn persist_turn_end(
    galley: &SqliteGalley,
    session_id: &str,
    event: &TurnEndEvent,
) {
    let Some(columns) = assistant_row_columns(event) else {
        eprintln!(
            "[turn-persist] session={session_id} turn={}: unknown visibility {:?}, row skipped",
            event.turn_index, event.visibility
        );
        return;
    };
    let Some(turn_index) = resolve_turn_index(galley, session_id, event).await else {
        eprintln!(
            "[turn-persist] session={session_id} turn={}: no usable absolute turn index, row skipped",
            event.turn_index
        );
        return;
    };
    let visible = columns.visibility == MessageVisibility::Visible;
    let row = PersistAssistantMessage {
        session_id: SessionId(session_id.to_string()),
        turn_index,
        content: columns.content,
        tool_calls: Some(columns.tool_calls),
        tool_results: Some(columns.tool_results),
        thinking: columns.thinking,
        final_answer: columns.final_answer,
        summary: columns.summary,
        preamble: columns.preamble,
        visibility: columns.visibility,
        telemetry: columns.telemetry,
    };
    let ids = format!("session={session_id} turn={turn_index}");
    with_contention_retry("assistant row", &ids, || {
        galley.persist_assistant_message(row.clone())
    })
    .await;
    if visible {
        // Raw summary, like the GUI's bump: the DB layer trims, keeps
        // the previous summary on an empty one, and truncates to 80.
        // Unread stays with the GUI (`mark_session_unread`).
        with_contention_retry("session bump", &ids, || {
            galley.bump_session_after_turn(
                SessionId(session_id.to_string()),
                Some(event.summary.clone()),
                None,
                false,
            )
        })
        .await;
    }
}

/// The session-wide turn index the row keys on. Core supplies
/// `absoluteTurnIndex` on every dispatch it makes (the runner echoes it
/// as `base + step - 1`); for an event without one, apply the runner's
/// own formula to the latest user row, which opened this message block.
async fn resolve_turn_index(
    galley: &SqliteGalley,
    session_id: &str,
    event: &TurnEndEvent,
) -> Option<u32> {
    let absolute = match event.absolute_turn_index {
        Some(absolute) => absolute,
        None => {
            match galley.latest_user_turn_index(session_id).await {
                Ok(Some(base)) => base + (event.turn_index - 1).max(0),
                Ok(None) => event.turn_index,
                Err(e) => {
                    eprintln!("[turn-persist] session={session_id}: reading the user-row base failed: {e}");
                    return None;
                }
            }
        }
    };
    u32::try_from(absolute).ok()
}

/// Back-off between retries when SQLite reports contention (an FTS
/// rebuild or another writer holding the lock past `busy_timeout`).
/// Same schedule the GUI used (CONC-8).
const CONTENTION_RETRY_DELAYS_MS: [u64; 3] = [200, 500, 1000];

fn is_contention(e: &GalleyError) -> bool {
    let text = e.to_string().to_ascii_lowercase();
    text.contains("database is locked") || text.contains("busy")
}

async fn with_contention_retry<T, F, Fut>(label: &str, ids: &str, mut write: F) -> Option<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = crate::error::Result<T>>,
{
    let mut attempt = 0;
    loop {
        match write().await {
            Ok(value) => return Some(value),
            Err(e) if is_contention(&e) && attempt < CONTENTION_RETRY_DELAYS_MS.len() => {
                tokio::time::sleep(Duration::from_millis(CONTENTION_RETRY_DELAYS_MS[attempt]))
                    .await;
                attempt += 1;
            }
            Err(e) => {
                eprintln!("[turn-persist] {label} failed — {ids}: {e}");
                return None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// One golden case: the `turn_end` the GUI received (Core's wire
    /// shape) and the row columns the GUI's own derivation produces for
    /// it (`gui/src/lib/turn-persistence.golden.test.ts` writes them).
    fn golden() -> (Vec<Value>, serde_json::Map<String, Value>) {
        let cases: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/turn-persistence-cases.json"
        ))
        .expect("cases parse");
        let rows: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/turn-persistence-rows.json"
        ))
        .expect("rows parse");
        let cases = cases["cases"].as_array().expect("cases array").clone();
        let rows = rows["rows"].as_object().expect("rows object").clone();
        (cases, rows)
    }

    /// Re-key objects in byte order — the order production Core's maps
    /// iterate in (no `preserve_order`) and so the order a page receives.
    /// The vitest side applies the same (`asCoreEmits`); doing it here
    /// keeps the test independent of whether a workspace-wide build
    /// unified `preserve_order` in (galley-cli enables it).
    fn core_key_order(value: Value) -> Value {
        match value {
            Value::Array(items) => Value::Array(items.into_iter().map(core_key_order).collect()),
            Value::Object(map) => {
                let mut entries: Vec<(String, Value)> = map.into_iter().collect();
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                Value::Object(
                    entries
                        .into_iter()
                        .map(|(k, v)| (k, core_key_order(v)))
                        .collect(),
                )
            }
            other => other,
        }
    }

    fn opt(v: &Option<String>) -> Value {
        v.as_ref().map_or(Value::Null, |s| json!(s))
    }

    #[test]
    fn golden_rows_match_the_gui_derivation() {
        let (cases, rows) = golden();
        assert!(cases.len() >= 20, "golden set shrank: {}", cases.len());
        assert_eq!(cases.len(), rows.len(), "every case needs a generated row");
        for case in &cases {
            let name = case["name"].as_str().expect("case name");
            let event: TurnEndEvent =
                serde_json::from_value(core_key_order(case["turnEnd"].clone()))
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
            let want = rows
                .get(name)
                .unwrap_or_else(|| panic!("{name}: no generated row"));
            let got = assistant_row_columns(&event).unwrap_or_else(|| panic!("{name}: no row"));
            let got = json!({
                "content": got.content,
                "toolCalls": got.tool_calls,
                "toolResults": got.tool_results,
                "thinking": opt(&got.thinking),
                "finalAnswer": opt(&got.final_answer),
                "summary": opt(&got.summary),
                "preamble": opt(&got.preamble),
                "telemetry": got.telemetry.map_or(Value::Null, |t| serde_json::to_value(t).unwrap()),
                "visibility": match got.visibility {
                    MessageVisibility::Visible => "visible",
                    MessageVisibility::Internal => "internal",
                },
            });
            for field in [
                "content",
                "toolCalls",
                "toolResults",
                "thinking",
                "finalAnswer",
                "summary",
                "preamble",
                "telemetry",
                "visibility",
            ] {
                assert_eq!(got[field], want[field], "{name}: {field}");
            }
        }
    }

    #[test]
    fn unknown_visibility_yields_no_row() {
        let event: TurnEndEvent = serde_json::from_value(json!({
            "sessionId": "s", "turnIndex": 1, "summary": "", "toolCalls": [],
            "toolResults": [], "responseContent": "x", "visibility": "hidden",
            "timestamp": "t"
        }))
        .unwrap();
        assert!(assistant_row_columns(&event).is_none());
    }
}
