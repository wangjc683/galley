// Keeping what the reader sees still while content lands above it —
// the conversation's earlier pages (paged history, main-chat ticket 12)
// and the late layout inside them (Shiki, images). The macOS webview
// (WebKit) has no CSS scroll anchoring (`overflow-anchor`), so the
// conversation does it by hand: remember one row at the top of the
// viewport and where it sat, and after the layout changes scroll by
// however far that row moved.

/** The conversation's rows: the children of Conversation's root. */
const ROWS_SELECTOR = '[data-role="conversation"]';

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
    (i) => rows[i].getBoundingClientRect().bottom,
    top,
  );
  if (index < 0) return null;
  const el = rows[index];
  return {
    el,
    offset: el.getBoundingClientRect().top - top,
    scrollTop: container.scrollTop,
  };
}

/** Scroll `container` so `anchor`'s row sits where it was read. False
 * when the row has left the document. */
export function holdScrollAnchor(
  container: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  if (!anchor.el.isConnected) return false;
  const offsetNow =
    anchor.el.getBoundingClientRect().top -
    container.getBoundingClientRect().top;
  const delta = anchorCorrection(anchor, offsetNow, container.scrollTop);
  if (Math.abs(delta) >= 1) container.scrollTop += delta;
  return true;
}
