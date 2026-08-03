// Question-rail preview strings — turning `Turn[]` into the two lines
// the rail's hover tooltip shows: the question the user asked, and the
// answer that closed that exchange.
//
// Lives here rather than inside `UserQuestionRail.tsx` because the
// question→answer pairing has edge cases worth pinning in unit tests
// (multiple agent turns per question, agent turns that precede the
// first user message, answers whose first line carries no information),
// and the repo's test convention puts that kind of pure logic under
// `lib/` — see `lib/agent-turn.ts` + `lib/agent-turn.test.ts`.
//
// Why the answer preview is the final answer's first prose line and NOT
// `AgentTurn.summary`, despite summary being a purpose-built one-liner:
// summary is the agent's own working memory, not a reader-facing recap.
// The managed runtime's prompt (`managed-ga/code/llmcore.py`) asks for
// "上次工具调用结果产生的新信息 + 本次工具调用意图" and GA appends it
// straight into its own `history_info`. It points forward at the next
// tool call, so on a final-answer turn (`no_tool`, nothing to intend)
// its framing does not fit. The final answer is what the user would see
// on click, which is what a preview should be a thumbnail of.

import type { Turn } from "@/types/conversation";

/**
 * Characters kept per preview line before the CSS truncate takes over.
 * Both lines use the same budget so they cut at the same place and the
 * tooltip's width stays stable as the user moves between dots.
 */
export const PREVIEW_CHARS = 50;

/**
 * Turn a raw message into a clean one-line preview. Collapses all
 * whitespace (newlines in multi-line messages, runs of spaces) to
 * single spaces, strips a leading markdown marker run (heading #,
 * blockquote >, list bullet, code fence) so the preview reads as prose
 * rather than syntax, then truncates. Returns "" for whitespace-only
 * content; callers decide what to render for that.
 */
export function buildPreview(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const stripped = normalized
    .replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|`{1,3})/, "")
    .trim();
  if (stripped.length === 0) return "";
  return stripped.length > PREVIEW_CHARS
    ? stripped.slice(0, PREVIEW_CHARS).trimEnd() + "…"
    : stripped;
}

/**
 * First line of a markdown answer that carries actual prose.
 *
 * Skips blank lines and ATX headings: a long answer very often opens
 * with `## 结论`, and previewing that yields the word "结论" — a line
 * of pure structure with zero information about this particular answer.
 *
 * Deliberately does NOT skip anything else (opening code fences, list
 * markers, blockquotes). The rule stays one sentence long so its output
 * is predictable from reading the answer; `buildPreview` already strips
 * those markers from whatever line is picked.
 */
export function firstProseLine(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // ATX headings require the space; `#hashtag` is not a heading.
    if (/^#{1,6}\s/.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

/** One user question plus the answer that closed it. One entry per
 * user turn, in turn order — so indices align with the rail's
 * `[data-role="user-msg"]` DOM nodes. */
export interface RailExchange {
  /** Preview of the user's message. "" when the message was
   * whitespace-only; the rail renders a placeholder for that. */
  question: string;
  /** Preview of the answer, or null when there is nothing to show —
   * the agent is still working, the run was interrupted before a final
   * answer, or the answer had no previewable prose. */
  answer: string | null;
}

/**
 * Pair each user question with its answer.
 *
 * The answer is the **last** agent turn carrying a non-null
 * `finalAnswer` before the next user message. "Last" rather than "the
 * one whose tools are all `no_tool`" is a deliberate choice (2026-08-03
 * discussion): `finalAnswer` is computed on every `turn_end`, not only
 * on the closing turn, so an intermediate tool turn that wrote prose
 * beyond its "当前阶段：…" preamble also lands a non-null value. Taking
 * the last one keeps a preview in the interrupted-run case instead of
 * showing nothing.
 *
 * Agent turns that precede the first user message (restored history,
 * Goal narration opening a session) have no question to attach to and
 * are skipped. System turns are skipped everywhere.
 */
export function buildRailExchanges(turns: Turn[]): RailExchange[] {
  const exchanges: RailExchange[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      exchanges.push({ question: buildPreview(turn.content), answer: null });
      continue;
    }
    if (turn.role !== "agent") continue;
    if (turn.finalAnswer == null) continue;

    const current = exchanges[exchanges.length - 1];
    if (!current) continue;

    // Unconditional assignment — later answers overwrite earlier ones,
    // including overwriting with null when the closing turn has no
    // previewable prose. That is what "the last one wins" means.
    const preview = buildPreview(firstProseLine(turn.finalAnswer));
    current.answer = preview.length > 0 ? preview : null;
  }

  return exchanges;
}
