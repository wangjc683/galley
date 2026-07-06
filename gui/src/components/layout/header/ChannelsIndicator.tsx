import { ChatCircleText } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { ImSupervisorState } from "@/lib/im-supervisor";

import { TopBarIconButton } from "../TopBarIconButton";
import { topBarStatusBadgeClass } from "./topbar-status-badge";

export function ChannelsIndicator({
  state,
  loadError,
  onOpen,
}: {
  state: ImSupervisorState | null;
  loadError?: string | null;
  onOpen?: () => void;
}) {
  const copy = useCopy().topbar;
  const status = channelsTopbarStatus(state, loadError);
  const title = {
    setup: copy.channelsSetup,
    connecting: copy.channelsConnecting,
    waitingScan: copy.channelsWaitingScan,
    connected: copy.channelsConnected,
    needsAttention: copy.channelsNeedsAttention,
  }[status];

  if (status === "setup" || status === "connected") {
    return (
      <TooltipLabel text={title}>
        <TopBarIconButton onClick={onOpen} aria-label={title}>
          <ChatCircleText size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  const badgeLabel = {
    connecting: copy.channelsConnectingBadge,
    waitingScan: copy.channelsWaitingScanBadge,
    needsAttention: copy.channelsNeedsAttentionBadge,
  }[status];

  return (
    <TooltipLabel text={title}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={title}
        className={topBarStatusBadgeClass(
          status === "needsAttention"
            ? "error"
            : status === "connecting"
              ? "neutral"
              : "warning",
        )}
      >
        {badgeLabel}
      </button>
    </TooltipLabel>
  );
}

function channelsTopbarStatus(
  state: ImSupervisorState | null,
  loadError?: string | null,
) {
  if (loadError || state === "expired" || state === "error") {
    return "needsAttention";
  }
  if (state === "running") return "connected";
  if (state === "starting" || state === "reconnecting") return "connecting";
  if (state === "waiting_scan") return "waitingScan";
  return "setup";
}
