import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PauseCircle } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
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
 *     viewport's TOP_PADDING anchor line (matches the same line MainView
 *     uses for submit-snap and ⌥↑/⌥↓).
 *
 * Click jumps to that user-msg via the same scrollBy delta pattern as
 * MainView's keyboard nav (no jarring instant jump, no scroll-into-view
 * blocked-by-flex-parent gotcha).
 *
 * Hover reveals a tooltip on the left with the first 50 chars of the
 * question, so users don't have to click-guess which dot is which. When
 * the rail gets dense, nearby questions collapse into a small vertical
 * cluster marker; hovering that marker expands a local list so detail
 * remains available without turning the rail into visual noise.
 *
 * Hidden under 3 user-msgs — short conversations don't need an index.
 *
 * Anchored DOM: queries `[data-role="user-msg"]` from the passed
 * scroll container ref. That selector is the same stable hook
 * `MessageUser.tsx` exposes and `MainView` already uses for
 * userSubmitTick / ⌥↑/⌥↓ scroll math — DOM order matches the order of
 * `role === "user"` turns in the `turns` array, so indices align 1:1.
 */
const TOP_PADDING = 32;
const MIN_USER_MSGS_TO_SHOW = 3;
const PREVIEW_CHARS = 50;
const RAIL_VERTICAL_INSET_PX = 24;
const DENSE_DOT_GAP_PX = 14;
const MAX_CLUSTER_SPAN_PX = 34;
const CLUSTER_MARKER_MIN_H_PX = 12;
const CLUSTER_MARKER_MAX_H_PX = 26;
const CLUSTER_CLOSE_DELAY_MS = 300;

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
   * filtered userContents array). */
  index: number;
  /** Truncated content for the hover tooltip. */
  preview: string;
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

/**
 * Turn a raw user-message into a clean one-line preview for the rail
 * tooltip / cluster list. Collapses all whitespace (newlines in
 * multi-line messages, runs of spaces) to single spaces, strips a
 * leading markdown marker run (heading #, blockquote >, list bullet,
 * code fence) so the preview reads as prose rather than syntax, then
 * truncates. Returns "" for whitespace-only content; callers render a
 * placeholder for that case.
 */
function buildPreview(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const stripped = normalized
    .replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|`{1,3})/, "")
    .trim();
  if (stripped.length === 0) return "";
  return stripped.length > PREVIEW_CHARS
    ? stripped.slice(0, PREVIEW_CHARS).trimEnd() + "…"
    : stripped;
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
  // Extract user-msg text in turn order. Indices in this array
  // align with the [data-role="user-msg"] DOM nodes inside the
  // scroll container — Conversation.tsx renders one MessageUser per
  // UserTurn in `turns` order.
  const userContents = useMemo(
    () => turns.flatMap((t) => (t.role === "user" ? [t.content] : [])),
    [turns],
  );

  const [railItems, setRailItems] = useState<RailItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const openCluster = (id: string) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpenItemId(id);
  };

  const scheduleCloseCluster = () => {
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
        const preview = buildPreview(userContents[i] ?? "");
        positions.push({ index: i, topPercent, topPx, preview });
      });
      setRailItems(buildRailItems(positions, railHeightPx));
    };

    measure();

    const observer = new ResizeObserver(measure);
    const inner = container.firstElementChild;
    observer.observe(container);
    if (inner instanceof HTMLElement) observer.observe(inner);

    return () => observer.disconnect();
  }, [scrollContainerRef, userContents]);

  // Track which dot is "current" — the most recent user-msg whose
  // top is at or above the viewport's TOP_PADDING anchor (where
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
      const anchorTop = scrollTop + TOP_PADDING + 8;
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
  }, [scrollContainerRef, userContents]);

  if (userContents.length < MIN_USER_MSGS_TO_SHOW) return null;

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
      TOP_PADDING;
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
      className="pointer-events-none absolute right-1.5 top-6 bottom-6 z-10 w-5"
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
              ? item.question.index === userContents.length - 1
              : item.lastIndex === userContents.length - 1;
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
                    role="tooltip"
                    className={cn(
                      "pointer-events-none absolute right-full z-10 mr-2 flex max-w-[320px] items-center gap-2 truncate whitespace-nowrap rounded-sm border border-line bg-elevated px-2 py-1 text-[11.5px] text-ink-soft opacity-0 shadow-sm group-hover:opacity-100",
                      item.topPercent < 6
                        ? "top-0"
                        : item.topPercent > 94
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
                      isClusterOpen
                        ? "pointer-events-auto opacity-100"
                        : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
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
