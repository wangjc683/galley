import type { BridgeStatus } from "@/stores/runtime";
import type {
  DurableSessionStatus,
  Session,
  SessionBucket,
  SessionStatus,
} from "@/types/session";

/**
 * Collapse any `SessionStatus` to the durable subset a `Session` row may
 * hold. Core's persisted status column can carry a stale runtime value
 * (e.g. a session that was `running` when the app died) — on load nothing
 * is actually running, so those collapse to `idle`. Applied at the wire
 * boundary (`sessionFromBrief`) so the row never enters a runtime status.
 */
export function toDurableStatus(status: SessionStatus): DurableSessionStatus {
  switch (status) {
    case "completed":
    case "cancelled":
    case "archived":
      return status;
    default:
      // idle + any stale runtime value (connecting/running/
      // waiting_approval/error) → idle.
      return "idle";
  }
}

/**
 * Minimal live conversation state `deriveSessionStatus` overlays onto the
 * durable row. Deliberately the narrow set the derivation actually reads
 * — callers (see `useSessionStatusView`) project exactly these off
 * `messagesStore.byId[id]` with a shallow subscription, so streaming
 * `inFlightContent` deltas don't churn the derivation.
 */
export interface SessionLiveState {
  agentRunning: boolean;
  pendingApprovalCount: number;
}

/**
 * Derive the effective session status by overlaying live conversation +
 * bridge state onto the durable Session row. Long-term states the user /
 * persistence sets (`archived` / `completed` / `cancelled`) always win —
 * they're "this is what this session IS", not "what's happening right
 * now". The remaining states reflect what the bridge + agent are doing
 * this second:
 *
 *   pendingApprovalCount > 0    → waiting_approval (highest priority —
 *                                  drives the amber pause icon)
 *   agentRunning                → running          (apricot spinner)
 *   bridgeStatus === "spawning" → connecting       (subtle loader)
 *   bridgeStatus === "error"    → error            (red dot)
 *   otherwise                   → idle
 *
 * Pass `live === undefined` for a session with no loaded conversation
 * slice — the derivation falls back to the durable row status.
 */
export function deriveSessionStatus(
  session: Pick<Session, "status">,
  live: SessionLiveState | undefined,
  bridgeStatus?: BridgeStatus | undefined,
): SessionStatus {
  if (
    session.status === "archived" ||
    session.status === "completed" ||
    session.status === "cancelled"
  ) {
    return session.status;
  }
  if (!live) return session.status;
  if (live.pendingApprovalCount > 0) return "waiting_approval";
  if (live.agentRunning) return "running";
  // bridgeStatus moved to runtimeStore in M3b — callers fetch it from
  // useRuntimeStore.getState().byId[sid]?.bridgeStatus and pass in.
  if (bridgeStatus === "spawning") return "connecting";
  if (bridgeStatus === "error") return "error";
  return "idle";
}

/**
 * Compute which sidebar bucket a session falls into.
 *
 *   pinned   — pinned flag wins regardless of date
 *   today    — lastActivityAt is on the calendar day of `now`
 *   week     — within 7 days but not today
 *   earlier  — older, including archived
 *
 * Bucket is purely a view concern; we don't store it on the entity.
 */
export function bucketSession(
  s: Session,
  now: Date = new Date(),
): SessionBucket {
  if (s.pinned) return "pinned";
  const last = new Date(s.lastActivityAt).getTime();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  if (last >= todayMs) return "today";
  const weekAgoMs = todayMs - 7 * 24 * 3600 * 1000;
  if (last >= weekAgoMs) return "week";
  return "earlier";
}

const BUCKET_ORDER: SessionBucket[] = ["pinned", "today", "week", "earlier"];

export type GroupedSessions = Record<SessionBucket, Session[]>;

/**
 * Group sessions into the four sidebar buckets, sorted within each by
 * lastActivityAt descending (most recent first).
 *
 * Empty buckets are returned as empty arrays — the sidebar decides
 * whether to render the section header.
 */
export function groupSessions(
  sessions: Session[],
  now: Date = new Date(),
): GroupedSessions {
  const buckets: GroupedSessions = {
    pinned: [],
    today: [],
    week: [],
    earlier: [],
  };
  const sorted = [...sessions].sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
  for (const s of sorted) {
    buckets[bucketSession(s, now)].push(s);
  }
  return buckets;
}

export const SIDEBAR_BUCKET_ORDER = BUCKET_ORDER;

export const BUCKET_LABEL: Record<SessionBucket, string> = {
  pinned: "Pinned",
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};
