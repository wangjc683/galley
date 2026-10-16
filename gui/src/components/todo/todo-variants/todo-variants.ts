import { create } from "zustand";

/**
 * TEMP variant switcher (main chat 42) — the to-do UI's three visual
 * questions, compared live in tauri dev (main chat PRD ruling 91 point
 * 8; ticket 42 §6). JC switches them on the pill (TodoVariantsPill.tsx)
 * and rules; the chosen option gets written in and all of this goes.
 * Each runs from the most restrained:
 *
 *   A  the row under Galley's card
 *      A1  a row of its own, a one-line sidebar row's 32px, on the
 *          list's grid (icon on the 18px line, text on 42px)
 *      A2  a line of small text tucked under the card, from the card's
 *          text column (68px)
 *      A3  a 32px row on the card's grid: the icon centred in the
 *          avatar's 40px column, 「待办」 on the name's 68px edge,
 *          「今天 N」 on the time's right edge — Galley's notebook as
 *          part of Galley's block rather than a list row above the
 *          line (A1) or a footnote to the card (A2)
 *   B  the panel's first width (a dragged one is remembered per option
 *      while the pill is here): B1 320px, B2 380px
 *   C  a done to-do: C1 struck through in `ink-muted` (Markdown's
 *      strike-through), C2 the whole row at 60% opacity too
 *
 * Default A1 B1 C1. The choice is a per-machine convenience kept in
 * localStorage (`galley.tmp.todoVariants`, reads and writes wrapped),
 * never in Core.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 42)"; `grep -rn "main chat 42" gui/src`):
 *
 *   Always — delete this folder (todo-variants.ts, TodoVariantsPill.tsx,
 *   todo-variants.test.tsx) and App's pill.
 *   A — SidebarTodoRow keeps the winner's branch and drops `variant`.
 *   B — App passes the winner's width as a constant and the panel's id
 *   loses its option suffix (`todoPanelId`), so the layout has one
 *   memory again.
 *   C — `todoDoneClass` keeps the winner's classes and drops the
 *   `fade` argument; TodoPanel and TodoCards stop reading the store.
 *   Then the design docs: layout-and-chrome.md 「有主对话时」 (the
 *   row), conversation.md 「待办面板」 (width, done items).
 */

export type RowVariant = "A1" | "A2" | "A3";
export type WidthVariant = "B1" | "B2";
export type DoneVariant = "C1" | "C2";

export const ROW_VARIANTS: readonly RowVariant[] = ["A1", "A2", "A3"];
export const WIDTH_VARIANTS: readonly WidthVariant[] = ["B1", "B2"];
export const DONE_VARIANTS: readonly DoneVariant[] = ["C1", "C2"];

/** The panel's first width, px. */
export const PANEL_WIDTH: Record<WidthVariant, number> = {
  B1: 320,
  B2: 380,
};

/** The panel's id in the reading panel's group: one per width while
 * the pill is here, so each option starts at its own width. */
export function todoPanelId(width: WidthVariant): string {
  return `todo-panel-${width.toLowerCase()}`;
}

export interface TodoVariants {
  row: RowVariant;
  width: WidthVariant;
  done: DoneVariant;
}

export const DEFAULT_VARIANTS: TodoVariants = {
  row: "A1",
  width: "B1",
  done: "C1",
};

const KEY = "galley.tmp.todoVariants";

function pick<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function readStoredVariants(): TodoVariants {
  if (typeof window === "undefined") return DEFAULT_VARIANTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<
      Record<keyof TodoVariants, unknown>
    > | null;
    return {
      row: pick(raw?.row, ROW_VARIANTS, DEFAULT_VARIANTS.row),
      width: pick(raw?.width, WIDTH_VARIANTS, DEFAULT_VARIANTS.width),
      done: pick(raw?.done, DONE_VARIANTS, DEFAULT_VARIANTS.done),
    };
  } catch {
    return DEFAULT_VARIANTS;
  }
}

function writeStored(variants: TodoVariants): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(variants));
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then
    // lasts for this page only.
  }
}

interface TodoVariantsStore extends TodoVariants {
  set: (change: Partial<TodoVariants>) => void;
}

export const useTodoVariants = create<TodoVariantsStore>((set, get) => ({
  ...readStoredVariants(),
  set: (change) => {
    const { row, width, done } = { ...get(), ...change };
    writeStored({ row, width, done });
    set({ row, width, done });
  },
}));
