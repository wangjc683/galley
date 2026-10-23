import type { AppCopy } from "@/i18n/types";
import { isFinalAnswerTurn } from "@/lib/agent-turn";
import {
  assistantFirstLine,
  assistantTyping,
  assistantWriting,
} from "@/lib/assistant-conversation";
import { modelReplyEnd } from "@/lib/ipc/ga-output-cleaning";
import { isProtocolFailureSummary } from "@/lib/session-summary";
import type { Turn } from "@/types/conversation";

/*
 * TEMP variant switcher (main chat 90) — what 「新」 says while the main
 * chat runs (main chat PRD ruling 134; switcher and removal steps in
 * components/conversation/live-progress-variants/live-progress-variants.ts).
 * Kept if 「新」 wins, deleted with its test if 「现状」 does.
 *
 * In a round you started, a line under the typing bubble says
 * 「{在做什么} · {用时}」 (TypingBubble), and the sidebar card says
 * 「正在工作…」, away from the main chat 「正在输入…」 while it writes
 * and the whole minutes from one on (lib/assistant.ts
 * `assistantCardLine`). A round Core woke it for draws no line.
 */

// ---- 在做什么 ----------------------------------------------------------------

// A trailing 「；」 / 「;」 too: a summary that ends at its separator says
// the whole sentence (below), which should not end in one.
const END_PERIODS = /[。.；;]+$/;

function trimHalf(text: string): string {
  return text.trim().replace(END_PERIODS, "").trim();
}

/**
 * The half of a step's summary the line says. GA's summary is 「上次结果
 * 的新信息 + 本次意图」 (managed-ga llmcore's protocol prompts), so the
 * part after the last 「；」 or 「;」 is what it is doing now. The summary
 * is cleaned first as the header cleaned it (`assistantFirstLine`: one
 * line, block markers and markdown out, protocol tags and GA's 「...」
 * repaired); a turn-protocol failure's (`isProtocolFailureSummary`) is
 * none. Then the part after the last separator, its surrounding
 * whitespace and the 「。」 / 「.」 it ends with taken off; without a
 * separator, or with nothing after it, the whole sentence, trimmed the
 * same way and without the separator it ends with. Nothing is cut further (no cut at a comma): a long one is
 * the CSS truncation's. Null when nothing is left.
 */
export function assistantProgressHalf(
  summary: string | null | undefined,
): string | null {
  if (!summary || isProtocolFailureSummary(summary)) return null;
  const line = assistantFirstLine(summary);
  if (!line) return null;
  const cut = Math.max(line.lastIndexOf("；"), line.lastIndexOf(";"));
  const after = cut === -1 ? "" : trimHalf(line.slice(cut + 1));
  return after || trimHalf(line) || null;
}

/** GA's `smart_format(text, max_str_len=80)` (ga.py), which shortens the
 * summary it keeps: under 90 characters as is, else the first 40, 「 ...
 * 」, the last 40. Python counts code points, so these do too. */
function gaSmartFormat(text: string): string {
  const chars = Array.from(text);
  if (chars.length < 90) return text;
  return `${chars.slice(0, 40).join("")} ... ${chars.slice(-40).join("")}`;
}

/** What GA takes out of the reply before it looks for the summary: the
 * reasoning blocks its response parsers drop (llmcore
 * `_parse_mixed_response`, `NativeClaudeSession.ask`), then code fences
 * and closed thinking blocks (ga.py `turn_end_callback`). */
const GA_THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/g;
const GA_SUMMARY_NOISE = /```[\s\S]*?```|<thinking>[\s\S]*?<\/thinking>/g;
const GA_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;
const THINKING_OPEN = "<thinking>";

/**
 * The summary of the step streaming now, once its tool dispatch shows —
 * the summary GA will keep for it, so the line says the same sentence
 * when the step settles. Null before the dispatch (`modelReplyEnd`: GA's
 * dispatch marker follows the model's whole reply in the same buffer),
 * and without a closed `<summary>` before it. Read as GA reads the reply
 * (ga.py `turn_end_callback`): reasoning blocks, code fences and closed
 * `<thinking>` blocks out, the first `<summary>…</summary>`, trimmed, its
 * line breaks taken out, `smart_format`ted. A summary inside a
 * `<thinking>` that never closed is not one (the step's reply is over at
 * its dispatch, whatever it left open, as `extractLiveThinking` reads
 * it): the line keeps the step before until this one settles.
 *
 * Both streams have it before the marker: with native tool calls the
 * model's text (its `<summary>`, or the one GA writes from the first line
 * of its reasoning when it wrote no text: llmcore `_ensure_text_block`)
 * streams before the call, which is not in the stream at all; with GA's
 * text protocol `<summary>` and then `<tool_use>…</tool_use>` stream as
 * text. Either way GA's agent loop yields the dispatch marker only after
 * the whole reply.
 */
export function streamedStepSummary(inFlightContent: string): string | null {
  const end = modelReplyEnd(inFlightContent);
  if (end === -1) return null;
  let reply = inFlightContent
    .slice(0, end)
    .replace(GA_THINK_BLOCK, "")
    .replace(GA_SUMMARY_NOISE, "");
  const unclosed = reply.indexOf(THINKING_OPEN);
  if (unclosed !== -1) reply = reply.slice(0, unclosed);
  const match = GA_SUMMARY.exec(reply);
  if (!match) return null;
  return gaSmartFormat(match[1].trim().replace(/\n/g, ""));
}

/** The newest settled step of this stretch that called tools and has a
 * summary the line can say (`assistantProgressHalf`). */
function settledStepHalf(turns: readonly Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "user") break;
    if (turn.role !== "agent" || isFinalAnswerTurn(turn.tools)) continue;
    const half = assistantProgressHalf(turn.summary);
    if (half) return half;
  }
  return null;
}

/**
 * What the line under the typing bubble says it is doing (ruling 134),
 * for a round you started; null for a round Core woke it for (no line:
 * nobody is waiting on it). Within this stretch — from your last message,
 * or from your answer to its question (`assistantSettledSentence`'s
 * stretch):
 *
 *   1. writing words now (`assistantWriting`): 「正在写回复」;
 *   2. else this step's dispatch has shown with a closed summary before
 *      it (`streamedStepSummary`): that summary's half;
 *   3. else the newest settled step that called tools (not the round's
 *      answer) with a summary: its half — between two steps the last
 *      one stays, and once a step settles the line says what it said
 *      from its dispatch on;
 *   4. else 「思考中」 — before any step dispatched, and again after you
 *      answer its question.
 *
 * Without a dispatch the sentence does not change, so the closing step's
 * summary (a reply, no tools) never shows: the reply's conclusion is not
 * given away before it lands.
 */
export function assistantDoing(
  turns: readonly Turn[],
  inFlightContent: string,
  copy: AppCopy,
): string | null {
  // A round you started reads as typing with nothing streaming
  // (`assistantTyping`'s report-round check, kept for the last turns).
  if (!assistantTyping(turns, "")) return null;
  if (assistantWriting(inFlightContent)) {
    return copy.assistant.progressWriting;
  }
  return (
    assistantProgressHalf(streamedStepSummary(inFlightContent)) ??
    settledStepHalf(turns) ??
    copy.assistant.progressThinking
  );
}

// ---- 用时 -------------------------------------------------------------------

/**
 * The line's time: the round's whole seconds, its segments added up and
 * the time it waited on your answers left out — `RunElapsedHud`'s
 * figure (`baseMs + now - startedAtMs`, MainView's run clock and
 * `liveRunElapsedBaseMs`) in its words: 「12 秒」 under a minute, 「1 分
 * 12 秒」 from one on. Null under a second: the line then says only what
 * it is doing.
 */
export function assistantProgressElapsed(
  elapsedMs: number,
  copy: AppCopy,
): string | null {
  if (!(elapsedMs >= 1000)) return null;
  const totalSec = Math.floor(elapsedMs / 1000);
  if (totalSec < 60) return copy.conversation.seconds(String(totalSec));
  return copy.conversation.minutesSeconds(
    Math.floor(totalSec / 60),
    totalSec % 60,
  );
}

const MINUTE_MS = 60_000;

/** The card's whole minutes of the same figure, rounded down. */
export function assistantRunMinutes(
  baseMs: number,
  startedAtMs: number,
  nowMs: number,
): number {
  return Math.floor(Math.max(0, baseMs + nowMs - startedAtMs) / MINUTE_MS);
}

/** How long until that figure crosses its next whole minute. */
export function msToNextRunMinute(
  baseMs: number,
  startedAtMs: number,
  nowMs: number,
): number {
  const elapsed = Math.max(0, baseMs + nowMs - startedAtMs);
  return MINUTE_MS - (elapsed % MINUTE_MS);
}
