import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import {
  assistantRowLine,
  doneRowLine,
  nextTodoRefreshMs,
  routineRowLine,
  TODO_SETTLE_MS,
  todoChecked,
  todoMetaParts,
  todoOverdueDays,
  todoPanelEmpty,
  todoReminderCancellable,
  todosByMessage,
  todoTitleTarget,
} from "@/lib/todo-panel";

/**
 * The to-do panel's and the to-do cards' pure half (main chat ticket
 * 42): what a row's second line says (today, overdue, crossing
 * midnight), where a title leads, which reply a card hangs under, when
 * the list is read again.
 */

// Local wall-clock parts, so the day words hold in whatever zone the
// suite runs in (the machine's, and UTC).
function local(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}
// Friday 2026-10-16.
const TODAY = new Date(2026, 9, 16).getTime();
const TOMORROW = new Date(2026, 9, 17).getTime();
const zh = zhCopy;
const en = enCopy;

function todo(extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id: "todo_1",
    text: "交季度报告",
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}

function task(extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "task",
    id: "sched_1",
    text: "看看快递到了没有",
    state: "scheduled",
    at: local(2026, 10, 17, 9, 0),
    createdBy: "assistant",
    target: "assistant",
    repeat: { kind: "once" },
    timeOfDay: "09:00",
    createdIn: { sessionId: "s-main", turnIndex: 2 },
    ...extra,
  };
}

const texts = (parts: { text: string }[]) => parts.map((p) => p.text);

describe("a to-do's second line", () => {
  it("says when it is due: a day, or a day and a time", () => {
    const friday = todo({ due: { date: "2026-10-23", hasTime: false } });
    expect(texts(todoMetaParts(friday, false, TODAY, "zh-CN", zh))).toEqual([
      "截止 10月23日",
    ]);
    const wednesday = todo({
      due: {
        date: "2026-10-21",
        hasTime: true,
        at: local(2026, 10, 21, 15, 0),
        time: "15:00",
      },
    });
    expect(texts(todoMetaParts(wednesday, false, TODAY, "zh-CN", zh))).toEqual([
      "截止 周三 15:00",
    ]);
    expect(
      texts(todoMetaParts(wednesday, false, TODAY, "en-US", en)).map((t) =>
        t.replace(/\s/g, " "),
      ),
    ).toEqual(["Due Wed 3:00 PM"]);
    const today = todo({ due: { date: "2026-10-16", hasTime: false } });
    expect(texts(todoMetaParts(today, false, TODAY, "zh-CN", zh))).toEqual([
      "截止 今天",
    ]);
    // No due date, no reminder: nothing (随时).
    expect(todoMetaParts(todo(), false, TODAY, "zh-CN", zh)).toEqual([]);
  });

  it("says how many days overdue, in warning", () => {
    const late = todo({
      due: { date: "2026-10-14", hasTime: false },
      overdue: true,
    });
    expect(todoMetaParts(late, false, TODAY, "zh-CN", zh)).toEqual([
      { text: "逾期 2 天", tone: "warning" },
    ]);
    expect(texts(todoMetaParts(late, false, TODAY, "en-US", en))).toEqual([
      "2 days overdue",
    ]);
    // Due earlier today at a time that has passed (Core's mark).
    const thisMorning = todo({
      due: {
        date: "2026-10-16",
        hasTime: true,
        at: local(2026, 10, 16, 10, 0),
        time: "10:00",
      },
      overdue: true,
    });
    expect(todoMetaParts(thisMorning, false, TODAY, "zh-CN", zh)).toEqual([
      { text: "逾期 · 今天 10:00", tone: "warning" },
    ]);
    expect(todoOverdueDays(thisMorning, TODAY)).toBe(0);
  });

  it("turns overdue at midnight before the list is read again", () => {
    // Read on Friday: due Friday, not overdue (Core's mark absent).
    const friday = todo({ due: { date: "2026-10-16", hasTime: false } });
    expect(todoOverdueDays(friday, TODAY)).toBeNull();
    // Past midnight, the same item is a day late.
    expect(todoOverdueDays(friday, TOMORROW)).toBe(1);
    expect(todoMetaParts(friday, false, TOMORROW, "zh-CN", zh)).toEqual([
      { text: "逾期 1 天", tone: "warning" },
    ]);
    // A timed one due late on Friday likewise.
    const lateFriday = todo({
      due: {
        date: "2026-10-16",
        hasTime: true,
        at: local(2026, 10, 16, 23, 30),
        time: "23:30",
      },
    });
    expect(todoOverdueDays(lateFriday, TODAY)).toBeNull();
    expect(todoOverdueDays(lateFriday, TOMORROW)).toBe(1);
  });

  it("says its reminder, which a tick takes away", () => {
    const reminded = todo({
      due: { date: "2026-10-23", hasTime: false },
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 9, 0),
        state: "scheduled",
      },
    });
    expect(texts(todoMetaParts(reminded, false, TODAY, "zh-CN", zh))).toEqual([
      "截止 10月23日",
      "提醒 明天 09:00",
    ]);
    expect(todoReminderCancellable(reminded)).toBe(true);
    // Checked (a tick on its way, or done): the reminder goes, the due
    // date stays and is never overdue.
    expect(texts(todoMetaParts(reminded, true, TODAY, "zh-CN", zh))).toEqual([
      "截止 10月23日",
    ]);
    const fired = todo({
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 16, 9, 0),
        state: "fired",
      },
    });
    expect(texts(todoMetaParts(fired, false, TODAY, "zh-CN", zh))).toEqual([
      "已提醒 今天 09:00",
    ]);
    expect(todoReminderCancellable(fired)).toBe(false);
    const paused = todo({
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 9, 0),
        state: "paused",
      },
    });
    expect(texts(todoMetaParts(paused, false, TODAY, "zh-CN", zh))).toEqual([
      "提醒 明天 09:00 · 已暂停",
    ]);
    expect(todoReminderCancellable(paused)).toBe(true);
    expect(todoReminderCancellable({ ...paused, state: "done" })).toBe(false);
  });

  it("shows checked what Core says, or the tick on its way", () => {
    expect(todoChecked(todo())).toBe(false);
    expect(todoChecked(todo({ state: "done" }))).toBe(true);
    expect(todoChecked(todo(), { done: true, phase: "settling" })).toBe(true);
    expect(
      todoChecked(todo({ state: "done" }), { done: false, phase: "saving" }),
    ).toBe(false);
    // The hold: a moment to see the tick land and take it back, well
    // past any motion token.
    expect(TODO_SETTLE_MS).toBe(1500);
  });
});

describe("Galley's rows, routines and done items", () => {
  it("says where a subtask stands, in its tone", () => {
    const sub = (state: TodoItem["state"]) =>
      assistantRowLine(
        task({ kind: "subtask", id: "s-sub", state, at: undefined }),
        TODAY,
        "zh-CN",
        zh,
      );
    expect(sub("running")).toEqual({ text: "正在工作", tone: "brand" });
    expect(sub("asking")).toEqual({ text: "等你回复", tone: "warning" });
    expect(sub("failed")).toEqual({ text: "出错", tone: "error" });
    expect(sub("stopped")).toEqual({ text: "没有跑完", tone: "muted" });
  });

  it("gives a one-off its time and state", () => {
    expect(assistantRowLine(task(), TODAY, "zh-CN", zh)).toEqual({
      text: "明天 09:00 · 待提醒",
      tone: "muted",
    });
    expect(
      assistantRowLine(task({ target: "session" }), TODAY, "zh-CN", zh).text,
    ).toBe("明天 09:00 · 待运行");
  });

  it("gives a routine its rule and next time, or 已暂停", () => {
    const daily = task({
      id: "sched_daily",
      repeat: { kind: "daily" },
      timeOfDay: "08:00",
      at: local(2026, 10, 17, 8, 0),
    });
    expect(routineRowLine(daily, TODAY, "zh-CN", zh)).toBe(
      "每天 08:00 · 下次 明天 08:00",
    );
    expect(
      routineRowLine(
        { ...daily, state: "paused", at: undefined },
        TODAY,
        "zh-CN",
        zh,
      ),
    ).toBe("每天 08:00 · 已暂停");
  });

  it("dates what was done; what was not a to-do says its state too", () => {
    const ticked = todo({ state: "done", at: local(2026, 10, 16, 15, 2) });
    expect(doneRowLine(ticked, TODAY, "zh-CN", zh)).toBe("今天 15:02");
    const fired = task({ state: "fired", at: local(2026, 10, 15, 9, 0) });
    expect(doneRowLine(fired, TODAY, "zh-CN", zh)).toBe("昨天 09:00 · 已提醒");
  });
});

describe("where a title leads", () => {
  it("jumps to the reply in this main chat that noted it", () => {
    expect(todoTitleTarget(todo(), "s-main")).toEqual({
      kind: "reply",
      sessionId: "s-main",
      messageId: "msg_s-main_4_assistant",
    });
  });

  it("opens a subtask or a run's session", () => {
    expect(
      todoTitleTarget(
        task({ kind: "subtask", id: "s-sub", createdIn: undefined }),
        "s-main",
      ),
    ).toEqual({ kind: "subtask", sessionId: "s-sub" });
    expect(
      todoTitleTarget(
        task({
          state: "fired",
          createdIn: undefined,
          runSessionId: "s-run",
          target: "session",
        }),
        "s-main",
      ),
    ).toEqual({ kind: "session", sessionId: "s-run" });
  });

  it("goes nowhere without a place: unsettled, another main chat, another agent's", () => {
    expect(
      todoTitleTarget(todo({ createdIn: { sessionId: "s-main" } }), "s-main"),
    ).toBeNull();
    expect(todoTitleTarget(todo(), "s-other-main")).toBeNull();
    expect(
      todoTitleTarget(
        todo({ createdBy: "agent", createdIn: undefined }),
        "s-main",
      ),
    ).toBeNull();
  });
});

describe("cards under replies", () => {
  it("hang the to-dos under the reply that noted them, soonest due first", () => {
    const anytime = todo({ id: "todo_any" });
    const friday = todo({
      id: "todo_fri",
      due: { date: "2026-10-23", hasTime: false },
    });
    const wednesday = todo({
      id: "todo_wed",
      due: {
        date: "2026-10-21",
        hasTime: true,
        at: local(2026, 10, 21, 15, 0),
        time: "15:00",
      },
    });
    const done = todo({
      id: "todo_done",
      state: "done",
      createdIn: { sessionId: "s-main", turnIndex: 9 },
    });
    const elsewhere = todo({
      id: "todo_else",
      createdIn: { sessionId: "s-old", turnIndex: 4 },
    });
    const unsettled = todo({
      id: "todo_wait",
      createdIn: { sessionId: "s-main" },
    });
    const byMessage = todosByMessage(
      {
        ...EMPTY_TODO,
        yours: {
          today: [],
          later: [friday, wednesday, unsettled],
          anytime: [anytime, elsewhere],
        },
        // Done ones keep their card; Galley's own tasks have none here.
        done: [done, task({ state: "fired" })],
      },
      "s-main",
    );
    expect([...byMessage.keys()].sort()).toEqual([
      "msg_s-main_4_assistant",
      "msg_s-main_9_assistant",
    ]);
    expect(byMessage.get("msg_s-main_4_assistant")!.map((i) => i.id)).toEqual([
      "todo_wed",
      "todo_fri",
      "todo_any",
    ]);
    expect(byMessage.get("msg_s-main_9_assistant")!.map((i) => i.id)).toEqual([
      "todo_done",
    ]);
    expect(todosByMessage(EMPTY_TODO, undefined).size).toBe(0);
  });
});

describe("the list", () => {
  it("is empty only with nothing in any group", () => {
    expect(todoPanelEmpty(EMPTY_TODO)).toBe(true);
    expect(todoPanelEmpty({ ...EMPTY_TODO, done: [task()] })).toBe(false);
    expect(
      todoPanelEmpty({
        ...EMPTY_TODO,
        yours: { today: [], later: [], anytime: [todo()] },
      }),
    ).toBe(false);
  });

  it("is read again when the soonest timed to-do falls due", () => {
    const now = new Date(2026, 9, 16, 12, 0).getTime();
    const at = (h: number) => ({
      date: "2026-10-16",
      hasTime: true,
      at: local(2026, 10, 16, h, 0),
      time: `${h}:00`,
    });
    const list = {
      ...EMPTY_TODO,
      yours: {
        today: [
          todo({ id: "a", due: at(10), overdue: true }),
          todo({ id: "b", due: at(15) }),
        ],
        later: [
          todo({
            id: "c",
            due: {
              date: "2026-10-17",
              hasTime: true,
              at: local(2026, 10, 17, 9, 0),
            },
          }),
          todo({ id: "d", due: { date: "2026-10-18", hasTime: false } }),
        ],
        anytime: [],
      },
    };
    expect(nextTodoRefreshMs(list, now)).toBe(
      new Date(2026, 9, 16, 15, 0).getTime(),
    );
    expect(nextTodoRefreshMs(EMPTY_TODO, now)).toBeNull();
  });
});
