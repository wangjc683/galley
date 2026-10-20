import {
  CircleNotch,
  Eye,
  EyeSlash,
  ListMagnifyingGlass,
  PlugsConnected,
  Plus,
  SignOut,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { ChatGptPlanSignInControls } from "@/components/managed-models/ChatGptPlanSignIn";
import { ManagedModelProviderPicker } from "@/components/managed-models/ManagedModelProviderPicker";
import { ModelCombobox } from "@/components/managed-models/ModelCombobox";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  CHATGPT_PLAN_LOGIN_IDLE,
  type ChatGptPlanLoginState,
} from "@/lib/chatgpt-plan";
import { useCopy } from "@/lib/i18n";
import {
  apiBasePlaceholderForManagedModelProviderPreset,
  CUSTOM_ENDPOINT_PRESET_ID,
  getManagedModelProviderPreset,
  modelPlaceholderForManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import {
  providerConnectionLabel,
  providerPresetLabel,
} from "@/lib/managed-model-preset-copy";
import { cn } from "@/lib/utils";
import type { ManagedModelProtocol } from "@/types/managed-models";

import { ExternalTextLink } from "../external-link";
import {
  EditorBlockedHint,
  ErrorLine,
  InfoLine,
  InlineProbeStatus,
  ProbeErrorLine,
  SettingsInput,
} from "./ModelPrimitives";
import type {
  EditorBlockedState,
  ProbeAction,
  ProbeState,
  ProviderFormState,
} from "./types";
import { editorBlockedFlashClass } from "./use-provider-model-controller";

export function ProviderEditor({
  form,
  saving,
  canSave,
  canTest,
  canFetchModels,
  canCancel,
  presetPicker = false,
  providerHasSavedKey,
  isNoAuthProvider = false,
  canClearKey = false,
  onClearKey,
  probeState,
  modelOptions,
  editTestModel,
  blocked,
  chatGptPlanLogin = CHATGPT_PLAN_LOGIN_IDLE,
  onChange,
  onSelectProviderPreset,
  onTest,
  onFetchModels,
  onChatGptPlanSignIn,
  onChatGptPlanSignOut,
  onChatGptPlanCancel,
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
  /** Create form only: the card is chosen inside the form, with the
   * picker. Settings' zero-provider page, where this form is the one
   * next step (no 「添加」 there). Otherwise the card came from
   * 「添加」's menu and reads as text, as on the edit form. */
  presetPicker?: boolean;
  providerHasSavedKey: boolean;
  /** The saved provider record is a no-auth endpoint (authKind "none"). */
  isNoAuthProvider?: boolean;
  /** Editing a provider with a stored api_key secret — offer "清除密钥". */
  canClearKey?: boolean;
  onClearKey?: () => void;
  probeState: ProbeState;
  modelOptions: string[];
  /** Editing only: the saved model 「测试模型」 probes (the provider's
   * first added model). Absent = no test button on the edit form. */
  editTestModel?: string;
  /** Set when this form just refused to be replaced (unsaved input). */
  blocked?: EditorBlockedState;
  /** Sign in with ChatGPT, the ChatGPT card's sign-in (ticket 04). */
  chatGptPlanLogin?: ChatGptPlanLoginState;
  onChange: (patch: Partial<ProviderFormState>) => void;
  onSelectProviderPreset: (
    providerPresetId: ManagedModelProviderPresetId,
  ) => void;
  onTest: () => void;
  onFetchModels: () => void;
  onChatGptPlanSignIn: () => void;
  onChatGptPlanSignOut: () => void;
  onChatGptPlanCancel: () => void;
  onSave: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  const planCopy = appCopy.chatgptPlan;
  const isCreatingProvider = !form.id;
  const selectedPreset = form.providerPresetId
    ? getManagedModelProviderPreset(form.providerPresetId)
    : null;
  const providerSelected = Boolean(selectedPreset && form.protocol);
  const isChatGptProvider = form.authKind === "chatgpt_codex_oauth";
  // The Custom card leads with what it can't preset: the protocol and
  // the endpoint, then the (optional) key. Every other card keeps
  // key → URL.
  const isCustomEndpoint = form.providerPresetId === CUSTOM_ENDPOINT_PRESET_ID;
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const apiKeyRevealLabel = apiKeyVisible ? copy.hideApiKey : copy.showApiKey;
  const trimmedModel = form.model.trim();
  const secondaryProbeAction: ProbeAction =
    isCreatingProvider && trimmedModel === "" ? "model-list" : "model-test";
  const secondaryProbeLabel =
    secondaryProbeAction === "model-list"
      ? copy.fetchModelList
      : copy.testModel;
  const secondaryProbeLoading =
    probeState.kind === "loading" && probeState.action === secondaryProbeAction;
  // Creating: tests the model being added. Editing: tests the
  // provider's first saved model against the form's (unsaved) key and
  // endpoint, so a new key can be checked before it's written; a blank
  // key falls back to the saved one.
  const showSecondaryProbe = isCreatingProvider
    ? trimmedModel !== ""
    : !!editTestModel;
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
  // A create form without a card yet can only be given one by the
  // picker, whatever the caller asked for.
  const showPresetPicker =
    isCreatingProvider && (presetPicker || !selectedPreset);
  // How the provider connects (SIWC decision 15), from the form as it
  // stands: an official card pointed at a relay reads 「OpenAI 兼容」.
  // The Custom card's protocol is its segmented control right below.
  const connectionLabel =
    selectedPreset && form.protocol && !isCustomEndpoint
      ? providerConnectionLabel(copy, {
          authKind: form.authKind,
          protocol: form.protocol,
          apiBase: form.apiBase,
        })
      : null;
  // The card as read-only text: the edit form always (switching cards
  // would reset the endpoint while the provider's models keep the old
  // card's preset layer; only the Custom card's protocol stays
  // switchable), and the create form opened from 「添加」's menu — a
  // different card is 「添加」 again.
  const presetIdentity = selectedPreset && (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-ui-secondary font-medium text-ink">
        {providerPresetLabel(copy, selectedPreset)}
      </span>
      {connectionLabel && (
        <span className="shrink-0 text-ui-tertiary text-ink-muted">
          {connectionLabel}
        </span>
      )}
    </div>
  );
  const closeButton = canCancel && (
    <IconButton
      ariaLabel={copy.closeProviderEditor}
      size="sm"
      onClick={onCancel}
      className="shrink-0"
    >
      <X size={12} weight="thin" />
    </IconButton>
  );

  const blockedFlash = blocked?.flash ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (blockedFlash) {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [blockedFlash]);

  return (
    <div
      ref={rootRef}
      className={cn(
        // Same editing-surface grammar as ModelDraftEditor: brand left
        // rail + elevated bg, no shadow. One visual language for "you
        // are editing something inline" across the tab.
        "rounded-sm border border-line-strong/70 border-l-[3px] border-l-brand bg-elevated px-3 py-3",
        editorBlockedFlashClass(blockedFlash),
        className,
      )}
    >
      {!isCreatingProvider && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-ui-compact font-medium text-ink">
              {copy.editProvider}
            </div>
            {form.id && (isNoAuthProvider || providerHasSavedKey) && (
              <div className="mt-0.5 text-ui-meta text-ink-muted">
                {isNoAuthProvider ? copy.noAuthActive : copy.leaveKeyBlank}
              </div>
            )}
            {blocked?.hint && <EditorBlockedHint />}
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

      {isCreatingProvider && blocked?.hint && (
        <div className="-mt-1 mb-3">
          <EditorBlockedHint />
        </div>
      )}

      <div className="space-y-4">
        {showPresetPicker ? (
          <div className="flex items-center gap-2">
            <ManagedModelProviderPicker
              value={form.providerPresetId}
              badgeLabel={connectionLabel}
              onChange={onSelectProviderPreset}
              className="min-w-0 flex-1"
            />
            {closeButton}
          </div>
        ) : isCreatingProvider ? (
          // No title on the create form: the card line leads, the close
          // button where the picker's was.
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{presetIdentity}</div>
            {closeButton}
          </div>
        ) : (
          presetIdentity
        )}

        {providerSelected &&
          selectedPreset &&
          form.protocol &&
          isChatGptProvider && (
            // Sign in with ChatGPT, the ChatGPT card's only sign-in (SIWC
            // ticket 05 removed the Codex CLI ones).
            <div className="space-y-3 pb-1">
              <div>
                <div className="text-ui-meta font-medium text-ink-soft">
                  {planCopy.title}
                </div>
                <p className="m-0 mt-1 max-w-[620px] text-ui-secondary leading-5 text-ink-muted">
                  {planCopy.body}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <ChatGptPlanSignInControls
                  state={chatGptPlanLogin}
                  disabled={probeState.kind === "loading"}
                  onSignIn={onChatGptPlanSignIn}
                  onCancel={onChatGptPlanCancel}
                />
                {form.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={probeState.kind === "loading"}
                    onClick={onChatGptPlanSignOut}
                    leadingIcon={<SignOut size={12} weight="thin" />}
                  >
                    {copy.signOutChatGPT}
                  </Button>
                )}
                <InlineProbeStatus state={probeState} action="provider-test" />
              </div>
              {chatGptPlanLogin.phase === "error" && (
                <ErrorLine message={chatGptPlanLogin.message} />
              )}
              <ProbeErrorLine state={probeState} action="provider-test" />
            </div>
          )}

        {providerSelected && selectedPreset && form.protocol && !isChatGptProvider && (
          <>
            {isCustomEndpoint && (
              <>
                <SegmentedControl<ManagedModelProtocol>
                  size="sm"
                  ariaLabel={copy.customProtocolAria}
                  value={form.protocol}
                  onValueChange={(protocol) => onChange({ protocol })}
                  options={[
                    { value: "openai", label: copy.openaiCompatibleProtocol },
                    {
                      value: "anthropic",
                      label: copy.anthropicCompatibleProtocol,
                    },
                  ]}
                />
                <SettingsInput
                  label={copy.apiUrl}
                  value={form.apiBase}
                  placeholder={apiBasePlaceholderForManagedModelProviderPreset(
                    selectedPreset,
                    form.protocol,
                  )}
                  onChange={(apiBase) => onChange({ apiBase })}
                />
              </>
            )}
            <SettingsInput
              label={copy.apiKey}
              labelTrailing={
                <span className="inline-flex items-center gap-2.5">
                  {canClearKey && onClearKey && (
                    <button
                      type="button"
                      onClick={onClearKey}
                      className="rounded-sm text-ui-tertiary text-ink-muted hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    >
                      {copy.clearApiKey}
                    </button>
                  )}
                  {/* Only when the endpoint still points at the preset's
                      official apiBase — for a custom/proxy endpoint the
                      preset's key console is likely the wrong place. */}
                  {selectedPreset.apiKeyUrl &&
                    form.apiBase.trim() === selectedPreset.apiBase && (
                      <ExternalTextLink
                        href={selectedPreset.apiKeyUrl}
                        tone="muted"
                        className="text-ui-tertiary"
                      >
                        {copy.getApiKey}
                      </ExternalTextLink>
                    )}
                </span>
              }
              value={form.apiKey}
              onChange={(apiKey) => onChange({ apiKey })}
              type={apiKeyVisible ? "text" : "password"}
              placeholder={
                form.id
                  ? isNoAuthProvider
                    ? copy.noAuthEditPlaceholder
                    : copy.leaveExistingKey
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
            {/* Keyless endpoints live behind the Custom card (no shipped
                preset is one), so only it carries the "may stay blank"
                note; on a cloud card it just sat there until a key was
                pasted. */}
            {isCreatingProvider &&
              isCustomEndpoint &&
              form.apiKey.trim() === "" && (
                <InfoLine message={copy.noAuthKeyHint} />
              )}
            {!isCustomEndpoint && (
              <SettingsInput
                label={copy.apiUrl}
                value={form.apiBase}
                placeholder={apiBasePlaceholderForManagedModelProviderPreset(
                  selectedPreset,
                  form.protocol,
                )}
                onChange={(apiBase) => onChange({ apiBase })}
              />
            )}
            {isCreatingProvider && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[240px] flex-1">
                    <ModelCombobox
                      value={form.model}
                      options={modelOptions}
                      placeholder={modelPlaceholderForManagedModelProviderPreset(
                        selectedPreset,
                      )}
                      onChange={(model) => onChange({ model })}
                    >
                      {(field) => (
                        <SettingsInput label={copy.model} {...field} />
                      )}
                    </ModelCombobox>
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
                  ) : form.id ? undefined : (
                    // 「+」 only when the save adds a model.
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
