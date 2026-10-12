import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

import {
  SECTION_BELONGINGS,
  useSectionBelongingStore,
} from "./section-belonging-trial";

/**
 * TEMPORARY — the always-clickable pill for the section-belonging trial
 * (main chat ticket 09): C1 / C2 / C3 (see `section-belonging-trial.ts`
 * for what each means and the removal steps). Portalled to <body> with
 * `pointer-events-auto` above every overlay tier, so an open dialog or
 * menu (Radix sets `pointer-events: none` on the body) never blocks it.
 * Sits in the empty middle of the header strip. Only while a main chat
 * exists: the external runtime has none, and there all variants are the
 * same.
 */
export function SectionBelongingSwitcher() {
  const belonging = useSectionBelongingStore((s) => s.belonging);
  const setBelonging = useSectionBelongingStore((s) => s.setBelonging);
  const hasMainChat = useSessionsStore((s) => !!findMainChat(s.sessions));
  if (!hasMainChat) return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：「其他对话」归属感"
      className="pointer-events-auto fixed left-1/2 top-[9px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 归属</span>
      {SECTION_BELONGINGS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={belonging === option}
          onClick={() => setBelonging(option)}
          className={cn(
            "rounded-full px-2 py-0.5 font-medium tabular-nums",
            belonging === option
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {option}
        </button>
      ))}
    </div>,
    document.body,
  );
}
