import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VARIANTS,
  PANEL_WIDTH,
  readStoredVariants,
  todoPanelId,
} from "./todo-variants";
import { TodoVariantsPill } from "./TodoVariantsPill";

/**
 * The to-do UI's temporary switcher (main chat ticket 42 §6): the most
 * restrained option of each comparison is the default, the choice is a
 * wrapped localStorage read, and every place it touches is where the
 * removal steps in todo-variants.ts say. The marker is spelt in two
 * halves here so this file is not one of its own hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 42)"].join(" ");

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
    data,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the to-do variant switcher", () => {
  it("starts on A1 B1 C1, each comparison's most restrained option", () => {
    expect(DEFAULT_VARIANTS).toEqual({ row: "A1", width: "B1", done: "C1" });
    // No window (a static render, a test): the default.
    expect(readStoredVariants()).toEqual(DEFAULT_VARIANTS);
    expect(PANEL_WIDTH).toEqual({ B1: 320, B2: 380 });
  });

  it("reads the stored choice, and falls back on anything else", () => {
    vi.stubGlobal("window", {
      localStorage: storage({
        "galley.tmp.todoVariants": JSON.stringify({
          row: "A3",
          width: "B2",
          done: "nope",
        }),
      }),
    });
    expect(readStoredVariants()).toEqual({
      row: "A3",
      width: "B2",
      done: "C1",
    });
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoVariants": "{" }),
    });
    expect(readStoredVariants()).toEqual(DEFAULT_VARIANTS);
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    expect(readStoredVariants()).toEqual(DEFAULT_VARIANTS);
  });

  it("gives each width its own panel id, so each starts at its own width", () => {
    expect(todoPanelId("B1")).toBe("todo-panel-b1");
    expect(todoPanelId("B2")).toBe("todo-panel-b2");
  });

  it("renders nothing without a document (static rendering)", () => {
    expect(renderToStaticMarkup(<TodoVariantsPill />)).toBe("");
  });

  it("touches only the places its removal steps name", () => {
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          if (readFileSync(full, "utf8").includes(MARK)) {
            hits.push(path.relative(root, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(
      [
        "App.tsx",
        "components/conversation/TodoCards.tsx",
        "components/layout/sidebar/SidebarTodoRow.tsx",
        "components/todo/TodoPanel.tsx",
        "components/todo/todo-styles.ts",
        "components/todo/todo-variants/TodoVariantsPill.tsx",
        "components/todo/todo-variants/todo-variants.ts",
      ].sort(),
    );
  });
});
