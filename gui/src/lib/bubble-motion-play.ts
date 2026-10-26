/**
 * The page side of the main chat's bubbles coming and going (main chat
 * PRD ruling 138, ticket 94; the rules and the timing in
 * lib/bubble-motion.ts). Each motion is read in two halves:
 *
 *   before   inside the store write that changes the conversation
 *            (React has not rendered it yet, so the DOM is what is on
 *            screen): a send, a deletion or a message put back. The
 *            typing bubble is read every commit while its round is live
 *            instead (hooks/useBubbleMotion.ts), as the hand-off does.
 *   after    in the frame that first shows the change, after the
 *            conversation's own last word on where it ends up — the
 *            anchor's hold and the send's pin run in the commit, the
 *            follow's pin in its ResizeObserver — and before paint
 *            (`beforePaint`).
 *
 * Then what moved is put back where it looked to be, with `transform`,
 * and let go to its place; what left is a copy where it stood, in a
 * zero-size layer, playing its way out. The layout, every box the follow
 * and the anchors read, is final from the first frame (the hand-off's
 * rule, hooks/useTypingBubbleHandoff.ts).
 */
import {
  SCROLL_ANIMATED_MAX_PX,
  prefersReducedMotion,
} from "@/lib/animate-scroll";
import {
  DELETE_SHRINK_SCALE,
  bubbleMotionMode,
  columnSlide,
  holdBubbleMotion,
  readBubbleMotionTiming,
  releaseBubbleMotion,
  rowShift,
  rowsMotion,
  sendFades,
  shrinkOrigin,
  slideKeyframes,
  typingLeaveFades,
  wokenTypingFade,
  type BubbleMotionTiming,
  type ColumnSlide,
  type FadeTiming,
  type RowSide,
  type RunningBubbleMotion,
  type SlideTiming,
} from "@/lib/bubble-motion";
import { firstRowBelow } from "@/lib/scroll-anchor";
import type { Box } from "@/lib/typing-bubble-handoff";
import {
  carryLoop,
  carrySweep,
  dropRollingSentence,
  timelineNow,
} from "@/lib/typing-bubble-phase";

const CONVERSATION = '[data-role="conversation"]';
const TYPING = '[data-role="assistant-typing"]';
const USER_MSG = '[data-role="user-msg"], [data-role="user-msg-reply"]';
const TIME_LINE = '[data-role="message-time-divider"]';
/** The row of chips that only shows on hover (your copy · quote · ⋯,
 * a reply's bar): not in a leaving copy, where it would stay lit from
 * the menu just closed. */
const HOVER_ROW = "[data-hover-row]";
/** The zero-size layer the copies play in. */
const LAYER = "data-bubble-motion-layer";

// ---- Reading the column ---------------------------------------------------

/** The conversation column: the scroller's one child. */
export function columnOf(container: HTMLElement): HTMLElement | null {
  const column = container.firstElementChild;
  return column instanceof HTMLElement ? column : null;
}

function isLayer(el: Element): boolean {
  return el.hasAttribute(LAYER);
}

/** The conversation's root (Conversation; its rows are its children). */
export function conversationOf(column: HTMLElement): HTMLElement | null {
  for (const child of Array.from(column.children)) {
    if (child instanceof HTMLElement && child.matches(CONVERSATION)) {
      return child;
    }
  }
  return null;
}

/** The typing bubble's row (TypingBubble), when it is up. */
export function typingRowOf(column: HTMLElement): HTMLElement | null {
  for (const child of Array.from(column.children)) {
    if (child instanceof HTMLElement && child.matches(TYPING)) return child;
  }
  return null;
}

/** The rows the eye reads, in order: the conversation's, then what
 * MainView draws after it in the column (the typing bubble, the live
 * question, the step-limit tail). */
function rowsOf(column: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of Array.from(column.children)) {
    if (!(child instanceof HTMLElement) || isLayer(child)) continue;
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

function sideOf(row: Element): RowSide {
  if (row.matches(TIME_LINE)) return "time";
  if (row.matches(USER_MSG) || row.querySelector(USER_MSG)) return "user";
  return "assistant";
}

/** The column's top in the viewport (px below the scroller's top). */
export function columnViewTop(
  column: HTMLElement,
  container: HTMLElement,
): number {
  return (
    column.getBoundingClientRect().top - container.getBoundingClientRect().top
  );
}

/** How far `el` is moved by a `translateY` on it now (its computed
 * transform's vertical part; 0 without one). */
export function translateYOf(el: Element): number {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === "none") return 0;
  const values = /\(([^)]*)\)/.exec(transform)?.[1].split(",").map(Number);
  if (!values) return 0;
  const ty = transform.startsWith("matrix3d") ? values[13] : values[5];
  return Number.isFinite(ty) ? ty : 0;
}

// ---- Running ---------------------------------------------------------------

/**
 * One motion on the page: its animations, what to put back when it
 * ends, and the typing bubble's fade-in if it has one. It ends by
 * itself once every animation has, or at once when settled
 * (lib/bubble-motion.ts `settleBubbleMotion`).
 */
class Run implements RunningBubbleMotion {
  private readonly animations: Animation[] = [];
  private readonly undo: (() => void)[] = [];
  private typingFade: Animation | null = null;
  private done = false;

  constructor(private readonly container: HTMLElement) {
    holdBubbleMotion(container, this);
  }

  play(
    el: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options: KeyframeAnimationOptions,
  ): Animation {
    const animation = el.animate(keyframes, options);
    this.animations.push(animation);
    return animation;
  }

  fade(el: Element, opacity: [number, number], fade: FadeTiming): Animation {
    return this.play(
      el,
      { opacity },
      {
        duration: fade.durationMs,
        delay: fade.delayMs,
        easing: fade.easing,
        // Coming in: transparent while it waits. Going: gone once faded
        // (the layer goes with the motion).
        fill: opacity[0] < opacity[1] ? "backwards" : "forwards",
      },
    );
  }

  /** The typing bubble's fade-in: what a hand-off or its going starts
   * the dots' copy from, should it come first. */
  watchTyping(animation: Animation): void {
    this.typingFade = animation;
  }

  onEnd(undo: () => void): void {
    this.undo.push(undo);
  }

  /** A layer for copies, in the column (so a copy keeps the column's
   * text rules: the bubbles' leading and gap, ASSISTANT_BUBBLE_TEXT_CLASS)
   * but out of its flow: absolutely placed at the scroll content's
   * origin, the scroller being its containing block, so it scrolls with
   * the content, has no box of its own (the follow's 「reply start」
   * skips boxes without height) and is not clipped by the column. Hidden
   * from assistive tech, inert, the pointer goes through. */
  layer(column: HTMLElement): HTMLDivElement {
    const layer = document.createElement("div");
    layer.setAttribute(LAYER, "");
    layer.setAttribute("aria-hidden", "true");
    layer.inert = true;
    layer.style.cssText =
      "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none";
    column.append(layer);
    this.onEnd(() => layer.remove());
    return layer;
  }

  /** Clip the column's content to its box while it is moved down, so the
   * part pushed past its end adds no scroll range: the scroll listener
   * would read 「not at the bottom」 and stop following (the hand-off's
   * way, ticket 51). It must not shrink: the main chat's scroller is a
   * flex column, and WebKit takes a flex item's automatic minimum height
   * to be 0 once its overflow is not visible — the column squeezed to
   * the viewport's height, the scroll range gone, the conversation
   * drawn from its first rows until the clip came off (ticket 94, the
   * flash on send in tauri dev). */
  clip(column: HTMLElement): void {
    const previous = column.style.overflow;
    const previousShrink = column.style.flexShrink;
    column.style.overflow = "clip";
    column.style.flexShrink = "0";
    this.onEnd(() => {
      column.style.overflow = previous;
      column.style.flexShrink = previousShrink;
    });
  }

  /** Every animation added: end once they all have. */
  arm(): void {
    const end = () => this.end();
    void Promise.all(this.animations.map((a) => a.finished)).then(end, end);
  }

  finish(): void {
    this.end();
  }

  typingOpacity(): number | null {
    const animation = this.typingFade;
    if (!animation || this.done) return null;
    const timing = animation.effect?.getComputedTiming?.();
    if (!timing || timing.progress === null || timing.progress === undefined) {
      return null;
    }
    return Math.min(1, Math.max(0, timing.progress));
  }

  private end(): void {
    if (this.done) return;
    this.done = true;
    releaseBubbleMotion(this.container, this);
    for (const animation of this.animations) animation.cancel();
    for (const undo of this.undo) undo();
  }
}

/**
 * Runs `start` in the frame that first shows the commit just made, after
 * layout and before paint, once everything that puts the conversation in
 * its place has had its say: a ResizeObserver made now reports `target`
 * after every observer made before it (useStickyScroll's follow, the
 * composer's viewport pin, the hand-off's), and its first report comes
 * whether the box changed or not. Without ResizeObserver it runs now.
 * Returns the cancel.
 */
function beforePaint(target: Element, start: () => void): () => void {
  if (typeof ResizeObserver !== "function") {
    start();
    return () => {};
  }
  let pending = true;
  const observer = new ResizeObserver(() => {
    observer.disconnect();
    if (!pending) return;
    pending = false;
    start();
  });
  observer.observe(target);
  return () => {
    pending = false;
    observer.disconnect();
  };
}

/** Starts a motion on `container`: the run is held at once (anything
 * after it in this task settles it), and `play` runs before paint with
 * the tokens and the mode, unless they cannot be read or the page has no
 * Web Animations — then nothing moves. */
function start(
  container: HTMLElement,
  column: HTMLElement,
  play: (run: Run, timing: BubbleMotionTiming) => void,
): void {
  const run = new Run(container);
  run.onEnd(
    beforePaint(column, () => {
      const timing = readBubbleMotionTiming();
      if (!timing || typeof column.animate !== "function") {
        run.finish();
        return;
      }
      try {
        play(run, timing);
      } catch (error) {
        // Whatever went wrong, the page is left as it ends up.
        run.finish();
        console.warn("[bubble-motion]", error);
        return;
      }
      run.arm();
    }),
  );
}

/** The column's content slid by `slide`: everything in it (the
 * conversation, the typing bubble, the live question, the step-limit
 * tail), and `also` beside it (a copy that moves with them), clipped
 * while it is moved down. */
function slideColumn(
  run: Run,
  column: HTMLElement,
  keyframes: Keyframe[],
  timing: SlideTiming,
  down: boolean,
  also: readonly Element[] = [],
): void {
  if (down) run.clip(column);
  const options = { duration: timing.durationMs, easing: timing.easing };
  for (const child of Array.from(column.children)) {
    if (!isLayer(child)) run.play(child, keyframes, options);
  }
  for (const el of also) run.play(el, keyframes, options);
}

/** A copy of `el` for the layer: the same look, nothing anything else
 * finds — no ids, no message ids (the menu, the locate, the hand-off look
 * rows up by them), your bubble's role renamed (the follow takes the
 * last `user-msg` for the start of the reply; the column's leading rule
 * still matches `user-msg*`), the hover row hidden. */
function copyOf(el: HTMLElement, role: string): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const node of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    node.removeAttribute("id");
    node.removeAttribute("data-message-id");
    node.removeAttribute("data-selection-yield");
    node.removeAttribute("data-selection-copy-scope");
    const own = node.getAttribute("data-role");
    if (own === "user-msg" || own === "user-msg-reply") {
      node.setAttribute("data-role", `${own}-leaving`);
    }
  }
  for (const hover of Array.from(
    copy.querySelectorAll<HTMLElement>(HOVER_ROW),
  )) {
    hover.style.visibility = "hidden";
  }
  copy.setAttribute("data-role", role);
  copy.removeAttribute("role");
  return copy;
}

/** `copy` placed at `box` (in the scroll content), out of the flow. */
function place(copy: HTMLElement, box: Box): void {
  copy.style.position = "absolute";
  copy.style.margin = "0";
  copy.style.top = `${box.top}px`;
  copy.style.left = `${box.left}px`;
  copy.style.width = `${box.width}px`;
  copy.style.height = `${box.height}px`;
}

/** Where the scroll content's origin is, in the viewport. */
function contentOrigin(container: HTMLElement): { top: number; left: number } {
  const rect = container.getBoundingClientRect();
  return {
    top: rect.top + container.clientTop - container.scrollTop,
    left: rect.left + container.clientLeft - container.scrollLeft,
  };
}

// ---- A send ----------------------------------------------------------------

/** What was on screen when your message went in. */
export interface SendBefore {
  /** The column's top in the viewport. */
  columnTop: number;
  /** The conversation's last row then: the rows after it are new. */
  lastRow: Element | null;
  /** The typing bubble was up already (a `/btw` question while it runs). */
  typing: boolean;
}

export function captureSend(container: HTMLElement): SendBefore | null {
  const column = columnOf(container);
  if (!column) return null;
  return {
    columnTop: columnViewTop(column, container),
    lastRow: conversationOf(column)?.lastElementChild ?? null,
    typing: typingRowOf(column) !== null,
  };
}

/** Your new message's row and the time line that came with it: the new
 * rows after the old last one that are yours or a time line (an
 * answered question's echo, drawn where the live one stood, does not
 * fade). The last row redrawn: your newest message's row alone. */
function sentRows(column: HTMLElement, lastRow: Element | null): Element[] {
  const root = conversationOf(column);
  if (!root) return [];
  const rows = Array.from(root.children);
  const at = lastRow ? rows.indexOf(lastRow) : -1;
  if (lastRow && at < 0) {
    const users = root.querySelectorAll(USER_MSG);
    let row: Element | null = users[users.length - 1] ?? null;
    while (row && row.parentElement !== root) row = row.parentElement;
    return row ? [row] : [];
  }
  return rows
    .slice(at + 1)
    .filter((row) => row.matches(TIME_LINE) || sideOf(row) === "user");
}

/**
 * The send (ruling 138 第 3 条): the column slides up from where it was
 * on the programmatic scroll's numbers; your bubble fades in with it; the
 * typing bubble, there from the first frame, fades in once the slide is
 * over. Reduced motion: no slide, the fades.
 */
export function playSend(container: HTMLElement, before: SendBefore): void {
  const column = columnOf(container);
  if (!column) return;
  start(container, column, (run, timing) => {
    const mode = bubbleMotionMode(prefersReducedMotion());
    const slide =
      mode === "move"
        ? columnSlide(before.columnTop - columnViewTop(column, container))
        : null;
    const fades = sendFades(timing, slide);
    for (const row of sentRows(column, before.lastRow)) {
      run.fade(row, [0, 1], fades.bubble);
    }
    const typing = typingRowOf(column);
    if (typing && !before.typing) {
      run.watchTyping(run.fade(typing, [0, 1], fades.typing));
    }
    if (slide) slideColumnBy(run, column, slide);
  });
}

function slideColumnBy(
  run: Run,
  column: HTMLElement,
  slide: ColumnSlide,
): void {
  slideColumn(
    run,
    column,
    slideKeyframes(slide),
    // The keyframes carry the curve.
    { durationMs: slide.durationMs, easing: "linear" },
    slide.distance > 0,
  );
}

// ---- The typing bubble -----------------------------------------------------

/** The typing bubble as last read while its round was live. */
export interface TypingSeen {
  row: HTMLElement;
  /** Its place in the column (px), without a motion's transform. */
  box: Box;
  dots: HTMLElement | null;
  loopStart: number | null;
  sweepStart: number | null;
}

/** The typing bubble's row read for its copy: its layout place in the
 * column, and where its loops started (`readLoop`, `readSweep`:
 * lib/typing-bubble-phase.ts, the caller handing in its last reading). */
export function readTyping(
  row: HTMLElement,
  column: HTMLElement,
  readLoop: (dots: HTMLElement) => number | null,
  readSweep: (line: HTMLElement) => number | null,
): TypingSeen {
  const inner = column.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  const dots = row.querySelector<HTMLElement>(
    '[data-role="assistant-typing-dots"]',
  );
  const line = row.querySelector<HTMLElement>(
    '[data-role="assistant-progress"]',
  );
  return {
    row,
    box: {
      top: rect.top - inner.top - translateYOf(row),
      left: rect.left - inner.left,
      width: rect.width,
      height: rect.height,
    },
    dots,
    loopStart: dots ? readLoop(dots) : null,
    sweepStart: line ? readSweep(line) : null,
  };
}

/**
 * A round Core woke it for starts to write (ruling 138 第 5 条): the
 * typing bubble fades in (`--motion-fast`), at once; the column, moved up
 * by it, slides up as after a send. `beforeTop`: the column's top in the
 * viewport as last seen.
 */
export function playTypingAppear(
  container: HTMLElement,
  beforeTop: number,
): void {
  const column = columnOf(container);
  if (!column) return;
  start(container, column, (run, timing) => {
    const mode = bubbleMotionMode(prefersReducedMotion());
    const typing = typingRowOf(column);
    if (typing)
      run.watchTyping(run.fade(typing, [0, 1], wokenTypingFade(timing)));
    const slide =
      mode === "move"
        ? columnSlide(beforeTop - columnViewTop(column, container))
        : null;
    if (slide) slideColumnBy(run, column, slide);
  });
}

/** What came where the typing bubble was, in the same commit: the
 * conversation's new rows after its last one then, and new things in
 * the column (the step-limit tail). Null when that cannot be told (the
 * last row was redrawn): then only the dots fade. */
export function typingSuccessors(
  column: HTMLElement,
  lastRow: Element | null,
  kids: readonly Element[],
): Element[] | null {
  const root = conversationOf(column);
  const after: Element[] = [];
  if (root && lastRow) {
    if (lastRow.parentElement !== root) return null;
    for (let s = lastRow.nextElementSibling; s; s = s.nextElementSibling) {
      after.push(s);
    }
  }
  for (const kid of Array.from(column.children)) {
    if (kid === root || isLayer(kid) || kids.includes(kid)) continue;
    after.push(kid);
  }
  return after;
}

/**
 * The typing bubble going with nothing growing out of it (ruling 138
 * 第 5 条: a stop, an error, the step limit, a reply of dispatch tags
 * only; a woken round's dots as it stops writing): a copy of its row —
 * bubble, dots, the line under them, the loops and the sweep going on in
 * step — fades where it stood (`--motion-fast`, `--ease-exit`), from the
 * opacity its fade-in had reached (`from`); what took its place comes in
 * from half of that; what moved (贴底: the whole column) slides into
 * place as rows do when one is deleted, the copy with it.
 */
export function playTypingLeave(
  container: HTMLElement,
  seen: TypingSeen,
  beforeTop: number,
  successors: readonly Element[] | null,
  from: number,
): void {
  const column = columnOf(container);
  if (!column) return;
  start(container, column, (run, timing) => {
    const mode = bubbleMotionMode(prefersReducedMotion());
    const fades = typingLeaveFades(timing);
    const afterTop = columnViewTop(column, container);
    const moved = beforeTop - afterTop;
    const shift = mode === "move" ? rowShift(beforeTop, afterTop) : null;

    const copy = copyOf(seen.row, "assistant-typing-leaving");
    dropRollingSentence(copy);
    // Its place now (the column's, plus where it stood in it), and where
    // it was seen: the slide below takes it there, or without one it
    // stays where it was.
    const origin = contentOrigin(container);
    const inner = column.getBoundingClientRect();
    place(copy, {
      top: inner.top - origin.top + seen.box.top + (shift === null ? moved : 0),
      left: inner.left - origin.left + seen.box.left,
      width: seen.box.width,
      height: seen.box.height,
    });
    run.layer(column).append(copy);
    const now = timelineNow();
    const dots = copy.querySelector<HTMLElement>(
      '[data-role="assistant-typing-dots"]',
    );
    if (dots) carryLoop(dots, seen.loopStart, now);
    carrySweep(copy, seen.sweepStart, now);
    run.fade(copy, [from, 0], fades.copy);

    for (const el of successors ?? []) run.fade(el, [0, 1], fades.successors);

    if (shift !== null) {
      const motion = rowsMotion(timing, mode).shift;
      slideColumn(
        run,
        column,
        [
          { transform: `translateY(${shift}px)` },
          { transform: "translateY(0px)" },
        ],
        motion,
        shift > 0,
        [copy],
      );
    }
  });
}

// ---- A delete, and what is put back ----------------------------------------

/** A row on screen before a removal, copied before React can take it
 * out (its box: viewport, relative to the scroller's top-left). */
interface RowCopy {
  copy: HTMLElement;
  box: Box;
  side: RowSide;
}

/** The conversation as a removal found it. */
export interface RemovalBefore {
  /** Every row: those not among them afterwards are new. */
  rows: Set<Element>;
  /** Where the rows near the viewport stood (their top, px below the
   * scroller's top): as far out as a row can slide in from. */
  tops: Map<Element, number>;
  /** The rows on screen, copied. */
  copies: Map<Element, RowCopy>;
}

/** Read the conversation for a removal (main chat ticket 32, 38; the
 * anchor reads it in the same store write: hooks/useRemovedTurnsAnchor). */
export function captureRemoval(container: HTMLElement): RemovalBefore | null {
  const column = columnOf(container);
  if (!column) return null;
  const rows = rowsOf(column);
  const outer = container.getBoundingClientRect();
  const viewTop = outer.top;
  const viewBottom = outer.top + container.clientHeight;
  // As far out as a row can slide in from.
  const reach = SCROLL_ANIMATED_MAX_PX;
  const tops = new Map<Element, number>();
  const copies = new Map<Element, RowCopy>();
  const first = firstRowBelow(
    rows.length,
    (i) => rows[i].getBoundingClientRect().bottom,
    viewTop - reach,
  );
  for (let i = first; i >= 0 && i < rows.length; i++) {
    const row = rows[i];
    const rect = row.getBoundingClientRect();
    if (rect.top > viewBottom + reach) break;
    tops.set(row, rect.top - viewTop);
    if (rect.height > 0 && rect.bottom > viewTop && rect.top < viewBottom) {
      copies.set(row, {
        copy: copyOf(row, "conversation-row-leaving"),
        box: {
          top: rect.top - viewTop,
          left: rect.left - outer.left,
          width: rect.width,
          height: rect.height,
        },
        side: sideOf(row),
      });
    }
  }
  return { rows: new Set(rows), tops, copies };
}

/**
 * A deletion or a message put back (ruling 138 第 4 条), once the anchor
 * has held what you look at: the rows gone from the screen leave as
 * copies where they stood, shrinking toward their own bottom corner
 * (`DELETE_SHRINK_SCALE`; the time line, a row taller than the viewport,
 * only fade); the rows still there slide from where they were; rows the
 * removal brought — a message put back, a time line the rules now draw —
 * come in from the same corner once the others have mostly made room.
 * Reduced motion: the copies fade, the rest is at once in place, what
 * comes in fades. Nothing changed on screen (Core deleting what was
 * hidden already): nothing moves.
 */
export function playRemoval(
  container: HTMLElement,
  before: RemovalBefore,
): void {
  const column = columnOf(container);
  if (!column) return;
  start(container, column, (run, timing) => {
    const mode = bubbleMotionMode(prefersReducedMotion());
    const motion = rowsMotion(timing, mode);
    const outer = container.getBoundingClientRect();
    const viewTop = outer.top;
    const viewHeight = container.clientHeight;
    const onScreen = (top: number, height: number) =>
      height > 0 && top + height > 0 && top < viewHeight;
    const rows = rowsOf(column);
    const now = new Set<Element>(rows);
    // Everything read before anything moves.
    const shifts: [Element, number][] = [];
    const entering: [Element, string | null][] = [];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const top = rect.top - viewTop;
      const was = before.tops.get(row);
      if (was !== undefined) {
        const shift = mode === "move" ? rowShift(was, top) : null;
        if (
          shift !== null &&
          (onScreen(top, rect.height) || onScreen(was, rect.height))
        ) {
          shifts.push([row, shift]);
        }
      } else if (!before.rows.has(row) && onScreen(top, rect.height)) {
        entering.push([
          row,
          shrinkOrigin({
            side: sideOf(row),
            height: rect.height,
            viewportHeight: viewHeight,
            mode,
          }),
        ]);
      }
    }
    const scroll = {
      top: container.scrollTop - container.clientTop,
      left: container.scrollLeft - container.clientLeft,
    };

    for (const [row, shift] of shifts) {
      run.play(
        row,
        { transform: [`translateY(${shift}px)`, "translateY(0px)"] },
        { duration: motion.shift.durationMs, easing: motion.shift.easing },
      );
    }
    for (const [row, origin] of entering) {
      run.play(
        row,
        origin
          ? {
              transform: [`scale(${DELETE_SHRINK_SCALE})`, "scale(1)"],
              opacity: [0, 1],
              transformOrigin: [origin, origin],
            }
          : { opacity: [0, 1] },
        {
          duration: motion.enter.durationMs,
          delay: motion.enter.delayMs,
          easing: motion.enter.easing,
          fill: "backwards",
        },
      );
    }

    let layer: HTMLDivElement | null = null;
    for (const [row, { copy, box, side }] of before.copies) {
      if (now.has(row)) continue;
      layer ??= run.layer(column);
      place(copy, {
        ...box,
        top: box.top + scroll.top,
        left: box.left + scroll.left,
      });
      layer.append(copy);
      const origin = shrinkOrigin({
        side,
        height: box.height,
        viewportHeight: viewHeight,
        mode,
      });
      run.play(
        copy,
        origin
          ? {
              transform: ["scale(1)", `scale(${DELETE_SHRINK_SCALE})`],
              opacity: [1, 0],
              transformOrigin: [origin, origin],
            }
          : { opacity: [1, 0] },
        {
          duration: motion.leave.durationMs,
          easing: motion.leave.easing,
          fill: "forwards",
        },
      );
    }
  });
}
