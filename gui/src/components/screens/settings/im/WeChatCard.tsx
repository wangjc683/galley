import { convertFileSrc } from "@tauri-apps/api/core";
import { CircleNotch, Power, QrCode } from "@phosphor-icons/react";
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
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { WeChatCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { WeChatGlyph } from "./Glyphs";
import { StatusBadge } from "./StatusBadge";
import { shouldAutoExpand, statusHintForState, stepsForState } from "./status";
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
  const canPause = state === "running";
  const canDisconnect =
    state === "running" ||
    state === "expired" ||
    state === "error" ||
    state === "stopped";

  return (
    <>
      <ChannelCard
        expanded={expanded}
        onToggle={() => setExpandedOverride(!expanded)}
        glyph={<WeChatGlyph active={expanded} />}
        title={imCopy.wechatTitle}
        badge={<StatusBadge state={state} />}
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
          <ConnectionSteps
            steps={stepsForState(state, imCopy)}
            status={statusHintForState(state, imCopy)}
          />

          {state === "running" ? (
            <WeChatCommandReference imCopy={imCopy} />
          ) : null}

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
                      <CircleNotch size={13} className="spin" />
                    ) : (
                      <QrCode size={13} />
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

          <ChannelErrorBlock error={invokeError ?? status?.lastError ?? null} />
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
  const busy = busyAction !== null;
  const loadingIcon = <CircleNotch size={13} className="spin" />;

  if (state === "running") return null;
  if (state === "starting" || state === "reconnecting") {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled
        leadingIcon={loadingIcon}
      >
        {imCopy.working}
      </Button>
    );
  }
  if (state === "waiting_scan") return null;
  if (state === "expired") {
    return (
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={busy}
        leadingIcon={
          busyAction === "rescan" ? loadingIcon : <QrCode size={13} />
        }
        onClick={onRescan}
      >
        {busyAction === "rescan" ? imCopy.working : imCopy.reconnect}
      </Button>
    );
  }
  if (state === "error") {
    return (
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={busy}
        leadingIcon={
          busyAction === "connect" ? loadingIcon : <Power size={13} />
        }
        onClick={onConnect}
      >
        {busyAction === "connect" ? imCopy.working : imCopy.retry}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      disabled={busy}
      leadingIcon={
        busyAction === "connect" ? loadingIcon : <QrCode size={13} />
      }
      onClick={onConnect}
    >
      {busyAction === "connect" ? imCopy.working : imCopy.connect}
    </Button>
  );
}
