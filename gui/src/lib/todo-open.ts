import type { TodoItem, TodoTarget } from "@/lib/assistant-todo";
import type { FreshCard } from "@/lib/fresh-cards";
import { openMainChat } from "@/lib/main-chat";
import { todoItemWords } from "@/lib/reminder-first-line";
import type { TodoPlace } from "@/lib/todo-panel-memory";
import {
  useUiStore,
  type QuoteRequest,
  type Screen,
  type TodoPanelPage,
} from "@/stores/ui";
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
 *
 * Since ticket 87 (PRD ruling 131) the remembered open holds only where
 * the panel fits beside the conversation: in a main area under 760px it
 * is not shown, and the button, ⌘K and a card's title open a look there
 * instead (`TodoGlance`), which nothing remembers; a to-do card's title
 * opens the panel at its row (`showTodoRow`); and the panel opens by
 * itself once, the first time a card appears under your round
 * (`todoPanelIntroduces`; a to-do's, a reminder's or a memo's since
 * ticket 101). Every open and close of yours marks the panel met
 * (lib/todo-panel-memory.ts).
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

/**
 * The conversation in the main area, as a look at the panel names it
 * (main chat ticket 87): a session, or the empty composer. Leaving it —
 * another session, the other screen — folds a look.
 */
export function todoConversationKey(
  screen: Screen,
  sessionId: string | undefined,
): string {
  return screen === "main" ? `main:${sessionId ?? ""}` : screen;
}

/**
 * The panel open for a look (main chat ticket 87, PRD ruling 131 point
 * 2): what the button, ⌘K and a card's title open in a narrow main area,
 * where the panel covers the conversation's right edge — not a dialog, so
 * a click in the conversation does not close it (「说说这件」 lands in the
 * composer), and a remembered open there would have to be closed on every
 * visit when Galley has half a screen. Never remembered: ×, Esc, the
 * button again, or leaving the conversation folds it; a widening keeps it
 * on screen, beside the conversation, until you leave.
 */
export interface TodoGlance {
  /** The conversation it is open in (`todoConversationKey`). */
  at: string;
  /** It has been on screen there. A jump out of the panel sends it ahead
   * to where you are going, and it waits for you to land: the switch can
   * pass through another conversation (the active session flips once
   * the one you go to is restored), which is not a leaving. */
  arrived: boolean;
}

/** A look after the main area shows `at`: there, it has arrived; gone
 * from where it arrived, it folds; on its way, it waits. */
export function todoGlanceAfterMove(
  glance: TodoGlance | null,
  at: string,
): TodoGlance | null {
  if (!glance) return null;
  if (glance.at === at) return glance.arrived ? glance : { at, arrived: true };
  return glance.arrived ? null : glance;
}

/** The main area now shows `at` (App, each time it changes): a look
 * arrives there, or folds once you have left it. */
export function moveTodoGlance(at: string): void {
  const ui = useUiStore.getState();
  const next = todoGlanceAfterMove(ui.todoGlance, at);
  if (next !== ui.todoGlance) ui.setTodoGlance(next);
}

/** Where the panel opens and how: the place (ticket 46), the
 * conversation, and whether the main area is narrow (ticket 87). What
 * every way in and out of the panel takes. */
export interface TodoSpot {
  here: TodoPlace;
  /** The conversation on screen (`todoConversationKey`). */
  at: string;
  /** Under 760px (LocalFileWorkspace): a look, nothing remembered. */
  narrow: boolean;
}

/** What the main area has of the to-do (ticket 46). */
export interface TodoView extends TodoSpot {
  /** The top bar's 「待办」 button: in every conversation's top bar
   * while there is a main chat — Galley, the workbench, a subtask, the
   * empty composer. */
  entry: boolean;
  /** The panel is on screen: a look open here, or, in a main area wide
   * enough to have it beside the conversation, this place's remembered
   * open. The button's selected ground follows it, a look included. */
  shown: boolean;
}

/** How the panel stands in the main area (ticket 87): its width, and
 * the look open somewhere. */
export interface TodoLook {
  /** The session in the main area: the active one (none on the empty
   * composer's screen counts, `todoConversationKey`). */
  sessionId: string | undefined;
  narrow: boolean;
  glance: TodoGlance | null;
}

export function todoView(
  hasMainChat: boolean,
  open: Readonly<Record<TodoPlace, boolean>>,
  screen: Screen,
  session: Pick<Session, "mainChat"> | undefined,
  look: TodoLook,
): TodoView {
  const here = todoPlaceOf(screen, session);
  const at = todoConversationKey(screen, look.sessionId);
  // Narrow, the remembered open is not shown (ruling 131 point 2): it
  // knows nothing of side by side or cover, and a cover there would
  // need closing on every visit. Widened again, it is back.
  const shown =
    hasMainChat && (look.glance?.at === at || (!look.narrow && open[here]));
  return { entry: hasMainChat, here, at, narrow: look.narrow, shown };
}

/** Write that the panel has been met (ticket 87, ruling 131 point 4):
 * every open and close of yours, narrow or wide. */
function met(): void {
  useUiStore.getState().markTodoPanelIntroduced();
}

/** Open the panel where you are: this place remembered open, or, in a
 * narrow main area, a look here and nothing remembered (ticket 87). */
function openHere(spot: TodoSpot): void {
  const ui = useUiStore.getState();
  met();
  if (spot.narrow) ui.setTodoGlance({ at: spot.at, arrived: true });
  else ui.setTodoPanelOpen(spot.here, true);
}

/** ⌘K's 「待办」: open beside what is on screen, in its place (ticket 46;
 * until then it landed on Galley first); a look when narrow (ticket 87).
 * It always opens; the button toggles. On its 待办 page, also when the
 * panel is already up on 备忘 (ticket 97). */
export function openTodoPanel(spot: TodoSpot): void {
  openHere(spot);
  useUiStore.getState().requestTodoPage("todo");
}

/** The panel's × and Esc (ticket 87): a look folds; wide, this place is
 * remembered closed too. Narrow, the remembered open is left as it is:
 * nothing narrow writes it (ruling 131 point 2). */
export function closeTodoPanel(spot: TodoSpot): void {
  const ui = useUiStore.getState();
  met();
  ui.setTodoGlance(null);
  if (!spot.narrow) ui.setTodoPanelOpen(spot.here, false);
}

/** The top bar's 「待办」 button (ticket 45): a panel on screen closes,
 * otherwise it opens, in place. */
export function toggleTodoPanel(spot: TodoSpot, shown: boolean): void {
  if (shown) closeTodoPanel(spot);
  else openHere(spot);
}

/**
 * A jump out of the panel takes it along (ticket 46, ruling 95 point 2):
 * `place`'s panel, the conversation `at`, is open when you land. Wide,
 * that place is remembered open; narrow, the look goes ahead of you and
 * stays a look (ticket 87) — the jump itself is not a leaving.
 */
function follow(spot: TodoSpot, place: TodoPlace, at: string): void {
  const ui = useUiStore.getState();
  met();
  if (spot.narrow) ui.setTodoGlance({ at, arrived: at === spot.at });
  else ui.setTodoPanelOpen(place, true);
}

/**
 * Back to Galley from elsewhere, the panel with you. When there is no
 * main chat to land on after all (Core failed), `undo` takes back what
 * was asked of it, so it does not wait for the next visit, and a look
 * sent ahead is dropped with it.
 */
function backToGalley(
  spot: TodoSpot,
  mainChatId: string,
  undo: () => void,
): void {
  const at = todoConversationKey("main", mainChatId);
  follow(spot, "galley", at);
  void openMainChat().then((landed) => {
    if (landed) return;
    undo();
    const ui = useUiStore.getState();
    const glance = ui.todoGlance;
    if (glance && !glance.arrived && glance.at === at) ui.setTodoGlance(null);
  });
}

/**
 * A title clicked in the panel. The reply that noted it is in the main
 * chat: beside Galley the 查找聊天记录 jump (ticket 28) happens in place —
 * useStickyScroll consumes the request, paging back to it and lighting
 * it up — and the panel stays; from elsewhere the request is filed
 * first, as ⌘K's message hits file it (the session switch's snap to the
 * bottom reads it and stands down), then Galley opens. A subtask or a
 * scheduled run's session opens in the main area, the panel following
 * it there.
 */
export function goToTodoTarget(
  target: TodoTarget,
  spot: TodoSpot,
  mainChatId: string,
  openSession: (sessionId: string) => void,
): void {
  const ui = useUiStore.getState();
  switch (target.kind) {
    case "reply": {
      ui.requestLocate(target.sessionId, target.messageId);
      if (spot.here === "galley") return;
      const request = useUiStore.getState().locateRequest;
      backToGalley(spot, mainChatId, () => {
        if (useUiStore.getState().locateRequest === request) ui.clearLocate();
      });
      return;
    }
    case "subtask":
    case "session":
      follow(
        spot,
        target.sessionId === mainChatId ? "galley" : "elsewhere",
        todoConversationKey("main", target.sessionId),
      );
      openSession(target.sessionId);
      return;
  }
}

/** 「说说这件」: the title, quoted into the main chat's composer (ticket
 * 07's quote strip, its limit and its dedupe) and the caret there; the
 * panel stays open. From elsewhere Galley opens first and its composer
 * takes the quote as it appears (MainView). `title` is what the row
 * shows (lib/todo-panel.ts `todoRowText`: 「子任务」 for a subtask
 * without a title); left out, a task's first line and nothing after it
 * (main chat ticket 105, PRD ruling 151). */
export function quoteTodo(
  item: TodoItem,
  spot: TodoSpot,
  mainChatId: string,
  title: string = todoItemWords(item),
): void {
  const ui = useUiStore.getState();
  ui.requestQuote(mainChatId, title);
  if (spot.here === "galley") return;
  const request = useUiStore.getState().quoteRequest;
  backToGalley(spot, mainChatId, () => {
    if (useUiStore.getState().quoteRequest === request) ui.clearQuote();
  });
}

/** The empty panel's 「跟 Galley 说」: the caret in Galley's composer —
 * beside Galley at once (`focusComposer`), from elsewhere once Galley
 * is open (a composer that appears takes the caret, useComposerFocus). */
export function talkToGalley(
  spot: TodoSpot,
  mainChatId: string,
  focusComposer: () => void,
): void {
  if (spot.here === "galley") focusComposer();
  else backToGalley(spot, mainChatId, () => {});
}

/**
 * A to-do card's title (main chat ticket 87, PRD ruling 131 point 3),
 * as the panel's title leads back to the sentence: the panel opens
 * beside the conversation the card is in — Galley's, `mainChatId` —
 * remembered open when wide, a look when narrow, as the top bar's button
 * opens it; already on screen, it is left as it is. Then the row lights
 * up (`requestTodoRows`). Only a card whose to-do the panel lists has a
 * button (`todoListed`). A reminder card's words do the same for its
 * task's row (main chat ticket 101, PRD ruling 147 point 5), while the
 * panel lists it (lib/todo-panel.ts `reminderListed`). Both turn the
 * panel to its 待办 page, as a memo card's words turn it to 备忘
 * (`showMemoRow`): a panel already up on 备忘 had no row there to light
 * (ticket 101).
 */
export function showTodoRow(id: string, mainChatId: string): void {
  showPanelBesideGalley(mainChatId);
  const ui = useUiStore.getState();
  ui.requestTodoPage("todo");
  ui.requestTodoRows([id]);
}

/**
 * A memo card's words (main chat ticket 97, PRD ruling 142 point 5), as a
 * to-do card's title: the panel opens beside Galley's conversation the
 * same way (`showTodoRow`), on its 备忘 page, and the memo's row lights
 * up. Only a card whose memo the page lists has a button
 * (lib/memo.ts `memoCardState`, `listed`).
 */
export function showMemoRow(id: string, mainChatId: string): void {
  showPanelBesideGalley(mainChatId);
  const ui = useUiStore.getState();
  ui.requestTodoPage("memo");
  ui.requestTodoRows([id]);
}

/** The panel on screen beside Galley's conversation, where a card is:
 * opened if it is not (remembered open when wide, a look when narrow),
 * left as it is if it is. */
function showPanelBesideGalley(mainChatId: string): void {
  const ui = useUiStore.getState();
  const view = todoView(
    true,
    ui.todoPanelOpen,
    "main",
    { mainChat: true },
    {
      sessionId: mainChatId,
      narrow: ui.todoNarrow,
      glance: ui.todoGlance,
    },
  );
  if (view.shown) met();
  else openHere(view);
}

/** What `todoPanelIntroduces` decides on. */
export interface TodoIntroduction {
  /** The panel has been met (lib/todo-panel-memory.ts). */
  introduced: boolean;
  /** The cards that have just appeared under the main chat's replies,
   * gathered from the three reads (lib/fresh-cards.ts; the first read of
   * each says only what is there, and brings none). */
  fresh: readonly FreshCard[];
  /** The round they came with is one you sent, not one Core woke Galley
   * for (lib/subtasks.ts `inReportRound`, the typing dots' own rule in
   * lib/assistant-conversation.ts). */
  yourRound: boolean;
  /** Galley's conversation itself is in the main area
   * (`mainChatOnScreen`). */
  mainChatOnScreen: boolean;
  /** The main area is under 760px. */
  narrow: boolean;
}

/** The panel opening by itself: on which page, lighting which rows. */
export interface TodoIntroducing {
  page: TodoPanelPage;
  rows: string[];
}

/**
 * The one time the panel opens by itself (main chat ticket 87, PRD
 * ruling 131 point 4): cards have just appeared under the reply to a
 * round you sent, while you look at it — Galley's conversation on
 * screen, wide enough to have the panel beside it — and the panel has
 * never been met. Null: it does not open. Not in a round Core woke it
 * for. Narrow, it waits for the next one, and the flag is not written
 * either.
 *
 * Since ticket 101 (PRD ruling 147 point 4) any card the panel lists
 * counts, not only a to-do of yours: a new user's first thing noted is
 * as often 「明天 10 点提醒我……」, Galley's own reminder (ruling 92), or
 * something about them, a memo. Which cards count is
 * lib/fresh-cards.ts's (no subtask, nothing cancelled, no 「不再记」).
 * The page: 待办 when there is a to-do or a reminder among them, its
 * rows lit; 备忘 when there are only memos, theirs.
 */
export function todoPanelIntroduces(
  input: TodoIntroduction,
): TodoIntroducing | null {
  if (
    input.introduced ||
    !input.yourRound ||
    !input.mainChatOnScreen ||
    input.narrow
  ) {
    return null;
  }
  const page: TodoPanelPage = input.fresh.some((card) => card.kind !== "memo")
    ? "todo"
    : "memo";
  const rows = [
    ...new Set(
      input.fresh
        .filter((card) => (card.kind === "memo") === (page === "memo"))
        .map((card) => card.row),
    ),
  ];
  return rows.length > 0 ? { page, rows } : null;
}

/** Open the panel by itself, the once (`todoPanelIntroduces`): Galley's
 * place, remembered open, on its page (ticket 101), the rows lit, the
 * panel met. */
export function introduceTodoPanel(introducing: TodoIntroducing): void {
  const ui = useUiStore.getState();
  ui.setTodoPanelOpen("galley", true);
  met();
  ui.requestTodoPage(introducing.page);
  ui.requestTodoRows(introducing.rows);
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
