import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TODO_BUTTON_LOOK,
  readStoredTodoButtonLook,
  todoButtonApart,
  todoButtonCount,
  todoButtonWord,
} from "./todo-button-variants";
import { TodoButtonVariantsPill } from "./TodoButtonVariantsPill";

/**
 * The top bar 待办 button's temporary switcher (main chat ticket 103):
 * 乙 by default (the main session's pick), what each look changes, the
 * demo counts, the place a wrapped localStorage read, and every place it
 * touches marked for the removal steps in todo-button-variants.ts. The
 * marker is spelt in two halves here so this file is not one of its own
 * hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 103)"].join(" ");

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

describe("the top bar 待办 button's switcher", () => {
  it("starts on 乙", () => {
    expect(DEFAULT_TODO_BUTTON_LOOK).toBe("B");
    expect(readStoredTodoButtonLook()).toBe("B");
  });

  it("moves it from 甲 on, writes the word at 乙 and 丙", () => {
    expect(
      ["now", "A", "B", "C"].map((l) => todoButtonApart(l as never)),
    ).toEqual([false, true, true, true]);
    expect(
      ["now", "A", "B", "C"].map((l) => todoButtonWord(l as never)),
    ).toEqual([false, false, true, true]);
  });

  it("shows the demo's count, or the real one", () => {
    expect(todoButtonCount("two", 5)).toBe(2);
    expect(todoButtonCount("none", 5)).toBe(0);
    expect(todoButtonCount("real", 5)).toBe(5);
  });

  it("reads the stored place, and falls back on anything else", () => {
    vi.stubGlobal("window", {
      localStorage: storage({
        "galley.tmp.todoButtonPlace": JSON.stringify({ look: "C" }),
      }),
    });
    expect(readStoredTodoButtonLook()).toBe("C");
    vi.stubGlobal("window", {
      localStorage: storage({
        "galley.tmp.todoButtonPlace": JSON.stringify({ look: "D2" }),
      }),
    });
    expect(readStoredTodoButtonLook()).toBe("B");
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoButtonPlace": "{" }),
    });
    expect(readStoredTodoButtonLook()).toBe("B");
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    expect(readStoredTodoButtonLook()).toBe("B");
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
      "components/layout/header/TodoToggleButton.test.tsx",
      "components/layout/header/TodoToggleButton.tsx",
      "components/layout/header/UtilityCluster.tsx",
      "components/todo/todo-button-variants/TodoButtonVariantsPill.tsx",
      "components/todo/todo-button-variants/todo-button-variants.ts",
    ]);
  });
});
