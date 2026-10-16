import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ExpandSection } from "@/components/conversation/ExpandSection";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { MessageAgentNarration } from "@/components/conversation/MessageAgent";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import {
  ASSISTANT_PROCESS_ROWS,
  assistantStep,
  type AssistantStep,
} from "@/lib/assistant-process";
import { BrowserSitesContext } from "@/lib/browser-site";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AgentTurn } from "@/types/conversation";

/*
 * A run's steps, one line a step (spec: conversation.md 「过程卡片」;
 * rules in lib/assistant-process.ts): the card both conversations draw.
 * The assistant's process button opens it under a reply
 * (AssistantProcessCard: its numbers on the first line, eight rows at
 * most before it scrolls, the reply bubble's width); the workbench's run
 * fold header opens it above the answer (RunFoldSection: no numbers line
 * — the header says them — no cap, the column's width; workbench
 * conversation PRD ruling 6). The frame is the subtask cards' —
 * hairline `border-line`, their 12px radius, the page ground, no shadow,
 * no lift, no status bar. Each line is the step marker's sentence, then
 * what the step touched in a lighter ink; a step with something to show
 * opens in place.
 */

/** A step with a row, keyed by its turn's place. */
export interface ProcessCardStep {
  key: string;
  turn: AgentTurn;
}

/** The capped steps' scroll box: eight 24px rows and half of the ninth,
 * whose top shows through the bottom fade, so "more below" is text
 * fading out, not a bare gradient. Eight rows and the 4px under the
 * last (196px) fit without scrolling. */
const ROWS_MAX_H = "max-h-[204px]";

/**
 * What opening a step shows, in place under its row: what the step
 * region drew under the step's marker — its narration when that is not
 * the row's sentence, its tools (ToolCallout, each opening as it does
 * there) — then what the marker's caret opened, the reasoning and the
 * preamble. Tools first: in the assistant the card is the only place a
 * settled round says what it ran, and a long reasoning would push them
 * out of its eight rows. The content starts where the row's sentence
 * starts, as a step's body starts at its marker's.
 */
function StepDetail({ step }: { step: AssistantStep }) {
  return (
    <div data-role="process-detail" className="px-2 pb-2">
      {step.narration && (
        <MessageAgentNarration>{step.narration}</MessageAgentNarration>
      )}
      {step.tools.map((tool) => (
        <ToolCallout key={tool.id} tool={tool} />
      ))}
      {(step.thinking || step.preamble) && (
        <div className="mt-1.5 space-y-2">
          {step.thinking && (
            <MarkdownView source={step.thinking} variant="thinking" />
          )}
          {step.preamble && (
            <MarkdownView source={step.preamble} variant="thinking" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One step, one 24px line: the sentence (ink-soft, cut to the line,
 * the whole of it on hover), then the first thing the step touched and
 * 「+N」 for the rest (ink-muted, never pushed out by a long sentence).
 * A step with a detail is a disclosure in the step marker's grammar —
 * role="button", a tab stop, Enter / Space, aria-expanded, `bg-hover`
 * and the sentence lifted to ink on hover or focus, no caret — that
 * opens the detail under it; open, the sentence stays at ink. A step
 * with nothing to open is plain text. The whole line is the one thing
 * to click: no caret, no link on the file name (opening the step shows
 * the tool's own open button).
 */
function ProcessStepRow({ step }: { step: AssistantStep }) {
  const [open, setOpen] = useState(false);
  const detail = step.hasDetail;
  const [first, ...rest] = step.objects;
  return (
    <div data-role="process-step">
      <div
        role={detail ? "button" : undefined}
        tabIndex={detail ? 0 : undefined}
        aria-expanded={detail ? open : undefined}
        onClick={
          detail
            ? (e) => {
                // Finishing a drag-select inside the row must not
                // toggle it (the step marker's guard).
                const selection = window.getSelection();
                if (
                  selection &&
                  !selection.isCollapsed &&
                  selection.anchorNode &&
                  e.currentTarget.contains(selection.anchorNode)
                ) {
                  return;
                }
                setOpen((v) => !v);
              }
            : undefined
        }
        onKeyDown={
          detail
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
        className={cn(
          "flex h-6 min-w-0 items-center rounded-sm px-2 [font-size:var(--conversation-step-size)]",
          detail &&
            "group cursor-default outline-none hover:bg-hover focus-visible:bg-hover",
        )}
      >
        <span
          title={step.sentence}
          className={cn(
            "min-w-0 select-text truncate",
            open ? "text-ink" : "text-ink-soft",
            detail && "group-hover:text-ink group-focus-visible:text-ink",
          )}
        >
          {step.sentence}
        </span>
        {first && (
          <span
            data-role="process-object"
            title={step.objects.join(" · ")}
            className="ml-2 max-w-[40%] shrink-0 truncate text-ink-muted"
          >
            {first}
            {rest.length > 0 && ` +${rest.length}`}
          </span>
        )}
      </div>
      {detail && (
        <ExpandSection open={open}>
          <StepDetail step={step} />
        </ExpandSection>
      )}
    </div>
  );
}

function StepRows({ steps }: { steps: ProcessCardStep[] }) {
  const copy = useCopy();
  const resolveSite = useContext(BrowserSitesContext);
  return steps.map(({ key, turn }) => (
    <ProcessStepRow
      key={key}
      step={assistantStep(turn, copy.conversation, resolveSite)}
    />
  ));
}

/**
 * The capped steps (the assistant's): at most ASSISTANT_PROCESS_ROWS
 * rows tall, the rest scrolling inside the card (an opened step's
 * detail scrolls with them). The browser's own scroll chain: past the
 * card's end the conversation scrolls on. Opening the card mounts this
 * afresh, at the first step.
 *
 * The edges fade as the sidebar list's does under its pinned row (a
 * 12px `app` → transparent gradient, layout-and-chrome.md): at the
 * bottom while more is below, under the first line once the steps have
 * scrolled up behind it, so no row is cut by an invisible edge. Both
 * are read off the scroll box on scroll and on resize of the box or of
 * its content (a step opening); before the first read, the bottom one
 * follows the row count (rows are 24px and mount closed).
 */
function CappedSteps({ steps }: { steps: ProcessCardStep[] }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState(() => ({
    above: false,
    below: steps.length > ASSISTANT_PROCESS_ROWS,
  }));
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const above = el.scrollTop > 0;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((prev) =>
      prev.above === above && prev.below === below ? prev : { above, below },
    );
  }, []);
  useEffect(() => {
    const el = box.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    // The first callback lands right after observe(): the first read.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className="relative">
      <div
        ref={box}
        onScroll={measure}
        data-role="process-steps"
        data-overflow={edges.below || edges.above ? "true" : "false"}
        className={cn("overflow-y-auto px-1", ROWS_MAX_H)}
      >
        <div ref={content} className="pb-1">
          <StepRows steps={steps} />
        </div>
      </div>
      <div
        aria-hidden
        data-role="process-fade-top"
        style={{
          background:
            "linear-gradient(to bottom, var(--color-app), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-3",
          edges.above ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        data-role="process-fade"
        style={{
          background: "linear-gradient(to top, var(--color-app), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-3",
          edges.below ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/**
 * The card. The two conversations differ in three things only:
 *
 *   heading   a first line above the steps (the assistant's numbers,
 *             AssistantRunSummary); none in the workbench, whose fold
 *             header right above already says them.
 *   capped    eight rows and a half, the rest scrolling inside with the
 *             fades (the assistant's); uncapped, every step on the page
 *             (the workbench's: reading the process is the work there,
 *             p90 11 steps and at most 52, and a scroll inside a scroll
 *             is a burden).
 *   width     `className`: the reply bubble's cap in the assistant; the
 *             column's full width in the workbench, as its answer is.
 *
 * The frame, the rows and what opening a row shows are one.
 */
export function ProcessCard({
  steps,
  heading,
  capped = false,
  className,
}: {
  steps: ProcessCardStep[];
  heading?: ReactNode;
  capped?: boolean;
  className?: string;
}) {
  return (
    <div
      data-role="process-card"
      className={cn(
        "overflow-hidden rounded-md border border-line bg-app pt-1",
        className,
      )}
    >
      {heading}
      {capped ? (
        <CappedSteps steps={steps} />
      ) : (
        <div data-role="process-steps" className="px-1 pb-1">
          <StepRows steps={steps} />
        </div>
      )}
    </div>
  );
}
