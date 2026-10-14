import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

import {
  SIDEBAR_TOP_DEMOS,
  SIDEBAR_TOP_VARIANTS,
  type SidebarTopVariant,
  useSidebarTopTrialStore,
} from "./sidebar-top-trial";

const LABELS: Record<SidebarTopVariant, string> = {
  现状: "现状",
  "2": "2 书眉即助手",
  "3": "3 卡片",
  "3′": "3′ 大头像",
};

const OPTION =
  "whitespace-nowrap rounded-full px-2 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * TEMPORARY — the always-clickable pill for the sidebar-top trial
 * (ticket 17; see sidebar-top-trial.ts): the four variants, then
 * 「演示」's four states. Portalled to <body> with `pointer-events-auto`
 * above every overlay tier, so an open dialog or menu (Radix sets
 * `pointer-events: none` on the body) never blocks it. It hangs under
 * the main header's right end: clear of the sidebar's top, which is
 * what is being compared, and of every header button. Only while a
 * main chat exists (the external runtime has no trial).
 */
export function SidebarTopTrialSwitcher() {
  const variant = useSidebarTopTrialStore((s) => s.variant);
  const setVariant = useSidebarTopTrialStore((s) => s.setVariant);
  const demo = useSidebarTopTrialStore((s) => s.demo);
  const setDemo = useSidebarTopTrialStore((s) => s.setDemo);
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
      aria-label="临时切换器：侧栏上半块"
      data-role="sidebar-top-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 侧栏上半块</span>
      {SIDEBAR_TOP_VARIANTS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={variant === option}
          onClick={() => setVariant(option)}
          className={cn(
            OPTION,
            variant === option
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {LABELS[option]}
        </button>
      ))}
      <span aria-hidden className="mx-0.5 h-3.5 w-px bg-line" />
      <span className="select-none whitespace-nowrap">演示</span>
      {SIDEBAR_TOP_DEMOS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={demo === option}
          onClick={() => setDemo(option)}
          className={cn(
            OPTION,
            demo === option
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
