import { createPortal } from "react-dom";

import { replayFlight } from "@/lib/todo-flight-run";
import { cn } from "@/lib/utils";

import {
  TODO_BUTTON_DEMO_NAMES,
  TODO_BUTTON_DEMOS,
  TODO_BUTTON_LOOK_NAMES,
  TODO_BUTTON_LOOKS,
  useTodoButtonVariants,
} from "./todo-button-variants";

/*
 * TEMP variant switcher (main chat 104) — see todo-button-variants.ts.
 */

const OPTION =
  "whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

const ROW =
  "flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card";

function Option({
  pressed,
  onClick,
  children,
}: {
  pressed?: boolean;
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
 * The trial's pill (ruling 150 point 8), two rows: 「甲 / 丁 / 戊2 / 戊」
 * picks what the top bar's 待办 button shows, kept on this machine;
 * 「当作没认识」 shows 丁 as if the panel had never been met; 「重放」 flies
 * the last reply's cards into the button (`replayFlight`); under it the
 * seven demos, in memory. Where tickets 102's and 103's hung — under the
 * main header at the window's centre, clear of the flight's way to the
 * button — portalled to <body> with `pointer-events: auto` above every
 * overlay tier. Nothing outside a dev build; App renders it while there
 * is a main chat.
 */
export function TodoButtonVariantsPill() {
  const look = useTodoButtonVariants((s) => s.look);
  const demo = useTodoButtonVariants((s) => s.demo);
  const pretendNew = useTodoButtonVariants((s) => s.pretendNew);
  const setLook = useTodoButtonVariants((s) => s.setLook);
  const setDemo = useTodoButtonVariants((s) => s.setDemo);
  const setPretendNew = useTodoButtonVariants((s) => s.setPretendNew);
  if (!import.meta.env.DEV) return null;
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：顶栏的待办按钮"
      data-role="todo-button-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 flex-col items-center gap-1.5"
    >
      <div className={ROW}>
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
        <Option pressed={pretendNew} onClick={() => setPretendNew(!pretendNew)}>
          当作没认识
        </Option>
        <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
        <Option onClick={() => replayFlight()}>重放</Option>
      </div>
      <div className={ROW}>
        <span className="select-none whitespace-nowrap">演示</span>
        {TODO_BUTTON_DEMOS.map((value) => (
          <Option
            key={value}
            pressed={demo === value}
            onClick={() => setDemo(value)}
          >
            {TODO_BUTTON_DEMO_NAMES[value]}
          </Option>
        ))}
      </div>
    </div>,
    document.body,
  );
}
