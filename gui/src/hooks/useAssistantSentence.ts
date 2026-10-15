import { assistantCachedSentence } from "@/lib/assistant-conversation";
import { type MessagesStore, useMessagesStore } from "@/stores/messages";

/**
 * useAssistantSentence's selector: null at rest without looking at the
 * stream; running, the line's sentence from the session's message
 * cache.
 */
export function selectAssistantSentence(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): string | null {
  if (!running) return null;
  const m = state.byId[sessionId];
  return m ? assistantCachedSentence(m.turns, m.inFlightContent) : null;
}

/**
 * While the main chat runs, the sentence the line at the end of its
 * conversation says (lib/assistant-conversation.ts
 * `assistantCachedSentence`), for the sidebar card and the header
 * (ruling 68), read from the main chat's message cache: it opens at
 * launch, and the runner's events land in its cache whether it is on
 * screen or not (lib/ipc-handlers.ts appends by the event's session).
 * Null at rest, and while nothing is written yet (「思考中」).
 *
 * The selector returns the sentence itself, so a chunk that leaves it
 * as it was re-renders nothing.
 */
export function useAssistantSentence(
  sessionId: string,
  running: boolean,
): string | null {
  return useMessagesStore((s) =>
    selectAssistantSentence(s, sessionId, running),
  );
}
