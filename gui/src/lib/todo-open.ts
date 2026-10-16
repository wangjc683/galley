import type { TodoItem, TodoTarget } from "@/lib/assistant-todo";
import { openMainChat } from "@/lib/main-chat";
import { useUiStore, type QuoteRequest } from "@/stores/ui";

/**
 * The to-do panel's ways in and out (main chat ticket 42): opening it,
 * a title's jump, 「说说这件」.
 */

/**
 * Open the to-do panel: it lives beside the main chat only, so from the
 * workbench, a subtask or the empty composer this lands on Galley
 * first. The sidebar's 「待办」 row and ⌘K's 「待办」 both come here.
 */
export function openTodoPanel(): void {
  useUiStore.getState().setTodoPanelOpen(true);
  void openMainChat();
}

/** The sidebar row: a panel on screen closes, otherwise it opens. */
export function toggleTodoPanel(shown: boolean): void {
  if (shown) useUiStore.getState().setTodoPanelOpen(false);
  else openTodoPanel();
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
