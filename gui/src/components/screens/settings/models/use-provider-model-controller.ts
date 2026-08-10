import { useState } from "react";

import {
  listManagedModelOptions,
  managedModelProbeErrorMessage,
  modelListProbeFailureState,
  testManagedModelConnectionWithLatency,
} from "@/lib/managed-models";
import { useCopy } from "@/lib/i18n";
import { recommendedAdvancedOptionsForManagedModelProvider } from "@/lib/managed-model-presets";
import type { ManagedModelsStore } from "@/stores/managed-models";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

import {
  connectionSuccessMessage,
  normalizedModelDisplayName,
} from "./model-settings-utils";
import {
  probeStateFor,
  withProbeState,
  withoutProbeState,
} from "./probe-state";
import type { ModelDraftState, ProbeStateMap } from "./types";

type ModelDraftActivationResult =
  | { kind: "opened"; modelId: string }
  | { kind: "closed"; modelId: string }
  | { kind: "kept-open"; modelId: string }
  | { kind: "blocked-dirty"; modelId?: string };

export function useProviderModelController({
  providers,
  models,
  saveModel,
  expandProvider,
  showModelConfigSavedToast,
}: {
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  saveModel: ManagedModelsStore["saveModel"];
  expandProvider: (id: string) => void;
  showModelConfigSavedToast: (message?: string) => void;
}) {
  const modelCopy = useCopy().settings.models;
  const [modelProbeStates, setModelProbeStates] = useState<ProbeStateMap>({});
  const [savedModelProbeStates, setSavedModelProbeStates] =
    useState<ProbeStateMap>({});
  const [modelOptionsByProvider, setModelOptionsByProvider] = useState<
    Record<string, string[]>
  >({});
  const [modelFilterByProvider, setModelFilterByProvider] = useState<
    Record<string, string>
  >({});
  const [modelDraft, setModelDraft] = useState<ModelDraftState | null>(null);

  const clearModelProbeState = (providerId: string) => {
    setModelProbeStates((current) => withoutProbeState(current, providerId));
  };

  const resetModelDraft = () => {
    const providerId = modelDraft?.providerId;
    setModelDraft(null);
    if (providerId) {
      clearModelProbeState(providerId);
    }
  };

  const rememberProviderModelOptions = (
    providerId: string,
    options: string[],
    filter: string,
  ) => {
    setModelOptionsByProvider((current) => ({
      ...current,
      [providerId]: options,
    }));
    setModelFilterByProvider((current) => ({
      ...current,
      [providerId]: filter,
    }));
  };

  const createDraftForProvider = (
    provider: ManagedModelProviderRecord,
  ): ModelDraftState => {
    const recommendedAdvancedOptions =
      recommendedAdvancedOptionsForManagedModelProvider(provider);
    return {
      providerId: provider.id,
      model: "",
      displayName: "",
      advancedOptions: recommendedAdvancedOptions,
      recommendedAdvancedOptions,
    };
  };

  const createDraftForModel = (
    provider: ManagedModelProviderRecord,
    model: ManagedModelRecord,
  ): ModelDraftState => {
    const recommendedAdvancedOptions =
      recommendedAdvancedOptionsForManagedModelProvider(provider);
    return {
      providerId: provider.id,
      id: model.id,
      model: model.model,
      displayName: editableDisplayNameForModel(model),
      advancedOptions: model.advancedOptions,
      recommendedAdvancedOptions,
    };
  };

  const isModelDraftDirty = (draft: ModelDraftState | null = modelDraft) => {
    if (!draft) return false;
    const existingModel = draft.id
      ? models.find((item) => item.id === draft.id)
      : undefined;
    if (!existingModel) {
      return (
        draft.model.trim() !== "" ||
        draft.displayName.trim() !== "" ||
        stableStringify(draft.advancedOptions) !==
          stableStringify(draft.recommendedAdvancedOptions)
      );
    }
    return (
      draft.model.trim() !== existingModel.model.trim() ||
      draft.displayName.trim() !== editableDisplayNameForModel(existingModel) ||
      stableStringify(draft.advancedOptions) !==
        stableStringify(existingModel.advancedOptions)
    );
  };

  // No expandProvider here or in toggleModelDraft: an existing model's
  // editor renders inline in its ConfiguredModelsPanel row, so opening
  // the provider card below carries no UI — it only shifted layout and
  // fired the card's expand-triggered model-list fetch (vestige of the
  // era when every draft rendered inside the card). The draft flows
  // whose editor DOES live in the card (startModelDraft,
  // handleFetchModels) keep their expand.
  const openModelDraft = (
    provider: ManagedModelProviderRecord,
    model: ManagedModelRecord,
  ): ModelDraftActivationResult => {
    if (modelDraft?.id === model.id) {
      return { kind: "kept-open", modelId: model.id };
    }
    if (modelDraft && isModelDraftDirty(modelDraft)) {
      return { kind: "blocked-dirty", modelId: modelDraft.id };
    }
    setModelDraft(createDraftForModel(provider, model));
    clearModelProbeState(provider.id);
    return { kind: "opened", modelId: model.id };
  };

  const toggleModelDraft = (
    provider: ManagedModelProviderRecord,
    model: ManagedModelRecord,
  ): ModelDraftActivationResult => {
    if (modelDraft?.id === model.id) {
      if (isModelDraftDirty(modelDraft)) {
        return { kind: "blocked-dirty", modelId: model.id };
      }
      resetModelDraft();
      return { kind: "closed", modelId: model.id };
    }
    if (modelDraft && isModelDraftDirty(modelDraft)) {
      return { kind: "blocked-dirty", modelId: modelDraft.id };
    }
    setModelDraft(createDraftForModel(provider, model));
    clearModelProbeState(provider.id);
    return { kind: "opened", modelId: model.id };
  };

  const handleFetchModels = async (
    provider: ManagedModelProviderRecord,
    // The explicit fetch button opens a manual-add draft when the list
    // comes back empty or errors ("no list? type it yourself"). The
    // expand-triggered auto-fetch must not — popping an editor the user
    // didn't ask for (or clobbering a dirty draft) would be intrusive.
    { openDraftFallback = true }: { openDraftFallback?: boolean } = {},
  ) => {
    if (provider.credentialStatus === "missing") return;
    expandProvider(provider.id);
    setModelProbeStates((current) =>
      withProbeState(current, provider.id, {
        kind: "loading",
        action: "model-list",
      }),
    );
    try {
      const result = await listManagedModelOptions({
        providerId: provider.id,
        protocol: provider.protocol,
        authKind: provider.authKind,
        apiBase: provider.apiBase,
      });
      setModelOptionsByProvider((current) => ({
        ...current,
        [provider.id]: result.models,
      }));
      if (result.models.length === 0 && openDraftFallback) {
        setModelDraft(createDraftForProvider(provider));
      }
      setModelProbeStates((current) =>
        withProbeState(current, provider.id, {
          kind: "success",
          action: "model-list",
          message:
            result.models.length > 0
              ? modelCopy.foundModels(result.models.length)
              : modelCopy.connectedNoModels,
        }),
      );
    } catch (e) {
      if (openDraftFallback && modelDraft?.providerId !== provider.id) {
        setModelDraft(createDraftForProvider(provider));
      }
      setModelProbeStates((current) =>
        withProbeState(
          current,
          provider.id,
          modelListProbeFailureState(e, modelCopy),
        ),
      );
    }
  };

  const handleTestDraftModel = async (
    provider: ManagedModelProviderRecord,
    draft: ModelDraftState,
  ) => {
    if (provider.credentialStatus === "missing" || draft.model.trim() === "") {
      return;
    }
    setModelProbeStates((current) =>
      withProbeState(current, provider.id, {
        kind: "loading",
        action: "model-test",
      }),
    );
    try {
      const result = await testManagedModelConnectionWithLatency({
        providerId: provider.id,
        protocol: provider.protocol,
        authKind: provider.authKind,
        apiBase: provider.apiBase,
        model: draft.model,
        advancedOptions: draft.advancedOptions,
      });
      setModelProbeStates((current) =>
        withProbeState(current, provider.id, {
          kind: "success",
          action: "model-test",
          message: connectionSuccessMessage(result, "setup-model", modelCopy),
        }),
      );
    } catch (e) {
      setModelProbeStates((current) =>
        withProbeState(current, provider.id, {
          kind: "error",
          action: "model-test",
          message: managedModelProbeErrorMessage(e, modelCopy),
        }),
      );
    }
  };

  const handleSaveDraftModel = async (draft: ModelDraftState) => {
    const draftId = draft.id;
    const existingModel = draft.id
      ? models.find((item) => item.id === draft.id)
      : undefined;
    try {
      await saveModel({
        id: draft.id,
        providerId: draft.providerId,
        model: draft.model,
        displayName: normalizedModelDisplayName(draft),
        advancedOptions: draft.advancedOptions,
        makeDefault: draft.id
          ? (existingModel?.isDefault ?? false)
          : models.length === 0,
      });
      if (draftId) {
        setSavedModelProbeStates((current) =>
          withoutProbeState(current, draftId),
        );
      }
      resetModelDraft();
      showModelConfigSavedToast();
    } catch {
      // Store-level error is shown inline.
    }
  };

  const handleEnableDetectedModel = async (
    provider: ManagedModelProviderRecord,
    modelName: string,
  ) => {
    const alreadyEnabled = models.some(
      (item) => item.providerId === provider.id && item.model === modelName,
    );
    if (alreadyEnabled) return;
    try {
      await saveModel({
        providerId: provider.id,
        model: modelName,
        displayName: "",
        advancedOptions:
          recommendedAdvancedOptionsForManagedModelProvider(provider),
        makeDefault: models.length === 0,
      });
      showModelConfigSavedToast();
    } catch {
      // Store-level error is shown inline.
    }
  };

  const handleTestSavedModel = async (model: ManagedModelRecord) => {
    const provider = providers.find((item) => item.id === model.providerId);
    if (!provider || provider.credentialStatus === "missing") return;
    setSavedModelProbeStates((current) =>
      withProbeState(current, model.id, {
        kind: "loading",
        action: "model-test",
      }),
    );
    try {
      const result = await testManagedModelConnectionWithLatency({
        providerId: provider.id,
        protocol: provider.protocol,
        authKind: provider.authKind,
        apiBase: provider.apiBase,
        model: model.model,
        advancedOptions: model.advancedOptions,
      });
      setSavedModelProbeStates((current) =>
        withProbeState(current, model.id, {
          kind: "success",
          action: "model-test",
          message: connectionSuccessMessage(result, "saved-model", modelCopy),
        }),
      );
    } catch (e) {
      setSavedModelProbeStates((current) =>
        withProbeState(current, model.id, {
          kind: "error",
          action: "model-test",
          message: managedModelProbeErrorMessage(e, modelCopy),
        }),
      );
    }
  };

  const startModelDraft = (
    provider: ManagedModelProviderRecord,
    model?: ManagedModelRecord,
  ) => {
    expandProvider(provider.id);
    setModelDraft(
      model
        ? createDraftForModel(provider, model)
        : createDraftForProvider(provider),
    );
    clearModelProbeState(provider.id);
  };

  const changeModelDraft = (
    providerId: string,
    patch: Partial<ModelDraftState>,
  ) => {
    setModelDraft((current) =>
      current?.providerId === providerId ? { ...current, ...patch } : current,
    );
    clearModelProbeState(providerId);
  };

  return {
    changeModelDraft,
    clearModelProbeState,
    handleEnableDetectedModel,
    handleFetchModels,
    handleSaveDraftModel,
    handleTestDraftModel,
    handleTestSavedModel,
    isModelDraftDirty,
    modelDraft,
    modelFilterForProvider: (providerId: string) =>
      modelFilterByProvider[providerId] ?? "",
    modelOptionsForProvider: (providerId: string) =>
      modelOptionsByProvider[providerId] ?? [],
    modelProbeStateForProvider: (providerId: string) =>
      probeStateFor(modelProbeStates, providerId),
    openModelDraft,
    rememberProviderModelOptions,
    resetModelDraft,
    savedModelProbeStateForModel: (modelId: string) =>
      probeStateFor(savedModelProbeStates, modelId),
    setModelFilterForProvider: (providerId: string, value: string) => {
      setModelFilterByProvider((current) => ({
        ...current,
        [providerId]: value,
      }));
    },
    startModelDraft,
    toggleModelDraft,
  };
}

function editableDisplayNameForModel(model: ManagedModelRecord): string {
  const modelName = model.model.trim();
  const displayName = model.displayName.trim();
  return displayName === modelName ? "" : displayName;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableJsonValue(nested)]),
    );
  }
  return value;
}
