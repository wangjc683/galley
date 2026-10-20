import { useEffect, useMemo } from "react";

import { chatGptPlanModelIds, chatGptProviderIds } from "@/lib/chatgpt-plan";
import { useChatGptPlanStore } from "@/stores/chatgpt-plan";
import { useManagedModelsStore } from "@/stores/managed-models";
import { usePrefsStore } from "@/stores/prefs";

const NONE: ReadonlySet<string> = new Set();

/**
 * The managed model ids that spend the ChatGPT plan (Sign in with
 * ChatGPT, .scratch/chatgpt-siwc ticket 04), for the composer's plan
 * label. The managed runtime only: the external GA's model list is its
 * own. Reads each ChatGPT provider's plan status once if nothing has.
 */
export function useChatGptPlanModelIds(): ReadonlySet<string> {
  const runtimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const models = useManagedModelsStore((s) => s.models);
  const statusByProvider = useChatGptPlanStore((s) => s.statusByProvider);
  const ensureStatus = useChatGptPlanStore((s) => s.ensureStatus);
  const managed = runtimeKind === "managed";
  const providerKey = useMemo(
    () => chatGptProviderIds(models).join("\n"),
    [models],
  );

  useEffect(() => {
    if (!managed || providerKey === "") return;
    for (const providerId of providerKey.split("\n")) ensureStatus(providerId);
  }, [ensureStatus, managed, providerKey]);

  return useMemo(
    () => (managed ? chatGptPlanModelIds(models, statusByProvider) : NONE),
    [managed, models, statusByProvider],
  );
}
