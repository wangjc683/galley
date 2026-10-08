import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { BROWSER_CONTROL_READY_TOAST_ID } from "@/stores/browser-control";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { RuntimeKind } from "@/types/session";

/**
 * Switch the active runtime mode (内置内核 ↔ 外部 GA) for an app that
 * already has conversations: persist the pref, drop state that belongs
 * to the old runtime, reload the session list for the new one, and
 * confirm with a toast. Settings → 运行环境 and the Setup Assistant
 * both go through here, so the sidebar never keeps showing the other
 * runtime's conversations after a switch.
 *
 * No-op when `kind` is already active. First-launch onboarding does not
 * use this — there is nothing to reload or keep, so it writes the pref
 * directly (see `useOnboardingFlow`).
 *
 * Lives outside the stores because it fans out across prefs / runtime /
 * sessions / ui; `prefs` must stay a leaf of the slice DAG.
 */
export async function switchRuntimeKind(kind: RuntimeKind): Promise<void> {
  if (usePrefsStore.getState().activeRuntimeKind === kind) return;
  await usePrefsStore.getState().setActiveRuntimeKind(kind);
  useRuntimeStore.setState({ pendingLLMIndex: undefined });
  // The sticky 「试一试」 toast belongs to the managed runtime's Browser
  // Control: after a switch either way its demo would run on the wrong
  // engine (it never times out, so it would still be there).
  useUiStore.getState().dismissToast(BROWSER_CONTROL_READY_TOAST_ID);
  const sessions = useSessionsStore.getState();
  sessions.setActiveProjectFilter(undefined);
  sessions.setActiveSession(undefined);
  useUiStore.getState().setScreen("empty");
  await useSessionsStore.getState().hydrate();
  const copy = copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
  useUiStore.getState().pushToast(
    makeAppError({
      category: "business",
      severity: "info",
      title: copy.toasts.switchedRuntime(kind),
      message: copy.toasts.runtimeSwitchKept,
      hint: null,
      retryable: false,
      context: null,
      traceback: null,
      autoDismissMs: 4200,
    }),
  );
}
