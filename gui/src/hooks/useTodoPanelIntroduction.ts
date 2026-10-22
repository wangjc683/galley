import { useEffect } from "react";

import { inReportRound } from "@/lib/subtasks";
import {
  introduceTodoPanel,
  mainChatOnScreen,
  todoPanelIntroduces,
} from "@/lib/todo-open";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

/**
 * The one time the to-do panel opens by itself (main chat ticket 87, PRD
 * ruling 131 point 4): each fresh read of the noted to-dos is put to
 * `todoPanelIntroduces` — the panel never met, a card just appeared
 * under the reply to a round you sent, Galley's conversation on screen
 * and wide enough — and when it says so, Galley's panel opens at those
 * rows (`introduceTodoPanel`). Mounted once, in App, while there is a
 * main chat. A store callback, not render or an effect body.
 */
export function useTodoPanelIntroduction(mainChatId: string | undefined): void {
  useEffect(() => {
    if (!mainChatId) return;
    return useAssistantTodoStore.subscribe((state, previous) => {
      if (state.noted === previous.noted) return;
      const ui = useUiStore.getState();
      if (ui.todoPanelIntroduced) return;
      const sessions = useSessionsStore.getState();
      const active = sessions.sessions.find(
        (session) => session.id === sessions.activeSessionId,
      );
      const turns = useMessagesStore.getState().byId[mainChatId]?.turns ?? [];
      const ids = todoPanelIntroduces({
        introduced: ui.todoPanelIntroduced,
        previous: previous.loaded ? previous.noted : null,
        next: state.noted,
        mainChatId,
        // The typing dots' rule (lib/assistant-conversation.ts): a round
        // opened by a report row is one Core woke Galley for.
        yourRound: !inReportRound(turns),
        mainChatOnScreen:
          active?.id === mainChatId && mainChatOnScreen(ui.screen, active),
        narrow: ui.todoNarrow,
      });
      if (ids.length > 0) introduceTodoPanel(ids);
    });
  }, [mainChatId]);
}
