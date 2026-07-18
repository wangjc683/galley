import { beforeEach, describe, expect, it } from "vitest";

import { usePrefsStore } from "@/stores/prefs";
import { resetStores } from "@/test/store-reset";
import { getTauriMocks } from "@/test/setup";

const tauriMocks = getTauriMocks();

function mockPrefs(values: Record<string, unknown>): void {
  tauriMocks.invoke.mockImplementation(async (command, args) => {
    if (command !== "get_pref_json") return undefined;
    const key = typeof args?.key === "string" ? args.key : "";
    return Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : null;
  });
}

describe("prefsStore", () => {
  beforeEach(() => {
    resetStores();
  });

  it("hydrates a valid conversation font size preference", async () => {
    mockPrefs({ conversation_font_size: "large" });

    await usePrefsStore.getState().hydratePrefs();

    expect(usePrefsStore.getState().conversationFontSize).toBe("large");
  });

  it("falls back to standard for an invalid conversation font size preference", async () => {
    usePrefsStore.setState({ conversationFontSize: "large" });
    mockPrefs({ conversation_font_size: "giant" });

    await usePrefsStore.getState().hydratePrefs();

    expect(usePrefsStore.getState().conversationFontSize).toBe("standard");
  });

  it("persists conversation font size changes", async () => {
    await usePrefsStore.getState().setConversationFontSize("small");

    expect(usePrefsStore.getState().conversationFontSize).toBe("small");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "conversation_font_size",
      value: "small",
    });
  });

  it("defaults the notification and app-behavior prefs to true", () => {
    const state = usePrefsStore.getState();
    expect(state.notifyOnGoalEnd).toBe(true);
    expect(state.notifyOnApproval).toBe(true);
    expect(state.keepInBackgroundOnClose).toBe(true);
    expect(state.autoDownloadUpdates).toBe(true);
  });

  it("hydrates persisted false values for the new boolean prefs", async () => {
    mockPrefs({
      notify_on_goal_end: false,
      notify_on_approval: false,
      keep_in_background_on_close: false,
      auto_download_updates: false,
    });

    await usePrefsStore.getState().hydratePrefs();

    const state = usePrefsStore.getState();
    expect(state.notifyOnGoalEnd).toBe(false);
    expect(state.notifyOnApproval).toBe(false);
    expect(state.keepInBackgroundOnClose).toBe(false);
    expect(state.autoDownloadUpdates).toBe(false);
  });

  it("keeps the true defaults when the new prefs are missing", async () => {
    mockPrefs({});

    await usePrefsStore.getState().hydratePrefs();

    const state = usePrefsStore.getState();
    expect(state.notifyOnGoalEnd).toBe(true);
    expect(state.notifyOnApproval).toBe(true);
    expect(state.keepInBackgroundOnClose).toBe(true);
    expect(state.autoDownloadUpdates).toBe(true);
  });

  it("persists notification pref changes under their keys", async () => {
    await usePrefsStore.getState().setNotifyOnGoalEnd(false);
    await usePrefsStore.getState().setNotifyOnApproval(false);
    await usePrefsStore.getState().setAutoDownloadUpdates(false);

    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "notify_on_goal_end",
      value: false,
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "notify_on_approval",
      value: false,
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "auto_download_updates",
      value: false,
    });
  });

  it("persists keepInBackgroundOnClose and pushes it into core", async () => {
    await usePrefsStore.getState().setKeepInBackgroundOnClose(false);

    expect(usePrefsStore.getState().keepInBackgroundOnClose).toBe(false);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_keep_in_background", {
      enabled: false,
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "keep_in_background_on_close",
      value: false,
    });
  });

  it("keeps state updated when the core push for keepInBackground fails", async () => {
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "set_keep_in_background") {
        throw new Error("core unavailable");
      }
      return undefined;
    });

    await usePrefsStore.getState().setKeepInBackgroundOnClose(false);

    expect(usePrefsStore.getState().keepInBackgroundOnClose).toBe(false);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "keep_in_background_on_close",
      value: false,
    });
  });
});
