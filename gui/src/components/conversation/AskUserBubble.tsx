import * as ContextMenu from "@radix-ui/react-context-menu";
import { ChatCircleDots, Check, PauseCircle } from "@phosphor-icons/react";
import type { MouseEvent } from "react";

import { MarkdownView } from "@/components/conversation/MarkdownView";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  candidateLayout,
  chosenCandidateIndex,
  type CandidateLayout,
} from "@/lib/ask-user-candidates";
import { stripGATags } from "@/lib/ipc/ga-output-cleaning";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PendingAskUser } from "@/types/conversation";

/**
 * Row-layout chip max display length before truncating with ellipsis.
 * Longer candidates still send their full text on click — only the
 * visual is shortened. A tooltip surfaces the full value on hover.
 * List layout never truncates (each option owns its line).
 */
const CHIP_MAX_CHARS = 40;

export interface AskUserBubbleProps {
  pending: PendingAskUser;
  /** Called with the full candidate text (or composer text in the
   * caller's own onSubmit path). The caller is responsible for
   * dispatching `ask_user_response` over IPC + clearing the pending
   * state — this component is presentational. */
  onPickCandidate: (candidateText: string) => void;
  /**
   * Slow path beside the click-to-send fast path: put the candidate
   * text into the Composer WITHOUT sending, so the user can edit it
   * before replying ("B, but 8G"). Reached by right-click → 填入输入框
   * and by ⌘ / Ctrl + click. Omit to hide the affordance.
   */
  onFillCandidate?: (candidateText: string) => void;
  /** When true, chips are disabled (e.g. bridge not connected). */
  disabled?: boolean;
}

/**
 * GA-initiated question awaiting a user reply.
 *
 * Anchored at the conversation tail when `pendingAskUser` is non-null
 * on the active session. Visual distinction from regular assistant
 * messages: warning-tinted left bar + PauseCircle icon, so the user
 * understands "the agent has stopped, the ball is in your court".
 * Candidates render as clickable chips; the Composer below remains
 * fully open for free-form replies (the caller wires both paths into
 * the same `ask_user_response` IPC command).
 *
 * Question rendering (2026-09-14): goes through `MarkdownView` like
 * the sibling side-question bubble, for two reasons. ① Selectable
 * text — `body` is `user-select: none` (foundations.md §2.6) and
 * content surfaces opt back in via `select-text`, which MarkdownView
 * carries; the previous bare `<div>` did not, so users could not copy
 * a question (community report). ② GA questions routinely carry
 * numbered options, paths and inline code, which read better as
 * markdown. `softBreaks` keeps single newlines as line breaks because
 * the question string was never promised to be markdown (see the prop
 * doc).
 *
 * Candidate layout (2026-09-14): `candidateLayout` picks inline chips
 * for short labels and a stacked full-width list for sentence-length
 * or numerous options — a wrapped row of sentences reads as a tag
 * cloud and loses the A / B / C order the model wrote them in. Chips
 * stay buttons (unselectable chrome); the edit-before-reply need is
 * served by the fill-in slow path instead.
 *
 * Persistence: NOT in turns[]; lives in transient runtime state. After
 * a restart (or bridge death) the messages store rebuilds it from the
 * persisted ask_user tool args (`derivePendingAskUser`) whenever the
 * session's last word is still the unanswered question, so the live
 * bubble + chips come back. Once answered, the question stays visible
 * as the static `AnsweredAskUser` echo rendered from the same args.
 */
export function AskUserBubble({
  pending,
  onPickCandidate,
  onFillCandidate,
  disabled = false,
}: AskUserBubbleProps) {
  const copy = useCopy();
  const layout = candidateLayout(pending.candidates);
  return (
    <div
      data-role="ask-user-bubble"
      className="my-5 rounded-r-sm border-l-[3px] border-warning bg-warning/[var(--opacity-subtle)] px-4 py-2.5"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-warning">
        <PauseCircle size={12} weight="bold" />
        {copy.conversation.waitingForYou}
      </div>
      <MarkdownView
        source={pending.question}
        variant="agent"
        softBreaks
        className="mb-3"
      />
      {pending.candidates.length > 0 && (
        <div
          data-candidate-layout={layout}
          // List: the column shrinks to its longest option and every
          // row stretches to that width — aligned right edges without a
          // column-wide blank tail behind short options (JC dogfood
          // 2026-09-14: `w-full` rows left "a big empty stretch after
          // the text"). A wrapping option pins the column to the full
          // width, which is the one case the blank is unavoidable.
          className={
            layout === "list"
              ? "inline-flex max-w-full flex-col items-stretch gap-1.5"
              : "flex flex-wrap gap-1.5"
          }
        >
          {pending.candidates.map((c, i) => (
            <CandidateChip
              key={`${i}-${c}`}
              text={c}
              layout={layout}
              onPick={() => onPickCandidate(c)}
              onFill={onFillCandidate ? () => onFillCandidate(c) : undefined}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateChip({
  text,
  layout,
  onPick,
  onFill,
  disabled,
}: {
  text: string;
  layout: CandidateLayout;
  onPick: () => void;
  onFill?: () => void;
  disabled: boolean;
}) {
  const copy = useCopy();
  const truncated =
    layout === "row" && text.length > CHIP_MAX_CHARS
      ? text.slice(0, CHIP_MAX_CHARS - 1) + "…"
      : text;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    // ⌘ / Ctrl + click = fill-in (edit before sending), never send.
    if (onFill && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onFill();
      return;
    }
    onPick();
  };
  let button = (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "bg-surface px-2.5 py-1 text-[12.5px] text-ink-soft",
        "hover:border-warning hover:bg-warning/[var(--opacity-soft)] hover:text-ink",
        layout === "list" &&
          "h-auto w-full justify-start whitespace-normal text-left leading-[1.5]",
        disabled &&
          "cursor-not-allowed opacity-50 hover:bg-surface hover:text-ink-soft",
      )}
    >
      {truncated}
    </Button>
  );
  // Skip the Tooltip wrapper when not truncated — keeps the DOM
  // lean for the common short-candidate case.
  if (truncated !== text) {
    button = (
      <TooltipLabel
        text={text}
        sideOffset={4}
        contentClassName="z-50 max-w-[320px] text-[12px] leading-normal text-ink shadow-card"
      >
        {button}
      </TooltipLabel>
    );
  }
  if (!onFill || disabled) return button;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <span
          data-galley-context-menu-trigger=""
          className={layout === "list" ? "block" : "inline-flex"}
        >
          {button}
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-40 rounded-md border border-line bg-elevated p-1 text-[12.5px] text-ink shadow-elevated">
          <ContextMenu.Item
            className="cursor-default rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover"
            onSelect={onFill}
          >
            {copy.conversation.fillCandidate}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * Settled, already-answered ask_user question — the static echo of an
 * `AskUserBubble` that stays in the conversation after the user has
 * replied (or after an app restart restores the turn).
 *
 * Why this exists: an `ask_user` turn's question lives only in the
 * tool's args JSON, and `Conversation.tsx` filters the ask_user tool
 * callout out of the visible tool list (it was rendered live as the
 * tail AskUserBubble). Once the user answers, the live bubble is
 * cleared (`appendUserTurn` sets `pendingAskUser: null`) — and because
 * these turns usually carry no `finalAnswer` (the LLM emitted a pure
 * tool_use block), the question text would vanish entirely, leaving
 * the user unable to see what they were asked. This component surfaces
 * the question from the persisted tool args, in the same yellow
 * register as the live bubble but without the action affordances.
 *
 * While the question is still pending, the turn that produced it
 * suppresses this echo (Conversation's `suppressAskUserEcho`) — the
 * live AskUserBubble at the tail is already showing the same text,
 * and both rendering at once printed the question twice, stacked.
 *
 * Visually distinct from the live `AskUserBubble`:
 *   - `ChatCircleDots` glyph + "曾向你提问" label (vs PauseCircle +
 *     "等你回复") — signals the settled, non-actionable state.
 *   - Candidates are listed, not offered (2026-09-14): muted text in
 *     the same row / list layout the live bubble used, with a check
 *     on the one the user picked. Reading a month-old session, "B" on
 *     its own says nothing about what A and C were; a free-form reply
 *     shows the options with no check (the user's message follows).
 *     Still no buttons — the interaction is over; re-offering chips
 *     would imply re-answering is possible.
 *   - Quieter than the live bubble on purpose: an answered question is
 *     archive material ("agent once asked this"), not an attention
 *     surface. So it drops the action-card register the live bubble
 *     uses — no warning tint fill, no 3px solid bar, no body-size ink.
 *     Instead it reads like a receded quote: a thin (2px, 30%-alpha)
 *     warning rule as the only colour cue, transparent background, and
 *     secondary-register type. Sits between TurnMarker (structure) and
 *     body prose (reading) in visual weight.
 *
 * The question text is stripped of GA internal tags defensively: the
 * live IPC path already strips via `stripGATags`, but this component
 * also runs on the restore path (`rowsToTurns`), which rebuilds turns
 * straight from the DB tool_calls JSON without that cleanup.
 */
export function AnsweredAskUser({
  question,
  candidates = [],
  answer,
}: {
  question: string;
  /** The candidates as offered (persisted tool args). */
  candidates?: string[];
  /** The reply user turn's content, when the question was answered. */
  answer?: string;
}) {
  const copy = useCopy();
  const cleaned = stripGATags(question);
  const options = candidates.map(stripGATags);
  const chosen = chosenCandidateIndex(options, answer);
  const layout = candidateLayout(options);
  return (
    <div
      data-role="answered-ask-user"
      className="my-4 border-l-2 border-warning/30 pl-3.5"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-[0.04em] text-ink-muted">
        <ChatCircleDots size={10} weight="regular" />
        {copy.conversation.askedYou}
      </div>
      {/* Echo register: quieter than body but still part of the reading
          flow, so it tracks the conversation font-size tiers via its own
          var (13px at standard — the historical value). Same MarkdownView
          + softBreaks path as the live bubble so the echo is the same
          text rendered the same way, just smaller and softer — the size
          / colour overrides mirror the Goal narration pattern in
          SystemMessageBubble. */}
      <MarkdownView
        source={cleaned}
        variant="agent"
        softBreaks
        className="[&_li]:[font-size:var(--conversation-echo-size)] [&_li]:text-ink-soft [&_p]:[font-size:var(--conversation-echo-size)] [&_p]:leading-[1.55] [&_p]:text-ink-soft"
      />
      {options.length > 0 && (
        <ul
          data-candidate-layout={layout}
          className={cn(
            "m-0 mt-1.5 list-none p-0",
            layout === "list"
              ? "flex flex-col gap-0.5"
              : "flex flex-wrap gap-x-3 gap-y-0.5",
          )}
        >
          {options.map((o, i) => {
            const picked = i === chosen;
            return (
              <li
                key={`${i}-${o}`}
                data-picked={picked || undefined}
                className={cn(
                  "flex items-start gap-1 [font-size:var(--conversation-echo-size)] leading-[1.55]",
                  picked ? "text-ink-soft" : "text-ink-muted",
                )}
              >
                {(picked || layout === "list") && (
                  <span className="mt-[0.35em] inline-flex size-3 shrink-0 items-center justify-center">
                    {picked && (
                      <Check
                        size={10}
                        weight="bold"
                        aria-label={copy.conversation.chosenOption}
                      />
                    )}
                  </span>
                )}
                <span className="select-text">{o}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
