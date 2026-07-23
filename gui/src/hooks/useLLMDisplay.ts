import { useMemo } from "react";

import { resolveSidebarRuntimeIndicator } from "@/components/layout/sidebar/runtime-indicator";
import { useActiveRuntime } from "@/hooks/useActiveSession";
import { resolveDisplayedLLM } from "@/lib/current-llm";
import type { AppCopy } from "@/lib/i18n";
import {
  currentLLMDisplayName,
  managedModelsToLLMs,
} from "@/lib/managed-model-options";
import { useManagedModelsStore } from "@/stores/managed-models";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import type { Screen } from "@/stores/ui";

/**
 * The Composer/Sidebar LLM projection: resolve which LLM list + display
 * name the UI shows (active session slot > managed / external fallback,
 * see `resolveDisplayedLLM`), plus the managed-model-config gates
 * derived from the same inputs. i18n stays here (`managedLLMDisplayName`,
 * `llmConfigHint`); display precedence lives in `resolveDisplayedLLM`.
 */
export function useLLMDisplay({
  screen,
  copy,
}: {
  screen: Screen;
  copy: AppCopy;
}) {
  // LLM / runtimeInfo state lives in runtimeStore (M3a). Subscribe to
  // the active session's per-runtime entry so the Composer pill +
  // dropdown + Inspector tab re-render on changes.
  const activeSessionLLMs = useActiveRuntime((r) => r.llms, undefined);
  const activeSessionLLMDisplayName = useActiveRuntime(
    (r) => r.llmDisplayName,
    undefined,
  );
  // Only surface the per-session LLM on the main screen (empty / settings
  // screens fall back to cached / managed in resolveDisplayedLLM).
  const activeRuntimeLLMs = screen === "main" ? activeSessionLLMs : undefined;
  const activeRuntimeDisplayName =
    screen === "main" ? activeSessionLLMDisplayName : undefined;
  const cachedLLMs = useRuntimeStore((s) => s.cachedLLMs);
  const cachedLLMDisplayName = useRuntimeStore((s) => s.cachedLLMDisplayName);
  const pendingLLMIndex = useRuntimeStore((s) => s.pendingLLMIndex);
  const gaConfig = usePrefsStore((s) => s.gaConfig);
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const managedModels = useManagedModelsStore((s) => s.models);

  const managedLLMs = useMemo(
    () => managedModelsToLLMs(managedModels, pendingLLMIndex),
    [managedModels, pendingLLMIndex],
  );
  const managedLLMDisplayName = currentLLMDisplayName(
    managedLLMs,
    copy.app.unconfiguredModel,
  );
  const { llms, displayName: llmDisplayName } = resolveDisplayedLLM({
    runtimeKind: activeRuntimeKind,
    activeRuntimeLLMs,
    activeRuntimeDisplayName,
    managedLLMs,
    managedDisplayName: managedLLMDisplayName,
    cachedLLMs,
    cachedDisplayName: cachedLLMDisplayName,
  });
  const llmConfigHint =
    activeRuntimeKind === "managed" ? undefined : copy.app.externalModelHint;
  const hasConfiguredManagedModel = managedModels.some(
    (model) => model.credentialStatus !== "missing",
  );
  const requiresManagedModelConfig =
    activeRuntimeKind === "managed" && !hasConfiguredManagedModel;
  const sidebarRuntimeIndicator = resolveSidebarRuntimeIndicator(
    activeRuntimeKind,
    hasConfiguredManagedModel,
    gaConfig,
  );

  return {
    llms,
    llmDisplayName,
    llmConfigHint,
    hasConfiguredManagedModel,
    requiresManagedModelConfig,
    sidebarRuntimeIndicator,
  };
}
