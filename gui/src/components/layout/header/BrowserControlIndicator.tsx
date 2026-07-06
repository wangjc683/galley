import { PuzzlePiece } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { BrowserControlStatus } from "@/lib/browser-control";

import { TopBarIconButton } from "../TopBarIconButton";
import { topBarStatusBadgeClass } from "./topbar-status-badge";

export function BrowserControlIndicator({
  status,
  onOpen,
}: {
  status: BrowserControlStatus;
  onOpen?: () => void;
}) {
  const copy = useCopy().topbar;
  const connected = status === "connected";
  const connectedNoTabs = status === "connected_no_tabs";
  const offline = status === "offline";
  const bridgeReady = connected || connectedNoTabs;
  const checking = status === "unknown";
  const error = status === "error";
  const label = checking
    ? copy.browserControlChecking
    : error
      ? copy.browserControlError
      : copy.browserControlPending;
  const title = connected
    ? copy.browserControlConnectedTitle
    : connectedNoTabs
      ? copy.browserControlNoTabsTitle
      : offline
        ? copy.browserControlOfflineTitle
        : error
          ? copy.browserControlErrorTitle
          : copy.browserControlPendingTitle;
  if (bridgeReady || offline) {
    return (
      <TooltipLabel text={title}>
        <TopBarIconButton onClick={onOpen} aria-label={title}>
          <PuzzlePiece size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  return (
    <TooltipLabel text={title}>
      <button
        type="button"
        onClick={onOpen}
        className={topBarStatusBadgeClass(
          error ? "error" : checking ? "neutral" : "warning",
        )}
        aria-label={title}
      >
        {label}
      </button>
    </TooltipLabel>
  );
}
