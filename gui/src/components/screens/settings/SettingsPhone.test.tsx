import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RemoteStatus } from "@/lib/remote";

import { SettingsPhone } from "./SettingsPhone";
import { SettingsSidebar } from "./SettingsSidebar";

/** Visible text of a static render, tags as separators. Effects don't
 * run, so the page renders from props alone. */
function text(node: ReactNode): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, "\u0001");
}

function phone(status: Partial<RemoteStatus>, keepInBackground = true) {
  return text(
    <SettingsPhone
      status={{
        paired: false,
        pairing: false,
        pairingError: null,
        relayConnected: false,
        onlinePhones: 0,
        lastPhoneConnectedAt: null,
        ...status,
      }}
      keepInBackgroundOnClose={keepInBackground}
      onEnableKeepInBackground={() => {}}
    />,
  );
}

describe("SettingsPhone", () => {
  it("unpaired: one way in, no code until asked, nothing to unpair", () => {
    const out = phone({});
    expect(out).toContain("配对手机");
    expect(out).toContain("显示配对码");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("解除配对");
    expect(out).not.toContain("关闭窗口后 Galley 会退出");
  });

  it("pairing: still the pairing layout until the first phone connects", () => {
    const out = phone({ pairing: true, relayConnected: true });
    expect(out).toContain("配对手机");
    expect(out).not.toContain("解除配对");
    expect(out).not.toContain("没有手机在线");
  });

  it("pairing: says so when the key could not be saved", () => {
    const out = phone({
      pairing: true,
      relayConnected: true,
      pairingError: "db: disk full",
    });
    expect(out).toContain("配对没能保存，手机没有连上：db: disk full");
    // Not once the pairing is over.
    expect(phone({ pairingError: "db: disk full" })).not.toContain(
      "配对没能保存",
    );
  });

  it("paired: status, add a phone, unpair", () => {
    const out = phone({
      paired: true,
      relayConnected: true,
      onlinePhones: 1,
      lastPhoneConnectedAt: "2026-10-10T12:43:36.763Z",
    });
    for (const word of ["1 台手机在线", "已连接", "添加手机", "解除配对"]) {
      expect(out).toContain(word);
    }
    expect(out).toContain("上次连接");
  });

  it("paired with the relay down: the network, never the relay", () => {
    const out = phone({ paired: true });
    expect(out).toContain("暂时连不上网络");
    expect(out).toContain("正在连接");
  });

  it("asks to keep running in the background when closing quits Galley", () => {
    const out = phone({}, false);
    expect(out).toContain("关闭窗口后 Galley 会退出");
    expect(out).toContain("打开");
  });
});

describe("SettingsSidebar phone tab", () => {
  function sidebar(showPhoneTab: boolean) {
    return text(
      <SettingsSidebar
        tab="general"
        onChange={() => {}}
        resolvedLanguage="zh-CN"
        showImTab
        showBrowserTab
        showPhoneTab={showPhoneTab}
      />,
    );
  }

  it("is absent without remote access, so the tabs are as before", () => {
    expect(sidebar(false)).not.toContain("手机");
  });

  it("sits right after Channels when remote access exists", () => {
    const out = sidebar(true);
    const channels = out.indexOf("聊天软件");
    const phoneTab = out.indexOf("手机");
    const agent = out.indexOf("智能体接入");
    expect(channels).toBeGreaterThanOrEqual(0);
    expect(phoneTab).toBeGreaterThan(channels);
    expect(phoneTab).toBeLessThan(agent);
  });
});
