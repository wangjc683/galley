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

const TYPOGRAPHY_VARS: Record<
  ConversationFontSize,
  CSSProperties & Record<`--conversation-${string}`, string>
> = {
  small: {
    "--conversation-body-size": "13.5px",
    "--conversation-body-leading": "1.65",
    "--conversation-composer-size": "13.5px",
    "--conversation-thinking-size": "13px",
    "--conversation-thinking-leading": "1.5",
    "--conversation-step-size": "11.5px",
    "--conversation-tool-label-size": "11.5px",
    "--conversation-tool-mono-size": "10.5px",
    "--conversation-code-size": "12px",
    "--conversation-echo-size": "12.5px",
    "--conversation-heading-1-size": "20px",
    "--conversation-heading-2-size": "17.5px",
    "--conversation-heading-3-size": "15.5px",
    "--conversation-heading-4-size": "14px",
    "--conversation-table-size": "13px",
    "--conversation-goal-narration-size": "12.5px",
    "--conversation-goal-narration-leading": "1.55",
  },
  standard: {
    "--conversation-body-size": "15px",
    "--conversation-body-leading": "1.7",
    "--conversation-composer-size": "14.5px",
    "--conversation-thinking-size": "14px",
    "--conversation-thinking-leading": "1.55",
    "--conversation-step-size": "12px",
    "--conversation-tool-label-size": "12px",
    "--conversation-tool-mono-size": "11px",
    "--conversation-code-size": "13px",
    "--conversation-echo-size": "13px",
    "--conversation-heading-1-size": "22px",
    "--conversation-heading-2-size": "19px",
    "--conversation-heading-3-size": "17px",
    "--conversation-heading-4-size": "15.5px",
    "--conversation-table-size": "14px",
    "--conversation-goal-narration-size": "13px",
    "--conversation-goal-narration-leading": "1.6",
  },
  large: {
    "--conversation-body-size": "16.5px",
    "--conversation-body-leading": "1.75",
    "--conversation-composer-size": "16px",
    "--conversation-thinking-size": "15.5px",
    "--conversation-thinking-leading": "1.6",
    "--conversation-step-size": "12.5px",
    "--conversation-tool-label-size": "12.5px",
    "--conversation-tool-mono-size": "11.5px",
    "--conversation-code-size": "14.5px",
    "--conversation-echo-size": "14.5px",
    "--conversation-heading-1-size": "24px",
    "--conversation-heading-2-size": "21px",
    "--conversation-heading-3-size": "18.5px",
    "--conversation-heading-4-size": "17px",
    "--conversation-table-size": "15.5px",
    "--conversation-goal-narration-size": "14.5px",
    "--conversation-goal-narration-leading": "1.65",
  },
};

export function conversationTypographyStyle(
  size: ConversationFontSize,
): CSSProperties {
  return TYPOGRAPHY_VARS[size];
}
