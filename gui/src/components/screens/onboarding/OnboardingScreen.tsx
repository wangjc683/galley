import { ThemeProvider } from "@/components/theme/ThemeContext";
import { CopyProvider } from "@/lib/i18n";
import type { LanguagePreference, ResolvedLanguage } from "@/lib/language";
import type { ResolvedTheme } from "@/lib/theme";

import { Onboarding } from "./Onboarding";
import type { OnboardingMode } from "@/hooks/useOnboardingFlow";

/**
 * Onboarding takeover screen — rendered instead of the main AppShell
 * while `screen === "onboarding"`. Purely presentational: it wires the
 * `Onboarding` flow into the app's Copy / Theme providers and forwards
 * the completion callbacks from `useOnboardingFlow`. All state and
 * transition logic lives in that hook so this file has none.
 *
 * `initialPath` is only seeded in revisit / setup mode (the user is
 * editing an existing external-GA config); a fresh install starts blank.
 */
export function OnboardingScreen({
  resolvedLanguage,
  resolvedTheme,
  mode,
  gaPath,
  canContinueWithCurrentModel,
  languagePreference,
  onChangeLanguagePreference,
  onComplete,
  onManagedComplete,
  onCancel,
}: {
  resolvedLanguage: ResolvedLanguage;
  resolvedTheme: ResolvedTheme;
  mode: OnboardingMode;
  gaPath: string;
  canContinueWithCurrentModel: boolean;
  languagePreference: LanguagePreference;
  onChangeLanguagePreference: (preference: LanguagePreference) => void;
  onComplete: (gaPath: string, pythonAlias: string | null) => void;
  onManagedComplete: () => void;
  onCancel: () => void;
}) {
  return (
    <CopyProvider language={resolvedLanguage}>
      <ThemeProvider theme={resolvedTheme}>
        <Onboarding
          mode={mode}
          initialPath={mode !== "fresh" ? gaPath : undefined}
          canContinueWithCurrentModel={canContinueWithCurrentModel}
          languagePreference={languagePreference}
          resolvedLanguage={resolvedLanguage}
          onChangeLanguagePreference={onChangeLanguagePreference}
          onComplete={onComplete}
          onManagedComplete={onManagedComplete}
          onCancel={onCancel}
        />
      </ThemeProvider>
    </CopyProvider>
  );
}
