import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_BRIDGE_EVENT,
  statusForBridge,
  type BrowserBridgeStatus,
  type BrowserControlLayout,
  type BrowserControlProbe,
} from "@/lib/browser-control";
import {
  BROWSER_CONTROL_READY_TOAST_ID,
  useBrowserControlStore,
} from "@/stores/browser-control";
import { usePrefsStore } from "@/stores/prefs";
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
    kind: "connected",
    extensionDir: "/data/browser-control/tmwd_cdp_bridge",
    manifestVersion: "1.0.0",
    tabCount: 2,
    sampleTitle: "Example Domain",
    message: "浏览器控制已连接。",
    detail: null,
    ...patch,
  };
}

const LAYOUT: BrowserControlLayout = {
  extensionDir: "/data/browser-control/tmwd_cdp_bridge",
  sourceDir: "/code/assets/tmwd_cdp_bridge",
  manifestVersion: "1.0.0",
  filesCopied: 4,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Route `invoke` by command; unknown commands resolve undefined. */
function mockInvoke(
  handlers: Partial<Record<string, () => unknown | Promise<unknown>>>,
) {
  getTauriMocks().invoke.mockImplementation(async (command) => {
    const handler = handlers[command];
    return handler ? handler() : undefined;
  });
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
    .toasts.filter((toast) => toast.id === BROWSER_CONTROL_READY_TOAST_ID);
}

beforeEach(() => {
  useBrowserControlStore.setState(
    useBrowserControlStore.getInitialState(),
    true,
  );
  useUiStore.setState({ toasts: [] });
  usePrefsStore.setState({ activeRuntimeKind: "managed" });
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

    // No message from the bridge: no detail, and no sentence made up in
    // the store (the UI words the error status itself).
    store.applyBridgeStatus(
      bridge({ state: "error", role: null, errorKind: "exited" }),
    );
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
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
    // The automatic run reports its outcome like a manual test.
    expect(useBrowserControlStore.getState().testOutcome).toEqual({
      kind: "connected",
      detail: null,
    });

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
        return probeResult({
          status: "error",
          kind: "script_failed",
          message: "脚本测试失败",
          detail: "boom",
        });
      }
      return undefined;
    });

    await useBrowserControlStore.getState().probe("auto_verify");
    expect(readyToasts()).toHaveLength(0);
  });

  it("offers no demo when the automatic verification lands after a switch to external GA", async () => {
    setVerified(false);
    const pending = deferred<BrowserControlProbe>();
    mockInvoke({ probe_browser_control: () => pending.promise });

    const run = useBrowserControlStore.getState().probe("auto_verify");
    await vi.waitFor(() => expect(probeCalls()).toHaveLength(1));
    usePrefsStore.setState({ activeRuntimeKind: "external" });
    pending.resolve(probeResult());
    await run;

    expect(useBrowserControlStore.getState().verified).toBe(true);
    expect(readyToasts()).toHaveLength(0);
  });

  it("re-arms the automatic probe after the extension disconnects", async () => {
    setVerified(false);
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "probe_browser_control") {
        return probeResult({
          status: "error",
          kind: "script_failed",
          message: "插件已连接，但网页脚本测试失败：boom",
          detail: "boom",
        });
      }
      return undefined;
    });
    const store = useBrowserControlStore.getState();

    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));
    await vi.waitFor(() => {
      expect(probeCalls()).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(useBrowserControlStore.getState().probing).toBe(false);
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

  it("recovers from a folder-sync error once a sync succeeds", async () => {
    for (const [verified, recovered] of [
      [true, "offline"],
      [false, "not_connected"],
    ] as const) {
      useBrowserControlStore.setState(
        useBrowserControlStore.getInitialState(),
        true,
      );
      setVerified(verified);
      mockInvoke({
        ensure_browser_control_layout: () => {
          throw new Error("disk full");
        },
      });
      const store = useBrowserControlStore.getState();

      await store.ensureLayout();
      expect(useBrowserControlStore.getState()).toMatchObject({
        status: "error",
        error: "disk full",
        layoutError: "disk full",
        syncingLayout: false,
      });

      mockInvoke({ ensure_browser_control_layout: () => LAYOUT });
      await expect(store.ensureLayout()).resolves.toEqual(LAYOUT);
      expect(useBrowserControlStore.getState()).toMatchObject({
        layout: LAYOUT,
        status: recovered,
        error: null,
        layoutError: null,
        syncingLayout: false,
      });
    }
  });

  it("keeps the bridge's own error text through folder syncs", async () => {
    setVerified(true);
    const portInUse = "浏览器控制端口 18765 被其他程序占用。";
    const store = useBrowserControlStore.getState();
    store.applyBridgeStatus(
      bridge({
        state: "error",
        role: null,
        errorKind: "port_in_use",
        error: portInUse,
      }),
    );

    // A sync in flight does not blank the detail the topbar menu shows.
    const pending = deferred<BrowserControlLayout>();
    mockInvoke({ ensure_browser_control_layout: () => pending.promise });
    const sync = store.ensureLayout();
    expect(useBrowserControlStore.getState()).toMatchObject({
      syncingLayout: true,
      status: "error",
      error: portInUse,
    });
    pending.resolve(LAYOUT);
    await sync;
    expect(useBrowserControlStore.getState()).toMatchObject({
      syncingLayout: false,
      status: "error",
      error: portInUse,
    });

    // Recovering from a folder error hands the detail back to the bridge.
    mockInvoke({
      ensure_browser_control_layout: () => {
        throw new Error("disk full");
      },
    });
    await store.ensureLayout();
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: "disk full",
      layoutError: "disk full",
    });
    mockInvoke({ ensure_browser_control_layout: () => LAYOUT });
    await store.ensureLayout();
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: portInUse,
      layoutError: null,
    });
  });

  it("keeps probing until the probe ends, whatever the folder sync does", async () => {
    setVerified(true);
    const probe = deferred<BrowserControlProbe>();
    const layout = deferred<BrowserControlLayout>();
    mockInvoke({
      probe_browser_control: () => probe.promise,
      ensure_browser_control_layout: () => layout.promise,
    });
    const store = useBrowserControlStore.getState();

    const probing = store.probe("manual");
    const syncing = store.ensureLayout();
    await vi.waitFor(() => expect(probeCalls()).toHaveLength(1));
    expect(useBrowserControlStore.getState()).toMatchObject({
      probing: true,
      syncingLayout: true,
    });

    layout.resolve(LAYOUT);
    await syncing;
    expect(useBrowserControlStore.getState()).toMatchObject({
      probing: true,
      syncingLayout: false,
    });

    probe.resolve(probeResult());
    await probing;
    expect(useBrowserControlStore.getState().probing).toBe(false);
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

describe("browser-control connection test outcome", () => {
  it("records each probe's outcome and keeps the raw detail as the error", async () => {
    setVerified(true);
    mockInvoke({
      probe_browser_control: () =>
        probeResult({
          status: "error",
          kind: "script_failed",
          tabCount: 1,
          message: "插件已连接，但网页脚本测试失败：boom",
          detail: "boom",
        }),
    });
    const store = useBrowserControlStore.getState();

    await store.probe("manual");
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: "boom",
      testOutcome: { kind: "script_failed", detail: "boom" },
    });

    // The next test clears the outcome while it runs; the error detail
    // stays with the status until the result lands.
    const pending = deferred<BrowserControlProbe>();
    mockInvoke({ probe_browser_control: () => pending.promise });
    const run = store.probe("recheck");
    expect(useBrowserControlStore.getState()).toMatchObject({
      probing: true,
      testOutcome: null,
      status: "error",
      error: "boom",
    });
    pending.resolve(probeResult());
    await run;
    expect(useBrowserControlStore.getState()).toMatchObject({
      probing: false,
      status: "connected",
      error: null,
      testOutcome: { kind: "connected", detail: null },
    });
  });

  it("stores no made-up sentence when a failed probe has no detail", async () => {
    setVerified(true);
    mockInvoke({
      probe_browser_control: () =>
        probeResult({
          status: "error",
          kind: "no_result",
          tabCount: 0,
          message: "浏览器控制测试没有返回有效结果。",
          detail: null,
        }),
    });

    await useBrowserControlStore.getState().probe("manual");
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: null,
      testOutcome: { kind: "no_result", detail: null },
    });
  });

  it("records an exception outcome when the probe command fails", async () => {
    setVerified(true);
    mockInvoke({
      probe_browser_control: () => {
        throw new Error("spawn python3: No such file or directory");
      },
    });

    await expect(
      useBrowserControlStore.getState().probe("manual"),
    ).resolves.toBeNull();
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "error",
      error: "spawn python3: No such file or directory",
      probing: false,
      testOutcome: {
        kind: "exception",
        detail: "spawn python3: No such file or directory",
      },
    });
  });

  it("drops the outcome when the live status changes, not on tab churn", async () => {
    setVerified(true);
    mockInvoke({ probe_browser_control: () => probeResult() });
    const store = useBrowserControlStore.getState();
    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 1 }));

    await store.probe("manual");
    expect(useBrowserControlStore.getState().testOutcome).toEqual({
      kind: "connected",
      detail: null,
    });

    store.applyBridgeStatus(bridge({ extensionConnected: true, tabCount: 3 }));
    expect(useBrowserControlStore.getState().testOutcome).toEqual({
      kind: "connected",
      detail: null,
    });

    store.applyBridgeStatus(bridge());
    expect(useBrowserControlStore.getState()).toMatchObject({
      status: "offline",
      testOutcome: null,
    });

    useBrowserControlStore.setState({
      testOutcome: { kind: "not_connected", detail: null },
    });
    store.resetLiveStatus();
    expect(useBrowserControlStore.getState().testOutcome).toBeNull();
  });

  it("answers a manual test from the running bridge while it does not see the extension", async () => {
    setVerified(true);
    mockInvoke({ probe_browser_control: () => probeResult() });
    const store = useBrowserControlStore.getState();
    store.applyBridgeStatus(bridge());
    const before = useBrowserControlStore.getState();
    expect(before.status).toBe("offline");

    for (const context of ["manual", "recheck"] as const) {
      useBrowserControlStore.setState({ testOutcome: null });
      await expect(store.probe(context)).resolves.toBeNull();
      expect(useBrowserControlStore.getState()).toMatchObject({
        testOutcome: { kind: "not_connected", detail: null },
        probing: false,
        status: "offline",
        verified: true,
        lastProbe: null,
      });
    }
    expect(probeCalls()).toHaveLength(0);

    // The automatic verification is never short-circuited.
    await store.probe("auto_verify");
    expect(probeCalls()).toHaveLength(1);
  });

  it.each([
    ["no report yet", null],
    ["starting", bridge({ state: "starting", role: null })],
    ["stopped", bridge({ state: "stopped", role: null })],
    [
      "error",
      bridge({
        state: "error",
        role: null,
        errorKind: "port_in_use",
        error: "port",
      }),
    ],
  ] as const)(
    "still probes when the bridge is not running (%s)",
    async (_label, current) => {
      setVerified(true);
      mockInvoke({ probe_browser_control: () => probeResult() });
      if (current) {
        useBrowserControlStore.getState().applyBridgeStatus(current);
      }

      const result = await useBrowserControlStore.getState().probe("manual");
      expect(result).toMatchObject({ kind: "connected" });
      expect(probeCalls()).toEqual([
        ["probe_browser_control", { context: "manual" }],
      ]);
      expect(useBrowserControlStore.getState().testOutcome).toEqual({
        kind: "connected",
        detail: null,
      });
    },
  );
});
