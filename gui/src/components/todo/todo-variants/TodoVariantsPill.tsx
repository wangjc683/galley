import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  DONE_LOOK_NAMES,
  DONE_LOOKS,
  DONE_SOURCE_NAMES,
  useTodoVariants,
  type DoneSource,
} from "./todo-variants";

/*
 * TEMP variant switcher (main chat 83) — see todo-variants.ts.
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

const SOURCES: readonly DoneSource[] = ["real", "demo"];

/**
 * The trial's pill (ruling 129 point 2): 「现状 / A 档位拉齐 / B 方框退色
 * / C 再整行 70%」 picks the look of 已完成 and done cards, 「真实 / 演示」
 * what 已完成 lists — one click each, in memory. Portalled to <body> with
 * `pointer-events: auto` above every overlay tier, so an open menu or
 * dialog never blocks it. It hangs under the main header at the
 * window's centre, ticket 42's spot: the earlier trials' spot under the
 * header's right end is where the open panel's close button sits.
 * Nothing outside a dev build; App renders it while there is a main
 * chat.
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
      aria-label="临时切换器：已完成的样子"
      data-role="todo-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 已完成</span>
      {DONE_LOOKS.map((value) => (
        <Option
          key={value}
          pressed={look === value}
          onClick={() => setLook(value)}
        >
          {DONE_LOOK_NAMES[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      {SOURCES.map((value) => (
        <Option
          key={value}
          pressed={source === value}
          onClick={() => setSource(value)}
        >
          {DONE_SOURCE_NAMES[value]}
        </Option>
      ))}
    </div>,
    document.body,
  );
}
