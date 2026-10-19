import {
  assistantCachedSettledSentence,
  assistantTyping,
} from "@/lib/assistant-conversation";
import {
  EMPTY_TURNS,
  type MessagesStore,
  useMessagesStore,
} from "@/stores/messages";

/*
 * What the main chat's round says while it runs, read from its message
 * cache for the header identity and the sidebar card (main chat PRD
 * rulings 107, 110): the main chat opens at launch, and the runner's
 * events land in its cache whether it is on screen or not
 * (lib/ipc-handlers.ts appends by the event's session). Each selector
 * returns a string or a boolean, so a chunk that leaves the answer as
 * it was re-renders nothing.
 */

/**
 * useAssistantSettledSentence's selector: null at rest without looking
 * at the turns; running, the newest settled step's sentence
 * (lib/assistant-conversation.ts `assistantSettledSentence`).
 */
export function selectAssistantSettledSentence(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): string | null {
  if (!running) return null;
  const m = state.byId[sessionId];
  return m ? assistantCachedSettledSentence(m.turns) : null;
}

/**
 * While the main chat runs, the header's second line: the sentence of
 * the newest step that settled (null for 「思考中」). It changes only when
 * a step lands, never per chunk: what streams is not read.
 */
export function useAssistantSettledSentence(
  sessionId: string,
  running: boolean,
): string | null {
  return useMessagesStore((s) =>
    selectAssistantSettledSentence(s, sessionId, running),
  );
}

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
 * While the main chat runs, whether the card says 「正在输入…」 — the
 * conversation's dots' own rule, so in a round Core woke it for the card
 * follows the dots and otherwise keeps the last message. A boolean, so
 * the card re-renders only when it flips.
 */
export function useAssistantTyping(
  sessionId: string,
  running: boolean,
): boolean {
  return useMessagesStore((s) => selectAssistantTyping(s, sessionId, running));
}
