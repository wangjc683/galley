import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  DotsThreeVertical,
  ListMagnifyingGlass,
  MagnifyingGlass,
  PencilSimple,
  PlugsConnected,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

import { modelDisplayParts } from "./model-settings-utils";
import { ModelDraftEditor } from "./ModelDraftEditor";
import {
  CredentialBadge,
  EmptyRow,
  ErrorLine,
  InfoLine,
  InlineProbeStatus,
  ProbeErrorLine,
  ProtocolBadge,
} from "./ModelPrimitives";
import type { ModelDraftState, ProbeAction, ProbeState } from "./types";

/**
 * Provider card — a model *source* (credentials + endpoint + protocol)
 * and the place you decide which of its models exist: the detected-model
 * list toggles both ways (enable, and remove with the same inline
 * confirm as "我的模型"; the default model stays non-removable). Per-model
 * *arrangement* (order / default / edit / test) lives in the "我的模型"
 * list above; this card deliberately does not duplicate it, showing
 * enabled models only as read-only chips.
 */
export function ProviderCard({
  provider,
  models,
  defaultModelId,
  allModelCount,
  saving,
  expanded,
  providerProbeState,
  modelProbeState,
  modelOptions,
  modelFilter,
  modelDraft,
  providerEditor,
  onToggle,
  onEditProvider,
  onDeleteProvider,
  onTestProvider,
  onFetchModels,
  onAutoFetchModels,
  onSetModelFilter,
  onStartModelDraft,
  onChangeModelDraft,
  onCancelModelDraft,
  onTestModelDraft,
  onSaveModelDraft,
  onEnableDetectedModel,
  onRemoveDetectedModel,
}: {
  provider: ManagedModelProviderRecord;
  models: ManagedModelRecord[];
  defaultModelId?: string;
  allModelCount: number;
  saving: boolean;
  expanded: boolean;
  providerProbeState: ProbeState;
  modelProbeState: ProbeState;
  modelOptions: string[];
  modelFilter: string;
  modelDraft: ModelDraftState | null;
  providerEditor?: ReactNode;
  onToggle: () => void;
  onEditProvider: () => void;
  onDeleteProvider: () => void;
  onTestProvider: () => void;
  onFetchModels: () => void;
  onAutoFetchModels: () => void;
  onSetModelFilter: (value: string) => void;
  onStartModelDraft: () => void;
  onChangeModelDraft: (patch: Partial<ModelDraftState>) => void;
  onCancelModelDraft: () => void;
  onTestModelDraft: (draft: ModelDraftState) => void;
  onSaveModelDraft: (draft: ModelDraftState) => void;
  onEnableDetectedModel: (modelName: string) => void;
  onRemoveDetectedModel: (model: ManagedModelRecord) => void;
}) {
  const copy = useCopy().settings.models;
  const keyMissing = provider.credentialStatus === "missing";
  const providerProbeAction: ProbeAction = "model-test";
  const headerProbeState = providerProbeState;
  const providerProbeLoading =
    headerProbeState.kind === "loading" &&
    headerProbeState.action === providerProbeAction;
  const canUseProvider = !keyMissing && !providerProbeLoading && !saving;
  const canFetchModels =
    !keyMissing && modelProbeState.kind !== "loading" && !saving;
  const enabledModelsByName = useMemo(
    () => new Map(models.map((item) => [item.model, item])),
    [models],
  );
  const normalizedFilter = modelFilter.trim().toLowerCase();
  const filteredOptions = modelOptions.filter((option) =>
    option.toLowerCase().includes(normalizedFilter),
  );
  const visibleOptions = filteredOptions.slice(0, 80);
  const open = expanded || !!providerEditor;

  // Expand-triggered scroll: the card grows downward, and in a small
  // window the new content lands below the fold. `nearest` scrolls the
  // minimum to reveal the card bottom, and when the card is taller than
  // the viewport it pins the header to the top instead — either way the
  // controls are reachable without a manual scroll. This runs twice per
  // expand at most: once immediately (the card is still short — the
  // detected-model list hasn't arrived), and once more when the
  // expand-triggered auto-fetch below delivers the list and the card
  // takes its full height (`pendingListScrollRef`). Collapsing while the
  // fetch is in flight cancels the second scroll.
  const rootRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(open);
  const pendingListScrollRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    wasOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    if (!pendingListScrollRef.current) return;
    if (!open) {
      pendingListScrollRef.current = false;
      return;
    }
    if (modelOptions.length === 0) return;
    pendingListScrollRef.current = false;
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, modelOptions.length]);

  // Expand-triggered auto-fetch: pull the provider's model list once
  // per session when the card opens with nothing cached, so "可添加模型"
  // appears without a manual click. Codex providers are skipped (their
  // backend has no meaningful model listing) and the explicit button
  // below stays as the refresh path.
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (
      !expanded ||
      autoFetchedRef.current ||
      keyMissing ||
      saving ||
      provider.authKind === "chatgpt_codex_oauth" ||
      modelOptions.length > 0 ||
      modelProbeState.kind === "loading"
    ) {
      return;
    }
    autoFetchedRef.current = true;
    pendingListScrollRef.current = true;
    onAutoFetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expanded,
    keyMissing,
    saving,
    provider.authKind,
    modelOptions.length,
    modelProbeState.kind,
  ]);

  const shouldShowManualModelHint =
    modelProbeState.kind !== "idle" &&
    modelProbeState.action === "model-list" &&
    (modelProbeState.kind === "error" ||
      (modelProbeState.kind === "success" && modelOptions.length === 0));

  return (
    <div
      ref={rootRef}
      className={cn(
        // Quiet header grammar, matching the ChannelCard / model-row
        // idiom: light hover tint + caret emphasis only. The primary
        // "我的模型" list above must stay the loudest surface on this
        // tab — the maintenance area doesn't lift, shadow, or turn
        // brand-colored on hover.
        "group/provider overflow-hidden rounded-sm border border-line bg-surface transition-colors duration-(--motion-fast) ease-firm",
        open && "border-line-strong",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-2 py-1.5">
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          aria-expanded={open}
          className={cn(
            "group/toggle flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1.5 py-0.5 text-left",
            "outline-none hover:bg-hover",
          )}
          onClick={onToggle}
        >
          <span
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors duration-(--motion-fast) ease-firm",
              open ? "text-ink" : "text-ink-soft",
            )}
          >
            {open ? (
              <CaretDown size={12} weight="bold" />
            ) : (
              <CaretRight size={12} weight="bold" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="min-w-0 truncate text-ui-compact font-medium text-ink"
              title={provider.displayName}
            >
              {provider.displayName}
            </span>
            <CredentialBadge
              status={provider.credentialStatus}
              authKind={provider.authKind}
            />
            <span className="inline-flex shrink-0 rounded-sm border border-line bg-surface/80 px-1.5 py-px text-ui-micro tabular-nums text-ink-muted">
              {copy.enabledModelsCount(models.length)}
            </span>
            <ProtocolBadge
              protocol={provider.protocol}
              apiBase={provider.apiBase}
            />
          </span>
        </button>
        <div
          className={cn(
            "ml-auto flex shrink-0 items-center gap-1.5 opacity-75",
            "group-hover/provider:opacity-100",
            headerProbeState.kind === "loading" && "opacity-100",
          )}
        >
          {models.length > 0 && (
            <IconButton
              ariaLabel={copy.checkService}
              size="sm"
              active={providerProbeLoading}
              disabled={!canUseProvider}
              onClick={onTestProvider}
              className="text-ink-muted"
            >
              {providerProbeLoading ? (
                <span className="spin">
                  <CircleNotch size={12} weight="thin" />
                </span>
              ) : (
                <PlugsConnected size={12} weight="thin" />
              )}
            </IconButton>
          )}
          <InlineProbeStatus
            state={headerProbeState}
            action={providerProbeAction}
          />
          <ProviderActionsMenu
            disabled={saving}
            onEdit={onEditProvider}
            onDelete={onDeleteProvider}
          />
        </div>
      </div>
      <ProbeErrorLine
        state={headerProbeState}
        action={providerProbeAction}
        className="px-4 pb-3"
      />
      {open && (
        <div className="border-t border-line/70 bg-app px-2.5 py-2">
          <div className="space-y-2 pl-8 pr-1">
            {providerEditor}
            {expanded && (
              <>
                {keyMissing && <ErrorLine message={copy.keyNeedsResave} />}

                {models.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                    <span className="text-ui-tertiary text-ink-muted">
                      {copy.enabledFromProvider}
                    </span>
                    {models.map((model) => (
                      <span
                        key={model.id}
                        className="inline-flex max-w-[200px] shrink-0 truncate rounded-sm bg-ink-muted/10 px-1.5 py-px font-mono text-ui-label leading-4 text-ink-muted/85"
                        title={model.model}
                      >
                        {modelDisplayParts(model).title}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-line/60 bg-surface px-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-1.5 text-ink-muted/80 hover:text-ink"
                    disabled={!canFetchModels}
                    onClick={onFetchModels}
                    leadingIcon={
                      modelProbeState.kind === "loading" &&
                      modelProbeState.action === "model-list" ? (
                        <span className="spin">
                          <CircleNotch size={12} weight="thin" />
                        </span>
                      ) : (
                        <ListMagnifyingGlass size={12} weight="thin" />
                      )
                    }
                  >
                    {copy.fetchModelList}
                  </Button>
                  <InlineProbeStatus
                    state={modelProbeState}
                    action="model-list"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-1.5 text-ink-muted/80 hover:text-ink"
                    disabled={keyMissing || saving}
                    onClick={onStartModelDraft}
                    leadingIcon={<Plus size={12} weight="bold" />}
                  >
                    {copy.addManually}
                  </Button>
                </div>
                {modelDraft && !modelDraft.id && (
                  <ModelDraftEditor
                    draft={modelDraft}
                    protocol={provider.protocol}
                    authKind={provider.authKind}
                    saving={saving}
                    keyMissing={keyMissing}
                    modelProbeState={modelProbeState}
                    allModelCount={allModelCount}
                    onChange={onChangeModelDraft}
                    onCancel={onCancelModelDraft}
                    onTest={() => onTestModelDraft(modelDraft)}
                    onSave={() => onSaveModelDraft(modelDraft)}
                  />
                )}
                <ProbeErrorLine state={modelProbeState} action="model-list" />
                {shouldShowManualModelHint && (
                  <InfoLine message={copy.modelListManualFallback} />
                )}

                {modelOptions.length > 0 && (
                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-ui-secondary font-medium text-ink">
                        {copy.availableModels}
                      </div>
                      <div className="relative w-full max-w-[260px]">
                        <MagnifyingGlass
                          size={12}
                          weight="thin"
                          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
                        />
                        <input
                          value={modelFilter}
                          onChange={(e) => onSetModelFilter(e.target.value)}
                          placeholder={copy.filterModels}
                          spellCheck={false}
                          className="w-full rounded-sm border border-line bg-surface py-1.5 pl-7 pr-2.5 text-ui-meta text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
                        />
                      </div>
                    </div>
                    <ScrollFade maxHeightClass="max-h-[260px]">
                      <div className="divide-y divide-line">
                        {visibleOptions.length === 0 && (
                          <EmptyRow text={copy.noMatchingModels} />
                        )}
                        {visibleOptions.map((option) => {
                          const enabledModel = enabledModelsByName.get(option);
                          return (
                            <DetectedModelRow
                              key={option}
                              modelName={option}
                              enabled={!!enabledModel}
                              canRemove={
                                !!enabledModel &&
                                enabledModel.id !== defaultModelId
                              }
                              saving={saving}
                              onEnable={() => onEnableDetectedModel(option)}
                              onRemove={() =>
                                enabledModel &&
                                onRemoveDetectedModel(enabledModel)
                              }
                            />
                          );
                        })}
                      </div>
                    </ScrollFade>
                    {filteredOptions.length > visibleOptions.length && (
                      <div className="text-ui-tertiary text-ink-muted">
                        {copy.visibleOptionsHint(visibleOptions.length)}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderActionsMenu({
  disabled,
  onEdit,
  onDelete,
}: {
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  const itemClass =
    "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none data-[highlighted]:bg-hover";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton ariaLabel={appCopy.common.more} size="sm">
          <DotsThreeVertical size={13} weight="bold" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "galley-pop-in z-[70] min-w-[112px] rounded-md border border-line bg-elevated p-1",
            "text-ui-compact text-ink shadow-elevated",
          )}
        >
          <DropdownMenu.Item onSelect={onEdit} className={itemClass}>
            <PencilSimple size={13} weight="thin" />
            {copy.editProviderAction}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={disabled}
            onSelect={onDelete}
            className={cn(
              itemClass,
              "text-error data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
            )}
          >
            <Trash size={13} weight="thin" />
            {copy.deleteProviderAction}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function DetectedModelRow({
  modelName,
  enabled,
  canRemove,
  saving,
  onEnable,
  onRemove,
}: {
  modelName: string;
  enabled: boolean;
  canRemove: boolean;
  saving: boolean;
  onEnable: () => void;
  onRemove: () => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const showRemoveConfirm = confirmingRemove && canRemove;
  return (
    <div className="px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 truncate font-mono text-ui-meta text-ink">
          {modelName}
        </div>
        {enabled ? (
          canRemove ? (
            // Enable's mirror: rests as the green "added" badge, reveals
            // the remove action on hover / keyboard focus, and confirms
            // via the same inline strip as the "我的模型" row — one removal
            // grammar, two surfaces.
            <button
              type="button"
              aria-label={`${appCopy.common.remove} ${modelName}`}
              disabled={saving}
              onClick={() => setConfirmingRemove(true)}
              className={cn(
                "group/added inline-flex min-h-7 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent px-2.5 text-ui-meta leading-none",
                "bg-success/[var(--opacity-subtle)] text-success",
                "hover:bg-error/[var(--opacity-subtle)] hover:text-error",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20",
                "focus-visible:bg-error/[var(--opacity-subtle)] focus-visible:text-error",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              <span className="inline-flex items-center gap-1 group-hover/added:hidden group-focus-visible/added:hidden">
                <CheckCircle size={12} weight="fill" />
                {copy.enabled}
              </span>
              <span className="hidden items-center gap-1 group-hover/added:inline-flex group-focus-visible/added:inline-flex">
                <Trash size={12} weight="thin" />
                {appCopy.common.remove}
              </span>
            </button>
          ) : (
            // The default model can't be removed here — same invariant as
            // the "我的模型" row menu; pick a new default first.
            <span className="inline-flex min-h-7 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent bg-success/[var(--opacity-subtle)] px-2.5 text-ui-meta leading-none text-success">
              <CheckCircle size={12} weight="fill" />
              {copy.enabled}
            </span>
          )
        ) : (
          <button
            type="button"
            aria-label={`${copy.enable} ${modelName}`}
            disabled={saving}
            onClick={onEnable}
            className={cn(
              "inline-flex min-h-7 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent px-2.5 text-ui-meta leading-none text-ink-muted",
              "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
              "hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/20 active:translate-y-px",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:translate-y-0",
            )}
          >
            <Plus size={12} weight="bold" />
            {copy.enable}
          </button>
        )}
      </div>
      {showRemoveConfirm && (
        <div
          className={cn(
            "mt-1.5 flex items-center justify-end gap-2 rounded-sm border border-line/70",
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
              onRemove();
            }}
          >
            {copy.removeModel}
          </Button>
        </div>
      )}
    </div>
  );
}
