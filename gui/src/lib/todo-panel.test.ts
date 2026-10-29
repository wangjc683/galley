import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import {
  EMPTY_TODO,
  withoutDailyReview,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import {
  assistantRowLine,
  assistantTaskCancellable,
  doneRowLine,
  nextTodoRefreshMs,
  readingPanelClosesTodo,
  readingPanelClosesTodoOnWiden,
  routineRowLine,
  TODO_PANEL_ID,
  TODO_PANEL_WIDTH,
  TODO_SETTLE_MS,
  todoCancelled,
  todoChecked,
  todoEditWrite,
  todoMetaParts,
  todoNotedLine,
  todoNotesLine,
  todoOverdueDays,
  todoGlanceOpened,
  todoListed,
  todoPanelChanges,
  todoPanelEmpty,
  todoPanelOpened,
  todoPanelRows,
  todoReminderCancellable,
  todoRowsInDone,
  todoRowText,
  todosByMessage,
  todoSubitemCount,
  todoSubitemLines,
  todoSubitemMove,
  todoSubitemsShown,
  todoTitleTarget,
  todoWithoutDeleting,
  todoWritesOnTheirWay,
  type TodoHold,
} from "@/lib/todo-panel";

/**
 * The to-do panel's and the to-do cards' pure half (main chat tickets
 * 42 and 43): what a row's second line says (today, overdue, crossing
 * midnight, the day it was noted), where a title leads, which reply a
 * card hangs under and in what order, when the list is read again; and
 * since ticket 87 (PRD ruling 131) what lights up when Galley changes
 * the list, and where a to-do it ticked off holds.
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

// The routine Core seeds with the main chat (ticket 73): its maker's
// label in `agent` (core/src/assistant_todo.rs `creator`), its prompt
// English for the model. Off the panel since PRD ruling 145.
const REVIEW = task({
  id: "sched_review",
  text: "Daily review: read wake.md and go over what is in hand.",
  createdBy: "agent",
  agent: "galley-review",
  repeat: { kind: "daily" },
  timeOfDay: "09:00",
  createdIn: undefined,
});

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

  it("say a full path in backticks by its file's name on the folded line, the notes as written for the box (ticket 112)", () => {
    const notes =
      "10月28日：模板做好了：`/Users/jc/Downloads/希尔顿资料收集模板.md`\n用 `todo show` 看";
    expect(todoNotesLine(todo({ notes }))).toEqual({
      text: "10月28日：模板做好了：希尔顿资料收集模板.md 用 `todo show` 看",
      full: notes,
    });
  });
});

// Main chat ticket 107, PRD ruling 153 point 4: what saving a title or
// notes changed in place writes, and nothing when nothing changed.
describe("a title or notes changed in place (ticket 107)", () => {
  it("writes the words as typed, a title on one line", () => {
    expect(todoEditWrite("title", "交周报", "交周报和月报")).toBe(
      "交周报和月报",
    );
    expect(todoEditWrite("title", "交周报", "  交周报\n和月报 ")).toBe(
      "交周报 和月报",
    );
    expect(todoEditWrite("notes", "A 座", "A 座 3 楼\n带身份证\n")).toBe(
      "A 座 3 楼\n带身份证",
    );
  });

  it("writes nothing when the words are as the box opened, a trim apart", () => {
    expect(todoEditWrite("title", "交周报", "交周报")).toBeNull();
    expect(todoEditWrite("title", "交周报", " 交周报 ")).toBeNull();
    expect(todoEditWrite("notes", "A 座", "A 座\n")).toBeNull();
    expect(todoEditWrite("notes", "", "  ")).toBeNull();
  });

  it("gives an emptied title up, and empties emptied notes", () => {
    expect(todoEditWrite("title", "交周报", "")).toBeNull();
    expect(todoEditWrite("title", "交周报", " \n ")).toBeNull();
    expect(todoEditWrite("notes", "A 座 3 楼", "")).toBe("");
    expect(todoEditWrite("notes", "A 座 3 楼", " \n")).toBe("");
  });

  it("measures against what the box opened with, not what Galley wrote since", () => {
    // Opened on 「交周报」, Galley renamed it meanwhile: a box left as it
    // opened writes nothing; one changed is written whole.
    expect(todoEditWrite("title", "交周报", "交周报")).toBeNull();
    expect(todoEditWrite("title", "交周报", "交周报！")).toBe("交周报！");
  });
});

describe("the day an open to-do was noted (ticket 107)", () => {
  it("is today, yesterday, then the date, never a weekday, in either language", () => {
    const at = (d: number, h = 10) =>
      todo({ createdAt: local(2026, 10, d, h) });
    expect(todoNotedLine(at(16), TODAY, "zh-CN", zh)).toBe("今天记下");
    expect(todoNotedLine(at(15, 23), TODAY, "zh-CN", zh)).toBe("昨天记下");
    // Three days back: a date, not 「周二」 as the time line would say.
    expect(todoNotedLine(at(13), TODAY, "zh-CN", zh)).toBe("10月13日记下");
    expect(
      todoNotedLine(
        todo({ createdAt: local(2025, 12, 30) }),
        TODAY,
        "zh-CN",
        zh,
      ),
    ).toBe("2025年12月30日记下");
    expect(todoNotedLine(at(16), TODAY, "en-US", en)).toBe("Noted today");
    expect(todoNotedLine(at(15), TODAY, "en-US", en)).toBe("Noted yesterday");
    expect(todoNotedLine(at(13), TODAY, "en-US", en)).toBe("Noted Oct 13");
  });

  it("says nothing without a day", () => {
    expect(todoNotedLine(todo(), TODAY, "zh-CN", zh)).toBeNull();
    expect(
      todoNotedLine(todo({ createdAt: "not a time" }), TODAY, "zh-CN", zh),
    ).toBeNull();
  });
});

describe("a row's name", () => {
  it("is the words it carries, 「子任务」 for a subtask without a title", () => {
    expect(todoRowText(task(), zh)).toBe("看看快递到了没有");
    expect(todoRowText(todo(), zh)).toBe("交季度报告");
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

  // Main chat ticket 105, PRD ruling 151: the line for the user, not the
  // assistant's notes to itself after it.
  it("is a task's first line only, in Galley 在办, 例行 and 已完成 alike", () => {
    const text =
      "看看快递到了没有\n\n京东单号 JD8812345678，到时查物流告诉用户。";
    expect(todoRowText(task({ text }), zh)).toBe("看看快递到了没有");
    expect(
      todoRowText(task({ text, repeat: { kind: "daily" }, at: undefined }), zh),
    ).toBe("看看快递到了没有");
    expect(todoRowText(task({ text, state: "fired" }), zh)).toBe(
      "看看快递到了没有",
    );
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
  // Ticket 88 (PRD ruling 132 point 4): what the panel draws while
  // to-dos deleted there wait for Core.
  it("leaves out the to-dos deleted here and not yet by Core, wherever they are", () => {
    const report = todo({ id: "todo_report" });
    const soil = todo({ id: "todo_soil" });
    const done = todo({ id: "todo_done", state: "done" });
    const own = task({ id: "sched_once" });
    const listed: AssistantTodo = {
      ...EMPTY_TODO,
      yours: { today: [report], later: [], anytime: [soil] },
      assistant: [own],
      done: [done],
      todayCount: 1,
    };
    expect(todoWithoutDeleting(listed, {})).toBe(listed);
    const shown = todoWithoutDeleting(listed, {
      todo_report: {},
      todo_done: {},
    });
    expect(shown.yours).toEqual({ today: [], later: [], anytime: [soil] });
    expect(shown.done).toEqual([]);
    expect(shown.assistant).toEqual([own]);
    // 「今天 N」 is Core's: it follows once Core has deleted it.
    expect(shown.todayCount).toBe(1);
    // A group without one of them is the same array.
    expect(shown.yours.anytime).toBe(listed.yours.anytime);
    // The last one gone: the empty state.
    expect(
      todoPanelEmpty(
        todoWithoutDeleting(
          { ...EMPTY_TODO, yours: { today: [report], later: [], anytime: [] } },
          { todo_report: {} },
        ),
      ),
    ).toBe(true);
  });

  it("is empty only with nothing in any group", () => {
    expect(todoPanelEmpty(EMPTY_TODO)).toBe(true);
    expect(todoPanelEmpty({ ...EMPTY_TODO, done: [task()] })).toBe(false);
    expect(
      todoPanelEmpty({
        ...EMPTY_TODO,
        routine: [task({ repeat: { kind: "daily" } })],
      }),
    ).toBe(false);
    expect(
      todoPanelEmpty({
        ...EMPTY_TODO,
        yours: { today: [], later: [], anytime: [todo()] },
      }),
    ).toBe(false);
  });

  // Ruling 145: the panel's list goes without the review Core seeds with
  // the main chat, so with it alone the panel is empty, no exception
  // needed (ticket 80 had made one here, ruling 128 point 3).
  describe("with the daily review", () => {
    const routine = task({
      id: "sched_daily",
      text: "早报",
      repeat: { kind: "daily" },
      timeOfDay: "08:00",
    });
    const empty = (todo: AssistantTodo) =>
      todoPanelEmpty(withoutDailyReview(todo));

    it("is empty with the review alone, running or paused", () => {
      expect(empty({ ...EMPTY_TODO, routine: [REVIEW] })).toBe(true);
      expect(
        empty({
          ...EMPTY_TODO,
          routine: [{ ...REVIEW, state: "paused", at: undefined }],
        }),
      ).toBe(true);
    });

    it("is not with another routine beside it, which is all 例行 draws", () => {
      const listed = withoutDailyReview({
        ...EMPTY_TODO,
        routine: [REVIEW, routine],
      });
      expect(todoPanelEmpty(listed)).toBe(false);
      expect(listed.routine).toEqual([routine]);
    });

    it("is not with a to-do, or anything in another group", () => {
      expect(
        empty({
          ...EMPTY_TODO,
          yours: { today: [], later: [todo()], anytime: [] },
          routine: [REVIEW],
        }),
      ).toBe(false);
      expect(
        empty({ ...EMPTY_TODO, assistant: [task()], routine: [REVIEW] }),
      ).toBe(false);
      expect(
        empty({
          ...EMPTY_TODO,
          done: [todo({ state: "done" })],
          routine: [REVIEW],
        }),
      ).toBe(false);
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
    expect(readingPanelClosesTodo("preview", "galley", false)).toEqual([
      "galley",
    ]);
    // Beside the workbench, a subtask or the empty composer: theirs.
    expect(readingPanelClosesTodo("preview", "elsewhere", false)).toEqual([
      "elsewhere",
    ]);
    // No panel on screen: the preview is that conversation's and goes
    // with it; each place's panel comes back where it was open.
    expect(readingPanelClosesTodo("preview", null, false)).toEqual([]);
  });

  it("the Git review closes both, wherever it opens (it is the window's)", () => {
    for (const shown of ["galley", "elsewhere", null] as const) {
      expect(
        [...readingPanelClosesTodo("review", shown, false)].sort(),
      ).toEqual(["elsewhere", "galley"]);
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

  it("in a narrow main area nothing is remembered closed (ticket 87)", () => {
    for (const shown of ["galley", "elsewhere", null] as const) {
      expect(readingPanelClosesTodo("preview", shown, true)).toEqual([]);
      expect(readingPanelClosesTodo("review", shown, true)).toEqual([]);
    }
  });

  it("a preview or review opened narrow keeps its place as the main area widens (ticket 87)", () => {
    // Widening with a preview open: it replaces this conversation's place.
    expect(
      readingPanelClosesTodoOnWiden("preview", "galley", true, false),
    ).toEqual(["galley"]);
    expect(
      readingPanelClosesTodoOnWiden("preview", "elsewhere", true, false),
    ).toEqual(["elsewhere"]);
    // The review is the window's: both.
    expect(
      [
        ...readingPanelClosesTodoOnWiden("review", "galley", true, false),
      ].sort(),
    ).toEqual(["elsewhere", "galley"]);
    // No main chat, no place: a preview replaces none.
    expect(readingPanelClosesTodoOnWiden("preview", null, true, false)).toEqual(
      [],
    );
    // Nothing open, still narrow, or wide all along: nothing.
    expect(readingPanelClosesTodoOnWiden(null, "galley", true, false)).toEqual(
      [],
    );
    expect(
      readingPanelClosesTodoOnWiden("preview", "galley", true, true),
    ).toEqual([]);
    expect(
      readingPanelClosesTodoOnWiden("review", "galley", false, false),
    ).toEqual([]);
  });

  it("a look opening, or sent ahead by a jump, takes the place too (ticket 87)", () => {
    const here = { at: "main:a", arrived: true };
    expect(todoGlanceOpened(here, null)).toBe(true);
    expect(todoGlanceOpened({ at: "main:b", arrived: false }, here)).toBe(true);
    // Arriving, or folding, is no opening.
    expect(todoGlanceOpened(here, { at: "main:a", arrived: false })).toBe(
      false,
    );
    expect(todoGlanceOpened(null, here)).toBe(false);
  });
});

describe("what lights up (ticket 87, ruling 131 points 3 and 5)", () => {
  const list = (extra: Partial<AssistantTodo> = {}): AssistantTodo => ({
    ...EMPTY_TODO,
    ...extra,
  });
  const yours = (...items: TodoItem[]): AssistantTodo["yours"] => ({
    today: [],
    later: [],
    anytime: items,
  });
  const none = new Set<string>();
  const lit = (
    previous: AssistantTodo,
    next: AssistantTodo,
    mine: ReadonlySet<string> = none,
  ) => todoPanelChanges(previous, next, mine).flash;

  const A = todo({ id: "todo_a", text: "交季度报告" });
  const B = todo({ id: "todo_b", text: "订机票" });
  const C = todo({ id: "todo_c", text: "还书" });
  const SUB: TodoItem = {
    kind: "subtask",
    id: "s-sub",
    text: "查资料",
    state: "running",
    at: local(2026, 10, 16, 9, 0),
    createdBy: "assistant",
  };
  const ONCE = task({ id: "sched_once" });
  const DAILY = task({
    id: "sched_daily",
    text: "每天看看日程",
    repeat: { kind: "daily" },
    timeOfDay: "08:00",
    at: local(2026, 10, 17, 8, 0),
  });

  it("lights what is new among your to-dos, Galley's and the routines, a subtask too", () => {
    const before = list({ yours: yours(A), assistant: [ONCE], routine: [] });
    const after = list({
      yours: yours(A, B),
      assistant: [ONCE, SUB],
      routine: [DAILY],
    });
    expect(lit(before, after)).toEqual(["todo_b", "s-sub", "sched_daily"]);
  });

  it("lights a to-do of yours with new words, due time, reminder or notes", () => {
    const before = list({
      yours: yours(
        A,
        todo({ id: "todo_due", due: { date: "2026-11-20", hasTime: false } }),
        todo({
          id: "todo_bell",
          reminder: {
            taskId: "sched_r",
            at: local(2026, 10, 18, 9),
            state: "scheduled",
          },
        }),
        todo({ id: "todo_notes", notes: "王老师" }),
      ),
    });
    const after = list({
      yours: yours(
        { ...A, text: "交第三季度报告" },
        todo({ id: "todo_due", due: { date: "2026-11-25", hasTime: false } }),
        todo({
          id: "todo_bell",
          reminder: {
            taskId: "sched_r",
            at: local(2026, 10, 18, 10),
            state: "scheduled",
          },
        }),
        todo({ id: "todo_notes", notes: "王老师 13800000000" }),
      ),
    });
    expect(lit(before, after)).toEqual([
      "todo_a",
      "todo_due",
      "todo_bell",
      "todo_notes",
    ]);
  });

  it("lights a due time, a reminder paused, added or taken away", () => {
    const at = local(2026, 10, 18, 9);
    const bell = { taskId: "sched_r", at, state: "scheduled" as const };
    const cases: [Partial<TodoItem>, Partial<TodoItem>][] = [
      [
        { due: { date: "2026-11-20", hasTime: false } },
        { due: { date: "2026-11-20", hasTime: true, at, time: "09:00" } },
      ],
      [{}, { due: { date: "2026-11-20", hasTime: false } }],
      [{ reminder: bell }, { reminder: { ...bell, state: "paused" } }],
      [{}, { reminder: bell }],
      [{ reminder: bell }, {}],
    ];
    for (const [was, now] of cases) {
      expect(
        lit(
          list({ yours: yours(todo({ id: "todo_x", ...was })) }),
          list({ yours: yours(todo({ id: "todo_x", ...now })) }),
        ),
      ).toEqual(["todo_x"]);
    }
  });

  it("does not light a reminder going off, nor a to-do turning overdue (the clock)", () => {
    const at = local(2026, 10, 16, 9);
    const before = list({
      yours: yours(
        todo({
          id: "todo_x",
          reminder: { taskId: "sched_r", at, state: "scheduled" },
        }),
        todo({ id: "todo_y", due: { date: "2026-10-16", hasTime: true, at } }),
      ),
    });
    const after = list({
      yours: yours(
        todo({
          id: "todo_x",
          reminder: { taskId: "sched_r", at, state: "fired" },
        }),
        todo({
          id: "todo_y",
          due: { date: "2026-10-16", hasTime: true, at },
          overdue: true,
        }),
      ),
    });
    expect(lit(before, after)).toEqual([]);
  });

  it("lights one of Galley's own one-off reminders with new words or time, nothing else in 「Galley 在办」", () => {
    const before = list({ assistant: [ONCE, SUB] });
    expect(
      lit(before, list({ assistant: [{ ...ONCE, text: "看看快递" }, SUB] })),
    ).toEqual(["sched_once"]);
    expect(
      lit(
        before,
        list({ assistant: [{ ...ONCE, at: local(2026, 10, 17, 10) }, SUB] }),
      ),
    ).toEqual(["sched_once"]);
    // Paused: not its words, not its time.
    expect(
      lit(before, list({ assistant: [{ ...ONCE, state: "paused" }, SUB] })),
    ).toEqual([]);
    // A subtask after it appears: its state, title, latest activity.
    expect(
      lit(
        before,
        list({
          assistant: [
            ONCE,
            {
              ...SUB,
              state: "asking",
              text: "查资料（二）",
              at: local(2026, 10, 16, 10),
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("lights a routine with new words, rule, time of day, paused or resumed — not its next time", () => {
    const before = list({ routine: [DAILY] });
    const after = (extra: Partial<TodoItem>) =>
      list({ routine: [{ ...DAILY, ...extra }] });
    for (const extra of [
      { text: "每天早上看看日程" },
      { repeat: { kind: "weekly" as const, weekdays: [1, 3] } },
      { timeOfDay: "08:30" },
      { state: "paused" as const, at: undefined },
    ]) {
      expect(lit(before, after(extra))).toEqual(["sched_daily"]);
    }
    expect(
      lit(list({ routine: [{ ...DAILY, state: "paused" }] }), before),
    ).toEqual(["sched_daily"]);
    // It went off: the next time moved on.
    expect(lit(before, after({ at: local(2026, 10, 18, 8, 0) }))).toEqual([]);
  });

  it("never lights the daily review: not its time moved, paused or resumed, nor its arrival (ruling 145)", () => {
    // As the store keeps each read: without the review.
    const shown = (routine: TodoItem[]) =>
      withoutDailyReview(list({ routine }));
    const before = shown([DAILY, REVIEW]);
    for (const extra of [
      { timeOfDay: "07:30", at: local(2026, 10, 17, 7, 30) },
      { state: "paused" as const, at: undefined },
      { text: "Daily review: go over what is in hand." },
    ]) {
      expect(lit(before, shown([DAILY, { ...REVIEW, ...extra }]))).toEqual([]);
    }
    expect(lit(shown([DAILY, { ...REVIEW, state: "paused" }]), before)).toEqual(
      [],
    );
    // Seeded with a main chat while the panel is on screen.
    expect(lit(shown([DAILY]), before)).toEqual([]);
    // Another routine beside it lights as ever.
    expect(
      lit(before, shown([{ ...DAILY, timeOfDay: "08:30" }, REVIEW])),
    ).toEqual(["sched_daily"]);
  });

  it("does not light what goes off into 已完成, anything else new there, or what leaves", () => {
    const fired = { ...ONCE, state: "fired" as const };
    const back = { ...SUB, state: "done" as const };
    expect(
      lit(
        list({ yours: yours(A, B), assistant: [ONCE, SUB] }),
        list({ yours: yours(A), assistant: [], done: [fired, back] }),
      ),
    ).toEqual([]);
  });

  it("does not light this window's own writes on their way", () => {
    const bell = {
      taskId: "sched_r",
      at: local(2026, 10, 18),
      state: "scheduled" as const,
    };
    const before = list({ yours: yours({ ...A, reminder: bell }, B) });
    const after = list({
      yours: yours(A, C),
      done: [{ ...B, state: "done", at: local(2026, 10, 16, 10) }],
    });
    // A: its reminder cancelled here; B: ticked here; C: unticked here.
    const mine = new Set(["todo_a", "todo_b", "todo_c"]);
    expect(todoPanelChanges(before, after, mine)).toEqual({
      flash: [],
      held: [],
    });
    // Not this window's, the same read lights all three, in the panel's
    // order (B held last, where it stood).
    expect(lit(before, after)).toEqual(["todo_a", "todo_c", "todo_b"]);
  });

  it("takes this window's writes from either read of the store", () => {
    expect(
      [
        ...todoWritesOnTheirWay(
          { flips: { todo_a: {} }, cancelling: {}, deleting: {}, editing: {} },
          {
            flips: {},
            cancelling: { sched_x: true },
            deleting: {},
            editing: { todo_e: 1 },
          },
        ),
      ].sort(),
    ).toEqual(["sched_x", "todo_a", "todo_e"]);
  });

  // Ticket 88: a to-do deleted here, under its undo or sent, is this
  // window's own: whatever Core's read does with it, nothing lights or
  // holds — Galley ticking it off meanwhile included.
  it("counts a to-do deleted here as this window's own write", () => {
    const mine = todoWritesOnTheirWay(
      { flips: {}, cancelling: {}, deleting: { todo_b: {} }, editing: {} },
      { flips: {}, cancelling: {}, deleting: {}, editing: {} },
    );
    expect([...mine]).toEqual(["todo_b"]);
    const before = list({ yours: yours(A, B) });
    const after = list({
      yours: yours(A),
      done: [{ ...B, state: "done", at: local(2026, 10, 16, 10) }],
    });
    expect(todoPanelChanges(before, after, mine)).toEqual({
      flash: [],
      held: [],
    });
  });

  it("holds a to-do Galley ticked off for you where it stood, lit, before 已完成", () => {
    const doneB = {
      ...B,
      state: "done" as const,
      doneBy: "assistant" as const,
    };
    const before = list({ yours: yours(A, B, C) });
    const after = list({ yours: yours(A, C), done: [doneB] });
    const change = todoPanelChanges(before, after, none);
    expect(change.held).toEqual([{ item: B, following: ["todo_c"] }]);
    expect(change.flash).toEqual(["todo_b"]);
    // Drawn in its place, struck as it stood, not yet in 已完成.
    const rows = todoPanelRows(after, change.held);
    expect(rows.yours.map((item) => item.id)).toEqual([
      "todo_a",
      "todo_b",
      "todo_c",
    ]);
    expect(rows.done).toEqual([]);
    expect([...rows.holding]).toEqual(["todo_b"]);
    // Held out, it is in 已完成.
    expect(todoPanelRows(after, []).done).toEqual([doneB]);
    // A tick of yours, or one the user made elsewhere and this window
    // knows as its own, holds by its own flip instead.
    expect(todoPanelChanges(before, after, new Set(["todo_b"]))).toEqual({
      flash: [],
      held: [],
    });
  });

  it("holds by who ticked it in this window, not by `doneBy`", () => {
    // Ticked as the user, but not from this window (the CLI, another
    // device): Galley's change as far as this panel knows.
    const doneB = { ...B, state: "done" as const, doneBy: "user" as const };
    const change = todoPanelChanges(
      list({ yours: yours(A, B) }),
      list({ yours: yours(A), done: [doneB] }),
      none,
    );
    expect(change.held.map((hold) => hold.item.id)).toEqual(["todo_b"]);
  });

  it("does not hold one cancelled: it just goes", () => {
    const change = todoPanelChanges(
      list({ yours: yours(A, B) }),
      list({ yours: yours(A) }),
      none,
    );
    expect(change).toEqual({ flash: [], held: [] });
  });

  it("places held rows among a list that moved, and never twice", () => {
    const held: TodoHold[] = [
      { item: A, following: ["todo_b", "todo_c"] },
      { item: B, following: ["todo_c"] },
    ];
    const now = list({ yours: yours(C) });
    expect(todoPanelRows(now, held).yours.map((item) => item.id)).toEqual([
      "todo_a",
      "todo_b",
      "todo_c",
    ]);
    // Nothing that followed is left: last.
    expect(
      todoPanelRows(list({ yours: yours(C) }), [
        { item: A, following: ["todo_x"] },
      ]).yours.map((item) => item.id),
    ).toEqual(["todo_c", "todo_a"]);
    // Unticked since: drawn once, as the list has it, and not held.
    const again = todoPanelRows(list({ yours: yours(A, C) }), held);
    expect(again.yours.map((item) => item.id)).toEqual([
      "todo_a",
      "todo_b",
      "todo_c",
    ]);
    expect([...again.holding]).toEqual(["todo_b"]);
  });

  it("knows whether the panel lists a to-do, and when one is only under 已完成", () => {
    const doneB = { ...B, state: "done" as const };
    const now = list({ yours: yours(A), assistant: [SUB], done: [doneB] });
    expect(todoListed(now, "todo_a")).toBe(true);
    expect(todoListed(now, "todo_b")).toBe(true);
    expect(todoListed(now, "s-sub")).toBe(true);
    // Cancelled, or done more than seven days ago: not listed.
    expect(todoListed(now, "todo_c")).toBe(false);
    expect(todoRowsInDone(now, ["todo_b"])).toBe(true);
    expect(todoRowsInDone(now, ["todo_a"])).toBe(false);
    expect(todoRowsInDone(now, ["todo_a", "todo_b"])).toBe(true);
    expect(todoRowsInDone(now, [])).toBe(false);
  });
});

// Main chat ticket 111 (PRD ruling 157): the items under a to-do.
describe("the items under a to-do", () => {
  const items = (...words: [string, boolean][]) =>
    words.map(([text, done], at) => ({ id: `item_${at}`, text, done }));
  const list = (anytime: TodoItem[]): AssistantTodo => ({
    ...EMPTY_TODO,
    yours: { today: [], later: [], anytime },
  });

  it("counts them ticked of all, with 「项」 in Chinese and words in English; none, no count", () => {
    const three = items(["订酒店", true], ["订机票", false], ["换港币", false]);
    expect(todoSubitemCount(three, zh)).toBe("1/3 项");
    expect(todoSubitemCount(three, en)).toBe("1 of 3 done");
    // All ticked: the same count, nothing else.
    expect(
      todoSubitemCount(
        three.map((item) => ({ ...item, done: true })),
        zh,
      ),
    ).toBe("3/3 项");
    expect(todoSubitemCount([], zh)).toBeNull();
  });

  it("makes one item of each pasted line, trimmed, blank lines skipped", () => {
    expect(todoSubitemLines("订酒店\n\n  订机票 \r\n换港币\n")).toEqual([
      "订酒店",
      "订机票",
      "换港币",
    ]);
    expect(todoSubitemLines("一行")).toEqual(["一行"]);
    expect(todoSubitemLines(" \n \n")).toEqual([]);
  });

  it("draws them without the ones deleted here and with the ticks on their way", () => {
    const trip = todo({
      items: items(["订酒店", true], ["订机票", false], ["换港币", false]),
    });
    // Nothing on its way: Core's own array.
    expect(todoSubitemsShown(trip, {}, {})).toBe(trip.items);
    expect(todoSubitemsShown(todo(), {}, {})).toEqual([]);
    expect(
      todoSubitemsShown(
        trip,
        { item_1: { done: true }, item_0: { done: true } },
        { item_2: {} },
      ),
    ).toEqual([
      { id: "item_0", text: "订酒店", done: true },
      { id: "item_1", text: "订机票", done: true },
    ]);
  });

  it("lights a to-do whose items Galley added, ticked, changed or removed; not one this window wrote", () => {
    const before = list([
      todo({ id: "todo_a", items: items(["订酒店", false]) }),
      todo({ id: "todo_b" }),
    ]);
    const lit = (next: AssistantTodo, mine = new Set<string>()) =>
      todoPanelChanges(before, next, mine).flash;
    const withItems = (change: TodoItem["items"]) =>
      list([todo({ id: "todo_a", items: change }), todo({ id: "todo_b" })]);
    expect(lit(withItems(items(["订酒店", true])))).toEqual(["todo_a"]);
    expect(lit(withItems(items(["订虹桥的酒店", false])))).toEqual(["todo_a"]);
    expect(lit(withItems(items(["订酒店", false], ["订机票", false])))).toEqual(
      ["todo_a"],
    );
    expect(lit(withItems(undefined))).toEqual(["todo_a"]);
    expect(lit(withItems(items(["订酒店", false])))).toEqual([]);
    // This window's own: an item's tick, add or delete names its to-do.
    const mine = todoWritesOnTheirWay({
      flips: {},
      cancelling: {},
      deleting: {},
      editing: {},
      subitemWriting: { todo_x: 1 },
      subitemTicks: { item_0: { todoId: "todo_a" } },
      subitemDeleting: { item_7: { todoId: "todo_y" } },
    });
    expect([...mine].sort()).toEqual(["todo_a", "todo_x", "todo_y"]);
    expect(lit(withItems(items(["订酒店", true])), mine)).toEqual([]);
  });

  // Main chat ticket 112 (PRD ruling 158 point 1): dragged into order.
  it("lights a to-do whose items Galley moved; not one this window is moving", () => {
    const before = list([
      todo({
        id: "todo_a",
        items: items(["订酒店", false], ["订机票", false]),
      }),
    ]);
    const moved = list([
      todo({
        id: "todo_a",
        items: [
          { id: "item_1", text: "订机票", done: false },
          { id: "item_0", text: "订酒店", done: false },
        ],
      }),
    ]);
    expect(todoPanelChanges(before, moved, new Set()).flash).toEqual([
      "todo_a",
    ]);
    const mine = todoWritesOnTheirWay({
      flips: {},
      cancelling: {},
      deleting: {},
      editing: {},
      subitemOrders: { todo_a: { ids: ["item_1", "item_0"], sending: 1 } },
    });
    expect([...mine]).toEqual(["todo_a"]);
    expect(todoPanelChanges(before, moved, mine).flash).toEqual([]);
  });

  it("draws them in the order a drag on its way leaves them, Galley's new one last", () => {
    const trip = todo({
      items: items(["订酒店", true], ["订机票", false], ["换港币", false]),
    });
    expect(
      todoSubitemsShown(trip, {}, {}, ["item_2", "item_0", "item_1"]).map(
        (each) => each.id,
      ),
    ).toEqual(["item_2", "item_0", "item_1"]);
    // One Core has that the order does not name: at the end.
    expect(
      todoSubitemsShown(trip, {}, {}, ["item_1", "item_0"]).map(
        (each) => each.id,
      ),
    ).toEqual(["item_1", "item_0", "item_2"]);
    // With the ticks and deletions on their way too.
    expect(
      todoSubitemsShown(trip, { item_2: { done: true } }, { item_0: {} }, [
        "item_2",
        "item_0",
        "item_1",
      ]),
    ).toEqual([
      { id: "item_2", text: "换港币", done: true },
      { id: "item_1", text: "订机票", done: false },
    ]);
    // Core's order already: Core's own array.
    expect(
      todoSubitemsShown(trip, {}, {}, ["item_0", "item_1", "item_2"]),
    ).toBe(trip.items);
  });

  it("writes a drag as the place after the item it now follows, first when it follows none", () => {
    const all = ["a", "b", "c", "d"];
    // To the top, to the bottom, into the middle.
    expect(todoSubitemMove(all, ["c", "a", "b", "d"], "c")).toEqual({
      to: 1,
      order: ["c", "a", "b", "d"],
    });
    expect(todoSubitemMove(all, ["b", "c", "d", "a"], "a")).toEqual({
      to: 4,
      order: ["b", "c", "d", "a"],
    });
    expect(todoSubitemMove(all, ["a", "d", "b", "c"], "d")).toEqual({
      to: 2,
      order: ["a", "d", "b", "c"],
    });
    // Dropped back where it was: nothing.
    expect(todoSubitemMove(all, all, "b")).toBeNull();
    expect(todoSubitemMove(all, ["a", "b", "c", "d"], "a")).toBeNull();
    // One deleted here and waiting under its undo toast is still Core's:
    // the place is counted among all of them, so once it goes the order
    // is the one drawn.
    expect(todoSubitemMove(all, ["a", "c", "d"], "c")).toBeNull();
    expect(todoSubitemMove(all, ["c", "a", "d"], "a")).toEqual({
      to: 3,
      order: ["b", "c", "a", "d"],
    });
    expect(todoSubitemMove(all, ["c", "a", "d"], "c")).toEqual({
      to: 1,
      order: ["c", "a", "b", "d"],
    });
    // An id Core does not have: nothing.
    expect(todoSubitemMove(all, ["x", "a"], "x")).toBeNull();
  });
});
