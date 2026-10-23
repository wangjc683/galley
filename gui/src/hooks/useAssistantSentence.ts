import { assistantTyping } from "@/lib/assistant-conversation";
import {
  EMPTY_TURNS,
  type MessagesStore,
  useMessagesStore,
} from "@/stores/messages";

/*
 * Whether the main chat reads as typing while it runs, read from its
 * message cache for the sidebar card (main chat PRD rulings 107, 110):
 * the main chat opens at launch, and the runner's events land in its
 * cache whether it is on screen or not (lib/ipc-handlers.ts appends by
 * the event's session). The selector returns a boolean, so a chunk that
 * leaves the answer as it was re-renders nothing. The header reads
 * nothing here: it says nothing while it runs (rulings 134, 135); a
 * round you started has the card's other reads
 * (hooks/useAssistantProgress.ts).
 */

/**
 * useAssistantTyping's selector: false at rest without looking at the
 * stream; running, whether it reads as typing (`assistantTyping`: a
 * round you started throughout, a woken one while it writes words).
 */
export function selectAssistantTyping(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): boolean {
  if (!running) return false;
  const m = state.byId[sessionId];
  return assistantTyping(m?.turns ?? EMPTY_TURNS, m?.inFlightContent ?? "");
}

/**
 * While the main chat runs, whether the card says 「正在输入…」 in a
 * round Core woke it for — the conversation's dots' own rule, so the
 * card follows the dots and otherwise keeps the last message. A boolean,
 * so the card re-renders only when it flips.
 */
export function useAssistantTyping(
  sessionId: string,
  running: boolean,
): boolean {
  return useMessagesStore((s) => selectAssistantTyping(s, sessionId, running));
}
