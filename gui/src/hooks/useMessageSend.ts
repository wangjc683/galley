import { useCallback } from "react";

import type { AppCopy } from "@/lib/i18n";
import { ensureHistoryReplayComplete } from "@/lib/ipc/history-replay";
import { markReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import type { Screen } from "@/stores/ui";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { PendingImageAttachment } from "@/types/conversation";
import type { ApprovalDecision, IPCCommand } from "@/types/ipc";
import type { Session } from "@/types/session";

/**
 * Everything that turns a user action into a bridge command: approvals,
 * the main-view send path (with lazy bridge spawn + history replay),
 * `/btw` side questions, the empty-screen first-message path, Stop, and
 * the Browser Control demo. Pulled out of App so the 1700-line entry
 * component stops carrying ~300 lines of dense IPC choreography inline.
 *
 * All deps are passed in — the hook owns no store subscriptions of its
 * own, only `getState()` reads for the roll-back / optimistic paths
 * (mirroring what App did before the move). Returned handlers keep the
 * exact signatures App fed to MainView / EmptyState / MainHeader, so the
 * JSX call sites shrink to a single reference each.
 */
export function useMessageSend({
  activeSessionId,
  activeSession,
  pendingAskUser,
  requiresManagedModelConfig,
  activeRuntimeKind,
  activeProjectFilter,
  copy,
  recordApprovalDecision,
  removePendingApproval,
  sendIPCCommand,
  shutdownBridge,
  activateSession,
  appendUserTurn,
  appendSideQuestionUserTurn,
  createSession,
  createSessionPersisted,
  setScreen,
  setActiveProjectFilter,
  pushToast,
  showImageBlockedToast,
  openModelsForMissingConfig,
}: {
  activeSessionId: string | undefined;
  activeSession: Session | undefined;
  pendingAskUser: unknown;
  requiresManagedModelConfig: boolean;
  activeRuntimeKind: string;
  activeProjectFilter: string | undefined;
  copy: AppCopy;
  recordApprovalDecision: (
    sid: string,
    approvalId: string,
    decision: ApprovalDecision,
  ) => void;
  removePendingApproval: (sid: string, approvalId: string) => void;
  sendIPCCommand: (sid: string, cmd: IPCCommand) => Promise<void>;
  shutdownBridge: (sid: string) => Promise<void>;
  activateSession: (id: string) => Promise<void>;
  appendUserTurn: (
    sessionId: string,
    text: string,
    attachments?: PendingImageAttachment[],
  ) => Promise<{
    turnIndex: number;
    attachments: { path: string }[];
  }>;
  appendSideQuestionUserTurn: (sessionId: string, text: string) => void;
  createSession: () => string;
  createSessionPersisted: (
    projectId?: string,
    title?: string,
  ) => Promise<string>;
  setScreen: (s: Screen) => void;
  setActiveProjectFilter: (id: string | undefined) => void;
  pushToast: (error: ReturnType<typeof makeAppError>) => void;
  showImageBlockedToast: (message: string) => void;
  openModelsForMissingConfig: () => void;
}) {
  const reportUserSendFailure = (sid: string, context: string, e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[main] send failed", { sid, message });
    const m = useMessagesStore.getState();
    m.setAgentRunning(sid, false);
    m.setCurrentTurnIndex(sid, null);
    m.setSendPhase(sid, null);
    m.clearInFlightContent(sid);
    useUiStore.getState().pushToast(
      makeAppError({
        category: "bridge",
        severity: "error",
        title: copy.errors.sendFailed,
        message,
        hint: null,
        retryable: true,
        context,
        traceback: null,
      }),
    );
  };

  // Stable approve handler — passed down to MainView → ToolCallout
  // (React.memo'd). Keeping it referentially stable lets settled
  // ToolCallouts skip re-render during the low-frequency App renders
  // that still happen (pendingAskUser changes etc.). The deps are the
  // only values the body reads.
  const handleApprove = useCallback(
    (approvalId: string, decision: ApprovalDecision) => {
      if (!activeSessionId) return;
      const sid = activeSessionId;
      // Snapshot before the optimistic removal so a failed send can
      // put the card back.
      const pending = useMessagesStore
        .getState()
        .byId[sid]?.pendingApprovals.find((p) => p.approvalId === approvalId);
      recordApprovalDecision(sid, approvalId, decision);
      removePendingApproval(sid, approvalId);
      sendIPCCommand(sid, {
        kind: "approval_response",
        approvalId,
        decision,
      }).catch((e) => {
        // The bridge never received the decision: the run is still
        // blocked on this approval. Roll the optimistic UI back so the
        // card doesn't show a decided pill for a decision GA never saw.
        const m = useMessagesStore.getState();
        m.revokeApprovalDecision(sid, approvalId);
        if (pending) m.addPendingApproval(sid, pending);
        useUiStore.getState().pushToast(
          makeAppError({
            category: "bridge",
            severity: "error",
            title: copy.errors.approvalSendFailed,
            message: e instanceof Error ? e.message : String(e),
            hint: null,
            retryable: true,
            context: "approval_response",
            traceback: null,
          }),
        );
      });
    },
    [
      activeSessionId,
      recordApprovalDecision,
      removePendingApproval,
      sendIPCCommand,
      copy,
    ],
  );

  const runBrowserControlDemo = async () => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    let demoSid: string | null = null;
    try {
      const sid = createSession();
      demoSid = sid;
      await activateSession(sid);
      setScreen("main");
      const persisted = await appendUserTurn(
        sid,
        copy.browserControl.demoPrompt,
      );
      const absoluteTurnIndex = persisted.turnIndex;
      await sendIPCCommand(sid, {
        kind: "user_message",
        text: copy.browserControl.demoPrompt,
        images: [],
        absoluteTurnIndex,
      });
    } catch (e) {
      if (demoSid) {
        reportUserSendFailure(demoSid, "browser_control_demo", e);
      } else {
        const message = e instanceof Error ? e.message : String(e);
        useUiStore.getState().pushToast(
          makeAppError({
            category: "bridge",
            severity: "error",
            title: copy.errors.sendFailed,
            message,
            hint: null,
            retryable: true,
            context: "browser_control_demo",
            traceback: null,
          }),
        );
      }
    }
  };

  // Main-view composer submit. Returns `false` on a rejected image
  // attachment so the Composer keeps the draft; otherwise void.
  const sendUserMessage = (t: string, images: PendingImageAttachment[]) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    // Main screen always has an active session — Sidebar
    // / EmptyState set it before transitioning here.
    if (!activeSessionId) return;
    const sid = activeSessionId;
    const ensureBridgeThenSend = async (
      cmd:
        | {
            kind: "user_message";
            text: string;
            images: string[];
            absoluteTurnIndex?: number | null;
          }
        | {
            kind: "ask_user_response";
            text: string;
            absoluteTurnIndex?: number | null;
          },
      options: { showPhase?: boolean } = {},
    ) => {
      const sendStartedAt = perfNow();
      const showPhase = options.showPhase ?? true;
      const setSendPhase = (
        phase: "starting" | "restoring" | "waiting_agent" | "sent",
      ) => {
        if (showPhase) {
          useMessagesStore.getState().setSendPhase(sid, phase);
        }
      };
      const runtime = useRuntimeStore.getState();
      const latestStatus = runtime.byId[sid]?.bridgeStatus ?? "idle";
      if (
        latestStatus !== "spawning" &&
        (latestStatus !== "connected" || !runtime.hasBridgeClient(sid))
      ) {
        setSendPhase("starting");
        await activateSession(sid);
      }
      if (cmd.kind === "user_message") {
        setSendPhase("restoring");
        let historyReady = await ensureHistoryReplayComplete(sid);
        if (!historyReady) {
          console.warn(
            "[main] history replay did not confirm; restarting bridge.",
            { sid },
          );
          await shutdownBridge(sid);
          setSendPhase("starting");
          await activateSession(sid);
          setSendPhase("restoring");
          historyReady = await ensureHistoryReplayComplete(sid);
          if (!historyReady) {
            throw new Error(copy.app.restoreTimeout);
          }
        }
      }
      setSendPhase("waiting_agent");
      await sendIPCCommand(sid, cmd);
      setSendPhase("sent");
      logPerf("app.ensureBridgeThenSend", sendStartedAt, {
        sessionId: sid,
        command: cmd.kind,
        phaseVisible: showPhase,
      });
    };
    const reportSendFailure = (e: unknown) =>
      reportUserSendFailure(sid, "send_user_message", e);
    // `/btw` is a side question (interruption-free,
    // not a main-agent turn). Route to the transient
    // user-turn path so it doesn't disturb the main
    // agent's running state — bridge intercepts the
    // user_message command and runs the btw worker
    // independently of the task queue.
    const trimmed = t.trimStart();
    if (images.length > 0) {
      if (activeSession?.gaRuntimeKind !== "managed") {
        showImageBlockedToast(copy.toasts.imageBlockedExternal);
        return false;
      }
      if (
        trimmed === "/btw" ||
        trimmed.startsWith("/btw ") ||
        pendingAskUser !== null
      ) {
        showImageBlockedToast(copy.toasts.imageBlockedGoal);
        return false;
      }
    }
    if (trimmed === "/btw" || trimmed.startsWith("/btw ")) {
      appendSideQuestionUserTurn(sid, t);
      void ensureBridgeThenSend(
        {
          kind: "user_message",
          text: t,
          images: [],
        },
        { showPhase: false },
      ).catch(reportSendFailure);
      return;
    }
    // Snapshot pendingAskUser **before** appendUserTurn
    // clears it — we need to know which IPC command to
    // send. ask_user_response and user_message both
    // ultimately call agent.put_task on the bridge side
    // (same agent_runner_loop kickoff), but keeping
    // them distinct preserves audit-trail clarity:
    // "this user message was a reply to a specific
    // question" vs "this was a fresh prompt".
    const wasAskUser = pendingAskUser !== null;
    void (async () => {
      const persisted = await appendUserTurn(sid, t, images);
      const absoluteTurnIndex = persisted.turnIndex;
      if (wasAskUser) {
        await ensureBridgeThenSend({
          kind: "ask_user_response",
          text: t,
          absoluteTurnIndex,
        });
      } else {
        await ensureBridgeThenSend({
          kind: "user_message",
          text: t,
          images: persisted.attachments.map((attachment) => attachment.path),
          absoluteTurnIndex,
        });
      }
      // Reply-done notification is scoped to runs the user started
      // from this GUI — mark only after the send actually reached the
      // bridge. (/btw side questions above stay unmarked: their reply
      // isn't a main-agent run terminus.)
      markReplyNotifyPending(sid);
    })().catch(reportSendFailure);
  };

  const stopRun = () => {
    console.info("[main] stop");
    if (!activeSessionId) return;
    const sid = activeSessionId;
    // Optimistic: lock the button immediately; unlock
    // if the abort never reached the bridge, otherwise
    // the run keeps going with Stop dead.
    useMessagesStore.getState().setStopping(sid, true);
    sendIPCCommand(sid, { kind: "abort" }).catch((e) => {
      useMessagesStore.getState().setStopping(sid, false);
      pushToast(
        makeAppError({
          category: "bridge",
          severity: "error",
          title: copy.errors.stopFailed,
          message: e instanceof Error ? e.message : String(e),
          hint: null,
          retryable: true,
          context: "abort",
          traceback: null,
        }),
      );
    });
  };

  // Empty-screen composer submit. Same rejected-image `false` return as
  // sendUserMessage; the session is created lazily inside submitOnEmpty.
  const submitFromEmpty = (t: string, images: PendingImageAttachment[]) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    if (images.length > 0 && activeRuntimeKind !== "managed") {
      showImageBlockedToast(copy.toasts.imageBlockedExternal);
      return false;
    }
    void submitOnEmpty(
      t,
      images,
      activeSessionId,
      createSessionPersisted,
      activateSession,
      appendUserTurn,
      sendIPCCommand,
      setScreen,
      reportUserSendFailure,
      copy.errors.sendFailed,
      copy.app.restoreTimeout,
      activeProjectFilter,
    ).then(() => {
      if (activeProjectFilter) setActiveProjectFilter(undefined);
    });
  };

  return {
    handleApprove,
    sendUserMessage,
    submitFromEmpty,
    stopRun,
    runBrowserControlDemo,
  };
}

// ---------------- Lazy session creation ----------------

/**
 * Empty-screen submit handler. The session is created lazily — the
 * first user-initiated action (typing a message or clicking a quick
 * prompt) is what bumps us from "no chat yet" to "real chat".
 *
 * Flow:
 *   1. If there's already an active session id, reuse it.
 *   2. Otherwise create a persisted session row first so the user
 *      message write cannot race the async session create.
 *   3. Transition to main view + append the user turn before bridge
 *      startup, so cold runner spawn doesn't look like a frozen UI.
 *   4. Activate the session, replay history, then send the IPC message.
 *
 * sendIPCCommand waits for the bridge `ready` event before writing
 * user-visible commands. This keeps first-run Windows startup stalls from
 * turning into a silent, indefinite "thinking" state.
 */
async function submitOnEmpty(
  text: string,
  attachments: PendingImageAttachment[],
  existingId: string | undefined,
  createSessionPersisted: (projectId?: string) => Promise<string>,
  activateSession: (id: string) => Promise<void>,
  appendUserTurn: (
    sessionId: string,
    text: string,
    attachments?: PendingImageAttachment[],
  ) => Promise<{
    turnIndex: number;
    attachments: { path: string }[];
  }>,
  sendIPCCommand: (
    sessionId: string,
    cmd: {
      kind: "user_message";
      text: string;
      images?: string[];
      absoluteTurnIndex?: number | null;
    },
  ) => Promise<void>,
  setScreen: (s: Screen) => void,
  reportSendFailure: (
    sessionId: string,
    context: string,
    error: unknown,
  ) => void,
  sendFailedTitle: string,
  restoreTimeoutMessage: string,
  inheritProjectId?: string,
): Promise<void> {
  const submitStartedAt = perfNow();
  let id = existingId;
  try {
    if (!id) {
      // Inherit project assignment when the EmptyState composer was
      // opened from a project's inline +. The context is one-shot:
      // after the first message creates the session, App clears the
      // pending project id.
      id = await createSessionPersisted(inheritProjectId);
    }
    setScreen("main");
    const persisted = await appendUserTurn(id, text, attachments);
    const absoluteTurnIndex = persisted.turnIndex;
    const messages = useMessagesStore.getState();
    const runtime = useRuntimeStore.getState();
    const status = runtime.byId[id]?.bridgeStatus ?? "idle";
    if (
      status !== "spawning" &&
      (status !== "connected" || !runtime.hasBridgeClient(id))
    ) {
      messages.setSendPhase(id, "starting");
      await activateSession(id);
    }
    messages.setSendPhase(id, "restoring");
    const historyReady = await ensureHistoryReplayComplete(id);
    if (!historyReady) {
      throw new Error(restoreTimeoutMessage);
    }
    messages.setSendPhase(id, "waiting_agent");
    await sendIPCCommand(id, {
      kind: "user_message",
      text,
      images: persisted.attachments.map((attachment) => attachment.path),
      absoluteTurnIndex,
    });
    markReplyNotifyPending(id);
    messages.setSendPhase(id, "sent");
    logPerf("app.submitOnEmpty", submitStartedAt, {
      sessionId: id,
      createdSession: existingId === undefined,
    });
  } catch (e) {
    if (id) {
      reportSendFailure(id, "send_user_message", e);
    } else {
      console.warn("[main] empty submit failed before session creation", e);
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: sendFailedTitle,
          message: e instanceof Error ? e.message : String(e),
          hint: null,
          retryable: true,
          context: "create_session_for_send",
          traceback: null,
        }),
      );
    }
  }
}
