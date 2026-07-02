import { Check } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { LanguagePreferenceMenu } from "@/components/language/LanguagePreferenceMenu";
import {
  StepAttach,
  type PathValidation,
} from "@/components/screens/onboarding/StepAttach";
import { StepHealth } from "@/components/screens/onboarding/StepHealth";
import { StepModelConfig } from "@/components/screens/onboarding/StepModelConfig";
import { TutorialModal } from "@/components/screens/onboarding/TutorialModal";
import { Button } from "@/components/ui/button";
import { runHealthChecks, validateGAPath } from "@/lib/onboarding-validation";
import {
  tutorialsForLanguage,
  type Tutorial,
  type TutorialId,
} from "@/lib/onboarding-tutorials";
import { useCopy } from "@/lib/i18n";
import type { LanguagePreference, ResolvedLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";
import { usePrefsStore } from "@/stores/prefs";
import type { HealthCheckItem } from "@/types/inspector";

export type OnboardingStep = "model" | "attach" | "health";

export interface OnboardingProps {
  /** Called when the user completes Step 2 successfully. The host
   * unmounts the Onboarding screen and renders the main app.
   *
   * `pythonAlias` is the interpreter value the probe found. This can
   * be a legacy alias (e.g. "python-framework-3-14") or an absolute
   * venv path. The host persists it to gaConfig so subsequent bridge
   * spawns use the right interpreter. Null when probe failed (the
   * Continue button is disabled in that case, so this is mostly a
   * type-safety hatch). */
  onComplete: (gaPath: string, pythonAlias: string | null) => void;
  /** Called when managed model setup succeeds. */
  onManagedComplete?: () => void;
  /**
   * Flow mode. Default `"fresh"` is the first-launch path: Model /
   * Attach / Health → Main view. `"setup"` is the Settings → "Open
   * Setup Assistant" path: starts from the same first screen but keeps
   * a top-level Back to Settings escape hatch. `"revisit"` is the Settings →
   * "Re-run Health Check" path: jumps straight to Health step (uses
   * the already-saved GA path), relabels Back → "取消" and
   * "进入 Galley" → "返回设置", and requires an `onCancel` callback
   * for the Back button (since there's no Attach step to step back to).
   */
  mode?: "fresh" | "setup" | "revisit";
  /**
   * Required when `mode="revisit"`. Called when the user clicks the
   * (renamed) Back button to abort without re-saving. The host should
   * return the user to wherever they were before triggering the
   * revisit (typically: re-open the Settings dialog).
   */
  onCancel?: () => void;
  /**
   * Required when `mode="revisit"`. Pre-populates the Health step's
   * path input with the user's already-saved GA path so the cascade
   * runs against the right directory without going through Attach.
   */
  initialPath?: string;
  /**
   * Setup Assistant can be opened after bundled GA is already ready.
   * In that case the first step should allow the user to continue
   * without re-entering an API key or changing model configuration.
   */
  canContinueWithCurrentModel?: boolean;
  languagePreference: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
  onChangeLanguagePreference: (preference: LanguagePreference) => void;
}

/**
 * Top-level Onboarding controller — manages step state, mocked path
 * validation, and a sequential health-check animation. DESIGN.md §5.
 *
 * No AppShell here: Onboarding is a takeover screen, no sidebar or
 * inspector. We reserve top-left padding for the macOS traffic light
 * (which is positioned at {16, 16} via tauri.conf.json).
 *
 * #5 ships with mocked validation + check progression so we can see
 * the full flow without a real bridge subprocess. Real validation
 * (path existence, agentmain.py import, mykey.py parse, LLM config
 * count) wires up in #10 alongside IPC.
 */
export function Onboarding({
  onComplete,
  onManagedComplete,
  mode = "fresh",
  onCancel,
  initialPath,
  canContinueWithCurrentModel = false,
  languagePreference,
  resolvedLanguage,
  onChangeLanguagePreference,
}: OnboardingProps) {
  const copy = useCopy();
  const tutorials = useMemo(
    () => tutorialsForLanguage(resolvedLanguage),
    [resolvedLanguage],
  );
  const isRevisit = mode === "revisit";
  const isSetup = mode === "setup";
  const setGAConfig = usePrefsStore((s) => s.setGAConfig);
  // Revisit jumps straight to Health (Settings already has a saved GA
  // path; user just wants to re-validate). Setup starts at the same
  // model screen as first launch but adds a Settings escape hatch.
  const [step, setStep] = useState<OnboardingStep>(
    isRevisit ? "health" : "model",
  );
  const [path, setPath] = useState(initialPath ?? "");
  const [validation, setValidation] = useState<PathValidation>(null);
  // Active tutorial modal id; null = closed. Set by StepAttach
  // tutorial buttons and StepHealth row-action clicks. Surfaces the
  // matching hand-written snippet from `lib/onboarding-tutorials`.
  const [activeTutorial, setActiveTutorial] = useState<TutorialId | null>(null);
  // Bumped by the "重新检查" button to re-trigger the runHealthChecks
  // effect without going Back → Continue. Same dep array; an integer
  // change forces the effect to re-fire and cancels any in-flight run.
  const [healthRunNonce, setHealthRunNonce] = useState(0);
  // Tauri shell-capability alias for the Python interpreter the probe
  // chose — survives across re-runs so we don't lose it if the user
  // clicks 重新检查 after a successful first probe. Persisted into
  // gaConfig by onComplete.
  const [probedPython, setProbedPython] = useState<string | null>(null);

  // Debounced real path validation via Tauri fs plugin. The
  // setTimeout pacing keeps the UI responsive while the user is still
  // typing; we don't fire a probe on every keystroke. setState calls
  // are scheduled on a tick to satisfy the
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (!path.trim()) {
      timers.push(
        setTimeout(() => {
          if (!cancelled) setValidation(null);
        }, 0),
      );
      return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    }

    timers.push(
      setTimeout(() => {
        if (!cancelled) setValidation({ kind: "checking" });
      }, 0),
    );

    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        // Real fs check. Errors fall through to "not-found" — same UX
        // since either way the path isn't usable. The picker is the
        // happy path; manual typing surfaces typos here.
        void validateGAPath(path).then((result) => {
          if (cancelled) return;
          setValidation(result);
        });
      }, 350),
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [path]);

  // Health check progression. Driven by real fs probes via
  // runHealthChecks(); each check transitions pending → running →
  // success/warning/failed in sequence. The runner does its own
  // pacing so we don't need a manual setTimeout cascade here.
  const [healthChecks, setHealthChecks] = useState<HealthCheckItem[]>([]);

  // v0.1.1+: when gaConfig.useExternalPython is false (the default),
  // runHealthChecks resolves the bundled Python in production and runs
  // a bridge-equivalent runtime probe. External mode probes candidate
  // venvs and populates probedPython with the winning value.
  const useExternalPython = usePrefsStore((s) => s.gaConfig.useExternalPython);
  const configuredPython = usePrefsStore((s) => s.gaConfig.python);

  useEffect(() => {
    if (step !== "health") return;
    const controller = new AbortController();
    // Backstop: if the runner itself rejects (path resolution, invoke
    // errors outside the per-probe catches), settle every unfinished
    // row as failed — otherwise the list never settles and Continue
    // stays disabled with no retry affordance.
    void runHealthChecks(path, setHealthChecks, controller.signal, {
      useExternalPython,
      python: configuredPython,
      smokeTest: true,
      onPythonProbed: (alias) => setProbedPython(alias),
      labels: copy.health,
    }).catch((e) => {
      if (controller.signal.aborted) return;
      console.error("[onboarding] health check run failed:", e);
      setHealthChecks((items) =>
        items.map((item) =>
          item.state === "pending" || item.state === "running"
            ? { ...item, state: "failed" }
            : item,
        ),
      );
    });
    return () => controller.abort();
  }, [
    copy.health,
    step,
    path,
    healthRunNonce,
    useExternalPython,
    configuredPython,
  ]);

  // Tutorial mapping: each named health check (and StepAttach failure)
  // maps to one fix-it snippet. The action id we hand to
  // HealthCheckCard is the same string as the tutorial id, so the
  // onItemAction handler can look it up directly without a separate
  // dispatch table.
  const itemActions = useMemo<Record<string, { id: string; label: string }[]>>(
    () => ({
      [copy.health.gaPathExists]: [
        { id: "download-ga", label: copy.onboarding.tutorialDownloadGA },
      ],
      [copy.health.agentmainVisible]: [
        { id: "wrong-directory", label: copy.onboarding.tutorialChooseFolder },
      ],
      [copy.health.mykeyExists]: [
        { id: "mykey-setup", label: copy.onboarding.tutorialMyKey },
      ],
      [copy.health.memoryVisible]: [
        { id: "memory-info", label: copy.onboarding.tutorialMemory },
      ],
      [copy.health.assetsVisible]: [
        { id: "assets-missing", label: copy.onboarding.tutorialAssets },
      ],
      [copy.health.pythonInterpreter]: [
        {
          id: "python-missing-anthropic",
          label: copy.onboarding.tutorialPython,
        },
      ],
      [copy.health.bundledPython]: [
        {
          id: "use-external-python",
          label: copy.onboarding.useGAVenv,
        },
      ],
      [copy.health.llmConnection]: [
        { id: "mykey-setup", label: copy.onboarding.tutorialMyKey },
      ],
    }),
    [copy],
  );

  const handleItemAction = (_item: HealthCheckItem, actionId: string) => {
    if (actionId === "use-external-python") {
      setProbedPython(null);
      void setGAConfig({ useExternalPython: true }).then(() => {
        setHealthRunNonce((n) => n + 1);
      });
      return;
    }
    if (isTutorialId(actionId)) setActiveTutorial(actionId);
  };

  const handleShowTutorial = (id: TutorialId) => {
    setActiveTutorial(id);
  };

  const activeTutorialEntry: Tutorial | null = activeTutorial
    ? tutorials[activeTutorial]
    : null;

  const handleContinueAttach = () => {
    if (validation?.kind !== "ok") return;
    setStep("health");
  };

  const handleFinish = () => {
    onComplete(path, probedPython);
  };

  const handleManagedComplete = () => {
    onManagedComplete?.();
  };
  const showSettingsEscape = (isSetup || isRevisit) && Boolean(onCancel);
  const settingsEscapeLabel = isRevisit
    ? copy.common.cancel
    : copy.onboarding.backToSettings;

  return (
    // Outer container is a Tauri drag region so the user can move the
    // window by dragging the empty padding around the content (Onboarding
    // has no TopBar to drag from). The inner 700px content wrapper opts
    // back out so text stays selectable and buttons / inputs work
    // normally — Tauri's drag region inherits down the DOM tree.
    <div
      data-tauri-drag-region
      className="flex h-screen min-h-[600px] w-screen min-w-[960px] flex-col overflow-y-auto bg-app pl-20 pr-16 pt-16 [@media(max-height:719px)]:pl-10 [@media(max-height:719px)]:pr-8 [@media(max-height:719px)]:pt-8"
    >
      <div
        data-tauri-drag-region="false"
        className="mx-auto flex w-full max-w-[700px] flex-col"
      >
        <div className="flex items-center justify-between gap-4">
          <StepProgress step={step} />
          <div className="flex shrink-0 items-center gap-2">
            {showSettingsEscape && (
              <Button variant="ghost" size="sm" onClick={() => onCancel?.()}>
                {settingsEscapeLabel}
              </Button>
            )}
            <LanguagePreferenceMenu
              preference={languagePreference}
              resolvedLanguage={resolvedLanguage}
              onChange={onChangeLanguagePreference}
              variant="compact"
            />
          </div>
        </div>

        <div className="mt-10 [@media(max-height:719px)]:mt-6">
          {step === "model" && (
            <StepModelConfig
              onComplete={handleManagedComplete}
              onAttachExisting={() => setStep("attach")}
              canContinueWithExisting={isSetup && canContinueWithCurrentModel}
            />
          )}
          {step === "attach" && (
            <StepAttach
              path={path}
              validation={validation}
              onPathChange={setPath}
              onPickFolder={() => {
                void pickFolder(copy.app.chooseGAFolderTitle).then((picked) => {
                  if (picked) setPath(picked);
                });
              }}
              onBack={() => setStep("model")}
              onContinue={handleContinueAttach}
              onShowTutorial={handleShowTutorial}
            />
          )}
          {step === "health" && (
            <StepHealth
              items={healthChecks}
              onBack={
                isRevisit ? (onCancel ?? handleFinish) : () => setStep("attach")
              }
              onContinue={handleFinish}
              onRetry={() => setHealthRunNonce((n) => n + 1)}
              onItemAction={handleItemAction}
              itemActions={itemActions}
              backLabel={isRevisit ? copy.common.cancel : copy.common.back}
              continueLabel={
                isRevisit
                  ? copy.onboarding.backToSettings
                  : copy.onboarding.enterGalley
              }
            />
          )}
        </div>
      </div>

      <TutorialModal
        tutorial={activeTutorialEntry}
        onClose={() => setActiveTutorial(null)}
      />
    </div>
  );
}

function isTutorialId(s: string): s is TutorialId {
  return (
    s === "download-ga" ||
    s === "wrong-directory" ||
    s === "mykey-setup" ||
    s === "assets-missing" ||
    s === "memory-info" ||
    s === "python-missing-anthropic"
  );
}

// ---------------- Progress dots ----------------

function StepProgress({ step }: { step: OnboardingStep }) {
  const copy = useCopy();
  const managedStepLabels: { key: OnboardingStep | "done"; label: string }[] = [
    { key: "model", label: copy.settings.models.model },
    { key: "done", label: copy.common.done },
  ];
  const attachStepLabels: { key: OnboardingStep | "done"; label: string }[] = [
    { key: "attach", label: copy.onboarding.gaPathLabel },
    { key: "health", label: copy.health.title },
    { key: "done", label: copy.common.done },
  ];
  const labels = step === "model" ? managedStepLabels : attachStepLabels;
  const stepIndex: Record<OnboardingStep | "done", number> = {
    model: 0,
    attach: 0,
    health: 1,
    done: step === "model" ? 1 : 2,
  };
  const current = stepIndex[step];

  return (
    <div className="flex items-center gap-2.5">
      {labels.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s.key} className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 text-[12.5px]">
              <span
                className={cn(
                  "inline-flex size-[18px] items-center justify-center rounded-full text-[11px] font-semibold",
                  done && "bg-brand text-ink",
                  active && "bg-ink text-elevated",
                  !done &&
                    !active &&
                    "border border-line-strong text-ink-muted",
                )}
              >
                {done ? <Check size={11} weight="bold" /> : i + 1}
              </span>
              <span
                className={cn(
                  active ? "font-medium text-ink" : "text-ink-muted",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <span className="h-px w-[60px] bg-line" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Folder picker ----------------

/**
 * Tauri dialog folder picker. Lazy import keeps Vite-only dev from
 * choking on the plugin shim. Returns the picked path or null on
 * cancel / error.
 */
async function pickFolder(title: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" && selected.length > 0
      ? selected
      : null;
  } catch (e) {
    console.warn("[onboarding] pickFolder failed.", e);
    return null;
  }
}
