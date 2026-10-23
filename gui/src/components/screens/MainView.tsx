import { ArrowDown } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AskUserBubble } from "@/components/conversation/AskUserBubble";
import {
  Composer,
  type ComposerLLMOption,
  type ComposerReasoningEffortState,
  type ImageBlockReason,
} from "@/components/conversation/Composer";
import {
  Conversation,
  TurnMarker,
} from "@/components/conversation/Conversation";
import {
  TypingBubble,
  type TypingProgress,
} from "@/components/conversation/TypingBubble";
import { ConversationSkeleton } from "@/components/conversation/ConversationSkeleton";
import { StepLimitTail } from "@/components/conversation/StepLimitTail";
import { Button } from "@/components/ui/button";
import {
  buildRunGroups,
  liveRunElapsedBaseMs,
  liveRunGroup,
  liveWindowHasSettledStep,
} from "@/lib/run-groups";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { RunElapsedHud } from "@/components/conversation/RunElapsedHud";
import { SelectionCopyToolbar } from "@/components/conversation/SelectionCopyToolbar";
import { StepRegion } from "@/components/conversation/StepRegion";
import { FileCards } from "@/components/conversation/FileCards";
import { ReminderCards } from "@/components/conversation/ReminderCards";
import { SubtaskCards } from "@/components/conversation/SubtaskCards";
import { TodoCards } from "@/components/conversation/TodoCards";
import { ThinkingPreview } from "@/components/conversation/ThinkingPreview";
import { UserQuestionRail } from "@/components/conversation/UserQuestionRail";
import { useActiveMessages } from "@/hooks/useActiveSession";
import { useEarlierTurns } from "@/hooks/useEarlierTurns";
import { useRemovedTurnsAnchor } from "@/hooks/useRemovedTurnsAnchor";
import { useStickyScroll } from "@/hooks/useStickyScroll";
import { useSubtaskQuestionHolder } from "@/hooks/useSubtaskQuestionHolder";
import { useRemindersByMessage } from "@/hooks/useReminderCards";
import { useSubtaskDispatchesByMessage } from "@/hooks/useSubtaskCards";
import { useTodosByMessage } from "@/hooks/useTodoCards";
import { useTypewriter } from "@/hooks/useTypewriter";
import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";
import { useMarkdownStream } from "@/hooks/useMarkdownStream";
import { typingBubbleShown } from "@/lib/assistant-conversation";
import { assistantDoing } from "@/lib/assistant-progress";
import { filesByMessage } from "@/lib/file-cards";
import { openMainChat } from "@/lib/main-chat";
import { endsInSilentReport, subtaskQuestionLocked } from "@/lib/subtasks";
import {
  composerRegisterCopyKey,
  resolveComposerRegister,
} from "@/lib/composer-register";
import {
  ASSISTANT_BUBBLE_TEXT_CLASS,
  assistantBubbleTextStyle,
  conversationTypographyStyle,
  type ConversationFontSize,
} from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import {
  cleanPartialContent,
  extractLiveThinking,
  extractPreamble,
} from "@/lib/ipc/ga-output-cleaning";
import { withoutHiddenTurns } from "@/lib/message-delete";
import { mendStreamingMarkdown } from "@/lib/mend-streaming-markdown";
import { stepLimitTailVisible } from "@/lib/step-limit";
import { takeQuote } from "@/lib/todo-open";
import {
  typingBubbleHandoff,
  type TypingBubbleFrame,
  type TypingBubbleHandoff,
} from "@/lib/typing-bubble-handoff";
import { cn } from "@/lib/utils";
import { hiddenRowIds, useMessageDeleteStore } from "@/stores/message-delete";
import { EMPTY_ORDINALS, useMessagesStore } from "@/stores/messages";
import { useUiStore } from "@/stores/ui";
import type {
  PendingAskUser,
  PendingImageAttachment,
  SendPhase,
  Turn,
} from "@/types/conversation";
import type { ComposerHandle } from "@/components/conversation/composer-props";

export interface MainViewProps {
  turns: Turn[];
  llmDisplayName: string;
  /** Active session's id. MainView watches it to scroll to the bottom
   * of the new conversation when the user switches sessions. The
   * component doesn't read or display the id, just uses identity
   * change as the trigger. Undefined during pre-session screens. */
  activeSessionId?: string;
  onSubmit?: (
    text: string,
    attachments: PendingImageAttachment[],
  ) => boolean | void;
  onStop?: () => void;
  /** This is the main chat (主聊天, ticket 02): the conversation is
   * drawn as the assistant's (see MainViewContent). A send while it
   * works queues, as in every session (ruling 71). */
  isMainChat?: boolean;
  /** When true, the agent is mid-run; the Composer hides Submit and
   * shows Stop, the LLM switcher disables. */
  isRunning?: boolean;
  /**
   * True between the user clicking Stop and the bridge's run_complete /
   * error. Forwarded to the Composer so the Stop button shows its
   * "停止中…" acknowledged state and won't fire a second abort.
   */
  isStopping?: boolean;
  // The streaming fields below were previously passed as props from
  // `App`, which subscribed to them at the root. That meant every
  // `turn_progress` token re-rendered the entire app tree. They are
  // now subscribed INSIDE MainView (see the `useMessagesStore` hooks
  // below), so token churn is confined to the MainView subtree and
  // the top bar / sidebar / settings no longer reconcile per chunk.
  //
  // GA-side turn currently being run, surfaced into the thinking
  // placeholder (Turn N · 思考中…). `null` during quiet states.
  /** LLM list for the Composer's inline picker. */
  llms?: ComposerLLMOption[];
  /** Called when the user picks an LLM from the inline dropdown. */
  onSelectLLM?: (index: number) => void;
  /** Runtime-specific footer hint in the Composer model dropdown. */
  llmConfigHint?: string;
  /** Opens Settings -> Models from the Composer model dropdown. */
  onConfigureModels?: () => void;
  /** When true, submitting opens Models instead of sending to the bridge. */
  requiresModelConfig?: boolean;
  /** Fallback for pre-bridge / dev when `llms` is empty. */
  onOpenLLMSwitcher?: () => void;
  /** Reasoning-effort pill state for this session's Composer (the
   * independent pill right of the model picker). */
  reasoningEffort?: ComposerReasoningEffortState;
  /**
   * GA-initiated question waiting for a user reply. When non-null,
   * the AskUserBubble renders at the conversation tail (with chip
   * candidates) and the Composer's placeholder switches to a reply
   * prompt. Submitting (chip click OR Composer text) routes through
   * `onSubmit` — App.tsx checks the same flag to send
   * `ask_user_response` instead of `user_message`.
   */
  pendingAskUser?: PendingAskUser | null;
  /**
   * Conversation column width mode (TopBar toggle). "compact" caps
   * the scrollable reading column at 760px for a comfortable document
   * measure; "wide" caps it at 1200px — a compromise between
   * Notion's prose-only 1040 and the original 1400 proposal, sized
   * for Workbench's mixed prose + code block + tool callout content.
   *
   * Both the scrollable conversation column AND the bottom stack
   * (Composer + hint) follow this mode in lockstep.
   * Earlier iterations kept the bottom stack narrow on the
   * "input doesn't need to be wide" theory; this turned out to be
   * wrong: (a) the EmptyState toggle then had no visible effect
   * since EmptyState only contains a Composer, and (b) bottom-stack
   * pieces at a different width from the column produced visual
   * misalignment in MainView. Single width keeps the affordance consistent and
   * predictable across all screens.
   */
  conversationWidth?: "compact" | "wide";
  conversationFontSize?: ConversationFontSize;
  imagesEnabled?: boolean;
  onImageBlocked?: (reason: ImageBlockReason) => void;
  onTextDropBlocked?: () => void;
}

/**
 * Main view — the in-session screen. Per DESIGN.md §3 layout floor +
 * §4.3 conversation document + §4.4 composer.
 *
 * Two vertical regions, both aligned to a 760px reading column:
 *
 *   Conversation (scrollable, takes the bleeding flex-1 space)
 *   Composer + keyboard hint row
 *
 * Title / runtime / inspector toggle live in the AppShell-level Top
 * Bar; nothing chrome-y belongs here.
 */
export function MainView(props: MainViewProps) {
  return <MainViewContent {...props} />;
}

/** Every conversation but the main chat: no file cards, one map. */
const NO_FILES = new Map<string, readonly string[]>();

function MainViewContent({
  turns,
  llmDisplayName,
  activeSessionId,
  onSubmit,
  onStop,
  isMainChat = false,
  isRunning = false,
  isStopping = false,
  llms,
  onSelectLLM,
  llmConfigHint,
  onConfigureModels,
  requiresModelConfig = false,
  onOpenLLMSwitcher,
  reasoningEffort,
  pendingAskUser,
  conversationWidth = "compact",
  conversationFontSize = "standard",
  imagesEnabled = true,
  onImageBlocked,
  onTextDropBlocked,
}: MainViewProps) {
  const copy = useCopy();
  // The main chat is the assistant (main chat PRD rulings 60, 66, 67):
  // its conversation reads as an IM with one person, not as the
  // workbench's task record (lib/assistant-conversation.ts).
  // `isMainChat` is the one gate, in these places below: Conversation's
  // `assistant` (bubbles on both sides, the quiet 「N 步 ›」, the centred
  // time lines); the typing bubble in place of the in-flight row, with
  // no streaming prose and no clock; the question as a bubble;
  // 贴底 (useStickyScroll's `stickBottom`, the column stacked up from
  // the composer); and the composer (rulings 71, 72): no hint row,
  // 「发消息…」, 24px off the window's bottom edge. Every other
  // conversation — the workbench's, a subtask, the external runtime's —
  // renders as before. The one-line composer itself is every session's
  // (ruling 74); the workbench's keeps its hint row under it.
  //
  // The latest run stopped at GA's per-run step cap (#29): a thread
  // tail, only while nothing else signals activity.
  const pausedAtStepLimit = useActiveMessages(
    (m) => m.pausedAtStepLimit,
    false,
  );
  const showStepLimitTail = stepLimitTailVisible({
    pausedAtStepLimit,
    isRunning,
    waitingAskUser: !!pendingAskUser,
  });

  // A subtask opened from its card whose question is with the assistant
  // — its round running, or its question to the user waiting in the
  // main chat (ruling 102, lib/subtasks.ts `subtaskQuestionHolder`):
  // nothing here may answer it, or the main chat's question would be
  // left waiting and the user's next message there taken as its answer.
  // The question's candidates and the composer are off; one line under
  // the question says so and leads back, as the 「Galley ›」 crumb does.
  const questionHolder = useSubtaskQuestionHolder(
    isMainChat ? undefined : activeSessionId,
  );
  const questionLocked = subtaskQuestionLocked(questionHolder);

  // The main chat's subtask cards (ticket 06a), by the reply that
  // dispatched them. Every other session has none.
  const subtaskDispatches = useSubtaskDispatchesByMessage(
    isMainChat ? activeSessionId : undefined,
  );
  // …the user's to-dos it noted in them (ticket 42), and the reminders
  // it set (ticket 37): under a reply, its subtask cards, then its
  // to-dos, then its reminders.
  const todos = useTodosByMessage(isMainChat ? activeSessionId : undefined);
  const reminders = useRemindersByMessage(
    isMainChat ? activeSessionId : undefined,
  );
  // …and the files it handed over (ticket 74), read off the replies
  // themselves (their `[FILE:]` markers), first under each: the reply's
  // own deliverable before the work it handed off.
  const deliveredFiles = useMemo(
    () => (isMainChat ? filesByMessage(turns) : NO_FILES),
    [isMainChat, turns],
  );

  // Streaming state, subscribed locally so token churn stays inside
  // this subtree instead of re-rendering the whole app. These were
  // previously passed as props from App; see MainViewProps docs above.
  const inFlightContent = useActiveMessages((m) => m.inFlightContent, "");
  const sendPhase = useActiveMessages((m) => m.sendPhase, null);
  // Cold-start restore: turns are still being read back from SQLite
  // and there is no previous transcript on screen (warm switches keep
  // the old one via the sessions.ts atomic swap). Ghost turns instead
  // of a blank column that would misread as an empty session.
  const restoring = useActiveMessages((m) => m.restoring, false);
  // Paged history (main-chat ticket 12): how many turns earlier pages
  // put in front (Conversation keys rows past them), and the send time
  // the first loaded user message measures its break against.
  const prependedTurns = useActiveMessages((m) => m.prependedTurns, 0);
  // Places of turns a deleted message took out (main chat ticket 32).
  const removedOrdinals = useActiveMessages(
    (m) => m.removedOrdinals,
    EMPTY_ORDINALS,
  );
  // A message deleted on the page and not yet by Core (its undo toast
  // up, or Core still answering; ticket 38) is gone from the
  // conversation already, its places skipped as if Core had deleted it.
  // Only the conversation's rows: everything else reads the turns whole.
  const stagedDeletes = useMessageDeleteStore((s) => s.staged);
  const shown = useMemo(
    () =>
      withoutHiddenTurns(
        turns,
        prependedTurns,
        removedOrdinals,
        hiddenRowIds(stagedDeletes, activeSessionId),
      ),
    [turns, prependedTurns, removedOrdinals, stagedDeletes, activeSessionId],
  );
  const previousUserCreatedAt = useActiveMessages(
    (m) => m.earlier?.previousUserCreatedAt ?? null,
    null,
  );
  const currentTurnIndex = useActiveMessages((m) => m.currentTurnIndex, null);
  // The in-flight region sits one in-run gap (mt-2.5) below the
  // conversation's live window; from the second step on its rail
  // reaches up through that gap so header → window → thinking row
  // read as one line (live-run-window PRD, 2026-09-16).
  // While the run has a live window, the window itself says whether a
  // settled step already sits above the in-flight row. Runs that are
  // not window-eligible (a /btw exchange) keep the step-count rule so
  // their flat region still connects.
  const inRunRail = useMemo(() => {
    const liveGroup = liveRunGroup(
      buildRunGroups(turns),
      isRunning,
      Boolean(pendingAskUser),
    );
    if (liveGroup) return liveWindowHasSettledStep(liveGroup, turns);
    return currentTurnIndex != null && currentTurnIndex > 1;
  }, [turns, isRunning, pendingAskUser, currentTurnIndex]);
  const currentRunStartedAtMs = useActiveMessages(
    (m) => m.currentRunStartedAtMs,
    null,
  );
  // Segments an ask_user reply already closed keep their time on the
  // HUD (see RunElapsedHud.baseMs).
  const runElapsedBaseMs = useMemo(() => liveRunElapsedBaseMs(turns), [turns]);
  // Latest final reply's next-step suggestion (managed runtime). The
  // session-level half of the ghost predicate lives here: idle and not
  // waiting on an ask_user reply. The Composer derives the rest
  // (empty textarea, no image attached) at render time.
  const nextSuggestion = useActiveMessages((m) => m.nextSuggestion, null);
  const ghostSuggestion = !isRunning && !pendingAskUser ? nextSuggestion : null;
  // Imperative Composer handle for the ask_user fill-in slow path
  // (candidate text → textarea, not sent).
  const composerRef = useRef<ComposerHandle>(null);
  const userSubmitTick = useMessagesStore((s) => s.userSubmitTick);
  // The to-do panel's 「说说这件」 (ticket 42) quotes a to-do into this
  // composer from outside MainView, through the UI store: one that
  // comes while the main chat is on screen, or one the panel filed
  // before it sent you here from elsewhere (ticket 46). Quoted once,
  // then cleared.
  useEffect(() => {
    const take = () => {
      const text = takeQuote(activeSessionId, isMainChat);
      if (text !== null) composerRef.current?.quote(text);
    };
    take();
    return useUiStore.subscribe((state, previous) => {
      if (state.quoteRequest !== previous.quoteRequest) take();
    });
  }, [isMainChat, activeSessionId]);

  // Stripped partial — empty when nothing renderable yet (e.g. only
  // `<thinking>...` partial has come through). We hide the
  // ThinkingSummary placeholder once we have user-visible streaming
  // content; otherwise the document briefly shows two "still
  // working" affordances.
  //
  // Memoized: `cleanPartialContent` runs ~12 regex passes over the
  // full buffer and `extractPreamble` another 7. Without memo they
  // re-run on every render — and during streaming the parent re-renders
  // on every token, so this is a per-token O(buffer) cost. Both depend
  // only on `inFlightContent`.
  const visiblePartial = useMemo(
    () => (inFlightContent ? cleanPartialContent(inFlightContent).trim() : ""),
    [inFlightContent],
  );
  // Live preamble for the streaming-step TurnMarker. Read from the
  // raw buffer (not visiblePartial — preamble is stripped from that
  // path so it doesn't double-render with the answer prose). We only
  // surface it while no answer body is visible; once real prose starts
  // streaming, the body itself is the progress signal.
  const livePreamble = useMemo(
    () => (inFlightContent ? extractPreamble(inFlightContent) : undefined),
    [inFlightContent],
  );
  // Live reasoning (2026-09-23): native reasoning streams in-band as
  // `<thinking>…</thinking>` (prompted models write the tag
  // themselves), which cleanPartialContent already keeps out of the
  // answer partial. `open` = the model is reasoning right now; `text`
  // feeds the ThinkingPreview under the in-flight step row.
  const liveThinking = useMemo(
    () => extractLiveThinking(inFlightContent),
    [inFlightContent],
  );
  const sendPhaseStatus = sendPhase
    ? sendPhaseToStatus(sendPhase, copy)
    : undefined;
  // An open reasoning block outranks every other status: it is the
  // freshest fact about the step, and the other sources go stale while
  // the model reasons — a send phase that landed after the first
  // tokens ("正在处理"), or a narration line written before the block
  // opened. 「正在回答…」 stays tied to real answer text streaming, so
  // it only appears once the reasoning has closed.
  const liveStepStatus = liveThinking.open
    ? copy.conversation.thinking
    : visiblePartial
      ? copy.conversation.answering
      : (sendPhaseStatus ?? compactLiveStepStatus(livePreamble));
  // The preview lives exactly as long as the reasoning block: it
  // collapses the moment the block closes (JC's pick after comparing
  // in the real app, 2026-09-23). The text is still in the buffer at
  // that point, so the collapse sweep shows it rather than an empty box.
  const thinkingPreviewVisible = liveThinking.text !== "" && liveThinking.open;
  // Fake-typewriter pass to smooth over GA's ~50-char chunked
  // delta pushes. See useTypewriter docs for the mitigation
  // rationale. If the GA-side throttle is eventually reduced enough,
  // this hook becomes a no-op (reveal already keeps pace with
  // arrivals) and can be removed without behavior change.
  // The assistant shows no streaming prose (its typing bubble stands for
  // the round): the typewriter and the markdown pipeline get nothing to
  // chew on.
  const typedPartial = useTypewriter(isMainChat ? "" : visiblePartial);
  // Markdown-parse throttle: `useTypewriter` reveals chars at ~60 Hz
  // and each revealed value would trigger a full `react-markdown`
  // re-parse of the growing buffer (O(n²) across a turn). This holds
  // the typewriter cadence for perceived smoothness but only commits
  // a value to the markdown renderer at ~20 Hz, cutting parse work
  // by roughly 3×. Final + boundary values still flush promptly.
  const throttledPartial = useMarkdownStream(typedPartial);
  // Display-only repair of hanging code spans / link destinations. Applied
  // here and nowhere else: settled turns render their raw source, so a marker
  // that never actually closes flips once at the end instead of jittering the
  // whole way. See `mendStreamingMarkdown` for what it covers and what it
  // deliberately leaves alone.
  const markdownPartial = useMemo(
    () => mendStreamingMarkdown(throttledPartial),
    [throttledPartial],
  );
  // The round at the end of the assistant's conversation: whether it
  // already has its answer (the typing bubble then goes, the answer
  // stands whole in the conversation, before run_complete). A report
  // round whose reply said nothing (`<no-reply/>`, main chat ticket 31)
  // settles too: nothing takes the typing bubble's place.
  const silentReport = useMemo(
    () => isMainChat && endsInSilentReport(turns),
    [isMainChat, turns],
  );
  // …and the answer that settled it (its row's message id), which the
  // typing bubble hands over to.
  const { roundSettled, replyId } = useMemo(() => {
    if (!isMainChat) return { roundSettled: false, replyId: null };
    const groups = buildRunGroups(turns);
    const last = groups[groups.length - 1];
    const reply =
      last?.finalTurnIndex != null ? turns[last.finalTurnIndex] : undefined;
    return {
      roundSettled: (last?.complete ?? false) || silentReport,
      replyId:
        reply && reply.role !== "system" ? (reply.messageId ?? null) : null,
    };
  }, [isMainChat, turns, silentReport]);
  // The round is live at the conversation's end while it runs; not
  // while it asks you (it waits, it is not busy), from the moment the
  // question arrives.
  const roundLive = isRunning && isMainChat && !roundSettled && !pendingAskUser;
  // The typing bubble (rulings 107, 110): from the send on in a round
  // you start, only while it writes words in one Core woke it for, never
  // in a silent one (lib/assistant-conversation.ts `typingBubbleShown`).
  const typingShown = useMemo(
    () => typingBubbleShown(roundLive, turns, inFlightContent),
    [roundLive, turns, inFlightContent],
  );
  // The line under the dots (rulings 134, 135): in a round you started,
  // what it is doing and the round's time (lib/assistant-progress.ts
  // `assistantDoing`, null in a round Core woke it for).
  const progressDoing = useMemo(
    () => (typingShown ? assistantDoing(turns, inFlightContent, copy) : null),
    [typingShown, turns, inFlightContent, copy],
  );
  const typingProgress: TypingProgress | null = progressDoing
    ? {
        doing: progressDoing,
        startedAtMs: currentRunStartedAtMs,
        baseMs: runElapsedBaseMs,
      }
    : null;
  // The hand-off (rulings 103, 110; tickets 51, 58): the render where
  // the live round's place goes to its bubble — the answer, or its
  // question — grows the bubble out of the typing bubble, and the follow
  // for it keeps the same clock. Only one you are watching: the round
  // was live in the render before, in this session, not under a
  // cold-start restore (lib/typing-bubble-handoff.ts). MainView mounts
  // per session, so a switch or a reload starts from what is there.
  // Guarded setState-in-render: the hand-off has to be known in the
  // commit that lands it.
  const typingFrameNow: TypingBubbleFrame = {
    sessionId: activeSessionId,
    live: roundLive && !restoring,
  };
  const [typingFrame, setTypingFrame] =
    useState<TypingBubbleFrame>(typingFrameNow);
  const [handoff, setHandoff] = useState<TypingBubbleHandoff | null>(null);
  if (
    typingFrame.sessionId !== typingFrameNow.sessionId ||
    typingFrame.live !== typingFrameNow.live
  ) {
    setTypingFrame(typingFrameNow);
    const kind = typingBubbleHandoff(typingFrame, {
      sessionId: activeSessionId,
      live: roundLive,
      question: Boolean(pendingAskUser),
      settled: roundSettled,
      silent: silentReport,
    });
    if (kind) {
      setHandoff({
        tick: (handoff?.tick ?? 0) + 1,
        kind,
        messageId: kind === "reply" ? replyId : null,
      });
    }
  }

  // Conversation scroll behavior — sticky-bottom follow, the
  // scroll-to-bottom button, session-switch snap, stick-to-user-message,
  // and ⌥↑/↓ jump — lives in its own hook so this
  // component stays a flat render tree. See useStickyScroll.
  const {
    scrollContainerRef,
    atBottom,
    setAtBottom,
    isScrollingToBottom,
    onClickScrollToBottom,
  } = useStickyScroll({
    activeSessionId,
    userSubmitTick,
    streamingContent: markdownPartial,
    turnsLength: turns.length,
    pendingAskUser,
    restoring,
    stickBottom: isMainChat,
    landingTick: handoff?.tick ?? 0,
  });
  // The typing bubble's place, and the hand-off on the page.
  const typingBubbleRef = useTypingBubbleHandoff({
    enabled: isMainChat,
    live: typingFrameNow.live,
    scrollContainerRef,
    handoff,
  });
  // Earlier pages of the conversation: read near the top, prepended
  // without moving what is on screen. See useEarlierTurns.
  useEarlierTurns({
    sessionId: activeSessionId,
    scrollContainerRef,
    turnsLength: turns.length,
    prependedTurns,
  });
  // A deleted message leaves (and one put back returns) without moving
  // what is on screen.
  useRemovedTurnsAnchor({
    sessionId: activeSessionId,
    scrollContainerRef,
  });

  // Unread-final-answer tracking for the scroll-to-bottom button's
  // static dot. Edge-triggered, not `!isRunning`: the dot means "a
  // finished answer landed below while you were away", so it sets
  // only on the running→idle transition while the user is scrolled
  // up. A user who watched the answer arrive at the bottom (or who
  // scrolls up *after* reading it) never sees the badge — otherwise
  // it would mark read content as unread and lose all meaning.
  // Cleared the moment the user is back at the bottom; reset on
  // session switch (the new session snaps to bottom anyway, but the
  // async SQLite restore makes the explicit reset the safe order).
  // Render-phase previous-value comparison (the react.dev "storing
  // information from previous renders" pattern) — the set-state-in-
  // effect lint rule bans the useEffect version, and this state is
  // derived purely from values the component already renders with.
  const [hasUnseenFinal, setHasUnseenFinal] = useState(false);
  const [prevRunning, setPrevRunning] = useState(isRunning);
  const [prevSessionId, setPrevSessionId] = useState(activeSessionId);
  if (prevSessionId !== activeSessionId) {
    setPrevSessionId(activeSessionId);
    setPrevRunning(isRunning);
    setHasUnseenFinal(false);
  } else if (prevRunning !== isRunning) {
    setPrevRunning(isRunning);
    // A report round that said nothing landed nothing to read.
    if (prevRunning && !atBottom && !silentReport) setHasUnseenFinal(true);
  } else if (hasUnseenFinal && atBottom) {
    setHasUnseenFinal(false);
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-app"
      style={conversationTypographyStyle(conversationFontSize)}
    >
      {/* Scrollable conversation column. Width follows the TopBar
          toggle: 760px (typography sweet spot) by default, 1200px
          in wide mode. Bottom stack matches — see MainViewProps doc
          for the lockstep rationale.

          Wrapped in `relative min-h-0 flex-1` so the UserQuestionRail
          (sibling below) can sit at the right edge of the visible
          conversation area without scrolling with content. The inner
          scrollContainerRef takes the flex extent via `absolute
          inset-0` — same scroll behavior as before; the wrapper just
          gives the rail a fixed-height parent to position against. */}
      {/* The conversation area: with the composer focused, pressing a
          button in it (or the scroller's blank backdrop) keeps the
          caret in the composer (useComposerFocus, ticket 03). */}
      <div data-conversation-area="" className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          data-conversation-backdrop=""
          className={cn(
            "scrollbar-stable absolute inset-0 overflow-y-auto px-8 py-6",
            // The assistant's 贴底: a short conversation stacks up from
            // the composer — the column is pushed down by its auto top
            // margin and keeps its own block flow, so the rows' margins
            // collapse as before.
            isMainChat && "flex flex-col",
            // Beside the question rail, the user's bubble keeps off the
            // rail when the column fills the area (MessageUser
            // RAIL_CLEARANCE): it reads this box's content width as
            // `100cqw` and the column's cap. Only where the rail is.
            !isMainChat &&
              cn(
                "@container/conversation",
                conversationWidth === "wide"
                  ? "[--conversation-column:1200px]"
                  : "[--conversation-column:760px]",
              ),
          )}
        >
          <div
            className={cn(
              "mx-auto",
              conversationWidth === "wide" ? "max-w-[1200px]" : "max-w-[760px]",
              isMainChat && "mt-auto w-full",
              // The main chat's bubbles set their text a step tighter
              // than the workbench's prose (telegram-details ruling 8):
              // the leading and the paragraph gap, at every tier.
              isMainChat && ASSISTANT_BUBBLE_TEXT_CLASS,
            )}
            style={
              isMainChat
                ? assistantBubbleTextStyle(conversationFontSize)
                : undefined
            }
          >
            {restoring && turns.length === 0 ? (
              <ConversationSkeleton />
            ) : (
              <Conversation
                // Keyed per session so fold state (keep-expanded
                // pointer + manual toggles) resets on switch — a
                // reopened session starts with every settled run
                // folded (conversation-run-fold PRD 定案 2).
                key={activeSessionId ?? "conversation"}
                turns={shown.turns}
                keyBase={prependedTurns}
                removedOrdinals={shown.removedOrdinals}
                previousUserCreatedAt={previousUserCreatedAt}
                askUserPending={Boolean(pendingAskUser)}
                agentRunning={isRunning}
                renderAfterAnswer={
                  deliveredFiles.size > 0 ||
                  subtaskDispatches.size > 0 ||
                  todos.size > 0 ||
                  reminders.size > 0
                    ? (messageId) => {
                        const files = deliveredFiles.get(messageId);
                        const dispatches = subtaskDispatches.get(messageId);
                        const noted = todos.get(messageId);
                        const tasks = reminders.get(messageId);
                        if (!files && !dispatches && !noted && !tasks) {
                          return null;
                        }
                        // `afterSubtasks`: under any cards above, 8px.
                        return (
                          <>
                            {files && <FileCards paths={files} />}
                            {dispatches && (
                              <SubtaskCards
                                dispatches={dispatches}
                                afterFiles={!!files}
                              />
                            )}
                            {noted && (
                              <TodoCards
                                items={noted}
                                afterSubtasks={!!files || !!dispatches}
                              />
                            )}
                            {tasks && (
                              <ReminderCards
                                tasks={tasks}
                                afterSubtasks={
                                  !!files || !!dispatches || !!noted
                                }
                              />
                            )}
                          </>
                        );
                      }
                    : undefined
                }
                assistant={isMainChat}
                messageMenu={
                  isMainChat && activeSessionId
                    ? {
                        // A send on its way counts: the page marks the
                        // run started when it sends.
                        running: isRunning,
                        asking: Boolean(pendingAskUser),
                        hasSubtasks: (answerId) =>
                          subtaskDispatches.has(answerId),
                        onQuote: (text) => composerRef.current?.quote(text),
                        onDelete: ({ messageId, rowIds }) =>
                          useMessageDeleteStore
                            .getState()
                            .stage(activeSessionId, messageId, rowIds),
                      }
                    : undefined
                }
              />
            )}
            {/* In-flight placeholder. User sent a message; the bridge
              is dispatching but turn_end hasn't come back yet (LLM
              TTFT can be several seconds). Without this the
              conversation looks frozen. Hidden once streaming content
              has begun (the partial render is itself the live
              signal).

              Renders as TurnMarker in thinking mode — same upright
              12px structural register as the settled marker, just
              with a three-dot working indicator in place of the
              summary.
              Used to live inside a ThinkingSummary callout (bg-surface
              + bar) but that chrome was sized for multi-paragraph
              thinking content, not a one-liner "still working"
              line. Sharing visual register with TurnMarker collapses
              the before/after into one per-step rhythm. */}
            {/* The assistant: the typing bubble instead of the in-flight
                row, its reasoning and the streaming prose — gone once
                the round has its answer or asks, its bubble growing out
                of it (useTypingBubbleHandoff). */}
            {typingShown && (
              <TypingBubble ref={typingBubbleRef} progress={typingProgress} />
            )}
            {isRunning && !isMainChat && (
              // The elapsed clock inside TurnMarker resets whenever
              // `index` changes — step 1 took 30s; step 2's clock
              // starts at 0 again — including the first `turn_start`
              // landing a few hundred ms after the synchronously-set
              // `agentRunning` mounted the row with no index yet.
              //
              // One slot for both the pre-stream placeholder and the
              // streaming header (they used to be two sibling
              // conditional slots, which made React rebuild the marker
              // when streaming began — the step clock visibly snapped
              // back to zero mid-step, 2026-08-12). Now the marker
              // instance survives the placeholder→streaming swap and
              // the clock reads continuously as the step's total time.
              <div>
                {/* The in-flight marker sits in the live run's process
                    region (inset + rail) like every settled step; the
                    streaming partial below it is the answer taking
                    shape and stays full width. */}
                <StepRegion railFrom={inRunRail ? "header" : "content"}>
                  {/* One instance for the whole run (2026-09-16): the
                      step clock resets on `index` inside TurnMarker
                      instead of remounting per step, so the row
                      stays put — shimmer uninterrupted, the counter
                      snapping back to 0.0 — while the settled step
                      grows in above it. The former per-step `key`
                      remount read as a blink beside that sweep. */}
                  <TurnMarker
                    index={currentTurnIndex ?? undefined}
                    thinking
                    liveStatus={liveStepStatus}
                  />
                  {/* Live reasoning (2026-09-23): process material, so
                      it sits inside the step's region, in the settled
                      DetailPanel's column and register, above the
                      answer partial — not as answer prose. Hugs the
                      row the way the DetailPanel does (no gap); the
                      answer's own block-gap margin spaces what follows.
                      Keyed by session: the in-flight row is not, so a
                      switch mid-reasoning would otherwise sweep the
                      previous session's reasoning closed in this one. */}
                  <ThinkingPreview
                    key={activeSessionId}
                    text={liveThinking.text}
                    visible={thinkingPreviewVisible}
                  />
                </StepRegion>
                {/* In-flight streaming partial (DESIGN.md §4.3
                  streaming generation). Renders accumulated
                  display_queue chunks from turn_progress IPC events.
                  Replaced by the canonical AgentTurn the moment
                  turn_end fires (store clears inFlightContent in
                  appendAgentTurn). `streaming-prose` (globals.css) is
                  the display-only presentation layer: an inline caret
                  rides the last block's text via ::after — liveness at
                  the point the eye actually follows during the gaps
                  between GA's ~50-char delta pushes — and new blocks
                  soft-fade in (0.4 → 1). Settled turns render without
                  the class, so none of it survives the swap.
                  `markdownPartial` is the typewriter + parse-throttled
                  view of `visiblePartial`. The condition gates on
                  visiblePartial (so the placeholder→partial swap
                  happens the instant GA's first chunk arrives, not
                  a frame later); the actual render uses markdownPartial
                  so content reveals smoothly without re-parsing the
                  whole document on every rAF tick.

                  One paragraph gap below the thinking row
                  (2026-09-18): the marker has no bottom margin by the
                  step rhythm (its tool rows must hug it), but this is
                  prose, not a tool row, and it hugged the 12px status
                  line at zero gap while sitting full width under an
                  indented marker. A block-gap margin reads as "the
                  next paragraph after the status line" and stays
                  neutral about what the partial settles into — a
                  narration (6px, indented), the step marker's own
                  line when the narration is the step's only sentence
                  (echo steps, 2026-09-23), or the final answer
                  (StrongHr). Not the answer's rule: the partial may
                  still turn out to be a step's narration, and a
                  conclusion line on every step would lie. */}
                {visiblePartial && (
                  <MarkdownView
                    source={markdownPartial}
                    variant="agent"
                    className="streaming-prose mt-(--conversation-block-gap)"
                    streaming
                  />
                )}
              </div>
            )}

            {/* GA-initiated question awaiting reply. Always at the
              conversation tail — by the time ask_user fires, the
              agent has EXITED its run loop so `isRunning` is false
              and the placeholder / streaming partial above won't
              render. Submitting (chip OR Composer text) clears this
              via the send's echo (store.appendUserTurn). */}
            {pendingAskUser && (
              <AskUserBubble
                pending={pendingAskUser}
                onPickCandidate={(text) => onSubmit?.(text, [])}
                onFillCandidate={(text) =>
                  composerRef.current?.prefillText(text)
                }
                bubble={isMainChat}
                disabled={questionLocked}
              >
                {questionLocked && (
                  // The reason under the controls it turned off, not
                  // dimmed (the rule of a greyed menu item's reason
                  // line, conversation.md 「消息菜单」); the way back is
                  // a small ghost button, as the card's 「打开」.
                  <div
                    data-role="question-with-galley"
                    className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-[1.45] text-ink-soft"
                  >
                    <span>
                      {questionHolder === "galleyAsked"
                        ? copy.subtask.withGalleyAsked
                        : copy.subtask.withGalleyWorking}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openMainChat()}
                    >
                      {copy.assistant.backTo}
                    </Button>
                  </div>
                )}
              </AskUserBubble>
            )}
            {/* The run paused at GA's step cap; one reply continues it. */}
            {showStepLimitTail && <StepLimitTail />}
          </div>
        </div>

        {/* Right-edge question index — one dot per user-msg, click to
            jump. Sibling of the scroll container (not inside it) so
            it doesn't scroll with content. Shows from the first
            user-msg (jump-back anchor role; see UserQuestionRail).
            Not in the main chat (main chat PRD ruling 60): the dots sit
            at their share of the loaded content, so in a conversation
            with no end most of them fold into capsules, and loading an
            earlier page moves every dot and renumbers it. ⌥↑ / ⌥↓ still
            step through its questions. */}
        {!isMainChat && (
          <UserQuestionRail
            turns={turns}
            scrollContainerRef={scrollContainerRef}
            tailStatus={
              pendingAskUser ? "waiting" : isRunning ? "running" : null
            }
            onJump={() => setAtBottom(false)}
          />
        )}
        <SelectionCopyToolbar
          scrollContainerRef={scrollContainerRef}
          onQuote={(text) => composerRef.current?.quote(text)}
        />
        {isRunning && currentRunStartedAtMs != null && !isMainChat && (
          <div className="pointer-events-none absolute inset-x-8 bottom-4 z-10">
            <div
              className={cn(
                "mx-auto flex justify-end",
                conversationWidth === "wide"
                  ? "max-w-[1200px]"
                  : "max-w-[760px]",
              )}
            >
              <RunElapsedHud
                startedAtMs={currentRunStartedAtMs}
                baseMs={runElapsedBaseMs}
              />
            </div>
          </div>
        )}

        {/* Scroll-to-bottom floating button (DESIGN.md §4.3 streaming
            generation). Visible only when the user has scrolled away
            from the bottom. Centered above the bottom stack so the
            affordance sits on the scroll axis instead of competing
            with the reading column's right edge.
            Two-state signal (globals.css scroll-live-ring /
            scroll-unread-pop): while the agent is running a pulse
            ring loops on the circumference — content is landing
            below, click re-attaches to the tail. When the run
            finishes while the user is scrolled up, the ring gives
            way to a static unread dot — a finished answer waits
            below, click jumps to it. The arrow itself never changes:
            it always answers "where does this go". */}
        {!atBottom && !isScrollingToBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
            <button
              type="button"
              onClick={onClickScrollToBottom}
              aria-label={copy.conversation.scrollLatest}
              className={cn(
                "group pointer-events-auto relative inline-flex size-8 items-center justify-center rounded-full",
                "border border-line bg-elevated/92 text-ink-soft shadow-[var(--shadow-float)] backdrop-blur-md",
                "transition-none active:transition-[translate,scale,box-shadow] active:duration-(--motion-press) active:ease-firm",
                "hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated hover:text-ink hover:shadow-[var(--shadow-float-hover)]",
                "active:translate-y-0 active:scale-95",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
              )}
            >
              {/* Running: pulse ring. Kept mounted so the loop's
                  current opacity fades out over 200ms on run end
                  instead of popping off. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-full border border-brand",
                  "transition-opacity duration-200",
                  isRunning ? "scroll-live-ring" : "opacity-0",
                )}
              />
              {/* Finished while scrolled up: static unread dot on the
                  circle edge at 45°; the elevated ring lifts it off
                  the button border. Mount-conditional so the entrance
                  pop replays each time the badge earns its place. */}
              {hasUnseenFinal && !isRunning && (
                <span
                  aria-hidden
                  className="scroll-unread-pop absolute top-px right-px size-[7px] rounded-full bg-brand-strong ring-2 ring-elevated"
                />
              )}
              <ArrowDown size={14} weight="thin" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom stack: composer + hint. Matches the conversation
          column width in lockstep — see MainViewProps `conversationWidth`
          doc for why we don't keep this narrower. The workbench's hint
          row sits 16px off the window's bottom edge. The main chat's
          one-line composer has no hint row under it and sits 24px off
          the edge (ruling 72): with the hint row gone, 16 sat it too
          low; 24 is half its 48px height, its own corner radius. */}
      <div className={cn("bg-app px-8", isMainChat ? "pb-6" : "pb-4")}>
        <div
          className={cn(
            "mx-auto",
            conversationWidth === "wide" ? "max-w-[1200px]" : "max-w-[760px]",
          )}
        >
          <Composer
            ref={composerRef}
            key={activeSessionId ?? "main-composer"}
            // Draft parks per session (survives the keyed remount above);
            // the keyed remount also lands the caret in the textarea on
            // every session entry — appearing composers take focus by
            // contract (useComposerFocus).
            draftKey={activeSessionId ?? "main-composer"}
            llmDisplayName={llmDisplayName}
            placeholder={
              copy.composer[
                composerRegisterCopyKey(
                  resolveComposerRegister({
                    isRunning,
                    pendingAskUser: Boolean(pendingAskUser),
                    askUserHasCandidates:
                      (pendingAskUser?.candidates.length ?? 0) > 0,
                    mainChat: isMainChat,
                    questionWithGalley: questionLocked,
                  }),
                )
              ]
            }
            ghostSuggestion={ghostSuggestion}
            onSubmit={onSubmit}
            stopMode={isRunning}
            isStopping={isStopping}
            onStop={onStop}
            submitAckTick={userSubmitTick}
            // Off while the subtask's question is with the assistant
            // (ruling 102): anything sent here would be its answer.
            disabled={questionLocked}
            llms={llms}
            onSelectLLM={onSelectLLM}
            llmConfigHint={llmConfigHint}
            onConfigureModels={onConfigureModels}
            requiresModelConfig={requiresModelConfig}
            onOpenLLMSwitcher={onOpenLLMSwitcher}
            reasoningEffort={reasoningEffort}
            // One line in every session (rulings 72, 74); the empty
            // state keeps the card. The main chat has no hint row
            // (ruling 71, item 3); the workbench's stays, the live legend
            // of drop / Enter / queue (ruling 74, item 2).
            oneLine
            showFooterHint={!isMainChat}
            imagesEnabled={imagesEnabled}
            onImageBlocked={onImageBlocked}
            onTextDropBlocked={onTextDropBlocked}
          />
        </div>
      </div>
    </div>
  );
}

function sendPhaseToStatus(
  phase: SendPhase,
  copy: ReturnType<typeof useCopy>,
): string {
  switch (phase) {
    case "saving":
      return copy.conversation.sendReceived;
    case "starting":
    case "restoring":
      return copy.conversation.sendGettingReady;
    case "waiting_agent":
    case "sent":
      return copy.conversation.sendWorking;
  }
}

const LIVE_STEP_STATUS_MAX_CHARS = 46;

function compactLiveStepStatus(text?: string): string | undefined {
  if (!text) return undefined;
  const normalized = text
    .replace(/`{3,}[\s\S]*?`{3,}/g, " ")
    .replace(/[|*_`>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  const chars = Array.from(normalized);
  if (chars.length <= LIVE_STEP_STATUS_MAX_CHARS) return normalized;
  return `${chars
    .slice(0, LIVE_STEP_STATUS_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}
