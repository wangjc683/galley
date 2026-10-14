import {
  demoAssistantState,
  type SidebarTopDemo,
} from "@/components/layout/sidebar/sidebar-top-trial";
import { useSessionStatusView } from "@/hooks/useSessionStatusView";
import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import { assistantState, type AssistantState } from "@/lib/assistant";
import { useCopy, useLanguage } from "@/lib/i18n";
import type { Session } from "@/types/session";

/**
 * The assistant's state for its sidebar entry and its header identity
 * (main chat ticket 17, lib/assistant.ts): the main chat's live status,
 * its unpromoted subtasks' questions and errors, its unread mark.
 * `subtasks` are the main chat's unpromoted subtasks — an open one
 * counts too, as it does on the main chat row. `open` is the main chat
 * or one of them being on screen. `demo` is the sidebar-top trial's
 * 「演示」 (TEMPORARY): it replaces what is shown, never what is stored.
 */
export function useAssistantState({
  mainChat,
  subtasks,
  open,
  demo = "无",
}: {
  mainChat: Session;
  subtasks: Session[];
  open: boolean;
  demo?: SidebarTopDemo;
}): AssistantState {
  const copy = useCopy();
  const language = useLanguage();
  const view = useSessionStatusView(mainChat);
  const subtaskAttention = useSessionsAttention(subtasks, undefined);
  const demoState = demoAssistantState(demo, open, copy, language);
  if (demoState) return demoState;
  return assistantState(
    {
      status: view.status,
      hasPendingAskUser: view.hasPendingAskUser,
      subtaskState:
        subtaskAttention.kind === "error" || subtaskAttention.kind === "ask"
          ? subtaskAttention.kind
          : undefined,
      hasUnread: mainChat.hasUnread,
      open,
      lastStepIndex: mainChat.lastStepIndex,
      summary: mainChat.summary,
      errorCount: mainChat.errorCount,
    },
    copy,
  );
}
