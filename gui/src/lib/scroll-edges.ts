/** Which edges of a scroll viewport hide more content — the signal a
 * fade at that edge stands for. Both false when nothing overflows. A
 * 1px tolerance absorbs fractional scroll positions. */
export interface ScrollEdges {
  /** Scrolled away from the top: rows hidden above. */
  top: boolean;
  /** Not scrolled to the bottom: rows hidden below. */
  bottom: boolean;
}

export const NO_SCROLL_EDGES: ScrollEdges = { top: false, bottom: false };

export function scrollEdges(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ScrollEdges {
  const { scrollTop, scrollHeight, clientHeight } = metrics;
  if (scrollHeight - clientHeight <= 1) return NO_SCROLL_EDGES;
  return {
    top: scrollTop > 1,
    bottom: scrollTop + clientHeight < scrollHeight - 1,
  };
}

/** Keep the previous object when nothing changed, so a state setter
 * fed from scroll / resize events bails out instead of re-rendering. */
export function nextScrollEdges(
  previous: ScrollEdges,
  next: ScrollEdges,
): ScrollEdges {
  return previous.top === next.top && previous.bottom === next.bottom
    ? previous
    : next;
}
