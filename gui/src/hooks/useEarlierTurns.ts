import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

import { scrollDestination } from "@/lib/animate-scroll";
import { bubbleMotionRunning, settleBubbleMotion } from "@/lib/bubble-motion";
import { columnOf, typingRowOf } from "@/lib/bubble-motion-play";
import {
  captureScrollAnchor,
  holdScrollAnchor,
  scrollAnchorDrift,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import {
  RUNWAY_ATTR,
  RUNWAY_MIN_PX,
  hasRunway,
  keepInPlace,
  layRunway,
  resizeRunway,
  runwayHeight,
} from "@/lib/scroll-runway";
import { useMessagesStore } from "@/stores/messages";

/** Read the page before the loaded turns once the top of the viewport
 * is within this many viewport heights of the loaded turns' top (main
 * chat ruling 172: a page reads in tens of ms and renders in a few
 * hundred in dev, while a flick back covers ten to thirty thousand px a
 * second). */
export const EARLIER_TRIGGER_VIEWPORTS = 10;
/** How long after a prepend the reader's row is held still while the
 * new page's late layout (Shiki, images) settles above it. */
const PREPEND_SETTLE_MS = 1500;
/** No scroll event for this long: the reader has stopped (a flick's
 * momentum sends scroll events until it ends), and a `scrollTop` written
 * now lands. The runway is refilled and taken away only then. */
export const RUNWAY_IDLE_MS = 200;
/** …and the scroll position held for this many frames since. A page
 * render can hold the main thread past RUNWAY_IDLE_MS while a flick's
 * momentum runs on (no scroll event reaches the page meanwhile); the
 * first frames after it show the position still moving (tauri dev,
 * ticket 123: a refill timed on the events alone was written mid-flick
 * and lost). */
export const RUNWAY_STILL_FRAMES = 3;
/** The most the runway is refilled to (px). */
const RUNWAY_MAX_PX = 200_000;
/** The runway is refilled to the estimate of what is left to read, and
 * this much over it. */
const RUNWAY_ESTIMATE_MARGIN = 1.2;

/** Where the reader was when a page was prepended. */
interface PrependSnapshot {
  /** The row at the top of the viewport, when the conversation had one. */
  anchor: ScrollAnchor | null;
  /** Fallback when it has none: everything that grew, grew above. */
  scrollHeight: number;
}

/**
 * The runway's height to refill to: about as tall as what is left to
 * read — the turns before the loaded ones, at the loaded turns' height
 * per turn index, RUNWAY_ESTIMATE_MARGIN over — so one long run of
 * flicks back, with no stop to refill in, does not use it up (tauri dev,
 * ticket 123: from the bottom, 5,557px went with the first page and the
 * next was scrolled for, mid-flick, and lost); and so the scrollbar
 * roughly tells the length of the whole conversation. Never under
 * twice the tallest page this mount has seen land or RUNWAY_MIN_PX,
 * never over RUNWAY_MAX_PX. What is left over above the first turn
 * goes when that turn is in (the stop or the flick into it).
 */
function runwayTarget(
  container: HTMLElement,
  sessionId: string,
  tallestPage: number,
): number {
  let estimate = 0;
  const slice = useMessagesStore.getState().byId[sessionId];
  const earlier = slice?.earlier;
  if (slice && earlier) {
    let last: number | undefined;
    for (let i = slice.turns.length - 1; i >= 0 && last === undefined; i--) {
      last = (slice.turns[i] as { turnIndex?: number }).turnIndex;
    }
    if (last !== undefined && last >= earlier.beforeTurnIndex) {
      const loaded = container.scrollHeight - runwayHeight(container);
      const perIndex = loaded / (last - earlier.beforeTurnIndex + 1);
      // Turn indices start at -1 (the main chat's greeting).
      estimate =
        perIndex * (earlier.beforeTurnIndex + 1) * RUNWAY_ESTIMATE_MARGIN;
    }
  }
  return Math.round(
    Math.min(RUNWAY_MAX_PX, Math.max(RUNWAY_MIN_PX, 2 * tallestPage, estimate)),
  );
}

/** Something else is moving the page and holds positions a runway
 * resize would move under it: a smooth scroll (lib/animate-scroll.ts
 * targets a `scrollTop`, and a write makes it let go), a bubble motion
 * of ruling 138 (its copies stand where rows were), or the main chat's
 * typing bubble, whose place in the column the hand-off and the bubble
 * motions remember from one commit to the next. */
function pageBusy(container: HTMLElement): boolean {
  if (scrollDestination(container) !== null) return true;
  if (bubbleMotionRunning(container)) return true;
  const column = columnOf(container);
  return column !== null && typingRowOf(column) !== null;
}

/**
 * A runway resize while the reader is idle (lib/scroll-runway.ts
 * `resizeRunway`), then: the row a settle holds is read again where it
 * now is — it did not move on screen, but the scroll position did, which
 * the hold would take for layout above it — and the scroll listeners
 * hear of the new position at once rather than on the next frame.
 */
function resizeAtRest(
  container: HTMLElement,
  height: number,
  held: { current: ScrollAnchor | null },
): void {
  if (resizeRunway(container, height) === 0) return;
  if (held.current)
    held.current = captureScrollAnchor(container) ?? held.current;
  container.dispatchEvent(new Event("scroll"));
}

/**
 * Paged conversation history (main-chat ticket 12), the scrolling half
 * — the messages store reads the pages. Near the top, read the page
 * before the loaded turns; when it lands above the reader, keep what
 * they are looking at where it was. Nothing on screen says a page is
 * loading: a local page read takes milliseconds, and the SQLite path
 * shows no loading state (2026-07-15 ruling). Owns no scroll position
 * otherwise — the session-switch snap, follow-the-bottom and ⌘K locate
 * stay in useStickyScroll.
 *
 * While earlier pages remain, a runway stands above the loaded turns
 * (main chat ruling 172, ticket 123; lib/scroll-runway.ts): a page that
 * lands is taken out of it instead of scrolled for, since WebKit drops a
 * `scrollTop` written during a flick's momentum. The runway is laid in
 * the render that first shows earlier pages, resized to about what is
 * left to read whenever the reader stops, and taken away once they stop after
 * the conversation's first turn has gone in. Returns the ref for the
 * conversation column, which carries it.
 */
export function useEarlierTurns({
  sessionId,
  scrollContainerRef,
  turnsLength,
  prependedTurns,
}: {
  /** Active session; its slice in the messages store is the one paged. */
  sessionId?: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** turns.length — each change is a layout to check the top against. */
  turnsLength: number;
  /** The slice's `prependedTurns`: changes in the commit that renders
   * an earlier page. */
  prependedTurns: number;
}): (column: HTMLDivElement | null) => void {
  const hasEarlier = useMessagesStore(
    (s) => sessionId !== undefined && s.byId[sessionId]?.earlier != null,
  );
  /** The tallest page this mount has seen land (px): what the runway
   * gave up for it, or what was scrolled for once it ran out. */
  const tallestPageRef = useRef(0);
  /** The row the settle after a prepend holds, while it holds one. */
  const heldRef = useRef<ScrollAnchor | null>(null);
  /** Wakes the idle check below, unless it is already waiting. */
  const wakeRef = useRef<(() => void) | null>(null);

  // The runway is there in the commit that first shows the session with
  // earlier pages, before anything places the scroll position: the ref
  // is attached before any layout effect of the page runs (the bottom
  // snap and its measures, useStickyScroll).
  const columnRef = useCallback(
    (column: HTMLDivElement | null) => {
      if (!column || sessionId === undefined) return;
      if (column.hasAttribute(RUNWAY_ATTR)) return;
      if (!useMessagesStore.getState().byId[sessionId]?.earlier) return;
      layRunway(column, RUNWAY_MIN_PX);
    },
    [sessionId],
  );

  // Earlier pages coming after the mount (a cold start draws the
  // skeleton first; the restore lands later): laid then, the scroll
  // position moving with it, before paint. The last page gone in: the
  // runway goes once the reader stops.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!hasEarlier) {
      if (hasRunway(container)) wakeRef.current?.();
      return;
    }
    const column = columnOf(container);
    if (!column || hasRunway(container)) return;
    layRunway(column, 0);
    if (sessionId === undefined) return;
    resizeAtRest(
      container,
      runwayTarget(container, sessionId, tallestPageRef.current),
      heldRef,
    );
  }, [hasEarlier, scrollContainerRef, sessionId]);

  // Stopped (no scroll event for RUNWAY_IDLE_MS): resize the runway to
  // its target (runwayTarget; at the bottom too — scrollTop moves with
  // it, the distance from the bottom does not), or take it away once no
  // earlier page is left.
  // `scrollTop` moves with it, written while nothing scrolls, and lands.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || sessionId === undefined) return;
    const sid = sessionId;
    let timer: number | null = null;
    let stillFrame: number | null = null;
    const arm = () => {
      if (stillFrame !== null) {
        cancelAnimationFrame(stillFrame);
        stillFrame = null;
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(rest, RUNWAY_IDLE_MS);
    };
    const rest = () => {
      timer = null;
      if (!hasRunway(container)) return;
      const earlier = useMessagesStore.getState().byId[sid]?.earlier;
      let height: number;
      if (!earlier) {
        height = 0;
      } else {
        height = runwayTarget(container, sid, tallestPageRef.current);
        // Within a screen of it: not worth a write. At the bottom too:
        // the first run of flicks back starts there (tauri dev: left
        // short there, it ran out a page in).
        if (Math.abs(runwayHeight(container) - height) < container.clientHeight)
          return;
      }
      if (pageBusy(container)) {
        arm();
        return;
      }
      // Still for RUNWAY_STILL_FRAMES frames, or not at rest after all.
      const from = container.scrollTop;
      let held = 0;
      const look = () => {
        stillFrame = null;
        if (container.scrollTop !== from) {
          arm();
          return;
        }
        if (++held < RUNWAY_STILL_FRAMES) {
          stillFrame = requestAnimationFrame(look);
          return;
        }
        resizeAtRest(container, height, heldRef);
      };
      stillFrame = requestAnimationFrame(look);
    };
    // A flick that runs past the conversation's first turn into the
    // runway left above it (no earlier page is coming to land there)
    // ends on that turn, as at a top, instead of drifting through the
    // blank until the momentum dies and the runway goes (ticket 123,
    // measured: about a second of blank). WebKit keeps the momentum on
    // its scrolling thread and drops a `scrollTop` written meanwhile;
    // taking the scroller's overflow away ends it, and two frames later
    // the runway goes and the write lands (tauri dev probe: 354px of
    // blank for one frame, then on the first turn, still). The overflow
    // comes back a frame after that.
    let stopFrame: number | null = null;
    const stopFlick = () => {
      if (stopFrame !== null) return;
      if (useMessagesStore.getState().byId[sid]?.earlier) return;
      if (!hasRunway(container)) return;
      if (container.scrollTop >= runwayHeight(container)) return;
      if (pageBusy(container)) return;
      container.style.overflowY = "hidden";
      stopFrame = requestAnimationFrame(() => {
        stopFrame = requestAnimationFrame(() => {
          resizeAtRest(container, 0, heldRef);
          stopFrame = requestAnimationFrame(() => {
            stopFrame = null;
            container.style.overflowY = "";
          });
        });
      });
    };
    const onScroll = () => {
      arm();
      stopFlick();
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    wakeRef.current = () => {
      if (timer === null) arm();
    };
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (timer !== null) window.clearTimeout(timer);
      if (stillFrame !== null) cancelAnimationFrame(stillFrame);
      if (stopFrame !== null) {
        cancelAnimationFrame(stopFrame);
        container.style.overflowY = "";
      }
      wakeRef.current = null;
    };
  }, [sessionId, scrollContainerRef]);

  // Within EARLIER_TRIGGER_VIEWPORTS of the loaded turns' top (the
  // runway does not count): read the page before, one at a time, and
  // look again once it is in. Not only on scroll: the mount and every
  // change of the loaded turns look once, on the next frame, so an open
  // conversation reads on before the reader scrolls (the main chat reads
  // one page right away). That frame reads a settled position:
  // useStickyScroll places a mount at the bottom in its layout effect,
  // before paint, and its session-switch snap asked for its frame first;
  // while the restore is out nothing is read, and the restore's commit
  // changes `turnsLength`, which looks again.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || sessionId === undefined) return;
    let disposed = false;
    const check = () => {
      if (disposed) return;
      const slice = useMessagesStore.getState().byId[sessionId];
      if (!slice?.earlier || slice.restoring) return;
      const above = container.scrollTop - runwayHeight(container);
      if (above >= container.clientHeight * EARLIER_TRIGGER_VIEWPORTS) return;
      void useMessagesStore
        .getState()
        .loadEarlierTurns(sessionId)
        .then((applied) => {
          // Still near the top after it landed: go on.
          if (applied) requestAnimationFrame(check);
        });
    };
    container.addEventListener("scroll", check, { passive: true });
    const rafId = requestAnimationFrame(check);
    return () => {
      disposed = true;
      container.removeEventListener("scroll", check);
      cancelAnimationFrame(rafId);
    };
  }, [sessionId, scrollContainerRef, turnsLength]);

  // Where the reader is, read inside the store write that prepends a
  // page: React has not rendered it yet, so the DOM is still the one
  // they are looking at.
  const pendingSnapshot = useRef<PrependSnapshot | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    return useMessagesStore.subscribe((state, prev) => {
      const now = state.byId[sessionId]?.prependedTurns ?? 0;
      const before = prev.byId[sessionId]?.prependedTurns ?? 0;
      if (now <= before) return;
      const container = scrollContainerRef.current;
      // A motion of ruling 138 still moving rows would skew the anchor.
      if (container) settleBubbleMotion(container);
      pendingSnapshot.current = container
        ? {
            anchor: captureScrollAnchor(container),
            scrollHeight: container.scrollHeight,
          }
        : null;
    });
  }, [sessionId, scrollContainerRef]);

  // The commit that renders the page, before paint: put the reader's
  // row back where it was — out of the runway while there is one
  // (lib/scroll-runway.ts `keepInPlace`). Then hold it there while the
  // page settles — late layout above it (code highlighting, images
  // decoding) would otherwise push the view down — following the
  // reader's own scrolling (each settle re-reads the row at the top).
  useLayoutEffect(() => {
    const snapshot = pendingSnapshot.current;
    pendingSnapshot.current = null;
    const container = scrollContainerRef.current;
    if (!snapshot || !container) return;
    const grown =
      (snapshot.anchor
        ? scrollAnchorDrift(container, snapshot.anchor)
        : null) ?? container.scrollHeight - snapshot.scrollHeight;
    keepInPlace(container, grown);
    tallestPageRef.current = Math.max(tallestPageRef.current, grown);
    wakeRef.current?.();
    heldRef.current = captureScrollAnchor(container);
    const settle = () => {
      const held = heldRef.current;
      if (held) holdScrollAnchor(container, held);
      heldRef.current = captureScrollAnchor(container) ?? held;
    };
    const observer = new ResizeObserver(settle);
    const inner = container.firstElementChild;
    if (inner) observer.observe(inner);
    container.addEventListener("scroll", settle, { passive: true });
    let timer = 0;
    const release = () => {
      observer.disconnect();
      container.removeEventListener("scroll", settle);
      window.clearTimeout(timer);
      heldRef.current = null;
    };
    timer = window.setTimeout(release, PREPEND_SETTLE_MS);
    return release;
  }, [prependedTurns, scrollContainerRef]);

  return columnRef;
}
