import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { settleBubbleMotion } from "@/lib/bubble-motion";
import {
  captureScrollAnchor,
  holdScrollAnchor,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import { useMessagesStore } from "@/stores/messages";

/** Read the page before the loaded turns once the reader is within
 * this many viewport heights of the top. */
const EARLIER_TRIGGER_VIEWPORTS = 1;
/** How long after a prepend the reader's row is held still while the
 * new page's late layout (Shiki, images) settles above it. */
const PREPEND_SETTLE_MS = 1500;

/** Where the reader was when a page was prepended. */
interface PrependSnapshot {
  /** The row at the top of the viewport, when the conversation had one. */
  anchor: ScrollAnchor | null;
  /** Fallback when it has none: everything that grew, grew above. */
  scrollHeight: number;
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
}): void {
  // Near the top: read the page before. A position counts only after
  // the reader scrolled — right after a commit the session-switch snap
  // to the bottom may not have landed yet. A page shorter than the
  // trigger distance counts without scrolling: there may be nothing to
  // scroll.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || sessionId === undefined) return;
    let disposed = false;
    const check = (scrolled: boolean) => {
      if (disposed) return;
      const slice = useMessagesStore.getState().byId[sessionId];
      if (!slice?.earlier || slice.restoring) return;
      const trigger = container.clientHeight * EARLIER_TRIGGER_VIEWPORTS;
      const short = container.scrollHeight - container.clientHeight < trigger;
      if (!short && !(scrolled && container.scrollTop < trigger)) return;
      void useMessagesStore
        .getState()
        .loadEarlierTurns(sessionId)
        .then((applied) => {
          // Still near the top after it landed (a short page): go on.
          if (applied) requestAnimationFrame(() => check(true));
        });
    };
    const onScroll = () => check(true);
    container.addEventListener("scroll", onScroll, { passive: true });
    const rafId = requestAnimationFrame(() => check(false));
    return () => {
      disposed = true;
      container.removeEventListener("scroll", onScroll);
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
  // row back where it was. Then hold it there while the page settles —
  // late layout above it (code highlighting, images decoding) would
  // otherwise push the view down — following the reader's own
  // scrolling (each settle re-reads the row at the top).
  useLayoutEffect(() => {
    const snapshot = pendingSnapshot.current;
    pendingSnapshot.current = null;
    const container = scrollContainerRef.current;
    if (!snapshot || !container) return;
    if (!snapshot.anchor || !holdScrollAnchor(container, snapshot.anchor)) {
      container.scrollTop += container.scrollHeight - snapshot.scrollHeight;
    }
    let held = captureScrollAnchor(container);
    const settle = () => {
      if (held) holdScrollAnchor(container, held);
      held = captureScrollAnchor(container) ?? held;
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
    };
    timer = window.setTimeout(release, PREPEND_SETTLE_MS);
    return release;
  }, [prependedTurns, scrollContainerRef]);
}
