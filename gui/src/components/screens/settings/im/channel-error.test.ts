import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import {
  channelErrorBlockTitle,
  channelErrorTitle,
  classifyChannelError,
} from "./channel-error";

const zh = zhCopy.settings.im;
const en = enCopy.settings.im;

describe("classifyChannelError", () => {
  it("recognizes a rejected bot token", () => {
    for (const text of [
      "Telegram bot token rejected: The token `123:abc` was rejected by the server.",
      "telegram.error.InvalidToken: Not Found",
      "Unauthorized",
      "HTTP 401",
    ]) {
      expect(classifyChannelError("telegram", text)).toBe("credentials");
    }
    for (const text of [
      "Discord bot token rejected: Improper token has been passed.",
      "Discord gateway closed the connection (4004): authentication failed (invalid bot token)",
      "Discord rejected the bot credentials (HTTP 401): 401 Unauthorized",
    ]) {
      expect(classifyChannelError("discord", text)).toBe("credentials");
    }
  });

  it("recognizes Feishu App ID / App Secret problems", () => {
    for (const text of [
      "Feishu App ID and App Secret are required before connecting",
      "请在 mykey 配置中填写 fs_app_id 和 fs_app_secret",
      "10014: app secret invalid",
      "514: auth failed",
      "1000040344: app_id or app_secret is null",
    ]) {
      expect(classifyChannelError("feishu", text)).toBe("credentials");
    }
  });

  it("recognizes the Discord intent, before the token rules", () => {
    for (const text of [
      "Discord privileged intents are not enabled: turn on MESSAGE CONTENT INTENT in the Developer Portal",
      "Discord gateway closed the connection (4014): privileged gateway intents are not enabled — turn on MESSAGE CONTENT INTENT",
      "Discord gateway closed the connection (4013): invalid gateway intents",
    ]) {
      expect(classifyChannelError("discord", text)).toBe("intent");
    }
    // 4014 is not a 401.
    expect(classifyChannelError("telegram", "code 4014")).toBeNull();
  });

  it("recognizes a missing runtime component and a second Galley", () => {
    expect(
      classifyChannelError(
        "telegram",
        "import failed: No module named 'telegram'",
      ),
    ).toBe("runtime_missing");
    expect(
      classifyChannelError(
        "wechat",
        "ModuleNotFoundError: No module named 'qrcode'",
      ),
    ).toBe("runtime_missing");
    expect(
      classifyChannelError(
        "telegram",
        "Another Galley telegram supervisor is already running for state directory: /x",
      ),
    ).toBe("already_running");
  });

  it("recognizes an expired WeChat QR code only on WeChat", () => {
    expect(classifyChannelError("wechat", "二维码过期")).toBe("qr_expired");
    expect(classifyChannelError("wechat", "QR code expired")).toBe(
      "qr_expired",
    );
    expect(classifyChannelError("wechat", "WeChat login expired")).toBeNull();
  });

  it("recognizes network failures", () => {
    for (const text of [
      "httpx.ConnectError: [Errno 61] Connection refused",
      "telegram.error.TimedOut: Timed out",
      "telegram.error.NetworkError: httpx.ReadError",
      "[Errno 8] nodename nor servname provided, or not known",
      "socket.gaierror: getaddrinfo failed",
      "Cannot connect to host discord.com:443 ssl:default",
      "Feishu long connection disconnected",
      "Feishu reconnect attempt 3 failed",
      "ProxyError: Unable to connect to proxy",
    ]) {
      expect(classifyChannelError("telegram", text)).toBe("network");
    }
  });

  it("returns null when nothing matches", () => {
    expect(
      classifyChannelError("discord", "process exited with code 1"),
    ).toBeNull();
    expect(classifyChannelError("feishu", "")).toBeNull();
    expect(classifyChannelError("feishu", null)).toBeNull();
  });
});

describe("channelErrorTitle", () => {
  it("words the cause per platform", () => {
    expect(channelErrorTitle("credentials", "telegram", zh)).toBe(
      "Bot Token 无效或已被重置",
    );
    expect(channelErrorTitle("credentials", "feishu", zh)).toBe(
      "App ID 或 App Secret 不正确",
    );
    expect(channelErrorTitle("intent", "discord", zh)).toBe(
      "没有打开 MESSAGE CONTENT INTENT",
    );
    expect(channelErrorTitle("network", "telegram", zh)).toBe(
      "连不上 Telegram，检查网络或代理",
    );
    // No space before a Chinese platform name.
    expect(channelErrorTitle("network", "wechat", zh)).toBe(
      "连不上微信，检查网络或代理",
    );
    expect(channelErrorTitle("network", "discord", en)).toBe(
      "Can't reach Discord — check your network or proxy",
    );
  });
});

describe("channelErrorBlockTitle", () => {
  it("falls back to the platform hint in a failed state, else 错误详情", () => {
    expect(
      channelErrorBlockTitle("telegram", "error", "process exited", zh),
    ).toBe(zh.telegramErrorHint);
    expect(
      channelErrorBlockTitle("wechat", "expired", "WeChat login expired", zh),
    ).toBe(zh.expiredHint);
    expect(channelErrorBlockTitle("feishu", "stopped", "save failed", zh)).toBe(
      zh.lastError,
    );
    expect(
      channelErrorBlockTitle(
        "feishu",
        "reconnecting",
        "Feishu long connection disconnected",
        zh,
      ),
    ).toBe("连不上飞书，检查网络或代理");
  });
});
