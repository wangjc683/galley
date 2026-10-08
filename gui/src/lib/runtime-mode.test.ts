import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import { switchRuntimeKind } from "@/lib/runtime-mode";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

const tauriMocks = getTauriMocks();
const zh = copyForLanguage("zh-CN");

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

    await switchRuntimeKind("managed");

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(useSessionsStore.getState().activeSessionId).toBe("s-keep");
    expect(useUiStore.getState().screen).toBe("main");
    expect(useUiStore.getState().toasts).toEqual([]);
  });
});
