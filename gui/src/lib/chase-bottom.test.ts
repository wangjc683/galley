import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chaseBottom } from "@/lib/chase-bottom";
import { FakeScrollBox as Box, stubFrames } from "@/test/scroll-frames";

let raf: ReturnType<typeof stubFrames>;
const tick = (ms?: number) => raf.tick(ms);
const runOut = () => raf.runOut();

beforeEach(() => {
  raf = stubFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("chaseBottom", () => {
  it("scrolls to the bottom and attaches", () => {
    const box = new Box(3_000, 700);
    box.scrollTop = 1_200;
    const settled: boolean[] = [];
    chaseBottom(box, (attached) => settled.push(attached));
    runOut();
    expect(settled).toEqual([true]);
    expect(box.scrollTop).toBe(2_300);
    // Settled within the animation, not by the timeout.
    expect(raf.elapsed()).toBeLessThan(700);
  });

  it("re-aims while the bottom grows and still arrives on its own", () => {
    const box = new Box(3_000, 700);
    box.scrollTop = 1_200;
    const settled: boolean[] = [];
    chaseBottom(box, (attached) => settled.push(attached));
    for (let i = 0; i < 10; i++) {
      tick();
      box.scrollHeight += 30;
    }
    runOut();
    expect(settled).toEqual([true]);
    expect(box.scrollHeight - box.scrollTop - box.clientHeight).toBeLessThan(
      24,
    );
    // Never needed the 1600ms snap.
    expect(raf.elapsed()).toBeLessThan(1_600);
  });

  it("lets go without attaching when the user pulls up mid-way", () => {
    const box = new Box(3_000, 700);
    box.scrollTop = 600;
    const settled: boolean[] = [];
    chaseBottom(box, (attached) => settled.push(attached));
    tick();
    tick();
    // A wheel tick up: the animation lets go, the position goes up.
    box.dispatchEvent(new Event("wheel"));
    box.scrollTop -= 40;
    const pulledTo = box.scrollTop;
    tick();
    expect(settled).toEqual([false]);
    runOut();
    expect(box.scrollTop).toBe(pulledTo);
  });

  it("writes the bottom and attaches after 1600ms when the bottom outruns it", () => {
    const box = new Box(3_000, 700);
    box.scrollTop = 0;
    const settled: boolean[] = [];
    chaseBottom(box, (attached) => settled.push(attached));
    while (raf.elapsed() < 3_000) {
      tick();
      if (settled.length > 0) break;
      box.scrollHeight += 400;
    }
    expect(settled).toEqual([true]);
    expect(raf.elapsed()).toBeGreaterThan(1_600);
    expect(raf.elapsed()).toBeLessThan(1_640);
    expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight);
  });

  it("lands at once under reduced motion and attaches on the next frame", () => {
    raf.state.reducedMotion = true;
    const box = new Box(3_000, 700);
    const settled: boolean[] = [];
    chaseBottom(box, (attached) => settled.push(attached));
    expect(box.scrollTop).toBe(2_300);
    tick();
    expect(settled).toEqual([true]);
  });

  it("stops everything without settling when stopped", () => {
    const box = new Box(3_000, 700);
    const settled: boolean[] = [];
    const stop = chaseBottom(box, (attached) => settled.push(attached));
    tick(100);
    const reached = box.scrollTop;
    stop();
    runOut();
    expect(settled).toEqual([]);
    expect(box.scrollTop).toBe(reached);
  });
});
