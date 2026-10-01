import type { ExitReason } from "@/types/ipc";

/**
 * GA's per-run step cap (#29). When one run reaches it (180 steps, 100
 * in plan mode) GA stops the loop mid-work — usually right after a
 * tool step — and the bridge ends the run with
 * `exitReason.result === "MAX_TURNS_EXCEEDED"` on the final turn_end
 * and on run_complete. That end is a pause, not a finished reply: the
 * GUI swaps the "回复完成" notification title, offers "继续" as the
 * composer ghost text, and hangs a thread tail while the session idles.
 */
export function isStepLimitExit(
  exitReason: ExitReason | null | undefined,
): boolean {
  return exitReason?.result === "MAX_TURNS_EXCEEDED";
}

export interface StepLimitTailInput {
  /** messages `pausedAtStepLimit` for the session. */
  pausedAtStepLimit: boolean;
  isRunning: boolean;
  waitingApproval: boolean;
  waitingAskUser: boolean;
  /** The session has an open Goal (active / paused / blocked). */
  hasOpenGoal: boolean;
}

/**
 * Whether MainView shows the step-limit thread tail. Same idle rule as
 * GoalPausedTail (only when nothing else signals activity), and an open
 * Goal wins outright: the Goal engine continues or parks the run on its
 * own, and a parked Goal already has its own tail.
 */
export function stepLimitTailVisible(input: StepLimitTailInput): boolean {
  return (
    input.pausedAtStepLimit &&
    !input.isRunning &&
    !input.waitingApproval &&
    !input.waitingAskUser &&
    !input.hasOpenGoal
  );
}
