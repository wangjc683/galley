import { describe, expect, it } from "vitest";

import type { TodoItem, TodoState } from "@/lib/assistant-todo";

import {
  NO_SIDEBAR_SUBTASKS,
  SIDEBAR_SUBTASK_ROWS,
  sidebarSubtasks,
  subtaskNeedsYou,
} from "./sidebar-subtasks";

/**
 * The subtasks under Galley's card (main chat ticket 128, PRD ruling
 * 176): the panel's 「Galley 在办」 subtasks, what needs you first and
 * all of it, then at most five more by start time, the rest behind
 * 「还有 N 件在办」.
 */

const item = (
  id: string,
  state: TodoState,
  extra: Partial<TodoItem> = {},
): TodoItem => ({
  kind: "subtask",
  id,
  text: `words-${id}`,
  state,
  createdBy: "assistant",
  ...extra,
});

/** A subtask session started `minute` minutes past 09:00. */
const session = (id: string, minute: number, title = `title-${id}`) => ({
  id,
  title,
  createdAt: new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString(),
});

const ids = (list: { rows: { id: string }[] }) => list.rows.map((r) => r.id);

describe("which subtasks", () => {
  it("lists nothing, the same empty value, when there is nothing", () => {
    expect(sidebarSubtasks([], [])).toBe(NO_SIDEBAR_SUBTASKS);
    expect(sidebarSubtasks([], [session("a", 1)])).toBe(NO_SIDEBAR_SUBTASKS);
    // A subtask session with no entry in Galley's group (done, or
    // dropped after seven quiet days) is not listed either.
    expect(sidebarSubtasks([item("b", "running")], [session("a", 1)])).toBe(
      NO_SIDEBAR_SUBTASKS,
    );
  });

  it("takes the subtasks of Galley's group and leaves its one-off tasks", () => {
    const list = sidebarSubtasks(
      [
        item("a", "running"),
        { ...item("sched_1", "scheduled"), kind: "task" },
        item("b", "stopped"),
      ],
      [session("a", 1), session("b", 2), session("sched_1", 0)],
    );
    expect(ids(list)).toEqual(["a", "b"]);
    expect(list.more).toEqual([]);
  });

  it("leaves out one the sidebar no longer has as an unpromoted subtask", () => {
    // Promoted or archived a moment before the list is read again: it
    // is not listed twice, nor after it is gone.
    const list = sidebarSubtasks(
      [item("a", "running"), item("gone", "asking")],
      [session("a", 1)],
    );
    expect(ids(list)).toEqual(["a"]);
  });

  it("titles a row with its session's title as it stands, else the list's words", () => {
    const list = sidebarSubtasks(
      [
        item("a", "running"),
        item("b", "running"),
        item("c", "running", { text: "" }),
      ],
      [session("a", 1, "整理发票"), session("b", 2, "  "), session("c", 3, "")],
    );
    expect(list.rows.map((r) => r.title)).toEqual([
      "整理发票",
      "words-b",
      // Nothing either way: the row says 「子任务」.
      "",
    ]);
  });
});

describe("in what order, and how many", () => {
  it("puts what needs you first, then the rest, each by start time", () => {
    // The panel's order is the latest activity first; the sidebar's is
    // when each started, the first on top.
    const list = sidebarSubtasks(
      [
        item("late-run", "running"),
        item("late-ask", "asking"),
        item("early-run", "running"),
        item("early-fail", "failed"),
        item("cap", "step_limit"),
      ],
      [
        session("late-run", 40),
        session("late-ask", 30),
        session("early-run", 10),
        session("early-fail", 20),
        session("cap", 5),
      ],
    );
    expect(ids(list)).toEqual([
      "early-fail",
      "late-ask",
      "cap",
      "early-run",
      "late-run",
    ]);
  });

  it("keeps the panel's order on a tie", () => {
    const list = sidebarSubtasks(
      [item("b", "running"), item("a", "running")],
      [session("a", 1), session("b", 1)],
    );
    expect(ids(list)).toEqual(["b", "a"]);
  });

  it("shows at most five that do not need you; the rest behind one row, in order", () => {
    const running = Array.from({ length: 8 }, (_, i) =>
      item(`r${i}`, i % 2 ? "running" : "stopped"),
    );
    const list = sidebarSubtasks(
      [...running, item("ask", "asking")],
      [...running.map((r, i) => session(r.id, 10 + i)), session("ask", 30)],
    );
    expect(SIDEBAR_SUBTASK_ROWS).toBe(5);
    expect(ids(list)).toEqual(["ask", "r0", "r1", "r2", "r3", "r4"]);
    expect(list.more).toEqual(["r5", "r6", "r7"]);
  });

  it("never folds what needs you, however many", () => {
    const asking = Array.from({ length: 7 }, (_, i) =>
      item(`q${i}`, i % 3 ? "asking" : "failed"),
    );
    const list = sidebarSubtasks(
      [...asking, item("run", "running")],
      [...asking.map((q, i) => session(q.id, i)), session("run", 1)],
    );
    expect(ids(list)).toEqual([
      "q0",
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
      "run",
    ]);
    expect(list.more).toEqual([]);
  });

  it("lists exactly five without the extra row", () => {
    const five = Array.from({ length: 5 }, (_, i) => item(`r${i}`, "running"));
    const list = sidebarSubtasks(
      five,
      five.map((r, i) => session(r.id, i)),
    );
    expect(list.rows).toHaveLength(5);
    expect(list.more).toEqual([]);
  });
});

describe("what needs you", () => {
  it("is a question or a failure; running and the two stops are not", () => {
    expect(subtaskNeedsYou("asking")).toBe(true);
    expect(subtaskNeedsYou("failed")).toBe(true);
    for (const state of ["running", "step_limit", "stopped"] as const) {
      expect(subtaskNeedsYou(state)).toBe(false);
    }
  });
});
