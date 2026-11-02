// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  RUNWAY_ATTR,
  hasRunway,
  keepInPlace,
  layRunway,
  resizeRunway,
  runwayHeight,
} from "@/lib/scroll-runway";

/*
 * The runway above a paged conversation (main chat ruling 172, ticket
 * 123): what lands above the reader comes out of it, and `scrollTop` is
 * not written — WebKit drops such a write during a flick's momentum. The
 * scroller here keeps its own numbers: 24px of padding above and below
 * the column, the runway on top of the content, `scrollTop` clamped to
 * the range as the browser keeps it, every write recorded.
 */

const PAD = 24;
const VIEW = 600;

function scroller({
  content,
  runway,
  scrollTop,
}: {
  content: number;
  runway: number | null;
  scrollTop: number;
}) {
  const container = document.createElement("div");
  const column = document.createElement("div");
  container.append(column);
  if (runway !== null) layRunway(column, runway);
  const layout = { content };
  const writes: number[] = [];
  const height = () => PAD + runwayHeight(container) + layout.content + PAD;
  const clamp = (value: number) =>
    Math.min(Math.max(0, value), Math.max(0, height() - VIEW));
  let top = scrollTop;
  Object.defineProperties(container, {
    clientHeight: { get: () => VIEW },
    scrollHeight: { get: height },
    scrollTop: {
      get: () => clamp(top),
      set: (value: number) => {
        top = clamp(value);
        writes.push(top);
      },
    },
  });
  return { container, column, layout, writes };
}

describe("keepInPlace (「放回原位」)", () => {
  it("takes a page that landed above out of the runway, writing no scrollTop", () => {
    const { container, layout, writes } = scroller({
      content: 9_000,
      runway: 20_000,
      scrollTop: 20_000 + 2_000,
    });
    layout.content += 3_200;
    keepInPlace(container, 3_200);
    expect(runwayHeight(container)).toBe(16_800);
    expect(writes).toEqual([]);
    expect(container.scrollTop).toBe(22_000);
  });

  it("scrolls for the part of a page taller than what is left of it", () => {
    // The probe's numbers: a page of 6,995px, 5,106px of runway left.
    const { container, layout, writes } = scroller({
      content: 9_000,
      runway: 5_106,
      scrollTop: 5_106 + 300,
    });
    layout.content += 6_995;
    keepInPlace(container, 6_995);
    expect(runwayHeight(container)).toBe(0);
    expect(hasRunway(container)).toBe(true);
    expect(writes).toEqual([5_406 + 1_889]);
  });

  it("grows back by what went away above", () => {
    const { container, layout, writes } = scroller({
      content: 9_000,
      runway: 20_000,
      scrollTop: 23_000,
    });
    layout.content -= 300;
    keepInPlace(container, -300);
    expect(runwayHeight(container)).toBe(20_300);
    expect(writes).toEqual([]);
  });

  it("without a runway scrolls by it, as before", () => {
    const { container, layout, writes } = scroller({
      content: 9_000,
      runway: null,
      scrollTop: 2_000,
    });
    layout.content += 3_200;
    keepInPlace(container, 3_200);
    expect(writes).toEqual([5_200]);
    expect(container.firstElementChild!.hasAttribute(RUNWAY_ATTR)).toBe(false);
    // Under a pixel: nothing, as before.
    keepInPlace(container, 0.4);
    expect(writes).toEqual([5_200]);
  });
});

describe("resizeRunway (at rest)", () => {
  it("refills it, scrollTop moving by as much so nothing on screen moves", () => {
    const { container, writes } = scroller({
      content: 12_000,
      runway: 12_000,
      scrollTop: 12_000 + 1_500,
    });
    expect(resizeRunway(container, 20_000)).toBe(8_000);
    expect(runwayHeight(container)).toBe(20_000);
    expect(writes).toEqual([21_500]);
  });

  it("takes it away, marker and all", () => {
    const { container, column, writes } = scroller({
      content: 12_000,
      runway: 20_000,
      scrollTop: 20_000 + 1_500,
    });
    expect(resizeRunway(container, 0)).toBe(-20_000);
    expect(hasRunway(container)).toBe(false);
    expect(column.hasAttribute(RUNWAY_ATTR)).toBe(false);
    expect(column.style.paddingTop).toBe("");
    expect(writes).toEqual([1_500]);
  });

  it("lands a reader inside it on the top", () => {
    // Flicked past the first message into the blank (ruling 172).
    const { container, writes } = scroller({
      content: 12_000,
      runway: 20_000,
      scrollTop: 18_740,
    });
    resizeRunway(container, 0);
    expect(writes).toEqual([0]);
  });

  it("moves a live tail's min-height with the content", () => {
    const { container, column } = scroller({
      content: 3_000,
      runway: 20_000,
      scrollTop: 21_000,
    });
    column.style.minHeight = "23500px";
    resizeRunway(container, 0);
    expect(column.style.minHeight).toBe("3500px");
  });

  it("does nothing without a runway or a change", () => {
    const bare = scroller({ content: 3_000, runway: null, scrollTop: 100 });
    expect(resizeRunway(bare.container, 20_000)).toBe(0);
    expect(bare.writes).toEqual([]);
    const full = scroller({ content: 3_000, runway: 20_000, scrollTop: 100 });
    expect(resizeRunway(full.container, 20_000)).toBe(0);
    expect(full.writes).toEqual([]);
  });
});
