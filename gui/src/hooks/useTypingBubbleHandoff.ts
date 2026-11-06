import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import { TYPING_DOTS_WIDTH_EM } from "@/lib/assistant-conversation";
import {
  claimTypingDeparture,
  holdBubbleMotion,
  readBubbleMotionTiming,
  releaseBubbleMotion,
  settleBubbleMotion,
  settledTypingOpacity,
  toldLineFade,
  type RunningBubbleMotion,
} from "@/lib/bubble-motion";
import { translateYOf } from "@/lib/bubble-motion-play";
import { bubbleSpringShift } from "@/lib/bubble-spring";
import { landAfter } from "@/lib/bubble-spring-play";
import {
  bubbleGrowInsets,
  columnLift,
  handoffFadeIn,
  handoffMotion,
  insetClipPath,
  readHandoffTiming,
  rowPush,
  type Box,
  type HandoffTiming,
  type TypingBubbleHandoff,
} from "@/lib/typing-bubble-handoff";
import {
  carryLoop,
  carrySweep,
  dropRollingSentence,
  loopStartOf,
  sweepStartOf,
  timelineNow,
} from "@/lib/typing-bubble-phase";

/*
 * The main chat's typing bubble handing over to its reply (rulings 103,
 * 107, 110; tickets 51, 55, 58; rules in lib/typing-bubble-handoff.ts:
 * MainView decides when, useStickyScroll's `landingTick` runs the follow
 * on the same clock). The tint opens from the typing bubble's box to the
 * reply's (or the question's) — the same ground, so no leaving copy of a
 * bubble: only the dots, copied where they stood, fade out in the first
 * segment (`--motion-fast`), and with them the line under the dots in a
 * round you started (rulings 134, 135) — its copy holds only the
 * sentence on screen, its sweep going on where it was (ruling 137) —
 * while the words and what hangs under the bubble fade in from half
 * of it to the end of the growth
 * (`handoffFadeIn`). Under reduced motion the dots and the line fade out
 * and the bubble fades in, nothing opens. A round Core woke it for that lands
 * without the dots on screen (it did not stream, or a tool step had just
 * put them away) grows from a one-line typing bubble at the bubble's own
 * top-left corner.
 *
 * Beside ruling 138's motions (lib/bubble-motion.ts; ticket 94): one
 * still running — the send's slide, the typing bubble fading in — goes
 * to its end before the hand-off measures, the dots leave from what that
 * fade-in had reached, and a hand-off that plays claims the typing
 * bubble's going (hooks/useBubbleMotion.ts fades it only when nothing
 * grew out of it).
 *
 * A line told mid-run (ruling 200, ticket 149: `told`) grows with the
 * same pieces while the round goes on: its tint from a typing bubble's
 * box at its own top-left corner, its words on the same segment
 * (`growTint`); nothing leaves — the typing bubble and the line under it
 * stay, their loops, sweep and time going on, and are pushed down on the
 * growth's curve (`holdColumn`), the follow on the same clock. Under
 * reduced motion the line only fades in (`--motion-base`). It is one of
 * ruling 138's motions while it plays: anything after it that measures
 * or moves the conversation (a send, a delete, a stop, an earlier page,
 * the next line, the reply) puts it to its end first.
 */

interface TypingRecord {
  /** The typing bubble's tinted box in the column (px). */
  box: Box;
  /** Its dots' row: copied into the leaving dots. */
  dots: HTMLElement;
  /** Where the dots stood in the column (px). */
  dotsBox: Box;
  /** When the dots' loop started (document timeline, ms): the leaving
   * copy carries on in step instead of starting the loop over. */
  loopStart: number | null;
  /** The line under the dots (TypingBubble's `progress`), when drawn,
   * and where it stood in the column (px): copied into the leaving
   * line. */
  line: HTMLElement | null;
  lineBox: Box | null;
  /** When the sweep on the line's sentence started (document timeline,
   * ms; globals.css `progress-shimmer`): the copy carries it on, as the
   * dots' loop. Null without one (reduced motion). */
  sweepStart: number | null;
}

/** One commit as the hand-off reads it. */
interface Frame {
  /** The typing bubble was drawn. */
  present: boolean;
  /** The column's top in the scroll content (px). */
  columnTop: number | null;
}

interface HandoffState {
  previous: Frame;
  now: Frame;
  /** The typing bubble as last measured (kept after it goes). */
  record: TypingRecord | null;
  /** …and as it was before this commit measured it: where a line told
   * mid-run pushed it down from. */
  before: TypingRecord | null;
}

const NO_FRAME: Frame = { present: false, columnTop: null };

function columnTopOf(container: HTMLElement): number | null {
  const column = container.firstElementChild;
  if (!(column instanceof HTMLElement)) return null;
  return (
    column.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

function measureTyping(
  row: HTMLElement,
  previous: TypingRecord | null,
): TypingRecord | null {
  const column = row.parentElement;
  const bubble = row.querySelector<HTMLElement>(
    '[data-role="assistant-typing-bubble"]',
  );
  const dots = row.querySelector<HTMLElement>(
    '[data-role="assistant-typing-dots"]',
  );
  if (!column || !bubble || !dots) return null;
  // The line under the dots, in a round you started.
  const line = row.querySelector<HTMLElement>(
    '[data-role="assistant-progress"]',
  );
  const inner = column.getBoundingClientRect();
  // Where it stands in the layout: a send's slide (ruling 138,
  // lib/bubble-motion-play.ts) may be moving the row, and the hand-off
  // plays once that slide is put to its end.
  const shift = translateYOf(row);
  const inColumn = (rect: DOMRect): Box => ({
    top: rect.top - inner.top - shift,
    left: rect.left - inner.left,
    width: rect.width,
    height: rect.height,
  });
  return {
    box: inColumn(bubble.getBoundingClientRect()),
    dots,
    dotsBox: inColumn(dots.getBoundingClientRect()),
    loopStart: loopStartOf(dots, previous),
    line,
    lineBox: line ? inColumn(line.getBoundingClientRect()) : null,
    sweepStart: line ? sweepStartOf(line) : null,
  };
}

/** The bubble that took the typing bubble's place: the answer's (by its
 * row's message id), or the live question's; or the line told mid-run
 * (by its row's message id too). */
function findBubble(
  column: Element,
  handoff: TypingBubbleHandoff,
): HTMLElement | null {
  // The live question sits at the column's end, after the conversation
  // (a subtask card higher up may hold a question of its own).
  const scope =
    handoff.kind === "question"
      ? Array.from(column.children).find((child) =>
          child.matches('[data-role="ask-user-bubble"]'),
        )
      : handoff.messageId
        ? column.querySelector(
            `[data-message-id="${CSS.escape(handoff.messageId)}"]`,
          )
        : null;
  return (
    scope?.querySelector<HTMLElement>('[data-role="assistant-bubble"]') ?? null
  );
}

/**
 * What fades in for `element`: itself, or, when its own opacity is a
 * hover reveal (a reply's action row, hidden until hovered), its
 * contents, so the reveal stays its own.
 */
function fadeParts(element: Element): Element[] {
  return Number.parseFloat(getComputedStyle(element).opacity) < 1
    ? Array.from(element.children)
    : [element];
}

/**
 * What comes in with the bubble and must not show ahead of it: what
 * hangs under it in its row (the subtask, to-do and reminder cards; the
 * question's candidates), and a report round's time line right above
 * its row, which appears with its first reply. The reply's action row
 * is the bubble's own child since ruling 199, and fades with its words.
 */
function followersOf(bubble: HTMLElement, column: Element): Element[] {
  const followers: Element[] = [];
  for (
    let sibling = bubble.nextElementSibling;
    sibling;
    sibling = sibling.nextElementSibling
  ) {
    followers.push(...fadeParts(sibling));
  }
  let row: Element = bubble;
  while (
    row.parentElement &&
    row.parentElement !== column &&
    row.parentElement.getAttribute("data-role") !== "conversation"
  ) {
    row = row.parentElement;
  }
  const above = row.previousElementSibling;
  if (above?.getAttribute("data-role") === "message-time-divider") {
    followers.push(above);
  }
  return followers;
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** A one-line typing bubble's size for `bubble`: its padding around one
 * line of its words (their line height) and the dots' row. */
function typingSizeFor(bubble: HTMLElement): { width: number; height: number } {
  const own = getComputedStyle(bubble);
  const words = bubble.firstElementChild;
  const text = words ? getComputedStyle(words) : own;
  return {
    width:
      px(own.paddingLeft) +
      px(own.paddingRight) +
      px(text.fontSize) * TYPING_DOTS_WIDTH_EM,
    height: px(own.paddingTop) + px(own.paddingBottom) + px(text.lineHeight),
  };
}

// ---- The growth: shared by the hand-off and a line told mid-run ----------

/** A bubble's box in the column (`inner`: the column's rect). */
function boxInColumn(rect: DOMRect, inner: DOMRect): Box {
  return {
    top: rect.top - inner.top,
    left: rect.left - inner.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Where a bubble with no typing bubble in its place grows from: a box of
 * the typing bubble's `size` at its own top-left corner — a woken round's
 * reply whose dots were not up, a line told mid-run (ticket 149). */
function cornerStart(
  target: Box,
  size: { width: number; height: number },
): Box {
  return {
    top: target.top,
    left: target.left,
    width: size.width,
    height: size.height,
  };
}

/** The fade-in of what comes in with the growth: from half the dots'
 * fade to the end of the growth (`handoffFadeIn`), transparent while it
 * waits. */
function comeInFader(
  timing: HandoffTiming,
  animations: Animation[],
): (element: Element) => void {
  const comeIn = handoffFadeIn(timing);
  return (element) => {
    animations.push(
      element.animate(
        { opacity: [0, 1] },
        {
          duration: comeIn.duration,
          delay: comeIn.delay,
          easing: timing.easing,
          fill: "backwards",
        },
      ),
    );
  };
}

/**
 * The bubble's tint opening from `start` to its own box (`target`, both
 * in the column; `radius`, its corners) over the growth, and its words —
 * and the action row beside them (`fadeParts`) — coming in (`fadeIn`).
 * Returns the growth.
 */
function growTint(
  bubble: HTMLElement,
  start: Box,
  target: Box,
  radius: string,
  timing: HandoffTiming,
  fadeIn: (element: Element) => void,
  animations: Animation[],
): Animation {
  const growth = bubble.animate(
    {
      clipPath: [
        insetClipPath(bubbleGrowInsets(start, target), radius),
        insetClipPath(undefined, radius),
      ],
    },
    { duration: timing.growMs, easing: timing.easing },
  );
  animations.push(growth);
  // The words, and the action row beside them (`fadeParts`).
  for (const words of Array.from(bubble.children)) {
    for (const part of fadeParts(words)) fadeIn(part);
  }
  return growth;
}

/** Where `el` stands on screen (viewport px), the scroll spring's offset
 * taken off. */
function screenTop(el: Element): number {
  return el.getBoundingClientRect().top - bubbleSpringShift(el);
}

/**
 * The landing bounce once the bubble has grown (ticket 151;
 * lib/bubble-spring-play.ts `landAfter`): its row goes MAX_KICK_PX past
 * its place along the way it came, then back on the scroll spring.
 * `startTop`: where the bubble stood on screen in the growth's first
 * frame (viewport px, the spring off) — against where it stands at the
 * end, that is how it came: up with the follow or a short conversation
 * let up, or not at all (grown where it stands: down, the way its tint
 * opened).
 */
function landWhenGrown(
  container: HTMLElement,
  bubble: HTMLElement,
  growth: Animation,
  startTop: number,
): void {
  landAfter(container, bubble, growth, () => screenTop(bubble) - startTop);
}

/**
 * What moved at once in this commit, held where it looked to be and let
 * go to its place on the growth's duration and curve: each of `moves`
 * from `translateY(by)` to none. Their own boxes are not moved, so the
 * scroller's height and the follow's numbers stay. While the column's
 * content is held down (`clip`: a conversation shorter than the
 * viewport, moved up at once) it is clipped at the column's edge so it
 * adds no overflow (no scrollbar for a frame), and not shrunk by it: in
 * the main chat's flex scroller WebKit drops a clipped flex item's
 * minimum height to 0 (lib/bubble-motion-play.ts `clip`). Returns what
 * puts the column's style back.
 */
function holdColumn(
  column: HTMLElement,
  moves: readonly (readonly [Element, number])[],
  clip: boolean,
  timing: HandoffTiming,
  animations: Animation[],
): () => void {
  const previousOverflow = column.style.overflow;
  const previousShrink = column.style.flexShrink;
  if (clip) {
    column.style.overflow = "clip";
    column.style.flexShrink = "0";
  }
  const options = { duration: timing.growMs, easing: timing.easing };
  for (const [element, by] of moves) {
    animations.push(
      element.animate({ transform: [`translateY(${by}px)`, "none"] }, options),
    );
  }
  return () => {
    if (!clip) return;
    column.style.overflow = previousOverflow;
    column.style.flexShrink = previousShrink;
  };
}

function playTypingHandoff(
  container: HTMLElement,
  previous: Frame,
  lastRecord: TypingRecord | null,
  handoff: TypingBubbleHandoff,
): () => void {
  const noop = () => {};
  const column = container.firstElementChild;
  if (!(column instanceof HTMLElement)) return noop;
  const record = previous.present ? lastRecord : null;
  // Still on the page: nothing took its place.
  if (record?.dots.isConnected) return noop;
  const bubble = findBubble(column, handoff);
  const timing = readHandoffTiming();
  if (!bubble || !timing || typeof bubble.animate !== "function") return noop;
  const motion = handoffMotion(prefersReducedMotion());
  // A send's slide or the typing bubble's fade-in still running (ruling
  // 138) goes to its end before anything is measured; the dots leave
  // from what that fade-in had reached, not from opaque.
  settleBubbleMotion(container);
  const from = settledTypingOpacity(container) ?? 1;
  claimTypingDeparture(container);

  // Everything measured before anything moves.
  const outer = container.getBoundingClientRect();
  const inner = column.getBoundingClientRect();
  const target = bubble.getBoundingClientRect();
  const columnTop = inner.top - outer.top + container.scrollTop;
  const columnLeft = inner.left - outer.left + container.scrollLeft;
  const lift =
    motion === "grow" && previous.columnTop !== null
      ? columnLift(previous.columnTop, columnTop)
      : 0;
  const followers = followersOf(bubble, column);
  const radius = getComputedStyle(bubble).borderTopLeftRadius || "0px";
  const targetBox = boxInColumn(target, inner);
  // Where the tint opens from: the typing bubble as it stood, else one
  // at the bubble's own top-left corner (the size it had last time, or
  // the one it would have).
  const size = lastRecord?.box ?? typingSizeFor(bubble);
  const start: Box = record ? record.box : cornerStart(targetBox, size);

  const animations: Animation[] = [];
  const fadeIn = comeInFader(timing, animations);

  // The leaving dots: a copy of the row, on its old place in the column,
  // outside the layout — in a zero-size layer at the scroll content's
  // origin, so it scrolls with the content, takes no part in the
  // column's flow and has no box of its own (the follow's 「reply start」
  // skips boxes without height).
  let layer: HTMLDivElement | null = null;
  let leaving: HTMLElement | null = null;
  let leavingLine: HTMLElement | null = null;
  if (record) {
    layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none";
    leaving = record.dots.cloneNode(true) as HTMLElement;
    leaving.setAttribute("data-role", "assistant-typing-dots-leaving");
    leaving.style.position = "absolute";
    leaving.style.margin = "0";
    leaving.style.top = `${columnTop + record.dotsBox.top}px`;
    leaving.style.left = `${columnLeft + record.dotsBox.left}px`;
    leaving.style.width = `${record.dotsBox.width}px`;
    leaving.style.height = `${record.dotsBox.height}px`;
    layer.append(leaving);
    container.append(layer);
    // Carry the loop on where it was: each dot's stagger delay less the
    // time the loop has run.
    const now = timelineNow();
    carryLoop(leaving, record.loopStart, now);
    const leavingFade = leaving.animate(
      { opacity: [from, 0] },
      { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
    );
    animations.push(leavingFade);
    // The line under the dots leaves as they do — a copy where it stood,
    // out of the layout, faded on the same duration and curve (gone with
    // the layer).
    if (record.line && record.lineBox) {
      leavingLine = record.line.cloneNode(true) as HTMLElement;
      leavingLine.setAttribute("data-role", "assistant-progress-leaving");
      // Only the sentence on screen (ruling 137): one still rolling out
      // is dropped, and the doing part lays out as that sentence alone —
      // the line itself is as wide as the row lets it be, whatever it
      // says, so the width below stands. The copy's sentence sits at its
      // place (the roll is not copied).
      dropRollingSentence(leavingLine);
      leavingLine.style.position = "absolute";
      leavingLine.style.margin = "0";
      leavingLine.style.top = `${columnTop + record.lineBox.top}px`;
      leavingLine.style.left = `${columnLeft + record.lineBox.left}px`;
      leavingLine.style.width = `${record.lineBox.width}px`;
      leavingLine.style.height = `${record.lineBox.height}px`;
      // Its cap is a share of the column; in the zero-size layer that
      // would be nothing.
      leavingLine.style.maxWidth = "none";
      layer.append(leavingLine);
      // Its sweep carries on where it was, as the dots' loop does.
      carrySweep(leavingLine, record.sweepStart, now);
      animations.push(
        leavingLine.animate(
          { opacity: [from, 0] },
          { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
        ),
      );
    }
    // Gone once faded.
    const remove = () => layer?.remove();
    void leavingFade.finished.then(remove, remove);
  }

  let undoHold = () => {};
  if (motion === "grow") {
    const growth = growTint(
      bubble,
      start,
      targetBox,
      radius,
      timing,
      fadeIn,
      animations,
    );
    // In the first frame its row stands where it is now, held down by
    // the lift (below).
    landWhenGrown(
      container,
      bubble,
      growth,
      target.top - bubbleSpringShift(bubble) + lift,
    );
    if (lift !== 0) {
      // The column moved up at once (a conversation shorter than the
      // viewport): held where it was and let up on the growth's curve,
      // the leaving copies with it.
      const lifted: Element[] = Array.from(column.children);
      if (leaving) lifted.push(leaving);
      if (leavingLine) lifted.push(leavingLine);
      undoHold = holdColumn(
        column,
        lifted.map((element) => [element, lift] as const),
        true,
        timing,
        animations,
      );
    }
  } else {
    fadeIn(bubble);
  }
  for (const follower of followers) fadeIn(follower);

  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    layer?.remove();
    undoHold();
  };
  void Promise.all(animations.map((animation) => animation.finished)).then(
    stop,
    stop,
  );
  return stop;
}

/**
 * A line told mid-run growing in above the typing bubble (ruling 200,
 * ticket 149): its tint from a typing bubble's box at its own top-left
 * corner, its words on the hand-off's segment — the growth of a woken
 * round's reply whose dots were not up. The typing bubble is not copied
 * and does not fade: it stays, and what the line pushed down (the rows
 * after the conversation: the typing bubble and the line under it) is
 * held where it was and let down on the growth's curve, while the
 * follow (useStickyScroll's `landingTick`) or, in a conversation shorter
 * than the viewport, the column's lift moves the rest up on the same
 * clock. Following, the dots stay where they were and the line grows up
 * out of them; scrolled up, nothing scrolls and the dots slide down as
 * it grows. Under reduced motion the line only fades in, whole, and
 * nothing moves. `before` and `after`: the typing bubble as the commit
 * before and this one measured it.
 */
function playToldLine(
  container: HTMLElement,
  previous: Frame,
  now: Frame,
  before: TypingRecord | null,
  after: TypingRecord | null,
  handoff: TypingBubbleHandoff,
): () => void {
  const noop = () => {};
  const column = container.firstElementChild;
  if (!(column instanceof HTMLElement)) return noop;
  const bubble = findBubble(column, handoff);
  const timing = readHandoffTiming();
  const motionTiming = readBubbleMotionTiming();
  if (!bubble || !timing || !motionTiming) return noop;
  if (typeof bubble.animate !== "function") return noop;
  const motion = handoffMotion(prefersReducedMotion());
  // Anything of ruling 138's still moving (a send's slide, the typing
  // bubble's fade-in) goes to its end before anything is measured.
  settleBubbleMotion(container);

  // Everything measured before anything moves.
  const outer = container.getBoundingClientRect();
  const inner = column.getBoundingClientRect();
  const columnTop = inner.top - outer.top + container.scrollTop;
  const followers = followersOf(bubble, column);
  const animations: Animation[] = [];
  let undoHold = () => {};
  if (motion === "grow") {
    const target = bubble.getBoundingClientRect();
    const targetBox = boxInColumn(target, inner);
    const radius = getComputedStyle(bubble).borderTopLeftRadius || "0px";
    const size = after?.box ?? before?.box ?? typingSizeFor(bubble);
    const lift =
      previous.columnTop !== null
        ? columnLift(previous.columnTop, columnTop)
        : 0;
    const push =
      previous.present && now.present && before && after
        ? rowPush(before.box.top, after.box.top)
        : 0;
    const fadeIn = comeInFader(timing, animations);
    const growth = growTint(
      bubble,
      cornerStart(targetBox, size),
      targetBox,
      radius,
      timing,
      fadeIn,
      animations,
    );
    // In the first frame it stands where it is now, held down by the
    // lift (below).
    landWhenGrown(
      container,
      bubble,
      growth,
      target.top - bubbleSpringShift(bubble) + lift,
    );
    // The conversation lifted with the column; what comes after it (the
    // typing bubble's row) held up by the push as well. In the column's
    // one flow, so the two cancel when the column moved up by just the
    // line (贴底, a short conversation): the dots do not move at all.
    const moves: (readonly [Element, number])[] = [];
    let pushed = false;
    for (const child of Array.from(column.children)) {
      const by = pushed ? lift - push : lift;
      if (Math.abs(by) >= 0.5) moves.push([child, by]);
      if (child.getAttribute("data-role") === "conversation") pushed = true;
    }
    undoHold = holdColumn(column, moves, lift !== 0, timing, animations);
    for (const follower of followers) fadeIn(follower);
  } else {
    const fade = toldLineFade(motionTiming);
    for (const element of [bubble, ...followers]) {
      animations.push(
        element.animate(
          { opacity: [0, 1] },
          {
            duration: fade.durationMs,
            delay: fade.delayMs,
            easing: fade.easing,
            fill: "backwards",
          },
        ),
      );
    }
  }

  // One of ruling 138's motions while it plays: a send, a delete, a
  // stop, an earlier page or the next landing puts it to its end first.
  let done = false;
  const running: RunningBubbleMotion = {
    finish: () => stop(),
    typingOpacity: () => null,
  };
  const stop = () => {
    if (done) return;
    done = true;
    releaseBubbleMotion(container, running);
    for (const animation of animations) animation.cancel();
    undoHold();
  };
  holdBubbleMotion(container, running);
  void Promise.all(animations.map((animation) => animation.finished)).then(
    stop,
    stop,
  );
  return stop;
}

/**
 * The hand-off on the page (`enabled`: the main chat): returns the ref
 * for the typing bubble's row (TypingBubble), keeps where it stood and
 * whether the commit before had it, and plays each new `handoff` once.
 * Off, it measures nothing; on, only while the round is `live`.
 */
export function useTypingBubbleHandoff({
  enabled,
  live,
  scrollContainerRef,
  handoff,
}: {
  enabled: boolean;
  /** The round is live at the conversation's end (MainView's
   * `TypingBubbleFrame.live`). A hand-off plays only in the commit right
   * after one where it was (lib/typing-bubble-handoff.ts), so only such a
   * commit is measured: a mount on a settled conversation — every switch
   * back to the main chat while it is idle — reads no layout (ticket 72). */
  live: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  handoff: TypingBubbleHandoff | null;
}): RefObject<HTMLDivElement | null> {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<HandoffState>({
    previous: NO_FRAME,
    now: NO_FRAME,
    record: null,
    before: null,
  });
  // For the observer below, as the last commit had it.
  const liveRef = useRef(live);

  // Every commit: the one before becomes `previous` (the hand-off's
  // commit reads it below — declared first, so it runs first), and this
  // one is measured while the round is live. A commit without the bubble
  // keeps its last record.
  useLayoutEffect(() => {
    if (!enabled) return;
    const state = stateRef.current;
    const container = scrollContainerRef.current;
    const row = rowRef.current;
    liveRef.current = live;
    state.previous = state.now;
    state.before = state.record;
    if (!live) {
      // No hand-off can follow this commit: nothing to measure.
      state.now = { present: row !== null, columnTop: null };
      return;
    }
    state.now = {
      present: row !== null,
      columnTop: container ? columnTopOf(container) : null,
    };
    if (row) state.record = measureTyping(row, state.record) ?? state.record;
  });

  // …and when the column or the viewport changes size between commits.
  useEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (!liveRef.current) return;
      const state = stateRef.current;
      state.now = { ...state.now, columnTop: columnTopOf(container) };
      const row = rowRef.current;
      if (row) state.record = measureTyping(row, state.record) ?? state.record;
    });
    observer.observe(container);
    if (container.firstElementChild) {
      observer.observe(container.firstElementChild);
    }
    return () => observer.disconnect();
  }, [enabled, scrollContainerRef]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!enabled || !handoff || !container) return;
    const state = stateRef.current;
    if (handoff.kind === "told") {
      return playToldLine(
        container,
        state.previous,
        state.now,
        state.before,
        state.record,
        handoff,
      );
    }
    return playTypingHandoff(container, state.previous, state.record, handoff);
  }, [enabled, handoff, scrollContainerRef]);

  return rowRef;
}
