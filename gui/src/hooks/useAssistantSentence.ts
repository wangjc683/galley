import {
  assistantCachedSentence,
  assistantWriting,
} from "@/lib/assistant-conversation";
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
 * `assistantCachedSentence`), for the sidebar card while the main chat
 * is not on screen (ruling 68; the header says 「正在输入…」 or
 * 「思考中」, ruling 104), read from the main chat's message cache: it opens at
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

/**
 * useAssistantWriting's selector: false at rest without looking at the
 * stream; running, whether the session's stream is writing words
 * (`assistantWriting`).
 */
export function selectAssistantWriting(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): boolean {
  if (!running) return false;
  const m = state.byId[sessionId];
  return m ? assistantWriting(m.inFlightContent) : false;
}

/**
 * While the main chat runs, whether it is writing words right now, for
 * the header identity's 「正在输入…」 (main chat PRD ruling 104), from
 * the same message cache and stream as the sentence. Only the header
 * asks: the card, with the main chat on screen, says the last message.
 * The selector returns a boolean, so the header re-renders only when it
 * flips, not per chunk.
 */
export function useAssistantWriting(
  sessionId: string,
  running: boolean,
): boolean {
  return useMessagesStore((s) => selectAssistantWriting(s, sessionId, running));
}
