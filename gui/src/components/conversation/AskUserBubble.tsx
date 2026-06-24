import { ChatCircleDots, PauseCircle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { stripGATags } from "@/lib/ipc/ga-output-cleaning";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PendingAskUser } from "@/types/conversation";

/**
 * Chip max display length before truncating with ellipsis. Longer
 * candidates still send their full text on click — only the visual
 * is shortened. A tooltip surfaces the full value on hover.
 */
const CHIP_MAX_CHARS = 40;

export interface AskUserBubbleProps {
  pending: PendingAskUser;
  /** Called with the full candidate text (or composer text in the
   * caller's own onSubmit path). The caller is responsible for
   * dispatching `ask_user_response` over IPC + clearing the pending
   * state — this component is presentational. */
  onPickCandidate: (candidateText: string) => void;
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
 * Persistence: NOT in turns[]; lives in transient runtime state. On
 * restart the live chips disappear, but the question stays visible as
 * a static `AnsweredAskUser` echo rendered from the assistant turn's
 * persisted `ask_user` tool args, so the user can still see what they
 * were asked (and answer via the Composer if they never did).
 */
export function AskUserBubble({
  pending,
  onPickCandidate,
  disabled = false,
}: AskUserBubbleProps) {
  const copy = useCopy();
  return (
    <div
      data-role="ask-user-bubble"
      className="my-5 rounded-r-sm border-l-[3px] border-warning bg-warning/[var(--opacity-subtle)] px-4 py-2.5"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-warning">
        <PauseCircle size={12} weight="bold" />
        {copy.conversation.waitingForYou}
      </div>
      <div className="mb-3 whitespace-pre-wrap [font-size:var(--conversation-body-size)] [line-height:var(--conversation-body-leading)] text-ink">
        {pending.question}
      </div>
      {pending.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.candidates.map((c, i) => (
            <CandidateChip
              key={`${i}-${c}`}
              text={c}
              onClick={() => onPickCandidate(c)}
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
  onClick,
  disabled,
}: {
  text: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const truncated =
    text.length > CHIP_MAX_CHARS
      ? text.slice(0, CHIP_MAX_CHARS - 1) + "…"
      : text;
  const button = (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "bg-surface px-2.5 py-1 text-[12.5px] text-ink-soft",
        "hover:border-warning hover:bg-warning/[var(--opacity-soft)] hover:text-ink",
        disabled &&
          "cursor-not-allowed opacity-50 hover:bg-surface hover:text-ink-soft",
      )}
    >
      {truncated}
    </Button>
  );
  // Skip the Tooltip wrapper when not truncated — keeps the DOM
  // lean for the common short-candidate case.
  if (truncated === text) return button;
  return (
    <TooltipLabel
      text={text}
      sideOffset={4}
      contentClassName="z-50 max-w-[320px] text-[12px] leading-normal text-ink shadow-card"
    >
      {button}
    </TooltipLabel>
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
 * Visually distinct from the live `AskUserBubble`:
 *   - `ChatCircleDots` glyph + "曾向你提问" label (vs PauseCircle +
 *     "等你回复") — signals the settled, non-actionable state.
 *   - No candidate chips — the interaction is over; showing them again
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
export function AnsweredAskUser({ question }: { question: string }) {
  const copy = useCopy();
  const cleaned = stripGATags(question);
  return (
    <div
      data-role="answered-ask-user"
      className="my-4 border-l-2 border-warning/30 pl-3.5"
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-[0.04em] text-ink-muted">
        <ChatCircleDots size={10} weight="regular" />
        {copy.conversation.askedYou}
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-ink-soft">
        {cleaned}
      </div>
    </div>
  );
}
