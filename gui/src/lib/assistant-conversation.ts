import {
  cleanPartialContent,
  extractLiveThinking,
  modelReplyEnd,
} from "@/lib/ipc/ga-output-cleaning";
import {
  buildRunGroups,
  isStep,
  stoppedPartway,
  type RunGroup,
  type RunStats,
} from "@/lib/run-groups";
import { cleanSessionSummary } from "@/lib/session-summary";
import {
  inReportRound,
  inSecondHalf,
  isReportRound,
  isSilentReport,
  type SubtaskDispatch,
} from "@/lib/subtasks";
import type { Turn } from "@/types/conversation";

/**
 * The assistant's conversation (main chat PRD rulings 66–69, 107, 110,
 * 134, 135, 159; spec: docs/design/conversation.md 「助手的对话」): the main
 * chat, open in the main area, reads as a long IM with one person rather
 * than as the workbench's task record. MainView's `isMainChat` is the
 * gate; every other conversation (the workbench's, a subtask opened from
 * the assistant, the external runtime's) keeps the workbench rendering.
 * Ruling 197 (ticket 146) draws the second half of a round of yours as
 * that round (process, reports below).
 *
 *   bubbles   on both sides: the user's words on the right (apricot),
 *             the assistant's replies, questions and greeting on the
 *             left (`bg-assistant-tint`); no avatar, no name. Spaced as
 *             an IM in two steps (ruling 199, `assistantRowGap`): 4px
 *             within a side, 16px across. The hover buttons take no
 *             room: a reply's action row hangs outside its bubble on the
 *             right, the row of your bubble (copy, quote, ⋯; ruling
 *             105) outside it on the left, bottom edges flush, 6px off
 *             (MessageActions, MessageUser). Until ruling 199 both hung
 *             under their bubble, and their hidden 30px was the gap.
 *   process   while it works, the typing bubble at the conversation's
 *             end (three dots, `typingBubbleShown`: a round you
 *             started from the send on, and the second half of one —
 *             the round Core woke it in with a subtask your round sent
 *             off, lib/subtasks.ts `inSecondHalf` — from the wake on;
 *             any other woken one only while it writes words — until
 *             you write into it), and in a round you started, or the
 *             second half of one, a line under it, 「{在做什么} ·
 *             {用时}」 (lib/assistant-progress.ts; the time from the
 *             send, or from the wake);
 *             what you say while it works (main chat ticket 136) is
 *             your bubble at the end, the dots and the line under it,
 *             going on; the reply answers it with the rest; a line
 *             it tells you before its reply (main chat ticket 137,
 *             `tell_user`) is a bubble of its own on its side, the
 *             dots and the line under it going on below it;
 *             no steps, no streaming prose. The bubble grows into the
 *             reply, the line fading out with the dots
 *             (lib/typing-bubble-handoff.ts). The header's second line
 *             says nothing while it runs; the sidebar card says what
 *             the screen does not — 「正在工作…」, away from the main
 *             chat 「正在输入…」 while it writes and the minutes from
 *             one on (a second half the same), in any other woken round
 *             「正在输入…」 with the dots (`assistantTyping`, the dots'
 *             own rule).
 *             The reply appears whole once the round has its answer.
 *             Nothing shows around it at rest: the action bar comes in
 *             on hover beside the bubble, icons only (copy, quote,
 *             save, for a reply of two steps or more the process
 *             button, then ⋯; the process button opens its steps in
 *             place as a card 4px under the reply: the
 *             round's numbers — 「4 步 · 用时 45 秒 · ↑33k ↓1.1k」 —
 *             then one line a step, eight at most before it scrolls
 *             (lib/assistant-process.ts); no context percentage
 *             anywhere). Its questions and the user's answers stay in
 *             the conversation as messages. A run without an answer
 *             (stopped, failed, at the step cap; ruling 159) is one
 *             line where its reply would be, 「中途停下 · N 步」, the
 *             same card opening under it (`assistantLinePlan`'s
 *             `stopped`).
 *   time      the send time at a break as a centred line between two
 *             messages, and one above the greeting.
 *   reports   a round Core woke it for (a subtask finished, asks or
 *             failed, tickets 29 / 31; a reminder came due; the daily
 *             review) draws no row of yours: its reply stands alone,
 *             dated by the report at a break, and a reply that said
 *             nothing (`<no-reply/>`) draws nothing at all. While it
 *             works it is drawn as above: the second half of a round of
 *             yours as that round (ruling 197: you sent something off
 *             and wait for it — merging what came back is the rest of
 *             your round), any other as a woken one. A second half that
 *             says nothing in the end (none so far) leaves nothing: its
 *             dots and their line fade where they stood (ruling 138).
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

/** The row above, as the conversation keeps it for the next row's top
 * margin and a time line's (Conversation's `prevSide`). In the
 * assistant's conversation, its side: `user` your message, `agent`
 * anything of its own — a reply, a line it told mid-run, a question it
 * asked, the greeting, the 「中途停下」 line — whatever hangs under it
 * (the cards, the candidates, an open process card) included. Its rows
 * end at their last box: since ruling 199 no hover row reserves room
 * under them. `agent-bar` is the workbench's reply, whose action row
 * still keeps its place under the answer (6 + 24 = 30px); only a time
 * line reads it (`endsWithActionRow`), and the assistant's conversation
 * never records it. The workbench's user message is `user` (its copy
 * row sits in the row's bottom margin, and a time line's own margin
 * collapses into it). */
export type AssistantRowSide = "user" | "agent" | "agent-bar";

/** Whether the row above ends with an action row's reserved 30px — the
 * workbench's reply (`agent-bar`): that row is the gap, and a time line
 * right under it adds nothing above. Never in the assistant's
 * conversation since ruling 199, where the hover rows take no room. */
export function endsWithActionRow(previous: AssistantRowSide | null): boolean {
  return previous === "agent-bar";
}

/**
 * Top margin of a message row in the assistant's conversation (ruling
 * 199): 4px under a row on the same side (an IM group: it → it, you →
 * you), 16px when the side changes (it → you, you → it), and 20px (the
 * workbench user message's my-5) when something else sits in between —
 * a run drawn flat, a system line — or nothing does; under a time line
 * its callers give the row `mt-5` themselves. 16px is 37% of a one-line
 * bubble (43px), Telegram's 32% a little looser: our leading is 1.55,
 * our bubbles fatter; not 12, which would read as the distance to
 * something that hangs under a bubble. Until ruling 199 every gap
 * between two bubbles was the 30px a hover row kept under the one above
 * (`mt-0` here), so the 4px groups hardly ever showed. What MainView
 * draws after the conversation takes the same gap from its last row
 * (`ASSISTANT_TAIL_GAP`).
 */
export function assistantRowGap(
  previous: AssistantRowSide | null,
  side: "user" | "agent",
): string {
  if (previous === null) return "mt-5";
  return (previous === "user") === (side === "user") ? "mt-1" : "mt-4";
}

/**
 * The side of the conversation's last row, as its root carries it
 * (`data-last-side`, the assistant's conversation only): `other` when
 * something else ends it — a time line, a run drawn flat — or nothing is
 * drawn.
 */
export type AssistantLastSide = "user" | "agent" | "other";

export function assistantLastSide(
  previous: AssistantRowSide | null,
): AssistantLastSide {
  if (previous === null) return "other";
  return previous === "user" ? "user" : "agent";
}

/**
 * The top margin of what MainView draws right after the assistant's
 * conversation, on its side: the typing bubble (TypingBubble) and the
 * live question (AskUserBubble). It is `assistantRowGap(last, "agent")`,
 * read off the conversation's root, the `peer` before them in the
 * column (`data-last-side`): 16px under your bubble, 4px under its last
 * reply (a woken round) or a line it told mid-run, 20px under anything
 * else. The reply that takes the typing bubble's place gets the same
 * value from `assistantRowGap`, so it opens where the dots stood
 * (lib/typing-bubble-handoff.ts), and so does the question. Until
 * ruling 199 neither had a top margin of its own: they stood under the
 * hover row's 30px. Tailwind reads class names as written, so the three
 * are spelled out; the tests pin them to `assistantRowGap`.
 */
export const ASSISTANT_TAIL_GAP =
  "peer-data-[last-side=user]:mt-4 peer-data-[last-side=agent]:mt-1 peer-data-[last-side=other]:mt-5";

/** The room a reply's action row takes beside its bubble (main chat PRD
 * ruling 199; MessageActions), which the reply bubble's cap leaves free
 * on its right (AssistantParts `ASSISTANT_BUBBLE_MAX`): five chips at
 * most — copy, quote, save, the process, ⋯ — 24px each (ActionChip),
 * 2px apart, 6px off the bubble's edge. 5 × 24 + 4 × 2 + 6 = 134px. */
export const ASSISTANT_BAR_CHIPS = 5;
export const ASSISTANT_BAR_CHIP_PX = 24;
export const ASSISTANT_BAR_CHIP_GAP_PX = 2;
export const ASSISTANT_BAR_OFFSET_PX = 6;
export const ASSISTANT_BAR_ROOM_PX =
  ASSISTANT_BAR_CHIPS * ASSISTANT_BAR_CHIP_PX +
  (ASSISTANT_BAR_CHIPS - 1) * ASSISTANT_BAR_CHIP_GAP_PX +
  ASSISTANT_BAR_OFFSET_PX;

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

/** No dispatch records: one array, for the callers that have none. */
const NO_DISPATCHES: readonly SubtaskDispatch[] = [];

let reportCache: {
  turns: readonly Turn[];
  dispatches: readonly SubtaskDispatch[];
  report: boolean;
} | null = null;

/** `inReportRound`, kept for the last turns and dispatch records: the
 * card's selector runs on every store write (each chunk), and both
 * change only when a row or a record lands. Two woken rounds read as
 * one you started: one you wrote into while it worked (main chat ticket
 * 136), from then on — you are waiting on it now; and the second half
 * of a round of yours (ruling 197, lib/subtasks.ts `inSecondHalf`: a
 * subtask your round sent off came back), from the wake on — you were
 * waiting on it all along. */
function cachedReportRound(
  turns: readonly Turn[],
  dispatches: readonly SubtaskDispatch[],
): boolean {
  if (reportCache?.turns === turns && reportCache.dispatches === dispatches) {
    return reportCache.report;
  }
  const report =
    inReportRound(turns) &&
    !endsInYourWordsMidRound(turns) &&
    !inSecondHalf(turns, dispatches);
  reportCache = { turns, dispatches, report };
  return report;
}

/** Whether the latest user turn is words said while the round worked
 * (main chat ticket 136). */
function endsInYourWordsMidRound(turns: readonly Turn[]): boolean {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "user") return turn.interjected === true;
  }
  return false;
}

/**
 * Whether the assistant reads as typing while its round runs (main chat
 * PRD rulings 107, 110): the conversation's dots, and in a round Core
 * woke it for the card's 「正在输入…」 too, say the same thing (a round
 * you started has the card's own words, rulings 134, 135: lib/
 * assistant.ts `workingLine`). A round you started types from the send
 * on, and so does the second half of one (ruling 197: Core woke it with
 * a subtask your round sent off, `inSecondHalf` over the main chat's
 * `dispatches`), from the wake on; any other round Core woke it for
 * (its opener a report row: lib/subtasks.ts `inReportRound` — a
 * reminder, the daily review, a subtask one of those sent off) only
 * while it writes words (`assistantWriting`) — it stops when a tool
 * dispatch shows and starts again when it writes again, as someone in
 * an IM types on and off; a silent one (`<no-reply/>`, held back by the
 * cleaning) never does. Without `dispatches` no woken round is a second
 * half.
 */
export function assistantTyping(
  turns: readonly Turn[],
  inFlightContent: string,
  dispatches: readonly SubtaskDispatch[] = NO_DISPATCHES,
): boolean {
  return (
    !cachedReportRound(turns, dispatches) || assistantWriting(inFlightContent)
  );
}

/**
 * Whether the conversation ends in the typing bubble. `live` is
 * MainView's condition for the round at the conversation's end
 * (running, the main chat, the round not settled — its answer landed,
 * or a silent report — and not asking you: it waits then, it is not
 * busy); within it, `assistantTyping`, with the main chat's dispatch
 * records. Only a live round reads the turns, so a workbench
 * conversation never touches the cache.
 */
export function typingBubbleShown(
  live: boolean,
  turns: readonly Turn[],
  inFlightContent: string,
  dispatches: readonly SubtaskDispatch[] = NO_DISPATCHES,
): boolean {
  if (!live) return false;
  return assistantTyping(turns, inFlightContent, dispatches);
}

// ---- While it runs: a step's first line -----------------------------------

const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)+/;
/** More than the widest line shows (the line under the typing bubble,
 * cut to its width). */
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
 * (`assistantTyping`; main chat PRD rulings 104, 110); in a round you
 * started or its second half (ruling 197), the line under the dots'
 * 「正在写回复」 and, away from the main chat, the card's 「正在输入…」
 * (rulings 134, 135;
 * lib/assistant-progress.ts, hooks/useAssistantProgress.ts). A
 * deterministic reading of this step's raw stream (`inFlightContent`;
 * turn_end clears it), no guess: no `<thinking>` left open
 * (`extractLiveThinking`), no tool dispatch started (`modelReplyEnd`:
 * GA's dispatch marker or its output fence follows the reply in the
 * same buffer, and the words before it are done), and words left once it
 * is cleaned as the conversation cleans it (`cleanedStream`). A reply that is only
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

/** A run's steps behind one control: the process button under its
 * answer, or the 「中途停下」 line of a run without one. */
export interface AssistantRunSteps {
  /** What the card's open state is kept by (Conversation's fold
   * overrides): the opener, else the run's first turn. */
  opener: number;
  /** The run's agent turns, in order: the card's rows are these minus
   * the answer and the steps that only asked (lib/assistant-process.ts
   * `assistantProcessSteps`). */
  members: number[];
  stats: RunStats;
}

/**
 * What the conversation draws of each run (Conversation renders it):
 *
 *   message   turns drawn as messages, outside any region: user turns
 *             (openers and ask_user answers), the greeting, a run's
 *             questions, the lines it told you mid-run (ticket 137) and
 *             its answer.
 *   question  agent turns drawn as their ask_user question only.
 *   steps     closing turn → its run's steps, for runs of two steps or
 *             more: the process card the button opens draws them.
 *   stopped   a run's last turn → its steps, for a run without an
 *             answer that is not live (run-groups `stoppedPartway`;
 *             ruling 159, ticket 114): right after that turn — after
 *             its questions and your answers, drawn as messages — one
 *             line, 「中途停下 · N 步」, which opens the same card over
 *             every step but the ones that only asked.
 *   flat      turns of runs drawn the workbench way, by opener: /btw
 *             exchanges, a run that ended on its own with nothing to
 *             say but tags (a dispatch whose cards are its words),
 *             headless lead-ins (the greeting excepted).
 *   reports   report row → the first row its round draws (lib/subtasks
 *             report rounds, tickets 29 / 31). The report row itself is
 *             never drawn: the reply after it is a left bubble with no
 *             bubble of yours before it, and the report's time, at a
 *             break, is the line above that first row (as the
 *             greeting's is above the greeting) — the 「中途停下」 line
 *             when that is the first. A round that draws nothing — a
 *             silent reply (`<no-reply/>`) without a question to the
 *             user, or one stopped before a step landed — has no entry:
 *             its report counts for no time either (`userTimeMarks`'
 *             `skip`).
 *
 * A live run shows its opener and its answered questions and their
 * answers; its steps show nothing (the typing bubble and the line under
 * it stand for them). A report round's opener is no message; a
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
  steps: Map<number, AssistantRunSteps>;
  stopped: Map<number, AssistantRunSteps>;
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

/**
 * The agent turns of the runs the main chat draws as the 「中途停下」
 * line at rest (run-groups `stoppedPartway`, the conversation's
 * grouping): steps
 * that are no message — the sidebar card's last message skips them but
 * a question among them (lib/assistant.ts `lastVisibleMessage`).
 */
export function stoppedRunTurns(turns: readonly Turn[]): Set<number> {
  const indices = new Set<number>();
  const groups = buildRunGroups(turns as Turn[], { splitAfterAnswer: true });
  for (const g of groups) {
    if (!stoppedPartway(g, turns, null)) continue;
    for (const i of g.memberIndices) {
      if (isStep(turns[i])) indices.add(i);
    }
  }
  return indices;
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
    stopped: new Map(),
    flat: new Map(),
    reports: new Map(),
  };
  for (const g of groups) {
    // A report round: Core's row opens it, and nobody sees that row.
    const report = isReportRound(g, turns);
    const firstDrawn = () => {
      if (!report) return;
      const first = g.memberIndices.find(
        (i) => plan.message.has(i) || plan.flat.has(i) || plan.stopped.has(i),
      );
      if (first !== undefined) plan.reports.set(g.openerIndex, first);
    };
    const stopped = stoppedPartway(g, turns, liveGroup);
    if (
      g === liveGroup ||
      g.foldable ||
      isSilentReport(g, turns) ||
      orphanReply(g, turns) ||
      stopped
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
        // A line told mid-run (ticket 137): a message, no step of the
        // card.
        if (turn.interim) {
          if (turn.finalAnswer !== null) plan.message.add(i);
          continue;
        }
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
      // Where its reply would be: after its last turn, your answer to
      // its last question included.
      if (stopped) {
        plan.stopped.set(g.memberIndices[g.memberIndices.length - 1], {
          opener: g.openerIndex,
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
      // the plain answer it is (the workbench plan does the same); a line
      // told mid-run (ticket 137) is a bubble here too.
      if (turn.role === "agent" && turn.greeting) {
        plan.message.add(i);
        continue;
      }
      if (turn.role === "agent" && turn.interim) {
        if (turn.finalAnswer !== null) plan.message.add(i);
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
