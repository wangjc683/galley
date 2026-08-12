// SQLite messages → UI Turn[] reconstruction.
//
// Extracted from messages.ts per [B3-M5-sub-plan §3 T5.1 G11] when
// the parent store hit the B3-I5 600-line budget. Pure functions —
// no store dependency.

import { buildAgentTurn, toolEventsFromRaw } from "@/lib/agent-turn";
import { stripGATags } from "@/lib/ipc/ga-output-cleaning";
import { makeMessageStepper } from "@/lib/turn-index";
import type {
  Origin,
  PendingAskUser,
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
 * Tools restored from history are settled by definition (turn_end is
 * the canonical "finished" signal); agent-turn.ts classifies each as
 * `success-historical`, `failed-historical` (GA error envelope) or
 * `denied` from the persisted result payload. The conversation view
 * fades / accents them appropriately.
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
      // Construction rules shared with the live turn_end path live in
      // lib/agent-turn.ts — one home, so a restored session renders
      // identically to the live one (pinned by agent-turn.test.ts's
      // round-trip test). This branch only contributes the row-specific
      // parts: JSON re-hydration, the turn_index-namespaced id prefix
      // (React keys span messages here), and the stepper's
      // absolute→displayStep recovery.
      //
      // Column notes: preamble added in migration v5, summary in v3 —
      // pre-migration rows have NULL and buildAgentTurn omits the field,
      // which is right since the data never existed on disk. Legacy
      // rows may also hold final_answer "" (persist stored the cleaned
      // string verbatim before 2026-07-11); normalizeFinalAnswer inside
      // buildAgentTurn maps both "" and NULL to null.
      const toolCalls = safeParseJsonArray(row.tool_calls);
      const toolResults = safeParseJsonArray(row.tool_results);
      const turn = buildAgentTurn({
        thinking: row.thinking,
        preamble: row.preamble,
        tools: toolEventsFromRaw(
          toolCalls,
          toolResults,
          `t-${row.turn_index}-`,
        ),
        finalAnswer: row.final_answer,
        turnIndex: stepper.stepFor(row.turn_index),
        summary: row.summary,
        telemetry: row.telemetry,
      });
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
 * Reconstruct a live `pendingAskUser` from restored turns — the app
 * restarted (or the bridge died) while a GA question was unanswered.
 *
 * `pendingAskUser` itself is transient runtime state, but everything
 * it holds is in the persisted ask_user tool args (question +
 * candidates), so restore can rebuild the full live surface — bubble,
 * chips, sidebar dot — instead of degrading to the quiet
 * AnsweredAskUser echo that a user who wasn't watching may never
 * notice. Answering through a rebuilt bubble is safe: on the bridge
 * side `ask_user_response` and `user_message` both funnel into
 * `agent.put_task`; the distinct kind is audit-trail semantics, not a
 * protocol handshake with a waiting loop.
 *
 * Rule: the question is pending iff the session's last word is an
 * unanswered ask_user — scanning from the end, the first user or
 * agent turn decides. A user turn means it was answered (replies
 * append a user turn before anything else); a later agent turn means
 * a newer run superseded the question (e.g. a Supervisor/CLI-driven
 * run); system turns (/btw exchanges, Goal narration) are bystanders
 * and skipped. Candidates are coerced through String() to mirror the
 * bridge's own defensive coercion of GA args.
 */
export function derivePendingAskUser(turns: Turn[]): PendingAskUser | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "system") continue;
    if (turn.role !== "agent") return null;
    const args = turn.tools.find((t) => t.name === "ask_user")?.args;
    if (!args || typeof args.question !== "string") return null;
    return {
      question: stripGATags(args.question),
      candidates: Array.isArray(args.candidates)
        ? args.candidates.map((c) => stripGATags(String(c)))
        : [],
    };
  }
  return null;
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
