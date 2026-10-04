import { describe, expect, it } from "vitest";

import type { ImSupervisorStatus } from "@/lib/im-supervisor";

import {
  channelsIndicatorStatus,
  configuredChannels,
  isChannelConfigured,
} from "./channels-indicator-status";

function channel(patch: Partial<ImSupervisorStatus> = {}): ImSupervisorStatus {
  return {
    platform: "wechat",
    state: "not_connected",
    enabled: false,
    modelConfigStale: false,
    updatedAt: "2026-10-04T00:00:00.000Z",
    ...patch,
  };
}

describe("isChannelConfigured", () => {
  it("follows Core's derived state: credentials make a stopped platform", () => {
    expect(isChannelConfigured(null)).toBe(false);
    expect(isChannelConfigured(channel())).toBe(false);
    expect(isChannelConfigured(channel({ state: "stopped" }))).toBe(true);
    expect(
      isChannelConfigured(channel({ state: "running", enabled: true })),
    ).toBe(true);
    expect(isChannelConfigured(channel({ state: "expired" }))).toBe(true);
  });

  it("counts an enabled platform before its first live state", () => {
    expect(isChannelConfigured(channel({ enabled: true }))).toBe(true);
  });
});

describe("channelsIndicatorStatus", () => {
  it("is setup when nothing was ever configured", () => {
    const configured = configuredChannels([
      channel(),
      channel({ platform: "feishu" }),
      null,
      null,
    ]);
    expect(configured).toEqual([]);
    expect(channelsIndicatorStatus(configured)).toBe("setup");
  });

  it("lights while any configured platform runs, idles when all are paused", () => {
    const running = configuredChannels([
      channel({ state: "stopped" }),
      channel({ platform: "telegram", state: "running", enabled: true }),
    ]);
    expect(channelsIndicatorStatus(running)).toBe("connected");
    expect(
      channelsIndicatorStatus(
        configuredChannels([channel({ state: "stopped" })]),
      ),
    ).toBe("idle");
  });

  it("lets attention states win over the lamp", () => {
    const base = channel({ state: "running", enabled: true });
    expect(
      channelsIndicatorStatus([
        base,
        channel({ platform: "feishu", state: "error", enabled: true }),
      ]),
    ).toBe("needsAttention");
    expect(
      channelsIndicatorStatus([
        base,
        channel({ platform: "feishu", state: "expired" }),
      ]),
    ).toBe("needsAttention");
    expect(
      channelsIndicatorStatus([
        channel({ state: "waiting_scan", enabled: true }),
      ]),
    ).toBe("waitingScan");
    expect(
      channelsIndicatorStatus([
        base,
        channel({ platform: "discord", state: "reconnecting", enabled: true }),
      ]),
    ).toBe("connecting");
    expect(channelsIndicatorStatus([], "invoke failed")).toBe("needsAttention");
  });
});
