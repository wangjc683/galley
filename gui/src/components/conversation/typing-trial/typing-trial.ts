/**
 * TEMPORARY — 票 55 临时切换器，定档后由拆除票删掉 (main chat PRD ruling
 * 107). Two ways to show the built-in assistant at work in the main chat,
 * compared live in tauri dev with a pill (TypingTrialSwitcher) and three
 * display-only demos (typing-trial-demo.ts):
 *
 *   1  today's code (rulings 103, 104): the grey line with its sentence
 *      and clock at the conversation's end, growing into the bubble; the
 *      header 「正在输入…」 / 「思考中」; the card the last message while
 *      the main chat is open. Every function below returns main's value
 *      at tier 1, and the production build is always tier 1.
 *   2  the typing bubble: three dots in an assistant-tinted bubble at the
 *      conversation's end (TypingBubble), growing into the reply
 *      (useTypingBubbleHandoff, ticket 51's hand-off with the typing
 *      bubble as the start); the header's second line the sentence of the
 *      newest settled step, no clock (`assistantSettledSentence`); the
 *      card 「正在输入…」 while it runs, open or not. A round Core woke it
 *      for shows the dots only while it writes (`assistantWriting`).
 *
 * Every branch point in the old files carries the comment
 * 「票 55 临时切换器，定档后由拆除票删掉」. Removal: delete this folder,
 * the `typingLabel` copy if tier 1 wins, the branch points in
 * MainView.tsx, useAssistantState.ts, SidebarAssistant.tsx and App.tsx,
 * and the `export` on `findBubble` / `followersOf` in
 * hooks/useLiveLineHandoff.ts; keep the side that won.
 */
import { create } from "zustand";

import type { AppCopy } from "@/i18n/types";
import { isFinalAnswerTurn } from "@/lib/agent-turn";
import {
  type AssistantCardLine,
  assistantCardLine,
  type AssistantDraft,
  type AssistantLastMessage,
  type AssistantState,
} from "@/lib/assistant";
import {
  assistantLineSentence,
  assistantWriting,
} from "@/lib/assistant-conversation";
import { inReportRound } from "@/lib/subtasks";
import { useAssistantWriting } from "@/hooks/useAssistantSentence";
import {
  EMPTY_TURNS,
  type MessagesStore,
  useMessagesStore,
} from "@/stores/messages";
import type { Turn } from "@/types/conversation";

export type TypingTier = 1 | 2;
export type TypingDemoId = 1 | 2 | 3;

// ---- The switcher's state ------------------------------------------------

const TIER_KEY = "galley.tmp.typingTier";

/** The stored tier, a per-machine convenience (HMR and reloads keep it);
 * production never reads it. */
function readTier(): TypingTier {
  if (!import.meta.env.DEV) return 1;
  try {
    return window.localStorage.getItem(TIER_KEY) === "2" ? 2 : 1;
  } catch {
    return 1;
  }
}

function writeTier(tier: TypingTier): void {
  try {
    window.localStorage.setItem(TIER_KEY, String(tier));
  } catch {
    // Not stored: the pill still switches for this page.
  }
}

interface TypingTrialState {
  tier: TypingTier;
  /** The demo playing in the main chat, or null (typing-trial-demo.ts). */
  demo: TypingDemoId | null;
  setTier: (tier: TypingTier) => void;
}

export const useTypingTrialStore = create<TypingTrialState>((set) => ({
  tier: readTier(),
  demo: null,
  setTier: (tier) => {
    writeTier(tier);
    set({ tier });
  },
}));

/** The tier in force: the pill's in a dev build, always 1 in production. */
export function useTypingTier(): TypingTier {
  const tier = useTypingTrialStore((s) => s.tier);
  return import.meta.env.DEV ? tier : 1;
}

// ---- The typing bubble ----------------------------------------------------

/**
 * The dots, in the bubble's body size (em): twice LiveDots' 3px dot and
 * 2px gap at the standard tier's 15px (6px and 4px), so they keep its
 * proportions, and scale with ⌘= / ⌘− as the reply's words do.
 */
export const TYPING_DOT_EM = 0.4;
export const TYPING_DOT_GAP_EM = 4 / 15;
/** The dots' row width in em. */
export const TYPING_DOTS_WIDTH_EM = 3 * TYPING_DOT_EM + 2 * TYPING_DOT_GAP_EM;

let reportCache: { turns: readonly Turn[]; report: boolean } | null = null;

/** `inReportRound`, kept for the last turns array: the card's selector
 * runs on every store write (each chunk), and the turns change only when
 * a row lands. */
export function cachedReportRound(turns: readonly Turn[]): boolean {
  if (reportCache?.turns === turns) return reportCache.report;
  const report = inReportRound(turns);
  reportCache = { turns, report };
  return report;
}

/**
 * Tier 2: whether the conversation ends in the typing bubble. `lineShown`
 * is MainView's own condition for the live line (running, the main chat,
 * the round not settled, not asking you): a round you started shows it
 * from the send on (the page marks the run before the first event); a
 * round Core woke it for (its opener a report row) only while it writes
 * words (`assistantWriting`, ruling 104: no reasoning left open, no tool
 * dispatch yet, words left once cleaned) — it goes when a dispatch
 * marker shows and comes back when it writes again; a silent one
 * (`<no-reply/>`, held back by the cleaning) never shows it.
 */
export function typingBubbleShown(
  lineShown: boolean,
  turns: readonly Turn[],
  inFlightContent: string,
): boolean {
  if (!lineShown) return false;
  return !cachedReportRound(turns) || assistantWriting(inFlightContent);
}

/** Which of the two draws the conversation's end while the round runs:
 * the live line at tier 1 (main), the typing bubble at tier 2. */
export function liveLineDrawn(tier: TypingTier, lineShown: boolean): boolean {
  return tier === 1 && lineShown;
}

// ---- The header ------------------------------------------------------------

/**
 * Tier 2: the header's second line while it runs — the sentence of the
 * newest step that settled since your last message (or the report row a
 * woken round starts from), by `assistantLineSentence`'s own rule and
 * cleaning (its narration, else its summary) with an empty stream: what
 * streams is not read, so the reply's first line never shows here before
 * the reply. The round's answer (a closing step, no tools) is no step's
 * sentence either: it lands as the bubble, and run_complete follows. Null
 * for 「思考中」.
 */
export function assistantSettledSentence(
  turns: readonly Turn[],
): string | null {
  let start = turns.length;
  while (start > 0 && turns[start - 1].role !== "user") start -= 1;
  const steps = turns
    .slice(start)
    .filter(
      (turn) => !(turn.role === "agent" && isFinalAnswerTurn(turn.tools)),
    );
  return assistantLineSentence(steps, "");
}

let settledCache: { turns: readonly Turn[]; sentence: string | null } | null =
  null;

/** `assistantSettledSentence`, kept for the last turns array: a chunk
 * leaves the turns as they were, so the header's selector returns the
 * same string and re-renders nothing. */
export function cachedSettledSentence(turns: readonly Turn[]): string | null {
  if (settledCache?.turns === turns) return settledCache.sentence;
  const sentence = assistantSettledSentence(turns);
  settledCache = { turns, sentence };
  return sentence;
}

export function selectSettledSentence(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): string | null {
  if (!running) return null;
  const m = state.byId[sessionId];
  return m ? cachedSettledSentence(m.turns) : null;
}

/** Tier 2's header sentence from the main chat's message cache; null at
 * rest and off. A string, so only a step that lands re-renders. */
export function useAssistantSettledSentence(
  sessionId: string,
  running: boolean,
): string | null {
  return useMessagesStore((s) => selectSettledSentence(s, sessionId, running));
}

/**
 * Which stream readings `useAssistantState` turns on. Tier 1 is main's:
 * the line's sentence for the card while the main chat is not on screen,
 * the writing flag for the header's 「正在输入…」. Tier 2 reads neither
 * there: the header takes the settled sentence, and the card says
 * 「正在输入…」 (`useTypingCardSignals` for a woken round).
 */
export function assistantStateReadings(
  tier: TypingTier,
  {
    running,
    open,
    header,
  }: { running: boolean; open: boolean; header: boolean },
): { sentence: boolean; writing: boolean; settled: boolean } {
  if (tier === 1) {
    return {
      sentence: running && !open,
      writing: running && header,
      settled: false,
    };
  }
  return { sentence: false, writing: false, settled: running && header };
}

// ---- The card --------------------------------------------------------------

/** What the card needs at tier 2 while it runs: whether the round is one
 * Core woke it for, and if so whether it writes words (the dots). */
export interface TypingCardSignals {
  reportRound: boolean;
  writing: boolean;
}

/** Booleans, so a chunk re-renders the card only when one flips. */
export function useTypingCardSignals(
  sessionId: string,
  on: boolean,
): TypingCardSignals {
  const reportRound = useMessagesStore((s) =>
    on ? cachedReportRound(s.byId[sessionId]?.turns ?? EMPTY_TURNS) : false,
  );
  const writing = useAssistantWriting(sessionId, on && reportRound);
  return { reportRound, writing };
}

/** Whether the card's last message skips the live round's tool steps
 * (`useAssistantLastMessage`'s `open`): tier 1 only with the main chat
 * on screen (main); tier 2 always, as ruling 104's open rule. */
export function cardReadsLiveRound(tier: TypingTier, open: boolean): boolean {
  return tier === 1 ? open : true;
}

/**
 * The card's second line. Tier 1 is `assistantCardLine` itself. Tier 2,
 * while it runs: 「正在输入…」 in the running tone, the main chat open or
 * not; in a round Core woke it for only while the dots show (it writes),
 * and otherwise the last message by ruling 104's open rule, the avatar
 * still spinning. Every other state (a question, an error, a draft, the
 * last message, unread) keeps today's rules.
 */
export function typingTrialCardLine(
  tier: TypingTier,
  state: AssistantState,
  context: {
    question?: string | null;
    draft?: AssistantDraft | null;
    lastMessage?: AssistantLastMessage | null;
    open: boolean;
  },
  signals: TypingCardSignals,
  copy: AppCopy,
): AssistantCardLine | null {
  if (tier === 2 && state.kind === "running") {
    if (!signals.reportRound || signals.writing) {
      return { kind: "running", text: copy.assistant.typing };
    }
    return assistantCardLine(state, { ...context, open: true }, copy);
  }
  return assistantCardLine(state, context, copy);
}
