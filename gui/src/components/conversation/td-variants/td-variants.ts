import { create } from "zustand";

import type { ComposerGrowTiming } from "@/lib/composer-grow";

/**
 * TEMP variant switcher (telegram-details 05) — two details learnt from
 * Telegram, compared live (`.scratch/telegram-details` PRD ruling 6,
 * ticket 05). JC switches them in tauri dev (pill: TdVariantsPill.tsx)
 * and rules; the chosen ones get written in and all of this goes.
 *
 * A. The composer's change of height (both conversations' one-line
 *    composer; the new-chat card is not in it), growing and shrinking
 *    alike (lib/composer-grow.ts):
 *      1 instant (today)   2 100ms ease-out
 *      3 by distance, `50 × ln|Δh|` ms ease-out (Telegram's curve)
 *    Reduced motion: instant in every option.
 * B. The corners inside an IM group of the main chat (the same side,
 *    4px apart — `assistantJoinsGroup`; a time line or a change of side
 *    ends a group): the sender's-side corners facing a neighbour of the
 *    group (lib/assistant-conversation.ts `assistantGroupCornerClass`).
 *      1 12px, as today   2 8px   3 6px   4 4px
 *    「演示连发」 shows a fixed conversation with two bursts in the main
 *    chat in place of its own (display only; td-demo.ts): JC's main
 *    chat has none, and the queue makes one run per message, so a burst
 *    takes a stopped send to make.
 *
 * Default: A1 and B1 with the demo off — what the app does today, so
 * nothing changes until the pill is touched. The choice is a
 * per-machine convenience kept in localStorage (`galley.tmp.tdVariants.*`,
 * reads and writes wrapped), never in Core.
 *
 * Removal, after the ruling (every touch point says "TEMP variant
 * switcher (telegram-details 05)"):
 *
 *   Always — delete this folder (td-variants.ts, TdVariantsPill.tsx,
 *   td-demo.ts, td-variants.test.tsx), MainView's pill, Conversation's
 *   demo swap (`turns` / `agentRunning` / `askUserPending` are the props
 *   again) and its `groupCorners` read.
 *   A1 stays — also Composer's two lines before the instant path and
 *   lib/composer-grow.ts with its test.
 *   A2 / A3 wins — Composer passes the timing as a constant
 *   (`"fixed"` / `"distance"`) instead of `composerGrowTiming()`.
 *   B1 stays — also the corner code: `assistantGroupCornerClass`,
 *   Conversation's `below` parameter, `groupJoins` and the re-render of
 *   the row above (`lastLineRow`).
 *   B2–B4 wins — the corner code runs always (no `groupCorners` gate),
 *   and the chosen px replaces `(--bubble-group-radius)` in
 *   `assistantGroupCornerClass`.
 *   Then the design docs: conversation.md 「会话里的输入框」 and
 *   「助手的对话」 (the bubbles, the grouping gap).
 */

export type GrowVariant = 1 | 2 | 3;
export type CornerVariant = 1 | 2 | 3 | 4;

export const GROW_VARIANTS: readonly GrowVariant[] = [1, 2, 3];
export const CORNER_VARIANTS: readonly CornerVariant[] = [1, 2, 3, 4];

export const GROW_TIMING: Record<GrowVariant, ComposerGrowTiming> = {
  1: "instant",
  2: "fixed",
  3: "distance",
};

/** The small corner of each option; null keeps 12px everywhere. */
export const CORNER_PX: Record<CornerVariant, number | null> = {
  1: null,
  2: 8,
  3: 6,
  4: 4,
};

const KEY = "galley.tmp.tdVariants";

function readStorage(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${KEY}.${name}`);
  } catch {
    return null;
  }
}

function writeStorage(name: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${KEY}.${name}`, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then
    // lasts for this page only.
  }
}

function storedOption<T extends number>(
  name: string,
  options: readonly T[],
): T | null {
  const value = Number(readStorage(name));
  return options.includes(value as T) ? (value as T) : null;
}

/** The radius the grouped corners read (`--bubble-group-radius` on the
 * root); B1 sets none, so nothing reads it. */
function applyCornerRadius(corners: CornerVariant): void {
  if (typeof document === "undefined") return;
  const px = CORNER_PX[corners];
  const root = document.documentElement.style;
  if (px === null) root.removeProperty("--bubble-group-radius");
  else root.setProperty("--bubble-group-radius", `${px}px`);
}

interface TdVariantsStore {
  grow: GrowVariant;
  corners: CornerVariant;
  /** 「演示连发」: the main chat shows the demo bursts (td-demo.ts). */
  demo: boolean;
  setGrow: (grow: GrowVariant) => void;
  setCorners: (corners: CornerVariant) => void;
  setDemo: (on: boolean) => void;
}

export const useTdVariants = create<TdVariantsStore>((set) => {
  const corners = storedOption("corners", CORNER_VARIANTS) ?? 1;
  applyCornerRadius(corners);
  return {
    grow: storedOption("grow", GROW_VARIANTS) ?? 1,
    corners,
    demo: readStorage("demo") === "on",
    setGrow: (grow) => {
      writeStorage("grow", String(grow));
      set({ grow });
    },
    setCorners: (next) => {
      writeStorage("corners", String(next));
      applyCornerRadius(next);
      set({ corners: next });
    },
    setDemo: (on) => {
      writeStorage("demo", on ? "on" : "off");
      set({ demo: on });
    },
  };
});

/** A's timing for the composer, read when its height changes. */
export function composerGrowTiming(): ComposerGrowTiming {
  return GROW_TIMING[useTdVariants.getState().grow];
}
