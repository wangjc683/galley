import { mergedAskUserArgs } from "@/lib/ask-user-candidates";
import type { AssistantLinePlan } from "@/lib/assistant-conversation";
import { wholeMessageQuote } from "@/lib/composer-quote";
import {
  isLeakedToolCallMarkup,
  stripGATags,
} from "@/lib/ipc/ga-output-cleaning";
import {
  deletableAt,
  messageRowIds,
  type DeletableMessage,
  type MessageDeleteBlock,
} from "@/lib/message-delete";
import type { RunGroup } from "@/lib/run-groups";
import type { Turn } from "@/types/conversation";

/**
 * A bubble's message menu in the assistant's conversation (main chat
 * ticket 38, PRD ruling 85): right-click a bubble, or the ⋯ at the end of
 * a reply's action bar — one list for both (layout-and-chrome: right-click
 * for the practised hand, ⋯ for whoever looks for it, the same actions
 * in the same order).
 *
 *   your message   复制 · 引用 ── 删除
 *   its reply      复制 · 引用 · 保存 · 展开过程 ── 删除
 *
 * The reply's are its action bar's actions on the same terms: 复制 and
 * 保存 take the answer's Markdown source, 展开过程 is the process button
 * (only under a reply of two steps or more, never greyed out instead).
 * The greeting is a reply with no process; a question it asked copies
 * and quotes its question (it has no bar). Yours copies your words as
 * sent. 引用 quotes the whole message, cut short when long
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
  const base = {
    deletable,
    rowIds: messageRowIds(turns, groups, index),
    saveSource: null,
    processOpener: null,
  };
  if (turn.role === "user") {
    const text = turn.content.trim() === "" ? null : turn.content;
    return {
      ...base,
      copyText: text,
      quoteText: text ? wholeMessageQuote(text, false) || null : null,
    };
  }
  if (turn.role !== "agent") return null;
  if (plan.question.has(index)) {
    const args = mergedAskUserArgs(turn.tools);
    const question = args ? stripGATags(args.question) : "";
    const text = question.trim() === "" ? null : question;
    return {
      ...base,
      copyText: text,
      quoteText: text ? wholeMessageQuote(text, true) || null : null,
    };
  }
  // A reply's answer (or the greeting): its bar's copy and save, none
  // when the answer is leaked tool-call markup (#22), as on the bar.
  const answer = turn.finalAnswer ?? "";
  const text =
    answer.trim() === "" || isLeakedToolCallMarkup(answer) ? null : answer;
  return {
    ...base,
    copyText: text,
    quoteText: text ? wholeMessageQuote(text, true) || null : null,
    saveSource: text,
    processOpener: plan.steps.get(index)?.opener ?? null,
  };
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
