import { PaperPlaneRight, PauseCircle } from "@phosphor-icons/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { AskUserBubble } from "@/components/conversation/AskUserBubble";
import { Button, IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { StatusIcon } from "@/lib/status-icon";
import { answerSubtask } from "@/lib/subtask-answer";
import {
  deriveSubtaskCard,
  subtaskCardLine,
  type SubtaskCardState,
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
 * A card is the subtask's row in the document register (spec:
 * docs/design/conversation.md 「子任务卡片」): the attention-block frame
 * of a tool callout (hairline, 8px radius, a 3px state bar on the left)
 * holding the session row's three signals — status icon, title, one
 * state line — and 「打开」 on the right. The state comes from
 * `deriveSubtaskCard` over the same stores the sidebar row reads:
 *
 *   running   brand bar, spinner, 「第 N 步 · …」 (the row's subline)
 *   asking    warning bar + tint, the question answered right here
 *   done      faint bar on the page, check, one line of result
 *   failed    red bar + tint, the reason
 *   not started  faint red bar, the reason, nothing to open
 */
export function SubtaskCards({
  dispatches,
}: {
  dispatches: readonly SubtaskDispatch[];
}) {
  return (
    <div data-role="subtask-cards" className="mt-3 flex flex-col gap-2">
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
  const state = deriveSubtaskCard(dispatch, session, {
    ...live,
    ...runtime,
    runError,
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
  const line = subtaskCardLine(state, copy);
  const canOpen =
    sid !== null && state.kind !== "notStarted" && state.kind !== "gone";
  const frame = FRAMES[state.kind];

  return (
    <div
      data-role="subtask-card"
      data-subtask-state={state.kind}
      data-session-id={sid ?? undefined}
      aria-label={`${copy.subtask.label} · ${title}`}
      className={cn(
        "relative overflow-hidden rounded-md border border-line",
        frame.ground,
      )}
    >
      {frame.bar && (
        <div
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-[3px]", frame.bar)}
        />
      )}
      <div className="flex select-none items-start gap-2.5 py-2.5 pl-4 pr-2.5">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <CardIcon state={state} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px] font-medium leading-5 text-ink"
            onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, title)}
          >
            {title}
          </div>
          {line && (
            <div
              className={cn(
                "mt-0.5 truncate text-[12px] leading-[1.45] tabular-nums",
                LINE_TONES[state.kind],
              )}
              onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, line)}
            >
              {line}
            </div>
          )}
        </div>
        {canOpen && sid && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => openSubtask(sid)}
          >
            {copy.subtask.open}
          </Button>
        )}
      </div>
      {state.kind === "asking" && sid && (
        <SubtaskAnswer sessionId={sid} state={state} />
      )}
    </div>
  );
}

/** The question, its candidates and a one-line reply, answered in the
 * card through the same Core send as the Composer's answer: it goes to
 * the subtask as `ask_user_response` (Core sees the pending question).
 * An answer never promotes the subtask into the sidebar. */
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
      // The card carries the warning bar and tint; the bubble sits in
      // it bare, under the card's own row.
      className="my-0 rounded-none border-l-0 bg-transparent pb-3 pl-[42px] pr-3 pt-0"
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

function CardIcon({ state }: { state: SubtaskCardState }) {
  switch (state.kind) {
    case "running":
      return <StatusIcon status="running" size={14} />;
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
 * session (App `openSession`); the sidebar keeps the main chat's row
 * selected and the header shows 「主对话 ›」. */
function openSubtask(sessionId: string): void {
  const sessions = useSessionsStore.getState();
  sessions.setActiveProjectFilter(undefined);
  void sessions.activateSession(sessionId);
  useUiStore.getState().setScreen("main");
}

/** The tool callout's attention-block registers (tools-and-approvals.md):
 * a live state gets its full bar on a raised ground, a settled one a
 * faint bar on the page. */
const FRAMES: Record<
  SubtaskCardState["kind"],
  { bar: string | null; ground: string }
> = {
  running: { bar: "bg-brand", ground: "bg-surface" },
  asking: { bar: "bg-warning", ground: "bg-warning/[var(--opacity-subtle)]" },
  done: { bar: "bg-brand/[var(--opacity-medium)]", ground: "bg-app" },
  failed: { bar: "bg-error", ground: "bg-error/[var(--opacity-subtle)]" },
  notStarted: { bar: "bg-error/[var(--opacity-medium)]", ground: "bg-app" },
  gone: { bar: null, ground: "bg-app" },
  loading: { bar: null, ground: "bg-app" },
};

/** The state line's tone: the sidebar subline's (warning / error /
 * running brand / muted). */
const LINE_TONES: Record<SubtaskCardState["kind"], string> = {
  running: "text-brand-strong/85",
  asking: "font-medium text-warning",
  done: "text-ink-muted",
  failed: "font-medium text-error",
  notStarted: "text-error",
  gone: "text-ink-muted",
  loading: "text-ink-muted",
};
