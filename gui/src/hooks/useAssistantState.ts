import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAssistantSettledSentence } from "@/hooks/useAssistantSentence";
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
import type { Session } from "@/types/session";

/**
 * The assistant's state for its sidebar card and its header identity
 * (lib/assistant.ts): the main chat's live status, its unpromoted
 * subtasks' questions and errors, its unread mark. `subtasks` are the
 * main chat's unpromoted subtasks. `open` is the main chat itself on
 * screen — its header identity always, the card while the main chat is
 * the open session (one of its subtasks is not: its conversation is not
 * in front of you there). `header` is the header identity: running, it
 * reads the newest settled step's sentence (useAssistantSettledSentence;
 * main chat PRD rulings 107, 110), 「思考中」 before there is one. The
 * card reads no sentence: running, it says 「正在输入…」
 * (SidebarAssistant, useAssistantTyping).
 */
export function useAssistantState({
  mainChat,
  subtasks,
  open,
  header = false,
}: {
  mainChat: Session;
  subtasks: Session[];
  open: boolean;
  header?: boolean;
}): AssistantState {
  const copy = useCopy();
  const view = useSessionStatusView(mainChat);
  const running = view.status === "running";
  const sentence = useAssistantSettledSentence(mainChat.id, running && header);
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
      sentence,
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
 * normally there. When the cache holds no turns for it (the launch did
 * not open it, or a fresh main chat whose greeting is no turn and was
 * never read back), the latest page is read once with the transcript
 * reader activation uses (`session_message_turns_page`), straight into
 * this hook: the cache, the active session, the unread flag and every
 * scroll position stay as they were. It is read again only when the
 * session's activity moves while the cache still holds nothing; once
 * the cache has turns, they win.
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
  const needsRead = cached.length === 0 && !restoring;
  const [read, setRead] = useState<{
    key: string;
    message: AssistantLastMessage | null;
  } | null>(null);
  useEffect(() => {
    if (!needsRead) return;
    let cancelled = false;
    loadMessageTurnsPage(mainChat.id)
      .then((page) => {
        if (cancelled) return;
        setRead({
          key: readKey,
          message: lastVisibleMessage(rowsToTurns(page.rows), copy),
        });
      })
      .catch((e: unknown) => {
        console.debug("[assistant] reading the last message failed.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [needsRead, readKey, mainChat.id, copy]);
  if (cached.length > 0) return fromCache;
  return read?.key === readKey ? read.message : null;
}
