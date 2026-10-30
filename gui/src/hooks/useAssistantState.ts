import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useSessionStatusView } from "@/hooks/useSessionStatusView";
import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import {
  type AssistantDraft,
  type AssistantLastMessage,
  assistantState,
  type AssistantState,
  lastVisibleMessage,
} from "@/lib/assistant";
import {
  readComposerDraft,
  subscribeComposerDrafts,
} from "@/lib/composer-draft";
import { loadMessageTurnsPage } from "@/lib/db";
import { useCopy } from "@/lib/i18n";
import { EMPTY_TURNS, useMessagesStore } from "@/stores/messages";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import type { Turn } from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * The assistant's state for its sidebar card and its header identity
 * (lib/assistant.ts): the main chat's live status, its unpromoted
 * subtasks' questions and errors, its unread mark. `subtasks` are the
 * main chat's unpromoted subtasks. `open` is the main chat itself on
 * screen — its header identity always, the card while the main chat is
 * the open session (one of its subtasks is not: its conversation is not
 * in front of you there). Running has no words here (main chat PRD
 * rulings 134, 135): the header says nothing then, and the card reads
 * its own (SidebarAssistant: useAssistantRound, useAssistantRunMinutes,
 * useAssistantTyping).
 */
export function useAssistantState({
  mainChat,
  subtasks,
  open,
}: {
  mainChat: Session;
  subtasks: Session[];
  open: boolean;
}): AssistantState {
  const copy = useCopy();
  const view = useSessionStatusView(mainChat);
  const subtaskAttention = useSessionsAttention(subtasks, undefined);
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
      errorCount: mainChat.errorCount,
    },
    copy,
  );
}

/** The question the main chat is asking, if the page has it. */
export function usePendingQuestion(sessionId: string): string | null {
  return useMessagesStore(
    (s) => s.byId[sessionId]?.pendingAskUser?.question ?? null,
  );
}

/**
 * The unsent draft in a session's composer (lib/composer-draft.ts), or
 * null — and null for no key: the card passes none while the assistant
 * is open, so typing in its composer never re-renders the card.
 */
export function useComposerDraft(
  key: string | undefined,
): AssistantDraft | null {
  const snapshot = () => (key ? readComposerDraft(key) : undefined);
  const draft = useSyncExternalStore(
    subscribeComposerDrafts,
    snapshot,
    snapshot,
  );
  return useMemo(
    () =>
      draft
        ? {
            text: draft.text,
            imageCount: draft.images.length,
            quoteCount: draft.quotes?.length ?? 0,
          }
        : null,
    [draft],
  );
}

/**
 * The main chat's last visible message (lib/assistant.ts), from the
 * page's message cache — the main chat opens at launch, so it is
 * normally there. Until this page has read its history
 * (`historyRead`: the launch did not open it, or the read failed — live
 * turns that landed before it are not the history, ticket 113), the
 * latest page is read with the transcript reader activation uses
 * (`session_message_turns_page`), straight into this hook: the cache,
 * the active session, the unread flag and every scroll position stay
 * as they were. It is read again only when the session's activity
 * moves while the history is still unread; once it is read, the cache
 * wins.
 *
 * While it runs, the live round's tool steps are no message
 * (`lastVisibleMessage`'s `liveRound`, main chat PRD rulings 104, 110):
 * the card stays on the last bubble the conversation draws, the main
 * chat open or not.
 */
export function useAssistantLastMessage(
  mainChat: Session,
): AssistantLastMessage | null {
  const copy = useCopy();
  const turns = useMessagesStore((s) => s.byId[mainChat.id]?.turns);
  const historyRead = useMessagesStore(
    (s) => s.byId[mainChat.id]?.historyRead ?? false,
  );
  const restoring = useMessagesStore(
    (s) => s.byId[mainChat.id]?.restoring ?? false,
  );
  const liveRound = useSessionStatusView(mainChat).status === "running";
  const cached = turns ?? EMPTY_TURNS;
  const fromCache = useMemo(
    () => lastVisibleMessage(cached, copy, { liveRound }),
    [cached, copy, liveRound],
  );
  const readKey = `${mainChat.id}@${mainChat.lastActivityAt}`;
  const needsRead = !historyRead && !restoring;
  const [read, setRead] = useState<{ key: string; turns: Turn[] } | null>(null);
  useEffect(() => {
    if (!needsRead) return;
    let cancelled = false;
    loadMessageTurnsPage(mainChat.id)
      .then((page) => {
        if (cancelled) return;
        setRead({ key: readKey, turns: rowsToTurns(page.rows) });
      })
      .catch((e: unknown) => {
        console.debug("[assistant] reading the last message failed.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [needsRead, readKey, mainChat.id]);
  const readTurns = read?.key === readKey ? read.turns : null;
  const fromRead = useMemo(
    () =>
      readTurns ? lastVisibleMessage(readTurns, copy, { liveRound }) : null,
    [readTurns, copy, liveRound],
  );
  return historyRead ? fromCache : fromRead;
}
