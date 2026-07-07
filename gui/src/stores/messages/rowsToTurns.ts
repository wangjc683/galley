// SQLite messages → UI Turn[] reconstruction.
//
// Extracted from messages.ts per [B3-M5-sub-plan §3 T5.1 G11] when
// the parent store hit the B3-I5 600-line budget. Pure functions —
// no store dependency.

import { settledToolStatus } from "@/lib/tool-outcome";
import { makeMessageStepper } from "@/lib/turn-index";
import type {
  AgentTurn,
  ConversationToolEvent,
  Origin,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";
import type { MessageRow } from "@/types/db";

/**
 * Convert SQLite `messages` rows back into UI `Turn[]`. Walks rows in
 * (turn_index, sequence) order — user rows (sequence=0) become
 * UserTurn; assistant rows (sequence=1) become AgentTurn with
 * tool_calls / tool_results JSON re-hydrated into
 * ConversationToolEvent[].
 *
 * `system` and `tool` rows are skipped — V0.1 collapses tools into the
 * assistant row's JSON columns; future Memory Inspector work can
 * surface them.
 *
 * Tools restored from history are always marked `success-historical`:
 * by the time a turn is persisted, every dispatched tool has
 * completed (turn_end is the canonical "finished" signal). The
 * conversation view fades them appropriately.
 */
export function rowsToTurns(rows: MessageRow[]): Turn[] {
  const turns: Turn[] = [];
  // Per-message step recovery: AgentTurn.turnIndex is the GA-side
  // per-message step (1 for the first turn of each user message,
  // 2 for the second, etc) — what the user sees as "第 N 步".
  // SQLite stores the **absolute** session-wide turn_index instead,
  // to avoid primary-key collisions between user messages' assistant
  // rows. The stepper owns that absolute→step mapping and its
  // block-base reset rule; see lib/turn-index.ts for the invariant.
  const stepper = makeMessageStepper();
  for (const row of rows) {
    if (row.role === "user") {
      stepper.onUserRow(row.turn_index);
      const userTurn: UserTurn = {
        role: "user",
        content: row.content,
        attachments: row.attachments,
        createdAt: row.created_at,
      };
      const origin = originFromRow(row);
      if (origin) userTurn.origin = origin;
      if (row.goal_id) userTurn.goalId = row.goal_id;
      turns.push(userTurn);
    } else if (row.role === "assistant") {
      const toolCalls = safeParseJsonArray(row.tool_calls);
      const toolResults = safeParseJsonArray(row.tool_results);
      const tools: ConversationToolEvent[] = toolCalls.map((tc, i) => {
        const result = toolResults[i];
        const resultPreview = previewFromContent(result?.content);
        const id =
          (typeof result?.toolUseId === "string" && result.toolUseId) ||
          (typeof tc.toolUseId === "string" && tc.toolUseId) ||
          `t-${row.turn_index}-${i}`;
        return {
          id,
          name: typeof tc.toolName === "string" ? tc.toolName : "(unknown)",
          // Same denial detection as the live turn_end path
          // (lib/tool-outcome.ts) so a restored session shows the
          // user's rejections identically to the live one.
          status: settledToolStatus(result?.content),
          args: (tc.args as Record<string, unknown>) ?? {},
          resultPreview,
        };
      });
      const displayStep = stepper.stepFor(row.turn_index);
      // Normalize empty-string final_answer back to null (same as
      // ipc-handlers turnFromTurnEnd does for live events). Old rows
      // written before commit 1d0c404's fix may have stored "" for
      // tool-only intermediate turns; surfacing them as null here
      // keeps the Copy/Save actions from appearing under those turns.
      const finalAnswerRaw = row.final_answer ?? "";
      const finalAnswer = finalAnswerRaw.trim() ? finalAnswerRaw : null;
      const turn: AgentTurn = {
        role: "agent",
        thinking: row.thinking ?? undefined,
        // LLM "当前阶段：..." preamble (added in migration v5). Pre-
        // v5 rows have NULL — TurnMarker DetailPanel chevron stays
        // hidden when preamble is undefined and there's no
        // thinking either.
        preamble: row.preamble ?? undefined,
        tools,
        finalAnswer,
        turnIndex: displayStep,
        // GA turn summary (added in migration v3). Pre-v3 rows
        // have NULL — TurnMarker collapses to just "第 N 步"
        // when summary is undefined, which is the right behavior
        // for those rows since the data never existed on disk.
        summary: row.summary ?? undefined,
      };
      if (row.telemetry) turn.telemetry = row.telemetry;
      turns.push(turn);
    } else if (row.role === "system") {
      // The only `system` rows persisted to `messages` are Galley Goal
      // master-session narration (launch + checkpoints). /btw and other
      // bridge system messages are transient and never hit SQLite, so a
      // restored system row is always Goal narration → "goal" variant.
      const systemTurn: SystemTurn = {
        role: "system",
        content: row.content,
        variant: "goal",
      };
      turns.push(systemTurn);
    }
    // tool rows: skipped at v0.1.
  }
  return turns;
}

/**
 * Lift the SQLite origin triple onto a Turn-level Origin object. Returns
 * undefined when the row has the default `gui` via — supervisor / cli /
 * system rows get a populated Origin so MessageUser can decide whether
 * to show the M7 provenance marker. Pre-migration-006 rows (NULL
 * `created_via`) treat as `gui` and return undefined.
 */
function originFromRow(row: MessageRow): Origin | undefined {
  const via = row.created_via;
  if (!via || via === "gui") return undefined;
  if (via !== "cli" && via !== "supervisor" && via !== "system") {
    return undefined;
  }
  const origin: Origin = { via };
  if (row.supervisor) origin.supervisor = row.supervisor;
  if (row.origin_note) origin.reason = row.origin_note;
  return origin;
}

/** Defensive JSON.parse — returns `[]` on malformed / null / non-array. */
function safeParseJsonArray(raw: string | null): Record<string, unknown>[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

/** Mirror of ipc-handlers' resultPreview logic — keep ≤500 char preview,
 * with a visible ellipsis when content was actually cut (silent
 * truncation read as "the output just ends here"). */
function previewFromContent(content: unknown): string | undefined {
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
