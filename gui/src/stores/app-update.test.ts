import { beforeEach, describe, expect, it, vi } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import type { AppUpdateProgressEvent } from "@/lib/app-update";
import { useAppUpdateStore } from "@/stores/app-update";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

// plugin-process resolves its own copy of @tauri-apps/api, which the
// shared invoke mock does not reach.
const relaunch = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

type ProgressHandler = (event: { payload: AppUpdateProgressEvent }) => void;

const AVAILABLE = {
  kind: "available",
  currentVersion: "0.3.2",
  version: "0.4.0",
  body: null,
  date: null,
} as const;

const READY = {
  kind: "ready",
  currentVersion: "0.3.2",
  version: "0.4.0",
} as const;

const RESULT = { currentVersion: "0.3.2", version: "0.4.0" };

function setTaskRunning(): void {
  useMessagesStore.setState({
    byId: { s1: { ...EMPTY_MESSAGES, agentRunning: true } },
  });
}

function invokedCommands(): string[] {
  return getTauriMocks().invoke.mock.calls.map(([command]) => command);
}

function invokeOrder(command: string): number {
  const mocks = getTauriMocks();
  const index = mocks.invoke.mock.calls.findIndex(([c]) => c === command);
  return mocks.invoke.mock.invocationCallOrder[index];
}

beforeEach(() => {
  relaunch.mockReset();
  relaunch.mockResolvedValue(undefined);
  resetStores();
  // Error messages are asserted against the English copy.
  usePrefsStore.setState({ languagePreference: "en-US" });
  useAppUpdateStore.setState({ status: { kind: "idle" }, lastCheckedAt: null });
});

describe("app-update store download", () => {
  beforeEach(() => {
    useAppUpdateStore.setState({ status: AVAILABLE });
  });

  it("subscribes before invoking, applies progress, and unlistens", async () => {
    const mocks = getTauriMocks();
    const unlisten = vi.fn();
    let progressHandler: ProgressHandler | undefined;
    mocks.listen.mockImplementation(async (_event, handler) => {
      progressHandler = handler as unknown as ProgressHandler;
      return unlisten;
    });

    let resolveDownload!: (value: unknown) => void;
    mocks.invoke.mockImplementation((command) => {
      if (command === "download_app_update") {
        return new Promise((resolve) => {
          resolveDownload = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const done = useAppUpdateStore.getState().download();
    expect(useAppUpdateStore.getState().status).toEqual({
      kind: "downloading",
      phase: "downloading",
      version: "0.4.0",
    });
    await vi.waitFor(() => {
      expect(progressHandler).toBeDefined();
    });

    // Listener registered before the download command fired.
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      invokeOrder("download_app_update"),
    );
    expect(invokedCommands()).not.toContain("install_app_update");

    progressHandler!({
      payload: { phase: "downloading", downloaded: 42, total: 100 },
    });
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "downloading",
      phase: "downloading",
      version: "0.4.0",
      progress: { downloaded: 42, total: 100 },
    });

    resolveDownload(RESULT);
    await done;
    expect(useAppUpdateStore.getState().status).toEqual(READY);
    expect(unlisten).toHaveBeenCalled();

    // A late event must not resurrect the downloading state.
    progressHandler!({
      payload: { phase: "downloading", downloaded: 99, total: 100 },
    });
    expect(useAppUpdateStore.getState().status.kind).toBe("ready");
  });

  it("does not wait for running tasks", async () => {
    setTaskRunning();
    getTauriMocks().invoke.mockImplementation(async (command) =>
      command === "download_app_update" ? RESULT : undefined,
    );

    await useAppUpdateStore.getState().download();

    expect(invokedCommands()).toContain("download_app_update");
    expect(useAppUpdateStore.getState().status).toEqual(READY);
  });

  it("does nothing once the update is ready", async () => {
    useAppUpdateStore.setState({ status: READY });

    await useAppUpdateStore.getState().download();

    expect(invokedCommands()).toEqual([]);
    expect(useAppUpdateStore.getState().status).toEqual(READY);
  });

  it("reports a failed download and unlistens", async () => {
    const mocks = getTauriMocks();
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValue(unlisten);
    mocks.invoke.mockImplementation((command) =>
      command === "download_app_update"
        ? Promise.reject(new Error("download request failed"))
        : Promise.resolve(undefined),
    );

    await useAppUpdateStore.getState().download();

    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "error",
      message: enCopy.updates.downloadFailed,
      detail: "download request failed",
    });
    expect(unlisten).toHaveBeenCalled();
  });

  it("words an unrecognized download failure as a download failure", async () => {
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "download_app_update"
        ? Promise.reject("something odd")
        : Promise.resolve(undefined),
    );

    await useAppUpdateStore.getState().download();

    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "error",
      message: enCopy.updates.downloadFailed,
    });
  });
});

describe("app-update store check", () => {
  function mockCheckAvailable(): ReturnType<typeof getTauriMocks> {
    const mocks = getTauriMocks();
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "check_app_update") return AVAILABLE;
      if (command === "download_app_update") return RESULT;
      return undefined;
    });
    return mocks;
  }

  it("holds back the download when downloadIfAvailable is false", async () => {
    mockCheckAvailable();

    await useAppUpdateStore
      .getState()
      .check({ silent: true, downloadIfAvailable: false });

    // Detection still surfaces — the TopBar indicator feeds on this.
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "available",
      version: "0.4.0",
    });
    expect(invokedCommands()).not.toContain("download_app_update");
  });

  it("auto-downloads when downloadIfAvailable is true", async () => {
    mockCheckAvailable();

    await useAppUpdateStore
      .getState()
      .check({ silent: true, downloadIfAvailable: true });

    expect(invokedCommands()).toContain("download_app_update");
    expect(invokedCommands()).not.toContain("install_app_update");
    expect(useAppUpdateStore.getState().status).toEqual(READY);
  });

  it("auto-downloads while a task runs", async () => {
    mockCheckAvailable();
    setTaskRunning();

    await useAppUpdateStore
      .getState()
      .check({ silent: true, downloadIfAvailable: true });

    expect(invokedCommands()).toContain("download_app_update");
    expect(useAppUpdateStore.getState().status).toEqual(READY);
  });

  it("downloads after a manual check whatever the auto-download pref", async () => {
    mockCheckAvailable();

    await useAppUpdateStore.getState().check({ silent: false });

    expect(invokedCommands()).toContain("download_app_update");
  });
});

describe("app-update store errors and the update proxy prefix link", () => {
  // Core's error strings, as `core/src/app_update.rs` formats them.
  const UNREACHABLE_CHANNEL =
    "Could not fetch a valid release JSON from the remote";
  const checkError = (endpoint: string, detail: string) =>
    `update_error: phase=check; endpoint=${endpoint}; detail=${detail}`;
  const downloadError = (detail: string, url?: string) =>
    url === undefined
      ? `update_error: phase=download; detail=${detail}`
      : `update_error: phase=download; url=${url}; detail=${detail}`;
  const MANIFEST =
    "https://raw.example.com/o/r/main/updates/stable/latest.json";
  const PACKAGE = "https://github.com/o/r/releases/download/v1/a.exe";
  const PREFIX = "https://example.com/";

  async function checkFailsWith(error: string) {
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "check_app_update"
        ? Promise.reject(error)
        : Promise.resolve(undefined),
    );
    await useAppUpdateStore.getState().check({ silent: false });
    return useAppUpdateStore.getState().status;
  }

  async function downloadFailsWith(error: string) {
    useAppUpdateStore.setState({ status: AVAILABLE });
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "download_app_update"
        ? Promise.reject(error)
        : Promise.resolve(undefined),
    );
    await useAppUpdateStore.getState().download();
    return useAppUpdateStore.getState().status;
  }

  async function installFailsWith(error: string) {
    useAppUpdateStore.setState({ status: READY });
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "install_app_update"
        ? Promise.reject(error)
        : Promise.resolve(undefined),
    );
    await useAppUpdateStore.getState().restart();
    return useAppUpdateStore.getState().status;
  }

  it("offers the link for the three network-type causes", async () => {
    expect(
      await checkFailsWith(checkError(MANIFEST, UNREACHABLE_CHANNEL)),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.channelUnavailable,
      suggestProxyPrefix: true,
    });
    expect(
      await checkFailsWith(checkError(MANIFEST, "operation timed out")),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.networkUnavailable,
      suggestProxyPrefix: true,
    });
    expect(
      await downloadFailsWith(downloadError("connection reset")),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.downloadFailed,
      suggestProxyPrefix: true,
    });
  });

  it("words a check that never got an answer as the network, prefixed or not", async () => {
    const detail = "error sending request for url (https://u/latest.json)";
    for (const endpoint of [
      "https://u/latest.json",
      "https://example.com/https://u/latest.json",
    ]) {
      expect(await checkFailsWith(checkError(endpoint, detail))).toMatchObject({
        kind: "error",
        message: enCopy.updates.networkUnavailable,
        suggestProxyPrefix: true,
      });
    }
  });

  it("does not offer it for other causes", async () => {
    expect(
      await downloadFailsWith(
        downloadError("signature verification failed: minisign"),
      ),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.signatureInvalid,
      suggestProxyPrefix: false,
    });
    expect(
      await checkFailsWith(checkError(MANIFEST, "missing field `version`")),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.invalidManifest,
      suggestProxyPrefix: false,
    });
    expect(await installFailsWith("no_prepared_update")).toMatchObject({
      kind: "error",
      message: enCopy.updates.preparedUpdateMissing,
      suggestProxyPrefix: false,
    });
    expect(
      await installFailsWith("failed to install: disk full"),
    ).toMatchObject({
      kind: "error",
      message: enCopy.updates.installFailed,
      suggestProxyPrefix: false,
    });
  });

  it("classifies errors that carry the prefixed address the same way", async () => {
    for (const detail of [UNREACHABLE_CHANNEL, "operation timed out", "odd"]) {
      const direct = await checkFailsWith(checkError(MANIFEST, detail));
      const proxied = await checkFailsWith(
        checkError(`${PREFIX}${MANIFEST}`, detail),
      );
      expect(proxied.kind).toBe("error");
      if (direct.kind !== "error" || proxied.kind !== "error") continue;
      expect(proxied.message).toBe(direct.message);
      expect(proxied.suggestProxyPrefix).toBe(direct.suggestProxyPrefix);
    }
    for (const detail of [
      "Download request failed with status: 404 Not Found",
      "signature verification failed: minisign",
      "odd",
    ]) {
      const direct = await downloadFailsWith(downloadError(detail));
      const proxied = await downloadFailsWith(
        downloadError(detail, `${PREFIX}${PACKAGE}`),
      );
      expect(proxied.kind).toBe("error");
      if (direct.kind !== "error" || proxied.kind !== "error") continue;
      expect(proxied.message).toBe(direct.message);
      expect(proxied.suggestProxyPrefix).toBe(direct.suggestProxyPrefix);
    }
  });
});

describe("app-update store restart", () => {
  beforeEach(() => {
    useAppUpdateStore.setState({ status: READY });
  });

  it("waits while a task runs", async () => {
    setTaskRunning();

    await useAppUpdateStore.getState().restart();

    expect(invokedCommands()).toEqual([]);
    expect(relaunch).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().status).toEqual(READY);
  });

  it("does nothing before the update is downloaded", async () => {
    useAppUpdateStore.setState({ status: AVAILABLE });

    await useAppUpdateStore.getState().restart();

    expect(invokedCommands()).toEqual([]);
  });

  it("shows installing, installs, then relaunches", async () => {
    const mocks = getTauriMocks();
    const unlisten = vi.fn();
    let progressHandler: ProgressHandler | undefined;
    mocks.listen.mockImplementation(async (_event, handler) => {
      progressHandler = handler as unknown as ProgressHandler;
      return unlisten;
    });
    let resolveInstall!: (value: unknown) => void;
    mocks.invoke.mockImplementation((command) => {
      if (command === "install_app_update") {
        return new Promise((resolve) => {
          resolveInstall = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const done = useAppUpdateStore.getState().restart();
    expect(useAppUpdateStore.getState().status).toEqual({
      kind: "downloading",
      phase: "installing",
      version: "0.4.0",
    });
    await vi.waitFor(() => {
      expect(invokedCommands()).toContain("install_app_update");
    });
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      invokeOrder("install_app_update"),
    );
    expect(relaunch).not.toHaveBeenCalled();

    progressHandler!({ payload: { phase: "installing" } });
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "downloading",
      phase: "installing",
    });

    resolveInstall(RESULT);
    await done;
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(invokeOrder("install_app_update")).toBeLessThan(
      relaunch.mock.invocationCallOrder[0],
    );
    expect(unlisten).toHaveBeenCalled();
  });

  it("reports a missing prepared update without relaunching", async () => {
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "install_app_update"
        ? Promise.reject("no_prepared_update")
        : Promise.resolve(undefined),
    );

    await useAppUpdateStore.getState().restart();

    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "error",
      message: enCopy.updates.preparedUpdateMissing,
      detail: "no_prepared_update",
    });
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("words other install failures as install failures", async () => {
    getTauriMocks().invoke.mockImplementation((command) =>
      command === "install_app_update"
        ? Promise.reject("failed to install: disk full")
        : Promise.resolve(undefined),
    );

    await useAppUpdateStore.getState().restart();

    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "error",
      message: enCopy.updates.installFailed,
    });
  });
});
