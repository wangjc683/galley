import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PauseCircle } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import {
  USER_MSG_ANCHOR_TOLERANCE_PX,
  USER_MSG_ANCHOR_TOP_PX,
} from "@/lib/conversation-anchor";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { buildRailExchanges } from "@/lib/rail-preview";
import { StatusIcon } from "@/lib/status-icon";
import { cn } from "@/lib/utils";
import type { Turn } from "@/types/conversation";

/**
 * Right-edge "question index" rail — one dot per user message in the
 * conversation, positioned proportionally to where that user-msg sits
 * inside the scroll content. Solves the long-conversation "I need to
 * find a question I asked 30 turns ago" navigation pain that ⌥↑/⌥↓
 * (linear keyboard step) and apricot user-msg anchors (visual scan)
 * only partially address.
 *
 * Position model:
 *   - Each dot at the user message's top edge within the scroll content,
 *     expressed as a percentage of `scrollContent.scrollHeight`. Adjacent
 *     user-msgs in agent-heavy stretches naturally spread apart on the
 *     rail; clusters of follow-up questions show as adjacent dots.
 *     Mirrors the native scrollbar's position semantics.
 *   - "Active" dot = the topmost user-msg whose top is at or above the
 *     viewport's USER_MSG_ANCHOR_TOP_PX anchor line (matches the same line MainView
 *     uses for submit-snap and ⌥↑/⌥↓).
 *
 * Click jumps to that user-msg via the same scrollBy delta pattern as
 * MainView's keyboard nav (no jarring instant jump, no scroll-into-view
 * blocked-by-flex-parent gotcha).
 *
 * Hover reveals a tooltip on the left with two lines — the question,
 * and the first prose line of the answer that closed that exchange
 * (2026-08-03) — so users don't have to click-guess which dot is
 * which. The dots themselves stay one-per-question: the gap the second
 * line closes is *recognition* ("what did I get out of this one?"),
 * not navigation, and answering it with more marks would double the
 * rail's density to solve a tooltip problem. See
 * `lib/rail-preview.ts` for the pairing rule and for why the preview
 * is the final answer rather than `AgentTurn.summary`.
 *
 * When the rail gets dense, nearby questions collapse into a small
 * vertical cluster marker; hovering that marker expands a local list so
 * detail remains available without turning the rail into visual noise.
 * That list stays one line per question on purpose — it is a
 * fast-locate surface for the dense end of the rail, not a reading
 * surface, and five questions × two lines would make it a wall.
 *
 * Shown from the FIRST user message (2026-07-21; was hidden under 3).
 * The rail has two jobs, not one: a question *index* (meaningful from
 * ~3 questions) and a jump-back *anchor* to the start of a question
 * (meaningful from question one — the deep-research pattern is one
 * question, a several-thousand-word answer, and no fast way back up).
 * The old threshold was set for the first job and starved the second;
 * a single dot is a barely-there anchor that stays consistent with
 * what long conversations already taught the user.
 *
 * Anchored DOM: queries `[data-role="user-msg"]` from the passed
 * scroll container ref. That selector is the same stable hook
 * `MessageUser.tsx` exposes and `MainView` already uses for
 * userSubmitTick / ⌥↑/⌥↓ scroll math — DOM order matches the order of
 * `role === "user"` turns in the `turns` array, so indices align 1:1.
 */
const MIN_USER_MSGS_TO_SHOW = 1;
const RAIL_VERTICAL_INSET_PX = 24;
const DENSE_DOT_GAP_PX = 14;
const MAX_CLUSTER_SPAN_PX = 34;
const CLUSTER_MARKER_MIN_H_PX = 12;
const CLUSTER_MARKER_MAX_H_PX = 26;
const CLUSTER_CLOSE_DELAY_MS = 300;
/**
 * Hover intent gate for the previews (single-dot tooltip + cluster
 * list). The mouse crosses the rail on its way to the scrollbar / the
 * scroll-to-bottom button; without a short open delay every pass-over
 * flashes a preview. Disappearance stays immediate — delay is only on
 * the way in. Matches the `delay-150` Tailwind class on the preview
 * elements; keep the two in sync.
 */
const HOVER_OPEN_DELAY_MS = 150;

/**
 * Percent-of-rail positions past which the hover tooltip stops being
 * centered on its dot and pins to the dot's top / bottom edge instead,
 * so it never hangs outside the conversation's bounds.
 *
 * Raised from 6 / 94 when the tooltip grew its second line: that pair
 * was tuned for a ~24px single-line box, and the ~44px two-line box
 * overhangs at the extremes in short windows (the rail's half-box
 * headroom is a percentage of `clientHeight`, so the shorter the
 * window, the larger the percentage a fixed box height occupies).
 */
const TOOLTIP_EDGE_TOP_PERCENT = 10;
const TOOLTIP_EDGE_BOTTOM_PERCENT = 90;

type RailTailStatus = "running" | "waiting";

function getTopInScrollContent(
  containerTop: number,
  scrollTop: number,
  el: HTMLElement,
): number {
  return el.getBoundingClientRect().top - containerTop + scrollTop;
}

interface UserQuestionRailProps {
  turns: Turn[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Live state of the latest exchange, surfaced on the tail dot so a
   * user scrolled up during a long run still sees whether the agent is
   * working ("running") or it's their move — pending approval /
   * ask_user ("waiting"). null = idle, no marker. */
  tailStatus?: RailTailStatus | null;
  /** Called when the user jumps via the rail. MainView uses it to
   * break follow-the-bottom (setAtBottom(false)) so a streaming chunk
   * doesn't immediately snap the jump back down — mirrors the ⌥↑/⌥↓
   * keyboard nav, which already does this. */
  onJump?: () => void;
}

interface QuestionPosition {
  /** Index into the array of user-msgs (matches DOM order and the
   * `exchanges` array). */
  index: number;
  /** Truncated question content — first line of the hover tooltip. */
  preview: string;
  /** Truncated answer content — second line of the hover tooltip.
   * null when there is nothing to show (agent still working, run
   * interrupted, or no previewable prose); the line is then not
   * rendered at all rather than left as an empty row. */
  answer: string | null;
  /** Vertical position within the rail, expressed as % of
   * scroll-content height — the same axis the native scrollbar uses. */
  topPercent: number;
  /** Pixel position on the rail, used only for density clustering. */
  topPx: number;
}

interface SingleRailItem {
  kind: "single";
  id: string;
  topPercent: number;
  question: QuestionPosition;
}

interface ClusterRailItem {
  kind: "cluster";
  id: string;
  topPercent: number;
  firstIndex: number;
  lastIndex: number;
  markerHeightPx: number;
  questions: QuestionPosition[];
}

type RailItem = SingleRailItem | ClusterRailItem;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function RailTailStatusIcon({ status }: { status: RailTailStatus }) {
  return (
    <span
      aria-hidden
      className="relative z-10 flex size-4 items-center justify-center rounded-full"
    >
      {status === "running" ? (
        <StatusIcon status="running" size={14} />
      ) : (
        <PauseCircle size={14} weight="thin" className="text-warning" />
      )}
    </span>
  );
}

function buildRailItems(
  positions: QuestionPosition[],
  railHeightPx: number,
): RailItem[] {
  if (positions.length === 0) return [];

  const items: RailItem[] = [];
  let group: QuestionPosition[] = [positions[0]];

  const flush = () => {
    if (group.length === 1) {
      const question = group[0];
      items.push({
        kind: "single",
        id: `q-${question.index}`,
        topPercent: question.topPercent,
        question,
      });
      group = [];
      return;
    }

    const first = group[0];
    const last = group[group.length - 1];
    const spanPx = last.topPx - first.topPx;
    const centerTopPx = first.topPx + spanPx / 2;
    items.push({
      kind: "cluster",
      id: `q-${first.index}-${last.index}`,
      topPercent: (centerTopPx / railHeightPx) * 100,
      firstIndex: first.index,
      lastIndex: last.index,
      markerHeightPx: clamp(
        spanPx + 8,
        CLUSTER_MARKER_MIN_H_PX,
        CLUSTER_MARKER_MAX_H_PX,
      ),
      questions: group,
    });
    group = [];
  };

  for (let i = 1; i < positions.length; i++) {
    const current = positions[i];
    const previous = group[group.length - 1];
    const first = group[0];
    const gapPx = current.topPx - previous.topPx;
    const spanPx = current.topPx - first.topPx;

    if (gapPx < DENSE_DOT_GAP_PX && spanPx <= MAX_CLUSTER_SPAN_PX) {
      group.push(current);
      continue;
    }

    flush();
    group = [current];
  }

  flush();
  return items;
}

export function UserQuestionRail({
  turns,
  scrollContainerRef,
  tailStatus = null,
  onJump,
}: UserQuestionRailProps) {
  const copy = useCopy();
  // One entry per user message, in turn order, each carrying the
  // question preview and the answer that closed it. Indices in this
  // array align with the [data-role="user-msg"] DOM nodes inside the
  // scroll container — Conversation.tsx renders one MessageUser per
  // UserTurn in `turns` order. Recomputes on `turns` identity, i.e.
  // once per turn_end, not per streaming chunk (in-flight text lives
  // in MainView's visiblePartial, outside `turns`).
  const exchanges = useMemo(() => buildRailExchanges(turns), [turns]);

  const [railItems, setRailItems] = useState<RailItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (openTimer.current) window.clearTimeout(openTimer.current);
    };
  }, []);

  const openCluster = (id: string) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (openTimer.current) window.clearTimeout(openTimer.current);
    // Delayed to match the CSS hover-intent gate — an instant state
    // flip here would reveal the list before the delay elapses.
    openTimer.current = window.setTimeout(() => {
      setOpenItemId(id);
      openTimer.current = null;
    }, HOVER_OPEN_DELAY_MS);
  };

  const scheduleCloseCluster = () => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpenItemId(null);
      closeTimer.current = null;
    }, CLUSTER_CLOSE_DELAY_MS);
  };

  // Re-measure dot positions on layout commits. ResizeObserver covers
  // streaming chunks growing the content, Shiki settling code blocks,
  // and window resizes. useLayoutEffect runs before paint so the rail
  // never shows stale positions for a frame after content changes.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const measure = () => {
      const userMsgs = container.querySelectorAll<HTMLElement>(
        '[data-role="user-msg"]',
      );
      const scrollHeight = container.scrollHeight;
      if (scrollHeight === 0 || userMsgs.length === 0) {
        setRailItems([]);
        return;
      }
      const railHeightPx = Math.max(
        1,
        container.clientHeight - RAIL_VERTICAL_INSET_PX * 2,
      );
      const positions: QuestionPosition[] = [];
      const containerTop = container.getBoundingClientRect().top;
      const scrollTop = container.scrollTop;
      userMsgs.forEach((el, i) => {
        const topInContent = getTopInScrollContent(containerTop, scrollTop, el);
        const topPercent = (topInContent / scrollHeight) * 100;
        const topPx = (topPercent / 100) * railHeightPx;
        const exchange = exchanges[i];
        positions.push({
          index: i,
          topPercent,
          topPx,
          preview: exchange?.question ?? "",
          answer: exchange?.answer ?? null,
        });
      });
      setRailItems(buildRailItems(positions, railHeightPx));
    };

    measure();

    const observer = new ResizeObserver(measure);
    const inner = container.firstElementChild;
    observer.observe(container);
    if (inner instanceof HTMLElement) observer.observe(inner);

    return () => observer.disconnect();
  }, [scrollContainerRef, exchanges]);

  // Track which dot is "current" — the most recent user-msg whose
  // top is at or above the viewport's USER_MSG_ANCHOR_TOP_PX anchor (where
  // MainView parks user-msgs after submit / keyboard nav). Same
  // 8px tolerance as MainView's ⌥↑/⌥↓ math so the boundary feels
  // identical.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const userMsgs = container.querySelectorAll<HTMLElement>(
        '[data-role="user-msg"]',
      );
      if (userMsgs.length === 0) return;
      const scrollTop = container.scrollTop;
      const anchorTop =
        scrollTop + USER_MSG_ANCHOR_TOP_PX + USER_MSG_ANCHOR_TOLERANCE_PX;
      const containerTop = container.getBoundingClientRect().top;
      let last = -1;
      userMsgs.forEach((el, i) => {
        if (getTopInScrollContent(containerTop, scrollTop, el) <= anchorTop) {
          last = i;
        }
      });
      setActiveIndex(last);
    };

    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef, exchanges]);

  if (exchanges.length < MIN_USER_MSGS_TO_SHOW) return null;

  const handleJump = (idx: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const userMsgs = container.querySelectorAll<HTMLElement>(
      '[data-role="user-msg"]',
    );
    const target = userMsgs[idx];
    if (!target) return;
    const delta =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      USER_MSG_ANCHOR_TOP_PX;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    container.scrollBy({
      top: delta,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    // Break follow-the-bottom so an incoming streaming chunk doesn't
    // snap the jump straight back down (mirrors MainView's ⌥↑/⌥↓ nav).
    onJump?.();
  };

  return (
    <div
      role="navigation"
      aria-label={copy.conversation.questionIndex}
      // right-3 (12px) is the structural maximum for the 20px dot hit
      // area: 12 + 20 = 32 = the scroll container's px-8 content
      // gutter, so the hit area fills the gutter without ever shading
      // the prose column at narrow widths. It also clears Windows'
      // 10px classic scrollbar lane with margin (globals.css
      // scrollbar-stable) and roughly halves the overlap with macOS
      // overlay bars in their hover-expanded state — at the original
      // right-1.5 the hit area's outer 4px sat over the Windows lane
      // and clicks aimed at the thumb's edge landed on dots.
      // Perceptually the extra inset also matters: dots hugging the
      // window edge read as scrollbar-family chrome; they are a
      // content index and belong on the content's side of that line.
      className="pointer-events-none absolute right-3 top-6 bottom-6 z-10 w-5"
    >
      <div className="relative h-full">
        {/* Hairline spine — 1px line-subtle vertical, centered under
            the dot column, runs full rail height. Threads the dots
            into a single visual group instead of a loose constellation.
            Layered behind the dots: inactive rings let it show through
            their transparent center (reads as a quiet through-line),
            active filled discs sit on top and break it visually
            wherever the user currently is. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-line-subtle"
        />
        {railItems.map((item) => {
          const isClusterOpen =
            item.kind === "cluster" && openItemId === item.id;
          const isTail =
            item.kind === "single"
              ? item.question.index === exchanges.length - 1
              : item.lastIndex === exchanges.length - 1;
          const showStatus = isTail && tailStatus != null;
          const statusLabel =
            tailStatus === "waiting"
              ? copy.conversation.railStatusWaiting
              : copy.conversation.railStatusRunning;

          return (
            <div
              key={item.id}
              className="group pointer-events-auto absolute right-0 -translate-y-1/2"
              style={{ top: `${item.topPercent}%` }}
              onMouseEnter={() => {
                if (item.kind === "cluster") openCluster(item.id);
              }}
              onMouseLeave={() => {
                if (item.kind === "cluster") scheduleCloseCluster();
              }}
            >
              {item.kind === "single" ? (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={() => handleJump(item.question.index)}
                    aria-label={
                      showStatus
                        ? `${copy.conversation.jumpToQuestion(
                            item.question.index + 1,
                          )} · ${statusLabel}`
                        : copy.conversation.jumpToQuestion(
                            item.question.index + 1,
                          )
                    }
                    className="group/dot relative grid size-5 place-items-center outline-none"
                  >
                    {showStatus ? (
                      <RailTailStatusIcon status={tailStatus} />
                    ) : (
                      <>
                        {/* Active = filled apricot disc; inactive = hollow ring.
                          Single-axis state (fill vs no-fill) at fixed 8px
                          size — same visual weight slot for both states, the
                          ink reading does all the work. */}
                        <span
                          className={cn(
                            "relative block size-2 rounded-full border-[1.5px]",
                            item.question.index === activeIndex
                              ? "border-brand-strong bg-brand-strong"
                              : "border-line-strong bg-transparent group-hover:border-ink-soft",
                          )}
                        />
                      </>
                    )}
                  </button>
                  <span
                    // Visual-only duplicate of the button's aria-label
                    // + preview; hidden from SR so the question isn't
                    // announced twice. The answer line is visual-only
                    // for the same reason the question already is —
                    // the button's aria-label is the navigation
                    // destination ("跳到第 N 条提问"), not a reading
                    // surface. Hover-intent gate: fades in after
                    // delay-150 (= HOVER_OPEN_DELAY_MS), hides
                    // immediately (delay only applies toward the
                    // hovered state) — a mouse crossing the rail on
                    // its way to the scrollbar doesn't flash previews.
                    //
                    // Grid rather than flex so the answer line can sit
                    // in column 3 and self-align with the question's
                    // start, whatever width the ordinal takes (1 vs
                    // 10 vs 100). `minmax(0,1fr)` is what lets the two
                    // text cells truncate instead of forcing the box
                    // past its max width.
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute right-full z-10 mr-2 grid w-max max-w-[320px] grid-cols-[auto_1px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-sm border border-line bg-elevated px-2 py-1 text-[11.5px] text-ink shadow-sm",
                      "opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-hover:delay-150",
                      item.topPercent < TOOLTIP_EDGE_TOP_PERCENT
                        ? "top-0"
                        : item.topPercent > TOOLTIP_EDGE_BOTTOM_PERCENT
                          ? "bottom-0"
                          : "top-1/2 -translate-y-1/2",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[10.5px] tabular-nums",
                        item.question.index === activeIndex
                          ? "text-brand-strong"
                          : "text-ink-muted",
                      )}
                    >
                      {item.question.index + 1}
                    </span>
                    <span
                      aria-hidden
                      className="h-2.5 w-px shrink-0 bg-line"
                    />
                    <span className="truncate">
                      {item.question.preview || copy.conversation.questionEmpty}
                    </span>
                    {/* Answer sits a register below the question, and
                        the gap is TWO steps of the three-step ink
                        scale: the box is `text-ink` so the question
                        inherits it, the answer overrides to
                        `text-ink-muted` (the scale's floor).
                        `text-ink-soft` + `text-ink-muted` was tried
                        first and read as two equal facts — one step
                        cannot outweigh how parallel the two lines are
                        structurally (same size, same start column,
                        same length budget, even gap). Widening the
                        contrast was chosen over shrinking the answer
                        (smaller type / shorter budget) so nothing has
                        to shrink toward the CJK legibility floor. */}
                    {item.question.answer && (
                      <span className="col-start-3 truncate text-ink-muted">
                        {item.question.answer}
                      </span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={() => handleJump(item.firstIndex)}
                    aria-label={
                      showStatus
                        ? `${copy.conversation.jumpToQuestionCluster(
                            item.firstIndex + 1,
                            item.lastIndex + 1,
                            item.questions.length,
                          )} · ${statusLabel}`
                        : copy.conversation.jumpToQuestionCluster(
                            item.firstIndex + 1,
                            item.lastIndex + 1,
                            item.questions.length,
                          )
                    }
                    className="group/dot relative grid size-5 place-items-center outline-none"
                  >
                    <span
                      className={cn(
                        "relative block w-2 rounded-full border-[1.5px]",
                        activeIndex >= item.firstIndex &&
                          activeIndex <= item.lastIndex
                          ? "border-brand-strong bg-brand-strong"
                          : "border-line-strong bg-surface group-hover:border-ink-soft group-hover:bg-elevated",
                      )}
                      style={{ height: item.markerHeightPx }}
                    />
                    {showStatus && (
                      <span
                        className="pointer-events-none absolute -left-2 top-1/2 -translate-y-1/2"
                      >
                        <RailTailStatusIcon status={tailStatus} />
                      </span>
                    )}
                  </button>
                  <div
                    aria-hidden
                    className={cn(
                      "absolute right-full top-1/2 z-10 h-14 w-4 -translate-y-1/2",
                      isClusterOpen
                        ? "pointer-events-auto"
                        : "pointer-events-none group-hover:pointer-events-auto",
                    )}
                  />
                  <div
                    role="group"
                    aria-label={copy.conversation.questionCluster(
                      item.firstIndex + 1,
                      item.lastIndex + 1,
                      item.questions.length,
                    )}
                    className={cn(
                      "absolute right-full z-10 mr-2 w-max max-w-[min(320px,calc(100vw-80px))] rounded-sm border border-line bg-elevated py-1 text-[11.5px] text-ink-soft shadow-sm",
                      "transition-opacity duration-(--motion-fast)",
                      // Same hover-intent gate as the single-dot
                      // tooltip; the state-driven open path is delayed
                      // to match (see openCluster).
                      isClusterOpen
                        ? "pointer-events-auto opacity-100"
                        : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-150",
                      item.topPercent < 18
                        ? "top-0"
                        : item.topPercent > 82
                          ? "bottom-0"
                          : "top-1/2 -translate-y-1/2",
                    )}
                  >
                    <div className="max-h-[260px] overflow-y-auto">
                      {item.questions.map((question) => (
                        <button
                          key={question.index}
                          type="button"
                          tabIndex={-1}
                          onMouseDown={preventMouseFocus}
                          onClick={() => handleJump(question.index)}
                          className="flex w-full items-center gap-2 px-2 py-1 text-left text-ink-soft hover:bg-hover hover:text-ink"
                        >
                          <span
                            className={cn(
                              "shrink-0 font-mono text-[10.5px] tabular-nums",
                              question.index === activeIndex
                                ? "text-brand-strong"
                                : "text-ink-muted",
                            )}
                          >
                            {question.index + 1}
                          </span>
                          <span
                            aria-hidden
                            className="h-2.5 w-px shrink-0 bg-line"
                          />
                          <span className="truncate">
                            {question.preview || copy.conversation.questionEmpty}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
