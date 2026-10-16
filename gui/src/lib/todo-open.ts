import type { TodoItem, TodoTarget } from "@/lib/assistant-todo";
import { openMainChat } from "@/lib/main-chat";
import { useUiStore, type QuoteRequest, type Screen } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * The to-do panel's ways in and out (main chat ticket 42): opening it,
 * a title's jump, 「说说这件」.
 */

/**
 * The main chat itself is in the main area — ruling 87's 「开着」: one of
 * its subtasks is not, nor a workbench conversation, nor the empty
 * composer. Only then does the top bar have 待办 (ticket 45) and the
 * panel show beside it; elsewhere a wanted panel waits, folded away, for
 * Galley to come back. The external runtime has no main chat.
 */
export function mainChatOnScreen(
  screen: Screen,
  session: Pick<Session, "mainChat"> | undefined,
): boolean {
  return screen === "main" && Boolean(session?.mainChat);
}

/**
 * Open the to-do panel: it lives beside the main chat only, so from the
 * workbench, a subtask or the empty composer this lands on Galley
 * first. ⌘K's 「待办」 comes here.
 */
export function openTodoPanel(): void {
  useUiStore.getState().setTodoPanelOpen(true);
  void openMainChat();
}

/** The top bar's 「待办」 button (ticket 45): a panel on screen closes,
 * otherwise it opens. The button is there only while the main chat
 * itself is, so there is nowhere to land first. */
export function toggleTodoPanel(shown: boolean): void {
  useUiStore.getState().setTodoPanelOpen(!shown);
}

/**
 * A title clicked in the panel. The reply that noted it is in the main
 * chat beside the panel, so the 查找聊天记录 jump (ticket 28) happens in
 * place — useStickyScroll consumes the request, paging back to it and
 * lighting it up — and the panel stays. A subtask or a scheduled run's
 * session opens in the main area, which folds the panel away until
 * Galley is back.
 */
export function goToTodoTarget(
  target: TodoTarget,
  openSession: (sessionId: string) => void,
): void {
  switch (target.kind) {
    case "reply":
      useUiStore.getState().requestLocate(target.sessionId, target.messageId);
      return;
    case "subtask":
    case "session":
      openSession(target.sessionId);
      return;
  }
}

/** 「说说这件」: the title, quoted into the main chat's composer (ticket
 * 07's quote strip, its limit and its dedupe); the panel stays open. */
export function quoteTodo(mainChatId: string, item: TodoItem): void {
  useUiStore.getState().requestQuote(mainChatId, item.text);
}

/** The text MainView's composer quotes for a new request, or null: only
 * a new one, for the main chat it shows. */
export function quoteForComposer(
  request: QuoteRequest | null,
  previous: QuoteRequest | null,
  sessionId: string | undefined,
  isMainChat: boolean,
): string | null {
  if (!request || request === previous) return null;
  if (!isMainChat || request.sessionId !== sessionId) return null;
  return request.text;
}
