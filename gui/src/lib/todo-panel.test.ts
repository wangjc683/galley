import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import {
  assistantRowLine,
  assistantTaskCancellable,
  doneRowLine,
  nextTodoRefreshMs,
  readingPanelClosesTodo,
  routineRowLine,
  TODO_PANEL_ID,
  TODO_PANEL_WIDTH,
  TODO_SETTLE_MS,
  todoCancelled,
  todoChecked,
  todoMetaParts,
  todoNotesLine,
  todoOverdueDays,
  todoPanelEmpty,
  todoPanelOpened,
  todoReminderCancellable,
  todoRowText,
  todosByMessage,
  todoTitleTarget,
} from "@/lib/todo-panel";

/**
 * The to-do panel's and the to-do cards' pure half (main chat tickets
 * 42 and 43): what a row's second line says (today, overdue, crossing
 * midnight, the day it was noted), where a title leads, which reply a
 * card hangs under and in what order, when the list is read again.
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

describe("a to-do's second line (ruling 97)", () => {
  const line = (
    item: TodoItem,
    options: { checked?: boolean; today?: number } = {},
    language: "zh-CN" | "en-US" = "zh-CN",
  ) =>
    todoMetaParts(
      item,
      options.checked ?? false,
      options.today ?? TODAY,
      language,
      language === "zh-CN" ? zh : en,
    ).map((p) => (p.bell ? `🔔${p.text}` : p.text));

  it("says when it is due, with no word before it", () => {
    const friday = todo({ due: { date: "2026-10-23", hasTime: false } });
    expect(line(friday)).toEqual(["10月23日"]);
    const wednesday = todo({
      due: {
        date: "2026-10-21",
        hasTime: true,
        at: local(2026, 10, 21, 15, 0),
        time: "15:00",
      },
    });
    expect(line(wednesday)).toEqual(["周三 15:00"]);
    expect(
      line(wednesday, {}, "en-US").map((t) => t.replace(/\s/g, " ")),
    ).toEqual(["Wed 3:00 PM"]);
    // No due date, no reminder: nothing (随时).
    expect(todoMetaParts(todo(), false, TODAY, "zh-CN", zh)).toEqual([]);
  });

  it("says 今天 for today: no group label says it for the row (ticket 86)", () => {
    const tonight = todo({
      due: {
        date: "2026-10-16",
        hasTime: true,
        at: local(2026, 10, 16, 18, 0),
        time: "18:00",
      },
    });
    expect(line(tonight)).toEqual(["今天 18:00"]);
    // A day without a time, today: the day word alone.
    const today = todo({ due: { date: "2026-10-16", hasTime: false } });
    expect(line(today)).toEqual(["今天"]);
    expect(line(today, {}, "en-US")).toEqual(["Today"]);
  });

  it("says how many days overdue, in warning", () => {
    const late = todo({
      due: { date: "2026-10-14", hasTime: false },
      overdue: true,
    });
    expect(todoMetaParts(late, false, TODAY, "zh-CN", zh)).toEqual([
      { text: "逾期 2 天", tone: "warning" },
    ]);
    expect(line(late, {}, "en-US")).toEqual(["2 days overdue"]);
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

  it("draws the reminder as a bell: the clock on the due day, the day too on another", () => {
    const haircut = todo({
      due: { date: "2026-10-17", hasTime: false },
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 10, 0),
        state: "scheduled",
      },
    });
    expect(todoMetaParts(haircut, false, TODAY, "zh-CN", zh)).toEqual([
      { text: "明天", tone: "muted" },
      {
        text: "10:00",
        tone: "muted",
        bell: true,
        title: "提醒 明天 10:00",
      },
    ]);
    const report = todo({
      due: {
        date: "2026-10-21",
        hasTime: true,
        at: local(2026, 10, 21, 15, 0),
        time: "15:00",
      },
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 21, 14, 0),
        state: "scheduled",
      },
    });
    expect(line(report)).toEqual(["周三 15:00", "🔔14:00"]);
    expect(line(report, {}, "en-US").map((t) => t.replace(/\s/g, " "))).toEqual(
      ["Wed 3:00 PM", "🔔2:00 PM"],
    );
    // The evening before: its day too.
    const early = todo({
      ...report,
      reminder: { ...report.reminder!, at: local(2026, 10, 20, 20, 0) },
    });
    expect(line(early)).toEqual(["周三 15:00", "🔔周二 20:00"]);
    // A reminder and no due date.
    expect(line(todo({ reminder: haircut.reminder }))).toEqual([
      "🔔明天 10:00",
    ]);
    // Due today, reminded today: the clock alone after 「今天」.
    const today = todo({
      due: { date: "2026-10-16", hasTime: false },
      reminder: { ...haircut.reminder!, at: local(2026, 10, 16, 20, 0) },
    });
    expect(line(today)).toEqual(["今天", "🔔20:00"]);
    expect(todoReminderCancellable(haircut)).toBe(true);
    // Checked (a tick on its way, or done): the reminder goes, the due
    // date stays and is never overdue.
    expect(line(haircut, { checked: true })).toEqual(["明天"]);
  });

  it("leaves out a reminder that has gone off, and says one is paused", () => {
    const fired = todo({
      due: { date: "2026-10-16", hasTime: false },
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 16, 9, 0),
        state: "fired",
      },
    });
    expect(line(fired)).toEqual(["今天"]);
    expect(todoReminderCancellable(fired)).toBe(false);
    const paused = todo({
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 9, 0),
        state: "paused",
      },
    });
    expect(todoMetaParts(paused, false, TODAY, "zh-CN", zh)).toEqual([
      {
        text: "明天 09:00 · 已暂停",
        tone: "muted",
        bell: true,
        title: "提醒 明天 09:00 · 已暂停",
      },
    ]);
    expect(todoReminderCancellable(paused)).toBe(true);
    expect(todoReminderCancellable({ ...paused, state: "done" })).toBe(false);
  });

  it("does not write the day it was noted", () => {
    const noted = todo({ createdAt: local(2026, 10, 14, 10, 0) });
    expect(line(noted)).toEqual([]);
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

  it("never shows a cancelled one checked, however it stood (ticket 43)", () => {
    const cancelled = todo({ cancelledAt: local(2026, 10, 15, 9, 0) });
    expect(todoCancelled(cancelled)).toBe(true);
    expect(todoCancelled(todo())).toBe(false);
    expect(todoChecked(cancelled)).toBe(false);
    expect(todoChecked({ ...cancelled, state: "done" })).toBe(false);
    expect(todoChecked(cancelled, { done: true, phase: "settling" })).toBe(
      false,
    );
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

  it("lets Galley's own one-off reminders be cancelled while they can still go off (ticket 80)", () => {
    expect(assistantTaskCancellable(task())).toBe(true);
    expect(assistantTaskCancellable(task({ state: "paused" }))).toBe(true);
    // One that starts a session is the reminder card's 「取消」 too.
    expect(assistantTaskCancellable(task({ target: "session" }))).toBe(true);
    // Gone off: not in 「Galley 在办」, and nothing to cancel.
    expect(assistantTaskCancellable(task({ state: "fired" }))).toBe(false);
    // Not a subtask, not a routine, not a to-do.
    expect(
      assistantTaskCancellable(
        task({ kind: "subtask", id: "s-sub", state: "running" }),
      ),
    ).toBe(false);
    expect(
      assistantTaskCancellable(
        task({ repeat: { kind: "daily" }, timeOfDay: "08:00" }),
      ),
    ).toBe(false);
    expect(assistantTaskCancellable(todo())).toBe(false);
  });
});

describe("a to-do's notes (ticket 80)", () => {
  it("are one line: trimmed, breaks and runs of space one space; in full for the hover", () => {
    expect(
      todoNotesLine(
        todo({ notes: "  王老师\n电话 138 0000 0000\n\n  A 座   3 楼 " }),
      ),
    ).toEqual({
      text: "王老师 电话 138 0000 0000 A 座 3 楼",
      full: "王老师\n电话 138 0000 0000\n\n  A 座   3 楼",
    });
  });

  it("are not drawn when there are none, only blanks, or the to-do is done", () => {
    expect(todoNotesLine(todo())).toBeNull();
    expect(todoNotesLine(todo({ notes: "" }))).toBeNull();
    expect(todoNotesLine(todo({ notes: " \n\t " }))).toBeNull();
    expect(
      todoNotesLine(todo({ state: "done", notes: "A 座 3 楼" })),
    ).toBeNull();
    // Overdue ones keep theirs.
    expect(
      todoNotesLine(todo({ overdue: true, notes: "A 座 3 楼" }))?.text,
    ).toBe("A 座 3 楼");
  });
});

describe("the daily review's name (ticket 74)", () => {
  // The routine Core seeds (ticket 73): its maker's label comes in
  // `agent` (core/src/assistant_todo.rs `creator`), its prompt is English
  // for the model.
  const review = task({
    id: "sched_review",
    text: "Daily review: read wake.md and go over what is in hand.",
    createdBy: "agent",
    agent: "galley-review",
    repeat: { kind: "daily" },
    timeOfDay: "09:00",
    at: local(2026, 10, 17, 9, 0),
    createdIn: undefined,
  });

  it("shows a name of its own, never its prompt, and no time in it", () => {
    expect(todoRowText(review, zh)).toBe("过一遍在办的事");
    expect(todoRowText(review, en)).toBe("Go over what’s in hand");
  });

  it("says the time once, on the second line, following the task's own time", () => {
    const moved = {
      ...review,
      timeOfDay: "07:30",
      at: local(2026, 10, 17, 7, 30),
    };
    expect(todoRowText(moved, zh)).toBe("过一遍在办的事");
    expect(routineRowLine(moved, TODAY, "zh-CN", zh)).toBe(
      "每天 07:30 · 下次 明天 07:30",
    );
    const paused = { ...review, state: "paused" as const, at: undefined };
    expect(todoRowText(paused, zh)).toBe("过一遍在办的事");
    expect(routineRowLine(paused, TODAY, "zh-CN", zh)).toBe(
      "每天 09:00 · 已暂停",
    );
  });

  it("leaves every other row's words as they are", () => {
    expect(todoRowText(task(), zh)).toBe("看看快递到了没有");
    // Another agent's routine, by its own label.
    expect(
      todoRowText(task({ createdBy: "agent", agent: "claude-code" }), zh),
    ).toBe("看看快递到了没有");
    // The label on something that is not a task is not the review.
    expect(todoRowText(todo({ agent: "galley-review" }), zh)).toBe(
      "交季度报告",
    );
    expect(
      todoRowText(
        {
          kind: "subtask",
          id: "s-1",
          text: "",
          state: "running",
          createdBy: "assistant",
        },
        zh,
      ),
    ).toBe(zh.subtask.label);
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
  it("hang every to-do noted under the reply that noted it, in the order noted (ticket 43)", () => {
    // Noted first, due last; noted last, due first: the order noted wins.
    const friday = todo({
      id: "todo_fri",
      createdAt: "2026-10-16T01:00:00+00:00",
      due: { date: "2026-10-23", hasTime: false },
    });
    const anytime = todo({
      id: "todo_any",
      createdAt: "2026-10-16T01:00:02+00:00",
    });
    const wednesday = todo({
      id: "todo_wed",
      createdAt: "2026-10-16T01:00:05+00:00",
      due: {
        date: "2026-10-21",
        hasTime: true,
        at: local(2026, 10, 21, 15, 0),
        time: "15:00",
      },
    });
    // Ticked off a month ago, or cancelled: the card stays.
    const longDone = todo({
      id: "todo_done",
      state: "done",
      at: local(2026, 9, 16, 9, 0),
      createdAt: "2026-09-15T01:00:00+00:00",
      createdIn: { sessionId: "s-main", turnIndex: 9 },
    });
    const cancelled = todo({
      id: "todo_cancelled",
      createdAt: "2026-09-15T01:00:01+00:00",
      cancelledAt: "2026-09-20T01:00:00+00:00",
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
      [
        wednesday,
        cancelled,
        unsettled,
        anytime,
        elsewhere,
        friday,
        longDone,
        // Galley's own tasks have none here (ticket 37's card is theirs).
        task({ state: "fired" }),
      ],
      "s-main",
    );
    expect([...byMessage.keys()].sort()).toEqual([
      "msg_s-main_4_assistant",
      "msg_s-main_9_assistant",
    ]);
    expect(byMessage.get("msg_s-main_4_assistant")!.map((i) => i.id)).toEqual([
      "todo_fri",
      "todo_any",
      "todo_wed",
    ]);
    expect(byMessage.get("msg_s-main_9_assistant")!.map((i) => i.id)).toEqual([
      "todo_done",
      "todo_cancelled",
    ]);
    // The same second: by id, as Core lists them.
    const same = (id: string) =>
      todo({ id, createdAt: "2026-10-16T01:00:00+00:00" });
    expect(
      todosByMessage([same("todo_b"), same("todo_a")], "s-main")
        .get("msg_s-main_4_assistant")!
        .map((i) => i.id),
    ).toEqual(["todo_a", "todo_b"]);
    expect(todosByMessage([friday], undefined).size).toBe(0);
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

  // Ticket 80 (ruling 128 point 3): the review Core seeds with the main
  // chat does not count.
  describe("with the daily review", () => {
    const review = task({
      id: "sched_review",
      text: "Daily review: read wake.md and go over what is in hand.",
      createdBy: "agent",
      agent: "galley-review",
      repeat: { kind: "daily" },
      timeOfDay: "09:00",
      createdIn: undefined,
    });
    const routine = task({
      id: "sched_daily",
      text: "早报",
      repeat: { kind: "daily" },
      timeOfDay: "08:00",
    });

    it("is empty with the review alone, running or paused", () => {
      expect(todoPanelEmpty({ ...EMPTY_TODO, routine: [review] })).toBe(true);
      expect(
        todoPanelEmpty({
          ...EMPTY_TODO,
          routine: [{ ...review, state: "paused", at: undefined }],
        }),
      ).toBe(true);
    });

    it("is not with another routine beside it", () => {
      expect(
        todoPanelEmpty({ ...EMPTY_TODO, routine: [review, routine] }),
      ).toBe(false);
      expect(todoPanelEmpty({ ...EMPTY_TODO, routine: [routine] })).toBe(false);
    });

    it("is not with a to-do, or anything in another group", () => {
      expect(
        todoPanelEmpty({
          ...EMPTY_TODO,
          yours: { today: [], later: [todo()], anytime: [] },
          routine: [review],
        }),
      ).toBe(false);
      expect(
        todoPanelEmpty({
          ...EMPTY_TODO,
          assistant: [task()],
          routine: [review],
        }),
      ).toBe(false);
      expect(
        todoPanelEmpty({
          ...EMPTY_TODO,
          done: [todo({ state: "done" })],
          routine: [review],
        }),
      ).toBe(false);
    });

    it("is empty, as it always was, once the review is cancelled", () => {
      // Core leaves a cancelled task out of every group.
      expect(todoPanelEmpty({ ...EMPTY_TODO, routine: [] })).toBe(true);
    });
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

describe("the panel's place (tickets 45, 46)", () => {
  it("starts at 320px (B1) under one id, so a dragged split has one memory", () => {
    expect(TODO_PANEL_WIDTH).toBe(320);
    expect(TODO_PANEL_ID).toBe("todo-panel");
  });

  it("a file preview closes only the place whose panel it replaces", () => {
    // Beside Galley: the preview takes its place, Galley's counts as
    // closed; the other place's stays as it was.
    expect(readingPanelClosesTodo("preview", "galley")).toEqual(["galley"]);
    // Beside the workbench, a subtask or the empty composer: theirs.
    expect(readingPanelClosesTodo("preview", "elsewhere")).toEqual([
      "elsewhere",
    ]);
    // No panel on screen: the preview is that conversation's and goes
    // with it; each place's panel comes back where it was open.
    expect(readingPanelClosesTodo("preview", null)).toEqual([]);
  });

  it("the Git review closes both, wherever it opens (it is the window's)", () => {
    for (const shown of ["galley", "elsewhere", null] as const) {
      expect([...readingPanelClosesTodo("review", shown)].sort()).toEqual([
        "elsewhere",
        "galley",
      ]);
    }
  });

  it("either place opening takes the reading panel's place; closing does not", () => {
    const closed = { galley: false, elsewhere: false };
    expect(todoPanelOpened({ galley: true, elsewhere: false }, closed)).toBe(
      true,
    );
    expect(todoPanelOpened({ galley: false, elsewhere: true }, closed)).toBe(
      true,
    );
    expect(
      todoPanelOpened(
        { galley: true, elsewhere: true },
        { galley: true, elsewhere: false },
      ),
    ).toBe(true);
    expect(todoPanelOpened(closed, { galley: true, elsewhere: true })).toBe(
      false,
    );
    expect(todoPanelOpened(closed, closed)).toBe(false);
  });
});
