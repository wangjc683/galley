import { mergedAskUserArgs } from "@/lib/ask-user-candidates";
import type { AssistantLinePlan } from "@/lib/assistant-conversation";
import { wholeMessageQuote } from "@/lib/composer-quote";
import {
  isLeakedToolCallMarkup,
  stripGATags,
} from "@/lib/ipc/ga-output-cleaning";
import {
  deletableAt,
  isMenuBubble,
  messageRowIds,
  type DeletableMessage,
  type MessageDeleteBlock,
} from "@/lib/message-delete";
import type { RunGroup } from "@/lib/run-groups";
import type { Turn } from "@/types/conversation";

/**
 * A bubble's message menu in the assistant's conversation (main chat
 * ticket 38, PRD ruling 85): right-click a bubble, or the ⋯ at the end of
 * a reply's action bar or of the row under your bubble (ticket 53, PRD
 * ruling 105) — one list for both (layout-and-chrome: right-click
 * for the practised hand, ⋯ for whoever looks for it, the same actions
 * in the same order).
 *
 *   your message   复制 · 引用 ── 删除
 *   its reply      复制 · 引用 · 保存 · 展开过程 ── 删除
 *
 * The reply's are its action bar's actions on the same terms: 复制 and
 * 保存 take the answer's Markdown source, 展开过程 is the process button
 * (only under a reply of two steps or more, never greyed out instead),
 * and the bar's 引用 runs this menu's (ticket 47, PRD ruling 99).
 * The greeting is a reply with no process; a question it asked copies
 * and quotes its question (it has no bar). Yours copies your words as
 * sent (`userMessageCopyText`), and the row under your bubble offers
 * the same three on the same terms (ticket 53). 引用 quotes the whole
 * message, cut short when long
 * (`wholeMessageQuote`). 删除 is last, after a separator, and the only
 * item ever greyed: while it replies or waits for your answer, and for a
 * reply that started subtasks (lib/message-delete).
 */

export type MessageMenuAction =
  | "copy"
  | "quote"
  | "save"
  | "process"
  | "delete";

/** What a bubble's menu acts on. */
export interface MessageMenuTarget {
  /** 删除: the bubble as Core is asked about it. */
  deletable: DeletableMessage;
  /** 删除: the rows the page hides until Core has deleted them. */
  rowIds: string[];
  /** 复制: the text as it was written (a reply's Markdown); null: no
   * text to copy, no item. */
  copyText: string | null;
  /** 引用: the quote it makes; null: no item. */
  quoteText: string | null;
  /** 保存: the reply's Markdown; null: no item. */
  saveSource: string | null;
  /** 展开过程: the opener its process card is kept by (the conversation's
   * fold state); null: no process, no item. */
  processOpener: number | null;
}

export type MessageMenuEntry =
  | { kind: "copy" }
  | { kind: "quote" }
  | { kind: "save" }
  | { kind: "process"; open: boolean }
  | { kind: "separator" }
  | { kind: "delete"; block: MessageDeleteBlock | null };

/**
 * The menu of the bubble at `index`, or null when it has none (no bubble
 * of the assistant's conversation: lib/message-delete `isMenuBubble`).
 * `plan` and `groups` are the conversation's own.
 */
export function messageMenuTarget(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  groups: readonly RunGroup[],
  index: number,
): MessageMenuTarget | null {
  const deletable = deletableAt(turns, plan, groups, index);
  if (!deletable) return null;
  const turn = turns[index];
  if (turn.role !== "user" && turn.role !== "agent") return null;
  const question = plan.question.has(index);
  const text = bubbleText(turn, question)?.text ?? null;
  const base = {
    deletable,
    rowIds: messageRowIds(turns, groups, index),
    copyText: text,
    quoteText: messageQuoteText(turns, plan, index),
    saveSource: null,
    processOpener: null,
  };
  if (turn.role === "user" || question) return base;
  // A reply's answer (or the greeting): its bar's copy and save, none
  // when the answer is leaked tool-call markup (#22), as on the bar.
  return {
    ...base,
    saveSource: text,
    processOpener: plan.steps.get(index)?.opener ?? null,
  };
}

/**
 * The words a bubble's 复制 takes and its 引用 quotes from, null when it
 * has none: your message as sent; the question it asked (`question`:
 * the turn is drawn as its ask_user question); a reply's answer (or the
 * greeting), none when the answer is leaked tool-call markup (#22), as
 * on the bar. `markdown`: a reply's or a question's, read as Markdown
 * for the quote.
 */
function bubbleText(
  turn: Turn,
  question: boolean,
): { text: string; markdown: boolean } | null {
  if (turn.role === "user") {
    const text = userMessageCopyText(turn.content);
    return text === null ? null : { text, markdown: false };
  }
  if (turn.role !== "agent") return null;
  if (question) {
    const args = mergedAskUserArgs(turn.tools);
    const asked = args ? stripGATags(args.question) : "";
    return asked.trim() === "" ? null : { text: asked, markdown: true };
  }
  const answer = turn.finalAnswer ?? "";
  return answer.trim() === "" || isLeakedToolCallMarkup(answer)
    ? null
    : { text: answer, markdown: true };
}

/**
 * What 复制 takes from your message: the text as sent, the quotes at its
 * head and all; null when it has no words (an image alone): no 复制 in
 * its menu, and no copy chip under its bubble (ticket 53, the one
 * judgment for both).
 */
export function userMessageCopyText(content: string): string | null {
  return content.trim() === "" ? null : content;
}

/** Each bubble's quote, by its turn (turns are never edited in place: a
 * change is a new turn) and whether it is drawn as a question. */
const quotes = new WeakMap<Turn, { question: boolean; quote: string | null }>();

/**
 * 引用's text for the bubble at `index` (`wholeMessageQuote` of
 * `bubbleText`): the menu's item (`quoteText`) and the one judgment
 * behind both 引用 — the menu's item and a reply bar's chip (ticket 47,
 * `canQuoteMessage`). Null when there is nothing to quote: no text,
 * leaked tool-call markup, or nothing left once the Markdown is read as
 * it shows (a reply that is an image alone). Kept per turn: the bar asks
 * on every render of the conversation, and a long reply's Markdown is
 * read once, not per streamed chunk.
 */
export function messageQuoteText(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  index: number,
): string | null {
  const turn = turns[index];
  if (!turn) return null;
  const question = plan.question.has(index);
  const kept = quotes.get(turn);
  if (kept && kept.question === question) return kept.quote;
  const source = bubbleText(turn, question);
  const quote = source
    ? wholeMessageQuote(source.text, source.markdown) || null
    : null;
  quotes.set(turn, { question, quote });
  return quote;
}

/**
 * Whether the bubble at `index` offers 引用: it has a menu
 * (`isMenuBubble`, as `messageMenuTarget`) and the menu has the item
 * (`messageQuoteText`). What a reply bar's 引用 asks before it shows
 * (ticket 47), without building the menu's whole target.
 */
export function canQuoteMessage(
  turns: readonly Turn[],
  plan: AssistantLinePlan,
  index: number,
): boolean {
  return (
    isMenuBubble(turns, plan, index) &&
    messageQuoteText(turns, plan, index) !== null
  );
}

/** The menu's rows, in order: what `target` offers, then a separator and
 * 删除 (no separator when nothing comes before it). `processOpen`: the
 * process card is open (the item reads 收起过程). */
export function messageMenuEntries(
  target: MessageMenuTarget,
  {
    processOpen,
    block,
  }: { processOpen: boolean; block: MessageDeleteBlock | null },
): MessageMenuEntry[] {
  const entries: MessageMenuEntry[] = [];
  if (target.copyText !== null) entries.push({ kind: "copy" });
  if (target.quoteText !== null) entries.push({ kind: "quote" });
  if (target.saveSource !== null) entries.push({ kind: "save" });
  if (target.processOpener !== null) {
    entries.push({ kind: "process", open: processOpen });
  }
  if (entries.length > 0) entries.push({ kind: "separator" });
  entries.push({ kind: "delete", block });
  return entries;
}
