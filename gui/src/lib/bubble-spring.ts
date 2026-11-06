/**
 * The main chat's one spring (main chat PRD ruling 201, ticket 150;
 * spec: conversation.md 「助手的对话」 → 「滚动时的弹性」). Every row of
 * the conversation hangs on it: while you scroll, a row lags behind the
 * scroll by a share of each frame's move that grows with its distance
 * from the pointer, and the spring pulls it back. The landing bounce of
 * a new bubble (ticket 151) is the same spring given a push
 * (`kickVelocity`): one physics for the whole conversation.
 *
 * The rules and the numbers live here, as pure functions; the page side
 * (which rows, which scrolls are yours, the frame loop, the styles) is
 * lib/bubble-spring-play.ts, attached by hooks/useScrollSpring.ts.
 *
 * Also here, because the code that measures the conversation needs it
 * without the page side: where the spring has moved each row now
 * (`bubbleSpringShift`), so a reading that needs a row's place in the
 * layout takes it off, and a copy of a row drops it
 * (`clearBubbleSpringStyle`).
 */

// ---- The numbers (ruling 201) ----------------------------------------------

// 裁决 201 第 7 条：数值都是常量、集中在这里，嫌重嫌轻只改这里。

/** How far a row lags at most (px): the rows far from the pointer, while
 * you scroll (ruling 201 第 2 条). */
export const MAX_LAG_PX = 6;

/** How far two rows next to each other may be out of step (px): on one
 * side they are 4px apart (ruling 199), so they never touch (ruling 201
 * 第 2 条). */
export const MAX_NEIGHBOUR_STEP_PX = 2;

/** The spring's damping ratio: let go, it passes its rest by about 1.5%
 * of where it let go from, once, and settles (ruling 201 第 2 条). */
export const DAMPING_RATIO = 0.8;

/** Let go from MAX_LAG_PX, it is within SETTLE_WITHIN_PX of its rest
 * this long after (ms), and stays there: the spring's stiffness is
 * worked out from these (`SPRING_OMEGA`), not written down (ruling 201
 * 第 2 条). */
export const SETTLE_MS = 350;
export const SETTLE_WITHIN_PX = 0.5;

/** A new bubble's landing bounce goes this far past its place at most
 * (px; ticket 151, ruling 201 第 4 条). */
export const MAX_KICK_PX = 1.5;

// ---- The spring ---------------------------------------------------------------

/** A row on the spring: how far it is from its place (px; positive:
 * lower on screen) and how fast it moves (px/s). */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * One step of a damped spring, solved exactly rather than integrated:
 * any frame interval (a dropped frame, a frame of 250ms) gives the same
 * path as many small ones, so it neither blows up nor jitters. `omega`:
 * the natural frequency (rad/s); `zeta`: the damping ratio. Any ratio
 * works (under, critically and over damped), should DAMPING_RATIO be
 * changed.
 */
export function springStep(
  state: SpringState,
  dtMs: number,
  omega: number = SPRING_OMEGA,
  zeta: number = DAMPING_RATIO,
): SpringState {
  const t = Math.max(0, dtMs) / 1000;
  const { x, v } = state;
  if (t === 0 || (x === 0 && v === 0)) return { x, v };
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      x: decay * (x * cos + ((v + zeta * omega * x) / wd) * sin),
      v:
        decay * (v * cos - ((zeta * omega * v + omega * omega * x) / wd) * sin),
    };
  }
  if (zeta === 1) {
    const decay = Math.exp(-omega * t);
    const b = v + omega * x;
    return {
      x: (x + b * t) * decay,
      v: (v - omega * b * t) * decay,
    };
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  const c1 = (v - r2 * x) / (r1 - r2);
  const c2 = x - c1;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { x: c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
}

/** Sampling of the spring's path when working out its numbers. */
const SAMPLE_MS = 0.5;
/** Far enough to see any spring of these numbers settle (ms). */
const HORIZON_MS = 10_000;

/**
 * How long a spring of natural frequency `omega` takes to come within
 * `within` of its rest and stay, let go from `from` (ms): the first
 * sample after the last one where it was farther (so never short of it).
 */
export function settleTimeMs(
  omega: number,
  from: number = MAX_LAG_PX,
  within: number = SETTLE_WITHIN_PX,
  zeta: number = DAMPING_RATIO,
): number {
  let last = 0;
  for (let i = 1; i * SAMPLE_MS <= HORIZON_MS; i++) {
    const t = i * SAMPLE_MS;
    const { x } = springStep({ x: from, v: 0 }, t, omega, zeta);
    if (Math.abs(x) > within) last = t;
  }
  return last + SAMPLE_MS;
}

/** The spring the natural frequency is worked out from (rad/s): one
 * that settles in a few hundred ms, sampled finely enough. */
const REFERENCE_OMEGA = 10;

/**
 * The natural frequency that settles in `settleMs` (rad/s): a spring's
 * time scales as 1/ω, so one spring's settling time gives every other's.
 */
export function naturalFrequency(
  settleMs: number = SETTLE_MS,
  from: number = MAX_LAG_PX,
  within: number = SETTLE_WITHIN_PX,
  zeta: number = DAMPING_RATIO,
): number {
  const reference = settleTimeMs(REFERENCE_OMEGA, from, within, zeta);
  return (REFERENCE_OMEGA * reference) / settleMs;
}

/** The spring's natural frequency (rad/s), from SETTLE_MS. */
export const SPRING_OMEGA = naturalFrequency();

/**
 * How far past its place a push of `velocity` (px/s) carries a row at
 * rest, at most (px; signed as the push). Linear in the push.
 */
export function kickPeak(
  velocity: number,
  omega: number = SPRING_OMEGA,
  zeta: number = DAMPING_RATIO,
): number {
  let peak = 0;
  for (let i = 1; i * SAMPLE_MS <= HORIZON_MS; i++) {
    const t = i * SAMPLE_MS;
    const { x } = springStep({ x: 0, v: velocity }, t, omega, zeta);
    if (Math.abs(x) > Math.abs(peak)) peak = x;
    else if (Math.abs(x) < Math.abs(peak) / 2) break;
  }
  return peak;
}

/** The peak of a push of 1px/s. */
const UNIT_KICK_PEAK = kickPeak(1);

/**
 * The push (px/s) that carries a row at rest `peakPx` past its place,
 * capped at MAX_KICK_PX either way: ticket 151's landing bounce, along
 * the way the bubble came in (negative: up).
 */
export function kickVelocity(peakPx: number): number {
  const peak = Math.max(-MAX_KICK_PX, Math.min(MAX_KICK_PX, peakPx));
  return peak / UNIT_KICK_PEAK;
}

// ---- Lagging behind the scroll -------------------------------------------------

/** How far a row is from the anchor (px): 0 when the anchor is on it. */
export function anchorDistance(
  top: number,
  bottom: number,
  anchorY: number,
): number {
  if (anchorY < top) return top - anchorY;
  if (anchorY > bottom) return anchorY - bottom;
  return 0;
}

/**
 * What share of a frame's scroll a row lags by (0–1): its distance from
 * the anchor over half the viewport's height, at most all of it (ruling
 * 201 第 2 条). The row under the pointer goes with the scroll.
 */
export function lagShare(distance: number, viewportHeight: number): number {
  const half = viewportHeight / 2;
  if (!(half > 0)) return 0;
  return Math.min(1, Math.max(0, distance) / half);
}

/**
 * A row lags by its share of the scroll: content moving up by `delta`
 * (scrollTop grew) leaves the row lower (positive), at most MAX_LAG_PX
 * from its place. Held at the cap it stops there (its speed 0): let go,
 * it comes back as from rest.
 */
export function lag(
  state: SpringState,
  share: number,
  delta: number,
): SpringState {
  const x = state.x + share * delta;
  if (Math.abs(x) <= MAX_LAG_PX) return { x, v: state.v };
  return { x: Math.sign(x) * MAX_LAG_PX, v: 0 };
}

/**
 * Two rows next to each other at most MAX_NEIGHBOUR_STEP_PX out of step,
 * worked outward from the row at the anchor (`anchor`, its index): a row
 * farther out is held within the step of the one before it, and held
 * there moves as that one does (its speed): stopped instead, it would
 * set off from rest every frame and trail its neighbour, each row out
 * from the anchor waiting for the one before it, long past SETTLE_MS.
 * Returns new states.
 */
export function holdNeighbours(
  states: readonly SpringState[],
  anchor: number,
  step: number = MAX_NEIGHBOUR_STEP_PX,
): SpringState[] {
  const out = states.map((s) => ({ ...s }));
  if (out.length === 0) return out;
  const at = Math.min(Math.max(0, anchor), out.length - 1);
  const hold = (i: number, j: number) => {
    const lo = out[j].x - step;
    const hi = out[j].x + step;
    if (out[i].x < lo) out[i] = { x: lo, v: out[j].v };
    else if (out[i].x > hi) out[i] = { x: hi, v: out[j].v };
  };
  for (let i = at - 1; i >= 0; i--) hold(i, i + 1);
  for (let i = at + 1; i < out.length; i++) hold(i, i - 1);
  return out;
}

/** The index of the row the anchor is on, or the nearest one to it;
 * -1 with no rows. `tops` and `bottoms` in order down the page. */
export function anchorIndex(
  tops: readonly number[],
  bottoms: readonly number[],
  anchorY: number,
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < tops.length; i++) {
    const d = anchorDistance(tops[i], bottoms[i], anchorY);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * What is painted: each offset on the device's pixel grid (text in a
 * layer moved by a fraction of a pixel blurs), still within MAX_LAG_PX
 * and MAX_NEIGHBOUR_STEP_PX on that grid, worked outward from `anchor`
 * as `holdNeighbours`. `dpr`: the device pixel ratio.
 */
export function paintedOffsets(
  offsets: readonly number[],
  anchor: number,
  dpr: number,
): number[] {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const grid = (px: number) => Math.floor(px * ratio + 1e-9) / ratio;
  const cap = grid(MAX_LAG_PX);
  const step = grid(MAX_NEIGHBOUR_STEP_PX);
  const out = offsets.map((x) => {
    const q = Math.round(x * ratio) / ratio;
    return Math.min(cap, Math.max(-cap, q)) || 0;
  });
  if (out.length === 0) return out;
  const at = Math.min(Math.max(0, anchor), out.length - 1);
  const hold = (i: number, j: number) => {
    out[i] = Math.min(out[j] + step, Math.max(out[j] - step, out[i])) || 0;
  };
  for (let i = at - 1; i >= 0; i--) hold(i, i + 1);
  for (let i = at + 1; i < out.length; i++) hold(i, i - 1);
  return out;
}

/** Closer than this to its place (px) and slower than REST_SPEED_PX_S
 * (px/s), a row is at rest: under half a device pixel on a 2x screen,
 * moving less than a tenth of a pixel a frame. */
const REST_PX = 0.25;
const REST_SPEED_PX_S = 6;

export function atRest(state: SpringState): boolean {
  return Math.abs(state.x) < REST_PX && Math.abs(state.v) < REST_SPEED_PX_S;
}

// ---- Whose scroll ----------------------------------------------------------------

/** A scroll this long after a wheel or trackpad tick (its inertia comes
 * as ticks too), a touch, or the scrollbar let go, is still theirs (ms):
 * the scroll event comes a frame or two after the tick that moved it. */
export const WHEEL_GRACE_MS = 150;
/** …and this long after a key that scrolls (ms): the engine animates a
 * key's scroll for a few hundred ms (Page Down, space). */
export const KEY_GRACE_MS = 600;

/** What the person is doing with the conversation's scroller. */
export interface ScrollInput {
  /** Until when (performance.now) a scroll counts as theirs. */
  until: number;
  /** The scrollbar is held (a press on the scroller itself). */
  scrollbar: boolean;
  /** A press in the content: selecting text, whose drag can scroll. */
  selecting: boolean;
}

/**
 * Whether a scroll now is the person's (ruling 201 第 3 条): a wheel or
 * trackpad tick (inertia included), a touch, a key that scrolls, or the
 * scrollbar held, lately — and not while a press in the content selects
 * text. The page side also leaves out every `scrollTop` the app wrote
 * (the follow, the send, a jump, 「回到底部」, a page held in place, a
 * delete's anchor) and a smooth scroll of lib/animate-scroll.ts running.
 */
export function humanScroll(input: ScrollInput, now: number): boolean {
  if (input.selecting) return false;
  return input.scrollbar || now <= input.until;
}

// ---- Where each row is now -------------------------------------------------------

/** The offset painted on each row the spring moves now (px). */
const painted = new WeakMap<Element, number>();

/** The page side records what it paints. */
export function recordBubbleSpring(row: Element, px: number): void {
  if (px === 0) painted.delete(row);
  else painted.set(row, px);
}

/**
 * How far the spring has moved `el` now (px): its row's painted offset,
 * 0 off the spring. A reading that needs a row's place in the layout —
 * a scroll target, an anchor held across frames — takes it off its
 * `getBoundingClientRect()`.
 */
export function bubbleSpringShift(el: Element | null | undefined): number {
  for (let node = el ?? null; node; node = node.parentElement) {
    const px = painted.get(node);
    if (px !== undefined) return px;
  }
  return 0;
}

/** A copy of a row (a removal's, the typing bubble's) stands where the
 * row was seen and does not ride the spring: its own styles off. */
export function clearBubbleSpringStyle(el: HTMLElement): void {
  el.style.removeProperty("translate");
  el.style.removeProperty("will-change");
}
