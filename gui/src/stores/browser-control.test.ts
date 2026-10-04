import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_BRIDGE_EVENT,
  statusForBridge,
  type BrowserBridgeStatus,
  type BrowserControlProbe,
} from "@/lib/browser-control";
import { useBrowserControlStore } from "@/stores/browser-control";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

type BridgeHandler = (event: { payload: BrowserBridgeStatus }) => void;

function bridge(patch: Partial<BrowserBridgeStatus> = {}): BrowserBridgeStatus {
  return {
    state: "running",
    role: "master",
    extensionConnected: false,
    tabCount: 0,
    errorKind: null,
    error: null,
    pid: 4242,
    updatedAt: "2026-10-04T00:00:00.000Z",
    ...patch,
  };
}

function probeResult(
  patch: Partial<BrowserControlProbe> = {},
): BrowserControlProbe {
  return {
    status: "connected",
    extensionDir: "/data/browser-control/tmwd_cdp_bridge",
    manifestVersion: "1.0.0",
    tabCount: 2,
    sampleTitle: "Example Domain",
    message: "浏览器控制已连接。",
    ...patch,
  };
}

function probeCalls() {
  return getTauriMocks().invoke.mock.calls.filter(
    ([command]) => command === "probe_browser_control",
  );
}

/** Let a triggered probe reach `invoke` before asserting it did not. */
function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setVerified(verified: boolean) {
  useBrowserControlStore.setState({ verified, verificationHydrated: true });
}

function readyToasts() {
  return useUiStore
    .getState()
    .toasts.filter((toast) => toast.id === "browser-control-ready");
}

beforeEach(() => {
  useBrowserControlStore.setState(
    useBrowserControlStore.getInitialState(),
    true,
  );
  useUiStore.setState({ toasts: [] });
});

describe("statusForBridge", () => {
  it("maps the live bridge state to the UI status", () => {
    expect(statusForBridge(bridge({ tabCount: 3 }), false)).toBe("connected");
    expect(
      statusForBridge(bridge({ extensionConnected: true, tabCount: 3 }), false),
    ).toBe("connected");
    expect(statusForBridge(bridge({ extensionConnected: true }), false)).toBe(
      "connected_no_tabs",
    );
    expect(statusForBridge(bridge(), true)).toBe("offline");
    expect(statusForBridge(bridge(), false)).toBe("not_connected");
    expect(statusForBridge(bridge({ state: "error" }), true)).toBe("error");
    expect(statusForBridge(bridge({ state: "starting" }), true)).toBe(
      "unknown",
    );
    expect(statusForBridge(bridge({ state: "stopped" }), true)).toBe("unknown");
  });
});

describe("browser-control store with the live bridge", () => {
  it("applies bridge updates and surfaces bridge errors", () => {
    setVerified(true);
    const store = useBrowserControlStore.getState();

    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 2 }));
    expect(useBrowserControlStore.getState().status).toBe("connected");

    store.applyBridgeStatus(bridge());
    expect(useBrowserControlStore.getState().status).toBe("offline");

    store.applyBridgeStatus(
      bridge({
        state: "error",
        role: null,
        errorKind: "port_in_use",
        error: "浏览器控制端口 18765 被其他程序占用。",
      }),
    );
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: "浏览器控制端口 18765 被其他程序占用。",
    });

    store.applyBridgeStatus(bridge({ state: "starting", role: null }));
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "unknown",
      error: null,
    });
    expect(probeCalls()).toHaveLength(0);
  });

  it("auto-verifies once when the extension first connects", async () => {
    setVerified(false);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "probe_browser_control") return probeResult();
      return undefined;
    });
    const store = useBrowserControlStore.getState();

    store.applyBridgeStatus(bridge());
    expect(useBrowserControlStore.getState().status).toBe("not_connected");
    expect(probeCalls()).toHaveLength(0);

    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));
    await vi.waitFor(() => {
      expect(probeCalls()).toEqual([
        ["probe_browser_control", { context: "auto_verify" }],
      ]);
    });
    await vi.waitFor(() => {
      expect(useBrowserControlStore.getState().verified).toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "browser_control_verified",
      value: true,
    });
    // The live tab count wins over the probe's snapshot.
    expect(useBrowserControlStore.getState().status).toBe("connected");

    // Tab churn after verification never re-probes.
    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 4 }));
    await flushAsync();
    expect(probeCalls()).toHaveLength(1);

    // The moment setup completes on its own offers the demo, once.
    expect(readyToasts()).toHaveLength(1);
    expect(readyToasts()[0]).toMatchObject({
      severity: "info",
      autoDismissMs: 0,
      action: { kind: "try_browser_control" },
    });
  });

  it("offers the demo only for the automatic verification", async () => {
    setVerified(false);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "probe_browser_control") return probeResult();
      return undefined;
    });

    await useBrowserControlStore.getState().probe("manual");
    expect(useBrowserControlStore.getState().verified).toBe(true);
    expect(readyToasts()).toHaveLength(0);
  });

  it("offers nothing when the automatic verification fails", async () => {
    setVerified(false);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "probe_browser_control") {
        return probeResult({ status: "error", message: "脚本测试失败" });
      }
      return undefined;
    });

    await useBrowserControlStore.getState().probe("auto_verify");
    expect(readyToasts()).toHaveLength(0);
  });

  it("re-arms the automatic probe after the extension disconnects", async () => {
    setVerified(false);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "probe_browser_control") {
        return probeResult({
          status: "error",
          message: "扩展已连接，但网页脚本测试失败",
        });
      }
      return undefined;
    });
    const store = useBrowserControlStore.getState();

    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));
    await vi.waitFor(() => {
      expect(useBrowserControlStore.getState().busy).toBe(false);
    });
    expect(useBrowserControlStore.getState()).toMatchObject({
      verified: false,
      status: "error",
    });

    // Still connected: no retry loop on every update.
    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 2 }));
    await flushAsync();
    expect(probeCalls()).toHaveLength(1);

    store.applyBridgeStatus(bridge());
    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));
    await vi.waitFor(() => {
      expect(probeCalls()).toHaveLength(2);
    });
  });

  it("does not probe automatically once verified", async () => {
    setVerified(true);
    useBrowserControlStore
      .getState()
      .applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));
    await flushAsync();
    expect(probeCalls()).toHaveLength(0);
  });

  it("keeps the bridge's status when the folder sync fails", async () => {
    setVerified(true);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "ensure_browser_control_layout") {
        throw new Error("disk full");
      }
      return undefined;
    });
    const store = useBrowserControlStore.getState();
    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));

    await store.ensureLayout();
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "connected",
      layoutError: "disk full",
    });
  });

  it("subscribes before reading the snapshot and stops on disconnect", async () => {
    const { invoke, listen } = getTauriMocks();
    const unlisten = vi.fn();
    let handler: BridgeHandler | undefined;
    listen.mockImplementation(async (event, fn) => {
      expect(event).toBe(BROWSER_BRIDGE_EVENT);
      handler = fn as unknown as BridgeHandler;
      return unlisten;
    });
    invoke.mockImplementation(async (command) => {
      if (command === "get_pref_json") return true;
      if (command === "get_browser_bridge_status") {
        return bridge({ extensionConnected: true });
      }
      return undefined;
    });

    const disconnect = useBrowserControlStore.getState().connectLiveStatus();
    await vi.waitFor(() => {
      expect(useBrowserControlStore.getState().status).toBe(
        "connected_no_tabs",
      );
    });
    const listenOrder = listen.mock.invocationCallOrder[0];
    const snapshotOrder =
      invoke.mock.invocationCallOrder[
        invoke.mock.calls.findIndex(
          ([command]) => command === "get_browser_bridge_status",
        )
      ];
    expect(listenOrder).toBeLessThan(snapshotOrder);

    handler!({ payload: bridge({ extensionConnected: true, tabCount: 5 }) });
    expect(useBrowserControlStore.getState().status).toBe("connected");

    disconnect();
    expect(unlisten).toHaveBeenCalledTimes(1);
    handler!({ payload: bridge() });
    expect(useBrowserControlStore.getState().status).toBe("connected");
  });

  it("drops a snapshot that arrives after a fresher event", async () => {
    const { invoke, listen } = getTauriMocks();
    let handler: BridgeHandler | undefined;
    let resolveSnapshot!: (value: BrowserBridgeStatus) => void;
    listen.mockImplementation(async (_event, fn) => {
      handler = fn as unknown as BridgeHandler;
      return () => {};
    });
    invoke.mockImplementation((command) => {
      if (command === "get_pref_json") return Promise.resolve(true);
      if (command === "get_browser_bridge_status") {
        return new Promise((resolve) => {
          resolveSnapshot = resolve as (value: BrowserBridgeStatus) => void;
        });
      }
      return Promise.resolve(undefined);
    });

    useBrowserControlStore.getState().connectLiveStatus();
    await vi.waitFor(() => {
      expect(resolveSnapshot).toBeDefined();
    });
    handler!({ payload: bridge({ extensionConnected: true, tabCount: 2 }) });
    resolveSnapshot(bridge({ state: "starting", role: null }));
    await Promise.resolve();
    await Promise.resolve();
    expect(useBrowserControlStore.getState().status).toBe("connected");
  });
});
