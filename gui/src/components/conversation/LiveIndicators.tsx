import { cn } from "@/lib/utils";

// StreamingCursor (the standalone caret component) retired 2026-08-13:
// the streaming caret now lives in globals.css as `streaming-prose`'s
// ::after pseudo-element, riding inline at the end of the last block's
// text instead of on its own line below the markdown.

/**
 * Three-dot "working" indicator. One affordance localized to three
 * glyphs with a gentle staggered opacity lift (see .live-dot in
 * globals.css); collapses to static under prefers-reduced-motion.
 *
 * Shared by the thinking-state TurnMarker (Conversation.tsx) and the
 * running ToolCallout head so the two "agent is working" surfaces
 * speak one motion vocabulary. `className` tunes placement / dot
 * color (defaults to ink-muted).
 */
export function LiveDots({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center gap-[2px]", className)}
    >
      <span className="live-dot size-[3px] rounded-full bg-current" />
      <span className="live-dot size-[3px] rounded-full bg-current" />
      <span className="live-dot size-[3px] rounded-full bg-current" />
    </span>
  );
}
