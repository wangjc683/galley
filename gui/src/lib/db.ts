import { invoke } from "@tauri-apps/api/core";

import type { MessageRow, ToolEventRow } from "@/types/db";
import type { ApprovalDecision } from "@/types/ipc";
import type { RuntimeKind } from "@/types/session";
import type {
  MessageAttachment,
  PendingImageAttachment,
} from "@/types/conversation";

/**
 * Thin GUI wrappers over Galley Core Tauri commands. The GUI does not
 * hold a SQLite connection; Rust owns persistence so GUI and CLI share
 * the same authority path.
 */

// ---------------- sessions ----------------
//
// All session writes (create / archive / rename / pin / delete +
// bulk variants + project CRUD) moved to sessionsStore in M4b
// (2026-05-19). They invoke Rust Galley Core commands; the sweep
// utilities below now do the same.

/**
 * Sweep "absolutely empty" sessions on launch — title still at the
 * default "新对话" seed AND no turns have happened yet. These are
 * the residue of opening the app, getting an auto-created session,
 * and closing without ever sending a message. Without cleanup they
 * pile up indefinitely in the sidebar and crowd out real
 * conversations.
 *
 * Sessions with a user-edited title are preserved even at
 * turn_count=0 (the user might be coming back to a planned chat
 * that hasn't started yet). Archived sessions are also preserved
 * — the user chose to keep them visible somewhere.
 *
 * Returns the number of rows deleted, so callers can log it for
 * debugging cleanups that prune more than expected.
 */
export async function deleteEmptyNewSessions(): Promise<number> {
  return invoke<number>("delete_empty_new_sessions");
}

/**
 * One-time migration: delete the v0.1 demo session fixtures from
 * SQLite. Early hydrate logic seeded these six rows on first launch
 * as visual placeholders for the empty sidebar. Stage 3 ships real
 * Session Restore + onboarding, so the placeholders are pure noise.
 * Safe to call repeatedly — `DELETE ... WHERE id IN (...)` is
 * idempotent.
 *
 * Returns rows deleted, primarily for debug logging.
 */
export async function deleteDemoSessions(): Promise<number> {
  return invoke<number>("delete_demo_sessions");
}

// Session + project row mappers moved to sessionsStore in M4b
// (sessionFromBrief / projectFromBrief — both translate the Rust
// SessionBrief / ProjectBrief wire shape instead of mapping raw SQLite
// rows now that writes don't touch this file).

// ---------------- messages ----------------
//
// Stage 3 Task 3 (Session Restore) — `messages` is the source of truth
// for conversation history that survives restart. The two logical writers
// are still:
//
//   - `persistUserMessage` (this file, routed through Rust Core) — called from
//     store `appendUserTurn` the moment the user submits, so a crash before
//     turn_end doesn't lose the question. Core assigns the durable
//     `turn_index` and returns it to the GUI.
//   - `persistTurnEndToMessages` (lib/ipc-handlers.ts, routed through Rust Core) — called on
//     `turn_end`, writes the assistant row with thinking / tool_calls /
//     tool_results / final_answer + GA's raw responseContent (the latter
//     is what the bridge replays on `load_history`).
//
// `turn_index` is the absolute message-loop index Core persisted for this
// session. GA still emits 1-based per-loop step numbers; the GUI sends the
// Core-assigned `absoluteTurnIndex` to the runner so assistant rows land beside
// the matching user row.
//
// `sequence` is the order *within* a turn: user is always 0, assistant
// always 1. Tool rows would be 2+ but V0.1 collapses them into the
// assistant row's tool_calls / tool_results JSON columns.

export interface PersistUserMessageParams {
  sessionId: string;
  content: string;
  attachments?: PendingImageAttachment[];
}

export interface PersistedUserMessage {
  turnIndex?: number | null;
  attachments?: MessageAttachment[];
}

export async function persistUserMessage(
  p: PersistUserMessageParams,
): Promise<PersistedUserMessage> {
  return invoke<PersistedUserMessage>("persist_user_message", {
    sessionId: p.sessionId,
    content: p.content,
    origin: { via: "gui" },
    attachments: p.attachments ?? [],
  });
}

/**
 * One-time backfill of messages_fts from existing messages rows.
 * Runs on hydrate when the FTS table is empty but `messages` has
 * content — covers (a) fresh upgrade to the FTS migration, and
 * (b) recovery if the index ever gets out of sync (deleted from
 * SQLite shell, etc.).
 *
 * Idempotent: returns immediately if FTS row count >= eligible
 * message count, so subsequent hydrates skip the scan.
 *
 * Assistant rows index `final_answer` rather than raw `content` —
 * the markdown the user reads, not the response wrapper that
 * contains raw <thinking> blocks (which would inflate the index
 * with text that isn't user-facing).
 */
export async function backfillFtsIfEmpty(): Promise<number> {
  return invoke<number>("backfill_fts_if_empty");
}

/**
 * Message hit returned by `searchMessages`. Snippet markers `«` /
 * `»` come from SQLite FTS5's `snippet()` function and wrap the
 * matched substring(s); the renderer splits on these to overlay
 * <mark> tags.
 */
export interface MessageSearchHit {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  role: "user" | "assistant";
  turnIndex: number;
  /** Snippet with `«` / `»` delimiters around match windows. */
  snippet: string;
  /** Session's last activity, used for ordering and rendering. */
  sessionActivityAt: string;
}

/**
 * Full-text search across persisted message bodies. Two paths:
 *
 *   - query.length >= 3 → FTS5 MATCH with trigram tokenizer. Fast
 *     even on tens of thousands of rows; supports CJK + ASCII
 *     uniformly.
 *   - query.length === 2 → LIKE substring fallback. Trigram can't
 *     match 2-char queries, but they're common in Chinese ("审批",
 *     "调研"). LIKE is slower (full table scan) but acceptable for
 *     V1 message volumes.
 *   - query.length < 2 → returns [] (no implicit broad scan).
 *
 * Results JOIN sessions for the title + recency ordering. Hits are
 * deduped at the message level — one message produces one hit even
 * if its body matches multiple times.
 */
export async function searchMessages(
  query: string,
  limit = 20,
  runtimeKind?: RuntimeKind,
): Promise<MessageSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return invoke<MessageSearchHit[]>("search_messages", {
    query: q,
    limit,
    runtimeKind,
  });
}

/**
 * Load all messages for a session in conversation order. Returns
 * persisted message rows; callers convert to either `Turn[]` (for UI
 * hydration via `restoreSessionTurns`) or `ConversationMessage[]`
 * (for GA `load_history` IPC). The two consumers need slightly
 * different shapes — keep the conversion out of this primitive.
 */
/**
 * @deprecated B1 M3 — Rust port available at `galley_core_lib::db::SqliteGalley::session_messages`.
 * Migrate call sites to `invoke("session_messages", {...})` then delete this
 * once no callers remain. Kept alive in parallel per refactor/invariants.md §I1.
 */
export async function loadMessagesBySession(
  sessionId: string,
): Promise<MessageRow[]> {
  return invoke<MessageRow[]>("session_message_rows", { sessionId });
}

// ---------------- tool_events ----------------
//
// V0.1 scope: persist **approval-related rows only** — one row per
// tool_call_pending event, updated when the user records a decision.
// This delivers the schema's stated core use case ("Approval state
// lives here so we can audit later who approved what" — 001_init.sql
// L82) without requiring an IPC protocol change.
//
// What we explicitly DON'T persist here:
//   - tool_call_start / tool_call_end / tool_call_progress events
//   - Auto-allowed tools (no preceding `pending`)
//   - Completion data for approved tools (success/failed/elapsed_ms)
//
// Rationale: conversation rendering already rebuilds tool state from
// turn_end's toolCalls/toolResults (persisted in `messages` table via
// persistTurnEndToMessages). Full tool-timeline persistence —
// including auto-allowed tools and execution outcomes — is V0.2 work,
// likely paired with the Memory Inspector that surfaces it.
//
// Status semantics for the rows we DO write:
//   - 'waiting_approval' — initial state on pending arrival
//   - 'denied'           — user denied; row is terminal
//   - 'running'          — user approved (allow_once / always_allow_*);
//                          row stays at 'running' since we don't track
//                          completion. Join messages.tool_results by
//                          (session_id, turn_index, tool_name) for the
//                          actual outcome.

export interface PersistToolEventPendingParams {
  approvalId: string;
  sessionId: string;
  turnIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  argsPreview: string;
  riskLevel: "low" | "medium" | "high";
  startedAt: string;
}

/**
 * INSERT a tool_events row on tool_call_pending. Uses approvalId as
 * the primary key — every pending event from the bridge carries a
 * unique approvalId, so re-emitted pending events upsert harmlessly.
 */
export async function persistToolEventPending(
  p: PersistToolEventPendingParams,
): Promise<void> {
  await invoke("persist_tool_event_pending", {
    input: {
      approvalId: p.approvalId,
      sessionId: p.sessionId,
      turnIndex: p.turnIndex,
      toolName: p.toolName,
      args: p.args,
      argsPreview: p.argsPreview,
      riskLevel: p.riskLevel,
      startedAt: p.startedAt,
    },
  });
}

/**
 * UPDATE the existing tool_events row when the user records an
 * approval decision. No-op (zero rows affected) if the matching
 * `pending` row was never persisted — caller is best-effort anyway.
 *
 * Sets `ended_at` only for terminal decisions (deny). Approved rows
 * stay open (`ended_at` NULL, status 'running') since we don't track
 * the subsequent tool execution in this table.
 */
export async function persistToolEventApprovalDecision(
  approvalId: string,
  decision: ApprovalDecision,
  decidedAt: string,
): Promise<void> {
  await invoke("persist_tool_event_approval_decision", {
    approvalId,
    decision,
    decidedAt,
  });
}

export interface NativeSessionRunTurnResult {
  session: unknown;
  assistantMessage: unknown;
  dispatch: "completed_native";
}

export async function nativeSessionRunTurn(
  sessionId: string,
  content: string,
  turnIndex: number,
): Promise<NativeSessionRunTurnResult> {
  return invoke<NativeSessionRunTurnResult>("native_session_run_turn", {
    input: {
      sessionId,
      content,
      turnIndex,
    },
  });
}

export interface NativeApprovalResponseResult {
  session: unknown;
  approvalId: string;
  decision: ApprovalDecision;
  toolResult: unknown;
  assistantMessage?: unknown;
  dispatch: "completed_native_approval";
}

export async function nativeApprovalResponse(
  sessionId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<NativeApprovalResponseResult> {
  return invoke<NativeApprovalResponseResult>("native_approval_response", {
    input: {
      sessionId,
      approvalId,
      decision,
    },
  });
}

/**
 * Load all tool_events rows for a session, ordered by start time.
 * Used by Session restore + Memory Inspector (Stage 3 follow-ups).
 */
export async function loadToolEventsBySession(
  sessionId: string,
): Promise<ToolEventRow[]> {
  return invoke<ToolEventRow[]>("load_tool_events_by_session", { sessionId });
}

// ---------------- prefs ----------------
//
// Generic key/value preference store backed by the `prefs` table
// (PRD §8 / 001_init.sql). Values are stored as JSON strings so any
// JSON-serialisable type round-trips cleanly. Keys live in the
// caller's namespace — there's no schema for what's allowed.

/**
 * Load a typed pref by key. Returns `undefined` when missing or when
 * Core persistence isn't available (callers fall back to their default
 * state).
 *
 * Note: `T` is a type assertion — JSON has no type system, so a
 * caller asking for `boolean` on a key that was written as a string
 * gets an unsafe cast. Keep keys consistent with their types.
 */
export async function getPref<T>(key: string): Promise<T | undefined> {
  return (await invoke<T | null>("get_pref_json", { key })) ?? undefined;
}

/**
 * Persist a pref by key. UPSERT on conflict so subsequent writes
 * replace earlier values. `updated_at` is stamped with the current
 * ISO timestamp; column is required by the schema and useful for
 * future sync / debugging.
 */
export async function setPref<T>(key: string, value: T): Promise<void> {
  await invoke("set_pref_json", { key, value });
}

// ---------------- background close hint ----------------

/**
 * Push the localized title / body for the background-mode close hint
 * into Galley Core. The Rust close handler fires synchronously inside
 * the window-event callback, so it can't reach GUI i18n — we push the
 * active-language copy here (during hydrate and again on language
 * change) and Rust parks it until a close happens.
 *
 * Best-effort: a failure only means the dialog falls back to its
 * English default; it never blocks startup. The seen flag is owned
 * entirely by Rust (seeded at setup, persisted by the close handler),
 * so this command carries copy only and never touches SQLite.
 */
export async function setCloseHintCopy(
  title: string,
  body: string,
): Promise<void> {
  await invoke("set_close_hint_copy", { title, body });
}
