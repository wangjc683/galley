import { create } from "zustand";

import type { FlightForm, FlightLevel } from "@/lib/todo-flight";

/**
 * TEMP variant switcher (main chat 102) — how a card noted under a
 * reply reaches the top bar's 「待办」 button, compared live in tauri dev
 * (main chat PRD ruling 147 point 6). JC picks on the pill
 * (FlightVariantsPill.tsx); a ticket after the ruling writes the pick in
 * and removes the rest.
 *
 *   形态  现状     nothing flies, nothing pops (today)
 *         只 pop   the button pops as the card appears
 *         飞 + pop the card's glyph arcs into the button, which pops as
 *                  it lands (default)
 *   幅度  大  the arc's control point 160px up, the glyph 24px halfway,
 *             700ms; the pop to 1.25 (default: the big one first, JC
 *             pulls it back)
 *         中  100px, 20px, 560ms; 1.15
 *         小  60px, 16px (not grown), 450ms; 1.08
 *
 * The ticket gives 中 and 小 a duration beside the pop's scale (「pop
 * 1.15、560ms」); read as the flight's, the counterpart of 大's 700ms —
 * the pop keeps `sidebar-state-pop`'s ~440ms at every level.
 *
 * 「重放」 flies the cards of the main chat's last reply that has any, at
 * the current pick, the panel open or not (lib/todo-flight-run.ts
 * `replayFlight`); with no card on screen, one box from the composer's
 * left end. The pick is a per-machine convenience kept in localStorage
 * (`galley.tmp.todoFlight`, reads and writes wrapped, the key spelt as
 * the earlier switchers' `galley.tmp.*`), never in Core; a production
 * build has no pill and flies at the defaults.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (main chat 102)"; `grep -rn "main chat 102" gui/src`):
 *
 *   Always — delete this folder (flight-variants.ts,
 *   FlightVariantsPill.tsx, flight-variants.test.tsx) and App.tsx's
 *   pill; lib/todo-flight-run.ts `flightChoice` returns the picked form
 *   and level as constants (or the form goes, if it is 飞 + pop), and
 *   `replayFlight` with its composer box goes.
 *   现状 — lib/todo-flight.ts, lib/todo-flight-run.ts, their tests, the
 *   `todo-catch-*` CSS in globals.css and hooks/useFreshCards.ts's call
 *   go; the cards keep their `data-card-icon` (harmless) or lose it.
 *   只 pop — the flying half of lib/todo-flight-run.ts and
 *   `flightFrame` go; the plan keeps its pop.
 *   Then docs/design: conversation.md (the cards) and layout-and-chrome.md
 *   (待办按钮, the top bar's motion rules) for what was picked.
 */

export type FlightMagnitude = "big" | "mid" | "small";

export const FLIGHT_FORMS: readonly FlightForm[] = ["none", "pop", "fly"];
export const FLIGHT_MAGNITUDES: readonly FlightMagnitude[] = [
  "big",
  "mid",
  "small",
];

/** The pill's words (dev only, not in the locales). */
export const FLIGHT_FORM_NAMES: Record<FlightForm, string> = {
  none: "现状",
  pop: "只 pop",
  fly: "飞 + pop",
};

export const FLIGHT_MAGNITUDE_NAMES: Record<FlightMagnitude, string> = {
  big: "大",
  mid: "中",
  small: "小",
};

export const FLIGHT_LEVELS: Record<FlightMagnitude, FlightLevel> = {
  big: { lift: 160, peak: 24, durationMs: 700, popScale: 1.25 },
  mid: { lift: 100, peak: 20, durationMs: 560, popScale: 1.15 },
  small: { lift: 60, peak: 16, durationMs: 450, popScale: 1.08 },
};

export interface FlightVariants {
  form: FlightForm;
  magnitude: FlightMagnitude;
}

export const DEFAULT_FLIGHT_VARIANTS: FlightVariants = {
  form: "fly",
  magnitude: "big",
};

const KEY = "galley.tmp.todoFlight";

function pick<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function readStoredFlightVariants(): FlightVariants {
  if (typeof window === "undefined") return DEFAULT_FLIGHT_VARIANTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<
      Record<keyof FlightVariants, unknown>
    > | null;
    return {
      form: pick(raw?.form, FLIGHT_FORMS, DEFAULT_FLIGHT_VARIANTS.form),
      magnitude: pick(
        raw?.magnitude,
        FLIGHT_MAGNITUDES,
        DEFAULT_FLIGHT_VARIANTS.magnitude,
      ),
    };
  } catch {
    return DEFAULT_FLIGHT_VARIANTS;
  }
}

function writeStored(variants: FlightVariants): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(variants));
  } catch {
    // Storage unavailable: the pick lasts for this page only.
  }
}

interface FlightVariantsStore extends FlightVariants {
  set: (change: Partial<FlightVariants>) => void;
}

export const useFlightVariants = create<FlightVariantsStore>((set, get) => ({
  ...readStoredFlightVariants(),
  set: (change) => {
    const { form, magnitude } = { ...get(), ...change };
    writeStored({ form, magnitude });
    set({ form, magnitude });
  },
}));
