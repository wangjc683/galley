import { describe, expect, it } from "vitest";

import type { TodoItem } from "@/lib/assistant-todo";
import { reminderFirstLine, todoItemWords } from "@/lib/reminder-first-line";

/**
 * The first line of a scheduled task's words, what the reminder card, the
 * panel's rows, 「说说这件」 and an undelivered reminder's notification
 * show (main chat ticket 105, PRD ruling 151).
 */

const NEW_STYLE =
  "给妈妈打电话\n\n用户周五说的，周日晚上打；到时问问爸爸的体检结果。";

describe("reminderFirstLine", () => {
  it("takes the line for the user, not the notes after the blank line", () => {
    expect(reminderFirstLine(NEW_STYLE)).toBe("给妈妈打电话");
  });

  it("leaves words with no line break whole: a reminder set before reads as it did", () => {
    expect(
      reminderFirstLine(
        "提醒用户：该喝水了。用户在主聊天要求三分钟后提醒喝水。",
      ),
    ).toBe("提醒用户：该喝水了。用户在主聊天要求三分钟后提醒喝水。");
  });

  it("skips blank lines before it and trims it", () => {
    expect(reminderFirstLine("\n  \n  该喝水了  \n\n到时简短提醒。")).toBe(
      "该喝水了",
    );
    expect(reminderFirstLine("  订上海的酒店  ")).toBe("订上海的酒店");
  });

  it("splits at any line break: \\r\\n, \\r and \\n", () => {
    expect(reminderFirstLine("关火\r\n\r\n半小时后")).toBe("关火");
    expect(reminderFirstLine("关火\r半小时后")).toBe("关火");
    expect(reminderFirstLine("关火\n半小时后")).toBe("关火");
  });

  it("is empty for empty or blank words", () => {
    expect(reminderFirstLine("")).toBe("");
    expect(reminderFirstLine(" \n\t\n ")).toBe("");
  });
});

describe("todoItemWords", () => {
  const base = { state: "scheduled", createdBy: "assistant" } as const;

  it("a task: its first line", () => {
    const task: TodoItem = {
      ...base,
      kind: "task",
      id: "sched_1",
      text: NEW_STYLE,
    };
    expect(todoItemWords(task)).toBe("给妈妈打电话");
  });

  it("a to-do's title and a subtask's, as they are", () => {
    const todo: TodoItem = {
      ...base,
      kind: "todo",
      id: "todo_1",
      state: "open",
      text: "交季度报告\n第二行",
    };
    const subtask: TodoItem = {
      ...base,
      kind: "subtask",
      id: "s-sub",
      state: "running",
      text: "查机票\n第二行",
    };
    expect(todoItemWords(todo)).toBe("交季度报告\n第二行");
    expect(todoItemWords(subtask)).toBe("查机票\n第二行");
  });
});
