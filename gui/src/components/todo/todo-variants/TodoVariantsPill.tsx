import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  DENSITY_LOOK_NAMES,
  DENSITY_LOOKS,
  TODO_SOURCE_NAMES,
  useTodoVariants,
  type TodoSource,
} from "./todo-variants";

/*
 * TEMP variant switcher (main chat 85) — see todo-variants.ts.
 */

const OPTION =
  "whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

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

const SOURCES: readonly TodoSource[] = ["real", "demo"];

/**
 * The trial's pill (ruling 130): 「现状 / B 不分组 / B+C 组名收紧」 picks
 * the panel's density, 「真实 / 演示」 what it lists — one click each, in
 * memory. Portalled to <body> with `pointer-events: auto` above every
 * overlay tier, so an open menu or dialog never blocks it. It hangs
 * under the main header at the window's centre, where ticket 83's sat
 * without covering anything: under the header's right end is the open
 * panel's close button. Nothing outside a dev build; App renders it
 * while there is a main chat.
 */
export function TodoVariantsPill() {
  const look = useTodoVariants((s) => s.look);
  const source = useTodoVariants((s) => s.source);
  const setLook = useTodoVariants((s) => s.setLook);
  const setSource = useTodoVariants((s) => s.setSource);
  if (!import.meta.env.DEV) return null;
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：待办面板的密度"
      data-role="todo-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 密度</span>
      {DENSITY_LOOKS.map((value) => (
        <Option
          key={value}
          pressed={look === value}
          onClick={() => setLook(value)}
        >
          {DENSITY_LOOK_NAMES[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      {SOURCES.map((value) => (
        <Option
          key={value}
          pressed={source === value}
          onClick={() => setSource(value)}
        >
          {TODO_SOURCE_NAMES[value]}
        </Option>
      ))}
    </div>,
    document.body,
  );
}
