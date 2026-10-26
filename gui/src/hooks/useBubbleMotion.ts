import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import {
  settleBubbleMotion,
  settledTypingOpacity,
  typingDepartureClaimed,
} from "@/lib/bubble-motion";
import {
  captureSend,
  columnOf,
  conversationOf,
  playSend,
  playTypingAppear,
  playTypingLeave,
  readTyping,
  typingRowOf,
  typingSuccessors,
  type SendBefore,
  type TypingSeen,
} from "@/lib/bubble-motion-play";
import { loopStartOf, sweepStartOf } from "@/lib/typing-bubble-phase";
import { useMessagesStore } from "@/stores/messages";

/*
 * The main chat's send and its typing bubble coming and going (main chat
 * PRD ruling 138, ticket 94; rules in lib/bubble-motion.ts, the page side
 * in lib/bubble-motion-play.ts). A deletion's motion is
 * hooks/useRemovedTurnsAnchor.ts's; the reply growing out of the typing
 * bubble stays hooks/useTypingBubbleHandoff.ts's, which runs first in the
 * commit and claims the typing bubble's going when it plays.
 */

/** The conversation as the commits of a live round left it, for the
 * typing bubble's coming and going in the next. */
interface Tracking {
  /** The last commit was live (MainView's `TypingBubbleFrame.live`):
   * only then does a change of the typing bubble play — not on a mount,
   * a switch back, a cold restore. */
  live: boolean;
  /** The typing bubble as last read, if it was up. */
  typing: TypingSeen | null;
  /** The column's top in the scroll content (px), and the scroller's
   * `scrollTop`, as last seen: where the column looked to be is their
   * difference (scrolling moves only the second). */
  columnTop: number | null;
  scrollTop: number;
  /** The conversation's last row and the column's children: what is
   * new after them took the typing bubble's place. */
  lastRow: Element | null;
  kids: Element[];
  /** What the typing bubble's fade-in had reached when the run stopped
   * (the stop settles the motions before React renders it). */
  stopOpacity: number | null;
}

function measure(track: Tracking, container: HTMLElement): void {
  const column = columnOf(container);
  if (!column) return;
  track.columnTop =
    column.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  track.scrollTop = container.scrollTop;
  const row = typingRowOf(column);
  track.typing = row
    ? readTyping(
        row,
        column,
        (dots) => loopStartOf(dots, track.typing),
        sweepStartOf,
      )
    : null;
  track.lastRow = conversationOf(column)?.lastElementChild ?? null;
  track.kids = Array.from(column.children);
}

/**
 * The send's slide and fades, and the typing bubble's fades, on the page
 * (`enabled`: the main chat; off, it reads and plays nothing). `live`:
 * the round is live at the conversation's end, as the hand-off has it.
 */
export function useBubbleMotion({
  enabled,
  sessionId,
  live,
  scrollContainerRef,
}: {
  enabled: boolean;
  sessionId?: string;
  live: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}): void {
  const sendRef = useRef<SendBefore | null>(null);
  const trackRef = useRef<Tracking>({
    live: false,
    typing: null,
    columnTop: null,
    scrollTop: 0,
    lastRow: null,
    kids: [],
    stopOpacity: null,
  });

  // Inside the store write, before React renders it: your message going
  // in (every way it comes: the composer, a queued one going out, your
  // answer to its question, the CLI, the phone — all in front of you),
  // and the run stopping.
  useEffect(() => {
    if (!enabled || sessionId === undefined) return;
    return useMessagesStore.subscribe((state, prev) => {
      const now = state.byId[sessionId];
      const before = prev.byId[sessionId];
      if (now === before) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      if (state.userSubmitTick > prev.userSubmitTick) {
        settleBubbleMotion(container);
        sendRef.current = captureSend(container);
        return;
      }
      if (before?.agentRunning && !now?.agentRunning) {
        // The commit this brings decides where the conversation ends up
        // (the follow) before the typing bubble's going plays: nothing of
        // ours may be moving it then.
        settleBubbleMotion(container);
        trackRef.current.stopOpacity = settledTypingOpacity(container);
      }
    });
  }, [enabled, sessionId, scrollContainerRef]);

  // Every commit: play what it brought, then read it for the next.
  // After useStickyScroll's and the hand-off's (MainView calls this after
  // them): the send's pin to the bottom is in, and a hand-off has claimed
  // the typing bubble's going.
  useLayoutEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    const send = sendRef.current;
    sendRef.current = null;
    const track = trackRef.current;
    const stopOpacity = track.stopOpacity;
    track.stopOpacity = null;
    if (!container) return;
    if (send) {
      playSend(container, send);
    } else if (track.live) {
      const column = columnOf(container);
      const typing = column ? typingRowOf(column) : null;
      const seenTop =
        track.columnTop === null ? null : track.columnTop - track.scrollTop;
      if (column && seenTop !== null && typing && !track.typing) {
        settleBubbleMotion(container);
        playTypingAppear(container, seenTop);
      } else if (
        column &&
        seenTop !== null &&
        track.typing &&
        !typing &&
        !typingDepartureClaimed(container)
      ) {
        settleBubbleMotion(container);
        const from = stopOpacity ?? settledTypingOpacity(container) ?? 1;
        playTypingLeave(
          container,
          track.typing,
          seenTop,
          typingSuccessors(column, track.lastRow, track.kids),
          from,
        );
      }
    }
    track.live = live;
    if (!live) {
      track.typing = null;
      track.columnTop = null;
      return;
    }
    measure(track, container);
  });

  // …and between commits while it is live: a change of size (the
  // follow's pin, the composer, the window; after their observers, made
  // before this one) and the reader's own scrolling. Unmounting puts
  // whatever is running to its end and takes its copies away.
  useEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const track = trackRef.current;
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (track.live) measure(track, container);
          })
        : null;
    observer?.observe(container);
    const column = columnOf(container);
    if (column) observer?.observe(column);
    const onScroll = () => {
      if (track.live) track.scrollTop = container.scrollTop;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      container.removeEventListener("scroll", onScroll);
      settleBubbleMotion(container);
    };
  }, [enabled, scrollContainerRef]);
}
