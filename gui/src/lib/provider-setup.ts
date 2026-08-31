import type { useCopy } from "@/lib/i18n";
import {
  managedModelProviderPresetDraft,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import type {
  CodexDeviceLoginStart,
  TimedManagedModelConnectionResult,
  completeChatGptCodexLogin,
} from "@/lib/managed-models";
import type { ManagedModelsStore } from "@/stores/managed-models";
import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
} from "@/types/managed-models";

/**
 * Pure core shared by the two provider-config surfaces (onboarding
 * StepModelConfig and Settings → 模型). The stateful orchestration
 * lives in `use-provider-setup-controller.ts`; everything here is
 * node-testable — form shapes, fingerprints, gating predicates, and
 * the save/codex commit sequences with injected store actions.
 */

export type SettingsModelsCopy = ReturnType<
  typeof useCopy
>["settings"]["models"];

/**
 * `commit` is the onboarding "start using Galley" save-provider+model
 * action (the old local SetupState `"start"`); the other three are the
 * settings probe vocabulary. Consumers only ever equality-check the
 * action, so the union is additive-safe.
 */
export type ProbeAction =
  | "provider-test"
  | "model-list"
  | "model-test"
  | "commit";

export type ProbeState =
  | { kind: "idle" }
  | { kind: "loading"; action: ProbeAction }
  | { kind: "success"; action: ProbeAction; message: string }
  | { kind: "error"; action: ProbeAction; message: string };

export type ProviderFormState = {
  id?: string;
  providerPresetId: ManagedModelProviderPresetId | null;
  protocol: ManagedModelProtocol | null;
  authKind: ManagedModelAuthKind;
  apiKey: string;
  apiBase: string;
  model: string;
  displayName: string;
  advancedOptions?: Record<string, unknown>;
};

export function newProviderForm(): ProviderFormState {
  return {
    providerPresetId: null,
    protocol: null,
    authKind: "api_key",
    apiKey: "",
    apiBase: "",
    model: "",
    displayName: "",
  };
}

export function providerFormFromPreset(
  providerPresetId: ManagedModelProviderPresetId,
  preserved?: Pick<ProviderFormState, "id" | "apiKey">,
): ProviderFormState {
  const draft = managedModelProviderPresetDraft(providerPresetId);
  return {
    ...(preserved?.id ? { id: preserved.id } : {}),
    ...draft,
    authKind: draft.authKind ?? "api_key",
    apiKey: preserved?.apiKey ?? "",
  };
}

export function connectionSuccessMessage(
  result: TimedManagedModelConnectionResult,
  context: "provider" | "setup-model" | "saved-model",
  copy: SettingsModelsCopy,
): string {
  const message =
    context === "provider"
      ? copy.connectionUsable
      : context === "saved-model"
        ? copy.modelUsable
        : result.modelFound === true
          ? copy.modelUsable
          : copy.connectionUsableCanSave;
  return copy.connectionLatency(message, result.latencyMs);
}

/**
 * The auth kind a save or probe should actually carry. A blank key is
 * overloaded: on an edit with a saved key it means "keep the existing
 * key" (api_key), everywhere else it means "this endpoint needs no
 * auth" (none — local endpoints like Ollama). Typing a key always
 * wins, so a no-auth provider upgrades to api_key by just entering
 * one.
 */
export function effectiveProviderAuthKind(
  form: Pick<ProviderFormState, "authKind" | "apiKey">,
  providerHasSavedKey: boolean,
): ManagedModelAuthKind {
  if (form.authKind === "chatgpt_codex_oauth") return "chatgpt_codex_oauth";
  if (form.apiKey.trim() !== "") return "api_key";
  if (form.authKind === "none") return "none";
  return providerHasSavedKey ? "api_key" : "none";
}

/** Trimmed probe input for the auto connection test. Null until a
 * protocol is chosen. */
export function formToProbeInput(form: ProviderFormState): {
  protocol: ManagedModelProtocol;
  authKind: ManagedModelAuthKind;
  apiKey: string;
  apiBase: string;
  model: string;
  advancedOptions?: Record<string, unknown>;
} | null {
  if (!form.protocol) return null;
  return {
    // Create-flow only (the auto test never runs on an edit), so a
    // blank key resolves to a no-auth probe rather than "keep saved".
    protocol: form.protocol,
    authKind: effectiveProviderAuthKind(form, false),
    apiKey: form.apiKey.trim(),
    apiBase: form.apiBase.trim(),
    model: form.model.trim(),
    advancedOptions: form.advancedOptions,
  };
}

/** Identity of one credential+endpoint+model combination — a passing
 * connection test is only valid for the exact fingerprint it ran
 * against. */
export function providerConnectionFingerprint(form: ProviderFormState): string {
  return JSON.stringify({
    providerPresetId: form.providerPresetId,
    protocol: form.protocol,
    authKind: form.authKind,
    apiKey: form.apiKey.trim(),
    apiBase: form.apiBase.trim(),
    model: form.model.trim(),
  });
}

/** Model-independent fingerprint for the silent model-list auto-fetch:
 * the list only depends on credentials + endpoint, so typing a model
 * name must not re-trigger it. */
export function providerListFingerprint(form: ProviderFormState): string {
  return JSON.stringify({
    providerPresetId: form.providerPresetId,
    protocol: form.protocol,
    authKind: form.authKind,
    apiKey: form.apiKey.trim(),
    apiBase: form.apiBase.trim(),
  });
}

/**
 * Commit (save) gate. With `requireVerifiedConnection: false` this is
 * exactly the settings `canSaveProvider` truth table; with it on, the
 * onboarding Start CTA additionally demands a preset, an idle probe,
 * and a connection test that passed for the *current* fingerprint.
 */
export function canCommitProviderSetup(args: {
  form: ProviderFormState | null;
  saving: boolean;
  probeLoading: boolean;
  providerHasSavedKey: boolean;
  isCreating: boolean;
  requireVerifiedConnection: boolean;
  verifiedFingerprint: string | null;
  currentFingerprint: string;
}): boolean {
  const { form } = args;
  if (!form) return false;
  if (form.authKind === "chatgpt_codex_oauth") return false;
  if (form.protocol === null) return false;
  if (form.apiBase.trim() === "") return false;
  // A blank key is a valid save: it resolves to a no-auth provider
  // (effectiveProviderAuthKind), guarded by a confirm dialog instead
  // of a dead Save button.
  if (args.isCreating && form.model.trim() === "") return false;
  if (args.saving) return false;
  if (!args.requireVerifiedConnection) return true;
  if (form.providerPresetId === null) return false;
  if (form.model.trim() === "") return false;
  if (args.probeLoading) return false;
  return (
    args.verifiedFingerprint !== null &&
    args.verifiedFingerprint === args.currentFingerprint
  );
}

/**
 * Auto-pick decision after a silent model-list fetch: fill an empty
 * model field with the preset's recommended model when the list has
 * it, or the single option when unambiguous. Null = leave the field
 * alone.
 */
export function planAutoPick(args: {
  currentModel: string;
  models: string[];
  recommended: string;
}): string | null {
  if (args.currentModel.trim() !== "" || args.models.length === 0) return null;
  const pick = args.models.includes(args.recommended)
    ? args.recommended
    : args.models.length === 1
      ? args.models[0]
      : "";
  return pick || null;
}

/** Hostname fallback for a blank provider display name (onboarding). */
export function providerHostnameFallback(apiBase: string): string {
  try {
    return new URL(apiBase).hostname;
  } catch {
    return apiBase.trim();
  }
}

/**
 * Save-provider(-and-first-model) sequence with injected store
 * actions. Edit (form.id set) saves the provider only — model edits
 * have their own flow in settings. Create saves the provider, then the
 * form's model under it, `makeDefault` resolved per strategy.
 *
 * `trimCredentials` preserves the onboarding save shape (trimmed
 * apiKey / apiBase); settings passes credentials through verbatim,
 * matching its historical behavior.
 */
export async function runProviderCommit(
  deps: {
    saveProvider: ManagedModelsStore["saveProvider"];
    saveModel: ManagedModelsStore["saveModel"];
  },
  args: {
    form: ProviderFormState;
    makeDefault: "always" | "whenEmpty";
    modelsCount: number;
    providerHasSavedKey?: boolean;
    displayNameFallback?: (apiBase: string) => string;
    trimCredentials?: boolean;
  },
): Promise<{ providerId: string; isNewProvider: boolean }> {
  const { form } = args;
  if (!form.protocol) {
    throw new Error("provider protocol not set");
  }
  const isNewProvider = !form.id;
  const displayName = args.displayNameFallback
    ? form.displayName.trim() ||
      args.displayNameFallback(form.apiBase.trim())
    : form.displayName;
  const saved = await deps.saveProvider({
    id: form.id,
    protocol: form.protocol,
    authKind: effectiveProviderAuthKind(form, args.providerHasSavedKey ?? false),
    apiKey: args.trimCredentials
      ? form.apiKey.trim() || undefined
      : form.apiKey || undefined,
    apiBase: args.trimCredentials ? form.apiBase.trim() : form.apiBase,
    displayName,
  });
  if (isNewProvider) {
    await deps.saveModel({
      providerId: saved.id,
      model: form.model.trim(),
      displayName: "",
      advancedOptions: form.advancedOptions,
      makeDefault:
        args.makeDefault === "always" ? true : args.modelsCount === 0,
    });
  }
  return { providerId: saved.id, isNewProvider };
}

/**
 * Device-code login completion: poll until the browser sign-in lands,
 * then refresh the managed-models store so the new provider row is
 * visible. Returns the provider id for the caller's post-save strategy
 * (settings expands + toasts; onboarding just completes the step).
 */
export async function runCodexComplete(
  deps: {
    complete: typeof completeChatGptCodexLogin;
    loadManagedModels: () => Promise<unknown>;
  },
  start: CodexDeviceLoginStart,
): Promise<string> {
  const result = await deps.complete({
    deviceAuthId: start.deviceAuthId,
    userCode: start.userCode,
    intervalSeconds: start.intervalSeconds,
  });
  await deps.loadManagedModels();
  return result.provider.id;
}
