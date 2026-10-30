import { assistantProcessSteps } from "@/lib/assistant-process";
import {
  answeredInOneStep,
  stoppedPartway,
  type RunGroup,
} from "@/lib/run-groups";
import type { Turn } from "@/types/conversation";

/*
 * How the workbench's conversation draws each run (Conversation renders
 * the plan; the assistant's conversation has its own,
 * lib/assistant-conversation.ts `assistantLinePlan`). One rule
 * (workbench conversation PRD ruling 6, 2026-10-16): what is behind a
 * fold header is one line a step; what is not stays as it was.
 *
 *   settled   a run with an answer folds behind its header (RunFoldHeader:
 *             steps, time, tool mix), which opens the card of its steps,
 *             one line a step (RunFoldSection). The questions it asked
 *             mid-run and the user's answers are not steps: they stay out
 *             in the conversation, in order, before the header — the
 *             header is the answer's eyebrow and hugs it:
 *
 *               your message → its question → your answer → header → answer
 *
 *   live      the run being worked on keeps its window (the last
 *             completed step in the step region's reading form, then the
 *             in-flight row); the steps before it fold behind the live
 *             header (「已完成 N 步」), which opens the same card. Its
 *             questions and answers stay where they are today: in the
 *             window while they are its tail, behind the live header
 *             once the run moves on — not as rows (they are not steps),
 *             so the open card does not show them until the run settles.
 *   settling  the sweep between the two (Conversation's settling): the
 *             live shape, its questions and answers already out before
 *             the header, where the settled run has them.
 *   one step  a run that answered in one step is its answer alone (PRD
 *             ruling 7, lib/run-groups.ts `answeredInOneStep`): no
 *             header, no card, no step marker, no StrongHr; settling, the
 *             in-flight row's place closes above the answer
 *             (`settleGapAbove`, Conversation's SettleGap).
 *   stopped   a run that stopped without an answer (stopped, failed,
 *             at the step cap; lib/run-groups.ts `stoppedPartway`;
 *             PRD ruling 9, ticket 04) is its live window, frozen: the
 *             stop only takes the in-flight row away. Its header reads
 *             「中途停下 · N 步」 (RunFoldHeader `stopped`) over the card
 *             of every step but the last, which stays out under it in
 *             the step region's reading form — reloaded, the same. The
 *             questions and answers the live header had behind it come
 *             out before it, as a settled run's; one still the window's
 *             tail stays there, as it was. A run stopped after one step
 *             is that step alone: nothing behind a header, no header.
 *   flat      a /btw exchange, a headless lead-in, and a run without an
 *             answer that ended on its own saying nothing but tags (not
 *             `stoppedPartway`): the step region in full, its questions
 *             and answers inside it, as before.
 *
 * Grouping, step counts, times, tokens, the reply set and the sidebar's
 * 「第 N 步」 are run-groups' and do not change with where a turn is drawn.
 */

/** A run drawn behind a fold header. */
export interface FoldHead {
  group: RunGroup;
  /** Not opened by the reader (Conversation's overrides). */
  folded: boolean;
  /** The live header of the run being worked on. */
  live: boolean;
  /** The header of a run that stopped partway: the live window, frozen
   * (the header's words change, nothing else). */
  stopped: boolean;
  /** Steps behind the header so far: the live header shows from the
   * first one on. */
  foldedSteps: number;
  /** The steps the card behind the header draws as rows, in order: its
   * agent turns minus the answer and the steps that only asked
   * (lib/assistant-process.ts `assistantProcessSteps`). */
  rows: number[];
  /** Drawn before the header, in order: the questions it asked (ask_user
   * turns, as their answered echo) and the user's answers — for a
   * stopped run, those behind its header only. */
  outside: number[];
}

export interface WorkbenchFoldPlan {
  /** Turn index → the run whose questions and answers, header and card
   * are drawn right before that turn: a settled run's answer; the live
   * (or stopped) window's first step. */
  heads: Map<number, FoldHead>;
  /** The live (or stopped) window's members by opener: the run's last
   * completed step and what follows it, and the steps sweeping out of
   * it. */
  windowOwner: Map<number, number>;
  /** Members of runs drawn flat in a step region, by opener. */
  regionOwner: Map<number, number>;
  /** Turns not drawn at their own place: rows in a card, questions and
   * answers drawn before a header, and those behind a live header (not
   * drawn at all). */
  elsewhere: Set<number>;
  /** ask_user turns whose question is out before the header: a step
   * region drawing the turn leaves its echo out. */
  echoOutside: Set<number>;
  /** The answer of a one-step run settling right now: the in-flight
   * row's place closes above it. */
  settleGapAbove: number | null;
}

function asksUser(turn: Turn): boolean {
  return (
    turn.role === "agent" && turn.tools.some((tool) => tool.name === "ask_user")
  );
}

export function workbenchFoldPlan({
  groups,
  turns,
  liveGroup,
  settlingGroup,
  isDeparting,
  isOpened,
}: {
  groups: readonly RunGroup[];
  turns: readonly Turn[];
  /** The live window's run (run-groups `liveRunGroup`). */
  liveGroup: RunGroup | null;
  /** The run in its live → settled sweep. */
  settlingGroup: RunGroup | null;
  /** A step sweeping out of the live window. */
  isDeparting: (index: number) => boolean;
  /** The reader opened this run's header (by opener index). */
  isOpened: (openerIndex: number) => boolean;
}): WorkbenchFoldPlan {
  const plan: WorkbenchFoldPlan = {
    heads: new Map(),
    windowOwner: new Map(),
    regionOwner: new Map(),
    elsewhere: new Set(),
    echoOutside: new Set(),
    settleGapAbove: null,
  };
  for (const g of groups) {
    // A run that answered in one step is its answer alone: the closing
    // turn renders flat as the answer (Conversation's answerOnly), its
    // tokens in the answer's hover row.
    if (g.foldable && answeredInOneStep(g)) {
      if (g === settlingGroup) plan.settleGapAbove = g.finalTurnIndex;
      continue;
    }
    const folded = !isOpened(g.openerIndex);
    // A stopped run takes the live window's path as it is, so the stop
    // moves nothing: the same anchor, window members and rows.
    const stopped = stoppedPartway(g, turns, liveGroup);
    if (g === liveGroup || g === settlingGroup || stopped) {
      const live = g === liveGroup;
      // While settling, the closing turn is not a window candidate: its
      // answer renders flat below and nothing of it is behind the header.
      let lastAgent = -1;
      for (const i of g.memberIndices) {
        if (i === g.openerIndex || i === g.finalTurnIndex) continue;
        if (turns[i].role === "agent") lastAgent = i;
      }
      let foldedSteps = 0;
      const behind: number[] = [];
      const outside: number[] = [];
      let anchor: number | null = null;
      for (const i of g.memberIndices) {
        if (i === g.openerIndex || i === g.finalTurnIndex) continue;
        const turn = turns[i];
        if (!live && !stopped && (turn.role === "user" || asksUser(turn))) {
          outside.push(i);
          if (turn.role === "user") {
            plan.elsewhere.add(i);
            continue;
          }
          plan.echoOutside.add(i);
        }
        if (lastAgent !== -1 && i < lastAgent) {
          // A departing step counts as folded already — the header it is
          // sweeping into must exist from the first frame of that sweep
          // — but stays a window member until its sweep ends.
          if (turn.role === "agent") foldedSteps++;
          if (isDeparting(i)) {
            plan.windowOwner.set(i, g.openerIndex);
            anchor ??= i;
          } else {
            plan.elsewhere.add(i);
            if (turn.role === "agent") behind.push(i);
            // Stopped: out before the header, as a settled run's; live,
            // not drawn until the run settles.
            if (stopped && (turn.role === "user" || asksUser(turn))) {
              outside.push(i);
            }
          }
        } else {
          plan.windowOwner.set(i, g.openerIndex);
          anchor ??= i;
        }
      }
      anchor ??= g.finalTurnIndex;
      if (anchor !== null) {
        plan.heads.set(anchor, {
          group: g,
          folded,
          live,
          stopped,
          foldedSteps,
          rows: assistantProcessSteps(behind, turns, -1),
          outside,
        });
      }
      continue;
    }
    if (!g.foldable) {
      for (const i of g.memberIndices) {
        if (i === g.openerIndex) continue;
        // The main chat's greeting (ticket 04c) heads a headless group
        // of its own: no region, so no step marker or rule — it renders
        // as the plain answer it is.
        const turn = turns[i];
        if (turn.role === "agent" && turn.greeting) continue;
        plan.regionOwner.set(i, g.openerIndex);
      }
      continue;
    }
    // Settled runs of two steps or more fold on completion (2026-09-16,
    // reversing the 08-06 keep-expanded window): the header's step /
    // duration / tool-count digest stands in for the process, one
    // click away.
    const final = g.finalTurnIndex;
    if (final === null) continue;
    const outside: number[] = [];
    for (const i of g.memberIndices) {
      if (i === g.openerIndex || i === final) continue;
      plan.elsewhere.add(i);
      if (turns[i].role === "user" || asksUser(turns[i])) outside.push(i);
    }
    plan.heads.set(final, {
      group: g,
      folded,
      live: false,
      stopped: false,
      foldedSteps: g.stats.stepCount,
      rows: assistantProcessSteps(g.memberIndices, turns, final),
      outside,
    });
  }
  return plan;
}
