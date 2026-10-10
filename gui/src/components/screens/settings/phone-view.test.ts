import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { RemoteStatus } from "@/lib/remote";

import {
  phonePageView,
  phoneStatusRow,
  qrStillShown,
  svgDataUrl,
  type ShownQr,
} from "./phone-view";

const copy = zhCopy.settings.phone;

const UNPAIRED: RemoteStatus = {
  paired: false,
  relayConnected: false,
  onlinePhones: 0,
  lastPhoneConnectedAt: null,
};

const IDLE: RemoteStatus = {
  paired: true,
  relayConnected: true,
  onlinePhones: 0,
  lastPhoneConnectedAt: null,
};

const T1 = "2026-10-10T12:43:36.763Z";
const T2 = "2026-10-10T12:44:04.911Z";

function shown(since: string | null, firstPairing: boolean): ShownQr {
  return { svg: "<svg/>", since, firstPairing };
}

function view(
  status: RemoteStatus,
  qr: ShownQr | null = null,
  keepInBackgroundOnClose = true,
  lastConnectedText: string | null = null,
) {
  return phonePageView({
    status,
    qr,
    keepInBackgroundOnClose,
    lastConnectedText,
    copy,
  });
}

describe("qrStillShown", () => {
  it("keeps the code up until a phone connects after it was shown", () => {
    expect(qrStillShown(IDLE, shown(null, true))).toBe(true);
    expect(
      qrStillShown({ ...IDLE, lastPhoneConnectedAt: T1 }, shown(T1, false)),
    ).toBe(true);
  });

  it("folds the code away once a phone has connected since", () => {
    const scanned = { ...IDLE, onlinePhones: 1, lastPhoneConnectedAt: T1 };
    expect(qrStillShown(scanned, shown(null, true))).toBe(false);
    expect(
      qrStillShown({ ...scanned, lastPhoneConnectedAt: T2 }, shown(T1, false)),
    ).toBe(false);
  });
});

describe("phonePageView", () => {
  it("offers pairing and nothing else while unpaired", () => {
    expect(view(UNPAIRED)).toEqual({
      layout: "pair",
      status: null,
      showQr: false,
      showBackgroundHint: false,
    });
  });

  it("keeps the pairing layout while the first code is up, though Core is paired already", () => {
    expect(view(IDLE, shown(null, true))).toEqual({
      layout: "pair",
      status: null,
      showQr: true,
      showBackgroundHint: false,
    });
  });

  it("shows status, add and unpair once paired; the code sits under add", () => {
    const paired = view(IDLE, shown(null, false));
    expect(paired.layout).toBe("paired");
    expect(paired.showQr).toBe(true);
    expect(paired.status?.kind).toBe("idle");
    // A first-pairing code hidden by hand leaves the paired layout.
    expect(view(IDLE).layout).toBe("paired");
  });

  it("asks to keep Galley running in the background when closing quits it", () => {
    expect(view(UNPAIRED, null, false).showBackgroundHint).toBe(true);
    expect(view(IDLE, null, false).showBackgroundHint).toBe(true);
    expect(view(IDLE, null, true).showBackgroundHint).toBe(false);
  });
});

describe("phoneStatusRow", () => {
  it("counts the phones online, green", () => {
    expect(
      phoneStatusRow(
        { ...IDLE, onlinePhones: 2, lastPhoneConnectedAt: T1 },
        "今天 20:43",
        copy,
      ),
    ).toEqual({
      kind: "online",
      badge: { tone: "success", label: "已连接", spin: false },
      title: "2 台手机在线",
      detail: "上次连接 今天 20:43",
    });
  });

  it("says when a phone last connected, or that it connects by itself", () => {
    expect(phoneStatusRow(IDLE, null, copy)).toEqual({
      kind: "idle",
      badge: { tone: "neutral", label: "未连接", spin: false },
      title: "没有手机在线",
      detail: "手机打开 Galley 时会自动连上",
    });
    expect(
      phoneStatusRow({ ...IDLE, lastPhoneConnectedAt: T1 }, "今天 20:43", copy)
        .detail,
    ).toBe("上次连接 今天 20:43");
  });

  it("words a lost relay connection as the network, whatever the phone count says", () => {
    expect(
      phoneStatusRow(
        { ...IDLE, relayConnected: false, onlinePhones: 1 },
        null,
        copy,
      ),
    ).toEqual({
      kind: "connecting",
      badge: { tone: "neutral", label: "正在连接", spin: true },
      title: "暂时连不上网络",
      detail: "正在重试。连上之前，手机连不到这台电脑。",
    });
  });

  it("counts phones in English with a plural", () => {
    const en = enCopy.settings.phone;
    expect(phoneStatusRow({ ...IDLE, onlinePhones: 1 }, null, en).title).toBe(
      "1 phone online",
    );
    expect(phoneStatusRow({ ...IDLE, onlinePhones: 3 }, null, en).title).toBe(
      "3 phones online",
    );
  });
});

describe("phone copy", () => {
  it("never names the relay", () => {
    const words = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (typeof value === "function") return [String(value(1))];
      if (Array.isArray(value)) return value.flatMap(words);
      if (value && typeof value === "object") {
        return Object.values(value).flatMap(words);
      }
      return [];
    };
    for (const text of [
      ...words(zhCopy.settings.phone),
      ...words(enCopy.settings.phone),
    ]) {
      expect(text).not.toMatch(/relay|中转|服务器|server/i);
    }
  });
});

describe("svgDataUrl", () => {
  it("encodes the markup for an img source", () => {
    expect(svgDataUrl('<svg a="#fff"/>')).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23fff%22%2F%3E",
    );
  });
});
