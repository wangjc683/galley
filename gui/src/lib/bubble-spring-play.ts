/**
 * The page side of the main chat's scroll spring (main chat PRD ruling
 * 201, ticket 150; the rules and the numbers in lib/bubble-spring.ts).
 * Attached to the main chat's scroller (hooks/useScrollSpring.ts), it:
 *
 *   hears    whose each scroll is. The person's: a wheel or trackpad
 *            tick (WebKit sends the inertia after a flick as ticks too),
 *            a touch, a key that scrolls, the scrollbar held — not while
 *            a press in the content selects text. The app's: every
 *            `scrollTop` the app writes on this scroller (the follow and
 *            its pins, the send, a jump, 「回到底部」, a page held in place,
 *            a delete's anchor, the composer's pin) goes through an
 *            accessor put on this one element, which takes that move out
 *            of the count; a smooth scroll of lib/animate-scroll.ts
 *            running counts as the app's too.
 *   moves    each frame, the rows in the viewport and a band around it:
 *            the spring's step over the real frame interval, then each
 *            row's lag of the person's scroll since the last frame, the
 *            caps. A reply and the process card under it move as one.
 *            Painted as `translate`, a property nothing else here
 *            animates (ruling 138's motions and the hand-off use
 *            `transform`, `clip-path` and opacity; the two add up), with
 *            `will-change` only while a row is off its place. No React
 *            state: nothing renders.
 *   rests    once every row is back: no frame runs, no style is left.
 *
 * Reduced motion: nothing moves, read on every scroll and frame.
 */
import {
  isUserScrollKey,
  prefersReducedMotion,
  scrollDestination,
} from "@/lib/animate-scroll";
import {
  KEY_GRACE_MS,
  WHEEL_GRACE_MS,
  anchorDistance,
  anchorIndex,
  atRest,
  bubbleSpringShift,
  holdNeighbours,
  humanScroll,
  kickVelocity,
  lag,
  lagShare,
  paintedOffsets,
  recordBubbleSpring,
  springStep,
  type ScrollInput,
  type SpringState,
} from "@/lib/bubble-spring";
import { firstRowBelow } from "@/lib/scroll-anchor";

const CONVERSATION = '[data-role="conversation"]';
/** The process card under a reply (AssistantProcessCard): it moves with
 * the reply. */
const PROCESS_CARD = '[data-role="assistant-process-card"]';
/** ruling 138's layer of copies (lib/bubble-motion-play.ts). */
const LAYER = "data-bubble-motion-layer";
/** Rows this far beyond the viewport's edges move too (px): a row
 * coming into view already lags as its neighbours do. */
const BAND_PX = 160;
/** The first frame after a rest has no interval of its own (ms). */
const FIRST_FRAME_MS = 1000 / 60;
/** Longer than this between two frames (a hidden window) is taken as
 * this (ms): the spring is at rest long before. */
const MAX_FRAME_MS = 1000;

/** A row as the spring moves it: the elements it paints (a reply and
 * the process card under it), where it is in the layout (viewport px,
 * the spring's offset taken off). */
interface Group {
  key: HTMLElement;
  members: HTMLElement[];
  top: number;
  bottom: number;
}

interface Row {
  members: HTMLElement[];
  state: SpringState;
  /** It was in the band last frame (not only pushed: ticket 151's push
   * on a row the spring was not moving yet). */
  banded: boolean;
}

/** The rows the eye reads, in order: the conversation's, then what
 * MainView draws after it in the column (the typing bubble, the live
 * question, the step-limit tail). As lib/bubble-motion-play.ts reads
 * them. */
function rowsOf(column: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of Array.from(column.children)) {
    if (!(child instanceof HTMLElement) || child.hasAttribute(LAYER)) continue;
    if (child.matches(CONVERSATION)) {
      for (const row of Array.from(child.children)) {
        if (row instanceof HTMLElement) rows.push(row);
      }
    } else {
      rows.push(child);
    }
  }
  return rows;
}

/** Where `el` is in the layout (viewport px): its box less the spring. */
function placeOf(el: HTMLElement): { top: number; bottom: number } {
  const rect = el.getBoundingClientRect();
  const shift = bubbleSpringShift(el);
  return { top: rect.top - shift, bottom: rect.bottom - shift };
}

/** The rows in the viewport and the band around it, a reply's process
 * card joined to it. */
function readGroups(
  column: HTMLElement,
  viewTop: number,
  viewHeight: number,
): Group[] {
  const rows = rowsOf(column);
  const from = viewTop - BAND_PX;
  const to = viewTop + viewHeight + BAND_PX;
  let first = firstRowBelow(rows.length, (i) => placeOf(rows[i]).bottom, from);
  if (first < 0) return [];
  while (first > 0 && rows[first].matches(PROCESS_CARD)) first--;
  const groups: Group[] = [];
  for (let i = first; i < rows.length; i++) {
    const row = rows[i];
    const { top, bottom } = placeOf(row);
    const last = groups[groups.length - 1];
    if (last && row.matches(PROCESS_CARD)) {
      last.members.push(row);
      last.bottom = Math.max(last.bottom, bottom);
      continue;
    }
    if (top > to) break;
    groups.push({ key: row, members: [row], top, bottom });
  }
  return groups;
}

/** The scroller's `scrollTop` as the engine has it, under the accessor. */
interface ScrollTopAccess {
  get: () => number;
  restore: () => void;
}

/**
 * Puts an accessor for `scrollTop` on `el` itself that does what the
 * engine's does and tells `onWrite` each write the app makes (the value
 * before, the value after). Null when it cannot be put (then the app's
 * writes go unheard, and only the person's input decides).
 */
function watchWrites(
  el: HTMLElement,
  onWrite: (before: number, after: number) => void,
): ScrollTopAccess | null {
  const own = Object.getOwnPropertyDescriptor(el, "scrollTop");
  let base = own;
  for (
    let proto: object | null = Object.getPrototypeOf(el);
    !base && proto;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    base = Object.getOwnPropertyDescriptor(proto, "scrollTop");
  }
  const get = base?.get;
  const set = base?.set;
  if (!get || !set) return null;
  try {
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      enumerable: base?.enumerable ?? true,
      get(this: HTMLElement) {
        return get.call(this) as number;
      },
      set(this: HTMLElement, value: number) {
        const before = get.call(this) as number;
        set.call(this, value);
        onWrite(before, get.call(this) as number);
      },
    });
  } catch {
    return null;
  }
  return {
    get: () => get.call(el) as number,
    restore: () => {
      if (own) Object.defineProperty(el, "scrollTop", own);
      else Reflect.deleteProperty(el, "scrollTop");
    },
  };
}

class BubbleSpring {
  /** `scrollTop` as last counted. */
  private seen: number;
  /** The person's scroll since the last frame (px; down positive). */
  private pending = 0;
  private readonly input: ScrollInput = {
    until: -Infinity,
    scrollbar: false,
    selecting: false,
  };
  /** The person's last scroll came from the pointer (wheel, touch): the
   * anchor is where the pointer is; else (keys, the scrollbar) the
   * viewport's middle. */
  private byPointer = false;
  /** The pointer's height over the scroller (client px); null off it. */
  private pointerY: number | null = null;
  private pointerInside: boolean | null = null;
  /** The anchor (client px) the rows lag from, kept while they settle. */
  private anchorY: number | null = null;
  /** When the person's scroll last moved the conversation. */
  private movedAt = -Infinity;
  private rows = new Map<HTMLElement, Row>();
  /** Elements given `will-change`: until the rest. */
  private readonly lifted = new Set<HTMLElement>();
  private frame: number | null = null;
  private lastAt: number | null = null;
  private readonly cleanups: (() => void)[] = [];
  private readonly access: ScrollTopAccess | null;

  constructor(private readonly container: HTMLElement) {
    this.access = watchWrites(container, (before, after) => {
      this.count(before);
      this.seen = after;
    });
    if (this.access) this.cleanups.push(this.access.restore);
    this.seen = this.top();

    const on = (
      target: EventTarget | null | undefined,
      type: string,
      handler: (event: Event) => void,
    ) => {
      if (!target) return;
      target.addEventListener(type, handler, { passive: true });
      this.cleanups.push(() => target.removeEventListener(type, handler));
    };
    const doc = container.ownerDocument;
    const win = doc.defaultView;

    on(container, "scroll", () => this.count(this.top()));
    on(container, "wheel", (event) => {
      this.heard(WHEEL_GRACE_MS);
      this.byPointer = true;
      if (this.pointerInside !== false) {
        this.pointerY = (event as WheelEvent).clientY;
      }
    });
    const onTouch = (event: Event) => {
      this.heard(WHEEL_GRACE_MS);
      this.byPointer = true;
      const touch = (event as TouchEvent).touches?.[0];
      if (touch) this.pointerY = touch.clientY;
    };
    on(container, "touchstart", onTouch);
    on(container, "touchmove", onTouch);
    on(container, "pointerenter", () => {
      this.pointerInside = true;
    });
    on(container, "pointermove", (event) => {
      const pointer = event as PointerEvent;
      this.pointerInside = true;
      this.pointerY = pointer.clientY;
      // A release lost outside the window.
      if (pointer.buttons === 0) {
        this.input.scrollbar = false;
        this.input.selecting = false;
      }
    });
    on(container, "pointerleave", () => {
      this.pointerInside = false;
      this.pointerY = null;
    });
    on(container, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (event.target === container) {
        // The scroller itself, not its content: the scrollbar (as
        // lib/animate-scroll.ts reads it).
        this.input.scrollbar = true;
        this.byPointer = false;
      } else if (pointer.pointerType !== "touch" && pointer.button === 0) {
        this.input.selecting = true;
      }
    });
    const onRelease = () => {
      // The scrollbar's last move arrives after the release.
      if (this.input.scrollbar) this.heard(WHEEL_GRACE_MS);
      this.input.scrollbar = false;
      this.input.selecting = false;
    };
    on(win, "pointerup", onRelease);
    on(win, "pointercancel", onRelease);
    on(doc, "keydown", (event) => {
      if (!isUserScrollKey(event)) return;
      this.heard(KEY_GRACE_MS);
      this.byPointer = false;
    });
  }

  private top(): number {
    return this.access ? this.access.get() : this.container.scrollTop;
  }

  private heard(graceMs: number): void {
    this.input.until = Math.max(this.input.until, performance.now() + graceMs);
  }

  /** `scrollTop` is `top` now: what moved it since the last count is
   * the person's when they are scrolling, and nothing else is running. */
  private count(top: number): void {
    const delta = top - this.seen;
    this.seen = top;
    if (delta === 0) return;
    const now = performance.now();
    if (!humanScroll(this.input, now)) return;
    if (scrollDestination(this.container) !== null) return;
    if (prefersReducedMotion()) return;
    this.pending += delta;
    this.movedAt = now;
    this.schedule();
  }

  /** The person's scroll moved the conversation just now. */
  scrolling(): boolean {
    return performance.now() - this.movedAt <= WHEEL_GRACE_MS;
  }

  /** The row `el` is in: a child of the conversation, or of the column
   * (the typing bubble, the live question); a process card's is its
   * reply's. */
  private rowFor(el: Element): HTMLElement | null {
    const column = this.container.firstElementChild;
    for (
      let node: Element | null = el;
      node && node !== this.container;
      node = node.parentElement
    ) {
      const parent = node.parentElement;
      if (parent === column || parent?.matches(CONVERSATION)) {
        const row = node.matches(PROCESS_CARD)
          ? node.previousElementSibling
          : node;
        return row instanceof HTMLElement ? row : null;
      }
    }
    return null;
  }

  kick(el: Element, peakPx: number): boolean {
    if (prefersReducedMotion()) return false;
    const row = this.rowFor(el);
    const velocity = kickVelocity(peakPx);
    if (!row || velocity === 0) return false;
    const entry = this.rows.get(row);
    if (entry) {
      entry.state = { x: entry.state.x, v: entry.state.v + velocity };
    } else {
      this.rows.set(row, {
        members: [row],
        state: { x: 0, v: velocity },
        banded: false,
      });
    }
    this.schedule();
    return true;
  }

  private schedule(): void {
    if (this.frame === null) this.frame = requestAnimationFrame(this.step);
  }

  private readonly step = (time: number): void => {
    this.frame = null;
    const dt =
      this.lastAt === null
        ? FIRST_FRAME_MS
        : Math.min(MAX_FRAME_MS, Math.max(0, time - this.lastAt));
    this.lastAt = time;
    const delta = this.pending;
    this.pending = 0;
    const column = this.container.firstElementChild;
    if (prefersReducedMotion() || !(column instanceof HTMLElement)) {
      this.rest();
      return;
    }

    // Everything read before anything is written.
    const view = this.container.getBoundingClientRect();
    const viewTop = view.top + this.container.clientTop;
    const viewHeight = this.container.clientHeight;
    if (delta !== 0 || this.anchorY === null) {
      this.anchorY =
        this.byPointer && this.pointerY !== null
          ? Math.min(viewTop + viewHeight, Math.max(viewTop, this.pointerY))
          : viewTop + viewHeight / 2;
    }
    const anchorY = this.anchorY;
    const groups = readGroups(column, viewTop, viewHeight);
    const at = anchorIndex(
      groups.map((g) => g.top),
      groups.map((g) => g.bottom),
      anchorY,
    );

    // A row new to a band that was already moving (scrolled in, or just
    // drawn) starts where its neighbour is: it lags as they do. From a
    // rest (the first frame of a scroll, or a push) every row starts at
    // its place.
    const known = groups.map((g) => this.rows.get(g.key) ?? null);
    const states0 = known.map((row) => row?.state ?? null);
    const banded = known.map((row) => row?.banded === true);
    for (let i = 1; i < states0.length; i++) {
      const above = states0[i - 1];
      if (!states0[i] && banded[i - 1] && above) {
        states0[i] = { ...above };
        banded[i] = true;
      }
    }
    for (let i = states0.length - 2; i >= 0; i--) {
      const below = states0[i + 1];
      if (!states0[i] && banded[i + 1] && below) {
        states0[i] = { ...below };
        banded[i] = true;
      }
    }
    let states = states0.map((s) => springStep(s ?? { x: 0, v: 0 }, dt));
    if (delta !== 0) {
      states = states.map((s, i) =>
        lag(
          s,
          lagShare(
            anchorDistance(groups[i].top, groups[i].bottom, anchorY),
            viewHeight,
          ),
          delta,
        ),
      );
    }
    states = holdNeighbours(states, at);
    const dpr = this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const paint = paintedOffsets(
      states.map((s) => s.x),
      at,
      dpr,
    );

    const next = new Map<HTMLElement, Row>();
    groups.forEach((group, i) => {
      next.set(group.key, {
        members: group.members,
        state: states[i],
        banded: true,
      });
      for (const el of group.members) this.paint(el, paint[i]);
    });
    for (const [key, row] of this.rows) {
      if (next.has(key)) continue;
      for (const el of row.members) this.unpaint(el);
    }
    this.rows = next;

    if (this.pending === 0 && states.every(atRest)) {
      this.rest();
      return;
    }
    this.schedule();
  };

  private paint(el: HTMLElement, px: number): void {
    if (px !== 0 && !this.lifted.has(el)) {
      el.style.setProperty("will-change", "transform");
      this.lifted.add(el);
    }
    if (bubbleSpringShift(el) === px) return;
    if (px === 0) el.style.removeProperty("translate");
    else el.style.setProperty("translate", `0 ${px}px`);
    recordBubbleSpring(el, px);
  }

  private unpaint(el: HTMLElement): void {
    el.style.removeProperty("translate");
    el.style.removeProperty("will-change");
    recordBubbleSpring(el, 0);
    this.lifted.delete(el);
  }

  /** Every row back in place, the layers dropped, no frame. */
  private rest(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    for (const row of this.rows.values()) {
      for (const el of row.members) this.unpaint(el);
    }
    for (const el of [...this.lifted]) this.unpaint(el);
    this.rows.clear();
    this.lastAt = null;
    this.anchorY = null;
  }

  detach(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.pending = 0;
    this.rest();
  }
}

const springs = new WeakMap<HTMLElement, BubbleSpring>();

/** Hangs the main chat's rows on the spring (`container`: its scroller).
 * Returns the detach: listeners and the accessor off, every row back. */
export function attachBubbleSpring(container: HTMLElement): () => void {
  springs.get(container)?.detach();
  const spring = new BubbleSpring(container);
  springs.set(container, spring);
  return () => {
    spring.detach();
    if (springs.get(container) === spring) springs.delete(container);
  };
}

/**
 * Ticket 151's way in: gives the row `el` is in a push that carries it
 * `peakPx` past its place (at most MAX_KICK_PX; negative: up, the way a
 * bubble coming up from below goes), then the same spring brings it
 * back. False when nothing moves: no spring here (not the main chat),
 * reduced motion, no row.
 */
export function kickBubbleRow(
  container: HTMLElement,
  el: Element,
  peakPx: number,
): boolean {
  return springs.get(container)?.kick(el, peakPx) ?? false;
}

/** Whether the person's scroll is moving the main chat's rows now (a
 * landing bounce then stays out: ticket 151). */
export function bubbleSpringScrolling(container: HTMLElement): boolean {
  return springs.get(container)?.scrolling() ?? false;
}
