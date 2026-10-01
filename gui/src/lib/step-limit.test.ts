import { describe, expect, it } from "vitest";

import {
  isStepLimitExit,
  stepLimitTailVisible,
  type StepLimitTailInput,
} from "@/lib/step-limit";

describe("isStepLimitExit", () => {
  it("is true only for MAX_TURNS_EXCEEDED", () => {
    expect(
      isStepLimitExit({
        result: "MAX_TURNS_EXCEEDED",
        data: { maxTurns: 100 },
      }),
    ).toBe(true);
    expect(isStepLimitExit({ result: "CURRENT_TASK_DONE", data: null })).toBe(
      false,
    );
    expect(isStepLimitExit({ result: "DONE_WITHOUT_EXIT", data: null })).toBe(
      false,
    );
    expect(isStepLimitExit(null)).toBe(false);
    expect(isStepLimitExit(undefined)).toBe(false);
  });
});

describe("stepLimitTailVisible", () => {
  const idle: StepLimitTailInput = {
    pausedAtStepLimit: true,
    isRunning: false,
    waitingApproval: false,
    waitingAskUser: false,
    hasOpenGoal: false,
  };

  it("shows for an idle session whose latest run hit the cap", () => {
    expect(stepLimitTailVisible(idle)).toBe(true);
  });

  it("hides when the latest run did not hit the cap", () => {
    expect(stepLimitTailVisible({ ...idle, pausedAtStepLimit: false })).toBe(
      false,
    );
  });

  it("hides while anything else signals activity", () => {
    expect(stepLimitTailVisible({ ...idle, isRunning: true })).toBe(false);
    expect(stepLimitTailVisible({ ...idle, waitingApproval: true })).toBe(
      false,
    );
    expect(stepLimitTailVisible({ ...idle, waitingAskUser: true })).toBe(false);
  });

  it("yields to an open Goal", () => {
    expect(stepLimitTailVisible({ ...idle, hasOpenGoal: true })).toBe(false);
  });
});
