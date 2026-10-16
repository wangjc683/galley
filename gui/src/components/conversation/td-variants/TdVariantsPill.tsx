import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  CORNER_PX,
  CORNER_VARIANTS,
  type CornerVariant,
  GROW_VARIANTS,
  type GrowVariant,
  MESSAGE_QUOTES_VARIANTS,
  QUOTE_STRIP_VARIANTS,
  useTdVariants,
} from "./td-variants";

const GROW_LABELS: Record<GrowVariant, string> = {
  1: "1 瞬间",
  2: "2 100ms",
  3: "3 按距离",
};

// TEMP variant switcher (telegram-details 07)
const STRIP_LABELS = { 1: "1 竖线两行", 2: "2 ↳ 一行" } as const;
const BUBBLE_LABELS = { 1: "1 气泡外上方", 2: "2 气泡内顶部" } as const;

function cornerLabel(variant: CornerVariant): string {
  return `${variant} ${CORNER_PX[variant] ?? 12}px`;
}

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-[6em] shrink-0 select-none text-ink-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * TEMP variant switcher (telegram-details 05) — the always-clickable
 * pill (see td-variants.ts). Closed it says the choices,
 * 「临时 · A1 B1 C1 D1」 (C and D since telegram-details 07, the
 * quotes); a click opens the options under it, another closes
 * them. Portalled to <body> with `pointer-events: auto` above every
 * overlay tier, so an open menu or dialog never blocks it. It hangs
 * under the main header, 48px in from the right edge: clear of the
 * header's buttons, of the workbench's question rail (12px in, 20px
 * wide), of the composer and of 「回到底部」. MainView renders it, so it
 * shows in every session; B and its demo only act in the main chat, C
 * and D in both conversations.
 */
export function TdVariantsPill() {
  const {
    grow,
    corners,
    demo,
    strip,
    bubble,
    setGrow,
    setCorners,
    setDemo,
    setStrip,
    setBubble,
  } = useTdVariants();
  const [open, setOpen] = useState(false);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：输入框长高、连发圆角、引用"
      data-role="td-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-12 top-[50px] z-[1000] flex flex-col items-end gap-1 text-[11px] text-ink-soft"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full border border-dashed border-warning/70 bg-elevated px-2.5 py-0.5 font-medium shadow-card outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {`临时 · A${grow} B${corners} C${strip} D${bubble}${demo ? " · 演示" : ""}`}
      </button>
      {open && (
        <div className="flex flex-col gap-1 rounded-xl border border-dashed border-warning/70 bg-elevated p-1.5 shadow-card">
          <Row label="A 长高">
            {GROW_VARIANTS.map((value) => (
              <Option
                key={value}
                pressed={grow === value}
                onClick={() => setGrow(value)}
              >
                {GROW_LABELS[value]}
              </Option>
            ))}
          </Row>
          <Row label="B 连发圆角">
            {CORNER_VARIANTS.map((value) => (
              <Option
                key={value}
                pressed={corners === value}
                onClick={() => setCorners(value)}
              >
                {cornerLabel(value)}
              </Option>
            ))}
          </Row>
          <Row label="">
            <Option pressed={demo} onClick={() => setDemo(!demo)}>
              演示连发（主对话，只显示）
            </Option>
          </Row>
          {/* TEMP variant switcher (telegram-details 07) */}
          <Row label="C 引用条">
            {QUOTE_STRIP_VARIANTS.map((value) => (
              <Option
                key={value}
                pressed={strip === value}
                onClick={() => setStrip(value)}
              >
                {STRIP_LABELS[value]}
              </Option>
            ))}
          </Row>
          <Row label="D 气泡引用">
            {MESSAGE_QUOTES_VARIANTS.map((value) => (
              <Option
                key={value}
                pressed={bubble === value}
                onClick={() => setBubble(value)}
              >
                {BUBBLE_LABELS[value]}
              </Option>
            ))}
          </Row>
        </div>
      )}
    </div>,
    document.body,
  );
}
