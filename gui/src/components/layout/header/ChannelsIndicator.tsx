import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowsClockwise, ChatCircleText, Gear } from "@phosphor-icons/react";
import { useRef, useState } from "react";

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
import {
  STATUS_MENU_CONTENT,
  STATUS_MENU_ITEM,
  STATUS_MENU_ROW,
  STATUS_MENU_SEPARATOR,
} from "./status-menu";
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
 *     keep their text badges. Either form opens a status menu
 *     (`status-menu.ts`): one row per configured platform with its state
 *     (the Settings card words), a separator, then 重启 Channels behind
 *     the same confirm Settings uses and 设置…. Only platforms the user
 *     set up are listed — no placeholders for the rest (2026-05-31: not
 *     a platform inventory).
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
  // Both items hand focus to a dialog (the restart confirm, Settings);
  // returning it to the trigger as the menu closes would pull it back.
  const focusHandedOffRef = useRef(false);
  const configured = configuredChannels(statuses);
  const status = channelsIndicatorStatus(configured, loadError);
  // Disconnecting the last platform from Settings while the menu is
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
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <TooltipLabel text={title} side="bottom">
          <DropdownMenu.Trigger asChild>
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
          </DropdownMenu.Trigger>
        </TooltipLabel>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            onCloseAutoFocus={(event) => {
              if (focusHandedOffRef.current) {
                focusHandedOffRef.current = false;
                event.preventDefault();
              }
            }}
            className={STATUS_MENU_CONTENT}
          >
            {loadError && (
              <div
                className={cn(
                  STATUS_MENU_ROW,
                  "text-ui-meta leading-secondary",
                )}
              >
                <div className="font-medium text-error">
                  {copy.channelsPopover.loadFailed}
                </div>
                <div className="mt-0.5 select-text break-words text-ink-soft">
                  {loadError}
                </div>
              </div>
            )}
            {configured.map((channel) => (
              <div key={channel.platform} className={STATUS_MENU_ROW}>
                <div className="flex items-baseline justify-between gap-6">
                  <span>{channelPlatformLabel(channel.platform, imCopy)}</span>
                  <span
                    className={cn(
                      "shrink-0 text-ui-meta",
                      channelStateClass(channel.state),
                    )}
                  >
                    {channelStateLabel(channel.state, imCopy)}
                  </span>
                </div>
                {(channel.state === "error" || channel.state === "expired") &&
                  channel.lastError && (
                    <div className="mt-0.5 line-clamp-2 select-text break-words text-ui-tertiary leading-snug text-ink-muted">
                      {channel.lastError}
                    </div>
                  )}
              </div>
            ))}
            <DropdownMenu.Separator className={STATUS_MENU_SEPARATOR} />
            {canRestart && (
              <DropdownMenu.Item
                onSelect={() => {
                  focusHandedOffRef.current = true;
                  setConfirmRestartOpen(true);
                }}
                className={STATUS_MENU_ITEM}
              >
                <ArrowsClockwise
                  size={14}
                  weight="thin"
                  className="text-ink-soft"
                />
                <span>{fullCopy.toasts.restartChannels}</span>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              onSelect={() => {
                focusHandedOffRef.current = true;
                onOpenSettings?.();
              }}
              className={STATUS_MENU_ITEM}
            >
              <Gear size={14} weight="thin" className="text-ink-soft" />
              <span>{copy.channelsPopover.settings}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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

/**
 * The Settings card badge colours, so a word reads the same in both
 * places: 已接入 in the restrained success green (JC, 2026-10-04: a
 * glance down the rows should show health by colour), failures red, a
 * QR to scan amber; paused and the rest stay muted ink.
 */
function channelStateClass(state: ImSupervisorState) {
  if (state === "error" || state === "expired") return "text-error";
  if (state === "waiting_scan") return "text-warning";
  if (state === "running") return "text-success";
  return "text-ink-muted";
}
