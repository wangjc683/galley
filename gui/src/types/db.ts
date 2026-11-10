/**
 * The message row as Galley Core hands it to this page: the `rows` of
 * `session_message_turns_page` (lib/db.ts), mirror of Core's
 * `PersistedMessageRow` (core/src/db/rows.rs). Snake_case like the
 * `messages` table it is read from; `stores/messages/rowsToTurns.ts`
 * turns rows into conversation turns. A message column Core starts
 * sending gets its field here.
 */

import type { MessageTelemetry } from "@/types/conversation";

export interface MessageRow {
  id: string;
  session_id: string;
  turn_index: number;
  sequence: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls: string | null; // JSON array
  tool_results: string | null; // JSON array
  thinking: string | null;
  final_answer: string | null;
  /** GA's third-person turn summary (assistant rows only). Added
   * in migration v3; pre-v3 rows have NULL. Drives the TurnMarker
   * subline "第 N 步 · {summary}" after restore. */
  summary: string | null;
  /** LLM-written "当前阶段：..." preamble paragraph (assistant rows
   * only). Added in migration v5; pre-v5 rows have NULL. Drives the
   * TurnMarker DetailPanel content after restore. */
  preamble: string | null;
  /** Origin via — `gui` / `cli` / `supervisor` / `system`. Added in
   * migration 006 (B2). Pre-006 rows have NULL → treat as `gui`.
   * Drives the provenance marker on UserTurn (lib/origin-marker: Galley
   * or Galley CLI). */
  created_via: string | null;
  /** Supervisor label when `created_via === 'supervisor'` (e.g.
   * `ga-claude-1`). NULL otherwise. Added in migration 006. */
  supervisor: string | null;
  /** Free-text rationale ("user said tldr"). NULL when supervisor
   * didn't supply one. Added in migration 007. */
  origin_note: string | null;
  /** visible by default; internal rows are retained for audit but hidden
   * from normal conversation rendering/search. Added in migration 017. */
  visibility: "visible" | "internal";
  /** Optional per-final-answer telemetry. Added in migration 028. */
  telemetry: MessageTelemetry | null;
  attachments: MessageAttachmentRow[];
  created_at: string;
}

export interface MessageAttachmentRow {
  id: string;
  messageId: string;
  sessionId: string;
  kind: "image" | string;
  path: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  createdAt: string;
}
