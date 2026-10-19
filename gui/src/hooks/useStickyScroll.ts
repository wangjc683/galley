import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  animateScroll,
  prefersReducedMotion,
  scrollDestination,
  type ScrollAnimation,
} from "@/lib/animate-scroll";
import {
  assistantFollowBottom,
  assistantFollowTop,
  assistantReplyStart,
  assistantScrollToBottom,
} from "@/lib/assistant-conversation";
import { chaseBottom } from "@/lib/chase-bottom";
import { altArrowBelongsToField } from "@/lib/composer-focus";
import {
  USER_MSG_ANCHOR_TOLERANCE_PX,
  USER_MSG_ANCHOR_TOP_PX,
  timeLineAbove,
  userMsgParkOffset,
} from "@/lib/conversation-anchor";
import {
  ASK_USER_SETTLE_MS,
  type LiveTail,
  startLiveTail,
  submitScroll,
} from "@/lib/live-tail";
import { landingScrollTiming } from "@/lib/live-line-handoff";
import { keepBottomOnViewportResize } from "@/lib/viewport-resize";
import { turnsHoldMessage, useMessagesStore } from "@/stores/messages";
import { type LocateRequest, useUiStore } from "@/stores/ui";
import type { PendingAskUser } from "@/types/conversation";

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
/** A user message's bubble, a run opener or an ask_user reply. */
const USER_MSG_SELECTOR =
  '[data-role="user-msg"], [data-role="user-msg-reply"]';

/**
 * The last `userSubmitTick` a mounted hook scrolled for. MainView
 * remounts per session (App keys it by session id) and the tick is
 * global, so a remount used to re-run the last send's scroll in the
 * session just opened: it parked that session's last user message, and
 * with ticket 06 it would also have put a blank under it and stopped
 * following. Written when the frame runs, not in the effect: StrictMode
 * runs a mount's effect twice and cancels the first frame.
 */
let scrolledForSubmitTick = 0;

/** Within this of the bottom counts as at the bottom (px): the scroll
 * listener's tolerance. */
const AT_BOTTOM_PX = 24;

/**
 * The main chat's follow for the landing its live line hands over to
 * (ticket 51, lib/live-line-handoff.ts): the same target as every
 * follow (`assistantFollowTop`), reached on the growth's clock instead
 * of at once, so the bubble opens where the line was. While it runs,
 * the follow paths re-aim it rather than write `scrollTop` (a write
 * would make it let go), and 「at the bottom」 reads where it ends:
 * attached, or parked short at the reply's start (the button shows, as
 * after an instant park).
 */
interface Landing {
  /** The reply start's top in the scroll content, taken as it starts
   * (the transforms the hand-off puts on the column would skew a later
   * reading). Null without one. */
  startY: number | null;
  /** It ends within AT_BOTTOM_PX of the bottom. */
  attached: boolean;
  animation: ScrollAnimation | null;
}

function landingTarget(
  el: HTMLElement,
  startY: number | null,
): { top: number; attached: boolean } {
  const { top } = assistantFollowTop({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    replyStartOffset: startY === null ? null : startY - el.scrollTop,
    anchor: USER_MSG_ANCHOR_TOP_PX,
  });
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
  return { top, attached: bottom - top < AT_BOTTOM_PX };
}

/** Starts the landing's follow; false when it cannot run smoothly
 * (reduced motion, the tokens unreadable) — then the follow is the
 * usual instant one. */
function startLanding(
  el: HTMLElement,
  landingRef: { current: Landing | null },
): boolean {
  const timing = landingScrollTiming();
  if (!timing || prefersReducedMotion()) return false;
  const previous = landingRef.current;
  landingRef.current = null;
  previous?.animation?.cancel();
  const start = assistantReplyStart(el);
  const startY = start
    ? start.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    : null;
  const { top, attached } = landingTarget(el, startY);
  const landing: Landing = { startY, attached, animation: null };
  landingRef.current = landing;
  landing.animation = animateScroll(
    el,
    top,
    () => {
      // Not when a newer landing or the unmount took over.
      if (landingRef.current !== landing) return;
      landingRef.current = null;
      el.dispatchEvent(new Event("scroll"));
    },
    timing,
  );
  // Parked short: following stops now, as with an instant park (a
  // scroll event, since setState stays out of effects).
  if (!attached && landingRef.current === landing) {
    el.dispatchEvent(new Event("scroll"));
  }
  return true;
}

/** The tail grew or shrank under a running landing: same rule, new
 * target, same end time. */
function retargetLanding(el: HTMLElement, landing: Landing): void {
  const { top, attached } = landingTarget(el, landing.startY);
  landing.attached = attached;
  const animation = landing.animation;
  if (animation && !animation.ended && Math.abs(top - animation.target) >= 1) {
    animation.retarget(top);
  }
}

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
 *     scrolled up to read older content), and while the composer
 *     below grows or shrinks
 *   - the floating scroll-to-bottom button + its chase of the bottom
 *     (lib/chase-bottom.ts)
 *   - scroll-to-bottom on session switch (race-hardened against async
 *     SQLite restore, Shiki reflow, and WKWebView repaint skips)
 *   - stick-to-user-message-top on submit (the assistant's
 *     conversation sticks to the bottom instead, `stickBottom`)
 *   - ⌥↑ / ⌥↓ keyboard jump between user messages
 *   - the workbench's live tail after a send (lib/live-tail.ts): the
 *     message parked on its line with a blank under it, not followed —
 *     except a question the run asks, scrolled into view
 *
 * Every smooth scroll here goes through lib/animate-scroll.ts (its
 * durations, the far-jump rule, reduced motion), never the engine's
 * own smooth `scrollTo` / `scrollBy`.
 *
 * Inputs are the bottom-anchored growth / navigation triggers the
 * effects depend on; the component owns the DOM these refs point at.
 */
export function useStickyScroll({
  activeSessionId,
  userSubmitTick,
  streamingContent,
  turnsLength,
  pendingAskUser,
  restoring = false,
  stickBottom = false,
  landingTick = 0,
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
  /** GA-initiated question; its appearance grows the doc tail. */
  pendingAskUser?: PendingAskUser | null;
  /**
   * The assistant's 贴底 (the main chat only, lib/assistant-
   * conversation.ts): a send goes to the bottom instead of parking the
   * message at the top, and following the growth stops before the
   * reply's start leaves the viewport (`assistantFollowTop`). Session
   * switches and 「回到底部」 still land on the bottom itself.
   */
  stickBottom?: boolean;
  /**
   * Bumped by MainView in the commit where the main chat's live line
   * hands over to its bubble (ticket 51): that commit's follow is smooth,
   * on the growth's clock (`Landing` above). Not following then (you
   * are reading further up): nothing scrolls, as before.
   */
  landingTick?: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(stickBottom);
  useEffect(() => {
    stickBottomRef.current = stickBottom;
  }, [stickBottom]);

  // Sticky-bottom mode for streaming: when the user is "near the
  // bottom" we follow newly-arrived chunks; if they've scrolled up
  // to read older content we don't yank them down.
  //
  // `atBottom` is the currently-tracked position; updated on scroll
  // events with a 24px tolerance so flicker around the boundary
  // doesn't toggle the mode.
  const [atBottom, setAtBottom] = useState(true);
  const [isScrollingToBottom, setIsScrollingToBottom] = useState(false);
  /** Stops the running 「回到底部」 chase, if any. */
  const stopChaseRef = useRef<(() => void) | null>(null);
  /** The workbench's live tail after a send (ticket 06); null in the
   * main chat, after a session switch (MainView remounts) and before the
   * first send. While it holds `noFollow`, the follow paths below stand
   * down. */
  const tailRef = useRef<LiveTail | null>(null);
  /** Observes what the tail measures from (the viewport, the rows above
   * its anchor); set up once below. */
  const tailObserverRef = useRef<ResizeObserver | null>(null);
  /** The main chat's landing in flight (ticket 51), and the hand-off it
   * last saw. */
  const landingRef = useRef<Landing | null>(null);
  const landedTickRef = useRef(landingTick);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      // Mid-landing the position is on its way: read where it ends.
      const landing = landingRef.current;
      if (landing) {
        setAtBottom(landing.attached);
        return;
      }
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(distFromBottom < 24);
      tailRef.current?.onScroll();
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
    // A hand-off is seen once, followed or not: one that landed while
    // you read further up does not play when you come back down.
    const landed = stickBottom && landingTick !== landedTickRef.current;
    landedTickRef.current = landingTick;
    if (!atBottom) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    if (stickBottom) {
      // The landing: the same target, on the growth's clock.
      if (landed && startLanding(el, landingRef)) return;
      if (landingRef.current) {
        retargetLanding(el, landingRef.current);
        return;
      }
      // Parked short of the bottom: the scroll listener drops follow
      // mode (a scroll event, since setState stays out of effects).
      if (assistantFollowBottom(el, USER_MSG_ANCHOR_TOP_PX)) {
        el.dispatchEvent(new Event("scroll"));
      }
      return;
    }
    // The workbench's live tail: the run grows into the blank and past
    // it without moving the viewport.
    if (tailRef.current?.noFollow) return;
    el.scrollTop = el.scrollHeight;
  }, [
    streamingContent,
    atBottom,
    turnsLength,
    pendingAskUser,
    stickBottom,
    landingTick,
  ]);

  // The click's intent is "attach to the tail", not "scroll to the
  // coordinate the tail happened to be at" — lib/chase-bottom.ts re-aims
  // while the bottom grows, lets go if the user pulls up mid-way, and
  // past 1600ms writes the bottom and attaches.
  const onClickScrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    stopChaseRef.current?.();
    setIsScrollingToBottom(true);
    stopChaseRef.current = chaseBottom(el, (attached) => {
      stopChaseRef.current = null;
      setIsScrollingToBottom(false);
      setAtBottom(attached);
    });
  };

  useEffect(
    () => () => {
      stopChaseRef.current?.();
      stopChaseRef.current = null;
      const landing = landingRef.current;
      landingRef.current = null;
      landing?.animation?.cancel();
    },
    [],
  );

  // atBottom mirror for use inside async callbacks (ResizeObserver
  // below) where the captured closure would otherwise see a stale
  // boolean. The effect-based sync (rather than a render-phase
  // assignment) keeps the react-hooks lint rule happy.
  const atBottomRef = useRef(atBottom);
  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  // Follow-the-bottom for growth that happens BETWEEN commits: the
  // live window's sweeps (a landing step growing from 0fr, the
  // departing one closing, the settling collapse), DetailPanel / pill
  // expansions, Shiki reflow — all CSS transitions or async layout
  // that move the bottom after the layout effect above has already
  // snapped. With the 2026-09-16 window a step that lands taller
  // than the one it displaces grew the document by the difference
  // over 240ms with nothing re-pinning it, and the thinking row
  // ended up under the composer (JC's live report). A permanent
  // ResizeObserver on the inner column re-pins on every size change
  // while the user is at the bottom; callbacks run after layout and
  // before paint, so each transition frame lands pinned. Gated on
  // atBottomRef like the session-switch window below, so a reader
  // who scrolled up is never yanked. Writes to an unchanged
  // scrollTop are free.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const inner = el.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => {
      if (tailRef.current?.noFollow) {
        // Not following (the live tail): nothing scrolls, so no scroll
        // event says the run has outgrown the screen. Read where the
        // bottom is now for the 「回到底部」 button.
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        return;
      }
      if (!atBottomRef.current) return;
      if (stickBottomRef.current) {
        // A landing running: re-aim it (a write would end it).
        if (landingRef.current) {
          retargetLanding(el, landingRef.current);
          return;
        }
        if (assistantFollowBottom(el, USER_MSG_ANCHOR_TOP_PX)) {
          setAtBottom(false);
        }
        return;
      }
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Follow-the-bottom when the viewport itself changes height: the
  // composer under it grows a line at a time as the user types (a
  // session's one-line composer starts at 48px), image tiles or the
  // queue strip come in, the window gets shorter. The content does not
  // change size, so neither follow above fires, and a conversation that
  // sat at the bottom would lose its last lines under the composer. A
  // bottom that was in view stays in view; a reader who scrolled up is
  // left alone (lib/viewport-resize.ts, ticket 27). Both conversations:
  // the assistant's follow limit is for a growing reply, not this.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    return keepBottomOnViewportResize(
      el,
      () => atBottomRef.current && !tailRef.current?.noFollow,
    );
  }, []);

  // The live tail's own measuring (lib/live-tail.ts): when the viewport
  // changes height (the composer, the window) the blank is refitted and
  // a parked message stays on its line — before paint, so the frame in
  // between never shows. When the rows above the anchor change (a page
  // prepended, late layout above) it is refitted on the next frame: a
  // size written from that callback would be shallower than what it
  // observed, which ResizeObserver reports as a loop. A tail whose
  // anchor is gone ends; the button reads where the bottom is then.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      const tail = tailRef.current;
      if (!tail) return;
      if (!tail.refresh()) {
        tailRef.current = null;
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }
    };
    const observer = new ResizeObserver((entries) => {
      if (!tailRef.current) return;
      if (entries.some((entry) => entry.target === el)) {
        if (frame !== null) cancelAnimationFrame(frame);
        refresh();
      } else if (frame === null) {
        frame = requestAnimationFrame(refresh);
      }
    });
    observer.observe(el);
    tailObserverRef.current = observer;
    return () => {
      observer.disconnect();
      tailObserverRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

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
        // A send right after the switch (the first message of a new
        // session) starts the live tail, which follows nothing.
        if (!atBottomRef.current || tailRef.current?.noFollow) {
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
  //
  // In the workbench a send from the composer parks with a blank under
  // it so that offset is always reachable, and the run is not followed
  // (the live tail, lib/live-tail.ts `submitScroll` for who gets what).
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
      const fresh = userSubmitTick > scrolledForSubmitTick;
      scrolledForSubmitTick = Math.max(scrolledForSubmitTick, userSubmitTick);
      // 贴底: the message lands right above the composer and following
      // picks up from there.
      if (stickBottomRef.current) {
        assistantScrollToBottom(container);
        setAtBottom(true);
        return;
      }
      // A remount for a session switch: the send was scrolled for (or
      // went to another session); the switch lands at the bottom.
      if (!fresh) return;
      const userMsgs = container.querySelectorAll<HTMLElement>(
        '[data-role="user-msg"], [data-role="user-msg-reply"]',
      );
      const last = userMsgs[userMsgs.length - 1];
      if (!last) return;
      const plan = submitScroll(
        useMessagesStore.getState().lastSubmitSource,
        atBottomRef.current,
      );
      if (plan === "none") return;
      const column = container.firstElementChild;
      if (
        (plan === "tail" || plan === "blank") &&
        column instanceof HTMLElement
      ) {
        tailRef.current?.stop();
        tailRef.current = startLiveTail(container, column, last, {
          park: plan === "tail",
        });
        const rows = last.closest('[data-role="conversation"]');
        if (rows) tailObserverRef.current?.observe(rows);
        return;
      }
      if (plan === "park-follow") tailRef.current?.resumeFollowing();
      // The bubble's top on the anchor line, or the time line right
      // above it at its own (lib/conversation-anchor.ts).
      const delta = userMsgParkOffset(
        last,
        container.getBoundingClientRect().top,
      );
      if (Math.abs(delta) < 1) return;
      animateScroll(container, container.scrollTop + delta);
    });
    return () => cancelAnimationFrame(handle);
  }, [userSubmitTick]);

  // A question the run asks while the workbench's live tail holds
  // following off (ticket 09, PRD ruling 2a): it holds the round until
  // you answer, so one that lands out of view is scrolled into view —
  // unless you are above this round reading something earlier
  // (`LiveTail.reveal`). Kept in view for ASK_USER_SETTLE_MS while the
  // round settles around it (the run stops right after it asks and its
  // region re-renders above it), unless you scroll meanwhile. Following
  // stays off. A question already on screen when this mounts (a session
  // opened at it) is not new; the main chat and a round that follows
  // (a CLI or supervisor send, or after you re-attached) keep the
  // follow rules. The question seen is written when the frame runs:
  // StrictMode runs a mount's effect twice and cancels the first frame.
  const askedRef = useRef(pendingAskUser);
  useEffect(() => {
    if (!pendingAskUser || pendingAskUser === askedRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const asked = pendingAskUser;
    let frame: number | null = null;
    let until = 0;
    const keep = () => {
      frame = null;
      const tail = tailRef.current;
      if (stickBottomRef.current || !tail) return;
      const question = el.querySelector('[data-role="ask-user-bubble"]');
      const rounds = el.querySelectorAll(USER_MSG_SELECTOR);
      const round = rounds[rounds.length - 1];
      if (!question || !round) return;
      const outcome = tail.reveal(question, round, asked);
      if (outcome !== "scrolling" && outcome !== "visible") return;
      if (performance.now() < until) frame = requestAnimationFrame(keep);
    };
    frame = requestAnimationFrame(() => {
      askedRef.current = asked;
      until = performance.now() + ASK_USER_SETTLE_MS;
      keep();
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [pendingAskUser]);

  // ⌥↑ / ⌥↓ jump to previous / next user message. The user-msg
  // block is now a strong visual anchor (apricot fill, see 2026-05-14
  // commit) — power users in long conversations want a fast keyboard
  // path between their own questions without trackpad-scrolling
  // through dozens of agent steps.
  //
  // Bound to document, not the container — the conversation column
  // doesn't take focus naturally (it isn't tabbable). We bail out
  // when an editable element is focused so we don't steal Option+Up
  // from text-cursor-by-paragraph navigation inside Composer — except
  // an empty composer, which has no caret to move and is where focus
  // nearly always is (telegram-details ticket 03).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      if (altArrowBelongsToField(document.activeElement)) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      const userMsgs = Array.from(
        container.querySelectorAll<HTMLElement>('[data-role="user-msg"]'),
      );
      if (userMsgs.length === 0) return;

      const containerTop = container.getBoundingClientRect().top;
      const tolerance = USER_MSG_ANCHOR_TOLERANCE_PX;
      // Mid-jump, pick from where the jump is headed, so a second press
      // goes one message further instead of re-aiming at the same one.
      const ahead =
        (scrollDestination(container) ?? container.scrollTop) -
        container.scrollTop;

      // How far each message is from where it parks (its bubble on the
      // anchor line, or the time line right above it at its own):
      // positive below, negative above.
      const offsets = userMsgs.map(
        (el) => userMsgParkOffset(el, containerTop) - ahead,
      );

      let target: number | undefined;
      if (e.key === "ArrowDown") {
        // Next user-msg parking below the current anchor line.
        target = offsets.findIndex((offset) => offset > tolerance);
        if (target < 0) target = undefined;
      } else {
        // Previous user-msg parking above the current anchor line.
        for (let i = userMsgs.length - 1; i >= 0; i--) {
          if (offsets[i] < -tolerance) {
            target = i;
            break;
          }
        }
      }
      if (target === undefined) return;

      e.preventDefault();
      // Off follow-the-bottom before the jump's first frame, as the
      // rail's `onJump` does: a streaming chunk's snap would move
      // scrollTop under the animation, and it lets go of a position
      // someone else moved. Landing at the bottom re-attaches through
      // the scroll listener.
      setAtBottom(false);
      animateScroll(container, container.scrollTop + ahead + offsets[target]);
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
  // The request whose target this hook is reading earlier pages for.
  const pagingForRef = useRef<LocateRequest | null>(null);
  useEffect(() => {
    if (!locateRequest) return;
    if (locateRequest.sessionId !== activeSessionId) return;
    if (restoring || turnsLength === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    // A target in history not loaded yet (paged history, main-chat
    // ticket 12): read earlier pages until it is in — each page landing
    // re-runs this effect — then locate it as below. Nothing earlier
    // left and still absent: give up as for a node that never appears.
    const messages = useMessagesStore.getState();
    const slice = messages.byId[locateRequest.sessionId];
    if (
      slice?.earlier &&
      !turnsHoldMessage(slice.turns, locateRequest.messageId)
    ) {
      if (pagingForRef.current !== locateRequest) {
        pagingForRef.current = locateRequest;
        void messages
          .loadEarlierThrough(locateRequest.sessionId, locateRequest.messageId)
          .then((held) => {
            if (
              !held &&
              useUiStore.getState().locateRequest === locateRequest
            ) {
              clearLocate();
            }
          });
      }
      return;
    }

    let frames = 0;
    let rafId: number | null = null;
    let flashTimer: number | null = null;
    let observer: ResizeObserver | null = null;
    let observerTimer: number | null = null;
    const selector = `[data-message-id="${CSS.escape(locateRequest.messageId)}"]`;

    // Park the first term occurrence when there is one — a long answer
    // can carry the match hundreds of px below the block's top — else
    // the block itself.
    // A user message with a time line right above it parks as every
    // other path parks it, the line in sight (lib/conversation-anchor.ts
    // `userMsgParkOffset`): its words sit a few lines under that, so
    // the term is on screen either way.
    const park = (target: HTMLElement, focal: Range | null): number => {
      const containerRect = container.getBoundingClientRect();
      const timed =
        target.matches(USER_MSG_SELECTOR) && timeLineAbove(target) !== null;
      const focalTop = (focal ?? target).getBoundingClientRect().top;
      const delta = timed
        ? userMsgParkOffset(target, containerRect.top)
        : focalTop - containerRect.top - USER_MSG_ANCHOR_TOP_PX;
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

  return {
    scrollContainerRef,
    atBottom,
    setAtBottom,
    isScrollingToBottom,
    onClickScrollToBottom,
  };
}
