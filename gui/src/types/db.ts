/**
 * SQLite row shapes — direct mirror of the `migrations/001_init.sql`
 * column layout. `*Row` types use snake_case to match the schema; the
 * `lib/db.ts` mappers convert between row and domain (camelCase) types.
 *
 * Keep this file in sync when migrating columns. Adding a column means
 * a new migration file + a field on the Row + the mapper.
 */

import type { MessageTelemetry } from "@/types/conversation";

export interface SessionRow {
  id: string;
  project_id: string | null;
  title: string;
  status: string;
  summary: string | null;
  turn_count: number;
  current_tool: string | null;
  pending_approval_count: number;
  error_count: number;
  pid: number | null;
  cwd: string | null;
  pinned: number; // 0 / 1
  llm_index: number | null;
  llm_key: string | null;
  llm_display_name: string | null;
  ga_runtime_kind: "managed" | "external";
  ga_runtime_id: string | null;
  prompt_profile: string | null;
  /** 0/1 — sessions.has_unread. See Session.hasUnread for semantics. */
  has_unread: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string | null;
  icon: string | null;
  color: string | null;
  pinned: 0 | 1;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

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
   * Drives the M7 supervisor provenance marker on UserTurn. */
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
  /** Goal this row belongs to (objective turn, launch ack, master
   * checkpoints). Added in migration 031; NULL on non-goal rows and on
   * rows written before 031 — goal-thread.ts falls back to the
   * objective-text heuristic for those. */
  goal_id: string | null;
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

export interface ToolEventRow {
  id: string;
  session_id: string;
  turn_index: number;
  tool_name: string;
  status: string;
  args_json: string | null;
  args_preview: string | null;
  result_preview: string | null;
  risk_level: "low" | "medium" | "high" | null;
  approval_id: string | null;
  approval_decision: string | null;
  elapsed_ms: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface ApprovalRuleRow {
  id: number;
  scope: "project" | "global";
  project_id: string | null;
  tool_name: string;
  created_at: string;
}

export interface PrefRow {
  key: string;
  value: string; // JSON
  updated_at: string;
}
