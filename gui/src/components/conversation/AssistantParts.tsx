import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * The pieces only the assistant's conversation draws (rules in
 * lib/assistant-conversation.ts; spec: conversation.md 「助手的对话」):
 * its bubble. The typing bubble while it works is TypingBubble; the card
 * its process button opens is AssistantProcessCard (the button itself
 * is a chip of the reply's action bar, MessageActions). The centred time
 * it drew first is both conversations' now (MessageTimeDivider).
 */

/** The reply bubble's width cap: wider than the user's (its content is
 * markdown, lists and tables), but always leaving a visible margin on
 * the right (12% of a 760px column is 91px) so it still reads as the
 * left side. No pixel stop (ruling 79): the reply is what the wide
 * reading width is for (code blocks, tables), so it grows with the
 * column, to 1056 in the 1200px wide mode; the compact column never
 * reached the old 680 stop (88% of 760 is 669), so it only cancelled
 * the wide mode. The subtask cards under a reply and its process card
 * take the same cap. */
export const ASSISTANT_BUBBLE_MAX = "max-w-[88%]";

/*
 * The neutral ground is its own token, `--color-assistant-tint` (light
 * #f0f0f0 on the #faf9f8 page, ΔL* −3.2; dark #24272c on #14171a,
 * ΔL* +8.0; ΔE 12 from the apricot `brand-tint` in both themes, so the
 * two sides differ in hue, not just in lightness), so retuning the
 * hover colour, which shares the value, leaves the bubble alone. Same
 * 12px radius and padding as the user's bubble.
 *
 * Inside it, everything that sat one recess step below the page sits
 * one recess step below the bubble: inline code and code blocks move
 * from `bg-hover` / `code-surface` to `bg-line` (light ΔL* −3.1 under
 * the bubble, dark +4.6, the same direction as the page → inline code
 * step in each theme), and the code block drops its hairline, so it
 * reads as a band of the bubble rather than a box in a box. A table
 * keeps its grid lines (they are its structure) but its header row
 * drops the paper patch (`bg-surface`, lighter than the bubble) and
 * sits on the bubble; its weight still marks it. `!` because
 * MarkdownView's and CodeBlock's own rules have the same specificity.
 */
const BUBBLE = cn(
  "w-fit rounded-md bg-assistant-tint px-3.5 py-2.5",
  ASSISTANT_BUBBLE_MAX,
  "[&_:not(pre)>code]:bg-line!",
  "[&_.bg-code-surface]:border-transparent! [&_.bg-code-surface]:bg-line!",
  "[&_th]:bg-transparent!",
);

/** The assistant's side of the conversation: a reply, a question it
 * asked (live or answered), the greeting. */
export function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div data-role="assistant-bubble" className={BUBBLE}>
      {children}
    </div>
  );
}
