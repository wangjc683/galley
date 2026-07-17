import { useEffect, useRef, useState } from "react";
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
import type { ManagedModelsStore } from "@/stores/managed-models";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

import {
  connectionSuccessMessage,
  newProviderForm,
  providerFormFromPreset,
} from "./model-settings-utils";
import type { ProbeAction, ProbeState, ProviderFormState } from "./types";

export function useProviderFormController({
  loading,
  providers,
  models,
  saving,
  saveProvider,
  saveModel,
  loadManagedModels,
  expandProvider,
  clearProviderProbeState,
  clearModelProbeState,
  rememberProviderModelOptions,
  showModelConfigSavedToast,
}: {
  loading: boolean;
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  saving: boolean;
  saveProvider: ManagedModelsStore["saveProvider"];
  saveModel: ManagedModelsStore["saveModel"];
  loadManagedModels: ManagedModelsStore["load"];
  expandProvider: (id: string) => void;
  clearProviderProbeState: (id: string) => void;
  clearModelProbeState: (id: string) => void;
  rememberProviderModelOptions: (
    providerId: string,
    options: string[],
    filter: string,
  ) => void;
  showModelConfigSavedToast: (message?: string) => void;
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
  const canSaveProvider =
    !!visibleProviderForm &&
    !isCodexProviderForm &&
    visibleProviderForm.protocol !== null &&
    visibleProviderForm.apiBase.trim() !== "" &&
    (visibleProviderForm.apiKey.trim() !== "" || providerHasSavedKey) &&
    (!isCreatingProvider || visibleProviderForm.model.trim() !== "") &&
    !saving;
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

  // Silent model-list auto-fetch for the provider-creation flow (same
  // behavior as Onboarding's StepModelConfig): once key + endpoint are
  // usable, pull the model list in the background and pre-select the
  // preset's recommended model when the field is still empty. Failure
  // degrades silently — the explicit fetch button stays the loud path.
  const autoFetchFingerprint =
    visibleProviderForm && isCreatingProvider && !isCodexProviderForm
      ? JSON.stringify({
          providerPresetId: visibleProviderForm.providerPresetId,
          protocol: visibleProviderForm.protocol,
          authKind: visibleProviderForm.authKind,
          apiKey: visibleProviderForm.apiKey.trim(),
          apiBase: visibleProviderForm.apiBase.trim(),
        })
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
          if (result.models.length === 0) return;
          setProviderForm((current) => {
            if (!current || current.model.trim() !== "") return current;
            const preset = current.providerPresetId
              ? getManagedModelProviderPreset(current.providerPresetId)
              : null;
            const recommended = preset
              ? recommendedModelForManagedModelProviderPreset(preset)
              : "";
            const pick = result.models.includes(recommended)
              ? recommended
              : result.models.length === 1
                ? result.models[0]
                : "";
            return pick ? { ...current, model: pick } : current;
          });
        })
        .catch((e: unknown) => {
          console.warn("[settings] model list auto-fetch failed.", e);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [autoFetchFingerprint, canFetchProviderFormModels]);

  const resetProviderForm = () => {
    setProviderForm(null);
    setProviderFormModelOptions([]);
    setProviderFormModelFilter("");
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
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
  };

  const startNewProvider = () => {
    setProviderForm(newProviderForm());
    setProviderFormModelOptions([]);
    setProviderFormModelFilter("");
    setProviderFormProbeState({ kind: "idle" });
    setCodexLoginStart(null);
  };

  const startEditProvider = (provider: ManagedModelProviderRecord) => {
    expandProvider(provider.id);
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
    if (
      !visibleProviderForm ||
      !canSaveProvider ||
      !visibleProviderForm.protocol
    ) {
      return;
    }
    const isNewProvider = !visibleProviderForm.id;
    try {
      const saved = await saveProvider({
        id: visibleProviderForm.id,
        protocol: visibleProviderForm.protocol,
        authKind: visibleProviderForm.authKind,
        apiKey: visibleProviderForm.apiKey || undefined,
        apiBase: visibleProviderForm.apiBase,
        displayName: visibleProviderForm.displayName,
      });
      if (isNewProvider) {
        await saveModel({
          providerId: saved.id,
          model: visibleProviderForm.model.trim(),
          displayName: "",
          advancedOptions: visibleProviderForm.advancedOptions,
          makeDefault: models.length === 0,
        });
        if (providerFormModelOptions.length > 0) {
          rememberProviderModelOptions(
            saved.id,
            providerFormModelOptions,
            providerFormModelFilter,
          );
        }
      }
      clearProviderProbeState(saved.id);
      clearModelProbeState(saved.id);
      expandProvider(saved.id);
      resetProviderForm();
      showModelConfigSavedToast(
        isNewProvider
          ? modelCopy.providerCreatedToastMessage
          : copy.toasts.modelConfigSavedMessage,
      );
    } catch {
      // Store-level error is shown inline.
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
      const result = await completeChatGptCodexLogin({
        deviceAuthId: codexLoginStart.deviceAuthId,
        userCode: codexLoginStart.userCode,
        intervalSeconds: codexLoginStart.intervalSeconds,
      });
      await loadManagedModels();
      expandProvider(result.provider.id);
      resetProviderForm();
      showModelConfigSavedToast(modelCopy.providerCreatedToastMessage);
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
      expandProvider(result.provider.id);
      resetProviderForm();
      showModelConfigSavedToast(modelCopy.providerCreatedToastMessage);
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
    canFetchProviderFormModels,
    canSaveProvider,
    canTestProvider,
    codexLoginStart,
    codexPolling,
    handleCodexCompleteLogin,
    handleCodexImport,
    handleCodexLogin,
    handleCodexLogout,
    handleCodexOpenLoginPage,
    handleProviderFormFetchModels,
    handleProviderFormTest,
    handleProviderSave,
    providerFormIsInlineEdit,
    providerFormModelFilter,
    providerFormModelOptions,
    providerFormProbeState,
    providerHasSavedKey,
    resetProviderForm,
    selectProviderPreset,
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
