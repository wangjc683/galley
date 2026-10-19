import type { Ref } from "react";

import { TYPING_DOT_EM, TYPING_DOT_GAP_EM } from "@/lib/assistant-conversation";
import { useCopy } from "@/lib/i18n";

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
 * class's own rule). Read as 「Galley 正在输入」 (`role="status"`).
 *
 * The row has no top margin: the reply that takes its place stands right
 * under the row above (`assistantRowGap` gives it `mt-0` under either
 * bar row — your bubble's 30px, or the last reply's action bar), so the
 * bubble opens where the dots were (hooks/useTypingBubbleHandoff.ts).
 */
export function TypingBubble({ ref }: { ref?: Ref<HTMLDivElement> }) {
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
    </div>
  );
}
