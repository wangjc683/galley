/**
 * The main chat's bubbles coming and going (main chat PRD ruling 138,
 * ticket 94; spec: conversation.md 「在跑时：三点气泡」, 「消息菜单」's
 * 「删除不弹确认，删完给撤销」, 「滚动：贴底」). Until then only the reply
 * growing out of the typing bubble moved (rulings 103, 110,
 * lib/typing-bubble-handoff.ts); everything else cut:
 *
 *   send     the conversation slides up from where it stood, on the
 *            programmatic scroll's duration and curve (it reads as one
 *            scroll: lib/animate-scroll.ts), your bubble fading in with
 *            it, the typing bubble fading in once it is in place.
 *   delete   each row deleted shrinks toward its own bottom corner and
 *            fades (`DELETE_SHRINK_SCALE`, `--ease-exit`) while the rows
 *            on screen slide into their new places; undo, or Core
 *            refusing, the other way round.
 *   typing   the typing bubble with nothing growing out of it fades
 *            where it stood, and what took its place fades in; in a
 *            round Core woke it for, it fades in and out as it types.
 *
 * The end layout and the scroll position are what they were before
 * (the anchor, 贴底, the follow): only the way there moves — transform
 * and opacity on what already sits at its new place, copies of what
 * left, in a zero-size layer. Once, for what happens in front of you:
 * not on a session switch, a remount, a cold restore or an earlier page.
 * Under reduced motion only fades (foundations §2.7 「只淡不移」).
 *
 * The rules here; the page side is lib/bubble-motion-play.ts, started by
 * hooks/useBubbleMotion.ts (the send, the typing bubble) and
 * hooks/useRemovedTurnsAnchor.ts (a delete and what is put back).
 */
import {
  SCROLL_ANIMATED_MAX_PX,
  scrollDurationMs,
  scrollProgress,
} from "@/lib/animate-scroll";
import { parseCubicBezier } from "@/lib/composer-grow";
import { parseDurationMs } from "@/lib/typing-bubble-handoff";

/** How small a deleted row gets as it goes, and how small one put back
 * starts. */
// 裁决 138 第 4 条：取中档、没比过，嫌大嫌小改这里
export const DELETE_SHRINK_SCALE = 0.9;

/** Under this a move is no move (px): measured boxes carry float noise. */
const MIN_SHIFT_PX = 0.5;

/** Reduced motion only fades (foundations §2.7 「只淡不移」): nothing
 * slides, nothing shrinks. */
export type BubbleMotionMode = "move" | "fade";

export function bubbleMotionMode(reducedMotion: boolean): BubbleMotionMode {
  return reducedMotion ? "fade" : "move";
}

// ---- Timing (motion tokens) ---------------------------------------------

/** The tokens every part reads (foundations 「Motion tokens」). The
 * strings are also what keeps Tailwind emitting `--ease-exit`: it drops
 * theme variables nothing names. */
export const BUBBLE_MOTION_TOKENS = {
  fast: "--motion-fast",
  base: "--motion-base",
  slow: "--motion-slow",
  pop: "--ease-pop",
  firm: "--ease-firm",
  exit: "--ease-exit",
} as const;

export interface BubbleMotionTiming {
  fastMs: number;
  baseMs: number;
  slowMs: number;
  /** CSS easings, for Web Animations: what comes in, what slides into
   * place, what leaves. */
  pop: string;
  firm: string;
  exit: string;
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

/** The tokens as the page has them, read each time a motion starts —
 * one source for the numbers. Null when any cannot be read: then
 * nothing moves (everything is just where it ends up), as the hand-off. */
export function readBubbleMotionTiming(): BubbleMotionTiming | null {
  const t = BUBBLE_MOTION_TOKENS;
  const fastMs = parseDurationMs(rootToken(t.fast));
  const baseMs = parseDurationMs(rootToken(t.base));
  const slowMs = parseDurationMs(rootToken(t.slow));
  const pop = rootToken(t.pop).trim();
  const firm = rootToken(t.firm).trim();
  const exit = rootToken(t.exit).trim();
  if (fastMs === null || baseMs === null || slowMs === null) return null;
  if (![pop, firm, exit].every((easing) => parseCubicBezier(easing))) {
    return null;
  }
  return { fastMs, baseMs, slowMs, pop, firm, exit };
}

/** One fade: how long, after how long, on which curve. */
export interface FadeTiming {
  durationMs: number;
  delayMs: number;
  easing: string;
}

/** One slide into place. */
export interface SlideTiming {
  durationMs: number;
  easing: string;
}

// ---- The slide: a send, a woken round's typing bubble -------------------

/** The conversation sliding into place after it moved at once. */
export interface ColumnSlide {
  /** Where it starts from, below its place (px; negative: above). */
  distance: number;
  durationMs: number;
}

/**
 * How the conversation slides into place after it moved by `delta` px
 * at once (its top in the viewport before less after: positive, it
 * moved up): the programmatic scroll's numbers, since it reads as one —
 * only the last SCROLL_ANIMATED_MAX_PX of a longer way, the rest a jump
 * first (as `scrollJumpFrom`), over `scrollDurationMs`. Null when it did
 * not move.
 */
export function columnSlide(delta: number): ColumnSlide | null {
  if (!Number.isFinite(delta) || Math.abs(delta) < MIN_SHIFT_PX) return null;
  const distance =
    Math.sign(delta) * Math.min(Math.abs(delta), SCROLL_ANIMATED_MAX_PX);
  return { distance, durationMs: scrollDurationMs(distance) };
}

/** About one keyframe a frame: Web Animations take a CSS easing, and the
 * scroll's curve is a function of the distance (`scrollProgress`), so
 * it is laid out as keyframes, linear in between. */
const SLIDE_FRAME_MS = 16;

/** To a hundredth of a pixel. */
function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

/** `slide` as keyframes: from its distance back to its place, on the
 * scroll's curve. */
export function slideKeyframes(slide: ColumnSlide): Keyframe[] {
  const steps = Math.max(2, Math.ceil(slide.durationMs / SLIDE_FRAME_MS));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const left = slide.distance * (1 - scrollProgress(slide.distance, t));
    frames.push({ offset: t, transform: `translateY(${px(left)})` });
  }
  return frames;
}

/**
 * A send's two fades: your bubble comes in with the slide
 * (`--motion-base`, `--ease-pop`); the typing bubble once the slide is
 * over, so it reads as catching it — with no slide (reduced motion, or
 * nothing moved) a beat later, `--motion-base`.
 */
export function sendFades(
  timing: BubbleMotionTiming,
  slide: ColumnSlide | null,
): { bubble: FadeTiming; typing: FadeTiming } {
  return {
    bubble: { durationMs: timing.baseMs, delayMs: 0, easing: timing.pop },
    typing: {
      durationMs: timing.baseMs,
      delayMs: slide ? slide.durationMs : timing.baseMs,
      easing: timing.pop,
    },
  };
}

/** The typing bubble of a round Core woke it for, as it starts to
 * write: no send to wait for. */
export function wokenTypingFade(timing: BubbleMotionTiming): FadeTiming {
  return { durationMs: timing.fastMs, delayMs: 0, easing: timing.pop };
}

/**
 * The typing bubble going with nothing growing out of it: its copy fades
 * where it stood (`--motion-fast`, `--ease-exit`); what took its place
 * comes in from half of that (`--motion-base`, `--ease-pop`); what moved
 * slides as a row does when one is deleted (`rowsMotion`).
 */
export function typingLeaveFades(timing: BubbleMotionTiming): {
  copy: FadeTiming;
  successors: FadeTiming;
} {
  return {
    copy: { durationMs: timing.fastMs, delayMs: 0, easing: timing.exit },
    successors: {
      durationMs: timing.baseMs,
      delayMs: timing.fastMs / 2,
      easing: timing.pop,
    },
  };
}

// ---- Rows: a delete, what is put back -----------------------------------

/** Whose a row is: yours (on the right), the assistant's (on the left),
 * or the centred time line. */
export type RowSide = "user" | "assistant" | "time";

/**
 * How far a row on screen slides into its new place: from where it was
 * (its top in the viewport before less after, px). Null when it did not
 * move (the row the anchor holds) or moved farther than a scroll
 * animates (SCROLL_ANIMATED_MAX_PX): then it is just there.
 */
export function rowShift(before: number, after: number): number | null {
  const shift = before - after;
  if (!Number.isFinite(shift) || Math.abs(shift) < MIN_SHIFT_PX) return null;
  if (Math.abs(shift) > SCROLL_ANIMATED_MAX_PX) return null;
  return shift;
}

/**
 * Where a row shrinks to as it goes, and grows from as it comes back:
 * its own bottom corner — yours the bottom right, the assistant's the
 * bottom left. Null when it only fades: the time line (centred, it has
 * no side), a row taller than the viewport (shrinking it would drag its
 * far edge across the screen), and everything under reduced motion.
 */
export function shrinkOrigin({
  side,
  height,
  viewportHeight,
  mode,
}: {
  side: RowSide;
  height: number;
  viewportHeight: number;
  mode: BubbleMotionMode;
}): string | null {
  if (mode === "fade" || side === "time") return null;
  if (height > viewportHeight) return null;
  return side === "user" ? "100% 100%" : "0% 100%";
}

/**
 * A delete's three parts: what goes leaves (`--motion-base`,
 * `--ease-exit`); the rest slides into place (`--motion-slow`,
 * `--ease-firm`, the motion scale's 「较大结构位移」); what comes in —
 * a row put back, a time line the rules now draw — waits until the
 * rows making room have mostly moved (`--motion-fast`), then comes in
 * (`--motion-base`, `--ease-pop`). Under reduced motion nothing slides,
 * so nothing waits.
 */
export function rowsMotion(
  timing: BubbleMotionTiming,
  mode: BubbleMotionMode,
): { leave: FadeTiming; shift: SlideTiming; enter: FadeTiming } {
  return {
    leave: { durationMs: timing.baseMs, delayMs: 0, easing: timing.exit },
    shift: { durationMs: timing.slowMs, easing: timing.firm },
    enter: {
      durationMs: timing.baseMs,
      delayMs: mode === "move" ? timing.fastMs : 0,
      easing: timing.pop,
    },
  };
}

// ---- One at a time --------------------------------------------------------

/** A motion of this ticket on the page. */
export interface RunningBubbleMotion {
  /** Straight to its end: animations off, copies gone, the column as
   * it was. */
  finish(): void;
  /** The typing bubble's opacity under a fade-in of this motion right
   * now; null without one (it is all there). */
  typingOpacity(): number | null;
}

const running = new WeakMap<object, RunningBubbleMotion>();
const settledOpacity = new WeakMap<object, number>();
const handedOff = new WeakSet<object>();

/** `motion` is the one running on `container` now (any before it goes
 * to its end first). */
export function holdBubbleMotion(
  container: object,
  motion: RunningBubbleMotion,
): void {
  const before = running.get(container);
  if (before && before !== motion) settleBubbleMotion(container);
  running.set(container, motion);
}

/** `motion` ended by itself. */
export function releaseBubbleMotion(
  container: object,
  motion: RunningBubbleMotion,
): void {
  if (running.get(container) === motion) running.delete(container);
}

/**
 * Before anything measures the conversation or starts a motion of its
 * own (a new one of these, the hand-off, a deletion's anchor): the one
 * running goes straight to its end. Measured mid-way, every box would
 * carry its transform. What the typing bubble's fade-in had reached is
 * kept until the end of the task (`settledTypingOpacity`): the copy that
 * fades it out starts there instead of jumping to opaque.
 */
export function settleBubbleMotion(container: object): void {
  const motion = running.get(container);
  if (!motion) return;
  running.delete(container);
  const opacity = motion.typingOpacity();
  if (opacity !== null) {
    settledOpacity.set(container, opacity);
    queueMicrotask(() => settledOpacity.delete(container));
  }
  motion.finish();
}

/** The typing bubble's opacity when a motion here was settled in this
 * task with its fade-in under way; null otherwise. */
export function settledTypingOpacity(container: object): number | null {
  return settledOpacity.get(container) ?? null;
}

/** The hand-off grew a bubble out of the typing bubble in this commit:
 * its going is the hand-off's, not a fade of this ticket's. */
export function claimTypingDeparture(container: object): void {
  handedOff.add(container);
  queueMicrotask(() => handedOff.delete(container));
}

export function typingDepartureClaimed(container: object): boolean {
  return handedOff.has(container);
}
