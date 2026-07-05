import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Copy,
  FloppyDisk,
  Gauge,
} from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import { useCopy } from "@/lib/i18n";
import {
  contextUsageLabel,
  formatCompactCount,
  formatElapsedCompact,
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

function AnswerTelemetry({
  telemetry,
}: {
  telemetry?: MessageTelemetry;
}) {
  const elapsed = formatElapsedCompact(telemetry?.elapsedMs);
  const input = formatCompactCount(telemetryInputTotal(telemetry));
  const output = formatCompactCount(telemetry?.outputTokens);
  const context = contextUsageLabel(telemetry);
  const hasTelemetry = Boolean(elapsed || input || output || context);

  if (!hasTelemetry) return null;

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
        {elapsed && (
          <Metric
            ariaLabel={`elapsed ${elapsed}`}
            icon={<Clock size={12} weight="thin" />}
          >
            {elapsed}
          </Metric>
        )}
        {input && (
          <Metric
            ariaLabel={`input ${input}`}
            icon={<ArrowUp size={12} weight="thin" />}
          >
            {input}
          </Metric>
        )}
        {output && (
          <Metric
            ariaLabel={`output ${output}`}
            icon={<ArrowDown size={12} weight="thin" />}
          >
            {output}
          </Metric>
        )}
        {context && (
          <Metric
            ariaLabel={`context ${context}`}
            icon={<Gauge size={12} weight="thin" />}
          >
            {context}
          </Metric>
        )}
      </div>
    </>
  );
}

function Metric({
  ariaLabel,
  icon,
  children,
}: {
  ariaLabel: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className="inline-flex h-4 items-center gap-0.5 whitespace-nowrap align-middle"
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
}
