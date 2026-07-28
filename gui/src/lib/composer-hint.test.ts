import { describe, expect, it } from "vitest";

import {
  resolveComposerHint,
  type ComposerHintState,
} from "./composer-hint";

function state(patch: Partial<ComposerHintState>): ComposerHintState {
  return {
    showFooterHint: true,
    stopMode: false,
    hasText: false,
    isSideQuestion: false,
    showByTheWayRequiredHint: false,
    effectiveGoalArmed: false,
    ...patch,
  };
}

describe("resolveComposerHint", () => {
  it("collapses when the surface gate is off, whatever else is true", () => {
    expect(
      resolveComposerHint(
        state({
          showFooterHint: false,
          stopMode: true,
          hasText: true,
          showByTheWayRequiredHint: true,
        }),
      ),
    ).toBeNull();
  });

  it("corrects a blocked Enter with the /btw prefix lesson", () => {
    expect(
      resolveComposerHint(
        state({ showByTheWayRequiredHint: true, stopMode: true, hasText: true }),
      ),
    ).toBe("byTheWayPrefixHint");
  });

  it("drops the correction once /btw is staged — Enter is live again", () => {
    expect(
      resolveComposerHint(
        state({
          showByTheWayRequiredHint: true,
          stopMode: true,
          hasText: true,
          isSideQuestion: true,
        }),
      ),
    ).toBe("enterHint");
  });

  it("running + empty draft: placeholder owns the /btw lesson, the slot keeps Shift+Enter", () => {
    expect(resolveComposerHint(state({ stopMode: true }))).toBe("newlineHint");
  });

  it("running + typing: pre-empts the block by stating what Enter needs", () => {
    expect(resolveComposerHint(state({ stopMode: true, hasText: true }))).toBe(
      "byTheWaySendHint",
    );
  });

  it("idle: plain Enter hint, or the Goal-preview semantic when armed", () => {
    expect(resolveComposerHint(state({}))).toBe("enterHint");
    expect(resolveComposerHint(state({ effectiveGoalArmed: true }))).toBe(
      "startGoalWithEnter",
    );
    // While running, arming is irrelevant — the stop gate wins.
    expect(
      resolveComposerHint(state({ stopMode: true, effectiveGoalArmed: true })),
    ).toBe("newlineHint");
  });
});
