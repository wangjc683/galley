import { create } from "zustand";

/**
 * TEMP variant switcher (main chat 103) — where the top bar's 待办
 * button stands and what it shows, compared live in tauri dev (main
 * chat PRD ruling 148: it is the top bar's one way into content, yet it
 * sat in 「视图与设置」 beside Aa and the gear, a thin glyph like
 * theirs). JC picks on the pill (TodoButtonVariantsPill.tsx); a ticket
 * after the ruling writes the pick in and removes the rest. From the
 * most restrained:
 *
 *   now  现状: the tool cluster's first button, as it is.
 *   A    甲: the right side's first, a group of its own —
 *        [ 待办 ] │ [ 运行状态 ] │ [ 视图与设置 ] — the existing divider
 *        between groups, one between it and the tools when the status
 *        cluster is empty; the button as it is.
 *   B    乙: 甲, and the word 「待办」 after the icon (default, the main
 *        session's pick). The word gives way first on a narrow header
 *        (TodoToggleButton).
 *   C    丙: 乙, and a hairline `border-line` at rest.
 *
 * 「真实 / 今天 2 / 没有今天」 replaces the count the button shows (and
 * says) and nothing else: no data is written. The place is a per-machine
 * convenience kept in localStorage (`galley.tmp.todoButtonPlace`, reads
 * and writes wrapped, the earlier switchers' `galley.tmp.*`; not
 * ticket 45's `galley.tmp.todoButtonVariant`, which may still hold
 * 「D1」 / 「D2」), never in Core; the demo count lives in memory, so a
 * reload is back on the real count. A production build has no pill and
 * shows the default.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 103)"; `grep -rn "main chat 103" gui/src`):
 *
 *   Always — delete this folder (todo-button-variants.ts,
 *   TodoButtonVariantsPill.tsx, todo-button-variants.test.tsx) and
 *   App.tsx's pill; MainHeader and TodoToggleButton stop reading the
 *   store (the demo count goes with it).
 *   now — MainHeader drops the group of its own and the container, and
 *   always hands the toggle to the tool cluster; TodoToggleButton drops
 *   `look`, the word and its class tables.
 *   A — MainHeader keeps the group and drops the container; the tool
 *   cluster loses `onToggleTodo` (and the 待办 branch);
 *   TodoToggleButton drops the word.
 *   B — as A, the container and the word kept; TodoToggleButton drops
 *   the C border.
 *   C — B, the border kept.
 *   Then docs/design/layout-and-chrome.md 「待办按钮」 (place, word, the
 *   narrow rule, the tooltip) and the right side's diagram.
 */

export type TodoButtonLook = "now" | "A" | "B" | "C";
export type TodoButtonDemo = "real" | "two" | "none";

export const TODO_BUTTON_LOOKS: readonly TodoButtonLook[] = [
  "now",
  "A",
  "B",
  "C",
];
export const TODO_BUTTON_DEMOS: readonly TodoButtonDemo[] = [
  "real",
  "two",
  "none",
];

/** The pill's words (dev only, not in the locales). */
export const TODO_BUTTON_LOOK_NAMES: Record<TodoButtonLook, string> = {
  now: "现状",
  A: "甲 挪位",
  B: "乙 加字",
  C: "丙 加框",
};

export const TODO_BUTTON_DEMO_NAMES: Record<TodoButtonDemo, string> = {
  real: "真实",
  two: "今天 2",
  none: "没有今天",
};

export const DEFAULT_TODO_BUTTON_LOOK: TodoButtonLook = "B";

/** The button's own group, right of the title (甲, 乙, 丙). */
export function todoButtonApart(look: TodoButtonLook): boolean {
  return look !== "now";
}

/** The word 「待办」 on the button (乙, 丙). */
export function todoButtonWord(look: TodoButtonLook): boolean {
  return look === "B" || look === "C";
}

/** Today's count as the button shows it: the demo's, or the real one. */
export function todoButtonCount(
  demo: TodoButtonDemo,
  todayCount: number,
): number {
  return demo === "two" ? 2 : demo === "none" ? 0 : todayCount;
}

const KEY = "galley.tmp.todoButtonPlace";

export function readStoredTodoButtonLook(): TodoButtonLook {
  if (typeof window === "undefined") return DEFAULT_TODO_BUTTON_LOOK;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as {
      look?: unknown;
    } | null;
    return TODO_BUTTON_LOOKS.includes(raw?.look as TodoButtonLook)
      ? (raw!.look as TodoButtonLook)
      : DEFAULT_TODO_BUTTON_LOOK;
  } catch {
    return DEFAULT_TODO_BUTTON_LOOK;
  }
}

function writeStored(look: TodoButtonLook): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ look }));
  } catch {
    // Storage unavailable: the pick lasts for this page only.
  }
}

interface TodoButtonVariantsStore {
  look: TodoButtonLook;
  demo: TodoButtonDemo;
  setLook: (look: TodoButtonLook) => void;
  setDemo: (demo: TodoButtonDemo) => void;
}

export const useTodoButtonVariants = create<TodoButtonVariantsStore>((set) => ({
  look: readStoredTodoButtonLook(),
  demo: "real",
  setLook: (look) => {
    writeStored(look);
    set({ look });
  },
  setDemo: (demo) => set({ demo }),
}));
