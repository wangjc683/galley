import { useCallback } from "react";

import { getImSupervisorStatus } from "@/lib/im-supervisor";
import { useCopy } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

export function useModelConfigSavedToast() {
  const copy = useCopy();

  return useCallback(
    (message = copy.toasts.modelConfigSavedMessage) => {
      const push = (hasEnabledChannel: boolean) => {
        const toastMessage = hasEnabledChannel
          ? message === copy.toasts.modelConfigSavedMessage
            ? copy.toasts.modelConfigSavedChannelsMessage
            : `${message} ${copy.toasts.modelConfigSavedChannelsSuffix}`
          : message;
        useUiStore.getState().pushToast(
          makeAppError({
            id: "managed-model-config-saved",
            category: "business",
            severity: "info",
            title: copy.toasts.modelConfigSaved,
            message: toastMessage,
            hint: null,
            retryable: false,
            context: "save_managed_model_config",
            traceback: null,
            action: hasEnabledChannel
              ? {
                  kind: "restart_channels",
                  label: copy.toasts.restartChannels,
                }
              : null,
            autoDismissMs: hasEnabledChannel ? 8000 : 4200,
          }),
        );
      };

      void Promise.allSettled([
        getImSupervisorStatus("wechat"),
        getImSupervisorStatus("feishu"),
        getImSupervisorStatus("telegram"),
        getImSupervisorStatus("discord"),
      ])
        .then((results) =>
          push(
            results.some(
              (result) => result.status === "fulfilled" && result.value.enabled,
            ),
          ),
        )
        .catch(() => push(false));
    },
    [copy],
  );
}
