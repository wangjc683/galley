import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import {
  bubbleGrowInsets,
  columnLift,
  handoffFadeIn,
  handoffMotion,
  insetClipPath,
  lineTextWidth,
  readHandoffTiming,
  type Box,
  type LiveLineHandoff,
} from "@/lib/live-line-handoff";

/**
 * Where the live line last stood, kept while it is on screen: the line
 * is gone from the DOM by the time its bubble lands, so its place is
 * read before (after every commit with the line drawn, and whenever the
 * column or the viewport changes size without one).
 */
interface LineRecord {
  /** The line's element: copied into the leaving line. */
  node: HTMLElement;
  /** The column's top in the scroll content (px from its top edge). */
  columnTop: number;
  /** The line's own box in the column (px). */
  box: Box;
}

function measureLine(
  container: HTMLElement,
  line: HTMLElement,
): LineRecord | null {
  const column = line.parentElement;
  if (!column) return null;
  const outer = container.getBoundingClientRect();
  const inner = column.getBoundingClientRect();
  const rect = line.getBoundingClientRect();
  return {
    node: line,
    columnTop: inner.top - outer.top + container.scrollTop,
    box: {
      top: rect.top - inner.top,
      left: rect.left - inner.left,
      width: rect.width,
      height: rect.height,
    },
  };
}

/** The bubble that took the line's place: the answer's (by its row's
 * message id), or the live question's. */
function findBubble(
  column: Element,
  handoff: LiveLineHandoff,
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

/**
 * Plays one hand-off (lib/live-line-handoff.ts for the rules). Returns
 * what stops it at once: everything it put on the page goes.
 */
function playHandoff(
  container: HTMLElement,
  record: LineRecord,
  handoff: LiveLineHandoff,
): () => void {
  const noop = () => {};
  const column = container.firstElementChild;
  if (!(column instanceof HTMLElement)) return noop;
  // Still on the page: nothing took its place.
  if (record.node.isConnected) return noop;
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
  const lift = motion === "grow" ? columnLift(record.columnTop, columnTop) : 0;
  const followers = followersOf(bubble, column);
  const radius = getComputedStyle(bubble).borderTopLeftRadius || "0px";

  // The leaving line: a copy of its last frame (sentence and clock), on
  // its old place in the column, outside the layout. In a zero-size
  // layer at the scroll content's origin, so it scrolls with the
  // content, takes no part in the column's flow and has no box of its
  // own (the follow's 「reply start」 skips boxes without height).
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none";
  const leaving = record.node.cloneNode(true) as HTMLElement;
  leaving.setAttribute("data-role", "assistant-live-line-leaving");
  leaving.style.position = "absolute";
  leaving.style.margin = "0";
  leaving.style.top = `${columnTop + record.box.top}px`;
  leaving.style.left = `${columnLeft + record.box.left}px`;
  leaving.style.width = `${record.box.width}px`;
  layer.append(leaving);
  container.append(layer);

  // Its words' box: the line is a full-width row.
  const leavingRect = leaving.getBoundingClientRect();
  const textWidth = lineTextWidth(
    leavingRect.left,
    Array.from(
      leaving.children,
      (piece) => piece.getBoundingClientRect().right,
    ),
    record.box.width,
  );

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
  const leavingFade = leaving.animate(
    { opacity: [1, 0] },
    { duration: timing.fadeMs, easing: timing.easing, fill: "forwards" },
  );
  animations.push(leavingFade);

  const previousOverflow = column.style.overflow;
  if (motion === "grow") {
    const insets = bubbleGrowInsets(
      {
        top: record.box.top,
        left: record.box.left,
        width: textWidth,
        height: record.box.height,
      },
      {
        top: target.top - inner.top,
        left: target.left - inner.left,
        width: target.width,
        height: target.height,
      },
    );
    animations.push(
      bubble.animate(
        {
          clipPath: [
            insetClipPath(insets, radius),
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
      animations.push(leaving.animate(lifted, options));
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
    layer.remove();
    if (lift !== 0) column.style.overflow = previousOverflow;
  };
  void leavingFade.finished.then(
    () => layer.remove(),
    () => layer.remove(),
  );
  void Promise.all(animations.map((animation) => animation.finished)).then(
    stop,
    stop,
  );
  return stop;
}

/**
 * The live line's hand-off on the page (main chat only, `enabled`):
 * returns the ref for the line (AssistantLiveLine), keeps where it stood,
 * and plays each new `handoff` once. The follow scroll for the same
 * landing is useStickyScroll's (`landingTick`).
 */
export function useLiveLineHandoff({
  enabled,
  scrollContainerRef,
  handoff,
}: {
  enabled: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  handoff: LiveLineHandoff | null;
}): RefObject<HTMLDivElement | null> {
  const lineRef = useRef<HTMLDivElement | null>(null);
  const recordRef = useRef<LineRecord | null>(null);

  // After every commit the line is in: its place now. A commit without
  // it keeps the last one (the hand-off reads it).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const line = lineRef.current;
    if (!container || !line) return;
    recordRef.current = measureLine(container, line) ?? recordRef.current;
  });

  // …and when what is above it lays out again without a commit (late
  // layout, the window's width) or the viewport changes height (the
  // short conversation's `mt-auto`).
  useEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const line = lineRef.current;
      if (!line) return;
      recordRef.current = measureLine(container, line) ?? recordRef.current;
    });
    observer.observe(container);
    if (container.firstElementChild) {
      observer.observe(container.firstElementChild);
    }
    return () => observer.disconnect();
  }, [enabled, scrollContainerRef]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const record = recordRef.current;
    if (!enabled || !handoff || !container || !record) return;
    return playHandoff(container, record, handoff);
  }, [enabled, handoff, scrollContainerRef]);

  return lineRef;
}
