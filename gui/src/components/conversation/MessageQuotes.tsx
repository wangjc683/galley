import { useEffect, useRef, useState } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Where a bubble draws the quotes its message opens with (TEMP variant
 * switcher (telegram-details 07), dimension D): 1 outside the bubble,
 * above it; 2 inside the bubble, at its top.
 */
export type MessageQuotesVariant = 1 | 2;

/**
 * The quotes at the head of one of your messages (telegram-details
 * ticket 07; lib/composer-quote.ts `splitQuotedMessage` reads them off
 * the text). Drawn apart from your words, a step or two smaller and
 * quieter, each behind a thin bar:
 *
 * - `outside` (D1): a column right above the bubble, on its right edge
 *   and capped like it (`min(80%, 560px)`), as wide as the widest quote
 *   so the bars line up, 4px off the bubble and 2px apart — the apricot bubble
 *   is your voice, and what you quote is the assistant's, so it stays
 *   out of the bubble (ChatGPT does the same). `data-role` marks it for
 *   parking (lib/conversation-anchor.ts): a parked message shows its
 *   quotes too. Two lines a quote at most.
 * - `inside` (D2): a block at the top of the bubble on a ground a shade
 *   deeper than the bubble's (Telegram's reply). Three lines at most.
 *
 * A quote cut short opens in place on a click and closes on another.
 * Not selectable: it is the assistant's text, selectable where it was
 * said; the bubble's hover copy (workbench) copies the message whole.
 */
export function MessageQuotes({
  quotes,
  placement,
}: {
  quotes: readonly string[];
  placement: "outside" | "inside";
}) {
  const copy = useCopy();
  const outside = placement === "outside";
  return (
    <div
      role="group"
      aria-label={copy.composer.quotesLabel}
      data-role={outside ? "message-quotes" : undefined}
      className={cn(
        "flex flex-col",
        // Outside: one column as wide as its widest quote, on the
        // bubble's right edge, so the quotes' bars line up.
        outside
          ? "mb-1 ml-auto w-fit max-w-[min(80%,560px)] gap-0.5"
          : "mb-1.5 gap-1",
      )}
    >
      {quotes.map((quote, index) => (
        <QuoteText
          key={index}
          text={quote}
          className={
            outside
              ? "border-l-2 border-line-strong pl-2 text-ink-muted"
              : "rounded-sm border-l-2 border-brand-strong/45 bg-brand-strong/10 px-2 py-1 font-normal text-ink-soft"
          }
          clampClass={outside ? "line-clamp-2" : "line-clamp-3"}
        />
      ))}
    </div>
  );
}

function QuoteText({
  text,
  className,
  clampClass,
}: {
  text: string;
  className: string;
  clampClass: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Whether the clamp cut it short, measured whenever its box changes
  // (the observer reports once on observe, so no read in the effect).
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setCut(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const toggles = expanded || cut;
  return (
    <div
      role={toggles ? "button" : undefined}
      tabIndex={toggles ? 0 : undefined}
      aria-expanded={toggles ? expanded : undefined}
      onClick={toggles ? () => setExpanded((v) => !v) : undefined}
      onKeyDown={
        toggles
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
      className={cn(
        "select-none [font-size:var(--conversation-echo-size)] leading-[1.5] outline-none",
        toggles && "focus-visible:ring-2 focus-visible:ring-brand/30",
        className,
      )}
    >
      {/* The clamp on its own box: on the padded one, the padding
          would show a sliver of the next line. */}
      <div
        ref={ref}
        className={cn(
          "whitespace-pre-line break-words",
          !expanded && clampClass,
        )}
      >
        {text}
      </div>
    </div>
  );
}
