import { invoke } from "@tauri-apps/api/core";

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
import { fromIPCError, makeAppError } from "@/types/app-error";
import type {
  AgentTurn,
  ConversationToolEvent,
  PendingApproval,
} from "@/types/conversation";
import type {
  IPCEvent,
  MessageVisibility,
  ToolCall as IPCToolCall,
  ToolResult as IPCToolResult,
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
 * Routes an IPC event from the bridge into store actions.
 *
 * #10b coverage:
 *
 *   ready             → connected status + replace LLMs
 *   llm_changed       → flip currentness in llms[]
 *   error             → push toast (fromIPCError)
 *   turn_end          → append agent turn (thinking + tools + final
 *                       answer), persisted to messages table
 *   tool_call_pending → add to pendingApprovals
 *   tool_call_end     → no-op for V0.1 (the conversation rebuilds the
 *                       tool's final state from turn_end's
 *                       toolResults; we don't need a separate row)
 *   tool_call_progress→ debug log (not in conversation rendering)
 *   ask_user          → V0.1: log; ask_user surfaces via the existing
 *                       conversation flow when GA exits the loop
 *   run_complete      → log; pending list is already cleared by the
 *                       desktop when the user records a decision
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
      // Per-session LLM list — N-active multi-session means each
      // bridge has its own currently-selected LLM. The active session's
      // pair projects up to top-level `llms` / `llmDisplayName` for
      // Composer / Command Palette / Inspector reads.
      const sessionForRuntime = useSessionsStore
        .getState()
        .sessions.find((item) => item.id === event.sessionId);
      const runtimeKind =
        sessionForRuntime?.gaRuntimeKind ??
        usePrefsStore.getState().activeRuntimeKind;
      const currentIndex = event.availableLLMs.find((l) => l.isCurrent)?.index;
      const managedLLMs =
        runtimeKind === "managed"
          ? managedModelsToLLMs(
              useManagedModelsStore.getState().models,
              currentIndex,
            )
          : [];
      useRuntimeStore.getState().replaceLLMs(
        event.sessionId,
        managedLLMs.length > 0
          ? managedLLMs
          : event.availableLLMs.map((l) => ({
              index: l.index,
              name: l.name,
              key: l.name,
              displayName: l.displayName,
              isCurrent: l.isCurrent,
            })),
      );
      useRuntimeStore.getState().setBridgeStatus(event.sessionId, "connected");
      // Sync the user's actual GA HEAD into runtimeInfo so the
      // Settings → Runtime panel shows "GA 版本: cf65515 · 2026-05-11"
      // alongside the workbench-tested baseline. gaCommit/Date are
      // the same across every bridge (they all run against the same
      // ga_path), so writing on every `ready` is safe — N-active
      // background bridges don't conflict.
      useRuntimeStore.getState().patchRuntimeInfo({
        gaCommit: event.gaCommit,
        gaCommitDate: event.gaCommitDate,
        bridgePid: event.pid,
      });
      // Sync session-scoped state to the freshly-spawned bridge.
      // YOLO mode (PRD §11.5): the bridge boots with yolo_mode=false;
      // if the user has it persisted as on, push the override now —
      // it's queued in the bridge's command pipeline and processed
      // before any subsequent user message can trigger a tool call.
      if (usePrefsStore.getState().yoloMode) {
        void useRuntimeStore.getState().sendIPCCommand(event.sessionId, {
          kind: "set_yolo_mode",
          enabled: true,
        });
      }
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
      return;
    }

    case "turn_end": {
      const visibility = eventVisibility(event);
      // GA's agent_runner_loop resets turn=1 on every put_task
      // (per-message), so event.turnIndex is the per-message
      // step (the value users want to see in "第 N 步"). For
      // SQLite, we add the runtime's offset to get an absolute
      // session-wide turn index — the primary key
      // `msg_${sessionId}_${turnIndex}_assistant` would collide
      // across user messages otherwise. See messages.ts
      // appendUserTurn for the `turnIndexOffset` rationale.
      const offset = messages.byId[event.sessionId]?.turnIndexOffset ?? 0;
      const absoluteTurnIndex =
        event.absoluteTurnIndex ?? event.turnIndex + offset;
      console.info("[ipc] turn_end", {
        gaTurnIndex: event.turnIndex,
        absoluteTurnIndex,
        offset,
        visibility,
        toolCallCount: event.toolCalls?.length ?? 0,
        hasFinalAnswer: !!event.responseContent,
      });
      // UI: AgentTurn.turnIndex = per-message step (raw GA value).
      // TurnMarker renders "第 N 步" against this — resetting to 1
      // on every new user message is GA's native semantic and what
      // the user expects.
      if (visibility === "visible") {
        const turn = turnFromTurnEnd(event);
        messages.appendAgentTurn(event.sessionId, turn);
      }
      // No setAgentRunning(false) here — turn_end is per-step inside
      // GA's agent_runner_loop, not the run terminus. agentRunning
      // stays true until `run_complete` / `error` / bridge close so
      // the sidebar and main view correctly reflect a multi-step
      // run in progress. (Prior code cleared it on every turn_end,
      // which made the sidebar flip to "已完成" after step 1 of an
      // N-step run.)
      // Update the session row (turn_count + last_activity_at +
      // summary). Sidebar `第 N 步 · {summary}` previews also use
      // the per-message step (matches what the user sees in the
      // main view). turn_count itself keeps incrementing in
      // absolute terms — that's the offset's source of truth.
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
            event.turnIndex,
            event.exitReason != null,
          );
      }
      // SQLite: persist under the ABSOLUTE turn index. rowsToTurns
      // reconstructs the per-message step at restore by tracking
      // the latest user row's turn_index as a per-message base.
      void persistTurnEndToMessages({
        ...event,
        turnIndex: absoluteTurnIndex,
        visibility,
      });
      return;
    }

    case "tool_call_pending": {
      const offset = messages.byId[event.sessionId]?.turnIndexOffset ?? 0;
      const absoluteTurnIndex =
        event.absoluteTurnIndex ?? event.turnIndex + offset;
      const target = pickTarget(event.args);
      const pending: PendingApproval = {
        approvalId: event.approvalId,
        toolName: event.toolName,
        target,
        riskLevel: event.riskLevel,
        args: event.args,
      };
      messages.addPendingApproval(event.sessionId, pending);
      // Best-effort Core DB write for audit trail. tool_events
      // joins to messages by (session_id, turn_index) — must use
      // absolute turn index so the join works after restore.
      void persistToolEventPendingFromIPC({
        ...event,
        turnIndex: absoluteTurnIndex,
      });
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
      return;
    }

    case "turn_start": {
      // Reflects which GA-side iteration the agent is currently on.
      // The thinking placeholder reads this to render
      // "第 N 步 · 思考中…". N is the per-message step (GA-native,
      // resets to 1 on each new user message) — matches what
      // completed TurnMarkers show, what the Sidebar preview
      // shows. No offset applied; raw GA value is the display.
      console.debug("[ipc] turn_start", event);
      if (eventVisibility(event) === "internal") {
        return;
      }
      messages.setCurrentTurnIndex(event.sessionId, event.turnIndex);
      // New turn starts → drop whatever streaming buffer the previous
      // turn left, so the in-flight render doesn't bleed across turns.
      messages.clearInFlightContent(event.sessionId);
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
      messages.setPendingAskUser(event.sessionId, {
        question: stripGATags(event.question),
        candidates: event.candidates.map(stripGATags),
      });
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
        void useRuntimeStore.getState().sendIPCCommand(pendingTarget, {
          kind: "attach_pet",
          port: 41983,
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

    default: {
      const exhaustive: never = event;
      console.warn("[ipc] unknown event kind", exhaustive);
    }
  }
}

// ---------------- Turn-end → AgentTurn ----------------

function turnFromTurnEnd(event: {
  turnIndex: number;
  summary: string;
  toolCalls: IPCToolCall[];
  toolResults: IPCToolResult[];
  responseContent: string;
}): AgentTurn {
  const tools = event.toolCalls.map((tc, i) =>
    toolEventFromIPC(tc, event.toolResults[i], i),
  );
  // GA's summary occasionally arrives as the literal placeholder
  // text when the LLM didn't produce a meaningful one. Trim + treat
  // empty as undefined so the UI doesn't render a hollow line.
  const trimmedSummary = event.summary?.trim();
  // Intermediate turns (tool-only, no user-facing answer) produce a
  // responseContent that's entirely <thinking>...</thinking> +
  // <tool_use>...</tool_use> tags; after cleanFinalAnswer strips
  // everything what's left is "". Normalize to null so Conversation's
  // `showFinalAnswer = finalAnswer !== null` check correctly hides
  // the MessageAgent + its Copy/Save actions for these turns.
  const cleanedAnswer = cleanFinalAnswer(event.responseContent);
  // Detect "final-answer turn" (GA's synthetic `no_tool` placeholder
  // or zero real tools). For those, the surviving narrator IS the
  // final answer and renders through MessageAgent — capturing it
  // also as preamble would double-render the same prose under
  // TurnMarker. Intermediate turns keep the preamble extraction.
  const isFinalTurn =
    tools.length === 0 || tools.every((t) => t.name === "no_tool");
  return {
    role: "agent",
    thinking: extractThinking(event.responseContent),
    preamble: isFinalTurn ? undefined : extractPreamble(event.responseContent),
    tools,
    finalAnswer: cleanedAnswer.trim() ? cleanedAnswer : null,
    turnIndex: event.turnIndex,
    summary: trimmedSummary ? trimmedSummary : undefined,
  };
}

function toolEventFromIPC(
  tc: IPCToolCall,
  result: IPCToolResult | undefined,
  index: number,
): ConversationToolEvent {
  const id =
    (typeof result?.toolUseId === "string" && result.toolUseId) ||
    (typeof tc.toolUseId === "string" && tc.toolUseId) ||
    `t-${index}`;

  let resultPreview: string | undefined;
  const content = result?.content;
  if (typeof content === "string") {
    resultPreview = content.slice(0, 500);
  } else if (content !== undefined) {
    try {
      resultPreview = JSON.stringify(content).slice(0, 500);
    } catch {
      resultPreview = String(content).slice(0, 500);
    }
  }

  return {
    id,
    name: tc.toolName,
    // turn_end is the post-completion state — by definition every
    // tool here finished. The conversation view fades older success
    // tools via "success-historical".
    status: "success-historical",
    args: tc.args,
    resultPreview,
  };
}

function pickTarget(args: Record<string, unknown>): string | undefined {
  if (typeof args.path === "string") return args.path;
  if (typeof args.command === "string") return args.command.slice(0, 60);
  if (typeof args.code === "string") return args.code.slice(0, 60);
  return undefined;
}

// ---------------- Core DB persistence (best-effort) ----------------

/**
 * Best-effort Core DB write for the approval audit trail. Imported
 * lazily so a non-Tauri runtime (Vite-only dev) doesn't fail hard at
 * IPC dispatch time; if persistence isn't available we just log and
 * move on. See db.ts `persistToolEventPending` for the v0.1 scoping
 * rationale (audit only, no completion rows).
 */
async function persistToolEventPendingFromIPC(event: {
  sessionId: string;
  approvalId: string;
  turnIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  argsPreview: string;
  riskLevel: string;
  timestamp: string;
}): Promise<void> {
  try {
    const { persistToolEventPending } = await import("@/lib/db");
    // Bridge sends riskLevel as a free string per the wire format; map
    // unexpected values to 'medium' to keep the column constraint happy.
    const risk: "low" | "medium" | "high" =
      event.riskLevel === "low" || event.riskLevel === "high"
        ? event.riskLevel
        : "medium";
    await persistToolEventPending({
      approvalId: event.approvalId,
      sessionId: event.sessionId,
      turnIndex: event.turnIndex,
      toolName: event.toolName,
      args: event.args,
      argsPreview: event.argsPreview,
      riskLevel: risk,
      startedAt: event.timestamp,
    });
  } catch (e) {
    console.debug("[ipc] persistToolEventPending: Core DB unavailable.", e);
  }
}

async function persistTurnEndToMessages(event: {
  sessionId: string;
  turnIndex: number;
  toolCalls: IPCToolCall[];
  toolResults: IPCToolResult[];
  responseContent: string;
  summary: string;
  visibility?: MessageVisibility;
}): Promise<void> {
  try {
    const trimmedSummary = event.summary?.trim() ?? "";
    const finalAnswer = cleanFinalAnswer(event.responseContent);
    // Mirrors turnFromTurnEnd's gate: only intermediate turns persist
    // a preamble. Final-answer turn's narrator IS the final answer
    // and lives in `final_answer`; storing it again as `preamble`
    // would double-render on restore.
    const isFinalTurn =
      event.toolCalls.length === 0 ||
      event.toolCalls.every((tc) => tc.toolName === "no_tool");
    const persistedPreamble = isFinalTurn
      ? null
      : (extractPreamble(event.responseContent) ?? null);
    await invoke("persist_assistant_message", {
      input: {
        sessionId: event.sessionId,
        turnIndex: event.turnIndex,
        content: event.responseContent,
        toolCalls: JSON.stringify(event.toolCalls),
        toolResults: JSON.stringify(event.toolResults),
        thinking: extractThinking(event.responseContent) ?? null,
        finalAnswer,
        // GA's third-person turn summary. NULL when empty so the
        // TurnMarker renders the bare "第 N 步" instead of an
        // empty separator.
        summary: trimmedSummary ? trimmedSummary : null,
        // LLM pre-tool reasoning prose for DetailPanel restore. See
        // isFinalTurn gate above — final answers don't persist here.
        preamble: persistedPreamble,
        visibility: event.visibility ?? "visible",
      },
    });
  } catch (e) {
    console.debug("[ipc] persistTurnEndToMessages: Core DB unavailable.", e);
  }
}
