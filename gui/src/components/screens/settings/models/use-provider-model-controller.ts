import { createContext, useCallback, useEffect, useRef, useState } from "react";

import {
  listManagedModelOptions,
  managedModelProbeErrorMessage,
  modelListProbeFailureState,
  testManagedModelConnectionWithLatency,
} from "@/lib/managed-models";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { effectiveAdvancedOptions } from "@/lib/managed-model-layers";
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
import type {
  EditorBlockedState,
  ModelDraftState,
  ProbeStateMap,
} from "./types";

type ModelDraftActivationResult =
  | { kind: "opened"; modelId?: string }
  | { kind: "closed"; modelId: string }
  | { kind: "kept-open"; modelId: string }
  | { kind: "blocked-dirty"; modelId?: string };

const EDITOR_UNBLOCKED: EditorBlockedState = { flash: false, hint: false };

/** How long the blocked editor's highlight stays on before it fades
 * (the fade itself is the editor's `--motion-slow` transition). */
const EDITOR_BLOCKED_FLASH_MS = 600;

/**
 * Blocked-state for the one model draft on the page. A context, not a
 * prop: the draft's editor renders either inside a 我的模型 row or
 * inside a provider card, and only one draft exists at a time, so both
 * render sites read the same value. Provided by Settings → 模型.
 */
export const ModelDraftBlockedContext =
  createContext<EditorBlockedState>(EDITOR_UNBLOCKED);

/** Classes for a blocked editor's surface: a brand ring that fades in
 * and back out on `--motion-slow` — a one-shot transition driven by
 * `flash`, not a keyframe loop. */
export function editorBlockedFlashClass(flash: boolean): string {
  return cn(
    "transition-shadow duration-(--motion-slow) ease-out",
    flash && "ring-[3px] ring-brand/30",
  );
}

/**
 * Drives an editor's EditorBlockedState: `signal()` lights the highlight
 * and the hint, the highlight times out on its own, `clear()` drops
 * both (call it on the editor's next edit / save / close).
 */
export function useEditorBlockedSignal() {
  const [state, setState] = useState<EditorBlockedState>(EDITOR_UNBLOCKED);
  const timerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const signal = useCallback(() => {
    stopTimer();
    setState({ flash: true, hint: true });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setState((current) =>
        current.flash ? { ...current, flash: false } : current,
      );
    }, EDITOR_BLOCKED_FLASH_MS);
  }, [stopTimer]);

  const clear = useCallback(() => {
    stopTimer();
    setState((current) =>
      current.flash || current.hint ? EDITOR_UNBLOCKED : current,
    );
  }, [stopTimer]);

  useEffect(() => stopTimer, [stopTimer]);

  return { state, signal, clear };
}

/**
 * Where a failed or empty 「读取模型列表」 leaves the model draft. The
 * explicit button falls back to a fresh manual-add draft ("no list?
 * type it yourself"), but never over a draft holding unsaved input —
 * the fetch can land long after the click, so this runs against the
 * draft as it is *then*. A failure also keeps any draft already open on
 * the same provider (the user is mid-way there).
 */
export function fallbackModelDraftAfterFetch(args: {
  current: ModelDraftState | null;
  currentDirty: boolean;
  providerId: string;
  outcome: "empty" | "failed";
}): "keep" | "open-new" {
  const { current } = args;
  if (current && args.currentDirty) return "keep";
  if (
    args.outcome === "failed" &&
    current &&
    current.providerId === args.providerId
  ) {
    return "keep";
  }
  return "open-new";
}

export function useProviderModelController({
  providers,
  models,
  defaults,
  saveModel,
  expandProvider,
  showModelConfigSavedToast,
}: {
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  /** The global defaults layer — needed to compute a draft's effective
   * options for the connection test. */
  defaults: Record<string, unknown>;
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
  const draftBlocked = useEditorBlockedSignal();

  const clearModelProbeState = (providerId: string) => {
    setModelProbeStates((current) => withoutProbeState(current, providerId));
  };

  const resetModelDraft = () => {
    const providerId = modelDraft?.providerId;
    setModelDraft(null);
    draftBlocked.clear();
    if (providerId) {
      clearModelProbeState(providerId);
    }
  };

  const rememberProviderModelOptions = (
    providerId: string,
    options: string[],
  ) => {
    setModelOptionsByProvider((current) => ({
      ...current,
      [providerId]: options,
    }));
  };

  // New model: seed the preset layer from the provider preset and
  // override nothing — the defaults layer supplies the rest.
  const createDraftForProvider = (
    provider: ManagedModelProviderRecord,
  ): ModelDraftState => ({
    providerId: provider.id,
    model: "",
    displayName: "",
    presetOptions: recommendedAdvancedOptionsForManagedModelProvider(provider),
    advancedOverrides: {},
  });

  // Existing model: both layers come off the record; the preset layer
  // is read-only here and is not sent back on save.
  const createDraftForModel = (
    provider: ManagedModelProviderRecord,
    model: ManagedModelRecord,
  ): ModelDraftState => ({
    providerId: provider.id,
    id: model.id,
    model: model.model,
    displayName: editableDisplayNameForModel(model),
    presetOptions: model.presetOptions,
    advancedOverrides: model.advancedOverrides,
  });

  const isModelDraftDirty = (draft: ModelDraftState | null = modelDraft) => {
    if (!draft) return false;
    const existingModel = draft.id
      ? models.find((item) => item.id === draft.id)
      : undefined;
    if (!existingModel) {
      // A fresh draft starts with no overrides at all, so any key in
      // the bag is a deliberate edit (the preset layer is seeded, not
      // editable).
      return (
        draft.model.trim() !== "" ||
        draft.displayName.trim() !== "" ||
        Object.keys(draft.advancedOverrides).length > 0
      );
    }
    return (
      draft.model.trim() !== existingModel.model.trim() ||
      draft.displayName.trim() !== editableDisplayNameForModel(existingModel) ||
      stableStringify(draft.advancedOverrides) !==
        stableStringify(existingModel.advancedOverrides)
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
      draftBlocked.signal();
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
        draftBlocked.signal();
        return { kind: "blocked-dirty", modelId: model.id };
      }
      resetModelDraft();
      return { kind: "closed", modelId: model.id };
    }
    if (modelDraft && isModelDraftDirty(modelDraft)) {
      draftBlocked.signal();
      return { kind: "blocked-dirty", modelId: modelDraft.id };
    }
    setModelDraft(createDraftForModel(provider, model));
    clearModelProbeState(provider.id);
    return { kind: "opened", modelId: model.id };
  };

  const openFallbackDraft = (
    provider: ManagedModelProviderRecord,
    outcome: "empty" | "failed",
  ) => {
    // Updater form: decide against the draft as it is when the fetch
    // lands, not as it was at click time.
    setModelDraft((current) =>
      fallbackModelDraftAfterFetch({
        current,
        currentDirty: isModelDraftDirty(current),
        providerId: provider.id,
        outcome,
      }) === "keep"
        ? current
        : createDraftForProvider(provider),
    );
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
        openFallbackDraft(provider, "empty");
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
      if (openDraftFallback) {
        openFallbackDraft(provider, "failed");
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
        // The probe wants what the runtime would actually use.
        advancedOptions: effectiveAdvancedOptions(
          draft.presetOptions,
          defaults,
          draft.advancedOverrides,
        ),
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
        // Preset layer only on create — Core keeps the stored one on
        // an edit; overrides always replace the stored set wholesale.
        ...(draft.id ? {} : { presetOptions: draft.presetOptions }),
        advancedOverrides: draft.advancedOverrides,
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
      // The editor stays open with the draft intact; the wrapped store
      // action passed in by Settings reports the failure (error toast).
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
        presetOptions:
          recommendedAdvancedOptionsForManagedModelProvider(provider),
        advancedOverrides: {},
        makeDefault: models.length === 0,
      });
      showModelConfigSavedToast();
    } catch {
      // Reported by the wrapped store action passed in by Settings.
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

  /** The card's 「手动添加」: a fresh draft, unless the current one holds
   * unsaved input — then it is flagged (highlight + hint) and stays. */
  const startModelDraft = (
    provider: ManagedModelProviderRecord,
  ): ModelDraftActivationResult => {
    if (modelDraft && isModelDraftDirty(modelDraft)) {
      draftBlocked.signal();
      return { kind: "blocked-dirty", modelId: modelDraft.id };
    }
    expandProvider(provider.id);
    setModelDraft(createDraftForProvider(provider));
    clearModelProbeState(provider.id);
    draftBlocked.clear();
    return { kind: "opened" };
  };

  const changeModelDraft = (
    providerId: string,
    patch: Partial<ModelDraftState>,
  ) => {
    setModelDraft((current) =>
      current?.providerId === providerId ? { ...current, ...patch } : current,
    );
    clearModelProbeState(providerId);
    draftBlocked.clear();
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
    modelDraftBlocked: draftBlocked.state,
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
