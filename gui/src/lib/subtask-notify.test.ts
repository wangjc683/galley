import { describe, expect, it } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import {
  SUBTASK_DONE_NOTIFY_AFTER_MS,
  subtaskAskingNotification,
  subtaskDoneNotification,
  subtaskFailedNotification,
  subtaskFallbackNotification,
  usesSubtaskNotifications,
} from "@/lib/subtask-notify";
import type { SubtaskDispatch, SubtaskLiveView } from "@/lib/subtasks";
import { makeSession } from "@/test/factories";
import type { AgentTurn, Turn } from "@/types/conversation";

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
});

// Ticket 31: one voice. A subtask's own notification is the fallback
// for a report Core could not deliver to the assistant, sent from how
// the subtask stands now, with the same rules and words.
describe("the fallback for an undelivered report", () => {
  const base: SubtaskDispatch = {
    parentSessionId: "s-main",
    turnIndex: 4,
    ordinal: 0,
    messageId: "msg_s-main_4_assistant",
    sessionId: "s-sub",
    title: "整理 PDF",
    failure: null,
    failureDetail: null,
    createdAt: "2026-10-13T08:00:00.000Z",
  };
  const opener: Turn = {
    role: "user",
    content: "把下载文件夹里的 PDF 按内容分类",
    messageId: "u-1",
  };
  const answer = (elapsedMs?: number): AgentTurn => ({
    role: "agent",
    tools: [],
    finalAnswer: "分好了。",
    ...(elapsedMs !== undefined ? { telemetry: { elapsedMs } } : {}),
  });
  const live = (extra: Partial<SubtaskLiveView> = {}): SubtaskLiveView => ({
    agentRunning: false,
    pendingAskUser: null,
    turns: [],
    ...extra,
  });
  const NOW = T0 + 60 * 60_000;

  it("asks when it stopped on a question", () => {
    const n = subtaskFallbackNotification(
      base,
      subtask,
      live({
        pendingAskUser: { question: "要把发票单独放吗？", candidates: [] },
        turns: [opener, { role: "agent", tools: [], finalAnswer: null }],
      }),
      NOW,
      zh,
    );
    expect(n).toEqual(
      subtaskAskingNotification(subtask, "要把发票单独放吗？", zh),
    );
  });

  it("is done only after two minutes of running, by the run's telemetry", () => {
    const summarized = { ...subtask, summary: "30 个 PDF 分成 5 类" };
    const long = subtaskFallbackNotification(
      base,
      summarized,
      live({ turns: [opener, answer(3 * 60_000)] }),
      NOW,
      zh,
    );
    expect(long).toMatchObject({
      kind: "replyDone",
      title: "子任务完成",
      body: "整理 PDF · 30 个 PDF 分成 5 类",
      throttleKey: "reply:s-sub",
    });
    expect(
      subtaskFallbackNotification(
        base,
        summarized,
        live({ turns: [opener, answer(30_000)] }),
        NOW,
        zh,
      ),
    ).toBeNull();
  });

  it("fails on an error, a crash or a dispatch that never started", () => {
    expect(
      subtaskFallbackNotification(
        base,
        subtask,
        live({ runError: "quota exceeded", turns: [opener] }),
        NOW,
        zh,
      ),
    ).toEqual(
      subtaskFailedNotification(
        "整理 PDF",
        "s-sub",
        { kind: "error", message: "quota exceeded" },
        zh,
      ),
    );
    expect(
      subtaskFallbackNotification(
        base,
        subtask,
        live({ bridgeStatus: "error", bridgeError: "Bridge exited" }),
        NOW,
        zh,
      )?.body,
    ).toBe("整理 PDF · 出错：Bridge exited");
    const notStarted = subtaskFallbackNotification(
      { ...base, sessionId: null, title: "", failure: "empty" },
      undefined,
      live(),
      NOW,
      zh,
    );
    expect(notStarted).toMatchObject({
      kind: "subtaskFailed",
      body: "子任务 · 没有开始：主对话没写要做什么",
      throttleKey: "subtask-failed:s-main:4:0",
    });
  });

  it("says nothing while it runs again, when it was cut short, promoted or unknown", () => {
    expect(
      subtaskFallbackNotification(
        base,
        subtask,
        live({ agentRunning: true, turns: [opener] }),
        NOW,
        zh,
      ),
    ).toBeNull();
    expect(
      subtaskFallbackNotification(
        base,
        subtask,
        live({
          turns: [opener, { role: "agent", tools: [], finalAnswer: null }],
        }),
        NOW,
        zh,
      ),
    ).toBeNull();
    expect(
      subtaskFallbackNotification(
        base,
        { ...subtask, promoted: true },
        live({ runError: "x", turns: [opener] }),
        NOW,
        zh,
      ),
    ).toBeNull();
    expect(
      subtaskFallbackNotification(undefined, undefined, live(), NOW, zh),
    ).toBeNull();
  });

  it("reads the session alone when the page has no dispatch record", () => {
    expect(
      subtaskFallbackNotification(
        undefined,
        subtask,
        live({ runError: "quota exceeded", turns: [opener] }),
        NOW,
        zh,
      )?.body,
    ).toBe("整理 PDF · 出错：quota exceeded");
  });
});
