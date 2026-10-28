import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import type { MemoEventItem } from "@/lib/memo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";

import {
  FRESH_CARDS_GATHER_MS,
  freshCardsGatherer,
  freshMemoCards,
  freshReminderCards,
  freshTodoCards,
  type FreshBatch,
  type FreshCard,
} from "./fresh-cards";

/**
 * The cards that have just appeared under the main chat's replies (main
 * chat ticket 101, PRD ruling 147 point 4): a to-do of yours, Galley's
 * own reminder, a memo noted or changed — each from its own read, new
 * from that read's second on, none of a subtask, nothing cancelled before
 * its card came, no 「不再记」 — and one round's gathered before anything
 * is decided.
 */

const MAIN = "s-main";

function todo(id: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: MAIN, turnIndex: 7 },
    ...extra,
  };
}

function task(id: string, extra: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    prompt: "提醒用户喝水",
    repeat: { kind: "once" },
    timeOfDay: "15:00",
    enabled: true,
    fireAt: "2026-10-28T07:00:00Z",
    target: "assistant",
    origin: { via: "supervisor", supervisor: "galley-assistant" },
    createdIn: { sessionId: MAIN, turnIndex: 7 },
    createdAt: "2026-10-28T06:50:00Z",
    updatedAt: "2026-10-28T06:50:00Z",
    ...extra,
  };
}

function write(id: number, extra: Partial<MemoEventItem> = {}): MemoEventItem {
  return {
    id,
    memoId: `memo_${id}`,
    action: "add",
    text: "你不吃香菜",
    sessionId: MAIN,
    turnIndex: 7,
    memoExists: true,
    createdAt: "2026-10-28T06:50:00Z",
    ...extra,
  };
}

/** Not settled yet: no reply to hang under. */
const unsettled = { sessionId: MAIN };

describe("your to-do cards", () => {
  const old = todo("todo_old", {
    createdIn: { sessionId: MAIN, turnIndex: 3 },
  });

  it("are new once their reply settles, or noted and settled between two reads", () => {
    expect(
      freshTodoCards(
        [old, todo("todo_new", { createdIn: unsettled })],
        [old, todo("todo_new")],
        MAIN,
      ),
    ).toEqual([{ kind: "todo", row: "todo_new", card: "todo_new" }]);
    expect(freshTodoCards([old], [old, todo("todo_new")], MAIN)).toEqual([
      { kind: "todo", row: "todo_new", card: "todo_new" },
    ]);
  });

  it("are not new on the first read, already there, or not settled", () => {
    expect(freshTodoCards(null, [old, todo("todo_new")], MAIN)).toEqual([]);
    expect(freshTodoCards([old], [old], MAIN)).toEqual([]);
    expect(
      freshTodoCards(
        [old],
        [old, todo("todo_new", { createdIn: unsettled })],
        MAIN,
      ),
    ).toEqual([]);
  });

  it("count only your to-dos in this main chat, not one cancelled before its card", () => {
    const one = (extra: Partial<TodoItem>) =>
      freshTodoCards([old], [old, todo("todo_new", extra)], MAIN);
    expect(one({ kind: "subtask" })).toEqual([]);
    expect(one({ kind: "task" })).toEqual([]);
    expect(one({ createdIn: { sessionId: "s-other", turnIndex: 7 } })).toEqual(
      [],
    );
    expect(one({ cancelledAt: "2026-10-28T06:55:00Z" })).toEqual([]);
    expect(freshTodoCards([old], [old, todo("todo_new")], undefined)).toEqual(
      [],
    );
  });

  it("do not count a card changing: ticked, cancelled", () => {
    const card = todo("todo_a");
    expect(freshTodoCards([card], [{ ...card, state: "done" }], MAIN)).toEqual(
      [],
    );
    expect(
      freshTodoCards(
        [card],
        [{ ...card, cancelledAt: "2026-10-28T06:55:00Z" }],
        MAIN,
      ),
    ).toEqual([]);
  });
});

describe("Galley's own reminder cards", () => {
  const old = task("sched_old", {
    createdIn: { sessionId: MAIN, turnIndex: 3 },
  });

  it("are new once their reply settles, one-off or repeating", () => {
    expect(
      freshReminderCards(
        [old, task("sched_new", { createdIn: unsettled })],
        [old, task("sched_new")],
        MAIN,
      ),
    ).toEqual([{ kind: "reminder", row: "sched_new", card: "sched_new" }]);
    expect(
      freshReminderCards(
        [old],
        [old, task("sched_daily", { repeat: { kind: "daily" } })],
        MAIN,
      ),
    ).toEqual([{ kind: "reminder", row: "sched_daily", card: "sched_daily" }]);
  });

  it("are not new on the first read, already there, or not settled", () => {
    expect(freshReminderCards(null, [old, task("sched_new")], MAIN)).toEqual(
      [],
    );
    expect(freshReminderCards([old], [old], MAIN)).toEqual([]);
    expect(
      freshReminderCards(
        [old],
        [old, task("sched_new", { createdIn: unsettled })],
        MAIN,
      ),
    ).toEqual([]);
  });

  it("do not count one cancelled before its card came, nor a to-do's, nor another session's", () => {
    const one = (extra: Partial<ScheduledTask>) =>
      freshReminderCards([old], [old, task("sched_new", extra)], MAIN);
    expect(one({ cancelledAt: "2026-10-28T06:55:00Z" })).toEqual([]);
    expect(one({ todoId: "todo_a" })).toEqual([]);
    expect(one({ createdIn: { sessionId: "s-other", turnIndex: 7 } })).toEqual(
      [],
    );
    expect(one({ createdIn: undefined })).toEqual([]);
    expect(
      freshReminderCards([old], [old, task("sched_new")], undefined),
    ).toEqual([]);
  });

  it("do not count a card changing: fired, cancelled", () => {
    expect(
      freshReminderCards(
        [old],
        [{ ...old, lastFiredAt: "2026-10-28T07:00:00Z" }],
        MAIN,
      ),
    ).toEqual([]);
    expect(
      freshReminderCards(
        [old],
        [{ ...old, cancelledAt: "2026-10-28T06:55:00Z" }],
        MAIN,
      ),
    ).toEqual([]);
  });
});

describe("memo cards", () => {
  const old = write(1, { turnIndex: 3 });

  it("are new for 记下了 and 改为, by the write: the memo's row, the write's card", () => {
    expect(
      freshMemoCards(
        [old, write(2, { turnIndex: undefined })],
        [old, write(2), write(3, { action: "update", memoId: "memo_1" })],
        MAIN,
      ),
    ).toEqual([
      { kind: "memo", row: "memo_2", card: "2" },
      { kind: "memo", row: "memo_1", card: "3" },
    ]);
  });

  it("do not count 不再记, nor a write whose memo is already gone", () => {
    expect(
      freshMemoCards([old], [old, write(2, { action: "delete" })], MAIN),
    ).toEqual([]);
    expect(
      freshMemoCards([old], [old, write(2, { memoExists: false })], MAIN),
    ).toEqual([]);
  });

  it("are not new on the first read, already there, not settled or elsewhere", () => {
    expect(freshMemoCards(null, [old, write(2)], MAIN)).toEqual([]);
    expect(freshMemoCards([old], [old], MAIN)).toEqual([]);
    expect(
      freshMemoCards([old], [old, write(2, { turnIndex: undefined })], MAIN),
    ).toEqual([]);
    expect(
      freshMemoCards([old], [old, write(2, { sessionId: "s-other" })], MAIN),
    ).toEqual([]);
    expect(freshMemoCards([old], [old, write(2)], undefined)).toEqual([]);
  });

  it("do not count a card changing: its memo deleted since", () => {
    expect(
      freshMemoCards([old], [{ ...old, memoExists: false }], MAIN),
    ).toEqual([]);
  });
});

describe("gathering one round's cards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const T: FreshCard = { kind: "todo", row: "todo_a", card: "todo_a" };
  const R: FreshCard = { kind: "reminder", row: "sched_a", card: "sched_a" };
  const M: FreshCard = { kind: "memo", row: "memo_1", card: "11" };

  it("waits from the first new card, then hands over everything that came, in the cards' order", () => {
    vi.useFakeTimers();
    const got: FreshBatch[] = [];
    const gatherer = freshCardsGatherer((batch) => got.push(batch));
    gatherer.add([], false);
    vi.advanceTimersByTime(FRESH_CARDS_GATHER_MS * 2);
    expect(got).toEqual([]);
    gatherer.add([M], true);
    vi.advanceTimersByTime(150);
    gatherer.add([T], false);
    gatherer.add([R, T], false);
    vi.advanceTimersByTime(FRESH_CARDS_GATHER_MS - 151);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    // The round as read with the first card; each card once.
    expect(got).toEqual([{ cards: [T, R, M], yourRound: true }]);
    // The next card starts a new wait.
    gatherer.add([R], false);
    vi.advanceTimersByTime(FRESH_CARDS_GATHER_MS);
    expect(got[1]).toEqual({ cards: [R], yourRound: false });
  });

  it("drops what it gathered when disposed", () => {
    vi.useFakeTimers();
    const onGathered = vi.fn();
    const gatherer = freshCardsGatherer(onGathered);
    gatherer.add([T], true);
    gatherer.dispose();
    vi.advanceTimersByTime(FRESH_CARDS_GATHER_MS * 2);
    expect(onGathered).not.toHaveBeenCalled();
  });
});
