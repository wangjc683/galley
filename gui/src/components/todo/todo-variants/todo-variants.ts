import { createContext, useContext } from "react";
import { create } from "zustand";

import { useDayStamp } from "@/hooks/useDayStamp";
import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { REVIEW_SUPERVISOR } from "@/lib/scheduled-tasks";

/**
 * TEMP variant switcher (main chat 85) — how dense the to-do panel is,
 * compared live in tauri dev (main chat PRD ruling 130: beside Apple's
 * Reminders the rows are as tall, the room goes to group labels, a
 * second line on every row, and width). JC picks on the pill
 * (TodoVariantsPill.tsx), the chosen look gets written in and the rest
 * of this goes. From the most restrained:
 *
 *   now  today's panel, to the byte; the only one a production build has.
 *   B    不分组: 今天, 以后 and 随时 run as one unlabelled part at the top,
 *        Core's three lists end to end — overdue, today, later by day,
 *        no time — not sorted again; each row's second line written as
 *        outside 今天 (`inToday: false`: 「今天 18:00」, 「今天」). The
 *        group gap (12px, ruling 128 point 9) after it; no part when
 *        there is none of yours. 「Galley 在办」, 「例行」, 「已完成」 as
 *        they are; the top bar's 「今天 N」 too.
 *   BC   B+C 组名收紧: B, and each group label (已完成's button too) 3px
 *        top and bottom in place of 6px; nothing else on it changes.
 *
 * 「演示」 (any look) shows `demoTodo` in place of the whole list —
 * fifteen things across every group (twelve with 已完成 folded), to see
 * ten-odd at once (JC's list has two). Display only: no demo box, cancel, 「说说这件」 or title
 * asks anything of Core or goes anywhere (`useTodoDemoInert`). The
 * empty state never shows on it; the launch-at-login hint reads the
 * real list. Both choices live in memory; a reload is back on 现状 ·
 * 真实.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 85)"; `grep -rn "main chat 85" gui/src`):
 *
 *   Always — delete this folder (todo-variants.ts, TodoVariantsPill.tsx,
 *   todo-variants.test.tsx and its __snapshots__) and App.tsx's pill;
 *   drop 「演示」: in TodoPanel.tsx `useDemoTodo` and `shown` (the panel
 *   reads `todo` again), the `TodoDemoInert` provider and the swapped
 *   `go` / `talkAbout`; `useTodoDemoInert` in TodoCheck, YourRow and
 *   AssistantRow (their clicks go to the store again).
 *   now — TodoPanelGroups drops `densityLook` and the `flat` branch;
 *   GroupLabel drops `tight`.
 *   B — TodoPanelGroups keeps the `flat` branch alone: 你的事 is one
 *   `section data-todo-group="yours"` with no label, `yours.today`,
 *   `.later` and `.anytime` end to end, `inToday` false (YourRow's
 *   `inToday` prop can go); `yourParts` with its 今天 / 以后 / 随时
 *   labels goes (`copy.todo.groupToday` / `groupLater` /
 *   `groupAnytime` too, if nothing else reads them); GroupLabel drops
 *   `tight`.
 *   BC — B, and GroupLabel's register says `py-[3px]` in place of
 *   `py-1.5`.
 *   Then docs/design/conversation.md 「待办面板」「分组」 (and ruling 98's
 *   history there) for the winner.
 */

export type DensityLook = "now" | "B" | "BC";
export type TodoSource = "real" | "demo";

export const DENSITY_LOOKS: readonly DensityLook[] = ["now", "B", "BC"];

/** The pill's words for each (dev only, not in the locales). */
export const DENSITY_LOOK_NAMES: Record<DensityLook, string> = {
  now: "现状",
  B: "B 不分组",
  BC: "B+C 组名收紧",
};

export const TODO_SOURCE_NAMES: Record<TodoSource, string> = {
  real: "真实",
  demo: "演示",
};

interface TodoVariantsStore {
  look: DensityLook;
  source: TodoSource;
  setLook: (look: DensityLook) => void;
  setSource: (source: TodoSource) => void;
}

export const useTodoVariants = create<TodoVariantsStore>((set) => ({
  look: "now",
  source: "real",
  setLook: (look) => set({ look }),
  setSource: (source) => set({ source }),
}));

/** What a look changes. */
export interface DensityLookStyle {
  /** 你的事 as one unlabelled part. */
  flatYours: boolean;
  /** Group labels 3px top and bottom, not 6px. */
  tightLabels: boolean;
}

export function densityLook(look: DensityLook): DensityLookStyle {
  return { flatYours: look !== "now", tightLabels: look === "BC" };
}

/** A group label's padding, by look. */
export const LABEL_PAD = { normal: "py-1.5", tight: "py-[3px]" } as const;

/** 「演示」's rows ask nothing of Core and go nowhere. */
export const TodoDemoInert = createContext(false);

export function useTodoDemoInert(): boolean {
  return useContext(TodoDemoInert);
}

/** What a demo click does: nothing. */
export const ignore = () => {};

// ---- 「演示」 ---------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 「演示」's list (ticket 85 point 2), timed from `todayStartMs` (a render
 * may not read the clock; the day stamp turns at midnight, so the words
 * hold across it):
 *
 *   yours    overdue 2 days; today 18:00 with a reminder; today, no
 *            time; tomorrow 10:00 with a reminder; next week (six days
 *            on); 20 November (the next one past next week) with a
 *            note; two with no time, one with a note
 *   Galley   a subtask at work; its own reminder tomorrow 09:00
 *   routine  the daily review; every Monday 09:00
 *   done     two ticked to-dos, a subtask back (folded, as ever)
 *
 * In Core's order within each list. No `createdIn` on a to-do or a
 * task and no run session, so no title leads anywhere but the subtask's,
 * which the panel holds inert.
 */
export function demoTodo(todayStartMs: number): AssistantTodo {
  const at = (days: number, hour = 0, minute = 0) => {
    const d = new Date(todayStartMs);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const iso = (d: Date) => d.toISOString();
  const day = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateDue = (d: Date) => ({ date: day(d), hasTime: false });
  const timeDue = (d: Date) => ({
    date: day(d),
    hasTime: true,
    at: iso(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
  const todo = (
    id: string,
    text: string,
    extra: Partial<TodoItem> = {},
  ): TodoItem => ({
    kind: "todo",
    id: `demo-${id}`,
    text,
    state: "open",
    createdBy: "assistant",
    ...extra,
  });
  const reminder = (id: string, d: Date) => ({
    taskId: `demo-reminder-${id}`,
    at: iso(d),
    state: "scheduled" as const,
  });

  // The next 20 November past next week, so 以后 stays in day order.
  const today = at(0);
  let november = new Date(today.getFullYear(), 10, 20);
  if (november.getTime() <= at(7).getTime()) {
    november = new Date(today.getFullYear() + 1, 10, 20);
  }
  // The next Monday after today (`getDay`: 0 is Sunday).
  const toMonday = (8 - today.getDay()) % 7 || 7;
  const monday = at(toMonday, 9);

  const tonight = at(0, 18);
  const tomorrowTen = at(1, 10);
  return {
    ...EMPTY_TODO,
    yours: {
      today: [
        todo("late", "交物业费", { due: dateDue(at(-2)), overdue: true }),
        todo("tonight", "取干洗的衣服", {
          due: timeDue(tonight),
          reminder: reminder("tonight", at(0, 17, 30)),
        }),
        todo("plants", "给花浇水", { due: dateDue(today) }),
      ],
      later: [
        todo("bank", "去银行办卡", {
          due: timeDue(tomorrowTen),
          reminder: reminder("bank", at(1, 9, 30)),
        }),
        // Six days on: a weekday's name, next week's.
        todo("checkup", "预约体检", { due: dateDue(at(6)) }),
        todo("lease", "续签租房合同", {
          due: dateDue(november),
          notes: "带上身份证和上次的合同复印件",
        }),
      ],
      anytime: [
        todo("soil", "买营养土"),
        todo("photos", "整理相册", { notes: "先挑出去年旅行的照片" }),
      ],
    },
    assistant: [
      {
        kind: "subtask",
        id: "demo-subtask",
        text: "比较三款空气净化器",
        state: "running",
        createdBy: "assistant",
        at: iso(today),
      },
      {
        kind: "task",
        id: "demo-umbrella",
        text: "提醒带伞",
        state: "scheduled",
        createdBy: "assistant",
        target: "assistant",
        repeat: { kind: "once" },
        at: iso(at(1, 9)),
      },
    ],
    routine: [
      {
        kind: "task",
        id: "demo-review",
        text: "Daily review",
        state: "scheduled",
        createdBy: "agent",
        agent: REVIEW_SUPERVISOR,
        target: "assistant",
        repeat: { kind: "daily" },
        timeOfDay: "07:30",
        at: iso(at(1, 7, 30)),
      },
      {
        kind: "task",
        id: "demo-weekly",
        text: "周报提醒",
        state: "scheduled",
        createdBy: "assistant",
        target: "assistant",
        repeat: { kind: "weekly", weekdays: [1] },
        timeOfDay: "09:00",
        at: iso(monday),
      },
    ],
    done: [
      todo("paid", "交电费", { state: "done", at: iso(at(0, 8, 40)) }),
      {
        kind: "subtask",
        id: "demo-subtask-back",
        text: "查周五去上海的机票",
        state: "done",
        createdBy: "assistant",
        at: iso(at(0, 8, 10)),
      },
      todo("booked", "订周六的餐厅", {
        state: "done",
        at: iso(at(-1, 20, 30)),
      }),
    ],
    todayCount: 3,
  };
}

/** 「演示」's list, or null on 「真实」. */
export function useDemoTodo(): AssistantTodo | null {
  const demo = useTodoVariants((s) => s.source === "demo");
  const todayStartMs = useDayStamp();
  return demo ? demoTodo(todayStartMs) : null;
}
