import type { AppCopy } from "@/lib/i18n";
import {
  aggregateChannelsState,
  type ImSupervisorPlatform,
  type ImSupervisorState,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";

export type ChannelsIndicatorStatus =
  | "setup"
  | "idle"
  | "connected"
  | "connecting"
  | "waitingScan"
  | "needsAttention";

/**
 * A platform the user has set up. Core already encodes this in the
 * derived state (`im_supervisor/manager.rs` `derived_status`): with no
 * credentials (no WeChat `token.json`, no saved Feishu / Telegram /
 * Discord config) a stopped platform reports `not_connected`; with them,
 * `stopped`. Disconnect clears the credentials and returns to
 * `not_connected`. `enabled` (the user started it and did not stop it)
 * counts too, so a just-enabled platform is listed even in the instant
 * before its first live state. Settings → Channels uses the same signals:
 * `enabled` gates its restart button, the state drives each card badge.
 */
export function isChannelConfigured(
  status: ImSupervisorStatus | null | undefined,
): status is ImSupervisorStatus {
  return Boolean(
    status && (status.enabled || status.state !== "not_connected"),
  );
}

export function configuredChannels(
  statuses: ReadonlyArray<ImSupervisorStatus | null | undefined>,
): ImSupervisorStatus[] {
  return statuses.filter(isChannelConfigured);
}

/**
 * Topbar form. Attention states (needs attention > waiting for a scan >
 * connecting) keep their text badges and win over the lamp; otherwise the
 * lamp is lit while any configured platform runs, unlit when all are
 * paused (`idle`) or none was ever set up (`setup`).
 */
export function channelsIndicatorStatus(
  configured: ReadonlyArray<ImSupervisorStatus>,
  loadError?: string | null,
): ChannelsIndicatorStatus {
  if (loadError) return "needsAttention";
  // The aggregate already folds expired into error and reconnecting
  // into starting.
  const state = aggregateChannelsState(
    configured.map((status) => status.state),
  );
  if (state === "error") return "needsAttention";
  if (state === "waiting_scan") return "waitingScan";
  if (state === "starting") return "connecting";
  if (state === "running") return "connected";
  return configured.length > 0 ? "idle" : "setup";
}

type ImCopy = AppCopy["settings"]["im"];

export function channelPlatformLabel(
  platform: ImSupervisorPlatform,
  imCopy: ImCopy,
): string {
  return {
    wechat: imCopy.wechatTitle,
    feishu: imCopy.feishuTitle,
    telegram: imCopy.telegramTitle,
    discord: imCopy.discordTitle,
  }[platform];
}

/** Same words as the Settings → Channels card badges. */
export function channelStateLabel(
  state: ImSupervisorState,
  imCopy: ImCopy,
): string {
  return {
    not_connected: imCopy.notConnected,
    starting: imCopy.starting,
    waiting_scan: imCopy.waitingScan,
    reconnecting: imCopy.reconnecting,
    running: imCopy.running,
    expired: imCopy.expired,
    error: imCopy.error,
    stopped: imCopy.stopped,
  }[state];
}
