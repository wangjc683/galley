import {
  type BrowserControlErrorGroup,
  browserControlErrorGroup,
  browserControlErrorRetries,
} from "@/components/layout/header/browser-control-indicator-status";
import type {
  BrowserBridgeStatus,
  BrowserControlBrowser,
  BrowserControlProbeKind,
  BrowserControlStatus,
  BrowserControlTestOutcome,
} from "@/lib/browser-control";
import type { AppCopy } from "@/lib/i18n";

/**
 * Pure view logic for Settings → Browser Control: which layout the page
 * takes, what its status card and setup status line say, and where an
 * error came from. The component only renders what these return.
 */

/** The setup guide's browser picker. Core's open commands know only
 * Chrome and Edge; 「其他」 shows the address to type instead. */
export type BrowserControlGuideBrowser = BrowserControlBrowser | "other";

/** What the page needs from the Browser Control store. */
export interface BrowserControlViewInput {
  status: BrowserControlStatus;
  verified: boolean;
  verificationHydrated: boolean;
  bridge: Pick<BrowserBridgeStatus, "state" | "errorKind"> | null;
  layoutError: string | null;
  testOutcome: BrowserControlTestOutcome | null;
  /** The store's raw detail text for the error status (bridge message,
   * folder-sync error or probe detail); never a sentence of its own. */
  error: string | null;
  probing: boolean;
}

export type BrowserControlProbeFailureKind = Extract<
  BrowserControlProbeKind,
  "script_failed" | "no_result" | "exception"
>;

/** Where the current error came from; the title is worded per source. */
export type BrowserControlErrorSource =
  | {
      source: "bridge";
      group: BrowserControlErrorGroup;
      detail: string | null;
      /** Show 「正在自动重试。」 (same rule as the topbar menu). */
      retrying: boolean;
    }
  | { source: "layout"; detail: string }
  | {
      source: "probe";
      kind: BrowserControlProbeFailureKind;
      detail: string | null;
    };

/** The verified page's status card. */
export type BrowserControlStatusCard =
  | { kind: "connected"; testPassed: boolean }
  | { kind: "noTabs" }
  | { kind: "offline" }
  | { kind: "connecting" }
  | { kind: "error"; error: BrowserControlErrorSource };

/** The setup guide's inline status line under step 3. */
export type BrowserControlSetupLine =
  | { kind: "notConnected" }
  | { kind: "connecting" }
  | { kind: "passed" }
  /** Live connection the verification has not caught up with (an
   * automatic verification that failed, then a status change cleared
   * its outcome): say so; 测试连接 next to it finishes setup. */
  | { kind: "connected" }
  | { kind: "noTabs" }
  | { kind: "error"; error: BrowserControlErrorSource };

/**
 * Verified installs get the status card (with repair folded away);
 * everything else gets the setup guide. Before the persisted flag is
 * read, a live status that only a verified install can have decides.
 */
export function browserControlVerifiedView(
  input: Pick<
    BrowserControlViewInput,
    "status" | "verified" | "verificationHydrated"
  >,
): boolean {
  if (input.verificationHydrated) return input.verified;
  return (
    input.status === "connected" ||
    input.status === "connected_no_tabs" ||
    input.status === "offline"
  );
}

/**
 * A bridge in error owns the status; otherwise a folder-sync failure;
 * otherwise the last probe failed (worded by its kind, an invoke
 * failure or a missing outcome reading as an exception).
 */
export function browserControlErrorSource(
  input: Pick<
    BrowserControlViewInput,
    "bridge" | "layoutError" | "testOutcome" | "error"
  >,
): BrowserControlErrorSource {
  const { bridge } = input;
  if (bridge?.state === "error") {
    return {
      source: "bridge",
      group: browserControlErrorGroup(bridge.errorKind),
      detail: input.error,
      retrying: browserControlErrorRetries(bridge.errorKind),
    };
  }
  if (input.layoutError) {
    return { source: "layout", detail: input.layoutError };
  }
  const outcome = input.testOutcome;
  const kind: BrowserControlProbeFailureKind =
    outcome?.kind === "script_failed" || outcome?.kind === "no_result"
      ? outcome.kind
      : "exception";
  return {
    source: "probe",
    kind,
    detail: input.error ?? outcome?.detail ?? null,
  };
}

export function browserControlStatusCard(
  input: BrowserControlViewInput,
): BrowserControlStatusCard {
  switch (input.status) {
    case "connected":
      return {
        kind: "connected",
        testPassed: input.testOutcome?.kind === "connected",
      };
    case "connected_no_tabs":
      return { kind: "noTabs" };
    // A verified install the bridge reports as not connected (a race
    // with the verification flag) is simply offline.
    case "offline":
    case "not_connected":
      return { kind: "offline" };
    case "unknown":
      return { kind: "connecting" };
    case "error":
      return { kind: "error", error: browserControlErrorSource(input) };
  }
}

/**
 * The quiet row under the status card: 测试连接 where a test can tell
 * something new (connected, or a failed probe to retry), the demo only
 * while connected.
 */
export function browserControlMaintenance(card: BrowserControlStatusCard): {
  test: boolean;
  demo: boolean;
} {
  if (card.kind === "connected") return { test: true, demo: true };
  if (card.kind === "error" && card.error.source === "probe") {
    return { test: true, demo: false };
  }
  return { test: false, demo: false };
}

/**
 * Step 3's status line while setting up: the test's outcome, else the
 * live status. Null while a test runs (the 测试连接 button's own spinner
 * says so; a second spinner below it was noise) and for `offline`, which
 * an unverified install does not reach.
 */
export function browserControlSetupLine(
  input: BrowserControlViewInput,
): BrowserControlSetupLine | null {
  if (input.probing) return null;
  const outcome = input.testOutcome;
  if (outcome) {
    switch (outcome.kind) {
      case "not_connected":
        return { kind: "notConnected" };
      case "connected":
      case "no_tabs":
        return { kind: "passed" };
      case "script_failed":
      case "no_result":
      case "exception":
        return { kind: "error", error: browserControlErrorSource(input) };
    }
  }
  switch (input.status) {
    case "not_connected":
      return { kind: "notConnected" };
    case "unknown":
      return { kind: "connecting" };
    case "error":
      return { kind: "error", error: browserControlErrorSource(input) };
    case "connected":
      return { kind: "connected" };
    case "connected_no_tabs":
      return { kind: "noTabs" };
    case "offline":
      return null;
  }
}

/** The error's title line; the source's raw text goes below it. */
export function browserControlErrorTitle(
  error: BrowserControlErrorSource,
  copy: Pick<AppCopy, "browserControl" | "topbar">,
): string {
  switch (error.source) {
    case "bridge":
      return error.group === "generic"
        ? copy.topbar.browserControlErrorTitle
        : copy.topbar.browserControlErrors[error.group].title;
    case "layout":
      return copy.browserControl.stepPrepareFailed;
    case "probe":
      switch (error.kind) {
        case "script_failed":
          return copy.browserControl.testScriptFailed;
        case "no_result":
          return copy.browserControl.testNoResult;
        case "exception":
          return copy.browserControl.testException;
      }
  }
}
