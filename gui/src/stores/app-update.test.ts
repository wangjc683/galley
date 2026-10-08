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
