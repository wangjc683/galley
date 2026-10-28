import { useEffect } from "react";

import { subscribeReminderReads } from "@/hooks/useReminderCards";
import {
  freshCardsGatherer,
  freshMemoCards,
  freshReminderCards,
  freshTodoCards,
  type FreshBatch,
  type FreshCard,
} from "@/lib/fresh-cards";
import { inReportRound } from "@/lib/subtasks";
import {
  introduceTodoPanel,
  mainChatOnScreen,
  todoPanelIntroduces,
} from "@/lib/todo-open";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useMemoStore } from "@/stores/memo";
import { useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

/**
 * The cards that have just appeared under the main chat's replies, and
 * what they do (main chat ticket 101, PRD ruling 147 point 4): each
 * fresh read of the noted to-dos, of Galley's own reminders and of the
 * memo writes says which cards are new (lib/fresh-cards.ts); what one
 * round made is gathered (`FRESH_CARDS_GATHER_MS`) and put to
 * `todoPanelIntroduces` — the panel never met, under a round you sent,
 * Galley's conversation on screen and wide enough, read as the wait
 * ends — and when it says so Galley's panel opens on that page at those
 * rows (`introduceTodoPanel`). Until ticket 101 only the to-dos were
 * read, here as useTodoPanelIntroduction (ticket 87). Mounted once, in
 * App, while there is a main chat. Store and read callbacks, not render
 * or an effect body.
 */
export function useFreshCards(mainChatId: string | undefined): void {
  useEffect(() => {
    if (!mainChatId) return;
    const gatherer = freshCardsGatherer((batch) =>
      afterFreshCards(batch, mainChatId),
    );
    const add = (cards: FreshCard[]) => {
      if (cards.length === 0) return;
      const turns = useMessagesStore.getState().byId[mainChatId]?.turns ?? [];
      // The typing dots' rule (lib/assistant-conversation.ts): a round
      // opened by a report row is one Core woke Galley for.
      gatherer.add(cards, !inReportRound(turns));
    };
    const unsubscribeTodos = useAssistantTodoStore.subscribe(
      (state, previous) => {
        if (state.noted === previous.noted) return;
        add(
          freshTodoCards(
            previous.loaded ? previous.noted : null,
            state.noted,
            mainChatId,
          ),
        );
      },
    );
    const unsubscribeMemos = useMemoStore.subscribe((state, previous) => {
      if (state.events === previous.events) return;
      add(
        freshMemoCards(
          previous.loaded ? previous.events : null,
          state.events,
          mainChatId,
        ),
      );
    });
    const unsubscribeReminders = subscribeReminderReads((previous, next) =>
      add(freshReminderCards(previous, next, mainChatId)),
    );
    return () => {
      unsubscribeTodos();
      unsubscribeMemos();
      unsubscribeReminders();
      gatherer.dispose();
    };
  }, [mainChatId]);
}

/** One round's new cards, gathered: the panel opens by itself, the once,
 * if it is due (ticket 101), on the conditions as they stand now. */
function afterFreshCards(batch: FreshBatch, mainChatId: string): void {
  const ui = useUiStore.getState();
  const sessions = useSessionsStore.getState();
  const active = sessions.sessions.find(
    (session) => session.id === sessions.activeSessionId,
  );
  const introducing = todoPanelIntroduces({
    introduced: ui.todoPanelIntroduced,
    fresh: batch.cards,
    yourRound: batch.yourRound,
    mainChatOnScreen:
      active?.id === mainChatId && mainChatOnScreen(ui.screen, active),
    narrow: ui.todoNarrow,
  });
  if (introducing) introduceTodoPanel(introducing);
}
