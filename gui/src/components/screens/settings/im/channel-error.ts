import type {
  ImSupervisorPlatform,
  ImSupervisorState,
} from "@/lib/im-supervisor";

import { channelPlatformLabel } from "./channel-view";
import type { ImCopy } from "./types";

/**
 * Channel errors by cause (2026-10-08 Channels pass, D8). `lastError` is
 * raw text from Core, the runner, or the upstream frontends — English or
 * Chinese, wrapped in prefixes like `starting managed IM supervisor
 * failed: …` — so the match is a loose, case-insensitive search for the
 * known signatures, never an exact compare. The localized title says what
 * to do; the raw text stays below it as the detail.
 *
 * Sources of the signatures:
 *   - token: python-telegram-bot `InvalidToken` (tgapp: "Telegram bot token
 *     rejected: …"), discord.py `LoginFailure` / gateway close 4004 / HTTP
 *     401 (dcapp `_permanent_connection_error`).
 *   - Feishu credentials: lark-oapi ws endpoint errors (`ClientException`
 *     "<code>: <msg>", AUTH_FAILED 514, NO_CREDENTIAL 1000040344), Core's
 *     "Feishu App ID and App Secret are required…", fsapp's
 *     "请在 mykey 配置中填写 fs_app_id 和 fs_app_secret".
 *   - intent: dcapp "Discord privileged intents are not enabled…", gateway
 *     close 4013 / 4014.
 *   - network: httpx / aiohttp / requests connect failures, PTB `TimedOut`
 *     / `NetworkError`, DNS failures, fsapp "Feishu long connection
 *     disconnected" / "Feishu reconnect attempt N failed".
 *   - QR expired: upstream wechatapp "二维码过期".
 *   - runtime missing: runner "import failed: …".
 *   - another Galley: runner "Another Galley <platform> supervisor is
 *     already running for state directory: …".
 */
export type ChannelErrorKind =
  | "already_running"
  | "runtime_missing"
  | "qr_expired"
  | "intent"
  | "credentials"
  | "network";

const ALREADY_RUNNING = /already running/i;
const RUNTIME_MISSING =
  /import failed|no module named|modulenotfounderror|importerror/i;
const QR_EXPIRED = /二维码.*过期|qr.*expir|expir.*\bqr/i;
const INTENT =
  /privileged.{0,20}intents?|message content intent|invalid (gateway )?intents|\b401[34]\b/i;
const BOT_TOKEN_INVALID =
  /invalid_?token|invalid (bot )?token|token.{0,60}rejected|rejected the bot credentials|login ?failure|unauthori[sz]ed|authentication failed|\b401\b|\b4004\b/i;
const FEISHU_CREDENTIALS =
  /app[\s_-]?(id|secret)|invalid app|app[\s_]not[\s_]exist|auth(entication)?[\s_]failed|unauthori[sz]ed|\b401\b|\b514\b|\b1000040344\b|\b10014\b/i;
const NETWORK =
  /connecterror|connect ?timeout|connection (refused|reset|aborted|error)|connection (is )?closed|timed ?out|timeout|network|getaddrinfo|name or service not known|nodename nor servname|name resolution|cannot connect to host|unable to connect|server ?unreachable|proxy|\bssl|eof occurred|long connection disconnected|reconnect attempt/i;

export function classifyChannelError(
  platform: ImSupervisorPlatform,
  text: string | null | undefined,
): ChannelErrorKind | null {
  if (!text) return null;
  if (ALREADY_RUNNING.test(text)) return "already_running";
  if (RUNTIME_MISSING.test(text)) return "runtime_missing";
  if (platform === "wechat" && QR_EXPIRED.test(text)) return "qr_expired";
  if (platform === "discord" && INTENT.test(text)) return "intent";
  if (
    (platform === "telegram" || platform === "discord") &&
    BOT_TOKEN_INVALID.test(text)
  ) {
    return "credentials";
  }
  if (platform === "feishu" && FEISHU_CREDENTIALS.test(text)) {
    return "credentials";
  }
  if (NETWORK.test(text)) return "network";
  return null;
}

export function channelErrorTitle(
  kind: ChannelErrorKind,
  platform: ImSupervisorPlatform,
  imCopy: ImCopy,
): string {
  const titles = imCopy.errorTitles;
  switch (kind) {
    case "already_running":
      return titles.alreadyRunning;
    case "runtime_missing":
      return titles.runtimeMissing;
    case "qr_expired":
      return titles.qrExpired;
    case "intent":
      return titles.intentDisabled;
    case "credentials":
      return platform === "feishu"
        ? titles.feishuCredentialsInvalid
        : titles.botTokenInvalid;
    case "network":
      return titles.network(channelPlatformLabel(platform, imCopy));
  }
}

/** Each platform's catch-all hint for a failed state. */
export function channelGenericErrorHint(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  imCopy: ImCopy,
): string {
  if (platform === "wechat") {
    return state === "expired" ? imCopy.expiredHint : imCopy.errorHint;
  }
  return {
    feishu: imCopy.feishuErrorHint,
    telegram: imCopy.telegramErrorHint,
    discord: imCopy.discordErrorHint,
  }[platform];
}

/**
 * Title for a card's error block. A recognized cause gets its localized
 * title. Otherwise a failed card (error / expired), where this block is
 * the status line, falls back to the platform's catch-all hint; an error
 * shown next to some other state (an action that failed, a reconnect
 * reason) keeps the plain 「错误详情」 label, because the state's own
 * hint is already on screen.
 */
export function channelErrorBlockTitle(
  platform: ImSupervisorPlatform,
  state: ImSupervisorState,
  text: string,
  imCopy: ImCopy,
): string {
  const kind = classifyChannelError(platform, text);
  if (kind) return channelErrorTitle(kind, platform, imCopy);
  if (state === "error" || state === "expired") {
    return channelGenericErrorHint(platform, state, imCopy);
  }
  return imCopy.lastError;
}
