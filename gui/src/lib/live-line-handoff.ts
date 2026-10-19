/**
 * The main chat's live line handing over to its bubble (main chat PRD
 * ruling 103, ticket 51; spec: conversation.md 「助手的对话」, 「过程：
 * 一行」). While a round runs the assistant's conversation ends in one
 * 12px line (AssistantParts `AssistantLiveLine`). When its bubble takes
 * that place — the round's answer, or a question it asks you — the
 * bubble grows out of the line's footprint instead of popping in: its
 * tint opens from the line's text box to its own box, the line and its
 * clock fade out, the words in the bubble and what hangs under it fade
 * in; `--motion-slow` and `--ease-pop`, once. Following the bottom, the
 * scroll for that landing runs on the same clock (animate-scroll
 * `ScrollTiming`), so the growth stays where the line was. Under
 * reduced motion it only fades (foundations §2.7 「只淡不移」).
 *
 * The rules here; the DOM side is hooks/useLiveLineHandoff.ts, the
 * scroll is useStickyScroll's `landingTick`.
 */
import type { ScrollTiming } from "@/lib/animate-scroll";
import { cubicBezier, parseCubicBezier } from "@/lib/composer-grow";

/** What took the line's place: the round's answer, or its question. */
export type LiveLineHandoffKind = "reply" | "question";

/** One hand-off, as MainView hands it to the hooks: a new `tick` each
 * time; the answer's `messageId` (its row's `data-message-id`). */
export interface LiveLineHandoff {
  tick: number;
  kind: LiveLineHandoffKind;
  messageId: string | null;
}

/** What the previous render drew, as MainView keeps it from render to
 * render. */
export interface LiveLineFrame {
  sessionId: string | undefined;
  /** The line was on screen, and not under a cold-start restore (turns
   * still being read back: what lands then was there before). */
  live: boolean;
}

/** This render. */
export interface LiveLineNow {
  sessionId: string | undefined;
  /** The line is drawn (MainView: running, the main chat, the round not
   * settled, not asking). */
  lineShown: boolean;
  /** Its question is waiting for you. */
  question: boolean;
  /** The round has its answer (or settled saying nothing). */
  settled: boolean;
  /** …saying nothing: a report round's `<no-reply/>`. */
  silent: boolean;
}

/**
 * Whether this render is a hand-off the user is watching, and of what:
 * only when the line was on screen in the render before, for this same
 * session, and its place now goes to a bubble. A session switch, a
 * reload (MainView mounts with the line's state as it is), a restore, an
 * earlier page or a message put back after a delete never hand off: the
 * line was not just there, or it still is. A stop or an error leaves
 * nothing to grow; nor does a reply that said nothing (`<no-reply/>`):
 * the line just goes.
 */
export function liveLineHandoff(
  previous: LiveLineFrame,
  now: LiveLineNow,
): LiveLineHandoffKind | null {
  if (!previous.live || previous.sessionId !== now.sessionId) return null;
  if (now.lineShown) return null;
  if (now.question) return "question";
  if (now.settled && !now.silent) return "reply";
  return null;
}

/** Reduced motion only fades (foundations §2.7 「只淡不移」): the line
 * out, the bubble in, nothing opens, nothing scrolls smoothly. */
export type HandoffMotion = "grow" | "fade";

export function handoffMotion(reducedMotion: boolean): HandoffMotion {
  return reducedMotion ? "fade" : "grow";
}

/** A box in one coordinate space (px). */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A `clip-path: inset()`'s four sides (px). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the bubble's tint starts: the line's text box as insets of the
 * bubble's own box (both in the same space), held inside the bubble — a
 * line wider than a short answer starts at the bubble's width, a line
 * below the bubble's box starts as its bottom edge.
 */
export function bubbleGrowInsets(line: Box, bubble: Box): Insets {
  const top = clamp(line.top - bubble.top, 0, bubble.height);
  const bottom = clamp(
    bubble.top + bubble.height - (line.top + line.height),
    0,
    bubble.height - top,
  );
  const left = clamp(line.left - bubble.left, 0, bubble.width);
  const right = clamp(
    bubble.left + bubble.width - (line.left + line.width),
    0,
    bubble.width - left,
  );
  return { top, right, bottom, left };
}

/** `clip-path` for `insets`, rounded as the bubble is (`radius`, its
 * computed corner), to a hundredth of a pixel. Without insets: the
 * whole bubble. */
export function insetClipPath(
  insets: Insets = NO_INSETS,
  radius = "0px",
): string {
  // To a hundredth of a pixel: measured boxes carry float noise.
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  const { top, right, bottom, left } = insets;
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${radius})`;
}

/**
 * The line's text box width: from its left edge to the right edge of
 * its last piece (the sentence, then the clock), at most the line's own
 * width. The line is a full-width row; its words are what the bubble
 * grows from.
 */
export function lineTextWidth(
  lineLeft: number,
  pieceRights: readonly number[],
  lineWidth: number,
): number {
  const right = Math.max(lineLeft, ...pieceRights);
  const width = right - lineLeft;
  return width > 0 ? Math.min(width, lineWidth) : lineWidth;
}

/**
 * How far the conversation column moved up in its scroller during the
 * hand-off's own layout (px; `before` and `after` are its top in the
 * scroll content): a conversation shorter than the viewport stacks up
 * from the composer (`mt-auto`, 贴底), so a taller tail moves everything
 * above it up at once. The hand-off lifts the column by this much and
 * lets it down on the same curve, the way the follow scroll moves it
 * when the conversation scrolls. Under half a pixel: none.
 */
export function columnLift(before: number, after: number): number {
  const lift = before - after;
  return Math.abs(lift) < 0.5 ? 0 : lift;
}

// ---- Timing (motion tokens) ---------------------------------------------

/** The hand-off's motion: the growth and the follow scroll (foundations
 * Motion tokens: 「较大结构位移」). */
export const HANDOFF_GROW_TOKEN = "--motion-slow";
/** Each fade: the line out at the start, what grows in at the end. */
export const HANDOFF_FADE_TOKEN = "--motion-fast";
/** Every part's curve (「内容入场」). */
export const HANDOFF_EASING_TOKEN = "--ease-pop";

/** The hand-off's timing, read off the tokens. */
export interface HandoffTiming {
  growMs: number;
  fadeMs: number;
  /** The CSS easing, for Web Animations. */
  easing: string;
}

/** A CSS `<time>` (`240ms`, `0.24s`) in ms, or null. */
export function parseDurationMs(value: string): number | null {
  const match = /^\s*([+]?\d*\.?\d+)(ms|s)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === "s" ? amount * 1000 : amount;
}

/**
 * When the words in the bubble and what hangs under it come in: from
 * half the line's fade to the end of the growth. On `--ease-pop` the
 * line is down to a few percent by then and the tint most of the way
 * open (measured at 60ms of 240: the line at 3%, the tint at 83%), so
 * the two sets of words never show at once (they overlap: the line's
 * sit on the bubble's top-left corner, the bubble's 14px in and 10px
 * down), and the tint is not left empty for long. Nothing under the
 * bubble shows before it has mostly opened.
 */
export function handoffFadeIn(timing: HandoffTiming): {
  delay: number;
  duration: number;
} {
  const delay = Math.min(timing.fadeMs / 2, timing.growMs);
  return { delay, duration: timing.growMs - delay };
}

function rootToken(name: string): string | null {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return null;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** The tokens as the page has them, read each time a hand-off starts —
 * one source for the numbers. Null when they cannot be read: then
 * nothing animates (the line just goes, as before). */
export function readHandoffTiming(): HandoffTiming | null {
  const grow = parseDurationMs(rootToken(HANDOFF_GROW_TOKEN) ?? "");
  const fade = parseDurationMs(rootToken(HANDOFF_FADE_TOKEN) ?? "");
  const easing = (rootToken(HANDOFF_EASING_TOKEN) ?? "").trim();
  if (grow === null || fade === null || !parseCubicBezier(easing)) return null;
  return { growMs: grow, fadeMs: Math.min(fade, grow), easing };
}

/** The landing's follow scroll on the growth's clock: its duration and
 * its curve, evaluated here from the token's own definition. Null when
 * the tokens cannot be read: the follow is instant, as before. */
export function landingScrollTiming(): ScrollTiming | null {
  const timing = readHandoffTiming();
  const curve = timing ? parseCubicBezier(timing.easing) : null;
  return timing && curve
    ? { durationMs: timing.growMs, easing: cubicBezier(...curve) }
    : null;
}
