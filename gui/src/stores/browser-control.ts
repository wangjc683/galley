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
  type BrowserControlTestOutcome,
} from "@/lib/browser-control";
import { getPref, setPref } from "@/lib/db";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

const BROWSER_CONTROL_VERIFIED_PREF = "browser_control_verified";

/** The sticky 「试一试」 toast; switching runtime mode dismisses it
 * (`switchRuntimeKind`), since its demo would go to the other runtime. */
export const BROWSER_CONTROL_READY_TOAST_ID = "browser-control-ready";

// Probes in flight (manual, recheck or automatic); `probing` mirrors
// "any". Counted, not a flag: the automatic probe can overlap a manual
// one, and the first to finish must not clear `probing` for the other.
let probesInFlight = 0;
// Same for the extension-folder sync behind `syncingLayout` (launch and
// Settings can both start one).
let layoutSyncsInFlight = 0;

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
  const prefs = usePrefsStore.getState();
  // An automatic probe that lands after a switch to external GA must not
  // offer a demo that would run there (the switch already dismissed it).
  if (prefs.activeRuntimeKind !== "managed") return;
  const copy = copyForLanguage(
    resolveLanguagePreference(prefs.languagePreference),
  );
  useUiStore.getState().pushToast(
    makeAppError({
      id: BROWSER_CONTROL_READY_TOAST_ID,
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
  /** A probe (manual, recheck or automatic) is in flight. */
  probing: boolean;
  /** `ensureLayout` (the extension-folder sync) is in flight. */
  syncingLayout: boolean;
  /** Detail for the error status, as its source gave it: the bridge's
   * own message, the folder-sync error, the probe's `detail` or invoke
   * error; null when the source has none. The store adds no wording of
   * its own: the UI words the status and shows this as the detail. */
  error: string | null;
  /** The last connection test's outcome for Settings' inline result
   * line; null while one runs and once the live status changes. */
  testOutcome: BrowserControlTestOutcome | null;
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
    probing: false,
    syncingLayout: false,
    error: null,
    testOutcome: null,
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
      // Entry leaves `error` / `layoutError` alone: they describe the
      // current status (the bridge's own message among them), which a
      // sync in flight has not changed yet.
      layoutSyncsInFlight += 1;
      set({ syncingLayout: true });
      try {
        const layout = await ensureBrowserControlLayout();
        const state = get();
        // Read after the await: a folder error still standing now is the
        // one this success recovers from (one a successful probe already
        // cleared meanwhile is not, and its result stays).
        if (state.layoutError === null) {
          set({ layout });
          return layout;
        }
        const bridge = state.bridge;
        set({
          layout,
          layoutError: null,
          error: bridge?.state === "error" ? bridge.error : null,
          // The folder error was the status only without a bridge; with
          // one, the status is the bridge's and stays.
          status:
            state.status === "error" && !bridge
              ? state.verified
                ? "offline"
                : "not_connected"
              : state.status,
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
        });
        return null;
      } finally {
        layoutSyncsInFlight -= 1;
        if (layoutSyncsInFlight === 0) set({ syncingLayout: false });
      }
    },

    probe: async (context = "manual") => {
      // Manual short-circuit (测试连接): with the resident
      // bridge running and not seeing the extension, a probe would only
      // wait out the same 35 s reconnect window the bridge is already
      // waiting on, and report the same 未连接. The bridge is the
      // "equivalent immediate wake-up path" that
      // docs/managed-ga-runtime/browser-control.md asks for before the
      // probe window may shrink: the moment the extension reconnects, the
      // bridge pushes the new status (and, before setup is verified, the
      // automatic probe still runs). So answer from the bridge at once
      // and leave status / verification / lastProbe untouched. With no
      // running bridge (none yet, starting, stopped, error) the probe
      // still runs: it is then the only way to find the extension.
      const liveBridge = get().bridge;
      if (
        context !== "auto_verify" &&
        liveBridge?.state === "running" &&
        !bridgeSeesExtension(liveBridge)
      ) {
        set({ testOutcome: { kind: "not_connected", detail: null } });
        return null;
      }
      probesInFlight += 1;
      // `error` stays until the result lands: it is the detail of the
      // status, which does not change while the probe runs.
      set({ probing: true, testOutcome: null });
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
          // The raw failure text; the UI words the failure from `kind`.
          error: status === "error" ? (probe.detail ?? null) : null,
          testOutcome: { kind: probe.kind, detail: probe.detail ?? null },
        });
        return probe;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        set({
          status: "error",
          error,
          layoutError: get().layout ? get().layoutError : error,
          testOutcome: { kind: "exception", detail: error },
        });
        return null;
      } finally {
        probesInFlight -= 1;
        if (probesInFlight === 0) set({ probing: false });
      }
    },

    applyBridgeStatus: (bridge) => {
      const state = get();
      const sees = bridgeSeesExtension(bridge);
      const status = statusForBridge(bridge, state.verified);
      set({
        bridge,
        status,
        error: bridge.state === "error" ? bridge.error : state.layoutError,
        autoVerifyArmed: sees ? state.autoVerifyArmed : true,
        // A test result holds until the live status moves on; tab-count
        // churn under the same status keeps it.
        ...(status !== state.status ? { testOutcome: null } : {}),
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
      set({
        bridge: null,
        status: "unknown",
        autoVerifyArmed: true,
        testOutcome: null,
      });
    },
  }),
);
