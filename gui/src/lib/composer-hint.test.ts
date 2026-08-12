import { describe, expect, it } from "vitest";

import {
  resolveComposerHint,
  type ComposerHintState,
} from "./composer-hint";

function state(patch: Partial<ComposerHintState>): ComposerHintState {
  return {
    showFooterHint: true,
    stopMode: false,
    isStopping: false,
    hasQueuedMessages: false,
    hasText: false,
    isSideQuestion: false,
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
        }),
      ),
    ).toBeNull();
  });

  it("running + typing: Enter queues (galley#19) — the slot says so", () => {
    expect(resolveComposerHint(state({ stopMode: true, hasText: true }))).toBe(
      "queueEnterHint",
    );
  });

  it("running + /btw staged: Enter sends immediately, plain legend", () => {
    expect(
      resolveComposerHint(
        state({ stopMode: true, hasText: true, isSideQuestion: true }),
      ),
    ).toBe("enterHint");
  });

  it("running + empty draft: placeholder owns the /btw lesson, the slot keeps Shift+Enter", () => {
    expect(resolveComposerHint(state({ stopMode: true }))).toBe("newlineHint");
  });

  it("stopping with queued messages: the auto-send status outranks the legend", () => {
    expect(
      resolveComposerHint(
        state({
          stopMode: true,
          isStopping: true,
          hasQueuedMessages: true,
          hasText: true,
        }),
      ),
    ).toBe("stoppingQueueHint");
    // Stopping with nothing queued keeps the normal legends.
    expect(
      resolveComposerHint(
        state({ stopMode: true, isStopping: true, hasText: true }),
      ),
    ).toBe("queueEnterHint");
  });

  it("idle + empty draft: states the drag-to-reference capability", () => {
    // Nothing to send yet — the Enter legend would be dead weight, so
    // the slot teaches the drop capability instead. A live truth like
    // every other key here; it never retires.
    expect(resolveComposerHint(state({}))).toBe("dragToReferenceHint");
  });

  it("idle + typing: Enter hint, or the Goal-preview semantic when armed", () => {
    expect(resolveComposerHint(state({ hasText: true }))).toBe("enterHint");
    expect(resolveComposerHint(state({ effectiveGoalArmed: true }))).toBe(
      "startGoalWithEnter",
    );
    // Armed wins over the drag lesson even with an empty draft — Enter's
    // changed meaning is the more load-bearing fact.
    expect(
      resolveComposerHint(
        state({ effectiveGoalArmed: true, hasText: true }),
      ),
    ).toBe("startGoalWithEnter");
    // While running, arming is irrelevant — the running legends win.
    expect(
      resolveComposerHint(state({ stopMode: true, effectiveGoalArmed: true })),
    ).toBe("newlineHint");
  });
});
