import { useCallback } from "react";

import type { AppCopy } from "@/lib/i18n";
import { ensureHistoryReplayComplete } from "@/lib/ipc/history-replay";
import { markReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import { isSideQuestion } from "@/lib/side-question";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { PendingImageAttachment } from "@/types/conversation";
import type { ApprovalDecision } from "@/types/ipc";
import type { Session } from "@/types/session";

/** The two main-agent commands the send machine can deliver. `/btw`
 * side questions ride `user_message` too (the bridge intercepts them);
 * only `user_message` needs history replay before dispatch. */
type MainSendCommand =
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
    };

/**
 * THE send-phase machine — the one place a user-visible send acquires a
 * bridge, replays history, and dispatches. Both composers go through it
 * (main view via `sendUserMessage`, empty screen via `submitFromEmpty`),
 * so the phase choreography and the replay-failure policy cannot drift
 * between them again (before 2026-07-28 the empty path had a weaker
 * throw-on-first-failure copy of this logic; the restart-retry below is
 * now the single policy).
 *
 * Replay policy: a `user_message` must land on a bridge that has
 * confirmed history replay, or GA would run the task on a truncated
 * conversation. One silent restart is attempted before giving up.
 *
 * Exported for `useMessageSend.test.ts` — this function is the
 * module's deep core; the hook around it is React binding.
 */
export async function ensureBridgeThenSend(
  sid: string,
  cmd: MainSendCommand,
  opts: { showPhase?: boolean; restoreTimeoutMessage: string },
): Promise<void> {
  const sendStartedAt = perfNow();
  const showPhase = opts.showPhase ?? true;
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
    await useSessionsStore.getState().activateSession(sid);
  }
  if (cmd.kind === "user_message") {
    setSendPhase("restoring");
    let historyReady = await ensureHistoryReplayComplete(sid);
    if (!historyReady) {
      console.warn("[main] history replay did not confirm; restarting bridge.", {
        sid,
      });
      await useRuntimeStore.getState().shutdownBridge(sid);
      setSendPhase("starting");
      await useSessionsStore.getState().activateSession(sid);
      setSendPhase("restoring");
      historyReady = await ensureHistoryReplayComplete(sid);
      if (!historyReady) {
        throw new Error(opts.restoreTimeoutMessage);
      }
    }
  }
  setSendPhase("waiting_agent");
  await useRuntimeStore.getState().sendIPCCommand(sid, cmd);
  setSendPhase("sent");
  logPerf("app.ensureBridgeThenSend", sendStartedAt, {
    sessionId: sid,
    command: cmd.kind,
    phaseVisible: showPhase,
  });
}

/**
 * Everything that turns a user action into a bridge command: approvals,
 * the main-view send path (with lazy bridge spawn + history replay),
 * `/btw` side questions, the empty-screen first-message path, Stop, and
 * the Browser Control demo. Pulled out of App so the entry component
 * stops carrying ~300 lines of dense IPC choreography inline.
 *
 * The handlers are event handlers, not render-time derivations, so they
 * read store state and actions at call time (`getState()`) — that is
 * both the honest version of what this hook always did and what keeps
 * the interface down to the few values App genuinely owns: view-derived
 * state (`activeSession`), derived model config, localized copy, and two
 * App-local callbacks. Returned handlers keep the exact signatures
 * MainView / EmptyState / MainHeader expect.
 */
export function useMessageSend({
  activeSession,
  requiresManagedModelConfig,
  copy,
  showImageBlockedToast,
  openModelsForMissingConfig,
}: {
  /** App's view-derived active session (screen + archived filtering) —
   * deliberately not re-derived here from the raw store. */
  activeSession: Session | undefined;
  requiresManagedModelConfig: boolean;
  copy: AppCopy;
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
  // that still happen. Everything else is read at call time, so `copy`
  // is the only dependency.
  const handleApprove = useCallback(
    (approvalId: string, decision: ApprovalDecision) => {
      const sid = useSessionsStore.getState().activeSessionId;
      if (!sid) return;
      const m = useMessagesStore.getState();
      // Snapshot before the optimistic removal so a failed send can
      // put the card back.
      const pending = m.byId[sid]?.pendingApprovals.find(
        (p) => p.approvalId === approvalId,
      );
      m.recordApprovalDecision(sid, approvalId, decision);
      m.removePendingApproval(sid, approvalId);
      useRuntimeStore
        .getState()
        .sendIPCCommand(sid, {
          kind: "approval_response",
          approvalId,
          decision,
        })
        .catch((e) => {
          // The bridge never received the decision: the run is still
          // blocked on this approval. Roll the optimistic UI back so the
          // card doesn't show a decided pill for a decision GA never saw.
          const messages = useMessagesStore.getState();
          messages.revokeApprovalDecision(sid, approvalId);
          if (pending) messages.addPendingApproval(sid, pending);
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
    [copy],
  );

  const runBrowserControlDemo = async () => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    let demoSid: string | null = null;
    try {
      const sid = useSessionsStore.getState().createSession();
      demoSid = sid;
      await useSessionsStore.getState().activateSession(sid);
      useUiStore.getState().setScreen("main");
      const persisted = await useMessagesStore
        .getState()
        .appendUserTurn(sid, copy.browserControl.demoPrompt);
      await useRuntimeStore.getState().sendIPCCommand(sid, {
        kind: "user_message",
        text: copy.browserControl.demoPrompt,
        images: [],
        absoluteTurnIndex: persisted.turnIndex,
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
    const sid = useSessionsStore.getState().activeSessionId;
    if (!sid) return;
    const sendOpts = { restoreTimeoutMessage: copy.app.restoreTimeout };
    const reportSendFailure = (e: unknown) =>
      reportUserSendFailure(sid, "send_user_message", e);
    // Snapshot pendingAskUser now — appendUserTurn clears it, and we
    // need it both for the image gate and to pick which IPC command to
    // send below.
    const pendingAskUser =
      useMessagesStore.getState().byId[sid]?.pendingAskUser ?? null;
    // `/btw` is a side question (interruption-free,
    // not a main-agent turn). Route to the transient
    // user-turn path so it doesn't disturb the main
    // agent's running state — bridge intercepts the
    // user_message command and runs the btw worker
    // independently of the task queue. The predicate
    // is shared with the Composer's stop gate: what
    // passed the gate as a side question must route
    // as one here.
    if (images.length > 0) {
      if (activeSession?.gaRuntimeKind !== "managed") {
        showImageBlockedToast(copy.toasts.imageBlockedExternal);
        return false;
      }
      if (isSideQuestion(t) || pendingAskUser !== null) {
        showImageBlockedToast(copy.toasts.imageBlockedGoal);
        return false;
      }
    }
    if (isSideQuestion(t)) {
      useMessagesStore.getState().appendSideQuestionUserTurn(sid, t);
      void ensureBridgeThenSend(
        sid,
        { kind: "user_message", text: t, images: [] },
        { ...sendOpts, showPhase: false },
      ).catch(reportSendFailure);
      return;
    }
    // ask_user_response and user_message both ultimately call
    // agent.put_task on the bridge side (same agent_runner_loop
    // kickoff), but keeping them distinct preserves audit-trail
    // clarity: "this user message was a reply to a specific question"
    // vs "this was a fresh prompt".
    const wasAskUser = pendingAskUser !== null;
    void (async () => {
      const persisted = await useMessagesStore
        .getState()
        .appendUserTurn(sid, t, images);
      const absoluteTurnIndex = persisted.turnIndex;
      if (wasAskUser) {
        await ensureBridgeThenSend(
          sid,
          { kind: "ask_user_response", text: t, absoluteTurnIndex },
          sendOpts,
        );
      } else {
        await ensureBridgeThenSend(
          sid,
          {
            kind: "user_message",
            text: t,
            images: persisted.attachments.map((attachment) => attachment.path),
            absoluteTurnIndex,
          },
          sendOpts,
        );
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
    const sid = useSessionsStore.getState().activeSessionId;
    if (!sid) return;
    // Optimistic: lock the button immediately; unlock
    // if the abort never reached the bridge, otherwise
    // the run keeps going with Stop dead.
    useMessagesStore.getState().setStopping(sid, true);
    useRuntimeStore
      .getState()
      .sendIPCCommand(sid, { kind: "abort" })
      .catch((e) => {
        useMessagesStore.getState().setStopping(sid, false);
        useUiStore.getState().pushToast(
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

  /**
   * Empty-screen composer submit. The session is created lazily — the
   * first user-initiated action is what bumps us from "no chat yet" to
   * a real chat; a persisted row is created first so the user-message
   * write cannot race the async session create. The screen transition
   * and the user turn land before bridge startup, so a cold runner
   * spawn doesn't look like a frozen UI. Same rejected-image `false`
   * return as sendUserMessage.
   */
  const submitFromEmpty = (t: string, images: PendingImageAttachment[]) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    if (
      images.length > 0 &&
      usePrefsStore.getState().activeRuntimeKind !== "managed"
    ) {
      showImageBlockedToast(copy.toasts.imageBlockedExternal);
      return false;
    }
    void (async () => {
      const submitStartedAt = perfNow();
      const sessions = useSessionsStore.getState();
      // Inherit project assignment when the EmptyState composer was
      // opened from a project's inline +. The context is one-shot:
      // cleared below after the first message creates the session.
      const inheritProjectId = sessions.activeProjectFilter;
      let id = sessions.activeSessionId;
      try {
        if (!id) {
          id = await sessions.createSessionPersisted(inheritProjectId);
        }
        useUiStore.getState().setScreen("main");
        const persisted = await useMessagesStore
          .getState()
          .appendUserTurn(id, t, images);
        await ensureBridgeThenSend(
          id,
          {
            kind: "user_message",
            text: t,
            images: persisted.attachments.map((attachment) => attachment.path),
            absoluteTurnIndex: persisted.turnIndex,
          },
          { restoreTimeoutMessage: copy.app.restoreTimeout },
        );
        markReplyNotifyPending(id);
        logPerf("app.submitOnEmpty", submitStartedAt, {
          sessionId: id,
          createdSession: sessions.activeSessionId === undefined,
        });
      } catch (e) {
        if (id) {
          reportUserSendFailure(id, "send_user_message", e);
        } else {
          console.warn("[main] empty submit failed before session creation", e);
          useUiStore.getState().pushToast(
            makeAppError({
              category: "business",
              severity: "error",
              title: copy.errors.sendFailed,
              message: e instanceof Error ? e.message : String(e),
              hint: null,
              retryable: true,
              context: "create_session_for_send",
              traceback: null,
            }),
          );
        }
      }
      // Attempt finished either way — the one-shot project context must
      // not leak into the next empty-screen visit.
      if (inheritProjectId) {
        useSessionsStore.getState().setActiveProjectFilter(undefined);
      }
    })();
  };

  return {
    handleApprove,
    sendUserMessage,
    submitFromEmpty,
    stopRun,
    runBrowserControlDemo,
  };
}
