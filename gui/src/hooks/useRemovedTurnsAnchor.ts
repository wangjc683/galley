import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import {
  captureScrollAnchors,
  holdFirstScrollAnchor,
  type ScrollAnchor,
} from "@/lib/scroll-anchor";
import {
  useMessageDeleteStore,
  type StagedMessageDelete,
} from "@/stores/message-delete";
import { useMessagesStore } from "@/stores/messages";

/** The rows of `sessionId` a deletion on its way hides, as one key. */
function hiddenKey(
  staged: readonly StagedMessageDelete[],
  sessionId: string,
): string {
  return staged
    .filter((entry) => entry.sessionId === sessionId)
    .map((entry) => entry.id)
    .join(",");
}

/**
 * A deleted message (main chat ticket 32) leaves the conversation without
 * moving what the reader looks at: a bubble deleted above the viewport
 * takes its height out above, and the rows on screen stay where they
 * were; one deleted on screen closes up from below. The same when it
 * leaves on 删除 and comes back on 撤销 or a refusal (ticket 38: hidden
 * while its undo toast is up, stores/message-delete.ts). The
 * useEarlierTurns prepend pattern, for a removal: where the reader is is
 * read inside the store write that drops or hides the turns (React has
 * not rendered it yet), and put back before paint. The webview has no
 * CSS scroll anchoring.
 */
export function useRemovedTurnsAnchor({
  sessionId,
  scrollContainerRef,
}: {
  /** Active session; its slice in the messages store is the one read. */
  sessionId?: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}): void {
  const pending = useRef<ScrollAnchor[] | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    const capture = () => {
      const container = scrollContainerRef.current;
      pending.current = container ? captureScrollAnchors(container) : null;
    };
    const offMessages = useMessagesStore.subscribe((state, prev) => {
      const now = state.byId[sessionId]?.removedOrdinals.length ?? 0;
      const before = prev.byId[sessionId]?.removedOrdinals.length ?? 0;
      if (now > before) capture();
    });
    const offDeletes = useMessageDeleteStore.subscribe((state, prev) => {
      if (state.staged === prev.staged) return;
      const now = hiddenKey(state.staged, sessionId);
      if (now !== hiddenKey(prev.staged, sessionId)) capture();
    });
    return () => {
      offMessages();
      offDeletes();
    };
  }, [sessionId, scrollContainerRef]);

  // After every render of the page that holds the conversation: both
  // stores it reads re-render it, and a Core deletion of what was hidden
  // already renders nothing new (the hold is then a no-op), so no count
  // to watch.
  useLayoutEffect(() => {
    const anchors = pending.current;
    if (!anchors) return;
    pending.current = null;
    const container = scrollContainerRef.current;
    if (container) holdFirstScrollAnchor(container, anchors);
  });
}
