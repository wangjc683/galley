import { useEffect, useState, type ReactNode, type Ref } from "react";

import { assistantLineClock } from "@/lib/assistant-conversation";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
 * The pieces only the assistant's conversation draws (rules in
 * lib/assistant-conversation.ts; spec: conversation.md 「助手的对话」):
 * its bubble and the one line while it works. The card its process
 * button opens is AssistantProcessCard (the button itself is a chip of
 * the reply's action bar, MessageActions). The centred time it drew
 * first is both conversations' now (MessageTimeDivider).
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

/**
 * The one line at the conversation's end while the round runs: the
 * latest sentence it wrote, or 「思考中」; past 3s the round's clock —
 * the corner clock's own number and words, which the assistant's
 * conversation does not show, so the time shows once. The thinking
 * row's register (12px sans, ink-soft) and its shimmer as the busy
 * cue, not a typing bubble. Cut to one line. When its bubble takes its
 * place, the bubble grows out of it (`ref`: MainView keeps where it
 * stands, hooks/useLiveLineHandoff.ts).
 *
 * Its `mt-5` adds nothing under your bubble (ruling 105, ticket 53):
 * that row's bottom margin is the 30px its hover chips sit in
 * (MessageUser `mb-7.5`), and the two collapse — through the end of the
 * conversation's root, the line's sibling in the column — so the line
 * stands 30px under your bubble, where the reply that takes its place
 * stands (`assistantRowGap` gives that reply `mt-0`), and the hand-off
 * starts from the bubble's own top edge as before. In a round Core woke
 * it for there is no bubble of yours: under a reply's action bar,
 * which is in flow, the line keeps its 20px.
 */
export function AssistantLiveLine({
  sentence,
  startedAtMs,
  baseMs,
  ref,
}: {
  sentence: string | null;
  startedAtMs: number | null;
  baseMs: number;
  ref?: Ref<HTMLDivElement>;
}) {
  const copy = useCopy();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);
  const clock =
    startedAtMs != null
      ? assistantLineClock(baseMs + (now - startedAtMs), copy)
      : null;
  const text = sentence ?? copy.conversation.thinking.replace(/[.…]+$/, "");
  return (
    <div
      ref={ref}
      data-role="assistant-live-line"
      className="mt-5 flex min-w-0 items-baseline gap-1.5 leading-[1.6] text-ink-soft [font-size:var(--conversation-step-size)]"
    >
      <span className="thinking-shimmer min-w-0 truncate">{text}</span>
      {clock && (
        <span className="shrink-0 tabular-nums text-ink-muted">{`· ${clock}`}</span>
      )}
    </div>
  );
}
