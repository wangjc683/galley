import { describe, expect, it } from "vitest";

import {
  contextUsagePercentLabel,
  contextUsageTokens,
  formatCompactCount,
  formatElapsedCompact,
  telemetryCachedInput,
  telemetryInputTotal,
} from "@/lib/telemetry";

describe("telemetry formatting", () => {
  it("formats elapsed durations without clock-like colons", () => {
    expect(formatElapsedCompact(15_900)).toBe("15s");
    expect(formatElapsedCompact(135_000)).toBe("2m15s");
    expect(formatElapsedCompact(3_900_000)).toBe("1h05m");
  });

  it("formats compact counts", () => {
    expect(formatCompactCount(999)).toBe("999");
    expect(formatCompactCount(1_200)).toBe("1.2k");
    expect(formatCompactCount(126_000)).toBe("126k");
    expect(formatCompactCount(1_500_000)).toBe("1.5m");
  });

  it("adds cache tokens to the displayed input total", () => {
    expect(
      telemetryInputTotal({
        inputTokens: 10,
        cacheCreateTokens: 20,
        cacheReadTokens: 30,
      }),
    ).toBe(60);
  });

  it("shows the inline meter as a bare percentage", () => {
    // Absolute values are deliberately absent: the meter sits beside two
    // raw token counts, and a `126k/300k` there reads as a third token
    // number in a different unit.
    expect(
      contextUsagePercentLabel({
        contextUsedChars: 126_000,
        contextLimitChars: 300_000,
      }),
    ).toBe("42%");
  });

  it("converts the char budget back to the configured context_win", () => {
    // GA's cap is `context_win * 3` chars, so dividing by 3 recovers the
    // number the operator set in Settings — 90k here, not a raw 270k.
    expect(
      contextUsageTokens({
        contextUsedChars: 120_000,
        contextLimitChars: 270_000,
      }),
    ).toEqual({
      usedTokens: 40_000,
      limitTokens: 90_000,
      percentLabel: "44%",
    });
  });

  it("shows <1% instead of rounding a non-empty history down to 0%", () => {
    // Turn one of a real session: 177 chars of history against a 270k cap
    // rounds to 0%, which reads as a dead meter for the whole early part
    // of a conversation.
    expect(
      contextUsagePercentLabel({
        contextUsedChars: 177,
        contextLimitChars: 270_000,
      }),
    ).toBe("<1%");
    expect(
      contextUsageTokens({ contextUsedChars: 177, contextLimitChars: 270_000 })
        ?.percentLabel,
    ).toBe("<1%");
    // A genuinely empty history still reads 0%.
    expect(
      contextUsagePercentLabel({
        contextUsedChars: 0,
        contextLimitChars: 270_000,
      }),
    ).toBe("0%");
  });

  it("returns no context usage when the limit is missing or zero", () => {
    expect(contextUsagePercentLabel({ contextUsedChars: 100 })).toBeNull();
    expect(
      contextUsageTokens({ contextUsedChars: 100, contextLimitChars: 0 }),
    ).toBeNull();
    expect(contextUsageTokens(null)).toBeNull();
  });

  it("splits out cache reads but not cache creates", () => {
    // Cache reads bill at ~0.1x fresh input, so a big `↑` made of cache
    // hits is cheap; cache creates bill near parity and stay folded in.
    expect(
      telemetryCachedInput({
        inputTokens: 5_000,
        cacheCreateTokens: 18_000,
        cacheReadTokens: 95_000,
      }),
    ).toBe(95_000);
    expect(
      telemetryCachedInput({ inputTokens: 5_000, cacheCreateTokens: 18_000 }),
    ).toBeNull();
    expect(telemetryCachedInput({ cacheReadTokens: 0 })).toBeNull();
  });
});
