import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * Shared shell for a channel row in Settings → Channels: a collapsible card
 * with a rotating-chevron header (glyph + title + status badge + optional
 * actions menu) and a grid-rows animated expand/collapse body. WeChatCard and
 * FeishuCard own the `expanded` state and supply the header slots + body.
 *
 * Collapsed body content is marked `inert` so it stays non-focusable and hidden
 * from assistive tech while still mounted (the grid-rows animation needs it in
 * the DOM in both states).
 */
export function ChannelCard({
  expanded,
  onToggle,
  glyph,
  title,
  badge,
  actions,
  busy = false,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  glyph: ReactNode;
  title: string;
  badge: ReactNode;
  actions?: ReactNode;
  /** Keep the actions menu pinned visible (not hover-only) while an action runs. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "group/im overflow-hidden rounded-sm border border-line bg-surface transition-colors",
        expanded && "border-line-strong",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 px-2 py-1.5 transition-colors",
          expanded && "bg-hover/40",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          aria-expanded={expanded}
          className={cn(
            "group/toggle flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-0.5 text-left",
            "hover:bg-hover outline-none",
          )}
          onClick={onToggle}
        >
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-soft transition-[color,transform] duration-(--motion-fast) ease-firm",
              expanded ? "rotate-90 text-ink" : "rotate-0",
            )}
          >
            <CaretRight size={12} weight="bold" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {glyph}
            <span
              className="min-w-0 truncate text-ui-compact font-medium text-ink"
              title={title}
            >
              {title}
            </span>
            {badge}
          </span>
        </button>
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5 opacity-80",
            "group-hover/im:opacity-100",
            busy && "opacity-100",
          )}
        >
          {actions}
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-(--motion-base) ease-firm",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden" inert={!expanded || undefined}>
          <div className="border-t border-line/70 bg-hover/25 px-2.5 py-3">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
