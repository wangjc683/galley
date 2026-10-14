import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { ExpandSection } from "@/components/conversation/ExpandSection";
import { StepRegion } from "@/components/conversation/StepRegion";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { cn } from "@/lib/utils";

import { imLineClock } from "./im-trial";

/**
 * TEMPORARY — the pieces the IM rendering trial draws (ticket 19; see
 * im-trial.ts): the centred time, the 「N 步 ›」 entry and its step
 * region, the one-line process.
 */

// MessageUser's send-time type (MESSAGE_TIME_TEXT), unchanged: the
// centred time only moves the label (the ticket: same size and ink, no
// chip behind it, the way iMessage and WeChat draw it).
const TIME_TEXT =
  "text-ui-micro text-ink-muted/70 select-none leading-none [font-variant-numeric:tabular-nums]";

/**
 * The send time at a break as a line of its own, centred between two
 * messages: it belongs to the conversation, not to the bubble under it.
 * 16px above it, 20px under it (the message after it keeps its own
 * 20px, collapsing with this); right under a reply, whose reserved
 * action row already leaves 30px, it adds nothing above. Hover gives
 * the full date.
 */
export function ImTimeDivider({
  label,
  full,
  iso,
  afterReply = false,
}: {
  label: string;
  full?: string;
  iso?: string;
  /** Right under a reply row (its action row is the gap above). */
  afterReply?: boolean;
}) {
  const time = (
    <time dateTime={iso} className={TIME_TEXT}>
      {label}
    </time>
  );
  return (
    <div
      data-role="im-time-divider"
      className={cn("flex justify-center", afterReply ? "mb-4" : "my-4")}
    >
      {full ? <TooltipLabel text={full}>{time}</TooltipLabel> : time}
    </div>
  );
}

/** The RunFoldHeader's duration words (formatDuration there). */
function durationText(
  elapsedMs: number | null,
  copy: ReturnType<typeof useCopy>,
): string | null {
  if (elapsedMs == null || elapsedMs <= 0) return null;
  const sec = Math.round(elapsedMs / 1000);
  if (sec < 1) return null;
  if (sec < 60) return copy.conversation.foldDurationSeconds(sec);
  return copy.conversation.foldDurationMinutes(Math.floor(sec / 60), sec % 60);
}

/**
 * Under a reply of two steps or more (line mode): 「9 步 · 用时 1 分 21 秒 ›」,
 * the fold header's structure segment alone — no tool scent — in the
 * same quiet ink (words ink-muted, digits one rung up), a trailing ›
 * that turns down while open. It leads the reply's action row, so it
 * sits right under the reply and the hover-only copy / save chips come
 * in after it. Same disclosure grammar as the fold header: a button
 * row, Enter / Space, hover paint bleeding 8px left of the text.
 */
export function ImRunEntry({
  stats,
  open,
  onToggle,
}: {
  stats: RunStats;
  open: boolean;
  onToggle: () => void;
}) {
  const copy = useCopy();
  const steps = copy.conversation.foldSteps(stats.stepCount);
  const duration = durationText(stats.elapsedMs, copy);
  const text = duration ? `${steps} · ${duration}` : steps;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={
        open ? copy.conversation.foldCollapse : copy.conversation.foldExpand
      }
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      data-role="im-run-entry"
      className={cn(
        "group/entry -ml-2 inline-flex h-6 cursor-default select-none items-center gap-1 rounded-sm px-2 tabular-nums tracking-[0.01em] text-ink-muted outline-none [font-size:var(--conversation-step-size)]",
        "hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink",
      )}
    >
      <span>
        {text.split(/(\d+)/).map((part, i) =>
          i % 2 === 1 ? (
            <span
              key={i}
              className="text-ink-soft group-hover/entry:text-ink group-focus-visible/entry:text-ink"
            >
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
      <CaretRight
        size={11}
        weight="thin"
        className={cn(
          "shrink-0 transition-transform duration-(--motion-slow)",
          open && "rotate-90",
        )}
      />
    </div>
  );
}

/**
 * The steps of a settled reply, opened in place under its entry (line
 * mode): the fold section's contents — markers, narration, tools — in
 * the same inset region with its rail, minus the questions and answers
 * that stay outside as messages. The first marker's 24px run gap is
 * pulled back to 8px so the list hangs from the entry.
 */
export function ImRunSteps({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <ExpandSection open={open} openClassName="-mt-4" closedClassName="mt-0">
      <div data-role="im-run-steps" className="pb-1">
        <StepRegion>{children}</StepRegion>
      </div>
    </ExpandSection>
  );
}

/**
 * The one line at the conversation's end while the round runs (line
 * mode): the latest sentence it wrote, or 「思考中」; past 3s the round's
 * clock — the corner clock's own number and words, which this mode
 * hides so the time shows once. The thinking row's register (12px
 * sans, ink-soft) and its shimmer as the busy cue, not a typing bubble.
 * Cut to one line.
 */
export function ImLiveLine({
  sentence,
  startedAtMs,
  baseMs,
}: {
  sentence: string | null;
  startedAtMs: number | null;
  baseMs: number;
}) {
  const copy = useCopy();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);
  const clock =
    startedAtMs != null
      ? imLineClock(baseMs + (now - startedAtMs), copy)
      : null;
  const text = sentence ?? copy.conversation.thinking.replace(/[.…]+$/, "");
  return (
    <div
      data-role="im-live-line"
      className="mt-5 flex min-w-0 items-baseline gap-1.5 leading-[1.6] text-ink-soft [font-size:var(--conversation-step-size)]"
    >
      <span className="thinking-shimmer min-w-0 truncate">{text}</span>
      {clock && (
        <span className="shrink-0 tabular-nums text-ink-muted">{`· ${clock}`}</span>
      )}
    </div>
  );
}
