import { parseCubicBezier } from "@/lib/composer-grow";
import type { TodoButtonShape } from "@/lib/todo-button";
import { parseDurationMs } from "@/lib/typing-bubble-handoff";

/*
 * The top bar's 「待办」 button when today's count changes (main chat
 * ticket 162, PRD ruling 208 point 4; spec: docs/design/layout-and-chrome.md
 * §4.1 「待办按钮」). Two halves, on the page in
 * hooks/useTodoButtonMotion.ts:
 *
 * - **The number ticks**: each time N changes after the button mounted
 *   (more, fewer, from none), the number comes in with the sidebar's
 *   step tick (globals.css `todo-count-tick`). Its element is keyed by
 *   the changes, so every change plays it again; the mount — a
 *   conversation switched to included — does not.
 * - **The width glides**: when the button's width changes with the
 *   number (it comes, goes, takes a digit more) or with its look (the
 *   word, the capsule, the icon), it goes from the old width to the new
 *   (`--motion-base`, `--ease-firm`) and what is beside it gives way
 *   smoothly. A number that goes stays on the page for the glide, fading
 *   and cut by the narrowing button — never gone a frame before the
 *   width follows.
 *
 * Reduced motion: the width is where it ends up at once and the number
 * only fades (foundations §2.7 「只淡不移」).
 */

// ---- The number -----------------------------------------------------------

/** A number on its way out: drawn where it was while the button
 * narrows, then dropped. */
export interface TodoCountLeaving {
  count: number;
  /** It was the capsule's, which hides the number while its body shows
   * (TodoToggleButton `CAPSULE.folded`): it stays hidden there. */
  folded: boolean;
}

/** What the button's motion holds between renders. */
export interface TodoCountMotion {
  /** Today's count as last drawn; null for none. */
  count: number | null;
  shape: TodoButtonShape;
  /** How many times the count has changed since the button mounted: the
   * number's key, so each change plays the tick again; 0 never ticks. */
  ticks: number;
  leaving: TodoCountLeaving | null;
}

/** As the button mounts: nothing ticks, nothing leaves. */
export function todoCountStart(
  count: number | null,
  shape: TodoButtonShape,
): TodoCountMotion {
  return { count, shape, ticks: 0, leaving: null };
}

/**
 * The motion once the button draws `count` in `shape`. A new count
 * ticks (one more change, a new key); one that goes to none keeps the
 * number it had on the page to leave while the width glides (`glides`
 * false — reduced motion, no Web Animations — it goes at once) and
 * keeps its key, so the element on screen is the one that leaves. A
 * count coming back drops whatever was leaving. A new look alone
 * changes neither.
 */
export function todoCountNext(
  motion: TodoCountMotion,
  count: number | null,
  shape: TodoButtonShape,
  glides: boolean,
): TodoCountMotion {
  if (count === motion.count) {
    return shape === motion.shape ? motion : { ...motion, shape };
  }
  if (count === null) {
    const was = motion.count;
    return {
      count,
      shape,
      ticks: motion.ticks,
      leaving:
        glides && was !== null
          ? { count: was, folded: motion.shape === "capsule" }
          : null,
    };
  }
  return { count, shape, ticks: motion.ticks + 1, leaving: null };
}

/** The glide is over: the number that was leaving is dropped. */
export function todoCountSettle(motion: TodoCountMotion): TodoCountMotion {
  return motion.leaving ? { ...motion, leaving: null } : motion;
}

// ---- The width ------------------------------------------------------------

/** A width change under half a pixel is no glide: a rounding. */
const GLIDE_MIN_PX = 0.5;

/** Whether the button glides from `from` to `to` (px; null where it was
 * not laid out). */
export function todoWidthGlides(
  from: number | null,
  to: number | null,
): boolean {
  return from !== null && to !== null && Math.abs(to - from) >= GLIDE_MIN_PX;
}

/**
 * The button's inline style while it glides, off again once it rests.
 * Every look puts its icon 6px in (1px border + 5px; the 28px square
 * centres it there) and what follows 4px after it; mid-glide the box is
 * narrower or wider than what it holds, so these keep them where they
 * stand — from the left, not centred — and keep the words on one line,
 * cut by the button's edge rather than wrapped or squeezed (the
 * capsule's title still takes its ellipsis, as on a narrow header).
 */
export const TODO_GLIDE_STYLE = {
  overflow: "hidden",
  "white-space": "nowrap",
  "justify-content": "flex-start",
  "padding-left": "5px",
  "column-gap": "4px",
} as const;

/** The glide's length and curve: 「标准显隐」 on the workhorse ease-out
 * (foundations Motion tokens). */
export const TODO_GLIDE_DURATION_TOKEN = "--motion-base";
export const TODO_GLIDE_EASING_TOKEN = "--ease-firm";

export interface TodoGlideTiming {
  durationMs: number;
  /** The CSS easing, for Web Animations. */
  easing: string;
}

function rootToken(name: string): string {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** The tokens as the page has them, read each time a glide starts. Null
 * when they cannot be read: then the width is where it ends up at once,
 * as before ticket 162. */
export function readTodoGlideTiming(): TodoGlideTiming | null {
  const durationMs = parseDurationMs(rootToken(TODO_GLIDE_DURATION_TOKEN));
  const easing = rootToken(TODO_GLIDE_EASING_TOKEN).trim();
  if (durationMs === null || !parseCubicBezier(easing)) return null;
  return { durationMs, easing };
}
