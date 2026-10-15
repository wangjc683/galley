/**
 * Keeping the conversation's bottom in view when its viewport changes
 * height (main chat ticket 27). The viewport is the scroll container
 * above the composer. It gets shorter from below as the input grows a
 * line at a time (a session's one-line composer starts at 48px and grows
 * to eight lines), as image tiles or the queue strip come in, or as the
 * window gets shorter; taller as they go. A shorter viewport keeps its
 * `scrollTop`, so a conversation that sat at the bottom loses its last
 * lines under the composer's top edge, and nothing re-pins it: the
 * follow paths in useStickyScroll watch the content, not the viewport.
 *
 * The rule: a conversation that was at the bottom (useStickyScroll's
 * `atBottom`, 24px tolerance) stays at the bottom; one the reader
 * scrolled up in stays where it is. The same in the main chat and the
 * workbench. The main chat's follow limit (`assistantFollowTop`, stop
 * before the reply's start leaves the viewport) is for a reply growing
 * under a reader, not for the box they are typing in: the message they
 * are answering has to stay right above it.
 */

export interface ViewportResize {
  /** The viewport's `clientHeight` before this change; null on the
   * first measure. */
  previousHeight: number | null;
  /** Its `clientHeight` now. */
  height: number;
  scrollHeight: number;
  /** The conversation sat at the bottom before the change. */
  wasAtBottom: boolean;
}

/** The `scrollTop` after a change of the viewport's height: the bottom
 * when it sat there, null (leave it) when the reader had scrolled up,
 * on the first measure, or when the height did not change (a width
 * change reflows the content, which the content's own follow covers). */
export function viewportResizeScrollTop(r: ViewportResize): number | null {
  if (r.previousHeight === null || r.previousHeight === r.height) return null;
  if (!r.wasAtBottom) return null;
  return Math.max(0, r.scrollHeight - r.height);
}

/**
 * Applies the rule to `el` for as long as it lives; returns the
 * disconnect. A ResizeObserver on the scroll container itself: its
 * callbacks run after layout and before paint, so the frame the
 * composer grows in already shows the conversation pinned.
 * `wasAtBottom` is read when the size changes; a viewport that only got
 * shorter fires no scroll event, so it still answers for the moment
 * before the change.
 */
export function keepBottomOnViewportResize(
  el: HTMLElement,
  wasAtBottom: () => boolean,
): () => void {
  let previousHeight: number | null = null;
  const observer = new ResizeObserver(() => {
    const height = el.clientHeight;
    const top = viewportResizeScrollTop({
      previousHeight,
      height,
      scrollHeight: el.scrollHeight,
      wasAtBottom: wasAtBottom(),
    });
    previousHeight = height;
    if (top !== null) el.scrollTop = top;
  });
  observer.observe(el);
  return () => observer.disconnect();
}
