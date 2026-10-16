import type { CSSProperties } from "react";
import { create } from "zustand";

import type { ConversationFontSize } from "@/lib/conversation-font-size";

/**
 * TEMP variant switcher (telegram-details 10) — how dense the text in the
 * main chat's bubbles is (`.scratch/telegram-details` PRD ruling 8 and
 * ticket 10, after JC's 「主对话信息稍微有点密度不够，字有点太大」 in the
 * live test). JC switches the options in tauri dev (pill:
 * TdDensityPill.tsx) and rules; the chosen one gets written in and all of
 * this goes.
 *
 * The body text of both bubbles — the user's and the assistant's (its
 * replies, the greeting, its questions, live or answered, and the reply of
 * a round a subtask woke it for) — reads three variables from the reading
 * tier (lib/conversation-font-size.ts): `--conversation-body-size`,
 * `--conversation-body-leading`, `--conversation-block-gap`. Each option
 * re-declares those three on the bubbles of the main chat's column only
 * (`BUBBLE_DENSITY_CLASS`, MainView), so what sits outside a bubble keeps
 * the tier's values: the process card, the subtask cards, the line while it
 * works, a run drawn in full or a /btw exchange (the workbench's
 * rendering), the time lines, the candidates under a question. Inside a
 * bubble the headings, code and tables keep their own sizes (their own
 * variables); their margins are multiples of the gap, so they follow it.
 * The quotes at the top of the user's bubble have their own size and
 * leading and stay. The workbench and the composer are not touched.
 *
 * Standard tier (the ticket's values):
 *
 *   V0  15px  1.7   12px    today
 *   V1  15px  1.55  10.5px  only the leading
 *   V2  14px  1.6   10.5px  one size down
 *   V3  14px  1.5   9.5px   both, as a check
 *
 * Small and large follow today's steps between the tiers: size ∓1.5px
 * (13.5 / 15 / 16.5), leading ∓0.05 (1.65 / 1.7 / 1.75), and a gap of
 * 0.47 of the line box (size × leading) to the nearest 0.5px, the ratio
 * conversation-font-size.ts holds across its tiers. The ticket's own
 * standard values are kept as given (V1 and V3 sit at 0.45 there).
 *
 * Default V0: nothing is re-declared, so nothing changes until the pill is
 * touched. The choice is a per-machine convenience kept in localStorage
 * (`galley.tmp.tdDensity`, reads and writes wrapped), never in Core.
 *
 * Removal, after the ruling (every touch point says "TEMP variant switcher
 * (telegram-details 10)"):
 *
 *   Always — delete this folder (td-density.ts, TdDensityPill.tsx,
 *   td-density.test.tsx) and MainView's pill and `useTdDensity` read.
 *   V0 stays — also MainView's `bubbleDensity` on the column.
 *   V1–V3 wins — its three tiers move to lib/conversation-font-size.ts as
 *   the main chat's bubble values, and BUBBLE_DENSITY_CLASS with them (or
 *   next to AssistantParts' bubble); MainView applies them to the main
 *   chat's column always. Then the design docs: conversation.md
 *   「助手的对话」 (the bubbles) and the tier table's comment.
 */

export type DensityVariant = 0 | 1 | 2 | 3;

export const DENSITY_VARIANTS: readonly DensityVariant[] = [0, 1, 2, 3];

export interface BubbleBody {
  /** px */
  size: number;
  leading: number;
  /** px */
  gap: number;
}

/** Each option's three values per tier; V0 is today's (the tier table,
 * for the pill's labels). */
export const BUBBLE_DENSITY: Record<
  DensityVariant,
  Record<ConversationFontSize, BubbleBody>
> = {
  0: {
    small: { size: 13.5, leading: 1.65, gap: 10.5 },
    standard: { size: 15, leading: 1.7, gap: 12 },
    large: { size: 16.5, leading: 1.75, gap: 13.5 },
  },
  1: {
    small: { size: 13.5, leading: 1.5, gap: 9.5 },
    standard: { size: 15, leading: 1.55, gap: 10.5 },
    large: { size: 16.5, leading: 1.6, gap: 12.5 },
  },
  2: {
    small: { size: 12.5, leading: 1.55, gap: 9 },
    standard: { size: 14, leading: 1.6, gap: 10.5 },
    large: { size: 15.5, leading: 1.65, gap: 12 },
  },
  3: {
    small: { size: 12.5, leading: 1.45, gap: 8.5 },
    standard: { size: 14, leading: 1.5, gap: 9.5 },
    large: { size: 15.5, leading: 1.55, gap: 11.5 },
  },
};

/** The bubbles of the column re-declare the three variables from the
 * column's `--bubble-*` (`bubbleDensity`): the user's bubble reads the size
 * and leading on itself (it has no paragraphs), the assistant's passes all
 * three to its markdown. */
export const BUBBLE_DENSITY_CLASS = [
  "[&_[data-role=assistant-bubble]]:[--conversation-body-size:var(--bubble-body-size)]",
  "[&_[data-role=assistant-bubble]]:[--conversation-body-leading:var(--bubble-body-leading)]",
  "[&_[data-role=assistant-bubble]]:[--conversation-block-gap:var(--bubble-block-gap)]",
  "[&_[data-role^=user-msg]]:[--conversation-body-size:var(--bubble-body-size)]",
  "[&_[data-role^=user-msg]]:[--conversation-body-leading:var(--bubble-body-leading)]",
].join(" ");

/** What the main chat's column carries for an option at a tier; null for
 * V0 (today: no class, no style). */
export function bubbleDensity(
  variant: DensityVariant,
  tier: ConversationFontSize,
): { className: string; style: CSSProperties } | null {
  if (variant === 0) return null;
  const body = BUBBLE_DENSITY[variant][tier];
  return {
    className: BUBBLE_DENSITY_CLASS,
    style: {
      "--bubble-body-size": `${body.size}px`,
      "--bubble-body-leading": String(body.leading),
      "--bubble-block-gap": `${body.gap}px`,
    } as CSSProperties,
  };
}

const KEY = "galley.tmp.tdDensity";

function readStored(): DensityVariant {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(KEY));
    return DENSITY_VARIANTS.includes(value as DensityVariant)
      ? (value as DensityVariant)
      : 0;
  } catch {
    return 0;
  }
}

function writeStored(variant: DensityVariant): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, String(variant));
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then
    // lasts for this page only.
  }
}

interface TdDensityStore {
  variant: DensityVariant;
  setVariant: (variant: DensityVariant) => void;
}

export const useTdDensity = create<TdDensityStore>((set) => ({
  variant: readStored(),
  setVariant: (variant) => {
    writeStored(variant);
    set({ variant });
  },
}));
