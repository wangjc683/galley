import type { AppCopy } from "@/lib/i18n";
import type { RemoteStatus } from "@/lib/remote";

import type { SettingsStatusTone } from "./settings-badges";

/**
 * Pure view logic for Settings → Phone (ticket 05d): Core's remote status
 * plus the page's own QR state in, what to draw out. The component only
 * renders what this returns.
 *
 * Wording rule: the page never names the relay. To the user the phone
 * connects to this computer; Core's relay connection being down reads as
 * the network being unreachable for now.
 */

type PhoneCopy = AppCopy["settings"]["phone"];

/** The QR code on screen, and what it was shown against. */
export interface ShownQr {
  svg: string;
  /** `lastPhoneConnectedAt` when it was shown: a phone connecting after
   * that (the time moves) is the scan, and the code folds away. */
  since: string | null;
  /** Shown while unpaired: the first pairing, which keeps the pairing
   * layout until a phone connects even though Core is paired from the
   * moment the code exists. */
  firstPairing: boolean;
}

/** The code stays up until a phone connects after it was shown. Leaving
 * the page or unpairing drops it in the component. */
export function qrStillShown(status: RemoteStatus, qr: ShownQr): boolean {
  return status.lastPhoneConnectedAt === qr.since;
}

/** Where a paired desktop's phones stand. */
export type PhoneConnectionKind = "online" | "idle" | "connecting";

export interface PhoneStatusRow {
  kind: PhoneConnectionKind;
  badge: { tone: SettingsStatusTone; label: string; spin: boolean };
  title: string;
  detail: string;
}

export interface PhonePageView {
  /**
   * - `pair`: not paired, or pairing the first phone — one row
   *   (Pair a phone, with the show-code button as the primary action)
   *   and the code under it.
   * - `paired`: the status row, Add a phone (the code under it when
   *   shown), Unpair.
   */
  layout: "pair" | "paired";
  /** `null` in the `pair` layout. */
  status: PhoneStatusRow | null;
  showQr: boolean;
  /** "Keep running when the window closes" is off: closing the window
   * quits Galley and the phones lose this computer. */
  showBackgroundHint: boolean;
}

export function phoneStatusRow(
  status: RemoteStatus,
  lastConnectedText: string | null,
  copy: PhoneCopy,
): PhoneStatusRow {
  if (!status.relayConnected) {
    return {
      kind: "connecting",
      badge: { tone: "neutral", label: copy.badgeConnecting, spin: true },
      title: copy.connectingTitle,
      detail: copy.connectingDetail,
    };
  }
  const detail = lastConnectedText
    ? copy.lastConnected(lastConnectedText)
    : copy.autoConnectHint;
  if (status.onlinePhones > 0) {
    return {
      kind: "online",
      badge: { tone: "success", label: copy.badgeOnline, spin: false },
      title: copy.onlineTitle(status.onlinePhones),
      detail,
    };
  }
  return {
    kind: "idle",
    badge: { tone: "neutral", label: copy.badgeIdle, spin: false },
    title: copy.idleTitle,
    detail,
  };
}

export function phonePageView({
  status,
  qr,
  keepInBackgroundOnClose,
  lastConnectedText,
  copy,
}: {
  status: RemoteStatus;
  /** The code on screen, already checked with {@link qrStillShown}. */
  qr: ShownQr | null;
  keepInBackgroundOnClose: boolean;
  /** `status.lastPhoneConnectedAt` in the app's date format. */
  lastConnectedText: string | null;
  copy: PhoneCopy;
}): PhonePageView {
  const pairing = !status.paired || (qr !== null && qr.firstPairing);
  return {
    layout: pairing ? "pair" : "paired",
    status: pairing ? null : phoneStatusRow(status, lastConnectedText, copy),
    showQr: qr !== null,
    showBackgroundHint: !keepInBackgroundOnClose,
  };
}

/** The SVG as an `<img>` source, so the markup is never injected into
 * the page. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
