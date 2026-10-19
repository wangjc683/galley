import { isFinalAnswerTurn } from "@/lib/agent-turn";
import {
  cleanPartialContent,
  extractLiveThinking,
  modelReplyEnd,
} from "@/lib/ipc/ga-output-cleaning";
import type { RunGroup, RunStats } from "@/lib/run-groups";
import {
  cleanSessionSummary,
  isProtocolFailureSummary,
} from "@/lib/session-summary";
import { inReportRound, isReportRound, isSilentReport } from "@/lib/subtasks";
import type { Turn } from "@/types/conversation";

/**
 * The assistant's conversation (main chat PRD rulings 66–69, 107, 110;
 * spec: docs/design/conversation.md 「助手的对话」): the main chat, open
 * in the main area, reads as a long IM with one person rather than as
 * the workbench's task record. MainView's `isMainChat` is the gate; every
 * other conversation (the workbench's, a subtask opened from the
 * assistant, the external runtime's) keeps the workbench rendering.
 *
 *   bubbles   on both sides: the user's words on the right (apricot),
 *             the assistant's replies, questions and greeting on the
 *             left (`bg-assistant-tint`); no avatar, no name. A reply's
 *             action row is the gap under it, and so is the row under
 *             your bubble (copy, quote, ⋯ on hover; ruling 105): 30px
 *             after either; its own consecutive messages sit 4px apart
 *             (`assistantRowGap`).
 *   process   while it works, the typing bubble at the conversation's
 *             end (three dots, `typingBubbleShown`: a round you
 *             started from the send on, a woken one only while it
 *             writes words) and nothing else, no clock; it grows into
 *             the reply (lib/typing-bubble-handoff.ts). The header's
 *             second line says the newest settled step's sentence
 *             (`assistantSettledSentence`), the sidebar card
 *             「正在输入…」 (`assistantTyping`, the dots' own rule).
 *             The reply appears whole once the round has its answer.
 *             Under it nothing shows at rest: the action bar comes in
 *             on hover, icons only (copy, quote, save, for a reply of
 *             two steps or more the process button, then ⋯; the
 *             process button opens its steps in place as a card: the
 *             round's numbers — 「4 步 · 用时 45 秒 · ↑33k ↓1.1k」 —
 *             then one line a step, eight at most before it scrolls
 *             (lib/assistant-process.ts); no context percentage
 *             anywhere). Its questions and the user's answers stay in
 *             the conversation as messages; a run without an answer
 *             unfolds in full (`assistantLinePlan`).
 *   time      the send time at a break as a centred line between two
 *             messages, and one above the greeting.
 *   reports   a round Core woke it for (a subtask finished, asks or
 *             failed; tickets 29 / 31) draws no row of yours: its reply
 *             stands alone, dated by the report at a break, and a reply
 *             that said nothing (`<no-reply/>`) draws nothing at all.
 *   scroll    贴底: a short conversation stacks up from the composer, a
 *             send lands at the bottom, and following the growth stops
 *             before the reply's start leaves the viewport
 *             (`assistantFollowBottom`).
 *
 * Why both sides here when the workbench keeps one container and never
 * right-aligns (ruling 66): those two rules rest on the conversation
 * being a document, with one reading left edge, and on a right edge
 * crowding the question rail's dots. The assistant is meant to stop
 * reading as a document (ruling 60: a long-running chat with an
 * assistant, as with a person), and the main chat has no question rail.
 * No border, no shadow and no tail hold on both sides, here as there.
 */

// ---- Bubbles ----------------------------------------------------------

/** The side of the message row above, for the row gap. Two end with an
 * action row's reserved 30px, hidden until hovered: a reply row
 * (`agent-bar`: copy, quote, save, the process button, ⋯), and your
 * message in the assistant's conversation (`user-bar`, ruling 105,
 * ticket 53: copy, quote, ⋯ under the bubble). A question it asked
 * (`agent`) ends at its candidates. `user` is the workbench's user
 * message, which only a time line reads (the workbench has no IM gap;
 * its copy row sits in the row's bottom margin, and the line's own
 * margin collapses into it). */
export type AssistantRowSide = "user" | "user-bar" | "agent" | "agent-bar";

/** Whether the row above ends with an action row's reserved 30px (a
 * reply's, or your message's in the assistant's conversation): that row
 * is the gap, and neither the next message row nor a time line adds
 * anything above. */
export function endsWithActionRow(previous: AssistantRowSide | null): boolean {
  return previous === "agent-bar" || previous === "user-bar";
}

/**
 * Top margin of a message row: 4px under a row on the same side (an IM
 * group), 20px (the workbench user message's my-5) when the side
 * changes or something else sits in between, and none under an action
 * row, whose reserved 30px already is the gap (otherwise a change of
 * side reads 50px one way and 20px the other, and the conversation
 * falls into question–answer pairs). Since your message carries its row
 * too (ruling 105), both changes of side are 30px, and so are two of
 * yours in a row: no 4px group on your side (bursts are rare in the
 * main chat — none among your 9 messages in the database when ruling
 * 105 was made — so no second set of rules for them).
 */
export function assistantRowGap(
  previous: AssistantRowSide | null,
  side: "user" | "agent",
): string {
  if (endsWithActionRow(previous)) return "mt-0";
  return previous === side ? "mt-1" : "mt-5";
}

// ---- While it runs: the typing bubble ------------------------------------

/**
 * The typing bubble's dots, in the bubble's body size (em): twice
 * LiveDots' 3px dot and 2px gap at the standard tier's 15px (6px and
 * 4px), so they keep its proportions, and scale with ⌘= / ⌘− as the
 * reply's words do (TypingBubble).
 */
export const TYPING_DOT_EM = 0.4;
export const TYPING_DOT_GAP_EM = 4 / 15;
/** The dots' row width in em. */
export const TYPING_DOTS_WIDTH_EM = 3 * TYPING_DOT_EM + 2 * TYPING_DOT_GAP_EM;

let reportCache: { turns: readonly Turn[]; report: boolean } | null = null;

/** `inReportRound`, kept for the last turns array: the card's selector
 * runs on every store write (each chunk), and the turns change only
 * when a row lands. */
function cachedReportRound(turns: readonly Turn[]): boolean {
  if (reportCache?.turns === turns) return reportCache.report;
  const report = inReportRound(turns);
  reportCache = { turns, report };
  return report;
}

/**
 * Whether the assistant reads as typing while its round runs (main chat
 * PRD rulings 107, 110): the conversation's dots and the card's
 * 「正在输入…」 say the same thing. A round you started types from the
 * send on; a round Core woke it for (its opener a report row: lib/
 * subtasks.ts `inReportRound`) only while it writes words
 * (`assistantWriting`) — it stops when a tool dispatch shows and starts
 * again when it writes again, as someone in an IM types on and off; a
 * silent one (`<no-reply/>`, held back by the cleaning) never does.
 */
export function assistantTyping(
  turns: readonly Turn[],
  inFlightContent: string,
): boolean {
  return !cachedReportRound(turns) || assistantWriting(inFlightContent);
}

/**
 * Whether the conversation ends in the typing bubble. `live` is
 * MainView's condition for the round at the conversation's end
 * (running, the main chat, the round not settled — its answer landed,
 * or a silent report — and not asking you: it waits then, it is not
 * busy); within it, `assistantTyping`. Only a live round reads the
 * turns, so a workbench conversation never touches the cache.
 */
export function typingBubbleShown(
  live: boolean,
  turns: readonly Turn[],
  inFlightContent: string,
): boolean {
  if (!live) return false;
  return assistantTyping(turns, inFlightContent);
}

// ---- While it runs: the header's sentence ---------------------------------

const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)+/;
/** More than the widest line shows (the header's second line, cut to
 * its width). */
const LINE_MAX_CHARS = 240;

/** The first line of `text` that says something, as one plain line:
 * block markers (heading, quote, list) and inline markdown out. */
export function assistantFirstLine(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  // Line by line from the top, not a split of the whole text: only its
  // head counts. A line longer than one row is cut before cleaning (the
  // row truncates it anyway).
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
 * The header's second line while it runs (main chat PRD rulings 107,
 * 110): the sentence of the newest step that settled since your last
 * message (or the report row a woken round starts from) and has words —
 * its narration, or, when it wrote none, its summary (ruling 100) —
 * else null for 「思考中」. An ask_user answer starts a new stretch: what
 * it wrote before the question is stale once it has asked. What streams
 * is not read, so the reply's first line never shows here before the
 * reply; nor is the round's answer (a closing step, no tools) any
 * step's sentence: it lands as the bubble, and run_complete follows.
 * No clock: the dots and a sentence that changes with each step say it
 * is moving; the time is in the process card's first line.
 *
 * The summary (ruling 100, partly overturning ruling 68's 4th point,
 * which read the narration only): the main model writes none on most
 * tool steps — in October, 24 of gpt-6.1-sol's 29 rounds with tool
 * steps had no narration on any of them — so a narration-only rule said
 * 「思考中」 through a whole round. The summary is GA's working note
 * (「已查到…；接下来…」), but once the round settles the process card
 * shows it to the reader anyway (ticket 22). The newest step wins: a
 * step-1 narration does not hold the line once step 2 has written only
 * its summary.
 */
export function assistantSettledSentence(
  turns: readonly Turn[],
): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "user") break;
    if (turn.role !== "agent" || isFinalAnswerTurn(turn.tools)) continue;
    const line =
      assistantFirstLine(turn.finalAnswer ?? turn.preamble) ??
      assistantSummaryLine(turn.summary);
    if (line) return line;
  }
  return null;
}

/**
 * A step's summary as the header says it: the same cleaning as the
 * narration (`assistantFirstLine`: its first line, block markers and
 * markdown out, protocol tags and GA's 「...」 elision repaired by the
 * sidebar's recap cleaner). The runner already sends it clean and on one
 * line (GA joins its lines; workbench_bridge `_clean_turn_summary`), and
 * GA takes the inside of `<summary>`, so no tag is left to strip; the
 * cleaning covers rows from before that. A turn-protocol failure's
 * summary (the runner's fixed marker, or leaked tool-call markup) is no
 * sentence: nothing, as a step without one.
 */
function assistantSummaryLine(summary: string | undefined): string | null {
  if (!summary || isProtocolFailureSummary(summary)) return null;
  return assistantFirstLine(summary);
}

let settledCache: { turns: readonly Turn[]; sentence: string | null } | null =
  null;

/**
 * `assistantSettledSentence`, kept for the last turns array: the
 * header's selector runs on every store write (any session's, every
 * chunk), and a chunk leaves the turns as they were. A step's narration
 * and summary come with its turn_end, which appends a new turn (a new
 * `turns` array). The string result is what keeps the header from
 * re-rendering per chunk: a selector that returns an equal string
 * updates nothing.
 */
export function assistantCachedSettledSentence(
  turns: readonly Turn[],
): string | null {
  if (settledCache?.turns === turns) return settledCache.sentence;
  const sentence = assistantSettledSentence(turns);
  settledCache = { turns, sentence };
  return sentence;
}

// ---- While it runs: whether it writes words -------------------------------

let streamCache: { inFlightContent: string; cleaned: string } | null = null;

/**
 * The main chat's raw stream cleaned as MainView cleans it
 * (`cleanPartialContent`, trimmed), kept for the last stream: the
 * conversation's dots and the card read the same chunk with one regex
 * pass between them.
 */
function cleanedStream(inFlightContent: string): string {
  if (!inFlightContent) return "";
  if (streamCache?.inFlightContent === inFlightContent) {
    return streamCache.cleaned;
  }
  const cleaned = cleanPartialContent(inFlightContent).trim();
  streamCache = { inFlightContent, cleaned };
  return cleaned;
}

let writingCache: { inFlightContent: string; writing: boolean } | null = null;

/**
 * Whether the assistant is writing words right now — in a round Core
 * woke it for, the typing bubble and the card's 「正在输入…」
 * (`assistantTyping`; main chat PRD rulings 104, 110). A deterministic
 * reading of this step's raw stream (`inFlightContent`; turn_end clears
 * it), no guess: no `<thinking>` left open (`extractLiveThinking`), no
 * tool dispatch started (`modelReplyEnd`: GA's dispatch marker or its
 * output fence follows the reply in the same buffer, and the words
 * before it are done), and words left once it is cleaned as the
 * conversation cleans it (`cleanedStream`). A reply that is only
 * `<no-reply/>` — or the start of one, held back by the cleaning — has
 * none, nor has a step that so far wrote only tags, GA's markers or
 * whitespace.
 *
 * Kept for the last stream: the card's selector runs on every store
 * write, and the boolean is what keeps it from re-rendering per chunk —
 * it updates only when the answer flips.
 */
export function assistantWriting(inFlightContent: string): boolean {
  if (!inFlightContent) return false;
  if (writingCache?.inFlightContent === inFlightContent) {
    return writingCache.writing;
  }
  const writing =
    modelReplyEnd(inFlightContent) === -1 &&
    !extractLiveThinking(inFlightContent).open &&
    cleanedStream(inFlightContent) !== "";
  writingCache = { inFlightContent, writing };
  return writing;
}

/** The process button under a reply of two steps or more: whether its
 * steps are open, and the toggle (Conversation's run-fold overrides). */
export interface AssistantProcessToggle {
  open: boolean;
  onToggle: () => void;
}

/**
 * What the conversation draws of each run (Conversation renders it):
 *
 *   message   turns drawn as messages, outside any region: user turns
 *             (openers and ask_user answers), the greeting, a run's
 *             questions and its answer.
 *   question  agent turns drawn as their ask_user question only.
 *   steps     closing turn → its run's agent turns, for runs of two
 *             steps or more: the process card the button opens draws
 *             them, minus the answer and the steps that only asked
 *             (lib/assistant-process.ts `assistantProcessSteps`).
 *   flat      turns of runs drawn the workbench way, by opener: runs
 *             without an answer that are not live, /btw exchanges,
 *             headless lead-ins (the greeting excepted).
 *   reports   report row → the first row its round draws (lib/subtasks
 *             report rounds, tickets 29 / 31). The report row itself is
 *             never drawn: the reply after it is a left bubble with no
 *             bubble of yours before it, and the report's time, at a
 *             break, is the line above that first row (as the
 *             greeting's is above the greeting). A round that draws
 *             nothing — a silent reply (`<no-reply/>`) without a
 *             question to the user — has no entry: its report counts
 *             for no time either (`userTimeMarks`' `skip`).
 *
 * A live run shows its opener and its answered questions and their
 * answers; its steps show nothing (the typing bubble and the header's
 * sentence stand for them). A report round's opener is no message; a
 * silent one settles with its questions and their answers alone — no
 * answer, no process button, no steps.
 *
 * A reply whose message was deleted (ticket 32) is a headless group of
 * its own (run-groups `splitAfterAnswer`) and draws as the reply it was:
 * its answer, its questions, the process button over its steps. Its
 * process card's open state is keyed by its first turn, as there is no
 * opener.
 */
export interface AssistantLinePlan {
  message: Set<number>;
  question: Set<number>;
  steps: Map<number, { opener: number; members: number[]; stats: RunStats }>;
  flat: Map<number, number>;
  reports: Map<number, number>;
}

/** A headless group that is a whole reply: answered, agent turns only —
 * one whose message was deleted (ticket 32), or the greeting alone. */
function orphanReply(g: RunGroup, turns: readonly Turn[]): boolean {
  return (
    g.openerIndex < 0 &&
    g.complete &&
    g.memberIndices.every((i) => turns[i].role === "agent")
  );
}

function asksUser(turn: Turn): boolean {
  return (
    turn.role === "agent" && turn.tools.some((tool) => tool.name === "ask_user")
  );
}

export function assistantLinePlan(
  groups: readonly RunGroup[],
  turns: readonly Turn[],
  liveGroup: RunGroup | null,
): AssistantLinePlan {
  const plan: AssistantLinePlan = {
    message: new Set(),
    question: new Set(),
    steps: new Map(),
    flat: new Map(),
    reports: new Map(),
  };
  for (const g of groups) {
    // A report round: Core's row opens it, and nobody sees that row.
    const report = isReportRound(g, turns);
    const firstDrawn = () => {
      if (!report) return;
      const first = g.memberIndices.find(
        (i) => plan.message.has(i) || plan.flat.has(i),
      );
      if (first !== undefined) plan.reports.set(g.openerIndex, first);
    };
    if (
      g === liveGroup ||
      g.foldable ||
      isSilentReport(g, turns) ||
      orphanReply(g, turns)
    ) {
      const members: number[] = [];
      for (const i of g.memberIndices) {
        const turn = turns[i];
        if (i === g.openerIndex) {
          if (!report) plan.message.add(i);
          continue;
        }
        if (turn.role === "user") {
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
          opener: g.openerIndex >= 0 ? g.openerIndex : g.memberIndices[0],
          members,
          stats: g.stats,
        });
      }
      firstDrawn();
      continue;
    }
    for (const i of g.memberIndices) {
      const turn = turns[i];
      if (i === g.openerIndex) {
        if (!report) plan.message.add(i);
        continue;
      }
      // The greeting heads a headless group of its own and renders as
      // the plain answer it is (the workbench plan does the same).
      if (turn.role === "agent" && turn.greeting) {
        plan.message.add(i);
        continue;
      }
      plan.flat.set(i, g.openerIndex);
    }
    firstDrawn();
  }
  return plan;
}

// ---- Scroll: 贴底 ---------------------------------------------------------

/**
 * Where following the growth puts the scroll position: the bottom,
 * unless that pushes the reply's start above the anchor line (32px
 * under the top) while it is still on screen — then the start parks on
 * the line and following stops (`detach`; the 「回到底部」 button then
 * shows its usual two signals). A start the reader already scrolled
 * past does not hold anything back.
 *
 * `replyStartOffset` is the reply start's top minus the container's
 * top (getBoundingClientRect), null when there is none.
 */
export function assistantFollowTop({
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
 * message's row, in document order (「你的话后面的第一样东西」 — the
 * typing bubble, an answer, a question, a run drawn in full). Null
 * without a user message or anything after it. */
export function assistantReplyStart(
  container: HTMLElement,
): HTMLElement | null {
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

/** The scroll container as 贴底 uses it (an HTMLElement in the app; a
 * stand-in in tests). */
export interface AssistantScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  getBoundingClientRect(): { top: number };
}

/**
 * 贴底's follow (useStickyScroll's follow-the-bottom paths): pin to the
 * bottom unless that pushes the reply's start above the anchor line;
 * then park the start on the line. True when it parked short of the
 * bottom — following should stop.
 */
export function assistantFollowBottom(
  el: AssistantScrollBox & HTMLElement,
  anchor: number,
): boolean {
  const start = assistantReplyStart(el);
  const { top, detach } = assistantFollowTop({
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

/** 贴底's send: the new message lands right above the composer, at the
 * bottom (the workbench parks it 32px under the top instead); following
 * carries on from there. */
export function assistantScrollToBottom(el: AssistantScrollBox): void {
  el.scrollTop = el.scrollHeight;
}
