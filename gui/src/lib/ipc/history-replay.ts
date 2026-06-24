import { logPerf, perfNow } from "@/lib/perf";
import {
  getCachedMessageRowsForSession,
  rememberMessageRowsForSession,
  useMessagesStore,
} from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import type { MessageRow } from "@/types/db";
import type { ConversationMessage } from "@/types/ipc";

type HistoryReplayState = {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
  timeout: number;
};

type HistoryReplaySendResult = "sent" | "skipped" | "failed";

const HISTORY_REPLAY_TIMEOUT_MS = 8_000;
const _historyReplayPending = new Map<string, HistoryReplayState>();
const _historyReplayReady = new Set<string>();

/**
 * Replay this session's persisted message history into the bridge's
 * GA backend via `load_history` IPC. Called from the `ready` event
 * handler when `session.turnCount > 0` indicates prior conversation.
 *
 * GA's `_load_history` (bridge/workbench_bridge.py L739) wraps the
 * `{role, content: string}` shape into NativeClaudeSession's native
 * blocks format. The assistant `content` column we wrote on turn_end
 * is GA's raw `responseContent` (with <thinking>/<tool_use> tags
 * intact) — exactly what GA's backend expects to see for full context
 * fidelity. User content is the verbatim text we wrote on
 * `appendUserTurn`.
 *
 * Best-effort: errors swallowed. A failed restore leaves the bridge
 * with empty history; the user can still continue the conversation,
 * just without GA remembering earlier turns. We log at debug so dev
 * builds see the failure without polluting the console for users.
 */
export async function ensureHistoryReplayComplete(
  sessionId: string,
): Promise<boolean> {
  const session = useSessionsStore
    .getState()
    .sessions.find((x) => x.id === sessionId);
  if (!session || (session.turnCount ?? 0) <= 0) return true;
  if (_historyReplayReady.has(sessionId)) return true;

  const existing = _historyReplayPending.get(sessionId);
  if (existing) {
    setSendPhaseIfRunning(sessionId, "restoring");
    return await existing.promise;
  }

  let resolveReplay!: (ok: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolveReplay = resolve;
  });
  const timeout = window.setTimeout(() => {
    console.warn("[ipc] load_history timed out; continuing.", {
      sessionId,
    });
    finishHistoryReplay(sessionId, false);
  }, HISTORY_REPLAY_TIMEOUT_MS);
  _historyReplayPending.set(sessionId, {
    promise,
    resolve: resolveReplay,
    timeout,
  });
  setSendPhaseIfRunning(sessionId, "restoring");

  void replayHistoryToBridge(sessionId)
    .then((result) => {
      if (result === "skipped") finishHistoryReplay(sessionId, true);
      if (result === "failed") finishHistoryReplay(sessionId, false);
    })
    .catch((e) => {
      console.debug("[ipc] replayHistoryToBridge failed.", e);
      finishHistoryReplay(sessionId, false);
    });

  return await promise;
}

function setSendPhaseIfRunning(
  sessionId: string,
  phase: "restoring",
): void {
  const messages = useMessagesStore.getState();
  if (messages.byId[sessionId]?.agentRunning) {
    messages.setSendPhase(sessionId, phase);
  }
}

export function markHistoryReplayStale(sessionId: string): void {
  // A ready event means this bridge needs a fresh load_history before
  // the next user_message, but it must not release an in-flight replay
  // waiter. The user can submit while the bridge is still spawning;
  // that submit path may already be waiting for this same replay.
  _historyReplayReady.delete(sessionId);
}

export function finishHistoryReplay(sessionId: string, ok: boolean): void {
  const pending = _historyReplayPending.get(sessionId);
  if (!pending) {
    if (ok) _historyReplayReady.add(sessionId);
    return;
  }
  window.clearTimeout(pending.timeout);
  _historyReplayPending.delete(sessionId);
  if (ok) {
    _historyReplayReady.add(sessionId);
  } else {
    _historyReplayReady.delete(sessionId);
  }
  pending.resolve(ok);
}

async function replayHistoryToBridge(
  sessionId: string,
): Promise<HistoryReplaySendResult> {
  const startedAt = perfNow();
  try {
    const completedTurnCount =
      useSessionsStore.getState().sessions.find((x) => x.id === sessionId)
        ?.turnCount ?? 0;
    const cachedRows = getCachedMessageRowsForSession(
      sessionId,
      completedTurnCount,
    );
    const cacheHit = cachedRows !== null;
    let rows = cachedRows;
    if (!rows) {
      const { loadMessagesBySession } = await import("@/lib/db");
      rows = await loadMessagesBySession(sessionId);
      rememberMessageRowsForSession(sessionId, rows, completedTurnCount);
    }
    if (rows.length === 0) {
      logPerf("ipc.replayHistoryToBridge", startedAt, {
        sessionId,
        cacheHit,
        rowCount: 0,
        messageCount: 0,
        result: "skipped",
      });
      return "skipped";
    }
    const messages = rowsToConversationMessages(rows, completedTurnCount);
    if (messages.length === 0) {
      logPerf("ipc.replayHistoryToBridge", startedAt, {
        sessionId,
        cacheHit,
        rowCount: rows.length,
        messageCount: 0,
        result: "skipped",
      });
      return "skipped";
    }
    await useRuntimeStore.getState().sendIPCCommand(sessionId, {
      kind: "load_history",
      messages,
    });
    console.info("[ipc] load_history sent", {
      sessionId,
      messageCount: messages.length,
    });
    logPerf("ipc.replayHistoryToBridge", startedAt, {
      sessionId,
      cacheHit,
      rowCount: rows.length,
      messageCount: messages.length,
      result: "sent",
    });
    return "sent";
  } catch (e) {
    console.debug("[ipc] replayHistoryToBridge failed.", e);
    logPerf("ipc.replayHistoryToBridge", startedAt, {
      sessionId,
      result: "failed",
    });
    return "failed";
  }
}

function rowsToConversationMessages(
  rows: MessageRow[],
  completedTurnCount: number,
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const r of rows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    // `messages` may contain a just-submitted user row before the
    // bridge has produced its assistant row. That row is live input,
    // not history. Replaying it would leave GA's backend history
    // ending with user, then the same user_message arrives again.
    if (r.turn_index > completedTurnCount) continue;
    const next: ConversationMessage = {
      role: r.role as "user" | "assistant",
      content: r.content,
    };
    if (r.role === "user" && r.attachments.length > 0) {
      next.images = r.attachments
        .filter((attachment) => attachment.kind === "image")
        .map((attachment) => attachment.path);
    }
    const prev = messages[messages.length - 1];
    if (prev?.role === next.role) {
      prev.content = `${prev.content}\n\n${next.content}`;
      if (next.images && next.images.length > 0) {
        prev.images = [...(prev.images ?? []), ...next.images];
      }
    } else {
      messages.push(next);
    }
  }
  if (messages[messages.length - 1]?.role === "user") {
    messages.pop();
  }
  return messages;
}
