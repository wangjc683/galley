import type { ResolvedLanguage } from "@/lib/language";
import type {
  LedgerEntry,
  LedgerRun,
  LedgerSwitch,
  MemoryOverview,
} from "@/lib/memory";
import { formatMessageDateTime } from "@/lib/message-time";

/**
 * Pure view logic for Settings → Memory (ticket 04b): which areas show,
 * the order of entries, how a source id reads, and the dates. The page
 * (SettingsMemory.tsx) only renders what these return.
 */

/**
 * Areas 2–6 (activities, emotions, the do-not-record list, the
 * exclusions) show unless the ledger is not on AND there is nothing to
 * show: no ledger file, nothing on the do-not-record list, and no
 * exclusion mark. The ticket's rule is 「undecided / off 而且文件都不在」;
 * exclusions live in Galley's database, not a file, and are kept
 * whether or not the ledger is on, so a mark left from an earlier "on"
 * keeps area 6 reachable (it is the only place to lift it).
 */
export function showsLedgerAreas(overview: MemoryOverview): boolean {
  const { ledger } = overview;
  if (ledger.switch.state === "on") return true;
  return (
    ledger.activities.kind !== "absent" ||
    ledger.emotions.kind !== "absent" ||
    ledger.forgotten.length > 0 ||
    ledger.exclusions.length > 0
  );
}

/** Newest 「最近」 first; entries without one keep their file order
 * after the dated ones. */
export function sortByLastSeen(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const left = a.entry.lastSeen ?? "";
      const right = b.entry.lastSeen ?? "";
      if (left !== right) {
        if (!left) return 1;
        if (!right) return -1;
        return left < right ? 1 : -1;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** The sessions behind an entry: its `sessions` plus any quote's
 * session not already listed, in that order, without repeats. */
export function entrySources(entry: {
  sessions: readonly string[];
  quotes: readonly { session?: string }[];
}): string[] {
  const out: string[] = [];
  for (const id of entry.sessions) {
    if (id && !out.includes(id)) out.push(id);
  }
  for (const quote of entry.quotes) {
    if (quote.session && !out.includes(quote.session)) out.push(quote.session);
  }
  return out;
}

const IM_SOURCE = /^im-(.+)-(\d{4}-\d{2}-\d{2})$/;

/** `im-<channel>-<YYYY-MM-DD>` (core/src/ledger/batch.rs), or null for a
 * Galley session id. */
export function parseImSource(
  id: string,
): { channel: string; day: string } | null {
  const match = IM_SOURCE.exec(id);
  return match ? { channel: match[1], day: match[2] } : null;
}

export type IMChannel = "wechat" | "feishu" | "telegram" | "discord";

export function knownImChannel(channel: string): IMChannel | null {
  return channel === "wechat" ||
    channel === "feishu" ||
    channel === "telegram" ||
    channel === "discord"
    ? channel
    : null;
}

/** What the page knows about a Galley session it links to. */
export interface SessionLookup {
  title: string;
  archived: boolean;
}

export type ResolvedSource =
  | { kind: "session"; id: string; session: SessionLookup | null }
  | { kind: "im"; id: string; channel: IMChannel | null; day: string };

export function resolveSource(
  id: string,
  lookup: (sessionId: string) => SessionLookup | null,
): ResolvedSource {
  const im = parseImSource(id);
  if (im) {
    return { kind: "im", id, channel: knownImChannel(im.channel), day: im.day };
  }
  return { kind: "session", id, session: lookup(id) };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const EN_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const EN_YEAR_DAY = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A local calendar day from `YYYY-MM-DD`, or null. */
function parseDay(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * `YYYY-MM-DD` as the app writes a date (lib/message-time's shapes
 * without the clock): 「9月27日」 / "Sep 27", with the year only when it
 * is not this one. Unreadable input comes back as it was.
 */
export function formatLedgerDay(
  ymd: string,
  todayStartMs: number,
  language: ResolvedLanguage,
): string {
  const date = parseDay(ymd);
  if (!date) return ymd;
  const sameYear = date.getFullYear() === new Date(todayStartMs).getFullYear();
  if (language === "zh-CN") {
    const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
    return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
  }
  return (sameYear ? EN_DAY : EN_YEAR_DAY).format(date);
}

/** A ledger time, `YYYY-MM-DD HH:MM` local, as the app writes a date
 * and time (「9月27日 07:00」). Unreadable input comes back as it was. */
export function formatLedgerMinute(
  value: string,
  todayStartMs: number,
  language: ResolvedLanguage,
): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value;
  return (
    formatMessageDateTime(
      `${match[1]}T${match[2]}:${match[3]}:00`,
      todayStartMs,
      language,
    ) ?? value
  );
}

export interface ScheduleDayWords {
  today: (time: string) => string;
  tomorrow: (time: string) => string;
  yesterday: (time: string) => string;
}

const EN_CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * An RFC3339 instant near today — the last run, the next one: 「今天
 * 04:00」, 「明天 04:00」, 「昨天 04:00」, otherwise the date and time.
 * Null when unreadable.
 */
export function formatScheduleTime(
  iso: string,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: ScheduleDayWords,
): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const today = new Date(todayStartMs);
  today.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const clock =
    language === "zh-CN"
      ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      : EN_CLOCK.format(date);
  if (dayDiff === 0) return words.today(clock);
  if (dayDiff === 1) return words.tomorrow(clock);
  if (dayDiff === -1) return words.yesterday(clock);
  return formatMessageDateTime(iso, todayStartMs, language);
}

export interface SwitchStatusCopy {
  sinceFrom: (time: string) => string;
  sinceEarliest: string;
  running: string;
  lastRun: (time: string, outcome: string) => string;
  outcomeSucceeded: string;
  outcomeEmpty: string;
  outcomeFailed: string;
  outcomeRunning: string;
  nextRun: (time: string) => string;
  dayWords: ScheduleDayWords;
}

export interface SwitchStatus {
  /** The pieces of the status line, joined by 「 · 」. */
  parts: string[];
  running: boolean;
  /** The last run failed: its reason, for a second line. */
  failureDetail: string | null;
}

/**
 * The status line under the switch while it is on: where reading
 * starts, the last run (or 「正在整理」 while one runs), the next one.
 * Null while the ledger is not on.
 */
export function switchStatus({
  ledgerSwitch,
  running,
  lastRun,
  nextRunAt,
  todayStartMs,
  language,
  copy,
}: {
  ledgerSwitch: LedgerSwitch;
  running: boolean;
  lastRun?: LedgerRun;
  nextRunAt?: string;
  todayStartMs: number;
  language: ResolvedLanguage;
  copy: SwitchStatusCopy;
}): SwitchStatus | null {
  if (ledgerSwitch.state !== "on") return null;
  const parts: string[] = [];
  if (ledgerSwitch.lookBack) {
    parts.push(copy.sinceEarliest);
  } else {
    const since = formatMessageDateTime(
      ledgerSwitch.since,
      todayStartMs,
      language,
    );
    if (since) parts.push(copy.sinceFrom(since));
  }
  let failureDetail: string | null = null;
  if (running) {
    parts.push(copy.running);
  } else if (lastRun) {
    const time = formatScheduleTime(
      lastRun.startedAt,
      todayStartMs,
      language,
      copy.dayWords,
    );
    const outcome = {
      running: copy.outcomeRunning,
      succeeded: copy.outcomeSucceeded,
      empty: copy.outcomeEmpty,
      failed: copy.outcomeFailed,
    }[lastRun.outcome];
    if (time) parts.push(copy.lastRun(time, outcome));
    if (lastRun.outcome === "failed" && lastRun.detail) {
      failureDetail = lastRun.detail;
    }
  }
  if (nextRunAt && !running) {
    const next = formatScheduleTime(
      nextRunAt,
      todayStartMs,
      language,
      copy.dayWords,
    );
    if (next) parts.push(copy.nextRun(next));
  }
  return { parts, running, failureDetail };
}
