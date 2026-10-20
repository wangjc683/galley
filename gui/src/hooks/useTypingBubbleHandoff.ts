import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import { TYPING_DOTS_WIDTH_EM } from "@/lib/assistant-conversation";
import {
  bubbleGrowInsets,
  columnLift,
  handoffFadeIn,
  handoffMotion,
  insetClipPath,
  parseDurationMs,
  readHandoffTiming,
  type Box,
  type TypingBubbleHandoff,
} from "@/lib/typing-bubble-handoff";

/*
 * The main chat's typing bubble handing over to its reply (rulings 103,
 * 107, 110; tickets 51, 55, 58; rules in lib/typing-bubble-handoff.ts:
 * MainView decides when, useStickyScroll's `landingTick` runs the follow
 * on the same clock). The tint opens from the typing bubble's box to the
 * reply's (or the question's) — the same ground, so no leaving copy of a
 * bubble: only the dots, copied where they stood, fade out in the first
 * segment (`--motion-fast`), while the words and what hangs under the
 * bubble fade in from half of it to the end of the growth
 * (`handoffFadeIn`). Under reduced motion the dots fade out and the
 * bubble fades in, nothing opens. A round Core woke it for that lands
 * without the dots on screen (it did not stream, or a tool step had just
 * put them away) grows from a one-line typing bubble at the bubble's own
 * top-left corner.
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
  const inner = column.getBoundingClientRect();
  const inColumn = (rect: DOMRect): Box => ({
    top: rect.top - inner.top,
    left: rect.left - inner.left,
    width: rect.width,
    height: rect.height,
  });
  const start =
    typeof dots.getAnimations === "function"
      ? dots.getAnimations({ subtree: true })[0]?.startTime
      : null;
  return {
    box: inColumn(bubble.getBoundingClientRect()),
    dots,
    dotsBox: inColumn(dots.getBoundingClientRect()),
    loopStart:
      typeof start === "number"
        ? start
        : previous?.dots === dots
          ? previous.loopStart
          : null,
  };
}

/** The bubble that took the typing bubble's place: the answer's (by its
 * row's message id), or the live question's. */
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
 * What comes in with the bubble and must not show ahead of it: what
 * hangs under it in its row (the subtask, to-do and reminder cards; the
 * question's candidates; the action row, whose own opacity is its hover
 * reveal, so its contents fade instead), and a report round's time line
 * right above its row, which appears with its first reply.
 */
function followersOf(bubble: HTMLElement, column: Element): Element[] {
  const followers: Element[] = [];
  for (
    let sibling = bubble.nextElementSibling;
    sibling;
    sibling = sibling.nextElementSibling
  ) {
    if (Number.parseFloat(getComputedStyle(sibling).opacity) < 1) {
      followers.push(...Array.from(sibling.children));
    } else {
      followers.push(sibling);
    }
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
  const targetBox: Box = {
    top: target.top - inner.top,
    left: target.left - inner.left,
    width: target.width,
    height: target.height,
  };
  // Where the tint opens from: the typing bubble as it stood, else one
  // at the bubble's own top-left corner (the size it had last time, or
  // the one it would have).
  const size = lastRecord?.box ?? typingSizeFor(bubble);
  const start: Box = record
    ? record.box
    : {
        top: targetBox.top,
        left: targetBox.left,
        width: size.width,
        height: size.height,
      };

  const animations: Animation[] = [];
  const comeIn = handoffFadeIn(timing);
  const fadeIn = (element: Element) => {
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

  // The leaving dots: a copy of the row, on its old place in the column,
  // outside the layout — in a zero-size layer at the scroll content's
  // origin, so it scrolls with the content, takes no part in the
  // column's flow and has no box of its own (the follow's 「reply start」
  // skips boxes without height).
  let layer: HTMLDivElement | null = null;
  let leaving: HTMLElement | null = null;
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
    const now = document.timeline?.currentTime;
    if (record.loopStart !== null && typeof now === "number") {
      const ran = now - record.loopStart;
      for (const dot of Array.from(leaving.children)) {
        if (!(dot instanceof HTMLElement)) continue;
        const delay =
          parseDurationMs(getComputedStyle(dot).animationDelay) ?? 0;
        dot.style.animationDelay = `${delay - ran}ms`;
      }
    }
    const leavingFade = leaving.animate(
      { opacity: [1, 0] },
      { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
    );
    animations.push(leavingFade);
    // Gone once faded.
    const remove = () => layer?.remove();
    void leavingFade.finished.then(remove, remove);
  }

  const previousOverflow = column.style.overflow;
  if (motion === "grow") {
    animations.push(
      bubble.animate(
        {
          clipPath: [
            insetClipPath(bubbleGrowInsets(start, targetBox), radius),
            insetClipPath(undefined, radius),
          ],
        },
        { duration: timing.growMs, easing: timing.easing },
      ),
    );
    for (const words of Array.from(bubble.children)) fadeIn(words);
    if (lift !== 0) {
      // The column moved up at once (a conversation shorter than the
      // viewport): held where it was and let up on the growth's curve.
      // Its own box is not moved, so the scroller's height and the
      // follow's numbers stay; what it carries is, clipped at its edge
      // so it adds no overflow (no scrollbar for a frame).
      column.style.overflow = "clip";
      const lifted = { transform: [`translateY(${lift}px)`, "none"] };
      const options = { duration: timing.growMs, easing: timing.easing };
      for (const child of Array.from(column.children)) {
        animations.push(child.animate(lifted, options));
      }
      if (leaving) animations.push(leaving.animate(lifted, options));
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
    if (lift !== 0) column.style.overflow = previousOverflow;
  };
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
    return playTypingHandoff(container, state.previous, state.record, handoff);
  }, [enabled, handoff, scrollContainerRef]);

  return rowRef;
}
