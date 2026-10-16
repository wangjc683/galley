import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import {
  cancelScheduledTask,
  cancelTodoReminder,
  completeTodo,
  EMPTY_TODO,
  legacyTodoGroups,
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
  todoBadge,
  todoCanCancel,
  todoCanEdit,
  todoCanPause,
  todoCanResume,
  todoIsEmpty,
  todoRowTarget,
  todoStateLabel,
  todoTimeLabel,
  TODO_REFRESH_EVENTS,
  type TodoItem,
} from "@/lib/assistant-todo";
import type { ScheduledTask } from "@/lib/scheduled-tasks";
import { getTauriMocks } from "@/test/setup";

/**
 * The assistant's 待办 and reminder cards (main chat ticket 37): the
 * pure half — the words and times a row and a card show, where a row
 * leads, which actions it has, which reply a card hangs under — and the
 * two Core calls.
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

describe("a row's state and mark", () => {
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

  it("marks what the form or another agent made, not the assistant's", () => {
    expect(todoBadge(item(), zh)).toBeNull();
    expect(todoBadge(item({ createdBy: "user" }), zh)).toEqual({
      label: "手动",
      title: "你在定时任务表单里建的",
    });
    expect(
      todoBadge(item({ createdBy: "agent", agent: "claude-code" }), zh),
    ).toEqual({
      label: "Agent",
      title: "claude-code 建的",
    });
    expect(todoBadge(item({ createdBy: "agent" }), zh)?.title).toBe(
      "外部 Agent 建的",
    );
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

  it("opens a subtask, a scheduled run's session, or the form", () => {
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
    expect(todoRowTarget(form)).toEqual({ kind: "edit", taskId: "sched_1" });
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
    // A one-off from the form (the old form cannot edit it).
    expect(
      todoRowTarget(item({ createdBy: "user", createdIn: undefined })),
    ).toBeNull();
  });
});

describe("a row's actions", () => {
  it("cancels anything still to come; pauses and resumes the repeating", () => {
    const once = item();
    expect([
      todoCanCancel(once),
      todoCanPause(once),
      todoCanResume(once),
    ]).toEqual([true, false, false]);
    const daily = item({ repeat: { kind: "daily" } });
    expect([
      todoCanCancel(daily),
      todoCanPause(daily),
      todoCanResume(daily),
    ]).toEqual([true, true, false]);
    const paused = { ...daily, state: "paused" as const };
    expect([todoCanPause(paused), todoCanResume(paused)]).toEqual([
      false,
      true,
    ]);
    for (const done of [
      item({ state: "fired" }),
      item({ kind: "subtask", state: "running" }),
    ]) {
      expect(
        todoCanCancel(done) || todoCanPause(done) || todoCanResume(done),
      ).toBe(false);
    }
  });

  it("edits only the user's repeating tasks", () => {
    expect(
      todoCanEdit(item({ createdBy: "user", repeat: { kind: "daily" } })),
    ).toBe(true);
    expect(todoCanEdit(item({ createdBy: "user" }))).toBe(false);
    expect(todoCanEdit(item({ repeat: { kind: "daily" } }))).toBe(false);
    expect(
      todoCanEdit(
        item({ createdBy: "agent", repeat: { kind: "weekly", weekdays: [1] } }),
      ),
    ).toBe(false);
  });

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
  });
});

describe("the list", () => {
  it("reads Core's one query", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockResolvedValueOnce(EMPTY_TODO);
    await expect(listAssistantTodo()).resolves.toEqual(EMPTY_TODO);
    expect(invoke).toHaveBeenCalledWith("list_assistant_todo");
  });

  it("is empty only with nothing in any group", () => {
    expect(todoIsEmpty(legacyTodoGroups(EMPTY_TODO))).toBe(true);
    expect(
      todoIsEmpty(
        legacyTodoGroups({ ...EMPTY_TODO, done: [item({ state: "fired" })] }),
      ),
    ).toBe(false);
  });

  it("draws its three groups from Core's four, to-dos left out", () => {
    const todo = item({
      kind: "todo",
      id: "todo_1",
      state: "open",
      at: undefined,
      target: undefined,
      repeat: undefined,
    });
    const sub = item({ kind: "subtask", id: "s-1", state: "running" });
    const late = item({ id: "sched_late", at: local(2026, 10, 20, 9, 0) });
    const paused = item({
      id: "sched_paused",
      state: "paused",
      at: local(2026, 10, 16, 22, 0),
    });
    const routine = item({
      id: "sched_daily",
      repeat: { kind: "daily" },
      at: local(2026, 10, 17, 8, 0),
    });
    const groups = legacyTodoGroups({
      ...EMPTY_TODO,
      yours: { today: [todo], later: [], anytime: [] },
      assistant: [sub, late, paused, item()],
      routine: [routine],
      done: [
        item({ kind: "todo", id: "todo_done", state: "done" }),
        item({ kind: "subtask", id: "s-done", state: "done" }),
      ],
      doneOmitted: 2,
    });
    expect(groups.upcoming.map((i) => i.id)).toEqual([
      "sched_1",
      "sched_daily",
      "sched_late",
      "sched_paused",
    ]);
    expect(groups.active.map((i) => i.id)).toEqual(["s-1"]);
    expect(groups.recent.map((i) => i.id)).toEqual(["s-done"]);
    expect(groups.recentOmitted).toBe(2);
    expect(todoStateLabel(todo, zh)).toBe("");
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
    expect(todoAutostartHintVisible(false, set)).toBe(true);
    expect(todoAutostartHintVisible(true, set)).toBe(false);
    expect(todoAutostartHintVisible(null, set)).toBe(false);
    expect(todoAutostartHintVisible(false, EMPTY_TODO)).toBe(false);
    const paused = { ...EMPTY_TODO, routine: [item({ state: "paused" })] };
    expect(todoAutostartHintVisible(false, paused)).toBe(false);
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
    expect(todoAutostartHintVisible(false, { ...EMPTY_TODO, yours })).toBe(
      true,
    );
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
