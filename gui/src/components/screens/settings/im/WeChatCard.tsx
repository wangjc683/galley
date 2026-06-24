import { convertFileSrc } from "@tauri-apps/api/core";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CaretDown,
  CaretRight,
  CircleNotch,
  Power,
  QrCode,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import type {
  ImSupervisorState,
  ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { cn } from "@/lib/utils";

import { ChannelActionsMenu } from "./ChannelActionsMenu";
import { WeChatCommandReference } from "./CommandReference";
import { ConnectionSteps } from "./ConnectionSteps";
import { WeChatGlyph } from "./Glyphs";
import { StatusBadge } from "./StatusBadge";
import { statusHintForState, stepsForState } from "./status";
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
  const commonCopy = appCopy.common;
  const state = status?.state ?? "not_connected";
  const qrSrc = status?.qrImagePath
    ? `${convertFileSrc(status.qrImagePath)}?v=${encodeURIComponent(status.updatedAt)}`
    : null;
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const attentionState =
    state === "waiting_scan" || state === "expired" || state === "error";
  const expanded = expandedOverride ?? attentionState;
  const showQr = expanded && state === "waiting_scan";
  const canPause = state === "running";
  const canDisconnect =
    state === "running" ||
    state === "expired" ||
    state === "error" ||
    state === "stopped";

  return (
    <section
      className={cn(
        "group/im overflow-hidden rounded-sm border border-line bg-surface transition-colors",
        expanded && "border-line-strong",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 px-2 py-1.5 transition-colors",
          expanded && "bg-hover/40",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          className={cn(
            "group/toggle flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-0.5 text-left transition-colors",
            "hover:bg-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
          )}
          onClick={() => setExpandedOverride(!expanded)}
        >
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-soft transition-colors",
              expanded && "text-ink",
            )}
          >
            {expanded ? (
              <CaretDown size={12} weight="bold" />
            ) : (
              <CaretRight size={12} weight="bold" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <WeChatGlyph active={expanded} />
            <span
              className="min-w-0 truncate text-[13px] font-medium text-ink"
              title={imCopy.wechatTitle}
            >
              {imCopy.wechatTitle}
            </span>
            <StatusBadge state={state} />
          </span>
        </button>
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5 opacity-80 transition-opacity",
            "group-hover/im:opacity-100 group-focus-within/im:opacity-100",
            busyAction && "opacity-100",
          )}
        >
          {canPause || canDisconnect ? (
            <ChannelActionsMenu
              disabled={busyAction !== null}
              canStop={canPause}
              canDisconnect={canDisconnect}
              onStop={onStop}
              onDisconnect={() => setConfirmDisconnectOpen(true)}
            />
          ) : null}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line/70 bg-hover/25 px-2.5 py-3">
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
                    <span className="text-[12px] text-ink-muted">
                      {imCopy.noQrYet}
                    </span>
                  )}
                </div>
                <div className="min-w-0 space-y-3 text-[13px] leading-[1.55] text-ink-soft">
                  <p>{imCopy.scanHint}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyAction !== null}
                    leadingIcon={
                      busyAction === "rescan" ? (
                        <CircleNotch size={13} className="animate-spin" />
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

            {invokeError || status?.lastError ? (
              <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-error/80">
                  {imCopy.lastError}
                </div>
                <div className="select-text break-words font-mono text-[11.5px] leading-[1.45] text-error">
                  {invokeError ?? status?.lastError}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Dialog.Root
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
          <Dialog.Content
            role="alertdialog"
            aria-describedby="disconnect-wechat-desc"
            className={cn(
              "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
              "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            )}
          >
            <div className="flex items-center gap-2">
              <WarningCircle size={18} weight="bold" className="text-warning" />
              <Dialog.Title className="text-[15px] font-semibold text-ink">
                {imCopy.disconnectDialogTitle}
              </Dialog.Title>
            </div>
            <p
              id="disconnect-wechat-desc"
              className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
            >
              {imCopy.disconnectDialogBody}
            </p>
            <DialogActionRow>
              <Button
                variant="secondary"
                onClick={() => setConfirmDisconnectOpen(false)}
                disabled={busyAction !== null}
                autoFocus
              >
                {commonCopy.cancel}
              </Button>
              <Button
                variant="destructive-soft"
                disabled={busyAction !== null}
                onClick={() => {
                  setConfirmDisconnectOpen(false);
                  onDisconnect();
                }}
              >
                {imCopy.disconnect}
              </Button>
            </DialogActionRow>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
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
  const loadingIcon = <CircleNotch size={13} className="animate-spin" />;

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
