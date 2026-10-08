import type { SettingsStatusTone } from "@/components/screens/settings/settings-badges";
import type {
  ImSupervisorPlatform,
  ImSupervisorState,
  ImSupervisorStatus,
} from "@/lib/im-supervisor";

import type { ImCopy } from "./types";

/**
 * View decisions shared by the four Settings → Channels cards and the
 * topbar Channels menu (2026-10-08 Channels pass, D1 / D2), so both say
 * the same word for the same state.
 *
 * "Set up" means the channel finished its one-time setup and only needs
 * running, not configuring:
 *
 *   - Feishu / Telegram / Discord: an owner is paired. Core puts the bound
 *     id on every status (`owner_open_id`, read from the config pref even
 *     while stopped), and the cards also hold it in their loaded config.
 *   - WeChat: it holds a login token. Core derives `not_connected` without
 *     one; `waiting_scan` means a fresh scan is under way and `expired`
 *     means the token is gone, so neither counts.
 *
 * A credential alone (App Secret / Bot Token saved, nobody paired) is not
 * set up: the user still has steps to do, so the card keeps the
 * onboarding view.
 */
export function isChannelSetUp(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  ownerId: string | null | undefined,
): boolean {
  if (platform === "wechat") {
    return (
      state !== "not_connected" &&
      state !== "waiting_scan" &&
      state !== "expired"
    );
  }
  return Boolean(ownerId?.trim());
}

export function isChannelStatusSetUp(status: ImSupervisorStatus): boolean {
  return isChannelSetUp(status.platform, status.state, status.ownerOpenId);
}

/**
 * The run-state word on a card badge and in the topbar menu row.
 * `running` splits by setup: a paired channel is 「已接入」; Feishu
 * running before pairing is 「服务已启动」, because its Open Platform half
 * (long connection, events, publishing) is still to do and setup step 3
 * points at that word. Telegram / Discord `running` means the platform
 * accepted the token, so they read 「已接入」 either way. `stopped` splits
 * the same way: 「已暂停」 after setup, 「未启动」 for a saved credential
 * never started.
 */
export type ChannelBadgeKind =
  | "not_connected"
  | "not_started"
  | "starting"
  | "waiting_scan"
  | "reconnecting"
  | "connected"
  | "service_started"
  | "paused"
  | "expired"
  | "error";

export function channelBadgeKind(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  setUp: boolean,
): ChannelBadgeKind {
  switch (state) {
    case "running":
      return platform === "feishu" && !setUp ? "service_started" : "connected";
    case "stopped":
      return setUp ? "paused" : "not_started";
    default:
      return state;
  }
}

export function channelStatusBadgeKind(
  status: ImSupervisorStatus,
): ChannelBadgeKind {
  return channelBadgeKind(
    status.platform,
    status.state,
    isChannelStatusSetUp(status),
  );
}

export function channelBadgeLabel(
  kind: ChannelBadgeKind,
  imCopy: ImCopy,
): string {
  return {
    not_connected: imCopy.notConnected,
    not_started: imCopy.notStarted,
    starting: imCopy.starting,
    waiting_scan: imCopy.waitingScan,
    reconnecting: imCopy.reconnecting,
    connected: imCopy.running,
    service_started: imCopy.feishuServiceStarted,
    paused: imCopy.stopped,
    expired: imCopy.expired,
    error: imCopy.error,
  }[kind];
}

/**
 * One colour map for the card badge and the topbar menu word: connected
 * green, failures red, a QR waiting for a scan amber (it needs your phone
 * now), everything else neutral ink.
 */
export function channelBadgeTone(kind: ChannelBadgeKind): SettingsStatusTone {
  if (kind === "connected" || kind === "service_started") return "success";
  if (kind === "error" || kind === "expired") return "error";
  if (kind === "waiting_scan") return "warning";
  return "neutral";
}

/**
 * Which body a card renders:
 *
 *   - `onboarding` — not set up: setup steps, the credential form, start.
 *   - `configured` — set up but not running: status, error, one primary
 *     action (resume / retry / working), the form and steps folded away.
 *   - `running` — set up (or Telegram / Discord running before pairing,
 *     where the pairing-code callout is the next step): status, commands,
 *     owner row or pairing code, the security note.
 *   - `feishu_first_run` — Feishu running before pairing: sections 4–6
 *     happen now, so the guide stays open instead of folding (D5).
 */
export type ChannelCardView =
  | "onboarding"
  | "configured"
  | "running"
  | "feishu_first_run";

export function channelCardView(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  setUp: boolean,
): ChannelCardView {
  if (state === "running") {
    return platform === "feishu" && !setUp ? "feishu_first_run" : "running";
  }
  return setUp ? "configured" : "onboarding";
}

/** The configured view's one primary action. */
export type ChannelPrimaryAction = "resume" | "retry" | "working";

export function configuredPrimaryAction(
  state: ImSupervisorState,
): ChannelPrimaryAction | null {
  switch (state) {
    case "stopped":
      return "resume";
    case "error":
    case "expired":
      return "retry";
    case "starting":
    case "reconnecting":
    case "waiting_scan":
      return "working";
    default:
      return null;
  }
}

/**
 * In a failed state the error block is the status line: its title is the
 * localized reason (or the state's own hint when the reason is unknown),
 * so the plain hint above it would say the same thing twice.
 */
export function errorReplacesStatusHint(
  state: ImSupervisorState,
  errorText: string | null | undefined,
): boolean {
  return Boolean(errorText) && (state === "error" || state === "expired");
}

/** "Pause receiving" works in every enabled state: Core's stop does not
 * look at the run state, and a channel stuck reconnecting or failing on
 * every launch must be stoppable without deleting its credentials. */
export function canPauseChannel(
  status: ImSupervisorStatus | null | undefined,
): boolean {
  return Boolean(status?.enabled);
}

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

export interface ChannelCommand {
  command: string;
  description: string;
}

/**
 * The text-command table. Every channel shares one core set; Telegram's
 * `/llm` opens a button menu (so it lists *and* switches), and Discord
 * leads with its two channel commands (activation is per channel there).
 */
export function channelCommands(
  platform: ImSupervisorPlatform,
  imCopy: ImCopy,
): ChannelCommand[] {
  const core = imCopy.textCommands.map((item) =>
    platform === "telegram" && item.command === "/llm"
      ? { ...item, description: imCopy.telegramLlmCommandDescription }
      : item,
  );
  return platform === "discord"
    ? [...imCopy.discordChannelCommands, ...core]
    : core;
}
