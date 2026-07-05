import { Info, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";
import { useManagedModelsStore } from "@/stores/managed-models";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";
import type { RuntimeKind } from "@/types/session";
import {
  ConfirmDeleteProviderDialog,
  type ProviderDeleteCandidate,
} from "./models/DeleteProviderConfirmDialog";
import { EmptyRow, ErrorLine, LoadingRow } from "./models/ModelPrimitives";
import { ConfiguredModelsPanel } from "./models/ConfiguredModelsPanel";
import { ProviderEditor } from "./models/ProviderEditor";
import { ProviderCard } from "./models/ProviderCard";
import { useModelConfigSavedToast } from "./models/use-model-config-toast";
import { useModelOrderingController } from "./models/use-model-ordering-controller";
import { useProviderConnectionController } from "./models/use-provider-connection-controller";
import { useProviderExpansion } from "./models/use-provider-expansion";
import { useProviderFormController } from "./models/use-provider-form-controller";
import { useProviderModelController } from "./models/use-provider-model-controller";

export function SettingsModels({
  activeRuntimeKind = "managed",
}: {
  activeRuntimeKind?: RuntimeKind;
}) {
  const copy = useCopy();
  const modelCopy = copy.settings.models;
  const providers = useManagedModelsStore((s) => s.providers);
  const models = useManagedModelsStore((s) => s.models);
  const loading = useManagedModelsStore((s) => s.loading);
  const saving = useManagedModelsStore((s) => s.saving);
  const error = useManagedModelsStore((s) => s.error);
  const load = useManagedModelsStore((s) => s.load);
  const saveProvider = useManagedModelsStore((s) => s.saveProvider);
  const deleteProvider = useManagedModelsStore((s) => s.deleteProvider);
  const saveModel = useManagedModelsStore((s) => s.saveModel);
  const reorderModels = useManagedModelsStore((s) => s.reorderModels);
  const deleteModel = useManagedModelsStore((s) => s.deleteModel);
  const modelRowRefs = useRef<Record<string, HTMLButtonElement>>({});
  const [pendingFocusModelId, setPendingFocusModelId] = useState<string | null>(
    null,
  );
  const [providerDeleteCandidate, setProviderDeleteCandidate] = useState<
    (ProviderDeleteCandidate & { id: string }) | null
  >(null);

  useEffect(() => {
    void load();
  }, [load]);

  const showModelConfigSavedToast = useModelConfigSavedToast();
  const { expandProvider, isProviderExpanded, toggleProvider } =
    useProviderExpansion();
  const {
    orderedModels,
    modelMoveFeedback,
    handleMoveConfiguredModel,
    handleSetDefaultModel,
  } = useModelOrderingController({
    models,
    saving,
    saveModel,
    reorderModels,
    showModelConfigSavedToast,
  });

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, ManagedModelRecord[]> = {};
    for (const model of orderedModels) {
      grouped[model.providerId] = grouped[model.providerId] ?? [];
      grouped[model.providerId].push(model);
    }
    return grouped;
  }, [orderedModels]);

  // Float the provider that supplies the default model (orderedModels[0])
  // to the top of the providers list, keeping the rest in their existing
  // order. Provider order has no functional effect — this is purely so
  // the source of your default model is the first card you see.
  const sortedProviders = useMemo(() => {
    const defaultProviderId = orderedModels[0]?.providerId;
    if (!defaultProviderId) return providers;
    const index = providers.findIndex((p) => p.id === defaultProviderId);
    if (index <= 0) return providers;
    const next = [...providers];
    const [defaultProvider] = next.splice(index, 1);
    return [defaultProvider, ...next];
  }, [providers, orderedModels]);

  const providerModelController = useProviderModelController({
    providers,
    models: orderedModels,
    saveModel,
    expandProvider,
    showModelConfigSavedToast,
  });
  const providerConnectionController = useProviderConnectionController();
  const providerFormController = useProviderFormController({
    loading,
    providers,
    models: orderedModels,
    saving,
    saveProvider,
    saveModel,
    loadManagedModels: load,
    expandProvider,
    clearProviderProbeState:
      providerConnectionController.clearProviderProbeState,
    clearModelProbeState: providerModelController.clearModelProbeState,
    rememberProviderModelOptions:
      providerModelController.rememberProviderModelOptions,
    showModelConfigSavedToast,
  });
  const editingModelId = providerModelController.modelDraft?.id;

  const registerModelRow = useCallback(
    (modelId: string, node: HTMLButtonElement | null) => {
      if (node) {
        modelRowRefs.current[modelId] = node;
      } else {
        delete modelRowRefs.current[modelId];
      }
    },
    [],
  );

  useEffect(() => {
    if (!pendingFocusModelId) return;
    const handle = window.setTimeout(() => {
      const node = modelRowRefs.current[pendingFocusModelId];
      if (!node) return;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.focus({ preventScroll: true });
      setPendingFocusModelId(null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [editingModelId, pendingFocusModelId, providers.length]);

  const {
    canFetchProviderFormModels,
    canSaveProvider,
    canTestProvider,
    codexLoginStart,
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
  } = providerFormController;

  const handleDeleteProvider = (provider: ManagedModelProviderRecord) => {
    const providerModels = modelsByProvider[provider.id] ?? [];
    setProviderDeleteCandidate({
      id: provider.id,
      name: provider.displayName,
      modelCount: providerModels.length,
    });
  };

  const handleDeleteModel = (model: ManagedModelRecord) => {
    void deleteModel(model.id).catch(() => undefined);
  };

  const focusProtectedDraft = (modelId?: string) => {
    if (modelId) {
      setPendingFocusModelId(modelId);
    }
  };

  const confirmDeleteProvider = () => {
    const candidate = providerDeleteCandidate;
    if (!candidate) return;
    setProviderDeleteCandidate(null);
    void deleteProvider(candidate.id).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <SettingsPanelHeader
        title={copy.settings.tabs.models.label}
        subtitle={modelCopy.subtitle}
      />

      {activeRuntimeKind === "external" && <ExternalRuntimeNotice />}

      <ConfiguredModelsPanel
        models={orderedModels}
        providers={providers}
        saving={saving}
        moveFeedback={modelMoveFeedback}
        modelDraft={providerModelController.modelDraft}
        onMoveModel={handleMoveConfiguredModel}
        onSetDefaultModel={(model) => void handleSetDefaultModel(model)}
        onToggleModelDraft={(provider, model) => {
          const result = providerModelController.toggleModelDraft(
            provider,
            model,
          );
          if (result.kind === "blocked-dirty") {
            focusProtectedDraft(result.modelId);
          }
        }}
        onChangeModelDraft={(providerId, patch) =>
          providerModelController.changeModelDraft(providerId, patch)
        }
        onCancelModelDraft={providerModelController.resetModelDraft}
        onTestModelDraft={(provider, draft) =>
          void providerModelController.handleTestDraftModel(provider, draft)
        }
        onSaveModelDraft={(draft) =>
          void providerModelController.handleSaveDraftModel(draft)
        }
        onTestModel={(model) =>
          void providerModelController.handleTestSavedModel(model)
        }
        onDeleteModel={handleDeleteModel}
        savedModelProbeStateFor={
          providerModelController.savedModelProbeStateForModel
        }
        modelDraftProbeStateForProvider={
          providerModelController.modelProbeStateForProvider
        }
        onRegisterModelRow={registerModelRow}
      />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SettingsSectionLabel>
              {modelCopy.providersLabel}
            </SettingsSectionLabel>
          </div>
          <Button
            // primary = the current actionable next step: with zero
            // providers, adding one IS the next step; once configured,
            // adding another is routine maintenance.
            variant={providers.length === 0 ? "primary" : "secondary"}
            size="sm"
            aria-label={modelCopy.addProviderAria}
            onClick={startNewProvider}
            leadingIcon={<Plus size={12} weight="bold" />}
          >
            {modelCopy.addProvider}
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {visibleProviderForm && !providerFormIsInlineEdit && (
            <ProviderEditor
              form={visibleProviderForm}
              saving={saving}
              canSave={canSaveProvider}
              canTest={canTestProvider}
              canFetchModels={canFetchProviderFormModels}
              canCancel={providers.length > 0 || !!visibleProviderForm.id}
              providerHasSavedKey={providerHasSavedKey}
              probeState={providerFormProbeState}
              modelOptions={providerFormModelOptions}
              modelFilter={providerFormModelFilter}
              codexLoginStart={codexLoginStart}
              onChange={updateProviderForm}
              onSetModelFilter={setProviderFormModelFilter}
              onSelectProviderPreset={selectProviderPreset}
              onTest={() => void handleProviderFormTest()}
              onFetchModels={() => void handleProviderFormFetchModels()}
              onCodexLogin={() => void handleCodexLogin()}
              onCodexOpenLoginPage={() => void handleCodexOpenLoginPage()}
              onCodexCompleteLogin={() => void handleCodexCompleteLogin()}
              onCodexImport={() => void handleCodexImport()}
              onCodexLogout={() => void handleCodexLogout()}
              onSave={() => void handleProviderSave()}
              onCancel={resetProviderForm}
            />
          )}

          {error && <ErrorLine message={error} />}

          {loading && (
            <div className="rounded-sm border border-line bg-surface">
              <LoadingRow />
            </div>
          )}
          {!loading && providers.length === 0 && (
            <div className="rounded-sm border border-line bg-surface">
              <EmptyRow text={modelCopy.noProviders} />
            </div>
          )}
          {!loading &&
            sortedProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                models={modelsByProvider[provider.id] ?? []}
                allModelCount={orderedModels.length}
                saving={saving}
                expanded={isProviderExpanded(provider.id)}
                providerProbeState={providerConnectionController.providerProbeStateFor(
                  provider.id,
                )}
                modelProbeState={providerModelController.modelProbeStateForProvider(
                  provider.id,
                )}
                modelOptions={providerModelController.modelOptionsForProvider(
                  provider.id,
                )}
                modelFilter={providerModelController.modelFilterForProvider(
                  provider.id,
                )}
                modelDraft={
                  providerModelController.modelDraft?.providerId === provider.id
                    ? providerModelController.modelDraft
                    : null
                }
                providerEditor={
                  visibleProviderForm?.id === provider.id ? (
                    <ProviderEditor
                      form={visibleProviderForm}
                      saving={saving}
                      canSave={canSaveProvider}
                      canTest={canTestProvider}
                      canFetchModels={canFetchProviderFormModels}
                      canCancel={
                        providers.length > 0 || !!visibleProviderForm.id
                      }
                      providerHasSavedKey={providerHasSavedKey}
                      probeState={providerFormProbeState}
                      modelOptions={providerFormModelOptions}
                      modelFilter={providerFormModelFilter}
                      codexLoginStart={codexLoginStart}
                      onChange={updateProviderForm}
                      onSetModelFilter={setProviderFormModelFilter}
                      onSelectProviderPreset={selectProviderPreset}
                      onTest={() => void handleProviderFormTest()}
                      onFetchModels={() => void handleProviderFormFetchModels()}
                      onCodexLogin={() => void handleCodexLogin()}
                      onCodexOpenLoginPage={() =>
                        void handleCodexOpenLoginPage()
                      }
                      onCodexCompleteLogin={() =>
                        void handleCodexCompleteLogin()
                      }
                      onCodexImport={() => void handleCodexImport()}
                      onCodexLogout={() => void handleCodexLogout()}
                      onSave={() => void handleProviderSave()}
                      onCancel={resetProviderForm}
                    />
                  ) : null
                }
                onToggle={() => toggleProvider(provider.id)}
                onEditProvider={() => startEditProvider(provider)}
                onDeleteProvider={() => handleDeleteProvider(provider)}
                onTestProvider={() =>
                  void providerConnectionController.handleProviderTest(
                    provider,
                    modelsByProvider[provider.id] ?? [],
                  )
                }
                onFetchModels={() =>
                  void providerModelController.handleFetchModels(provider)
                }
                onSetModelFilter={(value) =>
                  providerModelController.setModelFilterForProvider(
                    provider.id,
                    value,
                  )
                }
                onStartModelDraft={() => {
                  const draft = providerModelController.modelDraft;
                  if (draft && providerModelController.isModelDraftDirty()) {
                    focusProtectedDraft(draft.id);
                    return;
                  }
                  providerModelController.startModelDraft(provider);
                }}
                onChangeModelDraft={(patch) =>
                  providerModelController.changeModelDraft(provider.id, patch)
                }
                onCancelModelDraft={providerModelController.resetModelDraft}
                onTestModelDraft={(draft) =>
                  void providerModelController.handleTestDraftModel(
                    provider,
                    draft,
                  )
                }
                onSaveModelDraft={(draft) =>
                  void providerModelController.handleSaveDraftModel(draft)
                }
                onEnableDetectedModel={(modelName) =>
                  void providerModelController.handleEnableDetectedModel(
                    provider,
                    modelName,
                  )
                }
              />
            ))}
        </div>
      </div>

      <ConfirmDeleteProviderDialog
        candidate={providerDeleteCandidate}
        busy={saving}
        onCancel={() => setProviderDeleteCandidate(null)}
        onConfirm={confirmDeleteProvider}
      />
    </div>
  );
}

function ExternalRuntimeNotice() {
  const copy = useCopy().settings.models;
  return (
    <div className="flex gap-2 rounded-sm border border-brand/25 bg-brand-soft px-3 py-2.5 text-ui-secondary leading-notice text-ink">
      <Info
        size={14}
        weight="bold"
        className="mt-0.5 shrink-0 text-brand-strong"
      />
      <div>{copy.externalNotice}</div>
    </div>
  );
}
