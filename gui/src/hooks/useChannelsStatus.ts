import { restartEnabledChannels } from "@/components/screens/settings/im/channels-restart";
import type { AppCopy } from "@/lib/i18n";
import type {
  ImSupervisorPlatform,
  ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { useImSupervisorStatus } from "@/hooks/useImSupervisorStatus";
import type { AppError } from "@/types/app-error";

/**
 * The four IM channel status feeds (WeChat / Feishu / Telegram / Discord),
 * handed to the MainHeader as one per-platform list (the topbar lamp and
 * its popover derive everything from it), plus the "restart channels"
 * action shared by the toast CTA and that popover. `useImSupervisorStatus`
 * holds per-instance polling state, so this hook must be mounted exactly
 * once (App) and its outputs passed down — a second mount would
 * double-poll every platform.
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
  const discordChannelsStatus = useImSupervisorStatus("discord", enabled);

  // Fixed order = the Settings → Channels card order.
  const channelStatuses: Array<ImSupervisorStatus | null> = enabled
    ? [
        wechatChannelsStatus.status,
        feishuChannelsStatus.status,
        telegramChannelsStatus.status,
        discordChannelsStatus.status,
      ]
    : [];
  const channelsLoadError = enabled
    ? (wechatChannelsStatus.loadError ??
      feishuChannelsStatus.loadError ??
      telegramChannelsStatus.loadError ??
      discordChannelsStatus.loadError)
    : null;

  const restartChannels = () => {
    const setters: Record<
      ImSupervisorPlatform,
      (status: ImSupervisorStatus) => void
    > = {
      wechat: wechatChannelsStatus.setStatus,
      feishu: feishuChannelsStatus.setStatus,
      telegram: telegramChannelsStatus.setStatus,
      discord: discordChannelsStatus.setStatus,
    };
    return restartEnabledChannels({
      copy,
      pushToast,
      setStatus: (status) => setters[status.platform](status),
    });
  };

  return { channelStatuses, channelsLoadError, restartChannels };
}
