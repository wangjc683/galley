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
  waitingAskUser: boolean;
}

/**
 * Whether MainView shows the step-limit thread tail: only while the
 * session idles and nothing else signals activity.
 */
export function stepLimitTailVisible(input: StepLimitTailInput): boolean {
  return input.pausedAtStepLimit && !input.isRunning && !input.waitingAskUser;
}
