// The runway above a paged conversation (main chat rulings 170, 172;
// ticket 123). While earlier pages remain to be read, a blank stands
// above the loaded turns. A page that lands above the reader (or late
// layout inside it, or a message deleted up there) is taken out of the
// blank — the blank shrinks by what grew, grows back by what shrank — so
// the content keeps its place in the document and nothing writes
// `scrollTop`. That is the point: during a flick's momentum, WebKit's
// scrolling thread overwrites a `scrollTop` written by the page with its
// own position (measured in tauri dev, ruling 172: every correction made
// mid-flick was lost, and the reader landed a page off). Writes made
// while the reader is idle land, so the runway is refilled (and finally
// taken away) only then, with `scrollTop` moving by the same amount.
//
// The blank is the conversation column's `padding-top` (the column is the
// scroll container's first child, MainView): not a child of the
// conversation's root, whose children are the rows the anchors read; not
// the scroll container's own padding, which an `absolute inset-0` box
// cannot hold taller than itself (the probe's first try: the box grew to
// the padding and the page went white); and not a box of its own, whose
// height would change the column's content box and set off the
// ResizeObservers watching it — from inside one of them, a loop. Padding
// leaves the column's content box, and every offset measured from the
// column's top below the runway, as they were when it shrinks for a page.

/** The marker on the conversation column while it carries a runway. */
export const RUNWAY_ATTR = "data-scroll-runway";

/** The runway's height when it is laid and its least target (px): the
 * height measured in the probe (ruling 172). useEarlierTurns raises the
 * target to twice the tallest page it has seen land. */
export const RUNWAY_MIN_PX = 20_000;

/** The column carrying the runway: the scroll container's first child,
 * while marked. Duck-typed: tests hand in plain stand-ins. */
function runwayColumn(container: Element): HTMLElement | null {
  const column = container.firstElementChild as HTMLElement | null | undefined;
  return column?.hasAttribute?.(RUNWAY_ATTR) ? column : null;
}

function heightOf(column: HTMLElement): number {
  return Number.parseFloat(column.style.paddingTop) || 0;
}

/** Whether `container`'s conversation has a runway (it may be 0px high:
 * a page taller than what was left took it all). */
export function hasRunway(container: Element): boolean {
  return runwayColumn(container) !== null;
}

/** The runway's height in `container` (px); 0 without one. Everything
 * that measures the loaded content against the scroll range (the
 * loading trigger, the question rail) takes it off. */
export function runwayHeight(container: Element): number {
  const column = runwayColumn(container);
  return column ? heightOf(column) : 0;
}

/** Lay a runway on the conversation `column`: the render the page first
 * shows earlier pages in, before anything places the scroll position. */
export function layRunway(column: HTMLElement, height: number): void {
  column.setAttribute(RUNWAY_ATTR, "");
  column.style.paddingTop = `${Math.max(0, height)}px`;
}

/**
 * Put what the reader sees back in place after `delta` px of layout above
 * them (positive: it grew; negative: it shrank) — 「放回原位」, for the
 * page prepended, its late layout, a message deleted above
 * (lib/scroll-anchor.ts `holdScrollAnchor`, useEarlierTurns). With a
 * runway the runway takes it and `scrollTop` is not written; what it
 * cannot take (a page taller than what is left of it) is scrolled for.
 * Without one, it is scrolled for, as it always was.
 */
export function keepInPlace(container: HTMLElement, delta: number): void {
  if (Math.abs(delta) < 1) return;
  const column = runwayColumn(container);
  if (!column) {
    container.scrollTop += delta;
    return;
  }
  const height = heightOf(column);
  const next = Math.max(0, height - delta);
  const rest = delta - (height - next);
  // Read before the runway changes: the scroll range is about to.
  const top = Math.abs(rest) >= 1 ? container.scrollTop : 0;
  if (next !== height) column.style.paddingTop = `${next}px`;
  if (Math.abs(rest) >= 1) container.scrollTop = top + rest;
}

/**
 * Resize the runway to `height` while the reader is idle (useEarlierTurns
 * decides when): the content moves by the change and `scrollTop` with
 * it, so nothing on screen moves. A reader inside the runway when it
 * shrinks lands on the top. 0 takes the runway away, marker and all. A
 * live tail's `min-height` on the column (lib/live-tail.ts, the
 * workbench) moves with the content too: it holds a blank one viewport
 * below a line in the content. Returns the change (px).
 */
export function resizeRunway(container: HTMLElement, height: number): number {
  const column = runwayColumn(container);
  if (!column) return 0;
  const before = heightOf(column);
  const next = Math.max(0, height);
  const delta = next - before;
  // Read before the runway changes: shrinking it shrinks the scroll
  // range, and the browser would clamp what a later read returns.
  const top = container.scrollTop;
  if (next === 0) {
    column.removeAttribute(RUNWAY_ATTR);
    column.style.paddingTop = "";
  } else if (delta !== 0) {
    column.style.paddingTop = `${next}px`;
  }
  if (delta === 0) return 0;
  const minHeight = Number.parseFloat(column.style.minHeight);
  if (Number.isFinite(minHeight)) {
    column.style.minHeight = `${Math.max(0, minHeight + delta)}px`;
  }
  container.scrollTop = top + delta;
  return delta;
}
