import type { TodoItem } from "@/lib/assistant-todo";
import type { MemoEventItem } from "@/lib/memo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { todoCancelled } from "@/lib/todo-panel";

/**
 * The cards that have just appeared under the main chat's replies (main
 * chat ticket 101, PRD ruling 147 point 4): a to-do of yours, one of
 * Galley's own reminders, a memo noted or changed. What the panel's one
 * opening by itself (lib/todo-open.ts `todoPanelIntroduces`) decides on.
 *
 * Each kind comes from its own read: the noted to-dos
 * (stores/assistant-todo.ts `noted`), the scheduled tasks
 * (hooks/useReminderCards.ts, read while the main chat is mounted) and
 * the memo writes (stores/memo.ts `events`). A card appears when its
 * reply settles — Core fills `turnIndex` at the run's end for all three
 * — so a card new to a read is one the round now settling made. The
 * reads land apart (`FRESH_CARDS_GATHER_MS`), so what one round made is
 * gathered before anything is decided (`freshCardsGatherer`).
 *
 * Every kind counts from its own second read: the first says only what
 * is already there (null `previous`). Subtask cards never count: their
 * card leads to the subtask, not the panel.
 */

export type FreshCardKind = "todo" | "reminder" | "memo";

/** A card that has just appeared under a reply. */
export interface FreshCard {
  kind: FreshCardKind;
  /** The panel row it stands for: the to-do's id, the task's (a
   * `kind: "task"` item of the 待办 page), the memo's (the 备忘 page). */
  row: string;
  /** The card itself: the same id, but a memo write's event id — one
   * memo can have a card under several replies. */
  card: string;
}

/** The cards' order under a reply, which is the panel's page order:
 * 待办's (to-dos, then reminders), then 备忘's. */
const KIND_ORDER: Readonly<Record<FreshCardKind, number>> = {
  todo: 0,
  reminder: 1,
  memo: 2,
};

/** Cards in `next` that `previous` did not have, by `cardOf`, among
 * those `counts`. Null `previous` (the first read): none. */
function fresh<T>(
  previous: readonly T[] | null,
  next: readonly T[],
  hasCard: (item: T) => boolean,
  counts: (item: T) => boolean,
  cardOf: (item: T) => FreshCard,
): FreshCard[] {
  if (previous === null) return [];
  const before = new Set(
    previous.filter(hasCard).map((item) => cardOf(item).card),
  );
  return next
    .filter((item) => hasCard(item) && counts(item))
    .map(cardOf)
    .filter((card) => !before.has(card.card));
}

/**
 * Your to-dos whose cards have just appeared (ticket 87, kept): noted in
 * this main chat, the reply settled, not cancelled before the card came
 * (it would read 已删除, with no row to light).
 */
export function freshTodoCards(
  previous: readonly TodoItem[] | null,
  next: readonly TodoItem[],
  mainChatId: string | undefined,
): FreshCard[] {
  if (!mainChatId) return [];
  return fresh(
    previous,
    next,
    (item) =>
      item.createdIn?.sessionId === mainChatId &&
      item.createdIn.turnIndex != null,
    (item) => item.kind === "todo" && !todoCancelled(item),
    (item) => ({ kind: "todo", row: item.id, card: item.id }),
  );
}

/**
 * Galley's own reminders whose cards have just appeared (ticket 101):
 * the reminder card's kind — made in this main chat's settled reply, on
 * no to-do (a to-do's reminder is its card's) — one-off or repeating;
 * not one cancelled before its card came.
 */
export function freshReminderCards(
  previous: readonly ScheduledTask[] | null,
  next: readonly ScheduledTask[],
  mainChatId: string | undefined,
): FreshCard[] {
  if (!mainChatId) return [];
  return fresh(
    previous,
    next,
    (task) =>
      task.createdIn?.sessionId === mainChatId &&
      task.createdIn.turnIndex != null,
    (task) => !task.todoId && !task.cancelledAt,
    (task) => ({ kind: "reminder", row: task.id, card: task.id }),
  );
}

/**
 * Memo writes whose cards have just appeared (ticket 101): 「记下了」 and
 * 「改为」 in this main chat's settled reply. Not 「不再记」 — the page has
 * no row of it to light — nor a write whose memo is already gone.
 */
export function freshMemoCards(
  previous: readonly MemoEventItem[] | null,
  next: readonly MemoEventItem[],
  mainChatId: string | undefined,
): FreshCard[] {
  if (!mainChatId) return [];
  return fresh(
    previous,
    next,
    (event) => event.sessionId === mainChatId && event.turnIndex != null,
    (event) => event.action !== "delete" && event.memoExists,
    (event) => ({ kind: "memo", row: event.memoId, card: String(event.id) }),
  );
}

/**
 * How long after the first new card the others are waited for before
 * anything is decided. At a run's end Core settles the tasks, the to-dos
 * and the memos one after another and sends an event for each
 * (core/src/message_queue.rs); the reminder cards read at once, the
 * to-dos and the memos 150ms after their event (their sync hooks'
 * debounce), then each read takes its round trip. 400ms covers that
 * debounce and two reads with room, so a round that noted a to-do and a
 * memo is decided on both; short enough that the panel opening, or a
 * card flying, still reads as the card's own arrival.
 */
export const FRESH_CARDS_GATHER_MS = 400;

/** What one round made, gathered. */
export interface FreshBatch {
  /** In the cards' order under a reply (to-dos, reminders, memos), each
   * kind in the order it was read. */
  cards: FreshCard[];
  /** The round they came with is one you sent (not one Core woke Galley
   * for), as read when the first of them came: the round settling then. */
  yourRound: boolean;
}

export interface FreshCardsGatherer {
  /** A read's new cards (none: nothing), and whether the round settling
   * now is yours. The first starts the wait. */
  add: (cards: readonly FreshCard[], yourRound: boolean) => void;
  /** Drop what is gathered and the wait. */
  dispose: () => void;
}

/**
 * Gather new cards from the three reads: the first starts a wait of
 * `wait` ms, everything that comes in it joins, and at its end
 * `onGathered` gets them together. Conditions that can change meanwhile
 * (the screen, the width, the panel met) are for `onGathered` to read
 * then.
 */
export function freshCardsGatherer(
  onGathered: (batch: FreshBatch) => void,
  wait: number = FRESH_CARDS_GATHER_MS,
): FreshCardsGatherer {
  let pending: FreshBatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    add: (cards, yourRound) => {
      if (cards.length === 0) return;
      if (pending) {
        const seen = new Set(
          pending.cards.map((card) => `${card.kind}:${card.card}`),
        );
        pending.cards.push(
          ...cards.filter((card) => !seen.has(`${card.kind}:${card.card}`)),
        );
        return;
      }
      pending = { cards: [...cards], yourRound };
      timer = setTimeout(() => {
        const batch = pending!;
        pending = null;
        timer = null;
        batch.cards = batch.cards
          .map((card, index) => ({ card, index }))
          .sort(
            (a, b) =>
              KIND_ORDER[a.card.kind] - KIND_ORDER[b.card.kind] ||
              a.index - b.index,
          )
          .map(({ card }) => card);
        onGathered(batch);
      }, wait);
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
