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
 * A break is measured against the previous USER message. On the
 * dogfood data (workbench.db, 2026-05-15 → 09-23) that and "the
 * previous message of any kind" found the same 21 breaks, not one
 * apart.
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

function localDayStart(ms: number): number {
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
 *   - the session's first dated user message;
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
 */
export function userTimeMarks(
  turns: readonly Turn[],
  {
    previousUserCreatedAt = null,
    thresholdMs = USER_TIME_BREAK_MS,
  }: { previousUserCreatedAt?: string | null; thresholdMs?: number } = {},
): Map<number, UserTimeMark> {
  const marks = new Map<number, UserTimeMark>();
  let prevMs: number | null = parseTime(previousUserCreatedAt ?? undefined);
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (turn.role !== "user") continue;
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
