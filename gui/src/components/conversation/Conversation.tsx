import { CaretDown } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
import {
  AssistantProcessCard,
  AssistantStoppedRun,
} from "@/components/conversation/AssistantProcessCard";
import { AnsweredAskUser } from "@/components/conversation/AskUserBubble";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import {
  MessageAgent,
  MessageAgentNarration,
} from "@/components/conversation/MessageAgent";
import {
  MessageContextMenu,
  MessageMenuProvider,
  type MessageMenuWiring,
} from "@/components/conversation/MessageMenu";
import { MessageTimeDivider } from "@/components/conversation/MessageTimeDivider";
import { MessageUser } from "@/components/conversation/MessageUser";
import { RunFoldHeader } from "@/components/conversation/RunFoldHeader";
import { ExpandSection } from "@/components/conversation/ExpandSection";
import { RunFoldSection } from "@/components/conversation/RunFoldSection";
import { StepRegion } from "@/components/conversation/StepRegion";
import { SystemMessageBubble } from "@/components/conversation/SystemMessageBubble";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  type AssistantProcessToggle,
  type AssistantRowSide,
  type AssistantRunSteps,
  assistantLinePlan,
  assistantRowGap,
  endsWithActionRow,
} from "@/lib/assistant-conversation";
import { assistantProcessSteps } from "@/lib/assistant-process";
import {
  BrowserSitesContext,
  buildBrowserSiteResolver,
} from "@/lib/browser-site";
import {
  WrittenFilesContext,
  buildWrittenFileResolver,
} from "@/lib/written-files";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isMenuBubble, messageDeleteBlock } from "@/lib/message-delete";
import {
  canQuoteMessage,
  messageMenuEntries,
  messageMenuTarget,
} from "@/lib/message-menu";
import {
  formatMessageTime,
  formatMessageTimeFull,
  userTimeMarks,
} from "@/lib/message-time";
import { PENDING_STEP_NUMERAL, formatStepNumeral } from "@/lib/step-numeral";
import {
  isEchoNarrationStep,
  stepMarkerLine,
  stepMarkerSummary,
} from "@/lib/step-heading";
import {
  askUserReplyContent,
  mergedAskUserArgs,
} from "@/lib/ask-user-candidates";
import { type FoldHead, workbenchFoldPlan } from "@/lib/run-fold-plan";
import {
  buildRunGroups,
  liveRunGroup,
  replyUserIndices,
  runStepNumbers,
} from "@/lib/run-groups";
import { saveReplyMarkdown } from "@/lib/reply-save";
import { isSubtaskReportTurn } from "@/lib/subtasks";
import { turnOrdinals } from "@/lib/turn-ordinals";
import { cn } from "@/lib/utils";
import type {
  AgentTurn,
  MessageTelemetry,
  Turn,
  UserTurn,
} from "@/types/conversation";

export interface ConversationProps {
  turns: Turn[];
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
   * full — a run without an answer is never hidden (the assistant's
   * conversation draws it as one line that opens its steps instead:
   * main chat PRD ruling 159).
   */
  agentRunning?: boolean;
  /**
   * Turns put in front of `turns` since they were loaded (paged
   * history, main-chat ticket 12; messages store `prependedTurns`).
   * Rows are keyed, and fold / live-window state kept, by
   * `index - keyBase`: loading an earlier page then remounts no row and
   * moves no fold onto another run.
   */
  keyBase?: number;
  /**
   * Places of turns a deleted message took out (main chat ticket 32;
   * messages store `removedOrdinals`): skipped, so the rows after them
   * keep their keys and a process card that was open stays on its
   * reply (lib/turn-ordinals).
   */
  removedOrdinals?: readonly number[];
  /** Send time of the last user message before `turns` while earlier
   * history is not loaded (messages store `earlier`): the first loaded
   * user message's send-time break measures against it. */
  previousUserCreatedAt?: string | null;
  /**
   * What hangs under a final answer, by the reply's `messageId` — the
   * main chat's subtask cards (ticket 06a), supplied by MainView for the
   * main chat only. Null for a reply with nothing under it. Display only:
   * nothing here reaches the model.
   */
  renderAfterAnswer?: (messageId: string) => ReactNode;
  /**
   * Draw the assistant's conversation (the main chat, MainView's
   * `isMainChat`; main chat PRD rulings 66–69; rules in
   * lib/assistant-conversation.ts): an IM with one person rather than
   * the workbench's task record. Bubbles on both sides with IM grouping
   * gaps; under a settled reply of two steps or more, a process button
   * in its hover action bar opens its steps in place as a card, one line
   * a step (AssistantProcessCard), its questions and the user's answers
   * staying out as messages; a run without an answer is one line where
   * its reply would be, 「中途停下 · N 步」, which opens the same card
   * (AssistantStoppedRun, ruling 159); a time line above the greeting
   * too. Off for every other conversation: the workbench's, a subtask, the
   * external runtime's. The two share their grammar (workbench
   * conversation PRD): the user's words on the right, the send times
   * at breaks as centred lines, a one-step reply with nothing over it.
   */
  assistant?: boolean;
  /**
   * The assistant's conversation: a bubble's message menu, on a
   * right-click and on the ⋯ ending a reply's bar (main chat tickets 32,
   * 38; MessageMenu, lib/message-menu). MainView supplies the main chat's
   * state and where 引用 and 删除 go; absent everywhere else, so no other
   * conversation has a menu. 复制, 保存 and the process are the
   * conversation's own.
   */
  messageMenu?: {
    /** The main chat is replying (its run going, a send on its way). */
    running: boolean;
    /** It waits for the user's answer. */
    asking: boolean;
    /** Whether a reply has subtask cards, by its answer's row id. */
    hasSubtasks: (answerId: string) => boolean;
    /** 引用: put `text` in the composer's quote strip. */
    onQuote: (text: string) => void;
    /** 删除 was chosen: the row Core is asked about, and the rows the
     * page hides until then. */
    onDelete: (message: { messageId: string; rowIds: string[] }) => void;
  };
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
/** `removedOrdinals` when nothing was deleted: one stable reference. */
const NO_ORDINALS: readonly number[] = Object.freeze([]);

/** Length of the live→settled sweep: ExpandSection's --motion-slow
 * (240ms) plus its unmount margin, the same 300ms it uses itself. */
const SETTLE_SWEEP_MS = 300;

export function Conversation({
  turns,
  askUserPending = false,
  agentRunning = false,
  keyBase = 0,
  removedOrdinals = NO_ORDINALS,
  previousUserCreatedAt = null,
  renderAfterAnswer,
  assistant = false,
  messageMenu,
}: ConversationProps) {
  // A turn's place that survives a prepend (see `keyBase`) and a deleted
  // message (`removedOrdinals`): every key and every piece of per-run
  // state below is held in these, never in raw indices.
  const ordinals = useMemo(
    () => turnOrdinals(turns.length, keyBase, removedOrdinals),
    [turns.length, keyBase, removedOrdinals],
  );
  const ordinal = (index: number) => ordinals[index] ?? index - keyBase;

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
  // process behind a RunFoldHeader, which opens it one line a step
  // (workbench conversation PRD ruling 6). Grouping is the shared
  // run-groups pass — the same one the question rail builds its
  // exchanges from, so fold visibility can never desync the rail's
  // data↔DOM index contract. Steps are numbered by position within
  // their run, not by GA's per-loop counter (run-groups
  // `runStepNumbers`).
  // The assistant's replies stay apart when the message between two of
  // them was deleted (run-groups `splitAfterAnswer`, ticket 32).
  const groups = useMemo(
    () => buildRunGroups(turns, { splitAfterAnswer: assistant }),
    [turns, assistant],
  );
  // The live window's run (see 「Live window」 below).
  const liveGroup = liveRunGroup(groups, agentRunning, askUserPending);
  // The assistant's conversation draws its runs from its own plan
  // (lib/assistant-conversation.ts `assistantLinePlan`): the messages
  // out in the conversation, the steps behind a quiet entry.
  const linePlan = useMemo(
    () => (assistant ? assistantLinePlan(groups, turns, liveGroup) : null),
    [assistant, groups, turns, liveGroup],
  );
  const stepNumberOf = useMemo(
    () => runStepNumbers(groups, turns),
    [groups, turns],
  );
  const replySet = useMemo(
    () => replyUserIndices(groups, turns),
    [groups, turns],
  );
  // Closing turn index → the run's whole-run telemetry for its answer
  // footer. The closing turn's own telemetry only covers the GA loop
  // after the last ask_user reply (run-groups segments note).
  const runTelemetryOf = useMemo(() => {
    const m = new Map<number, MessageTelemetry | null>();
    for (const g of groups) {
      if (g.finalTurnIndex != null) m.set(g.finalTurnIndex, g.stats.telemetry);
    }
    return m;
  }, [groups]);

  // User message send time (message-timestamps PRD, 2026-09-28): which
  // user turns sit at a break, and their label text, computed once here
  // so MessageUser (a memo component) only receives strings. Only a
  // break shows a time, so only those turns are formatted.
  // `dayStamp` is local midnight and moves at the day
  // rollover, so 「今天 / 昨天」 re-label without a data change; no
  // Date.now() in render.
  const copy = useCopy();
  const language = useLanguage();
  const dayStamp = useDayStamp();
  // A subtask report row (main chat ticket 31) dates its round in the
  // assistant's conversation; a round that draws nothing dates nothing.
  const reportSkip = useMemo(() => {
    if (!linePlan) return undefined;
    const skip = new Set<number>();
    turns.forEach((turn, index) => {
      if (isSubtaskReportTurn(turn) && !linePlan.reports.has(index)) {
        skip.add(index);
      }
    });
    return skip;
  }, [linePlan, turns]);
  const timeMarks = useMemo(
    () => userTimeMarks(turns, { previousUserCreatedAt, skip: reportSkip }),
    [turns, previousUserCreatedAt, reportSkip],
  );
  const pinnedTimes = useMemo(() => {
    const words = {
      today: copy.conversation.messageTimeToday,
      yesterday: copy.conversation.messageTimeYesterday,
    };
    const labels = new Map<number, { label: string; full?: string }>();
    for (const [index, mark] of timeMarks) {
      if (!mark.pinned) continue;
      const turn = turns[index];
      if (turn.role !== "user" || !turn.createdAt) continue;
      const label = formatMessageTime(turn.createdAt, dayStamp, language, {
        withTodayWord: mark.withTodayWord,
        words,
      });
      if (!label) continue;
      labels.set(index, {
        label,
        full: formatMessageTimeFull(turn.createdAt, language) ?? undefined,
      });
    }
    return labels;
  }, [timeMarks, turns, dayStamp, language, copy]);

  // The assistant's conversation puts a time line above the greeting
  // too: the greeting opens the conversation (main chat ticket 20).
  // rowsToTurns carries its row's `created_at`.
  const greetingTime = useMemo(() => {
    if (!assistant) return null;
    const greeting = turns.find(
      (t): t is AgentTurn => t.role === "agent" && t.greeting === true,
    );
    const iso = greeting?.createdAt;
    if (!iso) return null;
    const label = formatMessageTime(iso, dayStamp, language, {
      withTodayWord: false,
      words: {
        today: copy.conversation.messageTimeToday,
        yesterday: copy.conversation.messageTimeYesterday,
      },
    });
    return label
      ? { label, full: formatMessageTimeFull(iso, language) ?? undefined, iso }
      : null;
  }, [assistant, turns, dayStamp, language, copy]);

  // A report round's time at a break (main chat ticket 31): the report
  // row is not drawn, so its time is the line above the first row its
  // round draws — the reply, or a question it asked — as the greeting's
  // is above the greeting. By that row's index.
  const reportTimeAbove = useMemo(() => {
    const above = new Map<
      number,
      { label: string; full?: string; iso?: string }
    >();
    if (!linePlan) return above;
    for (const [report, first] of linePlan.reports) {
      const pinned = pinnedTimes.get(report);
      const turn = turns[report];
      if (pinned && turn.role === "user") {
        above.set(first, { ...pinned, iso: turn.createdAt });
      }
    }
    return above;
  }, [linePlan, pinnedTimes, turns]);

  // Manual toggles, keyed by the opener's ordinal: true = user expanded,
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
  // (`liveGroup` and the assistant's `linePlan` are computed above, with
  // the run groups: the send times need the plan.)

  // Settling: the sweep between live and settled. The two structures
  // share no keys for the window, so switching in the render where
  // the run completes would drop the window's two rows instantly.
  // Instead the just-completed run keeps its live shape for one
  // sweep — window wrapped in an ExpandSection now closing, header
  // already in settled voice, the final answer flat below — and the
  // switch to the settled structure happens after the sweep, when
  // the card behind the header is closed either way and nothing
  // visible moves (the run's questions and answers are already out
  // before the header while it settles, where the settled run draws
  // them: lib/run-fold-plan.ts). Skipped when the reader had opened the
  // live header (the run settles open: its card stays, the window's
  // steps join it as rows, the answer comes in under it) and when
  // the run did not complete (aborts unfold in full). A run that
  // answered in one step has no window and settles to its answer
  // alone; its sweep closes the in-flight row's place above the answer
  // instead (SettleGap), so the answer glides up rather than jumps.
  // Guarded setState-in-render: the decision has to land in THIS
  // render, an effect would commit the settled structure first.
  // Openers here are ordinals, like every index this component keeps
  // across renders.
  const liveOpenerNow = liveGroup ? ordinal(liveGroup.openerIndex) : null;
  const [watchedOpener, setWatchedOpener] = useState<number | null>(null);
  const [settlingOpener, setSettlingOpener] = useState<number | null>(null);
  if (liveOpenerNow !== null && liveOpenerNow !== watchedOpener) {
    setWatchedOpener(liveOpenerNow);
  }
  if (liveOpenerNow === null && watchedOpener !== null) {
    const watched = groups.find(
      (g) => ordinal(g.openerIndex) === watchedOpener,
    );
    if (watched?.complete && foldOverrides[watchedOpener] !== true) {
      setSettlingOpener(watchedOpener);
    }
    setWatchedOpener(null);
  }
  useEffect(() => {
    if (settlingOpener === null) return;
    const timer = window.setTimeout(
      () => setSettlingOpener(null),
      SETTLE_SWEEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [settlingOpener]);
  const settlingGroup =
    settlingOpener !== null
      ? (groups.find(
          (g) => ordinal(g.openerIndex) === settlingOpener && g.complete,
        ) ?? null)
      : null;

  // Departing steps: when a new step lands, the step it displaces
  // from the window stays there for one sweep, closing, while the
  // new one grows in below it — the window reads as a viewport the
  // list scrolls through, top item folding into the header, bottom
  // item arriving. Each departure keeps its own 300ms timer so fast
  // successive steps overlap instead of cutting each other off. Not
  // used while the live header is expanded: there the displaced step
  // simply moves into the open card above as its row, and a sweep
  // would show it twice. Guarded
  // setState-in-render, as the settling detection above. Steps and
  // openers are ordinals.
  const liveLastAgent = (() => {
    if (!liveGroup) return null;
    let last: number | null = null;
    for (const i of liveGroup.memberIndices) {
      if (i === liveGroup.openerIndex || i === liveGroup.finalTurnIndex) continue;
      if (turns[i].role === "agent") last = ordinal(i);
    }
    return last;
  })();
  const [watchedStep, setWatchedStep] = useState<{
    opener: number;
    index: number;
  } | null>(null);
  const [departing, setDeparting] = useState<number[]>([]);
  if (liveOpenerNow !== null && liveLastAgent !== null) {
    if (
      watchedStep === null ||
      watchedStep.opener !== liveOpenerNow ||
      watchedStep.index !== liveLastAgent
    ) {
      if (
        watchedStep !== null &&
        watchedStep.opener === liveOpenerNow &&
        watchedStep.index < liveLastAgent &&
        foldOverrides[liveOpenerNow] !== true &&
        !departing.includes(watchedStep.index)
      ) {
        setDeparting([...departing, watchedStep.index]);
      }
      setWatchedStep({ opener: liveOpenerNow, index: liveLastAgent });
    }
  } else if (watchedStep !== null) {
    setWatchedStep(null);
  }
  useEffect(() => {
    if (departing.length === 0) return;
    const latest = departing[departing.length - 1];
    const timer = window.setTimeout(() => {
      setDeparting((prev) => prev.filter((i) => i !== latest));
    }, SETTLE_SWEEP_MS);
    return () => window.clearTimeout(timer);
    // Each index schedules its own removal when it is appended; the
    // cleanup only cancels a timer for an index that was already
    // removed by an earlier effect run.
  }, [departing]);

  // Per-render plan (lib/run-fold-plan.ts): which runs fold behind a
  // header — and where the header, the card behind it and the run's
  // questions and answers are drawn — the live window's members, the
  // runs drawn flat in a step region (/btw exchange, aborted run), so
  // the process inset + rail apply to every run drawn as steps.
  // answerOnly: closing turns whose flat render is the answer body
  // alone — every group with a closing turn, so the final answer
  // renders outside any region at full width and the fold toggle is
  // purely the card's sweep, with nothing popping in or out beside it.
  const answerOnly = new Set<number>();
  for (const g of groups) {
    if (g.finalTurnIndex != null) answerOnly.add(g.finalTurnIndex);
  }
  // The assistant's conversation draws its runs from linePlan instead.
  const foldPlan = linePlan
    ? null
    : workbenchFoldPlan({
        groups,
        turns,
        liveGroup,
        settlingGroup,
        isDeparting: (i) => departing.includes(ordinal(i)),
        isOpened: (opener) => foldOverrides[ordinal(opener)] === true,
      });
  const windowOwner = foldPlan?.windowOwner ?? new Map<number, number>();
  // The answer of a one-step run settling right now: the in-flight
  // row's place closes above it (SettleGap).
  const settleGapAbove = foldPlan?.settleGapAbove ?? null;
  const regionOwner = new Map<number, number>(foldPlan?.regionOwner);
  // The assistant's runs drawn the workbench way gather into flat
  // regions too.
  if (linePlan) {
    for (const [i, opener] of linePlan.flat) regionOwner.set(i, opener);
  }
  // The live window's header, by opener (the window's gap choreography
  // reads it).
  const headOf = new Map<number, FoldHead>();
  for (const head of foldPlan?.heads.values() ?? []) {
    headOf.set(head.group.openerIndex, head);
  }

  const toggleFold = (openerIndex: number, currentlyFolded: boolean) => {
    setFoldOverrides((prev) => ({
      ...prev,
      [ordinal(openerIndex)]: currentlyFolded,
    }));
  };

  // A user message, on the right (both conversations since the
  // workbench's ticket 01). Its send time at a break is a centred line
  // of its own before it, with nothing above it right under an action
  // row, which is the gap (`previous`: the side of the row right
  // above). Its own row under the bubble is the gap to what follows:
  // the workbench's hover copy, or in the assistant's conversation copy
  // · quote · ⋯ (ruling 105, ticket 53), which adds its IM row gap
  // above and keeps the selection's floating copy.
  const userRow = (
    turn: UserTurn,
    turnIndex: number,
    previous: AssistantRowSide | null,
  ) => {
    const pinned = pinnedTimes.get(turnIndex);
    return (
      <>
        {pinned && (
          <MessageTimeDivider
            label={pinned.label}
            full={pinned.full}
            iso={turn.createdAt}
            afterActionRow={endsWithActionRow(previous)}
          />
        )}
        <MessageUser
          content={turn.content}
          attachments={turn.attachments}
          origin={turn.origin}
          askUserReply={replySet.has(turnIndex)}
          messageId={turn.messageId}
          assistant={assistant}
          rowClassName={
            assistant
              ? pinned
                ? "mt-5"
                : assistantRowGap(previous, "user")
              : undefined
          }
        />
      </>
    );
  };

  // What hangs under a reply (the subtask cards). In the assistant's
  // conversation they sit right under the reply bubble (before its
  // action row), on the left, at most the bubble's width.
  const afterAnswer = (messageId: string) => {
    const node = renderAfterAnswer?.(messageId);
    return assistant && node ? (
      <div className={ASSISTANT_BUBBLE_MAX}>{node}</div>
    ) : (
      node
    );
  };

  // `previous`: the side of the row right above, for a user message's
  // time line (the workbench; the assistant's rows come through
  // renderLineRow).
  const renderItem = (
    turn: Turn,
    turnIndex: number,
    previous: AssistantRowSide | null = null,
  ) => {
    // Keyed by the turn's ordinal: an earlier page landing in front
    // moves no key.
    return (
      <Fragment key={`turn-${ordinal(turnIndex)}`}>
        {turn.role === "user" ? (
          userRow(turn, turnIndex, previous)
        ) : turn.role === "system" ? (
          <SystemMessageBubble
            content={turn.content}
            variant={turn.variant}
            // A run of narration beats shows the glyph once, on its
            // first line.
            showGlyph={!isNarrationTurn(turns[turnIndex - 1])}
          />
        ) : (
          <AgentTurnView
            turn={turn}
            hideMarker={answerOnly.has(turnIndex)}
            stepNumber={stepNumberOf.get(turnIndex)}
            suppressAskUserEcho={
              turn === pendingAskUserTurn ||
              foldPlan?.echoOutside.has(turnIndex) === true
            }
            askUserAnswer={askUserReplyContent(turns, turnIndex, replySet)}
            runTelemetry={runTelemetryOf.get(turnIndex)}
            bubble={assistant}
            attachment={
              assistant && turn.messageId
                ? afterAnswer(turn.messageId)
                : undefined
            }
          />
        )}
        {/* Under the reply that dispatched them: the main chat's
            subtask cards (ticket 06a), keyed on the reply's row id —
            only that reply's final turn matches one, even one whose
            answer was nothing but tags. (In the assistant's
            conversation the reply holds them, under its bubble.) */}
        {turn.role === "agent" &&
          turn.messageId &&
          !assistant &&
          afterAnswer(turn.messageId)}
        {/* No divider between turns — the TurnMarker on each
            AgentTurn carries the chapter-break feel via its own
            top-margin and visual weight. Earlier iterations had
            a SoftHr here (my-9 → my-6 → my-5); even at 40px the
            hr-plus-marker stack felt like wasted vertical space.
            Removed in favour of marker-only separation. */}
      </Fragment>
    );
  };

  // A message row of the assistant's conversation: a user message, a
  // question it asked (answered: a pending one is the live bubble at the
  // tail), the greeting with its time, or a run's answer with the
  // subtask cards, the process button in its action bar and the steps
  // that button opens.
  // `previous` is the side of the message row right above, for the IM
  // gap.
  const renderLineRow = (
    turn: Turn,
    turnIndex: number,
    previous: AssistantRowSide | null,
  ): ReactNode => {
    const key = `turn-${ordinal(turnIndex)}`;
    if (turn.role === "user") {
      return (
        <Fragment key={key}>{userRow(turn, turnIndex, previous)}</Fragment>
      );
    }
    if (turn.role !== "agent") return renderItem(turn, turnIndex);
    const gap = assistantRowGap(previous, "agent");
    // A report round's time at a break, above its first row.
    const reportTime = reportTimeAbove.get(turnIndex);
    const reportDivider = reportTime ? (
      <MessageTimeDivider
        label={reportTime.label}
        full={reportTime.full}
        iso={reportTime.iso}
        afterActionRow={endsWithActionRow(previous)}
      />
    ) : null;
    if (linePlan?.question.has(turnIndex)) {
      const args = mergedAskUserArgs(turn.tools);
      if (turn === pendingAskUserTurn || !args) {
        // The pending question is the live bubble at the tail; a report
        // round's time still goes right above it.
        return reportDivider ? (
          <Fragment key={key}>{reportDivider}</Fragment>
        ) : null;
      }
      return (
        <Fragment key={key}>
          {reportDivider}
          <AnsweredAskUser
            question={args.question}
            candidates={args.candidates}
            answer={askUserReplyContent(turns, turnIndex, replySet)}
            bubble
            messageId={turn.messageId}
            className={reportDivider ? "mt-5" : gap}
          />
        </Fragment>
      );
    }
    // The steps under the action bar open on the process button (the
    // run fold's overrides, keyed the same way) and start closed.
    const steps = linePlan?.steps.get(turnIndex);
    const open =
      steps !== undefined && foldOverrides[ordinal(steps.opener)] === true;
    const divider =
      turn.greeting && greetingTime ? (
        <MessageTimeDivider
          label={greetingTime.label}
          full={greetingTime.full}
          iso={greetingTime.iso}
        />
      ) : (
        reportDivider
      );
    return (
      <Fragment key={key}>
        {divider}
        <AgentTurnView
          turn={turn}
          hideMarker
          stepNumber={stepNumberOf.get(turnIndex)}
          runTelemetry={runTelemetryOf.get(turnIndex)}
          bubble
          answerClassName={divider ? "mt-5" : gap}
          attachment={turn.messageId ? afterAnswer(turn.messageId) : undefined}
          process={
            steps
              ? { open, onToggle: () => toggleFold(steps.opener, !open) }
              : undefined
          }
        />
        {steps && (
          <AssistantProcessCard
            open={open}
            stats={steps.stats}
            telemetry={runTelemetryOf.get(turnIndex) ?? turn.telemetry}
            steps={assistantProcessSteps(steps.members, turns, turnIndex).map(
              (m) => ({
                key: `step-${ordinal(m)}`,
                turn: turns[m] as AgentTurn,
              }),
            )}
          />
        )}
      </Fragment>
    );
  };

  // A run without an answer in the assistant's conversation (ruling 159,
  // ticket 114): one line where its reply would be, right after the
  // run's last turn, its card under it (AssistantStoppedRun). Open state
  // in the fold overrides by its opener, closed by default. A report
  // round's time at a break goes above it when the line is the first
  // thing its round draws (a question before it carries the time
  // otherwise). `previous`: the side of the row right above.
  const renderStoppedRun = (
    run: AssistantRunSteps,
    turnIndex: number,
    previous: AssistantRowSide | null,
  ): ReactNode => {
    const reportTime = linePlan?.message.has(turnIndex)
      ? undefined
      : reportTimeAbove.get(turnIndex);
    const open = foldOverrides[ordinal(run.opener)] === true;
    return (
      <Fragment key={`stopped-${ordinal(run.opener)}`}>
        {reportTime && (
          <MessageTimeDivider
            label={reportTime.label}
            full={reportTime.full}
            iso={reportTime.iso}
            afterActionRow={endsWithActionRow(previous)}
          />
        )}
        <AssistantStoppedRun
          stats={run.stats}
          open={open}
          onToggle={() => toggleFold(run.opener, !open)}
          className={reportTime ? "mt-5" : assistantRowGap(previous, "agent")}
          steps={assistantProcessSteps(run.members, turns, -1).map((m) => ({
            key: `step-${ordinal(m)}`,
            turn: turns[m] as AgentTurn,
          }))}
        />
      </Fragment>
    );
  };

  // An ask_user question drawn out before its run's fold header (the
  // answered echo, as the step region drew it; lib/run-fold-plan.ts).
  const renderQuestion = (turn: AgentTurn, turnIndex: number) => {
    const args = mergedAskUserArgs(turn.tools);
    return args ? (
      <AnsweredAskUser
        key={`turn-${ordinal(turnIndex)}`}
        question={args.question}
        candidates={args.candidates}
        answer={askUserReplyContent(turns, turnIndex, replySet)}
      />
    ) : null;
  };

  // Assembly: consecutive items owned by the same group gather into one
  // region — the live window, or a flat StepRegion; everything else
  // renders at its own place. A run behind a fold header is drawn right
  // before the turn its plan anchors it at (lib/run-fold-plan.ts): its
  // questions and the user's answers, then the header, then the card
  // of its steps (RunFoldSection); its steps are not drawn at their own
  // places. The header and the card keep their keys from live to
  // settled, so a run opened while live settles open without
  // remounting. A flat region's final turn contributes twice — its
  // marker + StrongHr close the region (markerOnly), its answer body
  // renders flat right after.
  type SectionKind = "flat" | "window";
  const rendered: ReactNode[] = [];
  // `previous`: the side of the row right above, for an answer's time
  // line.
  const renderHead = (head: FoldHead, previous: AssistantRowSide | null) => {
    let side = previous;
    for (const i of head.outside) {
      const turn = turns[i];
      if (turn.role === "agent") {
        rendered.push(renderQuestion(turn, i));
        side = "agent";
      } else {
        rendered.push(renderItem(turn, i, side));
        side = "user";
      }
    }
    // The live header appears once a step has folded behind it (the
    // third step landing, for a two-row window); before that the run
    // is its own short list.
    if (head.live && head.foldedSteps === 0) return;
    const opener = head.group.openerIndex;
    rendered.push(
      <RunFoldHeader
        key={`fold-head-${ordinal(opener)}`}
        stats={head.group.stats}
        open={!head.folded}
        live={head.live}
        onToggle={() => toggleFold(opener, head.folded)}
      />,
      <RunFoldSection
        key={`fold-${ordinal(opener)}`}
        open={!head.folded}
        steps={head.rows.map((m) => ({
          key: `step-${ordinal(m)}`,
          turn: turns[m] as AgentTurn,
        }))}
      />,
    );
  };
  let section: {
    opener: number;
    kind: SectionKind;
    nodes: ReactNode[];
  } | null = null;
  const flushSection = () => {
    if (!section) return;
    if (section.kind === "flat") {
      // A headless lead-in group (opener -1) is always the first.
      const regionKey = section.opener < 0 ? "lead" : ordinal(section.opener);
      rendered.push(
        <StepRegion key={`region-${regionKey}`}>{section.nodes}</StepRegion>,
      );
    } else if (section.kind === "window") {
      // The live window's open tail, in an ExpandSection so it can
      // sweep closed when the run settles. Gap choreography (the
      // marker's own top margin is zeroed through the data-role
      // hook, so the gap above the window is owned here):
      //
      //   no header yet      mt-6 on the section — the run-boundary
      //                      gap after the user message, collapsing
      //                      with its my-5 as a plain marker would.
      //   header, collapsed  -mt-2.5 + pt-2.5: the header's mb-2.5
      //                      hug is cancelled and re-issued as
      //                      padding INSIDE the overflow box, so the
      //                      rail (top-0 of the region) runs through
      //                      the gap up to the header — a negative
      //                      rail offset would be clipped.
      //   header, expanded   the same margin and padding: the card
      //                      section above ends with its own 16px
      //                      (pb-4), which the -mt-2.5 overlaps by
      //                      10 and the pt-2.5 gives back, so the
      //                      window's first marker sits 16px under
      //                      the card, as the answer does once the
      //                      run settles. The rail starts at that
      //                      marker (railFrom="step"): the card is
      //                      no line to hang it from.
      //
      // Closed, the margin goes to 0, so the header's hug to the answer
      // holds while the rows sweep. The margins collapse across a
      // mounted 0fr card section (0 and -10 → -10), and the margin is
      // the same open or not, so toggling the live header does not
      // jitter.
      const h = headOf.get(section.opener);
      const hasHeader = h !== undefined && h.foldedSteps > 0;
      const expanded = hasHeader && !h.folded;
      rendered.push(
        <ExpandSection
          key={`window-${ordinal(section.opener)}`}
          open={ordinal(section.opener) !== settlingOpener}
          openClassName={hasHeader ? "-mt-2.5" : "mt-6"}
          closedClassName="mt-0"
        >
          {/* Each window step carries the in-run gap as its own
              bottom padding (pb-2.5 on its wrapper), so a departing
              step takes its gap with it as it sweeps closed and the
              incoming step brings its own; the region cancels the
              last step's padding (-mb-2.5, effective inside the
              overflow box) so the gap down to MainView's in-flight
              row stays the marker's mt-2.5 alone. */}
          <StepRegion
            railFrom={expanded ? "step" : "content"}
            className={cn(
              "-mb-2.5 [&_[data-role=step-marker]]:mt-0",
              hasHeader && "pt-2.5",
            )}
          >
            {section.nodes}
          </StepRegion>
        </ExpandSection>,
      );
    }
    section = null;
  };
  // The side of the last message row: the assistant's IM row gap, and
  // in both conversations whether a time line sits right under a
  // reply's action row.
  let prevSide: AssistantRowSide | null = null;
  turns.forEach((turn, turnIndex) => {
    // The assistant's conversation shows a run's steps only under its
    // answer's process button or the line of a run without one, and not
    // at all while it runs.
    if (
      linePlan &&
      !linePlan.message.has(turnIndex) &&
      !linePlan.flat.has(turnIndex) &&
      !linePlan.stopped.has(turnIndex)
    ) {
      return;
    }
    // A run behind a fold header: its questions and answers, header and
    // card, right before the turn the plan anchors it at.
    const head = foldPlan?.heads.get(turnIndex);
    if (head) {
      flushSection();
      renderHead(head, prevSide);
      prevSide = null;
    }
    if (foldPlan?.elsewhere.has(turnIndex)) return;
    const flatOwner = regionOwner.get(turnIndex);
    const windowOf = windowOwner.get(turnIndex);
    const owner = flatOwner ?? windowOf;
    if (owner === undefined) {
      flushSection();
      if (linePlan) {
        const row = linePlan.message.has(turnIndex)
          ? renderLineRow(turn, turnIndex, prevSide)
          : null;
        if (row) {
          rendered.push(row);
          // Your message ends with its row of chips (ruling 105), a
          // reply with its action bar: either is the gap to the next.
          prevSide =
            turn.role === "user"
              ? "user-bar"
              : turn.role !== "agent"
                ? null
                : linePlan.question.has(turnIndex)
                  ? "agent"
                  : "agent-bar";
        }
        // A run without an answer: its line after its last turn, which
        // ends with its own gap under it, as a reply ends with its bar.
        const stopped = linePlan.stopped.get(turnIndex);
        if (stopped) {
          rendered.push(renderStoppedRun(stopped, turnIndex, prevSide));
          prevSide = "agent-bar";
        }
        return;
      }
      // The in-flight row's place closing above a one-step answer that
      // just settled.
      if (turnIndex === settleGapAbove) {
        rendered.push(<SettleGap key={`settle-${ordinal(turnIndex)}`} />);
      }
      rendered.push(renderItem(turn, turnIndex, prevSide));
      prevSide =
        turn.role === "user"
          ? "user"
          : turn.role === "agent" && answerOnly.has(turnIndex)
            ? "agent-bar"
            : null;
      return;
    }
    const kind: SectionKind = flatOwner !== undefined ? "flat" : "window";
    if (section && (section.opener !== owner || section.kind !== kind)) {
      flushSection();
    }
    // A report round drawn the workbench way: its time above the region.
    const reportTime = reportTimeAbove.get(turnIndex);
    if (reportTime) {
      flushSection();
      rendered.push(
        <MessageTimeDivider
          key={`report-time-${ordinal(turnIndex)}`}
          label={reportTime.label}
          full={reportTime.full}
          iso={reportTime.iso}
          afterActionRow={endsWithActionRow(prevSide)}
        />,
      );
    }
    prevSide = null;
    if (!section) section = { opener: owner, kind, nodes: [] };
    if (kind === "window") {
      // Per-step sweep in the window: mounts growing from 0fr and
      // closes when the step departs (see `departing`).
      section.nodes.push(
        <ExpandSection
          key={`step-${ordinal(turnIndex)}`}
          open={!departing.includes(ordinal(turnIndex))}
          animateMount
        >
          <div className="pb-2.5">{renderItem(turn, turnIndex)}</div>
        </ExpandSection>,
      );
      return;
    }
    if (answerOnly.has(turnIndex) && turn.role === "agent") {
      section.nodes.push(
        <AgentTurnView
          key={`marker-${ordinal(turnIndex)}`}
          turn={turn}
          markerOnly
          stepNumber={stepNumberOf.get(turnIndex)}
        />,
      );
      flushSection();
      rendered.push(renderItem(turn, turnIndex));
      // The answer ends with its action row (the assistant's row gap).
      prevSide = "agent-bar";
      return;
    }
    section.nodes.push(renderItem(turn, turnIndex));
  });
  flushSection();

  // Names the model repeats for files this session wrote resolve to the
  // bridge-recorded absolute path (lib/written-files.ts), so a delivery
  // like `./汕尾旅游指南.md` opens even when the reply skipped the full path.
  // Over the loaded turns only (paged history, ticket 12): a write in a
  // page not loaded yet resolves once that page is.
  const writtenFiles = useMemo(() => buildWrittenFileResolver(turns), [turns]);
  // A script step names its tab only by id; the site comes from the
  // session's most recent tab list (lib/browser-site.ts), so the
  // resolution is a whole-session pass, not a per-pill one — over the
  // loaded turns, like the file names above.
  const browserSites = useMemo(() => buildBrowserSiteResolver(turns), [turns]);
  // The bubbles' message menus (main chat ticket 38): rows by id, so the
  // ⋯ under every reply asks in constant time whether it has one.
  const indexById = useMemo(() => {
    const byId = new Map<string, number>();
    turns.forEach((turn, index) => {
      if (turn.role !== "system" && turn.messageId) {
        byId.set(turn.messageId, index);
      }
    });
    return byId;
  }, [turns]);
  const menuWiring: MessageMenuWiring | null =
    linePlan && messageMenu
      ? {
          has: (messageId) => {
            const index = indexById.get(messageId);
            return index !== undefined && isMenuBubble(turns, linePlan, index);
          },
          canQuote: (messageId) => {
            const index = indexById.get(messageId);
            return (
              index !== undefined && canQuoteMessage(turns, linePlan, index)
            );
          },
          model: (messageId) => {
            const index = indexById.get(messageId);
            const target =
              index === undefined
                ? null
                : messageMenuTarget(turns, linePlan, groups, index);
            if (!target) return null;
            const opener = target.processOpener;
            const processOpen =
              opener !== null && foldOverrides[ordinal(opener)] === true;
            return {
              entries: messageMenuEntries(target, {
                processOpen,
                block: messageDeleteBlock(target.deletable, messageMenu),
              }),
              onSelect: (action) => {
                switch (action) {
                  case "copy":
                    if (target.copyText !== null) {
                      void copyTextToClipboard(target.copyText);
                    }
                    return;
                  case "quote":
                    if (target.quoteText !== null) {
                      messageMenu.onQuote(target.quoteText);
                    }
                    return;
                  case "save":
                    if (target.saveSource !== null) {
                      saveReplyMarkdown(target.saveSource).catch((e) =>
                        console.warn("[MessageMenu] save failed", e),
                      );
                    }
                    return;
                  case "process":
                    if (opener !== null) toggleFold(opener, !processOpen);
                    return;
                  case "delete":
                    messageMenu.onDelete({
                      messageId: target.deletable.messageId,
                      rowIds: target.rowIds,
                    });
                    return;
                }
              },
            };
          },
        }
      : null;
  // `data-role` names the rows a prepend keeps still (lib/scroll-anchor).
  const root = <div data-role="conversation">{rendered}</div>;
  return (
    <WrittenFilesContext.Provider value={writtenFiles}>
      <BrowserSitesContext.Provider value={browserSites}>
        {menuWiring ? (
          <MessageMenuProvider value={menuWiring}>
            <MessageContextMenu>{root}</MessageContextMenu>
          </MessageMenuProvider>
        ) : (
          root
        )}
      </BrowserSitesContext.Provider>
    </WrittenFilesContext.Provider>
  );
}

function AgentTurnView({
  turn,
  hideMarker = false,
  markerOnly = false,
  suppressAskUserEcho = false,
  askUserAnswer,
  stepNumber: stepNumberProp,
  runTelemetry,
  bubble = false,
  answerClassName,
  process,
  attachment,
}: {
  turn: AgentTurn;
  /** The answer alone, for every closing turn: a folded run's closing
   * step is no row of its card (RunFoldSection) and the RunFoldHeader
   * is the answer's eyebrow and hugs it (see the StrongHr call site);
   * a flat region's closing marker + StrongHr render inside the region
   * (see `markerOnly`). A closing turn has no narration / real tools /
   * ask_user by definition (run-groups isClosingTurn). */
  hideMarker?: boolean;
  /** hideMarker's other half in a flat region (a /btw run, a headless
   * lead-in): render ONLY the closing turn's TurnMarker + StrongHr, as
   * the last nodes inside the region — they belong to the run's
   * process chapter. */
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
  /** Display step number overriding GA's `turn.turnIndex`: position
   * within the run (run-groups `runStepNumbers`), because GA restarts
   * its counter at every put_task — each ask_user reply. */
  stepNumber?: number;
  /** Whole-run telemetry for a closing turn's answer footer (run-groups
   * `RunStats.telemetry`). The turn's own telemetry only covers the
   * last GA loop; undefined for turns that close no run. */
  runTelemetry?: MessageTelemetry | null;
  /** The assistant's conversation: the answer and the answered question
   * are left bubbles. */
  bubble?: boolean;
  /** The answer's row margin (the assistant's IM grouping). */
  answerClassName?: string;
  /** The assistant's process button, last in the answer's action bar
   * (a run of two steps or more). */
  process?: AssistantProcessToggle;
  /** The subtask cards in the assistant's conversation, held right under
   * the answer bubble (after the turn's content when it has no answer). */
  attachment?: ReactNode;
}) {
  const stepNumber = stepNumberProp ?? turn.turnIndex;
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
  // real tools, the tool name otherwise. On a tool step the echo is of
  // its narration, and a marked step shows that narration as its
  // marker line instead (`narrationIsHeading` below); the tool name is
  // left for narration that cleans to nothing.
  const realTools = visibleTools.filter((t) => t.name !== "no_tool");
  const markerSummary = stepMarkerSummary(
    turn.summary,
    answerText,
    realTools.map((t) => t.name),
    copy.conversation,
  );

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
    stepNumber !== undefined &&
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
        {stepNumber !== undefined && (
          <TurnMarker
            index={stepNumber}
            summary={markerSummary}
            thinkingContent={turn.thinking}
            preamble={detailPreamble}
          />
        )}
        {answerText && <StrongHr />}
      </div>
    );
  }

  const showMarker = stepNumber !== undefined && !hideMarker && !mergedStepTool;

  // A tool step whose summary is only GA's echo of its narration has
  // no heading sentence of its own (lib/step-heading.ts), so the
  // narration becomes the marker line and gets no row of its own
  // (2026-09-23). JC picked this form after a live A/B/C comparison.
  // The other candidate kept the narration as a body-size heading row
  // over the tools; its known cost was a heavier process region next
  // to the final answer. The old form's 「调用了 X」 marker only
  // repeated the tool pill below it. The line is the narration run
  // through the sidebar's recap cleaner (markdown markers out,
  // whitespace collapsed), not GA's summary, which may be
  // middle-elided past 80 characters. While the step streams, the
  // narration reads in the body register; at turn_end it settles into
  // this 12px line, a restyle on purpose.
  const narrationIsHeading = isEchoNarrationStep({
    hasMarker: showMarker,
    closingShaped: isFinalTurn,
    narration: answerText,
    summary: turn.summary,
  });
  const markerLine = stepMarkerLine(
    markerSummary,
    answerText,
    narrationIsHeading,
  );

  return (
    <div>
      {showMarker && (
        <TurnMarker
          index={stepNumber}
          summary={markerLine}
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
            no real tools). An echo-narration step's narration is its
            marker line instead (`narrationIsHeading`). */}
        {answerText && !isFinalTurn && !narrationIsHeading && (
          <MessageAgentNarration>{answerText}</MessageAgentNarration>
        )}

        {visibleTools.map((tool) => (
          <ToolCallout
            key={tool.id}
            tool={tool}
            stepIndex={tool === mergedStepTool ? stepNumber : undefined}
          />
        ))}

        {typeof askUserQuestion === "string" && !suppressAskUserEcho && (
          <AnsweredAskUser
            question={askUserQuestion}
            candidates={askUserCandidates}
            answer={askUserAnswer}
            bubble={bubble}
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
          the wrong neighbour (2026-08-06). Opened, the card's edge
          parts the action from the conclusion, and a full-width rule
          under it would be a second line (2026-10-16). */}
      {answerText && isFinalTurn && (
        <>
          {!hideMarker && <StrongHr />}
          <MessageAgent
            telemetry={runTelemetry ?? turn.telemetry}
            messageId={turn.messageId}
            bubble={bubble}
            className={answerClassName}
            process={process}
            attachment={attachment}
          >
            {answerText}
          </MessageAgent>
        </>
      )}
      {!(answerText && isFinalTurn) && attachment}
    </div>
  );
}

function normalizedInlineText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Galley narration: a persisted system row (SystemMessageBubble's
 * `narration` register). */
function isNarrationTurn(turn: Turn | undefined): boolean {
  return turn?.role === "system" && turn.variant === "narration";
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
 *     is reserved for the run boundary.
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
 *     Same line + trailing caret. The whole row is a disclosure
 *     (2026-09-23): role="button", a tab stop, Enter / Space toggle,
 *     aria-expanded, and no aria-label — its name is its own content
 *     (the sr-only 「第 N 步」 plus the summary). Toggling reveals an
 *     inline DetailPanel with the LLM's thinking and "当前阶段：..."
 *     preamble below the step row, in the italic thinking register.
 *     Reveals the reasoning the LLM wrote before dispatching the
 *     tool, on demand — without forcing it onto users who don't care.
 *     Hover or keyboard focus anywhere on the row paints bg-hover and
 *     lifts summary + caret to ink, the same answer the RunFoldHeader
 *     and the tool pill give. The box covers the content column only
 *     — the numeral gutter stays outside it — and its left edge sits
 *     10px left of the content x, the tool pill's hover-box edge, so
 *     marker and pill boxes stack flush. A drag-select inside the
 *     summary (select-text: an echo step's marker line is the model's
 *     narration, worth copying) does not toggle. Before this the row
 *     gave no hover signal: its row-level ink lift went dead when the
 *     summary took its own ink (2026-06-09), and the pointer cursor
 *     that still marked it clickable left with the native-feel round
 *     (2026-07-16, foundations §2.6: native arrow on chrome).
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
   * sees the same recap there and in the conversation document. On
   * an echo step (GA's summary is only the narration again) the caller
   * passes the cleaned narration itself instead (2026-09-23).
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
  const elapsedDs = useElapsedDeciseconds(thinking, index);
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
        // Resting ink-muted, lifted with the summary by the row's
        // hover / focus (see contentBox).
        "ml-1 inline-block shrink-0 align-[-1px] text-ink-muted transition-transform duration-(--motion-fast) group-hover:text-ink group-focus-visible:text-ink",
        open && "rotate-180",
      )}
    />
  ) : null;
  // The disclosure's hover / focus box (2026-09-23), on the content
  // column only: the numeral gutter stays outside, as the merged pill
  // row keeps its prefix outside its button. -ml-2.5 pl-2.5 bleeds the
  // box 10px left while the text x stays put — the tool pill's hover
  // box starts there too (its wrapper's -ml-2.5), so the two stack on
  // one left edge. No vertical bleed: the box is the line box itself.
  // A 2px -my/py bleed was cut flat at the top in the live run window,
  // whose ExpandSection clips flush with a marker row that has its
  // top margin zeroed. No transition: hover is instant here, as on
  // the pill and the RunFoldHeader.
  const contentBox = hasDetail
    ? "-ml-2.5 rounded-sm pl-2.5 pr-2 group-hover:bg-hover group-hover:text-ink group-focus-visible:bg-hover group-focus-visible:text-ink"
    : undefined;
  const trailing = thinking ? (
    <ThinkingStatus status={liveStatus} elapsedLabel={elapsedLabel} />
  ) : summary ? (
    // Wraps rather than truncates (2026-09-16): the summary is the
    // step's sentence and a clipped sentence loses the step. GA
    // summaries run one to two sentences, so this is rarely more
    // than two lines.
    <span
      className={cn("min-w-0 flex-1 select-text text-ink-soft", contentBox)}
    >
      {summary}
      {detailCaret}
    </span>
  ) : hasDetail ? (
    // Bare-number step with detail: the lone caret still gets the
    // full-width content box, not a small square around itself.
    <span className={cn("min-w-0 flex-1", contentBox)}>{detailCaret}</span>
  ) : null;

  return (
    <div>
      <div
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? open : undefined}
        onClick={
          hasDetail
            ? (e) => {
                // A drag-select that starts and ends inside the row
                // still fires click; finishing a copy must not toggle
                // the panel. A plain click collapses any selection on
                // mousedown, so it passes.
                const selection = window.getSelection();
                if (
                  selection &&
                  !selection.isCollapsed &&
                  selection.anchorNode &&
                  e.currentTarget.contains(selection.anchorNode)
                ) {
                  return;
                }
                setOpen((v) => !v);
              }
            : undefined
        }
        onKeyDown={
          hasDetail
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
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
          // The in-flight row eases in once, when the run starts
          // (it is one instance per run, so this never replays per
          // step) — a from-nothing appearance, same hand as the
          // streaming prose blocks.
          thinking && "animate-fade-in",
          // Run boundary keeps the chapter gap; in-run steps tighten.
          // `index` unknown (pre-turn_start thinking gap) defaults to
          // the boundary gap — the common case for that window is the
          // first step right after the user submits.
          index != null && index > 1 ? "mt-2.5" : "mt-6",
          // The row is only the `group`: the hover / focus paint lives
          // on the children (contentBox, caret) via group-hover. A
          // row-level hover:text-ink cannot reach children that set
          // their own ink — summary, numeral and caret all do — which
          // is how the old lift went dead. outline-none because the
          // focus-visible paint is the focus indicator, as on the
          // RunFoldHeader.
          hasDetail && "group cursor-default outline-none",
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
        {stepLabel && !thinking && <span className="sr-only">{stepLabel}</span>}
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
function useElapsedDeciseconds(active: boolean, resetKey: unknown): number {
  const [ds, setDs] = useState(0);
  // `resetKey` (the step index) restarts the clock without the row
  // remounting (2026-09-16): the in-flight marker is one instance
  // for the whole run, so the counter snaps back to 0.0 in place.
  // The zero lands in the render that sees the new key (guarded
  // setState-in-render); the interval below restarts from the same
  // dependency and carries on from there.
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setDs(0);
  }
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      setDs(Math.floor((Date.now() - start) / 100));
    }, 100);
    return () => window.clearInterval(id);
  }, [active, resetKey]);
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

/**
 * The settling sweep of a run that answered in one step (workbench
 * conversation ticket 01). Such a run has no window to close and
 * settles to its answer alone, while the answer it streamed sat under
 * MainView's in-flight row: one step line (step size × 1.6) and the
 * paragraph gap the streaming prose keeps from it. Drawn flat straight
 * away, the answer would jump up by that much; this holds the place
 * for one frame and sweeps it shut with the rest of the settle
 * (ExpandSection, --motion-slow), so it glides. Gone with the settle.
 * (The in-flight row itself stays under the answer until run_complete,
 * as it does for every run.)
 */
function SettleGap() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Two frames: the open state must paint before the sweep starts.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setOpen(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return (
    <ExpandSection open={open}>
      <div
        aria-hidden
        className="h-[calc(var(--conversation-step-size)*1.6+var(--conversation-block-gap))]"
      />
    </ExpandSection>
  );
}

// SoftHr removed (2026-05-09): even at my-5 (40px) the hr+marker
// stack between turns felt heavy. TurnMarker's own top margin +
// structural register now carries the chapter-break feel.
