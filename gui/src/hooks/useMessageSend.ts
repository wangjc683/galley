import type { AppCopy } from "@/lib/i18n";
import { markReplyNotifyPending } from "@/lib/notify";
import { logPerf, perfNow } from "@/lib/perf";
import {
  imageRefusalTag,
  SendUserMessageError,
  stopSessionRun,
  type SendOutcome,
} from "@/lib/session-send";
import { isSideQuestion } from "@/lib/side-question";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { takePendingLLMPick, useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { PendingImageAttachment } from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * How a send shows before Core settles it:
 *   - `turn`: the optimistic user turn of a main-agent send the page
 *     believes it can start (idle session, or an ask_user answer) —
 *     claimed by Core's `pending` broadcast, retracted if Core queues it;
 *   - `side_question`: the transient `/btw` turn (never persisted);
 *   - `none`: nothing — a send into an open run, which Core queues (the
 *     queue bar shows it) or, when the run just ended, dispatches (the
 *     row arrives through `user-message-persisted`).
 */
export type SendEcho = "turn" | "side_question" | "none";

/**
 * THE send machine (ticket 02c) — one Core command for every user send:
 * `send_user_message`. Core reserves the run, persists the row (and its
 * images, and the seed title), starts the runner or confirms its history
 * (02a / 02b), and dispatches — the message or the ask_user answer —
 * or queues it, or forwards a `/btw` without persisting it. This page
 * shows the echo, puts its runner listeners up first when it holds none
 * (`deliverUserMessage`), and passes the EmptyState model pick for a
 * runner Core starts for a fresh session.
 *
 * Send phases: `saving` from the echo, `starting` when Core's `pending`
 * broadcast claims it, `restoring` while Core replays history
 * (`runner-history-replay`), `waiting_agent` once dispatched — by the
 * `dispatched` broadcast or this command's own answer, whichever lands
 * first.
 *
 * Resolves to Core's outcome; throws Core's failure
 * (`SendUserMessageError`). An echo Core persisted before failing stays
 * in the transcript, as the row does.
 *
 * Exported for `useMessageSend.test.ts` — this function is the
 * module's deep core; the hook around it is React binding.
 */
export async function sendThroughCore(
  sid: string,
  request: {
    text: string;
    images?: PendingImageAttachment[];
    echo: SendEcho;
  },
): Promise<SendOutcome> {
  const { text, images = [], echo } = request;
  const runtime = useRuntimeStore.getState();
  // Before the echo: the pick applies only while the transcript is
  // empty. A page already listening to the session's runner starts none.
  const llmPick = runtime.hasBridgeClient(sid)
    ? {}
    : takePendingLLMPick(
        sid,
        useSessionsStore.getState().sessions.find((s) => s.id === sid),
      );
  const messages = useMessagesStore.getState();
  let clientRequestId: string | undefined;
  if (echo === "turn") {
    clientRequestId = crypto.randomUUID();
    messages.appendUserTurn(sid, text, clientRequestId, images);
  } else if (echo === "side_question") {
    messages.appendSideQuestionUserTurn(sid, text);
  }
  const result = await runtime.deliverUserMessage({
    sessionId: sid,
    text,
    images: images.map(({ dataUrl, width, height }) => ({
      dataUrl,
      width,
      height,
    })),
    clientRequestId,
    ...llmPick,
    // prefsStore is a leaf in the slice DAG — transitional, as for the
    // activation's ensure (ticket 02a).
    gaConfig: usePrefsStore.getState().gaConfig,
  });
  const latest = useMessagesStore.getState();
  if (result.outcome === "dispatched" && result.message) {
    // Same as the `dispatched` broadcast, which may still be in flight:
    // claims (or appends) the row if no broadcast did yet, moves the
    // phase on to working.
    latest.applyUserMessagePersisted({
      sessionId: sid,
      message: result.message,
      dispatch: "dispatched",
      clientRequestId,
    });
  } else if (result.outcome === "queued" && clientRequestId) {
    // The page thought the session idle; Core found a run open and
    // queued the text. The queue bar shows it now.
    latest.retractUserTurn(sid, clientRequestId);
  }
  return result.outcome;
}

/**
 * Core found no run to stop (`already_stopped`). A send this page echoed
 * but Core has not opened yet only unlocks the button — its run is about
 * to start. Otherwise the page's running state is stale: end it the way
 * `run_complete` does.
 */
function settleStoppedRun(sid: string): void {
  const messages = useMessagesStore.getState();
  const phase = messages.byId[sid]?.sendPhase ?? null;
  messages.setStopping(sid, false);
  if (phase === "saving" || phase === "starting" || phase === "restoring") {
    return;
  }
  messages.setAgentRunning(sid, false);
  messages.setCurrentTurnIndex(sid, null);
  messages.clearInFlightContent(sid);
}

/**
 * Everything that turns a user action into a Core command: the
 * main-view send path (Core starts the runner and replays its history
 * as needed), `/btw` side questions, the empty-screen first-message
 * path, Stop, and the Browser Control demo. Pulled out of App so the
 * entry component stops carrying ~300 lines of dense IPC choreography
 * inline.
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
    // Core refused the images (its view of the runtime was fresher than
    // the pre-checks'): the image toast, not a send failure.
    const refused = imageRefusalTag(e);
    if (refused) {
      showImageBlockedToast(
        refused === "images_not_supported"
          ? copy.toasts.imageBlockedExternal
          : refused === "images_not_queueable"
            ? copy.toasts.imageBlockedQueue
            : copy.toasts.imageBlockedGoal,
      );
      return;
    }
    useUiStore.getState().pushToast(
      makeAppError({
        category: "bridge",
        severity: "error",
        title: copy.errors.sendFailed,
        message:
          e instanceof SendUserMessageError && e.tag === "history_replay"
            ? copy.app.restoreTimeout
            : message,
        hint: null,
        retryable: true,
        context,
        traceback: null,
      }),
    );
  };

  /** Reply-done notification is scoped to runs the user started from
   * this GUI — marked once Core dispatched or queued the send. A `/btw`
   * reply isn't a main-agent run terminus. */
  const markIfRun = (sid: string, outcome: SendOutcome) => {
    if (outcome !== "side_question") markReplyNotifyPending(sid);
  };

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
      await sendThroughCore(sid, {
        text: copy.browserControl.demoPrompt,
        echo: "turn",
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
  // attachment so the Composer keeps the draft; otherwise void. Core
  // makes the same image checks; one it fails after the Composer let go
  // of the draft shows the image toast (`reportUserSendFailure`).
  const sendUserMessage = (t: string, images: PendingImageAttachment[]) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    // Main screen always has an active session — Sidebar
    // / EmptyState set it before transitioning here.
    const sid = useSessionsStore.getState().activeSessionId;
    if (!sid) return;
    const reportSendFailure = (e: unknown) =>
      reportUserSendFailure(sid, "send_user_message", e);
    // Snapshot pendingAskUser now — the echo clears it, and we need it
    // for the image gate and the run-open routing below. Core sees the
    // same question and dispatches the answer as `ask_user_response`.
    const pendingAskUser =
      useMessagesStore.getState().byId[sid]?.pendingAskUser ?? null;
    if (images.length > 0) {
      // Mirror of the Composer's `imagesEnabled` gate: managed always
      // delivers images; an attached runtime is trusted unless its
      // runner reported that the model backend cannot receive them.
      if (
        activeSession?.gaRuntimeKind !== "managed" &&
        activeSession?.imagesSupported === false
      ) {
        showImageBlockedToast(copy.toasts.imageBlockedExternal);
        return false;
      }
      if (isSideQuestion(t) || pendingAskUser !== null) {
        showImageBlockedToast(copy.toasts.imageBlockedGoal);
        return false;
      }
    }
    // `/btw` is a side question (interruption-free, not a main-agent
    // turn): a transient user turn that doesn't disturb the main
    // agent's running state; Core forwards it without persisting or
    // touching the run. The predicate is shared with the Composer's
    // stop gate: what passed the gate as a side question must route as
    // one here.
    if (isSideQuestion(t)) {
      void sendThroughCore(sid, { text: t, echo: "side_question" }).catch(
        reportSendFailure,
      );
      return;
    }
    // Message queue (galley#19/#20): while a run is open (running or
    // stop-in-flight) a main-agent send shows no echo. Core decides
    // atomically — it queues the text, or, if the run completed a
    // heartbeat ago, persists + dispatches it itself and the row comes
    // back via `user-message-persisted`. Queued items are text-only
    // (PRD 定案 6).
    const sessionMsgs = useMessagesStore.getState().byId[sid];
    const runOpen = Boolean(
      sessionMsgs?.agentRunning || sessionMsgs?.isStopping,
    );
    if (runOpen && pendingAskUser === null) {
      if (images.length > 0) {
        showImageBlockedToast(copy.toasts.imageBlockedQueue);
        return false;
      }
      void sendThroughCore(sid, { text: t, echo: "none" })
        .then((outcome) => markIfRun(sid, outcome))
        .catch((e) => reportUserSendFailure(sid, "queue_user_message", e));
      return;
    }
    void sendThroughCore(sid, { text: t, images, echo: "turn" })
      .then((outcome) => markIfRun(sid, outcome))
      .catch(reportSendFailure);
  };

  const stopRun = () => {
    console.info("[main] stop");
    const sid = useSessionsStore.getState().activeSessionId;
    if (!sid) return;
    // Optimistic: lock the button immediately; unlock
    // if the stop never reached Core, otherwise
    // the run keeps going with Stop dead.
    useMessagesStore.getState().setStopping(sid, true);
    stopSessionRun(sid)
      .then(({ dispatch }) => {
        if (dispatch === "already_stopped") settleStoppedRun(sid);
      })
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
   * a real chat; a persisted row is created first so Core's send finds
   * it. The screen transition and the echo land before Core starts the
   * runner, so a cold runner spawn doesn't look like a frozen UI.
   *
   * Images are accepted optimistically here: no bridge exists yet, so no
   * runtime has reported whether its model backend can receive them.
   * Core checks once its runner reported; the post-`ready` gate covers
   * every later send.
   */
  const submitFromEmpty = (t: string, images: PendingImageAttachment[]) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
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
        // The in-memory half of opening it; the send starts the runner,
        // on the EmptyState pick if there is one.
        await useSessionsStore
          .getState()
          .activateSession(id, { ensureRunner: false });
        useUiStore.getState().setScreen("main");
        const outcome = await sendThroughCore(id, {
          text: t,
          images,
          echo: isSideQuestion(t) ? "side_question" : "turn",
        });
        markIfRun(id, outcome);
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
    sendUserMessage,
    submitFromEmpty,
    stopRun,
    runBrowserControlDemo,
  };
}
