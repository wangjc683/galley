import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  CircleNotch,
  Info,
  PencilSimple,
  PlugsConnected,
  Trash,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { SettingsSectionLabel } from "@/components/screens/settings/settings-ui";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

import { ModelDraftEditor } from "./ModelDraftEditor";
import { InlineProbeStatus, ProbeErrorLine } from "./ModelPrimitives";
import {
  modelDisplayParts,
  modelSwapAnimationClass,
} from "./model-settings-utils";
import type {
  ModelDraftState,
  ModelMoveDirection,
  ModelMoveFeedbackState,
  ProbeState,
} from "./types";

/**
 * "我的模型 / Your Models" — the primary, cross-provider, ordered model
 * list. This is the single source of truth for what the user can
 * switch between in the Composer: order = menu order, first = default.
 * All per-model actions (reorder / set default / edit / test / remove)
 * live here. Providers below own only credentials + which models exist.
 */
export function ConfiguredModelsPanel({
  models,
  providers,
  saving,
  moveFeedback,
  modelDraft,
  onMoveModel,
  onSetDefaultModel,
  onToggleModelDraft,
  onChangeModelDraft,
  onCancelModelDraft,
  onTestModelDraft,
  onSaveModelDraft,
  onTestModel,
  onDeleteModel,
  savedModelProbeStateFor,
  modelDraftProbeStateForProvider,
  onRegisterModelRow,
}: {
  models: ManagedModelRecord[];
  providers: ManagedModelProviderRecord[];
  saving: boolean;
  moveFeedback: ModelMoveFeedbackState | null;
  modelDraft: ModelDraftState | null;
  onMoveModel: (modelId: string, direction: ModelMoveDirection) => void;
  onSetDefaultModel: (model: ManagedModelRecord) => void;
  onToggleModelDraft: (
    provider: ManagedModelProviderRecord,
    model: ManagedModelRecord,
  ) => void;
  onChangeModelDraft: (providerId: string, patch: Partial<ModelDraftState>) => void;
  onCancelModelDraft: () => void;
  onTestModelDraft: (
    provider: ManagedModelProviderRecord,
    draft: ModelDraftState,
  ) => void;
  onSaveModelDraft: (draft: ModelDraftState) => void;
  onTestModel: (model: ManagedModelRecord) => void;
  onDeleteModel: (model: ManagedModelRecord) => void;
  savedModelProbeStateFor: (modelId: string) => ProbeState;
  modelDraftProbeStateForProvider: (providerId: string) => ProbeState;
  onRegisterModelRow?: (
    modelId: string,
    node: HTMLButtonElement | null,
  ) => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  return (
    // Section label lives outside the card, same grammar as the
    // 服务商 section below — cards contain lists, labels belong to the
    // page skeleton. The one-line subtitle is a documented exception
    // to "no persistent copy in headers": order = switch-menu order and
    // first = default are core semantics nothing else conveys.
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SettingsSectionLabel>{copy.myModels}</SettingsSectionLabel>
        <ModelScopeHint copy={copy} />
        <span aria-hidden="true" className="text-ui-tertiary text-ink-muted/45">
          ·
        </span>
        <span className="text-ui-meta text-ink-muted">
          {models.length > 0
            ? copy.enabledModelsCount(models.length)
            : copy.noEnabledModels}
        </span>
      </div>
      <div className="mt-1 text-ui-label leading-snug text-ink-muted/60">
        {copy.myModelsSubtitle}
      </div>
      {models.length > 0 ? (
        <div className="mt-2 divide-y divide-line rounded-sm border border-line bg-surface">
          {models.map((model, index) => {
            const provider = providers.find((p) => p.id === model.providerId);
            return (
              <ConfiguredModelRow
                key={model.id}
                model={model}
                provider={provider}
                isDefault={index === 0}
                isEditing={modelDraft?.id === model.id}
                draft={modelDraft?.id === model.id ? modelDraft : null}
                allModelCount={models.length}
                saving={saving}
                canMoveUp={!saving && index > 0}
                canMoveDown={!saving && index < models.length - 1}
                moveFeedback={moveFeedback}
                probeState={savedModelProbeStateFor(model.id)}
                draftProbeState={
                  provider
                    ? modelDraftProbeStateForProvider(provider.id)
                    : savedModelProbeStateFor(model.id)
                }
                onToggleEdit={() => provider && onToggleModelDraft(provider, model)}
                onSetDefault={() => onSetDefaultModel(model)}
                onTest={() => onTestModel(model)}
                onDelete={() => onDeleteModel(model)}
                onMoveUp={() => onMoveModel(model.id, "up")}
                onMoveDown={() => onMoveModel(model.id, "down")}
                onChangeDraft={(patch) =>
                  provider && onChangeModelDraft(provider.id, patch)
                }
                onCancelDraft={onCancelModelDraft}
                onTestDraft={(draft) =>
                  provider && onTestModelDraft(provider, draft)
                }
                onSaveDraft={onSaveModelDraft}
                onRegisterRow={onRegisterModelRow}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-2 rounded-sm border border-line bg-surface px-3 py-3 text-ui-secondary text-ink-muted">
          {copy.myModelsEmpty}
        </div>
      )}
    </div>
  );
}

function ModelScopeHint({
  copy,
}: {
  copy: ReturnType<typeof useCopy>["settings"]["models"];
}) {
  return (
    <TooltipLabel
      align="start"
      contentClassName="max-w-[300px] p-2.5 text-left leading-normal"
      text={
        <>
          <div className="text-ui-label font-semibold uppercase tracking-[0.06em] text-ink">
            {copy.sessionModelScopeTitle}
          </div>
          <div className="mt-1 text-ui-tertiary leading-4 text-ink-soft">
            {copy.sessionModelScopeHint}
          </div>
        </>
      }
    >
      <button
        type="button"
        aria-label={copy.sessionModelScopeTitle}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-sm border border-transparent",
          "text-ink-muted transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          "hover:border-line hover:bg-hover hover:text-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          "active:translate-y-[0.5px]",
        )}
      >
        <Info size={12} weight="bold" />
      </button>
    </TooltipLabel>
  );
}

function ConfiguredModelRow({
  model,
  provider,
  isDefault,
  isEditing,
  draft,
  allModelCount,
  saving,
  canMoveUp,
  canMoveDown,
  moveFeedback,
  probeState,
  draftProbeState,
  onToggleEdit,
  onSetDefault,
  onTest,
  onDelete,
  onMoveUp,
  onMoveDown,
  onChangeDraft,
  onCancelDraft,
  onTestDraft,
  onSaveDraft,
  onRegisterRow,
}: {
  model: ManagedModelRecord;
  provider?: ManagedModelProviderRecord;
  isDefault: boolean;
  isEditing: boolean;
  draft: ModelDraftState | null;
  allModelCount: number;
  saving: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  moveFeedback: ModelMoveFeedbackState | null;
  probeState: ProbeState;
  draftProbeState: ProbeState;
  onToggleEdit: () => void;
  onSetDefault: () => void;
  onTest: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeDraft: (patch: Partial<ModelDraftState>) => void;
  onCancelDraft: () => void;
  onTestDraft: (draft: ModelDraftState) => void;
  onSaveDraft: (draft: ModelDraftState) => void;
  onRegisterRow?: (modelId: string, node: HTMLButtonElement | null) => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  const swapClass = modelSwapAnimationClass(model.id, moveFeedback);
  const display = modelDisplayParts(model);
  const keyMissing = provider?.credentialStatus === "missing";
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const testing =
    probeState.kind === "loading" && probeState.action === "model-test";
  const showRemoveConfirm = confirmingRemove && !isDefault;

  return (
    <div
      className={cn(
        "group px-3 py-2",
        isEditing
          ? "bg-selected/45"
          : "hover:bg-elevated/55",
        swapClass,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          ref={(node) => onRegisterRow?.(model.id, node)}
          type="button"
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          aria-expanded={isEditing}
          aria-label={`${copy.editModel}: ${display.title}`}
          onClick={() => {
            setConfirmingRemove(false);
            onToggleEdit();
          }}
          className={cn(
            "min-w-0 flex-1 rounded-sm pr-2 text-left",
            "outline-none",
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div
              className={cn(
                "truncate text-ui-compact font-medium transition-colors",
                isEditing ? "text-brand-strong" : "text-ink",
              )}
            >
              {display.title}
            </div>
            {isDefault && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-brand/15 bg-brand-soft px-1.5 py-px text-ui-micro leading-4 text-brand-strong">
                <CheckCircle size={10} weight="fill" />
                {copy.defaultModel}
              </span>
            )}
            <span
              className="inline-flex max-w-[180px] shrink-0 truncate rounded-sm bg-ink-muted/10 px-1.5 py-px text-ui-micro leading-4 text-ink-muted/80"
              title={model.providerDisplayName}
            >
              {model.providerDisplayName}
            </span>
          </div>
          {display.subtitle && (
            <div className="mt-0.5 truncate font-mono text-ui-label text-ink-muted/85">
              {display.subtitle}
            </div>
          )}
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <div className="flex items-center gap-0.5 opacity-50 group-hover:opacity-100">
            <IconButton
              ariaLabel={copy.testModel}
              size="sm"
              disabled={keyMissing || saving || testing}
              onClick={() => {
                setConfirmingRemove(false);
                onTest();
              }}
            >
              {testing ? (
                <span className="spin">
                  <CircleNotch size={13} weight="thin" />
                </span>
              ) : (
                <PlugsConnected size={13} weight="thin" />
              )}
            </IconButton>
            <InlineProbeStatus state={probeState} action="model-test" />
            {!isDefault && (
              <IconButton
                ariaLabel={copy.setDefault}
                size="sm"
                disabled={saving}
                onClick={() => {
                  setConfirmingRemove(false);
                  onSetDefault();
                }}
              >
                <CheckCircle size={13} weight="thin" />
              </IconButton>
            )}
            <IconButton
              ariaLabel={copy.editModel}
              size="sm"
              onClick={() => {
                setConfirmingRemove(false);
                onToggleEdit();
              }}
            >
              <PencilSimple size={13} weight="thin" />
            </IconButton>
            {!isDefault && !showRemoveConfirm && (
              <IconButton
                ariaLabel={copy.removeModel}
                variant="danger"
                size="sm"
                disabled={saving}
                onClick={() => setConfirmingRemove(true)}
              >
                <Trash size={13} weight="thin" />
              </IconButton>
            )}
          </div>
          <span className="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden />
          <IconButton
            ariaLabel={copy.moveUp(display.title)}
            size="xs"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            className="text-ink-muted/45 group-hover:text-ink-muted hover:text-ink"
          >
            <ArrowUp size={11} weight="bold" />
          </IconButton>
          <IconButton
            ariaLabel={copy.moveDown(display.title)}
            size="xs"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            className="text-ink-muted/45 group-hover:text-ink-muted hover:text-ink"
          >
            <ArrowDown size={11} weight="bold" />
          </IconButton>
        </div>
      </div>

      {showRemoveConfirm && (
        <div
          className={cn(
            "mt-2 flex items-center justify-end gap-2 rounded-sm border border-line/70",
            "bg-surface/60 px-2 py-1.5 text-ui-meta text-ink-soft",
          )}
        >
          <span className="min-w-0 flex-1">{copy.removeModelInlineConfirm}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => setConfirmingRemove(false)}
          >
            {appCopy.common.cancel}
          </Button>
          <Button
            variant="destructive-soft"
            size="sm"
            disabled={saving}
            onClick={() => {
              setConfirmingRemove(false);
              onDelete();
            }}
          >
            {copy.removeModel}
          </Button>
        </div>
      )}

      {isEditing && draft && provider && (
        <div className="pt-2">
          <ModelDraftEditor
            draft={draft}
            protocol={provider.protocol}
            authKind={provider.authKind}
            saving={saving}
            keyMissing={keyMissing}
            modelProbeState={draftProbeState}
            allModelCount={allModelCount}
            onChange={onChangeDraft}
            onCancel={onCancelDraft}
            onTest={() => onTestDraft(draft)}
            onSave={() => onSaveDraft(draft)}
          />
        </div>
      )}

      <ProbeErrorLine state={probeState} action="model-test" />
    </div>
  );
}
