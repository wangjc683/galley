import { useMemo, useState, type CSSProperties } from "react";

import { ExpandSection } from "@/components/conversation/ExpandSection";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { useMarkdownStream } from "@/hooks/useMarkdownStream";
import { useTypewriter } from "@/hooks/useTypewriter";
import { mendStreamingMarkdown } from "@/lib/mend-streaming-markdown";
import { thinkingPreviewTail } from "@/lib/thinking-preview";

/** Lines the clipped box shows. */
const CLIPPED_LINES = 3;

/**
 * Typewriter pace for reasoning. The answer partial creeps at 3 chars
 * a frame (~180/s), which a fast reasoning stream outruns — English
 * reasoning at 50+ tokens/s is 200+ chars/s, and a typewriter that
 * falls behind never catches up, so the box would show reasoning from
 * seconds ago. 8 a frame (~480/s) still spreads GA's ~50-char pushes
 * over a few frames instead of landing them as one jump.
 */
const TYPEWRITER_CHARS_PER_FRAME = 8;

/**
 * One line box of the thinking register. MarkdownView's thinking
 * variant sets `--conversation-thinking-leading` on its root, but its
 * paragraphs take `--conversation-body-leading` from the shared
 * PROSE_BASE rule, and reasoning is paragraphs — so a paragraph line is
 * thinking size × BODY leading (14 × 1.7 = 23.8px at the standard
 * tier), and that is the unit the box height and the fade are counted
 * in. Using the thinking leading here would cut the third line.
 */
const LINE_BOX =
  "calc(var(--conversation-thinking-size) * var(--conversation-body-leading))";

/**
 * Fixed three-line window, and the fade that retires its oldest line.
 * The fade is anchored to the TEXT's bottom edge, not the box's top:
 * transparent three lines above the newest line's bottom, opaque from
 * 2.25 lines. While the reasoning fits in two lines the band lies
 * above the text and nothing fades (a box-anchored fade would dim the
 * first line of short, top-aligned text); from the third line on the
 * top line recedes, and once the text overflows the band sits exactly
 * on the box's top edge. No measuring, no layout reads.
 */
const CLIPPED_BOX_STYLE = {
  height: `calc(${LINE_BOX} * ${CLIPPED_LINES})`,
} satisfies CSSProperties;
const TOP_FADE = `linear-gradient(to top, black calc(${LINE_BOX} * ${CLIPPED_LINES - 0.75}), transparent calc(${LINE_BOX} * ${CLIPPED_LINES}))`;
const CLIPPED_TEXT_STYLE = {
  maskImage: TOP_FADE,
  WebkitMaskImage: TOP_FADE,
} satisfies CSSProperties;

/**
 * Live reasoning under the in-flight step row (2026-09-23).
 *
 * Native reasoning used to stream as the answer partial — full width,
 * answer typography, uncapped, under a status reading 「正在回答…」 —
 * then vanish at turn_end. Reasoning is process material, so it takes
 * the thinking register instead (MarkdownView "thinking": italic
 * serif, ink-soft), in the same column the settled DetailPanel uses
 * behind the step caret: what the reader watched live is the same text
 * in the same style they find again once the step settles.
 *
 * Shape: a fixed three-line window, newest text at the bottom, older
 * lines clipped at the top behind a fade. While the reasoning is still
 * short it reads from the top, like the DetailPanel, and only starts
 * rolling once it overflows. Not expandable, not interactive, hidden
 * from assistive tech — the full text is behind the settled step's
 * caret. Enters and leaves through ExpandSection (0fr sweep; reduced
 * motion drops the transition there). Three lines, gone once the
 * reasoning ends: JC's pick after comparing in the real app
 * (2026-09-23).
 *
 * No streaming caret or block fade-in (`streaming-prose`): the status
 * row's shimmer and the rolling lines already say "live", and the
 * process register stays the quieter of the two streams.
 *
 * `text` going empty keeps the last reasoning on screen for the
 * collapse sweep instead of emptying the box as it closes.
 */
export function ThinkingPreview({
  text,
  visible,
}: {
  /** Live reasoning text (extractLiveThinking). */
  text: string;
  /** Whether the box is shown; the caller owns the collapse rule. */
  visible: boolean;
}) {
  // Keep-last for the collapse sweep. The caller collapses the box when
  // the reasoning block closes, and usually the text is still in the
  // in-flight buffer for the whole sweep. But the in-flight row outlives
  // each step and turn_end clears that buffer, so a block that closes
  // just before the step ends — a quick tool call and its turn_end
  // inside the sweep, or the closing tag and turn_end landing in one
  // batch — would otherwise empty the box while it is still closing.
  // Guarded setState-in-render, same pattern as ExpandSection /
  // useElapsedDeciseconds: the held value has to be current in THIS
  // render, before the buffer that fed it is gone.
  const [held, setHeld] = useState(text);
  if (text !== "" && text !== held) setHeld(text);
  const shown = text || held;
  return (
    <ExpandSection open={visible && shown !== ""}>
      {/* The DetailPanel's column: the in-flight StepRegion already
          insets one gutter, this is the marker's own ordinal gutter,
          so the reasoning starts where the settled step's summary and
          DetailPanel text start. */}
      <div className="pl-(--step-gutter)" aria-hidden>
        <ThinkingPreviewText text={shown} />
      </div>
    </ExpandSection>
  );
}

function ThinkingPreviewText({ text }: { text: string }) {
  // Same pipeline as MainView's answer partial: typewriter over the
  // full text (a tail slice would stop being a prefix of the previous
  // one and snap the typewriter), then only the tail the box can show,
  // then a ~20 Hz markdown commit, then the display-only mend.
  const typed = useTypewriter(text, TYPEWRITER_CHARS_PER_FRAME);
  const windowed = useMemo(() => thinkingPreviewTail(typed), [typed]);
  const throttled = useMarkdownStream(windowed);
  const source = useMemo(() => mendStreamingMarkdown(throttled), [throttled]);

  return (
    <div className="relative overflow-hidden" style={CLIPPED_BOX_STYLE}>
      {/* Bottom-anchored and at least the box's height: short text
          reads from the top, long text grows upward past the box's
          top edge and is clipped there. */}
      <div className="absolute inset-x-0 bottom-0 min-h-full">
        <div style={CLIPPED_TEXT_STYLE}>
          <MarkdownView
            source={source}
            variant="thinking"
            className="pointer-events-none select-none"
            streaming
          />
        </div>
      </div>
    </div>
  );
}
