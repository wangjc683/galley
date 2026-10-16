import { create } from "zustand";

/**
 * TEMP variant switcher (main-chat 45) — the top bar's 「待办」 button,
 * compared live in tauri dev (main chat PRD ruling 93 point 6; ticket
 * 45). JC switches it on the pill (TodoButtonVariantPill.tsx) and rules;
 * the chosen form gets written in and all of this goes. From the most
 * restrained:
 *
 *   D1  the list icon, and beside it today's count N (nothing at 0)
 *   D2  the list icon, 「待办」, and N — in case a thin icon in a row of
 *       thin icons reads as weak again
 *
 * Default D1. The choice is a per-machine convenience kept in
 * localStorage (`galley.tmp.todoButtonVariant`, reads and writes
 * wrapped), never in Core.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main-chat 45)"; `grep -rn "main-chat 45" gui/src`):
 *
 *   - delete this folder (todo-button-variant.ts,
 *     TodoButtonVariantPill.tsx, todo-button-variant.test.tsx) and
 *     App's pill;
 *   - TodoToggleButton keeps the winner's markup and stops reading the
 *     store, and its test drops the other form. D1 wins: the word goes
 *     with `WORD_DISPLAY`, and so does MainHeader's
 *     `@container/main-header` (only the word reads it). D2 wins: the
 *     word and `WORD_DISPLAY` stay, the marker off;
 *   - the design docs: layout-and-chrome.md 「待办按钮」, its 「样子在
 *     比」 and, if D1 wins, 「窄的时候怎么让」.
 */

export type TodoButtonVariant = "D1" | "D2";

export const TODO_BUTTON_VARIANTS: readonly TodoButtonVariant[] = ["D1", "D2"];

export const DEFAULT_TODO_BUTTON_VARIANT: TodoButtonVariant = "D1";

const KEY = "galley.tmp.todoButtonVariant";

export function readStoredTodoButtonVariant(): TodoButtonVariant {
  if (typeof window === "undefined") return DEFAULT_TODO_BUTTON_VARIANT;
  try {
    const raw = window.localStorage.getItem(KEY);
    return TODO_BUTTON_VARIANTS.includes(raw as TodoButtonVariant)
      ? (raw as TodoButtonVariant)
      : DEFAULT_TODO_BUTTON_VARIANT;
  } catch {
    return DEFAULT_TODO_BUTTON_VARIANT;
  }
}

function writeStored(variant: TodoButtonVariant): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, variant);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then
    // lasts for this page only.
  }
}

interface TodoButtonVariantStore {
  variant: TodoButtonVariant;
  set: (variant: TodoButtonVariant) => void;
}

export const useTodoButtonVariant = create<TodoButtonVariantStore>((set) => ({
  variant: readStoredTodoButtonVariant(),
  set: (variant) => {
    writeStored(variant);
    set({ variant });
  },
}));
