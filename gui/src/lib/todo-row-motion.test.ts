import { describe, expect, it } from "vitest";

import { SCROLL_ANIMATED_MAX_PX } from "@/lib/animate-scroll";
import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import type { BubbleMotionTiming } from "@/lib/bubble-motion";
import {
  todoEnterFade,
  todoRowMotionMode,
  todoRowOrder,
  todoRowsChanged,
  todoRowsPlan,
  todoRowsTiming,
  type TodoBlockBox,
  type TodoBlockSeen,
  type TodoRowMotionMode,
} from "@/lib/todo-row-motion";

/*
 * The rules of the to-do panel's rows leaving and closing up (main chat
 * PRD ruling 208 point 3, ticket 161): which list changes play, which
 * block leaves, stays or comes, by how much, on which tokens. Boxes are
 * fed in by hand (jsdom does not lay out): px below the list's top.
 */

function todo(id: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    ...extra,
  };
}
function task(id: string): TodoItem {
  return { kind: "task", id, text: id, state: "open", createdBy: "assistant" };
}
const list = (
  yours: TodoItem[],
  done: TodoItem[] = [],
  assistant: TodoItem[] = [],
): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
  assistant,
  done,
});

const A = todo("todo_a");
const B = todo("todo_b");
const C = todo("todo_c");

const TIMING: BubbleMotionTiming = {
  fastMs: 120,
  baseMs: 160,
  slowMs: 240,
  pop: "cubic-bezier(0.16, 1, 0.3, 1)",
  firm: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
};

/** Rows of 51px stacked from the list's top, 8px down: the boxes of
 * `keys` in order. */
function stack(
  keys: string[],
  { top = 8, height = 51 }: { top?: number; height?: number } = {},
): Map<string, TodoBlockBox> {
  return new Map(
    keys.map((key, at) => [key, { top: top + at * height, height }]),
  );
}
function seen(boxes: Map<string, TodoBlockBox>): Map<string, TodoBlockSeen> {
  return new Map([...boxes].map(([key, box]) => [key, { ...box, opacity: 1 }]));
}

describe("todoRowMotionMode", () => {
  it("only fades under reduced motion", () => {
    expect(todoRowMotionMode(false)).toBe("move");
    expect(todoRowMotionMode(true)).toBe("fade");
  });
});

describe("todoRowOrder: what counts as a new list", () => {
  it("is the same for the same rows in a fresh read", () => {
    expect(todoRowOrder(list([A, B]), [])).toBe(
      todoRowOrder(list([{ ...A }, { ...B }]), []),
    );
  });

  it("does not change with a row's words, time or notes", () => {
    expect(
      todoRowOrder(list([{ ...A, text: "交周报", notes: "王老师" }, B]), []),
    ).toBe(todoRowOrder(list([A, B]), []));
  });

  it("changes when a row leaves, comes, or moves", () => {
    const before = todoRowOrder(list([A, B, C]), []);
    expect(todoRowOrder(list([A, C]), [])).not.toBe(before);
    expect(todoRowOrder(list([A, B, C, todo("todo_d")]), [])).not.toBe(before);
    expect(todoRowOrder(list([B, A, C]), [])).not.toBe(before);
  });

  it("tells a row in your to-dos from the same in 已完成", () => {
    const ticked = { ...B, state: "done" as const };
    expect(todoRowOrder(list([A, C], [ticked]), [])).not.toBe(
      todoRowOrder(list([A, B, C]), []),
    );
  });

  it("keeps Galley's tick where it stood while it holds, and changes when it goes", () => {
    const ticked = { ...B, state: "done" as const };
    const fresh = list([A, C], [ticked]);
    const hold = { item: B, following: ["todo_c"] };
    // Held: drawn where it was, not in 已完成 yet — the same list.
    expect(todoRowOrder(fresh, [hold])).toBe(todoRowOrder(list([A, B, C]), []));
    // Let go: to 已完成.
    expect(todoRowOrder(fresh, [])).not.toBe(todoRowOrder(fresh, [hold]));
  });

  it("names the group a row is in", () => {
    expect(todoRowOrder(list([], [], [task("sched_x")]), [])).not.toBe(
      todoRowOrder(list([], [task("sched_x")]), []),
    );
  });
});

describe("todoRowsChanged", () => {
  it("plays only from a list the panel showed to another", () => {
    expect(todoRowsChanged("a", "b")).toBe(true);
    expect(todoRowsChanged("a", "a")).toBe(false);
    // Mounting, the first read, back from 备忘: nothing to move from.
    expect(todoRowsChanged(null, "a")).toBe(false);
    // To 备忘, or before a read: nothing drawn to move.
    expect(todoRowsChanged("a", null)).toBe(false);
  });
});

describe("todoRowsTiming", () => {
  it("fades what leaves, slides what stays, fades in what comes after the others made room", () => {
    expect(todoRowsTiming(TIMING, "move")).toEqual({
      leave: { durationMs: 160, delayMs: 0, easing: TIMING.exit },
      shift: { durationMs: 240, easing: TIMING.firm },
      enter: { durationMs: 160, delayMs: 120, easing: TIMING.pop },
    });
  });

  it("under reduced motion nothing slides, so what comes does not wait", () => {
    expect(todoRowsTiming(TIMING, "fade").enter.delayMs).toBe(0);
  });

  it("goes on at once with a fade-in part way", () => {
    const enter = todoRowsTiming(TIMING, "move").enter;
    expect(todoEnterFade(enter, 0)).toBe(enter);
    expect(todoEnterFade(enter, 0.4)).toEqual({ ...enter, delayMs: 0 });
  });
});

describe("todoRowsPlan", () => {
  const plan = (
    before: Map<string, TodoBlockSeen>,
    after: Map<string, TodoBlockBox>,
    {
      viewportHeight = 600,
      mode = "move",
    }: { viewportHeight?: number; mode?: TodoRowMotionMode } = {},
  ) => todoRowsPlan({ before, after, viewportHeight, mode });

  it("one row leaves: a copy where it stood, the rows under it close up by its height", () => {
    const moves = plan(
      seen(stack(["a", "b", "c", "d"])),
      stack(["a", "c", "d"]),
    );
    expect(moves.leaving).toEqual([["b", 1]]);
    expect(moves.shifts).toEqual([
      ["c", 51],
      ["d", 51],
    ]);
    expect(moves.entering).toEqual([]);
  });

  it("two leave at once: each row under them by what left above it", () => {
    const moves = plan(seen(stack(["a", "b", "c", "d"])), stack(["b", "d"]));
    expect(moves.leaving).toEqual([
      ["a", 1],
      ["c", 1],
    ]);
    expect(moves.shifts).toEqual([
      ["b", 51],
      ["d", 102],
    ]);
  });

  it("one put back: it fades in at its place, the rows under it make room", () => {
    const moves = plan(seen(stack(["a", "c"])), stack(["a", "b", "c"]));
    expect(moves.entering).toEqual([["b", 0]]);
    expect(moves.shifts).toEqual([["c", -51]]);
    expect(moves.leaving).toEqual([]);
  });

  it("a row moved: it and the rows it passed slide by the real distance", () => {
    const moves = plan(seen(stack(["a", "b", "c"])), stack(["c", "a", "b"]));
    expect(moves.shifts).toEqual([
      ["c", 102],
      ["a", -51],
      ["b", -51],
    ]);
    expect(moves.entering).toEqual([]);
    expect(moves.leaving).toEqual([]);
  });

  it("a taller row: the distance is its height, not a row's", () => {
    const before = seen(
      new Map([
        ["a", { top: 8, height: 140 }],
        ["b", { top: 148, height: 51 }],
      ]),
    );
    const moves = plan(before, new Map([["b", { top: 8, height: 51 }]]));
    expect(moves.shifts).toEqual([["b", 140]]);
  });

  it("moves nothing out of view", () => {
    // A 200px view: rows from 8 to 263; the fifth starts at 212.
    const before = seen(stack(["a", "b", "c", "d", "e", "f"]));
    const moves = plan(before, stack(["b", "c", "d", "e", "f"]), {
      viewportHeight: 200,
    });
    // b, c, d come up into or within the view; e (from 212 to 161) comes
    // into it; f stays below it (263 to 212).
    expect(moves.shifts.map(([key]) => key)).toEqual(["b", "c", "d", "e"]);
    const out = plan(
      seen(stack(["x", "a"], { top: 400 })),
      stack(["a"], { top: 400 }),
      {
        viewportHeight: 200,
      },
    );
    expect(out).toEqual({ shifts: [], entering: [], leaving: [] });
  });

  it("a row taken back by the scroll (a shorter list at its end): what stood above slides down to where the browser left it", () => {
    // Scrolled to the end: the last row leaves, the browser takes 51px of
    // scroll back, everything above is drawn 51px lower.
    const before = seen(stack(["a", "b", "c"], { top: -2 }));
    const after = stack(["a", "b"], { top: 49 });
    const moves = plan(before, after);
    expect(moves.shifts).toEqual([
      ["a", -51],
      ["b", -51],
    ]);
    expect(moves.leaving).toEqual([["c", 1]]);
  });

  it("does not slide what moved farther than a scroll animates", () => {
    const before = seen(
      new Map([
        ["a", { top: 8, height: SCROLL_ANIMATED_MAX_PX + 10 }],
        ["b", { top: 18 + SCROLL_ANIMATED_MAX_PX, height: 51 }],
      ]),
    );
    const moves = plan(before, new Map([["b", { top: 8, height: 51 }]]), {
      viewportHeight: 2000,
    });
    expect(moves.shifts).toEqual([]);
  });

  it("goes on from where things are seen mid-way", () => {
    // c was sliding up and seen 25.5px below its place; b was fading in,
    // at 0.4.
    const before = new Map<string, TodoBlockSeen>([
      ["a", { top: 8, height: 51, opacity: 1 }],
      ["b", { top: 59, height: 51, opacity: 0.4 }],
      ["c", { top: 135.5, height: 51, opacity: 1 }],
    ]);
    const moves = plan(before, stack(["b", "c"]));
    expect(moves.leaving).toEqual([["a", 1]]);
    expect(moves.shifts).toEqual([
      ["b", 51],
      ["c", 76.5],
    ]);
    expect(moves.entering).toEqual([["b", 0.4]]);
    // A copy leaves from how far it had faded in.
    const gone = plan(before, stack(["a", "c"]));
    expect(gone.leaving).toEqual([["b", 0.4]]);
  });

  it("under reduced motion only fades: nothing slides", () => {
    const moves = plan(seen(stack(["a", "b", "c"])), stack(["c", "d"]), {
      mode: "fade",
    });
    expect(moves.shifts).toEqual([]);
    expect(moves.leaving).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(moves.entering).toEqual([["d", 0]]);
  });
});
