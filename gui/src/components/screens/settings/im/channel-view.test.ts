import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";

import {
  canPauseChannel,
  channelBadgeKind,
  channelBadgeLabel,
  channelBadgeTone,
  channelCardView,
  channelCommands,
  channelStatusBadgeKind,
  configuredPrimaryAction,
  errorReplacesStatusHint,
  isChannelSetUp,
} from "./channel-view";

const zh = zhCopy.settings.im;
const en = enCopy.settings.im;

function status(patch: Partial<ImSupervisorStatus> = {}): ImSupervisorStatus {
  return {
    platform: "telegram",
    state: "stopped",
    enabled: false,
    modelConfigStale: false,
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...patch,
  };
}

describe("isChannelSetUp", () => {
  it("counts a paired owner for Feishu / Telegram / Discord", () => {
    for (const platform of ["feishu", "telegram", "discord"] as const) {
      expect(isChannelSetUp(platform, "stopped", "ou_123")).toBe(true);
      expect(isChannelSetUp(platform, "running", "ou_123")).toBe(true);
      expect(isChannelSetUp(platform, "error", "ou_123")).toBe(true);
      // A saved credential alone is not setup.
      expect(isChannelSetUp(platform, "stopped", null)).toBe(false);
      expect(isChannelSetUp(platform, "running", undefined)).toBe(false);
      expect(isChannelSetUp(platform, "running", "  ")).toBe(false);
    }
  });

  it("counts a WeChat login token (any state Core derives with one)", () => {
    for (const state of [
      "starting",
      "reconnecting",
      "running",
      "error",
      "stopped",
    ] as const) {
      expect(isChannelSetUp("wechat", state, null)).toBe(true);
    }
    for (const state of ["not_connected", "waiting_scan", "expired"] as const) {
      expect(isChannelSetUp("wechat", state, null)).toBe(false);
    }
  });
});

describe("channelBadgeKind", () => {
  it("reads 已接入 for every set-up running channel", () => {
    for (const platform of [
      "wechat",
      "feishu",
      "telegram",
      "discord",
    ] as const) {
      expect(channelBadgeKind(platform, "running", true)).toBe("connected");
    }
  });

  it("keeps 服务已启动 only for Feishu before pairing", () => {
    expect(channelBadgeKind("feishu", "running", false)).toBe(
      "service_started",
    );
    expect(channelBadgeKind("telegram", "running", false)).toBe("connected");
    expect(channelBadgeKind("discord", "running", false)).toBe("connected");
  });

  it("splits stopped into paused (set up) and not started", () => {
    expect(channelBadgeKind("telegram", "stopped", true)).toBe("paused");
    expect(channelBadgeKind("telegram", "stopped", false)).toBe("not_started");
    expect(channelBadgeKind("wechat", "stopped", true)).toBe("paused");
  });

  it("passes the other states through", () => {
    expect(channelBadgeKind("wechat", "waiting_scan", false)).toBe(
      "waiting_scan",
    );
    expect(channelBadgeKind("discord", "reconnecting", true)).toBe(
      "reconnecting",
    );
    expect(channelBadgeKind("feishu", "error", true)).toBe("error");
  });

  it("derives from a live status for the topbar", () => {
    expect(
      channelStatusBadgeKind(
        status({ platform: "feishu", state: "running", ownerOpenId: null }),
      ),
    ).toBe("service_started");
    expect(
      channelStatusBadgeKind(
        status({ platform: "feishu", state: "running", ownerOpenId: "ou_1" }),
      ),
    ).toBe("connected");
    expect(
      channelStatusBadgeKind(status({ state: "stopped", ownerOpenId: "42" })),
    ).toBe("paused");
    expect(channelStatusBadgeKind(status({ state: "stopped" }))).toBe(
      "not_started",
    );
  });
});

describe("channelBadgeLabel / channelBadgeTone", () => {
  it("uses the agreed words", () => {
    expect(channelBadgeLabel("connected", zh)).toBe("已接入");
    expect(channelBadgeLabel("service_started", zh)).toBe("服务已启动");
    expect(channelBadgeLabel("paused", zh)).toBe("已暂停");
    expect(channelBadgeLabel("not_started", zh)).toBe("未启动");
    expect(channelBadgeLabel("paused", en)).toBe("Paused");
  });

  it("paints a waiting scan amber, like the topbar", () => {
    expect(channelBadgeTone("waiting_scan")).toBe("warning");
    expect(channelBadgeTone("connected")).toBe("success");
    expect(channelBadgeTone("service_started")).toBe("success");
    expect(channelBadgeTone("error")).toBe("error");
    expect(channelBadgeTone("expired")).toBe("error");
    expect(channelBadgeTone("paused")).toBe("neutral");
    expect(channelBadgeTone("starting")).toBe("neutral");
  });
});

describe("channelCardView", () => {
  it("routes by run state and setup", () => {
    expect(channelCardView("telegram", "running", true)).toBe("running");
    expect(channelCardView("telegram", "running", false)).toBe("running");
    expect(channelCardView("feishu", "running", true)).toBe("running");
    expect(channelCardView("feishu", "running", false)).toBe(
      "feishu_first_run",
    );
    expect(channelCardView("discord", "stopped", true)).toBe("configured");
    expect(channelCardView("discord", "error", true)).toBe("configured");
    expect(channelCardView("discord", "error", false)).toBe("onboarding");
    expect(channelCardView("wechat", "expired", false)).toBe("onboarding");
  });
});

describe("configuredPrimaryAction", () => {
  it("resumes, retries, or shows working", () => {
    expect(configuredPrimaryAction("stopped")).toBe("resume");
    expect(configuredPrimaryAction("error")).toBe("retry");
    expect(configuredPrimaryAction("expired")).toBe("retry");
    expect(configuredPrimaryAction("starting")).toBe("working");
    expect(configuredPrimaryAction("reconnecting")).toBe("working");
    expect(configuredPrimaryAction("running")).toBeNull();
  });
});

describe("errorReplacesStatusHint", () => {
  it("only in a failed state with error text", () => {
    expect(errorReplacesStatusHint("error", "boom")).toBe(true);
    expect(errorReplacesStatusHint("expired", "boom")).toBe(true);
    expect(errorReplacesStatusHint("error", null)).toBe(false);
    expect(errorReplacesStatusHint("reconnecting", "boom")).toBe(false);
    expect(errorReplacesStatusHint("stopped", "boom")).toBe(false);
  });
});

describe("canPauseChannel", () => {
  it("follows enabled, whatever the run state", () => {
    for (const state of [
      "starting",
      "reconnecting",
      "waiting_scan",
      "error",
      "expired",
      "running",
    ] as const) {
      expect(canPauseChannel(status({ state, enabled: true }))).toBe(true);
    }
    expect(canPauseChannel(status({ state: "running", enabled: false }))).toBe(
      false,
    );
    expect(canPauseChannel(null)).toBe(false);
  });
});

describe("channelCommands", () => {
  it("shares one table across the four channels", () => {
    const wechat = channelCommands("wechat", zh).map((c) => c.command);
    expect(wechat).toEqual([
      "/new",
      "/stop",
      "/status",
      "/llm",
      "/llm n",
      "/help",
    ]);
    expect(channelCommands("feishu", zh)).toEqual(
      channelCommands("wechat", zh),
    );
  });

  it("lets Telegram's /llm switch, and puts Discord's channel commands first", () => {
    const telegramLlm = channelCommands("telegram", zh).find(
      (c) => c.command === "/llm",
    );
    expect(telegramLlm?.description).toBe("查看并切换模型");
    const discord = channelCommands("discord", zh).map((c) => c.command);
    expect(discord.slice(0, 2)).toEqual(["@机器人", "退出频道"]);
    expect(discord).toHaveLength(8);
    // The English table keeps the Chinese exit command (dcapp only knows it).
    expect(channelCommands("discord", en)[1]?.command).toBe("退出频道");
  });
});
