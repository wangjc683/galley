import { CaretDown } from "@phosphor-icons/react";
import { Fragment, useEffect, useState } from "react";

import { LiveDots } from "@/components/conversation/LiveIndicators";
import { AnsweredAskUser } from "@/components/conversation/AskUserBubble";
import {
  GoalCommissionMarker,
  GoalTerminalMarker,
} from "@/components/conversation/GoalRunMarkers";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import {
  MessageAgent,
  MessageAgentNarration,
} from "@/components/conversation/MessageAgent";
import { MessageUser } from "@/components/conversation/MessageUser";
import { SystemMessageBubble } from "@/components/conversation/SystemMessageBubble";
import { ToolCallout } from "@/components/conversation/ToolCallout";
import { annotateGoalThread } from "@/lib/goal-thread";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AgentTurn, Turn } from "@/types/conversation";
import type { GoalBrief } from "@/types/goal";
import type { ApprovalDecision } from "@/types/ipc";

const THINKING_ELAPSED_VISIBLE_AFTER_SEC = 3;
const THINKING_STILL_RUNNING_VISIBLE_AFTER_SEC = 60;

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
}: ConversationProps) {
  const items = annotateGoalThread(turns, goals ?? []);
  return (
    <div>
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.kind === "commission" ? (
            <GoalCommissionMarker goal={item.goal} content={item.content} />
          ) : item.kind === "terminal" ? (
            <GoalTerminalMarker goal={item.goal} />
          ) : item.turn.role === "user" ? (
            <MessageUser
              content={item.turn.content}
              attachments={item.turn.attachments}
              origin={item.turn.origin}
              createdAt={item.turn.createdAt}
            />
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
            />
          )}
          {/* No divider between turns — the TurnMarker on each
              AgentTurn carries the chapter-break feel via its own
              top-margin and visual weight. Earlier iterations had
              a SoftHr here (my-9 → my-6 → my-5); even at 40px the
              hr-plus-marker stack felt like wasted vertical space.
              Removed in favour of marker-only separation. */}
        </Fragment>
      ))}
    </div>
  );
}

function AgentTurnView({
  turn,
  approvalDecisions,
  onApprove,
  projectName,
}: {
  turn: AgentTurn;
  approvalDecisions?: Record<string, ApprovalDecision>;
  onApprove?: (approvalId: string, decision: ApprovalDecision) => void;
  projectName?: string;
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
  const visibleTools = turn.tools.filter((t) => t.name !== "ask_user");
  // The ask_user question otherwise has no visible home once the live
  // bubble clears: these turns usually carry no `finalAnswer` (the LLM
  // emitted a pure tool_use block), so without surfacing the question
  // text from the filtered tool's args the user couldn't see what they
  // were asked after answering (or after restart). Rendered as a static
  // AnsweredAskUser echo below, in the same yellow register.
  const askUserQuestion = turn.tools.find((t) => t.name === "ask_user")
    ?.args?.question;
  const isFinalTurn = visibleTools.every((t) => t.name === "no_tool");
  const answerText =
    turn.finalAnswer !== null && turn.finalAnswer.trim() !== ""
      ? turn.finalAnswer
      : null;
  const narrationDuplicatesPreamble =
    !isFinalTurn &&
    normalizedInlineText(answerText) !== "" &&
    normalizedInlineText(answerText) === normalizedInlineText(turn.preamble);
  const detailPreamble = narrationDuplicatesPreamble
    ? undefined
    : turn.preamble;

  return (
    <div>
      {turn.turnIndex !== undefined && (
        <TurnMarker
          index={turn.turnIndex}
          summary={turn.summary}
          thinkingContent={turn.thinking}
          preamble={detailPreamble}
        />
      )}

      {visibleTools.map((tool) => (
        <ToolCallout
          key={tool.id}
          tool={tool}
          approvalDecision={
            tool.approvalId ? approvalDecisions?.[tool.approvalId] : undefined
          }
          onApprove={onApprove}
          projectName={projectName}
        />
      ))}

      {typeof askUserQuestion === "string" && (
        <AnsweredAskUser question={askUserQuestion} />
      )}

      {answerText &&
        (isFinalTurn ? (
          <>
            <StrongHr />
            <MessageAgent telemetry={turn.telemetry}>{answerText}</MessageAgent>
          </>
        ) : (
          <MessageAgentNarration>{answerText}</MessageAgentNarration>
        ))}
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
 *   - mt-6 (24px) gives turn-to-turn breathing room (the marker is
 *     now the only chapter-break signal between turns) without the
 *     visual noise of an actual rule. The Swiss marker (tabular
 *     index + hairline) is visually self-separating, so it needs
 *     less surrounding whitespace than a softer label would —
 *     structure does the separating, not a big gap.
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
   * status text plus a three-dot working indicator. An elapsed-seconds
   * counter joins after 3s: immediate readout feels mechanical, but
   * waiting longer makes a real model pause feel like a frozen UI. See
   * useElapsedSeconds for details.
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
  const elapsedSec = useElapsedSeconds(thinking);
  const elapsedLabel =
    thinking && elapsedSec >= THINKING_ELAPSED_VISIBLE_AFTER_SEC
      ? formatElapsedSeconds(elapsedSec, copy)
      : null;
  const hasDetail = !thinking && Boolean(thinkingContent || preamble);
  const [open, setOpen] = useState(false);

  const stepLabel = index != null ? copy.conversation.step(index) : null;
  const trailing = thinking ? (
    <ThinkingStatus
      status={liveStatus}
      elapsedLabel={elapsedLabel}
      showStillRunning={elapsedSec >= THINKING_STILL_RUNNING_VISIBLE_AFTER_SEC}
    />
  ) : summary ? (
    <span className="min-w-0 flex-1 truncate select-text text-ink-soft">
      {summary}
    </span>
  ) : null;

  return (
    <div>
      <div
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        className={cn(
          "mb-2.5 mt-6 flex min-w-0 items-center gap-2 [font-size:var(--conversation-step-size)] text-ink-soft",
          hasDetail &&
            "cursor-pointer transition-colors duration-150 hover:text-ink",
        )}
      >
        {stepLabel && (
          <span className="shrink-0 font-medium tabular-nums tracking-[0.01em] text-ink-soft">
            {stepLabel}
          </span>
        )}
        {stepLabel && trailing && (
          <span className="h-2.5 w-px shrink-0 bg-line-strong" aria-hidden />
        )}
        {trailing}
        {hasDetail && (
          <CaretDown
            size={11}
            weight="thin"
            className={cn(
              "ml-auto shrink-0 text-ink-muted transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        )}
      </div>
      {hasDetail && open && (
        <DetailPanel thinking={thinkingContent} preamble={preamble} />
      )}
    </div>
  );
}

/**
 * In-flight status for the step marker — replaces the previous
 * per-character opacity wave. Swiss register: upright text, a single
 * localized "working" affordance (three staggered dots), and the
 * elapsed counter in tabular figures so the digits don't jitter as
 * they tick. The ticking counter is itself the primary proof of
 * liveness; the dots cover the first seconds before it appears.
 */
function ThinkingStatus({
  status,
  elapsedLabel,
  showStillRunning,
}: {
  status?: string;
  elapsedLabel: string | null;
  showStillRunning: boolean;
}) {
  const copy = useCopy();
  // Strip trailing dots from either the live status or the fallback
  // copy ("思考中...") so they don't double up with LiveDots.
  const statusText = (status?.trim() || copy.conversation.thinking).replace(
    /[.\u2026]+$/,
    "",
  );
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="truncate">{statusText}</span>
      <LiveDots className="pb-px text-ink-muted" />
      {elapsedLabel && (
        <span className="shrink-0 tabular-nums text-ink-muted">
          {` · ${elapsedLabel}`}
          {showStillRunning && ` · ${copy.conversation.stillRunning}`}
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
    <div className="mb-3 animate-fade-in space-y-2">
      {thinking && <MarkdownView source={thinking} variant="thinking" />}
      {preamble && <MarkdownView source={preamble} variant="thinking" />}
    </div>
  );
}

/**
 * Tick once per second while `active` is true; reports total seconds
 * elapsed since the hook started ticking. Returns 0 when inactive.
 *
 * Reset semantics: a fresh component mount = clock at 0 (via the
 * initial state of `useState`). Callers that need the clock to
 * reset between logical "occurrences" (e.g. each step's thinking
 * placeholder) should re-mount via React `key` rather than toggling
 * the active flag — toggling on the same instance would leave a
 * stale `sec` value between the false→true transition and the
 * first setInterval tick.
 */
function useElapsedSeconds(active: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      setSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? sec : 0;
}

/**
 * Elapsed-time formatter for the thinking placeholder.
 *
 *   3-59s  → "32 秒"             (neutral info — "this is how long")
 *   60s+   → "已 1 分 23 秒"     ("已" prefix softens the longer wait,
 *                                  acknowledging the duration without
 *                                  alarming the user) + "仍在运行"
 *
 * Seconds component always shown past the minute boundary (including
 * "已 1 分 0 秒") so the display ticks continuously each second
 * rather than briefly flashing a shorter form on the round-minute.
 */
function formatElapsedSeconds(
  sec: number,
  copy: ReturnType<typeof useCopy>,
): string {
  if (sec < 60) return copy.conversation.seconds(sec);
  const minutes = Math.floor(sec / 60);
  const remainder = sec % 60;
  return copy.conversation.minutesSeconds(minutes, remainder);
}

function StrongHr() {
  return (
    <hr className="my-4 border-0 border-t border-line-strong" aria-hidden />
  );
}

// SoftHr removed (2026-05-09): even at my-5 (40px) the hr+marker
// stack between turns felt heavy. TurnMarker's own top margin +
// structural register now carries the chapter-break feel.
