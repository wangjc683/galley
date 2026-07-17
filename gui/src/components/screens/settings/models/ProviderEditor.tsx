import {
  CircleNotch,
  CloudArrowDown,
  Eye,
  EyeSlash,
  ListMagnifyingGlass,
  ArrowSquareOut,
  PlugsConnected,
  Plus,
  SignIn,
  SignOut,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { CodexDeviceCodeCard } from "@/components/managed-models/CodexDeviceCodeCard";
import { ManagedModelProviderPicker } from "@/components/managed-models/ManagedModelProviderPicker";
import { Button, IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  getManagedModelProviderPreset,
  modelPlaceholderForManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import type { CodexDeviceLoginStart } from "@/lib/managed-models";
import { cn } from "@/lib/utils";

import {
  InfoLine,
  InlineProbeStatus,
  ModelSelectionList,
  ProbeErrorLine,
  SettingsInput,
} from "./ModelPrimitives";
import type { ProbeAction, ProbeState, ProviderFormState } from "./types";

export function ProviderEditor({
  form,
  saving,
  canSave,
  canTest,
  canFetchModels,
  canCancel,
  providerHasSavedKey,
  probeState,
  modelOptions,
  modelFilter,
  codexLoginStart,
  codexPolling = false,
  onChange,
  onSetModelFilter,
  onSelectProviderPreset,
  onTest,
  onFetchModels,
  onCodexLogin,
  onCodexOpenLoginPage,
  onCodexCompleteLogin,
  onCodexImport,
  onCodexLogout,
  onSave,
  onCancel,
  className,
}: {
  form: ProviderFormState;
  saving: boolean;
  canSave: boolean;
  canTest: boolean;
  canFetchModels: boolean;
  canCancel: boolean;
  providerHasSavedKey: boolean;
  probeState: ProbeState;
  modelOptions: string[];
  modelFilter: string;
  codexLoginStart?: CodexDeviceLoginStart | null;
  codexPolling?: boolean;
  onChange: (patch: Partial<ProviderFormState>) => void;
  onSetModelFilter: (value: string) => void;
  onSelectProviderPreset: (
    providerPresetId: ManagedModelProviderPresetId,
  ) => void;
  onTest: () => void;
  onFetchModels: () => void;
  onCodexLogin: () => void;
  onCodexOpenLoginPage: () => void;
  onCodexCompleteLogin: () => void;
  onCodexImport: () => void;
  onCodexLogout: () => void;
  onSave: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const copy = useCopy().settings.models;
  const isCreatingProvider = !form.id;
  const selectedPreset = form.providerPresetId
    ? getManagedModelProviderPreset(form.providerPresetId)
    : null;
  const providerSelected = Boolean(selectedPreset && form.protocol);
  const isCodexProvider = form.authKind === "chatgpt_codex_oauth";
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const apiKeyRevealLabel = apiKeyVisible ? copy.hideApiKey : copy.showApiKey;
  const trimmedModel = form.model.trim();
  const secondaryProbeAction: ProbeAction =
    trimmedModel === "" ? "model-list" : "model-test";
  const secondaryProbeLabel =
    secondaryProbeAction === "model-list"
      ? copy.fetchModelList
      : copy.testModel;
  const secondaryProbeLoading =
    probeState.kind === "loading" && probeState.action === secondaryProbeAction;
  const showSecondaryProbe = isCreatingProvider && trimmedModel !== "";
  const selectedModelOutsideFetchedList =
    isCreatingProvider &&
    modelOptions.length > 0 &&
    trimmedModel !== "" &&
    !modelOptions.includes(trimmedModel);
  const shouldShowManualModelHint =
    isCreatingProvider &&
    probeState.kind !== "idle" &&
    probeState.action === "model-list" &&
    (probeState.kind === "error" ||
      (probeState.kind === "success" && modelOptions.length === 0));

  return (
    <div
      className={cn(
        // Same editing-surface grammar as ModelDraftEditor: brand left
        // rail + elevated bg, no shadow. One visual language for "you
        // are editing something inline" across the tab.
        "rounded-sm border border-line-strong/70 border-l-[3px] border-l-brand bg-elevated px-3 py-3",
        className,
      )}
    >
      {!isCreatingProvider && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-ui-compact font-medium text-ink">
              {copy.editProvider}
            </div>
            {form.id && providerHasSavedKey && (
              <div className="mt-0.5 text-ui-meta text-ink-muted">
                {copy.leaveKeyBlank}
              </div>
            )}
          </div>
          {canCancel && (
            <IconButton
              ariaLabel={copy.closeProviderEditor}
              size="sm"
              onClick={onCancel}
            >
              <X size={12} weight="thin" />
            </IconButton>
          )}
        </div>
      )}

      <div className="space-y-4">
        {isCreatingProvider ? (
          <div className="flex items-center gap-2">
            <ManagedModelProviderPicker
              value={form.providerPresetId}
              protocol={form.protocol}
              onChange={onSelectProviderPreset}
              className="min-w-0 flex-1"
            />
            {canCancel && (
              <IconButton
                ariaLabel={copy.closeProviderEditor}
                size="sm"
                onClick={onCancel}
                className="shrink-0"
              >
                <X size={12} weight="thin" />
              </IconButton>
            )}
          </div>
        ) : (
          <ManagedModelProviderPicker
            value={form.providerPresetId}
            protocol={form.protocol}
            onChange={onSelectProviderPreset}
          />
        )}

        {providerSelected && selectedPreset && form.protocol && isCodexProvider && (
          <div className="space-y-4 pb-1">
            <div className="space-y-3">
              <div>
                <div className="text-ui-meta font-medium text-ink-soft">
                  {copy.chatgptCodexWebLogin}
                </div>
                <p className="m-0 mt-1 max-w-[620px] text-ui-secondary leading-5 text-ink-muted">
                  {copy.chatgptCodexReadyBody}
                </p>
              </div>
              {codexLoginStart && (
                <CodexDeviceCodeCard
                  userCode={codexLoginStart.userCode}
                  copy={copy}
                  className="mt-4"
                />
              )}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                {!codexLoginStart ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={probeState.kind === "loading"}
                    onClick={onCodexLogin}
                    leadingIcon={
                      probeState.kind === "loading" &&
                      probeState.action === "provider-test" ? (
                        <span className="spin">
                          <CircleNotch size={12} weight="thin" />
                        </span>
                      ) : (
                        <SignIn size={12} weight="bold" />
                      )
                    }
                  >
                    {copy.generateChatGPTLoginCode}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={probeState.kind === "loading"}
                      onClick={onCodexOpenLoginPage}
                      leadingIcon={<ArrowSquareOut size={12} weight="thin" />}
                    >
                      {copy.openChatGPTLoginPage}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={probeState.kind === "loading"}
                      onClick={onCodexCompleteLogin}
                      leadingIcon={<PlugsConnected size={12} weight="thin" />}
                    >
                      {copy.completeChatGPTLogin}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={probeState.kind === "loading"}
                      onClick={onCodexLogin}
                    >
                      {copy.regenerateChatGPTLoginCode}
                    </Button>
                  </>
                )}
                {form.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={probeState.kind === "loading"}
                    onClick={onCodexLogout}
                    leadingIcon={<SignOut size={12} weight="thin" />}
                  >
                    {copy.signOutChatGPT}
                  </Button>
                )}
                <InlineProbeStatus state={probeState} action="provider-test" />
              </div>
              {codexPolling && (
                <div className="flex items-center gap-1.5 text-ui-secondary text-ink-muted">
                  <span className="spin">
                    <CircleNotch size={12} weight="thin" />
                  </span>
                  {copy.codexWaitingForLogin}
                </div>
              )}
              <ProbeErrorLine state={probeState} action="provider-test" />
            </div>

            <div className="border-t border-line pt-3">
              <div className="text-ui-meta font-medium text-ink-soft">
                {copy.codexCliLoginTitle}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={probeState.kind === "loading"}
                onClick={onCodexImport}
                leadingIcon={<CloudArrowDown size={12} weight="thin" />}
              >
                {copy.importCodexCliLogin}
              </Button>
            </div>
          </div>
        )}

        {providerSelected && selectedPreset && form.protocol && !isCodexProvider && (
          <>
            <SettingsInput
              label={copy.apiKey}
              labelTrailing={
                selectedPreset.apiKeyUrl ? (
                  <ApiKeyPageLink
                    label={copy.getApiKey}
                    url={selectedPreset.apiKeyUrl}
                  />
                ) : undefined
              }
              value={form.apiKey}
              onChange={(apiKey) => onChange({ apiKey })}
              type={apiKeyVisible ? "text" : "password"}
              placeholder={
                form.id
                  ? copy.leaveExistingKey
                  : selectedPreset.apiKeyPlaceholder ?? "sk-..."
              }
              reserveTrailing
              trailing={
                form.apiKey.length > 0 ? (
                  <IconButton
                    ariaLabel={apiKeyRevealLabel}
                    onClick={() => setApiKeyVisible((visible) => !visible)}
                    size="xs"
                    className="size-6 text-ink-muted hover:text-ink-soft"
                  >
                    {apiKeyVisible ? (
                      <EyeSlash size={13} weight="thin" />
                    ) : (
                      <Eye size={13} weight="thin" />
                    )}
                  </IconButton>
                ) : null
              }
            />
            <SettingsInput
              label={copy.apiUrl}
              value={form.apiBase}
              onChange={(apiBase) => onChange({ apiBase })}
              placeholder={
                selectedPreset.apiBase ||
                (form.protocol === "openai"
                  ? "https://api.openai.com/v1"
                  : "https://api.anthropic.com")
              }
            />
            {isCreatingProvider && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[240px] flex-1">
                    <SettingsInput
                      label={copy.model}
                      value={form.model}
                      onChange={(model) => onChange({ model })}
                      placeholder={modelPlaceholderForManagedModelProviderPreset(
                        selectedPreset,
                      )}
                    />
                  </div>
                  <Button
                    variant="accent-secondary"
                    size="sm"
                    disabled={!canFetchModels}
                    onClick={onFetchModels}
                    leadingIcon={
                      probeState.kind === "loading" &&
                      probeState.action === "model-list" ? (
                        <span className="spin">
                          <CircleNotch size={12} weight="thin" />
                        </span>
                      ) : (
                        <ListMagnifyingGlass size={12} weight="thin" />
                      )
                    }
                  >
                    {copy.fetchList}
                  </Button>
                  <InlineProbeStatus state={probeState} action="model-list" />
                </div>
                <ProbeErrorLine state={probeState} action="model-list" />
                {shouldShowManualModelHint && (
                  <InfoLine message={copy.modelListManualFallback} />
                )}
                {modelOptions.length > 0 && (
                  <ModelSelectionList
                    title={copy.chooseDetectedModel}
                    value={form.model}
                    options={modelOptions}
                    filter={modelFilter}
                    onFilterChange={onSetModelFilter}
                    onChange={(model) => onChange({ model })}
                  />
                )}
                {selectedModelOutsideFetchedList && (
                  <InfoLine
                    message={copy.selectedModelOutsideList(trimmedModel)}
                  />
                )}
              </div>
            )}
            <div className="border-t border-line pt-3">
              <SettingsInput
                label={copy.providerName}
                value={form.displayName}
                onChange={(displayName) => onChange({ displayName })}
                placeholder={copy.providerNamePlaceholder}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {showSecondaryProbe && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canTest}
                    onClick={onTest}
                    leadingIcon={
                      secondaryProbeLoading ? (
                        <span className="spin">
                          <CircleNotch size={12} weight="thin" />
                        </span>
                      ) : secondaryProbeAction === "model-list" ? (
                        <ListMagnifyingGlass size={12} weight="thin" />
                      ) : (
                        <PlugsConnected size={12} weight="thin" />
                      )
                    }
                  >
                    {secondaryProbeLabel}
                  </Button>
                  <InlineProbeStatus
                    state={probeState}
                    action={secondaryProbeAction}
                  />
                </>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={!canSave}
                onClick={onSave}
                leadingIcon={
                  saving ? (
                    <span className="spin">
                      <CircleNotch size={12} weight="thin" />
                    </span>
                  ) : (
                    <Plus size={12} weight="bold" />
                  )
                }
              >
                {form.id ? copy.saveService : copy.saveAndEnableModel}
              </Button>
              {showSecondaryProbe && secondaryProbeAction === "model-test" && (
                <span className="text-ui-label leading-none text-ink-muted/60">
                  {copy.modelTestCostHint}
                </span>
              )}
            </div>
            {showSecondaryProbe && (
              <ProbeErrorLine
                state={probeState}
                action={secondaryProbeAction}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ApiKeyPageLink({ label, url }: { label: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void openUrl(url).catch((e: unknown) => {
          console.warn("[settings] open api key page failed.", e);
        });
      }}
      className="inline-flex items-center gap-1 rounded-sm text-ui-tertiary text-ink-muted hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      {label}
      <ArrowSquareOut size={10} weight="thin" />
    </button>
  );
}
