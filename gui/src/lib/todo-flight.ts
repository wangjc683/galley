import type { FreshCard } from "@/lib/fresh-cards";

/**
 * A card's glyph flying into the top bar's 「待办」 button (main chat
 * ticket 102, PRD ruling 147 point 6), as Safari's downloads fly into
 * its toolbar button: each time a to-do, a reminder or a memo is noted
 * under a reply while the panel is not on screen, a copy of the card's
 * glyph (the box, the alarm, the notepad) arcs into the button, and the
 * button pops once as it catches it. Every time, no 「learned, stop」:
 * it is a receipt for old hands too. It overrules no one's panel switch
 * and covers nothing.
 *
 * Everything here is pure — the plan, the timing, the path — so it is
 * pinned in tests; lib/todo-flight-run.ts measures and moves the DOM.
 * Fly and pop at the middle size, since JC compared the three forms and
 * sizes on ticket 102's pill (main chat ticket 104, PRD ruling 149
 * point 1; `FLIGHT_LEVEL`).
 */

/** How big a flight and its pop are. */
export interface FlightLevel {
  /** The arc's control point, this far above the midpoint, px. */
  lift: number;
  /** The glyph's size halfway, px: 16 at the card, 12 at the button. */
  peak: number;
  /** One flight, start to landing. */
  durationMs: number;
  /** The button's pop at its fullest; it dips under 1 once after. */
  popScale: number;
}

/**
 * The size JC picked (ruling 149 point 1): ticket 102's middle level —
 * the arc's control point 100px up, the glyph 20px halfway, 560ms; the
 * pop to 1.15. The big (160px, 24px, 700ms, 1.25) and the small (60px,
 * 16px, 450ms, 1.08) went with the trial's switcher.
 */
export const FLIGHT_LEVEL: FlightLevel = {
  lift: 100,
  peak: 20,
  durationMs: 560,
  popScale: 1.15,
};

/** The glyph's size as it leaves the card (its 16px column) and as it
 * lands in the button. */
export const FLIGHT_START_PX = 16;
export const FLIGHT_END_PX = 12;
/** Several new cards under one reply fly one after another, this far
 * apart. */
export const FLIGHT_STAGGER_MS = 90;
/** The last stretch of a flight fades out, into the button. */
export const FLIGHT_FADE_MS = 80;
/** The button's pop: about `sidebar-state-pop`'s 0.44s. */
export const CATCH_POP_MS = 440;
/** Reduced motion: the button's `bg-hover` fading back. */
export const CATCH_WASH_MS = 600;

/**
 * The flight's ease: `--ease-exit` (globals.css, `cubic-bezier(0.4, 0,
 * 1, 1)`), the token for leaving. It starts gently off the card and
 * gathers speed into the button, arriving at its fastest, where the pop
 * takes the blow — drawn in. `--ease-firm` (the ticket's first
 * suggestion) is an ease-out: it slows down to land softly, so the pop
 * would come after a glyph that has already stopped, two beats instead
 * of one.
 */
export const FLIGHT_EASE: readonly [number, number, number, number] = [
  0.4, 0, 1, 1,
];

/** CSS's `cubic-bezier(x1, y1, x2, y2)` as a function of time (0–1). */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) =>
    3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton's method on x, then bisection if the slope gives out.
    let s = t;
    for (let i = 0; i < 8; i += 1) {
      const dx = at(x1, x2, s) - t;
      if (Math.abs(dx) < 1e-6) return at(y1, y2, s);
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i += 1) {
      const x = at(x1, x2, s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return at(y1, y2, s);
  };
}

const ease = cubicBezier(...FLIGHT_EASE);

export interface Point {
  x: number;
  y: number;
}

/** Where a glyph is at one moment of its flight: its centre, its size
 * (px, square) and how opaque. */
export interface FlightFrame extends Point {
  size: number;
  opacity: number;
}

/** 0 → 1, easing in and out (smoothstep). */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * A glyph `elapsedMs` into its flight from `from` (the card glyph's
 * centre) to `to` (the button glyph's centre): along a quadratic Bézier
 * whose control point is the midpoint lifted `level.lift` px towards the
 * window's top, at the eased progress (`FLIGHT_EASE`); 16px at the card,
 * `level.peak` halfway, 12px at the button; opaque until the last
 * `FLIGHT_FADE_MS`, then gone.
 */
export function flightFrame(
  from: Point,
  to: Point,
  level: FlightLevel,
  elapsedMs: number,
): FlightFrame {
  const t = Math.min(Math.max(elapsedMs / level.durationMs, 0), 1);
  const p = ease(t);
  const control = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - level.lift,
  };
  const a = (1 - p) ** 2;
  const b = 2 * (1 - p) * p;
  const c = p * p;
  const size =
    p <= 0.5
      ? FLIGHT_START_PX + (level.peak - FLIGHT_START_PX) * smooth(p / 0.5)
      : level.peak + (FLIGHT_END_PX - level.peak) * smooth((p - 0.5) / 0.5);
  const left = level.durationMs - elapsedMs;
  return {
    x: a * from.x + b * control.x + c * to.x,
    y: a * from.y + b * control.y + c * to.y,
    size,
    opacity: Math.min(Math.max(left / FLIGHT_FADE_MS, 0), 1),
  };
}

/** When each of `count` glyphs takes off, and when the button pops: as
 * the last lands; at once when none flies. */
export function flightSchedule(
  count: number,
  level: FlightLevel,
): { starts: number[]; popAt: number } {
  const starts = Array.from({ length: count }, (_, i) => i * FLIGHT_STAGGER_MS);
  return {
    starts,
    popAt: count > 0 ? starts[count - 1] + level.durationMs : 0,
  };
}

/** The pop's dip after its fullest, as deep in proportion: 1.25 dips to
 * 0.96 (`sidebar-state-pop`'s shape, ticket 102's big level), the 1.15
 * picked to 0.976. */
export function catchDip(popScale: number): number {
  return Math.round((1 - (popScale - 1) * 0.16) * 1000) / 1000;
}

/** What `cardFlightPlan` decides on. */
export interface CardFlightInput {
  /** The cards that have just appeared (lib/fresh-cards.ts): a to-do, a
   * reminder, a memo noted or changed — none of a subtask, none on a
   * first read or when a card only changes. */
  fresh: readonly FreshCard[];
  /** Galley's conversation itself is in the main area. */
  mainChatOnScreen: boolean;
  /** The panel is on screen (lib/todo-open.ts `todoView(...).shown`): it
   * lights the rows instead (ticket 87). */
  panelShown: boolean;
  /** The system's 「减少动态效果」. */
  reducedMotion: boolean;
  /** Whether a card's glyph is in view (not scrolled out). */
  inView: (card: FreshCard) => boolean;
}

/** The glyphs that fly (in order, `FLIGHT_STAGGER_MS` apart) and how the
 * button catches: a pop, or under reduced motion a wash of `bg-hover`. */
export interface CardFlightPlan {
  fly: FreshCard[];
  catch: "pop" | "wash";
}

/**
 * Whether the new cards fly (main chat ticket 102, PRD ruling 147 point
 * 6). Null: nothing happens — the main chat not on screen, the panel on
 * screen (its rows light), or no card. The panel's one opening by
 * itself is decided first, and when it opens nothing flies (the caller,
 * hooks/useFreshCards.ts). A round you sent and one Core woke Galley for
 * alike. Reduced motion: nothing flies or scales, the button's ground
 * washes once. A card whose glyph is scrolled out of view does not fly;
 * when none is in view, the button only pops.
 */
export function cardFlightPlan(input: CardFlightInput): CardFlightPlan | null {
  if (input.fresh.length === 0 || !input.mainChatOnScreen || input.panelShown) {
    return null;
  }
  if (input.reducedMotion) return { fly: [], catch: "wash" };
  return { fly: input.fresh.filter(input.inView), catch: "pop" };
}
