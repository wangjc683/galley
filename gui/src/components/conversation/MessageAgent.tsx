import { CaretDown, XCircle } from "@phosphor-icons/react";
import { isValidElement, memo, useState, type ReactNode } from "react";

import { MarkdownView } from "@/components/conversation/MarkdownView";
import { MessageActions } from "@/components/conversation/MessageActions";
import { useCopy } from "@/lib/i18n";
import { isLeakedToolCallMarkup } from "@/lib/ipc/ga-output-cleaning";
import { cn } from "@/lib/utils";
import type { MessageTelemetry } from "@/types/conversation";

/**
 * Final agent answer — uses the conversation body typography vars,
 * no callout chrome, and "floats in the document". Per DESIGN.md
 * §4.3 + the prototype's msg-agent style.
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
 */
// Memoised: during streaming the conversation re-renders on every
// throttled chunk, but settled agent turns carry an immutable string
// child. `memo` keeps those out of the streaming reconciliation path.
export const MessageAgent = memo(function MessageAgent({
  children,
  showActions = true,
  telemetry,
}: {
  children: ReactNode;
  showActions?: boolean;
  telemetry?: MessageTelemetry;
}) {
  if (typeof children === "string") {
    // #22: a "final answer" that is really leaked tool-call markup
    // (`<invoke …>` returned as plain text by a proxy that never
    // produced a structured block). Prose-rendering it is unreadable
    // and looks broken; there is also no deliverable to Copy/Save.
    // Render an explanatory notice with the raw markup one click away.
    if (isLeakedToolCallMarkup(children)) {
      return <ProtocolFailureNotice markup={children} />;
    }
    return (
      <div>
        <MarkdownView source={children} variant="agent" selectionCopyScope />
        {showActions && <MessageActions source={children} telemetry={telemetry} />}
      </div>
    );
  }
  // Already-rendered ReactNodes (demo / tests / future inline edit).
  // We fall back to the same outer wrapper styles as the markdown
  // path so the visual register is identical regardless of source.
  return (
    <div className="font-serif [font-size:var(--conversation-body-size)] [line-height:var(--conversation-body-leading)] tracking-[0.005em] text-ink [&_code]:rounded-[4px] [&_code]:bg-hover [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.86em] [&_code]:text-ink-soft [&_p]:mb-3 [&_p:last-child]:mb-0">
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
