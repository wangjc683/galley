import {
  CircleDashed,
  PaperPlaneRight,
  PauseCircle,
} from "@phosphor-icons/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { AskUserBubble } from "@/components/conversation/AskUserBubble";
import {
  REPLY_CARD_ICON,
  REPLY_CARD_LINE,
  REPLY_CARD_LINE_OPENS,
  ReplyCardTitle,
} from "@/components/conversation/ReplyCards";
import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { StatusIcon } from "@/lib/status-icon";
import { answerSubtask } from "@/lib/subtask-answer";
import {
  deriveSubtaskCard,
  subtaskCardWord,
  type SubtaskCardState,
  type SubtaskCardWord,
  type SubtaskDispatch,
} from "@/lib/subtasks";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";
import { useUiStore } from "@/stores/ui";
import type { Turn } from "@/types/conversation";

/**
 * The cards under one main chat reply: one per `<subtask>` tag it
 * carried, in tag order (main chat ticket 06a, PRD ruling 53). GUI
 * only — a card is never part of the model's context; the model looks
 * a subtask up through the CLI when the user asks.
 *
 * A card is a one-line receipt of what the reply sent off (main chat
 * PRD ruling 179, ticket 130; spec: docs/design/conversation.md
 * 「子任务卡片」), a 24px line in the reply's frame (ReplyCards, ruling
 * 182: 「回复下的卡片（一框列表）」) — a still status icon, the title, and
 * 8px after it a short word only for what needs you or did not get
 * done. No state bar, no tinted ground, no step or result line: the
 * sidebar row says who runs and who waits for you (ticket 128), Galley
 * says how it went, the card says what this reply sent and opens it. The
 * title's button opens the subtask in the main area from anywhere on the
 * line (`REPLY_CARD_TITLE_REACH`): the line lights on hover and keyboard
 * focus; a word with a reason keeps its own hover, a word without one
 * lets the click through. The state comes from `deriveSubtaskCard` over
 * the same stores the sidebar row reads; the word from `subtaskCardWord`:
 *
 *   running      a still dashed ring, muted (the sidebar row spins)
 *   asking       the amber pause, 「等你回复」: the assistant takes the
 *                question to the main chat and the user answers there
 *                (ruling 101); only when Core could not wake it for this
 *                question is it drawn and answered right here, under
 *                the line, on a faint amber ground (the frame then goes
 *                to the bubble's cap)
 *   done         the muted check, no word
 *   failed       the red cross, 「出错」 (the reason on hover), or
 *                「没有跑完」 in muted ink for a run cut short
 *   not started  the red cross, 「没有开始」 (the reason on hover),
 *                nothing to open
 *   gone         the muted prohibit sign, nothing to open
 */
export function SubtaskCards({
  dispatches,
}: {
  dispatches: readonly SubtaskDispatch[];
}) {
  return (
    <div data-role="subtask-cards" className="flex flex-col">
      {dispatches.map((d) => (
        <SubtaskCard key={`${d.turnIndex}:${d.ordinal}`} dispatch={d} />
      ))}
    </div>
  );
}

/** Sessions whose history a card already asked to read, this page
 * lifetime: a read that brings nothing back must not loop. */
const restoreRequested = new Set<string>();

const EMPTY_TURNS: readonly Turn[] = [];

function SubtaskCard({ dispatch }: { dispatch: SubtaskDispatch }) {
  const copy = useCopy();
  const sid = dispatch.sessionId;
  const session = useSessionsStore((s) =>
    sid ? s.sessions.find((x) => x.id === sid) : undefined,
  );
  const live = useMessagesStore(
    useShallow((s) => {
      const m = sid ? s.byId[sid] : undefined;
      return {
        agentRunning: m?.agentRunning ?? false,
        pendingAskUser: m?.pendingAskUser ?? null,
        turns: m?.turns ?? EMPTY_TURNS,
        restoring: m?.restoring ?? false,
      };
    }),
  );
  const runtime = useRuntimeStore(
    useShallow((s) => {
      const r = sid ? s.byId[sid] : undefined;
      return {
        bridgeStatus: r?.bridgeStatus,
        bridgeError: r?.bridgeError ?? null,
      };
    }),
  );
  const runError = useSubtasksStore((s) =>
    sid ? (s.runErrors[sid] ?? null) : null,
  );
  // Absent unless Core could not wake the main chat for this subtask's
  // report (ruling 101): then its question is answered here.
  const askInCard = useSubtasksStore((s) =>
    sid && sid in s.askInCard ? s.askInCard[sid] : undefined,
  );
  const state = deriveSubtaskCard(dispatch, session, {
    ...live,
    ...runtime,
    runError,
    askInCard,
  });

  // A subtask from before this page (a restart, a reload) has history
  // the page has not read: read its latest page once, so the card can
  // tell done from asking from stopped short.
  const needsRestore =
    state.kind === "loading" && !live.restoring && sid !== null;
  useEffect(() => {
    if (!needsRestore || !sid || restoreRequested.has(sid)) return;
    restoreRequested.add(sid);
    void useMessagesStore.getState().restoreSessionTurns(sid);
  }, [needsRestore, sid]);

  const title = session?.title || dispatch.title || copy.subtask.label;
  const word = subtaskCardWord(state, copy);
  const canOpen =
    sid !== null && state.kind !== "notStarted" && state.kind !== "gone";
  const answering = state.kind === "asking" && state.inCard && sid !== null;
  // The card's name carries what its line shows and the reason the word
  // keeps in its hover; a deleted one says so (it has no word).
  const said =
    word?.reason ??
    word?.text ??
    (state.kind === "gone" ? copy.subtask.gone : null);

  return (
    <div
      role="group"
      data-role="subtask-card"
      data-subtask-state={state.kind}
      data-session-id={sid ?? undefined}
      aria-label={[copy.subtask.label, title, said].filter(Boolean).join(" · ")}
      className={cn(
        "rounded-sm",
        // Answered here, the card is the place to act: the faint amber of
        // a question, no bar, under the conversation's bubbles.
        answering && "bg-warning/[var(--opacity-subtle)]",
      )}
    >
      <div
        className={cn(REPLY_CARD_LINE, canOpen && sid && REPLY_CARD_LINE_OPENS)}
      >
        <span className={REPLY_CARD_ICON}>
          <CardIcon state={state} />
        </span>
        {canOpen && sid ? (
          // Opens from anywhere on the line (ReplyCards).
          <ReplyCardTitle
            role="subtask-card-title"
            text={title}
            onClick={() => openSubtask(sid)}
            className="text-ink-soft group-hover/line:text-ink focus-visible:text-ink"
          />
        ) : (
          <span
            data-role="subtask-card-title"
            // Deleted: why it does not open, on hover.
            title={state.kind === "gone" ? copy.subtask.gone : undefined}
            onPointerEnter={
              state.kind === "gone"
                ? undefined
                : (e) => syncTruncatedTitle(e.currentTarget, title)
            }
            className="min-w-0 truncate leading-5 text-ink-soft"
          >
            {title}
          </span>
        )}
        {word && <CardWord word={word} />}
      </div>
      {answering && sid && <SubtaskAnswer sessionId={sid} state={state} />}
    </div>
  );
}

/** The word 8px after the title, in its state's colour, the reason in
 * full on hover (a native tooltip; the card's name carries it for a
 * screen reader). Without a reason it lets a click through to the
 * title's button (its line opens from anywhere on it). */
function CardWord({ word }: { word: SubtaskCardWord }) {
  return (
    <span
      data-role="subtask-card-word"
      title={word.reason}
      className={cn(
        "ml-2 shrink-0 select-none leading-5",
        !word.reason && "pointer-events-none",
        WORD_TONES[word.tone],
      )}
    >
      {word.text}
    </span>
  );
}

/** The question, its candidates and a one-line reply, answered in the
 * card through the same Core send as the Composer's answer: it goes to
 * the subtask as `ask_user_response` (Core sees the pending question).
 * An answer never promotes the subtask into the sidebar. Drawn only
 * when the question's report could not wake the main chat (ruling
 * 101); otherwise the user answers the assistant there. */
function SubtaskAnswer({
  sessionId,
  state,
}: {
  sessionId: string;
  state: Extract<SubtaskCardState, { kind: "asking" }>;
}) {
  const copy = useCopy();
  const [reply, setReply] = useState("");
  const send = (text: string) => {
    if (!text.trim()) return;
    setReply("");
    void answerSubtask(sessionId, text, copy);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey || isImeCompositionKeydown(e)) return;
    e.preventDefault();
    send(reply);
  };
  return (
    <AskUserBubble
      pending={state.pending}
      onPickCandidate={send}
      onFillCandidate={setReply}
      // The card carries the faint amber; the bubble sits in it bare,
      // under the card's line, on the title's 30px edge (px-2 + the
      // 16px icon column + 6px).
      className="my-0 rounded-none border-l-0 bg-transparent pb-3 pl-[30px] pr-3 pt-0"
    >
      <div className="mt-2.5 flex items-center gap-1.5">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={copy.subtask.replyPlaceholder}
          aria-label={copy.subtask.replyPlaceholder}
          className={cn(
            "h-7 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2.5 text-[12.5px] text-ink",
            "placeholder:text-ink-muted focus:border-warning focus:outline-none focus:ring-2 focus:ring-warning/20",
          )}
        />
        <IconButton
          ariaLabel={copy.subtask.send}
          tooltip={copy.subtask.send}
          variant="ghost"
          size="sm"
          disabled={!reply.trim()}
          onClick={() => send(reply)}
        >
          <PaperPlaneRight size={14} weight="thin" />
        </IconButton>
      </div>
    </AskUserBubble>
  );
}

/** Still glyphs (ruling 179 point 3): the sidebar row already spins for
 * one that runs. Running is a dashed ring in muted ink — not yet done;
 * a spinner that stands still would read as stuck. The rest are the
 * session rows' set, as before. */
function CardIcon({ state }: { state: SubtaskCardState }) {
  switch (state.kind) {
    case "running":
      return (
        <CircleDashed size={14} weight="regular" className="text-ink-muted" />
      );
    case "asking":
      return <PauseCircle size={14} weight="fill" className="text-warning" />;
    case "done":
      return <StatusIcon status="completed" size={14} />;
    case "failed":
    case "notStarted":
      return <StatusIcon status="error" size={14} />;
    case "gone":
      return <StatusIcon status="cancelled" size={14} />;
    case "loading":
      return <StatusIcon status="idle" size={14} incomplete />;
  }
}

/** Open the subtask in the main area, the way the sidebar opens a
 * session (App `openSession`); the header shows 「Galley ›」, and the
 * sidebar selects its row under the card, or the card when it has none
 * (ticket 128). */
function openSubtask(sessionId: string): void {
  const sessions = useSessionsStore.getState();
  sessions.setActiveProjectFilter(undefined);
  void sessions.activateSession(sessionId);
  useUiStore.getState().setScreen("main");
}

/** The word's colour: the sidebar's 「等你回复」 (amber, medium), red for
 * what went wrong, muted for a run cut short. */
const WORD_TONES: Record<SubtaskCardWord["tone"], string> = {
  warning: "font-medium text-warning",
  error: "text-error",
  muted: "text-ink-muted",
};
