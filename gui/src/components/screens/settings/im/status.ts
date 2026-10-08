import type {
  ImSupervisorPlatform,
  ImSupervisorState,
} from "@/lib/im-supervisor";

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

/**
 * The card's status line. `setUp` (see `channel-view.ts`) splits two
 * states: `stopped` after setup is a pause (「已暂停接收…」), before it a
 * saved credential waiting for its first start; Feishu `running` before
 * pairing still has Open Platform sections to finish.
 *
 * `waiting_scan` / `expired` are WeChat-only and `reconnecting` never
 * comes from WeChat; the unreachable cells reuse the nearest hint
 * (Discord / Telegram fold `waiting_scan` into `starting`, OAS Channels).
 */
export function channelStatusHint(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  setUp: boolean,
  imCopy: ImCopy,
): string {
  switch (platform) {
    case "wechat":
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
    case "feishu":
      return {
        not_connected: imCopy.feishuNotConnectedHint,
        starting: imCopy.feishuStartingHint,
        waiting_scan: imCopy.feishuStartingHint,
        reconnecting: imCopy.feishuReconnectingHint,
        running: setUp
          ? imCopy.feishuRunningHint
          : imCopy.feishuRunningUnboundHint,
        expired: imCopy.feishuErrorHint,
        error: imCopy.feishuErrorHint,
        stopped: setUp ? imCopy.feishuPausedHint : imCopy.feishuStoppedHint,
      }[state];
    case "telegram":
      return {
        not_connected: imCopy.telegramNotConnectedHint,
        starting: imCopy.telegramStartingHint,
        waiting_scan: imCopy.telegramStartingHint,
        reconnecting: imCopy.telegramReconnectingHint,
        running: imCopy.telegramRunningHint,
        expired: imCopy.telegramErrorHint,
        error: imCopy.telegramErrorHint,
        stopped: setUp ? imCopy.telegramPausedHint : imCopy.telegramStoppedHint,
      }[state];
    case "discord":
      return {
        not_connected: imCopy.discordNotConnectedHint,
        starting: imCopy.discordStartingHint,
        waiting_scan: imCopy.discordStartingHint,
        reconnecting: imCopy.discordReconnectingHint,
        running: imCopy.discordRunningHint,
        expired: imCopy.discordErrorHint,
        error: imCopy.discordErrorHint,
        stopped: setUp ? imCopy.discordPausedHint : imCopy.discordStoppedHint,
      }[state];
  }
}
