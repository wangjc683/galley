import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TODO_BUTTON_VARIANT,
  readStoredTodoButtonVariant,
  TODO_BUTTON_VARIANTS,
} from "./todo-button-variant";
import { TodoButtonVariantPill } from "./TodoButtonVariantPill";

/**
 * The 待办 button's temporary switcher (main chat ticket 45, ruling 93
 * point 6): the most restrained form is the default, the choice is a
 * wrapped localStorage read, and every place it touches is where the
 * removal steps in todo-button-variant.ts say. Ticket 42's A / B / C
 * switcher is gone. The markers are spelt in halves here so this file
 * is not one of its own hits.
 */

const MARK = ["TEMP variant switcher", "(main-chat 45)"].join(" ");
const OLD_MARK = ["TEMP variant switcher", "(main chat 42)"].join(" ");

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

function sources(): Map<string, string> {
  const root = path.resolve(__dirname, "../../..");
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) {
        files.set(
          path.relative(root, full).split(path.sep).join("/"),
          readFileSync(full, "utf8"),
        );
      }
    }
  };
  walk(root);
  return files;
}

describe("the 待办 button's variant switcher", () => {
  it("starts on D1, the icon and the count", () => {
    expect(TODO_BUTTON_VARIANTS).toEqual(["D1", "D2"]);
    expect(DEFAULT_TODO_BUTTON_VARIANT).toBe("D1");
    // No window (a static render, a test): the default.
    expect(readStoredTodoButtonVariant()).toBe("D1");
  });

  it("reads the stored choice, and falls back on anything else", () => {
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoButtonVariant": "D2" }),
    });
    expect(readStoredTodoButtonVariant()).toBe("D2");
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoButtonVariant": "A1" }),
    });
    expect(readStoredTodoButtonVariant()).toBe("D1");
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    expect(readStoredTodoButtonVariant()).toBe("D1");
  });

  it("renders nothing without a document (static rendering)", () => {
    expect(renderToStaticMarkup(<TodoButtonVariantPill />)).toBe("");
  });

  it("touches only the places its removal steps name; ticket 42's are gone", () => {
    const hits: string[] = [];
    const old: string[] = [];
    for (const [file, text] of sources()) {
      if (text.includes(MARK)) hits.push(file);
      if (text.includes(OLD_MARK)) old.push(file);
    }
    expect(hits.sort()).toEqual(
      [
        "App.tsx",
        "components/layout/MainHeader.tsx",
        "components/layout/header/TodoToggleButton.tsx",
        "components/todo/todo-button-variant/TodoButtonVariantPill.tsx",
        "components/todo/todo-button-variant/todo-button-variant.ts",
      ].sort(),
    );
    expect(old).toEqual([]);
  });
});
