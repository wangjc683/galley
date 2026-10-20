import { describe, expect, it } from "vitest";

import { NO_SCROLL_EDGES, nextScrollEdges, scrollEdges } from "./scroll-edges";

/**
 * The edge fades of a scroll viewport (the Settings 「添加」 menu, SIWC
 * decision 17): bottom while rows are hidden below, top once scrolled
 * away from the top, neither when everything fits.
 */
describe("scrollEdges", () => {
  // 11 rows × 32px + 8px padding in a 300px viewport.
  const list = { scrollHeight: 360, clientHeight: 300 };

  it("shows nothing when the list fits", () => {
    expect(
      scrollEdges({ scrollTop: 0, scrollHeight: 360, clientHeight: 360 }),
    ).toBe(NO_SCROLL_EDGES);
    // A sub-pixel overflow is not an overflow.
    expect(
      scrollEdges({ scrollTop: 0, scrollHeight: 360.5, clientHeight: 360 }),
    ).toBe(NO_SCROLL_EDGES);
  });

  it("fades the bottom at the top of an overflowing list", () => {
    expect(scrollEdges({ ...list, scrollTop: 0 })).toEqual({
      top: false,
      bottom: true,
    });
  });

  it("fades both edges in the middle", () => {
    expect(scrollEdges({ ...list, scrollTop: 30 })).toEqual({
      top: true,
      bottom: true,
    });
  });

  it("fades only the top at the bottom, within a pixel", () => {
    expect(scrollEdges({ ...list, scrollTop: 60 })).toEqual({
      top: true,
      bottom: false,
    });
    expect(scrollEdges({ ...list, scrollTop: 59.5 })).toEqual({
      top: true,
      bottom: false,
    });
  });
});

describe("nextScrollEdges", () => {
  it("keeps the previous object when nothing changed, so the setter bails out", () => {
    const previous = { top: false, bottom: true };
    expect(nextScrollEdges(previous, { top: false, bottom: true })).toBe(
      previous,
    );
    const next = { top: true, bottom: true };
    expect(nextScrollEdges(previous, next)).toBe(next);
  });
});
