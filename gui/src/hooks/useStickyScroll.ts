import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  USER_MSG_ANCHOR_TOLERANCE_PX,
  USER_MSG_ANCHOR_TOP_PX,
} from "@/lib/conversation-anchor";
import { useUiStore } from "@/stores/ui";
import type { PendingApproval, PendingAskUser } from "@/types/conversation";

/** How long the located message keeps its wash (matches the CSS
 * keyframes in globals.css — change both together or neither). */
const LOCATE_FLASH_MS = 1400;
/** Frames to keep looking for the anchor node after turns land —
 * covers Shiki / image reflow committing the node a beat later. */
const LOCATE_RETRY_FRAMES = 30;
/** CSS Custom Highlight registry key; styled by `::highlight(...)` in
 * globals.css. */
const LOCATE_HIGHLIGHT_NAME = "galley-locate";
const LOCATE_MAX_TERM_RANGES = 200;

/**
 * Case-insensitive substring occurrences of `query` inside `root`'s
 * text nodes, as DOM Ranges — the same "does this text contain the
 * query" semantics as the palette's trigram / LIKE search, applied to
 * the rendered message. Matches never span two text nodes (a term
 * split by inline markup is missed, which is acceptable: the block
 * wash still says which message).
 */
function findTermRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (
    let node = walker.nextNode();
    node && ranges.length < LOCATE_MAX_TERM_RANGES;
    node = walker.nextNode()
  ) {
    const text = node.textContent ?? "";
    const hay = text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      from = at + needle.length;
      if (ranges.length >= LOCATE_MAX_TERM_RANGES) break;
    }
  }
  return ranges;
}

/** Term highlight lives outside the React tree (CSS Custom Highlight
 * API), so react-markdown's DOM is never touched. No-op where the API
 * is missing: the block wash alone then marks the message. */
function setLocateHighlight(ranges: Range[]): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  if (ranges.length === 0) {
    CSS.highlights.delete(LOCATE_HIGHLIGHT_NAME);
    return;
  }
  CSS.highlights.set(LOCATE_HIGHLIGHT_NAME, new Highlight(...ranges));
}

function clearLocateHighlight(): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  CSS.highlights.delete(LOCATE_HIGHLIGHT_NAME);
}

/**
 * Owns the MainView conversation's scroll behavior — one cohesive
 * imperative machine pulled out of the render component so its 7 effects
 * + RAF / ResizeObserver bookkeeping don't crowd the JSX.
 *
 * Responsibilities, all reading/writing the same scroll position +
 * bottom-tracking state:
 *   - sticky-bottom follow while streaming (don't yank a user who
 *     scrolled up to read older content)
 *   - the floating scroll-to-bottom button + its smooth-scroll monitor
 *   - scroll-to-bottom on session switch (race-hardened against async
 *     SQLite restore, Shiki reflow, and WKWebView repaint skips)
 *   - stick-to-user-message-top on submit
 *   - ⌥↑ / ⌥↓ keyboard jump between user messages
 *   - advance-to-next-pending-approval scroll + focus
 *
 * Inputs are the bottom-anchored growth / navigation triggers the
 * effects depend on; the component owns the DOM these refs point at.
 */
export function useStickyScroll({
  activeSessionId,
  userSubmitTick,
  streamingContent,
  turnsLength,
  pendingApprovalsLength,
  pendingAskUser,
  restoring = false,
}: {
  /** Active session id. Identity change re-snaps the new conversation
   * to the bottom. Undefined during pre-session screens. */
  activeSessionId?: string;
  /** True while the session's turns are still loading from SQLite —
   * the locate effect waits for it to clear before hunting for the
   * anchor node. */
  restoring?: boolean;
  /** Counter the submit path bumps; drives the stick-to-user-message
   * scroll without also firing on every turn_end. */
  userSubmitTick: number;
  /** Typewriter / parse-throttled streaming buffer — grows as chunks
   * arrive; one of the bottom-anchored follow-mode triggers. */
  streamingContent: string;
  /** turns.length — each turn_end commits a new AgentTurn below the fold. */
  turnsLength: number;
  /** pendingApprovals.length — an approval card landing grows the doc. */
  pendingApprovalsLength: number;
  /** GA-initiated question; its appearance grows the doc tail. */
  pendingAskUser?: PendingAskUser | null;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingApprovalRefs = useRef(new Map<string, HTMLDivElement>());

  // Sticky-bottom mode for streaming: when the user is "near the
  // bottom" we follow newly-arrived chunks; if they've scrolled up
  // to read older content we don't yank them down.
  //
  // `atBottom` is the currently-tracked position; updated on scroll
  // events with a 24px tolerance so flicker around the boundary
  // doesn't toggle the mode.
  const [atBottom, setAtBottom] = useState(true);
  const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
  const scrollToBottomRafRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(distFromBottom < 24);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Follow-the-bottom: while atBottom, pin scroll position to the
  // bottom whenever the conversation grows. useLayoutEffect runs
  // synchronously after the new content renders, before the browser
  // paints — so the user never sees a glimpse of the
  // bottom-having-moved-up before we snap it back.
  //
  // Deps cover every source of bottom-anchored growth:
  //   - streamingContent:       streaming chunks (typewriter-revealed)
  //   - turnsLength:            each turn_end commits a new AgentTurn
  //   - pendingApprovalsLength: approval card lands
  //   - pendingAskUser:         AskUserBubble appears
  //
  // Originally this only watched the streaming buffer — fine for the
  // single-turn / streaming-heavy case, but in multi-step runs where
  // the partial stays empty for stretches (tool-heavy turns,
  // dispatch markers stripped) each new step would commit invisibly
  // below the fold. User would only see progress when the final
  // turn's streaming naturally triggered a snap. Widening the deps
  // makes follow-mode catch every step's structural commit too.
  //
  // scrollTop assignment is O(1) so re-firing per render is fine.
  useLayoutEffect(() => {
    if (!atBottom) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    streamingContent,
    atBottom,
    turnsLength,
    pendingApprovalsLength,
    pendingAskUser,
  ]);

  const stopMonitoringScrollToBottom = () => {
    setIsScrollingToBottom(false);
    if (scrollToBottomRafRef.current !== null) {
      cancelAnimationFrame(scrollToBottomRafRef.current);
      scrollToBottomRafRef.current = null;
    }
  };

  const onClickScrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return;

    stopMonitoringScrollToBottom();
    setIsScrollingToBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });

    // The click's intent is "attach to the tail", not "scroll to the
    // coordinate the tail happened to be at". While streaming, the
    // bottom is a moving target: the smooth animation aims at the
    // scrollHeight sampled on click, chunks land, and the distance
    // check can stay >24px forever. So the monitor (a) re-aims the
    // animation whenever the document grows, and (b) on timeout snaps
    // + attaches instead of giving up. The only path that ends
    // detached is the user actively pulling away mid-flight.
    const startedAt = performance.now();
    let lastScrollTop = el.scrollTop;
    let issuedForHeight = el.scrollHeight;
    const monitorScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom < 24) {
        stopMonitoringScrollToBottom();
        setAtBottom(true);
        return;
      }

      if (el.scrollTop < lastScrollTop - 2) {
        // User scrolled up against the animation — they changed their
        // mind; abort without attaching.
        stopMonitoringScrollToBottom();
        setAtBottom(false);
        return;
      }

      if (performance.now() - startedAt > 1600) {
        // Streaming outgrew the animation. Finish the job instantly.
        el.scrollTop = el.scrollHeight;
        stopMonitoringScrollToBottom();
        setAtBottom(true);
        return;
      }

      // Bottom moved since the last scrollTo — re-aim at the new
      // bottom. Only on growth, so the smooth animation isn't
      // restarted (and visibly stuttered) every frame.
      if (el.scrollHeight !== issuedForHeight) {
        issuedForHeight = el.scrollHeight;
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }

      lastScrollTop = el.scrollTop;
      scrollToBottomRafRef.current = requestAnimationFrame(monitorScroll);
    };
    scrollToBottomRafRef.current = requestAnimationFrame(monitorScroll);
  };

  useEffect(
    () => () => {
      if (scrollToBottomRafRef.current !== null) {
        cancelAnimationFrame(scrollToBottomRafRef.current);
        scrollToBottomRafRef.current = null;
      }
    },
    [],
  );

  const onClickAdvanceApproval = (next: PendingApproval) => {
    const container = scrollContainerRef.current;
    const target = pendingApprovalRefs.current.get(next.approvalId);
    if (!container || !target) return;

    const containerRect = container.getBoundingClientRect();
    const targetTop = target.getBoundingClientRect().top;
    const delta = targetTop - containerRect.top - USER_MSG_ANCHOR_TOP_PX;
    container.scrollBy({ top: delta, behavior: "smooth" });
    setAtBottom(false);

    window.setTimeout(() => {
      const focusTarget =
        target.querySelector<HTMLElement>("button:not([disabled])") ?? target;
      focusTarget.focus({ preventScroll: true });
    }, 180);
  };

  // atBottom mirror for use inside async callbacks (ResizeObserver
  // below) where the captured closure would otherwise see a stale
  // boolean. The effect-based sync (rather than a render-phase
  // assignment) keeps the react-hooks lint rule happy.
  const atBottomRef = useRef(atBottom);
  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  // Scroll-to-bottom on session switch. Three compounding races make
  // a single scrollTop assignment unreliable:
  //
  //   1. activateSession async-restores turns from SQLite — the
  //      restored turns commit in a *later* render than the one
  //      our useEffect runs after. Our first scrollHeight read
  //      sees the pre-restore (empty / smaller) layout.
  //   2. MarkdownView's CodeBlock uses Shiki for syntax highlighting
  //      asynchronously (WASM + dynamic grammar import). Highlighted
  //      <pre><code> blocks settle to their final height ~50–500ms
  //      after first render; line wrapping in the highlighted
  //      version often differs from the plain fallback.
  //   3. WKWebView (Tauri on macOS) sometimes skips repainting after
  //      a rapid DOM swap until an input event nudges it — which is
  //      exactly the "blank window → scroll a bit → content appears"
  //      symptom users hit. Assigning scrollTop to the same pixel
  //      it already was at gets optimized away and doesn't trigger
  //      paint either.
  //
  // Strategy: snap to bottom now (post-commit RAF), then watch the
  // inner content for height changes via ResizeObserver for a 500ms
  // window. Every height change inside the window re-snaps — that
  // catches both the SQLite restore commit and Shiki's
  // highlight-completion reflow. Each scrollTop write also serves
  // as a paint trigger for WKWebView.
  //
  // Bail out of the observer if the user scrolls away from bottom
  // during the window — they're reading older content and shouldn't
  // be yanked back. The existing scroll listener (above) keeps
  // `atBottom` in sync, mirrored here via atBottomRef.
  useEffect(() => {
    if (activeSessionId === undefined) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    // A pending locate for this session owns the landing position —
    // snapping to the bottom here would race the locate scroll (and
    // the ResizeObserver window would keep yanking it back).
    if (useUiStore.getState().locateRequest?.sessionId === activeSessionId) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    });

    let observer: ResizeObserver | null = null;
    let timeoutId: number | null = null;
    const inner = el.firstElementChild;
    if (inner instanceof HTMLElement) {
      observer = new ResizeObserver(() => {
        if (!atBottomRef.current) {
          observer?.disconnect();
          observer = null;
          return;
        }
        el.scrollTop = el.scrollHeight;
      });
      observer.observe(inner);
      timeoutId = window.setTimeout(() => {
        observer?.disconnect();
        observer = null;
      }, 500);
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [activeSessionId]);

  // Stick-to-user-message-top scroll behaviour (DESIGN.md §4.3).
  // Effect fires only when the user submits a new message — keying
  // on `turns.length` would also fire on every turn_end (pushing
  // the user away mid-read of the agent's reply). The store's
  // `userSubmitTick` is a counter that only the submit path bumps.
  //
  // Why we don't use scrollIntoView({block: "start"}): it doesn't
  // accept a top-padding argument. We compute the offset manually
  // so the user message lands ~32px below the scroll container's
  // top edge (gives the thinking placeholder + first reply lines
  // visible breathing room without burying the prompt off-screen).
  useEffect(() => {
    if (userSubmitTick === 0) return; // initial render — nothing to scroll
    const container = scrollContainerRef.current;
    if (!container) return;
    // RAF defers to after the new <MessageUser> has actually mounted
    // from the appendUserTurn state update — which also means it runs
    // after the same commit folded the previous run (conversation-run-
    // fold), so the measured delta reflects the folded layout.
    // Both anchor roles matter here: an ask_user reply renders as
    // `user-msg-reply` (excluded from the rail / ⌥-nav index), but it
    // is still the just-submitted message this snap must target.
    const handle = requestAnimationFrame(() => {
      const userMsgs = container.querySelectorAll<HTMLElement>(
        '[data-role="user-msg"], [data-role="user-msg-reply"]',
      );
      const last = userMsgs[userMsgs.length - 1];
      if (!last) return;
      const containerRect = container.getBoundingClientRect();
      const targetTop = last.getBoundingClientRect().top;
      const delta = targetTop - containerRect.top - USER_MSG_ANCHOR_TOP_PX;
      if (Math.abs(delta) < 1) return;
      container.scrollBy({ top: delta, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(handle);
  }, [userSubmitTick]);

  // ⌥↑ / ⌥↓ jump to previous / next user message. The user-msg
  // block is now a strong visual anchor (apricot fill, see 2026-05-14
  // commit) — power users in long conversations want a fast keyboard
  // path between their own questions without trackpad-scrolling
  // through dozens of agent steps.
  //
  // Bound to document, not the container — the conversation column
  // doesn't take focus naturally (it isn't tabbable). We bail out
  // when an editable element is focused so we don't steal Option+Up
  // from text-cursor-by-paragraph navigation inside Composer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable) {
          return;
        }
      }

      const container = scrollContainerRef.current;
      if (!container) return;

      const userMsgs = Array.from(
        container.querySelectorAll<HTMLElement>('[data-role="user-msg"]'),
      );
      if (userMsgs.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const anchor = USER_MSG_ANCHOR_TOP_PX;
      const tolerance = USER_MSG_ANCHOR_TOLERANCE_PX;

      const tops = userMsgs.map(
        (el) => el.getBoundingClientRect().top - containerRect.top,
      );

      let target: HTMLElement | undefined;
      if (e.key === "ArrowDown") {
        // Next user-msg whose top is below the current anchor line.
        target = userMsgs.find((_, i) => tops[i] > anchor + tolerance);
      } else {
        // Previous user-msg whose top is above the current anchor line.
        for (let i = userMsgs.length - 1; i >= 0; i--) {
          if (tops[i] < anchor - tolerance) {
            target = userMsgs[i];
            break;
          }
        }
      }
      if (!target) return;

      e.preventDefault();
      const delta =
        target.getBoundingClientRect().top - containerRect.top - anchor;
      container.scrollBy({ top: delta, behavior: "smooth" });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Locate-a-message (palette full-text hit → "open session at this
  // message"). The request lives in the ui store so the palette can
  // file it before the session is even active; this effect consumes
  // it once the target session's turns are on screen. Same anchor
  // geometry as every other "park a message at the top" path, plus a
  // transient wash so the eye lands on the right block.
  //
  // The landing is a HARD scrollTop write, not a smooth scrollBy: on
  // a fresh session mount this effect replaces the session-switch
  // snap above (which stands down while a locate is pending), and
  // that snap's scrollTop write doubled as the WKWebView paint nudge
  // described there. Without a real scrollTop change the restored
  // conversation can stay unpainted until the user scrolls (seen on
  // 2026-09-08: blank column, rail dots present, content appears on
  // the first wheel tick). The 500ms ResizeObserver window mirrors
  // the snap's too — Shiki / image reflow after the first paint would
  // otherwise shift the parked message off the anchor line.
  const locateRequest = useUiStore((s) => s.locateRequest);
  const clearLocate = useUiStore((s) => s.clearLocate);
  useEffect(() => {
    if (!locateRequest) return;
    if (locateRequest.sessionId !== activeSessionId) return;
    if (restoring || turnsLength === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    let frames = 0;
    let rafId: number | null = null;
    let flashTimer: number | null = null;
    let observer: ResizeObserver | null = null;
    let observerTimer: number | null = null;
    const selector = `[data-message-id="${CSS.escape(locateRequest.messageId)}"]`;

    // Park the first term occurrence when there is one — a long answer
    // can carry the match hundreds of px below the block's top — else
    // the block itself.
    const park = (target: HTMLElement, focal: Range | null): number => {
      const containerRect = container.getBoundingClientRect();
      const focalTop = (focal ?? target).getBoundingClientRect().top;
      const delta = focalTop - containerRect.top - USER_MSG_ANCHOR_TOP_PX;
      const top = Math.max(0, container.scrollTop + delta);
      if (Math.abs(container.scrollTop - top) < 1) {
        // Same pixel — the write would be optimized away and paint
        // nothing. Bounce one pixel so WKWebView sees a real change.
        container.scrollTop = top + 1;
      }
      container.scrollTop = top;
      return top;
    };

    const attempt = () => {
      const target = container.querySelector<HTMLElement>(selector);
      if (!target) {
        if (frames++ < LOCATE_RETRY_FRAMES) {
          rafId = requestAnimationFrame(attempt);
        } else {
          // Node never appeared (hidden by a fold, or an id the
          // restore didn't produce) — give up quietly and let the
          // session render where it is.
          clearLocate();
        }
        return;
      }
      const ranges = locateRequest.query
        ? findTermRanges(target, locateRequest.query)
        : [];
      // Lifecycle (2026-09-08 ruling): the term highlight stays until
      // the next locate, a session switch, or Esc — the user reads
      // around the hit after landing, and 1.4s is too short for that.
      setLocateHighlight(ranges);
      const focal = ranges[0] ?? null;
      let parkedAt = park(target, focal);
      setAtBottom(false);
      target.classList.add("message-locate-flash");
      flashTimer = window.setTimeout(() => {
        target.classList.remove("message-locate-flash");
      }, LOCATE_FLASH_MS);
      clearLocate();

      // Re-park while late layout settles; bail as soon as the user
      // scrolls away from where we put them.
      const inner = container.firstElementChild;
      if (inner instanceof HTMLElement) {
        observer = new ResizeObserver(() => {
          if (Math.abs(container.scrollTop - parkedAt) > 4) {
            observer?.disconnect();
            observer = null;
            return;
          }
          parkedAt = park(target, focal);
        });
        observer.observe(inner);
        observerTimer = window.setTimeout(() => {
          observer?.disconnect();
          observer = null;
        }, 500);
      }
    };
    rafId = requestAnimationFrame(attempt);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (flashTimer !== null) window.clearTimeout(flashTimer);
      if (observerTimer !== null) window.clearTimeout(observerTimer);
      observer?.disconnect();
    };
  }, [locateRequest, activeSessionId, restoring, turnsLength, clearLocate]);

  // Term highlight lifecycle: gone on session switch / unmount, and on
  // Esc (no preventDefault — whoever else handles Esc still does).
  useEffect(() => {
    clearLocateHighlight();
    return clearLocateHighlight;
  }, [activeSessionId]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearLocateHighlight();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Callback-ref factory for the in-flight approval cards. The hook
  // owns the id → node map (onClickAdvanceApproval reads it); the
  // component just spreads this onto each card.
  const registerPendingApprovalRef = useCallback(
    (approvalId: string) => (node: HTMLDivElement | null) => {
      if (node) {
        pendingApprovalRefs.current.set(approvalId, node);
      } else {
        pendingApprovalRefs.current.delete(approvalId);
      }
    },
    [],
  );

  return {
    scrollContainerRef,
    atBottom,
    setAtBottom,
    isScrollingToBottom,
    onClickScrollToBottom,
    onClickAdvanceApproval,
    registerPendingApprovalRef,
  };
}
