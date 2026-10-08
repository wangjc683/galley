import { invoke } from "@tauri-apps/api/core";

export type BrowserControlProbeStatus =
  | "connected"
  | "connected_no_tabs"
  | "not_connected"
  | "error";

export type BrowserControlStatus =
  | "unknown"
  | "offline"
  | "not_connected"
  | "connected_no_tabs"
  | "connected"
  | "error";

export type BrowserControlBrowser = "chrome" | "edge";
export type BrowserControlProbeContext = "auto_verify" | "recheck" | "manual";

/**
 * Live state of Core's resident browser bridge (managed runtime only):
 * the process hosting GA's TMWebDriver master that the extension connects
 * to. Mirrors `core/src/browser_bridge.rs` `BrowserBridgeStatus`.
 */
export type BrowserBridgeState = "stopped" | "starting" | "running" | "error";
export type BrowserBridgeRole = "master" | "remote";

export interface BrowserBridgeStatus {
  state: BrowserBridgeState;
  role: BrowserBridgeRole | null;
  extensionConnected: boolean;
  tabCount: number;
  errorKind: string | null;
  error: string | null;
  pid: number | null;
  updatedAt: string;
}

export const BROWSER_BRIDGE_EVENT = "browser-bridge-updated";

export interface BrowserControlLayout {
  extensionDir: string;
  sourceDir: string;
  manifestVersion: string;
  filesCopied: number;
}

/**
 * Why a probe ended the way it did. Mirrors `core/src/browser_control.rs`
 * `BrowserControlProbeKind`; the GUI words each kind itself, so
 * `message` (Core's Chinese sentence) is never shown as the main line.
 */
export type BrowserControlProbeKind =
  | "connected"
  | "no_tabs"
  | "not_connected"
  | "script_failed"
  | "no_result"
  | "exception";

export interface BrowserControlProbe {
  status: BrowserControlProbeStatus;
  kind: BrowserControlProbeKind;
  extensionDir: string;
  manifestVersion: string;
  tabCount: number;
  sampleTitle?: string | null;
  message?: string | null;
  /** Raw technical text for the failure kinds (the page-script error,
   * the probe's stderr tail, the exception); null otherwise. */
  detail?: string | null;
}

/**
 * The outcome of the last connection test, for the Settings page's
 * inline result line. `not_connected` with no probe run is the manual
 * test short-circuit (the resident bridge already says the extension is
 * not there). Cleared when the live status changes.
 */
export interface BrowserControlTestOutcome {
  kind: BrowserControlProbeKind;
  detail: string | null;
}

export function ensureBrowserControlLayout(): Promise<BrowserControlLayout> {
  return invoke<BrowserControlLayout>("ensure_browser_control_layout");
}

/**
 * Map the live bridge state to the UI status. Tabs win over the extension
 * flag: GA can drive any tab the master lists, and an upstream master
 * without `get_status` reports tabs but no extension flag.
 */
export function statusForBridge(
  bridge: BrowserBridgeStatus,
  verified: boolean,
): BrowserControlStatus {
  if (bridge.state === "running") {
    if (bridge.tabCount > 0) return "connected";
    if (bridge.extensionConnected) return "connected_no_tabs";
    return verified ? "offline" : "not_connected";
  }
  if (bridge.state === "error") return "error";
  return "unknown";
}

/** The extension is reachable now (with or without operable tabs). */
export function bridgeSeesExtension(bridge: BrowserBridgeStatus): boolean {
  return (
    bridge.state === "running" &&
    (bridge.extensionConnected || bridge.tabCount > 0)
  );
}

export function getBrowserBridgeStatus(): Promise<BrowserBridgeStatus> {
  return invoke<BrowserBridgeStatus>("get_browser_bridge_status");
}

export function probeBrowserControl(
  context: BrowserControlProbeContext = "manual",
): Promise<BrowserControlProbe> {
  return invoke<BrowserControlProbe>("probe_browser_control", { context });
}

export function openBrowserControlExtensionsPage(
  browser: BrowserControlBrowser,
): Promise<void> {
  return invoke("open_browser_control_extensions_page", { browser });
}

export function openBrowserControlTestPage(
  browser: BrowserControlBrowser,
): Promise<void> {
  return invoke("open_browser_control_test_page", { browser });
}
