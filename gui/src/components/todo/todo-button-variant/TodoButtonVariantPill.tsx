import { useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  TODO_BUTTON_VARIANTS,
  useTodoButtonVariant,
  type TodoButtonVariant,
} from "./todo-button-variant";

const NAMES: Record<TodoButtonVariant, string> = {
  D1: "图标加数字",
  D2: "图标加「待办」加数字",
};

/**
 * TEMP variant switcher (main-chat 45) — the always-clickable pill (see
 * todo-button-variant.ts). Closed it says the choice, 「临时 · 待办按钮
 * D1」; a click opens the two options, another closes it. Portalled to
 * <body> with `pointer-events: auto` above every overlay tier, so an
 * open menu or dialog never blocks it. It hangs under the main header at
 * the window's centre, as ticket 42's did: under the header's right end
 * is the button it compares, and the open panel's close button. App
 * renders it while there is a main chat.
 */
export function TodoButtonVariantPill() {
  const { variant, set } = useTodoButtonVariant();
  const [open, setOpen] = useState(false);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：待办按钮的样子"
      data-role="todo-button-variant-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 flex-col items-center gap-1 text-[11px] text-ink-soft"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full border border-dashed border-warning/70 bg-elevated px-2.5 py-0.5 font-medium shadow-card outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {`临时 · 待办按钮 ${variant}`}
      </button>
      {open && (
        <div className="flex items-center gap-0.5 rounded-xl border border-dashed border-warning/70 bg-elevated p-1.5 shadow-card">
          {TODO_BUTTON_VARIANTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={variant === value}
              onClick={() => set(value)}
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                variant === value
                  ? "bg-selected text-ink"
                  : "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              {`${value} ${NAMES[value]}`}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
