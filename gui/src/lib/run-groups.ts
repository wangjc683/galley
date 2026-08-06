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
// final answer so it never folds; the cost is one missing rail dot.

import type { AgentTurn, Turn } from "@/types/conversation";

export interface RunToolCount {
  name: string;
  count: number;
}

export interface RunStats {
  /** Number of agent turns ("第 N 步" rows) in the run. */
  stepCount: number;
  /** Whole-run elapsed time from the closing turn's telemetry (the
   * runner's final-turn telemetry is cumulative). null when absent. */
  elapsedMs: number | null;
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
  /** True when the conversation may render this run folded: complete,
   * not a Goal run, and free of system turns (/btw exchanges must not
   * be swallowed). Single-step runs fold too (2026-08-06, reversing
   * the launch decision): the header became the only home of settled
   * run duration when the footer ⏱ was removed — absence now loses
   * data, not just uniformity — and since the folded render dropped
   * its StrongHr, header + answer is quieter than the unfolded
   * marker + rule + answer, so the fold pays even with nothing to
   * hide. */
  foldable: boolean;
  stats: RunStats;
}

function hasAskUserTool(turn: AgentTurn): boolean {
  return turn.tools.some((t) => t.name === "ask_user");
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

export function buildRunGroups(turns: Turn[]): RunGroup[] {
  interface OpenGroup {
    openerIndex: number;
    memberIndices: number[];
    hasSystem: boolean;
    /** True while the group's last agent turn carries an ask_user
     * tool — the state in which the next user turn is a reply. */
    awaitingReply: boolean;
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
      for (const tool of turn.tools) {
        if (tool.status === "denied") deniedCount++;
        if (tool.name === "ask_user") {
          askUserCount++;
          continue;
        }
        if (tool.name === "no_tool") continue;
        const entry = toolCounts.find((c) => c.name === tool.name);
        if (entry) entry.count++;
        else toolCounts.push({ name: tool.name, count: 1 });
      }
    }

    const opener = g.openerIndex >= 0 ? turns[g.openerIndex] : null;
    const isGoalRun =
      opener?.role === "user" && typeof opener.goalId === "string";

    groups.push({
      openerIndex: g.openerIndex,
      memberIndices: g.memberIndices,
      finalTurnIndex,
      complete,
      foldable:
        complete && g.openerIndex >= 0 && !isGoalRun && !g.hasSystem,
      stats: {
        stepCount: agentTurns.length,
        elapsedMs:
          complete && lastAgent ? (lastAgent.telemetry?.elapsedMs ?? null) : null,
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
      };
      return;
    }
    if (!current) {
      // Orphan leading turns (restored history, goal narration before
      // the first user message) — collected into a headless group.
      current = {
        openerIndex: -1,
        memberIndices: [],
        hasSystem: false,
        awaitingReply: false,
      };
    }
    current.memberIndices.push(index);
    if (turn.role === "system") current.hasSystem = true;
    if (turn.role === "agent") current.awaitingReply = hasAskUserTool(turn);
  });
  if (current) finalize(current);

  return groups;
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
