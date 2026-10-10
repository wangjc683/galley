import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import { applyRunnerHistoryReplay } from "@/lib/ipc/history-replay";
import {
  clearReplyNotifyPending,
  consumeReplyNotifyPending,
} from "@/lib/notify";
import type {
  PersistedMessageBrief,
  SendUserMessageResult,
  UserMessagePersistedPayload,
} from "@/lib/session-send";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { IPCEvent } from "@/types/ipc";
import type { UserTurn } from "@/types/conversation";
import type { Session } from "@/types/session";

import { sendThroughCore, useMessageSend } from "./useMessageSend";

/**
 * Ticket 02c: every user send is one Core command, `send_user_message`.
 * The page shows the optimistic echo, puts its runner listeners up first
 * when it holds none, and lets Core's `user-message-persisted`
 * broadcasts claim the echo (`pending`) and move it on (`dispatched`).
 *
 * Core is faked at the Tauri seam: `send_user_message` runs a scenario
 * that broadcasts what Core would, in Core's order. The broadcast goes
 * straight to the store action `useExternalCoreEvents` routes it to;
 * runner events go through the page's real listeners (a fake event bus
 * behind `listen`). The bridge slice keeps its client map at module
 * level, so every test uses its own session ids.
 */

const tauriMocks = getTauriMocks();
const copy = copyForLanguage("zh-CN");
const NOW = "2026-10-10T08:00:00.000Z";

type Handler = (event: { payload: unknown }) => void;
const bus = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown): void {
  for (const handler of bus.get(event) ?? []) handler({ payload });
}

function runnerEvent(event: IPCEvent): void {
  emit("runner-event", { sessionId: event.sessionId, event });
}

/** Core's `user-message-persisted`, as `useExternalCoreEvents` applies it. */
function broadcast(payload: UserMessagePersistedPayload): void {
  useMessagesStore.getState().applyUserMessagePersisted(payload);
}

interface SendArgs {
  sessionId: string;
  text: string;
  images?: unknown[];
  clientRequestId?: string;
  llmIndex?: number;
  llmKey?: string;
  gaConfig?: unknown;
}

/** Core answers `send_user_message` with `scenario`; nothing else. */
function core(
  scenario: (
    args: SendArgs,
  ) => Promise<SendUserMessageResult> | SendUserMessageResult,
): void {
  tauriMocks.invoke.mockImplementation(async (command, args) => {
    if (command === "send_user_message") return await scenario(args as never);
    if (command === "list_live_runners" || command === "runner_stderr_tail") {
      return [];
    }
    return undefined;
  });
}

function calls(command: string): Array<Record<string, unknown> | undefined> {
  return tauriMocks.invoke.mock.calls
    .filter(([c]) => c === command)
    .map(([, args]) => args);
}

function row(
  sid: string,
  turnIndex: number,
  content: string,
  extra: Partial<PersistedMessageBrief> = {},
): PersistedMessageBrief {
  return {
    id: `msg_${sid}_${turnIndex}_user`,
    sessionId: sid,
    role: "user",
    content,
    createdAt: NOW,
    turnIndex,
    origin: { via: "gui" },
    ...extra,
  };
}

function dispatched(
  message: PersistedMessageBrief,
  pid = 41,
  spawned = true,
): SendUserMessageResult {
  return {
    outcome: "dispatched",
    message,
    queue: null,
    runner: { pid, spawned, ready: null },
  };
}

const QUEUED: SendUserMessageResult = {
  outcome: "queued",
  message: null,
  queue: { queueId: "q-1", position: 0 },
  runner: null,
};

function seed(sid: string, overrides: Partial<Session> = {}): Session {
  const session = makeSession({ id: sid, title: "整理发版说明", ...overrides });
  useSessionsStore.setState({ sessions: [session], activeSessionId: sid });
  useMessagesStore.getState().ensureMessages(sid);
  return session;
}

function slice(sid: string) {
  return useMessagesStore.getState().byId[sid];
}

function userTurns(sid: string): UserTurn[] {
  return (slice(sid)?.turns ?? []).filter(
    (turn): turn is UserTurn => turn.role === "user",
  );
}

const unsubscribers: Array<() => void> = [];

/** Every distinct send phase the session goes through, in order. */
function recordPhases(sid: string): Array<string | null> {
  const phases: Array<string | null> = [null];
  unsubscribers.push(
    useMessagesStore.subscribe((state) => {
      const phase = state.byId[sid]?.sendPhase ?? null;
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    }),
  );
  return phases;
}

function toolStepEnd(sid: string): IPCEvent {
  return {
    kind: "turn_end",
    sessionId: sid,
    turnIndex: 1,
    summary: "读取 CHANGELOG",
    toolCalls: [{ toolName: "file_read", args: { path: "CHANGELOG.md" } }],
    toolResults: [{ content: "…" }],
    responseContent: "",
    exitReason: null,
    timestamp: NOW,
  } as IPCEvent;
}

/** The hook's handlers, rendered once (they read stores at call time). */
function mountSend(activeSession?: Session) {
  const imageToasts: string[] = [];
  let api: ReturnType<typeof useMessageSend> | undefined;
  function Probe() {
    api = useMessageSend({
      activeSession,
      requiresManagedModelConfig: false,
      copy,
      showImageBlockedToast: (message) => imageToasts.push(message),
      openModelsForMissingConfig: () => {},
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return { api: api!, imageToasts };
}

/** Let fire-and-forget handlers settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  resetStores();
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  bus.clear();
  tauriMocks.listen.mockImplementation(async (event, handler) => {
    const handlers = bus.get(event) ?? new Set<Handler>();
    handlers.add(handler as unknown as Handler);
    bus.set(event, handlers);
    return () => handlers.delete(handler as unknown as Handler);
  });
});

describe("a send through Core (send_user_message)", () => {
  it("cold session: listens first, Core's pending claims the echo, the offset lands before turn_start", async () => {
    const sid = "s-cold";
    // A stale count: the echo's offset guess (2) is not the row's (5).
    seed(sid, { turnCount: 2 });
    const phases = recordPhases(sid);
    let afterPending: { turns: number; offset: number } | undefined;
    let offsetAtTurnStart: number | undefined;
    core(async (args) => {
      const message = row(sid, 5, "继续整理");
      const crid = args.clientRequestId;
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: crid,
      });
      afterPending = {
        turns: userTurns(sid).length,
        offset: slice(sid).turnIndexOffset,
      };
      applyRunnerHistoryReplay({ sessionId: sid, phase: "started" });
      applyRunnerHistoryReplay({ sessionId: sid, phase: "done" });
      broadcast({
        sessionId: sid,
        message,
        dispatch: "dispatched",
        clientRequestId: crid,
      });
      offsetAtTurnStart = slice(sid).turnIndexOffset;
      runnerEvent({
        kind: "turn_start",
        sessionId: sid,
        turnIndex: 1,
        timestamp: NOW,
      });
      // No absoluteTurnIndex on the event: the offset places the row.
      runnerEvent(toolStepEnd(sid));
      return dispatched(message);
    });

    const outcome = await sendThroughCore(sid, {
      text: "继续整理",
      echo: "turn",
    });

    expect(outcome).toBe("dispatched");
    // runner-event / -malformed / -closed, all before the invoke.
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    const sendCall = tauriMocks.invoke.mock.calls.findIndex(
      ([c]) => c === "send_user_message",
    );
    expect(tauriMocks.listen.mock.invocationCallOrder[2]).toBeLessThan(
      tauriMocks.invoke.mock.invocationCallOrder[sendCall],
    );
    expect(calls("send_user_message")[0]).toMatchObject({
      sessionId: sid,
      text: "继续整理",
      images: [],
      clientRequestId: expect.any(String),
    });
    // Claimed, not appended: one user turn, keyed by the row.
    expect(afterPending).toEqual({ turns: 1, offset: 4 });
    expect(offsetAtTurnStart).toBe(4);
    expect(userTurns(sid)).toHaveLength(1);
    expect(userTurns(sid)[0]).toMatchObject({
      content: "继续整理",
      messageId: `msg_${sid}_5_user`,
    });
    const agent = slice(sid).turns.find((turn) => turn.role === "agent");
    expect(agent?.messageId).toBe(`msg_${sid}_5_assistant`);
    // saving → starting → restoring → working; the runner's turn_start
    // then takes over (and the invoke's late answer does not bring the
    // phase back).
    expect(phases).toEqual([
      null,
      "saving",
      "starting",
      "restoring",
      "waiting_agent",
      null,
    ]);
    expect(slice(sid).agentRunning).toBe(true);
    // The runner Core started is this page's now.
    expect(useRuntimeStore.getState().hasBridgeClient(sid)).toBe(true);
    expect(useRuntimeStore.getState().byId[sid]?.bridgePid).toBe(41);
  });

  it("the invoke's own answer claims the echo when the broadcasts are late", async () => {
    const sid = "s-late";
    seed(sid, { turnCount: 0 });
    let crid: string | undefined;
    core((args) => {
      crid = args.clientRequestId;
      return dispatched(row(sid, 1, "你好"));
    });

    await sendThroughCore(sid, { text: "你好", echo: "turn" });
    // …and the broadcasts arriving afterwards append nothing.
    broadcast({
      sessionId: sid,
      message: row(sid, 1, "你好"),
      dispatch: "pending",
      clientRequestId: crid,
    });
    broadcast({
      sessionId: sid,
      message: row(sid, 1, "你好"),
      dispatch: "dispatched",
      clientRequestId: crid,
    });

    expect(userTurns(sid)).toHaveLength(1);
    expect(userTurns(sid)[0].messageId).toBe(`msg_${sid}_1_user`);
    expect(slice(sid)).toMatchObject({
      agentRunning: true,
      sendPhase: "waiting_agent",
      turnIndexOffset: 0,
    });
  });

  it("persisted images replace the echo's data URLs on the claim", async () => {
    const sid = "s-img";
    seed(sid, { gaRuntimeKind: "managed" });
    const stored = {
      id: "att-1",
      messageId: `msg_${sid}_1_user`,
      sessionId: sid,
      kind: "image",
      path: "/data/attachments/att-1.png",
      mimeType: "image/png",
      byteSize: 10,
      createdAt: NOW,
    };
    let echoed: string | undefined;
    core((args) => {
      echoed = userTurns(sid)[0].attachments?.[0]?.path;
      const message = row(sid, 1, "看图", { attachments: [stored] });
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });

    await sendThroughCore(sid, {
      text: "看图",
      echo: "turn",
      images: [
        {
          id: "img-1",
          dataUrl: "data:image/png;base64,AAAA",
          previewUrl: "blob:x",
          mimeType: "image/png",
          byteSize: 10,
          width: 4,
          height: 3,
        },
      ],
    });

    expect(calls("send_user_message")[0]?.images).toEqual([
      { dataUrl: "data:image/png;base64,AAAA", width: 4, height: 3 },
    ]);
    expect(echoed).toBe("data:image/png;base64,AAAA");
    expect(userTurns(sid)[0].attachments).toEqual([stored]);
  });

  it("Core queued it (the page thought the session idle): the echo is taken back", async () => {
    const sid = "s-queued";
    seed(sid);
    const unlisten = vi.fn();
    tauriMocks.listen.mockResolvedValue(unlisten);
    core(() => QUEUED);

    const outcome = await sendThroughCore(sid, {
      text: "下一条",
      echo: "turn",
    });

    expect(outcome).toBe("queued");
    expect(userTurns(sid)).toHaveLength(0);
    expect(slice(sid)).toMatchObject({
      agentRunning: false,
      sendPhase: null,
      isStopping: false,
    });
    // No runner came back: the listeners came down again.
    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().hasBridgeClient(sid)).toBe(false);
    expect(useRuntimeStore.getState().byId[sid]?.bridgeStatus).toBe("idle");
  });

  it("queued after another sender's row took the run over: only the echo goes", async () => {
    const sid = "s-queued-cli";
    seed(sid);
    core(() => {
      // The CLI's send won the gate; its row arrives before the answer.
      broadcast({
        sessionId: sid,
        message: row(sid, 3, "CLI 先到", { origin: { via: "cli" } }),
        dispatch: "dispatched",
      });
      return QUEUED;
    });

    await sendThroughCore(sid, { text: "下一条", echo: "turn" });

    expect(userTurns(sid).map((turn) => turn.content)).toEqual(["CLI 先到"]);
    expect(slice(sid)).toMatchObject({
      agentRunning: true,
      sendPhase: "waiting_agent",
      turnIndexOffset: 2,
    });
  });

  it("a page already listening invokes without a second listener set", async () => {
    const sid = "s-warm";
    seed(sid);
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "ensure_session_runner"
        ? { pid: 50, spawned: false, ready: null }
        : command === "list_live_runners"
          ? []
          : undefined,
    );
    await useRuntimeStore.getState().ensureSessionRunner({ sessionId: sid });
    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    core((args) => {
      const message = row(sid, 1, "hi");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message, 50, false);
    });

    await sendThroughCore(sid, { text: "hi", echo: "turn" });

    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().hasBridgeClient(sid)).toBe(true);
  });

  it("Core's runner-spawned-external for the send's own start attaches nothing more", async () => {
    const sid = "s-dup-send";
    seed(sid);
    let fromEvent: Promise<void> | undefined;
    core((args) => {
      // Core broadcasts the start (via "gui") before the invoke returns;
      // the event handler calls attachExternalBridge.
      fromEvent = useRuntimeStore.getState().attachExternalBridge(sid, 41);
      const message = row(sid, 1, "hi");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });

    await sendThroughCore(sid, { text: "hi", echo: "turn" });
    await fromEvent;

    expect(tauriMocks.listen).toHaveBeenCalledTimes(3);
    expect(calls("list_live_runners")).toHaveLength(0);
    expect(useRuntimeStore.getState().hasBridgeClient(sid)).toBe(true);
  });

  it("EmptyState's model pick rides the send that starts a fresh session's runner", async () => {
    const sid = "s-pick";
    seed(sid, { turnCount: 0, selectedLlmKey: "B/model-b" });
    useRuntimeStore.setState({ pendingLLMIndex: 3 });
    core((args) => {
      const message = row(sid, 1, "hi");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });

    await sendThroughCore(sid, { text: "hi", echo: "turn" });

    expect(calls("send_user_message")[0]).toMatchObject({
      llmIndex: 3,
      llmKey: "B/model-b",
    });
    expect(useRuntimeStore.getState().pendingLLMIndex).toBeUndefined();
  });

  it("a session with history drops the pick instead of passing it", async () => {
    const sid = "s-pick-old";
    seed(sid, { turnCount: 4, selectedLlmKey: "A/model-a" });
    useRuntimeStore.setState({ pendingLLMIndex: 3 });
    core((args) => {
      const message = row(sid, 5, "hi");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });

    await sendThroughCore(sid, { text: "hi", echo: "turn" });

    expect(calls("send_user_message")[0]?.llmIndex).toBeUndefined();
    expect(calls("send_user_message")[0]?.llmKey).toBeUndefined();
    expect(useRuntimeStore.getState().pendingLLMIndex).toBeUndefined();
  });
});

describe("useMessageSend handlers", () => {
  beforeEach(() => {
    clearReplyNotifyPending("s-hook");
  });

  it("an ask_user answer goes through the same command, as an echo Core claims", async () => {
    const sid = "s-hook";
    const session = seed(sid);
    const messages = useMessagesStore.getState();
    messages.setAgentRunning(sid, true);
    messages.setPendingAskUser(sid, {
      question: "选哪个？",
      candidates: ["A", "B"],
    });
    core((args) => {
      const message = row(sid, 3, "选 A");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      broadcast({
        sessionId: sid,
        message,
        dispatch: "dispatched",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });
    const { api } = mountSend(session);

    api.sendUserMessage("选 A", []);
    // The echo lands at once and answers the question.
    expect(userTurns(sid)).toHaveLength(1);
    expect(slice(sid).pendingAskUser).toBeNull();
    await settle();

    expect(calls("send_user_message")).toHaveLength(1);
    expect(calls("send_user_message")[0]).toMatchObject({
      text: "选 A",
      clientRequestId: expect.any(String),
    });
    // Core picks ask_user_response; the page sends nothing to the runner.
    expect(calls("send_to_runner")).toHaveLength(0);
    expect(userTurns(sid)).toHaveLength(1);
    expect(slice(sid).sendPhase).toBe("waiting_agent");
    expect(consumeReplyNotifyPending(sid)).toBe(true);
  });

  it("/btw goes through the same command and stays a transient turn", async () => {
    const sid = "s-hook";
    const session = seed(sid);
    const messages = useMessagesStore.getState();
    messages.setAgentRunning(sid, true);
    messages.setSendPhase(sid, "waiting_agent");
    core(() => ({
      outcome: "side_question",
      message: null,
      queue: null,
      runner: { pid: 41, spawned: false, ready: null },
    }));
    const { api } = mountSend(session);

    api.sendUserMessage("/btw 现在几点", []);
    await settle();

    expect(calls("send_user_message")[0]).toMatchObject({
      text: "/btw 现在几点",
      clientRequestId: undefined,
    });
    const turn = userTurns(sid)[0];
    expect(turn.content).toBe("/btw 现在几点");
    expect(turn.clientRequestId).toBeUndefined();
    expect(turn.messageId).toBeUndefined();
    // The main run is untouched, and a /btw reply notifies nobody.
    expect(slice(sid)).toMatchObject({
      agentRunning: true,
      sendPhase: "waiting_agent",
    });
    expect(consumeReplyNotifyPending(sid)).toBe(false);
  });

  it("a send into an open run shows no echo; Core queues it", async () => {
    const sid = "s-hook";
    const session = seed(sid);
    useMessagesStore.getState().setAgentRunning(sid, true);
    core(() => QUEUED);
    const { api } = mountSend(session);

    api.sendUserMessage("排队这条", []);
    await settle();

    expect(calls("send_user_message")[0]).toMatchObject({
      text: "排队这条",
      clientRequestId: undefined,
    });
    expect(userTurns(sid)).toHaveLength(0);
    expect(slice(sid).agentRunning).toBe(true);
    expect(consumeReplyNotifyPending(sid)).toBe(true);
  });

  it("Core could not restore the history: the restore-timeout copy, the claimed turn stays", async () => {
    const sid = "s-hook";
    const session = seed(sid, { turnCount: 4 });
    core((args) => {
      const message = row(sid, 5, "继续");
      broadcast({
        sessionId: sid,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      broadcast({
        sessionId: sid,
        message,
        dispatch: "persisted_only",
        clientRequestId: args.clientRequestId,
      });
      throw JSON.stringify({
        error: "history_replay",
        detail: "the runner refused load_history: boom",
      });
    });
    const { api } = mountSend(session);

    api.sendUserMessage("继续", []);
    await settle();

    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      title: copy.errors.sendFailed,
      message: copy.app.restoreTimeout,
    });
    expect(userTurns(sid)).toHaveLength(1);
    expect(userTurns(sid)[0].messageId).toBe(`msg_${sid}_5_user`);
    expect(slice(sid)).toMatchObject({ agentRunning: false, sendPhase: null });
    expect(consumeReplyNotifyPending(sid)).toBe(false);
  });

  it("images Core refuses show the image toast, not a send failure", async () => {
    const sid = "s-hook";
    const session = seed(sid, { gaRuntimeKind: "external" });
    core(() => {
      throw JSON.stringify({
        error: "images_not_supported",
        detail: "the session's model cannot receive images",
      });
    });
    const { api, imageToasts } = mountSend(session);

    api.sendUserMessage("看图", [
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,AAAA",
        previewUrl: "blob:x",
        mimeType: "image/png",
        byteSize: 10,
      },
    ]);
    await settle();

    expect(imageToasts).toEqual([copy.toasts.imageBlockedExternal]);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(slice(sid)).toMatchObject({ agentRunning: false, sendPhase: null });
  });

  it("a runner that could not start: bridge error state, the send fails", async () => {
    const sid = "s-hook-spawn";
    const session = seed(sid);
    core(() => {
      throw JSON.stringify({
        error: "python_not_found",
        detail: "python3: no such file",
      });
    });
    const { api } = mountSend(session);

    api.sendUserMessage("hi", []);
    await settle();

    expect(useRuntimeStore.getState().byId[sid]).toMatchObject({
      bridgeStatus: "error",
      bridgePid: null,
    });
    expect(useRuntimeStore.getState().hasBridgeClient(sid)).toBe(false);
    // As an activation's failed start did before the send owned it: the
    // bridge-failed toast, then the send's own.
    const titles = useUiStore.getState().toasts.map((toast) => toast.title);
    expect(titles).toHaveLength(2);
    expect(titles).toEqual(
      expect.arrayContaining([
        copy.errors.bridgeFailed,
        copy.errors.sendFailed,
      ]),
    );
  });

  it("submitFromEmpty: the send, not an activation, starts the runner — with the pick", async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: undefined });
    useRuntimeStore.setState({ pendingLLMIndex: 2 });
    core((args) => {
      const message = row(args.sessionId, 1, "第一条");
      broadcast({
        sessionId: args.sessionId,
        message,
        dispatch: "pending",
        clientRequestId: args.clientRequestId,
      });
      return dispatched(message);
    });
    const { api } = mountSend();

    api.submitFromEmpty("第一条", []);
    await settle();

    expect(calls("create_session")).toHaveLength(1);
    expect(calls("ensure_session_runner")).toHaveLength(0);
    const sid = useSessionsStore.getState().activeSessionId!;
    expect(calls("send_user_message")[0]).toMatchObject({
      sessionId: sid,
      text: "第一条",
      llmIndex: 2,
    });
    expect(useUiStore.getState().screen).toBe("main");
    expect(userTurns(sid)).toHaveLength(1);
    expect(useRuntimeStore.getState().byId[sid]).toBeDefined();
    expect(consumeReplyNotifyPending(sid)).toBe(true);
  });

  describe("stopRun → stop_session_run", () => {
    function running(sid: string): Session {
      const session = seed(sid);
      useMessagesStore.getState().setAgentRunning(sid, true);
      useMessagesStore.getState().setCurrentTurnIndex(sid, 2);
      return session;
    }

    it("abort sent: stays stopping until the run ends", async () => {
      const sid = "s-stop-1";
      const session = running(sid);
      tauriMocks.invoke.mockResolvedValue({ dispatch: "abort_sent" });
      const { api } = mountSend(session);

      api.stopRun();
      expect(slice(sid).isStopping).toBe(true);
      await settle();

      expect(calls("stop_session_run")).toEqual([{ sessionId: sid }]);
      expect(calls("send_to_runner")).toHaveLength(0);
      expect(slice(sid)).toMatchObject({
        isStopping: true,
        agentRunning: true,
      });
    });

    it("already stopped: the stale run display ends", async () => {
      const sid = "s-stop-2";
      const session = running(sid);
      tauriMocks.invoke.mockResolvedValue({ dispatch: "already_stopped" });
      const { api } = mountSend(session);

      api.stopRun();
      await settle();

      expect(slice(sid)).toMatchObject({
        isStopping: false,
        agentRunning: false,
        currentTurnIndex: null,
      });
    });

    it("already stopped while a send waits for Core: only unlocks", async () => {
      const sid = "s-stop-3";
      const session = seed(sid);
      useMessagesStore.getState().appendUserTurn(sid, "hi", "req-1");
      tauriMocks.invoke.mockResolvedValue({ dispatch: "already_stopped" });
      const { api } = mountSend(session);

      api.stopRun();
      await settle();

      expect(slice(sid)).toMatchObject({
        isStopping: false,
        agentRunning: true,
        sendPhase: "saving",
      });
    });

    it("a failed stop unlocks the button and says so", async () => {
      const sid = "s-stop-4";
      const session = running(sid);
      tauriMocks.invoke.mockRejectedValue(
        JSON.stringify({ error: "write_io", detail: "broken pipe" }),
      );
      const { api } = mountSend(session);

      api.stopRun();
      await settle();

      expect(slice(sid).isStopping).toBe(false);
      expect(useUiStore.getState().toasts[0]).toMatchObject({
        title: copy.errors.stopFailed,
      });
    });
  });
});
