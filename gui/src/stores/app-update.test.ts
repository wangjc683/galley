import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUpdateProgressEvent } from "@/lib/app-update";
import { useAppUpdateStore } from "@/stores/app-update";
import { getTauriMocks } from "@/test/setup";

type ProgressHandler = (event: { payload: AppUpdateProgressEvent }) => void;

const AVAILABLE = {
  kind: "available",
  currentVersion: "0.3.2",
  version: "0.4.0",
  body: null,
  date: null,
} as const;

describe("app-update store download progress", () => {
  beforeEach(() => {
    useAppUpdateStore.setState({
      status: AVAILABLE,
      lastCheckedAt: null,
    });
  });

  it("subscribes before invoking, applies progress, and unlistens", async () => {
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

    const done = useAppUpdateStore.getState().downloadAndInstall();
    await vi.waitFor(() => {
      expect(progressHandler).toBeDefined();
    });

    // Listener registered before the install command fired.
    const listenOrder = mocks.listen.mock.invocationCallOrder[0];
    const installOrder =
      mocks.invoke.mock.invocationCallOrder[
        mocks.invoke.mock.calls.findIndex(
          ([command]) => command === "install_app_update",
        )
      ];
    expect(listenOrder).toBeLessThan(installOrder);

    progressHandler!({
      payload: { phase: "downloading", downloaded: 42, total: 100 },
    });
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "downloading",
      phase: "downloading",
      progress: { downloaded: 42, total: 100 },
    });

    progressHandler!({ payload: { phase: "installing" } });
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "downloading",
      phase: "installing",
    });

    resolveInstall({ currentVersion: "0.3.2", version: "0.4.0" });
    await done;
    expect(useAppUpdateStore.getState().status).toMatchObject({
      kind: "ready",
      version: "0.4.0",
    });
    expect(unlisten).toHaveBeenCalled();

    // A late event must not resurrect the downloading state.
    progressHandler!({
      payload: { phase: "downloading", downloaded: 99, total: 100 },
    });
    expect(useAppUpdateStore.getState().status.kind).toBe("ready");
  });

  it("unlistens when the install command fails", async () => {
    const mocks = getTauriMocks();
    const unlisten = vi.fn();
    mocks.listen.mockResolvedValue(unlisten);
    mocks.invoke.mockImplementation((command) =>
      command === "install_app_update"
        ? Promise.reject(new Error("download request failed"))
        : Promise.resolve(undefined),
    );

    await useAppUpdateStore.getState().downloadAndInstall();
    expect(useAppUpdateStore.getState().status.kind).toBe("error");
    expect(unlisten).toHaveBeenCalled();
  });
});
