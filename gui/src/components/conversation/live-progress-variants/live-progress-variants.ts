import { create } from "zustand";

/**
 * TEMP variant switcher (main chat 90) — where the main chat says what
 * it is doing while it runs, compared live in tauri dev (main chat PRD
 * ruling 134: a v0.7.0 user watched the dots and the card's 「正在输入…」
 * for minutes and thought it had hung; the header's sentence sat where
 * nobody looked). JC picks on the pill (LiveProgressVariantsPill.tsx);
 * a ticket after the ruling writes the chosen one in, removes the rest
 * and updates the design docs. Switching takes effect at once, mid-round
 * too.
 *
 *   now  today's: the typing bubble alone in the conversation; the
 *        header's second line says the newest settled step's sentence
 *        (「思考中」 before one); the card 「正在输入…」, open or not. To
 *        the byte (snapshots taken before the switcher); the only one a
 *        production build has.
 *   new  in a round you started (not one Core woke it for), a line under
 *        the typing bubble, from the send on: 「{在做什么} · {用时}」,
 *        12px `ink-soft`, tabular numbers, the doing part cut with a
 *        fade (the whole of it on hover), the time never cut, nothing
 *        under a second; it leaves with the dots when the reply or the
 *        question takes their place (same fade, same curve, out of the
 *        layout), and goes with them on a stop or an error. Read aloud
 *        when the doing part changes, never the time (`aria-hidden`).
 *        The header has no second line while it runs. The card says
 *        「正在工作…」 with the main chat on screen; away from it
 *        「正在输入…」 while it writes, else 「正在工作…」, from a minute
 *        on 「正在工作 · N 分钟」. A woken round, a question, an error,
 *        the workbench, a subtask, the external runtime: as today.
 *
 * Rules: lib/assistant-progress.ts (`assistantDoing`,
 * `assistantProgressHalf`, the time and the minutes), lib/assistant.ts
 * `assistantCardLine`'s `working`, hooks/useAssistantProgress.ts.
 *
 * Removal, after the ruling. Every touch point says "TEMP variant
 * switcher (main chat 90)" (`grep -rn "main chat 90" gui/src`; the last
 * test in live-progress-variants.test.tsx pins the list of files).
 *
 *   Always delete — this folder (live-progress-variants.ts,
 *   LiveProgressVariantsPill.tsx, LiveProgressVariantsPill.test.tsx,
 *   live-progress-variants.test.tsx and its __snapshots__); App.tsx's
 *   pill (its import and its line); the `useLiveProgressVariant` import
 *   and call in MainView, AssistantIdentity and SidebarAssistant. Before
 *   deleting the two tests, move what the winner keeps: 新 wins — the
 *   hand-off half of LiveProgressVariantsPill.test.tsx next to
 *   useTypingBubbleHandoff, the 「新」 describes of
 *   live-progress-variants.test.tsx into MainView.assistant,
 *   MainHeader.identity and Sidebar.main-chat (their 现状 assertions
 *   change to the new words); 现状 wins — nothing.
 *
 *   The touch points, and what each winner does with them:
 *
 *   file                          新 wins: keep                       现状 wins: delete
 *   lib/assistant-progress.ts     all (marker out of its header)      the file
 *     + its test                  all                                 the file
 *   hooks/useAssistantProgress.ts all (marker out)                    the file
 *     + its test                  all                                 the file
 *   TypingBubble.tsx              `progress` prop, `TypingProgress`,  those (the 「---- TEMP」
 *                                 `ProgressLine`, `ProgressElapsed`,  section), and the imports
 *                                 their imports                       `useEffect`, `useState`,
 *                                                                     `ASSISTANT_BUBBLE_MAX`,
 *                                                                     `assistantProgressElapsed`,
 *                                                                     `syncTruncatedTitle`,
 *                                                                     `truncationFadeRef`, `cn`
 *   MainView.tsx                  `progressDoing` (no variant check:  `progressDoing`,
 *                                 `typingShown ? assistantDoing(…)`), `typingProgress`, the
 *                                 `typingProgress`, `progress=` on    `progress=` prop, the
 *                                 TypingBubble                        `assistantDoing` and
 *                                                                     `TypingProgress` imports
 *   useTypingBubbleHandoff.ts     `line` / `lineBox` (TypingRecord,   the same, all four
 *                                 measureTyping), `leavingLine` and   marked places
 *                                 its lift line
 *   AssistantIdentity.tsx         `line` null while `state.kind ===   `quiet`; `line` is
 *                                 "running"`                          `state.line` again
 *   SidebarAssistant.tsx          `round` (asked while running),      `round`, `ownRound`,
 *                                 `ownRound`, `minutes`, `working`    `minutes`, `working`
 *                                                                     and their imports
 *   lib/assistant.ts              `working` and `workingLine`         `working`, `workingLine`
 *   zh.ts / en.ts                 the four keys (marker comment out)  the four keys
 *
 *   新 wins, then also drop what nothing reads any more: the header's
 *   sentence (`assistantSettledSentence`, `assistantCachedSettledSentence`,
 *   `useAssistantSettledSentence`, useAssistantState's `header`,
 *   `AssistantStateInput.sentence`, the running branch's text in
 *   `assistantState`), and bring the comments that describe today's
 *   in-run split up to date (lib/assistant.ts, lib/assistant-
 *   conversation.ts, TypingBubble, AssistantIdentity, SidebarAssistant,
 *   useAssistantSentence, useAssistantState).
 *
 *   Either way, then docs/design/conversation.md 「在跑时：三点气泡」 and
 *   layout-and-chrome.md §4.1 (the identity row) / §4.2 (the card) for
 *   the winner.
 */

export type LiveProgressVariant = "now" | "new";

export const LIVE_PROGRESS_VARIANTS: readonly LiveProgressVariant[] = [
  "now",
  "new",
];

/** The pill's words for each (dev only, not in the locales). */
export const LIVE_PROGRESS_VARIANT_NAMES: Record<LiveProgressVariant, string> =
  {
    now: "现状",
    new: "新",
  };

interface LiveProgressVariantStore {
  variant: LiveProgressVariant;
  setVariant: (variant: LiveProgressVariant) => void;
}

/** The choice, in memory: a reload is back on 现状. */
export const useLiveProgressStore = create<LiveProgressVariantStore>((set) => ({
  variant: "now",
  setVariant: (variant) => set({ variant }),
}));

/** The variant the in-run surfaces draw: 现状 outside a dev build. */
export function useLiveProgressVariant(): LiveProgressVariant {
  const variant = useLiveProgressStore((s) => s.variant);
  return import.meta.env.DEV ? variant : "now";
}
