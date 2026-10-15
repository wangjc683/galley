import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
import { ExpandSection } from "@/components/conversation/ExpandSection";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { TokenMetrics } from "@/components/conversation/MessageActions";
import { MessageAgentNarration } from "@/components/conversation/MessageAgent";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import {
  ASSISTANT_PROCESS_ROWS,
  assistantStep,
  type AssistantStep,
} from "@/lib/assistant-process";
import { BrowserSitesContext } from "@/lib/browser-site";
import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { formatCompactCount, telemetryInputTotal } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import type { AgentTurn, MessageTelemetry } from "@/types/conversation";

/*
 * The assistant's process card (main chat PRD ruling 69; spec:
 * conversation.md 「助手的对话」 → 过程; rules in lib/assistant-process.ts):
 * what its process button opens under a settled reply. A card in the
 * subtask cards' frame — hairline `border-line`, their 12px radius, the
 * page ground, no shadow, no lift, no status bar — as wide as the reply
 * bubble's cap. Its first line is the round in numbers; under it one
 * line a step (the marker's sentence, then what the step touched in a
 * lighter ink), eight at most, the rest scrolling inside the card. A
 * step with something to show opens in place.
 */

/** The steps' scroll box: eight 24px rows and half of the ninth, whose
 * top shows through the bottom fade, so "more below" is text fading
 * out, not a bare gradient. Eight rows and the 4px under the last
 * (196px) fit without scrolling. */
const ROWS_MAX_H = "max-h-[204px]";

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
 * What opening a step shows, in place under its row: what the step
 * region drew under the step's marker — its narration when that is not
 * the row's sentence, its tools (ToolCallout, each opening as it does
 * there) — then what the marker's caret opened, the reasoning and the
 * preamble. Tools first: the round's steps are the only place a
 * settled assistant round says what it ran, and a long reasoning would
 * push them out of the card's eight rows. The content starts where the
 * row's sentence starts, as a step's body starts at its marker's.
 */
function StepDetail({ step }: { step: AssistantStep }) {
  return (
    <div data-role="assistant-process-detail" className="px-2 pb-2">
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
 * with nothing to open is plain text.
 */
function ProcessStepRow({ step }: { step: AssistantStep }) {
  const [open, setOpen] = useState(false);
  const detail = step.hasDetail;
  const [first, ...rest] = step.objects;
  return (
    <div data-role="assistant-process-step">
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
            data-role="assistant-process-object"
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

/**
 * The steps under the first line: at most ASSISTANT_PROCESS_ROWS rows
 * tall, the rest scrolling inside the card (an opened step's detail
 * scrolls with them). The browser's own scroll chain: past the card's
 * end the conversation scrolls on. Opening the card mounts this afresh,
 * at the first step.
 *
 * The edges fade as the sidebar list's does under its pinned row (a
 * 12px `app` → transparent gradient, layout-and-chrome.md): at the
 * bottom while more is below, under the first line once the steps have
 * scrolled up behind it, so no row is cut by an invisible edge. Both
 * are read off the scroll box on scroll and on resize of the box or of
 * its content (a step opening); before the first read, the bottom one
 * follows the row count (rows are 24px and mount closed).
 */
function ProcessSteps({
  steps,
}: {
  steps: { key: string; turn: AgentTurn }[];
}) {
  const copy = useCopy();
  const resolveSite = useContext(BrowserSitesContext);
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
        data-role="assistant-process-steps"
        data-overflow={edges.below || edges.above ? "true" : "false"}
        className={cn("overflow-y-auto px-1", ROWS_MAX_H)}
      >
        <div ref={content} className="pb-1">
          {steps.map(({ key, turn }) => (
            <ProcessStepRow
              key={key}
              step={assistantStep(turn, copy.conversation, resolveSite)}
            />
          ))}
        </div>
      </div>
      <div
        aria-hidden
        data-role="assistant-process-fade-top"
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
        data-role="assistant-process-fade"
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
  steps: { key: string; turn: AgentTurn }[];
}) {
  return (
    <ExpandSection open={open} openClassName="mt-1.5" closedClassName="mt-0">
      <div className="pb-5">
        <div
          data-role="assistant-process-card"
          className={cn(
            "overflow-hidden rounded-md border border-line bg-app pt-1",
            ASSISTANT_BUBBLE_MAX,
          )}
        >
          <AssistantRunSummary stats={stats} telemetry={telemetry} />
          <ProcessSteps steps={steps} />
        </div>
      </div>
    </ExpandSection>
  );
}
