import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { dispatchIPCEvent } from "@/lib/ipc-handlers";
import { deriveSessionStatus } from "@/lib/sessions";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
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
  usePrefsStore.setState({ yoloMode: false });
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
      bridgePid: 4242,
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
    await flushPromises();
    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "persist_assistant_message",
      expect.objectContaining({
        input: expect.objectContaining({
          sessionId: "s-test",
          turnIndex: 10,
          finalAnswer: "Final answer",
        }),
      }),
    );
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

  it("routes tool_call_pending and persists the absolute turn index", async () => {
    useMessagesStore
      .getState()
      .appendUserTurnExternal("s-test", "Question", undefined, undefined, true, 5);
    tauriMocks.invoke.mockClear();

    dispatchIPCEvent({
      kind: "tool_call_pending",
      sessionId: "s-test",
      approvalId: "appr-1",
      turnIndex: 1,
      toolName: "file_write",
      args: { path: "README.md" },
      argsPreview: "path=README.md",
      riskLevel: "high",
      reason: "Writes a file",
      timestamp: "2026-06-18T08:02:00.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"].pendingApprovals).toEqual([
      {
        approvalId: "appr-1",
        toolName: "file_write",
        target: "README.md",
        riskLevel: "high",
        args: { path: "README.md" },
      },
    ]);
    // Approval state lives on the messages slice (asserted above); the
    // session row keeps its durable status and derives waiting_approval
    // at read time rather than via the removed fireSessionMirror push.
    const row = useSessionsStore.getState().sessions[0];
    expect(row.status).toBe("idle");
    expect(
      deriveSessionStatus(row, { agentRunning: true, pendingApprovalCount: 1 }),
    ).toBe("waiting_approval");

    await flushPromises();
    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "persist_tool_event_pending",
      {
        input: expect.objectContaining({
          approvalId: "appr-1",
          sessionId: "s-test",
          turnIndex: 5,
          toolName: "file_write",
        }),
      },
    );
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

  it("plan_update writes plan state and the closing event clears it", () => {
    seedSession();
    dispatchIPCEvent({
      kind: "plan_update",
      sessionId: "s-test",
      active: true,
      placeholder: false,
      done: 1,
      total: 3,
      complete: false,
      step: "引入版本化快照结构",
      pathHint: "plan_x/plan.md",
      items: [
        { content: "梳理现有恢复路径", status: "done" },
        { content: "引入版本化快照结构", status: "open" },
      ],
      timestamp: "2026-06-18T08:06:00.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"].plan).toMatchObject({
      done: 1,
      total: 3,
      step: "引入版本化快照结构",
      placeholder: false,
    });

    dispatchIPCEvent({
      kind: "plan_update",
      sessionId: "s-test",
      active: false,
      placeholder: false,
      done: 0,
      total: 0,
      complete: true,
      step: "",
      pathHint: "",
      items: [],
      timestamp: "2026-06-18T08:07:00.000Z",
    });

    expect(useMessagesStore.getState().byId["s-test"].plan).toBeNull();
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

describe("Core DB persistence retry on SQLite contention (CONC-8)", () => {
  let consoleError: MockInstance<typeof console.error>;

  function persistCalls(command: string): number {
    return tauriMocks.invoke.mock.calls.filter(([c]) => c === command).length;
  }

  function turnEndEvent(): IPCEvent {
    return {
      kind: "turn_end",
      sessionId: "s-test",
      turnIndex: 1,
      summary: "Answered",
      toolCalls: [],
      toolResults: [],
      responseContent: "Final answer",
      exitReason: null,
      timestamp: "2026-06-18T08:01:02.000Z",
    };
  }

  function failInvoke(command: string, message: string, times: number): void {
    let failures = times;
    tauriMocks.invoke.mockImplementation(async (c) => {
      if (c === command && failures > 0) {
        failures -= 1;
        throw new Error(message);
      }
      return undefined;
    });
  }

  beforeEach(() => {
    resetStores();
    seedSession();
    vi.useFakeTimers();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleError.mockRestore();
  });

  it("retries persist_assistant_message after a busy error", async () => {
    failInvoke(
      "persist_assistant_message",
      "database is locked (code 5) SQLITE_BUSY",
      1,
    );

    dispatchIPCEvent(turnEndEvent());
    await vi.advanceTimersByTimeAsync(0);
    expect(persistCalls("persist_assistant_message")).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(persistCalls("persist_assistant_message")).toBe(2);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not retry non-contention errors and logs identifiers", async () => {
    failInvoke(
      "persist_assistant_message",
      "no such table: messages",
      Infinity,
    );

    dispatchIPCEvent(turnEndEvent());
    await vi.advanceTimersByTimeAsync(5000);

    expect(persistCalls("persist_assistant_message")).toBe(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = String(consoleError.mock.calls[0][0]);
    expect(logged).toContain("session=s-test");
    expect(logged).toContain("turn=1");
  });

  it("gives up after three contention retries and logs at error level", async () => {
    failInvoke(
      "persist_assistant_message",
      "database is locked (code 5) SQLITE_BUSY",
      Infinity,
    );

    dispatchIPCEvent(turnEndEvent());
    await vi.advanceTimersByTimeAsync(5000);

    // Initial attempt + 200/500/1000ms retries, then escalate.
    expect(persistCalls("persist_assistant_message")).toBe(4);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("retries persist_tool_event_pending after a busy error", async () => {
    failInvoke(
      "persist_tool_event_pending",
      "database is locked (code 5) SQLITE_BUSY",
      1,
    );

    dispatchIPCEvent({
      kind: "tool_call_pending",
      sessionId: "s-test",
      approvalId: "appr-retry",
      turnIndex: 1,
      toolName: "file_write",
      args: { path: "README.md" },
      argsPreview: "path=README.md",
      riskLevel: "high",
      reason: "Writes a file",
      timestamp: "2026-06-18T08:02:00.000Z",
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(persistCalls("persist_tool_event_pending")).toBe(2);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
