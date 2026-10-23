import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  LIVE_PROGRESS_VARIANT_NAMES,
  LIVE_PROGRESS_VARIANTS,
  useLiveProgressStore,
} from "./live-progress-variants";

/*
 * TEMP variant switcher (main chat 90) — see live-progress-variants.ts.
 */

const OPTION =
  "whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * The trial's pill (ruling 134): 「现状 / 新」, one click each, in memory,
 * at once — mid-round too, so one round can be watched both ways.
 * Portalled to <body> with `pointer-events: auto` above every overlay
 * tier, so an open menu or dialog never blocks it. It hangs under the
 * main header at the window's centre, where ticket 85's sat. Nothing
 * outside a dev build; App renders it while there is a main chat.
 */
export function LiveProgressVariantsPill() {
  const variant = useLiveProgressStore((s) => s.variant);
  const setVariant = useLiveProgressStore((s) => s.setVariant);
  if (!import.meta.env.DEV) return null;
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：在跑时的进展"
      data-role="live-progress-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 在跑</span>
      {LIVE_PROGRESS_VARIANTS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={variant === value}
          onClick={() => setVariant(value)}
          className={cn(
            OPTION,
            variant === value
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {LIVE_PROGRESS_VARIANT_NAMES[value]}
        </button>
      ))}
    </div>,
    document.body,
  );
}
