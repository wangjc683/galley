import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  isUnpromotedSubtask,
  subtaskQuestionHolder,
  type SubtaskQuestionHolder,
} from "@/lib/subtasks";
import { EMPTY_TURNS, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";

/**
 * Who holds the question of the subtask open in the main area (main
 * chat PRD ruling 102, lib/subtasks.ts `subtaskQuestionHolder`), from
 * the stores the card and the main chat read: the subtask's question and
 * turns, its `askInCard`, the main chat's turns, run and question.
 * `"none"` for any session that is not an unpromoted subtask (a promoted
 * one is an ordinary conversation) and while it asks nothing.
 */
export function useSubtaskQuestionHolder(
  sessionId: string | undefined,
): SubtaskQuestionHolder {
  const parentId = useSessionsStore((s) => {
    const session = sessionId
      ? s.sessions.find((x) => x.id === sessionId)
      : undefined;
    return isUnpromotedSubtask(session) ? session?.parentSessionId : undefined;
  });
  const subtask = useMessagesStore(
    useShallow((s) => {
      const m = sessionId && parentId ? s.byId[sessionId] : undefined;
      return {
        pending: m?.pendingAskUser ?? null,
        turns: m?.turns ?? EMPTY_TURNS,
      };
    }),
  );
  const main = useMessagesStore(
    useShallow((s) => {
      const m = parentId && subtask.pending ? s.byId[parentId] : undefined;
      return {
        loaded: m !== undefined,
        turns: m?.turns ?? EMPTY_TURNS,
        agentRunning: m?.agentRunning ?? false,
        pendingAskUser: m?.pendingAskUser ?? null,
      };
    }),
  );
  const askInCard = useSubtasksStore((s) =>
    sessionId && sessionId in s.askInCard ? s.askInCard[sessionId] : undefined,
  );
  return useMemo(
    () =>
      sessionId && parentId
        ? subtaskQuestionHolder({
            subtaskId: sessionId,
            pending: subtask.pending,
            askInCard,
            subtaskTurns: subtask.turns,
            mainChat: main.loaded
              ? {
                  turns: main.turns,
                  agentRunning: main.agentRunning,
                  pendingAskUser: main.pendingAskUser,
                }
              : undefined,
          })
        : "none",
    [
      sessionId,
      parentId,
      subtask.pending,
      subtask.turns,
      askInCard,
      main.loaded,
      main.turns,
      main.agentRunning,
      main.pendingAskUser,
    ],
  );
}
