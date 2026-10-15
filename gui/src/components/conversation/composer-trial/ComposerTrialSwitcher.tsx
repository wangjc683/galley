import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  COMPOSER_SHAPES,
  type ComposerShape,
  useComposerTrialStore,
} from "./composer-trial";

const LABELS: Record<ComposerShape, string> = {
  current: "现状",
  line: "一行式",
};

const OPTION =
  "whitespace-nowrap rounded-full px-2 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

function Option({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        OPTION,
        pressed
          ? "bg-selected text-ink"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * TEMPORARY — the always-clickable pill of the composer trial (ticket
 * 24; see composer-trial.ts): 「临时 · 输入框」, then 现状｜一行式 and a
 * 「演示在跑」 toggle, all on one line (two choices need no panel).
 * Portalled to <body> with `pointer-events: auto` above every overlay
 * tier, so an open menu or dialog never blocks it. It hangs under the
 * main header's right end, where tickets 17 and 19 put theirs — clear of
 * the header buttons, the composer and 「回到底部」. App renders it only
 * while the main chat is open in the main area (the managed runtime).
 */
export function ComposerTrialSwitcher() {
  const { shape, demoRunning, setShape, setDemoRunning } =
    useComposerTrialStore();
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：主对话的输入框"
      data-role="composer-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-[11px] text-ink-soft shadow-card"
    >
      <span className="shrink-0 select-none pr-0.5">临时 · 输入框</span>
      {COMPOSER_SHAPES.map((value) => (
        <Option
          key={value}
          pressed={shape === value}
          onClick={() => setShape(value)}
        >
          {LABELS[value]}
        </Option>
      ))}
      <span aria-hidden className="select-none text-ink-muted/60">
        ·
      </span>
      <Option
        pressed={demoRunning}
        onClick={() => setDemoRunning(!demoRunning)}
      >
        演示在跑
      </Option>
    </div>,
    document.body,
  );
}
