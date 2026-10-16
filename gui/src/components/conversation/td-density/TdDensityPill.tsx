import { useState } from "react";
import { createPortal } from "react-dom";

import type { ConversationFontSize } from "@/lib/conversation-font-size";
import { cn } from "@/lib/utils";

import {
  BUBBLE_DENSITY,
  DENSITY_VARIANTS,
  type DensityVariant,
  useTdDensity,
} from "./td-density";

const NAMES: Record<DensityVariant, string> = {
  0: "现状",
  1: "收行距",
  2: "降字号",
  3: "都收",
};

function label(variant: DensityVariant, tier: ConversationFontSize): string {
  const { size, leading, gap } = BUBBLE_DENSITY[variant][tier];
  return `V${variant} ${NAMES[variant]} ${size} / ${leading} / ${gap}`;
}

/**
 * TEMP variant switcher (telegram-details 10) — the always-clickable pill
 * (see td-density.ts). Closed it says the option, as in 「临时 · 气泡 V0」
 * — a click opens the four under it, each with its values at the current
 * reading tier (size px / leading / paragraph gap px), so ⌘= / ⌘− show
 * up in the labels; another click closes them. Portalled to <body> with
 * `pointer-events: auto` above every overlay tier, so an open menu or
 * dialog never blocks it. It hangs under the main header's right end,
 * where the earlier trials put theirs, clear of the header's buttons, the
 * composer and 「回到底部」. MainView renders it in the main chat only.
 */
export function TdDensityPill({ tier }: { tier: ConversationFontSize }) {
  const { variant, setVariant } = useTdDensity();
  const [open, setOpen] = useState(false);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：主对话气泡里的字号、行距、段距"
      data-role="td-density-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex flex-col items-end gap-1 text-[11px] text-ink-soft"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full border border-dashed border-warning/70 bg-elevated px-2.5 py-0.5 font-medium shadow-card outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {`临时 · 气泡 V${variant}`}
      </button>
      {open && (
        <div className="flex flex-col items-stretch gap-0.5 rounded-xl border border-dashed border-warning/70 bg-elevated p-1.5 shadow-card">
          {DENSITY_VARIANTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={variant === value}
              onClick={() => setVariant(value)}
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-left font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                variant === value
                  ? "bg-selected text-ink"
                  : "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              {label(value, tier)}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
