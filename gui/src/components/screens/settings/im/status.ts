import type { ImSupervisorState } from "@/lib/im-supervisor";

import type { ImCopy } from "./types";

export function stepsForState(state: ImSupervisorState, imCopy: ImCopy) {
  if (state === "running") return imCopy.connectedSteps;
  return imCopy.setupSteps;
}

export function statusHintForState(state: ImSupervisorState, imCopy: ImCopy) {
  return {
    not_connected: imCopy.notConnectedHint,
    starting: imCopy.startingHint,
    waiting_scan: imCopy.waitingScanHint,
    reconnecting: imCopy.startingHint,
    running: imCopy.runningHint,
    expired: imCopy.expiredHint,
    error: imCopy.errorHint,
    stopped: imCopy.stoppedHint,
  }[state];
}

export function feishuStatusHintForState(
  state: ImSupervisorState,
  imCopy: ImCopy,
) {
  return {
    not_connected: imCopy.feishuNotConnectedHint,
    starting: imCopy.feishuStartingHint,
    waiting_scan: imCopy.feishuStartingHint,
    reconnecting: imCopy.feishuReconnectingHint,
    running: imCopy.feishuRunningHint,
    expired: imCopy.feishuErrorHint,
    error: imCopy.feishuErrorHint,
    stopped: imCopy.feishuStoppedHint,
  }[state];
}
