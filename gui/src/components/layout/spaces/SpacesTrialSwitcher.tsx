import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import {
  SPACES_TRIAL_VARIANTS,
  type SpacesTrialVariant,
  useSpacesTrialStore,
} from "@/lib/spaces-trial";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

const LABELS: Record<SpacesTrialVariant, string> = {
  现状: "现状",
  乙: "乙 左上开关",
  甲: "甲 图标栏",
};

/**
 * TEMPORARY — the always-clickable pill for the spaces trial (ticket 16;
 * see lib/spaces-trial.ts). Portalled to <body> with
 * `pointer-events-auto` above every overlay tier, so an open dialog or
 * menu (Radix sets `pointer-events: none` on the body) never blocks it.
 * It hangs just under the header strip, centred: clear of 乙's switch,
 * 甲's rail and every header button at any width. Only while a main chat
 * exists (the external runtime has no trial). 「演示」 shows an unread
 * assistant and an asking conversation where nothing real does.
 */
export function SpacesTrialSwitcher() {
  const variant = useSpacesTrialStore((s) => s.variant);
  const setVariant = useSpacesTrialStore((s) => s.setVariant);
  const demo = useSpacesTrialStore((s) => s.demo);
  const setDemo = useSpacesTrialStore((s) => s.setDemo);
  const hasMainChat = useSessionsStore(
    (s) =>
      !!findMainChat(
        s.sessions.filter((session) => session.status !== "archived"),
      ),
  );
  if (!hasMainChat) return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：两个空间"
      data-role="spaces-trial-pill"
      className="pointer-events-auto fixed left-1/2 top-[50px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 两个空间</span>
      {SPACES_TRIAL_VARIANTS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={variant === option}
          onClick={() => setVariant(option)}
          className={cn(
            "whitespace-nowrap rounded-full px-2 py-0.5 font-medium",
            variant === option
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {LABELS[option]}
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-3.5 w-px bg-line" />
      <button
        type="button"
        aria-pressed={demo}
        onClick={() => setDemo(!demo)}
        className={cn(
          "whitespace-nowrap rounded-full px-2 py-0.5 font-medium",
          demo
            ? "bg-selected text-ink"
            : "text-ink-muted hover:bg-hover hover:text-ink",
        )}
      >
        演示
      </button>
    </div>,
    document.body,
  );
}
