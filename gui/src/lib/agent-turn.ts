// AgentTurn construction — the single code home.
//
// Two paths build the same AgentTurn shape: the live `turn_end` path
// (lib/ipc-handlers.ts) and the SQLite restore path
// (stores/messages/rowsToTurns.ts). Before this module they were
// hand-mirrored twins held in sync by comments; a one-sided edit
// rendered a session one way live and another way after reopen. Every
// shared rule now lives here exactly once:
//
//   - tool-event construction (defensive narrowing, id resolution,
//     ≤500-char result preview, denial detection, browser tab facts)
//   - the final-answer-turn gate (`no_tool` / zero tools)
//   - empty-final-answer → null normalization
//   - field presence normalization (undefined vs omitted)
//
// NOT shared, by design: deriving thinking/preamble out of the raw
// turn_end fields (responseThinking / responseContent; live-only —
// restore reads the persisted columns),
// and legacy-row repairs (they are history fixes, not shape rules —
// they stay in rowsToTurns).
//
// The round-trip invariant "live turn === restored turn for the same
// data" is pinned by agent-turn.test.ts.

import { browserFactsFromResult } from "@/lib/browser-site";
import { settledToolStatus, toolErrorDisplay } from "@/lib/tool-outcome";
import type { AgentTurn, ConversationToolEvent } from "@/types/conversation";

/** Loosest common shape of a tool call: the live path's typed IPC
 * `ToolCall` and restore's JSON-parsed `Record<string, unknown>` both
 * satisfy it; narrowing happens inside `toolEventsFromRaw` for both. */
export interface RawToolCall {
  toolName?: unknown;
  args?: unknown;
  toolUseId?: unknown;
  resolvedPath?: unknown;
  [key: string]: unknown;
}

export interface RawToolResult {
  toolUseId?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

/**
 * Build the tool events of one agent turn. `idPrefix` preserves each
 * caller's id namespace when neither side carried a `toolUseId`:
 * live uses `"t-"` (unique within a turn), restore uses
 * `` `t-${row.turn_index}-` `` (unique across the whole restored
 * session — React keys span messages there).
 */
export function toolEventsFromRaw(
  calls: RawToolCall[],
  results: RawToolResult[],
  idPrefix: string,
): ConversationToolEvent[] {
  return calls.map((tc, i) => {
    const result = results[i];
    const id =
      (typeof result?.toolUseId === "string" && result.toolUseId) ||
      (typeof tc.toolUseId === "string" && tc.toolUseId) ||
      `${idPrefix}${i}`;
    // Both paths describe settled turns: turn_end is the
    // post-completion signal, and a persisted row is by definition
    // settled. Denials and GA error envelopes are detected from the
    // result payload (lib/tool-outcome.ts); everything else fades
    // into the document as "success-historical".
    const status = settledToolStatus(result?.content);
    const error =
      status === "failed-historical" ? toolErrorDisplay(result?.content) : null;
    const name = typeof tc.toolName === "string" ? tc.toolName : "(unknown)";
    const args = (tc.args as Record<string, unknown>) ?? {};
    // Browser tab facts come from the full content: the 500-char
    // preview below cuts a scan's tab list off (lib/browser-site.ts).
    const browser = browserFactsFromResult(name, args, result?.content);
    return {
      id,
      name,
      status,
      // Headline-first error rendering (#22): the one-line cause rides
      // the callout's summary slot (collapsed lead + expanded lead),
      // the decoded body replaces the raw-envelope preview.
      summary: error?.headline,
      errorDetail: error?.detail,
      args,
      resultPreview: previewFromContent(result?.content),
      ...(typeof tc.resolvedPath === "string" && tc.resolvedPath
        ? { resolvedPath: tc.resolvedPath }
        : {}),
      ...(browser ? { browser } : {}),
    };
  });
}

/** ≤500-char result preview with a visible ellipsis when content was
 * cut — silent truncation reads as "the output just ends here".
 * null/undefined content means "nothing to preview" (2026-07-11
 * decision: the live path used to render a literal "null" here). */
export function previewFromContent(content: unknown): string | undefined {
  if (content === undefined || content === null) return undefined;
  let full: string;
  if (typeof content === "string") {
    full = content;
  } else {
    try {
      full = JSON.stringify(content);
    } catch {
      full = String(content);
    }
  }
  return full.length > 500 ? `${full.slice(0, 500)}…` : full;
}

/**
 * The final-answer-turn gate: GA's synthetic `no_tool` placeholder (or
 * zero tools) marks the turn whose narrator IS the final answer. For
 * those turns the caller must NOT keep a preamble — the same prose
 * would double-render under TurnMarker and as MessageAgent.
 */
export function isFinalAnswerTurn(tools: ConversationToolEvent[]): boolean {
  return tools.length === 0 || tools.every((t) => t.name === "no_tool");
}

/** Empty / whitespace-only final answer → null, so Conversation's
 * `showFinalAnswer = finalAnswer !== null` correctly hides MessageAgent
 * and its Copy/Save actions for tool-only intermediate turns. */
export function normalizeFinalAnswer(
  raw: string | null | undefined,
): string | null {
  const s = raw ?? "";
  return s.trim() ? s : null;
}

export interface AgentTurnFields {
  /** Live: turn_end's responseThinking, else
   * extractThinking(responseContent). Restore: row.thinking. */
  thinking?: string | null;
  /** Live: extractPreamble(responseContent), already gated by
   * `isFinalAnswerTurn` at the derivation site. Restore: row.preamble
   * (persisted post-gate). */
  preamble?: string | null;
  tools: ConversationToolEvent[];
  /** Pre-normalization value; `buildAgentTurn` applies
   * `normalizeFinalAnswer`. */
  finalAnswer: string | null | undefined;
  /** Per-message display step ("第 N 步") — live: GA's raw turnIndex;
   * restore: the stepper-recovered displayStep (see lib/turn-index.ts). */
  turnIndex: number;
  summary?: string | null;
  telemetry?: AgentTurn["telemetry"] | null;
  /** `finalAnswerFileRefs` of the raw response — live: responseContent;
   * restore: the row's `content`. Kept only on a turn with a final
   * answer. */
  files?: string[];
  /** `isSilentReply` of the raw response — live: responseContent;
   * restore: the row's `content`. Kept only on a closing turn left with
   * no answer (main chat tickets 29 / 31). */
  silent?: boolean;
  /** `isSummaryOnlyReply` of the raw response — live: responseContent;
   * restore: the row's `content`. A closing turn that wrote its words
   * only into `<summary>` shows the summary as its answer (main chat
   * PRD ruling 89). */
  summaryOnly?: boolean;
  /** When the step landed — live: turn_end's `timestamp`; restore: the
   * row's `created_at`. */
  settledAt?: string;
}

/** Assemble the one true AgentTurn shape. All presence normalization
 * (null → omitted, empty summary → omitted) happens here so the two
 * callers cannot drift on it. */
export function buildAgentTurn(fields: AgentTurnFields): AgentTurn {
  const trimmedSummary = fields.summary?.trim();
  const turn: AgentTurn = {
    role: "agent",
    thinking: fields.thinking ?? undefined,
    preamble: fields.preamble ?? undefined,
    tools: fields.tools,
    finalAnswer: normalizeFinalAnswer(fields.finalAnswer),
    turnIndex: fields.turnIndex,
    summary: trimmedSummary ? trimmedSummary : undefined,
  };
  if (fields.telemetry) turn.telemetry = fields.telemetry;
  // A closing reply whose words went only into `<summary>` (ruling 89):
  // no conversation draws a summary, so it would say nothing at all.
  // Not a question (its bubble is the question) and not a tool step.
  if (
    fields.summaryOnly &&
    turn.finalAnswer === null &&
    turn.summary !== undefined &&
    isFinalAnswerTurn(turn.tools)
  ) {
    turn.finalAnswer = turn.summary;
  }
  if (turn.finalAnswer !== null && fields.files && fields.files.length > 0) {
    turn.files = fields.files;
  }
  if (
    fields.silent &&
    turn.finalAnswer === null &&
    isFinalAnswerTurn(turn.tools)
  ) {
    turn.silent = true;
  }
  if (fields.settledAt) turn.settledAt = fields.settledAt;
  return turn;
}
