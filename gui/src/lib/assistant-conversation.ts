import type { AppCopy } from "@/i18n/types";
import type { RunGroup, RunStats } from "@/lib/run-groups";
import { cleanSessionSummary } from "@/lib/session-summary";
import type { Turn } from "@/types/conversation";

/**
 * The assistant's conversation (main chat PRD rulings 66, 67; spec:
 * docs/design/conversation.md 「助手的对话」): the main chat, open in the
 * main area, reads as a long IM with one person rather than as the
 * workbench's task record. MainView's `isMainChat` is the gate; every
 * other conversation (the workbench's, a subtask opened from the
 * assistant, the external runtime's) keeps the workbench rendering.
 *
 *   bubbles   on both sides: the user's words on the right (apricot),
 *             the assistant's replies, questions and greeting on the
 *             left (`bg-assistant-tint`); no avatar, no name. One
 *             side's consecutive messages sit 4px apart, a change of
 *             side 20px, and a reply's action row is the gap under it
 *             (`assistantRowGap`).
 *   process   while it works, one line at the conversation's end: the
 *             latest sentence it wrote (`assistantLineSentence`), with
 *             the round's clock past 3s, and nothing else. The reply
 *             appears whole once the round has its answer. A reply of
 *             two steps or more keeps a quiet 「N 步 · 用时 … ›」 that
 *             opens its steps in place; its questions and the user's
 *             answers stay in the conversation as messages; a run
 *             without an answer unfolds in full (`assistantLinePlan`).
 *   time      the send time at a break as a centred line between two
 *             messages, and one above the greeting.
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

/** The side of the message row above, for the row gap: a reply row
 * (`agent-bar`) ends with its action row's reserved 30px (the
 * hover-only copy / save, and the 「N 步 ›」 entry). */
export type AssistantRowSide = "user" | "agent" | "agent-bar";

/**
 * Top margin of a message row: 4px under a row on the same side (an IM
 * group), 20px (the workbench user message's my-5) when the side
 * changes or something else sits in between, and none under a reply's
 * action row, whose reserved 30px already is the gap (otherwise a
 * change of side reads 50px one way and 20px the other, and the
 * conversation falls into question–answer pairs).
 */
export function assistantRowGap(
  previous: AssistantRowSide | null,
  side: "user" | "agent",
): string {
  if (previous === "agent-bar") return "mt-0";
  return previous === side ? "mt-1" : "mt-5";
}

// ---- Process: one line --------------------------------------------------

/** Rounds shorter than this show no clock in the line (「超过 3 秒」, the
 * in-flight row's rule too). */
export const ASSISTANT_LINE_CLOCK_AFTER_MS = 3000;

/**
 * The round's clock for the line: the corner clock's own value and
 * format (RunElapsedHud: whole seconds, 「1 分 23 秒」 past a minute),
 * null under 3s.
 */
export function assistantLineClock(ms: number, copy: AppCopy): string | null {
  if (ms < ASSISTANT_LINE_CLOCK_AFTER_MS) return null;
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
export function assistantFirstLine(
  text: string | null | undefined,
): string | null {
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
 * appears whole when the round settles (a deterministic rule; the cost
 * is that a long answer shows only once written).
 */
export function assistantLineSentence(
  turns: readonly Turn[],
  streaming: string,
): string | null {
  const live = assistantFirstLine(streaming);
  if (live) return live;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "user") break;
    if (turn.role !== "agent") continue;
    const line = assistantFirstLine(turn.finalAnswer ?? turn.preamble);
    if (line) return line;
  }
  return null;
}

/**
 * What the conversation draws of each run (Conversation renders it):
 *
 *   message   turns drawn as messages, outside any region: user turns
 *             (openers and ask_user answers), the greeting, a run's
 *             questions and its answer.
 *   question  agent turns drawn as their ask_user question only.
 *   steps     closing turn → its run's agent turns (the step region
 *             under the 「N 步 ›」 entry), for runs of two steps or more.
 *             The question steps are in it too (minus the echo); the
 *             answers are not.
 *   flat      turns of runs drawn the workbench way, by opener: runs
 *             without an answer that are not live, /btw exchanges,
 *             headless lead-ins (the greeting excepted).
 *
 * A live run shows its opener and its answered questions and their
 * answers; its steps show nothing (the line stands for them).
 */
export interface AssistantLinePlan {
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
      // the plain answer it is (the workbench plan does the same).
      if (turn.role === "agent" && turn.greeting) {
        plan.message.add(i);
        continue;
      }
      plan.flat.set(i, g.openerIndex);
    }
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
 * message's row, in document order (「你的话后面的第一样东西」 — the live
 * line, an answer, a question, a run drawn in full). Null without a user
 * message or anything after it. */
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
