import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";

import { DiscordCard } from "./DiscordCard";
import { FeishuCard } from "./FeishuCard";
import { TelegramCard } from "./TelegramCard";
import { WeChatCard } from "./WeChatCard";

const im = zhCopy.settings.im;

function status(patch: Partial<ImSupervisorStatus>): ImSupervisorStatus {
  return {
    platform: "telegram",
    state: "stopped",
    enabled: false,
    modelConfigStale: false,
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...patch,
  };
}

/** Visible text of a static render, tags stripped, in document order.
 * Effects don't run here, so the cards render from props alone (the
 * config fetch never lands; ownership comes from the status). */
function text(node: ReactNode): string {
  return renderToStaticMarkup(<Tooltip.Provider>{node}</Tooltip.Provider>)
    .replace(/<[^>]+>/g, "\u0001")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Asserts each string appears, in this order. */
function expectInOrder(haystack: string, needles: string[]) {
  let from = 0;
  for (const needle of needles) {
    const at = haystack.indexOf(needle, from);
    expect(at, `"${needle}" after offset ${from}`).toBeGreaterThanOrEqual(0);
    from = at + needle.length;
  }
}

const noop = () => {};

function telegram(s: ImSupervisorStatus) {
  return text(
    <TelegramCard status={s} statusLoadError={null} onStatusChange={noop} />,
  );
}

describe("TelegramCard views", () => {
  it("set up + paused: hint, resume, fold, owner, security note", () => {
    const out = telegram(status({ state: "stopped", ownerOpenId: "12345678" }));
    expectInOrder(out, [
      "已暂停",
      im.telegramPausedHint,
      im.resumeReceiving,
      im.changeBotTokenOrSteps,
      im.ownerBoundLabel,
      im.ownerSecurityNote(im.telegramOwnerScope),
    ]);
    // The form and steps are folded away (the fold mounts them on open).
    expect(out).not.toContain("/newbot");
    expect(out).not.toContain(im.save);
    expect(out).not.toContain(im.telegramStoppedHint);
  });

  it("set up + error: the error block takes the status line, then retry", () => {
    const out = telegram(
      status({
        state: "error",
        enabled: true,
        ownerOpenId: "12345678",
        lastError: "Telegram bot token rejected: nope",
      }),
    );
    expectInOrder(out, [
      "异常",
      im.errorTitles.botTokenInvalid,
      "Telegram bot token rejected: nope",
      im.retry,
      im.changeBotTokenOrSteps,
    ]);
    expect(out).not.toContain(im.telegramErrorHint);
  });

  it("set up + reconnecting: hint and a disabled working button", () => {
    const out = telegram(
      status({ state: "reconnecting", enabled: true, ownerOpenId: "1" }),
    );
    expectInOrder(out, [im.telegramReconnectingHint, im.working]);
    expect(out).not.toContain(im.resumeReceiving);
  });

  it("running: hint, commands, owner, no running steps", () => {
    const out = telegram(
      status({ state: "running", enabled: true, ownerOpenId: "12345678" }),
    );
    expectInOrder(out, [
      "已接入",
      im.telegramRunningHint,
      im.telegramTextCommandsTitle,
      "/new",
      im.ownerBoundLabel,
    ]);
    expect(out).not.toContain(im.changeBotTokenOrSteps);
  });

  it("running before pairing: 已接入 and the pairing code", () => {
    const out = telegram(
      status({ state: "running", enabled: true, bindCode: "123456" }),
    );
    expectInOrder(out, ["已接入", im.telegramRunningHint, "/new", "123456"]);
  });

  it("not set up: onboarding steps, form, start", () => {
    const out = telegram(status({ state: "stopped" }));
    expectInOrder(out, [
      "未启动",
      "/newbot",
      im.telegramStoppedHint,
      im.telegramBotTokenLabel,
      im.save,
      im.telegramStartService,
    ]);
  });
});

describe("DiscordCard views", () => {
  it("running keeps the activation steps and both declarations", () => {
    const out = text(
      <DiscordCard
        status={status({
          platform: "discord",
          state: "running",
          enabled: true,
          ownerOpenId: "123456789012",
        })}
        statusLoadError={null}
        onStatusChange={noop}
      />,
    );
    expectInOrder(out, [
      im.discordRunningHint,
      im.discordConnectedSteps[0],
      "@机器人",
      "/new",
      im.ownerBoundLabel,
      im.ownerSecurityNote(im.discordOwnerScope),
      im.discordChannelVisibilityNote,
      im.discordChannelScopeNote,
    ]);
  });

  it("paused keeps both declarations visible", () => {
    const out = text(
      <DiscordCard
        status={status({
          platform: "discord",
          state: "stopped",
          ownerOpenId: "123456789012",
        })}
        statusLoadError={null}
        onStatusChange={noop}
      />,
    );
    expectInOrder(out, [
      im.discordPausedHint,
      im.resumeReceiving,
      im.changeBotTokenOrSteps,
      im.discordChannelVisibilityNote,
      im.discordChannelScopeNote,
    ]);
  });
});

describe("FeishuCard views", () => {
  function feishu(s: ImSupervisorStatus) {
    return text(
      <FeishuCard status={s} statusLoadError={null} onStatusChange={noop} />,
    );
  }

  it("running before pairing keeps the guide open (first run)", () => {
    const out = feishu(
      status({
        platform: "feishu",
        state: "running",
        enabled: true,
        bindCode: "654321",
      }),
    );
    expectInOrder(out, [
      "服务已启动",
      im.feishuRunningUnboundHint,
      im.feishuSetupSections[0].title,
      im.feishuSetupSections[5].title,
      "654321",
    ]);
    expect(out).not.toContain(im.feishuSetupCollapsed);
    expect(out).not.toContain(im.feishuTextCommandsTitle);
  });

  it("running after pairing folds the guide under 查看飞书配置步骤", () => {
    const out = feishu(
      status({
        platform: "feishu",
        state: "running",
        enabled: true,
        ownerOpenId: "ou_1234567890",
      }),
    );
    expectInOrder(out, [
      "已接入",
      im.feishuRunningHint,
      im.feishuTextCommandsTitle,
      im.feishuSetupCollapsed,
      im.ownerBoundLabel,
      im.ownerSecurityNote(im.feishuOwnerScope),
    ]);
    expect(out).not.toContain(im.feishuSetupSections[0].title);
  });

  it("paused after pairing: resume and the credentials fold", () => {
    const out = feishu(
      status({
        platform: "feishu",
        state: "stopped",
        ownerOpenId: "ou_1234567890",
      }),
    );
    expectInOrder(out, [
      "已暂停",
      im.feishuPausedHint,
      im.resumeReceiving,
      im.feishuChangeCredentials,
    ]);
  });
});

describe("WeChatCard views", () => {
  function wechat(s: ImSupervisorStatus | null) {
    return text(
      <WeChatCard
        status={s}
        busyAction={null}
        invokeError={null}
        onConnect={noop}
        onRescan={noop}
        onStop={noop}
        onDisconnect={noop}
      />,
    );
  }

  it("waiting for a scan renders no status line beside the QR", () => {
    const out = wechat(
      status({ platform: "wechat", state: "waiting_scan", enabled: true }),
    );
    expectInOrder(out, [im.setupSteps[0], im.noQrYet, im.scanHint]);
    // The status hint is word for word step 1: only the step remains.
    expect(im.waitingScanHint).toBe(im.setupSteps[0]);
    expect(out.split(im.waitingScanHint).length - 1).toBe(1);
  });

  it("paused: hint and resume, no setup steps", () => {
    const out = wechat(status({ platform: "wechat", state: "stopped" }));
    expectInOrder(out, ["已暂停", im.stoppedHint, im.resumeReceiving]);
    expect(out).not.toContain(im.setupSteps[1]);
  });

  it("running: hint and the shared command table", () => {
    const out = wechat(
      status({ platform: "wechat", state: "running", enabled: true }),
    );
    expectInOrder(out, ["已接入", im.runningHint, "/new", "/help"]);
    expect(out).not.toContain(im.setupSteps[1]);
  });

  it("expired: onboarding with reconnect", () => {
    const out = wechat(
      status({
        platform: "wechat",
        state: "expired",
        lastError: "WeChat login expired",
      }),
    );
    expectInOrder(out, [
      im.setupSteps[0],
      im.expiredHint,
      "WeChat login expired",
      im.reconnect,
    ]);
  });
});
