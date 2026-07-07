import type { LLMOption } from "@/stores/runtime";
import type { RuntimeKind } from "@/types/session";

/**
 * Inputs to the current-LLM display resolution. All data — no i18n. The
 * caller computes any translated fallback (e.g. the managed "unconfigured"
 * label) and passes it in as `managedDisplayName`, so this stays a pure
 * function of the LLM-list sources.
 */
export interface DisplayedLLMInputs {
  runtimeKind: RuntimeKind;
  /** The active session's live per-session runtime list, once seeded/ready. */
  activeRuntimeLLMs: LLMOption[] | undefined;
  activeRuntimeDisplayName: string | undefined;
  /** Managed-runtime source (from managedModelsToLLMs). */
  managedLLMs: LLMOption[];
  managedDisplayName: string;
  /** Cross-session cache — the external-runtime cold-start fallback. */
  cachedLLMs: LLMOption[];
  cachedDisplayName: string;
}

/**
 * Resolve which LLM list + display name the Composer/pill should show,
 * from the several sources that feed it. The precedence lives here, once:
 *
 *   1. the active session's own runtime slot (`activeRuntimeLLMs`) always
 *      wins — it's the live, per-session truth once the bridge has seeded
 *      or reported it;
 *   2. otherwise fall back by runtime kind — managed reads the managed
 *      model store's list, external reads the cross-session cache;
 *   3. display name follows the same precedence, with an empty-string
 *      floor so the pill never renders `undefined`.
 *
 * Pure and i18n-agnostic: the `managedDisplayName` fallback string is
 * computed by the caller. Behavior mirrors the cascade this replaced in
 * App.tsx — this only gives it a single tested home.
 */
export function resolveDisplayedLLM(inputs: DisplayedLLMInputs): {
  llms: LLMOption[];
  displayName: string;
} {
  const fallbackLLMs =
    inputs.runtimeKind === "managed" ? inputs.managedLLMs : inputs.cachedLLMs;
  const fallbackDisplayName =
    inputs.runtimeKind === "managed"
      ? inputs.managedDisplayName
      : inputs.cachedDisplayName;
  return {
    llms: inputs.activeRuntimeLLMs ?? fallbackLLMs,
    displayName: inputs.activeRuntimeDisplayName ?? fallbackDisplayName ?? "",
  };
}
