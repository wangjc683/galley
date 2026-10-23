import { useEffect, useState, type Ref } from "react";

import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
import { TYPING_DOT_EM, TYPING_DOT_GAP_EM } from "@/lib/assistant-conversation";
import { assistantProgressElapsed } from "@/lib/assistant-progress";
import { useCopy } from "@/lib/i18n";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";

const DOT_STYLE = {
  width: `${TYPING_DOT_EM}em`,
  height: `${TYPING_DOT_EM}em`,
  // During its stagger delay a dot takes the loop's first frame (its low
  // opacity) instead of the full ink: no flash of the second and third
  // dot as the bubble appears.
  animationFillMode: "backwards",
} as const;

/**
 * The end of the assistant's conversation while the round runs (main
 * chat PRD rulings 107, 110; when it shows: lib/assistant-conversation.ts
 * `typingBubbleShown`): three dots in a bubble of the assistant's own
 * (AssistantBubble's ground, 12px corners and 10 / 14px padding), one
 * line of reply text high (the body size times the bubbles' leading, as
 * a one-line reply), just wide enough for the dots. They are LiveDots' (the `live-dot` loop: 1.4s, 0.16s stagger,
 * opacity rising one after another, iMessage's way), `ink-muted`, at
 * twice its size (TYPING_DOT_EM); still under reduced motion (the
 * class's own rule). Read as 「Galley 正在输入」 (`role="status"`). In a
 * round you started a line under it says what it is doing and for how
 * long (`ProgressLine`, rulings 134, 135): with the card, the only two
 * places that speak while it runs; the header says nothing then.
 *
 * The row has no top margin: the reply that takes its place stands right
 * under the row above (`assistantRowGap` gives it `mt-0` under either
 * bar row — your bubble's 30px, or the last reply's action bar), so the
 * bubble opens where the dots were (hooks/useTypingBubbleHandoff.ts).
 */
export function TypingBubble({
  ref,
  progress,
}: {
  ref?: Ref<HTMLDivElement>;
  /** The line under the dots, in a round you started (MainView); absent
   * (a round Core woke it for), the bubble alone. */
  progress?: TypingProgress | null;
}) {
  const copy = useCopy();
  return (
    <div ref={ref} data-role="assistant-typing" role="status">
      <span className="sr-only">{copy.assistant.typingLabel}</span>
      <div
        data-role="assistant-typing-bubble"
        className="w-fit rounded-md bg-assistant-tint px-3.5 py-2.5 [--conversation-body-leading:var(--conversation-bubble-leading)]"
      >
        <span
          aria-hidden
          data-role="assistant-typing-dots"
          className="flex h-[calc(1em*var(--conversation-body-leading))] items-center text-ink-muted [font-size:var(--conversation-body-size)]"
          style={{ gap: `${TYPING_DOT_GAP_EM}em` }}
        >
          <span
            className="live-dot rounded-full bg-current"
            style={DOT_STYLE}
          />
          <span
            className="live-dot rounded-full bg-current"
            style={DOT_STYLE}
          />
          <span
            className="live-dot rounded-full bg-current"
            style={DOT_STYLE}
          />
        </span>
      </div>
      {progress && <ProgressLine progress={progress} />}
    </div>
  );
}

// ---- The line under the dots ---------------------------------------------

/** What the line says (MainView): what it is doing, and the run clock. */
export interface TypingProgress {
  /** lib/assistant-progress.ts `assistantDoing`. */
  doing: string;
  /** The round's run clock (`currentRunStartedAtMs`), null before one. */
  startedAtMs: number | null;
  /** What its answered segments banked (`liveRunElapsedBaseMs`). */
  baseMs: number;
}

/**
 * 「{在做什么} · {用时}」 under the typing bubble (main chat PRD rulings
 * 134, 135): 6px under it, its left edge on the bubble's, one 18px line
 * whatever it says, no wider than a reply bubble may be. 12px `ink-soft`,
 * tabular numbers, no sweep, no motion. The doing part gives way: cut
 * with a fade when too long, the whole of it on hover (the header
 * identity row's way); 「 · 」 and the time never. Inside the bubble's
 * row, so following the bottom and the hand-off take it as part of it
 * (useTypingBubbleHandoff copies it out with the dots). The row is the
 * `status` live region: a new doing part is read out, the time, ticking
 * every second, is not (`aria-hidden`).
 */
function ProgressLine({ progress }: { progress: TypingProgress }) {
  return (
    <div
      data-role="assistant-progress"
      className={cn(
        "mt-1.5 flex h-[18px] items-center text-[12px] leading-[18px] text-ink-soft tabular-nums",
        ASSISTANT_BUBBLE_MAX,
      )}
    >
      <span
        data-role="assistant-progress-doing"
        ref={truncationFadeRef}
        onPointerEnter={(e) =>
          syncTruncatedTitle(e.currentTarget, progress.doing)
        }
        className="truncate-fade min-w-0"
      >
        {progress.doing}
      </span>
      <ProgressElapsed
        startedAtMs={progress.startedAtMs}
        baseMs={progress.baseMs}
      />
    </div>
  );
}

/**
 * 「 · 12 秒」, from the first second: `RunElapsedHud`'s figure and words,
 * kept the same way — a timer writes the time once a second, so only
 * this re-renders, and a render never reads the clock.
 */
function ProgressElapsed({
  startedAtMs,
  baseMs,
}: {
  startedAtMs: number | null;
  baseMs: number;
}) {
  const copy = useCopy();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);
  if (startedAtMs == null) return null;
  const elapsed = assistantProgressElapsed(baseMs + (now - startedAtMs), copy);
  if (!elapsed) return null;
  return (
    <span
      aria-hidden
      data-role="assistant-progress-elapsed"
      className="shrink-0 whitespace-pre"
    >
      {` · ${elapsed}`}
    </span>
  );
}
