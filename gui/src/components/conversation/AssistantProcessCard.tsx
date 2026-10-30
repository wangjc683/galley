import { Footprints } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";

import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
import { ExpandSection } from "@/components/conversation/ExpandSection";
import { TokenMetrics } from "@/components/conversation/MessageActions";
import {
  ProcessCard,
  type ProcessCardStep,
} from "@/components/conversation/ProcessCard";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { formatCompactCount, telemetryInputTotal } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import type { MessageTelemetry } from "@/types/conversation";

/*
 * The assistant's process card (main chat PRD ruling 69; spec:
 * conversation.md 「助手的对话」 → 过程; rules in lib/assistant-process.ts):
 * what its process button opens under a settled reply. The card
 * (ProcessCard, the workbench's run fold opens the same one) as wide as
 * the reply bubble's cap; its first line is the round in numbers; under
 * it one line a step, eight at most, the rest scrolling inside the
 * card. A step with something to show opens in place.
 *
 * A round without an answer has no reply to hang it under (ruling 159,
 * ticket 114): it is one line where the reply would be,
 * 「中途停下 · N 步」, and the line opens the same card
 * (AssistantStoppedRun).
 */

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

/** Its figures one ink rung up. */
function inkFigures(text: string): ReactNode {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-ink-soft">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The card's first line, the round in numbers (ruling 68, moved into
 * the card by ruling 69): 「4 步 · 用时 45 秒 · ↑33k ↓1.1k」 — the fold
 * header's structure segment and the action bar's ↑ ↓ with their tips
 * (TokenMetrics, the cache split included). The step count is the
 * round's (the answer's and a question's steps included), as before.
 * No control: no hover ground, no caret, no click. Words ink-muted,
 * figures ink-soft (the token counts whole), at the step size, on a
 * 24px line. No context percentage. Without a duration (a segment that
 * has no telemetry) it reads the step count alone; without tokens, no
 * token segment. It stays put while the steps scroll under it.
 */
function AssistantRunSummary({
  stats,
  telemetry,
}: {
  stats: RunStats;
  telemetry?: MessageTelemetry | null;
}) {
  const copy = useCopy();
  const steps = copy.conversation.foldSteps(stats.stepCount);
  const duration = durationText(stats.elapsedMs, copy);
  const tokens = Boolean(
    formatCompactCount(telemetryInputTotal(telemetry)) ||
    formatCompactCount(telemetry?.outputTokens),
  );
  return (
    <div
      data-role="assistant-run-summary"
      className="h-6 whitespace-nowrap px-3 leading-6 tabular-nums tracking-[0.01em] text-ink-muted [font-size:var(--conversation-step-size)]"
    >
      {inkFigures(duration ? `${steps} · ${duration}` : steps)}
      {tokens && (
        <>
          {" · "}
          <span className="inline-flex items-center gap-1.5 align-middle">
            <TokenMetrics
              telemetry={telemetry}
              valueClassName="text-ink-soft"
            />
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The card, opened in place under the reply's action row by the process
 * button and swept open / closed as ExpandSection does. 6px under the
 * action row (the bubble → action row gap again), 20px of its own under
 * it (the change-of-side gap, assistantRowGap's mt-5), so the next
 * message or time line no longer sits on its edge; both inside the
 * sweep, so they open and close with it.
 */
export function AssistantProcessCard({
  open,
  stats,
  telemetry,
  steps,
}: {
  open: boolean;
  stats: RunStats;
  /** The whole round's (run-groups `RunStats.telemetry`, else the
   * answer turn's): what the action bar's ↑ ↓ read. */
  telemetry?: MessageTelemetry | null;
  /** The steps with a row (lib/assistant-process.ts
   * `assistantProcessSteps`), keyed by their turn's place. */
  steps: ProcessCardStep[];
}) {
  return (
    <ExpandSection open={open} openClassName="mt-1.5" closedClassName="mt-0">
      <div className="pb-5">
        <ProcessCard
          steps={steps}
          heading={<AssistantRunSummary stats={stats} telemetry={telemetry} />}
          capped
          className={ASSISTANT_BUBBLE_MAX}
        />
      </div>
    </ExpandSection>
  );
}

/** The line's figures one ink rung up, lifted with its words. */
function lineFigures(text: string, lifted: boolean): ReactNode {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className={cn(
          lifted ? "text-ink" : "text-ink-soft",
          "group-hover/stopped:text-ink group-focus-visible/stopped:text-ink",
        )}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * A round of the assistant's conversation that ended without an answer
 * — stopped, failed, at the step cap (main chat PRD ruling 159, ticket
 * 114; rules in lib/assistant-conversation.ts `stoppedPartway`): one
 * line where its reply would be, 「中途停下 · 4 步」, and under it the
 * card the process button opens under a reply, every step but the ones
 * that only asked (its questions and your answers are out as messages,
 * before the line).
 *
 * The line: the process button's `Footprints` first, sitting where that
 * chip's glyph sits under a reply (5px in from the bubble's left edge),
 * then the words — ink-muted, the count ink-soft, at the step size, as
 * the card's first line (AssistantRunSummary). No bubble ground: it is
 * not something it said. The whole line is the toggle, in the step
 * marker's grammar (a tab stop, Enter / Space, `aria-expanded`, the
 * `bg-hover` ground and ink on hover or focus, the fold header's
 * 「展开过程 / 收起过程」 for its tip); open, the words stay at ink. A
 * round whose every step only asked has nothing to open: plain words.
 * No message menu: it is no bubble, and it cannot be deleted.
 *
 * The gaps: its top margin is the conversation's (`className`, the IM
 * row gap, the line counting as its side). Under it 24px of its own,
 * where a reply has its action row: the glyphs end about 5px above the
 * line's foot, so your next bubble reads about 30px under them, as it
 * does under a reply bubble. Opened, those 24px give way to the card's
 * own 6px above and 20px below (AssistantProcessCard), swept with it.
 */
export function AssistantStoppedRun({
  stats,
  open,
  onToggle,
  steps,
  className,
}: {
  stats: RunStats;
  open: boolean;
  onToggle: () => void;
  /** The steps with a row (lib/assistant-process.ts
   * `assistantProcessSteps`, no answer to leave out). None: no toggle. */
  steps: ProcessCardStep[];
  className?: string;
}) {
  const copy = useCopy();
  const toggle = steps.length > 0;
  const shown = toggle && open;
  const words = `${copy.conversation.stoppedPartway} · ${copy.conversation.foldSteps(stats.stepCount)}`;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  const line = (
    <div
      data-role="assistant-stopped"
      role={toggle ? "button" : undefined}
      tabIndex={toggle ? 0 : undefined}
      aria-expanded={toggle ? open : undefined}
      onClick={toggle ? onToggle : undefined}
      onKeyDown={toggle ? onKeyDown : undefined}
      className={cn(
        "flex h-6 w-fit max-w-full items-center gap-1.5 rounded-sm pl-[5px] pr-2 whitespace-nowrap tabular-nums tracking-[0.01em] [font-size:var(--conversation-step-size)]",
        shown ? "text-ink" : "text-ink-muted",
        toggle &&
          "group/stopped cursor-default outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink",
      )}
    >
      <Footprints size={14} weight="thin" className="shrink-0" />
      <span>{lineFigures(words, shown)}</span>
    </div>
  );
  return (
    <div
      className={cn(
        "transition-[padding-bottom] duration-(--motion-slow) ease-firm motion-reduce:transition-none",
        shown ? "pb-0" : "pb-6",
        className,
      )}
    >
      {toggle ? (
        <TooltipLabel
          text={
            open ? copy.conversation.foldCollapse : copy.conversation.foldExpand
          }
        >
          {line}
        </TooltipLabel>
      ) : (
        line
      )}
      {toggle && (
        <AssistantProcessCard open={open} stats={stats} steps={steps} />
      )}
    </div>
  );
}
