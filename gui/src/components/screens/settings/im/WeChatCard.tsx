import { convertFileSrc } from "@tauri-apps/api/core";
import { CircleNotch, QrCode } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import type {
  ImSupervisorState,
  ImSupervisorStatus,
} from "@/lib/im-supervisor";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { ChannelCard } from "./ChannelCard";
import { ChannelErrorBlock } from "./ChannelErrorBlock";
import { ChannelPrimaryButton, ChannelStatusHint } from "./ChannelParts";
import {
  canPauseChannel,
  channelBadgeKind,
  channelCardView,
  configuredPrimaryAction,
  errorReplacesStatusHint,
  isChannelSetUp,
} from "./channel-view";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ChannelCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { WeChatGlyph } from "./Glyphs";
import { StatusBadge } from "./StatusBadge";
import { channelStatusHint, shouldAutoExpand } from "./status";
import type { BusyAction, ImCopy } from "./types";

export function WeChatCard({
  status,
  busyAction,
  invokeError,
  onConnect,
  onRescan,
  onStop,
  onDisconnect,
}: {
  status: ImSupervisorStatus | null;
  busyAction: BusyAction;
  invokeError: string | null;
  onConnect: () => void;
  onRescan: () => void;
  onStop: () => void;
  onDisconnect: () => void;
}) {
  const appCopy = useCopy();
  const imCopy = appCopy.settings.im;
  const state = status?.state ?? "not_connected";
  const qrSrc = status?.qrImagePath
    ? `${convertFileSrc(status.qrImagePath)}?v=${encodeURIComponent(status.updatedAt)}`
    : null;
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const expanded = expandedOverride ?? shouldAutoExpand(state);
  const showQr = expanded && state === "waiting_scan";
  const canPause = canPauseChannel(status);
  const canDisconnect =
    state === "running" ||
    state === "expired" ||
    state === "error" ||
    state === "stopped";
  // WeChat has no owner pairing: holding a login token is its setup.
  const setUp = isChannelSetUp("wechat", state, null);
  const view = channelCardView("wechat", state, setUp);
  const errorText = invokeError ?? status?.lastError ?? null;
  // While the QR is up, the line beside it already says "scan to
  // connect"; a status line here would be the third copy of it.
  const statusHint =
    state === "waiting_scan" || errorReplacesStatusHint(state, errorText)
      ? null
      : channelStatusHint("wechat", state, setUp, imCopy);
  const primaryAction = configuredPrimaryAction(state);
  const errorBlock = (
    <ChannelErrorBlock platform="wechat" state={state} error={errorText} />
  );

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<WeChatGlyph active={expanded} />}
        title={imCopy.wechatTitle}
        badge={<StatusBadge kind={channelBadgeKind("wechat", state, setUp)} />}
        busy={busyAction !== null}
        actions={
          canPause || canDisconnect ? (
            <ChannelActionsMenu
              disabled={busyAction !== null}
              canStop={canPause}
              canDisconnect={canDisconnect}
              onStop={onStop}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          ) : null
        }
      >
        <div className="space-y-3 pl-8 pr-1">
          {view === "running" ? (
            <>
              {statusHint ? (
                <ChannelStatusHint>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
              <ChannelCommandReference platform="wechat" />
            </>
          ) : view === "configured" ? (
            <>
              {statusHint ? (
                <ChannelStatusHint>{statusHint}</ChannelStatusHint>
              ) : null}
              {errorBlock}
              {primaryAction ? (
                <ChannelPrimaryButton
                  action={primaryAction}
                  disabled={busyAction !== null}
                  pending={busyAction === "connect"}
                  onClick={onConnect}
                />
              ) : null}
            </>
          ) : (
            <>
              <ConnectionSteps steps={imCopy.setupSteps} status={statusHint} />
              {errorBlock}
              <WeChatSetupAction
                imCopy={imCopy}
                state={state}
                busyAction={busyAction}
                onConnect={onConnect}
                onRescan={onRescan}
              />
              {showQr ? (
                <div className="flex flex-wrap items-center gap-5">
                  <div className="flex h-[168px] w-[168px] shrink-0 items-center justify-center rounded-sm border border-line bg-elevated">
                    {qrSrc ? (
                      <img
                        src={qrSrc}
                        alt={imCopy.qrAlt}
                        className="h-[148px] w-[148px] object-contain"
                      />
                    ) : (
                      <span className="text-ui-meta text-ink-muted">
                        {imCopy.noQrYet}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 space-y-3 text-ui-compact leading-secondary text-ink-soft">
                    <p>{imCopy.scanHint}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busyAction !== null}
                      leadingIcon={
                        busyAction === "rescan" ? (
                          <CircleNotch
                            size={13}
                            weight="thin"
                            className="spin"
                          />
                        ) : (
                          <QrCode size={13} weight="thin" />
                        )
                      }
                      onClick={onRescan}
                    >
                      {busyAction === "rescan"
                        ? imCopy.working
                        : imCopy.regenerateQr}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </ChannelCard>

      <ConfirmActionDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        busy={busyAction !== null}
        title={imCopy.disconnectDialogTitle}
        body={imCopy.disconnectDialogBody}
        confirmLabel={imCopy.disconnect}
        onConfirm={() => {
          setConfirmDisconnectOpen(false);
          onDisconnect();
        }}
      />
    </>
  );
}

/** The onboarding view's action: connect from scratch, or reconnect an
 * expired login (a fresh scan). While the QR is up, its own
 * regenerate button is the action. */
function WeChatSetupAction({
  imCopy,
  state,
  busyAction,
  onConnect,
  onRescan,
}: {
  imCopy: ImCopy;
  state: ImSupervisorState;
  busyAction: BusyAction;
  onConnect: () => void;
  onRescan: () => void;
}) {
  if (state === "waiting_scan") return null;
  const busy = busyAction !== null;
  const expired = state === "expired";
  const pending = busyAction === (expired ? "rescan" : "connect");
  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={busy}
        leadingIcon={
          pending ? (
            <CircleNotch size={13} weight="thin" className="spin" />
          ) : (
            <QrCode size={13} weight="thin" />
          )
        }
        onClick={expired ? onRescan : onConnect}
      >
        {pending ? imCopy.working : expired ? imCopy.reconnect : imCopy.connect}
      </Button>
    </div>
  );
}
