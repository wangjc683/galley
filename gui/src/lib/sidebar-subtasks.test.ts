import { describe, expect, it } from "vitest";

import type { TodoItem, TodoState } from "@/lib/assistant-todo";

import {
  NO_SIDEBAR_SUBTASKS,
  SIDEBAR_SUBTASK_ROWS,
  sidebarSubtaskRowsShown,
  sidebarSubtasks,
  subtaskNeedsYou,
} from "./sidebar-subtasks";

/**
 * The subtasks under Galley's card (main chat ticket 128, PRD rulings
 * 176, 177): of Core's 「Galley 在办」 subtasks (the panel draws none
 * since ruling 197), those asking you, first and all of them, then at
 * most five running by start time, the rest behind 「还有 N 件在办」,
 * which unfolds them in place. Failed, out of steps or stopped: not
 * listed.
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

  // Ruling 177, correcting 176 point 2: a failure and a step limit were
  // reported to Galley, a stop was yours or a restart's; none is in hand.
  it("lists only what runs or asks you: failed, out of steps and stopped leave at once", () => {
    const list = sidebarSubtasks(
      [
        item("run", "running"),
        item("ask", "asking"),
        item("fail", "failed"),
        item("cap", "step_limit"),
        item("stop", "stopped"),
      ],
      [
        session("run", 1),
        session("ask", 2),
        session("fail", 3),
        session("cap", 4),
        session("stop", 5),
      ],
    );
    expect(ids(list)).toEqual(["ask", "run"]);
    expect(list.more).toEqual([]);
    // Nothing but those: nothing at all.
    expect(
      sidebarSubtasks(
        [item("fail", "failed"), item("stop", "stopped")],
        [session("fail", 1), session("stop", 2)],
      ),
    ).toBe(NO_SIDEBAR_SUBTASKS);
  });

  it("takes the subtasks of Galley's group and leaves its one-off tasks", () => {
    const list = sidebarSubtasks(
      [
        item("a", "running"),
        { ...item("sched_1", "running"), kind: "task" },
        item("b", "asking"),
      ],
      [session("a", 1), session("b", 2), session("sched_1", 0)],
    );
    expect(ids(list)).toEqual(["b", "a"]);
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
  it("puts what asks you first, then what runs, each by start time", () => {
    // The panel's order is the latest activity first; the sidebar's is
    // when each started, the first on top.
    const list = sidebarSubtasks(
      [
        item("late-run", "running"),
        item("late-ask", "asking"),
        item("early-run", "running"),
        item("early-ask", "asking"),
      ],
      [
        session("late-run", 40),
        session("late-ask", 30),
        session("early-run", 10),
        session("early-ask", 20),
      ],
    );
    expect(ids(list)).toEqual([
      "early-ask",
      "late-ask",
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

  it("shows at most five running; the rest behind one row, in order", () => {
    const running = Array.from({ length: 8 }, (_, i) =>
      item(`r${i}`, "running"),
    );
    const list = sidebarSubtasks(
      [...running, item("ask", "asking")],
      [...running.map((r, i) => session(r.id, 10 + i)), session("ask", 30)],
    );
    expect(SIDEBAR_SUBTASK_ROWS).toBe(5);
    expect(ids(list)).toEqual(["ask", "r0", "r1", "r2", "r3", "r4"]);
    expect(list.more.map((row) => row.id)).toEqual(["r5", "r6", "r7"]);
    // Rows as the others: its title, its state.
    expect(list.more[0]).toEqual({
      id: "r5",
      title: "title-r5",
      state: "running",
    });
  });

  // Ruling 197 point 4: 「还有 N 件在办」 unfolds them in place.
  it("draws the folded ones after the rest while unfolded", () => {
    const running = Array.from({ length: 7 }, (_, i) =>
      item(`r${i}`, "running"),
    );
    const list = sidebarSubtasks(
      [...running, item("ask", "asking")],
      [...running.map((r, i) => session(r.id, 10 + i)), session("ask", 30)],
    );
    const shown = (unfolded: boolean) =>
      sidebarSubtaskRowsShown(list, unfolded).map((row) => row.id);
    expect(shown(false)).toEqual(["ask", "r0", "r1", "r2", "r3", "r4"]);
    expect(shown(true)).toEqual([
      "ask",
      "r0",
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
    ]);
    // Nothing folded: the same rows, unfolded or not.
    const few = sidebarSubtasks([item("r0", "running")], [session("r0", 1)]);
    expect(sidebarSubtaskRowsShown(few, true)).toBe(few.rows);
  });

  // Ruling 177 point 1: subtasks stopped days ago used to take the five
  // places by their early start and fold the one just sent off behind
  // 「还有 N 件在办」.
  it("never lets old stopped ones push what runs behind the extra row", () => {
    const stopped = Array.from({ length: 6 }, (_, i) =>
      item(`old${i}`, i % 2 ? "stopped" : "step_limit"),
    );
    const list = sidebarSubtasks(
      [item("fresh", "running"), ...stopped, item("broke", "failed")],
      [
        ...stopped.map((s, i) => session(s.id, i)),
        session("broke", 7),
        session("fresh", 50),
      ],
    );
    expect(ids(list)).toEqual(["fresh"]);
    expect(list.more).toEqual([]);
  });

  it("never folds what asks you, however many", () => {
    const asking = Array.from({ length: 7 }, (_, i) => item(`q${i}`, "asking"));
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

  it("lists exactly five running without the extra row", () => {
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
  it("is a question alone: a failure is Galley's business (ruling 177)", () => {
    expect(subtaskNeedsYou("asking")).toBe(true);
    for (const state of [
      "failed",
      "running",
      "step_limit",
      "stopped",
    ] as const) {
      expect(subtaskNeedsYou(state)).toBe(false);
    }
  });
});
