import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FloppyDisk,
  Gauge,
} from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import {
  contextUsagePercentLabel,
  contextUsageTokens,
  formatCompactCount,
  telemetryCachedInput,
  telemetryInputTotal,
} from "@/lib/telemetry";
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
 * Always-visible (not hover-only): per dogfood feedback, hover-only
 * affordances make users hunt around. The buttons are muted enough
 * that they recede during reading and surface on intent.
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
 */

interface MessageActionsProps {
  /** Markdown source to operate on. */
  source: string;
  telemetry?: MessageTelemetry;
}

export function MessageActions({ source, telemetry }: MessageActionsProps) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
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
    // Default filename `galley-{timestamp}.md` — the product name, not
    // "ga" (GA is reserved for the engine per the naming rules; image
    // saves already used galley-). Timestamp keeps successive saves
    // from clobbering each other; user can edit in the dialog before
    // confirming.
    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, "")
      // YYYYMMDDhhmmss is hard to scan; insert one dash between date
      // and time so the default name reads cleanly.
      .replace(/^(\d{8})(\d{6})$/, "$1-$2");
    const defaultName = `galley-${stamp}.md`;

    try {
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      // User cancelled: save() resolves to null. Silently noop.
      if (!path) return;
      await writeTextFile(path, source);
      setSaved(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      console.warn("[MessageActions] save failed", e);
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <div className="flex items-center gap-0.5">
        <ActionChip
          active={copied}
          idleIcon={<Copy size={14} weight="thin" />}
          activeIcon={<Check size={14} weight="bold" />}
          idleLabel={copy.conversation.copy}
          activeLabel={copy.conversation.copied}
          onClick={() => void onCopy()}
        />
        <ActionChip
          active={saved}
          idleIcon={<FloppyDisk size={14} weight="thin" />}
          activeIcon={<Check size={14} weight="bold" />}
          idleLabel={copy.conversation.save}
          activeLabel={copy.conversation.saved}
          onClick={() => void onSave()}
        />
      </div>
      <AnswerTelemetry telemetry={telemetry} />
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

  // The `↑` total folds cache reads in, which bill at ~0.1x fresh input —
  // without the split a cache-heavy turn reads as expensive when it is not.
  const cached = formatCompactCount(telemetryCachedInput(telemetry));
  const inputTip =
    input && cached
      ? copy.conversation.telemetryInputCachedTip(input, cached)
      : input
        ? copy.conversation.telemetryInputTip(input)
        : "";
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
        {input && (
          <TooltipLabel text={inputTip}>
            <Metric
              ariaLabel={inputTip}
              icon={<ArrowUp size={12} weight="thin" />}
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
            >
              {output}
            </Metric>
          </TooltipLabel>
        )}
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

/** forwardRef + prop spread so Radix Tooltip's `asChild` trigger can
 * attach its ref and pointer/focus handlers — without them the tooltip
 * silently never opens. */
const Metric = forwardRef<
  HTMLSpanElement,
  {
    ariaLabel: string;
    icon: ReactNode;
    children: ReactNode;
  } & HTMLAttributes<HTMLSpanElement>
>(function Metric({ ariaLabel, icon, children, ...rest }, ref) {
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
      <span className="leading-none">{children}</span>
    </span>
  );
});
