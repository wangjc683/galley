import {
  ArrowsClockwise,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";

import { FeishuCard } from "@/components/screens/settings/im/FeishuCard";
import { RestartChannelsDialog } from "@/components/screens/settings/im/RestartChannelsDialog";
import { WeChatCard } from "@/components/screens/settings/im/WeChatCard";
import type { BusyAction } from "@/components/screens/settings/im/types";
import { SettingsPanelHeader } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useImSupervisorStatus } from "@/hooks/useImSupervisorStatus";
import {
  logoutImSupervisor,
  restartEnabledImSupervisors,
  startImSupervisor,
  stopImSupervisor,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { useCopy } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

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
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const hasEnabledChannel = [wechatStatus, feishuStatus].some(
    (status) => status?.enabled,
  );
  const hasStaleEnabledChannel = [wechatStatus, feishuStatus].some(
    (status) => status?.enabled && status.modelConfigStale,
  );

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
    setInvokeError(null);
    try {
      const statuses = await restartEnabledImSupervisors();
      const wechat = statuses.find((item) => item.platform === "wechat");
      if (wechat) {
        setWechatStatus(wechat);
      }
      const feishu = statuses.find((item) => item.platform === "feishu");
      if (feishu) {
        setFeishuStatus(feishu);
      }
      useUiStore.getState().pushToast(
        makeAppError({
          id: "channels-restarted",
          category: "business",
          severity: "info",
          title:
            statuses.length > 0
              ? copy.toasts.channelsRestarted
              : copy.toasts.channelsRestartNone,
          message:
            statuses.length > 0 ? copy.toasts.channelsRestartedMessage : "",
          hint: null,
          retryable: false,
          context: "restart_enabled_im_supervisors",
          traceback: null,
          autoDismissMs: 4200,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setInvokeError(message);
      useUiStore.getState().pushToast(
        makeAppError({
          id: "channels-restart-failed",
          category: "business",
          severity: "error",
          title: copy.toasts.channelsRestartFailed,
          message,
          hint: null,
          retryable: false,
          context: "restart_enabled_im_supervisors",
          traceback: null,
        }),
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.im.label}
        subtitle={imCopy.subtitle}
      />

      {!hasManagedRuntimeConfigured ? (
        <div className="rounded-sm border border-line bg-surface px-4 py-4">
          <div className="text-[13px] leading-[1.55] text-ink-soft">
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
          <div className="flex items-center">
            <Button
              type="button"
              variant={hasStaleEnabledChannel ? "secondary" : "ghost"}
              size="sm"
              disabled={busyAction === "restart" || !hasEnabledChannel}
              leadingIcon={
                busyAction === "restart" ? (
                  <CircleNotch size={13} className="animate-spin" />
                ) : hasStaleEnabledChannel ? (
                  <WarningCircle size={13} weight="bold" />
                ) : (
                  <ArrowsClockwise size={13} />
                )
              }
              onClick={() => setConfirmRestartOpen(true)}
            >
              {copy.toasts.restartChannels}
            </Button>
          </div>
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
          <RestartChannelsDialog
            open={confirmRestartOpen}
            busy={busyAction === "restart"}
            onOpenChange={setConfirmRestartOpen}
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
