import { createPortal } from "react-dom";

import { replayFlight } from "@/lib/todo-flight-run";
import { cn } from "@/lib/utils";

import {
  FLIGHT_FORM_NAMES,
  FLIGHT_FORMS,
  FLIGHT_LEVELS,
  FLIGHT_MAGNITUDE_NAMES,
  FLIGHT_MAGNITUDES,
  useFlightVariants,
} from "./flight-variants";

/*
 * TEMP variant switcher (main chat 102) — see flight-variants.ts.
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
 * The trial's pill (ruling 147 point 6): 「现状 / 只 pop / 飞 + pop」
 * picks the form, 「大 / 中 / 小」 the size, each one click and kept on
 * this machine; 「重放」 flies the last reply's cards at the pick
 * (`replayFlight`). Portalled to <body> with `pointer-events: auto`
 * above every overlay tier, so an open menu or dialog never blocks it,
 * where ticket 85's hung — under the main header at the window's
 * centre, clear of the flight's way to the button at the top right.
 * Nothing outside a dev build; App renders it while there is a main
 * chat.
 */
export function FlightVariantsPill() {
  const form = useFlightVariants((s) => s.form);
  const magnitude = useFlightVariants((s) => s.magnitude);
  const set = useFlightVariants((s) => s.set);
  if (!import.meta.env.DEV) return null;
  // A static render (tests) has no <body> to portal to.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：记下时飞进待办按钮"
      data-role="flight-variants-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[52px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 飞入</span>
      {FLIGHT_FORMS.map((value) => (
        <Option
          key={value}
          pressed={form === value}
          onClick={() => set({ form: value })}
        >
          {FLIGHT_FORM_NAMES[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      {FLIGHT_MAGNITUDES.map((value) => (
        <Option
          key={value}
          pressed={magnitude === value}
          onClick={() => set({ magnitude: value })}
        >
          {FLIGHT_MAGNITUDE_NAMES[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      <button
        type="button"
        data-role="flight-replay"
        onClick={() => replayFlight(form, FLIGHT_LEVELS[magnitude])}
        className={cn(OPTION, "text-ink-muted hover:bg-hover hover:text-ink")}
      >
        重放
      </button>
    </div>,
    document.body,
  );
}
