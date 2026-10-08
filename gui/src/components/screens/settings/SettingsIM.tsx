import {
  ArrowsClockwise,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { restartEnabledChannels } from "@/components/screens/settings/im/channels-restart";
import { DiscordCard } from "@/components/screens/settings/im/DiscordCard";
import { FeishuCard } from "@/components/screens/settings/im/FeishuCard";
import { TelegramCard } from "@/components/screens/settings/im/TelegramCard";
import { WeChatCard } from "@/components/screens/settings/im/WeChatCard";
import type { BusyAction } from "@/components/screens/settings/im/types";
import { SettingsPanelHeader } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useImSupervisorStatus } from "@/hooks/useImSupervisorStatus";
import {
  logoutImSupervisor,
  startImSupervisor,
  stopImSupervisor,
  type ImSupervisorPlatform,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { useCopy } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";

export function SettingsIM({
  hasManagedRuntimeConfigured,
  onOpenModels,
}: {
  hasManagedRuntimeConfigured: boolean;
  onOpenModels: () => void;
}) {
  const copy = useCopy();
  const imCopy = copy.settings.im;
  const {
    status: wechatStatus,
    setStatus: setWechatStatus,
    loadError: wechatStatusLoadError,
  } = useImSupervisorStatus("wechat", hasManagedRuntimeConfigured);
  const {
    status: feishuStatus,
    setStatus: setFeishuStatus,
    loadError: feishuStatusLoadError,
  } = useImSupervisorStatus("feishu", hasManagedRuntimeConfigured);
  const {
    status: telegramStatus,
    setStatus: setTelegramStatus,
    loadError: telegramStatusLoadError,
  } = useImSupervisorStatus("telegram", hasManagedRuntimeConfigured);
  const {
    status: discordStatus,
    setStatus: setDiscordStatus,
    loadError: discordStatusLoadError,
  } = useImSupervisorStatus("discord", hasManagedRuntimeConfigured);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const hasEnabledChannel = [
    wechatStatus,
    feishuStatus,
    telegramStatus,
    discordStatus,
  ].some((status) => status?.enabled);
  const hasStaleEnabledChannel = [
    wechatStatus,
    feishuStatus,
    telegramStatus,
    discordStatus,
  ].some((status) => status?.enabled && status.modelConfigStale);

  const runAction = async (
    action: Exclude<BusyAction, null | "restart">,
    fn: () => Promise<ImSupervisorStatus>,
  ) => {
    setBusyAction(action);
    setInvokeError(null);
    try {
      setWechatStatus(await fn());
    } catch (e) {
      setInvokeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  };

  const restartChannels = async () => {
    setBusyAction("restart");
    const setters: Record<
      ImSupervisorPlatform,
      (status: ImSupervisorStatus) => void
    > = {
      wechat: setWechatStatus,
      feishu: setFeishuStatus,
      telegram: setTelegramStatus,
      discord: setDiscordStatus,
    };
    // Restart failures report through the toast (and each failed card's
    // own status). Writing them into `invokeError` would surface a
    // cross-channel failure inside the WeChat card's error block — wrong
    // attribution.
    try {
      await restartEnabledChannels({
        copy,
        pushToast: (toast) => useUiStore.getState().pushToast(toast),
        setStatus: (status) => setters[status.platform](status),
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.im.title}
        subtitle={imCopy.subtitle}
      />

      {!hasManagedRuntimeConfigured ? (
        <div className="rounded-sm border border-line bg-surface px-4 py-4">
          <div className="text-ui-compact leading-secondary text-ink-soft">
            {imCopy.modelRequired}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={onOpenModels}
          >
            {imCopy.openModels}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {hasStaleEnabledChannel && (
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-warning/25 bg-warning/[var(--opacity-subtle)] px-3 py-2.5">
              <WarningCircle
                size={16}
                weight="bold"
                className="shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <div className="text-ui-secondary font-medium text-ink">
                  {imCopy.staleConfigTitle}
                </div>
                <div className="mt-0.5 text-ui-tertiary leading-notice text-ink-muted">
                  {imCopy.staleConfigBody}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busyAction === "restart"}
                leadingIcon={
                  busyAction === "restart" ? (
                    <CircleNotch size={13} weight="thin" className="spin" />
                  ) : (
                    <ArrowsClockwise size={13} weight="thin" />
                  )
                }
                onClick={() => setConfirmRestartOpen(true)}
              >
                {copy.toasts.restartChannels}
              </Button>
            </div>
          )}

          <WeChatCard
            status={wechatStatus}
            busyAction={busyAction}
            invokeError={invokeError ?? wechatStatusLoadError}
            onConnect={() =>
              runAction("connect", () => startImSupervisor("wechat", false))
            }
            onRescan={() =>
              runAction("rescan", () => startImSupervisor("wechat", true))
            }
            onStop={() => runAction("stop", () => stopImSupervisor("wechat"))}
            onDisconnect={() =>
              runAction("disconnect", () => logoutImSupervisor("wechat"))
            }
          />
          <FeishuCard
            status={feishuStatus}
            statusLoadError={feishuStatusLoadError}
            onStatusChange={setFeishuStatus}
          />
          <TelegramCard
            status={telegramStatus}
            statusLoadError={telegramStatusLoadError}
            onStatusChange={setTelegramStatus}
          />
          <DiscordCard
            status={discordStatus}
            statusLoadError={discordStatusLoadError}
            onStatusChange={setDiscordStatus}
          />

          {hasEnabledChannel && !hasStaleEnabledChannel && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyAction === "restart"}
                leadingIcon={
                  busyAction === "restart" ? (
                    <CircleNotch size={13} weight="thin" className="spin" />
                  ) : (
                    <ArrowsClockwise size={13} weight="thin" />
                  )
                }
                onClick={() => setConfirmRestartOpen(true)}
              >
                {copy.toasts.restartChannels}
              </Button>
            </div>
          )}

          <ConfirmActionDialog
            open={confirmRestartOpen}
            busy={busyAction === "restart"}
            onOpenChange={setConfirmRestartOpen}
            icon={
              <ArrowsClockwise
                size={18}
                weight="bold"
                className="text-warning"
              />
            }
            title={imCopy.restartChannelsDialogTitle}
            body={imCopy.restartChannelsDialogBody}
            confirmLabel={copy.toasts.restartChannels}
            confirmVariant="warning"
            confirmIcon={<ArrowsClockwise size={13} weight="thin" />}
            onConfirm={() => {
              setConfirmRestartOpen(false);
              void restartChannels();
            }}
          />
        </div>
      )}
    </div>
  );
}
