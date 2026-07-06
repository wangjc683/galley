import { useState, type Dispatch, type SetStateAction } from "react";

import type { Screen } from "@/stores/ui";
import type { RuntimeKind } from "@/types/session";

export type OnboardingMode = "fresh" | "setup" | "revisit";

/**
 * Owns the Settings-driven Onboarding re-entry state and the return
 * flows out of it. The takeover screen itself is `OnboardingScreen`;
 * this hook is the state + transition logic that both Settings (which
 * *enters* the flow) and OnboardingScreen (which *completes* it) share.
 *
 * Two entry points from Settings:
 *   - Re-run Health Check → revisit mode (skips Welcome / Attach, jumps
 *     to the Health step) and returns to Settings on completion.
 *   - Setup Assistant → setup mode, same first screen as fresh install
 *     but with a "back to Settings" escape hatch.
 *
 * `revisitReturnScreen` remembers where the user was when they triggered
 * the flow so completion / cancel restores that screen *and* re-opens
 * Settings — the trigger came from inside the Settings dialog.
 */
export function useOnboardingFlow({
  screen,
  setScreen,
  setSettingsOpen,
  setEmptyComposerFocusTick,
  gaConfig,
  setGAConfig,
  activeRuntimeKind,
  setActiveRuntimeKind,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setSettingsOpen: (open: boolean) => void;
  setEmptyComposerFocusTick: Dispatch<SetStateAction<number>>;
  gaConfig: { gaPath: string; python?: string };
  setGAConfig: (
    partial: Partial<{ gaPath: string; python: string }>,
  ) => Promise<void>;
  activeRuntimeKind: RuntimeKind;
  setActiveRuntimeKind: (kind: RuntimeKind) => Promise<void>;
}) {
  const [healthCheckRevisit, setHealthCheckRevisit] = useState(false);
  const [setupAssistantFromSettings, setSetupAssistantFromSettings] =
    useState(false);
  const [revisitReturnScreen, setRevisitReturnScreen] =
    useState<Screen>("empty");

  const mode: OnboardingMode = healthCheckRevisit
    ? "revisit"
    : setupAssistantFromSettings
      ? "setup"
      : "fresh";

  const returnToSettings = () => {
    setHealthCheckRevisit(false);
    setSetupAssistantFromSettings(false);
    setScreen(revisitReturnScreen);
    setSettingsOpen(true);
  };

  const returnToMainAfterSetup = () => {
    setHealthCheckRevisit(false);
    setSetupAssistantFromSettings(false);
    setScreen("empty");
    setEmptyComposerFocusTick((tick) => tick + 1);
  };

  const saveExternalGAConfigIfChanged = async (
    gaPath: string,
    pythonAlias: string | null,
  ) => {
    const partial: { gaPath?: string; python?: string } = {};
    if (gaPath !== gaConfig.gaPath) partial.gaPath = gaPath;
    if (pythonAlias && pythonAlias !== gaConfig.python) {
      partial.python = pythonAlias;
    }
    if (Object.keys(partial).length > 0) {
      await setGAConfig(partial);
    }
  };

  // Settings → "Re-run Health Check". Remember the current screen, close
  // Settings, and hand off to Onboarding in revisit mode.
  const enterHealthCheckRevisit = () => {
    setRevisitReturnScreen(screen);
    setSettingsOpen(false);
    setHealthCheckRevisit(true);
    setSetupAssistantFromSettings(false);
    setScreen("onboarding");
  };

  // Settings → "Setup Assistant". Same handoff, setup mode.
  const enterSetupAssistant = () => {
    setRevisitReturnScreen(screen);
    setSettingsOpen(false);
    setHealthCheckRevisit(false);
    setSetupAssistantFromSettings(true);
    setScreen("onboarding");
  };

  const handleComplete = (gaPath: string, pythonAlias: string | null) => {
    // Persist the validated path + the probed Python alias so
    // subsequent bridge spawns use the right interpreter, not
    // the demo fallback (system python3 in a packaged build
    // has no GA deps — silent crash).
    void (async () => {
      await saveExternalGAConfigIfChanged(gaPath, pythonAlias);
      if (!healthCheckRevisit && activeRuntimeKind !== "external") {
        await setActiveRuntimeKind("external");
      }
      if (healthCheckRevisit) {
        // Settings → "跑一次 Health Check" round-trip: return
        // the user to the screen they came from + re-open the
        // Settings dialog where they clicked.
        returnToSettings();
      } else {
        returnToMainAfterSetup();
      }
    })();
  };

  const handleManagedComplete = () => {
    void (async () => {
      if (activeRuntimeKind !== "managed") {
        await setActiveRuntimeKind("managed");
      }
      returnToMainAfterSetup();
    })();
  };

  return {
    mode,
    enterHealthCheckRevisit,
    enterSetupAssistant,
    handleComplete,
    handleManagedComplete,
    // Revisit-only escape hatch (Onboarding onCancel). setGAConfig is
    // intentionally skipped — the user bailed without committing to a
    // new probe result, so whatever was saved before is kept.
    returnToSettings,
  };
}
