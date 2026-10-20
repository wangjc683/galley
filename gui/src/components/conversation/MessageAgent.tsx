import { CaretDown, XCircle } from "@phosphor-icons/react";
import { isValidElement, memo, useId, useState, type ReactNode } from "react";

import { AssistantBubble } from "@/components/conversation/AssistantParts";
import { ChatGptPlanErrorNotice } from "@/components/conversation/ChatGptPlanErrorNotice";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import { MessageActions } from "@/components/conversation/MessageActions";
import type { AssistantProcessToggle } from "@/lib/assistant-conversation";
import { findChatGptPlanError } from "@/lib/chatgpt-plan-errors";
import { useCopy } from "@/lib/i18n";
import { isLeakedToolCallMarkup } from "@/lib/ipc/ga-output-cleaning";
import { cn } from "@/lib/utils";
import type { MessageTelemetry } from "@/types/conversation";

/**
 * Final agent answer — uses the conversation body typography vars,
 * no callout chrome, and "floats in the document". Per DESIGN.md
 * §4.3 + the prototype's msg-agent style. The assistant's conversation
 * puts the same answer in a left bubble (`bubble`; see
 * lib/assistant-conversation.ts).
 *
 * Markdown rendering: a `string` child is parsed via react-markdown
 * + remark-gfm + Shiki (see MarkdownView). A pre-built ReactNode
 * passes through unchanged so demo fixtures and tests can still
 * inject hand-built content.
 *
 * Message actions (Copy / Save): only the **final** turn of a GA loop
 * run carries them — the conclusion is what users want to grab.
 * Intermediate-step narrator text ("好的，我先看一下 X" before a
 * tool_use) renders through MessageAgentNarration below so it remains
 * visible in the main flow without adopting final-answer actions.
 *
 * ReactNode demo children always skip actions — there's no canonical
 * markdown source to copy back out, and demos rarely need actions.
 *
 * The answer's hover region carries its key for the selection toolbar
 * (`data-selection-yield`, lib/selection-copy): while a selection in
 * the answer has the toolbar up, the action bar yields (main chat PRD
 * ruling 108).
 */
// Memoised: during streaming the conversation re-renders on every
// throttled chunk, but settled agent turns carry an immutable string
// child. `memo` keeps those out of the streaming reconciliation path.
export const MessageAgent = memo(function MessageAgent({
  children,
  showActions = true,
  telemetry,
  messageId,
  bubble = false,
  className,
  process,
  attachment,
}: {
  children: ReactNode;
  showActions?: boolean;
  telemetry?: MessageTelemetry;
  /** Persisted `messages.id`; rendered as `data-message-id` so a
   * palette full-text hit on this answer can scroll to it. */
  messageId?: string;
  /** The assistant's conversation: the answer sits in a left bubble on
   * the neutral ground; the action bar under it is the assistant's,
   * icons only. */
  bubble?: boolean;
  /** The answer's row margin (the assistant's IM grouping). */
  className?: string;
  /** The assistant's process button, last in the action bar: a reply of
   * two steps or more. */
  process?: AssistantProcessToggle;
  /** Between the bubble and its action row: the reply's subtask cards,
   * in the assistant's conversation. */
  attachment?: ReactNode;
}) {
  const selectionYieldKey = useId();
  if (typeof children === "string") {
    // A ChatGPT plan error the engine ended the turn with (SIWC ticket
    // 04, PRD ruling 7): Galley's words and the way on, the engine text
    // one click away. Codes without words of ours stay prose.
    const planError = findChatGptPlanError(children);
    if (planError) {
      return (
        <div
          data-message-id={messageId}
          className={cn("group/answer", className)}
        >
          {planError.before && (
            <MarkdownView source={planError.before} variant="agent" />
          )}
          <ChatGptPlanErrorNotice error={planError} />
          {attachment}
          {/* Like the protocol-failure notice: nothing to copy, quote
              or save; the process button and the assistant's ⋯ stay. */}
          {(process !== undefined || bubble) && (
            <MessageActions
              source={children}
              assistant={{ process, processOnly: true }}
              messageId={bubble ? messageId : undefined}
            />
          )}
        </div>
      );
    }
    // #22: a "final answer" that is really leaked tool-call markup
    // (`<invoke …>` returned as plain text by a proxy that never
    // produced a structured block). Prose-rendering it is unreadable
    // and looks broken; there is also no deliverable to Copy/Save.
    // Render an explanatory notice with the raw markup one click away.
    if (isLeakedToolCallMarkup(children)) {
      return process === undefined &&
        attachment === undefined &&
        className === undefined ? (
        <ProtocolFailureNotice markup={children} />
      ) : (
        // No copy, quote or save (nothing to deliver); the process button and,
        // in the assistant's conversation, the ⋯ of its message menu
        // (which a right-click on it opens too: `data-message-id`),
        // hovered in as the bar is.
        <div
          data-message-id={bubble ? messageId : undefined}
          className={cn("group/answer", className)}
        >
          <ProtocolFailureNotice markup={children} />
          {attachment}
          {(process !== undefined || bubble) && (
            <MessageActions
              source={children}
              assistant={{ process, processOnly: true }}
              messageId={bubble ? messageId : undefined}
            />
          )}
        </div>
      );
    }
    const body = (
      <MarkdownView source={children} variant="agent" selectionCopyScope />
    );
    // `group/answer`: the hover region that reveals MessageActions —
    // the answer body plus its bar (2026-09-28).
    return (
      <div
        data-message-id={messageId}
        data-selection-yield={selectionYieldKey}
        className={cn("group/answer", className)}
      >
        {bubble ? <AssistantBubble>{body}</AssistantBubble> : body}
        {attachment}
        {showActions && (
          <MessageActions
            source={children}
            telemetry={telemetry}
            assistant={bubble ? { process } : undefined}
            messageId={bubble ? messageId : undefined}
            selectionYieldKey={selectionYieldKey}
          />
        )}
      </div>
    );
  }
  // Already-rendered ReactNodes (demo / tests / future inline edit).
  // We fall back to the same outer wrapper styles as the markdown
  // path so the visual register is identical regardless of source.
  return (
    <div
      data-message-id={messageId}
      className="font-serif [font-size:var(--conversation-body-size)] [line-height:var(--conversation-body-leading)] tracking-[0.005em] text-ink [&_code]:rounded-[4px] [&_code]:bg-hover [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.86em] [&_code]:text-ink-soft [&_p]:mb-3 [&_p:last-child]:mb-0"
    >
      {/* Trivial guard: undefined / null children render nothing.
          isValidElement is here to make it explicit that React
          elements are intentional pass-throughs. */}
      {isValidElement(children) || children !== undefined ? children : null}
    </div>
  );
});

/**
 * Turn-protocol-failure notice (#22): the register of a
 * failed-historical ToolCallout (faint red bar, auto-collapsed) with
 * a one-line product-voice explanation as the lead; the raw markup
 * sits in a mono block one click away for audit. Not MarkdownView —
 * the content is not prose and must never render as such.
 */
function ProtocolFailureNotice({ markup }: { markup: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative my-3 overflow-hidden rounded-md border border-line bg-app">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-error/[var(--opacity-medium)]" />
      <div
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex cursor-default select-none items-center gap-2.5 px-4 pt-3.5",
          open ? "pb-2" : "pb-3.5",
        )}
      >
        <span className="inline-flex shrink-0">
          <XCircle size={16} weight="thin" className="text-error" />
        </span>
        <span className="text-[12.5px] text-ink-soft">
          {copy.conversation.turnProtocolFailureLead}
        </span>
        <span className="ml-auto inline-flex items-center text-ink-muted">
          <CaretDown
            size={12}
            weight="thin"
            className={cn(
              "transition-transform duration-(--motion-fast)",
              open && "rotate-180",
            )}
          />
        </span>
      </div>
      {open && (
        <div className="animate-fade-in px-4 pb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {copy.conversation.turnProtocolFailureRaw}
          </div>
          <pre className="max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-callout border border-line bg-app px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink-soft">
            {markup}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Intermediate assistant narration — process prose that belongs in
 * the main flow. It shares the answer body register so streaming
 * text does not restyle when it settles, but skips Copy/Save actions:
 * this text is useful status context, not the user-facing deliverable.
 */
export const MessageAgentNarration = memo(function MessageAgentNarration({
  children,
}: {
  children: string;
}) {
  return (
    <div className="my-1.5" data-role="agent-narration">
      <MarkdownView source={children} variant="narration" />
    </div>
  );
});
