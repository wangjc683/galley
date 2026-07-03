/**
 * App cold-start orchestrator.
 *
 * Mounted by App.tsx as a fire-and-forget useEffect on first render.
 * Drives the slice-store hydrate sequence in the order needed for a
 * clean first paint:
 *
 *   1. App version → runtimeInfo (so Settings → About shows the
 *      real bundle version rather than the demo "0.1.0" fixture).
 *   2. prefsStore.hydratePrefs (runtime mode, yolo / conversationWidth /
 *      gaConfig). Runtime mode must be known before sessions hydrate so
 *      the sidebar can show the current runtime's sessions only.
 *   3. Saved prompts hydrate (Composer convenience state).
 *   4. Managed runtime layout ensure (creates state dirs if missing and
 *      records diagnostics for Settings).
 *   5. Managed model records hydrate (needed for managed-mode routing).
 *   6. sessionsStore.hydrate (sessions + projects via Rust Core).
 *   7. SQLite housekeeping + FTS backfill in the background.
 *      Best-effort — never blocks first paint.
 *   8. Cached LLM seed → runtimeStore (short-term hint so cold-start
 *      cosmetics show the user's real GA-configured models instead
 *      of the demo placeholders before any bridge has spawned).
 *   9. Branch on active runtime config:
 *      - managed with no configured model → route to Onboarding
 *      - external with no GA path     → route to Onboarding
 *      - external configured          → warmup bridge against mykey.py
 *
 * This is a pure-function module, not a store. It has no own state —
 * it orchestrates side effects across stores. Tests can drive each
 * step independently by mocking the slice-store getState() calls.
 */

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

import {
  backfillFtsIfEmpty,
  deleteDemoSessions,
  deleteEmptyNewSessions,
  getPref,
} from "@/lib/db";
import { pushCloseHintCopy } from "@/lib/close-hint";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { applyManagedRuntimeDiagnostics } from "@/lib/managed-runtime-diagnostics";
import { useAppUpdateStore } from "@/stores/app-update";
import { useManagedModelsStore } from "@/stores/managed-models";
import { usePrefsStore } from "@/stores/prefs";
import type { LLMOption } from "@/stores/runtime";
import { useRuntimeStore } from "@/stores/runtime";
import { useSavedPromptsStore } from "@/stores/saved-prompts";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";

export async function hydrateApp(): Promise<void> {
  // 1. App version — replace the empty-string sentinel in
  // DEFAULT_RUNTIME_INFO with the real value baked into
  // tauri.conf.json at build time. Failing fetch leaves the empty
  // string, which renders as `v` in Settings → About — a louder
  // "something's wrong" than silently displaying a stale literal.
  let realVersion: string | null = null;
  try {
    realVersion = await getVersion();
    useRuntimeStore
      .getState()
      .patchRuntimeInfo({ workbenchVersion: realVersion });
  } catch (e) {
    console.debug("[hydrate] app.getVersion failed.", e);
  }

  // 2. Prefs hydrate. Runtime mode gates the sessions hydrate below:
  // the sidebar should list only the current runtime's sessions.
  const { hasGAConfig } = await usePrefsStore.getState().hydratePrefs();
  if (realVersion) {
    void useAppUpdateStore.getState().noteAppLaunched(realVersion);
  }

  // 2b. Push the background-mode close hint copy into Galley Core for
  // the current language. The Rust close handler can't reach GUI i18n,
  // so we hand it the localized strings here. The seen flag is owned by
  // Rust (seeded at setup), so the GUI only carries copy. Fire-and-
  // forget — never blocks paint.
  void pushCloseHintCopy(usePrefsStore.getState().languagePreference);

  // 3. Saved prompts. Composer can render defaults before this resolves,
  // but hydrating here prevents the first popover open from doing IO.
  await useSavedPromptsStore.getState().hydrate();

  // 4. Managed runtime layout. This is intentionally safe to run on
  // every cold start: it only creates missing Galley-owned directories.
  try {
    const managedRuntime = await invoke<ManagedRuntimeDiagnostics>(
      "ensure_managed_runtime_layout",
    );
    applyManagedRuntimeDiagnostics(managedRuntime);
  } catch (e) {
    console.warn("[hydrate] managed runtime layout init failed.", e);
  }

  // 5. Managed models. Startup reads only metadata and local credential
  // presence, never the real API key values.
  const managedConfig = await useManagedModelsStore.getState().load();

  // 6. Startup-critical state: sessions/projects. Route through Rust
  // Core so a slow direct-SQL housekeeping pass cannot leave the
  // sidebar blank on Dev hot restarts.
  await useSessionsStore.getState().hydrate();
  // Update auto-prepare is deliberately after sessions hydrate. If a
  // dev reload preserves an in-flight task in messagesStore, the updater
  // guard can see it and defer install work until the session is idle.
  void useAppUpdateStore
    .getState()
    .check({ silent: true, downloadIfAvailable: true });

  // 7. Non-critical SQLite housekeeping + FTS backfill. Fire-and-forget:
  // these are nice cleanup/indexing tasks, not requirements for first paint.
  void runSqlHousekeeping();

  // 8. Restore cached LLM list (written by replaceLLMs whenever a
  // bridge's `ready` event arrives). Lets cold-start cosmetics show
  // the user's real GA-configured models instead of DEFAULT_LLMS
  // before any bridge has spawned in this session. Lives outside
  // prefsStore — it's a short-term runtime hint, not a long-lived
  // preference.
  try {
    const cachedLLMs = await getPref<LLMOption[]>("llm_list");
    if (cachedLLMs && cachedLLMs.length > 0) {
      useRuntimeStore.getState().seedCachedLLMs(cachedLLMs);
    }
  } catch (e) {
    console.warn("[hydrate] llm_list pref load failed.", e);
  }

  // 9. Branch on active runtime config.
  const activeRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
  if (activeRuntimeKind === "managed" && managedConfig.loadError) {
    // A failed load says nothing about whether models are configured —
    // routing to onboarding here used to throw configured users back to
    // the first-run screen on a transient DB/IPC hiccup. Keep the normal
    // screen and surface the failure with a retry path (Settings →
    // Models reloads on open).
    const copy = copyForLanguage(
      resolveLanguagePreference(usePrefsStore.getState().languagePreference),
    );
    useUiStore.getState().pushToast({
      id: "managed-models-load-failed",
      category: "bridge",
      severity: "error",
      message: `${copy.errors.managedModelsLoadFailed}\n${managedConfig.loadError}`,
      hint: null,
      retryable: true,
      context: "hydrate.managed_models",
      traceback: null,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  const needsOnboarding =
    activeRuntimeKind === "managed"
      ? managedConfig.models.length === 0
      : !hasGAConfig;
  if (needsOnboarding) {
    useUiStore.getState().setScreen("onboarding");
    return;
  }
  if (activeRuntimeKind === "external") {
    void useRuntimeStore.getState().warmupLLMList();
  }
}

async function runSqlHousekeeping(): Promise<void> {
  try {
    const removed = await deleteEmptyNewSessions();
    if (removed > 0) {
      console.info(`[hydrate] pruned ${removed} empty 新对话 row(s).`);
    }
  } catch (e) {
    console.debug("[hydrate] deleteEmptyNewSessions failed.", e);
  }

  try {
    const removed = await deleteDemoSessions();
    if (removed > 0) {
      console.info(`[hydrate] pruned ${removed} legacy demo session(s).`);
    }
  } catch (e) {
    console.debug("[hydrate] deleteDemoSessions failed.", e);
  }

  try {
    const indexed = await backfillFtsIfEmpty();
    if (indexed > 0) {
      console.info(
        `[hydrate] backfilled ${indexed} message(s) into messages_fts.`,
      );
    }
  } catch (e) {
    console.debug("[hydrate] backfillFtsIfEmpty failed.", e);
  }
}
