import type { ImSupervisorState } from "@/lib/im-supervisor";

import type { ImCopy } from "./types";

/**
 * Auto-expansion means "something here needs your hands right now, and the
 * collapsed header can't say it": the QR to scan, the failure detail to read.
 * It deliberately excludes `not_connected` / `stopped` — those are the resting
 * state of every channel the user never adopts, so expanding them keeps two or
 * three cards permanently open and burns auto-expansion as an attention signal.
 * A collapsed row already carries the glyph, the name, and the status badge.
 *
 * This predicate reads only the supervisor state, never a not-yet-loaded config,
 * so it can't guess wrong before the fetches land: it stays false and the card
 * expands additively if the loaded state warrants it.
 */
export function shouldAutoExpand(state: ImSupervisorState) {
  return state === "waiting_scan" || state === "expired" || state === "error";
}

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

export function telegramStatusHintForState(
  state: ImSupervisorState,
  imCopy: ImCopy,
) {
  return {
    not_connected: imCopy.telegramNotConnectedHint,
    starting: imCopy.telegramStartingHint,
    waiting_scan: imCopy.telegramStartingHint,
    reconnecting: imCopy.telegramReconnectingHint,
    running: imCopy.telegramRunningHint,
    expired: imCopy.telegramErrorHint,
    error: imCopy.telegramErrorHint,
    stopped: imCopy.telegramStoppedHint,
  }[state];
}

export function discordStatusHintForState(
  state: ImSupervisorState,
  imCopy: ImCopy,
) {
  return {
    not_connected: imCopy.discordNotConnectedHint,
    starting: imCopy.discordStartingHint,
    // Same as Telegram: `waiting_scan` is the WeChat QR state and no
    // Discord bridge ever reports it. Owner pairing surfaces through the
    // pairing-code callout, not through a state hint.
    waiting_scan: imCopy.discordStartingHint,
    reconnecting: imCopy.discordReconnectingHint,
    running: imCopy.discordRunningHint,
    expired: imCopy.discordErrorHint,
    error: imCopy.discordErrorHint,
    stopped: imCopy.discordStoppedHint,
  }[state];
}
