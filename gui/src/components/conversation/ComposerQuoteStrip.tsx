import { ArrowElbowDownRight, X } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * The quotes waiting to go out with the message (telegram-details
 * ticket 07): inside the composer's box, right above the input — the
 * sent message reads quotes, then your words, so this sits where it
 * will land, nearest the text, under the image tiles. One row per quote
 * in the order picked; the × (on hovering the row, as on an image tile)
 * takes one out. A row is a ↳ in the ＋ column and one line of the quote
 * in the input's column (44px in from the box's edge), cut short with
 * an ellipsis, the whole of it in the native tooltip — ChatGPT's form,
 * JC's pick over a bar and two lines (PRD ruling 3a, ticket 08). A quote
 * reads as the head of what you are writing. Rendered only with at least
 * one quote.
 */
export function ComposerQuoteStrip({
  quotes,
  onRemove,
  oneLine,
}: {
  quotes: readonly string[];
  onRemove: (index: number) => void;
  /** In the one-line box: the ↳ sits in ＋'s column, the text past it. */
  oneLine: boolean;
}) {
  const copy = useCopy();
  return (
    <div
      role="group"
      aria-label={copy.composer.quotesLabel}
      data-role="composer-quotes"
      className={cn("flex flex-col gap-1", oneLine ? "pb-1 pt-0.5" : "mb-2")}
    >
      {quotes.map((quote, index) => (
        <div
          // Quotes are removed by position; a repeat is never added.
          key={`${index}:${quote}`}
          className="group/quote flex min-w-0 items-start gap-1"
        >
          <span
            aria-hidden
            className={cn(
              "flex h-6 shrink-0 items-center text-ink-muted",
              oneLine ? "w-8 justify-center" : "w-4",
            )}
          >
            <ArrowElbowDownRight size={14} weight="thin" />
          </span>
          <span
            title={quote}
            className="min-w-0 flex-1 truncate py-0.5 [font-size:var(--conversation-echo-size)] leading-[1.5] text-ink-soft"
          >
            {quote.replace(/\s+/g, " ")}
          </span>
          <TooltipLabel text={copy.composer.removeQuote}>
            <button
              type="button"
              aria-label={copy.composer.removeQuote}
              tabIndex={-1}
              onMouseDown={preventMouseFocus}
              onClick={() => onRemove(index)}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none",
                "opacity-0 hover:bg-hover hover:text-ink group-hover/quote:opacity-100 focus-visible:opacity-100",
              )}
            >
              <X size={12} weight="bold" />
            </button>
          </TooltipLabel>
        </div>
      ))}
    </div>
  );
}
