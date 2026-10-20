import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  CHATGPT_PLAN_LOGIN_IDLE,
  chatGptPlanLoginFailure,
  completeChatGptPlanLoginOnce,
  finishChatGptPlanSignIn,
  type ChatGptPlanLoginState,
} from "@/lib/chatgpt-plan";
import {
  cancelChatGptPlanLogin,
  getChatGptPlanStatus,
  listManagedModelOptions,
  logoutChatGptPlan,
  managedModelProbeErrorMessage,
  modelListProbeFailureState,
  startChatGptPlanLogin,
  testManagedModelConnectionWithLatency,
  type ChatGptPlanLoginStart,
} from "@/lib/managed-models";
import { useCopy } from "@/lib/i18n";
import {
  getManagedModelProviderPreset,
  recommendedModelForManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import {
  canCommitProviderSetup,
  connectionSuccessMessage,
  effectiveProviderAuthKind,
  formToProbeInput,
  isProviderFormDirty,
  newProviderForm,
  planAutoPick,
  providerConnectionFingerprint,
  providerFormFromPreset,
  providerFormFromRecord,
  providerFormModelTestInput,
  providerListFingerprint,
  runProviderCommit,
  shouldAutoOpenNewProviderForm,
  type ProbeAction,
  type ProbeState,
  type ProviderFormState,
} from "@/lib/provider-setup";
import { useChatGptPlanStore } from "@/stores/chatgpt-plan";
import type { ManagedModelsStore } from "@/stores/managed-models";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

/**
 * Shared provider-config form controller for the two managed-model
 * surfaces. All option defaults reproduce the Settings → 模型 behavior
 * exactly; onboarding turns on the extras it historically had on top:
 * the debounced auto connection test with verified-fingerprint gating
 * of its Start CTA, the auto-pick-resets-test coupling, the hostname
 * display-name fallback, and a probe-status (rather than form-reset)
 * commit presentation. The views stay separate — card grid + Advanced
 * collapse in onboarding vs popover + inline fields in settings (an
 * intentional divergence, see devlog 2026-07-17).
 */
export function useProviderSetupController({
  loading,
  loadFailed = false,
  providers,
  models,
  defaults,
  saving,
  saveProvider,
  saveModel,
  loadManagedModels,
  autoConnectionTest = false,
  autoProbeDelayMs = 800,
  requireVerifiedConnectionToCommit = false,
  makeDefault = "whenEmpty",
  displayNameFallback,
  trimCredentialsOnSave = false,
  postSaveForm = "reset",
  onSaved,
  onChatGptSignedIn,
  expandProvider,
  rememberProviderModelOptions,
}: {
  loading: boolean;
  /** The store's last load failed (Settings): an empty provider list
   * then says nothing about what is configured, so it must not open
   * the create form on its own. Off = the historical "empty list after
   * loading → create form" (onboarding always wants the form). */
  loadFailed?: boolean;
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  /** The global defaults layer, for the probes' effective options.
   * `{}` before the store has loaded. */
  defaults: Record<string, unknown>;
  saving: boolean;
  saveProvider: ManagedModelsStore["saveProvider"];
  saveModel: ManagedModelsStore["saveModel"];
  loadManagedModels: ManagedModelsStore["load"];
  /** Debounced auto connection test + verified-fingerprint tracking
   * (onboarding). Off = manual test button only (settings). */
  autoConnectionTest?: boolean;
  /** Debounce for the auto test AND the model-list auto-fetch. */
  autoProbeDelayMs?: number;
  /** Gate `canCommit` on a connection test that passed for the current
   * fingerprint (onboarding Start CTA). */
  requireVerifiedConnectionToCommit?: boolean;
  /** First-model default strategy on create. */
  makeDefault?: "always" | "whenEmpty";
  /** Fallback for a blank provider display name at save time. */
  displayNameFallback?: (apiBase: string) => string;
  /** Trim apiKey / apiBase at save time (onboarding save shape). */
  trimCredentialsOnSave?: boolean;
  /** After a successful commit: reset the form (settings) or show a
   * success probe status and keep the form (onboarding, which leaves
   * the screen via `onSaved` anyway). Also selects whether commit
   * errors surface as probe status ("success-status") or stay silent
   * here and keep the form ("reset") — the store rethrows, and the
   * caller's wrapped store actions report it (settings: error toast). */
  postSaveForm?: "reset" | "success-status";
  onSaved?: (ctx: { providerId: string; isNewProvider: boolean }) => void;
  /** Post-success strategy for Sign in with ChatGPT. `isNewProvider`
   * is false when it took over the ChatGPT provider already there. */
  onChatGptSignedIn?: (
    providerId: string,
    ctx: { isNewProvider: boolean },
  ) => void;
  /** Settings-only: expand a provider card when editing starts. */
  expandProvider?: (id: string) => void;
  /** Settings-only: park fetched model options on the created provider. */
  rememberProviderModelOptions?: (providerId: string, options: string[]) => void;
}) {
  const copy = useCopy();
  const modelCopy = copy.settings.models;
  const planCopy = copy.chatgptPlan;
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(
    null,
  );
  const [providerFormProbeState, setProviderFormProbeState] =
    useState<ProbeState>({ kind: "idle" });
  const [providerFormModelOptions, setProviderFormModelOptions] = useState<
    string[]
  >([]);
  // Sign in with ChatGPT (.scratch/chatgpt-siwc ticket 04): one sign-in
  // at a time for the page. The attempt counter retires a sign-in the
  // user cancelled or walked away from while a call was still out; the
  // login id is what Core cancels.
  const [chatGptPlanLogin, setChatGptPlanLogin] =
    useState<ChatGptPlanLoginState>(CHATGPT_PLAN_LOGIN_IDLE);
  const chatGptPlanAttemptRef = useRef(0);
  const chatGptPlanLoginIdRef = useRef<string | null>(null);
  // No-auth guardrails: a blank key resolves to a no-auth provider,
  // which is confirmed once per save instead of blocking the button;
  // clearing a saved key (→ no-auth) gets the same explicit confirm.
  const [noAuthConfirmOpen, setNoAuthConfirmOpen] = useState(false);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] = useState(false);
  // Connection-test bookkeeping (active only with autoConnectionTest):
  // a passing test is pinned to the fingerprint it ran against, and a
  // request id guards against a stale response landing after the user
  // edited a field mid-flight.
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<
    string | null
  >(null);
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(
    null,
  );
  const connectionTestRequestRef = useRef(0);
  const connectionFingerprintRef = useRef("");

  const visibleProviderForm =
    providerForm ??
    (shouldAutoOpenNewProviderForm({
      loading,
      loadFailed,
      providerCount: providers.length,
    })
      ? newProviderForm()
      : null);
  const editingProvider = visibleProviderForm?.id
    ? providers.find((item) => item.id === visibleProviderForm.id)
    : undefined;
  const providerHasSavedKey =
    !!editingProvider && editingProvider.credentialStatus !== "missing";
  // Settings-only consumer (the add / edit / close guards); the
  // untouched auto-opened form is `providerForm === null`, i.e. clean.
  const providerFormDirty = isProviderFormDirty(providerForm, editingProvider);
  const isCreatingProvider = !!visibleProviderForm && !visibleProviderForm.id;
  const providerFormIsInlineEdit = !!visibleProviderForm?.id;
  const isChatGptProviderForm =
    visibleProviderForm?.authKind === "chatgpt_codex_oauth";
  const providerFormEffectiveAuthKind = visibleProviderForm
    ? effectiveProviderAuthKind(visibleProviderForm, providerHasSavedKey)
    : "api_key";
  const canSaveProvider = canCommitProviderSetup({
    form: visibleProviderForm,
    saving,
    probeLoading: providerFormProbeState.kind === "loading",
    providerHasSavedKey,
    isCreating: isCreatingProvider,
    requireVerifiedConnection: false,
    verifiedFingerprint: null,
    currentFingerprint: "",
  });
  // A blank key no longer gates the probes: it resolves to a no-auth
  // probe (local endpoints answer, cloud endpoints report their 401),
  // which beats a silently dead button in both cases.
  const canTestProvider =
    !!visibleProviderForm &&
    visibleProviderForm.protocol !== null &&
    visibleProviderForm.apiBase.trim() !== "" &&
    providerFormProbeState.kind !== "loading";
  const canFetchProviderFormModels =
    !!visibleProviderForm &&
    !isChatGptProviderForm &&
    visibleProviderForm.protocol !== null &&
    !visibleProviderForm.id &&
    visibleProviderForm.apiBase.trim() !== "" &&
    providerFormProbeState.kind !== "loading";

  const connectionFingerprint = visibleProviderForm
    ? providerConnectionFingerprint(visibleProviderForm)
    : "";
  const connectionVerified =
    verifiedFingerprint !== null &&
    verifiedFingerprint === connectionFingerprint;
  const connectionInputComplete =
    !!visibleProviderForm &&
    visibleProviderForm.providerPresetId !== null &&
    visibleProviderForm.protocol !== null &&
    visibleProviderForm.apiBase.trim() !== "" &&
    visibleProviderForm.model.trim() !== "";
  const canCommit = requireVerifiedConnectionToCommit
    ? canCommitProviderSetup({
        form: visibleProviderForm,
        saving,
        probeLoading: providerFormProbeState.kind === "loading",
        providerHasSavedKey,
        isCreating: isCreatingProvider,
        requireVerifiedConnection: true,
        verifiedFingerprint,
        currentFingerprint: connectionFingerprint,
      })
    : canSaveProvider;

  useEffect(() => {
    connectionFingerprintRef.current = connectionFingerprint;
  }, [connectionFingerprint]);

  // Invalidate the connection test: any in-flight response becomes
  // stale (request id bump) and the verified pin is dropped. No-op
  // cost when autoConnectionTest is off (the states just stay null).
  const resetConnectionTest = useCallback(() => {
    connectionTestRequestRef.current += 1;
    setVerifiedFingerprint(null);
    setTestedFingerprint(null);
  }, []);

  const runConnectionTest = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const form = visibleProviderForm;
      const input = form ? formToProbeInput(form, defaults) : null;
      if (!connectionInputComplete || !input) return;

      const fingerprint = connectionFingerprint;
      if (!force && testedFingerprint === fingerprint) return;

      const requestId = connectionTestRequestRef.current + 1;
      connectionTestRequestRef.current = requestId;
      setVerifiedFingerprint(null);
      setTestedFingerprint(fingerprint);
      setProviderFormProbeState({ kind: "loading", action: "model-test" });
      try {
        const result = await testManagedModelConnectionWithLatency(input);
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setVerifiedFingerprint(fingerprint);
        setProviderFormProbeState({
          kind: "success",
          action: "model-test",
          message: connectionSuccessMessage(result, "setup-model", modelCopy),
        });
      } catch (e) {
        if (
          requestId !== connectionTestRequestRef.current ||
          fingerprint !== connectionFingerprintRef.current
        ) {
          return;
        }
        setProviderFormProbeState({
          kind: "error",
          action: "model-test",
          message: managedModelProbeErrorMessage(e, modelCopy),
        });
      }
    },
    [
      connectionFingerprint,
      connectionInputComplete,
      defaults,
      modelCopy,
      testedFingerprint,
      visibleProviderForm,
    ],
  );

  // Debounced auto connection test (onboarding): once the form is
  // complete, verify the exact fingerprint after a quiet gap. Edits
  // clear testedFingerprint (via updateProviderForm), re-arming this.
  useEffect(() => {
    if (
      !autoConnectionTest ||
      !connectionInputComplete ||
      providerFormProbeState.kind === "loading" ||
      testedFingerprint === connectionFingerprint
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void runConnectionTest();
    }, autoProbeDelayMs);

    return () => clearTimeout(timer);
  }, [
    autoConnectionTest,
    autoProbeDelayMs,
    connectionFingerprint,
    connectionInputComplete,
    providerFormProbeState.kind,
    runConnectionTest,
    testedFingerprint,
  ]);

  // Model-list auto-fetch for the provider-creation flow: once key +
  // endpoint are usable, pull the model list after a quiet gap and
  // pre-select the preset's recommended model when the field is still
  // empty. The fetch announces itself through the model-list probe
  // state (button spinner → "找到 N 个模型") so the candidates don't
  // materialise out of nowhere; failure still degrades silently (back
  // to idle) — the explicit fetch button stays the loud error path.
  const autoFetchFingerprint =
    visibleProviderForm && isCreatingProvider && !isChatGptProviderForm
      ? providerListFingerprint(visibleProviderForm)
      : null;
  const visibleProviderFormRef = useRef(visibleProviderForm);
  const autoFetchFingerprintRef = useRef<string | null>(null);
  const autoFetchAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    visibleProviderFormRef.current = visibleProviderForm;
    autoFetchFingerprintRef.current = autoFetchFingerprint;
  });

  useEffect(() => {
    if (
      !autoFetchFingerprint ||
      !canFetchProviderFormModels ||
      autoFetchAttemptedRef.current === autoFetchFingerprint
    ) {
      return;
    }

    const fingerprint = autoFetchFingerprint;
    const timer = setTimeout(() => {
      const form = visibleProviderFormRef.current;
      const protocol = form?.protocol;
      if (!form || !protocol) return;
      autoFetchAttemptedRef.current = fingerprint;
      setProviderFormProbeState({ kind: "loading", action: "model-list" });
      void listManagedModelOptions({
        protocol,
        // Create-only path: blank key resolves to a no-auth fetch.
        authKind: effectiveProviderAuthKind(form, false),
        apiKey: form.apiKey,
        apiBase: form.apiBase,
      })
        .then((result) => {
          if (autoFetchFingerprintRef.current !== fingerprint) return;
          setProviderFormModelOptions(result.models);
          setProviderFormProbeState({
            kind: "success",
            action: "model-list",
            message: listModelsMessage(result, modelCopy),
          });
          const current = visibleProviderFormRef.current;
          if (!current) return;
          const preset = current.providerPresetId
            ? getManagedModelProviderPreset(current.providerPresetId)
            : null;
          const recommended = preset
            ? recommendedModelForManagedModelProviderPreset(preset)
            : "";
          const pick = planAutoPick({
            currentModel: current.model,
            models: result.models,
            recommended,
          });
          if (!pick) return;
          setProviderForm((existing) =>
            existing && existing.model.trim() === ""
              ? { ...existing, model: pick }
              : existing,
          );
          // The auto-picked model hasn't been through a connection
          // test — re-arm the auto test so the Start gate stays honest.
          if (autoConnectionTest) resetConnectionTest();
        })
        .catch((e: unknown) => {
          console.warn("[provider-setup] model list auto-fetch failed.", e);
          if (autoFetchFingerprintRef.current !== fingerprint) return;
          setProviderFormProbeState((current) =>
            current.kind === "loading" && current.action === "model-list"
              ? { kind: "idle" }
              : current,
          );
        });
    }, autoProbeDelayMs);

    return () => clearTimeout(timer);
  }, [
    autoConnectionTest,
    autoFetchFingerprint,
    autoProbeDelayMs,
    canFetchProviderFormModels,
    modelCopy,
    resetConnectionTest,
  ]);

  /** Retires the pending Sign in with ChatGPT and closes Core's
   * listener for it. No state: safe from an unmount. */
  const dropChatGptPlanLogin = () => {
    chatGptPlanAttemptRef.current += 1;
    const loginId = chatGptPlanLoginIdRef.current;
    chatGptPlanLoginIdRef.current = null;
    if (loginId) {
      void cancelChatGptPlanLogin(loginId).catch((e: unknown) => {
        console.warn("[provider-setup] cancel ChatGPT sign-in failed.", e);
      });
    }
  };

  // Leaving the surface while the browser is still out (closing
  // Settings, onboarding moving on) gives up that sign-in.
  useEffect(() => {
    const attemptRef = chatGptPlanAttemptRef;
    const loginIdRef = chatGptPlanLoginIdRef;
    return () => {
      attemptRef.current += 1;
      const loginId = loginIdRef.current;
      loginIdRef.current = null;
      if (loginId) void cancelChatGptPlanLogin(loginId).catch(() => undefined);
    };
  }, []);

  const cancelChatGptPlanSignIn = () => {
    dropChatGptPlanLogin();
    setChatGptPlanLogin(CHATGPT_PLAN_LOGIN_IDLE);
  };

  /** The form is being replaced or closed: a sign-in it was showing
   * goes with it. One started from a provider card (Settings, no ChatGPT
   * form open) is the card's and stays. */
  const releaseFormChatGptPlanLogin = () => {
    if (isChatGptProviderForm) cancelChatGptPlanSignIn();
  };

  const resetProviderForm = () => {
    setProviderForm(null);
    setProviderFormModelOptions([]);
    setProviderFormProbeState({ kind: "idle" });
    releaseFormChatGptPlanLogin();
    setNoAuthConfirmOpen(false);
    setClearKeyConfirmOpen(false);
    resetConnectionTest();
  };

  const updateProviderForm = (patch: Partial<ProviderFormState>) => {
    setProviderForm((current) => ({
      ...(current ?? newProviderForm()),
      ...patch,
    }));
    if (
      "protocol" in patch ||
      "authKind" in patch ||
      "providerPresetId" in patch ||
      "apiKey" in patch ||
      "apiBase" in patch
    ) {
      setProviderFormModelOptions([]);
    }
    setProviderFormProbeState({ kind: "idle" });
    resetConnectionTest();
  };

  /** Display-name edits don't invalidate a passing connection test —
   * the name is cosmetic and not part of the probe. (Settings edits
   * the name through updateProviderForm and keeps its historical
   * reset-everything behavior.) */
  const setProviderDisplayName = (displayName: string) => {
    setProviderForm((current) => ({
      ...(current ?? newProviderForm()),
      displayName,
    }));
  };

  const selectProviderPreset = (
    providerPresetId: ManagedModelProviderPresetId,
  ) => {
    setProviderForm((current) => {
      const base = current ?? newProviderForm();
      return providerFormFromPreset(providerPresetId, {
        id: base.id,
        apiKey: base.apiKey,
      });
    });
    setProviderFormModelOptions([]);
    setProviderFormProbeState({ kind: "idle" });
    releaseFormChatGptPlanLogin();
    resetConnectionTest();
  };

  const startNewProvider = () => {
    setProviderForm(newProviderForm());
    setProviderFormModelOptions([]);
    setProviderFormProbeState({ kind: "idle" });
    releaseFormChatGptPlanLogin();
    resetConnectionTest();
  };

  const startEditProvider = (provider: ManagedModelProviderRecord) => {
    expandProvider?.(provider.id);
    setProviderForm(providerFormFromRecord(provider));
    setProviderFormModelOptions([]);
    setProviderFormProbeState({ kind: "idle" });
    releaseFormChatGptPlanLogin();
    resetConnectionTest();
  };

  /** `target` names a saved model to test instead of the form's own
   * model field — the edit form's 「测试模型」 (Settings), which has no
   * model field. Omitted = the create-form behavior. */
  const handleProviderFormTest = async (target?: {
    model: string;
    advancedOptions?: Record<string, unknown>;
  }) => {
    if (
      !visibleProviderForm ||
      !canTestProvider ||
      !visibleProviderForm.protocol
    ) {
      return;
    }
    const testInput = providerFormModelTestInput(visibleProviderForm, {
      authKind: providerFormEffectiveAuthKind,
      defaults,
      target,
    });
    const action: ProbeAction = testInput ? "model-test" : "model-list";
    setProviderFormProbeState({
      kind: "loading",
      action,
    });
    try {
      const message = testInput
        ? connectionSuccessMessage(
            await testManagedModelConnectionWithLatency(testInput),
            "setup-model",
            modelCopy,
          )
        : listModelsMessage(
            await listManagedModelOptions({
              id: visibleProviderForm.id,
              providerId: visibleProviderForm.id,
              protocol: visibleProviderForm.protocol,
              authKind: providerFormEffectiveAuthKind,
              apiKey: visibleProviderForm.apiKey || undefined,
              apiBase: visibleProviderForm.apiBase,
            }),
            modelCopy,
          );
      setProviderFormProbeState({
        kind: "success",
        action,
        message,
      });
    } catch (e) {
      setProviderFormProbeState(
        action === "model-list"
          ? modelListProbeFailureState(e, modelCopy)
          : {
              kind: "error",
              action,
              message: managedModelProbeErrorMessage(e, modelCopy),
            },
      );
    }
  };

  const handleProviderFormFetchModels = async () => {
    if (
      !visibleProviderForm ||
      !canFetchProviderFormModels ||
      !visibleProviderForm.protocol
    ) {
      return;
    }
    setProviderFormProbeState({
      kind: "loading",
      action: "model-list",
    });
    try {
      const result = await listManagedModelOptions({
        protocol: visibleProviderForm.protocol,
        authKind: providerFormEffectiveAuthKind,
        apiKey: visibleProviderForm.apiKey,
        apiBase: visibleProviderForm.apiBase,
      });
      setProviderFormModelOptions(result.models);
      if (
        result.models.length === 1 &&
        visibleProviderForm.model.trim() === ""
      ) {
        setProviderForm((current) =>
          current ? { ...current, model: result.models[0] } : current,
        );
      }
      setProviderFormProbeState({
        kind: "success",
        action: "model-list",
        message:
          result.models.length > 0
            ? modelCopy.foundModels(result.models.length)
            : modelCopy.connectedNoModels,
      });
    } catch (e) {
      setProviderFormProbeState(modelListProbeFailureState(e, modelCopy));
    }
  };

  const handleProviderSave = async () => {
    if (!visibleProviderForm || !canCommit || !visibleProviderForm.protocol) {
      return;
    }
    // A save that would commit a no-auth provider gets one explicit
    // confirm — the error-prevention guardrail the removed non-empty
    // gate used to provide. Re-saving an already no-auth provider
    // doesn't re-ask.
    if (
      providerFormEffectiveAuthKind === "none" &&
      editingProvider?.authKind !== "none"
    ) {
      setNoAuthConfirmOpen(true);
      return;
    }
    await commitProviderSave();
  };

  const confirmNoAuthSave = () => {
    setNoAuthConfirmOpen(false);
    void commitProviderSave();
  };

  const cancelNoAuthSave = () => setNoAuthConfirmOpen(false);

  const commitProviderSave = async () => {
    if (!visibleProviderForm || !visibleProviderForm.protocol) {
      return;
    }
    if (postSaveForm === "success-status") {
      setProviderFormProbeState({ kind: "loading", action: "commit" });
    }
    try {
      const result = await runProviderCommit(
        { saveProvider, saveModel },
        {
          form: visibleProviderForm,
          makeDefault,
          modelsCount: models.length,
          providerHasSavedKey,
          displayNameFallback,
          trimCredentials: trimCredentialsOnSave,
        },
      );
      if (result.isNewProvider && providerFormModelOptions.length > 0) {
        rememberProviderModelOptions?.(
          result.providerId,
          providerFormModelOptions,
        );
      }
      if (postSaveForm === "reset") {
        resetProviderForm();
      } else {
        setProviderFormProbeState({
          kind: "success",
          action: "commit",
          message: modelCopy.setupComplete,
        });
      }
      onSaved?.(result);
    } catch (e) {
      if (postSaveForm === "success-status") {
        setProviderFormProbeState({
          kind: "error",
          action: "commit",
          message: managedModelProbeErrorMessage(e, modelCopy),
        });
      }
      // Otherwise the form stays as typed; the caller's wrapped store
      // action reports the failure (settings: error toast).
    }
  };

  // Clear a saved key: the provider becomes a no-auth endpoint (one
  // mental model — has key / no key), acting on the *saved* provider
  // record so unsaved form edits aren't committed as a side effect.
  // Typing a new key any time upgrades it back to api_key.
  const canClearProviderKey =
    !!editingProvider &&
    editingProvider.authKind === "api_key" &&
    editingProvider.credentialStatus !== "missing";

  const handleProviderClearKey = () => {
    if (canClearProviderKey) setClearKeyConfirmOpen(true);
  };

  const cancelClearProviderKey = () => setClearKeyConfirmOpen(false);

  const confirmClearProviderKey = async () => {
    const provider = editingProvider;
    setClearKeyConfirmOpen(false);
    if (!provider) return;
    try {
      await saveProvider({
        id: provider.id,
        protocol: provider.protocol,
        authKind: "none",
        apiBase: provider.apiBase,
        displayName: provider.displayName,
      });
      setProviderForm((current) =>
        current && current.id === provider.id
          ? { ...current, authKind: "none", apiKey: "" }
          : current,
      );
      onSaved?.({ providerId: provider.id, isNewProvider: false });
    } catch {
      // Reported by the caller's wrapped store action (settings: toast).
    }
  };

  /**
   * Sign in with ChatGPT: open Core's sign-in, send the browser to it,
   * wait for the callback (`complete`, once per login id), then reload
   * the store and the plan status. Needs no form: the provider card's
   * 「用 ChatGPT 登录」 runs it too. Core takes over the ChatGPT provider
   * if there is one.
   */
  const handleChatGptPlanLogin = async () => {
    if (
      chatGptPlanLogin.phase === "starting" ||
      chatGptPlanLogin.phase === "waiting"
    ) {
      return;
    }
    dropChatGptPlanLogin();
    const attempt = chatGptPlanAttemptRef.current;
    const knownProviderIds = new Set(providers.map((item) => item.id));
    const failed = (e: unknown) => {
      const failure = chatGptPlanLoginFailure(e, {
        plan: planCopy,
        models: modelCopy,
      });
      setChatGptPlanLogin(
        failure.kind === "reset"
          ? CHATGPT_PLAN_LOGIN_IDLE
          : { phase: "error", message: failure.message },
      );
    };
    setChatGptPlanLogin({ phase: "starting" });
    let start: ChatGptPlanLoginStart;
    try {
      start = await startChatGptPlanLogin();
    } catch (e) {
      if (attempt === chatGptPlanAttemptRef.current) failed(e);
      return;
    }
    if (attempt !== chatGptPlanAttemptRef.current) {
      // Cancelled while it was being opened.
      void cancelChatGptPlanLogin(start.loginId).catch(() => undefined);
      return;
    }
    chatGptPlanLoginIdRef.current = start.loginId;
    setChatGptPlanLogin({ phase: "waiting", loginId: start.loginId });
    try {
      // `authUrl` may carry id_token_hint: it goes to the browser and
      // nowhere else — not into a log, not into an error message.
      await openUrl(start.authUrl);
    } catch {
      if (attempt !== chatGptPlanAttemptRef.current) return;
      dropChatGptPlanLogin();
      setChatGptPlanLogin({ phase: "error", message: modelCopy.actionFailed });
      return;
    }
    let finished: Awaited<ReturnType<typeof finishChatGptPlanSignIn>>;
    try {
      // Signed in even when the surface moved on meanwhile: the store and
      // the plan status follow either way.
      finished = await finishChatGptPlanSignIn(
        {
          complete: completeChatGptPlanLoginOnce,
          loadManagedModels,
          refreshStatus: useChatGptPlanStore.getState().refreshStatus,
        },
        start.loginId,
        planCopy,
      );
    } catch (e) {
      if (attempt !== chatGptPlanAttemptRef.current) return;
      chatGptPlanLoginIdRef.current = null;
      failed(e);
      return;
    }
    if (attempt !== chatGptPlanAttemptRef.current) return;
    chatGptPlanLoginIdRef.current = null;
    if (finished.failure !== null) {
      // Signed in, but the connection test Core ran right after did not
      // pass (a plan Galley can't use, say): stay here — onboarding on
      // its step, Settings with the editor open — and say why. Core kept
      // the provider and the credential; signing in again or signing out
      // go on from here.
      setChatGptPlanLogin({ phase: "error", message: finished.failure });
      return;
    }
    setChatGptPlanLogin(CHATGPT_PLAN_LOGIN_IDLE);
    useChatGptPlanStore.getState().requestNotice();
    // Close the ChatGPT form it ran in — not a form for another provider
    // the user opened while the browser was out (a card's sign-in).
    if (
      postSaveForm === "reset" &&
      visibleProviderFormRef.current?.authKind === "chatgpt_codex_oauth"
    ) {
      resetProviderForm();
    }
    onChatGptSignedIn?.(finished.providerId, {
      isNewProvider: !knownProviderIds.has(finished.providerId),
    });
  };

  const handleChatGptPlanLogout = async () => {
    if (!visibleProviderForm || !isChatGptProviderForm) return;
    const providerId = visibleProviderForm.id;
    setProviderFormProbeState({ kind: "loading", action: "provider-test" });
    try {
      // Only a credential that still had tokens is revoked, so only then
      // does an unconfirmed revocation mean anything.
      const before = providerId
        ? await getChatGptPlanStatus(providerId).catch(
            () => useChatGptPlanStore.getState().statusByProvider[providerId],
          )
        : undefined;
      // Revokes, then clears the tokens (the registration stays).
      const result = await logoutChatGptPlan(providerId);
      await loadManagedModels();
      if (providerId) {
        void useChatGptPlanStore.getState().refreshStatus(providerId);
      }
      setProviderFormProbeState({
        kind: "success",
        action: "provider-test",
        message: modelCopy.codexSignedOut,
      });
      if (before?.signedIn && !result.remoteRevokeConfirmed) {
        useUiStore.getState().pushToast(
          makeAppError({
            id: "chatgpt-plan-revoke-unconfirmed",
            category: "business",
            severity: "warning",
            title: modelCopy.codexSignedOut,
            message: planCopy.signedOutRevokeUnconfirmed,
            hint: null,
            retryable: false,
            context: "logout_chatgpt_plan",
            traceback: null,
          }),
        );
      }
    } catch (e) {
      setProviderFormProbeState({
        kind: "error",
        action: "provider-test",
        message: managedModelProbeErrorMessage(e, modelCopy),
      });
    }
  };

  return {
    canCommit,
    canClearProviderKey,
    canFetchProviderFormModels,
    canSaveProvider,
    canTestProvider,
    cancelClearProviderKey,
    cancelChatGptPlanSignIn,
    cancelNoAuthSave,
    chatGptPlanLogin,
    clearKeyConfirmOpen,
    confirmClearProviderKey,
    confirmNoAuthSave,
    connectionInputComplete,
    connectionVerified,
    editingProviderIsNoAuth: editingProvider?.authKind === "none",
    noAuthConfirmOpen,
    handleChatGptPlanLogin,
    handleChatGptPlanLogout,
    handleProviderClearKey,
    handleProviderFormFetchModels,
    handleProviderFormTest,
    handleProviderSave,
    isChatGptProviderForm,
    providerFormDirty,
    providerFormIsInlineEdit,
    providerFormModelOptions,
    providerFormProbeState,
    providerHasSavedKey,
    resetProviderForm,
    runConnectionTest,
    selectProviderPreset,
    setProviderDisplayName,
    startEditProvider,
    startNewProvider,
    updateProviderForm,
    visibleProviderForm,
  };
}

function listModelsMessage(
  result: { models: string[] },
  copy: ReturnType<typeof useCopy>["settings"]["models"],
): string {
  return result.models.length > 0
    ? copy.foundModels(result.models.length)
    : copy.connectedNoModels;
}
