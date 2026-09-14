import type { Turn } from "@/types/conversation";

/**
 * ask_user candidate helpers — pure, shared by the live `AskUserBubble`
 * and the settled `AnsweredAskUser` echo so both surfaces make the same
 * layout call for the same candidates.
 */

export type CandidateLayout = "row" | "list";

/** At this many candidates a wrapped chip row stops reading as a set of
 *  options and becomes a tag cloud — stack them instead. */
export const CANDIDATE_LIST_MIN_COUNT = 5;
/** A single candidate longer than this is a sentence, not a label; a
 *  row of sentences loses its order and needs truncation + tooltips. */
export const CANDIDATE_LIST_MAX_ROW_CHARS = 20;
/** Even short candidates stack once the row would wrap anyway. */
export const CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS = 60;

/**
 * "row" = inline chips (short labels: 是 / 否 / 方案 A); "list" = one
 * full-width option per line, no truncation (sentence-length options,
 * or enough of them that the row would wrap). Models routinely emit
 * `A. 个人博客… → 推荐 2核-4G` style candidates: those are choices to
 * read top-to-bottom, not tags. Thresholds are deliberately exported
 * constants so they can be tuned from dogfood without touching layout.
 */
export function candidateLayout(candidates: string[]): CandidateLayout {
  if (candidates.length >= CANDIDATE_LIST_MIN_COUNT) return "list";
  let total = 0;
  for (const c of candidates) {
    const len = c.trim().length;
    if (len > CANDIDATE_LIST_MAX_ROW_CHARS) return "list";
    total += len;
  }
  return total > CANDIDATE_LIST_MAX_ROW_TOTAL_CHARS ? "list" : "row";
}

/**
 * Which candidate the user's reply was, or null for a free-form reply.
 * Exact match after trimming: a chip click sends the candidate text
 * verbatim, and anything edited (fill-in path) is by definition not
 * "the option as offered".
 */
export function chosenCandidateIndex(
  candidates: string[],
  answer: string | null | undefined,
): number | null {
  const a = answer?.trim();
  if (!a) return null;
  const i = candidates.findIndex((c) => c.trim() === a);
  return i >= 0 ? i : null;
}

/**
 * The user turn that answered the ask_user posed by `turns[agentIndex]`,
 * or undefined when it was never answered (still pending, or superseded
 * by a later agent run). Mirrors run-groups' membership rule: the next
 * user turn after an ask_user agent turn is its reply; system turns
 * (/btw, Goal narration) are bystanders. `replySet` is the run-groups
 * reply index set, passed in so the two views can never disagree.
 */
export function askUserReplyContent(
  turns: Turn[],
  agentIndex: number,
  replySet: ReadonlySet<number>,
): string | undefined {
  for (let j = agentIndex + 1; j < turns.length; j++) {
    const t = turns[j];
    if (t.role === "system") continue;
    if (t.role === "user") return replySet.has(j) ? t.content : undefined;
    return undefined;
  }
  return undefined;
}
