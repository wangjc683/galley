import { useEffect, useState } from "react";

import { getGoalStatus } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalBrief, GoalTaskBrief } from "@/types/goal";

/**
 * In-thread task board for a Goal episode — the "what are the agents
 * actually doing" surface the master session was missing. One board per
 * episode (never per-task appended cards: a chat thread is append-only
 * while task state mutates, so appended cards go stale and flood the
 * thread — same reasoning that kept checkpoints off the assistant role).
 *
 *   - live (running / wrapping): pinned at the thread tail by MainView,
 *     refreshed on its own 5s poll (same cadence as the goal list).
 *   - frozen (terminal): mounted by annotateGoalThread just above the
 *     terminal marker, fetched once. For a failed goal this IS the
 *     legacy accounting — completed tasks keep their result summaries.
 *
 * Rows with an owner session drill down into the worker's raw session
 * log via `onOpenWorkerSession`; the board is the summary, the session
 * is the record.
 */
export function GoalTaskBoard({
  goal,
  onOpenWorkerSession,
}: {
  goal: GoalBrief;
  onOpenWorkerSession?: (sessionId: string) => void;
}) {
  const copy = useCopy();
  const conv = copy.conversation;
  const [tasks, setTasks] = useState<GoalTaskBrief[] | null>(null);
  const live = goal.status === "running" || goal.status === "wrapping";

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getGoalStatus(goal.id)
        .then((snapshot) => {
          if (!cancelled) setTasks(snapshot.tasks);
        })
        .catch(() => undefined);
    };
    load();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [goal.id, live]);

  // First fetch still in flight — render nothing rather than a flash of
  // empty chrome.
  if (tasks === null) return null;
  if (tasks.length === 0) {
    // Live with an empty board = master is still planning; say so
    // instead of showing a 0/0 table. Frozen empty board carries no
    // information — skip it entirely.
    if (!live) return null;
    return (
      <div className="my-4 border-l-[3px] border-brand-strong/30 pl-4 text-[12px] text-ink-soft">
        {conv.goalTaskBoardPlanning}
      </div>
    );
  }

  const done = tasks.filter((task) => task.status === "completed").length;
  return (
    <div className="my-4 border-l-[3px] border-brand-strong/30 pl-4">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-brand-strong/70">
        {conv.goalTaskBoardHeading(done, tasks.length)}
      </div>
      <ul className="space-y-1">
        {tasks.map((task) => {
          const clickable = Boolean(task.ownerSessionId && onOpenWorkerSession);
          const row = (
            <>
              <span
                className={cn(
                  "mt-[5px] size-1.5 shrink-0 rounded-full",
                  goalTaskDotClass(task.status),
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-ink">
                    {task.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-muted">
                    {conv.goalTaskStatus[task.status]}
                  </span>
                </span>
                {task.status === "completed" && task.resultSummary && (
                  <span className="mt-0.5 line-clamp-2 block break-words text-[11.5px] leading-snug text-ink-muted">
                    {task.resultSummary}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={task.id}>
              {clickable ? (
                <button
                  type="button"
                  className="-mx-1.5 flex w-full items-start gap-2 rounded-sm px-1.5 py-0.5 text-left transition-colors duration-[120ms] hover:bg-hover"
                  onClick={() => {
                    const owner = task.ownerSessionId;
                    if (owner) onOpenWorkerSession?.(owner);
                  }}
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-start gap-2 py-0.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function goalTaskDotClass(status: GoalTaskBrief["status"]): string {
  switch (status) {
    case "completed":
      return "bg-success";
    case "blocked":
      return "bg-error";
    case "cancelled":
      return "bg-ink-muted";
    case "open":
      return "bg-ink-muted/50";
    default:
      // claimed / running — actively being worked.
      return "bg-brand-strong";
  }
}
