import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TODO_GLIDE_STYLE,
  readTodoGlideTiming,
  todoCountNext,
  todoCountSettle,
  todoCountStart,
  todoWidthGlides,
} from "@/lib/todo-button-motion";

/*
 * The top bar's 「待办」 button when today's count changes (main chat
 * ticket 162, PRD ruling 208 point 4). The page side is in
 * components/layout/header/TodoToggleButton.motion.dom.test.tsx.
 */

/** A capsule's words. */
const ROW = (title: string, more = 0) => ({
  when: "今天 15:00",
  tone: "muted" as const,
  title,
  more,
});

describe("the number's tick", () => {
  it("does not tick at mount", () => {
    expect(todoCountStart(3, "capsule", ROW("交周报", 2))).toEqual({
      count: 3,
      shape: "capsule",
      capsule: ROW("交周报", 2),
      ticks: 0,
      leaving: null,
    });
  });

  it("ticks on every change of N, more, fewer or from none, one more key each time", () => {
    let m = todoCountStart(null, "icon");
    m = todoCountNext(m, 1, "capsule", ROW("a"), true);
    expect(m).toMatchObject({ count: 1, ticks: 1, leaving: null });
    m = todoCountNext(m, 2, "capsule", ROW("a", 1), true);
    expect(m.ticks).toBe(2);
    m = todoCountNext(m, 1, "capsule", ROW("b"), true);
    expect(m.ticks).toBe(3);
    // 9 → 10, a digit more.
    m = todoCountNext(
      todoCountNext(m, 9, "icon", null, true),
      10,
      "icon",
      null,
      true,
    );
    expect(m).toMatchObject({ count: 10, ticks: 5 });
  });

  it("is the same motion when nothing changed, and a new look or new words alone do not tick", () => {
    const m = todoCountNext(
      todoCountStart(null, "word"),
      2,
      "word",
      null,
      true,
    );
    expect(todoCountNext(m, 2, "word", null, true)).toBe(m);
    const looked = todoCountNext(m, 2, "capsule", ROW("a", 1), true);
    expect(looked).toEqual({ ...m, shape: "capsule", capsule: ROW("a", 1) });
    // The same words in a new object: the same motion.
    expect(todoCountNext(looked, 2, "capsule", ROW("a", 1), true)).toBe(looked);
    // New words alone: kept, nothing ticks, nothing leaves.
    const renamed = todoCountNext(looked, 2, "capsule", ROW("b", 1), true);
    expect(renamed).toEqual({ ...looked, capsule: ROW("b", 1) });
  });
});

describe("a number that goes", () => {
  it("stays to leave while the width glides, with its key, folded if it was the capsule's", () => {
    const m = todoCountNext(todoCountStart(1, "icon"), 2, "icon", null, true);
    const gone = todoCountNext(m, null, "icon", null, true);
    expect(gone).toEqual({
      count: null,
      shape: "icon",
      capsule: null,
      ticks: m.ticks,
      leaving: { count: 2, folded: false, capsule: null },
    });
    // The capsule hides its number while its body shows: so does the
    // one that leaves it.
    const capsule = todoCountStart(1, "capsule", ROW("交周报"));
    expect(
      todoCountNext(capsule, null, "word", null, true).leaving,
    ).toMatchObject({ count: 1, folded: true });
  });

  it("goes at once without a glide (reduced motion, no Web Animations)", () => {
    const gone = todoCountNext(
      todoCountStart(4, "icon"),
      null,
      "icon",
      null,
      false,
    );
    expect(gone.leaving).toBeNull();
    expect(gone.count).toBeNull();
  });

  it("is dropped when a count comes back, which ticks in a new element", () => {
    const gone = todoCountNext(
      todoCountStart(1, "icon"),
      null,
      "icon",
      null,
      true,
    );
    const back = todoCountNext(gone, 1, "icon", null, true);
    expect(back).toMatchObject({ count: 1, ticks: 1, leaving: null });
  });

  it("is dropped once the glide is over; settling with nothing leaving changes nothing", () => {
    const gone = todoCountNext(
      todoCountStart(1, "icon"),
      null,
      "icon",
      null,
      true,
    );
    expect(todoCountSettle(gone).leaving).toBeNull();
    const rest = todoCountStart(2, "icon");
    expect(todoCountSettle(rest)).toBe(rest);
  });
});

describe("a capsule that goes", () => {
  it("stays to leave with the words it last drew when the button stops being one, to the icon or the word", () => {
    let m = todoCountStart(2, "capsule", ROW("交周报", 1));
    // Its words changed since mount: those are the ones that leave.
    m = todoCountNext(m, 2, "capsule", ROW("回邮件", 1), true);
    for (const look of ["icon", "word"] as const) {
      const gone = todoCountNext(m, null, look, null, true);
      expect(gone.leaving, look).toEqual({
        count: 2,
        folded: true,
        capsule: ROW("回邮件", 1),
      });
    }
  });

  it("leaves nothing for a capsule to a capsule: the next row is drawn at once", () => {
    const m = todoCountStart(2, "capsule", ROW("交周报", 1));
    expect(todoCountNext(m, 1, "capsule", ROW("回邮件"), true).leaving).toBe(
      null,
    );
  });

  it("goes at once without a glide, and is dropped when the capsule comes back", () => {
    const m = todoCountStart(1, "capsule", ROW("交周报"));
    expect(todoCountNext(m, null, "icon", null, false).leaving).toBeNull();
    const gone = todoCountNext(m, null, "icon", null, true);
    const back = todoCountNext(gone, 1, "capsule", ROW("交周报"), true);
    expect(back.leaving).toBeNull();
    // A new look on the way keeps it leaving.
    const worded = todoCountNext(gone, null, "word", null, true);
    expect(worded.leaving?.capsule).toEqual(ROW("交周报"));
  });
});

describe("the width's glide", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubTokens(tokens: Record<string, string>) {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => tokens[name] ?? "",
    }));
  }

  it("glides on a change of half a pixel or more, and not where a width was not laid out", () => {
    expect(todoWidthGlides(40, 28)).toBe(true);
    expect(todoWidthGlides(28, 47.6)).toBe(true);
    expect(todoWidthGlides(40, 40.3)).toBe(false);
    expect(todoWidthGlides(null, 28)).toBe(false);
    expect(todoWidthGlides(40, null)).toBe(false);
  });

  it("keeps the icon 6px in and the words on one line, cut and not squeezed", () => {
    expect(TODO_GLIDE_STYLE).toEqual({
      position: "relative",
      overflow: "hidden",
      "white-space": "nowrap",
      "justify-content": "flex-start",
      "padding-left": "5px",
      "column-gap": "4px",
    });
  });

  it("reads --motion-base and --ease-firm off the page", () => {
    stubTokens({
      "--motion-base": " 160ms",
      "--ease-firm": " cubic-bezier(0.2, 0, 0, 1)",
    });
    expect(readTodoGlideTiming()).toEqual({
      durationMs: 160,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  });

  it("is null when a token cannot be read: the width is where it ends up at once", () => {
    stubTokens({ "--motion-base": "160ms" });
    expect(readTodoGlideTiming()).toBeNull();
    stubTokens({ "--ease-firm": "cubic-bezier(0.2, 0, 0, 1)" });
    expect(readTodoGlideTiming()).toBeNull();
  });
});
