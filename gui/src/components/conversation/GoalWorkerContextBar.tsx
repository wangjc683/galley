import { Target } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { getGoalContextForSession } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalWorkerContext } from "@/types/goal";

/**
 * Orientation bar for a Goal worker session. Worker sessions are
 * ordinary sessions with a protocol conversation inside — a user who
 * reaches one from the sidebar has zero context for what they're
 * looking at. This bar answers the three questions that matter before
 * they read a single turn: this is a worker of a Goal, this is the task
 * it owns, this is how to get back to the Goal's master session (the
 * whole bar is the affordance).
 *
 * Resolution is a backend reverse lookup through
 * `goal_tasks.owner_session_id` — null for normal sessions and masters,
 * in which case nothing renders. Kept for terminal goals too: a
 * historical worker log needs the orientation just as much.
 */
export function GoalWorkerContextBar({
  sessionId,
  onOpenMaster,
}: {
  sessionId?: string;
  onOpenMaster?: (masterSessionId: string) => void;
}) {
  const copy = useCopy();
  const conv = copy.conversation;
  // Keyed by session so a stale bar never bleeds into the next session
  // while its own lookup is in flight — deriving `context` from the key
  // match replaces a synchronous reset in the effect body (which the
  // React Compiler lint rejects as a cascading render).
  const [loaded, setLoaded] = useState<{
    sessionId: string;
    context: GoalWorkerContext | null;
  } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      void getGoalContextForSession(sessionId)
        .then((next) => {
          if (cancelled) return;
          setLoaded({ sessionId, context: next });
          // Task status moves while the goal runs — keep the bar honest
          // with a coarse poll, and stop the moment the goal parks.
          const live =
            next?.goal.status === "running" ||
            next?.goal.status === "wrapping";
          if (live && timer === undefined) {
            timer = window.setInterval(load, 5_000);
          }
          if (!live && timer !== undefined) {
            window.clearInterval(timer);
            timer = undefined;
          }
        })
        .catch(() => undefined);
    };
    load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [sessionId]);

  const context =
    sessionId && loaded?.sessionId === sessionId ? loaded.context : null;
  if (!context) return null;
  const master = context.goal.masterSessionId;
  const clickable = Boolean(master && onOpenMaster);
  const body = (
    <>
      <Target size={12} weight="bold" className="shrink-0 text-brand-strong" />
      <span className="shrink-0 font-medium text-brand-strong">
        {conv.workerContextEyebrow}
      </span>
      <span aria-hidden className="shrink-0 text-ink-muted">
        ·
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-soft">
        {conv.workerContextTask}
        {context.task.title}
      </span>
      <span className="shrink-0 text-ink-muted">
        {conv.goalTaskStatus[context.task.status]}
      </span>
      {clickable && (
        <span className="shrink-0 text-ink-muted">
          {conv.workerContextOpenMaster}
        </span>
      )}
    </>
  );
  const barClass =
    "flex w-full items-center gap-2 border-b border-line bg-brand-tint/60 px-8 py-1.5 text-[12px]";
  if (!clickable) {
    return <div className={barClass}>{body}</div>;
  }
  return (
    <button
      type="button"
      className={cn(
        barClass,
        "text-left hover:bg-brand-tint",
      )}
      onClick={() => {
        if (master) onOpenMaster?.(master);
      }}
    >
      {body}
    </button>
  );
}
