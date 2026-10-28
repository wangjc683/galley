import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { AppCopy } from "@/i18n/types";
import type { TodoItem, YourTodos } from "@/lib/assistant-todo";

import {
  TODO_CAPSULE_MAX_PX,
  todoButtonFit,
  todoButtonShape,
  todoCapsule,
  todoFirstRow,
} from "./todo-button";

/**
 * The top bar's 待办 button (main chat ticket 106, PRD ruling 152): its
 * look by your things — the word with none, the capsule while the first
 * is one of today's or overdue, the icon otherwise; the capsule's row
 * (ticket 104, ruling 150), the first of your things in the panel's
 * order, its time as the panel's row writes it, 「+N」 only for today's;
 * and the header widths the word and the capsule give way at. Today is
 * Wednesday 28 October 2026 in whatever zone the run is in.
 */

const TODAY = new Date(2026, 9, 28).getTime();
const zh: AppCopy = zhCopy;
const en: AppCopy = enCopy;

/** A to-do due `days` from today, at `hh`:00 or on the day alone. */
function todo(
  id: string,
  days?: number,
  hh?: number,
  extra: Partial<TodoItem> = {},
): TodoItem {
  const item: TodoItem = {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    ...extra,
  };
  if (days === undefined) return item;
  const d = new Date(2026, 9, 28 + days);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (hh === undefined) return { ...item, due: { date, hasTime: false } };
  d.setHours(hh);
  return {
    ...item,
    due: { date, hasTime: true, at: d.toISOString(), time: `${hh}:00` },
  };
}

const none: YourTodos = { today: [], later: [], anytime: [] };

describe("the first row", () => {
  it("is today's first, else later's, else anytime's: the panel's order", () => {
    const today = [todo("交周报", 0, 15), todo("回邮件", 0, 18)];
    const later = [todo("取快递", 2, 15)];
    const anytime = [todo("整理发票")];
    expect(todoFirstRow({ today, later, anytime })).toEqual({
      item: today[0],
      group: "today",
    });
    expect(todoFirstRow({ ...none, later, anytime })).toEqual({
      item: later[0],
      group: "later",
    });
    expect(todoFirstRow({ ...none, anytime })).toEqual({
      item: anytime[0],
      group: "anytime",
    });
    expect(todoFirstRow(none)).toBeNull();
  });
});

describe("the look (ruling 152)", () => {
  it("writes 「待办」 with none of yours", () => {
    expect(todoButtonShape(none)).toBe("word");
  });

  it("is the capsule while the first of yours is one of today's, overdue too", () => {
    const today = [todo("交周报", 0, 15)];
    const late = todo("交季度报告", -2, undefined, { overdue: true });
    const later = [todo("取快递", 2, 15)];
    const anytime = [todo("整理发票")];
    expect(todoButtonShape({ ...none, today })).toBe("capsule");
    expect(todoButtonShape({ ...none, today: [late] })).toBe("capsule");
    expect(todoButtonShape({ today, later, anytime })).toBe("capsule");
  });

  it("is the icon while the first of yours is later's or anytime's", () => {
    const later = [todo("取快递", 2, 15)];
    const anytime = [todo("整理发票")];
    expect(todoButtonShape({ ...none, later })).toBe("icon");
    expect(todoButtonShape({ ...none, later, anytime })).toBe("icon");
    expect(todoButtonShape({ ...none, anytime })).toBe("icon");
  });
});

describe("the capsule's words", () => {
  const capsule = (yours: YourTodos, count: number, copy = zh) =>
    todoCapsule(yours, count, TODAY, copy === zh ? "zh-CN" : "en-US", copy);

  it("writes today's first, its time as the panel's row, and 「+N」 for today's others", () => {
    const today = [
      todo("交周报", 0, 15),
      todo("回邮件", 0, 18),
      todo("订机票", 0),
    ];
    expect(capsule({ ...none, today }, 3)).toEqual({
      when: "今天 15:00",
      tone: "muted",
      title: "交周报",
      more: 2,
    });
    expect(capsule({ ...none, today: [today[2]] }, 1)).toEqual({
      when: "今天",
      tone: "muted",
      title: "订机票",
      more: 0,
    });
  });

  it("writes the overdue part in warning, as the panel's row", () => {
    const late = todo("交季度报告", -2, undefined, { overdue: true });
    expect(capsule({ ...none, today: [late] }, 1)).toEqual({
      when: "逾期 2 天",
      tone: "warning",
      title: "交季度报告",
      more: 0,
    });
    // Due earlier today at a time that has passed.
    const passed = todo("交周报", 0, 9, { overdue: true });
    expect(capsule({ ...none, today: [passed] }, 1)?.when).toBe(
      "逾期 · 今天 09:00",
    );
  });

  it("writes later's day and time, and no 「+N」 off today, whatever today's count says", () => {
    const later = [todo("取快递", 2, 15), todo("体检", 5)];
    expect(capsule({ ...none, later }, 0)).toEqual({
      when: "周五 15:00",
      tone: "muted",
      title: "取快递",
      more: 0,
    });
    // Today's count still counting rows deleted in the panel and waiting
    // on their undo: the first row is later's, so no 「+N」.
    expect(capsule({ ...none, later }, 3)?.more).toBe(0);
    expect(capsule({ ...none, anytime: [todo("整理发票")] }, 2)?.more).toBe(0);
  });

  it("writes 「随时」 for anytime's, Anytime in English", () => {
    const anytime = [todo("整理发票")];
    expect(capsule({ ...none, anytime }, 0)).toEqual({
      when: "随时",
      tone: "muted",
      title: "整理发票",
      more: 0,
    });
    expect(capsule({ ...none, anytime }, 0, en)?.when).toBe("Anytime");
  });

  it("leaves the reminder out: no bell, no reminder time", () => {
    const withReminder = todo("交周报", 0, 15, {
      reminder: {
        taskId: "t",
        at: new Date(2026, 9, 28, 14).toISOString(),
        state: "scheduled",
      },
    });
    expect(capsule({ ...none, today: [withReminder] }, 1)?.when).toBe(
      "今天 15:00",
    );
    const anytimeReminder = todo("整理发票", undefined, undefined, {
      reminder: {
        taskId: "t",
        at: new Date(2026, 9, 29, 10).toISOString(),
        state: "scheduled",
      },
    });
    expect(capsule({ ...none, anytime: [anytimeReminder] }, 0)?.when).toBe(
      "随时",
    );
  });

  it("is null with nothing of yours: the button writes 「待办」", () => {
    expect(capsule(none, 0)).toBeNull();
  });
});

describe("where the word and the capsule give way", () => {
  it("is 220px at most", () => {
    expect(TODO_CAPSULE_MAX_PX).toBe(220);
  });

  it("needs the rest of the busiest header, plus the word, or the capsule at its narrowest", () => {
    expect(todoButtonFit("zh", "mac")).toEqual({
      word: 620,
      rest: 541,
      fold: 726,
    });
    expect(todoButtonFit("en", "mac")).toEqual({
      word: 731,
      rest: 640,
      fold: 851,
    });
    // Windows / Linux: the window controls and their gap, 146 more.
    expect(todoButtonFit("zh", "other")).toEqual({
      word: 766,
      rest: 687,
      fold: 872,
    });
    expect(todoButtonFit("en", "other")).toEqual({
      word: 877,
      rest: 786,
      fold: 997,
    });
  });

  it("folds with four characters of the title left: the capsule's narrowest is under its widest", () => {
    for (const language of ["zh", "en"] as const) {
      for (const platform of ["mac", "other"] as const) {
        const { rest, fold } = todoButtonFit(language, platform);
        const narrowest = fold - rest;
        expect(narrowest).toBeGreaterThan(36 + 4 * 12);
        expect(narrowest).toBeLessThan(TODO_CAPSULE_MAX_PX);
      }
    }
  });
});
