import { create } from "zustand";

import { useDayStamp } from "@/hooks/useDayStamp";
import type { TodoItem } from "@/lib/assistant-todo";

/**
 * TEMP variant switcher (main chat 83) — how quiet a done item is, in
 * the to-do panel's 已完成 and on the cards of done to-dos under the
 * replies, compared live in tauri dev (main chat PRD ruling 129 point
 * 2). JC picks on the pill (TodoVariantsPill.tsx), the chosen look gets
 * written in and the rest of this goes. From the most restrained:
 *
 *   now  today's look, to the byte; the only one a production build has.
 *   A    档位拉齐: under 已完成, a row that is not a to-do (a subtask, a
 *        reminder) takes `ink-muted` for its title, a ticked to-do's ink,
 *        in place of `ink-soft`. Glyphs and second lines as they are.
 *   B    方框退色: A, and a done to-do's ticked box neutral — filled and
 *        edged `line-strong`, its tick `ink-soft` (`ui/checkbox.tsx`
 *        `checkedTone="quiet"`) — under 已完成 and on a done card. A tick
 *        on its way (the 1.5 s hold under 今天 / 以后 / 随时, a card being
 *        ticked) stays brand: the box goes grey once the to-do is done
 *        in Core. Markdown's `- [x]` is not touched.
 *   C    再整行 70%: B, and each row under 已完成 and each done card at 70%
 *        opacity, box, glyph, title and second line together; 100% on
 *        hover and while focus is in it.
 *
 * 「演示」 (any look) swaps the rows under 已完成 for `demoDone` — JC's
 * list has no ticked to-do yet, so there is no box to see. Display only:
 * a demo box, title or row asks nothing of Core and goes nowhere. The
 * cards stay real. Both choices live in memory; a reload is back on
 * 现状 · 真实.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 83)"; `grep -rn "main chat 83" gui/src`):
 *
 *   Always — delete this folder (todo-variants.ts, TodoVariantsPill.tsx,
 *   todo-variants.test.tsx and its __snapshots__) and App.tsx's pill;
 *   drop 「演示」: in TodoPanel.tsx `useDemoDone` in TodoPanelGroups
 *   (已完成 maps `todo.done` again, its count `todo.done.length +
 *   todo.doneOmitted`, the omitted line unconditional), DoneRow's
 *   `inert` and `ignore`; TodoCheck's `onToggle`.
 *   now — DoneRow and TodoCard drop `doneLook` and keep today's classes;
 *   RowShell drops `rowClass`; `ui/checkbox.tsx` drops `checkedTone`
 *   (its type and `CHECKED_TONE_CLASSES` back to the brand classes);
 *   TodoCheck drops it too.
 *   A — DoneRow writes `text-ink-muted` for a row that is not a to-do;
 *   the rest as for now.
 *   B — A, and DoneRow and TodoCard pass `checkedTone="quiet"` to the box
 *   of a done to-do (`item.state === "done"`, not cancelled); keep
 *   `checkedTone` in ui/checkbox.tsx and TodoCheck (their marker
 *   comments go); RowShell drops `rowClass`.
 *   C — B, and DoneRow's `rowClass` (RowShell keeps it) and the done
 *   card's class keep `DONE_FADE_CLASS`'s classes, written in place.
 *   Then docs/design/conversation.md 「待办面板」「已完成」 and
 *   「待办卡片」「做完」 for the winner.
 *
 * Not part of this: ticket 83's points 5 and 6 (the launch-at-login
 * hint leaving the daily review out, 12px between groups) are final and
 * stay.
 */

export type DoneLook = "now" | "A" | "B" | "C";
export type DoneSource = "real" | "demo";

export const DONE_LOOKS: readonly DoneLook[] = ["now", "A", "B", "C"];

/** The pill's words for each (dev only, not in the locales). */
export const DONE_LOOK_NAMES: Record<DoneLook, string> = {
  now: "现状",
  A: "A 档位拉齐",
  B: "B 方框退色",
  C: "C 再整行 70%",
};

export const DONE_SOURCE_NAMES: Record<DoneSource, string> = {
  real: "真实",
  demo: "演示",
};

interface TodoVariantsStore {
  look: DoneLook;
  source: DoneSource;
  setLook: (look: DoneLook) => void;
  setSource: (source: DoneSource) => void;
}

export const useTodoVariants = create<TodoVariantsStore>((set) => ({
  look: "now",
  source: "real",
  setLook: (look) => set({ look }),
  setSource: (source) => set({ source }),
}));

/** What a look changes on a done item. */
export interface DoneLookStyle {
  /** A row under 已完成 that is not a to-do: `ink-muted`, not `ink-soft`. */
  mutedTitle: boolean;
  /** A done to-do's ticked box: neutral, not brand. */
  quietBox: boolean;
  /** The whole row or card at 70%, 100% on hover and focus. */
  fade: boolean;
}

export function doneLook(look: DoneLook): DoneLookStyle {
  return {
    mutedTitle: look !== "now",
    quietBox: look === "B" || look === "C",
    fade: look === "C",
  };
}

/** C's fade, on a row under 已完成 or a done card. */
export const DONE_FADE_CLASS =
  "opacity-70 hover:opacity-100 focus-within:opacity-100";

/**
 * 「演示」's 已完成 (ticket 83 point 2), timed from `todayStartMs` (a
 * render may not read the clock): four ticked to-dos — one that was due
 * at a time, one due on a day, one with no time, one ticked yesterday —
 * a subtask that came back, a reminder that went off. Newest first, as
 * Core's. No `createdIn`, no run session: no title leads anywhere (the
 * subtask's is inert in the panel).
 */
export function demoDone(todayStartMs: number): TodoItem[] {
  const at = (days: number, hour: number, minute: number) => {
    const d = new Date(todayStartMs);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const day = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const todo = (
    id: string,
    text: string,
    done: number,
    due?: TodoItem["due"],
  ): TodoItem => ({
    kind: "todo",
    id,
    text,
    state: "done",
    createdBy: "assistant",
    doneBy: "user",
    at: iso(done),
    ...(due ? { due } : {}),
  });
  // Early in the day, so a look in the afternoon has them all behind it.
  const reportDue = at(0, 9, 0);
  return [
    {
      kind: "task",
      id: "demo-reminder",
      text: "提醒喝水",
      state: "fired",
      createdBy: "assistant",
      target: "assistant",
      repeat: { kind: "once" },
      at: iso(at(0, 8, 50)),
    },
    todo("demo-todo-report", "交季度报告", at(0, 8, 35), {
      date: day(reportDue),
      hasTime: true,
      at: iso(reportDue),
      time: "09:00",
    }),
    todo("demo-todo-car", "给车做年检", at(0, 8, 20), {
      date: day(at(0, 0, 0)),
      hasTime: false,
    }),
    {
      kind: "subtask",
      id: "demo-subtask",
      text: "查周五去上海的机票",
      state: "done",
      createdBy: "assistant",
      at: iso(at(0, 8, 5)),
    },
    todo("demo-todo-soil", "买营养土", at(0, 7, 40)),
    todo("demo-todo-dinner", "订周六的餐厅", at(-1, 20, 30), {
      date: day(at(2, 0, 0)),
      hasTime: false,
    }),
  ];
}

/** 「演示」's rows for 已完成, or null on 「真实」. */
export function useDemoDone(): TodoItem[] | null {
  const demo = useTodoVariants((s) => s.source === "demo");
  const todayStartMs = useDayStamp();
  return demo ? demoDone(todayStartMs) : null;
}
