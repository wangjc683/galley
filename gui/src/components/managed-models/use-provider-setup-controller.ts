import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  completeChatGptCodexLogin,
  importChatGptCodexCliLogin,
  listManagedModelOptions,
  logoutChatGptCodexProvider,
  managedModelProbeErrorMessage,
  startChatGptCodexLogin,
  testManagedModelConnectionWithLatency,
  type CodexDeviceLoginStart,
} from "@/lib/managed-models";
import { useCopy } from "@/lib/i18n";
import {
  customManagedModelProviderPresetId,
  getManagedModelProviderPreset,
  managedModelProviderPresetForRecord,
  recommendedModelForManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import {
  canCommitProviderSetup,
  connectionSuccessMessage,
  formToProbeInput,
  newProviderForm,
  planAutoPick,
  providerConnectionFingerprint,
  providerFormFromPreset,
  providerListFingerprint,
  runCodexComplete,
  runProviderCommit,
  type ProbeAction,
  type ProbeState,
  type ProviderFormState,
} from "@/lib/provider-setup";
import type { ManagedModelsStore } from "@/stores/managed-models";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

/**
 * Shared provider-config form controller for the two managed-model
 * surfaces. All option defaults reproduce the Settings → 模型 behavior
 * exactly; onboarding turns on the extras it historically had on top:
 * the debounced auto connection test with verified-fingerprint gating
 * of its Start CTA, the auto-pick-resets-test coupling, the hostname
 * display-name fallback, and a probe-status (rather than form-reset)
 * commit presentation. The views stay separate — card grid + Advanced
 * collapse in onboarding vs popover + inline fields in settings (an
 * intentional divergence, see devlog 2026-07-17).
 */
export function useProviderSetupController({
  loading,
  providers,
  models,
  saving,
  saveProvider,
  saveModel,
  loadManagedModels,
  autoConnectionTest = false,
  autoProbeDelayMs = 800,
  requireVerifiedConnectionToCommit = false,
  makeDefault = "whenEmpty",
  displayNameFallback,
  trimCredentialsOnSave = false,
  postSaveForm = "reset",
  onSaved,
  onCodexComplete,
  expandProvider,
  rememberProviderModelOptions,
}: {
  loading: boolean;
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  saving: boolean;
  saveProvider: ManagedModelsStore["saveProvider"];
  saveModel: ManagedModelsStore["saveModel"];
  loadManagedModels: ManagedModelsStore["load"];
  /** Debounced auto connection test + verified-fingerprint tracking
   * (onboarding). Off = manual test button only (settings). */
  autoConnectionTest?: boolean;
  /** Debounce for the auto test AND the silent model-list fetch. */
  autoProbeDelayMs?: number;
  /** Gate `canCommit` on a connection test that passed for the current
   * fingerprint (onboarding Start CTA). */
  requireVerifiedConnectionToCommit?: boolean;
  /** First-model default strategy on create. */
  makeDefault?: "always" | "whenEmpty";
  /** Fallback for a blank provider display name at save time. */
  displayNameFallback?: (apiBase: string) => string;
  /** Trim apiKey / apiBase at save time (onboarding save shape). */
  trimCredentialsOnSave?: boolean;
  /** After a successful commit: reset the form (settings) or show a
   * success probe status and keep the form (onboarding, which leaves
   * the screen via `onSaved` anyway). Also selects whether commit
   * errors surface as probe status ("success-status") or stay silent
   * for the store's inline error line ("reset"). */
  postSaveForm?: "reset" | "success-status";
  onSaved?: (ctx: { providerId: string; isNewProvider: boolean }) => void;
  /** Post-success strategy for the codex login / import flows. */
  onCodexComplete?: (providerId: string) => void;
  /** Settings-only: expand a provider card when editing starts. */
  expandProvider?: (id: string) => void;
  /** Settings-only: park fetched model options on the created provider. */
  rememberProviderModelOptions?: (
    providerId: string,
    options: string[],
    filter: string,
  ) => void;
}) {
  const copy = useCopy();
  const modelCopy = copy.settings.models;
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(
    null,
  );
  const [providerFormProbeState, setProviderFormProbeState] =
    useState<ProbeState>({ kind: "idle" });
  const [providerFormModelOptions, setProviderFormModelOptions] = useState<
    string[]
  >([]);
  const [providerFormModelFilter, setProviderFormModelFilter] = useState("");
  const [codexLoginStart, setCodexLoginStart] =
    useState<CodexDeviceLoginStart | null>(null);
  const [codexPolling, setCodexPolling] = useState(false);
  // Connection-test bookkeeping (active only with autoConnectionTest):
  // a passing test is pinned to the fingerprint it ran against, and a
  // request id guards against a stale response landing after the user
  // edited a field mid-flight.
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<
    string | null
  >(null);
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(
    null,
  );
  const connectionTestRequestRef = useRef(0);
  const connectionFingerprintRef = useRef("");

  const visibleProviderForm =
    providerForm ??
    (!loading && providers.length === 0 ? newProviderForm() : null);
  const editingProvider = visibleProviderForm?.id
    ? providers.find((item) => item.id === visibleProviderForm.id)
    : undefined;
  const providerHasSavedKey =
    !!editingProvider && editingProvider.credentialStatus !== "missing";
  const isCreatingProvider = !!visibleProviderForm && !visibleProviderForm.id;
  const providerFormIsInlineEdit = !!visibleProviderForm?.id;
  const isCodexProviderForm =
    visibleProviderForm?.authKind === "chatgpt_codex_oauth";
  const canSaveProvider = canCommitProviderSetup({
    form: visibleProviderForm,
    saving,
    probeLoading: providerFormProbeState.kind === "loading",
    providerHasSavedKey,
    isCreating: isCreatingProvider,
    requireVerifiedConnection: false,
    verifiedFingerprint: null,
    currentFingerprint: "",
  });
  const canTestProvider =
    !!visibleProviderForm &&
    visibleProviderForm.protocol !== null &&
    visibleProviderForm.apiBase.trim() !== "" &&
    (isCodexProviderForm ||
      visibleProviderForm.apiKey.trim() !== "" ||
      providerHasSavedKey) &&
    providerFormProbeState.kind !== "loading";
  const canFetchProviderFormModels =
    !!visibleProviderForm &&
    !isCodexProviderForm &&
    visibleProviderForm.protocol !== null &&
    !visibleProviderForm.id &&
    visibleProviderForm.apiBase.trim() !== "" &&
    visibleProviderForm.apiKey.trim() !== "" &&
    providerFormProbeState.kind !== "loading";

  const connectionFingerprint = visibleProviderForm
    ? providerConnectionFingerprint(visibleProviderForm)
    : "";
  const connectionVerified =
    verifiedFingerprint !== null &&
    verifiedFingerprint === connectionFingerprint;
  const connectionInputComplete =
    !!visibleProviderForm &&
    visibleProviderForm.providerPresetId !== null &&
    visibleProviderForm.protocol !== null &&
    (isCodexProviderForm || visibleProviderForm.apiKey.trim() !== "") &&
    visibleProviderForm.apiBase.trim() !== "" &&
    visibleProviderForm.model.trim() !== "";
  const canCommit = requireVerifiedConnectionToCommit
    ? canCommitProviderSetup({
        form: visibleProviderForm,
        saving,
        probeLoading: providerFormProbeState.kind === "loading",
        providerHasSavedKey,
        isCreating: isCreatingProvider,
        requireVerifiedConnection: true,
        verifiedFingerprint,
        currentFingerprint: connectionFingerprint,
      })
    : canSaveProvider;

  useEffect(() => {
    connectionFingerprintRef.current = connectionFingerprint;
  }, [connectionFingerprint]);

  // Invalidate the connection test: any in-flight response becomes
  // stale (request id bump) and the verified pin is dropped. No-op
  // cost when autoConnectionTest is off (the states just stay null).
  const resetConnectionTest = useCallback(() => {
    connectionTestRequestRef.current += 1;
    setVerifiedFingerprint(null);
    setTestedFingerprint(null);
  }, []);

  const runConnectionTest = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const form = visibleProviderForm;
      const input = form ? formToProbeInput(form) : null;
      if (!connectionInputComplete || !input) return;

      const fingerprint = connectionFingerprint;
      if (!force && testedFingerprint === fingerprint) return;

      const requestId = connectionTestRequestRef.current + 1;
      connectionTestRequestRef.current = requestId;
      setVerifiedFingerprint(null);
      setTestedFingerprint(fingerprint);
      setProviderFormProbeState({ kind: "loading", action: "model-test" });
      try {
        const result = await testManagedModelConnectionWithLatency(input);
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setVerifiedFingerprint(fingerprint);
        setProviderFormProbeState({
          kind: "success",
          action: "model-test",
          message: connectionSuccessMessage(result, "setup-model", modelCopy),
        });
      } catch (e) {
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setProviderFormProbeState({
          kind: "error",
          action: "model-test",
          message: managedModelProbeErrorMessage(e, modelCopy),
        });
      }
    },
    [
      connectionFingerprint,
      connectionInputComplete,
      modelCopy,
      testedFingerprint,
      visibleProviderForm,
    ],
  );

  // Debounced auto connection test (onboarding): once the form is
  // complete, verify the exact fingerprint after a quiet gap. Edits
  // clear testedFingerprint (via updateProviderForm), re-arming this.
  useEffect(() => {
    if (
      !autoConnectionTest ||
      !connectionInputComplete ||
      providerFormProbeState.kind === "loading" ||
      testedFingerprint === connectionFingerprint
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void runConnectionTest();
    }, autoProbeDelayMs);

    return () => clearTimeout(timer);
  }, [
    autoConnectionTest,
    autoProbeDelayMs,
    connectionFingerprint,
    connectionInputComplete,
    providerFormProbeState.kind,
    runConnectionTest,
    testedFingerprint,
  ]);

  // Silent model-list auto-fetch for the provider-creation flow: once
  // key + endpoint are usable, pull the model list in the background
  // and pre-select the preset's recommended model when the field is
  // still empty. Failure degrades silently — the explicit fetch button
  // stays the loud path.
  const autoFetchFingerprint =
    visibleProviderForm && isCreatingProvider && !isCodexProviderForm
      ? providerListFingerprint(visibleProviderForm)
      : null;
  const visibleProviderFormRef = useRef(visibleProviderForm);
  const autoFetchFingerprintRef = useRef<string | null>(null);
  const autoFetchAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    visibleProviderFormRef.current = visibleProviderForm;
    autoFetchFingerprintRef.current = autoFetchFingerprint;
  });

  useEffect(() => {
    if (
      !autoFetchFingerprint ||
      !canFetchProviderFormModels ||
      autoFetchAttemptedRef.current === autoFetchFingerprint
    ) {
      return;
    }

    const fingerprint = autoFetchFingerprint;
    const timer = setTimeout(() => {
      const form = visibleProviderFormRef.current;
      const protocol = form?.protocol;
      if (!form || !protocol) return;
      autoFetchAttemptedRef.current = fingerprint;
      void listManagedModelOptions({
        protocol,
        authKind: form.authKind,
        apiKey: form.apiKey,
        apiBase: form.apiBase,
      })
        .then((result) => {
          if (autoFetchFingerprintRef.current !== fingerprint) return;
          setProviderFormModelOptions(result.models);
          const current = visibleProviderFormRef.current;
          if (!current) return;
          const preset = current.providerPresetId
            ? getManagedModelProviderPreset(current.providerPresetId)
            : null;
          const recommended = preset
            ? recommendedModelForManagedModelProviderPreset(preset)
            : "";
          const pick = planAutoPick({
            currentModel: current.model,
            models: result.models,
            recommended,
          });
          if (!pick) return;
          setProviderForm((existing) =>
            existing && existing.model.trim() === ""
              ? { ...existing, model: pick }
              : existing,
          );
          // The auto-picked model hasn't been through a connection
          // test — re-arm the auto test so the Start gate stays honest.
          if (autoConnectionTest) resetConnectionTest();
        })
        .catch((e: unknown) => {
          console.warn("[provider-setup] model list auto-fetch failed.", e);
        });
    }, autoProbeDelayMs);

    return () => clearTimeout(timer);
  }, [
    autoConnectionTest,
    autoFetchFingerprint,
    autoProbeDelayMs,
    canFetchProviderFormModels,
    resetConnectionTest,
  ]);

  const resetProviderForm = () => {
    setProviderForm(null);
    setProviderFormModelOptions([]);
    setProviderFormModelFilter("");
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
    resetConnectionTest();
  };

  const updateProviderForm = (patch: Partial<ProviderFormState>) => {
    setProviderForm((current) => ({
      ...(current ?? newProviderForm()),
      ...patch,
    }));
    if (
      "protocol" in patch ||
      "authKind" in patch ||
      "providerPresetId" in patch ||
      "apiKey" in patch ||
      "apiBase" in patch
    ) {
      setProviderFormModelOptions([]);
      setProviderFormModelFilter("");
    }
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
    resetConnectionTest();
  };

  /** Display-name edits don't invalidate a passing connection test —
   * the name is cosmetic and not part of the probe. (Settings edits
   * the name through updateProviderForm and keeps its historical
   * reset-everything behavior.) */
  const setProviderDisplayName = (displayName: string) => {
    setProviderForm((current) => ({
      ...(current ?? newProviderForm()),
      displayName,
    }));
  };

  const selectProviderPreset = (
    providerPresetId: ManagedModelProviderPresetId,
  ) => {
    setProviderForm((current) => {
      const base = current ?? newProviderForm();
      return providerFormFromPreset(providerPresetId, {
        id: base.id,
        apiKey: base.apiKey,
      });
    });
    setProviderFormModelOptions([]);
    setProviderFormModelFilter("");
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
    resetConnectionTest();
  };

  const startNewProvider = () => {
    setProviderForm(newProviderForm());
    setProviderFormModelOptions([]);
    setProviderFormModelFilter("");
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
    resetConnectionTest();
  };

  const startEditProvider = (provider: ManagedModelProviderRecord) => {
    expandProvider?.(provider.id);
    setProviderForm({
      id: provider.id,
      // Resolve the original preset by apiBase first so preset-derived
      // affordances (label, "Get API Key" link) match the provider the
      // user actually configured — a DeepSeek provider must not edit
      // as the generic Anthropic preset. Custom endpoints fall back to
      // the protocol-generic preset.
      providerPresetId:
        managedModelProviderPresetForRecord(provider)?.id ??
        customManagedModelProviderPresetId(
          provider.protocol,
          provider.authKind,
        ),
      protocol: provider.protocol,
      authKind: provider.authKind,
      apiKey: "",
      apiBase: provider.apiBase,
      model: "",
      displayName: provider.displayName,
    });
    setProviderFormModelOptions([]);
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
    resetConnectionTest();
  };

  const handleProviderFormTest = async () => {
    if (
      !visibleProviderForm ||
      !canTestProvider ||
      !visibleProviderForm.protocol
    ) {
      return;
    }
    const testModel = visibleProviderForm.model.trim();
    const action: ProbeAction = testModel ? "model-test" : "model-list";
    setProviderFormProbeState({
      kind: "loading",
      action,
    });
    try {
      const message = testModel
        ? connectionSuccessMessage(
            await testManagedModelConnectionWithLatency({
              id: visibleProviderForm.id,
              providerId: visibleProviderForm.id,
              protocol: visibleProviderForm.protocol,
              authKind: visibleProviderForm.authKind,
              apiKey: visibleProviderForm.apiKey || undefined,
              apiBase: visibleProviderForm.apiBase,
              model: testModel,
              advancedOptions: visibleProviderForm.advancedOptions,
            }),
            "setup-model",
            modelCopy,
          )
        : listModelsMessage(
            await listManagedModelOptions({
              id: visibleProviderForm.id,
              providerId: visibleProviderForm.id,
              protocol: visibleProviderForm.protocol,
              authKind: visibleProviderForm.authKind,
              apiKey: visibleProviderForm.apiKey || undefined,
              apiBase: visibleProviderForm.apiBase,
            }),
            modelCopy,
          );
      setProviderFormProbeState({
        kind: "success",
        action,
        message,
      });
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action,
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleProviderFormFetchModels = async () => {
    if (
      !visibleProviderForm ||
      !canFetchProviderFormModels ||
      !visibleProviderForm.protocol
    ) {
      return;
    }
    setProviderFormProbeState({
      kind: "loading",
      action: "model-list",
    });
    try {
      const result = await listManagedModelOptions({
        protocol: visibleProviderForm.protocol,
        authKind: visibleProviderForm.authKind,
        apiKey: visibleProviderForm.apiKey,
        apiBase: visibleProviderForm.apiBase,
      });
      setProviderFormModelOptions(result.models);
      if (
        result.models.length === 1 &&
        visibleProviderForm.model.trim() === ""
      ) {
        setProviderForm((current) =>
          current ? { ...current, model: result.models[0] } : current,
        );
      }
      setProviderFormProbeState({
        kind: "success",
        action: "model-list",
        message:
          result.models.length > 0
            ? modelCopy.foundModels(result.models.length)
            : modelCopy.connectedNoModels,
      });
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "model-list",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleProviderSave = async () => {
    if (!visibleProviderForm || !canCommit || !visibleProviderForm.protocol) {
      return;
    }
    if (postSaveForm === "success-status") {
      setProviderFormProbeState({ kind: "loading", action: "commit" });
    }
    try {
      const result = await runProviderCommit(
        { saveProvider, saveModel },
        {
          form: visibleProviderForm,
          makeDefault,
          modelsCount: models.length,
          displayNameFallback,
          trimCredentials: trimCredentialsOnSave,
        },
      );
      if (result.isNewProvider && providerFormModelOptions.length > 0) {
        rememberProviderModelOptions?.(
          result.providerId,
          providerFormModelOptions,
          providerFormModelFilter,
        );
      }
      if (postSaveForm === "reset") {
        resetProviderForm();
      } else {
        setProviderFormProbeState({
          kind: "success",
          action: "commit",
          message: modelCopy.setupComplete,
        });
      }
      onSaved?.(result);
    } catch (e) {
      if (postSaveForm === "success-status") {
        setProviderFormProbeState({
          kind: "error",
          action: "commit",
          message: managedModelProbeErrorMessage(e, modelCopy),
        });
      }
      // Otherwise: store-level error is shown inline.
    }
  };

  const handleCodexLogin = async () => {
    if (
      !visibleProviderForm ||
      visibleProviderForm.authKind !== "chatgpt_codex_oauth"
    ) {
      return;
    }
    setProviderFormProbeState({ kind: "loading", action: "provider-test" });
    try {
      const start = await startChatGptCodexLogin();
      setCodexLoginStart(start);
      setProviderFormProbeState({
        kind: "success",
        action: "provider-test",
        message: modelCopy.chatgptCodexCodeReady,
      });
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleCodexCompleteLogin = async () => {
    if (!codexLoginStart || codexPolling) return;
    setCodexPolling(true);
    setProviderFormProbeState({ kind: "loading", action: "provider-test" });
    try {
      const providerId = await runCodexComplete(
        { complete: completeChatGptCodexLogin, loadManagedModels },
        codexLoginStart,
      );
      if (postSaveForm === "reset") {
        resetProviderForm();
      }
      onCodexComplete?.(providerId);
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    } finally {
      setCodexPolling(false);
    }
  };

  const handleCodexOpenLoginPage = async () => {
    if (!codexLoginStart) return;
    try {
      await openUrl(codexLoginStart.verificationUrl);
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
      return;
    }
    // Start polling right away — the standard device-code flow. The
    // user finishes sign-in in the browser and the provider lands on
    // its own; the manual "complete sign-in" button stays as the
    // retry path after a timeout or error.
    void handleCodexCompleteLogin();
  };

  const handleCodexImport = async () => {
    if (
      !visibleProviderForm ||
      visibleProviderForm.authKind !== "chatgpt_codex_oauth"
    ) {
      return;
    }
    setCodexLoginStart(null);
    setProviderFormProbeState({ kind: "loading", action: "provider-test" });
    try {
      const result = await importChatGptCodexCliLogin();
      await loadManagedModels();
      if (postSaveForm === "reset") {
        resetProviderForm();
      }
      onCodexComplete?.(result.provider.id);
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleCodexLogout = async () => {
    if (
      !visibleProviderForm ||
      visibleProviderForm.authKind !== "chatgpt_codex_oauth"
    ) {
      return;
    }
    setCodexLoginStart(null);
    setProviderFormProbeState({ kind: "loading", action: "provider-test" });
    try {
      await logoutChatGptCodexProvider(visibleProviderForm.id);
      await loadManagedModels();
      setProviderFormProbeState({
        kind: "success",
        action: "provider-test",
        message: modelCopy.keyNeedsResaveShort,
      });
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  return {
    canCommit,
    canFetchProviderFormModels,
    canSaveProvider,
    canTestProvider,
    codexLoginStart,
    codexPolling,
    connectionInputComplete,
    connectionVerified,
    handleCodexCompleteLogin,
    handleCodexImport,
    handleCodexLogin,
    handleCodexLogout,
    handleCodexOpenLoginPage,
    handleProviderFormFetchModels,
    handleProviderFormTest,
    handleProviderSave,
    isCodexProviderForm,
    providerFormIsInlineEdit,
    providerFormModelFilter,
    providerFormModelOptions,
    providerFormProbeState,
    providerHasSavedKey,
    resetProviderForm,
    runConnectionTest,
    selectProviderPreset,
    setProviderDisplayName,
    setProviderFormModelFilter,
    startEditProvider,
    startNewProvider,
    updateProviderForm,
    visibleProviderForm,
  };
}

function listModelsMessage(
  result: { models: string[] },
  copy: ReturnType<typeof useCopy>["settings"]["models"],
): string {
  return result.models.length > 0
    ? copy.foundModels(result.models.length)
    : copy.connectedNoModels;
}
