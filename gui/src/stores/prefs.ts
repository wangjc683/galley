import { create } from "zustand";

import type { ApprovalConfig } from "@/components/screens/settings/settings-types";
import { getPref, setPref } from "@/lib/db";
import { copyForLanguage } from "@/lib/i18n";
import {
  resolveLanguagePreference,
  type LanguagePreference,
} from "@/lib/language";
import { findCandidateByAlias } from "@/lib/python-probe";
import { DEFAULT_APPROVAL_CONFIG, DEFAULT_GA_CONFIG } from "@/stores/defaults";
import { useRuntimeStore } from "@/stores/runtime";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { RuntimeKind } from "@/types/session";

/**
 * prefsStore — user preferences + GA spawn config.
 *
 * Holds the five long-lived prefs that survive app restarts (when
 * persistable):
 *
 *   - gaConfig            (python / gaPath / bridgeCwd / useExternalPython)
 *   - activeRuntimeKind   (managed / external)
 *   - approvalConfig      (in-memory only, v0.1 doesn't persist rules)
 *   - yoloMode            (pref: yolo_mode)
 *   - yoloIntroSeen       (pref: yolo_intro_seen)
 *   - conversationWidth   (pref: conversation_width)
 *   - languagePreference  (pref: language_preference)
 *
 * setGAConfig fans out to runtimeStore (patchRuntimeInfo / resetWarmup
 * / warmupLLMList) + uiStore (pushToast) so a Settings → Runtime path
 * swap re-heats the bridge without a restart. setYoloMode iterates
 * runtimeStore.byId to broadcast set_yolo_mode IPC to every alive
 * bridge. Both are prefs-slice fan-out responsibilities — propagating
 * a pref change into the rest of the app belongs here, not in the
 * receiving slices.
 *
 * hydratePrefs loads the four persistable prefs from SQLite and
 * returns {hasGAConfig} so the top-level orchestrator at
 * gui/src/lib/hydrate.ts knows whether to route to Onboarding.
 */

export interface GAConfig {
  python: string;
  gaPath: string;
  bridgeCwd: string;
  /**
   * v0.1.1+: Galley ships its own Python interpreter at
   * `$RESOURCE/python/` (see scripts/bundle-python.sh + tauri.conf
   * bundle.resources). The default is to spawn that bundle. Flip
   * this to `true` from Settings → Runtime → advanced to fall back
   * to the user-configured `python` field — the escape hatch for
   * users with custom GA forks that need deps the bundle doesn't
   * carry, or for live-iterating on GA in a venv.
   */
  useExternalPython: boolean;
}

interface PrefsState {
  /**
   * GA subprocess spawn config. `python` + `gaPath` are user-editable
   * via Settings → Runtime path pickers; `bridgeCwd` is internal
   * (workbench repo root in dev / app bundle resources dir in
   * production — set by the macOS bundle Task).
   *
   * Falls back to DEFAULT_GA_CONFIG on first launch before the user
   * has opened Settings. Persists to pref `ga_config` (JSON).
   */
  gaConfig: GAConfig;

  /**
   * Current GenericAgent runtime mode. New installs default to managed;
   * existing users with a persisted GA path migrate to external.
   */
  activeRuntimeKind: RuntimeKind;

  approvalConfig: ApprovalConfig;

  /**
   * YOLO mode (PRD §11.5). When true, every tool dispatch on every
   * alive bridge bypasses the approval gate. Persisted to prefs
   * (sticky across launches). Global, not per-session — flipping
   * this notifies every alive bridge.
   *
   * Default `true` for v0.1 — Galley's first-batch users are GA
   * heavy users who run agents without approval. The first-launch
   * `YoloIntroDialog` discloses this state and offers a one-click
   * revert to approval mode for those who want it.
   */
  yoloMode: boolean;

  /**
   * Has the user dismissed the first-launch YOLO disclosure modal?
   * Persisted to prefs (`yolo_intro_seen`). Initial state defaults
   * to `true` so the modal stays hidden during cold start; hydrate
   * flips to `false` only when the pref is missing, which is the
   * only case that should surface the modal. Set back to `true` by
   * either CTA on the modal.
   */
  yoloIntroSeen: boolean;

  /**
   * Conversation reading column width. Notion-style two-mode toggle:
   *   - "compact": 760px max-width — typographic sweet spot
   *     (~70-78 chars/line at 16.5px Newsreader), preserves the
   *     "document you're reading" feel that anchors the product
   *     register. The default on first launch.
   *   - "wide":   1400px max-width — for wide-monitor users who
   *     don't want most of the screen to be empty margin, and for
   *     sessions with lots of long code blocks / tool callouts /
   *     file_read outputs that get cramped at 760.
   *
   * Applies ONLY to the scrollable conversation column. The bottom
   * stack (ApprovalDock + Composer + hint) stays at 760 regardless
   * — the input zone is fixed-width so the textarea doesn't grow
   * into hard-to-track horizontal sweep when toggled wide.
   *
   * Global preference, not per-session: your monitor doesn't change
   * between sessions so your preference shouldn't either. Persisted
   * to prefs `conversation_width`.
   */
  conversationWidth: "compact" | "wide";

  /**
   * UI language preference. `system` is the default and resolves from
   * OS / WebView language preference at render time.
   */
  languagePreference: LanguagePreference;
}

interface PrefsActions {
  // ---- Approval ----
  setApprovalRequiredTools: (tools: string[]) => void;
  removeAlwaysAllow: (scope: "project" | "global", tool: string) => void;

  // ---- YOLO ----
  /**
   * Set the YOLO mode flag. Persists to prefs and broadcasts the new
   * state to **every** alive bridge over IPC.
   */
  setYoloMode: (enabled: boolean) => Promise<void>;
  /**
   * Dismiss the first-launch YOLO disclosure modal. Optionally
   * reverts YOLO to off when the user picked "改回审批模式".
   */
  acknowledgeYoloIntro: (revertToApproval?: boolean) => Promise<void>;

  // ---- Conversation width ----
  setConversationWidth: (mode: "compact" | "wide") => Promise<void>;

  // ---- Language ----
  setLanguagePreference: (preference: LanguagePreference) => Promise<void>;

  // ---- GA config ----
  /**
   * Update the GA spawn config and persist to prefs. Resolves the
   * python alias to a display path, reflects gaPath / python into
   * runtimeInfo, resets warmup so a new gaPath / python triggers a
   * fresh LLM list refresh, and toasts the user that the new config
   * applies on next launch for existing bridges.
   */
  setGAConfig: (partial: Partial<GAConfig>) => Promise<void>;

  // ---- Runtime mode ----
  setActiveRuntimeKind: (kind: RuntimeKind) => Promise<void>;

  // ---- Hydration ----
  /**
   * Load the four persistable prefs (yolo_mode / yolo_intro_seen /
   * conversation_width / ga_config) from SQLite. Best-effort: each
   * pref miss falls back to the demo / default value. Returns
   * `{hasGAConfig}` so the top-level orchestrator at lib/hydrate.ts
   * can route fresh-install users to Onboarding and skip the LLM
   * warmup before any GA path is configured.
   */
  hydratePrefs: () => Promise<{ hasGAConfig: boolean }>;
}

export type PrefsStore = PrefsState & PrefsActions;

function normalizeGAConfig(config: GAConfig): GAConfig {
  return {
    ...config,
    python: config.python.trim(),
    gaPath: config.gaPath.trim(),
    bridgeCwd: config.bridgeCwd.trim(),
  };
}

export const usePrefsStore = create<PrefsStore>((set, get) => ({
  // ---- Initial state (demo fixtures until hydratePrefs) ----
  gaConfig: DEFAULT_GA_CONFIG,
  activeRuntimeKind: "managed",
  approvalConfig: DEFAULT_APPROVAL_CONFIG,
  yoloMode: true,
  yoloIntroSeen: true,
  conversationWidth: "compact",
  languagePreference: "system",

  // ---- Approval ----
  setApprovalRequiredTools: (tools) =>
    set((state) => ({
      approvalConfig: { ...state.approvalConfig, requiredTools: tools },
    })),

  removeAlwaysAllow: (scope, tool) =>
    set((state) => ({
      approvalConfig:
        scope === "project"
          ? {
              ...state.approvalConfig,
              alwaysAllowProject:
                state.approvalConfig.alwaysAllowProject.filter(
                  (t) => t !== tool,
                ),
            }
          : {
              ...state.approvalConfig,
              alwaysAllowGlobal: state.approvalConfig.alwaysAllowGlobal.filter(
                (t) => t !== tool,
              ),
            },
    })),

  // ---- YOLO ----
  setYoloMode: async (enabled) => {
    set({ yoloMode: enabled });
    // Best-effort persist: SQLite may be absent in Vite-only dev. The
    // in-memory state still drives UI + IPC for the current launch.
    try {
      await setPref("yolo_mode", enabled);
    } catch (e) {
      console.warn("[prefs] setYoloMode: pref persistence failed.", e);
    }
    // YOLO is global — notify every alive bridge. Sessions spawned
    // later sync via the on-`ready` handler in ipc-handlers.ts.
    const runtimeSlots = useRuntimeStore.getState().byId;
    for (const sid of Object.keys(runtimeSlots)) {
      try {
        await useRuntimeStore
          .getState()
          .sendIPCCommand(sid, { kind: "set_yolo_mode", enabled });
      } catch (e) {
        console.warn(`[prefs] setYoloMode: bridge ${sid} notify failed.`, e);
      }
    }
  },

  acknowledgeYoloIntro: async (revertToApproval = false) => {
    // Order matters: flip YOLO before marking the modal seen so
    // bridges receive the new state alongside the prefs write.
    if (revertToApproval) {
      await get().setYoloMode(false);
    }
    set({ yoloIntroSeen: true });
    try {
      await setPref("yolo_intro_seen", true);
    } catch (e) {
      console.warn("[prefs] acknowledgeYoloIntro: pref persistence failed.", e);
    }
  },

  // ---- Conversation width ----
  setConversationWidth: async (mode) => {
    set({ conversationWidth: mode });
    try {
      await setPref("conversation_width", mode);
    } catch (e) {
      console.warn("[prefs] setConversationWidth: pref persistence failed.", e);
    }
  },

  // ---- Language ----
  setLanguagePreference: async (preference) => {
    set({ languagePreference: preference });
    try {
      await setPref("language_preference", preference);
    } catch (e) {
      console.warn(
        "[prefs] setLanguagePreference: pref persistence failed.",
        e,
      );
    }
  },

  // ---- GA config ----
  setGAConfig: async (partial) => {
    const merged = normalizeGAConfig({ ...get().gaConfig, ...partial });
    // Translate the python alias (Tauri shell-capability `name` like
    // "python-framework-3-14") to its resolved display path for the
    // Settings → Runtime "Python" field. Falls back to the raw alias
    // for unknown values so Settings never shows an empty field.
    const displayCandidate = await findCandidateByAlias(merged.python);
    const pythonDisplay = displayCandidate?.displayPath ?? merged.python;
    set({ gaConfig: merged });
    // Reflect into runtimeInfo so the Settings → Runtime tab and
    // Inspector → Runtime card show the new path immediately.
    useRuntimeStore.getState().patchRuntimeInfo({
      gaPath: merged.gaPath,
      pythonVersion: pythonDisplay,
    });
    // Reset the warmup flag so a new gaPath (or python interpreter)
    // re-triggers a one-shot LLM list refresh against the new
    // mykey.py.
    useRuntimeStore.getState().resetWarmup();
    try {
      await setPref("ga_config", merged);
    } catch (e) {
      console.warn("[prefs] setGAConfig: pref persistence failed.", e);
    }
    // Existing alive bridges keep their old config. Tell the user
    // that the change takes effect on next launch.
    const changedField = Object.entries(partial).find(
      ([, v]) => v !== undefined && v !== "",
    );
    if (changedField) {
      const copy = copyForLanguage(
        resolveLanguagePreference(get().languagePreference),
      );
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.savedPath,
          message: copy.toasts.restartForExisting,
          hint: null,
          retryable: false,
          context: "setGAConfig",
          traceback: null,
        }),
      );
      // Retrigger warmup with the new gaConfig so the LLM picker
      // reflects mykey.py from the new GA install without requiring
      // a Workbench restart.
      void useRuntimeStore.getState().warmupLLMList();
    }
  },

  // ---- Runtime mode ----
  setActiveRuntimeKind: async (kind) => {
    set({ activeRuntimeKind: kind });
    try {
      await setPref("active_runtime_kind", kind);
    } catch (e) {
      console.warn("[prefs] setActiveRuntimeKind: pref persistence failed.", e);
    }
  },

  // ---- Hydration ----
  hydratePrefs: async () => {
    // YOLO mode — sticky preference. Best-effort load.
    let userHasYoloPref = false;
    try {
      const yolo = await getPref<boolean>("yolo_mode");
      if (typeof yolo === "boolean") {
        set({ yoloMode: yolo });
        userHasYoloPref = true;
      }
    } catch (e) {
      console.warn("[prefs] hydratePrefs: yolo pref load failed.", e);
    }
    // YOLO intro modal — surfaces once for true-new users to disclose
    // that YOLO is the default. Initial state is `true` (hidden) so
    // the modal doesn't flash during cold start; only flip to `false`
    // when both prefs say "user has never expressed a YOLO opinion on
    // this device".
    if (!userHasYoloPref) {
      try {
        const seen = await getPref<boolean>("yolo_intro_seen");
        if (seen !== true) set({ yoloIntroSeen: false });
      } catch (e) {
        console.warn(
          "[prefs] hydratePrefs: yolo_intro_seen pref load failed.",
          e,
        );
      }
    }
    try {
      const width = await getPref<"compact" | "wide">("conversation_width");
      if (width === "wide" || width === "compact") {
        set({ conversationWidth: width });
      }
    } catch (e) {
      console.warn(
        "[prefs] hydratePrefs: conversation_width pref load failed.",
        e,
      );
    }
    try {
      const languagePreference = await getPref<LanguagePreference>(
        "language_preference",
      );
      if (
        languagePreference === "system" ||
        languagePreference === "zh-CN" ||
        languagePreference === "en-US"
      ) {
        set({ languagePreference });
      }
    } catch (e) {
      console.warn(
        "[prefs] hydratePrefs: language_preference pref load failed.",
        e,
      );
    }
    // GA spawn config. When `ga_config` pref is absent the user is
    // fresh-from-install: the orchestrator routes them to Onboarding
    // so they can pick a GA path + run health checks.
    let hasGAConfig = false;
    try {
      const saved = await getPref<{
        python: string;
        gaPath: string;
        bridgeCwd: string;
        useExternalPython?: boolean;
      }>("ga_config");
      if (saved && saved.gaPath) {
        hasGAConfig = true;
        // Migrate legacy alpha.2 configs (no useExternalPython field).
        // Default to false so upgrading users automatically pick up
        // the bundled Python — they keep their old `python` alias on
        // file as the escape hatch if anything goes sideways.
        const migrated = normalizeGAConfig({
          ...saved,
          useExternalPython: saved.useExternalPython ?? false,
        });
        const displayCandidate = await findCandidateByAlias(migrated.python);
        const pythonDisplay = displayCandidate?.displayPath ?? migrated.python;
        set({ gaConfig: migrated });
        useRuntimeStore.getState().patchRuntimeInfo({
          gaPath: migrated.gaPath,
          pythonVersion: pythonDisplay,
        });
      }
    } catch (e) {
      console.warn("[prefs] hydratePrefs: ga_config pref load failed.", e);
    }
    try {
      const activeRuntimeKind = await getPref<RuntimeKind>(
        "active_runtime_kind",
      );
      if (activeRuntimeKind === "managed" || activeRuntimeKind === "external") {
        set({ activeRuntimeKind });
      } else {
        set({ activeRuntimeKind: hasGAConfig ? "external" : "managed" });
      }
    } catch (e) {
      console.warn(
        "[prefs] hydratePrefs: active_runtime_kind pref load failed.",
        e,
      );
      set({ activeRuntimeKind: hasGAConfig ? "external" : "managed" });
    }
    return { hasGAConfig };
  },
}));

// Expose the store on `window.__prefs` in dev so the user can
// inspect / mutate state from the DevTools console without React
// DevTools. Stripped in production by `import.meta.env.DEV`.
//
// Usage in console:
//   __prefs.getState().gaConfig
//   __prefs.getState().yoloMode
if (import.meta.env.DEV) {
  (globalThis as { __prefs?: typeof usePrefsStore }).__prefs = usePrefsStore;
}
