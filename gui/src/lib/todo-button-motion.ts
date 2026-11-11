import { parseCubicBezier } from "@/lib/composer-grow";
import type { TodoButtonShape, TodoCapsule } from "@/lib/todo-button";
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
 *   width follows. So does the capsule when the button stops being one
 *   (today's last ticked off: to the icon or the word): its row where it
 *   was, its hairline frame and round ends on the button itself,
 *   following the width and fading to the look it ends as. The other
 *   way the frame is there from the first frame and grows with the
 *   width; the words are laid out as they end up and only cut by the
 *   edge on the way, no ellipsis moving letter by letter.
 *
 * Reduced motion: the width is where it ends up at once and the number
 * only fades (foundations §2.7 「只淡不移」).
 */

// ---- What ticks and what leaves -------------------------------------------

/** What is on its way out: drawn as it was while the button narrows,
 * then dropped. */
export interface TodoCountLeaving {
  /** Today's count that went to none; null when only the capsule goes. */
  count: number | null;
  /** That number was the capsule's, which hides it while its body shows
   * (TodoToggleButton `CAPSULE.folded`): it stays hidden there. */
  folded: boolean;
  /** The capsule that went — its row, 「时间 · 标题」 and 「+N」 — when
   * the button stops being one (the icon, the word); null otherwise. */
  capsule: TodoCapsule | null;
}

/** What the button's motion holds between renders. */
export interface TodoCountMotion {
  /** Today's count as last drawn; null for none. */
  count: number | null;
  shape: TodoButtonShape;
  /** The capsule's words as last drawn (null for the other looks): what
   * stays to leave when the button stops being a capsule. */
  capsule: TodoCapsule | null;
  /** How many times the count has changed since the button mounted: the
   * number's key, so each change plays the tick again; 0 never ticks. */
  ticks: number;
  leaving: TodoCountLeaving | null;
}

function sameCapsule(a: TodoCapsule | null, b: TodoCapsule | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.when === b.when &&
    a.tone === b.tone &&
    a.title === b.title &&
    a.more === b.more
  );
}

/** As the button mounts: nothing ticks, nothing leaves. */
export function todoCountStart(
  count: number | null,
  shape: TodoButtonShape,
  capsule: TodoCapsule | null = null,
): TodoCountMotion {
  return { count, shape, capsule, ticks: 0, leaving: null };
}

/**
 * The motion once the button draws `count` in `shape` (and `capsule`'s
 * words). A new count ticks (one more change, a new key). What goes
 * stays to leave while the width glides (`glides` false — reduced
 * motion, no Web Animations — it goes at once): a count that goes to
 * none, keeping its key, so the element on screen is the one that
 * leaves; the capsule, when the button stops being one — not when it
 * only changes its row (a capsule to a capsule leaves nothing). A count
 * coming back drops the number leaving, a capsule coming back the
 * capsule. The capsule's words alone change neither the count nor what
 * leaves; they are kept for when it goes.
 */
export function todoCountNext(
  motion: TodoCountMotion,
  count: number | null,
  shape: TodoButtonShape,
  capsule: TodoCapsule | null,
  glides: boolean,
): TodoCountMotion {
  const countSame = count === motion.count;
  if (countSame && shape === motion.shape) {
    return sameCapsule(capsule, motion.capsule)
      ? motion
      : { ...motion, capsule };
  }
  const goingCount =
    !countSame && count === null && motion.count !== null ? motion.count : null;
  const goingCapsule =
    motion.shape === "capsule" && shape !== "capsule" ? motion.capsule : null;
  const was = motion.leaving;
  const leavingCount =
    glides && count === null ? (goingCount ?? was?.count ?? null) : null;
  const leavingCapsule =
    glides && shape !== "capsule"
      ? (goingCapsule ?? was?.capsule ?? null)
      : null;
  return {
    count,
    shape,
    capsule,
    ticks: !countSame && count !== null ? motion.ticks + 1 : motion.ticks,
    leaving:
      leavingCount === null && leavingCapsule === null
        ? null
        : {
            count: leavingCount,
            folded:
              goingCount !== null
                ? motion.shape === "capsule"
                : (was?.folded ?? false),
            capsule: leavingCapsule,
          },
  };
}

/** The glide is over: what was leaving is dropped. */
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
 * cut by the button's edge rather than wrapped or squeezed. The capsule
 * that leaves is drawn over it, placed against the button.
 */
export const TODO_GLIDE_STYLE = {
  position: "relative",
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
