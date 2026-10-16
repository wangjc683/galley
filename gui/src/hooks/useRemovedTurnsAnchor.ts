import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import {
  captureScrollAnchors,
  holdFirstScrollAnchor,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import { useMessagesStore } from "@/stores/messages";

/**
 * A deleted message (main chat ticket 32) leaves the conversation without
 * moving what the reader looks at: a bubble deleted above the viewport
 * takes its height out above, and the rows on screen stay where they
 * were; one deleted on screen closes up from below. The useEarlierTurns
 * prepend pattern, for a removal: where the reader is is read inside the
 * store write that drops the turns (React has not rendered it yet), and
 * put back before paint. The webview has no CSS scroll anchoring.
 */
export function useRemovedTurnsAnchor({
  sessionId,
  scrollContainerRef,
  removedTurns,
}: {
  /** Active session; its slice in the messages store is the one read. */
  sessionId?: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** The slice's `removedOrdinals.length`: changes in the commit that
   * renders a deletion. */
  removedTurns: number;
}): void {
  const pending = useRef<ScrollAnchor[] | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    return useMessagesStore.subscribe((state, prev) => {
      const now = state.byId[sessionId]?.removedOrdinals.length ?? 0;
      const before = prev.byId[sessionId]?.removedOrdinals.length ?? 0;
      if (now <= before) return;
      const container = scrollContainerRef.current;
      pending.current = container ? captureScrollAnchors(container) : null;
    });
  }, [sessionId, scrollContainerRef]);

  useLayoutEffect(() => {
    const anchors = pending.current;
    pending.current = null;
    const container = scrollContainerRef.current;
    if (anchors && container) holdFirstScrollAnchor(container, anchors);
  }, [removedTurns, scrollContainerRef]);
}
