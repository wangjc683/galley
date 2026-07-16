import { Skeleton } from "@/components/ui/skeleton";

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
 * Two ghost exchanges mirroring the real turn anatomy: a full-width
 * user band (MessageUser renders as a left-bordered band, not a
 * bubble), then agent prose lines with a ragged right edge. All
 * neutral `bg-hover` — no color noise, no shimmer (see
 * ui/skeleton.tsx contract).
 */
function GhostUserBand() {
  return (
    <div className="border-l-4 border-line py-2.5 pl-4">
      <Skeleton className="h-4 w-2/5" />
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-7 py-4">
      <GhostUserBand />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <GhostUserBand />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
