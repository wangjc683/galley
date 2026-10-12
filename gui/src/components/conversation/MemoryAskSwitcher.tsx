import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

import {
  MEMORY_ASK_FORMS,
  MEMORY_TRIAL_ENABLED,
  useMemoryAskTrialStore,
} from "./memory-ask-trial";

/**
 * TEMPORARY — the always-clickable pill for the main chat memory-ask
 * trial (ticket 04b): form A / B and 演示数据 (see `memory-ask-trial.ts`
 * for what each means and the removal steps). Portalled to <body> with
 * `pointer-events-auto` above every overlay tier, so an open dialog or
 * menu (Radix sets `pointer-events: none` on the body) never blocks it —
 * the demo data is for Settings → Memory, which is a dialog. Sits in the
 * empty middle of the header strip. Development builds only, and only
 * while a main chat exists (the external runtime has neither the ask nor
 * the page).
 */
export function MemoryAskSwitcher() {
  const form = useMemoryAskTrialStore((s) => s.form);
  const demo = useMemoryAskTrialStore((s) => s.demo);
  const setForm = useMemoryAskTrialStore((s) => s.setForm);
  const setDemo = useMemoryAskTrialStore((s) => s.setDemo);
  const hasMainChat = useSessionsStore((s) => !!findMainChat(s.sessions));
  if (!MEMORY_TRIAL_ENABLED || !hasMainChat) return null;
  const option = (active: boolean) =>
    cn(
      "rounded-full px-2 py-0.5 font-medium",
      active
        ? "bg-selected text-ink"
        : "text-ink-muted hover:bg-hover hover:text-ink",
    );
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：主对话里的记忆询问"
      className="pointer-events-auto fixed left-1/2 top-[9px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 记忆询问</span>
      {MEMORY_ASK_FORMS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={form === value}
          onClick={() => setForm(value)}
          className={cn(option(form === value), "tabular-nums")}
        >
          {value}
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      <button
        type="button"
        aria-pressed={demo}
        onClick={() => setDemo(!demo)}
        className={option(demo)}
      >
        演示数据
      </button>
    </div>,
    document.body,
  );
}
