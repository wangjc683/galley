import { sendThroughCore } from "@/hooks/useMessageSend";
import type { AppCopy } from "@/i18n/types";
import type { SendOutcome } from "@/lib/session-send";
import { useMessagesStore } from "@/stores/messages";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * Answer a subtask's question from its card in the main chat (main chat
 * ticket 06a): the same Core send the Composer's answer takes
 * (`send_user_message`, echo `turn`), to the subtask's session. Core
 * sees the pending question and dispatches it as the answer; an answer
 * never promotes the subtask. Resolves Core's outcome, or null when the
 * send failed (the run state is put back and a toast says so).
 */
export async function answerSubtask(
  sessionId: string,
  text: string,
  copy: AppCopy,
): Promise<SendOutcome | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return await sendThroughCore(sessionId, { text: trimmed, echo: "turn" });
  } catch (e) {
    const messages = useMessagesStore.getState();
    messages.setAgentRunning(sessionId, false);
    messages.setSendPhase(sessionId, null);
    useUiStore.getState().pushToast(
      makeAppError({
        category: "bridge",
        severity: "error",
        title: copy.errors.sendFailed,
        message: e instanceof Error ? e.message : String(e),
        hint: null,
        retryable: true,
        context: "subtask_answer",
        traceback: null,
      }),
    );
    return null;
  }
}
