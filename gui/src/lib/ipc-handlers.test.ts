import { beforeEach, describe, expect, it } from "vitest";

import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import {
  consumeReplyNotifyPending,
  markReplyNotifyPending,
} from "@/lib/notify";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import { getTauriMocks } from "@/test/setup";
import type { IPCEvent } from "@/types/ipc";

const tauriMocks = getTauriMocks();

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function seedSession(): void {
  useSessionsStore.setState({
    sessions: [makeSession({ id: "s-test", gaRuntimeKind: "external" })],
    activeSessionId: "s-test",
  });
  useMessagesStore.getState().ensureMessages("s-test");
  useRuntimeStore.getState().ensureRuntime("s-test", { cachedLLMs: [] });
}

function readyEvent(): IPCEvent {
  return {
    kind: "ready",
    sessionId: "s-test",
    protocolVersion: "0.1",
    gaCommit: "abc123",
    gaCommitDate: "2026-06-18T08:00:00.000Z",
    gaPath: "/ga",
    llmName: "Native/beta",
    cwd: "/ga/temp",
    pid: 4242,
    availableLLMs: [
      { index: 0, name: "Native/alpha", displayName: "Alpha", isCurrent: false },
      { index: 1, name: "Native/beta", displayName: "Beta", isCurrent: true },
    ],
    timestamp: "2026-06-18T08:00:00.000Z",
  };
}

describe("dispatchIPCEvent", () => {
  beforeEach(() => {
    resetStores();
    seedSession();
  });

  it("maps ready events into runtime state", () => {
    dispatchIPCEvent(readyEvent());

    expect(useRuntimeStore.getState().byId["s-test"]).toMatchObject({
      bridgeStatus: "connected",
      bridgePid: null,
      llmDisplayName: "Beta",
      llms: [
        {
          index: 0,
          name: "Native/alpha",
          key: "Native/alpha",
          displayName: "Alpha",
          isCurrent: false,
        },
        {
          index: 1,
          name: "Native/beta",
          key: "Native/beta",
          displayName: "Beta",
          isCurrent: true,
        },
      ],
    });
    expect(useRuntimeStore.getState().runtimeInfo).toMatchObject({
      gaCommit: "abc123",
      gaCommitDate: "2026-06-18T08:00:00.000Z",
      gaCommitRuntimeKind: "external",
      bridgePid: 4242,
    });
  });

  it("keeps the external GA version when a bundled-engine session becomes ready", () => {
    dispatchIPCEvent(readyEvent());
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-test", gaRuntimeKind: "external" }),
        makeSession({ id: "s-managed", gaRuntimeKind: "managed" }),
      ],
    });
    useMessagesStore.getState().ensureMessages("s-managed");
    useRuntimeStore.getState().ensureRuntime("s-managed", { cachedLLMs: [] });

    dispatchIPCEvent({
      ...(readyEvent() as Extract<IPCEvent, { kind: "ready" }>),
      sessionId: "s-managed",
      // The bundled engine reports its own manifest commit.
      gaCommit: "engine0",
      gaCommitDate: "2026-10-06",
      pid: 5151,
    });

    expect(useRuntimeStore.getState().runtimeInfo).toMatchObject({
      gaCommit: "abc123",
      gaCommitDate: "2026-06-18T08:00:00.000Z",
      gaCommitRuntimeKind: "external",
      bridgePid: 5151,
    });
  });

  it("routes visible turn lifecycle events into messages state", async () => {
    useMessagesStore
      .getState()
      .appendUserTurnExternal("s-test", "Question", undefined, undefined, true, 10);

    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: "s-test",
      turnIndex: 1,
      timestamp: "2026-06-18T08:01:00.000Z",
    });
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: "s-test",
      delta: "Partial",
      source: "workbench",
      timestamp: "2026-06-18T08:01:01.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      currentTurnIndex: 1,
      inFlightContent: "Partial",
      agentRunning: true,
    });

    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Answered",
      toolCalls: [],
      toolResults: [],
      responseContent: "Final answer",
      exitReason: null,
      timestamp: "2026-06-18T08:01:02.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      currentTurnIndex: null,
      inFlightContent: "",
      agentRunning: true,
    });
    expect(useMessagesStore.getState().byId["s-test"].turns[1]).toMatchObject({
      role: "agent",
      finalAnswer: "Final answer",
      turnIndex: 1,
      summary: "Answered",
    });

    dispatchIPCEvent({
      kind: "run_complete",
      sessionId: "s-test",
      exitReason: { result: "CURRENT_TASK_DONE", data: null },
      finalContent: "Final answer",
      totalTurns: 1,
      timestamp: "2026-06-18T08:01:03.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"].agentRunning).toBe(false);
    // The live node carries the id of the row Core wrote under the
    // absolute index (user row 10, step 1) — palette hits locate it.
    expect(useMessagesStore.getState().byId["s-test"].turns[1]).toMatchObject({
      messageId: "msg_s-test_10_assistant",
    });
  });

  it("marks a denied tool as denied in the live turn_end path", () => {
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Denied by user",
      toolCalls: [
        { toolName: "run_command", args: { command: "rm -rf build" } },
        { toolName: "file_read", args: { path: "README.md" } },
      ],
      toolResults: [
        {
          toolUseId: "call-1",
          // Verbatim shape from runner/handlers.py's deny path.
          content: '{"status": "denied", "msg": "User denied this tool call"}',
        },
        { toolUseId: "call-2", content: "[FILE] 268 lines..." },
      ],
      responseContent: "",
      exitReason: null,
      timestamp: "2026-06-18T08:02:00.000Z",
    });

    const turns = useMessagesStore.getState().byId["s-test"].turns;
    const agent = turns[turns.length - 1];
    if (agent.role !== "agent") throw new Error("expected agent turn");
    expect(agent.tools[0]).toMatchObject({
      name: "run_command",
      status: "denied",
    });
    expect(agent.tools[1]).toMatchObject({
      name: "file_read",
      status: "success-historical",
    });
  });

  it("settles native reasoning from turn_end's responseThinking (2026-09-23)", () => {
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Answered",
      toolCalls: [],
      toolResults: [],
      // An in-content tag loses to GA's response.thinking.
      responseContent: "<thinking>tag reasoning</thinking>Final answer",
      responseThinking: "\n  Native reasoning first.  \n",
      exitReason: null,
      timestamp: "2026-09-23T08:00:00.000Z",
    });

    const turns = useMessagesStore.getState().byId["s-test"].turns;
    const agent = turns[turns.length - 1];
    if (agent.role !== "agent") throw new Error("expected agent turn");
    expect(agent.thinking).toBe("Native reasoning first.");
    expect(agent.finalAnswer).toBe("Final answer");
    // The persisted `thinking` column is Core's to write; the golden
    // fixtures pin it to this same value (native-thinking-wins).
  });

  it("falls back to the <thinking> tag when responseThinking is absent or blank", () => {
    for (const responseThinking of [undefined, null, "  \n "]) {
      dispatchIPCEvent({
        kind: "turn_end",
        sessionId: "s-test",
        turnIndex: 1,
        summary: "Answered",
        toolCalls: [],
        toolResults: [],
        responseContent: "<thinking> tag reasoning </thinking>Final answer",
        responseThinking,
        exitReason: null,
        timestamp: "2026-09-23T08:00:00.000Z",
      });
      const turns = useMessagesStore.getState().byId["s-test"].turns;
      const agent = turns[turns.length - 1];
      if (agent.role !== "agent") throw new Error("expected agent turn");
      expect(agent.thinking).toBe("tag reasoning");
    }
  });

  it("keeps same-turn streaming content when turn_start arrives late", () => {
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: "s-test",
      delta: "Early streamed prose",
      source: "workbench",
      timestamp: "2026-06-18T08:01:00.000Z",
    });

    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: "s-test",
      turnIndex: 1,
      timestamp: "2026-06-18T08:01:01.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      currentTurnIndex: 1,
      inFlightContent: "Early streamed prose",
    });
  });

  it("ignores internal visibility for visible conversation state", () => {
    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: "s-test",
      turnIndex: 1,
      visibility: "internal",
      timestamp: "2026-06-18T08:03:00.000Z",
    });
    dispatchIPCEvent({
      kind: "turn_progress",
      sessionId: "s-test",
      delta: "hidden",
      source: "workbench",
      visibility: "internal",
      timestamp: "2026-06-18T08:03:01.000Z",
    });
    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Hidden",
      toolCalls: [],
      toolResults: [],
      responseContent: "Hidden answer",
      exitReason: null,
      visibility: "internal",
      timestamp: "2026-06-18T08:03:02.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      currentTurnIndex: null,
      inFlightContent: "",
      turns: [],
    });
  });

  it("continues the run's step numbering across an ask_user reply (2026-09-18)", () => {
    // Two steps, the second an ask_user pause; the reply starts a fresh
    // GA loop whose turn_start / turn_end arrive as step 1 again. The
    // in-flight marker and the sidebar's "第 N 步" must read 3.
    useMessagesStore
      .getState()
      .appendUserTurnExternal(
        "s-test",
        "Question",
        undefined,
        undefined,
        true,
        10,
      );
    const turnEnd = (
      turnIndex: number,
      extra: Partial<IPCEvent> = {},
    ): IPCEvent =>
      ({
        kind: "turn_end",
        sessionId: "s-test",
        turnIndex,
        summary: `step ${turnIndex}`,
        toolCalls: [],
        toolResults: [],
        responseContent: "",
        exitReason: null,
        timestamp: "2026-06-18T08:05:00.000Z",
        ...extra,
      }) as IPCEvent;
    dispatchIPCEvent(turnEnd(1));
    dispatchIPCEvent(
      turnEnd(2, {
        toolCalls: [
          { toolName: "ask_user", args: { question: "Q?", candidates: [] } },
        ],
        exitReason: { result: "EXITED", data: {} },
      }),
    );
    expect(
      useSessionsStore.getState().sessions.find((s) => s.id === "s-test")
        ?.lastStepIndex,
    ).toBe(2);

    // The reply (composer or CLI) is a user turn appended before the
    // new loop's first turn_start.
    useMessagesStore
      .getState()
      .appendUserTurnExternal("s-test", "选 A", undefined, undefined, true, 13);
    expect(useMessagesStore.getState().byId["s-test"].runStepBase).toBe(2);

    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: "s-test",
      turnIndex: 1,
      timestamp: "2026-06-18T08:06:00.000Z",
    });
    expect(useMessagesStore.getState().byId["s-test"].currentTurnIndex).toBe(
      3,
    );

    dispatchIPCEvent(turnEnd(1, { summary: "after reply" }));
    expect(
      useSessionsStore.getState().sessions.find((s) => s.id === "s-test")
        ?.lastStepIndex,
    ).toBe(3);
    // The stored turn keeps GA's raw step — restore recovers the same
    // value; display numbering is by position (goal-run-groups).
    const turns = useMessagesStore.getState().byId["s-test"].turns;
    expect(turns[turns.length - 1]).toMatchObject({
      role: "agent",
      turnIndex: 1,
    });

    // A fresh question after the run settles starts from 1 again.
    useMessagesStore
      .getState()
      .appendUserTurnExternal(
        "s-test",
        "New question",
        undefined,
        undefined,
        true,
        15,
      );
    expect(useMessagesStore.getState().byId["s-test"].runStepBase).toBe(0);
  });

  it("routes the reply-notify flag past an ask_user turn_end to the ask_user handler", () => {
    // A GUI-started run that ends by asking a question must NOT fire
    // the replyDone notification at its final turn_end ("回复完成"
    // would tell an away user the task finished when the agent is
    // blocked on them). The flag survives turn_end and is consumed by
    // the ask_user handler that follows, which owns the
    // waiting-for-you notification instead.
    markReplyNotifyPending("s-test");

    dispatchIPCEvent({
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Asked the user",
      toolCalls: [
        { toolName: "ask_user", args: { question: "Q?", candidates: [] } },
      ],
      toolResults: [],
      responseContent: "",
      exitReason: { result: "EXITED", data: {} },
      timestamp: "2026-06-18T08:05:00.000Z",
    });

    // turn_end left the flag alone …
    expect(consumeReplyNotifyPending("s-test")).toBe(true);
    markReplyNotifyPending("s-test");

    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: "s-test",
      question: "Q?",
      candidates: [],
      timestamp: "2026-06-18T08:05:01.000Z",
    });

    // … and the ask_user handler consumed it.
    expect(consumeReplyNotifyPending("s-test")).toBe(false);
  });

  it("ask_user strips GA internal tags from question and candidates", () => {
    seedSession();
    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: "s-test",
      question:
        "<summary>用户要求用 AskUser 提问；我将提出一个我感兴趣的问题。</summary>\n如果可以把一个现实任务完全交给 AI 代理自动完成，你最想交给它做什么？",
      candidates: [
        "<thinking>内部独白</thinking>写代码",
        "做调研",
      ],
      timestamp: "2026-06-18T08:05:00.000Z",
    });

    expect(
      useMessagesStore.getState().byId["s-test"].pendingAskUser,
    ).toEqual({
      question:
        "如果可以把一个现实任务完全交给 AI 代理自动完成，你最想交给它做什么？",
      candidates: ["写代码", "做调研"],
    });
  });

  it("turn_start invalidates a pending ask_user question (queue preemption)", () => {
    // galley#19 dogfood 2026-08-12: a queue 插队 (or CLI send) preempts
    // the pending question WITHOUT going through the composer's
    // appendUserTurn — the bubble must still drop the moment the new
    // run starts, because the bridge now rejects answers mid-run.
    seedSession();
    dispatchIPCEvent({
      kind: "ask_user",
      sessionId: "s-test",
      question: "接下来做什么？",
      candidates: ["继续", "停下"],
      timestamp: "2026-06-18T08:05:00.000Z",
    });
    expect(
      useMessagesStore.getState().byId["s-test"].pendingAskUser,
    ).not.toBeNull();

    dispatchIPCEvent({
      kind: "turn_start",
      sessionId: "s-test",
      turnIndex: 1,
      timestamp: "2026-06-18T08:06:00.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"].pendingAskUser).toBeNull();
  });

  it("error clears running state and pushes a toast", () => {
    const store = useMessagesStore.getState();
    store.setAgentRunning("s-test", true);
    store.setCurrentTurnIndex("s-test", 2);
    store.appendInFlightDelta("s-test", "partial");

    dispatchIPCEvent({
      kind: "error",
      sessionId: "s-test",
      message: "Bridge failed",
      category: "bridge",
      severity: "error",
      retryable: false,
      hint: null,
      context: null,
      traceback: null,
      timestamp: "2026-06-18T08:04:00.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"]).toMatchObject({
      agentRunning: false,
      currentTurnIndex: null,
      inFlightContent: "",
    });
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(useUiStore.getState().toasts[0]).toMatchObject({
      message: "Bridge failed",
    });
  });
});

describe("turn_end leaves SQLite to Core (2026-10-07)", () => {
  function finalTurnEnd(): Extract<IPCEvent, { kind: "turn_end" }> {
    return {
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Answered",
      toolCalls: [],
      toolResults: [],
      responseContent: "Final answer",
      exitReason: { result: "CURRENT_TASK_DONE", data: null },
      absoluteTurnIndex: 4,
      timestamp: "2026-10-07T08:00:00.000Z",
    };
  }

  function invokedCommands(): string[] {
    return tauriMocks.invoke.mock.calls.map(([command]) => command);
  }

  beforeEach(() => {
    resetStores();
    seedSession();
  });

  it("writes no row and no session bump from the page", async () => {
    dispatchIPCEvent(finalTurnEnd());
    await flushPromises();
    // Core's runner watcher already wrote both; a second bump here
    // would double-count turn_count.
    expect(invokedCommands()).not.toContain("persist_assistant_message");
    expect(invokedCommands()).not.toContain("bump_session_after_turn");
    // The sidebar still moves: an in-memory mirror of Core's bump.
    expect(useSessionsStore.getState().sessions[0]).toMatchObject({
      turnCount: 1,
      summary: "Answered",
    });
  });

  it("flags a background session's final reply unread through Core", async () => {
    useSessionsStore.setState({ activeSessionId: "s-elsewhere" });
    dispatchIPCEvent(finalTurnEnd());
    await flushPromises();
    expect(useSessionsStore.getState().sessions[0].hasUnread).toBe(true);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("mark_session_unread", {
      id: "s-test",
    });
  });

  it("leaves the on-screen session and intermediate steps read", async () => {
    dispatchIPCEvent(finalTurnEnd());
    useSessionsStore.setState({ activeSessionId: "s-elsewhere" });
    dispatchIPCEvent({ ...finalTurnEnd(), exitReason: null });
    await flushPromises();
    expect(invokedCommands()).not.toContain("mark_session_unread");
    expect(useSessionsStore.getState().sessions[0].hasUnread).toBeFalsy();
  });
});
