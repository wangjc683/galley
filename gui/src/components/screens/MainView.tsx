import { ArrowDown } from "@phosphor-icons/react";
import { useMemo } from "react";

import { ApprovalDock } from "@/components/conversation/ApprovalDock";
import { AskUserBubble } from "@/components/conversation/AskUserBubble";
import {
  Composer,
  type ComposerLLMOption,
  type ImageBlockReason,
} from "@/components/conversation/Composer";
import {
  Conversation,
  TurnMarker,
} from "@/components/conversation/Conversation";
import { GoalRunningTail } from "@/components/conversation/GoalRunMarkers";
import { StreamingCursor } from "@/components/conversation/LiveIndicators";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { SelectionCopyToolbar } from "@/components/conversation/SelectionCopyToolbar";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import { UserQuestionRail } from "@/components/conversation/UserQuestionRail";
import { useStickyScroll } from "@/hooks/useStickyScroll";
import { useTypewriter } from "@/hooks/useTypewriter";
import { useMarkdownStream } from "@/hooks/useMarkdownStream";
import {
  composerRegisterCopyKey,
  resolveComposerRegister,
} from "@/lib/composer-register";
import {
  conversationTypographyStyle,
  type ConversationFontSize,
} from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import {
  cleanPartialContent,
  extractPreamble,
} from "@/lib/ipc/ga-output-cleaning";
import { cn } from "@/lib/utils";
import { useMessagesStore } from "@/stores/messages";
import type {
  ConversationToolEvent,
  PendingApproval,
  PendingAskUser,
  PendingImageAttachment,
  SendPhase,
  Turn,
} from "@/types/conversation";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";
import type { ApprovalDecision } from "@/types/ipc";

export interface MainViewProps {
  turns: Turn[];
  llmDisplayName: string;
  pendingApprovals?: PendingApproval[];
  approvalDecisions?: Record<string, ApprovalDecision>;
  /** Name of the project the active session belongs to (if any).
   * Threaded through to ToolCallout → ApprovalForm so the "Always
   * allow in {projectName}" decision button can show context. */
  projectName?: string;
  /** Active session's id. MainView watches it to scroll to the bottom
   * of the new conversation when the user switches sessions. The
   * component doesn't read or display the id, just uses identity
   * change as the trigger. Undefined during pre-session screens. */
  activeSessionId?: string;
  onSubmit?: (
    text: string,
    attachments: PendingImageAttachment[],
  ) => boolean | void;
  onGoalSubmit?: (
    text: string,
    config: GoalLaunchConfig,
  ) => void | Promise<void>;
  onApprove?: (approvalId: string, decision: ApprovalDecision) => void;
  onStop?: () => void;
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
  // placeholder (Turn N · 思考中…) and into pending Approval Card
  // headers when the agent has a request mid-turn. `null` during
  // quiet states.
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
  /** Active Goal for this session's Project context, if any. */
  goal?: GoalBrief;
  /**
   * All goals whose master session is this one (any status), powering
   * the in-thread Goal commission / terminal markers. Forwarded to
   * Conversation.
   */
  sessionGoals?: GoalBrief[];
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
   * (ApprovalDock + Composer + hint) follow this mode in lockstep.
   * Earlier iterations kept the bottom stack narrow on the
   * "input doesn't need to be wide" theory; this turned out to be
   * wrong: (a) the EmptyState toggle then had no visible effect
   * since EmptyState only contains a Composer, and (b) the Dock and
   * Composer at different widths produced visual misalignment in
   * MainView. Single width keeps the affordance consistent and
   * predictable across all screens.
   */
  conversationWidth?: "compact" | "wide";
  conversationFontSize?: ConversationFontSize;
  imagesEnabled?: boolean;
  onImageBlocked?: (reason: ImageBlockReason) => void;
}

/**
 * Main view — the in-session screen. Per DESIGN.md §3 layout floor +
 * §4.3 conversation document + §4.6 approval dock + §4.4 composer.
 *
 * Three vertical regions, all aligned to a 760px reading column:
 *
 *   Conversation (scrollable, takes the bleeding flex-1 space)
 *   Approval Dock (sticky-ish, only renders when pending)
 *   Composer + keyboard hint row
 *
 * Title / runtime / inspector toggle live in the AppShell-level Top
 * Bar; nothing chrome-y belongs here.
 */
export function MainView({
  turns,
  llmDisplayName,
  pendingApprovals = [],
  approvalDecisions,
  projectName,
  activeSessionId,
  onSubmit,
  onGoalSubmit,
  onApprove,
  onStop,
  isRunning = false,
  isStopping = false,
  llms,
  onSelectLLM,
  llmConfigHint,
  onConfigureModels,
  requiresModelConfig = false,
  onOpenLLMSwitcher,
  goal,
  sessionGoals,
  pendingAskUser,
  conversationWidth = "compact",
  conversationFontSize = "standard",
  imagesEnabled = true,
  onImageBlocked,
}: MainViewProps) {
  const copy = useCopy();
  const stillWaiting = pendingApprovals.length > 0;
  // Ambient liveness for a running Goal master thread (see
  // GoalRunningTail). Only when the master isn't itself mid-turn and
  // nothing else already signals activity, so we never double up.
  const runningGoal = sessionGoals?.find(
    (g) => g.status === "running" || g.status === "wrapping",
  );
  const goalRunningTailVisible =
    !!runningGoal && !isRunning && !stillWaiting && !pendingAskUser;

  // Streaming state, subscribed locally so token churn stays inside
  // this subtree instead of re-rendering the whole app. These were
  // previously passed as props from App; see MainViewProps docs above.
  const inFlightContent = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.inFlightContent ?? "") : "",
  );
  const sendPhase = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.sendPhase ?? null) : null,
  );
  const currentTurnIndex = useMessagesStore((s) =>
    activeSessionId ? (s.byId[activeSessionId]?.currentTurnIndex ?? null) : null,
  );
  const userSubmitTick = useMessagesStore((s) => s.userSubmitTick);

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
  const sendPhaseStatus = sendPhase
    ? sendPhaseToStatus(sendPhase, copy)
    : undefined;
  const liveStepStatus = visiblePartial
    ? copy.conversation.answering
    : (sendPhaseStatus ?? compactLiveStepStatus(livePreamble));
  // Fake-typewriter pass to smooth over GA's ~50-char chunked
  // delta pushes. See useTypewriter docs for the mitigation
  // rationale. If the GA-side throttle is eventually reduced enough,
  // this hook becomes a no-op (reveal already keeps pace with
  // arrivals) and can be removed without behavior change.
  const typedPartial = useTypewriter(visiblePartial);
  // Markdown-parse throttle: `useTypewriter` reveals chars at ~60 Hz
  // and each revealed value would trigger a full `react-markdown`
  // re-parse of the growing buffer (O(n²) across a turn). This holds
  // the typewriter cadence for perceived smoothness but only commits
  // a value to the markdown renderer at ~20 Hz, cutting parse work
  // by roughly 3×. Final + boundary values still flush promptly.
  const markdownPartial = useMarkdownStream(typedPartial);

  // Conversation scroll behavior — sticky-bottom follow, the
  // scroll-to-bottom button, session-switch snap, stick-to-user-message,
  // ⌥↑/↓ jump, and advance-to-approval — lives in its own hook so this
  // component stays a flat render tree. See useStickyScroll.
  const {
    scrollContainerRef,
    atBottom,
    setAtBottom,
    isScrollingToBottom,
    onClickScrollToBottom,
    onClickAdvanceApproval,
    registerPendingApprovalRef,
  } = useStickyScroll({
    activeSessionId,
    userSubmitTick,
    streamingContent: markdownPartial,
    turnsLength: turns.length,
    pendingApprovalsLength: pendingApprovals.length,
    pendingAskUser,
  });

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
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-y-auto px-8 py-6"
        >
          <div
            className={cn(
              "mx-auto",
              conversationWidth === "wide" ? "max-w-[1200px]" : "max-w-[760px]",
            )}
          >
            <Conversation
              turns={turns}
              approvalDecisions={approvalDecisions}
              onApprove={onApprove}
              projectName={projectName}
              goals={sessionGoals}
            />
            {/* In-flight pending approvals — rendered after the
              completed turns. The agent has emitted tool_call_pending
              but the turn hasn't ended yet, so these tools aren't in
              `turns[].tools` (turn_end is what folds them in). We
              render them inline as ToolCallouts so the user sees the
              full Approval Card (diff / args / buttons), not just an
              "等待审批中" placeholder. Once the user decides, the
              store removes the pending entry; the eventual turn_end
              brings the same tool back as part of a finalized turn. */}
            {stillWaiting && (
              // No wrapper margin — TurnMarker provides its own
              // mt-7, and ToolCallout's my-3 spaces successive cards.
              // space-y-2 stays for the multi-pending case.
              <div className="space-y-2">
                {currentTurnIndex != null && (
                  <TurnMarker index={currentTurnIndex} />
                )}
                {pendingApprovals.map((p) => (
                  <div
                    key={p.approvalId}
                    ref={registerPendingApprovalRef(p.approvalId)}
                    data-pending-approval-id={p.approvalId}
                    tabIndex={-1}
                    className="focus:outline-none"
                  >
                    <ToolCallout
                      tool={pendingToToolEvent(p)}
                      onApprove={(decision) =>
                        onApprove?.(p.approvalId, decision)
                      }
                      projectName={projectName}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* In-flight placeholder. User sent a message; the bridge
              is dispatching but turn_end hasn't come back yet (LLM
              TTFT can be several seconds). Without this the
              conversation looks frozen. Hidden once an Approval Card
              shows up (already covers "agent waiting on you") OR
              once streaming content has begun (the partial render
              is itself the live signal).

              Renders as TurnMarker in thinking mode — same upright
              12px structural register as the settled marker, just
              with a three-dot working indicator in place of the
              summary.
              Used to live inside a ThinkingSummary callout (bg-surface
              + bar) but that chrome was sized for multi-paragraph
              thinking content, not a one-liner "still working"
              line. Sharing visual register with TurnMarker collapses
              the before/after into one per-step rhythm. */}
            {isRunning && !stillWaiting && !visiblePartial && (
              // `key` ties the TurnMarker instance to the current step
              // (when known) so the elapsed clock inside resets when
              // the step changes — step 1 took 30s; step 2's clock
              // starts at 0 again. Falls back to "pending" while we
              // wait for the bridge's first `turn_start` to land
              // (synchronously-set `agentRunning` outruns it by a
              // few hundred ms); when `currentTurnIndex` arrives the
              // key flips, the placeholder remounts, and the clock
              // resets there too — which is fine since the user just
              // saw "思考中" for that brief window.
              <div>
                <TurnMarker
                  key={currentTurnIndex ?? "pending"}
                  index={currentTurnIndex ?? undefined}
                  thinking
                  liveStatus={liveStepStatus}
                />
              </div>
            )}

            {/* In-flight streaming partial (DESIGN.md §4.3 streaming
              generation). Renders accumulated display_queue chunks
              from turn_progress IPC events. Replaced by the canonical
              AgentTurn the moment turn_end fires (store clears
              inFlightContent in appendAgentTurn).
              StreamingCursor below the markdown gives liveness
              feedback during the gaps between GA's ~50-char delta
              pushes — without it the partial reads as "stalled"
              between chunks. A deeper fix needs GA-side streaming
              granularity changes; this is the UI-side mitigation. */}
            {isRunning && !stillWaiting && visiblePartial && (
              <div>
                <TurnMarker
                  key={currentTurnIndex ?? "answering"}
                  index={currentTurnIndex ?? undefined}
                  thinking
                  liveStatus={liveStepStatus}
                />
                {/* `markdownPartial` is the typewriter + parse-throttled
                  view of `visiblePartial`. The condition above gates on
                  visiblePartial (so the placeholder→partial swap
                  happens the instant GA's first chunk arrives, not
                  a frame later); the actual render uses markdownPartial
                  so content reveals smoothly without re-parsing the
                  whole document on every rAF tick. */}
                <MarkdownView source={markdownPartial} variant="agent" />
                <div className="mt-1 leading-none">
                  <StreamingCursor />
                </div>
              </div>
            )}

            {/* GA-initiated question awaiting reply. Always at the
              conversation tail — by the time ask_user fires, the
              agent has EXITED its run loop so `isRunning` is false
              and the placeholder / streaming partial above won't
              render. Submitting (chip OR Composer text) clears this
              via store.appendUserTurn. */}
            {pendingAskUser && (
              <AskUserBubble
                pending={pendingAskUser}
                onPickCandidate={(text) => onSubmit?.(text, [])}
              />
            )}
            {/* Ambient liveness for a running Goal master thread: the
                master itself isn't mid-turn, but its goal is still
                progressing in worker sessions. Shown only when nothing
                else already signals activity. */}
            {goalRunningTailVisible && <GoalRunningTail />}
          </div>
        </div>

        {/* Right-edge question index — one dot per user-msg, click to
            jump. Sibling of the scroll container (not inside it) so
            it doesn't scroll with content. Hidden under 3 user-msgs. */}
        <UserQuestionRail
          turns={turns}
          scrollContainerRef={scrollContainerRef}
          tailStatus={
            stillWaiting || pendingAskUser
              ? "waiting"
              : isRunning
                ? "running"
                : null
          }
          onJump={() => setAtBottom(false)}
        />
        <SelectionCopyToolbar scrollContainerRef={scrollContainerRef} />

        {/* Scroll-to-bottom floating button (DESIGN.md §4.3 streaming
            generation). Visible only when the user has scrolled away
            from the bottom. Centered above the bottom stack so the
            affordance sits on the scroll axis instead of competing
            with the reading column's right edge. */}
        {!atBottom && !isScrollingToBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
            <button
              type="button"
              onClick={onClickScrollToBottom}
              aria-label={copy.conversation.scrollLatest}
              className={cn(
                "group pointer-events-auto inline-flex size-8 items-center justify-center rounded-full",
                "border border-line bg-elevated/92 text-ink-soft shadow-[var(--shadow-float)] backdrop-blur-md",
                "transition-all duration-150 ease-out",
                "hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated hover:text-ink hover:shadow-[var(--shadow-float-hover)]",
                "active:translate-y-0 active:scale-95",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
              )}
            >
              <ArrowDown size={14} weight="thin" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom stack: dock + composer + hint. Matches the conversation
          column width in lockstep — see MainViewProps `conversationWidth`
          doc for why we don't keep this narrower. */}
      <div className="bg-app px-8 pb-4">
        <div
          className={cn(
            "mx-auto",
            conversationWidth === "wide" ? "max-w-[1200px]" : "max-w-[760px]",
          )}
        >
          <ApprovalDock
            pending={pendingApprovals}
            onAdvance={onClickAdvanceApproval}
          />

          <Composer
            key={activeSessionId ?? "main-composer"}
            llmDisplayName={llmDisplayName}
            placeholder={
              copy.composer[
                composerRegisterCopyKey(
                  resolveComposerRegister({
                    isRunning,
                    pendingAskUser: Boolean(pendingAskUser),
                  }),
                )
              ]
            }
            onSubmit={onSubmit}
            onGoalSubmit={onGoalSubmit}
            stopMode={isRunning}
            isStopping={isStopping}
            onStop={onStop}
            submitAckTick={userSubmitTick}
            disabled={false}
            llms={llms}
            onSelectLLM={onSelectLLM}
            llmConfigHint={llmConfigHint}
            onConfigureModels={onConfigureModels}
            requiresModelConfig={requiresModelConfig}
            onOpenLLMSwitcher={onOpenLLMSwitcher}
            goal={goal}
            showFooterHint
            imagesEnabled={imagesEnabled}
            onImageBlocked={onImageBlocked}
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

/**
 * Synthesize a ConversationToolEvent from a PendingApproval so
 * ToolCallout (which expects the full event shape) can render the
 * in-flight Approval Card. Status is hard-coded "waiting_approval"
 * — that's the only state pendings ever appear in. `args` is what
 * lets the tool-specific renderers (PatchView for file_patch,
 * command preview for code_run) light up; without it ToolCallout
 * falls back to the raw mono args block.
 */
function pendingToToolEvent(p: PendingApproval): ConversationToolEvent {
  return {
    id: p.approvalId,
    name: p.toolName,
    status: "waiting_approval",
    args: p.args,
    riskLevel: p.riskLevel,
    approvalId: p.approvalId,
  };
}
