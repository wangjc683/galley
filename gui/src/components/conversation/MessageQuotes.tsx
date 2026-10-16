import { useEffect, useRef, useState } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The quotes at the head of one of your messages (telegram-details
 * ticket 07; lib/composer-quote.ts `splitQuotedMessage` reads them off
 * the text), drawn at the top of your bubble, apart from your words —
 * Telegram's reply, JC's pick over a column above the bubble (PRD ruling
 * 3a, ticket 08): the quote is part of what you sent (the assistant gets
 * it, the hover copy copies it), so the bubble holds it, the way a mail
 * reply holds the text it quotes. A block per quote on a ground a shade
 * deeper than the bubble's (`brand-strong` at 10%) behind a 2px bar
 * (45%), a step or two smaller than your words (the echo size) in
 * `ink-soft` at normal weight, 4px between blocks and 6px above your
 * words; three lines at most. A parked message parks by its bubble's top
 * edge as any other (lib/conversation-anchor.ts): the quotes are in it.
 *
 * A quote cut short opens in place on a click and closes on another.
 * Not selectable: it is the assistant's text, selectable where it was
 * said; the bubble's hover copy (workbench) copies the message whole.
 */
export function MessageQuotes({ quotes }: { quotes: readonly string[] }) {
  const copy = useCopy();
  return (
    <div
      role="group"
      aria-label={copy.composer.quotesLabel}
      className="mb-1.5 flex flex-col gap-1"
    >
      {quotes.map((quote, index) => (
        <QuoteText key={index} text={quote} />
      ))}
    </div>
  );
}

function QuoteText({ text }: { text: string }) {
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
        "rounded-sm border-l-2 border-brand-strong/45 bg-brand-strong/10 px-2 py-1 font-normal text-ink-soft",
        toggles && "focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      {/* The clamp on its own box: on the padded one, the padding
          would show a sliver of the next line. */}
      <div
        ref={ref}
        className={cn(
          "whitespace-pre-line break-words",
          !expanded && "line-clamp-3",
        )}
      >
        {text}
      </div>
    </div>
  );
}
