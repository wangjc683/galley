// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { msUntilNextLocalMidnight, useDayStamp } from "./useDayStamp";

/**
 * The day stamp under a zone with a 25-hour day: New York's DST ends on
 * 2026-11-01, so that local day runs from 00:00 EDT to 00:00 EST, 25
 * hours. A `+24h` rollover fires at 23:00 the same day, finds the same
 * stamp, and (re-arming only on a changed stamp) never fires again.
 *
 * Node applies a `TZ` assigned at runtime to later `Date` calls; the
 * first test pins that, so the rest cannot pass in a zone without DST.
 */

const HOUR = 60 * 60 * 1000;
const ZONE = "America/New_York";
let savedTz: string | undefined;

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = ZONE;
});

afterEach(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("msUntilNextLocalMidnight", () => {
  it("runs in a zone whose 2026-11-01 is 25 hours long", () => {
    expect(
      new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime(),
    ).toBe(25 * HOUR);
  });

  it("counts the fall-back day's 25 hours from its midnight", () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 1).getTime())).toBe(
      25 * HOUR,
    );
  });

  it("reaches the next midnight from late on the fall-back day", () => {
    const at2300 = new Date(2026, 10, 1, 23, 0, 0).getTime();
    expect(msUntilNextLocalMidnight(at2300)).toBe(HOUR);
  });

  it("counts an ordinary day as 24 hours", () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 10).getTime())).toBe(
      24 * HOUR,
    );
  });
});

describe("useDayStamp", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function mountStamp(): { current: () => number } {
    let stamp = 0;
    function Probe() {
      stamp = useDayStamp();
      return null;
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Probe />));
    return { current: () => stamp };
  }

  it("keeps rolling over after a 25-hour day", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 1, 0, 0, 5));
    const stamp = mountStamp();
    expect(stamp.current()).toBe(new Date(2026, 10, 1).getTime());

    // 23:00:06 on the fall-back day: still the same day.
    act(() => vi.advanceTimersByTime(23 * HOUR + 1000));
    expect(stamp.current()).toBe(new Date(2026, 10, 1).getTime());

    // Past the real midnight, 25 hours after the day began.
    act(() => vi.advanceTimersByTime(2 * HOUR));
    expect(stamp.current()).toBe(new Date(2026, 10, 2).getTime());

    // And the next ordinary day after that.
    act(() => vi.advanceTimersByTime(24 * HOUR));
    expect(stamp.current()).toBe(new Date(2026, 10, 3).getTime());
  });
});
