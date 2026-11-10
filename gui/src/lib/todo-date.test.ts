import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { TodoItem } from "@/lib/assistant-todo";
import {
  addDays,
  addMonths,
  addMonthsToDay,
  calendarKeyMove,
  dayKey,
  dayOf,
  daysBetween,
  daysInMonth,
  dueTime,
  dueWrite,
  isoWeekday,
  monthGrid,
  newReminderTime,
  nextMonday,
  parseDay,
  periodReminder,
  reminderMovedOn,
  reminderOffset,
  reminderOnRule,
  repeatChoice,
  repeatFitsDay,
  repeatRuleFor,
  timeValue,
  todayKey,
  todoRepeatLineWords,
  todoRepeatWords,
} from "@/lib/todo-date";

/**
 * The date popover's arithmetic (main chat ticket 156): pure over day
 * keys, so it holds in any zone (the suite runs under UTC and Los
 * Angeles too); the two that read the machine's zone (`dayOf`,
 * `reminderOffset`) are fed instants built in that zone.
 */

/** A local wall-clock instant, ISO, in this machine's zone. */
function localIso(day: string, h: number, m: number): string {
  const parsed = parseDay(day)!;
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    h,
    m,
  ).toISOString();
}

describe("the month grid", () => {
  it("starts on Monday, the 1st under its weekday, blank around the month", () => {
    // November 2026: the 1st is a Sunday, the last column.
    const november = monthGrid({ year: 2026, month: 11 });
    expect(november[0]).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-11-01",
    ]);
    expect(november[1][0]).toBe("2026-11-02");
    expect(november[2][1]).toBe("2026-11-10");
    expect(november).toHaveLength(6);
    expect(november[5]).toEqual([
      "2026-11-30",
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    // February 2027 starts on a Monday and fills four rows exactly.
    const february = monthGrid({ year: 2027, month: 2 });
    expect(february).toHaveLength(4);
    expect(february[0][0]).toBe("2027-02-01");
    expect(february[3][6]).toBe("2027-02-28");
    // Every row is seven.
    for (const row of [...november, ...february]) expect(row).toHaveLength(7);
  });

  it("knows a leap year's February", () => {
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2027, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2100, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2000, month: 2 })).toBe(29);
    expect(monthGrid({ year: 2028, month: 2 }).flat()).toContain("2028-02-29");
    expect(monthGrid({ year: 2027, month: 2 }).flat()).not.toContain(
      "2027-02-29",
    );
    expect(parseDay("2027-02-29")).toBeNull();
    expect(parseDay("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("turns the month across the year", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({
      year: 2026,
      month: 12,
    });
    expect(addMonths({ year: 2026, month: 11 }, 14)).toEqual({
      year: 2028,
      month: 1,
    });
    // A day a month on, held to the month's last day.
    expect(addMonthsToDay("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsToDay("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDay("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsToDay("2027-03-31", -1)).toBe("2027-02-28");
  });

  it("counts days across months, years and a daylight-saving change", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    // The US springs forward on 2027-03-14: still one day.
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysBetween("2026-11-20", "2026-11-15")).toBe(-5);
    expect(dayKey(2026, 11, 0)).toBe("2026-10-31");
    expect(isoWeekday("2026-11-10")).toBe(2);
    expect(isoWeekday("2026-11-15")).toBe(7);
  });
});

describe("next Monday", () => {
  it("is the first Monday after today, a week on from a Monday", () => {
    // Mon 2026-11-09 … Sun 2026-11-15.
    const week = [
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ];
    expect(week.map(nextMonday)).toEqual([
      "2026-11-16",
      "2026-11-16",
      "2026-11-16",
      "2026-11-16",
      "2026-11-16",
      "2026-11-16",
      "2026-11-16",
    ]);
    // Across a year.
    expect(nextMonday("2026-12-30")).toBe("2027-01-04");
  });

  it("reads today off the day stamp, in this machine's zone", () => {
    const start = new Date(2026, 10, 10).getTime();
    expect(todayKey(start)).toBe("2026-11-10");
    expect(dayOf(Number.NaN)).toBeNull();
  });
});

describe("the month grid's keys", () => {
  it("moves a day, a week, a month", () => {
    expect(calendarKeyMove("2026-11-10", "ArrowRight")).toBe("2026-11-11");
    expect(calendarKeyMove("2026-11-01", "ArrowLeft")).toBe("2026-10-31");
    expect(calendarKeyMove("2026-11-28", "ArrowDown")).toBe("2026-12-05");
    expect(calendarKeyMove("2027-01-03", "ArrowUp")).toBe("2026-12-27");
    expect(calendarKeyMove("2026-12-31", "PageDown")).toBe("2027-01-31");
    expect(calendarKeyMove("2027-03-31", "PageUp")).toBe("2027-02-28");
    expect(calendarKeyMove("2026-11-10", "Enter")).toBeNull();
    expect(calendarKeyMove("2026-11-10", "a")).toBeNull();
  });
});

describe("a reminder as days before and a time", () => {
  it("reads the days between its local day and the due day, and its local time", () => {
    const due = { date: "2026-11-20", hasTime: false };
    expect(reminderOffset(due, localIso("2026-11-19", 20, 0))).toEqual({
      daysBefore: 1,
      time: "20:00",
    });
    expect(reminderOffset(due, localIso("2026-11-20", 9, 5))).toEqual({
      daysBefore: 0,
      time: "09:05",
    });
    expect(reminderOffset(due, localIso("2026-11-13", 9, 0))).toEqual({
      daysBefore: 7,
      time: "09:00",
    });
    // None of the choices: five days before, a day after.
    expect(reminderOffset(due, localIso("2026-11-15", 9, 0))).toEqual({
      daysBefore: 5,
      time: "09:00",
    });
    expect(reminderOffset(due, localIso("2026-11-21", 9, 0))).toEqual({
      daysBefore: -1,
      time: "09:00",
    });
    // A due time does not count: the day does.
    const at = {
      date: "2026-11-20",
      hasTime: true,
      at: localIso("2026-11-20", 15, 0),
      time: "15:00",
    };
    expect(reminderOffset(at, localIso("2026-11-20", 16, 0))).toEqual({
      daysBefore: 0,
      time: "16:00",
    });
    expect(reminderOffset(undefined, localIso("2026-11-20", 16, 0))).toBeNull();
    expect(reminderOffset(due, undefined)).toBeNull();
    expect(reminderOffset(due, "not a time")).toBeNull();
  });

  it("words a reminder in the choices' words, and the ones outside them as they are", () => {
    const zh = zhCopy.todo.date.remindDays;
    const en = enCopy.todo.date.remindDays;
    expect([0, 1, 2, 3, 7].map(zh)).toEqual([
      "当天",
      "提前 1 天",
      "提前 2 天",
      "提前 3 天",
      "提前 1 周",
    ]);
    expect([0, 1, 2, 3, 7].map(en)).toEqual([
      "Same day",
      "1 day before",
      "2 days before",
      "3 days before",
      "1 week before",
    ]);
    expect(zh(5)).toBe("提前 5 天");
    expect(zh(-1)).toBe("到期后 1 天");
    expect(en(5)).toBe("5 days before");
    expect(en(-1)).toBe("1 day after");
    expect(en(-3)).toBe("3 days after");
  });

  it("starts a new reminder at the due time, else 09:00, never already past today", () => {
    // Due in three days, the day before: 09:00, or the due time.
    expect(newReminderTime(null, "2026-11-12", "2026-11-10", 600)).toBe(
      "09:00",
    );
    expect(newReminderTime("15:30", "2026-11-12", "2026-11-10", 600)).toBe(
      "15:30",
    );
    // Today, 10:23: 09:00 has passed, so the next whole hour.
    expect(newReminderTime(null, "2026-11-10", "2026-11-10", 623)).toBe(
      "11:00",
    );
    // Today with a due time still ahead: that.
    expect(newReminderTime("15:30", "2026-11-10", "2026-11-10", 623)).toBe(
      "15:30",
    );
    // At 23:10 no whole hour is left today: the time as it is.
    expect(newReminderTime(null, "2026-11-10", "2026-11-10", 1390)).toBe(
      "09:00",
    );
  });
});

describe("the due date written", () => {
  it("is the day, or the day and its time", () => {
    expect(dueWrite("2026-11-20", null)).toBe("2026-11-20");
    expect(dueWrite("2026-11-20", "15:00")).toBe("2026-11-20T15:00");
    expect(dueTime({ date: "2026-11-20", hasTime: false })).toBeNull();
    expect(
      dueTime({ date: "2026-11-20", hasTime: true, time: "15:00", at: "x" }),
    ).toBe("15:00");
    expect(timeValue("17:30")).toBe("17:30");
    expect(timeValue("17:30:00")).toBe("17:30");
    expect(timeValue("")).toBeNull();
  });
});

describe("the rule's five choices", () => {
  it("reads a rule as one of them, or as one of none", () => {
    expect(repeatChoice(undefined)).toBe("none");
    expect(repeatChoice({ kind: "daily" })).toBe("daily");
    expect(repeatChoice({ kind: "weekly", weekdays: [1] })).toBe("weekly");
    expect(repeatChoice({ kind: "monthly", monthdays: [15] })).toBe("monthly");
    expect(repeatChoice({ kind: "yearly" })).toBe("yearly");
    // Every 2 weeks, every 3 months, two days a week, two days a month.
    expect(repeatChoice({ kind: "weekly", weekdays: [1], every: 2 })).toBe(
      "other",
    );
    expect(repeatChoice({ kind: "monthly", monthdays: [15], every: 3 })).toBe(
      "other",
    );
    expect(repeatChoice({ kind: "weekly", weekdays: [1, 4] })).toBe("other");
    expect(repeatChoice({ kind: "monthly", monthdays: [1, 15] })).toBe("other");
    expect(repeatChoice({ kind: "daily", every: 2 })).toBe("other");
  });

  it("takes the weekday, the date or nothing from the due date, every 1", () => {
    expect(repeatRuleFor("daily", "2026-11-10")).toEqual({ kind: "daily" });
    expect(repeatRuleFor("weekly", "2026-11-10")).toEqual({
      kind: "weekly",
      weekdays: [2],
    });
    expect(repeatRuleFor("weekly", "2026-11-15")).toEqual({
      kind: "weekly",
      weekdays: [7],
    });
    expect(repeatRuleFor("monthly", "2026-11-30")).toEqual({
      kind: "monthly",
      monthdays: [30],
    });
    expect(repeatRuleFor("yearly", "2028-02-29")).toEqual({ kind: "yearly" });
  });

  it("says a rule in words as Core does, in either language", () => {
    const words = (rule: Parameters<typeof todoRepeatWords>[0]) => [
      todoRepeatWords(rule, zhCopy),
      todoRepeatWords(rule, enCopy),
    ];
    expect(words({ kind: "weekly", weekdays: [1], every: 2 })).toEqual([
      "每 2 周的周一",
      "Every 2 weeks on Mon",
    ]);
    expect(words({ kind: "weekly", weekdays: [1, 4] })).toEqual([
      "每周一·四",
      "Weekly on Mon, Thu",
    ]);
    expect(words({ kind: "monthly", monthdays: [15], every: 3 })).toEqual([
      "每 3 个月的 15 日",
      "Every 3 months on the 15th",
    ]);
    expect(words({ kind: "monthly", monthdays: [1, 2, 3, 11, 22] })).toEqual([
      "每月 1·2·3·11·22 日",
      "Monthly on the 1st, 2nd, 3rd, 11th, 22nd",
    ]);
    expect(words({ kind: "daily", every: 2 })).toEqual([
      "每 2 天",
      "Every 2 days",
    ]);
    expect(words({ kind: "yearly", every: 2 })).toEqual([
      "每 2 年",
      "Every 2 years",
    ]);
    expect(words({ kind: "daily" })).toEqual(["每天", "Daily"]);
  });

  it("titles the month and heads the week", () => {
    expect(zhCopy.todo.date.monthTitle(2026, 11)).toBe("2026年11月");
    expect(enCopy.todo.date.monthTitle(2026, 11)).toBe("November 2026");
    expect([1, 2, 3, 4, 5, 6, 7].map(zhCopy.todo.date.weekdayHead)).toEqual([
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "日",
    ]);
    expect(
      [1, 2, 3, 4, 5, 6, 7].map(enCopy.todo.date.weekdayHead).join(" "),
    ).toBe("M T W T F S S");
  });
});

// Main chat ticket 157: a repeating period's reminder Core moved on to a
// later period's time once it went off (ticket 154 behaviour 13).
describe("a period's reminder moved on", () => {
  const due = { date: "2026-11-16", hasTime: false };
  const period = (at: string, remind = true): TodoItem => ({
    kind: "todo",
    id: "todo_w",
    text: "交周报",
    state: "open",
    createdBy: "assistant",
    due,
    reminder: { taskId: "sched_w", at, state: "scheduled" },
    todoRepeat: {
      kind: "weekly",
      weekdays: [1],
      ...(remind ? { remind: { daysBefore: 1, time: "20:00" } } : {}),
    },
  });

  it("is one after the period's day, under a rule that records a reminder", () => {
    // The next period's evening before: six days after this one's day.
    const moved = period(localIso("2026-11-22", 20, 0));
    expect(reminderMovedOn(moved)).toBe(true);
    expect(reminderOffset(moved.due, moved.reminder!.at)).toEqual({
      daysBefore: -6,
      time: "20:00",
    });
    // Read as the rule's offset, not 「到期后 6 天」.
    expect(periodReminder(moved)).toEqual({ daysBefore: 1, time: "20:00" });
  });

  it("is not its own, on or before its day, nor one set by hand", () => {
    const own = period(localIso("2026-11-15", 20, 0));
    expect(reminderMovedOn(own)).toBe(false);
    expect(periodReminder(own)).toEqual({ daysBefore: 1, time: "20:00" });
    // Two days before at 09:00, set on the period: read as it is.
    const byHand = period(localIso("2026-11-14", 9, 0));
    expect(periodReminder(byHand)).toEqual({ daysBefore: 2, time: "09:00" });
    // The same day: as it is.
    expect(periodReminder(period(localIso("2026-11-16", 8, 0)))).toEqual({
      daysBefore: 0,
      time: "08:00",
    });
  });

  it("is not under a rule that records none, nor on a to-do that does not repeat", () => {
    const after = localIso("2026-11-22", 20, 0);
    const unrecorded = period(after, false);
    expect(reminderMovedOn(unrecorded)).toBe(false);
    expect(periodReminder(unrecorded)).toEqual({
      daysBefore: -6,
      time: "20:00",
    });
    const ordinary = { ...period(after), todoRepeat: undefined };
    expect(reminderMovedOn(ordinary)).toBe(false);
    expect(periodReminder(ordinary)?.daysBefore).toBe(-6);
  });

  it("reads no reminder as none", () => {
    const none = {
      ...period(localIso("2026-11-22", 20, 0)),
      reminder: undefined,
    };
    expect(reminderMovedOn(none)).toBe(false);
    expect(periodReminder(none)).toBeNull();
  });
});

// Main chat ticket 159 (PRD ruling 207 point 2): the rule's words on the
// time line, short where the due day before them already says it.
describe("the time line's short words", () => {
  const line = (
    rule: Parameters<typeof todoRepeatLineWords>[0],
    due: string | undefined,
  ) => [
    todoRepeatLineWords(rule, due, zhCopy),
    todoRepeatLineWords(rule, due, enCopy),
  ];
  // Fri 2026-11-20; November has 30 days.
  const friday = "2026-11-20";

  it("is 「每天」 「每周」 「每月」 「每年」 where the rule fits the due day", () => {
    expect(line({ kind: "daily" }, friday)).toEqual(["每天", "daily"]);
    expect(line({ kind: "weekly", weekdays: [5] }, friday)).toEqual([
      "每周",
      "weekly",
    ]);
    expect(line({ kind: "monthly", monthdays: [20] }, friday)).toEqual([
      "每月",
      "monthly",
    ]);
    expect(line({ kind: "yearly" }, friday)).toEqual(["每年", "yearly"]);
    // No weekday or date of its own: the due day's.
    expect(repeatFitsDay({ kind: "weekly" }, friday)).toBe(true);
    expect(repeatFitsDay({ kind: "monthly", monthdays: [] }, friday)).toBe(
      true,
    );
    // Every 1 written out.
    expect(
      repeatFitsDay({ kind: "weekly", weekdays: [5], every: 1 }, friday),
    ).toBe(true);
  });

  it("holds a rule's 31st on a shorter month's last day", () => {
    const the31st = { kind: "monthly" as const, monthdays: [31] };
    // November has 30: its 30th is the rule's day.
    expect(line(the31st, "2026-11-30")).toEqual(["每月", "monthly"]);
    expect(repeatFitsDay(the31st, "2026-10-31")).toBe(true);
    // February 2027 has 28; a rule's 30th falls on its 28th.
    expect(
      repeatFitsDay({ kind: "monthly", monthdays: [30] }, "2027-02-28"),
    ).toBe(true);
    // Not the day before the month's last.
    expect(line(the31st, "2026-11-29")).toEqual([
      "每月 31 日",
      "Monthly on the 31st",
    ]);
  });

  it("is the rule whole where it says more: moved off its day, every 2, two days", () => {
    // A period moved by hand to another weekday: the rule's own.
    expect(line({ kind: "weekly", weekdays: [1] }, friday)).toEqual([
      "每周一",
      "Weekly on Mon",
    ]);
    expect(line({ kind: "monthly", monthdays: [15] }, friday)).toEqual([
      "每月 15 日",
      "Monthly on the 15th",
    ]);
    expect(line({ kind: "weekly", weekdays: [5], every: 2 }, friday)).toEqual([
      "每 2 周的周五",
      "Every 2 weeks on Fri",
    ]);
    expect(
      line({ kind: "monthly", monthdays: [20], every: 3 }, friday),
    ).toEqual(["每 3 个月的 20 日", "Every 3 months on the 20th"]);
    expect(line({ kind: "daily", every: 2 }, friday)).toEqual([
      "每 2 天",
      "Every 2 days",
    ]);
    expect(line({ kind: "yearly", every: 2 }, friday)).toEqual([
      "每 2 年",
      "Every 2 years",
    ]);
    expect(line({ kind: "weekly", weekdays: [1, 5] }, friday)).toEqual([
      "每周一·五",
      "Weekly on Mon, Fri",
    ]);
    expect(line({ kind: "monthly", monthdays: [5, 20] }, friday)).toEqual([
      "每月 5·20 日",
      "Monthly on the 5th, 20th",
    ]);
    // No due day to say it, or one that does not parse.
    expect(line({ kind: "weekly", weekdays: [5] }, undefined)).toEqual([
      "每周五",
      "Weekly on Fri",
    ]);
    expect(repeatFitsDay({ kind: "daily" }, "2026-02-30")).toBe(false);
  });
});

// Main chat ticket 159 (PRD ruling 207 point 3): a period's reminder that
// is the one its rule records, said from the due day.
describe("a period's reminder on its rule", () => {
  const period = (
    at: string | null,
    remind: { daysBefore: number; time: string } | null,
  ): TodoItem => ({
    kind: "todo",
    id: "todo_f",
    text: "交周报",
    state: "open",
    createdBy: "assistant",
    due: { date: "2026-11-20", hasTime: false },
    reminder: at ? { taskId: "sched_f", at, state: "scheduled" } : undefined,
    todoRepeat: {
      kind: "weekly",
      weekdays: [5],
      ...(remind ? { remind } : {}),
    },
  });

  it("is how many days before, when the period's reminder is the rule's", () => {
    for (const [day, daysBefore] of [
      ["2026-11-20", 0],
      ["2026-11-19", 1],
      ["2026-11-18", 2],
      ["2026-11-13", 7],
    ] as const) {
      expect(
        reminderOnRule(
          period(localIso(day, 9, 0), { daysBefore, time: "09:00" }),
        ),
      ).toBe(daysBefore);
    }
  });

  it("is none for one that is not: another time or day, moved on, none on the rule, none at all", () => {
    const rule = { daysBefore: 1, time: "09:00" };
    // The day before, but at 20:00 — set by hand.
    expect(reminderOnRule(period(localIso("2026-11-19", 20, 0), rule))).toBe(
      null,
    );
    // Two days before at 09:00 — set by hand, or moved toward the day.
    expect(reminderOnRule(period(localIso("2026-11-18", 9, 0), rule))).toBe(
      null,
    );
    // Moved on by Core to the next period's (ticket 157).
    expect(reminderOnRule(period(localIso("2026-11-26", 9, 0), rule))).toBe(
      null,
    );
    // A rule that records none; no reminder; a rule's after the day.
    expect(reminderOnRule(period(localIso("2026-11-19", 9, 0), null))).toBe(
      null,
    );
    expect(reminderOnRule(period(null, rule))).toBe(null);
    expect(
      reminderOnRule(
        period(localIso("2026-11-21", 9, 0), { daysBefore: -1, time: "09:00" }),
      ),
    ).toBe(null);
    // A to-do that does not repeat.
    expect(
      reminderOnRule({
        ...period(localIso("2026-11-19", 9, 0), rule),
        todoRepeat: undefined,
      }),
    ).toBe(null);
  });

  it("words it from the due day, the clock alone on the day itself", () => {
    const zh = (n: number) => zhCopy.todo.reminderBefore(n, "09:00");
    const en = (n: number) => enCopy.todo.reminderBefore(n, "9:00 AM");
    expect([0, 1, 2, 3, 7].map(zh)).toEqual([
      "09:00",
      "前一天 09:00",
      "提前 2 天 09:00",
      "提前 3 天 09:00",
      "提前 1 周 09:00",
    ]);
    expect([0, 1, 2, 3, 7].map(en)).toEqual([
      "9:00 AM",
      "day before 9:00 AM",
      "2 days before 9:00 AM",
      "3 days before 9:00 AM",
      "1 week before 9:00 AM",
    ]);
  });
});
