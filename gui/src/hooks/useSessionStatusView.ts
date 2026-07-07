import { useShallow } from "zustand/react/shallow";

import { deriveSessionStatus } from "@/lib/sessions";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import type { Session, SessionStatus } from "@/types/session";

export interface SessionStatusView {
  /** Effective status: durable row status overlaid with live runtime state. */
  status: SessionStatus;
  pendingApprovalCount: number;
  hasPendingAskUser: boolean;
}

/**
 * Read-time derivation of a session's sidebar status view. Replaces the
 * imperative `fireSessionMirror` push (deleted): rather than copying
 * status / approval count / ask-user onto the session row on every
 * message write, each sidebar row computes them on read from the narrow
 * set of message fields the derivation actually depends on.
 *
 * The narrow projection + `useShallow` is load-bearing, not cosmetic:
 * subscribing to the whole `byId[id]` slice would re-render the row on
 * every streaming `inFlightContent` delta. Selecting only agentRunning /
 * pendingApprovals length / pendingAskUser means streaming tokens leave
 * this view unchanged (shallow-equal), so the row never re-renders for
 * them — a strict improvement over the old hot-path mirror.
 */
export function useSessionStatusView(session: Session): SessionStatusView {
  const bridgeStatus = useRuntimeStore((s) => s.byId[session.id]?.bridgeStatus);
  const live = useMessagesStore(
    useShallow((s) => {
      const m = s.byId[session.id];
      return {
        agentRunning: m?.agentRunning ?? false,
        pendingApprovalCount: m?.pendingApprovals.length ?? 0,
        hasPendingAskUser: m?.pendingAskUser != null,
      };
    }),
  );
  return {
    status: deriveSessionStatus(
      session,
      { agentRunning: live.agentRunning, pendingApprovalCount: live.pendingApprovalCount },
      bridgeStatus,
    ),
    pendingApprovalCount: live.pendingApprovalCount,
    hasPendingAskUser: live.hasPendingAskUser,
  };
}
