import {
  animateScroll,
  type ScrollAnimation,
  type ScrollBox,
} from "@/lib/animate-scroll";
import { userMsgParkOffset } from "@/lib/conversation-anchor";

/**
 * The workbench's live tail (telegram-details ticket 06, PRD ruling 2):
 * after you send from the composer, your message parks on the anchor
 * line (lib/conversation-anchor.ts `userMsgParkOffset`: the bubble 32px
 * under the top, or the time line right above it at 16px), with blank
 * space under it down to the composer; the live window and the reply
 * grow into that space while the viewport stays put, and once the reply
 * outgrows the screen it is still not followed — you read it from its
 * start (A; Telegram releases into following the bottom, B).
 *
 * The blank is a `min-height` on the conversation's column, not a spacer
 * after it: the column must reach at least one viewport below the park
 * line, and that depends only on where the anchor sits (the content
 * above it) and on the viewport's height — not on what grows or
 * collapses under the anchor. So the run's own changes (steps landing,
 * the reply streaming, the process folding into its header when it
 * settles) never need the blank recomputed, and the browser never
 * clamps `scrollTop` between a change and its fix-up: the message stays
 * where it is. (A spacer would shrink by what grows above it and have
 * to grow back by what collapses; the collapse lands first, clamps the
 * scroll position, and the message jumps by the collapsed height.)
 * Telegram does the same with a `min-height` on the last group
 * (Web A `MessageList.scss`).
 *
 * The workbench only: the main chat is an IM that sticks to the bottom
 * (main chat PRD ruling 67) and never gets here.
 */

/** Within this of the bottom counts as at the bottom (useStickyScroll's
 * at-bottom tolerance). */
export const LIVE_TAIL_BOTTOM_PX = 24;

/** The scroll container as the tail reads it (an HTMLElement in the app;
 * a stand-in in tests). */
export interface LiveTailBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { top: number };
}

/**
 * The column's `min-height` that makes `parkTop` reachable: the
 * container's largest `scrollTop` (`scrollHeight − clientHeight`) must
 * be at least `parkTop`, and the container's height around the column
 * (its padding, any margin that leaves the column) is `scrollHeight −
 * columnHeight`, read now. Never negative.
 */
export function liveTailMinHeight({
  parkTop,
  clientHeight,
  scrollHeight,
  columnHeight,
}: {
  parkTop: number;
  clientHeight: number;
  scrollHeight: number;
  columnHeight: number;
}): number {
  return Math.max(
    0,
    Math.ceil(parkTop + clientHeight - (scrollHeight - columnHeight)),
  );
}

/** The blank the `min-height` leaves under the content: none once the
 * content reaches it. */
export function liveTailBlank(minHeight: number, contentHeight: number) {
  return Math.max(0, minHeight - contentHeight);
}

/** Where the tail parks `anchor` (the bubble) in `el` and the column's
 * `min-height` for it. */
export function liveTailPark(
  el: LiveTailBox,
  columnHeight: number,
  anchor: Element,
): { parkTop: number; minHeight: number } {
  const parkTop =
    el.scrollTop + userMsgParkOffset(anchor, el.getBoundingClientRect().top);
  return {
    parkTop,
    minHeight: liveTailMinHeight({
      parkTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      columnHeight,
    }),
  };
}

/**
 * Whether reaching the bottom attaches following again: only at the
 * content's real end. While the blank still shows, the bottom is the
 * park position itself (the run has not filled the screen yet), and
 * being there is the tail, not a request to follow.
 */
export function liveTailReattaches({
  distFromBottom,
  columnHeight,
  minHeight,
}: {
  distFromBottom: number;
  columnHeight: number;
  minHeight: number;
}): boolean {
  return distFromBottom < LIVE_TAIL_BOTTOM_PX && columnHeight > minHeight + 0.5;
}

/**
 * Who put the newest user message in the conversation (messages store
 * `lastSubmitSource`, set with every `userSubmitTick`):
 *
 *   composer   this page's composer: a send, or an answer to ask_user.
 *   side       a `/btw` side question.
 *   queued     a row Core dispatched that this page did not echo, sent
 *              as from the GUI: a queued message going out when the run
 *              before it ended (or a send into a run that had just
 *              ended, which Core dispatched itself; a message from the
 *              phone).
 *   external   a row from the CLI, a supervisor or the system.
 */
export type SubmitSource = "composer" | "side" | "queued" | "external";

/**
 * What a new user message does to the workbench's viewport:
 *
 *   tail         park it with the blank under it; stop following.
 *   blank        anchor the blank on it without moving the viewport;
 *                stop following.
 *   park         scroll toward its park position as before ticket 06
 *                (clamped at the bottom without a blank); following as
 *                it was.
 *   park-follow  the same, and following goes back to the at-bottom
 *                rule as before ticket 06.
 *   none         nothing.
 *
 * Queued messages go out when the run before them ends, often while you
 * read that run's answer: they never move the viewport. At the bottom
 * the blank moves onto the new message (it parks there when you scroll
 * or click down; its reply is not followed); away from the bottom
 * nothing changes. `/btw` and messages from the CLI or a supervisor
 * keep their pre-ticket-06 scroll.
 */
export type SubmitScroll = "tail" | "blank" | "park" | "park-follow" | "none";

export function submitScroll(
  source: SubmitSource,
  atBottom: boolean,
): SubmitScroll {
  switch (source) {
    case "composer":
      return "tail";
    case "queued":
      return atBottom ? "blank" : "none";
    case "side":
      return "park";
    case "external":
      return "park-follow";
  }
}

// ---- The tail itself ------------------------------------------------------

/** The scroll container as the running tail uses it. */
export interface LiveTailScroller extends ScrollBox, LiveTailBox {
  scrollTop: number;
  querySelector(selectors: string): Element | null;
}

/** The conversation's column, the scroll container's first child: the
 * element that carries the `min-height`. */
export interface LiveTailColumn {
  readonly style: { minHeight: string };
  getBoundingClientRect(): { height: number };
}

export interface LiveTail {
  /** False until you reach the content's real end yourself (or a CLI /
   * supervisor message puts following back): the follow paths stand
   * down. */
  readonly noFollow: boolean;
  /** Put following back to the at-bottom rule; the blank stays (taking
   * it away could move the viewport). */
  resumeFollowing(): void;
  /**
   * Re-measure after a layout change: the anchor moved (content above
   * it changed) or the viewport changed height. Refits the blank, and
   * keeps the message on its line when it was parked there (or re-aims
   * the park still on its way). False when the anchor is gone (an echo
   * Core queued instead): the tail has ended and the blank is gone.
   */
  refresh(): boolean;
  /** After every scroll: whether it sits parked; reaching the content's
   * real end attaches following again. */
  onScroll(): void;
  /** Stop its scroll, if still on the way; the blank stays (a newer
   * tail takes the column over). */
  stop(): void;
  /** Take the blank away. */
  end(): void;
}

/**
 * Starts the tail on `anchor` (the bubble just sent), replacing any
 * earlier one: the blank moves under it at once; `park` also scrolls it
 * to its line (lib/animate-scroll.ts, so instant under reduced motion).
 * A replaced tail is simply dropped — its `min-height` is overwritten,
 * never cleared in between, which could clamp the scroll position.
 */
export function startLiveTail(
  el: LiveTailScroller,
  column: LiveTailColumn,
  anchor: Element,
  { park }: { park: boolean },
): LiveTail {
  let current = anchor;
  let messageId = anchor.getAttribute("data-message-id");
  let parkTop = 0;
  let minHeight = 0;
  let noFollow = true;
  let parked = false;
  let animation: ScrollAnimation | null = null;

  const setMinHeight = (value: number) => {
    minHeight = Math.max(0, Math.ceil(value));
    const css = `${minHeight}px`;
    // Unchanged: no write (a write is a layout change, and this runs in
    // ResizeObserver callbacks).
    if (column.style.minHeight !== css) column.style.minHeight = css;
  };

  /** Fit the blank so the park position is exactly the bottom when the
   * column sits at its `min-height`: the container's height around the
   * column read before can differ once the `min-height` applies (a last
   * child's margin that collapsed through the column stays inside it). */
  const fit = (next: number) => {
    setMinHeight(next);
    if (column.getBoundingClientRect().height > minHeight + 0.5) return;
    const excess = el.scrollHeight - el.clientHeight - parkTop;
    if (excess >= 1 || excess <= -1) setMinHeight(minHeight - excess);
  };

  const measure = () => {
    const park = liveTailPark(
      el,
      column.getBoundingClientRect().height,
      current,
    );
    const moved = Math.abs(park.parkTop - parkTop) >= 0.5;
    parkTop = park.parkTop;
    fit(park.minHeight);
    return moved;
  };

  measure();
  if (park) animation = animateScroll(el, parkTop);

  const tail: LiveTail = {
    get noFollow() {
      return noFollow;
    },
    resumeFollowing() {
      noFollow = false;
    },
    refresh() {
      if (!current.isConnected) {
        // Re-rendered under a new node: find it again by its row id.
        const again = messageId
          ? el.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
          : null;
        if (!again) {
          tail.end();
          return false;
        }
        current = again;
      }
      messageId ??= current.getAttribute("data-message-id");
      const moved = measure();
      if (animation && animation.ended === null) {
        if (moved) animation.retarget(parkTop);
      } else if (parked && Math.abs(el.scrollTop - parkTop) >= 0.5) {
        el.scrollTop = parkTop;
      }
      return true;
    },
    onScroll() {
      parked = Math.abs(el.scrollTop - parkTop) <= 1;
      if (
        noFollow &&
        liveTailReattaches({
          distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
          columnHeight: column.getBoundingClientRect().height,
          minHeight,
        })
      ) {
        noFollow = false;
      }
    },
    stop() {
      animation?.cancel();
    },
    end() {
      animation?.cancel();
      noFollow = false;
      column.style.minHeight = "";
    },
  };
  return tail;
}
