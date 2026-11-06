// Keeping what the reader sees still while content lands above it —
// the conversation's earlier pages (paged history, main-chat ticket 12)
// and the late layout inside them (Shiki, images). The macOS webview
// (WebKit) has no CSS scroll anchoring (`overflow-anchor`), so the
// conversation does it by hand: remember one row at the top of the
// viewport and where it sat, and after the layout changes put it back
// by however far that row moved — out of the runway above the loaded
// turns while there is one, else by scrolling (lib/scroll-runway.ts).

import { bubbleSpringShift } from "@/lib/bubble-spring";
import { keepInPlace } from "@/lib/scroll-runway";

/** The conversation's rows: the children of Conversation's root. */
const ROWS_SELECTOR = '[data-role="conversation"]';

/** Where `row` is in the layout (viewport px): its box less what the
 * main chat's scroll spring has moved it (ruling 201), which changes
 * from frame to frame without anything moving the layout — held across
 * frames (a page settling), it would read as drift and be scrolled
 * away. */
function layoutBox(row: Element): { top: number; bottom: number } {
  const rect = row.getBoundingClientRect();
  const shift = bubbleSpringShift(row);
  return { top: rect.top - shift, bottom: rect.bottom - shift };
}

/** A row and where it sat in the scroll container. */
export interface ScrollAnchor {
  el: Element;
  /** The row's top edge minus the container's, in px. */
  offset: number;
  /** The container's `scrollTop` when `offset` was read. */
  scrollTop: number;
}

/**
 * Index of the first row whose bottom edge lies below `viewportTop` —
 * the row the viewport's top edge crosses, or the first one under it;
 * -1 when there is none. Rows stack, so their bottoms ascend and a
 * binary search reads only a handful of them (`bottomOf` measures one).
 */
export function firstRowBelow(
  count: number,
  bottomOf: (index: number) => number,
  viewportTop: number,
): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) > viewportTop) hi = mid;
    else lo = mid + 1;
  }
  return lo < count ? lo : -1;
}

/**
 * How far to scroll so `anchor` sits where it was read: how far it moved
 * (`offsetNow - anchor.offset`), less the part the container's own
 * scrolling explains (scrolling down by `d` moves it up by `d`). What is
 * left is layout above it, which is exactly what to scroll by.
 */
export function anchorCorrection(
  anchor: ScrollAnchor,
  offsetNow: number,
  scrollTopNow: number,
): number {
  return offsetNow - anchor.offset + (scrollTopNow - anchor.scrollTop);
}

/** The conversation row at the top of `container`'s viewport, and where
 * it sits; null when the conversation shows no rows. */
export function captureScrollAnchor(
  container: HTMLElement,
): ScrollAnchor | null {
  const root = container.querySelector(ROWS_SELECTOR);
  if (!root) return null;
  const rows = root.children;
  const top = container.getBoundingClientRect().top;
  const index = firstRowBelow(
    rows.length,
    (i) => layoutBox(rows[i]).bottom,
    top,
  );
  if (index < 0) return null;
  const el = rows[index];
  return {
    el,
    offset: layoutBox(el).top - top,
    scrollTop: container.scrollTop,
  };
}

/** How far the layout above `anchor`'s row has moved it since it was
 * read (`anchorCorrection`); null when the row has left the document. */
export function scrollAnchorDrift(
  container: HTMLElement,
  anchor: ScrollAnchor,
): number | null {
  if (!anchor.el.isConnected) return null;
  const offsetNow =
    layoutBox(anchor.el).top - container.getBoundingClientRect().top;
  return anchorCorrection(anchor, offsetNow, container.scrollTop);
}

/** Put `anchor`'s row back where it was read (lib/scroll-runway.ts
 * `keepInPlace`: out of the runway, else by scrolling). False when the
 * row has left the document. */
export function holdScrollAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  const delta = scrollAnchorDrift(container, anchor);
  if (delta === null) return false;
  keepInPlace(container, delta);
  return true;
}

/** How many rows {@link captureScrollAnchors} reads: more than a
 * deleted message can take out from the top of the viewport (its
 * bubble, the time line above it, a process card, subtask cards). */
const REMOVAL_ANCHOR_ROWS = 8;

/**
 * The rows from the one at the top of `container`'s viewport down, each
 * with where it sits — for a removal (a deleted message, main chat
 * ticket 32), which may take the first of them out of the document:
 * {@link holdFirstScrollAnchor} then holds the first one left.
 */
export function captureScrollAnchors(
  container: HTMLElement,
  limit = REMOVAL_ANCHOR_ROWS,
): ScrollAnchor[] {
  const root = container.querySelector(ROWS_SELECTOR);
  if (!root) return [];
  const rows = root.children;
  const top = container.getBoundingClientRect().top;
  const first = firstRowBelow(
    rows.length,
    (i) => layoutBox(rows[i]).bottom,
    top,
  );
  if (first < 0) return [];
  const anchors: ScrollAnchor[] = [];
  for (let i = first; i < rows.length && anchors.length < limit; i++) {
    anchors.push({
      el: rows[i],
      offset: layoutBox(rows[i]).top - top,
      scrollTop: container.scrollTop,
    });
  }
  return anchors;
}

/** Hold the first of `anchors` still in the document where it was read
 * ({@link holdScrollAnchor}). False when none is. */
export function holdFirstScrollAnchor(
  container: HTMLElement,
  anchors: readonly ScrollAnchor[],
): boolean {
  return anchors.some((anchor) => holdScrollAnchor(container, anchor));
}
