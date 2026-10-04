import { invoke } from "@tauri-apps/api/core";

import type { ConversationFontSize } from "@/lib/conversation-font-size";
import type { MessageRow } from "@/types/db";
import type { RuntimeKind } from "@/types/session";
import type { MessageAttachment, PendingImageAttachment } from "@/types/conversation";

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
 *     match 2-char queries, but they're common in Chinese ("发版",
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

// ---------------- background close behavior ----------------

/**
 * Answer the first-close choice dialog (FirstCloseDialog). Rust records
 * the decision (guard + pref) and executes it — hide to background, or
 * the true-quit path with its running-agent confirm. The
 * keep-in-background *pref* itself is persisted by the prefs store
 * setter alongside this call.
 */
export async function resolveFirstClose(
  keepInBackground: boolean,
): Promise<void> {
  await invoke("resolve_first_close", { keepInBackground });
}

/**
 * Push the "keep in background on close" preference into Galley Core.
 * The Rust CloseRequested handler is a synchronous window-event
 * callback and reads a process-local atomic, not SQLite — this command
 * updates that atomic so a Settings toggle takes effect in the same
 * launch. Persistence stays with the GUI's `setPref`; Rust re-seeds
 * the atomic from the pref at next setup, so a failed push self-heals
 * on restart.
 */
export async function setKeepInBackground(enabled: boolean): Promise<void> {
  await invoke("set_keep_in_background", { enabled });
}

// ---------------- macOS menu-bar state ----------------

/**
 * Mirror the conversation width pref into the macOS menu bar's
 * Conversation Width checkmarks (View menu). Same push pattern as
 * `setCloseHintCopy`: called during hydrate and on every width change,
 * best-effort, never blocks the pref write. No-op on platforms without
 * a native menu bar.
 */
export async function setWidthMenuState(
  width: "compact" | "wide",
): Promise<void> {
  await invoke("set_width_menu_state", { width });
}

/**
 * Mirror the conversation font size pref into the macOS menu bar's
 * Conversation Font Size checkmarks (View menu). Same push pattern and
 * best-effort contract as `setWidthMenuState`.
 */
export async function setFontSizeMenuState(
  size: ConversationFontSize,
): Promise<void> {
  await invoke("set_font_size_menu_state", { size });
}
