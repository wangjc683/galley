import { describe, expect, it } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import {
  dispatchFailureNotifications,
  SUBTASK_DONE_NOTIFY_AFTER_MS,
  subtaskAskingNotification,
  subtaskDoneNotification,
  subtaskFailedNotification,
  usesSubtaskNotifications,
} from "@/lib/subtask-notify";
import type { SubtaskDispatch } from "@/lib/subtasks";
import { makeSession } from "@/test/factories";

const zh = copyForLanguage("zh-CN");

const subtask = makeSession({
  id: "s-sub",
  title: "整理 PDF",
  parentSessionId: "s-main",
  createdAt: "2026-10-13T08:00:00.000Z",
});
const T0 = Date.parse("2026-10-13T08:00:00.000Z");

describe("which sessions follow the subtask rules", () => {
  it("is an unpromoted subtask; a promoted one notifies like any conversation", () => {
    expect(usesSubtaskNotifications(subtask)).toBe(true);
    expect(usesSubtaskNotifications({ ...subtask, promoted: true })).toBe(
      false,
    );
    expect(usesSubtaskNotifications(makeSession())).toBe(false);
    expect(usesSubtaskNotifications(undefined)).toBe(false);
  });
});

describe("asking you", () => {
  it("always notifies, in the needs-you register", () => {
    const n = subtaskAskingNotification(subtask, "要把发票单独放吗？", zh);
    expect(n).toEqual({
      kind: "askUser",
      tone: "needsYou",
      title: "子任务在问你",
      body: "整理 PDF · 要把发票单独放吗？",
      throttleKey: "reply:s-sub",
    });
  });
});

describe("done", () => {
  it("notifies only after two minutes of running", () => {
    const quick = subtaskDoneNotification(
      subtask,
      { runStartedAtMs: T0, nowMs: T0 + SUBTASK_DONE_NOTIFY_AFTER_MS - 1 },
      zh,
    );
    expect(quick).toBeNull();
    const long = subtaskDoneNotification(
      subtask,
      {
        runStartedAtMs: T0,
        nowMs: T0 + SUBTASK_DONE_NOTIFY_AFTER_MS,
        summary: "30 个 PDF 分成 5 类",
      },
      zh,
    );
    expect(long).toMatchObject({
      kind: "replyDone",
      tone: "done",
      title: "子任务完成",
      body: "整理 PDF · 30 个 PDF 分成 5 类",
    });
  });

  it("measures from the session's creation when the page never saw the run start", () => {
    expect(
      subtaskDoneNotification(
        subtask,
        { runStartedAtMs: null, nowMs: T0 + 30_000 },
        zh,
      ),
    ).toBeNull();
    expect(
      subtaskDoneNotification(
        subtask,
        { runStartedAtMs: null, nowMs: T0 + 5 * 60_000 },
        zh,
      )?.title,
    ).toBe("子任务完成");
  });

  it("counts the run that ended, not the subtask's life (an answer restarts it)", () => {
    // Asked at minute 1, answered at minute 10, done ten seconds later.
    const answeredAt = T0 + 10 * 60_000;
    expect(
      subtaskDoneNotification(
        subtask,
        { runStartedAtMs: answeredAt, nowMs: answeredAt + 10_000 },
        zh,
      ),
    ).toBeNull();
  });
});

describe("failed", () => {
  it("always notifies, as an alert", () => {
    const n = subtaskFailedNotification(
      subtask.title,
      subtask.id,
      { kind: "error", message: "quota exceeded" },
      zh,
    );
    expect(n).toEqual({
      kind: "subtaskFailed",
      tone: "alert",
      title: "子任务出错",
      body: "整理 PDF · 出错：quota exceeded",
      throttleKey: "subtask-failed:s-sub",
    });
  });

  it("notifies each dispatch that did not start, and none that did", () => {
    const base: SubtaskDispatch = {
      parentSessionId: "s-main",
      turnIndex: 4,
      ordinal: 0,
      messageId: "msg_s-main_4_assistant",
      sessionId: "s-a",
      title: "查三家报价",
      failure: null,
      failureDetail: null,
      createdAt: "2026-10-13T08:00:00.000Z",
    };
    const ns = dispatchFailureNotifications(
      [
        base,
        { ...base, ordinal: 1, sessionId: null, title: "", failure: "empty" },
        {
          ...base,
          ordinal: 2,
          sessionId: "s-c",
          title: "订机票",
          failure: "start_failed",
          failureDetail: "spawn failed",
        },
      ],
      zh,
    );
    expect(ns.map((n) => n.body)).toEqual([
      "子任务 · 没有开始：主对话没写要做什么",
      "订机票 · 没能启动：spawn failed",
    ]);
    expect(ns.every((n) => n.kind === "subtaskFailed")).toBe(true);
    expect(new Set(ns.map((n) => n.throttleKey)).size).toBe(2);
  });
});
