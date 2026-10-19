import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FloppyDisk,
  Footprints,
  Gauge,
} from "@phosphor-icons/react";
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import {
  MessageMenuButton,
  MessageQuoteButton,
} from "@/components/conversation/MessageMenu";
import { TooltipLabel } from "@/components/ui/tooltip";
import type { AssistantProcessToggle } from "@/lib/assistant-conversation";
import { useCopy } from "@/lib/i18n";
import {
  contextUsagePercentLabel,
  contextUsageTokens,
  formatCompactCount,
  telemetryCachedInput,
  telemetryInputTotal,
} from "@/lib/telemetry";
import { saveReplyMarkdown } from "@/lib/reply-save";
import { cn } from "@/lib/utils";
import type { MessageTelemetry } from "@/types/conversation";

/**
 * Per-reply action bar — sits below the agent's final answer
 * (DESIGN.md §4.3 Message Actions).
 *
 * V0.1 actions:
 *
 *   - Copy   → copies the raw markdown source to the clipboard.
 *              Markdown is what users want when pasting into Notion
 *              / Obsidian / Slack — those targets re-render the
 *              syntax. Pasting the visually-rendered text would
 *              throw away structure.
 *   - Save   → opens a Tauri save-as dialog and writes the markdown
 *              to disk. Default filename `galley-{timestamp}.md` so
 *              successive saves don't fight each other.
 *
 * Shown while its answer is hovered (2026-09-28): MessageAgent's
 * `group/answer` — the answer body plus this bar — is the hover
 * region. Until then the bar was always visible, per V0.1 dogfood
 * feedback that hover-only affordances make users hunt around. JC
 * found it noisy at times but fine under long answers: about 27% of
 * final answers are one or two lines, where the bar is as big as the
 * answer. Live-tested against the bar as it was, B (latest answer
 * always visible, older ones on hover) and C (always visible but
 * icon-only, numbers in the gauge's tooltip); JC picked hover as the
 * most comfortable. See devlog 2026-09-28-answer-action-bar-on-hover.
 * Hidden keeps its box (opacity, not unmount), so hovering never
 * shifts the layout; a copied / saved flash stays visible through its
 * 1.5s. No focus reveal: hover-only actions stay out of the Tab order
 * (2026-06-29 pointer-first focus rule), and the chips are
 * `tabIndex={-1}`.
 *
 * Icon-only (no "Copy" / "Save" text labels): text labels at the left
 * edge of the reading column visually competed with the next
 * paragraph — eyes parsed them as part of the prose. Matching
 * ChatGPT/Claude's icon-only convention removes that interference
 * while keeping affordances discoverable via tooltip + Phosphor's
 * widely-recognised Copy / FloppyDisk glyphs.
 *
 * State machine per button: idle → done (1.5s) → idle. Two refs
 * so timers can be cleared on unmount or rapid re-clicks.
 *
 * The assistant's replies take this bar their own way (`assistant`;
 * conversation.md 「助手的对话」, main chat PRD rulings 68, 99): icons
 * only — copy, quote, save, and under a reply of two steps or more the
 * process button, then ⋯ — and no numbers: no tokens (they head the
 * opened steps) and no context percentage (not drawn in the assistant's
 * conversation at all). While the steps are open the whole bar stays
 * visible, the process button pressed.
 *
 * Quote (main chat ticket 47, PRD ruling 99) is the menu's 引用 one click
 * away and runs the menu's own action (MessageQuoteButton): the whole
 * reply into the composer's quote strip, cut short when long. The bar
 * keeps the menu's order (copy, quote, save, the process), so copy stays
 * first under the hand and only the process, there under a reply of two
 * steps or more, comes and goes, last before ⋯. Exactly where the menu
 * has 引用 (`canQuote`): not under leaked tool-call markup
 * (`processOnly`: nothing to copy, nothing to quote), nor under a reply
 * with no words to quote (an image alone); not on the workbench's bar.
 *
 * The assistant's bar ends in ⋯ (main chat ticket 38, PRD ruling 85):
 * the reply's message menu, the same one a right-click on it opens
 * (MessageMenu) — copy, quote, save, the process, then delete. It is the
 * menu's findable door, and delete's only one (right-click is the quick
 * one), so it stays when quote joins the bar. While the menu is open the
 * bar stays visible, as it does for the open steps.
 */

interface MessageActionsProps {
  /** Markdown source to operate on. */
  source: string;
  telemetry?: MessageTelemetry;
  /** A reply in the assistant's conversation: icons only, `process`
   * for a reply of two steps or more (`processOnly` under leaked
   * tool-call markup, which has nothing to copy, quote or save).
   * Without it, the workbench's bar. */
  assistant?: { process?: AssistantProcessToggle; processOnly?: boolean };
  /** The reply's answer row: in the assistant's conversation, the quote
   * runs its message menu's 引用, and the ⋯ at the bar's end opens the
   * menu. */
  messageId?: string;
}

export function MessageActions({
  source,
  telemetry,
  assistant,
  messageId,
}: MessageActionsProps) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Cancel pending feedback resets if the message unmounts mid-flash.
  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("[MessageActions] copy failed", e);
    }
  };

  const onSave = async () => {
    try {
      // Cancelled in the dialog: silently noop.
      if (!(await saveReplyMarkdown(source))) return;
      setSaved(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      console.warn("[MessageActions] save failed", e);
    }
  };

  const process = assistant?.process;
  // The process button pressed keeps the bar up, as a copied / saved
  // flash does: pinning the button alone would leave it floating right
  // of two transparent chips that still hold their place.
  const hidden =
    !copied &&
    !saved &&
    !process?.open &&
    !menuOpen &&
    "pointer-events-none opacity-0 group-hover/answer:pointer-events-auto group-hover/answer:opacity-100";
  return (
    <div
      className={cn(
        "mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1",
        hidden,
      )}
    >
      <div className="flex items-center gap-0.5">
        {!assistant?.processOnly && (
          <>
            <ActionChip
              active={copied}
              idleIcon={<Copy size={14} weight="thin" />}
              activeIcon={<Check size={14} weight="bold" />}
              idleLabel={copy.conversation.copy}
              activeLabel={copy.conversation.copied}
              onClick={() => void onCopy()}
            />
            {/* The menu's 引用, its own action (ticket 47): the
                assistant's bar only, in the menu's order. */}
            {assistant && messageId && (
              <MessageQuoteButton messageId={messageId} />
            )}
            <ActionChip
              active={saved}
              idleIcon={<FloppyDisk size={14} weight="thin" />}
              activeIcon={<Check size={14} weight="bold" />}
              idleLabel={copy.conversation.save}
              activeLabel={copy.conversation.saved}
              onClick={() => void onSave()}
            />
          </>
        )}
        {process && (
          // The steps' disclosure (a chip, `tabIndex={-1}` like its
          // two neighbours): the fold header's words for its tooltip,
          // no numbers.
          <ActionChip
            active={false}
            expanded={process.open}
            idleIcon={<Footprints size={14} weight="thin" />}
            activeIcon={<Footprints size={14} weight="thin" />}
            idleLabel={
              process.open
                ? copy.conversation.foldCollapse
                : copy.conversation.foldExpand
            }
            activeLabel={copy.conversation.foldCollapse}
            onClick={process.onToggle}
          />
        )}
        {assistant && messageId && (
          <MessageMenuButton
            messageId={messageId}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
        )}
      </div>
      {!assistant && <AnswerTelemetry telemetry={telemetry} />}
    </div>
  );
}

/**
 * Machine-invoice line: tokens + context usage. Wall-clock time is
 * deliberately NOT here (conversation-run-fold, 2026-08-06): elapsed
 * is the one human-experienced number and lives with the step count
 * on the RunFoldHeader — the structure row where the live elapsed
 * counter already ticks. This line is what the run COST the machine;
 * the fold header is how LONG the run lived. Territory table in
 * `.scratch/conversation-run-fold/PRD.md`.
 *
 * Not under the assistant's replies (ruling 68): their ↑ ↓ head the
 * opened steps (TokenMetrics, in AssistantParts' first line), and the
 * context percentage is not drawn there — the assistant has no action
 * for it, and it would show the segment breaks the conversation hides.
 */
function AnswerTelemetry({
  telemetry,
}: {
  telemetry?: MessageTelemetry;
}) {
  const copy = useCopy();
  const input = formatCompactCount(telemetryInputTotal(telemetry));
  const output = formatCompactCount(telemetry?.outputTokens);
  const context = contextUsagePercentLabel(telemetry);
  const hasTelemetry = Boolean(input || output || context);

  if (!hasTelemetry) return null;

  const contextTokens = contextUsageTokens(telemetry);
  const contextTipText = contextTokens
    ? copy.conversation.telemetryContextTip(
        formatCompactCount(contextTokens.usedTokens) ?? "",
        formatCompactCount(contextTokens.limitTokens) ?? "",
        contextTokens.percentLabel,
      )
    : "";
  // Two-tier tooltip: the number, then a read-once note at the lowest ink
  // step. Separated by spacing rather than a smaller font — 11.5px CJK is
  // already at the floor for comfortable reading.
  const contextTip = contextTokens ? (
    <span className="flex flex-col gap-1.5 leading-tight">
      <span>{contextTipText}</span>
      <span className="text-ink-muted">
        {copy.conversation.telemetryContextNote}
      </span>
    </span>
  ) : (
    ""
  );

  return (
    <>
      <span className="h-3 w-px bg-line" aria-hidden="true" />
      <div
        className={[
          "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1",
          "text-[11.5px] leading-none text-ink-muted tracking-normal",
          "[font-variant-numeric:tabular-nums]",
        ].join(" ")}
      >
        <TokenMetrics telemetry={telemetry} />
        {context && (
          <TooltipLabel text={contextTip}>
            <Metric
              ariaLabel={contextTipText}
              icon={<Gauge size={12} weight="thin" />}
            >
              {context}
            </Metric>
          </TooltipLabel>
        )}
      </div>
    </>
  );
}

/**
 * The ↑ ↓ token counts with their tooltips: the machine invoice's
 * first two metrics, and the token segment of the assistant's process
 * card's first line (AssistantProcessCard). Nothing when neither count is known.
 * `valueClassName` inks the counts (the steps' first line lifts its
 * figures a rung).
 */
export function TokenMetrics({
  telemetry,
  valueClassName,
}: {
  telemetry?: MessageTelemetry | null;
  valueClassName?: string;
}) {
  const copy = useCopy();
  const input = formatCompactCount(telemetryInputTotal(telemetry));
  const output = formatCompactCount(telemetry?.outputTokens);
  if (!input && !output) return null;
  // The `↑` total folds cache reads in, which bill at ~0.1x fresh input —
  // without the split a cache-heavy turn reads as expensive when it is not.
  const cached = formatCompactCount(telemetryCachedInput(telemetry));
  const inputTip =
    input && cached
      ? copy.conversation.telemetryInputCachedTip(input, cached)
      : input
        ? copy.conversation.telemetryInputTip(input)
        : "";
  return (
    <>
      {input && (
        <TooltipLabel text={inputTip}>
          <Metric
            ariaLabel={inputTip}
            icon={<ArrowUp size={12} weight="thin" />}
            valueClassName={valueClassName}
          >
            {input}
          </Metric>
        </TooltipLabel>
      )}
      {output && (
        <TooltipLabel text={copy.conversation.telemetryOutputTip(output)}>
          <Metric
            ariaLabel={copy.conversation.telemetryOutputTip(output)}
            icon={<ArrowDown size={12} weight="thin" />}
            valueClassName={valueClassName}
          >
            {output}
          </Metric>
        </TooltipLabel>
      )}
    </>
  );
}

/** forwardRef + prop spread so Radix Tooltip's `asChild` trigger can
 * attach its ref and pointer/focus handlers — without them the tooltip
 * silently never opens. */
const Metric = forwardRef<
  HTMLSpanElement,
  {
    ariaLabel: string;
    icon: ReactNode;
    children: ReactNode;
    valueClassName?: string;
  } & HTMLAttributes<HTMLSpanElement>
>(function Metric({ ariaLabel, icon, children, valueClassName, ...rest }, ref) {
  return (
    <span
      ref={ref}
      aria-label={ariaLabel}
      className="inline-flex h-4 items-center gap-0.5 whitespace-nowrap align-middle"
      {...rest}
    >
      <span
        className="inline-flex size-3 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className={cn("leading-none", valueClassName)}>{children}</span>
    </span>
  );
});
