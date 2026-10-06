import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { openExternalUrl } from "@/lib/open-external";
import { cn } from "@/lib/utils";

/**
 * The one "leaves Galley" glyph in Settings: ArrowSquareOut at 12px,
 * thin. Used by inline links, the About link rows, and every Button
 * that opens something outside the app, so the mark reads the same
 * size wherever it appears.
 */
export function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <ArrowSquareOut
      size={12}
      weight="thin"
      className={cn("shrink-0", className)}
    />
  );
}

/**
 * Inline external text link. Stays a real anchor (link semantics,
 * focusable, href visible to assistive tech) but opens through the
 * opener plugin from `onClick`; `preventDefault` stops the plugin's
 * own `target="_blank"` click hook from opening it a second time.
 *
 * Tones:
 * - `brand` (default): brand-strong, underlined. For links set inside
 *   running text (step copy, the update error line).
 * - `muted`: ink-muted, no underline, brand on hover. For quiet
 *   utility links that sit beside other muted text actions.
 *
 * Size comes from the surrounding text; pass a type class through
 * `className` when the link sets its own.
 */
export function ExternalTextLink({
  href,
  children,
  tone = "brand",
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: "brand" | "muted";
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openExternalUrl(href);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        tone === "brand"
          ? "text-brand-strong underline decoration-brand-strong/35 underline-offset-[3px] hover:decoration-brand-strong"
          : "text-ink-muted hover:text-brand-strong",
        className,
      )}
    >
      <span>{children}</span>
      <ExternalLinkIcon />
    </a>
  );
}
