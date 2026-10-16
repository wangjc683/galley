import type { AppCopy } from "@/i18n/types";
import { mergedAskUserArgs } from "@/lib/ask-user-candidates";
import { splitQuotedMessage } from "@/lib/composer-quote";
import { dropPathBasename } from "@/lib/file-drop";
import { stripGATags } from "@/lib/ipc/ga-output-cleaning";
import { hiddenReportTurns } from "@/lib/subtasks";
import type { MessageAttachment, Turn } from "@/types/conversation";
import type { SessionStatus } from "@/types/session";

/**
 * The assistant (main chat PRD rulings 60–65, ticket 18): the main
 * chat drawn as a person called Galley — a card at the top of the
 * sidebar, one row of an IM chat list, and, while it is open, an
 * identity row in the main header. Underneath it is still the one main
 * chat session; the managed runtime has it, the external one does not.
 *
 * Two lines speak for it, and they differ on purpose:
 *
 *   - The card's second line (`assistantCardLine`) is what a chat list
 *     says: the last message, or a state when there is one — an error
 *     over a question over running over an unsent draft over the last
 *     message. Away from the main chat (in the workbench, or in one of
 *     its subtasks) it speaks for it: the question itself, the sentence
 *     it is writing, the draft. With the main chat on screen they are
 *     all right there, so it says only the state: 「等你回复」,
 *     「思考中」, no draft (main chat PRD ruling 87).
 *   - The header's second line (`AssistantState.line`) is what a chat's
 *     own title bar says: only a state — running, waiting for a reply
 *     (not the question: it is right below, in the conversation), an
 *     error, a subtask's — and nothing at rest. The last message and
 *     the draft are both on screen there already.
 *
 * Running, what it is saying is said once, where you can read it: the
 * line at the end of the conversation (ruling 68: the sentence it is
 * writing, else its latest narration since your last message,
 * `assistantLineSentence`), and the card while the main chat is not on
 * screen. The header, and the card with the main chat on screen, say
 * 「思考中」 (ruling 87: the same sentence in three places was noise;
 * the short state still tells you it works when you have scrolled up) —
 * never a step count. The assistant reports no steps anywhere; the
 * subtasks it sends off are task conversations and keep their 「第 N 步」
 * (lib/subtasks.ts), as the workbench's session rows do.
 */

export type AssistantStateKind =
  | "error"
  | "ask"
  | "running"
  | "unread"
  | "idle";

export interface AssistantLine {
  text: string;
  tone: "running" | "warning" | "error";
}

export interface AssistantState {
  /** The avatar's mark and the name's weight: error, a question,
   * running, a new reply while the assistant is not open, or nothing. */
  kind: AssistantStateKind;
  /** The state's words — the header identity's second line; null for a
   * new reply and at rest. */
  line: AssistantLine | null;
  /** The error or the question is an unpromoted subtask's, not the main
   * chat's own (its words say so; the card then has no question to
   * quote). */
  fromSubtask: boolean;
}

export interface AssistantStateInput {
  /** The main chat's live status (useSessionStatusView). */
  status: SessionStatus;
  hasPendingAskUser: boolean;
  /** One of its unpromoted subtasks is erroring or asking (ticket 06a). */
  subtaskState?: "error" | "ask";
  hasUnread?: boolean;
  /** The main chat itself is on screen (not one of its subtasks: its
   * conversation is not in front of you there): nothing is unread. */
  open: boolean;
  /** While it runs: the line's sentence (`assistantCachedSentence`),
   * null for 「思考中」. */
  sentence?: string | null;
  errorCount?: number;
}

export const ASSISTANT_IDLE: AssistantState = {
  kind: "idle",
  line: null,
  fromSubtask: false,
};

/**
 * The assistant's state, in the session row's priority (layout-and-
 * chrome.md, Session Row): an error — its own or an unpromoted
 * subtask's — over a question — its own or a subtask's — over running,
 * over a new reply, over nothing. A stop or a step-cap pause is
 * nothing here: the card goes back to the last message.
 */
export function assistantState(
  input: AssistantStateInput,
  copy: AppCopy,
): AssistantState {
  // A subtask's error or question counts as the main chat's own, the
  // words aside (ticket 06a): the assistant is one person.
  const subtaskErrored =
    input.subtaskState === "error" && input.status !== "error";
  const subtaskAsking =
    input.subtaskState === "ask" &&
    !input.hasPendingAskUser &&
    input.status !== "error";
  if (input.status === "error" || subtaskErrored) {
    const count = input.errorCount || 0;
    const text = subtaskErrored
      ? copy.subtask.sidebarErrored
      : count > 1
        ? `${copy.sidebar.errored} · ${count}`
        : copy.sidebar.errored;
    return {
      kind: "error",
      line: { text, tone: "error" },
      fromSubtask: subtaskErrored,
    };
  }
  if (input.hasPendingAskUser || subtaskAsking) {
    const text = subtaskAsking
      ? copy.subtask.sidebarWaiting
      : copy.sidebar.waitingForYou;
    return {
      kind: "ask",
      line: { text, tone: "warning" },
      fromSubtask: subtaskAsking,
    };
  }
  if (input.status === "running") {
    return {
      kind: "running",
      line: { text: input.sentence || copy.sidebar.thinking, tone: "running" },
      fromSubtask: false,
    };
  }
  if (input.hasUnread && !input.open) {
    return { kind: "unread", line: null, fromSubtask: false };
  }
  return ASSISTANT_IDLE;
}

// ---- The card's second line ------------------------------------------

/** The last message in the conversation, as the card shows it. */
export interface AssistantLastMessage {
  /** The user said it (the card puts 「你：」 before it). */
  fromUser: boolean;
  /** One line of plain text. */
  text: string;
  /** When it was said: the user's send time; for the assistant's reply
   * or question, when that step landed (`AgentTurn.settledAt`). Absent
   * when the page has no time for it: the card then dates it by the
   * session's `lastActivityAt`, which the reply's last step set — but a
   * report round after it moves that too (main chat ticket 31), hence
   * the reply's own time first. */
  sentAt?: string;
}

/**
 * What the card's second line says, its prefix in its own colour:
 *
 *   error    「出错」 / 「出错 · N」 / 「子任务出错」          red
 *   ask      「等你回复：」 + the question, or 「等你回复」,   amber prefix
 *            or 「子任务在问你」
 *   running  the line's sentence / 「思考中」                   brand
 *   draft    「草稿：」 + the draft, or 「[图片]」 / 「[引用]」 brand prefix
 *   message  「你：」 for the user's own, then the message      muted
 *            (your own words: quotes it opens with are left out,
 *            「[引用]」 when there is nothing else — ticket 07)
 */
export type AssistantCardLine =
  | { kind: "error" | "running"; text: string }
  | { kind: "ask"; prefix: string | null; text: string }
  | { kind: "draft"; prefix: string; text: string }
  | { kind: "message"; prefix: string | null; text: string };

/** An unsent draft as the card quotes it (lib/composer-draft.ts). */
export interface AssistantDraft {
  text: string;
  /** How many images it holds. */
  imageCount: number;
  /** How many quotes wait above its input (ticket 07); absent is 0. */
  quoteCount?: number;
}

export function assistantCardLine(
  state: AssistantState,
  {
    question,
    draft,
    lastMessage,
    open,
  }: {
    /** The pending question's text (`PendingAskUser.question`), if the
     * page has it. */
    question?: string | null;
    draft?: AssistantDraft | null;
    lastMessage?: AssistantLastMessage | null;
    /** The main chat itself is on screen: its draft is in the composer
     * right there, its question in the conversation (ruling 87). */
    open: boolean;
  },
  copy: AppCopy,
): AssistantCardLine | null {
  if (state.line && (state.kind === "error" || state.kind === "running")) {
    return { kind: state.kind, text: state.line.text };
  }
  if (state.kind === "ask" && state.line) {
    const asked =
      state.fromSubtask || open ? "" : plainLine(question ?? "", copy);
    return asked
      ? { kind: "ask", prefix: copy.assistant.askPrefix, text: asked }
      : { kind: "ask", prefix: null, text: state.line.text };
  }
  if (draft && !open) {
    const text =
      flattenWhitespace(draft.text) ||
      (draft.imageCount > 0
        ? copy.assistant.image
        : (draft.quoteCount ?? 0) > 0
          ? copy.assistant.quote
          : "");
    if (text)
      return { kind: "draft", prefix: copy.assistant.draftPrefix, text };
  }
  if (lastMessage) {
    return {
      kind: "message",
      prefix: lastMessage.fromUser ? copy.assistant.youPrefix : null,
      text: lastMessage.text,
    };
  }
  return null;
}

// ---- The last message ------------------------------------------------

/**
 * The conversation's last visible message, as one line: the user's own
 * words (with 「[图片]」 / 「[文件] 名字」 for what they attached), or
 * the assistant's reply flattened from markdown (with 「[文件] 名字」
 * for the files it pointed at) — its greeting included, which is a
 * message too. What is not a message is skipped: steps that only ran
 * tools, `/btw` side questions and their replies (transient, kept off
 * the record), Galley's narration rows, and what a report round hides
 * (main chat ticket 31, `hiddenReportTurns`): the report row Core woke
 * it with, and the whole of a round that said nothing (`<no-reply/>`)
 * but a question it asked you. A question the assistant asked counts
 * as what it said.
 */
export function lastVisibleMessage(
  turns: readonly Turn[],
  copy: AppCopy,
): AssistantLastMessage | null {
  const hidden = hiddenReportTurns(turns);
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === "system" || hidden.has(i)) continue;
    if (turn.role === "user") {
      // A `/btw` question carries neither key (messages.ts's
      // isLatestRunTurn rule): it is not part of the conversation.
      if (turn.messageId === undefined && turn.clientRequestId === undefined) {
        continue;
      }
      // Your own words: the quotes a message opens with are the
      // assistant's (ticket 07), named only when nothing else is there.
      const { quotes, body } = splitQuotedMessage(turn.content);
      const text = [
        ...attachmentLabels(turn.attachments ?? [], copy),
        flattenWhitespace(body),
      ]
        .filter(Boolean)
        .join(" ");
      if (text) return { fromUser: true, text, sentAt: turn.createdAt };
      if (quotes.length > 0) {
        return {
          fromUser: true,
          text: copy.assistant.quote,
          sentAt: turn.createdAt,
        };
      }
      continue;
    }
    if (turn.finalAnswer !== null) {
      const text = [
        plainLine(turn.finalAnswer, copy),
        ...(turn.files ?? []).map((path) =>
          copy.assistant.file(dropPathBasename(path)),
        ),
      ]
        .filter(Boolean)
        .join(" ");
      if (text) return { fromUser: false, text, sentAt: turn.settledAt };
      continue;
    }
    const asked = mergedAskUserArgs(turn.tools);
    if (asked) {
      const text = plainLine(stripGATags(asked.question), copy);
      if (text) return { fromUser: false, text, sentAt: turn.settledAt };
    }
  }
  return null;
}

/** 「[图片]」 once for the images, 「[文件] 名字」 for anything else. */
function attachmentLabels(
  attachments: readonly MessageAttachment[],
  copy: AppCopy,
): string[] {
  const labels: string[] = [];
  if (attachments.some((a) => a.kind === "image")) {
    labels.push(copy.assistant.image);
  }
  for (const a of attachments) {
    if (a.kind !== "image") {
      labels.push(copy.assistant.file(dropPathBasename(a.path)));
    }
  }
  return labels;
}

function flattenWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Only the start of a long reply can show; the rest is not worth the
 * regexes. */
const PLAIN_LINE_SOURCE_CHARS = 2000;

/** Stands in for a code span while the rest of a line is unmarked. */
const CODE_SLOT = /\uE000(\d+)\uE001/g;

/**
 * Markdown as one line of plain text, for a preview: headings,
 * emphasis, strikethrough and inline code lose their marks; a link
 * keeps its text, an image becomes 「[图片]」 and a `[FILE:path]` marker
 * 「[文件] 名字」; list markers, quotes, code fences, rules and table
 * pipes go, so lists and tables run on in one line; whitespace
 * collapses. Code (spans and fenced blocks) is kept as written;
 * underscores inside words (snake_case) and lone asterisks (2 * 3)
 * stay.
 */
export function plainLine(markdown: string, copy: AppCopy): string {
  const code: string[] = [];
  const slot = (text: string) => {
    code.push(text);
    return `\uE000${code.length - 1}\uE001`;
  };
  const kept: string[] = [];
  let fenced = false;
  for (const raw of markdown.slice(0, PLAIN_LINE_SOURCE_CHARS).split("\n")) {
    let line = raw.trim();
    // Code fences and horizontal rules are structure, not words.
    if (/^(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (line) kept.push(slot(line));
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) continue;
    // A table's separator row: pipes, dashes and colons only.
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue;
    line = line
      .replace(/^(>\s?)+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "");
    // A table row's cells run on, one space apart.
    if (line.startsWith("|")) {
      line = line.replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, " ");
    }
    kept.push(line);
  }
  const text = kept
    .join(" ")
    .replace(
      /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g,
      (_, _ticks, inner: string) => slot(inner.trim()),
    )
    .replace(/\[FILE:([^\]]+)\]/g, (_, path: string) =>
      copy.assistant.file(dropPathBasename(path.trim())),
    )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ` ${copy.assistant.image} `)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(
      /<\/?(?:b|i|em|strong|u|s|del|ins|sub|sup|span|div|p|small|mark|kbd|code|details|summary)(?:\s[^>]*)?>/gi,
      "",
    )
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
    .replace(CODE_SLOT, (_, index: string) => code[Number(index)] ?? "");
  return flattenWhitespace(text);
}

/** ⌘K finds the assistant by its old name and its role too, in either
 * UI language (palette-search.ts). */
export const ASSISTANT_SEARCH_KEYWORDS = "主对话 助理 助手 main chat assistant";
