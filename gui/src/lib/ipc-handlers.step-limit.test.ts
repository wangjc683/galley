import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the send is mocked: the pending-flag bookkeeping (mark /
// consume / clear) stays real so the gating path is the production one.
const notifyMocks = vi.hoisted(() => ({
  sendGatedSystemNotification: vi.fn(),
}));

vi.mock("@/lib/notify", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendGatedSystemNotification: notifyMocks.sendGatedSystemNotification,
  };
});

import { zhCopy } from "@/i18n/locales/zh";
import { enCopy } from "@/i18n/locales/en";
import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { markReplyNotifyPending } from "@/lib/notify";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import type { ExitReason, IPCEvent } from "@/types/ipc";

const SID = "s-cap";

const STEP_LIMIT: ExitReason = {
  result: "MAX_TURNS_EXCEEDED",
  data: { maxTurns: 180 },
};
const DONE: ExitReason = { result: "CURRENT_TASK_DONE", data: null };

function seed(): void {
  useSessionsStore.setState({
    sessions: [
      makeSession({ id: SID, title: "整理发版说明", gaRuntimeKind: "managed" }),
    ],
    activeSessionId: SID,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  useMessagesStore.getState().ensureMessages(SID);
  useRuntimeStore.getState().ensureRuntime(SID, { cachedLLMs: [] });
}

function startRun(): void {
  useMessagesStore.getState().applyUserMessagePersisted({
    sessionId: SID,
    message: { content: "跑完整套测试", turnIndex: 1 },
    dispatch: "dispatched",
  });
}

function turnStart(turnIndex = 1): IPCEvent {
  return {
    kind: "turn_start",
    sessionId: SID,
    turnIndex,
    timestamp: "2026-10-01T08:00:00.000Z",
  };
}

function finalTurnEnd(
  exitReason: ExitReason | null,
  extra: Partial<Extract<IPCEvent, { kind: "turn_end" }>> = {},
): IPCEvent {
  return {
    kind: "turn_end",
    sessionId: SID,
    turnIndex: 180,
    summary: "读取 test_runner.py",
    toolCalls: [{ toolName: "file_read", args: { path: "test_runner.py" } }],
    toolResults: [{ content: "…" }],
    responseContent: "",
    exitReason,
    nextSuggestion: "帮我看看失败的用例",
    timestamp: "2026-10-01T08:30:00.000Z",
    ...extra,
  };
}

function runComplete(exitReason: ExitReason): IPCEvent {
  return {
    kind: "run_complete",
    sessionId: SID,
    exitReason,
    finalContent: "",
    totalTurns: 180,
    timestamp: "2026-10-01T08:30:01.000Z",
  };
}

function slice() {
  return useMessagesStore.getState().byId[SID];
}

describe("step-limit stop (#29)", () => {
  beforeEach(() => {
    resetStores();
    seed();
    notifyMocks.sendGatedSystemNotification.mockReset();
    notifyMocks.sendGatedSystemNotification.mockResolvedValue(undefined);
  });

  it("flags the tail and offers 继续 as ghost text on a MAX_TURNS final turn_end", () => {
    startRun();
    dispatchIPCEvent(turnStart());
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));

    expect(slice().pausedAtStepLimit).toBe(true);
    // The model's mid-work suggestion is replaced, not kept.
    expect(slice().nextSuggestion).toBe("继续");

    dispatchIPCEvent(runComplete(STEP_LIMIT));
    expect(slice()).toMatchObject({
      agentRunning: false,
      currentTurnIndex: null,
      pausedAtStepLimit: true,
      nextSuggestion: "继续",
    });
  });

  it("uses the English continue word when the UI is English", () => {
    usePrefsStore.setState({ languagePreference: "en-US" });
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));

    expect(slice().nextSuggestion).toBe("Continue");
  });

  it("sets no tail and keeps the model's suggestion for CURRENT_TASK_DONE", () => {
    startRun();
    dispatchIPCEvent(
      finalTurnEnd(DONE, {
        toolCalls: [],
        toolResults: [],
        responseContent: "全部通过。",
      }),
    );

    expect(slice().pausedAtStepLimit).toBe(false);
    expect(slice().nextSuggestion).toBe("帮我看看失败的用例");
  });

  it("ignores intermediate turn_ends (no exitReason) and internal finals", () => {
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT, { visibility: "internal" }));
    expect(slice().pausedAtStepLimit).toBe(false);

    dispatchIPCEvent(finalTurnEnd(null));
    expect(slice().pausedAtStepLimit).toBe(false);
  });

  it("a newer final turn without MAX_TURNS clears the tail", () => {
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));
    expect(slice().pausedAtStepLimit).toBe(true);

    // Same flag rewrite on the next final turn, even without the user
    // send / turn_start that would normally clear it first.
    dispatchIPCEvent(finalTurnEnd(DONE, { toolCalls: [], toolResults: [] }));
    expect(slice().pausedAtStepLimit).toBe(false);
  });

  it("clears on turn_start (queue / CLI / goal-driven run start)", () => {
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));
    dispatchIPCEvent(runComplete(STEP_LIMIT));
    expect(slice().pausedAtStepLimit).toBe(true);

    dispatchIPCEvent(turnStart());
    expect(slice().pausedAtStepLimit).toBe(false);
  });

  it("clears on an external user send (CLI / supervisor / queue)", () => {
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));
    dispatchIPCEvent(runComplete(STEP_LIMIT));

    useMessagesStore.getState().applyUserMessagePersisted({
      sessionId: SID,
      message: { content: "继续", turnIndex: 3 },
      dispatch: "dispatched",
    });
    expect(slice()).toMatchObject({
      pausedAtStepLimit: false,
      nextSuggestion: null,
      agentRunning: true,
    });
  });

  it("clears on a composer send", () => {
    startRun();
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));
    dispatchIPCEvent(runComplete(STEP_LIMIT));
    expect(slice().pausedAtStepLimit).toBe(true);

    useMessagesStore.getState().appendUserTurn(SID, "继续", "req-continue");
    expect(slice()).toMatchObject({
      pausedAtStepLimit: false,
      nextSuggestion: null,
    });
  });

  it("titles the replyDone notification 已达步数上限 with the session as body", () => {
    startRun();
    markReplyNotifyPending(SID);
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));

    expect(notifyMocks.sendGatedSystemNotification).toHaveBeenCalledTimes(1);
    expect(notifyMocks.sendGatedSystemNotification).toHaveBeenCalledWith(
      "replyDone",
      {
        title: "已达步数上限",
        body: "整理发版说明",
        throttleKey: `reply:${SID}`,
      },
    );
  });

  it("keeps the 回复完成 notification for a normal finish", () => {
    startRun();
    markReplyNotifyPending(SID);
    dispatchIPCEvent(
      finalTurnEnd(DONE, {
        toolCalls: [],
        toolResults: [],
        responseContent: "全部通过。",
        summary: "测试全部通过",
      }),
    );

    expect(notifyMocks.sendGatedSystemNotification).toHaveBeenCalledWith(
      "replyDone",
      {
        title: "回复完成",
        body: "整理发版说明 · 测试全部通过",
        throttleKey: `reply:${SID}`,
      },
    );
  });

  it("does not notify a step-limit stop of a run the GUI did not start", () => {
    startRun();
    // No markReplyNotifyPending — a Goal-nudge / CLI-driven run.
    dispatchIPCEvent(finalTurnEnd(STEP_LIMIT));

    expect(notifyMocks.sendGatedSystemNotification).not.toHaveBeenCalled();
    expect(slice().pausedAtStepLimit).toBe(true);
  });

  it("DONE_WITHOUT_EXIT run_complete clears running state and sets no tail", () => {
    startRun();
    dispatchIPCEvent(turnStart());
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: SID,
      delta: "partial",
      source: "workbench",
      timestamp: "2026-10-01T08:00:01.000Z",
    });
    markReplyNotifyPending(SID);

    // Safety net: no final turn_end precedes it.
    dispatchIPCEvent(runComplete({ result: "DONE_WITHOUT_EXIT", data: null }));

    expect(slice()).toMatchObject({
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
      pausedAtStepLimit: false,
    });
    expect(notifyMocks.sendGatedSystemNotification).not.toHaveBeenCalled();
  });
});

describe("step-limit copy", () => {
  it("the tail quotes the same word the ghost text offers", () => {
    expect(zhCopy.conversation.stepLimitTail).toContain(
      `「${zhCopy.composer.stepLimitContinue}」`,
    );
    expect(enCopy.conversation.stepLimitTail).toContain(
      `“${enCopy.composer.stepLimitContinue}”`,
    );
  });
});
