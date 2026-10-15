import type { CSSProperties } from "react";
import { create } from "zustand";

import type { ComposerProps } from "@/components/conversation/composer-props";
import { COMPOSER_MAX_HEIGHT_PX } from "@/components/conversation/composer-styles";
import { useLanguage } from "@/lib/i18n";
import type { ResolvedLanguage } from "@/lib/language";
import type { QueuedMessage } from "@/lib/session-queue";

/**
 * TEMPORARY — the main chat's composer in two forms, compared live
 * (`.scratch/main-chat` ticket 24, PRD ruling 71). JC switches them in
 * tauri dev (pill: ComposerTrialSwitcher.tsx) and rules; the winner gets
 * its own final ticket.
 *
 *   current — today's card (input, then ＋ and 「模型 · 强度」 on the
 *             row under it, send / stop at its right) with the hint row
 *             below (the control).
 *   line    — one row: ＋, the input, 「模型 · 强度」, send / stop
 *             (ComposerOneLine.tsx). The input starts one line high,
 *             grows with its text up to eight lines, then scrolls inside
 *             the box; the buttons stay at the bottom. No hint row (ruling
 *             71, item 3): the one hint that answers a worry — 「正在停止，
 *             排队的消息会自动发出」 — moves into the queue strip's heading.
 *
 * Not in the switcher (ruling 71 does them directly, in both forms):
 * Enter queues mid-run (ticket 24's first commit), and the main chat's
 * placeholder is 「发消息…」 (`lib/composer-register.ts`).
 *
 * 「演示在跑」 draws the composer as if the main chat were working — Stop
 * in the send slot, two made-up messages in the queue strip — in either
 * form, display only: nothing is written, sent or asked of the model;
 * Stop, the strip and Enter do nothing while it shows.
 *
 * Scope: the managed runtime's main chat open in the main area only
 * (App passes the choice to MainView only then; MainView gates on
 * `isMainChat` once more). Ordinary conversations, subtasks, the
 * external runtime and the new-chat composer render as before.
 *
 * The pill's choices are per-machine conveniences kept in localStorage
 * (`galley.tmp.composerTrial.*`, reads and writes wrapped), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * "ticket 24"):
 *
 *   Always — delete this folder (composer-trial.ts, ComposerOneLine.tsx,
 *   ComposerDemoInert.tsx, ComposerTrialSwitcher.tsx,
 *   composer-trial.test.tsx; fold the winner's cases into the
 *   components' own tests), App's `composerTrial` wiring and pill,
 *   MainView's `composerTrial` prop and its `useComposerTrialOverrides`
 *   spread, the Composer's `trial` prop and the demo queue in front of
 *   its session queue (`queueItems` reads the store again).
 *   If 现状 wins — also the Composer's one-line branch (`oneLine`, the
 *   pieces' line variants, the auto-grow cap), ComposerQueueStrip
 *   `heading`, ComposerImageStrip `className`, ComposerDropOverlay
 *   `line`, LLMPill / EffortPill `popoverAlign`.
 *   If 一行式 wins — move ComposerOneLine and the ONE_LINE_* measures
 *   next to the Composer and make the form a plain Composer prop that
 *   MainView sets for the main chat, with `showFooterHint` off; keep the
 *   strip's `heading` for the stopping sentence.
 *   Either way the direct queue and 「发消息…」 stay. Then the design docs
 *   (conversation.md §4.4 and 「助手的对话」).
 */

export type ComposerShape = "current" | "line";

export const COMPOSER_SHAPES: readonly ComposerShape[] = ["current", "line"];

/** The pill's choice. */
export interface ComposerTrialChoice {
  shape: ComposerShape;
  /** 「演示在跑」: the composer drawn as if the main chat were working. */
  demoRunning: boolean;
}

/** What the Composer gets of it (TEMPORARY, ticket 24). */
export interface ComposerTrialView {
  /** Draw the one-line form. */
  oneLine: boolean;
  /** 「演示在跑」: shown in place of the session's queue; the strip does
   * nothing while it shows. */
  demoQueue?: QueuedMessage[];
}

const KEY = "galley.tmp.composerTrial";

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

interface ComposerTrialStore extends ComposerTrialChoice {
  setShape: (shape: ComposerShape) => void;
  setDemoRunning: (on: boolean) => void;
}

export const useComposerTrialStore = create<ComposerTrialStore>((set) => {
  const stored = readStorage("shape");
  return {
    // 一行式 by default (ticket 24).
    shape: COMPOSER_SHAPES.includes(stored as ComposerShape)
      ? (stored as ComposerShape)
      : "line",
    demoRunning: readStorage("demo") === "on",
    setShape: (shape) => {
      writeStorage("shape", shape);
      set({ shape });
    },
    setDemoRunning: (demoRunning) => {
      writeStorage("demo", demoRunning ? "on" : "off");
      set({ demoRunning });
    },
  };
});

/** What MainView gets: nothing outside the main chat open in the main
 * area (ordinary conversations, subtasks, the external runtime). */
export function composerTrialFor(
  choice: ComposerTrialChoice,
  { mainChatOpen }: { mainChatOpen: boolean },
): ComposerTrialChoice | undefined {
  return mainChatOpen ? choice : undefined;
}

/** 「演示在跑」's two queued messages, in the UI language. */
export function demoQueue(language: ResolvedLanguage): QueuedMessage[] {
  const zh = language !== "en-US";
  const at = "2026-10-15T08:00:00.000Z";
  return [
    {
      queueId: "composer-trial-demo-1",
      text: zh
        ? "顺便看看周六鼓浪屿的船票还有没有"
        : "And see if there are ferry tickets to Gulangyu on Saturday",
      queuedAt: at,
    },
    {
      queueId: "composer-trial-demo-2",
      text: zh
        ? "订好了把时间发到我日历里"
        : "Once it's booked, put the times in my calendar",
      queuedAt: at,
    },
  ];
}

const noop = () => {};
/** Enter while the demo shows: nothing goes out, the draft stays. */
const keepDraft = () => false;

/**
 * The Composer props the trial sets over MainView's own (spread last).
 * Nothing at all outside the main chat, or for 现状 with the demo off —
 * the Composer then renders exactly as before.
 */
export function useComposerTrialOverrides(
  choice: ComposerTrialChoice | undefined,
): Partial<ComposerProps> {
  const language = useLanguage();
  if (!choice) return {};
  const oneLine = choice.shape === "line";
  if (!oneLine && !choice.demoRunning) return {};
  return {
    trial: {
      oneLine,
      demoQueue: choice.demoRunning ? demoQueue(language) : undefined,
    },
    // No hint row in the one-line form (ruling 71, item 3).
    ...(oneLine ? { showFooterHint: false } : {}),
    ...(choice.demoRunning
      ? { stopMode: true, isStopping: false, onStop: noop, onSubmit: keepDraft }
      : {}),
  };
}

// ---- The one-line form's measures --------------------------------------

/**
 * The input's padding centres one line in the 32px row of round buttons
 * at every conversation font size, so the box is 48px high with one line
 * (7px padding + 1px border on each side) and the last line stays level
 * with ＋ and send as it grows.
 */
const ONE_LINE_PAD =
  "calc((32px - 1.55 * var(--conversation-composer-size)) / 2)";

/** Eight lines, then the input scrolls inside the box. */
export const ONE_LINE_MAX_LINES = 8;

export const ONE_LINE_TEXTAREA_STYLE: CSSProperties = {
  paddingTop: ONE_LINE_PAD,
  paddingBottom: ONE_LINE_PAD,
  // 8 lines + the two pads = 7 lines + 32px.
  maxHeight: `calc(32px + ${ONE_LINE_MAX_LINES - 1} * 1.55 * var(--conversation-composer-size))`,
};

export const ONE_LINE_TEXTAREA_CLASS =
  "block w-full resize-none overflow-y-auto border-0 bg-transparent px-0 [font-size:var(--conversation-composer-size)] leading-[1.55] text-ink outline-none placeholder:text-ink-muted/50";

/** The ghost suggestion sits where the first typed line would. */
export const ONE_LINE_GHOST_STYLE: CSSProperties = { top: ONE_LINE_PAD };

export const ONE_LINE_GHOST_CLASS =
  "pointer-events-none absolute inset-x-0 flex items-baseline gap-2 overflow-hidden [font-size:var(--conversation-composer-size)] leading-[1.55]";

/** The image tiles above the input, inside the box: 12px in from its
 * outer edge, so a tile's 12px corner sits concentric in the box's 24px
 * one. */
export const ONE_LINE_IMAGE_STRIP_CLASS = "flex flex-wrap gap-2 px-1 pb-2 pt-1";

/** The auto-grow cap: the textarea's own max-height (eight lines at the
 * current font size). */
export function oneLineMaxHeightPx(el: HTMLTextAreaElement): number {
  const cap = Number.parseFloat(window.getComputedStyle(el).maxHeight);
  return Number.isFinite(cap) && cap > 0 ? cap : COMPOSER_MAX_HEIGHT_PX;
}
