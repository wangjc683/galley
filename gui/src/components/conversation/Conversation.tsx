import { CaretDown } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { AnsweredAskUser } from "@/components/conversation/AskUserBubble";
import {
  GoalCommissionMarker,
  GoalTerminalMarker,
} from "@/components/conversation/GoalRunMarkers";
import { GoalTaskBoard } from "@/components/conversation/GoalTaskBoard";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import {
  MessageAgent,
  MessageAgentNarration,
} from "@/components/conversation/MessageAgent";
import { MessageUser } from "@/components/conversation/MessageUser";
import { RunFoldHeader } from "@/components/conversation/RunFoldHeader";
import { ExpandSection } from "@/components/conversation/ExpandSection";
import { RunFoldSection } from "@/components/conversation/RunFoldSection";
import { StepRegion } from "@/components/conversation/StepRegion";
import { SystemMessageBubble } from "@/components/conversation/SystemMessageBubble";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import { annotateGoalThread } from "@/lib/goal-thread";
import { useCopy } from "@/lib/i18n";
import { PENDING_STEP_NUMERAL, formatStepNumeral } from "@/lib/step-numeral";
import { summaryEchoesAnswer } from "@/lib/ipc/ga-output-cleaning";
import {
  askUserReplyContent,
  mergedAskUserArgs,
} from "@/lib/ask-user-candidates";
import { buildRunGroups, replyUserIndices, type RunGroup } from "@/lib/run-groups";
import { cn } from "@/lib/utils";
import type { AgentTurn, Turn } from "@/types/conversation";
import type { GoalBrief } from "@/types/goal";
import type { ApprovalDecision } from "@/types/ipc";

export interface ConversationProps {
  turns: Turn[];
  /** Map of approvalId -> recorded decision. When a tool's
   * approvalId is in this map its callout flips to the decided pill. */
  approvalDecisions?: Record<string, ApprovalDecision>;
  /** Decision callback. Receives the approval id and the user's choice. */
  onApprove?: (approvalId: string, decision: ApprovalDecision) => void;
  /** Name of the project the active session belongs to (if any) —
   * threaded down to ToolCallout → ApprovalForm so the "Always
   * allow in {projectName}" button reflects context. */
  projectName?: string;
  /**
   * Goals whose master session is the one being viewed (any status,
   * from `list_goals_for_session`). When present, the objective user
   * turns render as Goal commission markers and each run gets a
   * terminal marker — bracketing each run as an in-thread episode.
   */
  goals?: GoalBrief[];
  /** Drill-down from a frozen task board row into the owning worker
   * session's raw log. */
  onOpenWorkerSession?: (sessionId: string) => void;
  /** True while the active session has a live `pendingAskUser`. The
   * tail AskUserBubble is already showing the question, so the turn
   * it came from must suppress its static AnsweredAskUser echo —
   * otherwise the identical question prints twice, stacked right
   * above the live bubble. */
  askUserPending?: boolean;
  /**
   * True while the agent is mid-run on this session. With
   * `askUserPending` it gates the live window (live-run-window PRD,
   * 2026-09-16): the last run, while it is being worked on, shows
   * only its latest completed step; the ones before fold behind a
   * live header. An incomplete run that is neither running nor
   * waiting on the user (aborted, or a restored tail) renders flat in
   * full — a run without an answer is never hidden.
   */
  agentRunning?: boolean;
}

/**
 * The conversation document — user turns, agent turns, and the two
 * horizontal-rule rhythms that DESIGN.md §4.3 codifies:
 *
 *   - hr-strong  : full-width, at end of agent turn before finalAnswer.
 *                  "Result-first" rhythm — separates plan/execution from
 *                  conclusion.
 *   - hr-soft    : 60% centered, between turns. Quiet pacing.
 *
 * Both kinds use --color-line; the strong one uses line-strong width
 * via the visual contrast of full-width vs 60% rather than a different
 * color. (DESIGN.md says "稍深 1px 全宽 vs 极淡 1px 60% 居中"; opacity
 * 60% on the soft one approximates the prototype.)
 */
export function Conversation({
  turns,
  approvalDecisions,
  onApprove,
  projectName,
  goals,
  onOpenWorkerSession,
  askUserPending = false,
  agentRunning = false,
}: ConversationProps) {
  const items = annotateGoalThread(turns, goals ?? []);

  // The turn whose ask_user question is currently live in the tail
  // AskUserBubble. Positional match (last agent turn carrying an
  // ask_user tool) rather than question-text comparison — the two
  // paths strip GA tags independently, so text equality would be a
  // fragile join key. Searching from the end tolerates trailing
  // side-worker turns (/btw) appended while the question is pending.
  const pendingAskUserTurn = useMemo(() => {
    if (!askUserPending) return null;
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.role === "agent" && t.tools.some((tool) => tool.name === "ask_user")) {
        return t;
      }
    }
    return null;
  }, [askUserPending, turns]);

  // Run fold (conversation-run-fold PRD): settled runs collapse their
  // process section behind a RunFoldHeader. Grouping is the shared
  // run-groups pass — the same one the question rail builds its
  // exchanges from, so fold visibility can never desync the rail's
  // data↔DOM index contract.
  const groups = useMemo(() => buildRunGroups(turns), [turns]);
  const replySet = useMemo(() => replyUserIndices(groups, turns), [groups, turns]);
  // Turn identity → turns index. annotateGoalThread reorders nothing
  // and each Turn object appears at most once, so object identity is
  // a safe join key between its items and the grouping's indices.
  const turnIndexOf = useMemo(() => {
    const m = new Map<Turn, number>();
    turns.forEach((t, i) => m.set(t, i));
    return m;
  }, [turns]);

  // Manual toggles, keyed by opener index: true = user expanded,
  // false = user collapsed, absent = default. Ephemeral per mount —
  // a reopened session folds everything (Conversation is keyed per
  // session in MainView). The same map serves the live window's
  // header, so a run the user opened while it was live stays open
  // when it settles (live-run-window PRD: the reader asked for the
  // list; completion is not a reason to take it away).
  const [foldOverrides, setFoldOverrides] = useState<Record<number, boolean>>(
    {},
  );

  // Live window (live-run-window PRD, 2026-09-16). The run being
  // worked on is not a growing list but a fixed-height panel: its
  // latest completed step (summary + pills, reading form) stays open
  // above MainView's in-flight row, and every step before it folds
  // behind a live RunFoldHeader ("已完成 N 步"). The window is two
  // rows because a step's summary arrives at turn_end — showing only
  // the in-flight row would mean no sentence is ever read. Gated on
  // running / awaiting the user so an aborted run (never foldable —
  // no answer, nothing to stand in for the process) unfolds in full
  // for inspection, and the ask_user pause does not flicker the
  // window away and back.
  const lastGroup: RunGroup | undefined = groups[groups.length - 1];
  const liveGroup =
    lastGroup &&
    !lastGroup.complete &&
    lastGroup.foldEligible &&
    (agentRunning || askUserPending)
      ? lastGroup
      : null;

  // Per-render fold plan. headerFor: opener index → fold header data;
  // sectionOwner: turns indices that render inside the group's
  // RunFoldSection (every member except the opener — the final turn
  // included, because its marker + StrongHr belong to the animated
  // section via `markerOnly` while its answer body stays outside);
  // answerOnly: closing turns whose flat render is the answer body
  // alone, expanded or not — the fold toggle is then purely the
  // section's height sweep, with nothing popping in or out beside it.
  // regionOwner is the flat counterpart of sectionOwner: members of a
  // non-foldable group (Goal run, /btw exchange, aborted run) gather
  // into a plain StepRegion instead of an animated RunFoldSection, so
  // the process inset + rail apply to every run and nothing shifts
  // when a live run completes and moves to a fold (2026-09-16).
  // windowOwner marks the live group's open tail (its last completed
  // agent turn and anything after it, e.g. an ask_user reply); the
  // members before that tail go to sectionOwner and fold behind the
  // live header. answerOnly covers every group with a closing turn
  // for the same reason: the final answer must render outside the
  // region at full width.
  const headerFor = new Map<
    number,
    { group: RunGroup; folded: boolean; live: boolean; foldedSteps: number }
  >();
  const sectionOwner = new Map<number, number>();
  const regionOwner = new Map<number, number>();
  const windowOwner = new Map<number, number>();
  const answerOnly = new Set<number>();
  for (const g of groups) {
    if (g.finalTurnIndex != null) answerOnly.add(g.finalTurnIndex);
    if (g === liveGroup) {
      let lastAgent = -1;
      for (const i of g.memberIndices) {
        if (i !== g.openerIndex && turns[i].role === "agent") lastAgent = i;
      }
      let foldedSteps = 0;
      for (const i of g.memberIndices) {
        if (i === g.openerIndex) continue;
        if (lastAgent !== -1 && i < lastAgent) {
          sectionOwner.set(i, g.openerIndex);
          if (turns[i].role === "agent") foldedSteps++;
        } else {
          windowOwner.set(i, g.openerIndex);
        }
      }
      headerFor.set(g.openerIndex, {
        group: g,
        folded: foldOverrides[g.openerIndex] !== true,
        live: true,
        foldedSteps,
      });
      continue;
    }
    if (!g.foldable) {
      for (const i of g.memberIndices) {
        if (i === g.openerIndex) continue;
        regionOwner.set(i, g.openerIndex);
      }
      continue;
    }
    // Settled runs fold on completion (2026-09-16, reversing the
    // 08-06 keep-expanded window): the header's step / duration /
    // tool-count digest stands in for the process, one click away.
    const override = foldOverrides[g.openerIndex];
    const folded = override !== undefined ? !override : true;
    headerFor.set(g.openerIndex, {
      group: g,
      folded,
      live: false,
      foldedSteps: g.stats.stepCount,
    });
    for (const i of g.memberIndices) {
      if (i === g.openerIndex) continue;
      sectionOwner.set(i, g.openerIndex);
    }
  }

  const toggleFold = (openerIndex: number, currentlyFolded: boolean) => {
    setFoldOverrides((prev) => ({ ...prev, [openerIndex]: currentlyFolded }));
  };

  const renderItem = (
    item: (typeof items)[number],
    i: number,
    turnIndex: number | undefined,
  ) => {
    const header =
      turnIndex !== undefined ? headerFor.get(turnIndex) : undefined;
    return (
      <Fragment key={i}>
        {item.kind === "commission" ? (
          <GoalCommissionMarker goal={item.goal} content={item.content} />
        ) : item.kind === "task-board" ? (
          <GoalTaskBoard
            goal={item.goal}
            onOpenWorkerSession={onOpenWorkerSession}
          />
        ) : item.kind === "terminal" ? (
          <GoalTerminalMarker goal={item.goal} />
        ) : item.turn.role === "user" ? (
          <>
            <MessageUser
              content={item.turn.content}
              attachments={item.turn.attachments}
              origin={item.turn.origin}
              createdAt={item.turn.createdAt}
              askUserReply={turnIndex !== undefined && replySet.has(turnIndex)}
              messageId={item.turn.messageId}
            />
            {/* The live header appears once a step has folded behind
                it (the third step landing, for a two-row window);
                before that the run is its own short list. */}
            {header && header.foldedSteps > 0 && (
              <RunFoldHeader
                stats={header.group.stats}
                open={!header.folded}
                live={header.live}
                onToggle={() =>
                  toggleFold(header.group.openerIndex, header.folded)
                }
              />
            )}
          </>
        ) : item.turn.role === "system" ? (
          <SystemMessageBubble
            content={item.turn.content}
            variant={item.turn.variant}
            showGlyph={item.narrationLeading}
          />
        ) : (
          <AgentTurnView
            turn={item.turn}
            approvalDecisions={approvalDecisions}
            onApprove={onApprove}
            projectName={projectName}
            hideMarker={turnIndex !== undefined && answerOnly.has(turnIndex)}
            suppressAskUserEcho={item.turn === pendingAskUserTurn}
            askUserAnswer={
              turnIndex !== undefined
                ? askUserReplyContent(turns, turnIndex, replySet)
                : undefined
            }
          />
        )}
        {/* No divider between turns — the TurnMarker on each
            AgentTurn carries the chapter-break feel via its own
            top-margin and visual weight. Earlier iterations had
            a SoftHr here (my-9 → my-6 → my-5); even at 40px the
            hr-plus-marker stack felt like wasted vertical space.
            Removed in favour of marker-only separation. */}
      </Fragment>
    );
  };

  // Assembly: consecutive items owned by the same foldable group
  // gather into one RunFoldSection; everything else renders flat.
  // A foldable final turn contributes twice — its marker + StrongHr
  // close the section (markerOnly), its answer body renders flat
  // right after, so collapsing never removes the visible answer.
  type SectionKind = "fold" | "flat" | "window";
  const rendered: ReactNode[] = [];
  let section: {
    opener: number;
    kind: SectionKind;
    nodes: ReactNode[];
  } | null = null;
  const flushSection = () => {
    if (!section) return;
    if (section.kind === "flat") {
      rendered.push(
        <StepRegion key={`region-${section.opener}`}>{section.nodes}</StepRegion>,
      );
    } else if (section.kind === "window") {
      // The live window's open tail. Its marker's own top margin is
      // zeroed (data-role hook) so the gap above is owned here: with
      // no header yet the region carries the run-boundary mt-6; under
      // a collapsed header the header's mb-2.5 hug is the whole gap;
      // under an expanded header the region restores the in-run
      // mt-2.5. Owning it here is what keeps the gap steady while
      // the fold section between header and window sweeps — a
      // mounted 0fr section stops margins collapsing through it, so
      // any margin on the window would add to the header's during
      // the sweep and snap back at unmount. The margin animates on
      // the same token as the sweep for the expand direction.
      const h = headerFor.get(section.opener);
      const hasHeader = h !== undefined && h.foldedSteps > 0;
      const expanded = hasHeader && !h.folded;
      rendered.push(
        <StepRegion
          key={`window-${section.opener}`}
          railFrom={hasHeader ? "header" : "content"}
          className={cn(
            "[&_[data-role=step-marker]]:mt-0",
            "transition-[margin-top] duration-(--motion-slow) ease-firm motion-reduce:transition-none",
            !hasHeader ? "mt-6" : expanded ? "mt-2.5" : "mt-0",
          )}
        >
          {section.nodes}
        </StepRegion>,
      );
    } else {
      const h = headerFor.get(section.opener);
      rendered.push(
        <RunFoldSection key={`fold-${section.opener}`} open={h ? !h.folded : true}>
          {section.nodes}
        </RunFoldSection>,
      );
    }
    section = null;
  };
  items.forEach((item, i) => {
    const turnIndex =
      item.kind === "turn" ? turnIndexOf.get(item.turn) : undefined;
    const foldOwner =
      turnIndex !== undefined ? sectionOwner.get(turnIndex) : undefined;
    const flatOwner =
      turnIndex !== undefined ? regionOwner.get(turnIndex) : undefined;
    const windowOf =
      turnIndex !== undefined ? windowOwner.get(turnIndex) : undefined;
    const owner = foldOwner ?? flatOwner ?? windowOf;
    if (owner === undefined) {
      flushSection();
      rendered.push(renderItem(item, i, turnIndex));
      return;
    }
    const kind: SectionKind =
      foldOwner !== undefined ? "fold" : flatOwner !== undefined ? "flat" : "window";
    if (section && (section.opener !== owner || section.kind !== kind)) {
      flushSection();
    }
    if (!section) section = { opener: owner, kind, nodes: [] };
    if (
      turnIndex !== undefined &&
      answerOnly.has(turnIndex) &&
      item.kind === "turn" &&
      item.turn.role === "agent"
    ) {
      section.nodes.push(
        <AgentTurnView key={`marker-${i}`} turn={item.turn} markerOnly />,
      );
      flushSection();
      rendered.push(renderItem(item, i, turnIndex));
      return;
    }
    section.nodes.push(renderItem(item, i, turnIndex));
  });
  flushSection();

  return <div>{rendered}</div>;
}

function AgentTurnView({
  turn,
  approvalDecisions,
  onApprove,
  projectName,
  hideMarker = false,
  markerOnly = false,
  suppressAskUserEcho = false,
  askUserAnswer,
}: {
  turn: AgentTurn;
  approvalDecisions?: Record<string, ApprovalDecision>;
  onApprove?: (approvalId: string, decision: ApprovalDecision) => void;
  projectName?: string;
  /** Fold mode for a foldable run's closing turn: its marker and
   * StrongHr render inside the animated RunFoldSection (see
   * `markerOnly`), so the flat render is the answer section alone —
   * expanded or folded. When the section is closed the RunFoldHeader
   * is the answer's eyebrow and hugs it (see the StrongHr call site).
   * A closing turn has no narration / real tools / ask_user by
   * definition (run-groups isClosingTurn). */
  hideMarker?: boolean;
  /** hideMarker's other half: render ONLY the closing turn's
   * TurnMarker + StrongHr, as the last nodes inside the RunFoldSection
   * — they belong to the run's process chapter and must sweep away
   * with it, not pop in and out beside the animation. */
  markerOnly?: boolean;
  /** True when this turn's ask_user question is currently live as the
   * tail AskUserBubble — skip the AnsweredAskUser echo so the question
   * doesn't render twice. The echo takes over once the user answers
   * (pendingAskUser clears) or after a restart (pending is transient). */
  suppressAskUserEcho?: boolean;
  /** Content of the user turn that answered this turn's ask_user, when
   * it was answered — lets the AnsweredAskUser echo check the picked
   * candidate. */
  askUserAnswer?: string;
}) {
  // `finalAnswer` is what's left of GA's responseContent after the
  // <thinking> / <tool_use> / <file_content> / <summary> tags have
  // been stripped. The earlier assumption — intermediate turns are
  // 100% tags so post-strip is always "" — turns out to be false:
  // GA's LLM frequently emits a one-line narrator ("好的，我先看一下
  // X") *outside* any tag, before the tool_use block. That narrator
  // survives the strip and produced bogus Copy/Save chips on every
  // step that had preamble text.
  //
  // Correct rule: GA's loop stops only when the LLM emits no real
  // tools, so the *final* answer is the turn that contains nothing
  // but `no_tool` placeholders. (agent_loop.py line 63 synthesizes
  // a `[{tool_name: 'no_tool', args: {}}]` entry on turns where the
  // LLM produced no tool_calls — so `tools.length === 0` would
  // never be true even on the actual final turn. The placeholder is
  // already visually hidden by ToolCallout's `pickToolTier`.)
  // Intermediate turns still show their narrator (useful "voice of
  // GA" running commentary) but without the Copy/Save chips or the
  // conclusion-rhetoric StrongHr.
  // `ask_user` is GA's interaction tool — bridge already emitted an
  // AskUserEvent (rendered separately as AskUserBubble at the
  // conversation tail). Showing it as a tool callout here would
  // duplicate the question on screen, so we filter it out for BOTH
  // live and replay paths (rowsToTurns produces the same shape).
  // We keep it in the underlying turn.tools (SQLite audit trail) and
  // only drop it at render time.
  const copy = useCopy();
  const visibleTools = turn.tools.filter((t) => t.name !== "ask_user");
  // The ask_user question otherwise has no visible home once the live
  // bubble clears: these turns usually carry no `finalAnswer` (the LLM
  // emitted a pure tool_use block), so without surfacing the question
  // text from the filtered tool's args the user couldn't see what they
  // were asked after answering (or after restart). Rendered as a static
  // AnsweredAskUser echo below, in the same yellow register.
  const askUserArgs = mergedAskUserArgs(turn.tools);
  const askUserQuestion = askUserArgs?.question;
  const askUserCandidates = askUserArgs?.candidates;
  const isFinalTurn = visibleTools.every((t) => t.name === "no_tool");
  const answerBody = turn.finalAnswer ?? "";
  const answerText = answerBody.trim() !== "" ? answerBody : null;
  const narrationDuplicatesPreamble =
    !isFinalTurn &&
    normalizedInlineText(answerText) !== "" &&
    normalizedInlineText(answerText) === normalizedInlineText(turn.preamble);
  const detailPreamble = narrationDuplicatesPreamble
    ? undefined
    : turn.preamble;
  // Same family as narrationDuplicatesPreamble, one field over: when
  // the LLM omits `<summary>`, GA falls back to the whole answer as
  // the turn summary, which would print the answer once as the marker
  // subtitle and again as the body right below it. See
  // summaryEchoesAnswer for GA's exact fallback and normalization.
  //
  // Dropping the echo outright leaves a bare "第 N 步", which reads as
  // a failed load next to a turn where the model did write its
  // `<summary>` — the same product showing two different shapes for a
  // compliance difference the user cannot see. GA never emits an empty
  // summary (686/686 rows carry one), so that bare shape would be ours
  // alone; both branches need words. Wording follows GA's own two-way
  // fallback at ga.py:599 — the direct-answer line for a turn with no
  // real tools, the tool name otherwise, which stays true even though
  // the callouts below repeat it in their own register.
  const summaryIsEcho = summaryEchoesAnswer(turn.summary, answerText);
  const realTools = visibleTools.filter((t) => t.name !== "no_tool");
  const markerSummary = !summaryIsEcho
    ? turn.summary
    : realTools.length === 0
      ? copy.conversation.stepDirectAnswer
      : copy.conversation.stepCalledTools(realTools.map((t) => t.name));

  // Bare-marker merge (2026-08-23 density pass): when GA emitted no
  // summary at all (summaryEchoesAnswer(undefined, …) is false, so the
  // echo fallback above never engages), the marker line would carry
  // nothing but the step number — a pure-number orphan line above the
  // tool pill. Fold the two into one row instead: the pill renders the
  // "第 N 步 │" prefix itself and the TurnMarker is skipped. Only when
  // nothing else needs the marker row as its home: no DetailPanel
  // content (its chevron entry lives there), no narration (it renders
  // between marker and tools, so merging would time-invert the order),
  // and exactly one settled-success tool (block-tier states keep the
  // marker so the in-flight/failed callout has a step heading).
  const mergedStepTool =
    turn.turnIndex !== undefined &&
    !markerSummary &&
    !turn.thinking &&
    !detailPreamble &&
    !(answerText && !isFinalTurn) &&
    realTools.length === 1 &&
    (realTools[0].status === "success-current" ||
      realTools[0].status === "success-historical")
      ? realTools[0]
      : null;

  if (markerOnly) {
    return (
      <div>
        {turn.turnIndex !== undefined && (
          <TurnMarker
            index={turn.turnIndex}
            summary={markerSummary}
            thinkingContent={turn.thinking}
            preamble={detailPreamble}
          />
        )}
        {answerText && <StrongHr />}
      </div>
    );
  }

  const showMarker =
    turn.turnIndex !== undefined && !hideMarker && !mergedStepTool;

  return (
    <div>
      {showMarker && (
        <TurnMarker
          index={turn.turnIndex}
          summary={markerSummary}
          thinkingContent={turn.thinking}
          preamble={detailPreamble}
        />
      )}

      {/* Process body sits in the content column to the right of the
          step's ordinal gutter (2026-09-16): narration, tool rows and
          cards, ask_user echo all start where the marker's summary
          starts, so the gutter holds nothing but numerals. Indented
          exactly when a marker was rendered above (a merged step row
          draws its own gutter; a folded final turn has no marker, and
          nothing here to indent). The final answer below stays
          full-width — it is the conclusion, not process. */}
      <div className={cn(showMarker && "pl-(--step-gutter)")}>
        {/* Intermediate-turn narration renders BEFORE the turn's tools:
            the LLM wrote that prose ("好的，我先看一下 X") before
            dispatching them, so rendering it after read as "tools ran →
            then it announced the plan" — time-inverted on re-read. The
            final answer stays after the sequence (a final turn carries
            no real tools). */}
        {answerText && !isFinalTurn && (
          <MessageAgentNarration>{answerText}</MessageAgentNarration>
        )}

        {visibleTools.map((tool) => (
          <ToolCallout
            key={tool.id}
            tool={tool}
            stepIndex={tool === mergedStepTool ? turn.turnIndex : undefined}
            approvalDecision={
              tool.approvalId ? approvalDecisions?.[tool.approvalId] : undefined
            }
            onApprove={onApprove}
            projectName={projectName}
          />
        ))}

        {typeof askUserQuestion === "string" && !suppressAskUserEcho && (
          <AnsweredAskUser
            question={askUserQuestion}
            candidates={askUserCandidates}
            answer={askUserAnswer}
          />
        )}
      </div>

      {/* StrongHr's "action → conclusion" rhetoric needs a visible
          action column as its referent. Folded (hideMarker), the run's
          process is one quiet RunFoldHeader line — the header reads as
          the answer's eyebrow and must hug it (its mb-2.5 becomes the
          whole gap). Keeping the full-width rule there put the view's
          strongest divider *inside* the header+answer unit while the
          user↔agent boundary above had none, and pushed the
          header→answer distance (33px) past the question→header
          distance (24px) — proximity binding the process summary to
          the wrong neighbour (2026-08-06). */}
      {answerText && isFinalTurn && (
        <>
          {!hideMarker && <StrongHr />}
          <MessageAgent telemetry={turn.telemetry} messageId={turn.messageId}>
            {answerText}
          </MessageAgent>
        </>
      )}
    </div>
  );
}

function normalizedInlineText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Per-step header — sits above each agent turn's thinking summary
 * AND carries the chapter-break weight between turns now that
 * SoftHr is gone. Tuned for that double role:
 *   - Two-tier top margin (2026-08-23 density pass): mt-6 (24px) at
 *     the run boundary (step 1 — GA renumbers from 1 per put_task,
 *     so `index === 1` IS the boundary test, no run-group threading
 *     needed), mt-2.5 (10px; 12 until 2026-09-16) between steps
 *     inside a run. The original
 *     mt-6-everywhere verdict was calibrated for chapters that had
 *     body content; in a multi-step tool run each "chapter" is two
 *     thin lines, and 24px between them made whitespace the majority
 *     pixel (~55% of a step's height). The old lesson — structure
 *     does the separating, not a big gap — cuts the other way here:
 *     the Swiss marker itself is the separator, so in-run steps can
 *     sit at half the gap without ambiguity. Chapter-scale spacing
 *     is reserved for the run boundary, which also preserves
 *     RunFoldSection's -mt-2.5 margin-collapse math (it assumes the
 *     section opens with an mt-6 marker).
 *   - Swiss structural register: upright (not italic), tabular
 *     figures, a thin vertical rule separating the step label from
 *     the summary. The cool, precise metadata deliberately contrasts
 *     with the document-prose body below — structure reads as
 *     structure, prose reads as prose.
 *   - 12px keeps it from competing with the body content below.
 *
 * Why "第 N 步" and not "第 N 轮": Chinese 「轮」 collides with the
 * conversational round (user message N) mental model. GA's turn is
 * the finer-grained "one LLM call + tool dispatch" cycle, and 「步」
 * is the natural Chinese word for that level of granularity.
 *
 * Three rendering modes:
 *
 *   thinking placeholder (`thinking={true}`):
 *     In-flight state — upright status text with a three-dot working
 *     indicator and a tabular elapsed counter once it appears. No
 *     chevron, no expand. Mounted when the user submits and
 *     unmounted when turn_progress / turn_end takes over the row.
 *
 *   settled, no detail (`thinking={false}`, no thinking/preamble):
 *     Plain `第 N 步 · {summary}` line. No interaction.
 *
 *   settled, expandable (`thinking={false}` + thinkingContent or preamble):
 *     Same line + trailing chevron. Whole row is clickable: click
 *     toggles an inline DetailPanel that renders the LLM's thinking
 *     and "当前阶段：..." preamble below the step row, in the same
 *     italic ink-soft register as TurnMarker itself. Reveals the
 *     reasoning the LLM wrote before dispatching the tool, on demand
 *     — without forcing it onto users who don't care.
 */
export function TurnMarker({
  index,
  summary,
  thinking = false,
  liveStatus,
  thinkingContent,
  preamble,
}: {
  /**
   * GA-side step number. Optional because the thinking placeholder
   * mounts the instant the user submits (store sets `agentRunning`
   * synchronously) but the bridge's first `turn_start` IPC carrying
   * the step number arrives ~50-200ms later. Rendering during that
   * gap with `index` undefined just drops the "第 N 步" prefix and
   * shows "思考中" alone — better than not rendering at all.
   */
  index?: number;
  /**
   * GA-side third-person turn summary (from turn_end event's
   * `summary` field). When present, rendered on the same line after
   * a separator — mirrors the Sidebar two-liner format so the user
   * sees the same recap there and in the conversation document.
   * Omitted: marker shows just the step number, which is the right
   * minimum when GA didn't produce a summary.
   */
  summary?: string;
  /**
   * True while this step is in flight. Renders a live status in place
   * of the settled summary so the user gets a progress signal during
   * LLM TTFT / tool dispatch / answer streaming. It renders as upright
   * status text with a shimmer sweep (the working affordance — see
   * the §2.7 status-text carve-out) and an elapsed counter that
   * starts at 0.0s immediately, ticking in tenths under a minute.
   * Deciseconds are what make the immediate start work: a
   * static "1 秒" sitting there reads as a mechanical readout, but a
   * fast-moving tenths digit reads as a stopwatch — itself the
   * liveness proof (2026-08-12, replacing the old 3s-delay rule that
   * existed to paper over the same deadness).
   *
   * Caller is expected to pass `key={index}` when the marker can
   * outlive multiple steps' worth of placeholder transitions, so
   * the elapsed clock resets per step.
   */
  thinking?: boolean;
  /**
   * Optional one-line running status. When omitted, the thinking mode
   * falls back to the generic "思考中..." copy. Ignored when `thinking`
   * is false.
   */
  liveStatus?: string;
  /**
   * `<thinking>...</thinking>` block content if the LLM emitted one.
   * Drives the DetailPanel along with `preamble`. Ignored when
   * `thinking` (placeholder) is true.
   */
  thinkingContent?: string;
  /**
   * "当前阶段：..." preamble paragraph the LLM wrote before dispatching
   * the tool. Drives the DetailPanel along with `thinkingContent`.
   * Ignored when `thinking` (placeholder) is true.
   */
  preamble?: string;
}) {
  const copy = useCopy();
  const elapsedDs = useElapsedDeciseconds(thinking);
  const elapsedLabel = thinking
    ? formatElapsedDeciseconds(elapsedDs, copy)
    : null;
  const hasDetail = !thinking && Boolean(thinkingContent || preamble);
  const [open, setOpen] = useState(false);

  const stepLabel = index != null ? copy.conversation.step(index) : null;
  // The ordinal belongs to settled steps only (2026-09-16): a numeral
  // is a stamp on a finished step, and an in-flight row wearing "01"
  // announces a list of one whose one item does not exist yet. The
  // thinking row carries `··` in the gutter instead — an empty slot
  // read as a hole on JC's live check (same day, postscript six), and
  // the two dots keep the column while saying "next item, not yet
  // stamped". Steps above are already numbered, so which iteration is
  // running stays legible without a number on the live row. Same for
  // the sr-only label.
  const stepNumeral = thinking
    ? PENDING_STEP_NUMERAL
    : index != null
      ? formatStepNumeral(index)
      : null;
  // The DetailPanel caret rides the end of the summary text (or
  // stands alone when a bare-number step still has thinking to
  // show) instead of parking at the column's far edge — a disclosure
  // caret hugs the text it belongs to, same as the pill row and the
  // RunFoldHeader (2026-09-16). Inline-block so it wraps with the
  // sentence's last line.
  const detailCaret = hasDetail ? (
    <CaretDown
      size={11}
      weight="thin"
      className={cn(
        "ml-1 inline-block shrink-0 align-[-1px] text-ink-muted transition-transform duration-(--motion-fast)",
        open && "rotate-180",
      )}
    />
  ) : null;
  const trailing = thinking ? (
    <ThinkingStatus status={liveStatus} elapsedLabel={elapsedLabel} />
  ) : summary ? (
    // Wraps rather than truncates (2026-09-16): the summary is the
    // step's sentence and a clipped sentence loses the step. GA
    // summaries run one to two sentences, so this is rarely more
    // than two lines.
    <span className="min-w-0 flex-1 select-text text-ink-soft">
      {summary}
      {detailCaret}
    </span>
  ) : (
    detailCaret
  );

  return (
    <div>
      <div
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        // The live window region zeroes this row's top margin through
        // the attribute (see Conversation's window StepRegion) so the
        // gap above the window is owned by the header / region.
        data-role="step-marker"
        className={cn(
          // No bottom margin: the step's process body must hug its
          // marker so marker + tool rows read as one step, and the
          // between-step mt-2.5 stays the only gap (2026-09-16 rhythm:
          // within-step 0, between-step 10 — JC's live pick after 12
          // read as roomy and 8 as cramped; pill padding stays py-1,
          // the trimmed pill made single steps harder to read).
          "flex min-w-0 items-start leading-[1.6] [font-size:var(--conversation-step-size)] text-ink-soft",
          // Run boundary keeps the chapter gap; in-run steps tighten.
          // `index` unknown (pre-turn_start thinking gap) defaults to
          // the boundary gap — the common case for that window is the
          // first step right after the user submits.
          index != null && index > 1 ? "mt-2.5" : "mt-6",
          hasDetail && "cursor-default hover:text-ink",
        )}
      >
        {/* Ordinal gutter (2026-09-16): a zero-padded numeral in a
            fixed --step-gutter column — JetBrains Mono at the tool
            mono size (11px at the standard tier, the same register as
            the GA tool names in a pill's expanded body), regular, ink-muted
            — the lightest element of the step so the hierarchy reads
            header → summary → numeral. Mono won the live A/B over
            Inter tabular: the row's two edges both carry machine
            metadata, and the mono numeral reads as a margin ordinal
            rather than a quantity. The number is the ordinal, the
            summary is the sentence; alignment (fixed column + mono
            figures) carries the anchor role, not ink or weight.
            Line-height is pinned to the summary's line box so the two
            baselines sit together despite the size step. The gutter
            renders even before `index` is known (pre-turn_start
            thinking gap) so the status text does not jump right when
            the step lands. Mirrored by ToolCallout's
            merged-step prefix; the localized "第 N 步" survives as
            sr-only text (and in the sidebar, where the number needs
            its unit). In flight the column holds `··` (see
            stepNumeral above). */}
        <span
          className="w-(--step-gutter) shrink-0 font-mono tabular-nums text-ink-muted [font-size:var(--conversation-tool-mono-size)] [line-height:calc(var(--conversation-step-size)*1.6)]"
          aria-hidden
        >
          {stepNumeral}
        </span>
        {stepLabel && !thinking && (
          <span className="sr-only">{stepLabel}</span>
        )}
        {trailing}
      </div>
      {hasDetail && (
        <ExpandSection open={open}>
          <div className="pl-(--step-gutter)">
            <DetailPanel thinking={thinkingContent} preamble={preamble} />
          </div>
        </ExpandSection>
      )}
    </div>
  );
}

/**
 * In-flight status for the step marker — replaces the previous
 * per-character opacity wave. Swiss register: upright text, a single
 * localized "working" affordance (three staggered dots), and the
 * elapsed counter in tabular figures so the digits don't jitter as
 * they tick. The decisecond counter starts at 0.0 immediately and is
 * itself the primary proof of liveness.
 *
 * The working affordance is a light band sweeping through the status
 * text (`thinking-shimmer`), adopted 2026-08-12 over the previous
 * LiveDots after a live A/B — one motion source folded into text the
 * row already has, instead of a third sibling element. Shimmer here
 * runs under the §2.7 in-flight-status-text carve-out (globals.css
 * carries the rationale); it stays exclusive to this row.
 */
function ThinkingStatus({
  status,
  elapsedLabel,
}: {
  status?: string;
  elapsedLabel: string | null;
}) {
  const copy = useCopy();
  // Strip trailing dots from either the live status or the fallback
  // copy ("思考中...") — a trailing ellipsis is redundant next to the
  // shimmer sweep and the ticking counter, which already say "ongoing".
  const statusText = (status?.trim() || copy.conversation.thinking).replace(
    /[.\u2026]+$/,
    "",
  );
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="thinking-shimmer truncate">{statusText}</span>
      {elapsedLabel && (
        <span className="shrink-0 tabular-nums text-ink-muted">
          {` · ${elapsedLabel}`}
        </span>
      )}
    </span>
  );
}

/**
 * Inline expansion of TurnMarker — surfaces the LLM's per-step
 * reasoning on demand. Renders via MarkdownView "thinking" variant
 * (italic document prose, ink-soft). This is read-content — the LLM's
 * actual reasoning prose — deliberately distinct from the cool Swiss
 * sans of the TurnMarker row above (structure vs prose). No border,
 * no background, no leading
 * icon — keeps the chrome out of the way so the prose stays the focus.
 * Reveal motion comes from the ExpandSection wrapper in TurnMarker
 * (same grid-rows sweep as RunFoldSection), not from this component.
 *
 * Source order: thinking → preamble. Mirrors how the LLM actually
 * writes them inside `response.content` (thinking is the internal
 * monologue; preamble is the natural-language pre-tool reasoning).
 * If only one is present we just render that one; both null/undefined
 * means TurnMarker shouldn't have offered the chevron in the first
 * place (caller's `hasDetail` check gates the render path).
 */
function DetailPanel({
  thinking,
  preamble,
}: {
  thinking?: string;
  preamble?: string;
}) {
  return (
    <div className="mb-3 space-y-2">
      {thinking && <MarkdownView source={thinking} variant="thinking" />}
      {preamble && <MarkdownView source={preamble} variant="thinking" />}
    </div>
  );
}

/**
 * Tick every 100ms while `active` is true; reports total deciseconds
 * elapsed since the hook started ticking. Returns 0 when inactive.
 * Always Date.now()-anchored (never a counter increment) so the
 * display can't drift from wall time over a long step.
 *
 * Reset semantics: a fresh component mount = clock at 0 (via the
 * initial state of `useState`). Callers that need the clock to
 * reset between logical "occurrences" (e.g. each step's thinking
 * placeholder) should re-mount via React `key` rather than toggling
 * the active flag — toggling on the same instance would leave a
 * stale value between the false→true transition and the first
 * setInterval tick.
 */
function useElapsedDeciseconds(active: boolean): number {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      setDs(Math.floor((Date.now() - start) / 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? ds : 0;
}

/**
 * Elapsed-time formatter for the thinking placeholder.
 *
 *   0-59.9s → "12.3 秒"      (tenths: the fast-moving digit is the
 *                              liveness signal that lets the counter
 *                              start at zero without reading as a
 *                              dead readout)
 *   60s+    → "1 分 23 秒"   (whole seconds: tenths at minute scale
 *                              tip "progress is happening" over into
 *                              frenetic)
 *
 * Seconds component always shown past the minute boundary (including
 * "1 分 0 秒") so the display ticks continuously each second rather
 * than briefly flashing a shorter form on the round-minute.
 */
function formatElapsedDeciseconds(
  ds: number,
  copy: ReturnType<typeof useCopy>,
): string {
  if (ds < 600) return copy.conversation.seconds((ds / 10).toFixed(1));
  const totalSec = Math.floor(ds / 10);
  const minutes = Math.floor(totalSec / 60);
  const remainder = totalSec % 60;
  return copy.conversation.minutesSeconds(minutes, remainder);
}

/** Rendered inside a StepRegion (every closing turn's marker lives
 * there, foldable or not), so it pulls itself back out of the region's
 * inset to span the full column — the action→conclusion rule belongs
 * to the answer's width, not the process's. */
function StrongHr() {
  return (
    <hr
      className="my-4 -ml-(--step-gutter) border-0 border-t border-line-strong"
      aria-hidden
    />
  );
}

// SoftHr removed (2026-05-09): even at my-5 (40px) the hr+marker
// stack between turns felt heavy. TurnMarker's own top margin +
// structural register now carries the chapter-break feel.
