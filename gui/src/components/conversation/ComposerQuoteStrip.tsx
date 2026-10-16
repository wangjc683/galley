import { ArrowElbowDownRight, X } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * How a quote row looks (TEMP variant switcher (telegram-details 07),
 * dimension C): 1 a thin bar and up to two lines of the quote; 2 a ↳
 * glyph in the ＋ column and one line (ChatGPT's).
 */
export type QuoteStripVariant = 1 | 2;

/**
 * The quotes waiting to go out with the message (telegram-details
 * ticket 07): inside the composer's box, right above the input — the
 * sent message reads quotes, then your words, so this sits where it
 * will land, nearest the text, under the image tiles. One row per quote
 * in the order picked; the × (on hovering the row, as on an image tile)
 * takes one out. The quote text is the input's column (44px in from the
 * box's edge, past ＋), so a quote reads as the head of what you are
 * writing. Rendered only with at least one quote.
 */
export function ComposerQuoteStrip({
  quotes,
  onRemove,
  variant,
  oneLine,
}: {
  quotes: readonly string[];
  onRemove: (index: number) => void;
  variant: QuoteStripVariant;
  /** In the one-line box: the text column starts past ＋. */
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
          {variant === 2 ? (
            <span
              aria-hidden
              className={cn(
                "flex h-6 shrink-0 items-center text-ink-muted",
                oneLine ? "w-8 justify-center" : "w-4",
              )}
            >
              <ArrowElbowDownRight size={14} weight="thin" />
            </span>
          ) : (
            oneLine && <span aria-hidden className="w-8 shrink-0" />
          )}
          <span
            title={quote}
            className={cn(
              "min-w-0 flex-1 [font-size:var(--conversation-echo-size)] leading-[1.5] text-ink-soft",
              variant === 2
                ? "truncate py-0.5"
                : "line-clamp-2 whitespace-pre-line break-words border-l-2 border-line-strong py-px pl-2",
            )}
          >
            {variant === 2 ? quote.replace(/\s+/g, " ") : quote}
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
