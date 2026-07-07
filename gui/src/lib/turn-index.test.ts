import { describe, expect, it } from "vitest";

import { makeMessageStepper, resolveAbsoluteTurnIndex } from "@/lib/turn-index";

describe("resolveAbsoluteTurnIndex", () => {
  it("prefers Core's authoritative absoluteTurnIndex", () => {
    expect(resolveAbsoluteTurnIndex({ turnIndex: 1, absoluteTurnIndex: 42 }, 7)).toBe(42);
  });

  it("falls back to step + offset when the absolute index is absent", () => {
    expect(resolveAbsoluteTurnIndex({ turnIndex: 1 }, 7)).toBe(8);
    expect(resolveAbsoluteTurnIndex({ turnIndex: 3, absoluteTurnIndex: null }, 7)).toBe(10);
  });
});

describe("makeMessageStepper", () => {
  it("maps absolute indices back to per-message steps", () => {
    const stepper = makeMessageStepper();
    stepper.onUserRow(5);
    expect(stepper.stepFor(5)).toBe(1);
    expect(stepper.stepFor(6)).toBe(2);
  });

  it("returns the absolute index defensively before any user row", () => {
    const stepper = makeMessageStepper();
    expect(stepper.stepFor(4)).toBe(4);
  });

  it("resets the block base on each user row", () => {
    const stepper = makeMessageStepper();
    stepper.onUserRow(5);
    expect(stepper.stepFor(6)).toBe(2);
    stepper.onUserRow(7);
    expect(stepper.stepFor(7)).toBe(1);
    expect(stepper.stepFor(8)).toBe(2);
  });
});

describe("round-trip: forward then inverse is identity", () => {
  it("recovers every GA step after persisting under the absolute index", () => {
    // A session already holding `offset` completed turns. The user sends a
    // message; GA emits steps 1..n. Forward resolves each to an absolute
    // index (no Core value — exercise the fallback); restore maps them back
    // to the original steps.
    for (const offset of [0, 1, 7, 100]) {
      const base = offset + 1; // the user row's absolute turn_index
      const stepper = makeMessageStepper();
      stepper.onUserRow(base);
      for (let step = 1; step <= 5; step++) {
        const absolute = resolveAbsoluteTurnIndex({ turnIndex: step }, offset);
        expect(absolute).toBe(step + offset);
        expect(stepper.stepFor(absolute)).toBe(step);
      }
    }
  });

  it("keeps two consecutive user messages' step-1 rows distinct", () => {
    // The bug the offset prevents: without distinct absolute indices, both
    // messages' step-1 assistant rows share `msg_${sid}_1_assistant` and the
    // second silently overwrites the first on ON CONFLICT UPDATE.
    const firstMessageStep1 = resolveAbsoluteTurnIndex({ turnIndex: 1 }, 0);
    const secondMessageStep1 = resolveAbsoluteTurnIndex({ turnIndex: 1 }, 1);
    expect(firstMessageStep1).not.toBe(secondMessageStep1);
  });
});
