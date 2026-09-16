import type { ConversationToolEvent } from "@/types/conversation";

/**
 * Visual tier of a tool event in the conversation (ToolCallout's
 * dispatcher; see its doc comment for the rationale):
 *
 *   hidden — `no_tool`, GA's "answer directly" sentinel
 *   inline — any tool in a settled success state: compact pill
 *   block  — attention-demanding states (waiting_approval / failed /
 *            running / denied): full callout
 */
export function pickToolTier(
  tool: ConversationToolEvent,
): "hidden" | "inline" | "block" {
  if (tool.name === "no_tool") return "hidden";
  const isSettledSuccess =
    tool.status === "success-current" || tool.status === "success-historical";
  return isSettledSuccess ? "inline" : "block";
}

/**
 * True for tools that render as the compact inline pill — the ones a
 * step marker may lift onto its summary line (Conversation.tsx
 * AgentTurn, 2026-09-16). Block-tier states stay in the process body.
 */
export function isInlineTool(tool: ConversationToolEvent): boolean {
  return pickToolTier(tool) === "inline";
}
