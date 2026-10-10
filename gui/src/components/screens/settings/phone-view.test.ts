import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { RemoteStatus } from "@/lib/remote";

import {
  phonePageView,
  phoneStatusRow,
  settleQr,
  svgDataUrl,
  type ShownQr,
} from "./phone-view";

const copy = zhCopy.settings.phone;

const UNPAIRED: RemoteStatus = {
  paired: false,
  pairing: false,
  pairingError: null,
  relayConnected: false,
  onlinePhones: 0,
  lastPhoneConnectedAt: null,
};

/** A new code is out, Core waits for its first phone. */
const PAIRING: RemoteStatus = {
  ...UNPAIRED,
  pairing: true,
  relayConnected: true,
};

const IDLE: RemoteStatus = {
  paired: true,
  pairing: false,
  pairingError: null,
  relayConnected: true,
  onlinePhones: 0,
  lastPhoneConnectedAt: null,
};

const T1 = "2026-10-10T12:43:36.763Z";
const T2 = "2026-10-10T12:44:04.911Z";

function shown(since: string | null, pairingSeen = false): ShownQr {
  return { svg: "<svg/>", since, pairingSeen };
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

describe("settleQr", () => {
  it("keeps a new pairing's code while Core waits for its phone", () => {
    const qr = shown(null);
    // Core's report of the pairing can arrive after the command's answer.
    expect(settleQr(UNPAIRED, qr)).toBe(qr);
    const seen = settleQr(PAIRING, qr);
    expect(seen).toEqual({ ...qr, pairingSeen: true });
    expect(settleQr(PAIRING, seen)).toBe(seen);
  });

  it("folds a new pairing's code once Core ends the pairing (timed out, cancelled)", () => {
    expect(settleQr(UNPAIRED, shown(null, true))).toBeNull();
  });

  it("folds the first pairing's code when its phone connects", () => {
    const paired = { ...IDLE, onlinePhones: 1, lastPhoneConnectedAt: T1 };
    expect(settleQr(paired, shown(null, true))).toBeNull();
  });

  it("keeps Add a phone's code until a phone connects after it was shown", () => {
    const qr = shown(T1);
    expect(settleQr({ ...IDLE, lastPhoneConnectedAt: T1 }, qr)).toBe(qr);
    expect(
      settleQr({ ...IDLE, onlinePhones: 2, lastPhoneConnectedAt: T2 }, qr),
    ).toBeNull();
  });

  it("has nothing to settle without a code", () => {
    expect(settleQr(PAIRING, null)).toBeNull();
  });
});

describe("phonePageView", () => {
  it("offers pairing and nothing else while unpaired", () => {
    expect(view(UNPAIRED)).toEqual({
      layout: "pair",
      status: null,
      showQr: false,
      showQrExpiry: false,
      pairingError: null,
      showBackgroundHint: false,
    });
  });

  it("keeps the pairing layout while the first code waits, and says it expires", () => {
    expect(view(PAIRING, shown(null, true))).toEqual({
      layout: "pair",
      status: null,
      showQr: true,
      showQrExpiry: true,
      pairingError: null,
      showBackgroundHint: false,
    });
  });

  it("follows Core's paired alone", () => {
    expect(view(PAIRING).layout).toBe("pair");
    expect(view(IDLE).layout).toBe("paired");
  });

  it("shows status, add and unpair once paired; Add a phone's code does not expire", () => {
    const paired = view(IDLE, shown(null));
    expect(paired.layout).toBe("paired");
    expect(paired.showQr).toBe(true);
    expect(paired.showQrExpiry).toBe(false);
    expect(paired.status?.kind).toBe("idle");
  });

  it("says when the key could not be saved, while the pairing lasts", () => {
    const failed = { ...PAIRING, pairingError: "db: disk full" };
    expect(view(failed, shown(null, true)).pairingError).toBe(
      "配对没能保存，手机没有连上：db: disk full",
    );
    expect(view({ ...failed, pairing: false }).pairingError).toBeNull();
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
