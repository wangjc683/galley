import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import type { AppUpdateStatus } from "@/stores/app-update";

import { updateControlView } from "./update-control-view";

const copy = zhCopy.updates;

function view(status: AppUpdateStatus, hasRunningSessions = false) {
  return updateControlView(status, hasRunningSessions, copy);
}

const AVAILABLE: AppUpdateStatus = {
  kind: "available",
  currentVersion: "0.5.6",
  version: "0.6.0",
  body: null,
  date: null,
};

const READY: AppUpdateStatus = {
  kind: "ready",
  currentVersion: "0.5.6",
  version: "0.6.0",
};

describe("updateControlView", () => {
  it("offers a check with nothing after it when idle", () => {
    expect(view({ kind: "idle" })).toEqual({
      action: {
        kind: "button",
        command: "check",
        label: "检查更新",
        disabled: false,
      },
      note: null,
      error: null,
    });
  });

  it("shows a checking badge", () => {
    expect(view({ kind: "checking" })).toEqual({
      action: { kind: "progress", label: "正在检查" },
      note: null,
      error: null,
    });
  });

  it("keeps the check button with the outcome after it", () => {
    expect(view({ kind: "unconfigured", currentVersion: "0.5.6" })).toEqual({
      action: {
        kind: "button",
        command: "check",
        label: "检查更新",
        disabled: false,
      },
      note: { tone: "info", message: "开发版未连接更新通道" },
      error: null,
    });
    expect(view({ kind: "upToDate", currentVersion: "0.5.6" }).note).toEqual({
      tone: "success",
      message: "已是最新版本",
    });
  });

  it("offers the download whether or not a task runs", () => {
    for (const running of [false, true]) {
      expect(view(AVAILABLE, running)).toEqual({
        action: {
          kind: "button",
          command: "download",
          label: "下载更新",
          disabled: false,
        },
        note: { tone: "plain", message: "发现新版本 v0.6.0" },
        error: null,
      });
    }
  });

  it("shows download progress with the version after it", () => {
    expect(
      view({
        kind: "downloading",
        version: "0.6.0",
        phase: "downloading",
        progress: { downloaded: 42, total: 100 },
      }),
    ).toEqual({
      action: { kind: "progress", label: "正在下载更新 · 42%" },
      note: { tone: "plain", message: "新版本 v0.6.0" },
      error: null,
    });
  });

  it("drops the percent without a usable total, the note without a version", () => {
    expect(
      view({
        kind: "downloading",
        phase: "downloading",
        progress: { downloaded: 42, total: null },
      }),
    ).toEqual({
      action: { kind: "progress", label: "正在下载更新" },
      note: null,
      error: null,
    });
    // Before the first event the phase may be absent: still a download.
    expect(view({ kind: "downloading", version: "0.6.0" }).action).toEqual({
      kind: "progress",
      label: "正在下载更新",
    });
  });

  it("shows installing alone", () => {
    expect(
      view({ kind: "downloading", version: "0.6.0", phase: "installing" }),
    ).toEqual({
      action: { kind: "progress", label: "正在安装更新" },
      note: null,
      error: null,
    });
  });

  it("offers the restart once ready", () => {
    expect(view(READY)).toEqual({
      action: {
        kind: "button",
        command: "restart",
        label: "重启并更新",
        disabled: false,
      },
      note: { tone: "success", message: "v0.6.0 已下载，重启 Galley 后生效" },
      error: null,
    });
  });

  it("holds the restart while a task runs, and says why", () => {
    expect(view(READY, true)).toEqual({
      action: {
        kind: "button",
        command: "restart",
        label: "重启并更新",
        disabled: true,
      },
      note: {
        tone: "warning",
        message: "v0.6.0 已下载，当前任务结束后再重启",
      },
      error: null,
    });
  });

  it("puts an error in its own block and offers a retry that checks", () => {
    expect(
      view({
        kind: "error",
        message: "下载更新失败，请稍后重试。",
        detail: "download request failed: connection reset",
        manualDownloadUrl: "https://example.test/releases/latest",
      }),
    ).toEqual({
      action: {
        kind: "button",
        command: "check",
        label: "重试",
        disabled: false,
      },
      note: null,
      error: {
        title: "下载更新失败，请稍后重试。",
        detail: "download request failed: connection reset",
        manualDownloadUrl: "https://example.test/releases/latest",
      },
    });
  });

  it("words the same states in English", () => {
    expect(updateControlView(AVAILABLE, false, enCopy.updates).note).toEqual({
      tone: "plain",
      message: "New version v0.6.0 available",
    });
    expect(updateControlView(READY, true, enCopy.updates).note).toEqual({
      tone: "warning",
      message: "v0.6.0 downloaded — restart after the current task finishes",
    });
  });
});
