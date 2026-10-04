import type { BrowserControlStatus } from "@/lib/browser-control";

/** What the MainHeader needs from the Browser Control store. */
export interface BrowserControlIndicatorInput {
  status: BrowserControlStatus;
  /** Persisted `browser_control_verified`: setup was completed once. */
  verified: boolean;
  /** False until the persisted flag has been read (a few ms at launch). */
  verificationHydrated: boolean;
  tabCount: number;
  /** The bridge's machine error kind (`port_in_use`, …), when it has one. */
  errorKind: string | null;
  /** The bridge's (Chinese) error text, or a probe / folder-sync failure. */
  errorDetail: string | null;
}

/** Popover state line of the lamp form. */
export type BrowserControlLampState =
  | "connected"
  | "noTabs"
  | "offline"
  | "checking";

/** Copy group for an `error` badge (`copy.topbar.browserControlErrors`). */
export type BrowserControlErrorGroup =
  | "missingDependency"
  | "portInUse"
  | "unreachable"
  | "startFailed"
  | "generic";

export type BrowserControlIndicatorView =
  | { form: "hidden" }
  | { form: "lamp"; lit: boolean; state: BrowserControlLampState }
  | { form: "pending" }
  | { form: "error"; group: BrowserControlErrorGroup };

/**
 * Lamp (lit = a live extension connection, unlit = set up but not
 * connected), the 待解锁 invitation badge, or an error badge.
 *
 * `unknown` (before the bridge's first report, or while it restarts)
 * renders what the persisted verification already says instead of a
 * 「检测中」 badge that flashed for about a second at every launch: a
 * verified install shows the unlit lamp (it lights when the extension
 * reports), an unverified one shows 待解锁 — true either way, since 待解锁
 * means "setup not completed" and that flag is already known. Only the
 * few milliseconds before the flag is read render nothing.
 */
export function browserControlIndicatorView(
  input: BrowserControlIndicatorInput,
): BrowserControlIndicatorView {
  switch (input.status) {
    case "connected":
      return { form: "lamp", lit: true, state: "connected" };
    case "connected_no_tabs":
      return { form: "lamp", lit: true, state: "noTabs" };
    case "offline":
      return { form: "lamp", lit: false, state: "offline" };
    case "not_connected":
      return { form: "pending" };
    case "error":
      return {
        form: "error",
        group: browserControlErrorGroup(input.errorKind),
      };
    case "unknown":
      if (!input.verificationHydrated) return { form: "hidden" };
      return input.verified
        ? { form: "lamp", lit: false, state: "checking" }
        : { form: "pending" };
  }
}

/**
 * Bridge error kinds (`core/src/browser_bridge.rs`,
 * `runner/managed_browser_bridge.py`) folded into the four causes a user
 * can tell apart. Probe and folder-sync failures carry no kind.
 */
export function browserControlErrorGroup(
  errorKind: string | null,
): BrowserControlErrorGroup {
  switch (errorKind) {
    case "missing_dependency":
      return "missingDependency";
    case "port_in_use":
      return "portInUse";
    case "master_unreachable":
      return "unreachable";
    case "start_failed":
    case "http_failed":
    case "spawn_failed":
    case "exited":
      return "startFailed";
    default:
      return "generic";
  }
}

/**
 * The main-area invitation banner shows while setup has never been
 * completed and nothing is connected right now. It follows the persisted
 * flag (not the live status) so it is there from the first frame instead
 * of appearing a second after launch. A verified install with a bridge
 * error has nothing to unlock; its error badge carries the problem.
 */
export function browserControlInviteVisible(
  input: Pick<
    BrowserControlIndicatorInput,
    "status" | "verified" | "verificationHydrated"
  >,
): boolean {
  if (!input.verificationHydrated || input.verified) return false;
  return input.status !== "connected" && input.status !== "connected_no_tabs";
}
