import { describe, expect, it } from "vitest";

import {
  DAMPING_RATIO,
  FULL_LAG_SPEED_PX_S,
  LAG_GAIN,
  MAX_KICK_PX,
  MAX_LAG_PX,
  MAX_NEIGHBOUR_STEP_PX,
  SETTLE_MS,
  SETTLE_WITHIN_PX,
  SPRING_OMEGA,
  anchorDistance,
  anchorIndex,
  atRest,
  holdNeighbours,
  humanScroll,
  kickPeak,
  kickVelocity,
  lag,
  lagShare,
  paintedOffsets,
  settleTimeMs,
  springStep,
  type SpringState,
} from "./bubble-spring";

/** The path from `state` in frames of `frameMs`, for `totalMs`: the
 * offset at the end of each frame, with its time. */
function run(
  state: SpringState,
  frameMs: number | (() => number),
  totalMs: number,
): { t: number; x: number }[] {
  const path: { t: number; x: number }[] = [];
  let t = 0;
  let s = state;
  while (t < totalMs) {
    const dt = typeof frameMs === "number" ? frameMs : frameMs();
    s = springStep(s, dt);
    t += dt;
    path.push({ t, x: s.x });
  }
  return path;
}

describe("the spring's numbers (ruling 201)", () => {
  it("keeps the ruling's four numbers as constants", () => {
    expect(MAX_LAG_PX).toBe(6);
    expect(MAX_NEIGHBOUR_STEP_PX).toBe(2);
    expect(DAMPING_RATIO).toBe(0.8);
    expect(SETTLE_MS).toBe(350);
    expect(MAX_KICK_PX).toBe(1.5);
  });

  it("works its stiffness out of the settling time", () => {
    // Let go from the cap, within half a pixel at 350ms (to the sampling).
    const settle = settleTimeMs(SPRING_OMEGA);
    expect(settle).toBeLessThanOrEqual(SETTLE_MS);
    expect(settle).toBeGreaterThan(SETTLE_MS - 5);
    expect(SPRING_OMEGA).toBeGreaterThan(8);
    expect(SPRING_OMEGA).toBeLessThan(10);
  });
});

describe("springStep", () => {
  it("comes back from the cap within 0.5px by 350ms, and stays", () => {
    const path = run({ x: MAX_LAG_PX, v: 0 }, 1000 / 60, 2000);
    for (const { t, x } of path) {
      if (t >= SETTLE_MS)
        expect(Math.abs(x)).toBeLessThanOrEqual(SETTLE_WITHIN_PX);
    }
    // Still farther a frame or two before: it is not faster than asked.
    const early = path.find(({ t }) => t >= SETTLE_MS - 40)!;
    expect(Math.abs(early.x)).toBeGreaterThan(SETTLE_WITHIN_PX);
  });

  it("passes its rest by about 1.5% of where it let go from, once", () => {
    const path = run({ x: MAX_LAG_PX, v: 0 }, 1, 3000);
    const lowest = Math.min(...path.map(({ x }) => x));
    expect(-lowest / MAX_LAG_PX).toBeGreaterThan(0.014);
    expect(-lowest / MAX_LAG_PX).toBeLessThan(0.016);
    // The swing back after that is too small to see.
    const after = path.filter(({ t }) => t > 1200);
    expect(Math.max(...after.map(({ x }) => Math.abs(x)))).toBeLessThan(0.01);
  });

  it("takes any frame interval to the same place: no blow-up, no jitter", () => {
    const fine = run({ x: MAX_LAG_PX, v: 0 }, 1, 1000);
    const at = (t: number) =>
      fine.find((p) => Math.abs(p.t - t) < 1e-6)?.x ?? NaN;
    for (const frame of [50, 100, 250]) {
      const coarse = run({ x: MAX_LAG_PX, v: 0 }, frame, 1000);
      for (const { t, x } of coarse) {
        expect(Math.abs(x)).toBeLessThanOrEqual(MAX_LAG_PX);
        expect(x).toBeCloseTo(at(t), 9);
      }
    }
    // Uneven frames (dropped ones among them) land where even ones do.
    let i = 0;
    const uneven = [16, 16, 120, 8, 33, 16, 250, 16];
    const jittery = run(
      { x: -4, v: 30 },
      () => uneven[i++ % uneven.length],
      1500,
    );
    const last = jittery[jittery.length - 1];
    const even = springStep({ x: -4, v: 30 }, last.t);
    expect(last.x).toBeCloseTo(even.x, 9);
    expect(Math.abs(last.x)).toBeLessThan(0.01);
  });

  it("stands still at rest and for no time", () => {
    expect(springStep({ x: 0, v: 0 }, 16)).toEqual({ x: 0, v: 0 });
    expect(springStep({ x: 3, v: 2 }, 0)).toEqual({ x: 3, v: 2 });
  });

  it("settles under any damping ratio, should the constant change", () => {
    for (const zeta of [0.5, 1, 1.5]) {
      let s: SpringState = { x: MAX_LAG_PX, v: 0 };
      for (let t = 0; t < 3000; t += 16) s = springStep(s, 16, 9, zeta);
      expect(Math.abs(s.x)).toBeLessThan(0.05);
    }
  });
});

describe("lagging behind the scroll", () => {
  it("lags by the distance from the anchor over half the viewport, at most all", () => {
    expect(lagShare(0, 600)).toBe(0);
    expect(lagShare(150, 600)).toBe(0.5);
    expect(lagShare(300, 600)).toBe(1);
    expect(lagShare(900, 600)).toBe(1);
    expect(lagShare(-20, 600)).toBe(0);
    expect(lagShare(100, 0)).toBe(0);
  });

  it("measures the distance to the row's nearer edge; on it, none", () => {
    expect(anchorDistance(100, 140, 120)).toBe(0);
    expect(anchorDistance(100, 140, 60)).toBe(40);
    expect(anchorDistance(100, 140, 200)).toBe(60);
  });

  it("lags the way the content does not move: down when it scrolls up", () => {
    expect(lag({ x: 0, v: 0 }, 0.5, 4, 1)).toEqual({ x: 2, v: 0 });
    expect(lag({ x: 0, v: 5 }, 1, -3, 1)).toEqual({ x: -3, v: 5 });
  });

  it("takes LAG_GAIN of the move by default: the far rows reach 6px at FULL_LAG_SPEED_PX_S (ruling 201 第 8 条)", () => {
    expect(lag({ x: 0, v: 0 }, 1, 10).x).toBeCloseTo(10 * LAG_GAIN);
    // Scrolling steadily, the spring's pull matches the lag at
    // g·u·2ζ/ω: MAX_LAG_PX at the full speed, a quarter of it at a
    // quarter of the speed.
    const settled = (speed: number) => {
      let s = { x: 0, v: 0 };
      for (let i = 0; i < 300; i++) {
        s = springStep(s, 16);
        s = lag(s, 1, (speed * 16) / 1000);
      }
      return s.x;
    };
    expect(settled(FULL_LAG_SPEED_PX_S)).toBeCloseTo(MAX_LAG_PX, 0);
    expect(settled(FULL_LAG_SPEED_PX_S / 4)).toBeCloseTo(MAX_LAG_PX / 4, 0);
  });

  it("stops at 6px, and held there stops moving", () => {
    expect(lag({ x: 5, v: -20 }, 1, 40, 1)).toEqual({ x: MAX_LAG_PX, v: 0 });
    expect(lag({ x: -5, v: 20 }, 1, -40, 1)).toEqual({
      x: -MAX_LAG_PX,
      v: 0,
    });
  });

  it("finds the row the anchor is on, else the nearest", () => {
    const tops = [0, 50, 100];
    const bottoms = [40, 90, 140];
    expect(anchorIndex(tops, bottoms, 60)).toBe(1);
    expect(anchorIndex(tops, bottoms, 95)).toBe(1);
    expect(anchorIndex(tops, bottoms, 500)).toBe(2);
    expect(anchorIndex([], [], 10)).toBe(-1);
  });
});

describe("holdNeighbours: two rows at most 2px out of step", () => {
  it("ramps out from the anchor's row", () => {
    const held = holdNeighbours(
      [6, 6, 0, 6, 6, 6].map((x, i) => ({ x, v: [1, 2, 9, 4, 5, 6][i] })),
      2,
    );
    expect(held.map((s) => s.x)).toEqual([4, 2, 0, 2, 4, 6]);
    // Held rows move with the row they are held to; the free one keeps
    // its own speed.
    expect(held.map((s) => s.v)).toEqual([9, 9, 9, 9, 9, 6]);
  });

  it("lets a ramp go back within the settling time, out from the anchor", () => {
    // The anchor's neighbour on its way in already (it lagged a little
    // and kept moving), the rest held on the ramp at rest.
    let states = [6, 6, 4, 2, 0].map((x) => ({ x, v: 0 }));
    states[3] = { x: 1.2, v: -8 };
    states = holdNeighbours(states, 4);
    for (let t = 16; t <= 2000; t += 16) {
      states = holdNeighbours(
        states.map((s) => springStep(s, 16)),
        4,
      );
      if (t >= SETTLE_MS + 16) {
        for (const s of states) {
          expect(Math.abs(s.x)).toBeLessThanOrEqual(SETTLE_WITHIN_PX);
        }
      }
    }
  });

  it("holds either way", () => {
    const held = holdNeighbours(
      [-6, 0, 5].map((x) => ({ x, v: 0 })),
      1,
    );
    expect(held.map((s) => s.x)).toEqual([-2, 0, 2]);
  });

  it("leaves rows within the step alone", () => {
    const states = [1, 2.5, 4, 5.5].map((x) => ({ x, v: 1 }));
    expect(holdNeighbours(states, 0)).toEqual(states);
    expect(holdNeighbours([], 0)).toEqual([]);
  });
});

describe("paintedOffsets: on the device's pixels, still within the caps", () => {
  it("puts each on the pixel grid", () => {
    expect(paintedOffsets([0.2, 1.3, 2.74], 0, 2)).toEqual([0, 1.5, 2.5]);
    expect(paintedOffsets([-0.2, -1.3, -2.74], 0, 2)).toEqual([0, -1.5, -2.5]);
    expect(paintedOffsets([0.4, 1.6, 2.5], 0, 1)).toEqual([0, 2, 3]);
  });

  it("never paints past 6px or 2px apart, whatever the ratio", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (let seed = 0; seed < 200; seed++) {
        // Offsets the physics allows: within 6px, neighbours within 2px.
        const xs = [0];
        for (let i = 1; i < 10; i++) {
          const step = (((seed * 7 + i * 13) % 41) / 10 - 2) * 0.999;
          xs.push(Math.max(-6, Math.min(6, xs[i - 1] + step)));
        }
        const painted = paintedOffsets(xs, seed % 10, dpr);
        for (let i = 0; i < painted.length; i++) {
          expect(Math.abs(painted[i])).toBeLessThanOrEqual(MAX_LAG_PX);
          // On the grid.
          expect(painted[i] * dpr).toBeCloseTo(Math.round(painted[i] * dpr), 9);
          if (i > 0) {
            expect(Math.abs(painted[i] - painted[i - 1])).toBeLessThanOrEqual(
              MAX_NEIGHBOUR_STEP_PX + 1e-9,
            );
          }
        }
      }
    }
  });
});

describe("the landing push (ticket 151's way in)", () => {
  it("carries a row at rest the asked distance past its place", () => {
    expect(kickPeak(kickVelocity(1.5))).toBeCloseTo(1.5, 2);
    expect(kickPeak(kickVelocity(-1))).toBeCloseTo(-1, 2);
  });

  it("never past 1.5px", () => {
    expect(kickVelocity(4)).toBeCloseTo(kickVelocity(MAX_KICK_PX), 9);
    expect(kickVelocity(-4)).toBeCloseTo(kickVelocity(-MAX_KICK_PX), 9);
    expect(kickVelocity(0)).toBe(0);
  });

  it("is back about as soon as a scroll's lag", () => {
    let s: SpringState = { x: 0, v: kickVelocity(-MAX_KICK_PX) };
    let t = 0;
    while (!atRest(s) && t < 2000) {
      s = springStep(s, 1);
      t += 1;
    }
    expect(t).toBeLessThan(500);
  });
});

describe("whose scroll (ruling 201 第 3 条)", () => {
  const input = { until: 1_000, scrollbar: false, selecting: false };

  it("is the person's for a while after their wheel, touch or key", () => {
    expect(humanScroll(input, 900)).toBe(true);
    expect(humanScroll(input, 1_000)).toBe(true);
    expect(humanScroll(input, 1_001)).toBe(false);
  });

  it("is theirs while they hold the scrollbar", () => {
    expect(humanScroll({ ...input, until: 0, scrollbar: true }, 5_000)).toBe(
      true,
    );
  });

  it("is not while a press in the content selects text", () => {
    expect(humanScroll({ ...input, selecting: true }, 900)).toBe(false);
    expect(
      humanScroll({ ...input, scrollbar: true, selecting: true }, 900),
    ).toBe(false);
  });
});

describe("atRest", () => {
  it("is close and slow", () => {
    expect(atRest({ x: 0.2, v: 5 })).toBe(true);
    expect(atRest({ x: 0.3, v: 0 })).toBe(false);
    expect(atRest({ x: 0, v: 30 })).toBe(false);
  });
});
