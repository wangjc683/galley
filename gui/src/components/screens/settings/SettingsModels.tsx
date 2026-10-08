import { Info, Plus, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useProviderSetupController } from "@/components/managed-models/use-provider-setup-controller";
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
import { ModelDefaultsPanel } from "./models/AdvancedModelOptions";
import { EditModelDefaultsContext } from "./models/edit-model-defaults-context";
import { EmptyRow, LoadingRow } from "./models/ModelPrimitives";
import { ConfiguredModelsPanel } from "./models/ConfiguredModelsPanel";
import { ProviderEditor } from "./models/ProviderEditor";
import { ProviderCard } from "./models/ProviderCard";
import {
  useModelConfigErrorToast,
  useModelConfigSavedToast,
} from "./models/use-model-config-toast";
import { useModelOrderingController } from "./models/use-model-ordering-controller";
import { useProviderConnectionController } from "./models/use-provider-connection-controller";
import { useProviderExpansion } from "./models/use-provider-expansion";
import {
  ModelDraftBlockedContext,
  useEditorBlockedSignal,
  useProviderModelController,
} from "./models/use-provider-model-controller";

export function SettingsModels({
  activeRuntimeKind = "managed",
}: {
  activeRuntimeKind?: RuntimeKind;
}) {
  const copy = useCopy();
  const modelCopy = copy.settings.models;
  const providers = useManagedModelsStore((s) => s.providers);
  const models = useManagedModelsStore((s) => s.models);
  const defaults = useManagedModelsStore((s) => s.defaults);
  const loading = useManagedModelsStore((s) => s.loading);
  const saving = useManagedModelsStore((s) => s.saving);
  const loadError = useManagedModelsStore((s) => s.loadError);
  const load = useManagedModelsStore((s) => s.load);
  const storeSaveProvider = useManagedModelsStore((s) => s.saveProvider);
  const storeDeleteProvider = useManagedModelsStore((s) => s.deleteProvider);
  const storeSaveModel = useManagedModelsStore((s) => s.saveModel);
  const storeSaveDefaults = useManagedModelsStore((s) => s.saveDefaults);
  const storeReorderModels = useManagedModelsStore((s) => s.reorderModels);
  const storeDeleteModel = useManagedModelsStore((s) => s.deleteModel);
  const reportError = useModelConfigErrorToast();
  // Every write on this page reports a failure as an error toast (the
  // store keeps no write-error state and rethrows). The controllers get
  // these wrapped actions, so ordering, model and provider flows all
  // report the same way while keeping their own catch-and-stay
  // behavior (a failed editor save leaves the editor open, draft
  // intact).
  const saveProvider = reportingFailures(storeSaveProvider, (e) =>
    reportError(e, "save_managed_model_provider"),
  );
  const deleteProvider = reportingFailures(storeDeleteProvider, (e) =>
    reportError(e, "delete_managed_model_provider"),
  );
  const saveModel = reportingFailures(storeSaveModel, (e) =>
    reportError(e, "save_managed_model"),
  );
  const saveDefaults = reportingFailures(storeSaveDefaults, (e) =>
    reportError(e, "set_managed_model_defaults"),
  );
  const reorderModels = reportingFailures(storeReorderModels, (e) =>
    reportError(e, "reorder_managed_models"),
  );
  const deleteModel = reportingFailures(storeDeleteModel, (e) =>
    reportError(e, "delete_managed_model"),
  );
  const modelRowRefs = useRef<Record<string, HTMLButtonElement>>({});
  const [pendingFocusModelId, setPendingFocusModelId] = useState<string | null>(
    null,
  );
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const defaultsSectionRef = useRef<HTMLDivElement>(null);
  const editDefaults = useCallback(() => {
    setDefaultsOpen(true);
    window.requestAnimationFrame(() => {
      defaultsSectionRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const [providerDeleteCandidate, setProviderDeleteCandidate] = useState<
    (ProviderDeleteCandidate & { id: string }) | null
  >(null);

  // Re-read on every tab entry (and on 「重试」). A failure over data
  // already on screen keeps that data and says so in a toast; with
  // nothing on screen the 服务商 section shows the failure inline.
  const reloadModels = useCallback(async () => {
    const result = await load();
    if (result.loadError === null) return;
    const state = useManagedModelsStore.getState();
    if (state.providers.length > 0 || state.models.length > 0) {
      reportError(state.loadError, "list_managed_models", "load");
    }
  }, [load, reportError]);

  useEffect(() => {
    void reloadModels();
  }, [reloadModels]);

  const showModelConfigSavedToast = useModelConfigSavedToast(activeRuntimeKind);
  const { expandProvider, isProviderExpanded, toggleProvider } =
    useProviderExpansion();
  const {
    orderedModels,
    modelMoveFeedback,
    handleMoveConfiguredModel,
    handleReorderConfiguredModels,
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
    defaults,
    saveModel,
    expandProvider,
    showModelConfigSavedToast,
  });
  const providerConnectionController = useProviderConnectionController();
  // The provider form's counterpart of the model draft's blocked state
  // (that one lives in useProviderModelController): set when 「添加」,
  // 「⋯ → 编辑」 or the card header was refused because the open form
  // holds unsaved input.
  const providerEditorBlocked = useEditorBlockedSignal();
  const providerFormController = useProviderSetupController({
    loading,
    loadFailed: loadError !== null,
    providers,
    models: orderedModels,
    defaults,
    saving,
    saveProvider,
    saveModel,
    loadManagedModels: load,
    expandProvider,
    rememberProviderModelOptions:
      providerModelController.rememberProviderModelOptions,
    // Post-save tail, formerly inlined in the settings-only controller:
    // clear both probe maps for the saved provider, expand its card,
    // and confirm with the saved toast.
    onSaved: ({ providerId, isNewProvider }) => {
      providerEditorBlocked.clear();
      providerConnectionController.clearProviderProbeState(providerId);
      providerModelController.clearModelProbeState(providerId);
      expandProvider(providerId);
      showModelConfigSavedToast(
        isNewProvider
          ? modelCopy.providerCreatedToastMessage
          : copy.toasts.modelConfigSavedMessage,
      );
    },
    onCodexComplete: (providerId) => {
      providerEditorBlocked.clear();
      expandProvider(providerId);
      showModelConfigSavedToast(modelCopy.providerCreatedToastMessage);
    },
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
    canClearProviderKey,
    canFetchProviderFormModels,
    canSaveProvider,
    canTestProvider,
    cancelClearProviderKey,
    cancelNoAuthSave,
    clearKeyConfirmOpen,
    codexLoginStart,
    codexPolling,
    confirmClearProviderKey,
    confirmNoAuthSave,
    editingProviderIsNoAuth,
    noAuthConfirmOpen,
    handleCodexCompleteLogin,
    handleCodexImport,
    handleCodexLogin,
    handleCodexLogout,
    handleCodexOpenLoginPage,
    handleProviderClearKey,
    handleProviderFormFetchModels,
    handleProviderFormTest,
    handleProviderSave,
    providerFormDirty,
    providerFormIsInlineEdit,
    providerFormModelOptions,
    providerFormProbeState,
    providerHasSavedKey,
    resetProviderForm,
    selectProviderPreset,
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
    void deleteModel(model.id).then(
      () => {
        // A draft left on a removed model has no row to show it, yet
        // would still block every other editor as "unsaved".
        if (providerModelController.modelDraft?.id === model.id) {
          providerModelController.resetModelDraft();
        }
      },
      () => undefined,
    );
  };

  // ---- Provider form: the page-level guards (D2, plan A) ----------
  // 「添加」, another card's 「⋯ → 编辑」 and this card's header would each
  // replace the open form; with unsaved input they refuse instead and
  // flag it (highlight + 「先保存或关闭当前编辑」). Switching cards inside
  // the create form is the user's own choice and is not guarded.
  const closeProviderEditor = () => {
    providerEditorBlocked.clear();
    resetProviderForm();
  };

  const providerFormReplaceable = () => {
    if (!providerFormDirty) return true;
    providerEditorBlocked.signal();
    return false;
  };

  const handleAddProvider = () => {
    if (!providerFormReplaceable()) return;
    providerEditorBlocked.clear();
    startNewProvider();
  };

  const handleEditProvider = (provider: ManagedModelProviderRecord) => {
    // Already editing this one: keep what's typed.
    if (visibleProviderForm?.id === provider.id) {
      expandProvider(provider.id);
      return;
    }
    if (!providerFormReplaceable()) return;
    providerEditorBlocked.clear();
    startEditProvider(provider);
  };

  // While a card's editor is open the card can't fold under it, so its
  // header closes the editor (a dirty one refuses) and folds the card.
  const handleToggleProviderCard = (provider: ManagedModelProviderRecord) => {
    if (visibleProviderForm?.id !== provider.id) {
      toggleProvider(provider.id);
      return;
    }
    if (!providerFormReplaceable()) return;
    closeProviderEditor();
    if (isProviderExpanded(provider.id)) toggleProvider(provider.id);
  };

  const changeProviderForm = (
    patch: Parameters<typeof updateProviderForm>[0],
  ) => {
    providerEditorBlocked.clear();
    updateProviderForm(patch);
  };

  const changeProviderPreset = (
    providerPresetId: Parameters<typeof selectProviderPreset>[0],
  ) => {
    providerEditorBlocked.clear();
    selectProviderPreset(providerPresetId);
  };

  // The edit form's 「测试模型」 probes the provider's first added model
  // (the same one the card header's check uses), with that model's
  // stored options.
  const editTestModel = visibleProviderForm?.id
    ? modelsByProvider[visibleProviderForm.id]?.[0]
    : undefined;

  const focusProtectedDraft = (modelId?: string) => {
    if (modelId) {
      setPendingFocusModelId(modelId);
      return;
    }
    // A manual-add draft lives inside its provider's card, which may
    // have been folded since: reopen it so the flagged editor is seen
    // (the editor scrolls itself into view).
    const draft = providerModelController.modelDraft;
    if (draft && !draft.id) expandProvider(draft.providerId);
  };

  const confirmDeleteProvider = () => {
    const candidate = providerDeleteCandidate;
    if (!candidate) return;
    setProviderDeleteCandidate(null);
    void deleteProvider(candidate.id).then(
      () => {
        // Editors left on the deleted provider have nothing to save to;
        // an orphaned provider form would also, with no providers left,
        // stand in for the create form that should open by itself.
        if (visibleProviderForm?.id === candidate.id) closeProviderEditor();
        if (providerModelController.modelDraft?.providerId === candidate.id) {
          providerModelController.resetModelDraft();
        }
      },
      () => undefined,
    );
  };

  const providerListEmpty = providers.length === 0;
  // A failed load with nothing to show: the section is only the failure
  // and a retry — no 「还没有模型服务商。」, no create form (it would read
  // as "nothing configured" when the list simply couldn't be read).
  const loadFailedWithoutData =
    loadError !== null && !loading && providerListEmpty;
  // Zero providers: the create form opens by itself and can't be closed,
  // so it IS the empty state — no empty row under it, and no 「添加」,
  // which would only clear what was typed.
  const autoNewProviderForm =
    providerListEmpty && !!visibleProviderForm && !visibleProviderForm.id;
  const showAddProvider =
    !providerListEmpty ||
    (!loading && !loadFailedWithoutData && !autoNewProviderForm);
  const showNoProviders =
    providerListEmpty &&
    !loading &&
    !loadFailedWithoutData &&
    !autoNewProviderForm;

  const page = (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={copy.settings.tabs.models.title}
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
        onReorderModels={(ids) => void handleReorderConfiguredModels(ids)}
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
          {showAddProvider && (
            <Button
              // primary = the current actionable next step: with zero
              // providers, adding one IS the next step; once configured,
              // adding another is routine maintenance. (The usual zero-
              // provider page hides it: its create form is already open.)
              variant={providerListEmpty ? "primary" : "secondary"}
              size="sm"
              aria-label={modelCopy.addProviderAria}
              onClick={handleAddProvider}
              leadingIcon={<Plus size={12} weight="bold" />}
            >
              {modelCopy.addProvider}
            </Button>
          )}
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
              isNoAuthProvider={editingProviderIsNoAuth}
              canClearKey={canClearProviderKey}
              onClearKey={handleProviderClearKey}
              probeState={providerFormProbeState}
              modelOptions={providerFormModelOptions}
              blocked={providerEditorBlocked.state}
              codexLoginStart={codexLoginStart}
              codexPolling={codexPolling}
              onChange={changeProviderForm}
              onSelectProviderPreset={changeProviderPreset}
              onTest={() => void handleProviderFormTest()}
              onFetchModels={() => void handleProviderFormFetchModels()}
              onCodexLogin={() => void handleCodexLogin()}
              onCodexOpenLoginPage={() => void handleCodexOpenLoginPage()}
              onCodexCompleteLogin={() => void handleCodexCompleteLogin()}
              onCodexImport={() => void handleCodexImport()}
              onCodexLogout={() => void handleCodexLogout()}
              onSave={() => void handleProviderSave()}
              onCancel={closeProviderEditor}
            />
          )}

          {loadFailedWithoutData && (
            <LoadFailedRow
              detail={loadError}
              onRetry={() => void reloadModels()}
            />
          )}

          {/* Stale-while-revalidate: `load()` re-runs on every tab
              entry, but the store keeps the previous providers, so
              hiding them behind LoadingRow made the whole column
              collapse to one row and snap back every visit (same
              class of flash as the Channels cards). The loading row
              is for the true first load only. */}
          {loading && providers.length === 0 && (
            <div className="rounded-sm border border-line bg-surface">
              <LoadingRow />
            </div>
          )}
          {showNoProviders && (
            <div className="rounded-sm border border-line bg-surface">
              <EmptyRow text={modelCopy.noProviders} />
            </div>
          )}
          {sortedProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                models={modelsByProvider[provider.id] ?? []}
                defaultModelId={orderedModels[0]?.id}
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
                      isNoAuthProvider={editingProviderIsNoAuth}
                      canClearKey={canClearProviderKey}
                      onClearKey={handleProviderClearKey}
                      probeState={providerFormProbeState}
                      modelOptions={providerFormModelOptions}
                      editTestModel={editTestModel?.model}
                      blocked={providerEditorBlocked.state}
                      codexLoginStart={codexLoginStart}
                      codexPolling={codexPolling}
                      onChange={changeProviderForm}
                      onSelectProviderPreset={changeProviderPreset}
                      onTest={() =>
                        void handleProviderFormTest(
                          editTestModel && {
                            model: editTestModel.model,
                            advancedOptions: editTestModel.advancedOptions,
                          },
                        )
                      }
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
                      onCancel={closeProviderEditor}
                    />
                  ) : null
                }
                onToggle={() => handleToggleProviderCard(provider)}
                onEditProvider={() => handleEditProvider(provider)}
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
                onAutoFetchModels={() =>
                  void providerModelController.handleFetchModels(provider, {
                    openDraftFallback: false,
                  })
                }
                onSetModelFilter={(value) =>
                  providerModelController.setModelFilterForProvider(
                    provider.id,
                    value,
                  )
                }
                onStartModelDraft={() => {
                  const result =
                    providerModelController.startModelDraft(provider);
                  if (result.kind === "blocked-dirty") {
                    focusProtectedDraft(result.modelId);
                  }
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
                onRemoveDetectedModel={handleDeleteModel}
              />
            ))}
        </div>
      </div>

      <div ref={defaultsSectionRef} className="scroll-mt-4">
        <SettingsSectionLabel>
          {modelCopy.defaultsSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-1 text-ui-meta text-ink-muted">
          {modelCopy.defaultsSectionHint}
        </div>
        <div className="mt-2">
          <ModelDefaultsPanel
            defaults={defaults}
            open={defaultsOpen}
            onOpenChange={setDefaultsOpen}
            onChange={(next) => void saveDefaults(next).catch(() => undefined)}
          />
        </div>
      </div>

      <ConfirmDeleteProviderDialog
        candidate={providerDeleteCandidate}
        busy={saving}
        onCancel={() => setProviderDeleteCandidate(null)}
        onConfirm={confirmDeleteProvider}
      />

      <ConfirmActionDialog
        open={noAuthConfirmOpen}
        onOpenChange={(open) => {
          if (!open) cancelNoAuthSave();
        }}
        busy={saving}
        title={modelCopy.noAuthConfirmTitle}
        body={modelCopy.noAuthConfirmBody}
        confirmLabel={modelCopy.noAuthConfirmAction}
        confirmVariant="warning"
        onConfirm={confirmNoAuthSave}
      />

      <ConfirmActionDialog
        open={clearKeyConfirmOpen}
        onOpenChange={(open) => {
          if (!open) cancelClearProviderKey();
        }}
        busy={saving}
        title={modelCopy.clearKeyDialogTitle}
        body={modelCopy.clearKeyDialogBody}
        confirmLabel={modelCopy.clearApiKey}
        confirmVariant="warning"
        onConfirm={() => void confirmClearProviderKey()}
      />
    </div>
  );
  return (
    <EditModelDefaultsContext.Provider value={editDefaults}>
      <ModelDraftBlockedContext.Provider
        value={providerModelController.modelDraftBlocked}
      >
        {page}
      </ModelDraftBlockedContext.Provider>
    </EditModelDefaultsContext.Provider>
  );
}

/** Wrap a store write so its failure is reported before it propagates
 * (callers keep their own catch). */
function reportingFailures<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  report: (error: unknown) => void,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (e) {
      report(e);
      throw e;
    }
  };
}

/** 服务商 section when the config couldn't be read and nothing is on
 * screen: the failure, its raw detail, and a way to try again. */
function LoadFailedRow({
  detail,
  onRetry,
}: {
  detail: string | null;
  onRetry: () => void;
}) {
  const copy = useCopy().settings.models;
  return (
    <div className="flex items-start gap-2.5 rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2.5">
      <WarningCircle
        size={13}
        weight="fill"
        className="mt-0.5 shrink-0 text-error"
      />
      <div className="min-w-0 flex-1">
        <div className="text-ui-secondary font-medium text-error">
          {copy.loadFailed}
        </div>
        {detail && (
          <div className="mt-0.5 select-text break-words text-ui-meta text-ink-soft">
            {detail}
          </div>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {copy.retryLoad}
      </Button>
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
