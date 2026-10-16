import type { CSSProperties } from "react";

export const CONVERSATION_FONT_SIZE_VALUES = [
  "small",
  "standard",
  "large",
] as const;

export type ConversationFontSize =
  (typeof CONVERSATION_FONT_SIZE_VALUES)[number];

export function isConversationFontSize(
  value: unknown,
): value is ConversationFontSize {
  return (
    value === "small" || value === "standard" || value === "large"
  );
}

/** One tier up (`1`) or down (`-1`), clamped at the ends — what
 * ⌘= / ⌘− and the View menu's Bigger / Smaller do. */
export function stepConversationFontSize(
  size: ConversationFontSize,
  direction: 1 | -1,
): ConversationFontSize {
  const index = CONVERSATION_FONT_SIZE_VALUES.indexOf(size) + direction;
  const last = CONVERSATION_FONT_SIZE_VALUES.length - 1;
  return CONVERSATION_FONT_SIZE_VALUES[Math.min(Math.max(index, 0), last)];
}

/**
 * `--conversation-block-gap` is the base unit for markdown's vertical
 * rhythm — every block margin in `MarkdownView`'s `PROSE_BASE` is a
 * multiple of it (ratio ladder documented there). It belongs in this
 * table, not in a fixed Tailwind class, because the gap has to track the
 * line box or the document's density drifts across the three tiers.
 *
 * Before 2026-08-12 every markdown margin was a hardcoded px value while
 * size and leading scaled, so paragraph separation measured against the
 * line box ran 0.54 line at `small` and 0.42 at `large`: asking for a
 * bigger face made the document *tighter*, the opposite of the request.
 * The values below hold that ratio near 0.47 across all three tiers.
 *
 * The main chat's two bubbles take a tighter leading and gap of their own
 * (`assistantBubbleTextStyle`, below); everything else reads these.
 */
const TYPOGRAPHY_VARS: Record<
  ConversationFontSize,
  CSSProperties & Record<`--conversation-${string}`, string>
> = {
  small: {
    "--conversation-body-size": "13.5px",
    "--conversation-block-gap": "10.5px",
    "--conversation-body-leading": "1.65",
    "--conversation-composer-size": "13.5px",
    "--conversation-thinking-size": "13px",
    "--conversation-thinking-leading": "1.5",
    "--conversation-step-size": "11.5px",
    "--conversation-tool-label-size": "10.5px",
    "--conversation-tool-mono-size": "10.5px",
    "--conversation-code-size": "12px",
    "--conversation-echo-size": "12.5px",
    "--conversation-heading-1-size": "20px",
    "--conversation-heading-2-size": "17.5px",
    "--conversation-heading-3-size": "15.5px",
    "--conversation-heading-4-size": "14px",
    "--conversation-table-size": "13px",
    "--conversation-narration-size": "12.5px",
    "--conversation-narration-leading": "1.55",
  },
  standard: {
    "--conversation-body-size": "15px",
    "--conversation-block-gap": "12px",
    "--conversation-body-leading": "1.7",
    "--conversation-composer-size": "14.5px",
    "--conversation-thinking-size": "14px",
    "--conversation-thinking-leading": "1.55",
    "--conversation-step-size": "12px",
    "--conversation-tool-label-size": "11px",
    "--conversation-tool-mono-size": "11px",
    "--conversation-code-size": "13px",
    "--conversation-echo-size": "13px",
    "--conversation-heading-1-size": "22px",
    "--conversation-heading-2-size": "19px",
    "--conversation-heading-3-size": "17px",
    "--conversation-heading-4-size": "15.5px",
    "--conversation-table-size": "14px",
    "--conversation-narration-size": "13px",
    "--conversation-narration-leading": "1.6",
  },
  large: {
    "--conversation-body-size": "16.5px",
    "--conversation-block-gap": "13.5px",
    "--conversation-body-leading": "1.75",
    "--conversation-composer-size": "16px",
    "--conversation-thinking-size": "15.5px",
    "--conversation-thinking-leading": "1.6",
    "--conversation-step-size": "12.5px",
    "--conversation-tool-label-size": "11.5px",
    "--conversation-tool-mono-size": "11.5px",
    "--conversation-code-size": "14.5px",
    "--conversation-echo-size": "14.5px",
    "--conversation-heading-1-size": "24px",
    "--conversation-heading-2-size": "21px",
    "--conversation-heading-3-size": "18.5px",
    "--conversation-heading-4-size": "17px",
    "--conversation-table-size": "15.5px",
    "--conversation-narration-size": "14.5px",
    "--conversation-narration-leading": "1.65",
  },
};

export function conversationTypographyStyle(
  size: ConversationFontSize,
): CSSProperties {
  return TYPOGRAPHY_VARS[size];
}

/**
 * The main chat's bubbles set their text a step tighter than the
 * workbench's prose (telegram-details PRD ruling 8, after JC's 「主对话信息
 * 稍微有点密度不够」 in a live test; he compared four options live and took
 * this one, ticket 10).
 * The size stays the tier's; the leading drops 0.15 and the paragraph gap
 * follows the smaller line box:
 *
 *              small         standard       large
 *   workbench  13.5 / 1.65   15 / 1.7       16.5 / 1.75    gap 10.5 / 12 / 13.5
 *   bubbles    13.5 / 1.5    15 / 1.55      16.5 / 1.6     gap  9.5 / 10.5 / 12.5
 *
 * The gaps hold about 0.47 of the line box, as the tier table above does
 * (standard sits at 0.45, the value compared live). A bubble is a short
 * IM message in a narrow column (about 42 characters a line at 760), not
 * a page of a document, so 1.7 left it airy.
 *
 * Only the text in the two bubbles takes it: the main chat's column carries
 * `assistantBubbleTextStyle` and `ASSISTANT_BUBBLE_TEXT_CLASS`, which
 * re-declares the tier's variables on the assistant's bubble
 * (`data-role="assistant-bubble"`, AssistantParts: its replies, the
 * greeting, its questions, a report round's reply; the leading and the
 * gap, for its markdown) and the user's (`data-role^="user-msg"`,
 * MessageUser: the leading; it has no paragraphs). Everything else in the
 * column keeps the tier's values: the process and subtask cards, the line
 * while it works, the time lines, the candidates under a question, a run
 * drawn in full or a /btw exchange; inside a bubble the headings, code and
 * tables keep their sizes (their margins are multiples of the gap, so they
 * follow it), and so do the quotes atop the user's bubble. The workbench
 * and the composer are not touched.
 */
const ASSISTANT_BUBBLE_TEXT_VARS: Record<
  ConversationFontSize,
  CSSProperties & Record<`--conversation-bubble-${string}`, string>
> = {
  small: {
    "--conversation-bubble-leading": "1.5",
    "--conversation-bubble-block-gap": "9.5px",
  },
  standard: {
    "--conversation-bubble-leading": "1.55",
    "--conversation-bubble-block-gap": "10.5px",
  },
  large: {
    "--conversation-bubble-leading": "1.6",
    "--conversation-bubble-block-gap": "12.5px",
  },
};

export function assistantBubbleTextStyle(
  size: ConversationFontSize,
): CSSProperties {
  return ASSISTANT_BUBBLE_TEXT_VARS[size];
}

/** The main chat's column: its two bubbles take the bubble values. */
export const ASSISTANT_BUBBLE_TEXT_CLASS = [
  "[&_[data-role=assistant-bubble]]:[--conversation-body-leading:var(--conversation-bubble-leading)]",
  "[&_[data-role=assistant-bubble]]:[--conversation-block-gap:var(--conversation-bubble-block-gap)]",
  "[&_[data-role^=user-msg]]:[--conversation-body-leading:var(--conversation-bubble-leading)]",
].join(" ");
