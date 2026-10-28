import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  TODO_BUTTON_DEMO_NAMES,
  TODO_BUTTON_DEMOS,
  TODO_BUTTON_LOOK_NAMES,
  TODO_BUTTON_LOOKS,
  useTodoButtonVariants,
} from "./todo-button-variants";

/*
 * TEMP variant switcher (main chat 103) — see todo-button-variants.ts.
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

/**
 * The trial's pill (ruling 148): 「现状 / 甲 / 乙 / 丙」 picks where the
 * top bar's 待办 button stands and what it shows, kept on this machine;
 * 「真实 / 今天 2 / 没有今天」 the count it shows, in memory. A second
 * pill under ticket 102's 「飞入」 one (top 52px) at the window's centre,
 * the same form, not overlapping it, so either trial can go on its own.
 * Portalled to <body> with `pointer-events: auto` above every overlay
 * tier. Nothing outside a dev build; App renders it while there is a
 * main chat.
 */
export function TodoButtonVariantsPill() {
  const look = useTodoButtonVariants((s) => s.look);
  const demo = useTodoButtonVariants((s) => s.demo);
  const setLook = useTodoButtonVariants((s) => s.setLook);
  const setDemo = useTodoButtonVariants((s) => s.setDemo);
  if (!import.meta.env.DEV) return null;
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：顶栏的待办按钮"
      data-role="todo-button-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[80px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 顶栏</span>
      {TODO_BUTTON_LOOKS.map((value) => (
        <Option
          key={value}
          pressed={look === value}
          onClick={() => setLook(value)}
        >
          {TODO_BUTTON_LOOK_NAMES[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      {TODO_BUTTON_DEMOS.map((value) => (
        <Option
          key={value}
          pressed={demo === value}
          onClick={() => setDemo(value)}
        >
          {TODO_BUTTON_DEMO_NAMES[value]}
        </Option>
      ))}
    </div>,
    document.body,
  );
}
