import type { ReadySnapshot } from "@/lib/bridge";
import { copyForLanguage } from "@/lib/i18n";
import {
  cleanFinalAnswer,
  extractPreamble,
  extractThinking,
  stripGATags,
} from "@/lib/ipc/ga-output-cleaning";
import {
  ensureHistoryReplayComplete,
  finishHistoryReplay,
  markHistoryReplayStale,
} from "@/lib/ipc/history-replay";
import { resolveLanguagePreference } from "@/lib/language";
import { managedModelsToLLMs } from "@/lib/managed-model-options";
import {
  clearReplyNotifyPending,
  consumeReplyNotifyPending,
  sendGatedSystemNotification,
} from "@/lib/notify";
import {
  buildAgentTurn,
  isFinalAnswerTurn,
  toolEventsFromRaw,
} from "@/lib/agent-turn";
import { isStepLimitExit } from "@/lib/step-limit";
import { resolveAbsoluteTurnIndex } from "@/lib/turn-index";
import { fromIPCError, makeAppError } from "@/types/app-error";
import type { AgentTurn } from "@/types/conversation";
import type { Session } from "@/types/session";
import type {
  IPCEvent,
  MessageVisibility,
  ToolCall as IPCToolCall,
  ToolResult as IPCToolResult,
  TurnTelemetry,
} from "@/types/ipc";

import { useMessagesStore } from "@/stores/messages";
import { useManagedModelsStore } from "@/stores/managed-models";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

export {
  cleanPartialContent,
  extractPreamble,
  stripGATags,
} from "@/lib/ipc/ga-output-cleaning";
export { ensureHistoryReplayComplete } from "@/lib/ipc/history-replay";

function eventVisibility(event: { visibility?: MessageVisibility }): MessageVisibility {
  return event.visibility ?? "visible";
}

function currentCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}

/**
 * The store half of a runner's `ready`: per-session model list, connected
 * status, image capability, reasoning effort, runtime info. Returns the
 * session row it read (the caller's replay check needs it).
 *
 * Shared by the real `ready` event and by the snapshot Core hands a page
 * that attaches after `ready` went by ([`applyReadySnapshot`]).
 */
function applyReadyState(
  sessionId: string,
  ready: ReadySnapshot,
): Session | undefined {
  // Per-session LLM list — N-active multi-session means each
  // bridge has its own currently-selected LLM. The active session's
  // pair projects up to top-level `llms` / `llmDisplayName` for
  // Composer / Command Palette / Inspector reads.
  const sessionForRuntime = useSessionsStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const runtimeKind =
    sessionForRuntime?.gaRuntimeKind ??
    usePrefsStore.getState().activeRuntimeKind;
  const currentIndex = ready.availableLLMs.find((l) => l.isCurrent)?.index;
  const managedLLMs =
    runtimeKind === "managed"
      ? managedModelsToLLMs(
          useManagedModelsStore.getState().models,
          currentIndex,
        )
      : [];
  useRuntimeStore.getState().replaceLLMs(
    sessionId,
    managedLLMs.length > 0
      ? managedLLMs
      : ready.availableLLMs.map((l) => ({
          index: l.index,
          name: l.name,
          key: l.name,
          displayName: l.displayName,
          isCurrent: l.isCurrent,
        })),
  );
  useRuntimeStore.getState().setBridgeStatus(sessionId, "connected");
  // Image-input capability of the freshly-spawned runtime. Older
  // runners omit the field; `?? true` keeps the composer open for
  // them rather than silently disabling image intake.
  useSessionsStore
    .getState()
    .setSessionImagesSupported(sessionId, ready.imagesSupported ?? true);
  // Reasoning effort as the fresh runtime sees it: the effective
  // tier on the backend plus the tier the model configuration
  // carries. Record only — the session override was already handed
  // to the runner as a spawn argument by Core, so there is nothing
  // to replay from here (PRD 裁决 3). Must run after replaceLLMs,
  // which is what creates the session's runtime slot.
  useRuntimeStore.getState().setReasoningEffortReport(sessionId, {
    reasoningEffort: ready.reasoningEffort ?? null,
    configuredReasoningEffort: ready.configuredReasoningEffort ?? null,
  });
  // Sync the user's actual GA HEAD into runtimeInfo so the
  // Settings → 运行环境 → 接入外部 GA version card shows
  // "当前版本 cf65515 · 2026-05-11" against the verified baseline.
  // Only external sessions report the user's checkout — every
  // external bridge runs the same ga_path, so N-active background
  // bridges don't conflict. A bundled-engine `ready` reports the
  // engine's own manifest commit; letting it write here made the
  // card describe the engine as "your GA" (and hid a real external
  // version after any bundled session started).
  if (runtimeKind === "external") {
    useRuntimeStore.getState().patchRuntimeInfo({
      gaCommit: ready.gaCommit,
      gaCommitDate: ready.gaCommitDate,
      gaCommitRuntimeKind: "external",
      bridgePid: ready.pid,
    });
  } else {
    useRuntimeStore.getState().patchRuntimeInfo({ bridgePid: ready.pid });
  }
  return sessionForRuntime;
}

/**
 * Apply a ready snapshot (`ReadySnapshot`, from Core's
 * `ensure_session_runner` / `list_live_runners`) to the stores, exactly as
 * a `ready` event would — and nothing else. In particular it NEVER replays
 * history: a snapshot describes a runner that was already running, whose
 * GA history may be mid-run, and `load_history` replaces that history
 * wholesale (the runner refuses it mid-run). Replay stays tied to a real
 * `ready` event, which only a freshly started runner emits.
 */
export function applyReadySnapshot(
  sessionId: string,
  snapshot: ReadySnapshot,
): void {
  console.info("[ipc] ready snapshot", {
    sessionId,
    llm: snapshot.llmName,
    availableLLMs: snapshot.availableLLMs.length,
  });
  applyReadyState(sessionId, snapshot);
}

/**
 * Routes an IPC event from the bridge into store actions.
 *
 * #10b coverage:
 *
 *   ready             → connected status + replace LLMs
 *   llm_changed       → flip currentness in llms[]
 *   error             → push toast (fromIPCError)
 *   turn_end          → append agent turn (thinking + tools + final
 *                       answer). Core writes the messages row and the
 *                       session bump itself (core/src/turn_persistence)
 *                       — this page only renders, flags unread, notifies
 *   tool_call_end     → no-op for V0.1 (the conversation rebuilds the
 *                       tool's final state from turn_end's
 *                       toolResults; we don't need a separate row)
 *   tool_call_progress→ debug log (not in conversation rendering)
 *   ask_user          → V0.1: log; ask_user surfaces via the existing
 *                       conversation flow when GA exits the loop
 *   run_complete      → clear the running state for the session
 *   history_loaded    → log
 *
 * Tool ids: turn_end's toolCalls / toolResults are positional, so we
 * walk them in order with synthetic ids when none is supplied.
 */
export function dispatchIPCEvent(event: IPCEvent): void {
  // Each slice store is accessed directly via its getState() so the
  // receiving slice is obvious at the call site.
  const messages = useMessagesStore.getState();

  switch (event.kind) {
    case "ready": {
      console.info("[ipc] ready", {
        sessionId: event.sessionId,
        ga: event.gaCommit,
        llm: event.llmName,
        availableLLMs: event.availableLLMs.length,
      });
      const sessionForRuntime = applyReadyState(event.sessionId, event);
      // Session Restore (Stage 3 Task 3). If this session has prior
      // turn history on disk, replay it into GA `backend.history` via
      // load_history. The MainView submit path waits on the same gate
      // before it writes a fresh `user_message`, so a quick submit
      // after opening history cannot race ahead of load_history.
      //
      // The session-list check uses `turnCount > 0` rather than the
      // SQLite query result so we skip the round-trip for newly
      // created sessions (the common case). For the cold-start case
      // turnCount comes from `loadSessions` during hydrate.
      if (sessionForRuntime && (sessionForRuntime.turnCount ?? 0) > 0) {
        markHistoryReplayStale(event.sessionId);
        void ensureHistoryReplayComplete(event.sessionId);
      }
      return;
    }

    case "llm_changed": {
      console.info("[ipc] llm_changed", {
        index: event.index,
        displayName: event.displayName,
        sessionId: event.sessionId,
      });
      // Re-read this session's current LLM list from runtimeStore rather
      // than the top-level projection — the `llm_changed` event might
      // be for a non-active session (background bridge that the user
      // had set_llm'd before switching sessions), in which case
      // the active-session projection would otherwise be the wrong list.
      const rtStore = useRuntimeStore.getState();
      const rtLLMs = rtStore.byId[event.sessionId]?.llms ?? rtStore.cachedLLMs;
      rtStore.replaceLLMs(
        event.sessionId,
        rtLLMs.map((l) => ({
          ...l,
          isCurrent: l.index === event.index,
        })),
      );
      // Switching model can change what the backend accepts, so the
      // runner re-reports image capability alongside the new LLM.
      useSessionsStore
        .getState()
        .setSessionImagesSupported(
          event.sessionId,
          event.imagesSupported ?? true,
        );
      // The new model carries its own configured tier, and the runner
      // replayed the session override onto the new backend — both
      // halves of the composer row's state can change here.
      rtStore.setReasoningEffortReport(event.sessionId, {
        reasoningEffort: event.reasoningEffort ?? null,
        configuredReasoningEffort: event.configuredReasoningEffort ?? null,
      });
      return;
    }

    case "reasoning_effort_changed": {
      console.info("[ipc] reasoning_effort_changed", {
        sessionId: event.sessionId,
        reasoningEffort: event.reasoningEffort ?? null,
        configuredReasoningEffort: event.configuredReasoningEffort ?? null,
      });
      // Confirmation of a `set_reasoning_effort` Core forwarded. The
      // composer row already moved (the session override is patched
      // optimistically); this refreshes the runner's own view, which is
      // what tells deviation from following after a model switch.
      useRuntimeStore.getState().setReasoningEffortReport(event.sessionId, {
        reasoningEffort: event.reasoningEffort ?? null,
        configuredReasoningEffort: event.configuredReasoningEffort ?? null,
      });
      return;
    }

    case "error": {
      console.warn("[ipc] error", event);
      if (event.context === "load_history") {
        finishHistoryReplay(event.sessionId, false);
      }
      useUiStore.getState().pushToast(fromIPCError(event));
      // Bridge errors usually mean turn_end won't arrive — clear the
      // running flag so the thinking placeholder + Stop-mode Composer
      // don't get stuck on. Categories like `quota_exceeded` /
      // `network` show the error toast instead.
      messages.setAgentRunning(event.sessionId, false);
      messages.setCurrentTurnIndex(event.sessionId, null);
      messages.clearInFlightContent(event.sessionId);
      // A dead run must not leave a reply-notify flag behind — it
      // would mis-fire on the session's next non-GUI-driven run.
      clearReplyNotifyPending(event.sessionId);
      return;
    }

    case "turn_end": {
      const visibility = eventVisibility(event);
      // The row Core writes keys on the absolute, session-wide turn
      // index (the per-message `msg_${sessionId}_${turnIndex}_assistant`
      // primary key would collide across user messages otherwise). Core
      // normally supplies it on the event; the offset is the fallback.
      // See lib/turn-index.ts for the invariant.
      const offset = messages.byId[event.sessionId]?.turnIndexOffset ?? 0;
      const absoluteTurnIndex = resolveAbsoluteTurnIndex(event, offset);
      console.info("[ipc] turn_end", {
        gaTurnIndex: event.turnIndex,
        absoluteTurnIndex,
        offset,
        visibility,
        toolCallCount: event.toolCalls?.length ?? 0,
        hasFinalAnswer: !!event.responseContent,
      });
      // UI: AgentTurn.turnIndex = per-message step (raw GA value),
      // kept raw so live and restored turns agree (rowsToTurns
      // recovers the same number). What the user SEES is numbered by
      // position within the run (goal-run-groups `stepNumberOf`), so
      // an ask_user reply — a fresh GA loop, step 1 again — does not
      // restart the count. Internal turns (goal master-plan traffic)
      // are not rendered; Core persists them all the same.
      const turn = turnFromTurnEnd(event);
      // Same primary key Core mints for the row below — lets a palette
      // hit on this reply locate the live node without a restore.
      turn.messageId = `msg_${event.sessionId}_${absoluteTurnIndex}_assistant`;
      if (visibility === "visible") {
        messages.appendAgentTurn(event.sessionId, turn);
      }
      // GA stopped this run at its per-run step cap (#29): a pause,
      // not a finished reply — the last step is usually a half-done
      // tool step. Drives the ghost text, the thread tail and the
      // notification title below.
      const hitStepLimit = isStepLimitExit(event.exitReason);
      // Composer ghost text: the final reply's next-step suggestion.
      // Written unconditionally on the final visible turn_end (null
      // when the model emitted no tag) so a newer reply always
      // replaces — or clears — the previous suggestion. A step-limit
      // stop offers the localized "继续" instead: the model's tag (if
      // any) was written mid-work, and continuing is the one move.
      // The tail flag is rewritten on the same beat, so a newer
      // final turn that ended normally drops a stale tail.
      if (event.exitReason != null && visibility === "visible") {
        messages.setNextSuggestion(
          event.sessionId,
          hitStepLimit
            ? currentCopy().composer.stepLimitContinue
            : event.nextSuggestion?.trim() || null,
        );
        messages.setPausedAtStepLimit(event.sessionId, hitStepLimit);
      }
      // No setAgentRunning(false) here — turn_end is per-step inside
      // GA's agent_runner_loop, not the run terminus. agentRunning
      // stays true until `run_complete` / `error` / bridge close so
      // the sidebar and main view correctly reflect a multi-step
      // run in progress. (Prior code cleared it on every turn_end,
      // which made the sidebar flip to "已完成" after step 1 of an
      // N-step run.)
      // Mirror Core's session bump in memory (turn_count +
      // last_activity_at + summary — Core already wrote them to SQLite,
      // core/src/turn_persistence). Sidebar `第 N 步 · {summary}`
      // previews show the display step — GA's per-loop step plus the
      // run's step base (messages `runStepBase`), so it matches the
      // main view's position numbering across an ask_user reply.
      // turn_count itself keeps incrementing in absolute terms — that's
      // the offset's source of truth.
      //
      // Unread is a completed-reply signal, not an intermediate-step
      // signal. GA emits turn_end for every loop step; only the final
      // one carries exitReason and is followed by run_complete.
      if (visibility === "visible") {
        useSessionsStore
          .getState()
          .bumpSessionAfterTurn(
            event.sessionId,
            event.summary,
            (messages.byId[event.sessionId]?.runStepBase ?? 0) +
              event.turnIndex,
            event.exitReason != null,
          );
      }
      // Reply-done system notification: only for the final turn of a
      // run the user started from this GUI (`consume` returns false
      // for Goal-nudge / CLI-driven runs — they never marked). Fires
      // alongside the unread badge; notify.ts gates pref / focus /
      // permission so a focused window stays silent.
      //
      // A run that ends by calling ask_user is NOT a finished reply —
      // "回复完成" would tell an away user the task is done when the
      // agent is actually blocked on them. Skip here and leave the
      // notify-pending flag for the AskUserEvent the bridge emits
      // right after this turn_end; that handler sends the question
      // itself in the waiting-for-you register instead.
      const endsInAskUser = event.toolCalls.some(
        (tc) => tc.toolName === "ask_user",
      );
      if (
        event.exitReason != null &&
        visibility === "visible" &&
        !endsInAskUser &&
        consumeReplyNotifyPending(event.sessionId)
      ) {
        const sessionTitle = useSessionsStore
          .getState()
          .sessions.find((s) => s.id === event.sessionId)?.title;
        // A step-limit stop keeps the replyDone pref gate and throttle
        // key but must not say "回复完成"; its body is the session
        // alone — the last step's summary describes half-done work.
        void sendGatedSystemNotification("replyDone", {
          title: hitStepLimit
            ? currentCopy().sidebar.stepLimitReached
            : currentCopy().sidebar.replyDone,
          body: sessionTitle
            ? event.summary && !hitStepLimit
              ? `${sessionTitle} · ${event.summary}`
              : sessionTitle
            : (event.summary ?? ""),
          throttleKey: `reply:${event.sessionId}`,
        });
      }
      // No SQLite write here (2026-10-07): Core's runner watcher
      // persisted this turn before the event reached the page, so a
      // reloaded or absent page loses nothing. The row it wrote equals
      // `turn` field for field — the shared golden fixtures pin Core's
      // derivation to `turnFromTurnEnd` (turn-persistence.golden.test.ts).
      return;
    }

    case "tool_call_end": {
      // turn_end carries the same toolResults; we don't need an
      // independent state shape for finished tools.
      console.debug("[ipc] tool_call_end", event);
      return;
    }

    case "run_complete": {
      console.debug("[ipc] run_complete", event);
      if (eventVisibility(event) === "internal") {
        return;
      }
      // Last-resort clear: turn_end already cleared agentRunning for
      // the normal happy path; this catches ABORTED / DENIED exits
      // where turn_end_callback didn't fire on the GA side.
      messages.setAgentRunning(event.sessionId, false);
      messages.setCurrentTurnIndex(event.sessionId, null);
      messages.clearInFlightContent(event.sessionId);
      // Run terminus: the happy path already consumed the flag at the
      // final turn_end; ABORTED / DENIED exits should not notify.
      clearReplyNotifyPending(event.sessionId);
      return;
    }

    case "turn_start": {
      // Reflects which GA-side iteration the agent is currently on.
      // The thinking placeholder reads this to render
      // "第 N 步 · 思考中…". N is the display step: GA's per-loop
      // step (restarts at 1 on every put_task) plus the run's step
      // base, so a loop started by an ask_user reply continues the
      // run's numbering — matching the settled TurnMarkers and the
      // Sidebar preview. No absolute offset applied.
      console.debug("[ipc] turn_start", event);
      if (eventVisibility(event) === "internal") {
        return;
      }
      // A starting run invalidates any pending ask_user question —
      // the bridge would reject the answer now (business guard), so
      // the bubble must not keep offering it. The answer path already
      // cleared it via appendUserTurn; this covers preemption paths
      // that dispatch without the composer (queue 插队, CLI send —
      // galley#19 dogfood 2026-08-12: the bubble survived a queue
      // jump because it relied solely on the user-row append event).
      if (useMessagesStore.getState().byId[event.sessionId]?.pendingAskUser) {
        messages.setPendingAskUser(event.sessionId, null);
      }
      // Same for the step-limit tail (#29): whatever started this run —
      // composer, queue, CLI — the paused run is moving again.
      messages.setPausedAtStepLimit(event.sessionId, false);
      messages.setCurrentTurnIndex(
        event.sessionId,
        (messages.byId[event.sessionId]?.runStepBase ?? 0) + event.turnIndex,
      );
      // Do not clear inFlightContent here. `turn_start` is a structural
      // clock signal, and on older/racing runners it can arrive after a
      // few `turn_progress` chunks from the same turn. Clearing here
      // makes those early words flash as answer prose and then vanish
      // into the step marker. User submit / turn_end / run_complete /
      // error / bridge-close remain the lifecycle boundaries that reset
      // the streaming buffer.
      return;
    }

    case "turn_progress": {
      // Streaming partial. Append delta; MainView re-renders the
      // in-flight reply with cleanPartialContent stripping GA's
      // internal tags.
      if (eventVisibility(event) === "internal") {
        return;
      }
      messages.appendInFlightDelta(event.sessionId, event.delta);
      return;
    }

    case "ask_user": {
      // GA called the `ask_user` tool — bridge has already EXITED the
      // agent loop and is waiting for an `ask_user_response` (or
      // equivalent `user_message`). Surface the question via the
      // inline AskUserBubble + Sidebar yellow "⏸ 等你回复" dot.
      // Conversation history will also show this turn's regular
      // assistant content + tool callouts; the ask_user tool callout
      // itself is suppressed at render time (see Conversation.tsx).
      console.info("[ipc] ask_user", {
        sessionId: event.sessionId,
        candidateCount: event.candidates.length,
      });
      // The LLM occasionally wraps its internal turn recap in
      // `<summary>...</summary>` inside the tool args. That recap is
      // already surfaced via TurnMarker's step subline; stripping it
      // here keeps the AskUserBubble to the real question and avoids
      // showing literal `<summary>` tags to the user.
      const question = stripGATags(event.question);
      messages.setPendingAskUser(event.sessionId, {
        question,
        candidates: event.candidates.map(stripGATags),
      });
      // The agent is blocked on an answer — a "needs you" moment.
      // The turn_end just before this skipped
      // its replyDone for exactly this event; consume the flag here
      // (same GUI-started-run gating) and send the question itself.
      // `reply:` throttleKey shared with replyDone: they're the same
      // run-terminus channel, never both firing for one run.
      if (consumeReplyNotifyPending(event.sessionId)) {
        const sessionTitle = useSessionsStore
          .getState()
          .sessions.find((s) => s.id === event.sessionId)?.title;
        void sendGatedSystemNotification("askUser", {
          title: currentCopy().conversation.waitingForYou,
          body: sessionTitle ? `${sessionTitle} · ${question}` : question,
          throttleKey: `reply:${event.sessionId}`,
        });
      }
      return;
    }

    case "tools_reinjected": {
      const copy = currentCopy();
      console.info("[ipc] tools_reinjected", {
        sessionId: event.sessionId,
        blocksAdded: event.blocksAdded,
      });
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.toolsReinjected,
          message: copy.toasts.toolsReinjectedMessage(event.blocksAdded),
          hint: null,
          retryable: false,
          context: "reinject_tools",
          traceback: null,
        }),
      );
      return;
    }

    case "pet_attached": {
      const copy = currentCopy();
      console.info("[ipc] pet_attached", {
        sessionId: event.sessionId,
        port: event.port,
      });
      useRuntimeStore.getState().setPetAttachedSession(event.sessionId);
      // Clear any stale migration target so a future detach can't
      // re-trigger an attach on a session the user no longer wants.
      useUiStore.getState().setPendingPetMigration(null);
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.petStarted,
          message: copy.toasts.petStartedMessage,
          hint: null,
          retryable: false,
          context: "attach_pet",
          traceback: null,
        }),
      );
      return;
    }

    case "pet_detached": {
      const copy = currentCopy();
      console.info("[ipc] pet_detached", {
        sessionId: event.sessionId,
      });
      // Only clear top-level if it was attached to this session —
      // defensive against out-of-order events. In practice the bridge
      // only emits pet_detached for the session it was attached to.
      if (useRuntimeStore.getState().petAttachedSessionId === event.sessionId) {
        useRuntimeStore.getState().setPetAttachedSession(null);
      }
      // Implicit-migration relay: the user clicked "桌面宠物" in a
      // non-holder session; we detached the holder, and now (port
      // released, hook removed) we fire the follow-up attach. Skip
      // the "已关闭" toast in this case — the about-to-arrive
      // pet_attached toast tells the right story for migrations.
      const pendingTarget = useUiStore.getState().pendingPetMigrationTo;
      if (pendingTarget) {
        useUiStore.getState().setPendingPetMigration(null);
        useRuntimeStore
          .getState()
          .sendIPCCommand(pendingTarget, {
            kind: "attach_pet",
            port: 41983,
          })
          .catch((e) => {
            // Migration ended half-way: detach succeeded, attach never
            // reached the target bridge. The truthful end state is
            // "pet closed" — surface the toast this branch skipped.
            console.warn("[ipc] pet migration attach failed", e);
            useUiStore.getState().pushToast(
              makeAppError({
                category: "business",
                severity: "info",
                title: copy.toasts.petClosed,
                message: "",
                hint: null,
                retryable: false,
                context: "attach_pet",
                traceback: null,
              }),
            );
          });
        return;
      }
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.petClosed,
          message: "",
          hint: null,
          retryable: false,
          context: "detach_pet",
          traceback: null,
        }),
      );
      return;
    }


    case "system_message": {
      console.info("[ipc] system_message", {
        sessionId: event.sessionId,
        variant: event.variant,
        length: event.content.length,
      });
      messages.appendSystemTurn(event.sessionId, {
        role: "system",
        content: event.content,
        variant: event.variant,
      });
      return;
    }

    case "history_loaded": {
      finishHistoryReplay(event.sessionId, true);
      console.debug(`[ipc] ${event.kind}`, event);
      return;
    }

    case "tool_call_start":
    case "tool_call_progress": {
      console.debug(`[ipc] ${event.kind}`, event);
      return;
    }

    case "title_generated": {
      // Core's auto-title watcher owns this event: it CAS-writes the DB
      // and mirrors the accepted title through `session-updated-external`,
      // which the sessions store already applies. Nothing to do here.
      console.debug(`[ipc] ${event.kind}`, event);
      return;
    }

    default: {
      const exhaustive: never = event;
      console.warn("[ipc] unknown event kind", exhaustive);
    }
  }
}

// ---------------- Turn-end → AgentTurn ----------------
//
// Construction rules (tool events, final-answer gate, normalization)
// live in lib/agent-turn.ts — the single home shared with the restore
// path. This function only contributes what's live-exclusive: deriving
// thinking/preamble out of the raw responseContent (restore reads the
// persisted columns instead).
//
// Core derives the persisted row from the same event with a Rust port
// of these rules (core/src/turn_persistence/derive.rs). Exported so the
// shared golden fixtures can hold the two to the same output — change
// one side, regenerate the fixtures, and the other side's test fails
// until it matches.

export function turnFromTurnEnd(event: {
  turnIndex: number;
  summary: string;
  toolCalls: IPCToolCall[];
  toolResults: IPCToolResult[];
  responseContent: string;
  responseThinking?: string | null;
  telemetry?: TurnTelemetry | null;
}): AgentTurn {
  const tools = toolEventsFromRaw(event.toolCalls, event.toolResults, "t-");
  return buildAgentTurn({
    // GA's `response.thinking` first (2026-09-23): native reasoning
    // never appears in `responseContent`, and a prompted block GA
    // lifted out of it would be lost to the tag scan. The scan stays
    // as the fallback for runtimes that don't send the field yet.
    thinking:
      event.responseThinking?.trim() || extractThinking(event.responseContent),
    // Final-answer turn's narrator IS the final answer — keeping it as
    // preamble too would double-render the same prose under TurnMarker.
    preamble: isFinalAnswerTurn(tools)
      ? undefined
      : extractPreamble(event.responseContent),
    tools,
    finalAnswer: cleanFinalAnswer(event.responseContent),
    turnIndex: event.turnIndex,
    summary: event.summary,
    telemetry: event.telemetry,
  });
}
