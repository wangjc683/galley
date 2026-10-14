import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

import {
  NEW_CHAT_TRIAL_VARIANTS,
  type NewChatTrialVariant,
  useNewChatTrialStore,
} from "./new-chat-trial";

const LABELS: Record<NewChatTrialVariant, string> = {
  现状: "现状",
  B: "B 亮加号",
  A: "A 落点",
};

/**
 * TEMPORARY — the always-clickable pill for the new-chat placeholder
 * trial (ticket 13; see `new-chat-trial.ts`). Portalled to <body> with
 * `pointer-events-auto` above every overlay tier, so an open dialog or
 * menu (Radix sets `pointer-events: none` on the body) never blocks it.
 * Sits in the empty middle of the header strip. Only while a main chat
 * exists: the external runtime has no trial.
 */
export function NewChatTrialSwitcher() {
  const variant = useNewChatTrialStore((s) => s.variant);
  const setVariant = useNewChatTrialStore((s) => s.setVariant);
  const hasMainChat = useSessionsStore((s) => !!findMainChat(s.sessions));
  if (!hasMainChat) return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：新对话占位"
      className="pointer-events-auto fixed left-1/2 top-[9px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 新对话占位</span>
      {NEW_CHAT_TRIAL_VARIANTS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={variant === option}
          onClick={() => setVariant(option)}
          className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            variant === option
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>,
    document.body,
  );
}
