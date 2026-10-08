import { useCallback } from "react";

import { getImSupervisorStatus } from "@/lib/im-supervisor";
import { useCopy } from "@/lib/i18n";
import { managedModelsErrorText } from "@/stores/managed-models";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { RuntimeKind } from "@/types/session";

export function useModelConfigSavedToast(
  activeRuntimeKind: RuntimeKind = "managed",
) {
  const copy = useCopy();

  return useCallback(
    (message = copy.toasts.modelConfigSavedMessage) => {
      const push = (hasEnabledChannel: boolean, body = message) => {
        const toastMessage = hasEnabledChannel
          ? body === copy.toasts.modelConfigSavedMessage
            ? copy.toasts.modelConfigSavedChannelsMessage
            : `${body} ${copy.toasts.modelConfigSavedChannelsSuffix}`
          : body;
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

      // External GA: this page only configures the built-in engine, so
      // nothing takes effect for new chats until the user switches back,
      // and the Channels (served by the external GA, their tab hidden)
      // have nothing to restart — no status probe, no CTA.
      if (activeRuntimeKind === "external") {
        push(false, copy.toasts.modelConfigSavedExternalMessage);
        return;
      }

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
    [activeRuntimeKind, copy],
  );
}

/**
 * Error toast for Settings → 模型 failures that have no on-surface home:
 * every write (order, default, add / remove model, provider save /
 * delete, defaults, clear key) and a revalidating load that failed over
 * data already on screen. One stable id per kind, so a burst of failed
 * clicks replaces one card instead of stacking. Probe failures (check
 * provider, test model, read model list) stay inline next to what was
 * probed. Body is the raw error; the title carries the localized words.
 */
export function useModelConfigErrorToast() {
  const copy = useCopy();

  return useCallback(
    (error: unknown, context: string, kind: "action" | "load" = "action") => {
      useUiStore.getState().pushToast(
        makeAppError({
          // "load" shares hydrate's id: the same failure seen again on
          // tab entry replaces the startup card rather than doubling it.
          id:
            kind === "load"
              ? "managed-models-load-failed"
              : "managed-model-config-action-failed",
          category: "business",
          severity: "error",
          title:
            kind === "load"
              ? copy.settings.models.loadFailed
              : copy.settings.models.actionFailed,
          message: managedModelsErrorText(error),
          hint: null,
          retryable: false,
          context,
          traceback: null,
        }),
      );
    },
    [copy],
  );
}
