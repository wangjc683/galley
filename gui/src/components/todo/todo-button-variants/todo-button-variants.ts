import { create } from "zustand";

import type { TodoItem, YourTodos } from "@/lib/assistant-todo";
import type { YourGroup } from "@/lib/todo-button";
import { readTodoPanelIntroduced } from "@/lib/todo-panel-memory";

/**
 * TEMP variant switcher (main chat 104) — what the top bar's 待办 button
 * shows, compared live in tauri dev (main chat PRD ruling 150). Its
 * place is settled: the right side's first, a group of its own
 * (ruling 149 point 2, ticket 103's 甲). The word 「待办」 read stiff
 * there (ruling 149 point 3) and says nothing once you know the panel;
 * a capsule says the first row of your things instead. JC picks on the
 * pill (TodoButtonVariantsPill.tsx); a ticket after the ruling writes
 * the pick in and removes the rest. From the most restrained:
 *
 *   A   甲: the icon and today's count (the icon alone at 0), no word.
 *   D   丁: 「待办」 after the icon (ticket 103's 乙: icon, 4px, the word
 *       13px, 4px, the count) while this machine has not met the panel
 *       (`galley.todoPanelIntroduced` unset); 甲 from the next launch
 *       after it has — read once, at launch (`introducedAtLaunch`), so
 *       meeting it now changes nothing until then.
 *   E2  戊2: a capsule while the first of your things is one of
 *       today's (overdue too); 甲 while you have things but none today;
 *       「待办」 (丁's word, no capsule frame) while you have none.
 *   E   戊: a capsule whenever you have things; 「待办」 when none
 *       (default).
 *
 * The capsule itself is lib/todo-button.ts's and TodoToggleButton's.
 * The demos replace what the button reads (your things and today's
 * count) and nothing else: no data is written, and they live here, not
 * in a store of the app's. 「当作没认识」 shows 丁 as if the panel had
 * never been met. 「重放」 flies the last reply's cards into the button
 * (lib/todo-flight-run.ts `replayFlight`) to see each look's catch. The
 * look is a per-machine convenience kept in localStorage
 * (`galley.tmp.todoButtonCapsule`, reads and writes wrapped; not ticket
 * 103's `galley.tmp.todoButtonPlace`, which may still hold 「B」), never
 * in Core; the demo and 「当作没认识」 live in memory. A production build
 * has no pill and shows the default.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 104)"; `grep -rn "main chat 104" gui/src`):
 *
 *   Always — delete this folder (todo-button-variants.ts,
 *   TodoButtonVariantsPill.tsx, todo-button-variants.test.tsx), App.tsx's
 *   pill and lib/todo-flight-run.ts `replayFlight`; TodoToggleButton
 *   draws the picked shape from the real list (the demo goes) and
 *   MainHeader stops reading the look.
 *   A — TodoToggleButton draws `icon` only: lib/todo-button.ts, the
 *   capsule's and the word's class tables, `todoAnytime` and
 *   `todoWithFirst` go, and the header is no longer a size container.
 *   D — `icon` or `word` by the launch read (it moves to the ui store or
 *   lib/todo-panel-memory.ts); the capsule goes as for A.
 *   E2 / E — `todoButtonShape`'s branch for it moves into
 *   TodoToggleButton; 丁's launch read goes.
 *   Then docs/design/layout-and-chrome.md 「待办按钮」 (place, what it
 *   shows, the capsule's material, the narrow rule, the tooltip) and
 *   the right side's diagram.
 */

export type TodoButtonLook = "A" | "D" | "E2" | "E";
export type TodoButtonDemo =
  | "real"
  | "empty"
  | "later"
  | "today3"
  | "overdue"
  | "anytime"
  | "long";

export const TODO_BUTTON_LOOKS: readonly TodoButtonLook[] = [
  "A",
  "D",
  "E2",
  "E",
];
export const TODO_BUTTON_DEMOS: readonly TodoButtonDemo[] = [
  "real",
  "empty",
  "later",
  "today3",
  "overdue",
  "anytime",
  "long",
];

/** The pill's words (dev only, not in the locales). */
export const TODO_BUTTON_LOOK_NAMES: Record<TodoButtonLook, string> = {
  A: "甲",
  D: "丁",
  E2: "戊2",
  E: "戊",
};

export const TODO_BUTTON_DEMO_NAMES: Record<TodoButtonDemo, string> = {
  real: "真实",
  empty: "空",
  later: "只有以后",
  today3: "今天 3 件",
  overdue: "逾期",
  anytime: "只有随时",
  long: "长标题",
};

export const DEFAULT_TODO_BUTTON_LOOK: TodoButtonLook = "E";

/** What the button draws: the icon (and today's count), the word
 * 「待办」 after it, or the capsule. */
export type TodoButtonShape = "icon" | "word" | "capsule";

/**
 * Each look's shape (ruling 150 point 8): `first` is the group of the
 * first of your things (lib/todo-button.ts `todoFirstRow`), null when
 * you have none; `introduced` whether this machine had met the panel at
 * launch (丁 only).
 */
export function todoButtonShape(
  look: TodoButtonLook,
  first: YourGroup | null,
  introduced: boolean,
): TodoButtonShape {
  switch (look) {
    case "A":
      return "icon";
    case "D":
      return introduced ? "icon" : "word";
    case "E2":
      if (first === null) return "word";
      return first === "today" ? "capsule" : "icon";
    case "E":
      return first === null ? "word" : "capsule";
  }
}

/** The 30 characters of 「长标题」. */
export const DEMO_LONG_TITLE =
  "把第三季度各区域的销售数据整理成表格发给财务部审核并签字确认";

/** The local day `days` after the day starting at `todayStartMs`, as
 * Core writes a due date (`YYYY-MM-DD`), and that day at `hh:mm` (UTC
 * ISO). Calendar steps, not 24h ones, across a DST change. */
function demoDay(
  todayStartMs: number,
  days: number,
  hh?: number,
): { date: string; at?: string } {
  const d = new Date(todayStartMs);
  d.setDate(d.getDate() + days);
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
  if (hh === undefined) return { date };
  d.setHours(hh, 0, 0, 0);
  return { date, at: d.toISOString() };
}

function demoTodo(
  id: string,
  text: string,
  todayStartMs: number,
  days?: number,
  hh?: number,
  overdue?: boolean,
): TodoItem {
  const item: TodoItem = {
    kind: "todo",
    id: `demo_${id}`,
    text,
    state: "open",
    createdBy: "assistant",
  };
  if (days === undefined) return item;
  const { date, at } = demoDay(todayStartMs, days, hh);
  item.due = at
    ? {
        date,
        hasTime: true,
        at,
        time: `${String(hh).padStart(2, "0")}:00`,
      }
    : { date, hasTime: false };
  if (overdue) item.overdue = true;
  return item;
}

/**
 * What a demo shows in place of your things and today's count (ruling
 * 150 point 8), around the day starting at `todayStartMs`; null for
 * 「真实」. A due time today never reads overdue here: the demo items
 * carry no `overdue` but 「逾期」's.
 *
 *   空        nothing
 *   只有以后  取快递, in two days at 15:00 (「周五 15:00」 on a Wednesday)
 *   今天 3 件 交周报 today at 15:00, then two more of today's: 「+2」
 *   逾期      交季度报告, due two days ago: 「逾期 2 天」
 *   只有随时  整理发票, no due date: 「随时」
 *   长标题    `DEMO_LONG_TITLE` today at 15:00
 */
export function todoButtonDemo(
  demo: TodoButtonDemo,
  todayStartMs: number,
): { yours: YourTodos; todayCount: number } | null {
  const none: YourTodos = { today: [], later: [], anytime: [] };
  const t = demoTodo;
  switch (demo) {
    case "real":
      return null;
    case "empty":
      return { yours: none, todayCount: 0 };
    case "later":
      return {
        yours: { ...none, later: [t("parcel", "取快递", todayStartMs, 2, 15)] },
        todayCount: 0,
      };
    case "today3":
      return {
        yours: {
          ...none,
          today: [
            t("report", "交周报", todayStartMs, 0, 15),
            t("mail", "回复客户邮件", todayStartMs, 0, 18),
            t("ticket", "订下周的机票", todayStartMs, 0),
          ],
        },
        todayCount: 3,
      };
    case "overdue":
      return {
        yours: {
          ...none,
          today: [
            t("quarterly", "交季度报告", todayStartMs, -2, undefined, true),
          ],
        },
        todayCount: 1,
      };
    case "anytime":
      return {
        yours: { ...none, anytime: [t("invoices", "整理发票", todayStartMs)] },
        todayCount: 0,
      };
    case "long":
      return {
        yours: {
          ...none,
          today: [t("long", DEMO_LONG_TITLE, todayStartMs, 0, 15)],
        },
        todayCount: 1,
      };
  }
}

const KEY = "galley.tmp.todoButtonCapsule";

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
  /** 「当作没认识」: 丁 as if the panel had never been met. */
  pretendNew: boolean;
  /** Whether this machine had met the panel when Galley started
   * (lib/todo-panel-memory.ts `readTodoPanelIntroduced`), read once as
   * the store is made and never again: meeting the panel now shows 甲
   * from the next launch (丁). */
  introducedAtLaunch: boolean;
  setLook: (look: TodoButtonLook) => void;
  setDemo: (demo: TodoButtonDemo) => void;
  setPretendNew: (pretendNew: boolean) => void;
}

export const useTodoButtonVariants = create<TodoButtonVariantsStore>((set) => ({
  look: readStoredTodoButtonLook(),
  demo: "real",
  pretendNew: false,
  introducedAtLaunch: readTodoPanelIntroduced(),
  setLook: (look) => {
    writeStored(look);
    set({ look });
  },
  setDemo: (demo) => set({ demo }),
  setPretendNew: (pretendNew) => set({ pretendNew }),
}));
