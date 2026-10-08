import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";

import {
  channelsRestartRejectedToast,
  channelsRestartToast,
} from "./channels-restart";

function status(patch: Partial<ImSupervisorStatus>): ImSupervisorStatus {
  return {
    platform: "telegram",
    state: "starting",
    enabled: true,
    modelConfigStale: false,
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...patch,
  };
}

describe("channelsRestartToast", () => {
  it("says there was nothing to restart", () => {
    const toast = channelsRestartToast([], zhCopy);
    expect(toast.severity).toBe("info");
    expect(toast.title).toBe("没有已启用的渠道。");
  });

  it("confirms when every channel came back", () => {
    const toast = channelsRestartToast(
      [status({ platform: "wechat" }), status({ state: "running" })],
      zhCopy,
    );
    expect(toast.severity).toBe("info");
    expect(toast.title).toBe("渠道已重启");
    expect(toast.message).toBe("已启用的渠道已重新启动。");
  });

  it("names each failed platform with its reason in words", () => {
    const toast = channelsRestartToast(
      [
        status({ platform: "wechat", state: "starting" }),
        status({
          platform: "telegram",
          state: "error",
          lastError: "Telegram bot token rejected: nope",
        }),
        status({ platform: "feishu", state: "starting" }),
      ],
      zhCopy,
    );
    expect(toast.severity).toBe("warning");
    expect(toast.title).toBe("部分渠道重启失败");
    expect(toast.message).toBe(
      "已重启 2 个渠道；Telegram：Bot Token 无效或已被重置",
    );
  });

  it("is the failure toast when nothing came back, joining the reasons", () => {
    const toast = channelsRestartToast(
      [
        status({
          platform: "telegram",
          state: "error",
          lastError: "Telegram bot token rejected: nope",
        }),
        status({
          platform: "discord",
          state: "error",
          lastError: "process exited with code 1",
        }),
      ],
      zhCopy,
    );
    expect(toast.severity).toBe("error");
    expect(toast.title).toBe("重启渠道失败");
    // An unrecognized reason falls back to the platform hint, minus its
    // closing full stop so the joined line reads cleanly.
    expect(toast.message).toBe(
      `Telegram：Bot Token 无效或已被重置；Discord：${zhCopy.settings.im.discordErrorHint.replace(/。$/, "")}`,
    );
  });

  it("does not count an error without a reason as a failure", () => {
    const toast = channelsRestartToast(
      [status({ state: "error", lastError: null })],
      zhCopy,
    );
    expect(toast.title).toBe("渠道已重启");
  });
});

describe("channelsRestartRejectedToast", () => {
  it("carries the raw error", () => {
    const toast = channelsRestartRejectedToast(
      new Error("prepare failed"),
      zhCopy,
    );
    expect(toast.severity).toBe("error");
    expect(toast.title).toBe("重启渠道失败");
    expect(toast.message).toBe("prepare failed");
  });
});
