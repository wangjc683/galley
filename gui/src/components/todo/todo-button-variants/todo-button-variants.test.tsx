import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { todoCapsule, todoFirstRow } from "@/lib/todo-button";

import {
  DEFAULT_TODO_BUTTON_LOOK,
  DEMO_LONG_TITLE,
  TODO_BUTTON_DEMOS,
  readStoredTodoButtonLook,
  todoButtonDemo,
  todoButtonShape,
} from "./todo-button-variants";
import { TodoButtonVariantsPill } from "./TodoButtonVariantsPill";

/**
 * The top bar 待办 button's temporary switcher (main chat ticket 104,
 * PRD ruling 150): 戊 by default, what each look draws, the seven demos,
 * the look a wrapped localStorage read, and every place it touches
 * marked for the removal steps in todo-button-variants.ts. The marker is
 * spelt in two halves here so this file is not one of its own hits.
 * Today is Wednesday 28 October 2026 in whatever zone the run is in.
 */

const MARK = ["TEMP variant switcher", "(main chat 104)"].join(" ");
const TODAY = new Date(2026, 9, 28).getTime();

function storage(initial: Record<string, string> = {}, throws = false) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => {
      if (throws) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throws) throw new Error("blocked");
      data.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the looks (ruling 150 point 8)", () => {
  it("starts on 戊", () => {
    expect(DEFAULT_TODO_BUTTON_LOOK).toBe("E");
    expect(readStoredTodoButtonLook()).toBe("E");
  });

  it("甲 is the icon whatever there is", () => {
    for (const first of ["today", "later", "anytime", null] as const) {
      expect(todoButtonShape("A", first, false), String(first)).toBe("icon");
      expect(todoButtonShape("A", first, true), String(first)).toBe("icon");
    }
  });

  it("丁 writes the word until the panel was met at launch, then is 甲", () => {
    for (const first of ["today", "later", null] as const) {
      expect(todoButtonShape("D", first, false), String(first)).toBe("word");
      expect(todoButtonShape("D", first, true), String(first)).toBe("icon");
    }
  });

  it("戊2 is a capsule only for today's, 甲 when none of yours is today's, the word when you have none", () => {
    expect(todoButtonShape("E2", "today", true)).toBe("capsule");
    expect(todoButtonShape("E2", "later", true)).toBe("icon");
    expect(todoButtonShape("E2", "anytime", true)).toBe("icon");
    expect(todoButtonShape("E2", null, true)).toBe("word");
  });

  it("戊 is a capsule whenever you have things, the word when none", () => {
    for (const first of ["today", "later", "anytime"] as const) {
      expect(todoButtonShape("E", first, true), first).toBe("capsule");
    }
    expect(todoButtonShape("E", null, true)).toBe("word");
    // Neither 戊 reads the panel's launch flag.
    expect(todoButtonShape("E", null, false)).toBe("word");
    expect(todoButtonShape("E2", "later", false)).toBe("icon");
  });
});

describe("the demos (ruling 150 point 8)", () => {
  /** What the capsule writes for a demo, as 「时间 · 标题 +N」. */
  const says = (demo: (typeof TODO_BUTTON_DEMOS)[number]) => {
    const shown = todoButtonDemo(demo, TODAY);
    if (!shown) return null;
    const capsule = todoCapsule(
      shown.yours,
      shown.todayCount,
      TODAY,
      "zh-CN",
      zhCopy,
    );
    if (!capsule) return "（空）";
    return `${capsule.when} · ${capsule.title}${capsule.more ? ` +${capsule.more}` : ""}`;
  };

  it("show the ticket's seven states, 「真实」 the real list", () => {
    expect(TODO_BUTTON_DEMOS).toEqual([
      "real",
      "empty",
      "later",
      "today3",
      "overdue",
      "anytime",
      "long",
    ]);
    expect(says("real")).toBeNull();
    expect(says("empty")).toBe("（空）");
    expect(says("later")).toBe("周五 15:00 · 取快递");
    expect(says("today3")).toBe("今天 15:00 · 交周报 +2");
    expect(says("overdue")).toBe("逾期 2 天 · 交季度报告");
    expect(says("anytime")).toBe("随时 · 整理发票");
    expect(says("long")).toBe(`今天 15:00 · ${DEMO_LONG_TITLE}`);
    expect([...DEMO_LONG_TITLE]).toHaveLength(30);
  });

  it("put each first row in the group it stands for, today's count as Core counts", () => {
    const group = (demo: (typeof TODO_BUTTON_DEMOS)[number]) =>
      todoFirstRow(todoButtonDemo(demo, TODAY)!.yours)?.group ?? null;
    expect(group("empty")).toBeNull();
    expect(group("later")).toBe("later");
    expect(group("today3")).toBe("today");
    expect(group("overdue")).toBe("today");
    expect(group("anytime")).toBe("anytime");
    expect(group("long")).toBe("today");
    for (const demo of TODO_BUTTON_DEMOS.slice(1)) {
      const shown = todoButtonDemo(demo, TODAY)!;
      expect(shown.todayCount, demo).toBe(shown.yours.today.length);
    }
  });
});

describe("the look's memory", () => {
  it("reads the stored look, and falls back on anything else", () => {
    vi.stubGlobal("window", {
      localStorage: storage({
        "galley.tmp.todoButtonCapsule": JSON.stringify({ look: "D" }),
      }),
    });
    expect(readStoredTodoButtonLook()).toBe("D");
    vi.stubGlobal("window", {
      localStorage: storage({
        // Ticket 103's key and look are not read.
        "galley.tmp.todoButtonPlace": JSON.stringify({ look: "B" }),
        "galley.tmp.todoButtonCapsule": JSON.stringify({ look: "B" }),
      }),
    });
    expect(readStoredTodoButtonLook()).toBe("E");
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoButtonCapsule": "{" }),
    });
    expect(readStoredTodoButtonLook()).toBe("E");
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    expect(readStoredTodoButtonLook()).toBe("E");
  });

  it("renders nothing without a document (static rendering)", () => {
    expect(renderToStaticMarkup(<TodoButtonVariantsPill />)).toBe("");
  });

  it("is marked wherever it touches, for its removal", () => {
    const src = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          readFileSync(file, "utf8").includes(MARK)
        ) {
          hits.push(path.relative(src, file));
        }
      }
    };
    walk(src);
    expect(hits.sort()).toEqual([
      "App.tsx",
      "components/layout/MainHeader.tsx",
      "components/layout/MainHeaderHost.sop.test.tsx",
      "components/layout/MainHeaderHost.todo.test.tsx",
      "components/layout/header/TodoToggleButton.dom.test.tsx",
      "components/layout/header/TodoToggleButton.test.tsx",
      "components/layout/header/TodoToggleButton.tsx",
      "components/todo/todo-button-variants/TodoButtonVariantsPill.tsx",
      "components/todo/todo-button-variants/todo-button-variants.ts",
      "lib/todo-flight-run.test.ts",
      "lib/todo-flight-run.ts",
    ]);
    // Tickets 102's and 103's switchers are gone.
    const old = ["TEMP variant switcher", "(main chat 10"].join(" ");
    const left: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) scan(file);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(file, "utf8");
          if (text.includes(`${old}2)`) || text.includes(`${old}3)`)) {
            left.push(path.relative(src, file));
          }
        }
      }
    };
    scan(src);
    expect(left).toEqual([]);
  });
});
