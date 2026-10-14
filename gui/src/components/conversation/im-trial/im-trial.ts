import { create } from "zustand";

import type { AppCopy } from "@/i18n/types";
import { cleanSessionSummary } from "@/lib/session-summary";
import type { RunGroup, RunStats } from "@/lib/run-groups";
import { cn } from "@/lib/utils";
import type { Turn } from "@/types/conversation";

/**
 * TEMPORARY — how the assistant's conversation is drawn, four pieces
 * compared live (`.scratch/main-chat` ticket 19, PRD ruling 66). The
 * sidebar card already reads as a row of an IM list (ruling 65); the
 * main area still reads as the workbench's task record. JC switches each
 * piece in tauri dev (pill: ImTrialSwitcher.tsx) and rules; the winner
 * gets its own final ticket. Every piece is ordered from the most
 * restrained choice, and any combination renders.
 *
 *   bubble   current — the user's words in a left apricot bubble, the
 *                      reply in plain prose (the control).
 *            b       — only the user's bubble moves right, width by its
 *                      content up to a cap; replies stay prose.
 *            c       — both sides are bubbles: the user's on the right
 *                      (apricot), the reply on the left on a neutral
 *                      ground (`bg-hover`). No avatar, no name, no
 *                      border, shadow or tail. Its question to the
 *                      user (live and answered) is a plain left bubble
 *                      with the candidates under it; the subtask cards
 *                      (right under the reply bubble) and the greeting
 *                      sit on the left too.
 *            B and C: consecutive messages on one side sit 4px apart
 *            (an IM group), a change of side restores the 20px gap, and
 *            a reply's reserved action row counts as the gap below it
 *            (`imRowGap`).
 *   process  current — today's fold header over every reply and the
 *                      live window while it works.
 *            line    — while it works, one line at the conversation's
 *                      end: the latest sentence it wrote in this round
 *                      (the first line of a streaming one counts),
 *                      「思考中」 before any, with the round's clock
 *                      after 3s; nothing else (no steps, no reasoning,
 *                      no streaming prose, no corner clock). The reply
 *                      appears whole when the round settles; a reply of
 *                      two steps or more keeps a quiet 「N 步 · 用时 … ›」
 *                      under it that opens the steps in place. Its
 *                      questions and the user's answers stay out of the
 *                      fold, in order, as messages. Runs without an
 *                      answer (stopped, failed, at the step cap) unfold
 *                      in full as today.
 *   time     current — the send time above the user's bubble at a break.
 *            centered— the same breaks, the same label, as a line
 *                      centred between two messages; one above the
 *                      greeting when its time is known (the page does
 *                      not carry it today — see `greetingAt`).
 *   scroll   current — a send parks the message 32px under the top.
 *            bottom  — a short conversation stacks up from the composer;
 *                      a send goes to the bottom; following the growth
 *                      stops before the reply's start (the first thing
 *                      after the user's message) leaves the viewport.
 *
 * 「演示」 swaps in a fixed synthetic conversation (im-trial-demo.ts),
 * display only: nothing is written, the stores keep the real chat, the
 * model sees nothing; the composer is off while it shows.
 *
 * Scope: the managed runtime's main chat open in the main area only
 * (MainView `isMainChat`). Ordinary conversations, subtasks and the
 * external runtime render exactly as before in every choice — App hands
 * MainView no settings there, and none when every piece is current
 * with the demo off.
 *
 * The pill's choices are per-machine conveniences kept in localStorage
 * (`galley.tmp.imTrial.*`, reads and writes wrapped), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * 「票 19」 / "ticket 19"):
 *
 *   Always — delete this folder (im-trial.ts, im-trial-demo.ts,
 *   useImDemo.ts, ImTrialParts.tsx, ImTrialSwitcher.tsx and
 *   im-trial.test.tsx; fold the winner's cases into the components'
 *   own tests), App's `imTrial` wiring and pill, MainView's `im` prop
 *   and its demo view, Conversation's `im` prop; SubtaskCards keeps
 *   its `SubtaskCardView` split only if the demo's successor needs it.
 *   Per piece, keep the winner's branch and drop the others:
 *   bubble — MessageUser `align` / `rowClassName`, MessageAgent
 *     `bubble` / `className` / `attachment`, AskUserBubble and
 *     AnsweredAskUser `bubble` (the latter's `className`), AgentTurnView
 *     `bubble` / `attachment` / `answerClassName`, Conversation's
 *     `userRow` / `afterAnswer` and its row-side bookkeeping;
 *   process — Conversation's line-mode plan and assembly
 *     (`renderLineRow`), AgentTurnView `entry` / `noRule`, MessageAgent
 *     and MessageActions `leading`, MainView's live line, its hidden
 *     corner clock and the emptied typewriter input;
 *   time — Conversation's centred divider and the greeting's time (the
 *     final version would carry the greeting row's `created_at` on its
 *     AgentTurn in rowsToTurns, a GUI-only line);
 *   scroll — useStickyScroll `stickBottom` (with imFollowBottom /
 *     imScrollToBottom) and MainView's bottom stack.
 *   Then the design docs (conversation.md 「User vs Agent 三重区分」,
 *   「杏沙气泡」, 「发送时间」, 「Scroll behaviour」, …) in the final
 *   ticket.
 */

export type ImBubble = "current" | "b" | "c";
export type ImProcess = "current" | "line";
export type ImTime = "current" | "centered";
export type ImScroll = "current" | "bottom";
export type ImDemo = "off" | "still" | "running" | "asking";

export interface ImTrialSettings {
  bubble: ImBubble;
  process: ImProcess;
  time: ImTime;
  scroll: ImScroll;
}

/** What MainView draws the main chat with: the four pieces and the demo. */
export interface ImRendering extends ImTrialSettings {
  demo: ImDemo;
}

/** What Conversation needs of it. */
export interface ImConversationOptions {
  bubble: ImBubble;
  process: ImProcess;
  time: ImTime;
  /** The greeting's send time, when known: the centred time draws a
   * line above it. The page's AgentTurn carries none (only the demo
   * supplies one), so the real main chat shows no line there in this
   * trial. */
  greetingAt?: string | null;
  /** Line mode: every 「N 步 ›」 opens its steps from the start (the
   * tests' way in; the toggle still closes them). */
  stepsOpen?: boolean;
}

export const IM_BUBBLES: readonly ImBubble[] = ["current", "b", "c"];
export const IM_PROCESSES: readonly ImProcess[] = ["current", "line"];
export const IM_TIMES: readonly ImTime[] = ["current", "centered"];
export const IM_SCROLLS: readonly ImScroll[] = ["current", "bottom"];
export const IM_DEMOS: readonly ImDemo[] = [
  "off",
  "still",
  "running",
  "asking",
];

/** 「全部现状」 */
export const IM_ALL_CURRENT: ImTrialSettings = {
  bubble: "current",
  process: "current",
  time: "current",
  scroll: "current",
};

/** 「全部推荐」: C, 一行, 居中, 贴底 (ruling 66's recommendations). */
export const IM_ALL_RECOMMENDED: ImTrialSettings = {
  bubble: "c",
  process: "line",
  time: "centered",
  scroll: "bottom",
};

const KEY = "galley.tmp.imTrial";

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

function readChoice<T extends string>(
  name: string,
  options: readonly T[],
  fallback: T,
): T {
  const stored = readStorage(name);
  return options.includes(stored as T) ? (stored as T) : fallback;
}

interface ImTrialStore extends ImTrialSettings {
  demo: ImDemo;
  /** The pill's panel is open. */
  panelOpen: boolean;
  setBubble: (value: ImBubble) => void;
  setProcess: (value: ImProcess) => void;
  setTime: (value: ImTime) => void;
  setScroll: (value: ImScroll) => void;
  setAll: (value: ImTrialSettings) => void;
  setDemo: (value: ImDemo) => void;
  setPanelOpen: (value: boolean) => void;
}

export const useImTrialStore = create<ImTrialStore>((set) => ({
  bubble: readChoice("bubble", IM_BUBBLES, "current"),
  process: readChoice("process", IM_PROCESSES, "current"),
  time: readChoice("time", IM_TIMES, "current"),
  scroll: readChoice("scroll", IM_SCROLLS, "current"),
  demo: readChoice("demo", IM_DEMOS, "off"),
  panelOpen: readStorage("panel") === "open",
  setBubble: (bubble) => {
    writeStorage("bubble", bubble);
    set({ bubble });
  },
  setProcess: (process) => {
    writeStorage("process", process);
    set({ process });
  },
  setTime: (time) => {
    writeStorage("time", time);
    set({ time });
  },
  setScroll: (scroll) => {
    writeStorage("scroll", scroll);
    set({ scroll });
  },
  setAll: (value) => {
    writeStorage("bubble", value.bubble);
    writeStorage("process", value.process);
    writeStorage("time", value.time);
    writeStorage("scroll", value.scroll);
    set({ ...value });
  },
  setDemo: (demo) => {
    writeStorage("demo", demo);
    set({ demo });
  },
  setPanelOpen: (panelOpen) => {
    writeStorage("panel", panelOpen ? "open" : "closed");
    set({ panelOpen });
  },
}));

/** True when the settings equal `target` piece by piece. */
export function sameImSettings(
  a: ImTrialSettings,
  target: ImTrialSettings,
): boolean {
  return (
    a.bubble === target.bubble &&
    a.process === target.process &&
    a.time === target.time &&
    a.scroll === target.scroll
  );
}

/**
 * What MainView gets for the conversation on screen: nothing outside the
 * main chat (ordinary conversations, subtasks, the external runtime),
 * and nothing while every piece is current with the demo off — the
 * control then takes today's code path untouched.
 */
export function imRenderingFor(
  choice: ImTrialSettings & { demo: ImDemo },
  { mainChatOpen }: { mainChatOpen: boolean },
): ImRendering | undefined {
  if (!mainChatOpen) return undefined;
  if (sameImSettings(choice, IM_ALL_CURRENT) && choice.demo === "off") {
    return undefined;
  }
  return {
    bubble: choice.bubble,
    process: choice.process,
    time: choice.time,
    scroll: choice.scroll,
    demo: choice.demo,
  };
}

// ---- Bubbles ------------------------------------------------------------

/**
 * The user's bubble on the right (B, C): width by content, at most 80%
 * of the column and never past 560px — about 37 CJK characters a line,
 * a phone-IM measure; in the 1200px wide mode it keeps the same 560px
 * instead of stretching (the ticket: never a thousand pixels wide). The
 * 80% only bites when the column is under 700px (a narrow window with a
 * wide sidebar).
 */
export const IM_USER_BUBBLE_MAX = "max-w-[min(80%,560px)]";

/** The reply bubble's width cap (C): wider than the user's — its
 * content is markdown, lists and tables — but always leaving a visible
 * margin on the right (12% of a 760px column is 91px) so it still reads
 * as the left side. 680px holds a 5-column table with wrapped cells. */
export const IM_AGENT_MAX = "max-w-[min(88%,680px)]";

/**
 * The reply bubble (C): the neutral ground is `bg-hover` — light
 * #f0f0f0 on the #faf9f8 page (ΔL* −3.2), dark #24272c on #14171a
 * (ΔL* +8.0); ΔE 12 from the apricot `bg-brand-tint` in both themes, so
 * the two sides differ in hue, not just in lightness. `code-surface`
 * was the other candidate (ΔL* −2.8 / +5.1): too faint on light paper.
 * Same 12px radius and padding as the user's bubble; no border, shadow
 * or tail (conversation.md's three 「不要」 stay).
 *
 * Inside it, everything that sat on the page one recess step below the
 * page sits one recess step below the bubble: inline code and code
 * blocks move from `bg-hover` / `code-surface` to `bg-line` (light
 * ΔL* −3.1 under the bubble, dark +4.6 — the same direction as the
 * page → inline code step in each theme), and the code block drops its
 * hairline, so it reads as a band of the bubble rather than a box in a
 * box. A table keeps its grid lines (they are its structure) but its
 * header row drops the paper patch (`bg-surface`, lighter than the
 * bubble) and sits on the bubble; its weight still marks it. `!`
 * because MarkdownView's and CodeBlock's own rules have the same
 * specificity.
 */
export const IM_AGENT_BUBBLE = cn(
  "w-fit rounded-md bg-hover px-3.5 py-2.5",
  IM_AGENT_MAX,
  "[&_:not(pre)>code]:bg-line!",
  "[&_.bg-code-surface]:border-transparent! [&_.bg-code-surface]:bg-line!",
  "[&_th]:bg-transparent!",
);

/** The side of the message row above, for the row gap: a reply row
 * (`agent-bar`) ends with its action row's reserved 30px (the hover-only
 * copy / save, and in line mode the 「N 步 ›」 entry). */
export type ImRowSide = "user" | "agent" | "agent-bar";

/**
 * Top margin of a message row in the bubble modes (B, C): 4px under a
 * row on the same side (an IM group), 20px — the user message's old
 * my-5 — when the side changes or something else sits in between, and
 * none under a reply's action row, whose reserved 30px already is the
 * gap (otherwise a change of side reads 50px one way and 20px the
 * other, and the conversation falls into question–answer pairs).
 */
export function imRowGap(
  previous: ImRowSide | null,
  side: "user" | "agent",
): string {
  if (previous === "agent-bar") return "mt-0";
  return previous === side ? "mt-1" : "mt-5";
}

// ---- Process: one line ----------------------------------------------------

/** Rounds shorter than this show no clock in the line (the ticket's
 * 「超过 3 秒」; the in-flight row's old rule too). */
export const IM_LINE_CLOCK_AFTER_MS = 3000;

/**
 * The round's clock for the line: the corner clock's own value and
 * format (RunElapsedHud: whole seconds, 「1 分 23 秒」 past a minute),
 * null under 3s.
 */
export function imLineClock(ms: number, copy: AppCopy): string | null {
  if (ms < IM_LINE_CLOCK_AFTER_MS) return null;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return copy.conversation.seconds(String(totalSec));
  return copy.conversation.minutesSeconds(
    Math.floor(totalSec / 60),
    totalSec % 60,
  );
}

const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)+/;
/** More than the widest line shows (a 680px row of 12px text). */
const LINE_MAX_CHARS = 160;

/** The first line of `text` that says something, as one plain line:
 * block markers (heading, quote, list) and inline markdown out. */
export function imFirstLine(text: string | null | undefined): string | null {
  if (!text) return null;
  // Line by line from the top, not a split of the whole text: the
  // streaming buffer grows with every token, and only its head counts.
  // A line longer than one row is cut before cleaning (the row
  // truncates it anyway).
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const raw = text.slice(start, end === -1 ? text.length : end);
    const line = cleanSessionSummary(
      raw.slice(0, LINE_MAX_CHARS).replace(BLOCK_MARKER, ""),
    );
    if (line) return line;
    if (end === -1) break;
    start = end + 1;
  }
  return null;
}

/**
 * The line's sentence: the latest thing it wrote in this round — the
 * first line of the prose streaming right now, else the newest step's
 * narration since the user's last message (an ask_user answer starts a
 * new stretch: the narration before the question is stale once it has
 * asked), else null for 「思考中」. No guess at whether the streaming
 * prose is the answer: whatever streams is the line, and the reply
 * appears whole when the round settles (the ticket's deterministic
 * rule; the cost is that a long answer shows only once written).
 */
export function imLineSentence(
  turns: readonly Turn[],
  streaming: string,
): string | null {
  const live = imFirstLine(streaming);
  if (live) return live;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "user") break;
    if (turn.role !== "agent") continue;
    const line = imFirstLine(turn.finalAnswer ?? turn.preamble);
    if (line) return line;
  }
  return null;
}

/**
 * Line mode's plan for the settled conversation (Conversation draws it):
 *
 *   message   turns drawn as messages, outside any region: user turns
 *             (openers and ask_user answers), the greeting, a run's
 *             questions and its answer.
 *   question  agent turns drawn as their ask_user question only.
 *   steps     closing turn → its run's agent turns (the step region
 *             under the 「N 步 ›」 entry), for runs of two steps or more.
 *             The question steps are in it too (minus the echo); the
 *             answers are not.
 *   flat      turns of runs drawn the current way, by opener: runs
 *             without an answer that are not live, /btw exchanges,
 *             headless lead-ins (the greeting excepted).
 *
 * A live run shows its opener and its answered questions and their
 * answers; its steps show nothing (the line stands for them).
 */
export interface ImLinePlan {
  message: Set<number>;
  question: Set<number>;
  steps: Map<number, { opener: number; members: number[]; stats: RunStats }>;
  flat: Map<number, number>;
}

function asksUser(turn: Turn): boolean {
  return (
    turn.role === "agent" && turn.tools.some((tool) => tool.name === "ask_user")
  );
}

export function imLinePlan(
  groups: readonly RunGroup[],
  turns: readonly Turn[],
  liveGroup: RunGroup | null,
): ImLinePlan {
  const plan: ImLinePlan = {
    message: new Set(),
    question: new Set(),
    steps: new Map(),
    flat: new Map(),
  };
  for (const g of groups) {
    if (g === liveGroup || g.foldable) {
      const members: number[] = [];
      for (const i of g.memberIndices) {
        const turn = turns[i];
        if (i === g.openerIndex || turn.role === "user") {
          plan.message.add(i);
          continue;
        }
        if (turn.role !== "agent") continue;
        members.push(i);
        if (asksUser(turn)) {
          plan.message.add(i);
          plan.question.add(i);
        }
        if (i === g.finalTurnIndex) plan.message.add(i);
      }
      if (g !== liveGroup && g.finalTurnIndex != null && members.length >= 2) {
        plan.steps.set(g.finalTurnIndex, {
          opener: g.openerIndex,
          members,
          stats: g.stats,
        });
      }
      continue;
    }
    for (const i of g.memberIndices) {
      const turn = turns[i];
      if (i === g.openerIndex) {
        plan.message.add(i);
        continue;
      }
      // The greeting heads a headless group of its own and renders as
      // the plain answer it is (Conversation's current plan does the
      // same).
      if (turn.role === "agent" && turn.greeting) {
        plan.message.add(i);
        continue;
      }
      plan.flat.set(i, g.openerIndex);
    }
  }
  return plan;
}

// ---- Scroll: bottom ---------------------------------------------------------

/**
 * Where following the growth puts the scroll position in the bottom
 * mode: the bottom, unless that pushes the reply's start above the
 * anchor line (32px under the top) while it is still on screen — then
 * the start parks on the line and following stops (`detach`; the
 * 「回到底部」 button then shows its usual two signals). A start the
 * reader already scrolled past does not hold anything back.
 *
 * `replyStartOffset` is the reply start's top minus the container's
 * top (getBoundingClientRect), null when there is none.
 */
export function imFollowTop({
  scrollTop,
  scrollHeight,
  clientHeight,
  replyStartOffset,
  anchor,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  replyStartOffset: number | null;
  anchor: number;
}): { top: number; detach: boolean } {
  const bottom = Math.max(0, scrollHeight - clientHeight);
  if (replyStartOffset === null || replyStartOffset < anchor - 1) {
    return { top: bottom, detach: false };
  }
  const limit = scrollTop + replyStartOffset - anchor;
  return bottom > limit + 1
    ? { top: Math.max(0, limit), detach: true }
    : { top: bottom, detach: false };
}

/** The reply's start: the first element with a box after the latest user
 * message's row, in document order (the ticket's 「你的话后面的第一样
 * 东西」 — a fold header, the live window, the line, an answer, a
 * question). Null without a user message or anything after it. */
export function imReplyStart(container: HTMLElement): HTMLElement | null {
  const users = container.querySelectorAll<HTMLElement>(
    '[data-role="user-msg"], [data-role="user-msg-reply"]',
  );
  const bubble = users[users.length - 1];
  // MessageUser's row: the bubble's parent.
  let node: Element | null = bubble?.parentElement ?? null;
  while (node && node !== container) {
    for (
      let sibling = node.nextElementSibling;
      sibling;
      sibling = sibling.nextElementSibling
    ) {
      if (sibling.getBoundingClientRect().height > 0) {
        return sibling as HTMLElement;
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** The scroll container as the bottom mode uses it (an HTMLElement in the
 * app; a stand-in in tests). */
export interface ImScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { top: number };
}

/**
 * The bottom mode's follow (useStickyScroll's follow-the-bottom paths):
 * pin to the bottom unless that pushes the reply's start above the
 * anchor line; then park the start on the line. True when it parked
 * short of the bottom — following should stop.
 */
export function imFollowBottom(
  el: ImScrollBox & HTMLElement,
  anchor: number,
): boolean {
  const start = imReplyStart(el);
  const { top, detach } = imFollowTop({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    replyStartOffset: start
      ? start.getBoundingClientRect().top - el.getBoundingClientRect().top
      : null,
    anchor,
  });
  el.scrollTop = top;
  return detach;
}

/** The bottom mode's send: the new message lands right above the
 * composer (the caller then follows from the bottom). */
export function imScrollToBottom(el: ImScrollBox): void {
  el.scrollTop = el.scrollHeight;
}
