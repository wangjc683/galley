import * as Popover from "@radix-ui/react-popover";
import { ArrowsClockwise, ChatCircleText } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type {
  ImSupervisorState,
  ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { cn } from "@/lib/utils";

import { TopBarIconButton } from "../TopBarIconButton";
import {
  channelPlatformLabel,
  channelsIndicatorStatus,
  channelStateLabel,
  configuredChannels,
} from "./channels-indicator-status";
import { TopBarLampIcon } from "./TopBarLampIcon";
import {
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";

/**
 * Channels in the status cluster (managed runtime only).
 *
 *   - Never set up: unlit `ChatCircleText`, click → Settings → Channels.
 *     Channels is optional; desktop-only users are not nagged.
 *   - Set up: a lamp, lit while at least one platform runs, unlit when
 *     all are paused. Connecting / waiting for a scan / needs attention
 *     keep their text badges. Either form opens a popover: one row per
 *     configured platform with its state (the Settings card words), then
 *     重启 Channels behind the same confirm Settings uses, then the
 *     settings link. Only platforms the user set up are listed — no
 *     placeholders for the rest (2026-05-31: not a platform inventory).
 *
 * No status dot on the chat glyph: a dot there reads as unread messages.
 */
export function ChannelsIndicator({
  statuses,
  loadError,
  onOpenSettings,
  onRestart,
}: {
  statuses: ReadonlyArray<ImSupervisorStatus | null>;
  loadError?: string | null;
  onOpenSettings?: () => void;
  onRestart?: () => void;
}) {
  const fullCopy = useCopy();
  const copy = fullCopy.topbar;
  const imCopy = fullCopy.settings.im;
  const [open, setOpen] = useState(false);
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const configured = configuredChannels(statuses);
  const status = channelsIndicatorStatus(configured, loadError);
  // Disconnecting the last platform from Settings while the popover is
  // open turns this into the plain setup button.
  if (open && status === "setup") setOpen(false);
  // Restart only relaunches enabled platforms; with every one paused
  // there is nothing for it to do (Settings hides its button the same).
  const canRestart = Boolean(onRestart) && configured.some((s) => s.enabled);

  const title = {
    setup: copy.channelsSetup,
    idle: copy.channelsIdle,
    connecting: copy.channelsConnecting,
    waitingScan: copy.channelsWaitingScan,
    connected: copy.channelsConnected,
    needsAttention: copy.channelsNeedsAttention,
  }[status];

  if (status === "setup") {
    return (
      <TooltipLabel text={title}>
        <TopBarIconButton onClick={onOpenSettings} aria-label={title}>
          <TopBarLampIcon icon={ChatCircleText} lit={false} />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  const badgeLabel =
    status === "connecting"
      ? copy.channelsConnectingBadge
      : status === "waitingScan"
        ? copy.channelsWaitingScanBadge
        : status === "needsAttention"
          ? copy.channelsNeedsAttentionBadge
          : null;

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <TooltipLabel text={title} side="bottom">
          <Popover.Trigger asChild>
            {badgeLabel === null ? (
              <TopBarIconButton aria-label={title}>
                <TopBarLampIcon
                  icon={ChatCircleText}
                  lit={status === "connected"}
                />
              </TopBarIconButton>
            ) : (
              <button
                type="button"
                aria-label={title}
                className={topBarStatusBadgeClass(
                  status === "needsAttention"
                    ? "error"
                    : status === "connecting"
                      ? "neutral"
                      : "warning",
                  TOPBAR_POPOVER_OPEN_STATE,
                )}
              >
                {badgeLabel}
              </button>
            )}
          </Popover.Trigger>
        </TooltipLabel>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="galley-pop-in z-50 w-[300px] rounded-md border border-line bg-elevated p-4 shadow-elevated outline-none"
          >
            {loadError && (
              <div className="mb-3 text-[12px] leading-[1.55] text-error">
                <div className="font-medium">
                  {copy.channelsPopover.loadFailed}
                </div>
                <div className="mt-0.5 select-text break-words text-ink-soft">
                  {loadError}
                </div>
              </div>
            )}
            {configured.length > 0 && (
              <ul className="space-y-2">
                {configured.map((channel) => (
                  <li key={channel.platform}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] text-ink">
                        {channelPlatformLabel(channel.platform, imCopy)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-[12px]",
                          channelStateClass(channel.state),
                        )}
                      >
                        {channelStateLabel(channel.state, imCopy)}
                      </span>
                    </div>
                    {(channel.state === "error" ||
                      channel.state === "expired") &&
                      channel.lastError && (
                        <div className="mt-0.5 line-clamp-2 select-text break-words text-[11px] leading-snug text-ink-muted">
                          {channel.lastError}
                        </div>
                      )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-3">
              {canRestart ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  leadingIcon={<ArrowsClockwise size={13} weight="thin" />}
                  onClick={() => {
                    setOpen(false);
                    setConfirmRestartOpen(true);
                  }}
                >
                  {fullCopy.toasts.restartChannels}
                </Button>
              ) : (
                <span />
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings?.();
                }}
              >
                {copy.channelsPopover.settings}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {/* The same light confirm as Settings → Channels: restarting can
          cut off a reply in progress. Only the Models toast CTA restarts
          without asking. */}
      <ConfirmActionDialog
        open={confirmRestartOpen}
        onOpenChange={setConfirmRestartOpen}
        icon={
          <ArrowsClockwise size={18} weight="bold" className="text-warning" />
        }
        title={imCopy.restartChannelsDialogTitle}
        body={imCopy.restartChannelsDialogBody}
        confirmLabel={fullCopy.toasts.restartChannels}
        confirmVariant="warning"
        confirmIcon={<ArrowsClockwise size={13} />}
        onConfirm={() => {
          setConfirmRestartOpen(false);
          onRestart?.();
        }}
      />
    </>
  );
}

/** Colour only where the user has to act: a failure, a QR to scan. */
function channelStateClass(state: ImSupervisorState) {
  if (state === "error" || state === "expired") return "text-error";
  if (state === "waiting_scan") return "text-warning";
  if (state === "running") return "text-ink-soft";
  return "text-ink-muted";
}
