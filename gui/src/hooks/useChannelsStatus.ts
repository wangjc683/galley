import type { AppCopy } from "@/lib/i18n";
import {
  aggregateChannelsState,
  restartEnabledImSupervisors,
  type ImSupervisorState,
} from "@/lib/im-supervisor";
import { useImSupervisorStatus } from "@/hooks/useImSupervisorStatus";
import { makeAppError } from "@/types/app-error";
import type { AppError } from "@/types/app-error";

/**
 * The three IM channel status feeds (WeChat / Feishu / Telegram) plus
 * their MainHeader aggregate and the toast-driven "restart channels"
 * action. `useImSupervisorStatus` holds per-instance polling state, so
 * this hook must be mounted exactly once (App) and its outputs passed
 * down — a second mount would double-poll every platform.
 */
export function useChannelsStatus({
  enabled,
  copy,
  pushToast,
}: {
  /** Managed runtime only — channels don't exist for attach mode. */
  enabled: boolean;
  copy: AppCopy;
  pushToast: (error: AppError) => void;
}) {
  const wechatChannelsStatus = useImSupervisorStatus("wechat", enabled);
  const feishuChannelsStatus = useImSupervisorStatus("feishu", enabled);
  const telegramChannelsStatus = useImSupervisorStatus("telegram", enabled);

  const channelsState: ImSupervisorState | null = enabled
    ? aggregateChannelsState([
        wechatChannelsStatus.status?.state,
        feishuChannelsStatus.status?.state,
        telegramChannelsStatus.status?.state,
      ])
    : null;
  const channelsLoadError = enabled
    ? (wechatChannelsStatus.loadError ??
      feishuChannelsStatus.loadError ??
      telegramChannelsStatus.loadError)
    : null;

  const restartChannels = async () => {
    try {
      const statuses = await restartEnabledImSupervisors();
      const wechat = statuses.find((status) => status.platform === "wechat");
      if (wechat) {
        wechatChannelsStatus.setStatus(wechat);
      }
      const feishu = statuses.find((status) => status.platform === "feishu");
      if (feishu) {
        feishuChannelsStatus.setStatus(feishu);
      }
      const telegram = statuses.find(
        (status) => status.platform === "telegram",
      );
      if (telegram) {
        telegramChannelsStatus.setStatus(telegram);
      }
      pushToast(
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
      pushToast(
        makeAppError({
          id: "channels-restart-failed",
          category: "business",
          severity: "error",
          title: copy.toasts.channelsRestartFailed,
          message: e instanceof Error ? e.message : String(e),
          hint: null,
          retryable: false,
          context: "restart_enabled_im_supervisors",
          traceback: null,
        }),
      );
    }
  };

  return { channelsState, channelsLoadError, restartChannels };
}
