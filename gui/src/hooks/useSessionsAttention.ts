import { useShallow } from "zustand/react/shallow";

import { deriveSessionStatus } from "@/lib/sessions";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import type { GoalBrief } from "@/types/goal";
import type { Session } from "@/types/session";

/** A project group's state, in the session row's priority order:
 * 出错 > 等你回复 > 正在工作 (incl. a running goal) > 未读 > 空闲. */
export type SessionsAttentionKind =
  | "error"
  | "ask"
  | "running"
  | "unread"
  | "idle";

export interface SessionsAttentionView {
  /** The highest-priority state any of the sessions is in. */
  kind: SessionsAttentionKind;
  /** How many sessions are in `kind` (0 for idle). */
  count: number;
  /** Sessions in a blocking state — erroring or waiting for a reply.
   * A collapsed group shows these under its row (D6). */
  needsYouIds: Set<string>;
  /** Sessions still running (their own run or an active goal). */
  runningCount: number;
}

/**
 * Many-session form of `useSessionStatusView` for the sidebar project
 * group row (D5). Same narrow projection: each store subscription
 * selects one small value per session and compares shallowly, so
 * streaming deltas never re-render the group. Per-session classification
 * mirrors SidebarSessionRow's own derivation (error, then ask_user, then
 * running / goal running, then unread on settled rows only), so the
 * group and its rows always agree.
 */
export function useSessionsAttention(
  sessions: Session[],
  activeId: string | undefined,
  sessionGoalStatus: Map<string, GoalBrief> | undefined,
): SessionsAttentionView {
  const ids = sessions.map((s) => s.id);
  // Bit 1: agentRunning, bit 2: a pending ask_user.
  const flags = useMessagesStore(
    useShallow((s) =>
      ids.map((id) => {
        const m = s.byId[id];
        return (m?.agentRunning ? 1 : 0) | (m?.pendingAskUser != null ? 2 : 0);
      }),
    ),
  );
  const bridgeStatuses = useRuntimeStore(
    useShallow((s) => ids.map((id) => s.byId[id]?.bridgeStatus)),
  );

  let errorCount = 0;
  let askCount = 0;
  let runningCount = 0;
  let unreadCount = 0;
  const needsYouIds = new Set<string>();
  sessions.forEach((session, i) => {
    const status = deriveSessionStatus(
      session,
      { agentRunning: (flags[i] & 1) !== 0 },
      bridgeStatuses[i],
    );
    const ask = (flags[i] & 2) !== 0;
    const error = status === "error";
    const asking = ask && !error;
    const goal = sessionGoalStatus?.get(session.id);
    const goalOwned = !!goal && status !== "running" && !asking && !error;
    const running =
      !error &&
      !asking &&
      (status === "running" || (goalOwned && goal?.status === "active"));
    const goalParked = goalOwned && goal?.status !== "active";
    const unread =
      !!session.hasUnread &&
      session.id !== activeId &&
      !error &&
      !asking &&
      !running &&
      !goalParked;
    if (error) errorCount++;
    if (asking) askCount++;
    if (running) runningCount++;
    if (unread) unreadCount++;
    if (error || asking) needsYouIds.add(session.id);
  });

  const [kind, count]: [SessionsAttentionKind, number] =
    errorCount > 0
      ? ["error", errorCount]
      : askCount > 0
        ? ["ask", askCount]
        : runningCount > 0
          ? ["running", runningCount]
          : unreadCount > 0
            ? ["unread", unreadCount]
            : ["idle", 0];
  return { kind, count, needsYouIds, runningCount };
}
