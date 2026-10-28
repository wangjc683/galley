import { describe, expect, it } from "vitest";

import type { FreshCard } from "@/lib/fresh-cards";

import {
  FLIGHT_EASE,
  FLIGHT_END_PX,
  FLIGHT_FADE_MS,
  FLIGHT_LEVEL,
  FLIGHT_START_PX,
  FLIGHT_STAGGER_MS,
  cardFlightPlan,
  catchDip,
  cubicBezier,
  flightFrame,
  flightSchedule,
  type CardFlightInput,
  type FlightLevel,
} from "./todo-flight";

/**
 * A card's glyph flying into the top bar's 「待办」 button (main chat
 * ticket 102, PRD ruling 147 point 6): whether anything flies or pops,
 * when, and where a glyph is at each moment — fly and pop at the middle
 * size since ticket 104 (ruling 149 point 1). The DOM half is
 * lib/todo-flight-run.test.ts.
 */

// Ticket 102's big level, `sidebar-state-pop`'s pop: only to pin the
// path's and the dip's arithmetic against another size.
const BIG: FlightLevel = {
  lift: 160,
  peak: 24,
  durationMs: 700,
  popScale: 1.25,
};

const T: FreshCard = { kind: "todo", row: "todo_a", card: "todo_a" };
const R: FreshCard = { kind: "reminder", row: "sched_a", card: "sched_a" };
const M: FreshCard = { kind: "memo", row: "memo_1", card: "11" };

describe("whether the new cards fly", () => {
  const BASE: CardFlightInput = {
    fresh: [T, R, M],
    mainChatOnScreen: true,
    panelShown: false,
    reducedMotion: false,
    inView: () => true,
  };

  it("flies every new card in view, the button popping", () => {
    expect(cardFlightPlan(BASE)).toEqual({ fly: [T, R, M], catch: "pop" });
  });

  it("does not fly while the panel is on screen: its rows light instead", () => {
    expect(cardFlightPlan({ ...BASE, panelShown: true })).toBeNull();
    expect(
      cardFlightPlan({ ...BASE, panelShown: true, reducedMotion: true }),
    ).toBeNull();
  });

  it("does nothing unless Galley's conversation is on screen, or without a card", () => {
    expect(cardFlightPlan({ ...BASE, mainChatOnScreen: false })).toBeNull();
    expect(cardFlightPlan({ ...BASE, fresh: [] })).toBeNull();
  });

  it("does not fly a card scrolled out of view; with none in view, only pops", () => {
    expect(
      cardFlightPlan({ ...BASE, inView: (card) => card.kind !== "reminder" }),
    ).toEqual({ fly: [T, M], catch: "pop" });
    expect(cardFlightPlan({ ...BASE, inView: () => false })).toEqual({
      fly: [],
      catch: "pop",
    });
  });

  it("under reduced motion flies nothing and scales nothing: the ground washes", () => {
    expect(cardFlightPlan({ ...BASE, reducedMotion: true })).toEqual({
      fly: [],
      catch: "wash",
    });
  });
});

describe("the size JC picked (ruling 149 point 1)", () => {
  it("is ticket 102's middle level: 100px up, 20px halfway, 560ms, a pop to 1.15", () => {
    expect(FLIGHT_LEVEL).toEqual({
      lift: 100,
      peak: 20,
      durationMs: 560,
      popScale: 1.15,
    });
  });
});

describe("when", () => {
  it("takes off 90ms apart and pops as the last lands", () => {
    expect(flightSchedule(3, FLIGHT_LEVEL)).toEqual({
      starts: [0, FLIGHT_STAGGER_MS, 2 * FLIGHT_STAGGER_MS],
      popAt: 2 * FLIGHT_STAGGER_MS + 560,
    });
    expect(flightSchedule(1, BIG)).toEqual({ starts: [0], popAt: 700 });
  });

  it("pops at once when nothing flies", () => {
    expect(flightSchedule(0, FLIGHT_LEVEL)).toEqual({ starts: [], popAt: 0 });
  });

  it("dips after the pop in proportion: 1.15 to 0.976, 1.25 to 0.96", () => {
    expect(catchDip(FLIGHT_LEVEL.popScale)).toBe(0.976);
    expect(catchDip(BIG.popScale)).toBe(0.96);
  });
});

describe("the path", () => {
  const from = { x: 400, y: 700 };
  const to = { x: 1200, y: 20 };

  it("eases as --ease-exit: from 0 to 1, gathering speed", () => {
    expect(FLIGHT_EASE).toEqual([0.4, 0, 1, 1]);
    const ease = cubicBezier(...FLIGHT_EASE);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map(ease);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    // Slow off the card, fast into the button.
    expect(ease(0.5)).toBeLessThan(0.5);
    expect(ease(0.9) - ease(0.8)).toBeGreaterThan(ease(0.2) - ease(0.1));
    // A linear curve is the identity.
    expect(cubicBezier(0.25, 0.25, 0.75, 0.75)(0.3)).toBeCloseTo(0.3, 5);
  });

  it("leaves the card glyph's centre at 16px and lands on the button's at 12px, faded", () => {
    expect(flightFrame(from, to, FLIGHT_LEVEL, 0)).toEqual({
      x: 400,
      y: 700,
      size: FLIGHT_START_PX,
      opacity: 1,
    });
    const end = flightFrame(from, to, FLIGHT_LEVEL, 560);
    expect(end.x).toBeCloseTo(1200, 6);
    expect(end.y).toBeCloseTo(20, 6);
    expect(end.size).toBeCloseTo(FLIGHT_END_PX, 6);
    expect(end.opacity).toBe(0);
  });

  it("arcs through the midpoint lifted by the level, at the peak size there", () => {
    // The moment the eased progress is one half.
    const ease = cubicBezier(...FLIGHT_EASE);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (ease(mid) < 0.5) lo = mid;
      else hi = mid;
    }
    for (const level of [FLIGHT_LEVEL, BIG]) {
      const half = flightFrame(from, to, level, lo * level.durationMs);
      // B(½) = ¼ from + ½ control + ¼ to, the control the midpoint lifted.
      expect(half.x).toBeCloseTo(800, 3);
      expect(half.y).toBeCloseTo(360 - level.lift / 2, 3);
      expect(half.size).toBeCloseTo(level.peak, 3);
    }
  });

  it("is opaque until the last 80ms", () => {
    const at = (ms: number) => flightFrame(from, to, FLIGHT_LEVEL, ms);
    expect(at(560 - FLIGHT_FADE_MS).opacity).toBe(1);
    expect(at(560 - FLIGHT_FADE_MS / 2).opacity).toBe(0.5);
  });
});
