import {
  ArrowSquareOut,
  CaretRight,
  CheckCircle,
  CircleNotch,
  CloudArrowDown,
  Eye,
  EyeSlash,
  ListMagnifyingGlass,
  SignIn,
  WarningCircle,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactNode } from "react";

import { CodexDeviceCodeCard } from "@/components/managed-models/CodexDeviceCodeCard";
import { ManagedModelProviderCardGrid } from "@/components/managed-models/ManagedModelProviderCardGrid";
import { ManagedModelOptionPicker } from "@/components/managed-models/ManagedModelOptionPicker";
import { useProviderSetupController } from "@/components/managed-models/use-provider-setup-controller";
import { Button, IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  getManagedModelProviderPreset,
  modelPlaceholderForManagedModelProviderPreset,
} from "@/lib/managed-model-presets";
import {
  providerHostnameFallback,
  type ProbeAction,
  type ProbeState,
} from "@/lib/provider-setup";
import { cn } from "@/lib/utils";
import { useManagedModelsStore } from "@/stores/managed-models";

const AUTO_CONNECTION_TEST_DELAY_MS = 800;

interface StepModelConfigProps {
  onComplete: () => void;
  onAttachExisting: () => void;
  canContinueWithExisting?: boolean;
}

export function StepModelConfig({
  onComplete,
  onAttachExisting,
  canContinueWithExisting = false,
}: StepModelConfigProps) {
  const copy = useCopy();
  const modelCopy = copy.settings.models;
  const onboardingCopy = copy.onboarding;
  const loading = useManagedModelsStore((s) => s.loading);
  const providers = useManagedModelsStore((s) => s.providers);
  const models = useManagedModelsStore((s) => s.models);
  const saving = useManagedModelsStore((s) => s.saving);
  const saveProvider = useManagedModelsStore((s) => s.saveProvider);
  const saveModel = useManagedModelsStore((s) => s.saveModel);
  const loadModels = useManagedModelsStore((s) => s.load);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const {
    canCommit,
    canFetchProviderFormModels,
    codexLoginStart,
    codexPolling,
    connectionInputComplete,
    handleCodexCompleteLogin,
    handleCodexImport,
    handleCodexLogin,
    handleCodexOpenLoginPage,
    handleProviderFormFetchModels,
    handleProviderSave,
    isCodexProviderForm,
    providerFormModelOptions,
    providerFormProbeState,
    runConnectionTest,
    selectProviderPreset,
    setProviderDisplayName,
    updateProviderForm,
    visibleProviderForm,
  } = useProviderSetupController({
    loading,
    providers,
    models,
    saving,
    saveProvider,
    saveModel,
    loadManagedModels: loadModels,
    // The onboarding contract (docs/design/onboarding-and-cards.md
    // §Step 1): debounced auto connection test, Start CTA gated on a
    // test that passed for the exact current inputs, first model
    // always default, hostname fallback for a blank display name, and
    // a probe-status commit presentation (the screen exits via
    // onComplete, not a form reset).
    autoConnectionTest: true,
    autoProbeDelayMs: AUTO_CONNECTION_TEST_DELAY_MS,
    requireVerifiedConnectionToCommit: true,
    makeDefault: "always",
    displayNameFallback: providerHostnameFallback,
    trimCredentialsOnSave: true,
    postSaveForm: "success-status",
    onSaved: () => onComplete(),
    onCodexComplete: () => onComplete(),
  });

  const state = providerFormProbeState;
  const providerPresetId = visibleProviderForm?.providerPresetId ?? null;
  const protocol = visibleProviderForm?.protocol ?? null;
  const apiKey = visibleProviderForm?.apiKey ?? "";
  const apiBase = visibleProviderForm?.apiBase ?? "";
  const model = visibleProviderForm?.model ?? "";
  const providerDisplayNameValue = visibleProviderForm?.displayName ?? "";
  const modelOptions = providerFormModelOptions;
  const selectedPreset = providerPresetId
    ? getManagedModelProviderPreset(providerPresetId)
    : null;
  const isCodexProvider = isCodexProviderForm;
  // Only surface the key-console link while the endpoint still points
  // at the preset's official apiBase — for a custom/proxy endpoint the
  // preset's key console is likely the wrong place.
  const apiKeyUrl =
    selectedPreset?.apiKeyUrl && apiBase.trim() === selectedPreset.apiBase
      ? selectedPreset.apiKeyUrl
      : null;
  const providerSelected = Boolean(selectedPreset && protocol);
  const apiKeyRevealLabel = apiKeyVisible
    ? modelCopy.hideApiKey
    : modelCopy.showApiKey;
  const isBusy = state.kind === "loading";
  const canFetchModels = canFetchProviderFormModels;
  const canStart = canCommit;

  return (
    <div className="max-w-[580px]">
      <h1 className="m-0 font-serif text-[30px] font-medium leading-[1.1] tracking-[0.005em] text-ink [@media(max-height:719px)]:text-[26px]">
        Galley
      </h1>
      <p className="mb-7 mt-3 font-serif text-[16px] italic leading-[1.55] text-ink-soft">
        {onboardingCopy.modelWelcome}
      </p>

      <div className="space-y-4">
        <ManagedModelProviderCardGrid
          value={providerPresetId}
          onChange={selectProviderPreset}
        />

        {providerSelected && selectedPreset && protocol && isCodexProvider && (
          <div className="space-y-4 rounded-sm border border-line bg-elevated/80 px-3 py-3">
            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {modelCopy.chatgptCodexWebLogin}
                </div>
                <div className="mt-1 text-[12.5px] leading-5 text-ink-muted">
                  {modelCopy.chatgptCodexReadyBody}
                </div>
              </div>
              {codexLoginStart && (
                <CodexDeviceCodeCard
                  userCode={codexLoginStart.userCode}
                  copy={modelCopy}
                  className="py-2"
                />
              )}
              <div className="flex flex-wrap gap-2">
                {!codexLoginStart ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => void handleCodexLogin()}
                    leadingIcon={
                      isBusy && state.kind === "loading" ? (
                        <span className="spin">
                          <CircleNotch size={12} weight="thin" />
                        </span>
                      ) : (
                        <SignIn size={12} weight="bold" />
                      )
                    }
                  >
                    {modelCopy.generateChatGPTLoginCode}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleCodexOpenLoginPage()}
                      leadingIcon={<ArrowSquareOut size={12} weight="thin" />}
                    >
                      {modelCopy.openChatGPTLoginPage}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleCodexCompleteLogin()}
                      leadingIcon={<CheckCircle size={12} weight="thin" />}
                    >
                      {modelCopy.completeChatGPTLogin}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleCodexLogin()}
                    >
                      {modelCopy.regenerateChatGPTLoginCode}
                    </Button>
                  </>
                )}
              </div>
              {codexPolling && (
                <div className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                  <span className="spin">
                    <CircleNotch size={12} weight="thin" />
                  </span>
                  {modelCopy.codexWaitingForLogin}
                </div>
              )}
            </div>

            <div className="border-t border-line pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {modelCopy.codexCliLoginTitle}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={isBusy}
                onClick={() => void handleCodexImport()}
                leadingIcon={<CloudArrowDown size={12} weight="thin" />}
              >
                {modelCopy.importCodexCliLogin}
              </Button>
            </div>
          </div>
        )}

        {providerSelected && selectedPreset && protocol && !isCodexProvider && (
          <>
            <SetupInput
              label={modelCopy.apiKey}
              labelTrailing={
                apiKeyUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openUrl(apiKeyUrl).catch((e: unknown) => {
                        console.warn(
                          "[onboarding] open api key page failed.",
                          e,
                        );
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-sm text-[11px] text-ink-muted hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                  >
                    {modelCopy.getApiKey}
                    <ArrowSquareOut size={10} weight="thin" />
                  </button>
                ) : undefined
              }
              type={apiKeyVisible ? "text" : "password"}
              value={apiKey}
              onChange={(value) => updateProviderForm({ apiKey: value })}
              placeholder={selectedPreset.apiKeyPlaceholder ?? "sk-..."}
              reserveTrailing
              trailing={
                apiKey.length > 0 ? (
                  <IconButton
                    ariaLabel={apiKeyRevealLabel}
                    title={apiKeyRevealLabel}
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
            <SetupInput
              label={modelCopy.model}
              value={model}
              onChange={(value) => updateProviderForm({ model: value })}
              placeholder={modelPlaceholderForManagedModelProviderPreset(
                selectedPreset,
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="accent-secondary"
                size="sm"
                disabled={!canFetchModels}
                onClick={() => void handleProviderFormFetchModels()}
                leadingIcon={
                  state.kind === "loading" && state.action === "model-list" ? (
                    <span className="spin">
                      <CircleNotch size={12} weight="thin" />
                    </span>
                  ) : (
                    <ListMagnifyingGlass size={12} weight="thin" />
                  )
                }
              >
                {modelCopy.fetchModelList}
              </Button>
              <InlineSetupStatus state={state} action="model-list" />
            </div>
            <SetupErrorLine state={state} action="model-list" />

            {modelOptions.length > 0 && (
              <ManagedModelOptionPicker
                value={modelOptions.includes(model) ? model : ""}
                options={modelOptions}
                placeholder={modelCopy.chooseDetectedModel}
                onChange={(value) => updateProviderForm({ model: value })}
              />
            )}

            <div className="border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                aria-expanded={advancedOpen}
                className="flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <CaretRight
                  size={11}
                  weight="bold"
                  className={cn(
                    "transition-transform duration-(--motion-fast) ease-firm",
                    advancedOpen && "rotate-90",
                  )}
                />
                {onboardingCopy.advanced}
              </button>
              {advancedOpen && (
                <div className="mt-3 space-y-4">
                  <SetupInput
                    label={modelCopy.apiUrl}
                    value={apiBase}
                    onChange={(value) => updateProviderForm({ apiBase: value })}
                    placeholder={
                      selectedPreset.apiBase ||
                      (protocol === "openai"
                        ? "https://api.openai.com/v1"
                        : "https://api.anthropic.com")
                    }
                  />
                  <SetupInput
                    label={modelCopy.providerName}
                    value={providerDisplayNameValue}
                    onChange={setProviderDisplayName}
                    placeholder={modelCopy.providerNamePlaceholder}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-3">
        <div className="flex min-w-[180px] items-center">
          <button
            type="button"
            onClick={onAttachExisting}
            className="inline-flex items-center gap-1 rounded-sm text-[12px] text-ink-muted hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            {onboardingCopy.connectExistingButton}
            <ArrowSquareOut size={11} weight="thin" />
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {canContinueWithExisting && (
            <Button
              variant="secondary"
              size="lg"
              onClick={onComplete}
              leadingIcon={<CheckCircle size={14} weight="thin" />}
            >
              {onboardingCopy.continueWithCurrentModel}
            </Button>
          )}
          {!isCodexProvider && (
            <>
              <InlineSetupStatus
                state={state}
                action="model-test"
                loadingMessage={modelCopy.autoTestingConnection}
              />
              <Button
                variant="primary"
                size="lg"
                disabled={!canStart}
                onClick={() => void handleProviderSave()}
                leadingIcon={
                  state.kind === "loading" && state.action === "commit" ? (
                    <span className="spin">
                      <CircleNotch size={14} weight="thin" />
                    </span>
                  ) : (
                    <CheckCircle size={14} weight="bold" />
                  )
                }
              >
                {onboardingCopy.startUsingGalley}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <div className="w-full max-w-[420px] space-y-2">
          {!isCodexProvider && (
            <SetupErrorLine
              state={state}
              action="model-test"
              actionSlot={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!connectionInputComplete || isBusy}
                  onClick={() => void runConnectionTest({ force: true })}
                >
                  {modelCopy.retryConnectionTest}
                </Button>
              }
            />
          )}
          <SetupErrorLine state={state} action="commit" />
          <SetupErrorLine state={state} action="provider-test" />
        </div>
      </div>
    </div>
  );
}

function SetupInput({
  label,
  labelTrailing,
  value,
  onChange,
  placeholder,
  type = "text",
  trailing,
  reserveTrailing = false,
}: {
  label: string;
  labelTrailing?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  trailing?: ReactNode;
  reserveTrailing?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </label>
        {labelTrailing}
      </div>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(
            "w-full rounded-sm border border-line bg-elevated px-3 py-2 font-mono text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            (trailing || reserveTrailing) && "pr-10",
          )}
        />
        {trailing && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineSetupStatus({
  state,
  action,
  loadingMessage,
}: {
  state: ProbeState;
  action: ProbeAction;
  loadingMessage?: string;
}) {
  if (state.kind === "loading" && state.action === action && loadingMessage) {
    return (
      <span className="inline-flex min-h-7 max-w-[220px] shrink items-center gap-1 px-1 text-[11.5px] leading-none text-ink-muted">
        <span className="spin">
          <CircleNotch size={11} weight="thin" />
        </span>
        <span className="truncate">{loadingMessage}</span>
      </span>
    );
  }
  if (state.kind !== "success" || state.action !== action) return null;
  return (
    <span
      className="inline-flex min-h-7 max-w-[220px] shrink items-center gap-1 rounded-sm bg-success/[var(--opacity-soft)] px-2 py-1 text-[11.5px] leading-none text-success"
      title={state.message}
    >
      <CheckCircle size={11} weight="fill" className="shrink-0" />
      <span className="truncate">{state.message}</span>
    </span>
  );
}

function SetupErrorLine({
  state,
  action,
  actionSlot,
}: {
  state: ProbeState;
  action: ProbeAction;
  actionSlot?: ReactNode;
}) {
  if (state.kind !== "error" || state.action !== action) return null;
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <StatusLine tone="error" message={state.message} />
      </div>
      {actionSlot}
    </div>
  );
}

function StatusLine({
  tone,
  message,
}: {
  tone: "success" | "error";
  message: string;
}) {
  const success = tone === "success";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[12.5px]",
        "select-text",
        success
          ? "border-success/20 bg-success/[var(--opacity-subtle)] text-success"
          : "border-error/20 bg-error/[var(--opacity-subtle)] text-error",
      )}
    >
      {success ? (
        <CheckCircle size={12} weight="fill" />
      ) : (
        <WarningCircle size={12} weight="fill" />
      )}
      {message}
    </div>
  );
}
