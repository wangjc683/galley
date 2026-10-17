import type { ResolvedLanguage } from "@/lib/language";
import type { Turn } from "@/types/conversation";

/**
 * Send time on user messages (message-timestamps PRD, 2026-09-28).
 *
 * Only a user message at a break shows its time, always visible above
 * the message; other messages show none. This module decides which
 * user turns sit at a break (`userTimeMarks`) and turns a timestamp
 * into the label text (`formatMessageTime`). Both are pure
 * — "today" arrives as `todayStartMs` from `useDayStamp()`, never from
 * `Date.now()` during render.
 *
 * A break is measured against the previous USER message (the main
 * chat's first one against its greeting). On the dogfood data
 * (workbench.db, 2026-05-15 → 09-23) that and "the previous message of
 * any kind" found the same 21 breaks, not one apart.
 */

/** Gap that makes a user message a break: strictly MORE than an hour
 * since the previous user message (exactly 60 minutes is not one). */
export const USER_TIME_BREAK_MS = 60 * 60 * 1000;

export interface UserTimeMark {
  /** Always visible above the message. */
  pinned: boolean;
  /** The message falls on a different local day than the previous
   * user message — a today label reads 「今天 09:10」, not bare 「09:10」. */
  withTodayWord: boolean;
}

function parseTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** The local midnight a moment's day starts on. */
export function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Turn index → time mark, for every user turn with a usable
 * `createdAt`. ask_user replies are user turns and take part like any
 * other.
 *
 * Pinned when the turn is:
 *   - the session's first dated user message (in the main chat, when
 *     more than `thresholdMs` after the greeting or on another day —
 *     see below);
 *   - more than `thresholdMs` after the previous user message;
 *   - on a different local day than the previous user message — a
 *     backstop (0 cases in the data) so a 「今天 / 昨天」 label never
 *     goes missing at a day change;
 *   - Supervisor-originated — its provenance row is there anyway.
 *
 * A turn without a usable `createdAt` gets no mark and is not a
 * baseline either: the next dated turn compares against the dated one
 * before it, and a dated turn with no dated predecessor counts as the
 * first.
 *
 * `previousUserCreatedAt` is the send time of the last user message
 * before `turns` when the conversation holds only its later part
 * (paged history, main-chat ticket 12): the first user turn here
 * measures against it, so a break reads the same before and after the
 * earlier page loads.
 *
 * The main chat's greeting opens its conversation, and the assistant's
 * conversation draws the greeting's time too (main chat ticket 20): the
 * first user message measures against the greeting as against a
 * previous user message, so a first word within the hour, on the same
 * day, adds no second time right under the greeting's. Other
 * conversations have no greeting. While paged history has not loaded
 * the greeting yet, the first user message is the first as before (Core
 * names no user message before it) and stays pinned until the
 * greeting's page loads.
 *
 * `skip`: user turns nothing draws and nothing measures against. In the
 * assistant's conversation a subtask report row (main chat ticket 31)
 * is never drawn either, but it dates the reply that answers it, which
 * has no user message before it — as the greeting does: it takes part
 * like a user message and its mark is drawn above its round's first
 * row. A round that draws nothing (a reply that said nothing) passes
 * its report in `skip`.
 */
export function userTimeMarks(
  turns: readonly Turn[],
  {
    previousUserCreatedAt = null,
    thresholdMs = USER_TIME_BREAK_MS,
    skip,
  }: {
    previousUserCreatedAt?: string | null;
    thresholdMs?: number;
    skip?: ReadonlySet<number>;
  } = {},
): Map<number, UserTimeMark> {
  const marks = new Map<number, UserTimeMark>();
  let prevMs: number | null = parseTime(previousUserCreatedAt ?? undefined);
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (turn.role === "agent" && turn.greeting) {
      if (prevMs === null) prevMs = parseTime(turn.createdAt);
      continue;
    }
    if (turn.role !== "user" || skip?.has(index)) continue;
    const ms = parseTime(turn.createdAt);
    if (ms === null) continue;
    const newDay =
      prevMs !== null && localDayStart(ms) !== localDayStart(prevMs);
    const pinned =
      prevMs === null ||
      ms - prevMs > thresholdMs ||
      newDay ||
      turn.origin?.via === "supervisor";
    marks.set(index, { pinned, withTodayWord: newDay });
    prevMs = ms;
  }
  return marks;
}

/** Localized day words; each receives the formatted clock time so the
 * locale owns word order and spacing. */
export interface MessageTimeDayWords {
  today: (time: string) => string;
  yesterday: (time: string) => string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// English follows English habits: Intl's en-US defaults, 12-hour clock.
const EN_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const EN_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const EN_YEAR_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Label text, to the minute:
 *
 *   today, previous user message also today (or none)   16:05
 *   today, previous user message on an earlier day      今天 09:10
 *   yesterday                                           昨天 21:14
 *   earlier this year                                   9月21日 14:32
 *   an earlier year                                     2025年9月21日 14:32
 *
 * Chinese is a zero-padded 24-hour clock, built by hand so the shape
 * does not drift with the engine's ICU data; English uses Intl's en-US
 * forms (12-hour). `withTodayWord` only matters for today. Returns
 * null for an unparseable timestamp.
 */
export function formatMessageTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  options: { withTodayWord: boolean; words: MessageTimeDayWords },
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const date = new Date(ms);
  const today = localDayStart(todayStartMs);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const day = localDayStart(ms);
  const zh = language === "zh-CN";
  const clock = zh
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    : EN_TIME.format(date);

  if (day === today) {
    return options.withTodayWord ? options.words.today(clock) : clock;
  }
  if (day === yesterdayDate.getTime()) {
    return options.words.yesterday(clock);
  }
  return dateWithClock(date, today, zh, clock);
}

/** Month, day and clock, with the year only when it is not this year's. */
function dateWithClock(
  date: Date,
  todayStartMs: number,
  zh: boolean,
  clock: string,
): string {
  const sameYear = date.getFullYear() === new Date(todayStartMs).getFullYear();
  if (zh) {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return sameYear
      ? `${monthDay} ${clock}`
      : `${date.getFullYear()}年${monthDay} ${clock}`;
  }
  return (sameYear ? EN_DATE_TIME : EN_YEAR_DATE_TIME).format(date);
}

/**
 * The same date and time shapes without the 今天 / 昨天 words, for a
 * timestamp that follows a label (Settings → Channels「绑定于 10月8日
 * 14:32」/ "Paired at Oct 8, 2:32 PM"), where a day word reads oddly
 * mid-sentence. Always carries the date; the year only when it is not
 * the current one. Null when unparseable.
 */
export function formatMessageDateTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const date = new Date(ms);
  const zh = language === "zh-CN";
  const clock = zh
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    : EN_TIME.format(date);
  return dateWithClock(date, localDayStart(todayStartMs), zh, clock);
}

const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const EN_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const EN_YEAR_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** How many calendar days `ms` falls before the local day `today`
 * starts on (0 = today). Counted on dates, not 24-hour spans, so a
 * daylight-saving day still counts as one. */
function daysBefore(ms: number, today: number): number {
  const day = new Date(localDayStart(ms));
  const start = new Date(today);
  const utcDay = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const utcStart = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  return Math.round((utcStart - utcDay) / 86_400_000);
}

/**
 * A chat list's time (main chat ticket 18: the sidebar's assistant card
 * dates its last message the way an IM list does) — one word, never a
 * clock and a date together:
 *
 *   today                       11:50        11:50 AM
 *   yesterday                   昨天          Yesterday
 *   2–6 days back               周一          Mon
 *   earlier this year           10月7日       Oct 7
 *   an earlier year             2025年10月7日  Oct 7, 2025
 *
 * Shapes as in `formatMessageTime` (Chinese built by hand, English from
 * Intl's en-US); the day word comes from the locale. A time later than
 * today (a skewed clock) reads as today's. Pure: `todayStartMs` is
 * `useDayStamp()`'s, so a list kept open past midnight re-dates when
 * the stamp moves. Null for an unparseable timestamp.
 */
export function formatListTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: { yesterday: string },
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const date = new Date(ms);
  const today = localDayStart(todayStartMs);
  const zh = language === "zh-CN";
  const days = daysBefore(ms, today);
  if (days <= 0) {
    return zh
      ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      : EN_TIME.format(date);
  }
  if (days === 1) return words.yesterday;
  if (days <= 6) {
    return zh ? ZH_WEEKDAYS[date.getDay()] : EN_WEEKDAY.format(date);
  }
  const sameYear = date.getFullYear() === new Date(today).getFullYear();
  if (zh) {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
  }
  return (sameYear ? EN_DATE : EN_YEAR_DATE).format(date);
}

/**
 * The clock alone, as every shape here writes it: zero-padded 24-hour
 * 「14:00」 in Chinese, en-US 「2:00 PM」 in English (main chat PRD
 * ruling 97: a to-do's reminder on its due day, a time under 今天).
 * Null for an unparseable timestamp.
 */
export function formatClock(
  iso: string,
  language: ResolvedLanguage,
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const date = new Date(ms);
  return language === "zh-CN"
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    : EN_TIME.format(date);
}

/** The day words a scheduled time can carry, each around the clock. */
export interface ScheduleTimeDayWords {
  today: (time: string) => string;
  tomorrow: (time: string) => string;
  yesterday: (time: string) => string;
}

/**
 * A scheduled time to the minute, either side of now (main chat ticket
 * 37: the reminder card under a reply and the 待办 list), counted on
 * local calendar days:
 *
 *   today                    今天 21:40        Today 9:40 PM
 *   tomorrow                 明天 09:00        Tomorrow 9:00 AM
 *   yesterday                昨天 09:00        Yesterday 9:00 AM
 *   2–6 days away or back    周五 09:00        Fri 9:00 AM
 *   further this year        10月30日 09:00    Oct 30, 9:00 AM
 *   another year             2027年1月3日 09:00  Jan 3, 2027, 9:00 AM
 *
 * Which side of now a weekday is on, the reader's group says
 * (接下来 / 最近做完). Shapes as in `formatMessageTime`; pure over
 * `todayStartMs` (`useDayStamp()`). Null when unparseable.
 */
export function formatScheduleTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: ScheduleTimeDayWords,
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  const date = new Date(ms);
  const today = localDayStart(todayStartMs);
  const zh = language === "zh-CN";
  const clock = zh
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    : EN_TIME.format(date);
  const back = daysBefore(ms, today);
  if (back === 0) return words.today(clock);
  if (back === -1) return words.tomorrow(clock);
  if (back === 1) return words.yesterday(clock);
  if (Math.abs(back) <= 6) {
    const weekday = zh ? ZH_WEEKDAYS[date.getDay()] : EN_WEEKDAY.format(date);
    return `${weekday} ${clock}`;
  }
  return dateWithClock(date, today, zh, clock);
}

/** The day words a day without a time can carry. */
export interface ScheduleDayWords {
  today: string;
  tomorrow: string;
  yesterday: string;
}

/** A local calendar day, `YYYY-MM-DD`, as the local midnight it starts
 * on; null when it is not one. */
export function localDayMs(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * A day without a time (main chat ticket 42: a to-do due 「周五前」, a
 * floating local date, `YYYY-MM-DD`), in `formatScheduleTime`'s shapes
 * without the clock:
 *
 *   today / tomorrow / yesterday   今天 / 明天 / 昨天    Today / Tomorrow / Yesterday
 *   2–6 days away or back          周五                  Fri
 *   further this year              10月30日              Oct 30
 *   another year                   2027年1月3日          Jan 3, 2027
 *
 * Pure over `todayStartMs` (`useDayStamp()`). Null when `day` is not a
 * date.
 */
export function formatScheduleDay(
  day: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: ScheduleDayWords,
): string | null {
  const ms = localDayMs(day);
  if (ms === null) return null;
  const date = new Date(ms);
  const today = localDayStart(todayStartMs);
  const zh = language === "zh-CN";
  const back = daysBefore(ms, today);
  if (back === 0) return words.today;
  if (back === -1) return words.tomorrow;
  if (back === 1) return words.yesterday;
  if (Math.abs(back) <= 6) {
    return zh ? ZH_WEEKDAYS[date.getDay()] : EN_WEEKDAY.format(date);
  }
  const sameYear = date.getFullYear() === new Date(today).getFullYear();
  if (zh) {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
  }
  return (sameYear ? EN_DATE : EN_YEAR_DATE).format(date);
}

/** How many local calendar days `day` (`YYYY-MM-DD`) lies before the
 * day `todayStartMs` falls on: 0 today, negative ahead; null when it is
 * not a date. */
export function calendarDaysBefore(
  day: string,
  todayStartMs: number,
): number | null {
  const ms = localDayMs(day);
  return ms === null ? null : daysBefore(ms, localDayStart(todayStartMs));
}

const FULL_FORMATS: Record<ResolvedLanguage, Intl.DateTimeFormat> = {
  "zh-CN": new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "short",
  }),
  "en-US": new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }),
};

/**
 * Full date and time with the weekday, for the tooltip on an
 * always-visible label (「2026年9月28日星期一 16:05」 /
 * "Monday, September 28, 2026 at 4:05 PM"). Null when unparseable.
 */
export function formatMessageTimeFull(
  iso: string,
  language: ResolvedLanguage,
): string | null {
  const ms = parseTime(iso);
  if (ms === null) return null;
  return FULL_FORMATS[language].format(new Date(ms));
}
