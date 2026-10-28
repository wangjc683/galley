import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FLIGHT_VARIANTS,
  FLIGHT_LEVELS,
  readStoredFlightVariants,
} from "./flight-variants";
import { FlightVariantsPill } from "./FlightVariantsPill";

/**
 * The flight's temporary switcher (main chat ticket 102): 飞 + pop at
 * the big size by default (the big one first, JC pulls it back), the
 * ticket's numbers for each size, the pick a wrapped localStorage read,
 * and every place it touches marked for the removal steps in
 * flight-variants.ts. The marker is spelt in two halves here so this
 * file is not one of its own hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 102)"].join(" ");

function storage(initial: Record<string, string> = {}, throws = false) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => {
      if (throws) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throws) throw new Error("blocked");
      data.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the flight's switcher", () => {
  it("starts on 飞 + pop, big", () => {
    expect(DEFAULT_FLIGHT_VARIANTS).toEqual({ form: "fly", magnitude: "big" });
    expect(readStoredFlightVariants()).toEqual(DEFAULT_FLIGHT_VARIANTS);
  });

  it("has the ticket's three sizes", () => {
    expect(FLIGHT_LEVELS).toEqual({
      big: { lift: 160, peak: 24, durationMs: 700, popScale: 1.25 },
      mid: { lift: 100, peak: 20, durationMs: 560, popScale: 1.15 },
      small: { lift: 60, peak: 16, durationMs: 450, popScale: 1.08 },
    });
  });

  it("reads the stored pick, and falls back on anything else", () => {
    vi.stubGlobal("window", {
      localStorage: storage({
        "galley.tmp.todoFlight": JSON.stringify({
          form: "pop",
          magnitude: "huge",
        }),
      }),
    });
    expect(readStoredFlightVariants()).toEqual({
      form: "pop",
      magnitude: "big",
    });
    vi.stubGlobal("window", {
      localStorage: storage({ "galley.tmp.todoFlight": "{" }),
    });
    expect(readStoredFlightVariants()).toEqual(DEFAULT_FLIGHT_VARIANTS);
    vi.stubGlobal("window", { localStorage: storage({}, true) });
    expect(readStoredFlightVariants()).toEqual(DEFAULT_FLIGHT_VARIANTS);
  });

  it("renders nothing without a document (static rendering)", () => {
    expect(renderToStaticMarkup(<FlightVariantsPill />)).toBe("");
  });

  it("is marked wherever it touches, for its removal", () => {
    const src = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          readFileSync(file, "utf8").includes(MARK)
        ) {
          hits.push(path.relative(src, file));
        }
      }
    };
    walk(src);
    expect(hits.sort()).toEqual([
      "App.tsx",
      "components/todo/flight-variants/FlightVariantsPill.tsx",
      "components/todo/flight-variants/flight-variants.ts",
      "hooks/useFreshCards.ts",
      "lib/todo-flight-run.ts",
    ]);
  });
});
