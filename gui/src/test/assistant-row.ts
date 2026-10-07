import { turnFromTurnEnd } from "@/lib/ipc-handlers";
import type { MessageTelemetry } from "@/types/conversation";
import type { MessageVisibility, TurnEndEvent } from "@/types/ipc";

/**
 * The derived columns of the assistant `messages` row for one
 * `turn_end` — everything but the id, turn index and `created_at`.
 */
export interface AssistantRowColumns {
  content: string;
  toolCalls: string;
  toolResults: string;
  thinking: string | null;
  finalAnswer: string | null;
  summary: string | null;
  preamble: string | null;
  telemetry: MessageTelemetry | null;
  visibility: MessageVisibility;
}

/**
 * The row the GUI's live derivation implies for a `turn_end`: exactly
 * the payload this page sent to the retired `persist_assistant_message`
 * command before 2026-10-07. Core writes the row now
 * (core/src/turn_persistence); the shared golden fixtures hold Core's
 * Rust derivation to this one, so what renders live is what reopens.
 */
export function assistantRowFromTurnEnd(
  event: TurnEndEvent,
): AssistantRowColumns {
  const turn = turnFromTurnEnd(event);
  return {
    content: event.responseContent,
    toolCalls: JSON.stringify(event.toolCalls),
    toolResults: JSON.stringify(event.toolResults),
    thinking: turn.thinking ?? null,
    // NULL (not "") for tool-only steps, matching the rendered
    // `finalAnswer: null`.
    finalAnswer: turn.finalAnswer,
    summary: turn.summary ?? null,
    // Already gated: final-answer turns carry no preamble.
    preamble: turn.preamble ?? null,
    telemetry: turn.telemetry ?? null,
    visibility: event.visibility ?? "visible",
  };
}
