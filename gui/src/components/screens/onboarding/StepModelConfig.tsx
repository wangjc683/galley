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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CodexDeviceCodeCard } from "@/components/managed-models/CodexDeviceCodeCard";
import { ManagedModelProviderCardGrid } from "@/components/managed-models/ManagedModelProviderCardGrid";
import { ManagedModelOptionPicker } from "@/components/managed-models/ManagedModelOptionPicker";
import { Button, IconButton } from "@/components/ui/button";
import {
  completeChatGptCodexLogin,
  importChatGptCodexCliLogin,
  listManagedModelOptions,
  managedModelProbeErrorMessage,
  startChatGptCodexLogin,
  testManagedModelConnectionWithLatency,
  type CodexDeviceLoginStart,
} from "@/lib/managed-models";
import { useCopy } from "@/lib/i18n";
import {
  getManagedModelProviderPreset,
  managedModelProviderPresetDraft,
  modelPlaceholderForManagedModelProviderPreset,
  recommendedModelForManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import { cn } from "@/lib/utils";
import { useManagedModelsStore } from "@/stores/managed-models";
import type { ManagedModelProtocol } from "@/types/managed-models";

type SetupAction = "list" | "test" | "start";

type SetupState =
  | { kind: "idle" }
  | { kind: "loading"; action: SetupAction }
  | { kind: "success"; action: SetupAction; message: string }
  | { kind: "error"; action: SetupAction; message: string };

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
  const saveProvider = useManagedModelsStore((s) => s.saveProvider);
  const saveModel = useManagedModelsStore((s) => s.saveModel);
  const loadModels = useManagedModelsStore((s) => s.load);
  const [providerPresetId, setProviderPresetId] =
    useState<ManagedModelProviderPresetId | null>(null);
  const [protocol, setProtocol] = useState<ManagedModelProtocol | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [model, setModel] = useState("");
  const [providerDisplayNameValue, setProviderDisplayNameValue] = useState("");
  const [advancedOptions, setAdvancedOptions] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [state, setState] = useState<SetupState>({ kind: "idle" });
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [codexLoginStart, setCodexLoginStart] =
    useState<CodexDeviceLoginStart | null>(null);
  const [codexPolling, setCodexPolling] = useState(false);
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<string | null>(
    null,
  );
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(
    null,
  );
  const [autoFetchedFingerprint, setAutoFetchedFingerprint] = useState<
    string | null
  >(null);
  const connectionTestRequestRef = useRef(0);
  const connectionFingerprintRef = useRef("");
  const listFingerprintRef = useRef("");
  const modelRef = useRef("");
  const selectedPreset = providerPresetId
    ? getManagedModelProviderPreset(providerPresetId)
    : null;
  const isCodexProvider =
    selectedPreset?.authKind === "chatgpt_codex_oauth";
  const apiKeyUrl = selectedPreset?.apiKeyUrl ?? null;
  const providerSelected = Boolean(selectedPreset && protocol);
  const apiKeyRevealLabel = apiKeyVisible
    ? modelCopy.hideApiKey
    : modelCopy.showApiKey;
  const connectionFingerprint = useMemo(
    () =>
      JSON.stringify({
        providerPresetId,
        protocol,
        apiKey: apiKey.trim(),
        apiBase: apiBase.trim(),
        model: model.trim(),
        authKind: selectedPreset?.authKind ?? "api_key",
      }),
    [apiBase, apiKey, model, protocol, providerPresetId, selectedPreset],
  );
  // Model-independent fingerprint for the silent model-list auto-fetch:
  // the list only depends on credentials + endpoint, so typing a model
  // name must not re-trigger it.
  const listFingerprint = useMemo(
    () =>
      JSON.stringify({
        providerPresetId,
        protocol,
        apiKey: apiKey.trim(),
        apiBase: apiBase.trim(),
      }),
    [apiBase, apiKey, protocol, providerPresetId],
  );

  useEffect(() => {
    connectionFingerprintRef.current = connectionFingerprint;
  }, [connectionFingerprint]);
  useEffect(() => {
    listFingerprintRef.current = listFingerprint;
  }, [listFingerprint]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const connectionInputComplete =
    providerPresetId !== null &&
    protocol !== null &&
    (isCodexProvider || apiKey.trim() !== "") &&
    apiBase.trim() !== "" &&
    model.trim() !== "";
  const isBusy = state.kind === "loading";
  const canFetchModels =
    protocol !== null &&
    !isCodexProvider &&
    apiKey.trim() !== "" &&
    apiBase.trim() !== "" &&
    !isBusy;
  const canStart =
    connectionInputComplete &&
    verifiedFingerprint === connectionFingerprint &&
    !isBusy;

  const probeInput = useCallback(
    () =>
      protocol
        ? {
            protocol,
            authKind: selectedPreset?.authKind,
            apiKey: apiKey.trim(),
            apiBase: apiBase.trim(),
            model: model.trim(),
            advancedOptions,
          }
        : null,
    [advancedOptions, apiBase, apiKey, model, protocol, selectedPreset],
  );

  const resetConnectionTest = () => {
    connectionTestRequestRef.current += 1;
    setVerifiedFingerprint(null);
    setTestedFingerprint(null);
    setState({ kind: "idle" });
    setCodexLoginStart(null);
  };

  const handleSelectProviderPreset = (
    nextProviderPresetId: ManagedModelProviderPresetId,
  ) => {
    const draft = managedModelProviderPresetDraft(nextProviderPresetId);
    setProviderPresetId(draft.providerPresetId);
    setProtocol(draft.protocol);
    setApiBase(draft.apiBase);
    setModel(draft.model);
    setProviderDisplayNameValue(draft.displayName);
    setAdvancedOptions(draft.advancedOptions);
    setCodexLoginStart(null);
    setModelOptions([]);
    resetConnectionTest();
  };

  const handleFetchModels = async () => {
    const input = probeInput();
    if (!canFetchModels || !input) return;
    setState({ kind: "loading", action: "list" });
    try {
      const result = await listManagedModelOptions(input);
      setModelOptions(result.models);
      setState({
        kind: "success",
        action: "list",
        message:
          result.models.length > 0
            ? modelCopy.foundModels(result.models.length)
            : modelCopy.connectedNoModels,
      });
    } catch (e) {
      setState({
        kind: "error",
        action: "list",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const runConnectionTest = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const input = probeInput();
      if (!connectionInputComplete || !input) return;

      const fingerprint = connectionFingerprint;
      if (!force && testedFingerprint === fingerprint) return;

      const requestId = connectionTestRequestRef.current + 1;
      connectionTestRequestRef.current = requestId;
      setVerifiedFingerprint(null);
      setTestedFingerprint(fingerprint);
      setState({ kind: "loading", action: "test" });
      try {
        const result = await testManagedModelConnectionWithLatency(input);
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setVerifiedFingerprint(fingerprint);
        setState({
          kind: "success",
          action: "test",
          message: connectionSuccessMessage(result, modelCopy),
        });
      } catch (e) {
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setState({
          kind: "error",
          action: "test",
          message: managedModelProbeErrorMessage(e, modelCopy),
        });
      }
    },
    [
      connectionFingerprint,
      connectionInputComplete,
      modelCopy,
      probeInput,
      testedFingerprint,
    ],
  );

  useEffect(() => {
    if (
      !connectionInputComplete ||
      isBusy ||
      testedFingerprint === connectionFingerprint
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void runConnectionTest();
    }, AUTO_CONNECTION_TEST_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    connectionFingerprint,
    connectionInputComplete,
    isBusy,
    runConnectionTest,
    testedFingerprint,
  ]);

  // Silent model-list auto-fetch: as soon as key + endpoint are usable,
  // pull the provider's model list in the background so the user can
  // pick instead of type. Success populates the picker (and fills the
  // model field when it's still empty); failure degrades silently to
  // manual input — the explicit fetch button stays as the loud path.
  useEffect(() => {
    if (!canFetchModels || autoFetchedFingerprint === listFingerprint) {
      return;
    }

    const fingerprint = listFingerprint;
    const timer = setTimeout(() => {
      setAutoFetchedFingerprint(fingerprint);
      const input = probeInput();
      if (!input) return;
      void listManagedModelOptions(input)
        .then((result) => {
          if (fingerprint !== listFingerprintRef.current) return;
          setModelOptions(result.models);
          if (modelRef.current.trim() !== "" || result.models.length === 0) {
            return;
          }
          const recommended = selectedPreset
            ? recommendedModelForManagedModelProviderPreset(selectedPreset)
            : "";
          const autoPick = result.models.includes(recommended)
            ? recommended
            : result.models.length === 1
              ? result.models[0]
              : "";
          if (autoPick) {
            setModel(autoPick);
            resetConnectionTest();
          }
        })
        .catch((e: unknown) => {
          console.warn("[onboarding] model list auto-fetch failed.", e);
        });
    }, AUTO_CONNECTION_TEST_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetchedFingerprint, canFetchModels, listFingerprint, selectedPreset]);

  const handleStart = async () => {
    if (!canStart || !protocol) return;
    setState({ kind: "loading", action: "start" });
    try {
      const provider = await saveProvider({
        protocol,
        authKind: selectedPreset?.authKind ?? "api_key",
        apiKey: apiKey.trim(),
        apiBase: apiBase.trim(),
        displayName:
          providerDisplayNameValue.trim() ||
          providerDisplayName(apiBase.trim()),
      });
      await saveModel({
        providerId: provider.id,
        model: model.trim(),
        advancedOptions,
        makeDefault: true,
      });
      setState({
        kind: "success",
        action: "start",
        message: modelCopy.setupComplete,
      });
      onComplete();
    } catch (e) {
      setState({
        kind: "error",
        action: "start",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleCodexLogin = async () => {
    if (!isCodexProvider) return;
    setState({ kind: "loading", action: "start" });
    try {
      const start = await startChatGptCodexLogin();
      setCodexLoginStart(start);
      setState({
        kind: "success",
        action: "start",
        message: modelCopy.chatgptCodexCodeReady,
      });
    } catch (e) {
      setState({
        kind: "error",
        action: "start",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  const handleCodexCompleteLogin = async () => {
    if (!codexLoginStart || codexPolling) return;
    setCodexPolling(true);
    setState({ kind: "loading", action: "start" });
    try {
      await completeChatGptCodexLogin({
        deviceAuthId: codexLoginStart.deviceAuthId,
        userCode: codexLoginStart.userCode,
        intervalSeconds: codexLoginStart.intervalSeconds,
      });
      await loadModels();
      onComplete();
    } catch (e) {
      setState({
        kind: "error",
        action: "start",
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
      setState({
        kind: "error",
        action: "start",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
      return;
    }
    // Start polling right away — the standard device-code flow. The
    // user finishes sign-in in the browser and Galley continues on its
    // own; the manual "complete sign-in" button stays as the retry
    // path after a timeout or error.
    void handleCodexCompleteLogin();
  };

  const handleCodexImport = async () => {
    if (!isCodexProvider) return;
    setCodexLoginStart(null);
    setState({ kind: "loading", action: "start" });
    try {
      await importChatGptCodexCliLogin();
      await loadModels();
      onComplete();
    } catch (e) {
      setState({
        kind: "error",
        action: "start",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

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
          onChange={handleSelectProviderPreset}
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
              onChange={(value) => {
                setApiKey(value);
                resetConnectionTest();
              }}
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
              onChange={(value) => {
                setModel(value);
                resetConnectionTest();
              }}
              placeholder={modelPlaceholderForManagedModelProviderPreset(
                selectedPreset,
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="accent-secondary"
                size="sm"
                disabled={!canFetchModels}
                onClick={() => void handleFetchModels()}
                leadingIcon={
                  state.kind === "loading" && state.action === "list" ? (
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
              <InlineSetupStatus state={state} action="list" />
            </div>
            <SetupErrorLine state={state} action="list" />

            {modelOptions.length > 0 && (
              <ManagedModelOptionPicker
                value={modelOptions.includes(model) ? model : ""}
                options={modelOptions}
                placeholder={modelCopy.chooseDetectedModel}
                onChange={(value) => {
                  setModel(value);
                  resetConnectionTest();
                }}
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
                    onChange={(value) => {
                      setApiBase(value);
                      resetConnectionTest();
                    }}
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
                    onChange={setProviderDisplayNameValue}
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
                action="test"
                loadingMessage={modelCopy.autoTestingConnection}
              />
              <Button
                variant="primary"
                size="lg"
                disabled={!canStart}
                onClick={() => void handleStart()}
                leadingIcon={
                  state.kind === "loading" && state.action === "start" ? (
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
              action="test"
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
          <SetupErrorLine state={state} action="start" />
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
  state: SetupState;
  action: SetupAction;
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
  state: SetupState;
  action: SetupAction;
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

function connectionSuccessMessage(
  result: { latencyMs: number; modelFound?: boolean | null },
  copy: ReturnType<typeof useCopy>["settings"]["models"],
): string {
  const message =
    result.modelFound === true
      ? copy.modelUsable
      : copy.connectionUsableCanSave;
  return copy.connectionLatency(message, result.latencyMs);
}

function providerDisplayName(apiBase: string): string {
  try {
    return new URL(apiBase).hostname;
  } catch {
    return apiBase.trim();
  }
}
