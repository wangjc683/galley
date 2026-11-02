import type { ResolvedLanguage } from "@/lib/language";
import { formatPastDay, localDayStart } from "@/lib/message-time";
import { firstRowBelow } from "@/lib/scroll-anchor";

/*
 * The main chat's floating day (main chat PRD ruling 171, ticket 124):
 * while you scroll back through the conversation, a capsule at the top
 * of it says which day the row at the top of the viewport was said on,
 * and fades a second after you stop. Not while that row is today. This
 * module reads the row and words the day; useFloatingDay wires it to
 * the scrolling, FloatingDay draws it.
 */

/** The conversation's rows: the children of Conversation's root (the
 * selector lib/scroll-anchor.ts reads them by). */
const ROWS_SELECTOR = '[data-role="conversation"]';

/** The attribute a row that draws a message carries its moment in, in
 * ms (Conversation, the main chat only). */
export const ROW_AT_ATTRIBUTE = "data-at";

/**
 * Where the top row is read, in px under the scroll container's top
 * edge: the capsule's bottom edge (FloatingDay sits `top-3` and is
 * `h-6` tall, 12 + 24). What it covers is not what the reader sees at
 * the top. Read at the very edge, a day's first time line slid behind
 * the capsule while the row crossing the edge was still the previous
 * reply's — its action row, empty until hovered (30px) — so the capsule
 * said the day before over the time line it hid, with nothing of that
 * day in sight (ticket 124 preview). Read here, the day turns as the
 * time line reaches the capsule.
 */
export const FLOATING_DAY_PROBE_PX = 36;

/** A message's moment as its row carries it: the ISO time in ms;
 * undefined without one, or when it does not parse. */
export function rowAt(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The moment of row `from`, or, for a row with none of its own (a time
 * line, a process card, a system line), of the nearest row below it
 * that has one: a time line belongs to the message under it. Null when
 * no row from there down has one, or `from` is no row.
 */
export function timedRowAt(
  count: number,
  atOf: (index: number) => number | null,
  from: number,
): number | null {
  if (from < 0) return null;
  for (let i = from; i < count; i++) {
    const at = atOf(i);
    if (at !== null) return at;
  }
  return null;
}

/** The moment a row carries (`ROW_AT_ATTRIBUTE`); null without one. */
function rowAtOf(row: Element): number | null {
  const raw = row.getAttribute(ROW_AT_ATTRIBUTE);
  if (raw === null) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * The moment of the row at the top of `container`'s viewport — the row
 * the line `probe` px under its top edge crosses, or the first one under
 * that line (`firstRowBelow`, a binary search over a handful of rows) —
 * or of the nearest timed row below it. Null when the conversation
 * shows no row with a moment there. Reads layout; writes nothing.
 */
export function topRowAt(
  container: HTMLElement,
  probe = FLOATING_DAY_PROBE_PX,
): number | null {
  const root = container.querySelector(ROWS_SELECTOR);
  if (!root) return null;
  const rows = root.children;
  const line = container.getBoundingClientRect().top + probe;
  const index = firstRowBelow(
    rows.length,
    (i) => rows[i].getBoundingClientRect().bottom,
    line,
  );
  return timedRowAt(rows.length, (i) => rowAtOf(rows[i]), index);
}

/**
 * What the capsule says for a row said at `atMs`: the day as a list
 * going back writes it (`formatPastDay`, the memo page's day words) —
 * 昨天, 10月28日, 2025年10月28日; Yesterday, Oct 28, Oct 28, 2025 —
 * never a weekday or a clock. Null for today, and for a moment later
 * than today (a skewed clock reads as today): the capsule then does not
 * show. Null without a moment. Pure over `todayStartMs`
 * (`useDayStamp()`).
 */
export function floatingDayLabel(
  atMs: number | null,
  todayStartMs: number,
  language: ResolvedLanguage,
  words: { today: string; yesterday: string },
): string | null {
  if (atMs === null) return null;
  if (localDayStart(atMs) >= localDayStart(todayStartMs)) return null;
  return formatPastDay(atMs, todayStartMs, language, words);
}
