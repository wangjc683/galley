import type { TodoItem, TodoTarget } from "@/lib/assistant-todo";
import { openMainChat } from "@/lib/main-chat";
import type { TodoPlace } from "@/lib/todo-panel-memory";
import { useUiStore, type QuoteRequest, type Screen } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * The to-do panel's ways in and out (main chat tickets 42, 45, 46): the
 * top bar's button and ⌘K, a title's jump, 「说说这件」, 「跟 Galley 说」.
 *
 * Since ticket 46 (PRD ruling 95) the panel opens beside any
 * conversation while there is a main chat — Galley, a workbench
 * conversation, a subtask, the empty composer — and is remembered open
 * or closed in two places (lib/todo-panel-memory.ts). Ticking, unticking
 * and cancelling a reminder happen where it is. What the user says about
 * a to-do is said to Galley, so a jump out of the panel lands where it
 * leads, and the panel goes with it: that place is marked open.
 */

/**
 * The main chat itself is in the main area — ruling 87's 「开着」: one of
 * its subtasks is not, nor a workbench conversation, nor the empty
 * composer. The external runtime has no main chat.
 */
export function mainChatOnScreen(
  screen: Screen,
  session: Pick<Session, "mainChat"> | undefined,
): boolean {
  return screen === "main" && Boolean(session?.mainChat);
}

/** Which place's panel the main area has (ticket 46): Galley's beside
 * the main chat itself, the other one beside anything else. */
export function todoPlaceOf(
  screen: Screen,
  session: Pick<Session, "mainChat"> | undefined,
): TodoPlace {
  return mainChatOnScreen(screen, session) ? "galley" : "elsewhere";
}

/** What the main area has of the to-do (ticket 46). */
export interface TodoView {
  /** The top bar's 「待办」 button: in every conversation's top bar
   * while there is a main chat — Galley, the workbench, a subtask, the
   * empty composer. */
  entry: boolean;
  /** The place on screen. */
  here: TodoPlace;
  /** The panel is on screen: this place's is open. */
  shown: boolean;
}

export function todoView(
  hasMainChat: boolean,
  open: Readonly<Record<TodoPlace, boolean>>,
  screen: Screen,
  session: Pick<Session, "mainChat"> | undefined,
): TodoView {
  const here = todoPlaceOf(screen, session);
  return { entry: hasMainChat, here, shown: hasMainChat && open[here] };
}

/** ⌘K's 「待办」: open beside what is on screen, in its place (ticket 46;
 * until then it landed on Galley first). It always opens; the button
 * toggles. */
export function openTodoPanel(here: TodoPlace): void {
  useUiStore.getState().setTodoPanelOpen(here, true);
}

/** The top bar's 「待办」 button (ticket 45): a panel on screen closes,
 * otherwise it opens, in place. */
export function toggleTodoPanel(here: TodoPlace, shown: boolean): void {
  useUiStore.getState().setTodoPanelOpen(here, !shown);
}

/**
 * Back to Galley from elsewhere, the panel with you (Galley's place
 * marked open). When there is no main chat to land on after all (Core
 * failed), `undo` takes back what was asked of it, so it does not wait
 * for the next visit.
 */
function backToGalley(undo: () => void): void {
  useUiStore.getState().setTodoPanelOpen("galley", true);
  void openMainChat().then((landed) => {
    if (!landed) undo();
  });
}

/**
 * A title clicked in the panel. The reply that noted it is in the main
 * chat: beside Galley the 查找聊天记录 jump (ticket 28) happens in place —
 * useStickyScroll consumes the request, paging back to it and lighting
 * it up — and the panel stays; from elsewhere the request is filed
 * first, as ⌘K's message hits file it (the session switch's snap to the
 * bottom reads it and stands down), then Galley opens. A subtask or a
 * scheduled run's session opens in the main area, its place marked
 * open so the panel follows.
 */
export function goToTodoTarget(
  target: TodoTarget,
  here: TodoPlace,
  mainChatId: string,
  openSession: (sessionId: string) => void,
): void {
  const ui = useUiStore.getState();
  switch (target.kind) {
    case "reply": {
      ui.requestLocate(target.sessionId, target.messageId);
      if (here === "galley") return;
      const request = useUiStore.getState().locateRequest;
      backToGalley(() => {
        if (useUiStore.getState().locateRequest === request) ui.clearLocate();
      });
      return;
    }
    case "subtask":
    case "session":
      ui.setTodoPanelOpen(
        target.sessionId === mainChatId ? "galley" : "elsewhere",
        true,
      );
      openSession(target.sessionId);
      return;
  }
}

/** 「说说这件」: the title, quoted into the main chat's composer (ticket
 * 07's quote strip, its limit and its dedupe) and the caret there; the
 * panel stays open. From elsewhere Galley opens first and its composer
 * takes the quote as it appears (MainView). */
export function quoteTodo(
  item: TodoItem,
  here: TodoPlace,
  mainChatId: string,
): void {
  const ui = useUiStore.getState();
  ui.requestQuote(mainChatId, item.text);
  if (here === "galley") return;
  const request = useUiStore.getState().quoteRequest;
  backToGalley(() => {
    if (useUiStore.getState().quoteRequest === request) ui.clearQuote();
  });
}

/** The empty panel's 「跟 Galley 说」: the caret in Galley's composer —
 * beside Galley at once (`focusComposer`), from elsewhere once Galley
 * is open (a composer that appears takes the caret, useComposerFocus). */
export function talkToGalley(here: TodoPlace, focusComposer: () => void): void {
  if (here === "galley") focusComposer();
  else backToGalley(() => {});
}

/** The text MainView's composer quotes for a request, or null: only one
 * for the main chat it shows. */
export function quoteForComposer(
  request: QuoteRequest | null,
  sessionId: string | undefined,
  isMainChat: boolean,
): string | null {
  if (!request) return null;
  if (!isMainChat || request.sessionId !== sessionId) return null;
  return request.text;
}

/** MainView's half of 「说说这件」: the text its composer quotes, taken
 * off the store (cleared), or null. Taken once, whether it came while
 * the main chat was on screen or was filed before the panel sent you
 * there (ticket 46); another conversation's MainView leaves it be. */
export function takeQuote(
  sessionId: string | undefined,
  isMainChat: boolean,
): string | null {
  const ui = useUiStore.getState();
  const text = quoteForComposer(ui.quoteRequest, sessionId, isMainChat);
  if (text !== null) ui.clearQuote();
  return text;
}
