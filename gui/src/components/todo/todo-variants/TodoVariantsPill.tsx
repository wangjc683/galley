import { useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  DONE_VARIANTS,
  PANEL_WIDTH,
  ROW_VARIANTS,
  WIDTH_VARIANTS,
  useTodoVariants,
  type DoneVariant,
  type RowVariant,
  type WidthVariant,
} from "./todo-variants";

const ROW_NAMES: Record<RowVariant, string> = {
  A1: "独立一行",
  A2: "卡片下小字",
  A3: "卡片网格",
};

const DONE_NAMES: Record<DoneVariant, string> = {
  C1: "删除线",
  C2: "再整行淡",
};

function Option<T extends string>({
  value,
  current,
  label,
  onPick,
}: {
  value: T;
  current: T;
  label: string;
  onPick: (value: T) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      onClick={() => onPick(value)}
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        current === value
          ? "bg-selected text-ink"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

/**
 * TEMP variant switcher (main chat 42) — the always-clickable pill (see
 * todo-variants.ts). Closed it says the three choices, 「临时 · 待办 A1
 * B1 C1」; a click opens a line per question, another closes it.
 * Portalled to <body> with `pointer-events: auto` above every overlay
 * tier, so an open menu or dialog never blocks it. It hangs under the
 * main header at the window's centre: the earlier trials' spot, under
 * the header's right end, is where the open panel's close button sits.
 * App renders it while there is a main chat.
 */
export function TodoVariantsPill() {
  const { row, width, done, set } = useTodoVariants();
  const [open, setOpen] = useState(false);
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：待办的三处视觉"
      data-role="todo-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 flex-col items-center gap-1 text-[11px] text-ink-soft"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="whitespace-nowrap rounded-full border border-dashed border-warning/70 bg-elevated px-2.5 py-0.5 font-medium shadow-card outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {`临时 · 待办 ${row} ${width} ${done}`}
      </button>
      {open && (
        <div className="flex flex-col gap-1 rounded-xl border border-dashed border-warning/70 bg-elevated p-1.5 shadow-card">
          <div className="flex items-center gap-0.5">
            <span className="w-14 shrink-0 px-1 text-ink-muted">A 那一行</span>
            {ROW_VARIANTS.map((value) => (
              <Option
                key={value}
                value={value}
                current={row}
                label={`${value} ${ROW_NAMES[value]}`}
                onPick={(v: RowVariant) => set({ row: v })}
              />
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <span className="w-14 shrink-0 px-1 text-ink-muted">B 面板宽</span>
            {WIDTH_VARIANTS.map((value) => (
              <Option
                key={value}
                value={value}
                current={width}
                label={`${value} ${PANEL_WIDTH[value]}px`}
                onPick={(v: WidthVariant) => set({ width: v })}
              />
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <span className="w-14 shrink-0 px-1 text-ink-muted">C 已完成</span>
            {DONE_VARIANTS.map((value) => (
              <Option
                key={value}
                value={value}
                current={done}
                label={`${value} ${DONE_NAMES[value]}`}
                onPick={(v: DoneVariant) => set({ done: v })}
              />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
