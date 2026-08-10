import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

const windowMocks = vi.hoisted(() => ({
  isFocused: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationMocks);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));

import {
  clearReplyNotifyPending,
  consumeReplyNotifyPending,
  markReplyNotifyPending,
  resolveNotifySound,
  sendGatedSystemNotification,
  shouldThrottle,
} from "@/lib/notify";
import { usePrefsStore } from "@/stores/prefs";
import { resetStores } from "@/test/store-reset";

describe("shouldThrottle", () => {
  it("never throttles a key that has not fired yet", () => {
    expect(shouldThrottle(undefined, 1000, 5000)).toBe(false);
  });

  it("throttles inside the window and releases after it", () => {
    expect(shouldThrottle(1000, 5999, 5000)).toBe(true);
    expect(shouldThrottle(1000, 6000, 5000)).toBe(false);
  });
});

describe("reply-notify pending flag", () => {
  it("consume returns true once per mark, then false", () => {
    markReplyNotifyPending("s1");
    expect(consumeReplyNotifyPending("s1")).toBe(true);
    expect(consumeReplyNotifyPending("s1")).toBe(false);
  });

  it("unmarked sessions (Goal / CLI-driven runs) never consume", () => {
    expect(consumeReplyNotifyPending("never-marked")).toBe(false);
  });

  it("clear drops the flag without consuming", () => {
    markReplyNotifyPending("s2");
    clearReplyNotifyPending("s2");
    expect(consumeReplyNotifyPending("s2")).toBe(false);
  });

  it("flags are per-session", () => {
    markReplyNotifyPending("s3");
    expect(consumeReplyNotifyPending("s4")).toBe(false);
    expect(consumeReplyNotifyPending("s3")).toBe(true);
  });
});

describe("resolveNotifySound", () => {
  const WIN_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const MAC_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

  it("maps the three tones to winrt sound names on Windows", () => {
    expect(resolveNotifySound("done", WIN_UA)).toBe("Default");
    expect(resolveNotifySound("needsYou", WIN_UA)).toBe("IM");
    expect(resolveNotifySound("alert", WIN_UA)).toBe("Reminder");
  });

  it("maps to system sound names on macOS", () => {
    expect(resolveNotifySound("done", MAC_UA)).toBe("Glass");
    expect(resolveNotifySound("needsYou", MAC_UA)).toBe("Ping");
    expect(resolveNotifySound("alert", MAC_UA)).toBe("Basso");
  });

  it("maps to freedesktop names on Linux", () => {
    expect(resolveNotifySound("needsYou", LINUX_UA)).toBe(
      "message-new-instant",
    );
  });

  it("returns undefined on an unrecognized platform (send without sound)", () => {
    expect(resolveNotifySound("done", "Node.js/22")).toBeUndefined();
    expect(resolveNotifySound("done", "")).toBeUndefined();
  });
});

describe("sendGatedSystemNotification", () => {
  beforeEach(() => {
    resetStores();
    notificationMocks.isPermissionGranted.mockReset();
    notificationMocks.isPermissionGranted.mockResolvedValue(true);
    notificationMocks.requestPermission.mockReset();
    notificationMocks.requestPermission.mockResolvedValue("granted");
    notificationMocks.sendNotification.mockReset();
    windowMocks.isFocused.mockReset();
    windowMocks.isFocused.mockResolvedValue(false);
  });

  it("sends when the pref is on, window unfocused, permission granted", async () => {
    await sendGatedSystemNotification("goalEnd", {
      title: "done",
      body: "objective",
    });

    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: "done",
      body: "objective",
    });
  });

  it("skips when the matching pref is off", async () => {
    usePrefsStore.setState({ notifyOnGoalEnd: false });

    await sendGatedSystemNotification("goalEnd", { title: "t", body: "b" });

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("gates replyDone notifications on the replyDone pref", async () => {
    usePrefsStore.setState({ notifyOnReplyDone: false });

    await sendGatedSystemNotification("replyDone", { title: "t", body: "b" });

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();

    usePrefsStore.setState({ notifyOnReplyDone: true });

    await sendGatedSystemNotification("replyDone", { title: "t", body: "b" });

    expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("gates approval notifications on the approval pref, not the goal pref", async () => {
    usePrefsStore.setState({ notifyOnGoalEnd: false, notifyOnApproval: true });

    await sendGatedSystemNotification("approval", {
      title: "t",
      body: "b",
      throttleKey: "approval:pref-split",
    });

    expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("skips when the window is focused (toast already covers it)", async () => {
    windowMocks.isFocused.mockResolvedValue(true);

    await sendGatedSystemNotification("goalEnd", { title: "t", body: "b" });

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("requests permission lazily and sends on grant", async () => {
    notificationMocks.isPermissionGranted.mockResolvedValue(false);
    notificationMocks.requestPermission.mockResolvedValue("granted");

    await sendGatedSystemNotification("goalEnd", { title: "t", body: "b" });

    expect(notificationMocks.requestPermission).toHaveBeenCalled();
    expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("skips when permission is denied", async () => {
    notificationMocks.isPermissionGranted.mockResolvedValue(false);
    notificationMocks.requestPermission.mockResolvedValue("denied");

    await sendGatedSystemNotification("goalEnd", { title: "t", body: "b" });

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("attaches the tone sound for the detected platform", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    try {
      await sendGatedSystemNotification("approval", {
        title: "t",
        body: "b",
        throttleKey: "approval:sound-on",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: "t",
      body: "b",
      sound: "IM",
    });
  });

  it("honors a tone override (failed goal sounds like an alert)", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    try {
      await sendGatedSystemNotification("goalEnd", {
        title: "t",
        body: "b",
        tone: "alert",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: "t",
      body: "b",
      sound: "Reminder",
    });
  });

  it("omits the sound when the notifySound pref is off", async () => {
    usePrefsStore.setState({ notifySound: false });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    try {
      await sendGatedSystemNotification("goalEnd", { title: "t", body: "b" });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(notificationMocks.sendNotification).toHaveBeenCalledWith({
      title: "t",
      body: "b",
    });
  });

  it("collapses a burst sharing a throttleKey into one notification", async () => {
    await sendGatedSystemNotification("approval", {
      title: "t",
      body: "one",
      throttleKey: "approval:burst-session",
    });
    await sendGatedSystemNotification("approval", {
      title: "t",
      body: "two",
      throttleKey: "approval:burst-session",
    });

    expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("never throws when the Tauri window API is unavailable", async () => {
    windowMocks.isFocused.mockRejectedValue(new Error("no tauri runtime"));

    await expect(
      sendGatedSystemNotification("goalEnd", { title: "t", body: "b" }),
    ).resolves.toBeUndefined();
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });
});
