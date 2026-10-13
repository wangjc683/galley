import { ChatCircleDots, Info, Target } from "@phosphor-icons/react";

import { MarkdownView } from "@/components/conversation/MarkdownView";
import { useCopy } from "@/lib/i18n";

/**
 * Standalone, non-agent-loop message — currently used for `/btw`
 * side-question replies (variant=`"side_question"`) and any future
 * slash-command confirmations like `/session.x=v`
 * (variant=`"system"`).
 *
 * Visual register splits by variant:
 *   - "side_question": warning (apricot-yellow) family —
 *     `border-warning + bg-warning/[var(--opacity-subtle)]`, header chip "侧问".
 *     Matches AskUserBubble's color vocabulary because both
 *     "你的提问" and "agent paused for you" sit in the same
 *     attention register.
 *   - "system": neutral — `border-ink-soft + bg-surface`. Catch-
 *     all for non-attention-seeking confirmations.
 *
 * Content is markdown source (the formatted reply from GA's
 * btw_cmd, or whatever the system handler emitted). We render
 * through MarkdownView so code fences / tables / emphasis all
 * resolve, with the variant=`"agent"` register inside the bubble
 * chrome.
 */
interface SystemMessageBubbleProps {
  content: string;
  variant: "side_question" | "system" | "narration";
  /**
   * Narration only: show the Galley register glyph. The renderer
   * passes `false` for the 2nd+ callout in a consecutive narration
   * cluster so a multi-beat run shows the marker once, not on every
   * line. Default true (any standalone narration keeps its glyph).
   */
  showGlyph?: boolean;
}

export function SystemMessageBubble({
  content,
  variant,
  showGlyph = true,
}: SystemMessageBubbleProps) {
  const copy = useCopy();
  if (variant === "side_question") {
    return (
      <div
        data-role="system-bubble"
        className="my-5 rounded-r-sm border-l-[3px] border-warning bg-warning/[var(--opacity-subtle)] px-4 py-2.5"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-warning">
          <ChatCircleDots size={12} weight="bold" />
          {copy.conversation.sideQuestion}
        </div>
        <MarkdownView source={content} variant="agent" />
      </div>
    );
  }
  if (variant === "narration") {
    // Galley narration is secondary running commentary, not the answer
    // to read, so it recedes: no brand-soft fill or banner header (which
    // made it the heaviest block in the thread, inverting hierarchy),
    // only a thin brand left rule + a single small Target glyph as a
    // wordless register marker, and the body softened to ink-soft. The
    // "Galley" attribution lives in the glyph's aria-label — repeating
    // the word on every beat was redundant chrome with no per-callout
    // information; the glyph still disambiguates narration from an
    // agent-answer blockquote (same brand-rule look). See DESIGN.md
    // §4.3.
    return (
      <div
        data-role="system-bubble"
        className="my-4 border-l-[3px] border-brand-strong/30 pl-4"
      >
        {showGlyph && (
          <div className="mb-1 flex items-center text-brand-strong/70">
            <Target
              size={11}
              weight="thin"
              aria-label={copy.conversation.narration}
            />
          </div>
        )}
        <MarkdownView
          source={content}
          variant="agent"
          className="[&_li]:[font-size:var(--conversation-narration-size)] [&_li]:text-ink-soft [&_p]:[font-size:var(--conversation-narration-size)] [&_p]:[line-height:var(--conversation-narration-leading)] [&_p]:text-ink-soft"
        />
      </div>
    );
  }
  return (
    <div
      data-role="system-bubble"
      className="my-5 rounded-r-sm border-l-[3px] border-ink-soft bg-surface px-4 py-2.5"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
        <Info size={12} weight="bold" />
        {copy.conversation.system}
      </div>
      <MarkdownView source={content} variant="agent" />
    </div>
  );
}
