import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import { switchRuntimeKind } from "@/lib/runtime-mode";
import { BROWSER_CONTROL_READY_TOAST_ID } from "@/stores/browser-control";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import { makeAppError } from "@/types/app-error";
import type { RuntimeKind } from "@/types/session";

const tauriMocks = getTauriMocks();
const zh = copyForLanguage("zh-CN");

function pushBrowserControlReadyToast() {
  useUiStore.getState().pushToast(
    makeAppError({
      id: BROWSER_CONTROL_READY_TOAST_ID,
      category: "business",
      severity: "info",
      title: zh.toasts.browserControlReady,
      message: zh.toasts.browserControlReadyMessage,
      hint: null,
      retryable: false,
      context: "browser_control_auto_verify",
      traceback: null,
      action: {
        kind: "try_browser_control",
        label: zh.toasts.tryBrowserControl,
      },
      autoDismissMs: 0,
    }),
  );
}

function toastIds() {
  return useUiStore.getState().toasts.map((toast) => toast.id);
}

describe("switchRuntimeKind", () => {
  beforeEach(() => {
    resetStores();
    usePrefsStore.setState({
      activeRuntimeKind: "managed",
      languagePreference: "zh-CN",
    });
  });

  it("persists the new kind, clears old-runtime state, reloads sessions and confirms", async () => {
    const seenKinds: string[] = [];
    const hydrate = vi.fn(async () => {
      // The reload must already see the new runtime: hydrate filters
      // the session list by the active kind.
      seenKinds.push(usePrefsStore.getState().activeRuntimeKind);
    });
    useSessionsStore.setState({
      activeSessionId: "s-old",
      activeProjectFilter: "p-old",
      hydrate,
    });
    useRuntimeStore.setState({ pendingLLMIndex: 2 });
    useUiStore.setState({ screen: "main" });

    await switchRuntimeKind("external");

    expect(usePrefsStore.getState().activeRuntimeKind).toBe("external");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "active_runtime_kind",
      value: "external",
    });
    expect(useRuntimeStore.getState().pendingLLMIndex).toBeUndefined();
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();
    expect(useSessionsStore.getState().activeProjectFilter).toBeUndefined();
    expect(useUiStore.getState().screen).toBe("empty");
    expect(seenKinds).toEqual(["external"]);
    expect(useUiStore.getState().toasts).toMatchObject([
      {
        title: zh.toasts.switchedRuntime("external"),
        message: zh.toasts.runtimeSwitchKept,
      },
    ]);
  });

  it("does nothing when the kind is already active", async () => {
    const hydrate = vi.fn(async () => {});
    useSessionsStore.setState({ activeSessionId: "s-keep", hydrate });
    useUiStore.setState({ screen: "main" });
    pushBrowserControlReadyToast();

    await switchRuntimeKind("managed");

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(useSessionsStore.getState().activeSessionId).toBe("s-keep");
    expect(useUiStore.getState().screen).toBe("main");
    // A no-op switch leaves the Browser Control demo offer alone.
    expect(toastIds()).toEqual([BROWSER_CONTROL_READY_TOAST_ID]);
  });

  it.each<[RuntimeKind, RuntimeKind]>([
    ["managed", "external"],
    ["external", "managed"],
  ])(
    "dismisses the Browser Control demo toast on a %s → %s switch",
    async (from, to) => {
      usePrefsStore.setState({ activeRuntimeKind: from });
      useSessionsStore.setState({ hydrate: vi.fn(async () => {}) });
      pushBrowserControlReadyToast();
      expect(toastIds()).toEqual([BROWSER_CONTROL_READY_TOAST_ID]);

      await switchRuntimeKind(to);

      expect(toastIds()).not.toContain(BROWSER_CONTROL_READY_TOAST_ID);
      // The switch's own confirmation is the only toast left.
      expect(useUiStore.getState().toasts).toMatchObject([
        { title: zh.toasts.switchedRuntime(to) },
      ]);
    },
  );
});
