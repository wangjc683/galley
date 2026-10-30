// Run grouping — the single source of truth shared by the conversation
// fold (Conversation.tsx) and the question rail (rail-preview.ts).
//
// A "run" is one user request plus everything the agent did to answer
// it: the opening user turn, the agent steps, any ask_user replies the
// user sent mid-run, and the closing final-answer turn. Both consumers
// previously derived their own notion of "one exchange" (the rail
// counted every user turn; the conversation had none) — aligning them
// on one grouping function is what keeps the rail's data↔DOM index
// contract intact when the fold starts removing turns from the DOM.
//
// ask_user replies have NO durable marker: `created_via` distinguishes
// the bridge command (`ask_user_response`) but is not persisted per
// message, so restore cannot read it back. The heuristic — a user turn
// following an agent turn whose tools include `ask_user` is a reply —
// reads the tool audit trail that IS persisted (`tool_calls` JSON).
// Live and restore run the same heuristic so both paths group (and
// render) identically, the same consistency argument as agent-turn.ts.
// Known limit: abort while an ask_user is pending, then send a fresh
// question → that question is misgrouped as a reply. Its group has no
// final answer so it never folds; the cost is one missing rail dot
// (and, since 2026-09-18, its steps continue the earlier run's
// numbering instead of restarting at 1).
//
// Segments (2026-09-18): every ask_user pause ends one GA
// `agent_runner_loop` and the reply starts another, so a run with N
// answered questions is N+1 GA loops. The runner's per-loop clock and
// token baseline reset at each `put_task`, and its cumulative telemetry
// rides on the last turn_end of each loop — the ask_user turn for a
// paused segment, the closing turn for the final one. Whole-run
// numbers are therefore the SUM over those segment closers, not the
// closing turn's telemetry alone (which only covers the last segment,
// while `stepCount` always spanned the whole run — the mismatch JC
// reported as "10 步 · 45 秒" after a two-minute run). A segment whose
// closer carries no telemetry (pre-telemetry rows) makes the
// whole-run figure unknown: a partial sum is a plausible wrong number,
// worse than none.

import { askUserQuestionCount } from "@/lib/ask-user-candidates";
import type { AgentTurn, MessageTelemetry, Turn } from "@/types/conversation";

export interface RunToolCount {
  name: string;
  count: number;
}

export interface RunStats {
  /** Number of agent turns ("第 N 步" rows) in the run. */
  stepCount: number;
  /** Whole-run elapsed time: the sum of every segment closer's
   * cumulative telemetry (see the segments note above). null while the
   * run is open, or when any segment lacks it. */
  elapsedMs: number | null;
  /** Whole-run telemetry for the answer footer: additive fields
   * (elapsed, tokens, request count) summed across segments — a field
   * any segment lacks is null — and the context snapshot taken from
   * the last segment. null while the run is open. */
  telemetry: MessageTelemetry | null;
  /** Per-tool dispatch counts, first-appearance order. Excludes
   * `no_tool` (null-op) and `ask_user` (surfaced as askUserCount). */
  toolCounts: RunToolCount[];
  /** Tools the user denied. The only settled anomaly with a durable
   * signal — `failed` is live-only (tool-outcome.ts refuses to guess
   * failure from result content), so it cannot be counted here. */
  deniedCount: number;
  /** ask_user questions the agent raised mid-run. */
  askUserCount: number;
}

export interface RunGroup {
  /** Index into `turns` of the opening user turn; -1 for a headless
   * leading group (agent turns before the first user message). */
  openerIndex: number;
  /** Indices of every member turn, ascending and contiguous,
   * including the opener. */
  memberIndices: number[];
  /** Index of the closing final-answer agent turn; null while the
   * run is live / aborted / waiting on ask_user. */
  finalTurnIndex: number | null;
  /** True when the run ended with a real final answer. */
  complete: boolean;
  /** True when the conversation may render this run folded: complete
   * and free of system turns (/btw exchanges must not be swallowed).
   * Single-step runs folded too from 2026-08-06 (reversing the launch
   * decision: the header had become the only home of settled run
   * duration); since 2026-10-16 the workbench draws them as their
   * answer alone instead, with no header at all — see
   * `answeredInOneStep`. */
  foldable: boolean;
  /** The run-shape half of `foldable` (user-opened, no system turns).
   * While the run is still live this is what lets the conversation
   * render it as the live window — completed steps
   * folded behind a live header, the last one plus the in-flight row
   * left open (live-run-window PRD, 2026-09-16). `foldable` is
   * `complete && foldEligible`. */
  foldEligible: boolean;
  stats: RunStats;
}

function hasAskUserTool(turn: AgentTurn): boolean {
  return turn.tools.some((t) => t.name === "ask_user");
}

interface SegmentCloser {
  /** The last agent turn of one GA loop inside the run — the turn that
   * carries that loop's cumulative telemetry. */
  turn: AgentTurn;
  /** True when a user turn (an ask_user reply) follows the segment,
   * i.e. the loop ended in a pause the user has already answered. */
  answered: boolean;
}

/** Split a group's members into GA loops at its user turns (the
 * opener excluded) and return each loop's last agent turn. A loop with
 * no agent turn yet (a reply just sent) contributes nothing. */
function segmentClosers(
  memberIndices: number[],
  openerIndex: number,
  turns: Turn[],
): SegmentCloser[] {
  const closers: SegmentCloser[] = [];
  let last: AgentTurn | null = null;
  for (const i of memberIndices) {
    if (i === openerIndex) continue;
    const t = turns[i];
    if (t.role === "user") {
      if (last) closers.push({ turn: last, answered: true });
      last = null;
    } else if (t.role === "agent") {
      last = t;
    }
  }
  if (last) closers.push({ turn: last, answered: false });
  return closers;
}

const ADDITIVE_TELEMETRY_FIELDS = [
  "elapsedMs",
  "inputTokens",
  "outputTokens",
  "cacheCreateTokens",
  "cacheReadTokens",
  "requestCount",
] as const;
const SNAPSHOT_TELEMETRY_FIELDS = [
  "contextUsedChars",
  "contextLimitChars",
] as const;

/** Whole-run telemetry from the segment closers, per the field rules on
 * `RunStats.telemetry`. */
function mergeRunTelemetry(closers: SegmentCloser[]): MessageTelemetry | null {
  if (closers.length === 0) return null;
  const merged: MessageTelemetry = {};
  for (const field of ADDITIVE_TELEMETRY_FIELDS) {
    let sum = 0;
    let known = true;
    for (const { turn } of closers) {
      const value = turn.telemetry?.[field];
      if (typeof value !== "number") {
        known = false;
        break;
      }
      sum += value;
    }
    merged[field] = known ? sum : null;
  }
  const last = closers[closers.length - 1].turn.telemetry;
  for (const field of SNAPSHOT_TELEMETRY_FIELDS) {
    merged[field] = last?.[field] ?? null;
  }
  return merged;
}

/** Closing-turn test, aligned with Conversation.tsx's `isFinalTurn`
 * (tools minus ask_user are all `no_tool`) plus the two conditions
 * that make it an actual conclusion: no pending ask_user on the same
 * turn, and a non-empty answer body. */
function isClosingTurn(turn: AgentTurn): boolean {
  if (hasAskUserTool(turn)) return false;
  const visible = turn.tools.filter((t) => t.name !== "ask_user");
  if (!visible.every((t) => t.name === "no_tool")) return false;
  return (turn.finalAnswer ?? "").trim() !== "";
}

/**
 * Group `turns` into runs.
 *
 * `splitAfterAnswer` (the main chat, ticket 32): an agent turn that
 * follows an answer (a closing turn) with no user turn between them
 * opens a headless group of its own instead of joining the answered
 * run. That only happens once the user's message between two replies
 * was deleted; without the split the later reply would swallow the
 * earlier one, its answer turned into a step of the later run. Core
 * groups the rows the same way when it works out which rows a deleted
 * reply is (`core/src/message_delete.rs`). Off elsewhere: GA can go on
 * after a turn that looks closing (it asks a reply that is only a code
 * block to explain itself), which this would split.
 */
export function buildRunGroups(
  turns: Turn[],
  options: { splitAfterAnswer?: boolean } = {},
): RunGroup[] {
  interface OpenGroup {
    openerIndex: number;
    memberIndices: number[];
    hasSystem: boolean;
    /** True while the group's last agent turn carries an ask_user
     * tool — the state in which the next user turn is a reply. */
    awaitingReply: boolean;
    /** True while the group's last agent turn is an answer. */
    answered: boolean;
  }

  const groups: RunGroup[] = [];
  let current: OpenGroup | null = null;

  const finalize = (g: OpenGroup) => {
    const agentTurns: AgentTurn[] = [];
    let lastAgentIndex: number | null = null;
    for (const i of g.memberIndices) {
      const t = turns[i];
      if (t.role === "agent") {
        agentTurns.push(t);
        lastAgentIndex = i;
      }
    }

    const lastAgent = agentTurns[agentTurns.length - 1];
    const complete = lastAgent !== undefined && isClosingTurn(lastAgent);
    const finalTurnIndex = complete ? lastAgentIndex : null;

    const toolCounts: RunToolCount[] = [];
    let deniedCount = 0;
    let askUserCount = 0;
    for (const turn of agentTurns) {
      // Distinct questions, not ask_user tool entries: a model that
      // splits one question into N single-candidate calls asked once.
      askUserCount += askUserQuestionCount(turn.tools);
      for (const tool of turn.tools) {
        if (tool.status === "denied") deniedCount++;
        if (tool.name === "ask_user") continue;
        if (tool.name === "no_tool") continue;
        const entry = toolCounts.find((c) => c.name === tool.name);
        if (entry) entry.count++;
        else toolCounts.push({ name: tool.name, count: 1 });
      }
    }

    const foldEligible = g.openerIndex >= 0 && !g.hasSystem;
    const telemetry = complete
      ? mergeRunTelemetry(segmentClosers(g.memberIndices, g.openerIndex, turns))
      : null;

    groups.push({
      openerIndex: g.openerIndex,
      memberIndices: g.memberIndices,
      finalTurnIndex,
      complete,
      foldable: complete && foldEligible,
      foldEligible,
      stats: {
        stepCount: agentTurns.length,
        elapsedMs: telemetry?.elapsedMs ?? null,
        telemetry,
        toolCounts,
        deniedCount,
        askUserCount,
      },
    });
  };

  turns.forEach((turn, index) => {
    if (turn.role === "user") {
      if (current && current.awaitingReply) {
        // Reply to the pending ask_user — stays inside the run.
        current.memberIndices.push(index);
        current.awaitingReply = false;
        return;
      }
      if (current) finalize(current);
      current = {
        openerIndex: index,
        memberIndices: [index],
        hasSystem: false,
        awaitingReply: false,
        answered: false,
      };
      return;
    }
    if (
      options.splitAfterAnswer &&
      turn.role === "agent" &&
      current &&
      !current.awaitingReply &&
      current.answered
    ) {
      finalize(current);
      current = null;
    }
    if (!current) {
      // Orphan leading turns (restored history, narration before the
      // first user message) — collected into a headless group.
      current = {
        openerIndex: -1,
        memberIndices: [],
        hasSystem: false,
        awaitingReply: false,
        answered: false,
      };
    }
    current.memberIndices.push(index);
    if (turn.role === "system") current.hasSystem = true;
    if (turn.role === "agent") {
      current.awaitingReply = hasAskUserTool(turn);
      current.answered = isClosingTurn(turn);
    }
  });
  if (current) finalize(current);

  return groups;
}

/**
 * The run the conversation renders as the live window, or null: the
 * last run, while it is still open (no answer yet), window-eligible,
 * and being worked on — the agent running, or waiting on an ask_user
 * reply, so the pause does not flicker the window away and back. An
 * open run that is neither (aborted, or a restored tail) gets no
 * window: a run without an answer is never hidden (the main chat draws
 * it as one line that opens its steps: main chat PRD ruling 159).
 */
export function liveRunGroup(
  groups: RunGroup[],
  agentRunning: boolean,
  askUserPending: boolean,
): RunGroup | null {
  const last = groups[groups.length - 1];
  if (!last || last.complete || !last.foldEligible) return null;
  return agentRunning || askUserPending ? last : null;
}

/**
 * A settled run that answered in one step: the closing turn is its
 * only agent turn. The workbench draws it as the answer alone — no
 * fold header, no step marker, no StrongHr (workbench conversation PRD
 * ruling 7, as the assistant leaves nothing of a one-step round); its
 * tokens and context stay in the answer's hover row. The rule reads
 * the step count and nothing else: on the dogfood data none of the 46
 * one-step replies carried reasoning or a preamble. Such a run never
 * ran a tool either — the closing turn is all `no_tool` by definition
 * (`isClosingTurn`), and any real tool call would have been a step of
 * its own before it. The cost is its duration, which only the header
 * showed (2026-08-06), and the step's DetailPanel.
 */
export function answeredInOneStep(group: RunGroup): boolean {
  return group.complete && group.stats.stepCount === 1;
}

/**
 * Turn index → display step number for every agent turn in a
 * user-opened run: 1-based, by position within the run (2026-09-18).
 * GA restarts its turn counter at every `put_task`, which is each
 * ask_user reply, so an ordinary run's steps would read 1 2 3 1 2
 * around a question; position numbering hides the restart and the
 * internal-row gaps restore would otherwise show. Headless leading
 * groups are absent and fall back to GA's own step.
 */
export function runStepNumbers(
  groups: RunGroup[],
  turns: Turn[],
): Map<number, number> {
  const stepNumberOf = new Map<number, number>();
  for (const g of groups) {
    if (g.openerIndex < 0) continue;
    let step = 0;
    for (const i of g.memberIndices) {
      if (turns[i].role === "agent") stepNumberOf.set(i, ++step);
    }
  }
  return stepNumberOf;
}

/** True when the live window already holds a settled step above the
 * in-flight row — the signal MainView uses to run the in-flight rail
 * up through the gap to the window instead of starting fresh. */
export function liveWindowHasSettledStep(
  liveGroup: RunGroup | null,
  turns: Turn[],
): boolean {
  if (!liveGroup) return false;
  return liveGroup.memberIndices.some(
    (i) =>
      i !== liveGroup.openerIndex &&
      i !== liveGroup.finalTurnIndex &&
      turns[i].role === "agent",
  );
}

/**
 * Display-step base for the GA loop the next user turn starts: the
 * number of steps the trailing run already holds when that turn is an
 * ask_user reply, 0 when it opens a new run. Call BEFORE appending the
 * user turn. The live path adds this to GA's per-loop step (which
 * restarts at 1 on every `put_task`) so the in-flight marker and the
 * sidebar's "第 N 步" continue the run's numbering the way
 * `runStepNumbers` numbers settled steps by position.
 */
export function pendingReplyStepBase(turns: Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "system") continue;
    if (turn.role !== "agent" || !hasAskUserTool(turn)) return 0;
    const groups = buildRunGroups(turns);
    return groups.length ? groups[groups.length - 1].stats.stepCount : 0;
  }
  return 0;
}

/**
 * Run time the trailing run's answered segments already banked — the
 * base the live elapsed HUD adds the current GA loop to, so its clock
 * does not snap back to zero at an ask_user reply and then disagree
 * with the settled header's whole-run figure. Unlike `RunStats`, a
 * segment without telemetry contributes 0 here: the HUD is a liveness
 * signal and must keep ticking; only the settled figure is allowed to
 * go blank.
 */
export function liveRunElapsedBaseMs(turns: Turn[]): number {
  const groups = buildRunGroups(turns);
  const g = groups[groups.length - 1];
  if (!g || g.complete) return 0;
  let total = 0;
  const closers = segmentClosers(g.memberIndices, g.openerIndex, turns);
  for (const { turn, answered } of closers) {
    if (!answered) continue;
    const value = turn.telemetry?.elapsedMs;
    if (typeof value === "number") total += value;
  }
  return total;
}

/** Convenience for consumers that only need "is this user turn an
 * ask_user reply" (MessageUser data-role switching): the set of user
 * turn indices that are NOT run openers. */
export function replyUserIndices(groups: RunGroup[], turns: Turn[]): Set<number> {
  const replies = new Set<number>();
  for (const g of groups) {
    for (const i of g.memberIndices) {
      if (i !== g.openerIndex && turns[i].role === "user") replies.add(i);
    }
  }
  return replies;
}
