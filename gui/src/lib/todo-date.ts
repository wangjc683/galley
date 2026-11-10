import type { AppCopy } from "@/i18n/types";
import type {
  TodoDue,
  TodoItem,
  TodoRepeat,
  TodoRepeatRemind,
  TodoRepeatRule,
} from "@/lib/assistant-todo";

/**
 * The to-do panel's date popover (main chat ticket 156, PRD ruling 205):
 * the month grid, the quick picks, a reminder read as days before the due
 * day and a time, the rule's five choices and a rule in words. Pure: the
 * calendar days are counted on `YYYY-MM-DD` keys in UTC arithmetic, so a
 * day is a day in any zone and across a daylight-saving change; only
 * `dayOf` (an instant's local day) and `todayKey` read the machine's zone,
 * as the panel's rows do (`useDayStamp`).
 */

/** A calendar day, `YYYY-MM-DD`. */
export type DayKey = string;

/** A month of a year; `month` 1–12. */
export interface MonthCursor {
  year: number;
  month: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The key of a year, month (1–12) and day; out-of-range days and months
 * roll over as the calendar does (the 0th is the last of the month
 * before). */
export function dayKey(year: number, month: number, day: number): DayKey {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad2(
    date.getUTCMonth() + 1,
  )}-${pad2(date.getUTCDate())}`;
}

/** A key's year, month (1–12) and day; null for one that is not a day. */
export function parseDay(
  key: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  if (dayKey(year, month, day) !== key) return null;
  return { year, month, day };
}

function utcMs(key: DayKey): number {
  const parsed = parseDay(key);
  if (!parsed) return Number.NaN;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

/** `n` days after `key` (before it, below 0). */
export function addDays(key: DayKey, n: number): DayKey {
  const parsed = parseDay(key);
  if (!parsed) return key;
  return dayKey(parsed.year, parsed.month, parsed.day + n);
}

/** How many days `to` is after `from` (below 0 before it). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** How many days the month has: 28 to 31. */
export function daysInMonth({ year, month }: MonthCursor): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The ISO weekday of a day: 1 Monday … 7 Sunday. */
export function isoWeekday(key: DayKey): number {
  const weekday = new Date(utcMs(key)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The month a day is in. */
export function monthOf(key: DayKey): MonthCursor {
  const parsed = parseDay(key);
  return parsed
    ? { year: parsed.year, month: parsed.month }
    : { year: 1970, month: 1 };
}

/** `n` months after `cursor` (before it, below 0), across years. */
export function addMonths(cursor: MonthCursor, n: number): MonthCursor {
  const index = cursor.year * 12 + (cursor.month - 1) + n;
  return {
    year: Math.floor(index / 12),
    month: (((index % 12) + 12) % 12) + 1,
  };
}

/** The same date `n` months on, held to that month's last day (Jan 31
 * one month on is Feb 28, or 29). */
export function addMonthsToDay(key: DayKey, n: number): DayKey {
  const parsed = parseDay(key);
  if (!parsed) return key;
  const to = addMonths(parsed, n);
  return dayKey(to.year, to.month, Math.min(parsed.day, daysInMonth(to)));
}

/**
 * A month as the popover draws it: rows of seven, Monday first, each
 * cell a day of the month or null — the days before its 1st and after its
 * last are left blank, as the sketch has them. Four to six rows.
 */
export function monthGrid(cursor: MonthCursor): (DayKey | null)[][] {
  const first = dayKey(cursor.year, cursor.month, 1);
  const lead = isoWeekday(first) - 1;
  const days = daysInMonth(cursor);
  const cells: (DayKey | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) =>
      dayKey(cursor.year, cursor.month, i + 1),
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (DayKey | null)[][] = [];
  for (let at = 0; at < cells.length; at += 7) {
    rows.push(cells.slice(at, at + 7));
  }
  return rows;
}

/** The local day an instant falls on (this machine's zone); null when it
 * does not parse. */
export function dayOf(ms: number): DayKey | null {
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  return dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Today, from the panel's day stamp (`useDayStamp`). */
export function todayKey(todayStartMs: number): DayKey {
  return dayOf(todayStartMs) ?? dayKey(1970, 1, 1);
}

/** 「下周一」: the first Monday after today — a week on when today is a
 * Monday. */
export function nextMonday(today: DayKey): DayKey {
  return addDays(today, 8 - isoWeekday(today));
}

/** Where a key in the month grid moves the focused day (ticket 156):
 * the arrows a day or a week, PageUp / PageDown a month (held to its last
 * day); null for any other key. */
export function calendarKeyMove(day: DayKey, key: string): DayKey | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(day, -1);
    case "ArrowRight":
      return addDays(day, 1);
    case "ArrowUp":
      return addDays(day, -7);
    case "ArrowDown":
      return addDays(day, 7);
    case "PageUp":
      return addMonthsToDay(day, -1);
    case "PageDown":
      return addMonthsToDay(day, 1);
    default:
      return null;
  }
}

/** What `update_todo`'s `due` takes: the day, or the day and a local
 * time `HH:MM`. */
export function dueWrite(day: DayKey, time: string | null): string {
  return time ? `${day}T${time}` : day;
}

/** The local time `HH:MM` a due date has, or null for a day alone. */
export function dueTime(due: TodoDue | undefined): string | null {
  return due?.hasTime && due.time ? due.time : null;
}

/** The days before the due day the reminder's choice offers, 「当天」 to
 * 「提前 1 周」. */
export const REMIND_DAY_CHOICES: readonly number[] = [0, 1, 2, 3, 7];

/** The time a reminder picked for a to-do with none takes when the due
 * date has no time of its own. */
export const DEFAULT_REMIND_TIME = "09:00";

function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The time a reminder starts at when the user picks one for a to-do that
 * has none (ticket 156): the due date's time when it has one, else
 * `DEFAULT_REMIND_TIME`. On a reminder day that is today, a time no later
 * than now (`nowMinutes`, since local midnight) becomes the next whole
 * hour, while that is still today: Core hangs no reminder whose time has
 * passed, and the time can only be changed on a reminder that is there,
 * so 「当天」 on a to-do due today must not be let go the moment it is
 * picked.
 */
export function newReminderTime(
  dueAt: string | null,
  reminderDay: DayKey,
  today: DayKey,
  nowMinutes: number,
): string {
  const time = dueAt ?? DEFAULT_REMIND_TIME;
  const minutes = minutesOf(time);
  if (reminderDay !== today || minutes === null || minutes > nowMinutes) {
    return time;
  }
  const next = (Math.floor(nowMinutes / 60) + 1) * 60;
  return next < 24 * 60 ? `${pad2(next / 60)}:00` : time;
}

/** A time input's value as `update_todo` takes it, `HH:MM`; null for one
 * not filled in. */
export function timeValue(raw: string): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * A to-do's reminder as the popover reads it (ticket 156): how many days
 * before the due day its local day is (0 the same day, below 0 after it),
 * and its local time `HH:MM` — the model each period of a rule keeps its
 * reminder in (ticket 154's `remind`). Null without a due date, or for an
 * instant that does not parse.
 */
export function reminderOffset(
  due: TodoDue | undefined,
  reminderAt: string | undefined,
): TodoRepeatRemind | null {
  if (!due || !reminderAt) return null;
  const ms = Date.parse(reminderAt);
  const day = dayOf(ms);
  if (!day || !parseDay(due.date)) return null;
  const date = new Date(ms);
  return {
    daysBefore: daysBetween(day, due.date),
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
}

/**
 * Whether a repeating period's reminder is one Core moved on (main chat
 * ticket 157): its rule records a reminder, and the reminder reads as
 * after the period's due day. A period's reminder goes off once; left
 * unsettled, Core arms the same reminder again at a later period's time
 * (ticket 154 behaviour 13, PRD ruling 204 point 12), which is after this
 * period's day — a reminder the popover can set never is (its choices are
 * the same day or days before). Read off where it is, it would be
 * 「到期后 7 天」. Not on a rule that records none: Core moves nothing then.
 */
export function reminderMovedOn(item: TodoItem): boolean {
  if (!item.todoRepeat?.remind) return false;
  const read = reminderOffset(item.due, item.reminder?.at);
  return read !== null && read.daysBefore < 0;
}

/**
 * A to-do's reminder as the date popover reads it (ticket 156's
 * `reminderOffset`), but a repeating period's that Core moved on
 * (`reminderMovedOn`) as its rule's offset (`todoRepeat.remind`, main
 * chat ticket 157) — what each period of the rule gets, and what Core
 * moves it by when the day changes (`core/src/todo_by_hand.rs`). A
 * period's own reminder set by hand reads as it is, as one on a rule that
 * records none does; no reminder (cancelled, or none) reads as none.
 */
export function periodReminder(item: TodoItem): TodoRepeatRemind | null {
  const read = reminderOffset(item.due, item.reminder?.at);
  const rule = item.todoRepeat?.remind;
  return read && rule && reminderMovedOn(item) ? rule : read;
}

/** The five choices of 「重复」, and what a rule that is none of them
 * reads as. */
export type RepeatChoice = "none" | "daily" | "weekly" | "monthly" | "yearly";

/**
 * Which of the five a to-do's rule is (ticket 156): 「不重复」 without
 * one; every day, every week on one day, every month on one day, every
 * year — each every 1 — are 「每天」 「每周」 「每月」 「每年」. Anything
 * else (every 2 weeks, every 3 months, two days a week or a month) is
 * `other`: the row says the rule in words, read only.
 */
export function repeatChoice(
  repeat: TodoRepeat | undefined,
): RepeatChoice | "other" {
  if (!repeat) return "none";
  if ((repeat.every ?? 1) !== 1) return "other";
  switch (repeat.kind) {
    case "daily":
    case "yearly":
      return repeat.kind;
    case "weekly":
      return (repeat.weekdays?.length ?? 0) <= 1 ? "weekly" : "other";
    case "monthly":
      return (repeat.monthdays?.length ?? 0) <= 1 ? "monthly" : "other";
  }
}

/** The rule a choice gives a to-do due `due` (ticket 156): every week on
 * its weekday, every month on its date, every year (Core takes the month
 * and day from the due date), every day; every 1. */
export function repeatRuleFor(
  choice: Exclude<RepeatChoice, "none">,
  due: DayKey,
): TodoRepeatRule {
  switch (choice) {
    case "daily":
    case "yearly":
      return { kind: choice };
    case "weekly":
      return { kind: "weekly", weekdays: [isoWeekday(due)] };
    case "monthly":
      return { kind: "monthly", monthdays: [parseDay(due)?.day ?? 1] };
  }
}

/**
 * A rule in words (ticket 156), as Core's `repeat_words` says it to the
 * model, in the interface's language: 「每 2 周的周一·四」 「每 3 个月的
 * 15 日」, "Every 2 weeks on Mon, Thu", "Every 3 months on the 15th".
 */
export function todoRepeatWords(rule: TodoRepeatRule, copy: AppCopy): string {
  const words = copy.todo.date.rule;
  const every = Math.max(1, rule.every ?? 1);
  switch (rule.kind) {
    case "daily":
      return words.daily(every);
    case "yearly":
      return words.yearly(every);
    case "weekly":
      return words.weekly(
        every,
        (rule.weekdays ?? []).map(words.weekday).join(words.joinDays),
      );
    case "monthly":
      return words.monthly(
        every,
        (rule.monthdays ?? []).map(words.monthday).join(words.joinDays),
      );
  }
}
