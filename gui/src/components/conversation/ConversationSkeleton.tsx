import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Content-shaped placeholder for the conversation column while
 * `restoreSessionTurns` reads a session's history back from SQLite.
 *
 * Only cold start ever shows this: warm session switches defer the
 * active-pointer flip until turns are in memory (sessions.ts atomic
 * swap), so the previous transcript stays on screen instead. Here
 * there is no previous transcript, and a blank column would misread
 * as "empty session" — the ghost turns say "history is on its way"
 * in the shape it will arrive.
 *
 * Two ghost exchanges mirroring the real turn anatomy: the user's
 * bubble on the right, then agent prose lines with a ragged right
 * edge. All neutral `bg-hover` — no color noise, no shimmer (see
 * ui/skeleton.tsx contract). Both conversations show it on a cold
 * start.
 *
 * The user's ghost follows the bubble (workbench ticket 01, when the
 * workbench's words moved right too): on the right, its 12px radius,
 * one line tall (a one-line bubble is about 45px at the standard
 * tier), its width a share of the bubble's cap `min(80%, 560px)` —
 * 60% and 40% of it, so the two ghosts do not read as one repeated
 * block. Until then it was a full-width band with a left rule, the
 * user message's shape before the 2026-09-17 bubble.
 */
function GhostUserBubble({ width }: { width: string }) {
  return <Skeleton className={cn("ml-auto h-[45px] rounded-md", width)} />;
}

export function ConversationSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-7 py-4">
      <GhostUserBubble width="w-[min(48%,336px)]" />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <GhostUserBubble width="w-[min(32%,224px)]" />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
