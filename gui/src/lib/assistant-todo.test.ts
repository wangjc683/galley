import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import {
  cancelScheduledTask,
  cancelTodo,
  cancelTodoReminder,
  completeTodo,
  EMPTY_TODO,
  isDailyReview,
  listAssistantTodo,
  onceFired,
  reminderCardState,
  reminderStateLabel,
  reminderTimeLabel,
  remindersByMessage,
  reopenTodo,
  replyMessageId,
  todoActionFailure,
  todoAutostartHintVisible,
  todoFailureKind,
  todoRowTarget,
  todoStateLabel,
  todoTimeLabel,
  todoToastTitle,
  TODO_REFRESH_EVENTS,
  TODO_TOAST_TITLE_CHARS,
  withoutDailyReview,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { getTauriMocks } from "@/test/setup";

/**
 * The assistant's 待办 and reminder cards (main chat tickets 37, 42): the
 * pure half — the words and times a row and a card show, where a row
 * leads, which reply a card hangs under — and the Core calls. The to-do
 * panel's own words and the to-do cards are in lib/todo-panel.test.ts.
 */

// Local wall-clock parts, so the day words hold in whatever timezone the
// suite runs in (it runs in the machine's zone and in UTC).
function local(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}
// Friday 2026-10-16.
const TODAY = new Date(2026, 9, 16).getTime();
const zh = zhCopy;
const en = enCopy;

function item(extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "task",
    id: "sched_1",
    text: "提醒用户喝水",
    state: "scheduled",
    at: local(2026, 10, 16, 21, 40),
    createdBy: "assistant",
    target: "assistant",
    repeat: { kind: "once" },
    timeOfDay: "21:40",
    createdIn: { sessionId: "s-main", turnIndex: 7 },
    ...extra,
  };
}

// The routine Core seeds with the main chat (ticket 73): its maker's
// label in `agent`, its prompt English for the model.
const REVIEW = item({
  id: "sched_review",
  text: "Daily review: read wake.md and go over what is in hand.",
  createdBy: "agent",
  agent: "galley-review",
  repeat: { kind: "daily" },
  timeOfDay: "09:00",
  createdIn: undefined,
});

function task(extra: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "sched_1",
    prompt: "提醒用户喝水",
    repeat: { kind: "once" },
    timeOfDay: "21:40",
    enabled: true,
    fireAt: local(2026, 10, 17, 9, 0),
    target: "assistant",
    origin: { via: "supervisor", supervisor: "galley-assistant" },
    createdIn: { sessionId: "s-main", turnIndex: 7 },
    createdAt: "2026-10-16T08:00:00Z",
    updatedAt: "2026-10-16T08:00:00Z",
    ...extra,
  };
}

describe("a row's time", () => {
  it("writes a one-off's instant with a day word, a weekday or a date", () => {
    const at = (iso: string) =>
      todoTimeLabel(item({ at: iso }), TODAY, "zh-CN", zh);
    expect(at(local(2026, 10, 16, 21, 40))).toBe("今天 21:40");
    expect(at(local(2026, 10, 17, 9, 0))).toBe("明天 09:00");
    expect(at(local(2026, 10, 20, 9, 0))).toBe("周二 09:00");
    expect(at(local(2026, 10, 30, 9, 0))).toBe("10月30日 09:00");
  });

  it("writes a repeating task's rule while it is still to come", () => {
    const daily = item({
      repeat: { kind: "daily" },
      timeOfDay: "08:00",
      at: local(2026, 10, 17, 8, 0),
    });
    expect(todoTimeLabel(daily, TODAY, "zh-CN", zh)).toBe("每天 08:00");
    expect(
      todoTimeLabel(
        { ...daily, state: "paused", at: undefined },
        TODAY,
        "zh-CN",
        zh,
      ),
    ).toBe("每天 08:00");
    expect(todoTimeLabel(daily, TODAY, "en-US", en)).toBe("Daily 08:00");
    // Its last run (最近做完): the instant.
    const ran = {
      ...daily,
      state: "fired" as const,
      at: local(2026, 10, 16, 8, 0),
    };
    expect(todoTimeLabel(ran, TODAY, "zh-CN", zh)).toBe("今天 08:00");
  });

  it("writes a subtask's latest activity, yesterday included", () => {
    const sub = item({
      kind: "subtask",
      state: "running",
      at: local(2026, 10, 15, 22, 5),
      repeat: undefined,
    });
    expect(todoTimeLabel(sub, TODAY, "zh-CN", zh)).toBe("昨天 22:05");
    expect(todoTimeLabel(sub, TODAY, "en-US", en).replace(/\s/g, " ")).toBe(
      "Yesterday 10:05 PM",
    );
  });
});

describe("a row's state", () => {
  it("reminds or runs by what a fire does", () => {
    expect(todoStateLabel(item(), zh)).toBe("待提醒");
    expect(todoStateLabel(item({ target: "session" }), zh)).toBe("待运行");
    expect(todoStateLabel(item({ state: "fired" }), zh)).toBe("已提醒");
    expect(
      todoStateLabel(item({ state: "fired", target: "session" }), zh),
    ).toBe("已运行");
    expect(todoStateLabel(item({ state: "paused" }), zh)).toBe("已暂停");
  });

  it("says where a subtask stands", () => {
    const sub = (state: TodoItem["state"]) =>
      todoStateLabel(item({ kind: "subtask", state, target: undefined }), zh);
    expect(sub("running")).toBe("正在工作");
    expect(sub("asking")).toBe("等你回复");
    expect(sub("failed")).toBe("出错");
    expect(sub("step_limit")).toBe("停在步数上限");
    expect(sub("stopped")).toBe("没有跑完");
    expect(sub("done")).toBe("已完成");
  });
});

describe("where a row leads", () => {
  it("jumps to the reply a reminder was set in", () => {
    expect(todoRowTarget(item())).toEqual({
      kind: "reply",
      sessionId: "s-main",
      messageId: "msg_s-main_7_assistant",
    });
    // Its card's message id is the reply's `AgentTurn.messageId`.
    expect(replyMessageId("s-main", 7)).toBe("msg_s-main_7_assistant");
  });

  it("opens a subtask or a scheduled run's session", () => {
    expect(
      todoRowTarget(
        item({ kind: "subtask", id: "s-sub", createdIn: undefined }),
      ),
    ).toEqual({ kind: "subtask", sessionId: "s-sub" });
    const form = item({
      createdBy: "user",
      createdIn: undefined,
      repeat: { kind: "daily" },
      target: "session",
    });
    // The panel has no form (ticket 42): a routine the old form made
    // leads nowhere until it has run.
    expect(todoRowTarget(form)).toBeNull();
    expect(
      todoRowTarget({ ...form, state: "fired", runSessionId: "s-run" }),
    ).toEqual({ kind: "session", sessionId: "s-run" });
  });

  it("goes nowhere without an anchor: another agent's, or one not settled", () => {
    expect(
      todoRowTarget(item({ createdBy: "agent", createdIn: undefined })),
    ).toBeNull();
    expect(
      todoRowTarget(item({ createdIn: { sessionId: "s-main" } })),
    ).toBeNull();
    // A one-off from the form.
    expect(
      todoRowTarget(item({ createdBy: "user", createdIn: undefined })),
    ).toBeNull();
  });
});

describe("a card's cancel", () => {
  it("cancels through Core's soft delete, from the desktop", async () => {
    const { invoke } = getTauriMocks();
    await cancelScheduledTask("sched_1");
    expect(invoke).toHaveBeenCalledWith("delete_scheduled_task", {
      id: "sched_1",
      origin: { via: "gui" },
    });
  });

  it("says why an action failed", () => {
    const gone = JSON.stringify({ error: "not_found", message: "x" });
    expect(todoActionFailure(gone, zh)).toBe("这件事已经不在了。");
    expect(todoActionFailure(new Error("boom"), zh)).toBe(
      "没能完成，再试一次。",
    );
    expect(todoFailureKind(gone)).toBe("gone");
    expect(todoFailureKind("assistant_unavailable: no main chat")).toBe(
      "failed",
    );
  });
});

describe("the list", () => {
  it("reads Core's one query", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockResolvedValueOnce(EMPTY_TODO);
    await expect(listAssistantTodo()).resolves.toEqual(EMPTY_TODO);
    expect(invoke).toHaveBeenCalledWith("list_assistant_todo");
  });

  it("ticks a to-do, unticks it, cancels its reminder through Core", async () => {
    const { invoke } = getTauriMocks();
    const brief = { id: "todo_1", status: "done" };
    invoke.mockResolvedValue(brief);
    await expect(completeTodo("todo_1")).resolves.toEqual(brief);
    expect(invoke).toHaveBeenLastCalledWith("complete_todo", { id: "todo_1" });
    await reopenTodo("todo_1");
    expect(invoke).toHaveBeenLastCalledWith("reopen_todo", { id: "todo_1" });
    await cancelTodoReminder("todo_1");
    expect(invoke).toHaveBeenLastCalledWith("cancel_todo_reminder", {
      id: "todo_1",
    });
    // Ticket 88: the panel's 删除, Core's soft delete from the desktop.
    await cancelTodo("todo_1");
    expect(invoke).toHaveBeenLastCalledWith("cancel_todo", { id: "todo_1" });
  });

  it("quotes a title in the undo toast whole, or cut with 「…」 (ticket 88)", () => {
    expect(todoToastTitle("交周报")).toBe("交周报");
    // Its breaks and runs of space one space.
    expect(todoToastTitle("  交\n周报  ")).toBe("交 周报");
    const long = "把这个季度所有门店的销售数据整理成一份报告发给区域经理";
    expect(Array.from(long).length).toBeGreaterThan(TODO_TOAST_TITLE_CHARS);
    expect(todoToastTitle(long)).toBe(
      `${Array.from(long).slice(0, TODO_TOAST_TITLE_CHARS).join("")}…`,
    );
    const exact = "一".repeat(TODO_TOAST_TITLE_CHARS);
    expect(todoToastTitle(exact)).toBe(exact);
    // Cut by characters, never inside one.
    const emoji = "🎉".repeat(TODO_TOAST_TITLE_CHARS + 1);
    expect(todoToastTitle(emoji)).toBe(
      `${"🎉".repeat(TODO_TOAST_TITLE_CHARS)}…`,
    );
    expect(zhCopy.todo.deleteTodo.deleted(todoToastTitle("交周报"))).toBe(
      "已删除「交周报」",
    );
    expect(enCopy.todo.deleteTodo.deleted("Hand in the report")).toBe(
      'Deleted "Hand in the report"',
    );
    expect(zhCopy.todo.deleteTodo.deletedCount(2)).toBe("已删除 2 件待办");
    expect(enCopy.todo.deleteTodo.deletedCount(2)).toBe("Deleted 2 to-dos");
  });

  it("reads again on the events that change it", () => {
    expect(TODO_REFRESH_EVENTS).toEqual(
      expect.arrayContaining([
        "todos:changed",
        "scheduled-tasks:changed",
        "subtask-dispatched",
        "session-run-state",
        "session-updated-external",
        "session-deleted-external",
        "message-deleted",
      ]),
    );
  });

  it("warns about launch at login only while something is set to go off", () => {
    const set = { ...EMPTY_TODO, assistant: [item()] };
    expect(todoAutostartHintVisible(false, set, false)).toBe(true);
    expect(todoAutostartHintVisible(true, set, false)).toBe(false);
    expect(todoAutostartHintVisible(null, set, false)).toBe(false);
    expect(todoAutostartHintVisible(false, EMPTY_TODO, false)).toBe(false);
    const paused = { ...EMPTY_TODO, routine: [item({ state: "paused" })] };
    expect(todoAutostartHintVisible(false, paused, false)).toBe(false);
    // Closed with its × (ruling 96): gone, even with something set.
    expect(todoAutostartHintVisible(false, set, true)).toBe(false);
    // A to-do's reminder still to go off counts.
    const reminded = item({
      kind: "todo",
      id: "todo_1",
      state: "open",
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 9, 0),
        state: "scheduled",
      },
    });
    const yours = { today: [], later: [reminded], anytime: [] };
    expect(
      todoAutostartHintVisible(false, { ...EMPTY_TODO, yours }, false),
    ).toBe(true);
  });

  // Ruling 145: the panel's list goes without the daily review, so with
  // nothing else set it is never the hint's reason (ticket 83 had left it
  // out here by name).
  it("is not shown for the daily review alone, running or paused, in the panel's list", () => {
    const panel = (todo: AssistantTodo) =>
      todoAutostartHintVisible(false, withoutDailyReview(todo), false);
    expect(panel({ ...EMPTY_TODO, routine: [REVIEW] })).toBe(false);
    expect(
      panel({
        ...EMPTY_TODO,
        routine: [{ ...REVIEW, state: "paused", at: undefined }],
      }),
    ).toBe(false);
    // Beside a to-do's reminder still to go off: shown, as ever.
    const reminded = item({
      kind: "todo",
      id: "todo_1",
      state: "open",
      reminder: {
        taskId: "sched_9",
        at: local(2026, 10, 17, 9, 0),
        state: "scheduled",
      },
    });
    expect(
      panel({
        ...EMPTY_TODO,
        yours: { today: [], later: [reminded], anytime: [] },
        routine: [REVIEW],
      }),
    ).toBe(true);
    // Beside Galley's own one-off reminder, or another routine: shown.
    expect(
      panel({ ...EMPTY_TODO, assistant: [item()], routine: [REVIEW] }),
    ).toBe(true);
    expect(
      panel({
        ...EMPTY_TODO,
        routine: [
          REVIEW,
          item({
            id: "sched_daily",
            repeat: { kind: "daily" },
            timeOfDay: "08:00",
          }),
        ],
      }),
    ).toBe(true);
  });
});

// Main chat PRD ruling 145: the daily review's row is off the panel; it
// still runs, and Core still lists it.
describe("the list without the daily review", () => {
  const OTHER_ROUTINE = item({
    id: "sched_daily",
    text: "早报",
    repeat: { kind: "daily" },
    timeOfDay: "08:00",
  });

  it("takes the review out of 例行, running or paused, and leaves the rest", () => {
    const listed: AssistantTodo = {
      ...EMPTY_TODO,
      yours: { today: [], later: [], anytime: [item({ kind: "todo" })] },
      assistant: [item()],
      routine: [OTHER_ROUTINE, REVIEW],
      done: [item({ id: "sched_fired", state: "fired" })],
      doneOmitted: 1,
      todayCount: 2,
    };
    const shown = withoutDailyReview(listed);
    expect(shown.routine).toEqual([OTHER_ROUTINE]);
    expect(shown.yours).toBe(listed.yours);
    expect(shown.assistant).toBe(listed.assistant);
    expect(shown.done).toBe(listed.done);
    expect(shown.doneOmitted).toBe(1);
    expect(shown.todayCount).toBe(2);
    const paused = { ...REVIEW, state: "paused" as const, at: undefined };
    expect(
      withoutDailyReview({ ...EMPTY_TODO, routine: [paused] }).routine,
    ).toEqual([]);
  });

  it("takes it out of 「Galley 在办」 too, made a one-off by hand", () => {
    const once = { ...REVIEW, repeat: { kind: "once" as const } };
    const own = item();
    expect(
      withoutDailyReview({ ...EMPTY_TODO, assistant: [own, once] }).assistant,
    ).toEqual([own]);
  });

  it("is the same list when the review is not there", () => {
    const listed = {
      ...EMPTY_TODO,
      assistant: [item()],
      routine: [OTHER_ROUTINE],
    };
    expect(withoutDailyReview(listed)).toBe(listed);
    expect(withoutDailyReview(EMPTY_TODO)).toBe(EMPTY_TODO);
  });

  it("knows the review by its label on a task: another agent's routine, or a to-do with the label, stays", () => {
    const theirs = item({
      id: "sched_theirs",
      createdBy: "agent",
      agent: "claude-code",
      repeat: { kind: "daily" },
    });
    const labelled = item({
      kind: "todo",
      id: "todo_labelled",
      state: "open",
      agent: "galley-review",
    });
    expect(isDailyReview(REVIEW)).toBe(true);
    expect(isDailyReview(theirs)).toBe(false);
    expect(isDailyReview(labelled)).toBe(false);
    const listed: AssistantTodo = {
      ...EMPTY_TODO,
      yours: { today: [], later: [], anytime: [labelled] },
      routine: [theirs],
    };
    expect(withoutDailyReview(listed)).toBe(listed);
  });
});

describe("reminder cards", () => {
  it("states: to come, gone off, cancelled, switched off", () => {
    expect(reminderCardState(task())).toBe("scheduled");
    const fired = task({ lastFiredAt: local(2026, 10, 17, 9, 0) });
    expect(onceFired(fired)).toBe(true);
    expect(reminderCardState(fired)).toBe("fired");
    // A manual run before its time does not count.
    expect(
      reminderCardState(task({ lastFiredAt: local(2026, 10, 16, 9) })),
    ).toBe("scheduled");
    expect(
      reminderCardState(task({ cancelledAt: "2026-10-16T09:00:00Z" })),
    ).toBe("cancelled");
    expect(reminderCardState(task({ enabled: false }))).toBe("paused");
    // A repeating task never reads as gone off.
    expect(
      reminderCardState(
        task({
          repeat: { kind: "daily" },
          lastFiredAt: local(2026, 10, 17, 9),
        }),
      ),
    ).toBe("scheduled");
  });

  it("says its state and time", () => {
    expect(reminderStateLabel(task(), zh)).toBe("待提醒");
    expect(
      reminderStateLabel(task({ cancelledAt: "2026-10-16T09:00:00Z" }), zh),
    ).toBe("已取消");
    expect(reminderStateLabel(task({ enabled: false }), zh)).toBe("已暂停");
    expect(
      reminderStateLabel(task({ lastFiredAt: local(2026, 10, 17, 9) }), zh),
    ).toBe("已提醒");
    expect(reminderStateLabel(task({ cancelledAt: "x" }), en)).toBe(
      "Cancelled",
    );
    expect(reminderTimeLabel(task(), TODAY, "zh-CN", zh)).toBe("明天 09:00");
    expect(
      reminderTimeLabel(
        task({
          repeat: { kind: "weekly", weekdays: [1, 5] },
          timeOfDay: "08:00",
        }),
        TODAY,
        "zh-CN",
        zh,
      ),
    ).toBe("每周一·五 08:00");
  });

  it("hang under the reply they were set in, in the order they were made", () => {
    const later = task({ id: "sched_b", createdAt: "2026-10-16T08:05:00Z" });
    const first = task({ id: "sched_a", createdAt: "2026-10-16T08:01:00Z" });
    const other = task({
      id: "sched_c",
      createdIn: { sessionId: "s-main", turnIndex: 12 },
    });
    const unsettled = task({
      id: "sched_d",
      createdIn: { sessionId: "s-main" },
    });
    const elsewhere = task({
      id: "sched_e",
      createdIn: { sessionId: "s-old", turnIndex: 7 },
    });
    const form = task({ id: "sched_f", createdIn: undefined });
    const cancelled = task({
      id: "sched_g",
      cancelledAt: "2026-10-16T09:00:00Z",
      createdAt: "2026-10-16T08:09:00Z",
    });
    const map = remindersByMessage(
      [later, other, unsettled, elsewhere, form, first, cancelled],
      "s-main",
    );
    expect([...map.keys()].sort()).toEqual([
      "msg_s-main_12_assistant",
      "msg_s-main_7_assistant",
    ]);
    expect(map.get("msg_s-main_7_assistant")?.map((t) => t.id)).toEqual([
      "sched_a",
      "sched_b",
      "sched_g",
    ]);
    expect(remindersByMessage([first], undefined).size).toBe(0);
  });
});
