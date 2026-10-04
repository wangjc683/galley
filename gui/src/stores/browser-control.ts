import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  BROWSER_BRIDGE_EVENT,
  bridgeSeesExtension,
  ensureBrowserControlLayout,
  getBrowserBridgeStatus,
  probeBrowserControl,
  statusForBridge,
  type BrowserBridgeStatus,
  type BrowserControlLayout,
  type BrowserControlProbe,
  type BrowserControlProbeContext,
  type BrowserControlProbeStatus,
  type BrowserControlStatus,
} from "@/lib/browser-control";
import { getPref, setPref } from "@/lib/db";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

const BROWSER_CONTROL_VERIFIED_PREF = "browser_control_verified";

// Probes in flight (manual, recheck or automatic). `busy` cannot gate the
// automatic one: the startup layout sync also sets it, and an extension
// that is already connected at launch reports exactly then.
let probesInFlight = 0;

function isSuccessfulProbeStatus(status: BrowserControlProbeStatus): boolean {
  return status === "connected" || status === "connected_no_tabs";
}

/**
 * The moment setup completes on its own is the moment the capability is
 * worth trying, so the automatic verification's success offers the demo
 * once (the empty state stays deliberately empty: conversation.md §7).
 * Sticky: it fires while the user is still in the browser's extensions
 * page, and a timed toast would be gone before they come back.
 */
function pushReadyToast() {
  const copy = copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
  useUiStore.getState().pushToast(
    makeAppError({
      id: "browser-control-ready",
      category: "business",
      severity: "info",
      title: copy.toasts.browserControlReady,
      message: copy.toasts.browserControlReadyMessage,
      hint: null,
      retryable: false,
      context: "browser_control_auto_verify",
      traceback: null,
      action: {
        kind: "try_browser_control",
        label: copy.toasts.tryBrowserControl,
      },
      autoDismissMs: 0,
    }),
  );
}

function statusForProbe(
  probe: BrowserControlProbe,
  verified: boolean,
): BrowserControlStatus {
  if (probe.status === "connected") return "connected";
  if (probe.status === "connected_no_tabs") return "connected_no_tabs";
  if (probe.status === "not_connected") {
    return verified ? "offline" : "not_connected";
  }
  return "error";
}

interface BrowserControlState {
  status: BrowserControlStatus;
  /** Latest live state from Core's resident bridge; null until the first
   * report (and outside the managed runtime). */
  bridge: BrowserBridgeStatus | null;
  layout: BrowserControlLayout | null;
  layoutError: string | null;
  lastProbe: BrowserControlProbe | null;
  busy: boolean;
  error: string | null;
  verified: boolean;
  verificationHydrated: boolean;
  /** One automatic verification per connection: re-armed when the bridge
   * stops seeing the extension, so tab-count churn never re-probes. */
  autoVerifyArmed: boolean;
  hydrateVerification: () => Promise<boolean>;
  ensureLayout: () => Promise<BrowserControlLayout | null>;
  probe: (
    context?: BrowserControlProbeContext,
  ) => Promise<BrowserControlProbe | null>;
  applyBridgeStatus: (bridge: BrowserBridgeStatus) => void;
  /** Subscribe to the live bridge state; returns the unsubscribe. */
  connectLiveStatus: () => () => void;
  resetLiveStatus: () => void;
}

export const useBrowserControlStore = create<BrowserControlState>(
  (set, get) => ({
    status: "unknown",
    bridge: null,
    layout: null,
    layoutError: null,
    lastProbe: null,
    busy: false,
    error: null,
    verified: false,
    verificationHydrated: false,
    autoVerifyArmed: true,

    hydrateVerification: async () => {
      const state = get();
      if (state.verificationHydrated) return state.verified;
      try {
        const verified =
          (await getPref<boolean>(BROWSER_CONTROL_VERIFIED_PREF)) === true;
        set({ verified, verificationHydrated: true });
        return verified;
      } catch {
        set({ verificationHydrated: true });
        return get().verified;
      }
    },

    ensureLayout: async () => {
      set({ busy: true, error: null, layoutError: null });
      try {
        const layout = await ensureBrowserControlLayout();
        const state = get();
        const recoveredLayoutError = Boolean(state.layoutError);
        set({
          layout,
          layoutError: null,
          error: recoveredLayoutError ? null : state.error,
          status:
            recoveredLayoutError && state.status === "error" && !state.bridge
              ? state.verified
                ? "offline"
                : "not_connected"
              : state.status,
          busy: false,
        });
        return layout;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        // With a live bridge the connection status stays the bridge's: a
        // failed folder sync blocks (re)installing, not a connected
        // extension. Settings shows the layout error at its own step.
        set({
          status: get().bridge ? get().status : "error",
          error,
          layoutError: error,
          busy: false,
        });
        return null;
      }
    },

    probe: async (context = "manual") => {
      probesInFlight += 1;
      set({ busy: true, error: null });
      try {
        const wasVerified = await get().hydrateVerification();
        const probe = await probeBrowserControl(context);
        const verified = wasVerified || isSuccessfulProbeStatus(probe.status);
        if (verified && !wasVerified) {
          void setPref(BROWSER_CONTROL_VERIFIED_PREF, true).catch(() => {});
          // Only the automatic run: a manual 测试连接 already has the
          // demo button next to it in Settings.
          if (context === "auto_verify") pushReadyToast();
        }
        // The live bridge owns the connection state; the probe adds the
        // verification and its sample. A failed script round trip still
        // shows as an error until the bridge reports the next change.
        const bridge = get().bridge;
        const status =
          bridge && bridge.state === "running" && probe.status !== "error"
            ? statusForBridge(bridge, verified)
            : statusForProbe(probe, verified);
        set({
          status,
          verified,
          verificationHydrated: true,
          lastProbe: probe,
          layout: {
            extensionDir: probe.extensionDir,
            sourceDir: get().layout?.sourceDir ?? "",
            manifestVersion: probe.manifestVersion,
            filesCopied: get().layout?.filesCopied ?? 0,
          },
          layoutError: null,
          error: status === "error" ? (probe.message ?? "测试失败") : null,
          busy: false,
        });
        return probe;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        set({
          status: "error",
          error,
          layoutError: get().layout ? get().layoutError : error,
          busy: false,
        });
        return null;
      } finally {
        probesInFlight -= 1;
      }
    },

    applyBridgeStatus: (bridge) => {
      const state = get();
      const sees = bridgeSeesExtension(bridge);
      const status = statusForBridge(bridge, state.verified);
      set({
        bridge,
        status,
        error:
          bridge.state === "error"
            ? (bridge.error ?? "浏览器控制服务不可用")
            : state.layoutError,
        autoVerifyArmed: sees ? state.autoVerifyArmed : true,
      });
      // Setup step 3 completes on its own: the first time the extension
      // reaches the resident master and the install is not yet verified,
      // run the deterministic probe once (as a remote client, no port
      // grab). 测试连接 keeps working for a manual retry.
      if (
        sees &&
        state.autoVerifyArmed &&
        state.verificationHydrated &&
        !state.verified &&
        probesInFlight === 0
      ) {
        set({ autoVerifyArmed: false });
        void get().probe("auto_verify");
      }
    },

    connectLiveStatus: () => {
      let cancelled = false;
      let unlisten: (() => void) | null = null;
      let gotEvent = false;
      void (async () => {
        await get().hydrateVerification();
        if (cancelled) return;
        // Subscribe before the snapshot fetch so a change in between is
        // not lost; a snapshot older than an event is dropped.
        try {
          const fn = await listen<BrowserBridgeStatus>(
            BROWSER_BRIDGE_EVENT,
            (event) => {
              if (cancelled) return;
              gotEvent = true;
              get().applyBridgeStatus(event.payload);
            },
          );
          if (cancelled) fn();
          else unlisten = fn;
        } catch (e) {
          console.warn("[browser-control] subscribing to bridge failed", e);
        }
        if (cancelled) return;
        try {
          const snapshot = await getBrowserBridgeStatus();
          if (!cancelled && !gotEvent) get().applyBridgeStatus(snapshot);
        } catch (e) {
          console.warn("[browser-control] reading bridge status failed", e);
        }
      })();
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },

    resetLiveStatus: () => {
      set({ bridge: null, status: "unknown", autoVerifyArmed: true });
    },
  }),
);
