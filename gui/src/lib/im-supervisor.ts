import { invoke } from "@tauri-apps/api/core";

export type ImSupervisorState =
  | "not_connected"
  | "starting"
  | "waiting_scan"
  | "reconnecting"
  | "running"
  | "expired"
  | "error"
  | "stopped";

export type ImSupervisorPlatform =
  | "wechat"
  | "feishu"
  | "telegram"
  | "discord";

export interface ImSupervisorStatus {
  platform: ImSupervisorPlatform;
  state: ImSupervisorState;
  enabled: boolean;
  pid?: number | null;
  botId?: string | null;
  qrImagePath?: string | null;
  lastError?: string | null;
  modelConfigRevision?: string | null;
  modelConfigStale: boolean;
  /** Owner-paired channels (Feishu / Telegram / Discord): the bound
   * owner's id (Feishu open_id / Telegram user id / Discord snowflake —
   * the bot answers only them). */
  ownerOpenId?: string | null;
  /** Owner-paired channels: pairing code while running unbound — DM it
   * to bind. */
  bindCode?: string | null;
  updatedAt: string;
}

export interface FeishuImConfig {
  appId: string;
  hasAppSecret: boolean;
  updatedAt?: string | null;
  ownerOpenId?: string | null;
  ownerBoundAt?: string | null;
}

export interface SaveFeishuImConfigInput {
  appId: string;
  appSecret?: string | null;
}

export function getImSupervisorStatus(platform: ImSupervisorPlatform) {
  return invoke<ImSupervisorStatus>("get_im_supervisor_status", { platform });
}

export function startImSupervisor(
  platform: ImSupervisorPlatform,
  relogin = false,
) {
  return invoke<ImSupervisorStatus>("start_im_supervisor", {
    platform,
    relogin,
  });
}

export function stopImSupervisor(platform: ImSupervisorPlatform) {
  return invoke<ImSupervisorStatus>("stop_im_supervisor", { platform });
}

export function logoutImSupervisor(platform: ImSupervisorPlatform) {
  return invoke<ImSupervisorStatus>("logout_im_supervisor", { platform });
}

export function restartEnabledImSupervisors() {
  return invoke<ImSupervisorStatus[]>("restart_enabled_im_supervisors");
}

export function getFeishuImConfig() {
  return invoke<FeishuImConfig>("get_feishu_im_config");
}

export function saveFeishuImConfig(input: SaveFeishuImConfigInput) {
  return invoke<FeishuImConfig>("save_feishu_im_config", { input });
}

export function deleteFeishuImConfig() {
  return invoke<FeishuImConfig>("delete_feishu_im_config");
}

/**
 * Unpair the Feishu owner. If the bot is running it restarts locked with
 * a fresh pairing code; the returned status carries that code.
 */
export function unbindFeishuImOwner() {
  return invoke<ImSupervisorStatus>("unbind_feishu_im_owner");
}

export interface TelegramImConfig {
  hasBotToken: boolean;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  ownerBoundAt?: string | null;
}

export interface SaveTelegramImConfigInput {
  /** Blank / undefined keeps the already-saved token (never echoed back). */
  botToken?: string | null;
}

export function getTelegramImConfig() {
  return invoke<TelegramImConfig>("get_telegram_im_config");
}

export function saveTelegramImConfig(input: SaveTelegramImConfigInput) {
  return invoke<TelegramImConfig>("save_telegram_im_config", { input });
}

export function deleteTelegramImConfig() {
  return invoke<TelegramImConfig>("delete_telegram_im_config");
}

/**
 * Unpair the Telegram owner. Same semantics as the Feishu unbind: a live
 * bot restarts locked with a fresh pairing code in the returned status.
 */
export function unbindTelegramImOwner() {
  return invoke<ImSupervisorStatus>("unbind_telegram_im_owner");
}

export interface DiscordImConfig {
  hasBotToken: boolean;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  ownerBoundAt?: string | null;
}

export interface SaveDiscordImConfigInput {
  /** Blank / undefined keeps the already-saved token (never echoed back). */
  botToken?: string | null;
}

export function getDiscordImConfig() {
  return invoke<DiscordImConfig>("get_discord_im_config");
}

export function saveDiscordImConfig(input: SaveDiscordImConfigInput) {
  return invoke<DiscordImConfig>("save_discord_im_config", { input });
}

export function deleteDiscordImConfig() {
  return invoke<DiscordImConfig>("delete_discord_im_config");
}

/**
 * Unpair the Discord owner. Same semantics as the Telegram unbind: a live
 * bot restarts locked with a fresh pairing code in the returned status,
 * and the code is only accepted in a DM (server channels only activate).
 */
export function unbindDiscordImOwner() {
  return invoke<ImSupervisorStatus>("unbind_discord_im_owner");
}

/**
 * Collapse several per-channel supervisor states into the single state for
 * the aggregate indicator. Severity-ordered: any `error`/`expired` surfaces
 * as `error`, then a pending scan, then a transitional `starting`/
 * `reconnecting`, then `running`, then `stopped`; nullish channels are
 * ignored. Returns null when no channel reports a state.
 */
export function aggregateChannelsState(
  states: Array<ImSupervisorState | null | undefined>,
): ImSupervisorState | null {
  const present = states.filter(Boolean) as ImSupervisorState[];
  if (present.some((state) => state === "error" || state === "expired")) {
    return "error";
  }
  if (present.includes("waiting_scan")) return "waiting_scan";
  if (present.some((state) => state === "starting" || state === "reconnecting")) {
    return "starting";
  }
  if (present.includes("running")) return "running";
  if (present.includes("stopped")) return "stopped";
  return present[0] ?? null;
}
