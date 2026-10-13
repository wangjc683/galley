import { describe, expect, it } from "vitest";

import { anchorCorrection, firstRowBelow } from "@/lib/scroll-anchor";

describe("firstRowBelow", () => {
  const bottoms = [40, 120, 120, 300, 520];
  const at = (top: number) =>
    firstRowBelow(bottoms.length, (i) => bottoms[i], top);

  it("finds the row the viewport's top edge crosses", () => {
    expect(at(0)).toBe(0);
    expect(at(39)).toBe(0);
    expect(at(40)).toBe(1);
    expect(at(119)).toBe(1);
    // An empty row ending on the edge is passed over too.
    expect(at(120)).toBe(3);
    expect(at(519)).toBe(4);
  });

  it("is -1 past the last row or with none", () => {
    expect(at(520)).toBe(-1);
    expect(firstRowBelow(0, () => 0, 0)).toBe(-1);
  });

  it("reads only a handful of rows", () => {
    let reads = 0;
    const many = firstRowBelow(
      1000,
      (i) => {
        reads += 1;
        return (i + 1) * 10;
      },
      5_000,
    );
    expect(many).toBe(500);
    expect(reads).toBeLessThanOrEqual(11);
  });
});

describe("anchorCorrection", () => {
  const anchor = { el: {} as Element, offset: 24, scrollTop: 1_000 };

  it("is the height that landed above the row", () => {
    // An earlier page of 3200px rendered above: the row moved down by it.
    expect(anchorCorrection(anchor, 24 + 3_200, 1_000)).toBe(3_200);
  });

  it("leaves the reader's own scrolling alone", () => {
    // Scrolled down 150px: the row moved up 150px, nothing to correct.
    expect(anchorCorrection(anchor, 24 - 150, 1_150)).toBe(0);
    // Both at once: only the layout part.
    expect(anchorCorrection(anchor, 24 - 150 + 80, 1_150)).toBe(80);
  });

  it("is zero when nothing moved", () => {
    expect(anchorCorrection(anchor, 24, 1_000)).toBe(0);
  });
});
